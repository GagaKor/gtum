mod runtime {
    pub mod auth;
    pub mod codex;
    pub mod filesystem;
    pub mod platform;
    pub mod pty;
    pub mod telegram;
    pub mod workspace;
}

use runtime::auth::{
    AgentAuthManager, AgentAuthRuntimeSnapshot, AgentConnectionSnapshot, AgentProvider,
    CompleteAgentLoginRequest,
};
use runtime::codex::{
    AgentProviderDiagnostics, AgentSuggestionResponse, RequestAgentSuggestionsRequest,
};
use runtime::filesystem::{
    ProjectFileSnapshot, ProjectOverview, ProjectSearchResult, SourceControlDiff,
    SourceControlOverview,
};
use runtime::pty::{
    CreateTerminalSessionRequest, CreateTerminalSessionWithCommandRequest, TerminalSessionLogs,
    TerminalSessionManager, TerminalSessionSnapshot,
};
use runtime::telegram::{
    CompleteTelegramLinkRequest, CreateTelegramReportRequest, QueueTelegramRemoteCommandRequest,
    ResolveTelegramRemoteCommandRequest, TelegramBridgeManager, TelegramBridgeSnapshot,
    TelegramRemoteCommandSnapshot, TelegramReportSnapshot, TelegramRuntimeSnapshot,
};
use runtime::workspace::{
    RememberWorkspaceProjectRequest, SaveWorkspaceSnapshotRequest,
    SetWorkspaceExecutionModeRequest, WorkspaceRuntimeSnapshot, WorkspaceSnapshot,
    WorkspaceStateManager,
};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
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
fn read_project_file(
    project_path: String,
    file_path: String,
) -> Result<ProjectFileSnapshot, String> {
    runtime::filesystem::read_project_file(project_path, file_path)
}

#[tauri::command]
fn search_project_text(
    project_path: String,
    query: String,
) -> Result<Vec<ProjectSearchResult>, String> {
    runtime::filesystem::search_project_text(project_path, query)
}

#[tauri::command]
fn read_source_control_overview(project_path: String) -> Result<SourceControlOverview, String> {
    runtime::filesystem::read_source_control_overview(project_path)
}

#[tauri::command]
fn read_source_control_diff(
    project_path: String,
    file_path: String,
    staged: Option<bool>,
) -> Result<SourceControlDiff, String> {
    runtime::filesystem::read_source_control_diff(project_path, file_path, staged)
}

#[tauri::command]
fn stage_source_control_file(
    project_path: String,
    file_path: String,
) -> Result<SourceControlOverview, String> {
    runtime::filesystem::stage_source_control_file(project_path, file_path)
}

#[tauri::command]
fn unstage_source_control_file(
    project_path: String,
    file_path: String,
) -> Result<SourceControlOverview, String> {
    runtime::filesystem::unstage_source_control_file(project_path, file_path)
}

#[tauri::command]
fn commit_source_control(
    project_path: String,
    message: String,
) -> Result<SourceControlOverview, String> {
    runtime::filesystem::commit_source_control(project_path, message)
}

#[tauri::command]
fn push_source_control(project_path: String) -> Result<SourceControlOverview, String> {
    runtime::filesystem::push_source_control(project_path)
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
fn request_agent_suggestions(
    auth_state: tauri::State<'_, AgentAuthManager>,
    request: RequestAgentSuggestionsRequest,
) -> Result<Vec<AgentSuggestionResponse>, String> {
    let _ = auth_state.require_connected_provider(request.provider)?;

    match request.provider {
        AgentProvider::Codex => runtime::codex::request_codex_suggestions(request),
        AgentProvider::Claude => {
            Err("Claude real-provider support is deferred for the first daily-use release.".into())
        }
    }
}

#[tauri::command]
fn read_agent_provider_diagnostics(provider: AgentProvider) -> AgentProviderDiagnostics {
    match provider {
        AgentProvider::Codex => runtime::codex::read_codex_diagnostics(),
        AgentProvider::Claude => runtime::codex::deferred_provider_diagnostics(provider),
    }
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

#[tauri::command]
fn read_workspace_runtime_snapshot(
    state: tauri::State<'_, WorkspaceStateManager>,
) -> WorkspaceRuntimeSnapshot {
    state.runtime_snapshot()
}

#[tauri::command]
fn save_workspace_runtime_snapshot(
    state: tauri::State<'_, WorkspaceStateManager>,
    request: SaveWorkspaceSnapshotRequest,
) -> Result<WorkspaceSnapshot, String> {
    state.save_snapshot(request)
}

#[tauri::command]
fn remember_workspace_project(
    state: tauri::State<'_, WorkspaceStateManager>,
    request: RememberWorkspaceProjectRequest,
) -> Result<WorkspaceSnapshot, String> {
    state.remember_project(request.path)
}

#[tauri::command]
fn set_workspace_execution_mode(
    state: tauri::State<'_, WorkspaceStateManager>,
    request: SetWorkspaceExecutionModeRequest,
) -> Result<WorkspaceSnapshot, String> {
    state.set_execution_mode(request)
}

#[tauri::command]
fn read_telegram_runtime_snapshot(
    state: tauri::State<'_, TelegramBridgeManager>,
) -> TelegramRuntimeSnapshot {
    state.runtime_snapshot()
}

#[tauri::command]
fn begin_telegram_link(
    state: tauri::State<'_, TelegramBridgeManager>,
) -> Result<TelegramBridgeSnapshot, String> {
    state.begin_link()
}

#[tauri::command]
fn complete_telegram_link(
    state: tauri::State<'_, TelegramBridgeManager>,
    request: CompleteTelegramLinkRequest,
) -> Result<TelegramBridgeSnapshot, String> {
    state.complete_link(request)
}

#[tauri::command]
fn disconnect_telegram_bridge(
    state: tauri::State<'_, TelegramBridgeManager>,
) -> Result<TelegramBridgeSnapshot, String> {
    state.disconnect()
}

#[tauri::command]
fn create_telegram_report(
    state: tauri::State<'_, TelegramBridgeManager>,
    request: CreateTelegramReportRequest,
) -> Result<TelegramReportSnapshot, String> {
    state.create_report(request)
}

#[tauri::command]
fn queue_telegram_remote_command(
    state: tauri::State<'_, TelegramBridgeManager>,
    request: QueueTelegramRemoteCommandRequest,
) -> Result<TelegramRemoteCommandSnapshot, String> {
    state.queue_remote_command(request)
}

#[tauri::command]
fn resolve_telegram_remote_command(
    state: tauri::State<'_, TelegramBridgeManager>,
    request: ResolveTelegramRemoteCommandRequest,
) -> Result<TelegramRemoteCommandSnapshot, String> {
    state.resolve_remote_command(request)
}

fn resolve_app_storage_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let storage_dir = app
        .path()
        .app_data_dir()
        .or_else(|_| std::env::current_dir().map(|cwd| cwd.join(".gtum")))
        .map_err(|error| format!("failed to resolve app storage directory: {error}"))?;

    ensure_app_storage_dir(&storage_dir)?;

    Ok(storage_dir)
}

fn ensure_app_storage_dir(storage_dir: &Path) -> Result<(), String> {
    if storage_dir.exists() {
        if storage_dir.is_dir() {
            return Ok(());
        }

        let backup_path = next_legacy_app_data_backup_path(storage_dir)?;
        fs::rename(storage_dir, &backup_path).map_err(|error| {
            format!(
                "failed to move legacy app data file from {} to {}: {error}",
                storage_dir.display(),
                backup_path.display()
            )
        })?;
    }

    fs::create_dir_all(storage_dir).map_err(|error| {
        format!(
            "failed to create app storage directory at {}: {error}",
            storage_dir.display()
        )
    })
}

fn next_legacy_app_data_backup_path(storage_dir: &Path) -> Result<PathBuf, String> {
    let parent = storage_dir.parent().ok_or_else(|| {
        format!(
            "failed to resolve legacy app data backup parent for {}",
            storage_dir.display()
        )
    })?;
    let file_name = storage_dir
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("gtum");
    let timestamp = unix_timestamp_ms();

    for suffix in std::iter::once(String::new()).chain((1..1000).map(|index| format!("-{index}"))) {
        let candidate = parent.join(format!("{file_name}.legacy-file-{timestamp}{suffix}.json"));
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(format!(
        "failed to find an available legacy app data backup path for {}",
        storage_dir.display()
    ))
}

fn unix_timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AgentAuthManager::new())
        .manage(TerminalSessionManager::new())
        .manage(TelegramBridgeManager::new())
        .manage(WorkspaceStateManager::new())
        .invoke_handler(tauri::generate_handler![
            get_runtime_info,
            read_project_overview,
            read_project_file,
            search_project_text,
            read_source_control_overview,
            read_source_control_diff,
            stage_source_control_file,
            unstage_source_control_file,
            commit_source_control,
            push_source_control,
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
            request_agent_suggestions,
            read_agent_provider_diagnostics,
            disconnect_agent_provider,
            agent_auth_runtime_snapshot,
            read_workspace_runtime_snapshot,
            save_workspace_runtime_snapshot,
            remember_workspace_project,
            set_workspace_execution_mode,
            read_telegram_runtime_snapshot,
            begin_telegram_link,
            complete_telegram_link,
            disconnect_telegram_bridge,
            create_telegram_report,
            queue_telegram_remote_command,
            resolve_telegram_remote_command
        ])
        .setup(|app| {
            let app_handle = app.handle();
            let app_storage_dir = resolve_app_storage_dir(app_handle)?;
            let auth_storage_path = app_storage_dir.join("agent-auth.json");

            app_handle
                .state::<AgentAuthManager>()
                .initialize_storage(auth_storage_path)?;

            let workspace_storage_path = app_storage_dir.join("workspace-state.json");

            app_handle
                .state::<WorkspaceStateManager>()
                .initialize_storage(workspace_storage_path)?;

            let telegram_storage_path = app_storage_dir.join("telegram-state.json");

            app_handle
                .state::<TelegramBridgeManager>()
                .initialize_storage(telegram_storage_path)?;

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

#[cfg(test)]
mod tests {
    use super::*;

    fn unique_temp_path(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "gtum-{label}-{}-{}",
            std::process::id(),
            unix_timestamp_ms()
        ))
    }

    fn remove_test_path(path: &Path) {
        if path.is_dir() {
            let _ = fs::remove_dir_all(path);
        } else if path.exists() {
            let _ = fs::remove_file(path);
        }
    }

    #[test]
    fn app_storage_dir_is_created_when_missing() {
        let storage_dir = unique_temp_path("missing-storage-dir");
        remove_test_path(&storage_dir);

        ensure_app_storage_dir(&storage_dir).unwrap();

        assert!(storage_dir.is_dir());

        remove_test_path(&storage_dir);
    }

    #[test]
    fn app_storage_dir_preserves_existing_directory() {
        let storage_dir = unique_temp_path("existing-storage-dir");
        remove_test_path(&storage_dir);
        fs::create_dir_all(&storage_dir).unwrap();
        let marker_path = storage_dir.join("workspace-state.json");
        fs::write(&marker_path, "{}").unwrap();

        ensure_app_storage_dir(&storage_dir).unwrap();

        assert!(storage_dir.is_dir());
        assert_eq!(fs::read_to_string(marker_path).unwrap(), "{}");

        remove_test_path(&storage_dir);
    }

    #[test]
    fn app_storage_dir_migrates_legacy_file_path() {
        let storage_dir = unique_temp_path("legacy-file-storage-dir");
        remove_test_path(&storage_dir);
        fs::write(&storage_dir, "{\"legacy\":true}").unwrap();

        ensure_app_storage_dir(&storage_dir).unwrap();

        assert!(storage_dir.is_dir());

        let parent = storage_dir.parent().unwrap();
        let backup_prefix = format!(
            "{}.legacy-file-",
            storage_dir.file_name().unwrap().to_string_lossy()
        );
        let backups: Vec<PathBuf> = fs::read_dir(parent)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .map(|name| name.starts_with(&backup_prefix) && name.ends_with(".json"))
                    .unwrap_or(false)
            })
            .collect();

        assert_eq!(backups.len(), 1);
        assert_eq!(
            fs::read_to_string(&backups[0]).unwrap(),
            "{\"legacy\":true}"
        );

        remove_test_path(&storage_dir);
        let _ = fs::remove_file(&backups[0]);
    }
}
