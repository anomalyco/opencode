//! The prompt terminal on Windows: console modes as libuv's raw mode sets them, except that the console turns keys
//! into the escape sequences a Unix terminal sends (virtual terminal input) where libuv translates them itself; sizes
//! from OpenTUI's console; and waits on the console input handle. Stdin that is not a console, a pipe or a file, is
//! read on a thread of its own, because a pipe cannot be waited on with a timeout.

use std::io::Read as _;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Mutex, MutexGuard, OnceLock, PoisonError};
use std::time::Duration;

use opencode_util::win;

use super::{Output, Read};

/// Stdin, whose handle std looks up on each use, so a stdin moved to `CONIN$` is seen.
fn stdin() -> std::io::Stdin {
    std::io::stdin()
}

/// The console mode of `output`, or `None` when it is not a console.
fn output_mode(output: Output) -> Option<u32> {
    match output {
        Output::Stdout => win::console_mode(std::io::stdout()),
        Output::Stderr => win::console_mode(std::io::stderr()),
    }
}

/// Both ends are consoles, as `requireInteractive` in `packages/cli/src/ui/prompt.ts` checks. Node calls a handle a
/// TTY when it has a console mode, so a mintty pipe is not one, though std's `is_terminal` says it is.
pub fn interactive() -> bool {
    win::console_mode(stdin()).is_some() && Output::Stdout.is_terminal()
}

/// `process.stdout.columns`: unset when stdout is not a console.
pub fn columns() -> Option<usize> {
    Output::Stdout.is_terminal().then(|| opentui::term::size().ok()).flatten().map(|size| usize::from(size.0))
}

/// `process.stdout.rows`: unset when stdout is not a console.
pub fn stdout_rows() -> Option<usize> {
    Output::Stdout.is_terminal().then(|| opentui::term::size().ok()).flatten().map(|size| usize::from(size.1))
}

/// The rows of the prompt's output console, or 10 when it is not one (`limitOptions`).
pub fn rows(output: Output) -> usize {
    output.is_terminal().then(|| opentui::term::size().ok()).flatten().map_or(10, |size| usize::from(size.1))
}

impl Output {
    pub(in crate::prompt) fn is_terminal(self) -> bool {
        output_mode(self).is_some()
    }
}

/// Turns on escape sequences on `output` once, when it is a console, as libuv does when Node opens a console stream.
/// Like libuv, nothing turns them off again.
pub(super) fn vt_output(output: Output) {
    static DONE: [AtomicBool; 2] = [AtomicBool::new(false), AtomicBool::new(false)];
    if DONE[output as usize].swap(true, Ordering::Relaxed) {
        return;
    }
    let _ = match (output, output_mode(output)) {
        (_, None) => return,
        (Output::Stdout, Some(mode)) => win::set_console_mode(std::io::stdout(), win::vt_output_mode(mode)),
        (Output::Stderr, Some(mode)) => win::set_console_mode(std::io::stderr(), win::vt_output_mode(mode)),
    };
}

/// Raw mode on stdin while alive, when stdin is a console: keys arrive as escape sequences, one at a time, without
/// echo, and Ctrl+C arrives as a key. Output keeps its carriage return on `\n`.
pub struct Raw {
    saved: Option<(u64, u32)>,
}

/// The input modes saved by each live [`Raw`], oldest first, with the output it draws on, so [`restore`] can put the
/// console back from a control handler's thread while a prompt still holds raw mode.
type Active = Vec<(u64, u32, Output)>;

static ACTIVE: Mutex<Active> = Mutex::new(Vec::new());

fn active() -> MutexGuard<'static, Active> {
    ACTIVE.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Raw {
    pub fn enable(output: Output) -> Raw {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let saved = win::console_mode(stdin()).map(|saved| (NEXT.fetch_add(1, Ordering::Relaxed), saved));
        if let Some((id, saved)) = saved {
            vt_output(output);
            active().push((id, saved, output));
            let _ = win::set_console_mode(stdin(), win::raw_input_mode(saved));
        }
        Raw { saved }
    }
}

impl Drop for Raw {
    fn drop(&mut self) {
        if let Some((id, saved)) = self.saved {
            active().retain(|(other, _, _)| *other != id);
            let _ = win::set_console_mode(stdin(), saved);
        }
    }
}

/// Puts the console back as it was before the first live prompt took raw mode, and shows the cursor that prompts
/// hide on each output they draw on that is a console. A shutdown step: the process exits right after, without
/// running the prompt's own drop. Does nothing while no prompt holds raw mode.
pub fn restore() {
    let active = active();
    let Some((_, saved, _)) = active.first() else { return };
    let _ = win::set_console_mode(stdin(), *saved);
    for output in [Output::Stdout, Output::Stderr] {
        if active.iter().any(|entry| entry.2 == output) && output.is_terminal() {
            output.write("\x1b[?25h");
        }
    }
}

/// Waits up to `wait` (forever with `None`) for input, then reads it into `buffer`. Console input never ends.
pub(super) fn read(wait: Option<Duration>, buffer: &mut [u8]) -> Read {
    if win::console_mode(stdin()).is_none() {
        return read_piped(wait, buffer);
    }
    match win::wait_handle(stdin(), wait) {
        Ok(true) => {}
        Ok(false) => return Read::Again,
        Err(_) => return Read::End,
    }
    // Records without text, such as key releases, give nothing.
    match opentui::term::read(buffer) {
        Ok(Some(count)) => Read::Data(count),
        Ok(None) => Read::Again,
        Err(_) => Read::End,
    }
}

/// Chunks of a stdin that is not a console, from a thread that reads it for the life of the process, and the rest
/// of a chunk that did not fit the last read.
struct Piped {
    chunks: mpsc::Receiver<Vec<u8>>,
    rest: Vec<u8>,
}

fn read_piped(wait: Option<Duration>, buffer: &mut [u8]) -> Read {
    static PIPED: OnceLock<Mutex<Piped>> = OnceLock::new();
    let piped = PIPED.get_or_init(|| {
        let (send, chunks) = mpsc::channel();
        std::thread::spawn(move || {
            let mut stdin = std::io::stdin();
            loop {
                let mut chunk = vec![0; 1024];
                match stdin.read(&mut chunk) {
                    Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                    Ok(0) | Err(_) => break,
                    Ok(count) => {
                        chunk.truncate(count);
                        if send.send(chunk).is_err() {
                            break;
                        }
                    }
                }
            }
        });
        Mutex::new(Piped { chunks, rest: Vec::new() })
    });
    let mut piped = piped.lock().unwrap_or_else(PoisonError::into_inner);
    if piped.rest.is_empty() {
        let chunk = match wait {
            None => piped.chunks.recv().map_err(|_| RecvTimeoutError::Disconnected),
            Some(wait) => piped.chunks.recv_timeout(wait),
        };
        piped.rest = match chunk {
            Ok(chunk) => chunk,
            Err(RecvTimeoutError::Timeout) => return Read::Again,
            Err(RecvTimeoutError::Disconnected) => return Read::End,
        };
    }
    let count = piped.rest.len().min(buffer.len());
    buffer[..count].copy_from_slice(&piped.rest[..count]);
    piped.rest.drain(..count);
    Read::Data(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restore_undoes_raw_mode_from_another_thread() {
        // Test runners usually give no console; this checks only what can be checked then.
        let Some(cooked) = win::console_mode(stdin()) else {
            let raw = Raw::enable(Output::Stdout);
            assert!(raw.saved.is_none());
            assert!(active().is_empty());
            return;
        };
        let raw = Raw::enable(Output::Stdout);
        assert_eq!(win::console_mode(stdin()), Some(win::raw_input_mode(cooked)));
        // A shutdown step runs on the control handler's thread while the prompt still holds raw mode.
        std::thread::spawn(restore).join().unwrap();
        assert_eq!(win::console_mode(stdin()), Some(cooked));
        drop(raw);
        assert!(active().is_empty());
        assert_eq!(win::console_mode(stdin()), Some(cooked));
    }
}
