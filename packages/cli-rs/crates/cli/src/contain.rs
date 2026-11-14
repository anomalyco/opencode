//! The parent that restarts the TUI after a plugin crashed or hung it (synthesis 4.5, decision 5 of O-125).
//!
//! A native plugin runs in the client's process: its segfault, abort or stack overflow ends the client, and a hang
//! holds the UI thread until the watchdog ends the client. When a native build is among the plugin targets, the TUI
//! runs under a parent: on Unix a fork of this process before `main` does anything else, on Windows the same binary
//! spawned again. A client with only built-ins starts as before, with no parent; one that should have a parent and has
//! none opens no external library (`opencode_tui::plugins::contain`).
//!
//! Before it starts a client, the parent creates the client's run record: a private mapped file with no name
//! (`opencode_plugin::contain::Record`). A forked client gets it in memory; a spawned one inherits its handle, named
//! by `OPENCODE_PLUGIN_RECORD`. When the client dies of a crash (a fatal signal or a kill, the watchdog's exit, a panic
//! on the UI thread), the parent restores the terminal, reads the record from its own mapping and starts a new client
//! whose record holds:
//!
//! - the crash: the build and call the dead record names, which the new client holds disabled, or nothing;
//! - safe mode, after a second crash that named no plugin within 10 minutes of this parent: every external plugin
//!   off, for that client only;
//! - the dead client's last snapshot, from which the new client restores the draft.
//!
//! The new client opens the snapshot's session with `--session`, without `--prompt` and `--continue`, which the first
//! client acted on; its other arguments are the first client's, rebuilt from the parsed command line.
//!
//! At most 2 automatic restarts in 60 s; then the parent exits with a message. Any other end of the client ends the
//! parent with the same code, and so does any end after the parent was asked to end.

use std::ffi::OsString;
use std::io;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use opencode_plugin::contain::{Crash, Handoff, Record};

use crate::args::{GlobalArgs, RootArgs, ServerFlags};

/// Set in a spawned client's environment: the value of the record's inherited handle.
#[cfg_attr(unix, allow(dead_code))]
const RECORD: &str = "OPENCODE_PLUGIN_RECORD";
/// `0` runs the TUI without a parent, `1` with one, whatever the plugin targets.
const PARENT: &str = "OPENCODE_PLUGIN_PARENT";

/// The window and the limit of automatic restarts.
const RESTARTS: (Duration, usize) = (Duration::from_secs(60), 2);
/// A second crash that names no plugin within this long turns every external plugin off. It counts the crashes of
/// this parent only: a new `opencode-native` starts afresh.
const UNNAMED: Duration = Duration::from_secs(600);

/// Set in a client that runs under a parent: its run record.
static CLIENT: OnceLock<Arc<Record>> = OnceLock::new();

/// What a restart keeps of the first client's command line.
#[derive(Clone, Debug, Default)]
struct Restart {
    server: ServerFlags,
    root: RootArgs,
    global: GlobalArgs,
}

/// Runs first in `main`, before any thread starts. Returns the arguments to run with, in this process or in the client
/// a fork made; or the exit code of a parent whose client is done.
pub fn start(raw: Vec<OsString>) -> Result<Vec<OsString>, i32> {
    #[cfg(windows)]
    if let Some(value) = std::env::var_os(RECORD) {
        // A spawned client. The variable goes, so nothing it starts takes it for its own.
        // SAFETY: no other thread runs yet.
        #[allow(unsafe_code)]
        unsafe {
            std::env::remove_var(RECORD)
        };
        if let Some(record) = sys::inherited(&value) {
            let _ = CLIENT.set(Arc::new(record));
        }
        return Ok(raw);
    }
    let Some(restart) = wanted(&raw) else { return Ok(raw) };
    sys::supervise(raw, restart)
}

/// For a client under a parent: its run record.
pub fn record() -> Option<Arc<Record>> {
    let record = CLIENT.get()?.clone();
    #[cfg(unix)]
    sys::watch_parent();
    Some(record)
}

/// Why external plugins do not run in a TUI with no parent, or `None` when they may: it has one, or
/// `OPENCODE_PLUGIN_PARENT=0` asked for none.
pub fn unsupervised() -> Option<String> {
    if CLIENT.get().is_some() || std::env::var(PARENT).as_deref() == Ok("0") {
        return None;
    }
    Some("no crash guard runs for this TUI: restart opencode-native to run it".to_owned())
}

/// What a restart keeps of `raw`, when `raw` runs the TUI and a native build is among the plugin targets.
fn wanted(raw: &[OsString]) -> Option<Restart> {
    // Whatever `OPENCODE_PLUGIN_PARENT` says, only the TUI gets a parent.
    let restart = tui(raw)?;
    match std::env::var(PARENT).as_deref() {
        Ok("0") => return None,
        Ok("1") => return Some(restart),
        _ => {}
    }
    let paths = opencode_local::paths::Paths::from_env().ok()?;
    let cwd = std::env::current_dir().ok()?;
    // As `default` enters it: a symlinked directory is its target, whose ancestors hold the project's plugins.
    let cwd = restart.root.directory.as_deref().map_or(cwd.clone(), |directory| {
        let joined = cwd.join(directory);
        std::fs::canonicalize(&joined).unwrap_or(joined)
    });
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
    opencode_plugin::loader::has_native_build(&paths.config, &cwd, &targets).then_some(restart)
}

/// What a restart keeps of `raw`, when `raw` runs the TUI.
fn tui(raw: &[OsString]) -> Option<Restart> {
    let args: Vec<String> = raw.iter().skip(1).map(|arg| arg.to_string_lossy().into_owned()).collect();
    let crate::parse::Outcome::Run(invocation) = crate::parse::parse(&args, &crate::help::name()) else {
        return None;
    };
    if invocation.cli.command.is_some() {
        return None;
    }
    Some(Restart {
        server: invocation.server.clone(),
        root: invocation.cli.root.clone(),
        global: invocation.cli.global.clone(),
    })
}

/// How a client ended.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum End {
    /// On its own, or by a signal the user sent: the parent ends the same way, with this code.
    Exit(i32),
    /// A crash, a kill, the watchdog or a panic on the UI thread; the code the parent ends with if it stops.
    Crash(i32),
}

/// The crashes so far.
#[derive(Default)]
struct Policy {
    restarts: Vec<Instant>,
    unnamed: Vec<Instant>,
}

impl Policy {
    /// After a crash at `now` that the record told as `crash`: what the next client is told, or why the parent stops.
    /// Only this crash is handed over; the crashes before it are in the crash list, where the user's enable or a
    /// rebuild ends them.
    fn next(&mut self, now: Instant, crash: &Crash) -> Result<Handoff, String> {
        self.restarts.retain(|at| now.saturating_duration_since(*at) < RESTARTS.0);
        if self.restarts.len() >= RESTARTS.1 {
            let named = crash
                .artifact
                .as_ref()
                .map(|artifact| match (&artifact.id, &artifact.target) {
                    (id, Some(target)) if id.is_empty() => format!(" (last in plugin {target})"),
                    (id, _) => format!(" (last in plugin {id})"),
                })
                .unwrap_or_default();
            return Err(format!(
                "opencode-native crashed {} times in {} s{named}; not restarting",
                self.restarts.len() + 1,
                RESTARTS.0.as_secs()
            ));
        }
        self.restarts.push(now);
        let mut safe = false;
        if crash.artifact.is_none() {
            self.unnamed.retain(|at| now.saturating_duration_since(*at) < UNNAMED);
            self.unnamed.push(now);
            safe = self.unnamed.len() >= 2;
        }
        Ok(Handoff { crash: Some(crash.clone()), safe })
    }
}

/// The arguments of the next client: the first client's, without `--prompt` and `--continue`, with `--session` of
/// `session`. They are rebuilt from the parsed command line, so every spelling the parser takes comes out one way.
fn arguments(program: &OsString, restart: &Restart, session: Option<&str>) -> Vec<OsString> {
    let mut next = vec![program.clone()];
    if restart.server.standalone {
        next.push("--standalone".into());
    }
    if let Some(server) = &restart.server.server {
        next.push(format!("--server={server}").into());
    }
    if restart.root.permissions.auto() {
        next.push("--auto".into());
    }
    if restart.global.print_logs {
        next.push("--print-logs".into());
    }
    if let Some(level) = restart.global.log_level {
        next.push(format!("--log-level={}", level.as_choice()).into());
    }
    if let Some(session) = session {
        next.push(format!("--session={session}").into());
    }
    if let Some(directory) = &restart.root.directory {
        next.extend(["--".into(), directory.into()]);
    }
    next
}

/// What the terminal must not keep from a client that took it: synchronized output, attributes, every mouse mode,
/// bracketed paste, focus reports, grapheme width and color-scheme reports, the kitty keyboard flags the client pushed,
/// modifyOtherKeys, cursor keys and keypad, cursor style and color, the mouse pointer, the title, the cursor itself
/// and the alternate screen, as OpenTUI's own teardown puts them back.
const RESET: &str = "\x1b[?2026l\x1b[0m\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1015l\x1b[?1016l\
                     \x1b[?2004l\x1b[?1004l\x1b[?2027l\x1b[?2031l\x1b[<u\x1b[>4;0m\x1b[?1l\x1b>\x1b[0 q\
                     \x1b]112\x07\x1b]22;\x1b\\\x1b]0;\x07\x1b[?25h\x1b[?1049l";

/// What starting a client did.
#[derive(Debug)]
enum Spawned {
    /// This process is the client now (a fork, so Unix only).
    #[cfg_attr(windows, allow(dead_code))]
    Client,
    Started(u32),
    Failed,
    /// The parent was asked to end before it started one: it ends with this code.
    #[cfg_attr(windows, allow(dead_code))]
    Ending(i32),
}

/// What the parent's loop asks of the system.
trait System {
    /// A new private run record.
    fn record(&mut self) -> io::Result<Record>;
    /// Starts a client with `args` and `record`.
    fn spawn(&mut self, args: &[OsString], record: &Arc<Record>) -> Spawned;
    /// Waits for client `pid` to end.
    fn wait(&mut self, pid: u32) -> End;
    /// Puts the terminal back after a crash; `took` says the client had taken it over.
    fn restore(&mut self, took: bool);
    /// Whether the parent was asked to end.
    fn ending(&self) -> bool;
}

/// Runs the parent's loop. Returns the arguments this process runs the client with, or the parent's exit code.
fn supervise_with(raw: &[OsString], restart: &Restart, system: &mut impl System) -> Result<Vec<OsString>, i32> {
    // With no record there is no parent: the client runs here, and holds its external plugins.
    let mut record = match system.record() {
        Ok(record) => Arc::new(record),
        Err(error) => {
            eprintln!("opencode-native: cannot make the plugin run record ({error}); native plugins stay off");
            return Ok(raw.to_vec());
        }
    };
    let mut policy = Policy::default();
    let mut args = raw.to_vec();
    let mut first = true;
    loop {
        let pid = match system.spawn(&args, &record) {
            Spawned::Client => return Ok(args),
            Spawned::Started(pid) => pid,
            // The first client could not start: this process runs it, with no parent.
            Spawned::Failed if first => return Ok(raw.to_vec()),
            Spawned::Failed => return Err(1),
            Spawned::Ending(code) => return Err(code),
        };
        first = false;
        let code = match system.wait(pid) {
            End::Exit(code) => return Err(code),
            End::Crash(code) => code,
        };
        // Whatever follows, the terminal is put back: the client that crashed could not.
        system.restore(record.terminal());
        if system.ending() {
            return Err(code);
        }
        let handoff = match policy.next(Instant::now(), &record.crash()) {
            Ok(handoff) => handoff,
            Err(message) => {
                eprintln!("{message}");
                return Err(code);
            }
        };
        let next = match system.record() {
            Ok(next) => next,
            Err(error) => {
                eprintln!("opencode-native: cannot make the plugin run record ({error}); not restarting");
                return Err(code);
            }
        };
        next.set_handoff(&handoff);
        // The dead client's snapshot stays the newest until the next client publishes its own.
        let snapshot = record.snapshot();
        if let Some(snapshot) = &snapshot {
            next.publish(snapshot);
        }
        args = arguments(&raw[0], restart, snapshot.as_ref().and_then(|snapshot| snapshot.session.as_deref()));
        record = Arc::new(next);
    }
}

#[cfg(unix)]
mod sys {
    #![allow(unsafe_code)]

    use std::ffi::OsString;
    use std::io::Write;
    use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
    use std::sync::Arc;
    use std::sync::atomic::{AtomicI32, Ordering};
    use std::time::{Duration, Instant};

    use opencode_plugin::contain::Record;

    use super::{End, RESET, Restart, Spawned};

    /// The client, for the signals the parent passes on; 0 once it was reaped.
    static CLIENT: AtomicI32 = AtomicI32::new(0);
    /// The signal that asked the parent to end, or 0: however the client ends now, it is not restarted.
    pub(super) static ENDING: AtomicI32 = AtomicI32::new(0);
    /// In a forked client: the read end of the lease on its parent, which reads end of file when the parent is gone.
    static LEASE: AtomicI32 = AtomicI32::new(-1);

    /// The signals whose disposition the parent changes. A client gets back what the parent found.
    const CHANGED: [libc::c_int; 6] =
        [libc::SIGINT, libc::SIGQUIT, libc::SIGTERM, libc::SIGHUP, libc::SIGTTOU, libc::SIGCHLD];
    /// How long a client asked to end may take before the parent kills it.
    const GRACE: Duration = Duration::from_secs(10);

    pub fn supervise(raw: Vec<OsString>, restart: Restart) -> Result<Vec<OsString>, i32> {
        super::supervise_with(&raw, &restart, &mut Unix::new())
    }

    /// The parent on Unix.
    pub(super) struct Unix {
        /// The dispositions and the signal mask as the parent found them.
        found: Vec<(libc::c_int, libc::sigaction)>,
        mask: libc::sigset_t,
        terminal: Terminal,
        /// The write end of the running client's lease.
        lease: Option<OwnedFd>,
    }

    impl Unix {
        /// Takes over the signals: Ctrl+C and Ctrl+\ are the client's; TERM and HUP are passed on, unless the parent
        /// found them ignored (`nohup`); the parent's own terminal writes never stop it; SIGCHLD wakes it. TERM, HUP
        /// and CHLD stay blocked but while the parent waits, so their handler runs only there, and never between a
        /// fork and the publication of its PID, nor between a reap and its withdrawal.
        pub(super) fn new() -> Unix {
            // SAFETY: plain signal calls on valid structs, in a process of one thread.
            unsafe {
                let mut mask: libc::sigset_t = std::mem::zeroed();
                libc::sigprocmask(libc::SIG_SETMASK, std::ptr::null(), &mut mask);
                let found = CHANGED
                    .iter()
                    .map(|signal| {
                        let mut old: libc::sigaction = std::mem::zeroed();
                        libc::sigaction(*signal, std::ptr::null(), &mut old);
                        (*signal, old)
                    })
                    .collect::<Vec<_>>();
                let ignored =
                    |signal| found.iter().any(|(known, old)| *known == signal && old.sa_sigaction == libc::SIG_IGN);
                let set = |signal, handler: libc::sighandler_t, flags| {
                    let mut action: libc::sigaction = std::mem::zeroed();
                    action.sa_sigaction = handler;
                    action.sa_flags = flags;
                    libc::sigemptyset(&mut action.sa_mask);
                    libc::sigaction(signal, &action, std::ptr::null_mut());
                };
                set(libc::SIGINT, libc::SIG_IGN, 0);
                set(libc::SIGQUIT, libc::SIG_IGN, 0);
                set(libc::SIGTTOU, libc::SIG_IGN, 0);
                for signal in [libc::SIGTERM, libc::SIGHUP] {
                    if !ignored(signal) {
                        set(signal, forward as *const () as libc::sighandler_t, libc::SA_RESTART);
                    }
                }
                set(libc::SIGCHLD, woken as *const () as libc::sighandler_t, libc::SA_RESTART | libc::SA_NOCLDSTOP);
                let mut blocked: libc::sigset_t = std::mem::zeroed();
                libc::sigemptyset(&mut blocked);
                for signal in [libc::SIGTERM, libc::SIGHUP, libc::SIGCHLD] {
                    libc::sigaddset(&mut blocked, signal);
                }
                libc::sigprocmask(libc::SIG_BLOCK, &blocked, std::ptr::null_mut());
                Unix { found, mask, terminal: Terminal::save(), lease: None }
            }
        }

        /// The mask the parent waits with: the one it found, with TERM, HUP and CHLD let through.
        fn waiting(&self) -> libc::sigset_t {
            let mut mask = self.mask;
            // SAFETY: plain set operations on a valid set.
            unsafe {
                for signal in [libc::SIGTERM, libc::SIGHUP, libc::SIGCHLD] {
                    libc::sigdelset(&mut mask, signal);
                }
            }
            mask
        }

        /// In a new client: the dispositions and mask the parent found, and the parent's lease. On Linux it also dies
        /// with the parent, so a parent killed outright leaves no client on the terminal.
        fn become_client(&mut self, parent: libc::pid_t, lease: OwnedFd, held: OwnedFd) {
            drop(held);
            drop(self.lease.take());
            // SAFETY: plain dispositions and process attributes, in a process of one thread.
            unsafe {
                for (signal, old) in &self.found {
                    libc::sigaction(*signal, old, std::ptr::null_mut());
                }
                libc::sigprocmask(libc::SIG_SETMASK, &self.mask, std::ptr::null_mut());
                #[cfg(target_os = "linux")]
                if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGKILL) == 0 && libc::getppid() != parent {
                    libc::_exit(1);
                }
            }
            let _ = parent;
            LEASE.store(std::os::fd::IntoRawFd::into_raw_fd(lease), Ordering::Relaxed);
        }
    }

    impl super::System for Unix {
        fn record(&mut self) -> std::io::Result<Record> {
            Record::create(&opencode_plugin::contain::record::dir())
        }

        fn spawn(&mut self, _: &[OsString], record: &Arc<Record>) -> Spawned {
            // A request to end that came while the last client was put back: start nothing. One still pending is
            // delivered while the parent waits, and goes to the client started here.
            let signal = ENDING.load(Ordering::Relaxed);
            if signal != 0 {
                return Spawned::Ending(128 + signal);
            }
            let Ok((read, write)) = lease() else { return Spawned::Failed };
            // SAFETY: plain call.
            let me = unsafe { libc::getpid() };
            // SAFETY: this process runs one thread: `main` has only read its arguments and the plugin targets.
            match unsafe { libc::fork() } {
                -1 => Spawned::Failed,
                0 => {
                    self.become_client(me, read, write);
                    let _ = super::CLIENT.set(record.clone());
                    Spawned::Client
                }
                pid => {
                    CLIENT.store(pid, Ordering::Relaxed);
                    drop(read);
                    self.lease = Some(write);
                    Spawned::Started(pid as u32)
                }
            }
        }

        fn wait(&mut self, pid: u32) -> End {
            wait(pid as libc::pid_t, &self.waiting())
        }

        fn restore(&mut self, took: bool) {
            self.terminal.restore(took);
        }

        fn ending(&self) -> bool {
            ENDING.load(Ordering::Relaxed) != 0
        }
    }

    /// A pipe whose ends do not reach the programs the client runs.
    fn lease() -> std::io::Result<(OwnedFd, OwnedFd)> {
        let mut fds = [0; 2];
        // SAFETY: `fds` has room for both ends, which are owned below.
        if unsafe { libc::pipe(fds.as_mut_ptr()) } != 0 {
            return Err(std::io::Error::last_os_error());
        }
        // SAFETY: both descriptors were just made and are owned by nothing else.
        let (read, write) = unsafe { (OwnedFd::from_raw_fd(fds[0]), OwnedFd::from_raw_fd(fds[1])) };
        for fd in [&read, &write] {
            // SAFETY: a plain flag call on an open descriptor.
            unsafe { libc::fcntl(fd.as_raw_fd(), libc::F_SETFD, libc::FD_CLOEXEC) };
        }
        Ok((read, write))
    }

    /// In a forked client, once: a thread that waits for the parent to end. Then the client is hung up on, as when its
    /// terminal closes, so it puts the terminal back itself; one that does not end within the grace is ended.
    pub(super) fn watch_parent() {
        let fd = LEASE.swap(-1, Ordering::Relaxed);
        if fd < 0 {
            return;
        }
        // SAFETY: the read end `become_client` kept, taken once.
        let lease = unsafe { OwnedFd::from_raw_fd(fd) };
        let _ = std::thread::Builder::new().name("plugin-parent".into()).spawn(move || {
            let mut byte = [0u8; 1];
            // SAFETY: a read into a buffer of its length; the parent never writes, so it returns at end of file.
            while unsafe { libc::read(lease.as_raw_fd(), byte.as_mut_ptr().cast(), 1) } != 0 {
                if std::io::Error::last_os_error().kind() != std::io::ErrorKind::Interrupted {
                    return;
                }
            }
            // SAFETY: plain call.
            unsafe { libc::kill(libc::getpid(), libc::SIGHUP) };
            std::thread::sleep(GRACE);
            opencode_util::page::exit_now(129);
        });
    }

    extern "C" fn forward(signal: libc::c_int) {
        let saved = errno();
        ENDING.store(signal, Ordering::Relaxed);
        let pid = CLIENT.load(Ordering::Relaxed);
        if pid > 0 {
            // SAFETY: async-signal-safe.
            unsafe { libc::kill(pid, signal) };
        }
        set_errno(saved);
    }

    /// Only wakes the parent from `sigsuspend`.
    extern "C" fn woken(_: libc::c_int) {}

    fn errno() -> libc::c_int {
        std::io::Error::last_os_error().raw_os_error().unwrap_or(0)
    }

    fn set_errno(value: libc::c_int) {
        // SAFETY: the calling thread's errno.
        unsafe {
            #[cfg(any(target_os = "linux", target_os = "android"))]
            let location = libc::__errno_location();
            #[cfg(not(any(target_os = "linux", target_os = "android")))]
            let location = libc::__error();
            *location = value;
        }
    }

    /// Waits for client `pid`, with TERM, HUP and CHLD blocked but in `sigsuspend` with `waiting`. A client asked to
    /// end gets [`GRACE`]; then it is killed. A stopped client (Ctrl+Z) is not waited for: the parent is in its
    /// process group, and stops and continues with it.
    pub(super) fn wait(pid: libc::pid_t, waiting: &libc::sigset_t) -> End {
        let mut deadline: Option<Instant> = None;
        loop {
            let mut status = 0;
            // SAFETY: polls this process's own child.
            match unsafe { libc::waitpid(pid, &mut status, libc::WNOHANG) } {
                0 => {}
                -1 if errno() == libc::EINTR => {}
                // Reaped, or gone: the signals that read `CLIENT` are blocked here, so none reaches a recycled PID.
                -1 => {
                    CLIENT.store(0, Ordering::Relaxed);
                    return End::Exit(1);
                }
                _ => {
                    CLIENT.store(0, Ordering::Relaxed);
                    return end(status);
                }
            }
            if ENDING.load(Ordering::Relaxed) == 0 {
                // SAFETY: waits for a signal with a valid mask; the blocked mask is back when it returns.
                unsafe { libc::sigsuspend(waiting) };
                continue;
            }
            let deadline = *deadline.get_or_insert_with(|| Instant::now() + GRACE);
            if Instant::now() >= deadline {
                // SAFETY: the child is not reaped yet, so `pid` is still it.
                unsafe { libc::kill(pid, libc::SIGKILL) };
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    /// How a client that ended with `status` ended.
    pub(super) fn end(status: libc::c_int) -> End {
        if libc::WIFSIGNALED(status) {
            let signal = libc::WTERMSIG(status);
            let code = (128 + signal).min(255);
            // Signals that end a process on request, not a fault.
            return match signal {
                libc::SIGINT | libc::SIGTERM | libc::SIGHUP | libc::SIGPIPE => End::Exit(code),
                _ => End::Crash(code),
            };
        }
        let code = libc::WEXITSTATUS(status);
        // The watchdog's exit, and a panic on the UI thread.
        match code {
            opencode_plugin::contain::watchdog::HUNG | 101 => End::Crash(code),
            _ => End::Exit(code),
        }
    }

    /// The terminal as the parent found it: its modes, and whether each standard descriptor was non-blocking.
    pub(super) struct Terminal {
        termios: Option<libc::termios>,
        flags: [libc::c_int; 3],
    }

    impl Terminal {
        pub(super) fn save() -> Terminal {
            // SAFETY: plain calls on the standard descriptors with valid structs.
            unsafe {
                let mut termios: libc::termios = std::mem::zeroed();
                let termios = (libc::isatty(0) == 1 && libc::tcgetattr(0, &mut termios) == 0).then_some(termios);
                Terminal { termios, flags: [0, 1, 2].map(|fd| libc::fcntl(fd, libc::F_GETFL)) }
            }
        }

        /// Puts back what a client that died could not: each descriptor's non-blocking flag as it was (the file
        /// descriptions outlive the client), and, while the parent's job owns the terminal, its modes, dropping the
        /// keys typed for a screen that is gone (an Enter among them would send the restored draft), and, after a
        /// client that took the terminal over, the modes of [`RESET`]. A job in the background leaves the terminal
        /// to the job that has it.
        pub(super) fn restore(&self, took: bool) {
            for (fd, saved) in self.flags.iter().enumerate() {
                // SAFETY: plain flag calls on the standard descriptors.
                unsafe {
                    let now = libc::fcntl(fd as libc::c_int, libc::F_GETFL);
                    if *saved >= 0 && now >= 0 && (now ^ saved) & libc::O_NONBLOCK != 0 {
                        libc::fcntl(
                            fd as libc::c_int,
                            libc::F_SETFL,
                            (now & !libc::O_NONBLOCK) | (saved & libc::O_NONBLOCK),
                        );
                    }
                }
            }
            // SAFETY: plain calls.
            if unsafe { libc::tcgetpgrp(0) != libc::getpgrp() } {
                return;
            }
            if let Some(mut termios) = self.termios {
                // A pending reprint of typed input (macOS) would echo the dropped keys.
                termios.c_lflag &= !libc::PENDIN;
                // SAFETY: a valid struct for the descriptor it came from.
                unsafe { libc::tcsetattr(0, libc::TCSAFLUSH, &termios) };
            }
            // SAFETY: plain call.
            if took && unsafe { libc::isatty(1) } == 1 {
                let _ = std::io::stdout().write_all(RESET.as_bytes()).and_then(|()| std::io::stdout().flush());
            }
        }
    }
}

#[cfg(windows)]
mod sys {
    #![allow(unsafe_code)]

    use std::ffi::{OsStr, OsString};
    use std::io::{IsTerminal, Write};
    use std::os::windows::io::{AsRawHandle, FromRawHandle};
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use std::time::Duration;

    use opencode_plugin::contain::Record;

    use super::{End, RECORD, RESET, Restart, Spawned};

    /// The client, for the console handler; 0 while none runs.
    static CLIENT: AtomicU32 = AtomicU32::new(0);
    /// The console closes, the user logs off or the system shuts down: the client is not restarted.
    static ENDING: AtomicBool = AtomicBool::new(false);
    /// `STATUS_CONTROL_C_EXIT`: the exit of a process that a console event ended, Ctrl+C or Ctrl+Break before its
    /// handler was set, or the console closing.
    const CONTROL_C_EXIT: u32 = 0xC000_013A;

    /// The parent is this binary again: a small binary of its own was not built (synthesis 4.5 prices both).
    pub fn supervise(raw: Vec<OsString>, restart: Restart) -> Result<Vec<OsString>, i32> {
        let Ok(exe) = std::env::current_exe() else { return Ok(raw) };
        // Before any client starts: Ctrl+C reaches every process on the console, and the client owns it; the end of
        // the session waits for the client's own teardown.
        if opencode_util::win::on_console_control(control).is_err() {
            return Ok(raw);
        }
        let job = opencode_util::win::KillOnCloseJob::new()
            .inspect_err(|error| log::warn!("plugin parent: no job for the client ({error})"))
            .ok();
        let mut windows = Windows { exe, job, modes: opencode_util::win::ConsoleModes::save(), client: None };
        super::supervise_with(&raw, &restart, &mut windows)
    }

    /// The record a spawned client inherited, by the value of its handle; no other process it starts gets it.
    pub(super) fn inherited(value: &OsStr) -> Option<Record> {
        let value: usize = value.to_str()?.parse().ok()?;
        // SAFETY: the parent made this handle inheritable for this process alone, and named it here; it is owned below
        // and nowhere else.
        let file = unsafe { std::fs::File::from_raw_handle(value as std::os::windows::io::RawHandle) };
        opencode_util::win::set_inheritable(&file, false).ok()?;
        Record::open(file).ok()
    }

    /// Handles a console event in the parent: Ctrl+C and Ctrl+Break are the client's; at the end of the session the
    /// parent waits for the client to finish its own teardown, then lets the system end it.
    fn control(event: u32) -> bool {
        if opencode_util::win::ends_session(event) {
            ENDING.store(true, Ordering::Relaxed);
            let pid = CLIENT.load(Ordering::Relaxed);
            if pid != 0 {
                opencode_util::win::wait_pid(pid, Duration::from_millis(4500));
            }
        }
        true
    }

    struct Windows {
        exe: std::path::PathBuf,
        /// Ends the client with the parent, however the parent ends.
        job: Option<opencode_util::win::KillOnCloseJob>,
        modes: opencode_util::win::ConsoleModes,
        client: Option<std::process::Child>,
    }

    impl super::System for Windows {
        fn record(&mut self) -> std::io::Result<Record> {
            Record::create(&opencode_plugin::contain::record::dir())
        }

        fn spawn(&mut self, args: &[OsString], record: &Arc<Record>) -> Spawned {
            if ENDING.load(Ordering::Relaxed) {
                return Spawned::Ending(1);
            }
            if opencode_util::win::set_inheritable(record.file(), true).is_err() {
                return Spawned::Failed;
            }
            let mut command = std::process::Command::new(&self.exe);
            command.args(&args[1..]).env(RECORD, (record.file().as_raw_handle() as usize).to_string());
            let spawned = command.spawn();
            let _ = opencode_util::win::set_inheritable(record.file(), false);
            let Ok(child) = spawned else { return Spawned::Failed };
            if let Some(job) = &self.job {
                let _ = job.assign(&child);
            }
            let pid = child.id();
            CLIENT.store(pid, Ordering::Relaxed);
            self.client = Some(child);
            Spawned::Started(pid)
        }

        fn wait(&mut self, _: u32) -> End {
            let status = self.client.take().and_then(|mut child| child.wait().ok());
            CLIENT.store(0, Ordering::Relaxed);
            match status.and_then(|status| status.code()) {
                Some(code) => end(code as u32),
                None => End::Exit(1),
            }
        }

        /// Escape sequences on first, so the reset is interpreted and not printed; then the modes as they were, and
        /// the input typed for the dead client dropped.
        fn restore(&mut self, took: bool) {
            if took && std::io::stdout().is_terminal() {
                self.modes.interpret_escapes();
                let _ = std::io::stdout().write_all(RESET.as_bytes()).and_then(|()| std::io::stdout().flush());
            }
            self.modes.restore();
        }

        fn ending(&self) -> bool {
            ENDING.load(Ordering::Relaxed)
        }
    }

    /// How a client that exited with `code` ended: an exception status (an access violation, a stack overflow, a
    /// fail-fast abort), `abort`'s 3, the watchdog's exit and a panic on the UI thread are crashes; a console event's
    /// end is the user's, as SIGINT is on Unix. The parent ends with the whole code.
    pub(super) fn end(code: u32) -> End {
        if code == CONTROL_C_EXIT {
            return End::Exit(code as i32);
        }
        let crash =
            code >= 0xC000_0000 || code == 3 || code == 101 || code as i32 == opencode_plugin::contain::watchdog::HUNG;
        if crash { End::Crash(code as i32) } else { End::Exit(code as i32) }
    }
}

#[cfg(test)]
mod tests;
