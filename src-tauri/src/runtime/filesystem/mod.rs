use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
};

use serde::Serialize;

use crate::runtime::platform;

const DEFAULT_TREE_DEPTH: usize = 3;
const MAX_TREE_DEPTH: usize = 6;
const MAX_FILE_BYTES: usize = 128 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectOverview {
    pub metadata: ProjectMetadata,
    pub tree: FileTreeNode,
    pub git: GitOverview,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectMetadata {
    pub name: String,
    pub path: String,
    pub exists: bool,
    pub is_directory: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTreeNode {
    pub name: String,
    pub path: String,
    pub kind: FileNodeKind,
    pub children: Vec<FileTreeNode>,
    pub truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FileNodeKind {
    File,
    Directory,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitOverview {
    pub is_repository: bool,
    pub branch: Option<String>,
    pub branch_type: Option<String>,
    pub is_dirty: bool,
    pub changed_files_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFileSnapshot {
    pub project_path: String,
    pub file_path: String,
    pub display_path: String,
    pub exists: bool,
    pub is_text: bool,
    pub truncated: bool,
    pub size_bytes: usize,
    pub line_count: usize,
    pub content: String,
}

pub fn read_project_overview(
    path: String,
    max_depth: Option<usize>,
) -> Result<ProjectOverview, String> {
    let project_path = platform::normalize_project_path(&path)?;
    let metadata = fs::metadata(&project_path).map_err(|error| {
        format!(
            "failed to read metadata for {}: {error}",
            project_path.display()
        )
    })?;

    if !metadata.is_dir() {
        return Err(format!(
            "project path is not a directory: {}",
            project_path.display()
        ));
    }

    let depth = max_depth.unwrap_or(DEFAULT_TREE_DEPTH).min(MAX_TREE_DEPTH);
    let tree = build_tree(&project_path, depth)?;
    let git = read_git_overview(&project_path);

    Ok(ProjectOverview {
        metadata: ProjectMetadata {
            name: display_name(&project_path),
            path: project_path.to_string_lossy().into_owned(),
            exists: true,
            is_directory: true,
        },
        tree,
        git,
    })
}

pub fn read_project_file(project_path: String, file_path: String) -> Result<ProjectFileSnapshot, String> {
    let normalized_root = platform::normalize_project_path(&project_path)?;
    let canonical_root = fs::canonicalize(&normalized_root).map_err(|error| {
        format!(
            "failed to resolve project root {}: {error}",
            normalized_root.display()
        )
    })?;

    if !canonical_root.is_dir() {
        return Err(format!(
            "project path is not a directory: {}",
            canonical_root.display()
        ));
    }

    let requested_path = PathBuf::from(file_path.trim());
    let candidate_path = if requested_path.is_absolute() {
        requested_path
    } else {
        canonical_root.join(requested_path)
    };
    let canonical_file = fs::canonicalize(&candidate_path)
        .map_err(|error| format!("failed to resolve file {}: {error}", candidate_path.display()))?;

    if !canonical_file.starts_with(&canonical_root) {
        return Err("requested file is outside the active project root".into());
    }

    let metadata = fs::metadata(&canonical_file)
        .map_err(|error| format!("failed to inspect {}: {error}", canonical_file.display()))?;

    if !metadata.is_file() {
        return Err(format!(
            "requested path is not a file: {}",
            canonical_file.display()
        ));
    }

    let size_bytes = metadata.len().min(usize::MAX as u64) as usize;
    let file = File::open(&canonical_file)
        .map_err(|error| format!("failed to open {}: {error}", canonical_file.display()))?;
    let mut bytes = Vec::with_capacity(size_bytes.min(MAX_FILE_BYTES));
    file.take(MAX_FILE_BYTES as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("failed to read {}: {error}", canonical_file.display()))?;

    let truncated = size_bytes > bytes.len();
    let is_text = !looks_like_binary(&bytes);
    let content = if is_text {
        String::from_utf8_lossy(&bytes).into_owned()
    } else {
        String::new()
    };
    let line_count = if is_text {
        content.lines().count().max(usize::from(!content.is_empty()))
    } else {
        0
    };
    let display_path = canonical_file
        .strip_prefix(&canonical_root)
        .ok()
        .and_then(|value| value.to_str())
        .map(|value| value.replace('\\', "/"))
        .unwrap_or_else(|| canonical_file.to_string_lossy().into_owned());

    Ok(ProjectFileSnapshot {
        project_path: canonical_root.to_string_lossy().into_owned(),
        file_path: canonical_file.to_string_lossy().into_owned(),
        display_path,
        exists: true,
        is_text,
        truncated,
        size_bytes,
        line_count,
        content,
    })
}

fn build_tree(path: &Path, remaining_depth: usize) -> Result<FileTreeNode, String> {
    let metadata = fs::metadata(path)
        .map_err(|error| format!("failed to inspect {}: {error}", path.display()))?;
    let is_directory = metadata.is_dir();
    let mut node = FileTreeNode {
        name: display_name(path),
        path: path.to_string_lossy().into_owned(),
        kind: if is_directory {
            FileNodeKind::Directory
        } else {
            FileNodeKind::File
        },
        children: Vec::new(),
        truncated: false,
    };

    if !is_directory || remaining_depth == 0 {
        node.truncated = is_directory;
        return Ok(node);
    }

    let mut entries = fs::read_dir(path)
        .map_err(|error| format!("failed to read directory {}: {error}", path.display()))?
        .filter_map(Result::ok)
        .filter(|entry| !should_skip(entry.path().as_path()))
        .collect::<Vec<_>>();

    entries.sort_by(|left, right| {
        let left_is_dir = left
            .file_type()
            .map(|value| value.is_dir())
            .unwrap_or(false);
        let right_is_dir = right
            .file_type()
            .map(|value| value.is_dir())
            .unwrap_or(false);

        right_is_dir
            .cmp(&left_is_dir)
            .then_with(|| left.file_name().cmp(&right.file_name()))
    });

    node.children = entries
        .into_iter()
        .map(|entry| build_tree(&entry.path(), remaining_depth - 1))
        .collect::<Result<Vec<_>, _>>()?;

    Ok(node)
}

fn read_git_overview(path: &Path) -> GitOverview {
    let branch = platform::run_git(path, &["rev-parse", "--abbrev-ref", "HEAD"])
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let status_output = platform::run_git(path, &["status", "--porcelain"]).ok();
    let changed_files_count = status_output
        .as_deref()
        .map(|output| {
            output
                .lines()
                .filter(|line| !line.trim().is_empty())
                .count()
        })
        .unwrap_or(0);

    GitOverview {
        is_repository: branch.is_some(),
        branch_type: branch.as_deref().map(branch_type),
        branch,
        is_dirty: changed_files_count > 0,
        changed_files_count,
    }
}

fn branch_type(branch: &str) -> String {
    if branch == "master" {
        "master".into()
    } else if branch == "dev" {
        "dev".into()
    } else if branch.starts_with("feature/") || branch.starts_with("feature-") {
        "feature".into()
    } else if branch.starts_with("release/") || branch.starts_with("release-") {
        "release".into()
    } else if branch.starts_with("hotfix/") || branch.starts_with("hotfix-") {
        "hotfix".into()
    } else {
        "other".into()
    }
}

fn should_skip(path: &Path) -> bool {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(|name| {
            matches!(
                name,
                ".git" | "node_modules" | "target" | "dist" | ".DS_Store"
            )
        })
        .unwrap_or(false)
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|value| value.to_str())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| PathBuf::from(path).to_string_lossy().into_owned())
}

fn looks_like_binary(bytes: &[u8]) -> bool {
    bytes.iter().any(|value| *value == 0)
}
