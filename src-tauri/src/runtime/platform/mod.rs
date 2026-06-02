use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    process::Command,
};

#[derive(Clone, Debug)]
pub struct TerminalShellCandidate {
    pub program: String,
    pub args: Vec<String>,
}

pub fn normalize_project_path(path: &str) -> Result<PathBuf, String> {
    let expanded = if let Some(stripped) = home_relative_path(path) {
        expand_home_path(stripped, user_home_dir)?
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

fn home_relative_path(path: &str) -> Option<&str> {
    if path == "~" {
        return Some("");
    }

    path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\"))
}

fn expand_home_path(
    stripped: &str,
    home_dir: impl FnOnce() -> Result<PathBuf, String>,
) -> Result<PathBuf, String> {
    let home = home_dir()?;

    if stripped.is_empty() {
        Ok(home)
    } else {
        Ok(home.join(stripped))
    }
}

fn user_home_dir() -> Result<PathBuf, String> {
    home_dir_from_env(|key| std::env::var_os(key))
}

fn home_dir_from_env(
    mut env_value: impl FnMut(&str) -> Option<OsString>,
) -> Result<PathBuf, String> {
    env_value("HOME")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .or_else(|| {
            env_value("USERPROFILE")
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
        })
        .or_else(|| match (env_value("HOMEDRIVE"), env_value("HOMEPATH")) {
            (Some(drive), Some(path)) if !drive.is_empty() && !path.is_empty() => {
                let mut home = PathBuf::from(drive);
                home.push(path);
                Some(home)
            }
            _ => None,
        })
        .ok_or_else(|| {
            "failed to resolve home directory: HOME, USERPROFILE, or HOMEDRIVE/HOMEPATH is required"
                .into()
        })
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

pub fn terminal_path_env() -> Option<OsString> {
    terminal_path_env_from(std::env::var_os("PATH"), terminal_tool_dirs())
}

fn terminal_path_env_from(path: Option<OsString>, extra_dirs: Vec<PathBuf>) -> Option<OsString> {
    let mut entries = path
        .as_ref()
        .map(|value| std::env::split_paths(value).collect::<Vec<_>>())
        .unwrap_or_default();

    for dir in extra_dirs {
        if dir.is_dir() && !entries.contains(&dir) {
            entries.push(dir);
        }
    }

    if entries.is_empty() {
        None
    } else {
        std::env::join_paths(entries).ok()
    }
}

fn terminal_tool_dirs() -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        let mut dirs = vec![PathBuf::from(
            "/Applications/Codex.app/Contents/Resources",
        )];

        if let Ok(home) = user_home_dir() {
            dirs.push(
                home.join("Applications")
                    .join("Codex.app")
                    .join("Contents")
                    .join("Resources"),
            );
        }

        dirs
    }

    #[cfg(not(target_os = "macos"))]
    {
        Vec::new()
    }
}

pub fn terminal_shell_candidates(explicit_shell: Option<&str>) -> Vec<TerminalShellCandidate> {
    if let Some(shell) = explicit_shell
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return vec![TerminalShellCandidate {
            program: shell.to_string(),
            args: Vec::new(),
        }];
    }

    #[cfg(target_os = "windows")]
    {
        return vec![
            TerminalShellCandidate {
                program: "powershell.exe".into(),
                args: vec!["-NoLogo".into()],
            },
            TerminalShellCandidate {
                program: "cmd.exe".into(),
                args: vec!["/Q".into(), "/K".into()],
            },
        ];
    }

    #[cfg(not(target_os = "windows"))]
    {
        let mut candidates = Vec::new();

        if let Ok(shell) = std::env::var("SHELL") {
            candidates.push(TerminalShellCandidate {
                program: shell.clone(),
                args: interactive_shell_args(&shell),
            });
        }

        candidates.extend([
            TerminalShellCandidate {
                program: "/bin/bash".into(),
                args: vec!["-i".into()],
            },
            TerminalShellCandidate {
                program: "bash".into(),
                args: vec!["-i".into()],
            },
            TerminalShellCandidate {
                program: "/bin/sh".into(),
                args: vec!["-i".into()],
            },
            TerminalShellCandidate {
                program: "sh".into(),
                args: vec!["-i".into()],
            },
        ]);

        candidates
    }
}

pub fn terminal_submission_line(command: &str) -> String {
    let sanitized = command.trim_end_matches(['\r', '\n']);

    #[cfg(target_os = "windows")]
    {
        format!("{sanitized}\r\n")
    }

    #[cfg(not(target_os = "windows"))]
    {
        format!("{sanitized}\n")
    }
}

pub fn normalize_terminal_command(command: &str) -> String {
    command.trim().to_string()
}

#[cfg(not(target_os = "windows"))]
fn interactive_shell_args(program: &str) -> Vec<String> {
    let shell_name = Path::new(program)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(program);

    match shell_name {
        "fish" => vec!["-i".into()],
        "zsh" | "bash" | "sh" | "ksh" | "dash" => vec!["-i".into()],
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_bare_tilde_to_home_directory() {
        let expanded = expand_home_path("", || Ok(PathBuf::from("C:\\Users\\kwon"))).unwrap();

        assert_eq!(expanded, PathBuf::from("C:\\Users\\kwon"));
    }

    #[test]
    fn expands_slash_tilde_path_to_home_directory() {
        let expanded =
            expand_home_path("code\\gtum", || Ok(PathBuf::from("C:\\Users\\kwon"))).unwrap();

        assert_eq!(
            expanded,
            PathBuf::from("C:\\Users\\kwon").join("code\\gtum")
        );
    }

    #[test]
    fn recognizes_windows_tilde_prefix() {
        assert_eq!(home_relative_path("~\\code\\gtum"), Some("code\\gtum"));
    }

    #[test]
    fn explicit_shell_overrides_platform_defaults() {
        let candidates = terminal_shell_candidates(Some("custom-shell"));

        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].program, "custom-shell");
        assert!(candidates[0].args.is_empty());
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_default_shells_are_powershell_then_cmd() {
        let candidates = terminal_shell_candidates(None);

        assert_eq!(candidates.len(), 2);
        assert_eq!(candidates[0].program, "powershell.exe");
        assert_eq!(candidates[0].args, vec!["-NoLogo"]);
        assert_eq!(candidates[1].program, "cmd.exe");
        assert_eq!(candidates[1].args, vec!["/Q", "/K"]);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_terminal_submission_uses_crlf() {
        assert_eq!(terminal_submission_line("npm test\n"), "npm test\r\n");
    }

    #[test]
    fn resolves_home_from_userprofile_when_home_is_missing() {
        let home = home_dir_from_env(|key| match key {
            "USERPROFILE" => Some(OsString::from("C:\\Users\\kwon")),
            _ => None,
        })
        .unwrap();

        assert_eq!(home, PathBuf::from("C:\\Users\\kwon"));
    }

    #[test]
    fn resolves_home_from_home_drive_and_path_when_home_and_userprofile_are_missing() {
        let home = home_dir_from_env(|key| match key {
            "HOMEDRIVE" => Some(OsString::from("C:")),
            "HOMEPATH" => Some(OsString::from("\\Users\\kwon")),
            _ => None,
        })
        .unwrap();

        assert_eq!(home, PathBuf::from("C:").join("\\Users\\kwon"));
    }

    #[test]
    fn reports_clear_home_resolution_error() {
        let error = expand_home_path("code", || Err("missing home".into())).unwrap_err();

        assert_eq!(error, "missing home");
    }

    #[test]
    fn terminal_path_env_includes_existing_tool_directory_when_base_path_is_limited() {
        let root = std::env::temp_dir().join(format!(
            "gtum-terminal-path-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis()
        ));
        let tool_dir = root
            .join("Codex.app")
            .join("Contents")
            .join("Resources");
        std::fs::create_dir_all(&tool_dir).unwrap();

        let path = terminal_path_env_from(
            Some(OsString::from("/usr/bin:/bin:/usr/sbin:/sbin")),
            vec![tool_dir.clone()],
        )
        .unwrap();
        let entries = std::env::split_paths(&path).collect::<Vec<_>>();

        assert!(entries.contains(&tool_dir));

        let _ = std::fs::remove_dir_all(root);
    }
}
