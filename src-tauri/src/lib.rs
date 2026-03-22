mod runtime {
    pub mod filesystem;
    pub mod platform;
    pub mod pty;
}

use runtime::filesystem::ProjectOverview;
use runtime::pty::{
    CreateTerminalSessionRequest, TerminalSessionLogs, TerminalSessionManager,
    TerminalSessionSnapshot,
};

#[derive(serde::Serialize)]
struct RuntimeInfo {
    app_name: String,
    platform: String,
    mode: String,
}

#[tauri::command]
fn get_runtime_info(app: tauri::AppHandle) -> RuntimeInfo {
    RuntimeInfo {
        app_name: app.package_info().name.clone(),
        platform: std::env::consts::OS.to_string(),
        mode: if cfg!(debug_assertions) {
            "debug".into()
        } else {
            "release".into()
        },
    }
}

#[tauri::command]
fn read_project_overview(
    path: String,
    max_depth: Option<usize>,
) -> Result<ProjectOverview, String> {
    runtime::filesystem::read_project_overview(path, max_depth)
}

#[tauri::command]
fn create_terminal_session(
    state: tauri::State<'_, TerminalSessionManager>,
    request: CreateTerminalSessionRequest,
) -> Result<TerminalSessionSnapshot, String> {
    state.create_session(request)
}

#[tauri::command]
fn list_terminal_sessions(
    state: tauri::State<'_, TerminalSessionManager>,
) -> Vec<TerminalSessionSnapshot> {
    state.list_sessions()
}

#[tauri::command]
fn rename_terminal_session(
    state: tauri::State<'_, TerminalSessionManager>,
    session_id: u64,
    name: String,
) -> Result<TerminalSessionSnapshot, String> {
    state.rename_session(session_id, name)
}

#[tauri::command]
fn close_terminal_session(
    state: tauri::State<'_, TerminalSessionManager>,
    session_id: u64,
) -> Result<TerminalSessionSnapshot, String> {
    state.close_session(session_id)
}

#[tauri::command]
fn read_terminal_session_logs(
    state: tauri::State<'_, TerminalSessionManager>,
    session_id: u64,
    limit: Option<usize>,
) -> Result<TerminalSessionLogs, String> {
    state.read_recent_logs(session_id, limit)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TerminalSessionManager::new())
        .invoke_handler(tauri::generate_handler![
            get_runtime_info,
            read_project_overview,
            create_terminal_session,
            list_terminal_sessions,
            rename_terminal_session,
            close_terminal_session,
            read_terminal_session_logs
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
