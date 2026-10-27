#![cfg(unix)]

#[path = "support/resize_fixture.rs"]
mod resize_fixture;

use std::env;
use std::thread;
use std::time::{Duration, Instant};

use opencode_pty::service::{CreateTerminal, TerminalLifecycle, TerminalService};
use opencode_pty::{protocol::AttachmentRole, service::StreamEvent};
use resize_fixture::ResizeFixture;

#[test]
fn resize_reports_reach_a_silent_child() {
    let mut fixture = ResizeFixture::new("resize_reports_reach_a_silent_child");
    fixture.service.resize(fixture.id, 100, 40).unwrap();
    fixture.expect_input(b"\x1b[48;40;100;0;0t");
}

#[test]
fn control_resize_reports_precede_user_input() {
    let mut fixture = ResizeFixture::new("control_resize_reports_precede_user_input");
    let _controller = fixture
        .service
        .attach(
            fixture.id,
            0,
            "controller".into(),
            AttachmentRole::Controller,
            false,
        )
        .unwrap();
    let _observer = fixture
        .service
        .attach(
            fixture.id,
            0,
            "observer".into(),
            AttachmentRole::Observer,
            false,
        )
        .unwrap();
    fixture
        .service
        .input(fixture.id, "observer".into(), 120, 50, b"typed".to_vec())
        .unwrap();
    fixture.expect_input(b"\x1b[48;50;120;0;0ttyped");
}

#[test]
fn repeated_resize_reports_are_delivered_once() {
    let mut fixture = ResizeFixture::new("repeated_resize_reports_are_delivered_once");
    for (cols, rows) in [(30, 10), (31, 11), (32, 12)] {
        fixture.service.resize(fixture.id, cols, rows).unwrap();
        fixture.expect_input(format!("\x1b[48;{rows};{cols};0;0t").as_bytes());
    }
    fixture.service.write(fixture.id, b"!".to_vec()).unwrap();
    fixture.expect_input(b"!\x1b[0n");
}

fn command(script: &str) -> CreateTerminal {
    CreateTerminal {
        program: "/bin/sh".to_string(),
        args: vec!["-c".to_string(), script.to_string()],
        cwd: env::current_dir().expect("cwd"),
        title: "test".to_string(),
        group_id: "test".to_string(),
        env: std::collections::HashMap::new(),
        cols: 80,
        rows: 24,
    }
}

fn wait_for(mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if condition() {
            return;
        }
        thread::sleep(Duration::from_millis(10));
    }
    panic!("condition did not become true");
}

#[test]
fn read_rows_snapshots_live_state_without_taking_control() {
    let service = TerminalService::default();
    let mut request =
        command(r"printf '\033]2;rows-title\007one\ntwo\nthree\nfour\nfive'; sleep 1");
    request.cols = 10;
    request.rows = 3;
    let terminal = service.create(request).expect("terminal created");
    wait_for(|| {
        service
            .read_rows(terminal.id, None)
            .is_ok_and(|rows| rows.lines == ["three", "four", "five"])
    });
    let controller = service
        .attach(
            terminal.id,
            0,
            "controller".to_string(),
            AttachmentRole::Controller,
            false,
        )
        .unwrap();
    let snapshot = service.snapshot(terminal.id).unwrap();
    let replay = service.replay(terminal.id, 0).unwrap();
    let rows = service.read_rows(terminal.id, Some(u16::MAX)).unwrap();
    assert_eq!(rows.lines, ["one", "two", "three", "four", "five"]);
    assert_eq!(rows.terminal.id, terminal.id);
    assert_eq!(rows.terminal.title, "rows-title");
    assert_eq!((rows.terminal.cols, rows.terminal.rows), (10, 3));
    assert_eq!((rows.cursor_x, rows.cursor_y), (4, 2));
    assert_eq!(rows.terminal.output_tail, replay.end_offset);
    assert_eq!(
        service.snapshot(terminal.id).unwrap().checkpoint,
        snapshot.checkpoint
    );
    assert_eq!(service.replay(terminal.id, 0).unwrap().bytes, replay.bytes);
    assert!(service.resize(terminal.id, 12, 4).is_err());
    service
        .resize_for(terminal.id, Some("controller".to_string()), 12, 4)
        .unwrap();
    let rows = service.read_rows(terminal.id, None).unwrap();
    assert_eq!(rows.lines, ["two", "three", "four", "five"]);
    assert_eq!((rows.terminal.cols, rows.terminal.rows), (12, 4));
    assert_eq!((rows.cursor_x, rows.cursor_y), (4, 3));
    assert!(
        service
            .read_rows(terminal.id, Some(0))
            .unwrap_err()
            .to_string()
            .contains("positive")
    );
    drop(controller);
    service.terminate(terminal.id).unwrap();
    assert!(service.read_rows(terminal.id, None).is_err());
}

#[test]
fn terminals_run_independently_and_one_exit_does_not_stop_service() {
    let service = TerminalService::new(64 * 1024);
    let alpha = service
        .create(command("printf 'alpha\\n'; sleep 0.05"))
        .expect("alpha created");
    let beta = service
        .create(command("printf 'beta\\n'; sleep 0.2"))
        .expect("beta created");

    wait_for(|| {
        service
            .snapshot(alpha.id)
            .is_ok_and(|snapshot| snapshot.text.contains("alpha"))
            && service
                .snapshot(beta.id)
                .is_ok_and(|snapshot| snapshot.text.contains("beta"))
    });
    wait_for(|| {
        service.list().is_ok_and(|terminals| {
            terminals.iter().any(|terminal| {
                terminal.id == alpha.id
                    && matches!(terminal.lifecycle, TerminalLifecycle::Exited { .. })
            })
        })
    });

    let gamma = service
        .create(command("printf 'gamma\\n'; sleep 0.05"))
        .expect("service creates terminal after child exit");
    wait_for(|| {
        service
            .snapshot(gamma.id)
            .is_ok_and(|snapshot| snapshot.text.contains("gamma"))
    });

    service.terminate(alpha.id).expect("alpha removed");
    service.terminate(beta.id).expect("beta removed");
    service.terminate(gamma.id).expect("gamma removed");
}

#[test]
fn hidden_terminal_output_uses_bounded_replay() {
    let service = TerminalService::new(32);
    let terminal = service
        .create(command("printf '0123456789abcdefghijklmnopqrstuvwxyz'"))
        .expect("terminal created");

    wait_for(|| {
        service.list().is_ok_and(|items| {
            items
                .iter()
                .any(|item| item.id == terminal.id && item.output_tail >= 36)
        })
    });
    let replay = service.replay(terminal.id, 0).expect("replay");
    assert!(replay.truncated);
    assert_eq!(replay.bytes.len(), 32);
    assert_eq!(replay.end_offset - replay.available_offset, 32);

    service.terminate(terminal.id).expect("terminal removed");
}

#[test]
fn title_changes_update_metadata_and_notify_subscribers() {
    let service = TerminalService::new(64 * 1024);
    let terminal = service
        .create(command(
            r"sleep 0.05; printf '\033]2;dynamic-title\007'; sleep 0.2",
        ))
        .expect("terminal created");
    let observer = service
        .attach(
            terminal.id,
            0,
            "observer".to_string(),
            AttachmentRole::Observer,
            false,
        )
        .expect("observer attached");

    let deadline = Instant::now() + Duration::from_secs(2);
    let title = loop {
        assert!(
            Instant::now() < deadline,
            "timed out waiting for title change"
        );
        match observer.events.recv_timeout(Duration::from_millis(50)) {
            Ok(StreamEvent::TitleChanged { title }) => break title,
            Ok(_) | Err(crossbeam_channel::RecvTimeoutError::Timeout) => {}
            Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
                panic!("observer disconnected before title change")
            }
        }
    };

    assert_eq!(title, "dynamic-title");
    assert!(service.list().is_ok_and(|items| {
        items
            .iter()
            .any(|item| item.id == terminal.id && item.title == "dynamic-title")
    }));

    service.terminate(terminal.id).expect("terminal removed");
}

#[test]
#[cfg(target_os = "linux")]
fn foreground_process_tracks_deepest_tty_attached_job() {
    let service = TerminalService::new(64 * 1024);
    let terminal = service
        .create(command("exec /bin/sh"))
        .expect("terminal created");
    let controller = service
        .attach(
            terminal.id,
            0,
            "controller".to_string(),
            AttachmentRole::Controller,
            false,
        )
        .expect("controller attached");
    service
        .input(
            terminal.id,
            "controller".to_string(),
            80,
            24,
            b"tail --pid=$$ -f /dev/null & sleep 5\n".to_vec(),
        )
        .expect("sleep submitted");

    let deadline = Instant::now() + Duration::from_secs(2);
    let process = loop {
        assert!(
            Instant::now() < deadline,
            "timed out waiting for foreground process"
        );
        service.list().expect("foreground process refreshed");
        match controller.events.recv_timeout(Duration::from_millis(50)) {
            Ok(StreamEvent::ForegroundProcessChanged {
                process: Some(process),
            }) if process == "sleep" => break process,
            Ok(_) | Err(crossbeam_channel::RecvTimeoutError::Timeout) => {}
            Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
                panic!("controller disconnected before foreground process change")
            }
        }
    };

    assert_eq!(process, "sleep");
    assert!(service.list().is_ok_and(|items| {
        items.iter().any(|item| {
            item.id == terminal.id && item.foreground_process.as_deref() == Some("sleep")
        })
    }));

    service.terminate(terminal.id).expect("terminal removed");
}

#[test]
fn bursty_output_does_not_disconnect_a_healthy_observer() {
    let service = TerminalService::new(2 * 1024 * 1024);
    let terminal = service
        .create(command("sleep 0.05; head -c 1048576 /dev/zero; sleep 0.2"))
        .expect("terminal created");
    let observer = service
        .attach(
            terminal.id,
            0,
            "observer".to_string(),
            AttachmentRole::Observer,
            false,
        )
        .expect("observer attached");

    wait_for(|| {
        service.list().is_ok_and(|items| {
            items
                .iter()
                .any(|item| item.id == terminal.id && item.output_tail >= 1024 * 1024)
        })
    });
    let deadline = Instant::now() + Duration::from_secs(2);
    let mut received = 0;
    let mut output_events = 0;
    while received < 1024 * 1024 && Instant::now() < deadline {
        match observer.events.recv_timeout(Duration::from_millis(50)) {
            Ok(StreamEvent::Output { bytes, .. }) => {
                received += bytes.len();
                output_events += 1;
            }
            Ok(_) | Err(crossbeam_channel::RecvTimeoutError::Timeout) => {}
            Err(crossbeam_channel::RecvTimeoutError::Disconnected) => break,
        }
    }
    assert_eq!(received, 1024 * 1024);
    assert!(
        output_events <= 256,
        "received {output_events} output events"
    );

    service.terminate(terminal.id).expect("terminal removed");
}

#[test]
fn controller_switches_without_disconnecting_observers() {
    let service = TerminalService::new(64 * 1024);
    let terminal = service
        .create(command("sleep 0.05; printf 'streamed\\n'; sleep 0.2"))
        .expect("terminal created");
    let controller = service
        .attach(
            terminal.id,
            0,
            "controller-a".to_string(),
            AttachmentRole::Controller,
            false,
        )
        .expect("controller attached");
    let observer = service
        .attach(
            terminal.id,
            0,
            "observer".to_string(),
            AttachmentRole::Observer,
            false,
        )
        .expect("observer attached");
    assert!(
        service
            .attach(
                terminal.id,
                0,
                "controller-b".to_string(),
                AttachmentRole::Controller,
                false,
            )
            .is_err()
    );
    assert!(
        service
            .write_for(
                terminal.id,
                Some("observer".to_string()),
                b"not allowed".to_vec(),
            )
            .is_err()
    );
    assert!(service.write(terminal.id, b"not allowed".to_vec()).is_err());
    assert!(service.resize(terminal.id, 90, 25).is_err());
    service
        .resize_for(terminal.id, Some("controller-a".to_string()), 90, 25)
        .expect("controller resizes");

    let saw_output = |events: &crossbeam_channel::Receiver<StreamEvent>| {
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            match events.recv_timeout(Duration::from_millis(50)) {
                Ok(StreamEvent::Output { bytes, .. })
                    if bytes.windows(8).any(|value| value == b"streamed") =>
                {
                    return true;
                }
                Ok(_) => {}
                Err(_) => {}
            }
        }
        false
    };
    assert!(saw_output(&controller.events));
    assert!(saw_output(&observer.events));

    let takeover = service
        .attach(
            terminal.id,
            0,
            "controller-b".to_string(),
            AttachmentRole::Controller,
            true,
        )
        .expect("controller takeover");
    assert!(takeover.generation > controller.generation);
    assert!(
        service
            .write_for(
                terminal.id,
                Some("controller-a".to_string()),
                b"not allowed".to_vec(),
            )
            .is_err()
    );
    service
        .input(
            terminal.id,
            "controller-a".to_string(),
            91,
            26,
            b"reclaimed\n".to_vec(),
        )
        .expect("former controller reclaims control and writes");
    assert!(
        service
            .write_for(
                terminal.id,
                Some("controller-b".to_string()),
                b"not allowed".to_vec(),
            )
            .is_err()
    );
    service
        .control(terminal.id, "observer".to_string(), 92, 27)
        .expect("observer claims control");
    service
        .control(terminal.id, "controller-b".to_string(), 93, 28)
        .expect("takeover controller remains subscribed");
    drop(takeover);
    service
        .write_for(
            terminal.id,
            Some("observer".to_string()),
            b"fallback\n".to_vec(),
        )
        .expect("latest remaining controller is promoted on detach");
    service.terminate(terminal.id).expect("terminal removed");
}
