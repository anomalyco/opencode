//! Delegation of commands to the TypeScript binary (D.1).
//!
//! `serve`, `upgrade`, `uninstall`, and `plugin *` depend on the server, the installer, npm, and
//! `Host.resolve`, which exist only in TypeScript (user Q4). The Rust client runs the TypeScript
//! `opencode` ([`TsCommand`]) with the same arguments, stdio, and exit code. Remote access
//! (`service set remote true`, `pair --remote`) needs the OpenTunnel SDK, so [`enable_remote`] runs the
//! TypeScript command that creates the tunnel, and [`tunnel_hostname`] reads what the SDK stored.

use std::ffi::OsString;
use std::io;
use std::path::Path;
use std::process::{Child, Command, ExitStatus};

use opencode_local::paths::Paths;

use crate::ts_command::TsCommand;

/// The TypeScript binary could not be started.
#[derive(Debug, thiserror::Error)]
#[error(
    "Failed to start {program}: {source}. Install opencode or set {var} to the TypeScript opencode binary.",
    var = TsCommand::VAR
)]
pub struct StartError {
    program: String,
    source: io::Error,
}

/// Runs `command` with `args` in place of this process and returns only when it cannot start.
///
/// On Unix the TypeScript binary replaces this process, so it keeps the pid, the terminal, signal
/// handling, and the exit status (`serve --service` registers the pid it runs as). Elsewhere this
/// process waits for the child and exits with its code.
pub fn exec(command: &TsCommand, args: impl IntoIterator<Item = OsString>) -> StartError {
    let mut process = build(command, args);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        let source = process.exec();
        start_error(command, source)
    }
    #[cfg(not(unix))]
    match process.status() {
        Ok(status) => std::process::exit(exit_code(status)),
        Err(source) => start_error(command, source),
    }
}

/// Runs the TypeScript binary from the environment with this process's arguments, as [`exec`] does:
/// a delegated command gets exactly what the user typed, global flags included.
pub fn forward() -> StartError {
    exec(&TsCommand::from_env(), std::env::args_os().skip(1))
}

/// Starts `command` with `args` as a child that shares this process's stdio. The caller waits for it, so
/// a signal can wait for the child to finish its own teardown first.
pub fn spawn(
    command: &TsCommand,
    args: impl IntoIterator<Item = OsString>,
) -> Result<Child, StartError> {
    build(command, args)
        .spawn()
        .map_err(|source| start_error(command, source))
}

/// Turns remote access on through `opencode service set remote true`: it creates the device's
/// OpenTunnel tunnel in the foreground (printing "Setting up remote access; this can take a
/// minute..." the first time), stops the service, and writes the route to the service config
/// (`packages/cli/src/services/service-config.ts:261-270`). Returns the started child; on failure it
/// prints its own error before it exits.
pub fn enable_remote(command: &TsCommand) -> Result<Child, StartError> {
    spawn(
        command,
        ["service", "set", "remote", "true"].map(OsString::from),
    )
}

/// The remote hostname of `route`, `<route>.<tunnel hostname>`, or `None` until the tunnel's
/// certificate is ready. Ports `RemoteTunnel.hostname` (`services/remote-tunnel.ts:67-71`) over the
/// SDK's XDG storage: `<XDG_DATA_HOME>/opentunnel/default/tunnel.json`, valid only with the token,
/// key, certificate, and chain beside it.
pub fn tunnel_hostname(paths: &Paths, route: &str) -> io::Result<Option<String>> {
    let data_home = paths.data.parent().unwrap_or(&paths.data);
    let root = data_home.join("opentunnel").join("default");
    let Some(metadata) = read_optional(&root.join("tunnel.json"))? else {
        return Ok(None);
    };
    for name in ["token", "private-key.pem", "certificate.pem", "chain.pem"] {
        let content = read_optional(&root.join(name))?;
        // The SDK accepts an empty chain but no empty token, key, or certificate.
        if content.is_none_or(|content| content.is_empty() && name != "chain.pem") {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Incomplete tunnel identity for default",
            ));
        }
    }
    let hostname = serde_json::from_str::<serde_json::Value>(&metadata)
        .map_err(io::Error::other)?
        .get("hostname")
        .and_then(serde_json::Value::as_str)
        .map(|hostname| format!("{route}.{hostname}"));
    Ok(hostname)
}

/// The process exit code for a child's status: its code, else `128 + signal` as a shell reports it.
pub fn exit_code(status: ExitStatus) -> i32 {
    #[cfg(unix)]
    {
        use std::os::unix::process::ExitStatusExt;
        if let Some(signal) = status.signal() {
            return 128 + signal;
        }
    }
    status.code().unwrap_or(1)
}

fn build(command: &TsCommand, args: impl IntoIterator<Item = OsString>) -> Command {
    let mut process = Command::new(&command.program);
    process.args(&command.args).args(args);
    process
}

fn start_error(command: &TsCommand, source: io::Error) -> StartError {
    StartError {
        program: command.program.to_string_lossy().into_owned(),
        source,
    }
}

fn read_optional(path: &Path) -> io::Result<Option<String>> {
    match std::fs::read_to_string(path) {
        Ok(content) => Ok(Some(content)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    fn script(dir: &Path, body: &str) -> TsCommand {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join("opencode");
        std::fs::write(&path, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        TsCommand::new(path)
    }

    #[test]
    fn the_child_gets_the_arguments_and_reports_its_exit_code() {
        let dir = tempfile::tempdir().unwrap();
        let log = dir.path().join("args");
        let command = script(
            dir.path(),
            &format!("printf '%s\\n' \"$@\" > '{}'\nexit 3", log.display()),
        );
        let status = enable_remote(&command).unwrap().wait().unwrap();
        assert_eq!(exit_code(status), 3);
        assert_eq!(
            std::fs::read_to_string(&log).unwrap(),
            "service\nset\nremote\ntrue\n"
        );
        let killed = script(dir.path(), "kill -9 $$");
        let status = spawn(&killed, []).unwrap().wait().unwrap();
        assert_eq!(exit_code(status), 128 + 9);
    }

    #[test]
    fn a_missing_binary_names_the_variable() {
        let error = spawn(&TsCommand::new("/nonexistent/opencode"), []).unwrap_err();
        assert!(
            error
                .to_string()
                .starts_with("Failed to start /nonexistent/opencode: No such file or directory"),
            "{error}"
        );
        assert!(error.to_string().ends_with(
            "Install opencode or set OPENCODE_TS_BIN to the TypeScript opencode binary."
        ));
        let error = exec(&TsCommand::new("/nonexistent/opencode"), []);
        assert!(error.to_string().starts_with("Failed to start"));
    }

    #[test]
    fn the_tunnel_hostname_needs_a_complete_identity() {
        let dir = tempfile::tempdir().unwrap();
        let paths = Paths::from_vars(|name| match name {
            "HOME" => Some(dir.path().into()),
            _ => None,
        })
        .unwrap();
        assert_eq!(tunnel_hostname(&paths, "r1").unwrap(), None);
        let root = dir.path().join(".local/share/opentunnel/default");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("tunnel.json"),
            r#"{"id":"t","hostname":"abc.opentunnel.dev","certificateExpiry":"2027-01-01T00:00:00.000Z"}"#,
        )
        .unwrap();
        let error = tunnel_hostname(&paths, "r1").unwrap_err();
        assert_eq!(error.to_string(), "Incomplete tunnel identity for default");
        for name in ["token", "private-key.pem", "certificate.pem"] {
            std::fs::write(root.join(name), "x").unwrap();
        }
        std::fs::write(root.join("chain.pem"), "").unwrap();
        assert_eq!(
            tunnel_hostname(&paths, "r1").unwrap().as_deref(),
            Some("r1.abc.opentunnel.dev")
        );
    }
}
