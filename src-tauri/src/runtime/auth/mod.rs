use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

const PROVIDER_REVALIDATION_REQUIRED: &str =
    "The provider connection must be revalidated before making a request.";
const STALE_PROVIDER_RESULT: &str =
    "The provider connection changed while the operation was running. Retry the operation.";

#[derive(Default)]
pub struct AgentAuthManager {
    store: Mutex<AgentAuthStore>,
    storage_path: Mutex<Option<PathBuf>>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ConnectedProviderLease {
    provider: AgentProvider,
    revision: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ClaudeCredentialMetadata {
    CliSession,
    EnvironmentApiKey,
    ApiKeyHelper,
}

impl ClaudeCredentialMetadata {
    fn persistence_label(self) -> &'static str {
        match self {
            Self::CliSession => "claude_cli_session",
            Self::EnvironmentApiKey => "anthropic_api_key",
            Self::ApiKeyHelper => "api_key_helper",
        }
    }

    fn from_runtime(source: crate::runtime::claude::ClaudeCredentialSource) -> Self {
        let metadata = match source {
            crate::runtime::claude::ClaudeCredentialSource::CliSession => Self::CliSession,
            crate::runtime::claude::ClaudeCredentialSource::EnvironmentApiKey => {
                Self::EnvironmentApiKey
            }
            crate::runtime::claude::ClaudeCredentialSource::ApiKeyHelper => Self::ApiKeyHelper,
        };
        debug_assert_eq!(metadata.persistence_label(), source.persistence_label());
        metadata
    }

    fn from_persistence_label(label: &str) -> Option<Self> {
        match label {
            "claude_cli_session" => Some(Self::CliSession),
            "anthropic_api_key" => Some(Self::EnvironmentApiKey),
            "api_key_helper" => Some(Self::ApiKeyHelper),
            _ => None,
        }
    }

    fn required_scopes(self) -> Vec<String> {
        let credential_scope = match self {
            Self::CliSession => "credential:cli_session",
            Self::EnvironmentApiKey | Self::ApiKeyHelper => "credential:api_key",
        };
        vec!["provider:request".into(), credential_scope.into()]
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct AgentProviderValidation {
    account_label: Option<String>,
    credential_source: Option<ClaudeCredentialMetadata>,
}

impl AgentProviderValidation {
    fn codex(account_label: String) -> Self {
        Self {
            account_label: Some(account_label),
            credential_source: None,
        }
    }

    fn claude(validation: crate::runtime::claude::ClaudeConnectionValidation) -> Self {
        Self {
            account_label: None,
            credential_source: Some(ClaudeCredentialMetadata::from_runtime(
                validation.credential_source,
            )),
        }
    }
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
                        self.persist()?;
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
        for provider in [AgentProvider::Codex, AgentProvider::Claude] {
            let Some(lease) = self.connected_provider_refresh_lease(provider) else {
                continue;
            };
            let validation = validate_provider_connection(provider);
            self.apply_provider_validation_if_current(&lease, &validation);
        }

        let store = self.store.lock().unwrap();
        let mut snapshots = store.connections.values().cloned().collect::<Vec<_>>();

        snapshots.sort_by(|left, right| left.display_name.cmp(&right.display_name));
        snapshots
    }

    pub fn begin_login(
        &self,
        provider: AgentProvider,
        requested_scopes: Option<Vec<String>>,
    ) -> Result<AgentConnectionSnapshot, String> {
        self.begin_login_with_validation(provider, requested_scopes, || {
            validate_provider_connection(provider)
        })
    }

    fn begin_login_with_validation(
        &self,
        provider: AgentProvider,
        requested_scopes: Option<Vec<String>>,
        validate: impl FnOnce() -> Result<AgentProviderValidation, String>,
    ) -> Result<AgentConnectionSnapshot, String> {
        let lease = {
            let mut store = self.store.lock().unwrap();
            let now = unix_timestamp_ms();
            let required_scopes = if provider == AgentProvider::Claude {
                provider.required_scopes()
            } else {
                requested_scopes
                    .filter(|scopes| !scopes.is_empty())
                    .unwrap_or_else(|| provider.required_scopes())
            };

            let snapshot = store
                .connections
                .entry(provider.as_key().into())
                .or_insert_with(|| AgentConnectionSnapshot::disconnected(provider));
            snapshot.provider = provider;
            snapshot.display_name = provider.display_name().into();
            snapshot.availability = provider.availability();
            snapshot.status = AgentConnectionStatus::Pending;
            snapshot.connection_kind = provider.default_connection_kind();
            snapshot.account_label = None;
            snapshot.account_email = None;
            snapshot.credential_source = None;
            snapshot.required_scopes = required_scopes;
            snapshot.callback_url = None;
            snapshot.auth_url = None;
            snapshot.active_login_id = None;
            snapshot.active_login_state = None;
            snapshot.last_login_attempt_at = Some(now);
            snapshot.updated_at = now;
            snapshot.expires_at = None;
            snapshot.connected_at = None;
            snapshot.last_error = None;
            snapshot.runtime_validated = false;
            snapshot.bump_runtime_revision();
            let lease = ConnectedProviderLease {
                provider,
                revision: snapshot.runtime_revision,
            };
            if let Err(error) = self.persist_locked(&store) {
                log::warn!("failed to persist pending provider validation: {error}");
            }
            lease
        };

        let validation = validate();
        self.finish_login_if_current(&lease, validation)
    }

    fn finish_login_if_current(
        &self,
        lease: &ConnectedProviderLease,
        validation: Result<AgentProviderValidation, String>,
    ) -> Result<AgentConnectionSnapshot, String> {
        let mut store = self.store.lock().unwrap();
        let Some(snapshot) = store.connections.get_mut(lease.provider.as_key()) else {
            return Err(STALE_PROVIDER_RESULT.into());
        };
        if snapshot.runtime_revision != lease.revision
            || snapshot.status != AgentConnectionStatus::Pending
            || snapshot.connection_kind != AgentConnectionKind::Real
        {
            return Err(STALE_PROVIDER_RESULT.into());
        }

        let now = unix_timestamp_ms();
        match validation {
            Ok(validation) => {
                if lease.provider == AgentProvider::Claude && validation.credential_source.is_none()
                {
                    snapshot.status = AgentConnectionStatus::Error;
                    snapshot.required_scopes = lease.provider.required_scopes();
                    snapshot.last_error =
                        Some("Claude validation returned no approved credential source.".into());
                    snapshot.runtime_validated = false;
                } else {
                    snapshot.status = AgentConnectionStatus::Connected;
                    snapshot.account_label = if lease.provider == AgentProvider::Claude {
                        None
                    } else {
                        validation.account_label
                    };
                    snapshot.account_email = None;
                    if lease.provider == AgentProvider::Claude {
                        snapshot.required_scopes = validation
                            .credential_source
                            .map(ClaudeCredentialMetadata::required_scopes)
                            .unwrap_or_else(|| lease.provider.required_scopes());
                    }
                    snapshot.credential_source = validation
                        .credential_source
                        .map(|source| source.persistence_label().to_string());
                    snapshot.connected_at = Some(now);
                    snapshot.last_error = None;
                    snapshot.runtime_validated = true;
                }
            }
            Err(error) => {
                snapshot.status = AgentConnectionStatus::Error;
                snapshot.account_label = None;
                snapshot.account_email = None;
                snapshot.credential_source = None;
                snapshot.connected_at = None;
                if lease.provider == AgentProvider::Claude {
                    snapshot.required_scopes = lease.provider.required_scopes();
                }
                snapshot.last_error = Some(error);
                snapshot.runtime_validated = false;
            }
        }
        snapshot.updated_at = now;
        snapshot.bump_runtime_revision();
        let result = snapshot.clone();
        if let Err(error) = self.persist_locked(&store) {
            log::warn!("failed to persist provider validation: {error}");
        }
        Ok(result)
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

            snapshot.bump_runtime_revision();
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
        let next_revision = store
            .connections
            .get(provider.as_key())
            .map(|snapshot| snapshot.runtime_revision.wrapping_add(1))
            .unwrap_or(1);
        let mut snapshot = AgentConnectionSnapshot::disconnected(provider);
        snapshot.runtime_revision = next_revision;
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

    pub(crate) fn require_stored_connected_provider(
        &self,
        provider: AgentProvider,
    ) -> Result<ConnectedProviderLease, String> {
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
        if snapshot.connection_kind != AgentConnectionKind::Real || !snapshot.runtime_validated {
            return Err(PROVIDER_REVALIDATION_REQUIRED.into());
        }

        Ok(ConnectedProviderLease {
            provider,
            revision: snapshot.runtime_revision,
        })
    }

    fn connected_provider_refresh_lease(
        &self,
        provider: AgentProvider,
    ) -> Option<ConnectedProviderLease> {
        let store = self.store.lock().unwrap();
        let snapshot = store.connections.get(provider.as_key())?;
        (snapshot.status == AgentConnectionStatus::Connected
            && snapshot.connection_kind == AgentConnectionKind::Real)
            .then_some(ConnectedProviderLease {
                provider,
                revision: snapshot.runtime_revision,
            })
    }

    pub(crate) fn apply_validation_if_current(
        &self,
        lease: &ConnectedProviderLease,
        validation: &Result<String, String>,
    ) -> bool {
        let validation = validation
            .as_ref()
            .map(|account_label| AgentProviderValidation::codex(account_label.clone()))
            .map_err(Clone::clone);
        self.apply_provider_validation_if_current(lease, &validation)
    }

    pub(crate) fn apply_claude_validation_if_current(
        &self,
        lease: &ConnectedProviderLease,
        validation: &Result<crate::runtime::claude::ClaudeConnectionValidation, String>,
    ) -> bool {
        let validation = validation
            .as_ref()
            .map(|validation| AgentProviderValidation::claude(*validation))
            .map_err(Clone::clone);
        self.apply_provider_validation_if_current(lease, &validation)
    }

    fn apply_provider_validation_if_current(
        &self,
        lease: &ConnectedProviderLease,
        validation: &Result<AgentProviderValidation, String>,
    ) -> bool {
        let mut store = self.store.lock().unwrap();
        let Some(snapshot) = store.connections.get_mut(lease.provider.as_key()) else {
            return false;
        };
        if snapshot.runtime_revision != lease.revision
            || snapshot.status != AgentConnectionStatus::Connected
            || snapshot.connection_kind != AgentConnectionKind::Real
        {
            return false;
        }

        match validation {
            Ok(validation) => {
                let account_label = if lease.provider == AgentProvider::Claude {
                    None
                } else {
                    validation.account_label.clone()
                };
                let required_scopes = if lease.provider == AgentProvider::Claude {
                    validation
                        .credential_source
                        .map(ClaudeCredentialMetadata::required_scopes)
                        .unwrap_or_else(|| lease.provider.required_scopes())
                } else {
                    snapshot.required_scopes.clone()
                };
                let credential_source = validation
                    .credential_source
                    .map(|source| source.persistence_label().to_string());
                if lease.provider == AgentProvider::Claude && credential_source.is_none() {
                    snapshot.status = AgentConnectionStatus::Error;
                    snapshot.account_label = None;
                    snapshot.account_email = None;
                    snapshot.credential_source = None;
                    snapshot.required_scopes = lease.provider.required_scopes();
                    snapshot.connected_at = None;
                    snapshot.last_error =
                        Some("Claude validation returned no approved credential source.".into());
                    snapshot.runtime_validated = false;
                } else if snapshot.account_label == account_label
                    && snapshot.credential_source == credential_source
                    && snapshot.required_scopes == required_scopes
                    && snapshot.last_error.is_none()
                    && snapshot.runtime_validated
                {
                    return true;
                } else {
                    snapshot.account_label = account_label;
                    snapshot.account_email = None;
                    snapshot.credential_source = credential_source;
                    snapshot.required_scopes = required_scopes;
                    snapshot.last_error = None;
                    snapshot.runtime_validated = true;
                }
            }
            Err(error) => {
                snapshot.status = AgentConnectionStatus::Error;
                snapshot.account_label = None;
                snapshot.account_email = None;
                snapshot.credential_source = None;
                if lease.provider == AgentProvider::Claude {
                    snapshot.required_scopes = lease.provider.required_scopes();
                }
                snapshot.connected_at = None;
                snapshot.last_error = Some(error.clone());
                snapshot.runtime_validated = false;
            }
        }
        snapshot.updated_at = unix_timestamp_ms();
        snapshot.bump_runtime_revision();
        if let Err(error) = self.persist_locked(&store) {
            log::warn!("failed to persist auth state after provider validation: {error}");
        }
        true
    }

    fn normalize_store(&self, store: &mut AgentAuthStore) {
        let now = unix_timestamp_ms();
        for provider in [AgentProvider::Codex, AgentProvider::Claude] {
            let snapshot = store
                .connections
                .entry(provider.as_key().into())
                .or_insert_with(|| AgentConnectionSnapshot::disconnected(provider));

            let stored_connection_kind = snapshot.connection_kind;
            let recognized_claude_credential = snapshot
                .credential_source
                .as_deref()
                .and_then(ClaudeCredentialMetadata::from_persistence_label);
            if provider == AgentProvider::Claude
                && snapshot.status == AgentConnectionStatus::Connected
                && (stored_connection_kind != AgentConnectionKind::Real
                    || recognized_claude_credential.is_none())
            {
                snapshot.normalize_untrusted_claude(now);
                continue;
            }

            snapshot.provider = provider;
            snapshot.display_name = provider.display_name().into();
            snapshot.connection_kind = provider.default_connection_kind();
            snapshot.availability = provider.availability();
            snapshot.runtime_validated = false;
            if provider == AgentProvider::Claude {
                let safe_last_error = match snapshot.status {
                    AgentConnectionStatus::Error => Some(
                        "Claude connection requires fresh Claude CLI validation before retrying."
                            .to_string(),
                    ),
                    AgentConnectionStatus::Pending => {
                        snapshot.status = AgentConnectionStatus::Disconnected;
                        Some("Reconnect Claude to start a fresh Claude CLI validation.".to_string())
                    }
                    AgentConnectionStatus::Disconnected | AgentConnectionStatus::Connected => None,
                };
                snapshot.account_label = None;
                snapshot.account_email = None;
                snapshot.required_scopes = match (snapshot.status, recognized_claude_credential) {
                    (AgentConnectionStatus::Connected, Some(source)) => source.required_scopes(),
                    _ => provider.required_scopes(),
                };
                snapshot.callback_url = None;
                snapshot.auth_url = None;
                snapshot.active_login_id = None;
                snapshot.active_login_state = None;
                snapshot.expires_at = None;
                if snapshot.status != AgentConnectionStatus::Connected {
                    snapshot.credential_source = None;
                    snapshot.connected_at = None;
                }
                snapshot.last_error = safe_last_error;
            } else if snapshot.required_scopes.is_empty() {
                snapshot.required_scopes = provider.required_scopes();
            }
        }

        store.pending_logins.retain(|_, pending| {
            pending.provider.default_connection_kind() != AgentConnectionKind::Real
        });
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
            Self::Claude => AgentConnectionKind::Real,
        }
    }

    fn required_scopes(&self) -> Vec<String> {
        match self {
            Self::Codex => vec!["project:read".into(), "terminal:read".into()],
            Self::Claude => vec!["provider:request".into()],
        }
    }

    fn availability(&self) -> AgentProviderAvailability {
        match self {
            Self::Codex => AgentProviderAvailability::Available,
            Self::Claude => AgentProviderAvailability::Available,
        }
    }
}

#[derive(Default, Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AgentProviderAvailability {
    #[default]
    Available,
    Deferred,
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
    #[serde(default)]
    pub availability: AgentProviderAvailability,
    pub status: AgentConnectionStatus,
    pub connection_kind: AgentConnectionKind,
    pub account_label: Option<String>,
    pub account_email: Option<String>,
    #[serde(default)]
    pub credential_source: Option<String>,
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
    #[serde(skip)]
    runtime_revision: u64,
    #[serde(skip)]
    runtime_validated: bool,
}

impl AgentConnectionSnapshot {
    fn disconnected(provider: AgentProvider) -> Self {
        Self {
            provider,
            display_name: provider.display_name().into(),
            availability: provider.availability(),
            status: AgentConnectionStatus::Disconnected,
            connection_kind: provider.default_connection_kind(),
            account_label: None,
            account_email: None,
            credential_source: None,
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
            runtime_revision: 0,
            runtime_validated: false,
        }
    }

    fn bump_runtime_revision(&mut self) {
        self.runtime_revision = self.runtime_revision.wrapping_add(1);
    }

    fn normalize_untrusted_claude(&mut self, updated_at: u64) {
        let provider = AgentProvider::Claude;
        self.provider = provider;
        self.display_name = provider.display_name().into();
        self.availability = AgentProviderAvailability::Available;
        self.status = AgentConnectionStatus::Disconnected;
        self.connection_kind = provider.default_connection_kind();
        self.account_label = None;
        self.account_email = None;
        self.credential_source = None;
        self.required_scopes = provider.required_scopes();
        self.expires_at = None;
        self.callback_url = None;
        self.auth_url = None;
        self.active_login_id = None;
        self.active_login_state = None;
        self.connected_at = None;
        self.last_login_attempt_at = None;
        self.updated_at = updated_at;
        self.last_error = Some("Reconnect Claude to start a fresh Claude CLI validation.".into());
        self.runtime_validated = false;
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

fn validate_provider_connection(
    provider: AgentProvider,
) -> Result<AgentProviderValidation, String> {
    match provider {
        AgentProvider::Codex => {
            crate::runtime::codex::validate_codex_connection().map(AgentProviderValidation::codex)
        }
        AgentProvider::Claude => crate::runtime::claude::validate_claude_connection()
            .map(AgentProviderValidation::claude),
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

    fn serialized_availability(snapshot: &AgentConnectionSnapshot) -> Option<String> {
        let serialized = serde_json::to_value(snapshot).expect("snapshot should serialize");
        serialized
            .get("availability")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned)
    }

    fn connect_codex_for_test(manager: &AgentAuthManager) -> AgentConnectionSnapshot {
        let mut store = manager.store.lock().unwrap();
        let snapshot = store
            .connections
            .get_mut(AgentProvider::Codex.as_key())
            .expect("codex connection should exist");
        snapshot.status = AgentConnectionStatus::Connected;
        snapshot.account_label = Some("Codex Test Account".into());
        snapshot.connected_at = Some(unix_timestamp_ms());
        snapshot.last_error = None;
        snapshot.updated_at = unix_timestamp_ms();
        snapshot.runtime_validated = true;
        snapshot.bump_runtime_revision();
        snapshot.clone()
    }

    fn claude_validation(source: ClaudeCredentialMetadata) -> AgentProviderValidation {
        AgentProviderValidation {
            account_label: None,
            credential_source: Some(source),
        }
    }

    fn runtime_claude_validation(
        source: crate::runtime::claude::ClaudeCredentialSource,
    ) -> AgentProviderValidation {
        AgentProviderValidation::claude(crate::runtime::claude::ClaudeConnectionValidation {
            credential_source: source,
        })
    }

    #[test]
    fn converts_runtime_cli_session_validation_without_panicking() {
        let validation = std::panic::catch_unwind(|| {
            runtime_claude_validation(crate::runtime::claude::ClaudeCredentialSource::CliSession)
        })
        .expect("CLI-session validation should be a supported auth-manager source");

        assert_eq!(validation.account_label, None);
        assert_eq!(
            validation
                .credential_source
                .map(ClaudeCredentialMetadata::persistence_label),
            Some("claude_cli_session")
        );
    }

    #[test]
    fn normalizes_legacy_connected_claude_state_to_untrusted_real_provider() {
        let dir = unique_temp_dir("legacy-claude");
        let storage_path = dir.join("agent-auth.json");
        let legacy_store = serde_json::json!({
            "connections": {
                "claude": {
                    "provider": "claude",
                    "displayName": "Claude Legacy",
                    "availability": "deferred",
                    "status": "connected",
                    "connectionKind": "prototype",
                    "accountLabel": "Legacy Claude Account",
                    "accountEmail": "legacy@example.com",
                    "requiredScopes": ["account:read", "chat:write"],
                    "expiresAt": 9_999_999,
                    "callbackUrl": "gtum://auth/claude/callback",
                    "authUrl": "https://example.invalid/oauth/authorize",
                    "activeLoginId": "claude-login-7",
                    "activeLoginState": "legacy-claude-state",
                    "connectedAt": 1_000,
                    "lastLoginAttemptAt": 900,
                    "updatedAt": 1_000,
                    "lastError": null
                }
            },
            "pendingLogins": {
                "legacy-claude-state": {
                    "loginId": "claude-login-7",
                    "provider": "claude",
                    "state": "legacy-claude-state",
                    "callbackUrl": "gtum://auth/claude/callback",
                    "authUrl": "https://example.invalid/oauth/authorize",
                    "scopes": ["chat:write"],
                    "createdAt": 900,
                    "expiresAt": 9_999_999,
                    "consumedAt": null,
                    "lastError": null
                }
            },
            "nextLoginId": 8,
            "lastSyncedAt": 1_000
        });
        fs::write(
            &storage_path,
            serde_json::to_string_pretty(&legacy_store).unwrap(),
        )
        .unwrap();

        let manager = AgentAuthManager::new();
        manager.initialize_storage(storage_path.clone()).unwrap();
        let migrated_store: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(&storage_path).expect("migrated auth store should be readable"),
        )
        .expect("migrated auth store should remain valid JSON");
        let runtime = manager.runtime_snapshot();
        let codex = runtime
            .connections
            .iter()
            .find(|connection| connection.provider == AgentProvider::Codex)
            .expect("codex connection should exist");
        let restored = runtime
            .connections
            .iter()
            .find(|connection| connection.provider == AgentProvider::Claude)
            .expect("claude connection should exist");

        assert_eq!(runtime.last_synced_at, 1_000);
        assert_eq!(
            migrated_store["connections"]["claude"]["availability"],
            "available"
        );
        assert_eq!(
            migrated_store["connections"]["claude"]["status"],
            "disconnected"
        );
        assert!(migrated_store["connections"]["claude"]["accountLabel"].is_null());
        assert!(migrated_store["connections"]["claude"]["callbackUrl"].is_null());
        assert!(migrated_store["connections"]["claude"]["authUrl"].is_null());
        assert!(migrated_store["pendingLogins"]["legacy-claude-state"].is_null());
        assert_eq!(serialized_availability(codex).as_deref(), Some("available"));
        assert_eq!(
            serialized_availability(&restored).as_deref(),
            Some("available")
        );
        assert_eq!(restored.status, AgentConnectionStatus::Disconnected);
        assert_eq!(restored.account_label, None);
        assert_eq!(restored.account_email, None);
        assert_eq!(restored.expires_at, None);
        assert_eq!(restored.callback_url, None);
        assert_eq!(restored.auth_url, None);
        assert_eq!(restored.active_login_id, None);
        assert_eq!(restored.active_login_state, None);
        assert_eq!(restored.connected_at, None);
        assert_eq!(restored.last_login_attempt_at, None);
        assert_eq!(restored.connection_kind, AgentConnectionKind::Real);
        assert_eq!(restored.required_scopes, vec!["provider:request"]);
        assert_eq!(restored.credential_source, None);
        assert!(restored
            .last_error
            .as_deref()
            .is_some_and(|message| message.to_lowercase().contains("reconnect")));
        assert!(runtime
            .pending_logins
            .iter()
            .all(|login| login.provider != AgentProvider::Claude));

        remove_dir(&dir);
    }

    #[test]
    fn begin_login_connects_claude_with_non_secret_credential_metadata_only() {
        let dir = unique_temp_dir("begin-claude");
        let storage_path = dir.join("agent-auth.json");
        let manager = AgentAuthManager::new();
        manager.initialize_storage(storage_path).unwrap();

        let begun = manager
            .begin_login_with_validation(
                AgentProvider::Claude,
                Some(vec!["account:read".into(), "chat:write".into()]),
                || Ok(claude_validation(ClaudeCredentialMetadata::ApiKeyHelper)),
            )
            .unwrap();
        let runtime = manager.runtime_snapshot();

        assert_eq!(
            serialized_availability(&begun).as_deref(),
            Some("available")
        );
        assert_eq!(begun.connection_kind, AgentConnectionKind::Real);
        assert_eq!(begun.status, AgentConnectionStatus::Connected);
        assert_eq!(
            begun.required_scopes,
            vec!["provider:request", "credential:api_key"]
        );
        assert_eq!(begun.credential_source.as_deref(), Some("api_key_helper"));
        assert_eq!(begun.account_label, None);
        assert_eq!(begun.account_email, None);
        assert_eq!(begun.expires_at, None);
        assert_eq!(begun.callback_url, None);
        assert_eq!(begun.auth_url, None);
        assert_eq!(begun.active_login_id, None);
        assert_eq!(begun.active_login_state, None);
        assert!(begun.connected_at.is_some());
        assert!(begun.last_login_attempt_at.is_some());
        assert_eq!(begun.last_error, None);
        assert!(runtime
            .pending_logins
            .iter()
            .all(|login| login.provider != AgentProvider::Claude));

        remove_dir(&dir);
    }

    #[test]
    fn begin_login_connects_cli_session_with_source_scopes_and_no_identity() {
        let dir = unique_temp_dir("begin-claude-cli-session");
        let storage_path = dir.join("agent-auth.json");
        let manager = AgentAuthManager::new();
        manager.initialize_storage(storage_path.clone()).unwrap();

        let begun = manager
            .begin_login_with_validation(AgentProvider::Claude, None, || {
                Ok(runtime_claude_validation(
                    crate::runtime::claude::ClaudeCredentialSource::CliSession,
                ))
            })
            .unwrap();
        let persisted: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(storage_path).unwrap()).unwrap();
        let stored = &persisted["connections"]["claude"];

        assert_eq!(begun.status, AgentConnectionStatus::Connected);
        assert_eq!(begun.connection_kind, AgentConnectionKind::Real);
        assert_eq!(
            begun.required_scopes,
            vec!["provider:request", "credential:cli_session"]
        );
        assert_eq!(
            begun.credential_source.as_deref(),
            Some("claude_cli_session")
        );
        assert!(begun.runtime_validated);
        assert_eq!(stored["status"], "connected");
        assert_eq!(stored["connectionKind"], "real");
        assert_eq!(stored["credentialSource"], "claude_cli_session");
        assert_eq!(
            stored["requiredScopes"],
            serde_json::json!(["provider:request", "credential:cli_session"])
        );
        for field in [
            "accountLabel",
            "accountEmail",
            "expiresAt",
            "callbackUrl",
            "authUrl",
            "activeLoginId",
            "activeLoginState",
            "lastError",
        ] {
            assert!(stored[field].is_null(), "{field} should remain null");
        }
        for field in [
            "accessToken",
            "refreshToken",
            "authorizationCode",
            "apiKey",
            "oauthToken",
            "subscriptionType",
        ] {
            assert!(stored.get(field).is_none(), "{field} must not be persisted");
        }
        assert!(stored.get("runtimeValidated").is_none());

        remove_dir(&dir);
    }

    #[test]
    fn api_credential_sources_keep_api_key_scopes_and_safe_labels() {
        for (source, expected_label) in [
            (
                crate::runtime::claude::ClaudeCredentialSource::EnvironmentApiKey,
                "anthropic_api_key",
            ),
            (
                crate::runtime::claude::ClaudeCredentialSource::ApiKeyHelper,
                "api_key_helper",
            ),
        ] {
            let manager = AgentAuthManager::new();
            let connected = manager
                .begin_login_with_validation(AgentProvider::Claude, None, || {
                    Ok(runtime_claude_validation(source))
                })
                .unwrap();

            assert_eq!(connected.status, AgentConnectionStatus::Connected);
            assert_eq!(
                connected.required_scopes,
                vec!["provider:request", "credential:api_key"]
            );
            assert_eq!(connected.credential_source.as_deref(), Some(expected_label));
            assert_eq!(connected.account_label, None);
            assert_eq!(connected.account_email, None);
        }
    }

    #[test]
    fn unvalidated_claude_states_expose_only_source_neutral_scopes() {
        let manager = AgentAuthManager::new();

        let disconnected = claude_connection(&manager);
        assert_eq!(disconnected.status, AgentConnectionStatus::Disconnected);
        assert_eq!(disconnected.required_scopes, vec!["provider:request"]);
        assert_eq!(disconnected.credential_source, None);

        let failed = manager
            .begin_login_with_validation(AgentProvider::Claude, None, || {
                let pending = claude_connection(&manager);
                assert_eq!(pending.status, AgentConnectionStatus::Pending);
                assert_eq!(pending.required_scopes, vec!["provider:request"]);
                assert_eq!(pending.credential_source, None);
                Err("Claude CLI validation failed".into())
            })
            .unwrap();
        assert_eq!(failed.status, AgentConnectionStatus::Error);
        assert_eq!(failed.required_scopes, vec!["provider:request"]);
        assert_eq!(failed.credential_source, None);

        let disconnected = manager.disconnect(AgentProvider::Claude);
        assert_eq!(disconnected.status, AgentConnectionStatus::Disconnected);
        assert_eq!(disconnected.required_scopes, vec!["provider:request"]);
        assert_eq!(disconnected.credential_source, None);
    }

    #[test]
    fn persists_and_reloads_connection_state_round_trip() {
        let dir = unique_temp_dir("round-trip");
        let storage_path = dir.join("agent-auth.json");

        let manager = AgentAuthManager::new();
        manager.initialize_storage(storage_path.clone()).unwrap();

        let begun = manager
            .begin_login_with_validation(AgentProvider::Claude, None, || {
                Ok(claude_validation(
                    ClaudeCredentialMetadata::EnvironmentApiKey,
                ))
            })
            .unwrap();
        assert_eq!(begun.status, AgentConnectionStatus::Connected);

        let reloaded = AgentAuthManager::new();
        reloaded.initialize_storage(storage_path).unwrap();
        let restored = claude_connection(&reloaded);

        assert_eq!(
            serialized_availability(&restored).as_deref(),
            Some("available")
        );
        assert_eq!(restored.status, AgentConnectionStatus::Connected);
        assert_eq!(restored.connection_kind, AgentConnectionKind::Real);
        assert_eq!(
            restored.required_scopes,
            vec!["provider:request", "credential:api_key"]
        );
        assert_eq!(
            restored.credential_source.as_deref(),
            Some("anthropic_api_key")
        );
        assert_eq!(restored.account_label, None);
        assert_eq!(restored.account_email, None);
        assert!(!restored.runtime_validated);
        assert!(reloaded
            .require_stored_connected_provider(AgentProvider::Claude)
            .unwrap_err()
            .contains("revalidated"));

        remove_dir(&dir);
    }

    #[test]
    fn reload_recognizes_cli_session_but_scrubs_identity_and_requires_revalidation() {
        let dir = unique_temp_dir("cli-session-round-trip");
        let storage_path = dir.join("agent-auth.json");

        let manager = AgentAuthManager::new();
        manager.initialize_storage(storage_path.clone()).unwrap();
        manager
            .begin_login_with_validation(AgentProvider::Claude, None, || {
                Ok(runtime_claude_validation(
                    crate::runtime::claude::ClaudeCredentialSource::CliSession,
                ))
            })
            .unwrap();

        let mut poisoned: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&storage_path).unwrap()).unwrap();
        let stored = poisoned["connections"]["claude"]
            .as_object_mut()
            .expect("Claude state should be an object");
        stored.insert(
            "accountLabel".into(),
            serde_json::json!("Private Organization"),
        );
        stored.insert(
            "accountEmail".into(),
            serde_json::json!("private@example.com"),
        );
        stored.insert(
            "callbackUrl".into(),
            serde_json::json!("gtum://callback?token=callback-secret"),
        );
        stored.insert(
            "authUrl".into(),
            serde_json::json!("https://example.invalid/?token=auth-url-secret"),
        );
        stored.insert("activeLoginId".into(), serde_json::json!("legacy-login"));
        stored.insert(
            "activeLoginState".into(),
            serde_json::json!("legacy-state-secret"),
        );
        stored.insert(
            "accessToken".into(),
            serde_json::json!("oauth-token-secret"),
        );
        fs::write(
            &storage_path,
            serde_json::to_string_pretty(&poisoned).unwrap(),
        )
        .unwrap();

        let reloaded = AgentAuthManager::new();
        reloaded.initialize_storage(storage_path.clone()).unwrap();
        let restored = claude_connection(&reloaded);
        let repersisted = fs::read_to_string(storage_path).unwrap();

        assert_eq!(restored.status, AgentConnectionStatus::Connected);
        assert_eq!(restored.connection_kind, AgentConnectionKind::Real);
        assert_eq!(
            restored.credential_source.as_deref(),
            Some("claude_cli_session")
        );
        assert_eq!(
            restored.required_scopes,
            vec!["provider:request", "credential:cli_session"]
        );
        assert_eq!(restored.account_label, None);
        assert_eq!(restored.account_email, None);
        assert_eq!(restored.callback_url, None);
        assert_eq!(restored.auth_url, None);
        assert_eq!(restored.active_login_id, None);
        assert_eq!(restored.active_login_state, None);
        assert!(!restored.runtime_validated);
        assert!(reloaded
            .require_stored_connected_provider(AgentProvider::Claude)
            .unwrap_err()
            .contains("revalidated"));
        for forbidden in [
            "Private Organization",
            "private@example.com",
            "callback-secret",
            "auth-url-secret",
            "legacy-state-secret",
            "oauth-token-secret",
        ] {
            assert!(!repersisted.contains(forbidden), "store leaked {forbidden}");
        }

        remove_dir(&dir);
    }

    #[test]
    fn current_claude_revalidation_switches_source_and_scopes_together() {
        let manager = AgentAuthManager::new();
        manager
            .begin_login_with_validation(AgentProvider::Claude, None, || {
                Ok(runtime_claude_validation(
                    crate::runtime::claude::ClaudeCredentialSource::ApiKeyHelper,
                ))
            })
            .unwrap();
        let api_lease = manager
            .require_stored_connected_provider(AgentProvider::Claude)
            .unwrap();

        assert!(manager.apply_claude_validation_if_current(
            &api_lease,
            &Ok(crate::runtime::claude::ClaudeConnectionValidation {
                credential_source: crate::runtime::claude::ClaudeCredentialSource::CliSession,
            }),
        ));
        let cli_session = claude_connection(&manager);
        assert_eq!(
            cli_session.credential_source.as_deref(),
            Some("claude_cli_session")
        );
        assert_eq!(
            cli_session.required_scopes,
            vec!["provider:request", "credential:cli_session"]
        );
        assert!(cli_session.runtime_validated);

        let cli_lease = manager
            .require_stored_connected_provider(AgentProvider::Claude)
            .unwrap();
        assert!(manager.apply_claude_validation_if_current(
            &cli_lease,
            &Ok(crate::runtime::claude::ClaudeConnectionValidation {
                credential_source:
                    crate::runtime::claude::ClaudeCredentialSource::EnvironmentApiKey,
            }),
        ));
        let api_key = claude_connection(&manager);
        assert_eq!(
            api_key.credential_source.as_deref(),
            Some("anthropic_api_key")
        );
        assert_eq!(
            api_key.required_scopes,
            vec!["provider:request", "credential:api_key"]
        );
        assert!(api_key.runtime_validated);
    }

    #[test]
    fn stale_cli_session_revalidation_cannot_overwrite_disconnect_or_reconnect() {
        let manager = AgentAuthManager::new();
        manager
            .begin_login_with_validation(AgentProvider::Claude, None, || {
                Ok(runtime_claude_validation(
                    crate::runtime::claude::ClaudeCredentialSource::ApiKeyHelper,
                ))
            })
            .unwrap();
        let stale_lease = manager
            .require_stored_connected_provider(AgentProvider::Claude)
            .unwrap();
        let cli_session = Ok(crate::runtime::claude::ClaudeConnectionValidation {
            credential_source: crate::runtime::claude::ClaudeCredentialSource::CliSession,
        });

        manager.disconnect(AgentProvider::Claude);
        assert!(!manager.apply_claude_validation_if_current(&stale_lease, &cli_session));
        let disconnected = claude_connection(&manager);
        assert_eq!(disconnected.status, AgentConnectionStatus::Disconnected);
        assert_eq!(disconnected.credential_source, None);
        assert_eq!(disconnected.required_scopes, vec!["provider:request"]);

        manager
            .begin_login_with_validation(AgentProvider::Claude, None, || {
                Ok(runtime_claude_validation(
                    crate::runtime::claude::ClaudeCredentialSource::EnvironmentApiKey,
                ))
            })
            .unwrap();
        assert!(!manager.apply_claude_validation_if_current(&stale_lease, &cli_session));
        let reconnected = claude_connection(&manager);
        assert_eq!(reconnected.status, AgentConnectionStatus::Connected);
        assert_eq!(
            reconnected.credential_source.as_deref(),
            Some("anthropic_api_key")
        );
        assert_eq!(
            reconnected.required_scopes,
            vec!["provider:request", "credential:api_key"]
        );
    }

    #[test]
    fn stored_gate_rejects_disconnected_provider_without_mutating_codex() {
        let manager = AgentAuthManager::new();
        let before = connect_codex_for_test(&manager);

        let error = manager
            .require_stored_connected_provider(AgentProvider::Claude)
            .unwrap_err();
        let after = manager
            .runtime_snapshot()
            .connections
            .into_iter()
            .find(|connection| connection.provider == AgentProvider::Codex)
            .unwrap();

        assert!(error.contains("not connected"));
        assert_eq!(after.status, before.status);
        assert_eq!(after.account_label, before.account_label);
        assert_eq!(after.updated_at, before.updated_at);
    }

    #[test]
    fn current_validation_failure_updates_runtime_and_persisted_state() {
        let dir = unique_temp_dir("validation-failure");
        let storage_path = dir.join("agent-auth.json");
        let manager = AgentAuthManager::new();
        manager.initialize_storage(storage_path.clone()).unwrap();
        connect_codex_for_test(&manager);
        let lease = manager
            .require_stored_connected_provider(AgentProvider::Codex)
            .unwrap();

        manager.apply_validation_if_current(&lease, &Err("Codex session expired".into()));

        let runtime = manager.runtime_snapshot();
        let codex = runtime
            .connections
            .into_iter()
            .find(|connection| connection.provider == AgentProvider::Codex)
            .unwrap();
        let persisted: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(storage_path).unwrap()).unwrap();
        assert_eq!(codex.status, AgentConnectionStatus::Error);
        assert_eq!(codex.connected_at, None);
        assert_eq!(codex.last_error.as_deref(), Some("Codex session expired"));
        assert_eq!(persisted["connections"]["codex"]["status"], "error");
        assert_eq!(
            persisted["connections"]["codex"]["lastError"],
            "Codex session expired"
        );

        remove_dir(&dir);
    }

    #[test]
    fn stale_validation_cannot_overwrite_disconnect() {
        let manager = AgentAuthManager::new();
        connect_codex_for_test(&manager);
        let lease = manager
            .require_stored_connected_provider(AgentProvider::Codex)
            .unwrap();
        manager.disconnect(AgentProvider::Codex);

        manager.apply_validation_if_current(&lease, &Ok("Stale Account".into()));

        let codex = manager
            .runtime_snapshot()
            .connections
            .into_iter()
            .find(|connection| connection.provider == AgentProvider::Codex)
            .unwrap();
        assert_eq!(codex.status, AgentConnectionStatus::Disconnected);
        assert_eq!(codex.account_label, None);
    }

    #[test]
    fn stale_validation_cannot_overwrite_reconnect() {
        let manager = AgentAuthManager::new();
        connect_codex_for_test(&manager);
        let stale_lease = manager
            .require_stored_connected_provider(AgentProvider::Codex)
            .unwrap();
        manager.disconnect(AgentProvider::Codex);
        let reconnected = connect_codex_for_test(&manager);

        manager.apply_validation_if_current(&stale_lease, &Err("stale failure".into()));

        let codex = manager
            .runtime_snapshot()
            .connections
            .into_iter()
            .find(|connection| connection.provider == AgentProvider::Codex)
            .unwrap();
        assert_eq!(codex.status, AgentConnectionStatus::Connected);
        assert_eq!(codex.account_label, reconnected.account_label);
        assert_eq!(codex.last_error, None);
    }

    #[test]
    fn delayed_connect_cannot_overwrite_disconnect() {
        let manager = AgentAuthManager::new();

        let result = manager.begin_login_with_validation(AgentProvider::Claude, None, || {
            manager.disconnect(AgentProvider::Claude);
            Ok(claude_validation(
                ClaudeCredentialMetadata::EnvironmentApiKey,
            ))
        });

        let error = match result {
            Ok(_) => panic!("stale connect should not overwrite disconnect"),
            Err(error) => error,
        };
        assert!(error.to_lowercase().contains("retry"));
        let claude = claude_connection(&manager);
        assert_eq!(claude.status, AgentConnectionStatus::Disconnected);
        assert_eq!(claude.credential_source, None);
    }

    #[test]
    fn delayed_connect_cannot_overwrite_newer_reconnect() {
        let manager = AgentAuthManager::new();

        let result = manager.begin_login_with_validation(AgentProvider::Claude, None, || {
            manager.disconnect(AgentProvider::Claude);
            manager
                .begin_login_with_validation(AgentProvider::Claude, None, || {
                    Ok(claude_validation(ClaudeCredentialMetadata::ApiKeyHelper))
                })
                .unwrap();
            Ok(claude_validation(
                ClaudeCredentialMetadata::EnvironmentApiKey,
            ))
        });

        let error = match result {
            Ok(_) => panic!("stale connect should not overwrite reconnect"),
            Err(error) => error,
        };
        assert!(error.to_lowercase().contains("retry"));
        let claude = claude_connection(&manager);
        assert_eq!(claude.status, AgentConnectionStatus::Connected);
        assert_eq!(claude.credential_source.as_deref(), Some("api_key_helper"));
    }

    #[test]
    fn claude_connect_is_provider_isolated_and_persists_no_secret_or_identity() {
        let dir = unique_temp_dir("claude-secret-boundary");
        let storage_path = dir.join("agent-auth.json");
        let manager = AgentAuthManager::new();
        manager.initialize_storage(storage_path.clone()).unwrap();
        let codex_before = connect_codex_for_test(&manager);

        let claude = manager
            .begin_login_with_validation(AgentProvider::Claude, None, || {
                Ok(claude_validation(ClaudeCredentialMetadata::ApiKeyHelper))
            })
            .unwrap();
        let codex_after = manager
            .runtime_snapshot()
            .connections
            .into_iter()
            .find(|connection| connection.provider == AgentProvider::Codex)
            .unwrap();
        let persisted = fs::read_to_string(storage_path).unwrap();

        assert_eq!(claude.account_label, None);
        assert_eq!(claude.account_email, None);
        assert_eq!(claude.credential_source.as_deref(), Some("api_key_helper"));
        assert_eq!(codex_after.status, codex_before.status);
        assert_eq!(codex_after.account_label, codex_before.account_label);
        assert!(persisted.contains("api_key_helper"));
        for forbidden in [
            "sk-ant-secret",
            "helper-command-secret",
            "private@example.com",
            "Private Organization",
            "oauth-token-secret",
        ] {
            assert!(!persisted.contains(forbidden));
        }

        remove_dir(&dir);
    }

    #[test]
    fn migration_scrubs_legacy_claude_error_text_and_identity_before_repersisting() {
        let dir = unique_temp_dir("claude-legacy-error-secret");
        let storage_path = dir.join("agent-auth.json");
        let legacy_store = serde_json::json!({
            "connections": {
                "claude": {
                    "provider": "claude",
                    "displayName": "Claude Legacy",
                    "status": "error",
                    "connectionKind": "prototype",
                    "accountLabel": "Private Organization",
                    "accountEmail": "private@example.com",
                    "credentialSource": "oauth-token-secret",
                    "requiredScopes": ["chat:write"],
                    "expiresAt": null,
                    "callbackUrl": "gtum://callback?token=callback-secret",
                    "authUrl": "https://example.invalid/?token=auth-url-secret",
                    "activeLoginId": "legacy-login",
                    "activeLoginState": "legacy-state-secret",
                    "connectedAt": null,
                    "lastLoginAttemptAt": 900,
                    "updatedAt": 1_000,
                    "lastError": "x-api-key: legacy-secret helper-command-secret oauth-token-secret private@example.com"
                }
            },
            "pendingLogins": {},
            "nextLoginId": 1,
            "lastSyncedAt": 1_000
        });
        fs::write(
            &storage_path,
            serde_json::to_string_pretty(&legacy_store).unwrap(),
        )
        .unwrap();

        let manager = AgentAuthManager::new();
        manager.initialize_storage(storage_path.clone()).unwrap();
        let claude = claude_connection(&manager);
        let runtime = serde_json::to_string(&claude).unwrap();
        let persisted = fs::read_to_string(storage_path).unwrap();

        assert_eq!(claude.status, AgentConnectionStatus::Error);
        assert_eq!(claude.connection_kind, AgentConnectionKind::Real);
        assert_eq!(claude.account_label, None);
        assert_eq!(claude.account_email, None);
        assert_eq!(claude.credential_source, None);
        assert!(claude
            .last_error
            .as_deref()
            .is_some_and(|message| message.contains("fresh Claude CLI validation")));
        assert_eq!(claude.required_scopes, vec!["provider:request"]);
        for forbidden in [
            "legacy-secret",
            "helper-command-secret",
            "oauth-token-secret",
            "private@example.com",
            "Private Organization",
            "callback-secret",
            "auth-url-secret",
            "legacy-state-secret",
            "x-api-key",
        ] {
            assert!(!runtime.contains(forbidden), "runtime leaked {forbidden}");
            assert!(!persisted.contains(forbidden), "store leaked {forbidden}");
        }

        remove_dir(&dir);
    }
}
