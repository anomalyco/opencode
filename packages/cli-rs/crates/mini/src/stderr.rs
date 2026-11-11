//! Stderr while the split footer is up. A `--print-logs` record or any other write to stderr would draw over the
//! footer, so each line becomes a row of the scrollback above it instead. TS mini captures only stdout
//! (`externalOutputMode: "capture-stdout"`); see `parity/deviations/O89-mini-stderr.md`.
//!
//! Only this process's writes are captured: a standalone server started before mini keeps the real stderr.

/// One line written to stderr, without its line ending. The app's message handlers receive it.
pub struct Line(pub String);

#[cfg(unix)]
pub use unix::Capture;

/// Stderr kept as it is where there is no pipe to put in its place.
#[cfg(not(unix))]
pub struct Capture;

#[cfg(not(unix))]
impl Capture {
    pub fn start(_app: &opentui::prelude::App) -> std::io::Result<Self> {
        Ok(Self)
    }

    pub fn stop(self) {}
}

#[cfg(unix)]
mod unix {
    use std::io::Write;
    use std::os::fd::{AsFd, OwnedFd};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex, Once};
    use std::thread::JoinHandle;

    use opentui::prelude::*;
    use rustix::event::{PollFd, PollFlags, Timespec, poll};

    use super::Line;

    /// The real stderr while a capture holds fd 2, for [`Capture::stop`] and the panic hook.
    static REAL: Mutex<Option<OwnedFd>> = Mutex::new(None);

    /// Puts fd 2 on a pipe until [`Capture::stop`]; a thread sends each complete line to the app as a [`Line`].
    pub struct Capture {
        stop: Arc<AtomicBool>,
        reader: JoinHandle<Vec<u8>>,
    }

    impl Capture {
        pub fn start(app: &App) -> std::io::Result<Self> {
            let (read, write) = rustix::pipe::pipe()?;
            let real = rustix::io::dup(std::io::stderr().as_fd())?;
            rustix::stdio::dup2_stderr(&write)?;
            *REAL.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(real);
            restore_on_panic();
            let stop = Arc::new(AtomicBool::new(false));
            let proxy = app.proxy();
            let reader = std::thread::Builder::new().name("opencode-mini-stderr".into()).spawn({
                let stop = stop.clone();
                move || read_lines(&read, &stop, |line| proxy.send(Line(line)).is_ok())
            })?;
            Ok(Self { stop, reader })
        }

        /// Gives stderr back and writes what the app did not show there: lines read after the app stopped, and
        /// a last line without its newline.
        pub fn stop(self) {
            restore();
            self.stop.store(true, Ordering::SeqCst);
            let rest = self.reader.join().unwrap_or_default();
            let _ = std::io::stderr().write_all(&rest);
        }
    }

    fn restore() {
        let real = REAL.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).take();
        if let Some(real) = real {
            let _ = rustix::stdio::dup2_stderr(&real);
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
                    restore();
                }
                previous(info);
            }));
        });
    }

    /// Reads `pipe` and passes each complete line to `send` until `stop` is set and nothing more is waiting. Returns
    /// the bytes `send` did not take: everything once `send` fails or `stop` is set, and an unfinished last line.
    pub(super) fn read_lines(pipe: &OwnedFd, stop: &AtomicBool, mut send: impl FnMut(String) -> bool) -> Vec<u8> {
        let mut pending = Vec::new();
        let mut sending = true;
        let mut buffer = [0u8; 4096];
        loop {
            let stopping = stop.load(Ordering::SeqCst);
            let wait = Timespec { tv_sec: 0, tv_nsec: if stopping { 0 } else { 50_000_000 } };
            let mut fds = [PollFd::new(pipe, PollFlags::IN)];
            if !matches!(poll(&mut fds, Some(&wait)), Ok(1..)) {
                if stopping {
                    return pending;
                }
                continue;
            }
            let read = match rustix::io::read(pipe, &mut buffer) {
                Ok(0) => return pending,
                Ok(read) => read,
                Err(rustix::io::Errno::INTR) => continue,
                Err(_) => return pending,
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
}

#[cfg(all(test, unix))]
mod tests {
    use std::io::Write;
    use std::sync::atomic::AtomicBool;

    #[test]
    fn complete_lines_are_sent_and_the_rest_is_kept() {
        let (read, write) = rustix::pipe::pipe().unwrap();
        let mut writer = std::fs::File::from(write);
        writer.write_all(b"level=WARN first\r\nsecond\nunfinished").unwrap();
        drop(writer);
        let mut lines = Vec::new();
        let rest = super::unix::read_lines(&read, &AtomicBool::new(false), |line| {
            lines.push(line);
            true
        });
        assert_eq!(lines, ["level=WARN first", "second"]);
        assert_eq!(rest, b"unfinished");
    }

    #[test]
    fn a_closed_app_gets_nothing_more() {
        let (read, write) = rustix::pipe::pipe().unwrap();
        let mut writer = std::fs::File::from(write);
        writer.write_all(b"one\ntwo\n").unwrap();
        drop(writer);
        let rest = super::unix::read_lines(&read, &AtomicBool::new(false), |_| false);
        assert_eq!(rest, b"one\ntwo\n");
    }
}
