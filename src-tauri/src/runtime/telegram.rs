use std::{
    fs,
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TelegramLinkStatus {
    Disconnected,
    Pending,
    Connected,
    Error,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TelegramReportStatus {
    Queued,
    Sent,
    Failed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TelegramRemoteCommandStatus {
    Pending,
    Approved,
    Rejected,
    Executed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TelegramRemoteCommandTarget {
    CurrentTab,
    NewTab,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramBridgeSnapshot {
    pub status: TelegramLinkStatus,
    pub chat_label: Option<String>,
    pub callback_url: Option<String>,
    pub auth_url: Option<String>,
    pub allowed_commands: Vec<String>,
    pub connected_at: Option<u64>,
    pub updated_at: u64,
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramReportSnapshot {
    pub report_id: String,
    pub title: String,
    pub body: String,
    pub status: TelegramReportStatus,
    pub created_at: u64,
    pub delivered_at: Option<u64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramRemoteCommandSnapshot {
    pub command_id: String,
    pub source_label: String,
    pub summary: String,
    pub command: String,
    pub suggested_target: TelegramRemoteCommandTarget,
    pub status: TelegramRemoteCommandStatus,
    pub created_at: u64,
    pub resolved_at: Option<u64>,
    pub resolution_note: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramRuntimeSnapshot {
    pub storage_path: Option<String>,
    pub bridge: TelegramBridgeSnapshot,
    pub reports: Vec<TelegramReportSnapshot>,
    pub remote_commands: Vec<TelegramRemoteCommandSnapshot>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TelegramBridgeStore {
    bridge: TelegramBridgeSnapshot,
    reports: Vec<TelegramReportSnapshot>,
    remote_commands: Vec<TelegramRemoteCommandSnapshot>,
    next_report_id: u64,
    next_command_id: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteTelegramLinkRequest {
    pub authorization_code: Option<String>,
    pub chat_label: Option<String>,
    pub fail_reason: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTelegramReportRequest {
    pub title: String,
    pub body: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueTelegramRemoteCommandRequest {
    pub source_label: Option<String>,
    pub summary: String,
    pub command: String,
    pub suggested_target: Option<TelegramRemoteCommandTarget>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveTelegramRemoteCommandRequest {
    pub command_id: String,
    pub status: TelegramRemoteCommandStatus,
    pub resolution_note: Option<String>,
}

pub struct TelegramBridgeManager {
    store: Mutex<TelegramBridgeStore>,
    storage_path: Mutex<Option<PathBuf>>,
}

impl TelegramBridgeManager {
    pub fn new() -> Self {
        Self {
            store: Mutex::new(default_store()),
            storage_path: Mutex::new(None),
        }
    }

    pub fn initialize_storage(&self, storage_path: PathBuf) -> Result<(), String> {
        if let Some(parent) = storage_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("failed to prepare telegram state directory: {error}"))?;
        }

        {
            let mut slot = self.storage_path.lock().unwrap();
            *slot = Some(storage_path.clone());
        }

        if storage_path.exists() {
            match fs::read_to_string(&storage_path) {
                Ok(contents) => match serde_json::from_str::<TelegramBridgeStore>(&contents) {
                    Ok(mut loaded_store) => {
                        normalize_store(&mut loaded_store);
                        *self.store.lock().unwrap() = loaded_store;
                    }
                    Err(error) => {
                        log::warn!("failed to parse telegram state: {error}");
                    }
                },
                Err(error) => {
                    log::warn!("failed to read telegram state: {error}");
                }
            }
        } else {
            self.persist()?;
        }

        Ok(())
    }

    pub fn runtime_snapshot(&self) -> TelegramRuntimeSnapshot {
        let store = self.store.lock().unwrap();
        TelegramRuntimeSnapshot {
            storage_path: self
                .storage_path
                .lock()
                .unwrap()
                .clone()
                .map(|value| value.to_string_lossy().into_owned()),
            bridge: store.bridge.clone(),
            reports: store.reports.clone(),
            remote_commands: store.remote_commands.clone(),
        }
    }

    pub fn begin_link(&self) -> Result<TelegramBridgeSnapshot, String> {
        let mut store = self.store.lock().unwrap();
        let now = unix_timestamp_ms();
        store.bridge.status = TelegramLinkStatus::Pending;
        store.bridge.callback_url = Some("gtum://telegram/callback".into());
        store.bridge.auth_url = Some(format!(
            "https://telegram.gtum.local/connect?state=telegram-{}",
            now
        ));
        store.bridge.updated_at = now;
        store.bridge.last_error = None;
        self.persist_locked(&store)?;
        Ok(store.bridge.clone())
    }

    pub fn complete_link(
        &self,
        request: CompleteTelegramLinkRequest,
    ) -> Result<TelegramBridgeSnapshot, String> {
        let mut store = self.store.lock().unwrap();
        let now = unix_timestamp_ms();
        if let Some(fail_reason) = request.fail_reason.filter(|value| !value.trim().is_empty()) {
            store.bridge.status = TelegramLinkStatus::Error;
            store.bridge.chat_label = None;
            store.bridge.connected_at = None;
            store.bridge.updated_at = now;
            store.bridge.last_error = Some(fail_reason.trim().to_string());
            self.persist_locked(&store)?;
            return Ok(store.bridge.clone());
        }

        store.bridge.status = TelegramLinkStatus::Connected;
        store.bridge.chat_label = Some(
            request
                .chat_label
                .unwrap_or_else(|| "@gtum_ops".into())
                .trim()
                .to_string(),
        );
        store.bridge.connected_at = Some(now);
        store.bridge.updated_at = now;
        store.bridge.last_error = request
            .authorization_code
            .filter(|value| !value.trim().is_empty())
            .map(|code| format!("authorization code resolved: {code}"));
        self.persist_locked(&store)?;
        Ok(store.bridge.clone())
    }

    pub fn disconnect(&self) -> Result<TelegramBridgeSnapshot, String> {
        let mut store = self.store.lock().unwrap();
        store.bridge = default_bridge();
        self.persist_locked(&store)?;
        Ok(store.bridge.clone())
    }

    pub fn create_report(
        &self,
        request: CreateTelegramReportRequest,
    ) -> Result<TelegramReportSnapshot, String> {
        let mut store = self.store.lock().unwrap();
        if request.title.trim().is_empty() {
            return Err("telegram report title cannot be empty".into());
        }
        if request.body.trim().is_empty() {
            return Err("telegram report body cannot be empty".into());
        }

        let now = unix_timestamp_ms();
        let report = TelegramReportSnapshot {
            report_id: format!("telegram-report-{}", store.next_report_id),
            title: request.title.trim().to_string(),
            body: request.body.trim().to_string(),
            status: TelegramReportStatus::Sent,
            created_at: now,
            delivered_at: Some(now),
        };
        store.next_report_id = store.next_report_id.saturating_add(1);
        store.reports.insert(0, report.clone());
        store.reports.truncate(8);
        store.bridge.updated_at = now;
        self.persist_locked(&store)?;
        Ok(report)
    }

    pub fn queue_remote_command(
        &self,
        request: QueueTelegramRemoteCommandRequest,
    ) -> Result<TelegramRemoteCommandSnapshot, String> {
        if request.summary.trim().is_empty() {
            return Err("telegram remote command summary cannot be empty".into());
        }
        if request.command.trim().is_empty() {
            return Err("telegram remote command cannot be empty".into());
        }

        let mut store = self.store.lock().unwrap();
        let now = unix_timestamp_ms();
        let remote_command = TelegramRemoteCommandSnapshot {
            command_id: format!("telegram-command-{}", store.next_command_id),
            source_label: request
                .source_label
                .unwrap_or_else(|| "@gtum_ops".into())
                .trim()
                .to_string(),
            summary: request.summary.trim().to_string(),
            command: request.command.trim().to_string(),
            suggested_target: request
                .suggested_target
                .unwrap_or(TelegramRemoteCommandTarget::CurrentTab),
            status: TelegramRemoteCommandStatus::Pending,
            created_at: now,
            resolved_at: None,
            resolution_note: None,
        };
        store.next_command_id = store.next_command_id.saturating_add(1);
        store.remote_commands.insert(0, remote_command.clone());
        store.remote_commands.truncate(12);
        store.bridge.updated_at = now;
        self.persist_locked(&store)?;
        Ok(remote_command)
    }

    pub fn resolve_remote_command(
        &self,
        request: ResolveTelegramRemoteCommandRequest,
    ) -> Result<TelegramRemoteCommandSnapshot, String> {
        if request.status == TelegramRemoteCommandStatus::Pending {
            return Err("pending is not a valid terminal resolution state".into());
        }

        let mut store = self.store.lock().unwrap();
        let now = unix_timestamp_ms();
        let command_index = store
            .remote_commands
            .iter()
            .position(|entry| entry.command_id == request.command_id)
            .ok_or_else(|| format!("unknown telegram command id: {}", request.command_id))?;
        let resolution_note = request
            .resolution_note
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        {
            let command = store
                .remote_commands
                .get_mut(command_index)
                .ok_or_else(|| format!("unknown telegram command id: {}", request.command_id))?;
            command.status = request.status;
            command.resolved_at = Some(now);
            command.resolution_note = resolution_note;
        }
        store.bridge.updated_at = now;
        let result = store
            .remote_commands
            .get(command_index)
            .cloned()
            .ok_or_else(|| format!("unknown telegram command id: {}", request.command_id))?;
        self.persist_locked(&store)?;
        Ok(result)
    }

    fn persist(&self) -> Result<(), String> {
        let store = self.store.lock().unwrap();
        self.persist_locked(&store)
    }

    fn persist_locked(&self, store: &TelegramBridgeStore) -> Result<(), String> {
        let path = self
            .storage_path
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| "telegram storage path is not initialized".to_string())?;

        let serialized = serde_json::to_string_pretty(store)
            .map_err(|error| format!("failed to serialize telegram state: {error}"))?;
        fs::write(path, serialized)
            .map_err(|error| format!("failed to persist telegram state: {error}"))
    }
}

fn default_store() -> TelegramBridgeStore {
    TelegramBridgeStore {
        bridge: default_bridge(),
        reports: Vec::new(),
        remote_commands: Vec::new(),
        next_report_id: 1,
        next_command_id: 1,
    }
}

fn default_bridge() -> TelegramBridgeSnapshot {
    TelegramBridgeSnapshot {
        status: TelegramLinkStatus::Disconnected,
        chat_label: None,
        callback_url: None,
        auth_url: None,
        allowed_commands: vec!["/status".into(), "/rerun-tests".into(), "/git-diff".into()],
        connected_at: None,
        updated_at: unix_timestamp_ms(),
        last_error: None,
    }
}

fn normalize_store(store: &mut TelegramBridgeStore) {
    if store.bridge.allowed_commands.is_empty() {
        store.bridge.allowed_commands = default_bridge().allowed_commands;
    }
    if store.next_report_id == 0 {
        store.next_report_id = 1;
    }
    if store.next_command_id == 0 {
        store.next_command_id = 1;
    }
    if store.reports.len() > 8 {
        store.reports.truncate(8);
    }
    if store.remote_commands.len() > 12 {
        store.remote_commands.truncate(12);
    }
}

fn unix_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}
