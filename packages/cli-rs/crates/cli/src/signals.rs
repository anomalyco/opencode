//! Shutdown deadline and SIGHUP (`packages/cli/src/shutdown-deadline.ts`, `index.ts:102`).
//!
//! On SIGTERM or SIGINT the CLI runs its registered teardown steps (`on_shutdown`), newest first, and exits
//! with 130, as Effect's `runMain` does after an interrupt. Teardown gets 10 s; after that, or on a second
//! signal, it prints what is still pending to stderr and exits with 1. With a terminal on stdin or stdout,
//! SIGHUP counts as SIGTERM; without one (nohup, the background service) SIGHUP keeps its default, so nohup's
//! ignore still holds. While the TUI runs, opentui owns these signals and quits the app itself.

use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

/// After a signal, teardown gets this long before the process reports what it is stuck on and exits.
pub const DEADLINE: Duration = Duration::from_secs(10);

static SHUTDOWN: OnceLock<Arc<Shutdown>> = OnceLock::new();

/// Listens for the signals on a thread of its own. Call it once, before the command runs.
pub fn install() {
    let shutdown = SHUTDOWN
        .get_or_init(|| {
            Shutdown::new(
                DEADLINE,
                Arc::new(|code| {
                    crate::telemetry::flush();
                    std::process::exit(code)
                }),
                Arc::new(Mutex::new(std::io::stderr())),
            )
        })
        .clone();
    let hangup = {
        use std::io::IsTerminal;
        std::io::stdin().is_terminal() || std::io::stdout().is_terminal()
    };
    let _ = listen(shutdown, hangup);
}

/// Registers a teardown step that runs when a signal arrives; dropping the guard removes it. `label` names
/// the step in the report when it does not finish in time.
pub fn on_shutdown(label: impl Into<String>, step: impl FnOnce() + Send + 'static) -> Registration {
    let shutdown = SHUTDOWN.get().cloned();
    let id = shutdown.as_ref().map_or(0, |shutdown| shutdown.register(label.into(), Box::new(step)));
    Registration { shutdown, id }
}

/// Waits for a foreground child, which may own the terminal. On a signal, teardown sends it SIGTERM when
/// `stop` is set (`less` ignores SIGINT) and waits for it to exit before this process exits, as TS's
/// scoped `AppProcess` does, so the child restores the terminal first.
pub fn wait_child(
    label: impl Into<String>,
    mut child: std::process::Child,
    stop: bool,
) -> std::io::Result<std::process::ExitStatus> {
    let pid = child.id();
    let exited = Arc::new((Mutex::new(false), std::sync::Condvar::new()));
    let registration = on_shutdown(label, {
        let exited = exited.clone();
        move || {
            let done = lock(&exited.0);
            #[cfg(unix)]
            if stop
                && !*done
                && let Some(pid) = rustix::process::Pid::from_raw(pid as i32)
            {
                let _ = rustix::process::kill_process(pid, rustix::process::Signal::TERM);
            }
            #[cfg(not(unix))]
            let _ = (pid, stop);
            let _done = exited.1.wait_while(done, |done| !*done).unwrap_or_else(std::sync::PoisonError::into_inner);
        }
    });
    let status = child.wait();
    *lock(&exited.0) = true;
    exited.1.notify_all();
    drop(registration);
    // Teardown owns the exit once it started; returning would race it with the command's own exit code.
    while SHUTDOWN.get().is_some_and(|shutdown| shutdown.started.load(Ordering::SeqCst)) {
        std::thread::park();
    }
    status
}

#[cfg(unix)]
fn listen(shutdown: Arc<Shutdown>, hangup: bool) -> std::io::Result<()> {
    use tokio::signal::unix::{SignalKind, signal};

    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
    // Register on this thread, so a signal that arrives once the command starts is already handled.
    let (mut terminate, mut interrupt, mut hangup) = {
        let _guard = runtime.enter();
        (
            signal(SignalKind::terminate())?,
            signal(SignalKind::interrupt())?,
            hangup.then(|| signal(SignalKind::hangup())).transpose()?,
        )
    };
    std::thread::Builder::new().name("opencode-signals".into()).spawn(move || {
        runtime.block_on(async move {
            loop {
                let hangup = async {
                    match &mut hangup {
                        Some(hangup) => hangup.recv().await,
                        None => std::future::pending().await,
                    }
                };
                let name = tokio::select! {
                    _ = terminate.recv() => "SIGTERM",
                    _ = interrupt.recv() => "SIGINT",
                    // TS re-sends SIGHUP to itself as SIGTERM.
                    _ = hangup => "SIGTERM",
                };
                shutdown.signal(name);
            }
        });
    })?;
    Ok(())
}

#[cfg(not(unix))]
fn listen(shutdown: Arc<Shutdown>, _hangup: bool) -> std::io::Result<()> {
    let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build()?;
    std::thread::Builder::new().name("opencode-signals".into()).spawn(move || {
        runtime.block_on(async move {
            while tokio::signal::ctrl_c().await.is_ok() {
                shutdown.signal("SIGINT");
            }
        });
    })?;
    Ok(())
}

#[must_use = "dropping the registration removes the teardown step"]
pub struct Registration {
    shutdown: Option<Arc<Shutdown>>,
    id: u64,
}

impl Drop for Registration {
    fn drop(&mut self) {
        if let Some(shutdown) = &self.shutdown {
            shutdown.unregister(self.id);
        }
    }
}

type Step = Box<dyn FnOnce() + Send>;
type Exit = Arc<dyn Fn(i32) + Send + Sync>;
type Stderr = Arc<Mutex<dyn Write + Send>>;

pub struct Shutdown {
    deadline: Duration,
    exit: Exit,
    stderr: Stderr,
    next: AtomicU64,
    steps: Mutex<Vec<(u64, String, Step)>>,
    /// The teardown steps not finished yet, in run order, with the start of the running one.
    queue: Mutex<Vec<(String, Option<Instant>)>>,
    started: AtomicBool,
    done: AtomicBool,
}

impl Shutdown {
    pub fn new(deadline: Duration, exit: Exit, stderr: Stderr) -> Arc<Self> {
        Arc::new(Self {
            deadline,
            exit,
            stderr,
            next: AtomicU64::new(1),
            steps: Mutex::new(Vec::new()),
            queue: Mutex::new(Vec::new()),
            started: AtomicBool::new(false),
            done: AtomicBool::new(false),
        })
    }

    fn register(&self, label: String, step: Step) -> u64 {
        let id = self.next.fetch_add(1, Ordering::Relaxed);
        lock(&self.steps).push((id, label, step));
        id
    }

    fn unregister(&self, id: u64) {
        lock(&self.steps).retain(|(step, _, _)| *step != id);
    }

    /// Handles one signal: the first starts teardown and the deadline, a second reports and exits.
    pub fn signal(self: &Arc<Self>, name: &str) {
        if self.started.swap(true, Ordering::SeqCst) {
            self.report(&format!("received {name} again during shutdown"));
            (self.exit)(1);
            return;
        }
        log::info!(signal = name; "shutdown started");
        let steps: Vec<(String, Step)> =
            std::mem::take(&mut *lock(&self.steps)).into_iter().rev().map(|(_, label, step)| (label, step)).collect();
        *lock(&self.queue) = steps.iter().map(|(label, _)| (label.clone(), None)).collect();
        let teardown = self.clone();
        let _ = std::thread::Builder::new().name("opencode-shutdown".into()).spawn(move || {
            for (_, step) in steps {
                if let Some(first) = lock(&teardown.queue).first_mut() {
                    first.1 = Some(Instant::now());
                }
                step();
                lock(&teardown.queue).remove(0);
            }
            if !teardown.done.swap(true, Ordering::SeqCst) {
                (teardown.exit)(130);
            }
        });
        let timer = self.clone();
        let _ = std::thread::Builder::new().name("opencode-shutdown-deadline".into()).spawn(move || {
            std::thread::sleep(timer.deadline);
            if timer.done.swap(true, Ordering::SeqCst) {
                return;
            }
            let deadline = format_duration(timer.deadline);
            let pending = timer.pending();
            timer.report(&format!("shutdown did not finish within {deadline}"));
            log::error!(
                deadline = deadline.as_str(),
                pending = pending.join(", ").as_str();
                "shutdown deadline exceeded"
            );
            (timer.exit)(1);
        });
    }

    /// The running step and the steps after it, as `<label> for <ms>ms`, like `Teardown.pending()`.
    fn pending(&self) -> Vec<String> {
        self.pending_items()
            .into_iter()
            .map(|(label, elapsed)| format!("{label} for {}ms", elapsed.as_millis()))
            .collect()
    }

    fn pending_items(&self) -> Vec<(String, Duration)> {
        lock(&self.queue)
            .iter()
            .map(|(label, since)| (label.clone(), since.map_or(Duration::ZERO, |since| since.elapsed())))
            .collect()
    }

    fn report(&self, reason: &str) {
        let text = report(reason, &self.pending_items());
        let _ = lock(&self.stderr).write_all(text.as_bytes());
    }
}

/// The stderr report (`shutdown-deadline.ts:63-69`).
pub fn report(reason: &str, pending: &[(String, Duration)]) -> String {
    let lines = if pending.is_empty() {
        vec!["  nothing tracked; the stuck work is not a registered teardown step".to_owned()]
    } else {
        pending.iter().map(|(label, elapsed)| format!("  {:.1}s  {label}", elapsed.as_secs_f64())).collect()
    };
    format!("{reason}; exiting. Still pending:\n{}\n", lines.join("\n"))
}

/// Effect's `Duration.format` for the deadlines used here: whole seconds as `10s`, else milliseconds.
fn format_duration(duration: Duration) -> String {
    let millis = duration.as_millis();
    if millis.is_multiple_of(1000) {
        return format!("{}s", millis / 1000);
    }
    format!("{millis}ms")
}

fn lock<T: ?Sized>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc::{Receiver, channel};
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use super::{Shutdown, format_duration, report};

    struct Probe {
        shutdown: Arc<Shutdown>,
        exits: Receiver<i32>,
        stderr: Arc<Mutex<Vec<u8>>>,
    }

    fn probe(deadline: Duration) -> Probe {
        let (sender, exits) = channel();
        let sender = Mutex::new(sender);
        let stderr = Arc::new(Mutex::new(Vec::new()));
        let shutdown = Shutdown::new(
            deadline,
            Arc::new(move |code| {
                let _ = sender.lock().unwrap().send(code);
            }),
            stderr.clone(),
        );
        Probe { shutdown, exits, stderr }
    }

    fn text(probe: &Probe) -> String {
        String::from_utf8(probe.stderr.lock().unwrap().clone()).unwrap()
    }

    #[test]
    fn a_signal_runs_the_steps_newest_first_and_exits_130() {
        let probe = probe(Duration::from_secs(10));
        let order = Arc::new(Mutex::new(Vec::new()));
        let step = |name: &'static str| {
            let order = order.clone();
            Box::new(move || order.lock().unwrap().push(name))
        };
        probe.shutdown.register("first".into(), step("first"));
        let removed = probe.shutdown.register("removed".into(), step("removed"));
        probe.shutdown.register("last".into(), step("last"));
        probe.shutdown.unregister(removed);
        probe.shutdown.signal("SIGTERM");
        assert_eq!(probe.exits.recv_timeout(Duration::from_secs(5)), Ok(130));
        assert_eq!(*order.lock().unwrap(), ["last", "first"]);
        assert_eq!(text(&probe), "");
    }

    #[test]
    fn a_stuck_step_is_reported_at_the_deadline() {
        let probe = probe(Duration::from_millis(100));
        let (release, wait) = channel::<()>();
        probe.shutdown.register(
            "standalone server".into(),
            Box::new(move || {
                let _ = wait.recv();
            }),
        );
        probe.shutdown.register(
            "stuck flush".into(),
            Box::new(move || {
                std::thread::sleep(Duration::from_secs(60));
            }),
        );
        probe.shutdown.signal("SIGINT");
        assert_eq!(probe.exits.recv_timeout(Duration::from_secs(5)), Ok(1));
        let report = text(&probe);
        let lines: Vec<&str> = report.lines().collect();
        assert_eq!(lines[0], "shutdown did not finish within 100ms; exiting. Still pending:");
        assert!(lines[1].starts_with("  0.1s  stuck flush"), "{report}");
        assert_eq!(lines[2], "  0.0s  standalone server");
        assert_eq!(lines.len(), 3);
        drop(release);
        // The teardown finishing after the deadline does not exit a second time.
        assert!(probe.exits.recv_timeout(Duration::from_millis(200)).is_err());
    }

    #[test]
    fn a_second_signal_reports_and_exits_at_once() {
        let probe = probe(Duration::from_secs(10));
        probe.shutdown.register(
            "stuck".into(),
            Box::new(|| {
                std::thread::sleep(Duration::from_secs(60));
            }),
        );
        probe.shutdown.signal("SIGTERM");
        std::thread::sleep(Duration::from_millis(50));
        probe.shutdown.signal("SIGINT");
        assert_eq!(probe.exits.recv_timeout(Duration::from_secs(5)), Ok(1));
        let report = text(&probe);
        assert!(
            report.starts_with("received SIGINT again during shutdown; exiting. Still pending:\n  0.0s  stuck\n")
                || report
                    .starts_with("received SIGINT again during shutdown; exiting. Still pending:\n  0.1s  stuck\n"),
            "{report}"
        );
    }

    #[test]
    fn the_report_says_when_nothing_is_tracked() {
        assert_eq!(
            report("received SIGTERM again during shutdown", &[]),
            "received SIGTERM again during shutdown; exiting. Still pending:\n  nothing tracked; the stuck work is not a registered teardown step\n"
        );
        assert_eq!(format_duration(Duration::from_secs(10)), "10s");
        assert_eq!(format_duration(Duration::from_millis(1500)), "1500ms");
    }
}
