use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Deserializer, Serialize};

const WORKSPACE_STORAGE_VERSION: u32 = 2;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    #[serde(default)]
    pub recent_projects: Vec<String>,
    #[serde(default)]
    pub open_project_paths: Vec<String>,
    #[serde(default)]
    pub active_project_path: Option<String>,
    #[serde(default)]
    pub last_opened_project_path: Option<String>,
    #[serde(default)]
    pub updated_at: u64,
    #[serde(default = "legacy_storage_version")]
    pub storage_version: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceRuntimeSnapshot {
    pub storage_path: Option<String>,
    pub snapshot: WorkspaceSnapshot,
    pub restored_at: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveWorkspaceSnapshotRequest {
    #[serde(default)]
    pub recent_projects: Vec<String>,
    #[serde(default)]
    pub open_project_paths: Vec<String>,
    #[serde(default)]
    pub active_project_path: Option<String>,
    #[serde(default, deserialize_with = "deserialize_present_nullable_path")]
    pub last_opened_project_path: Option<Option<String>>,
    #[serde(default)]
    pub updated_at: Option<u64>,
    #[serde(default)]
    pub storage_version: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RememberWorkspaceProjectRequest {
    pub path: String,
}

fn deserialize_present_nullable_path<'de, D>(
    deserializer: D,
) -> Result<Option<Option<String>>, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer).map(Some)
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceStore {
    snapshot: WorkspaceSnapshot,
}

pub struct WorkspaceStateManager {
    store: Mutex<WorkspaceStore>,
    storage_path: Mutex<Option<PathBuf>>,
    persistence_lock: Mutex<()>,
}

impl WorkspaceStateManager {
    pub fn new() -> Self {
        Self {
            store: Mutex::new(WorkspaceStore {
                snapshot: default_snapshot(),
            }),
            storage_path: Mutex::new(None),
            persistence_lock: Mutex::new(()),
        }
    }

    pub fn initialize_storage(&self, storage_path: PathBuf) -> Result<(), String> {
        if let Some(parent) = storage_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("failed to prepare workspace state directory: {error}"))?;
        }
        let _persistence = self.persistence_lock.lock().unwrap();

        let (candidate, should_persist) = if storage_path.exists() {
            match fs::read_to_string(&storage_path) {
                Ok(contents) => match load_workspace_store(&contents)? {
                    Some(loaded_store) => (loaded_store, true),
                    None => (WorkspaceStore::default(), false),
                },
                Err(error) => {
                    log::warn!("failed to read workspace state: {error}");
                    (WorkspaceStore::default(), false)
                }
            }
        } else {
            (WorkspaceStore::default(), true)
        };

        if should_persist {
            persist_store_at_path(&storage_path, &candidate)?;
        }

        *self.store.lock().unwrap() = candidate;
        *self.storage_path.lock().unwrap() = Some(storage_path);

        Ok(())
    }

    pub fn runtime_snapshot(&self) -> WorkspaceRuntimeSnapshot {
        let snapshot = self.store.lock().unwrap().snapshot.clone();
        let storage_path = self
            .storage_path
            .lock()
            .unwrap()
            .clone()
            .map(|value| value.to_string_lossy().into_owned());

        WorkspaceRuntimeSnapshot {
            storage_path,
            snapshot,
            restored_at: unix_timestamp_ms(),
        }
    }

    pub fn save_snapshot(
        &self,
        request: SaveWorkspaceSnapshotRequest,
    ) -> Result<WorkspaceSnapshot, String> {
        let SaveWorkspaceSnapshotRequest {
            recent_projects,
            open_project_paths,
            active_project_path,
            last_opened_project_path,
            updated_at,
            storage_version,
        } = request;
        let storage_version = storage_version.unwrap_or(1);
        validate_supported_storage_version(storage_version)?;
        let legacy_shape = storage_version < WORKSPACE_STORAGE_VERSION;
        let last_opened_project_path = if legacy_shape {
            last_opened_project_path.flatten()
        } else {
            last_opened_project_path.unwrap_or_else(|| active_project_path.clone())
        };
        let mut replacement = WorkspaceSnapshot {
            recent_projects,
            open_project_paths,
            active_project_path,
            last_opened_project_path,
            updated_at: updated_at.unwrap_or_else(unix_timestamp_ms),
            storage_version,
        };
        normalize_snapshot(&mut replacement, legacy_shape)?;

        self.update_and_persist(move |snapshot| {
            *snapshot = replacement;
            Ok(())
        })
    }

    pub fn open_project(&self, path: String) -> Result<WorkspaceSnapshot, String> {
        let normalized = required_project_path(path)?;

        self.update_and_persist(move |snapshot| {
            let opened_path = match snapshot
                .open_project_paths
                .iter()
                .find(|entry| same_project_identity(entry, &normalized))
            {
                Some(existing) => existing.clone(),
                None => {
                    snapshot.open_project_paths.push(normalized.clone());
                    normalized
                }
            };

            snapshot.active_project_path = Some(opened_path.clone());
            prepend_recent_project(snapshot, opened_path);
            Ok(())
        })
    }

    #[allow(dead_code)]
    pub fn activate_project(&self, path: String) -> Result<WorkspaceSnapshot, String> {
        let normalized = required_project_path(path)?;

        self.update_and_persist(move |snapshot| {
            let opened_path = snapshot
                .open_project_paths
                .iter()
                .find(|entry| same_project_identity(entry, &normalized))
                .cloned()
                .ok_or_else(|| "workspace project is not open".to_string())?;

            snapshot.active_project_path = Some(opened_path.clone());
            prepend_recent_project(snapshot, opened_path);
            Ok(())
        })
    }

    #[allow(dead_code)]
    pub fn close_project(&self, path: String) -> Result<WorkspaceSnapshot, String> {
        let normalized = required_project_path(path)?;

        self.update_and_persist(move |snapshot| {
            let removed_index = snapshot
                .open_project_paths
                .iter()
                .position(|entry| same_project_identity(entry, &normalized))
                .ok_or_else(|| "workspace project is not open".to_string())?;
            let removed_path = snapshot.open_project_paths.remove(removed_index);
            let closed_active_project = snapshot
                .active_project_path
                .as_ref()
                .is_some_and(|active| same_project_identity(active, &removed_path));

            if closed_active_project {
                snapshot.active_project_path = snapshot
                    .open_project_paths
                    .get(removed_index)
                    .or_else(|| snapshot.open_project_paths.last())
                    .cloned();
            }

            Ok(())
        })
    }

    pub fn remember_project(&self, path: String) -> Result<WorkspaceSnapshot, String> {
        self.open_project(path)
    }

    fn update_and_persist(
        &self,
        update: impl FnOnce(&mut WorkspaceSnapshot) -> Result<(), String>,
    ) -> Result<WorkspaceSnapshot, String> {
        let _persistence = self.persistence_lock.lock().unwrap();
        let storage_path = self
            .storage_path
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| "workspace storage path is not initialized".to_string())?;
        let mut published_store = self.store.lock().unwrap();
        let mut candidate = published_store.clone();

        update(&mut candidate.snapshot)?;
        candidate.snapshot.last_opened_project_path =
            candidate.snapshot.active_project_path.clone();
        normalize_snapshot(&mut candidate.snapshot, false)?;
        touch_snapshot(&mut candidate.snapshot);
        persist_store_at_path(&storage_path, &candidate)?;

        let snapshot = candidate.snapshot.clone();
        *published_store = candidate;
        Ok(snapshot)
    }
}

impl Default for WorkspaceStore {
    fn default() -> Self {
        Self {
            snapshot: default_snapshot(),
        }
    }
}

fn default_snapshot() -> WorkspaceSnapshot {
    WorkspaceSnapshot {
        recent_projects: Vec::new(),
        open_project_paths: Vec::new(),
        active_project_path: None,
        last_opened_project_path: None,
        updated_at: unix_timestamp_ms(),
        storage_version: WORKSPACE_STORAGE_VERSION,
    }
}

fn legacy_storage_version() -> u32 {
    1
}

fn load_workspace_store(contents: &str) -> Result<Option<WorkspaceStore>, String> {
    let raw_store = match serde_json::from_str::<serde_json::Value>(contents) {
        Ok(value) => value,
        Err(error) => {
            log::warn!("failed to parse workspace state: {error}");
            return Ok(None);
        }
    };
    if let Some(storage_version) = raw_store
        .pointer("/snapshot/storageVersion")
        .and_then(serde_json::Value::as_u64)
    {
        if storage_version > u64::from(WORKSPACE_STORAGE_VERSION) {
            return Err(format!(
                "unsupported workspace storage version: {storage_version}"
            ));
        }
    }
    let mut store = match serde_json::from_value::<WorkspaceStore>(raw_store.clone()) {
        Ok(store) => store,
        Err(error) => {
            log::warn!("failed to parse workspace state: {error}");
            return Ok(None);
        }
    };

    validate_supported_storage_version(store.snapshot.storage_version)?;
    let legacy_shape = store.snapshot.storage_version < WORKSPACE_STORAGE_VERSION;
    if !legacy_shape {
        validate_stored_v2_field_presence(&raw_store)?;
    }
    normalize_snapshot(&mut store.snapshot, legacy_shape)?;
    Ok(Some(store))
}

fn validate_stored_v2_field_presence(raw_store: &serde_json::Value) -> Result<(), String> {
    let snapshot = raw_store
        .get("snapshot")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| "workspace v2 store must contain a snapshot object".to_string())?;

    for field in [
        "openProjectPaths",
        "activeProjectPath",
        "lastOpenedProjectPath",
    ] {
        if !snapshot.contains_key(field) {
            return Err(format!("workspace v2 snapshot is missing {field}"));
        }
    }
    Ok(())
}

fn validate_supported_storage_version(storage_version: u32) -> Result<(), String> {
    if storage_version > WORKSPACE_STORAGE_VERSION {
        return Err(format!(
            "unsupported workspace storage version: {storage_version}"
        ));
    }
    Ok(())
}

fn persist_store_at_path(path: &Path, store: &WorkspaceStore) -> Result<(), String> {
    let serialized = serde_json::to_vec_pretty(store)
        .map_err(|error| format!("failed to serialize workspace state: {error}"))?;
    write_workspace_atomically(path, &serialized)
}

fn workspace_temporary_path(path: &Path) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("workspace storage path has no parent: {}", path.display()))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("workspace-state.json");
    Ok(parent.join(format!(".{file_name}.tmp-{}", std::process::id())))
}

fn write_workspace_atomically(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("workspace storage path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("failed to prepare workspace state directory: {error}"))?;
    let temporary = workspace_temporary_path(path)?;
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&temporary)
        .map_err(|error| format!("failed to create workspace state temp file: {error}"))?;
    if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        drop(file);
        let _ = fs::remove_file(&temporary);
        return Err(format!(
            "failed to write workspace state temp file: {error}"
        ));
    }
    drop(file);

    if let Err(error) = replace_workspace_file(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    sync_workspace_parent(parent);
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn replace_workspace_file(temporary: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(temporary, destination)
        .map_err(|error| format!("failed to replace workspace state: {error}"))
}

#[cfg(target_os = "windows")]
fn replace_workspace_file(temporary: &Path, destination: &Path) -> Result<(), String> {
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
            .map_err(|error| format!("failed to install workspace state: {error}"));
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
            "failed to atomically replace workspace state: {}",
            std::io::Error::last_os_error()
        ))
    } else {
        Ok(())
    }
}

#[cfg(unix)]
fn sync_workspace_parent(parent: &Path) {
    if let Err(error) = fs::File::open(parent).and_then(|directory| directory.sync_all()) {
        log::warn!(
            "workspace state was replaced but parent directory sync is unsupported or failed: {error}"
        );
    }
}

#[cfg(not(unix))]
fn sync_workspace_parent(_parent: &Path) {}

fn normalize_project_path(path: &str) -> Option<String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return None;
    }

    Some(
        fs::canonicalize(trimmed)
            .unwrap_or_else(|_| PathBuf::from(trimmed))
            .to_string_lossy()
            .into_owned(),
    )
}

fn required_project_path(path: String) -> Result<String, String> {
    normalize_project_path(&path).ok_or_else(|| "workspace project path cannot be empty".into())
}

fn same_project_identity(left: &str, right: &str) -> bool {
    let Some(left) = normalize_project_path(left) else {
        return false;
    };
    let Some(right) = normalize_project_path(right) else {
        return false;
    };

    #[cfg(windows)]
    {
        left.to_lowercase() == right.to_lowercase()
    }

    #[cfg(not(windows))]
    {
        left == right
    }
}

fn sanitize_project_paths(projects: Vec<String>, limit: Option<usize>) -> Vec<String> {
    let mut sanitized = Vec::new();

    for project in projects {
        let Some(normalized) = normalize_project_path(&project) else {
            continue;
        };
        if sanitized
            .iter()
            .any(|entry: &String| same_project_identity(entry, &normalized))
        {
            continue;
        }

        sanitized.push(normalized);
        if limit.is_some_and(|maximum| sanitized.len() >= maximum) {
            break;
        }
    }

    sanitized
}

fn prepend_recent_project(snapshot: &mut WorkspaceSnapshot, path: String) {
    let mut recent_projects = vec![path.clone()];
    recent_projects.extend(
        snapshot
            .recent_projects
            .iter()
            .filter(|entry| !same_project_identity(entry, &path))
            .cloned(),
    );
    snapshot.recent_projects = sanitize_project_paths(recent_projects, Some(6));
}

fn validate_v2_snapshot(snapshot: &WorkspaceSnapshot) -> Result<(), String> {
    let open_project_paths = sanitize_project_paths(snapshot.open_project_paths.clone(), None);
    let active_project_path = snapshot
        .active_project_path
        .as_deref()
        .and_then(normalize_project_path);
    let last_opened_project_path = snapshot
        .last_opened_project_path
        .as_deref()
        .and_then(normalize_project_path);

    match (open_project_paths.is_empty(), active_project_path.as_ref()) {
        (true, None) => {}
        (true, Some(_)) => return Err("active workspace project must be open".into()),
        (false, None) => return Err("an open workspace requires an active project".into()),
        (false, Some(active)) => {
            if !open_project_paths
                .iter()
                .any(|entry| same_project_identity(entry, active))
            {
                return Err("active workspace project must be open".into());
            }
        }
    }

    let alias_matches = match (
        active_project_path.as_deref(),
        last_opened_project_path.as_deref(),
    ) {
        (None, None) => true,
        (Some(active), Some(last_opened)) => same_project_identity(active, last_opened),
        _ => false,
    };
    if !alias_matches {
        return Err("last opened workspace project must match active project".into());
    }
    Ok(())
}

fn normalize_snapshot(snapshot: &mut WorkspaceSnapshot, legacy_shape: bool) -> Result<(), String> {
    validate_supported_storage_version(snapshot.storage_version)?;
    if !legacy_shape {
        validate_v2_snapshot(snapshot)?;
    }
    snapshot.recent_projects =
        sanitize_project_paths(std::mem::take(&mut snapshot.recent_projects), Some(6));

    if legacy_shape {
        let legacy_active = snapshot
            .last_opened_project_path
            .as_deref()
            .and_then(normalize_project_path);
        snapshot.open_project_paths = legacy_active.clone().into_iter().collect();
        snapshot.active_project_path = legacy_active;
    } else {
        snapshot.open_project_paths =
            sanitize_project_paths(std::mem::take(&mut snapshot.open_project_paths), None);
        snapshot.active_project_path = snapshot
            .active_project_path
            .as_deref()
            .and_then(normalize_project_path);

        if let Some(active) = snapshot.active_project_path.as_ref() {
            let opened_active = snapshot
                .open_project_paths
                .iter()
                .find(|entry| same_project_identity(entry, active))
                .cloned()
                .ok_or_else(|| "active workspace project must be open".to_string())?;
            snapshot.active_project_path = Some(opened_active);
        }
    }

    snapshot.last_opened_project_path = snapshot.active_project_path.clone();
    snapshot.storage_version = WORKSPACE_STORAGE_VERSION;
    if snapshot.updated_at == 0 {
        snapshot.updated_at = unix_timestamp_ms();
    }

    Ok(())
}

fn touch_snapshot(snapshot: &mut WorkspaceSnapshot) {
    snapshot.updated_at = unix_timestamp_ms();
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
            "gtum-workspace-{label}-{}-{}-{}",
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

    fn path_string(path: &Path) -> String {
        path.to_string_lossy().into_owned()
    }

    fn canonical_path(path: &Path) -> String {
        path_string(&fs::canonicalize(path).unwrap())
    }

    fn create_project(dir: &Path, name: &str) -> String {
        let project = dir.join(name);
        fs::create_dir_all(&project).unwrap();
        canonical_path(&project)
    }

    fn initialized_manager(label: &str) -> (WorkspaceStateManager, PathBuf, PathBuf) {
        let dir = unique_temp_dir(label);
        let storage_path = dir.join("workspace-state.json");
        let manager = WorkspaceStateManager::new();
        manager.initialize_storage(storage_path.clone()).unwrap();
        (manager, dir, storage_path)
    }

    fn expected_temporary_path(storage_path: &Path) -> PathBuf {
        let file_name = storage_path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("workspace-state.json");
        storage_path
            .parent()
            .unwrap()
            .join(format!(".{file_name}.tmp-{}", std::process::id()))
    }

    fn v2_save_request(
        recent_projects: Vec<String>,
        open_project_paths: Vec<String>,
        active_project_path: Option<String>,
    ) -> SaveWorkspaceSnapshotRequest {
        SaveWorkspaceSnapshotRequest {
            recent_projects,
            open_project_paths,
            active_project_path,
            last_opened_project_path: None,
            updated_at: Some(10),
            storage_version: Some(2),
        }
    }

    fn assert_snapshot_invariant(snapshot: &WorkspaceSnapshot) {
        assert_eq!(
            snapshot.open_project_paths.is_empty(),
            snapshot.active_project_path.is_none()
        );

        if let Some(active_project_path) = snapshot.active_project_path.as_ref() {
            assert!(snapshot
                .open_project_paths
                .iter()
                .any(|path| same_project_identity(path, active_project_path)));
        }

        assert_eq!(
            snapshot.last_opened_project_path,
            snapshot.active_project_path
        );
        assert_eq!(snapshot.storage_version, 2);
    }

    fn assert_state(
        snapshot: &WorkspaceSnapshot,
        recent: Vec<String>,
        open: Vec<String>,
        active: Option<String>,
    ) {
        assert_eq!(snapshot.recent_projects, recent);
        assert_eq!(snapshot.open_project_paths, open);
        assert_eq!(snapshot.active_project_path, active);
        assert_snapshot_invariant(snapshot);
    }

    #[test]
    fn migrates_a_v1_snapshot_and_persists_the_normalized_v2_shape() {
        assert_state(
            &WorkspaceStateManager::new().runtime_snapshot().snapshot,
            vec![],
            vec![],
            None,
        );
        let dir = unique_temp_dir("migrate-v1");
        let storage_path = dir.join("workspace-state.json");
        let active_project = create_project(&dir, "active");
        let history_project = create_project(&dir, "history");
        fs::write(
            &storage_path,
            serde_json::json!({
                "snapshot": {
                    "recentProjects": [history_project, active_project],
                    "lastOpenedProjectPath": active_project,
                    "updatedAt": 100,
                    "storageVersion": 1
                }
            })
            .to_string(),
        )
        .unwrap();

        let manager = WorkspaceStateManager::new();
        manager.initialize_storage(storage_path.clone()).unwrap();
        let migrated = manager.runtime_snapshot().snapshot;

        assert_eq!(
            migrated.recent_projects,
            vec![history_project, active_project.clone()]
        );
        assert_eq!(migrated.open_project_paths, vec![active_project.clone()]);
        assert_eq!(migrated.active_project_path, Some(active_project.clone()));
        assert_eq!(migrated.last_opened_project_path, Some(active_project));
        assert_snapshot_invariant(&migrated);

        let persisted: WorkspaceStore =
            serde_json::from_str(&fs::read_to_string(&storage_path).unwrap()).unwrap();
        assert_eq!(persisted.snapshot, migrated);

        let reloaded = WorkspaceStateManager::new();
        reloaded.initialize_storage(storage_path).unwrap();
        assert_eq!(reloaded.runtime_snapshot().snapshot, migrated);

        let empty_storage_path = dir.join("empty-workspace-state.json");
        fs::write(
            &empty_storage_path,
            r#"{"snapshot":{"recentProjects":[],"lastOpenedProjectPath":null,"updatedAt":100,"storageVersion":1}}"#,
        )
        .unwrap();
        let empty_manager = WorkspaceStateManager::new();
        empty_manager
            .initialize_storage(empty_storage_path.clone())
            .unwrap();
        let empty_snapshot = empty_manager.runtime_snapshot().snapshot;
        assert_state(&empty_snapshot, vec![], vec![], None);
        let persisted: WorkspaceStore =
            serde_json::from_str(&fs::read_to_string(empty_storage_path).unwrap()).unwrap();
        assert_eq!(persisted.snapshot, empty_snapshot);

        remove_dir(&dir);
    }

    #[test]
    fn initialization_rejects_future_storage_without_touching_bytes_or_state() {
        let dir = unique_temp_dir("future-initialize");
        for future_version in [3_u64, u64::from(u32::MAX) + 1] {
            let storage_path = dir.join(format!("workspace-state-{future_version}.json"));
            let future_bytes = serde_json::to_vec(&serde_json::json!({
                "snapshot": {
                    "recentProjects": ["future-history"],
                    "openProjectPaths": ["future-open"],
                    "activeProjectPath": "future-open",
                    "lastOpenedProjectPath": "future-open",
                    "updatedAt": 100,
                    "storageVersion": future_version
                }
            }))
            .unwrap();
            fs::write(&storage_path, &future_bytes).unwrap();
            let manager = WorkspaceStateManager::new();
            let before = manager.runtime_snapshot();

            let error = manager
                .initialize_storage(storage_path.clone())
                .unwrap_err();

            assert!(error.contains("unsupported workspace storage version"));
            assert_eq!(fs::read(storage_path).unwrap(), future_bytes);
            let after = manager.runtime_snapshot();
            assert_eq!(after.snapshot, before.snapshot);
            assert_eq!(after.storage_path, before.storage_path);
        }
        remove_dir(&dir);
    }

    #[test]
    fn save_rejects_future_storage_without_touching_bytes_or_state() {
        let (manager, dir, storage_path) = initialized_manager("future-save");
        let project = create_project(&dir, "project");
        manager.open_project(project.clone()).unwrap();
        let before_snapshot = manager.runtime_snapshot().snapshot;
        let before_bytes = fs::read(&storage_path).unwrap();
        let request = serde_json::from_value(serde_json::json!({
            "recentProjects": [project],
            "openProjectPaths": [project],
            "activeProjectPath": project,
            "lastOpenedProjectPath": project,
            "updatedAt": 100,
            "storageVersion": 3
        }))
        .unwrap();

        let error = manager.save_snapshot(request).unwrap_err();

        assert!(error.contains("unsupported workspace storage version"));
        assert_eq!(fs::read(storage_path).unwrap(), before_bytes);
        assert_eq!(manager.runtime_snapshot().snapshot, before_snapshot);
        remove_dir(&dir);
    }

    #[test]
    fn initialization_rejects_mismatched_v2_alias_before_normalizing() {
        let dir = unique_temp_dir("stored-alias-mismatch");
        let storage_path = dir.join("workspace-state.json");
        let project_a = create_project(&dir, "a");
        let project_b = create_project(&dir, "b");
        let stored_bytes = serde_json::to_vec(&serde_json::json!({
            "snapshot": {
                "recentProjects": [project_a, project_b],
                "openProjectPaths": [project_a],
                "activeProjectPath": project_a,
                "lastOpenedProjectPath": project_b,
                "updatedAt": 100,
                "storageVersion": 2
            }
        }))
        .unwrap();
        fs::write(&storage_path, &stored_bytes).unwrap();
        let manager = WorkspaceStateManager::new();
        let before = manager.runtime_snapshot();

        let error = manager
            .initialize_storage(storage_path.clone())
            .unwrap_err();

        assert!(error.contains("last opened workspace project must match active project"));
        assert_eq!(fs::read(storage_path).unwrap(), stored_bytes);
        let after = manager.runtime_snapshot();
        assert_eq!(after.snapshot, before.snapshot);
        assert_eq!(after.storage_path, before.storage_path);
        remove_dir(&dir);
    }

    #[test]
    fn initialization_requires_explicit_matching_nullable_v2_alias() {
        let dir = unique_temp_dir("stored-alias-presence");
        let project = create_project(&dir, "project");

        for (label, supplied_alias) in [("missing", None), ("null", Some(serde_json::Value::Null))]
        {
            let storage_path = dir.join(format!("{label}-workspace-state.json"));
            let mut snapshot = serde_json::json!({
                "recentProjects": [project],
                "openProjectPaths": [project],
                "activeProjectPath": project,
                "updatedAt": 100,
                "storageVersion": 2
            });
            if let Some(alias) = supplied_alias {
                snapshot
                    .as_object_mut()
                    .unwrap()
                    .insert("lastOpenedProjectPath".into(), alias);
            }
            let stored_bytes = serde_json::to_vec(&serde_json::json!({
                "snapshot": snapshot
            }))
            .unwrap();
            fs::write(&storage_path, &stored_bytes).unwrap();
            let manager = WorkspaceStateManager::new();
            let before = manager.runtime_snapshot();

            assert!(manager.initialize_storage(storage_path.clone()).is_err());
            assert_eq!(fs::read(storage_path).unwrap(), stored_bytes);
            let after = manager.runtime_snapshot();
            assert_eq!(after.snapshot, before.snapshot);
            assert_eq!(after.storage_path, before.storage_path);
        }

        remove_dir(&dir);
    }

    #[test]
    fn save_rejects_supplied_alias_mismatch_but_accepts_omission() {
        let (manager, dir, storage_path) = initialized_manager("save-alias-contract");
        let project_a = create_project(&dir, "a");
        let project_b = create_project(&dir, "b");
        manager.open_project(project_a.clone()).unwrap();
        let before_snapshot = manager.runtime_snapshot().snapshot;
        let before_bytes = fs::read(&storage_path).unwrap();

        for supplied_alias in [
            serde_json::Value::String(project_b),
            serde_json::Value::Null,
        ] {
            let request = serde_json::from_value(serde_json::json!({
                "recentProjects": [project_a],
                "openProjectPaths": [project_a],
                "activeProjectPath": project_a,
                "lastOpenedProjectPath": supplied_alias,
                "updatedAt": 100,
                "storageVersion": 2
            }))
            .unwrap();
            assert!(manager.save_snapshot(request).is_err());
            assert_eq!(fs::read(&storage_path).unwrap(), before_bytes);
            assert_eq!(manager.runtime_snapshot().snapshot, before_snapshot);
        }

        let omitted_alias_request = serde_json::from_value(serde_json::json!({
            "recentProjects": [project_a],
            "openProjectPaths": [project_a],
            "activeProjectPath": project_a,
            "updatedAt": 100,
            "storageVersion": 2
        }))
        .unwrap();
        let saved = manager.save_snapshot(omitted_alias_request).unwrap();
        assert_eq!(saved.active_project_path, Some(project_a.clone()));
        assert_eq!(saved.last_opened_project_path, Some(project_a));
        remove_dir(&dir);
    }

    #[test]
    fn opens_activates_and_closes_projects_with_round_trip_persistence() {
        let (manager, dir, storage_path) = initialized_manager("transitions");
        let project_a = create_project(&dir, "a");
        let project_b = create_project(&dir, "b");
        let project_c = create_project(&dir, "c");

        assert_state(
            &manager.remember_project(project_a.clone()).unwrap(),
            vec![project_a.clone()],
            vec![project_a.clone()],
            Some(project_a.clone()),
        );
        manager.open_project(project_b.clone()).unwrap();
        assert_state(
            &manager.activate_project(project_a.clone()).unwrap(),
            vec![project_a.clone(), project_b.clone()],
            vec![project_a.clone(), project_b.clone()],
            Some(project_a.clone()),
        );
        manager.open_project(project_c.clone()).unwrap();
        manager.activate_project(project_b.clone()).unwrap();

        let closed_inactive = manager.close_project(project_a.clone()).unwrap();
        assert_state(
            &closed_inactive,
            vec![project_b.clone(), project_c.clone(), project_a.clone()],
            vec![project_b.clone(), project_c.clone()],
            Some(project_b.clone()),
        );
        assert_eq!(
            manager
                .close_project(project_b.clone())
                .unwrap()
                .active_project_path,
            Some(project_c.clone()),
        );
        manager.open_project(project_a.clone()).unwrap();
        assert_eq!(
            manager
                .close_project(project_a.clone())
                .unwrap()
                .active_project_path,
            Some(project_c.clone()),
        );
        let closed_final = manager.close_project(project_c.clone()).unwrap();
        assert_state(
            &closed_final,
            vec![project_a, project_b, project_c],
            vec![],
            None,
        );

        let reloaded = WorkspaceStateManager::new();
        reloaded.initialize_storage(storage_path).unwrap();
        assert_eq!(reloaded.runtime_snapshot().snapshot, closed_final);

        remove_dir(&dir);
    }

    #[test]
    fn rejects_invalid_transitions_and_failed_persistence_without_publishing_state() {
        let (manager, dir, storage_path) = initialized_manager("reject-transitions");
        let project_a = create_project(&dir, "a");
        let unopened = create_project(&dir, "unopened");
        manager.open_project(project_a).unwrap();
        let before = manager.runtime_snapshot().snapshot;

        assert!(manager.open_project("  ".into()).is_err());
        assert!(manager.activate_project(unopened.clone()).is_err());
        assert!(manager.close_project(unopened).is_err());
        assert_eq!(manager.runtime_snapshot().snapshot, before);

        let before_bytes = fs::read(&storage_path).unwrap();
        let blocked_temporary_path = expected_temporary_path(&storage_path);
        fs::create_dir(&blocked_temporary_path).unwrap();
        assert!(manager.open_project("unpersisted-project".into()).is_err());
        assert_eq!(fs::read(&storage_path).unwrap(), before_bytes);
        assert_eq!(manager.runtime_snapshot().snapshot, before);

        remove_dir(&dir);
    }

    #[test]
    fn sanitizes_blank_and_duplicate_paths_while_preserving_open_order_and_recent_cap() {
        let (manager, dir, _) = initialized_manager("sanitize");
        let projects: Vec<String> = (0..8)
            .map(|index| create_project(&dir, &format!("project-{index}")))
            .collect();
        let mut recent_projects = vec![
            "  ".into(),
            format!(" {} ", projects[0]),
            projects[0].clone(),
        ];
        recent_projects.extend(projects.iter().skip(1).cloned());

        let saved = manager
            .save_snapshot(SaveWorkspaceSnapshotRequest {
                recent_projects,
                open_project_paths: vec![
                    "".into(),
                    projects[0].clone(),
                    format!(" {} ", projects[0]),
                    projects[1].clone(),
                ],
                active_project_path: Some(format!(" {} ", projects[1])),
                last_opened_project_path: Some(Some(projects[1].clone())),
                updated_at: Some(1),
                storage_version: Some(2),
            })
            .unwrap();

        assert_eq!(saved.recent_projects, projects[..6]);
        assert_eq!(
            saved.open_project_paths,
            vec![projects[0].clone(), projects[1].clone()]
        );
        assert_eq!(saved.active_project_path, Some(projects[1].clone()));
        assert_eq!(saved.last_opened_project_path, saved.active_project_path);
        assert_snapshot_invariant(&saved);

        let invalid_requests = [
            v2_save_request(
                vec![projects[0].clone()],
                vec![projects[0].clone()],
                Some(projects[1].clone()),
            ),
            v2_save_request(vec![], vec![projects[0].clone()], None),
            v2_save_request(vec![], vec![], Some(projects[0].clone())),
        ];
        for request in invalid_requests {
            assert!(manager.save_snapshot(request).is_err());
            assert_eq!(manager.runtime_snapshot().snapshot, saved);
        }

        let legacy_saved = manager
            .save_snapshot(SaveWorkspaceSnapshotRequest {
                recent_projects: vec![projects[0].clone()],
                open_project_paths: vec![],
                active_project_path: None,
                last_opened_project_path: Some(Some(projects[0].clone())),
                updated_at: None,
                storage_version: None,
            })
            .unwrap();
        assert_state(
            &legacy_saved,
            vec![projects[0].clone()],
            vec![projects[0].clone()],
            Some(projects[0].clone()),
        );

        let v2_saved = manager
            .save_snapshot(SaveWorkspaceSnapshotRequest {
                recent_projects: vec![projects[0].clone()],
                open_project_paths: vec![],
                active_project_path: None,
                last_opened_project_path: None,
                updated_at: None,
                storage_version: Some(2),
            })
            .unwrap();
        assert_state(&v2_saved, vec![projects[0].clone()], vec![], None);

        remove_dir(&dir);
    }

    #[test]
    fn canonicalizes_existing_paths_and_deduplicates_symlink_identities_when_supported() {
        let (manager, dir, _) = initialized_manager("canonical-identity");
        let project_dir = dir.join("project");
        fs::create_dir_all(&project_dir).unwrap();
        let canonical_project = canonical_path(&project_dir);
        let dotted_project = project_dir.join(".");

        manager.open_project(path_string(&dotted_project)).unwrap();
        assert_eq!(
            manager.runtime_snapshot().snapshot.open_project_paths,
            vec![canonical_project.clone()]
        );

        let symlink_path = dir.join("project-link");
        #[cfg(unix)]
        let symlink_result = std::os::unix::fs::symlink(&project_dir, &symlink_path);
        #[cfg(windows)]
        let symlink_result = std::os::windows::fs::symlink_dir(&project_dir, &symlink_path);

        if symlink_result.is_ok() {
            manager.open_project(path_string(&symlink_path)).unwrap();
            let snapshot = manager.runtime_snapshot().snapshot;
            assert_eq!(snapshot.open_project_paths, vec![canonical_project.clone()]);
            assert_eq!(snapshot.active_project_path, Some(canonical_project));
        }

        remove_dir(&dir);
    }

    #[cfg(windows)]
    #[test]
    fn compares_nonexistent_windows_paths_case_insensitively() {
        let (manager, dir, _) = initialized_manager("windows-case-identity");
        manager
            .open_project(r"C:\GTUM\Workspace\Project".into())
            .unwrap();
        manager
            .open_project(r"c:\gtum\workspace\project".into())
            .unwrap();
        let snapshot = manager.runtime_snapshot().snapshot;

        assert_eq!(snapshot.open_project_paths.len(), 1);
        assert_eq!(snapshot.recent_projects.len(), 1);

        remove_dir(&dir);
    }
}
