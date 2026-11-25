#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$HOME/.local/share/LockPad"
BIN_LINK="$HOME/.local/bin/lockpad"
DESKTOP_FILE="$HOME/.local/share/applications/lockpad.desktop"
ICON_FILE="$HOME/.local/share/icons/hicolor/256x256/apps/lockpad.png"
VAULT_META="$HOME/.local/share/com.lockpad.app/vault/vault.meta"

if [ -f "$VAULT_META" ] && [ -x "$APP_DIR/lockpad" ]; then
  echo "Active encrypted vault detected. Opening LockPad passphrase verification..."
  if ! "$APP_DIR/lockpad" --uninstall-gate; then
    echo "Uninstall cancelled: valid passphrase and confirmation are required."
    exit 1
  fi
fi

rm -rf "$APP_DIR"
rm -f "$BIN_LINK" "$DESKTOP_FILE" "$ICON_FILE"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$HOME/.local/share/applications" || true

echo "LockPad uninstalled cleanly."
