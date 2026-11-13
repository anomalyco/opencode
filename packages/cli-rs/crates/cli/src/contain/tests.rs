//! The parent's rules (synthesis 4.5), apart from real processes: which arguments the next client gets, when the
//! parent stops restarting, and the second-crash rule. `restart` with real processes is in the P-PTY scenarios.

use std::ffi::OsString;
use std::path::Path;
use std::time::{Duration, Instant};

use opencode_plugin::contain::{Left, Record, record};

use super::*;

fn os(args: &[&str]) -> Vec<OsString> {
    args.iter().map(OsString::from).collect()
}

fn named(id: &str, session: Option<&str>) -> Left {
    Left {
        plugin: Some(id.to_owned()),
        call: Some("render-slot".to_owned()),
        session: session.map(str::to_owned),
        ..Left::default()
    }
}

// Expected: the next client opens the record's session, gets no `--prompt` (the first client sent it), no `--continue`
// and no other `--session`, and a `--skip-plugin` for each plugin a crash named; what follows `--` stays last.
#[test]
fn the_next_client_resumes_the_session_and_skips_the_named_plugins() {
    let raw = os(&["opencode-native", "--prompt", "hi", "-c", "/work", "--session=ses_old", "--auto", "-s", "ses_x"]);
    assert_eq!(
        arguments(&raw, &["a.one".into()], Some("ses_1")),
        os(&["opencode-native", "/work", "--auto", "--session", "ses_1", "--skip-plugin", "a.one"])
    );
    let raw = os(&["opencode-native", "--skip-plugin", "a.one", "--prompt=hello", "--", "--prompt"]);
    assert_eq!(
        arguments(&raw, &["a.one".into(), "*".into()], None),
        os(&["opencode-native", "--skip-plugin", "a.one", "--skip-plugin", "*", "--", "--prompt"])
    );
    assert_eq!(arguments(&os(&["opencode-native", "--continue"]), &[], None), os(&["opencode-native"]));
}

// Expected (4.5): at most 2 automatic restarts in 60 s; a third crash in that time stops the parent, and a crash
// 60 s after the first counts afresh.
#[test]
fn two_restarts_a_minute_then_the_parent_stops() {
    let raw = os(&["opencode-native"]);
    let start = Instant::now();
    let mut policy = Policy::default();
    assert!(policy.next(start, &raw, &named("a.one", None)).is_ok());
    assert!(policy.next(start + Duration::from_secs(30), &raw, &named("a.two", None)).is_ok());
    let stopped = policy.next(start + Duration::from_secs(59), &raw, &named("a.three", None));
    assert_eq!(
        stopped,
        Err("opencode-native crashed 3 times in 60 s (last in plugin a.three); not restarting".to_owned())
    );
    let mut policy = Policy::default();
    for minute in 0..5 {
        assert!(policy.next(start + Duration::from_secs(61 * minute), &raw, &Left::default()).is_ok(), "{minute}");
    }
}

// Expected (4.5, the second-crash rule): a crash that names no plugin restarts normally; a second one within 10
// minutes starts with every external plugin off. One 10 minutes later is a first one again.
#[test]
fn a_second_unnamed_crash_in_ten_minutes_turns_every_external_plugin_off() {
    let raw = os(&["opencode-native"]);
    let start = Instant::now();
    let skips = |policy: &mut Policy, at: Duration| {
        let args = policy.next(start + at, &raw, &Left::default()).unwrap();
        args.iter().filter(|arg| *arg == "*").count()
    };
    let mut policy = Policy::default();
    assert_eq!(skips(&mut policy, Duration::ZERO), 0);
    assert_eq!(skips(&mut policy, Duration::from_secs(599)), 1);
    let mut policy = Policy::default();
    assert_eq!(skips(&mut policy, Duration::ZERO), 0);
    assert_eq!(skips(&mut policy, Duration::from_secs(600)), 0);
    // A named crash in between does not count as one.
    let mut policy = Policy::default();
    policy.next(start, &raw, &named("a.one", None)).unwrap();
    assert_eq!(skips(&mut policy, Duration::from_secs(120)), 0);
}

/// A client the fake loop starts: it writes a record as a client would, then ends with `end`.
struct Script {
    ends: Vec<(End, Option<Left>)>,
    spawned: Vec<(Vec<OsString>, Option<std::path::PathBuf>)>,
    restored: usize,
}

/// Runs the loop over fake clients numbered from `base` up: process IDs no real client has, one range a test, so the
/// records are the test's own.
fn run(raw: &[OsString], base: u32, ends: Vec<(End, Option<Left>)>) -> (Result<Vec<OsString>, ExitCode>, Script) {
    let script = std::cell::RefCell::new(Script { ends, spawned: Vec::new(), restored: 0 });
    let result = supervise_with(
        raw,
        |args, resume| {
            let mut script = script.borrow_mut();
            script.spawned.push((args.to_vec(), resume.map(Path::to_path_buf)));
            Spawned::Started(base + script.spawned.len() as u32)
        },
        |pid| {
            let mut script = script.borrow_mut();
            let (end, left) = script.ends.remove(0);
            if let Some(left) = left {
                let record = Record::create(&record::path(pid)).unwrap();
                record.name(0, left.plugin.as_deref().unwrap_or_default());
                record.set_session(left.session.as_deref());
                record.set_draft(left.draft.as_deref().unwrap_or_default());
                if left.plugin.is_some() {
                    record.enter(0, record::kind(left.call.as_deref().unwrap_or("setup")), 0);
                }
            }
            end
        },
        || script.borrow_mut().restored += 1,
    );
    (result, script.into_inner())
}

// Expected: a crash restores the terminal and starts the next client with the dead one's record to resume from; an
// ordinary exit ends the parent with the client's code, and every record is gone by then.
#[test]
fn the_parent_restarts_after_a_crash_and_ends_with_the_client() {
    let raw = os(&["opencode-native", "--prompt", "hi"]);
    let (result, script) = run(
        &raw,
        3_900_000_000,
        vec![(End::Crash(139), Some(named("a.one", Some("ses_1")))), (End::Exit(7), Some(Left::default()))],
    );
    assert_eq!(result, Err(ExitCode::from(7)));
    assert_eq!(script.restored, 1);
    assert_eq!(script.spawned.len(), 2);
    assert_eq!(script.spawned[0], (raw.clone(), None));
    assert_eq!(script.spawned[1].0, os(&["opencode-native", "--session", "ses_1", "--skip-plugin", "a.one"]));
    let resume = script.spawned[1].1.clone().unwrap();
    assert_eq!(resume, record::path(3_900_000_001));
    assert!(!resume.exists() && !record::path(3_900_000_002).exists());
}

// Expected: after the limit of restarts the parent ends with the crash's code and starts nothing more; a client that
// died without a record (a crash before the record existed) is restarted as unnamed.
#[test]
fn the_parent_stops_with_the_crash_code() {
    let raw = os(&["opencode-native"]);
    let crash = || (End::Crash(134), None);
    let (result, script) = run(&raw, 3_900_000_200, vec![crash(), crash(), crash()]);
    assert_eq!(result, Err(ExitCode::from(134)));
    assert_eq!((script.spawned.len(), script.restored), (3, 3));
    assert!(script.spawned[2].0.contains(&OsString::from("*")));
}

// Expected: a parent that cannot start its first client runs it itself; one that cannot start a later one fails.
#[test]
fn a_client_that_cannot_start() {
    let raw = os(&["opencode-native", "--prompt", "hi"]);
    let first = supervise_with(&raw, |_, _| Spawned::Failed, |_| End::Exit(0), || {});
    assert_eq!(first, Ok(raw.clone()));
    let mut spawned = 0;
    let later = supervise_with(
        &raw,
        |_, _| {
            spawned += 1;
            if spawned == 1 { Spawned::Started(3_900_000_100) } else { Spawned::Failed }
        },
        |_| End::Crash(139),
        || {},
    );
    assert_eq!(later, Err(ExitCode::FAILURE));
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
        (libc::SIGBUS, End::Crash(135)),
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
