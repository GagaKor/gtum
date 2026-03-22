use std::{
    path::{Path, PathBuf},
    process::Command,
};

#[derive(Clone, Debug)]
pub struct TerminalShellCandidate {
    pub program: String,
    pub args: Vec<String>,
}

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
                program: "cmd.exe".into(),
                args: vec!["/Q".into(), "/K".into()],
            },
            TerminalShellCandidate {
                program: "powershell.exe".into(),
                args: vec!["-NoLogo".into()],
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
