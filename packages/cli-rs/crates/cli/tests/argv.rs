//! Arguments that are not UTF-8: Bun decodes them with U+FFFD, and the Rust client does the same once, so no
//! command reads the raw arguments again and panics on them.
#![cfg(unix)]

use std::ffi::OsStr;
use std::os::unix::ffi::OsStrExt;
use std::process::Command;

#[test]
fn a_command_runs_with_an_argument_that_is_not_utf8() {
    let home = opencode_util::temp::tempdir().unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_opencode-rs"))
        .args(["auth", "login"])
        .arg(OsStr::from_bytes(b"a\xff"))
        .args(["--server", "http://127.0.0.1:1"])
        .env("HOME", home.path())
        .env("XDG_DATA_HOME", home.path().join("data"))
        .env("XDG_CONFIG_HOME", home.path().join("config"))
        .env("XDG_STATE_HOME", home.path().join("state"))
        .env("XDG_CACHE_HOME", home.path().join("cache"))
        .env("OPENCODE_TS_BIN", "/bin/false")
        .env_remove("NO_COLOR")
        .env_remove("FORCE_COLOR")
        .output()
        .unwrap();
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(!stderr.contains("panicked"), "{stderr}");
    assert_eq!(output.status.code(), Some(1), "{stderr}");
}
