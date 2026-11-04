//! The two cases of `packages/cli/src/ssh-askpass.test.ts`, against the built binary.

use std::io::{Read, Write};
use std::net::TcpListener;
use std::process::{Command, Stdio};
use std::time::Duration;

/// A one-shot desktop on a free port: records the request line, then sends `chunks` 50 ms apart.
fn desktop(chunks: Vec<Vec<u8>>) -> (u16, std::thread::JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let handle = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket.set_nodelay(true).unwrap();
        let mut request = Vec::new();
        let mut byte = [0u8];
        while socket.read(&mut byte).unwrap() == 1 && byte[0] != b'\n' {
            request.push(byte[0]);
        }
        for (index, chunk) in chunks.iter().enumerate() {
            if index > 0 {
                std::thread::sleep(Duration::from_millis(50));
            }
            socket.write_all(chunk).unwrap();
        }
        String::from_utf8(request).unwrap()
    });
    (port, handle)
}

fn helper(port: u16, confirm: bool) -> std::process::Output {
    let home = tempfile::tempdir().unwrap();
    let mut command = Command::new(env!("CARGO_BIN_EXE_opencode-rs"));
    command
        .arg("Enter passphrase:")
        // Any log file would land here, never in the user's directories.
        .env("HOME", home.path())
        .env("XDG_DATA_HOME", home.path().join("data"))
        .env("OPENCODE_SSH_ASKPASS_PORT", port.to_string())
        .env("OPENCODE_SSH_ASKPASS_TOKEN", "fixture")
        .env("OPENCODE_PRINT_LOGS", "1")
        .env_remove("SSH_ASKPASS_PROMPT")
        .stdin(Stdio::null());
    if confirm {
        command.env("SSH_ASKPASS_PROMPT", "confirm");
    }
    let output = command.output().unwrap();
    assert!(
        !home.path().join("data").exists(),
        "the helper must not write logs"
    );
    output
}

#[test]
fn the_executable_askpass_branch_returns_only_the_response_without_cli_output() {
    let (port, desktop) = desktop(vec![br#"{"value":"passphrase\"with spaces"}"#.to_vec()]);
    let output = helper(port, true);
    assert_eq!(
        String::from_utf8(output.stdout).unwrap(),
        "passphrase\"with spaces\n"
    );
    assert_eq!(output.status.code(), Some(0));
    let request: serde_json::Value = serde_json::from_str(&desktop.join().unwrap()).unwrap();
    assert_eq!(
        request,
        serde_json::json!({ "token": "fixture", "text": "Enter passphrase:", "confirm": true })
    );
    assert_eq!(String::from_utf8(output.stderr).unwrap(), "");
}

#[test]
fn a_response_split_inside_a_multi_byte_character_is_written_intact() {
    let response = serde_json::json!({ "value": "pässwörd" })
        .to_string()
        .into_bytes();
    let split = response.iter().position(|byte| *byte == 0xc3).unwrap() + 1;
    let (port, desktop) = desktop(vec![response[..split].to_vec(), response[split..].to_vec()]);
    let output = helper(port, false);
    assert_eq!(String::from_utf8(output.stdout).unwrap(), "pässwörd\n");
    assert_eq!(output.status.code(), Some(0));
    desktop.join().unwrap();
}
