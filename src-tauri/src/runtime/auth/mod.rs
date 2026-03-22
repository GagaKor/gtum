use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

#[derive(Default)]
pub struct AgentAuthManager {
    store: Mutex<AgentAuthStore>,
    storage_path: Mutex<Option<PathBuf>>,
}

impl AgentAuthManager {
    pub fn new() -> Self {
        let mut store = AgentAuthStore::default();
        for provider in [AgentProvider::Codex, AgentProvider::Claude] {
            let snapshot = AgentConnectionSnapshot::disconnected(provider);
            store
                .connections
                .insert(snapshot.provider.as_key().into(), snapshot);
        }

        Self {
            store: Mutex::new(store),
            storage_path: Mutex::new(None),
        }
    }

    pub fn initialize_storage(&self, storage_path: PathBuf) -> Result<(), String> {
        if let Some(parent) = storage_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("failed to prepare auth state directory: {error}"))?;
        }

        {
            let mut slot = self.storage_path.lock().unwrap();
            *slot = Some(storage_path.clone());
        }

        if storage_path.exists() {
            match fs::read_to_string(&storage_path) {
                Ok(contents) => match serde_json::from_str::<AgentAuthStore>(&contents) {
                    Ok(mut loaded_store) => {
                        self.normalize_store(&mut loaded_store);
                        *self.store.lock().unwrap() = loaded_store;
                    }
                    Err(error) => {
                        log::warn!("failed to parse auth state: {error}");
                    }
                },
                Err(error) => {
                    log::warn!("failed to read auth state: {error}");
                }
            }
        } else {
            self.persist()?;
        }

        Ok(())
    }

    pub fn list_connections(&self) -> Vec<AgentConnectionSnapshot> {
        let mut snapshots = self
            .store
            .lock()
            .unwrap()
            .connections
            .values()
            .cloned()
            .collect::<Vec<_>>();

        snapshots.sort_by(|left, right| left.display_name.cmp(&right.display_name));
        snapshots
    }

    pub fn begin_login(
        &self,
        provider: AgentProvider,
        requested_scopes: Option<Vec<String>>,
    ) -> AgentConnectionSnapshot {
        let mut store = self.store.lock().unwrap();
        let now = unix_timestamp_ms();
        let scopes = requested_scopes.unwrap_or_default();
        let login_id = format!("{}-{}", provider.as_key(), store.next_login_id);
        store.next_login_id = store.next_login_id.saturating_add(1);

        let state = format!("{}-{}", login_id, now);
        let callback_url = format!(
            "gtum://auth/callback?provider={}&state={state}",
            provider.as_key()
        );
        let auth_url = format!(
            "https://auth.gtum.local/{}/start?state={state}",
            provider.as_key()
        );
        let login = AgentPendingLoginSnapshot {
            login_id: login_id.clone(),
            provider,
            state: state.clone(),
            callback_url: callback_url.clone(),
            auth_url: Some(auth_url.clone()),
            scopes: scopes.clone(),
            created_at: now,
            expires_at: now.saturating_add(15 * 60 * 1000),
            consumed_at: None,
            last_error: None,
        };

        store.pending_logins.insert(state.clone(), login);

        let snapshot = store
            .connections
            .entry(provider.as_key().into())
            .or_insert_with(|| AgentConnectionSnapshot::disconnected(provider));

        snapshot.status = AgentConnectionStatus::Pending;
        snapshot.scopes = scopes;
        snapshot.callback_url = Some(callback_url);
        snapshot.auth_url = Some(auth_url);
        snapshot.active_login_id = Some(login_id);
        snapshot.active_login_state = Some(state);
        snapshot.last_login_attempt_at = Some(now);
        snapshot.updated_at = now;
        snapshot.last_error = None;

        let result = snapshot.clone();
        if let Err(error) = self.persist_locked(&store) {
            log::warn!("failed to persist auth state after login start: {error}");
        }
        result
    }

    pub fn complete_login(
        &self,
        request: CompleteAgentLoginRequest,
    ) -> Result<AgentConnectionSnapshot, String> {
        let mut store = self.store.lock().unwrap();
        let now = unix_timestamp_ms();
        let callback_state = {
            let snapshot = store
                .connections
                .entry(request.provider.as_key().into())
                .or_insert_with(|| AgentConnectionSnapshot::disconnected(request.provider));

            request
                .callback_state
                .clone()
                .or_else(|| snapshot.active_login_state.clone())
                .ok_or_else(|| "callback_state is required to complete login".to_string())?
        };

        let pending = store
            .pending_logins
            .get(&callback_state)
            .cloned()
            .ok_or_else(|| format!("unknown provider login state: {callback_state}"))?;

        if pending.provider != request.provider {
            return Err("provider mismatch for callback payload".into());
        }

        let fail_reason = request
            .fail_reason
            .clone()
            .filter(|value| !value.trim().is_empty());
        let authorization_code = request
            .authorization_code
            .clone()
            .filter(|value| !value.trim().is_empty());
        let result = {
            let snapshot = store
                .connections
                .entry(request.provider.as_key().into())
                .or_insert_with(|| AgentConnectionSnapshot::disconnected(request.provider));

            snapshot.updated_at = now;
            snapshot.active_login_id = Some(pending.login_id.clone());
            snapshot.active_login_state = Some(pending.state.clone());
            snapshot.callback_url = Some(pending.callback_url.clone());
            snapshot.auth_url = pending.auth_url.clone();
            snapshot.scopes = if request.requested_scopes.is_empty() {
                pending.scopes.clone()
            } else {
                request.requested_scopes.clone()
            };

            if let Some(ref fail_reason) = fail_reason {
                snapshot.status = AgentConnectionStatus::Error;
                snapshot.account_label = None;
                snapshot.account_email = None;
                snapshot.connected_at = None;
                snapshot.last_error = Some(match request.error_description.as_ref() {
                    Some(description) if !description.trim().is_empty() => {
                        format!("{fail_reason}: {description}")
                    }
                    _ => fail_reason.clone(),
                });
            } else {
                snapshot.status = AgentConnectionStatus::Connected;
                snapshot.account_label = Some(
                    request
                        .account_label
                        .clone()
                        .filter(|value| !value.trim().is_empty())
                        .unwrap_or_else(|| format!("{} Account", request.provider.display_name())),
                );
                snapshot.account_email = request
                    .account_email
                    .clone()
                    .filter(|value| !value.trim().is_empty());
                snapshot.connected_at = Some(now);
                snapshot.last_error = None;
                if let Some(code) = authorization_code.clone() {
                    snapshot.auth_url = Some(format!(
                        "gtum://resolved/{}?code={code}",
                        request.provider.as_key()
                    ));
                }
            }

            snapshot.clone()
        };

        if let Some(pending_mut) = store.pending_logins.get_mut(&callback_state) {
            pending_mut.consumed_at = Some(now);
            pending_mut.last_error = fail_reason;
        }

        self.persist_locked(&store)?;
        Ok(result)
    }

    pub fn disconnect(&self, provider: AgentProvider) -> AgentConnectionSnapshot {
        let mut store = self.store.lock().unwrap();
        let snapshot = AgentConnectionSnapshot::disconnected(provider);
        store
            .connections
            .insert(provider.as_key().into(), snapshot.clone());
        if let Err(error) = self.persist_locked(&store) {
            log::warn!("failed to persist auth state after disconnect: {error}");
        }
        snapshot
    }

    pub fn runtime_snapshot(&self) -> AgentAuthRuntimeSnapshot {
        let store = self.store.lock().unwrap();
        AgentAuthRuntimeSnapshot {
            storage_path: self
                .storage_path
                .lock()
                .unwrap()
                .clone()
                .map(|value| value.to_string_lossy().into_owned()),
            supported_providers: vec![AgentProvider::Codex, AgentProvider::Claude],
            connections: store.connections.values().cloned().collect(),
            pending_logins: store.pending_logins.values().cloned().collect(),
            last_synced_at: store.last_synced_at,
        }
    }

    fn normalize_store(&self, store: &mut AgentAuthStore) {
        for provider in [AgentProvider::Codex, AgentProvider::Claude] {
            store
                .connections
                .entry(provider.as_key().into())
                .or_insert_with(|| AgentConnectionSnapshot::disconnected(provider));
        }
    }

    fn persist(&self) -> Result<(), String> {
        let store = self.store.lock().unwrap();
        self.persist_locked(&store)
    }

    fn persist_locked(&self, store: &AgentAuthStore) -> Result<(), String> {
        let path = self
            .storage_path
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| "auth storage path is not initialized".to_string())?;

        let mut snapshot = store.clone();
        snapshot.last_synced_at = unix_timestamp_ms();
        let serialized = serde_json::to_string_pretty(&snapshot)
            .map_err(|error| format!("failed to serialize auth state: {error}"))?;
        fs::write(path, serialized)
            .map_err(|error| format!("failed to persist auth state: {error}"))
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum AgentProvider {
    Codex,
    Claude,
}

impl AgentProvider {
    fn as_key(&self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Claude => "claude",
        }
    }

    fn display_name(&self) -> &'static str {
        match self {
            Self::Codex => "Codex",
            Self::Claude => "Claude",
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AgentConnectionStatus {
    Disconnected,
    Pending,
    Connected,
    Error,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AgentConnectionKind {
    Mock,
    Prototype,
    Real,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentConnectionSnapshot {
    pub provider: AgentProvider,
    pub display_name: String,
    pub status: AgentConnectionStatus,
    pub connection_kind: AgentConnectionKind,
    pub account_label: Option<String>,
    pub account_email: Option<String>,
    pub scopes: Vec<String>,
    pub callback_url: Option<String>,
    pub auth_url: Option<String>,
    pub active_login_id: Option<String>,
    pub active_login_state: Option<String>,
    pub connected_at: Option<u64>,
    pub last_login_attempt_at: Option<u64>,
    pub updated_at: u64,
    pub last_error: Option<String>,
}

impl AgentConnectionSnapshot {
    fn disconnected(provider: AgentProvider) -> Self {
        Self {
            provider,
            display_name: provider.display_name().into(),
            status: AgentConnectionStatus::Disconnected,
            connection_kind: AgentConnectionKind::Prototype,
            account_label: None,
            account_email: None,
            scopes: Vec::new(),
            callback_url: None,
            auth_url: None,
            active_login_id: None,
            active_login_state: None,
            connected_at: None,
            last_login_attempt_at: None,
            updated_at: unix_timestamp_ms(),
            last_error: None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentPendingLoginSnapshot {
    pub login_id: String,
    pub provider: AgentProvider,
    pub state: String,
    pub callback_url: String,
    pub auth_url: Option<String>,
    pub scopes: Vec<String>,
    pub created_at: u64,
    pub expires_at: u64,
    pub consumed_at: Option<u64>,
    pub last_error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentAuthRuntimeSnapshot {
    pub storage_path: Option<String>,
    pub supported_providers: Vec<AgentProvider>,
    pub connections: Vec<AgentConnectionSnapshot>,
    pub pending_logins: Vec<AgentPendingLoginSnapshot>,
    pub last_synced_at: u64,
}

#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentAuthStore {
    connections: HashMap<String, AgentConnectionSnapshot>,
    pending_logins: HashMap<String, AgentPendingLoginSnapshot>,
    next_login_id: u64,
    last_synced_at: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompleteAgentLoginRequest {
    pub provider: AgentProvider,
    pub callback_state: Option<String>,
    pub authorization_code: Option<String>,
    pub account_label: Option<String>,
    pub account_email: Option<String>,
    pub requested_scopes: Vec<String>,
    pub fail_reason: Option<String>,
    pub error_description: Option<String>,
}

fn unix_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}
