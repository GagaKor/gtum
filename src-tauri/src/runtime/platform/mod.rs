use std::{
  path::{Path, PathBuf},
  process::Command,
};

pub fn normalize_project_path(path: &str) -> Result<PathBuf, String> {
  let expanded = if let Some(stripped) = path.strip_prefix("~/") {
    std::env::var("HOME")
      .map(|home| PathBuf::from(home).join(stripped))
      .map_err(|error| format!("failed to resolve home directory: {error}"))?
  } else {
    PathBuf::from(path)
  };

  if expanded.is_absolute() {
    Ok(expanded)
  } else {
    std::env::current_dir()
      .map(|cwd| cwd.join(expanded))
      .map_err(|error| format!("failed to resolve current directory: {error}"))
  }
}

pub fn run_git(path: &Path, args: &[&str]) -> Result<String, String> {
  let output = Command::new("git")
    .arg("-C")
    .arg(path)
    .args(args)
    .output()
    .map_err(|error| format!("failed to execute git: {error}"))?;

  if output.status.success() {
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
  } else {
    Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
  }
}
