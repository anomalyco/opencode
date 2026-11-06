#![cfg(unix)]

use std::collections::HashMap;
use std::env;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use opencode_pty::service::{
    CreatePipe, CreatePty, MAX_METADATA_BYTES, PipeMetadata, ProcessExit, ProcessInfo, ProcessMode,
    ProcessSignal, TerminalId, TerminalLifecycle, TerminalService,
};

/// A unique temporary path, removed when dropped even if a test fails.
struct TempPath(PathBuf);

impl TempPath {
    fn new(name: &str) -> Self {
        Self(env::temp_dir().join(format!(
            "opencode-pty-pipe-{name}-{:032x}",
            rand::random::<u128>()
        )))
    }
}

impl Drop for TempPath {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn pipe(script: &str, output: &Path) -> CreatePipe {
    CreatePipe {
        program: "/bin/sh".to_string(),
        args: vec!["-c".to_string(), script.to_string()],
        cwd: env::current_dir().expect("cwd"),
        env: HashMap::from([("PATH".to_string(), env::var("PATH").unwrap_or_default())]),
        group_id: "pipe".to_string(),
        output_path: output.to_path_buf(),
        metadata: PipeMetadata::new(),
    }
}

/// Starts `script` with a fresh output file.
fn start(service: &TerminalService, script: &str) -> (ProcessInfo, TempPath) {
    let file = TempPath::new("out");
    let info = service.create_pipe(pipe(script, &file.0)).unwrap();
    (info, file)
}

struct Finished {
    output: String,
    exit: ProcessExit,
    elapsed: Duration,
}

/// Waits for the exit and reads the output file.
fn run(service: &TerminalService, id: TerminalId, file: &TempPath) -> Finished {
    let started = Instant::now();
    let exit = service.wait(id).unwrap().recv().unwrap();
    Finished {
        output: String::from_utf8_lossy(&std::fs::read(&file.0).unwrap()).into_owned(),
        exit,
        elapsed: started.elapsed(),
    }
}

/// Polls the output file until it holds a whole first line.
fn first_line(file: &TempPath) -> String {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let output = std::fs::read_to_string(&file.0).unwrap_or_default();
        if let Some((line, _)) = output.split_once('\n') {
            return line.to_string();
        }
        assert!(Instant::now() < deadline, "no output line");
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn alive(pid: i32) -> bool {
    // SAFETY: signal zero only checks whether the PID exists.
    unsafe { libc::kill(pid, 0) == 0 }
}

fn wait_dead(pid: i32) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while alive(pid) {
        assert!(Instant::now() < deadline, "process {pid} is still running");
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn newlines(bytes: &[u8]) -> u64 {
    bytes.iter().filter(|&&byte| byte == b'\n').count() as u64
}

#[test]
fn reports_ordered_output_and_exit_code_without_a_terminal() {
    let service = TerminalService::default();
    let (info, file) = start(
        &service,
        "for i in 1 2 3; do echo out$i; echo err$i >&2; done
         [ -t 1 ] && echo tty || echo notty
         cat; echo stdin-closed
         exit 7",
    );
    assert_eq!(info.mode, ProcessMode::Pipe);
    assert!(info.pty.is_none());
    let pipe = info.pipe.as_ref().unwrap();
    assert_eq!(pipe.output_path, file.0);
    assert_eq!(info.exited_at, None);
    let finished = run(&service, info.id, &file);
    assert_eq!(
        finished.output,
        "out1\nerr1\nout2\nerr2\nout3\nerr3\nnotty\nstdin-closed\n"
    );
    assert_eq!(finished.exit.exit_code, Some(7));
    assert_eq!(finished.exit.signal, None);
    assert_eq!(finished.exit.output_error, None);
    assert_eq!(finished.exit.output_lines, Some(8));
    assert_eq!(finished.exit.final_offset, finished.output.len() as u64);
    let listed = service.list(ProcessMode::Pipe).unwrap();
    assert_eq!(
        listed[0].lifecycle,
        TerminalLifecycle::Exited {
            exit_code: Some(7),
            signal: None
        }
    );
    assert_eq!(listed[0].exited_at, Some(finished.exit.exited_at));
    assert!(listed[0].started_at <= finished.exit.exited_at);
    assert!(listed[0].started_at > 0);
    assert_eq!(listed[0].pipe.as_ref().unwrap().output_lines, 8);
    assert_eq!(listed[0].output_tail, finished.exit.final_offset);
    service.terminate(info.id).unwrap();
}

#[test]
fn sigpipe_is_not_inherited_as_ignored() {
    // Rust ignores SIGPIPE in the daemon. A child that inherited that could
    // never die from it, so `producer | head` pipelines would misbehave.
    let service = TerminalService::default();
    let (info, file) = start(&service, "kill -PIPE $$; echo survived");
    let finished = run(&service, info.id, &file);
    assert_eq!(finished.output, "");
    assert_eq!(finished.exit.signal.as_deref(), Some("SIGPIPE"));
    service.terminate(info.id).unwrap();
}

#[test]
fn reports_the_signal_that_ended_the_process() {
    let service = TerminalService::default();
    let (info, file) = start(&service, "kill -TERM $$");
    let finished = run(&service, info.id, &file);
    assert_eq!(finished.exit.exit_code, None);
    assert_eq!(finished.exit.signal.as_deref(), Some("SIGTERM"));
    service.terminate(info.id).unwrap();
}

#[test]
fn fast_exit_without_output_is_reported() {
    let service = TerminalService::default();
    let (info, file) = start(&service, "exit 3");
    let finished = run(&service, info.id, &file);
    assert_eq!(finished.output, "");
    assert_eq!(finished.exit.exit_code, Some(3));
    assert_eq!(finished.exit.final_offset, 0);
    assert_eq!(finished.exit.output_lines, Some(0));
    service.terminate(info.id).unwrap();
}

#[test]
fn a_descendant_holding_the_pipe_delays_the_exit_by_at_most_the_drain() {
    let service = TerminalService::default();
    let (info, file) = start(&service, "sleep 30 & echo $!; echo started");
    let finished = run(&service, info.id, &file);
    assert!(
        finished.output.ends_with("started\n"),
        "{}",
        finished.output
    );
    assert_eq!(finished.exit.exit_code, Some(0));
    assert!(
        finished.elapsed < Duration::from_secs(4),
        "{:?}",
        finished.elapsed
    );
    let sleeper: i32 = finished.output.lines().next().unwrap().parse().unwrap();
    assert!(alive(sleeper));
    // Terminate kills the rest of the process group.
    service.terminate(info.id).unwrap();
    wait_dead(sleeper);
}

/// Kills a test descendant even when an assertion fails first.
struct KillOnDrop(i32);

impl Drop for KillOnDrop {
    fn drop(&mut self) {
        // SAFETY: the PID belongs to this test's own descendant.
        unsafe { libc::kill(self.0, libc::SIGKILL) };
    }
}

#[test]
fn terminate_does_not_wait_for_a_descendant_that_left_the_group() {
    let service = TerminalService::default();
    let (info, file) = start(
        &service,
        "perl -e 'use POSIX; POSIX::setsid(); $| = 1; print \"$$\\n\"; sleep 30' & wait",
    );
    let escaped = KillOnDrop(first_line(&file).parse().unwrap());
    let started = Instant::now();
    service.terminate(info.id).unwrap();
    assert!(started.elapsed() < Duration::from_secs(2));
    // It left the group, so it survives until `escaped` drops.
    assert!(alive(escaped.0));
}

#[test]
fn an_exited_process_is_kept_until_terminate() {
    let service = TerminalService::default();
    let (info, file) = start(&service, "exit 0");
    run(&service, info.id, &file);
    let pid = info.pid.unwrap() as i32;
    // The zombie keeps the PID and process group reserved.
    assert!(alive(pid));
    assert_eq!(service.list(ProcessMode::Pipe).unwrap().len(), 1);
    service.terminate(info.id).unwrap();
    assert!(!alive(pid));
    assert!(service.list(ProcessMode::Pipe).unwrap().is_empty());
}

#[test]
fn terminate_kills_the_process_group() {
    let service = TerminalService::default();
    let (info, file) = start(&service, "sleep 30 & echo $!; wait");
    let child: i32 = first_line(&file).parse().unwrap();
    service.terminate(info.id).unwrap();
    wait_dead(child);
    assert!(!alive(info.pid.unwrap() as i32));
}

#[test]
fn terminal_requests_are_rejected_and_lists_are_separate() {
    let service = TerminalService::default();
    let pty = service
        .create_pty(CreatePty {
            program: "/bin/sh".into(),
            args: vec!["-c".into(), "exec cat".into()],
            cwd: env::current_dir().unwrap(),
            env: HashMap::new(),
            group_id: "pipe".into(),
            title: "pty".into(),
            cols: 80,
            rows: 24,
        })
        .unwrap();
    assert!(pty.pipe.is_none());
    assert_eq!(pty.pty.as_ref().unwrap().cols, 80);
    let (pipe, _file) = start(&service, "echo replayed; exec sleep 30");
    let id = pipe.id;
    for result in [
        service.write(id, b"x".to_vec()),
        service.resize(id, 80, 24),
        service.control(id, "a".into(), 80, 24),
        service.input(id, "a".into(), 80, 24, b"x".to_vec()),
        service.rename(id, Some("x".into())),
        service.snapshot(id).map(|_| ()),
        service.read_rows(id, None).map(|_| ()),
    ] {
        let error = result.unwrap_err().to_string();
        assert!(error.contains("pipe process"), "{error}");
    }
    for result in [
        service.wait(pty.id).map(|_| ()),
        service.signal(pty.id, ProcessSignal::Term),
        service.set_metadata(pty.id, PipeMetadata::new()),
    ] {
        let error = result.unwrap_err().to_string();
        assert!(error.contains("not a pipe process"), "{error}");
    }
    // The output file is the only buffer: nothing to replay.
    let deadline = Instant::now() + Duration::from_secs(5);
    while service.get(id).unwrap().output_tail == 0 {
        assert!(Instant::now() < deadline);
        std::thread::sleep(Duration::from_millis(10));
    }
    let replay = service.replay(id, 0).unwrap();
    assert!(replay.bytes.is_empty());
    assert_eq!(replay.end_offset, 9);
    let listed = |mode| {
        service
            .list(mode)
            .unwrap()
            .into_iter()
            .map(|info| info.id)
            .collect::<Vec<_>>()
    };
    assert_eq!(listed(ProcessMode::Pty), vec![pty.id]);
    assert_eq!(listed(ProcessMode::Pipe), vec![pipe.id]);
    service.terminate(pty.id).unwrap();
    service.terminate(pipe.id).unwrap();
}

#[test]
fn get_returns_what_list_returns() {
    let service = TerminalService::default();
    let (info, file) = start(&service, "echo one; echo two");
    let mut metadata = PipeMetadata::new();
    metadata.insert("command".into(), "echo".into());
    service.set_metadata(info.id, metadata).unwrap();
    run(&service, info.id, &file);
    let got = serde_json::to_value(service.get(info.id).unwrap()).unwrap();
    let listed = serde_json::to_value(&service.list(ProcessMode::Pipe).unwrap()[0]).unwrap();
    assert_eq!(got, listed);
    assert_eq!(got["pipe"]["output_path"], file.0.to_str().unwrap());
    assert_eq!(got["pipe"]["output_lines"], 2);
    assert_eq!(got["pipe"]["metadata"]["command"], "echo");
    assert!(got.get("pty").is_none());
    service.terminate(info.id).unwrap();
    for error in [
        service.get(info.id).unwrap_err(),
        service.get(12345).unwrap_err(),
    ] {
        assert!(error.to_string().contains("not found"), "{error}");
    }
}

#[test]
fn output_file_keeps_everything_and_is_truncated_on_open() {
    let service = TerminalService::default();
    let file = TempPath::new("full");
    std::fs::write(&file.0, "earlier output that must go\n").unwrap();
    let info = service
        .create_pipe(pipe("seq 1 20000; echo done >&2", &file.0))
        .unwrap();
    let exit = service.wait(info.id).unwrap().recv().unwrap();
    let expected = (1..=20000).map(|n| format!("{n}\n")).collect::<String>() + "done\n";
    assert_eq!(std::fs::read_to_string(&file.0).unwrap(), expected);
    assert_eq!(exit.final_offset, expected.len() as u64);
    assert_eq!(exit.output_lines, Some(20001));
    assert_eq!(exit.output_error, None);
    service.terminate(info.id).unwrap();
}

#[test]
fn output_file_mode_follows_the_umask() {
    use std::os::unix::fs::PermissionsExt;

    // umask is process-wide: set it only in a child copy of this test.
    if let Ok(umask) = env::var("OPENCODE_PTY_UMASK_TEST_CHILD") {
        let umask = u32::from_str_radix(&umask, 8).unwrap();
        // SAFETY: this child process runs only this test.
        unsafe { libc::umask(umask as libc::mode_t) };
        let service = TerminalService::default();
        let (info, file) = start(&service, "true");
        run(&service, info.id, &file);
        let mode = std::fs::metadata(&file.0).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o666 & !umask);
        service.terminate(info.id).unwrap();
        return;
    }
    for umask in ["022", "027"] {
        let output = std::process::Command::new(env::current_exe().unwrap())
            .args(["--exact", "output_file_mode_follows_the_umask"])
            .env("OPENCODE_PTY_UMASK_TEST_CHILD", umask)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }
}

#[test]
fn rejected_requests_never_touch_the_output_file_or_run() {
    let service = TerminalService::default();
    let missing = TempPath::new("missing-directory").0.join("out");
    let marker = TempPath::new("should-not-run");
    let target = TempPath::new("target");
    std::fs::write(&target.0, "kept").unwrap();
    let link = TempPath::new("link");
    std::os::unix::fs::symlink(&target.0, &link.0).unwrap();
    let existing = TempPath::new("existing");
    std::fs::write(&existing.0, "kept").unwrap();
    let touch = format!("touch '{}'", marker.0.display());
    let mut huge = PipeMetadata::new();
    huge.insert("command".into(), "x".repeat(MAX_METADATA_BYTES).into());
    for (request, error) in [
        (pipe(&touch, Path::new("relative.out")), "must be absolute"),
        (
            CreatePipe {
                cwd: "relative".into(),
                ..pipe(&touch, &existing.0)
            },
            "cwd must be absolute",
        ),
        (
            CreatePipe {
                metadata: huge,
                ..pipe(&touch, &existing.0)
            },
            "metadata exceeds",
        ),
        (pipe(&touch, &missing), "failed to open output file"),
        (pipe(&touch, &link.0), "failed to open output file"),
    ] {
        let message = format!("{:#}", service.create_pipe(request).unwrap_err());
        assert!(message.contains(error), "{message}");
    }
    assert!(service.list(ProcessMode::Pipe).unwrap().is_empty());
    assert_eq!(std::fs::read_to_string(&existing.0).unwrap(), "kept");
    assert_eq!(std::fs::read_to_string(&target.0).unwrap(), "kept");
    // Give a wrongly spawned child time to run before checking.
    std::thread::sleep(Duration::from_millis(100));
    assert!(!marker.0.exists());
}

#[test]
fn the_child_gets_exactly_the_given_environment() {
    // Something the test process (and so a daemon) certainly has.
    assert!(env::var_os("PATH").is_some());
    let service = TerminalService::default();
    let file = TempPath::new("env");
    let info = service
        .create_pipe(CreatePipe {
            program: "/usr/bin/env".into(),
            args: vec![],
            env: HashMap::from([("ONLY".to_string(), "this".to_string())]),
            ..pipe("", &file.0)
        })
        .unwrap();
    let finished = run(&service, info.id, &file);
    assert_eq!(finished.output, "ONLY=this\n");
    service.terminate(info.id).unwrap();
}

#[test]
fn output_lines_count_newlines_in_the_file() {
    let service = TerminalService::default();
    for (script, expected) in [
        ("printf 'a\\nb\\nc'", Some(2)),
        ("printf 'a\\n\\n\\nb\\n'", Some(4)),
        ("printf ''", Some(0)),
        ("seq 1 200000", Some(200000)),
        // Many small writes the actor batches together.
        ("for i in $(seq 1 2000); do echo $i; done", Some(2000)),
        ("head -c 300000 /dev/urandom", None),
    ] {
        let (info, file) = start(&service, script);
        let exit = run(&service, info.id, &file).exit;
        let bytes = std::fs::read(&file.0).unwrap();
        assert_eq!(exit.output_lines, Some(newlines(&bytes)), "{script}");
        if let Some(expected) = expected {
            assert_eq!(exit.output_lines, Some(expected), "{script}");
        }
        assert_eq!(exit.final_offset, bytes.len() as u64, "{script}");
        let listed = service.get(info.id).unwrap();
        assert_eq!(
            listed.pipe.unwrap().output_lines,
            exit.output_lines.unwrap()
        );
        service.terminate(info.id).unwrap();
    }
}

#[cfg(target_os = "linux")]
#[test]
fn a_failing_output_file_is_reported_and_the_process_keeps_running() {
    let service = TerminalService::default();
    let info = service
        .create_pipe(pipe("echo lost; echo kept; exit 5", Path::new("/dev/full")))
        .unwrap();
    let exit = service.wait(info.id).unwrap().recv().unwrap();
    assert_eq!(exit.exit_code, Some(5));
    // Counts cover only bytes in the file, but offsets cover everything read.
    assert_eq!(exit.output_lines, Some(0));
    assert_eq!(exit.final_offset, 10);
    let error = exit.output_error.unwrap();
    assert!(error.contains("failed to write output file"), "{error}");
    let pipe = service.get(info.id).unwrap().pipe.unwrap();
    assert_eq!(pipe.output_error, Some(error));
    assert_eq!(pipe.output_lines, 0);
    service.terminate(info.id).unwrap();
}

#[test]
fn wait_blocks_until_the_exit_and_answers_every_waiter() {
    let service = TerminalService::default();
    let (info, file) = start(&service, "sleep 0.3; echo done; exit 2");
    let waits = (0..3)
        .map(|_| service.wait(info.id).unwrap())
        .collect::<Vec<_>>();
    assert!(waits[0].exit.try_recv().is_err());
    let exits = waits
        .iter()
        .map(|wait| wait.recv().unwrap())
        .collect::<Vec<_>>();
    assert!(exits.iter().all(|exit| *exit == exits[0]));
    assert_eq!(exits[0].exit_code, Some(2));
    assert_eq!(exits[0].output_lines, Some(1));
    assert_eq!(std::fs::read_to_string(&file.0).unwrap(), "done\n");
    // After the exit, a new waiter is answered at once.
    let started = Instant::now();
    assert_eq!(service.wait(info.id).unwrap().recv().unwrap(), exits[0]);
    assert!(started.elapsed() < Duration::from_millis(500));
    service.terminate(info.id).unwrap();
    assert!(service.wait(info.id).is_err());
}

#[test]
fn terminate_ends_a_pending_wait_with_an_error() {
    let service = TerminalService::default();
    let (info, _file) = start(&service, "exec sleep 30");
    let wait = service.wait(info.id).unwrap();
    service.terminate(info.id).unwrap();
    assert_eq!(wait.recv().unwrap_err().to_string(), "terminated");
}

#[test]
fn signal_stops_a_process_and_keeps_its_record() {
    let service = TerminalService::default();
    let (info, file) = start(&service, "echo started; exec sleep 30");
    first_line(&file);
    service.signal(info.id, ProcessSignal::Term).unwrap();
    let exit = service.wait(info.id).unwrap().recv().unwrap();
    assert_eq!(exit.signal.as_deref(), Some("SIGTERM"));
    assert_eq!(exit.output_lines, Some(1));
    assert_eq!(
        service.get(info.id).unwrap().lifecycle,
        TerminalLifecycle::Exited {
            exit_code: None,
            signal: Some("SIGTERM".into())
        }
    );
    // Nothing is left in the group (macOS reports ESRCH); still fine.
    service.signal(info.id, ProcessSignal::Kill).unwrap();
    service.terminate(info.id).unwrap();
    assert!(service.signal(info.id, ProcessSignal::Kill).is_err());
}

#[test]
fn a_trapped_sigterm_survives_until_sigkill() {
    let service = TerminalService::default();
    let (info, file) = start(
        &service,
        "trap 'echo trapped' TERM; echo ready; while true; do sleep 0.05; done",
    );
    first_line(&file);
    service.signal(info.id, ProcessSignal::Term).unwrap();
    let wait = service.wait(info.id).unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while !std::fs::read_to_string(&file.0)
        .unwrap()
        .contains("trapped")
    {
        assert!(Instant::now() < deadline, "trap did not run");
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(wait.exit.try_recv().is_err());
    service.signal(info.id, ProcessSignal::Kill).unwrap();
    assert_eq!(wait.recv().unwrap().signal.as_deref(), Some("SIGKILL"));
    service.terminate(info.id).unwrap();
}

#[test]
fn signal_reaches_a_backgrounded_child_in_the_group() {
    let service = TerminalService::default();
    let (info, file) = start(&service, "sleep 30 & echo $!; wait");
    let child: i32 = first_line(&file).parse().unwrap();
    // Not SIGINT: a non-interactive shell starts background jobs ignoring it.
    service.signal(info.id, ProcessSignal::Term).unwrap();
    wait_dead(child);
    let exit = service.wait(info.id).unwrap().recv().unwrap();
    assert!(exit.signal.is_some() || exit.exit_code.is_some());
    assert_eq!(service.list(ProcessMode::Pipe).unwrap().len(), 1);
    service.terminate(info.id).unwrap();
}

#[test]
fn signal_after_exit_reaches_leftover_group_members() {
    let service = TerminalService::default();
    let (info, file) = start(&service, "sleep 30 & echo $!");
    let exit = run(&service, info.id, &file);
    let sleeper = KillOnDrop(exit.output.trim().parse().unwrap());
    assert!(alive(sleeper.0));
    service.signal(info.id, ProcessSignal::Kill).unwrap();
    wait_dead(sleeper.0);
    service.terminate(info.id).unwrap();
}

#[test]
fn metadata_round_trips_and_is_capped() {
    let service = TerminalService::default();
    let file = TempPath::new("metadata");
    let metadata = serde_json::json!({
        "id": "sh_1",
        "command": "echo hi",
        "location": { "directory": "/tmp", "workspaceID": null },
    });
    let serde_json::Value::Object(metadata) = metadata else {
        unreachable!()
    };
    let info = service
        .create_pipe(CreatePipe {
            metadata: metadata.clone(),
            ..pipe("exec sleep 30", &file.0)
        })
        .unwrap();
    assert_eq!(info.pipe.unwrap().metadata, metadata);
    assert_eq!(
        service.get(info.id).unwrap().pipe.unwrap().metadata,
        metadata
    );
    let mut changed = metadata.clone();
    changed.insert("status".into(), "killed".into());
    service.set_metadata(info.id, changed.clone()).unwrap();
    assert_eq!(
        service.list(ProcessMode::Pipe).unwrap()[0]
            .pipe
            .as_ref()
            .unwrap()
            .metadata,
        changed
    );
    let mut huge = PipeMetadata::new();
    huge.insert("command".into(), "x".repeat(MAX_METADATA_BYTES).into());
    let error = service.set_metadata(info.id, huge).unwrap_err();
    assert!(error.to_string().contains("metadata exceeds"), "{error}");
    assert_eq!(
        service.get(info.id).unwrap().pipe.unwrap().metadata,
        changed
    );
    service.terminate(info.id).unwrap();
}
