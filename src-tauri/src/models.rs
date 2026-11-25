use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChecklistItem {
    pub id: String,
    pub text: String,
    pub checked: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StickyNote {
    pub id: String,
    pub title: String,
    pub content: String,
    pub color: String,
    #[serde(default)]
    pub background_image: Option<String>,
    #[serde(default)]
    pub font_size: Option<u32>,
    #[serde(default)]
    pub font_family: Option<String>,
    pub is_checklist: bool,
    pub checklist: Vec<ChecklistItem>,
    pub pinned: bool,
    pub created_at: String,
    pub updated_at: String,
}

fn default_language() -> String {
    "pt".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppPreferences {
    pub theme: String,
    #[serde(default = "default_language")]
    pub language: String,
    pub always_on_top: bool,
    pub auto_lock_seconds: u64,
    pub screen_protect: bool,
    pub stealth_trigger_enabled: bool,
    pub protect_public_notes_on_wipe: bool,
    #[serde(default)]
    pub onboarding_completed: bool,
    #[serde(default)]
    pub recovery_salt: Option<String>,
    #[serde(default)]
    pub recovery_pubkey: Option<String>,
}

impl Default for AppPreferences {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            language: "pt".to_string(),
            always_on_top: false,
            auto_lock_seconds: 180,
            screen_protect: true,
            stealth_trigger_enabled: true,
            protect_public_notes_on_wipe: false,
            onboarding_completed: false,
            recovery_salt: None,
            recovery_pubkey: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PublicStore {
    pub notes: Vec<StickyNote>,
    pub preferences: AppPreferences,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultMeta {
    pub version: u32,
    pub salt: String,
    pub wrapped_dek_nonce: String,
    pub wrapped_dek: String,
    pub verifier_nonce: String,
    pub verifier: String,
    pub failed_attempts: u32,
    pub lockout_until: i64,
    #[serde(default)]
    pub recovery_salt: Option<String>,
    #[serde(default)]
    pub recovery_ephemeral_pub: Option<String>,
    #[serde(default)]
    pub recovery_wrapped_dek_nonce: Option<String>,
    #[serde(default)]
    pub recovery_wrapped_dek: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultFolder {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultFile {
    pub id: String,
    pub folder_id: Option<String>,
    pub name: String,
    pub mime_type: String,
    pub kind: String,
    pub size_bytes: u64,
    pub blob_id: String,
    pub chunk_size: usize,
    pub nonce_prefix: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct VaultManifest {
    pub notes: Vec<StickyNote>,
    pub folders: Vec<VaultFolder>,
    pub files: Vec<VaultFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultStatus {
    pub exists: bool,
    pub unlocked: bool,
    pub failed_attempts: u32,
    pub lockout_remaining_secs: i64,
    pub screen_protect_active: bool,
    pub note_count: Option<usize>,
    pub file_count: Option<usize>,
    pub folder_count: Option<usize>,
}
