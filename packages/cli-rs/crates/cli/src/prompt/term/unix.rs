//! The prompt terminal on Unix: termios raw mode, `TIOCGWINSZ` sizes, and `poll` and `read` on stdin.

use std::os::fd::{AsFd, BorrowedFd};
use std::sync::atomic::Ordering;
use std::time::Duration;

use rustix::event::{PollFd, PollFlags, Timespec, poll};
use rustix::io::Errno;
use rustix::termios::{
    ControlModes, InputModes, LocalModes, OptionalActions, OutputModes, SpecialCodeIndex, Termios, isatty, tcgetattr,
    tcgetwinsize, tcsetattr,
};

use super::{Output, Read};

/// A duplicate of stdin's descriptor, kept for the whole process. Reads bypass std's buffer, which
/// nothing else in the CLI fills while a prompt runs.
fn stdin() -> BorrowedFd<'static> {
    static FD: std::sync::OnceLock<std::os::fd::OwnedFd> = std::sync::OnceLock::new();
    FD.get_or_init(|| std::io::stdin().as_fd().try_clone_to_owned().expect("stdin has a descriptor")).as_fd()
}

/// Both ends are terminals, as `requireInteractive` in `packages/cli/src/ui/prompt.ts` checks.
pub fn interactive() -> bool {
    isatty(stdin()) && isatty(std::io::stdout())
}

/// `process.stdout.columns`: unset when stdout is not a terminal, and then Clack does not wrap.
pub fn columns() -> Option<usize> {
    let stdout = std::io::stdout();
    if !isatty(&stdout) {
        return None;
    }
    tcgetwinsize(&stdout).ok().map(|size| usize::from(size.ws_col)).filter(|columns| *columns > 0)
}

/// `process.stdout.rows`: unset when stdout is not a terminal.
pub fn stdout_rows() -> Option<usize> {
    let stdout = std::io::stdout();
    if !isatty(&stdout) {
        return None;
    }
    tcgetwinsize(&stdout).ok().map(|size| usize::from(size.ws_row)).filter(|rows| *rows > 0)
}

/// The rows of the prompt's output terminal, or 10 when it is not one (`limitOptions`).
pub fn rows(output: Output) -> usize {
    let size = match output {
        Output::Stdout => tcgetwinsize(std::io::stdout()),
        Output::Stderr => tcgetwinsize(std::io::stderr()),
    };
    match size {
        Ok(size) if output.is_terminal() => usize::from(size.ws_row),
        _ => 10,
    }
}

impl Output {
    pub(in crate::prompt) fn is_terminal(self) -> bool {
        match self {
            Output::Stdout => isatty(std::io::stdout()),
            Output::Stderr => isatty(std::io::stderr()),
        }
    }
}

/// Raw mode on stdin while alive, when stdin is a terminal. The flags are libuv's
/// `UV_TTY_MODE_RAW`, which keeps `ONLCR`, so `\n` still starts a new line. `output` is where the
/// holder draws and hides the cursor.
pub struct Raw {
    fd: BorrowedFd<'static>,
    saved: Option<(u64, Termios)>,
}

/// The modes saved by each live [`Raw`], oldest first, with the output it draws on, so [`restore`] can put
/// the terminal back from a signal handler's thread while a prompt still holds raw mode.
type Active = Vec<(u64, BorrowedFd<'static>, Termios, Output)>;

static ACTIVE: std::sync::Mutex<Active> = std::sync::Mutex::new(Vec::new());

fn active() -> std::sync::MutexGuard<'static, Active> {
    ACTIVE.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

impl Raw {
    pub fn enable(output: Output) -> Raw {
        Raw::enable_on(stdin(), output)
    }

    fn enable_on(fd: BorrowedFd<'static>, output: Output) -> Raw {
        static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let saved =
            isatty(fd).then(|| tcgetattr(fd).ok()).flatten().map(|saved| (NEXT.fetch_add(1, Ordering::Relaxed), saved));
        if let Some((id, saved)) = &saved {
            let mut raw = saved.clone();
            raw.input_modes -=
                InputModes::BRKINT | InputModes::ICRNL | InputModes::INPCK | InputModes::ISTRIP | InputModes::IXON;
            raw.output_modes |= OutputModes::ONLCR;
            raw.control_modes |= ControlModes::CS8;
            raw.local_modes -= LocalModes::ECHO | LocalModes::ICANON | LocalModes::IEXTEN | LocalModes::ISIG;
            raw.special_codes[SpecialCodeIndex::VMIN] = 1;
            raw.special_codes[SpecialCodeIndex::VTIME] = 0;
            active().push((*id, fd, saved.clone(), output));
            let _ = tcsetattr(fd, OptionalActions::Now, &raw);
        }
        Raw { fd, saved }
    }
}

impl Drop for Raw {
    fn drop(&mut self) {
        if let Some((id, saved)) = &self.saved {
            active().retain(|(other, _, _, _)| other != id);
            let _ = tcsetattr(self.fd, OptionalActions::Now, saved);
        }
    }
}

/// Puts the terminal back as it was before the first live prompt took raw mode, and shows the cursor that
/// prompts hide on each output they draw on that is a terminal, never into a redirected file. A shutdown
/// step: the process exits right after, without running the prompt's own drop. Does nothing while no
/// prompt holds raw mode.
pub fn restore() {
    let active = active();
    let Some((_, fd, saved, _)) = active.first() else { return };
    let _ = tcsetattr(*fd, OptionalActions::Now, saved);
    for output in [Output::Stdout, Output::Stderr] {
        if active.iter().any(|entry| entry.3 == output) && output.is_terminal() {
            output.write("\x1b[?25h");
        }
    }
}

/// Waits up to `wait` (forever with `None`) for stdin to be readable, then reads it into `buffer`.
pub(super) fn read(wait: Option<Duration>, buffer: &mut [u8]) -> Read {
    let spec = wait.map(|wait| Timespec { tv_sec: wait.as_secs() as _, tv_nsec: wait.subsec_nanos() as _ });
    let fd = stdin();
    let mut fds = [PollFd::new(&fd, PollFlags::IN)];
    match poll(&mut fds, spec.as_ref()) {
        Ok(0) | Err(Errno::INTR) => return Read::Again,
        Ok(_) => {}
        Err(_) => return Read::End,
    }
    match rustix::io::read(stdin(), buffer) {
        Ok(0) => Read::End,
        Ok(count) => Read::Data(count),
        Err(Errno::INTR | Errno::AGAIN) => Read::Again,
        Err(_) => Read::End,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restore_undoes_raw_mode_from_another_thread() {
        use rustix::fs::{Mode, OFlags, open};
        use rustix::pty::{OpenptFlags, grantpt, openpt, ptsname, unlockpt};
        let master = openpt(OpenptFlags::RDWR | OpenptFlags::NOCTTY).unwrap();
        grantpt(&master).unwrap();
        unlockpt(&master).unwrap();
        let name = ptsname(&master, Vec::new()).unwrap();
        let slave = open(name.as_c_str(), OFlags::RDWR | OFlags::NOCTTY, Mode::empty()).unwrap();
        let slave: &'static std::os::fd::OwnedFd = Box::leak(Box::new(slave));
        let fd = slave.as_fd();
        let cooked = tcgetattr(fd).unwrap().local_modes;
        assert!(cooked.contains(LocalModes::ICANON));
        let raw = Raw::enable_on(fd, Output::Stdout);
        assert!(!tcgetattr(fd).unwrap().local_modes.contains(LocalModes::ICANON));
        // A shutdown step runs on the signal thread while the prompt still holds raw mode.
        std::thread::spawn(restore).join().unwrap();
        assert_eq!(tcgetattr(fd).unwrap().local_modes, cooked);
        drop(raw);
        assert!(active().is_empty());
        restore();
        assert_eq!(tcgetattr(fd).unwrap().local_modes, cooked);
    }
}
