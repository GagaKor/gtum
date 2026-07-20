use portable_pty::PtySize;
#[cfg(not(target_os = "windows"))]
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    fs,
    io::{Read, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(target_os = "windows")]
use std::process::{Child as ProcessChild, Stdio};

use crate::runtime::platform;

#[cfg(not(target_os = "windows"))]
const DEFAULT_ROWS: u16 = 24;
#[cfg(not(target_os = "windows"))]
const DEFAULT_COLS: u16 = 80;
const DEFAULT_LOG_LIMIT: usize = 400;
const MIN_LOG_LIMIT: usize = 50;
const MAX_LOG_LIMIT: usize = 2_000;
const RAW_OUTPUT_CAP: usize = 200_000;

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
        let project_path = canonicalize_project_owner(&request.project_path)?;

        #[cfg(target_os = "windows")]
        {
            return self.create_piped_shell_session(request, project_path);
        }

        #[cfg(not(target_os = "windows"))]
        {
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
                            project_path,
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
                        last_error =
                            Some(format!("failed to spawn {}: {error}", candidate.program));
                    }
                }
            }

            Err(last_error.unwrap_or_else(|| "unable to spawn a terminal shell".into()))
        }
    }

    pub fn list_sessions(
        &self,
        project_path: &str,
    ) -> Result<Vec<TerminalSessionSnapshot>, String> {
        validate_project_owner_value(project_path)?;
        let sessions = self.sessions.lock().unwrap();
        let mut snapshots = sessions
            .values()
            .filter_map(|session| {
                let session = session.lock().unwrap();
                (session.snapshot.project_path == project_path).then(|| session.snapshot())
            })
            .collect::<Vec<_>>();

        snapshots.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
        Ok(snapshots)
    }

    pub fn rename_session(
        &self,
        project_path: &str,
        session_id: u64,
        name: String,
    ) -> Result<TerminalSessionSnapshot, String> {
        let session = self.get_owned_session(project_path, session_id)?;
        let mut session = session.lock().unwrap();
        session.rename(name)?;
        Ok(session.snapshot())
    }

    pub fn close_session(
        &self,
        project_path: &str,
        session_id: u64,
    ) -> Result<TerminalSessionSnapshot, String> {
        let session = self.get_owned_session(project_path, session_id)?;
        let mut session = session.lock().unwrap();
        session.close()?;
        Ok(session.snapshot())
    }

    pub fn read_recent_logs(
        &self,
        project_path: &str,
        session_id: u64,
        limit: Option<usize>,
    ) -> Result<TerminalSessionLogs, String> {
        let session = self.get_owned_session(project_path, session_id)?;
        let session = session.lock().unwrap();
        Ok(session.recent_logs(limit.unwrap_or(100)))
    }

    pub fn write_terminal_input(
        &self,
        project_path: &str,
        session_id: u64,
        data: String,
    ) -> Result<(), String> {
        let session = self.get_owned_session(project_path, session_id)?;
        let mut session = session.lock().unwrap();
        session.write_input(&data)
    }

    pub fn read_raw_output(
        &self,
        project_path: &str,
        session_id: u64,
        from: usize,
    ) -> Result<RawTerminalOutput, String> {
        let session = self.get_owned_session(project_path, session_id)?;
        let session = session.lock().unwrap();
        Ok(session.read_raw_output(from))
    }

    pub fn resize_session(
        &self,
        project_path: &str,
        session_id: u64,
        rows: u16,
        cols: u16,
    ) -> Result<(), String> {
        let session = self.get_owned_session(project_path, session_id)?;
        let session = session.lock().unwrap();
        session.resize(rows, cols)
    }

    pub fn execute_command(
        &self,
        project_path: &str,
        session_id: u64,
        command: String,
    ) -> Result<TerminalSessionSnapshot, String> {
        let session = self.get_owned_session(project_path, session_id)?;
        {
            let mut session = session.lock().unwrap();
            if session.is_interactive() {
                session.execute_command(command)?;
                return Ok(session.snapshot());
            }
        }

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

    #[cfg(target_os = "windows")]
    fn create_piped_shell_session(
        &self,
        request: CreateTerminalSessionRequest,
        project_path: String,
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

        let mut last_error = None;
        for candidate in shell_candidates {
            let mut command = platform::command_for_program(&candidate.program);
            command
                .args(&candidate.args)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped());
            if let Some(cwd) = &cwd {
                command.current_dir(cwd);
            }
            if let Some(path_env) = platform::terminal_path_env() {
                command.env("PATH", path_env);
            }

            match command.spawn() {
                Ok(mut child) => {
                    let process_id = Some(child.id());
                    let writer = child
                        .stdin
                        .take()
                        .ok_or_else(|| "failed to create terminal writer".to_string())?;
                    let stdout = child.stdout.take();
                    let stderr = child.stderr.take();
                    let child = Arc::new(Mutex::new(child));
                    let initial_snapshot = TerminalSessionSnapshot::new(
                        session_id,
                        project_path,
                        session_name,
                        cwd,
                        candidate.program,
                        candidate.args,
                        process_id,
                        log_limit,
                    );
                    let session = Arc::new(Mutex::new(TerminalSession::new(
                        initial_snapshot.clone(),
                        Some(Box::new(ProcessSessionKiller {
                            child: child.clone(),
                        })),
                        Some(Box::new(writer)),
                    )));

                    self.sessions
                        .lock()
                        .unwrap()
                        .insert(session_id, session.clone());

                    if let Some(stdout) = stdout {
                        self.spawn_process_reader(session_id, "stdout", stdout, session.clone())?;
                    }
                    if let Some(stderr) = stderr {
                        self.spawn_process_reader(session_id, "stderr", stderr, session.clone())?;
                    }
                    self.spawn_process_reaper(session_id, session, child)?;

                    return Ok(initial_snapshot);
                }
                Err(error) => {
                    last_error = Some(format!("failed to spawn {}: {error}", candidate.program));
                }
            }
        }

        Err(last_error.unwrap_or_else(|| "unable to spawn a terminal shell".into()))
    }

    #[cfg(not(target_os = "windows"))]
    fn finish_session_spawn(
        &self,
        session_id: u64,
        project_path: String,
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
            project_path,
            name,
            cwd,
            shell_program,
            shell_args,
            process_id,
            log_limit,
        );
        let session = Arc::new(Mutex::new(TerminalSession::new(
            initial_snapshot.clone(),
            Some(Box::new(PtySessionKiller {
                inner: child_killer,
            })),
            Some(writer),
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

    #[cfg(not(target_os = "windows"))]
    fn spawn_reader(
        &self,
        session_id: u64,
        session: Arc<Mutex<TerminalSession>>,
        master: Box<dyn portable_pty::MasterPty + Send>,
    ) -> Result<(), String> {
        let mut reader = master
            .try_clone_reader()
            .map_err(|error| format!("failed to create terminal reader: {error}"))?;

        // Keep the master alive on the session so the PTY can be resized to the
        // xterm viewport; without this the shell's line editor uses the wrong
        // width and edits corrupt earlier output.
        session.lock().unwrap().set_master(master);

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

    #[cfg(not(target_os = "windows"))]
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

    #[cfg(target_os = "windows")]
    fn spawn_process_reader<R>(
        &self,
        session_id: u64,
        stream_name: &'static str,
        mut reader: R,
        session: Arc<Mutex<TerminalSession>>,
    ) -> Result<(), String>
    where
        R: Read + Send + 'static,
    {
        thread::Builder::new()
            .name(format!("gtum-terminal-{stream_name}-reader-{session_id}"))
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
                            session.record_reader_error(format!("{stream_name}: {error}"));
                            break;
                        }
                    }
                }

                let mut session = session.lock().unwrap();
                session.flush_pending_output();
            })
            .map_err(|error| {
                format!("failed to start terminal {stream_name} reader thread: {error}")
            })?;

        Ok(())
    }

    #[cfg(target_os = "windows")]
    fn spawn_process_reaper(
        &self,
        session_id: u64,
        session: Arc<Mutex<TerminalSession>>,
        child: Arc<Mutex<ProcessChild>>,
    ) -> Result<(), String> {
        thread::Builder::new()
            .name(format!("gtum-terminal-process-reaper-{session_id}"))
            .spawn(move || loop {
                let wait_result = {
                    let mut child = child.lock().unwrap();
                    child.try_wait()
                };

                match wait_result {
                    Ok(Some(status)) => {
                        let mut session = session.lock().unwrap();
                        session.record_process_exit(status.code());
                        break;
                    }
                    Ok(None) => thread::sleep(std::time::Duration::from_millis(100)),
                    Err(error) => {
                        let mut session = session.lock().unwrap();
                        session.record_process_wait_error(error.to_string());
                        break;
                    }
                }
            })
            .map_err(|error| format!("failed to start terminal process reaper thread: {error}"))?;

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

    fn get_owned_session(
        &self,
        project_path: &str,
        session_id: u64,
    ) -> Result<Arc<Mutex<TerminalSession>>, String> {
        validate_project_owner_value(project_path)?;
        let session = self
            .sessions
            .lock()
            .unwrap()
            .get(&session_id)
            .cloned()
            .ok_or_else(|| format!("terminal session not found: {session_id}"))?;
        let actual_owner = session.lock().unwrap().snapshot.project_path.clone();
        if actual_owner != project_path {
            return Err(format!(
                "terminal session owner mismatch: session {session_id} belongs to {actual_owner:?}, not {project_path:?}"
            ));
        }

        Ok(session)
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTerminalSessionRequest {
    pub project_path: String,
    pub name: Option<String>,
    pub cwd: Option<String>,
    pub shell: Option<String>,
    #[cfg_attr(target_os = "windows", allow(dead_code))]
    pub rows: Option<u16>,
    #[cfg_attr(target_os = "windows", allow(dead_code))]
    pub cols: Option<u16>,
    pub max_log_entries: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateTerminalSessionWithCommandRequest {
    pub session: CreateTerminalSessionRequest,
    pub command: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionSnapshot {
    pub project_path: String,
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
        project_path: String,
        name: String,
        cwd: Option<PathBuf>,
        shell: String,
        shell_args: Vec<String>,
        process_id: Option<u32>,
        max_log_entries: usize,
    ) -> Self {
        let timestamp = unix_timestamp_ms();

        Self {
            project_path,
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

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionLogs {
    pub project_path: String,
    pub session_id: u64,
    pub status: TerminalSessionStatus,
    pub limit: usize,
    pub log_line_count: usize,
    pub truncated: bool,
    pub entries: Vec<String>,
    pub updated_at: u64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RawTerminalOutput {
    pub project_path: String,
    pub session_id: u64,
    pub base: usize,
    pub cursor: usize,
    pub chunk: String,
    pub status: TerminalSessionStatus,
}

trait SessionKiller: Send {
    fn kill(&mut self);
}

#[cfg(not(target_os = "windows"))]
struct PtySessionKiller {
    inner: Box<dyn ChildKiller + Send>,
}

#[cfg(not(target_os = "windows"))]
impl SessionKiller for PtySessionKiller {
    fn kill(&mut self) {
        let _ = self.inner.kill();
    }
}

#[cfg(target_os = "windows")]
struct ProcessSessionKiller {
    child: Arc<Mutex<ProcessChild>>,
}

#[cfg(target_os = "windows")]
impl SessionKiller for ProcessSessionKiller {
    fn kill(&mut self) {
        let _ = self.child.lock().unwrap().kill();
    }
}

struct TerminalSession {
    snapshot: TerminalSessionSnapshot,
    logs: VecDeque<String>,
    pending_output: String,
    raw_output: String,
    raw_base: usize,
    child_killer: Option<Box<dyn SessionKiller + Send>>,
    writer: Option<Box<dyn Write + Send>>,
    // Kept so the PTY can be resized to match the xterm viewport. None for the
    // Windows piped-shell path, where there is no PTY to resize.
    master: Option<Box<dyn portable_pty::MasterPty + Send>>,
}

impl TerminalSession {
    fn new(
        snapshot: TerminalSessionSnapshot,
        child_killer: Option<Box<dyn SessionKiller + Send>>,
        writer: Option<Box<dyn Write + Send>>,
    ) -> Self {
        Self {
            snapshot,
            logs: VecDeque::new(),
            pending_output: String::new(),
            raw_output: String::new(),
            raw_base: 0,
            child_killer,
            writer,
            master: None,
        }
    }

    fn set_master(&mut self, master: Box<dyn portable_pty::MasterPty + Send>) {
        self.master = Some(master);
    }

    fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        let rows = rows.max(1);
        let cols = cols.max(1);
        match self.master.as_ref() {
            Some(master) => master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|error| format!("failed to resize terminal: {error}")),
            // Windows piped shell has no PTY; treat resize as a no-op.
            None => Ok(()),
        }
    }

    fn snapshot(&self) -> TerminalSessionSnapshot {
        self.snapshot.clone()
    }

    fn is_interactive(&self) -> bool {
        self.writer.is_some()
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
            killer.kill();
        }

        Ok(())
    }

    fn execute_command(&mut self, command: String) -> Result<(), String> {
        let trimmed = command.trim();
        if trimmed.is_empty() {
            return Err("terminal command cannot be empty".into());
        }

        if is_clear_terminal_command(trimmed) {
            self.clear_logs();
        }

        let Some(writer) = self.writer.as_mut() else {
            return Err("terminal session is not interactive".into());
        };

        let submission = platform::terminal_submission_line(trimmed);
        writer
            .write_all(submission.as_bytes())
            .map_err(|error| format!("failed to write terminal command: {error}"))?;
        writer
            .flush()
            .map_err(|error| format!("failed to flush terminal command: {error}"))?;
        self.touch(format!("command queued: {trimmed}"));
        Ok(())
    }

    fn push_output(&mut self, chunk: &str) {
        self.append_raw_output(chunk);

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

    fn append_raw_output(&mut self, chunk: &str) {
        self.raw_output.push_str(chunk);

        if self.raw_output.len() > RAW_OUTPUT_CAP {
            let overflow = self.raw_output.len() - RAW_OUTPUT_CAP;
            // Advance to a char boundary so we never split a UTF-8 sequence.
            let mut drain_to = overflow;
            while drain_to < self.raw_output.len() && !self.raw_output.is_char_boundary(drain_to) {
                drain_to += 1;
            }
            self.raw_output.drain(..drain_to);
            self.raw_base = self.raw_base.saturating_add(drain_to);
        }
    }

    fn read_raw_output(&self, from: usize) -> RawTerminalOutput {
        let cursor = self.raw_base + self.raw_output.len();
        // Clamp the requested start to what we still retain.
        let start_abs = from.max(self.raw_base).min(cursor);
        let mut start_rel = start_abs - self.raw_base;
        while start_rel < self.raw_output.len() && !self.raw_output.is_char_boundary(start_rel) {
            start_rel += 1;
        }
        let chunk = self.raw_output[start_rel..].to_string();

        RawTerminalOutput {
            project_path: self.snapshot.project_path.clone(),
            session_id: self.snapshot.session_id,
            base: self.raw_base,
            cursor,
            chunk,
            status: self.snapshot.status,
        }
    }

    fn write_input(&mut self, data: &str) -> Result<(), String> {
        let Some(writer) = self.writer.as_mut() else {
            return Err("terminal session is not interactive".into());
        };

        writer
            .write_all(data.as_bytes())
            .map_err(|error| format!("failed to write terminal input: {error}"))?;
        writer
            .flush()
            .map_err(|error| format!("failed to flush terminal input: {error}"))?;
        self.touch("terminal input written");
        Ok(())
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

    fn clear_logs(&mut self) {
        self.logs.clear();
        self.pending_output.clear();
        self.snapshot.log_line_count = 0;
        self.touch("terminal cleared");
    }

    fn record_reader_error(&mut self, message: String) {
        self.snapshot.last_event = Some(format!("reader error: {message}"));
        self.touch("reader error");
    }

    #[cfg(not(target_os = "windows"))]
    fn record_exit(&mut self, exit_result: Result<portable_pty::ExitStatus, String>) {
        match exit_result {
            Ok(status) => {
                let exit_code = Some(status.exit_code() as i32);
                self.record_process_exit(exit_code);
            }
            Err(error) => {
                self.record_process_wait_error(error);
            }
        }
    }

    fn record_process_exit(&mut self, exit_code: Option<i32>) {
        self.snapshot.exit_code = exit_code;
        if self.snapshot.status == TerminalSessionStatus::Running {
            self.snapshot.status = TerminalSessionStatus::Exited;
            self.snapshot.last_event = Some("process exited".into());
        } else if self.snapshot.status == TerminalSessionStatus::Terminated {
            self.snapshot.last_event = Some("process terminated".into());
        }
        self.touch("process exited");
    }

    fn record_process_wait_error(&mut self, error: String) {
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

    fn recent_logs(&self, limit: usize) -> TerminalSessionLogs {
        let limit = limit.clamp(1, self.snapshot.max_log_entries);
        let total = self.logs.len();
        let start = total.saturating_sub(limit);
        let entries = self.logs.iter().skip(start).cloned().collect::<Vec<_>>();

        TerminalSessionLogs {
            project_path: self.snapshot.project_path.clone(),
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

fn canonicalize_project_owner(project_path: &str) -> Result<String, String> {
    validate_project_owner_value(project_path)?;
    let normalized = platform::normalize_project_path(project_path.trim())?;
    let canonical = fs::canonicalize(&normalized).map_err(|error| {
        format!(
            "failed to resolve terminal project path {}: {error}",
            normalized.display()
        )
    })?;
    if !canonical.is_dir() {
        return Err(format!(
            "terminal project path is not a directory: {}",
            canonical.display()
        ));
    }

    Ok(canonical.to_string_lossy().into_owned())
}

fn validate_project_owner_value(project_path: &str) -> Result<(), String> {
    if project_path.trim().is_empty() {
        Err("terminal projectPath cannot be empty".into())
    } else {
        Ok(())
    }
}

fn unix_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

fn is_clear_terminal_command(command: &str) -> bool {
    matches!(
        command.trim().to_ascii_lowercase().as_str(),
        "clear" | "cls"
    )
}

#[cfg(all(test, not(target_os = "windows")))]
mod unix_tests {
    use std::{
        thread,
        time::{Duration, Instant},
    };

    use super::{CreateTerminalSessionRequest, TerminalSessionManager};

    #[test]
    fn raw_output_preserves_terminal_control_sequences() {
        let manager = TerminalSessionManager::new();
        let project_path = std::env::current_dir()
            .unwrap()
            .canonicalize()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let snapshot = manager
            .create_session(CreateTerminalSessionRequest {
                project_path,
                name: Some("raw-output-test".into()),
                cwd: None,
                shell: Some("/bin/sh".into()),
                rows: Some(24),
                cols: Some(80),
                max_log_entries: Some(100),
            })
            .unwrap();
        let expected = "\u{1b}[31mRED\u{1b}[0m \u{1b}]633;Conductor;ProgramStart\u{7}plain";

        manager
            .write_terminal_input(
                &snapshot.project_path,
                snapshot.session_id,
                "printf '\\033[31mRED\\033[0m \\033]633;Conductor;ProgramStart\\007plain\\n'\n"
                    .into(),
            )
            .unwrap();

        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let output = manager
                .read_raw_output(&snapshot.project_path, snapshot.session_id, 0)
                .unwrap();
            if output.chunk.contains(expected) {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "raw PTY output did not contain the expected control sequence: {:?}",
                output.chunk
            );
            thread::sleep(Duration::from_millis(20));
        }

        manager
            .close_session(&snapshot.project_path, snapshot.session_id)
            .unwrap();
    }
}

#[cfg(test)]
mod ownership_tests;

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use std::{
        fs, thread,
        time::{Duration, Instant},
    };

    use super::*;

    fn wait_for_log(
        manager: &TerminalSessionManager,
        project_path: &str,
        session_id: u64,
        needle: &str,
    ) -> Vec<String> {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let logs = manager
                .read_recent_logs(project_path, session_id, Some(200))
                .unwrap();
            if logs.entries.iter().any(|line| line.contains(needle)) {
                return logs.entries;
            }

            assert!(
                Instant::now() < deadline,
                "terminal logs did not contain {needle:?}; status={:?} exit={:?} event={:?} shell={:?} args={:?} logs={:?}",
                {
                    let snapshot = manager
                        .get_session(session_id)
                        .unwrap()
                        .lock()
                        .unwrap()
                        .snapshot();
                    snapshot.status
                },
                {
                    let snapshot = manager
                        .get_session(session_id)
                        .unwrap()
                        .lock()
                        .unwrap()
                        .snapshot();
                    snapshot.exit_code
                },
                {
                    let snapshot = manager
                        .get_session(session_id)
                        .unwrap()
                        .lock()
                        .unwrap()
                        .snapshot();
                    snapshot.last_event
                },
                {
                    let snapshot = manager
                    .get_session(session_id)
                    .unwrap()
                    .lock()
                    .unwrap()
                    .snapshot();
                    snapshot.shell
                },
                {
                    let snapshot = manager
                        .get_session(session_id)
                        .unwrap()
                        .lock()
                        .unwrap()
                        .snapshot();
                    snapshot.shell_args
                },
                logs.entries
            );
            thread::sleep(Duration::from_millis(100));
        }
    }

    #[test]
    fn windows_create_session_with_command_uses_interactive_shell_pty() {
        let manager = TerminalSessionManager::new();
        let project_path = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let snapshot = manager
            .create_session_with_command(CreateTerminalSessionWithCommandRequest {
                session: CreateTerminalSessionRequest {
                    project_path,
                    name: Some("probe".into()),
                    cwd: None,
                    shell: None,
                    rows: None,
                    cols: None,
                    max_log_entries: Some(200),
                },
                command: "whoami".into(),
            })
            .unwrap();

        assert!(snapshot.shell.to_ascii_lowercase().contains("powershell"));
        assert_eq!(snapshot.status, TerminalSessionStatus::Running);
        wait_for_log(&manager, &snapshot.project_path, snapshot.session_id, "\\");
    }

    #[test]
    fn windows_user_terminal_session_uses_interactive_shell_builtins() {
        let root = std::env::temp_dir().join(format!(
            "gtum-pty-shell-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_millis()
        ));
        let child = root.join("child");
        fs::create_dir_all(&child).unwrap();
        fs::write(root.join("root-marker.txt"), "root").unwrap();
        fs::write(child.join("child-marker.txt"), "child").unwrap();

        let manager = TerminalSessionManager::new();
        let snapshot = manager
            .create_session(CreateTerminalSessionRequest {
                project_path: root.to_string_lossy().into_owned(),
                name: Some("user".into()),
                cwd: Some(root.to_string_lossy().into_owned()),
                shell: None,
                rows: None,
                cols: None,
                max_log_entries: Some(200),
            })
            .unwrap();

        assert!(snapshot.shell.to_ascii_lowercase().contains("powershell"));

        manager
            .execute_command(&snapshot.project_path, snapshot.session_id, "dir".into())
            .unwrap();
        wait_for_log(
            &manager,
            &snapshot.project_path,
            snapshot.session_id,
            "root-marker.txt",
        );

        manager
            .execute_command(
                &snapshot.project_path,
                snapshot.session_id,
                "cd child".into(),
            )
            .unwrap();
        manager
            .execute_command(
                &snapshot.project_path,
                snapshot.session_id,
                "Write-Output (Get-Location).Path".into(),
            )
            .unwrap();
        wait_for_log(
            &manager,
            &snapshot.project_path,
            snapshot.session_id,
            child.to_string_lossy().as_ref(),
        );

        manager
            .execute_command(&snapshot.project_path, snapshot.session_id, "ls".into())
            .unwrap();
        wait_for_log(
            &manager,
            &snapshot.project_path,
            snapshot.session_id,
            "child-marker.txt",
        );

        manager
            .execute_command(&snapshot.project_path, snapshot.session_id, "clear".into())
            .unwrap();
        manager
            .execute_command(
                &snapshot.project_path,
                snapshot.session_id,
                "Write-Output GTUM_AFTER_CLEAR".into(),
            )
            .unwrap();
        let logs = wait_for_log(
            &manager,
            &snapshot.project_path,
            snapshot.session_id,
            "GTUM_AFTER_CLEAR",
        );
        assert!(
            !logs.iter().any(|line| line.contains("root-marker.txt")),
            "clear should remove older terminal logs; logs={logs:?}"
        );

        let _ = manager.close_session(&snapshot.project_path, snapshot.session_id);
        let _ = fs::remove_dir_all(root);
    }
}
