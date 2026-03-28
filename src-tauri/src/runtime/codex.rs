use std::{
    env, fs,
    path::PathBuf,
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::runtime::{
    auth::AgentProvider,
    workspace::ExecutionMode,
};

const CODEX_AUTH_PATH_LABEL: &str = "~/.codex/auth.json";
const CODEX_CONNECTION_PATH: &str = "Codex CLI ChatGPT session";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestAgentSuggestionsRequest {
    pub provider: AgentProvider,
    pub project_name: String,
    pub project_path: String,
    pub active_tab_id: Option<String>,
    pub active_tab_title: Option<String>,
    pub active_file_path: Option<String>,
    pub active_file_snippet: Option<String>,
    #[serde(default)]
    pub last_n_log_lines: Vec<String>,
    pub user_task: String,
    pub execution_mode: ExecutionMode,
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
    let status = read_codex_cli_status();
    let requirements = vec![
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
    ];

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
            "Codex CLI session is not ready for the ChatGPT-based daily-use path yet.".into(),
            "Refresh the local Codex login with `codex login`, then reconnect Codex.".into(),
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
    let status = read_codex_cli_status();

    if !status.binary_available {
        return Err("Codex CLI is not installed. Install it and run `codex login` before connecting Codex.".into());
    }

    if matches!(status.auth_mode.as_deref(), Some("api_key")) {
        return Err(
            "Codex CLI is logged in with an API key. Re-run `codex login` with ChatGPT session mode before connecting gtum."
                .into(),
        );
    }

    if !status.auth_file_exists || !status.has_chatgpt_session {
        return Err(
            "Codex CLI is not logged in with ChatGPT for this desktop user. Run `codex login`, finish the browser sign-in, then connect again."
                .into(),
        );
    }

    Ok(status.account_label())
}

pub fn request_codex_suggestions(
    request: RequestAgentSuggestionsRequest,
) -> Result<Vec<AgentSuggestionResponse>, String> {
    let _ = validate_codex_connection()?;

    let output_path = temp_file_path("gtum-codex-output", "json");
    let schema_path = temp_file_path("gtum-codex-schema", "json");
    let prompt = build_prompt(&request);

    write_schema_file(&schema_path)?;

    let output = Command::new(codex_command_name())
        .arg("exec")
        .arg("--sandbox")
        .arg("read-only")
        .arg("--skip-git-repo-check")
        .arg("--output-schema")
        .arg(&schema_path)
        .arg("-o")
        .arg(&output_path)
        .arg("-C")
        .arg(&request.project_path)
        .arg(&prompt)
        .output()
        .map_err(|error| format!("failed to launch Codex CLI: {error}"))?;

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

    let raw_output = fs::read_to_string(&output_path)
        .map_err(|error| format!("failed to read Codex CLI output: {error}"))?;
    let structured = serde_json::from_str::<CodexStructuredSuggestion>(&raw_output)
        .map_err(|error| format!("failed to parse Codex CLI structured response: {error}"))?;

    let _ = cleanup_temp_files(&schema_path, &output_path);

    let normalized_error = structured
        .error
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let normalized_command = structured.command.trim().to_string();

    if normalized_error.is_none() && normalized_command.is_empty() {
        return Err("Codex CLI returned an empty command without an error reason.".into());
    }

    Ok(vec![AgentSuggestionResponse {
        id: format!("codex-{}", unix_timestamp_ms()),
        provider: request.provider,
        summary: structured.summary.trim().to_string(),
        command: normalized_command,
        preferred_target: structured.preferred_target,
        confidence: structured.confidence,
        error: normalized_error,
    }])
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
        let _has_identity = token_present(tokens.account_id.as_deref()) || token_present(tokens.id_token.as_deref());
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
    Command::new(codex_command_name())
        .arg("--version")
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn codex_login_status_reports_chatgpt() -> bool {
    Command::new(codex_command_name())
        .arg("login")
        .arg("status")
        .output()
        .map(|output| {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let stderr = String::from_utf8_lossy(&output.stderr);
            output.status.success()
                && (stdout.contains("Logged in using ChatGPT") || stderr.contains("Logged in using ChatGPT"))
        })
        .unwrap_or(false)
}

fn read_auth_file(path: &PathBuf) -> CodexAuthFile {
    fs::read_to_string(path)
        .ok()
        .and_then(|contents| serde_json::from_str::<CodexAuthFile>(&contents).ok())
        .unwrap_or_default()
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

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("USERPROFILE").map(PathBuf::from))
        .or_else(|| {
            match (env::var_os("HOMEDRIVE"), env::var_os("HOMEPATH")) {
                (Some(drive), Some(path)) => {
                    let mut value = PathBuf::from(drive);
                    value.push(path);
                    Some(value)
                }
                _ => None,
            }
        })
}

fn codex_command_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "codex.cmd"
    } else {
        "codex"
    }
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
                "description": "One concise summary for the suggestion card."
            },
            "command": {
                "type": "string",
                "description": "Exactly one terminal command to run next."
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
                "description": "Explain why no safe command is available. Use null when a command is present."
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

fn build_prompt(request: &RequestAgentSuggestionsRequest) -> String {
    let file_path = request
        .active_file_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("none");
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

    format!(
        "You are Codex inside gtum, a desktop workspace for terminal-heavy development.\nRead the project metadata, the active file snippet, and recent terminal logs.\nReturn exactly one safe next shell command.\nPrefer non-destructive commands that help the developer move forward immediately.\nIf you cannot recommend a safe command, set `error` and leave `command` empty.\n\nProject name: {}\nProject path: {}\nActive file path: {}\nActive file snippet (truncated):\n{}\n\nActive tab id: {}\nActive tab title: {}\nExecution mode: {}\nUser task: {}\nRecent terminal logs (most recent last, max 50 lines):\n{}\n\nReturn one next command that best helps the developer continue from the current state.",
        request.project_name.trim(),
        request.project_path.trim(),
        file_path,
        file_snippet,
        request.active_tab_id.as_deref().unwrap_or("none"),
        request.active_tab_title.as_deref().unwrap_or("none"),
        execution_mode_label(request.execution_mode),
        request.user_task.trim(),
        log_lines,
    )
}

fn execution_mode_label(mode: ExecutionMode) -> &'static str {
    match mode {
        ExecutionMode::Fast => "fast",
        ExecutionMode::Balanced => "balanced",
        ExecutionMode::Deep => "deep",
    }
}

fn unix_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}
