pub mod modules;

use modules::{agent, browser, fs, git, net, pty, secrets, sftp, shell, workspace};
use std::{collections::HashMap, sync::Mutex};
#[cfg(target_os = "macos")]
use tauri::WindowEvent;
use tauri::{
    Emitter, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_window_state::StateFlags;

/// Drained on first read so HMR / re-mounts can't replay the launch dir.
#[derive(Default)]
struct LaunchDir(Mutex<Option<String>>);

#[derive(Default)]
struct TabDragState(Mutex<TabDragStore>);

#[derive(Default)]
struct TabDragStore {
    drag: Option<TabDragPayload>,
    metrics: HashMap<String, serde_json::Value>,
}

struct TabDragPayload {
    transfer_id: String,
    payload: String,
}

#[derive(serde::Deserialize)]
struct WindowPosition {
    x: i32,
    y: i32,
}

#[tauri::command]
fn get_launch_dir(state: State<'_, LaunchDir>) -> Option<String> {
    state.0.lock().expect("LaunchDir mutex poisoned").take()
}

#[tauri::command]
fn tab_drag_start(
    state: State<'_, TabDragState>,
    transfer_id: String,
    payload: String,
) -> Result<(), String> {
    state.0.lock().expect("TabDragState mutex poisoned").drag = Some(TabDragPayload {
        transfer_id,
        payload,
    });
    Ok(())
}

#[tauri::command]
fn tab_drag_payload(state: State<'_, TabDragState>) -> Option<String> {
    state
        .0
        .lock()
        .expect("TabDragState mutex poisoned")
        .drag
        .as_ref()
        .map(|p| p.payload.clone())
}

#[tauri::command]
fn tab_drag_end(state: State<'_, TabDragState>, transfer_id: String) -> Result<(), String> {
    let mut store = state.0.lock().expect("TabDragState mutex poisoned");
    if store
        .drag
        .as_ref()
        .map(|p| p.transfer_id.as_str() == transfer_id)
        .unwrap_or(false)
    {
        store.drag = None;
    }
    Ok(())
}

#[tauri::command]
fn tab_drag_set_metrics(
    state: State<'_, TabDragState>,
    label: String,
    metrics: serde_json::Value,
) -> Result<(), String> {
    state
        .0
        .lock()
        .expect("TabDragState mutex poisoned")
        .metrics
        .insert(label, metrics);
    Ok(())
}

#[tauri::command]
fn tab_drag_clear_metrics(state: State<'_, TabDragState>, label: String) -> Result<(), String> {
    state
        .0
        .lock()
        .expect("TabDragState mutex poisoned")
        .metrics
        .remove(&label);
    Ok(())
}

#[tauri::command]
fn tab_drag_metrics(state: State<'_, TabDragState>) -> Vec<serde_json::Value> {
    state
        .0
        .lock()
        .expect("TabDragState mutex poisoned")
        .metrics
        .values()
        .cloned()
        .collect()
}

#[tauri::command]
fn tab_drag_set_window_position(
    app: tauri::AppHandle,
    label: String,
    x: i32,
    y: i32,
) -> Result<(), String> {
    let window = app
        .get_webview_window(&label)
        .ok_or_else(|| format!("window not found: {label}"))?;
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}

fn parse_launch_dir() -> Option<String> {
    for arg in std::env::args().skip(1) {
        if arg.starts_with('-') {
            continue;
        }
        let Ok(canon) = std::fs::canonicalize(&arg) else {
            continue;
        };
        if !canon.is_dir() {
            continue;
        }
        return Some(crate::modules::fs::to_canon(&canon));
    }
    None
}

fn next_main_window_label(app: &tauri::AppHandle) -> String {
    for i in 2..u32::MAX {
        let label = format!("main-{i}");
        if app.get_webview_window(&label).is_none() {
            return label;
        }
    }
    format!("main-{}", uuid_like_suffix())
}

fn uuid_like_suffix() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos().to_string())
        .unwrap_or_else(|_| "fallback".to_string())
}

fn encode_url_component(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for b in value.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn append_query_param(url: &mut String, key: &str, value: &str) {
    url.push(if url.contains('?') { '&' } else { '?' });
    url.push_str(key);
    url.push('=');
    url.push_str(value);
}

#[tauri::command]
async fn open_main_window(
    app: tauri::AppHandle,
    source: WebviewWindow,
    registry: State<'_, workspace::WorkspaceRegistry>,
    cwd: Option<String>,
    position: Option<WindowPosition>,
    detached_drag: Option<bool>,
    defer_show: Option<bool>,
) -> Result<String, String> {
    let cwd = cwd.map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    if let Some(ref cwd) = cwd {
        let _ = registry.authorize(cwd).map_err(|e| e.to_string())?;
    }

    let label = next_main_window_label(&app);
    let mut url = match cwd {
        Some(cwd) => format!("index.html?launchCwd={}", encode_url_component(&cwd)),
        None => "index.html".to_string(),
    };
    if detached_drag.unwrap_or(false) {
        append_query_param(&mut url, "detachedDrag", "1");
    }
    if defer_show.unwrap_or(false) {
        append_query_param(&mut url, "deferShow", "1");
    }

    let builder = WebviewWindowBuilder::new(&app, label.clone(), WebviewUrl::App(url.into()))
        .title("OmniTab")
        .inner_size(800.0, 600.0)
        .min_inner_size(420.0, 280.0)
        .resizable(true)
        .visible(false);

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    #[cfg(any(target_os = "linux", target_os = "windows"))]
    let builder = builder.decorations(false).transparent(true).shadow(false);

    let window = builder.build().map_err(|e| e.to_string())?;

    if let Some(pos) = position {
        let _ = window.set_position(PhysicalPosition::new(pos.x, pos.y));
    } else if let Ok(pos) = source.outer_position() {
        let _ = window.set_position(PhysicalPosition::new(pos.x + 32, pos.y + 32));
    } else {
        let _ = window.center();
    }

    #[cfg(target_os = "linux")]
    {
        let _ = window.set_decorations(false);
    }

    Ok(label)
}

#[tauri::command]
async fn open_settings_window(app: tauri::AppHandle, tab: Option<String>) -> Result<(), String> {
    let url_path = match tab.as_deref() {
        Some(t) if !t.is_empty() => format!("settings.html?tab={}", t),
        _ => "settings.html".to_string(),
    };

    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.set_always_on_top(true);
        let _ = window.show();
        let _ = window.set_focus();
        if let Some(t) = tab.as_deref().filter(|s| !s.is_empty()) {
            // emit() serializes via JSON — no string-escape footgun, unlike
            // eval() with format!(). Frontend listens via Tauri event API.
            let _ = window.emit("omnitab:settings-tab", t);
        }
        return Ok(());
    }

    let builder = WebviewWindowBuilder::new(&app, "settings", WebviewUrl::App(url_path.into()))
        .title("Settings")
        .inner_size(900.0, 700.0)
        .min_inner_size(820.0, 620.0)
        .resizable(true)
        .visible(false)
        // Keep settings above the main app window so it doesn't get hidden
        // when the user clicks back into the editor or terminal (#33).
        .always_on_top(true);

    // Tie lifecycle to the main window so settings minimizes/closes with it.
    // macOS: skip parent() — child + always_on_top leaves the settings webview
    // behind the main window except while the parent is being dragged (#33).
    #[cfg(not(target_os = "macos"))]
    let builder = if let Some(main) = app.get_webview_window("main") {
        builder.parent(&main).map_err(|e| e.to_string())?
    } else {
        builder
    };

    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    // On Linux/Windows we render our own titlebar, so drop native chrome
    // and make the window transparent.
    #[cfg(any(target_os = "linux", target_os = "windows"))]
    let builder = builder.decorations(false).transparent(true);

    let window = builder.build().map_err(|e| e.to_string())?;

    // Some Linux compositors (GNOME/Mutter with CSD-by-default) ignore the
    // builder-time decorations flag — re-assert it after realize.
    #[cfg(target_os = "linux")]
    {
        let _ = window.set_decorations(false);
    }

    #[cfg(target_os = "macos")]
    if let Some(main) = app.get_webview_window("main") {
        if let (Ok(main_pos), Ok(main_size), Ok(settings_size)) = (
            main.outer_position(),
            main.outer_size(),
            window.outer_size(),
        ) {
            let x = main_pos.x
                + ((main_size.width as i32).saturating_sub(settings_size.width as i32)) / 2;
            let y = main_pos.y
                + ((main_size.height as i32).saturating_sub(settings_size.height as i32)) / 2;
            let _ = window.set_position(PhysicalPosition::new(x, y));
        } else {
            let _ = window.center();
        }
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cli_dir = parse_launch_dir();
    workspace::init_launch_cwd(cli_dir.as_deref());

    tauri::Builder::default()
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Skip restoring VISIBLE — frontend calls window.show() after first
        // paint so the user never sees a transparent window-shadow flash on
        // Windows/Linux.
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(StateFlags::all() & !StateFlags::VISIBLE)
                .build(),
        )
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(tauri_plugin_log::log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .on_page_load(browser::emit_page_load)
        .setup(|_app| {
            // macOS skips parent() for the settings window, so tie its lifecycle
            // to the main window here instead. Other platforms keep parent().
            #[cfg(target_os = "macos")]
            if let Some(main) = _app.get_webview_window("main") {
                let handle = _app.handle().clone();
                main.on_window_event(move |event| {
                    if matches!(
                        event,
                        WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed
                    ) {
                        if let Some(settings) = handle.get_webview_window("settings") {
                            let _ = settings.close();
                        }
                    }
                });
            }
            Ok(())
        })
        .manage(pty::PtyState::default())
        .manage(shell::ShellState::default())
        .manage(secrets::SecretsState::default())
        .manage(fs::watch::FsWatchState::default())
        .manage({
            let registry = workspace::WorkspaceRegistry::default();
            workspace::bootstrap_registry(&registry);
            if let Some(ref launch_dir) = cli_dir {
                let _ = registry.authorize(launch_dir);
            }
            registry
        })
        .manage(LaunchDir(Mutex::new(cli_dir)))
        .manage(TabDragState::default())
        .invoke_handler(tauri::generate_handler![
            pty::pty_open,
            pty::pty_attach,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_close,
            pty::pty_close_all,
            pty::pty_has_foreground_process,
            fs::tree::list_subdirs,
            fs::tree::fs_read_dir,
            fs::file::fs_read_file,
            fs::file::fs_write_file,
            fs::file::fs_stat,
            fs::file::fs_canonicalize,
            fs::mutate::fs_create_file,
            fs::mutate::fs_create_dir,
            fs::mutate::fs_rename,
            fs::mutate::fs_delete,
            fs::watch::fs_watch_add,
            fs::watch::fs_watch_remove,
            fs::search::fs_search,
            fs::search::fs_list_files,
            fs::grep::fs_grep,
            fs::grep::fs_glob,
            git::commands::git_resolve_repo,
            git::commands::git_panel_snapshot,
            git::commands::git_status,
            git::commands::git_diff,
            git::commands::git_diff_content,
            git::commands::git_stage,
            git::commands::git_unstage,
            git::commands::git_discard,
            git::commands::git_commit,
            git::commands::git_fetch,
            git::commands::git_pull_ff_only,
            git::commands::git_push,
            git::commands::git_log,
            git::commands::git_show_commit,
            git::commands::git_commit_files,
            git::commands::git_commit_file_diff,
            git::commands::git_remote_url,
            shell::shell_run_command,
            shell::shell_session_open,
            shell::shell_session_run,
            shell::shell_session_close,
            shell::shell_bg_spawn,
            shell::shell_bg_logs,
            shell::shell_bg_kill,
            shell::shell_bg_list,
            sftp::sftp_list,
            sftp::sftp_mkdir,
            sftp::sftp_delete,
            sftp::sftp_rename,
            sftp::sftp_download,
            sftp::sftp_upload,
            workspace::wsl_list_distros,
            workspace::wsl_default_distro,
            workspace::wsl_home,
            workspace::workspace_authorize,
            workspace::workspace_current_dir,
            get_launch_dir,
            tab_drag_start,
            tab_drag_payload,
            tab_drag_end,
            tab_drag_set_metrics,
            tab_drag_clear_metrics,
            tab_drag_metrics,
            tab_drag_set_window_position,
            open_main_window,
            open_settings_window,
            browser::browser_navigate,
            browser::browser_reload,
            browser::browser_stop,
            browser::browser_go_back,
            browser::browser_go_forward,
            browser::browser_set_zoom,
            browser::browser_clear_data,
            browser::browser_state,
            agent::agent_enable_claude_hooks,
            agent::agent_claude_hooks_status,
            secrets::secrets_get,
            secrets::secrets_set,
            secrets::secrets_delete,
            secrets::secrets_get_all,
            net::lm_ping,
            net::ai_http_request,
            net::ai_http_stream,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
