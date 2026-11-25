use crate::models::{AppPreferences, PublicStore, StickyNote, VaultManifest, VaultStatus};
use crate::updater::{self, UpdateCheckResult};
use crate::vault::VaultManager;
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use zeroize::Zeroizing;

struct AppRuntime {
    vault: VaultManager,
    auto_lock_seconds: AtomicU64,
    screen_protect_pref: AtomicBool,
    uninstall_gate_mode: bool,
    pinned_overlays: Mutex<HashSet<String>>,
    desktop_widgets: Mutex<HashSet<String>>,
}

#[cfg(target_os = "windows")]
fn ensure_overlay_visible(window: &tauri::WebviewWindow) {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        IsIconic, SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
        SW_SHOWNOACTIVATE,
    };
    if let Ok(hwnd) = window.hwnd() {
        let h = hwnd.0 as HWND;
        unsafe {
            if IsIconic(h) != 0 {
                ShowWindow(h, SW_SHOWNOACTIVATE);
            }
            SetWindowPos(
                h,
                HWND_TOPMOST,
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            );
        }
    }
}

#[cfg(target_os = "windows")]
fn apply_desktop_widget_mode(window: &tauri::WebviewWindow, enable: bool) {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        FindWindowW, SetWindowLongPtrW, SetWindowPos, GWLP_HWNDPARENT, HWND_BOTTOM,
        HWND_NOTOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };
    if let Ok(hwnd) = window.hwnd() {
        let h = hwnd.0 as HWND;
        unsafe {
            if enable {
                let progman_cls: [u16; 8] = [
                    b'P' as u16,
                    b'r' as u16,
                    b'o' as u16,
                    b'g' as u16,
                    b'm' as u16,
                    b'a' as u16,
                    b'n' as u16,
                    0,
                ];
                let progman = FindWindowW(progman_cls.as_ptr(), std::ptr::null());
                if !progman.is_null() {
                    SetWindowLongPtrW(h, GWLP_HWNDPARENT, progman as _);
                }
                SetWindowPos(
                    h,
                    HWND_BOTTOM,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
            } else {
                SetWindowLongPtrW(h, GWLP_HWNDPARENT, 0);
                SetWindowPos(
                    h,
                    HWND_NOTOPMOST,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn ensure_desktop_widget_visible(window: &tauri::WebviewWindow) {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, IsIconic, SetWindowPos, ShowWindow, HWND_BOTTOM, SWP_NOACTIVATE,
        SWP_NOMOVE, SWP_NOSIZE, SW_SHOWNOACTIVATE,
    };
    if let Ok(hwnd) = window.hwnd() {
        let h = hwnd.0 as HWND;
        unsafe {
            if IsIconic(h) != 0 {
                ShowWindow(h, SW_SHOWNOACTIVATE);
            }
            if GetForegroundWindow() != h {
                SetWindowPos(
                    h,
                    HWND_BOTTOM,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn apply_desktop_widget_mode(_window: &tauri::WebviewWindow, _enable: bool) {}

#[cfg(not(target_os = "windows"))]
fn ensure_desktop_widget_visible(_window: &tauri::WebviewWindow) {}

#[cfg(target_os = "windows")]
fn is_desktop_foreground() -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetClassNameW, GetForegroundWindow};
    unsafe {
        let fg = GetForegroundWindow();
        if fg.is_null() {
            return true;
        }
        let mut buf = [0u16; 64];
        let len = GetClassNameW(fg, buf.as_mut_ptr(), buf.len() as i32);
        if len <= 0 {
            return false;
        }
        let cls = String::from_utf16_lossy(&buf[..len as usize]);
        cls == "WorkerW" || cls == "Progman"
    }
}

#[cfg(not(target_os = "windows"))]
fn ensure_overlay_visible(_window: &tauri::WebviewWindow) {}

#[cfg(not(target_os = "windows"))]
fn is_desktop_foreground() -> bool {
    false
}

#[cfg(target_os = "windows")]
fn apply_rounded_corners(window: &tauri::WebviewWindow) {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::Graphics::Dwm::{
        DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
    };
    if let Ok(hwnd) = window.hwnd() {
        let pref = DWMWCP_ROUND as u32;
        unsafe {
            DwmSetWindowAttribute(
                hwnd.0 as HWND,
                DWMWA_WINDOW_CORNER_PREFERENCE as u32,
                &pref as *const u32 as *const _,
                std::mem::size_of::<u32>() as u32,
            );
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn apply_rounded_corners(_window: &tauri::WebviewWindow) {}

#[cfg(target_os = "windows")]
fn apply_window_capture_protection(window: &tauri::WebviewWindow, enable: bool) -> bool {
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
    };
    if let Ok(hwnd) = window.hwnd() {
        let affinity = if enable { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE };
        let ok = unsafe { SetWindowDisplayAffinity(hwnd.0 as HWND, affinity) };
        return ok != 0;
    }
    false
}

#[cfg(not(target_os = "windows"))]
fn apply_window_capture_protection(_window: &tauri::WebviewWindow, _enable: bool) -> bool {
    false
}

fn sync_screen_protection(app: &AppHandle, runtime: &AppRuntime) {
    let unlocked = runtime.vault.status().map(|s| s.unlocked).unwrap_or(false);
    let should_protect = unlocked && runtime.screen_protect_pref.load(Ordering::Relaxed);
    if let Some(win) = app.get_webview_window("main") {
        let active = apply_window_capture_protection(&win, should_protect);
        if let Ok(mut guard) = runtime.vault.inner.lock() {
            guard.screen_protect_active = should_protect && active;
        }
    }
}

#[tauri::command]
fn is_uninstall_gate_mode(state: State<Arc<AppRuntime>>) -> bool {
    state.uninstall_gate_mode
}

#[tauri::command]
fn get_public_store(state: State<Arc<AppRuntime>>) -> Result<PublicStore, String> {
    let guard = state
        .vault
        .inner
        .lock()
        .map_err(|_| "Lock poisoned".to_string())?;
    let store = VaultManager::load_public_store(&guard.data_dir)?;
    state
        .auto_lock_seconds
        .store(store.preferences.auto_lock_seconds, Ordering::Relaxed);
    state
        .screen_protect_pref
        .store(store.preferences.screen_protect, Ordering::Relaxed);
    Ok(store)
}

#[tauri::command]
fn save_public_notes(
    notes: Vec<StickyNote>,
    state: State<Arc<AppRuntime>>,
) -> Result<(), String> {
    let guard = state
        .vault
        .inner
        .lock()
        .map_err(|_| "Lock poisoned".to_string())?;
    let mut store = VaultManager::load_public_store(&guard.data_dir)?;
    let referenced: HashSet<String> = notes
        .iter()
        .flat_map(|n| n.attachments.iter().map(|a| a.stored_name.clone()))
        .collect();
    let media_dir = VaultManager::public_media_dir(&guard.data_dir);
    if media_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&media_dir) {
            for ent in entries.flatten() {
                let p = ent.path();
                if p.is_file() {
                    if let Some(name) = p.file_name().and_then(|s| s.to_str()) {
                        if !referenced.contains(name) {
                            let _ = std::fs::remove_file(&p);
                        }
                    }
                }
            }
        }
    }
    store.notes = notes;
    VaultManager::save_public_store(&guard.data_dir, &store)
}

#[tauri::command]
fn save_preferences(
    app: AppHandle,
    preferences: AppPreferences,
    state: State<Arc<AppRuntime>>,
) -> Result<(), String> {
    state
        .auto_lock_seconds
        .store(preferences.auto_lock_seconds, Ordering::Relaxed);
    state
        .screen_protect_pref
        .store(preferences.screen_protect, Ordering::Relaxed);

    {
        let guard = state
            .vault
            .inner
            .lock()
            .map_err(|_| "Lock poisoned".to_string())?;
        let mut store = VaultManager::load_public_store(&guard.data_dir)?;
        store.preferences = preferences.clone();
        VaultManager::save_public_store(&guard.data_dir, &store)?;
    }

    if let Some(win) = app.get_webview_window("main") {
        let _ = win.set_always_on_top(preferences.always_on_top);
    }
    sync_screen_protection(&app, &state);
    Ok(())
}

#[tauri::command]
fn get_vault_status(state: State<Arc<AppRuntime>>) -> Result<VaultStatus, String> {
    state.vault.status()
}

#[tauri::command]
fn generate_recovery_key() -> String {
    VaultManager::generate_recovery_key().to_string()
}

#[tauri::command]
fn complete_onboarding(
    recovery_key: String,
    language: String,
    state: State<Arc<AppRuntime>>,
) -> Result<PublicStore, String> {
    let key = Zeroizing::new(recovery_key);
    state.vault.complete_onboarding(&key, &language)
}

#[tauri::command]
fn setup_vault(
    app: AppHandle,
    passphrase: String,
    state: State<Arc<AppRuntime>>,
) -> Result<VaultStatus, String> {
    let pass = Zeroizing::new(passphrase);
    let status = state.vault.setup_vault(&pass)?;
    sync_screen_protection(&app, &state);
    state.vault.status().or(Ok(status))
}

#[tauri::command]
fn try_unlock_vault(
    app: AppHandle,
    passphrase: String,
    state: State<Arc<AppRuntime>>,
) -> Result<bool, String> {
    let pass = Zeroizing::new(passphrase);
    let ok = state.vault.try_unlock(&pass)?;
    if ok {
        sync_screen_protection(&app, &state);
    }
    Ok(ok)
}

#[tauri::command]
fn stealth_try_unlock(
    app: AppHandle,
    candidate: String,
    state: State<Arc<AppRuntime>>,
) -> Result<bool, String> {
    let cand = Zeroizing::new(candidate);
    let ok = state.vault.stealth_check_and_unlock(&cand)?;
    if ok {
        sync_screen_protection(&app, &state);
    }
    Ok(ok)
}

fn close_vault_popouts(app: &AppHandle) {
    for (label, win) in app.webview_windows() {
        if label.starts_with("note-vault-") {
            let _ = win.close();
        }
    }
}

#[tauri::command]
fn lock_vault(app: AppHandle, state: State<Arc<AppRuntime>>) -> Result<VaultStatus, String> {
    state.vault.lock();
    close_vault_popouts(&app);
    sync_screen_protection(&app, &state);
    state.vault.status()
}

#[tauri::command]
fn minimize_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.hide().map_err(|e| format!("Hide to tray failed: {e}"))
}

#[tauri::command]
fn show_main_window(app: AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

#[tauri::command]
fn exit_app(app: AppHandle, state: State<Arc<AppRuntime>>) {
    state.vault.lock();
    close_vault_popouts(&app);
    app.exit(0);
}

#[tauri::command]
async fn open_note_window(
    app: AppHandle,
    note_id: String,
    is_vault: bool,
    x: Option<f64>,
    y: Option<f64>,
    pinned: bool,
    desktop_widget: bool,
    theme: String,
    state: State<'_, Arc<AppRuntime>>,
) -> Result<(), String> {
    if is_vault {
        let unlocked = state.vault.status().map(|s| s.unlocked).unwrap_or(false);
        if !unlocked {
            return Err("Cofre bloqueado.".to_string());
        }
    }

    let pinned = pinned && !desktop_widget;
    let prefix = if is_vault { "note-vault-" } else { "note-pub-" };
    let safe_id: String = note_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    let label = format!("{prefix}{safe_id}");

    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.set_always_on_top(pinned);
        let _ = existing.set_skip_taskbar(pinned || desktop_widget);
        apply_desktop_widget_mode(&existing, desktop_widget);
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return Ok(());
    }

    let is_light = theme == "light";
    let url = format!(
        "index.html?popout={}&vault={}&theme={}",
        safe_id,
        if is_vault { "1" } else { "0" },
        if is_light { "light" } else { "dark" }
    );

    let bg = if is_light {
        tauri::window::Color(238, 244, 255, 255)
    } else {
        tauri::window::Color(15, 27, 66, 255)
    };

    let mut builder =
        tauri::WebviewWindowBuilder::new(&app, &label, tauri::WebviewUrl::App(url.into()))
            .title("LockPad — Nota")
            .inner_size(295.0, 220.0)
            .min_inner_size(220.0, 160.0)
            .resizable(true)
            .decorations(false)
            .transparent(false)
            .shadow(true)
            .skip_taskbar(pinned || desktop_widget)
            .background_color(bg)
            .always_on_top(pinned);

    if let (Some(px), Some(py)) = (x, y) {
        builder = builder.position(px, py);
    }

    let win = builder
        .build()
        .map_err(|e| format!("Failed to open note window: {e}"))?;

    if pinned {
        if let Ok(mut overlays) = state.pinned_overlays.lock() {
            overlays.insert(label.clone());
        }
        ensure_overlay_visible(&win);
    } else if desktop_widget {
        if let Ok(mut widgets) = state.desktop_widgets.lock() {
            widgets.insert(label.clone());
        }
        apply_desktop_widget_mode(&win, true);
        ensure_desktop_widget_visible(&win);
    }

    let app_for_event = app.clone();
    let note_id_for_event = note_id.clone();
    let label_for_event = label.clone();
    win.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            let rt = app_for_event.state::<Arc<AppRuntime>>();
            if let Ok(mut overlays) = rt.pinned_overlays.lock() {
                overlays.remove(&label_for_event);
            }
            if let Ok(mut widgets) = rt.desktop_widgets.lock() {
                widgets.remove(&label_for_event);
            }
            let _ = app_for_event.emit("note-popout-closed", &note_id_for_event);
        }
    });

    apply_rounded_corners(&win);
    if is_vault && state.screen_protect_pref.load(Ordering::Relaxed) {
        apply_window_capture_protection(&win, true);
    }
    Ok(())
}

#[tauri::command]
fn set_note_window_pinned(
    app: AppHandle,
    note_id: String,
    is_vault: bool,
    pinned: bool,
    state: State<Arc<AppRuntime>>,
) -> Result<(), String> {
    let prefix = if is_vault { "note-vault-" } else { "note-pub-" };
    let safe_id: String = note_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    let label = format!("{prefix}{safe_id}");
    if let Ok(mut overlays) = state.pinned_overlays.lock() {
        if pinned {
            overlays.insert(label.clone());
        } else {
            overlays.remove(&label);
        }
    }
    if pinned {
        if let Ok(mut widgets) = state.desktop_widgets.lock() {
            widgets.remove(&label);
        }
    }
    if let Some(win) = app.get_webview_window(&label) {
        if pinned {
            apply_desktop_widget_mode(&win, false);
        }
        let _ = win.set_skip_taskbar(pinned);
        win.set_always_on_top(pinned)
            .map_err(|e| format!("Failed to set always on top: {e}"))?;
        if pinned {
            ensure_overlay_visible(&win);
        }
    }
    Ok(())
}

#[tauri::command]
fn set_note_window_desktop_widget(
    app: AppHandle,
    note_id: String,
    is_vault: bool,
    desktop_widget: bool,
    state: State<Arc<AppRuntime>>,
) -> Result<(), String> {
    let prefix = if is_vault { "note-vault-" } else { "note-pub-" };
    let safe_id: String = note_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    let label = format!("{prefix}{safe_id}");
    if let Ok(mut widgets) = state.desktop_widgets.lock() {
        if desktop_widget {
            widgets.insert(label.clone());
        } else {
            widgets.remove(&label);
        }
    }
    if desktop_widget {
        if let Ok(mut overlays) = state.pinned_overlays.lock() {
            overlays.remove(&label);
        }
    }
    if let Some(win) = app.get_webview_window(&label) {
        if desktop_widget {
            let _ = win.set_always_on_top(false);
            let _ = win.set_skip_taskbar(true);
            apply_desktop_widget_mode(&win, true);
            ensure_desktop_widget_visible(&win);
        } else {
            apply_desktop_widget_mode(&win, false);
            let _ = win.set_skip_taskbar(false);
        }
    }
    Ok(())
}

#[tauri::command]
fn close_note_window(app: AppHandle, note_id: String, is_vault: bool) {
    let prefix = if is_vault { "note-vault-" } else { "note-pub-" };
    let safe_id: String = note_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    let label = format!("{prefix}{safe_id}");
    if let Some(win) = app.get_webview_window(&label) {
        let _ = win.close();
    }
}

#[tauri::command]
fn touch_vault_activity(state: State<Arc<AppRuntime>>) {
    state.vault.touch_activity();
}

#[tauri::command]
fn change_passphrase(
    current_passphrase: String,
    new_passphrase: String,
    state: State<Arc<AppRuntime>>,
) -> Result<(), String> {
    state
        .vault
        .change_passphrase(&current_passphrase, &new_passphrase)
}

#[tauri::command]
fn get_vault_manifest(state: State<Arc<AppRuntime>>) -> Result<VaultManifest, String> {
    state.vault.get_manifest()
}

#[tauri::command]
fn save_vault_notes(
    notes: Vec<StickyNote>,
    state: State<Arc<AppRuntime>>,
) -> Result<VaultManifest, String> {
    state.vault.save_notes(notes)
}

#[tauri::command]
fn create_vault_folder(
    parent_id: Option<String>,
    name: String,
    state: State<Arc<AppRuntime>>,
) -> Result<VaultManifest, String> {
    state.vault.create_folder(parent_id, name)
}

#[tauri::command]
fn rename_vault_folder(
    folder_id: String,
    name: String,
    state: State<Arc<AppRuntime>>,
) -> Result<VaultManifest, String> {
    state.vault.rename_folder(&folder_id, name)
}

#[tauri::command]
fn delete_vault_folder(
    folder_id: String,
    state: State<Arc<AppRuntime>>,
) -> Result<VaultManifest, String> {
    state.vault.delete_folder(&folder_id)
}

#[tauri::command]
fn import_vault_paths(
    paths: Vec<String>,
    folder_id: Option<String>,
    state: State<Arc<AppRuntime>>,
) -> Result<VaultManifest, String> {
    state.vault.import_paths(paths, folder_id)
}

#[tauri::command]
fn import_vault_bytes(
    name: String,
    mime_type: String,
    bytes: Vec<u8>,
    folder_id: Option<String>,
    state: State<Arc<AppRuntime>>,
) -> Result<VaultManifest, String> {
    state
        .vault
        .import_bytes(name, mime_type, bytes, folder_id)
}

#[tauri::command]
fn delete_vault_file(
    file_id: String,
    state: State<Arc<AppRuntime>>,
) -> Result<VaultManifest, String> {
    state.vault.delete_file(&file_id)
}

#[tauri::command]
fn export_vault_file(
    file_id: String,
    dest_dir: String,
    state: State<Arc<AppRuntime>>,
) -> Result<String, String> {
    state.vault.export_file_to_dir(&file_id, &dest_dir)
}

#[tauri::command]
fn export_vault_folder(
    folder_id: String,
    dest_dir: String,
    state: State<Arc<AppRuntime>>,
) -> Result<String, String> {
    state.vault.export_folder_to_dir(&folder_id, &dest_dir)
}

#[tauri::command]
fn attach_public_files(
    note_id: String,
    paths: Vec<String>,
    state: State<Arc<AppRuntime>>,
) -> Result<Vec<StickyNote>, String> {
    state.vault.attach_public_files(&note_id, paths)
}

#[tauri::command]
fn remove_public_attachment(
    note_id: String,
    attachment_id: String,
    state: State<Arc<AppRuntime>>,
) -> Result<Vec<StickyNote>, String> {
    state.vault.remove_public_attachment(&note_id, &attachment_id)
}

#[tauri::command]
fn export_public_attachment(
    stored_name: String,
    original_name: String,
    dest_dir: String,
    state: State<Arc<AppRuntime>>,
) -> Result<String, String> {
    state
        .vault
        .export_public_attachment(&stored_name, &original_name, &dest_dir)
}

#[tauri::command]
fn attach_vault_note_files(
    note_id: String,
    paths: Vec<String>,
    state: State<Arc<AppRuntime>>,
) -> Result<VaultManifest, String> {
    state.vault.attach_vault_note_files(&note_id, paths)
}

#[tauri::command]
fn remove_vault_note_attachment(
    note_id: String,
    attachment_id: String,
    state: State<Arc<AppRuntime>>,
) -> Result<VaultManifest, String> {
    state
        .vault
        .remove_vault_note_attachment(&note_id, &attachment_id)
}

#[tauri::command]
fn verify_and_destroy_vault(
    app: AppHandle,
    passphrase: String,
    confirmed: bool,
    also_wipe_public: bool,
    state: State<Arc<AppRuntime>>,
) -> Result<(), String> {
    let pass = Zeroizing::new(passphrase);
    state
        .vault
        .verify_and_destroy_vault(&pass, confirmed, also_wipe_public)?;
    close_vault_popouts(&app);
    if let Ok(mut overlays) = state.pinned_overlays.lock() {
        overlays.retain(|l| !l.starts_with("note-vault-"));
    }
    if let Ok(mut widgets) = state.desktop_widgets.lock() {
        widgets.retain(|l| !l.starts_with("note-vault-"));
    }
    sync_screen_protection(&app, &state);
    Ok(())
}

#[tauri::command]
async fn check_for_updates(app: AppHandle) -> Result<UpdateCheckResult, String> {
    let version = app.package_info().version.to_string();
    tauri::async_runtime::spawn_blocking(move || updater::check_github_update(&version))
        .await
        .map_err(|e| format!("Erro na tarefa de atualização: {e}"))?
}

#[tauri::command]
async fn install_github_update(
    app: AppHandle,
    download_url: String,
    state: State<'_, Arc<AppRuntime>>,
) -> Result<String, String> {
    let version = app.package_info().version.to_string();
    let msg = tauri::async_runtime::spawn_blocking(move || {
        updater::download_and_install_update(&version, &download_url)
    })
    .await
    .map_err(|e| format!("Erro ao baixar atualização: {e}"))??;

    state.vault.lock();
    close_vault_popouts(&app);
    let app_clone = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(450));
        app_clone.exit(0);
    });
    Ok(msg)
}

#[tauri::command]
fn complete_uninstall_gate(allow_uninstall: bool) {
    if allow_uninstall {
        std::process::exit(0);
    } else {
        std::process::exit(1);
    }
}

fn parse_range_header(header: &str, total: u64) -> Option<(u64, u64)> {
    let spec = header.strip_prefix("bytes=")?;
    let (start_s, end_s) = spec.split_once('-')?;
    if total == 0 {
        return None;
    }
    if start_s.is_empty() {
        let suffix: u64 = end_s.parse().ok()?;
        if suffix == 0 {
            return None;
        }
        let start = total.saturating_sub(suffix);
        return Some((start, total - 1));
    }
    let start: u64 = start_s.parse().ok()?;
    let end: u64 = if end_s.is_empty() {
        (start + 1024 * 1024 - 1).min(total - 1)
    } else {
        end_s.parse::<u64>().ok()?.min(total - 1)
    };
    if start > end || start >= total {
        return None;
    }
    Some((start, end))
}

fn percent_decode_path(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = &raw[i + 1..i + 3];
            if let Ok(b) = u8::from_str_radix(hex, 16) {
                out.push(b);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn extract_blob_id(uri_path: &str) -> String {
    let decoded = percent_decode_path(uri_path);
    let trimmed = decoded.trim_start_matches('/');
    trimmed
        .strip_prefix("blob/")
        .unwrap_or(trimmed)
        .to_string()
}

#[cfg(test)]
mod app_tests {
    use super::extract_blob_id;

    #[test]
    fn extract_blob_id_decodes_windows_convert_file_src_paths() {
        assert_eq!(
            extract_blob_id("/blob%2F123_Crazy%20frog%20Bass.mp3"),
            "123_Crazy frog Bass.mp3"
        );
        assert_eq!(
            extract_blob_id("/blob/456_habbo-habboween.gif"),
            "456_habbo-habboween.gif"
        );
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let uninstall_gate_mode = std::env::args().any(|a| a == "--uninstall-gate");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .register_uri_scheme_protocol("vault", |ctx, request| {
            let app = ctx.app_handle();
            let runtime = app.state::<Arc<AppRuntime>>();

            let file_id = extract_blob_id(request.uri().path());
            if file_id.is_empty() {
                return tauri::http::Response::builder()
                    .status(404)
                    .body(b"Not found".to_vec())
                    .unwrap();
            }

            let range_hdr = request
                .headers()
                .get("range")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());

            // Check file total size first via manifest
            let file_meta = {
                let guard = match runtime.vault.inner.lock() {
                    Ok(g) => g,
                    Err(_) => {
                        return tauri::http::Response::builder()
                            .status(500)
                            .body(Vec::new())
                            .unwrap();
                    }
                };
                if guard.dek.is_none() {
                    return tauri::http::Response::builder()
                        .status(401)
                        .body(b"Vault locked".to_vec())
                        .unwrap();
                }
                guard.manifest.as_ref().and_then(|m| {
                    m.files
                        .iter()
                        .chain(m.note_blobs.iter())
                        .find(|f| f.id == file_id)
                        .cloned()
                })
            };

            let Some(vf) = file_meta else {
                return tauri::http::Response::builder()
                    .status(404)
                    .body(b"Not found".to_vec())
                    .unwrap();
            };

            let total = vf.size_bytes;
            if total == 0 {
                return tauri::http::Response::builder()
                    .status(200)
                    .header("Content-Type", vf.mime_type)
                    .header("Access-Control-Allow-Origin", "*")
                    .header("Cache-Control", "no-store, no-cache, must-revalidate")
                    .header("Accept-Ranges", "bytes")
                    .body(Vec::new())
                    .unwrap();
            }

            if let Some(rh) = range_hdr {
                if let Some((start, end)) = parse_range_header(&rh, total) {
                    if let Ok((mime, total_len, data)) =
                        runtime.vault.read_blob_range(&file_id, start, end)
                    {
                        return tauri::http::Response::builder()
                            .status(206)
                            .header("Content-Type", mime)
                            .header("Access-Control-Allow-Origin", "*")
                            .header("Content-Length", data.len().to_string())
                            .header(
                                "Content-Range",
                                format!("bytes {start}-{end}/{total_len}"),
                            )
                            .header("Accept-Ranges", "bytes")
                            .header("Cache-Control", "no-store, no-cache, must-revalidate")
                            .body(data)
                            .unwrap();
                    }
                }
                return tauri::http::Response::builder()
                    .status(416)
                    .header("Content-Range", format!("bytes */{total}"))
                    .body(Vec::new())
                    .unwrap();
            }

            match runtime.vault.read_blob_range(&file_id, 0, total - 1) {
                Ok((mime, _total_len, data)) => tauri::http::Response::builder()
                    .status(200)
                    .header("Content-Type", mime)
                    .header("Access-Control-Allow-Origin", "*")
                    .header("Content-Length", data.len().to_string())
                    .header("Accept-Ranges", "bytes")
                    .header("Cache-Control", "no-store, no-cache, must-revalidate")
                    .body(data)
                    .unwrap(),
                Err(_) => tauri::http::Response::builder()
                    .status(500)
                    .body(Vec::new())
                    .unwrap(),
            }
        })
        .register_uri_scheme_protocol("pubmedia", |ctx, request| {
            use std::io::{Read, Seek, SeekFrom};
            let app = ctx.app_handle();
            let runtime = app.state::<Arc<AppRuntime>>();

            let raw_name = extract_blob_id(request.uri().path());
            if raw_name.is_empty() {
                return tauri::http::Response::builder()
                    .status(404)
                    .body(b"Not found".to_vec())
                    .unwrap();
            }
            let safe_name = crate::vault::sanitize_filename(&raw_name);
            let data_dir = match runtime.vault.inner.lock() {
                Ok(g) => g.data_dir.clone(),
                Err(_) => {
                    return tauri::http::Response::builder()
                        .status(500)
                        .body(Vec::new())
                        .unwrap();
                }
            };
            let file_path = VaultManager::public_media_dir(&data_dir).join(&safe_name);
            let mut f = match std::fs::File::open(&file_path) {
                Ok(f) => f,
                Err(_) => {
                    return tauri::http::Response::builder()
                        .status(404)
                        .body(b"Not found".to_vec())
                        .unwrap();
                }
            };
            let total = f.metadata().map(|m| m.len()).unwrap_or(0);
            let mime = mime_guess::from_path(&file_path)
                .first_or_octet_stream()
                .essence_str()
                .to_string();

            if total == 0 {
                return tauri::http::Response::builder()
                    .status(200)
                    .header("Content-Type", mime)
                    .header("Access-Control-Allow-Origin", "*")
                    .header("Accept-Ranges", "bytes")
                    .body(Vec::new())
                    .unwrap();
            }

            let range_hdr = request
                .headers()
                .get("range")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());

            if let Some(rh) = range_hdr {
                if let Some((start, end)) = parse_range_header(&rh, total) {
                    let len = (end - start + 1) as usize;
                    let mut buf = vec![0u8; len];
                    if f.seek(SeekFrom::Start(start)).is_ok() && f.read_exact(&mut buf).is_ok() {
                        return tauri::http::Response::builder()
                            .status(206)
                            .header("Content-Type", mime)
                            .header("Access-Control-Allow-Origin", "*")
                            .header("Content-Length", buf.len().to_string())
                            .header("Content-Range", format!("bytes {start}-{end}/{total}"))
                            .header("Accept-Ranges", "bytes")
                            .body(buf)
                            .unwrap();
                    }
                }
                return tauri::http::Response::builder()
                    .status(416)
                    .header("Content-Range", format!("bytes */{total}"))
                    .body(Vec::new())
                    .unwrap();
            }

            let mut buf = Vec::with_capacity(total as usize);
            match f.read_to_end(&mut buf) {
                Ok(_) => tauri::http::Response::builder()
                    .status(200)
                    .header("Content-Type", mime)
                    .header("Access-Control-Allow-Origin", "*")
                    .header("Content-Length", buf.len().to_string())
                    .header("Accept-Ranges", "bytes")
                    .body(buf)
                    .unwrap(),
                Err(_) => tauri::http::Response::builder()
                    .status(500)
                    .body(Vec::new())
                    .unwrap(),
            }
        })
        .setup(move |app| {
            let data_dir = app
                .path()
                .app_local_data_dir()
                .map_err(|e| format!("Failed to resolve local data dir: {e}"))?;
            let vault = VaultManager::new(data_dir.clone())
                .map_err(|e| format!("Failed to initialize vault: {e}"))?;

            let prefs = VaultManager::load_public_store(&data_dir)
                .map(|s| s.preferences)
                .unwrap_or_default();

            let runtime = Arc::new(AppRuntime {
                vault,
                auto_lock_seconds: AtomicU64::new(prefs.auto_lock_seconds),
                screen_protect_pref: AtomicBool::new(prefs.screen_protect),
                uninstall_gate_mode,
                pinned_overlays: Mutex::new(HashSet::new()),
                desktop_widgets: Mutex::new(HashSet::new()),
            });

            if uninstall_gate_mode {
                // If no vault exists, allow uninstallation immediately
                if let Ok(st) = runtime.vault.status() {
                    if !st.exists {
                        std::process::exit(0);
                    }
                }
                if let Some(win) = app.get_webview_window("main") {
                    apply_rounded_corners(&win);
                    let _ = win.set_title("LockPad — Verificação de Desinstalação");
                    let _ = win.set_always_on_top(true);
                }
            } else {
                if let Some(win) = app.get_webview_window("main") {
                    apply_rounded_corners(&win);
                    let _ = win.set_always_on_top(prefs.always_on_top);
                }

                // System Tray (minimize to background notification area)
                use tauri::menu::{MenuBuilder, MenuItemBuilder};
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

                let show_item = MenuItemBuilder::with_id("tray_show", "Abrir LockPad")
                    .build(app)?;
                let unlock_item = MenuItemBuilder::with_id(
                    "tray_unlock_delete",
                    "Desbloquear / Excluir LockPad...",
                )
                .build(app)?;
                let quit_item = MenuItemBuilder::with_id("tray_quit", "Sair do LockPad")
                    .build(app)?;
                let tray_menu = MenuBuilder::new(app)
                    .items(&[&show_item, &unlock_item, &quit_item])
                    .build()?;

                let mut tray_builder = TrayIconBuilder::new()
                    .tooltip("LockPad")
                    .menu(&tray_menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id().as_ref() {
                        "tray_show" => {
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.show();
                                let _ = win.unminimize();
                                let _ = win.set_focus();
                            }
                        }
                        "tray_unlock_delete" => {
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.show();
                                let _ = win.unminimize();
                                let _ = win.set_focus();
                            }
                            let _ = app.emit("open-settings-danger", ());
                        }
                        "tray_quit" => {
                            let state = app.state::<Arc<AppRuntime>>();
                            state.vault.lock();
                            close_vault_popouts(app);
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.show();
                                let _ = win.unminimize();
                                let _ = win.set_focus();
                            }
                        }
                    });

                if let Some(icon) = app.default_window_icon().cloned() {
                    tray_builder = tray_builder.icon(icon);
                }
                let _ = tray_builder.build(app)?;
            }

            // Spawn auto-lock & overlay desktop-survival watchdog thread
            let handle = app.handle().clone();
            let runtime_bg = runtime.clone();
            std::thread::spawn(move || {
                let mut tick: u64 = 0;
                loop {
                    std::thread::sleep(std::time::Duration::from_millis(350));
                    tick = tick.wrapping_add(1);

                    // Keep pinned overlay notes visible even after Win+D / "Show Desktop"
                    let overlay_labels: Vec<String> = runtime_bg
                        .pinned_overlays
                        .lock()
                        .map(|s| s.iter().cloned().collect())
                        .unwrap_or_default();
                    if !overlay_labels.is_empty() && is_desktop_foreground() {
                        for label in &overlay_labels {
                            if let Some(win) = handle.get_webview_window(label) {
                                ensure_overlay_visible(&win);
                            }
                        }
                    }

                    // Keep Rainmeter-style desktop widget notes pinned to desktop behind other windows
                    let widget_labels: Vec<String> = runtime_bg
                        .desktop_widgets
                        .lock()
                        .map(|s| s.iter().cloned().collect())
                        .unwrap_or_default();
                    if !widget_labels.is_empty() {
                        for label in &widget_labels {
                            if let Some(win) = handle.get_webview_window(label) {
                                ensure_desktop_widget_visible(&win);
                            }
                        }
                    }

                    // Check auto-lock every ~5s
                    if tick % 14 != 0 {
                        continue;
                    }
                    let timeout = runtime_bg.auto_lock_seconds.load(Ordering::Relaxed);
                    if timeout == 0 {
                        continue;
                    }
                    let mut locked_now = false;
                    if let Ok(mut guard) = runtime_bg.vault.inner.lock() {
                        if guard.dek.is_some() && guard.last_activity.elapsed().as_secs() >= timeout
                        {
                            guard.dek = None;
                            guard.manifest = None;
                            locked_now = true;
                        }
                    }
                    if locked_now {
                        close_vault_popouts(&handle);
                        sync_screen_protection(&handle, &runtime_bg);
                        let _ = handle.emit("vault-auto-locked", ());
                    }
                }
            });

            app.manage(runtime);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            is_uninstall_gate_mode,
            get_public_store,
            save_public_notes,
            save_preferences,
            get_vault_status,
            generate_recovery_key,
            complete_onboarding,
            setup_vault,
            try_unlock_vault,
            stealth_try_unlock,
            lock_vault,
            touch_vault_activity,
            change_passphrase,
            get_vault_manifest,
            save_vault_notes,
            create_vault_folder,
            rename_vault_folder,
            delete_vault_folder,
            import_vault_paths,
            import_vault_bytes,
            delete_vault_file,
            export_vault_file,
            export_vault_folder,
            verify_and_destroy_vault,
            complete_uninstall_gate,
            minimize_window,
            show_main_window,
            exit_app,
            open_note_window,
            set_note_window_pinned,
            set_note_window_desktop_widget,
            close_note_window,
            attach_public_files,
            remove_public_attachment,
            export_public_attachment,
            attach_vault_note_files,
            remove_vault_note_attachment,
            check_for_updates,
            install_github_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running LockPad");
}
