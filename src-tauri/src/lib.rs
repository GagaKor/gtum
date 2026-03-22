mod runtime {
    pub mod auth;
    pub mod filesystem;
    pub mod platform;
    pub mod pty;
}

use runtime::auth::{
    AgentAuthManager, AgentAuthRuntimeSnapshot, AgentConnectionSnapshot, AgentProvider,
    CompleteAgentLoginRequest,
};
use runtime::filesystem::ProjectOverview;
use runtime::pty::{
    CreateTerminalSessionRequest, CreateTerminalSessionWithCommandRequest, TerminalSessionLogs,
    TerminalSessionManager, TerminalSessionSnapshot,
};
use tauri::Manager;

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

#[tauri::command]
fn execute_terminal_session_command(
    state: tauri::State<'_, TerminalSessionManager>,
    session_id: u64,
    command: String,
) -> Result<TerminalSessionSnapshot, String> {
    state.execute_command(session_id, command)
}

#[tauri::command]
fn create_terminal_session_with_command(
    state: tauri::State<'_, TerminalSessionManager>,
    request: CreateTerminalSessionWithCommandRequest,
) -> Result<TerminalSessionSnapshot, String> {
    state.create_session_with_command(request)
}

#[tauri::command]
fn list_agent_connections(
    state: tauri::State<'_, AgentAuthManager>,
) -> Vec<AgentConnectionSnapshot> {
    state.list_connections()
}

#[tauri::command]
fn begin_agent_login(
    state: tauri::State<'_, AgentAuthManager>,
    provider: AgentProvider,
    requested_scopes: Option<Vec<String>>,
) -> AgentConnectionSnapshot {
    state.begin_login(provider, requested_scopes)
}

#[tauri::command]
fn complete_agent_login(
    state: tauri::State<'_, AgentAuthManager>,
    request: CompleteAgentLoginRequest,
) -> Result<AgentConnectionSnapshot, String> {
    state.complete_login(request)
}

#[tauri::command]
fn disconnect_agent_provider(
    state: tauri::State<'_, AgentAuthManager>,
    provider: AgentProvider,
) -> AgentConnectionSnapshot {
    state.disconnect(provider)
}

#[tauri::command]
fn agent_auth_runtime_snapshot(
    state: tauri::State<'_, AgentAuthManager>,
) -> AgentAuthRuntimeSnapshot {
    state.runtime_snapshot()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AgentAuthManager::new())
        .manage(TerminalSessionManager::new())
        .invoke_handler(tauri::generate_handler![
            get_runtime_info,
            read_project_overview,
            create_terminal_session,
            list_terminal_sessions,
            rename_terminal_session,
            close_terminal_session,
            read_terminal_session_logs,
            execute_terminal_session_command,
            create_terminal_session_with_command,
            list_agent_connections,
            begin_agent_login,
            complete_agent_login,
            disconnect_agent_provider,
            agent_auth_runtime_snapshot
        ])
        .setup(|app| {
            let storage_path = app
                .handle()
                .path()
                .app_data_dir()
                .or_else(|_| {
                    std::env::current_dir().map(|cwd| cwd.join(".gtum").join("agent-auth.json"))
                })
                .map_err(|error| format!("failed to resolve auth storage path: {error}"))?;

            app.handle()
                .state::<AgentAuthManager>()
                .initialize_storage(storage_path)?;

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
