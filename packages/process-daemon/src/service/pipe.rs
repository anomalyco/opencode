//! Non-PTY ("pipe") processes on Unix.
//!
//! The child runs in its own process group with stdin on `/dev/null` and
//! stdout and stderr sharing one pipe, so their bytes keep their order. Three
//! choices keep the daemon safe from what the child leaves behind:
//!
//! - The waiter observes the exit with `WNOWAIT` and leaves the child as a
//!   zombie until shutdown. While the zombie exists, its PID and process group
//!   ID cannot be reused, so killing the group can never hit an unrelated
//!   process, even long after the exit.
//! - A descendant can keep the pipe open after the child exits (`cmd &`, build
//!   servers). The reader stops [`DRAIN_AFTER_EXIT`] after the exit instead of
//!   waiting for an EOF that may never come.
//! - The reader polls a cancel pipe too, so shutdown never waits on a pipe that
//!   a descendant which left the process group still holds open.

use std::io::{self, PipeReader, PipeWriter, Read};
use std::os::fd::AsFd;
use std::os::unix::process::CommandExt;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, PoisonError, RwLock};
use std::thread;
use std::time::{Duration, Instant};

use anyhow::{Context, Result};
use crossbeam_channel::{Sender, bounded};
use nix::errno::Errno;
use nix::poll::{PollFd, PollFlags, PollTimeout, poll};
use portable_pty::ChildKiller;

use super::{
    ActorMaster, ActorMessage, CreateTerminal, ProcessMode, TerminalHandle, TerminalId, new_info,
    start_actor,
};

/// How long output is still read after the child exits.
const DRAIN_AFTER_EXIT: Duration = Duration::from_secs(1);

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
    pub(super) fn spawn_pipe(
        id: TerminalId,
        order: u64,
        request: CreateTerminal,
        replay_capacity: usize,
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
        let mut command = Command::new(&request.program);
        command
            .args(&request.args)
            .current_dir(&request.cwd)
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

        let info = new_info(id, ProcessMode::Pipe, Some(process.pid), &request);
        // Nothing is ever written to a pipe process; a disconnected queue
        // turns any stray write into an error.
        let (writes, _) = bounded(1);
        let actor = match start_actor(
            id,
            ProcessMode::Pipe,
            ActorMaster { pty: None },
            writes,
            &info,
            replay_capacity,
            (0, 0),
        ) {
            Ok(actor) => actor,
            Err(error) => {
                process.kill();
                process.reap();
                return Err(error);
            }
        };

        let mut joins = vec![actor.thread];
        let reader_actor_tx = actor.actor_tx.clone();
        let started = thread::Builder::new()
            .name(format!("opencode-pty-reader-{id}"))
            .spawn(move || read_output(output, cancel, exited, reader_actor_tx))
            .context("failed to spawn terminal reader")
            .and_then(|reader| {
                joins.push(reader);
                let wait_actor_tx = actor.actor_tx.clone();
                let pid = process.pid;
                // Spawned last: the waiter must be joined before `reap`.
                thread::Builder::new()
                    .name(format!("opencode-pty-wait-{id}"))
                    .spawn(move || {
                        let message = match wait_exit(pid) {
                            Ok(Exit::Code(code)) => ActorMessage::ChildExited(Ok(Some(code))),
                            Ok(Exit::Signal(name)) => ActorMessage::ChildKilled(name),
                            Err(error) => ActorMessage::ChildExited(Err(error.to_string())),
                        };
                        let _ = wait_actor_tx.send(message);
                        // Starts the reader's drain deadline.
                        drop(exited_writer);
                    })
                    .context("failed to spawn terminal child waiter")
            });
        match started {
            Ok(waiter) => joins.push(waiter),
            Err(error) => {
                // Stop what did start, kill the child before any join can wait
                // on it, and reap only after every thread is gone.
                drop(actor.shutdown_tx);
                drop(cancel_writer);
                process.kill();
                for join in joins {
                    let _ = join.join();
                }
                process.reap();
                return Err(error);
            }
        }

        let reap = Arc::clone(&process);
        Ok(Self {
            order,
            mode: ProcessMode::Pipe,
            actor_tx: actor.actor_tx,
            actor_done: actor.actor_done,
            shutdown_tx: Mutex::new(Some(actor.shutdown_tx)),
            killer: Mutex::new(Box::new(GroupKiller(Arc::clone(&process)))),
            cancel: Mutex::new(Some(Box::new(cancel_writer))),
            reap: Mutex::new(Some(Box::new(move || reap.reap()))),
            info,
            joins: Mutex::new(Some(joins)),
        })
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
struct Process {
    pid: u32,
    reaped: Mutex<bool>,
}

impl Process {
    /// Kills the whole process group. Never signals after `reap`, when the
    /// group ID may belong to someone else.
    fn kill(&self) {
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

    /// Call only after the waiter has returned: kill the group first, so the
    /// child has exited and this does not block.
    fn reap(&self) {
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

#[derive(Debug)]
struct GroupKiller(Arc<Process>);

impl ChildKiller for GroupKiller {
    fn kill(&mut self) -> io::Result<()> {
        self.0.kill();
        Ok(())
    }

    fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
        Box::new(Self(Arc::clone(&self.0)))
    }
}

enum Exit {
    Code(u32),
    Signal(String),
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
fn read_output(
    output: PipeReader,
    cancel: PipeReader,
    exited: PipeReader,
    actor: Sender<ActorMessage>,
) {
    let mut output = output;
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
                        let _ = actor.send(ActorMessage::ReaderEof);
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
                let _ = actor.send(ActorMessage::ReaderFailed(error.to_string()));
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
                    let _ = actor.send(ActorMessage::ReaderEof);
                    return;
                }
                Ok(length) => {
                    if actor
                        .send(ActorMessage::Output(buffer[..length].to_vec()))
                        .is_err()
                    {
                        return;
                    }
                }
                Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                Err(error) => {
                    let _ = actor.send(ActorMessage::ReaderFailed(error.to_string()));
                    return;
                }
            }
        }
    }
}
