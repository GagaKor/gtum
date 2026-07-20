use std::{
    env,
    ffi::{OsStr, OsString},
    fs::{self, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Component, Path, PathBuf},
    process::{Command, Output, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering},
        mpsc::{self, Receiver, TryRecvError},
        Arc,
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::runtime::auth::{
    capture_ambient_codex_account_execution_context, AgentProvider, CodexAccountExecutionContext,
    CodexChildProcessTree,
};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const CODEX_LOGIN_STATUS_LABEL: &str = "codex login status";
const CODEX_CONNECTION_PATH: &str = "Codex CLI ChatGPT session";
const CODEX_EXEC_TIMEOUT: Duration = Duration::from_secs(60);
const CODEX_STATUS_TIMEOUT: Duration = Duration::from_secs(5);
const CODEX_CHILD_INPUT_LIMIT: usize = 1024 * 1024;
const CODEX_CHILD_OUTPUT_LIMIT: usize = 1024 * 1024;
const CODEX_CHILD_IO_DRAIN_TIMEOUT: Duration = Duration::from_secs(1);
const CODEX_ACCOUNT_ENVIRONMENT_OVERRIDES: &[&str] = &[
    "CODEX_HOME",
    "CODEX_ACCESS_TOKEN",
    "CODEX_API_KEY",
    "OPENAI_API_KEY",
    "CODEX_SQLITE_HOME",
];
static CODEX_TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestAgentSuggestionsRequest {
    pub provider: AgentProvider,
    pub agent_session_id: String,
    pub model: Option<String>,
    pub reasoning_level: Option<String>,
    pub fast_mode: Option<bool>,
    #[serde(default)]
    pub attachments: Vec<RequestAgentAttachment>,
    pub project_name: String,
    pub project_path: String,
    pub active_tab_id: Option<String>,
    pub active_tab_title: Option<String>,
    pub active_file_path: Option<String>,
    pub active_file_line: Option<usize>,
    pub active_file_snippet: Option<String>,
    #[serde(default)]
    pub last_n_log_lines: Vec<String>,
    pub user_task: String,
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RequestAgentAttachment {
    pub kind: AgentAttachmentKind,
    pub path: String,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AgentExecutionTarget {
    CurrentTab,
    NewTab,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AgentSuggestionConfidence {
    Low,
    Medium,
    High,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentSuggestionResponse {
    pub id: String,
    pub provider: AgentProvider,
    pub summary: String,
    pub command: String,
    pub preferred_target: AgentExecutionTarget,
    pub confidence: AgentSuggestionConfidence,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AgentProviderSetupState {
    Ready,
    NeedsSetup,
    Deferred,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderRequirementStatus {
    pub name: String,
    pub required: bool,
    pub present: bool,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderDiagnostics {
    pub provider: AgentProvider,
    pub setup_state: AgentProviderSetupState,
    pub connection_path: String,
    pub summary: String,
    pub guidance: String,
    pub base_url: Option<String>,
    pub model: Option<String>,
    pub requirements: Vec<AgentProviderRequirementStatus>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelCapability {
    pub provider_id: AgentProvider,
    pub model_id: String,
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub execution_options: Option<AgentModelExecutionOptions>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelExecutionOptions {
    pub reasoning_levels: Vec<AgentReasoningLevelCapability>,
    pub supports_fast_mode: bool,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AgentAttachmentKind {
    Image,
    File,
    Directory,
    ActiveTab,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentAttachmentCapability {
    pub kind: AgentAttachmentKind,
    pub label: String,
    pub enabled: bool,
    pub invocation_flag: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentReasoningLevelCapability {
    pub level: String,
    pub label: String,
    pub description: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentProviderCapabilities {
    pub provider: AgentProvider,
    pub supports_model_selection: bool,
    pub current_model: Option<AgentModelCapability>,
    pub available_models: Vec<AgentModelCapability>,
    pub reasoning_levels: Vec<AgentReasoningLevelCapability>,
    pub default_reasoning_level: Option<String>,
    pub supports_fast_mode: bool,
    pub attachments: Vec<AgentAttachmentCapability>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexStructuredSuggestion {
    summary: String,
    command: String,
    preferred_target: AgentExecutionTarget,
    confidence: AgentSuggestionConfidence,
    error: Option<String>,
}

#[derive(Default, Deserialize)]
struct CodexModelCatalog {
    models: Vec<CodexModelCatalogEntry>,
}

#[derive(Default, Deserialize, Clone)]
struct CodexModelCatalogEntry {
    slug: String,
    display_name: Option<String>,
    visibility: Option<String>,
    default_reasoning_level: Option<String>,
    #[serde(default)]
    supported_reasoning_levels: Vec<CodexReasoningLevelCatalogEntry>,
    #[serde(default)]
    additional_speed_tiers: Vec<String>,
    #[serde(default)]
    service_tiers: Vec<CodexServiceTierCatalogEntry>,
}

#[derive(Default, Deserialize, Clone)]
struct CodexReasoningLevelCatalogEntry {
    effort: Option<String>,
    level: Option<String>,
    id: Option<String>,
    value: Option<String>,
    name: Option<String>,
    label: Option<String>,
    description: Option<String>,
}

#[derive(Default, Deserialize, Clone)]
struct CodexServiceTierCatalogEntry {
    id: Option<String>,
    name: Option<String>,
}

struct CodexCliStatus {
    binary_available: bool,
    login_status_available: bool,
    auth_mode: Option<String>,
    has_chatgpt_session: bool,
}

impl CodexCliStatus {
    fn account_label(&self) -> String {
        match self.auth_mode.as_deref() {
            Some("chatgpt") => "Codex ChatGPT Session".into(),
            Some("api_key") => "Codex API Key Session".into(),
            Some(mode) if !mode.trim().is_empty() => format!("Codex {} Session", mode),
            _ => "Codex Session".into(),
        }
    }
}

pub fn read_codex_diagnostics() -> AgentProviderDiagnostics {
    capture_ambient_codex_account_execution_context()
        .and_then(|context| read_codex_diagnostics_for_context(&context))
        .unwrap_or_else(|_| {
            diagnostics_from_discovery(!codex_command_candidates().is_empty(), None)
        })
}

pub fn read_codex_capabilities() -> AgentProviderCapabilities {
    capture_ambient_codex_account_execution_context()
        .and_then(|context| read_codex_capabilities_for_context(&context))
        .unwrap_or_else(|_| codex_unavailable_capabilities())
}

fn codex_unavailable_capabilities() -> AgentProviderCapabilities {
    AgentProviderCapabilities {
        provider: AgentProvider::Codex,
        supports_model_selection: false,
        current_model: None,
        available_models: Vec::new(),
        reasoning_levels: Vec::new(),
        default_reasoning_level: None,
        supports_fast_mode: false,
        attachments: vec![AgentAttachmentCapability {
            kind: AgentAttachmentKind::Image,
            label: "Image".into(),
            enabled: false,
            invocation_flag: Some("--image".into()),
        }],
    }
}

fn diagnostics_from_status(status: CodexCliStatus) -> AgentProviderDiagnostics {
    let requirements = requirements_from_status(&status);
    let (setup_state, summary, guidance) = if !status.binary_available {
        (
            AgentProviderSetupState::NeedsSetup,
            "Desktop Codex access is blocked until Codex CLI is installed on this machine.".into(),
            "Install Codex CLI, run `codex login`, then reconnect Codex in gtum.".into(),
        )
    } else if matches!(status.auth_mode.as_deref(), Some("api_key")) {
        (
            AgentProviderSetupState::NeedsSetup,
            "Codex CLI is present, but the current login is API-key based instead of ChatGPT session based.".into(),
            "Run `codex login` without API-key mode so gtum can use the ChatGPT session path.".into(),
        )
    } else if !status.login_status_available {
        (
            AgentProviderSetupState::NeedsSetup,
            "Codex CLI login status could not be read for the current desktop user.".into(),
            "Run `codex login`, confirm `codex login status`, then reconnect Codex.".into(),
        )
    } else if !status.has_chatgpt_session {
        (
            AgentProviderSetupState::NeedsSetup,
            "Codex CLI session is missing or expired for the ChatGPT-based daily-use path.".into(),
            "Run `codex login`, then reconnect Codex.".into(),
        )
    } else {
        (
            AgentProviderSetupState::Ready,
            "Codex CLI is installed and the ChatGPT session is ready for desktop suggestion requests.".into(),
            "Connect Codex to validate the local CLI session before the first suggestion request.".into(),
        )
    };

    AgentProviderDiagnostics {
        provider: AgentProvider::Codex,
        setup_state,
        connection_path: CODEX_CONNECTION_PATH.into(),
        summary,
        guidance,
        base_url: None,
        model: Some("Codex CLI default".into()),
        requirements,
    }
}

fn diagnostics_from_discovery(
    binary_available: bool,
    status: Option<CodexCliStatus>,
) -> AgentProviderDiagnostics {
    diagnostics_from_status(status.unwrap_or(CodexCliStatus {
        binary_available,
        login_status_available: false,
        auth_mode: None,
        has_chatgpt_session: false,
    }))
}

fn requirements_from_status(status: &CodexCliStatus) -> Vec<AgentProviderRequirementStatus> {
    vec![
        AgentProviderRequirementStatus {
            name: "codex CLI".into(),
            required: true,
            present: status.binary_available,
        },
        AgentProviderRequirementStatus {
            name: CODEX_LOGIN_STATUS_LABEL.into(),
            required: true,
            present: status.login_status_available,
        },
        AgentProviderRequirementStatus {
            name: "ChatGPT session".into(),
            required: true,
            present: status.has_chatgpt_session,
        },
    ]
}

pub struct CodexSuggestionAttempt {
    pub validation: Result<String, String>,
    pub suggestions: Option<Result<Vec<AgentSuggestionResponse>, String>>,
}

pub fn request_codex_suggestion_attempt(
    request: RequestAgentSuggestionsRequest,
) -> CodexSuggestionAttempt {
    let context = match capture_ambient_codex_account_execution_context() {
        Ok(context) => context,
        Err(error) => {
            return CodexSuggestionAttempt {
                validation: Err(error),
                suggestions: None,
            };
        }
    };
    request_codex_suggestion_attempt_for_context(&context, request)
}

pub(crate) fn read_codex_diagnostics_for_context(
    context: &CodexAccountExecutionContext,
) -> Result<AgentProviderDiagnostics, String> {
    let candidates = codex_command_candidates();
    if candidates.is_empty() {
        return Ok(diagnostics_from_discovery(false, None));
    }
    Ok(candidates
        .into_iter()
        .find_map(|program| {
            read_codex_diagnostics_with_context(Path::new(&program), context, CODEX_STATUS_TIMEOUT)
                .ok()
        })
        .unwrap_or_else(|| diagnostics_from_discovery(true, None)))
}

pub(crate) fn read_codex_capabilities_for_context(
    context: &CodexAccountExecutionContext,
) -> Result<AgentProviderCapabilities, String> {
    let mut last_error = None;
    for program in codex_command_candidates_for_execution() {
        match read_codex_capabilities_with_context(
            Path::new(&program),
            context,
            CODEX_STATUS_TIMEOUT,
        ) {
            Ok(capabilities) => return Ok(capabilities),
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.unwrap_or_else(|| "Codex CLI is not installed.".to_string()))
}

pub(crate) fn request_codex_suggestion_attempt_for_context(
    context: &CodexAccountExecutionContext,
    request: RequestAgentSuggestionsRequest,
) -> CodexSuggestionAttempt {
    let program = PathBuf::from(codex_command_program());
    request_codex_suggestion_attempt_with_context(
        &program,
        context,
        request,
        CODEX_STATUS_TIMEOUT,
        CODEX_EXEC_TIMEOUT,
    )
}

pub(crate) fn validate_codex_connection_for_context(
    context: &CodexAccountExecutionContext,
) -> Result<String, String> {
    let mut last_error = None;
    for program in codex_command_candidates_for_execution() {
        match validate_codex_connection_with_context(
            Path::new(&program),
            context,
            CODEX_STATUS_TIMEOUT,
        ) {
            Ok(account) => return Ok(account),
            Err(error) => last_error = Some(error),
        }
    }
    Err(last_error.unwrap_or_else(|| "Codex CLI is not installed.".to_string()))
}

pub(crate) fn request_codex_suggestion_attempt_with_context(
    program: &Path,
    context: &CodexAccountExecutionContext,
    request: RequestAgentSuggestionsRequest,
    preflight_timeout: Duration,
    execution_timeout: Duration,
) -> CodexSuggestionAttempt {
    let (validation, suggestions) = run_after_connection_validation(
        || validate_codex_connection_with_context(program, context, preflight_timeout),
        || {
            request_codex_suggestions_after_validation_with_context(
                program,
                context,
                request,
                preflight_timeout,
                execution_timeout,
            )
        },
    );

    CodexSuggestionAttempt {
        validation,
        suggestions,
    }
}

fn run_after_connection_validation<T>(
    validate: impl FnOnce() -> Result<String, String>,
    execute: impl FnOnce() -> Result<T, String>,
) -> (Result<String, String>, Option<Result<T, String>>) {
    let validation = validate();
    if validation.is_err() {
        return (validation, None);
    }

    (validation, Some(execute()))
}

fn validate_codex_status(status: CodexCliStatus) -> Result<String, String> {
    if !status.binary_available {
        return Err(
            "Codex CLI is not installed. Install it and run `codex login` before connecting Codex."
                .into(),
        );
    }

    if matches!(status.auth_mode.as_deref(), Some("api_key")) {
        return Err(
            "Codex CLI is logged in with an API key. Re-run `codex login` with ChatGPT session mode before connecting gtum."
                .into(),
        );
    }

    if !status.login_status_available {
        return Err(
            "Codex CLI login status is unavailable. Run `codex login`, confirm `codex login status`, then reconnect Codex."
                .into(),
        );
    }

    if !status.has_chatgpt_session {
        return Err(
            "Codex CLI session is missing or expired. Run `codex login`, then reconnect Codex."
                .into(),
        );
    }

    Ok(status.account_label())
}

fn request_codex_suggestions_after_validation_with_context(
    program: &Path,
    context: &CodexAccountExecutionContext,
    mut request: RequestAgentSuggestionsRequest,
    preflight_timeout: Duration,
    execution_timeout: Duration,
) -> Result<Vec<AgentSuggestionResponse>, String> {
    sanitize_codex_request_options_with_context(program, context, &mut request, preflight_timeout)?;

    let prompt = build_prompt(&request);
    let codex_home = context.revalidated_codex_home()?;
    let mut artifacts = CodexTempArtifacts::create_in(&codex_home)?;
    let result = (|| {
        artifacts.write_schema()?;
        artifacts.revalidate()?;
        let args = codex_exec_args(
            &request.project_path,
            request.model.as_deref(),
            request.reasoning_level.as_deref(),
            &request.attachments,
            artifacts.schema_path(),
            artifacts.output_path(),
        );
        let (exec_program, args) = codex_invocation_for_program(program, args);
        let output = run_command_with_input_and_timeout_for_context(
            exec_program,
            args,
            &prompt,
            context,
            execution_timeout,
        )?;

        if !output.status.success() {
            return Err(concat!(
                "Codex CLI request failed. Child diagnostics were discarded to protect account ",
                "and project data. Verify the selected Codex account and retry."
            )
            .into());
        }
        let raw_output = artifacts.read_output()?;
        response_from_codex_output(&raw_output, request.provider)
    })();
    let cleanup = artifacts.cleanup();
    match (result, cleanup) {
        (Ok(response), Ok(())) => Ok(vec![response]),
        (Err(error), Ok(())) => Err(error),
        (Ok(_), Err(cleanup_error)) => Err(cleanup_error),
        (Err(error), Err(cleanup_error)) => Err(format!(
            "{error}; secure Codex temporary cleanup failed: {cleanup_error}"
        )),
    }
}

fn sanitize_codex_request_options_with_context(
    program: &Path,
    context: &CodexAccountExecutionContext,
    request: &mut RequestAgentSuggestionsRequest,
    timeout: Duration,
) -> Result<(), String> {
    let catalog_entries = read_codex_model_catalog_entries_with_context(program, context, timeout)?;
    let configured_model = read_codex_config_model_with_context(context)?;
    let effective_model_id = request
        .model
        .as_deref()
        .and_then(non_empty_trimmed)
        .or(configured_model);
    let reasoning_levels =
        codex_reasoning_levels_for_model(&catalog_entries, effective_model_id.as_deref());

    request.reasoning_level = request
        .reasoning_level
        .as_deref()
        .and_then(non_empty_trimmed)
        .filter(|level| reasoning_level_supported(&reasoning_levels, level));
    if !codex_model_supports_fast_mode(&catalog_entries, effective_model_id.as_deref()) {
        request.fast_mode = Some(false);
    }
    Ok(())
}

fn command_for_program(program: impl AsRef<OsStr>) -> Command {
    let mut command = Command::new(program);
    hide_windows_console(&mut command);
    command
}

pub(crate) fn configure_codex_child_environment(
    command: &mut Command,
    context: &CodexAccountExecutionContext,
) -> Result<(), String> {
    if context.lease().provider() != AgentProvider::Codex {
        return Err("the Codex execution context belongs to another provider".to_string());
    }
    let codex_home = context.revalidated_codex_home()?;
    for variable in CODEX_ACCOUNT_ENVIRONMENT_OVERRIDES {
        command.env_remove(variable);
    }
    command.env("CODEX_HOME", codex_home);
    Ok(())
}

pub(crate) fn validate_codex_connection_with_context(
    program: &Path,
    context: &CodexAccountExecutionContext,
    timeout: Duration,
) -> Result<String, String> {
    validate_codex_status(read_codex_cli_status_with_context(
        program, context, timeout,
    )?)
}

fn read_codex_cli_status_with_context(
    program: &Path,
    context: &CodexAccountExecutionContext,
    timeout: Duration,
) -> Result<CodexCliStatus, String> {
    let (program, args) =
        codex_invocation_for_program(program, vec!["login".into(), "status".into()]);
    let output =
        run_command_with_input_and_timeout_for_context(program, args, "", context, timeout)?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let status_output = format!("{stdout}\n{stderr}");
    let normalized = status_output.to_ascii_lowercase();
    let reports_chatgpt = status_output.contains("Logged in using ChatGPT");
    let auth_mode = if reports_chatgpt {
        Some("chatgpt".to_string())
    } else if normalized.contains("api key") || normalized.contains("api_key") {
        Some("api_key".to_string())
    } else {
        None
    };
    Ok(CodexCliStatus {
        binary_available: true,
        login_status_available: true,
        auth_mode,
        has_chatgpt_session: output.status.success() && reports_chatgpt,
    })
}

pub(crate) fn read_codex_diagnostics_with_context(
    program: &Path,
    context: &CodexAccountExecutionContext,
    timeout: Duration,
) -> Result<AgentProviderDiagnostics, String> {
    read_codex_cli_status_with_context(program, context, timeout).map(diagnostics_from_status)
}

pub(crate) fn read_codex_config_model_with_context(
    context: &CodexAccountExecutionContext,
) -> Result<Option<String>, String> {
    read_codex_config_preferences_with_context(context).map(|preferences| preferences.model)
}

#[derive(Default)]
struct CodexConfigPreferences {
    model: Option<String>,
    reasoning_effort: Option<String>,
}

fn read_codex_config_preferences_with_context(
    context: &CodexAccountExecutionContext,
) -> Result<CodexConfigPreferences, String> {
    let Some(snapshot) = context.revalidated_codex_config_snapshot()? else {
        return Ok(CodexConfigPreferences::default());
    };
    Ok(CodexConfigPreferences {
        model: snapshot
            .top_level_string("model")
            .as_deref()
            .and_then(non_empty_trimmed),
        reasoning_effort: snapshot
            .top_level_string("model_reasoning_effort")
            .as_deref()
            .and_then(non_empty_trimmed),
    })
}

fn read_codex_model_catalog_entries_with_context(
    program: &Path,
    context: &CodexAccountExecutionContext,
    timeout: Duration,
) -> Result<Vec<CodexModelCatalogEntry>, String> {
    let (program, args) =
        codex_invocation_for_program(program, vec!["debug".into(), "models".into()]);
    let output =
        run_command_with_input_and_timeout_for_context(program, args, "", context, timeout)?;
    if !output.status.success() {
        return Err("failed to read Codex model catalog".to_string());
    }
    parse_codex_model_catalog_entries(&String::from_utf8_lossy(&output.stdout))
}

pub(crate) fn read_codex_capabilities_with_context(
    program: &Path,
    context: &CodexAccountExecutionContext,
    timeout: Duration,
) -> Result<AgentProviderCapabilities, String> {
    let catalog_entries = read_codex_model_catalog_entries_with_context(program, context, timeout)?;
    let available_models = model_capabilities_from_codex_entries(&catalog_entries);
    let preferences = read_codex_config_preferences_with_context(context)?;
    let current_model_id = preferences.model;
    let current_model = current_model_id.as_deref().and_then(|model_id| {
        model_capability_for_id(AgentProvider::Codex, &available_models, model_id)
    });
    let effective_model_id = current_model
        .as_ref()
        .map(|model| model.model_id.as_str())
        .or(current_model_id.as_deref())
        .or_else(|| {
            available_models
                .first()
                .map(|model| model.model_id.as_str())
        });
    let reasoning_levels = codex_reasoning_levels_for_model(&catalog_entries, effective_model_id);
    let default_reasoning_level = codex_default_reasoning_level_for_model(
        &catalog_entries,
        effective_model_id,
        preferences.reasoning_effort.as_deref(),
        &reasoning_levels,
    );
    let supports_fast_mode = codex_model_supports_fast_mode(&catalog_entries, effective_model_id);

    Ok(AgentProviderCapabilities {
        provider: AgentProvider::Codex,
        supports_model_selection: true,
        current_model,
        available_models,
        reasoning_levels,
        default_reasoning_level,
        supports_fast_mode,
        attachments: vec![AgentAttachmentCapability {
            kind: AgentAttachmentKind::Image,
            label: "Image".into(),
            enabled: true,
            invocation_flag: Some("--image".into()),
        }],
    })
}

#[cfg(target_os = "windows")]
fn hide_windows_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;

    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn hide_windows_console(_command: &mut Command) {}

#[cfg(test)]
fn parse_codex_model_catalog(raw_output: &str) -> Result<Vec<AgentModelCapability>, String> {
    parse_codex_model_catalog_entries(raw_output)
        .map(|entries| model_capabilities_from_codex_entries(&entries))
}

fn parse_codex_model_catalog_entries(
    raw_output: &str,
) -> Result<Vec<CodexModelCatalogEntry>, String> {
    let catalog = serde_json::from_str::<CodexModelCatalog>(raw_output)
        .map_err(|error| format!("failed to parse Codex model catalog: {error}"))?;

    Ok(catalog
        .models
        .into_iter()
        .filter(|model| {
            model
                .visibility
                .as_deref()
                .map(|visibility| visibility == "list")
                .unwrap_or(true)
        })
        .collect())
}

fn model_capabilities_from_codex_entries(
    entries: &[CodexModelCatalogEntry],
) -> Vec<AgentModelCapability> {
    entries
        .iter()
        .filter_map(|model| {
            let model_id = non_empty_trimmed(&model.slug)?;
            let label = model
                .display_name
                .as_deref()
                .and_then(non_empty_trimmed)
                .unwrap_or_else(|| model_id.clone());
            Some(AgentModelCapability {
                provider_id: AgentProvider::Codex,
                model_id,
                label,
                execution_options: None,
            })
        })
        .collect()
}

fn codex_catalog_entry_for_model<'a>(
    entries: &'a [CodexModelCatalogEntry],
    model_id: Option<&str>,
) -> Option<&'a CodexModelCatalogEntry> {
    let selected_model_id = model_id.and_then(non_empty_trimmed);

    selected_model_id
        .as_deref()
        .and_then(|selected| entries.iter().find(|entry| entry.slug == selected))
        .or_else(|| entries.first())
}

fn codex_reasoning_levels_for_model(
    entries: &[CodexModelCatalogEntry],
    model_id: Option<&str>,
) -> Vec<AgentReasoningLevelCapability> {
    codex_catalog_entry_for_model(entries, model_id)
        .map(|entry| {
            entry
                .supported_reasoning_levels
                .iter()
                .filter_map(reasoning_level_capability_from_catalog_entry)
                .collect()
        })
        .unwrap_or_default()
}

fn reasoning_level_capability_from_catalog_entry(
    entry: &CodexReasoningLevelCatalogEntry,
) -> Option<AgentReasoningLevelCapability> {
    let level = entry
        .effort
        .as_deref()
        .or(entry.level.as_deref())
        .or(entry.id.as_deref())
        .or(entry.value.as_deref())
        .and_then(non_empty_trimmed)?;
    let label = entry
        .label
        .as_deref()
        .or(entry.name.as_deref())
        .and_then(non_empty_trimmed)
        .unwrap_or_else(|| codex_reasoning_label(&level));

    Some(AgentReasoningLevelCapability {
        level,
        label,
        description: entry.description.as_deref().and_then(non_empty_trimmed),
    })
}

fn codex_default_reasoning_level_for_model(
    entries: &[CodexModelCatalogEntry],
    model_id: Option<&str>,
    configured_reasoning_level: Option<&str>,
    reasoning_levels: &[AgentReasoningLevelCapability],
) -> Option<String> {
    configured_reasoning_level
        .and_then(non_empty_trimmed)
        .filter(|configured| reasoning_level_supported(reasoning_levels, configured))
        .or_else(|| {
            codex_catalog_entry_for_model(entries, model_id)
                .and_then(|entry| entry.default_reasoning_level.as_deref())
                .and_then(non_empty_trimmed)
                .filter(|configured| reasoning_level_supported(reasoning_levels, configured))
        })
        .or_else(|| reasoning_levels.first().map(|level| level.level.clone()))
}

fn reasoning_level_supported(
    reasoning_levels: &[AgentReasoningLevelCapability],
    selected_level: &str,
) -> bool {
    reasoning_levels
        .iter()
        .any(|level| level.level.eq_ignore_ascii_case(selected_level.trim()))
}

fn codex_model_supports_fast_mode(
    entries: &[CodexModelCatalogEntry],
    model_id: Option<&str>,
) -> bool {
    codex_catalog_entry_for_model(entries, model_id)
        .map(|entry| {
            entry
                .additional_speed_tiers
                .iter()
                .any(|tier| tier.eq_ignore_ascii_case("fast"))
                || entry.service_tiers.iter().any(|tier| {
                    tier.id
                        .as_deref()
                        .map(|id| id.eq_ignore_ascii_case("fast"))
                        .unwrap_or(false)
                        || tier
                            .name
                            .as_deref()
                            .map(|name| name.eq_ignore_ascii_case("fast"))
                            .unwrap_or(false)
                })
        })
        .unwrap_or(false)
}

fn codex_reasoning_label(level: &str) -> String {
    match level.trim().to_ascii_lowercase().as_str() {
        "low" => "Low".into(),
        "medium" => "Medium".into(),
        "high" => "High".into(),
        "xhigh" | "x_high" | "extra_high" => "XHigh".into(),
        value if !value.is_empty() => {
            let mut chars = value.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => "Default".into(),
            }
        }
        _ => "Default".into(),
    }
}

fn model_capability_for_id(
    provider: AgentProvider,
    models: &[AgentModelCapability],
    model_id: &str,
) -> Option<AgentModelCapability> {
    let model_id = non_empty_trimmed(model_id)?;
    models
        .iter()
        .find(|model| model.model_id == model_id)
        .cloned()
        .or_else(|| {
            Some(AgentModelCapability {
                provider_id: provider,
                label: model_id.clone(),
                model_id,
                execution_options: None,
            })
        })
}

fn non_empty_trimmed(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn toml_string_literal(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

#[cfg(target_os = "macos")]
fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(PathBuf::from))
        .or_else(
            || match (env::var_os("HOMEDRIVE"), env::var_os("HOMEPATH")) {
                (Some(drive), Some(path)) => {
                    let mut value = PathBuf::from(drive);
                    value.push(path);
                    Some(value)
                }
                _ => None,
            },
        )
}

fn codex_command_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "codex.cmd"
    } else {
        "codex"
    }
}

fn codex_exec_args(
    project_path: &str,
    model: Option<&str>,
    reasoning_level: Option<&str>,
    attachments: &[RequestAgentAttachment],
    schema_path: &Path,
    output_path: &Path,
) -> Vec<OsString> {
    let mut args: Vec<OsString> = vec![
        "exec".into(),
        "--sandbox".into(),
        "read-only".into(),
        "--skip-git-repo-check".into(),
    ];
    if let Some(model) = model.and_then(non_empty_trimmed) {
        args.push("--model".into());
        args.push(model.into());
    }
    if let Some(reasoning_level) = reasoning_level.and_then(non_empty_trimmed) {
        args.push("-c".into());
        args.push(
            format!(
                "model_reasoning_effort={}",
                toml_string_literal(&reasoning_level)
            )
            .into(),
        );
    }
    for path in codex_image_attachment_paths(attachments) {
        args.push("--image".into());
        args.push(path.into());
    }
    args.extend([
        OsString::from("--output-schema"),
        schema_path.as_os_str().to_os_string(),
        OsString::from("-o"),
        output_path.as_os_str().to_os_string(),
        OsString::from("-C"),
        project_path.into(),
    ]);
    args
}

fn codex_image_attachment_paths(attachments: &[RequestAgentAttachment]) -> Vec<String> {
    attachments
        .iter()
        .filter(|attachment| attachment.kind == AgentAttachmentKind::Image)
        .filter_map(|attachment| non_empty_trimmed(&attachment.path))
        .collect()
}

fn codex_invocation_for_program(program: &Path, args: Vec<OsString>) -> (OsString, Vec<OsString>) {
    if cfg!(target_os = "windows") {
        if let Some((node_program, script_path)) =
            windows_codex_node_entrypoint_from_cmd_path(program)
        {
            let mut node_args = vec![script_path.into_os_string()];
            node_args.extend(args);
            return (node_program, node_args);
        }
    }
    (program.as_os_str().to_os_string(), args)
}

fn windows_codex_node_entrypoint_from_cmd_path(
    codex_cmd_path: &Path,
) -> Option<(OsString, PathBuf)> {
    let install_dir = codex_cmd_path.parent()?;
    let script_path = install_dir
        .join("node_modules")
        .join("@openai")
        .join("codex")
        .join("bin")
        .join("codex.js");

    if !script_path.is_file() {
        return None;
    }

    let local_node = install_dir.join("node.exe");
    let node_program = if local_node.is_file() {
        local_node.into_os_string()
    } else {
        "node.exe".into()
    };

    Some((node_program, script_path))
}

fn find_executable_in_path_with_path(name: &str, path: Option<&OsString>) -> Option<PathBuf> {
    path.and_then(|path| {
        env::split_paths(path)
            .map(|entry| entry.join(name))
            .find(|candidate| candidate.is_file())
    })
}

fn codex_command_program() -> OsString {
    codex_command_candidates()
        .into_iter()
        .next()
        .unwrap_or_else(|| codex_command_name().into())
}

fn codex_command_candidates_for_execution() -> Vec<OsString> {
    let candidates = codex_command_candidates();

    if candidates.is_empty() {
        vec![codex_command_name().into()]
    } else {
        candidates
    }
}

fn codex_command_candidates() -> Vec<OsString> {
    codex_command_candidates_from(env::var_os("PATH"), platform_codex_app_candidates())
}

fn codex_command_candidates_from(
    path: Option<OsString>,
    bundled_candidates: Vec<PathBuf>,
) -> Vec<OsString> {
    let mut candidates = Vec::new();

    if let Some(path_candidate) =
        find_executable_in_path_with_path(codex_command_name(), path.as_ref())
    {
        push_unique_candidate(&mut candidates, path_candidate.into_os_string());
    }

    for candidate in bundled_candidates {
        if candidate.is_file() {
            push_unique_candidate(&mut candidates, candidate.into_os_string());
        }
    }

    candidates
}

fn push_unique_candidate(candidates: &mut Vec<OsString>, candidate: OsString) {
    if !candidates.iter().any(|existing| existing == &candidate) {
        candidates.push(candidate);
    }
}

fn platform_codex_app_candidates() -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let mut candidates = vec![PathBuf::from(
            "/Applications/Codex.app/Contents/Resources/codex",
        )];

        if let Some(home) = home_dir() {
            candidates.push(
                home.join("Applications")
                    .join("Codex.app")
                    .join("Contents")
                    .join("Resources")
                    .join("codex"),
            );
        }

        candidates
    }

    #[cfg(not(target_os = "macos"))]
    {
        Vec::new()
    }
}

#[cfg(all(test, unix))]
fn run_command_with_input_and_timeout(
    program: OsString,
    args: Vec<OsString>,
    input: &str,
    timeout: Duration,
) -> Result<Output, String> {
    run_prepared_command_with_input_and_timeout(command_for_program(&program), args, input, timeout)
}

fn run_command_with_input_and_timeout_for_context(
    program: OsString,
    args: Vec<OsString>,
    input: &str,
    context: &CodexAccountExecutionContext,
    timeout: Duration,
) -> Result<Output, String> {
    let mut command = command_for_program(&program);
    configure_codex_child_environment(&mut command, context)?;
    run_prepared_command_with_input_and_timeout(command, args, input, timeout)
}

fn run_prepared_command_with_input_and_timeout(
    mut command: Command,
    args: Vec<OsString>,
    input: &str,
    timeout: Duration,
) -> Result<Output, String> {
    if input.len() > CODEX_CHILD_INPUT_LIMIT {
        return Err("Codex CLI input exceeded the safe limit".to_string());
    }
    let mut process_tree = CodexChildProcessTree::prepare(&mut command)?;
    let mut child = command
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "failed to launch Codex CLI".to_string())?;
    if let Err(error) = process_tree.attach(&child) {
        process_tree.terminate(&mut child);
        return Err(error);
    }

    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            process_tree.terminate(&mut child);
            return Err("failed to open Codex CLI stdout stream".into());
        }
    };
    let stderr = match child.stderr.take() {
        Some(stderr) => stderr,
        None => {
            process_tree.terminate(&mut child);
            return Err("failed to open Codex CLI stderr stream".into());
        }
    };
    let stdin = match child.stdin.take() {
        Some(stdin) => stdin,
        None => {
            process_tree.terminate(&mut child);
            return Err("failed to open Codex CLI prompt stream".into());
        }
    };
    let output_exceeded = Arc::new(AtomicBool::new(false));
    let observed_output = Arc::new(AtomicUsize::new(0));
    let stdout_reader = match spawn_bounded_child_reader(
        stdout,
        Arc::clone(&observed_output),
        Arc::clone(&output_exceeded),
        "stdout",
    ) {
        Ok(reader) => reader,
        Err(error) => {
            process_tree.terminate(&mut child);
            return Err(error);
        }
    };
    let stderr_reader = match spawn_bounded_child_reader(
        stderr,
        Arc::clone(&observed_output),
        Arc::clone(&output_exceeded),
        "stderr",
    ) {
        Ok(reader) => reader,
        Err(error) => {
            process_tree.terminate(&mut child);
            return Err(error);
        }
    };
    let input_writer = match spawn_bounded_child_writer(stdin, input.as_bytes().to_vec()) {
        Ok(writer) => writer,
        Err(error) => {
            process_tree.terminate(&mut child);
            return Err(error);
        }
    };

    let deadline = Instant::now() + timeout;
    let mut input_pending = true;

    let status = loop {
        if output_exceeded.load(Ordering::Acquire) {
            process_tree.terminate(&mut child);
            return Err("Codex CLI output exceeded the safe limit".to_string());
        }

        if input_pending {
            match input_writer.try_recv() {
                Ok(Ok(())) => input_pending = false,
                Ok(Err(error)) => {
                    process_tree.terminate(&mut child);
                    return Err(error);
                }
                Err(TryRecvError::Empty) => {}
                Err(TryRecvError::Disconnected) => {
                    process_tree.terminate(&mut child);
                    return Err("Codex CLI prompt writer stopped unexpectedly".to_string());
                }
            }
        }

        match child.try_wait() {
            Ok(Some(status)) => {
                process_tree.terminate(&mut child);
                break status;
            }
            Ok(None) => {}
            Err(_) => {
                process_tree.terminate(&mut child);
                return Err("failed to wait for Codex CLI".to_string());
            }
        }

        if Instant::now() >= deadline {
            process_tree.terminate(&mut child);
            return Err(format!(
                "Codex CLI timed out after {} seconds. Try again with a narrower prompt or verify Codex CLI can run from this project.",
                timeout.as_secs()
            ));
        }

        thread::sleep(Duration::from_millis(10));
    };

    let drain_deadline = Instant::now() + CODEX_CHILD_IO_DRAIN_TIMEOUT;
    let stdout = receive_bounded_child_output(stdout_reader, drain_deadline, "stdout")?;
    let stderr = receive_bounded_child_output(stderr_reader, drain_deadline, "stderr")?;
    if output_exceeded.load(Ordering::Acquire) {
        return Err("Codex CLI output exceeded the safe limit".to_string());
    }
    Ok(Output {
        status,
        stdout,
        stderr,
    })
}

fn spawn_bounded_child_reader<T>(
    mut pipe: T,
    observed_output: Arc<AtomicUsize>,
    output_exceeded: Arc<AtomicBool>,
    label: &'static str,
) -> Result<Receiver<Result<Vec<u8>, String>>, String>
where
    T: Read + Send + 'static,
{
    let (sender, receiver) = mpsc::sync_channel(1);
    thread::Builder::new()
        .name(format!("codex-cli-{label}"))
        .spawn(move || {
            let result = (|| {
                let mut output = Vec::new();
                let mut buffer = [0_u8; 8192];
                loop {
                    let read = pipe
                        .read(&mut buffer)
                        .map_err(|_| format!("failed to read Codex CLI {label}"))?;
                    if read == 0 {
                        break;
                    }
                    let previously_observed = observed_output.fetch_add(read, Ordering::AcqRel);
                    let remaining = CODEX_CHILD_OUTPUT_LIMIT.saturating_sub(previously_observed);
                    output.extend_from_slice(&buffer[..read.min(remaining)]);
                    if previously_observed.saturating_add(read) > CODEX_CHILD_OUTPUT_LIMIT {
                        output_exceeded.store(true, Ordering::Release);
                        break;
                    }
                }
                Ok(output)
            })();
            let _ = sender.send(result);
        })
        .map_err(|_| format!("failed to monitor Codex CLI {label}"))?;
    Ok(receiver)
}

fn spawn_bounded_child_writer(
    mut stdin: std::process::ChildStdin,
    input: Vec<u8>,
) -> Result<Receiver<Result<(), String>>, String> {
    let (sender, receiver) = mpsc::sync_channel(1);
    thread::Builder::new()
        .name("codex-cli-stdin".to_string())
        .spawn(move || {
            let result = stdin
                .write_all(&input)
                .map_err(|_| "failed to write Codex CLI prompt".to_string());
            drop(stdin);
            let _ = sender.send(result);
        })
        .map_err(|_| "failed to monitor Codex CLI prompt input".to_string())?;
    Ok(receiver)
}

fn receive_bounded_child_output(
    receiver: Receiver<Result<Vec<u8>, String>>,
    deadline: Instant,
    label: &str,
) -> Result<Vec<u8>, String> {
    let remaining = deadline.saturating_duration_since(Instant::now());
    receiver
        .recv_timeout(remaining)
        .map_err(|_| format!("Codex CLI {label} monitor did not stop safely"))?
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct CodexArtifactIdentity {
    device: u64,
    file: u64,
}

struct CodexTempArtifactFile {
    path: PathBuf,
    file: Option<fs::File>,
    identity: CodexArtifactIdentity,
}

impl CodexTempArtifactFile {
    fn create(path: PathBuf) -> Result<Self, String> {
        let file = create_new_codex_artifact_file(&path)?;
        let identity = codex_artifact_identity(&file)?;
        Ok(Self {
            path,
            file: Some(file),
            identity,
        })
    }

    fn revalidate(&self) -> Result<(), String> {
        let held = self
            .file
            .as_ref()
            .ok_or_else(|| "Codex temporary artifact handle is closed".to_string())?;
        revalidate_codex_artifact_file(&self.path, held, self.identity)
    }
}

struct CodexTempArtifacts {
    directory_path: PathBuf,
    directory: Option<fs::File>,
    directory_identity: CodexArtifactIdentity,
    schema: CodexTempArtifactFile,
    output: CodexTempArtifactFile,
}

impl CodexTempArtifacts {
    fn create_in(parent: &Path) -> Result<Self, String> {
        Self::create_in_with_candidate_names(
            parent,
            (0..64).map(|_| {
                let counter = CODEX_TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
                OsString::from(format!(
                    ".gtum-codex-request-{}-{}-{counter}",
                    std::process::id(),
                    unix_timestamp_ms()
                ))
            }),
        )
    }

    fn create_in_with_candidate_names(
        parent: &Path,
        candidate_names: impl IntoIterator<Item = OsString>,
    ) -> Result<Self, String> {
        let parent = fs::canonicalize(parent)
            .map_err(|error| format!("failed to resolve Codex temporary parent: {error}"))?;
        let parent_metadata = fs::symlink_metadata(&parent)
            .map_err(|error| format!("failed to inspect Codex temporary parent: {error}"))?;
        if parent_metadata.file_type().is_symlink() || !parent_metadata.is_dir() {
            return Err("Codex temporary parent must be a real directory".to_string());
        }

        for candidate_name in candidate_names {
            let mut components = Path::new(&candidate_name).components();
            if !matches!(components.next(), Some(Component::Normal(_)))
                || components.next().is_some()
            {
                return Err(
                    "Codex temporary directory name is not a safe path component".to_string(),
                );
            }
            let directory_path = parent.join(candidate_name);
            if fs::symlink_metadata(&directory_path).is_ok() {
                continue;
            }
            if let Err(error) = crate::runtime::auth::create_private_directory(&directory_path) {
                if fs::symlink_metadata(&directory_path).is_ok() {
                    continue;
                }
                return Err(format!(
                    "failed to create private Codex temporary directory: {error}"
                ));
            }

            return Self::open_created(directory_path);
        }

        Err("failed to reserve a unique private Codex temporary directory".to_string())
    }

    fn open_created(directory_path: PathBuf) -> Result<Self, String> {
        let directory = open_codex_artifact_directory(&directory_path)?;
        let directory_identity = codex_artifact_identity(&directory)?;
        let schema_path = directory_path.join("schema.json");
        let schema = match CodexTempArtifactFile::create(schema_path) {
            Ok(schema) => schema,
            Err(error) => {
                drop(directory);
                let _ = remove_verified_codex_directory(&directory_path, directory_identity);
                return Err(error);
            }
        };
        let output_path = directory_path.join("output.json");
        let output = match CodexTempArtifactFile::create(output_path) {
            Ok(output) => output,
            Err(error) => {
                let schema_identity = schema.identity;
                let schema_path = schema.path.clone();
                drop(schema);
                let _ = remove_verified_codex_file(&schema_path, schema_identity);
                drop(directory);
                let _ = remove_verified_codex_directory(&directory_path, directory_identity);
                return Err(error);
            }
        };
        let artifacts = Self {
            directory_path,
            directory: Some(directory),
            directory_identity,
            schema,
            output,
        };
        artifacts.revalidate()?;
        Ok(artifacts)
    }

    #[cfg(test)]
    fn directory_path(&self) -> &Path {
        &self.directory_path
    }

    fn schema_path(&self) -> &Path {
        &self.schema.path
    }

    fn output_path(&self) -> &Path {
        &self.output.path
    }

    fn write_schema(&mut self) -> Result<(), String> {
        self.revalidate()?;
        let file = self
            .schema
            .file
            .as_mut()
            .ok_or_else(|| "Codex schema handle is closed".to_string())?;
        write_codex_schema_to_file(file)
    }

    fn read_output(&mut self) -> Result<String, String> {
        self.revalidate()?;
        let file = self
            .output
            .file
            .as_mut()
            .ok_or_else(|| "Codex output handle is closed".to_string())?;
        file.seek(SeekFrom::Start(0))
            .map_err(|error| format!("failed to seek Codex CLI output: {error}"))?;
        let mut output = String::new();
        file.read_to_string(&mut output)
            .map_err(|error| format!("failed to read Codex CLI output: {error}"))?;
        Ok(output)
    }

    fn revalidate(&self) -> Result<(), String> {
        let directory = self
            .directory
            .as_ref()
            .ok_or_else(|| "Codex temporary directory handle is closed".to_string())?;
        revalidate_codex_artifact_directory(
            &self.directory_path,
            directory,
            self.directory_identity,
        )?;
        self.schema.revalidate()?;
        self.output.revalidate()
    }

    fn cleanup(mut self) -> Result<(), String> {
        self.revalidate()?;
        let schema_path = self.schema.path.clone();
        let schema_identity = self.schema.identity;
        let output_path = self.output.path.clone();
        let output_identity = self.output.identity;
        self.schema.file.take();
        self.output.file.take();
        remove_verified_codex_file(&schema_path, schema_identity)?;
        remove_verified_codex_file(&output_path, output_identity)?;
        self.directory.take();
        remove_verified_codex_directory(&self.directory_path, self.directory_identity)
    }
}

fn revalidate_codex_artifact_file(
    path: &Path,
    held: &fs::File,
    expected: CodexArtifactIdentity,
) -> Result<(), String> {
    let current = open_codex_artifact_file(path)
        .map_err(|_| "Codex temporary artifact identity changed".to_string())?;
    let path_identity = codex_artifact_identity(&current)?;
    let held_identity = codex_artifact_identity(held)?;
    if path_identity != expected || held_identity != expected {
        return Err("Codex temporary artifact identity changed".to_string());
    }
    Ok(())
}

fn revalidate_codex_artifact_directory(
    path: &Path,
    held: &fs::File,
    expected: CodexArtifactIdentity,
) -> Result<(), String> {
    let current = open_codex_artifact_directory(path)
        .map_err(|_| "Codex temporary directory identity changed".to_string())?;
    let path_identity = codex_artifact_identity(&current)?;
    let held_identity = codex_artifact_identity(held)?;
    if path_identity != expected || held_identity != expected {
        return Err("Codex temporary directory identity changed".to_string());
    }
    Ok(())
}

fn remove_verified_codex_file(path: &Path, expected: CodexArtifactIdentity) -> Result<(), String> {
    let current = open_codex_artifact_file(path)
        .map_err(|_| "Codex temporary artifact identity changed before cleanup".to_string())?;
    if codex_artifact_identity(&current)? != expected {
        return Err("Codex temporary artifact identity changed before cleanup".to_string());
    }
    drop(current);
    fs::remove_file(path)
        .map_err(|error| format!("failed to remove verified Codex temporary artifact: {error}"))
}

fn remove_verified_codex_directory(
    path: &Path,
    expected: CodexArtifactIdentity,
) -> Result<(), String> {
    let current = open_codex_artifact_directory(path)
        .map_err(|_| "Codex temporary directory identity changed before cleanup".to_string())?;
    if codex_artifact_identity(&current)? != expected {
        return Err("Codex temporary directory identity changed before cleanup".to_string());
    }
    drop(current);
    fs::remove_dir(path)
        .map_err(|error| format!("failed to remove verified Codex temporary directory: {error}"))
}

#[cfg(unix)]
fn open_codex_artifact_directory(path: &Path) -> Result<fs::File, String> {
    use std::os::unix::fs::OpenOptionsExt;

    OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_CLOEXEC | libc::O_DIRECTORY | libc::O_NOFOLLOW)
        .open(path)
        .map_err(|error| format!("failed to securely open Codex temporary directory: {error}"))
}

#[cfg(target_os = "windows")]
fn open_codex_artifact_directory(path: &Path) -> Result<fs::File, String> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_DELETE,
        FILE_SHARE_READ, FILE_SHARE_WRITE,
    };

    let file = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|error| format!("failed to securely open Codex temporary directory: {error}"))?;
    validate_windows_codex_artifact_type(&file, true)?;
    Ok(file)
}

#[cfg(not(any(unix, target_os = "windows")))]
fn open_codex_artifact_directory(_path: &Path) -> Result<fs::File, String> {
    Err("secure Codex temporary directory handles are unavailable on this platform".to_string())
}

#[cfg(unix)]
fn open_codex_artifact_file(path: &Path) -> Result<fs::File, String> {
    use std::os::unix::fs::OpenOptionsExt;

    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(path)
        .map_err(|error| format!("failed to securely open Codex temporary artifact: {error}"))?;
    if !file
        .metadata()
        .map_err(|error| format!("failed to inspect Codex temporary artifact: {error}"))?
        .is_file()
    {
        return Err("Codex temporary artifact must be a regular file".to_string());
    }
    Ok(file)
}

#[cfg(target_os = "windows")]
fn open_codex_artifact_file(path: &Path) -> Result<fs::File, String> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
    };

    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|error| format!("failed to securely open Codex temporary artifact: {error}"))?;
    validate_windows_codex_artifact_type(&file, false)?;
    Ok(file)
}

#[cfg(not(any(unix, target_os = "windows")))]
fn open_codex_artifact_file(_path: &Path) -> Result<fs::File, String> {
    Err("secure Codex temporary artifact handles are unavailable on this platform".to_string())
}

#[cfg(unix)]
fn codex_artifact_identity(file: &fs::File) -> Result<CodexArtifactIdentity, String> {
    use std::os::unix::fs::MetadataExt;

    let metadata = file
        .metadata()
        .map_err(|error| format!("failed to inspect Codex temporary artifact: {error}"))?;
    Ok(CodexArtifactIdentity {
        device: metadata.dev(),
        file: metadata.ino(),
    })
}

#[cfg(target_os = "windows")]
fn codex_artifact_identity(file: &fs::File) -> Result<CodexArtifactIdentity, String> {
    let information = windows_codex_artifact_information(file)?;
    Ok(CodexArtifactIdentity {
        device: u64::from(information.dwVolumeSerialNumber),
        file: (u64::from(information.nFileIndexHigh) << 32) | u64::from(information.nFileIndexLow),
    })
}

#[cfg(target_os = "windows")]
fn windows_codex_artifact_information(
    file: &fs::File,
) -> Result<windows_sys::Win32::Storage::FileSystem::BY_HANDLE_FILE_INFORMATION, String> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
    };

    let mut information = BY_HANDLE_FILE_INFORMATION::default();
    let succeeded =
        unsafe { GetFileInformationByHandle(file.as_raw_handle().cast(), &mut information) };
    if succeeded == 0 {
        return Err(format!(
            "failed to inspect Codex temporary artifact handle: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(information)
}

#[cfg(target_os = "windows")]
fn validate_windows_codex_artifact_type(file: &fs::File, directory: bool) -> Result<(), String> {
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT,
    };

    let attributes = windows_codex_artifact_information(file)?.dwFileAttributes;
    if attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err("Codex temporary artifact must not be a reparse point".to_string());
    }
    let is_directory = attributes & FILE_ATTRIBUTE_DIRECTORY != 0;
    if is_directory != directory {
        return Err("Codex temporary artifact has the wrong file type".to_string());
    }
    Ok(())
}

#[cfg(not(any(unix, target_os = "windows")))]
fn codex_artifact_identity(_file: &fs::File) -> Result<CodexArtifactIdentity, String> {
    Err("secure Codex temporary artifact identity is unavailable on this platform".to_string())
}

#[cfg(test)]
fn temp_file_path(prefix: &str, extension: &str) -> PathBuf {
    let counter = CODEX_TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    env::temp_dir().join(format!(
        "{prefix}-{}-{}-{counter}.{extension}",
        std::process::id(),
        unix_timestamp_ms()
    ))
}

#[cfg(test)]
fn write_schema_file(path: &PathBuf) -> Result<(), String> {
    let mut file = create_new_codex_artifact_file(path)?;
    write_codex_schema_to_file(&mut file)
}

fn write_codex_schema_to_file(file: &mut fs::File) -> Result<(), String> {
    let schema = json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "summary": {
                "type": "string",
                "description": "A concise assistant reply or action summary."
            },
            "command": {
                "type": "string",
                "description": concat!(
                    "A terminal command to show as a gtum UI permission-card preview only when user review ",
                    "or permission is required; it is not executed by Codex CLI. Leave empty for normal replies."
                )
            },
            "preferredTarget": {
                "type": "string",
                "enum": ["current_tab", "new_tab"]
            },
            "confidence": {
                "type": "string",
                "enum": ["low", "medium", "high"]
            },
            "error": {
                "type": ["string", "null"],
                "description": "Explain why the request cannot be answered safely. Use null for normal replies and command suggestions."
            }
        },
        "required": ["summary", "command", "preferredTarget", "confidence", "error"]
    });

    let serialized = serde_json::to_string(&schema)
        .map_err(|error| format!("failed to serialize Codex CLI output schema: {error}"))?;
    file.set_len(0)
        .and_then(|_| file.seek(SeekFrom::Start(0)))
        .map_err(|error| format!("failed to prepare Codex CLI output schema: {error}"))?;
    file.write_all(serialized.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("failed to write Codex CLI output schema: {error}"))
}

#[cfg(unix)]
fn create_new_codex_artifact_file(path: &Path) -> Result<fs::File, String> {
    use std::os::unix::fs::OpenOptionsExt;

    OpenOptions::new()
        .create_new(true)
        .read(true)
        .write(true)
        .mode(0o600)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(path)
        .map_err(|error| format!("failed to securely create Codex CLI artifact: {error}"))
}

#[cfg(target_os = "windows")]
fn create_new_codex_artifact_file(path: &Path) -> Result<fs::File, String> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
    };

    OpenOptions::new()
        .create_new(true)
        .read(true)
        .write(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|error| format!("failed to securely create Codex CLI artifact: {error}"))
}

#[cfg(not(any(unix, target_os = "windows")))]
fn create_new_codex_artifact_file(_path: &Path) -> Result<fs::File, String> {
    Err("secure Codex CLI artifact creation is unavailable on this platform".to_string())
}

fn response_from_codex_output(
    raw_output: &str,
    provider: AgentProvider,
) -> Result<AgentSuggestionResponse, String> {
    let structured = serde_json::from_str::<CodexStructuredSuggestion>(raw_output)
        .map_err(|error| format!("failed to parse Codex CLI structured response: {error}"))?;

    normalize_codex_suggestion(structured, provider)
}

fn normalize_codex_suggestion(
    structured: CodexStructuredSuggestion,
    provider: AgentProvider,
) -> Result<AgentSuggestionResponse, String> {
    let normalized_error = structured
        .error
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let normalized_command = structured.command.trim().to_string();
    let normalized_summary = structured.summary.trim();

    if normalized_error.is_none() && normalized_command.is_empty() && normalized_summary.is_empty()
    {
        return Err(
            "Codex CLI returned an empty response without a command or error reason.".into(),
        );
    }

    if normalized_error.is_none() && !normalized_command.is_empty() {
        if let Some(error) = windows_command_preview_error(&normalized_command) {
            return Ok(AgentSuggestionResponse {
                id: format!("codex-{}", unix_timestamp_ms()),
                provider,
                summary: if normalized_summary.is_empty() {
                    "Codex suggested a command gtum cannot run on Windows.".into()
                } else {
                    normalized_summary.into()
                },
                command: String::new(),
                preferred_target: structured.preferred_target,
                confidence: structured.confidence,
                error: Some(error),
            });
        }
    }

    let fallback_summary = if normalized_error.is_some() && normalized_command.is_empty() {
        "Codex could not complete the request."
    } else if normalized_command.is_empty() {
        "Codex response"
    } else {
        "Codex suggestion"
    };
    Ok(AgentSuggestionResponse {
        id: format!("codex-{}", unix_timestamp_ms()),
        provider,
        summary: if normalized_summary.is_empty() {
            fallback_summary.into()
        } else {
            normalized_summary.into()
        },
        command: normalized_command,
        preferred_target: structured.preferred_target,
        confidence: structured.confidence,
        error: normalized_error,
    })
}

fn windows_command_preview_error(command: &str) -> Option<String> {
    #[cfg(target_os = "windows")]
    {
        crate::runtime::platform::terminal_command_runner(command)
            .err()
            .map(|error| {
                format!(
                    "Codex suggested a command gtum cannot run on Windows without an interactive shell: {error}"
                )
            })
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = command;
        None
    }
}

fn build_prompt(request: &RequestAgentSuggestionsRequest) -> String {
    let file_path = request
        .active_file_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("none");
    let file_line = request
        .active_file_line
        .map(|value| value.to_string())
        .unwrap_or_else(|| "none".into());
    let file_snippet = request
        .active_file_snippet
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("No active file snippet was attached.");
    let log_lines = if request.last_n_log_lines.is_empty() {
        "No recent terminal logs were attached.".to_string()
    } else {
        request
            .last_n_log_lines
            .iter()
            .take(50)
            .map(|line| {
                if line.trim().is_empty() {
                    "(blank line)".to_string()
                } else {
                    line.clone()
                }
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    let reasoning_level = request
        .reasoning_level
        .as_deref()
        .and_then(non_empty_trimmed)
        .unwrap_or_else(|| "runtime default".into());
    let fast_mode = if request.fast_mode.unwrap_or(false) {
        "enabled"
    } else {
        "disabled"
    };

    let instructions = concat!(
        "You are Codex inside gtum, a desktop workspace for terminal-heavy development.\n",
        "Read the project metadata, the active file snippet, and recent terminal logs.\n",
        "Respond naturally to the user's request.\n",
        "The `command` field is only a gtum UI permission-card preview; it is not executed by Codex CLI.\n",
        "gtum will show the command in the right Agent panel with Allow once and Deny actions.\n",
        "Do not request permission from Codex CLI, do not run the command yourself, and do not treat ",
        "Codex CLI approval or sandbox policy (for example approval_policy=never) as a reason to refuse ",
        "a harmless UI permission request.\n",
        "Only set `command` when the next step requires explicit user review, permission, or a terminal ",
        "command the user should inspect before running.\n",
        "If the user asks for an Agent panel event card, choice card, options, or numbered choices, ",
        "leave `command` empty and put the choices in `summary` as plain numbered lines such as ",
        "`1. Option 1`, `2. Option 2`, and `3. Option 3`. Do not use terminal commands, shell ",
        "`read`, `printf`, or `echo` to collect those choices.\n",
        "Permission-test requests for Terminal, iTerm, or app access must stay reply-only: leave `command` ",
        "empty and put the decision in `summary` as numbered Agent-panel choices such as ",
        "`1. Allow the request in the Agent panel` and `2. Deny the request`.\n",
        "For normal explanations, status checks, planning, or answers that do not require permission, ",
        "leave `command` empty and put the answer in `summary`.\n",
        "Do not invent commands just to satisfy the schema.\n",
        "If the request cannot be answered safely, set `error` and leave `command` empty."
    );
    let platform_command_guidance = platform_command_runner_guidance();

    format!(
        "{}\n{}\n\nProject name: {}\nProject path: {}\nOrigin Agent session id: {}\nReasoning level: {}\nFast mode: {}\nActive file path: {}\nActive file line: {}\nActive file snippet (truncated):\n{}\n\nActive tab id: {}\nActive tab title: {}\nUser task: {}\nRecent terminal logs (most recent last, max 50 lines):\n{}\n\nReturn a direct assistant response. Include a reviewable command only if the user must decide or approve an action.",
        instructions,
        platform_command_guidance,
        request.project_name.trim(),
        request.project_path.trim(),
        request.agent_session_id.trim(),
        reasoning_level,
        fast_mode,
        file_path,
        file_line,
        file_snippet,
        request.active_tab_id.as_deref().unwrap_or("none"),
        request.active_tab_title.as_deref().unwrap_or("none"),
        request.user_task.trim(),
        log_lines,
    )
}

fn platform_command_runner_guidance() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "Platform command runner note: this Windows app runs approved new-tab commands without cmd.exe or PowerShell. Never return cmd.exe, powershell.exe, pwsh.exe, shell builtins such as echo, .cmd/.bat/.ps1 shims, pipes, redirects, or shell syntax. Use a direct .exe or .com program with plain arguments; for a harmless permission test use `whoami`."
    }

    #[cfg(not(target_os = "windows"))]
    {
        "Platform command runner note: for a harmless permission test on this platform, `echo \"gtum permission request test\"` is acceptable."
    }
}

fn unix_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_owned_ipc_codex_exports_context_only_high_level_wrappers() {
        let _diagnostics: fn(
            &CodexAccountExecutionContext,
        ) -> Result<AgentProviderDiagnostics, String> = read_codex_diagnostics_for_context;
        let _capabilities: fn(
            &CodexAccountExecutionContext,
        ) -> Result<AgentProviderCapabilities, String> = read_codex_capabilities_for_context;
        let _suggestions: fn(
            &CodexAccountExecutionContext,
            RequestAgentSuggestionsRequest,
        ) -> CodexSuggestionAttempt = request_codex_suggestion_attempt_for_context;
    }

    #[test]
    fn codex_account_context_temp_paths_are_unique_under_burst_allocation() {
        let paths = (0..2_048)
            .map(|_| temp_file_path("gtum-codex-account-context", "json"))
            .collect::<std::collections::HashSet<_>>();

        assert_eq!(paths.len(), 2_048, "temporary paths must never alias");
    }

    #[test]
    fn codex_account_context_schema_collision_never_truncates_existing_file() {
        let schema_path = temp_file_path("gtum-codex-schema-collision", "json");
        write_schema_file(&schema_path).unwrap();
        fs::write(&schema_path, "collision sentinel").unwrap();

        let collision = write_schema_file(&schema_path);
        let preserved = fs::read_to_string(&schema_path).unwrap();
        let _ = fs::remove_file(&schema_path);

        assert!(
            collision.is_err(),
            "an existing path must never be reopened"
        );
        assert_eq!(preserved, "collision sentinel");
    }

    #[cfg(unix)]
    #[test]
    fn codex_account_context_schema_symlink_is_rejected_without_touching_target() {
        use std::os::unix::fs::symlink;

        let root = temp_file_path("gtum-codex-schema-symlink", "dir");
        fs::create_dir(&root).unwrap();
        let target = root.join("target.json");
        let schema_path = root.join("schema.json");
        fs::write(&target, "symlink sentinel").unwrap();
        symlink(&target, &schema_path).unwrap();

        let tamper = write_schema_file(&schema_path);
        let preserved = fs::read_to_string(&target).unwrap();
        let _ = fs::remove_file(&schema_path);
        let _ = fs::remove_file(&target);
        let _ = fs::remove_dir(&root);

        assert!(tamper.is_err(), "a schema symlink must be rejected");
        assert_eq!(preserved, "symlink sentinel");
    }

    #[test]
    fn codex_account_context_temp_workspace_retries_collision_without_truncation() {
        let parent = temp_file_path("gtum-codex-workspace-collision", "dir");
        fs::create_dir(&parent).unwrap();
        let collision = parent.join("collision");
        fs::create_dir(&collision).unwrap();
        fs::write(collision.join("sentinel"), "preserve me").unwrap();

        let artifacts = CodexTempArtifacts::create_in_with_candidate_names(
            &parent,
            [OsString::from("collision"), OsString::from("created")],
        )
        .unwrap();
        let created = artifacts.directory_path().to_path_buf();
        assert_eq!(created, parent.canonicalize().unwrap().join("created"));
        assert_eq!(
            fs::read_to_string(collision.join("sentinel")).unwrap(),
            "preserve me"
        );

        artifacts.cleanup().unwrap();
        assert!(!created.exists());
        assert!(collision.join("sentinel").exists());
        let _ = fs::remove_dir_all(&parent);
    }

    #[test]
    fn codex_account_context_temp_workspace_rejects_replaced_output_identity() {
        let parent = temp_file_path("gtum-codex-output-tamper", "dir");
        fs::create_dir(&parent).unwrap();
        let mut artifacts = CodexTempArtifacts::create_in_with_candidate_names(
            &parent,
            [OsString::from("workspace")],
        )
        .unwrap();
        let output_path = artifacts.output_path().to_path_buf();
        let displaced = artifacts.directory_path().join("original-output.json");
        fs::rename(&output_path, &displaced).unwrap();
        fs::write(&output_path, "replacement sentinel").unwrap();

        let error = artifacts.read_output().unwrap_err();
        assert!(error.contains("identity changed"), "{error}");
        let cleanup_error = artifacts.cleanup().unwrap_err();
        assert!(
            cleanup_error.contains("identity changed"),
            "{cleanup_error}"
        );
        assert_eq!(
            fs::read_to_string(&output_path).unwrap(),
            "replacement sentinel"
        );

        let _ = fs::remove_file(&output_path);
        let _ = fs::remove_file(&displaced);
        let _ = fs::remove_file(parent.join("workspace").join("schema.json"));
        let _ = fs::remove_dir(parent.join("workspace"));
        let _ = fs::remove_dir(&parent);
    }

    fn status(
        binary_available: bool,
        login_status_available: bool,
        auth_mode: Option<&str>,
        has_chatgpt_session: bool,
    ) -> CodexCliStatus {
        CodexCliStatus {
            binary_available,
            login_status_available,
            auth_mode: auth_mode.map(str::to_string),
            has_chatgpt_session,
        }
    }

    #[test]
    fn diagnostics_report_missing_cli_as_needs_setup() {
        let diagnostics = diagnostics_from_status(status(false, false, None, false));

        assert_eq!(diagnostics.setup_state, AgentProviderSetupState::NeedsSetup);
        assert_eq!(
            diagnostics.summary,
            "Desktop Codex access is blocked until Codex CLI is installed on this machine."
        );
        assert!(diagnostics
            .requirements
            .iter()
            .any(|requirement| requirement.name == "codex CLI" && !requirement.present));
    }

    #[test]
    fn codex_account_context_diagnostics_keep_cli_present_when_ambient_root_is_unavailable() {
        let diagnostics = diagnostics_from_discovery(true, None);

        assert_eq!(diagnostics.setup_state, AgentProviderSetupState::NeedsSetup);
        assert!(!diagnostics.summary.contains("until Codex CLI is installed"));
        assert!(diagnostics
            .requirements
            .iter()
            .any(|requirement| requirement.name == "codex CLI" && requirement.present));
        assert!(diagnostics.requirements.iter().any(|requirement| {
            requirement.name == CODEX_LOGIN_STATUS_LABEL && !requirement.present
        }));
    }

    #[test]
    fn validation_reports_unavailable_login_status_separately() {
        let error = validate_codex_status(status(true, false, None, false)).unwrap_err();

        assert_eq!(
            error,
            "Codex CLI login status is unavailable. Run `codex login`, confirm `codex login status`, then reconnect Codex."
        );
    }

    #[test]
    fn validation_reports_missing_or_expired_chatgpt_session() {
        let error = validate_codex_status(status(true, true, Some("chatgpt"), false)).unwrap_err();

        assert_eq!(
            error,
            "Codex CLI session is missing or expired. Run `codex login`, then reconnect Codex."
        );
    }

    #[test]
    fn validation_accepts_chatgpt_session() {
        let account = validate_codex_status(status(true, true, Some("chatgpt"), true)).unwrap();

        assert_eq!(account, "Codex ChatGPT Session");
    }

    #[test]
    fn codex_exec_args_do_not_include_prompt_text() {
        let schema_path = PathBuf::from("schema.json");
        let output_path = PathBuf::from("output.json");
        let args = codex_exec_args(
            "C:\\workspace\\gtum",
            None,
            None,
            &[],
            &schema_path,
            &output_path,
        )
        .into_iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect::<Vec<_>>();

        assert_eq!(
            args,
            vec![
                "exec",
                "--sandbox",
                "read-only",
                "--skip-git-repo-check",
                "--output-schema",
                "schema.json",
                "-o",
                "output.json",
                "-C",
                "C:\\workspace\\gtum"
            ]
        );
        assert!(!args.iter().any(|arg| arg.contains("You are Codex")));
    }

    #[test]
    fn codex_exec_args_include_selected_model_when_present() {
        let schema_path = PathBuf::from("schema.json");
        let output_path = PathBuf::from("output.json");
        let args = codex_exec_args(
            "/workspace/gtum",
            Some(" gpt-5.5 "),
            None,
            &[],
            &schema_path,
            &output_path,
        )
        .into_iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect::<Vec<_>>();

        assert!(args.windows(2).any(|entry| entry == ["--model", "gpt-5.5"]));
    }

    #[test]
    fn codex_exec_args_include_selected_reasoning_effort_when_present() {
        let schema_path = PathBuf::from("schema.json");
        let output_path = PathBuf::from("output.json");
        let args = codex_exec_args(
            "/workspace/gtum",
            None,
            Some(" xhigh "),
            &[],
            &schema_path,
            &output_path,
        )
        .into_iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect::<Vec<_>>();

        assert!(args
            .windows(2)
            .any(|entry| entry == ["-c", "model_reasoning_effort=\"xhigh\""]));
    }

    #[test]
    fn codex_exec_args_include_image_attachments_when_present() {
        let schema_path = PathBuf::from("schema.json");
        let output_path = PathBuf::from("output.json");
        let attachments = vec![RequestAgentAttachment {
            kind: AgentAttachmentKind::Image,
            path: " /tmp/screenshot.png ".into(),
        }];
        let args = codex_exec_args(
            "/workspace/gtum",
            None,
            None,
            &attachments,
            &schema_path,
            &output_path,
        )
        .into_iter()
        .map(|arg| arg.to_string_lossy().into_owned())
        .collect::<Vec<_>>();

        assert!(args
            .windows(2)
            .any(|entry| entry == ["--image", "/tmp/screenshot.png"]));
    }

    #[test]
    fn prompt_keeps_terminal_permission_tests_reply_only() {
        let prompt = build_prompt(&RequestAgentSuggestionsRequest {
            provider: AgentProvider::Codex,
            agent_session_id: "agent-session-1".into(),
            model: None,
            reasoning_level: Some("xhigh".into()),
            fast_mode: Some(true),
            attachments: vec![],
            project_name: "gtum".into(),
            project_path: "/workspace/gtum".into(),
            active_tab_id: None,
            active_tab_title: None,
            active_file_path: None,
            active_file_line: None,
            active_file_snippet: None,
            last_n_log_lines: vec![],
            user_task: "나에게 터미널 권한 요청 보내봐".into(),
        });

        assert!(
            prompt.contains("The `command` field is only a gtum UI permission-card preview"),
            "{prompt}"
        );
        assert!(
            prompt.contains("Do not request permission from Codex CLI"),
            "{prompt}"
        );
        assert!(prompt.contains("approval_policy=never"), "{prompt}");
        assert!(
            prompt.contains(
                "Permission-test requests for Terminal, iTerm, or app access must stay reply-only"
            ),
            "{prompt}"
        );
        assert!(
            prompt.contains("1. Allow the request in the Agent panel"),
            "{prompt}"
        );

        #[cfg(target_os = "windows")]
        {
            assert!(prompt.contains("without cmd.exe or PowerShell"), "{prompt}");
            assert!(prompt.contains("Never return cmd.exe"), "{prompt}");
            assert!(prompt.contains("whoami"), "{prompt}");
            assert!(
                !prompt.contains("echo \"gtum permission request test\""),
                "{prompt}"
            );
        }

        #[cfg(not(target_os = "windows"))]
        {
            assert!(
                prompt.contains("echo \"gtum permission request test\""),
                "{prompt}"
            );
        }
        assert!(prompt.contains("Reasoning level: xhigh"), "{prompt}");
        assert!(prompt.contains("Fast mode: enabled"), "{prompt}");
        assert!(
            prompt.contains("Origin Agent session id: agent-session-1"),
            "{prompt}"
        );
    }

    #[test]
    fn suggestion_request_requires_an_explicit_agent_session_owner() {
        let missing_owner = serde_json::json!({
            "provider": "codex",
            "projectName": "gtum",
            "projectPath": "/workspace/gtum",
            "userTask": "Review the project"
        });
        assert!(
            serde_json::from_value::<RequestAgentSuggestionsRequest>(missing_owner).is_err(),
            "agentSessionId must not be silently ignored or defaulted"
        );

        let owned = serde_json::json!({
            "provider": "codex",
            "agentSessionId": "agent-session-owned",
            "projectName": "gtum",
            "projectPath": "/workspace/gtum",
            "userTask": "Review the project"
        });
        let request = serde_json::from_value::<RequestAgentSuggestionsRequest>(owned).unwrap();
        assert_eq!(request.agent_session_id, "agent-session-owned");
    }

    #[test]
    fn prompt_routes_event_card_choice_requests_to_reply_only_choices() {
        let prompt = build_prompt(&RequestAgentSuggestionsRequest {
            provider: AgentProvider::Codex,
            agent_session_id: "agent-session-2".into(),
            model: None,
            reasoning_level: None,
            fast_mode: None,
            attachments: vec![],
            project_name: "gtum".into(),
            project_path: "/workspace/gtum".into(),
            active_tab_id: None,
            active_tab_title: None,
            active_file_path: None,
            active_file_line: None,
            active_file_snippet: None,
            last_n_log_lines: vec![],
            user_task: "이벤트 카드로 1,2,3 선택지를 보여줘".into(),
        });

        assert!(
            prompt.contains("event card, choice card, options, or numbered choices"),
            "{prompt}"
        );
        assert!(prompt.contains("leave `command` empty"), "{prompt}");
        assert!(prompt.contains("1. Option 1"), "{prompt}");
    }

    #[test]
    fn schema_describes_command_as_gtum_permission_card_preview() {
        let schema_path = temp_file_path("gtum-codex-schema-contract-test", "json");

        write_schema_file(&schema_path).unwrap();

        let schema = fs::read_to_string(&schema_path).unwrap();
        let _ = fs::remove_file(&schema_path);
        let parsed: serde_json::Value = serde_json::from_str(&schema).unwrap();
        let description = parsed
            .get("properties")
            .and_then(|properties| properties.get("command"))
            .and_then(|command| command.get("description"))
            .and_then(|description| description.as_str())
            .unwrap_or_default();

        assert!(
            description.contains("gtum UI permission-card preview"),
            "{description}"
        );
        assert!(
            description.contains("not executed by Codex CLI"),
            "{description}"
        );
    }

    #[test]
    fn codex_model_catalog_parses_list_visible_models() {
        let models = parse_codex_model_catalog(
            r#"{
                "models": [
                    {
                        "slug": "gpt-5.5",
                        "display_name": "GPT-5.5",
                        "visibility": "list"
                    },
                    {
                        "slug": "internal-model",
                        "display_name": "Internal",
                        "visibility": "hidden"
                    }
                ]
            }"#,
        )
        .unwrap();

        assert_eq!(models.len(), 1);
        assert_eq!(models[0].provider_id, AgentProvider::Codex);
        assert_eq!(models[0].model_id, "gpt-5.5");
        assert_eq!(models[0].label, "GPT-5.5");
    }

    #[test]
    fn codex_model_catalog_parses_reasoning_and_fast_capabilities() {
        let entries = parse_codex_model_catalog_entries(
            r#"{
                "models": [
                    {
                        "slug": "gpt-5.5",
                        "display_name": "GPT-5.5",
                        "default_reasoning_level": "medium",
                        "supported_reasoning_levels": [
                            {
                                "effort": "low",
                                "description": "Fast responses with lighter reasoning"
                            },
                            {
                                "effort": "medium",
                                "description": "Balances speed and reasoning depth"
                            },
                            {
                                "effort": "high",
                                "description": "Greater reasoning depth"
                            },
                            {
                                "effort": "xhigh",
                                "description": "Extra high reasoning depth"
                            }
                        ],
                        "additional_speed_tiers": ["fast"],
                        "service_tiers": [
                            {
                                "id": "priority",
                                "name": "Fast"
                            }
                        ],
                        "visibility": "list"
                    }
                ]
            }"#,
        )
        .unwrap();
        let reasoning_levels = codex_reasoning_levels_for_model(&entries, Some("gpt-5.5"));
        let default_reasoning_level = codex_default_reasoning_level_for_model(
            &entries,
            Some("gpt-5.5"),
            Some("xhigh"),
            &reasoning_levels,
        );

        assert_eq!(
            reasoning_levels
                .iter()
                .map(|level| level.level.as_str())
                .collect::<Vec<_>>(),
            vec!["low", "medium", "high", "xhigh"]
        );
        assert_eq!(reasoning_levels[3].label, "XHigh");
        assert_eq!(default_reasoning_level.as_deref(), Some("xhigh"));
        assert!(codex_model_supports_fast_mode(&entries, Some("gpt-5.5")));
    }

    #[test]
    fn windows_codex_node_entrypoint_uses_node_script_next_to_cmd() {
        let root = temp_file_path("gtum-codex-entrypoint-test", "dir");
        let script_path = root
            .join("node_modules")
            .join("@openai")
            .join("codex")
            .join("bin")
            .join("codex.js");
        fs::create_dir_all(script_path.parent().unwrap()).unwrap();
        fs::write(root.join("codex.cmd"), "@echo off").unwrap();
        fs::write(root.join("node.exe"), "").unwrap();
        fs::write(&script_path, "").unwrap();

        let (program, script) =
            windows_codex_node_entrypoint_from_cmd_path(&root.join("codex.cmd")).unwrap();

        assert_eq!(PathBuf::from(program), root.join("node.exe"));
        assert_eq!(script, script_path);

        let _ = fs::remove_dir_all(root);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn codex_account_context_windows_cmd_uses_node_for_status_and_exec() {
        let root = temp_file_path("gtum-codex-windows-node-context", "dir");
        let script_path = root
            .join("node_modules")
            .join("@openai")
            .join("codex")
            .join("bin")
            .join("codex.js");
        fs::create_dir_all(script_path.parent().unwrap()).unwrap();
        fs::write(root.join("codex.cmd"), "@echo off").unwrap();
        fs::write(root.join("node.exe"), "").unwrap();
        fs::write(&script_path, "").unwrap();

        for original_args in [
            vec![OsString::from("login"), OsString::from("status")],
            vec![OsString::from("exec"), OsString::from("--help")],
        ] {
            let (program, args) =
                codex_invocation_for_program(&root.join("codex.cmd"), original_args.clone());
            assert_eq!(PathBuf::from(program), root.join("node.exe"));
            assert_eq!(PathBuf::from(&args[0]), script_path);
            assert_eq!(&args[1..], original_args);
        }

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn codex_command_candidates_include_app_bundle_when_path_is_limited() {
        let root = temp_file_path("gtum-codex-app-path-test", "dir");
        let bundled_codex = root
            .join("Codex.app")
            .join("Contents")
            .join("Resources")
            .join("codex");
        fs::create_dir_all(bundled_codex.parent().unwrap()).unwrap();
        fs::write(&bundled_codex, "").unwrap();

        let candidates = codex_command_candidates_from(
            Some(OsString::from("/usr/bin:/bin:/usr/sbin:/sbin")),
            vec![bundled_codex.clone()],
        );

        assert_eq!(candidates, vec![bundled_codex.into_os_string()]);

        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn command_runner_times_out_hanging_child_processes() {
        let started_at = std::time::Instant::now();
        let error = run_command_with_input_and_timeout(
            "sh".into(),
            vec!["-c".into(), "sleep 5".into()],
            "",
            std::time::Duration::from_millis(50),
        )
        .unwrap_err();

        assert!(
            started_at.elapsed() < std::time::Duration::from_secs(2),
            "hanging child process should be killed promptly"
        );
        assert!(error.contains("timed out"), "{error}");
    }

    #[cfg(unix)]
    #[test]
    fn codex_account_context_child_output_is_capped_before_deadline() {
        let started_at = Instant::now();
        let error = run_command_with_input_and_timeout(
            "sh".into(),
            vec![
                "-c".into(),
                "dd if=/dev/zero bs=65536 count=32 2>/dev/null".into(),
            ],
            "",
            Duration::from_secs(2),
        )
        .unwrap_err();

        assert!(error.contains("output exceeded the safe limit"), "{error}");
        assert!(
            started_at.elapsed() < Duration::from_secs(1),
            "output overflow must terminate the child before its deadline"
        );
    }

    #[cfg(unix)]
    #[test]
    fn codex_account_context_child_completion_does_not_wait_on_descendant_pipes() {
        let started_at = Instant::now();
        let output = run_command_with_input_and_timeout(
            "sh".into(),
            vec!["-c".into(), "(sleep 2) & exit 0".into()],
            "",
            Duration::from_millis(100),
        )
        .unwrap();

        assert!(output.status.success());
        assert!(
            started_at.elapsed() < Duration::from_millis(400),
            "the owned child completion must terminate descendants before joining pipes"
        );
    }

    #[cfg(unix)]
    #[test]
    fn codex_account_context_child_timeout_terminates_descendant_tree() {
        let root = temp_file_path("gtum-codex-descendant-tree", "dir");
        fs::create_dir(&root).unwrap();
        let escaped_marker = root.join("escaped-marker");
        let script = format!(
            "(sleep 0.3; touch '{}') & sleep 5",
            escaped_marker.to_string_lossy()
        );

        let error = run_command_with_input_and_timeout(
            "sh".into(),
            vec!["-c".into(), script.into()],
            "",
            Duration::from_millis(50),
        )
        .unwrap_err();
        thread::sleep(Duration::from_millis(450));

        assert!(error.contains("timed out"), "{error}");
        assert!(
            !escaped_marker.exists(),
            "a timed-out Codex descendant escaped containment"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn validated_attempt_runs_validation_once_and_skips_exec_on_failure() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let validations = AtomicUsize::new(0);
        let executions = AtomicUsize::new(0);
        let (validation, result) = run_after_connection_validation(
            || {
                validations.fetch_add(1, Ordering::Relaxed);
                Err("expired".to_string())
            },
            || {
                executions.fetch_add(1, Ordering::Relaxed);
                Ok::<_, String>(())
            },
        );

        assert_eq!(validations.load(Ordering::Relaxed), 1);
        assert_eq!(executions.load(Ordering::Relaxed), 0);
        assert_eq!(validation, Err("expired".to_string()));
        assert!(result.is_none());
    }

    #[test]
    fn validated_attempt_runs_exec_once_without_masking_exec_error() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        let validations = AtomicUsize::new(0);
        let executions = AtomicUsize::new(0);
        let (validation, result) = run_after_connection_validation(
            || {
                validations.fetch_add(1, Ordering::Relaxed);
                Ok("Codex Account".to_string())
            },
            || {
                executions.fetch_add(1, Ordering::Relaxed);
                Err::<(), _>("exec failed".to_string())
            },
        );

        assert_eq!(validations.load(Ordering::Relaxed), 1);
        assert_eq!(executions.load(Ordering::Relaxed), 1);
        assert_eq!(validation, Ok("Codex Account".to_string()));
        assert_eq!(result, Some(Err("exec failed".to_string())));
    }

    #[test]
    fn parser_reports_unstructured_codex_output() {
        let error = match response_from_codex_output("not json", AgentProvider::Codex) {
            Ok(_) => panic!("expected unstructured output to fail"),
            Err(error) => error,
        };

        assert!(error.starts_with("failed to parse Codex CLI structured response:"));
    }

    #[test]
    fn normalization_allows_reply_without_command() {
        let response = normalize_codex_suggestion(
            CodexStructuredSuggestion {
                summary: " I reviewed the current context. No command is needed. ".into(),
                command: " ".into(),
                preferred_target: AgentExecutionTarget::NewTab,
                confidence: AgentSuggestionConfidence::High,
                error: None,
            },
            AgentProvider::Codex,
        )
        .unwrap();

        assert_eq!(
            response.summary,
            "I reviewed the current context. No command is needed."
        );
        assert!(response.command.is_empty());
        assert_eq!(response.error, None);
    }

    #[test]
    fn normalization_rejects_empty_response_without_error() {
        let error = match normalize_codex_suggestion(
            CodexStructuredSuggestion {
                summary: " ".into(),
                command: " ".into(),
                preferred_target: AgentExecutionTarget::NewTab,
                confidence: AgentSuggestionConfidence::Low,
                error: None,
            },
            AgentProvider::Codex,
        ) {
            Ok(_) => panic!("expected empty response without error to fail"),
            Err(error) => error,
        };

        assert_eq!(
            error,
            "Codex CLI returned an empty response without a command or error reason."
        );
    }

    #[test]
    fn normalization_allows_error_only_suggestion() {
        let response = normalize_codex_suggestion(
            CodexStructuredSuggestion {
                summary: " ".into(),
                command: " ".into(),
                preferred_target: AgentExecutionTarget::NewTab,
                confidence: AgentSuggestionConfidence::Low,
                error: Some(" No safe command is available. ".into()),
            },
            AgentProvider::Codex,
        )
        .unwrap();

        assert_eq!(response.summary, "Codex could not complete the request.");
        assert!(response.command.is_empty());
        assert_eq!(
            response.error.as_deref(),
            Some("No safe command is available.")
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn normalization_converts_windows_shell_commands_to_error_only_suggestions() {
        let response = normalize_codex_suggestion(
            CodexStructuredSuggestion {
                summary: "Send a permission request".into(),
                command: "powershell.exe -NoProfile -Command Write-Output hi".into(),
                preferred_target: AgentExecutionTarget::NewTab,
                confidence: AgentSuggestionConfidence::High,
                error: None,
            },
            AgentProvider::Codex,
        )
        .unwrap();

        assert!(response.command.is_empty());
        assert_eq!(response.summary, "Send a permission request");
        assert!(response
            .error
            .as_deref()
            .unwrap_or_default()
            .contains("would launch powershell.exe"));
    }

    #[test]
    fn normalization_trims_command_suggestions() {
        let response = normalize_codex_suggestion(
            CodexStructuredSuggestion {
                summary: " Run focused tests ".into(),
                command: " cargo test ".into(),
                preferred_target: AgentExecutionTarget::CurrentTab,
                confidence: AgentSuggestionConfidence::High,
                error: None,
            },
            AgentProvider::Codex,
        )
        .unwrap();

        assert_eq!(response.summary, "Run focused tests");
        assert_eq!(response.command, "cargo test");
        assert_eq!(response.preferred_target, AgentExecutionTarget::CurrentTab);
    }
}
