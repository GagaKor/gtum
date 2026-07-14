use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

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
    #[serde(default)]
    pub last_opened_project_path: Option<String>,
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

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceStore {
    snapshot: WorkspaceSnapshot,
}

pub struct WorkspaceStateManager {
    store: Mutex<WorkspaceStore>,
    storage_path: Mutex<Option<PathBuf>>,
}

impl WorkspaceStateManager {
    pub fn new() -> Self {
        Self {
            store: Mutex::new(WorkspaceStore {
                snapshot: default_snapshot(),
            }),
            storage_path: Mutex::new(None),
        }
    }

    pub fn initialize_storage(&self, storage_path: PathBuf) -> Result<(), String> {
        if let Some(parent) = storage_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("failed to prepare workspace state directory: {error}"))?;
        }

        let (candidate, should_persist) = if storage_path.exists() {
            match fs::read_to_string(&storage_path) {
                Ok(contents) => match serde_json::from_str::<WorkspaceStore>(&contents) {
                    Ok(mut loaded_store) => {
                        let legacy_shape = loaded_store.snapshot.storage_version < 2;
                        normalize_snapshot(&mut loaded_store.snapshot, legacy_shape)?;
                        (loaded_store, true)
                    }
                    Err(error) => {
                        log::warn!("failed to parse workspace state: {error}");
                        (WorkspaceStore::default(), false)
                    }
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
        let legacy_shape = request.storage_version.unwrap_or(1) < 2;
        let mut replacement = WorkspaceSnapshot {
            recent_projects: request.recent_projects,
            open_project_paths: request.open_project_paths,
            active_project_path: request.active_project_path,
            last_opened_project_path: request.last_opened_project_path,
            updated_at: request.updated_at.unwrap_or_else(unix_timestamp_ms),
            storage_version: request.storage_version.unwrap_or(1),
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
        let storage_path = self
            .storage_path
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| "workspace storage path is not initialized".to_string())?;
        let mut published_store = self.store.lock().unwrap();
        let mut candidate = published_store.clone();

        update(&mut candidate.snapshot)?;
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
        storage_version: 2,
    }
}

fn legacy_storage_version() -> u32 {
    1
}

fn persist_store_at_path(path: &Path, store: &WorkspaceStore) -> Result<(), String> {
    let serialized = serde_json::to_string_pretty(store)
        .map_err(|error| format!("failed to serialize workspace state: {error}"))?;
    fs::write(path, serialized)
        .map_err(|error| format!("failed to persist workspace state: {error}"))
}

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

fn normalize_snapshot(snapshot: &mut WorkspaceSnapshot, legacy_shape: bool) -> Result<(), String> {
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

        match (
            snapshot.open_project_paths.is_empty(),
            snapshot.active_project_path.as_ref(),
        ) {
            (true, None) => {}
            (true, Some(_)) => {
                return Err("active workspace project must be open".into());
            }
            (false, None) => {
                return Err("an open workspace requires an active project".into());
            }
            (false, Some(active)) => {
                let opened_active = snapshot
                    .open_project_paths
                    .iter()
                    .find(|entry| same_project_identity(entry, active))
                    .cloned()
                    .ok_or_else(|| "active workspace project must be open".to_string())?;
                snapshot.active_project_path = Some(opened_active);
            }
        }
    }

    snapshot.last_opened_project_path = snapshot.active_project_path.clone();
    snapshot.storage_version = 2;
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

        fs::remove_file(&storage_path).unwrap();
        fs::create_dir(&storage_path).unwrap();
        assert!(manager.open_project("unpersisted-project".into()).is_err());
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
                last_opened_project_path: Some(projects[0].clone()),
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
                last_opened_project_path: Some(projects[0].clone()),
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
                last_opened_project_path: Some(projects[0].clone()),
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
