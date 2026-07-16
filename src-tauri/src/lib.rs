mod runtime;

use runtime::agent_jobs::{AgentJobLogs, AgentJobManager, AgentJobSnapshot, CreateAgentJobRequest};
use runtime::auth::{
    provider_validation_failure_message, AgentAuthManager, AgentAuthRuntimeSnapshot,
    AgentConnectionSnapshot, AgentProvider, CompleteAgentLoginRequest,
};
use runtime::codex::{
    AgentProviderCapabilities, AgentProviderDiagnostics, AgentSuggestionResponse,
    RequestAgentSuggestionsRequest,
};
use runtime::filesystem::{
    ApplyProjectPatchRequest, ApplyProjectPatchResult, ProjectFileSnapshot, ProjectOverview,
    ProjectSearchResult, SourceControlDiff, SourceControlOverview, WriteProjectFileRequest,
};
use runtime::pty::{
    CreateTerminalSessionRequest, CreateTerminalSessionWithCommandRequest, RawTerminalOutput,
    TerminalSessionLogs, TerminalSessionManager, TerminalSessionSnapshot,
};
use runtime::telegram::{
    CompleteTelegramLinkRequest, CreateTelegramReportRequest, QueueTelegramRemoteCommandRequest,
    ResolveTelegramRemoteCommandRequest, TelegramBridgeManager, TelegramBridgeSnapshot,
    TelegramRemoteCommandSnapshot, TelegramReportSnapshot, TelegramRuntimeSnapshot,
};
use runtime::workspace::{
    RememberWorkspaceProjectRequest, SaveWorkspaceSnapshotRequest, WorkspaceRuntimeSnapshot,
    WorkspaceSnapshot, WorkspaceStateManager,
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
fn write_project_file(request: WriteProjectFileRequest) -> Result<ProjectFileSnapshot, String> {
    runtime::filesystem::write_project_file(request)
}

#[tauri::command]
fn apply_project_patch(
    request: ApplyProjectPatchRequest,
) -> Result<ApplyProjectPatchResult, String> {
    runtime::filesystem::apply_project_patch(request)
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
    project_path: String,
) -> Result<Vec<TerminalSessionSnapshot>, String> {
    state.list_sessions(&project_path)
}

#[tauri::command]
fn rename_terminal_session(
    state: tauri::State<'_, TerminalSessionManager>,
    project_path: String,
    session_id: u64,
    name: String,
) -> Result<TerminalSessionSnapshot, String> {
    state.rename_session(&project_path, session_id, name)
}

#[tauri::command]
fn close_terminal_session(
    state: tauri::State<'_, TerminalSessionManager>,
    project_path: String,
    session_id: u64,
) -> Result<TerminalSessionSnapshot, String> {
    state.close_session(&project_path, session_id)
}

#[tauri::command]
fn read_terminal_session_logs(
    state: tauri::State<'_, TerminalSessionManager>,
    project_path: String,
    session_id: u64,
    limit: Option<usize>,
) -> Result<TerminalSessionLogs, String> {
    state.read_recent_logs(&project_path, session_id, limit)
}

#[tauri::command]
fn execute_terminal_session_command(
    state: tauri::State<'_, TerminalSessionManager>,
    project_path: String,
    session_id: u64,
    command: String,
) -> Result<TerminalSessionSnapshot, String> {
    state.execute_command(&project_path, session_id, command)
}

#[tauri::command]
fn create_terminal_session_with_command(
    state: tauri::State<'_, TerminalSessionManager>,
    request: CreateTerminalSessionWithCommandRequest,
) -> Result<TerminalSessionSnapshot, String> {
    state.create_session_with_command(request)
}

#[tauri::command]
fn write_terminal_input(
    state: tauri::State<'_, TerminalSessionManager>,
    project_path: String,
    session_id: u64,
    data: String,
) -> Result<(), String> {
    state.write_terminal_input(&project_path, session_id, data)
}

#[tauri::command]
fn read_raw_terminal_output(
    state: tauri::State<'_, TerminalSessionManager>,
    project_path: String,
    session_id: u64,
    from: usize,
) -> Result<RawTerminalOutput, String> {
    state.read_raw_output(&project_path, session_id, from)
}

#[tauri::command]
fn resize_terminal_session(
    state: tauri::State<'_, TerminalSessionManager>,
    project_path: String,
    session_id: u64,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    state.resize_session(&project_path, session_id, rows, cols)
}

#[tauri::command]
fn create_agent_job(
    state: tauri::State<'_, AgentJobManager>,
    request: CreateAgentJobRequest,
) -> Result<AgentJobSnapshot, String> {
    state.create_job(request)
}

#[tauri::command]
fn list_agent_jobs(
    state: tauri::State<'_, AgentJobManager>,
    project_path: String,
    session_id: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<AgentJobSnapshot>, String> {
    match session_id.as_deref() {
        Some(session_id) => state.list_jobs_for_session(&project_path, Some(session_id), limit),
        None => state.list_jobs(&project_path, limit),
    }
}

#[tauri::command]
fn read_agent_job_logs(
    state: tauri::State<'_, AgentJobManager>,
    project_path: String,
    job_id: u64,
    limit: Option<usize>,
) -> Result<AgentJobLogs, String> {
    state.read_logs(&project_path, job_id, limit)
}

#[tauri::command]
fn cancel_agent_job(
    state: tauri::State<'_, AgentJobManager>,
    project_path: String,
    job_id: u64,
) -> Result<AgentJobSnapshot, String> {
    state.cancel_job(&project_path, job_id)
}

#[tauri::command]
async fn list_agent_connections(
    app: tauri::AppHandle,
) -> Result<Vec<AgentConnectionSnapshot>, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<AgentAuthManager>().list_connections())
        .await
        .map_err(|error| format!("failed to join agent connection refresh: {error}"))
}

#[tauri::command]
async fn begin_agent_login(
    app: tauri::AppHandle,
    provider: AgentProvider,
    requested_scopes: Option<Vec<String>>,
) -> Result<AgentConnectionSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AgentAuthManager>()
            .begin_login(provider, requested_scopes)
    })
    .await
    .map_err(|error| format!("failed to join agent login validation: {error}"))?
}

#[tauri::command]
fn complete_agent_login(
    state: tauri::State<'_, AgentAuthManager>,
    request: CompleteAgentLoginRequest,
) -> Result<AgentConnectionSnapshot, String> {
    state.complete_login(request)
}

fn resolve_provider_suggestion_attempt<T>(
    provider: AgentProvider,
    validation_applied: bool,
    validation: Result<(), String>,
    suggestions: Option<Result<T, String>>,
) -> Result<T, String> {
    if !validation_applied {
        return Err(
            "The provider connection changed while the request was running. Retry the request."
                .into(),
        );
    }
    validation.map_err(|error| provider_validation_failure_message(provider, &error))?;
    suggestions
        .ok_or_else(|| "The provider returned no suggestion result after validation.".to_string())?
}

#[tauri::command]
async fn request_agent_suggestions(
    app: tauri::AppHandle,
    request: RequestAgentSuggestionsRequest,
) -> Result<Vec<AgentSuggestionResponse>, String> {
    if request.agent_session_id.trim().is_empty() {
        return Err("agentSessionId is required to own a provider request.".into());
    }
    match request.provider {
        AgentProvider::Codex => {
            let auth_state = app.state::<AgentAuthManager>();
            let lease = auth_state.require_stored_connected_provider(AgentProvider::Codex)?;
            let attempt = tauri::async_runtime::spawn_blocking(move || {
                runtime::codex::request_codex_suggestion_attempt(request)
            })
            .await
            .map_err(|error| format!("failed to join Codex suggestion task: {error}"))?;

            let validation_applied =
                auth_state.apply_validation_if_current(&lease, &attempt.validation);
            resolve_provider_suggestion_attempt(
                AgentProvider::Codex,
                validation_applied,
                attempt.validation.map(|_| ()),
                attempt.suggestions,
            )
        }
        AgentProvider::Claude => {
            let auth_state = app.state::<AgentAuthManager>();
            let lease = auth_state.require_stored_connected_provider(AgentProvider::Claude)?;
            let attempt = tauri::async_runtime::spawn_blocking(move || {
                runtime::claude::request_claude_suggestion_attempt(request)
            })
            .await
            .map_err(|error| format!("failed to join Claude suggestion task: {error}"))?;

            let validation_applied =
                auth_state.apply_claude_validation_if_current(&lease, &attempt.validation);
            resolve_provider_suggestion_attempt(
                AgentProvider::Claude,
                validation_applied,
                attempt.validation.map(|_| ()),
                attempt.suggestions,
            )
        }
    }
}

#[tauri::command]
fn read_agent_provider_diagnostics(provider: AgentProvider) -> AgentProviderDiagnostics {
    match provider {
        AgentProvider::Codex => runtime::codex::read_codex_diagnostics(),
        AgentProvider::Claude => runtime::claude::read_claude_diagnostics(),
    }
}

#[tauri::command]
async fn read_agent_provider_capabilities(
    provider: AgentProvider,
) -> Result<AgentProviderCapabilities, String> {
    run_blocking_agent_provider_capability_read(move || match provider {
        AgentProvider::Codex => runtime::codex::read_codex_capabilities(),
        AgentProvider::Claude => runtime::claude::read_claude_capabilities(),
    })
    .await
}

async fn run_blocking_agent_provider_capability_read<T, F>(read: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(read)
        .await
        .map_err(|error| format!("failed to join agent provider capability read: {error}"))
}

#[tauri::command]
fn disconnect_agent_provider(
    state: tauri::State<'_, AgentAuthManager>,
    provider: AgentProvider,
) -> Result<AgentConnectionSnapshot, String> {
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
fn open_workspace_project(
    state: tauri::State<'_, WorkspaceStateManager>,
    request: RememberWorkspaceProjectRequest,
) -> Result<WorkspaceSnapshot, String> {
    state.open_project(request.path)
}

#[tauri::command]
fn activate_workspace_project(
    state: tauri::State<'_, WorkspaceStateManager>,
    request: RememberWorkspaceProjectRequest,
) -> Result<WorkspaceSnapshot, String> {
    state.activate_project(request.path)
}

#[tauri::command]
fn close_workspace_project(
    state: tauri::State<'_, WorkspaceStateManager>,
    request: RememberWorkspaceProjectRequest,
) -> Result<WorkspaceSnapshot, String> {
    state.close_project(request.path)
}

macro_rules! generate_handler_with_workspace_commands {
    ($($other:path),* $(,)?) => {
        tauri::generate_handler![
            $($other,)*
            open_workspace_project,
            activate_workspace_project,
            close_workspace_project,
        ]
    };
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
        .manage(AgentJobManager::new())
        .manage(AgentAuthManager::new())
        .manage(TerminalSessionManager::new())
        .manage(TelegramBridgeManager::new())
        .manage(WorkspaceStateManager::new())
        .invoke_handler(generate_handler_with_workspace_commands![
            get_runtime_info,
            read_project_overview,
            read_project_file,
            write_project_file,
            apply_project_patch,
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
            write_terminal_input,
            read_raw_terminal_output,
            resize_terminal_session,
            create_agent_job,
            list_agent_jobs,
            read_agent_job_logs,
            cancel_agent_job,
            list_agent_connections,
            begin_agent_login,
            complete_agent_login,
            request_agent_suggestions,
            read_agent_provider_diagnostics,
            read_agent_provider_capabilities,
            disconnect_agent_provider,
            agent_auth_runtime_snapshot,
            read_workspace_runtime_snapshot,
            save_workspace_runtime_snapshot,
            remember_workspace_project,
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
            let agent_jobs_storage_path = app_storage_dir.join("agent-jobs.json");

            app_handle
                .state::<AgentJobManager>()
                .initialize_storage(agent_jobs_storage_path)?;

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

    fn invoke_workspace_project_command(
        webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
        command: &str,
        path: &Path,
    ) -> WorkspaceSnapshot {
        tauri::test::get_ipc_response(
            webview,
            tauri::webview::InvokeRequest {
                cmd: command.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "http://tauri.localhost".parse().unwrap(),
                body: serde_json::json!({
                    "request": {
                        "path": path.to_string_lossy(),
                    },
                })
                .into(),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        )
        .unwrap_or_else(|error| panic!("{command} failed: {error}"))
        .deserialize::<WorkspaceSnapshot>()
        .unwrap()
    }

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

    struct TestPathGuard(PathBuf);

    impl Drop for TestPathGuard {
        fn drop(&mut self) {
            remove_test_path(&self.0);
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
    fn stale_successful_provider_result_is_rejected_instead_of_returned() {
        let result = resolve_provider_suggestion_attempt(
            AgentProvider::Claude,
            false,
            Ok(()),
            Some(Ok::<_, String>(vec!["stale suggestion"])),
        );

        let error = result.expect_err("stale provider success must be rejected");
        assert!(error.to_lowercase().contains("retry"));
    }

    #[test]
    fn current_provider_result_and_auth_failure_are_resolved_authoritatively() {
        assert_eq!(
            resolve_provider_suggestion_attempt(
                AgentProvider::Codex,
                true,
                Ok(()),
                Some(Ok::<_, String>(vec!["current suggestion"])),
            )
            .unwrap(),
            vec!["current suggestion"]
        );

        let codex_provider = AgentProvider::Codex;
        let failure = resolve_provider_suggestion_attempt::<Vec<&str>>(
            codex_provider,
            true,
            Err("provider credential expired".into()),
            None,
        )
        .expect_err("current auth failure should be returned");
        assert_eq!(
            failure, "provider credential expired",
            "{codex_provider:?} validation failures must remain verbatim"
        );

        let suggestion_failure = resolve_provider_suggestion_attempt::<Vec<&str>>(
            AgentProvider::Claude,
            true,
            Ok(()),
            Some(Err("provider suggestion failed".into())),
        )
        .expect_err("current suggestion failure should be returned");
        assert_eq!(suggestion_failure, "provider suggestion failed");

        let claude_provider = AgentProvider::Claude;
        let failure = resolve_provider_suggestion_attempt::<Vec<&str>>(
            claude_provider,
            true,
            Err("Claude validation failed for private@example.com: raw-validation-secret".into()),
            None,
        )
        .expect_err("current Claude auth failure should be returned safely");
        assert_eq!(
            failure,
            "Claude authentication could not be validated. Check Claude credentials or run `claude auth login` in your own terminal, then reconnect Claude.",
            "{claude_provider:?} validation failures must be redacted"
        );
        for forbidden in ["private@example.com", "raw-validation-secret"] {
            assert!(!failure.contains(forbidden));
        }
    }

    #[test]
    fn provider_capability_read_runs_on_a_blocking_worker() {
        let caller_thread = std::thread::current().id();

        let worker_thread =
            tauri::async_runtime::block_on(run_blocking_agent_provider_capability_read(|| {
                std::thread::current().id()
            }))
            .unwrap();

        assert_ne!(worker_thread, caller_thread);
    }

    #[test]
    fn provider_capability_blocking_join_failure_is_typed_for_ipc() {
        let error = tauri::async_runtime::block_on(run_blocking_agent_provider_capability_read(
            || -> () { panic!("expected provider capability worker panic") },
        ))
        .expect_err("blocking worker panic must become an IPC error");

        assert!(error.contains("failed to join agent provider capability read"));
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

    #[test]
    fn workspace_project_commands_accept_request_envelopes_and_apply_transitions() {
        let storage_dir = unique_temp_path("workspace-project-command-ipc");
        remove_test_path(&storage_dir);
        let _storage_guard = TestPathGuard(storage_dir.clone());
        let project_a = storage_dir.join("project-a");
        let project_b = storage_dir.join("project-b");
        fs::create_dir_all(&project_a).unwrap();
        fs::create_dir_all(&project_b).unwrap();

        let manager = WorkspaceStateManager::new();
        manager
            .initialize_storage(storage_dir.join("workspace-state.json"))
            .unwrap();
        let app = tauri::test::mock_builder()
            .manage(manager)
            .invoke_handler(generate_handler_with_workspace_commands![])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();

        invoke_workspace_project_command(&webview, "open_workspace_project", &project_a);
        let opened =
            invoke_workspace_project_command(&webview, "open_workspace_project", &project_b);
        assert_eq!(opened.open_project_paths.len(), 2);
        assert_eq!(
            opened.active_project_path,
            Some(
                project_b
                    .canonicalize()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            )
        );

        let activated =
            invoke_workspace_project_command(&webview, "activate_workspace_project", &project_a);
        assert_eq!(
            activated.active_project_path,
            Some(
                project_a
                    .canonicalize()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned()
            )
        );

        let closed =
            invoke_workspace_project_command(&webview, "close_workspace_project", &project_b);
        assert_eq!(
            closed.open_project_paths,
            vec![project_a
                .canonicalize()
                .unwrap()
                .to_string_lossy()
                .into_owned()]
        );
        assert_eq!(
            closed.active_project_path,
            closed.open_project_paths.first().cloned()
        );
    }
}
