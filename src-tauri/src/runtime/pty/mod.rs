use std::{
    collections::{HashMap, VecDeque},
    io::{Read, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};

use crate::runtime::platform;

const DEFAULT_ROWS: u16 = 24;
const DEFAULT_COLS: u16 = 80;
const DEFAULT_LOG_LIMIT: usize = 400;
const MIN_LOG_LIMIT: usize = 50;
const MAX_LOG_LIMIT: usize = 2_000;

#[derive(Default)]
pub struct TerminalSessionManager {
    sessions: Mutex<HashMap<u64, Arc<Mutex<TerminalSession>>>>,
    next_session_id: AtomicU64,
}

impl TerminalSessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            next_session_id: AtomicU64::new(1),
        }
    }

    pub fn create_session(
        &self,
        request: CreateTerminalSessionRequest,
    ) -> Result<TerminalSessionSnapshot, String> {
        let session_id = self.next_id();
        let shell_candidates = platform::terminal_shell_candidates(request.shell.as_deref());
        let cwd = match request.cwd {
            Some(path) => Some(platform::normalize_project_path(&path)?),
            None => None,
        };
        let session_name = request
            .name
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| default_session_name(session_id));
        let log_limit = request
            .max_log_entries
            .unwrap_or(DEFAULT_LOG_LIMIT)
            .clamp(MIN_LOG_LIMIT, MAX_LOG_LIMIT);

        let pty_system = native_pty_system();

        let mut last_error = None;
        for candidate in shell_candidates {
            let pty_pair = pty_system
                .openpty(PtySize {
                    rows: request.rows.unwrap_or(DEFAULT_ROWS),
                    cols: request.cols.unwrap_or(DEFAULT_COLS),
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|error| format!("failed to allocate terminal session: {error}"))?;

            let mut command = CommandBuilder::new(candidate.program.clone());
            if !candidate.args.is_empty() {
                command.args(candidate.args.clone());
            }
            if let Some(cwd) = &cwd {
                command.cwd(cwd);
            }
            if let Some(path_env) = platform::terminal_path_env() {
                command.env("PATH", path_env);
            }

            match pty_pair.slave.spawn_command(command) {
                Ok(child) => {
                    return self.finish_session_spawn(
                        session_id,
                        session_name,
                        cwd,
                        log_limit,
                        pty_pair.master,
                        child,
                        candidate.program,
                        candidate.args,
                    );
                }
                Err(error) => {
                    last_error = Some(format!("failed to spawn {}: {error}", candidate.program));
                }
            }
        }

        Err(last_error.unwrap_or_else(|| "unable to spawn a terminal shell".into()))
    }

    pub fn list_sessions(&self) -> Vec<TerminalSessionSnapshot> {
        let sessions = self.sessions.lock().unwrap();
        let mut snapshots = sessions
            .values()
            .map(|session| session.lock().unwrap().snapshot())
            .collect::<Vec<_>>();

        snapshots.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        snapshots
    }

    pub fn rename_session(
        &self,
        session_id: u64,
        name: String,
    ) -> Result<TerminalSessionSnapshot, String> {
        let session = self.get_session(session_id)?;
        let mut session = session.lock().unwrap();
        session.rename(name)?;
        Ok(session.snapshot())
    }

    pub fn close_session(&self, session_id: u64) -> Result<TerminalSessionSnapshot, String> {
        let session = self.get_session(session_id)?;
        let mut session = session.lock().unwrap();
        session.close()?;
        Ok(session.snapshot())
    }

    pub fn read_recent_logs(
        &self,
        session_id: u64,
        limit: Option<usize>,
    ) -> Result<TerminalSessionLogs, String> {
        let session = self.get_session(session_id)?;
        let session = session.lock().unwrap();
        Ok(session.recent_logs(limit.unwrap_or(100)))
    }

    pub fn execute_command(
        &self,
        session_id: u64,
        command: String,
    ) -> Result<TerminalSessionSnapshot, String> {
        let session = self.get_session(session_id)?;
        let mut session = session.lock().unwrap();
        session.execute_command(command)?;
        Ok(session.snapshot())
    }

    pub fn create_session_with_command(
        &self,
        request: CreateTerminalSessionWithCommandRequest,
    ) -> Result<TerminalSessionSnapshot, String> {
        let command = platform::normalize_terminal_command(&request.command);
        if command.is_empty() {
            return Err("terminal command cannot be empty".into());
        }

        let snapshot = self.create_session(request.session)?;
        let session = self.get_session(snapshot.session_id)?;
        let mut session = session.lock().unwrap();

        if let Err(error) = session.execute_command(command) {
            let _ = session.close();
            drop(session);
            return Err(error);
        }

        Ok(snapshot)
    }

    fn finish_session_spawn(
        &self,
        session_id: u64,
        name: String,
        cwd: Option<PathBuf>,
        log_limit: usize,
        master: Box<dyn portable_pty::MasterPty + Send>,
        child: Box<dyn portable_pty::Child + Send>,
        shell_program: String,
        shell_args: Vec<String>,
    ) -> Result<TerminalSessionSnapshot, String> {
        let process_id = child.process_id();
        let child_killer = child.clone_killer();
        let writer = master
            .take_writer()
            .map_err(|error| format!("failed to create terminal writer: {error}"))?;
        let initial_snapshot = TerminalSessionSnapshot::new(
            session_id,
            name,
            cwd,
            shell_program,
            shell_args,
            process_id,
            log_limit,
        );
        let session = Arc::new(Mutex::new(TerminalSession::new(
            initial_snapshot.clone(),
            child_killer,
            writer,
        )));

        self.sessions
            .lock()
            .unwrap()
            .insert(session_id, session.clone());

        if let Err(error) = self.spawn_reader(session_id, session.clone(), master) {
            let _ = session.lock().unwrap().close();
            self.sessions.lock().unwrap().remove(&session_id);
            return Err(error);
        }

        if let Err(error) = self.spawn_reaper(session_id, session.clone(), child) {
            let _ = session.lock().unwrap().close();
            self.sessions.lock().unwrap().remove(&session_id);
            return Err(error);
        }

        Ok(initial_snapshot)
    }

    fn spawn_reader(
        &self,
        session_id: u64,
        session: Arc<Mutex<TerminalSession>>,
        master: Box<dyn portable_pty::MasterPty + Send>,
    ) -> Result<(), String> {
        let mut reader = master
            .try_clone_reader()
            .map_err(|error| format!("failed to create terminal reader: {error}"))?;

        thread::Builder::new()
            .name(format!("gtum-terminal-reader-{session_id}"))
            .spawn(move || {
                let mut buffer = [0_u8; 4_096];
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) => break,
                        Ok(read_size) => {
                            let chunk = String::from_utf8_lossy(&buffer[..read_size]).into_owned();
                            let mut session = session.lock().unwrap();
                            session.push_output(&chunk);
                        }
                        Err(error) => {
                            let mut session = session.lock().unwrap();
                            session.record_reader_error(error.to_string());
                            break;
                        }
                    }
                }

                let mut session = session.lock().unwrap();
                session.flush_pending_output();
            })
            .map_err(|error| format!("failed to start terminal reader thread: {error}"))?;

        Ok(())
    }

    fn spawn_reaper(
        &self,
        session_id: u64,
        session: Arc<Mutex<TerminalSession>>,
        mut child: Box<dyn portable_pty::Child + Send>,
    ) -> Result<(), String> {
        thread::Builder::new()
            .name(format!("gtum-terminal-reaper-{session_id}"))
            .spawn(move || {
                let exit_result = child.wait();
                let mut session = session.lock().unwrap();
                session.record_exit(exit_result.map_err(|error| error.to_string()));
            })
            .map_err(|error| format!("failed to start terminal reaper thread: {error}"))?;

        Ok(())
    }

    fn next_id(&self) -> u64 {
        self.next_session_id.fetch_add(1, Ordering::Relaxed)
    }

    fn get_session(&self, session_id: u64) -> Result<Arc<Mutex<TerminalSession>>, String> {
        self.sessions
            .lock()
            .unwrap()
            .get(&session_id)
            .cloned()
            .ok_or_else(|| format!("terminal session not found: {session_id}"))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTerminalSessionRequest {
    pub name: Option<String>,
    pub cwd: Option<String>,
    pub shell: Option<String>,
    pub rows: Option<u16>,
    pub cols: Option<u16>,
    pub max_log_entries: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTerminalSessionWithCommandRequest {
    pub session: CreateTerminalSessionRequest,
    pub command: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionSnapshot {
    pub session_id: u64,
    pub name: String,
    pub cwd: Option<String>,
    pub shell: String,
    pub shell_args: Vec<String>,
    pub process_id: Option<u32>,
    pub status: TerminalSessionStatus,
    pub created_at: u64,
    pub updated_at: u64,
    pub exit_code: Option<i32>,
    pub log_line_count: usize,
    pub max_log_entries: usize,
    pub last_event: Option<String>,
}

impl TerminalSessionSnapshot {
    fn new(
        session_id: u64,
        name: String,
        cwd: Option<PathBuf>,
        shell: String,
        shell_args: Vec<String>,
        process_id: Option<u32>,
        max_log_entries: usize,
    ) -> Self {
        let timestamp = unix_timestamp_ms();

        Self {
            session_id,
            name,
            cwd: cwd.map(|path| path.to_string_lossy().into_owned()),
            shell,
            shell_args,
            process_id,
            status: TerminalSessionStatus::Running,
            created_at: timestamp,
            updated_at: timestamp,
            exit_code: None,
            log_line_count: 0,
            max_log_entries,
            last_event: Some("session created".into()),
        }
    }
}

#[derive(Serialize, Clone, Copy, Debug, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum TerminalSessionStatus {
    Running,
    Exited,
    Terminated,
    Failed,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionLogs {
    pub session_id: u64,
    pub status: TerminalSessionStatus,
    pub limit: usize,
    pub log_line_count: usize,
    pub truncated: bool,
    pub entries: Vec<String>,
    pub updated_at: u64,
}

struct TerminalSession {
    snapshot: TerminalSessionSnapshot,
    logs: VecDeque<String>,
    pending_output: String,
    child_killer: Option<Box<dyn ChildKiller + Send>>,
    writer: Box<dyn Write + Send>,
}

impl TerminalSession {
    fn new(
        snapshot: TerminalSessionSnapshot,
        child_killer: Box<dyn ChildKiller + Send>,
        writer: Box<dyn Write + Send>,
    ) -> Self {
        Self {
            snapshot,
            logs: VecDeque::new(),
            pending_output: String::new(),
            child_killer: Some(child_killer),
            writer,
        }
    }

    fn snapshot(&self) -> TerminalSessionSnapshot {
        self.snapshot.clone()
    }

    fn rename(&mut self, name: String) -> Result<(), String> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err("terminal session name cannot be empty".into());
        }

        self.snapshot.name = trimmed.to_string();
        self.touch("session renamed");
        Ok(())
    }

    fn close(&mut self) -> Result<(), String> {
        if matches!(
            self.snapshot.status,
            TerminalSessionStatus::Terminated | TerminalSessionStatus::Exited
        ) {
            return Ok(());
        }

        self.snapshot.status = TerminalSessionStatus::Terminated;
        self.snapshot.last_event = Some("termination requested".into());
        self.touch("termination requested");

        if let Some(mut killer) = self.child_killer.take() {
            let _ = killer.kill();
        }

        Ok(())
    }

    fn execute_command(&mut self, command: String) -> Result<(), String> {
        let trimmed = command.trim();
        if trimmed.is_empty() {
            return Err("terminal command cannot be empty".into());
        }

        let submission = platform::terminal_submission_line(trimmed);
        self.writer
            .write_all(submission.as_bytes())
            .map_err(|error| format!("failed to write terminal command: {error}"))?;
        self.writer
            .flush()
            .map_err(|error| format!("failed to flush terminal command: {error}"))?;
        self.touch(format!("command queued: {trimmed}"));
        Ok(())
    }

    fn push_output(&mut self, chunk: &str) {
        self.pending_output.push_str(chunk);

        while let Some(line_end) = self.pending_output.find('\n') {
            let mut line = self.pending_output.drain(..=line_end).collect::<String>();
            if line.ends_with('\n') {
                line.pop();
            }
            if line.ends_with('\r') {
                line.pop();
            }
            self.push_line(line);
        }
    }

    fn flush_pending_output(&mut self) {
        if !self.pending_output.is_empty() {
            let line = std::mem::take(&mut self.pending_output);
            self.push_line(line);
        }
    }

    fn push_line(&mut self, line: String) {
        self.logs.push_back(line);
        while self.logs.len() > self.snapshot.max_log_entries {
            self.logs.pop_front();
        }
        self.snapshot.log_line_count = self.snapshot.log_line_count.saturating_add(1);
        self.touch("terminal output received");
    }

    fn record_reader_error(&mut self, message: String) {
        self.snapshot.last_event = Some(format!("reader error: {message}"));
        self.touch("reader error");
    }

    fn record_exit(&mut self, exit_result: Result<portable_pty::ExitStatus, String>) {
        match exit_result {
            Ok(status) => {
                let exit_code = Some(status.exit_code() as i32);
                self.snapshot.exit_code = exit_code;
                if self.snapshot.status == TerminalSessionStatus::Running {
                    self.snapshot.status = TerminalSessionStatus::Exited;
                    self.snapshot.last_event = Some("process exited".into());
                } else if self.snapshot.status == TerminalSessionStatus::Terminated {
                    self.snapshot.last_event = Some("process terminated".into());
                }
                self.touch("process exited");
            }
            Err(error) => {
                if self.snapshot.status == TerminalSessionStatus::Terminated {
                    self.snapshot.last_event =
                        Some(format!("process wait ended after termination: {error}"));
                    self.touch("process wait ended after termination");
                } else {
                    self.snapshot.status = TerminalSessionStatus::Failed;
                    self.snapshot.last_event = Some(format!("process wait failed: {error}"));
                    self.touch("process wait failed");
                }
            }
        }
    }

    fn recent_logs(&self, limit: usize) -> TerminalSessionLogs {
        let limit = limit.clamp(1, self.snapshot.max_log_entries);
        let total = self.logs.len();
        let start = total.saturating_sub(limit);
        let entries = self.logs.iter().skip(start).cloned().collect::<Vec<_>>();

        TerminalSessionLogs {
            session_id: self.snapshot.session_id,
            status: self.snapshot.status,
            limit,
            log_line_count: total,
            truncated: total > limit,
            entries,
            updated_at: self.snapshot.updated_at,
        }
    }

    fn touch(&mut self, event: impl Into<String>) {
        self.snapshot.updated_at = unix_timestamp_ms();
        self.snapshot.last_event = Some(event.into());
    }
}

fn default_session_name(session_id: u64) -> String {
    format!("Session {session_id}")
}

fn unix_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}
