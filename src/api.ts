import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import type {
  AppPreferences,
  PublicStore,
  StickyNote,
  UpdateCheckResult,
  VaultManifest,
  VaultStatus,
} from "./types";

export const api = {
  isUninstallGateMode: () => invoke<boolean>("is_uninstall_gate_mode"),
  getPublicStore: () => invoke<PublicStore>("get_public_store"),
  savePublicNotes: (notes: StickyNote[]) => invoke<void>("save_public_notes", { notes }),
  savePreferences: (preferences: AppPreferences) =>
    invoke<void>("save_preferences", { preferences }),
  getVaultStatus: () => invoke<VaultStatus>("get_vault_status"),
  setupVault: (passphrase: string) => invoke<VaultStatus>("setup_vault", { passphrase }),
  tryUnlockVault: (passphrase: string) =>
    invoke<boolean>("try_unlock_vault", { passphrase }),
  stealthTryUnlock: (candidate: string) =>
    invoke<boolean>("stealth_try_unlock", { candidate }),
  lockVault: () => invoke<VaultStatus>("lock_vault"),
  touchVaultActivity: () => invoke<void>("touch_vault_activity"),
  changePassphrase: (currentPassphrase: string, newPassphrase: string) =>
    invoke<void>("change_passphrase", { currentPassphrase, newPassphrase }),
  getVaultManifest: () => invoke<VaultManifest>("get_vault_manifest"),
  saveVaultNotes: (notes: StickyNote[]) =>
    invoke<VaultManifest>("save_vault_notes", { notes }),
  createVaultFolder: (parentId: string | null, name: string) =>
    invoke<VaultManifest>("create_vault_folder", { parentId, name }),
  renameVaultFolder: (folderId: string, name: string) =>
    invoke<VaultManifest>("rename_vault_folder", { folderId, name }),
  deleteVaultFolder: (folderId: string) =>
    invoke<VaultManifest>("delete_vault_folder", { folderId }),
  importVaultPaths: (paths: string[], folderId: string | null) =>
    invoke<VaultManifest>("import_vault_paths", { paths, folderId }),
  importVaultBytes: (
    name: string,
    mimeType: string,
    bytes: number[],
    folderId: string | null
  ) => invoke<VaultManifest>("import_vault_bytes", { name, mimeType, bytes, folderId }),
  deleteVaultFile: (fileId: string) =>
    invoke<VaultManifest>("delete_vault_file", { fileId }),
  exportVaultFile: (fileId: string, destDir: string) =>
    invoke<string>("export_vault_file", { fileId, destDir }),
  exportVaultFolder: (folderId: string, destDir: string) =>
    invoke<string>("export_vault_folder", { folderId, destDir }),
  verifyAndDestroyVault: (
    passphrase: string,
    confirmed: boolean,
    alsoWipePublic: boolean
  ) =>
    invoke<void>("verify_and_destroy_vault", {
      passphrase,
      confirmed,
      alsoWipePublic,
    }),
  completeUninstallGate: (allowUninstall: boolean) =>
    invoke<void>("complete_uninstall_gate", { allowUninstall }),
  minimizeWindow: () => invoke<void>("minimize_window"),
  showMainWindow: () => invoke<void>("show_main_window"),
  exitApp: () => invoke<void>("exit_app"),
  openNoteWindow: (
    noteId: string,
    isVault: boolean,
    x: number | null,
    y: number | null,
    pinned: boolean,
    theme: string
  ) =>
    invoke<void>("open_note_window", {
      noteId,
      isVault,
      x,
      y,
      pinned,
      theme,
    }),
  setNoteWindowPinned: (noteId: string, isVault: boolean, pinned: boolean) =>
    invoke<void>("set_note_window_pinned", { noteId, isVault, pinned }),
  closeNoteWindow: (noteId: string, isVault: boolean) =>
    invoke<void>("close_note_window", { noteId, isVault }),
  checkForUpdates: () => invoke<UpdateCheckResult>("check_for_updates"),
  installGithubUpdate: (downloadUrl: string) =>
    invoke<string>("install_github_update", { downloadUrl }),
};

export function vaultBlobUrl(fileId: string): string {
  // convertFileSrc handles Windows http://vault.localhost vs vault:// scheme cleanly across Tauri v2
  return convertFileSrc(`blob/${fileId}`, "vault");
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val >= 10 || i === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[i]}`;
}
