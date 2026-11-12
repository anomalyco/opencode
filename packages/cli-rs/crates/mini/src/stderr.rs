//! Stderr while the split footer is up. A `--print-logs` record or any other write to stderr would draw over the
//! footer, so each line becomes a row of the scrollback above it instead. TS mini captures only stdout
//! (`externalOutputMode: "capture-stdout"`); see `parity/deviations/O89-mini-stderr.md`.
//!
//! Only this process's writes are captured: a standalone server started before mini keeps the real stderr.

/// One line written to stderr, without its line ending. The app's message handlers receive it.
pub struct Line(pub String);

#[cfg(any(unix, windows))]
pub use capture::Capture;

/// Stderr kept as it is where there is no pipe to put in its place.
#[cfg(not(any(unix, windows)))]
pub struct Capture;

#[cfg(not(any(unix, windows)))]
impl Capture {
    pub fn start(_app: &opentui::prelude::App) -> std::io::Result<Self> {
        Ok(Self)
    }

    pub fn stop(self) {}
}

#[cfg(any(unix, windows))]
mod capture {
    use std::io::Write;
    use std::sync::Arc;
    use std::sync::Once;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::thread::JoinHandle;

    use opentui::prelude::*;

    use super::{Line, sys};

    /// Puts stderr on a pipe until [`Capture::stop`]; a thread sends each complete line to the app as a [`Line`].
    pub struct Capture {
        stop: Arc<AtomicBool>,
        reader: JoinHandle<Vec<u8>>,
    }

    impl Capture {
        pub fn start(app: &App) -> std::io::Result<Self> {
            let pipe = sys::redirect()?;
            restore_on_panic();
            let stop = Arc::new(AtomicBool::new(false));
            let proxy = app.proxy();
            let reader = std::thread::Builder::new().name("opencode-mini-stderr".into()).spawn({
                let stop = stop.clone();
                move || {
                    super::read_lines(
                        &stop,
                        |buffer, stopping| sys::read(&pipe, buffer, stopping),
                        |line| proxy.send(Line(line)).is_ok(),
                    )
                }
            })?;
            Ok(Self { stop, reader })
        }

        /// Gives stderr back and writes what the app did not show there: lines read after the app stopped, and
        /// a last line without its newline.
        pub fn stop(self) {
            sys::restore();
            self.stop.store(true, Ordering::SeqCst);
            let rest = self.reader.join().unwrap_or_default();
            let _ = std::io::stderr().write_all(&rest);
        }
    }

    /// A panic on the UI thread ends mini: the hooks that restore the terminal and print the panic then write to
    /// the real stderr.
    fn restore_on_panic() {
        static ONCE: Once = Once::new();
        ONCE.call_once(|| {
            let ui = std::thread::current().id();
            let previous = std::panic::take_hook();
            std::panic::set_hook(Box::new(move |info| {
                if std::thread::current().id() == ui {
                    sys::restore();
                }
                previous(info);
            }));
        });
    }
}

/// What one wait on the pipe gave.
#[cfg(any(unix, windows))]
enum Chunk {
    /// This many bytes, read into the buffer.
    Read(usize),
    /// Nothing within the wait.
    Idle,
    /// The pipe is closed or failed.
    End,
}

/// Reads with `read` and passes each complete line to `send` until `stop` is set and nothing more is waiting. Returns
/// the bytes `send` did not take: everything once `send` fails or `stop` is set, and an unfinished last line.
/// `read` takes whether the capture is stopping, and then does not wait.
#[cfg(any(unix, windows))]
fn read_lines(
    stop: &std::sync::atomic::AtomicBool,
    mut read: impl FnMut(&mut [u8], bool) -> Chunk,
    mut send: impl FnMut(String) -> bool,
) -> Vec<u8> {
    use std::sync::atomic::Ordering;
    let mut pending = Vec::new();
    let mut sending = true;
    let mut buffer = [0u8; 4096];
    loop {
        let stopping = stop.load(Ordering::SeqCst);
        let read = match read(&mut buffer, stopping) {
            Chunk::Read(read) => read,
            Chunk::Idle if !stopping => continue,
            Chunk::Idle | Chunk::End => return pending,
        };
        pending.extend_from_slice(&buffer[..read]);
        sending &= !stop.load(Ordering::SeqCst);
        while sending && let Some(end) = pending.iter().position(|byte| *byte == b'\n') {
            let line: Vec<u8> = pending.drain(..=end).collect();
            let text = String::from_utf8_lossy(&line[..end]);
            if !send(text.trim_end_matches('\r').to_owned()) {
                pending.splice(..0, line);
                sending = false;
            }
        }
    }
}

/// How long the reader waits for bytes before it checks whether the capture is stopping.
#[cfg(any(unix, windows))]
const WAIT: std::time::Duration = std::time::Duration::from_millis(50);

#[cfg(unix)]
mod sys {
    use std::os::fd::{AsFd, OwnedFd};
    use std::sync::Mutex;

    use rustix::event::{PollFd, PollFlags, Timespec, poll};

    use super::{Chunk, WAIT};

    /// The real stderr while a capture holds fd 2, for `restore` and the panic hook.
    static REAL: Mutex<Option<OwnedFd>> = Mutex::new(None);

    /// Puts fd 2 on a new pipe and returns its read end.
    pub fn redirect() -> std::io::Result<OwnedFd> {
        let (read, write) = rustix::pipe::pipe()?;
        let real = rustix::io::dup(std::io::stderr().as_fd())?;
        rustix::stdio::dup2_stderr(&write)?;
        *opencode_util::lock(&REAL) = Some(real);
        Ok(read)
    }

    pub fn restore() {
        if let Some(real) = opencode_util::lock(&REAL).take() {
            let _ = rustix::stdio::dup2_stderr(&real);
        }
    }

    pub(super) fn read(pipe: &OwnedFd, buffer: &mut [u8], stopping: bool) -> Chunk {
        let wait = Timespec { tv_sec: 0, tv_nsec: if stopping { 0 } else { WAIT.as_nanos() as _ } };
        let mut fds = [PollFd::new(pipe, PollFlags::IN)];
        if !matches!(poll(&mut fds, Some(&wait)), Ok(1..)) {
            return Chunk::Idle;
        }
        loop {
            return match rustix::io::read(pipe, &mut *buffer) {
                Ok(0) => Chunk::End,
                Ok(read) => Chunk::Read(read),
                Err(rustix::io::Errno::INTR) => continue,
                Err(_) => Chunk::End,
            };
        }
    }
}

#[cfg(windows)]
mod sys {
    use std::io::Read;
    use std::os::windows::io::AsHandle;
    use std::sync::Mutex;

    use opencode_util::win;

    use super::{Chunk, WAIT};

    /// The redirect while a capture holds the standard error, for `restore` and the panic hook.
    static REDIRECT: Mutex<Option<win::StderrRedirect>> = Mutex::new(None);

    /// Makes a new pipe the standard error and returns its read end.
    pub fn redirect() -> std::io::Result<std::fs::File> {
        let (read, write) = win::pipe()?;
        *opencode_util::lock(&REDIRECT) = Some(win::redirect_stderr(write)?);
        Ok(read.into())
    }

    /// Gives the real standard error back and closes the pipe's write end, so the reader sees the pipe end.
    pub fn restore() {
        if let Some(redirect) = opencode_util::lock(&REDIRECT).take() {
            redirect.restore();
        }
    }

    /// An anonymous pipe cannot be waited on, so the reader asks what waits and sleeps between asks.
    pub(super) fn read(mut pipe: &std::fs::File, buffer: &mut [u8], stopping: bool) -> Chunk {
        match win::pipe_available(pipe.as_handle()) {
            Err(_) => Chunk::End,
            Ok(0) => {
                if !stopping {
                    std::thread::sleep(WAIT);
                }
                Chunk::Idle
            }
            // Bytes wait, so the read returns them without blocking.
            Ok(_) => match pipe.read(buffer) {
                Ok(0) | Err(_) => Chunk::End,
                Ok(read) => Chunk::Read(read),
            },
        }
    }
}

#[cfg(all(test, any(unix, windows)))]
mod tests {
    use std::io::Write;
    use std::sync::atomic::AtomicBool;

    /// The read end of a pipe that holds `bytes` and whose write end is closed.
    #[cfg(unix)]
    fn written(bytes: &[u8]) -> std::os::fd::OwnedFd {
        let (read, write) = rustix::pipe::pipe().unwrap();
        std::fs::File::from(write).write_all(bytes).unwrap();
        read
    }

    #[cfg(windows)]
    fn written(bytes: &[u8]) -> std::fs::File {
        let (read, write) = opencode_util::win::pipe().unwrap();
        std::fs::File::from(write).write_all(bytes).unwrap();
        read.into()
    }

    fn read_pipe(bytes: &[u8], send: impl FnMut(String) -> bool) -> Vec<u8> {
        let pipe = written(bytes);
        super::read_lines(&AtomicBool::new(false), |buffer, stopping| super::sys::read(&pipe, buffer, stopping), send)
    }

    #[test]
    fn complete_lines_are_sent_and_the_rest_is_kept() {
        let mut lines = Vec::new();
        let rest = read_pipe(b"level=WARN first\r\nsecond\nunfinished", |line| {
            lines.push(line);
            true
        });
        assert_eq!(lines, ["level=WARN first", "second"]);
        assert_eq!(rest, b"unfinished");
    }

    #[test]
    fn a_closed_app_gets_nothing_more() {
        let rest = read_pipe(b"one\ntwo\n", |_| false);
        assert_eq!(rest, b"one\ntwo\n");
    }
}
