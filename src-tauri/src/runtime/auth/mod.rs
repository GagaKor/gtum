use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

const PROVIDER_REVALIDATION_REQUIRED: &str =
    "The provider connection must be revalidated before making a request.";
const STALE_PROVIDER_RESULT: &str =
    "The provider connection changed while the operation was running. Retry the operation.";
const CLAUDE_VALIDATION_FAILURE: &str = "Claude authentication could not be validated. Check Claude credentials or run `claude auth login` in your own terminal, then reconnect Claude.";

#[derive(Default)]
pub struct AgentAuthManager {
    store: Mutex<AgentAuthStore>,
    storage_path: Mutex<Option<PathBuf>>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ProviderValidationLease {
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
                Ok(contents) => match parse_auth_store(&contents) {
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
            let Some(lease) = self.provider_refresh_lease(provider) else {
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
            let lease = ProviderValidationLease {
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
        lease: &ProviderValidationLease,
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
                snapshot.last_error =
                    Some(provider_validation_failure_message(lease.provider, &error));
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

    pub fn disconnect(&self, provider: AgentProvider) -> Result<AgentConnectionSnapshot, String> {
        self.disconnect_with_parent_sync(provider, sync_auth_store_parent)
    }

    fn disconnect_with_parent_sync(
        &self,
        provider: AgentProvider,
        sync_parent: impl FnOnce(&Path) -> Result<(), String>,
    ) -> Result<AgentConnectionSnapshot, String> {
        let mut store = self.store.lock().unwrap();
        let mut candidate = store.clone();
        let next_revision = store
            .connections
            .get(provider.as_key())
            .map(|snapshot| snapshot.runtime_revision.wrapping_add(1))
            .unwrap_or(1);
        let mut snapshot = AgentConnectionSnapshot::disconnected(provider);
        snapshot.runtime_revision = next_revision;
        candidate
            .connections
            .insert(provider.as_key().into(), snapshot.clone());
        self.persist_locked_with_parent_sync(&candidate, sync_parent)
            .map_err(|error| format!("failed to persist auth state after disconnect: {error}"))?;
        *store = candidate;
        Ok(snapshot)
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
    ) -> Result<ProviderValidationLease, String> {
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

        Ok(ProviderValidationLease {
            provider,
            revision: snapshot.runtime_revision,
        })
    }

    fn provider_refresh_lease(&self, provider: AgentProvider) -> Option<ProviderValidationLease> {
        let store = self.store.lock().unwrap();
        let snapshot = store.connections.get(provider.as_key())?;
        ((snapshot.status == AgentConnectionStatus::Connected
            || (provider == AgentProvider::Claude
                && snapshot.status == AgentConnectionStatus::Error))
            && snapshot.connection_kind == AgentConnectionKind::Real)
            .then_some(ProviderValidationLease {
                provider,
                revision: snapshot.runtime_revision,
            })
    }

    pub(crate) fn apply_validation_if_current(
        &self,
        lease: &ProviderValidationLease,
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
        lease: &ProviderValidationLease,
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
        lease: &ProviderValidationLease,
        validation: &Result<AgentProviderValidation, String>,
    ) -> bool {
        let mut store = self.store.lock().unwrap();
        let Some(snapshot) = store.connections.get_mut(lease.provider.as_key()) else {
            return false;
        };
        let refreshes_claude_error = lease.provider == AgentProvider::Claude
            && snapshot.status == AgentConnectionStatus::Error;
        if snapshot.runtime_revision != lease.revision
            || (snapshot.status != AgentConnectionStatus::Connected && !refreshes_claude_error)
            || snapshot.connection_kind != AgentConnectionKind::Real
        {
            return false;
        }

        let now = unix_timestamp_ms();
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
                    snapshot.status = AgentConnectionStatus::Connected;
                    snapshot.account_label = account_label;
                    snapshot.account_email = None;
                    snapshot.credential_source = credential_source;
                    snapshot.required_scopes = required_scopes;
                    if refreshes_claude_error {
                        snapshot.connected_at = Some(now);
                    }
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
                snapshot.last_error =
                    Some(provider_validation_failure_message(lease.provider, error));
                snapshot.runtime_validated = false;
            }
        }
        snapshot.updated_at = now;
        snapshot.bump_runtime_revision();
        if let Err(error) = self.persist_locked(&store) {
            log::warn!("failed to persist auth state after provider validation: {error}");
        }
        true
    }

    fn normalize_store(&self, store: &mut AgentAuthStore) {
        let now = unix_timestamp_ms();
        let mut loaded_connections = std::mem::take(&mut store.connections);
        store.connections = [AgentProvider::Codex, AgentProvider::Claude]
            .into_iter()
            .map(|provider| {
                let snapshot = loaded_connections
                    .remove(provider.as_key())
                    .filter(|snapshot| snapshot.provider == provider)
                    .unwrap_or_else(|| AgentConnectionSnapshot::disconnected(provider));
                (provider.as_key().to_string(), snapshot)
            })
            .collect();

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
                && matches!(
                    snapshot.status,
                    AgentConnectionStatus::Connected | AgentConnectionStatus::Error
                )
                && (stored_connection_kind != AgentConnectionKind::Real
                    || (snapshot.status == AgentConnectionStatus::Connected
                        && recognized_claude_credential.is_none()))
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
                    AgentConnectionStatus::Error => Some(CLAUDE_VALIDATION_FAILURE.to_string()),
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
        self.persist_locked_with_parent_sync(store, sync_auth_store_parent)
    }

    fn persist_locked_with_parent_sync(
        &self,
        store: &AgentAuthStore,
        sync_parent: impl FnOnce(&Path) -> Result<(), String>,
    ) -> Result<(), String> {
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
        write_auth_store_atomically_with_parent_sync(&path, serialized.as_bytes(), sync_parent)
    }
}

fn parse_auth_store(contents: &str) -> Result<AgentAuthStore, String> {
    let mut raw_store = serde_json::from_str::<serde_json::Value>(contents)
        .map_err(|error| format!("invalid auth state JSON: {error}"))?;
    let root = raw_store
        .as_object_mut()
        .ok_or_else(|| "auth state must be a top-level object".to_string())?;
    let raw_connections = root
        .get("connections")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| "auth state connections must be an object".to_string())?;
    let mut sanitized_connections = serde_json::Map::new();

    for provider in [AgentProvider::Codex, AgentProvider::Claude] {
        let Some(raw_snapshot) = raw_connections.get(provider.as_key()) else {
            continue;
        };
        let Ok(snapshot) = serde_json::from_value::<AgentConnectionSnapshot>(raw_snapshot.clone())
        else {
            continue;
        };
        if snapshot.provider != provider {
            continue;
        }
        let sanitized_snapshot = serde_json::to_value(snapshot)
            .map_err(|error| format!("failed to sanitize auth connection: {error}"))?;
        sanitized_connections.insert(provider.as_key().to_string(), sanitized_snapshot);
    }

    root.insert(
        "connections".to_string(),
        serde_json::Value::Object(sanitized_connections),
    );
    serde_json::from_value(raw_store).map_err(|error| format!("invalid auth state shape: {error}"))
}

fn write_auth_store_atomically_with_parent_sync(
    path: &Path,
    bytes: &[u8],
    sync_parent: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("auth storage path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("failed to prepare auth state directory: {error}"))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("agent-auth.json");
    let timestamp = unix_timestamp_ms();
    let mut temporary_file = None;

    for attempt in 0..100_u8 {
        let temporary = parent.join(format!(
            ".{file_name}.tmp-{}-{timestamp}-{attempt}",
            std::process::id()
        ));
        match OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
        {
            Ok(file) => {
                temporary_file = Some((temporary, file));
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!("failed to create auth state temp file: {error}"));
            }
        }
    }

    let (temporary, mut file) = temporary_file
        .ok_or_else(|| "failed to allocate a unique auth state temp file".to_string())?;
    if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(&temporary);
        return Err(format!("failed to write auth state temp file: {error}"));
    }
    drop(file);

    if let Err(error) = replace_auth_store_file(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }

    // Atomic destination replacement is the commit point: the synced candidate is now the
    // authoritative store. Directory sync can strengthen crash durability, but a failure here
    // cannot roll back the replacement and therefore must not become a false operation failure.
    if let Err(error) = sync_parent(parent) {
        log::warn!("auth state was committed but parent directory sync failed: {error}");
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn replace_auth_store_file(temporary: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(temporary, destination)
        .map_err(|error| format!("failed to replace auth state: {error}"))
}

#[cfg(target_os = "windows")]
fn replace_auth_store_file(temporary: &Path, destination: &Path) -> Result<(), String> {
    use std::{os::windows::ffi::OsStrExt, ptr};

    #[link(name = "Kernel32")]
    extern "system" {
        fn ReplaceFileW(
            replaced_file_name: *const u16,
            replacement_file_name: *const u16,
            backup_file_name: *const u16,
            replace_flags: u32,
            exclude: *mut std::ffi::c_void,
            reserved: *mut std::ffi::c_void,
        ) -> i32;
    }

    if !destination.exists() {
        return fs::rename(temporary, destination)
            .map_err(|error| format!("failed to install auth state: {error}"));
    }

    let destination_wide = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let temporary_wide = temporary
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let replaced = unsafe {
        ReplaceFileW(
            destination_wide.as_ptr(),
            temporary_wide.as_ptr(),
            ptr::null(),
            0,
            ptr::null_mut(),
            ptr::null_mut(),
        )
    };
    if replaced == 0 {
        Err(format!(
            "failed to atomically replace auth state: {}",
            std::io::Error::last_os_error()
        ))
    } else {
        Ok(())
    }
}

#[cfg(unix)]
fn sync_auth_store_parent(parent: &Path) -> Result<(), String> {
    fs::File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("failed to sync auth state directory: {error}"))
}

#[cfg(not(unix))]
fn sync_auth_store_parent(_parent: &Path) -> Result<(), String> {
    // Windows commits through a synced temporary file plus ReplaceFileW. Rust exposes no
    // portable parent-directory fsync there, so this best-effort hardening step is a no-op.
    Ok(())
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

pub(crate) fn provider_validation_failure_message(provider: AgentProvider, error: &str) -> String {
    match provider {
        AgentProvider::Claude => CLAUDE_VALIDATION_FAILURE.to_string(),
        AgentProvider::Codex => error.to_string(),
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
    fn migration_drops_noncanonical_connections_and_rejects_key_provider_mismatches() {
        let dir = unique_temp_dir("legacy-connection-map-boundary");
        let storage_path = dir.join("agent-auth.json");
        let legacy_store = serde_json::json!({
            "connections": {
                "codex": {
                    "provider": "claude",
                    "displayName": "Mismatched Claude",
                    "availability": "available",
                    "status": "error",
                    "connectionKind": "real",
                    "accountLabel": "mismatch-account-secret",
                    "accountEmail": "mismatch@example.com",
                    "credentialSource": "api_key_helper",
                    "requiredScopes": ["provider:request", "credential:api_key"],
                    "expiresAt": null,
                    "callbackUrl": "gtum://mismatch-secret",
                    "authUrl": "https://mismatch-secret.invalid",
                    "activeLoginId": "mismatch-login-secret",
                    "activeLoginState": "mismatch-state-secret",
                    "connectedAt": null,
                    "lastLoginAttemptAt": 900,
                    "updatedAt": 1_000,
                    "lastError": "mismatch-error-secret"
                },
                "claude": {
                    "provider": "claude",
                    "displayName": "Claude",
                    "availability": "available",
                    "status": "disconnected",
                    "connectionKind": "real",
                    "accountLabel": null,
                    "accountEmail": null,
                    "credentialSource": null,
                    "requiredScopes": ["provider:request"],
                    "expiresAt": null,
                    "callbackUrl": null,
                    "authUrl": null,
                    "activeLoginId": null,
                    "activeLoginState": null,
                    "connectedAt": null,
                    "lastLoginAttemptAt": null,
                    "updatedAt": 1_000,
                    "lastError": null
                },
                "claude-old": {
                    "provider": "claude",
                    "displayName": "Duplicate Claude",
                    "availability": "available",
                    "status": "connected",
                    "connectionKind": "real",
                    "accountLabel": "duplicate-account-secret",
                    "accountEmail": "duplicate@example.com",
                    "credentialSource": "claude_cli_session",
                    "requiredScopes": ["provider:request", "credential:cli_session"],
                    "expiresAt": null,
                    "callbackUrl": "gtum://duplicate-secret",
                    "authUrl": "https://duplicate-secret.invalid",
                    "activeLoginId": "duplicate-login-secret",
                    "activeLoginState": "duplicate-state-secret",
                    "connectedAt": 1_000,
                    "lastLoginAttemptAt": 900,
                    "updatedAt": 1_000,
                    "lastError": "duplicate-error-secret"
                },
                "codex-copy": {
                    "provider": "codex",
                    "displayName": "Duplicate Codex",
                    "availability": "available",
                    "status": "connected",
                    "connectionKind": "real",
                    "accountLabel": "duplicate-codex-secret",
                    "accountEmail": "duplicate-codex@example.com",
                    "credentialSource": null,
                    "requiredScopes": ["project:read", "terminal:read"],
                    "expiresAt": null,
                    "callbackUrl": null,
                    "authUrl": null,
                    "activeLoginId": null,
                    "activeLoginState": null,
                    "connectedAt": 1_000,
                    "lastLoginAttemptAt": 900,
                    "updatedAt": 1_000,
                    "lastError": "duplicate-codex-error-secret"
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

        let runtime = manager.runtime_snapshot();
        let persisted = fs::read_to_string(&storage_path).unwrap();
        let persisted_json: serde_json::Value = serde_json::from_str(&persisted).unwrap();
        let mut connection_keys = persisted_json["connections"]
            .as_object()
            .expect("connections should remain an object")
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        connection_keys.sort();
        assert_eq!(connection_keys, vec!["claude", "codex"]);
        assert_eq!(runtime.connections.len(), 2);

        let codex = runtime
            .connections
            .iter()
            .find(|connection| connection.provider == AgentProvider::Codex)
            .expect("canonical Codex connection should exist");
        assert_eq!(codex.status, AgentConnectionStatus::Disconnected);
        assert_eq!(codex.account_label, None);
        assert_eq!(codex.account_email, None);
        assert_eq!(codex.credential_source, None);
        assert_eq!(codex.last_error, None);

        let serialized_runtime = serde_json::to_string(&runtime).unwrap();
        for forbidden in [
            "mismatch-account-secret",
            "mismatch@example.com",
            "mismatch-error-secret",
            "duplicate-account-secret",
            "duplicate@example.com",
            "duplicate-error-secret",
            "duplicate-codex-secret",
            "duplicate-codex@example.com",
            "duplicate-codex-error-secret",
        ] {
            assert!(
                !serialized_runtime.contains(forbidden),
                "runtime exposed legacy connection data from an untrusted map entry"
            );
            assert!(
                !persisted.contains(forbidden),
                "migrated store retained legacy connection data from an untrusted map entry"
            );
        }

        remove_dir(&dir);
    }

    #[test]
    fn migration_drops_malformed_noncanonical_connection_before_typed_deserialization() {
        let dir = unique_temp_dir("malformed-noncanonical-connection");
        let storage_path = dir.join("agent-auth.json");
        let malformed_secret = "malformed-extra-credential-secret";
        let legacy_store = serde_json::json!({
            "connections": {
                "codex": serde_json::to_value(AgentConnectionSnapshot::disconnected(
                    AgentProvider::Codex,
                ))
                .unwrap(),
                "claude": serde_json::to_value(AgentConnectionSnapshot::disconnected(
                    AgentProvider::Claude,
                ))
                .unwrap(),
                "claude-malformed-copy": malformed_secret
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

        let runtime = manager.runtime_snapshot();
        let persisted = fs::read_to_string(&storage_path).unwrap();
        let persisted_json: serde_json::Value = serde_json::from_str(&persisted).unwrap();
        let mut connection_keys = persisted_json["connections"]
            .as_object()
            .expect("connections should remain an object")
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        connection_keys.sort();
        assert_eq!(connection_keys, vec!["claude", "codex"]);
        assert_eq!(runtime.connections.len(), 2);
        assert!(!persisted.contains(malformed_secret));
        assert!(!serde_json::to_string(&runtime)
            .unwrap()
            .contains(malformed_secret));

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
        let dir = unique_temp_dir("unvalidated-claude-scopes");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();

        let disconnected = claude_connection(&manager);
        assert_eq!(disconnected.status, AgentConnectionStatus::Disconnected);
        assert_eq!(disconnected.required_scopes, vec!["provider:request"]);
        assert_eq!(disconnected.credential_source, None);
        assert!(manager
            .provider_refresh_lease(AgentProvider::Claude)
            .is_none());

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

        let disconnected = manager.disconnect(AgentProvider::Claude).unwrap();
        assert_eq!(disconnected.status, AgentConnectionStatus::Disconnected);
        assert_eq!(disconnected.required_scopes, vec!["provider:request"]);
        assert_eq!(disconnected.credential_source, None);
        assert!(manager
            .provider_refresh_lease(AgentProvider::Claude)
            .is_none());

        remove_dir(&dir);
    }

    #[test]
    fn disconnect_failure_is_reported_without_publishing_or_losing_restart_state() {
        let dir = unique_temp_dir("disconnect-persistence-failure");
        let storage_dir = dir.join("state");
        let retained_storage_dir = dir.join("retained-state");
        let storage_path = storage_dir.join("agent-auth.json");
        let manager = AgentAuthManager::new();
        manager.initialize_storage(storage_path.clone()).unwrap();
        let failed = manager
            .begin_login_with_validation(AgentProvider::Claude, None, || {
                Err("Claude validation failed for raw-disconnect-secret".into())
            })
            .unwrap();
        assert_eq!(failed.status, AgentConnectionStatus::Error);
        let persisted_error = fs::read_to_string(&storage_path).unwrap();

        fs::rename(&storage_dir, &retained_storage_dir).unwrap();
        fs::write(&storage_dir, "block the auth storage directory").unwrap();

        let disconnect_error = manager
            .disconnect(AgentProvider::Claude)
            .err()
            .expect("disconnect should report a persistence failure");
        assert!(disconnect_error.contains("failed to persist auth state"));
        assert!(!disconnect_error.contains("raw-disconnect-secret"));
        let still_failed = claude_connection(&manager);
        assert_eq!(still_failed.status, AgentConnectionStatus::Error);
        assert_eq!(
            still_failed.last_error.as_deref(),
            Some(CLAUDE_VALIDATION_FAILURE)
        );
        assert!(manager
            .provider_refresh_lease(AgentProvider::Claude)
            .is_some());

        fs::remove_file(&storage_dir).unwrap();
        fs::rename(&retained_storage_dir, &storage_dir).unwrap();
        assert_eq!(fs::read_to_string(&storage_path).unwrap(), persisted_error);
        drop(manager);

        let reloaded = AgentAuthManager::new();
        reloaded.initialize_storage(storage_path).unwrap();
        let restored = claude_connection(&reloaded);
        assert_eq!(restored.status, AgentConnectionStatus::Error);
        assert_eq!(
            restored.last_error.as_deref(),
            Some(CLAUDE_VALIDATION_FAILURE)
        );
        assert!(reloaded
            .provider_refresh_lease(AgentProvider::Claude)
            .is_some());

        remove_dir(&dir);
    }

    #[test]
    fn post_replace_parent_sync_failure_does_not_split_memory_disk_or_restart_state() {
        let dir = unique_temp_dir("disconnect-parent-sync-failure");
        let storage_path = dir.join("agent-auth.json");
        let manager = AgentAuthManager::new();
        manager.initialize_storage(storage_path.clone()).unwrap();
        manager
            .begin_login_with_validation(AgentProvider::Claude, None, || {
                Err("Claude validation failed before explicit disconnect".into())
            })
            .unwrap();
        let sync_attempted = std::cell::Cell::new(false);

        let disconnected = manager
            .disconnect_with_parent_sync(AgentProvider::Claude, |parent| {
                assert_eq!(parent, storage_path.parent().unwrap());
                sync_attempted.set(true);
                Err("simulated parent directory sync failure".into())
            })
            .expect("atomic replacement is the disconnect commit point");

        assert!(sync_attempted.get());
        assert_eq!(disconnected.status, AgentConnectionStatus::Disconnected);
        assert_eq!(
            claude_connection(&manager).status,
            AgentConnectionStatus::Disconnected
        );
        assert!(manager
            .provider_refresh_lease(AgentProvider::Claude)
            .is_none());
        let persisted: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&storage_path).unwrap()).unwrap();
        assert_eq!(persisted["connections"]["claude"]["status"], "disconnected");
        drop(manager);

        let reloaded = AgentAuthManager::new();
        reloaded.initialize_storage(storage_path).unwrap();
        assert_eq!(
            claude_connection(&reloaded).status,
            AgentConnectionStatus::Disconnected
        );
        assert!(reloaded
            .provider_refresh_lease(AgentProvider::Claude)
            .is_none());

        remove_dir(&dir);
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
    fn failed_claude_begin_login_redacts_validation_error_immediately() {
        let dir = unique_temp_dir("failed-claude-begin-login-redaction");
        let storage_path = dir.join("agent-auth.json");
        let manager = AgentAuthManager::new();
        manager.initialize_storage(storage_path.clone()).unwrap();

        let failed = manager
            .begin_login_with_validation(AgentProvider::Claude, None, || {
                Err(
                    "Claude validation failed for private@example.com: raw-validation-secret"
                        .into(),
                )
            })
            .unwrap();
        let runtime = claude_connection(&manager);
        let serialized_runtime = serde_json::to_string(&runtime).unwrap();
        let persisted = fs::read_to_string(storage_path).unwrap();
        let persisted_json: serde_json::Value = serde_json::from_str(&persisted).unwrap();

        assert_eq!(failed.status, AgentConnectionStatus::Error);
        assert_eq!(runtime.status, AgentConnectionStatus::Error);
        assert_eq!(
            failed.last_error.as_deref(),
            Some(CLAUDE_VALIDATION_FAILURE)
        );
        assert_eq!(
            runtime.last_error.as_deref(),
            Some(CLAUDE_VALIDATION_FAILURE)
        );
        assert_eq!(
            persisted_json["connections"]["claude"]["lastError"],
            CLAUDE_VALIDATION_FAILURE
        );
        assert!(manager
            .provider_refresh_lease(AgentProvider::Claude)
            .is_some());
        for forbidden in ["private@example.com", "raw-validation-secret"] {
            assert!(
                !serialized_runtime.contains(forbidden),
                "runtime leaked synthetic validation data"
            );
            assert!(
                !persisted.contains(forbidden),
                "store leaked synthetic validation data"
            );
        }

        remove_dir(&dir);
    }

    #[test]
    fn startup_refresh_recovers_persisted_claude_error() {
        let dir = unique_temp_dir("startup-claude-error-recovery");
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

        let connected_lease = manager
            .require_stored_connected_provider(AgentProvider::Claude)
            .unwrap();
        let validation_failure =
            Err("Claude validation failed for private@example.com: raw-validation-secret".into());
        assert!(manager.apply_claude_validation_if_current(&connected_lease, &validation_failure,));
        let failed = claude_connection(&manager);
        let serialized_runtime_error = serde_json::to_string(&failed).unwrap();
        let persisted_error = fs::read_to_string(&storage_path).unwrap();
        let persisted_error_json: serde_json::Value =
            serde_json::from_str(&persisted_error).unwrap();
        assert_eq!(failed.status, AgentConnectionStatus::Error);
        assert_eq!(failed.account_label, None);
        assert_eq!(failed.account_email, None);
        assert_eq!(
            failed.last_error.as_deref(),
            Some(CLAUDE_VALIDATION_FAILURE)
        );
        assert_eq!(
            persisted_error_json["connections"]["claude"]["status"],
            "error"
        );
        assert_eq!(
            persisted_error_json["connections"]["claude"]["lastError"],
            CLAUDE_VALIDATION_FAILURE
        );
        for forbidden in ["private@example.com", "raw-validation-secret"] {
            assert!(
                !serialized_runtime_error.contains(forbidden),
                "runtime leaked synthetic validation data before reload"
            );
            assert!(
                !persisted_error.contains(forbidden),
                "store leaked synthetic validation data before reload"
            );
        }
        drop(manager);

        let reloaded = AgentAuthManager::new();
        reloaded.initialize_storage(storage_path.clone()).unwrap();
        assert_eq!(
            claude_connection(&reloaded).last_error.as_deref(),
            Some(CLAUDE_VALIDATION_FAILURE)
        );
        let startup_lease = reloaded
            .provider_refresh_lease(AgentProvider::Claude)
            .expect("a persisted real Claude error should be eligible for startup refresh");
        let repeated_failure =
            Err("Claude validation failed for second@example.com: second-raw-secret".into());
        assert!(reloaded.apply_claude_validation_if_current(&startup_lease, &repeated_failure,));
        let refreshed_error = claude_connection(&reloaded);
        assert_eq!(refreshed_error.status, AgentConnectionStatus::Error);
        assert_eq!(
            refreshed_error.last_error.as_deref(),
            Some(CLAUDE_VALIDATION_FAILURE)
        );
        assert!(!refreshed_error.runtime_validated);
        assert_eq!(refreshed_error.credential_source, None);
        assert_eq!(refreshed_error.required_scopes, vec!["provider:request"]);
        assert_eq!(refreshed_error.connected_at, None);
        let repeated_persisted_error = fs::read_to_string(&storage_path).unwrap();
        for forbidden in ["second@example.com", "second-raw-secret"] {
            assert!(
                !repeated_persisted_error.contains(forbidden),
                "refreshed error store leaked synthetic validation data"
            );
        }
        let recovery_lease = reloaded
            .provider_refresh_lease(AgentProvider::Claude)
            .expect("a current real Claude error should remain eligible after a failed refresh");
        assert!(reloaded.apply_claude_validation_if_current(
            &recovery_lease,
            &Ok(crate::runtime::claude::ClaudeConnectionValidation {
                credential_source: crate::runtime::claude::ClaudeCredentialSource::CliSession,
            }),
        ));

        let recovered = claude_connection(&reloaded);
        assert_eq!(recovered.status, AgentConnectionStatus::Connected);
        assert_eq!(recovered.connection_kind, AgentConnectionKind::Real);
        assert_eq!(
            recovered.credential_source.as_deref(),
            Some("claude_cli_session")
        );
        assert_eq!(
            recovered.required_scopes,
            vec!["provider:request", "credential:cli_session"]
        );
        assert_eq!(recovered.account_label, None);
        assert_eq!(recovered.account_email, None);
        assert_eq!(recovered.last_error, None);
        assert!(recovered.connected_at.is_some());
        assert!(recovered.runtime_validated);

        let persisted = fs::read_to_string(storage_path).unwrap();
        for forbidden in [
            "private@example.com",
            "raw-validation-secret",
            "second@example.com",
            "second-raw-secret",
        ] {
            assert!(
                !persisted.contains(forbidden),
                "recovered store leaked synthetic validation data"
            );
        }

        remove_dir(&dir);
    }

    #[test]
    fn stale_startup_error_refresh_cannot_overwrite_disconnect_or_reconnect() {
        let dir = unique_temp_dir("stale-startup-claude-error-refresh");
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
        let connected_lease = manager
            .require_stored_connected_provider(AgentProvider::Claude)
            .unwrap();
        assert!(manager.apply_claude_validation_if_current(
            &connected_lease,
            &Err("Claude CLI session needs refresh".into()),
        ));
        drop(manager);

        let reloaded = AgentAuthManager::new();
        reloaded.initialize_storage(storage_path).unwrap();
        let stale_startup_lease = reloaded
            .provider_refresh_lease(AgentProvider::Claude)
            .expect("a persisted real Claude error should be eligible for startup refresh");
        let cli_session = Ok(crate::runtime::claude::ClaudeConnectionValidation {
            credential_source: crate::runtime::claude::ClaudeCredentialSource::CliSession,
        });

        reloaded.disconnect(AgentProvider::Claude).unwrap();
        assert!(reloaded
            .provider_refresh_lease(AgentProvider::Claude)
            .is_none());
        assert!(!reloaded.apply_claude_validation_if_current(&stale_startup_lease, &cli_session));
        let disconnected = claude_connection(&reloaded);
        assert_eq!(disconnected.status, AgentConnectionStatus::Disconnected);
        assert_eq!(disconnected.credential_source, None);
        assert_eq!(disconnected.required_scopes, vec!["provider:request"]);

        reloaded
            .begin_login_with_validation(AgentProvider::Claude, None, || {
                Ok(runtime_claude_validation(
                    crate::runtime::claude::ClaudeCredentialSource::EnvironmentApiKey,
                ))
            })
            .unwrap();
        assert!(!reloaded.apply_claude_validation_if_current(&stale_startup_lease, &cli_session));
        let reconnected = claude_connection(&reloaded);
        assert_eq!(reconnected.status, AgentConnectionStatus::Connected);
        assert_eq!(
            reconnected.credential_source.as_deref(),
            Some("anthropic_api_key")
        );
        assert_eq!(
            reconnected.required_scopes,
            vec!["provider:request", "credential:api_key"]
        );
        assert!(reconnected.runtime_validated);

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
        let dir = unique_temp_dir("stale-cli-session-revalidation");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
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

        manager.disconnect(AgentProvider::Claude).unwrap();
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

        remove_dir(&dir);
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
        let dir = unique_temp_dir("stale-validation-disconnect");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        connect_codex_for_test(&manager);
        let lease = manager
            .require_stored_connected_provider(AgentProvider::Codex)
            .unwrap();
        manager.disconnect(AgentProvider::Codex).unwrap();

        manager.apply_validation_if_current(&lease, &Ok("Stale Account".into()));

        let codex = manager
            .runtime_snapshot()
            .connections
            .into_iter()
            .find(|connection| connection.provider == AgentProvider::Codex)
            .unwrap();
        assert_eq!(codex.status, AgentConnectionStatus::Disconnected);
        assert_eq!(codex.account_label, None);

        remove_dir(&dir);
    }

    #[test]
    fn stale_validation_cannot_overwrite_reconnect() {
        let dir = unique_temp_dir("stale-validation-reconnect");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        connect_codex_for_test(&manager);
        let stale_lease = manager
            .require_stored_connected_provider(AgentProvider::Codex)
            .unwrap();
        manager.disconnect(AgentProvider::Codex).unwrap();
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

        remove_dir(&dir);
    }

    #[test]
    fn delayed_connect_cannot_overwrite_disconnect() {
        let dir = unique_temp_dir("delayed-connect-disconnect");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();

        let result = manager.begin_login_with_validation(AgentProvider::Claude, None, || {
            manager.disconnect(AgentProvider::Claude).unwrap();
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

        remove_dir(&dir);
    }

    #[test]
    fn delayed_connect_cannot_overwrite_newer_reconnect() {
        let dir = unique_temp_dir("delayed-connect-reconnect");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();

        let result = manager.begin_login_with_validation(AgentProvider::Claude, None, || {
            manager.disconnect(AgentProvider::Claude).unwrap();
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

        remove_dir(&dir);
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
        let persisted_json: serde_json::Value = serde_json::from_str(&persisted).unwrap();

        assert_eq!(claude.status, AgentConnectionStatus::Disconnected);
        assert_eq!(claude.connection_kind, AgentConnectionKind::Real);
        assert_eq!(claude.account_label, None);
        assert_eq!(claude.account_email, None);
        assert_eq!(claude.credential_source, None);
        assert!(claude
            .last_error
            .as_deref()
            .is_some_and(|message| message.contains("Reconnect Claude")));
        assert_eq!(claude.required_scopes, vec!["provider:request"]);
        assert_eq!(
            persisted_json["connections"]["claude"]["status"],
            "disconnected"
        );
        assert!(manager
            .provider_refresh_lease(AgentProvider::Claude)
            .is_none());
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
