//! The root command starts in the working directory the process inherits, as TS's `process.cwd()`, and ignores
//! an inherited `PWD` that names another directory (`handlers/default.ts:21-24`).
#![cfg(unix)]

use std::process::Command;

#[test]
fn the_root_command_ignores_a_stale_pwd() {
    let home = opencode_util::temp::tempdir().unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_opencode-native"))
        .args(["--server", "http://127.0.0.1:1"])
        .current_dir(home.path())
        .env("PWD", home.path().join("missing"))
        .env("HOME", home.path())
        .env("XDG_DATA_HOME", home.path().join("data"))
        .env("XDG_CONFIG_HOME", home.path().join("config"))
        .env("XDG_STATE_HOME", home.path().join("state"))
        .env("XDG_CACHE_HOME", home.path().join("cache"))
        .env("OPENCODE_TS_BIN", "/bin/false")
        .output()
        .unwrap();
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(!stderr.contains("Failed to change directory"), "{stderr}");
}
