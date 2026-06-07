use std::{
    ffi::{OsStr, OsString},
    path::{Path, PathBuf},
    process::Command,
};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

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
    let output = command_for_program("git")
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

pub fn command_for_program(program: impl AsRef<OsStr>) -> Command {
    let mut command = Command::new(program);
    hide_windows_console(&mut command);
    command
}

#[cfg(target_os = "windows")]
fn hide_windows_console(command: &mut Command) {
    use std::os::windows::process::CommandExt;

    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(target_os = "windows"))]
fn hide_windows_console(_command: &mut Command) {}

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
                args: vec!["-NoLogo".into(), "-NoProfile".into(), "-NoExit".into()],
            },
            TerminalShellCandidate {
                program: "pwsh.exe".into(),
                args: vec!["-NoLogo".into(), "-NoProfile".into(), "-NoExit".into()],
            },
            TerminalShellCandidate {
                program: windows_comspec(),
                args: vec!["/D".into(), "/Q".into(), "/K".into()],
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

pub fn terminal_command_runner(command: &str) -> Result<TerminalShellCandidate, String> {
    #[cfg(target_os = "windows")]
    {
        return shell_free_windows_command(command);
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(TerminalShellCandidate {
            program: std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into()),
            args: vec!["-lc".into(), command.into()],
        })
    }
}

#[cfg(target_os = "windows")]
pub fn shell_free_windows_command(command: &str) -> Result<TerminalShellCandidate, String> {
    let mut argv = split_command_line(command)?;
    if argv.is_empty() {
        return Err("approved command cannot be empty".into());
    }

    reject_shell_syntax(command)?;
    let program = resolve_windows_program(&argv[0])?;
    reject_windows_shell_program(&program)?;
    argv.remove(0);

    Ok(TerminalShellCandidate {
        program,
        args: argv,
    })
}

#[cfg(target_os = "windows")]
fn split_command_line(command: &str) -> Result<Vec<String>, String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut chars = command.chars().peekable();
    let mut quote = None;

    while let Some(ch) = chars.next() {
        match ch {
            '"' | '\'' => {
                if quote == Some(ch) {
                    quote = None;
                } else if quote.is_none() {
                    quote = Some(ch);
                } else {
                    current.push(ch);
                }
            }
            '\\' if quote == Some('"') && chars.peek() == Some(&'"') => {
                current.push('"');
                chars.next();
            }
            ch if ch.is_whitespace() && quote.is_none() => {
                if !current.is_empty() {
                    args.push(std::mem::take(&mut current));
                }
            }
            _ => current.push(ch),
        }
    }

    if let Some(ch) = quote {
        return Err(format!("unterminated quote in approved command: {ch}"));
    }
    if !current.is_empty() {
        args.push(current);
    }

    Ok(args)
}

#[cfg(target_os = "windows")]
fn reject_shell_syntax(command: &str) -> Result<(), String> {
    if command
        .chars()
        .any(|ch| matches!(ch, '|' | '&' | '<' | '>' | ';' | '(' | ')'))
    {
        return Err(
            "approved command contains shell syntax; run it manually in a terminal".into(),
        );
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn resolve_windows_program(program: &str) -> Result<String, String> {
    let candidate = PathBuf::from(program);
    if candidate.components().count() > 1 {
        return validate_windows_program(candidate);
    }

    let path_env = terminal_path_env()
        .or_else(|| std::env::var_os("PATH"))
        .ok_or_else(|| "PATH is required to resolve approved command executable".to_string())?;
    let extensions = std::env::var_os("PATHEXT")
        .map(|value| {
            value
                .to_string_lossy()
                .split(';')
                .filter(|entry| !entry.trim().is_empty())
                .map(|entry| entry.trim().to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| vec![".COM".into(), ".EXE".into()]);
    let has_extension = Path::new(program).extension().is_some();

    for dir in std::env::split_paths(&path_env) {
        let direct = dir.join(program);
        if has_extension {
            if direct.is_file() {
                return validate_windows_program(direct);
            }
            continue;
        }

        for extension in &extensions {
            let candidate = dir.join(format!("{program}{extension}"));
            if candidate.is_file() {
                return validate_windows_program(candidate);
            }
        }
    }

    Err(format!(
        "approved command executable was not found without a shell: {program}"
    ))
}

#[cfg(target_os = "windows")]
fn validate_windows_program(path: PathBuf) -> Result<String, String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if matches!(extension.as_str(), "cmd" | "bat" | "ps1") {
        return Err(format!(
            "approved command resolves to a shell script shim and was not run: {}",
            path.display()
        ));
    }
    if !matches!(extension.as_str(), "exe" | "com") {
        return Err(format!(
            "approved command must resolve to a .exe or .com without shell: {}",
            path.display()
        ));
    }

    Ok(path.to_string_lossy().into_owned())
}

#[cfg(target_os = "windows")]
fn reject_windows_shell_program(program: &str) -> Result<(), String> {
    let name = Path::new(program)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(program)
        .to_ascii_lowercase();

    if matches!(name.as_str(), "cmd.exe" | "powershell.exe" | "pwsh.exe") {
        return Err(format!(
            "approved command would launch {name}; run it manually in a terminal"
        ));
    }

    Ok(())
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

#[cfg(target_os = "windows")]
fn windows_comspec() -> String {
    std::env::var("ComSpec")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| "cmd.exe".into())
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
    fn windows_default_shell_prefers_powershell_then_cmd_fallback() {
        let candidates = terminal_shell_candidates(None);

        assert!(
            candidates[0]
                .program
                .to_ascii_lowercase()
                .ends_with("powershell.exe")
        );
        assert_eq!(candidates[0].args, vec!["-NoLogo", "-NoProfile", "-NoExit"]);
        assert!(candidates.iter().any(|candidate| {
            candidate.program.to_ascii_lowercase().ends_with("cmd.exe")
        }));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_approved_command_runner_rejects_shell_builtins() {
        let error = terminal_command_runner("echo ok").unwrap_err();

        assert!(error.contains("not found without a shell"));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_approved_command_runner_resolves_exe_without_shell() {
        let candidate = terminal_command_runner("whoami /user").unwrap();

        assert!(candidate
            .program
            .to_ascii_lowercase()
            .ends_with("whoami.exe"));
        assert_eq!(candidate.args, vec!["/user"]);
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
