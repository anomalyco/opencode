#![cfg(windows)]

// Direct-service and daemon tests share the runtime lane's real child fixture,
// rather than maintaining separate console setup.
#[path = "support/terminal_fixture.rs"]
mod terminal_fixture;

use std::io::Write;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use base64::Engine;
use opencode_pty::daemon::{PipeConnection, Registration};
use opencode_pty::protocol::{
    AttachmentRole, Envelope, Request, Response, SubscriptionEvent, read_frame,
    read_subscription_event, write_frame,
};
use opencode_pty::service::{CreateTerminal, TerminalInfo, TerminalLifecycle};
use terminal_fixture::{Command as FixtureCommand, Deadline, Fixture, TempDir};
use windows_sys::Win32::Foundation::WAIT_OBJECT_0;
use windows_sys::Win32::System::Threading::{
    GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
    WaitForSingleObject,
};

struct Daemon {
    child: Child,
    registration: Registration,
    directory: PathBuf,
    root: TempDir,
}

impl Daemon {
    fn start() -> Self {
        let root = TempDir::new();
        let directory = root.0.join("runtime");
        let mut child = spawn(&directory);
        let registration = registration(&mut child, &directory);
        Self {
            child,
            registration,
            directory,
            root,
        }
    }

    fn connect(&self) -> PipeConnection {
        let mut stream =
            PipeConnection::connect_to(&self.registration.socket, self.registration.pid).unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(5)));
        stream.set_write_timeout(Some(Duration::from_secs(5)));
        stream
    }

    fn send(&self, stream: &mut PipeConnection, request: Request) -> Response {
        write_frame(
            &mut *stream,
            &Envelope {
                token: self.registration.token.clone(),
                request,
            },
        )
        .unwrap();
        read_frame(stream).unwrap()
    }

    fn request(&self, request: Request) -> Response {
        self.send(&mut self.connect(), request)
    }

    fn own(&self, ticket: Option<String>) -> (PipeConnection, Response) {
        let mut stream = self.connect();
        let response = self.send(
            &mut stream,
            Request::Own {
                instance_id: self.registration.instance_id.clone(),
                ticket,
            },
        );
        (stream, response)
    }

    fn create(&self, request: CreateTerminal) -> TerminalInfo {
        let CreateTerminal {
            program,
            args,
            cwd,
            title,
            group_id,
            env,
            cols,
            rows,
        } = request;
        match self.request(Request::Create {
            program,
            args,
            cwd,
            title,
            group_id,
            env,
            cols,
            rows,
        }) {
            Response::Created { terminal } => terminal,
            response => panic!("create: {response:?}"),
        }
    }

    fn subscribe(&self, id: u64, role: AttachmentRole) -> PipeConnection {
        let (stream, response) = self.attach(id, "daemon-test", role);
        assert!(matches!(response, Response::Attached { .. }));
        stream
    }

    fn attach(
        &self,
        id: u64,
        attachment_id: &str,
        role: AttachmentRole,
    ) -> (PipeConnection, Response) {
        let mut stream = self.connect();
        let response = self.send(
            &mut stream,
            Request::Subscribe {
                id,
                offset: 0,
                attachment_id: attachment_id.into(),
                role,
                takeover: false,
            },
        );
        (stream, response)
    }

    fn snapshot(&self, id: u64) -> (TerminalInfo, String) {
        match self.request(Request::Snapshot { id }) {
            Response::Snapshot { terminal, text, .. } => (terminal, text),
            response => panic!("snapshot: {response:?}"),
        }
    }

    fn wait_text(&self, id: u64, expected: &str) -> (TerminalInfo, String) {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let snapshot = self.snapshot(id);
            if snapshot.1.contains(expected) {
                return snapshot;
            }
            assert!(
                Instant::now() < deadline,
                "missing {expected:?}: {snapshot:?}"
            );
            thread::sleep(Duration::from_millis(10));
        }
    }

    fn wait(&mut self) {
        let status = wait(&mut self.child);
        assert!(status.success(), "daemon failed: {status}");
        assert!(
            !self.directory.exists(),
            "runtime directory was not removed"
        );
        assert!(PipeConnection::connect(&self.registration.socket).is_err());
    }
}

impl Drop for Daemon {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

fn spawn(directory: &Path) -> Child {
    Command::new(env!("CARGO_BIN_EXE_opencode-pty"))
        .args(["daemon", "--name"])
        .arg(directory.file_name().unwrap())
        .arg("--runtime-dir")
        .arg(directory.parent().unwrap())
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .spawn()
        .unwrap()
}

fn registration(child: &mut Child, directory: &Path) -> Registration {
    let deadline = Instant::now() + Duration::from_secs(4);
    loop {
        // The checked reader also proves the published file is private.
        if let Ok(registration) = opencode_pty::daemon::read_registration(directory)
            && registration.pid == child.id()
        {
            assert_eq!(registration.protocol, 7);
            assert_eq!(
                registration.socket,
                PathBuf::from(format!(
                    r"\\.\pipe\opencode-pty-{}",
                    registration.instance_id
                ))
            );
            return registration;
        }
        assert!(
            child.try_wait().unwrap().is_none(),
            "daemon exited before registering"
        );
        assert!(Instant::now() < deadline, "daemon did not register");
        thread::sleep(Duration::from_millis(10));
    }
}

/// ConPTY applies a resize asynchronously in conhost, so the child can briefly
/// observe the old size after the daemon has acknowledged the request.
fn wait_size(child: &mut terminal_fixture::Connection, cols: u16, rows: u16) {
    let expected = serde_json::json!([cols, rows]);
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let size = child.command(FixtureCommand::Size);
        if size == expected {
            return;
        }
        assert!(Instant::now() < deadline, "console size stayed {size}");
        thread::sleep(Duration::from_millis(10));
    }
}

fn wait(child: &mut Child) -> std::process::ExitStatus {
    let deadline = Instant::now() + Duration::from_secs(8);
    loop {
        if let Some(status) = child.try_wait().unwrap() {
            return status;
        }
        assert!(Instant::now() < deadline, "daemon did not exit");
        thread::sleep(Duration::from_millis(10));
    }
}

#[test]
fn authenticated_ownership_handoff_and_shutdown_use_real_pipes() {
    let _deadline = Deadline::new();
    let mut daemon = Daemon::start();
    let mut invalid = daemon.connect();
    write_frame(
        &mut invalid,
        &Envelope {
            token: "wrong".into(),
            request: Request::Ping,
        },
    )
    .unwrap();
    assert!(
        matches!(read_frame(&mut invalid).unwrap(), Response::Error { message } if message == "authentication failed")
    );
    drop(invalid);
    assert!(matches!(
        daemon.request(Request::Own {
            instance_id: "wrong".into(),
            ticket: None
        }),
        Response::Error { .. }
    ));
    let (mut owner, response) = daemon.own(None);
    assert!(matches!(response, Response::Owned));
    assert!(matches!(daemon.own(None).1, Response::Error { .. }));
    let Response::Handoff { ticket, expires_at } = daemon.send(&mut owner, Request::PrepareHandoff)
    else {
        panic!("handoff response");
    };
    assert!(
        matches!(daemon.send(&mut owner, Request::PrepareHandoff), Response::Handoff { ticket: repeated, expires_at: deadline } if repeated == ticket && deadline == expires_at)
    );
    // A valid ticket takes over even while the previous owner is connected.
    let (mut successor, response) = daemon.own(Some(ticket.clone()));
    assert!(matches!(response, Response::Owned));
    assert!(matches!(
        daemon.send(&mut owner, Request::Shutdown),
        Response::Error { message } if message == "owner connection has been superseded"
    ));
    drop(owner);
    assert!(matches!(daemon.own(Some(ticket)).1, Response::Error { .. }));
    assert!(matches!(
        daemon.request(Request::Ping),
        Response::Pong { .. }
    ));
    assert!(matches!(
        daemon.send(&mut successor, Request::Shutdown),
        Response::Ok
    ));
    drop(successor); // Protocol completion, not Unix half-close.
    daemon.wait();
}

#[test]
fn service_lock_and_stale_registration_are_instance_scoped() {
    let _deadline = Deadline::new();
    let mut daemon = Daemon::start();
    let mut duplicate = spawn(&daemon.directory);
    assert!(!wait(&mut duplicate).success());
    let old = daemon.registration.clone();
    daemon.child.kill().unwrap();
    daemon.child.wait().unwrap();
    assert!(daemon.directory.join("service.json").exists());
    daemon.child = spawn(&daemon.directory);
    daemon.registration = registration(&mut daemon.child, &daemon.directory);
    assert_ne!(old.instance_id, daemon.registration.instance_id);
    assert_ne!(old.token, daemon.registration.token);
    assert_ne!(old.socket, daemon.registration.socket);
    let (owner, response) = daemon.own(None);
    assert!(matches!(response, Response::Owned));
    assert!(matches!(daemon.request(Request::Shutdown), Response::Ok));
    drop(owner);
    daemon.wait();
}

#[test]
fn unclaimed_daemon_cancels_a_partial_request() {
    let _deadline = Deadline::new();
    let mut daemon = Daemon::start();
    let mut partial = daemon.connect();
    partial.write_all(&[0, 0]).unwrap();
    daemon.wait();
}

#[test]
fn named_pipe_daemon_create_input_output_resize_and_shutdown() {
    let _deadline = Deadline::new();
    let mut daemon = Daemon::start();
    let (owner, response) = daemon.own(None);
    assert!(matches!(response, Response::Owned));
    let fixture = Fixture::new();
    // Exercise a path containing spaces/Unicode using the shared child fixture.
    let executable = daemon.root.executable("daemon fixture.exe");
    let mut request = fixture.request();
    request.program = executable.to_str().unwrap().into();
    let terminal = daemon.create(request);
    let mut child = fixture.connect();
    let mut subscription = daemon.subscribe(terminal.id, AttachmentRole::Observer);
    child.command(FixtureCommand::Output("\x1b[2J\x1b[Hdaemon-output".into()));
    let mut bytes = Vec::new();
    while !String::from_utf8_lossy(&bytes).contains("daemon-output") {
        if let SubscriptionEvent::Output { bytes: output, .. } =
            read_subscription_event(&mut subscription).unwrap()
        {
            bytes.extend(output);
        }
    }
    let input = b"real-input";
    assert!(matches!(
        daemon.request(Request::Write {
            id: terminal.id,
            attachment_id: None,
            data_base64: base64::engine::general_purpose::STANDARD.encode(input)
        }),
        Response::Ok
    ));
    assert_eq!(
        child.command(FixtureCommand::Read(input.len())),
        serde_json::json!(input)
    );
    assert!(matches!(
        daemon.request(Request::Resize {
            id: terminal.id,
            attachment_id: None,
            cols: 93,
            rows: 31
        }),
        Response::Ok
    ));
    wait_size(&mut child, 93, 31);
    assert!(
        matches!(daemon.request(Request::Snapshot { id: terminal.id }), Response::Snapshot { text, .. } if text.contains("daemon-output"))
    );
    // Natural-exit/EOF ordering belongs to the runtime cleanup milestone. This
    // basic daemon test deliberately exercises live-child operations + shutdown.
    drop(subscription);
    assert!(matches!(daemon.request(Request::Shutdown), Response::Ok));
    drop(owner);
    daemon.wait();
}

#[test]
fn owner_loss_cancels_blocked_subscriber_and_partial_request() {
    let _deadline = Deadline::new();
    let mut daemon = Daemon::start();
    let (owner, response) = daemon.own(None);
    assert!(matches!(response, Response::Owned));
    let fixture = Fixture::new();
    let terminal = daemon.create(fixture.request());
    let mut child = fixture.connect();
    // SAFETY: open the live child for waiting; PID is only used to obtain a
    // stable process handle for this assertion, not as terminal identity.
    let process = unsafe { OpenProcess(PROCESS_SYNCHRONIZE, 0, terminal.pid.unwrap()) };
    assert!(!process.is_null());
    let process = unsafe { OwnedHandle::from_raw_handle(process) };
    let _blocked = daemon.subscribe(terminal.id, AttachmentRole::Controller);
    let mut partial = daemon.connect();
    partial.write_all(&[0, 0]).unwrap();
    child.command(FixtureCommand::Output("x".repeat(256 * 1024)));
    thread::sleep(Duration::from_millis(100));
    drop(owner);
    daemon.wait();
    assert_eq!(
        unsafe { WaitForSingleObject(process.as_raw_handle(), 3000) },
        WAIT_OBJECT_0
    );
}

#[test]
fn natural_exit_delivers_contiguous_output_and_retains_final_state() {
    let _deadline = Deadline::new();
    let mut daemon = Daemon::start();
    let (owner, response) = daemon.own(None);
    assert!(matches!(response, Response::Owned));
    let fixture = Fixture::new();
    let terminal = daemon.create(fixture.request());
    let mut child = fixture.connect();
    // Capture a stable process handle before exit; the PID is not terminal identity.
    let process = unsafe {
        OpenProcess(
            PROCESS_SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION,
            0,
            terminal.pid.unwrap(),
        )
    };
    assert!(!process.is_null());
    let process = unsafe { OwnedHandle::from_raw_handle(process) };

    child.command(FixtureCommand::Output(
        "\x1b[2J\x1b[HBEFORE_ATTACH_MARKER\r\n".into(),
    ));
    daemon.wait_text(terminal.id, "BEFORE_ATTACH_MARKER");
    let (mut subscription, response) =
        daemon.attach(terminal.id, "exit-observer", AttachmentRole::Observer);
    let Response::Attached {
        requested_offset,
        available_offset,
        end_offset,
        truncated,
        replay_base64,
        ..
    } = response
    else {
        panic!("attach: {response:?}");
    };
    assert_eq!(requested_offset, 0);
    assert_eq!(available_offset, 0);
    assert!(!truncated);
    let mut bytes = base64::engine::general_purpose::STANDARD
        .decode(replay_base64)
        .unwrap();
    assert_eq!(end_offset, bytes.len() as u64);
    assert!(String::from_utf8_lossy(&bytes).contains("BEFORE_ATTACH_MARKER"));
    let mut offset = end_offset;

    child.command(FixtureCommand::Output("\r\nFINAL_DAEMON_MARKER\r\n".into()));
    child.command(FixtureCommand::Exit(23));
    let exit_code = loop {
        match read_subscription_event(&mut subscription).unwrap() {
            SubscriptionEvent::Output {
                start,
                end,
                bytes: output,
            } => {
                assert_eq!(
                    start, offset,
                    "output must be contiguous after attachment replay"
                );
                assert_eq!(end - start, output.len() as u64);
                bytes.extend(output);
                offset = end;
            }
            SubscriptionEvent::Response(response) => match *response {
                Response::Exited {
                    exit_code,
                    final_offset,
                } => {
                    assert_eq!(final_offset, offset);
                    break exit_code;
                }
                Response::Error { message } => panic!("subscription: {message}"),
                _ => {}
            },
        }
    };
    drop(subscription);
    assert!(String::from_utf8_lossy(&bytes).contains("FINAL_DAEMON_MARKER"));
    // SAFETY: the live owned process handle permits waiting and exit-code queries.
    assert_eq!(
        unsafe { WaitForSingleObject(process.as_raw_handle(), 3000) },
        WAIT_OBJECT_0
    );
    let mut actual_exit = 0;
    assert_ne!(
        unsafe { GetExitCodeProcess(process.as_raw_handle(), &mut actual_exit) },
        0
    );
    assert_eq!(actual_exit, 23);
    assert_eq!(exit_code, Some(actual_exit));

    let (info, text) = daemon.snapshot(terminal.id);
    assert_eq!(info.lifecycle, TerminalLifecycle::Exited { exit_code });
    assert_eq!(info.output_tail, offset);
    assert!(text.contains("FINAL_DAEMON_MARKER"), "{text:?}");
    let Response::Rows {
        terminal: rows_info,
        lines,
        ..
    } = daemon.request(Request::ReadRows {
        id: terminal.id,
        rows: None,
    })
    else {
        panic!("rows response");
    };
    assert_eq!(rows_info.lifecycle, info.lifecycle);
    assert_eq!(rows_info.output_tail, offset);
    assert!(
        lines
            .iter()
            .any(|line| line.contains("FINAL_DAEMON_MARKER"))
    );
    let Response::Replay {
        requested_offset,
        available_offset,
        end_offset,
        truncated,
        data_base64,
    } = daemon.request(Request::Replay {
        id: terminal.id,
        offset: 0,
    })
    else {
        panic!("replay response");
    };
    assert_eq!(requested_offset, 0);
    assert_eq!(available_offset, 0);
    assert_eq!(end_offset, offset);
    assert!(!truncated);
    assert_eq!(
        base64::engine::general_purpose::STANDARD
            .decode(data_base64)
            .unwrap(),
        bytes
    );
    assert!(
        matches!(daemon.own(None).1, Response::Error { .. }),
        "terminal exit must not lose the live owner"
    );
    assert!(matches!(
        daemon.request(Request::Terminate { id: terminal.id }),
        Response::Ok
    ));
    assert!(
        matches!(daemon.request(Request::List), Response::Terminals { terminals } if terminals.is_empty())
    );
    assert!(matches!(daemon.request(Request::Shutdown), Response::Ok));
    drop(owner);
    daemon.wait();
}

#[test]
fn observer_disconnect_and_control_input_preserve_independent_terminals() {
    let _deadline = Deadline::new();
    let mut daemon = Daemon::start();
    let (owner, response) = daemon.own(None);
    assert!(matches!(response, Response::Owned));
    let first_fixture = Fixture::new();
    let second_fixture = Fixture::new();
    let first = daemon.create(first_fixture.request());
    let second = daemon.create(second_fixture.request());
    assert_ne!(first.id, second.id);
    let mut first_child = first_fixture.connect();
    let mut second_child = second_fixture.connect();
    let (first_control, response) =
        daemon.attach(first.id, "first-controller", AttachmentRole::Controller);
    assert!(matches!(response, Response::Attached { .. }));
    let (second_control, response) =
        daemon.attach(second.id, "second-controller", AttachmentRole::Observer);
    assert!(matches!(response, Response::Attached { .. }));
    let (observer, response) =
        daemon.attach(first.id, "disposable-observer", AttachmentRole::Observer);
    assert!(matches!(response, Response::Attached { .. }));
    drop(observer);

    let first_input = b"first-directed";
    assert!(matches!(
        daemon.request(Request::Input {
            id: first.id,
            attachment_id: "first-controller".into(),
            cols: 91,
            rows: 27,
            data_base64: base64::engine::general_purpose::STANDARD.encode(first_input),
        }),
        Response::Ok
    ));
    assert_eq!(
        first_child.command(FixtureCommand::Read(first_input.len())),
        serde_json::json!(first_input)
    );
    wait_size(&mut first_child, 91, 27);

    assert!(matches!(
        daemon.request(Request::Control {
            id: second.id,
            attachment_id: "second-controller".into(),
            cols: 73,
            rows: 29,
        }),
        Response::Ok
    ));
    wait_size(&mut second_child, 73, 29);
    let second_input = b"second-directed";
    assert!(matches!(
        daemon.request(Request::Input {
            id: second.id,
            attachment_id: "second-controller".into(),
            cols: 74,
            rows: 30,
            data_base64: base64::engine::general_purpose::STANDARD.encode(second_input),
        }),
        Response::Ok
    ));
    assert_eq!(
        second_child.command(FixtureCommand::Read(second_input.len())),
        serde_json::json!(second_input)
    );
    wait_size(&mut second_child, 74, 30);
    assert_eq!(
        first_child.command(FixtureCommand::Size),
        serde_json::json!([91, 27])
    );
    first_child.command(FixtureCommand::Output(
        "\x1b[2J\x1b[HFIRST_ONLY_MARKER".into(),
    ));
    second_child.command(FixtureCommand::Output(
        "\x1b[2J\x1b[HSECOND_ONLY_MARKER".into(),
    ));
    let (first_info, first_text) = daemon.wait_text(first.id, "FIRST_ONLY_MARKER");
    let (second_info, second_text) = daemon.wait_text(second.id, "SECOND_ONLY_MARKER");
    assert_eq!(first_info.lifecycle, TerminalLifecycle::Running);
    assert_eq!(second_info.lifecycle, TerminalLifecycle::Running);
    assert!(!first_text.contains("SECOND_ONLY_MARKER"));
    assert!(!second_text.contains("FIRST_ONLY_MARKER"));
    assert!(
        matches!(daemon.request(Request::List), Response::Terminals { terminals } if terminals.len() == 2)
    );
    assert!(
        matches!(daemon.request(Request::Ping), Response::Pong { instance_id, pid, protocol: 7 }
        if instance_id == daemon.registration.instance_id && pid == daemon.registration.pid)
    );
    assert!(matches!(daemon.own(None).1, Response::Error { .. }));

    assert!(matches!(
        daemon.request(Request::Terminate { id: first.id }),
        Response::Ok
    ));
    drop(first_control);
    assert!(
        matches!(daemon.request(Request::List), Response::Terminals { terminals }
        if terminals.len() == 1 && terminals[0].id == second.id)
    );
    let input = b"after-first-exit";
    assert!(matches!(
        daemon.request(Request::Input {
            id: second.id,
            attachment_id: "second-controller".into(),
            cols: 74,
            rows: 30,
            data_base64: base64::engine::general_purpose::STANDARD.encode(input),
        }),
        Response::Ok
    ));
    assert_eq!(
        second_child.command(FixtureCommand::Read(input.len())),
        serde_json::json!(input)
    );
    second_child.command(FixtureCommand::Output("\r\nSECOND_SURVIVES\r\n".into()));
    assert_eq!(
        daemon.wait_text(second.id, "SECOND_SURVIVES").0.lifecycle,
        TerminalLifecycle::Running
    );
    drop(second_control);
    assert!(matches!(
        daemon.request(Request::Terminate { id: second.id }),
        Response::Ok
    ));
    assert!(matches!(daemon.request(Request::Shutdown), Response::Ok));
    drop(owner);
    daemon.wait();
}
