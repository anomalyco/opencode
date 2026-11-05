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
//! - The reader writes every byte to the output file before handing it to the
//!   actor, which keeps no replay buffer: the file is the only copy of the
//!   output. Leftover writers get `SIGPIPE` once the reader stops.
//! - The reader polls a cancel pipe too, so shutdown never waits on a pipe that
//!   a descendant which left the process group still holds open.

use std::fs::{File, OpenOptions};
use std::io::{self, PipeReader, PipeWriter, Read, Write};
use std::os::fd::AsFd;
use std::os::unix::fs::OpenOptionsExt;
use std::os::unix::process::CommandExt;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, PoisonError, RwLock};
use std::thread;
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use crossbeam_channel::{Sender, bounded};
use nix::errno::Errno;
use nix::poll::{PollFd, PollFlags, PollTimeout, poll};
use portable_pty::ChildKiller;

use super::{
    ActorMaster, ActorMessage, CreatePipe, PipeInfo, ProcessInfo, ProcessMode, ProcessSignal,
    TerminalHandle, TerminalId, new_info, start_actor,
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
    pub(super) fn spawn_pipe(id: TerminalId, order: u64, request: CreatePipe) -> Result<Self> {
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

        let info = Arc::new(RwLock::new(ProcessInfo {
            pipe: Some(PipeInfo {
                output_path: request.output_path.clone(),
                output_lines: 0,
                output_error: None,
                metadata: request.metadata,
            }),
            ..new_info(
                id,
                ProcessMode::Pipe,
                Some(process.pid),
                &request.program,
                &request.args,
                &request.cwd,
                &request.group_id,
            )
        }));
        // Nothing is ever written to a pipe process; a disconnected queue
        // turns any stray write into an error.
        let (writes, _) = bounded(1);
        let actor = match start_actor(
            id,
            ProcessMode::Pipe,
            ActorMaster { pty: None },
            writes,
            &info,
            // The output file is the only buffer.
            0,
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
            .spawn(move || read_output(output, sink, cancel, exited, reader_actor_tx))
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
            process: Some(process),
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
pub(super) struct Process {
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

    /// Sends `signal` to the process group and the child. Allowed after the
    /// exit, to reach what is left of the group; refused after `reap`.
    pub(super) fn signal(&self, signal: ProcessSignal) -> Result<()> {
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
        check_signal(unsafe { libc::killpg(pid, signal) })?;
        // Signal the child directly too, in case it moved to another group.
        // SAFETY: as above.
        check_signal(unsafe { libc::kill(pid, signal) })
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

/// Reads errno right after a `kill`/`killpg` result. A zombie group with no
/// live members gives ESRCH on macOS, which is not an error here.
fn check_signal(result: libc::c_int) -> Result<()> {
    if result == -1 {
        let errno = Errno::last();
        if errno != Errno::ESRCH {
            return Err(io::Error::from(errno)).context("failed to signal process");
        }
    }
    Ok(())
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
    sink: File,
    cancel: PipeReader,
    exited: PipeReader,
    actor: Sender<ActorMessage>,
) {
    let mut output = output;
    // Dropped after a write error: the rest is forwarded but not counted.
    let mut sink = Some(sink);
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
                        // Close the file before anyone can observe the exit.
                        drop(sink);
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
                // Close the file before anyone can observe the exit.
                drop(sink);
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
                    // Close the file before anyone can observe the exit.
                    drop(sink);
                    let _ = actor.send(ActorMessage::ReaderEof);
                    return;
                }
                Ok(length) => {
                    // The file first, so it always holds at least what
                    // subscribers have seen, even if the actor is backpressured.
                    let mut newlines = 0;
                    if let Some(file) = &mut sink
                        && let Err(error) =
                            write_counting(&mut *file, &buffer[..length], &mut newlines)
                    {
                        // Ordered before this chunk's output, so the error is
                        // visible no later than the bytes the file lacks.
                        sink = None;
                        if actor
                            .send(ActorMessage::OutputFileFailed(format!(
                                "failed to write output file: {error}"
                            )))
                            .is_err()
                        {
                            return;
                        }
                    }
                    if actor
                        .send(ActorMessage::Output {
                            bytes: buffer[..length].to_vec(),
                            newlines,
                        })
                        .is_err()
                    {
                        return;
                    }
                }
                Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                Err(error) => {
                    drop(sink);
                    let _ = actor.send(ActorMessage::ReaderFailed(error.to_string()));
                    return;
                }
            }
        }
    }
}

/// Writes all of `bytes`, adding to `newlines` the `\n` bytes that reached
/// the file, including those of a partial write before an error.
fn write_counting(mut file: impl Write, bytes: &[u8], newlines: &mut u64) -> io::Result<()> {
    let mut rest = bytes;
    while !rest.is_empty() {
        match file.write(rest) {
            Ok(0) => return Err(io::ErrorKind::WriteZero.into()),
            Ok(written) => {
                *newlines += rest[..written]
                    .iter()
                    .filter(|&&byte| byte == b'\n')
                    .count() as u64;
                rest = &rest[written..];
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Accepts `accept` bytes in small writes, then fails.
    struct FailingWriter {
        accept: usize,
        written: Vec<u8>,
    }

    impl Write for FailingWriter {
        fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
            let room = self.accept - self.written.len();
            if room == 0 {
                return Err(io::Error::from_raw_os_error(libc::ENOSPC));
            }
            let length = bytes.len().min(room).min(3);
            self.written.extend_from_slice(&bytes[..length]);
            Ok(length)
        }

        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    #[test]
    fn a_partial_write_counts_only_the_newlines_written() {
        let mut writer = FailingWriter {
            accept: 7,
            written: Vec::new(),
        };
        let mut newlines = 0;
        let error = write_counting(&mut writer, b"a\nb\nc\nd\ne\n", &mut newlines).unwrap_err();
        assert_eq!(error.raw_os_error(), Some(libc::ENOSPC));
        assert_eq!(writer.written, b"a\nb\nc\nd");
        assert_eq!(newlines, 3);

        let mut writer = FailingWriter {
            accept: 100,
            written: Vec::new(),
        };
        let mut newlines = 1;
        write_counting(&mut writer, b"x\ny\n", &mut newlines).unwrap();
        assert_eq!(newlines, 3);
    }
}
