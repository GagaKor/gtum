use std::{
    fs,
    io::{self, Write},
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use super::*;

#[derive(Clone, Default)]
struct SinkWriter {
    bytes: Arc<Mutex<Vec<u8>>>,
}

impl Write for SinkWriter {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        self.bytes.lock().unwrap().extend_from_slice(buffer);
        Ok(buffer.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn insert_session(
    manager: &TerminalSessionManager,
    session_id: u64,
    project_path: &str,
    cwd: &str,
) -> SinkWriter {
    let writer = SinkWriter::default();
    let snapshot = TerminalSessionSnapshot::new(
        session_id,
        project_path.to_string(),
        format!("Session {session_id}"),
        Some(PathBuf::from(cwd)),
        "test-shell".into(),
        Vec::new(),
        None,
        100,
    );
    let mut session = TerminalSession::new(snapshot, None, Some(Box::new(writer.clone())));
    session.push_output("ready\n");
    manager
        .sessions
        .lock()
        .unwrap()
        .insert(session_id, Arc::new(Mutex::new(session)));
    writer
}

fn unique_temp_path(label: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "gtum-terminal-owner-{label}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

#[test]
fn owner_a_can_use_every_public_operation_and_owner_b_cannot_see_it() {
    let manager = TerminalSessionManager::new();
    let writer = insert_session(&manager, 7, "/canonical/a", "/canonical/a");

    let listed = manager.list_sessions("/canonical/a").unwrap();
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].project_path, "/canonical/a");
    assert!(manager.list_sessions("/canonical/b").unwrap().is_empty());

    let renamed = manager
        .rename_session("/canonical/a", 7, "A terminal".into())
        .unwrap();
    assert_eq!(renamed.name, "A terminal");

    let logs = manager
        .read_recent_logs("/canonical/a", 7, Some(25))
        .unwrap();
    assert_eq!(logs.project_path, "/canonical/a");
    assert_eq!(logs.entries, vec!["ready"]);

    manager
        .write_terminal_input("/canonical/a", 7, "raw input".into())
        .unwrap();
    let executed = manager
        .execute_command("/canonical/a", 7, "echo accepted".into())
        .unwrap();
    assert_eq!(executed.project_path, "/canonical/a");
    manager.resize_session("/canonical/a", 7, 40, 120).unwrap();

    let raw = manager.read_raw_output("/canonical/a", 7, 0).unwrap();
    assert_eq!(raw.project_path, "/canonical/a");
    assert_eq!(raw.session_id, 7);
    let written = String::from_utf8(writer.bytes.lock().unwrap().clone()).unwrap();
    assert!(written.contains("raw input"));
    assert!(written.contains("echo accepted"));

    let closed = manager.close_session("/canonical/a", 7).unwrap();
    assert_eq!(closed.project_path, "/canonical/a");
    assert_eq!(closed.status, TerminalSessionStatus::Terminated);
}

#[test]
fn mismatched_owner_is_rejected_before_any_lookup_mutation() {
    let manager = TerminalSessionManager::new();
    let writer = insert_session(&manager, 8, "/canonical/a", "/canonical/a");
    let before = manager.get_session(8).unwrap().lock().unwrap().snapshot();
    let before_bytes = writer.bytes.lock().unwrap().clone();

    let errors = [
        manager
            .rename_session("/canonical/b", 8, "foreign".into())
            .unwrap_err(),
        manager.close_session("/canonical/b", 8).unwrap_err(),
        manager
            .read_recent_logs("/canonical/b", 8, Some(25))
            .unwrap_err(),
        manager
            .write_terminal_input("/canonical/b", 8, "foreign input".into())
            .unwrap_err(),
        manager.read_raw_output("/canonical/b", 8, 0).unwrap_err(),
        manager
            .resize_session("/canonical/b", 8, 40, 120)
            .unwrap_err(),
        manager
            .execute_command("/canonical/b", 8, "clear".into())
            .unwrap_err(),
    ];

    for error in errors {
        assert!(
            error.contains("terminal session owner mismatch"),
            "unexpected ownership error: {error}"
        );
    }

    let after_session = manager.get_session(8).unwrap();
    let after = after_session.lock().unwrap().snapshot();
    assert_eq!(after.project_path, before.project_path);
    assert_eq!(after.name, before.name);
    assert_eq!(after.status, before.status);
    assert_eq!(after.log_line_count, before.log_line_count);
    assert_eq!(*writer.bytes.lock().unwrap(), before_bytes);
    assert_eq!(
        manager
            .read_recent_logs("/canonical/a", 8, Some(25))
            .unwrap()
            .entries,
        vec!["ready"]
    );
}

#[test]
fn cwd_changes_and_cd_commands_never_change_the_immutable_owner() {
    let manager = TerminalSessionManager::new();
    insert_session(&manager, 9, "/canonical/a", "/canonical/a/child");

    {
        let session = manager.get_session(9).unwrap();
        session.lock().unwrap().snapshot.cwd = Some("/unrelated/place".into());
    }
    let snapshot = manager
        .execute_command("/canonical/a", 9, "cd /another/project".into())
        .unwrap();

    assert_eq!(snapshot.project_path, "/canonical/a");
    assert_eq!(snapshot.cwd.as_deref(), Some("/unrelated/place"));
    assert!(manager
        .execute_command("/unrelated/place", 9, "pwd".into())
        .unwrap_err()
        .contains("terminal session owner mismatch"));
}

#[test]
fn canonical_owner_is_captured_once_and_survives_project_deletion() {
    let project = unique_temp_path("deleted");
    fs::create_dir_all(project.join("child")).unwrap();
    let supplied = project.join("child").join("..");
    let canonical = canonicalize_project_owner(supplied.to_string_lossy().as_ref()).unwrap();
    assert_eq!(
        PathBuf::from(&canonical),
        fs::canonicalize(&project).unwrap()
    );

    let manager = TerminalSessionManager::new();
    insert_session(&manager, 10, &canonical, &canonical);
    fs::remove_dir_all(&project).unwrap();

    assert_eq!(
        manager.list_sessions(&canonical).unwrap()[0].project_path,
        canonical
    );
    manager
        .rename_session(&canonical, 10, "still owned".into())
        .unwrap();
    manager
        .write_terminal_input(&canonical, 10, "still writable".into())
        .unwrap();
    manager
        .execute_command(&canonical, 10, "echo still running".into())
        .unwrap();
    manager.resize_session(&canonical, 10, 24, 80).unwrap();
    manager.read_recent_logs(&canonical, 10, None).unwrap();
    manager.read_raw_output(&canonical, 10, 0).unwrap();
    manager.close_session(&canonical, 10).unwrap();
}

#[test]
fn canonical_owner_requires_an_existing_directory() {
    let root = unique_temp_path("validation");
    fs::create_dir_all(&root).unwrap();
    let file = root.join("file.txt");
    fs::write(&file, "not a directory").unwrap();

    assert!(canonicalize_project_owner("   ").is_err());
    assert!(canonicalize_project_owner(file.to_string_lossy().as_ref()).is_err());
    assert!(canonicalize_project_owner(root.join("missing").to_string_lossy().as_ref()).is_err());

    fs::remove_dir_all(root).unwrap();
}
