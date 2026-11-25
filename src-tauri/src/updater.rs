use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::Write;
use std::path::PathBuf;

const GITHUB_REPO: &str = "Gartuja/LockPad";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub release_url: String,
    pub download_url: Option<String>,
    pub asset_name: Option<String>,
    pub notes: String,
}

#[derive(Debug, Deserialize)]
struct GithubAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Debug, Deserialize)]
struct GithubRelease {
    tag_name: String,
    html_url: String,
    body: Option<String>,
    assets: Vec<GithubAsset>,
}

#[derive(Debug, Deserialize)]
struct GithubTag {
    name: String,
}

fn parse_semver(v: &str) -> (u64, u64, u64) {
    let trimmed = v.trim().trim_start_matches(['v', 'V']);
    let mut parts = trimmed.split('.').map(|p| {
        p.chars()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
            .parse::<u64>()
            .unwrap_or(0)
    });
    (
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    )
}

fn is_newer(latest: &str, current: &str) -> bool {
    parse_semver(latest) > parse_semver(current)
}

fn is_allowed_github_url(url: &str) -> bool {
    if !url.starts_with("https://") {
        return false;
    }
    let host_and_rest = &url["https://".len()..];
    let host = host_and_rest.split('/').next().unwrap_or("").to_ascii_lowercase();
    if host == "github.com" {
        return host_and_rest
            .to_ascii_lowercase()
            .starts_with("github.com/gartuja/lockpad/");
    }
    host == "githubusercontent.com" || host.ends_with(".githubusercontent.com")
}

fn is_nsis_installed_windows() -> bool {
    #[cfg(target_os = "windows")]
    {
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                return dir.join("uninstall.exe").exists();
            }
        }
    }
    false
}

fn pick_platform_asset(assets: &[GithubAsset]) -> Option<&GithubAsset> {
    #[cfg(target_os = "windows")]
    {
        let installed_via_nsis = is_nsis_installed_windows();
        if installed_via_nsis {
            if let Some(setup) = assets.iter().find(|a| {
                let n = a.name.to_lowercase();
                n.ends_with(".exe")
                    && n.contains("setup")
                    && is_allowed_github_url(&a.browser_download_url)
            }) {
                return Some(setup);
            }
        }
        assets
            .iter()
            .find(|a| {
                let n = a.name.to_lowercase();
                n.ends_with(".zip")
                    && (n.contains("win") || n.contains("x64"))
                    && is_allowed_github_url(&a.browser_download_url)
            })
            .or_else(|| {
                assets.iter().find(|a| {
                    let n = a.name.to_lowercase();
                    n.ends_with(".exe")
                        && !n.contains("setup")
                        && is_allowed_github_url(&a.browser_download_url)
                })
            })
            .or_else(|| {
                assets.iter().find(|a| {
                    let n = a.name.to_lowercase();
                    (n.ends_with(".zip") || n.ends_with(".exe"))
                        && is_allowed_github_url(&a.browser_download_url)
                })
            })
    }

    #[cfg(target_os = "linux")]
    {
        assets
            .iter()
            .find(|a| {
                let n = a.name.to_lowercase();
                n.ends_with(".appimage") && is_allowed_github_url(&a.browser_download_url)
            })
            .or_else(|| {
                assets.iter().find(|a| {
                    let n = a.name.to_lowercase();
                    n.ends_with(".zip")
                        && n.contains("linux")
                        && is_allowed_github_url(&a.browser_download_url)
                })
            })
            .or_else(|| {
                assets.iter().find(|a| {
                    let n = a.name.to_lowercase();
                    n.ends_with(".deb") && is_allowed_github_url(&a.browser_download_url)
                })
            })
    }

    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        assets
            .iter()
            .find(|a| is_allowed_github_url(&a.browser_download_url))
    }
}

pub fn check_github_update(current_version: &str) -> Result<UpdateCheckResult, String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent(format!("LockPad/{current_version}"))
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| format!("Erro ao inicializar cliente HTTP: {e}"))?;

    let release_api = format!("https://api.github.com/repos/{GITHUB_REPO}/releases/latest");
    let resp = client
        .get(&release_api)
        .send()
        .map_err(|e| format!("Falha ao consultar GitHub: {e}"))?;

    if resp.status().is_success() {
        let rel: GithubRelease = resp
            .json()
            .map_err(|e| format!("Resposta inválida do GitHub: {e}"))?;
        let latest = rel.tag_name.trim_start_matches(['v', 'V']).to_string();
        let chosen_asset = pick_platform_asset(&rel.assets);

        return Ok(UpdateCheckResult {
            current_version: current_version.to_string(),
            latest_version: latest.clone(),
            update_available: is_newer(&latest, current_version),
            release_url: rel.html_url,
            download_url: chosen_asset.map(|a| a.browser_download_url.clone()),
            asset_name: chosen_asset.map(|a| a.name.clone()),
            notes: rel.body.unwrap_or_default(),
        });
    }

    let tags_api = format!("https://api.github.com/repos/{GITHUB_REPO}/tags");
    let tags_resp = client
        .get(&tags_api)
        .send()
        .map_err(|e| format!("Falha ao consultar tags do GitHub: {e}"))?;

    if tags_resp.status().is_success() {
        let tags: Vec<GithubTag> = tags_resp
            .json()
            .map_err(|e| format!("Resposta inválida de tags: {e}"))?;
        if let Some(first) = tags.first() {
            let latest = first.name.trim_start_matches(['v', 'V']).to_string();
            return Ok(UpdateCheckResult {
                current_version: current_version.to_string(),
                latest_version: latest.clone(),
                update_available: is_newer(&latest, current_version),
                release_url: format!("https://github.com/{GITHUB_REPO}/releases"),
                download_url: None,
                asset_name: None,
                notes: String::new(),
            });
        }
    }

    Ok(UpdateCheckResult {
        current_version: current_version.to_string(),
        latest_version: current_version.to_string(),
        update_available: false,
        release_url: format!("https://github.com/{GITHUB_REPO}/releases"),
        download_url: None,
        asset_name: None,
        notes: "Nenhuma release publicada no GitHub ainda.".to_string(),
    })
}

pub fn download_and_install_update(
    current_version: &str,
    download_url: &str,
) -> Result<String, String> {
    if !is_allowed_github_url(download_url) {
        return Err("URL de atualização bloqueada por não pertencer ao repositório oficial.".to_string());
    }

    let current_exe =
        std::env::current_exe().map_err(|e| format!("Erro ao localizar executável atual: {e}"))?;

    let client = reqwest::blocking::Client::builder()
        .user_agent(format!("LockPad/{current_version}"))
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| format!("Erro ao inicializar download: {e}"))?;

    let mut resp = client
        .get(download_url)
        .send()
        .map_err(|e| format!("Erro ao baixar atualização: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("Download falhou com status {}", resp.status()));
    }

    let final_url = resp.url().as_str().to_string();
    if !is_allowed_github_url(&final_url) {
        return Err(format!(
            "Redirecionamento para domínio não confiável bloqueado: {final_url}"
        ));
    }

    let mut payload = Vec::new();
    resp.copy_to(&mut payload)
        .map_err(|e| format!("Falha ao ler bytes da atualização: {e}"))?;
    if payload.len() < 1024 {
        return Err("Arquivo de atualização corrompido ou vazio.".to_string());
    }

    let update_dir = std::env::temp_dir().join(format!("lockpad_update_{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&update_dir).map_err(|e| format!("Erro ao criar pasta temp: {e}"))?;

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;

        let lower_url = download_url.to_lowercase();
        let is_setup_exe = lower_url.ends_with(".exe") && lower_url.contains("setup");

        if is_setup_exe {
            let setup_path: PathBuf = update_dir.join("LockPad_setup_new.exe");
            fs::write(&setup_path, &payload).map_err(|e| format!("Erro ao gravar instalador: {e}"))?;

            let pid = std::process::id();
            let bat_path = update_dir.join("apply_setup.cmd");
            let setup_str = setup_path.to_string_lossy();
            let target_str = current_exe.to_string_lossy();
            let dir_str = update_dir.to_string_lossy();

            let script = format!(
                "@echo off\r\n\
                 :waitloop\r\n\
                 tasklist /FI \"PID eq {pid}\" 2>NUL | find /I \"{pid}\" >NUL\r\n\
                 if not errorlevel 1 (\r\n\
                   timeout /t 1 /nobreak >NUL\r\n\
                   goto waitloop\r\n\
                 )\r\n\
                 \"{setup_str}\" /S\r\n\
                 start \"\" \"{target_str}\"\r\n\
                 rmdir /S /Q \"{dir_str}\" 2>NUL\r\n"
            );
            fs::write(&bat_path, script.as_bytes())
                .map_err(|e| format!("Erro ao criar script de atualização: {e}"))?;

            std::process::Command::new("cmd.exe")
                .args(["/C", &bat_path.to_string_lossy()])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|e| format!("Falha ao iniciar instalador de atualização: {e}"))?;
        } else {
            let staged_exe: PathBuf = update_dir.join("LockPad_new.exe");

            if lower_url.ends_with(".zip") {
                let cursor = std::io::Cursor::new(&payload);
                let mut archive =
                    zip::ZipArchive::new(cursor).map_err(|e| format!("ZIP inválido: {e}"))?;
                let mut found = false;
                for i in 0..archive.len() {
                    let mut entry = archive
                        .by_index(i)
                        .map_err(|e| format!("Erro ao ler item do ZIP: {e}"))?;
                    let name = entry.name().to_lowercase();
                    if name.ends_with(".exe")
                        && !name.contains("setup")
                        && !name.contains('/')
                        && !name.contains('\\')
                    {
                        let mut out = File::create(&staged_exe)
                            .map_err(|e| format!("Erro ao gravar exe: {e}"))?;
                        std::io::copy(&mut entry, &mut out)
                            .map_err(|e| format!("Erro ao extrair exe: {e}"))?;
                        found = true;
                        break;
                    }
                }
                if !found {
                    return Err("Nenhum executável encontrado dentro do pacote ZIP.".to_string());
                }
            } else if lower_url.ends_with(".exe") {
                fs::write(&staged_exe, &payload).map_err(|e| format!("Erro ao gravar exe: {e}"))?;
            } else {
                return Err("Formato de pacote de atualização não suportado.".to_string());
            }

            let pid = std::process::id();
            let bat_path = update_dir.join("apply_update.cmd");
            let target_str = current_exe.to_string_lossy();
            let staged_str = staged_exe.to_string_lossy();
            let dir_str = update_dir.to_string_lossy();

            // Retry loop ensures WebView2 subprocesses release file lock before deleting/replacing.
            let script = format!(
                "@echo off\r\n\
                 :waitloop\r\n\
                 tasklist /FI \"PID eq {pid}\" 2>NUL | find /I \"{pid}\" >NUL\r\n\
                 if not errorlevel 1 (\r\n\
                   timeout /t 1 /nobreak >NUL\r\n\
                   goto waitloop\r\n\
                 )\r\n\
                 set tries=0\r\n\
                 :replaceloop\r\n\
                 set /a tries+=1\r\n\
                 del /F /Q \"{target_str}\" >NUL 2>&1\r\n\
                 move /Y \"{staged_str}\" \"{target_str}\" >NUL 2>&1\r\n\
                 if errorlevel 1 (\r\n\
                   if %tries% LSS 15 (\r\n\
                     timeout /t 1 /nobreak >NUL\r\n\
                     goto replaceloop\r\n\
                   )\r\n\
                 )\r\n\
                 start \"\" \"{target_str}\"\r\n\
                 rmdir /S /Q \"{dir_str}\" 2>NUL\r\n"
            );
            let mut f = File::create(&bat_path)
                .map_err(|e| format!("Erro ao criar script de atualização: {e}"))?;
            f.write_all(script.as_bytes())
                .map_err(|e| format!("Erro ao gravar script: {e}"))?;

            std::process::Command::new("cmd.exe")
                .args(["/C", &bat_path.to_string_lossy()])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|e| format!("Falha ao iniciar processo de atualização: {e}"))?;
        }
    }

    #[cfg(target_os = "linux")]
    {
        use std::os::unix::fs::PermissionsExt;

        let lower_url = download_url.to_lowercase();
        let pid = std::process::id();

        if lower_url.ends_with(".deb") {
            let deb_path = update_dir.join("lockpad_new.deb");
            fs::write(&deb_path, &payload).map_err(|e| format!("Erro ao gravar .deb: {e}"))?;
            let sh_path = update_dir.join("apply_deb.sh");
            let deb_str = deb_path.to_string_lossy();
            let dir_str = update_dir.to_string_lossy();
            let script = format!(
                "#!/bin/sh\n\
                 while kill -0 {pid} 2>/dev/null; do sleep 0.3; done\n\
                 pkexec dpkg -i '{deb_str}' && nohup lockpad >/dev/null 2>&1 &\n\
                 rm -rf '{dir_str}'\n"
            );
            fs::write(&sh_path, script.as_bytes())
                .map_err(|e| format!("Erro ao criar script .deb: {e}"))?;
            fs::set_permissions(&sh_path, fs::Permissions::from_mode(0o755))
                .map_err(|e| format!("Erro ao dar permissão ao script: {e}"))?;
            std::process::Command::new("sh")
                .arg(&sh_path)
                .spawn()
                .map_err(|e| format!("Falha ao iniciar atualização .deb: {e}"))?;
        } else {
            let target_bin = std::env::var_os("APPIMAGE")
                .map(PathBuf::from)
                .unwrap_or(current_exe);
            let staged_bin = update_dir.join("lockpad_new");

            if lower_url.ends_with(".zip") {
                let cursor = std::io::Cursor::new(&payload);
                let mut archive =
                    zip::ZipArchive::new(cursor).map_err(|e| format!("ZIP inválido: {e}"))?;
                let mut found = false;
                for i in 0..archive.len() {
                    let mut entry = archive
                        .by_index(i)
                        .map_err(|e| format!("Erro ao ler item do ZIP: {e}"))?;
                    let name = entry.name().to_lowercase();
                    if (name.ends_with("lockpad") || name.ends_with(".appimage"))
                        && !name.contains('/')
                    {
                        let mut out = File::create(&staged_bin)
                            .map_err(|e| format!("Erro ao gravar binário: {e}"))?;
                        std::io::copy(&mut entry, &mut out)
                            .map_err(|e| format!("Erro ao extrair binário: {e}"))?;
                        found = true;
                        break;
                    }
                }
                if !found {
                    return Err("Nenhum binário Linux encontrado dentro do pacote ZIP.".to_string());
                }
            } else {
                fs::write(&staged_bin, &payload)
                    .map_err(|e| format!("Erro ao gravar binário: {e}"))?;
            }

            fs::set_permissions(&staged_bin, fs::Permissions::from_mode(0o755))
                .map_err(|e| format!("Erro ao aplicar permissão executável: {e}"))?;

            let sh_path = update_dir.join("apply_update.sh");
            let target_str = target_bin.to_string_lossy();
            let staged_str = staged_bin.to_string_lossy();
            let dir_str = update_dir.to_string_lossy();

            let script = format!(
                "#!/bin/sh\n\
                 while kill -0 {pid} 2>/dev/null; do sleep 0.3; done\n\
                 rm -f '{target_str}'\n\
                 mv -f '{staged_str}' '{target_str}'\n\
                 chmod +x '{target_str}'\n\
                 nohup '{target_str}' >/dev/null 2>&1 &\n\
                 rm -rf '{dir_str}'\n"
            );
            fs::write(&sh_path, script.as_bytes())
                .map_err(|e| format!("Erro ao criar script de atualização: {e}"))?;
            fs::set_permissions(&sh_path, fs::Permissions::from_mode(0o755))
                .map_err(|e| format!("Erro ao dar permissão ao script: {e}"))?;

            std::process::Command::new("sh")
                .arg(&sh_path)
                .spawn()
                .map_err(|e| format!("Falha ao iniciar processo de atualização: {e}"))?;
        }
    }

    Ok("Atualização baixada. Removendo versão antiga e reiniciando LockPad...".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semver_and_url_allowlist_work() {
        assert!(is_newer("1.8.0", "1.7.0"));
        assert!(is_newer("v2.0.0", "1.9.9"));
        assert!(!is_newer("1.7.0", "1.7.0"));
        assert!(!is_newer("1.6.0", "1.7.0"));

        assert!(is_allowed_github_url(
            "https://github.com/Gartuja/LockPad/releases/download/v1.7.0/LockPad-v1.7.0-win64.zip"
        ));
        assert!(is_allowed_github_url(
            "https://objects.githubusercontent.com/github-production-release-asset-2e65be/abc"
        ));
        assert!(is_allowed_github_url(
            "https://release-assets.githubusercontent.com/github-production-release-asset/123"
        ));
        assert!(!is_allowed_github_url("https://evil.com/LockPad.exe"));
        assert!(!is_allowed_github_url("http://github.com/Gartuja/LockPad/releases"));
        assert!(!is_allowed_github_url(
            "https://github.com/OtherUser/OtherRepo/releases/download/v1/a.exe"
        ));
    }

    #[test]
    #[ignore]
    fn live_github_release_check_and_redirect() {
        let res = check_github_update("1.6.0").expect("check_github_update failed");
        println!("Live release check: {:?}", res);
        assert!(res.update_available);
        let url = res.download_url.expect("expected release download_url");
        let client = reqwest::blocking::Client::builder()
            .user_agent("LockPad/1.6.0")
            .build()
            .unwrap();
        let head = client.head(&url).send().expect("HEAD download failed");
        let final_url = head.url().as_str().to_string();
        println!("Redirect final URL: {}", final_url);
        assert!(head.status().is_success());
        assert!(is_allowed_github_url(&final_url));
    }
}
