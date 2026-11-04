//! D.1: the delegated commands run `OPENCODE_TS_BIN` with the same arguments, stdio, and exit code. A fake
//! TypeScript binary records what it got, so nothing real is installed, removed, or served.

use std::io::Write;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::{Command, Output, Stdio};

const FAKE: &str = r#"#!/bin/sh
printf '%s\n' "$@" > "$DELEGATE_DIR/args"
echo "$$" > "$DELEGATE_DIR/pid"
echo "print-logs=$OPENCODE_PRINT_LOGS" > "$DELEGATE_DIR/env"
cat
echo "to stderr" >&2
exit "${DELEGATE_EXIT:-0}"
"#;

struct Fake {
    dir: tempfile::TempDir,
}

impl Fake {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("opencode");
        std::fs::write(&bin, FAKE).unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        Self { dir }
    }

    fn run(&self, args: &[&str], stdin: &str, exit: u8) -> (Output, u32) {
        let mut child = Command::new(env!("CARGO_BIN_EXE_opencode-rs"))
            .args(args)
            .env("OPENCODE_TS_BIN", self.dir.path().join("opencode"))
            .env("XDG_DATA_HOME", self.dir.path())
            .env("DELEGATE_DIR", self.dir.path())
            .env("DELEGATE_EXIT", exit.to_string())
            .env_remove("OPENCODE_PRINT_LOGS")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let pid = child.id();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(stdin.as_bytes())
            .unwrap();
        (child.wait_with_output().unwrap(), pid)
    }

    fn read(&self, name: &str) -> String {
        std::fs::read_to_string(self.dir.path().join(name)).unwrap_or_default()
    }
}

#[test]
fn every_delegated_command_gets_the_arguments_as_typed() {
    let fake = Fake::new();
    let cases: &[&[&str]] = &[
        &["upgrade", "v1.2.3", "-m", "npm"],
        &["update", "--method=brew"],
        &["uninstall", "--dry-run", "-f"],
        &[
            "serve",
            "--port",
            "4096",
            "--cors",
            "a",
            "--cors",
            "b",
            "--service",
        ],
        &["--log-level", "debug", "plugin", "list", "--builtin"],
        &["plugin", "add", "@scope/pkg@1"],
        &["plugin", "check", "pkg", "--server", "http://127.0.0.1:1"],
        &["plugin", "update"],
        &["plugin", "remove", "pkg"],
    ];
    for args in cases {
        let (output, _) = fake.run(args, "", 0);
        assert!(output.status.success(), "{args:?}: {output:?}");
        let recorded = fake.read("args");
        assert_eq!(recorded.lines().collect::<Vec<_>>(), *args);
    }
}

#[test]
fn the_child_keeps_the_process_stdio_and_exit_code() {
    let fake = Fake::new();
    let (output, pid) = fake.run(&["--print-logs", "plugin", "list"], "piped input\n", 7);
    assert_eq!(output.status.code(), Some(7));
    assert_eq!(String::from_utf8_lossy(&output.stdout), "piped input\n");
    // `--print-logs` prints this process's "cli starting" line before the TypeScript binary takes over.
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("message=\"cli starting\"") && stderr.ends_with("\nto stderr\n"),
        "{stderr}"
    );
    // On Unix the TypeScript binary replaces the process, so `serve --service` registers this pid.
    assert_eq!(fake.read("pid").trim(), pid.to_string());
    assert_eq!(fake.read("env"), "print-logs=1\n");
}

#[test]
fn usage_errors_and_bare_plugin_never_start_the_binary() {
    let fake = Fake::new();
    let (output, _) = fake.run(&["upgrade", "--method", "apt"], "", 0);
    assert_eq!(output.status.code(), Some(1));
    let (output, _) = fake.run(&["plugin"], "", 0);
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("Manage plugins"));
    assert!(!Path::new(&fake.dir.path().join("args")).exists());
}

#[test]
fn a_missing_binary_says_how_to_fix_it() {
    let data = tempfile::tempdir().unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_opencode-rs"))
        .args(["uninstall", "--dry-run"])
        .env("OPENCODE_TS_BIN", "/nonexistent/opencode")
        .env("XDG_DATA_HOME", data.path())
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        stderr.contains("Failed to start /nonexistent/opencode: No such file or directory")
            && stderr.contains("set OPENCODE_TS_BIN"),
        "{stderr}"
    );
}
