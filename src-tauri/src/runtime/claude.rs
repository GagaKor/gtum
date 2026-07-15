use std::{
    env,
    ffi::{OsStr, OsString},
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, ExitStatus, Stdio},
    sync::mpsc::{self, Receiver, TryRecvError},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::runtime::{
    auth::AgentProvider,
    codex::{
        AgentAttachmentCapability, AgentAttachmentKind, AgentExecutionTarget, AgentModelCapability,
        AgentProviderCapabilities, AgentProviderDiagnostics, AgentProviderRequirementStatus,
        AgentProviderSetupState, AgentSuggestionConfidence, AgentSuggestionResponse,
        RequestAgentSuggestionsRequest,
    },
};

const MAX_CLAUDE_STATUS_BYTES: usize = 32 * 1024;
const MAX_CLAUDE_SETTINGS_BYTES: usize = 64 * 1024;
const MAX_CLAUDE_STDERR_BYTES: usize = 16 * 1024;
const MAX_CLAUDE_REQUEST_BYTES: usize = 1024 * 1024;
const MAX_CLAUDE_PROMPT_BYTES: usize = 256 * 1024;
const MAX_CLAUDE_MODEL_CATALOG_BYTES: usize = 64 * 1024;
const MAX_CLAUDE_MODELS: usize = 32;
const MAX_CLAUDE_MODEL_ID_BYTES: usize = 128;
const MAX_CLAUDE_MODEL_LABEL_BYTES: usize = 160;
const CLAUDE_STATUS_TIMEOUT: Duration = Duration::from_secs(5);
const CLAUDE_REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const CLAUDE_MODEL_CATALOG_TIMEOUT: Duration = Duration::from_secs(5);
const CLAUDE_SCHEMA_VERSION: u64 = 1;
const CLAUDE_MODEL_CATALOG_REQUEST_ID: &str = "gtum-claude-model-catalog-v1";
const CLAUDE_MODEL_ALIASES: [(&str, &str); 5] = [
    ("default", "Claude default"),
    ("best", "Best available"),
    ("sonnet", "Sonnet"),
    ("opus", "Opus"),
    ("haiku", "Haiku"),
];

const CLAUDE_ALWAYS_REMOVED_ENVIRONMENT: &[&str] = &[
    "DEBUG",
    "CLAUDE_CODE_DEBUG_LOGS_DIR",
    "CLAUDE_CODE_DEBUG_LOG_LEVEL",
    "CLAUDE_CODE_EXTRA_BODY",
    "CLAUDE_CODE_FORCE_SESSION_PERSISTENCE",
    "CLAUDE_CODE_ENABLE_TELEMETRY",
    "CLAUDE_CODE_ENHANCED_TELEMETRY_BETA",
    "ENABLE_ENHANCED_TELEMETRY_BETA",
    "ENABLE_BETA_TRACING_DETAILED",
    "BETA_TRACING_ENDPOINT",
    "TRACEPARENT",
    "TRACESTATE",
    "CLAUDE_CODE_PROCESS_WRAPPER",
    "CLAUDE_CODE_SHELL_PREFIX",
    "CLAUDE_CODE_AUTO_CONNECT_IDE",
    "CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE",
    "CLAUDE_CODE_SYNC_PLUGIN_INSTALL",
    "CLAUDE_CODE_SYNC_PLUGIN_INSTALL_TIMEOUT_MS",
    "CLAUDE_CODE_SYNC_SKILLS",
    "CLAUDE_CODE_SYNC_SKILLS_INSTALL_TIMEOUT_MS",
    "CLAUDE_CODE_SYNC_SKILLS_WAIT_TIMEOUT_MS",
    "CLAUDE_CODE_ENABLE_BACKGROUND_PLUGIN_REFRESH",
    "CLAUDE_CODE_ENABLE_FEEDBACK_SURVEY_FOR_OTEL",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CODE_OAUTH_REFRESH_TOKEN",
    "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST",
    "CLAUDE_CONFIG_DIR",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_CUSTOM_HEADERS",
    "CLAUDE_CODE_USE_BEDROCK",
    "CLAUDE_CODE_USE_VERTEX",
    "CLAUDE_CODE_USE_FOUNDRY",
    "CLAUDE_CODE_USE_ANTHROPIC_AWS",
    "CLAUDE_CODE_USE_MANTLE",
    "ANTHROPIC_BEDROCK_BASE_URL",
    "ANTHROPIC_BEDROCK_MANTLE_BASE_URL",
    "AWS_BEARER_TOKEN_BEDROCK",
    "ANTHROPIC_AWS_API_KEY",
    "ANTHROPIC_AWS_BASE_URL",
    "ANTHROPIC_AWS_WORKSPACE_ID",
    "ANTHROPIC_VERTEX_PROJECT_ID",
    "ANTHROPIC_VERTEX_BASE_URL",
    "CLOUD_ML_REGION",
    "ANTHROPIC_FOUNDRY_RESOURCE",
    "ANTHROPIC_FOUNDRY_API_KEY",
    "ANTHROPIC_FOUNDRY_AUTH_TOKEN",
    "ANTHROPIC_FOUNDRY_BASE_URL",
    "ANTHROPIC_BASE_URL",
];
const CLAUDE_REMOVED_ENVIRONMENT_PREFIXES: &[&str] = &["CLAUDE_CODE_OTEL_", "OTEL_"];
const CLAUDE_FORCED_ENVIRONMENT: &[(&str, &str)] = &[
    ("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1"),
    ("CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL", "1"),
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ClaudeCredentialSource {
    CliSession,
    EnvironmentApiKey,
    ApiKeyHelper,
}

impl ClaudeCredentialSource {
    pub fn persistence_label(self) -> &'static str {
        match self {
            Self::CliSession => "claude_cli_session",
            Self::EnvironmentApiKey => "anthropic_api_key",
            Self::ApiKeyHelper => "api_key_helper",
        }
    }
}

#[derive(Clone, Eq, PartialEq)]
struct ClaudeCredentialSelection {
    source: ClaudeCredentialSource,
    sanitized_settings: Option<String>,
}

impl std::fmt::Debug for ClaudeCredentialSelection {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ClaudeCredentialSelection")
            .field("source", &self.source)
            .field(
                "sanitized_settings",
                &self.sanitized_settings.as_ref().map(|_| "[REDACTED]"),
            )
            .finish()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ClaudeInvocationContext {
    credential: Option<ClaudeCredentialSelection>,
    approved_custom_config_dir: Option<PathBuf>,
}

impl ClaudeInvocationContext {
    fn new(
        credential: Option<ClaudeCredentialSelection>,
        approved_custom_config_dir: Option<PathBuf>,
    ) -> Self {
        Self {
            credential,
            approved_custom_config_dir,
        }
    }

    fn credential(&self) -> Option<&ClaudeCredentialSelection> {
        self.credential.as_ref()
    }

    fn cli_session_config_dir(&self) -> Option<&Path> {
        if self.credential.is_some() {
            return None;
        }
        self.approved_custom_config_dir.as_deref()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ClaudeStatusIssue {
    MissingCliSession,
    MissingApiCredentials,
    NonFirstParty,
    Malformed,
    Oversized,
    Unknown,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct ClaudeConnectionValidation {
    pub credential_source: ClaudeCredentialSource,
}

#[derive(Debug)]
struct ClaudeProcessOutput {
    status: ExitStatus,
    stdout: Vec<u8>,
    stdout_truncated: bool,
    stderr_truncated: bool,
}

#[derive(Debug)]
enum ClaudeProbeError {
    Status(ClaudeStatusIssue),
    Command(String),
}

fn claude_status_arguments(credential: Option<&ClaudeCredentialSelection>) -> Vec<OsString> {
    if credential.is_none() {
        return [
            "--safe-mode",
            "--setting-sources",
            "",
            "auth",
            "status",
            "--json",
        ]
        .into_iter()
        .map(OsString::from)
        .collect();
    }

    let mut arguments = vec![OsString::from("--bare")];
    if let Some(settings) = credential.and_then(|value| value.sanitized_settings.as_deref()) {
        arguments.push(OsString::from("--settings"));
        arguments.push(OsString::from(settings));
    }
    arguments.extend(["auth", "status", "--json"].into_iter().map(OsString::from));
    arguments
}

fn configure_claude_child_environment(command: &mut Command, context: &ClaudeInvocationContext) {
    for variable in CLAUDE_ALWAYS_REMOVED_ENVIRONMENT {
        command.env_remove(variable);
    }
    let prefixed_variables = env::vars_os()
        .map(|(key, _)| key)
        .chain(command.get_envs().map(|(key, _)| key.to_os_string()))
        .filter(|key| {
            let normalized = key.to_string_lossy().to_ascii_uppercase();
            CLAUDE_REMOVED_ENVIRONMENT_PREFIXES
                .iter()
                .any(|prefix| normalized.starts_with(prefix))
        })
        .collect::<Vec<_>>();
    for variable in prefixed_variables {
        command.env_remove(variable);
    }
    for (variable, value) in CLAUDE_FORCED_ENVIRONMENT {
        command.env(variable, value);
    }
    if !matches!(
        context.credential().map(|selection| selection.source),
        Some(ClaudeCredentialSource::EnvironmentApiKey)
    ) {
        command.env_remove("ANTHROPIC_API_KEY");
    }
    if let Some(custom_config_dir) = context.cli_session_config_dir() {
        command.env("CLAUDE_CONFIG_DIR", custom_config_dir);
    }
    match sanitized_claude_path(env::var_os("PATH").as_deref()) {
        Some(path) => {
            command.env("PATH", path);
        }
        None => {
            command.env_remove("PATH");
        }
    }
}

fn revalidate_pinned_claude_config_dir(context: &ClaudeInvocationContext) -> Result<(), String> {
    let Some(pinned_config_dir) = context.cli_session_config_dir() else {
        return Ok(());
    };
    let is_same_directory = fs::canonicalize(pinned_config_dir)
        .ok()
        .filter(|canonical| canonical == pinned_config_dir)
        .and_then(|canonical| fs::metadata(canonical).ok())
        .is_some_and(|metadata| metadata.is_dir());
    if !is_same_directory {
        return Err("Claude CLI configuration changed. Reconnect Claude and retry.".into());
    }
    Ok(())
}

fn sanitized_claude_path(raw_path: Option<&OsStr>) -> Option<OsString> {
    let mut absolute_directories = Vec::new();
    for directory in raw_path
        .map(env::split_paths)
        .into_iter()
        .flatten()
        .filter(|directory| directory.is_absolute())
    {
        if !absolute_directories.contains(&directory) {
            absolute_directories.push(directory);
        }
    }
    if absolute_directories.is_empty() {
        return None;
    }
    env::join_paths(absolute_directories).ok()
}

fn run_bounded_process(
    program: &Path,
    arguments: &[OsString],
    cwd: Option<&Path>,
    stdin: Option<&[u8]>,
    context: &ClaudeInvocationContext,
    timeout: Duration,
    stdout_limit: usize,
    stderr_limit: usize,
) -> Result<ClaudeProcessOutput, String> {
    let mut command = Command::new(program);
    command
        .args(arguments)
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(cwd) = cwd {
        command.current_dir(cwd);
    }
    configure_claude_child_environment(&mut command, context);
    revalidate_pinned_claude_config_dir(context)?;
    hide_windows_console(&mut command);

    let mut child = command
        .spawn()
        .map_err(|_| "Failed to launch Claude Code CLI.".to_string())?;
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Failed to capture Claude Code CLI output.".into());
    };
    let Some(stderr) = child.stderr.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("Failed to capture Claude Code CLI diagnostics.".into());
    };
    let deadline = Instant::now() + timeout;
    let stdout_reader = read_bounded_pipe(stdout, stdout_limit, "stdout");
    let stderr_reader = read_bounded_pipe(stderr, stderr_limit, "stderr");

    let stdin_writer = if let Some(input) = stdin {
        let Some(mut child_stdin) = child.stdin.take() else {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Failed to open Claude Code CLI prompt input.".into());
        };
        let input = input.to_vec();
        let (sender, receiver) = mpsc::channel();
        thread::spawn(move || {
            let result = child_stdin
                .write_all(&input)
                .map_err(|_| "Failed to write the Claude Code CLI prompt.".to_string());
            let _ = sender.send(result);
        });
        Some(receiver)
    } else {
        None
    };

    loop {
        let status = match child.try_wait() {
            Ok(status) => status,
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err("Failed while waiting for Claude Code CLI.".into());
            }
        };
        if let Some(status) = status {
            if let Some(writer) = stdin_writer {
                receive_process_io_until(writer, deadline, "prompt input", timeout)??;
            }
            let (stdout, stdout_truncated) =
                receive_process_io_until(stdout_reader, deadline, "stdout", timeout)??;
            let (_discarded_stderr, stderr_truncated) =
                receive_process_io_until(stderr_reader, deadline, "stderr", timeout)??;
            return Ok(ClaudeProcessOutput {
                status,
                stdout,
                stdout_truncated,
                stderr_truncated,
            });
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            // Descendants may retain inherited pipes. Dropping the channel
            // receivers keeps timeout return bounded after the owned child exits.
            drop(stdout_reader);
            drop(stderr_reader);
            drop(stdin_writer);
            return Err(format!(
                "Claude Code CLI timed out after {} seconds.",
                timeout.as_secs_f64()
            ));
        }
        thread::sleep(Duration::from_millis(10));
    }
}

fn validate_claude_connection_with(
    program: &Path,
    context: &ClaudeInvocationContext,
    timeout: Duration,
) -> Result<ClaudeConnectionValidation, String> {
    run_claude_status_probe(program, context, timeout).map_err(|error| match error {
        ClaudeProbeError::Status(issue) => status_issue_message(issue),
        ClaudeProbeError::Command(message) => message,
    })
}

fn run_claude_status_probe(
    program: &Path,
    context: &ClaudeInvocationContext,
    timeout: Duration,
) -> Result<ClaudeConnectionValidation, ClaudeProbeError> {
    let credential = context.credential();
    let output = run_bounded_process(
        program,
        &claude_status_arguments(credential),
        None,
        None,
        context,
        timeout,
        MAX_CLAUDE_STATUS_BYTES,
        MAX_CLAUDE_STDERR_BYTES,
    )
    .map_err(ClaudeProbeError::Command)?;
    if output.stdout_truncated {
        return Err(ClaudeProbeError::Status(ClaudeStatusIssue::Oversized));
    }
    let parsed_status = parse_claude_auth_status(&output.stdout, credential);
    if !output.status.success() {
        if let Err(issue) = parsed_status.as_ref() {
            if !matches!(
                issue,
                ClaudeStatusIssue::Malformed | ClaudeStatusIssue::Oversized
            ) {
                return Err(ClaudeProbeError::Status(*issue));
            }
        }
        return Err(ClaudeProbeError::Command(if output.stderr_truncated {
            if credential.is_none() {
                concat!(
                    "Claude Code authentication status failed and its diagnostics exceeded the ",
                    "output limit. Revalidate the local Claude CLI login and retry."
                )
                .into()
            } else {
                concat!(
                    "Claude Code authentication status failed and its diagnostics exceeded the ",
                    "output limit. Reconfigure the first-party API-key credential and retry."
                )
                .into()
            }
        } else if credential.is_none() {
            concat!(
                "Claude Code authentication status failed. Child diagnostics were discarded ",
                "to protect credential data. Revalidate the local Claude CLI login and retry."
            )
            .into()
        } else {
            concat!(
                "Claude Code authentication status failed. Child diagnostics were discarded ",
                "to protect credential data. Reconfigure the first-party API-key credential and retry."
            )
            .into()
        }));
    }
    parsed_status.map_err(ClaudeProbeError::Status)
}

fn status_issue_message(issue: ClaudeStatusIssue) -> String {
    match issue {
        ClaudeStatusIssue::MissingCliSession => {
            "Run claude auth login in your terminal, then reconnect Claude.".into()
        }
        ClaudeStatusIssue::MissingApiCredentials => concat!(
            "Claude Code has no matching first-party API credential for the selected API path. ",
            "Configure ANTHROPIC_API_KEY or a user-level apiKeyHelper. apiKeyHelper must be a ",
            "single absolute executable path; use a user-owned, cwd-independent wrapper when needed."
        )
        .into(),
        ClaudeStatusIssue::NonFirstParty => concat!(
            "Claude Code is using a third-party provider mode. ",
            "Bedrock, Vertex, and Foundry credentials are not accepted."
        )
        .into(),
        ClaudeStatusIssue::Malformed => {
            "Claude Code returned malformed authentication status JSON.".into()
        }
        ClaudeStatusIssue::Oversized => {
            "Claude Code authentication status exceeded the output limit.".into()
        }
        ClaudeStatusIssue::Unknown => {
            "Claude Code returned an unsupported authentication status.".into()
        }
    }
}

fn read_bounded_pipe<T>(
    mut pipe: T,
    limit: usize,
    label: &'static str,
) -> Receiver<Result<(Vec<u8>, bool), String>>
where
    T: Read + Send + 'static,
{
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut output = Vec::new();
        let result = pipe
            .by_ref()
            .take(limit.saturating_add(1) as u64)
            .read_to_end(&mut output)
            .map_err(|_| format!("Failed to read Claude Code CLI {label}."))
            .map(|_| {
                let truncated = output.len() > limit;
                output.truncate(limit);
                (output, truncated)
            });
        let _ = sender.send(result);
    });
    receiver
}

fn receive_process_io_until<T>(
    receiver: Receiver<T>,
    deadline: Instant,
    label: &str,
    timeout: Duration,
) -> Result<T, String> {
    loop {
        match receiver.try_recv() {
            Ok(value) => return Ok(value),
            Err(TryRecvError::Disconnected) => {
                return Err(format!(
                    "Claude Code CLI {label} worker stopped unexpectedly."
                ))
            }
            Err(TryRecvError::Empty) if Instant::now() >= deadline => {
                return Err(format!(
                    "Claude Code CLI timed out after {} seconds.",
                    timeout.as_secs_f64()
                ))
            }
            Err(TryRecvError::Empty) => thread::sleep(Duration::from_millis(10)),
        }
    }
}

#[cfg(target_os = "windows")]
fn hide_windows_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn hide_windows_console(_command: &mut Command) {}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ClaudeProbeOutcome {
    MissingCli,
    Status(Result<ClaudeConnectionValidation, ClaudeStatusIssue>),
}

fn diagnostics_from_probe(outcome: ClaudeProbeOutcome) -> AgentProviderDiagnostics {
    let cli_present = !matches!(outcome, ClaudeProbeOutcome::MissingCli);
    let (
        setup_state,
        connection_path,
        summary,
        guidance,
        credential_requirement,
        credential_present,
    ) = match outcome {
        ClaudeProbeOutcome::MissingCli => (
            AgentProviderSetupState::NeedsSetup,
            "Claude Code CLI authentication".into(),
            "Claude Code CLI is not installed for this desktop user.".into(),
            concat!(
                "Install Claude Code CLI 2.1.209 or newer, then run claude auth login in your ",
                "terminal or configure a first-party Anthropic API credential."
            ).into(),
            "supported Claude authentication".into(),
            false,
        ),
        ClaudeProbeOutcome::Status(Err(ClaudeStatusIssue::MissingCliSession)) => (
            AgentProviderSetupState::NeedsSetup,
            "Claude Code CLI local login".into(),
            "Claude Code CLI is present, but no authenticated local CLI session is available.".into(),
            "Run claude auth login in your terminal, then reconnect Claude.".into(),
            "local Claude CLI login".into(),
            false,
        ),
        ClaudeProbeOutcome::Status(Err(ClaudeStatusIssue::MissingApiCredentials)) => (
            AgentProviderSetupState::NeedsSetup,
            "Claude Code CLI first-party API credential".into(),
            "Claude Code CLI is present, but the selected first-party API credential is unavailable.".into(),
            concat!(
                "Set a non-empty ANTHROPIC_API_KEY or configure a top-level user apiKeyHelper, ",
                "then reconnect Claude."
            ).into(),
            "first-party Anthropic API credential".into(),
            false,
        ),
        ClaudeProbeOutcome::Status(Err(ClaudeStatusIssue::NonFirstParty)) => (
            AgentProviderSetupState::NeedsSetup,
            "Claude Code CLI first-party authentication".into(),
            "Claude Code is configured for a third-party provider instead of first-party Anthropic authentication.".into(),
            concat!(
                "Disable Bedrock, Vertex, and Foundry provider modes, then use the local Claude ",
                "CLI login or configure a first-party Anthropic API credential."
            ).into(),
            "first-party Claude authentication".into(),
            false,
        ),
        ClaudeProbeOutcome::Status(Err(
            ClaudeStatusIssue::Malformed | ClaudeStatusIssue::Oversized | ClaudeStatusIssue::Unknown,
        )) => (
            AgentProviderSetupState::NeedsSetup,
            "Claude Code CLI authentication".into(),
            "Claude Code returned an unsupported authentication status.".into(),
            concat!(
                "Update Claude Code CLI and reconnect with a local CLI login or first-party ",
                "Anthropic API credential."
            ).into(),
            "supported Claude authentication".into(),
            false,
        ),
        ClaudeProbeOutcome::Status(Ok(validation)) => {
            let (connection_path, summary, guidance, credential_requirement) =
                match validation.credential_source {
                ClaudeCredentialSource::CliSession => (
                    "Claude Code CLI local login".into(),
                    "Claude Code CLI is ready with the authenticated local CLI session.".into(),
                    "Connect Claude to validate the local CLI login before the first request.".into(),
                    "local Claude CLI login".into(),
                ),
                ClaudeCredentialSource::EnvironmentApiKey => (
                    "Claude Code CLI first-party API key".into(),
                    "Claude Code CLI is ready with a first-party Anthropic API key.".into(),
                    "Connect Claude to validate the API-key path before the first request.".into(),
                    "first-party Anthropic API key".into(),
                ),
                ClaudeCredentialSource::ApiKeyHelper => (
                    "Claude Code CLI API key helper".into(),
                    "Claude Code CLI is ready with a sanitized user-level API key helper.".into(),
                    "Connect Claude to validate the helper-backed API-key path before the first request.".into(),
                    "first-party Anthropic API key helper".into(),
                ),
            };
            (
                AgentProviderSetupState::Ready,
                connection_path,
                summary,
                guidance,
                credential_requirement,
                true,
            )
        }
    };

    AgentProviderDiagnostics {
        provider: AgentProvider::Claude,
        setup_state,
        connection_path,
        summary,
        guidance,
        base_url: None,
        model: Some("Claude CLI default".into()),
        requirements: vec![
            AgentProviderRequirementStatus {
                name: "claude CLI".into(),
                required: true,
                present: cli_present,
            },
            AgentProviderRequirementStatus {
                name: credential_requirement,
                required: true,
                present: credential_present,
            },
        ],
    }
}

fn sanitize_user_settings(raw: &[u8]) -> Result<Option<String>, String> {
    if raw.len() > MAX_CLAUDE_SETTINGS_BYTES {
        return Err("Claude user settings exceed the supported size limit.".into());
    }
    let value = serde_json::from_slice::<Value>(raw)
        .map_err(|_| "Claude user settings are not valid JSON.".to_string())?;
    let Some(object) = value.as_object() else {
        return Err("Claude user settings must be a JSON object.".into());
    };
    let helper = object
        .get("apiKeyHelper")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    helper
        .map(|helper| {
            let helper = canonical_api_key_helper(helper)?;
            serde_json::to_string(&json!({ "apiKeyHelper": helper }))
                .map_err(|_| "Could not sanitize Claude user settings.".to_string())
        })
        .transpose()
}

fn canonical_api_key_helper(helper: &str) -> Result<String, String> {
    validate_api_key_helper_path_syntax(helper)?;
    let path = PathBuf::from(helper);
    if !path.is_absolute() {
        return Err(concat!(
            "Claude apiKeyHelper must be an absolute executable path. ",
            "Use a user-owned, cwd-independent wrapper executable."
        )
        .into());
    }
    let canonical = select_claude_executable(&[path]).ok_or_else(|| {
        concat!(
            "Claude apiKeyHelper is unavailable or not executable. ",
            "Configure a user-owned, cwd-independent wrapper executable."
        )
        .to_string()
    })?;
    let canonical = canonical
        .to_str()
        .ok_or_else(|| "Claude apiKeyHelper path is not valid UTF-8.".to_string())?;
    #[cfg(windows)]
    let canonical = normalize_windows_canonical_helper_path(canonical).ok_or_else(|| {
        concat!(
            "Claude apiKeyHelper uses an unsupported Windows path form. ",
            "Use ANTHROPIC_API_KEY or a wrapper on a local drive."
        )
        .to_string()
    })?;
    #[cfg(not(windows))]
    let canonical = canonical.to_owned();
    validate_api_key_helper_path_syntax(&canonical)?;
    Ok(canonical)
}

#[cfg(any(windows, test))]
fn normalize_windows_canonical_helper_path(path: &str) -> Option<String> {
    if path.starts_with(r"\\?\UNC\") {
        return None;
    }
    if let Some(local_path) = path.strip_prefix(r"\\?\") {
        let bytes = local_path.as_bytes();
        if bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && matches!(bytes[2], b'\\' | b'/')
        {
            return Some(local_path.to_owned());
        }
        return None;
    }
    Some(path.to_owned())
}

fn validate_api_key_helper_path_syntax(helper: &str) -> Result<(), String> {
    const SHELL_DEPENDENT_CHARACTERS: &[char] = &[
        '\'', '"', '`', '$', ';', '|', '&', '<', '>', '(', ')', '*', '?', '[', ']', '{', '}', '%',
        '!', '^',
    ];
    if helper.chars().any(char::is_whitespace)
        || helper
            .chars()
            .any(|character| SHELL_DEPENDENT_CHARACTERS.contains(&character))
        || cfg!(unix) && helper.contains('\\')
    {
        return Err(concat!(
            "Claude apiKeyHelper must be one absolute executable path with no arguments or ",
            "shell syntax. Use a user-owned, cwd-independent wrapper executable when arguments are needed."
        )
        .into());
    }
    Ok(())
}

fn select_claude_credential(
    environment_api_key: Option<&str>,
    user_settings: Option<&[u8]>,
) -> Result<Option<ClaudeCredentialSelection>, String> {
    if environment_api_key.is_some_and(|value| !value.trim().is_empty()) {
        return Ok(Some(ClaudeCredentialSelection {
            source: ClaudeCredentialSource::EnvironmentApiKey,
            sanitized_settings: None,
        }));
    }
    let sanitized_settings = user_settings
        .map(sanitize_user_settings)
        .transpose()?
        .flatten();
    Ok(
        sanitized_settings.map(|settings| ClaudeCredentialSelection {
            source: ClaudeCredentialSource::ApiKeyHelper,
            sanitized_settings: Some(settings),
        }),
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeAuthStatusEnvelope {
    logged_in: bool,
    auth_method: Option<String>,
    api_provider: Option<String>,
}

fn normalized_status_token(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn parse_claude_auth_status(
    raw: &[u8],
    credential: Option<&ClaudeCredentialSelection>,
) -> Result<ClaudeConnectionValidation, ClaudeStatusIssue> {
    if raw.len() > MAX_CLAUDE_STATUS_BYTES {
        return Err(ClaudeStatusIssue::Oversized);
    }
    let status = serde_json::from_slice::<ClaudeAuthStatusEnvelope>(raw)
        .map_err(|_| ClaudeStatusIssue::Malformed)?;
    let missing_selected_source = || {
        if credential.is_some() {
            ClaudeStatusIssue::MissingApiCredentials
        } else {
            ClaudeStatusIssue::MissingCliSession
        }
    };
    if !status.logged_in {
        return Err(missing_selected_source());
    }

    let provider = status
        .api_provider
        .as_deref()
        .map(normalized_status_token)
        .ok_or(ClaudeStatusIssue::Unknown)?;

    if matches!(
        provider.as_str(),
        "bedrock" | "vertex" | "vertexai" | "foundry" | "azure"
    ) {
        return Err(ClaudeStatusIssue::NonFirstParty);
    }
    if provider != "firstparty" && provider != "anthropic" {
        return Err(ClaudeStatusIssue::Unknown);
    }

    let method = status
        .auth_method
        .as_deref()
        .map(normalized_status_token)
        .ok_or(ClaudeStatusIssue::Unknown)?;
    if matches!(method.as_str(), "bedrock" | "vertex" | "foundry") {
        return Err(ClaudeStatusIssue::NonFirstParty);
    }
    if method == "none" {
        return Err(missing_selected_source());
    }

    let Some(credential) = credential else {
        return if matches!(method.as_str(), "claudeai" | "oauth" | "keychain") {
            Ok(ClaudeConnectionValidation {
                credential_source: ClaudeCredentialSource::CliSession,
            })
        } else if matches!(
            method.as_str(),
            "apikey" | "anthropicapikey" | "apikeyhelper"
        ) {
            Err(ClaudeStatusIssue::MissingCliSession)
        } else {
            Err(ClaudeStatusIssue::Unknown)
        };
    };
    let method_source = match method.as_str() {
        "apikey" | "anthropicapikey" => ClaudeCredentialSource::EnvironmentApiKey,
        "apikeyhelper" => ClaudeCredentialSource::ApiKeyHelper,
        "claudeai" | "oauth" | "keychain" => return Err(ClaudeStatusIssue::MissingApiCredentials),
        _ => return Err(ClaudeStatusIssue::Unknown),
    };
    if credential.source != method_source {
        return Err(ClaudeStatusIssue::MissingApiCredentials);
    }

    Ok(ClaudeConnectionValidation {
        credential_source: credential.source,
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ClaudePlatform {
    Unix,
    Windows,
}

fn claude_executable_candidates(
    path_dirs: &[PathBuf],
    home: Option<&Path>,
    local_app_data: Option<&Path>,
    platform: ClaudePlatform,
) -> Vec<PathBuf> {
    let executable = match platform {
        ClaudePlatform::Unix => "claude",
        ClaudePlatform::Windows => "claude.exe",
    };
    let mut candidates = path_dirs
        .iter()
        .map(|directory| directory.join(executable))
        .collect::<Vec<_>>();

    if let Some(home) = home {
        candidates.push(home.join(".local").join("bin").join(executable));
    }

    match platform {
        ClaudePlatform::Unix => {
            candidates.push(PathBuf::from("/opt/homebrew/bin/claude"));
            candidates.push(PathBuf::from("/usr/local/bin/claude"));
        }
        ClaudePlatform::Windows => {
            if let Some(local_app_data) = local_app_data {
                candidates.push(
                    local_app_data
                        .join("Programs")
                        .join("Claude")
                        .join("claude.exe"),
                );
            }
        }
    }

    let mut deduplicated = Vec::new();
    for candidate in candidates {
        if !deduplicated.contains(&candidate) {
            deduplicated.push(candidate);
        }
    }
    deduplicated
}

fn select_claude_executable(candidates: &[PathBuf]) -> Option<PathBuf> {
    candidates.iter().find_map(|candidate| {
        if !candidate.is_absolute() {
            return None;
        }
        let canonical = fs::canonicalize(candidate).ok()?;
        let metadata = fs::metadata(&canonical).ok()?;
        if !metadata.is_file() {
            return None;
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o111 == 0 {
                return None;
            }
        }
        Some(canonical)
    })
}

fn current_claude_platform() -> ClaudePlatform {
    if cfg!(target_os = "windows") {
        ClaudePlatform::Windows
    } else {
        ClaudePlatform::Unix
    }
}

fn current_home_dir() -> Option<PathBuf> {
    env::var_os(if cfg!(target_os = "windows") {
        "USERPROFILE"
    } else {
        "HOME"
    })
    .filter(|value| !value.is_empty())
    .map(PathBuf::from)
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ClaudeConfigRoot {
    root: PathBuf,
    custom: Option<PathBuf>,
}

fn canonical_current_home_dir() -> Option<PathBuf> {
    let home = fs::canonicalize(current_home_dir()?).ok()?;
    fs::metadata(&home).ok()?.is_dir().then_some(home)
}

fn approved_custom_claude_config_dir(home: &Path, raw: Option<&OsStr>) -> Option<PathBuf> {
    let candidate = Path::new(raw?);
    if !candidate.is_absolute() {
        return None;
    }
    let canonical = fs::canonicalize(candidate).ok()?;
    let metadata = fs::metadata(&canonical).ok()?;
    if !metadata.is_dir() || !canonical.starts_with(home) {
        return None;
    }
    Some(canonical)
}

fn current_claude_config_root() -> Option<ClaudeConfigRoot> {
    let home = canonical_current_home_dir()?;
    let custom =
        approved_custom_claude_config_dir(&home, env::var_os("CLAUDE_CONFIG_DIR").as_deref());
    let root = custom.clone().unwrap_or_else(|| home.join(".claude"));
    Some(ClaudeConfigRoot { root, custom })
}

fn discover_claude_cli() -> Option<PathBuf> {
    let path_dirs = env::var_os("PATH")
        .map(|value| env::split_paths(&value).collect::<Vec<_>>())
        .unwrap_or_default();
    let home = current_home_dir();
    let local_app_data = env::var_os("LOCALAPPDATA").map(PathBuf::from);
    let candidates = claude_executable_candidates(
        &path_dirs,
        home.as_deref(),
        local_app_data.as_deref(),
        current_claude_platform(),
    );
    select_claude_executable(&candidates)
}

#[cfg(test)]
type ClaudeSettingsReadHook = Box<dyn FnOnce(&Path) + Send>;

#[cfg(test)]
static CLAUDE_SETTINGS_AFTER_METADATA_HOOK: std::sync::Mutex<Option<ClaudeSettingsReadHook>> =
    std::sync::Mutex::new(None);

#[cfg(test)]
fn run_claude_settings_after_metadata_hook(path: &Path) {
    if let Some(hook) = CLAUDE_SETTINGS_AFTER_METADATA_HOOK.lock().unwrap().take() {
        hook(path);
    }
}

fn read_user_claude_settings(config_root: Option<&Path>) -> Result<Option<Vec<u8>>, String> {
    let Some(config_root) = config_root else {
        return Ok(None);
    };
    let path = config_root.join("settings.json");
    let canonical_path = match fs::canonicalize(&path) {
        Ok(path) => path,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Could not inspect Claude user settings.".into()),
    };
    let canonical_root = fs::canonicalize(config_root)
        .map_err(|_| "Could not inspect Claude user settings.".to_string())?;
    if !canonical_path.starts_with(&canonical_root) {
        return Err(
            "Claude user settings must remain inside the selected config directory.".into(),
        );
    }
    let mut file = fs::File::open(&canonical_path)
        .map_err(|_| "Could not read Claude user settings.".to_string())?;
    let metadata = file
        .metadata()
        .map_err(|_| "Could not inspect Claude user settings.".to_string())?;
    if !metadata.is_file() {
        return Err("Claude user settings path is not a file.".into());
    }
    if metadata.len() > MAX_CLAUDE_SETTINGS_BYTES as u64 {
        return Err("Claude user settings exceed the supported size limit.".into());
    }
    #[cfg(test)]
    run_claude_settings_after_metadata_hook(&canonical_path);

    let mut settings = Vec::with_capacity(
        metadata
            .len()
            .min(MAX_CLAUDE_SETTINGS_BYTES.saturating_add(1) as u64) as usize,
    );
    Read::by_ref(&mut file)
        .take(MAX_CLAUDE_SETTINGS_BYTES.saturating_add(1) as u64)
        .read_to_end(&mut settings)
        .map_err(|_| "Could not read Claude user settings.".to_string())?;
    if settings.len() > MAX_CLAUDE_SETTINGS_BYTES {
        return Err("Claude user settings exceed the supported size limit.".into());
    }
    Ok(Some(settings))
}

fn current_claude_invocation_context() -> Result<ClaudeInvocationContext, String> {
    let config_root = current_claude_config_root();
    let environment_key = env::var("ANTHROPIC_API_KEY").ok();
    let credential = if environment_key
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        select_claude_credential(environment_key.as_deref(), None)?
    } else {
        let user_settings =
            read_user_claude_settings(config_root.as_ref().map(|config| config.root.as_path()))?;
        select_claude_credential(None, user_settings.as_deref())?
    };
    Ok(ClaudeInvocationContext::new(
        credential,
        config_root.and_then(|config| config.custom),
    ))
}

#[cfg(test)]
fn current_claude_credential() -> Result<Option<ClaudeCredentialSelection>, String> {
    Ok(current_claude_invocation_context()?.credential)
}

pub fn validate_claude_connection() -> Result<ClaudeConnectionValidation, String> {
    let program = discover_claude_cli().ok_or_else(|| {
        "Claude Code CLI is not installed. Install it before connecting Claude.".to_string()
    })?;
    let context = current_claude_invocation_context()?;
    validate_claude_connection_with(&program, &context, CLAUDE_STATUS_TIMEOUT)
}

pub fn read_claude_diagnostics() -> AgentProviderDiagnostics {
    let Some(program) = discover_claude_cli() else {
        return diagnostics_from_probe(ClaudeProbeOutcome::MissingCli);
    };
    let context = match current_claude_invocation_context() {
        Ok(context) => context,
        Err(_) => {
            return diagnostics_from_probe(ClaudeProbeOutcome::Status(Err(
                ClaudeStatusIssue::Unknown,
            )))
        }
    };
    let outcome = match run_claude_status_probe(&program, &context, CLAUDE_STATUS_TIMEOUT) {
        Ok(validation) => Ok(validation),
        Err(ClaudeProbeError::Status(issue)) => Err(issue),
        Err(ClaudeProbeError::Command(_)) => Err(ClaudeStatusIssue::Unknown),
    };
    diagnostics_from_probe(ClaudeProbeOutcome::Status(outcome))
}

fn claude_suggestion_schema() -> Result<String, String> {
    serde_json::to_string(&json!({
        "type": "object",
        "additionalProperties": false,
        "properties": {
            "provider": { "type": "string", "enum": ["claude"] },
            "schemaVersion": { "type": "integer", "enum": [CLAUDE_SCHEMA_VERSION] },
            "summary": { "type": "string" },
            "command": { "type": "string" },
            "preferredTarget": {
                "type": "string",
                "enum": ["current_tab", "new_tab"]
            },
            "confidence": {
                "type": "string",
                "enum": ["low", "medium", "high"]
            },
            "error": { "type": ["string", "null"] }
        },
        "required": [
            "provider",
            "schemaVersion",
            "summary",
            "command",
            "preferredTarget",
            "confidence",
            "error"
        ]
    }))
    .map_err(|_| "Could not build the Claude structured-output schema.".to_string())
}

fn claude_isolated_arguments(credential: Option<&ClaudeCredentialSelection>) -> Vec<OsString> {
    let mut arguments = if credential.is_some() {
        ["--bare", "--safe-mode"]
            .into_iter()
            .map(OsString::from)
            .collect::<Vec<_>>()
    } else {
        ["--safe-mode", "--setting-sources", ""]
            .into_iter()
            .map(OsString::from)
            .collect::<Vec<_>>()
    };
    arguments.extend(
        [
            "--strict-mcp-config",
            "--disable-slash-commands",
            "--no-chrome",
            "--no-session-persistence",
            "--permission-mode",
            "dontAsk",
            "--tools",
            "",
        ]
        .into_iter()
        .map(OsString::from),
    );
    arguments
}

fn append_claude_sanitized_settings(
    arguments: &mut Vec<OsString>,
    credential: Option<&ClaudeCredentialSelection>,
) {
    if let Some(settings) = credential.and_then(|value| value.sanitized_settings.as_deref()) {
        arguments.push(OsString::from("--settings"));
        arguments.push(OsString::from(settings));
    }
}

fn claude_request_arguments(
    credential: Option<&ClaudeCredentialSelection>,
    schema: &str,
) -> Vec<OsString> {
    let mut arguments = claude_isolated_arguments(credential);
    arguments.extend(
        [
            "--print",
            "--output-format",
            "json",
            "--json-schema",
            schema,
        ]
        .into_iter()
        .map(OsString::from),
    );
    append_claude_sanitized_settings(&mut arguments, credential);
    arguments
}

fn claude_model_catalog_arguments(credential: Option<&ClaudeCredentialSelection>) -> Vec<OsString> {
    let mut arguments = claude_isolated_arguments(credential);
    arguments.extend(
        [
            "--output-format",
            "stream-json",
            "--verbose",
            "--input-format",
            "stream-json",
        ]
        .into_iter()
        .map(OsString::from),
    );
    append_claude_sanitized_settings(&mut arguments, credential);
    arguments
}

fn validated_claude_model(model: Option<&str>) -> Result<Option<&str>, String> {
    let Some(model) = model else {
        return Ok(None);
    };
    let model = model.trim();
    if CLAUDE_MODEL_ALIASES
        .iter()
        .any(|(model_id, _)| *model_id == model)
    {
        Ok(Some(model))
    } else {
        Err("Claude request selected an unsupported model.".into())
    }
}

fn claude_request_arguments_for_model(
    credential: Option<&ClaudeCredentialSelection>,
    schema: &str,
    model: Option<&str>,
) -> Result<Vec<OsString>, String> {
    let model = validated_claude_model(model)?;
    let mut arguments = claude_request_arguments(credential, schema);
    if let Some(model) = model {
        arguments.push(OsString::from("--model"));
        arguments.push(OsString::from(model));
    }
    Ok(arguments)
}

fn build_claude_prompt(request: &RequestAgentSuggestionsRequest) -> Result<String, String> {
    let session_id = request.agent_session_id.trim();
    if session_id.is_empty() {
        return Err("Claude request is missing its origin Agent session id.".into());
    }
    let project_path = request.project_path.trim();
    if project_path.is_empty() {
        return Err("Claude request is missing its origin project path.".into());
    }
    let user_task = request.user_task.trim();
    if user_task.is_empty() {
        return Err("Claude request task cannot be empty.".into());
    }

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

    let prompt = format!(
        concat!(
            "You are Claude inside gtum, a desktop workspace for terminal-heavy development.\n",
            "This invocation is a read-only suggestion surface. You must not execute commands or mutate a terminal, file, browser, session, or external service.\n",
            "Tools are disabled. Return only the structured response required by the supplied JSON schema.\n",
            "The command field is a UI permission-card preview only; gtum does not execute it until the user separately approves it.\n",
            "Use an empty command for explanations, planning, status, or any response that does not need explicit user review.\n",
            "If the request cannot be answered safely, set error and leave command empty.\n\n",
            "Provider: Claude\n",
            "Origin project name: {}\n",
            "Origin project path: {}\n",
            "Origin Agent session id: {}\n",
            "Active tab id: {}\n",
            "Active tab title: {}\n",
            "Active file path: {}\n",
            "Active file line: {}\n",
            "Active file snippet (truncated by the caller):\n{}\n\n",
            "User task:\n{}\n\n",
            "Recent terminal logs (most recent last, max 50 lines):\n{}"
        ),
        request.project_name.trim(),
        project_path,
        session_id,
        request.active_tab_id.as_deref().unwrap_or("none"),
        request.active_tab_title.as_deref().unwrap_or("none"),
        file_path,
        file_line,
        file_snippet,
        user_task,
        log_lines,
    );
    if prompt.len() > MAX_CLAUDE_PROMPT_BYTES {
        return Err("Claude request context exceeds the supported size limit.".into());
    }
    Ok(prompt)
}

#[derive(Deserialize)]
struct ClaudeResultEnvelope {
    #[serde(rename = "type")]
    result_type: String,
    subtype: String,
    is_error: bool,
    structured_output: Option<Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ClaudeStructuredSuggestion {
    provider: AgentProvider,
    schema_version: u64,
    summary: String,
    command: String,
    preferred_target: AgentExecutionTarget,
    confidence: AgentSuggestionConfidence,
    error: Option<String>,
}

fn parse_claude_result(raw: &[u8]) -> Result<AgentSuggestionResponse, String> {
    if raw.len() > MAX_CLAUDE_REQUEST_BYTES {
        return Err("Claude Code response exceeded the output limit.".into());
    }
    let envelope = serde_json::from_slice::<ClaudeResultEnvelope>(raw)
        .map_err(|_| "Claude Code returned malformed result JSON.".to_string())?;
    if envelope.result_type != "result" || envelope.subtype != "success" || envelope.is_error {
        return Err("Claude Code did not return a successful structured result.".into());
    }
    let structured = envelope
        .structured_output
        .ok_or_else(|| "Claude Code returned no structured output.".to_string())?;
    let structured = serde_json::from_value::<ClaudeStructuredSuggestion>(structured)
        .map_err(|_| "Claude Code returned invalid structured output.".to_string())?;
    if structured.provider != AgentProvider::Claude {
        return Err("Claude Code returned a response for a different provider.".into());
    }
    if structured.schema_version != CLAUDE_SCHEMA_VERSION {
        return Err("Claude Code returned an unsupported response schema.".into());
    }

    let summary = structured.summary.trim().to_string();
    let command = structured.command.trim().to_string();
    let error = structured
        .error
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if summary.is_empty() && command.is_empty() && error.is_none() {
        return Err("Claude Code returned an empty structured response.".into());
    }

    Ok(AgentSuggestionResponse {
        id: format!("claude-{}", unix_timestamp_ms()),
        provider: AgentProvider::Claude,
        summary,
        command,
        preferred_target: structured.preferred_target,
        confidence: structured.confidence,
        error,
    })
}

fn canonical_project_directory(project_path: &str) -> Result<PathBuf, String> {
    let trimmed = project_path.trim();
    if trimmed.is_empty() {
        return Err("Claude request is missing its origin project path.".into());
    }
    let canonical = fs::canonicalize(trimmed)
        .map_err(|_| "Claude request project path is unavailable.".to_string())?;
    if !canonical.is_dir() {
        return Err("Claude request project path is not a directory.".into());
    }
    Ok(canonical)
}

fn request_claude_suggestions_with(
    program: &Path,
    context: &ClaudeInvocationContext,
    mut request: RequestAgentSuggestionsRequest,
    timeout: Duration,
) -> Result<Vec<AgentSuggestionResponse>, String> {
    let credential = context.credential();
    if request.provider != AgentProvider::Claude {
        return Err("Claude adapter received a request for a different provider.".into());
    }
    if !request.attachments.is_empty() {
        return Err("Claude attachments are disabled for this provider path.".into());
    }
    let canonical_project = canonical_project_directory(&request.project_path)?;
    request.project_path = canonical_project.to_string_lossy().into_owned();
    let prompt = build_claude_prompt(&request)?;
    let schema = claude_suggestion_schema()?;
    let arguments =
        claude_request_arguments_for_model(credential, &schema, request.model.as_deref())?;
    let output = run_bounded_process(
        program,
        &arguments,
        Some(&canonical_project),
        Some(prompt.as_bytes()),
        context,
        timeout,
        MAX_CLAUDE_REQUEST_BYTES,
        MAX_CLAUDE_STDERR_BYTES,
    )?;
    if output.stdout_truncated {
        return Err("Claude Code response exceeded the output limit.".into());
    }
    if !output.status.success() {
        return Err(if output.stderr_truncated {
            "Claude Code request failed and its diagnostics exceeded the output limit.".into()
        } else if credential.is_none() {
            "Claude Code request failed. Revalidate the local Claude CLI login and retry.".into()
        } else {
            "Claude Code request failed. Revalidate the first-party API-key connection and retry."
                .into()
        });
    }
    Ok(vec![parse_claude_result(&output.stdout)?])
}

pub struct ClaudeSuggestionAttempt {
    pub validation: Result<ClaudeConnectionValidation, String>,
    pub suggestions: Option<Result<Vec<AgentSuggestionResponse>, String>>,
}

pub fn request_claude_suggestion_attempt(
    request: RequestAgentSuggestionsRequest,
) -> ClaudeSuggestionAttempt {
    let Some(program) = discover_claude_cli() else {
        return ClaudeSuggestionAttempt {
            validation: Err(
                "Claude Code CLI is not installed. Install it before connecting Claude.".into(),
            ),
            suggestions: None,
        };
    };
    let context = match current_claude_invocation_context() {
        Ok(context) => context,
        Err(error) => {
            return ClaudeSuggestionAttempt {
                validation: Err(error),
                suggestions: None,
            }
        }
    };
    let validation = validate_claude_connection_with(&program, &context, CLAUDE_STATUS_TIMEOUT);
    if validation.is_err() {
        return ClaudeSuggestionAttempt {
            validation,
            suggestions: None,
        };
    }
    let suggestions = Some(request_claude_suggestions_with(
        &program,
        &context,
        request,
        CLAUDE_REQUEST_TIMEOUT,
    ));
    ClaudeSuggestionAttempt {
        validation,
        suggestions,
    }
}

#[derive(Deserialize)]
struct ClaudeModelCatalogEnvelope {
    #[serde(rename = "type")]
    message_type: String,
    response: ClaudeModelCatalogControlResponse,
}

#[derive(Deserialize)]
struct ClaudeModelCatalogControlResponse {
    subtype: String,
    request_id: String,
    response: Option<ClaudeModelCatalogPayload>,
}

#[derive(Deserialize)]
struct ClaudeModelCatalogPayload {
    models: Vec<ClaudeSdkModelInfo>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaudeSdkModelInfo {
    value: String,
    resolved_model: Option<String>,
    display_name: String,
    description: String,
}

#[derive(Serialize)]
struct ClaudeModelCatalogInitializeEnvelope<'a> {
    request_id: &'a str,
    #[serde(rename = "type")]
    message_type: &'static str,
    request: ClaudeModelCatalogInitializePayload,
}

#[derive(Serialize)]
struct ClaudeModelCatalogInitializePayload {
    subtype: &'static str,
}

fn claude_model_catalog_initialize_request() -> Result<Vec<u8>, String> {
    let mut request = serde_json::to_vec(&ClaudeModelCatalogInitializeEnvelope {
        request_id: CLAUDE_MODEL_CATALOG_REQUEST_ID,
        message_type: "control_request",
        request: ClaudeModelCatalogInitializePayload {
            subtype: "initialize",
        },
    })
    .map_err(|_| "Could not serialize the Claude model catalog request.".to_string())?;
    request.push(b'\n');
    Ok(request)
}

fn invalid_claude_model_text(value: &str, max_bytes: usize) -> bool {
    value.len() > max_bytes || value.chars().any(char::is_control)
}

fn parse_claude_model_catalog(raw: &[u8]) -> Result<Vec<AgentModelCapability>, String> {
    if raw.len() > MAX_CLAUDE_MODEL_CATALOG_BYTES {
        return Err("Claude model catalog exceeded the output limit.".into());
    }
    let envelope = serde_json::from_slice::<ClaudeModelCatalogEnvelope>(raw)
        .map_err(|_| "Claude model catalog returned malformed JSON.".to_string())?;
    if envelope.message_type != "control_response"
        || envelope.response.request_id != CLAUDE_MODEL_CATALOG_REQUEST_ID
        || envelope.response.subtype != "success"
    {
        return Err("Claude model catalog returned an invalid control response.".into());
    }
    let payload = envelope
        .response
        .response
        .ok_or_else(|| "Claude model catalog returned no model payload.".to_string())?;
    if payload.models.is_empty() || payload.models.len() > MAX_CLAUDE_MODELS {
        return Err("Claude model catalog returned an invalid model count.".into());
    }

    let mut models = Vec::with_capacity(payload.models.len());
    for model in payload.models {
        let raw_model_id = model.value.as_str();
        if invalid_claude_model_text(raw_model_id, MAX_CLAUDE_MODEL_ID_BYTES) {
            return Err("Claude model catalog returned an invalid model identifier.".into());
        }
        let model_id = raw_model_id.trim();
        if model_id.is_empty()
            || model_id.starts_with('-')
            || models
                .iter()
                .any(|existing: &AgentModelCapability| existing.model_id == model_id)
        {
            return Err("Claude model catalog returned an invalid model identifier.".into());
        }
        if model
            .resolved_model
            .as_deref()
            .is_some_and(|resolved| invalid_claude_model_text(resolved, MAX_CLAUDE_MODEL_ID_BYTES))
            || invalid_claude_model_text(&model.display_name, MAX_CLAUDE_MODEL_LABEL_BYTES)
            || invalid_claude_model_text(&model.description, MAX_CLAUDE_MODEL_LABEL_BYTES)
        {
            return Err("Claude model catalog returned an excessive model field.".into());
        }

        let display_name = model.display_name.trim();
        let version_label = model
            .description
            .split('·')
            .next()
            .unwrap_or_default()
            .trim();
        if display_name.is_empty() || version_label.is_empty() {
            return Err("Claude model catalog returned a blank model label.".into());
        }
        let label = format!("{display_name} · {version_label}");
        if invalid_claude_model_text(&label, MAX_CLAUDE_MODEL_LABEL_BYTES) {
            return Err("Claude model catalog returned an invalid model label.".into());
        }
        models.push(AgentModelCapability {
            provider_id: AgentProvider::Claude,
            model_id: model_id.into(),
            label,
        });
    }
    Ok(models)
}

fn discover_claude_model_catalog_with(
    program: &Path,
    context: &ClaudeInvocationContext,
    timeout: Duration,
) -> Result<Vec<AgentModelCapability>, String> {
    // This intentionally mirrors the Agent SDK initialize handshake. The private wire is
    // version-coupled, so any response drift is rejected and model selection fails closed.
    let initialize_request = claude_model_catalog_initialize_request()?;
    let output = run_bounded_process(
        program,
        &claude_model_catalog_arguments(context.credential()),
        None,
        Some(&initialize_request),
        context,
        timeout,
        MAX_CLAUDE_MODEL_CATALOG_BYTES,
        MAX_CLAUDE_STDERR_BYTES,
    )?;
    if output.stdout_truncated {
        return Err("Claude model catalog exceeded the output limit.".into());
    }
    if !output.status.success() {
        return Err(if output.stderr_truncated {
            "Claude model catalog failed and its diagnostics exceeded the output limit.".into()
        } else {
            "Claude model catalog discovery failed. Child diagnostics were discarded.".into()
        });
    }
    parse_claude_model_catalog(&output.stdout)
}

pub fn read_claude_capabilities() -> AgentProviderCapabilities {
    let models = discover_claude_cli().and_then(|program| {
        let context = current_claude_invocation_context().ok()?;
        discover_claude_model_catalog_with(&program, &context, CLAUDE_MODEL_CATALOG_TIMEOUT).ok()
    });
    claude_capabilities(models)
}

fn claude_capabilities(models: Option<Vec<AgentModelCapability>>) -> AgentProviderCapabilities {
    let available_models = models
        .filter(|models| !models.is_empty())
        .unwrap_or_default();
    let supports_model_selection = !available_models.is_empty();
    let current_model = available_models
        .iter()
        .find(|model| model.model_id == "default")
        .cloned();
    AgentProviderCapabilities {
        provider: AgentProvider::Claude,
        supports_model_selection,
        current_model,
        available_models,
        reasoning_levels: Vec::new(),
        default_reasoning_level: None,
        supports_fast_mode: false,
        attachments: [
            (AgentAttachmentKind::Image, "Image"),
            (AgentAttachmentKind::File, "File"),
            (AgentAttachmentKind::Directory, "Directory"),
            (AgentAttachmentKind::ActiveTab, "Active tab"),
        ]
        .into_iter()
        .map(|(kind, label)| AgentAttachmentCapability {
            kind,
            label: label.into(),
            enabled: false,
            invocation_flag: None,
        })
        .collect(),
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
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::Instant;

    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    static NEXT_TEST_ROOT: AtomicU64 = AtomicU64::new(0);
    const ISOLATED_TEST_TIMEOUT: Duration = Duration::from_secs(10);
    const MAX_ISOLATED_TEST_OUTPUT_BYTES: usize = 64 * 1024;

    struct TestRoot {
        path: PathBuf,
    }

    impl TestRoot {
        fn new(label: &str) -> Self {
            Self::new_at(&std::env::temp_dir(), label)
        }

        fn new_at(base: &Path, label: &str) -> Self {
            let path = base.join(format!(
                "gtum-claude-{label}-{}-{}",
                std::process::id(),
                NEXT_TEST_ROOT.fetch_add(1, Ordering::Relaxed),
            ));
            fs::create_dir_all(&path).unwrap();
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TestRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn write_test_executable(path: &Path, body: &str) {
        #[cfg(unix)]
        fs::write(path, format!("#!/bin/sh\n{body}\n")).unwrap();
        #[cfg(not(unix))]
        fs::write(path, body).unwrap();
        #[cfg(unix)]
        {
            let mut permissions = fs::metadata(path).unwrap().permissions();
            permissions.set_mode(0o700);
            fs::set_permissions(path, permissions).unwrap();
        }
    }

    fn compile_catalog_test_executable(root: &TestRoot, name: &str) -> PathBuf {
        let source_path = root.path().join(format!("{name}.rs"));
        let executable_path = root.path().join(if cfg!(windows) {
            format!("{name}.exe")
        } else {
            name.to_string()
        });
        fs::write(
            &source_path,
            r#"
use std::{
    env, fs,
    io::{self, Read, Write},
    process, thread,
    time::Duration,
};

fn write_response(root: &std::path::Path) {
    let response = fs::read(root.join("response")).expect("read fake response");
    let mut stdout = io::stdout().lock();
    stdout.write_all(&response).expect("write fake response");
    stdout.flush().expect("flush fake response");
}

fn main() {
    let executable = env::current_exe().expect("resolve fake executable");
    let root = executable.parent().expect("resolve fake executable root");
    let arguments = env::args_os()
        .skip(1)
        .map(|argument| argument.to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("\n");
    let arguments = if arguments.is_empty() {
        arguments
    } else {
        format!("{arguments}\n")
    };
    fs::write(root.join("argv"), arguments).expect("record fake argv");

    let mut stdin = Vec::new();
    io::stdin()
        .read_to_end(&mut stdin)
        .expect("read fake stdin to EOF");
    fs::write(root.join("stdin"), stdin).expect("record fake stdin");

    match fs::read_to_string(root.join("mode"))
        .expect("read fake mode")
        .trim()
    {
        "success" => write_response(root),
        "nonzero" => {
            write_response(root);
            process::exit(7);
        }
        "timeout" => thread::sleep(Duration::from_secs(1)),
        "oversized" => {
            io::stdout()
                .lock()
                .write_all(&vec![b' '; 64 * 1024 + 1])
                .expect("write oversized fake response");
        }
        _ => process::exit(9),
    }
}
"#,
        )
        .unwrap();

        let output = Command::new("rustc")
            .arg("--edition=2021")
            .arg("-C")
            .arg("debuginfo=0")
            .arg(&source_path)
            .arg("-o")
            .arg(&executable_path)
            .output()
            .expect("launch rustc for catalog fake executable");
        assert!(
            output.status.success(),
            "catalog fake executable failed to compile\nstdout:\n{}\nstderr:\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
        );
        executable_path
    }

    fn assert_no_argument_expansion(arguments: &[OsString]) {
        for forbidden in [
            "--bare",
            "--settings",
            "--mcp-config",
            "--plugin-dir",
            "--plugins",
            "--agent",
            "--agents",
            "--resume",
            "--continue",
            "--session-id",
            "--fork-session",
            "--chrome",
            "--session-persistence",
            "--file",
            "--add-dir",
        ] {
            assert!(
                !arguments
                    .iter()
                    .any(|argument| argument == OsStr::new(forbidden)),
                "CLI-session argv unexpectedly expanded with {forbidden}"
            );
        }
    }

    struct IsolatedTestOutput {
        status: ExitStatus,
        stdout: Vec<u8>,
        stderr: Vec<u8>,
        timed_out: bool,
        stdout_truncated: bool,
        stderr_truncated: bool,
    }

    fn read_bounded_test_output(path: &Path) -> (Vec<u8>, bool) {
        let mut file = fs::File::open(path).unwrap();
        let mut output = Vec::new();
        Read::by_ref(&mut file)
            .take(MAX_ISOLATED_TEST_OUTPUT_BYTES.saturating_add(1) as u64)
            .read_to_end(&mut output)
            .unwrap();
        let truncated = output.len() > MAX_ISOLATED_TEST_OUTPUT_BYTES;
        output.truncate(MAX_ISOLATED_TEST_OUTPUT_BYTES);
        (output, truncated)
    }

    fn run_isolated_test(
        test_name: &str,
        environment: impl IntoIterator<Item = (OsString, OsString)>,
    ) -> IsolatedTestOutput {
        let output_root = TestRoot::new("isolated-output");
        let stdout_path = output_root.path().join("stdout");
        let stderr_path = output_root.path().join("stderr");
        let mut command = Command::new(std::env::current_exe().unwrap());
        command
            .arg("--exact")
            .arg(test_name)
            .arg("--nocapture")
            .env_clear()
            .stdout(Stdio::from(fs::File::create(&stdout_path).unwrap()))
            .stderr(Stdio::from(fs::File::create(&stderr_path).unwrap()));
        for key in [
            "PATH",
            "SystemRoot",
            "WINDIR",
            "ComSpec",
            "PATHEXT",
            "TEMP",
            "TMP",
            "LD_LIBRARY_PATH",
            "DYLD_LIBRARY_PATH",
        ] {
            if let Some(value) = std::env::var_os(key) {
                command.env(key, value);
            }
        }
        command.envs(environment);
        let mut child = command.spawn().unwrap();
        let deadline = Instant::now() + ISOLATED_TEST_TIMEOUT;
        let (status, timed_out) = loop {
            if let Some(status) = child.try_wait().unwrap() {
                break (status, false);
            }
            if Instant::now() >= deadline {
                let _ = child.kill();
                break (child.wait().unwrap(), true);
            }
            thread::sleep(Duration::from_millis(10));
        };
        let (stdout, stdout_truncated) = read_bounded_test_output(&stdout_path);
        let (stderr, stderr_truncated) = read_bounded_test_output(&stderr_path);
        IsolatedTestOutput {
            status,
            stdout,
            stderr,
            timed_out,
            stdout_truncated,
            stderr_truncated,
        }
    }

    fn assert_isolated_test_succeeded(output: IsolatedTestOutput, label: &str) {
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(!output.timed_out, "isolated {label} test timed out");
        assert!(
            !output.stdout_truncated && !output.stderr_truncated,
            "isolated {label} test output exceeded the bounded capture"
        );
        assert!(
            output.status.success() && stdout.contains("running 1 test"),
            "isolated {label} test failed\nstdout:\n{stdout}\nstderr:\n{stderr}"
        );
    }

    fn claude_request(
        project_path: &Path,
    ) -> crate::runtime::codex::RequestAgentSuggestionsRequest {
        crate::runtime::codex::RequestAgentSuggestionsRequest {
            provider: AgentProvider::Claude,
            agent_session_id: "agent-session-origin-7".into(),
            model: None,
            reasoning_level: None,
            fast_mode: None,
            attachments: vec![],
            project_name: "gtum".into(),
            project_path: project_path.to_string_lossy().into_owned(),
            active_tab_id: Some("terminal-3".into()),
            active_tab_title: Some("Backend".into()),
            active_file_path: Some("src-tauri/src/runtime/claude.rs".into()),
            active_file_line: Some(12),
            active_file_snippet: Some("fn adapter() {}".into()),
            last_n_log_lines: vec!["cargo test".into()],
            user_task: "Review the Claude adapter".into(),
        }
    }

    fn invocation_context(
        credential: Option<ClaudeCredentialSelection>,
    ) -> ClaudeInvocationContext {
        ClaudeInvocationContext::new(credential, None)
    }

    fn model_catalog_response(models: Value) -> Vec<u8> {
        serde_json::to_vec(&json!({
            "type": "control_response",
            "response": {
                "subtype": "success",
                "request_id": CLAUDE_MODEL_CATALOG_REQUEST_ID,
                "response": {
                    "models": models,
                    "accountEmail": "must-not-be-retained@example.invalid"
                }
            }
        }))
        .unwrap()
    }

    fn expected_account_models() -> Value {
        json!([
            {
                "value": " default ",
                "resolvedModel": "claude-opus-4-8[1m]",
                "displayName": "Default (recommended)",
                "description": "Opus 4.8 with 1M context · Best for everyday, complex tasks"
            },
            {
                "value": "opus[1m]",
                "resolvedModel": "claude-opus-4-8[1m]",
                "displayName": "Opus",
                "description": "Opus 4.8 with 1M context · Best for everyday, complex tasks"
            },
            {
                "value": "claude-fable-5[1m]",
                "resolvedModel": "claude-fable-5",
                "displayName": "Fable",
                "description": "Fable 5 · Most capable for your hardest and longest-running tasks"
            },
            {
                "value": "sonnet",
                "resolvedModel": "claude-sonnet-5",
                "displayName": "Sonnet",
                "description": "Sonnet 5 · Efficient for routine tasks"
            },
            {
                "value": "haiku",
                "resolvedModel": "claude-haiku-4-5-20251001",
                "displayName": "Haiku",
                "description": "Haiku 4.5 · Fastest for quick answers"
            }
        ])
    }

    fn account_model(
        value: impl Into<String>,
        display_name: impl Into<String>,
        description: impl Into<String>,
    ) -> Value {
        json!({
            "value": value.into(),
            "resolvedModel": "resolved-model-must-not-be-selected",
            "displayName": display_name.into(),
            "description": description.into()
        })
    }

    #[test]
    fn sdk_initialize_catalog_maps_account_models_in_returned_order() {
        let models = parse_claude_model_catalog(&model_catalog_response(expected_account_models()))
            .expect("valid SDK initialize model catalog");

        assert_eq!(
            models
                .iter()
                .map(|model| model.model_id.as_str())
                .collect::<Vec<_>>(),
            vec![
                "default",
                "opus[1m]",
                "claude-fable-5[1m]",
                "sonnet",
                "haiku"
            ]
        );
        assert_eq!(
            models
                .iter()
                .map(|model| model.label.as_str())
                .collect::<Vec<_>>(),
            vec![
                "Default (recommended) · Opus 4.8 with 1M context",
                "Opus · Opus 4.8 with 1M context",
                "Fable · Fable 5",
                "Sonnet · Sonnet 5",
                "Haiku · Haiku 4.5",
            ]
        );
        assert!(models
            .iter()
            .all(|model| model.provider_id == AgentProvider::Claude));
        assert_ne!(models[1].model_id, "claude-opus-4-8[1m]");
    }

    #[test]
    fn sdk_initialize_catalog_rejects_invalid_envelopes_and_models_atomically() {
        let valid_model =
            account_model("sonnet", "Sonnet", "Sonnet 5 · Efficient for routine tasks");
        let invalid_cases = [
            ("malformed", b"not-json".to_vec()),
            (
                "wrong request id",
                serde_json::to_vec(&json!({
                    "type": "control_response",
                    "response": {
                        "subtype": "success",
                        "request_id": "different-request",
                        "response": { "models": [valid_model.clone()] }
                    }
                }))
                .unwrap(),
            ),
            (
                "error response",
                serde_json::to_vec(&json!({
                    "type": "control_response",
                    "response": {
                        "subtype": "error",
                        "request_id": CLAUDE_MODEL_CATALOG_REQUEST_ID,
                        "error": "ANTHROPIC_API_KEY=must-not-echo"
                    }
                }))
                .unwrap(),
            ),
            ("empty catalog", model_catalog_response(json!([]))),
            (
                "blank id",
                model_catalog_response(json!([account_model("  ", "Sonnet", "Sonnet 5")])),
            ),
            (
                "control id",
                model_catalog_response(json!([account_model("son\u{0}net", "Sonnet", "Sonnet 5")])),
            ),
            (
                "leading and trailing control id",
                model_catalog_response(json!([account_model("\nsonnet\t", "Sonnet", "Sonnet 5")])),
            ),
            (
                "leading dash id",
                model_catalog_response(json!([account_model(" --help ", "Sonnet", "Sonnet 5")])),
            ),
            (
                "duplicate trimmed id",
                model_catalog_response(json!([
                    valid_model.clone(),
                    account_model(" sonnet ", "Sonnet duplicate", "Sonnet 5")
                ])),
            ),
            (
                "blank display label",
                model_catalog_response(json!([account_model("sonnet", "  ", "Sonnet 5")])),
            ),
            (
                "blank description label",
                model_catalog_response(json!([account_model("sonnet", "Sonnet", "  ")])),
            ),
            (
                "oversized id",
                model_catalog_response(json!([account_model(
                    "m".repeat(MAX_CLAUDE_MODEL_ID_BYTES + 1),
                    "Model",
                    "Model 1"
                )])),
            ),
            (
                "oversized final label",
                model_catalog_response(json!([account_model(
                    "model",
                    "L".repeat(MAX_CLAUDE_MODEL_LABEL_BYTES),
                    "Version"
                )])),
            ),
            (
                "excessive count",
                model_catalog_response(Value::Array(
                    (0..=MAX_CLAUDE_MODELS)
                        .map(|index| {
                            json!({
                                "value": format!("model-{index}"),
                                "displayName": format!("Model {index}"),
                                "description": format!("Version {index}")
                            })
                        })
                        .collect(),
                )),
            ),
        ];

        for (label, raw) in invalid_cases {
            let error = match parse_claude_model_catalog(&raw) {
                Ok(_) => panic!("{label} catalog should be rejected"),
                Err(error) => error,
            };
            assert!(
                !error.contains("must-not-echo"),
                "{label} leaked diagnostics"
            );
            assert!(
                !error.contains("ANTHROPIC_API_KEY"),
                "{label} leaked a key name"
            );
        }

        let oversized = vec![b' '; MAX_CLAUDE_MODEL_CATALOG_BYTES + 1];
        assert!(parse_claude_model_catalog(&oversized).is_err());
    }

    #[test]
    fn sdk_initialize_catalog_requires_one_whole_buffer_control_response() {
        let response =
            model_catalog_response(json!([account_model("sonnet", "Sonnet", "Sonnet 5")]));
        let extra_lines = [
            (
                "assistant",
                br#"{"type":"assistant","message":{"content":[]}}"#.as_slice(),
            ),
            (
                "result",
                br#"{"type":"result","subtype":"success","is_error":false}"#.as_slice(),
            ),
            ("malformed", b"not-json".as_slice()),
        ];

        for (label, extra_line) in extra_lines {
            let mut raw = response.clone();
            raw.push(b'\n');
            raw.extend_from_slice(extra_line);
            assert!(
                parse_claude_model_catalog(&raw).is_err(),
                "{label} line after a valid response must fail closed"
            );
        }

        let mut duplicate = response.clone();
        duplicate.push(b'\n');
        duplicate.extend_from_slice(&response);
        assert!(
            parse_claude_model_catalog(&duplicate).is_err(),
            "duplicate matching response must fail closed"
        );
    }

    #[test]
    fn catalog_initialize_request_serializes_the_single_request_id_constant() {
        let request = claude_model_catalog_initialize_request().unwrap();

        assert_eq!(
            request,
            br#"{"request_id":"gtum-claude-model-catalog-v1","type":"control_request","request":{"subtype":"initialize"}}
"#
        );
        let envelope: Value = serde_json::from_slice(&request).unwrap();
        assert_eq!(
            envelope.get("request_id").and_then(Value::as_str),
            Some(CLAUDE_MODEL_CATALOG_REQUEST_ID)
        );
    }

    #[test]
    fn catalog_argv_reuses_source_specific_isolation_without_request_surfaces() {
        let environment = ClaudeCredentialSelection {
            source: ClaudeCredentialSource::EnvironmentApiKey,
            sanitized_settings: None,
        };
        let helper = ClaudeCredentialSelection {
            source: ClaudeCredentialSource::ApiKeyHelper,
            sanitized_settings: Some(r#"{"apiKeyHelper":"safe-helper"}"#.into()),
        };

        let cli_session = claude_model_catalog_arguments(None);
        assert_eq!(
            cli_session,
            [
                "--safe-mode",
                "--setting-sources",
                "",
                "--strict-mcp-config",
                "--disable-slash-commands",
                "--no-chrome",
                "--no-session-persistence",
                "--permission-mode",
                "dontAsk",
                "--tools",
                "",
                "--output-format",
                "stream-json",
                "--verbose",
                "--input-format",
                "stream-json",
            ]
            .into_iter()
            .map(OsString::from)
            .collect::<Vec<_>>()
        );
        assert_eq!(
            claude_model_catalog_arguments(Some(&environment)),
            [
                "--bare",
                "--safe-mode",
                "--strict-mcp-config",
                "--disable-slash-commands",
                "--no-chrome",
                "--no-session-persistence",
                "--permission-mode",
                "dontAsk",
                "--tools",
                "",
                "--output-format",
                "stream-json",
                "--verbose",
                "--input-format",
                "stream-json",
            ]
            .into_iter()
            .map(OsString::from)
            .collect::<Vec<_>>()
        );
        let mut expected_helper = claude_model_catalog_arguments(Some(&environment));
        expected_helper.extend([
            OsString::from("--settings"),
            OsString::from(r#"{"apiKeyHelper":"safe-helper"}"#),
        ]);
        assert_eq!(
            claude_model_catalog_arguments(Some(&helper)),
            expected_helper
        );

        for arguments in [
            cli_session,
            claude_model_catalog_arguments(Some(&environment)),
            claude_model_catalog_arguments(Some(&helper)),
        ] {
            for forbidden in [
                "--print",
                "--model",
                "--resume",
                "--continue",
                "--allowedTools",
                "--mcp-config",
                "--file",
                "--add-dir",
                "--session-id",
            ] {
                assert!(
                    !arguments
                        .iter()
                        .any(|argument| argument == OsStr::new(forbidden)),
                    "catalog argv unexpectedly contains {forbidden}"
                );
            }
        }
    }

    #[test]
    fn catalog_discovery_writes_one_initialize_request_then_eof() {
        let root = TestRoot::new("model-catalog-wire");
        let program = compile_catalog_test_executable(&root, "fake-claude");
        fs::write(root.path().join("mode"), "success").unwrap();
        fs::write(
            root.path().join("response"),
            model_catalog_response(expected_account_models()),
        )
        .unwrap();
        let context = invocation_context(None);

        let models =
            discover_claude_model_catalog_with(&program, &context, Duration::from_secs(2)).unwrap();

        assert_eq!(models.len(), 5);
        let recorded_arguments = fs::read_to_string(root.path().join("argv"))
            .unwrap()
            .split_terminator('\n')
            .map(str::to_owned)
            .collect::<Vec<_>>();
        assert_eq!(
            recorded_arguments,
            claude_model_catalog_arguments(context.credential())
                .into_iter()
                .map(|argument| argument.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
        );
        assert_eq!(
            fs::read(root.path().join("stdin")).unwrap(),
            claude_model_catalog_initialize_request().unwrap()
        );
    }

    #[test]
    fn catalog_discovery_rejects_nonzero_timeout_spawn_and_oversized_output() {
        let root = TestRoot::new("model-catalog-failures");
        let context = invocation_context(None);
        let valid_response = model_catalog_response(json!([{
            "value": "sonnet",
            "displayName": "Sonnet",
            "description": "Sonnet 5"
        }]));
        let program = compile_catalog_test_executable(&root, "fake-claude");
        fs::write(root.path().join("response"), valid_response).unwrap();

        fs::write(root.path().join("mode"), "nonzero").unwrap();
        assert!(
            discover_claude_model_catalog_with(&program, &context, Duration::from_secs(2)).is_err()
        );

        fs::write(root.path().join("mode"), "timeout").unwrap();
        assert!(
            discover_claude_model_catalog_with(&program, &context, Duration::from_millis(20))
                .is_err()
        );

        let missing = root.path().join(if cfg!(windows) {
            "missing.exe"
        } else {
            "missing"
        });
        assert!(
            discover_claude_model_catalog_with(&missing, &context, Duration::from_secs(2)).is_err()
        );

        fs::write(root.path().join("mode"), "oversized").unwrap();
        assert!(
            discover_claude_model_catalog_with(&program, &context, Duration::from_secs(2)).is_err()
        );
    }

    #[test]
    fn request_argv_is_exact_inert_surface_with_optional_sanitized_helper_only() {
        let environment = ClaudeCredentialSelection {
            source: ClaudeCredentialSource::EnvironmentApiKey,
            sanitized_settings: None,
        };
        let schema = claude_suggestion_schema().unwrap();
        let expected = [
            "--bare",
            "--safe-mode",
            "--strict-mcp-config",
            "--disable-slash-commands",
            "--no-chrome",
            "--no-session-persistence",
            "--permission-mode",
            "dontAsk",
            "--tools",
            "",
            "--print",
            "--output-format",
            "json",
            "--json-schema",
            schema.as_str(),
        ]
        .into_iter()
        .map(OsString::from)
        .collect::<Vec<_>>();
        assert_eq!(
            claude_request_arguments(Some(&environment), &schema),
            expected
        );

        let helper = ClaudeCredentialSelection {
            source: ClaudeCredentialSource::ApiKeyHelper,
            sanitized_settings: Some(r#"{"apiKeyHelper":"safe-helper"}"#.into()),
        };
        let mut expected_helper = expected;
        expected_helper.extend([
            OsString::from("--settings"),
            OsString::from(r#"{"apiKeyHelper":"safe-helper"}"#),
        ]);
        let helper_arguments = claude_request_arguments(Some(&helper), &schema);
        assert_eq!(helper_arguments, expected_helper);

        let rendered = helper_arguments
            .iter()
            .map(|value| value.to_string_lossy())
            .collect::<Vec<_>>()
            .join(" ");
        for forbidden in [
            "--file",
            "--add-dir",
            "--mcp-config",
            "--chrome",
            "--resume",
            "--session-id",
        ] {
            assert!(!rendered.contains(forbidden), "unexpected {forbidden}");
        }
    }

    #[test]
    fn selected_model_is_a_single_validated_cli_argument() {
        let credential = ClaudeCredentialSelection {
            source: ClaudeCredentialSource::EnvironmentApiKey,
            sanitized_settings: None,
        };
        let schema = claude_suggestion_schema().unwrap();
        let base_arguments = [
            "--bare",
            "--safe-mode",
            "--strict-mcp-config",
            "--disable-slash-commands",
            "--no-chrome",
            "--no-session-persistence",
            "--permission-mode",
            "dontAsk",
            "--tools",
            "",
            "--print",
            "--output-format",
            "json",
            "--json-schema",
            schema.as_str(),
        ]
        .into_iter()
        .map(OsString::from)
        .collect::<Vec<_>>();
        assert_eq!(
            claude_request_arguments_for_model(Some(&credential), &schema, None).unwrap(),
            base_arguments
        );

        let mut expected_opus_arguments = base_arguments.clone();
        expected_opus_arguments.extend([OsString::from("--model"), OsString::from("opus")]);
        let opus_arguments =
            claude_request_arguments_for_model(Some(&credential), &schema, Some("opus")).unwrap();
        assert_eq!(opus_arguments, expected_opus_arguments);
        assert_eq!(
            opus_arguments
                .iter()
                .filter(|argument| *argument == OsStr::new("--model"))
                .count(),
            1
        );

        let mut expected_default_arguments = base_arguments.clone();
        expected_default_arguments.extend([OsString::from("--model"), OsString::from("default")]);
        assert_eq!(
            claude_request_arguments_for_model(Some(&credential), &schema, Some("default"))
                .unwrap(),
            expected_default_arguments
        );
        assert_eq!(
            claude_request_arguments_for_model(Some(&credential), &schema, Some("  opus  "))
                .unwrap(),
            expected_opus_arguments
        );
    }

    #[cfg(unix)]
    #[test]
    fn invalid_models_are_rejected_before_child_spawn() {
        let root = TestRoot::new("invalid-model-spawn");
        let project = root.path().join("project");
        fs::create_dir_all(&project).unwrap();
        let program = root.path().join("fake-claude");
        let spawned = PathBuf::from(format!("{}.spawned", program.display()));
        write_test_executable(
            &program,
            concat!(
                "printf ran > \"$0.spawned\"\n",
                "/bin/cat >/dev/null\n",
                "printf '%s' '{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"structured_output\":{\"provider\":\"claude\",\"schemaVersion\":1,\"summary\":\"Unexpected spawn\",\"command\":\"\",\"preferredTarget\":\"current_tab\",\"confidence\":\"high\",\"error\":null}}'\n",
            ),
        );
        let credential = ClaudeCredentialSelection {
            source: ClaudeCredentialSource::EnvironmentApiKey,
            sanitized_settings: None,
        };
        let context = invocation_context(Some(credential));

        for (kind, model) in [
            ("blank", "   "),
            ("Codex", "gpt-5.2-codex"),
            ("version-specific", "claude-opus-4-1-20250805"),
            ("leading-dash", "--help"),
            ("unknown", "fable"),
        ] {
            let mut request = claude_request(&project);
            request.model = Some(model.into());
            let result = request_claude_suggestions_with(
                &program,
                &context,
                request,
                Duration::from_secs(2),
            );

            assert!(
                result.is_err(),
                "{kind} model reached the fake child: {}",
                spawned.exists()
            );
            assert!(!spawned.exists(), "{kind} model spawned the fake child");
        }
    }

    #[test]
    fn cli_session_status_argv_is_an_exact_allowlist_without_expansion() {
        let status_arguments = claude_status_arguments(None);
        assert_eq!(
            status_arguments,
            [
                "--safe-mode",
                "--setting-sources",
                "",
                "auth",
                "status",
                "--json",
            ]
            .into_iter()
            .map(OsString::from)
            .collect::<Vec<_>>()
        );
        assert_no_argument_expansion(&status_arguments);
    }

    #[test]
    fn request_prompt_carries_the_captured_origin_owner_without_terminal_mutation() {
        let request = claude_request(Path::new("/workspace/gtum"));
        let prompt = build_claude_prompt(&request).unwrap();

        assert!(prompt.contains("Origin project path: /workspace/gtum"));
        assert!(prompt.contains("Origin Agent session id: agent-session-origin-7"));
        assert!(prompt.contains("Provider: Claude"));
        assert!(prompt.contains("Review the Claude adapter"));
        assert!(prompt.contains("must not execute commands or mutate a terminal"));
    }

    #[test]
    fn child_environment_strips_oauth_auth_and_third_party_modes() {
        let root = TestRoot::new("explicit-context-config");
        let approved_config = root.path().join("approved-config");
        fs::create_dir_all(&approved_config).unwrap();
        let approved_config = fs::canonicalize(approved_config).unwrap();
        let removed = [
            "CLAUDE_CODE_OAUTH_TOKEN",
            "CLAUDE_CODE_OAUTH_REFRESH_TOKEN",
            "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST",
            "CLAUDE_CONFIG_DIR",
            "ANTHROPIC_AUTH_TOKEN",
            "ANTHROPIC_CUSTOM_HEADERS",
            "CLAUDE_CODE_USE_BEDROCK",
            "CLAUDE_CODE_USE_VERTEX",
            "CLAUDE_CODE_USE_FOUNDRY",
            "CLAUDE_CODE_USE_ANTHROPIC_AWS",
            "CLAUDE_CODE_USE_MANTLE",
            "ANTHROPIC_BEDROCK_BASE_URL",
            "ANTHROPIC_BEDROCK_MANTLE_BASE_URL",
            "AWS_BEARER_TOKEN_BEDROCK",
            "ANTHROPIC_AWS_API_KEY",
            "ANTHROPIC_AWS_BASE_URL",
            "ANTHROPIC_AWS_WORKSPACE_ID",
            "ANTHROPIC_VERTEX_PROJECT_ID",
            "ANTHROPIC_VERTEX_BASE_URL",
            "CLOUD_ML_REGION",
            "ANTHROPIC_FOUNDRY_RESOURCE",
            "ANTHROPIC_FOUNDRY_API_KEY",
            "ANTHROPIC_FOUNDRY_AUTH_TOKEN",
            "ANTHROPIC_FOUNDRY_BASE_URL",
            "ANTHROPIC_BASE_URL",
        ];
        let helper = ClaudeCredentialSelection {
            source: ClaudeCredentialSource::ApiKeyHelper,
            sanitized_settings: Some(r#"{"apiKeyHelper":"safe-helper"}"#.into()),
        };
        let mut helper_command = Command::new("claude");
        for key in removed.into_iter().chain(["ANTHROPIC_API_KEY"]) {
            helper_command.env(key, format!("secret-{key}"));
        }
        let helper_context =
            ClaudeInvocationContext::new(Some(helper), Some(approved_config.clone()));
        assert_eq!(helper_context.cli_session_config_dir(), None);
        configure_claude_child_environment(&mut helper_command, &helper_context);
        let helper_environment = helper_command
            .get_envs()
            .map(|(key, value)| (key.to_string_lossy().into_owned(), value.is_some()))
            .collect::<std::collections::HashMap<_, _>>();
        for key in removed.into_iter().chain(["ANTHROPIC_API_KEY"]) {
            assert_eq!(helper_environment.get(key), Some(&false), "kept {key}");
        }

        let environment = ClaudeCredentialSelection {
            source: ClaudeCredentialSource::EnvironmentApiKey,
            sanitized_settings: None,
        };
        let mut environment_command = Command::new("claude");
        environment_command.env("ANTHROPIC_API_KEY", "approved-first-party-key");
        for key in removed {
            environment_command.env(key, format!("secret-{key}"));
        }
        let environment_context =
            ClaudeInvocationContext::new(Some(environment), Some(approved_config));
        assert_eq!(environment_context.cli_session_config_dir(), None);
        configure_claude_child_environment(&mut environment_command, &environment_context);
        let environment_entries = environment_command
            .get_envs()
            .map(|(key, value)| {
                (
                    key.to_string_lossy().into_owned(),
                    value.map(|v| v.to_owned()),
                )
            })
            .collect::<std::collections::HashMap<_, _>>();
        assert_eq!(
            environment_entries["ANTHROPIC_API_KEY"].as_deref(),
            Some(std::ffi::OsStr::new("approved-first-party-key"))
        );
        for key in removed {
            assert_eq!(environment_entries.get(key), Some(&None), "kept {key}");
        }
    }

    #[test]
    fn child_environment_strips_debug_telemetry_and_external_process_controls() {
        const CHILD: &str = "GTUM_CLAUDE_BEHAVIOR_ENV_CHILD";
        const TEST_NAME: &str = concat!(
            "runtime::claude::tests::",
            "child_environment_strips_debug_telemetry_and_external_process_controls"
        );
        let controls = [
            "DEBUG",
            "CLAUDE_CODE_DEBUG_LOGS_DIR",
            "CLAUDE_CODE_DEBUG_LOG_LEVEL",
            "CLAUDE_CODE_EXTRA_BODY",
            "CLAUDE_CODE_FORCE_SESSION_PERSISTENCE",
            "CLAUDE_CODE_ENABLE_TELEMETRY",
            "CLAUDE_CODE_ENHANCED_TELEMETRY_BETA",
            "ENABLE_ENHANCED_TELEMETRY_BETA",
            "ENABLE_BETA_TRACING_DETAILED",
            "BETA_TRACING_ENDPOINT",
            "TRACEPARENT",
            "TRACESTATE",
            "CLAUDE_CODE_PROCESS_WRAPPER",
            "CLAUDE_CODE_SHELL_PREFIX",
            "CLAUDE_CODE_AUTO_CONNECT_IDE",
            "CLAUDE_CODE_PACKAGE_MANAGER_AUTO_UPDATE",
            "CLAUDE_CODE_SYNC_PLUGIN_INSTALL",
            "CLAUDE_CODE_SYNC_PLUGIN_INSTALL_TIMEOUT_MS",
            "CLAUDE_CODE_SYNC_SKILLS",
            "CLAUDE_CODE_SYNC_SKILLS_INSTALL_TIMEOUT_MS",
            "CLAUDE_CODE_SYNC_SKILLS_WAIT_TIMEOUT_MS",
            "CLAUDE_CODE_ENABLE_BACKGROUND_PLUGIN_REFRESH",
            "CLAUDE_CODE_ENABLE_FEEDBACK_SURVEY_FOR_OTEL",
            "CLAUDE_CODE_OTEL_HEADERS_HELPER",
            "CLAUDE_CODE_OTEL_HEADERS_HELPER_DEBOUNCE_MS",
            "OTEL_EXPORTER_OTLP_ENDPOINT",
            "OTEL_EXPORTER_OTLP_HEADERS",
            "OTEL_LOG_RAW_API_BODIES",
        ];
        let future_controls = ["CLAUDE_CODE_OTEL_FUTURE_CONTROL", "OTEL_FUTURE_EXPORTER"];
        let forced_controls = [
            ("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1"),
            ("CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL", "1"),
        ];

        if std::env::var_os(CHILD).is_none() {
            let environment = controls
                .into_iter()
                .chain(future_controls)
                .map(|key| (OsString::from(key), OsString::from("must-not-survive")))
                .chain(
                    forced_controls
                        .into_iter()
                        .map(|(key, _)| (OsString::from(key), OsString::from("0"))),
                )
                .chain([(OsString::from(CHILD), OsString::from("1"))]);
            assert_isolated_test_succeeded(
                run_isolated_test(TEST_NAME, environment),
                "Claude behavior-control environment",
            );
            return;
        }

        let mut command = Command::new("claude");
        for key in controls {
            command.env(key, "must-not-survive");
        }
        for (key, _) in forced_controls {
            command.env(key, "0");
        }
        configure_claude_child_environment(&mut command, &invocation_context(None));
        let environment = command
            .get_envs()
            .map(|(key, value)| {
                (
                    key.to_string_lossy().into_owned(),
                    value.map(OsStr::to_os_string),
                )
            })
            .collect::<std::collections::HashMap<_, _>>();

        for key in controls.into_iter().chain(future_controls) {
            assert_eq!(environment.get(key), Some(&None), "kept {key}");
        }
        for (key, expected) in forced_controls {
            assert_eq!(
                environment.get(key).and_then(Option::as_deref),
                Some(OsStr::new(expected)),
                "did not force {key}"
            );
        }
    }

    #[test]
    fn cli_session_child_environment_strips_credentials_and_cloud_modes_but_keeps_home() {
        const CHILD: &str = "GTUM_CLAUDE_ENVIRONMENT_CHILD";
        const TEST_NAME: &str = concat!(
            "runtime::claude::tests::",
            "cli_session_child_environment_strips_credentials_and_cloud_modes_but_keeps_home"
        );
        if std::env::var_os(CHILD).is_none() {
            assert_isolated_test_succeeded(
                run_isolated_test(TEST_NAME, [(OsString::from(CHILD), OsString::from("1"))]),
                "CLI-session environment",
            );
            return;
        }

        let root = TestRoot::new("cli-session-environment");
        let home = root.path().join("user home");
        fs::create_dir_all(&home).unwrap();
        let home = fs::canonicalize(home).unwrap();
        let home_key = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
        std::env::set_var(home_key, &home);
        std::env::set_var("CLAUDE_CONFIG_DIR", "relative-config-must-not-survive");

        let removed = [
            "ANTHROPIC_API_KEY",
            "ANTHROPIC_AUTH_TOKEN",
            "CLAUDE_CODE_OAUTH_TOKEN",
            "CLAUDE_CODE_OAUTH_REFRESH_TOKEN",
            "CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST",
            "ANTHROPIC_CUSTOM_HEADERS",
            "ANTHROPIC_BASE_URL",
            "CLAUDE_CODE_USE_BEDROCK",
            "CLAUDE_CODE_USE_VERTEX",
            "CLAUDE_CODE_USE_FOUNDRY",
            "CLAUDE_CODE_USE_ANTHROPIC_AWS",
            "CLAUDE_CODE_USE_MANTLE",
            "ANTHROPIC_BEDROCK_BASE_URL",
            "ANTHROPIC_BEDROCK_MANTLE_BASE_URL",
            "AWS_BEARER_TOKEN_BEDROCK",
            "ANTHROPIC_AWS_API_KEY",
            "ANTHROPIC_AWS_BASE_URL",
            "ANTHROPIC_AWS_WORKSPACE_ID",
            "ANTHROPIC_VERTEX_PROJECT_ID",
            "ANTHROPIC_VERTEX_BASE_URL",
            "CLOUD_ML_REGION",
            "ANTHROPIC_FOUNDRY_RESOURCE",
            "ANTHROPIC_FOUNDRY_API_KEY",
            "ANTHROPIC_FOUNDRY_AUTH_TOKEN",
            "ANTHROPIC_FOUNDRY_BASE_URL",
        ];
        let mut command = Command::new("claude");
        command.env(home_key, &home);
        command.env("CLAUDE_CONFIG_DIR", "relative-config-must-not-survive");
        for key in removed {
            command.env(key, format!("must-be-removed-{key}"));
        }

        let context = invocation_context(None);
        configure_claude_child_environment(&mut command, &context);

        let environment = command
            .get_envs()
            .map(|(key, value)| {
                (
                    key.to_string_lossy().into_owned(),
                    value.map(OsStr::to_os_string),
                )
            })
            .collect::<std::collections::HashMap<_, _>>();
        for key in removed.into_iter().chain(["CLAUDE_CONFIG_DIR"]) {
            assert_eq!(environment.get(key), Some(&None), "kept {key}");
        }
        assert_eq!(
            environment.get(home_key).and_then(Option::as_deref),
            Some(home.as_os_str())
        );
    }

    #[test]
    fn strict_result_parser_accepts_only_claude_schema_one_success() {
        let raw = br#"{
          "type":"result",
          "subtype":"success",
          "is_error":false,
          "result":"ignored natural-language copy",
          "structured_output":{
            "provider":"claude",
            "schemaVersion":1,
            "summary":" Inspect the adapter ",
            "command":" cargo test ",
            "preferredTarget":"new_tab",
            "confidence":"high",
            "error":null
          }
        }"#;

        let response = parse_claude_result(raw).unwrap();
        assert_eq!(response.provider, AgentProvider::Claude);
        assert_eq!(response.summary, "Inspect the adapter");
        assert_eq!(response.command, "cargo test");
        assert_eq!(
            response.preferred_target,
            crate::runtime::codex::AgentExecutionTarget::NewTab
        );
        assert_eq!(
            response.confidence,
            crate::runtime::codex::AgentSuggestionConfidence::High
        );
        assert_eq!(response.error, None);
        assert!(response.id.starts_with("claude-"));
    }

    #[test]
    fn strict_result_parser_rejects_bad_envelopes_and_never_echoes_auth_data() {
        let structured = r#"{"provider":"claude","schemaVersion":1,"summary":"ok","command":"","preferredTarget":"current_tab","confidence":"medium","error":null}"#;
        let cases = [
            format!(r#"{{"type":"assistant","subtype":"success","is_error":false,"structured_output":{structured}}}"#),
            format!(r#"{{"type":"result","subtype":"error","is_error":false,"structured_output":{structured}}}"#),
            format!(r#"{{"type":"result","subtype":"success","is_error":true,"structured_output":{structured}}}"#),
            r#"{"type":"result","subtype":"success","is_error":false}"#.into(),
            r#"{"type":"result","subtype":"success","is_error":false,"structured_output":{}}"#.into(),
            r#"{"type":"result","subtype":"success","is_error":false,"structured_output":{"provider":"codex","schemaVersion":1,"summary":"ok","command":"","preferredTarget":"current_tab","confidence":"medium","error":null}}"#.into(),
            r#"{"type":"result","subtype":"success","is_error":false,"structured_output":{"provider":"claude","schemaVersion":2,"summary":"ok","command":"","preferredTarget":"current_tab","confidence":"medium","error":null}}"#.into(),
            r#"{"type":"result","subtype":"success","is_error":false,"structured_output":{"provider":"claude","schemaVersion":1,"summary":"","command":"","preferredTarget":"current_tab","confidence":"medium","error":null}}"#.into(),
            r#"{"type":"result","subtype":"success","is_error":false,"result":"ANTHROPIC_API_KEY=sk-ant-auth-secret","structured_output":null}"#.into(),
            "not-json sk-ant-auth-secret".into(),
        ];

        for raw in cases {
            let error = match parse_claude_result(raw.as_bytes()) {
                Ok(_) => panic!("invalid Claude result should be rejected"),
                Err(error) => error,
            };
            assert!(!error.contains("sk-ant-auth-secret"));
            assert!(!error.contains("ANTHROPIC_API_KEY"));
        }

        let oversized = vec![b' '; MAX_CLAUDE_REQUEST_BYTES + 1];
        assert!(parse_claude_result(&oversized).is_err());
    }

    #[test]
    fn capabilities_expose_only_a_valid_live_catalog_and_fail_closed() {
        let models =
            parse_claude_model_catalog(&model_catalog_response(expected_account_models())).unwrap();
        let available = claude_capabilities(Some(models));
        assert_eq!(available.provider, AgentProvider::Claude);
        assert!(available.supports_model_selection);
        assert_eq!(available.available_models.len(), 5);
        assert_eq!(
            available.current_model.as_ref().unwrap().model_id,
            "default"
        );
        assert!(available.reasoning_levels.is_empty());
        assert_eq!(available.default_reasoning_level, None);
        assert!(!available.supports_fast_mode);
        assert_eq!(available.attachments.len(), 4);
        assert!(available
            .attachments
            .iter()
            .all(|attachment| !attachment.enabled && attachment.invocation_flag.is_none()));

        let without_default = claude_capabilities(Some(vec![AgentModelCapability {
            provider_id: AgentProvider::Claude,
            model_id: "sonnet".into(),
            label: "Sonnet · Sonnet 5".into(),
        }]));
        assert!(without_default.supports_model_selection);
        assert!(without_default.current_model.is_none());

        for unavailable in [claude_capabilities(None), claude_capabilities(Some(vec![]))] {
            assert!(!unavailable.supports_model_selection);
            assert!(unavailable.current_model.is_none());
            assert!(unavailable.available_models.is_empty());
        }
    }

    #[cfg(unix)]
    #[test]
    fn request_execution_uses_exact_argv_stdin_and_canonical_project_cwd() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!(
            "gtum-claude-request-{}-{}",
            std::process::id(),
            unix_timestamp_ms()
        ));
        let project = root.join("project");
        fs::create_dir_all(&project).unwrap();
        let program = root.join("fake-claude.sh");
        fs::write(
            &program,
            concat!(
                "#!/bin/sh\n",
                "printf '%s\\n' \"$@\" > \"$0.argv\"\n",
                "cat > \"$0.stdin\"\n",
                "pwd > \"$0.cwd\"\n",
                "printf '%s' '{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"structured_output\":{\"provider\":\"claude\",\"schemaVersion\":1,\"summary\":\"Captured\",\"command\":\"\",\"preferredTarget\":\"current_tab\",\"confidence\":\"high\",\"error\":null}}'\n",
            ),
        )
        .unwrap();
        let mut permissions = fs::metadata(&program).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&program, permissions).unwrap();
        let credential = ClaudeCredentialSelection {
            source: ClaudeCredentialSource::EnvironmentApiKey,
            sanitized_settings: None,
        };
        let schema = claude_suggestion_schema().unwrap();
        let context = invocation_context(Some(credential.clone()));

        let suggestions = request_claude_suggestions_with(
            &program,
            &context,
            claude_request(&project),
            Duration::from_secs(2),
        )
        .unwrap();

        assert_eq!(suggestions.len(), 1);
        assert_eq!(suggestions[0].provider, AgentProvider::Claude);
        let expected_arguments = claude_request_arguments(Some(&credential), &schema)
            .into_iter()
            .map(|value| value.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        let recorded_arguments = fs::read_to_string(format!("{}.argv", program.display()))
            .unwrap()
            .split_terminator('\n')
            .map(str::to_owned)
            .collect::<Vec<_>>();
        assert_eq!(recorded_arguments, expected_arguments);
        let recorded_stdin = fs::read_to_string(format!("{}.stdin", program.display())).unwrap();
        let canonical_project = fs::canonicalize(&project).unwrap();
        let mut expected_request = claude_request(&project);
        expected_request.project_path = canonical_project.to_string_lossy().into_owned();
        assert_eq!(
            recorded_stdin,
            build_claude_prompt(&expected_request).unwrap()
        );
        let recorded_cwd = fs::read_to_string(format!("{}.cwd", program.display())).unwrap();
        assert_eq!(PathBuf::from(recorded_cwd.trim()), canonical_project);

        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn request_execution_rejects_nonzero_and_timeout_without_secret_echo() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!(
            "gtum-claude-request-failure-{}-{}",
            std::process::id(),
            unix_timestamp_ms()
        ));
        let project = root.join("project");
        fs::create_dir_all(&project).unwrap();
        let make_program = |name: &str, body: &str| {
            let program = root.join(name);
            fs::write(&program, format!("#!/bin/sh\n{body}\n")).unwrap();
            let mut permissions = fs::metadata(&program).unwrap().permissions();
            permissions.set_mode(0o700);
            fs::set_permissions(&program, permissions).unwrap();
            program
        };
        let credential = ClaudeCredentialSelection {
            source: ClaudeCredentialSource::EnvironmentApiKey,
            sanitized_settings: None,
        };
        let context = invocation_context(Some(credential));

        let failed = make_program(
            "failed.sh",
            "cat >/dev/null; printf '%s' 'ANTHROPIC_API_KEY=sk-ant-request-secret' >&2; exit 8",
        );
        let failure = match request_claude_suggestions_with(
            &failed,
            &context,
            claude_request(&project),
            Duration::from_secs(1),
        ) {
            Ok(_) => panic!("non-zero Claude request should fail"),
            Err(error) => error,
        };
        assert!(!failure.contains("sk-ant-request-secret"));
        assert!(!failure.contains("ANTHROPIC_API_KEY"));

        let slow = make_program("slow.sh", "cat >/dev/null; sleep 2");
        let started = Instant::now();
        let timeout = match request_claude_suggestions_with(
            &slow,
            &context,
            claude_request(&project),
            Duration::from_millis(50),
        ) {
            Ok(_) => panic!("timed out Claude request should fail"),
            Err(error) => error,
        };
        assert!(started.elapsed() < Duration::from_secs(1));
        assert!(timeout.to_lowercase().contains("timed out"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn discovers_path_user_local_homebrew_and_windows_user_local_candidates() {
        let path_dirs = vec![PathBuf::from("/custom/bin"), PathBuf::from("/second/bin")];
        let home = Path::new("/users/dev");

        let unix = claude_executable_candidates(&path_dirs, Some(home), None, ClaudePlatform::Unix);
        assert_eq!(
            unix,
            vec![
                PathBuf::from("/custom/bin/claude"),
                PathBuf::from("/second/bin/claude"),
                PathBuf::from("/users/dev/.local/bin/claude"),
                PathBuf::from("/opt/homebrew/bin/claude"),
                PathBuf::from("/usr/local/bin/claude"),
            ]
        );

        let windows = claude_executable_candidates(
            &[PathBuf::from(r"C:\tools")],
            Some(Path::new(r"C:\Users\dev")),
            Some(Path::new(r"C:\Users\dev\AppData\Local")),
            ClaudePlatform::Windows,
        );
        assert_eq!(
            windows,
            vec![
                PathBuf::from(r"C:\tools").join("claude.exe"),
                PathBuf::from(r"C:\Users\dev").join(".local/bin/claude.exe"),
                PathBuf::from(r"C:\Users\dev\AppData\Local").join("Programs/Claude/claude.exe"),
            ]
        );
    }

    #[test]
    fn child_path_discards_relative_empty_and_duplicate_components() {
        let first = fs::canonicalize(std::env::current_dir().unwrap()).unwrap();
        let second = fs::canonicalize(std::env::temp_dir()).unwrap();
        let raw = env::join_paths([
            first.clone(),
            PathBuf::new(),
            PathBuf::from("."),
            PathBuf::from("relative-bin"),
            second.clone(),
            first.clone(),
        ])
        .unwrap();

        let sanitized = sanitized_claude_path(Some(&raw)).unwrap();
        let actual = env::split_paths(&sanitized).collect::<Vec<_>>();
        let mut expected = vec![first];
        if !expected.contains(&second) {
            expected.push(second);
        }
        assert_eq!(actual, expected);
        assert!(actual.iter().all(|directory| directory.is_absolute()));

        let relative_only =
            env::join_paths([PathBuf::new(), PathBuf::from("."), PathBuf::from("bin")]).unwrap();
        assert_eq!(sanitized_claude_path(Some(&relative_only)), None);
        assert_eq!(sanitized_claude_path(None), None);
    }

    #[test]
    fn windows_canonical_helper_paths_drop_only_supported_extended_prefixes() {
        assert_eq!(
            normalize_windows_canonical_helper_path(r"\\?\C:\Users\dev\helper.exe"),
            Some(r"C:\Users\dev\helper.exe".into())
        );
        assert_eq!(
            normalize_windows_canonical_helper_path(r"\\?\UNC\server\share\claude-helper.exe"),
            None
        );
        assert_eq!(
            normalize_windows_canonical_helper_path(r"C:\tools\helper.exe"),
            Some(r"C:\tools\helper.exe".into())
        );
        assert_eq!(
            normalize_windows_canonical_helper_path(r"\\?\Volume{private}\helper.exe"),
            None
        );
    }

    #[cfg(unix)]
    #[test]
    fn discovery_rejects_relative_or_non_executable_candidates_and_pins_absolute_binary() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!(
            "gtum-claude-discovery-{}-{}",
            std::process::id(),
            unix_timestamp_ms()
        ));
        let project = root.join("project");
        fs::create_dir_all(&project).unwrap();
        let project_binary = project.join("claude");
        fs::write(&project_binary, "#!/bin/sh\nprintf malicious").unwrap();
        let mut executable_permissions = fs::metadata(&project_binary).unwrap().permissions();
        executable_permissions.set_mode(0o700);
        fs::set_permissions(&project_binary, executable_permissions.clone()).unwrap();

        let non_executable = root.join("non-executable-claude");
        fs::write(&non_executable, "#!/bin/sh\nprintf non-executable").unwrap();
        let mut non_executable_permissions = fs::metadata(&non_executable).unwrap().permissions();
        non_executable_permissions.set_mode(0o600);
        fs::set_permissions(&non_executable, non_executable_permissions).unwrap();

        let safe_binary = root.join("safe-claude");
        fs::write(&safe_binary, "#!/bin/sh\nprintf safe").unwrap();
        fs::set_permissions(&safe_binary, executable_permissions).unwrap();

        assert_eq!(select_claude_executable(&[PathBuf::from("claude")]), None);
        let selected = select_claude_executable(&[
            PathBuf::from("claude"),
            non_executable,
            safe_binary.clone(),
        ])
        .expect("absolute executable candidate should be selected");
        assert!(selected.is_absolute());
        assert_eq!(selected, fs::canonicalize(&safe_binary).unwrap());
        let context = invocation_context(None);

        let output = run_bounded_process(
            &selected,
            &[],
            Some(&project),
            None,
            &context,
            ISOLATED_TEST_TIMEOUT,
            16,
            16,
        )
        .unwrap();
        assert_eq!(output.stdout, b"safe");

        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn sanitizes_user_settings_to_the_top_level_api_key_helper_only() {
        use std::os::unix::fs::PermissionsExt;

        let root = std::env::temp_dir().join(format!(
            "gtum-claude-helper-settings-{}-{}",
            std::process::id(),
            unix_timestamp_ms()
        ));
        fs::create_dir_all(&root).unwrap();
        let helper = root.join("load-anthropic-key");
        fs::write(&helper, "#!/bin/sh\nprintf key").unwrap();
        let mut permissions = fs::metadata(&helper).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&helper, permissions).unwrap();
        let canonical_helper = fs::canonicalize(&helper).unwrap();
        let raw = serde_json::to_vec(&json!({
            "apiKeyHelper": helper,
            "env": {"ANTHROPIC_API_KEY": "sk-ant-settings-secret"},
            "hooks": {"PreToolUse": [{"command": "leak-secret"}]},
            "plugins": {"dangerous": true},
            "mcpServers": {"filesystem": {"command": "node"}},
            "projects": {"/tmp/project": {"apiKeyHelper": "project-helper"}}
        }))
        .unwrap();

        let sanitized = sanitize_user_settings(&raw).unwrap().unwrap();

        assert_eq!(
            serde_json::from_str::<Value>(&sanitized).unwrap(),
            json!({"apiKeyHelper": canonical_helper})
        );
        for forbidden in [
            "sk-ant-settings-secret",
            "hooks",
            "plugins",
            "mcpServers",
            "projects",
            "project-helper",
        ] {
            assert!(!sanitized.contains(forbidden), "leaked {forbidden}");
        }

        let _ = fs::remove_dir_all(root);
    }

    #[cfg(unix)]
    #[test]
    fn api_key_helper_rejects_unsafe_raw_and_canonical_executable_paths() {
        use std::os::unix::{fs::symlink, fs::PermissionsExt};

        let root = std::env::temp_dir().join(format!(
            "gtum-claude-helper-canonical-{}-{}",
            std::process::id(),
            unix_timestamp_ms()
        ));
        fs::create_dir_all(&root).unwrap();
        let make_executable = |name: &str| {
            let path = root.join(name);
            fs::write(&path, "#!/bin/sh\nprintf key").unwrap();
            let mut permissions = fs::metadata(&path).unwrap().permissions();
            permissions.set_mode(0o700);
            fs::set_permissions(&path, permissions).unwrap();
            path
        };

        let safe_target = make_executable("safe-target");
        let safe_link = root.join("safe-link");
        symlink(&safe_target, &safe_link).unwrap();
        assert_eq!(
            canonical_api_key_helper(safe_link.to_str().unwrap()).unwrap(),
            fs::canonicalize(&safe_target)
                .unwrap()
                .to_string_lossy()
                .into_owned()
        );

        for unsafe_raw in [
            "relative-helper-secret",
            "./relative-helper-secret",
            "/bin/sh helper-secret",
            "/bin/sh;helper-secret",
            "/bin/sh\\helper-secret",
        ] {
            let error = canonical_api_key_helper(unsafe_raw).unwrap_err();
            assert!(!error.contains("helper-secret"));
        }

        let non_executable = root.join("non-executable");
        fs::write(&non_executable, "#!/bin/sh\nprintf key").unwrap();
        let mut permissions = fs::metadata(&non_executable).unwrap().permissions();
        permissions.set_mode(0o600);
        fs::set_permissions(&non_executable, permissions).unwrap();
        assert!(canonical_api_key_helper(non_executable.to_str().unwrap()).is_err());

        for (index, unsafe_name) in ["target with space", "target;command", "target\\escape"]
            .into_iter()
            .enumerate()
        {
            let unsafe_target = make_executable(unsafe_name);
            let link = root.join(format!("safe-link-{index}"));
            symlink(&unsafe_target, &link).unwrap();
            let error = canonical_api_key_helper(link.to_str().unwrap()).unwrap_err();
            assert!(!error.contains(unsafe_name));
        }

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn settings_fail_closed_without_echoing_malformed_or_oversized_contents() {
        let malformed_secret = br#"{"apiKeyHelper":"helper-secret""#;
        let malformed = sanitize_user_settings(malformed_secret).unwrap_err();
        assert!(!malformed.contains("helper-secret"));

        let oversized = vec![b'x'; MAX_CLAUDE_SETTINGS_BYTES + 1];
        let oversized_error = sanitize_user_settings(&oversized).unwrap_err();
        assert!(!oversized_error.contains(&"x".repeat(32)));

        assert_eq!(
            sanitize_user_settings(br#"{"apiKeyHelper":"   "}"#).unwrap(),
            None
        );
        assert_eq!(
            sanitize_user_settings(br#"{"nested":{"apiKeyHelper":"ignored"}}"#).unwrap(),
            None
        );
    }

    #[cfg(unix)]
    #[test]
    fn user_settings_reader_rejects_symlink_escape_and_non_file_paths() {
        use std::os::unix::fs::symlink;

        let root = TestRoot::new("settings-path-policy");
        let config = root.path().join("config");
        let outside = root.path().join("outside-settings.json");
        fs::create_dir_all(&config).unwrap();
        fs::write(&outside, br#"{"apiKeyHelper":"outside"}"#).unwrap();
        symlink(&outside, config.join("settings.json")).unwrap();

        let escaped = read_user_claude_settings(Some(&config)).unwrap_err();
        assert!(!escaped.contains("outside"));

        fs::remove_file(config.join("settings.json")).unwrap();
        fs::create_dir(config.join("settings.json")).unwrap();
        let non_file = read_user_claude_settings(Some(&config)).unwrap_err();
        assert!(non_file.to_lowercase().contains("not a file"));
    }

    #[cfg(unix)]
    #[test]
    fn user_settings_reader_keeps_the_opened_file_bounded_when_the_path_is_replaced() {
        const CHILD: &str = "GTUM_CLAUDE_SETTINGS_REPLACEMENT_CHILD";
        const TEST_NAME: &str = concat!(
            "runtime::claude::tests::",
            "user_settings_reader_keeps_the_opened_file_bounded_when_the_path_is_replaced"
        );
        if std::env::var_os(CHILD).is_none() {
            assert_isolated_test_succeeded(
                run_isolated_test(TEST_NAME, [(OsString::from(CHILD), OsString::from("1"))]),
                "bounded Claude settings replacement",
            );
            return;
        }

        let root = TestRoot::new("settings-replacement");
        let config = root.path().join("config");
        fs::create_dir_all(&config).unwrap();
        let settings = config.join("settings.json");
        let replacement = config.join("replacement.json");
        let original = br#"{"safe":true}"#.to_vec();
        fs::write(&settings, &original).unwrap();
        fs::write(&replacement, vec![b'x'; MAX_CLAUDE_SETTINGS_BYTES + 1]).unwrap();

        *CLAUDE_SETTINGS_AFTER_METADATA_HOOK.lock().unwrap() = Some(Box::new(move |path| {
            fs::rename(&replacement, path).unwrap()
        }));

        let read = read_user_claude_settings(Some(&config))
            .unwrap()
            .expect("settings should still be readable from the opened handle");
        assert_eq!(read.len(), original.len());
        assert_eq!(read, original);
    }

    #[cfg(unix)]
    #[test]
    fn user_settings_reader_rejects_same_inode_growth_after_metadata_without_echoing_content() {
        const CHILD: &str = "GTUM_CLAUDE_SETTINGS_GROWTH_CHILD";
        const TEST_NAME: &str = concat!(
            "runtime::claude::tests::",
            "user_settings_reader_rejects_same_inode_growth_after_metadata_without_echoing_content"
        );
        if std::env::var_os(CHILD).is_none() {
            assert_isolated_test_succeeded(
                run_isolated_test(TEST_NAME, [(OsString::from(CHILD), OsString::from("1"))]),
                "bounded Claude settings growth",
            );
            return;
        }

        let root = TestRoot::new("settings-growth");
        let config = root.path().join("config");
        fs::create_dir_all(&config).unwrap();
        let settings = config.join("settings.json");
        fs::write(&settings, br#"{"safe":true}"#).unwrap();

        let secret = "post-metadata-settings-secret";
        let growth = secret.repeat(MAX_CLAUDE_SETTINGS_BYTES / secret.len() + 1);
        *CLAUDE_SETTINGS_AFTER_METADATA_HOOK.lock().unwrap() = Some(Box::new(move |path| {
            let mut same_inode = fs::OpenOptions::new().append(true).open(path).unwrap();
            same_inode.write_all(growth.as_bytes()).unwrap();
        }));

        let error = match read_user_claude_settings(Some(&config)) {
            Err(error) => error,
            Ok(_) => panic!("same-inode growth beyond the limit must fail closed"),
        };
        assert!(error.to_lowercase().contains("size limit"));
        assert!(!error.contains(secret));
    }

    #[test]
    fn cli_session_status_accepts_first_party_methods_and_rejects_api_methods_without_selection() {
        for method in ["claude.ai", "oauth", "keychain"] {
            for provider in ["firstParty", "anthropic"] {
                let raw = format!(
                    r#"{{"loggedIn":true,"authMethod":"{method}","apiProvider":"{provider}","email":"identity-field@example.invalid","organization":"identity-field-organization","subscriptionType":"identity-field-subscription","accessToken":"identity-field-token"}}"#
                );
                let validation = parse_claude_auth_status(raw.as_bytes(), None).unwrap();
                assert_eq!(
                    validation.credential_source.persistence_label(),
                    "claude_cli_session"
                );

                let diagnostics =
                    diagnostics_from_probe(ClaudeProbeOutcome::Status(Ok(validation)));
                let serialized = serde_json::to_string(&diagnostics).unwrap();
                for ignored in [
                    "identity-field@example.invalid",
                    "identity-field-organization",
                    "identity-field-subscription",
                    "identity-field-token",
                ] {
                    assert!(!serialized.contains(ignored), "retained {ignored}");
                }
            }
        }

        for method in ["api_key", "apiKeyHelper"] {
            let raw = format!(
                r#"{{"loggedIn":true,"authMethod":"{method}","apiProvider":"firstParty"}}"#
            );
            assert!(
                parse_claude_auth_status(raw.as_bytes(), None).is_err(),
                "{method} must require an explicit API credential selection"
            );
        }
    }

    #[test]
    fn cli_session_status_checks_login_and_provider_before_accepting_session_methods() {
        for method in ["claude.ai", "oauth", "keychain"] {
            let raw = format!(
                r#"{{"loggedIn":false,"authMethod":"{method}","apiProvider":"firstParty"}}"#
            );
            let issue = parse_claude_auth_status(raw.as_bytes(), None).unwrap_err();
            assert_eq!(format!("{issue:?}"), "MissingCliSession");
        }

        for (method, provider, expected) in [
            ("claude.ai", "bedrock", "NonFirstParty"),
            ("oauth", "vertex", "NonFirstParty"),
            ("keychain", "foundry", "NonFirstParty"),
            ("claude.ai", "future-provider", "Unknown"),
        ] {
            let raw = format!(
                r#"{{"loggedIn":true,"authMethod":"{method}","apiProvider":"{provider}"}}"#
            );
            let issue = parse_claude_auth_status(raw.as_bytes(), None).unwrap_err();
            assert_eq!(format!("{issue:?}"), expected);
        }

        let issue = parse_claude_auth_status(
            br#"{"loggedIn":true,"authMethod":"future_magic","apiProvider":"firstParty"}"#,
            None,
        )
        .unwrap_err();
        assert_eq!(format!("{issue:?}"), "Unknown");
    }

    #[test]
    fn accepts_only_matching_first_party_api_key_and_helper_statuses() {
        let environment = ClaudeCredentialSelection {
            source: ClaudeCredentialSource::EnvironmentApiKey,
            sanitized_settings: None,
        };
        let helper = ClaudeCredentialSelection {
            source: ClaudeCredentialSource::ApiKeyHelper,
            sanitized_settings: Some(r#"{"apiKeyHelper":"secret-helper-command"}"#.into()),
        };

        for method in ["api_key", "ANTHROPIC_API_KEY"] {
            let raw = format!(
                r#"{{"loggedIn":true,"authMethod":"{method}","apiProvider":"firstParty","email":"private@example.com","organization":"Private Org","subscriptionType":"max","token":"sk-ant-status-secret"}}"#
            );
            assert_eq!(
                parse_claude_auth_status(raw.as_bytes(), Some(&environment)).unwrap(),
                ClaudeConnectionValidation {
                    credential_source: ClaudeCredentialSource::EnvironmentApiKey,
                }
            );
        }

        for method in ["api_key_helper", "apiKeyHelper"] {
            let raw = format!(
                r#"{{"loggedIn":true,"authMethod":"{method}","apiProvider":"first_party"}}"#
            );
            assert_eq!(
                parse_claude_auth_status(raw.as_bytes(), Some(&helper)).unwrap(),
                ClaudeConnectionValidation {
                    credential_source: ClaudeCredentialSource::ApiKeyHelper,
                }
            );
        }

        assert_eq!(
            parse_claude_auth_status(
                br#"{"loggedIn":true,"authMethod":"api_key","apiProvider":"firstParty"}"#,
                Some(&helper),
            ),
            Err(ClaudeStatusIssue::MissingApiCredentials)
        );
        assert_eq!(
            parse_claude_auth_status(
                br#"{"loggedIn":true,"authMethod":"apiKeyHelper","apiProvider":"firstParty"}"#,
                Some(&environment),
            ),
            Err(ClaudeStatusIssue::MissingApiCredentials)
        );
    }

    #[test]
    fn api_selection_rejects_cli_session_third_party_malformed_oversized_and_unknown_statuses() {
        let environment = ClaudeCredentialSelection {
            source: ClaudeCredentialSource::EnvironmentApiKey,
            sanitized_settings: None,
        };
        let cases: &[(&[u8], ClaudeStatusIssue)] = &[
            (
                br#"{"loggedIn":false,"authMethod":"none","apiProvider":"firstParty"}"#,
                ClaudeStatusIssue::MissingApiCredentials,
            ),
            (
                br#"{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"}"#,
                ClaudeStatusIssue::MissingApiCredentials,
            ),
            (
                br#"{"loggedIn":true,"authMethod":"oauth","apiProvider":"firstParty"}"#,
                ClaudeStatusIssue::MissingApiCredentials,
            ),
            (
                br#"{"loggedIn":true,"authMethod":"keychain","apiProvider":"firstParty"}"#,
                ClaudeStatusIssue::MissingApiCredentials,
            ),
            (
                br#"{"loggedIn":true,"authMethod":"api_key","apiProvider":"bedrock"}"#,
                ClaudeStatusIssue::NonFirstParty,
            ),
            (
                br#"{"loggedIn":true,"authMethod":"api_key","apiProvider":"vertex"}"#,
                ClaudeStatusIssue::NonFirstParty,
            ),
            (
                br#"{"loggedIn":true,"authMethod":"api_key","apiProvider":"foundry"}"#,
                ClaudeStatusIssue::NonFirstParty,
            ),
            (br#"{"loggedIn":true"#, ClaudeStatusIssue::Malformed),
            (
                br#"{"loggedIn":true,"authMethod":"future_magic","apiProvider":"firstParty"}"#,
                ClaudeStatusIssue::Unknown,
            ),
        ];

        for (raw, expected) in cases {
            assert_eq!(
                parse_claude_auth_status(raw, Some(&environment)),
                Err(*expected),
                "raw status case should be rejected"
            );
        }

        let oversized = vec![b' '; MAX_CLAUDE_STATUS_BYTES + 1];
        assert_eq!(
            parse_claude_auth_status(&oversized, Some(&environment)),
            Err(ClaudeStatusIssue::Oversized)
        );
    }

    #[test]
    fn diagnostics_distinguish_cli_session_api_credentials_and_ready_without_identity() {
        let cases = [
            (
                ClaudeProbeOutcome::MissingCli,
                AgentProviderSetupState::NeedsSetup,
                "not installed",
            ),
            (
                ClaudeProbeOutcome::Status(Err(ClaudeStatusIssue::MissingCliSession)),
                AgentProviderSetupState::NeedsSetup,
                "local CLI",
            ),
            (
                ClaudeProbeOutcome::Status(Err(ClaudeStatusIssue::MissingApiCredentials)),
                AgentProviderSetupState::NeedsSetup,
                "API credential",
            ),
            (
                ClaudeProbeOutcome::Status(Ok(ClaudeConnectionValidation {
                    credential_source: ClaudeCredentialSource::ApiKeyHelper,
                })),
                AgentProviderSetupState::Ready,
                "helper",
            ),
        ];

        for (outcome, expected_state, expected_text) in cases {
            let diagnostics = diagnostics_from_probe(outcome);
            let serialized = serde_json::to_string(&diagnostics).unwrap();
            assert_eq!(diagnostics.provider, AgentProvider::Claude);
            assert_eq!(diagnostics.setup_state, expected_state);
            assert!(serialized
                .to_lowercase()
                .contains(&expected_text.to_lowercase()));
            for forbidden in [
                "sk-ant-private",
                "private@example.com",
                "Private Org",
                "Max subscription",
                "secret-helper-command",
            ] {
                assert!(!serialized.contains(forbidden), "leaked {forbidden}");
            }
        }

        let missing_session = diagnostics_from_probe(ClaudeProbeOutcome::Status(Err(
            ClaudeStatusIssue::MissingCliSession,
        )));
        assert_eq!(
            missing_session.guidance,
            "Run claude auth login in your terminal, then reconnect Claude."
        );
        let api_validation_error =
            status_issue_message(ClaudeStatusIssue::MissingApiCredentials).to_lowercase();
        assert!(api_validation_error.contains("anthropic_api_key"));
        assert!(api_validation_error.contains("apikeyhelper"));
    }

    #[test]
    fn diagnostics_never_expose_raw_credential_or_identity_fields_from_status() {
        let raw = br#"{
          "loggedIn": true,
          "authMethod": "api_key",
          "apiProvider": "firstParty",
          "apiKey": "sk-ant-private",
          "email": "private@example.com",
          "organization": "Private Org",
          "subscriptionType": "Max subscription"
        }"#;
        let selection = ClaudeCredentialSelection {
            source: ClaudeCredentialSource::EnvironmentApiKey,
            sanitized_settings: None,
        };
        let validation = parse_claude_auth_status(raw, Some(&selection)).unwrap();
        let diagnostics = diagnostics_from_probe(ClaudeProbeOutcome::Status(Ok(validation)));
        let serialized = serde_json::to_string(&diagnostics).unwrap();

        for forbidden in [
            "sk-ant-private",
            "private@example.com",
            "Private Org",
            "Max subscription",
        ] {
            assert!(!serialized.contains(forbidden), "leaked {forbidden}");
        }
    }

    #[test]
    fn credential_selection_debug_and_persistence_labels_contain_no_secret_material() {
        let selection = ClaudeCredentialSelection {
            source: ClaudeCredentialSource::ApiKeyHelper,
            sanitized_settings: Some(
                r#"{"apiKeyHelper":"/usr/local/bin/helper secret-helper-command"}"#.into(),
            ),
        };

        let debug = format!("{selection:?}");
        assert!(!debug.contains("secret-helper-command"));
        assert_eq!(selection.source.persistence_label(), "api_key_helper");
    }

    #[test]
    fn status_argv_uses_bare_json_auth_and_only_sanitized_helper_settings() {
        let environment = ClaudeCredentialSelection {
            source: ClaudeCredentialSource::EnvironmentApiKey,
            sanitized_settings: None,
        };
        assert_eq!(
            claude_status_arguments(Some(&environment)),
            ["--bare", "auth", "status", "--json"]
                .into_iter()
                .map(OsString::from)
                .collect::<Vec<_>>()
        );

        let helper = ClaudeCredentialSelection {
            source: ClaudeCredentialSource::ApiKeyHelper,
            sanitized_settings: Some(r#"{"apiKeyHelper":"safe-helper"}"#.into()),
        };
        assert_eq!(
            claude_status_arguments(Some(&helper)),
            [
                "--bare",
                "--settings",
                r#"{"apiKeyHelper":"safe-helper"}"#,
                "auth",
                "status",
                "--json",
            ]
            .into_iter()
            .map(OsString::from)
            .collect::<Vec<_>>()
        );
    }

    #[cfg(unix)]
    #[test]
    fn credential_selection_precedence_is_explicit_key_then_helper_then_none_session_fallback() {
        let invalid_settings = br#"{"apiKeyHelper":"helper-command secret-helper-value"}"#;
        let environment = select_claude_credential(
            Some("  sk-ant-environment-secret  "),
            Some(invalid_settings),
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            environment.source,
            ClaudeCredentialSource::EnvironmentApiKey
        );
        assert_eq!(environment.sanitized_settings, None);
        assert!(!format!("{environment:?}").contains("sk-ant-environment-secret"));

        let root = TestRoot::new_at(Path::new("/tmp"), "helper-selection");
        let helper_path = root.path().join("helper");
        write_test_executable(&helper_path, "printf key");
        let canonical_helper = fs::canonicalize(&helper_path).unwrap();
        let settings = serde_json::to_vec(&json!({"apiKeyHelper": helper_path})).unwrap();

        let environment_with_valid_helper =
            select_claude_credential(Some("  sk-ant-environment-secret  "), Some(&settings))
                .unwrap()
                .unwrap();
        assert_eq!(
            environment_with_valid_helper.source,
            ClaudeCredentialSource::EnvironmentApiKey
        );
        assert_eq!(environment_with_valid_helper.sanitized_settings, None);

        let helper = select_claude_credential(Some("   "), Some(&settings))
            .unwrap()
            .unwrap();
        assert_eq!(helper.source, ClaudeCredentialSource::ApiKeyHelper);
        assert_eq!(
            serde_json::from_str::<Value>(helper.sanitized_settings.as_deref().unwrap()).unwrap(),
            json!({"apiKeyHelper": canonical_helper})
        );
        // No explicit API credential selection means the caller uses the CLI-session fallback.
        assert_eq!(select_claude_credential(None, None).unwrap(), None);
    }

    #[cfg(unix)]
    fn create_test_helper(path: &Path) -> PathBuf {
        write_test_executable(path, "printf '%s' test-key");
        fs::canonicalize(path).unwrap()
    }

    #[cfg(unix)]
    fn write_test_helper_settings(config: &Path, helper: &Path) {
        fs::create_dir_all(config).unwrap();
        fs::write(
            config.join("settings.json"),
            serde_json::to_vec(&json!({"apiKeyHelper": helper})).unwrap(),
        )
        .unwrap();
    }

    fn assert_custom_config_environment(
        home: &Path,
        config: &OsStr,
        expected_config: Option<&Path>,
    ) {
        let home_key = if cfg!(windows) { "USERPROFILE" } else { "HOME" };
        std::env::set_var(home_key, home);
        std::env::set_var("CLAUDE_CONFIG_DIR", config);
        let context = current_claude_invocation_context().unwrap();

        let mut command = Command::new("claude");
        command.env(home_key, home);
        command.env("CLAUDE_CONFIG_DIR", config);
        configure_claude_child_environment(&mut command, &context);
        let environment = command
            .get_envs()
            .map(|(key, value)| {
                (
                    key.to_string_lossy().into_owned(),
                    value.map(OsStr::to_os_string),
                )
            })
            .collect::<std::collections::HashMap<_, _>>();
        match expected_config {
            Some(expected_config) => assert_eq!(
                environment
                    .get("CLAUDE_CONFIG_DIR")
                    .and_then(Option::as_deref),
                Some(expected_config.as_os_str())
            ),
            None => assert_eq!(environment.get("CLAUDE_CONFIG_DIR"), Some(&None)),
        }
        assert_eq!(
            environment.get(home_key).and_then(Option::as_deref),
            Some(home.as_os_str())
        );
    }

    struct RestoreCurrentDir(PathBuf);

    impl RestoreCurrentDir {
        fn set(path: &Path) -> Self {
            let previous = std::env::current_dir().unwrap();
            std::env::set_current_dir(path).unwrap();
            Self(previous)
        }
    }

    impl Drop for RestoreCurrentDir {
        fn drop(&mut self) {
            let _ = std::env::set_current_dir(&self.0);
        }
    }

    #[test]
    fn custom_config_dir_path_policy_uses_only_absolute_existing_directories_inside_home() {
        const CHILD: &str = "GTUM_CLAUDE_CONFIG_POLICY_CHILD";
        const TEST_NAME: &str = concat!(
            "runtime::claude::tests::",
            "custom_config_dir_path_policy_uses_only_absolute_existing_directories_inside_home"
        );
        if std::env::var_os(CHILD).is_none() {
            assert_isolated_test_succeeded(
                run_isolated_test(TEST_NAME, [(OsString::from(CHILD), OsString::from("1"))]),
                "config path policy",
            );
            return;
        }

        let root = TestRoot::new("config-path-policy");
        let home = root.path().join("user home");
        let valid_config = home.join("approved config");
        let relative_config = home.join("relative config");
        fs::create_dir_all(&valid_config).unwrap();
        fs::create_dir_all(&relative_config).unwrap();
        let home = fs::canonicalize(home).unwrap();
        let valid_config = fs::canonicalize(valid_config).unwrap();
        let _cwd = RestoreCurrentDir::set(&home);

        let config_file = home.join("config-file");
        fs::write(&config_file, b"not a directory").unwrap();
        let outside_config = root.path().join("outside-config");
        fs::create_dir_all(&outside_config).unwrap();
        let outside_config = fs::canonicalize(outside_config).unwrap();

        for invalid in [
            OsString::from("relative config"),
            home.join("missing-config").into_os_string(),
            config_file.into_os_string(),
            outside_config.into_os_string(),
        ] {
            assert_custom_config_environment(&home, &invalid, None);
        }
        assert_custom_config_environment(&home, valid_config.as_os_str(), Some(&valid_config));
    }

    #[cfg(unix)]
    #[test]
    fn valid_custom_config_dir_is_used_for_helper_discovery() {
        const CHILD: &str = "GTUM_CLAUDE_CONFIG_HELPER_CHILD";
        const TEST_NAME: &str = concat!(
            "runtime::claude::tests::",
            "valid_custom_config_dir_is_used_for_helper_discovery"
        );
        if std::env::var_os(CHILD).is_none() {
            assert_isolated_test_succeeded(
                run_isolated_test(TEST_NAME, [(OsString::from(CHILD), OsString::from("1"))]),
                "custom config helper discovery",
            );
            return;
        }

        let root = TestRoot::new_at(Path::new("/tmp"), "config-helper-discovery");
        let home = root.path().join("home");
        let config = home.join("approved-config");
        fs::create_dir_all(&config).unwrap();
        let helper = create_test_helper(&home.join("helper"));
        write_test_helper_settings(&config, &helper);
        let home = fs::canonicalize(home).unwrap();
        let config = fs::canonicalize(config).unwrap();
        std::env::set_var("HOME", &home);
        std::env::set_var("CLAUDE_CONFIG_DIR", &config);
        std::env::remove_var("ANTHROPIC_API_KEY");

        let selection = current_claude_credential()
            .unwrap()
            .expect("valid custom config helper should be selected");
        assert_eq!(selection.source, ClaudeCredentialSource::ApiKeyHelper);
        let settings =
            serde_json::from_str::<Value>(selection.sanitized_settings.as_deref().unwrap())
                .unwrap();
        assert_eq!(
            settings.get("apiKeyHelper").and_then(Value::as_str),
            helper.to_str()
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejected_custom_config_dirs_never_override_the_default_helper() {
        const CHILD: &str = "GTUM_CLAUDE_REJECTED_CONFIG_HELPER_CHILD";
        const TEST_NAME: &str = concat!(
            "runtime::claude::tests::",
            "rejected_custom_config_dirs_never_override_the_default_helper"
        );
        if std::env::var_os(CHILD).is_none() {
            assert_isolated_test_succeeded(
                run_isolated_test(TEST_NAME, [(OsString::from(CHILD), OsString::from("1"))]),
                "rejected config helper discovery",
            );
            return;
        }

        use std::os::unix::fs::symlink;

        let root = TestRoot::new_at(Path::new("/tmp"), "rejected-config-helper");
        let home = root.path().join("home");
        let default_config = home.join(".claude");
        fs::create_dir_all(&default_config).unwrap();
        let default_helper = create_test_helper(&home.join("default-helper"));
        write_test_helper_settings(&default_config, &default_helper);
        let home = fs::canonicalize(home).unwrap();
        let _cwd = RestoreCurrentDir::set(&home);

        let relative_config = home.join("relative-config");
        let relative_helper = create_test_helper(&home.join("relative-helper"));
        write_test_helper_settings(&relative_config, &relative_helper);

        let config_file = home.join("config-file");
        fs::write(&config_file, b"not a directory").unwrap();

        let outside_config = root.path().join("outside-config");
        let outside_helper = create_test_helper(&root.path().join("outside-helper"));
        write_test_helper_settings(&outside_config, &outside_helper);
        let outside_config = fs::canonicalize(outside_config).unwrap();
        let escape = home.join("escape-config");
        symlink(&outside_config, &escape).unwrap();

        for (label, config, rejected_helper) in [
            (
                "relative",
                OsString::from("relative-config"),
                Some(relative_helper.clone()),
            ),
            (
                "missing",
                home.join("missing-config").into_os_string(),
                None,
            ),
            ("file", config_file.into_os_string(), None),
            (
                "outside",
                outside_config.into_os_string(),
                Some(outside_helper.clone()),
            ),
            (
                "symlink escape",
                escape.into_os_string(),
                Some(outside_helper.clone()),
            ),
        ] {
            std::env::set_var("HOME", &home);
            std::env::set_var("CLAUDE_CONFIG_DIR", &config);
            std::env::remove_var("ANTHROPIC_API_KEY");

            let context = current_claude_invocation_context().unwrap();
            let selection = context
                .credential()
                .expect("rejected config must fall back to the default helper");
            assert_eq!(selection.source, ClaudeCredentialSource::ApiKeyHelper);
            let settings =
                serde_json::from_str::<Value>(selection.sanitized_settings.as_deref().unwrap())
                    .unwrap();
            let selected_helper = settings
                .get("apiKeyHelper")
                .and_then(Value::as_str)
                .unwrap();
            assert_eq!(selected_helper, default_helper.to_str().unwrap(), "{label}");
            if let Some(rejected_helper) = rejected_helper {
                assert_ne!(
                    selected_helper,
                    rejected_helper.to_str().unwrap(),
                    "{label}"
                );
            }

            let mut command = Command::new("claude");
            command.env("HOME", &home);
            command.env("CLAUDE_CONFIG_DIR", &config);
            configure_claude_child_environment(&mut command, &context);
            let config_entry = command
                .get_envs()
                .find(|(key, _)| *key == OsStr::new("CLAUDE_CONFIG_DIR"))
                .map(|(_, value)| value.map(OsStr::to_os_string));
            assert_eq!(config_entry, Some(None), "{label}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn custom_config_dir_rejects_symlink_escape_from_home() {
        const CHILD: &str = "GTUM_CLAUDE_CONFIG_SYMLINK_CHILD";
        const TEST_NAME: &str = concat!(
            "runtime::claude::tests::",
            "custom_config_dir_rejects_symlink_escape_from_home"
        );
        if std::env::var_os(CHILD).is_none() {
            assert_isolated_test_succeeded(
                run_isolated_test(TEST_NAME, [(OsString::from(CHILD), OsString::from("1"))]),
                "config symlink escape",
            );
            return;
        }

        use std::os::unix::fs::symlink;

        let root = TestRoot::new("config-symlink-policy");
        let home = root.path().join("home");
        fs::create_dir_all(&home).unwrap();
        let home = fs::canonicalize(home).unwrap();

        let outside_config = root.path().join("outside-config");
        fs::create_dir_all(&outside_config).unwrap();
        let escape = home.join("escape-config");
        symlink(fs::canonicalize(outside_config).unwrap(), &escape).unwrap();

        assert_custom_config_environment(&home, escape.as_os_str(), None);
    }

    #[cfg(unix)]
    #[test]
    fn bounded_process_caps_output_and_kills_a_timed_out_child() {
        let context = invocation_context(None);
        let output = run_bounded_process(
            Path::new("/bin/sh"),
            &[
                OsString::from("-c"),
                OsString::from("printf '0123456789'; printf 'abcdefghij' >&2"),
            ],
            None,
            None,
            &context,
            Duration::from_secs(1),
            4,
            5,
        )
        .unwrap();
        assert_eq!(output.stdout, b"0123");
        assert!(output.stdout_truncated);
        assert!(output.stderr_truncated);

        let started = Instant::now();
        let timeout = run_bounded_process(
            Path::new("/bin/sh"),
            &[OsString::from("-c"), OsString::from("sleep 2")],
            None,
            None,
            &context,
            Duration::from_millis(50),
            16,
            16,
        )
        .unwrap_err();
        assert!(started.elapsed() < Duration::from_secs(1));
        assert!(timeout.to_lowercase().contains("timed out"));
    }

    #[cfg(unix)]
    #[test]
    fn bounded_process_timeout_is_not_blocked_by_a_child_that_ignores_large_stdin() {
        let large_prompt = vec![b'x'; MAX_CLAUDE_PROMPT_BYTES];
        let started = Instant::now();
        let context = invocation_context(None);
        let result = run_bounded_process(
            Path::new("/bin/sh"),
            &[OsString::from("-c"), OsString::from("sleep 2")],
            None,
            Some(&large_prompt),
            &context,
            Duration::from_millis(50),
            16,
            16,
        );

        assert!(started.elapsed() < Duration::from_secs(1));
        assert!(result
            .expect_err("non-reading child should time out")
            .to_lowercase()
            .contains("timed out"));
    }

    #[cfg(unix)]
    #[test]
    fn completed_child_does_not_wait_for_a_descendant_that_keeps_stdin_open() {
        let large_prompt = vec![b'x'; MAX_CLAUDE_PROMPT_BYTES];
        let started = Instant::now();
        let context = invocation_context(None);
        let error = run_bounded_process(
            Path::new("/bin/sh"),
            &[
                OsString::from("-c"),
                OsString::from("exec 3<&0; sleep 2 <&3 & exit 0"),
            ],
            None,
            Some(&large_prompt),
            &context,
            Duration::from_millis(100),
            16,
            16,
        )
        .expect_err("inherited stdin pipe should remain deadline-bounded");

        assert!(started.elapsed() < Duration::from_secs(1));
        assert!(error.to_lowercase().contains("timed out"));
    }

    #[cfg(unix)]
    #[test]
    fn cli_session_child_rejects_a_pinned_config_that_changed_before_spawn() {
        use std::os::unix::fs::symlink;

        let root = TestRoot::new("changed-pinned-config");
        let config = root.path().join("config");
        let replacement = root.path().join("replacement");
        let marker = root.path().join("child-ran");
        fs::create_dir_all(&config).unwrap();
        fs::create_dir_all(&replacement).unwrap();
        let config = fs::canonicalize(config).unwrap();
        let replacement = fs::canonicalize(replacement).unwrap();
        let context = ClaudeInvocationContext::new(None, Some(config.clone()));

        fs::remove_dir(&config).unwrap();
        symlink(&replacement, &config).unwrap();

        let error = run_bounded_process(
            Path::new("/bin/sh"),
            &[
                OsString::from("-c"),
                OsString::from("printf ran > \"$0\""),
                marker.clone().into_os_string(),
            ],
            None,
            None,
            &context,
            Duration::from_secs(1),
            16,
            16,
        )
        .expect_err("changed pinned config must fail before child spawn");

        assert_eq!(
            error,
            "Claude CLI configuration changed. Reconnect Claude and retry."
        );
        assert!(!error.contains(config.to_string_lossy().as_ref()));
        assert!(!error.contains(replacement.to_string_lossy().as_ref()));
        assert!(!marker.exists());
    }

    #[cfg(unix)]
    #[test]
    fn cli_session_children_keep_the_config_captured_before_environment_changes() {
        const CHILD: &str = "GTUM_CLAUDE_PINNED_CONFIG_CHILD";
        const TEST_NAME: &str = concat!(
            "runtime::claude::tests::",
            "cli_session_children_keep_the_config_captured_before_environment_changes"
        );
        if std::env::var_os(CHILD).is_none() {
            assert_isolated_test_succeeded(
                run_isolated_test(TEST_NAME, [(OsString::from(CHILD), OsString::from("1"))]),
                "pinned CLI-session config",
            );
            return;
        }

        let root = TestRoot::new("pinned-cli-config");
        let home_a = root.path().join("home-a");
        let home_b = root.path().join("home-b");
        let config_a = home_a.join("config-a");
        let config_b = home_b.join("config-b");
        let project = root.path().join("project");
        fs::create_dir_all(&config_a).unwrap();
        fs::create_dir_all(&config_b).unwrap();
        fs::create_dir_all(&project).unwrap();
        let home_a = fs::canonicalize(home_a).unwrap();
        let home_b = fs::canonicalize(home_b).unwrap();
        let config_a = fs::canonicalize(config_a).unwrap();
        let config_b = fs::canonicalize(config_b).unwrap();
        let program = root.path().join("claude");
        write_test_executable(
            &program,
            concat!(
                "if [ \"$4\" = \"auth\" ]; then\n",
                "  printf '%s' \"$CLAUDE_CONFIG_DIR\" > \"$0.status-config\"\n",
                "  printf '%s' \"$HOME\" > \"$0.status-home\"\n",
                "  printf '%s' '{\"loggedIn\":true,\"authMethod\":\"claude.ai\",\"apiProvider\":\"firstParty\"}'\n",
                "  exit 0\n",
                "fi\n",
                "printf '%s' \"$CLAUDE_CONFIG_DIR\" > \"$0.request-config\"\n",
                "printf '%s' \"$HOME\" > \"$0.request-home\"\n",
                "/bin/cat >/dev/null\n",
                "printf '%s' '{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"structured_output\":{\"provider\":\"claude\",\"schemaVersion\":1,\"summary\":\"Pinned config\",\"command\":\"\",\"preferredTarget\":\"current_tab\",\"confidence\":\"high\",\"error\":null}}'\n",
            ),
        );
        std::env::set_var("HOME", &home_a);
        std::env::set_var("USERPROFILE", &home_a);
        std::env::set_var("PATH", root.path());
        std::env::set_var("CLAUDE_CONFIG_DIR", &config_a);
        std::env::remove_var("ANTHROPIC_API_KEY");

        let context = current_claude_invocation_context().unwrap();
        assert_eq!(context.credential(), None);
        assert_eq!(context.cli_session_config_dir(), Some(config_a.as_path()));

        std::env::set_var("HOME", &home_b);
        std::env::set_var("USERPROFILE", &home_b);
        std::env::set_var("CLAUDE_CONFIG_DIR", &config_b);
        run_claude_status_probe(&program, &context, Duration::from_secs(2)).unwrap();
        request_claude_suggestions_with(
            &program,
            &context,
            claude_request(&project),
            Duration::from_secs(2),
        )
        .unwrap();

        let status_config = PathBuf::from(
            fs::read_to_string(format!("{}.status-config", program.display())).unwrap(),
        );
        let request_config = PathBuf::from(
            fs::read_to_string(format!("{}.request-config", program.display())).unwrap(),
        );
        let status_home = PathBuf::from(
            fs::read_to_string(format!("{}.status-home", program.display())).unwrap(),
        );
        let request_home = PathBuf::from(
            fs::read_to_string(format!("{}.request-home", program.display())).unwrap(),
        );
        assert_eq!(status_config, config_a);
        assert_eq!(request_config, config_a);
        assert_ne!(status_config, config_b);
        assert_ne!(request_config, config_b);
        assert_eq!(status_home, home_b);
        assert_eq!(request_home, home_b);
    }

    #[cfg(unix)]
    #[test]
    fn cli_session_fake_child_validates_then_requests_with_canonical_owner_context() {
        const CHILD: &str = "GTUM_CLAUDE_SESSION_SUCCESS_CHILD";
        const TEST_NAME: &str = concat!(
            "runtime::claude::tests::",
            "cli_session_fake_child_validates_then_requests_with_canonical_owner_context"
        );
        if std::env::var_os(CHILD).is_none() {
            assert_isolated_test_succeeded(
                run_isolated_test(TEST_NAME, [(OsString::from(CHILD), OsString::from("1"))]),
                "CLI-session request",
            );
            return;
        }

        let root = TestRoot::new("cli-session-success");
        let home = root.path().join("home");
        let project = root.path().join("project");
        fs::create_dir_all(&home).unwrap();
        fs::create_dir_all(&project).unwrap();
        let program = root.path().join("claude");
        write_test_executable(
            &program,
            concat!(
                "if [ \"$4\" = \"auth\" ]; then\n",
                "  printf '%s\\n' \"$@\" > \"$0.status-argv\"\n",
                "  printf '%s' '{\"loggedIn\":true,\"authMethod\":\"claude.ai\",\"apiProvider\":\"firstParty\",\"email\":\"ignored@example.invalid\",\"subscriptionType\":\"ignored\"}'\n",
                "  exit 0\n",
                "fi\n",
                "printf '%s\\n' \"$@\" > \"$0.request-argv\"\n",
                "/bin/cat > \"$0.stdin\"\n",
                "pwd > \"$0.cwd\"\n",
                "printf '%s' '{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"structured_output\":{\"provider\":\"claude\",\"schemaVersion\":1,\"summary\":\"CLI session result\",\"command\":\"\",\"preferredTarget\":\"current_tab\",\"confidence\":\"high\",\"error\":null}}'\n",
            ),
        );
        std::env::set_var("HOME", &home);
        std::env::set_var("USERPROFILE", &home);
        std::env::set_var("PATH", root.path());
        std::env::remove_var("ANTHROPIC_API_KEY");
        std::env::remove_var("CLAUDE_CONFIG_DIR");
        assert_eq!(current_claude_credential().unwrap(), None);

        let mut request = claude_request(&project);
        request.model = Some("opus".into());
        let attempt = request_claude_suggestion_attempt(request);
        let validation = attempt.validation.unwrap();
        assert_eq!(
            validation.credential_source.persistence_label(),
            "claude_cli_session"
        );
        let suggestions = attempt.suggestions.unwrap().unwrap();
        assert_eq!(suggestions.len(), 1);
        assert_eq!(suggestions[0].summary, "CLI session result");

        let expected_status = [
            "--safe-mode",
            "--setting-sources",
            "",
            "auth",
            "status",
            "--json",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect::<Vec<_>>();
        let recorded_status = fs::read_to_string(format!("{}.status-argv", program.display()))
            .unwrap()
            .split_terminator('\n')
            .map(str::to_owned)
            .collect::<Vec<_>>();
        assert_eq!(recorded_status, expected_status);

        let schema = claude_suggestion_schema().unwrap();
        let expected_request = [
            "--safe-mode",
            "--setting-sources",
            "",
            "--strict-mcp-config",
            "--disable-slash-commands",
            "--no-chrome",
            "--no-session-persistence",
            "--permission-mode",
            "dontAsk",
            "--tools",
            "",
            "--print",
            "--output-format",
            "json",
            "--json-schema",
            schema.as_str(),
            "--model",
            "opus",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect::<Vec<_>>();
        let recorded_request = fs::read_to_string(format!("{}.request-argv", program.display()))
            .unwrap()
            .split_terminator('\n')
            .map(str::to_owned)
            .collect::<Vec<_>>();
        assert_eq!(recorded_request, expected_request);
        assert_no_argument_expansion(
            &recorded_request
                .iter()
                .map(OsString::from)
                .collect::<Vec<_>>(),
        );

        let canonical_project = fs::canonicalize(&project).unwrap();
        let mut expected_prompt_request = claude_request(&project);
        expected_prompt_request.project_path = canonical_project.to_string_lossy().into_owned();
        assert_eq!(
            fs::read_to_string(format!("{}.stdin", program.display())).unwrap(),
            build_claude_prompt(&expected_prompt_request).unwrap()
        );
        assert_eq!(
            PathBuf::from(
                fs::read_to_string(format!("{}.cwd", program.display()))
                    .unwrap()
                    .trim()
            ),
            canonical_project
        );
    }

    #[cfg(unix)]
    #[test]
    fn exit_one_logged_out_status_is_typed_guidance_and_stops_before_request() {
        const CHILD: &str = "GTUM_CLAUDE_MISSING_LOGIN_CHILD";
        const TEST_NAME: &str = concat!(
            "runtime::claude::tests::",
            "exit_one_logged_out_status_is_typed_guidance_and_stops_before_request"
        );
        if std::env::var_os(CHILD).is_none() {
            assert_isolated_test_succeeded(
                run_isolated_test(TEST_NAME, [(OsString::from(CHILD), OsString::from("1"))]),
                "missing CLI login",
            );
            return;
        }

        let root = TestRoot::new("missing-login");
        let home = root.path().join("home");
        let project = root.path().join("project");
        fs::create_dir_all(&home).unwrap();
        fs::create_dir_all(&project).unwrap();
        let program = root.path().join("claude");
        write_test_executable(
            &program,
            concat!(
                "case \" $* \" in\n",
                "  *\" auth status --json \"*)\n",
                "    : > \"$0.status-ran\"\n",
                "    printf '%s' '{\"loggedIn\":false,\"authMethod\":\"none\",\"apiProvider\":\"firstParty\"}'\n",
                "    exit 1\n",
                "    ;;\n",
                "  *)\n",
                "    : > \"$0.request-ran\"\n",
                "    exit 0\n",
                "    ;;\n",
                "esac\n",
            ),
        );
        std::env::set_var("HOME", &home);
        std::env::set_var("USERPROFILE", &home);
        std::env::set_var("PATH", root.path());
        std::env::remove_var("ANTHROPIC_API_KEY");
        std::env::remove_var("CLAUDE_CONFIG_DIR");

        let context = current_claude_invocation_context().unwrap();
        assert_eq!(context.credential(), None);
        let issue = match run_claude_status_probe(&program, &context, Duration::from_secs(2))
            .unwrap_err()
        {
            ClaudeProbeError::Status(issue) => issue,
            ClaudeProbeError::Command(message) => {
                panic!("bounded logged-out JSON should be typed, not generic: {message}")
            }
        };
        assert_eq!(format!("{issue:?}"), "MissingCliSession");
        let guidance = status_issue_message(issue);
        assert!(guidance.contains("Run claude auth login in your terminal, then reconnect Claude."));

        let _ = fs::remove_file(format!("{}.status-ran", program.display()));
        let attempt = request_claude_suggestion_attempt(claude_request(&project));
        let validation_error = attempt.validation.unwrap_err();
        assert!(validation_error
            .contains("Run claude auth login in your terminal, then reconnect Claude."));
        assert!(attempt.suggestions.is_none());
        assert!(PathBuf::from(format!("{}.status-ran", program.display())).exists());
        assert!(!PathBuf::from(format!("{}.request-ran", program.display())).exists());
    }

    #[cfg(unix)]
    #[test]
    fn status_execution_accepts_api_key_and_rejects_source_mismatch_or_secret_stderr() {
        use std::os::unix::fs::PermissionsExt;
        use std::sync::atomic::{AtomicU64, Ordering};

        static NEXT_SCRIPT: AtomicU64 = AtomicU64::new(0);
        let make_script = |body: &str| {
            let path = std::env::temp_dir().join(format!(
                "gtum-claude-status-{}-{}.sh",
                std::process::id(),
                NEXT_SCRIPT.fetch_add(1, Ordering::Relaxed),
            ));
            fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
            let mut permissions = fs::metadata(&path).unwrap().permissions();
            permissions.set_mode(0o700);
            fs::set_permissions(&path, permissions).unwrap();
            path
        };
        let credential = ClaudeCredentialSelection {
            source: ClaudeCredentialSource::EnvironmentApiKey,
            sanitized_settings: None,
        };
        let context = invocation_context(Some(credential));

        let success = make_script(
            r#"printf '%s' '{"loggedIn":true,"authMethod":"api_key","apiProvider":"firstParty","email":"private@example.com"}'"#,
        );
        assert_eq!(
            validate_claude_connection_with(&success, &context, Duration::from_secs(5),)
                .unwrap()
                .credential_source,
            ClaudeCredentialSource::EnvironmentApiKey
        );

        let cli_session = make_script(
            r#"printf '%s' '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"}'"#,
        );
        let source_mismatch_error =
            validate_claude_connection_with(&cli_session, &context, Duration::from_secs(5))
                .unwrap_err();
        assert!(source_mismatch_error
            .to_lowercase()
            .contains("selected api path"));

        let failed = make_script(concat!(
            "printf '%s' '",
            "x-api-key: arbitrary-status-secret; ",
            "helper output: arbitrary-helper-secret; ",
            "private@example.com; Private Organization",
            "' >&2; exit 7",
        ));
        let failed_error =
            validate_claude_connection_with(&failed, &context, Duration::from_secs(5)).unwrap_err();
        assert_eq!(
            failed_error,
            concat!(
                "Claude Code authentication status failed. Child diagnostics were discarded ",
                "to protect credential data. Reconfigure the first-party API-key credential and retry."
            )
        );
        for forbidden in [
            "arbitrary-status-secret",
            "arbitrary-helper-secret",
            "private@example.com",
            "Private Organization",
            "x-api-key",
        ] {
            assert!(!failed_error.contains(forbidden), "leaked {forbidden}");
        }

        for path in [success, cli_session, failed] {
            let _ = fs::remove_file(path);
        }
    }
}
