use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    XChaCha20Poly1305, XNonce,
};
use rand::RngCore;
use std::fs::{self, OpenOptions};
use std::io::{Seek, SeekFrom, Write};
use std::path::Path;
use zeroize::Zeroizing;

pub const CHUNK_SIZE: usize = 256 * 1024; // 256 KiB plaintext per chunk
pub const POLY1305_TAG_LEN: usize = 16;

pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut buf = [0u8; N];
    rand::thread_rng().fill_bytes(&mut buf);
    buf
}

/// Derives a 256-bit Key Encryption Key (KEK) from a passphrase and 32-byte salt
/// using Argon2id (64 MiB memory, 3 iterations, 4 lanes).
pub fn derive_kek(passphrase: &str, salt: &[u8; 32]) -> Result<Zeroizing<[u8; 32]>, String> {
    let params = Params::new(65536, 3, 4, Some(32))
        .map_err(|e| format!("Argon2 params error: {e}"))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut key = Zeroizing::new([0u8; 32]);
    argon2
        .hash_password_into(passphrase.as_bytes(), salt, &mut *key)
        .map_err(|e| format!("Key derivation failed: {e}"))?;
    Ok(key)
}

pub fn encrypt_aead(
    key: &[u8; 32],
    nonce: &[u8; 24],
    plaintext: &[u8],
    aad: &[u8],
) -> Result<Vec<u8>, String> {
    let cipher = XChaCha20Poly1305::new(key.into());
    cipher
        .encrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: plaintext,
                aad,
            },
        )
        .map_err(|_| "Encryption failure".to_string())
}

pub fn decrypt_aead(
    key: &[u8; 32],
    nonce: &[u8; 24],
    ciphertext: &[u8],
    aad: &[u8],
) -> Result<Zeroizing<Vec<u8>>, String> {
    let cipher = XChaCha20Poly1305::new(key.into());
    let pt = cipher
        .decrypt(
            XNonce::from_slice(nonce),
            Payload {
                msg: ciphertext,
                aad,
            },
        )
        .map_err(|_| "Authentication or decryption failed".to_string())?;
    Ok(Zeroizing::new(pt))
}

/// Builds a unique 24-byte nonce from a 16-byte per-file prefix and 8-byte chunk index.
pub fn chunk_nonce(prefix: &[u8; 16], chunk_idx: u64) -> [u8; 24] {
    let mut nonce = [0u8; 24];
    nonce[..16].copy_from_slice(prefix);
    nonce[16..].copy_from_slice(&chunk_idx.to_le_bytes());
    nonce
}

/// Binds each chunk to its blob ID and index so chunks cannot be reordered or swapped.
pub fn chunk_aad(blob_id: &str, chunk_idx: u64) -> Vec<u8> {
    let mut aad = Vec::with_capacity(blob_id.len() + 16);
    aad.extend_from_slice(b"lockpad-blob-v1:");
    aad.extend_from_slice(blob_id.as_bytes());
    aad.push(b':');
    aad.extend_from_slice(&chunk_idx.to_le_bytes());
    aad
}

/// Atomic file write: writes to a temporary sibling file, flushes to disk, then renames.
pub fn atomic_write(path: &Path, data: &[u8]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create dir: {e}"))?;
    }
    let tmp_name = format!(
        "{}.tmp.{}",
        path.file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("lockpad"),
        uuid::Uuid::new_v4()
    );
    let tmp_path = path.with_file_name(tmp_name);
    {
        let mut f = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&tmp_path)
            .map_err(|e| format!("Failed to open temp file: {e}"))?;
        f.write_all(data)
            .map_err(|e| format!("Failed to write temp file: {e}"))?;
        f.sync_all()
            .map_err(|e| format!("Failed to sync temp file: {e}"))?;
    }
    fs::rename(&tmp_path, path).map_err(|e| {
        let _ = fs::remove_file(&tmp_path);
        format!("Failed to replace target file: {e}")
    })?;
    Ok(())
}

/// Overwrites a file with random bytes and zeros before deleting it from disk.
pub fn shred_file(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let meta = fs::metadata(path).map_err(|e| format!("Metadata error: {e}"))?;
    let len = meta.len();
    if len > 0 {
        let mut file = OpenOptions::new()
            .write(true)
            .open(path)
            .map_err(|e| format!("Open for shred failed: {e}"))?;

        let mut buf = vec![0u8; 64 * 1024];
        // Pass 1: random bytes
        file.seek(SeekFrom::Start(0))
            .map_err(|e| format!("Seek failed: {e}"))?;
        let mut remaining = len;
        while remaining > 0 {
            let n = remaining.min(buf.len() as u64) as usize;
            rand::thread_rng().fill_bytes(&mut buf[..n]);
            file.write_all(&buf[..n])
                .map_err(|e| format!("Shred write failed: {e}"))?;
            remaining -= n as u64;
        }
        let _ = file.sync_all();

        // Pass 2: zeros
        buf.fill(0);
        file.seek(SeekFrom::Start(0))
            .map_err(|e| format!("Seek failed: {e}"))?;
        remaining = len;
        while remaining > 0 {
            let n = remaining.min(buf.len() as u64) as usize;
            file.write_all(&buf[..n])
                .map_err(|e| format!("Shred zero failed: {e}"))?;
            remaining -= n as u64;
        }
        let _ = file.sync_all();
    }
    fs::remove_file(path).map_err(|e| format!("Remove after shred failed: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aead_roundtrip_and_tamper_detection() {
        let salt = random_bytes::<32>();
        let kek = derive_kek("minha-frase-secreta-forte", &salt).unwrap();
        let nonce = random_bytes::<24>();
        let aad = b"lockpad-test-aad";
        let secret = b"Dados altamente secretos no cofre";

        let ct = encrypt_aead(&kek, &nonce, secret, aad).unwrap();
        assert_ne!(ct.as_slice(), secret);

        let pt = decrypt_aead(&kek, &nonce, &ct, aad).unwrap();
        assert_eq!(pt.as_slice(), secret);

        // Wrong passphrase fails
        let wrong_kek = derive_kek("outra-frase", &salt).unwrap();
        assert!(decrypt_aead(&wrong_kek, &nonce, &ct, aad).is_err());

        // Wrong AAD fails
        assert!(decrypt_aead(&kek, &nonce, &ct, b"wrong-aad").is_err());

        // Tampered ciphertext fails
        let mut tampered = ct.clone();
        tampered[0] ^= 0xFF;
        assert!(decrypt_aead(&kek, &nonce, &tampered, aad).is_err());
    }

    #[test]
    fn chunk_nonce_and_aad_are_unique_per_index() {
        let prefix = random_bytes::<16>();
        let n0 = chunk_nonce(&prefix, 0);
        let n1 = chunk_nonce(&prefix, 1);
        assert_ne!(n0, n1);
        assert_ne!(chunk_aad("blob-1", 0), chunk_aad("blob-1", 1));
        assert_ne!(chunk_aad("blob-1", 0), chunk_aad("blob-2", 0));
    }

    #[test]
    fn shred_file_overwrites_and_deletes() {
        let dir = std::env::temp_dir().join(format!("lockpad_test_{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("secret.bin");
        fs::write(&file, b"sensitive data 1234567890").unwrap();
        shred_file(&file).unwrap();
        assert!(!file.exists());
        let _ = fs::remove_dir_all(&dir);
    }
}
