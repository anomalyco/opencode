//! The log follows the run-time channel the service and database use (plan 6.6): `local` logs to
//! `opencode-local.log`, and a client of another channel shares `opencode.log` with a released TS client.
#![cfg(unix)]

use std::process::Command;

#[test]
fn the_log_file_follows_the_run_time_channel() {
    for (channel, file) in [("local", "opencode-local.log"), ("oc-x", "opencode.log")] {
        let home = opencode_util::temp::tempdir().unwrap();
        let output = Command::new(env!("CARGO_BIN_EXE_opencode-native"))
            .args(["debug", "paths"])
            .env_clear()
            .env("PATH", std::env::var_os("PATH").unwrap_or_default())
            .env("HOME", home.path())
            .env("XDG_DATA_HOME", home.path().join("data"))
            .env("XDG_CONFIG_HOME", home.path().join("config"))
            .env("XDG_STATE_HOME", home.path().join("state"))
            .env("XDG_CACHE_HOME", home.path().join("cache"))
            .env("OPENCODE_CHANNEL", channel)
            .output()
            .unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        let log = home.path().join("data/opencode/log").join(file);
        let text = std::fs::read_to_string(&log).unwrap_or_else(|error| panic!("{}: {error}", log.display()));
        assert!(text.contains(&format!("channel={channel}")), "{text}");
    }
}
