use std::{
    collections::{HashMap, VecDeque},
    io::Read,
    path::PathBuf,
    process::{Child, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use crate::runtime::platform;

const DEFAULT_LOG_LIMIT: usize = 400;
const MIN_LOG_LIMIT: usize = 50;
const MAX_LOG_LIMIT: usize = 2_000;

#[derive(Default)]
pub struct AgentJobManager {
    jobs: Mutex<HashMap<u64, Arc<Mutex<AgentJob>>>>,
    next_job_id: AtomicU64,
}

impl AgentJobManager {
    pub fn new() -> Self {
        Self {
            jobs: Mutex::new(HashMap::new()),
            next_job_id: AtomicU64::new(1),
        }
    }

    pub fn create_job(&self, request: CreateAgentJobRequest) -> Result<AgentJobSnapshot, String> {
        let command_line = platform::normalize_terminal_command(&request.command);
        if command_line.is_empty() {
            return Err("agent job command cannot be empty".into());
        }

        let job_id = self.next_job_id.fetch_add(1, Ordering::Relaxed);
        let project_path = platform::normalize_project_path(&request.project_path)?;
        let cwd = std::fs::canonicalize(&project_path).map_err(|error| {
            format!(
                "failed to resolve agent job project path {}: {error}",
                project_path.display()
            )
        })?;
        if !cwd.is_dir() {
            return Err(format!(
                "agent job project path is not a directory: {}",
                cwd.display()
            ));
        }

        let runner = platform::terminal_command_runner(&command_line)?;
        let mut command = platform::command_for_program(&runner.program);
        command
            .args(&runner.args)
            .current_dir(&cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(path_env) = platform::terminal_path_env() {
            command.env("PATH", path_env);
        }

        let mut child = command
            .spawn()
            .map_err(|error| format!("failed to spawn agent job {}: {error}", runner.program))?;
        let process_id = Some(child.id());
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let child = Arc::new(Mutex::new(child));
        let name = request
            .name
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| format!("Agent job {job_id}"));
        let log_limit = request
            .max_log_entries
            .unwrap_or(DEFAULT_LOG_LIMIT)
            .clamp(MIN_LOG_LIMIT, MAX_LOG_LIMIT);
        let snapshot = AgentJobSnapshot::new(
            job_id,
            name,
            command_line.clone(),
            cwd,
            runner.program,
            runner.args,
            process_id,
            log_limit,
        );
        let job = Arc::new(Mutex::new(AgentJob::new(snapshot.clone(), child.clone())));

        {
            let mut job = job.lock().unwrap();
            job.push_line(format!("$ {command_line}"));
        }

        self.jobs.lock().unwrap().insert(job_id, job.clone());
        if let Some(stdout) = stdout {
            self.spawn_reader(job_id, "stdout", stdout, job.clone())?;
        }
        if let Some(stderr) = stderr {
            self.spawn_reader(job_id, "stderr", stderr, job.clone())?;
        }
        self.spawn_reaper(job_id, job, child)?;

        Ok(snapshot)
    }

    pub fn read_logs(&self, job_id: u64, limit: Option<usize>) -> Result<AgentJobLogs, String> {
        let job = self.get_job(job_id)?;
        let job = job.lock().unwrap();
        Ok(job.recent_logs(limit.unwrap_or(100)))
    }

    pub fn cancel_job(&self, job_id: u64) -> Result<AgentJobSnapshot, String> {
        let job = self.get_job(job_id)?;
        let mut job = job.lock().unwrap();
        job.cancel()?;
        Ok(job.snapshot())
    }

    fn get_job(&self, job_id: u64) -> Result<Arc<Mutex<AgentJob>>, String> {
        self.jobs
            .lock()
            .unwrap()
            .get(&job_id)
            .cloned()
            .ok_or_else(|| format!("agent job not found: {job_id}"))
    }

    fn spawn_reader<R>(
        &self,
        job_id: u64,
        stream_name: &'static str,
        mut reader: R,
        job: Arc<Mutex<AgentJob>>,
    ) -> Result<(), String>
    where
        R: Read + Send + 'static,
    {
        thread::Builder::new()
            .name(format!("gtum-agent-job-{stream_name}-{job_id}"))
            .spawn(move || {
                let mut buffer = [0_u8; 4_096];
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) => break,
                        Ok(read_size) => {
                            let chunk = String::from_utf8_lossy(&buffer[..read_size]).into_owned();
                            let mut job = job.lock().unwrap();
                            job.push_output(&chunk);
                        }
                        Err(error) => {
                            let mut job = job.lock().unwrap();
                            job.record_error(format!("{stream_name}: {error}"));
                            break;
                        }
                    }
                }

                let mut job = job.lock().unwrap();
                job.flush_pending_output();
            })
            .map_err(|error| format!("failed to start agent job {stream_name} reader: {error}"))?;

        Ok(())
    }

    fn spawn_reaper(
        &self,
        job_id: u64,
        job: Arc<Mutex<AgentJob>>,
        child: Arc<Mutex<Child>>,
    ) -> Result<(), String> {
        thread::Builder::new()
            .name(format!("gtum-agent-job-reaper-{job_id}"))
            .spawn(move || loop {
                let wait_result = {
                    let mut child = child.lock().unwrap();
                    child.try_wait()
                };

                match wait_result {
                    Ok(Some(status)) => {
                        let mut job = job.lock().unwrap();
                        job.record_exit(status.code());
                        break;
                    }
                    Ok(None) => thread::sleep(Duration::from_millis(200)),
                    Err(error) => {
                        let mut job = job.lock().unwrap();
                        job.record_error(format!("process wait failed: {error}"));
                        break;
                    }
                }
            })
            .map_err(|error| format!("failed to start agent job reaper: {error}"))?;

        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentJobRequest {
    pub project_path: String,
    pub command: String,
    pub name: Option<String>,
    pub max_log_entries: Option<usize>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentJobSnapshot {
    pub job_id: u64,
    pub name: String,
    pub command: String,
    pub cwd: String,
    pub runner: String,
    pub runner_args: Vec<String>,
    pub process_id: Option<u32>,
    pub status: AgentJobStatus,
    pub created_at: u64,
    pub updated_at: u64,
    pub exit_code: Option<i32>,
    pub log_line_count: usize,
    pub max_log_entries: usize,
    pub last_event: Option<String>,
}

impl AgentJobSnapshot {
    fn new(
        job_id: u64,
        name: String,
        command: String,
        cwd: PathBuf,
        runner: String,
        runner_args: Vec<String>,
        process_id: Option<u32>,
        max_log_entries: usize,
    ) -> Self {
        let timestamp = unix_timestamp_ms();

        Self {
            job_id,
            name,
            command,
            cwd: cwd.to_string_lossy().into_owned(),
            runner,
            runner_args,
            process_id,
            status: AgentJobStatus::Running,
            created_at: timestamp,
            updated_at: timestamp,
            exit_code: None,
            log_line_count: 0,
            max_log_entries,
            last_event: Some("agent job created".into()),
        }
    }
}

#[derive(Serialize, Clone, Copy, Debug, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AgentJobStatus {
    Running,
    Exited,
    Cancelled,
    Failed,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentJobLogs {
    pub job_id: u64,
    pub status: AgentJobStatus,
    pub limit: usize,
    pub log_line_count: usize,
    pub truncated: bool,
    pub entries: Vec<String>,
    pub updated_at: u64,
}

struct AgentJob {
    snapshot: AgentJobSnapshot,
    logs: VecDeque<String>,
    pending_output: String,
    child: Arc<Mutex<Child>>,
}

impl AgentJob {
    fn new(snapshot: AgentJobSnapshot, child: Arc<Mutex<Child>>) -> Self {
        Self {
            snapshot,
            logs: VecDeque::new(),
            pending_output: String::new(),
            child,
        }
    }

    fn snapshot(&self) -> AgentJobSnapshot {
        self.snapshot.clone()
    }

    fn cancel(&mut self) -> Result<(), String> {
        if !matches!(self.snapshot.status, AgentJobStatus::Running) {
            return Ok(());
        }

        self.child
            .lock()
            .unwrap()
            .kill()
            .map_err(|error| format!("failed to cancel agent job: {error}"))?;
        self.snapshot.status = AgentJobStatus::Cancelled;
        self.touch("agent job cancellation requested");
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
        self.touch("agent job output received");
    }

    fn record_exit(&mut self, exit_code: Option<i32>) {
        self.snapshot.exit_code = exit_code;
        if self.snapshot.status == AgentJobStatus::Running {
            self.snapshot.status = AgentJobStatus::Exited;
            self.snapshot.last_event = Some("agent job exited".into());
        } else if self.snapshot.status == AgentJobStatus::Cancelled {
            self.snapshot.last_event = Some("agent job cancelled".into());
        }
        self.touch("agent job exited");
    }

    fn record_error(&mut self, message: String) {
        if self.snapshot.status == AgentJobStatus::Running {
            self.snapshot.status = AgentJobStatus::Failed;
        }
        self.snapshot.last_event = Some(message);
        self.touch("agent job error");
    }

    fn recent_logs(&self, limit: usize) -> AgentJobLogs {
        let limit = limit.clamp(1, self.snapshot.max_log_entries);
        let total = self.logs.len();
        let start = total.saturating_sub(limit);

        AgentJobLogs {
            job_id: self.snapshot.job_id,
            status: self.snapshot.status,
            limit,
            log_line_count: total,
            truncated: total > limit,
            entries: self.logs.iter().skip(start).cloned().collect(),
            updated_at: self.snapshot.updated_at,
        }
    }

    fn touch(&mut self, event: impl Into<String>) {
        self.snapshot.updated_at = unix_timestamp_ms();
        self.snapshot.last_event = Some(event.into());
    }
}

fn unix_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or_default()
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use std::time::Instant;

    use super::*;

    #[test]
    fn windows_agent_job_uses_shell_free_hidden_process() {
        let manager = AgentJobManager::new();
        let snapshot = manager
            .create_job(CreateAgentJobRequest {
                project_path: std::env::current_dir()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned(),
                command: "whoami".into(),
                name: Some("probe".into()),
                max_log_entries: Some(200),
            })
            .unwrap();

        assert!(snapshot.runner.to_ascii_lowercase().ends_with("whoami.exe"));
        assert!(snapshot.runner_args.is_empty());

        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let logs = manager.read_logs(snapshot.job_id, Some(200)).unwrap();
            let final_snapshot = manager
                .get_job(snapshot.job_id)
                .unwrap()
                .lock()
                .unwrap()
                .snapshot();

            if logs.entries.iter().any(|line| !line.trim().is_empty())
                && final_snapshot.status == AgentJobStatus::Exited
            {
                assert_eq!(final_snapshot.exit_code, Some(0));
                break;
            }

            assert!(
                Instant::now() < deadline,
                "agent job did not finish in time; status={:?} event={:?} logs={:?}",
                final_snapshot.status,
                final_snapshot.last_event,
                logs.entries
            );
            thread::sleep(Duration::from_millis(100));
        }
    }
}
