use std::{env, time::Duration};

use reqwest::{
    blocking::Client,
    header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::runtime::{
    auth::AgentProvider,
    workspace::ExecutionMode,
};

const DEFAULT_OPENAI_BASE_URL: &str = "https://api.openai.com/v1";
const DEFAULT_CODEX_MODEL: &str = "gpt-5.3-codex";
const REQUEST_TIMEOUT_SECS: u64 = 45;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestAgentSuggestionsRequest {
    pub provider: AgentProvider,
    pub project_name: String,
    pub project_path: String,
    pub active_tab_id: Option<String>,
    pub active_tab_title: Option<String>,
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

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CodexStructuredSuggestion {
    summary: String,
    command: String,
    preferred_target: AgentExecutionTarget,
    confidence: AgentSuggestionConfidence,
    error: Option<String>,
}

struct CodexConfig {
    api_key: String,
    base_url: String,
    model: String,
    organization_id: Option<String>,
    project_id: Option<String>,
}

impl CodexConfig {
    fn from_env() -> Result<Self, String> {
        let api_key = env::var("OPENAI_API_KEY")
            .map_err(|_| "Set OPENAI_API_KEY in the desktop environment to connect Codex.".to_string())?;

        let base_url = env::var("GTUM_OPENAI_BASE_URL")
            .or_else(|_| env::var("OPENAI_BASE_URL"))
            .unwrap_or_else(|_| DEFAULT_OPENAI_BASE_URL.to_string());
        let model = env::var("GTUM_CODEX_MODEL").unwrap_or_else(|_| DEFAULT_CODEX_MODEL.to_string());
        let organization_id = env::var("OPENAI_ORG_ID").ok().filter(|value| !value.trim().is_empty());
        let project_id = env::var("OPENAI_PROJECT_ID").ok().filter(|value| !value.trim().is_empty());

        Ok(Self {
            api_key,
            base_url,
            model,
            organization_id,
            project_id,
        })
    }

    fn account_label(&self) -> String {
        env::var("GTUM_CODEX_ACCOUNT_LABEL")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| format!("{} via OpenAI API", self.model))
    }
}

pub fn request_codex_suggestions(
    request: RequestAgentSuggestionsRequest,
) -> Result<Vec<AgentSuggestionResponse>, String> {
    let config = CodexConfig::from_env()?;
    let client = Client::builder()
        .timeout(Duration::from_secs(REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|error| format!("failed to initialize Codex client: {error}"))?;

    let payload = build_request_payload(&config, &request);
    let url = format!("{}/responses", config.base_url.trim_end_matches('/'));
    let mut headers = HeaderMap::new();
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", config.api_key))
            .map_err(|error| format!("failed to prepare Codex authorization header: {error}"))?,
    );
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));

    if let Some(organization_id) = &config.organization_id {
        headers.insert(
            "OpenAI-Organization",
            HeaderValue::from_str(organization_id)
                .map_err(|error| format!("failed to prepare OpenAI organization header: {error}"))?,
        );
    }

    if let Some(project_id) = &config.project_id {
        headers.insert(
            "OpenAI-Project",
            HeaderValue::from_str(project_id)
                .map_err(|error| format!("failed to prepare OpenAI project header: {error}"))?,
        );
    }

    let response_json = client
        .post(url)
        .headers(headers)
        .json(&payload)
        .send()
        .map_err(|error| format!("failed to reach Codex provider: {error}"))?
        .error_for_status()
        .map_err(|error| format!("Codex provider request failed: {error}"))?
        .json::<Value>()
        .map_err(|error| format!("failed to decode Codex provider response: {error}"))?;

    let output_text = extract_output_text(&response_json)
        .ok_or_else(|| "Codex provider returned no structured text output.".to_string())?;
    let structured = serde_json::from_str::<CodexStructuredSuggestion>(&output_text)
        .map_err(|error| format!("failed to parse Codex structured response: {error}"))?;

    let normalized_error = structured
        .error
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let normalized_command = structured.command.trim().to_string();

    if normalized_error.is_none() && normalized_command.is_empty() {
        return Err("Codex provider returned an empty command without an error reason.".into());
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

pub fn codex_account_label() -> Option<String> {
    CodexConfig::from_env().ok().map(|config| config.account_label())
}

fn build_request_payload(config: &CodexConfig, request: &RequestAgentSuggestionsRequest) -> Value {
    let prompt = build_prompt(request);

    json!({
        "model": config.model,
        "instructions": "You are Codex inside gtum, a desktop workspace for terminal-heavy development. Read the project metadata and recent terminal logs, then return exactly one safe next shell command. Prefer non-destructive commands that help the developer move forward immediately. If you cannot recommend a safe command, set `error` and leave `command` empty.",
        "input": prompt,
        "reasoning": {
            "effort": reasoning_effort(request.execution_mode)
        },
        "text": {
            "verbosity": "low",
            "format": {
                "type": "json_schema",
                "name": "gtum_agent_suggestion",
                "strict": true,
                "schema": {
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
                }
            }
        }
    })
}

fn build_prompt(request: &RequestAgentSuggestionsRequest) -> String {
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
        "Project name: {}\nProject path: {}\nActive tab id: {}\nActive tab title: {}\nExecution mode: {}\nUser task: {}\nRecent terminal logs (most recent last, max 50 lines):\n{}\n\nReturn one next command that best helps the developer continue from the current state.",
        request.project_name.trim(),
        request.project_path.trim(),
        request.active_tab_id.as_deref().unwrap_or("none"),
        request.active_tab_title.as_deref().unwrap_or("none"),
        execution_mode_label(request.execution_mode),
        request.user_task.trim(),
        log_lines,
    )
}

fn reasoning_effort(mode: ExecutionMode) -> &'static str {
    match mode {
        ExecutionMode::Fast => "low",
        ExecutionMode::Balanced => "medium",
        ExecutionMode::Deep => "high",
    }
}

fn execution_mode_label(mode: ExecutionMode) -> &'static str {
    match mode {
        ExecutionMode::Fast => "fast",
        ExecutionMode::Balanced => "balanced",
        ExecutionMode::Deep => "deep",
    }
}

fn extract_output_text(response_json: &Value) -> Option<String> {
    if let Some(output_text) = response_json.get("output_text").and_then(Value::as_str) {
        if !output_text.trim().is_empty() {
            return Some(output_text.to_string());
        }
    }

    response_json
        .get("output")
        .and_then(Value::as_array)
        .and_then(|items| {
            items.iter().find_map(|item| {
                item.get("content")
                    .and_then(Value::as_array)
                    .and_then(|content| {
                        content.iter().find_map(|entry| {
                            entry.get("text")
                                .and_then(Value::as_str)
                                .map(|text| text.to_string())
                        })
                    })
            })
        })
}

fn unix_timestamp_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

