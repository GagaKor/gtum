use std::{
    fs,
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshot {
    pub recent_projects: Vec<String>,
    pub last_opened_project_path: Option<String>,
    pub updated_at: u64,
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
    pub recent_projects: Vec<String>,
    pub last_opened_project_path: Option<String>,
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

        {
            let mut slot = self.storage_path.lock().unwrap();
            *slot = Some(storage_path.clone());
        }

        if storage_path.exists() {
            match fs::read_to_string(&storage_path) {
                Ok(contents) => match serde_json::from_str::<WorkspaceStore>(&contents) {
                    Ok(mut loaded_store) => {
                        normalize_snapshot(&mut loaded_store.snapshot);
                        *self.store.lock().unwrap() = loaded_store;
                    }
                    Err(error) => {
                        log::warn!("failed to parse workspace state: {error}");
                    }
                },
                Err(error) => {
                    log::warn!("failed to read workspace state: {error}");
                }
            }
        } else {
            self.persist()?;
        }

        Ok(())
    }

    pub fn runtime_snapshot(&self) -> WorkspaceRuntimeSnapshot {
        let store = self.store.lock().unwrap();
        WorkspaceRuntimeSnapshot {
            storage_path: self
                .storage_path
                .lock()
                .unwrap()
                .clone()
                .map(|value| value.to_string_lossy().into_owned()),
            snapshot: store.snapshot.clone(),
            restored_at: unix_timestamp_ms(),
        }
    }

    pub fn save_snapshot(
        &self,
        request: SaveWorkspaceSnapshotRequest,
    ) -> Result<WorkspaceSnapshot, String> {
        let mut store = self.store.lock().unwrap();
        store.snapshot.recent_projects = sanitize_recent_projects(request.recent_projects);
        store.snapshot.last_opened_project_path = request
            .last_opened_project_path
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        touch_snapshot(&mut store.snapshot);
        normalize_snapshot(&mut store.snapshot);
        self.persist_locked(&store)?;
        Ok(store.snapshot.clone())
    }

    pub fn remember_project(&self, path: String) -> Result<WorkspaceSnapshot, String> {
        let normalized = path.trim().to_string();
        if normalized.is_empty() {
            return Err("workspace project path cannot be empty".into());
        }

        let mut store = self.store.lock().unwrap();
        let mut recent_projects = vec![normalized.clone()];
        recent_projects.extend(
            store
                .snapshot
                .recent_projects
                .iter()
                .filter(|entry| **entry != normalized)
                .cloned(),
        );
        store.snapshot.recent_projects = recent_projects;
        store.snapshot.last_opened_project_path = Some(normalized);
        touch_snapshot(&mut store.snapshot);
        normalize_snapshot(&mut store.snapshot);
        self.persist_locked(&store)?;
        Ok(store.snapshot.clone())
    }

    fn persist(&self) -> Result<(), String> {
        let store = self.store.lock().unwrap();
        self.persist_locked(&store)
    }

    fn persist_locked(&self, store: &WorkspaceStore) -> Result<(), String> {
        let path = self
            .storage_path
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| "workspace storage path is not initialized".to_string())?;

        let serialized = serde_json::to_string_pretty(store)
            .map_err(|error| format!("failed to serialize workspace state: {error}"))?;
        fs::write(path, serialized)
            .map_err(|error| format!("failed to persist workspace state: {error}"))
    }
}

fn default_snapshot() -> WorkspaceSnapshot {
    WorkspaceSnapshot {
        recent_projects: Vec::new(),
        last_opened_project_path: None,
        updated_at: unix_timestamp_ms(),
        storage_version: 1,
    }
}

fn sanitize_recent_projects(projects: Vec<String>) -> Vec<String> {
    let mut sanitized = Vec::new();

    for project in projects.into_iter().map(|path| path.trim().to_string()) {
        if project.is_empty() || sanitized.iter().any(|entry: &String| entry == &project) {
            continue;
        }

        sanitized.push(project);
        if sanitized.len() >= 6 {
            break;
        }
    }

    sanitized
}

fn normalize_snapshot(snapshot: &mut WorkspaceSnapshot) {
    snapshot.recent_projects = sanitize_recent_projects(snapshot.recent_projects.clone());
    snapshot.last_opened_project_path = snapshot
        .last_opened_project_path
        .clone()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if snapshot.storage_version == 0 {
        snapshot.storage_version = 1;
    }
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
