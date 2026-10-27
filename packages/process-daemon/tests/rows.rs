#![cfg(unix)]

use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use opencode_pty::client::TerminalClient;
use opencode_pty::daemon::{REGISTRATION_FILE, Registration};
use opencode_pty::protocol::{Envelope, Request, Response, read_frame, write_frame};
use opencode_pty::service::CreateTerminal;

#[test]
fn daemon_client_read_rows_roundtrip() {
    // Run the Rust client in a child test process so discovery's environment is
    // isolated without mutating this multithreaded test process's environment.
    if let Some(directory) = std::env::var_os("OPENCODE_PTY_ROWS_TEST_CHILD") {
        let directory = std::path::PathBuf::from(directory);
        let client = TerminalClient::discover(&directory).unwrap();
        let mut request = CreateTerminal::shell().unwrap();
        request.program = "/bin/sh".to_string();
        request.args = vec!["-c".to_string(), "printf 'one\ntwo\n\nfour\n'".to_string()];
        request.cols = 10;
        request.rows = 3;
        let terminal = client.create(request).unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            let rows = client.read_rows(terminal.id, None).unwrap();
            if rows.lines == ["", "four", ""] {
                assert_eq!((rows.terminal.cols, rows.terminal.rows), (10, 3));
                assert_eq!((rows.cursor_x, rows.cursor_y), (0, 2));
                break;
            }
            assert!(Instant::now() < deadline, "terminal output not received");
            thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(client.read_rows(terminal.id, Some(1)).unwrap().lines, [""]);
        assert_eq!(
            client.read_rows(terminal.id, Some(5)).unwrap().lines,
            ["one", "two", "", "four", ""]
        );
        assert!(
            client
                .read_rows(terminal.id, Some(0))
                .unwrap_err()
                .to_string()
                .contains("positive")
        );

        let registration = opencode_pty::daemon::read_registration(&directory).unwrap();
        assert_eq!(registration.protocol, 7);
        // Exercise omitted rows independently of the Rust client's null encoding.
        let mut stream = std::os::unix::net::UnixStream::connect(registration.socket).unwrap();
        write_frame(
            &mut stream,
            &serde_json::json!({
                "token": registration.token,
                "request": { "op": "read_rows", "id": terminal.id }
            }),
        )
        .unwrap();
        let response: serde_json::Value = read_frame(&mut stream).unwrap();
        assert_eq!(response["type"], "rows");
        assert_eq!(response["lines"], serde_json::json!(["", "four", ""]));
        assert_eq!(response["terminal"]["id"], terminal.id);
        assert_eq!(response["cursor_y"], 2);
        client.resize(terminal.id, 12, 4).unwrap();
        let rows = client.read_rows(terminal.id, None).unwrap();
        assert_eq!(rows.lines, ["two", "", "four", ""]);
        assert_eq!((rows.terminal.cols, rows.terminal.rows), (12, 4));
        client.terminate(terminal.id).unwrap();
        return;
    }

    let root =
        std::env::temp_dir().join(format!("opencode-pty-rows-{:032x}", rand::random::<u128>()));
    let runtime = root.join("rows");
    let mut daemon = Command::new(env!("CARGO_BIN_EXE_opencode-pty"))
        .args(["daemon", "--name", "rows", "--runtime-dir"])
        .arg(&root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(10);
    while !runtime.join(REGISTRATION_FILE).exists() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(10));
    }
    let registration: Registration =
        serde_json::from_slice(&std::fs::read(runtime.join(REGISTRATION_FILE)).unwrap()).unwrap();
    let mut owner = std::os::unix::net::UnixStream::connect(&registration.socket).unwrap();
    write_frame(
        &mut owner,
        &Envelope {
            token: registration.token,
            request: Request::Own {
                instance_id: registration.instance_id,
                ticket: None,
            },
        },
    )
    .unwrap();
    assert!(matches!(
        read_frame::<Response>(&mut owner).unwrap(),
        Response::Owned
    ));
    let result = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "daemon_client_read_rows_roundtrip",
            "--nocapture",
        ])
        .env("OPENCODE_PTY_ROWS_TEST_CHILD", &runtime)
        .output();
    drop(owner);
    assert!(daemon.wait().unwrap().success());
    let _ = std::fs::remove_dir_all(root);
    let output = result.unwrap();
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
