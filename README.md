# LockPad

**LockPad** is a fast, cross-platform (**Windows & Linux**) desktop sticky notes application with a **zero-knowledge encrypted vault** hidden behind a discreet passphrase trigger. Built with **React + TypeScript + Tauri v2 (Rust)**, it looks and behaves like a clean glassmorphic sticky-notes app while protecting private notes, images, videos, and entire folder trees with modern authenticated cryptography.

---

## Features

### Sticky Notes & Desktop Experience
- **Light & Dark Themes**: Translucent glassmorphic interface with instant switching between Dark and Light modes.
- **Rich Notes & Checklists**: Write formatted notes (`Bold`, `Italic`, `Strikethrough`, `Underline`) or convert any note into an interactive To-Do checklist.
- **Full Per-Note Customization**:
  - **10 Color Themes**: Full-card color tinting with matching accent strips across both Dark and Light modes.
  - **15 Font Styles**: Visual font selector rendered in each typeface with Windows & Linux font fallbacks.
  - **Adjustable Text Size**: Per-note font sizing from `11px` to `26px` (`AA`).
  - **Custom Image & GIF Backgrounds**: Personalize any note with `JPEG`, `PNG`, or animated `GIF` backgrounds with automatic readability scrims.
- **Floating Desktop Notes & Always-On-Top Overlay**:
  - Drag any note outside the main LockPad window (or click detach) to float it independently on your desktop with real-time sync.
  - Pin any note as an **Always-On-Top Overlay** — protected against Windows **"Show Desktop" (`Win+D`)** so pinned notes remain visible.
- **System Tray & Safe Exit**:
  - Minimize sends LockPad to the system tray (notification area).
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
  - Wiping the vault or uninstalling (`--uninstall-gate`) requires entering the exact master passphrase plus explicit confirmation (`APAGAR TUDO`), followed by multi-pass random/zero file shredding.
- **One-Click GitHub Auto-Updater**:
  - Click **Buscar Atualizações** inside **Settings** to check `https://api.github.com/repos/Gartuja/LockPad/releases/latest`, download the latest version for Windows or Linux, remove the previous binary, and launch the updated version automatically.

---

## Installation

### Windows
- **Installer**: Run `LockPad_1.6.0_x64-setup.exe` (NSIS installer with protected uninstaller hook).
- **Portable**: Extract `LockPad-v1.6.0-win64.zip` and run `LockPad.exe`.

### Linux
- **Package / AppImage**: Install the `.deb` (`sudo dpkg -i lockpad_*.deb`) or run the `.AppImage` from GitHub Releases.
- **Simple Installer Script** (after building or extracting binary):
  ```bash
  chmod +x installers/linux/install.sh
  ./installers/linux/install.sh
  ```

---

## Building from Source

### Prerequisites
- **Common**: Node.js 20+, Rust toolchain (`stable`)
- **Windows**: Microsoft Edge WebView2 Runtime
- **Linux (Debian / Ubuntu)**:
  ```bash
  sudo apt-get update
  sudo apt-get install -y libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf
  ```

### Commands
```bash
# Install frontend dependencies
npm install

# Run Rust cryptographic & vault unit tests
cargo test --manifest-path src-tauri/Cargo.toml

# Run in development mode
npm run tauri dev

# Build release + native installers (NSIS on Windows; AppImage/deb on Linux)
npx tauri build
```
