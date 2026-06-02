use std::{
    env,
    ffi::OsString,
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Output, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::runtime::{auth::AgentProvider, workspace::ExecutionMode};

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
    pub active_file_line: Option<usize>,
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
    diagnostics_from_status(read_codex_cli_status())
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
    request: RequestAgentSuggestionsRequest,
) -> Result<Vec<AgentSuggestionResponse>, String> {
    let _ = validate_codex_connection()?;

    let output_path = temp_file_path("gtum-codex-output", "json");
    let schema_path = temp_file_path("gtum-codex-schema", "json");
    let prompt = build_prompt(&request);

    write_schema_file(&schema_path)?;

    let output = match run_codex_exec(&request.project_path, &schema_path, &output_path, &prompt) {
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
                && (stdout.contains("Logged in using ChatGPT")
                    || stderr.contains("Logged in using ChatGPT"))
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
    schema_path: &PathBuf,
    output_path: &PathBuf,
) -> Vec<OsString> {
    vec![
        "exec".into(),
        "--sandbox".into(),
        "read-only".into(),
        "--skip-git-repo-check".into(),
        "--output-schema".into(),
        schema_path.as_os_str().to_os_string(),
        "-o".into(),
        output_path.as_os_str().to_os_string(),
        "-C".into(),
        project_path.into(),
    ]
}

fn codex_exec_invocation(
    project_path: &str,
    schema_path: &PathBuf,
    output_path: &PathBuf,
) -> (OsString, Vec<OsString>) {
    let args = codex_exec_args(project_path, schema_path, output_path);

    if cfg!(target_os = "windows") {
        if let Some((node_program, script_path)) = windows_codex_node_entrypoint() {
            let mut node_args = vec![script_path.into_os_string()];
            node_args.extend(args);
            return (node_program, node_args);
        }
    }

    (codex_command_name().into(), args)
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
    env::var_os("PATH").and_then(|path| {
        env::split_paths(&path)
            .map(|entry| entry.join(name))
            .find(|candidate| candidate.is_file())
    })
}

fn run_codex_exec(
    project_path: &str,
    schema_path: &PathBuf,
    output_path: &PathBuf,
    prompt: &str,
) -> Result<Output, String> {
    let (program, args) = codex_exec_invocation(project_path, schema_path, output_path);
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("failed to launch Codex CLI: {error}"))?;

    match child.stdin.take() {
        Some(mut stdin) => {
            if let Err(error) = stdin.write_all(prompt.as_bytes()) {
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

    child
        .wait_with_output()
        .map_err(|error| format!("failed to wait for Codex CLI: {error}"))
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

    if normalized_error.is_none() && normalized_command.is_empty() {
        return Err("Codex CLI returned an empty command without an error reason.".into());
    }

    let fallback_summary = if normalized_error.is_some() && normalized_command.is_empty() {
        "Codex could not suggest a command."
    } else {
        "Codex suggestion"
    };
    let normalized_summary = structured.summary.trim();

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

    format!(
        "You are Codex inside gtum, a desktop workspace for terminal-heavy development.\nRead the project metadata, the active file snippet, and recent terminal logs.\nReturn exactly one safe next shell command.\nPrefer non-destructive commands that help the developer move forward immediately.\nIf you cannot recommend a safe command, set `error` and leave `command` empty.\n\nProject name: {}\nProject path: {}\nActive file path: {}\nActive file line: {}\nActive file snippet (truncated):\n{}\n\nActive tab id: {}\nActive tab title: {}\nExecution mode: {}\nUser task: {}\nRecent terminal logs (most recent last, max 50 lines):\n{}\n\nReturn one next command that best helps the developer continue from the current state.",
        request.project_name.trim(),
        request.project_path.trim(),
        file_path,
        file_line,
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
        let args = codex_exec_args("C:\\workspace\\gtum", &schema_path, &output_path)
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
    fn parser_reports_unstructured_codex_output() {
        let error = match response_from_codex_output("not json", AgentProvider::Codex) {
            Ok(_) => panic!("expected unstructured output to fail"),
            Err(error) => error,
        };

        assert!(error.starts_with("failed to parse Codex CLI structured response:"));
    }

    #[test]
    fn normalization_rejects_empty_command_without_error() {
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
            Ok(_) => panic!("expected empty command without error to fail"),
            Err(error) => error,
        };

        assert_eq!(
            error,
            "Codex CLI returned an empty command without an error reason."
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

        assert_eq!(response.summary, "Codex could not suggest a command.");
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
