//! The parent that restarts the TUI after a plugin crashed or hung it (synthesis 4.5, decision 5 of O-125).
//!
//! A native plugin runs in the client's process: its segfault, abort or stack overflow ends the client, and a hang
//! holds the UI thread until the watchdog ends the client. When a native build is among the plugin targets, the TUI
//! runs under a parent: on Unix a fork of this process before `main` does anything else, on Windows the same binary
//! spawned again. A client with only built-ins starts as before, with no parent.
//!
//! The parent waits. When the client dies of a crash (a fatal signal or a kill, the watchdog's exit, a panic on the UI
//! thread), it restores the terminal, drops the keys typed meanwhile, reads the client's run record and starts a new
//! client:
//!
//! - with `--skip-plugin <id>` for each plugin a record of this run named, which the new client keeps disabled;
//! - after a second crash in 10 minutes that named no plugin, with `--skip-plugin '*'`: every external plugin off;
//! - with `--session` of the session the record holds, and without `--prompt` and `--continue`, which the first
//!   client acted on;
//! - with `OPENCODE_PLUGIN_RESUME` naming the record, from which the new client restores the draft and shows one
//!   notice.
//!
//! At most 2 automatic restarts in 60 s; then the parent exits with a message. Any other end of the client ends the
//! parent with the same code.

use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use opencode_plugin::contain::{Left, record};

/// Set in the client's environment: it runs under a parent, so it keeps a run record.
pub const CHILD: &str = "OPENCODE_PLUGIN_CHILD";
/// Set in the client's environment after a crash: the dead client's record.
pub const RESUME: &str = "OPENCODE_PLUGIN_RESUME";
/// `0` runs the TUI without a parent, `1` with one, whatever the plugin targets.
const PARENT: &str = "OPENCODE_PLUGIN_PARENT";

/// The window and the limit of automatic restarts.
const RESTARTS: (Duration, usize) = (Duration::from_secs(60), 2);
/// A second crash that names no plugin within this long turns every external plugin off.
const UNNAMED: Duration = Duration::from_secs(600);

/// Set in a client that runs under a parent: the dead client's record it resumes from, if any.
static CLIENT: OnceLock<Option<PathBuf>> = OnceLock::new();

/// Runs first in `main`, before any thread starts. Returns the arguments to run with, in this process or in the client
/// a fork made; or the exit code of a parent whose client is done.
pub fn start(raw: Vec<OsString>) -> Result<Vec<OsString>, ExitCode> {
    if std::env::var_os(CHILD).is_some() {
        // A spawned client. The variables go, so nothing it starts takes them for its own.
        let resume = std::env::var_os(RESUME).map(PathBuf::from);
        // SAFETY: no other thread runs yet.
        #[allow(unsafe_code)]
        unsafe {
            std::env::remove_var(CHILD);
            std::env::remove_var(RESUME);
        }
        let _ = CLIENT.set(resume);
        return Ok(raw);
    }
    if !wanted(&raw) {
        return Ok(raw);
    }
    sys::supervise(raw)
}

/// For a client under a parent: where it keeps its run record.
pub fn record() -> Option<PathBuf> {
    CLIENT.get().map(|_| record::path(std::process::id()))
}

/// What the client before this one left in its record, once.
pub fn resume() -> Option<Left> {
    let path = CLIENT.get()?.as_ref()?;
    let left = std::fs::read(path).ok().and_then(|bytes| record::read(&bytes));
    let _ = std::fs::remove_file(path);
    left
}

/// Whether `raw` runs the TUI, and a native build is among the plugin targets.
fn wanted(raw: &[OsString]) -> bool {
    match std::env::var(PARENT).as_deref() {
        Ok("0") => return false,
        Ok("1") => return true,
        _ => {}
    }
    let args: Vec<String> = raw.iter().skip(1).map(|arg| arg.to_string_lossy().into_owned()).collect();
    let crate::parse::Outcome::Run(invocation) = crate::parse::parse(&args, &crate::help::name()) else {
        return false;
    };
    if invocation.cli.command.is_some() {
        return false;
    }
    let Ok(paths) = opencode_local::paths::Paths::from_env() else { return false };
    let Ok(cwd) = std::env::current_dir() else { return false };
    let cwd = invocation.cli.root.directory.as_deref().map_or(cwd.clone(), |directory| cwd.join(directory));
    let overlay = std::env::var("OPENCODE_CLI_CONFIG_CONTENT").ok();
    let file = std::fs::read_to_string(paths.config.join("cli.json")).ok();
    let configs =
        [file, overlay].into_iter().flatten().filter_map(|text| opencode_local::cli_config::decode_text(&text));
    let targets: Vec<String> = configs
        .flat_map(|info| info.plugins.into_iter().flatten())
        .map(|plugin| match plugin {
            opencode_local::cli_config::Plugin::Name(name) => name,
            opencode_local::cli_config::Plugin::Package { package, .. } => package,
        })
        .collect();
    let targets: Vec<&str> = targets.iter().map(String::as_str).collect();
    opencode_plugin::loader::has_native_build(&paths.config, &cwd, &targets)
}

/// How a client ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum End {
    /// On its own, or by a signal the user sent: the parent ends the same way, with this code.
    Exit(u8),
    /// A crash, a kill, the watchdog or a panic on the UI thread; the code the parent ends with if it stops.
    Crash(u8),
}

/// The restarts so far, and what they skip.
#[derive(Default)]
struct Policy {
    restarts: Vec<Instant>,
    unnamed: Vec<Instant>,
    skip: Vec<String>,
}

impl Policy {
    /// After a crash at `now` whose record says `left`: the arguments of the next client, or why the parent stops.
    fn next(&mut self, now: Instant, raw: &[OsString], left: &Left) -> Result<Vec<OsString>, String> {
        self.restarts.retain(|at| now.saturating_duration_since(*at) < RESTARTS.0);
        if self.restarts.len() >= RESTARTS.1 {
            let named = left.plugin.as_ref().map(|id| format!(" (last in plugin {id})")).unwrap_or_default();
            return Err(format!(
                "opencode-native crashed {} times in {} s{named}; not restarting",
                self.restarts.len() + 1,
                RESTARTS.0.as_secs()
            ));
        }
        self.restarts.push(now);
        match &left.plugin {
            Some(id) => self.skip.push(id.clone()),
            None => {
                self.unnamed.retain(|at| now.saturating_duration_since(*at) < UNNAMED);
                self.unnamed.push(now);
                if self.unnamed.len() >= 2 {
                    self.skip.push("*".to_owned());
                }
            }
        }
        self.skip.dedup();
        Ok(arguments(raw, &self.skip, left.session.as_deref()))
    }
}

/// `raw` for the next client: without `--prompt`, `--continue`, `--session` and `--skip-plugin`, then with `--session`
/// of `session` and a `--skip-plugin` for each of `skip`.
fn arguments(raw: &[OsString], skip: &[String], session: Option<&str>) -> Vec<OsString> {
    const VALUED: &[&str] = &["--prompt", "--session", "-s", "--skip-plugin"];
    const BARE: &[&str] = &["--continue", "-c"];
    let mut next: Vec<OsString> = Vec::new();
    let mut args = raw.iter();
    if let Some(program) = args.next() {
        next.push(program.clone());
    }
    let mut rest = Vec::new();
    while let Some(arg) = args.next() {
        let text = arg.to_string_lossy();
        if text == "--" {
            rest.push(arg.clone());
            rest.extend(args.by_ref().cloned());
            break;
        }
        if VALUED.contains(&text.as_ref()) {
            args.next();
            continue;
        }
        let flag = text.split_once('=').map_or(text.as_ref(), |(flag, _)| flag);
        if BARE.contains(&text.as_ref()) || (flag != text && VALUED.contains(&flag)) {
            continue;
        }
        next.push(arg.clone());
    }
    if let Some(session) = session {
        next.extend(["--session".into(), session.into()]);
    }
    for id in skip {
        next.extend(["--skip-plugin".into(), id.into()]);
    }
    next.extend(rest);
    next
}

/// Reads and removes the run record the client of process `pid` left.
fn left(pid: u32) -> (PathBuf, Left) {
    let path = record::path(pid);
    let left = std::fs::read(&path).ok().and_then(|bytes| record::read(&bytes)).unwrap_or_default();
    (path, left)
}

/// What the terminal must not keep from the client: the alternate screen, mouse modes, bracketed paste, focus
/// reports, the kitty keyboard flags, modifyOtherKeys, synchronized output, the cursor and attributes.
const RESET: &str = "\x1b[?2026l\x1b[0m\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1015l\x1b[?2004l\x1b[?1004l\
                     \x1b[<999u\x1b[>4;0m\x1b[?1l\x1b>\x1b[?25h\x1b[?1049l";

/// What starting a client did.
enum Spawned {
    /// This process is the client now (a fork, so Unix only).
    #[cfg_attr(windows, allow(dead_code))]
    Client,
    Started(u32),
    Failed,
}

/// Runs the parent's loop: `spawn` starts a client with the next arguments and the dead client's record, `wait` waits
/// for it, `restore` puts the terminal back. Returns the arguments this process runs the client with, or the parent's
/// exit code.
fn supervise_with(
    raw: &[OsString],
    mut spawn: impl FnMut(&[OsString], Option<&Path>) -> Spawned,
    mut wait: impl FnMut(u32) -> End,
    mut restore: impl FnMut(),
) -> Result<Vec<OsString>, ExitCode> {
    let mut policy = Policy::default();
    let (mut args, mut resume): (Vec<OsString>, Option<PathBuf>) = (raw.to_vec(), None);
    let mut first = true;
    loop {
        let pid = match spawn(&args, resume.as_deref()) {
            Spawned::Client => return Ok(args),
            Spawned::Started(pid) => pid,
            // The first client could not start: this process runs it, with no parent.
            Spawned::Failed if first => return Ok(raw.to_vec()),
            Spawned::Failed => return Err(ExitCode::FAILURE),
        };
        first = false;
        let end = wait(pid);
        if let Some(path) = resume.take() {
            let _ = std::fs::remove_file(path);
        }
        let (path, left) = left(pid);
        let code = match end {
            End::Exit(code) => {
                let _ = std::fs::remove_file(&path);
                return Err(ExitCode::from(code));
            }
            End::Crash(code) => code,
        };
        restore();
        match policy.next(Instant::now(), raw, &left) {
            Ok(next) => (args, resume) = (next, Some(path)),
            Err(message) => {
                let _ = std::fs::remove_file(&path);
                eprintln!("{message}");
                return Err(ExitCode::from(code));
            }
        }
    }
}

#[cfg(unix)]
mod sys {
    #![allow(unsafe_code)]

    use std::ffi::OsString;
    use std::io::Write;
    use std::os::fd::BorrowedFd;
    use std::path::Path;
    use std::process::ExitCode;
    use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};

    use super::{End, RESET, Spawned};

    /// The client, for the signals the parent passes on.
    static CLIENT: AtomicI32 = AtomicI32::new(0);
    /// The parent was asked to end: however the client ends now, it is not restarted.
    pub(super) static ENDING: AtomicBool = AtomicBool::new(false);

    pub fn supervise(raw: Vec<OsString>) -> Result<Vec<OsString>, ExitCode> {
        // SAFETY: fd 0 stays open for the life of the process.
        let stdin = unsafe { BorrowedFd::borrow_raw(0) };
        let saved = rustix::termios::tcgetattr(stdin).ok();
        // SAFETY: plain call.
        let me = unsafe { libc::getpid() };
        super::supervise_with(
            &raw,
            // SAFETY: this process runs one thread: `main` has only read its arguments and the plugin targets.
            |_, resume| match unsafe { libc::fork() } {
                -1 => Spawned::Failed,
                0 => {
                    child(resume, me);
                    Spawned::Client
                }
                pid => {
                    parent();
                    CLIENT.store(pid, Ordering::Relaxed);
                    Spawned::Started(pid as u32)
                }
            },
            |pid| wait(pid as i32),
            || restore(stdin, saved.as_ref()),
        )
    }

    /// In a new client: the signal dispositions it would have had, and what it resumes from. On Linux it dies with the
    /// parent, so a parent killed outright leaves no client on the terminal; elsewhere it outlives such a parent.
    fn child(resume: Option<&Path>, parent: libc::pid_t) {
        // SAFETY: plain dispositions and process attributes, in a process of one thread.
        unsafe {
            for signal in [libc::SIGINT, libc::SIGQUIT, libc::SIGTERM, libc::SIGHUP] {
                libc::signal(signal, libc::SIG_DFL);
            }
            #[cfg(target_os = "linux")]
            if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL) == 0 && libc::getppid() != parent {
                libc::_exit(1);
            }
        }
        let _ = parent;
        let _ = super::CLIENT.set(resume.map(Path::to_path_buf));
    }

    /// In the parent: the terminal's interrupt keys reach the client, which owns them; a request to end goes to it.
    fn parent() {
        // SAFETY: plain dispositions, and a handler that only reads an atomic and calls `kill`.
        unsafe {
            libc::signal(libc::SIGINT, libc::SIG_IGN);
            libc::signal(libc::SIGQUIT, libc::SIG_IGN);
            libc::signal(libc::SIGTERM, forward as *const () as libc::sighandler_t);
            libc::signal(libc::SIGHUP, forward as *const () as libc::sighandler_t);
        }
    }

    extern "C" fn forward(signal: libc::c_int) {
        ENDING.store(true, Ordering::Relaxed);
        let pid = CLIENT.load(Ordering::Relaxed);
        if pid > 0 {
            // SAFETY: async-signal-safe.
            unsafe { libc::kill(pid, signal) };
        }
    }

    /// Waits for the client. When it stops (Ctrl+Z), the parent stops too, so the shell takes the terminal back, and
    /// continues it once it is continued.
    pub(super) fn wait(pid: i32) -> End {
        loop {
            let mut status = 0;
            // SAFETY: waits for this process's own child.
            let waited = unsafe { libc::waitpid(pid, &mut status, libc::WUNTRACED) };
            if waited == -1 {
                if std::io::Error::last_os_error().kind() == std::io::ErrorKind::Interrupted {
                    continue;
                }
                return End::Exit(1);
            }
            if libc::WIFSTOPPED(status) {
                // SAFETY: stops this process; the shell's SIGCONT continues it, then the client.
                unsafe {
                    libc::raise(libc::SIGSTOP);
                    libc::kill(pid, libc::SIGCONT);
                }
                continue;
            }
            // A client that ends while the terminal hangs up, or after the parent was asked to end, is not restarted.
            return match end(status) {
                End::Crash(code) if ENDING.load(Ordering::Relaxed) => End::Exit(code),
                end => end,
            };
        }
    }

    /// How a client that ended with `status` ended.
    pub(super) fn end(status: libc::c_int) -> End {
        if libc::WIFSIGNALED(status) {
            let signal = libc::WTERMSIG(status);
            let code = (128 + signal).min(255) as u8;
            // Signals that end a process on request, not a fault.
            return match signal {
                libc::SIGINT | libc::SIGTERM | libc::SIGHUP | libc::SIGPIPE => End::Exit(code),
                _ => End::Crash(code),
            };
        }
        let code = libc::WEXITSTATUS(status) as u8;
        // The watchdog's exit, and a panic on the UI thread.
        match i32::from(code) {
            opencode_plugin::contain::watchdog::HUNG | 101 => End::Crash(code),
            _ => End::Exit(code),
        }
    }

    /// Puts back the terminal's modes the client changed, dropping the keys typed while it was frozen or dying: they
    /// were aimed at a screen that is gone, and an Enter among them would send the restored draft.
    fn restore(stdin: BorrowedFd<'_>, saved: Option<&rustix::termios::Termios>) {
        if let Some(saved) = saved {
            let _ = rustix::termios::tcsetattr(stdin, rustix::termios::OptionalActions::Flush, saved);
        }
        // The client may have left the terminal non-blocking; the file description outlives it.
        for fd in 0..3 {
            // SAFETY: plain flag calls on the standard descriptors.
            unsafe {
                let flags = libc::fcntl(fd, libc::F_GETFL);
                if flags >= 0 && flags & libc::O_NONBLOCK != 0 {
                    libc::fcntl(fd, libc::F_SETFL, flags & !libc::O_NONBLOCK);
                }
            }
        }
        let _ = std::io::stdout().write_all(RESET.as_bytes()).and_then(|()| std::io::stdout().flush());
    }
}

#[cfg(windows)]
mod sys {
    use std::ffi::OsString;
    use std::io::Write;
    use std::process::ExitCode;

    use super::{CHILD, End, RESET, RESUME, Spawned};

    /// The parent is this binary again: a small binary of its own was not built (synthesis 4.5 prices both).
    pub fn supervise(raw: Vec<OsString>) -> Result<Vec<OsString>, ExitCode> {
        let Ok(exe) = std::env::current_exe() else { return Ok(raw) };
        let modes = opencode_util::win::ConsoleModes::save();
        // `wait` takes the child `spawn` made; they run one after the other.
        let client: std::cell::RefCell<Option<std::process::Child>> = Default::default();
        super::supervise_with(
            &raw,
            |args, resume| {
                let mut command = std::process::Command::new(&exe);
                command.args(&args[1..]).env(CHILD, "1");
                match resume {
                    Some(path) => command.env(RESUME, path),
                    None => command.env_remove(RESUME),
                };
                let Ok(child) = command.spawn() else { return Spawned::Failed };
                // Ctrl+C reaches every process on the console; the client owns it.
                let _ = opencode_util::win::ignore_interrupts();
                let pid = child.id();
                *client.borrow_mut() = Some(child);
                Spawned::Started(pid)
            },
            |_| match client.borrow_mut().take().and_then(|mut child| child.wait().ok()) {
                Some(status) => status.code().map_or(End::Exit(1), |code| end(code as u32)),
                None => End::Exit(1),
            },
            || {
                modes.restore();
                let _ = std::io::stdout().write_all(RESET.as_bytes()).and_then(|()| std::io::stdout().flush());
            },
        )
    }

    /// How a client that exited with `code` ended: an exception status (an access violation, a stack overflow, a
    /// fail-fast abort), `abort`'s 3, the watchdog's exit and a panic on the UI thread are crashes.
    pub(super) fn end(code: u32) -> End {
        let crash =
            code >= 0xC000_0000 || code == 3 || code == 101 || code as i32 == opencode_plugin::contain::watchdog::HUNG;
        if crash { End::Crash(1) } else { End::Exit(code.min(255) as u8) }
    }
}

#[cfg(test)]
mod tests;
