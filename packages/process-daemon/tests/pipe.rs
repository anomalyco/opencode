#![cfg(unix)]

use std::env;
use std::time::{Duration, Instant};

use opencode_pty::protocol::AttachmentRole;
use opencode_pty::service::{
    CreateTerminal, ProcessMode, StreamEvent, TerminalId, TerminalLifecycle, TerminalService,
};

fn pipe(script: &str) -> CreateTerminal {
    CreateTerminal {
        program: "/bin/sh".to_string(),
        args: vec!["-c".to_string(), script.to_string()],
        cwd: env::current_dir().expect("cwd"),
        title: String::new(),
        group_id: "pipe".to_string(),
        env: std::collections::HashMap::new(),
        cols: 0,
        rows: 0,
        mode: ProcessMode::Pipe,
        output_path: None,
    }
}

struct Finished {
    output: String,
    exit_code: Option<u32>,
    signal: Option<String>,
    final_offset: u64,
    elapsed: Duration,
}

/// Collects output from offset 0 until the exit event.
fn run(service: &TerminalService, id: TerminalId) -> Finished {
    let started = Instant::now();
    let attachment = service
        .attach(id, 0, "test".into(), AttachmentRole::Observer, false)
        .unwrap();
    let mut output = attachment.replay.bytes.clone();
    loop {
        match attachment
            .events
            .recv_timeout(Duration::from_secs(10))
            .expect("pipe process did not exit")
        {
            StreamEvent::Output { bytes, .. } => output.extend(bytes),
            StreamEvent::Exited {
                exit_code,
                signal,
                final_offset,
            } => {
                return Finished {
                    output: String::from_utf8(output).unwrap(),
                    exit_code,
                    signal,
                    final_offset,
                    elapsed: started.elapsed(),
                };
            }
            _ => {}
        }
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

#[test]
fn reports_ordered_output_and_exit_code_without_a_terminal() {
    let service = TerminalService::default();
    let info = service
        .create(pipe(
            "for i in 1 2 3; do echo out$i; echo err$i >&2; done
             [ -t 1 ] && echo tty || echo notty
             cat; echo stdin-closed
             exit 7",
        ))
        .unwrap();
    assert_eq!(info.mode, ProcessMode::Pipe);
    assert_eq!(info.title, "sh");
    let finished = run(&service, info.id);
    assert_eq!(
        finished.output,
        "out1\nerr1\nout2\nerr2\nout3\nerr3\nnotty\nstdin-closed\n"
    );
    assert_eq!(finished.exit_code, Some(7));
    assert_eq!(finished.signal, None);
    assert_eq!(finished.final_offset, finished.output.len() as u64);
    let listed = service.list_mode(ProcessMode::Pipe).unwrap();
    assert_eq!(
        listed[0].lifecycle,
        TerminalLifecycle::Exited {
            exit_code: Some(7),
            signal: None
        }
    );
    service.terminate(info.id).unwrap();
}

#[test]
fn sigpipe_is_not_inherited_as_ignored() {
    // Rust ignores SIGPIPE in the daemon. A child that inherited that could
    // never die from it, so `producer | head` pipelines would misbehave.
    let service = TerminalService::default();
    let info = service
        .create(pipe("kill -PIPE $$; echo survived"))
        .unwrap();
    let finished = run(&service, info.id);
    assert_eq!(finished.output, "");
    assert_eq!(finished.signal.as_deref(), Some("SIGPIPE"));
    service.terminate(info.id).unwrap();
}

#[test]
fn reports_the_signal_that_ended_the_process() {
    let service = TerminalService::default();
    let info = service.create(pipe("kill -TERM $$")).unwrap();
    let finished = run(&service, info.id);
    assert_eq!(finished.exit_code, None);
    assert_eq!(finished.signal.as_deref(), Some("SIGTERM"));
    service.terminate(info.id).unwrap();
}

#[test]
fn fast_exit_without_output_is_reported() {
    let service = TerminalService::default();
    let info = service.create(pipe("exit 3")).unwrap();
    let finished = run(&service, info.id);
    assert_eq!(finished.output, "");
    assert_eq!(finished.exit_code, Some(3));
    assert_eq!(finished.final_offset, 0);
    service.terminate(info.id).unwrap();
}

#[test]
fn a_descendant_holding_the_pipe_delays_the_exit_by_at_most_the_drain() {
    let service = TerminalService::default();
    let info = service
        .create(pipe("sleep 30 & echo $!; echo started"))
        .unwrap();
    let finished = run(&service, info.id);
    assert!(
        finished.output.ends_with("started\n"),
        "{}",
        finished.output
    );
    assert_eq!(finished.exit_code, Some(0));
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
    let info = service
        .create(pipe(
            "perl -e 'use POSIX; POSIX::setsid(); $| = 1; print \"$$\\n\"; sleep 30' & wait",
        ))
        .unwrap();
    let attachment = service
        .attach(info.id, 0, "test".into(), AttachmentRole::Observer, false)
        .unwrap();
    let mut output = attachment.replay.bytes.clone();
    while !output.ends_with(b"\n") {
        if let StreamEvent::Output { bytes, .. } = attachment
            .events
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
        {
            output.extend(bytes);
        }
    }
    let escaped = KillOnDrop(String::from_utf8(output).unwrap().trim().parse().unwrap());
    drop(attachment);
    let started = Instant::now();
    service.terminate(info.id).unwrap();
    assert!(started.elapsed() < Duration::from_secs(2));
    // It left the group, so it survives until `escaped` drops.
    assert!(alive(escaped.0));
}

#[test]
fn an_exited_process_is_kept_until_terminate() {
    let service = TerminalService::default();
    let info = service.create(pipe("exit 0")).unwrap();
    run(&service, info.id);
    let pid = info.pid.unwrap() as i32;
    // The zombie keeps the PID and process group reserved.
    assert!(alive(pid));
    assert_eq!(service.list_mode(ProcessMode::Pipe).unwrap().len(), 1);
    service.terminate(info.id).unwrap();
    assert!(!alive(pid));
    assert!(service.list_mode(ProcessMode::Pipe).unwrap().is_empty());
}

#[test]
fn terminate_kills_the_process_group() {
    let service = TerminalService::default();
    let info = service.create(pipe("sleep 30 & echo $!; wait")).unwrap();
    let attachment = service
        .attach(info.id, 0, "test".into(), AttachmentRole::Observer, false)
        .unwrap();
    let mut output = attachment.replay.bytes.clone();
    while !output.ends_with(b"\n") {
        if let StreamEvent::Output { bytes, .. } = attachment
            .events
            .recv_timeout(Duration::from_secs(5))
            .unwrap()
        {
            output.extend(bytes);
        }
    }
    let child: i32 = String::from_utf8(output).unwrap().trim().parse().unwrap();
    drop(attachment);
    service.terminate(info.id).unwrap();
    wait_dead(child);
    assert!(!alive(info.pid.unwrap() as i32));
}

#[test]
fn terminal_requests_are_rejected_and_lists_are_separate() {
    let service = TerminalService::default();
    let pty = service
        .create(CreateTerminal {
            cols: 80,
            rows: 24,
            mode: ProcessMode::Pty,
            ..pipe("exec cat")
        })
        .unwrap();
    let pipe = service.create(pipe("exec sleep 30")).unwrap();
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
    assert!(service.replay(id, 0).is_ok());
    let listed = |mode| {
        service
            .list_mode(mode)
            .unwrap()
            .into_iter()
            .map(|info| info.id)
            .collect::<Vec<_>>()
    };
    assert_eq!(listed(ProcessMode::Pty), vec![pty.id]);
    assert_eq!(listed(ProcessMode::Pipe), vec![pipe.id]);
    assert_eq!(service.list().unwrap().len(), 1);
    service.terminate(pty.id).unwrap();
    service.terminate(pipe.id).unwrap();
}

#[test]
fn pipe_processes_need_no_terminal_size() {
    let service = TerminalService::default();
    assert!(
        service
            .create(CreateTerminal {
                mode: ProcessMode::Pty,
                ..pipe("true")
            })
            .is_err()
    );
    let info = service.create(pipe("true")).unwrap();
    service.terminate(info.id).unwrap();
}

/// A unique temporary path, removed when dropped even if a test fails.
struct TempPath(std::path::PathBuf);

impl TempPath {
    fn new(name: &str) -> Self {
        Self(std::env::temp_dir().join(format!(
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

fn wait_exited(service: &TerminalService, id: TerminalId) -> TerminalLifecycle {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let lifecycle = service
            .list_mode(ProcessMode::Pipe)
            .unwrap()
            .into_iter()
            .find(|info| info.id == id)
            .unwrap()
            .lifecycle;
        if lifecycle != TerminalLifecycle::Running {
            return lifecycle;
        }
        assert!(Instant::now() < deadline, "pipe process did not exit");
        std::thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn output_path_keeps_everything_beyond_the_replay_window_without_a_subscriber() {
    use std::os::unix::fs::PermissionsExt;

    // A replay window far smaller than the output.
    let service = TerminalService::new(1024);
    let file = TempPath::new("full");
    let path = &file.0;
    let info = service
        .create(CreateTerminal {
            output_path: Some(path.clone()),
            ..pipe("seq 1 20000; echo done >&2")
        })
        .unwrap();
    assert_eq!(
        wait_exited(&service, info.id),
        TerminalLifecycle::Exited {
            exit_code: Some(0),
            signal: None
        }
    );
    let expected = (1..=20000).map(|n| format!("{n}\n")).collect::<String>() + "done\n";
    assert_eq!(std::fs::read_to_string(path).unwrap(), expected);
    assert_eq!(
        std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    let replay = service.replay(info.id, 0).unwrap();
    assert!(replay.truncated);
    assert_eq!(replay.end_offset, expected.len() as u64);
    assert_eq!(
        service.list_mode(ProcessMode::Pipe).unwrap()[0].output_error,
        None
    );
    service.terminate(info.id).unwrap();
}

#[test]
fn output_path_appends_to_an_existing_file() {
    let service = TerminalService::default();
    let file = TempPath::new("append");
    let path = &file.0;
    std::fs::write(path, "earlier\n").unwrap();
    let info = service
        .create(CreateTerminal {
            output_path: Some(path.clone()),
            ..pipe("echo later")
        })
        .unwrap();
    wait_exited(&service, info.id);
    assert_eq!(std::fs::read_to_string(path).unwrap(), "earlier\nlater\n");
    service.terminate(info.id).unwrap();
}

#[test]
fn output_path_must_be_an_absolute_file_for_a_pipe_process() {
    let service = TerminalService::default();
    let missing = TempPath::new("missing-directory").0.join("out");
    let marker = TempPath::new("should-not-run");
    let target = TempPath::new("target");
    std::fs::write(&target.0, "").unwrap();
    let link = TempPath::new("link");
    std::os::unix::fs::symlink(&target.0, &link.0).unwrap();
    let touch = format!("touch '{}'", marker.0.display());
    for (request, error) in [
        (
            CreateTerminal {
                output_path: Some("relative.out".into()),
                ..pipe("true")
            },
            "must be absolute",
        ),
        (
            CreateTerminal {
                output_path: Some(TempPath::new("pty").0.clone()),
                cols: 80,
                rows: 24,
                mode: ProcessMode::Pty,
                ..pipe("true")
            },
            "only supported for pipe processes",
        ),
        (
            CreateTerminal {
                output_path: Some(missing),
                ..pipe(&touch)
            },
            "failed to open output file",
        ),
        (
            CreateTerminal {
                output_path: Some(link.0.clone()),
                ..pipe(&touch)
            },
            "failed to open output file",
        ),
    ] {
        let message = format!("{:#}", service.create(request).unwrap_err());
        assert!(message.contains(error), "{message}");
    }
    assert!(service.list_mode(ProcessMode::Pipe).unwrap().is_empty());
    // Give a wrongly spawned child time to run before checking.
    std::thread::sleep(Duration::from_millis(100));
    assert!(!marker.0.exists());
}

#[cfg(target_os = "linux")]
#[test]
fn a_failing_output_file_is_reported_and_the_process_keeps_running() {
    let service = TerminalService::default();
    let info = service
        .create(CreateTerminal {
            output_path: Some("/dev/full".into()),
            ..pipe("echo lost; echo kept; exit 5")
        })
        .unwrap();
    let finished = run(&service, info.id);
    assert_eq!(finished.output, "lost\nkept\n");
    assert_eq!(finished.exit_code, Some(5));
    let error = service.list_mode(ProcessMode::Pipe).unwrap()[0]
        .output_error
        .clone()
        .unwrap();
    assert!(error.contains("failed to write output file"), "{error}");
    service.terminate(info.id).unwrap();
}
