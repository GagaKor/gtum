use std::{
    collections::HashMap,
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;

const PROVIDER_REVALIDATION_REQUIRED: &str =
    "The provider connection must be revalidated before making a request.";
const STALE_PROVIDER_RESULT: &str =
    "The provider connection changed while the operation was running. Retry the operation.";
const STALE_ACCOUNT_RESULT: &str =
    "The selected account changed while the operation was running. Retry the operation.";
const ACCOUNT_NOT_CONNECTED: &str =
    "The selected account is not connected. Check the account connection and retry.";
const CODEX_VALIDATION_FAILURE: &str =
    "Codex authentication could not be validated. Reconnect Codex.";
const CLAUDE_VALIDATION_FAILURE: &str = "Claude authentication could not be validated. Check Claude credentials or run `claude auth login` in your own terminal, then reconnect Claude.";
const PROFILE_ROOTS_DIRECTORY: &str = "agent-profile-roots";
const CODEX_PROFILE_CONFIG: &str = "cli_auth_credentials_store = \"file\"\n";
const MAX_CODEX_PROFILE_CONFIG_BYTES: usize = 64 * 1024;
const PROFILE_FORGET_WARNING: &str = "Forget does not log out or delete credentials.";
const CODEX_PROFILE_PROBE_TIMEOUT: Duration = Duration::from_secs(10);
const CODEX_PROFILE_PROBE_OUTPUT_LIMIT: usize = 1024 * 1024;
const MAX_PROFILE_ROOT_RECONCILIATION_ENTRIES: usize = 64;
#[cfg(target_os = "windows")]
const MAX_WINDOWS_BOUNDED_CHILD_THREAD_SNAPSHOT_ENTRIES: usize = 131_072;
static PROFILE_TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

fn ambient_codex_home_path() -> Result<PathBuf, String> {
    if let Some(path) = std::env::var_os("CODEX_HOME").filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(path));
    }
    let home = std::env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
        .or_else(|| {
            let drive = std::env::var_os("HOMEDRIVE")?;
            let path = std::env::var_os("HOMEPATH")?;
            Some(PathBuf::from(drive).join(path))
        })
        .ok_or_else(|| "the ambient Codex home directory is unavailable".to_string())?;
    Ok(home.join(".codex"))
}

pub(crate) fn capture_ambient_codex_account_execution_context(
) -> Result<CodexAccountExecutionContext, String> {
    let registry = AgentProfileRegistryV2::new();
    let lease = registry.account_lease(AgentProvider::Codex, CODEX_DEFAULT_ACCOUNT_ID)?;
    let root = OpenedAmbientCodexHome::capture(&ambient_codex_home_path()?)?;
    Ok(CodexAccountExecutionContext {
        lease,
        root: CodexAccountRoot::Ambient(Arc::new(root)),
    })
}

pub(crate) fn capture_ambient_claude_account_execution_context(
) -> Result<crate::runtime::claude::ClaudeAccountExecutionContext, String> {
    crate::runtime::claude::ClaudeAccountExecutionContext::capture(
        ambient_claude_account_profile_context()?,
    )
}

fn ambient_claude_account_profile_context() -> Result<ClaudeAccountProfileContext, String> {
    let registry = AgentProfileRegistryV2::new();
    Ok(ClaudeAccountProfileContext {
        lease: registry.account_lease(AgentProvider::Claude, CLAUDE_DEFAULT_ACCOUNT_ID)?,
        root: ClaudeAccountRoot::Ambient,
    })
}

#[cfg(test)]
pub(crate) fn test_ambient_claude_account_profile_context() -> ClaudeAccountProfileContext {
    ambient_claude_account_profile_context().expect("reserved Claude profile must be valid")
}

#[derive(Default)]
pub struct AgentAuthManager {
    store: Mutex<AgentAuthStore>,
    storage_path: Mutex<Option<PathBuf>>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AgentSetupShell {
    Zsh,
    Bash,
    PowerShell,
}

#[derive(Serialize, Deserialize, Clone, Debug, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfileSetupEnvironment {
    pub name: String,
    pub value: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfileSetupGuidance {
    pub provider: AgentProvider,
    pub account_id: String,
    pub supported: bool,
    pub program: Option<String>,
    pub environment: Vec<AgentProfileSetupEnvironment>,
    pub arguments: Vec<String>,
    pub rendered_command: Option<String>,
    pub warning: String,
    pub unsupported_reason: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentProfileRequest {
    pub provider: AgentProvider,
    pub alias: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameAgentProfileRequest {
    pub provider: AgentProvider,
    pub account_id: String,
    pub alias: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetAgentProfileRequest {
    pub provider: AgentProvider,
    pub account_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TargetAgentProfileLeaseRequest {
    pub provider: AgentProvider,
    pub account_id: String,
    pub incarnation: CanonicalDecimalU64,
    pub credential_revision: CanonicalDecimalU64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckAgentProfileRequest {
    pub provider: AgentProvider,
    pub account_id: String,
    #[serde(default)]
    pub requested_scopes: Option<Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadAgentProfileSetupGuidanceRequest {
    pub provider: AgentProvider,
    pub account_id: String,
    pub shell: AgentSetupShell,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CanonicalDecimalU64(u64);

impl CanonicalDecimalU64 {
    pub fn value(self) -> u64 {
        self.0
    }
}

impl From<u64> for CanonicalDecimalU64 {
    fn from(value: u64) -> Self {
        Self(value)
    }
}

impl Serialize for CanonicalDecimalU64 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.0.to_string())
    }
}

impl<'de> Deserialize<'de> for CanonicalDecimalU64 {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        struct CanonicalDecimalVisitor;

        impl serde::de::Visitor<'_> for CanonicalDecimalVisitor {
            type Value = CanonicalDecimalU64;

            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("a positive canonical unsigned 64-bit decimal string")
            }

            fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
            where
                E: serde::de::Error,
            {
                if value.is_empty()
                    || value.starts_with('0')
                    || !value.bytes().all(|byte| byte.is_ascii_digit())
                {
                    return Err(E::custom(
                        "revision must be a positive canonical decimal string",
                    ));
                }
                value
                    .parse::<u64>()
                    .map(CanonicalDecimalU64)
                    .map_err(|_| E::custom("revision exceeds the unsigned 64-bit range"))
            }
        }

        deserializer.deserialize_str(CanonicalDecimalVisitor)
    }
}

#[derive(Deserialize, Clone, Debug, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AuthorizeAgentProfileLeaseRequest {
    pub provider: AgentProvider,
    pub account_id: String,
    pub incarnation: CanonicalDecimalU64,
    pub credential_revision: CanonicalDecimalU64,
}

#[derive(Serialize, Clone, Debug, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfileResponse {
    pub provider: AgentProvider,
    pub account_id: String,
    pub alias: String,
    pub profile_kind: AgentProfileKind,
    pub is_default: bool,
    pub incarnation: CanonicalDecimalU64,
    pub metadata_revision: CanonicalDecimalU64,
    pub credential_revision: CanonicalDecimalU64,
    pub connection: AgentProfileConnection,
}

impl From<&AgentProfileRecord> for AgentProfileResponse {
    fn from(profile: &AgentProfileRecord) -> Self {
        Self {
            provider: profile.provider(),
            account_id: profile.account_id().to_string(),
            alias: profile.alias().to_string(),
            profile_kind: profile.profile_kind(),
            is_default: profile.is_default(),
            incarnation: profile.incarnation().into(),
            metadata_revision: profile.metadata_revision().into(),
            credential_revision: profile.credential_revision().into(),
            connection: profile.connection().clone(),
        }
    }
}

impl From<AgentProfileRecord> for AgentProfileResponse {
    fn from(profile: AgentProfileRecord) -> Self {
        Self::from(&profile)
    }
}

#[derive(Serialize, Clone, Debug, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfileTombstoneResponse {
    pub provider: AgentProvider,
    pub account_id: String,
    pub incarnation: CanonicalDecimalU64,
    pub credential_revision: CanonicalDecimalU64,
    pub forgotten_at: u64,
}

impl From<&AgentProfileTombstone> for AgentProfileTombstoneResponse {
    fn from(tombstone: &AgentProfileTombstone) -> Self {
        Self {
            provider: tombstone.provider(),
            account_id: tombstone.account_id().to_string(),
            incarnation: tombstone.incarnation().into(),
            credential_revision: tombstone.credential_revision().into(),
            forgotten_at: tombstone.forgotten_at(),
        }
    }
}

impl From<AgentProfileTombstone> for AgentProfileTombstoneResponse {
    fn from(tombstone: AgentProfileTombstone) -> Self {
        Self::from(&tombstone)
    }
}

#[derive(Serialize, Clone, Debug, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfileSnapshot {
    pub registry_version: u32,
    pub profiles: Vec<AgentProfileResponse>,
    pub tombstones: Vec<AgentProfileTombstoneResponse>,
}

#[derive(Serialize, Clone, Debug, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfileLeaseAuthorization {
    pub provider: AgentProvider,
    pub account_id: String,
    pub incarnation: CanonicalDecimalU64,
    pub credential_revision: CanonicalDecimalU64,
    pub authorized: bool,
}

impl AgentProfileSetupGuidance {
    pub fn supported(
        provider: AgentProvider,
        account_id: &str,
        program: &str,
        environment: Vec<AgentProfileSetupEnvironment>,
        arguments: Vec<String>,
        shell: AgentSetupShell,
    ) -> Self {
        let rendered_command = render_setup_command(shell, program, &environment, &arguments);
        Self {
            provider,
            account_id: account_id.to_string(),
            supported: true,
            program: Some(program.to_string()),
            environment,
            arguments,
            rendered_command: Some(rendered_command),
            warning: PROFILE_FORGET_WARNING.to_string(),
            unsupported_reason: None,
        }
    }

    fn unsupported(provider: AgentProvider, account_id: &str, reason: String) -> Self {
        Self {
            provider,
            account_id: account_id.to_string(),
            supported: false,
            program: None,
            environment: Vec::new(),
            arguments: Vec::new(),
            rendered_command: None,
            warning: PROFILE_FORGET_WARNING.to_string(),
            unsupported_reason: Some(reason),
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct ProviderValidationLease {
    provider: AgentProvider,
    revision: u64,
}

#[derive(Clone)]
pub(crate) struct CodexAccountExecutionContext {
    lease: AgentAccountLease,
    root: CodexAccountRoot,
}

#[derive(Clone)]
pub(crate) struct ClaudeAccountProfileContext {
    lease: AgentAccountLease,
    root: ClaudeAccountRoot,
}

pub(crate) struct CodexProfileConfigSnapshot {
    document: toml::Table,
}

impl CodexProfileConfigSnapshot {
    pub(crate) fn top_level_string(&self, key: &str) -> Option<String> {
        self.document
            .get(key)
            .and_then(toml::Value::as_str)
            .map(str::to_string)
    }
}

#[derive(Clone)]
enum CodexAccountRoot {
    Ambient(Arc<OpenedAmbientCodexHome>),
    Owned(Arc<OpenedProfileRoot>),
}

#[derive(Clone)]
enum ClaudeAccountRoot {
    Ambient,
    Owned(Arc<OpenedProfileRoot>),
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
        store
            .sync_reserved_profiles_from_connections(false)
            .expect("new auth store defaults must satisfy the v2 profile registry");

        Self {
            store: Mutex::new(store),
            storage_path: Mutex::new(None),
        }
    }

    pub fn initialize_storage(&self, storage_path: PathBuf) -> Result<(), String> {
        if storage_path.exists() {
            let contents = fs::read_to_string(&storage_path)
                .map_err(|error| format!("failed to read auth state: {error}"))?;
            let mut loaded_store = parse_auth_store(&contents)?;
            self.normalize_store(&mut loaded_store)?;
            reconcile_profile_root_orphans(&storage_path, &loaded_store.profile_registry)?;
            persist_auth_store_to_path_with_parent_sync(
                &loaded_store,
                &storage_path,
                sync_auth_store_parent,
            )?;
            let mut store = self.store.lock().unwrap();
            let mut slot = self.storage_path.lock().unwrap();
            *store = loaded_store;
            *slot = Some(storage_path);
        } else {
            if let Some(parent) = storage_path.parent() {
                fs::create_dir_all(parent)
                    .map_err(|error| format!("failed to prepare auth state directory: {error}"))?;
            }
            let store = self.store.lock().unwrap().clone();
            reconcile_profile_root_orphans(&storage_path, &store.profile_registry)?;
            persist_auth_store_to_path_with_parent_sync(
                &store,
                &storage_path,
                sync_auth_store_parent,
            )?;
            *self.storage_path.lock().unwrap() = Some(storage_path);
        }

        Ok(())
    }

    pub fn create_profile(
        &self,
        provider: AgentProvider,
        alias: &str,
    ) -> Result<AgentProfileRecord, String> {
        match provider {
            AgentProvider::Codex => self.create_profile_with_codex_probe(
                provider,
                alias,
                probe_codex_profile_capability,
            ),
            AgentProvider::Claude => {
                if additional_claude_profiles_supported_on(std::env::consts::OS) {
                    self.create_profile_with_probe(provider, alias, |_| Ok(()))
                } else if std::env::consts::OS == "macos" {
                    Err("unsupported_on_macos: additional Claude CLI profiles require CLAUDE_CONFIG_DIR credential isolation, which is supported only on Linux and Windows".to_string())
                } else {
                    Err("unsupported_platform: additional Claude CLI profiles require verified CLAUDE_CONFIG_DIR isolation".to_string())
                }
            }
        }
    }

    fn create_profile_with_codex_probe(
        &self,
        provider: AgentProvider,
        alias: &str,
        probe: impl FnOnce(&Path) -> Result<(), String>,
    ) -> Result<AgentProfileRecord, String> {
        if provider != AgentProvider::Codex {
            return Err("the Codex profile capability probe is valid only for Codex".to_string());
        }
        self.create_profile_with_probe(provider, alias, probe)
    }

    fn create_profile_with_probe(
        &self,
        provider: AgentProvider,
        alias: &str,
        probe: impl FnOnce(&Path) -> Result<(), String>,
    ) -> Result<AgentProfileRecord, String> {
        let profile_kind = match provider {
            AgentProvider::Codex => AgentProfileKind::CodexHome,
            AgentProvider::Claude => AgentProfileKind::ClaudeConfigDir,
        };
        let mut store = self.store.lock().unwrap();
        let mut candidate = store.clone();
        let profile = candidate
            .profile_registry
            .add_profile(provider, alias, profile_kind)?;
        let roots = self.ensure_profile_roots_directory()?;
        let destination = roots.join(profile.account_id());
        let opened = provision_owned_profile_root(&roots, &destination, profile_kind, probe)?;

        let install_result = opened.revalidate().and_then(|_| {
            self.prepare_profile_candidate(&store, &mut candidate)?;
            self.persist_profile_candidate(&candidate)
        });
        if let Err(error) = install_result {
            let rollback = remove_owned_profile_root_with_identity(
                &roots,
                &destination,
                Some(opened.root_identity),
            );
            return Err(match rollback {
                Ok(()) => format!("failed to persist created account profile: {error}"),
                Err(rollback_error) => format!(
                    "failed to persist created account profile: {error}; failed to roll back credential root: {rollback_error}"
                ),
            });
        }
        *store = candidate;
        Ok(profile)
    }

    pub fn list_profiles(&self, provider: AgentProvider) -> Vec<AgentProfileRecord> {
        self.store
            .lock()
            .unwrap()
            .profile_registry
            .visible_profiles(provider)
            .into_iter()
            .cloned()
            .collect()
    }

    pub fn read_profile_snapshot(&self) -> AgentProfileSnapshot {
        let store = self.store.lock().unwrap();
        let profiles = [AgentProvider::Codex, AgentProvider::Claude]
            .into_iter()
            .flat_map(|provider| store.profile_registry.visible_profiles(provider))
            .map(AgentProfileResponse::from)
            .collect();
        let tombstones = [AgentProvider::Codex, AgentProvider::Claude]
            .into_iter()
            .flat_map(|provider| store.profile_registry.tombstones(provider))
            .map(AgentProfileTombstoneResponse::from)
            .collect();
        AgentProfileSnapshot {
            registry_version: store.profile_registry.version(),
            profiles,
            tombstones,
        }
    }

    fn account_lease(
        &self,
        provider: AgentProvider,
        account_id: &str,
    ) -> Result<AgentAccountLease, String> {
        self.store
            .lock()
            .unwrap()
            .profile_registry
            .account_lease(provider, account_id)
    }

    #[cfg(test)]
    pub(crate) fn require_account_profile_lease(
        &self,
        provider: AgentProvider,
        account_id: &str,
        require_connected: bool,
    ) -> Result<AgentAccountLease, String> {
        let store = self.store.lock().unwrap();
        let lease = store.profile_registry.account_lease(provider, account_id)?;
        if require_connected {
            let connected = store
                .profile_registry
                .visible_profiles(provider)
                .into_iter()
                .find(|profile| profile.account_id() == account_id)
                .is_some_and(|profile| profile.connection().is_authoritative_connected());
            if !connected {
                return Err(ACCOUNT_NOT_CONNECTED.to_string());
            }
        }
        Ok(lease)
    }

    pub(crate) fn require_exact_account_profile_lease(
        &self,
        provider: AgentProvider,
        account_id: &str,
        incarnation: u64,
        credential_revision: u64,
        require_connected: bool,
    ) -> Result<AgentAccountLease, String> {
        let store = self.store.lock().unwrap();
        let lease = store.profile_registry.account_lease(provider, account_id)?;
        if lease.incarnation() != incarnation || lease.credential_revision() != credential_revision
        {
            return Err(STALE_ACCOUNT_RESULT.to_string());
        }
        if require_connected {
            let connected = store
                .profile_registry
                .visible_profiles(provider)
                .into_iter()
                .find(|profile| profile.account_id() == account_id)
                .is_some_and(|profile| profile.connection().is_authoritative_connected());
            if !connected {
                return Err(ACCOUNT_NOT_CONNECTED.to_string());
            }
        }
        Ok(lease)
    }

    pub(crate) fn require_profile_lease_current(
        &self,
        lease: &AgentAccountLease,
        require_connected: bool,
    ) -> Result<(), String> {
        let store = self.store.lock().unwrap();
        if !store.profile_registry.is_lease_current(lease) {
            return Err(STALE_ACCOUNT_RESULT.to_string());
        }
        if require_connected {
            let connected = store
                .profile_registry
                .visible_profiles(lease.provider())
                .into_iter()
                .find(|profile| profile.account_id() == lease.account_id())
                .is_some_and(|profile| profile.connection().is_authoritative_connected());
            if !connected {
                return Err(ACCOUNT_NOT_CONNECTED.to_string());
            }
        }
        Ok(())
    }

    pub fn check_profile(
        &self,
        provider: AgentProvider,
        account_id: &str,
        _requested_scopes: Option<Vec<String>>,
    ) -> Result<AgentProfileRecord, String> {
        let lease = self.account_lease(provider, account_id)?;
        let validation = match provider {
            AgentProvider::Codex => self
                .capture_codex_account_execution_context(account_id)
                .and_then(|context| {
                    if context.lease() != &lease {
                        return Err(STALE_ACCOUNT_RESULT.to_string());
                    }
                    crate::runtime::codex::validate_codex_connection_for_context(&context)
                })
                .map(AgentProviderValidation::codex),
            AgentProvider::Claude => self
                .capture_claude_account_execution_context(account_id)
                .and_then(|context| {
                    if context.lease() != &lease {
                        return Err(STALE_ACCOUNT_RESULT.to_string());
                    }
                    crate::runtime::claude::validate_claude_connection_for_context(&context)
                })
                .map(AgentProviderValidation::claude),
        };
        self.finish_profile_check_if_current(&lease, validation)
    }

    #[cfg(test)]
    fn check_profile_with_validation(
        &self,
        provider: AgentProvider,
        account_id: &str,
        validate: impl FnOnce(&AgentAccountLease) -> Result<AgentProviderValidation, String>,
    ) -> Result<AgentProfileRecord, String> {
        let lease = self.account_lease(provider, account_id)?;
        let validation = validate(&lease);
        self.finish_profile_check_if_current(&lease, validation)
    }

    fn finish_profile_check_if_current(
        &self,
        lease: &AgentAccountLease,
        validation: Result<AgentProviderValidation, String>,
    ) -> Result<AgentProfileRecord, String> {
        let mut store = self.store.lock().unwrap();
        if !store.profile_registry.is_lease_current(lease) {
            return Err(
                "The selected account changed while validation was running. Retry the check."
                    .to_string(),
            );
        }
        let current = store
            .profile_registry
            .visible_profiles(lease.provider())
            .into_iter()
            .find(|profile| profile.account_id() == lease.account_id())
            .cloned()
            .ok_or_else(|| {
                "The selected account changed while validation was running. Retry the check."
                    .to_string()
            })?;
        let now = unix_timestamp_ms();
        let (connection, runtime_validated) = match validation {
            Ok(validation) => {
                let credential_source = match lease.provider() {
                    AgentProvider::Codex => None,
                    AgentProvider::Claude => Some(
                        validation
                            .credential_source
                            .ok_or_else(|| {
                                "Claude validation returned no approved credential source."
                                    .to_string()
                            })?
                            .persistence_label()
                            .to_string(),
                    ),
                };
                (
                    AgentProfileConnection {
                        status: AgentConnectionStatus::Connected,
                        requires_validation: false,
                        credential_source,
                        connected_at: current.connection().connected_at.or(Some(now)),
                        updated_at: now,
                        last_error: None,
                    },
                    true,
                )
            }
            Err(_) => (
                AgentProfileConnection {
                    status: AgentConnectionStatus::Error,
                    requires_validation: false,
                    credential_source: None,
                    connected_at: None,
                    updated_at: now,
                    last_error: Some(
                        match lease.provider() {
                            AgentProvider::Codex => CODEX_VALIDATION_FAILURE,
                            AgentProvider::Claude => CLAUDE_VALIDATION_FAILURE,
                        }
                        .to_string(),
                    ),
                },
                false,
            ),
        };
        let mut candidate = store.clone();
        let profile = candidate.profile_registry.install_connection(
            lease.provider(),
            lease.account_id(),
            connection,
            true,
        )?;
        self.prepare_profile_candidate(&store, &mut candidate)?;
        self.advance_reserved_runtime_state(
            &store,
            &mut candidate,
            lease.provider(),
            lease.account_id(),
            runtime_validated,
        );
        self.persist_profile_candidate(&candidate)?;
        *store = candidate;
        Ok(profile)
    }

    pub fn disconnect_profile(
        &self,
        provider: AgentProvider,
        account_id: &str,
    ) -> Result<AgentProfileRecord, String> {
        let mut store = self.store.lock().unwrap();
        store.profile_registry.account_lease(provider, account_id)?;
        let mut candidate = store.clone();
        let profile = candidate.profile_registry.install_connection(
            provider,
            account_id,
            AgentProfileConnection {
                status: AgentConnectionStatus::Disconnected,
                requires_validation: false,
                credential_source: None,
                connected_at: None,
                updated_at: unix_timestamp_ms(),
                last_error: None,
            },
            true,
        )?;
        self.prepare_profile_candidate(&store, &mut candidate)?;
        self.advance_reserved_runtime_state(&store, &mut candidate, provider, account_id, false);
        self.persist_profile_candidate(&candidate)?;
        *store = candidate;
        Ok(profile)
    }

    pub fn authorize_profile_lease(
        &self,
        request: &AuthorizeAgentProfileLeaseRequest,
    ) -> Result<AgentProfileLeaseAuthorization, String> {
        let store = self.store.lock().unwrap();
        let current = store
            .profile_registry
            .account_lease(request.provider, &request.account_id)?;
        let connected = store
            .profile_registry
            .visible_profiles(request.provider)
            .into_iter()
            .find(|profile| profile.account_id() == request.account_id)
            .is_some_and(|profile| profile.connection().is_authoritative_connected());
        Ok(AgentProfileLeaseAuthorization {
            provider: request.provider,
            account_id: request.account_id.clone(),
            incarnation: request.incarnation,
            credential_revision: request.credential_revision,
            authorized: connected
                && current.incarnation() == request.incarnation.value()
                && current.credential_revision() == request.credential_revision.value(),
        })
    }

    pub(crate) fn with_authorized_profile_lease<T>(
        &self,
        request: &AuthorizeAgentProfileLeaseRequest,
        operation: impl FnOnce(&AgentAccountLease) -> Result<T, String>,
    ) -> Result<T, String> {
        let store = self.store.lock().unwrap();
        let lease = store
            .profile_registry
            .account_lease(request.provider, &request.account_id)?;
        if lease.incarnation() != request.incarnation.value()
            || lease.credential_revision() != request.credential_revision.value()
        {
            return Err(STALE_ACCOUNT_RESULT.to_string());
        }
        let connected = store
            .profile_registry
            .visible_profiles(request.provider)
            .into_iter()
            .find(|profile| profile.account_id() == request.account_id)
            .is_some_and(|profile| profile.connection().is_authoritative_connected());
        if !connected {
            return Err(ACCOUNT_NOT_CONNECTED.to_string());
        }

        let result = operation(&lease);
        drop(store);
        result
    }

    pub(crate) fn apply_codex_account_validation_if_current(
        &self,
        lease: &AgentAccountLease,
        validation: &Result<String, String>,
    ) -> Result<bool, String> {
        let validation = validation
            .as_ref()
            .map(|account_label| AgentProviderValidation::codex(account_label.clone()))
            .map_err(Clone::clone);
        self.apply_account_validation_if_current(lease, &validation)
    }

    pub(crate) fn apply_claude_account_validation_if_current(
        &self,
        lease: &AgentAccountLease,
        validation: &Result<crate::runtime::claude::ClaudeConnectionValidation, String>,
    ) -> Result<bool, String> {
        let validation = validation
            .as_ref()
            .map(|validation| AgentProviderValidation::claude(*validation))
            .map_err(Clone::clone);
        self.apply_account_validation_if_current(lease, &validation)
    }

    fn apply_account_validation_if_current(
        &self,
        lease: &AgentAccountLease,
        validation: &Result<AgentProviderValidation, String>,
    ) -> Result<bool, String> {
        let mut store = self.store.lock().unwrap();
        if !store.profile_registry.is_lease_current(lease) {
            return Ok(false);
        }
        let current = store
            .profile_registry
            .visible_profiles(lease.provider())
            .into_iter()
            .find(|profile| profile.account_id() == lease.account_id())
            .cloned()
            .ok_or_else(|| {
                "The selected account changed while validation was running. Retry the request."
                    .to_string()
            })?;
        let approved_source = validation.as_ref().ok().and_then(|validation| {
            validation
                .credential_source
                .map(|source| source.persistence_label().to_string())
        });
        let validation_succeeded = validation.is_ok()
            && (lease.provider() == AgentProvider::Codex || approved_source.is_some());
        let unchanged = if validation_succeeded {
            current.connection().is_authoritative_connected()
                && current.connection().credential_source == approved_source
                && current.connection().last_error.is_none()
        } else {
            current.connection().status == AgentConnectionStatus::Error
                && current.connection().credential_source.is_none()
                && current.connection().last_error.as_deref()
                    == Some(match lease.provider() {
                        AgentProvider::Codex => CODEX_VALIDATION_FAILURE,
                        AgentProvider::Claude => CLAUDE_VALIDATION_FAILURE,
                    })
        };
        if unchanged {
            return Ok(true);
        }

        let now = unix_timestamp_ms();
        let connection = if validation_succeeded {
            AgentProfileConnection {
                status: AgentConnectionStatus::Connected,
                requires_validation: false,
                credential_source: approved_source,
                connected_at: current.connection().connected_at.or(Some(now)),
                updated_at: now,
                last_error: None,
            }
        } else {
            AgentProfileConnection {
                status: AgentConnectionStatus::Error,
                requires_validation: false,
                credential_source: None,
                connected_at: None,
                updated_at: now,
                last_error: Some(
                    match lease.provider() {
                        AgentProvider::Codex => CODEX_VALIDATION_FAILURE,
                        AgentProvider::Claude => CLAUDE_VALIDATION_FAILURE,
                    }
                    .to_string(),
                ),
            }
        };
        let mut candidate = store.clone();
        candidate.profile_registry.install_connection(
            lease.provider(),
            lease.account_id(),
            connection,
            true,
        )?;
        self.prepare_profile_candidate(&store, &mut candidate)?;
        self.advance_reserved_runtime_state(
            &store,
            &mut candidate,
            lease.provider(),
            lease.account_id(),
            validation_succeeded,
        );
        self.persist_profile_candidate(&candidate)?;
        *store = candidate;
        // A successful validation that changes the stored credential source advances the
        // credential lease. Persist the newly observed source, but do not publish work that ran
        // under the superseded lease. Validation failures carry no provider payload, so their
        // redacted failure may still be returned after the error state is installed.
        Ok(!validation_succeeded)
    }

    pub fn owned_profile_root(
        &self,
        provider: AgentProvider,
        account_id: &str,
    ) -> Result<PathBuf, String> {
        let store = self.store.lock().unwrap();
        let profile = store
            .profile_registry
            .visible_profiles(provider)
            .into_iter()
            .find(|profile| profile.account_id() == account_id)
            .ok_or_else(|| format!("unknown account profile: {account_id}"))?;
        if profile.profile_kind() == AgentProfileKind::Ambient {
            return Err("ambient profiles do not have an app-owned credential root".to_string());
        }
        let roots = self.ensure_profile_roots_directory()?;
        let opened = open_owned_profile_root(&roots, &roots.join(account_id), None)?;
        opened.revalidate()
    }

    pub(crate) fn capture_codex_account_execution_context(
        &self,
        account_id: &str,
    ) -> Result<CodexAccountExecutionContext, String> {
        let ambient_home = ambient_codex_home_path()?;
        self.capture_codex_account_execution_context_with_ambient_home(account_id, &ambient_home)
    }

    fn capture_codex_account_execution_context_with_ambient_home(
        &self,
        account_id: &str,
        ambient_home: &Path,
    ) -> Result<CodexAccountExecutionContext, String> {
        let store = self.store.lock().unwrap();
        let profile = store
            .profile_registry
            .visible_profiles(AgentProvider::Codex)
            .into_iter()
            .find(|profile| profile.account_id() == account_id)
            .ok_or_else(|| format!("unknown account profile: {account_id}"))?;
        let profile_kind = profile.profile_kind();
        let lease = store
            .profile_registry
            .account_lease(AgentProvider::Codex, account_id)?;
        let root = match profile_kind {
            AgentProfileKind::Ambient => {
                CodexAccountRoot::Ambient(Arc::new(OpenedAmbientCodexHome::capture(ambient_home)?))
            }
            AgentProfileKind::CodexHome => {
                let roots = self.ensure_profile_roots_directory()?;
                let opened_root = open_owned_profile_root(&roots, &roots.join(account_id), None)?;
                opened_root.revalidate()?;
                validate_private_config(&opened_root.root_path.join("config.toml"))?;
                CodexAccountRoot::Owned(Arc::new(opened_root))
            }
            AgentProfileKind::ClaudeConfigDir => {
                return Err("the selected account is not a Codex profile".to_string());
            }
        };
        Ok(CodexAccountExecutionContext { lease, root })
    }

    pub(crate) fn capture_claude_account_execution_context(
        &self,
        account_id: &str,
    ) -> Result<crate::runtime::claude::ClaudeAccountExecutionContext, String> {
        self.capture_claude_account_execution_context_for_platform(account_id, std::env::consts::OS)
    }

    pub(crate) fn capture_claude_account_execution_context_for_platform(
        &self,
        account_id: &str,
        target_os: &str,
    ) -> Result<crate::runtime::claude::ClaudeAccountExecutionContext, String> {
        let profile =
            self.capture_claude_account_profile_context_for_platform(account_id, target_os)?;
        crate::runtime::claude::ClaudeAccountExecutionContext::capture(profile)
    }

    fn capture_claude_account_profile_context_for_platform(
        &self,
        account_id: &str,
        target_os: &str,
    ) -> Result<ClaudeAccountProfileContext, String> {
        let store = self.store.lock().unwrap();
        // Resolve the exact lease before inspecting the profile kind so unknown,
        // forgotten, and cross-provider IDs retain their fail-closed errors.
        let lease = store
            .profile_registry
            .account_lease(AgentProvider::Claude, account_id)?;
        let profile_kind = store
            .profile_registry
            .visible_profiles(AgentProvider::Claude)
            .into_iter()
            .find(|profile| profile.account_id() == account_id)
            .map(AgentProfileRecord::profile_kind)
            .ok_or_else(|| format!("unknown account profile: {account_id}"))?;
        let root = match profile_kind {
            AgentProfileKind::Ambient => ClaudeAccountRoot::Ambient,
            AgentProfileKind::ClaudeConfigDir => {
                if target_os == "macos" {
                    return Err(concat!(
                        "unsupported_on_macos: additional Claude CLI accounts require exact ",
                        "CLAUDE_CONFIG_DIR isolation, which Claude Code does not support safely ",
                        "for app-owned profiles on macOS; use the ambient Claude account or run ",
                        "the additional profile on Linux/Windows"
                    )
                    .to_string());
                }
                if !additional_claude_profiles_supported_on(target_os) {
                    return Err(concat!(
                        "unsupported_platform: additional Claude CLI accounts require verified ",
                        "CLAUDE_CONFIG_DIR isolation on Linux or Windows"
                    )
                    .to_string());
                }
                let roots = self.ensure_profile_roots_directory()?;
                let opened_root = open_owned_profile_root(&roots, &roots.join(account_id), None)?;
                opened_root.revalidate()?;
                ClaudeAccountRoot::Owned(Arc::new(opened_root))
            }
            AgentProfileKind::CodexHome => {
                return Err("the selected account is not a Claude profile".to_string())
            }
        };
        Ok(ClaudeAccountProfileContext { lease, root })
    }

    pub fn rename_profile(
        &self,
        provider: AgentProvider,
        account_id: &str,
        alias: &str,
    ) -> Result<AgentProfileRecord, String> {
        let mut store = self.store.lock().unwrap();
        let mut candidate = store.clone();
        let profile = candidate
            .profile_registry
            .rename_profile(provider, account_id, alias)?;
        self.prepare_profile_candidate(&store, &mut candidate)?;
        self.persist_profile_candidate(&candidate)?;
        *store = candidate;
        Ok(profile)
    }

    pub fn set_default_profile(
        &self,
        provider: AgentProvider,
        account_id: &str,
    ) -> Result<AgentProfileRecord, String> {
        let mut store = self.store.lock().unwrap();
        let mut candidate = store.clone();
        let profile = candidate
            .profile_registry
            .set_default(provider, account_id)?;
        self.prepare_profile_candidate(&store, &mut candidate)?;
        self.persist_profile_candidate(&candidate)?;
        *store = candidate;
        Ok(profile)
    }

    pub fn forget_profile(
        &self,
        provider: AgentProvider,
        account_id: &str,
    ) -> Result<AgentProfileTombstone, String> {
        let mut store = self.store.lock().unwrap();
        let mut candidate = store.clone();
        let tombstone = candidate
            .profile_registry
            .tombstone_profile(provider, account_id)?;
        self.prepare_profile_candidate(&store, &mut candidate)?;
        self.persist_profile_candidate(&candidate)?;
        *store = candidate;
        Ok(tombstone)
    }

    pub fn setup_guidance(
        &self,
        provider: AgentProvider,
        account_id: &str,
        shell: AgentSetupShell,
    ) -> Result<AgentProfileSetupGuidance, String> {
        let store = self.store.lock().unwrap();
        let profile = store
            .profile_registry
            .visible_profiles(provider)
            .into_iter()
            .find(|profile| profile.account_id() == account_id)
            .ok_or_else(|| format!("unknown account profile: {account_id}"))?;
        let profile_kind = profile.profile_kind();
        drop(store);
        match profile_kind {
            AgentProfileKind::Ambient => Ok(AgentProfileSetupGuidance::unsupported(
                provider,
                account_id,
                "The ambient default uses the provider session already owned by the user."
                    .to_string(),
            )),
            AgentProfileKind::CodexHome => {
                let root = self.owned_profile_root(provider, account_id)?;
                Ok(AgentProfileSetupGuidance::supported(
                    provider,
                    account_id,
                    "codex",
                    vec![AgentProfileSetupEnvironment {
                        name: "CODEX_HOME".to_string(),
                        value: root.to_string_lossy().into_owned(),
                    }],
                    vec!["login".to_string()],
                    shell,
                ))
            }
            AgentProfileKind::ClaudeConfigDir => {
                #[cfg(target_os = "macos")]
                {
                    Ok(AgentProfileSetupGuidance::unsupported(
                        provider,
                        account_id,
                        "Additional Claude CLI profiles using CLAUDE_CONFIG_DIR are unsupported on macOS."
                            .to_string(),
                    ))
                }
                #[cfg(any(target_os = "linux", target_os = "windows"))]
                {
                    let root = self.owned_profile_root(provider, account_id)?;
                    Ok(AgentProfileSetupGuidance::supported(
                        provider,
                        account_id,
                        "claude",
                        vec![AgentProfileSetupEnvironment {
                            name: "CLAUDE_CONFIG_DIR".to_string(),
                            value: root.to_string_lossy().into_owned(),
                        }],
                        vec!["auth".to_string(), "login".to_string()],
                        shell,
                    ))
                }
                #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
                {
                    Ok(AgentProfileSetupGuidance::unsupported(
                        provider,
                        account_id,
                        "Additional Claude CLI profiles require verified CLAUDE_CONFIG_DIR isolation."
                            .to_string(),
                    ))
                }
            }
        }
    }

    fn ensure_profile_roots_directory(&self) -> Result<PathBuf, String> {
        let storage_path = self
            .storage_path
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| "auth storage path is not initialized".to_string())?;
        ensure_profile_roots_directory(&storage_path)
    }

    fn persist_profile_candidate(&self, candidate: &AgentAuthStore) -> Result<(), String> {
        candidate.profile_registry.validate()?;
        let storage_path = self
            .storage_path
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| "auth storage path is not initialized".to_string())?;
        persist_auth_store_to_path_with_parent_sync(
            candidate,
            &storage_path,
            sync_auth_store_parent,
        )
    }

    fn prepare_profile_candidate(
        &self,
        current: &AgentAuthStore,
        candidate: &mut AgentAuthStore,
    ) -> Result<(), String> {
        candidate.replace_connections_from_profile_registry()?;
        for provider in [AgentProvider::Codex, AgentProvider::Claude] {
            let Some(previous) = current.connections.get(provider.as_key()) else {
                continue;
            };
            if let Some(next) = candidate.connections.get_mut(provider.as_key()) {
                next.runtime_revision = previous.runtime_revision;
                next.runtime_validated = previous.runtime_validated;
            }
        }
        Ok(())
    }

    fn advance_reserved_runtime_state(
        &self,
        current: &AgentAuthStore,
        candidate: &mut AgentAuthStore,
        provider: AgentProvider,
        account_id: &str,
        runtime_validated: bool,
    ) {
        let reserved_account_id = match provider {
            AgentProvider::Codex => CODEX_DEFAULT_ACCOUNT_ID,
            AgentProvider::Claude => CLAUDE_DEFAULT_ACCOUNT_ID,
        };
        if account_id != reserved_account_id {
            return;
        }
        let previous_revision = current
            .connections
            .get(provider.as_key())
            .map(|snapshot| snapshot.runtime_revision)
            .unwrap_or(0);
        if let Some(snapshot) = candidate.connections.get_mut(provider.as_key()) {
            snapshot.runtime_revision = previous_revision.wrapping_add(1);
            snapshot.runtime_validated = runtime_validated;
        }
    }

    pub fn list_connections(&self) -> Vec<AgentConnectionSnapshot> {
        for provider in [AgentProvider::Codex, AgentProvider::Claude] {
            let Some(lease) = self.provider_refresh_lease(provider) else {
                continue;
            };
            let validation = self.validate_provider_connection(provider);
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
            self.validate_provider_connection(provider)
        })
    }

    fn validate_provider_connection(
        &self,
        provider: AgentProvider,
    ) -> Result<AgentProviderValidation, String> {
        match provider {
            AgentProvider::Codex => {
                let context =
                    self.capture_codex_account_execution_context(CODEX_DEFAULT_ACCOUNT_ID)?;
                crate::runtime::codex::validate_codex_connection_for_context(&context)
                    .map(AgentProviderValidation::codex)
            }
            AgentProvider::Claude => {
                let context =
                    self.capture_claude_account_execution_context(CLAUDE_DEFAULT_ACCOUNT_ID)?;
                crate::runtime::claude::validate_claude_connection_for_context(&context)
                    .map(AgentProviderValidation::claude)
            }
        }
    }

    fn begin_login_with_validation(
        &self,
        provider: AgentProvider,
        requested_scopes: Option<Vec<String>>,
        validate: impl FnOnce() -> Result<AgentProviderValidation, String>,
    ) -> Result<AgentConnectionSnapshot, String> {
        let lease = {
            let mut store = self.store.lock().unwrap();
            let mut candidate = store.clone();
            let now = unix_timestamp_ms();
            let required_scopes = if provider == AgentProvider::Claude {
                provider.required_scopes()
            } else {
                requested_scopes
                    .filter(|scopes| !scopes.is_empty())
                    .unwrap_or_else(|| provider.required_scopes())
            };

            let snapshot = candidate
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
            self.commit_connection_candidate(&mut store, candidate)
                .map_err(|error| {
                    format!("failed to persist pending provider validation: {error}")
                })?;
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
        let mut candidate = store.clone();
        let Some(snapshot) = candidate.connections.get_mut(lease.provider.as_key()) else {
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
        self.commit_connection_candidate(&mut store, candidate)
            .map_err(|error| format!("failed to persist provider validation: {error}"))?;
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
        let mut candidate = store.clone();
        let now = unix_timestamp_ms();
        let callback_state = {
            let snapshot = candidate
                .connections
                .entry(request.provider.as_key().into())
                .or_insert_with(|| AgentConnectionSnapshot::disconnected(request.provider));

            request
                .callback_state
                .clone()
                .or_else(|| snapshot.active_login_state.clone())
                .ok_or_else(|| "callback_state is required to complete login".to_string())?
        };

        let pending = candidate
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
            let snapshot = candidate
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

        if let Some(pending_mut) = candidate.pending_logins.get_mut(&callback_state) {
            pending_mut.consumed_at = Some(now);
            pending_mut.last_error = fail_reason;
        }

        self.commit_connection_candidate(&mut store, candidate)?;
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
        candidate
            .sync_reserved_profiles_from_connections(true)
            .map_err(|error| {
                format!("failed to update account profile after disconnect: {error}")
            })?;
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
        let mut candidate = store.clone();
        let Some(snapshot) = candidate.connections.get_mut(lease.provider.as_key()) else {
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
        if let Err(error) = self.commit_connection_candidate(&mut store, candidate) {
            log::warn!("failed to persist auth state after provider validation: {error}");
            return false;
        }
        true
    }

    fn normalize_store(&self, store: &mut AgentAuthStore) -> Result<(), String> {
        let now = unix_timestamp_ms();
        let migrates_v1 = match store.version {
            1 => true,
            AGENT_PROFILE_REGISTRY_VERSION => false,
            version => return Err(format!("unsupported auth store version: {version}")),
        };

        if migrates_v1 {
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
        } else {
            store.profile_registry.validate()?;
            store.profile_registry.sanitize_persisted_connections(now)?;
            store.replace_connections_from_profile_registry()?;
        }

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
            snapshot.account_label = None;
            snapshot.account_email = None;
            snapshot.callback_url = None;
            snapshot.auth_url = None;
            snapshot.active_login_id = None;
            snapshot.active_login_state = None;
            snapshot.expires_at = None;
            if provider == AgentProvider::Codex {
                snapshot.credential_source = None;
            }
            if snapshot.status == AgentConnectionStatus::Pending {
                snapshot.status = AgentConnectionStatus::Disconnected;
                snapshot.credential_source = None;
                snapshot.connected_at = None;
                snapshot.last_error = if provider == AgentProvider::Claude {
                    Some("Reconnect Claude to start a fresh Claude CLI validation.".to_string())
                } else {
                    None
                };
            }
            if provider == AgentProvider::Claude {
                let safe_last_error = match snapshot.status {
                    AgentConnectionStatus::Error => Some(CLAUDE_VALIDATION_FAILURE.to_string()),
                    AgentConnectionStatus::Pending => unreachable!("pending state was normalized"),
                    AgentConnectionStatus::Disconnected | AgentConnectionStatus::Connected => None,
                };
                snapshot.required_scopes = match (snapshot.status, recognized_claude_credential) {
                    (AgentConnectionStatus::Connected, Some(source)) => source.required_scopes(),
                    _ => provider.required_scopes(),
                };
                if snapshot.status != AgentConnectionStatus::Connected {
                    snapshot.credential_source = None;
                    snapshot.connected_at = None;
                }
                snapshot.last_error = safe_last_error;
            } else if snapshot.required_scopes.is_empty() {
                snapshot.required_scopes = provider.required_scopes();
            }
        }

        store.pending_logins.clear();
        store.next_login_id = 0;
        if migrates_v1 {
            store.profile_registry = AgentProfileRegistryV2::new();
            store.sync_reserved_profiles_from_connections(false)?;
            store.version = AGENT_PROFILE_REGISTRY_VERSION;
        } else {
            store.sync_reserved_profiles_from_connections(true)?;
        }
        store.profile_registry.validate()
    }

    fn commit_connection_candidate(
        &self,
        current: &mut AgentAuthStore,
        mut candidate: AgentAuthStore,
    ) -> Result<(), String> {
        candidate.sync_reserved_profiles_from_connections(true)?;
        if let Some(path) = self.storage_path.lock().unwrap().clone() {
            persist_auth_store_to_path_with_parent_sync(&candidate, &path, sync_auth_store_parent)?;
        }
        *current = candidate;
        Ok(())
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
        persist_auth_store_to_path_with_parent_sync(store, &path, sync_parent)
    }
}

fn additional_claude_profiles_supported_on(target_os: &str) -> bool {
    matches!(target_os, "linux" | "windows")
}

fn render_setup_command(
    shell: AgentSetupShell,
    program: &str,
    environment: &[AgentProfileSetupEnvironment],
    arguments: &[String],
) -> String {
    match shell {
        AgentSetupShell::Zsh | AgentSetupShell::Bash => {
            let mut tokens = environment
                .iter()
                .map(|entry| format!("{}={}", entry.name, quote_posix(&entry.value)))
                .collect::<Vec<_>>();
            tokens.push(quote_posix(program));
            tokens.extend(arguments.iter().map(|argument| quote_posix(argument)));
            tokens.join(" ")
        }
        AgentSetupShell::PowerShell => {
            let mut statements = environment
                .iter()
                .map(|entry| format!("$env:{} = {}", entry.name, quote_powershell(&entry.value)))
                .collect::<Vec<_>>();
            let mut invocation = format!("& {}", quote_powershell(program));
            for argument in arguments {
                invocation.push(' ');
                invocation.push_str(&quote_powershell(argument));
            }
            statements.push(invocation);
            statements.join("; ")
        }
    }
}

fn quote_posix(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn quote_powershell(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

#[cfg(any(test, target_os = "windows"))]
const WINDOWS_FILE_ATTRIBUTE_DIRECTORY: u32 = 0x10;
#[cfg(any(test, target_os = "windows"))]
const WINDOWS_FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;

#[cfg(any(test, target_os = "windows"))]
fn windows_owner_only_profile_sddl(user_sid: &str) -> Result<String, String> {
    let components = user_sid.split('-').collect::<Vec<_>>();
    if components.len() < 3
        || components.len() > 18
        || components[0] != "S"
        || components[1] != "1"
        || components[2..].iter().any(|component| {
            component.is_empty()
                || component.len() > 20
                || !component.bytes().all(|byte| byte.is_ascii_digit())
        })
    {
        return Err("current Windows user SID has an invalid string representation".to_string());
    }
    Ok(format!("D:P(A;OICI;FA;;;{user_sid})"))
}

#[cfg(any(test, target_os = "windows"))]
fn validate_windows_profile_path_attributes(
    attributes: u32,
    expected_directory: bool,
) -> Result<(), String> {
    if attributes & WINDOWS_FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        return Err("account profile path must not be a Windows reparse point".to_string());
    }
    let is_directory = attributes & WINDOWS_FILE_ATTRIBUTE_DIRECTORY != 0;
    if is_directory != expected_directory {
        return Err(if expected_directory {
            "account profile path must be a real directory".to_string()
        } else {
            "account profile config must be a real file".to_string()
        });
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn windows_wide(value: &std::ffi::OsStr) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;

    value.encode_wide().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
fn validate_windows_profile_path(path: &Path, expected_directory: bool) -> Result<(), String> {
    use windows_sys::Win32::Storage::FileSystem::{GetFileAttributesW, INVALID_FILE_ATTRIBUTES};

    let path_wide = windows_wide(path.as_os_str());
    let attributes = unsafe { GetFileAttributesW(path_wide.as_ptr()) };
    if attributes == INVALID_FILE_ATTRIBUTES {
        return Err(format!(
            "failed to inspect Windows account profile path: {}",
            std::io::Error::last_os_error()
        ));
    }
    validate_windows_profile_path_attributes(attributes, expected_directory)
}

#[cfg(target_os = "windows")]
fn with_current_windows_user_sid<T>(
    callback: impl FnOnce(windows_sys::Win32::Security::PSID) -> Result<T, String>,
) -> Result<T, String> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, HANDLE},
        Security::{GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER},
        System::Threading::{GetCurrentProcess, OpenProcessToken},
    };

    let mut token: HANDLE = std::ptr::null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return Err(format!(
            "failed to open the current Windows user token: {}",
            std::io::Error::last_os_error()
        ));
    }
    let result = (|| {
        let mut required_length = 0_u32;
        unsafe {
            GetTokenInformation(
                token,
                TokenUser,
                std::ptr::null_mut(),
                0,
                &mut required_length,
            )
        };
        if required_length < std::mem::size_of::<TOKEN_USER>() as u32 {
            return Err("Windows user token did not contain a user SID".to_string());
        }
        let word_size = std::mem::size_of::<usize>();
        let word_count = (required_length as usize + word_size - 1) / word_size;
        let mut buffer = vec![0_usize; word_count];
        if unsafe {
            GetTokenInformation(
                token,
                TokenUser,
                buffer.as_mut_ptr().cast(),
                required_length,
                &mut required_length,
            )
        } == 0
        {
            return Err(format!(
                "failed to read the current Windows user SID: {}",
                std::io::Error::last_os_error()
            ));
        }
        let token_user = unsafe { &*buffer.as_ptr().cast::<TOKEN_USER>() };
        if token_user.User.Sid.is_null() {
            return Err("Windows user token returned an empty user SID".to_string());
        }
        callback(token_user.User.Sid)
    })();
    unsafe {
        CloseHandle(token);
    }
    result
}

#[cfg(target_os = "windows")]
fn current_windows_user_sid_string() -> Result<String, String> {
    use windows_sys::{
        core::PWSTR,
        Win32::{Foundation::LocalFree, Security::Authorization::ConvertSidToStringSidW},
    };

    with_current_windows_user_sid(|sid| {
        let mut sid_string: PWSTR = std::ptr::null_mut();
        if unsafe { ConvertSidToStringSidW(sid, &mut sid_string) } == 0 || sid_string.is_null() {
            return Err(format!(
                "failed to format the current Windows user SID: {}",
                std::io::Error::last_os_error()
            ));
        }
        let converted = (|| {
            let length = (0..256_usize)
                .find(|index| unsafe { *sid_string.add(*index) } == 0)
                .ok_or_else(|| "current Windows user SID string was not terminated".to_string())?;
            String::from_utf16(unsafe { std::slice::from_raw_parts(sid_string, length) })
                .map_err(|_| "current Windows user SID string was not valid UTF-16".to_string())
        })();
        unsafe {
            LocalFree(sid_string.cast());
        }
        converted
    })
}

#[cfg(target_os = "windows")]
fn windows_owner_only_sddl(user_sid: &str, directory: bool) -> Result<String, String> {
    let directory_sddl = windows_owner_only_profile_sddl(user_sid)?;
    if directory {
        Ok(directory_sddl)
    } else {
        Ok(format!("D:P(A;;FA;;;{user_sid})"))
    }
}

#[cfg(target_os = "windows")]
fn apply_windows_owner_only_acl(path: &Path, directory: bool) -> Result<(), String> {
    use windows_sys::Win32::{
        Foundation::{LocalFree, ERROR_SUCCESS},
        Security::{
            Authorization::{
                ConvertStringSecurityDescriptorToSecurityDescriptorW, SetNamedSecurityInfoW,
                SDDL_REVISION_1, SE_FILE_OBJECT,
            },
            GetSecurityDescriptorDacl, DACL_SECURITY_INFORMATION, OWNER_SECURITY_INFORMATION,
            PROTECTED_DACL_SECURITY_INFORMATION,
        },
    };

    validate_windows_profile_path(path, directory)?;
    let sid_string = current_windows_user_sid_string()?;
    let sddl = windows_owner_only_sddl(&sid_string, directory)?;
    let sddl_wide = windows_wide(std::ffi::OsStr::new(&sddl));
    let mut descriptor = std::ptr::null_mut();
    if unsafe {
        ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl_wide.as_ptr(),
            SDDL_REVISION_1,
            &mut descriptor,
            std::ptr::null_mut(),
        )
    } == 0
    {
        return Err(format!(
            "failed to build the owner-only Windows profile ACL: {}",
            std::io::Error::last_os_error()
        ));
    }
    let applied = (|| {
        let mut dacl_present = 0;
        let mut dacl_defaulted = 0;
        let mut dacl = std::ptr::null_mut();
        if unsafe {
            GetSecurityDescriptorDacl(
                descriptor,
                &mut dacl_present,
                &mut dacl,
                &mut dacl_defaulted,
            )
        } == 0
            || dacl_present == 0
            || dacl.is_null()
        {
            return Err("owner-only Windows profile ACL did not contain a DACL".to_string());
        }
        let path_wide = windows_wide(path.as_os_str());
        with_current_windows_user_sid(|sid| {
            let status = unsafe {
                SetNamedSecurityInfoW(
                    path_wide.as_ptr(),
                    SE_FILE_OBJECT,
                    OWNER_SECURITY_INFORMATION
                        | DACL_SECURITY_INFORMATION
                        | PROTECTED_DACL_SECURITY_INFORMATION,
                    sid,
                    std::ptr::null_mut(),
                    dacl,
                    std::ptr::null_mut(),
                )
            };
            if status != ERROR_SUCCESS {
                return Err(format!(
                    "failed to apply the owner-only Windows profile ACL: {}",
                    std::io::Error::from_raw_os_error(status as i32)
                ));
            }
            Ok(())
        })
    })();
    unsafe {
        LocalFree(descriptor.cast());
    }
    applied?;
    validate_windows_profile_path(path, directory)
}

#[cfg(target_os = "windows")]
fn verify_windows_owner_only_acl(path: &Path, directory: bool) -> Result<(), String> {
    use windows_sys::Win32::{
        Foundation::{LocalFree, ERROR_SUCCESS},
        Security::{
            Authorization::{GetNamedSecurityInfoW, SE_FILE_OBJECT},
            EqualSid, GetAce, GetSecurityDescriptorControl, ACCESS_ALLOWED_ACE, ACE_HEADER,
            CONTAINER_INHERIT_ACE, DACL_SECURITY_INFORMATION, OBJECT_INHERIT_ACE,
            OWNER_SECURITY_INFORMATION, SE_DACL_PROTECTED,
        },
        Storage::FileSystem::FILE_ALL_ACCESS,
    };

    validate_windows_profile_path(path, directory)?;
    let path_wide = windows_wide(path.as_os_str());
    let mut owner = std::ptr::null_mut();
    let mut dacl = std::ptr::null_mut();
    let mut descriptor = std::ptr::null_mut();
    let status = unsafe {
        GetNamedSecurityInfoW(
            path_wide.as_ptr(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &mut owner,
            std::ptr::null_mut(),
            &mut dacl,
            std::ptr::null_mut(),
            &mut descriptor,
        )
    };
    if status != ERROR_SUCCESS {
        return Err(format!(
            "failed to read the Windows profile ACL: {}",
            std::io::Error::from_raw_os_error(status as i32)
        ));
    }
    let verified = (|| {
        if descriptor.is_null() || owner.is_null() || dacl.is_null() {
            return Err("Windows profile ACL was missing owner or DACL data".to_string());
        }
        let mut control = 0_u16;
        let mut revision = 0_u32;
        if unsafe { GetSecurityDescriptorControl(descriptor, &mut control, &mut revision) } == 0
            || control & SE_DACL_PROTECTED == 0
        {
            return Err("Windows profile DACL must be protected from inheritance".to_string());
        }
        let acl = unsafe { &*dacl };
        if acl.AceCount != 1 {
            return Err("Windows profile DACL must contain exactly one owner ACE".to_string());
        }
        let mut ace_pointer = std::ptr::null_mut();
        if unsafe { GetAce(dacl, 0, &mut ace_pointer) } == 0 || ace_pointer.is_null() {
            return Err("failed to read the owner ACE from the Windows profile DACL".to_string());
        }
        let header = unsafe { &*ace_pointer.cast::<ACE_HEADER>() };
        let expected_flags = if directory {
            (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE) as u8
        } else {
            0
        };
        if header.AceType != 0 || header.AceFlags != expected_flags {
            return Err(
                "Windows profile DACL contained an unexpected ACE type or flags".to_string(),
            );
        }
        let ace = unsafe { &*ace_pointer.cast::<ACCESS_ALLOWED_ACE>() };
        if ace.Mask != FILE_ALL_ACCESS {
            return Err("Windows profile owner ACE must grant full control".to_string());
        }
        let ace_sid = std::ptr::addr_of!(ace.SidStart).cast_mut().cast();
        with_current_windows_user_sid(|current_sid| {
            if unsafe { EqualSid(owner, current_sid) } == 0
                || unsafe { EqualSid(ace_sid, current_sid) } == 0
            {
                return Err(
                    "Windows profile owner and sole ACE must match the current user".to_string(),
                );
            }
            Ok(())
        })
    })();
    if !descriptor.is_null() {
        unsafe {
            LocalFree(descriptor.cast());
        }
    }
    verified?;
    validate_windows_profile_path(path, directory)
}

fn ensure_profile_roots_directory(storage_path: &Path) -> Result<PathBuf, String> {
    let parent = storage_path
        .parent()
        .ok_or_else(|| "auth storage path has no parent".to_string())?;
    let parent_metadata = fs::symlink_metadata(parent)
        .map_err(|error| format!("failed to inspect app-data directory: {error}"))?;
    if parent_metadata.file_type().is_symlink() || !parent_metadata.is_dir() {
        return Err("app-data directory must be a real directory, not a symlink".to_string());
    }
    #[cfg(target_os = "windows")]
    validate_windows_profile_path(parent, true)?;
    let canonical_parent = fs::canonicalize(parent)
        .map_err(|error| format!("failed to canonicalize app-data directory: {error}"))?;
    let roots = parent.join(PROFILE_ROOTS_DIRECTORY);
    match fs::symlink_metadata(&roots) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err("account profile root container must be a real directory".to_string());
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            create_private_directory(&roots)?;
        }
        Err(error) => {
            return Err(format!("failed to inspect account profile roots: {error}"));
        }
    }
    enforce_private_directory(&roots)?;
    let canonical_roots = fs::canonicalize(&roots)
        .map_err(|error| format!("failed to canonicalize account profile roots: {error}"))?;
    let expected = canonical_parent.join(PROFILE_ROOTS_DIRECTORY);
    if canonical_roots != expected {
        return Err("account profile root container escaped the app-data directory".to_string());
    }
    Ok(canonical_roots)
}

fn reconcile_profile_root_orphans(
    storage_path: &Path,
    registry: &AgentProfileRegistryV2,
) -> Result<(), String> {
    let parent = storage_path
        .parent()
        .ok_or_else(|| "auth storage path has no parent".to_string())?;
    let roots_path = parent.join(PROFILE_ROOTS_DIRECTORY);
    match fs::symlink_metadata(&roots_path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "failed to inspect account profile roots during startup reconciliation: {error}"
            ));
        }
        Ok(_) => {}
    }
    let roots = ensure_profile_roots_directory(storage_path)?;
    let referenced = [AgentProvider::Codex, AgentProvider::Claude]
        .into_iter()
        .flat_map(|provider| {
            registry
                .visible_profiles(provider)
                .into_iter()
                .map(|profile| profile.account_id().to_string())
                .chain(
                    registry
                        .tombstones(provider)
                        .into_iter()
                        .map(|tombstone| tombstone.account_id().to_string()),
                )
        })
        .collect::<std::collections::HashSet<_>>();

    for (index, entry) in fs::read_dir(&roots)
        .map_err(|error| format!("failed to read account profile roots: {error}"))?
        .enumerate()
    {
        if index >= MAX_PROFILE_ROOT_RECONCILIATION_ENTRIES {
            return Err(format!(
                "account profile root reconciliation exceeds the bounded limit of {MAX_PROFILE_ROOT_RECONCILIATION_ENTRIES} entries"
            ));
        }
        let entry =
            entry.map_err(|error| format!("failed to read account profile root: {error}"))?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| "account profile root name must be UTF-8".to_string())?;
        if referenced.contains(&name) {
            continue;
        }
        if let Some(profile_kind) = interrupted_install_profile_kind(&name) {
            reconcile_interrupted_profile_install(&roots, &entry.path(), &name, profile_kind)?;
            continue;
        }
        let profile_kind =
            if profile_registry_v2::is_valid_generated_profile_id(AgentProvider::Codex, &name) {
                AgentProfileKind::CodexHome
            } else if profile_registry_v2::is_valid_generated_profile_id(
                AgentProvider::Claude,
                &name,
            ) {
                AgentProfileKind::ClaudeConfigDir
            } else {
                return Err(format!(
                    "unrecognized entry in the account profile root container: {name}"
                ));
            };
        let orphan = entry.path();
        let opened = open_owned_profile_root(&roots, &orphan, None)?;
        opened.revalidate()?;
        let entries = fs::read_dir(&orphan)
            .map_err(|error| format!("failed to inspect crash-orphan profile root: {error}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("failed to inspect crash-orphan profile entry: {error}"))?;
        match profile_kind {
            AgentProfileKind::CodexHome => {
                if entries.len() != 1
                    || entries[0].file_name() != std::ffi::OsStr::new("config.toml")
                {
                    return Err(format!(
                        "crash-orphan Codex profile {name} contains data and requires manual recovery"
                    ));
                }
                validate_private_config(&orphan.join("config.toml"))?;
            }
            AgentProfileKind::ClaudeConfigDir => {
                if !entries.is_empty() {
                    return Err(format!(
                        "crash-orphan Claude profile {name} contains data and requires manual recovery"
                    ));
                }
            }
            AgentProfileKind::Ambient => unreachable!("generated orphan cannot be ambient"),
        }
        opened.revalidate()?;
        remove_owned_profile_root_with_identity(&roots, &orphan, Some(opened.root_identity))?;
        sync_directory(&roots)?;
    }
    Ok(())
}

fn interrupted_install_profile_kind(name: &str) -> Option<AgentProfileKind> {
    let transaction = name.strip_prefix('.')?;
    let (account_id, suffix) = transaction.rsplit_once(".install-")?;
    let (process_id, counter) = suffix.split_once('-')?;
    if process_id.is_empty()
        || counter.is_empty()
        || counter.contains('-')
        || process_id.parse::<u32>().ok()? == 0
        || counter.parse::<u64>().is_err()
    {
        return None;
    }
    if profile_registry_v2::is_valid_generated_profile_id(AgentProvider::Codex, account_id) {
        Some(AgentProfileKind::CodexHome)
    } else if profile_registry_v2::is_valid_generated_profile_id(AgentProvider::Claude, account_id)
    {
        Some(AgentProfileKind::ClaudeConfigDir)
    } else {
        None
    }
}

fn reconcile_interrupted_profile_install(
    roots: &Path,
    interrupted: &Path,
    name: &str,
    profile_kind: AgentProfileKind,
) -> Result<(), String> {
    let opened = open_owned_profile_root(roots, interrupted, None)?;
    opened.revalidate()?;
    let entries = fs::read_dir(interrupted)
        .map_err(|error| format!("failed to inspect interrupted profile install: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("failed to inspect interrupted profile install entry: {error}"))?;
    match profile_kind {
        AgentProfileKind::CodexHome => {
            if entries.is_empty() {
                // A crash can occur immediately after the private staging directory is created.
            } else if entries.len() == 1
                && entries[0].file_name() == std::ffi::OsStr::new("config.toml")
            {
                validate_private_config(&interrupted.join("config.toml"))?;
            } else {
                return Err(format!(
                    "interrupted Codex profile install {name} contains data and requires manual recovery"
                ));
            }
        }
        AgentProfileKind::ClaudeConfigDir => {
            if !entries.is_empty() {
                return Err(format!(
                    "interrupted Claude profile install {name} contains data and requires manual recovery"
                ));
            }
        }
        AgentProfileKind::Ambient => unreachable!("ambient profiles are never staged"),
    }
    opened.revalidate()?;
    remove_owned_profile_root_with_identity(roots, interrupted, Some(opened.root_identity))?;
    sync_directory(roots)
}

#[cfg(unix)]
pub(crate) fn create_private_directory(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::DirBuilderExt;

    let mut builder = fs::DirBuilder::new();
    builder.mode(0o700);
    builder
        .create(path)
        .map_err(|error| format!("failed to create private account profile directory: {error}"))?;
    enforce_private_directory(path)
}

#[cfg(unix)]
fn validate_posix_owner_ids(actual_uid: u32, effective_uid: u32) -> Result<(), String> {
    if actual_uid != effective_uid {
        return Err("account profile path must be owned by the effective user".to_string());
    }
    Ok(())
}

#[cfg(unix)]
fn validate_posix_private_owner(metadata: &fs::Metadata) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;

    validate_posix_owner_ids(metadata.uid(), unsafe { libc::geteuid() })
}

#[cfg(any(target_os = "linux", all(test, target_os = "macos")))]
fn linux_posix_acl_attribute_names(directory: bool) -> Vec<&'static [u8]> {
    let mut attributes = vec![b"system.posix_acl_access\0".as_slice()];
    if directory {
        attributes.push(b"system.posix_acl_default\0".as_slice());
    }
    attributes
}

#[cfg(target_os = "linux")]
fn validate_no_unexpected_posix_acl(path: &Path, directory: bool) -> Result<(), String> {
    use std::{ffi::CString, os::unix::ffi::OsStrExt};

    let path = CString::new(path.as_os_str().as_bytes())
        .map_err(|_| "account profile path is not valid for POSIX ACL inspection".to_string())?;
    for attribute in linux_posix_acl_attribute_names(directory) {
        let size = unsafe {
            libc::lgetxattr(
                path.as_ptr(),
                attribute.as_ptr().cast(),
                std::ptr::null_mut(),
                0,
            )
        };
        if size >= 0 {
            return Err("account profile path must not have an extended ACL".to_string());
        }
        let error = std::io::Error::last_os_error();
        if error.raw_os_error() != Some(libc::ENODATA) {
            return Err(format!(
                "failed to prove account profile POSIX ACL state: {error}"
            ));
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn validate_no_unexpected_posix_acl(path: &Path, _directory: bool) -> Result<(), String> {
    use std::os::fd::AsRawFd;

    unsafe extern "C" {
        fn acl_get_fd_np(fd: libc::c_int, acl_type: libc::c_int) -> *mut libc::c_void;
        fn acl_get_entry(
            acl: *mut libc::c_void,
            entry_id: libc::c_int,
            entry: *mut *mut libc::c_void,
        ) -> libc::c_int;
        fn acl_free(object: *mut libc::c_void) -> libc::c_int;
    }

    const ACL_TYPE_EXTENDED: libc::c_int = 0x100;
    const ACL_FIRST_ENTRY: libc::c_int = 0;
    let opened = fs::File::open(path)
        .map_err(|error| format!("failed to open account profile POSIX ACL state: {error}"))?;
    let acl = unsafe { acl_get_fd_np(opened.as_raw_fd(), ACL_TYPE_EXTENDED) };
    if acl.is_null() {
        let error = std::io::Error::last_os_error();
        return if error.raw_os_error() == Some(libc::ENOENT) {
            Ok(())
        } else {
            Err(format!(
                "failed to prove account profile POSIX ACL state: {error}"
            ))
        };
    }
    let mut entry = std::ptr::null_mut();
    let entry_result = unsafe { acl_get_entry(acl, ACL_FIRST_ENTRY, &mut entry) };
    let entry_error = (entry_result != 0).then(std::io::Error::last_os_error);
    let free_result = unsafe { acl_free(acl) };
    if free_result != 0 {
        return Err("failed to release account profile POSIX ACL state".to_string());
    }
    if entry_result == 0 {
        return Err("account profile path must not have an extended ACL".to_string());
    }
    if entry_error.and_then(|error| error.raw_os_error()) == Some(libc::EINVAL) {
        Ok(())
    } else {
        Err("failed to prove account profile POSIX ACL state".to_string())
    }
}

#[cfg(all(unix, not(any(target_os = "linux", target_os = "macos"))))]
fn validate_no_unexpected_posix_acl(_path: &Path, _directory: bool) -> Result<(), String> {
    Err("unsupported_permissions: POSIX ACL verification is unavailable".to_string())
}

#[cfg(target_os = "windows")]
pub(crate) fn create_private_directory(path: &Path) -> Result<(), String> {
    fs::create_dir(path)
        .map_err(|error| format!("failed to create private account profile directory: {error}"))?;
    if let Err(error) = enforce_private_directory(path) {
        let _ = fs::remove_dir(path);
        return Err(error);
    }
    Ok(())
}

#[cfg(not(any(unix, target_os = "windows")))]
pub(crate) fn create_private_directory(_path: &Path) -> Result<(), String> {
    Err("unsupported_permissions: private directory guarantees are unavailable".to_string())
}

#[cfg(unix)]
fn enforce_private_directory(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("failed to inspect private account profile directory: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("account profile path must be a real directory".to_string());
    }
    validate_posix_private_owner(&metadata)?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|error| format!("failed to secure account profile directory: {error}"))?;
    validate_private_directory_security(path)
}

#[cfg(unix)]
fn validate_private_directory_security(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("failed to recheck account profile directory: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("account profile path must be a real directory".to_string());
    }
    validate_posix_private_owner(&metadata)?;
    validate_no_unexpected_posix_acl(path, true)?;
    let mode = metadata.permissions().mode() & 0o777;
    if mode != 0o700 {
        return Err(format!(
            "account profile directory permissions are {mode:o}; required 700"
        ));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn enforce_private_directory(path: &Path) -> Result<(), String> {
    validate_windows_profile_path(path, true)?;
    apply_windows_owner_only_acl(path, true)?;
    validate_private_directory_security(path)
}

#[cfg(target_os = "windows")]
fn validate_private_directory_security(path: &Path) -> Result<(), String> {
    validate_windows_profile_path(path, true)?;
    verify_windows_owner_only_acl(path, true)?;
    validate_windows_profile_path(path, true)
}

#[cfg(not(any(unix, target_os = "windows")))]
fn enforce_private_directory(_path: &Path) -> Result<(), String> {
    Err("unsupported_permissions: private directory guarantees are unavailable".to_string())
}

#[cfg(not(any(unix, target_os = "windows")))]
fn validate_private_directory_security(_path: &Path) -> Result<(), String> {
    Err("unsupported_permissions: private directory guarantees are unavailable".to_string())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ProfileDirectoryIdentity {
    device: u64,
    file: u64,
}

struct OpenedProfileRoot {
    roots_path: PathBuf,
    root_path: PathBuf,
    roots_file: fs::File,
    root_file: fs::File,
    roots_identity: ProfileDirectoryIdentity,
    root_identity: ProfileDirectoryIdentity,
}

struct OpenedAmbientCodexHome {
    canonical_path: PathBuf,
    root_file: fs::File,
    root_identity: ProfileDirectoryIdentity,
}

impl OpenedAmbientCodexHome {
    fn capture(path: &Path) -> Result<Self, String> {
        let canonical_path = fs::canonicalize(path)
            .map_err(|_| "the ambient Codex home directory is unavailable".to_string())?;
        let root_file = open_directory_handle(&canonical_path)?;
        let root_identity = profile_directory_identity(&root_file)?;
        let opened = Self {
            canonical_path,
            root_file,
            root_identity,
        };
        opened.revalidate()?;
        Ok(opened)
    }

    fn revalidate(&self) -> Result<PathBuf, String> {
        revalidate_opened_directory(&self.canonical_path, &self.root_file, self.root_identity)?;
        let canonical = fs::canonicalize(&self.canonical_path)
            .map_err(|_| "ambient Codex home identity changed".to_string())?;
        if canonical != self.canonical_path {
            return Err("ambient Codex home identity changed".to_string());
        }
        Ok(canonical)
    }
}

impl OpenedProfileRoot {
    fn revalidate(&self) -> Result<PathBuf, String> {
        revalidate_opened_directory(&self.roots_path, &self.roots_file, self.roots_identity)?;
        revalidate_opened_directory(&self.root_path, &self.root_file, self.root_identity)?;
        let canonical_roots = fs::canonicalize(&self.roots_path)
            .map_err(|_| "account profile root container identity changed".to_string())?;
        let canonical_root = fs::canonicalize(&self.root_path)
            .map_err(|_| "account profile root identity changed".to_string())?;
        if canonical_roots != self.roots_path {
            return Err("account profile root container identity changed".to_string());
        }
        let file_name = self
            .root_path
            .file_name()
            .ok_or_else(|| "account profile root has no final path component".to_string())?;
        if canonical_root != canonical_roots.join(file_name) {
            return Err("account profile root identity escaped its owned container".to_string());
        }
        validate_private_directory_security(&canonical_roots)?;
        validate_private_directory_security(&canonical_root)?;
        Ok(canonical_root)
    }
}

impl CodexAccountExecutionContext {
    pub(crate) fn lease(&self) -> &AgentAccountLease {
        &self.lease
    }

    pub(crate) fn revalidated_codex_home(&self) -> Result<PathBuf, String> {
        match &self.root {
            CodexAccountRoot::Ambient(root) => root.revalidate(),
            CodexAccountRoot::Owned(root) => {
                let root = root.revalidate()?;
                validate_private_config(&root.join("config.toml"))?;
                Ok(root)
            }
        }
    }

    pub(crate) fn revalidated_codex_config_snapshot(
        &self,
    ) -> Result<Option<CodexProfileConfigSnapshot>, String> {
        match &self.root {
            CodexAccountRoot::Ambient(root) => {
                let root = root.revalidate()?;
                read_codex_profile_config_snapshot(&root.join("config.toml"), true)
            }
            CodexAccountRoot::Owned(root) => {
                let root = root.revalidate()?;
                read_private_codex_profile_config_snapshot(&root.join("config.toml")).map(Some)
            }
        }
    }
}

impl ClaudeAccountProfileContext {
    pub(crate) fn lease(&self) -> &AgentAccountLease {
        &self.lease
    }

    pub(crate) fn is_owned(&self) -> bool {
        matches!(self.root, ClaudeAccountRoot::Owned(_))
    }

    pub(crate) fn revalidated_claude_config_dir(&self) -> Result<Option<PathBuf>, String> {
        match &self.root {
            ClaudeAccountRoot::Ambient => Ok(None),
            ClaudeAccountRoot::Owned(root) => root.revalidate().map(Some),
        }
    }
}

fn open_owned_profile_root(
    roots: &Path,
    root: &Path,
    expected_identity: Option<ProfileDirectoryIdentity>,
) -> Result<OpenedProfileRoot, String> {
    validate_owned_profile_root(roots, root)?;
    let roots_file = open_directory_handle(roots)?;
    let root_file = open_directory_handle(root)?;
    let roots_identity = profile_directory_identity(&roots_file)?;
    let root_identity = profile_directory_identity(&root_file)?;
    if expected_identity
        .map(|expected| expected != root_identity)
        .unwrap_or(false)
    {
        return Err("account profile root identity changed during installation".to_string());
    }
    let opened = OpenedProfileRoot {
        roots_path: roots.to_path_buf(),
        root_path: root.to_path_buf(),
        roots_file,
        root_file,
        roots_identity,
        root_identity,
    };
    opened.revalidate()?;
    Ok(opened)
}

#[cfg(unix)]
fn open_directory_handle(path: &Path) -> Result<fs::File, String> {
    fs::File::open(path).map_err(|_| "failed to open account profile directory".to_string())
}

#[cfg(target_os = "windows")]
fn open_directory_handle(path: &Path) -> Result<fs::File, String> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_DELETE,
        FILE_SHARE_READ, FILE_SHARE_WRITE,
    };

    let file = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
        .map_err(|_| "failed to open account profile directory".to_string())?;
    let attributes = windows_file_information(&file)?.dwFileAttributes;
    validate_windows_profile_path_attributes(attributes, true)?;
    Ok(file)
}

#[cfg(not(any(unix, target_os = "windows")))]
fn open_directory_handle(_path: &Path) -> Result<fs::File, String> {
    Err("unsupported_permissions: opened directory identity is unavailable".to_string())
}

#[cfg(unix)]
fn profile_directory_identity(file: &fs::File) -> Result<ProfileDirectoryIdentity, String> {
    use std::os::unix::fs::MetadataExt;

    let metadata = file
        .metadata()
        .map_err(|_| "failed to inspect opened account profile directory".to_string())?;

    Ok(ProfileDirectoryIdentity {
        device: metadata.dev(),
        file: metadata.ino(),
    })
}

#[cfg(target_os = "windows")]
fn profile_directory_identity(file: &fs::File) -> Result<ProfileDirectoryIdentity, String> {
    let information = windows_file_information(file)?;
    Ok(ProfileDirectoryIdentity {
        device: u64::from(information.dwVolumeSerialNumber),
        file: (u64::from(information.nFileIndexHigh) << 32) | u64::from(information.nFileIndexLow),
    })
}

#[cfg(target_os = "windows")]
fn windows_file_information(
    file: &fs::File,
) -> Result<windows_sys::Win32::Storage::FileSystem::BY_HANDLE_FILE_INFORMATION, String> {
    use std::os::windows::io::AsRawHandle;
    use windows_sys::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
    };

    let mut information = BY_HANDLE_FILE_INFORMATION::default();
    let succeeded =
        unsafe { GetFileInformationByHandle(file.as_raw_handle().cast(), &mut information) };
    if succeeded == 0 {
        return Err(format!(
            "failed to inspect opened account profile directory: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(information)
}

#[cfg(not(any(unix, target_os = "windows")))]
fn profile_directory_identity(_file: &fs::File) -> Result<ProfileDirectoryIdentity, String> {
    Err("unsupported_permissions: directory identity is unavailable".to_string())
}

fn revalidate_opened_directory(
    path: &Path,
    opened: &fs::File,
    expected: ProfileDirectoryIdentity,
) -> Result<(), String> {
    let current = open_directory_handle(path)
        .map_err(|_| "account profile directory identity changed".to_string())?;
    let path_identity = profile_directory_identity(&current)?;
    let opened_identity = profile_directory_identity(opened)?;
    if path_identity != expected || opened_identity != expected {
        return Err("account profile directory identity changed".to_string());
    }
    Ok(())
}

fn provision_owned_profile_root(
    roots: &Path,
    destination: &Path,
    profile_kind: AgentProfileKind,
    probe: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<OpenedProfileRoot, String> {
    if fs::symlink_metadata(destination).is_ok() {
        return Err("duplicate account profile credential root already exists".to_string());
    }
    let counter = PROFILE_TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let account_id = destination
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "account profile ID is not a valid path component".to_string())?;
    let temporary = roots.join(format!(
        ".{account_id}.install-{}-{counter}",
        std::process::id()
    ));
    create_private_directory(&temporary)?;
    let mut destination_installed = false;
    let temporary_identity = profile_directory_identity(&open_directory_handle(&temporary)?)?;
    let installed = (|| {
        if profile_kind == AgentProfileKind::CodexHome {
            write_private_config(
                &temporary.join("config.toml"),
                CODEX_PROFILE_CONFIG.as_bytes(),
            )?;
        }
        validate_staged_profile_root(roots, &temporary, profile_kind)?;
        if fs::symlink_metadata(destination).is_ok() {
            return Err(
                "duplicate account profile credential root appeared during creation".to_string(),
            );
        }
        fs::rename(&temporary, destination).map_err(|error| {
            format!("failed to atomically install account profile root: {error}")
        })?;
        destination_installed = true;
        let opened = open_owned_profile_root(roots, destination, Some(temporary_identity))?;
        opened.revalidate()?;
        validate_staged_profile_root(roots, destination, profile_kind)?;
        probe(destination)?;
        opened.revalidate()?;
        cleanup_profile_probe_artifacts(&opened)?;
        opened.revalidate()?;
        validate_staged_profile_root(roots, destination, profile_kind)?;
        sync_directory(destination)?;
        sync_directory(roots)?;
        Ok(opened)
    })();

    match installed {
        Ok(opened) => Ok(opened),
        Err(original_error) => {
            let rollback_target = if destination_installed {
                destination
            } else {
                &temporary
            };
            match rollback_failed_profile_provision(
                roots,
                rollback_target,
                temporary_identity,
                destination_installed,
            ) {
                Ok(()) => Err(original_error),
                Err(rollback_error) => Err(format!(
                    "{original_error}; rollback failed: {rollback_error}"
                )),
            }
        }
    }
}

fn rollback_failed_profile_provision(
    roots: &Path,
    rollback_target: &Path,
    expected_identity: ProfileDirectoryIdentity,
    destination_installed: bool,
) -> Result<(), String> {
    match fs::symlink_metadata(rollback_target) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return if destination_installed {
                Err("installed account profile root disappeared before rollback; manual recovery may be required".to_string())
            } else {
                Ok(())
            };
        }
        Err(error) => {
            return Err(format!(
                "failed to inspect the account profile rollback target: {error}"
            ));
        }
        Ok(_) => {}
    }
    remove_owned_profile_root_with_identity(roots, rollback_target, Some(expected_identity))?;
    sync_directory(roots)
}

fn cleanup_profile_probe_artifacts(opened: &OpenedProfileRoot) -> Result<(), String> {
    let root = opened.revalidate()?;
    for entry in fs::read_dir(&root)
        .map_err(|error| format!("failed to inspect Codex profile probe artifacts: {error}"))?
    {
        let entry = entry
            .map_err(|error| format!("failed to inspect Codex profile probe artifact: {error}"))?;
        if entry.file_name() == std::ffi::OsStr::new("config.toml") {
            continue;
        }
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|error| {
            format!("failed to inspect Codex profile probe artifact safely: {error}")
        })?;
        if metadata.is_dir() && !metadata.file_type().is_symlink() {
            fs::remove_dir_all(&path).map_err(|error| {
                format!("failed to remove Codex profile probe directory: {error}")
            })?;
        } else {
            fs::remove_file(&path).map_err(|error| {
                format!("failed to remove Codex profile probe artifact: {error}")
            })?;
        }
    }
    opened.revalidate()?;
    Ok(())
}

#[cfg(unix)]
fn write_private_config(path: &Path, contents: &[u8]) -> Result<(), String> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};

    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(0o600)
        .open(path)
        .map_err(|error| format!("failed to create private account profile config: {error}"))?;
    file.write_all(contents)
        .and_then(|_| file.sync_all())
        .map_err(|error| format!("failed to write private account profile config: {error}"))?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))
        .map_err(|error| format!("failed to secure account profile config: {error}"))
}

#[cfg(target_os = "windows")]
fn write_private_config(path: &Path, contents: &[u8]) -> Result<(), String> {
    let written = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(path)
            .map_err(|error| format!("failed to create private account profile config: {error}"))?;
        file.write_all(contents)
            .and_then(|_| file.sync_all())
            .map_err(|error| format!("failed to write private account profile config: {error}"))?;
        apply_windows_owner_only_acl(path, false)?;
        verify_windows_owner_only_acl(path, false)
    })();
    if written.is_err() {
        let _ = fs::remove_file(path);
    }
    written
}

#[cfg(not(any(unix, target_os = "windows")))]
fn write_private_config(_path: &Path, _contents: &[u8]) -> Result<(), String> {
    Err("unsupported_permissions: private config guarantees are unavailable".to_string())
}

fn validate_staged_profile_root(
    roots: &Path,
    root: &Path,
    profile_kind: AgentProfileKind,
) -> Result<PathBuf, String> {
    let canonical_root = validate_owned_profile_root(roots, root)?;
    if profile_kind == AgentProfileKind::CodexHome {
        validate_private_config(&canonical_root.join("config.toml"))?;
        if canonical_root.join("auth.json").exists() {
            return Err("Codex profile provisioning must not create auth.json".to_string());
        }
    }
    Ok(canonical_root)
}

fn validate_owned_profile_root(roots: &Path, root: &Path) -> Result<PathBuf, String> {
    enforce_private_directory(root)?;
    let canonical_roots = fs::canonicalize(roots)
        .map_err(|error| format!("failed to canonicalize account profile roots: {error}"))?;
    let canonical_root = fs::canonicalize(root)
        .map_err(|error| format!("failed to canonicalize account profile root: {error}"))?;
    let file_name = root
        .file_name()
        .ok_or_else(|| "account profile root has no final path component".to_string())?;
    if canonical_root != canonical_roots.join(file_name) {
        return Err("account profile credential root escaped its owned container".to_string());
    }
    Ok(canonical_root)
}

#[cfg(unix)]
fn validate_private_config(path: &Path) -> Result<(), String> {
    read_private_codex_profile_config_snapshot(path).map(|_| ())
}

#[cfg(unix)]
fn validate_private_config_security(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;

    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("failed to inspect account profile config: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("account profile config must be a real file".to_string());
    }
    validate_posix_private_owner(&metadata)?;
    validate_no_unexpected_posix_acl(path, false)?;
    let mode = metadata.permissions().mode() & 0o777;
    if mode != 0o600 {
        return Err(format!(
            "account profile config permissions are {mode:o}; required 600"
        ));
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn validate_private_config(path: &Path) -> Result<(), String> {
    read_private_codex_profile_config_snapshot(path).map(|_| ())
}

#[cfg(target_os = "windows")]
fn validate_private_config_security(path: &Path) -> Result<(), String> {
    validate_windows_profile_path(path, false)?;
    verify_windows_owner_only_acl(path, false)?;
    validate_windows_profile_path(path, false)
}

#[cfg(all(test, unix))]
thread_local! {
    static CODEX_CONFIG_AFTER_OPEN_HOOK: std::cell::RefCell<Option<Box<dyn FnOnce(&Path)>>> =
        std::cell::RefCell::new(None);
}

#[cfg(all(test, unix))]
fn set_codex_config_after_open_hook(hook: impl FnOnce(&Path) + 'static) {
    CODEX_CONFIG_AFTER_OPEN_HOOK.with(|slot| {
        *slot.borrow_mut() = Some(Box::new(hook));
    });
}

#[cfg(all(test, unix))]
fn run_codex_config_after_open_hook(path: &Path) {
    CODEX_CONFIG_AFTER_OPEN_HOOK.with(|slot| {
        if let Some(hook) = slot.borrow_mut().take() {
            hook(path);
        }
    });
}

#[cfg(any(unix, target_os = "windows"))]
fn read_private_codex_profile_config_snapshot(
    path: &Path,
) -> Result<CodexProfileConfigSnapshot, String> {
    validate_private_config_security(path)?;
    let snapshot = read_codex_profile_config_snapshot(path, false)?
        .ok_or_else(|| "failed to read required account profile config".to_string())?;
    validate_private_config_security(path)?;
    if snapshot
        .document
        .get("cli_auth_credentials_store")
        .and_then(toml::Value::as_str)
        != Some("file")
    {
        return Err(
            "account profile config must set top-level cli_auth_credentials_store to \"file\""
                .to_string(),
        );
    }
    Ok(snapshot)
}

#[cfg(unix)]
fn open_codex_profile_config(path: &Path) -> std::io::Result<fs::File> {
    use std::os::unix::fs::OpenOptionsExt;

    OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(path)
}

#[cfg(target_os = "windows")]
fn open_codex_profile_config(path: &Path) -> std::io::Result<fs::File> {
    use std::os::windows::fs::OpenOptionsExt;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_FLAG_OPEN_REPARSE_POINT, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
    };

    OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE)
        .custom_flags(FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
}

#[cfg(any(unix, target_os = "windows"))]
fn validate_opened_codex_profile_config(file: &fs::File) -> Result<(), String> {
    let metadata = file
        .metadata()
        .map_err(|_| "failed to inspect account profile config".to_string())?;
    if !metadata.is_file() {
        return Err("account profile config must be a real file".to_string());
    }
    #[cfg(target_os = "windows")]
    validate_windows_profile_path_attributes(
        windows_file_information(file)?.dwFileAttributes,
        false,
    )?;
    Ok(())
}

#[cfg(any(unix, target_os = "windows"))]
fn read_codex_profile_config_snapshot(
    path: &Path,
    allow_missing: bool,
) -> Result<Option<CodexProfileConfigSnapshot>, String> {
    let mut file = match open_codex_profile_config(path) {
        Ok(file) => file,
        Err(error) if allow_missing && error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(None);
        }
        Err(_) => return Err("failed to read account profile config".to_string()),
    };
    validate_opened_codex_profile_config(&file)?;
    let opened_identity = profile_directory_identity(&file)
        .map_err(|_| "failed to inspect account profile config identity".to_string())?;
    let metadata = file
        .metadata()
        .map_err(|_| "failed to inspect account profile config".to_string())?;
    if metadata.len() > MAX_CODEX_PROFILE_CONFIG_BYTES as u64 {
        return Err("account profile config exceeds the supported size limit".to_string());
    }
    #[cfg(all(test, unix))]
    run_codex_config_after_open_hook(path);
    let mut contents = Vec::with_capacity(metadata.len() as usize);
    Read::by_ref(&mut file)
        .take(MAX_CODEX_PROFILE_CONFIG_BYTES.saturating_add(1) as u64)
        .read_to_end(&mut contents)
        .map_err(|_| "failed to read account profile config".to_string())?;
    if contents.len() > MAX_CODEX_PROFILE_CONFIG_BYTES {
        return Err("account profile config exceeds the supported size limit".to_string());
    }
    let current = open_codex_profile_config(path)
        .map_err(|_| "account profile config identity changed".to_string())?;
    validate_opened_codex_profile_config(&current)
        .map_err(|_| "account profile config identity changed".to_string())?;
    let current_identity = profile_directory_identity(&current)
        .map_err(|_| "account profile config identity changed".to_string())?;
    let reopened_identity = profile_directory_identity(&file)
        .map_err(|_| "account profile config identity changed".to_string())?;
    if current_identity != opened_identity || reopened_identity != opened_identity {
        return Err("account profile config identity changed".to_string());
    }
    let contents = std::str::from_utf8(&contents)
        .map_err(|_| "account profile config must be valid TOML".to_string())?;
    let document = toml::from_str::<toml::Table>(contents)
        .map_err(|_| "account profile config must be valid TOML".to_string())?;
    Ok(Some(CodexProfileConfigSnapshot { document }))
}

#[cfg(not(any(unix, target_os = "windows")))]
fn validate_private_config(_path: &Path) -> Result<(), String> {
    Err("unsupported_permissions: private config guarantees are unavailable".to_string())
}

#[cfg(not(any(unix, target_os = "windows")))]
fn read_private_codex_profile_config_snapshot(
    _path: &Path,
) -> Result<CodexProfileConfigSnapshot, String> {
    Err("unsupported_permissions: private config guarantees are unavailable".to_string())
}

#[cfg(not(any(unix, target_os = "windows")))]
fn read_codex_profile_config_snapshot(
    _path: &Path,
    _allow_missing: bool,
) -> Result<Option<CodexProfileConfigSnapshot>, String> {
    Err("unsupported_permissions: bounded config snapshots are unavailable".to_string())
}

fn remove_owned_profile_root_with_identity(
    roots: &Path,
    root: &Path,
    expected_identity: Option<ProfileDirectoryIdentity>,
) -> Result<(), String> {
    let opened = open_owned_profile_root(roots, root, expected_identity)?;
    opened.revalidate()?;
    fs::remove_dir_all(root)
        .map_err(|error| format!("failed to remove rolled-back account profile root: {error}"))
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<(), String> {
    fs::File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("failed to sync account profile directory: {error}"))
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn probe_codex_profile_capability(root: &Path) -> Result<(), String> {
    let mut command = Command::new("codex");
    command
        .args(["doctor", "--json"])
        .env("CODEX_HOME", root)
        .env_remove("CODEX_ACCESS_TOKEN")
        .env_remove("CODEX_API_KEY")
        .env_remove("OPENAI_API_KEY")
        .env_remove("CODEX_SQLITE_HOME")
        .stdin(Stdio::null());
    let stdout = run_codex_profile_probe_command(&mut command, root, CODEX_PROFILE_PROBE_TIMEOUT)?;
    let stdout = String::from_utf8(stdout)
        .map_err(|_| "Codex profile capability probe returned non-UTF-8 JSON".to_string())?;
    validate_codex_profile_doctor_report(root, &stdout)
}

#[cfg(any(test, target_os = "windows"))]
const WINDOWS_CREATE_SUSPENDED_FLAG: u32 = 0x0000_0004;

#[cfg(any(test, target_os = "windows"))]
const WINDOWS_CREATE_NO_WINDOW_FLAG: u32 = 0x0800_0000;

#[cfg(any(test, target_os = "windows"))]
fn windows_bounded_child_creation_flags() -> u32 {
    WINDOWS_CREATE_SUSPENDED_FLAG | WINDOWS_CREATE_NO_WINDOW_FLAG
}

#[cfg(test)]
fn windows_codex_probe_creation_flags() -> u32 {
    windows_bounded_child_creation_flags()
}

#[cfg(target_os = "windows")]
fn resume_suspended_windows_child(process_id: u32) -> Result<(), String> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, GetLastError, ERROR_NO_MORE_FILES, INVALID_HANDLE_VALUE},
        System::{
            Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, Thread32First, Thread32Next, TH32CS_SNAPTHREAD,
                THREADENTRY32,
            },
            Threading::{OpenThread, ResumeThread, THREAD_SUSPEND_RESUME},
        },
    };

    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return Err("failed to inspect the suspended bounded child process".to_string());
    }
    let located = (|| {
        let mut entry = THREADENTRY32 {
            dwSize: std::mem::size_of::<THREADENTRY32>() as u32,
            ..THREADENTRY32::default()
        };
        if unsafe { Thread32First(snapshot, &mut entry) } == 0 {
            return Err("failed to inspect the suspended bounded child thread".to_string());
        }
        let mut primary_thread_id = None;
        for _ in 0..MAX_WINDOWS_BOUNDED_CHILD_THREAD_SNAPSHOT_ENTRIES {
            if entry.th32OwnerProcessID == process_id {
                if primary_thread_id.replace(entry.th32ThreadID).is_some() {
                    return Err(
                        "suspended bounded child process had unexpected threads".to_string()
                    );
                }
            }
            entry.dwSize = std::mem::size_of::<THREADENTRY32>() as u32;
            if unsafe { Thread32Next(snapshot, &mut entry) } == 0 {
                if unsafe { GetLastError() } != ERROR_NO_MORE_FILES {
                    return Err(
                        "failed while inspecting the suspended bounded child thread".to_string()
                    );
                }
                let thread_id = primary_thread_id.ok_or_else(|| {
                    "suspended bounded child process thread was unavailable".to_string()
                })?;
                return Ok(thread_id);
            }
        }
        Err("suspended bounded child thread scan exceeded its safe limit".to_string())
    })();
    unsafe {
        CloseHandle(snapshot);
    }
    let thread_id = located?;
    let thread = unsafe { OpenThread(THREAD_SUSPEND_RESUME, 0, thread_id) };
    if thread.is_null() {
        return Err("failed to open the suspended bounded child thread".to_string());
    }
    let previous_suspend_count = unsafe { ResumeThread(thread) };
    unsafe {
        CloseHandle(thread);
    }
    if previous_suspend_count != 1 {
        return Err("failed to resume the suspended bounded child process".to_string());
    }
    Ok(())
}

pub(crate) struct BoundedChildProcessTree {
    #[cfg(unix)]
    process_group_id: Option<i32>,
    #[cfg(target_os = "windows")]
    job: windows_sys::Win32::Foundation::HANDLE,
}

#[cfg(any(target_os = "windows", test))]
pub(crate) fn windows_node_entrypoint_from_cmd_path(
    command_path: &Path,
    relative_script_path: &Path,
) -> Option<(PathBuf, PathBuf)> {
    use std::path::Component;

    if !command_path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("cmd"))
        || relative_script_path.is_absolute()
        || relative_script_path
            .components()
            .any(|component| !matches!(component, Component::Normal(_) | Component::CurDir))
    {
        return None;
    }
    let install_directory = command_path.parent()?;
    let script_path = install_directory.join(relative_script_path);
    if !script_path.is_file() {
        return None;
    }

    let local_node = install_directory.join("node.exe");
    let node_program = if local_node.is_file() {
        local_node
    } else {
        PathBuf::from("node.exe")
    };
    Some((node_program, script_path))
}

impl BoundedChildProcessTree {
    pub(crate) fn prepare(_command: &mut Command) -> Result<Self, String> {
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;

            _command.process_group(0);
            Ok(Self {
                process_group_id: None,
            })
        }

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            use windows_sys::Win32::{
                Foundation::CloseHandle,
                System::JobObjects::{
                    CreateJobObjectW, JobObjectExtendedLimitInformation, SetInformationJobObject,
                    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                },
            };

            _command.creation_flags(windows_bounded_child_creation_flags());
            let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
            if job.is_null() {
                return Err("failed to create bounded child-process containment".to_string());
            }
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let configured = unsafe {
                SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    std::ptr::addr_of!(limits).cast(),
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            };
            if configured == 0 {
                unsafe {
                    CloseHandle(job);
                }
                return Err("failed to configure bounded child-process containment".to_string());
            }
            Ok(Self { job })
        }

        #[cfg(not(any(unix, target_os = "windows")))]
        {
            let _ = _command;
            Err("unsupported_platform: bounded child process trees are unavailable".to_string())
        }
    }

    pub(crate) fn attach(&mut self, child: &std::process::Child) -> Result<(), String> {
        #[cfg(unix)]
        {
            self.process_group_id = Some(
                i32::try_from(child.id())
                    .map_err(|_| "bounded child process ID is invalid".to_string())?,
            );
            Ok(())
        }

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::io::AsRawHandle;
            use windows_sys::Win32::System::JobObjects::AssignProcessToJobObject;

            if unsafe { AssignProcessToJobObject(self.job, child.as_raw_handle().cast()) } == 0 {
                return Err("failed to contain the bounded child process".to_string());
            }
            resume_suspended_windows_child(child.id())
        }

        #[cfg(not(any(unix, target_os = "windows")))]
        {
            let _ = child;
            Err("unsupported_platform: bounded child process trees are unavailable".to_string())
        }
    }

    pub(crate) fn terminate(&self, child: &mut std::process::Child) {
        let _ = self.terminate_with_status(child);
    }

    pub(crate) fn terminate_with_status(
        &self,
        child: &mut std::process::Child,
    ) -> Option<std::process::ExitStatus> {
        #[cfg(unix)]
        if let Some(process_group_id) = self.process_group_id {
            unsafe extern "C" {
                fn kill(process_id: i32, signal: i32) -> i32;
            }

            unsafe {
                kill(-process_group_id, 9);
            }
        }

        #[cfg(target_os = "windows")]
        unsafe {
            windows_sys::Win32::System::JobObjects::TerminateJobObject(self.job, 1);
        }

        let _ = child.kill();
        child.wait().ok()
    }
}

impl Drop for BoundedChildProcessTree {
    fn drop(&mut self) {
        #[cfg(target_os = "windows")]
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.job);
        }
    }
}

// Keep the Task 4 adapter source-compatible while both providers migrate to
// the shared containment primitive.
pub(crate) type CodexChildProcessTree = BoundedChildProcessTree;

fn spawn_bounded_probe_reader<R: Read + Send + 'static>(
    mut reader: R,
    capture: bool,
    output_exceeded: Arc<AtomicBool>,
    label: &str,
) -> Result<std::thread::JoinHandle<Result<Vec<u8>, String>>, String> {
    std::thread::Builder::new()
        .name(format!("codex-profile-probe-{label}"))
        .spawn(move || {
            let mut captured = Vec::new();
            let mut observed = 0_usize;
            let mut buffer = [0_u8; 8192];
            loop {
                let read = reader.read(&mut buffer).map_err(|_| {
                    "failed to read bounded Codex profile capability output".to_string()
                })?;
                if read == 0 {
                    break;
                }
                observed = observed.saturating_add(read);
                if capture {
                    let remaining =
                        (CODEX_PROFILE_PROBE_OUTPUT_LIMIT + 1).saturating_sub(captured.len());
                    captured.extend_from_slice(&buffer[..read.min(remaining)]);
                }
                if observed > CODEX_PROFILE_PROBE_OUTPUT_LIMIT {
                    output_exceeded.store(true, Ordering::Release);
                    break;
                }
            }
            Ok(captured)
        })
        .map_err(|_| "failed to monitor Codex profile capability output".to_string())
}

fn run_codex_profile_probe_command(
    command: &mut Command,
    _io_root: &Path,
    timeout: Duration,
) -> Result<Vec<u8>, String> {
    let mut process_tree = CodexChildProcessTree::prepare(command)?;
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|_| "failed to start the Codex profile capability probe".to_string())?;
    if let Err(error) = process_tree.attach(&child) {
        process_tree.terminate(&mut child);
        return Err(error);
    }
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            process_tree.terminate(&mut child);
            return Err("failed to isolate Codex profile capability output".to_string());
        }
    };
    let stderr = match child.stderr.take() {
        Some(stderr) => stderr,
        None => {
            process_tree.terminate(&mut child);
            return Err("failed to isolate Codex profile capability diagnostics".to_string());
        }
    };
    let output_exceeded = Arc::new(AtomicBool::new(false));
    let stdout_reader =
        match spawn_bounded_probe_reader(stdout, true, Arc::clone(&output_exceeded), "stdout") {
            Ok(reader) => reader,
            Err(error) => {
                process_tree.terminate(&mut child);
                return Err(error);
            }
        };
    let stderr_reader =
        match spawn_bounded_probe_reader(stderr, false, Arc::clone(&output_exceeded), "stderr") {
            Ok(reader) => reader,
            Err(error) => {
                process_tree.terminate(&mut child);
                let _ = stdout_reader.join();
                return Err(error);
            }
        };
    let started = Instant::now();
    let completion = loop {
        if output_exceeded.load(Ordering::Acquire) {
            process_tree.terminate(&mut child);
            break Err("Codex profile capability output exceeded the safe limit".to_string());
        }
        match child.try_wait() {
            Ok(Some(_)) => {
                process_tree.terminate(&mut child);
                break Ok(());
            }
            Ok(None) if started.elapsed() < timeout => {
                std::thread::sleep(Duration::from_millis(10));
            }
            Ok(None) => {
                process_tree.terminate(&mut child);
                break Err(
                    "Codex profile capability probe timed out and was terminated".to_string(),
                );
            }
            Err(_) => {
                process_tree.terminate(&mut child);
                break Err(
                    "failed while waiting for the Codex profile capability probe".to_string(),
                );
            }
        }
    };
    let stdout = stdout_reader
        .join()
        .map_err(|_| "failed to join Codex profile capability output monitor".to_string())?;
    let stderr = stderr_reader
        .join()
        .map_err(|_| "failed to join Codex profile capability diagnostics monitor".to_string())?;
    if output_exceeded.load(Ordering::Acquire) {
        return Err("Codex profile capability output exceeded the safe limit".to_string());
    }
    completion?;
    stderr?;
    stdout
}

fn validate_codex_profile_doctor_report(root: &Path, report: &str) -> Result<(), String> {
    let report = serde_json::from_str::<serde_json::Value>(report).map_err(|error| {
        format!("Codex profile capability probe returned invalid JSON: {error}")
    })?;
    let version = report
        .get("codexVersion")
        .and_then(serde_json::Value::as_str)
        .filter(|version| !version.trim().is_empty())
        .ok_or_else(|| "Codex profile capability probe did not report its version".to_string())?;
    let checks = report
        .get("checks")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| format!("Codex {version} profile capability checks are unavailable"))?;
    let config = checks
        .get("config.load")
        .ok_or_else(|| format!("Codex {version} did not prove CODEX_HOME config loading"))?;
    if config.get("status").and_then(serde_json::Value::as_str) != Some("ok") {
        return Err(format!(
            "Codex {version} rejected the isolated profile config"
        ));
    }
    let config_details = config
        .get("details")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| format!("Codex {version} omitted isolated config details"))?;
    let canonical_root = fs::canonicalize(root)
        .map_err(|error| format!("failed to canonicalize the probed Codex root: {error}"))?;
    let reported_root = config_details
        .get("CODEX_HOME")
        .and_then(serde_json::Value::as_str)
        .map(PathBuf::from)
        .ok_or_else(|| format!("Codex {version} omitted the effective CODEX_HOME"))?;
    let reported_config = config_details
        .get("config.toml")
        .and_then(serde_json::Value::as_str)
        .map(PathBuf::from)
        .ok_or_else(|| format!("Codex {version} omitted the effective config path"))?;
    if reported_root != canonical_root || reported_config != canonical_root.join("config.toml") {
        return Err(format!(
            "Codex {version} did not honor the isolated CODEX_HOME root"
        ));
    }

    let auth = checks
        .get("auth.credentials")
        .and_then(|check| check.get("details"))
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| format!("Codex {version} omitted credential-store probe details"))?;
    let storage_mode = auth
        .get("auth storage mode")
        .and_then(serde_json::Value::as_str);
    let auth_path = auth
        .get("auth file")
        .and_then(serde_json::Value::as_str)
        .map(PathBuf::from);
    if storage_mode != Some("File")
        || auth_path.as_deref() != Some(&canonical_root.join("auth.json"))
    {
        return Err(format!(
            "Codex {version} did not honor cli_auth_credentials_store = 'file' in the isolated root"
        ));
    }
    Ok(())
}

fn persist_auth_store_to_path_with_parent_sync(
    store: &AgentAuthStore,
    path: &Path,
    sync_parent: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<(), String> {
    let mut snapshot = store.clone();
    snapshot.version = AGENT_PROFILE_REGISTRY_VERSION;
    snapshot.sync_reserved_profiles_from_connections(true)?;
    snapshot.last_synced_at = unix_timestamp_ms();
    let serialized = serde_json::to_string_pretty(&snapshot)
        .map_err(|error| format!("failed to serialize auth state: {error}"))?;
    write_auth_store_atomically_with_parent_sync(path, serialized.as_bytes(), sync_parent)
}

fn parse_auth_store(contents: &str) -> Result<AgentAuthStore, String> {
    let mut raw_store = serde_json::from_str::<serde_json::Value>(contents)
        .map_err(|error| format!("invalid auth state JSON: {error}"))?;
    let root = raw_store
        .as_object_mut()
        .ok_or_else(|| "auth state must be a top-level object".to_string())?;
    let version = match root.get("version") {
        None => 1,
        Some(value) => value
            .as_u64()
            .and_then(|value| u32::try_from(value).ok())
            .ok_or_else(|| "auth state version must be a positive integer".to_string())?,
    };
    if !matches!(version, 1 | AGENT_PROFILE_REGISTRY_VERSION) {
        return Err(format!("unsupported auth store version: {version}"));
    }
    if version == AGENT_PROFILE_REGISTRY_VERSION && !root.contains_key("profileRegistry") {
        return Err("v2 auth state profileRegistry is required".to_string());
    }
    if version == 1 {
        root.remove("profileRegistry");
    }

    let raw_connections = root
        .get("connections")
        .and_then(serde_json::Value::as_object);
    if version == 1 && raw_connections.is_none() {
        return Err("auth state connections must be an object".to_string());
    }
    let mut sanitized_connections = serde_json::Map::new();

    for provider in [AgentProvider::Codex, AgentProvider::Claude] {
        let Some(raw_snapshot) =
            raw_connections.and_then(|connections| connections.get(provider.as_key()))
        else {
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
    root.insert("version".to_string(), serde_json::json!(version));
    root.insert(
        "pendingLogins".to_string(),
        serde_json::Value::Object(serde_json::Map::new()),
    );
    root.insert("nextLoginId".to_string(), serde_json::json!(0));
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
        let mut options = OpenOptions::new();
        options.create_new(true).write(true);
        #[cfg(unix)]
        options.mode(0o600);
        match options.open(&temporary) {
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

// Task 1 defines this schema before Task 2 wires it into the active auth store.
#[allow(dead_code)]
mod profile_registry_v2 {
    use super::{
        unix_timestamp_ms, AgentConnectionStatus, AgentProvider, CLAUDE_VALIDATION_FAILURE,
        CODEX_VALIDATION_FAILURE,
    };
    use serde::{Deserialize, Serialize};
    use std::collections::HashSet;

    pub const AGENT_PROFILE_REGISTRY_VERSION: u32 = 2;
    pub const MAX_AGENT_PROFILES_PER_PROVIDER: usize = 16;
    pub const CODEX_DEFAULT_ACCOUNT_ID: &str = "codex-default";
    pub const CLAUDE_DEFAULT_ACCOUNT_ID: &str = "claude-default";

    #[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
    #[serde(transparent)]
    pub struct AgentProfileIncarnation(u64);

    impl AgentProfileIncarnation {
        pub fn value(self) -> u64 {
            self.0
        }
    }

    #[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
    #[serde(transparent)]
    pub struct AgentProfileMetadataRevision(u64);

    impl AgentProfileMetadataRevision {
        pub fn value(self) -> u64 {
            self.0
        }

        fn next(self) -> Result<Self, String> {
            self.0
                .checked_add(1)
                .map(Self)
                .ok_or_else(|| "profile metadata revision is exhausted".to_string())
        }
    }

    #[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, Hash, Ord, PartialEq, PartialOrd)]
    #[serde(transparent)]
    pub struct AgentProfileCredentialRevision(u64);

    impl AgentProfileCredentialRevision {
        pub fn value(self) -> u64 {
            self.0
        }

        fn next(self) -> Result<Self, String> {
            self.0
                .checked_add(1)
                .map(Self)
                .ok_or_else(|| "profile credential revision is exhausted".to_string())
        }
    }

    #[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq)]
    #[serde(tag = "kind", rename_all = "snake_case")]
    pub enum AgentProfileKind {
        Ambient,
        CodexHome,
        ClaudeConfigDir,
    }

    #[derive(Serialize, Deserialize, Clone, Debug, Eq, PartialEq)]
    #[serde(rename_all = "camelCase")]
    pub struct AgentProfileConnection {
        pub status: AgentConnectionStatus,
        #[serde(default = "requires_validation_by_default")]
        pub requires_validation: bool,
        #[serde(default)]
        pub credential_source: Option<String>,
        #[serde(default)]
        pub connected_at: Option<u64>,
        pub updated_at: u64,
        #[serde(default)]
        pub last_error: Option<String>,
    }

    impl AgentProfileConnection {
        fn disconnected() -> Self {
            Self {
                status: AgentConnectionStatus::Disconnected,
                requires_validation: false,
                credential_source: None,
                connected_at: None,
                updated_at: unix_timestamp_ms(),
                last_error: None,
            }
        }

        pub fn is_authoritative_connected(&self) -> bool {
            self.status == AgentConnectionStatus::Connected && !self.requires_validation
        }
    }

    fn requires_validation_by_default() -> bool {
        true
    }

    #[derive(Serialize, Deserialize, Clone, Debug, Eq, PartialEq)]
    #[serde(rename_all = "camelCase")]
    pub struct AgentProfileRecord {
        account_id: String,
        provider: AgentProvider,
        alias: String,
        profile_kind: AgentProfileKind,
        is_default: bool,
        incarnation: AgentProfileIncarnation,
        metadata_revision: AgentProfileMetadataRevision,
        credential_revision: AgentProfileCredentialRevision,
        connection: AgentProfileConnection,
    }

    impl AgentProfileRecord {
        pub fn account_id(&self) -> &str {
            &self.account_id
        }

        pub fn provider(&self) -> AgentProvider {
            self.provider
        }

        pub fn alias(&self) -> &str {
            &self.alias
        }

        pub fn profile_kind(&self) -> AgentProfileKind {
            self.profile_kind
        }

        pub fn is_default(&self) -> bool {
            self.is_default
        }

        pub fn incarnation(&self) -> u64 {
            self.incarnation.value()
        }

        pub fn metadata_revision(&self) -> u64 {
            self.metadata_revision.value()
        }

        pub fn credential_revision(&self) -> u64 {
            self.credential_revision.value()
        }

        pub fn connection(&self) -> &AgentProfileConnection {
            &self.connection
        }
    }

    #[derive(Serialize, Deserialize, Clone, Debug, Eq, PartialEq)]
    #[serde(rename_all = "camelCase")]
    pub struct AgentProfileTombstone {
        account_id: String,
        provider: AgentProvider,
        incarnation: AgentProfileIncarnation,
        credential_revision: AgentProfileCredentialRevision,
        forgotten_at: u64,
    }

    impl AgentProfileTombstone {
        pub fn account_id(&self) -> &str {
            &self.account_id
        }

        pub fn provider(&self) -> AgentProvider {
            self.provider
        }

        pub fn incarnation(&self) -> u64 {
            self.incarnation.value()
        }

        pub fn credential_revision(&self) -> u64 {
            self.credential_revision.value()
        }

        pub fn forgotten_at(&self) -> u64 {
            self.forgotten_at
        }
    }

    #[derive(Serialize, Deserialize, Clone, Debug, Eq, PartialEq)]
    #[serde(rename_all = "camelCase")]
    pub struct AgentAccountLease {
        provider: AgentProvider,
        account_id: String,
        incarnation: AgentProfileIncarnation,
        credential_revision: AgentProfileCredentialRevision,
    }

    impl AgentAccountLease {
        pub fn provider(&self) -> AgentProvider {
            self.provider
        }

        pub fn account_id(&self) -> &str {
            &self.account_id
        }

        pub fn incarnation(&self) -> u64 {
            self.incarnation.value()
        }

        pub fn credential_revision(&self) -> u64 {
            self.credential_revision.value()
        }
    }

    #[derive(Serialize, Deserialize, Clone, Debug, Eq, PartialEq)]
    #[serde(rename_all = "camelCase")]
    pub struct AgentProfileRegistryV2 {
        version: u32,
        profiles: Vec<AgentProfileRecord>,
        tombstones: Vec<AgentProfileTombstone>,
        next_profile_counter: u64,
        next_incarnation: u64,
    }

    impl Default for AgentProfileRegistryV2 {
        fn default() -> Self {
            Self::new()
        }
    }

    impl AgentProfileRegistryV2 {
        pub fn new() -> Self {
            let now = unix_timestamp_ms();
            Self {
                version: AGENT_PROFILE_REGISTRY_VERSION,
                profiles: vec![
                    reserved_profile(
                        AgentProvider::Codex,
                        CODEX_DEFAULT_ACCOUNT_ID,
                        AgentProfileIncarnation(1),
                        now,
                    ),
                    reserved_profile(
                        AgentProvider::Claude,
                        CLAUDE_DEFAULT_ACCOUNT_ID,
                        AgentProfileIncarnation(2),
                        now,
                    ),
                ],
                tombstones: Vec::new(),
                next_profile_counter: 1,
                next_incarnation: 3,
            }
        }

        pub fn version(&self) -> u32 {
            self.version
        }

        pub fn visible_profiles(&self, provider: AgentProvider) -> Vec<&AgentProfileRecord> {
            self.profiles
                .iter()
                .filter(|profile| profile.provider == provider)
                .collect()
        }

        pub fn tombstones(&self, provider: AgentProvider) -> Vec<&AgentProfileTombstone> {
            self.tombstones
                .iter()
                .filter(|tombstone| tombstone.provider == provider)
                .collect()
        }

        pub fn add_profile(
            &mut self,
            provider: AgentProvider,
            alias: &str,
            profile_kind: AgentProfileKind,
        ) -> Result<AgentProfileRecord, String> {
            self.validate()?;
            let alias = normalize_profile_alias(alias)?;
            validate_profile_kind(provider, profile_kind)?;
            if profile_kind == AgentProfileKind::Ambient {
                return Err("ambient profile IDs are reserved defaults".to_string());
            }
            if self.provider_entry_count(provider) >= MAX_AGENT_PROFILES_PER_PROVIDER {
                return Err(format!(
                "{provider:?} already has the maximum of {MAX_AGENT_PROFILES_PER_PROVIDER} visible or tombstoned profiles"
            ));
            }

            let counter = self.next_profile_counter;
            let next_profile_counter = counter
                .checked_add(1)
                .ok_or_else(|| "profile ID counter is exhausted".to_string())?;
            let account_id = format!(
                "{}-profile-{}",
                provider.as_key(),
                lowercase_base36(counter)
            );
            if !is_valid_generated_profile_id(provider, &account_id) {
                return Err("generated profile ID violated the profile ID grammar".to_string());
            }
            let incarnation = AgentProfileIncarnation(self.next_incarnation);
            let next_incarnation = self
                .next_incarnation
                .checked_add(1)
                .ok_or_else(|| "profile incarnation counter is exhausted".to_string())?;
            let now = unix_timestamp_ms();
            let profile = AgentProfileRecord {
                account_id,
                provider,
                alias,
                profile_kind,
                is_default: false,
                incarnation,
                metadata_revision: AgentProfileMetadataRevision(1),
                credential_revision: AgentProfileCredentialRevision(1),
                connection: AgentProfileConnection {
                    updated_at: now,
                    ..AgentProfileConnection::disconnected()
                },
            };

            self.next_profile_counter = next_profile_counter;
            self.next_incarnation = next_incarnation;
            self.profiles.push(profile.clone());
            debug_assert!(self.validate().is_ok());
            Ok(profile)
        }

        pub fn rename_profile(
            &mut self,
            provider: AgentProvider,
            account_id: &str,
            alias: &str,
        ) -> Result<AgentProfileRecord, String> {
            let alias = normalize_profile_alias(alias)?;
            let index = self.profile_index(provider, account_id)?;
            let next_metadata_revision = self.profiles[index].metadata_revision.next()?;
            let profile = &mut self.profiles[index];
            profile.alias = alias;
            profile.metadata_revision = next_metadata_revision;
            Ok(profile.clone())
        }

        pub fn set_default(
            &mut self,
            provider: AgentProvider,
            account_id: &str,
        ) -> Result<AgentProfileRecord, String> {
            self.validate()?;
            let target_index = self.profile_index(provider, account_id)?;
            if self.profiles[target_index].is_default {
                return Ok(self.profiles[target_index].clone());
            }
            let current_index = self
                .profiles
                .iter()
                .position(|profile| profile.provider == provider && profile.is_default)
                .ok_or_else(|| format!("{provider:?} has no default profile"))?;
            let next_current_revision = self.profiles[current_index].metadata_revision.next()?;
            let next_target_revision = self.profiles[target_index].metadata_revision.next()?;

            self.profiles[current_index].is_default = false;
            self.profiles[current_index].metadata_revision = next_current_revision;
            self.profiles[target_index].is_default = true;
            self.profiles[target_index].metadata_revision = next_target_revision;
            debug_assert!(self.validate().is_ok());
            Ok(self.profiles[target_index].clone())
        }

        pub fn advance_credential_revision(
            &mut self,
            provider: AgentProvider,
            account_id: &str,
        ) -> Result<AgentProfileRecord, String> {
            let index = self.profile_index(provider, account_id)?;
            let profile = &mut self.profiles[index];
            profile.credential_revision = profile.credential_revision.next()?;
            profile.connection.updated_at = unix_timestamp_ms();
            Ok(profile.clone())
        }

        pub fn install_connection(
            &mut self,
            provider: AgentProvider,
            account_id: &str,
            connection: AgentProfileConnection,
            advance_credential_revision: bool,
        ) -> Result<AgentProfileRecord, String> {
            let index = self.profile_index(provider, account_id)?;
            let next_credential_revision = if advance_credential_revision {
                self.profiles[index].credential_revision.next()?
            } else {
                self.profiles[index].credential_revision
            };
            let profile = &mut self.profiles[index];
            profile.connection = connection;
            profile.credential_revision = next_credential_revision;
            Ok(profile.clone())
        }

        pub fn tombstone_profile(
            &mut self,
            provider: AgentProvider,
            account_id: &str,
        ) -> Result<AgentProfileTombstone, String> {
            let index = self.profile_index(provider, account_id)?;
            if self.profiles[index].account_id == reserved_account_id(provider) {
                return Err("the reserved ambient default profile cannot be forgotten".to_string());
            }
            if self.profiles[index].is_default {
                return Err("the current default profile cannot be forgotten".to_string());
            }

            let next_credential_revision = self.profiles[index].credential_revision.next()?;
            let profile = self.profiles.remove(index);
            let tombstone = AgentProfileTombstone {
                account_id: profile.account_id,
                provider: profile.provider,
                incarnation: profile.incarnation,
                credential_revision: next_credential_revision,
                forgotten_at: unix_timestamp_ms(),
            };
            self.tombstones.push(tombstone.clone());
            debug_assert!(self.validate().is_ok());
            Ok(tombstone)
        }

        pub fn account_lease(
            &self,
            provider: AgentProvider,
            account_id: &str,
        ) -> Result<AgentAccountLease, String> {
            let profile = &self.profiles[self.profile_index(provider, account_id)?];
            Ok(AgentAccountLease {
                provider,
                account_id: profile.account_id.clone(),
                incarnation: profile.incarnation,
                credential_revision: profile.credential_revision,
            })
        }

        pub fn is_lease_current(&self, lease: &AgentAccountLease) -> bool {
            self.profiles.iter().any(|profile| {
                profile.provider == lease.provider
                    && profile.account_id == lease.account_id
                    && profile.incarnation == lease.incarnation
                    && profile.credential_revision == lease.credential_revision
            })
        }

        pub fn reserved_profile(
            &self,
            provider: AgentProvider,
        ) -> Result<&AgentProfileRecord, String> {
            self.profiles
                .iter()
                .find(|profile| profile.account_id == reserved_account_id(provider))
                .ok_or_else(|| format!("{provider:?} reserved default profile is missing"))
        }

        pub fn install_reserved_connection(
            &mut self,
            provider: AgentProvider,
            connection: AgentProfileConnection,
            advance_credential_revision: bool,
        ) -> Result<(), String> {
            let index = self.profile_index(provider, reserved_account_id(provider))?;
            if self.profiles[index].connection == connection {
                return Ok(());
            }
            let next_credential_revision = if advance_credential_revision {
                self.profiles[index].credential_revision.next()?
            } else {
                self.profiles[index].credential_revision
            };
            self.profiles[index].connection = connection;
            self.profiles[index].credential_revision = next_credential_revision;
            Ok(())
        }

        pub fn sanitize_persisted_connections(&mut self, now: u64) -> Result<(), String> {
            for profile in &mut self.profiles {
                let sanitized = sanitize_persisted_connection(
                    profile.provider,
                    profile.connection.clone(),
                    now,
                );
                if sanitized != profile.connection {
                    profile.credential_revision = profile.credential_revision.next()?;
                    profile.connection = sanitized;
                }
            }
            Ok(())
        }

        pub fn validate(&self) -> Result<(), String> {
            if self.version != AGENT_PROFILE_REGISTRY_VERSION {
                return Err(format!(
                    "unsupported Agent profile registry version: {}",
                    self.version
                ));
            }
            if self.next_profile_counter == 0 || self.next_incarnation == 0 {
                return Err("profile allocation counters must be positive".to_string());
            }

            let mut account_ids = HashSet::new();
            let mut incarnations = HashSet::new();
            let mut maximum_incarnation = 0;
            let mut maximum_profile_counter = 0;
            for profile in &self.profiles {
                if !account_ids.insert(profile.account_id.as_str()) {
                    return Err(format!("duplicate account ID: {}", profile.account_id));
                }
                validate_stored_profile(profile)?;
                if !incarnations.insert(profile.incarnation) {
                    return Err(format!(
                        "duplicate profile incarnation: {}",
                        profile.incarnation.value()
                    ));
                }
                maximum_incarnation = maximum_incarnation.max(profile.incarnation.value());
                if let Some(counter) =
                    generated_profile_counter(profile.provider, &profile.account_id)
                {
                    maximum_profile_counter = maximum_profile_counter.max(counter);
                }
            }
            for tombstone in &self.tombstones {
                if !account_ids.insert(tombstone.account_id.as_str()) {
                    return Err(format!("duplicate account ID: {}", tombstone.account_id));
                }
                if !is_valid_generated_profile_id(tombstone.provider, &tombstone.account_id) {
                    return Err(format!(
                        "invalid tombstoned account ID for {:?}: {}",
                        tombstone.provider, tombstone.account_id
                    ));
                }
                if tombstone.incarnation.value() == 0 || tombstone.credential_revision.value() == 0
                {
                    return Err("tombstone revisions must be positive".to_string());
                }
                if !incarnations.insert(tombstone.incarnation) {
                    return Err(format!(
                        "duplicate profile incarnation: {}",
                        tombstone.incarnation.value()
                    ));
                }
                maximum_incarnation = maximum_incarnation.max(tombstone.incarnation.value());
                if let Some(counter) =
                    generated_profile_counter(tombstone.provider, &tombstone.account_id)
                {
                    maximum_profile_counter = maximum_profile_counter.max(counter);
                }
            }

            for provider in [AgentProvider::Codex, AgentProvider::Claude] {
                let entry_count = self.provider_entry_count(provider);
                if entry_count > MAX_AGENT_PROFILES_PER_PROVIDER {
                    return Err(format!(
                    "{provider:?} exceeds the {MAX_AGENT_PROFILES_PER_PROVIDER}-profile capacity"
                ));
                }
                let profiles = self.visible_profiles(provider);
                if profiles.iter().filter(|profile| profile.is_default).count() != 1 {
                    return Err(format!(
                        "{provider:?} must have exactly one default profile"
                    ));
                }
                let reserved_id = reserved_account_id(provider);
                let Some(reserved) = profiles
                    .iter()
                    .find(|profile| profile.account_id == reserved_id)
                else {
                    return Err(format!("{provider:?} reserved default profile is missing"));
                };
                if reserved.profile_kind != AgentProfileKind::Ambient {
                    return Err(format!("{provider:?} reserved profile must remain ambient"));
                }
            }

            if self.next_incarnation <= maximum_incarnation {
                return Err("profile incarnation counter would reuse an allocation".to_string());
            }
            if self.next_profile_counter <= maximum_profile_counter {
                return Err("profile ID counter would reuse an allocation".to_string());
            }
            Ok(())
        }

        fn provider_entry_count(&self, provider: AgentProvider) -> usize {
            self.profiles
                .iter()
                .filter(|profile| profile.provider == provider)
                .count()
                + self
                    .tombstones
                    .iter()
                    .filter(|tombstone| tombstone.provider == provider)
                    .count()
        }

        fn profile_index(
            &self,
            provider: AgentProvider,
            account_id: &str,
        ) -> Result<usize, String> {
            let Some(index) = self
                .profiles
                .iter()
                .position(|profile| profile.account_id == account_id)
            else {
                if self
                    .tombstones
                    .iter()
                    .any(|tombstone| tombstone.account_id == account_id)
                {
                    return Err(format!("account profile is forgotten: {account_id}"));
                }
                return Err(format!("unknown account profile: {account_id}"));
            };
            if self.profiles[index].provider != provider {
                return Err(format!(
                    "provider/account mismatch for {account_id}: expected {:?}, got {provider:?}",
                    self.profiles[index].provider
                ));
            }
            Ok(index)
        }
    }

    fn reserved_profile(
        provider: AgentProvider,
        account_id: &str,
        incarnation: AgentProfileIncarnation,
        now: u64,
    ) -> AgentProfileRecord {
        AgentProfileRecord {
            account_id: account_id.to_string(),
            provider,
            alias: provider.display_name().to_string(),
            profile_kind: AgentProfileKind::Ambient,
            is_default: true,
            incarnation,
            metadata_revision: AgentProfileMetadataRevision(1),
            credential_revision: AgentProfileCredentialRevision(1),
            connection: AgentProfileConnection {
                updated_at: now,
                ..AgentProfileConnection::disconnected()
            },
        }
    }

    fn sanitize_persisted_connection(
        provider: AgentProvider,
        connection: AgentProfileConnection,
        now: u64,
    ) -> AgentProfileConnection {
        let updated_at = if connection.updated_at == 0 {
            now
        } else {
            connection.updated_at
        };
        match connection.status {
            AgentConnectionStatus::Pending | AgentConnectionStatus::Disconnected => {
                AgentProfileConnection {
                    status: AgentConnectionStatus::Disconnected,
                    requires_validation: false,
                    credential_source: None,
                    connected_at: None,
                    updated_at,
                    last_error: None,
                }
            }
            AgentConnectionStatus::Connected => {
                let credential_source = match provider {
                    AgentProvider::Codex => None,
                    AgentProvider::Claude => connection
                        .credential_source
                        .filter(|source| is_recognized_claude_credential_source(source)),
                };
                if provider == AgentProvider::Claude && credential_source.is_none() {
                    return AgentProfileConnection {
                        status: AgentConnectionStatus::Disconnected,
                        requires_validation: false,
                        credential_source: None,
                        connected_at: None,
                        updated_at,
                        last_error: None,
                    };
                }
                AgentProfileConnection {
                    status: AgentConnectionStatus::Connected,
                    requires_validation: true,
                    credential_source,
                    connected_at: connection
                        .connected_at
                        .filter(|connected_at| *connected_at > 0 && *connected_at <= updated_at),
                    updated_at,
                    last_error: None,
                }
            }
            AgentConnectionStatus::Error => AgentProfileConnection {
                status: AgentConnectionStatus::Error,
                requires_validation: false,
                credential_source: None,
                connected_at: None,
                updated_at,
                last_error: Some(
                    match provider {
                        AgentProvider::Codex => CODEX_VALIDATION_FAILURE,
                        AgentProvider::Claude => CLAUDE_VALIDATION_FAILURE,
                    }
                    .to_string(),
                ),
            },
        }
    }

    fn is_recognized_claude_credential_source(source: &str) -> bool {
        matches!(
            source,
            "claude_cli_session" | "anthropic_api_key" | "api_key_helper"
        )
    }

    fn reserved_account_id(provider: AgentProvider) -> &'static str {
        match provider {
            AgentProvider::Codex => CODEX_DEFAULT_ACCOUNT_ID,
            AgentProvider::Claude => CLAUDE_DEFAULT_ACCOUNT_ID,
        }
    }

    fn validate_stored_profile(profile: &AgentProfileRecord) -> Result<(), String> {
        if normalize_profile_alias(&profile.alias)? != profile.alias {
            return Err(format!(
                "profile alias is not stored canonically: {}",
                profile.account_id
            ));
        }
        validate_profile_kind(profile.provider, profile.profile_kind)?;
        if profile.incarnation.value() == 0
            || profile.metadata_revision.value() == 0
            || profile.credential_revision.value() == 0
        {
            return Err("profile revisions must be positive".to_string());
        }

        let reserved_id = reserved_account_id(profile.provider);
        if profile.account_id == reserved_id {
            if profile.profile_kind != AgentProfileKind::Ambient {
                return Err(format!(
                    "reserved account {reserved_id} must remain ambient"
                ));
            }
        } else if profile.profile_kind == AgentProfileKind::Ambient
            || !is_valid_generated_profile_id(profile.provider, &profile.account_id)
        {
            return Err(format!(
                "invalid generated account profile for {:?}: {}",
                profile.provider, profile.account_id
            ));
        }
        Ok(())
    }

    fn validate_profile_kind(
        provider: AgentProvider,
        profile_kind: AgentProfileKind,
    ) -> Result<(), String> {
        let valid = match (provider, profile_kind) {
            (_, AgentProfileKind::Ambient) => true,
            (AgentProvider::Codex, AgentProfileKind::CodexHome) => true,
            (AgentProvider::Claude, AgentProfileKind::ClaudeConfigDir) => true,
            _ => false,
        };
        valid.then_some(()).ok_or_else(|| {
            format!("profile kind {profile_kind:?} does not match provider {provider:?}")
        })
    }

    fn normalize_profile_alias(alias: &str) -> Result<String, String> {
        let alias = alias.trim();
        if alias.is_empty() || alias.len() > 64 || alias.chars().any(char::is_control) {
            return Err(
            "profile alias must be 1-64 UTF-8 bytes after trimming and contain no control characters"
                .to_string(),
        );
        }
        Ok(alias.to_string())
    }

    pub(super) fn is_valid_generated_profile_id(provider: AgentProvider, account_id: &str) -> bool {
        account_id.is_ascii()
            && account_id.len() <= 64
            && generated_profile_counter(provider, account_id).is_some()
    }

    fn generated_profile_counter(provider: AgentProvider, account_id: &str) -> Option<u64> {
        let prefix = format!("{}-profile-", provider.as_key());
        let suffix = account_id.strip_prefix(&prefix)?;
        if suffix.is_empty()
            || !suffix
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'z').contains(&byte))
        {
            return None;
        }
        let counter = u64::from_str_radix(suffix, 36).ok()?;
        (counter > 0 && lowercase_base36(counter) == suffix).then_some(counter)
    }

    fn lowercase_base36(mut value: u64) -> String {
        const DIGITS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";
        let mut encoded = [0_u8; 13];
        let mut cursor = encoded.len();
        loop {
            cursor -= 1;
            encoded[cursor] = DIGITS[(value % 36) as usize];
            value /= 36;
            if value == 0 {
                break;
            }
        }
        String::from_utf8(encoded[cursor..].to_vec()).expect("base36 digits are ASCII")
    }
}

#[allow(unused_imports)]
pub use profile_registry_v2::*;

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

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentAuthStore {
    #[serde(default = "legacy_auth_store_version")]
    version: u32,
    #[serde(default)]
    profile_registry: AgentProfileRegistryV2,
    #[serde(default)]
    connections: HashMap<String, AgentConnectionSnapshot>,
    #[serde(default)]
    pending_logins: HashMap<String, AgentPendingLoginSnapshot>,
    #[serde(default)]
    next_login_id: u64,
    #[serde(default)]
    last_synced_at: u64,
}

impl Default for AgentAuthStore {
    fn default() -> Self {
        Self {
            version: AGENT_PROFILE_REGISTRY_VERSION,
            profile_registry: AgentProfileRegistryV2::new(),
            connections: HashMap::new(),
            pending_logins: HashMap::new(),
            next_login_id: 0,
            last_synced_at: 0,
        }
    }
}

impl AgentAuthStore {
    fn sync_reserved_profiles_from_connections(
        &mut self,
        advance_credential_revision: bool,
    ) -> Result<(), String> {
        for provider in [AgentProvider::Codex, AgentProvider::Claude] {
            let snapshot = self
                .connections
                .get(provider.as_key())
                .cloned()
                .unwrap_or_else(|| AgentConnectionSnapshot::disconnected(provider));
            self.profile_registry.install_reserved_connection(
                provider,
                profile_connection_from_snapshot(&snapshot),
                advance_credential_revision,
            )?;
        }
        self.profile_registry.validate()
    }

    fn replace_connections_from_profile_registry(&mut self) -> Result<(), String> {
        self.profile_registry.validate()?;
        self.connections = [AgentProvider::Codex, AgentProvider::Claude]
            .into_iter()
            .map(|provider| {
                self.profile_registry
                    .reserved_profile(provider)
                    .map(|profile| {
                        (
                            provider.as_key().to_string(),
                            connection_snapshot_from_profile(profile),
                        )
                    })
            })
            .collect::<Result<HashMap<_, _>, _>>()?;
        Ok(())
    }
}

fn legacy_auth_store_version() -> u32 {
    1
}

fn profile_connection_from_snapshot(snapshot: &AgentConnectionSnapshot) -> AgentProfileConnection {
    let credential_source = if snapshot.provider == AgentProvider::Claude
        && snapshot.status == AgentConnectionStatus::Connected
    {
        snapshot
            .credential_source
            .as_deref()
            .and_then(ClaudeCredentialMetadata::from_persistence_label)
            .map(|source| source.persistence_label().to_string())
    } else {
        None
    };
    AgentProfileConnection {
        status: snapshot.status,
        requires_validation: snapshot.status == AgentConnectionStatus::Connected
            && !snapshot.runtime_validated,
        credential_source,
        connected_at: (snapshot.status == AgentConnectionStatus::Connected)
            .then_some(snapshot.connected_at)
            .flatten()
            .filter(|connected_at| *connected_at > 0 && *connected_at <= snapshot.updated_at),
        updated_at: snapshot.updated_at,
        last_error: (snapshot.status == AgentConnectionStatus::Error)
            .then(|| {
                Some(
                    match snapshot.provider {
                        AgentProvider::Codex => CODEX_VALIDATION_FAILURE,
                        AgentProvider::Claude => CLAUDE_VALIDATION_FAILURE,
                    }
                    .to_string(),
                )
            })
            .flatten(),
    }
}

fn connection_snapshot_from_profile(profile: &AgentProfileRecord) -> AgentConnectionSnapshot {
    let provider = profile.provider();
    let connection = profile.connection();
    let credential_source = if provider == AgentProvider::Claude
        && connection.status == AgentConnectionStatus::Connected
    {
        connection
            .credential_source
            .as_deref()
            .and_then(ClaudeCredentialMetadata::from_persistence_label)
            .map(|source| source.persistence_label().to_string())
    } else {
        None
    };
    let required_scopes = if provider == AgentProvider::Claude {
        credential_source
            .as_deref()
            .and_then(ClaudeCredentialMetadata::from_persistence_label)
            .map(ClaudeCredentialMetadata::required_scopes)
            .unwrap_or_else(|| provider.required_scopes())
    } else {
        provider.required_scopes()
    };
    AgentConnectionSnapshot {
        provider,
        display_name: provider.display_name().into(),
        availability: provider.availability(),
        status: connection.status,
        connection_kind: provider.default_connection_kind(),
        account_label: None,
        account_email: None,
        credential_source,
        required_scopes,
        expires_at: None,
        callback_url: None,
        auth_url: None,
        active_login_id: None,
        active_login_state: None,
        connected_at: connection.connected_at,
        last_login_attempt_at: None,
        updated_at: connection.updated_at,
        last_error: connection.last_error.clone(),
        runtime_revision: 0,
        runtime_validated: connection.is_authoritative_connected(),
    }
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
    use std::collections::HashSet;
    use std::path::Path;
    use std::sync::{
        atomic::{AtomicU64, Ordering},
        mpsc, Arc,
    };

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

    #[cfg(target_os = "windows")]
    fn write_windows_claude_node_shim(directory: &Path, script: &str) -> PathBuf {
        let script_path = directory
            .join("node_modules")
            .join("@anthropic-ai")
            .join("claude-code")
            .join("cli.js");
        fs::create_dir_all(script_path.parent().unwrap()).unwrap();
        fs::write(&script_path, script).unwrap();
        let command_path = directory.join("claude.cmd");
        fs::write(&command_path, "@echo off\r\nexit /b 99\r\n").unwrap();
        command_path
    }

    #[cfg(unix)]
    fn unix_process_exists(process_id: i32) -> bool {
        unsafe extern "C" {
            fn kill(process_id: i32, signal: i32) -> i32;
        }

        unsafe { kill(process_id, 0) == 0 }
    }

    #[cfg(unix)]
    fn kill_unix_process(process_id: i32) {
        unsafe extern "C" {
            fn kill(process_id: i32, signal: i32) -> i32;
        }

        unsafe {
            kill(process_id, 9);
        }
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

    fn legacy_connection_value(
        provider: AgentProvider,
        status: AgentConnectionStatus,
    ) -> serde_json::Value {
        let mut value =
            serde_json::to_value(AgentConnectionSnapshot::disconnected(provider)).unwrap();
        value["status"] = serde_json::to_value(status).unwrap();
        value["connectionKind"] = serde_json::json!("real");
        value
    }

    fn write_legacy_auth_store(
        storage_path: &Path,
        connections: serde_json::Value,
        pending_logins: serde_json::Value,
    ) -> String {
        let legacy = serde_json::json!({
            "connections": connections,
            "pendingLogins": pending_logins,
            "nextLoginId": 41,
            "lastSyncedAt": 1_234
        });
        let serialized = serde_json::to_string_pretty(&legacy).unwrap();
        fs::write(storage_path, &serialized).unwrap();
        serialized
    }

    fn persisted_default_profile<'a>(
        persisted: &'a serde_json::Value,
        account_id: &str,
    ) -> &'a serde_json::Value {
        persisted["profileRegistry"]["profiles"]
            .as_array()
            .expect("v2 profiles should be an array")
            .iter()
            .find(|profile| profile["accountId"] == account_id)
            .expect("reserved default profile should be persisted")
    }

    fn set_persisted_reserved_credential_revision(
        manager: &AgentAuthManager,
        provider: AgentProvider,
        revision: u64,
    ) {
        let account_id = match provider {
            AgentProvider::Codex => CODEX_DEFAULT_ACCOUNT_ID,
            AgentProvider::Claude => CLAUDE_DEFAULT_ACCOUNT_ID,
        };
        let mut store = manager.store.lock().unwrap();
        let mut registry = serde_json::to_value(&store.profile_registry).unwrap();
        let profile = registry["profiles"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|profile| profile["accountId"] == account_id)
            .unwrap();
        profile["credentialRevision"] = serde_json::json!(revision);
        store.profile_registry = serde_json::from_value(registry).unwrap();
        store.profile_registry.validate().unwrap();
        let storage_path = manager.storage_path.lock().unwrap().clone().unwrap();
        persist_auth_store_to_path_with_parent_sync(&store, &storage_path, sync_auth_store_parent)
            .unwrap();
    }

    #[test]
    fn multi_account_migration_converts_canonical_v1_records_and_preserves_revalidation_eligibility(
    ) {
        let dir = unique_temp_dir("multi-account-migration-canonical-v1");
        let storage_path = dir.join("agent-auth.json");
        let mut codex =
            legacy_connection_value(AgentProvider::Codex, AgentConnectionStatus::Connected);
        codex["accountLabel"] = serde_json::json!("provider-derived-codex-identity");
        codex["accountEmail"] = serde_json::json!("codex-private@example.com");
        codex["callbackUrl"] = serde_json::json!("gtum://codex/callback?secret=callback-secret");
        codex["authUrl"] = serde_json::json!("https://auth.invalid/codex-secret");
        codex["activeLoginId"] = serde_json::json!("codex-login-secret");
        codex["activeLoginState"] = serde_json::json!("codex-state-secret");
        codex["credentialSource"] = serde_json::json!("codex-known-field-secret");
        codex["accessToken"] = serde_json::json!("codex-access-token-secret");
        codex["connectedAt"] = serde_json::json!(1_100);
        codex["updatedAt"] = serde_json::json!(1_200);

        let mut claude =
            legacy_connection_value(AgentProvider::Claude, AgentConnectionStatus::Error);
        claude["accountLabel"] = serde_json::json!("provider-derived-claude-identity");
        claude["accountEmail"] = serde_json::json!("claude-private@example.com");
        claude["credentialSource"] = serde_json::json!("claude_cli_session");
        claude["callbackUrl"] = serde_json::json!("gtum://claude/callback?secret=callback-secret");
        claude["activeLoginState"] = serde_json::json!("claude-state-secret");
        claude["apiKey"] = serde_json::json!("claude-api-key-secret");
        claude["updatedAt"] = serde_json::json!(1_210);
        claude["lastError"] = serde_json::json!("raw claude validation secret");

        write_legacy_auth_store(
            &storage_path,
            serde_json::json!({ "codex": codex, "claude": claude }),
            serde_json::json!({}),
        );

        let manager = AgentAuthManager::new();
        manager.initialize_storage(storage_path.clone()).unwrap();

        let persisted_text = fs::read_to_string(&storage_path).unwrap();
        let persisted: serde_json::Value = serde_json::from_str(&persisted_text).unwrap();
        assert_eq!(persisted["version"], AGENT_PROFILE_REGISTRY_VERSION);
        assert_eq!(
            persisted["profileRegistry"]["version"],
            AGENT_PROFILE_REGISTRY_VERSION
        );
        assert_eq!(
            persisted_default_profile(&persisted, CODEX_DEFAULT_ACCOUNT_ID)["connection"]["status"],
            "connected"
        );
        assert_eq!(
            persisted_default_profile(&persisted, CODEX_DEFAULT_ACCOUNT_ID)["connection"]
                ["requiresValidation"],
            true
        );
        assert!(persisted["connections"]["codex"]["credentialSource"].is_null());
        assert_eq!(
            persisted_default_profile(&persisted, CLAUDE_DEFAULT_ACCOUNT_ID)["connection"]
                ["status"],
            "error"
        );
        assert!(manager
            .provider_refresh_lease(AgentProvider::Codex)
            .is_some());
        assert!(manager
            .provider_refresh_lease(AgentProvider::Claude)
            .is_some());
        assert!(manager
            .require_stored_connected_provider(AgentProvider::Codex)
            .unwrap_err()
            .contains("revalidated"));

        let runtime = manager.runtime_snapshot();
        for connection in runtime.connections {
            assert_eq!(connection.account_label, None);
            assert_eq!(connection.account_email, None);
            assert_eq!(connection.callback_url, None);
            assert_eq!(connection.auth_url, None);
            assert_eq!(connection.active_login_id, None);
            assert_eq!(connection.active_login_state, None);
            assert!(!connection.runtime_validated);
        }
        for forbidden in [
            "provider-derived-codex-identity",
            "codex-private@example.com",
            "codex-known-field-secret",
            "codex-access-token-secret",
            "codex-state-secret",
            "provider-derived-claude-identity",
            "claude-private@example.com",
            "claude-api-key-secret",
            "claude-state-secret",
            "raw claude validation secret",
        ] {
            assert!(
                !persisted_text.contains(forbidden),
                "migration retained forbidden legacy data: {forbidden}"
            );
        }

        remove_dir(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn multi_account_auth_store_hardens_existing_file_to_owner_only_mode() {
        use std::os::unix::fs::PermissionsExt;

        let dir = unique_temp_dir("multi-account-auth-store-mode");
        let storage_path = dir.join("agent-auth.json");
        let bootstrap = AgentAuthManager::new();
        bootstrap.initialize_storage(storage_path.clone()).unwrap();
        fs::set_permissions(&storage_path, fs::Permissions::from_mode(0o644)).unwrap();

        let restored = AgentAuthManager::new();
        restored.initialize_storage(storage_path.clone()).unwrap();

        assert_eq!(
            fs::metadata(&storage_path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        remove_dir(&dir);
    }

    #[test]
    fn multi_account_migration_preserves_explicit_disconnect_without_revalidation() {
        let dir = unique_temp_dir("multi-account-migration-disconnected");
        let storage_path = dir.join("agent-auth.json");
        let mut codex =
            legacy_connection_value(AgentProvider::Codex, AgentConnectionStatus::Disconnected);
        codex["accountLabel"] = serde_json::json!("stale-codex-identity");
        let mut claude =
            legacy_connection_value(AgentProvider::Claude, AgentConnectionStatus::Disconnected);
        claude["lastError"] = serde_json::json!("stale claude disconnect error");
        write_legacy_auth_store(
            &storage_path,
            serde_json::json!({ "codex": codex, "claude": claude }),
            serde_json::json!({}),
        );

        let manager = AgentAuthManager::new();
        manager.initialize_storage(storage_path.clone()).unwrap();
        let persisted: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&storage_path).unwrap()).unwrap();

        for (provider, account_id) in [
            (AgentProvider::Codex, CODEX_DEFAULT_ACCOUNT_ID),
            (AgentProvider::Claude, CLAUDE_DEFAULT_ACCOUNT_ID),
        ] {
            assert!(manager.provider_refresh_lease(provider).is_none());
            assert_eq!(
                persisted_default_profile(&persisted, account_id)["connection"]["status"],
                "disconnected"
            );
        }

        remove_dir(&dir);
    }

    #[test]
    fn multi_account_migration_converts_pending_records_and_removes_pending_logins() {
        let dir = unique_temp_dir("multi-account-migration-pending");
        let storage_path = dir.join("agent-auth.json");
        let mut codex =
            legacy_connection_value(AgentProvider::Codex, AgentConnectionStatus::Pending);
        codex["activeLoginId"] = serde_json::json!("codex-login-40");
        codex["activeLoginState"] = serde_json::json!("codex-pending-state-secret");
        codex["callbackUrl"] = serde_json::json!("gtum://codex/pending");
        let claude =
            legacy_connection_value(AgentProvider::Claude, AgentConnectionStatus::Disconnected);
        let pending = serde_json::json!({
            "codex-pending-state-secret": {
                "loginId": "codex-login-40",
                "provider": "codex",
                "state": "codex-pending-state-secret",
                "callbackUrl": "gtum://codex/pending",
                "authUrl": "https://auth.invalid/pending-secret",
                "scopes": ["project:read"],
                "createdAt": 1_000,
                "expiresAt": 2_000,
                "consumedAt": null,
                "lastError": null
            }
        });
        write_legacy_auth_store(
            &storage_path,
            serde_json::json!({ "codex": codex, "claude": claude }),
            pending,
        );

        let manager = AgentAuthManager::new();
        manager.initialize_storage(storage_path.clone()).unwrap();
        let persisted_text = fs::read_to_string(&storage_path).unwrap();
        let persisted: serde_json::Value = serde_json::from_str(&persisted_text).unwrap();
        let runtime = manager.runtime_snapshot();
        let codex = runtime
            .connections
            .iter()
            .find(|connection| connection.provider == AgentProvider::Codex)
            .unwrap();

        assert_eq!(codex.status, AgentConnectionStatus::Disconnected);
        assert!(runtime.pending_logins.is_empty());
        assert!(persisted["pendingLogins"].as_object().unwrap().is_empty());
        assert_eq!(
            persisted_default_profile(&persisted, CODEX_DEFAULT_ACCOUNT_ID)["connection"]["status"],
            "disconnected"
        );
        assert!(!persisted_text.contains("codex-pending-state-secret"));
        assert!(!persisted_text.contains("pending-secret"));

        remove_dir(&dir);
    }

    #[test]
    fn multi_account_migration_drops_malformed_extras_without_copying_credentials() {
        let dir = unique_temp_dir("multi-account-migration-malformed-extras");
        let storage_path = dir.join("agent-auth.json");
        let codex =
            legacy_connection_value(AgentProvider::Codex, AgentConnectionStatus::Disconnected);
        write_legacy_auth_store(
            &storage_path,
            serde_json::json!({
                "codex": codex,
                "claude": "malformed-canonical-secret",
                "codex-copy": {
                    "provider": "codex",
                    "accessToken": "duplicate-token-secret"
                },
                "claude-copy": ["duplicate-claude-secret"]
            }),
            serde_json::json!({}),
        );

        let manager = AgentAuthManager::new();
        manager.initialize_storage(storage_path.clone()).unwrap();
        let persisted_text = fs::read_to_string(&storage_path).unwrap();
        let persisted: serde_json::Value = serde_json::from_str(&persisted_text).unwrap();
        let keys = persisted["connections"]
            .as_object()
            .unwrap()
            .keys()
            .cloned()
            .collect::<HashSet<_>>();

        assert_eq!(
            keys,
            HashSet::from(["codex".to_string(), "claude".to_string()])
        );
        assert_eq!(
            persisted["profileRegistry"]["profiles"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        for forbidden in [
            "malformed-canonical-secret",
            "duplicate-token-secret",
            "duplicate-claude-secret",
        ] {
            assert!(!persisted_text.contains(forbidden));
        }

        remove_dir(&dir);
    }

    #[test]
    fn multi_account_migration_sanitizes_every_hostile_v2_profile_connection() {
        fn connection_mut<'a>(
            account_id: &str,
            profiles: &'a mut [serde_json::Value],
        ) -> &'a mut serde_json::Map<String, serde_json::Value> {
            profiles
                .iter_mut()
                .find(|profile| profile["accountId"] == account_id)
                .unwrap()["connection"]
                .as_object_mut()
                .unwrap()
        }

        let dir = unique_temp_dir("multi-account-migration-hostile-v2-profiles");
        let storage_path = dir.join("agent-auth.json");
        let mut registry = AgentProfileRegistryV2::new();
        let codex_generated = registry
            .add_profile(
                AgentProvider::Codex,
                "Codex isolated",
                AgentProfileKind::CodexHome,
            )
            .unwrap()
            .account_id()
            .to_string();
        let claude_generated = registry
            .add_profile(
                AgentProvider::Claude,
                "Claude isolated",
                AgentProfileKind::ClaudeConfigDir,
            )
            .unwrap()
            .account_id()
            .to_string();
        let mut profile_registry = serde_json::to_value(registry).unwrap();
        let profiles = profile_registry["profiles"].as_array_mut().unwrap();

        let codex_default = connection_mut(CODEX_DEFAULT_ACCOUNT_ID, profiles);
        codex_default.insert("status".into(), serde_json::json!("connected"));
        codex_default.insert(
            "credentialSource".into(),
            serde_json::json!("hostile-codex-source-secret"),
        );
        codex_default.insert("connectedAt".into(), serde_json::json!(900));
        codex_default.insert("updatedAt".into(), serde_json::json!(100));
        codex_default.insert(
            "lastError".into(),
            serde_json::json!("hostile-codex-connected-error-secret"),
        );

        let claude_default = connection_mut(CLAUDE_DEFAULT_ACCOUNT_ID, profiles);
        claude_default.insert("status".into(), serde_json::json!("connected"));
        claude_default.insert(
            "credentialSource".into(),
            serde_json::json!("api_key_helper"),
        );
        claude_default.insert("connectedAt".into(), serde_json::json!(90));
        claude_default.insert("updatedAt".into(), serde_json::json!(100));
        claude_default.insert(
            "lastError".into(),
            serde_json::json!("hostile-claude-connected-error-secret"),
        );

        let codex_isolated = connection_mut(&codex_generated, profiles);
        codex_isolated.insert("status".into(), serde_json::json!("error"));
        codex_isolated.insert(
            "credentialSource".into(),
            serde_json::json!("hostile-generated-codex-source-secret"),
        );
        codex_isolated.insert("connectedAt".into(), serde_json::json!(80));
        codex_isolated.insert("updatedAt".into(), serde_json::json!(100));
        codex_isolated.insert(
            "lastError".into(),
            serde_json::json!("hostile-generated-codex-error-secret"),
        );

        let claude_isolated = connection_mut(&claude_generated, profiles);
        claude_isolated.insert("status".into(), serde_json::json!("pending"));
        claude_isolated.insert(
            "credentialSource".into(),
            serde_json::json!("hostile-generated-claude-source-secret"),
        );
        claude_isolated.insert("connectedAt".into(), serde_json::json!(800));
        claude_isolated.insert("updatedAt".into(), serde_json::json!(100));
        claude_isolated.insert(
            "lastError".into(),
            serde_json::json!("hostile-generated-claude-error-secret"),
        );

        let hostile_store = serde_json::json!({
            "version": AGENT_PROFILE_REGISTRY_VERSION,
            "profileRegistry": profile_registry,
            "connections": {},
            "pendingLogins": {},
            "nextLoginId": 0,
            "lastSyncedAt": 100
        });
        fs::write(
            &storage_path,
            serde_json::to_string_pretty(&hostile_store).unwrap(),
        )
        .unwrap();

        let manager = AgentAuthManager::new();
        manager.initialize_storage(storage_path.clone()).unwrap();
        let persisted_text = fs::read_to_string(&storage_path).unwrap();
        let persisted: serde_json::Value = serde_json::from_str(&persisted_text).unwrap();
        let profile = |account_id: &str| {
            persisted["profileRegistry"]["profiles"]
                .as_array()
                .unwrap()
                .iter()
                .find(|profile| profile["accountId"] == account_id)
                .unwrap()
        };

        let codex_default = &profile(CODEX_DEFAULT_ACCOUNT_ID)["connection"];
        assert_eq!(codex_default["status"], "connected");
        assert!(codex_default["credentialSource"].is_null());
        assert!(codex_default["connectedAt"].is_null());
        assert!(codex_default["lastError"].is_null());

        let claude_default = &profile(CLAUDE_DEFAULT_ACCOUNT_ID)["connection"];
        assert_eq!(claude_default["status"], "connected");
        assert_eq!(claude_default["credentialSource"], "api_key_helper");
        assert_eq!(claude_default["connectedAt"], 90);
        assert!(claude_default["lastError"].is_null());

        let codex_isolated = &profile(&codex_generated)["connection"];
        assert_eq!(codex_isolated["status"], "error");
        assert!(codex_isolated["credentialSource"].is_null());
        assert!(codex_isolated["connectedAt"].is_null());
        assert_eq!(
            codex_isolated["lastError"],
            "Codex authentication could not be validated. Reconnect Codex."
        );

        let claude_isolated = &profile(&claude_generated)["connection"];
        assert_eq!(claude_isolated["status"], "disconnected");
        assert!(claude_isolated["credentialSource"].is_null());
        assert!(claude_isolated["connectedAt"].is_null());
        assert!(claude_isolated["lastError"].is_null());

        for forbidden in [
            "hostile-codex-source-secret",
            "hostile-codex-connected-error-secret",
            "hostile-claude-connected-error-secret",
            "hostile-generated-codex-source-secret",
            "hostile-generated-codex-error-secret",
            "hostile-generated-claude-source-secret",
            "hostile-generated-claude-error-secret",
        ] {
            assert!(!persisted_text.contains(forbidden));
        }

        remove_dir(&dir);
    }

    #[test]
    fn multi_account_migration_rejects_future_store_without_changing_memory_or_disk() {
        let dir = unique_temp_dir("multi-account-migration-future-version");
        let storage_path = dir.join("agent-auth.json");
        let future_store = serde_json::json!({
            "version": AGENT_PROFILE_REGISTRY_VERSION + 1,
            "profileRegistry": AgentProfileRegistryV2::new(),
            "connections": {},
            "pendingLogins": {},
            "nextLoginId": 0,
            "lastSyncedAt": 100
        });
        let original_disk = serde_json::to_string_pretty(&future_store).unwrap();
        fs::write(&storage_path, &original_disk).unwrap();
        let manager = AgentAuthManager::new();
        let before = serde_json::to_value(manager.runtime_snapshot()).unwrap();

        let error = manager
            .initialize_storage(storage_path.clone())
            .expect_err("a future auth-store version must fail closed");

        assert!(error.contains("unsupported auth store version"));
        assert_eq!(
            serde_json::to_value(manager.runtime_snapshot()).unwrap(),
            before
        );
        assert_eq!(fs::read_to_string(&storage_path).unwrap(), original_disk);
        remove_dir(&dir);
    }

    #[test]
    fn multi_account_migration_rejects_damaged_v2_without_changing_memory_or_disk() {
        let dir = unique_temp_dir("multi-account-migration-damaged-v2");
        let storage_path = dir.join("agent-auth.json");
        let mut registry = serde_json::to_value(AgentProfileRegistryV2::new()).unwrap();
        registry["profiles"]
            .as_array_mut()
            .unwrap()
            .retain(|profile| profile["accountId"] != CLAUDE_DEFAULT_ACCOUNT_ID);
        let damaged_store = serde_json::json!({
            "version": AGENT_PROFILE_REGISTRY_VERSION,
            "profileRegistry": registry,
            "connections": {},
            "pendingLogins": {},
            "nextLoginId": 0,
            "lastSyncedAt": 100
        });
        let original_disk = serde_json::to_string_pretty(&damaged_store).unwrap();
        fs::write(&storage_path, &original_disk).unwrap();
        let manager = AgentAuthManager::new();
        let before = serde_json::to_value(manager.runtime_snapshot()).unwrap();

        let error = manager
            .initialize_storage(storage_path.clone())
            .expect_err("a structurally damaged v2 registry must fail closed");

        assert!(error.contains("Claude"));
        assert!(error.contains("default profile"));
        assert_eq!(
            serde_json::to_value(manager.runtime_snapshot()).unwrap(),
            before
        );
        assert_eq!(fs::read_to_string(&storage_path).unwrap(), original_disk);
        remove_dir(&dir);
    }

    #[test]
    fn multi_account_migration_is_idempotent_on_v2_reload() {
        let dir = unique_temp_dir("multi-account-migration-idempotent");
        let storage_path = dir.join("agent-auth.json");
        let codex = legacy_connection_value(AgentProvider::Codex, AgentConnectionStatus::Connected);
        let claude =
            legacy_connection_value(AgentProvider::Claude, AgentConnectionStatus::Disconnected);
        write_legacy_auth_store(
            &storage_path,
            serde_json::json!({ "codex": codex, "claude": claude }),
            serde_json::json!({}),
        );

        let first = AgentAuthManager::new();
        first.initialize_storage(storage_path.clone()).unwrap();
        let first_persisted: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&storage_path).unwrap()).unwrap();
        let first_registry = first_persisted["profileRegistry"].clone();
        drop(first);

        let second = AgentAuthManager::new();
        second.initialize_storage(storage_path.clone()).unwrap();
        let second_persisted: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&storage_path).unwrap()).unwrap();

        assert_eq!(second_persisted["version"], AGENT_PROFILE_REGISTRY_VERSION);
        assert_eq!(second_persisted["profileRegistry"], first_registry);
        assert_eq!(
            second_persisted["profileRegistry"]["profiles"]
                .as_array()
                .unwrap()
                .len(),
            2
        );

        remove_dir(&dir);
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    #[test]
    fn multi_account_migration_atomic_persistence_failure_rolls_back_memory_and_disk() {
        use std::os::unix::fs::PermissionsExt;

        let dir = unique_temp_dir("multi-account-migration-atomic-rollback");
        let storage_dir = dir.join("state");
        fs::create_dir_all(&storage_dir).unwrap();
        let storage_path = storage_dir.join("agent-auth.json");
        let codex = legacy_connection_value(AgentProvider::Codex, AgentConnectionStatus::Connected);
        let claude =
            legacy_connection_value(AgentProvider::Claude, AgentConnectionStatus::Disconnected);
        let legacy_disk = write_legacy_auth_store(
            &storage_path,
            serde_json::json!({ "codex": codex, "claude": claude }),
            serde_json::json!({}),
        );
        fs::set_permissions(&storage_dir, fs::Permissions::from_mode(0o500)).unwrap();

        let manager = AgentAuthManager::new();
        let error = manager
            .initialize_storage(storage_path.clone())
            .expect_err("migration must report a pre-commit persistence failure");
        let runtime = manager.runtime_snapshot();
        let codex = runtime
            .connections
            .iter()
            .find(|connection| connection.provider == AgentProvider::Codex)
            .unwrap();

        assert!(error.contains("auth state temp file"));
        assert_eq!(codex.status, AgentConnectionStatus::Disconnected);
        assert_eq!(fs::read_to_string(&storage_path).unwrap(), legacy_disk);

        fs::set_permissions(&storage_dir, fs::Permissions::from_mode(0o700)).unwrap();
        remove_dir(&dir);
    }

    #[test]
    fn multi_account_migration_begin_sync_overflow_preserves_memory_disk_and_validation() {
        let dir = unique_temp_dir("multi-account-migration-begin-overflow");
        let storage_path = dir.join("agent-auth.json");
        let manager = AgentAuthManager::new();
        manager.initialize_storage(storage_path.clone()).unwrap();
        set_persisted_reserved_credential_revision(&manager, AgentProvider::Codex, u64::MAX);
        let before_memory = serde_json::to_value(manager.runtime_snapshot()).unwrap();
        let before_disk = fs::read_to_string(&storage_path).unwrap();
        let validation_called = std::cell::Cell::new(false);

        let result = manager.begin_login_with_validation(AgentProvider::Codex, None, || {
            validation_called.set(true);
            Ok(AgentProviderValidation::codex("Codex account".into()))
        });
        let error = match result {
            Ok(_) => panic!("profile-revision exhaustion must reject the pending transition"),
            Err(error) => error,
        };

        assert!(error.contains("credential revision is exhausted"));
        assert!(!validation_called.get());
        assert_eq!(
            serde_json::to_value(manager.runtime_snapshot()).unwrap(),
            before_memory
        );
        assert_eq!(fs::read_to_string(&storage_path).unwrap(), before_disk);
        remove_dir(&dir);
    }

    #[test]
    fn multi_account_migration_begin_persistence_failure_preserves_memory_and_skips_validation() {
        let dir = unique_temp_dir("multi-account-migration-begin-persist-failure");
        let storage_dir = dir.join("state");
        let retained_storage_dir = dir.join("retained-state");
        let storage_path = storage_dir.join("agent-auth.json");
        let manager = AgentAuthManager::new();
        manager.initialize_storage(storage_path.clone()).unwrap();
        let before_memory = serde_json::to_value(manager.runtime_snapshot()).unwrap();
        let before_disk = fs::read_to_string(&storage_path).unwrap();
        fs::rename(&storage_dir, &retained_storage_dir).unwrap();
        fs::write(&storage_dir, "block auth-state persistence").unwrap();
        let validation_called = std::cell::Cell::new(false);

        let result = manager.begin_login_with_validation(AgentProvider::Codex, None, || {
            validation_called.set(true);
            Ok(AgentProviderValidation::codex("Codex account".into()))
        });

        fs::remove_file(&storage_dir).unwrap();
        fs::rename(&retained_storage_dir, &storage_dir).unwrap();
        let error = match result {
            Ok(_) => panic!("pending persistence failure must reject begin login"),
            Err(error) => error,
        };
        assert!(error.contains("persist"));
        assert!(!validation_called.get());
        assert_eq!(
            serde_json::to_value(manager.runtime_snapshot()).unwrap(),
            before_memory
        );
        assert_eq!(fs::read_to_string(&storage_path).unwrap(), before_disk);
        remove_dir(&dir);
    }

    #[test]
    fn multi_account_migration_finish_persistence_failure_keeps_committed_pending_candidate() {
        let dir = unique_temp_dir("multi-account-migration-finish-persist-failure");
        let storage_dir = dir.join("state");
        let retained_storage_dir = dir.join("retained-state");
        let storage_path = storage_dir.join("agent-auth.json");
        let manager = AgentAuthManager::new();
        manager.initialize_storage(storage_path.clone()).unwrap();

        let result = manager.begin_login_with_validation(AgentProvider::Codex, None, || {
            fs::rename(&storage_dir, &retained_storage_dir).unwrap();
            fs::write(&storage_dir, "block auth-state persistence").unwrap();
            Ok(AgentProviderValidation::codex("Codex account".into()))
        });
        let pending_memory = manager
            .runtime_snapshot()
            .connections
            .into_iter()
            .find(|connection| connection.provider == AgentProvider::Codex)
            .unwrap();

        fs::remove_file(&storage_dir).unwrap();
        fs::rename(&retained_storage_dir, &storage_dir).unwrap();
        let error = match result {
            Ok(_) => panic!("connected persistence failure must reject finish login"),
            Err(error) => error,
        };
        let pending_disk: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&storage_path).unwrap()).unwrap();
        assert!(error.contains("persist"));
        assert_eq!(pending_memory.status, AgentConnectionStatus::Pending);
        assert_eq!(pending_disk["connections"]["codex"]["status"], "pending");
        assert_eq!(
            persisted_default_profile(&pending_disk, CODEX_DEFAULT_ACCOUNT_ID)["connection"]
                ["status"],
            "pending"
        );
        remove_dir(&dir);
    }

    #[test]
    fn multi_account_migration_revalidation_persistence_failure_preserves_current_candidate() {
        let dir = unique_temp_dir("multi-account-migration-revalidation-persist-failure");
        let storage_dir = dir.join("state");
        let retained_storage_dir = dir.join("retained-state");
        let storage_path = storage_dir.join("agent-auth.json");
        let manager = AgentAuthManager::new();
        manager.initialize_storage(storage_path.clone()).unwrap();
        manager
            .begin_login_with_validation(AgentProvider::Codex, None, || {
                Ok(AgentProviderValidation::codex("Codex account".into()))
            })
            .unwrap();
        let lease = manager
            .require_stored_connected_provider(AgentProvider::Codex)
            .unwrap();
        let before_memory = serde_json::to_value(manager.runtime_snapshot()).unwrap();
        let before_disk = fs::read_to_string(&storage_path).unwrap();
        fs::rename(&storage_dir, &retained_storage_dir).unwrap();
        fs::write(&storage_dir, "block auth-state persistence").unwrap();

        let applied = manager
            .apply_validation_if_current(&lease, &Err("raw revalidation failure secret".into()));

        fs::remove_file(&storage_dir).unwrap();
        fs::rename(&retained_storage_dir, &storage_dir).unwrap();
        assert!(!applied);
        assert_eq!(
            serde_json::to_value(manager.runtime_snapshot()).unwrap(),
            before_memory
        );
        assert_eq!(fs::read_to_string(&storage_path).unwrap(), before_disk);
        remove_dir(&dir);
    }

    #[test]
    fn multi_account_registry_initializes_reserved_defaults_and_allocates_same_provider_profiles() {
        let mut registry = AgentProfileRegistryV2::new();

        registry.validate().unwrap();
        assert_eq!(registry.version(), 2);
        for (provider, reserved_id) in [
            (AgentProvider::Codex, "codex-default"),
            (AgentProvider::Claude, "claude-default"),
        ] {
            let profiles = registry.visible_profiles(provider);
            assert_eq!(profiles.len(), 1);
            assert_eq!(profiles[0].account_id(), reserved_id);
            assert_eq!(profiles[0].provider(), provider);
            assert!(profiles[0].is_default());
            assert_eq!(profiles[0].profile_kind(), AgentProfileKind::Ambient);
            assert_eq!(
                profiles[0].connection().status,
                AgentConnectionStatus::Disconnected
            );
        }

        let first = registry
            .add_profile(
                AgentProvider::Codex,
                "  Work  ",
                AgentProfileKind::CodexHome,
            )
            .unwrap();
        let second = registry
            .add_profile(
                AgentProvider::Codex,
                "Personal",
                AgentProfileKind::CodexHome,
            )
            .unwrap();

        assert_eq!(first.alias(), "Work");
        assert!(first.account_id().starts_with("codex-profile-"));
        assert!(second.account_id().starts_with("codex-profile-"));
        assert_ne!(first.account_id(), second.account_id());
        assert!(first.account_id().is_ascii());
        assert!(first.account_id().len() <= 64);
        assert!(first.incarnation() < second.incarnation());
        assert_eq!(registry.visible_profiles(AgentProvider::Codex).len(), 3);
        assert!(registry
            .add_profile(
                AgentProvider::Claude,
                "Wrong kind",
                AgentProfileKind::CodexHome,
            )
            .unwrap_err()
            .contains("provider"));

        let serialized = serde_json::to_value(&registry).unwrap();
        assert_eq!(serialized["version"], 2);
        let first_json = serialized["profiles"]
            .as_array()
            .unwrap()
            .iter()
            .find(|profile| profile["accountId"] == first.account_id())
            .unwrap();
        assert_eq!(first_json["profileKind"]["kind"], "codex_home");
        assert_eq!(first_json["connection"]["status"], "disconnected");
        assert!(serialized["tombstones"].as_array().unwrap().is_empty());
    }

    #[test]
    fn multi_account_registry_validates_aliases_defaults_and_bounded_tombstones() {
        let mut registry = AgentProfileRegistryV2::new();

        for invalid_alias in ["", "   ", "line\nbreak", "\u{0000}", &"a".repeat(65)] {
            assert!(registry
                .add_profile(
                    AgentProvider::Codex,
                    invalid_alias,
                    AgentProfileKind::CodexHome,
                )
                .is_err());
        }
        let multibyte_too_long = "계".repeat(22);
        assert!(multibyte_too_long.len() > 64);
        assert!(registry
            .add_profile(
                AgentProvider::Codex,
                &multibyte_too_long,
                AgentProfileKind::CodexHome,
            )
            .is_err());

        let mut generated_ids = Vec::new();
        for index in 0..15 {
            generated_ids.push(
                registry
                    .add_profile(
                        AgentProvider::Codex,
                        &format!("Profile {index}"),
                        AgentProfileKind::CodexHome,
                    )
                    .unwrap()
                    .account_id()
                    .to_string(),
            );
        }
        assert_eq!(registry.visible_profiles(AgentProvider::Codex).len(), 16);
        assert!(registry
            .add_profile(
                AgentProvider::Codex,
                "Over capacity",
                AgentProfileKind::CodexHome,
            )
            .unwrap_err()
            .contains("16"));
        assert!(registry
            .tombstone_profile(AgentProvider::Codex, "codex-default")
            .unwrap_err()
            .contains("default"));

        registry
            .tombstone_profile(AgentProvider::Codex, &generated_ids[0])
            .unwrap();
        assert_eq!(registry.visible_profiles(AgentProvider::Codex).len(), 15);
        assert_eq!(registry.tombstones(AgentProvider::Codex).len(), 1);
        assert!(registry
            .add_profile(
                AgentProvider::Codex,
                "Still over capacity",
                AgentProfileKind::CodexHome,
            )
            .unwrap_err()
            .contains("16"));
        registry.validate().unwrap();
    }

    #[test]
    fn multi_account_registry_separates_revisions_and_prevents_aba_across_restart() {
        let mut registry = AgentProfileRegistryV2::new();
        let original = registry
            .add_profile(
                AgentProvider::Codex,
                "Original",
                AgentProfileKind::CodexHome,
            )
            .unwrap();
        let original_id = original.account_id().to_string();
        let original_incarnation = original.incarnation();
        let original_metadata_revision = original.metadata_revision();
        let original_credential_revision = original.credential_revision();
        let lease = registry
            .account_lease(AgentProvider::Codex, &original_id)
            .unwrap();

        let renamed = registry
            .rename_profile(AgentProvider::Codex, &original_id, "Renamed")
            .unwrap();
        assert_eq!(renamed.account_id(), original_id);
        assert_eq!(renamed.incarnation(), original_incarnation);
        assert!(renamed.metadata_revision() > original_metadata_revision);
        assert_eq!(renamed.credential_revision(), original_credential_revision);
        assert!(registry.is_lease_current(&lease));

        let credential_changed = registry
            .advance_credential_revision(AgentProvider::Codex, &original_id)
            .unwrap();
        assert_eq!(
            credential_changed.metadata_revision(),
            renamed.metadata_revision()
        );
        assert!(credential_changed.credential_revision() > original_credential_revision);
        assert!(!registry.is_lease_current(&lease));
        assert!(registry
            .account_lease(AgentProvider::Claude, &original_id)
            .unwrap_err()
            .contains("provider"));

        let current_lease = registry
            .account_lease(AgentProvider::Codex, &original_id)
            .unwrap();
        let persisted = serde_json::to_string(&registry).unwrap();
        let restarted: AgentProfileRegistryV2 = serde_json::from_str(&persisted).unwrap();
        restarted.validate().unwrap();
        assert!(restarted.is_lease_current(&current_lease));

        registry
            .tombstone_profile(AgentProvider::Codex, &original_id)
            .unwrap();
        assert!(!registry.is_lease_current(&current_lease));
        let replacement = registry
            .add_profile(
                AgentProvider::Codex,
                "Replacement",
                AgentProfileKind::CodexHome,
            )
            .unwrap();
        assert_ne!(replacement.account_id(), original_id);
        assert!(replacement.incarnation() > original_incarnation);
        assert_eq!(
            registry.tombstones(AgentProvider::Codex)[0].account_id(),
            original_id
        );
        assert_eq!(
            registry.tombstones(AgentProvider::Codex)[0].incarnation(),
            original_incarnation
        );
    }

    #[test]
    fn multi_account_restart_requires_fresh_validation_for_connected_generated_profiles() {
        let dir = unique_temp_dir("multi-account-restart-generated-validation");
        let storage_path = dir.join("agent-auth.json");
        let manager = AgentAuthManager::new();
        manager.initialize_storage(storage_path.clone()).unwrap();
        let codex = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "Codex generated", |_| Ok(()))
            .unwrap();
        let claude = manager
            .create_profile_with_probe(AgentProvider::Claude, "Claude generated", |_| Ok(()))
            .unwrap();

        let connected_codex = manager
            .check_profile_with_validation(AgentProvider::Codex, codex.account_id(), |_| {
                Ok(AgentProviderValidation::codex("Codex generated".into()))
            })
            .unwrap();
        let connected_claude = manager
            .check_profile_with_validation(AgentProvider::Claude, claude.account_id(), |_| {
                Ok(runtime_claude_validation(
                    crate::runtime::claude::ClaudeCredentialSource::CliSession,
                ))
            })
            .unwrap();
        assert!(!connected_codex.connection().requires_validation);
        assert!(!connected_claude.connection().requires_validation);

        let restarted = AgentAuthManager::new();
        restarted.initialize_storage(storage_path).unwrap();
        let restarted_profiles = [
            (AgentProvider::Codex, connected_codex),
            (AgentProvider::Claude, connected_claude),
        ]
        .map(|(provider, before_restart)| {
            let after_restart = restarted
                .list_profiles(provider)
                .into_iter()
                .find(|profile| profile.account_id() == before_restart.account_id())
                .unwrap();
            assert_eq!(
                after_restart.connection().status,
                AgentConnectionStatus::Connected
            );
            assert!(after_restart.connection().requires_validation);
            assert_eq!(
                after_restart.credential_revision(),
                before_restart.credential_revision() + 1
            );
            assert_eq!(
                restarted
                    .require_exact_account_profile_lease(
                        provider,
                        after_restart.account_id(),
                        before_restart.incarnation(),
                        before_restart.credential_revision(),
                        true,
                    )
                    .unwrap_err(),
                STALE_ACCOUNT_RESULT
            );
            assert_eq!(
                restarted
                    .require_exact_account_profile_lease(
                        provider,
                        after_restart.account_id(),
                        after_restart.incarnation(),
                        after_restart.credential_revision(),
                        true,
                    )
                    .unwrap_err(),
                ACCOUNT_NOT_CONNECTED
            );
            after_restart
        });

        let revalidated_codex = restarted
            .check_profile_with_validation(
                AgentProvider::Codex,
                restarted_profiles[0].account_id(),
                |_| Ok(AgentProviderValidation::codex("Codex generated".into())),
            )
            .unwrap();
        let revalidated_claude = restarted
            .check_profile_with_validation(
                AgentProvider::Claude,
                restarted_profiles[1].account_id(),
                |_| {
                    Ok(runtime_claude_validation(
                        crate::runtime::claude::ClaudeCredentialSource::CliSession,
                    ))
                },
            )
            .unwrap();

        for profile in [revalidated_codex, revalidated_claude] {
            assert!(!profile.connection().requires_validation);
            assert_eq!(
                profile.credential_revision(),
                restarted_profiles
                    .iter()
                    .find(|before_check| before_check.provider() == profile.provider())
                    .unwrap()
                    .credential_revision()
                    + 1
            );
            restarted
                .require_exact_account_profile_lease(
                    profile.provider(),
                    profile.account_id(),
                    profile.incarnation(),
                    profile.credential_revision(),
                    true,
                )
                .unwrap();
        }

        remove_dir(&dir);
    }

    fn assert_authorized_profile_operation_linearizes_mutation(
        label: &str,
        mutate: impl FnOnce(&AgentAuthManager, &str) -> Result<(), String> + Send + 'static,
    ) {
        let dir = unique_temp_dir(label);
        let manager = Arc::new(AgentAuthManager::new());
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let profile = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, label, |_| Ok(()))
            .unwrap();
        let profile = manager
            .check_profile_with_validation(AgentProvider::Codex, profile.account_id(), |_| {
                Ok(AgentProviderValidation::codex(label.to_string()))
            })
            .unwrap();
        let request = AuthorizeAgentProfileLeaseRequest {
            provider: profile.provider(),
            account_id: profile.account_id().to_string(),
            incarnation: profile.incarnation().into(),
            credential_revision: profile.credential_revision().into(),
        };
        let account_id = profile.account_id().to_string();
        let operation_calls = Arc::new(AtomicU64::new(0));
        let (operation_started_tx, operation_started_rx) = mpsc::sync_channel(0);
        let (release_operation_tx, release_operation_rx) = mpsc::sync_channel(0);

        let authorized_manager = Arc::clone(&manager);
        let authorized_calls = Arc::clone(&operation_calls);
        let authorized = std::thread::spawn(move || {
            authorized_manager.with_authorized_profile_lease(&request, |_| {
                authorized_calls.fetch_add(1, Ordering::SeqCst);
                operation_started_tx.send(()).unwrap();
                release_operation_rx.recv().unwrap();
                Ok(())
            })
        });
        operation_started_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("authorized operation must enter its critical section");

        let mutation_manager = Arc::clone(&manager);
        let (mutation_started_tx, mutation_started_rx) = mpsc::sync_channel(0);
        let (mutation_finished_tx, mutation_finished_rx) = mpsc::sync_channel(0);
        let mutation = std::thread::spawn(move || {
            mutation_started_tx.send(()).unwrap();
            let result = mutate(&mutation_manager, &account_id);
            mutation_finished_tx.send(result).unwrap();
        });
        mutation_started_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("credential mutation must start before its blocking assertion");
        assert!(matches!(
            mutation_finished_rx.recv_timeout(Duration::from_millis(100)),
            Err(mpsc::RecvTimeoutError::Timeout)
        ));

        release_operation_tx.send(()).unwrap();
        authorized.join().unwrap().unwrap();
        mutation_finished_rx
            .recv_timeout(Duration::from_secs(2))
            .expect("credential mutation must finish after the authorized boundary")
            .unwrap();
        mutation.join().unwrap();
        assert_eq!(operation_calls.load(Ordering::SeqCst), 1);

        remove_dir(&dir);
    }

    #[test]
    fn authorized_profile_operation_holds_the_exact_lease_through_the_job_create_boundary() {
        assert_authorized_profile_operation_linearizes_mutation(
            "authorized-operation-disconnect",
            |manager, account_id| {
                manager
                    .disconnect_profile(AgentProvider::Codex, account_id)
                    .map(|_| ())
            },
        );
        assert_authorized_profile_operation_linearizes_mutation(
            "authorized-operation-forget",
            |manager, account_id| {
                manager
                    .forget_profile(AgentProvider::Codex, account_id)
                    .map(|_| ())
            },
        );
        assert_authorized_profile_operation_linearizes_mutation(
            "authorized-operation-credential-refresh",
            |manager, account_id| {
                manager
                    .check_profile_with_validation(AgentProvider::Codex, account_id, |_| {
                        Ok(AgentProviderValidation::codex("refreshed".to_string()))
                    })
                    .map(|_| ())
            },
        );
    }

    #[test]
    fn authorized_profile_operation_never_calls_the_job_boundary_for_stale_or_disconnected_leases()
    {
        let dir = unique_temp_dir("authorized-operation-fail-closed");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let profile = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "Authorized", |_| Ok(()))
            .unwrap();
        let connected = manager
            .check_profile_with_validation(AgentProvider::Codex, profile.account_id(), |_| {
                Ok(AgentProviderValidation::codex("Authorized".to_string()))
            })
            .unwrap();
        let stale_request = AuthorizeAgentProfileLeaseRequest {
            provider: connected.provider(),
            account_id: connected.account_id().to_string(),
            incarnation: connected.incarnation().into(),
            credential_revision: connected.credential_revision().into(),
        };
        let disconnected = manager
            .disconnect_profile(AgentProvider::Codex, connected.account_id())
            .unwrap();
        let current_disconnected_request = AuthorizeAgentProfileLeaseRequest {
            provider: disconnected.provider(),
            account_id: disconnected.account_id().to_string(),
            incarnation: disconnected.incarnation().into(),
            credential_revision: disconnected.credential_revision().into(),
        };
        let operation_calls = AtomicU64::new(0);

        let stale = manager
            .with_authorized_profile_lease(&stale_request, |_| {
                operation_calls.fetch_add(1, Ordering::SeqCst);
                Ok(())
            })
            .unwrap_err();
        assert_eq!(stale, STALE_ACCOUNT_RESULT);
        let disconnected = manager
            .with_authorized_profile_lease(&current_disconnected_request, |_| {
                operation_calls.fetch_add(1, Ordering::SeqCst);
                Ok(())
            })
            .unwrap_err();
        assert_eq!(disconnected, ACCOUNT_NOT_CONNECTED);
        assert_eq!(operation_calls.load(Ordering::SeqCst), 0);

        remove_dir(&dir);
    }

    #[test]
    fn multi_account_registry_serializes_concurrent_allocations_without_duplicate_ownership() {
        let registry = Arc::new(Mutex::new(AgentProfileRegistryV2::new()));
        let mut threads = Vec::new();

        for index in 0..8 {
            let registry = Arc::clone(&registry);
            threads.push(std::thread::spawn(move || {
                registry
                    .lock()
                    .unwrap()
                    .add_profile(
                        AgentProvider::Claude,
                        &format!("Concurrent {index}"),
                        AgentProfileKind::ClaudeConfigDir,
                    )
                    .unwrap()
            }));
        }

        let allocated = threads
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .collect::<Vec<_>>();
        let account_ids = allocated
            .iter()
            .map(|profile| profile.account_id().to_string())
            .collect::<HashSet<_>>();
        let incarnations = allocated
            .iter()
            .map(AgentProfileRecord::incarnation)
            .collect::<HashSet<_>>();

        assert_eq!(account_ids.len(), allocated.len());
        assert_eq!(incarnations.len(), allocated.len());
        let registry = registry.lock().unwrap();
        registry.validate().unwrap();
        assert_eq!(registry.visible_profiles(AgentProvider::Claude).len(), 9);
    }

    #[test]
    fn multi_account_registry_rename_revision_overflow_preserves_state() {
        let mut registry = AgentProfileRegistryV2::new();
        let profile = registry
            .add_profile(
                AgentProvider::Codex,
                "Original",
                AgentProfileKind::CodexHome,
            )
            .unwrap();
        let account_id = profile.account_id().to_string();
        let mut serialized = serde_json::to_value(&registry).unwrap();
        let stored = serialized["profiles"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|stored| stored["accountId"] == account_id)
            .unwrap();
        stored["metadataRevision"] = serde_json::json!(u64::MAX);
        let mut registry: AgentProfileRegistryV2 = serde_json::from_value(serialized).unwrap();
        registry.validate().unwrap();
        let before = serde_json::to_value(&registry).unwrap();

        assert!(registry
            .rename_profile(AgentProvider::Codex, &account_id, "Mutated")
            .unwrap_err()
            .contains("exhausted"));
        assert_eq!(serde_json::to_value(&registry).unwrap(), before);
    }

    #[test]
    fn multi_account_registry_tombstone_revision_overflow_preserves_state() {
        let mut registry = AgentProfileRegistryV2::new();
        let profile = registry
            .add_profile(
                AgentProvider::Claude,
                "Original",
                AgentProfileKind::ClaudeConfigDir,
            )
            .unwrap();
        let account_id = profile.account_id().to_string();
        let mut serialized = serde_json::to_value(&registry).unwrap();
        let stored = serialized["profiles"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|stored| stored["accountId"] == account_id)
            .unwrap();
        stored["credentialRevision"] = serde_json::json!(u64::MAX);
        let mut registry: AgentProfileRegistryV2 = serde_json::from_value(serialized).unwrap();
        registry.validate().unwrap();
        let before = serde_json::to_value(&registry).unwrap();

        assert!(registry
            .tombstone_profile(AgentProvider::Claude, &account_id)
            .unwrap_err()
            .contains("exhausted"));
        assert_eq!(serde_json::to_value(&registry).unwrap(), before);
    }

    #[test]
    fn multi_account_registry_set_default_is_metadata_only_and_protects_reserved_ambient() {
        let mut registry = AgentProfileRegistryV2::new();
        let generated = registry
            .add_profile(AgentProvider::Codex, "Work", AgentProfileKind::CodexHome)
            .unwrap();
        let generated_id = generated.account_id().to_string();
        let ambient_before = registry
            .visible_profiles(AgentProvider::Codex)
            .into_iter()
            .find(|profile| profile.account_id() == CODEX_DEFAULT_ACCOUNT_ID)
            .unwrap()
            .clone();
        let ambient_lease = registry
            .account_lease(AgentProvider::Codex, CODEX_DEFAULT_ACCOUNT_ID)
            .unwrap();
        let generated_lease = registry
            .account_lease(AgentProvider::Codex, &generated_id)
            .unwrap();

        let selected = registry
            .set_default(AgentProvider::Codex, &generated_id)
            .unwrap();
        let profiles = registry.visible_profiles(AgentProvider::Codex);
        let ambient_after = profiles
            .iter()
            .find(|profile| profile.account_id() == CODEX_DEFAULT_ACCOUNT_ID)
            .unwrap();
        assert!(selected.is_default());
        assert!(!ambient_after.is_default());
        assert_eq!(
            profiles
                .iter()
                .filter(|profile| profile.is_default())
                .count(),
            1
        );
        assert_eq!(
            profiles
                .iter()
                .find(|profile| profile.is_default())
                .unwrap()
                .account_id(),
            generated_id
        );
        assert!(selected.metadata_revision() > generated.metadata_revision());
        assert!(ambient_after.metadata_revision() > ambient_before.metadata_revision());
        assert_eq!(
            selected.credential_revision(),
            generated.credential_revision()
        );
        assert_eq!(
            ambient_after.credential_revision(),
            ambient_before.credential_revision()
        );
        assert_eq!(selected.connection(), generated.connection());
        assert_eq!(ambient_after.connection(), ambient_before.connection());
        assert!(registry.is_lease_current(&ambient_lease));
        assert!(registry.is_lease_current(&generated_lease));
        registry.validate().unwrap();

        let before_forget = serde_json::to_value(&registry).unwrap();
        assert!(registry
            .tombstone_profile(AgentProvider::Codex, CODEX_DEFAULT_ACCOUNT_ID)
            .unwrap_err()
            .contains("ambient"));
        assert_eq!(serde_json::to_value(&registry).unwrap(), before_forget);
        assert!(registry
            .tombstone_profile(AgentProvider::Codex, &generated_id)
            .unwrap_err()
            .contains("default"));
        assert_eq!(serde_json::to_value(&registry).unwrap(), before_forget);

        registry
            .set_default(AgentProvider::Codex, CODEX_DEFAULT_ACCOUNT_ID)
            .unwrap();
        let profiles = registry.visible_profiles(AgentProvider::Codex);
        assert_eq!(
            profiles
                .iter()
                .filter(|profile| profile.is_default())
                .count(),
            1
        );
        assert!(profiles
            .iter()
            .find(|profile| profile.account_id() == CODEX_DEFAULT_ACCOUNT_ID)
            .unwrap()
            .is_default());
        registry.validate().unwrap();
    }

    #[test]
    fn multi_account_registry_rejects_duplicate_persisted_incarnations_across_records() {
        let mut registry = AgentProfileRegistryV2::new();
        let visible = registry
            .add_profile(AgentProvider::Codex, "Visible", AgentProfileKind::CodexHome)
            .unwrap();
        let forgotten = registry
            .add_profile(
                AgentProvider::Claude,
                "Forgotten",
                AgentProfileKind::ClaudeConfigDir,
            )
            .unwrap();
        registry
            .tombstone_profile(AgentProvider::Claude, forgotten.account_id())
            .unwrap();

        let mut serialized = serde_json::to_value(&registry).unwrap();
        serialized["tombstones"][0]["incarnation"] = serde_json::json!(visible.incarnation());
        let malformed: AgentProfileRegistryV2 = serde_json::from_value(serialized).unwrap();

        assert!(malformed.validate().unwrap_err().contains("incarnation"));
    }

    #[cfg(unix)]
    #[test]
    fn multi_account_profile_lifecycle_provisions_and_persists_codex_metadata_atomically() {
        use std::os::unix::fs::PermissionsExt;

        let dir = unique_temp_dir("multi-account-profile-lifecycle");
        let storage_path = dir.join("app data;with $metachar").join("agent-auth.json");
        let manager = AgentAuthManager::new();
        manager.initialize_storage(storage_path.clone()).unwrap();

        let created = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "  Work $(unsafe)  ", |root| {
                assert_eq!(
                    root.file_name().and_then(|name| name.to_str()),
                    Some("codex-profile-1"),
                    "the probe must run against the exact installed account root"
                );
                let config_path = root.join("config.toml");
                assert_eq!(
                    fs::read_to_string(&config_path).unwrap(),
                    "cli_auth_credentials_store = \"file\"\n"
                );
                assert_eq!(
                    fs::metadata(root).unwrap().permissions().mode() & 0o777,
                    0o700
                );
                assert_eq!(
                    fs::metadata(config_path).unwrap().permissions().mode() & 0o777,
                    0o600
                );
                assert!(!root.join("auth.json").exists());
                fs::create_dir(root.join("probe-cache")).unwrap();
                fs::write(root.join("probe.log"), "discard me").unwrap();
                Ok(())
            })
            .unwrap();

        let account_id = created.account_id().to_string();
        let owned_root = manager
            .owned_profile_root(AgentProvider::Codex, &account_id)
            .unwrap();
        assert!(owned_root.is_dir());
        assert_eq!(created.alias(), "Work $(unsafe)");
        let installed_entries = fs::read_dir(&owned_root)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect::<Vec<_>>();
        assert_eq!(
            installed_entries,
            vec![std::ffi::OsString::from("config.toml")]
        );

        let guidance = manager
            .setup_guidance(AgentProvider::Codex, &account_id, AgentSetupShell::Bash)
            .unwrap();
        assert!(guidance.supported);
        assert_eq!(guidance.environment[0].name, "CODEX_HOME");
        assert_eq!(guidance.environment[0].value, owned_root.to_string_lossy());
        assert!(!guidance
            .rendered_command
            .as_deref()
            .unwrap()
            .contains(created.alias()));

        let renamed = manager
            .rename_profile(AgentProvider::Codex, &account_id, "Renamed")
            .unwrap();
        assert_eq!(renamed.account_id(), account_id);
        assert_eq!(renamed.alias(), "Renamed");
        let selected = manager
            .set_default_profile(AgentProvider::Codex, &account_id)
            .unwrap();
        assert!(selected.is_default());
        assert!(manager
            .forget_profile(AgentProvider::Codex, &account_id)
            .unwrap_err()
            .contains("default"));
        manager
            .set_default_profile(AgentProvider::Codex, CODEX_DEFAULT_ACCOUNT_ID)
            .unwrap();
        let tombstone = manager
            .forget_profile(AgentProvider::Codex, &account_id)
            .unwrap();
        assert_eq!(tombstone.account_id(), account_id);
        assert!(
            owned_root.is_dir(),
            "forget must retain the credential root"
        );

        let persisted = fs::read_to_string(storage_path).unwrap();
        assert!(persisted.contains(&account_id));
        assert!(!persisted.contains(owned_root.to_string_lossy().as_ref()));
        assert!(!persisted.contains("codex login"));
        assert!(!persisted.contains("Work $(unsafe)"));
        remove_dir(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn multi_account_profile_lifecycle_rejects_symlink_roots_and_probe_path_swaps() {
        use std::os::unix::fs::symlink;

        let dir = unique_temp_dir("multi-account-profile-root-rejection");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let roots = manager.ensure_profile_roots_directory().unwrap();
        let outside = dir.join("outside");
        fs::create_dir(&outside).unwrap();
        symlink(&outside, roots.join("codex-profile-1")).unwrap();

        let duplicate_error = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "Duplicate", |_| Ok(()))
            .unwrap_err();
        assert!(duplicate_error.contains("duplicate"));
        assert_eq!(manager.list_profiles(AgentProvider::Codex).len(), 1);
        fs::remove_file(roots.join("codex-profile-1")).unwrap();

        let swapped_error = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "Swapped", |staged| {
                fs::remove_dir_all(staged).unwrap();
                symlink(&outside, staged).unwrap();
                Ok(())
            })
            .unwrap_err();
        assert!(
            swapped_error.contains("real directory")
                || swapped_error.contains("escaped")
                || swapped_error.contains("identity")
        );
        assert_eq!(manager.list_profiles(AgentProvider::Codex).len(), 1);
        assert!(outside.is_dir());
        remove_dir(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn multi_account_profile_lifecycle_rejects_real_directory_identity_swap_during_probe() {
        let dir = unique_temp_dir("multi-account-profile-identity-swap");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let roots = manager.ensure_profile_roots_directory().unwrap();
        let displaced = roots.join("displaced-original");

        let error = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "Swapped", |root| {
                fs::rename(root, &displaced).unwrap();
                create_private_directory(root).unwrap();
                write_private_config(&root.join("config.toml"), CODEX_PROFILE_CONFIG.as_bytes())
                    .unwrap();
                Ok(())
            })
            .unwrap_err();

        assert!(error.contains("identity") || error.contains("changed"));
        assert!(
            error.contains("rollback failed"),
            "an identity-protected rollback failure must never be hidden"
        );
        assert_eq!(manager.list_profiles(AgentProvider::Codex).len(), 1);
        assert!(displaced.is_dir());
        let blocked = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "Retry", |_| Ok(()))
            .unwrap_err();
        assert!(blocked.contains("duplicate"));
        remove_dir(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn multi_account_profile_lifecycle_successful_rollback_releases_profile_id() {
        let dir = unique_temp_dir("multi-account-profile-successful-rollback");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();

        let error = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "Failed", |_| {
                Err("redacted injected probe failure".to_string())
            })
            .unwrap_err();
        assert!(error.contains("injected probe failure"));
        assert!(!error.contains("rollback failed"));

        let created = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "Retry", |_| Ok(()))
            .unwrap();
        assert_eq!(created.account_id(), "codex-profile-1");
        remove_dir(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn multi_account_profile_lifecycle_reports_installed_root_moved_before_rollback() {
        let dir = unique_temp_dir("multi-account-profile-moved-before-rollback");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let roots = manager.ensure_profile_roots_directory().unwrap();
        let displaced = roots.join("displaced-installed-root");

        let error = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "Moved", |root| {
                fs::rename(root, &displaced).unwrap();
                Err("redacted injected probe failure".to_string())
            })
            .unwrap_err();

        assert!(error.contains("injected probe failure"));
        assert!(
            error.contains("rollback failed"),
            "a missing installed destination must make its displaced orphan explicit"
        );
        assert!(displaced.is_dir());
        remove_dir(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn multi_account_profile_lifecycle_reconciles_config_only_crash_orphan_before_id_reuse() {
        let dir = unique_temp_dir("multi-account-profile-crash-orphan");
        let storage_path = dir.join("agent-auth.json");
        let first_manager = AgentAuthManager::new();
        first_manager
            .initialize_storage(storage_path.clone())
            .unwrap();
        let roots = first_manager.ensure_profile_roots_directory().unwrap();
        let orphan = roots.join("codex-profile-1");
        create_private_directory(&orphan).unwrap();
        write_private_config(&orphan.join("config.toml"), CODEX_PROFILE_CONFIG.as_bytes()).unwrap();
        drop(first_manager);

        let restarted = AgentAuthManager::new();
        restarted.initialize_storage(storage_path).unwrap();
        assert!(
            !orphan.exists(),
            "config-only crash orphan must be reconciled"
        );
        let created = restarted
            .create_profile_with_codex_probe(AgentProvider::Codex, "Recovered", |_| Ok(()))
            .unwrap();
        assert_eq!(created.account_id(), "codex-profile-1");
        remove_dir(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn multi_account_profile_lifecycle_reconciles_interrupted_install_before_rename() {
        let dir = unique_temp_dir("multi-account-profile-interrupted-install");
        let storage_path = dir.join("agent-auth.json");
        let first_manager = AgentAuthManager::new();
        first_manager
            .initialize_storage(storage_path.clone())
            .unwrap();
        let roots = first_manager.ensure_profile_roots_directory().unwrap();
        let interrupted = roots.join(".codex-profile-1.install-4242-7");
        create_private_directory(&interrupted).unwrap();
        write_private_config(
            &interrupted.join("config.toml"),
            CODEX_PROFILE_CONFIG.as_bytes(),
        )
        .unwrap();
        drop(first_manager);

        let restarted = AgentAuthManager::new();
        restarted.initialize_storage(storage_path).unwrap();
        assert!(
            !interrupted.exists(),
            "a same-parent interrupted install must not block restart"
        );
        let created = restarted
            .create_profile_with_codex_probe(AgentProvider::Codex, "Recovered", |_| Ok(()))
            .unwrap();
        assert_eq!(created.account_id(), "codex-profile-1");
        remove_dir(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn multi_account_profile_lifecycle_rejects_unrelated_root_entries_during_reconciliation() {
        let dir = unique_temp_dir("multi-account-profile-unrelated-reconciliation-entry");
        let storage_path = dir.join("agent-auth.json");
        let first_manager = AgentAuthManager::new();
        first_manager
            .initialize_storage(storage_path.clone())
            .unwrap();
        let roots = first_manager.ensure_profile_roots_directory().unwrap();
        let unrelated = roots.join(".manual-data.install-4242-7");
        create_private_directory(&unrelated).unwrap();
        drop(first_manager);

        let restarted = AgentAuthManager::new();
        let error = restarted.initialize_storage(storage_path).unwrap_err();
        assert!(error.contains("unrecognized entry"));
        assert!(unrelated.is_dir(), "unrelated data must not be deleted");
        remove_dir(&dir);
    }

    #[test]
    fn multi_account_profile_lifecycle_windows_owner_only_acl_contract_is_deterministic() {
        let sid = "S-1-5-21-111-222-333-1001";
        assert_eq!(
            windows_owner_only_profile_sddl(sid).unwrap(),
            "D:P(A;OICI;FA;;;S-1-5-21-111-222-333-1001)"
        );

        for invalid in [
            "",
            "WD",
            "S-1-5-18)(A;;FA;;;WD)",
            "S-1-5-21-1\n",
            "S-1-5-21-abc",
        ] {
            assert!(
                windows_owner_only_profile_sddl(invalid).is_err(),
                "invalid SID must not enter the SDDL contract: {invalid:?}"
            );
        }
    }

    #[test]
    fn multi_account_profile_lifecycle_windows_path_attributes_reject_reparse_points() {
        const DIRECTORY: u32 = 0x10;
        const REPARSE_POINT: u32 = 0x400;

        assert!(validate_windows_profile_path_attributes(DIRECTORY, true).is_ok());
        assert!(validate_windows_profile_path_attributes(0, false).is_ok());
        assert!(validate_windows_profile_path_attributes(DIRECTORY | REPARSE_POINT, true).is_err());
        assert!(validate_windows_profile_path_attributes(REPARSE_POINT, false).is_err());
        assert!(validate_windows_profile_path_attributes(0, true).is_err());
        assert!(validate_windows_profile_path_attributes(DIRECTORY, false).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn multi_account_profile_lifecycle_posix_owner_must_match_effective_uid() {
        let effective_uid = unsafe { libc::geteuid() };
        assert!(validate_posix_owner_ids(effective_uid, effective_uid).is_ok());
        assert!(
            validate_posix_owner_ids(effective_uid.wrapping_add(1), effective_uid)
                .unwrap_err()
                .contains("owned by the effective user")
        );
    }

    #[cfg(unix)]
    #[test]
    fn multi_account_profile_lifecycle_linux_directory_acl_contract_includes_default_acl() {
        assert_eq!(
            linux_posix_acl_attribute_names(true),
            vec![
                b"system.posix_acl_access\0".as_slice(),
                b"system.posix_acl_default\0".as_slice(),
            ]
        );
        assert_eq!(
            linux_posix_acl_attribute_names(false),
            vec![b"system.posix_acl_access\0".as_slice()]
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn multi_account_profile_lifecycle_macos_rejects_extended_directory_acl() {
        let dir = unique_temp_dir("multi-account-macos-extended-acl");
        let root = dir.join("private-root");
        create_private_directory(&root).unwrap();
        let status = Command::new("/bin/chmod")
            .args(["+a", "everyone deny write"])
            .arg(&root)
            .status()
            .unwrap();
        assert!(status.success(), "failed to install the macOS test ACL");

        let error = enforce_private_directory(&root).unwrap_err();
        assert!(error.contains("extended ACL"), "unexpected error: {error}");
        let _ = Command::new("/bin/chmod").arg("-N").arg(&root).status();

        let config = root.join("config.toml");
        write_private_config(&config, CODEX_PROFILE_CONFIG.as_bytes()).unwrap();
        let status = Command::new("/bin/chmod")
            .args(["+a", "everyone deny write"])
            .arg(&config)
            .status()
            .unwrap();
        assert!(status.success(), "failed to install the macOS file ACL");
        let error = validate_private_config(&config).unwrap_err();
        assert!(error.contains("extended ACL"), "unexpected error: {error}");
        let _ = Command::new("/bin/chmod").arg("-N").arg(&config).status();
        remove_dir(&dir);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn multi_account_profile_lifecycle_linux_rejects_extended_directory_acl() {
        use std::{ffi::CString, os::unix::ffi::OsStrExt};

        fn push_acl_entry(bytes: &mut Vec<u8>, tag: u16, permissions: u16, id: u32) {
            bytes.extend_from_slice(&tag.to_le_bytes());
            bytes.extend_from_slice(&permissions.to_le_bytes());
            bytes.extend_from_slice(&id.to_le_bytes());
        }

        fn install_acl(path: &Path, attribute: &[u8]) -> CString {
            let mut acl = 2_u32.to_le_bytes().to_vec();
            push_acl_entry(&mut acl, 0x01, 0x07, u32::MAX);
            push_acl_entry(
                &mut acl,
                0x02,
                0x04,
                unsafe { libc::geteuid() }.wrapping_add(1),
            );
            push_acl_entry(&mut acl, 0x04, 0, u32::MAX);
            push_acl_entry(&mut acl, 0x10, 0x04, u32::MAX);
            push_acl_entry(&mut acl, 0x20, 0, u32::MAX);
            let path_c = CString::new(path.as_os_str().as_bytes()).unwrap();
            let installed = unsafe {
                libc::setxattr(
                    path_c.as_ptr(),
                    attribute.as_ptr().cast(),
                    acl.as_ptr().cast(),
                    acl.len(),
                    0,
                )
            };
            assert_eq!(
                installed,
                0,
                "failed to install the Linux test ACL: {}",
                std::io::Error::last_os_error()
            );
            path_c
        }

        let dir = unique_temp_dir("multi-account-linux-extended-acl");
        let root = dir.join("private-root");
        create_private_directory(&root).unwrap();
        let access_attribute = b"system.posix_acl_access\0";
        let default_attribute = b"system.posix_acl_default\0";
        let root_c = install_acl(&root, access_attribute);

        let error = enforce_private_directory(&root).unwrap_err();
        assert!(error.contains("extended ACL"), "unexpected error: {error}");
        unsafe {
            libc::removexattr(root_c.as_ptr(), access_attribute.as_ptr().cast());
        }

        let root_c = install_acl(&root, default_attribute);
        let error = enforce_private_directory(&root).unwrap_err();
        assert!(error.contains("extended ACL"), "unexpected error: {error}");
        unsafe {
            libc::removexattr(root_c.as_ptr(), default_attribute.as_ptr().cast());
        }

        let config = root.join("config.toml");
        write_private_config(&config, CODEX_PROFILE_CONFIG.as_bytes()).unwrap();
        let config_c = install_acl(&config, access_attribute);
        let error = validate_private_config(&config).unwrap_err();
        assert!(error.contains("extended ACL"), "unexpected error: {error}");
        unsafe {
            libc::removexattr(config_c.as_ptr(), access_attribute.as_ptr().cast());
        }
        remove_dir(&dir);
    }

    #[test]
    fn multi_account_profile_lifecycle_enables_claude_isolation_on_linux_and_windows() {
        assert!(additional_claude_profiles_supported_on("linux"));
        assert!(additional_claude_profiles_supported_on("windows"));
        assert!(!additional_claude_profiles_supported_on("macos"));
        assert!(!additional_claude_profiles_supported_on("freebsd"));
    }

    #[test]
    fn codex_account_context_windows_child_creation_locks_containment_and_no_window_flags() {
        let flags = windows_codex_probe_creation_flags();

        assert_ne!(
            flags & WINDOWS_CREATE_SUSPENDED_FLAG,
            0,
            "the Codex child must not execute before Job assignment"
        );
        assert_ne!(
            flags & WINDOWS_CREATE_NO_WINDOW_FLAG,
            0,
            "the contained Codex child must not open a console window"
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn multi_account_profile_lifecycle_windows_applies_and_verifies_owner_only_acl() {
        let dir = unique_temp_dir("multi-account-windows-owner-only-acl");
        let root = dir.join("private-root");
        create_private_directory(&root).unwrap();
        verify_windows_owner_only_acl(&root, true).unwrap();
        let config = root.join("config.toml");
        write_private_config(&config, CODEX_PROFILE_CONFIG.as_bytes()).unwrap();
        validate_private_config(&config).unwrap();
        remove_dir(&dir);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn multi_account_profile_lifecycle_windows_rejects_junction_profile_roots() {
        let dir = unique_temp_dir("multi-account-windows-junction-rejection");
        let target = dir.join("target");
        create_private_directory(&target).unwrap();
        let junction = dir.join("junction");
        let status = Command::new("cmd.exe")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(&junction)
            .arg(&target)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap();
        assert!(status.success(), "Windows CI must support local junctions");

        let error = validate_windows_profile_path(&junction, true).unwrap_err();
        assert!(error.contains("reparse point"));
        fs::remove_dir(&junction).unwrap();
        remove_dir(&dir);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn multi_account_profile_lifecycle_windows_creates_claude_config_root() {
        let dir = unique_temp_dir("multi-account-windows-claude-root");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();

        let created = manager
            .create_profile(AgentProvider::Claude, "Windows Work")
            .unwrap();
        assert_eq!(created.profile_kind(), AgentProfileKind::ClaudeConfigDir);
        let root = manager
            .owned_profile_root(AgentProvider::Claude, created.account_id())
            .unwrap();
        verify_windows_owner_only_acl(&root, true).unwrap();
        let guidance = manager
            .setup_guidance(
                AgentProvider::Claude,
                created.account_id(),
                AgentSetupShell::PowerShell,
            )
            .unwrap();
        assert!(guidance.supported);
        assert_eq!(guidance.environment[0].name, "CLAUDE_CONFIG_DIR");
        assert_eq!(guidance.environment[0].value, root.to_string_lossy());
        remove_dir(&dir);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn multi_account_profile_lifecycle_windows_job_terminates_probe_descendants() {
        use windows_sys::Win32::{
            Foundation::{CloseHandle, WAIT_TIMEOUT},
            System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE},
        };

        let dir = unique_temp_dir("multi-account-windows-probe-descendant");
        let pid_path = dir.join("descendant.pid");
        let escaped_pid_path = pid_path.to_string_lossy().replace('\'', "''");
        let script = format!(
            "$child = Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile','-NonInteractive','-Command','Start-Sleep -Seconds 30' -PassThru; [IO.File]::WriteAllText('{escaped_pid_path}', [string]$child.Id); Start-Sleep -Seconds 30"
        );
        let mut command = Command::new("powershell.exe");
        command.args(["-NoProfile", "-NonInteractive", "-Command", &script]);

        let error = run_codex_profile_probe_command(&mut command, &dir, Duration::from_secs(3))
            .unwrap_err();
        assert!(error.contains("timed out"));
        let descendant_pid = fs::read_to_string(&pid_path)
            .unwrap()
            .parse::<u32>()
            .unwrap();
        let started = Instant::now();
        let still_running = loop {
            let process = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, descendant_pid) };
            let running = if process.is_null() {
                false
            } else {
                let running = unsafe { WaitForSingleObject(process, 0) } == WAIT_TIMEOUT;
                unsafe {
                    CloseHandle(process);
                }
                running
            };
            if !running || started.elapsed() >= Duration::from_secs(2) {
                break running;
            }
            std::thread::sleep(Duration::from_millis(20));
        };
        assert!(!still_running, "the Job must terminate probe descendants");
        remove_dir(&dir);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn multi_account_profile_lifecycle_windows_probe_output_is_capped() {
        let dir = unique_temp_dir("multi-account-windows-probe-output-cap");
        let mut command = Command::new("cmd.exe");
        command.args([
            "/d",
            "/c",
            "for /L %i in (1,1,1000000) do @echo 0123456789012345678901234567890123456789",
        ]);
        let started = Instant::now();

        let error = run_codex_profile_probe_command(&mut command, &dir, Duration::from_secs(10))
            .unwrap_err();

        assert!(error.contains("output exceeded the safe limit"));
        assert!(started.elapsed() < Duration::from_secs(8));
        assert!(fs::read_dir(&dir).unwrap().next().is_none());
        remove_dir(&dir);
    }

    #[test]
    fn multi_account_profile_lifecycle_codex_probe_requires_observed_config_not_version() {
        let dir = unique_temp_dir("multi-account-codex-probe");
        let config_path = dir.join("config.toml");
        fs::write(&config_path, CODEX_PROFILE_CONFIG).unwrap();
        let canonical = dir.canonicalize().unwrap();
        let valid = serde_json::json!({
            "codexVersion": "0.0.1-conflicting-old-version",
            "checks": {
                "config.load": {
                    "status": "ok",
                    "details": {
                        "CODEX_HOME": canonical,
                        "config.toml": canonical.join("config.toml"),
                    }
                },
                "auth.credentials": {
                    "status": "fail",
                    "details": {
                        "auth storage mode": "File",
                        "auth file": canonical.join("auth.json"),
                    }
                }
            }
        });
        validate_codex_profile_doctor_report(&dir, &valid.to_string()).unwrap();

        let mut conflicting_config = valid.clone();
        conflicting_config["checks"]["auth.credentials"]["details"]["auth storage mode"] =
            serde_json::json!("Keyring");
        assert!(
            validate_codex_profile_doctor_report(&dir, &conflicting_config.to_string())
                .unwrap_err()
                .contains("cli_auth_credentials_store")
        );

        let version_only = serde_json::json!({"codexVersion": "999.0.0"});
        assert!(
            validate_codex_profile_doctor_report(&dir, &version_only.to_string())
                .unwrap_err()
                .contains("checks")
        );
        remove_dir(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn multi_account_profile_lifecycle_codex_probe_times_out_kills_and_redacts_stderr() {
        use std::time::{Duration, Instant};

        let dir = unique_temp_dir("multi-account-codex-probe-timeout");
        let script = "printf 'raw-secret-from-stderr' >&2; exec /bin/sleep 2";
        let mut command = Command::new("/bin/sh");
        command.args(["-c", script]);
        let started = Instant::now();

        let error = run_codex_profile_probe_command(&mut command, &dir, Duration::from_millis(40))
            .unwrap_err();

        assert!(started.elapsed() < Duration::from_millis(350));
        assert!(error.contains("timed out"));
        assert!(!error.contains("raw-secret-from-stderr"));
        remove_dir(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn multi_account_profile_lifecycle_codex_probe_does_not_wait_on_descendant_pipes() {
        use std::time::{Duration, Instant};

        let dir = unique_temp_dir("multi-account-codex-probe-descendant");
        let descendant_pid_path = dir.join("descendant.pid");
        let mut command = Command::new("/bin/sh");
        command.args([
            "-c",
            "(/bin/sleep 5) & descendant=$!; printf '%s' \"$descendant\" > \"$1\"; printf 'raw-secret-from-descendant' >&2; exit 0",
            "probe-tree",
            descendant_pid_path.to_str().unwrap(),
        ]);
        let started = Instant::now();

        let stdout =
            run_codex_profile_probe_command(&mut command, &dir, Duration::from_millis(100))
                .unwrap();

        assert!(stdout.is_empty());
        assert!(started.elapsed() < Duration::from_millis(350));
        let descendant_pid = fs::read_to_string(&descendant_pid_path)
            .unwrap()
            .parse::<i32>()
            .unwrap();
        let reaping_started = Instant::now();
        while unix_process_exists(descendant_pid)
            && reaping_started.elapsed() < Duration::from_millis(750)
        {
            std::thread::sleep(Duration::from_millis(10));
        }
        let descendant_survived = unix_process_exists(descendant_pid);
        if descendant_survived {
            kill_unix_process(descendant_pid);
        }
        assert!(
            !descendant_survived,
            "the Codex probe descendant must be terminated with its parent"
        );
        remove_dir(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn multi_account_profile_lifecycle_codex_probe_caps_output_and_terminates_tree_early() {
        use std::time::{Duration, Instant};

        let dir = unique_temp_dir("multi-account-codex-probe-output-cap");
        let mut command = Command::new("/bin/sh");
        command.args([
            "-c",
            "while :; do dd if=/dev/zero bs=65536 count=1 2>/dev/null; /bin/sleep 0.01; done",
        ]);
        let started = Instant::now();

        let error = run_codex_profile_probe_command(&mut command, &dir, Duration::from_secs(2))
            .unwrap_err();

        assert!(error.contains("output exceeded the safe limit"));
        assert!(
            started.elapsed() < Duration::from_millis(900),
            "output overflow must terminate the probe tree before its deadline"
        );
        assert!(
            fs::read_dir(&dir).unwrap().next().is_none(),
            "bounded output must not leave probe artifacts"
        );
        remove_dir(&dir);
    }

    #[test]
    fn multi_account_profile_lifecycle_renders_transient_setup_without_alias_interpolation() {
        let alias = "$(touch /tmp/never) 'Alias' $HOME; &";
        let root = PathBuf::from("/tmp/GTUM root/'quoted';$HOME & more");
        let posix = AgentProfileSetupGuidance::supported(
            AgentProvider::Codex,
            "codex-profile-1",
            "codex",
            vec![AgentProfileSetupEnvironment {
                name: "CODEX_HOME".into(),
                value: root.to_string_lossy().into_owned(),
            }],
            vec!["login".into()],
            AgentSetupShell::Zsh,
        );
        assert_eq!(posix.program.as_deref(), Some("codex"));
        assert_eq!(posix.arguments, vec!["login"]);
        assert!(posix
            .rendered_command
            .as_deref()
            .unwrap()
            .contains("'\"'\"'quoted'\"'\"'"));
        assert!(!posix.rendered_command.as_deref().unwrap().contains(alias));
        assert!(posix.warning.contains("does not log out"));
        assert!(posix.warning.contains("delete credentials"));

        let powershell = AgentProfileSetupGuidance::supported(
            AgentProvider::Codex,
            "codex-profile-1",
            "C:\\Program Files\\Codex & Tools\\codex.exe",
            vec![AgentProfileSetupEnvironment {
                name: "CODEX_HOME".into(),
                value: "C:\\Users\\A B\\it's;$HOME".into(),
            }],
            vec!["login".into()],
            AgentSetupShell::PowerShell,
        );
        let command = powershell.rendered_command.as_deref().unwrap();
        assert!(command.contains("$env:CODEX_HOME = 'C:\\Users\\A B\\it''s;$HOME'"));
        assert!(command.contains("& 'C:\\Program Files\\Codex & Tools\\codex.exe' 'login'"));
        assert!(!command.contains(alias));

        #[cfg(target_os = "macos")]
        {
            let manager = AgentAuthManager::new();
            let dir = unique_temp_dir("multi-account-claude-unsupported");
            manager
                .initialize_storage(dir.join("agent-auth.json"))
                .unwrap();
            let error = manager
                .create_profile(AgentProvider::Claude, alias)
                .unwrap_err();
            assert!(error.contains("unsupported_on_macos"));
            assert!(error.contains("CLAUDE_CONFIG_DIR"));
            remove_dir(&dir);
        }
    }

    #[test]
    fn codex_account_context_pins_exact_home_and_removes_conflicting_child_credentials() {
        let dir = unique_temp_dir("codex-account-context-environment");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let profile = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "Work", |_| Ok(()))
            .unwrap();
        let expected_home = manager
            .owned_profile_root(AgentProvider::Codex, profile.account_id())
            .unwrap();
        let context = manager
            .capture_codex_account_execution_context(profile.account_id())
            .unwrap();
        let ambient_before = std::env::vars_os().collect::<Vec<_>>();
        let mut command = Command::new("codex");
        for variable in [
            "CODEX_HOME",
            "CODEX_ACCESS_TOKEN",
            "CODEX_API_KEY",
            "OPENAI_API_KEY",
            "CODEX_SQLITE_HOME",
        ] {
            command.env(variable, "conflicting-ambient-value");
        }

        crate::runtime::codex::configure_codex_child_environment(&mut command, &context).unwrap();

        let child_environment = command
            .get_envs()
            .map(|(name, value)| {
                (
                    name.to_string_lossy().into_owned(),
                    value.map(|value| value.to_string_lossy().into_owned()),
                )
            })
            .collect::<HashMap<_, _>>();
        assert_eq!(
            child_environment.get("CODEX_HOME"),
            Some(&Some(expected_home.to_string_lossy().into_owned()))
        );
        for variable in [
            "CODEX_ACCESS_TOKEN",
            "CODEX_API_KEY",
            "OPENAI_API_KEY",
            "CODEX_SQLITE_HOME",
        ] {
            assert_eq!(child_environment.get(variable), Some(&None));
        }
        assert_eq!(std::env::vars_os().collect::<Vec<_>>(), ambient_before);
        remove_dir(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn codex_account_context_rejects_post_capture_owned_root_permission_mutation() {
        use std::os::unix::fs::PermissionsExt;

        let dir = unique_temp_dir("codex-account-context-root-mode-revalidation");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let profile = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "Mode mutation", |_| Ok(()))
            .unwrap();
        let root = manager
            .owned_profile_root(AgentProvider::Codex, profile.account_id())
            .unwrap();
        let context = manager
            .capture_codex_account_execution_context(profile.account_id())
            .unwrap();
        fs::set_permissions(&root, fs::Permissions::from_mode(0o755)).unwrap();

        let error = crate::runtime::codex::configure_codex_child_environment(
            &mut Command::new("codex"),
            &context,
        )
        .unwrap_err();

        assert!(error.contains("permissions"), "{error}");
        assert!(error.contains("required 700"), "{error}");
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
        remove_dir(&dir);
    }

    #[test]
    fn codex_account_context_accepts_bounded_nonminimal_owned_config() {
        let dir = unique_temp_dir("codex-account-context-nonminimal-config");
        let config = dir.join("config.toml");
        write_private_config(
            &config,
            br#"# Legitimate account preferences may coexist with the credential-store invariant.
cli_auth_credentials_store = "file"
model = "catalog-account-model"
model_reasoning_effort = "xhigh"

[features]
web_search = true
"#,
        )
        .unwrap();

        validate_private_config(&config).unwrap();

        remove_dir(&dir);
    }

    #[test]
    fn codex_account_context_rejects_invalid_owned_config_without_exposing_contents() {
        let dir = unique_temp_dir("codex-account-context-invalid-config");
        let cases: [(&str, &[u8], &str, &str); 5] = [
            (
                "malformed",
                b"cli_auth_credentials_store = \"file\"\nmodel = \"malformed-private-secret\n",
                "valid TOML",
                "malformed-private-secret",
            ),
            (
                "duplicate",
                b"cli_auth_credentials_store = \"file\"\ncli_auth_credentials_store = \"file\" # duplicate-private-secret\n",
                "valid TOML",
                "duplicate-private-secret",
            ),
            (
                "nested-only",
                b"[credentials]\ncli_auth_credentials_store = \"file\"\nprivate = \"nested-private-secret\"\n",
                "top-level cli_auth_credentials_store",
                "nested-private-secret",
            ),
            (
                "wrong-value",
                b"cli_auth_credentials_store = \"wrong-private-secret\"\n",
                "top-level cli_auth_credentials_store",
                "wrong-private-secret",
            ),
            (
                "wrong-type",
                b"cli_auth_credentials_store = true\nprivate = \"typed-private-secret\"\n",
                "top-level cli_auth_credentials_store",
                "typed-private-secret",
            ),
        ];

        for (name, contents, expected, sensitive) in cases {
            let config = dir.join(format!("{name}.toml"));
            write_private_config(&config, contents).unwrap();
            let error = validate_private_config(&config).unwrap_err();
            assert!(error.contains(expected), "{name}: {error}");
            assert!(!error.contains(sensitive), "{name}: {error}");
        }

        let oversized = dir.join("oversized.toml");
        write_private_config(&oversized, &vec![b'x'; 64 * 1024 + 1]).unwrap();
        let error = validate_private_config(&oversized).unwrap_err();
        assert!(error.contains("size limit"), "{error}");
        assert!(!error.contains(&"x".repeat(32)), "{error}");

        remove_dir(&dir);
    }

    #[test]
    fn codex_account_context_ignores_nested_model_key() {
        let dir = unique_temp_dir("codex-account-context-nested-model");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let profile = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "Nested model", |_| Ok(()))
            .unwrap();
        let root = manager
            .owned_profile_root(AgentProvider::Codex, profile.account_id())
            .unwrap();
        fs::write(
            root.join("config.toml"),
            concat!(
                "cli_auth_credentials_store = \"file\"\n",
                "\n[project.preferences]\n",
                "model = \"nested-model-must-not-win\"\n",
            ),
        )
        .unwrap();
        let context = manager
            .capture_codex_account_execution_context(profile.account_id())
            .unwrap();

        let model = crate::runtime::codex::read_codex_config_model_with_context(&context).unwrap();

        assert_eq!(model, None);
        remove_dir(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn codex_account_context_ignores_nested_reasoning_key() {
        use std::os::unix::fs::PermissionsExt;

        let dir = unique_temp_dir("codex-account-context-nested-reasoning");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let profile = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "Nested reasoning", |_| Ok(()))
            .unwrap();
        let root = manager
            .owned_profile_root(AgentProvider::Codex, profile.account_id())
            .unwrap();
        fs::write(
            root.join("config.toml"),
            concat!(
                "cli_auth_credentials_store = \"file\"\n",
                "model = \"nested-reasoning-model\"\n",
                "\n[project.preferences]\n",
                "model_reasoning_effort = \"xhigh\"\n",
            ),
        )
        .unwrap();
        let context = manager
            .capture_codex_account_execution_context(profile.account_id())
            .unwrap();
        let fake_codex = dir.join("fake-codex");
        fs::write(
            &fake_codex,
            r#"#!/bin/sh
if [ "$1" = debug ] && [ "$2" = models ]; then
  printf '%s\n' '{"models":[{"slug":"nested-reasoning-model","visibility":"list","default_reasoning_level":"medium","supported_reasoning_levels":[{"effort":"medium"},{"effort":"xhigh"}]}]}'
  exit 0
fi
exit 91
"#,
        )
        .unwrap();
        fs::set_permissions(&fake_codex, fs::Permissions::from_mode(0o700)).unwrap();

        let capabilities = crate::runtime::codex::read_codex_capabilities_with_context(
            &fake_codex,
            &context,
            Duration::from_secs(2),
        )
        .unwrap();

        assert_eq!(
            capabilities.default_reasoning_level.as_deref(),
            Some("medium")
        );
        remove_dir(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn codex_account_context_rejects_config_replacement_after_snapshot_open() {
        let dir = unique_temp_dir("codex-account-context-config-replacement");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let profile = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "Replacement", |_| Ok(()))
            .unwrap();
        let root = manager
            .owned_profile_root(AgentProvider::Codex, profile.account_id())
            .unwrap();
        fs::write(
            root.join("config.toml"),
            concat!(
                "cli_auth_credentials_store = \"file\"\n",
                "model = \"original-model\"\n",
            ),
        )
        .unwrap();
        let context = manager
            .capture_codex_account_execution_context(profile.account_id())
            .unwrap();
        let replacement = root.join("replacement.toml");
        write_private_config(
            &replacement,
            concat!(
                "cli_auth_credentials_store = \"file\"\n",
                "model = \"replacement-model-must-not-win\"\n",
            )
            .as_bytes(),
        )
        .unwrap();
        set_codex_config_after_open_hook(move |path| {
            fs::rename(&replacement, path).unwrap();
        });

        let error =
            crate::runtime::codex::read_codex_config_model_with_context(&context).unwrap_err();

        assert!(error.contains("identity changed"), "{error}");
        assert!(!error.contains("replacement-model-must-not-win"), "{error}");
        remove_dir(&dir);
    }

    #[test]
    fn codex_account_context_rejects_oversized_ambient_config_snapshot() {
        let dir = unique_temp_dir("codex-account-context-ambient-config-size");
        let ambient_home = dir.join("ambient-codex-home");
        create_private_directory(&ambient_home).unwrap();
        let mut oversized = b"model = \"ambient-oversized-model\"\n#".to_vec();
        oversized.extend(vec![b'x'; MAX_CODEX_PROFILE_CONFIG_BYTES]);
        fs::write(ambient_home.join("config.toml"), oversized).unwrap();
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let context = manager
            .capture_codex_account_execution_context_with_ambient_home(
                CODEX_DEFAULT_ACCOUNT_ID,
                &ambient_home,
            )
            .unwrap();

        let error =
            crate::runtime::codex::read_codex_config_model_with_context(&context).unwrap_err();

        assert!(error.contains("size limit"), "{error}");
        assert!(!error.contains(&"x".repeat(32)), "{error}");
        remove_dir(&dir);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn codex_account_context_rejects_post_capture_owned_root_dacl_mutation() {
        let dir = unique_temp_dir("codex-account-context-root-dacl-revalidation");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let profile = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "DACL mutation", |_| Ok(()))
            .unwrap();
        let root = manager
            .owned_profile_root(AgentProvider::Codex, profile.account_id())
            .unwrap();
        let context = manager
            .capture_codex_account_execution_context(profile.account_id())
            .unwrap();
        let status = Command::new("icacls.exe")
            .arg(&root)
            .args(["/grant", "*S-1-1-0:(OI)(CI)RX"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .unwrap();
        assert!(status.success(), "failed to mutate the Windows test DACL");

        let error = crate::runtime::codex::configure_codex_child_environment(
            &mut Command::new("codex"),
            &context,
        )
        .unwrap_err();

        assert!(error.contains("DACL"), "{error}");
        apply_windows_owner_only_acl(&root, true).unwrap();
        remove_dir(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn codex_account_context_validation_uses_login_status_only_and_never_reads_auth_json() {
        use std::os::unix::fs::PermissionsExt;

        let dir = unique_temp_dir("codex-account-context-status-only");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let profile = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "Status", |_| Ok(()))
            .unwrap();
        let root = manager
            .owned_profile_root(AgentProvider::Codex, profile.account_id())
            .unwrap();
        fs::write(root.join("auth.json"), "this is intentionally not JSON").unwrap();
        let invocation_path = root.join("status-invocation.txt");
        let fake_codex = dir.join("fake-codex");
        fs::write(
            &fake_codex,
            format!(
                "#!/bin/sh\nprintf '%s\\n' \"$@\" > '{}'\nif [ \"$1\" = login ] && [ \"$2\" = status ] && [ \"$#\" -eq 2 ]; then\n  printf '%s\\n' 'Logged in using ChatGPT'\n  exit 0\nfi\nexit 41\n",
                invocation_path.to_string_lossy()
            ),
        )
        .unwrap();
        fs::set_permissions(&fake_codex, fs::Permissions::from_mode(0o700)).unwrap();
        let context = manager
            .capture_codex_account_execution_context(profile.account_id())
            .unwrap();

        let account = crate::runtime::codex::validate_codex_connection_with_context(
            &fake_codex,
            &context,
            Duration::from_secs(2),
        )
        .unwrap();

        assert_eq!(account, "Codex ChatGPT Session");
        assert_eq!(
            fs::read_to_string(invocation_path).unwrap(),
            "login\nstatus\n"
        );
        assert_eq!(
            fs::read_to_string(root.join("auth.json")).unwrap(),
            "this is intentionally not JSON"
        );
        remove_dir(&dir);
    }

    #[test]
    fn codex_account_context_ambient_home_is_frozen_at_lease_capture() {
        let dir = unique_temp_dir("codex-account-context-ambient-freeze");
        let ambient_home = dir.join("ambient-a");
        let conflicting_home = dir.join("ambient-b");
        create_private_directory(&ambient_home).unwrap();
        create_private_directory(&conflicting_home).unwrap();
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let context = manager
            .capture_codex_account_execution_context_with_ambient_home(
                CODEX_DEFAULT_ACCOUNT_ID,
                &ambient_home,
            )
            .unwrap();
        let mut command = Command::new("codex");
        command.env("CODEX_HOME", &conflicting_home);

        crate::runtime::codex::configure_codex_child_environment(&mut command, &context).unwrap();

        let configured_home = command
            .get_envs()
            .find(|(name, _)| *name == std::ffi::OsStr::new("CODEX_HOME"))
            .and_then(|(_, value)| value)
            .map(PathBuf::from)
            .unwrap();
        assert_eq!(configured_home, ambient_home.canonicalize().unwrap());
        assert_eq!(
            context.lease().account_id(),
            CODEX_DEFAULT_ACCOUNT_ID,
            "the ambient root and immutable reserved-account lease must be captured together"
        );

        let displaced = dir.join("ambient-displaced");
        fs::rename(&ambient_home, &displaced).unwrap();
        create_private_directory(&ambient_home).unwrap();
        let error = crate::runtime::codex::configure_codex_child_environment(
            &mut Command::new("codex"),
            &context,
        )
        .unwrap_err();
        assert!(error.contains("identity changed"), "{error}");
        remove_dir(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn codex_account_context_threads_diagnostics_config_models_and_capabilities() {
        use std::os::unix::fs::PermissionsExt;

        let dir = unique_temp_dir("codex-account-context-capabilities");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let profile = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "Catalog", |_| Ok(()))
            .unwrap();
        let root = manager
            .owned_profile_root(AgentProvider::Codex, profile.account_id())
            .unwrap();
        fs::write(
            root.join("config.toml"),
            concat!(
                "cli_auth_credentials_store = \"file\"\n",
                "model = \"catalog-\\u0061ccount-model\" # escaped account model\n",
                "model_reasoning_effort = \"xhigh\" # preferred effort\n",
                "\n[features]\nweb_search = true\n",
            ),
        )
        .unwrap();
        let invocation_path = root.join("context-invocations.txt");
        let fake_codex = dir.join("fake-codex");
        fs::write(
            &fake_codex,
            format!(
                "#!/bin/sh\nprintf 'home=%s args=%s\\n' \"$CODEX_HOME\" \"$*\" >> '{}'\nif [ \"$1\" = login ] && [ \"$2\" = status ] && [ \"$#\" -eq 2 ]; then\n  printf '%s\\n' 'Logged in using ChatGPT'\n  exit 0\nfi\nif [ \"$1\" = debug ] && [ \"$2\" = models ] && [ \"$#\" -eq 2 ]; then\n  printf '%s\\n' '{{\"models\":[{{\"slug\":\"catalog-account-model\",\"display_name\":\"Catalog Account Model\",\"visibility\":\"list\",\"default_reasoning_level\":\"medium\",\"supported_reasoning_levels\":[{{\"effort\":\"low\"}},{{\"effort\":\"medium\"}},{{\"effort\":\"xhigh\"}}]}}]}}'\n  exit 0\nfi\nexit 42\n",
                invocation_path.to_string_lossy()
            ),
        )
        .unwrap();
        fs::set_permissions(&fake_codex, fs::Permissions::from_mode(0o700)).unwrap();
        let context = manager
            .capture_codex_account_execution_context(profile.account_id())
            .unwrap();

        let diagnostics = crate::runtime::codex::read_codex_diagnostics_with_context(
            &fake_codex,
            &context,
            Duration::from_secs(5),
        )
        .unwrap();
        let configured_model =
            crate::runtime::codex::read_codex_config_model_with_context(&context).unwrap();
        let capabilities = crate::runtime::codex::read_codex_capabilities_with_context(
            &fake_codex,
            &context,
            Duration::from_secs(5),
        )
        .unwrap();

        assert_eq!(
            diagnostics.setup_state,
            crate::runtime::codex::AgentProviderSetupState::Ready
        );
        assert_eq!(configured_model.as_deref(), Some("catalog-account-model"));
        assert_eq!(capabilities.available_models.len(), 1);
        assert_eq!(
            capabilities.available_models[0].model_id,
            "catalog-account-model"
        );
        assert_eq!(
            capabilities
                .current_model
                .as_ref()
                .map(|model| model.model_id.as_str()),
            Some("catalog-account-model")
        );
        assert!(capabilities
            .reasoning_levels
            .iter()
            .any(|level| level.level == "xhigh"));
        assert_eq!(
            capabilities.default_reasoning_level.as_deref(),
            Some("xhigh")
        );
        let expected_home = root.canonicalize().unwrap().to_string_lossy().into_owned();
        assert_eq!(
            fs::read_to_string(invocation_path).unwrap(),
            format!(
                "home={expected_home} args=login status\nhome={expected_home} args=debug models\n"
            )
        );
        remove_dir(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn codex_account_context_request_uses_one_context_for_validation_catalog_and_exec() {
        use std::os::unix::fs::PermissionsExt;

        let dir = unique_temp_dir("codex-account-context-request");
        let project = dir.join("project");
        fs::create_dir(&project).unwrap();
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let profile = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "Request", |_| Ok(()))
            .unwrap();
        let root = manager
            .owned_profile_root(AgentProvider::Codex, profile.account_id())
            .unwrap();
        let invocation_path = root.join("request-invocations.txt");
        let fake_codex = dir.join("fake-codex");
        fs::write(
            &fake_codex,
            format!(
                "#!/bin/sh\nprintf 'home=%s args=%s\\n' \"$CODEX_HOME\" \"$*\" >> '{}'\nif [ \"$1\" = login ] && [ \"$2\" = status ] && [ \"$#\" -eq 2 ]; then\n  printf '%s\\n' 'Logged in using ChatGPT'\n  exit 0\nfi\nif [ \"$1\" = debug ] && [ \"$2\" = models ] && [ \"$#\" -eq 2 ]; then\n  printf '%s\\n' '{{\"models\":[{{\"slug\":\"request-model\",\"display_name\":\"Request Model\",\"visibility\":\"list\"}}]}}'\n  exit 0\nfi\nif [ \"$1\" = exec ]; then\n  output=\n  while [ \"$#\" -gt 0 ]; do\n    if [ \"$1\" = -o ]; then shift; output=$1; fi\n    shift\n  done\n  printf '%s\\n' '{{\"summary\":\"Account-owned reply\",\"command\":\"\",\"preferredTarget\":\"new_tab\",\"confidence\":\"high\",\"error\":null}}' > \"$output\"\n  exit 0\nfi\nexit 43\n",
                invocation_path.to_string_lossy()
            ),
        )
        .unwrap();
        fs::set_permissions(&fake_codex, fs::Permissions::from_mode(0o700)).unwrap();
        let context = manager
            .capture_codex_account_execution_context(profile.account_id())
            .unwrap();
        let ambient_before = std::env::vars_os().collect::<Vec<_>>();
        let request = crate::runtime::codex::RequestAgentSuggestionsRequest {
            provider: AgentProvider::Codex,
            agent_session_id: "agent-session-context".into(),
            model: Some("request-model".into()),
            reasoning_level: None,
            fast_mode: Some(false),
            attachments: vec![],
            project_name: "project".into(),
            project_path: project.to_string_lossy().into_owned(),
            active_tab_id: None,
            active_tab_title: None,
            active_file_path: None,
            active_file_line: None,
            active_file_snippet: None,
            last_n_log_lines: vec![],
            user_task: "Return an account-owned reply".into(),
        };

        let attempt = crate::runtime::codex::request_codex_suggestion_attempt_with_context(
            &fake_codex,
            &context,
            request,
            Duration::from_secs(2),
            Duration::from_secs(2),
        );

        assert_eq!(attempt.validation.unwrap(), "Codex ChatGPT Session");
        let suggestions = attempt.suggestions.unwrap().unwrap();
        assert_eq!(suggestions.len(), 1);
        assert_eq!(suggestions[0].summary, "Account-owned reply");
        let invocations = fs::read_to_string(invocation_path).unwrap();
        let expected_home = root.canonicalize().unwrap().to_string_lossy().into_owned();
        assert_eq!(
            invocations
                .matches(&format!("home={expected_home}"))
                .count(),
            3
        );
        assert!(invocations.contains("args=login status"), "{invocations}");
        assert!(invocations.contains("args=debug models"), "{invocations}");
        assert!(invocations.contains("args=exec "), "{invocations}");
        let exec_invocation = invocations
            .lines()
            .find(|line| line.contains("args=exec "))
            .unwrap();
        assert!(
            exec_invocation.matches(&expected_home).count() >= 3,
            "schema and output must both live below the selected private CODEX_HOME: {exec_invocation}"
        );
        assert_eq!(std::env::vars_os().collect::<Vec<_>>(), ambient_before);
        remove_dir(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn codex_account_context_exec_failure_discards_child_secrets_and_pii() {
        use std::os::unix::fs::PermissionsExt;

        let dir = unique_temp_dir("codex-account-context-redacted-exec-failure");
        let project = dir.join("project");
        fs::create_dir(&project).unwrap();
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let profile = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "Redacted", |_| Ok(()))
            .unwrap();
        let context = manager
            .capture_codex_account_execution_context(profile.account_id())
            .unwrap();
        let fake_codex = dir.join("fake-codex");
        fs::write(
            &fake_codex,
            r#"#!/bin/sh
if [ "$1" = login ] && [ "$2" = status ]; then
  printf '%s\n' 'Logged in using ChatGPT'
  exit 0
fi
if [ "$1" = debug ] && [ "$2" = models ]; then
  printf '%s\n' '{"models":[{"slug":"redacted-model","visibility":"list"}]}'
  exit 0
fi
if [ "$1" = exec ]; then
  printf '%s\n' 'stdout sk-live-secret alice@example.com /Users/alice/private'
  printf '%s\n' 'stderr sk-live-secret alice@example.com /Users/alice/private' >&2
  exit 73
fi
exit 74
"#,
        )
        .unwrap();
        fs::set_permissions(&fake_codex, fs::Permissions::from_mode(0o700)).unwrap();
        let request = crate::runtime::codex::RequestAgentSuggestionsRequest {
            provider: AgentProvider::Codex,
            agent_session_id: "agent-session-redaction".into(),
            model: Some("redacted-model".into()),
            reasoning_level: None,
            fast_mode: Some(false),
            attachments: vec![],
            project_name: "private-project".into(),
            project_path: project.to_string_lossy().into_owned(),
            active_tab_id: None,
            active_tab_title: None,
            active_file_path: None,
            active_file_line: None,
            active_file_snippet: None,
            last_n_log_lines: vec![],
            user_task: "trigger a redacted failure".into(),
        };

        let attempt = crate::runtime::codex::request_codex_suggestion_attempt_with_context(
            &fake_codex,
            &context,
            request,
            Duration::from_secs(2),
            Duration::from_secs(2),
        );
        let error = match attempt.suggestions.unwrap() {
            Ok(_) => panic!("the nonzero Codex child must fail"),
            Err(error) => error,
        };

        assert_eq!(
            error,
            "Codex CLI request failed. Child diagnostics were discarded to protect account and project data. Verify the selected Codex account and retry."
        );
        for sensitive in [
            "sk-live-secret",
            "alice@example.com",
            "/Users/alice/private",
        ] {
            assert!(!error.contains(sensitive), "{error}");
        }
        remove_dir(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn codex_account_context_concurrent_a_b_children_keep_exact_isolated_environments() {
        use std::os::unix::fs::PermissionsExt;

        let dir = unique_temp_dir("codex-account-context-concurrent");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let profile_a = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "A", |_| Ok(()))
            .unwrap();
        let profile_b = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "B", |_| Ok(()))
            .unwrap();
        let context_a = manager
            .capture_codex_account_execution_context(profile_a.account_id())
            .unwrap();
        let context_b = manager
            .capture_codex_account_execution_context(profile_b.account_id())
            .unwrap();
        let root_a = context_a.revalidated_codex_home().unwrap();
        let root_b = context_b.revalidated_codex_home().unwrap();
        let fake_codex = dir.join("fake-codex");
        fs::write(
            &fake_codex,
            r#"#!/bin/sh
sleep 0.05
printf 'home=%s access=%s codex_key=%s openai=%s sqlite=%s args=%s\n' "$CODEX_HOME" "${CODEX_ACCESS_TOKEN-unset}" "${CODEX_API_KEY-unset}" "${OPENAI_API_KEY-unset}" "${CODEX_SQLITE_HOME-unset}" "$*" > "$CODEX_HOME/concurrent-child.txt"
printf '%s\n' 'Logged in using ChatGPT'
"#,
        )
        .unwrap();
        fs::set_permissions(&fake_codex, fs::Permissions::from_mode(0o700)).unwrap();
        let ambient_before = std::env::vars_os().collect::<Vec<_>>();
        let program_a = fake_codex.clone();
        let program_b = fake_codex.clone();

        let child_a = std::thread::spawn(move || {
            crate::runtime::codex::validate_codex_connection_with_context(
                &program_a,
                &context_a,
                Duration::from_secs(2),
            )
        });
        let child_b = std::thread::spawn(move || {
            crate::runtime::codex::validate_codex_connection_with_context(
                &program_b,
                &context_b,
                Duration::from_secs(2),
            )
        });

        assert_eq!(child_a.join().unwrap().unwrap(), "Codex ChatGPT Session");
        assert_eq!(child_b.join().unwrap().unwrap(), "Codex ChatGPT Session");
        for root in [&root_a, &root_b] {
            let record = fs::read_to_string(root.join("concurrent-child.txt")).unwrap();
            assert!(
                record.starts_with(&format!("home={}", root.to_string_lossy())),
                "{record}"
            );
            assert!(record.contains("access=unset"), "{record}");
            assert!(record.contains("codex_key=unset"), "{record}");
            assert!(record.contains("openai=unset"), "{record}");
            assert!(record.contains("sqlite=unset"), "{record}");
            assert!(record.ends_with("args=login status\n"), "{record}");
        }
        assert_ne!(root_a, root_b);
        assert_eq!(std::env::vars_os().collect::<Vec<_>>(), ambient_before);
        remove_dir(&dir);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn codex_account_context_windows_cmd_child_receives_exact_scrubbed_home() {
        let dir = unique_temp_dir("codex-account-context-windows-cmd");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let profile = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "Windows", |_| Ok(()))
            .unwrap();
        let context = manager
            .capture_codex_account_execution_context(profile.account_id())
            .unwrap();
        let root = context.revalidated_codex_home().unwrap();
        let fake_codex = dir.join("fake-codex.cmd");
        fs::write(
            &fake_codex,
            r#"@echo off
setlocal
if defined CODEX_ACCESS_TOKEN exit /b 51
if defined CODEX_API_KEY exit /b 52
if defined OPENAI_API_KEY exit /b 53
if defined CODEX_SQLITE_HOME exit /b 54
> "%CODEX_HOME%\windows-status-child.txt" echo home=%CODEX_HOME% args=%*
if /I "%~1"=="login" if /I "%~2"=="status" if "%~3"=="" (
  echo Logged in using ChatGPT
  exit /b 0
)
exit /b 55
"#,
        )
        .unwrap();

        let account = crate::runtime::codex::validate_codex_connection_with_context(
            &fake_codex,
            &context,
            Duration::from_secs(2),
        )
        .unwrap();

        assert_eq!(account, "Codex ChatGPT Session");
        let record = fs::read_to_string(root.join("windows-status-child.txt")).unwrap();
        assert_eq!(
            record.trim_end(),
            format!("home={} args=login status", root.to_string_lossy())
        );
        remove_dir(&dir);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn codex_account_context_windows_concurrent_a_b_cmd_children_stay_isolated() {
        let dir = unique_temp_dir("codex-account-context-windows-concurrent");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let profile_a = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "Windows A", |_| Ok(()))
            .unwrap();
        let profile_b = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "Windows B", |_| Ok(()))
            .unwrap();
        let context_a = manager
            .capture_codex_account_execution_context(profile_a.account_id())
            .unwrap();
        let context_b = manager
            .capture_codex_account_execution_context(profile_b.account_id())
            .unwrap();
        let root_a = context_a.revalidated_codex_home().unwrap();
        let root_b = context_b.revalidated_codex_home().unwrap();
        let fake_codex = dir.join("fake-concurrent-codex.cmd");
        fs::write(
            &fake_codex,
            r#"@echo off
setlocal
> "%CODEX_HOME%\concurrent-child.txt" echo home=%CODEX_HOME% access=%CODEX_ACCESS_TOKEN% codex_key=%CODEX_API_KEY% openai=%OPENAI_API_KEY% sqlite=%CODEX_SQLITE_HOME% args=%*
if defined CODEX_ACCESS_TOKEN exit /b 61
if defined CODEX_API_KEY exit /b 62
if defined OPENAI_API_KEY exit /b 63
if defined CODEX_SQLITE_HOME exit /b 64
if /I not "%~1"=="login" exit /b 65
if /I not "%~2"=="status" exit /b 66
echo Logged in using ChatGPT
"#,
        )
        .unwrap();
        let program_a = fake_codex.clone();
        let program_b = fake_codex.clone();

        let child_a = std::thread::spawn(move || {
            crate::runtime::codex::validate_codex_connection_with_context(
                &program_a,
                &context_a,
                Duration::from_secs(2),
            )
        });
        let child_b = std::thread::spawn(move || {
            crate::runtime::codex::validate_codex_connection_with_context(
                &program_b,
                &context_b,
                Duration::from_secs(2),
            )
        });

        assert_eq!(child_a.join().unwrap().unwrap(), "Codex ChatGPT Session");
        assert_eq!(child_b.join().unwrap().unwrap(), "Codex ChatGPT Session");
        for root in [&root_a, &root_b] {
            let record = fs::read_to_string(root.join("concurrent-child.txt")).unwrap();
            assert!(
                record.starts_with(&format!("home={}", root.to_string_lossy())),
                "{record}"
            );
            assert!(
                record.contains(" access= codex_key= openai= sqlite= "),
                "{record}"
            );
            assert!(record.trim_end().ends_with("args=login status"), "{record}");
        }
        assert_ne!(root_a, root_b);
        remove_dir(&dir);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn codex_account_context_windows_root_revalidation_blocks_cmd_launch() {
        let dir = unique_temp_dir("codex-account-context-windows-root-swap");
        let ambient_home = dir.join("ambient-home");
        create_private_directory(&ambient_home).unwrap();
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let context = manager
            .capture_codex_account_execution_context_with_ambient_home(
                CODEX_DEFAULT_ACCOUNT_ID,
                &ambient_home,
            )
            .unwrap();
        let invocation_path = dir.join("unexpected-invocation.txt");
        let fake_codex = dir.join("fake-root-check-codex.cmd");
        fs::write(
            &fake_codex,
            format!(
                "@echo off\r\n> \"{}\" echo invoked\r\necho Logged in using ChatGPT\r\n",
                invocation_path.to_string_lossy()
            ),
        )
        .unwrap();
        let displaced = dir.join("ambient-displaced");
        fs::rename(&ambient_home, &displaced).unwrap();
        create_private_directory(&ambient_home).unwrap();

        let error = crate::runtime::codex::validate_codex_connection_with_context(
            &fake_codex,
            &context,
            Duration::from_secs(2),
        )
        .unwrap_err();

        assert!(error.contains("identity changed"), "{error}");
        assert!(
            !invocation_path.exists(),
            "the replaced root must fail before spawn"
        );
        remove_dir(&dir);
    }

    #[test]
    fn claude_account_context_rejects_unknown_forgotten_and_wrong_provider_ids() {
        let dir = unique_temp_dir("claude-account-context-account-errors");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let claude = manager
            .create_profile_with_probe(AgentProvider::Claude, "Claude", |_| Ok(()))
            .unwrap();
        let codex = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "Codex", |_| Ok(()))
            .unwrap();

        let unknown = manager
            .capture_claude_account_execution_context_for_platform(
                "claude-profile-does-not-exist",
                "linux",
            )
            .unwrap_err();
        assert!(unknown.contains("unknown account profile"), "{unknown}");

        let mismatch = manager
            .capture_claude_account_execution_context_for_platform(codex.account_id(), "linux")
            .unwrap_err();
        assert!(mismatch.contains("provider/account mismatch"), "{mismatch}");

        manager
            .forget_profile(AgentProvider::Claude, claude.account_id())
            .unwrap();
        let forgotten = manager
            .capture_claude_account_execution_context_for_platform(claude.account_id(), "linux")
            .unwrap_err();
        assert!(forgotten.contains("forgotten"), "{forgotten}");
        remove_dir(&dir);
    }

    #[test]
    fn claude_account_context_restored_owned_profile_fails_closed_on_macos() {
        let dir = unique_temp_dir("claude-account-context-restored-macos");
        let storage = dir.join("agent-auth.json");
        let account_id = {
            let manager = AgentAuthManager::new();
            manager.initialize_storage(storage.clone()).unwrap();
            manager
                .create_profile_with_probe(AgentProvider::Claude, "Restored", |_| Ok(()))
                .unwrap()
                .account_id()
                .to_string()
        };
        let restored = AgentAuthManager::new();
        restored.initialize_storage(storage).unwrap();

        let error = restored
            .capture_claude_account_execution_context_for_platform(&account_id, "macos")
            .unwrap_err();

        assert!(error.contains("unsupported_on_macos"), "{error}");
        assert!(error.contains("CLAUDE_CONFIG_DIR"), "{error}");
        assert!(error.contains("ambient Claude account"), "{error}");
        assert!(!error.contains(CLAUDE_DEFAULT_ACCOUNT_ID), "{error}");
        remove_dir(&dir);
    }

    #[test]
    fn claude_account_context_owned_profile_is_cli_only_and_sets_exact_scrubbed_root() {
        let dir = unique_temp_dir("claude-account-context-owned-environment");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let profile = manager
            .create_profile_with_probe(AgentProvider::Claude, "Owned", |_| Ok(()))
            .unwrap();
        let root = manager
            .owned_profile_root(AgentProvider::Claude, profile.account_id())
            .unwrap();
        // If owned capture ever consults settings.json, this deliberately oversized
        // helper document makes capture fail. Owned profiles are CLI-session-only.
        fs::write(root.join("settings.json"), vec![b'x'; 70 * 1024]).unwrap();
        let context = manager
            .capture_claude_account_execution_context_for_platform(profile.account_id(), "linux")
            .unwrap();
        let mut command = Command::new("claude");
        for variable in [
            "ANTHROPIC_API_KEY",
            "ANTHROPIC_AUTH_TOKEN",
            "CLAUDE_CODE_OAUTH_TOKEN",
            "CLAUDE_CODE_OAUTH_REFRESH_TOKEN",
            "ANTHROPIC_BASE_URL",
            "CLAUDE_CODE_USE_BEDROCK",
            "AWS_ACCESS_KEY_ID",
            "GOOGLE_APPLICATION_CREDENTIALS",
            "AZURE_CLIENT_SECRET",
        ] {
            command.env(variable, "competing-owned-secret");
        }

        crate::runtime::claude::configure_claude_child_environment(&mut command, &context).unwrap();

        let child_environment = command
            .get_envs()
            .map(|(name, value)| {
                (
                    name.to_string_lossy().into_owned(),
                    value.map(|value| value.to_string_lossy().into_owned()),
                )
            })
            .collect::<HashMap<_, _>>();
        assert_eq!(
            child_environment.get("CLAUDE_CONFIG_DIR"),
            Some(&Some(root.to_string_lossy().into_owned()))
        );
        for variable in [
            "ANTHROPIC_API_KEY",
            "ANTHROPIC_AUTH_TOKEN",
            "CLAUDE_CODE_OAUTH_TOKEN",
            "CLAUDE_CODE_OAUTH_REFRESH_TOKEN",
            "ANTHROPIC_BASE_URL",
            "CLAUDE_CODE_USE_BEDROCK",
            "AWS_ACCESS_KEY_ID",
            "GOOGLE_APPLICATION_CREDENTIALS",
            "AZURE_CLIENT_SECRET",
        ] {
            assert_eq!(child_environment.get(variable), Some(&None), "{variable}");
        }
        remove_dir(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn claude_account_context_routes_status_diagnostics_catalog_and_request_to_one_owned_root() {
        use std::os::unix::fs::PermissionsExt;

        let dir = unique_temp_dir("claude-account-context-owned-routing");
        let project = dir.join("project");
        fs::create_dir(&project).unwrap();
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let profile = manager
            .create_profile_with_probe(AgentProvider::Claude, "Routed", |_| Ok(()))
            .unwrap();
        let root = manager
            .owned_profile_root(AgentProvider::Claude, profile.account_id())
            .unwrap();
        fs::write(root.join("settings.json"), vec![b'x'; 70 * 1024]).unwrap();
        let context = manager
            .capture_claude_account_execution_context_for_platform(profile.account_id(), "linux")
            .unwrap();
        let fake_claude = dir.join("fake-claude");
        fs::write(
            &fake_claude,
            r#"#!/bin/sh
printf 'config=%s args=%s\n' "$CLAUDE_CONFIG_DIR" "$*" >> "$CLAUDE_CONFIG_DIR/invocations.txt"
case " $* " in
  *" auth status --json "*)
    printf '%s' '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"}'
    exit 0
    ;;
  *" --input-format stream-json "*)
    /bin/cat >/dev/null
    printf '%s' '{"type":"control_response","response":{"subtype":"success","request_id":"gtum-claude-model-catalog-v1","response":{"models":[{"value":"owned-model","resolvedModel":"claude-owned","displayName":"Owned","description":"Owned model"}]}}}'
    exit 0
    ;;
  *)
    /bin/cat >/dev/null
    printf '%s' '{"type":"result","subtype":"success","is_error":false,"structured_output":{"provider":"claude","schemaVersion":1,"summary":"Owned account reply","command":"","preferredTarget":"current_tab","confidence":"high","error":null}}'
    ;;
esac
"#,
        )
        .unwrap();
        fs::set_permissions(&fake_claude, fs::Permissions::from_mode(0o700)).unwrap();

        let validation = crate::runtime::claude::validate_claude_connection_with_context(
            &fake_claude,
            &context,
            Duration::from_secs(2),
        )
        .unwrap();
        assert_eq!(
            validation.credential_source,
            crate::runtime::claude::ClaudeCredentialSource::CliSession
        );
        let diagnostics = crate::runtime::claude::read_claude_diagnostics_with_context(
            &fake_claude,
            &context,
            Duration::from_secs(2),
        )
        .unwrap();
        assert_eq!(diagnostics.provider, AgentProvider::Claude);
        let capabilities = crate::runtime::claude::read_claude_capabilities_with_context(
            &fake_claude,
            &context,
            Duration::from_secs(2),
        )
        .unwrap();
        assert_eq!(capabilities.available_models[0].model_id, "owned-model");
        let request = crate::runtime::codex::RequestAgentSuggestionsRequest {
            provider: AgentProvider::Claude,
            agent_session_id: "owned-session".into(),
            model: Some("owned-model".into()),
            reasoning_level: None,
            fast_mode: Some(false),
            attachments: vec![],
            project_name: "project".into(),
            project_path: project.to_string_lossy().into_owned(),
            active_tab_id: None,
            active_tab_title: None,
            active_file_path: None,
            active_file_line: None,
            active_file_snippet: None,
            last_n_log_lines: vec![],
            user_task: "Use the exact owned account".into(),
        };
        let attempt = crate::runtime::claude::request_claude_suggestion_attempt_with_context(
            &fake_claude,
            &context,
            request,
            Duration::from_secs(2),
            Duration::from_secs(2),
        );
        assert!(attempt.validation.is_ok());
        assert_eq!(
            attempt.suggestions.unwrap().unwrap()[0].summary,
            "Owned account reply"
        );

        let invocations = fs::read_to_string(root.join("invocations.txt")).unwrap();
        let exact = format!("config={}", root.to_string_lossy());
        assert_eq!(invocations.lines().count(), 6, "{invocations}");
        assert!(
            invocations.lines().all(|line| line.starts_with(&exact)),
            "{invocations}"
        );
        assert_eq!(
            invocations.matches(" auth status --json").count(),
            3,
            "{invocations}"
        );
        assert_eq!(
            invocations.matches("--input-format stream-json").count(),
            2,
            "{invocations}"
        );
        assert_eq!(
            invocations.matches("--safe-mode").count(),
            6,
            "{invocations}"
        );
        assert!(!invocations.contains("--bare"), "{invocations}");
        assert!(!invocations.contains("apiKeyHelper"), "{invocations}");
        remove_dir(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn claude_account_context_concurrent_a_b_children_keep_exact_isolated_roots() {
        use std::os::unix::fs::PermissionsExt;

        let dir = unique_temp_dir("claude-account-context-concurrent");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let profile_a = manager
            .create_profile_with_probe(AgentProvider::Claude, "A", |_| Ok(()))
            .unwrap();
        let profile_b = manager
            .create_profile_with_probe(AgentProvider::Claude, "B", |_| Ok(()))
            .unwrap();
        let root_a = manager
            .owned_profile_root(AgentProvider::Claude, profile_a.account_id())
            .unwrap();
        let root_b = manager
            .owned_profile_root(AgentProvider::Claude, profile_b.account_id())
            .unwrap();
        let context_a = manager
            .capture_claude_account_execution_context_for_platform(profile_a.account_id(), "linux")
            .unwrap();
        let context_b = manager
            .capture_claude_account_execution_context_for_platform(profile_b.account_id(), "linux")
            .unwrap();
        let fake_claude = dir.join("fake-concurrent-claude");
        fs::write(
            &fake_claude,
            r#"#!/bin/sh
sleep 0.05
printf 'config=%s api=%s oauth=%s auth=%s base=%s aws=%s google=%s azure=%s\n' "$CLAUDE_CONFIG_DIR" "${ANTHROPIC_API_KEY-unset}" "${CLAUDE_CODE_OAUTH_TOKEN-unset}" "${ANTHROPIC_AUTH_TOKEN-unset}" "${ANTHROPIC_BASE_URL-unset}" "${AWS_ACCESS_KEY_ID-unset}" "${GOOGLE_APPLICATION_CREDENTIALS-unset}" "${AZURE_CLIENT_SECRET-unset}" > "$CLAUDE_CONFIG_DIR/concurrent-child.txt"
printf '%s' '{"loggedIn":true,"authMethod":"claude.ai","apiProvider":"firstParty"}'
"#,
        )
        .unwrap();
        fs::set_permissions(&fake_claude, fs::Permissions::from_mode(0o700)).unwrap();
        let program_a = fake_claude.clone();
        let program_b = fake_claude.clone();

        let child_a = std::thread::spawn(move || {
            crate::runtime::claude::validate_claude_connection_with_context(
                &program_a,
                &context_a,
                Duration::from_secs(2),
            )
        });
        let child_b = std::thread::spawn(move || {
            crate::runtime::claude::validate_claude_connection_with_context(
                &program_b,
                &context_b,
                Duration::from_secs(2),
            )
        });

        assert!(child_a.join().unwrap().is_ok());
        assert!(child_b.join().unwrap().is_ok());
        for root in [&root_a, &root_b] {
            let record = fs::read_to_string(root.join("concurrent-child.txt")).unwrap();
            assert!(
                record.starts_with(&format!("config={}", root.to_string_lossy())),
                "{record}"
            );
            for scrubbed in [
                "api=unset",
                "oauth=unset",
                "auth=unset",
                "base=unset",
                "aws=unset",
                "google=unset",
                "azure=unset",
            ] {
                assert!(record.contains(scrubbed), "{record}");
            }
        }
        assert_ne!(root_a, root_b);
        remove_dir(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn claude_account_context_revalidates_owned_permissions_and_symlink_identity_before_spawn() {
        use std::os::unix::fs::{symlink, PermissionsExt};

        let dir = unique_temp_dir("claude-account-context-owned-revalidation");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let profile = manager
            .create_profile_with_probe(AgentProvider::Claude, "Mutated", |_| Ok(()))
            .unwrap();
        let root = manager
            .owned_profile_root(AgentProvider::Claude, profile.account_id())
            .unwrap();
        let context = manager
            .capture_claude_account_execution_context_for_platform(profile.account_id(), "linux")
            .unwrap();

        fs::set_permissions(&root, fs::Permissions::from_mode(0o755)).unwrap();
        let permission_error = crate::runtime::claude::configure_claude_child_environment(
            &mut Command::new("claude"),
            &context,
        )
        .unwrap_err();
        assert!(
            permission_error.contains("permissions"),
            "{permission_error}"
        );
        fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();

        let displaced = dir.join("displaced-owned-root");
        fs::rename(&root, &displaced).unwrap();
        symlink(&displaced, &root).unwrap();
        let identity_error = crate::runtime::claude::configure_claude_child_environment(
            &mut Command::new("claude"),
            &context,
        )
        .unwrap_err();
        assert!(identity_error.contains("identity"), "{identity_error}");
        remove_dir(&dir);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn claude_account_context_windows_root_replacement_fails_before_cmd_spawn() {
        let dir = unique_temp_dir("claude-account-context-windows-root-replacement");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let profile = manager
            .create_profile_with_probe(AgentProvider::Claude, "Windows", |_| Ok(()))
            .unwrap();
        let root = manager
            .owned_profile_root(AgentProvider::Claude, profile.account_id())
            .unwrap();
        let context = manager
            .capture_claude_account_execution_context_for_platform(profile.account_id(), "windows")
            .unwrap();
        let displaced = dir.join("displaced-windows-root");
        fs::rename(&root, &displaced).unwrap();
        create_private_directory(&root).unwrap();

        let error = crate::runtime::claude::configure_claude_child_environment(
            &mut Command::new("claude.cmd"),
            &context,
        )
        .unwrap_err();

        assert!(error.contains("identity changed"), "{error}");
        remove_dir(&dir);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn claude_account_context_windows_node_child_routes_every_operation_to_exact_owned_root() {
        let dir = unique_temp_dir("claude-account-context-windows-node-routing");
        let project = dir.join("project");
        fs::create_dir(&project).unwrap();
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let profile = manager
            .create_profile_with_probe(AgentProvider::Claude, "Windows routed", |_| Ok(()))
            .unwrap();
        let root = manager
            .owned_profile_root(AgentProvider::Claude, profile.account_id())
            .unwrap();
        let context = manager
            .capture_claude_account_execution_context_for_platform(profile.account_id(), "windows")
            .unwrap();
        let fake_claude = write_windows_claude_node_shim(
            &dir,
            r#"const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const root = process.env.CLAUDE_CONFIG_DIR;
fs.appendFileSync(path.join(root, 'windows-invocations.txt'), JSON.stringify({ root, args }) + '\n');
if (args.includes('auth') && args.includes('status') && args.includes('--json')) {
  process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' }));
  process.exit(0);
}
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  if (args.includes('--input-format')) {
    process.stdout.write(JSON.stringify({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'gtum-claude-model-catalog-v1',
        response: { models: [{ value: 'windows-owned-model', resolvedModel: 'claude-owned', displayName: 'Windows owned', description: 'Owned model' }] }
      }
    }));
    return;
  }
  process.stdout.write(JSON.stringify({
    type: 'result', subtype: 'success', is_error: false,
    structured_output: {
      provider: 'claude', schemaVersion: 1, summary: 'Windows owned reply', command: '',
      preferredTarget: 'current_tab', confidence: 'high', error: null
    }
  }));
});
"#,
        );

        let validation = crate::runtime::claude::validate_claude_connection_with_context(
            &fake_claude,
            &context,
            Duration::from_secs(5),
        )
        .unwrap();
        assert_eq!(
            validation.credential_source,
            crate::runtime::claude::ClaudeCredentialSource::CliSession
        );
        let diagnostics = crate::runtime::claude::read_claude_diagnostics_with_context(
            &fake_claude,
            &context,
            Duration::from_secs(5),
        )
        .unwrap();
        assert_eq!(diagnostics.provider, AgentProvider::Claude);
        let capabilities = crate::runtime::claude::read_claude_capabilities_with_context(
            &fake_claude,
            &context,
            Duration::from_secs(5),
        )
        .unwrap();
        assert_eq!(
            capabilities.available_models[0].model_id,
            "windows-owned-model"
        );
        let request = crate::runtime::codex::RequestAgentSuggestionsRequest {
            provider: AgentProvider::Claude,
            agent_session_id: "windows-owned-session".into(),
            model: Some("windows-owned-model".into()),
            reasoning_level: None,
            fast_mode: Some(false),
            attachments: vec![],
            project_name: "project".into(),
            project_path: project.to_string_lossy().into_owned(),
            active_tab_id: None,
            active_tab_title: None,
            active_file_path: None,
            active_file_line: None,
            active_file_snippet: None,
            last_n_log_lines: vec![],
            user_task: "Use the exact Windows owned account".into(),
        };
        let attempt = crate::runtime::claude::request_claude_suggestion_attempt_with_context(
            &fake_claude,
            &context,
            request,
            Duration::from_secs(5),
            Duration::from_secs(5),
        );
        assert!(attempt.validation.is_ok());
        assert_eq!(
            attempt.suggestions.unwrap().unwrap()[0].summary,
            "Windows owned reply"
        );

        let invocations = fs::read_to_string(root.join("windows-invocations.txt")).unwrap();
        assert!(invocations.lines().count() >= 6, "{invocations}");
        for line in invocations.lines() {
            let invocation: serde_json::Value = serde_json::from_str(line).unwrap();
            assert_eq!(
                invocation["root"].as_str(),
                Some(root.to_string_lossy().as_ref()),
                "{line}"
            );
        }
        assert!(!dir.join("windows-invocations.txt").exists());
        remove_dir(&dir);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn claude_account_context_windows_concurrent_a_b_node_children_stay_isolated() {
        let dir = unique_temp_dir("claude-account-context-windows-node-concurrent");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let profile_a = manager
            .create_profile_with_probe(AgentProvider::Claude, "Windows A", |_| Ok(()))
            .unwrap();
        let profile_b = manager
            .create_profile_with_probe(AgentProvider::Claude, "Windows B", |_| Ok(()))
            .unwrap();
        let root_a = manager
            .owned_profile_root(AgentProvider::Claude, profile_a.account_id())
            .unwrap();
        let root_b = manager
            .owned_profile_root(AgentProvider::Claude, profile_b.account_id())
            .unwrap();
        let context_a = manager
            .capture_claude_account_execution_context_for_platform(
                profile_a.account_id(),
                "windows",
            )
            .unwrap();
        let context_b = manager
            .capture_claude_account_execution_context_for_platform(
                profile_b.account_id(),
                "windows",
            )
            .unwrap();
        let fake_claude = write_windows_claude_node_shim(
            &dir,
            r#"const fs = require('fs');
const path = require('path');
const root = process.env.CLAUDE_CONFIG_DIR;
setTimeout(() => {
  fs.writeFileSync(path.join(root, 'windows-concurrent-child.txt'), `config=${root}\n`);
  process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty' }));
}, 50);
"#,
        );
        let program_a = fake_claude.clone();
        let program_b = fake_claude.clone();

        let child_a = std::thread::spawn(move || {
            crate::runtime::claude::validate_claude_connection_with_context(
                &program_a,
                &context_a,
                Duration::from_secs(5),
            )
        });
        let child_b = std::thread::spawn(move || {
            crate::runtime::claude::validate_claude_connection_with_context(
                &program_b,
                &context_b,
                Duration::from_secs(5),
            )
        });

        assert!(child_a.join().unwrap().is_ok());
        assert!(child_b.join().unwrap().is_ok());
        for root in [&root_a, &root_b] {
            assert_eq!(
                fs::read_to_string(root.join("windows-concurrent-child.txt")).unwrap(),
                format!("config={}\n", root.to_string_lossy())
            );
        }
        assert_ne!(root_a, root_b);
        remove_dir(&dir);
    }

    #[test]
    fn account_owned_ipc_snapshot_serializes_every_revision_as_a_decimal_string() {
        let dir = unique_temp_dir("account-owned-ipc-snapshot-decimals");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let created = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "Work", |_| Ok(()))
            .unwrap();
        manager
            .rename_profile(AgentProvider::Codex, created.account_id(), "Renamed")
            .unwrap();

        let snapshot = serde_json::to_value(manager.read_profile_snapshot()).unwrap();

        assert_eq!(snapshot["registryVersion"], 2);
        assert_eq!(snapshot["profiles"].as_array().unwrap().len(), 3);
        for profile in snapshot["profiles"].as_array().unwrap() {
            for field in ["incarnation", "metadataRevision", "credentialRevision"] {
                let value = profile[field].as_str().expect("revision must be a string");
                assert!(
                    value.bytes().all(|byte| byte.is_ascii_digit()) && !value.starts_with('0'),
                    "{field} was not canonical: {value}"
                );
            }
        }
        assert_eq!(snapshot["tombstones"], serde_json::json!([]));
        remove_dir(&dir);
    }

    #[test]
    fn account_owned_ipc_lease_request_accepts_only_canonical_positive_u64_decimals() {
        let valid =
            serde_json::from_value::<AuthorizeAgentProfileLeaseRequest>(serde_json::json!({
                "provider": "codex",
                "accountId": "codex-default",
                "incarnation": "18446744073709551615",
                "credentialRevision": "1"
            }))
            .unwrap();
        assert_eq!(valid.incarnation.value(), u64::MAX);
        assert_eq!(valid.credential_revision.value(), 1);

        for invalid in [
            serde_json::json!(0),
            serde_json::json!(1),
            serde_json::json!(""),
            serde_json::json!("0"),
            serde_json::json!("01"),
            serde_json::json!("+1"),
            serde_json::json!("-1"),
            serde_json::json!(" 1"),
            serde_json::json!("1 "),
            serde_json::json!("18446744073709551616"),
        ] {
            let request = serde_json::json!({
                "provider": "codex",
                "accountId": "codex-default",
                "incarnation": invalid,
                "credentialRevision": "1"
            });
            assert!(serde_json::from_value::<AuthorizeAgentProfileLeaseRequest>(request).is_err());
        }
    }

    #[test]
    fn account_owned_ipc_check_request_requires_exact_owner_and_accepts_optional_scopes() {
        let request = serde_json::from_value::<CheckAgentProfileRequest>(serde_json::json!({
            "provider": "claude",
            "accountId": "claude-default",
            "requestedScopes": ["provider:request"]
        }))
        .unwrap();
        assert_eq!(request.provider, AgentProvider::Claude);
        assert_eq!(request.account_id, CLAUDE_DEFAULT_ACCOUNT_ID);
        assert_eq!(
            request.requested_scopes,
            Some(vec!["provider:request".to_string()])
        );

        for invalid in [
            serde_json::json!({"provider": "claude"}),
            serde_json::json!({"accountId": "claude-default"}),
        ] {
            assert!(serde_json::from_value::<CheckAgentProfileRequest>(invalid).is_err());
        }
    }

    #[test]
    fn account_owned_ipc_check_updates_only_the_exact_account_and_always_advances_revision() {
        let dir = unique_temp_dir("account-owned-ipc-check-exact-account");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let account_a = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "A", |_| Ok(()))
            .unwrap();
        let account_b = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "B", |_| Ok(()))
            .unwrap();
        let before_a = account_a.credential_revision();
        let before_b = account_b.credential_revision();

        let checked = manager
            .check_profile_with_validation(AgentProvider::Codex, account_a.account_id(), |_| {
                Ok(AgentProviderValidation::codex("Exact A".into()))
            })
            .unwrap();
        assert_eq!(
            checked.connection().status,
            AgentConnectionStatus::Connected
        );
        assert_eq!(checked.credential_revision(), before_a + 1);
        let checked_again = manager
            .check_profile_with_validation(AgentProvider::Codex, account_a.account_id(), |_| {
                Ok(AgentProviderValidation::codex("Exact A".into()))
            })
            .unwrap();
        assert_eq!(checked_again.credential_revision(), before_a + 2);

        let snapshot = manager.read_profile_snapshot();
        let unchanged_b = snapshot
            .profiles
            .iter()
            .find(|profile| profile.account_id == account_b.account_id())
            .unwrap();
        assert_eq!(unchanged_b.credential_revision.value(), before_b);
        assert_eq!(
            unchanged_b.connection.status,
            AgentConnectionStatus::Disconnected
        );
        remove_dir(&dir);
    }

    #[test]
    fn account_owned_ipc_disconnect_advances_an_already_disconnected_exact_account() {
        let dir = unique_temp_dir("account-owned-ipc-disconnect-revision");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let account = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "A", |_| Ok(()))
            .unwrap();

        let first = manager
            .disconnect_profile(AgentProvider::Codex, account.account_id())
            .unwrap();
        let second = manager
            .disconnect_profile(AgentProvider::Codex, account.account_id())
            .unwrap();

        assert_eq!(
            first.credential_revision(),
            account.credential_revision() + 1
        );
        assert_eq!(
            second.credential_revision(),
            account.credential_revision() + 2
        );
        assert_eq!(
            second.connection().status,
            AgentConnectionStatus::Disconnected
        );
        remove_dir(&dir);
    }

    #[test]
    fn account_owned_ipc_stale_check_suppresses_success_and_failure_before_publication() {
        let dir = unique_temp_dir("account-owned-ipc-stale-check");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let account = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "A", |_| Ok(()))
            .unwrap();

        for returns_success in [true, false] {
            let error = manager
                .check_profile_with_validation(AgentProvider::Codex, account.account_id(), |_| {
                    manager
                        .disconnect_profile(AgentProvider::Codex, account.account_id())
                        .unwrap();
                    if returns_success {
                        Ok(AgentProviderValidation::codex("stale success".into()))
                    } else {
                        Err("stale failure raw secret".to_string())
                    }
                })
                .unwrap_err();
            assert!(error.to_ascii_lowercase().contains("changed"), "{error}");
            assert!(!error.contains("raw secret"), "{error}");
        }
        remove_dir(&dir);
    }

    #[test]
    fn account_owned_ipc_check_persists_redacted_account_error_and_registry_authority() {
        let dir = unique_temp_dir("account-owned-ipc-check-redaction");
        let storage = dir.join("agent-auth.json");
        let manager = AgentAuthManager::new();
        manager.initialize_storage(storage.clone()).unwrap();

        let checked = manager
            .check_profile_with_validation(AgentProvider::Claude, CLAUDE_DEFAULT_ACCOUNT_ID, |_| {
                Err("private@example.com raw-check-secret".to_string())
            })
            .unwrap();
        assert_eq!(checked.connection().status, AgentConnectionStatus::Error);
        assert_eq!(
            checked.connection().last_error.as_deref(),
            Some(CLAUDE_VALIDATION_FAILURE)
        );

        let persisted = fs::read_to_string(storage).unwrap();
        assert!(!persisted.contains("private@example.com"));
        assert!(!persisted.contains("raw-check-secret"));
        let document: serde_json::Value = serde_json::from_str(&persisted).unwrap();
        assert_eq!(document["connections"]["claude"]["status"], "error");
        let persisted_profile = document["profileRegistry"]["profiles"]
            .as_array()
            .unwrap()
            .iter()
            .find(|profile| profile["accountId"] == CLAUDE_DEFAULT_ACCOUNT_ID)
            .unwrap();
        assert_eq!(persisted_profile["connection"]["status"], "error");
        remove_dir(&dir);
    }

    #[test]
    fn account_owned_ipc_lease_authorization_requires_exact_connected_current_tuple() {
        let dir = unique_temp_dir("account-owned-ipc-lease-authorization");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let account = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "A", |_| Ok(()))
            .unwrap();
        let disconnected = AuthorizeAgentProfileLeaseRequest {
            provider: AgentProvider::Codex,
            account_id: account.account_id().to_string(),
            incarnation: account.incarnation().into(),
            credential_revision: account.credential_revision().into(),
        };
        assert!(
            !manager
                .authorize_profile_lease(&disconnected)
                .unwrap()
                .authorized
        );

        let connected = manager
            .check_profile_with_validation(AgentProvider::Codex, account.account_id(), |_| {
                Ok(AgentProviderValidation::codex("A".into()))
            })
            .unwrap();
        let current = AuthorizeAgentProfileLeaseRequest {
            provider: AgentProvider::Codex,
            account_id: connected.account_id().to_string(),
            incarnation: connected.incarnation().into(),
            credential_revision: connected.credential_revision().into(),
        };
        let authorized = manager.authorize_profile_lease(&current).unwrap();
        assert!(authorized.authorized);
        assert_eq!(authorized.provider, current.provider);
        assert_eq!(authorized.account_id, current.account_id);
        assert_eq!(authorized.incarnation, current.incarnation);
        assert_eq!(authorized.credential_revision, current.credential_revision);
        assert!(
            !manager
                .authorize_profile_lease(&disconnected)
                .unwrap()
                .authorized
        );
        remove_dir(&dir);
    }

    #[test]
    fn account_owned_ipc_profile_operations_reject_provider_mismatch_without_fallback() {
        let dir = unique_temp_dir("account-owned-ipc-provider-mismatch");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let account = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "A", |_| Ok(()))
            .unwrap();

        let check_error = manager
            .check_profile_with_validation(AgentProvider::Claude, account.account_id(), |_| {
                panic!("mismatched account validation must not run")
            })
            .unwrap_err();
        let disconnect_error = manager
            .disconnect_profile(AgentProvider::Claude, account.account_id())
            .unwrap_err();
        for error in [check_error, disconnect_error] {
            assert!(error.contains("provider/account mismatch"), "{error}");
        }
        assert_eq!(
            manager
                .read_profile_snapshot()
                .profiles
                .iter()
                .find(|profile| profile.account_id == account.account_id())
                .unwrap()
                .credential_revision
                .value(),
            account.credential_revision()
        );
        remove_dir(&dir);
    }

    #[test]
    fn account_owned_ipc_request_validation_does_not_churn_an_unchanged_exact_account() {
        let dir = unique_temp_dir("account-owned-ipc-unchanged-request-validation");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let account = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "A", |_| Ok(()))
            .unwrap();
        let connected = manager
            .check_profile_with_validation(AgentProvider::Codex, account.account_id(), |_| {
                Ok(AgentProviderValidation::codex("A".into()))
            })
            .unwrap();
        let lease = manager
            .account_lease(AgentProvider::Codex, account.account_id())
            .unwrap();

        assert!(manager
            .apply_codex_account_validation_if_current(&lease, &Ok("A again".into()))
            .unwrap());
        let unchanged = manager
            .read_profile_snapshot()
            .profiles
            .into_iter()
            .find(|profile| profile.account_id == account.account_id())
            .unwrap();
        assert_eq!(
            unchanged.credential_revision.value(),
            connected.credential_revision()
        );
        assert_eq!(unchanged.connection, connected.connection().clone());
        remove_dir(&dir);
    }

    #[test]
    fn account_owned_ipc_changed_successful_validation_advances_revision_and_suppresses_result() {
        let dir = unique_temp_dir("account-owned-ipc-changed-success-validation");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let connected = manager
            .check_profile_with_validation(AgentProvider::Claude, CLAUDE_DEFAULT_ACCOUNT_ID, |_| {
                Ok(AgentProviderValidation::claude(
                    crate::runtime::claude::ClaudeConnectionValidation {
                        credential_source:
                            crate::runtime::claude::ClaudeCredentialSource::CliSession,
                    },
                ))
            })
            .unwrap();
        let lease = manager
            .account_lease(AgentProvider::Claude, CLAUDE_DEFAULT_ACCOUNT_ID)
            .unwrap();

        let applied = manager
            .apply_claude_account_validation_if_current(
                &lease,
                &Ok(crate::runtime::claude::ClaudeConnectionValidation {
                    credential_source:
                        crate::runtime::claude::ClaudeCredentialSource::EnvironmentApiKey,
                }),
            )
            .unwrap();

        assert!(
            !applied,
            "changed successful validation must suppress its result"
        );
        let changed = manager
            .read_profile_snapshot()
            .profiles
            .into_iter()
            .find(|profile| profile.account_id == CLAUDE_DEFAULT_ACCOUNT_ID)
            .unwrap();
        assert_eq!(
            changed.credential_revision.value(),
            connected.credential_revision() + 1
        );
        assert_eq!(
            changed.connection.credential_source.as_deref(),
            Some("anthropic_api_key")
        );
        assert!(
            !manager
                .authorize_profile_lease(&AuthorizeAgentProfileLeaseRequest {
                    provider: AgentProvider::Claude,
                    account_id: CLAUDE_DEFAULT_ACCOUNT_ID.to_string(),
                    incarnation: lease.incarnation().into(),
                    credential_revision: lease.credential_revision().into(),
                })
                .unwrap()
                .authorized
        );
        remove_dir(&dir);
    }

    #[test]
    fn account_owned_ipc_request_validation_rejects_stale_result_before_raw_failure() {
        let dir = unique_temp_dir("account-owned-ipc-stale-request-validation");
        let storage = dir.join("agent-auth.json");
        let manager = AgentAuthManager::new();
        manager.initialize_storage(storage.clone()).unwrap();
        let account = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "A", |_| Ok(()))
            .unwrap();
        let connected = manager
            .check_profile_with_validation(AgentProvider::Codex, account.account_id(), |_| {
                Ok(AgentProviderValidation::codex("A".into()))
            })
            .unwrap();
        let stale = manager
            .account_lease(AgentProvider::Codex, account.account_id())
            .unwrap();
        manager
            .disconnect_profile(AgentProvider::Codex, account.account_id())
            .unwrap();

        assert!(!manager
            .apply_codex_account_validation_if_current(
                &stale,
                &Err("private@example.com stale-request-secret".into()),
            )
            .unwrap());
        let persisted = fs::read_to_string(storage).unwrap();
        assert!(!persisted.contains("private@example.com"));
        assert!(!persisted.contains("stale-request-secret"));
        assert!(
            manager
                .read_profile_snapshot()
                .profiles
                .into_iter()
                .find(|profile| profile.account_id == connected.account_id())
                .unwrap()
                .credential_revision
                .value()
                > connected.credential_revision()
        );
        remove_dir(&dir);
    }

    #[test]
    fn account_owned_ipc_operation_lease_guards_exact_owner_and_connection_state() {
        let dir = unique_temp_dir("account-owned-ipc-operation-lease-guard");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let account = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "A", |_| Ok(()))
            .unwrap();

        let disconnected = manager
            .require_account_profile_lease(AgentProvider::Codex, account.account_id(), false)
            .unwrap();
        assert!(manager
            .require_profile_lease_current(&disconnected, false)
            .is_ok());
        assert!(manager
            .require_profile_lease_current(&disconnected, true)
            .unwrap_err()
            .contains("not connected"));

        let connected = manager
            .check_profile_with_validation(AgentProvider::Codex, account.account_id(), |_| {
                Ok(AgentProviderValidation::codex("A".into()))
            })
            .unwrap();
        let current = manager
            .require_account_profile_lease(AgentProvider::Codex, connected.account_id(), true)
            .unwrap();
        manager
            .disconnect_profile(AgentProvider::Codex, connected.account_id())
            .unwrap();
        let stale = manager
            .require_profile_lease_current(&current, true)
            .unwrap_err();
        assert!(stale.to_ascii_lowercase().contains("changed"), "{stale}");
        remove_dir(&dir);
    }

    #[test]
    fn account_owned_ipc_exact_lease_guard_rejects_stale_tuple_before_runtime_work() {
        let dir = unique_temp_dir("account-owned-ipc-exact-lease-guard");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let account = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "A", |_| Ok(()))
            .unwrap();
        let connected = manager
            .check_profile_with_validation(AgentProvider::Codex, account.account_id(), |_| {
                Ok(AgentProviderValidation::codex("A".into()))
            })
            .unwrap();

        let exact = manager
            .require_exact_account_profile_lease(
                AgentProvider::Codex,
                connected.account_id(),
                connected.incarnation(),
                connected.credential_revision(),
                true,
            )
            .unwrap();
        assert_eq!(exact.account_id(), connected.account_id());

        for (incarnation, credential_revision) in [
            (connected.incarnation() + 1, connected.credential_revision()),
            (connected.incarnation(), connected.credential_revision() + 1),
        ] {
            let error = manager
                .require_exact_account_profile_lease(
                    AgentProvider::Codex,
                    connected.account_id(),
                    incarnation,
                    credential_revision,
                    true,
                )
                .unwrap_err();
            assert!(error.to_ascii_lowercase().contains("changed"), "{error}");
        }
        remove_dir(&dir);
    }

    #[test]
    fn account_owned_ipc_forget_response_serializes_tombstone_revisions_as_strings() {
        let dir = unique_temp_dir("account-owned-ipc-forget-response");
        let manager = AgentAuthManager::new();
        manager
            .initialize_storage(dir.join("agent-auth.json"))
            .unwrap();
        let account = manager
            .create_profile_with_codex_probe(AgentProvider::Codex, "A", |_| Ok(()))
            .unwrap();
        let tombstone = manager
            .forget_profile(AgentProvider::Codex, account.account_id())
            .map(AgentProfileTombstoneResponse::from)
            .unwrap();

        let json = serde_json::to_value(tombstone).unwrap();
        assert_eq!(json["provider"], "codex");
        assert_eq!(json["accountId"], account.account_id());
        assert!(json["incarnation"].is_string());
        assert!(json["credentialRevision"].is_string());
        assert!(json["forgottenAt"].is_number());
        remove_dir(&dir);
    }
}
