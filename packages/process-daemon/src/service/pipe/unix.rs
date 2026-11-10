//! Pipe processes on Unix.
//!
//! The child runs in its own process group with stdin on `/dev/null`. Three
//! choices keep the daemon safe from what the child leaves behind:
//!
//! - The waiter observes the exit with `WNOWAIT` and leaves the child as a
//!   zombie until shutdown. While the zombie exists, its PID and process group
//!   ID cannot be reused, so killing the group can never hit an unrelated
//!   process, even long after the exit.
//! - The reader polls a cancel pipe as well as the output pipe, so shutdown
//!   never waits on a pipe that a descendant which left the process group
//!   still holds open.
//! - A cancelled reader closes the pipe, so leftover writers get `SIGPIPE`
//!   once the drain deadline passes.

use std::fs::OpenOptions;
use std::io::{self, PipeReader, PipeWriter, Read};
use std::os::fd::AsFd;
use std::os::unix::fs::OpenOptionsExt;
use std::os::unix::process::CommandExt;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, PoisonError, RwLock};
use std::thread;
use std::time::Instant;

use anyhow::{Context, Result, bail};
use nix::errno::Errno;
use nix::poll::{PollFd, PollFlags, PollTimeout, poll};

use super::{DRAIN_AFTER_EXIT, Exit, OutputSink, exit_message, start_pipe};
use crate::service::{CreatePipe, ProcessSignal, TerminalHandle, TerminalId};

/// Serializes pipe creation against `spawn`. macOS has no `pipe2`, so std
/// creates a pipe and then marks it close-on-exec; a fork in between would
/// leak the pipe into another child, where it could hold output or cancel
/// pipes open. Pipes are created under the read lock, children spawned under
/// the write lock.
static SPAWN_LOCK: RwLock<()> = RwLock::new(());

struct Pipes {
    output: PipeReader,
    output_writer: PipeWriter,
    stderr: PipeWriter,
    cancel: PipeReader,
    cancel_writer: PipeWriter,
    exited: PipeReader,
    exited_writer: PipeWriter,
}

impl Pipes {
    fn new() -> Result<Self> {
        let _guard = SPAWN_LOCK.read().unwrap_or_else(PoisonError::into_inner);
        let (output, output_writer) = io::pipe().context("failed to create output pipe")?;
        let stderr = output_writer
            .try_clone()
            .context("failed to share output pipe")?;
        let (cancel, cancel_writer) = io::pipe().context("failed to create cancel pipe")?;
        let (exited, exited_writer) = io::pipe().context("failed to create exit pipe")?;
        Ok(Self {
            output,
            output_writer,
            stderr,
            cancel,
            cancel_writer,
            exited,
            exited_writer,
        })
    }
}

impl TerminalHandle {
    pub(in crate::service) fn spawn_pipe(
        id: TerminalId,
        order: u64,
        request: CreatePipe,
    ) -> Result<Self> {
        let Pipes {
            output,
            output_writer,
            stderr,
            cancel,
            cancel_writer,
            exited,
            exited_writer,
        } = Pipes::new()?;
        // Before spawning, so a bad path fails the request with nothing to clean up.
        // The reader is the file's only writer, so it needs no append mode.
        let sink = OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            // Never write through a symlink planted at the final component.
            .custom_flags(libc::O_NOFOLLOW)
            .open(&request.output_path)
            .with_context(|| {
                format!(
                    "failed to open output file {}",
                    request.output_path.display()
                )
            })?;
        let mut command = Command::new(&request.program);
        command
            .args(&request.args)
            .current_dir(&request.cwd)
            .env_clear()
            .envs(&request.env)
            .stdin(Stdio::null())
            .stdout(output_writer)
            .stderr(stderr)
            .process_group(0);
        // SAFETY: only async-signal-safe calls run between fork and exec.
        unsafe {
            command.pre_exec(reset_signals);
        }
        let child = {
            let _guard = SPAWN_LOCK.write().unwrap_or_else(PoisonError::into_inner);
            command
                .spawn()
                .with_context(|| format!("failed to spawn {}", request.program))?
        };
        // Close the daemon's copies of the write end, or EOF never arrives.
        drop(command);
        let process = Arc::new(Process {
            pid: child.id(),
            reaped: Mutex::new(false),
        });
        // Dropping `Child` neither waits nor kills; `Process` reaps it.
        drop(child);

        let reader_id = id;
        let waiter_id = id;
        start_pipe(
            id,
            order,
            request,
            Arc::clone(&process),
            sink,
            Box::new(cancel_writer),
            super::Threads {
                reader: Box::new(move |sink| {
                    thread::Builder::new()
                        .name(format!("opencode-pty-reader-{reader_id}"))
                        .spawn(move || read_output(output, sink, cancel, exited))
                }),
                waiter: Box::new(move |actor| {
                    let pid = process.pid;
                    // Spawned last: the waiter must be joined before `reap`.
                    thread::Builder::new()
                        .name(format!("opencode-pty-wait-{waiter_id}"))
                        .spawn(move || {
                            let _ = actor.send(exit_message(wait_exit(pid)));
                            // Starts the reader's drain deadline.
                            drop(exited_writer);
                        })
                }),
            },
        )
    }
}

/// Runs in the child between fork and exec. The daemon blocks SIGTERM and
/// SIGINT on all its threads, and std keeps the signal mask across exec, so
/// clear it, and give every signal portable-pty also resets its default action.
fn reset_signals() -> io::Result<()> {
    // SAFETY: sigemptyset, sigprocmask and signal are async-signal-safe.
    unsafe {
        // Dispositions first, so no inherited handler can run once unmasked.
        for signal in [
            libc::SIGCHLD,
            libc::SIGHUP,
            libc::SIGINT,
            libc::SIGQUIT,
            libc::SIGTERM,
            libc::SIGALRM,
        ] {
            libc::signal(signal, libc::SIG_DFL);
        }
        let mut empty: libc::sigset_t = std::mem::zeroed();
        if libc::sigemptyset(&mut empty) != 0
            || libc::sigprocmask(libc::SIG_SETMASK, &empty, std::ptr::null_mut()) != 0
        {
            return Err(io::Error::last_os_error());
        }
    }
    Ok(())
}

/// A pipe child that stays a zombie after it exits, until `reap`.
#[derive(Debug)]
pub(in crate::service) struct Process {
    pid: u32,
    reaped: Mutex<bool>,
}

impl Process {
    pub(super) fn pid(&self) -> u32 {
        self.pid
    }

    /// Kills the whole process group. Never signals after `reap`, when the
    /// group ID may belong to someone else.
    pub(super) fn kill(&self) {
        let reaped = self.reaped.lock().unwrap_or_else(PoisonError::into_inner);
        if !*reaped && let Ok(pid) = i32::try_from(self.pid) {
            // SAFETY: the unreaped child keeps its PID and group ID reserved.
            // Signal the child directly too, in case it moved to another group.
            unsafe {
                libc::killpg(pid, libc::SIGKILL);
                libc::kill(pid, libc::SIGKILL);
            }
        }
    }

    /// Sends `signal` to the process group and the child. Allowed after the
    /// exit, to reach what is left of the group; refused after `reap`.
    pub(in crate::service) fn signal(&self, signal: ProcessSignal) -> Result<()> {
        let signal = match signal {
            ProcessSignal::Term => libc::SIGTERM,
            ProcessSignal::Int => libc::SIGINT,
            ProcessSignal::Kill => libc::SIGKILL,
        };
        let reaped = self.reaped.lock().unwrap_or_else(PoisonError::into_inner);
        if *reaped {
            bail!("process has been reaped");
        }
        let pid = i32::try_from(self.pid).context("invalid pid")?;
        // SAFETY: the unreaped child keeps its PID and group ID reserved.
        check_signal(unsafe { libc::killpg(pid, signal) }, self.pid)?;
        // Signal the child directly too, in case it moved to another group.
        // SAFETY: as above.
        check_signal(unsafe { libc::kill(pid, signal) }, self.pid)
    }

    /// Call only after the waiter has returned: kill the group first, so the
    /// child has exited and this does not block.
    pub(super) fn reap(&self) {
        let mut reaped = self.reaped.lock().unwrap_or_else(PoisonError::into_inner);
        if *reaped {
            return;
        }
        let Ok(pid) = i32::try_from(self.pid) else {
            return;
        };
        loop {
            // SAFETY: waits only for this daemon's own child.
            let result = unsafe { libc::waitpid(pid, std::ptr::null_mut(), 0) };
            if result != -1 || Errno::last() != Errno::EINTR {
                break;
            }
        }
        *reaped = true;
    }
}

/// Reads errno right after a `kill`/`killpg` result. A zombie group with no
/// live members gives ESRCH on macOS, which is not an error here.
/// Signalling an exited child whose group is empty fails with `ESRCH`, or
/// with `EPERM` on macOS (the zombie is still there); neither is an error.
fn check_signal(result: libc::c_int, pid: u32) -> Result<()> {
    if result == -1 {
        let errno = Errno::last();
        if errno != Errno::ESRCH && !(errno == Errno::EPERM && has_exited(pid)) {
            return Err(io::Error::from(errno)).context("failed to signal process");
        }
    }
    Ok(())
}

/// Whether the child has exited, without reaping it.
fn has_exited(pid: u32) -> bool {
    // SAFETY: siginfo_t is plain data, and all-zero is a valid value.
    let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
    // SAFETY: `info` is a valid out pointer; WNOWAIT leaves the zombie.
    let result = unsafe {
        libc::waitid(
            libc::P_PID,
            pid as libc::id_t,
            &mut info,
            libc::WEXITED | libc::WNOWAIT | libc::WNOHANG,
        )
    };
    // SAFETY: waitid filled `info`; a zero PID means the child is still running.
    result == 0 && unsafe { info.si_pid() } != 0
}

/// Waits for the child to exit without reaping it.
fn wait_exit(pid: u32) -> io::Result<Exit> {
    loop {
        // SAFETY: siginfo_t is plain data, and all-zero is a valid value.
        let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
        // SAFETY: `info` is a valid out pointer; WNOWAIT leaves the zombie.
        let result = unsafe {
            libc::waitid(
                libc::P_PID,
                pid as libc::id_t,
                &mut info,
                libc::WEXITED | libc::WNOWAIT,
            )
        };
        if result == -1 {
            let error = io::Error::last_os_error();
            if error.kind() == io::ErrorKind::Interrupted {
                continue;
            }
            return Err(error);
        }
        // SAFETY: waitid filled `info` for a SIGCHLD event.
        let status = unsafe { info.si_status() };
        return Ok(match info.si_code {
            libc::CLD_EXITED => Exit::Code(status as u32),
            _ => Exit::Signal(signal_name(status)),
        });
    }
}

fn signal_name(signal: i32) -> String {
    let name = match signal {
        libc::SIGHUP => "SIGHUP",
        libc::SIGINT => "SIGINT",
        libc::SIGQUIT => "SIGQUIT",
        libc::SIGILL => "SIGILL",
        libc::SIGTRAP => "SIGTRAP",
        libc::SIGABRT => "SIGABRT",
        libc::SIGBUS => "SIGBUS",
        libc::SIGFPE => "SIGFPE",
        libc::SIGKILL => "SIGKILL",
        libc::SIGUSR1 => "SIGUSR1",
        libc::SIGSEGV => "SIGSEGV",
        libc::SIGUSR2 => "SIGUSR2",
        libc::SIGPIPE => "SIGPIPE",
        libc::SIGALRM => "SIGALRM",
        libc::SIGTERM => "SIGTERM",
        libc::SIGXCPU => "SIGXCPU",
        libc::SIGXFSZ => "SIGXFSZ",
        libc::SIGVTALRM => "SIGVTALRM",
        libc::SIGPROF => "SIGPROF",
        libc::SIGSYS => "SIGSYS",
        _ => return format!("SIG{signal}"),
    };
    name.to_string()
}

/// Forwards output until EOF, until [`DRAIN_AFTER_EXIT`] after `exited`
/// closes, or until `cancel` closes. Once every writer has closed the output
/// pipe, what is left is finite, so it is read to the end regardless of the
/// deadline.
fn read_output(output: PipeReader, sink: OutputSink, cancel: PipeReader, exited: PipeReader) {
    let mut output = output;
    let mut sink = sink;
    let mut buffer = [0_u8; 8192];
    let mut deadline = None::<Instant>;
    let mut writers_closed = false;
    loop {
        let timeout = match deadline {
            Some(deadline) if !writers_closed => {
                let left = deadline.saturating_duration_since(Instant::now());
                if left.is_zero() {
                    // The reader may have been stalled past the deadline; take
                    // one last look before giving up on a held-open pipe.
                    let mut fds = [PollFd::new(output.as_fd(), PollFlags::POLLIN)];
                    let hung_up = poll(&mut fds, PollTimeout::ZERO).is_ok_and(|count| count > 0)
                        && fds[0]
                            .revents()
                            .is_some_and(|events| events.contains(PollFlags::POLLHUP));
                    if !hung_up {
                        sink.eof();
                        return;
                    }
                    writers_closed = true;
                    PollTimeout::NONE
                } else {
                    // Round up: a sub-millisecond remainder must not become a busy 0.
                    let millis = left.as_nanos().div_ceil(1_000_000).min(i32::MAX as u128);
                    PollTimeout::try_from(millis).unwrap_or(PollTimeout::MAX)
                }
            }
            _ => PollTimeout::NONE,
        };
        let mut fds = [
            PollFd::new(output.as_fd(), PollFlags::POLLIN),
            PollFd::new(cancel.as_fd(), PollFlags::POLLIN),
            PollFd::new(exited.as_fd(), PollFlags::POLLIN),
        ];
        // Once the exit is seen, stop polling its closed pipe.
        let count = if deadline.is_some() { 2 } else { 3 };
        match poll(&mut fds[..count], timeout) {
            Err(Errno::EINTR) | Ok(0) => continue,
            Err(error) => {
                sink.failed(error.to_string());
                return;
            }
            Ok(_) => {}
        }
        let ready = |fd: &PollFd| {
            fd.revents().is_none_or(|events| {
                events.intersects(
                    PollFlags::POLLIN
                        | PollFlags::POLLHUP
                        | PollFlags::POLLERR
                        | PollFlags::POLLNVAL,
                )
            })
        };
        if ready(&fds[1]) {
            return;
        }
        if count == 3 && ready(&fds[2]) {
            deadline = Some(Instant::now() + DRAIN_AFTER_EXIT);
        }
        if fds[0]
            .revents()
            .is_some_and(|events| events.contains(PollFlags::POLLHUP))
        {
            writers_closed = true;
        }
        if ready(&fds[0]) {
            match output.read(&mut buffer) {
                Ok(0) => {
                    sink.eof();
                    return;
                }
                Ok(length) => {
                    if !sink.write(&buffer[..length]) {
                        return;
                    }
                }
                Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                Err(error) => {
                    sink.failed(error.to_string());
                    return;
                }
            }
        }
    }
}
