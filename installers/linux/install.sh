#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$HOME/.local/share/LockPad"
BIN_DIR="$HOME/.local/bin"
DESKTOP_DIR="$HOME/.local/share/applications"
ICON_DIR="$HOME/.local/share/icons/hicolor/256x256/apps"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Installing LockPad..."

mkdir -p "$APP_DIR" "$BIN_DIR" "$DESKTOP_DIR" "$ICON_DIR"

if [ -f "$SCRIPT_DIR/lockpad" ]; then
  cp -f "$SCRIPT_DIR/lockpad" "$APP_DIR/lockpad"
elif [ -f "$SCRIPT_DIR/../../src-tauri/target/release/lockpad" ]; then
  cp -f "$SCRIPT_DIR/../../src-tauri/target/release/lockpad" "$APP_DIR/lockpad"
else
  echo "Error: compiled 'lockpad' binary not found. Build first with: npx tauri build --no-bundle"
  exit 1
fi

chmod +x "$APP_DIR/lockpad"
ln -sf "$APP_DIR/lockpad" "$BIN_DIR/lockpad"

if [ -f "$SCRIPT_DIR/icon.png" ]; then
  cp -f "$SCRIPT_DIR/icon.png" "$ICON_DIR/lockpad.png"
elif [ -f "$SCRIPT_DIR/../../src-tauri/icons/icon.png" ]; then
  cp -f "$SCRIPT_DIR/../../src-tauri/icons/icon.png" "$ICON_DIR/lockpad.png"
fi

cat > "$DESKTOP_DIR/lockpad.desktop" <<EOF
[Desktop Entry]
Name=LockPad
Comment=Encrypted Sticky Notes & Stealth Media Vault
Exec=$APP_DIR/lockpad
Icon=lockpad
Terminal=false
Type=Application
Categories=Utility;Security;
StartupNotify=true
EOF

chmod +x "$DESKTOP_DIR/lockpad.desktop"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DESKTOP_DIR" || true

echo "LockPad installed! Launch it from your application menu or run: lockpad"
