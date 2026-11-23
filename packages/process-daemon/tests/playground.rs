#![cfg(unix)]

use std::ffi::OsStr;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use std::time::{SystemTime, UNIX_EPOCH};

fn runtime_root(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!(
        "opencode-pty-test-{name}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos()
    ))
}

fn target(root: &Path) -> [&OsStr; 4] {
    [
        OsStr::new("--name"),
        OsStr::new("play"),
        OsStr::new("--runtime-dir"),
        root.as_os_str(),
    ]
}

fn output_with_timeout(mut child: std::process::Child) -> std::process::Output {
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        if child.try_wait().expect("child status").is_some() {
            return child.wait_with_output().expect("child output");
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    let _ = child.kill();
    let output = child.wait_with_output().expect("timed out child output");
    panic!(
        "child timed out\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn created_terminal_id(output: &[u8]) -> String {
    let output = String::from_utf8_lossy(output);
    let marker = "created terminal ";
    let start = output.find(marker).expect("created terminal output") + marker.len();
    output[start..]
        .split_whitespace()
        .next()
        .expect("terminal ID")
        .to_string()
}

fn read_created_terminal(child: &mut std::process::Child) -> String {
    let mut stdout = BufReader::new(child.stdout.as_mut().expect("stdout"));
    loop {
        let mut line = String::new();
        assert_ne!(stdout.read_line(&mut line).expect("playground output"), 0);
        if line.contains("created terminal ") {
            return line;
        }
    }
}

#[test]
fn playground_proves_authoritative_query_response() {
    let root = runtime_root("query");
    let runtime = root.join("play");
    let mut child = Command::new(env!("CARGO_BIN_EXE_opencode-pty"))
        .arg("play")
        .args(target(&root))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("playground starts");
    child
        .stdin
        .as_mut()
        .expect("stdin")
        .write_all(b"demo\nwait 50\nquit\n")
        .expect("commands written");
    let output = output_with_timeout(child);
    assert!(!runtime.join("service.json").exists());
    assert!(!runtime.exists(), "runtime directory was not removed");
    std::fs::remove_dir_all(&root).unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("QUERY_RESPONSE_OK"), "{stdout}");
}

#[test]
fn playground_exit_stops_all_terminals_and_observers_do_not_start_daemons() {
    let root = runtime_root("ownership");
    let runtime = root.join("play");
    let mut owner = Command::new(env!("CARGO_BIN_EXE_opencode-pty"))
        .arg("play")
        .args(target(&root))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("playground starts");
    let pids = (0..2)
        .map(|_| {
            owner
                .stdin
                .as_mut()
                .unwrap()
                .write_all(b"new /bin/cat\n")
                .unwrap();
            let line = read_created_terminal(&mut owner);
            line.split_once("Some(")
                .unwrap()
                .1
                .trim_end()
                .trim_end_matches("))")
                .parse::<i32>()
                .unwrap()
        })
        .collect::<Vec<_>>();

    let second = Command::new(env!("CARGO_BIN_EXE_opencode-pty"))
        .arg("play")
        .args(target(&root))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map(output_with_timeout)
        .unwrap();
    assert!(
        !second.status.success(),
        "second playground must not adopt the live daemon"
    );
    for command in ["list", "status"] {
        assert!(
            Command::new(env!("CARGO_BIN_EXE_opencode-pty"))
                .arg(command)
                .args(target(&root))
                .output()
                .unwrap()
                .status
                .success()
        );
    }
    owner.stdin.as_mut().unwrap().write_all(b"quit\n").unwrap();
    assert!(output_with_timeout(owner).status.success());
    assert!(!runtime.join("service.json").exists());
    for pid in pids {
        // SAFETY: signal zero only checks whether the terminal PID still exists.
        assert_eq!(unsafe { libc::kill(pid, 0) }, -1);
        assert_eq!(
            std::io::Error::last_os_error().raw_os_error(),
            Some(libc::ESRCH)
        );
    }
    for args in [&["list"][..], &["status"], &["watch", "1"]] {
        assert!(
            !Command::new(env!("CARGO_BIN_EXE_opencode-pty"))
                .args(args)
                .args(target(&root))
                .output()
                .unwrap()
                .status
                .success()
        );
        assert!(!runtime.join("service.json").exists());
    }
    assert!(!runtime.exists(), "runtime directory was not removed");
    std::fs::remove_dir_all(&root).unwrap();
}

#[test]
fn observer_stream_replays_and_follows_until_exit() {
    let root = runtime_root("stream");
    let runtime = root.join("play");
    let mut owner = Command::new(env!("CARGO_BIN_EXE_opencode-pty"))
        .arg("play")
        .args(target(&root))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("playground starts");
    owner
        .stdin
        .as_mut()
        .expect("stdin")
        .write_all(b"new /bin/sh -c \"printf watched; sleep 2; printf followed\"\n")
        .unwrap();
    let terminal_id = created_terminal_id(read_created_terminal(&mut owner).as_bytes());

    let watched = Command::new(env!("CARGO_BIN_EXE_opencode-pty"))
        .args(["watch", &terminal_id])
        .args(target(&root))
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map(output_with_timeout)
        .expect("observer exits with terminal");
    owner.stdin.as_mut().unwrap().write_all(b"quit\n").unwrap();
    assert!(output_with_timeout(owner).status.success());
    assert!(!runtime.join("service.json").exists());
    assert!(!runtime.exists(), "runtime directory was not removed");
    std::fs::remove_dir_all(&root).unwrap();
    assert!(
        watched.status.success(),
        "watch failed with {:?}: {}",
        watched.status.code(),
        String::from_utf8_lossy(&watched.stderr)
    );
    assert!(String::from_utf8_lossy(&watched.stdout).contains("watched"));
    assert!(String::from_utf8_lossy(&watched.stdout).contains("followed"));
}
