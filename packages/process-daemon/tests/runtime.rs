//! Native Unix PTY / Windows ConPTY coverage, without daemon or client transport.

#[path = "support/terminal_fixture.rs"]
mod terminal_fixture;

use std::thread;
use std::time::{Duration, Instant};

use opencode_pty::protocol::AttachmentRole;
use opencode_pty::service::{
    StreamEvent, TerminalId, TerminalLifecycle, TerminalService, TerminalSnapshot,
};
use terminal_fixture::{Command, Deadline, Fixture, TempDir};

fn wait_text(service: &TerminalService, id: TerminalId, expected: &str) -> TerminalSnapshot {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let snapshot = service.snapshot(id).unwrap();
        if snapshot.text.contains(expected) {
            return snapshot;
        }
        assert!(
            Instant::now() < deadline,
            "missing {expected:?}: {snapshot:?}"
        );
        thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn real_child_input_output_unicode_and_snapshots() {
    let _deadline = Deadline::new();
    let fixture = Fixture::new();
    let service = TerminalService::default();
    let info = service.create(fixture.request()).unwrap();
    assert!(info.pid.is_some_and(|pid| pid != 0));
    let mut child = fixture.connect();
    child.command(Command::Output(
        "\x1b[2J\x1b[Hplain café 界 🙂\r\nREADY".into(),
    ));
    let snapshot = wait_text(&service, info.id, "READY");
    assert!(snapshot.text.contains("plain café 界 🙂"), "{snapshot:?}");
    assert!(!snapshot.checkpoint.is_empty());
    let rows = service.read_rows(info.id, None).unwrap();
    assert!(rows.lines.iter().any(|line| line == "plain café 界 🙂"));
    assert_eq!((rows.cursor_x, rows.cursor_y), (5, 1));
    let input = "typed café 界 🙂\r".as_bytes();
    service.write(info.id, input.to_vec()).unwrap();
    assert_eq!(
        child.command(Command::Read(input.len())),
        serde_json::json!(input)
    );
    let replay = service.replay(info.id, 0).unwrap();
    assert!(!replay.truncated);
    // ConPTY may repaint after the earlier snapshot, so offsets only grow.
    assert!(replay.end_offset >= snapshot.info.output_tail);
    assert_eq!(replay.bytes.len() as u64, replay.end_offset);
    assert!(
        service
            .replay(info.id, replay.end_offset)
            .unwrap()
            .bytes
            .is_empty()
    );
    service.terminate(info.id).unwrap();
}

#[test]
fn child_cwd_environment_and_quoted_program_path() {
    let _deadline = Deadline::new();
    let directory = TempDir::new();
    let fixture = Fixture::new();
    let service = TerminalService::default();
    let executable = directory.executable(if cfg!(windows) {
        "child 界.exe"
    } else {
        "child 界"
    });
    let mut request = fixture.request();
    request.program = executable.to_str().unwrap().to_owned();
    request.cwd = directory.0.clone();
    // Additional exact test filters exercise argv quoting, including an empty
    // argument and backslashes immediately preceding a closing quote.
    request
        .args
        .extend(["with spaces", "a\"quote", "trailing slash \\", "", "界"].map(str::to_owned));
    request
        .env
        .insert("PTY_FIXTURE_VALUE".into(), "value café 界 = ok".into());
    let expected_args = request.args.clone();
    let info = service.create(request).unwrap();
    let mut child = fixture.connect();
    let context = child.command(Command::Context);
    assert_eq!(
        std::fs::canonicalize(context["cwd"].as_str().unwrap()).unwrap(),
        std::fs::canonicalize(&directory.0).unwrap()
    );
    assert_eq!(context["args"], serde_json::json!(expected_args));
    assert_eq!(context["value"], "value café 界 = ok");
    assert_eq!(context["term"], "xterm-256color");
    assert_eq!(context["colorterm"], "truecolor");
    service.terminate(info.id).unwrap();
}

#[test]
fn executable_is_resolved_from_child_path() {
    let _deadline = Deadline::new();
    let directory = TempDir::new();
    let fixture = Fixture::new();
    let service = TerminalService::default();
    let name = if cfg!(windows) {
        "pty-path-fixture.exe"
    } else {
        "pty-path-fixture"
    };
    directory.executable(name);
    let mut request = fixture.request();
    request.program = name.into();
    request
        .env
        .insert("PATH".into(), directory.0.to_str().unwrap().into());
    let info = service.create(request).unwrap();
    let mut child = fixture.connect();
    child.command(Command::Output("\r\nPATH_OK".into()));
    wait_text(&service, info.id, "PATH_OK");
    service.terminate(info.id).unwrap();
}

#[test]
fn resize_updates_real_console_and_parser() {
    let _deadline = Deadline::new();
    let fixture = Fixture::new();
    let service = TerminalService::default();
    let info = service.create(fixture.request()).unwrap();
    let mut child = fixture.connect();
    assert_eq!(child.command(Command::Size), serde_json::json!([80, 24]));
    let observer = service
        .attach(
            info.id,
            0,
            "resize-observer".into(),
            AttachmentRole::Observer,
            false,
        )
        .unwrap();
    for (cols, rows) in [(100, 40), (60, 18)] {
        service.resize(info.id, cols, rows).unwrap();
        // ConPTY applies a resize asynchronously in conhost, so the child can
        // briefly observe the old size after `resize` returns.
        let expected = serde_json::json!([cols, rows]);
        let deadline = Instant::now() + Duration::from_secs(15);
        loop {
            let size = child.command(Command::Size);
            if size == expected {
                break;
            }
            assert!(Instant::now() < deadline, "console size stayed {size}");
            thread::sleep(Duration::from_millis(10));
        }
        let snapshot = service.snapshot(info.id).unwrap();
        assert_eq!((snapshot.info.cols, snapshot.info.rows), (cols, rows));
        assert_eq!(
            service.read_rows(info.id, None).unwrap().lines.len(),
            rows as usize
        );
        loop {
            if let StreamEvent::Resized {
                cols: actual_cols,
                rows: actual_rows,
                checkpoint,
                ..
            } = observer
                .events
                .recv_timeout(Duration::from_secs(15))
                .unwrap()
            {
                assert_eq!((actual_cols, actual_rows), (cols, rows));
                assert!(!checkpoint.is_empty());
                break;
            }
        }
    }
    drop(observer);
    service.terminate(info.id).unwrap();
}

#[test]
fn terminal_query_response_reaches_child() {
    let _deadline = Deadline::new();
    let fixture = Fixture::new();
    let service = TerminalService::default();
    let info = service.create(fixture.request()).unwrap();
    let mut child = fixture.connect();
    child.command(Command::Output("\x1b[2J\x1b[H\x1b[3;7H\x1b[6n".into()));
    let response = b"\x1b[3;7R";
    assert_eq!(
        child.command(Command::Read(response.len())),
        serde_json::json!(response)
    );
    service.write(info.id, b"!".to_vec()).unwrap();
    assert_eq!(child.command(Command::Read(1)), serde_json::json!(b"!"));
    // ConPTY answers application DSR itself; on Unix, Ghostty answers it. With
    // cursor inheritance enabled, ConPTY's own startup DSR still appears in the
    // output stream, so this checks the query reaches the reader and parser.
    // It does not prove a reply was written back on Windows.
    let replay = service.replay(info.id, 0).unwrap();
    assert!(
        replay.bytes.windows(4).any(|bytes| bytes == b"\x1b[6n"),
        "no terminal query in {replay:?}"
    );
    service.terminate(info.id).unwrap();
}

#[test]
fn independent_terminals_keep_bounded_replay() {
    let _deadline = Deadline::new();
    let alpha_fixture = Fixture::new();
    let beta_fixture = Fixture::new();
    let service = TerminalService::new(64);
    let alpha = service.create(alpha_fixture.request()).unwrap();
    let beta = service.create(beta_fixture.request()).unwrap();
    assert_ne!(alpha.id, beta.id);
    let mut a = alpha_fixture.connect();
    let mut b = beta_fixture.connect();
    a.command(Command::Output(format!(
        "\x1b[2J\x1b[H{}\r\nALPHA",
        "a".repeat(160)
    )));
    b.command(Command::Output("\x1b[2J\x1b[HBETA".into()));
    let snapshot = wait_text(&service, alpha.id, "ALPHA");
    assert!(!snapshot.text.contains("BETA"));
    assert!(!wait_text(&service, beta.id, "BETA").text.contains("ALPHA"));
    let replay = service.replay(alpha.id, 0).unwrap();
    assert!(replay.truncated);
    assert_eq!(replay.bytes.len(), 64);
    assert_eq!(replay.end_offset - replay.available_offset, 64);
    service.terminate(alpha.id).unwrap();
    service.write(beta.id, b"still-alive".to_vec()).unwrap();
    assert_eq!(
        b.command(Command::Read(11)),
        serde_json::json!(b"still-alive")
    );
    service.terminate(beta.id).unwrap();
    assert!(service.list().unwrap().is_empty());
}

#[test]
fn normal_exit_follows_final_output_and_preserves_exit_code() {
    check_normal_exit(23);
}

#[test]
#[cfg(windows)]
fn windows_exit_code_259_is_not_mistaken_for_a_running_child() {
    check_normal_exit(259);
}

fn check_normal_exit(code: u32) {
    let _deadline = Deadline::new();
    let fixture = Fixture::new();
    let service = TerminalService::default();
    let info = service.create(fixture.request()).unwrap();
    let mut child = fixture.connect();
    let observer = service
        .attach(
            info.id,
            0,
            "exit-observer".into(),
            AttachmentRole::Observer,
            false,
        )
        .unwrap();
    let mut bytes = observer.replay.bytes.clone();
    let mut offset = observer.replay.end_offset;
    child.command(Command::Output("\r\nFINAL_OUTPUT_BEFORE_EXIT\r\n".into()));
    child.command(Command::Exit(code as i32));
    loop {
        match observer
            .events
            .recv_timeout(Duration::from_secs(15))
            .unwrap_or_else(|error| {
                panic!(
                    "missing exit event: {error}; snapshot={:?}",
                    service.snapshot(info.id)
                )
            }) {
            StreamEvent::Output {
                start,
                end,
                bytes: output,
            } => {
                assert_eq!(start, offset);
                assert_eq!(end - start, output.len() as u64);
                bytes.extend(output);
                offset = end;
            }
            StreamEvent::Exited {
                exit_code,
                final_offset,
            } => {
                assert_eq!(exit_code, Some(code));
                assert_eq!(final_offset, offset);
                break;
            }
            _ => {}
        }
    }
    assert_eq!(service.replay(info.id, 0).unwrap().bytes, bytes);
    let snapshot = service.snapshot(info.id).unwrap();
    assert!(
        snapshot.text.contains("FINAL_OUTPUT_BEFORE_EXIT"),
        "{snapshot:?}"
    );
    assert_eq!(
        snapshot.info.lifecycle,
        TerminalLifecycle::Exited {
            exit_code: Some(code)
        }
    );
    assert_eq!(snapshot.info.output_tail, offset);
    assert!(observer.events.try_recv().is_err());
    #[cfg(windows)]
    {
        assert!(
            service
                .resize(info.id, 100, 40)
                .unwrap_err()
                .to_string()
                .contains("child has exited")
        );
        assert!(service.write(info.id, b"late input".to_vec()).is_err());
        assert_eq!(
            service.snapshot(info.id).unwrap().info.lifecycle,
            snapshot.info.lifecycle
        );
        assert!(
            service
                .read_rows(info.id, None)
                .unwrap()
                .lines
                .iter()
                .any(|line| line.contains("FINAL_OUTPUT_BEFORE_EXIT"))
        );
    }
    drop(observer);
    service.terminate(info.id).unwrap();
}

#[test]
fn repeated_termination_and_drop_release_children() {
    termination_cycles(false);
}

// Linux has a pre-existing portable-pty blocking-write hang after child exit;
// that repro is retained outside this Windows cleanup suite, not claimed fixed.
#[test]
#[cfg(windows)]
fn repeated_termination_and_drop_release_nonreading_children() {
    termination_cycles(true);
}

fn termination_cycles(block_input: bool) {
    let _deadline = Deadline::new();
    let service = TerminalService::default();
    for _ in 0..3 {
        let fixture = Fixture::new();
        let info = service.create(fixture.request()).unwrap();
        let _child = fixture.connect();
        let process = ChildProcess::open(info.pid.unwrap());
        // Child waits on the private control channel, never draining PTY stdin.
        if block_input {
            service.write(info.id, vec![b'x'; 256 * 1024]).unwrap();
        }
        service.terminate(info.id).unwrap();
        process.assert_exited();
        assert!(service.list().unwrap().is_empty());
        assert!(service.terminate(info.id).is_err());
    }
    let fixture = Fixture::new();
    let info = service.create(fixture.request()).unwrap();
    let _child = fixture.connect();
    let process = ChildProcess::open(info.pid.unwrap());
    if block_input {
        service.write(info.id, vec![b'x'; 256 * 1024]).unwrap();
    }
    drop(service);
    process.assert_exited();
}

struct ChildProcess {
    #[cfg(unix)]
    pid: u32,
    #[cfg(windows)]
    handle: std::os::windows::io::OwnedHandle,
}

#[test]
#[cfg(windows)]
fn terminating_a_shell_releases_its_console_child() {
    use base64::Engine;

    let _deadline = Deadline::new();
    let fixture = Fixture::new();
    let service = TerminalService::default();
    let mut request = fixture.request();
    request
        .env
        .insert("PTY_FIXTURE_EXE".into(), request.program);
    request.program = std::path::PathBuf::from(std::env::var_os("SystemRoot").unwrap())
        .join("System32/WindowsPowerShell/v1.0/powershell.exe")
        .to_str()
        .unwrap()
        .to_owned();
    // EncodedCommand avoids imposing cmd.exe's distinct quoting rules on the
    // portable-pty CommandBuilder's normal Windows argv quoting.
    let script = "& $env:PTY_FIXTURE_EXE --ignored --exact terminal_fixture::child --nocapture --test-threads=1; exit $LASTEXITCODE";
    let script = script
        .encode_utf16()
        .flat_map(u16::to_le_bytes)
        .collect::<Vec<_>>();
    request.args = vec![
        "-NoLogo".into(),
        "-NoProfile".into(),
        "-NonInteractive".into(),
        "-EncodedCommand".into(),
        base64::engine::general_purpose::STANDARD.encode(script),
    ];
    let info = service.create(request).unwrap();
    let root = ChildProcess::open(info.pid.unwrap());
    let mut child = fixture.connect();
    let pid = u32::try_from(child.command(Command::Context)["pid"].as_u64().unwrap()).unwrap();
    assert_ne!(pid, info.pid.unwrap());
    let descendant = ChildProcess::open(pid);
    child.command(Command::Output("\r\nSHELL_DESCENDANT_READY".into()));
    wait_text(&service, info.id, "SHELL_DESCENDANT_READY");
    service.terminate(info.id).unwrap();
    root.assert_exited();
    descendant.assert_exited();
}

impl ChildProcess {
    fn open(pid: u32) -> Self {
        #[cfg(unix)]
        {
            Self { pid }
        }
        #[cfg(windows)]
        {
            use std::os::windows::io::FromRawHandle;
            use windows_sys::Win32::System::Threading::{OpenProcess, PROCESS_SYNCHRONIZE};
            // SAFETY: request only wait access to this known-live test child.
            let handle = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, pid) };
            assert!(!handle.is_null(), "{}", std::io::Error::last_os_error());
            Self {
                handle: unsafe { std::os::windows::io::OwnedHandle::from_raw_handle(handle) },
            }
        }
    }

    fn assert_exited(&self) {
        #[cfg(unix)]
        {
            // SAFETY: signal zero checks liveness without signalling a process.
            assert_eq!(unsafe { libc::kill(self.pid as i32, 0) }, -1);
            assert_eq!(
                std::io::Error::last_os_error().raw_os_error(),
                Some(libc::ESRCH)
            );
        }
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            use windows_sys::Win32::{
                Foundation::WAIT_OBJECT_0, System::Threading::WaitForSingleObject,
            };
            // Descendants exit asynchronously once their console closes, so allow
            // a bounded wait. The root is already signaled when terminate returns.
            // SAFETY: the owned process handle has wait access and stays live.
            assert_eq!(
                unsafe { WaitForSingleObject(self.handle.as_raw_handle(), 5000) },
                WAIT_OBJECT_0
            );
        }
    }
}

#[test]
#[cfg(windows)]
fn shutdown_drains_conpty_while_a_child_is_producing_output() {
    let _deadline = Deadline::new();
    let fixture = Fixture::new();
    let service = TerminalService::default();
    let info = service.create(fixture.request()).unwrap();
    let mut child = fixture.connect();
    let process = ChildProcess::open(info.pid.unwrap());
    child.command(Command::Flood);
    wait_text(&service, info.id, "FLOOD_OUTPUT");
    drop(service);
    process.assert_exited();
}
