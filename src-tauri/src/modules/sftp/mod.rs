use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::{Deserialize, Serialize};
use tempfile::TempDir;

const LEGACY_RSA_OPTIONS: [&str; 2] = [
    "HostKeyAlgorithms=+ssh-rsa",
    "PubkeyAcceptedKeyTypes=+ssh-rsa",
];

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SftpHostConfig {
    hostname: String,
    port: u16,
    username: Option<String>,
    key_path: Option<String>,
    password: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SftpEntry {
    name: String,
    path: String,
    is_dir: bool,
    size: Option<u64>,
    modified: Option<String>,
    permissions: String,
}

#[tauri::command]
pub async fn sftp_list(config: SftpHostConfig, path: String) -> Result<Vec<SftpEntry>, String> {
    let path = validate_path("remote path", path)?;
    let output = run_sftp(config, vec![format!("ls -la {}", quote_batch_path(&path))]).await?;
    Ok(parse_listing(&output, &path))
}

#[tauri::command]
pub async fn sftp_mkdir(config: SftpHostConfig, path: String) -> Result<(), String> {
    let path = validate_path("remote path", path)?;
    run_sftp(config, vec![format!("mkdir {}", quote_batch_path(&path))]).await?;
    Ok(())
}

#[tauri::command]
pub async fn sftp_delete(config: SftpHostConfig, path: String, is_dir: bool) -> Result<(), String> {
    let path = validate_path("remote path", path)?;
    let command = if is_dir { "rmdir" } else { "rm" };
    run_sftp(
        config,
        vec![format!("{command} {}", quote_batch_path(&path))],
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn sftp_rename(config: SftpHostConfig, from: String, to: String) -> Result<(), String> {
    let from = validate_path("source path", from)?;
    let to = validate_path("destination path", to)?;
    run_sftp(
        config,
        vec![format!(
            "rename {} {}",
            quote_batch_path(&from),
            quote_batch_path(&to)
        )],
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn sftp_download(
    config: SftpHostConfig,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    let remote_path = validate_path("remote path", remote_path)?;
    let local_path = validate_path("local path", local_path)?;
    run_sftp(
        config,
        vec![format!(
            "get -p {} {}",
            quote_batch_path(&remote_path),
            quote_batch_path(&local_path)
        )],
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn sftp_upload(
    config: SftpHostConfig,
    local_path: String,
    remote_path: String,
) -> Result<(), String> {
    let local_path = validate_path("local path", local_path)?;
    let remote_path = validate_path("remote path", remote_path)?;
    run_sftp(
        config,
        vec![format!(
            "put -p {} {}",
            quote_batch_path(&local_path),
            quote_batch_path(&remote_path)
        )],
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn sftp_upload_into(
    config: SftpHostConfig,
    local_paths: Vec<String>,
    remote_dir: String,
) -> Result<(), String> {
    if local_paths.is_empty() {
        return Err("no local paths provided".to_string());
    }
    let remote_dir = validate_path("remote path", remote_dir)?;
    let mut commands = Vec::new();
    let mut top_level_names = std::collections::HashSet::new();
    for local_path in local_paths {
        let local_path = validate_path("local path", local_path)?;
        let source = PathBuf::from(&local_path);
        if !source.exists() {
            return Err(format!("not found: {}", source.display()));
        }
        let name = source
            .file_name()
            .and_then(|v| v.to_str())
            .ok_or_else(|| format!("local path must include a file name: {}", source.display()))?;
        if !top_level_names.insert(name.to_string()) {
            return Err(format!("duplicate dropped item name: {name}"));
        }
        let remote_path = join_remote_path(&remote_dir, name);
        collect_upload_commands(&source, &remote_path, &mut commands)?;
    }
    run_sftp(config, commands).await?;
    Ok(())
}

#[tauri::command]
pub async fn sftp_move_into(
    config: SftpHostConfig,
    remote_paths: Vec<String>,
    remote_dir: String,
) -> Result<(), String> {
    let commands = collect_move_commands(remote_paths, remote_dir)?;
    run_sftp(config, commands).await?;
    Ok(())
}

#[tauri::command]
pub async fn sftp_copy_into(
    config: SftpHostConfig,
    remote_paths: Vec<String>,
    remote_dir: String,
) -> Result<(), String> {
    if remote_paths.is_empty() {
        return Err("no remote paths provided".to_string());
    }
    let remote_dir = validate_path("remote path", remote_dir)?;
    let temp = TempDir::new().map_err(|e| format!("failed to create temp dir: {e}"))?;
    let mut download_commands = Vec::new();
    let mut local_sources = Vec::new();
    let mut top_level_names = std::collections::HashSet::new();
    for remote_path in remote_paths {
        let remote_path = validate_path("remote path", remote_path)?;
        let name = remote_basename(&remote_path)?;
        if !top_level_names.insert(name.to_string()) {
            return Err(format!("duplicate copied item name: {name}"));
        }
        let local_path = temp.path().join(name);
        download_commands.push(format!(
            "get -Pr {} {}",
            quote_batch_path(&remote_path),
            quote_batch_path(&local_path.to_string_lossy())
        ));
        local_sources.push((local_path, join_remote_path(&remote_dir, name)));
    }

    run_sftp(config.clone(), download_commands).await?;

    let mut upload_commands = Vec::new();
    for (local_path, remote_path) in local_sources {
        collect_upload_commands(&local_path, &remote_path, &mut upload_commands)?;
    }
    run_sftp(config, upload_commands).await?;
    Ok(())
}

async fn run_sftp(config: SftpHostConfig, commands: Vec<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || run_sftp_blocking(config, commands))
        .await
        .map_err(|e| format!("sftp task failed: {e}"))?
}

fn collect_upload_commands(
    source: &Path,
    remote_path: &str,
    commands: &mut Vec<String>,
) -> Result<(), String> {
    let meta = std::fs::symlink_metadata(source).map_err(|e| {
        log::debug!("sftp_upload_into stat({}) failed: {e}", source.display());
        e.to_string()
    })?;
    if meta.is_dir() {
        commands.push(format!("mkdir {}", quote_batch_path(remote_path)));
        for entry in std::fs::read_dir(source).map_err(|e| {
            log::debug!(
                "sftp_upload_into read_dir({}) failed: {e}",
                source.display()
            );
            e.to_string()
        })? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name();
            let name = name
                .to_str()
                .ok_or_else(|| format!("path is not valid UTF-8: {}", entry.path().display()))?;
            let child_remote = join_remote_path(remote_path, name);
            collect_upload_commands(&entry.path(), &child_remote, commands)?;
        }
        return Ok(());
    }

    commands.push(format!(
        "put -p {} {}",
        quote_batch_path(&source.to_string_lossy()),
        quote_batch_path(remote_path)
    ));
    Ok(())
}

fn collect_move_commands(
    remote_paths: Vec<String>,
    remote_dir: String,
) -> Result<Vec<String>, String> {
    if remote_paths.is_empty() {
        return Err("no remote paths provided".to_string());
    }
    let remote_dir = validate_path("remote path", remote_dir)?;
    let mut commands = Vec::new();
    let mut top_level_names = std::collections::HashSet::new();
    for remote_path in remote_paths {
        let remote_path = validate_path("remote path", remote_path)?;
        let name = remote_basename(&remote_path)?;
        if !top_level_names.insert(name.to_string()) {
            return Err(format!("duplicate moved item name: {name}"));
        }
        let target = join_remote_path(&remote_dir, name);
        if target == remote_path
            || remote_dir.starts_with(&format!("{}/", remote_path.trim_end_matches('/')))
        {
            return Err("cannot move a directory into itself".to_string());
        }
        commands.push(format!(
            "rename {} {}",
            quote_batch_path(&remote_path),
            quote_batch_path(&target)
        ));
    }
    Ok(commands)
}

fn run_sftp_blocking(config: SftpHostConfig, commands: Vec<String>) -> Result<String, String> {
    let config = normalize_config(config)?;
    let mut command = Command::new("sftp");
    command.arg("-q").arg("-P").arg(config.port.to_string());
    for option in LEGACY_RSA_OPTIONS {
        command.arg("-o").arg(option);
    }

    let _askpass = if let Some(password) = config.password {
        command
            .arg("-oBatchMode=no")
            .arg("-oPreferredAuthentications=password,keyboard-interactive")
            .arg("-oPubkeyAuthentication=no");
        Some(configure_askpass(&mut command, &password)?)
    } else {
        command.arg("-oBatchMode=yes");
        None
    };

    if let Some(key_path) = config.key_path {
        command.arg("-i").arg(key_path);
    }

    command
        .arg("-b")
        .arg("-")
        .arg(config.target)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = command
        .spawn()
        .map_err(|e| format!("failed to start sftp: {e}"))?;

    {
        let stdin = child
            .stdin
            .as_mut()
            .ok_or_else(|| "failed to open sftp stdin".to_string())?;
        for cmd in commands {
            stdin
                .write_all(cmd.as_bytes())
                .map_err(|e| format!("failed to write sftp command: {e}"))?;
            stdin
                .write_all(b"\n")
                .map_err(|e| format!("failed to write sftp command: {e}"))?;
        }
    }

    let output = child
        .wait_with_output()
        .map_err(|e| format!("failed to wait for sftp: {e}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if output.status.success() {
        return Ok(stdout);
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let message = stderr.trim();
    if message.is_empty() {
        Err(format!("sftp exited with status {}", output.status))
    } else {
        Err(message.to_string())
    }
}

struct NormalizedConfig {
    target: String,
    port: u16,
    key_path: Option<String>,
    password: Option<String>,
}

fn normalize_config(config: SftpHostConfig) -> Result<NormalizedConfig, String> {
    let hostname = validate_value("host", config.hostname)?;
    let username = config
        .username
        .map(|v| validate_value("user", v))
        .transpose()?
        .filter(|v| !v.is_empty());
    let key_path = config
        .key_path
        .map(|v| validate_path("key path", v))
        .transpose()?
        .filter(|v| !v.is_empty());
    let password = config.password.filter(|v| !v.is_empty());
    let target = match username {
        Some(username) => format!("{username}@{hostname}"),
        None => hostname,
    };
    Ok(NormalizedConfig {
        target,
        port: config.port,
        key_path,
        password,
    })
}

fn configure_askpass(command: &mut Command, password: &str) -> Result<TempDir, String> {
    let dir = TempDir::new().map_err(|e| format!("failed to create askpass helper: {e}"))?;
    let helper = askpass_path(dir.path());
    write_askpass_helper(&helper)?;
    command
        .env("SSH_ASKPASS", &helper)
        .env("SSH_ASKPASS_REQUIRE", "force")
        .env("OMNITAB_SFTP_PASSWORD", password)
        .env("DISPLAY", "omnitab");
    Ok(dir)
}

#[cfg(windows)]
fn askpass_path(dir: &Path) -> PathBuf {
    dir.join("omnitab-sftp-askpass.cmd")
}

#[cfg(not(windows))]
fn askpass_path(dir: &Path) -> PathBuf {
    dir.join("omnitab-sftp-askpass")
}

#[cfg(windows)]
fn write_askpass_helper(path: &Path) -> Result<(), String> {
    std::fs::write(
        path,
        "@echo off\r\npowershell.exe -NoProfile -NonInteractive -Command \"[Console]::Out.WriteLine($env:OMNITAB_SFTP_PASSWORD)\"\r\n",
    )
    .map_err(|e| format!("failed to write askpass helper: {e}"))
}

#[cfg(not(windows))]
fn write_askpass_helper(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    std::fs::write(
        path,
        "#!/bin/sh\nprintf '%s\\n' \"$OMNITAB_SFTP_PASSWORD\"\n",
    )
    .map_err(|e| format!("failed to write askpass helper: {e}"))?;
    let mut permissions = std::fs::metadata(path)
        .map_err(|e| format!("failed to stat askpass helper: {e}"))?
        .permissions();
    permissions.set_mode(0o700);
    std::fs::set_permissions(path, permissions)
        .map_err(|e| format!("failed to set askpass permissions: {e}"))
}

fn validate_value(label: &str, value: String) -> Result<String, String> {
    let value = value.trim().to_string();
    if value.is_empty() {
        return Err(format!("{label} is required"));
    }
    reject_control_chars(label, &value)?;
    Ok(value)
}

fn validate_path(label: &str, value: String) -> Result<String, String> {
    let value = value.trim().to_string();
    if value.is_empty() {
        return Err(format!("{label} is required"));
    }
    reject_control_chars(label, &value)?;
    Ok(value)
}

fn reject_control_chars(label: &str, value: &str) -> Result<(), String> {
    if value.chars().any(|c| matches!(c, '\0' | '\n' | '\r')) {
        return Err(format!("{label} contains an invalid character"));
    }
    Ok(())
}

fn quote_batch_path(path: &str) -> String {
    let mut out = String::with_capacity(path.len() + 2);
    out.push('"');
    for ch in path.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '$' => out.push_str("\\$"),
            '`' => out.push_str("\\`"),
            _ => out.push(ch),
        }
    }
    out.push('"');
    out
}

fn parse_listing(output: &str, base: &str) -> Vec<SftpEntry> {
    let mut entries = Vec::new();
    for line in output.lines() {
        if let Some(entry) = parse_listing_line(line, base) {
            entries.push(entry);
        }
    }
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    entries
}

fn parse_listing_line(line: &str, base: &str) -> Option<SftpEntry> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with("sftp>") {
        return None;
    }
    let parts: Vec<&str> = trimmed.split_whitespace().collect();
    if parts.len() < 9 {
        return None;
    }
    let permissions = parts[0];
    if permissions.len() < 10 {
        return None;
    }
    let name = parts[8..].join(" ");
    if name == "." || name == ".." || name.is_empty() {
        return None;
    }
    let is_dir = permissions.starts_with('d');
    let size = parts.get(4).and_then(|v| v.parse::<u64>().ok());
    let modified = Some(format!("{} {} {}", parts[5], parts[6], parts[7]));
    Some(SftpEntry {
        path: join_remote_path(base, &name),
        name,
        is_dir,
        size,
        modified,
        permissions: permissions.to_string(),
    })
}

fn join_remote_path(base: &str, name: &str) -> String {
    let clean_name = name.trim_start_matches('/');
    if base.is_empty() || base == "." {
        return clean_name.to_string();
    }
    if base == "/" {
        return format!("/{clean_name}");
    }
    format!("{}/{}", base.trim_end_matches('/'), clean_name)
}

fn remote_basename(path: &str) -> Result<&str, String> {
    let clean = path.trim_end_matches('/');
    let name = clean.rsplit('/').next().unwrap_or(clean);
    if name.is_empty() || name == "." || name == ".." {
        return Err(format!("remote path must include a file name: {path}"));
    }
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_batch_paths() {
        assert_eq!(
            quote_batch_path(r#"/tmp/a "quoted" file"#),
            r#""/tmp/a \"quoted\" file""#
        );
        assert_eq!(quote_batch_path(r#"/tmp/a\b"#), r#""/tmp/a\\b""#);
    }

    #[test]
    fn parses_long_listing() {
        let output = "\
drwxr-xr-x    5 deploy deploy     4096 Jan 02 12:30 releases
-rw-r--r--    1 deploy deploy      128 Feb 14  2025 app log.txt
";
        let entries = parse_listing(output, "/var/www");
        assert_eq!(
            entries,
            vec![
                SftpEntry {
                    name: "releases".to_string(),
                    path: "/var/www/releases".to_string(),
                    is_dir: true,
                    size: Some(4096),
                    modified: Some("Jan 02 12:30".to_string()),
                    permissions: "drwxr-xr-x".to_string(),
                },
                SftpEntry {
                    name: "app log.txt".to_string(),
                    path: "/var/www/app log.txt".to_string(),
                    is_dir: false,
                    size: Some(128),
                    modified: Some("Feb 14 2025".to_string()),
                    permissions: "-rw-r--r--".to_string(),
                },
            ]
        );
    }

    #[test]
    fn rejects_newline_paths() {
        let err = validate_path("remote path", "safe\nrm *".to_string()).unwrap_err();
        assert!(err.contains("invalid character"));
    }

    #[test]
    fn parse_listing_skips_dot_entries() {
        let output = "\
drwxr-xr-x    5 deploy deploy     4096 Jan 02 12:30 .
drwxr-xr-x    5 deploy deploy     4096 Jan 02 12:30 ..
drwxr-xr-x    5 deploy deploy     4096 Jan 02 12:30 releases
";
        let entries = parse_listing(output, "/var/www");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].name, "releases");
    }

    #[test]
    fn collects_recursive_upload_commands() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("site");
        std::fs::create_dir_all(source.join("assets")).unwrap();
        std::fs::write(source.join("index.html"), b"html").unwrap();
        std::fs::write(source.join("assets/app.js"), b"js").unwrap();

        let mut commands = Vec::new();
        collect_upload_commands(&source, "/var/www/site", &mut commands).expect("commands");

        assert_eq!(commands[0], r#"mkdir "/var/www/site""#);
        assert!(commands.contains(&format!(
            "put -p {} {}",
            quote_batch_path(&source.join("index.html").to_string_lossy()),
            quote_batch_path("/var/www/site/index.html")
        )));
        assert!(commands.contains(&r#"mkdir "/var/www/site/assets""#.to_string()));
        assert!(commands.contains(&format!(
            "put -p {} {}",
            quote_batch_path(&source.join("assets/app.js").to_string_lossy()),
            quote_batch_path("/var/www/site/assets/app.js")
        )));
    }

    #[test]
    fn collects_move_commands_into_remote_dir() {
        let commands = collect_move_commands(
            vec!["/var/www/app.log".to_string(), "/var/www/site".to_string()],
            "/var/archive".to_string(),
        )
        .expect("commands");

        assert_eq!(
            commands,
            vec![
                r#"rename "/var/www/app.log" "/var/archive/app.log""#.to_string(),
                r#"rename "/var/www/site" "/var/archive/site""#.to_string(),
            ]
        );
    }

    #[test]
    fn move_commands_refuse_directory_into_itself() {
        let err = collect_move_commands(
            vec!["/var/www/site".to_string()],
            "/var/www/site/assets".to_string(),
        )
        .unwrap_err();
        assert!(err.contains("cannot move a directory into itself"));
    }

    #[test]
    fn enables_legacy_rsa_ssh_compatibility() {
        assert_eq!(
            LEGACY_RSA_OPTIONS,
            [
                "HostKeyAlgorithms=+ssh-rsa",
                "PubkeyAcceptedKeyTypes=+ssh-rsa"
            ]
        );
    }
}
