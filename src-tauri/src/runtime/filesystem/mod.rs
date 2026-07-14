use std::{
    collections::HashSet,
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use crate::runtime::platform;

const DEFAULT_TREE_DEPTH: usize = 3;
const MAX_TREE_DEPTH: usize = 6;
const MAX_FILE_BYTES: usize = 128 * 1024;
const MAX_WRITE_FILE_BYTES: usize = 2 * 1024 * 1024;
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
    pub content_hash: String,
    pub content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteProjectFileRequest {
    pub project_path: String,
    pub file_path: String,
    pub content: String,
    pub expected_content_hash: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyProjectPatchRequest {
    pub project_path: String,
    pub edits: Vec<ProjectFilePatchEdit>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFilePatchEdit {
    pub file_path: String,
    pub content: String,
    pub expected_content_hash: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyProjectPatchResult {
    pub applied_files: Vec<ProjectFileSnapshot>,
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
    let project_path = canonical_project_root(&path)?;
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

pub fn read_project_file(
    project_path: String,
    file_path: String,
) -> Result<ProjectFileSnapshot, String> {
    let canonical_root = canonical_project_root(&project_path)?;
    let canonical_file = resolve_project_file_path(&canonical_root, &file_path, true)?;
    read_project_file_snapshot(&canonical_root, &canonical_file)
}

pub fn write_project_file(request: WriteProjectFileRequest) -> Result<ProjectFileSnapshot, String> {
    let canonical_root = canonical_project_root(&request.project_path)?;
    write_project_file_content(
        &canonical_root,
        &request.file_path,
        request.content,
        request.expected_content_hash.as_deref(),
    )
}

pub fn apply_project_patch(
    request: ApplyProjectPatchRequest,
) -> Result<ApplyProjectPatchResult, String> {
    let canonical_root = canonical_project_root(&request.project_path)?;
    if request.edits.is_empty() {
        return Err("patch must include at least one file edit".into());
    }

    let mut seen_files = HashSet::new();
    let mut planned_edits = Vec::new();
    for edit in request.edits {
        let canonical_file = resolve_project_file_path(&canonical_root, &edit.file_path, false)?;
        if !seen_files.insert(canonical_file.clone()) {
            return Err(format!(
                "patch contains duplicate file edit: {}",
                canonical_file.display()
            ));
        }
        validate_project_file_write(
            &canonical_file,
            &edit.content,
            edit.expected_content_hash.as_deref(),
        )?;
        planned_edits.push((canonical_file, edit.content));
    }

    let mut applied_files = Vec::new();
    for (canonical_file, content) in planned_edits {
        fs::write(&canonical_file, content.as_bytes())
            .map_err(|error| format!("failed to write {}: {error}", canonical_file.display()))?;
        let snapshot = read_project_file_snapshot(&canonical_root, &canonical_file)?;
        applied_files.push(snapshot);
    }

    Ok(ApplyProjectPatchResult { applied_files })
}

pub fn search_project_text(
    project_path: String,
    query: String,
) -> Result<Vec<ProjectSearchResult>, String> {
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

    let bytes =
        fs::read(path).map_err(|error| format!("failed to read {}: {error}", path.display()))?;

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

fn resolve_project_file_path(
    project_root: &Path,
    file_path: &str,
    must_exist: bool,
) -> Result<PathBuf, String> {
    let trimmed = file_path.trim();
    if trimmed.is_empty() {
        return Err("file path cannot be empty".into());
    }

    let requested_path = PathBuf::from(trimmed);
    let candidate_path = if requested_path.is_absolute() {
        requested_path
    } else {
        project_root.join(requested_path)
    };

    if must_exist || candidate_path.exists() {
        let canonical_file = fs::canonicalize(&candidate_path).map_err(|error| {
            format!(
                "failed to resolve file {}: {error}",
                candidate_path.display()
            )
        })?;
        if !canonical_file.starts_with(project_root) {
            return Err("requested file is outside the active project root".into());
        }
        return Ok(canonical_file);
    }

    let parent = candidate_path
        .parent()
        .ok_or_else(|| "file path must include a parent directory".to_string())?;
    let canonical_parent = fs::canonicalize(parent).map_err(|error| {
        format!(
            "failed to resolve parent directory {}: {error}",
            parent.display()
        )
    })?;
    if !canonical_parent.starts_with(project_root) {
        return Err("requested file is outside the active project root".into());
    }

    let file_name = candidate_path
        .file_name()
        .ok_or_else(|| "file path must include a file name".to_string())?;
    Ok(canonical_parent.join(file_name))
}

fn read_project_file_snapshot(
    canonical_root: &Path,
    canonical_file: &Path,
) -> Result<ProjectFileSnapshot, String> {
    let metadata = fs::metadata(canonical_file)
        .map_err(|error| format!("failed to inspect {}: {error}", canonical_file.display()))?;

    if !metadata.is_file() {
        return Err(format!(
            "requested path is not a file: {}",
            canonical_file.display()
        ));
    }

    let size_bytes = metadata.len().min(usize::MAX as u64) as usize;
    let file = File::open(canonical_file)
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
        content
            .lines()
            .count()
            .max(usize::from(!content.is_empty()))
    } else {
        0
    };
    let display_path = canonical_file
        .strip_prefix(canonical_root)
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
        content_hash: content_hash_hex(&bytes),
        content,
    })
}

fn write_project_file_content(
    canonical_root: &Path,
    file_path: &str,
    content: String,
    expected_content_hash: Option<&str>,
) -> Result<ProjectFileSnapshot, String> {
    let canonical_file = resolve_project_file_path(canonical_root, file_path, false)?;
    validate_project_file_write(&canonical_file, &content, expected_content_hash)?;

    fs::write(&canonical_file, content.as_bytes())
        .map_err(|error| format!("failed to write {}: {error}", canonical_file.display()))?;
    read_project_file_snapshot(canonical_root, &canonical_file)
}

fn validate_project_file_write(
    canonical_file: &Path,
    content: &str,
    expected_content_hash: Option<&str>,
) -> Result<(), String> {
    if content.len() > MAX_WRITE_FILE_BYTES {
        return Err(format!(
            "file content exceeds the write limit of {} bytes",
            MAX_WRITE_FILE_BYTES
        ));
    }

    if let Some(expected_hash) = expected_content_hash.filter(|value| !value.trim().is_empty()) {
        if canonical_file.exists() {
            let current_bytes = fs::read(&canonical_file).map_err(|error| {
                format!(
                    "failed to read {} before writing: {error}",
                    canonical_file.display()
                )
            })?;
            if looks_like_binary(&current_bytes) {
                return Err("cannot overwrite binary files through the text editor".into());
            }
            let current_hash = content_hash_hex(&current_bytes);
            if current_hash != expected_hash {
                return Err("file changed on disk; reload before saving".into());
            }
        }
    }

    Ok(())
}

fn content_hash_hex(bytes: &[u8]) -> String {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
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

    Ok(normalize_display_path(
        relative_path.to_string_lossy().as_ref(),
    ))
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
    match (
        status_code_label(staged_code),
        status_code_label(unstaged_code),
    ) {
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

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::*;

    fn temp_project_dir(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("gtum-filesystem-{label}-{nonce}"))
    }

    #[cfg(unix)]
    #[test]
    fn read_project_overview_returns_the_canonical_root_for_a_symlink() {
        use std::os::unix::fs::symlink;

        let root = temp_project_dir("overview-canonical");
        let link = temp_project_dir("overview-link");
        fs::create_dir_all(root.join("src")).unwrap();
        symlink(&root, &link).unwrap();

        let overview = read_project_overview(link.to_string_lossy().into_owned(), None).unwrap();

        assert_eq!(
            overview.metadata.path,
            fs::canonicalize(&root)
                .unwrap()
                .to_string_lossy()
                .into_owned()
        );
        assert_eq!(overview.tree.path, overview.metadata.path);

        let _ = fs::remove_file(link);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn read_project_file_rejects_a_file_outside_the_canonical_root() {
        let root = temp_project_dir("inside-root");
        let outside = temp_project_dir("outside-root");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        let outside_file = outside.join("secret.txt");
        fs::write(&outside_file, "secret\n").unwrap();

        let error = read_project_file(
            root.to_string_lossy().into_owned(),
            outside_file.to_string_lossy().into_owned(),
        )
        .err()
        .expect("outside-root reads must fail");

        assert_eq!(error, "requested file is outside the active project root");

        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(outside);
    }

    #[test]
    fn apply_project_patch_writes_multiple_files_with_hash_guards() {
        let root = temp_project_dir("apply");
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src").join("one.txt"), "one\n").unwrap();
        fs::write(root.join("two.txt"), "two\n").unwrap();
        let project_path = root.to_string_lossy().into_owned();
        let first = read_project_file(project_path.clone(), "src/one.txt".into()).unwrap();
        let second = read_project_file(project_path.clone(), "two.txt".into()).unwrap();

        let result = apply_project_patch(ApplyProjectPatchRequest {
            project_path: project_path.clone(),
            edits: vec![
                ProjectFilePatchEdit {
                    file_path: "src/one.txt".into(),
                    content: "updated one\n".into(),
                    expected_content_hash: Some(first.content_hash),
                },
                ProjectFilePatchEdit {
                    file_path: "two.txt".into(),
                    content: "updated two\n".into(),
                    expected_content_hash: Some(second.content_hash),
                },
            ],
        })
        .unwrap();

        assert_eq!(result.applied_files.len(), 2);
        assert_eq!(
            fs::read_to_string(root.join("src").join("one.txt")).unwrap(),
            "updated one\n"
        );
        assert_eq!(
            fs::read_to_string(root.join("two.txt")).unwrap(),
            "updated two\n"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn apply_project_patch_rejects_stale_hash_without_partial_writes() {
        let root = temp_project_dir("stale");
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src").join("one.txt"), "one\n").unwrap();
        fs::write(root.join("two.txt"), "two\n").unwrap();
        let project_path = root.to_string_lossy().into_owned();
        let first = read_project_file(project_path.clone(), "src/one.txt".into()).unwrap();
        let second = read_project_file(project_path.clone(), "two.txt".into()).unwrap();
        fs::write(root.join("two.txt"), "changed elsewhere\n").unwrap();

        let error = match apply_project_patch(ApplyProjectPatchRequest {
            project_path,
            edits: vec![
                ProjectFilePatchEdit {
                    file_path: "src/one.txt".into(),
                    content: "updated one\n".into(),
                    expected_content_hash: Some(first.content_hash),
                },
                ProjectFilePatchEdit {
                    file_path: "two.txt".into(),
                    content: "updated two\n".into(),
                    expected_content_hash: Some(second.content_hash),
                },
            ],
        }) {
            Ok(_) => panic!("expected stale patch hash to fail"),
            Err(error) => error,
        };

        assert_eq!(error, "file changed on disk; reload before saving");
        assert_eq!(
            fs::read_to_string(root.join("src").join("one.txt")).unwrap(),
            "one\n"
        );
        assert_eq!(
            fs::read_to_string(root.join("two.txt")).unwrap(),
            "changed elsewhere\n"
        );

        let _ = fs::remove_dir_all(root);
    }
}
