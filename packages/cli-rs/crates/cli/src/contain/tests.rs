use std::ffi::OsString;
use std::time::{Duration, Instant};

use opencode_plugin::contain::{Artifact, Snapshot, record};

use super::*;

fn os(args: &[&str]) -> Vec<OsString> {
    args.iter().map(OsString::from).collect()
}

fn fault(id: &str) -> Artifact {
    Artifact::external(id, &format!("/plugins/{id}"), "00000000deadbeef")
}

fn named(id: &str) -> Crash {
    Crash { artifact: Some(fault(id)), call: Some("render-slot".to_owned()), hang: false }
}

/// The parse of `args` as `main` does it.
fn parsed(args: &[OsString]) -> Box<crate::parse::Invocation> {
    let args: Vec<String> = args.iter().skip(1).map(|arg| arg.to_string_lossy().into_owned()).collect();
    match crate::parse::parse(&args, "opencode-native") {
        crate::parse::Outcome::Run(invocation) => invocation,
        _ => panic!("{args:?} does not run"),
    }
}

fn restart_of(args: &[OsString]) -> Restart {
    tui(args).unwrap()
}

#[test]
fn the_next_client_parses_to_the_first_without_its_prompt() {
    for line in [
        &["opencode-native", "--prompt", "hi", "-c", "/work", "--session=ses_old", "--auto"][..],
        &["opencode-native", "-cs", "ses_x", "--yolo"],
        &["opencode-native", "--continue", "false", "dir"],
        &["opencode-native", "--continue=true", "--standalone", "--log-level", "debug", "--print-logs"],
        &["opencode-native", "--server", "http://127.0.0.1:4096", "--", "--prompt"],
        &["opencode-native"],
    ] {
        let raw = os(line);
        let first = parsed(&raw);
        for session in [None, Some("ses_1")] {
            let next = arguments(&raw[0], &restart_of(&raw), session);
            let again = parsed(&next);
            let (a, b) = (&first.cli, &again.cli);
            assert_eq!(
                (b.root.directory.as_deref(), b.root.session.as_deref(), b.root.prompt.as_deref(), b.root.continue_),
                (a.root.directory.as_deref(), session, None, false),
                "{line:?} -> {next:?}"
            );
            assert_eq!(
                (b.root.permissions.auto(), b.global.print_logs, b.global.log_level),
                (a.root.permissions.auto(), a.global.print_logs, a.global.log_level),
                "{line:?}"
            );
            assert_eq!(
                (again.server.standalone, again.server.server.as_deref()),
                (first.server.standalone, first.server.server.as_deref()),
                "{line:?}"
            );
        }
    }
}

// Expected (4.5): at most 2 automatic restarts in 60 s; a third crash in that time stops the parent, and a crash
// 60 s after the first counts afresh.
#[test]
fn two_restarts_a_minute_then_the_parent_stops() {
    let start = Instant::now();
    let mut policy = Policy::default();
    assert!(policy.next(start, &named("a.one")).is_ok());
    assert!(policy.next(start + Duration::from_secs(30), &named("a.two")).is_ok());
    let stopped = policy.next(start + Duration::from_secs(59), &named("a.three"));
    assert_eq!(
        stopped,
        Err("opencode-native crashed 3 times in 60 s (last in plugin a.three); not restarting".to_owned())
    );
    let mut policy = Policy::default();
    for minute in 0..5 {
        assert!(policy.next(start + Duration::from_secs(61 * minute), &named("a.one")).is_ok(), "{minute}");
    }
}

#[test]
fn the_handoff_is_this_crash_and_safe_mode_follows_two_unnamed() {
    let start = Instant::now();
    let unnamed = Crash::default();
    let mut policy = Policy::default();
    assert_eq!(policy.next(start, &named("a.one")), Ok(Handoff { crash: Some(named("a.one")), safe: false }));
    assert_eq!(
        policy.next(start + Duration::from_secs(70), &named("a.two")),
        Ok(Handoff { crash: Some(named("a.two")), safe: false })
    );
    let safe = |policy: &mut Policy, at: u64| policy.next(start + Duration::from_secs(at), &unnamed).unwrap().safe;
    let mut policy = Policy::default();
    assert!(!safe(&mut policy, 0));
    assert!(safe(&mut policy, 599));
    assert!(safe(&mut policy, 1000), "within 10 minutes of the one before");
    let mut policy = Policy::default();
    assert!(!safe(&mut policy, 0));
    assert!(!safe(&mut policy, 600));
    let mut policy = Policy::default();
    policy.next(start, &named("a.one")).unwrap();
    assert!(!safe(&mut policy, 120));
}

/// A client of the fake system: what it does to its record before it ends, and how it ends.
struct Client {
    end: End,
    crash: Option<Crash>,
    snapshot: Option<Snapshot>,
    terminal: bool,
}

fn client(end: End) -> Client {
    Client { end, crash: None, snapshot: None, terminal: true }
}

#[derive(Default)]
struct Fake {
    dir: Option<opencode_util::temp::TempDir>,
    clients: Vec<Client>,
    started: Vec<(Vec<OsString>, Handoff, Option<Snapshot>)>,
    records: Vec<Arc<Record>>,
    restored: Vec<bool>,
    /// The parent is asked to end while client N runs.
    ending_at: Option<usize>,
    fail_records_from: Option<usize>,
    made: usize,
}

impl System for Fake {
    fn record(&mut self) -> io::Result<Record> {
        self.made += 1;
        if self.fail_records_from.is_some_and(|from| self.made >= from) {
            return Err(io::Error::other("no room"));
        }
        Record::create(self.dir.get_or_insert_with(|| opencode_util::temp::tempdir().unwrap()).path())
    }

    fn spawn(&mut self, args: &[OsString], record: &Arc<Record>) -> Spawned {
        if self.clients.is_empty() {
            return Spawned::Failed;
        }
        self.started.push((args.to_vec(), record.handoff(), record.snapshot()));
        self.records.push(record.clone());
        Spawned::Started(self.started.len() as u32)
    }

    fn wait(&mut self, _: u32) -> End {
        let client = self.clients.remove(0);
        let record = self.records.last().unwrap();
        if let Some(snapshot) = &client.snapshot {
            record.publish(snapshot);
        }
        if client.terminal {
            record.set_terminal();
        }
        if let Some(crash) = &client.crash
            && let Some(artifact) = &crash.artifact
        {
            record.name(0, artifact);
            record.enter(0, record::kind(crash.call.as_deref().unwrap_or("setup")), 0);
        }
        client.end
    }

    fn restore(&mut self, took: bool) {
        self.restored.push(took);
    }

    fn ending(&self) -> bool {
        self.ending_at.is_some_and(|at| self.started.len() >= at)
    }
}

fn snapshot(session: Option<&str>, draft: &str) -> Snapshot {
    Snapshot { session: session.map(str::to_owned), draft: draft.to_owned(), dropped: false }
}

#[test]
fn the_parent_restarts_after_a_crash_and_ends_with_the_client() {
    let raw = os(&["opencode-native", "--prompt", "hi"]);
    let mut fake = Fake {
        clients: vec![
            Client {
                crash: Some(named("a.one")),
                snapshot: Some(snapshot(Some("ses_1"), "half a thought")),
                ..client(End::Crash(139))
            },
            Client { terminal: false, ..client(End::Crash(134)) },
            client(End::Exit(7)),
        ],
        ..Fake::default()
    };
    assert_eq!(supervise_with(&raw, &restart_of(&raw), &mut fake), Err(7));
    assert_eq!(fake.restored, [true, false]);
    assert_eq!(fake.started[0], (raw.clone(), Handoff::default(), None));
    let kept = Some(snapshot(Some("ses_1"), "half a thought"));
    assert_eq!(
        fake.started[1],
        (
            os(&["opencode-native", "--session=ses_1"]),
            Handoff { crash: Some(named("a.one")), safe: false },
            kept.clone()
        )
    );
    assert_eq!(
        fake.started[2],
        (os(&["opencode-native", "--session=ses_1"]), Handoff { crash: Some(Crash::default()), safe: false }, kept)
    );
}

// Expected: after the limit of restarts the parent ends with the crash's code and starts nothing more, having put the
// terminal back each time.
#[test]
fn the_parent_stops_with_the_crash_code() {
    let raw = os(&["opencode-native"]);
    let mut fake = Fake { clients: (0..4).map(|_| client(End::Crash(134))).collect(), ..Fake::default() };
    assert_eq!(supervise_with(&raw, &restart_of(&raw), &mut fake), Err(134));
    assert_eq!((fake.started.len(), fake.restored.len()), (3, 3));
    assert!(fake.started[2].1.safe);
}

#[test]
fn a_parent_asked_to_end_restores_and_restarts_nothing() {
    let raw = os(&["opencode-native"]);
    let mut fake =
        Fake { clients: vec![client(End::Crash(75)), client(End::Exit(0))], ending_at: Some(1), ..Fake::default() };
    assert_eq!(supervise_with(&raw, &restart_of(&raw), &mut fake), Err(75));
    assert_eq!((fake.started.len(), fake.restored.as_slice()), (1, &[true][..]));
}

// Expected: a parent that cannot start its first client, or make its first record, runs the client itself, without a
// parent; one that cannot start or make a record for a later one ends with the crash.
#[test]
fn a_client_that_cannot_start() {
    let raw = os(&["opencode-native", "--prompt", "hi"]);
    let restart = restart_of(&raw);
    assert_eq!(supervise_with(&raw, &restart, &mut Fake::default()), Ok(raw.clone()));
    let mut fake = Fake { clients: vec![client(End::Exit(0))], fail_records_from: Some(1), ..Fake::default() };
    assert_eq!(supervise_with(&raw, &restart, &mut fake), Ok(raw.clone()));
    assert!(fake.started.is_empty());
    let mut fake = Fake { clients: vec![client(End::Crash(139))], ..Fake::default() };
    assert_eq!(supervise_with(&raw, &restart, &mut fake), Err(1));
    let mut fake = Fake {
        clients: vec![client(End::Crash(139)), client(End::Exit(0))],
        fail_records_from: Some(2),
        ..Fake::default()
    };
    assert_eq!(supervise_with(&raw, &restart, &mut fake), Err(139));
}

#[test]
fn only_the_tui_gets_a_parent() {
    let runs = |line: &[&str]| tui(&os(line)).is_some();
    let verdicts = [
        runs(&["opencode-native"]),
        runs(&["opencode-native", "/work", "-c"]),
        runs(&["opencode-native", "session", "list"]),
        runs(&["opencode-native", "--help"]),
        runs(&["opencode-native", "--version"]),
    ];
    assert_eq!(verdicts, [true, true, false, false, false]);
}

#[test]
fn plugin_dev_runs_under_a_parent_and_restarts_into_itself() {
    let runs = |line: &[&str]| tui(&os(line)).is_some();
    let verdicts = [
        runs(&["opencode-native", "plugin", "dev", "crate"]),
        runs(&["opencode-native", "plugin", "dev", "crate", "-c", "/work"]),
        runs(&["opencode-native", "plugin", "dev", "crate", "session", "list"]),
        runs(&["opencode-native", "plugin", "dev", "--help"]),
        runs(&["opencode-native", "plugin", "test", "lib.so"]),
    ];
    assert_eq!(verdicts, [true, true, false, false, false]);
    let raw = os(&["opencode-native", "plugin", "dev", "crate", "--prompt", "hi", "--auto", "--", "/work"]);
    if std::env::var(PARENT).as_deref() != Ok("0") {
        assert!(wanted(&raw).is_some_and(|restart| restart.dev == Some("crate".into())));
    }
    let next = arguments(&raw[0], &restart_of(&raw), Some("ses_1"));
    assert_eq!(next[..4], os(&["opencode-native", "plugin", "dev", "crate"])[..]);
    let again = parsed(&[&next[..1], &next[4..]].concat());
    assert_eq!(
        (again.cli.root.directory.as_deref(), again.cli.root.session.as_deref(), again.cli.root.prompt.as_deref()),
        (Some("/work"), Some("ses_1"), None)
    );
    assert!(again.cli.root.permissions.auto());
    assert_eq!(tui(&next).unwrap().dev, Some("crate".into()));
}

// Expected: how a client ended decides the restart. A fatal signal, a kill and the watchdog's and a panic's exit codes
// are crashes; a signal that asks a process to end, and any other exit code, are the parent's own end.
#[cfg(unix)]
#[test]
fn a_fault_is_a_crash_and_a_request_is_an_end() {
    let exited = |code: i32| code << 8;
    for (status, expected) in [
        (libc::SIGSEGV, End::Crash(139)),
        (libc::SIGABRT, End::Crash(134)),
        (libc::SIGKILL, End::Crash(137)),
        (libc::SIGBUS, End::Crash(128 + libc::SIGBUS)),
        (libc::SIGTERM, End::Exit(143)),
        (libc::SIGINT, End::Exit(130)),
        (libc::SIGHUP, End::Exit(129)),
        (exited(75), End::Crash(75)),
        (exited(101), End::Crash(101)),
        (exited(0), End::Exit(0)),
        (exited(1), End::Exit(1)),
        (exited(130), End::Exit(130)),
    ] {
        assert_eq!(sys::end(status), expected, "{status:#x}");
    }
}

/// Set in the process the next row starts: it runs a real parent.
#[cfg(unix)]
const PROBE: &str = "OPENCODE_CONTAIN_PROBE";

/// The signals the parent takes over and waits with, and the ones its client gets back.
#[cfg(unix)]
#[allow(unsafe_code)]
fn parent_signals() -> libc::sigset_t {
    // SAFETY: plain set operations on a valid, zeroed set.
    unsafe {
        let mut set: libc::sigset_t = std::mem::zeroed();
        libc::sigemptyset(&mut set);
        for signal in [libc::SIGTERM, libc::SIGHUP, libc::SIGCHLD] {
            libc::sigaddset(&mut set, signal);
        }
        set
    }
}

/// Runs a real parent in a process of its own (this test binary again, in row `row`), as its signal dispositions are
/// the process's; its client does as `mode` says, then waits. Returns the parent and its client's PID.
#[cfg(unix)]
#[allow(unsafe_code)]
fn real_parent(row: &str, mode: &str) -> (std::process::Child, libc::pid_t) {
    use std::io::BufRead;
    use std::os::unix::process::CommandExt;
    if let Ok(mode) = std::env::var(PROBE) {
        let raw = os(&["opencode-native"]);
        // A real parent runs before any thread starts, so its `sigsuspend` is the only wait a signal can break.
        // libtest runs this row on a thread of its own and keeps the process's main thread, which could take the
        // signal or the wake instead and leave the wait unbroken; the probe starts with them blocked (below), and
        // the thread that supervises gets the mask a real parent finds: none.
        // SAFETY: a mask and a disposition, in the probe's own process.
        unsafe {
            libc::pthread_sigmask(libc::SIG_UNBLOCK, &parent_signals(), std::ptr::null_mut());
            libc::signal(libc::SIGCHLD, libc::SIG_IGN);
        }
        match supervise_with(&raw, &restart_of(&raw), &mut sys::Unix::new()) {
            Ok(_) => {
                if mode == "lease" {
                    // As on a system with no death signal: only the lease tells the client.
                    #[cfg(target_os = "linux")]
                    // SAFETY: a process attribute of the client itself.
                    unsafe {
                        libc::prctl(libc::PR_SET_PDEATHSIG, 0)
                    };
                    let _ = super::record();
                }
                println!("client {}", std::process::id());
                loop {
                    std::thread::sleep(Duration::from_secs(1));
                }
            }
            Err(code) => std::process::exit(code),
        }
    }
    let mut command = std::process::Command::new(std::env::current_exe().unwrap());
    command
        .args([row, "--exact", "--nocapture", "--test-threads=1"])
        .env(PROBE, mode)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped());
    // Both of the probe's threads would take a signal a real parent's one thread takes alone, and one taken by
    // libtest's main thread never breaks the supervisor's wait. Start it as a real parent starts: with these blocked
    // everywhere, so the row can unblock them on the thread that supervises.
    // SAFETY: a mask, set in the child between fork and exec.
    unsafe {
        command.pre_exec(|| {
            libc::sigprocmask(libc::SIG_BLOCK, &parent_signals(), std::ptr::null_mut());
            Ok(())
        });
    }
    let mut probe = command.spawn().unwrap();
    let mut lines = std::io::BufReader::new(probe.stdout.take().unwrap()).lines();
    let client: libc::pid_t = loop {
        let line = lines.next().expect("the probe's client").unwrap();
        // libtest writes the test name first, on the same line.
        if let Some((_, pid)) = line.split_once("client ") {
            break pid.parse().unwrap();
        }
    };
    (probe, client)
}

/// Whether process `pid` ends within `limit`.
#[cfg(unix)]
#[allow(unsafe_code)]
fn ends(pid: libc::pid_t, limit: Duration) -> bool {
    let deadline = Instant::now() + limit;
    while Instant::now() < deadline {
        // SAFETY: a probe of a PID.
        if unsafe { libc::kill(pid, 0) } == -1 {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    // SAFETY: the probe's client, which is not this process.
    unsafe { libc::kill(pid, libc::SIGKILL) };
    false
}

#[cfg(unix)]
#[test]
fn a_client_ends_with_its_parent() {
    for mode in ["kill", "lease"] {
        let (mut probe, client) = real_parent("contain::tests::a_client_ends_with_its_parent", mode);
        probe.kill().unwrap();
        probe.wait().unwrap();
        assert!(ends(client, Duration::from_secs(15)), "{mode}: the client outlived its parent");
    }
}

#[cfg(unix)]
#[test]
#[allow(unsafe_code)]
fn a_real_parent_passes_a_term_on() {
    let (mut probe, client) = real_parent("contain::tests::a_real_parent_passes_a_term_on", "term");
    // SAFETY: a signal to the probe, this test's own child.
    unsafe { libc::kill(probe.id() as libc::pid_t, libc::SIGTERM) };
    let deadline = Instant::now() + Duration::from_secs(20);
    let status = loop {
        if let Some(status) = probe.try_wait().unwrap() {
            break status;
        }
        if Instant::now() > deadline {
            let _ = probe.kill();
            // SAFETY: the probe's client, which is not this process.
            unsafe { libc::kill(client, libc::SIGKILL) };
            panic!("the parent did not end: the client never got the signal");
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    assert_eq!(status.code(), Some(143));
    // SAFETY: a probe of a PID; the parent reaped its client, so nothing answers.
    assert_eq!(unsafe { libc::kill(client, 0) }, -1, "the client outlived its parent");
}

#[cfg(windows)]
#[test]
fn a_console_end_is_the_users_and_codes_stay_whole() {
    for (code, expected) in [
        (0xC000_0005u32, End::Crash(0xC000_0005u32 as i32)),
        (0xC000_00FD, End::Crash(0xC000_00FDu32 as i32)),
        (3, End::Crash(3)),
        (75, End::Crash(75)),
        (101, End::Crash(101)),
        (0xC000_013A, End::Exit(0xC000_013Au32 as i32)),
        (0, End::Exit(0)),
        (300, End::Exit(300)),
    ] {
        assert_eq!(sys::end(code), expected, "{code:#x}");
    }
}
