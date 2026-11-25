# LockPad

**LockPad** is a fast, lightweight Windows desktop sticky notes application with a **zero-knowledge encrypted vault** hidden behind a discreet passphrase trigger. Built with **React + TypeScript + Tauri v2 (Rust)**, it looks and behaves like a clean glassmorphic sticky-notes app while protecting private notes, images, videos, and entire folder trees with modern authenticated cryptography.

---

## Features

### Sticky Notes & Desktop Experience
- **Light & Dark Themes**: Translucent glassmorphic interface with instant switching between Dark and Light modes.
- **Rich Notes & Checklists**: Write formatted notes (`Bold`, `Italic`, `Strikethrough`, `Underline`) or convert any note into an interactive To-Do checklist.
- **Full Per-Note Customization**:
  - **10 Color Themes**: Full-card color tinting with matching accent strips across both Dark and Light modes.
  - **15 Font Styles**: Visual font selector rendered in each typeface (`Inter/Segoe`, `Trebuchet`, `Calibri`, `Verdana`, `Tahoma`, `Century Gothic`, `Georgia`, `Cambria`, `Palatino`, `Times New Roman`, `Consolas`, `Courier New`, `Lucida Console`, `Segoe Script`, `Impact`).
  - **Adjustable Text Size**: Per-note font sizing from `11px` to `26px` (`A-` / `A+`).
  - **Custom Image & GIF Backgrounds**: Personalize any note with `JPEG`, `PNG`, or animated `GIF` backgrounds with automatic readability scrims.
- **Floating Desktop Notes & Always-On-Top Overlay**:
  - Drag any note outside the main LockPad window (or click detach) to float it anywhere on your desktop with real-time sync.
  - Pin any detached note as an **Always-On-Top Overlay** — protected against Windows **"Show Desktop" (`Win+D`)** so pinned notes remain visible.
- **System Tray & Safe Exit**:
  - Minimize sends LockPad to the Windows System Tray (notification area).
  - Closing the main window prompts for confirmation before exiting and locks the vault.

### Stealth Encrypted Vault & Security Architecture
- **Discreet Passphrase Trigger**:
  - Set up a master passphrase in **Settings** — it is never stored on disk.
  - Type your passphrase directly into any regular sticky note (desktop or main window) or press `Ctrl+Shift+K` to unlock the hidden **LockPad Vault**.
  - On match, the passphrase text is immediately stripped from the public note before persistence.
- **Modern Cryptography (Rust Native)**:
  - **Key Derivation**: **Argon2id** (`64 MiB` memory, `3` iterations, `4` lanes) with a 32-byte random salt to derive a KEK wrapping a random 256-bit Data Encryption Key (DEK).
  - **Authenticated Encryption**: **XChaCha20-Poly1305** with unique 192-bit nonces and Associated Authenticated Data (AAD) for `vault.meta`, `manifest.enc`, and every file chunk.
  - **Memory Hygiene**: Keys and plaintext passphrases are wrapped in `Zeroizing` and wiped from RAM when locking (`Ctrl+Shift+L`), on auto-lock timeout, or on exit.
  - **Brute-Force Resistance**: Exponential lockout delays after repeated failed explicit attempts plus rate-limiting on the stealth trigger.
- **Encrypted Media, Videos & Nested Folders**:
  - Drag and drop images, videos, documents, or entire folders directly into the vault.
  - Files are streamed into **256 KiB** encrypted chunks (`vault/blobs/<uuid>.lpb`) with chunk-index AAD binding and zero metadata leakage.
  - **In-Memory Media Streaming**: Preview images and stream videos (with HTTP `Range` seeking) via the internal `vault://` protocol directly from RAM without writing decrypted temporary files to disk.
- **Screen-Capture Protection**:
  - Automatically applies Windows `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` while the vault is unlocked to block screenshots and screen recorders.
- **Protected Deletion & Uninstall Gate**:
  - Wiping the vault or uninstalling via the Windows NSIS uninstaller (`--uninstall-gate`) requires entering the exact master passphrase plus explicit confirmation (`APAGAR TUDO`), followed by multi-pass random/zero file shredding.
- **GitHub Self-Updater**:
  - Built-in update checker in **Settings** querying `https://api.github.com/repos/Gartuja/LockPad/releases/latest` with strict HTTPS origin verification and automatic Windows binary replacement.

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Lucide Icons
- **Backend**: Rust, Tauri v2 (`tray-icon`, `tauri-plugin-dialog`)
- **Cryptography**: `argon2`, `chacha20poly1305`, `zeroize`, `rand`

---

## Building from Source (Windows)

### Prerequisites
- Node.js 20+
- Rust toolchain (`stable-x86_64-pc-windows-gnu` or `msvc`)
- Microsoft Edge WebView2 Runtime

### Commands
```bash
# Install frontend dependencies
npm install

# Run Rust cryptographic & vault unit tests
cargo test --manifest-path src-tauri/Cargo.toml

# Run in development mode
npm run tauri dev

# Build release executable
npx tauri build --no-bundle
```
