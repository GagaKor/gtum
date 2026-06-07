use std::{
    env,
    ffi::{OsStr, OsString},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    thread,
    thread::JoinHandle,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::runtime::auth::AgentProvider;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

const CODEX_AUTH_PATH_LABEL: &str = "~/.codex/auth.json";
const CODEX_CONNECTION_PATH: &str = "Codex CLI ChatGPT session";
const CODEX_EXEC_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestAgentSuggestionsRequest {
    pub provider: AgentProvider,
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

#[derive(Default, Deserialize)]
struct CodexAuthFile {
    auth_mode: Option<String>,
    tokens: Option<CodexAuthTokens>,
}

#[derive(Default, Deserialize)]
struct CodexAuthTokens {
    access_token: Option<String>,
    refresh_token: Option<String>,
    account_id: Option<String>,
    id_token: Option<String>,
}

struct CodexCliStatus {
    binary_available: bool,
    auth_file_exists: bool,
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
    diagnostics_from_status(read_codex_cli_status())
}

pub fn read_codex_capabilities() -> AgentProviderCapabilities {
    let binary_available = codex_command_available();
    let catalog_entries = if binary_available {
        read_codex_model_catalog_entries().unwrap_or_default()
    } else {
        Vec::new()
    };
    let available_models = model_capabilities_from_codex_entries(&catalog_entries);
    let current_model_id = read_codex_config_model();
    let current_model = current_model_id
        .as_deref()
        .and_then(|model_id| model_capability_for_id(AgentProvider::Codex, &available_models, model_id));
    let effective_model_id = current_model
        .as_ref()
        .map(|model| model.model_id.as_str())
        .or(current_model_id.as_deref())
        .or_else(|| available_models.first().map(|model| model.model_id.as_str()));
    let reasoning_levels = codex_reasoning_levels_for_model(&catalog_entries, effective_model_id);
    let default_reasoning_level = codex_default_reasoning_level_for_model(
        &catalog_entries,
        effective_model_id,
        read_codex_config_reasoning_effort().as_deref(),
        &reasoning_levels,
    );
    let supports_fast_mode = codex_model_supports_fast_mode(&catalog_entries, effective_model_id);

    AgentProviderCapabilities {
        provider: AgentProvider::Codex,
        supports_model_selection: binary_available,
        current_model,
        available_models,
        reasoning_levels,
        default_reasoning_level,
        supports_fast_mode,
        attachments: vec![AgentAttachmentCapability {
            kind: AgentAttachmentKind::Image,
            label: "Image".into(),
            enabled: binary_available,
            invocation_flag: Some("--image".into()),
        }],
    }
}

pub fn read_claude_capabilities() -> AgentProviderCapabilities {
    let available_models = read_claude_available_models();
    let current_model_id = env::var("ANTHROPIC_MODEL")
        .ok()
        .and_then(|value| non_empty_trimmed(value.as_str()))
        .or_else(read_claude_config_model);
    let current_model = current_model_id
        .as_deref()
        .and_then(|model_id| model_capability_for_id(AgentProvider::Claude, &available_models, model_id))
        .or_else(|| {
            current_model_id.map(|model_id| AgentModelCapability {
                provider_id: AgentProvider::Claude,
                label: model_id.clone(),
                model_id,
            })
        });

    AgentProviderCapabilities {
        provider: AgentProvider::Claude,
        supports_model_selection: claude_command_available(),
        current_model,
        available_models,
        reasoning_levels: Vec::new(),
        default_reasoning_level: None,
        supports_fast_mode: false,
        attachments: vec![
            AgentAttachmentCapability {
                kind: AgentAttachmentKind::File,
                label: "File".into(),
                enabled: claude_command_available(),
                invocation_flag: Some("--file".into()),
            },
            AgentAttachmentCapability {
                kind: AgentAttachmentKind::Directory,
                label: "Directory".into(),
                enabled: claude_command_available(),
                invocation_flag: Some("--add-dir".into()),
            },
        ],
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
    } else if !status.auth_file_exists {
        (
            AgentProviderSetupState::NeedsSetup,
            "Codex CLI is installed, but no local session file was found for the current desktop user.".into(),
            "Run `codex login` and complete the browser sign-in flow, then reconnect Codex.".into(),
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

fn requirements_from_status(status: &CodexCliStatus) -> Vec<AgentProviderRequirementStatus> {
    vec![
        AgentProviderRequirementStatus {
            name: "codex CLI".into(),
            required: true,
            present: status.binary_available,
        },
        AgentProviderRequirementStatus {
            name: CODEX_AUTH_PATH_LABEL.into(),
            required: true,
            present: status.auth_file_exists,
        },
        AgentProviderRequirementStatus {
            name: "ChatGPT session".into(),
            required: true,
            present: status.has_chatgpt_session,
        },
    ]
}

pub fn deferred_provider_diagnostics(provider: AgentProvider) -> AgentProviderDiagnostics {
    AgentProviderDiagnostics {
        provider,
        setup_state: AgentProviderSetupState::Deferred,
        connection_path: "Deferred real-provider path".into(),
        summary: format!(
            "{} is not part of the first daily-use release yet.",
            provider.display_name()
        ),
        guidance: format!(
            "Keep {} on the prototype path while the real daily-use release focuses on Codex.",
            provider.display_name()
        ),
        base_url: None,
        model: None,
        requirements: vec![AgentProviderRequirementStatus {
            name: "provider:deferred".into(),
            required: false,
            present: false,
        }],
    }
}

pub fn validate_codex_connection() -> Result<String, String> {
    validate_codex_status(read_codex_cli_status())
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

    if !status.auth_file_exists {
        return Err(
            "Codex CLI is installed, but no local session file was found. Run `codex login`, finish sign-in, then reconnect Codex."
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

pub fn request_codex_suggestions(
    mut request: RequestAgentSuggestionsRequest,
) -> Result<Vec<AgentSuggestionResponse>, String> {
    let _ = validate_codex_connection()?;
    sanitize_codex_request_options(&mut request);

    let output_path = temp_file_path("gtum-codex-output", "json");
    let schema_path = temp_file_path("gtum-codex-schema", "json");
    let prompt = build_prompt(&request);

    write_schema_file(&schema_path)?;

    let output = match run_codex_exec(
        &request.project_path,
        request.model.as_deref(),
        request.reasoning_level.as_deref(),
        &request.attachments,
        &schema_path,
        &output_path,
        &prompt,
    ) {
        Ok(output) => output,
        Err(error) => {
            let _ = cleanup_temp_files(&schema_path, &output_path);
            return Err(error);
        }
    };

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

    if !output.status.success() {
        let message = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            format!("Codex CLI exited with status {}.", output.status)
        };
        let _ = cleanup_temp_files(&schema_path, &output_path);
        return Err(message);
    }

    let raw_output = match fs::read_to_string(&output_path) {
        Ok(contents) => contents,
        Err(error) => {
            let _ = cleanup_temp_files(&schema_path, &output_path);
            return Err(format!("failed to read Codex CLI output: {error}"));
        }
    };
    let response = response_from_codex_output(&raw_output, request.provider);

    let _ = cleanup_temp_files(&schema_path, &output_path);

    Ok(vec![response?])
}

fn sanitize_codex_request_options(request: &mut RequestAgentSuggestionsRequest) {
    let catalog_entries = read_codex_model_catalog_entries().unwrap_or_default();
    let configured_model = read_codex_config_model();
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
}

fn read_codex_cli_status() -> CodexCliStatus {
    let binary_available = codex_command_available();
    let auth_path = codex_auth_path();
    let auth = read_auth_file(&auth_path);
    let auth_mode = auth.auth_mode.clone();
    let has_chatgpt_session = if !binary_available {
        false
    } else if matches!(auth_mode.as_deref(), Some("chatgpt")) {
        let tokens = auth.tokens.unwrap_or_default();
        let has_required_tokens = token_present(tokens.access_token.as_deref())
            && token_present(tokens.refresh_token.as_deref());
        let _has_identity = token_present(tokens.account_id.as_deref())
            || token_present(tokens.id_token.as_deref());
        has_required_tokens && codex_login_status_reports_chatgpt()
    } else {
        false
    };

    CodexCliStatus {
        binary_available,
        auth_file_exists: auth_path.exists(),
        auth_mode,
        has_chatgpt_session,
    }
}

fn codex_command_available() -> bool {
    codex_command_candidates_for_execution()
        .into_iter()
        .any(|program| {
            command_for_program(program)
                .arg("--version")
                .output()
                .map(|output| output.status.success())
                .unwrap_or(false)
        })
}

fn codex_login_status_reports_chatgpt() -> bool {
    codex_command_candidates_for_execution()
        .into_iter()
        .any(|program| {
            command_for_program(program)
                .arg("login")
                .arg("status")
                .output()
                .map(|output| {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    output.status.success()
                        && (stdout.contains("Logged in using ChatGPT")
                            || stderr.contains("Logged in using ChatGPT"))
                })
                .unwrap_or(false)
        })
}

fn read_auth_file(path: &PathBuf) -> CodexAuthFile {
    fs::read_to_string(path)
        .ok()
        .and_then(|contents| serde_json::from_str::<CodexAuthFile>(&contents).ok())
        .unwrap_or_default()
}

fn command_for_program(program: impl AsRef<OsStr>) -> Command {
    let mut command = Command::new(program);
    hide_windows_console(&mut command);
    command
}

#[cfg(target_os = "windows")]
fn hide_windows_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;

    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn hide_windows_console(_command: &mut Command) {}

fn read_codex_model_catalog_entries() -> Result<Vec<CodexModelCatalogEntry>, String> {
    let output = codex_command_candidates_for_execution()
        .into_iter()
        .find_map(|program| {
            command_for_program(program)
                .arg("debug")
                .arg("models")
                .output()
                .ok()
                .filter(|output| output.status.success())
        })
        .ok_or_else(|| "failed to read Codex model catalog".to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);

    parse_codex_model_catalog_entries(&stdout)
}

#[cfg(test)]
fn parse_codex_model_catalog(raw_output: &str) -> Result<Vec<AgentModelCapability>, String> {
    parse_codex_model_catalog_entries(raw_output)
        .map(|entries| model_capabilities_from_codex_entries(&entries))
}

fn parse_codex_model_catalog_entries(raw_output: &str) -> Result<Vec<CodexModelCatalogEntry>, String> {
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

fn token_present(value: Option<&str>) -> bool {
    value.map(|entry| !entry.trim().is_empty()).unwrap_or(false)
}

fn codex_auth_path() -> PathBuf {
    if let Ok(codex_home) = env::var("CODEX_HOME") {
        return PathBuf::from(codex_home).join("auth.json");
    }

    home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".codex")
        .join("auth.json")
}

fn codex_config_path() -> PathBuf {
    if let Ok(codex_home) = env::var("CODEX_HOME") {
        return PathBuf::from(codex_home).join("config.toml");
    }

    home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".codex")
        .join("config.toml")
}

fn read_codex_config_model() -> Option<String> {
    fs::read_to_string(codex_config_path())
        .ok()
        .and_then(|contents| parse_simple_toml_string_key(&contents, "model"))
}

fn read_codex_config_reasoning_effort() -> Option<String> {
    fs::read_to_string(codex_config_path())
        .ok()
        .and_then(|contents| parse_simple_toml_string_key(&contents, "model_reasoning_effort"))
}

fn claude_command_available() -> bool {
    command_for_program(claude_command_name())
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn claude_command_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "claude.cmd"
    } else {
        "claude"
    }
}

fn read_claude_config_model() -> Option<String> {
    read_claude_settings_values()
        .into_iter()
        .find_map(|settings| string_from_json_key(&settings, "model"))
}

fn read_claude_available_models() -> Vec<AgentModelCapability> {
    read_claude_settings_values()
        .into_iter()
        .find_map(|settings| {
            settings.get("availableModels").and_then(|models| match models {
                serde_json::Value::Array(entries) => Some(
                    entries
                        .iter()
                        .filter_map(|entry| match entry {
                            serde_json::Value::String(model_id) => non_empty_trimmed(model_id),
                            serde_json::Value::Object(model) => model
                                .get("model")
                                .or_else(|| model.get("id"))
                                .or_else(|| model.get("modelId"))
                                .and_then(|value| value.as_str())
                                .and_then(non_empty_trimmed),
                            _ => None,
                        })
                        .map(|model_id| AgentModelCapability {
                            provider_id: AgentProvider::Claude,
                            label: model_id.clone(),
                            model_id,
                        })
                        .collect::<Vec<_>>(),
                ),
                _ => None,
            })
        })
        .unwrap_or_default()
}

fn read_claude_settings_values() -> Vec<serde_json::Value> {
    claude_settings_paths()
        .into_iter()
        .filter_map(|path| fs::read_to_string(path).ok())
        .filter_map(|contents| serde_json::from_str::<serde_json::Value>(&contents).ok())
        .collect()
}

fn claude_settings_paths() -> Vec<PathBuf> {
    let home = home_dir().unwrap_or_else(|| PathBuf::from("."));
    vec![
        home.join(".claude").join("settings.local.json"),
        home.join(".claude").join("settings.json"),
    ]
}

fn string_from_json_key(value: &serde_json::Value, key: &str) -> Option<String> {
    value.get(key).and_then(|entry| entry.as_str()).and_then(non_empty_trimmed)
}

fn parse_simple_toml_string_key(contents: &str, key: &str) -> Option<String> {
    contents.lines().find_map(|line| {
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            return None;
        }
        let (name, value) = trimmed.split_once('=')?;
        if name.trim() != key {
            return None;
        }
        parse_quoted_string(value.trim()).or_else(|| non_empty_trimmed(value.trim()))
    })
}

fn parse_quoted_string(value: &str) -> Option<String> {
    let value = value.trim();
    if value.len() < 2 {
        return None;
    }
    let bytes = value.as_bytes();
    let quote = bytes[0];
    if (quote != b'"' && quote != b'\'') || bytes[value.len() - 1] != quote {
        return None;
    }

    non_empty_trimmed(&value[1..value.len() - 1])
}

fn toml_string_literal(value: &str) -> String {
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

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
    schema_path: &PathBuf,
    output_path: &PathBuf,
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
        args.push(format!(
            "model_reasoning_effort={}",
            toml_string_literal(&reasoning_level)
        ).into());
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

fn codex_exec_invocation(
    project_path: &str,
    model: Option<&str>,
    reasoning_level: Option<&str>,
    attachments: &[RequestAgentAttachment],
    schema_path: &PathBuf,
    output_path: &PathBuf,
) -> (OsString, Vec<OsString>) {
    let args = codex_exec_args(
        project_path,
        model,
        reasoning_level,
        attachments,
        schema_path,
        output_path,
    );

    if cfg!(target_os = "windows") {
        if let Some((node_program, script_path)) = windows_codex_node_entrypoint() {
            let mut node_args = vec![script_path.into_os_string()];
            node_args.extend(args);
            return (node_program, node_args);
        }
    }

    (codex_command_program(), args)
}

fn windows_codex_node_entrypoint() -> Option<(OsString, PathBuf)> {
    find_executable_in_path("codex.cmd")
        .and_then(|path| windows_codex_node_entrypoint_from_cmd_path(&path))
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

fn find_executable_in_path(name: &str) -> Option<PathBuf> {
    let path = env::var_os("PATH");
    find_executable_in_path_with_path(name, path.as_ref())
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

fn run_codex_exec(
    project_path: &str,
    model: Option<&str>,
    reasoning_level: Option<&str>,
    attachments: &[RequestAgentAttachment],
    schema_path: &PathBuf,
    output_path: &PathBuf,
    prompt: &str,
) -> Result<Output, String> {
    let (program, args) = codex_exec_invocation(
        project_path,
        model,
        reasoning_level,
        attachments,
        schema_path,
        output_path,
    );
    run_command_with_input_and_timeout(program, args, prompt, CODEX_EXEC_TIMEOUT)
}

fn run_command_with_input_and_timeout(
    program: OsString,
    args: Vec<OsString>,
    input: &str,
    timeout: Duration,
) -> Result<Output, String> {
    let mut command = command_for_program(&program);
    let mut child = command
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to launch Codex CLI: {error}"))?;

    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("failed to open Codex CLI stdout stream".into());
        }
    };
    let stderr = match child.stderr.take() {
        Some(stderr) => stderr,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("failed to open Codex CLI stderr stream".into());
        }
    };
    let stdout_reader = read_child_pipe(stdout, "stdout");
    let stderr_reader = read_child_pipe(stderr, "stderr");

    match child.stdin.take() {
        Some(mut stdin) => {
            if let Err(error) = stdin.write_all(input.as_bytes()) {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("failed to write Codex CLI prompt: {error}"));
            }
        }
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return Err("failed to open Codex CLI prompt stream".into());
        }
    }

    let deadline = Instant::now() + timeout;

    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("failed to wait for Codex CLI: {error}"))?
        {
            let stdout = join_child_pipe(stdout_reader, "stdout")?;
            let stderr = join_child_pipe(stderr_reader, "stderr")?;
            return Ok(Output {
                status,
                stdout,
                stderr,
            });
        }

        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            let _ = join_child_pipe(stdout_reader, "stdout");
            let _ = join_child_pipe(stderr_reader, "stderr");
            return Err(format!(
                "Codex CLI timed out after {} seconds. Try again with a narrower prompt or verify Codex CLI can run from this project.",
                timeout.as_secs()
            ));
        }

        thread::sleep(Duration::from_millis(50));
    }
}

fn read_child_pipe<T>(mut pipe: T, label: &'static str) -> JoinHandle<Result<Vec<u8>, String>>
where
    T: Read + Send + 'static,
{
    thread::spawn(move || {
        let mut output = Vec::new();
        pipe.read_to_end(&mut output)
            .map_err(|error| format!("failed to read Codex CLI {label}: {error}"))?;
        Ok(output)
    })
}

fn join_child_pipe(
    handle: JoinHandle<Result<Vec<u8>, String>>,
    label: &str,
) -> Result<Vec<u8>, String> {
    handle
        .join()
        .map_err(|_| format!("Codex CLI {label} reader panicked"))?
}

fn temp_file_path(prefix: &str, extension: &str) -> PathBuf {
    env::temp_dir().join(format!("{prefix}-{}.{}", unix_timestamp_ms(), extension))
}

fn write_schema_file(path: &PathBuf) -> Result<(), String> {
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
    fs::write(path, serialized)
        .map_err(|error| format!("failed to write Codex CLI output schema: {error}"))
}

fn cleanup_temp_files(schema_path: &PathBuf, output_path: &PathBuf) -> Result<(), String> {
    let _ = fs::remove_file(schema_path);
    let _ = fs::remove_file(output_path);
    Ok(())
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

    if normalized_error.is_none()
        && normalized_command.is_empty()
        && normalized_summary.is_empty()
    {
        return Err("Codex CLI returned an empty response without a command or error reason.".into());
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
        "gtum will show the command in the right Agent panel with Allow once, Always allow, and Deny actions.\n",
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

    format!(
        "{}\n\nProject name: {}\nProject path: {}\nReasoning level: {}\nFast mode: {}\nActive file path: {}\nActive file line: {}\nActive file snippet (truncated):\n{}\n\nActive tab id: {}\nActive tab title: {}\nUser task: {}\nRecent terminal logs (most recent last, max 50 lines):\n{}\n\nReturn a direct assistant response. Include a reviewable command only if the user must decide or approve an action.",
        instructions,
        request.project_name.trim(),
        request.project_path.trim(),
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

fn unix_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn status(
        binary_available: bool,
        auth_file_exists: bool,
        auth_mode: Option<&str>,
        has_chatgpt_session: bool,
    ) -> CodexCliStatus {
        CodexCliStatus {
            binary_available,
            auth_file_exists,
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
    fn validation_reports_missing_auth_file_separately() {
        let error = validate_codex_status(status(true, false, None, false)).unwrap_err();

        assert_eq!(
            error,
            "Codex CLI is installed, but no local session file was found. Run `codex login`, finish sign-in, then reconnect Codex."
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
        let args = codex_exec_args("C:\\workspace\\gtum", None, None, &[], &schema_path, &output_path)
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
        assert!(
            prompt.contains("approval_policy=never"),
            "{prompt}"
        );
        assert!(
            prompt.contains("Permission-test requests for Terminal, iTerm, or app access must stay reply-only"),
            "{prompt}"
        );
        assert!(
            prompt.contains("1. Allow the request in the Agent panel"),
            "{prompt}"
        );
        assert!(prompt.contains("Reasoning level: xhigh"), "{prompt}");
        assert!(prompt.contains("Fast mode: enabled"), "{prompt}");
    }

    #[test]
    fn prompt_routes_event_card_choice_requests_to_reply_only_choices() {
        let prompt = build_prompt(&RequestAgentSuggestionsRequest {
            provider: AgentProvider::Codex,
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
        assert!(
            prompt.contains("leave `command` empty"),
            "{prompt}"
        );
        assert!(
            prompt.contains("1. Option 1"),
            "{prompt}"
        );
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
    fn simple_toml_parser_reads_root_model_key() {
        let model = parse_simple_toml_string_key(
            r#"
                approval_policy = "never"
                model = "gpt-5.5"
            "#,
            "model",
        );

        assert_eq!(model.as_deref(), Some("gpt-5.5"));
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
