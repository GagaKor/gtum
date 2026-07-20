mod runtime;

use runtime::agent_jobs::{AgentJobLogs, AgentJobManager, AgentJobSnapshot, CreateAgentJobRequest};
use runtime::auth::{
    provider_validation_failure_message, AgentAccountLease, AgentAuthManager,
    AgentAuthRuntimeSnapshot, AgentConnectionSnapshot, AgentProfileLeaseAuthorization,
    AgentProfileResponse, AgentProfileSetupGuidance, AgentProfileSnapshot,
    AgentProfileTombstoneResponse, AgentProvider, AuthorizeAgentProfileLeaseRequest,
    CanonicalDecimalU64, CheckAgentProfileRequest, CompleteAgentLoginRequest,
    CreateAgentProfileRequest, ReadAgentProfileSetupGuidanceRequest, RenameAgentProfileRequest,
    TargetAgentProfileLeaseRequest, TargetAgentProfileRequest,
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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentAccountOwnedResponse<T> {
    account_id: String,
    incarnation: CanonicalDecimalU64,
    credential_revision: CanonicalDecimalU64,
    #[serde(flatten)]
    payload: T,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestAgentAccountSuggestionsRequest {
    account_id: String,
    incarnation: CanonicalDecimalU64,
    credential_revision: CanonicalDecimalU64,
    #[serde(flatten)]
    request: RequestAgentSuggestionsRequest,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateAuthorizedAgentJobRequest {
    #[serde(flatten)]
    lease: AuthorizeAgentProfileLeaseRequest,
    #[serde(flatten)]
    job: CreateAgentJobRequest,
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
fn create_authorized_agent_job(
    auth_state: tauri::State<'_, AgentAuthManager>,
    job_state: tauri::State<'_, AgentJobManager>,
    request: CreateAuthorizedAgentJobRequest,
) -> Result<AgentJobSnapshot, String> {
    validate_authorized_agent_job_session_id(request.job.session_id.as_deref())?;

    let CreateAuthorizedAgentJobRequest { lease, job } = request;
    auth_state.with_authorized_profile_lease(&lease, |_| job_state.create_job(job))
}

fn validate_authorized_agent_job_session_id(session_id: Option<&str>) -> Result<(), String> {
    let session_id = session_id
        .ok_or_else(|| "agentSessionId is required to own an authorized Agent job.".to_string())?;
    if session_id.trim().is_empty() || session_id != session_id.trim() {
        return Err(
            "agentSessionId must be a canonical non-empty string for an authorized Agent job."
                .to_string(),
        );
    }
    Ok(())
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
fn list_agent_profiles(
    state: tauri::State<'_, AgentAuthManager>,
    provider: AgentProvider,
) -> Vec<AgentProfileResponse> {
    state
        .list_profiles(provider)
        .into_iter()
        .map(AgentProfileResponse::from)
        .collect()
}

#[tauri::command]
fn read_agent_profile_snapshot(state: tauri::State<'_, AgentAuthManager>) -> AgentProfileSnapshot {
    state.read_profile_snapshot()
}

#[tauri::command]
async fn create_agent_profile(
    app: tauri::AppHandle,
    request: CreateAgentProfileRequest,
) -> Result<AgentProfileResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AgentAuthManager>()
            .create_profile(request.provider, &request.alias)
            .map(AgentProfileResponse::from)
    })
    .await
    .map_err(|error| format!("failed to join account profile creation: {error}"))?
}

#[tauri::command]
fn rename_agent_profile(
    state: tauri::State<'_, AgentAuthManager>,
    request: RenameAgentProfileRequest,
) -> Result<AgentProfileResponse, String> {
    state
        .rename_profile(request.provider, &request.account_id, &request.alias)
        .map(AgentProfileResponse::from)
}

#[tauri::command]
fn set_default_agent_profile(
    state: tauri::State<'_, AgentAuthManager>,
    request: TargetAgentProfileRequest,
) -> Result<AgentProfileResponse, String> {
    state
        .set_default_profile(request.provider, &request.account_id)
        .map(AgentProfileResponse::from)
}

#[tauri::command]
async fn check_agent_profile(
    app: tauri::AppHandle,
    request: CheckAgentProfileRequest,
) -> Result<AgentProfileResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AgentAuthManager>()
            .check_profile(
                request.provider,
                &request.account_id,
                request.requested_scopes,
            )
            .map(AgentProfileResponse::from)
    })
    .await
    .map_err(|error| format!("failed to join account profile check: {error}"))?
}

#[tauri::command]
fn disconnect_agent_profile(
    state: tauri::State<'_, AgentAuthManager>,
    request: TargetAgentProfileRequest,
) -> Result<AgentProfileResponse, String> {
    state
        .disconnect_profile(request.provider, &request.account_id)
        .map(AgentProfileResponse::from)
}

#[tauri::command]
fn forget_agent_profile(
    state: tauri::State<'_, AgentAuthManager>,
    request: TargetAgentProfileRequest,
) -> Result<AgentProfileTombstoneResponse, String> {
    state
        .forget_profile(request.provider, &request.account_id)
        .map(AgentProfileTombstoneResponse::from)
}

#[tauri::command]
fn read_agent_profile_setup_guidance(
    state: tauri::State<'_, AgentAuthManager>,
    request: ReadAgentProfileSetupGuidanceRequest,
) -> Result<AgentProfileSetupGuidance, String> {
    state.setup_guidance(request.provider, &request.account_id, request.shell)
}

#[tauri::command]
fn authorize_agent_profile_lease(
    state: tauri::State<'_, AgentAuthManager>,
    request: AuthorizeAgentProfileLeaseRequest,
) -> Result<AgentProfileLeaseAuthorization, String> {
    state.authorize_profile_lease(&request)
}

#[tauri::command]
async fn list_agent_connections(
    app: tauri::AppHandle,
) -> Result<Vec<AgentConnectionSnapshot>, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<AgentAuthManager>().list_connections())
        .await
        .map_err(|error| format!("failed to join agent connection refresh: {error}"))
}

fn reject_legacy_provider_only_agent_command(_operation: &str) -> Result<(), String> {
    Err("An exact Agent account lease is required. Refresh accounts and retry.".to_string())
}

#[tauri::command]
async fn begin_agent_login(
    app: tauri::AppHandle,
    provider: AgentProvider,
    requested_scopes: Option<Vec<String>>,
) -> Result<AgentConnectionSnapshot, String> {
    reject_legacy_provider_only_agent_command("begin login")?;
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

fn resolve_account_owned_provider_result<T>(
    state: &AgentAuthManager,
    lease: &AgentAccountLease,
    require_connected: bool,
    result: Result<T, String>,
    payload_provider: impl FnOnce(&T) -> AgentProvider,
    operation: &str,
) -> Result<T, String> {
    state.require_profile_lease_current(lease, require_connected)?;
    let payload = result.map_err(|_| {
        format!(
            "Could not {operation} for the selected {} account.",
            lease.provider().display_name()
        )
    })?;
    if payload_provider(&payload) != lease.provider() {
        return Err("Account provider response owner mismatch.".to_string());
    }
    Ok(payload)
}

fn bind_account_owned_payload<T>(
    lease: &AgentAccountLease,
    payload_provider: AgentProvider,
    payload: T,
) -> Result<AgentAccountOwnedResponse<T>, String> {
    if payload_provider != lease.provider() {
        return Err("Account provider response owner mismatch.".to_string());
    }
    Ok(AgentAccountOwnedResponse {
        account_id: lease.account_id().to_string(),
        incarnation: lease.incarnation().into(),
        credential_revision: lease.credential_revision().into(),
        payload,
    })
}

fn bind_account_suggestions(
    lease: &AgentAccountLease,
    suggestions: Vec<AgentSuggestionResponse>,
) -> Result<Vec<AgentAccountOwnedResponse<AgentSuggestionResponse>>, String> {
    if suggestions
        .iter()
        .any(|suggestion| suggestion.provider != lease.provider())
    {
        return Err("Account suggestion response owner mismatch.".to_string());
    }
    Ok(suggestions
        .into_iter()
        .map(|payload| AgentAccountOwnedResponse {
            account_id: lease.account_id().to_string(),
            incarnation: lease.incarnation().into(),
            credential_revision: lease.credential_revision().into(),
            payload,
        })
        .collect())
}

fn resolve_account_execution_context<T>(
    state: &AgentAuthManager,
    lease: &AgentAccountLease,
    require_connected: bool,
    context: Result<T, String>,
    context_lease: impl FnOnce(&T) -> &AgentAccountLease,
) -> Result<T, String> {
    state.require_profile_lease_current(lease, require_connected)?;
    let context = context
        .map_err(|_| "Could not prepare the selected account execution context.".to_string())?;
    if context_lease(&context) != lease {
        return Err("Account execution context lease mismatch.".to_string());
    }
    Ok(context)
}

fn resolve_account_suggestion_attempt<T>(
    provider: AgentProvider,
    validation_applied: Result<bool, String>,
    validation: &Result<T, String>,
    suggestions: Option<Result<Vec<AgentSuggestionResponse>, String>>,
) -> Result<Vec<AgentSuggestionResponse>, String> {
    let validation_applied = validation_applied.map_err(|_| {
        "Could not update the selected account after provider validation.".to_string()
    })?;
    if !validation_applied {
        return Err(
            "The selected account changed while the operation was running. Retry the operation."
                .to_string(),
        );
    }
    if validation.is_err() {
        return Err(match provider {
            AgentProvider::Codex => {
                "Codex authentication could not be validated. Reconnect Codex.".to_string()
            }
            AgentProvider::Claude => "Claude authentication could not be validated. Check Claude credentials or run `claude auth login` in your own terminal, then reconnect Claude.".to_string(),
        });
    }
    suggestions
        .ok_or_else(|| "The selected account returned no suggestion result.".to_string())?
        .map_err(|_| "The selected account suggestion request failed.".to_string())
}

#[tauri::command]
async fn request_agent_suggestions(
    app: tauri::AppHandle,
    request: RequestAgentSuggestionsRequest,
) -> Result<Vec<AgentSuggestionResponse>, String> {
    reject_legacy_provider_only_agent_command("request suggestions")?;
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
async fn read_agent_account_diagnostics(
    app: tauri::AppHandle,
    request: TargetAgentProfileLeaseRequest,
) -> Result<AgentAccountOwnedResponse<AgentProviderDiagnostics>, String> {
    let TargetAgentProfileLeaseRequest {
        provider,
        account_id,
        incarnation,
        credential_revision,
    } = request;
    let state = app.state::<AgentAuthManager>();
    let initial = state.require_exact_account_profile_lease(
        provider,
        &account_id,
        incarnation.value(),
        credential_revision.value(),
        false,
    )?;

    let (lease, provider_result) = match provider {
        AgentProvider::Codex => {
            let context = resolve_account_execution_context(
                &state,
                &initial,
                false,
                state.capture_codex_account_execution_context(&account_id),
                |context| context.lease(),
            )?;
            let lease = context.lease().clone();
            state.require_profile_lease_current(&lease, false)?;
            let joined = tauri::async_runtime::spawn_blocking(move || {
                runtime::codex::read_codex_diagnostics_for_context(&context)
            })
            .await;
            let result = match joined {
                Ok(result) => result,
                Err(_) => Err("account diagnostics worker failed".to_string()),
            };
            (lease, result)
        }
        AgentProvider::Claude => {
            let context = resolve_account_execution_context(
                &state,
                &initial,
                false,
                state.capture_claude_account_execution_context(&account_id),
                |context| context.lease(),
            )?;
            let lease = context.lease().clone();
            state.require_profile_lease_current(&lease, false)?;
            let joined = tauri::async_runtime::spawn_blocking(move || {
                runtime::claude::read_claude_diagnostics_for_context(&context)
            })
            .await;
            let result = match joined {
                Ok(result) => result,
                Err(_) => Err("account diagnostics worker failed".to_string()),
            };
            (lease, result)
        }
    };
    let diagnostics = resolve_account_owned_provider_result(
        &state,
        &lease,
        false,
        provider_result,
        |diagnostics| diagnostics.provider,
        "read diagnostics",
    )?;
    bind_account_owned_payload(&lease, diagnostics.provider, diagnostics)
}

#[tauri::command]
async fn read_agent_account_capabilities(
    app: tauri::AppHandle,
    request: TargetAgentProfileLeaseRequest,
) -> Result<AgentAccountOwnedResponse<AgentProviderCapabilities>, String> {
    let TargetAgentProfileLeaseRequest {
        provider,
        account_id,
        incarnation,
        credential_revision,
    } = request;
    let state = app.state::<AgentAuthManager>();
    let initial = state.require_exact_account_profile_lease(
        provider,
        &account_id,
        incarnation.value(),
        credential_revision.value(),
        true,
    )?;

    let (lease, provider_result) = match provider {
        AgentProvider::Codex => {
            let context = resolve_account_execution_context(
                &state,
                &initial,
                true,
                state.capture_codex_account_execution_context(&account_id),
                |context| context.lease(),
            )?;
            let lease = context.lease().clone();
            state.require_profile_lease_current(&lease, true)?;
            let joined = tauri::async_runtime::spawn_blocking(move || {
                runtime::codex::read_codex_capabilities_for_context(&context)
            })
            .await;
            let result = match joined {
                Ok(result) => result,
                Err(_) => Err("account capabilities worker failed".to_string()),
            };
            (lease, result)
        }
        AgentProvider::Claude => {
            let context = resolve_account_execution_context(
                &state,
                &initial,
                true,
                state.capture_claude_account_execution_context(&account_id),
                |context| context.lease(),
            )?;
            let lease = context.lease().clone();
            state.require_profile_lease_current(&lease, true)?;
            let joined = tauri::async_runtime::spawn_blocking(move || {
                runtime::claude::read_claude_capabilities_for_context(&context)
            })
            .await;
            let result = match joined {
                Ok(result) => result,
                Err(_) => Err("account capabilities worker failed".to_string()),
            };
            (lease, result)
        }
    };
    let capabilities = resolve_account_owned_provider_result(
        &state,
        &lease,
        true,
        provider_result,
        |capabilities| capabilities.provider,
        "read capabilities",
    )?;
    bind_account_owned_payload(&lease, capabilities.provider, capabilities)
}

#[tauri::command]
async fn request_agent_account_suggestions(
    app: tauri::AppHandle,
    request: RequestAgentAccountSuggestionsRequest,
) -> Result<Vec<AgentAccountOwnedResponse<AgentSuggestionResponse>>, String> {
    let RequestAgentAccountSuggestionsRequest {
        account_id,
        incarnation,
        credential_revision,
        request,
    } = request;
    if request.agent_session_id.trim().is_empty() {
        return Err("agentSessionId is required to own a provider request.".to_string());
    }
    let provider = request.provider;
    let state = app.state::<AgentAuthManager>();
    let initial = state.require_exact_account_profile_lease(
        provider,
        &account_id,
        incarnation.value(),
        credential_revision.value(),
        true,
    )?;

    let (lease, suggestions) = match provider {
        AgentProvider::Codex => {
            let context = resolve_account_execution_context(
                &state,
                &initial,
                true,
                state.capture_codex_account_execution_context(&account_id),
                |context| context.lease(),
            )?;
            let lease = context.lease().clone();
            state.require_profile_lease_current(&lease, true)?;
            let joined = tauri::async_runtime::spawn_blocking(move || {
                runtime::codex::request_codex_suggestion_attempt_for_context(&context, request)
            })
            .await;
            state.require_profile_lease_current(&lease, true)?;
            let attempt = joined.map_err(|_| {
                "Could not complete the selected account suggestion worker.".to_string()
            })?;
            let validation_applied =
                state.apply_codex_account_validation_if_current(&lease, &attempt.validation);
            let suggestions = resolve_account_suggestion_attempt(
                provider,
                validation_applied,
                &attempt.validation,
                attempt.suggestions,
            )?;
            (lease, suggestions)
        }
        AgentProvider::Claude => {
            let context = resolve_account_execution_context(
                &state,
                &initial,
                true,
                state.capture_claude_account_execution_context(&account_id),
                |context| context.lease(),
            )?;
            let lease = context.lease().clone();
            state.require_profile_lease_current(&lease, true)?;
            let joined = tauri::async_runtime::spawn_blocking(move || {
                runtime::claude::request_claude_suggestion_attempt_for_context(&context, request)
            })
            .await;
            state.require_profile_lease_current(&lease, true)?;
            let attempt = joined.map_err(|_| {
                "Could not complete the selected account suggestion worker.".to_string()
            })?;
            let validation_applied =
                state.apply_claude_account_validation_if_current(&lease, &attempt.validation);
            let suggestions = resolve_account_suggestion_attempt(
                provider,
                validation_applied,
                &attempt.validation,
                attempt.suggestions,
            )?;
            (lease, suggestions)
        }
    };
    bind_account_suggestions(&lease, suggestions)
}

#[tauri::command]
fn read_agent_provider_diagnostics(
    provider: AgentProvider,
) -> Result<AgentProviderDiagnostics, String> {
    reject_legacy_provider_only_agent_command("read diagnostics")?;
    Ok(match provider {
        AgentProvider::Codex => runtime::codex::read_codex_diagnostics(),
        AgentProvider::Claude => runtime::claude::read_claude_diagnostics(),
    })
}

#[tauri::command]
async fn read_agent_provider_capabilities(
    provider: AgentProvider,
) -> Result<AgentProviderCapabilities, String> {
    reject_legacy_provider_only_agent_command("read capabilities")?;
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
    reject_legacy_provider_only_agent_command("disconnect")?;
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
            create_authorized_agent_job,
            list_agent_jobs,
            read_agent_job_logs,
            cancel_agent_job,
            list_agent_profiles,
            read_agent_profile_snapshot,
            create_agent_profile,
            rename_agent_profile,
            set_default_agent_profile,
            check_agent_profile,
            disconnect_agent_profile,
            forget_agent_profile,
            read_agent_profile_setup_guidance,
            authorize_agent_profile_lease,
            list_agent_connections,
            begin_agent_login,
            complete_agent_login,
            request_agent_suggestions,
            request_agent_account_suggestions,
            read_agent_provider_diagnostics,
            read_agent_provider_capabilities,
            read_agent_account_diagnostics,
            read_agent_account_capabilities,
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

    fn invoke_json_command(
        webview: &tauri::WebviewWindow<tauri::test::MockRuntime>,
        command: &str,
        body: serde_json::Value,
    ) -> serde_json::Value {
        tauri::test::get_ipc_response(
            webview,
            tauri::webview::InvokeRequest {
                cmd: command.into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "http://tauri.localhost".parse().unwrap(),
                body: body.into(),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        )
        .unwrap_or_else(|error| panic!("{command} failed: {error}"))
        .deserialize::<serde_json::Value>()
        .unwrap()
    }

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
    fn multi_account_profile_lifecycle_commands_expose_transient_metadata_only() {
        let storage_dir = unique_temp_path("profile-lifecycle-commands");
        remove_test_path(&storage_dir);
        fs::create_dir_all(&storage_dir).unwrap();
        let _storage_guard = TestPathGuard(storage_dir.clone());
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(storage_dir.join("agent-auth.json"))
            .unwrap();
        let app = tauri::test::mock_builder()
            .manage(manager)
            .invoke_handler(tauri::generate_handler![
                list_agent_profiles,
                rename_agent_profile,
                set_default_agent_profile,
                forget_agent_profile,
                read_agent_profile_setup_guidance,
            ])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let webview =
            tauri::WebviewWindowBuilder::new(&app, "profile-lifecycle", Default::default())
                .build()
                .unwrap();

        let profiles = invoke_json_command(
            &webview,
            "list_agent_profiles",
            serde_json::json!({"provider": "codex"}),
        );
        let profiles = profiles.as_array().unwrap();
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0]["accountId"], "codex-default");
        assert_eq!(profiles[0]["profileKind"]["kind"], "ambient");

        let guidance = invoke_json_command(
            &webview,
            "read_agent_profile_setup_guidance",
            serde_json::json!({
                "request": {
                    "provider": "codex",
                    "accountId": "codex-default",
                    "shell": "zsh",
                }
            }),
        );
        assert_eq!(guidance["supported"], false);
        assert!(guidance["renderedCommand"].is_null());
        assert!(guidance["unsupportedReason"]
            .as_str()
            .unwrap()
            .contains("ambient"));

        let persisted = fs::read_to_string(storage_dir.join("agent-auth.json")).unwrap();
        assert!(!persisted.contains("renderedCommand"));
        assert!(!persisted.contains("CODEX_HOME"));
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

    #[test]
    fn account_owned_ipc_lifecycle_commands_use_string_leases_and_request_envelopes() {
        let storage_dir = unique_temp_path("account-owned-ipc-lifecycle");
        remove_test_path(&storage_dir);
        fs::create_dir_all(&storage_dir).unwrap();
        let _storage_guard = TestPathGuard(storage_dir.clone());
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(storage_dir.join("agent-auth.json"))
            .unwrap();
        let app = tauri::test::mock_builder()
            .manage(manager)
            .invoke_handler(tauri::generate_handler![
                list_agent_profiles,
                read_agent_profile_snapshot,
                disconnect_agent_profile,
                authorize_agent_profile_lease,
            ])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(
            &app,
            "account-owned-ipc-lifecycle",
            Default::default(),
        )
        .build()
        .unwrap();

        let listed = invoke_json_command(
            &webview,
            "list_agent_profiles",
            serde_json::json!({"provider": "codex"}),
        );
        let listed_codex = listed.as_array().unwrap().first().unwrap();
        for field in ["incarnation", "metadataRevision", "credentialRevision"] {
            assert!(
                listed_codex[field].is_string(),
                "listed {field} must cross IPC as a string"
            );
        }

        let snapshot = invoke_json_command(
            &webview,
            "read_agent_profile_snapshot",
            serde_json::json!({}),
        );
        let codex = snapshot["profiles"]
            .as_array()
            .unwrap()
            .iter()
            .find(|profile| profile["accountId"] == "codex-default")
            .unwrap();
        for field in ["incarnation", "metadataRevision", "credentialRevision"] {
            assert!(
                codex[field].is_string(),
                "{field} must cross IPC as a string"
            );
        }
        let incarnation = codex["incarnation"].as_str().unwrap().to_string();

        let disconnected = invoke_json_command(
            &webview,
            "disconnect_agent_profile",
            serde_json::json!({
                "request": {"provider": "codex", "accountId": "codex-default"}
            }),
        );
        assert_eq!(disconnected["connection"]["status"], "disconnected");
        assert!(disconnected["credentialRevision"].is_string());

        let authorization = invoke_json_command(
            &webview,
            "authorize_agent_profile_lease",
            serde_json::json!({
                "request": {
                    "provider": "codex",
                    "accountId": "codex-default",
                    "incarnation": incarnation,
                    "credentialRevision": disconnected["credentialRevision"],
                }
            }),
        );
        assert_eq!(authorization["authorized"], false);
        assert!(authorization["incarnation"].is_string());
        assert!(authorization["credentialRevision"].is_string());

        let malformed = tauri::test::get_ipc_response(
            &webview,
            tauri::webview::InvokeRequest {
                cmd: "authorize_agent_profile_lease".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "http://tauri.localhost".parse().unwrap(),
                body: serde_json::json!({
                    "request": {
                        "provider": "codex",
                        "accountId": "codex-default",
                        "incarnation": 1,
                        "credentialRevision": "01",
                    }
                })
                .into(),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        );
        assert!(
            malformed.is_err(),
            "non-canonical IPC lease must be rejected"
        );
    }

    #[test]
    fn authorized_agent_job_ipc_rejects_whitespace_ambiguous_session_ownership() {
        let project_dir = unique_temp_path("authorized-agent-job-session-boundary");
        remove_test_path(&project_dir);
        fs::create_dir_all(&project_dir).unwrap();
        let _project_guard = TestPathGuard(project_dir.clone());
        let project_path = fs::canonicalize(&project_dir)
            .unwrap()
            .to_string_lossy()
            .into_owned();

        let auth_manager = AgentAuthManager::new();
        auth_manager
            .initialize_storage(project_dir.join("agent-auth.json"))
            .unwrap();
        let disconnected = auth_manager
            .require_account_profile_lease(AgentProvider::Codex, "codex-default", false)
            .unwrap();
        auth_manager
            .apply_codex_account_validation_if_current(
                &disconnected,
                &Ok("Connected IPC fixture".to_string()),
            )
            .unwrap();
        let current = auth_manager
            .require_account_profile_lease(AgentProvider::Codex, "codex-default", true)
            .unwrap();
        let job_manager = AgentJobManager::new();
        job_manager
            .initialize_storage(project_dir.join("agent-jobs.json"))
            .unwrap();
        let app = tauri::test::mock_builder()
            .manage(auth_manager)
            .manage(job_manager)
            .invoke_handler(tauri::generate_handler![create_authorized_agent_job])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(
            &app,
            "authorized-agent-job-session-boundary",
            Default::default(),
        )
        .build()
        .unwrap();

        let error = tauri::test::get_ipc_response(
            &webview,
            tauri::webview::InvokeRequest {
                cmd: "create_authorized_agent_job".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: "http://tauri.localhost".parse().unwrap(),
                body: serde_json::json!({
                    "request": {
                        "provider": current.provider().as_key(),
                        "accountId": current.account_id(),
                        "incarnation": current.incarnation().to_string(),
                        "credentialRevision": current.credential_revision().to_string(),
                        "projectPath": project_path.clone(),
                        "command": "whoami",
                        "name": "agent-check",
                        "sessionId": " agent-session-1 ",
                    }
                })
                .into(),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        );
        let error = error.expect_err("whitespace-ambiguous session ownership must be rejected");
        let error_message = error.to_string();
        assert!(
            error_message.contains(
                "agentSessionId must be a canonical non-empty string for an authorized Agent job."
            ),
            "unexpected direct IPC rejection: {error_message}"
        );
        assert!(app
            .state::<AgentJobManager>()
            .list_jobs(&project_path, Some(10))
            .unwrap()
            .is_empty());
    }

    #[test]
    fn account_owned_ipc_profile_list_serializes_large_revisions_as_decimal_strings() {
        let storage_dir = unique_temp_path("account-owned-ipc-profile-list-decimals");
        remove_test_path(&storage_dir);
        fs::create_dir_all(&storage_dir).unwrap();
        let _storage_guard = TestPathGuard(storage_dir.clone());
        let storage_path = storage_dir.join("agent-auth.json");

        let bootstrap = AgentAuthManager::new();
        bootstrap.initialize_storage(storage_path.clone()).unwrap();
        drop(bootstrap);

        let mut persisted: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&storage_path).unwrap()).unwrap();
        persisted["profileRegistry"]["nextIncarnation"] = serde_json::json!(u64::MAX);
        let codex = persisted["profileRegistry"]["profiles"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|profile| profile["accountId"] == "codex-default")
            .unwrap();
        codex["incarnation"] = serde_json::json!(u64::MAX - 1);
        codex["metadataRevision"] = serde_json::json!(u64::MAX);
        codex["credentialRevision"] = serde_json::json!(u64::MAX);
        fs::write(
            &storage_path,
            serde_json::to_string_pretty(&persisted).unwrap(),
        )
        .unwrap();

        let manager = AgentAuthManager::new();
        manager.initialize_storage(storage_path).unwrap();
        let app = tauri::test::mock_builder()
            .manage(manager)
            .invoke_handler(tauri::generate_handler![list_agent_profiles])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let webview = tauri::WebviewWindowBuilder::new(
            &app,
            "account-owned-ipc-profile-list-decimals",
            Default::default(),
        )
        .build()
        .unwrap();

        let profiles = invoke_json_command(
            &webview,
            "list_agent_profiles",
            serde_json::json!({"provider": "codex"}),
        );
        let codex = profiles.as_array().unwrap().first().unwrap();
        assert_eq!(codex["incarnation"], (u64::MAX - 1).to_string());
        assert_eq!(codex["metadataRevision"], u64::MAX.to_string());
        assert_eq!(codex["credentialRevision"], u64::MAX.to_string());
    }

    #[test]
    fn account_owned_ipc_stale_result_precedes_provider_failure_and_hides_raw_error() {
        let storage_dir = unique_temp_path("account-owned-ipc-stale-provider-result");
        remove_test_path(&storage_dir);
        fs::create_dir_all(&storage_dir).unwrap();
        let _storage_guard = TestPathGuard(storage_dir.clone());
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(storage_dir.join("agent-auth.json"))
            .unwrap();
        let stale = manager
            .require_account_profile_lease(AgentProvider::Codex, "codex-default", false)
            .unwrap();
        manager
            .disconnect_profile(AgentProvider::Codex, "codex-default")
            .unwrap();

        let error = resolve_account_owned_provider_result(
            &manager,
            &stale,
            false,
            Err::<AgentProviderDiagnostics, _>(
                "private@example.com raw-account-provider-secret".to_string(),
            ),
            |diagnostics| diagnostics.provider,
            "read diagnostics",
        )
        .err()
        .expect("stale provider result must be rejected");

        assert!(error.to_ascii_lowercase().contains("changed"), "{error}");
        assert!(!error.contains("private@example.com"), "{error}");
        assert!(!error.contains("raw-account-provider-secret"), "{error}");
    }

    #[test]
    fn account_owned_ipc_current_provider_failures_are_redacted_and_owner_mismatch_fails_closed() {
        let storage_dir = unique_temp_path("account-owned-ipc-current-provider-result");
        remove_test_path(&storage_dir);
        fs::create_dir_all(&storage_dir).unwrap();
        let _storage_guard = TestPathGuard(storage_dir.clone());
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(storage_dir.join("agent-auth.json"))
            .unwrap();
        let lease = manager
            .require_account_profile_lease(AgentProvider::Codex, "codex-default", false)
            .unwrap();

        let current_failure = resolve_account_owned_provider_result(
            &manager,
            &lease,
            false,
            Err::<AgentProviderDiagnostics, _>("private@example.com raw-current-secret".into()),
            |diagnostics| diagnostics.provider,
            "read diagnostics",
        )
        .err()
        .expect("provider failure must become a generic command error");
        assert_eq!(
            current_failure,
            "Could not read diagnostics for the selected Codex account."
        );
        assert!(!current_failure.contains("private@example.com"));
        assert!(!current_failure.contains("raw-current-secret"));

        let mismatched = AgentProviderDiagnostics {
            provider: AgentProvider::Claude,
            setup_state: runtime::codex::AgentProviderSetupState::Ready,
            connection_path: "Claude".into(),
            summary: "ready".into(),
            guidance: "none".into(),
            base_url: None,
            model: None,
            requirements: vec![],
        };
        let owner_error = resolve_account_owned_provider_result(
            &manager,
            &lease,
            false,
            Ok(mismatched),
            |diagnostics| diagnostics.provider,
            "read diagnostics",
        )
        .err()
        .expect("provider mismatch must fail closed");
        assert_eq!(owner_error, "Account provider response owner mismatch.");
    }

    #[test]
    fn account_owned_ipc_owner_binding_is_flat_and_rejects_mixed_suggestion_batches() {
        let manager = AgentAuthManager::new();
        let lease = manager
            .require_account_profile_lease(AgentProvider::Codex, "codex-default", false)
            .unwrap();
        let diagnostics = AgentProviderDiagnostics {
            provider: AgentProvider::Codex,
            setup_state: runtime::codex::AgentProviderSetupState::Ready,
            connection_path: "Codex".into(),
            summary: "ready".into(),
            guidance: "none".into(),
            base_url: None,
            model: None,
            requirements: vec![],
        };
        let response =
            bind_account_owned_payload(&lease, diagnostics.provider, diagnostics).unwrap();
        let json = serde_json::to_value(response).unwrap();
        assert_eq!(json["provider"], "codex");
        assert_eq!(json["accountId"], "codex-default");
        assert_eq!(json["incarnation"], "1");
        assert_eq!(json["credentialRevision"], "1");
        assert!(json.get("payload").is_none(), "payload must be flattened");

        let suggestions = vec![
            AgentSuggestionResponse {
                id: "codex-1".into(),
                provider: AgentProvider::Codex,
                summary: "first".into(),
                command: "pwd".into(),
                preferred_target: runtime::codex::AgentExecutionTarget::NewTab,
                confidence: runtime::codex::AgentSuggestionConfidence::High,
                error: None,
            },
            AgentSuggestionResponse {
                id: "claude-1".into(),
                provider: AgentProvider::Claude,
                summary: "mixed".into(),
                command: "ls".into(),
                preferred_target: runtime::codex::AgentExecutionTarget::NewTab,
                confidence: runtime::codex::AgentSuggestionConfidence::High,
                error: None,
            },
        ];
        assert!(bind_account_suggestions(&lease, suggestions)
            .err()
            .expect("mixed provider batch must be rejected")
            .contains("owner mismatch"));
    }

    #[test]
    fn account_owned_ipc_context_capture_rejects_a_different_lease_tuple() {
        let manager = AgentAuthManager::new();
        let expected = manager
            .require_account_profile_lease(AgentProvider::Codex, "codex-default", false)
            .unwrap();
        let mismatched = manager
            .require_account_profile_lease(AgentProvider::Claude, "claude-default", false)
            .unwrap();

        let error = resolve_account_execution_context(
            &manager,
            &expected,
            false,
            Ok(mismatched),
            |captured| captured,
        )
        .unwrap_err();
        assert_eq!(error, "Account execution context lease mismatch.");
    }

    #[test]
    fn account_owned_ipc_suggestion_request_uses_one_flat_required_owner_envelope() {
        let request =
            serde_json::from_value::<RequestAgentAccountSuggestionsRequest>(serde_json::json!({
                "provider": "codex",
                "accountId": "codex-profile-1",
                "incarnation": "3",
                "credentialRevision": "7",
                "agentSessionId": "agent-session-1",
                "model": null,
                "reasoningLevel": null,
                "fastMode": false,
                "attachments": [],
                "projectName": "gtum",
                "projectPath": "/workspace/gtum",
                "activeTabId": null,
                "activeTabTitle": null,
                "activeFilePath": null,
                "activeFileLine": null,
                "activeFileSnippet": null,
                "lastNLogLines": [],
                "userTask": "Review the project"
            }))
            .unwrap();
        assert_eq!(request.account_id, "codex-profile-1");
        assert_eq!(request.request.provider, AgentProvider::Codex);
        assert_eq!(request.request.agent_session_id, "agent-session-1");

        for invalid in [
            serde_json::json!({
                "provider": "codex",
                "accountId": "codex-profile-1",
                "incarnation": "3",
                "agentSessionId": "agent-session-1",
                "projectName": "gtum",
                "projectPath": "/workspace/gtum",
                "userTask": "Review"
            }),
            serde_json::json!({
                "provider": "codex",
                "accountId": "codex-profile-1",
                "incarnation": "03",
                "credentialRevision": "7",
                "agentSessionId": "agent-session-1",
                "projectName": "gtum",
                "projectPath": "/workspace/gtum",
                "userTask": "Review"
            }),
            serde_json::json!({
                "provider": "codex",
                "accountId": "codex-profile-1",
                "incarnation": "3",
                "credentialRevision": 7,
                "agentSessionId": "agent-session-1",
                "projectName": "gtum",
                "projectPath": "/workspace/gtum",
                "userTask": "Review"
            }),
            serde_json::json!({
                "accountId": "codex-profile-1",
                "request": {
                    "provider": "codex",
                    "agentSessionId": "agent-session-1",
                    "projectName": "gtum",
                    "projectPath": "/workspace/gtum",
                    "userTask": "Review"
                }
            }),
        ] {
            assert!(
                serde_json::from_value::<RequestAgentAccountSuggestionsRequest>(invalid).is_err()
            );
        }
    }

    #[test]
    fn account_owned_ipc_suggestion_resolution_prioritizes_stale_and_redacts_validation() {
        let changed_success = resolve_account_suggestion_attempt(
            AgentProvider::Claude,
            Ok(false),
            &Ok::<_, String>(runtime::claude::ClaudeConnectionValidation {
                credential_source: runtime::claude::ClaudeCredentialSource::EnvironmentApiKey,
            }),
            Some(Ok(vec![AgentSuggestionResponse {
                id: "changed-success".into(),
                provider: AgentProvider::Claude,
                summary: "must not publish".into(),
                command: "pwd".into(),
                preferred_target: runtime::codex::AgentExecutionTarget::NewTab,
                confidence: runtime::codex::AgentSuggestionConfidence::High,
                error: None,
            }])),
        )
        .err()
        .expect("credential-source-changing success must be suppressed");
        assert!(
            changed_success.to_ascii_lowercase().contains("changed"),
            "{changed_success}"
        );

        let stale = resolve_account_suggestion_attempt(
            AgentProvider::Codex,
            Ok(false),
            &Err::<String, _>("private@example.com raw-validation-secret".to_string()),
            Some(Err("raw-suggestion-secret".to_string())),
        )
        .err()
        .expect("stale validation result must be rejected");
        assert!(stale.to_ascii_lowercase().contains("changed"), "{stale}");
        for forbidden in [
            "private@example.com",
            "raw-validation-secret",
            "raw-suggestion-secret",
        ] {
            assert!(!stale.contains(forbidden), "{stale}");
        }

        let validation_failure = resolve_account_suggestion_attempt(
            AgentProvider::Codex,
            Ok(true),
            &Err::<String, _>("raw-current-secret".to_string()),
            None,
        )
        .err()
        .expect("current validation failure must be rejected");
        assert_eq!(
            validation_failure,
            "Codex authentication could not be validated. Reconnect Codex."
        );
        assert!(!validation_failure.contains("raw-current-secret"));
    }

    #[test]
    fn legacy_provider_only_agent_commands_share_one_fail_closed_boundary() {
        for operation in [
            "begin login",
            "request suggestions",
            "read diagnostics",
            "read capabilities",
            "disconnect",
        ] {
            let error = reject_legacy_provider_only_agent_command(operation).unwrap_err();
            assert_eq!(
                error,
                "An exact Agent account lease is required. Refresh accounts and retry."
            );
        }
    }
}
