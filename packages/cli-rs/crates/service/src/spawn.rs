//! Spawning the TypeScript `opencode` (F.9).
//!
//! Ports `spawnServiceContender` (`packages/client/src/service-contender.ts:14-55`): a detached
//! process with stdin and stdout closed and a bounded tail of its stderr, which outlives this client.

use std::ffi::OsString;
use std::io::Read;
use std::process::{Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex};

/// How much of a contender's stderr is kept (`stderrLimit`).
pub const STDERR_LIMIT: usize = 8 * 1024;

/// A started service process.
#[derive(Clone)]
pub struct Contender {
    pub pid: u32,
    state: Arc<Mutex<State>>,
}

#[derive(Default)]
struct State {
    /// Set once stderr is closed and the process has exited, like Node's `close` event.
    status: Option<ExitStatus>,
    stderr: Vec<u8>,
    released: bool,
}

impl Contender {
    /// Starts `command` (program first) with `env` added to the inherited environment. A variable
    /// with no value is removed, as `undefined` is in a Node `env`.
    pub fn spawn(
        command: &[OsString],
        env: &[(String, Option<String>)],
    ) -> std::io::Result<Self> {
        let (program, args) = command
            .split_first()
            .ok_or_else(|| std::io::Error::other("Missing service command"))?;
        let mut process = Command::new(program);
        process
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        for (name, value) in env {
            match value {
                Some(value) => process.env(name, value),
                None => process.env_remove(name),
            };
        }
        // `detached: true`: its own process group, so a terminal's Ctrl+C does not reach it.
        #[cfg(unix)]
        std::os::unix::process::CommandExt::process_group(&mut process, 0);
        let mut child = process.spawn()?;
        let mut stderr = child.stderr.take().expect("stderr is piped");
        let contender = Self {
            pid: child.id(),
            state: Arc::default(),
        };
        let state = contender.state.clone();
        // One thread drains stderr, then reaps the process. A detached thread keeps draining after
        // release, so the service never blocks on a full pipe.
        std::thread::spawn(move || {
            let mut buffer = [0; 4096];
            while let Ok(read) = stderr.read(&mut buffer) {
                if read == 0 {
                    break;
                }
                let mut state = state.lock().unwrap();
                if !state.released {
                    state.stderr.extend_from_slice(&buffer[..read]);
                    let excess = state.stderr.len().saturating_sub(STDERR_LIMIT);
                    state.stderr.drain(..excess);
                }
            }
            let status = child.wait();
            state.lock().unwrap().status = Some(status.unwrap_or_else(|_| exit_failure()));
        });
        Ok(contender)
    }

    /// The exit status, once stderr is closed and the process has exited.
    pub fn status(&self) -> Option<ExitStatus> {
        self.state.lock().unwrap().status
    }

    /// The stderr tail, trimmed.
    pub fn stderr(&self) -> String {
        String::from_utf8_lossy(&self.state.lock().unwrap().stderr)
            .trim()
            .to_owned()
    }

    /// Stops keeping stderr; it is still drained.
    pub fn release(&self) {
        let mut state = self.state.lock().unwrap();
        state.released = true;
        state.stderr = Vec::new();
    }
}

fn exit_failure() -> ExitStatus {
    #[cfg(unix)]
    return std::os::unix::process::ExitStatusExt::from_raw(1 << 8);
    #[cfg(not(unix))]
    return std::os::windows::process::ExitStatusExt::from_raw(1);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    fn sh(script: &str, env: &[(String, Option<String>)]) -> Contender {
        Contender::spawn(&["sh".into(), "-c".into(), script.into()], env).unwrap()
    }

    fn finished(contender: &Contender) -> ExitStatus {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if let Some(status) = contender.status() {
                return status;
            }
            assert!(Instant::now() < deadline, "contender did not finish");
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn keeps_a_bounded_stderr_tail_and_the_exit_code() {
        let contender = sh(
            "head -c 16384 /dev/zero | tr '\\0' x >&2; echo; echo 'actionable failure' >&2; exit 3",
            &[],
        );
        assert_eq!(finished(&contender).code(), Some(3));
        let stderr = contender.stderr();
        assert!(stderr.ends_with("actionable failure"), "{stderr}");
        assert!(stderr.len() <= STDERR_LIMIT);
    }

    #[test]
    fn adds_and_removes_environment_variables_in_its_own_group() {
        let contender = sh(
            "echo \"$OPENCODE_A-${HOME:-unset}\" >&2; ps -o pgid= -p $$ >&2",
            &[
                ("OPENCODE_A".to_owned(), Some("set".to_owned())),
                ("HOME".to_owned(), None),
            ],
        );
        assert!(finished(&contender).success());
        let stderr = contender.stderr();
        let mut lines = stderr.lines();
        assert_eq!(lines.next(), Some("set-unset"));
        assert_eq!(
            lines.next().map(str::trim),
            Some(contender.pid.to_string().as_str())
        );
    }

    #[test]
    fn a_missing_program_fails_to_spawn() {
        assert!(Contender::spawn(&["/nonexistent/opencode".into()], &[]).is_err());
        assert!(Contender::spawn(&[], &[]).is_err());
    }

    #[test]
    fn release_drops_the_tail() {
        let contender = sh("echo early >&2; sleep 0.2; echo late >&2", &[]);
        std::thread::sleep(Duration::from_millis(100));
        contender.release();
        finished(&contender);
        assert_eq!(contender.stderr(), "");
    }
}
