use std::{
    collections::{HashMap, VecDeque},
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{sync_channel, SyncSender, TrySendError},
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
const DEFAULT_LIST_LIMIT: usize = 25;
const MAX_LIST_LIMIT: usize = 100;
const MAX_PERSISTED_JOBS: usize = 100;
const MAX_LOG_ENTRY_BYTES: usize = 16 * 1024;
const AGENT_JOB_STORAGE_VERSION: u32 = 1;
const PERSIST_COALESCE_DELAY: Duration = Duration::from_millis(40);
const MAX_PERSIST_RETRIES: usize = 5;
const PERSIST_RETRY_BASE_DELAY: Duration = Duration::from_millis(50);
const SHUTDOWN_DRAIN_TIMEOUT: Duration = Duration::from_secs(3);

type SharedJob = Arc<Mutex<AgentJob>>;
type SharedJobs = Arc<Mutex<HashMap<u64, SharedJob>>>;

#[derive(Clone)]
struct ProcessTree {
    #[cfg(unix)]
    process_group_id: i32,
    #[cfg(target_os = "windows")]
    job: Arc<WindowsJobObject>,
}

impl ProcessTree {
    fn configure(command: &mut Command) -> Result<(), String> {
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            command.process_group(0);
        }
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;

            const CREATE_SUSPENDED: u32 = 0x0000_0004;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            command.creation_flags(CREATE_SUSPENDED | CREATE_NO_WINDOW);
        }
        let _ = command;
        Ok(())
    }

    fn attach(child: &Child) -> Result<Self, String> {
        #[cfg(unix)]
        {
            return Ok(Self {
                process_group_id: child.id() as i32,
            });
        }

        #[cfg(target_os = "windows")]
        {
            return WindowsJobObject::attach(child).map(|job| Self { job: Arc::new(job) });
        }

        #[allow(unreachable_code)]
        Err("agent job process-tree ownership is unsupported on this platform".into())
    }

    fn terminate(&self) -> Result<(), String> {
        #[cfg(unix)]
        {
            extern "C" {
                fn kill(process_id: i32, signal: i32) -> i32;
            }

            let result = unsafe { kill(-self.process_group_id, 9) };
            if result == 0 {
                return Ok(());
            }
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() == Some(3) {
                return Ok(());
            }
            return Err(format!(
                "failed to terminate agent job process group: {error}"
            ));
        }

        #[cfg(target_os = "windows")]
        {
            return self.job.terminate();
        }

        #[allow(unreachable_code)]
        Err("agent job process-tree termination is unsupported on this platform".into())
    }
}

#[cfg(target_os = "windows")]
struct WindowsJobObject {
    handle: isize,
}

#[cfg(target_os = "windows")]
impl WindowsJobObject {
    fn attach(child: &Child) -> Result<Self, String> {
        use std::{ffi::c_void, mem, os::windows::io::AsRawHandle, ptr};

        #[repr(C)]
        #[derive(Default)]
        struct BasicLimitInformation {
            per_process_user_time_limit: i64,
            per_job_user_time_limit: i64,
            limit_flags: u32,
            minimum_working_set_size: usize,
            maximum_working_set_size: usize,
            active_process_limit: u32,
            affinity: usize,
            priority_class: u32,
            scheduling_class: u32,
        }

        #[repr(C)]
        #[derive(Default)]
        struct IoCounters {
            read_operation_count: u64,
            write_operation_count: u64,
            other_operation_count: u64,
            read_transfer_count: u64,
            write_transfer_count: u64,
            other_transfer_count: u64,
        }

        #[repr(C)]
        #[derive(Default)]
        struct ExtendedLimitInformation {
            basic_limit_information: BasicLimitInformation,
            io_info: IoCounters,
            process_memory_limit: usize,
            job_memory_limit: usize,
            peak_process_memory_used: usize,
            peak_job_memory_used: usize,
        }

        #[link(name = "Kernel32")]
        extern "system" {
            fn CreateJobObjectW(attributes: *const c_void, name: *const u16) -> *mut c_void;
            fn SetInformationJobObject(
                job: *mut c_void,
                information_class: i32,
                information: *const c_void,
                information_length: u32,
            ) -> i32;
            fn AssignProcessToJobObject(job: *mut c_void, process: *mut c_void) -> i32;
            fn TerminateJobObject(job: *mut c_void, exit_code: u32) -> i32;
            fn CloseHandle(handle: *mut c_void) -> i32;
        }
        #[link(name = "ntdll")]
        extern "system" {
            fn NtResumeProcess(process: *mut c_void) -> i32;
        }

        const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION: i32 = 9;
        const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE: u32 = 0x0000_2000;

        let handle = unsafe { CreateJobObjectW(ptr::null(), ptr::null()) };
        if handle.is_null() {
            return Err(format!(
                "failed to create agent job Windows Job Object: {}",
                std::io::Error::last_os_error()
            ));
        }

        let mut information = ExtendedLimitInformation::default();
        information.basic_limit_information.limit_flags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let configured = unsafe {
            SetInformationJobObject(
                handle,
                JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
                &information as *const _ as *const c_void,
                mem::size_of::<ExtendedLimitInformation>() as u32,
            )
        };
        if configured == 0 {
            let error = std::io::Error::last_os_error();
            unsafe {
                CloseHandle(handle);
            }
            return Err(format!(
                "failed to configure agent job Windows Job Object: {error}"
            ));
        }

        let assigned =
            unsafe { AssignProcessToJobObject(handle, child.as_raw_handle() as *mut c_void) };
        if assigned == 0 {
            let error = std::io::Error::last_os_error();
            unsafe {
                CloseHandle(handle);
            }
            return Err(format!(
                "failed to assign agent process to Windows Job Object: {error}"
            ));
        }

        let resumed = unsafe { NtResumeProcess(child.as_raw_handle() as *mut c_void) };
        if resumed < 0 {
            unsafe {
                TerminateJobObject(handle, 1);
                CloseHandle(handle);
            }
            return Err(format!(
                "failed to resume agent process after Windows Job Object assignment: NTSTATUS {resumed:#010x}"
            ));
        }

        Ok(Self {
            handle: handle as isize,
        })
    }

    fn terminate(&self) -> Result<(), String> {
        use std::ffi::c_void;

        #[link(name = "Kernel32")]
        extern "system" {
            fn TerminateJobObject(job: *mut c_void, exit_code: u32) -> i32;
        }

        let terminated = unsafe { TerminateJobObject(self.handle as *mut c_void, 1) };
        if terminated == 0 {
            Err(format!(
                "failed to terminate agent job Windows Job Object: {}",
                std::io::Error::last_os_error()
            ))
        } else {
            Ok(())
        }
    }
}

#[cfg(target_os = "windows")]
impl Drop for WindowsJobObject {
    fn drop(&mut self) {
        use std::ffi::c_void;

        #[link(name = "Kernel32")]
        extern "system" {
            fn CloseHandle(handle: *mut c_void) -> i32;
        }

        unsafe {
            CloseHandle(self.handle as *mut c_void);
        }
    }
}

pub struct AgentJobManager {
    jobs: SharedJobs,
    next_job_id: AtomicU64,
    create_lock: Mutex<()>,
    persistence: AgentJobPersistence,
}

impl Drop for AgentJobManager {
    fn drop(&mut self) {
        let handles = self
            .jobs
            .lock()
            .unwrap()
            .values()
            .cloned()
            .collect::<Vec<_>>();
        for job in &handles {
            job.lock().unwrap().request_shutdown();
        }
        for job in &handles {
            let (child, process_tree) = {
                let job = job.lock().unwrap();
                (job.child.clone(), job.process_tree.clone())
            };
            if let Some(child) = child {
                if let Err(error) = kill_and_wait(process_tree.as_ref(), &child) {
                    log::warn!("failed to clean up agent job during shutdown: {error}");
                }
            }
        }

        let drain_deadline = SystemTime::now() + SHUTDOWN_DRAIN_TIMEOUT;
        while handles.iter().any(|job| {
            let job = job.lock().unwrap();
            job.shutdown_requested && job.active_readers > 0
        }) {
            if SystemTime::now() >= drain_deadline {
                log::warn!("timed out draining agent job output during shutdown");
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }

        for job in &handles {
            job.lock().unwrap().stage_shutdown_interruption();
        }
        match self.persistence.persist_now() {
            Ok(terminals) => publish_persisted_terminals(&self.jobs, &terminals),
            Err(error) => log::warn!("failed to persist agent jobs during shutdown: {error}"),
        }
    }
}

impl Default for AgentJobManager {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentJobManager {
    pub fn new() -> Self {
        let jobs = Arc::new(Mutex::new(HashMap::new()));
        Self {
            jobs: jobs.clone(),
            next_job_id: AtomicU64::new(1),
            create_lock: Mutex::new(()),
            persistence: AgentJobPersistence::new(jobs),
        }
    }

    pub fn initialize_storage(&self, storage_path: PathBuf) -> Result<(), String> {
        if let Some(parent) = storage_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("failed to prepare agent job state directory: {error}"))?;
        }

        self.persistence.set_storage_path(storage_path.clone());
        let records = if storage_path.exists() {
            match load_store(&storage_path) {
                Ok(store) if store.storage_version == AGENT_JOB_STORAGE_VERSION => store.jobs,
                Ok(store) => {
                    log::warn!(
                        "unsupported agent job storage version {}; starting with an empty store",
                        store.storage_version
                    );
                    if let Err(error) = backup_invalid_store(&storage_path) {
                        log::warn!("failed to back up unsupported agent job state: {error}");
                    }
                    Vec::new()
                }
                Err(error) => {
                    log::warn!("failed to load agent job state: {error}");
                    if let Err(error) = backup_invalid_store(&storage_path) {
                        log::warn!("failed to back up malformed agent job state: {error}");
                    }
                    Vec::new()
                }
            }
        } else {
            Vec::new()
        };

        let records = bound_loaded_records(records);
        let mut jobs = HashMap::new();
        let mut next_job_id = 1_u64;
        for record in records {
            let (record, pending_terminal_status) = normalize_persisted_job(record);
            next_job_id = next_job_id.max(record.snapshot.job_id.saturating_add(1));
            jobs.insert(
                record.snapshot.job_id,
                Arc::new(Mutex::new(AgentJob::restored_with_pending(
                    record.project_key,
                    record.snapshot,
                    record.logs,
                    pending_terminal_status,
                ))),
            );
        }

        *self.jobs.lock().unwrap() = jobs;
        self.next_job_id.store(next_job_id, Ordering::Relaxed);
        prune_terminal_jobs(&self.jobs);
        if let Err(error) = self.persistence.start_writer() {
            log::warn!("failed to start agent job persistence worker: {error}");
        }
        match self.persistence.persist_now() {
            Ok(terminals) => publish_persisted_terminals(&self.jobs, &terminals),
            Err(error) => {
                log::warn!("failed to initialize agent job state: {error}");
                self.persistence.schedule();
            }
        }
        Ok(())
    }

    pub fn create_job(&self, request: CreateAgentJobRequest) -> Result<AgentJobSnapshot, String> {
        let command_line = platform::normalize_terminal_command(&request.command);
        if command_line.is_empty() {
            return Err("agent job command cannot be empty".into());
        }

        let (cwd, project_key) = canonical_project_scope(&request.project_path)?;
        let create_guard = self.create_lock.lock().unwrap();
        ensure_job_capacity(&self.jobs)?;
        let job_id = self.next_job_id.fetch_add(1, Ordering::Relaxed);
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
        ProcessTree::configure(&mut command)?;

        let mut child = command
            .spawn()
            .map_err(|error| format!("failed to spawn agent job {}: {error}", runner.program))?;
        let process_tree = match ProcessTree::attach(&child) {
            Ok(process_tree) => process_tree,
            Err(error) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(error);
            }
        };
        let process_id = Some(child.id());
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        let reader_count = usize::from(stdout.is_some()) + usize::from(stderr.is_some());
        let child = Arc::new(Mutex::new(child));
        let name = request
            .name
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| format!("Agent job {job_id}"));
        let log_limit = request
            .max_log_entries
            .unwrap_or(DEFAULT_LOG_LIMIT)
            .clamp(MIN_LOG_LIMIT, MAX_LOG_LIMIT);
        let mut snapshot = AgentJobSnapshot::new(
            job_id,
            name,
            command_line.clone(),
            cwd,
            runner.program,
            runner.args,
            process_id,
            log_limit,
        );
        snapshot.session_id = request.session_id;
        let job = Arc::new(Mutex::new(AgentJob::new(
            project_key,
            snapshot,
            child.clone(),
            process_tree,
            reader_count,
        )));

        {
            let mut job = job.lock().unwrap();
            job.push_line(AgentJobLogStream::Command, command_line);
        }

        make_room_for_new_job(&self.jobs)?;
        self.jobs.lock().unwrap().insert(job_id, job.clone());
        drop(create_guard);

        if let Some(stdout) = stdout {
            if let Err(error) =
                self.spawn_reader(job_id, AgentJobLogStream::Stdout, stdout, job.clone())
            {
                record_reader_start_failure(&job, &self.persistence, error);
            }
        }
        if let Some(stderr) = stderr {
            if let Err(error) =
                self.spawn_reader(job_id, AgentJobLogStream::Stderr, stderr, job.clone())
            {
                record_reader_start_failure(&job, &self.persistence, error);
            }
        }
        if let Err(error) = self.spawn_reaper(job_id, job.clone(), child) {
            let ownership = {
                let job = job.lock().unwrap();
                job.child.clone().zip(job.process_tree.clone())
            };
            let recovery = ownership
                .ok_or_else(|| "agent job process ownership is unavailable".to_string())
                .and_then(|(child, process_tree)| kill_and_wait(Some(&process_tree), &child));
            let became_terminal = {
                let mut job = job.lock().unwrap();
                job.record_process_error(error);
                match recovery {
                    Ok(exit_code) => job.record_exit(exit_code),
                    Err(error) => {
                        job.record_tracking_error(error);
                        false
                    }
                }
            };
            persist_job_update(&self.jobs, &self.persistence, &job, became_terminal);
        }

        match self.persistence.persist_now() {
            Ok(terminals) => publish_persisted_terminals(&self.jobs, &terminals),
            Err(error) => {
                log::warn!("failed to persist newly created agent job: {error}");
                job.lock().unwrap().record_persistence_error(error);
                self.persistence.schedule();
            }
        }

        let snapshot = job.lock().unwrap().snapshot();
        Ok(snapshot)
    }

    pub fn list_jobs(
        &self,
        project_path: &str,
        limit: Option<usize>,
    ) -> Result<Vec<AgentJobSnapshot>, String> {
        self.list_jobs_for_session(project_path, None, limit)
    }

    pub fn list_jobs_for_session(
        &self,
        project_path: &str,
        session_id: Option<&str>,
        limit: Option<usize>,
    ) -> Result<Vec<AgentJobSnapshot>, String> {
        let (_, project_key) = canonical_project_scope(project_path)?;
        let limit = limit.unwrap_or(DEFAULT_LIST_LIMIT).clamp(1, MAX_LIST_LIMIT);
        let handles = self
            .jobs
            .lock()
            .unwrap()
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let mut snapshots = handles
            .into_iter()
            .filter_map(|job| {
                let job = job.lock().unwrap();
                let project_matches = job.project_key == project_key;
                let session_matches = match session_id {
                    Some(session_id) => job.snapshot.session_id.as_deref() == Some(session_id),
                    None => true,
                };
                (project_matches && session_matches).then(|| job.snapshot())
            })
            .collect::<Vec<_>>();
        snapshots.sort_by(|left, right| {
            right
                .updated_at
                .cmp(&left.updated_at)
                .then_with(|| right.job_id.cmp(&left.job_id))
        });
        snapshots.truncate(limit);
        Ok(snapshots)
    }

    pub fn read_logs(
        &self,
        project_path: &str,
        job_id: u64,
        limit: Option<usize>,
    ) -> Result<AgentJobLogs, String> {
        let job = self.get_owned_job(project_path, job_id)?;
        let job = job.lock().unwrap();
        Ok(job.recent_logs(limit.unwrap_or(100)))
    }

    pub fn cancel_job(&self, project_path: &str, job_id: u64) -> Result<AgentJobSnapshot, String> {
        let job = self.get_owned_job(project_path, job_id)?;
        let changed = {
            let mut job = job.lock().unwrap();
            job.cancel()?
        };
        if changed {
            match self.persistence.persist_now() {
                Ok(terminals) => publish_persisted_terminals(&self.jobs, &terminals),
                Err(error) => {
                    log::warn!("failed to persist agent job cancellation: {error}");
                    job.lock().unwrap().record_persistence_error(error);
                    self.persistence.schedule();
                }
            }
        }
        let snapshot = job.lock().unwrap().snapshot();
        Ok(snapshot)
    }

    fn get_owned_job(&self, project_path: &str, job_id: u64) -> Result<SharedJob, String> {
        let (_, project_key) = canonical_project_scope(project_path)?;
        let job = self
            .jobs
            .lock()
            .unwrap()
            .get(&job_id)
            .cloned()
            .ok_or_else(|| format!("agent job not found: {job_id}"))?;
        if job.lock().unwrap().project_key != project_key {
            return Err(format!(
                "agent job {job_id} does not belong to project {project_path}"
            ));
        }
        Ok(job)
    }

    fn spawn_reader<R>(
        &self,
        job_id: u64,
        stream: AgentJobLogStream,
        reader: R,
        job: SharedJob,
    ) -> Result<(), String>
    where
        R: Read + Send + 'static,
    {
        let jobs = self.jobs.clone();
        let persistence = self.persistence.clone();
        thread::Builder::new()
            .name(format!("gtum-agent-job-{}-{job_id}", stream.as_key()))
            .spawn(move || {
                let mut reader = reader;
                let mut read_buffer = [0_u8; 8 * 1024];
                let mut decoder = BoundedLogDecoder::default();
                loop {
                    match reader.read(&mut read_buffer) {
                        Ok(0) => break,
                        Ok(read) => {
                            for line in decoder.feed(&read_buffer[..read]) {
                                job.lock().unwrap().push_line(stream, line);
                                persistence.schedule();
                            }
                        }
                        Err(error) => {
                            job.lock()
                                .unwrap()
                                .record_log_capture_error(format!("{}: {error}", stream.as_key()));
                            persistence.schedule();
                            break;
                        }
                    }
                }
                for line in decoder.finish() {
                    job.lock().unwrap().push_line(stream, line);
                    persistence.schedule();
                }

                let became_terminal = job.lock().unwrap().reader_finished();
                persist_job_update(&jobs, &persistence, &job, became_terminal);
            })
            .map(|_| ())
            .map_err(|error| {
                format!(
                    "failed to start agent job {} reader: {error}",
                    stream.as_key()
                )
            })
    }

    fn spawn_reaper(
        &self,
        job_id: u64,
        job: SharedJob,
        child: Arc<Mutex<Child>>,
    ) -> Result<(), String> {
        let jobs = self.jobs.clone();
        let persistence = self.persistence.clone();
        thread::Builder::new()
            .name(format!("gtum-agent-job-reaper-{job_id}"))
            .spawn(move || loop {
                let wait_result = {
                    let mut child = child.lock().unwrap();
                    child.try_wait()
                };

                match wait_result {
                    Ok(Some(status)) => {
                        let (became_terminal, process_tree_terminated) = {
                            let mut job = job.lock().unwrap();
                            let became_terminal = job.record_exit(status.code());
                            (became_terminal, job.process_tree_terminated)
                        };
                        persist_job_update(&jobs, &persistence, &job, became_terminal);
                        if process_tree_terminated {
                            break;
                        }
                        thread::sleep(Duration::from_millis(250));
                    }
                    Ok(None) => thread::sleep(Duration::from_millis(100)),
                    Err(error) => {
                        let process_tree = job.lock().unwrap().process_tree.clone();
                        let recovery = kill_and_wait(process_tree.as_ref(), &child);
                        let became_terminal = {
                            let mut job = job.lock().unwrap();
                            job.record_process_error(format!("process wait failed: {error}"));
                            match recovery {
                                Ok(exit_code) => job.record_exit(exit_code),
                                Err(error) => {
                                    job.record_tracking_error(error);
                                    false
                                }
                            }
                        };
                        persist_job_update(&jobs, &persistence, &job, became_terminal);
                        if became_terminal {
                            break;
                        }
                        thread::sleep(Duration::from_millis(250));
                    }
                }
            })
            .map(|_| ())
            .map_err(|error| format!("failed to start agent job reaper: {error}"))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateAgentJobRequest {
    pub project_path: String,
    pub command: String,
    pub name: Option<String>,
    pub max_log_entries: Option<usize>,
    #[serde(default)]
    pub session_id: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgentJobSnapshot {
    pub job_id: u64,
    #[serde(default)]
    pub session_id: Option<String>,
    pub name: String,
    pub command: String,
    pub cwd: String,
    pub runner: String,
    pub runner_args: Vec<String>,
    pub process_id: Option<u32>,
    pub status: AgentJobStatus,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default)]
    pub finished_at: Option<u64>,
    #[serde(default)]
    pub cancellation_requested_at: Option<u64>,
    pub exit_code: Option<i32>,
    #[serde(default)]
    pub logs_complete: bool,
    #[serde(default)]
    pub log_capture_error: Option<String>,
    #[serde(default)]
    pub process_error: Option<String>,
    #[serde(default)]
    pub persistence_error: Option<String>,
    pub log_line_count: u64,
    pub max_log_entries: usize,
    pub last_event: Option<String>,
}

impl AgentJobSnapshot {
    #[allow(clippy::too_many_arguments)]
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
            session_id: None,
            name,
            command,
            cwd: cwd.to_string_lossy().into_owned(),
            runner,
            runner_args,
            process_id,
            status: AgentJobStatus::Running,
            created_at: timestamp,
            updated_at: timestamp,
            finished_at: None,
            cancellation_requested_at: None,
            exit_code: None,
            logs_complete: false,
            log_capture_error: None,
            process_error: None,
            persistence_error: None,
            log_line_count: 0,
            max_log_entries,
            last_event: Some("agent job created".into()),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AgentJobStatus {
    Running,
    Cancelling,
    Completed,
    Failed,
    Cancelled,
    Interrupted,
}

impl AgentJobStatus {
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            Self::Completed | Self::Failed | Self::Cancelled | Self::Interrupted
        )
    }

    fn is_active(self) -> bool {
        matches!(self, Self::Running | Self::Cancelling)
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum AgentJobLogStream {
    Command,
    Stdout,
    Stderr,
    System,
}

impl AgentJobLogStream {
    fn as_key(self) -> &'static str {
        match self {
            Self::Command => "command",
            Self::Stdout => "stdout",
            Self::Stderr => "stderr",
            Self::System => "system",
        }
    }
}

#[derive(Default)]
struct BoundedLogDecoder {
    buffer: Vec<u8>,
    emitted_chunk_for_line: bool,
}

impl BoundedLogDecoder {
    fn feed(&mut self, bytes: &[u8]) -> Vec<String> {
        let mut entries = Vec::new();
        for byte in bytes {
            if *byte == b'\n' {
                if !(self.buffer.is_empty() && self.emitted_chunk_for_line) {
                    if self.buffer.last() == Some(&b'\r') {
                        self.buffer.pop();
                    }
                    entries.push(String::from_utf8_lossy(&self.buffer).into_owned());
                }
                self.buffer.clear();
                self.emitted_chunk_for_line = false;
                continue;
            }

            self.buffer.push(*byte);
            if self.buffer.len() == MAX_LOG_ENTRY_BYTES {
                entries.push(self.take_bounded_chunk());
                self.emitted_chunk_for_line = true;
            }
        }
        entries
    }

    fn finish(&mut self) -> Vec<String> {
        if self.buffer.is_empty() {
            return Vec::new();
        }
        let entry = String::from_utf8_lossy(&self.buffer).into_owned();
        self.buffer.clear();
        self.emitted_chunk_for_line = false;
        vec![entry]
    }

    fn take_bounded_chunk(&mut self) -> String {
        let split_at = match std::str::from_utf8(&self.buffer) {
            Ok(_) => self.buffer.len(),
            Err(error) if error.error_len().is_none() && error.valid_up_to() > 0 => {
                error.valid_up_to()
            }
            Err(_) => self.buffer.len(),
        };
        let remaining = self.buffer.split_off(split_at);
        let chunk = String::from_utf8_lossy(&self.buffer).into_owned();
        self.buffer = remaining;
        chunk
    }

    #[cfg(test)]
    fn buffered_len(&self) -> usize {
        self.buffer.len()
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentJobLogEntry {
    pub sequence: u64,
    pub stream: AgentJobLogStream,
    pub text: String,
    pub recorded_at: u64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AgentJobLogs {
    pub job_id: u64,
    pub status: AgentJobStatus,
    pub limit: usize,
    pub log_line_count: u64,
    pub truncated: bool,
    pub entries: Vec<AgentJobLogEntry>,
    pub updated_at: u64,
    pub finished_at: Option<u64>,
    pub cancellation_requested_at: Option<u64>,
    pub exit_code: Option<i32>,
    pub logs_complete: bool,
    pub log_capture_error: Option<String>,
    pub process_error: Option<String>,
    pub persistence_error: Option<String>,
    pub last_event: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentJobStore {
    storage_version: u32,
    jobs: Vec<PersistedAgentJob>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PersistedAgentJob {
    #[serde(default)]
    project_key: String,
    snapshot: AgentJobSnapshot,
    #[serde(default)]
    logs: Vec<AgentJobLogEntry>,
}

struct AgentJob {
    project_key: String,
    snapshot: AgentJobSnapshot,
    logs: VecDeque<AgentJobLogEntry>,
    child: Option<Arc<Mutex<Child>>>,
    process_tree: Option<ProcessTree>,
    process_tree_terminated: bool,
    shutdown_requested: bool,
    active_readers: usize,
    exit_observed: bool,
    pending_terminal_status: Option<AgentJobStatus>,
}

impl AgentJob {
    fn new(
        project_key: String,
        snapshot: AgentJobSnapshot,
        child: Arc<Mutex<Child>>,
        process_tree: ProcessTree,
        active_readers: usize,
    ) -> Self {
        Self {
            project_key,
            snapshot,
            logs: VecDeque::new(),
            child: Some(child),
            process_tree: Some(process_tree),
            process_tree_terminated: false,
            shutdown_requested: false,
            active_readers,
            exit_observed: false,
            pending_terminal_status: None,
        }
    }

    #[cfg(test)]
    fn restored(
        project_key: String,
        snapshot: AgentJobSnapshot,
        logs: Vec<AgentJobLogEntry>,
    ) -> Self {
        Self::restored_with_pending(project_key, snapshot, logs, None)
    }

    fn restored_with_pending(
        project_key: String,
        snapshot: AgentJobSnapshot,
        logs: Vec<AgentJobLogEntry>,
        pending_terminal_status: Option<AgentJobStatus>,
    ) -> Self {
        Self {
            project_key,
            snapshot,
            logs: logs.into(),
            child: None,
            process_tree: None,
            process_tree_terminated: true,
            shutdown_requested: false,
            active_readers: 0,
            exit_observed: true,
            pending_terminal_status,
        }
    }

    fn snapshot(&self) -> AgentJobSnapshot {
        let mut snapshot = self.snapshot.clone();
        if self.pending_terminal_status.is_some() {
            snapshot.finished_at = None;
            snapshot.logs_complete = false;
            snapshot.last_event = snapshot
                .persistence_error
                .as_ref()
                .map(|error| format!("agent job state persistence failed: {error}"))
                .or_else(|| Some("agent job finalizing".into()));
        }
        snapshot
    }

    fn cancel(&mut self) -> Result<bool, String> {
        if self.pending_terminal_status.is_some() {
            return Ok(false);
        }
        match self.snapshot.status {
            AgentJobStatus::Running => {
                let child = self
                    .child
                    .as_ref()
                    .ok_or_else(|| "running agent job has no process handle".to_string())?;
                let process_tree = self
                    .process_tree
                    .as_ref()
                    .ok_or_else(|| "running agent job has no process-tree ownership".to_string())?;
                if let Err(tree_error) = process_tree.terminate() {
                    let direct_error = child.lock().unwrap().kill().err();
                    return Err(match direct_error {
                        Some(error) => format!(
                            "failed to cancel agent job tree: {tree_error}; direct process termination also failed: {error}"
                        ),
                        None => format!("failed to cancel the complete agent job tree: {tree_error}"),
                    });
                }
                let now = unix_timestamp_ms();
                self.snapshot.status = AgentJobStatus::Cancelling;
                self.snapshot.cancellation_requested_at = Some(now);
                self.snapshot.updated_at = now;
                self.snapshot.last_event = Some("agent job cancellation requested".into());
                Ok(true)
            }
            AgentJobStatus::Cancelling => Ok(false),
            status if status.is_terminal() => Ok(false),
            _ => Ok(false),
        }
    }

    fn push_line(&mut self, stream: AgentJobLogStream, text: String) {
        let sequence = self.snapshot.log_line_count.saturating_add(1);
        let recorded_at = unix_timestamp_ms();
        self.logs.push_back(AgentJobLogEntry {
            sequence,
            stream,
            text,
            recorded_at,
        });
        while self.logs.len() > self.snapshot.max_log_entries {
            self.logs.pop_front();
        }
        self.snapshot.log_line_count = sequence;
        self.snapshot.updated_at = recorded_at;
        self.snapshot.last_event = Some("agent job output received".into());
    }

    fn record_log_capture_error(&mut self, message: String) {
        self.snapshot.log_capture_error = Some(message.clone());
        self.push_line(AgentJobLogStream::System, message.clone());
        self.snapshot.last_event = Some(message);
    }

    fn record_process_error(&mut self, message: String) {
        self.snapshot.process_error = Some(message.clone());
        self.push_line(AgentJobLogStream::System, message.clone());
        self.snapshot.last_event = Some(message);
    }

    fn record_persistence_error(&mut self, message: String) {
        self.snapshot.updated_at = unix_timestamp_ms();
        self.snapshot.persistence_error = Some(message.clone());
        self.snapshot.last_event = Some(format!("agent job state persistence failed: {message}"));
    }

    fn reader_finished(&mut self) -> bool {
        self.active_readers = self.active_readers.saturating_sub(1);
        if self.shutdown_requested {
            return false;
        }
        self.finalize_if_ready()
    }

    fn record_exit(&mut self, exit_code: Option<i32>) -> bool {
        self.exit_observed = true;
        self.snapshot.process_id = None;
        self.try_terminate_process_tree();
        if self.shutdown_requested {
            return false;
        }
        self.snapshot.exit_code = exit_code;
        self.finalize_if_ready()
    }

    fn request_shutdown(&mut self) {
        if self.snapshot.status.is_active() && self.pending_terminal_status.is_none() {
            self.shutdown_requested = true;
            self.snapshot.updated_at = unix_timestamp_ms();
            self.snapshot.last_event = Some("agent job stopping for runtime shutdown".into());
        }
    }

    fn stage_shutdown_interruption(&mut self) {
        if !self.shutdown_requested
            || self.pending_terminal_status.is_some()
            || self.active_readers > 0
        {
            return;
        }
        let now = unix_timestamp_ms();
        self.snapshot.process_id = None;
        self.snapshot.exit_code = None;
        self.snapshot.updated_at = now;
        self.snapshot.finished_at = Some(now);
        self.snapshot.logs_complete = true;
        self.snapshot.process_error = None;
        self.snapshot.last_event = Some("agent job interrupted by runtime shutdown".into());
        self.exit_observed = true;
        self.process_tree_terminated = true;
        self.child = None;
        self.process_tree = None;
        self.pending_terminal_status = Some(AgentJobStatus::Interrupted);
    }

    fn try_terminate_process_tree(&mut self) {
        if self.process_tree_terminated {
            return;
        }
        let Some(process_tree) = &self.process_tree else {
            self.process_tree_terminated = true;
            return;
        };
        match process_tree.terminate() {
            Ok(()) => self.process_tree_terminated = true,
            Err(error) => self.record_process_error(format!(
                "failed to terminate descendants after agent job exit: {error}"
            )),
        }
    }

    fn record_tracking_error(&mut self, message: String) {
        self.record_process_error(message);
    }

    fn finalize_if_ready(&mut self) -> bool {
        if self.snapshot.status.is_terminal()
            || self.pending_terminal_status.is_some()
            || self.shutdown_requested
            || !self.exit_observed
            || !self.process_tree_terminated
            || self.active_readers > 0
        {
            return false;
        }

        let terminal_status = if self.snapshot.status == AgentJobStatus::Cancelling {
            AgentJobStatus::Cancelled
        } else if self.snapshot.process_error.is_none() && self.snapshot.exit_code == Some(0) {
            AgentJobStatus::Completed
        } else {
            AgentJobStatus::Failed
        };
        let now = unix_timestamp_ms();
        self.snapshot.updated_at = now;
        self.snapshot.finished_at = Some(now);
        self.snapshot.logs_complete = true;
        self.snapshot.last_event = Some(match terminal_status {
            AgentJobStatus::Completed => "agent job completed".into(),
            AgentJobStatus::Cancelled => "agent job cancelled".into(),
            AgentJobStatus::Failed if self.snapshot.process_error.is_some() => self
                .snapshot
                .process_error
                .clone()
                .unwrap_or_else(|| "agent job process tracking failed".into()),
            AgentJobStatus::Failed if self.snapshot.exit_code.is_some() => format!(
                "agent job failed with exit code {}",
                self.snapshot.exit_code.unwrap_or_default()
            ),
            AgentJobStatus::Failed => self
                .snapshot
                .last_event
                .clone()
                .unwrap_or_else(|| "agent job failed".into()),
            _ => "agent job finished".into(),
        });
        self.child = None;
        self.process_tree = None;
        self.pending_terminal_status = Some(terminal_status);
        true
    }

    fn publish_pending_terminal(&mut self) {
        if let Some(status) = self.pending_terminal_status.take() {
            self.snapshot.status = status;
            self.snapshot.logs_complete = true;
            self.snapshot.persistence_error = None;
        }
    }

    fn recent_logs(&self, limit: usize) -> AgentJobLogs {
        let public_snapshot = self.snapshot();
        let limit = limit.clamp(1, self.snapshot.max_log_entries.max(1));
        let total = self.logs.len();
        let start = total.saturating_sub(limit);
        let entries = self.logs.iter().skip(start).cloned().collect::<Vec<_>>();
        let first_sequence = entries.first().map(|entry| entry.sequence).unwrap_or(1);

        AgentJobLogs {
            job_id: public_snapshot.job_id,
            status: public_snapshot.status,
            limit,
            log_line_count: self.snapshot.log_line_count,
            truncated: first_sequence > 1 || total > limit,
            entries,
            updated_at: public_snapshot.updated_at,
            finished_at: public_snapshot.finished_at,
            cancellation_requested_at: public_snapshot.cancellation_requested_at,
            exit_code: public_snapshot.exit_code,
            logs_complete: public_snapshot.logs_complete,
            log_capture_error: public_snapshot.log_capture_error,
            process_error: public_snapshot.process_error,
            persistence_error: public_snapshot.persistence_error,
            last_event: public_snapshot.last_event,
        }
    }

    fn persisted(&self) -> PersistedAgentJob {
        let mut snapshot = self.snapshot.clone();
        if let Some(status) = self.pending_terminal_status {
            snapshot.status = status;
            snapshot.logs_complete = true;
        }
        snapshot.persistence_error = None;
        PersistedAgentJob {
            project_key: self.project_key.clone(),
            snapshot,
            logs: self.logs.iter().cloned().collect(),
        }
    }

    fn is_retention_terminal(&self) -> bool {
        self.snapshot.status.is_terminal()
    }
}

#[derive(Clone)]
struct AgentJobPersistence {
    jobs: SharedJobs,
    storage_path: Arc<Mutex<Option<PathBuf>>>,
    write_lock: Arc<Mutex<()>>,
    signal: Arc<Mutex<Option<SyncSender<()>>>>,
}

impl AgentJobPersistence {
    fn new(jobs: SharedJobs) -> Self {
        Self {
            jobs,
            storage_path: Arc::new(Mutex::new(None)),
            write_lock: Arc::new(Mutex::new(())),
            signal: Arc::new(Mutex::new(None)),
        }
    }

    fn set_storage_path(&self, storage_path: PathBuf) {
        *self.storage_path.lock().unwrap() = Some(storage_path);
    }

    fn start_writer(&self) -> Result<(), String> {
        if self.signal.lock().unwrap().is_some() {
            return Ok(());
        }

        let (sender, receiver) = sync_channel(1);
        let jobs = self.jobs.clone();
        let storage_path = self.storage_path.clone();
        let write_lock = self.write_lock.clone();
        thread::Builder::new()
            .name("gtum-agent-job-store".into())
            .spawn(move || {
                while receiver.recv().is_ok() {
                    thread::sleep(PERSIST_COALESCE_DELAY);
                    while receiver.try_recv().is_ok() {}
                    persist_with_retries(&jobs, &storage_path, &write_lock);
                }
            })
            .map_err(|error| format!("failed to start agent job persistence worker: {error}"))?;
        *self.signal.lock().unwrap() = Some(sender);
        Ok(())
    }

    fn schedule(&self) {
        let sender = self.signal.lock().unwrap().clone();
        if let Some(sender) = sender {
            match sender.try_send(()) {
                Ok(()) | Err(TrySendError::Full(())) => {}
                Err(TrySendError::Disconnected(())) => {
                    log::warn!("agent job persistence worker is disconnected")
                }
            }
        }
    }

    fn persist_now(&self) -> Result<Vec<(u64, AgentJobStatus)>, String> {
        persist_jobs(&self.jobs, &self.storage_path, &self.write_lock)
    }
}

fn record_reader_start_failure(job: &SharedJob, persistence: &AgentJobPersistence, error: String) {
    let became_terminal = {
        let mut job = job.lock().unwrap();
        job.record_log_capture_error(error);
        job.reader_finished()
    };
    if became_terminal {
        persist_job_update(&persistence.jobs, persistence, job, true);
    } else {
        persistence.schedule();
    }
}

fn kill_and_wait(
    process_tree: Option<&ProcessTree>,
    child: &Arc<Mutex<Child>>,
) -> Result<Option<i32>, String> {
    let tree_error = process_tree.and_then(|tree| tree.terminate().err());
    let mut child = child.lock().unwrap();
    let direct_kill_error = if tree_error.is_some() || process_tree.is_none() {
        child.kill().err()
    } else {
        None
    };
    let status = match child.wait() {
        Ok(status) => status,
        Err(wait_error) => {
            let kill_context = direct_kill_error
                .map(|error| format!("; termination also failed: {error}"))
                .unwrap_or_default();
            return Err(format!(
                "failed to reap agent job process: {wait_error}{kill_context}"
            ));
        }
    };

    if let (Some(process_tree), Some(first_error)) = (process_tree, tree_error) {
        if let Err(retry_error) = process_tree.terminate() {
            return Err(format!(
                "failed to terminate agent job process tree: {first_error}; retry after root exit failed: {retry_error}"
            ));
        }
    }

    Ok(status.code())
}

fn persist_job_update(
    jobs: &SharedJobs,
    persistence: &AgentJobPersistence,
    job: &SharedJob,
    became_terminal: bool,
) {
    if became_terminal {
        match persistence.persist_now() {
            Ok(terminals) => publish_persisted_terminals(jobs, &terminals),
            Err(error) => {
                log::warn!("failed to persist terminal agent job state: {error}");
                job.lock().unwrap().record_persistence_error(error);
                persistence.schedule();
            }
        }
    } else {
        persistence.schedule();
    }
}

fn persist_with_retries(
    jobs: &SharedJobs,
    storage_path: &Arc<Mutex<Option<PathBuf>>>,
    write_lock: &Arc<Mutex<()>>,
) {
    for attempt in 0..MAX_PERSIST_RETRIES {
        match persist_jobs(jobs, storage_path, write_lock) {
            Ok(terminals) => {
                publish_persisted_terminals(jobs, &terminals);
                return;
            }
            Err(error) => {
                log::warn!(
                    "failed to persist agent job state (attempt {}/{}): {error}",
                    attempt + 1,
                    MAX_PERSIST_RETRIES
                );
                record_pending_persistence_error(jobs, &error);
                if attempt + 1 < MAX_PERSIST_RETRIES {
                    let multiplier = 1_u32 << attempt.min(4);
                    thread::sleep(PERSIST_RETRY_BASE_DELAY * multiplier);
                }
            }
        }
    }
}

fn record_pending_persistence_error(jobs: &SharedJobs, error: &str) {
    let handles = jobs.lock().unwrap().values().cloned().collect::<Vec<_>>();
    for job in handles {
        let mut job = job.lock().unwrap();
        if job.pending_terminal_status.is_some() {
            job.record_persistence_error(error.into());
        }
    }
}

fn publish_persisted_terminals(jobs: &SharedJobs, persisted_terminals: &[(u64, AgentJobStatus)]) {
    for (job_id, status) in persisted_terminals {
        let job = jobs.lock().unwrap().get(job_id).cloned();
        if let Some(job) = job {
            let mut job = job.lock().unwrap();
            if job.pending_terminal_status == Some(*status) {
                job.publish_pending_terminal();
            }
        }
    }
}

fn canonical_project_scope(path: &str) -> Result<(PathBuf, String), String> {
    let normalized = platform::normalize_project_path(path)?;
    let canonical = fs::canonicalize(&normalized).map_err(|error| {
        format!(
            "failed to resolve agent job project path {}: {error}",
            normalized.display()
        )
    })?;
    if !canonical.is_dir() {
        return Err(format!(
            "agent job project path is not a directory: {}",
            canonical.display()
        ));
    }
    let key = project_key_from_canonical(&canonical);
    Ok((canonical, key))
}

#[cfg(test)]
fn canonical_project_key(path: &str) -> Result<String, String> {
    canonical_project_scope(path).map(|(_, key)| key)
}

fn project_key_from_canonical(path: &Path) -> String {
    let key = path.to_string_lossy().into_owned();
    #[cfg(target_os = "windows")]
    {
        key.to_lowercase()
    }
    #[cfg(not(target_os = "windows"))]
    {
        key
    }
}

fn normalize_persisted_job(
    mut record: PersistedAgentJob,
) -> (PersistedAgentJob, Option<AgentJobStatus>) {
    if let Ok((canonical, key)) = canonical_project_scope(&record.snapshot.cwd) {
        record.snapshot.cwd = canonical.to_string_lossy().into_owned();
        record.project_key = key;
    } else if record.project_key.is_empty() {
        record.project_key = record.snapshot.cwd.clone();
    }

    record.snapshot.process_id = None;
    record.snapshot.max_log_entries = record
        .snapshot
        .max_log_entries
        .clamp(MIN_LOG_LIMIT, MAX_LOG_LIMIT);
    record.logs.sort_by_key(|entry| entry.sequence);
    record.logs.dedup_by_key(|entry| entry.sequence);
    if record.logs.len() > record.snapshot.max_log_entries {
        let remove_count = record.logs.len() - record.snapshot.max_log_entries;
        record.logs.drain(..remove_count);
    }
    if let Some(last) = record.logs.last() {
        record.snapshot.log_line_count = record.snapshot.log_line_count.max(last.sequence);
    }

    let pending_terminal_status = if record.snapshot.status.is_active() {
        let now = unix_timestamp_ms();
        record.snapshot.updated_at = now;
        record.snapshot.finished_at = Some(now);
        record.snapshot.logs_complete = true;
        record.snapshot.last_event = Some("agent job interrupted by runtime restart".into());
        Some(AgentJobStatus::Interrupted)
    } else if record.snapshot.status.is_terminal() {
        record.snapshot.logs_complete = true;
        if record.snapshot.finished_at.is_none() {
            record.snapshot.finished_at = Some(record.snapshot.updated_at);
        }
        None
    } else {
        None
    };

    (record, pending_terminal_status)
}

fn bound_loaded_records(mut records: Vec<PersistedAgentJob>) -> Vec<PersistedAgentJob> {
    records.sort_by(|left, right| {
        left.snapshot
            .created_at
            .cmp(&right.snapshot.created_at)
            .then_with(|| left.snapshot.job_id.cmp(&right.snapshot.job_id))
    });
    if records.len() > MAX_PERSISTED_JOBS {
        records.drain(..records.len() - MAX_PERSISTED_JOBS);
    }
    records
}

fn ensure_job_capacity(jobs: &SharedJobs) -> Result<(), String> {
    let handles = jobs.lock().unwrap().values().cloned().collect::<Vec<_>>();
    if handles.len() < MAX_PERSISTED_JOBS {
        return Ok(());
    }
    if handles
        .into_iter()
        .any(|job| job.lock().unwrap().is_retention_terminal())
    {
        return Ok(());
    }
    Err(format!(
        "agent job limit reached: {MAX_PERSISTED_JOBS} jobs are still active"
    ))
}

fn make_room_for_new_job(jobs: &SharedJobs) -> Result<(), String> {
    let mut jobs = jobs.lock().unwrap();
    while jobs.len() >= MAX_PERSISTED_JOBS {
        let oldest_terminal = jobs
            .iter()
            .filter_map(|(job_id, job)| {
                let job = job.lock().unwrap();
                job.is_retention_terminal()
                    .then_some((*job_id, job.snapshot.created_at))
            })
            .min_by_key(|(_, created_at)| *created_at)
            .map(|(job_id, _)| job_id)
            .ok_or_else(|| {
                format!("agent job limit reached: {MAX_PERSISTED_JOBS} jobs are still active")
            })?;
        jobs.remove(&oldest_terminal);
    }
    Ok(())
}

fn prune_terminal_jobs(jobs: &SharedJobs) {
    let mut jobs = jobs.lock().unwrap();
    while jobs.len() > MAX_PERSISTED_JOBS {
        let oldest_terminal = jobs
            .iter()
            .filter_map(|(job_id, job)| {
                let job = job.lock().unwrap();
                job.is_retention_terminal()
                    .then_some((*job_id, job.snapshot.created_at))
            })
            .min_by_key(|(_, created_at)| *created_at)
            .map(|(job_id, _)| job_id);
        let Some(job_id) = oldest_terminal else {
            break;
        };
        jobs.remove(&job_id);
    }
}

fn load_store(path: &Path) -> Result<AgentJobStore, String> {
    let contents = fs::read_to_string(path)
        .map_err(|error| format!("failed to read agent job state: {error}"))?;
    serde_json::from_str(&contents)
        .map_err(|error| format!("failed to parse agent job state: {error}"))
}

fn backup_invalid_store(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    let parent = path
        .parent()
        .ok_or_else(|| format!("agent job storage path has no parent: {}", path.display()))?;
    let timestamp = unix_timestamp_ms();
    for suffix in 0..1_000 {
        let suffix = if suffix == 0 {
            String::new()
        } else {
            format!("-{suffix}")
        };
        let candidate = parent.join(format!("agent-jobs.corrupt-{timestamp}{suffix}.json"));
        if candidate.exists() {
            continue;
        }
        return fs::rename(path, &candidate).map_err(|error| {
            format!(
                "failed to preserve invalid agent job state as {}: {error}",
                candidate.display()
            )
        });
    }
    Err("failed to allocate an invalid agent job state backup path".into())
}

fn persist_jobs(
    jobs: &SharedJobs,
    storage_path: &Arc<Mutex<Option<PathBuf>>>,
    write_lock: &Arc<Mutex<()>>,
) -> Result<Vec<(u64, AgentJobStatus)>, String> {
    let Some(path) = storage_path.lock().unwrap().clone() else {
        return Ok(Vec::new());
    };
    let _write_guard = write_lock.lock().unwrap();
    let handles = jobs.lock().unwrap().values().cloned().collect::<Vec<_>>();
    let records_with_terminals = handles
        .into_iter()
        .map(|job| {
            let job = job.lock().unwrap();
            let pending_terminal = job
                .pending_terminal_status
                .map(|status| (job.snapshot.job_id, status));
            (job.persisted(), pending_terminal)
        })
        .collect::<Vec<_>>();
    let mut records = records_with_terminals
        .iter()
        .map(|(record, _)| record.clone())
        .collect::<Vec<_>>();
    if records.len() > MAX_PERSISTED_JOBS {
        return Err(format!(
            "agent job store exceeded its {MAX_PERSISTED_JOBS}-job retention bound"
        ));
    }
    records.sort_by(|left, right| {
        left.snapshot
            .created_at
            .cmp(&right.snapshot.created_at)
            .then_with(|| left.snapshot.job_id.cmp(&right.snapshot.job_id))
    });
    let store = AgentJobStore {
        storage_version: AGENT_JOB_STORAGE_VERSION,
        jobs: records,
    };
    let serialized = serde_json::to_vec_pretty(&store)
        .map_err(|error| format!("failed to serialize agent job state: {error}"))?;
    write_atomically(&path, &serialized)?;
    let persisted_versions = records_with_terminals
        .iter()
        .map(|(record, _)| (record.snapshot.job_id, record.snapshot.updated_at))
        .collect::<Vec<_>>();
    clear_persisted_errors(jobs, &persisted_versions);
    Ok(records_with_terminals
        .into_iter()
        .filter_map(|(_, terminal)| terminal)
        .collect())
}

fn clear_persisted_errors(jobs: &SharedJobs, persisted_versions: &[(u64, u64)]) {
    for (job_id, persisted_updated_at) in persisted_versions {
        let job = jobs.lock().unwrap().get(job_id).cloned();
        if let Some(job) = job {
            let mut job = job.lock().unwrap();
            if job.snapshot.updated_at == *persisted_updated_at {
                job.snapshot.persistence_error = None;
            }
        }
    }
}

fn write_atomically(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("agent job storage path has no parent: {}", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("failed to prepare agent job storage directory: {error}"))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("agent-jobs.json");
    let temporary = parent.join(format!(
        ".{file_name}.tmp-{}-{}",
        std::process::id(),
        unix_timestamp_ms()
    ));
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&temporary)
        .map_err(|error| format!("failed to create agent job state temp file: {error}"))?;
    if let Err(error) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        let _ = fs::remove_file(&temporary);
        return Err(format!(
            "failed to write agent job state temp file: {error}"
        ));
    }
    if let Err(error) = replace_file(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn replace_file(temporary: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(temporary, destination)
        .map_err(|error| format!("failed to replace agent job state: {error}"))
}

#[cfg(target_os = "windows")]
fn replace_file(temporary: &Path, destination: &Path) -> Result<(), String> {
    use std::{os::windows::ffi::OsStrExt, ptr};

    #[link(name = "Kernel32")]
    extern "system" {
        fn ReplaceFileW(
            replaced_file_name: *const u16,
            replacement_file_name: *const u16,
            backup_file_name: *const u16,
            replace_flags: u32,
            exclude: *mut std::ffi::c_void,
            reserved: *mut std::ffi::c_void,
        ) -> i32;
    }

    if !destination.exists() {
        return fs::rename(temporary, destination)
            .map_err(|error| format!("failed to install agent job state: {error}"));
    }

    let destination_wide = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let temporary_wide = temporary
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let replaced = unsafe {
        ReplaceFileW(
            destination_wide.as_ptr(),
            temporary_wide.as_ptr(),
            ptr::null(),
            0,
            ptr::null_mut(),
            ptr::null_mut(),
        )
    };
    if replaced == 0 {
        Err(format!(
            "failed to atomically replace agent job state: {}",
            std::io::Error::last_os_error()
        ))
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        path::Path,
        sync::atomic::{AtomicU64, Ordering},
        time::Instant,
    };

    static UNIQUE_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn unique_temp_dir(label: &str) -> PathBuf {
        let counter = UNIQUE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "gtum-agent-jobs-{label}-{}-{}-{}",
            std::process::id(),
            unix_timestamp_ms(),
            counter
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn remove_dir(path: &Path) {
        let _ = fs::remove_dir_all(path);
    }

    fn wait_for_terminal_job(
        manager: &AgentJobManager,
        project_path: &str,
        job_id: u64,
    ) -> AgentJobLogs {
        let deadline = Instant::now() + Duration::from_secs(8);
        loop {
            let logs = manager.read_logs(project_path, job_id, Some(200)).unwrap();
            if logs.status.is_terminal() && logs.logs_complete {
                return logs;
            }

            assert!(
                Instant::now() < deadline,
                "agent job did not finish in time: status={:?} event={:?} logs={:?}",
                logs.status,
                logs.last_event,
                logs.entries
            );
            thread::sleep(Duration::from_millis(50));
        }
    }

    fn persisted_job(
        project_path: &str,
        project_key: &str,
        job_id: u64,
        status: AgentJobStatus,
    ) -> PersistedAgentJob {
        PersistedAgentJob {
            project_key: project_key.into(),
            snapshot: AgentJobSnapshot {
                job_id,
                session_id: None,
                name: format!("restored-{job_id}"),
                command: "restored-command".into(),
                cwd: project_path.into(),
                runner: "runner".into(),
                runner_args: Vec::new(),
                process_id: status.is_active().then_some(999_999),
                status,
                created_at: job_id,
                updated_at: job_id + 1,
                finished_at: status.is_terminal().then_some(job_id + 1),
                cancellation_requested_at: (status == AgentJobStatus::Cancelling).then_some(job_id),
                exit_code: (status == AgentJobStatus::Completed).then_some(0),
                logs_complete: status.is_terminal(),
                log_capture_error: None,
                process_error: None,
                persistence_error: None,
                log_line_count: 0,
                max_log_entries: 50,
                last_event: Some("restored event".into()),
            },
            logs: Vec::new(),
        }
    }

    #[test]
    fn session_filtered_listing_does_not_cross_session_boundaries() {
        let dir = unique_temp_dir("session-listing");
        let project_path = fs::canonicalize(&dir)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let project_key = canonical_project_key(&project_path).unwrap();
        let manager = AgentJobManager::new();

        for (job_id, session_id) in [(1, Some("session-a")), (2, Some("session-b")), (3, None)] {
            let mut record = persisted_job(
                &project_path,
                &project_key,
                job_id,
                AgentJobStatus::Completed,
            );
            record.snapshot.session_id = session_id.map(str::to_owned);
            manager.jobs.lock().unwrap().insert(
                job_id,
                Arc::new(Mutex::new(AgentJob::restored(
                    record.project_key,
                    record.snapshot,
                    record.logs,
                ))),
            );
        }

        let session_a = manager
            .list_jobs_for_session(&project_path, Some("session-a"), Some(10))
            .unwrap();
        let session_b = manager
            .list_jobs_for_session(&project_path, Some("session-b"), Some(10))
            .unwrap();
        let project_wide = manager.list_jobs(&project_path, Some(10)).unwrap();

        assert_eq!(
            session_a.iter().map(|job| job.job_id).collect::<Vec<_>>(),
            vec![1]
        );
        assert_eq!(
            session_b.iter().map(|job| job.job_id).collect::<Vec<_>>(),
            vec![2]
        );
        assert_eq!(project_wide.len(), 3);
        remove_dir(&dir);
    }

    #[test]
    fn created_job_session_ownership_survives_persistence_round_trip() {
        let dir = unique_temp_dir("session-round-trip");
        let storage_path = dir.join("agent-jobs.json");
        let project_path = dir.to_string_lossy().into_owned();
        let manager = AgentJobManager::new();
        manager.initialize_storage(storage_path.clone()).unwrap();

        let created = manager
            .create_job(CreateAgentJobRequest {
                project_path: project_path.clone(),
                command: "whoami".into(),
                name: Some("session-owned".into()),
                max_log_entries: Some(50),
                session_id: Some("agent-session-7".into()),
            })
            .unwrap();
        assert_eq!(created.session_id.as_deref(), Some("agent-session-7"));
        wait_for_terminal_job(&manager, &project_path, created.job_id);

        drop(manager);
        let restored = AgentJobManager::new();
        restored.initialize_storage(storage_path).unwrap();
        let session_jobs = restored
            .list_jobs_for_session(&project_path, Some("agent-session-7"), Some(10))
            .unwrap();

        assert_eq!(session_jobs.len(), 1);
        assert_eq!(session_jobs[0].job_id, created.job_id);
        assert_eq!(
            session_jobs[0].session_id.as_deref(),
            Some("agent-session-7")
        );
        remove_dir(&dir);
    }

    #[test]
    fn legacy_snapshot_without_session_id_remains_unscoped() {
        let dir = unique_temp_dir("legacy-session");
        let storage_path = dir.join("agent-jobs.json");
        let project_path = fs::canonicalize(&dir)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let project_key = canonical_project_key(&project_path).unwrap();
        let store = AgentJobStore {
            storage_version: AGENT_JOB_STORAGE_VERSION,
            jobs: vec![persisted_job(
                &project_path,
                &project_key,
                9,
                AgentJobStatus::Completed,
            )],
        };
        let mut legacy_json = serde_json::to_value(store).unwrap();
        legacy_json["jobs"][0]["snapshot"]
            .as_object_mut()
            .unwrap()
            .remove("sessionId");
        fs::write(
            &storage_path,
            serde_json::to_string_pretty(&legacy_json).unwrap(),
        )
        .unwrap();

        let manager = AgentJobManager::new();
        manager.initialize_storage(storage_path).unwrap();
        let project_wide = manager.list_jobs(&project_path, Some(10)).unwrap();
        let session_jobs = manager
            .list_jobs_for_session(&project_path, Some("agent-session-7"), Some(10))
            .unwrap();

        assert_eq!(project_wide.len(), 1);
        assert_eq!(project_wide[0].session_id, None);
        assert!(session_jobs.is_empty());
        remove_dir(&dir);
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn terminal_status_waits_for_final_unterminated_output() {
        let dir = unique_temp_dir("drain");
        let storage_path = dir.join("agent-jobs.json");
        let project_path = dir.to_string_lossy().into_owned();
        let manager = AgentJobManager::new();
        manager.initialize_storage(storage_path.clone()).unwrap();

        let created = manager
            .create_job(CreateAgentJobRequest {
                project_path: project_path.clone(),
                command: "printf final-without-newline".into(),
                name: Some("drain-check".into()),
                max_log_entries: Some(50),
                session_id: None,
            })
            .unwrap();
        let logs = wait_for_terminal_job(&manager, &project_path, created.job_id);

        assert_eq!(logs.status, AgentJobStatus::Completed);
        assert_eq!(logs.exit_code, Some(0));
        assert!(logs.logs_complete);
        assert!(logs.entries.iter().any(|entry| {
            entry.stream == AgentJobLogStream::Stdout && entry.text == "final-without-newline"
        }));

        remove_dir(&dir);
    }

    #[test]
    fn restores_history_and_interrupts_nonterminal_records_without_spawning() {
        let dir = unique_temp_dir("restore");
        let storage_path = dir.join("agent-jobs.json");
        let project_path = fs::canonicalize(&dir)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let project_key = canonical_project_key(&project_path).unwrap();
        let preserved_log = AgentJobLogEntry {
            sequence: 2,
            stream: AgentJobLogStream::Stdout,
            text: "preserved output".into(),
            recorded_at: 15,
        };
        let store = AgentJobStore {
            storage_version: AGENT_JOB_STORAGE_VERSION,
            jobs: vec![
                PersistedAgentJob {
                    project_key: project_key.clone(),
                    snapshot: AgentJobSnapshot {
                        job_id: 41,
                        session_id: None,
                        name: "restored".into(),
                        command: "long-running-command".into(),
                        cwd: project_path.clone(),
                        runner: "runner".into(),
                        runner_args: Vec::new(),
                        process_id: Some(999_999),
                        status: AgentJobStatus::Running,
                        created_at: 10,
                        updated_at: 20,
                        finished_at: None,
                        cancellation_requested_at: None,
                        exit_code: None,
                        logs_complete: false,
                        log_capture_error: None,
                        process_error: None,
                        persistence_error: None,
                        log_line_count: 2,
                        max_log_entries: 50,
                        last_event: Some("agent job output received".into()),
                    },
                    logs: vec![
                        AgentJobLogEntry {
                            sequence: 1,
                            stream: AgentJobLogStream::Command,
                            text: "long-running-command".into(),
                            recorded_at: 10,
                        },
                        preserved_log.clone(),
                    ],
                },
                persisted_job(&project_path, &project_key, 42, AgentJobStatus::Cancelling),
                persisted_job(&project_path, &project_key, 43, AgentJobStatus::Completed),
                persisted_job(&project_path, &project_key, 44, AgentJobStatus::Interrupted),
            ],
        };
        fs::write(&storage_path, serde_json::to_string_pretty(&store).unwrap()).unwrap();

        let manager = AgentJobManager::new();
        manager.initialize_storage(storage_path).unwrap();
        let jobs = manager.list_jobs(&project_path, Some(10)).unwrap();
        let logs = manager.read_logs(&project_path, 41, Some(10)).unwrap();

        assert_eq!(jobs.len(), 4);
        for job_id in [41, 42] {
            let job = jobs.iter().find(|job| job.job_id == job_id).unwrap();
            assert_eq!(job.status, AgentJobStatus::Interrupted);
            assert_eq!(job.process_id, None);
            assert!(job.logs_complete);
        }
        assert_eq!(
            jobs.iter().find(|job| job.job_id == 43).unwrap().status,
            AgentJobStatus::Completed
        );
        assert_eq!(
            jobs.iter().find(|job| job.job_id == 44).unwrap().status,
            AgentJobStatus::Interrupted
        );
        assert_eq!(logs.entries.len(), 2);
        assert_eq!(logs.entries[1], preserved_log);

        remove_dir(&dir);
    }

    #[test]
    fn canonical_project_scope_blocks_cross_project_reads_and_cancels() {
        let dir = unique_temp_dir("scope");
        let other = unique_temp_dir("scope-other");
        let storage_path = dir.join("agent-jobs.json");
        let project_path = dir.to_string_lossy().into_owned();
        let alias_path = dir.join(".").to_string_lossy().into_owned();
        let trailing_path = format!("{project_path}{}", std::path::MAIN_SEPARATOR);
        let other_path = other.to_string_lossy().into_owned();
        let manager = AgentJobManager::new();
        manager.initialize_storage(storage_path).unwrap();

        let created = manager
            .create_job(CreateAgentJobRequest {
                project_path: project_path.clone(),
                command: if cfg!(target_os = "windows") {
                    "whoami".into()
                } else {
                    "printf scoped".into()
                },
                name: Some("scope-check".into()),
                max_log_entries: Some(50),
                session_id: None,
            })
            .unwrap();

        assert!(manager
            .read_logs(&alias_path, created.job_id, Some(10))
            .is_ok());
        assert_eq!(
            manager.list_jobs(&trailing_path, Some(10)).unwrap().len(),
            1
        );
        assert!(manager.list_jobs(&other_path, Some(10)).unwrap().is_empty());
        assert!(manager
            .read_logs(&other_path, created.job_id, Some(10))
            .unwrap_err()
            .contains("does not belong"));
        assert!(manager
            .cancel_job(&other_path, created.job_id)
            .unwrap_err()
            .contains("does not belong"));

        let _ = wait_for_terminal_job(&manager, &project_path, created.job_id);
        remove_dir(&dir);
        remove_dir(&other);
    }

    #[test]
    fn terminal_status_is_published_only_after_its_durable_record() {
        let dir = unique_temp_dir("terminal-publication");
        let storage_path = dir.join("agent-jobs.json");
        let canonical = fs::canonicalize(&dir).unwrap();
        let project_key = project_key_from_canonical(&canonical);
        let manager = AgentJobManager::new();
        manager.initialize_storage(storage_path.clone()).unwrap();
        let snapshot = AgentJobSnapshot::new(
            71,
            "publication".into(),
            "done".into(),
            canonical,
            "runner".into(),
            Vec::new(),
            None,
            50,
        );
        let job = Arc::new(Mutex::new(AgentJob::restored(
            project_key,
            snapshot,
            Vec::new(),
        )));
        assert!(job.lock().unwrap().record_exit(Some(0)));
        manager.jobs.lock().unwrap().insert(71, job.clone());

        let before_persist = job.lock().unwrap().snapshot();
        assert_eq!(before_persist.status, AgentJobStatus::Running);
        assert_eq!(before_persist.finished_at, None);
        assert!(!before_persist.logs_complete);
        assert_eq!(
            before_persist.last_event.as_deref(),
            Some("agent job finalizing")
        );

        let persisted_terminals = manager.persistence.persist_now().unwrap();
        let stored = load_store(&storage_path).unwrap();
        assert_eq!(stored.jobs[0].snapshot.status, AgentJobStatus::Completed);
        assert_eq!(
            job.lock().unwrap().snapshot().status,
            AgentJobStatus::Running
        );
        assert_eq!(persisted_terminals, vec![(71, AgentJobStatus::Completed)]);

        publish_persisted_terminals(&manager.jobs, &persisted_terminals);
        let after_publish = job.lock().unwrap().snapshot();
        assert_eq!(after_publish.status, AgentJobStatus::Completed);
        assert!(after_publish.logs_complete);

        remove_dir(&dir);
    }

    #[test]
    fn restored_interruption_stays_active_until_its_durable_write() {
        let dir = unique_temp_dir("restore-publication");
        let project_path = fs::canonicalize(&dir)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let project_key = canonical_project_key(&project_path).unwrap();
        let record = persisted_job(&project_path, &project_key, 72, AgentJobStatus::Running);

        let (normalized, pending_terminal) = normalize_persisted_job(record);
        assert_eq!(normalized.snapshot.status, AgentJobStatus::Running);
        assert_eq!(pending_terminal, Some(AgentJobStatus::Interrupted));
        let mut job = AgentJob::restored_with_pending(
            normalized.project_key,
            normalized.snapshot,
            normalized.logs,
            pending_terminal,
        );

        assert_eq!(job.snapshot().status, AgentJobStatus::Running);
        assert_eq!(
            job.snapshot().last_event.as_deref(),
            Some("agent job finalizing")
        );
        assert_eq!(job.persisted().snapshot.status, AgentJobStatus::Interrupted);
        job.publish_pending_terminal();
        assert_eq!(job.snapshot().status, AgentJobStatus::Interrupted);

        remove_dir(&dir);
    }

    #[test]
    fn process_tracking_error_does_not_claim_that_exit_was_observed() {
        let dir = unique_temp_dir("tracking-error");
        let canonical = fs::canonicalize(&dir).unwrap();
        let snapshot = AgentJobSnapshot::new(
            73,
            "tracking".into(),
            "long-running".into(),
            canonical.clone(),
            "runner".into(),
            Vec::new(),
            None,
            50,
        );
        let mut job = AgentJob {
            project_key: project_key_from_canonical(&canonical),
            snapshot,
            logs: VecDeque::new(),
            child: None,
            process_tree: None,
            process_tree_terminated: true,
            shutdown_requested: false,
            active_readers: 0,
            exit_observed: false,
            pending_terminal_status: None,
        };

        job.record_tracking_error("process wait and recovery failed".into());

        assert!(!job.exit_observed);
        assert_eq!(job.snapshot().status, AgentJobStatus::Running);
        assert!(job.pending_terminal_status.is_none());
        assert!(job
            .recent_logs(10)
            .entries
            .iter()
            .any(|entry| entry.stream == AgentJobLogStream::System));

        remove_dir(&dir);
    }

    #[test]
    fn shutdown_does_not_publish_interrupted_before_readers_drain() {
        let dir = unique_temp_dir("shutdown-drain");
        let canonical = fs::canonicalize(&dir).unwrap();
        let snapshot = AgentJobSnapshot::new(
            77,
            "shutdown-drain".into(),
            "running".into(),
            canonical.clone(),
            "runner".into(),
            Vec::new(),
            None,
            50,
        );
        let mut job =
            AgentJob::restored(project_key_from_canonical(&canonical), snapshot, Vec::new());
        job.shutdown_requested = true;
        job.active_readers = 1;

        job.stage_shutdown_interruption();

        assert!(job.pending_terminal_status.is_none());
        assert_eq!(job.snapshot().status, AgentJobStatus::Running);
        assert!(!job.persisted().snapshot.logs_complete);
        assert_eq!(job.persisted().snapshot.status, AgentJobStatus::Running);

        remove_dir(&dir);
    }

    #[test]
    fn log_capture_error_does_not_change_a_successful_process_result() {
        let dir = unique_temp_dir("log-capture-error");
        let canonical = fs::canonicalize(&dir).unwrap();
        let snapshot = AgentJobSnapshot::new(
            74,
            "capture".into(),
            "successful".into(),
            canonical.clone(),
            "runner".into(),
            Vec::new(),
            None,
            50,
        );
        let mut job =
            AgentJob::restored(project_key_from_canonical(&canonical), snapshot, Vec::new());

        job.record_log_capture_error("stdout capture failed".into());
        assert!(job.record_exit(Some(0)));

        let persisted = job.persisted().snapshot;
        assert_eq!(persisted.status, AgentJobStatus::Completed);
        assert_eq!(
            persisted.log_capture_error.as_deref(),
            Some("stdout capture failed")
        );
        assert_eq!(persisted.process_error, None);

        remove_dir(&dir);
    }

    #[test]
    fn persistence_error_is_visible_until_a_successful_publication() {
        let dir = unique_temp_dir("persistence-error");
        let canonical = fs::canonicalize(&dir).unwrap();
        let snapshot = AgentJobSnapshot::new(
            75,
            "persistence".into(),
            "done".into(),
            canonical.clone(),
            "runner".into(),
            Vec::new(),
            None,
            50,
        );
        let mut job =
            AgentJob::restored(project_key_from_canonical(&canonical), snapshot, Vec::new());
        assert!(job.record_exit(Some(0)));

        job.record_persistence_error("disk unavailable".into());
        assert_eq!(
            job.snapshot().persistence_error.as_deref(),
            Some("disk unavailable")
        );
        assert!(job
            .snapshot()
            .last_event
            .as_deref()
            .unwrap_or_default()
            .contains("persistence failed"));
        assert_eq!(job.persisted().snapshot.persistence_error, None);

        job.publish_pending_terminal();
        assert_eq!(job.snapshot().status, AgentJobStatus::Completed);
        assert_eq!(job.snapshot().persistence_error, None);

        remove_dir(&dir);
    }

    #[test]
    fn persistence_worker_retries_a_transient_failure_and_publishes_terminal_state() {
        let dir = unique_temp_dir("persistence-retry");
        let blocker = dir.join("blocked-parent");
        fs::write(&blocker, "not a directory").unwrap();
        let storage_path = blocker.join("agent-jobs.json");
        let canonical = fs::canonicalize(&dir).unwrap();
        let project_key = project_key_from_canonical(&canonical);
        let manager = AgentJobManager::new();
        manager.persistence.set_storage_path(storage_path.clone());
        manager.persistence.start_writer().unwrap();
        let snapshot = AgentJobSnapshot::new(
            76,
            "retry".into(),
            "done".into(),
            canonical,
            "runner".into(),
            Vec::new(),
            None,
            50,
        );
        let mut pending_job = AgentJob::restored(project_key, snapshot, Vec::new());
        assert!(pending_job.record_exit(Some(0)));
        let pending_job = Arc::new(Mutex::new(pending_job));
        manager.jobs.lock().unwrap().insert(76, pending_job.clone());

        manager.persistence.schedule();
        let error_deadline = Instant::now() + Duration::from_secs(2);
        while pending_job
            .lock()
            .unwrap()
            .snapshot()
            .persistence_error
            .is_none()
        {
            assert!(
                Instant::now() < error_deadline,
                "persistence failure was not surfaced"
            );
            thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(
            pending_job.lock().unwrap().snapshot().status,
            AgentJobStatus::Running
        );

        fs::remove_file(&blocker).unwrap();
        fs::create_dir(&blocker).unwrap();
        let publish_deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let snapshot = pending_job.lock().unwrap().snapshot();
            if snapshot.status == AgentJobStatus::Completed {
                assert_eq!(snapshot.persistence_error, None);
                break;
            }
            assert!(
                Instant::now() < publish_deadline,
                "transient persistence failure was not retried"
            );
            thread::sleep(Duration::from_millis(10));
        }
        let stored = load_store(&storage_path).unwrap();
        assert_eq!(stored.jobs[0].snapshot.status, AgentJobStatus::Completed);
        assert_eq!(stored.jobs[0].snapshot.persistence_error, None);

        remove_dir(&dir);
    }

    #[test]
    fn pending_terminal_job_is_not_evicted_before_its_terminal_record_is_durable() {
        let dir = unique_temp_dir("pending-retention");
        let canonical = fs::canonicalize(&dir).unwrap();
        let project_key = project_key_from_canonical(&canonical);
        let manager = AgentJobManager::new();

        for job_id in 1..MAX_PERSISTED_JOBS as u64 {
            let snapshot = AgentJobSnapshot::new(
                job_id,
                format!("active-{job_id}"),
                "running".into(),
                canonical.clone(),
                "runner".into(),
                Vec::new(),
                None,
                50,
            );
            manager.jobs.lock().unwrap().insert(
                job_id,
                Arc::new(Mutex::new(AgentJob::restored(
                    project_key.clone(),
                    snapshot,
                    Vec::new(),
                ))),
            );
        }
        let pending_id = MAX_PERSISTED_JOBS as u64;
        let pending_snapshot = AgentJobSnapshot::new(
            pending_id,
            "pending".into(),
            "done".into(),
            canonical,
            "runner".into(),
            Vec::new(),
            None,
            50,
        );
        let mut pending_job = AgentJob::restored(project_key, pending_snapshot, Vec::new());
        assert!(pending_job.record_exit(Some(0)));
        manager
            .jobs
            .lock()
            .unwrap()
            .insert(pending_id, Arc::new(Mutex::new(pending_job)));

        assert!(ensure_job_capacity(&manager.jobs).is_err());
        assert!(make_room_for_new_job(&manager.jobs).is_err());
        assert!(manager.jobs.lock().unwrap().contains_key(&pending_id));

        remove_dir(&dir);
    }

    #[test]
    fn output_decoder_chunks_unterminated_lines_with_bounded_memory() {
        let mut decoder = BoundedLogDecoder::default();
        let input = vec![b'x'; MAX_LOG_ENTRY_BYTES * 5 + 17];
        let mut entries = decoder.feed(&input);
        entries.extend(decoder.finish());

        assert_eq!(entries.concat(), String::from_utf8(input).unwrap());
        assert!(entries
            .iter()
            .all(|entry| entry.len() <= MAX_LOG_ENTRY_BYTES));
        assert!(decoder.buffered_len() <= MAX_LOG_ENTRY_BYTES);
    }

    #[test]
    fn output_decoder_preserves_utf8_crossing_the_chunk_boundary() {
        let mut decoder = BoundedLogDecoder::default();
        let expected = format!("{}한글", "x".repeat(MAX_LOG_ENTRY_BYTES - 1));
        let mut input = expected.as_bytes().to_vec();
        input.push(b'\n');

        let entries = decoder.feed(&input);

        assert_eq!(entries.concat(), expected);
        assert!(entries.iter().all(|entry| !entry.contains('\u{fffd}')));
        assert!(entries
            .iter()
            .all(|entry| entry.len() <= MAX_LOG_ENTRY_BYTES));
        assert_eq!(decoder.buffered_len(), 0);
    }

    #[cfg(unix)]
    fn process_exists(process_id: u32) -> bool {
        extern "C" {
            fn kill(process_id: i32, signal: i32) -> i32;
        }

        unsafe { kill(process_id as i32, 0) == 0 }
    }

    #[cfg(unix)]
    struct ProcessCleanup(Vec<u32>);

    #[cfg(unix)]
    impl Drop for ProcessCleanup {
        fn drop(&mut self) {
            extern "C" {
                fn kill(process_id: i32, signal: i32) -> i32;
            }

            for process_id in &self.0 {
                unsafe {
                    kill(*process_id as i32, 9);
                }
            }
        }
    }

    #[cfg(unix)]
    fn wait_for_child_pid(manager: &AgentJobManager, project_path: &str, job_id: u64) -> u32 {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let logs = manager.read_logs(project_path, job_id, Some(50)).unwrap();
            if let Some(process_id) = logs
                .entries
                .iter()
                .find(|entry| entry.stream == AgentJobLogStream::Stdout)
                .and_then(|entry| entry.text.trim().parse::<u32>().ok())
            {
                return process_id;
            }
            assert!(Instant::now() < deadline, "child pid was not captured");
            thread::sleep(Duration::from_millis(25));
        }
    }

    #[cfg(unix)]
    fn wait_for_process_exit(process_id: u32) {
        let deadline = Instant::now() + Duration::from_secs(3);
        while process_exists(process_id) {
            assert!(
                Instant::now() < deadline,
                "descendant process {process_id} survived"
            );
            thread::sleep(Duration::from_millis(25));
        }
    }

    #[cfg(unix)]
    #[test]
    fn cancellation_terminates_the_entire_agent_process_tree() {
        let dir = unique_temp_dir("cancel-tree");
        let storage_path = dir.join("agent-jobs.json");
        let project_path = dir.to_string_lossy().into_owned();
        let manager = AgentJobManager::new();
        manager.initialize_storage(storage_path).unwrap();
        let created = manager
            .create_job(CreateAgentJobRequest {
                project_path: project_path.clone(),
                command: "sleep 20 & echo $!; wait".into(),
                name: Some("tree".into()),
                max_log_entries: Some(50),
                session_id: None,
            })
            .unwrap();
        let descendant_pid = wait_for_child_pid(&manager, &project_path, created.job_id);
        let _cleanup = ProcessCleanup(vec![created.process_id.unwrap(), descendant_pid]);
        assert!(process_exists(descendant_pid));

        manager.cancel_job(&project_path, created.job_id).unwrap();

        wait_for_process_exit(descendant_pid);
        let logs = wait_for_terminal_job(&manager, &project_path, created.job_id);
        assert_eq!(logs.status, AgentJobStatus::Cancelled);
        remove_dir(&dir);
    }

    #[cfg(unix)]
    #[test]
    fn manager_drop_terminates_the_entire_agent_process_tree() {
        let dir = unique_temp_dir("drop-tree");
        let storage_path = dir.join("agent-jobs.json");
        let project_path = dir.to_string_lossy().into_owned();
        let manager = AgentJobManager::new();
        manager.initialize_storage(storage_path.clone()).unwrap();
        let created = manager
            .create_job(CreateAgentJobRequest {
                project_path: project_path.clone(),
                command: "sleep 20 & echo $!; wait".into(),
                name: Some("drop-tree".into()),
                max_log_entries: Some(50),
                session_id: None,
            })
            .unwrap();
        let descendant_pid = wait_for_child_pid(&manager, &project_path, created.job_id);
        let _cleanup = ProcessCleanup(vec![created.process_id.unwrap(), descendant_pid]);

        drop(manager);

        wait_for_process_exit(descendant_pid);
        thread::sleep(Duration::from_millis(250));
        let restored = AgentJobManager::new();
        restored.initialize_storage(storage_path).unwrap();
        let restored_jobs = restored.list_jobs(&project_path, Some(10)).unwrap();
        assert_eq!(restored_jobs.len(), 1);
        assert_eq!(restored_jobs[0].status, AgentJobStatus::Interrupted);
        assert!(restored_jobs[0].logs_complete);
        remove_dir(&dir);
    }

    #[test]
    fn active_job_limit_is_a_hard_in_memory_bound() {
        let dir = unique_temp_dir("active-capacity");
        let canonical = fs::canonicalize(&dir).unwrap();
        let project_key = project_key_from_canonical(&canonical);
        let manager = AgentJobManager::new();

        for job_id in 1..=MAX_PERSISTED_JOBS as u64 {
            let snapshot = AgentJobSnapshot::new(
                job_id,
                format!("active-{job_id}"),
                "running".into(),
                canonical.clone(),
                "runner".into(),
                Vec::new(),
                None,
                50,
            );
            manager.jobs.lock().unwrap().insert(
                job_id,
                Arc::new(Mutex::new(AgentJob::restored(
                    project_key.clone(),
                    snapshot,
                    Vec::new(),
                ))),
            );
        }

        let error = ensure_job_capacity(&manager.jobs).unwrap_err();
        assert!(error.contains("100 jobs are still active"));
        assert_eq!(manager.jobs.lock().unwrap().len(), MAX_PERSISTED_JOBS);

        remove_dir(&dir);
    }

    #[test]
    fn concurrent_and_coalesced_writes_leave_a_valid_bounded_store() {
        let dir = unique_temp_dir("concurrent-store");
        let storage_path = dir.join("agent-jobs.json");
        let project_path = fs::canonicalize(&dir)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let project_key = canonical_project_key(&project_path).unwrap();
        let manager = Arc::new(AgentJobManager::new());
        manager.initialize_storage(storage_path.clone()).unwrap();

        for job_id in 1..=25 {
            let record = persisted_job(
                &project_path,
                &project_key,
                job_id,
                AgentJobStatus::Completed,
            );
            manager.jobs.lock().unwrap().insert(
                job_id,
                Arc::new(Mutex::new(AgentJob::restored(
                    record.project_key,
                    record.snapshot,
                    record.logs,
                ))),
            );
        }

        let writers = (0..8)
            .map(|_| {
                let manager = manager.clone();
                thread::spawn(move || {
                    for _ in 0..20 {
                        manager.persistence.schedule();
                        manager.persistence.persist_now().unwrap();
                    }
                })
            })
            .collect::<Vec<_>>();
        for writer in writers {
            writer.join().unwrap();
        }
        thread::sleep(PERSIST_COALESCE_DELAY + Duration::from_millis(40));

        let stored = load_store(&storage_path).unwrap();
        assert_eq!(stored.storage_version, AGENT_JOB_STORAGE_VERSION);
        assert_eq!(stored.jobs.len(), 25);
        assert!(stored.jobs.len() <= MAX_PERSISTED_JOBS);
        assert!(!fs::read_dir(&dir).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains(".tmp-")
        }));

        remove_dir(&dir);
    }

    #[test]
    fn malformed_store_is_backed_up_and_does_not_block_startup() {
        let dir = unique_temp_dir("corrupt");
        let storage_path = dir.join("agent-jobs.json");
        fs::write(&storage_path, "{ truncated").unwrap();

        let manager = AgentJobManager::new();
        manager.initialize_storage(storage_path.clone()).unwrap();

        let restored: AgentJobStore =
            serde_json::from_str(&fs::read_to_string(&storage_path).unwrap()).unwrap();
        assert!(restored.jobs.is_empty());
        assert!(fs::read_dir(&dir).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains("agent-jobs.corrupt-")
        }));

        remove_dir(&dir);
    }

    #[test]
    fn cumulative_log_count_survives_ring_buffer_eviction() {
        let dir = unique_temp_dir("bounded");
        let canonical = fs::canonicalize(&dir).unwrap();
        let snapshot = AgentJobSnapshot::new(
            1,
            "bounded".into(),
            "command".into(),
            canonical.clone(),
            "runner".into(),
            Vec::new(),
            None,
            2,
        );
        let mut job =
            AgentJob::restored(project_key_from_canonical(&canonical), snapshot, Vec::new());

        job.push_line(AgentJobLogStream::Stdout, "one".into());
        job.push_line(AgentJobLogStream::Stderr, "two".into());
        job.push_line(AgentJobLogStream::Stdout, "three".into());
        let logs = job.recent_logs(10);

        assert_eq!(logs.log_line_count, 3);
        assert_eq!(logs.entries.len(), 2);
        assert_eq!(logs.entries[0].sequence, 2);
        assert_eq!(logs.entries[1].sequence, 3);
        assert!(logs.truncated);
        remove_dir(&dir);
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn nonzero_exit_and_cancel_round_trip_with_truthful_terminal_states() {
        let dir = unique_temp_dir("terminal-round-trip");
        let storage_path = dir.join("agent-jobs.json");
        let project_path = dir.to_string_lossy().into_owned();
        let manager = AgentJobManager::new();
        manager.initialize_storage(storage_path.clone()).unwrap();

        let failed = manager
            .create_job(CreateAgentJobRequest {
                project_path: project_path.clone(),
                command: "printf failure >&2; exit 7".into(),
                name: Some("failure".into()),
                max_log_entries: Some(50),
                session_id: None,
            })
            .unwrap();
        let failed_logs = wait_for_terminal_job(&manager, &project_path, failed.job_id);
        assert_eq!(failed_logs.status, AgentJobStatus::Failed);
        assert_eq!(failed_logs.exit_code, Some(7));
        assert!(failed_logs.logs_complete);
        assert!(failed_logs
            .entries
            .iter()
            .any(|entry| entry.stream == AgentJobLogStream::Stderr && entry.text == "failure"));

        let cancelled = manager
            .create_job(CreateAgentJobRequest {
                project_path: project_path.clone(),
                command: "sleep 5".into(),
                name: Some("cancelled".into()),
                max_log_entries: Some(50),
                session_id: None,
            })
            .unwrap();
        let first_cancel = manager.cancel_job(&project_path, cancelled.job_id).unwrap();
        let second_cancel = manager.cancel_job(&project_path, cancelled.job_id).unwrap();
        assert!(matches!(
            first_cancel.status,
            AgentJobStatus::Cancelling | AgentJobStatus::Cancelled
        ));
        assert!(matches!(
            second_cancel.status,
            AgentJobStatus::Cancelling | AgentJobStatus::Cancelled
        ));
        let cancelled_logs = wait_for_terminal_job(&manager, &project_path, cancelled.job_id);
        assert_eq!(cancelled_logs.status, AgentJobStatus::Cancelled);
        assert!(cancelled_logs.cancellation_requested_at.is_some());
        assert!(cancelled_logs.logs_complete);

        drop(manager);
        let restored = AgentJobManager::new();
        restored.initialize_storage(storage_path).unwrap();
        let restored_jobs = restored.list_jobs(&project_path, Some(10)).unwrap();
        assert_eq!(restored_jobs.len(), 2);
        assert!(restored_jobs
            .iter()
            .any(|job| job.job_id == failed.job_id && job.status == AgentJobStatus::Failed));
        assert!(restored_jobs.iter().any(|job| {
            job.job_id == cancelled.job_id && job.status == AgentJobStatus::Cancelled
        }));

        remove_dir(&dir);
    }

    #[test]
    fn unknown_store_version_is_preserved_as_a_backup_and_reset() {
        let dir = unique_temp_dir("unknown-version");
        let storage_path = dir.join("agent-jobs.json");
        let store = AgentJobStore {
            storage_version: AGENT_JOB_STORAGE_VERSION + 1,
            jobs: Vec::new(),
        };
        fs::write(&storage_path, serde_json::to_string_pretty(&store).unwrap()).unwrap();

        let manager = AgentJobManager::new();
        manager.initialize_storage(storage_path.clone()).unwrap();

        let restored: AgentJobStore =
            serde_json::from_str(&fs::read_to_string(&storage_path).unwrap()).unwrap();
        assert_eq!(restored.storage_version, AGENT_JOB_STORAGE_VERSION);
        assert!(fs::read_dir(&dir).unwrap().any(|entry| {
            entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains("agent-jobs.corrupt-")
        }));

        remove_dir(&dir);
    }

    #[test]
    fn restore_prunes_oldest_terminal_jobs_to_the_retention_limit() {
        let dir = unique_temp_dir("retention");
        let storage_path = dir.join("agent-jobs.json");
        let project_path = fs::canonicalize(&dir)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let project_key = canonical_project_key(&project_path).unwrap();
        let jobs = (1..=105)
            .map(|job_id| PersistedAgentJob {
                project_key: project_key.clone(),
                snapshot: AgentJobSnapshot {
                    job_id,
                    session_id: None,
                    name: format!("job-{job_id}"),
                    command: "done".into(),
                    cwd: project_path.clone(),
                    runner: "runner".into(),
                    runner_args: Vec::new(),
                    process_id: None,
                    status: AgentJobStatus::Completed,
                    created_at: job_id,
                    updated_at: job_id,
                    finished_at: Some(job_id),
                    cancellation_requested_at: None,
                    exit_code: Some(0),
                    logs_complete: true,
                    log_capture_error: None,
                    process_error: None,
                    persistence_error: None,
                    log_line_count: 0,
                    max_log_entries: 50,
                    last_event: Some("agent job completed".into()),
                },
                logs: Vec::new(),
            })
            .collect();
        fs::write(
            &storage_path,
            serde_json::to_string_pretty(&AgentJobStore {
                storage_version: AGENT_JOB_STORAGE_VERSION,
                jobs,
            })
            .unwrap(),
        )
        .unwrap();

        let manager = AgentJobManager::new();
        manager.initialize_storage(storage_path).unwrap();
        let restored = manager
            .list_jobs(&project_path, Some(MAX_LIST_LIMIT))
            .unwrap();

        assert_eq!(restored.len(), MAX_PERSISTED_JOBS);
        assert_eq!(restored.first().unwrap().job_id, 105);
        assert_eq!(restored.last().unwrap().job_id, 6);

        remove_dir(&dir);
    }
}

#[cfg(all(test, target_os = "windows"))]
mod windows_tests {
    use std::{io::Write, process::Stdio, time::Instant};

    use super::*;

    #[test]
    fn windows_agent_job_uses_shell_free_hidden_process() {
        let manager = AgentJobManager::new();
        let storage_dir = std::env::temp_dir().join(format!(
            "gtum-agent-jobs-windows-{}-{}",
            std::process::id(),
            unix_timestamp_ms()
        ));
        fs::create_dir_all(&storage_dir).unwrap();
        manager
            .initialize_storage(storage_dir.join("agent-jobs.json"))
            .unwrap();
        let project_path = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let snapshot = manager
            .create_job(CreateAgentJobRequest {
                project_path: project_path.clone(),
                command: "whoami".into(),
                name: Some("probe".into()),
                max_log_entries: Some(200),
                session_id: None,
            })
            .unwrap();

        assert!(snapshot.runner.to_ascii_lowercase().ends_with("whoami.exe"));
        assert!(snapshot.runner_args.is_empty());

        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let logs = manager
                .read_logs(&project_path, snapshot.job_id, Some(200))
                .unwrap();
            if logs
                .entries
                .iter()
                .any(|entry| !entry.text.trim().is_empty())
                && logs.status == AgentJobStatus::Completed
                && logs.logs_complete
            {
                assert_eq!(logs.exit_code, Some(0));
                break;
            }

            assert!(
                Instant::now() < deadline,
                "agent job did not finish in time; status={:?} event={:?} logs={:?}",
                logs.status,
                logs.last_event,
                logs.entries
            );
            thread::sleep(Duration::from_millis(100));
        }

        let _ = fs::remove_dir_all(storage_dir);
    }

    #[test]
    #[ignore = "helper process for windows_job_object_terminates_descendants"]
    fn windows_descendant_helper() {
        let mut child = platform::command_for_program("ping.exe")
            .args(["127.0.0.1", "-n", "30"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        println!("{}", child.id());
        std::io::stdout().flush().unwrap();
        let _ = child.wait();
    }

    fn windows_process_exists(process_id: u32) -> bool {
        use std::ffi::c_void;

        #[link(name = "Kernel32")]
        extern "system" {
            fn OpenProcess(access: u32, inherit_handle: i32, process_id: u32) -> *mut c_void;
            fn CloseHandle(handle: *mut c_void) -> i32;
        }

        const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
        let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, process_id) };
        if handle.is_null() {
            false
        } else {
            unsafe {
                CloseHandle(handle);
            }
            true
        }
    }

    struct WindowsProcessCleanup(u32);

    impl Drop for WindowsProcessCleanup {
        fn drop(&mut self) {
            use std::ffi::c_void;

            #[link(name = "Kernel32")]
            extern "system" {
                fn OpenProcess(access: u32, inherit_handle: i32, process_id: u32) -> *mut c_void;
                fn TerminateProcess(process: *mut c_void, exit_code: u32) -> i32;
                fn CloseHandle(handle: *mut c_void) -> i32;
            }

            const PROCESS_TERMINATE: u32 = 0x0001;
            let handle = unsafe { OpenProcess(PROCESS_TERMINATE, 0, self.0) };
            if !handle.is_null() {
                unsafe {
                    TerminateProcess(handle, 1);
                    CloseHandle(handle);
                }
            }
        }
    }

    #[test]
    fn windows_job_object_terminates_descendants() {
        let storage_dir = std::env::temp_dir().join(format!(
            "gtum-agent-jobs-windows-tree-{}-{}",
            std::process::id(),
            unix_timestamp_ms()
        ));
        fs::create_dir_all(&storage_dir).unwrap();
        let manager = AgentJobManager::new();
        manager
            .initialize_storage(storage_dir.join("agent-jobs.json"))
            .unwrap();
        let project_path = std::env::current_dir()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let executable = std::env::current_exe().unwrap();
        let command = format!(
            "\"{}\" --exact runtime::agent_jobs::windows_tests::windows_descendant_helper --ignored --nocapture",
            executable.display()
        );
        let created = manager
            .create_job(CreateAgentJobRequest {
                project_path: project_path.clone(),
                command,
                name: Some("windows-tree".into()),
                max_log_entries: Some(100),
                session_id: None,
            })
            .unwrap();
        let pid_deadline = Instant::now() + Duration::from_secs(5);
        let descendant_pid = loop {
            let logs = manager
                .read_logs(&project_path, created.job_id, Some(100))
                .unwrap();
            if let Some(process_id) = logs
                .entries
                .iter()
                .filter(|entry| entry.stream == AgentJobLogStream::Stdout)
                .find_map(|entry| entry.text.trim().parse::<u32>().ok())
            {
                break process_id;
            }
            assert!(Instant::now() < pid_deadline, "descendant pid not emitted");
            thread::sleep(Duration::from_millis(25));
        };
        let _cleanup = WindowsProcessCleanup(descendant_pid);
        assert!(windows_process_exists(descendant_pid));

        manager.cancel_job(&project_path, created.job_id).unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let logs = manager
                .read_logs(&project_path, created.job_id, Some(100))
                .unwrap();
            if logs.status == AgentJobStatus::Cancelled
                && logs.logs_complete
                && !windows_process_exists(descendant_pid)
            {
                break;
            }
            assert!(
                Instant::now() < deadline,
                "Windows descendant survived Job Object cancellation"
            );
            thread::sleep(Duration::from_millis(50));
        }

        let _ = fs::remove_dir_all(storage_dir);
    }
}
