#![cfg(unix)]

use std::io::{Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Barrier;
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::Engine;
use opencode_pty::daemon::Registration;
use opencode_pty::protocol::{
    AttachmentRole, Envelope, Request, Response, read_frame, write_frame,
};
use opencode_pty::service::TerminalInfo;

struct Daemon {
    child: Child,
    root: PathBuf,
    directory: PathBuf,
    registration: Registration,
}

impl Daemon {
    fn start() -> Self {
        let root = std::env::temp_dir().join(format!(
            "opencode-pty-ownership-{:032x}",
            rand::random::<u128>()
        ));
        let directory = root.join("test");
        let mut child = Command::new(env!("CARGO_BIN_EXE_opencode-pty"))
            .args(["daemon", "--name", "test", "--runtime-dir"])
            .arg(&root)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .spawn()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(3);
        let registration = loop {
            if let Ok(data) = std::fs::read(directory.join("service.json")) {
                break serde_json::from_slice::<Registration>(&data).unwrap();
            }
            assert!(
                child.try_wait().unwrap().is_none(),
                "daemon exited at startup"
            );
            if Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                panic!("daemon did not register");
            }
            thread::sleep(Duration::from_millis(10));
        };
        assert_eq!(registration.protocol, 7);
        Self {
            child,
            root,
            directory,
            registration,
        }
    }

    fn connect(&self) -> UnixStream {
        let stream = UnixStream::connect(&self.registration.socket).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        stream
            .set_write_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        stream
    }

    fn send(&self, stream: &mut UnixStream, request: Request) -> Response {
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

    fn own(&self, ticket: Option<String>) -> (UnixStream, Response) {
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

    fn terminal(&self, command: &str) -> TerminalInfo {
        match self.request(Request::Create {
            program: "/bin/sh".into(),
            args: vec!["-c".into(), command.into()],
            cwd: self.directory.clone(),
            title: "ownership".into(),
            group_id: "ownership".into(),
            env: Default::default(),
            cols: 80,
            rows: 24,
        }) {
            Response::Created { terminal } => terminal,
            response => panic!("create: {response:?}"),
        }
    }

    fn wait(&mut self) {
        self.exit();
        assert!(!self.registration.socket.exists());
    }

    fn exit(&mut self) {
        let deadline = Instant::now() + Duration::from_secs(7);
        loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                assert!(status.success(), "daemon exit: {status}");
                assert!(
                    !self.directory.exists(),
                    "runtime directory was not removed"
                );
                return;
            }
            assert!(Instant::now() < deadline, "daemon did not stop");
            thread::sleep(Duration::from_millis(10));
        }
    }
}

impl Drop for Daemon {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            if let Ok(mut stream) = UnixStream::connect(&self.registration.socket) {
                let _ = stream.set_write_timeout(Some(Duration::from_secs(1)));
                let _ = write_frame(
                    &mut stream,
                    &Envelope {
                        token: self.registration.token.clone(),
                        request: Request::Shutdown,
                    },
                );
            }
            let deadline = Instant::now() + Duration::from_secs(6);
            while self.child.try_wait().ok().flatten().is_none() && Instant::now() < deadline {
                thread::sleep(Duration::from_millis(10));
            }
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

fn assert_terminal_stopped(terminal: &TerminalInfo) {
    // SAFETY: signal zero only checks whether this child PID still exists.
    assert_eq!(unsafe { libc::kill(terminal.pid.unwrap() as i32, 0) }, -1);
    assert_eq!(
        std::io::Error::last_os_error().raw_os_error(),
        Some(libc::ESRCH)
    );
}

#[test]
fn owner_loss_stops_terminals_despite_blocked_clients() {
    let mut daemon = Daemon::start();
    let mut unauthenticated = daemon.connect();
    write_frame(
        &mut unauthenticated,
        &Envelope {
            token: "wrong-token".into(),
            request: Request::Own {
                instance_id: daemon.registration.instance_id.clone(),
                ticket: None,
            },
        },
    )
    .unwrap();
    assert!(
        matches!(read_frame(&mut unauthenticated).unwrap(), Response::Error { message } if message == "authentication failed")
    );
    assert!(matches!(
        daemon.request(Request::Own {
            instance_id: "wrong-instance".into(),
            ticket: None,
        }),
        Response::Error { .. }
    ));
    let (owner, response) = daemon.own(None);
    assert!(matches!(response, Response::Owned));
    assert!(matches!(daemon.own(None).1, Response::Error { .. }));

    let terminal = daemon.terminal("while :; do printf '\\rowner-output'; done");
    let mut subscription = daemon.connect();
    assert!(matches!(
        daemon.send(
            &mut subscription,
            Request::Subscribe {
                id: terminal.id,
                offset: 0,
                attachment_id: "blocked-controller".into(),
                role: AttachmentRole::Controller,
                takeover: false,
            }
        ),
        Response::Attached { .. }
    ));
    let mut partial = daemon.connect();
    partial.write_all(&[0, 0]).unwrap();
    thread::sleep(Duration::from_millis(200));
    drop(owner);
    daemon.wait();
    assert_terminal_stopped(&terminal);
}

#[test]
fn subscription_delivers_final_exit_frame_before_closing() {
    use opencode_pty::protocol::{SubscriptionEvent, read_subscription_event};

    let mut daemon = Daemon::start();
    let (owner, response) = daemon.own(None);
    assert!(matches!(response, Response::Owned));
    let terminal = daemon.terminal("read line; printf final-output");
    let mut subscription = daemon.connect();
    assert!(matches!(
        daemon.send(
            &mut subscription,
            Request::Subscribe {
                id: terminal.id,
                offset: 0,
                attachment_id: "final-observer".into(),
                role: AttachmentRole::Observer,
                takeover: false,
            }
        ),
        Response::Attached { .. }
    ));
    assert!(matches!(
        daemon.request(Request::Write {
            id: terminal.id,
            attachment_id: None,
            data_base64: base64::engine::general_purpose::STANDARD.encode(b"finish\n"),
        }),
        Response::Ok
    ));
    let mut output = Vec::new();
    loop {
        match read_subscription_event(&mut subscription).unwrap() {
            SubscriptionEvent::Output { bytes, .. } => output.extend(bytes),
            SubscriptionEvent::Response(response) => match *response {
                Response::Exited {
                    exit_code,
                    final_offset,
                } => {
                    assert_eq!(exit_code, Some(0));
                    assert_eq!(final_offset, output.len() as u64);
                    break;
                }
                Response::Error { message } => panic!("subscription error: {message}"),
                _ => {}
            },
        }
    }
    assert!(String::from_utf8_lossy(&output).contains("final-output"));
    drop(subscription);
    drop(owner);
    daemon.wait();
}

#[test]
fn handoff_preserves_daemon_and_terminal_and_shutdown_overrides_it() {
    let mut daemon = Daemon::start();
    let (mut owner, response) = daemon.own(None);
    assert!(matches!(response, Response::Owned));
    let terminal = daemon.terminal("exec cat");
    assert!(matches!(
        daemon.request(Request::PrepareHandoff),
        Response::Error { .. }
    ));
    let before = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    let Response::Handoff { ticket, expires_at } = daemon.send(&mut owner, Request::PrepareHandoff)
    else {
        panic!("handoff response");
    };
    assert!((before + 120_000..=before + 121_000).contains(&expires_at));
    assert!(
        matches!(daemon.send(&mut owner, Request::PrepareHandoff), Response::Handoff {
        ticket: repeated, expires_at: deadline,
    } if repeated == ticket && deadline == expires_at)
    );
    assert!(matches!(
        daemon.own(Some("wrong-ticket".into())).1,
        Response::Error { .. }
    ));
    // The old owner stays connected until the successor has acquired the daemon.
    let (mut successor, response) = daemon.own(Some(ticket.clone()));
    assert!(matches!(response, Response::Owned));
    assert!(matches!(daemon.own(Some(ticket)).1, Response::Error { .. }));
    drop(owner);

    let deadline = Instant::now() + Duration::from_secs(3);
    assert!(
        matches!(daemon.request(Request::Ping), Response::Pong { instance_id, pid, .. }
        if instance_id == daemon.registration.instance_id && pid == daemon.child.id())
    );
    assert!(
        matches!(daemon.request(Request::List), Response::Terminals { terminals }
        if terminals.len() == 1 && terminals[0].id == terminal.id && terminals[0].pid == terminal.pid)
    );
    assert!(matches!(
        daemon.request(Request::Write {
            id: terminal.id,
            attachment_id: None,
            data_base64: base64::engine::general_purpose::STANDARD.encode(b"after-handoff\n"),
        }),
        Response::Ok
    ));
    loop {
        if matches!(daemon.request(Request::Snapshot { id: terminal.id }), Response::Snapshot { text, .. }
            if text.contains("after-handoff"))
        {
            break;
        }
        assert!(
            Instant::now() < deadline,
            "terminal stopped responding after handoff"
        );
        thread::sleep(Duration::from_millis(10));
    }
    assert!(matches!(
        daemon.send(&mut successor, Request::PrepareHandoff),
        Response::Handoff { .. }
    ));
    assert!(matches!(daemon.request(Request::Shutdown), Response::Ok));
    daemon.wait();
    assert_terminal_stopped(&terminal);
}

#[test]
fn superseded_owner_cannot_prepare_handoff_or_shutdown() {
    for request in [Request::PrepareHandoff, Request::Shutdown] {
        let mut daemon = Daemon::start();
        let (mut owner, response) = daemon.own(None);
        assert!(matches!(response, Response::Owned));
        let Response::Handoff { ticket, .. } = daemon.send(&mut owner, Request::PrepareHandoff)
        else {
            panic!("handoff response");
        };
        let (mut successor, response) = daemon.own(Some(ticket));
        assert!(matches!(response, Response::Owned));
        assert!(matches!(
            daemon.send(&mut owner, request),
            Response::Error { message } if message == "owner connection has been superseded"
        ));
        // EOF confirms the stale handler has run its disconnect cleanup.
        assert_eq!(owner.read(&mut [0]).unwrap(), 0);
        assert!(matches!(
            daemon.request(Request::Ping),
            Response::Pong { .. }
        ));
        assert!(matches!(
            daemon.send(&mut successor, Request::PrepareHandoff),
            Response::Handoff { .. }
        ));
        assert!(matches!(
            daemon.send(&mut successor, Request::Shutdown),
            Response::Ok
        ));
        daemon.wait();
    }
}

#[test]
fn handoff_ticket_has_only_one_winner() {
    let mut daemon = Daemon::start();
    let (mut owner, response) = daemon.own(None);
    assert!(matches!(response, Response::Owned));
    let Response::Handoff { ticket, .. } = daemon.send(&mut owner, Request::PrepareHandoff) else {
        panic!("handoff response");
    };
    let barrier = Barrier::new(2);
    let results = thread::scope(|scope| {
        let claim = || {
            barrier.wait();
            daemon.own(Some(ticket.clone()))
        };
        let first = scope.spawn(claim);
        let second = scope.spawn(claim);
        [first.join().unwrap(), second.join().unwrap()]
    });
    assert_eq!(
        results
            .iter()
            .filter(|(_, response)| matches!(response, Response::Owned))
            .count(),
        1
    );
    assert_eq!(
        results
            .iter()
            .filter(|(_, response)| matches!(response, Response::Error { .. }))
            .count(),
        1
    );
    // Losing the new owner must stop the daemon even if the old socket is still open.
    drop(results);
    daemon.wait();
    assert_eq!(owner.read(&mut [0]).unwrap(), 0);
}

#[test]
fn unclaimed_daemon_times_out() {
    let mut daemon = Daemon::start();
    let _partial = daemon.connect();
    daemon.wait();
}

#[test]
fn shutdown_keeps_a_replaced_socket() {
    let mut daemon = Daemon::start();
    let (mut owner, response) = daemon.own(None);
    assert!(matches!(response, Response::Owned));
    // A successor bound the same path; the exiting daemon must not unlink it.
    std::fs::remove_file(&daemon.registration.socket).unwrap();
    let replacement = UnixListener::bind(&daemon.registration.socket).unwrap();
    assert!(matches!(
        daemon.send(&mut owner, Request::Shutdown),
        Response::Ok
    ));
    daemon.exit();
    assert!(daemon.registration.socket.exists());
    drop(replacement);
    std::fs::remove_file(&daemon.registration.socket).unwrap();
}
