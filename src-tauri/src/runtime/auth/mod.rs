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
        let mut store = self.store.lock().unwrap();
        if self.refresh_real_connections_locked(&mut store) {
            if let Err(error) = self.persist_locked(&store) {
                log::warn!("failed to persist auth state after provider refresh: {error}");
            }
        }

        let mut snapshots = store
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
        let required_scopes = requested_scopes
            .filter(|scopes| !scopes.is_empty())
            .unwrap_or_else(|| provider.required_scopes());

        let snapshot = store
            .connections
            .entry(provider.as_key().into())
            .or_insert_with(|| AgentConnectionSnapshot::disconnected(provider));

        snapshot.connection_kind = provider.default_connection_kind();
        snapshot.required_scopes = required_scopes;
        snapshot.callback_url = None;
        snapshot.auth_url = None;
        snapshot.active_login_id = None;
        snapshot.active_login_state = None;
        snapshot.last_login_attempt_at = Some(now);
        snapshot.updated_at = now;
        snapshot.expires_at = None;
        snapshot.last_error = None;

        match provider {
            AgentProvider::Codex => match crate::runtime::codex::validate_codex_connection() {
                Ok(account_label) => {
                    snapshot.status = AgentConnectionStatus::Connected;
                    snapshot.account_label = Some(account_label);
                    snapshot.account_email = None;
                    snapshot.connected_at = Some(now);
                }
                Err(error) => {
                    snapshot.status = AgentConnectionStatus::Error;
                    snapshot.account_label = None;
                    snapshot.account_email = None;
                    snapshot.connected_at = None;
                    snapshot.last_error = Some(error);
                }
            },
            AgentProvider::Claude => {
                snapshot.status = AgentConnectionStatus::Error;
                snapshot.account_label = None;
                snapshot.account_email = None;
                snapshot.connected_at = None;
                snapshot.last_error =
                    Some("Claude real-provider support is deferred for the first daily-use release.".into());
            }
        }

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
        if request.provider.default_connection_kind() == AgentConnectionKind::Real {
            return Err(
                "Callback-based provider login is no longer used for the desktop real-provider path."
                    .into(),
            );
        }

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
            snapshot.required_scopes = if request.requested_scopes.is_empty() {
                pending.scopes.clone()
            } else {
                request.requested_scopes.clone()
            };
            snapshot.expires_at = Some(pending.expires_at);

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

    pub fn require_connected_provider(
        &self,
        provider: AgentProvider,
    ) -> Result<AgentConnectionSnapshot, String> {
        let store = self.store.lock().unwrap();
        let snapshot = store
            .connections
            .get(provider.as_key())
            .cloned()
            .unwrap_or_else(|| AgentConnectionSnapshot::disconnected(provider));

        if snapshot.status != AgentConnectionStatus::Connected {
            return Err(match snapshot.last_error {
                Some(message) => message,
                None => format!("{} is not connected.", snapshot.display_name),
            });
        }

        Ok(snapshot)
    }

    fn normalize_store(&self, store: &mut AgentAuthStore) {
        for provider in [AgentProvider::Codex, AgentProvider::Claude] {
            let snapshot = store
                .connections
                .entry(provider.as_key().into())
                .or_insert_with(|| AgentConnectionSnapshot::disconnected(provider));

            snapshot.display_name = provider.display_name().into();
            snapshot.connection_kind = provider.default_connection_kind();
            if snapshot.required_scopes.is_empty() {
                snapshot.required_scopes = provider.required_scopes();
            }
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

    fn refresh_real_connections_locked(&self, store: &mut AgentAuthStore) -> bool {
        let mut changed = false;
        let now = unix_timestamp_ms();

        if let Some(snapshot) = store.connections.get_mut(AgentProvider::Codex.as_key()) {
            if snapshot.connection_kind == AgentConnectionKind::Real
                && snapshot.status == AgentConnectionStatus::Connected
            {
                match crate::runtime::codex::validate_codex_connection() {
                    Ok(account_label) => {
                        if snapshot.account_label.as_deref() != Some(account_label.as_str())
                            || snapshot.last_error.is_some()
                        {
                            snapshot.account_label = Some(account_label);
                            snapshot.last_error = None;
                            snapshot.updated_at = now;
                            changed = true;
                        }
                    }
                    Err(error) => {
                        snapshot.status = AgentConnectionStatus::Error;
                        snapshot.account_label = None;
                        snapshot.account_email = None;
                        snapshot.connected_at = None;
                        snapshot.last_error = Some(error);
                        snapshot.updated_at = now;
                        changed = true;
                    }
                }
            }
        }

        changed
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum AgentProvider {
    Codex,
    Claude,
}

impl AgentProvider {
    pub fn as_key(&self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Claude => "claude",
        }
    }

    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Codex => "Codex",
            Self::Claude => "Claude",
        }
    }

    fn default_connection_kind(&self) -> AgentConnectionKind {
        match self {
            Self::Codex => AgentConnectionKind::Real,
            Self::Claude => AgentConnectionKind::Prototype,
        }
    }

    fn required_scopes(&self) -> Vec<String> {
        match self {
            Self::Codex => vec!["project:read".into(), "terminal:read".into()],
            Self::Claude => vec!["provider:deferred".into()],
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
    #[serde(default, alias = "scopes")]
    pub required_scopes: Vec<String>,
    #[serde(default)]
    pub expires_at: Option<u64>,
    #[serde(default)]
    pub callback_url: Option<String>,
    #[serde(default)]
    pub auth_url: Option<String>,
    #[serde(default)]
    pub active_login_id: Option<String>,
    #[serde(default)]
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
            connection_kind: provider.default_connection_kind(),
            account_label: None,
            account_email: None,
            required_scopes: provider.required_scopes(),
            expires_at: None,
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::sync::atomic::{AtomicU64, Ordering};

    static UNIQUE_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn unique_temp_dir(label: &str) -> PathBuf {
        let counter = UNIQUE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "gtum-auth-{label}-{}-{}-{}",
            std::process::id(),
            unix_timestamp_ms(),
            counter
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn remove_dir(path: &Path) {
        let _ = fs::remove_dir_all(path);
    }

    fn claude_connection(manager: &AgentAuthManager) -> AgentConnectionSnapshot {
        manager
            .runtime_snapshot()
            .connections
            .into_iter()
            .find(|connection| connection.provider == AgentProvider::Claude)
            .expect("claude connection should exist")
    }

    #[test]
    fn persists_and_reloads_connection_state_round_trip() {
        let dir = unique_temp_dir("round-trip");
        let storage_path = dir.join("agent-auth.json");

        let manager = AgentAuthManager::new();
        manager.initialize_storage(storage_path.clone()).unwrap();

        // begin_login for the deferred Claude provider is environment-independent:
        // it deterministically lands the connection in an Error state and persists.
        let begun = manager.begin_login(AgentProvider::Claude, None);
        assert_eq!(begun.status, AgentConnectionStatus::Error);

        let reloaded = AgentAuthManager::new();
        reloaded.initialize_storage(storage_path).unwrap();
        let restored = claude_connection(&reloaded);

        assert_eq!(restored.status, AgentConnectionStatus::Error);
        assert_eq!(restored.last_error, begun.last_error);
        assert_eq!(restored.last_login_attempt_at, begun.last_login_attempt_at);

        remove_dir(&dir);
    }
}
