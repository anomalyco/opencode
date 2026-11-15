//! Non-PTY ("pipe") processes: a command with no terminal, stdin closed and
//! stdout and stderr sharing one pipe so their bytes keep their order.
//!
//! The platform modules own the child, its process tree and the output pipe:
//! Unix keeps a zombie so the PID and process group stay reserved, and Windows
//! keeps the process and its kill-on-close job. Everything the two must do the
//! same way lives here:
//!
//! - The reader writes every byte to the output file before handing it to the
//!   actor, which keeps no replay buffer: the file is the only copy of the
//!   output.
//! - A descendant can keep the pipe open after the child exits (`cmd &`, build
//!   servers). The reader stops [`DRAIN_AFTER_EXIT`] after the exit instead of
//!   waiting for an EOF that may never come.
//! - The file is closed before `ReaderEof` or `ReaderFailed`, so whoever
//!   observes the exit can read everything the file will ever get.
//! - A process the daemon terminated is reported as the signal the daemon sent
//!   (`SIGTERM`, `SIGINT`, `SIGKILL`) with no exit code, not as the platform's
//!   hard-kill status, so clients format it like a Unix signal death.

use std::fs::File;
use std::io::{self, Write};
use std::sync::{Arc, Mutex, RwLock};
use std::thread::{self, JoinHandle};
use std::time::Duration;

use anyhow::{Context, Result};
use crossbeam_channel::{Sender, bounded};
use portable_pty::ChildKiller;

use crate::service::{
    ActorMaster, ActorMessage, ActorStart, CreatePipe, PipeInfo, ProcessInfo, ProcessMode,
    TerminalHandle, TerminalId, new_info, start_actor,
};

#[cfg(unix)]
mod unix;
#[cfg(windows)]
mod windows;

#[cfg(unix)]
pub(in crate::service) use unix::Process;
#[cfg(windows)]
pub(in crate::service) use windows::Process;

/// How long output is still read after the child exits.
const DRAIN_AFTER_EXIT: Duration = Duration::from_secs(1);

/// The output file and the actor queue, in the order every byte goes through
/// them: the file first, so it always holds at least what subscribers have
/// seen, even when the actor is backpressured.
struct OutputSink {
    file: Option<File>,
    actor: Sender<ActorMessage>,
}

impl OutputSink {
    fn new(file: File, actor: Sender<ActorMessage>) -> Self {
        Self {
            file: Some(file),
            actor,
        }
    }

    /// Returns false once the actor is gone.
    fn write(&mut self, bytes: &[u8]) -> bool {
        let mut newlines = 0;
        if let Some(file) = &mut self.file
            && let Err(error) = write_counting(file, bytes, &mut newlines)
        {
            // Ordered before this chunk's output, so the error is visible no
            // later than the bytes the file lacks.
            self.file = None;
            if self
                .actor
                .send(ActorMessage::OutputFileFailed(format!(
                    "failed to write output file: {error}"
                )))
                .is_err()
            {
                return false;
            }
        }
        self.actor
            .send(ActorMessage::Output {
                bytes: bytes.to_vec(),
                newlines,
            })
            .is_ok()
    }

    /// Closes the file before anyone can observe the exit.
    fn eof(mut self) {
        self.file = None;
        let _ = self.actor.send(ActorMessage::ReaderEof);
    }

    /// Closes the file before anyone can observe the failure.
    fn failed(mut self, message: String) {
        self.file = None;
        let _ = self.actor.send(ActorMessage::ReaderFailed(message));
    }
}

/// How a pipe child ended.
enum Exit {
    Code(u32),
    /// The daemon terminated the process; the value is the signal it sent.
    Signal(String),
}

/// The one place a pipe exit becomes an actor message, so both platforms
/// report exits and signals the same way.
fn exit_message(result: io::Result<Exit>) -> ActorMessage {
    match result {
        Ok(Exit::Code(code)) => ActorMessage::ChildExited(Ok(Some(code))),
        Ok(Exit::Signal(name)) => ActorMessage::ChildKilled(name),
        Err(error) => ActorMessage::ChildExited(Err(error.to_string())),
    }
}

/// Info for a pipe process: exactly one `pipe` group, never a `pty`.
fn new_pipe_info(id: TerminalId, pid: u32, request: CreatePipe) -> ProcessInfo {
    let CreatePipe {
        program,
        args,
        cwd,
        env: _,
        group_id,
        output_path,
        metadata,
    } = request;
    ProcessInfo {
        pipe: Some(PipeInfo {
            output_path,
            output_lines: 0,
            output_error: None,
            metadata,
        }),
        ..new_info(
            id,
            ProcessMode::Pipe,
            Some(pid),
            &program,
            &args,
            &cwd,
            &group_id,
        )
    }
}

/// The waiter's result, and something dropped only after the exit message is
/// sent (Unix starts the reader's drain by dropping a pipe writer).
struct Waiter {
    exit: io::Result<Exit>,
    after: Box<dyn Send>,
}

/// Registers a spawned pipe process with its actor, then runs the platform's
/// reader and waiter. Both are started in that order, and the waiter last, so
/// it is joined before the process is reaped.
fn start_pipe(
    id: TerminalId,
    order: u64,
    request: CreatePipe,
    process: Arc<Process>,
    cancel: Box<dyn Send>,
    reader: impl FnOnce(Sender<ActorMessage>) + Send + 'static,
    waiter: impl FnOnce() -> Waiter + Send + 'static,
) -> Result<TerminalHandle> {
    let info = Arc::new(RwLock::new(new_pipe_info(id, process.pid(), request)));
    // Nothing is ever written to a pipe process; a disconnected queue
    // turns any stray write into an error.
    let (writes, _) = bounded(1);
    let actor = match start_actor(
        id,
        ProcessMode::Pipe,
        ActorMaster::pipe(),
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
    let ActorStart {
        actor_tx,
        actor_done,
        shutdown_tx,
        shutdown: _,
        thread,
    } = actor;
    let mut joins = vec![thread];
    let reader_actor_tx = actor_tx.clone();
    let reader = thread::Builder::new()
        .name(format!("opencode-pty-reader-{id}"))
        .spawn(move || reader(reader_actor_tx))
        .context("failed to spawn terminal reader");
    let reader = match reader {
        Ok(reader) => reader,
        Err(error) => {
            stop(shutdown_tx, cancel, &process, joins);
            return Err(error);
        }
    };
    joins.push(reader);
    let wait_actor_tx = actor_tx.clone();
    let waiter = thread::Builder::new()
        .name(format!("opencode-pty-wait-{id}"))
        .spawn(move || {
            let Waiter { exit, after } = waiter();
            let _ = wait_actor_tx.send(exit_message(exit));
            drop(after);
        })
        .context("failed to spawn terminal child waiter");
    let waiter = match waiter {
        Ok(waiter) => waiter,
        Err(error) => {
            stop(shutdown_tx, cancel, &process, joins);
            return Err(error);
        }
    };
    joins.push(waiter);
    let reap = Arc::clone(&process);
    Ok(TerminalHandle {
        order,
        mode: ProcessMode::Pipe,
        actor_tx,
        actor_done,
        shutdown_tx: Mutex::new(Some(shutdown_tx)),
        killer: Mutex::new(Box::new(ProcessKiller(Arc::clone(&process)))),
        cancel: Mutex::new(Some(cancel)),
        reap: Mutex::new(Some(Box::new(move || reap.reap()))),
        process: Some(process),
        info,
        joins: Mutex::new(Some(joins)),
    })
}

/// Stops a partially started pipe process: kill the child before any join can
/// wait on it, and reap only after every thread is gone.
fn stop(
    shutdown_tx: Sender<()>,
    cancel: Box<dyn Send>,
    process: &Process,
    joins: Vec<JoinHandle<()>>,
) {
    drop(shutdown_tx);
    drop(cancel);
    process.kill();
    for join in joins {
        let _ = join.join();
    }
    process.reap();
}

/// `ChildKiller` for service shutdown, which uses the same kill path as
/// `terminate`.
#[derive(Debug)]
struct ProcessKiller(Arc<Process>);

impl ChildKiller for ProcessKiller {
    fn kill(&mut self) -> io::Result<()> {
        self.0.kill();
        Ok(())
    }

    fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
        Box::new(Self(Arc::clone(&self.0)))
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
                return Err(io::Error::new(io::ErrorKind::StorageFull, "no space"));
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
        assert_eq!(error.kind(), io::ErrorKind::StorageFull);
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
