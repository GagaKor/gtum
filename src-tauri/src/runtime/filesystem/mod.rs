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
const MAX_SEARCH_FILE_BYTES: usize = 128 * 1024;
const MAX_SEARCH_RESULTS: usize = 24;
const MAX_MATCHES_PER_FILE: usize = 6;

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

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSearchMatch {
    pub line_number: usize,
    pub line_text: String,
    pub start_column: usize,
    pub end_column: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSearchResult {
    pub file_path: String,
    pub display_path: String,
    pub matches: Vec<ProjectSearchMatch>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceControlFileEntry {
    pub path: String,
    pub display_path: String,
    pub staged_status: Option<String>,
    pub unstaged_status: Option<String>,
    pub summary: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceControlOverview {
    pub is_repository: bool,
    pub branch: Option<String>,
    pub ahead_count: usize,
    pub behind_count: usize,
    pub staged: Vec<SourceControlFileEntry>,
    pub unstaged: Vec<SourceControlFileEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceControlDiff {
    pub file_path: String,
    pub display_path: String,
    pub staged: bool,
    pub diff: String,
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

pub fn search_project_text(project_path: String, query: String) -> Result<Vec<ProjectSearchResult>, String> {
    let trimmed_query = query.trim();
    if trimmed_query.is_empty() {
        return Ok(Vec::new());
    }

    let project_root = canonical_project_root(&project_path)?;
    let needle = trimmed_query.to_lowercase();
    let mut results = Vec::new();
    collect_search_results(&project_root, &project_root, &needle, &mut results)?;
    Ok(results)
}

pub fn read_source_control_overview(project_path: String) -> Result<SourceControlOverview, String> {
    let project_root = canonical_project_root(&project_path)?;
    Ok(build_source_control_overview(&project_root))
}

pub fn read_source_control_diff(
    project_path: String,
    file_path: String,
    staged: Option<bool>,
) -> Result<SourceControlDiff, String> {
    let project_root = canonical_project_root(&project_path)?;
    let overview = build_source_control_overview(&project_root);
    if !overview.is_repository {
        return Err("git repository not detected for the active project".into());
    }

    let relative_path = resolve_git_relative_path(&project_root, &file_path)?;
    let absolute_path = project_root.join(&relative_path);
    let staged = staged.unwrap_or(false);
    let mut args = vec!["diff"];

    if staged {
        args.push("--cached");
    }

    args.push("--");
    args.push(relative_path.as_str());

    let diff = platform::run_git(&project_root, &args)?;

    Ok(SourceControlDiff {
        file_path: absolute_path.to_string_lossy().into_owned(),
        display_path: normalize_display_path(&relative_path),
        staged,
        diff: if diff.trim().is_empty() {
            "No diff available for this file in the selected mode.".into()
        } else {
            diff
        },
    })
}

pub fn stage_source_control_file(
    project_path: String,
    file_path: String,
) -> Result<SourceControlOverview, String> {
    let project_root = canonical_project_root(&project_path)?;
    ensure_git_repository(&project_root)?;
    let relative_path = resolve_git_relative_path(&project_root, &file_path)?;
    platform::run_git(&project_root, &["add", "--", relative_path.as_str()])?;
    Ok(build_source_control_overview(&project_root))
}

pub fn unstage_source_control_file(
    project_path: String,
    file_path: String,
) -> Result<SourceControlOverview, String> {
    let project_root = canonical_project_root(&project_path)?;
    ensure_git_repository(&project_root)?;
    let relative_path = resolve_git_relative_path(&project_root, &file_path)?;
    platform::run_git(
        &project_root,
        &["restore", "--staged", "--", relative_path.as_str()],
    )?;
    Ok(build_source_control_overview(&project_root))
}

pub fn commit_source_control(
    project_path: String,
    message: String,
) -> Result<SourceControlOverview, String> {
    let project_root = canonical_project_root(&project_path)?;
    ensure_git_repository(&project_root)?;
    let trimmed_message = message.trim();

    if trimmed_message.is_empty() {
        return Err("commit message cannot be empty".into());
    }

    platform::run_git(&project_root, &["commit", "-m", trimmed_message])?;
    Ok(build_source_control_overview(&project_root))
}

pub fn push_source_control(project_path: String) -> Result<SourceControlOverview, String> {
    let project_root = canonical_project_root(&project_path)?;
    ensure_git_repository(&project_root)?;
    platform::run_git(&project_root, &["push"])?;
    Ok(build_source_control_overview(&project_root))
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

fn collect_search_results(
    project_root: &Path,
    path: &Path,
    needle: &str,
    results: &mut Vec<ProjectSearchResult>,
) -> Result<(), String> {
    if results.len() >= MAX_SEARCH_RESULTS {
        return Ok(());
    }

    let metadata = fs::metadata(path)
        .map_err(|error| format!("failed to inspect {}: {error}", path.display()))?;

    if metadata.is_dir() {
        let mut entries = fs::read_dir(path)
            .map_err(|error| format!("failed to read directory {}: {error}", path.display()))?
            .filter_map(Result::ok)
            .filter(|entry| !should_skip(entry.path().as_path()))
            .collect::<Vec<_>>();

        entries.sort_by(|left, right| left.file_name().cmp(&right.file_name()));

        for entry in entries {
            collect_search_results(project_root, &entry.path(), needle, results)?;
            if results.len() >= MAX_SEARCH_RESULTS {
                break;
            }
        }

        return Ok(());
    }

    if metadata.len() > MAX_SEARCH_FILE_BYTES as u64 {
        return Ok(());
    }

    let bytes = fs::read(path)
        .map_err(|error| format!("failed to read {}: {error}", path.display()))?;

    if looks_like_binary(&bytes) {
        return Ok(());
    }

    let content = String::from_utf8_lossy(&bytes).into_owned();
    let matches = content
        .lines()
        .enumerate()
        .filter_map(|(index, line)| {
            let lowered = line.to_lowercase();
            lowered.find(needle).map(|start_column| ProjectSearchMatch {
                line_number: index + 1,
                line_text: line.to_string(),
                start_column,
                end_column: start_column + needle.len(),
            })
        })
        .take(MAX_MATCHES_PER_FILE)
        .collect::<Vec<_>>();

    if matches.is_empty() {
        return Ok(());
    }

    let display_path = path
        .strip_prefix(project_root)
        .ok()
        .and_then(|value| value.to_str())
        .map(normalize_display_path)
        .unwrap_or_else(|| path.to_string_lossy().into_owned());

    results.push(ProjectSearchResult {
        file_path: path.to_string_lossy().into_owned(),
        display_path,
        matches,
    });

    Ok(())
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

fn build_source_control_overview(path: &Path) -> SourceControlOverview {
    let status_output = match platform::run_git(path, &["status", "--porcelain=1", "--branch"]) {
        Ok(output) => output,
        Err(_) => {
            return SourceControlOverview {
                is_repository: false,
                branch: None,
                ahead_count: 0,
                behind_count: 0,
                staged: Vec::new(),
                unstaged: Vec::new(),
            }
        }
    };

    let mut branch = None;
    let mut ahead_count = 0usize;
    let mut behind_count = 0usize;
    let mut staged = Vec::new();
    let mut unstaged = Vec::new();

    for line in status_output.lines() {
        if let Some(branch_line) = line.strip_prefix("## ") {
            let (next_branch, ahead, behind) = parse_git_branch_line(branch_line);
            branch = next_branch;
            ahead_count = ahead;
            behind_count = behind;
            continue;
        }

        if line.trim().is_empty() || line.len() < 3 {
            continue;
        }

        if let Some(path_str) = line.strip_prefix("?? ") {
            let display_path = normalize_display_path(path_str.trim());
            unstaged.push(SourceControlFileEntry {
                path: path.join(&display_path).to_string_lossy().into_owned(),
                display_path,
                staged_status: None,
                unstaged_status: Some("untracked".into()),
                summary: "untracked".into(),
            });
            continue;
        }

        let bytes = line.as_bytes();
        let staged_code = bytes[0] as char;
        let unstaged_code = bytes[1] as char;
        let display_path = normalize_display_path(&parse_status_path(&line[3..]));
        let entry = SourceControlFileEntry {
            path: path.join(&display_path).to_string_lossy().into_owned(),
            display_path,
            staged_status: status_code_label(staged_code),
            unstaged_status: status_code_label(unstaged_code),
            summary: status_summary(staged_code, unstaged_code),
        };

        if entry.staged_status.is_some() {
            staged.push(entry.clone());
        }

        if entry.unstaged_status.is_some() {
            unstaged.push(entry);
        }
    }

    SourceControlOverview {
        is_repository: true,
        branch,
        ahead_count,
        behind_count,
        staged,
        unstaged,
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

fn canonical_project_root(path: &str) -> Result<PathBuf, String> {
    let normalized_root = platform::normalize_project_path(path)?;
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

    Ok(canonical_root)
}

fn ensure_git_repository(path: &Path) -> Result<(), String> {
    if build_source_control_overview(path).is_repository {
        Ok(())
    } else {
        Err("git repository not detected for the active project".into())
    }
}

fn resolve_git_relative_path(project_root: &Path, file_path: &str) -> Result<String, String> {
    let trimmed = file_path.trim();
    if trimmed.is_empty() {
        return Err("file path cannot be empty".into());
    }

    let requested_path = PathBuf::from(trimmed);
    let relative_path = if requested_path.is_absolute() {
        requested_path
            .strip_prefix(project_root)
            .map_err(|_| "requested file is outside the active project root".to_string())?
            .to_path_buf()
    } else {
        requested_path
    };

    Ok(normalize_display_path(relative_path.to_string_lossy().as_ref()))
}

fn parse_git_branch_line(line: &str) -> (Option<String>, usize, usize) {
    let branch_name = line
        .split("...")
        .next()
        .unwrap_or(line)
        .trim()
        .strip_prefix("No commits yet on ")
        .unwrap_or_else(|| line.split("...").next().unwrap_or(line).trim())
        .to_string();

    let branch = if branch_name.is_empty() || branch_name == "HEAD (no branch)" {
        None
    } else {
        Some(branch_name)
    };

    let mut ahead = 0usize;
    let mut behind = 0usize;

    if let (Some(start), Some(end)) = (line.find('['), line.find(']')) {
        for segment in line[start + 1..end].split(',') {
            let trimmed = segment.trim();
            if let Some(value) = trimmed.strip_prefix("ahead ") {
                ahead = value.parse().unwrap_or(0);
            } else if let Some(value) = trimmed.strip_prefix("behind ") {
                behind = value.parse().unwrap_or(0);
            }
        }
    }

    (branch, ahead, behind)
}

fn parse_status_path(value: &str) -> String {
    value
        .split(" -> ")
        .last()
        .unwrap_or(value)
        .trim()
        .to_string()
}

fn status_code_label(code: char) -> Option<String> {
    match code {
        'M' => Some("modified".into()),
        'A' => Some("added".into()),
        'D' => Some("deleted".into()),
        'R' => Some("renamed".into()),
        'C' => Some("copied".into()),
        'U' => Some("conflict".into()),
        _ => None,
    }
}

fn status_summary(staged_code: char, unstaged_code: char) -> String {
    match (status_code_label(staged_code), status_code_label(unstaged_code)) {
        (Some(staged), Some(unstaged)) => format!("staged {staged}, working tree {unstaged}"),
        (Some(staged), None) => format!("staged {staged}"),
        (None, Some(unstaged)) => format!("working tree {unstaged}"),
        (None, None) => "unknown".into(),
    }
}

fn normalize_display_path(value: &str) -> String {
    value.replace('\\', "/")
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
