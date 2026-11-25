use crate::crypto::{
    atomic_write, chunk_aad, chunk_nonce, decrypt_aead, derive_kek, encrypt_aead, random_bytes,
    shred_file, CHUNK_SIZE, POLY1305_TAG_LEN,
};
use crate::models::{
    AppPreferences, PublicStore, StickyNote, VaultFile, VaultFolder, VaultManifest, VaultMeta,
    VaultStatus,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chrono::Utc;
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Instant;
use uuid::Uuid;
use walkdir::WalkDir;
use zeroize::Zeroizing;

const VERIFIER_MAGIC: &[u8] = b"LOCKPAD_VAULT_VERIFIED_V1";
const AAD_DEK: &[u8] = b"lockpad-v1-dek";
const AAD_VERIFIER: &[u8] = b"lockpad-v1-verifier";
const AAD_MANIFEST: &[u8] = b"lockpad-v1-manifest";

pub struct VaultInner {
    pub data_dir: PathBuf,
    pub dek: Option<Zeroizing<[u8; 32]>>,
    pub manifest: Option<VaultManifest>,
    pub last_activity: Instant,
    pub last_stealth_attempt: Option<Instant>,
    pub screen_protect_active: bool,
}

pub struct VaultManager {
    pub inner: Mutex<VaultInner>,
}

impl VaultManager {
    pub fn new(data_dir: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&data_dir).map_err(|e| format!("Failed to create data dir: {e}"))?;
        Ok(Self {
            inner: Mutex::new(VaultInner {
                data_dir,
                dek: None,
                manifest: None,
                last_activity: Instant::now(),
                last_stealth_attempt: None,
                screen_protect_active: false,
            }),
        })
    }

    pub fn vault_dir(data_dir: &Path) -> PathBuf {
        data_dir.join("vault")
    }

    pub fn meta_path(data_dir: &Path) -> PathBuf {
        Self::vault_dir(data_dir).join("vault.meta")
    }

    pub fn manifest_path(data_dir: &Path) -> PathBuf {
        Self::vault_dir(data_dir).join("manifest.enc")
    }

    pub fn blobs_dir(data_dir: &Path) -> PathBuf {
        Self::vault_dir(data_dir).join("blobs")
    }

    pub fn public_store_path(data_dir: &Path) -> PathBuf {
        data_dir.join("public_notes.json")
    }

    pub fn load_public_store(data_dir: &Path) -> Result<PublicStore, String> {
        let path = Self::public_store_path(data_dir);
        if !path.exists() {
            let default_store = PublicStore {
                notes: vec![StickyNote {
                    id: Uuid::new_v4().to_string(),
                    title: "Bem-vindo ao LockPad".to_string(),
                    content: "Suas anotações rápidas ficam aqui.\n\nDica: configure sua frase-chave nas Configurações para desbloquear seu cofre criptografado digitando a frase direto em uma nota."
                        .to_string(),
                    color: "indigo".to_string(),
                    background_image: None,
                    font_size: None,
                    font_family: None,
                    is_checklist: false,
                    checklist: vec![],
                    pinned: false,
                    created_at: Utc::now().to_rfc3339(),
                    updated_at: Utc::now().to_rfc3339(),
                }],
                preferences: AppPreferences::default(),
            };
            let bytes = serde_json::to_vec_pretty(&default_store)
                .map_err(|e| format!("Serialize error: {e}"))?;
            atomic_write(&path, &bytes)?;
            return Ok(default_store);
        }
        let raw = fs::read(&path).map_err(|e| format!("Read public store failed: {e}"))?;
        serde_json::from_slice(&raw).map_err(|e| format!("Invalid public store JSON: {e}"))
    }

    pub fn save_public_store(data_dir: &Path, store: &PublicStore) -> Result<(), String> {
        let bytes =
            serde_json::to_vec_pretty(store).map_err(|e| format!("Serialize error: {e}"))?;
        atomic_write(&Self::public_store_path(data_dir), &bytes)
    }

    fn load_meta(data_dir: &Path) -> Result<Option<VaultMeta>, String> {
        let path = Self::meta_path(data_dir);
        if !path.exists() {
            return Ok(None);
        }
        let raw = fs::read(&path).map_err(|e| format!("Read vault.meta failed: {e}"))?;
        let meta: VaultMeta =
            serde_json::from_slice(&raw).map_err(|e| format!("Corrupted vault.meta: {e}"))?;
        Ok(Some(meta))
    }

    fn save_meta(data_dir: &Path, meta: &VaultMeta) -> Result<(), String> {
        let bytes =
            serde_json::to_vec_pretty(meta).map_err(|e| format!("Serialize meta error: {e}"))?;
        atomic_write(&Self::meta_path(data_dir), &bytes)
    }

    fn save_manifest(
        data_dir: &Path,
        dek: &[u8; 32],
        manifest: &VaultManifest,
    ) -> Result<(), String> {
        let plaintext = Zeroizing::new(
            serde_json::to_vec(manifest).map_err(|e| format!("Serialize manifest error: {e}"))?,
        );
        let nonce = random_bytes::<24>();
        let ciphertext = encrypt_aead(dek, &nonce, &plaintext, AAD_MANIFEST)?;
        let mut payload = Vec::with_capacity(24 + ciphertext.len());
        payload.extend_from_slice(&nonce);
        payload.extend_from_slice(&ciphertext);
        atomic_write(&Self::manifest_path(data_dir), &payload)
    }

    fn load_manifest(data_dir: &Path, dek: &[u8; 32]) -> Result<VaultManifest, String> {
        let path = Self::manifest_path(data_dir);
        let raw = fs::read(&path).map_err(|e| format!("Read manifest failed: {e}"))?;
        if raw.len() < 24 + POLY1305_TAG_LEN {
            return Err("Corrupted encrypted manifest".to_string());
        }
        let nonce: [u8; 24] = raw[..24]
            .try_into()
            .map_err(|_| "Invalid nonce length".to_string())?;
        let pt = decrypt_aead(dek, &nonce, &raw[24..], AAD_MANIFEST)?;
        serde_json::from_slice(&pt).map_err(|e| format!("Manifest decode error: {e}"))
    }

    pub fn status(&self) -> Result<VaultStatus, String> {
        let guard = self.inner.lock().map_err(|_| "Lock poisoned".to_string())?;
        let meta = Self::load_meta(&guard.data_dir)?;
        let now = Utc::now().timestamp();
        let (exists, failed_attempts, lockout_remaining_secs) = match &meta {
            Some(m) => (true, m.failed_attempts, (m.lockout_until - now).max(0)),
            None => (false, 0, 0),
        };
        let unlocked = guard.dek.is_some() && guard.manifest.is_some();
        Ok(VaultStatus {
            exists,
            unlocked,
            failed_attempts,
            lockout_remaining_secs,
            screen_protect_active: guard.screen_protect_active,
            note_count: guard.manifest.as_ref().map(|m| m.notes.len()),
            file_count: guard.manifest.as_ref().map(|m| m.files.len()),
            folder_count: guard.manifest.as_ref().map(|m| m.folders.len()),
        })
    }

    pub fn setup_vault(&self, passphrase: &str) -> Result<VaultStatus, String> {
        if passphrase.trim().len() < 4 {
            return Err("A frase-chave deve ter pelo menos 4 caracteres.".to_string());
        }
        let mut guard = self.inner.lock().map_err(|_| "Lock poisoned".to_string())?;
        if Self::meta_path(&guard.data_dir).exists() {
            return Err("O cofre já está configurado.".to_string());
        }

        fs::create_dir_all(Self::blobs_dir(&guard.data_dir))
            .map_err(|e| format!("Create blobs dir failed: {e}"))?;

        let salt = random_bytes::<32>();
        let kek = derive_kek(passphrase, &salt)?;
        let dek = Zeroizing::new(random_bytes::<32>());

        let wrapped_dek_nonce = random_bytes::<24>();
        let wrapped_dek = encrypt_aead(&kek, &wrapped_dek_nonce, &*dek, AAD_DEK)?;

        let verifier_nonce = random_bytes::<24>();
        let verifier = encrypt_aead(&dek, &verifier_nonce, VERIFIER_MAGIC, AAD_VERIFIER)?;

        let meta = VaultMeta {
            version: 1,
            salt: B64.encode(salt),
            wrapped_dek_nonce: B64.encode(wrapped_dek_nonce),
            wrapped_dek: B64.encode(wrapped_dek),
            verifier_nonce: B64.encode(verifier_nonce),
            verifier: B64.encode(verifier),
            failed_attempts: 0,
            lockout_until: 0,
        };

        let initial_manifest = VaultManifest {
            notes: vec![StickyNote {
                id: Uuid::new_v4().to_string(),
                title: "Cofre Seguro Ativado".to_string(),
                content: "Este espaço é protegido com Argon2id + XChaCha20-Poly1305.\n\nVocê pode escrever notas privadas, arrastar imagens, vídeos e pastas inteiras para cá. Tudo é criptografado localmente antes de tocar o disco."
                    .to_string(),
                color: "emerald".to_string(),
                background_image: None,
                font_size: None,
                font_family: None,
                is_checklist: false,
                checklist: vec![],
                pinned: true,
                created_at: Utc::now().to_rfc3339(),
                updated_at: Utc::now().to_rfc3339(),
            }],
            folders: vec![],
            files: vec![],
        };

        Self::save_meta(&guard.data_dir, &meta)?;
        Self::save_manifest(&guard.data_dir, &dek, &initial_manifest)?;

        guard.dek = Some(dek);
        guard.manifest = Some(initial_manifest);
        guard.last_activity = Instant::now();

        drop(guard);
        self.status()
    }

    pub fn verify_passphrase_only(data_dir: &Path, passphrase: &str) -> Result<Zeroizing<[u8; 32]>, String> {
        let mut meta = Self::load_meta(data_dir)?
            .ok_or_else(|| "Cofre ainda não configurado.".to_string())?;

        let now = Utc::now().timestamp();
        if meta.lockout_until > now {
            let wait = meta.lockout_until - now;
            return Err(format!(
                "Muitas tentativas incorretas. Aguarde {wait}s antes de tentar novamente."
            ));
        }

        let salt_vec = B64
            .decode(&meta.salt)
            .map_err(|_| "Corrupted salt".to_string())?;
        let salt: [u8; 32] = salt_vec
            .try_into()
            .map_err(|_| "Invalid salt length".to_string())?;

        let kek = derive_kek(passphrase, &salt)?;

        let wrapped_nonce_vec = B64
            .decode(&meta.wrapped_dek_nonce)
            .map_err(|_| "Corrupted nonce".to_string())?;
        let wrapped_nonce: [u8; 24] = wrapped_nonce_vec
            .try_into()
            .map_err(|_| "Invalid nonce length".to_string())?;
        let wrapped_dek = B64
            .decode(&meta.wrapped_dek)
            .map_err(|_| "Corrupted wrapped DEK".to_string())?;

        let dek_vec = match decrypt_aead(&kek, &wrapped_nonce, &wrapped_dek, AAD_DEK) {
            Ok(v) => v,
            Err(_) => {
                meta.failed_attempts = meta.failed_attempts.saturating_add(1);
                if meta.failed_attempts >= 5 {
                    let exponent = (meta.failed_attempts - 5).min(6);
                    let delay = 5_i64 * (1_i64 << exponent);
                    meta.lockout_until = now + delay;
                }
                let _ = Self::save_meta(data_dir, &meta);
                return Err("Frase-chave incorreta.".to_string());
            }
        };

        let dek_arr: [u8; 32] = dek_vec
            .as_slice()
            .try_into()
            .map_err(|_| "Invalid DEK length".to_string())?;
        let dek = Zeroizing::new(dek_arr);

        let verifier_nonce_vec = B64
            .decode(&meta.verifier_nonce)
            .map_err(|_| "Corrupted verifier nonce".to_string())?;
        let verifier_nonce: [u8; 24] = verifier_nonce_vec
            .try_into()
            .map_err(|_| "Invalid verifier nonce length".to_string())?;
        let verifier_ct = B64
            .decode(&meta.verifier)
            .map_err(|_| "Corrupted verifier".to_string())?;

        let verifier_pt = decrypt_aead(&dek, &verifier_nonce, &verifier_ct, AAD_VERIFIER)
            .map_err(|_| "Falha na verificação de integridade do cofre.".to_string())?;
        if verifier_pt.as_slice() != VERIFIER_MAGIC {
            return Err("Falha na verificação criptográfica.".to_string());
        }

        if meta.failed_attempts > 0 || meta.lockout_until > 0 {
            meta.failed_attempts = 0;
            meta.lockout_until = 0;
            let _ = Self::save_meta(data_dir, &meta);
        }

        Ok(dek)
    }

    pub fn try_unlock(&self, passphrase: &str) -> Result<bool, String> {
        let data_dir = {
            let guard = self.inner.lock().map_err(|_| "Lock poisoned".to_string())?;
            if !Self::meta_path(&guard.data_dir).exists() {
                return Ok(false);
            }
            guard.data_dir.clone()
        };

        let dek = match Self::verify_passphrase_only(&data_dir, passphrase) {
            Ok(d) => d,
            Err(e) => return Err(e),
        };

        let manifest = Self::load_manifest(&data_dir, &dek)?;
        let mut guard = self.inner.lock().map_err(|_| "Lock poisoned".to_string())?;
        guard.dek = Some(dek);
        guard.manifest = Some(manifest);
        guard.last_activity = Instant::now();
        Ok(true)
    }

    /// Silent check used by the stealth sticky-note trigger: does NOT increment failed_attempts
    /// when a user is just typing normal notes! Only checks if the vault exists and whether the
    /// candidate matches.
    pub fn stealth_check_and_unlock(&self, candidate: &str) -> Result<bool, String> {
        if candidate.trim().len() < 4 {
            return Ok(false);
        }
        let data_dir = {
            let mut guard = self.inner.lock().map_err(|_| "Lock poisoned".to_string())?;
            if guard.dek.is_some() {
                return Ok(false);
            }
            if let Some(prev) = guard.last_stealth_attempt {
                if prev.elapsed().as_millis() < 120 {
                    return Ok(false);
                }
            }
            guard.last_stealth_attempt = Some(Instant::now());
            if !Self::meta_path(&guard.data_dir).exists() {
                return Ok(false);
            }
            guard.data_dir.clone()
        };

        let meta = match Self::load_meta(&data_dir)? {
            Some(m) => m,
            None => return Ok(false),
        };
        let now = Utc::now().timestamp();
        if meta.lockout_until > now {
            return Ok(false);
        }

        let salt_vec = B64
            .decode(&meta.salt)
            .map_err(|_| "Corrupted salt".to_string())?;
        let salt: [u8; 32] = salt_vec
            .try_into()
            .map_err(|_| "Invalid salt length".to_string())?;
        let kek = derive_kek(candidate, &salt)?;

        let wrapped_nonce_vec = B64
            .decode(&meta.wrapped_dek_nonce)
            .map_err(|_| "Corrupted nonce".to_string())?;
        let wrapped_nonce: [u8; 24] = wrapped_nonce_vec
            .try_into()
            .map_err(|_| "Invalid nonce length".to_string())?;
        let wrapped_dek = B64
            .decode(&meta.wrapped_dek)
            .map_err(|_| "Corrupted wrapped DEK".to_string())?;

        let Ok(dek_vec) = decrypt_aead(&kek, &wrapped_nonce, &wrapped_dek, AAD_DEK) else {
            return Ok(false);
        };
        let dek_arr: [u8; 32] = dek_vec
            .as_slice()
            .try_into()
            .map_err(|_| "Invalid DEK length".to_string())?;
        let dek = Zeroizing::new(dek_arr);

        let verifier_nonce_vec = B64
            .decode(&meta.verifier_nonce)
            .map_err(|_| "Corrupted verifier nonce".to_string())?;
        let verifier_nonce: [u8; 24] = verifier_nonce_vec
            .try_into()
            .map_err(|_| "Invalid verifier nonce".to_string())?;
        let verifier_ct = B64
            .decode(&meta.verifier)
            .map_err(|_| "Corrupted verifier".to_string())?;

        let Ok(verifier_pt) = decrypt_aead(&dek, &verifier_nonce, &verifier_ct, AAD_VERIFIER) else {
            return Ok(false);
        };
        if verifier_pt.as_slice() != VERIFIER_MAGIC {
            return Ok(false);
        }

        let manifest = Self::load_manifest(&data_dir, &dek)?;
        let mut guard = self.inner.lock().map_err(|_| "Lock poisoned".to_string())?;
        guard.dek = Some(dek);
        guard.manifest = Some(manifest);
        guard.last_activity = Instant::now();
        Ok(true)
    }

    pub fn lock(&self) {
        if let Ok(mut guard) = self.inner.lock() {
            guard.dek = None;
            guard.manifest = None;
        }
    }

    pub fn touch_activity(&self) {
        if let Ok(mut guard) = self.inner.lock() {
            guard.last_activity = Instant::now();
        }
    }

    pub fn change_passphrase(&self, current: &str, new_pass: &str) -> Result<(), String> {
        if new_pass.trim().len() < 4 {
            return Err("A nova frase-chave deve ter pelo menos 4 caracteres.".to_string());
        }
        let data_dir = {
            let guard = self.inner.lock().map_err(|_| "Lock poisoned".to_string())?;
            guard.data_dir.clone()
        };

        let dek = Self::verify_passphrase_only(&data_dir, current)?;
        let new_salt = random_bytes::<32>();
        let new_kek = derive_kek(new_pass, &new_salt)?;
        let new_wrapped_nonce = random_bytes::<24>();
        let new_wrapped_dek = encrypt_aead(&new_kek, &new_wrapped_nonce, &*dek, AAD_DEK)?;
        let new_verifier_nonce = random_bytes::<24>();
        let new_verifier = encrypt_aead(&dek, &new_verifier_nonce, VERIFIER_MAGIC, AAD_VERIFIER)?;

        let meta = VaultMeta {
            version: 1,
            salt: B64.encode(new_salt),
            wrapped_dek_nonce: B64.encode(new_wrapped_nonce),
            wrapped_dek: B64.encode(new_wrapped_dek),
            verifier_nonce: B64.encode(new_verifier_nonce),
            verifier: B64.encode(new_verifier),
            failed_attempts: 0,
            lockout_until: 0,
        };
        Self::save_meta(&data_dir, &meta)?;
        Ok(())
    }

    pub fn get_manifest(&self) -> Result<VaultManifest, String> {
        let mut guard = self.inner.lock().map_err(|_| "Lock poisoned".to_string())?;
        guard.last_activity = Instant::now();
        guard
            .manifest
            .clone()
            .ok_or_else(|| "Cofre bloqueado.".to_string())
    }

    pub fn save_notes(&self, notes: Vec<StickyNote>) -> Result<VaultManifest, String> {
        let mut guard = self.inner.lock().map_err(|_| "Lock poisoned".to_string())?;
        let data_dir = guard.data_dir.clone();
        let dek = guard
            .dek
            .as_ref()
            .ok_or_else(|| "Cofre bloqueado.".to_string())?
            .clone();
        let manifest = guard
            .manifest
            .as_mut()
            .ok_or_else(|| "Cofre bloqueado.".to_string())?;
        manifest.notes = notes;
        let updated = manifest.clone();
        Self::save_manifest(&data_dir, &dek, &updated)?;
        guard.last_activity = Instant::now();
        Ok(updated)
    }

    pub fn create_folder(&self, parent_id: Option<String>, name: String) -> Result<VaultManifest, String> {
        let trimmed = name.trim().to_string();
        if trimmed.is_empty() {
            return Err("Nome da pasta não pode ser vazio.".to_string());
        }
        let mut guard = self.inner.lock().map_err(|_| "Lock poisoned".to_string())?;
        let data_dir = guard.data_dir.clone();
        let dek = guard
            .dek
            .as_ref()
            .ok_or_else(|| "Cofre bloqueado.".to_string())?
            .clone();
        let manifest = guard
            .manifest
            .as_mut()
            .ok_or_else(|| "Cofre bloqueado.".to_string())?;
        manifest.folders.push(VaultFolder {
            id: Uuid::new_v4().to_string(),
            parent_id,
            name: trimmed,
            created_at: Utc::now().to_rfc3339(),
        });
        let updated = manifest.clone();
        Self::save_manifest(&data_dir, &dek, &updated)?;
        guard.last_activity = Instant::now();
        Ok(updated)
    }

    pub fn rename_folder(&self, folder_id: &str, name: String) -> Result<VaultManifest, String> {
        let trimmed = name.trim().to_string();
        if trimmed.is_empty() {
            return Err("Nome da pasta não pode ser vazio.".to_string());
        }
        let mut guard = self.inner.lock().map_err(|_| "Lock poisoned".to_string())?;
        let data_dir = guard.data_dir.clone();
        let dek = guard
            .dek
            .as_ref()
            .ok_or_else(|| "Cofre bloqueado.".to_string())?
            .clone();
        let manifest = guard
            .manifest
            .as_mut()
            .ok_or_else(|| "Cofre bloqueado.".to_string())?;
        if let Some(folder) = manifest.folders.iter_mut().find(|f| f.id == folder_id) {
            folder.name = trimmed;
        } else {
            return Err("Pasta não encontrada.".to_string());
        }
        let updated = manifest.clone();
        Self::save_manifest(&data_dir, &dek, &updated)?;
        guard.last_activity = Instant::now();
        Ok(updated)
    }

    fn encrypt_stream_to_blob<R: Read>(
        data_dir: &Path,
        dek: &[u8; 32],
        mut reader: R,
        name: String,
        mime_type: String,
        folder_id: Option<String>,
    ) -> Result<VaultFile, String> {
        let blobs_dir = Self::blobs_dir(data_dir);
        fs::create_dir_all(&blobs_dir).map_err(|e| format!("Create blobs dir failed: {e}"))?;

        let blob_id = Uuid::new_v4().to_string();
        let blob_path = blobs_dir.join(format!("{blob_id}.lpb"));
        let prefix = random_bytes::<16>();

        let mut out = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&blob_path)
            .map_err(|e| format!("Failed to create blob: {e}"))?;

        let mut buf = Zeroizing::new(vec![0u8; CHUNK_SIZE]);
        let mut chunk_idx: u64 = 0;
        let mut total_bytes: u64 = 0;

        loop {
            let mut filled = 0;
            while filled < CHUNK_SIZE {
                let n = reader
                    .read(&mut buf[filled..])
                    .map_err(|e| format!("Read input failed: {e}"))?;
                if n == 0 {
                    break;
                }
                filled += n;
            }
            if filled == 0 {
                break;
            }

            let nonce = chunk_nonce(&prefix, chunk_idx);
            let aad = chunk_aad(&blob_id, chunk_idx);
            let ct = encrypt_aead(dek, &nonce, &buf[..filled], &aad)?;
            out.write_all(&ct)
                .map_err(|e| format!("Write blob failed: {e}"))?;

            total_bytes += filled as u64;
            chunk_idx += 1;
        }
        out.sync_all().map_err(|e| format!("Sync blob failed: {e}"))?;

        let kind = classify_mime(&mime_type, &name);
        Ok(VaultFile {
            id: Uuid::new_v4().to_string(),
            folder_id,
            name,
            mime_type,
            kind,
            size_bytes: total_bytes,
            blob_id,
            chunk_size: CHUNK_SIZE,
            nonce_prefix: B64.encode(prefix),
            created_at: Utc::now().to_rfc3339(),
        })
    }

    pub fn import_paths(
        &self,
        paths: Vec<String>,
        target_folder_id: Option<String>,
    ) -> Result<VaultManifest, String> {
        let (data_dir, dek) = {
            let guard = self.inner.lock().map_err(|_| "Lock poisoned".to_string())?;
            let dek = guard
                .dek
                .as_ref()
                .ok_or_else(|| "Cofre bloqueado.".to_string())?
                .clone();
            (guard.data_dir.clone(), dek)
        };

        let mut new_folders: Vec<VaultFolder> = Vec::new();
        let mut new_files: Vec<VaultFile> = Vec::new();

        for raw_path in paths {
            let p = PathBuf::from(&raw_path);
            if !p.exists() {
                continue;
            }
            if p.is_file() {
                let name = p
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("arquivo")
                    .to_string();
                let mime = mime_guess::from_path(&p)
                    .first_or_octet_stream()
                    .essence_str()
                    .to_string();
                let file = File::open(&p).map_err(|e| format!("Open file failed: {e}"))?;
                let vf = Self::encrypt_stream_to_blob(
                    &data_dir,
                    &dek,
                    file,
                    name,
                    mime,
                    target_folder_id.clone(),
                )?;
                new_files.push(vf);
            } else if p.is_dir() {
                let root_name = p
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Pasta")
                    .to_string();
                let root_folder_id = Uuid::new_v4().to_string();
                new_folders.push(VaultFolder {
                    id: root_folder_id.clone(),
                    parent_id: target_folder_id.clone(),
                    name: root_name,
                    created_at: Utc::now().to_rfc3339(),
                });

                let mut dir_map: HashMap<PathBuf, String> = HashMap::new();
                dir_map.insert(p.clone(), root_folder_id);

                for entry in WalkDir::new(&p).into_iter().filter_map(Result::ok) {
                    let ep = entry.path().to_path_buf();
                    if ep == p {
                        continue;
                    }
                    let parent_id = ep
                        .parent()
                        .and_then(|par| dir_map.get(par))
                        .cloned()
                        .or_else(|| dir_map.get(&p).cloned());

                    if entry.file_type().is_dir() {
                        let fid = Uuid::new_v4().to_string();
                        let fname = ep
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("Subpasta")
                            .to_string();
                        new_folders.push(VaultFolder {
                            id: fid.clone(),
                            parent_id,
                            name: fname,
                            created_at: Utc::now().to_rfc3339(),
                        });
                        dir_map.insert(ep, fid);
                    } else if entry.file_type().is_file() {
                        let name = ep
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or("arquivo")
                            .to_string();
                        let mime = mime_guess::from_path(&ep)
                            .first_or_octet_stream()
                            .essence_str()
                            .to_string();
                        let file = File::open(&ep).map_err(|e| format!("Open file failed: {e}"))?;
                        let vf =
                            Self::encrypt_stream_to_blob(&data_dir, &dek, file, name, mime, parent_id)?;
                        new_files.push(vf);
                    }
                }
            }
        }

        let mut guard = self.inner.lock().map_err(|_| "Lock poisoned".to_string())?;
        let manifest = guard
            .manifest
            .as_mut()
            .ok_or_else(|| "Cofre bloqueado.".to_string())?;
        manifest.folders.extend(new_folders);
        manifest.files.extend(new_files);
        let updated = manifest.clone();
        Self::save_manifest(&data_dir, &dek, &updated)?;
        guard.last_activity = Instant::now();
        Ok(updated)
    }

    pub fn import_bytes(
        &self,
        name: String,
        mime_type: String,
        bytes: Vec<u8>,
        folder_id: Option<String>,
    ) -> Result<VaultManifest, String> {
        let (data_dir, dek) = {
            let guard = self.inner.lock().map_err(|_| "Lock poisoned".to_string())?;
            let dek = guard
                .dek
                .as_ref()
                .ok_or_else(|| "Cofre bloqueado.".to_string())?
                .clone();
            (guard.data_dir.clone(), dek)
        };
        let clean_bytes = Zeroizing::new(bytes);
        let vf = Self::encrypt_stream_to_blob(
            &data_dir,
            &dek,
            clean_bytes.as_slice(),
            name,
            mime_type,
            folder_id,
        )?;
        let mut guard = self.inner.lock().map_err(|_| "Lock poisoned".to_string())?;
        let manifest = guard
            .manifest
            .as_mut()
            .ok_or_else(|| "Cofre bloqueado.".to_string())?;
        manifest.files.push(vf);
        let updated = manifest.clone();
        Self::save_manifest(&data_dir, &dek, &updated)?;
        guard.last_activity = Instant::now();
        Ok(updated)
    }

    pub fn delete_file(&self, file_id: &str) -> Result<VaultManifest, String> {
        let mut guard = self.inner.lock().map_err(|_| "Lock poisoned".to_string())?;
        let data_dir = guard.data_dir.clone();
        let dek = guard
            .dek
            .as_ref()
            .ok_or_else(|| "Cofre bloqueado.".to_string())?
            .clone();
        let manifest = guard
            .manifest
            .as_mut()
            .ok_or_else(|| "Cofre bloqueado.".to_string())?;
        let idx = manifest
            .files
            .iter()
            .position(|f| f.id == file_id)
            .ok_or_else(|| "Arquivo não encontrado.".to_string())?;
        let removed = manifest.files.remove(idx);
        let blob_path = Self::blobs_dir(&data_dir).join(format!("{}.lpb", removed.blob_id));
        shred_file(&blob_path)?;
        let updated = manifest.clone();
        Self::save_manifest(&data_dir, &dek, &updated)?;
        guard.last_activity = Instant::now();
        Ok(updated)
    }

    pub fn delete_folder(&self, folder_id: &str) -> Result<VaultManifest, String> {
        let mut guard = self.inner.lock().map_err(|_| "Lock poisoned".to_string())?;
        let data_dir = guard.data_dir.clone();
        let dek = guard
            .dek
            .as_ref()
            .ok_or_else(|| "Cofre bloqueado.".to_string())?
            .clone();
        let manifest = guard
            .manifest
            .as_mut()
            .ok_or_else(|| "Cofre bloqueado.".to_string())?;

        // Collect folder_id and all nested descendant folder IDs
        let mut target_folders = vec![folder_id.to_string()];
        let mut changed = true;
        while changed {
            changed = false;
            for f in &manifest.folders {
                if let Some(pid) = &f.parent_id {
                    if target_folders.contains(pid) && !target_folders.contains(&f.id) {
                        target_folders.push(f.id.clone());
                        changed = true;
                    }
                }
            }
        }

        let mut blobs_to_shred = Vec::new();
        manifest.files.retain(|file| {
            if let Some(fid) = &file.folder_id {
                if target_folders.contains(fid) {
                    blobs_to_shred.push(file.blob_id.clone());
                    return false;
                }
            }
            true
        });
        manifest.folders.retain(|f| !target_folders.contains(&f.id));

        for blob_id in blobs_to_shred {
            let blob_path = Self::blobs_dir(&data_dir).join(format!("{blob_id}.lpb"));
            shred_file(&blob_path)?;
        }

        let updated = manifest.clone();
        Self::save_manifest(&data_dir, &dek, &updated)?;
        guard.last_activity = Instant::now();
        Ok(updated)
    }

    /// Reads an arbitrary plaintext byte range [start..=end] from an encrypted blob in RAM.
    pub fn read_blob_range(
        &self,
        file_id: &str,
        start: u64,
        end_inclusive: u64,
    ) -> Result<(String, u64, Vec<u8>), String> {
        let (data_dir, dek, file_meta) = {
            let mut guard = self.inner.lock().map_err(|_| "Lock poisoned".to_string())?;
            guard.last_activity = Instant::now();
            let dek = guard
                .dek
                .as_ref()
                .ok_or_else(|| "Cofre bloqueado.".to_string())?
                .clone();
            let manifest = guard
                .manifest
                .as_ref()
                .ok_or_else(|| "Cofre bloqueado.".to_string())?;
            let vf = manifest
                .files
                .iter()
                .find(|f| f.id == file_id)
                .cloned()
                .ok_or_else(|| "Arquivo não encontrado.".to_string())?;
            (guard.data_dir.clone(), dek, vf)
        };

        if file_meta.size_bytes == 0 {
            return Ok((file_meta.mime_type, 0, Vec::new()));
        }

        let clamped_end = end_inclusive.min(file_meta.size_bytes - 1);
        if start > clamped_end {
            return Err("Range out of bounds".to_string());
        }

        let chunk_size = file_meta.chunk_size as u64;
        let prefix_vec = B64
            .decode(&file_meta.nonce_prefix)
            .map_err(|_| "Invalid nonce prefix".to_string())?;
        let prefix: [u8; 16] = prefix_vec
            .try_into()
            .map_err(|_| "Invalid nonce prefix len".to_string())?;

        let blob_path = Self::blobs_dir(&data_dir).join(format!("{}.lpb", file_meta.blob_id));
        let mut f = File::open(&blob_path).map_err(|e| format!("Open blob failed: {e}"))?;

        let first_chunk = start / chunk_size;
        let last_chunk = clamped_end / chunk_size;
        let out_cap = (clamped_end - start + 1) as usize;
        let mut out = Vec::with_capacity(out_cap);

        let disk_stride = chunk_size + POLY1305_TAG_LEN as u64;

        for idx in first_chunk..=last_chunk {
            let chunk_pt_start = idx * chunk_size;
            let chunk_pt_len = (file_meta.size_bytes - chunk_pt_start).min(chunk_size);
            let disk_offset = idx * disk_stride;
            let disk_len = (chunk_pt_len as usize) + POLY1305_TAG_LEN;

            f.seek(SeekFrom::Start(disk_offset))
                .map_err(|e| format!("Seek blob failed: {e}"))?;
            let mut ct_buf = vec![0u8; disk_len];
            f.read_exact(&mut ct_buf)
                .map_err(|e| format!("Read blob chunk failed: {e}"))?;

            let nonce = chunk_nonce(&prefix, idx);
            let aad = chunk_aad(&file_meta.blob_id, idx);
            let pt_chunk = decrypt_aead(&dek, &nonce, &ct_buf, &aad)?;

            let slice_start = if idx == first_chunk {
                (start % chunk_size) as usize
            } else {
                0
            };
            let slice_end = if idx == last_chunk {
                ((clamped_end % chunk_size) as usize) + 1
            } else {
                pt_chunk.len()
            };
            out.extend_from_slice(&pt_chunk[slice_start..slice_end]);
        }

        Ok((file_meta.mime_type, file_meta.size_bytes, out))
    }

    pub fn export_file_to_dir(&self, file_id: &str, dest_dir: &str) -> Result<String, String> {
        let (data_dir, dek, vf) = {
            let guard = self.inner.lock().map_err(|_| "Lock poisoned".to_string())?;
            let dek = guard
                .dek
                .as_ref()
                .ok_or_else(|| "Cofre bloqueado.".to_string())?
                .clone();
            let manifest = guard
                .manifest
                .as_ref()
                .ok_or_else(|| "Cofre bloqueado.".to_string())?;
            let vf = manifest
                .files
                .iter()
                .find(|f| f.id == file_id)
                .cloned()
                .ok_or_else(|| "Arquivo não encontrado.".to_string())?;
            (guard.data_dir.clone(), dek, vf)
        };

        let target_path = PathBuf::from(dest_dir).join(sanitize_filename(&vf.name));
        Self::decrypt_blob_to_path(&data_dir, &dek, &vf, &target_path)?;
        Ok(target_path.to_string_lossy().to_string())
    }

    pub fn export_folder_to_dir(&self, folder_id: &str, dest_dir: &str) -> Result<String, String> {
        let (data_dir, dek, manifest) = {
            let guard = self.inner.lock().map_err(|_| "Lock poisoned".to_string())?;
            let dek = guard
                .dek
                .as_ref()
                .ok_or_else(|| "Cofre bloqueado.".to_string())?
                .clone();
            let manifest = guard
                .manifest
                .as_ref()
                .ok_or_else(|| "Cofre bloqueado.".to_string())?
                .clone();
            (guard.data_dir.clone(), dek, manifest)
        };

        let root_folder = manifest
            .folders
            .iter()
            .find(|f| f.id == folder_id)
            .ok_or_else(|| "Pasta não encontrada.".to_string())?;

        let root_dest = PathBuf::from(dest_dir).join(sanitize_filename(&root_folder.name));
        fs::create_dir_all(&root_dest).map_err(|e| format!("Create export dir failed: {e}"))?;

        let mut folder_paths: HashMap<String, PathBuf> = HashMap::new();
        folder_paths.insert(root_folder.id.clone(), root_dest.clone());

        let mut progress = true;
        while progress {
            progress = false;
            for f in &manifest.folders {
                if folder_paths.contains_key(&f.id) {
                    continue;
                }
                if let Some(pid) = &f.parent_id {
                    if let Some(parent_path) = folder_paths.get(pid).cloned() {
                        let this_path = parent_path.join(sanitize_filename(&f.name));
                        fs::create_dir_all(&this_path)
                            .map_err(|e| format!("Create subfolder failed: {e}"))?;
                        folder_paths.insert(f.id.clone(), this_path);
                        progress = true;
                    }
                }
            }
        }

        for file in &manifest.files {
            if let Some(fid) = &file.folder_id {
                if let Some(dir_path) = folder_paths.get(fid) {
                    let out_path = dir_path.join(sanitize_filename(&file.name));
                    Self::decrypt_blob_to_path(&data_dir, &dek, file, &out_path)?;
                }
            }
        }

        Ok(root_dest.to_string_lossy().to_string())
    }

    fn decrypt_blob_to_path(
        data_dir: &Path,
        dek: &[u8; 32],
        vf: &VaultFile,
        dest: &Path,
    ) -> Result<(), String> {
        let mut out = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(dest)
            .map_err(|e| format!("Create output file failed: {e}"))?;

        if vf.size_bytes == 0 {
            return Ok(());
        }

        let prefix_vec = B64
            .decode(&vf.nonce_prefix)
            .map_err(|_| "Invalid nonce prefix".to_string())?;
        let prefix: [u8; 16] = prefix_vec
            .try_into()
            .map_err(|_| "Invalid nonce prefix len".to_string())?;

        let blob_path = Self::blobs_dir(data_dir).join(format!("{}.lpb", vf.blob_id));
        let mut f = File::open(&blob_path).map_err(|e| format!("Open blob failed: {e}"))?;

        let chunk_size = vf.chunk_size as u64;
        let total_chunks = vf.size_bytes.div_ceil(chunk_size);
        for idx in 0..total_chunks {
            let chunk_pt_start = idx * chunk_size;
            let chunk_pt_len = (vf.size_bytes - chunk_pt_start).min(chunk_size) as usize;
            let mut ct_buf = vec![0u8; chunk_pt_len + POLY1305_TAG_LEN];
            f.read_exact(&mut ct_buf)
                .map_err(|e| format!("Read blob chunk failed: {e}"))?;
            let nonce = chunk_nonce(&prefix, idx);
            let aad = chunk_aad(&vf.blob_id, idx);
            let pt = decrypt_aead(dek, &nonce, &ct_buf, &aad)?;
            out.write_all(&pt)
                .map_err(|e| format!("Write output file failed: {e}"))?;
        }
        out.sync_all().map_err(|e| format!("Sync output failed: {e}"))?;
        Ok(())
    }

    /// Requires valid passphrase AND explicit confirmation text before securely shredding all vault data.
    pub fn verify_and_destroy_vault(
        &self,
        passphrase: &str,
        confirmed: bool,
        also_wipe_public: bool,
    ) -> Result<(), String> {
        if !confirmed {
            return Err("Confirmação explícita obrigatória para apagar os dados.".to_string());
        }
        let data_dir = {
            let guard = self.inner.lock().map_err(|_| "Lock poisoned".to_string())?;
            guard.data_dir.clone()
        };

        // Verify passphrase first; if wrong, refuses and aborts without touching any files.
        let _dek = Self::verify_passphrase_only(&data_dir, passphrase)?;

        // Lock memory first
        {
            let mut guard = self.inner.lock().map_err(|_| "Lock poisoned".to_string())?;
            guard.dek = None;
            guard.manifest = None;
        }

        // Shred all blobs
        let blobs_dir = Self::blobs_dir(&data_dir);
        if blobs_dir.exists() {
            for entry in fs::read_dir(&blobs_dir).map_err(|e| format!("Read blobs dir: {e}"))? {
                if let Ok(ent) = entry {
                    let p = ent.path();
                    if p.is_file() {
                        shred_file(&p)?;
                    }
                }
            }
            let _ = fs::remove_dir_all(&blobs_dir);
        }

        shred_file(&Self::manifest_path(&data_dir))?;
        shred_file(&Self::meta_path(&data_dir))?;
        let vault_dir = Self::vault_dir(&data_dir);
        if vault_dir.exists() {
            let _ = fs::remove_dir_all(&vault_dir);
        }

        if also_wipe_public {
            let pub_path = Self::public_store_path(&data_dir);
            if pub_path.exists() {
                shred_file(&pub_path)?;
            }
        }

        Ok(())
    }
}

fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            _ => c,
        })
        .collect::<String>()
        .trim_matches(|c| c == '.' || c == ' ')
        .to_string();

    if cleaned.is_empty() || cleaned == "." || cleaned == ".." {
        return "arquivo".to_string();
    }

    let upper = cleaned.to_ascii_uppercase();
    let stem = upper.split('.').next().unwrap_or("");
    let reserved = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
        "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    if reserved.contains(&stem) {
        return format!("_{cleaned}");
    }
    cleaned
}

fn classify_mime(mime: &str, name: &str) -> String {
    let lower_mime = mime.to_lowercase();
    let lower_name = name.to_lowercase();
    if lower_mime.starts_with("image/") {
        "image".to_string()
    } else if lower_mime.starts_with("video/") {
        "video".to_string()
    } else if lower_mime.starts_with("audio/") {
        "audio".to_string()
    } else if lower_mime.contains("pdf")
        || lower_mime.starts_with("text/")
        || lower_name.ends_with(".md")
        || lower_name.ends_with(".txt")
        || lower_name.ends_with(".docx")
    {
        "document".to_string()
    } else {
        "other".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vault_full_lifecycle_notes_folders_blobs_and_destroy() {
        let dir = std::env::temp_dir().join(format!("lockpad_vault_test_{}", Uuid::new_v4()));
        let vm = VaultManager::new(dir.clone()).unwrap();

        assert!(!vm.status().unwrap().exists);
        vm.setup_vault("frase-ultra-secreta").unwrap();
        assert!(vm.status().unwrap().exists);
        assert!(vm.status().unwrap().unlocked);

        // Lock wipes RAM keys
        vm.lock();
        assert!(!vm.status().unwrap().unlocked);
        assert!(vm.get_manifest().is_err());

        // Wrong passphrase cannot unlock
        assert!(vm.try_unlock("errada").is_err());
        assert!(!vm.status().unwrap().unlocked);

        // Stealth check works cleanly without unlocking on wrong phrase
        assert!(!vm.stealth_check_and_unlock("nota comum do dia").unwrap());
        assert!(vm.stealth_check_and_unlock("frase-ultra-secreta").unwrap());
        assert!(vm.status().unwrap().unlocked);

        // Create folder & import multi-chunk bytes (> 256 KiB)
        let m = vm.create_folder(None, "Documentos".to_string()).unwrap();
        let fid = m.folders[0].id.clone();

        let big_payload: Vec<u8> = (0..(CHUNK_SIZE * 2 + 1234)).map(|i| (i % 251) as u8).collect();
        let m2 = vm
            .import_bytes(
                "video_fake.mp4".to_string(),
                "video/mp4".to_string(),
                big_payload.clone(),
                Some(fid),
            )
            .unwrap();
        let file_id = m2.files[0].id.clone();

        // Range read across chunk boundary
        let start = (CHUNK_SIZE - 50) as u64;
        let end = (CHUNK_SIZE + 500) as u64;
        let (_mime, total, slice) = vm.read_blob_range(&file_id, start, end).unwrap();
        assert_eq!(total as usize, big_payload.len());
        assert_eq!(slice.as_slice(), &big_payload[(start as usize)..=(end as usize)]);

        // Destroy requires right passphrase & confirmation
        assert!(vm.verify_and_destroy_vault("errada", true, false).is_err());
        assert!(vm
            .verify_and_destroy_vault("frase-ultra-secreta", false, false)
            .is_err());
        vm.verify_and_destroy_vault("frase-ultra-secreta", true, true)
            .unwrap();
        assert!(!vm.status().unwrap().exists);

        let _ = fs::remove_dir_all(&dir);
    }
}
