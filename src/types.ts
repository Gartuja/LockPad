export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

export type NoteColor =
  | "indigo"
  | "sky"
  | "emerald"
  | "amber"
  | "rose"
  | "violet"
  | "teal"
  | "orange"
  | "pink"
  | "slate";

export interface StickyNote {
  id: string;
  title: string;
  content: string;
  color: NoteColor;
  background_image?: string | null;
  font_size?: number | null;
  font_family?: string | null;
  is_checklist: boolean;
  checklist: ChecklistItem[];
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface AppPreferences {
  theme: "dark" | "light";
  always_on_top: boolean;
  auto_lock_seconds: number;
  screen_protect: boolean;
  stealth_trigger_enabled: boolean;
  protect_public_notes_on_wipe: boolean;
}

export interface PublicStore {
  notes: StickyNote[];
  preferences: AppPreferences;
}

export interface VaultFolder {
  id: string;
  parent_id: string | null;
  name: string;
  created_at: string;
}

export type VaultFileKind = "image" | "video" | "audio" | "document" | "other";

export interface VaultFile {
  id: string;
  folder_id: string | null;
  name: string;
  mime_type: string;
  kind: VaultFileKind;
  size_bytes: number;
  blob_id: string;
  chunk_size: number;
  nonce_prefix: string;
  created_at: string;
}

export interface VaultManifest {
  notes: StickyNote[];
  folders: VaultFolder[];
  files: VaultFile[];
}

export interface VaultStatus {
  exists: boolean;
  unlocked: boolean;
  failed_attempts: number;
  lockout_remaining_secs: number;
  screen_protect_active: boolean;
  note_count: number | null;
  file_count: number | null;
  folder_count: number | null;
}

export interface UpdateCheckResult {
  current_version: string;
  latest_version: string;
  update_available: boolean;
  release_url: string;
  download_url: string | null;
  asset_name: string | null;
  notes: string;
}
