//! Runs of the client in a scratch home: an argument that is not UTF-8, a stale `PWD`, and the log file's channel.
#![cfg(unix)]

use std::ffi::OsStr;
use std::os::unix::ffi::OsStrExt;
use std::path::Path;
use std::process::Command;

/// Points `command`'s home and XDG directories into `home`.
fn scratch<'a>(command: &'a mut Command, home: &Path) -> &'a mut Command {
    command
        .env("HOME", home)
        .env("XDG_DATA_HOME", home.join("data"))
        .env("XDG_CONFIG_HOME", home.join("config"))
        .env("XDG_STATE_HOME", home.join("state"))
        .env("XDG_CACHE_HOME", home.join("cache"))
}

#[test]
fn a_command_runs_with_an_argument_that_is_not_utf8() {
    let home = opencode_util::temp::tempdir().unwrap();
    let output = scratch(Command::new(env!("CARGO_BIN_EXE_opencode-native")).args(["auth", "login"]), home.path())
        .arg(OsStr::from_bytes(b"a\xff"))
        .args(["--server", "http://127.0.0.1:1"])
        .env("OPENCODE_TS_BIN", "/bin/false")
        .env_remove("NO_COLOR")
        .env_remove("FORCE_COLOR")
        .output()
        .unwrap();
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(!stderr.contains("panicked"), "{stderr}");
    assert_eq!(output.status.code(), Some(1), "{stderr}");
}

/// The root command uses the inherited working directory even if `PWD` names another one.
#[test]
fn the_root_command_ignores_a_stale_pwd() {
    let home = opencode_util::temp::tempdir().unwrap();
    let output = scratch(
        Command::new(env!("CARGO_BIN_EXE_opencode-native")).args(["--server", "http://127.0.0.1:1"]),
        home.path(),
    )
    .current_dir(home.path())
    .env("PWD", home.path().join("missing"))
    .env("OPENCODE_TS_BIN", "/bin/false")
    .output()
    .unwrap();
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(!stderr.contains("Failed to change directory"), "{stderr}");
}

#[test]
fn the_log_file_follows_the_run_time_channel() {
    for (channel, file) in [("local", "opencode-local.log"), ("oc-x", "opencode.log")] {
        let home = opencode_util::temp::tempdir().unwrap();
        let mut command = Command::new(env!("CARGO_BIN_EXE_opencode-native"));
        command.args(["debug", "paths"]).env_clear().env("PATH", std::env::var_os("PATH").unwrap_or_default());
        let output = scratch(&mut command, home.path()).env("OPENCODE_CHANNEL", channel).output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        let log = home.path().join("data/opencode/log").join(file);
        let text = std::fs::read_to_string(&log).unwrap_or_else(|error| panic!("{}: {error}", log.display()));
        assert!(text.contains(&format!("channel={channel}")), "{text}");
    }
}
