//! The cases of `packages/client/test/service.test.ts`, run against the same fake service
//! (`packages/client/test/fixture/service.ts` under `bun`) with the same accelerated timing. Cases
//! where TS replaces a service assert the Rust policy instead (docs/F.9.md): the service is used,
//! or left running. Every file lives in a temporary directory, and every process a test starts is
//! killed when its fixture drops. Without `bun` the tests pass with a note.
#![cfg(unix)]

use opencode_api::transport::{Reqwest, Transport};
use opencode_local::paths::Paths;
use opencode_service::connect::{self, Connection, Env};
use opencode_service::contender::Delays;
use opencode_service::ensure::{self, Ensured, Options, Timing};
use opencode_service::stop::{self, Poll, Pty};
use opencode_service::ts_command::{TsCommand, write_script};
use opencode_service::{handoff, standalone};
use rustix::process::{Pid, Signal, kill_process, test_kill_process};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

fn fixture_script() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../client/test/fixture/service.ts")
}

fn bun() -> bool {
    let found =
        Command::new("bun").arg("--version").stdout(Stdio::null()).status().is_ok_and(|status| status.success());
    if !found {
        assert!(
            std::env::var_os("OPENCODE_RS_REQUIRE_TS").is_none(),
            "OPENCODE_RS_REQUIRE_TS is set, but skipped: bun is not on PATH"
        );
        eprintln!("skipped: bun is not on PATH");
    }
    found
}

// `accelerate` (`packages/client/test/fixture/service-timing.ts`).
fn fast() -> Timing {
    Timing {
        poll: Duration::from_millis(20),
        request: Duration::from_millis(100),
        delays: Delays { spawn: Duration::from_millis(200), max_spawn: Duration::from_millis(1_200) },
        deadline: Duration::from_millis(3_000),
        stop: Poll { interval: Duration::from_millis(5), attempts: 100 },
    }
}

// The exit code of a reaped child: `None` while it runs, `Some(None)` when a signal ended it.
type Exit = Arc<Mutex<Option<Option<i32>>>>;

struct Fixture {
    dir: opencode_util::temp::TempDir,
    registration: PathBuf,
    // Reaped by a thread each, as Bun reaps its children: the exit code once it exited.
    children: Vec<(u32, Exit)>,
    pids: Vec<u32>,
}

impl Fixture {
    fn new() -> Self {
        let dir = opencode_util::temp::tempdir().unwrap();
        let registration = dir.path().join("service.json");
        Self { dir, registration, children: Vec::new(), pids: Vec::new() }
    }

    fn command_for(&self, registration: &Path, mode: &str, args: &[&str]) -> Vec<OsString> {
        [OsString::from("bun"), fixture_script().into(), registration.into(), mode.into()]
            .into_iter()
            .chain(args.iter().map(OsString::from))
            .collect()
    }

    fn command(&self, mode: &str, args: &[&str]) -> Vec<OsString> {
        self.command_for(&self.registration, mode, args)
    }

    fn options(&self, command: Vec<OsString>) -> Options {
        Options {
            file: self.registration.clone(),
            state: self.dir.path().to_owned(),
            command,
            env: Vec::new(),
            version: None,
            timing: fast(),
        }
    }

    fn spawn(&mut self, mode: &str, args: &[&str]) -> u32 {
        let command = self.command(mode, args);
        self.start(Command::new(&command[0]).args(&command[1..]))
    }

    // The service's parent execs `sleep`, which never reaps it, so SIGKILL leaves a zombie that
    // still answers `kill(pid, 0)`.
    fn spawn_unreaped(&mut self, mode: &str, args: &[&str]) -> u32 {
        let command = self.command(mode, args);
        self.start(Command::new("sh").args(["-c", "\"$@\" & exec sleep 60", "sh"]).args(&command))
    }

    fn start(&mut self, command: &mut Command) -> u32 {
        let mut child = command.stdout(Stdio::null()).spawn().unwrap();
        let pid = child.id();
        let exit = Arc::new(Mutex::new(None));
        let reaped = exit.clone();
        std::thread::spawn(move || {
            let code = child.wait().ok().and_then(|status| status.code());
            *reaped.lock().unwrap() = Some(code);
        });
        self.children.push((pid, exit));
        pid
    }

    fn exit(&self, pid: u32) -> Option<Option<Option<i32>>> {
        let (_, exit) = self.children.iter().find(|(child, _)| *child == pid)?;
        Some(*exit.lock().unwrap())
    }

    fn file(&self, suffix: &str) -> PathBuf {
        let mut name = self.registration.clone().into_os_string();
        name.push(suffix);
        PathBuf::from(name)
    }

    fn info(&self) -> serde_json::Value {
        serde_json::from_str(&std::fs::read_to_string(&self.registration).unwrap()).unwrap()
    }

    fn pid(&self) -> u32 {
        self.info()["pid"].as_u64().unwrap() as u32
    }

    fn starts(&self) -> Vec<u32> {
        std::fs::read_to_string(self.file(".starts"))
            .unwrap_or_default()
            .lines()
            .filter_map(|line| line.trim().parse().ok())
            .collect()
    }

    async fn wait_for_file(&self, file: &Path) {
        until(|| file.exists(), &format!("{}", file.display())).await;
    }

    async fn wait_for_starts(&self, count: usize) -> Vec<u32> {
        until(|| self.starts().len() >= count, "contenders").await;
        self.starts()
    }

    async fn release(&self, pid: u32, action: &str) {
        let file = self.file(&format!(".release-{pid}"));
        let mut temporary = file.clone().into_os_string();
        temporary.push(".tmp");
        std::fs::write(&temporary, action).unwrap();
        std::fs::rename(&temporary, &file).unwrap();
        if action == "fail" {
            until(|| !alive(pid), "exit").await;
        }
    }

    // The exit code of a process the fixture started, waiting for it.
    async fn exited(&mut self, pid: u32) -> Option<i32> {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            if let Some(code) = self.exit(pid)? {
                return code;
            }
            assert!(Instant::now() < deadline, "process {pid} did not exit");
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    }

    fn running(&mut self, pid: u32) -> bool {
        match self.exit(pid) {
            Some(exit) => exit.is_none(),
            None => alive(pid),
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        // Detached contenders that never registered are in `.starts`.
        let pids: Vec<u32> = self
            .starts()
            .into_iter()
            .chain(self.pids.iter().copied())
            .chain(self.children.iter().map(|(pid, _)| *pid))
            .chain(std::fs::read_to_string(&self.registration).ok().and_then(|text| {
                serde_json::from_str::<serde_json::Value>(&text).ok()?["pid"].as_u64().map(|pid| pid as u32)
            }))
            .chain(named(self.dir.path()))
            .collect();
        for pid in &pids {
            signal(*pid, Signal::KILL);
        }
    }
}

// Processes whose command line names `dir`: contenders `ensure` started that no file recorded.
fn named(dir: &Path) -> Vec<u32> {
    let needle = dir.as_os_str().as_encoded_bytes();
    std::fs::read_dir("/proc")
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let pid: u32 = entry.file_name().to_str()?.parse().ok()?;
            let cmdline = std::fs::read(entry.path().join("cmdline")).ok()?;
            cmdline.windows(needle.len()).any(|window| window == needle).then_some(pid)
        })
        .collect()
}

fn signal(pid: u32, signal: Signal) {
    if let Some(pid) = Pid::from_raw(pid as i32) {
        let _ = kill_process(pid, signal);
    }
}

fn alive(pid: u32) -> bool {
    Pid::from_raw(pid as i32).is_some_and(|pid| test_kill_process(pid).is_ok())
}

async fn until(mut ready: impl FnMut() -> bool, what: &str) {
    for _ in 0..600 {
        if ready() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    panic!("timed out waiting for {what}");
}

fn transport() -> Arc<dyn Transport> {
    Arc::new(Reqwest::default())
}

async fn run(options: &Options) -> Result<Ensured, ensure::Error> {
    ensure::ensure(transport(), options, &mut |_| {}).await
}

async fn run_counting(options: &Options) -> (Result<Ensured, ensure::Error>, usize) {
    let (result, reasons) = run_reasons(options).await;
    (result, reasons.len())
}

async fn run_reasons(options: &Options) -> (Result<Ensured, ensure::Error>, Vec<ensure::Reason>) {
    let mut reasons = Vec::new();
    let result = ensure::ensure(transport(), options, &mut |reason| reasons.push(reason)).await;
    (result, reasons)
}

async fn status(url: &str) -> serde_json::Value {
    let request = opencode_api::transport::http_client()
        .get(format!("{}/api/info", url.trim_end_matches('/')))
        .basic_auth("opencode", Some("private"))
        .timeout(Duration::from_secs(1));
    opencode_api::transport::fetch(request).await.unwrap().json().await.unwrap()
}

macro_rules! needs_bun {
    () => {
        if !bun() {
            return;
        }
    };
}

#[tokio::test(flavor = "multi_thread")]
async fn a_concurrent_start_cannot_invalidate_a_resolved_endpoint() {
    needs_bun!();
    let mut fixture = Fixture::new();
    fixture.spawn("modern", &[]);
    fixture.wait_for_file(&fixture.registration).await;
    let original = fixture.info();
    let first_options = fixture.options(Vec::new());
    let first = tokio::spawn(async move { run_counting(&first_options).await });
    fixture.wait_for_file(&fixture.file(".first-request")).await;
    let resolved = run(&fixture.options(Vec::new())).await.unwrap();
    assert_eq!(resolved.service.endpoint.url, original["url"]);
    std::fs::write(fixture.file(".release"), "").unwrap();
    let (first, starts) = first.await.unwrap();
    first.unwrap();
    assert_eq!(starts, 0);
    assert_eq!(fixture.info(), original);
}

#[tokio::test(flavor = "multi_thread")]
async fn reuses_a_registered_service() {
    needs_bun!();
    let mut fixture = Fixture::new();
    let existing = fixture.spawn("compatible", &[]);
    fixture.wait_for_file(&fixture.registration).await;
    let (endpoint, starts) = run_counting(&fixture.options(Vec::new())).await;
    assert_eq!(endpoint.unwrap().service.endpoint.url, fixture.info()["url"]);
    assert_eq!(starts, 0);
    assert!(fixture.running(existing));
}

// Expected (O-167): with a version required, as TS's `replaces an incompatible registered service`: the service of
// another version is stopped and replaced, announced once as a version mismatch from its version.
#[tokio::test(flavor = "multi_thread")]
async fn replaces_a_service_of_another_version_when_a_version_is_required() {
    needs_bun!();
    let mut fixture = Fixture::new();
    let existing = fixture.spawn("incompatible", &[]);
    fixture.wait_for_file(&fixture.registration).await;
    let mut options = fixture.options(fixture.command("delayed-compatible", &["10"]));
    options.version = Some("2.1.0-next.1".to_owned());
    let (ensured, reasons) = run_reasons(&options).await;
    let ensured = ensured.unwrap();
    fixture.pids.push(ensured.service.registration.pid);
    fixture.exited(existing).await;
    assert_eq!(ensured.service.version.as_deref(), Some("2.1.0-next.1"));
    assert_eq!(ensured.service.endpoint.url, fixture.info()["url"]);
    assert_eq!(reasons, [ensure::Reason::VersionMismatch { previous: Some("1.9.0".to_owned()) }]);
}

// Expected (O-167): a service of the required version is reused; one this call started is used whatever its version,
// so a TS binary of another version than required is not replaced in a loop.
#[tokio::test(flavor = "multi_thread")]
async fn a_required_version_reuses_its_service_and_takes_what_it_started() {
    needs_bun!();
    let mut fixture = Fixture::new();
    let existing = fixture.spawn("compatible", &[]);
    fixture.wait_for_file(&fixture.registration).await;
    let mut options = fixture.options(fixture.command("delayed-compatible", &["10"]));
    options.version = Some("2.1.0-next.1".to_owned());
    let (ensured, reasons) = run_reasons(&options).await;
    assert_eq!(ensured.unwrap().service.registration.pid, existing);
    assert!(reasons.is_empty() && fixture.starts().is_empty());
    assert!(fixture.running(existing));
    options.version = Some("3.0.0".to_owned());
    let (ensured, reasons) = run_reasons(&options).await;
    let ensured = ensured.unwrap();
    fixture.pids.push(ensured.service.registration.pid);
    assert_eq!(ensured.service.version.as_deref(), Some("2.1.0-next.1"));
    assert_ne!(ensured.service.registration.pid, existing);
    assert_eq!(reasons.len(), 1);
}

// TS replaces a service of another version (`replaces an incompatible registered service`,
// `signals an incompatible service before starting its replacement`). Without a required version, Rust uses it.
#[tokio::test(flavor = "multi_thread")]
async fn uses_a_service_of_another_version_and_leaves_it_running() {
    needs_bun!();
    let mut fixture = Fixture::new();
    let existing = fixture.spawn("incompatible", &[]);
    fixture.wait_for_file(&fixture.registration).await;
    let (ensured, starts) = run_counting(&fixture.options(fixture.command("delayed-compatible", &["10"]))).await;
    let ensured = ensured.unwrap();
    assert_eq!(ensured.service.version.as_deref(), Some("1.9.0"));
    assert_eq!(starts, 0);
    assert!(fixture.starts().is_empty());
    assert!(fixture.running(existing));
}

#[tokio::test(flavor = "multi_thread")]
async fn adds_configured_environment_variables_when_starting_a_service() {
    needs_bun!();
    let mut fixture = Fixture::new();
    let mut options = fixture.options(fixture.command("environment", &[]));
    options.env = vec![("OPENCODE_SERVICE_ENV_TEST".to_owned(), "configured".to_owned())];
    let ensured = run(&options).await.unwrap();
    fixture.pids.push(fixture.pid());
    assert_eq!(ensured.service.endpoint.url, fixture.info()["url"]);
    assert_eq!(std::fs::read_to_string(fixture.file(".environment")).unwrap(), "configured");
    assert_eq!(std::fs::read_to_string(fixture.file(".handoff")).unwrap(), "null");
}

#[tokio::test(flavor = "multi_thread")]
async fn waits_for_a_registered_service_to_finish_starting() {
    needs_bun!();
    let mut fixture = Fixture::new();
    let process = fixture.spawn("starting", &[]);
    fixture.wait_for_file(&fixture.registration).await;
    let options = fixture.options(Vec::new());
    let result = tokio::spawn(async move { run(&options).await });
    fixture.wait_for_file(&fixture.file(".status-request")).await;
    assert!(fixture.running(process));
    std::fs::write(fixture.file(".release"), "").unwrap();
    assert_eq!(result.await.unwrap().unwrap().service.endpoint.url, fixture.info()["url"]);
}

#[tokio::test(flavor = "multi_thread")]
async fn recovers_when_the_starting_service_it_waits_for_is_stopped() {
    needs_bun!();
    let mut fixture = Fixture::new();
    let starting = fixture.spawn("starting", &[]);
    fixture.wait_for_file(&fixture.registration).await;
    let options = fixture.options(fixture.command("delayed", &["10"]));
    let result = tokio::spawn(async move { run(&options).await });
    fixture.wait_for_file(&fixture.file(".status-request")).await;
    stop::stop(transport(), &fixture.registration, Pty::Clear, fast().stop).await.unwrap();
    let ensured = result.await.unwrap().unwrap();
    let replacement = fixture.pid();
    fixture.pids.push(replacement);
    assert_eq!(fixture.exited(starting).await, Some(0));
    assert_ne!(replacement, starting);
    assert_eq!(ensured.service.endpoint.url, fixture.info()["url"]);
}

#[tokio::test(flavor = "multi_thread")]
async fn starts_a_service_when_the_registration_names_a_dead_process() {
    needs_bun!();
    let mut fixture = Fixture::new();
    let crashed = fixture.spawn("graceful", &[]);
    fixture.wait_for_file(&fixture.registration).await;
    signal(crashed, Signal::KILL);
    fixture.exited(crashed).await;
    let (ensured, starts) = run_counting(&fixture.options(fixture.command("delayed", &["10"]))).await;
    let replacement = fixture.pid();
    fixture.pids.push(replacement);
    assert_ne!(replacement, crashed);
    assert_eq!(ensured.unwrap().service.endpoint.url, fixture.info()["url"]);
    assert_eq!(starts, 1);
}

#[tokio::test(flavor = "multi_thread")]
async fn reports_a_failed_registered_service_without_spawning() {
    needs_bun!();
    let mut fixture = Fixture::new();
    let process = fixture.spawn("failed-owner", &[]);
    fixture.wait_for_file(&fixture.registration).await;
    let error = run(&fixture.options(Vec::new())).await.unwrap_err();
    assert_eq!(error.to_string(), "Background service failed to start");
    assert!(fixture.running(process));
}

// TS stops an unresponsive service and starts another
// (`evicts an unresponsive registered service before starting its replacement`). Rust did not
// start it, so it leaves it running and says so.
#[tokio::test(flavor = "multi_thread")]
async fn leaves_an_unresponsive_service_it_did_not_start_running() {
    needs_bun!();
    let mut fixture = Fixture::new();
    let existing = fixture.spawn("hanging", &[]);
    fixture.wait_for_file(&fixture.registration).await;
    let error = run(&fixture.options(fixture.command("delayed", &["10"]))).await.unwrap_err().to_string();
    assert!(error.contains("is not responding"), "{error}");
    assert!(error.contains(&format!("(pid {existing})")), "{error}");
    // The fake service logs a request after it arrives; the third may still be on its way.
    let requests = || std::fs::read_to_string(fixture.file(".requests")).unwrap_or_default().lines().count();
    until(|| requests() >= 3, "three requests").await;
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(requests(), 3);
    assert!(fixture.running(existing));
    assert!(fixture.registration.exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn stop_signals_an_unresponsive_registered_service() {
    needs_bun!();
    let mut fixture = Fixture::new();
    let process = fixture.spawn("hanging", &[]);
    fixture.wait_for_file(&fixture.registration).await;
    stop::stop(transport(), &fixture.registration, Pty::Clear, Poll::default()).await.unwrap();
    fixture.exited(process).await;
    assert_eq!(std::fs::read_to_string(fixture.file(".signal")).unwrap(), "SIGTERM");
    assert!(!fixture.registration.exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn stop_escalates_when_the_registration_disappears_before_the_process_exits() {
    needs_bun!();
    let mut fixture = Fixture::new();
    let existing = fixture.spawn("lingering", &["5000"]);
    fixture.wait_for_file(&fixture.registration).await;
    let pid = fixture.pid();
    stop::stop(transport(), &fixture.registration, Pty::Clear, fast().stop).await.unwrap();
    assert_eq!(std::fs::read_to_string(fixture.file(".signal")).unwrap(), "SIGTERM");
    fixture.exited(existing).await;
    assert!(!alive(pid));
    assert!(!fixture.registration.exists());
}

#[tokio::test(flavor = "multi_thread")]
async fn stop_fails_when_the_process_survives_sigkill() {
    needs_bun!();
    let mut fixture = Fixture::new();
    fixture.spawn_unreaped("lingering", &["60000"]);
    fixture.wait_for_file(&fixture.registration).await;
    let pid = fixture.pid();
    let error = stop::stop(transport(), &fixture.registration, Pty::Clear, fast().stop).await.unwrap_err();
    assert_eq!(error.to_string(), format!("Server process {pid} is still running"));
    assert_eq!(std::fs::read_to_string(fixture.file(".signal")).unwrap(), "SIGTERM");
}

#[tokio::test(flavor = "multi_thread")]
async fn stop_waits_for_the_original_process_while_preserving_a_newly_registered_successor() {
    needs_bun!();
    let mut fixture = Fixture::new();
    let existing = fixture.spawn("lingering", &["15000"]);
    fixture.wait_for_file(&fixture.registration).await;
    let original = fixture.info();
    let file = fixture.registration.clone();
    // Default timing keeps the grace period open long enough for the successor to register first.
    let stopping = tokio::spawn(async move { stop::stop(transport(), &file, Pty::Clear, Poll::default()).await });
    fixture.wait_for_file(&fixture.file(".unregistered")).await;
    let successor = fixture.spawn("graceful", &[]);
    fixture.wait_for_file(&fixture.registration).await;
    let replacement = fixture.info();
    assert!(fixture.running(existing));
    assert_eq!(replacement["pid"], successor);
    stopping.await.unwrap().unwrap();
    assert!(!alive(original["pid"].as_u64().unwrap() as u32));
    assert_eq!(fixture.info(), replacement);
    assert_eq!(status(replacement["url"].as_str().unwrap()).await["pid"], successor);
    assert!(fixture.running(successor));
}

// A stale registration whose pid now belongs to another process: `stop` must not signal it.
#[tokio::test(flavor = "multi_thread")]
async fn stop_refuses_a_registered_pid_that_another_process_reused() {
    let fixture = Fixture::new();
    let mut other = Command::new("sleep").arg("600").spawn().unwrap();
    std::fs::write(&fixture.registration, format!(r#"{{"url":"http://127.0.0.1:1","pid":{}}}"#, other.id())).unwrap();
    // The server registers after it starts; this file predates the process.
    let file = std::fs::File::options().write(true).open(&fixture.registration).unwrap();
    file.set_modified(std::time::SystemTime::now() - Duration::from_secs(3600)).unwrap();
    let error = stop::stop(transport(), &fixture.registration, Pty::Clear, fast().stop).await.unwrap_err();
    assert!(other.try_wait().unwrap().is_none(), "the other process was signalled");
    assert!(error.to_string().contains("is not the OpenCode server"), "{error}");
    assert!(fixture.registration.exists());
    other.kill().unwrap();
    other.wait().unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn waits_for_a_slow_winner_while_bounding_lock_probes() {
    needs_bun!();
    let mut fixture = Fixture::new();
    let ensured = run(&fixture.options(fixture.command("coordinated", &[]))).await.unwrap();
    fixture.pids.push(fixture.pid());
    assert_eq!(ensured.service.endpoint.url, fixture.info()["url"]);
    assert_eq!(fixture.starts().len(), 2);
}

#[tokio::test(flavor = "multi_thread")]
async fn waits_for_a_live_contender_when_another_contender_fails() {
    needs_bun!();
    let mut fixture = Fixture::new();
    let ensured = run(&fixture.options(fixture.command("coordinated-failed-loser", &["300"]))).await.unwrap();
    fixture.pids.push(fixture.pid());
    assert_eq!(ensured.service.endpoint.url, fixture.info()["url"]);
}

#[tokio::test(flavor = "multi_thread")]
async fn reports_a_contender_that_fails_to_start() {
    needs_bun!();
    let fixture = Fixture::new();
    let error = run(&fixture.options(fixture.command("failed", &[]))).await.unwrap_err().to_string();
    assert!(error.contains("Server process exited with code 1"), "{error}");
}

#[tokio::test(flavor = "multi_thread")]
async fn reports_a_missing_typescript_binary_at_once() {
    let fixture = Fixture::new();
    let error = run(&fixture.options(vec!["/nonexistent/opencode".into()])).await.unwrap_err().to_string();
    assert!(error.starts_with("Failed to start server: /nonexistent/opencode: "), "{error}");
    assert!(error.contains("OPENCODE_TS_BIN"), "{error}");
}

#[tokio::test(flavor = "multi_thread")]
async fn reports_overlapping_contender_failures_without_recruiting_replacements() {
    needs_bun!();
    let fixture = Fixture::new();
    let started = Instant::now();
    let options = fixture.options(fixture.command("controlled", &[]));
    let pending = tokio::spawn(async move { run(&options).await });
    let starts = fixture.wait_for_starts(2).await;
    fixture.release(starts[0], "fail").await;
    // Let ensure see the exit across two spawn windows before the survivor exits.
    tokio::time::sleep(Duration::from_millis(450)).await;
    fixture.release(starts[1], "fail").await;
    let error = pending.await.unwrap().unwrap_err().to_string();
    assert!(started.elapsed() < Duration::from_secs(3));
    assert!(error.contains("Server process exited with code 23"), "{error}");
    assert!(error.contains("storage initialization denied"), "{error}");
    assert_eq!(fixture.starts().len(), 2);
}

#[tokio::test(flavor = "multi_thread")]
async fn retains_a_contender_failure_until_the_deadline_while_its_survivor_stalls() {
    needs_bun!();
    let fixture = Fixture::new();
    let started = Instant::now();
    let options = fixture.options(fixture.command("controlled", &[]));
    let pending = tokio::spawn(async move { run(&options).await });
    let starts = fixture.wait_for_starts(2).await;
    fixture.release(starts[0], "fail").await;
    let error = pending.await.unwrap().unwrap_err().to_string();
    assert!(started.elapsed() >= Duration::from_secs(3));
    assert!(error.contains("Server process exited with code 23"), "{error}");
    assert!(error.contains("storage initialization denied"), "{error}");
    assert_eq!(fixture.starts().len(), 2);
    assert!(alive(starts[1]));
}

#[tokio::test(flavor = "multi_thread")]
async fn accepts_a_surviving_contender_after_a_failure_without_recruiting_replacements() {
    needs_bun!();
    let fixture = Fixture::new();
    let options = fixture.options(fixture.command("controlled", &[]));
    let pending = tokio::spawn(async move { run(&options).await });
    let starts = fixture.wait_for_starts(2).await;
    fixture.release(starts[0], "fail").await;
    tokio::time::sleep(Duration::from_millis(450)).await;
    fixture.release(starts[1], "ready").await;
    let ensured = pending.await.unwrap().unwrap();
    assert_eq!(ensured.service.endpoint.url, fixture.info()["url"]);
    assert_eq!(fixture.pid(), starts[1]);
    assert_eq!(fixture.starts().len(), 2);
}

// The one service Rust stops on its own: an unresponsive contender this call started.
#[tokio::test(flavor = "multi_thread")]
async fn recovers_when_its_own_unresponsive_contender_is_evicted_after_a_prior_failure() {
    needs_bun!();
    let fixture = Fixture::new();
    let options = fixture.options(fixture.command("controlled", &[]));
    let pending = tokio::spawn(async move { run(&options).await });
    let starts = fixture.wait_for_starts(2).await;
    fixture.release(starts[1], "hang").await;
    fixture.wait_for_file(&fixture.registration).await;
    fixture.release(starts[0], "fail").await;
    let starts = fixture.wait_for_starts(3).await;
    fixture.release(starts[2], "ready").await;
    let ensured = pending.await.unwrap().unwrap();
    assert_eq!(ensured.service.endpoint.url, fixture.info()["url"]);
    assert_eq!(fixture.pid(), starts[2]);
    assert!(!alive(starts[1]));
}

#[tokio::test(flavor = "multi_thread")]
async fn reports_a_bounded_contender_stderr_tail() {
    needs_bun!();
    let fixture = Fixture::new();
    let error = run(&fixture.options(fixture.command("stderr-failed", &[]))).await.unwrap_err().to_string();
    assert!(error.contains("actionable startup failure"), "{error}");
    assert!(error.len() < 9_000);
}

#[tokio::test(flavor = "multi_thread")]
async fn reports_a_contender_terminated_by_a_signal() {
    needs_bun!();
    let fixture = Fixture::new();
    let error = run(&fixture.options(fixture.command("signal", &[]))).await.unwrap_err().to_string();
    assert!(
        error.starts_with("Server process terminated by SIGKILL")
            || error.starts_with("Server process exited with code"),
        "{error}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn reports_a_slow_contender_that_eventually_fails() {
    needs_bun!();
    let fixture = Fixture::new();
    let error = run(&fixture.options(fixture.command("delayed-failed", &["500"]))).await.unwrap_err().to_string();
    assert!(error.contains("Server process exited with code 1"), "{error}");
}

// TS replaces an incompatible owner that appears during startup. Rust uses it.
#[tokio::test(flavor = "multi_thread")]
async fn uses_an_owner_of_another_version_that_appears_during_startup() {
    needs_bun!();
    let mut fixture = Fixture::new();
    let options = fixture.options(fixture.command("delayed", &["500"]));
    let starting = tokio::spawn(async move { run(&options).await });
    fixture.wait_for_file(&fixture.file(".starts")).await;
    let old = fixture.spawn("old", &[]);
    let ensured = starting.await.unwrap().unwrap();
    assert!(fixture.running(old));
    let pid = ensured.service.registration.pid;
    fixture.pids.push(pid);
    assert!(pid == old || ensured.service.version.as_deref() == Some("test"), "{ensured:?}");
}

// The TS binary registers under its own build channel. A contender that writes another file in
// the state directory is found there.
#[tokio::test(flavor = "multi_thread")]
async fn finds_a_started_service_registered_under_another_channel() {
    needs_bun!();
    let mut fixture = Fixture::new();
    let other = fixture.dir.path().join("service-other.json");
    let options =
        Options { timing: one_contender(), ..fixture.options(fixture.command_for(&other, "environment", &[])) };
    let ensured = run(&options).await.unwrap();
    fixture.pids.push(ensured.service.registration.pid);
    assert_eq!(ensured.file, other);
    assert!(!fixture.registration.exists());
    assert_eq!(status(&ensured.service.endpoint.url).await["pid"], ensured.service.registration.pid);
}

// A fake `OPENCODE_TS_BIN` of the channel `oc-y`: it logs its pid to `spawns` and serves `mode`
// under `service-oc-y.json`, beside the client's `service.json` (review carbon-2).
fn channel_build(fixture: &Fixture, mode: &str) -> (Options, PathBuf, PathBuf) {
    let root = fixture.dir.path();
    let other = root.join("service-oc-y.json");
    let spawns = root.join("spawns");
    let program = root.join("opencode-ts");
    write_script(
        &program,
        &format!(
            "#!/bin/sh\necho $$ >> {}\nexec bun {} {} {mode}\n",
            spawns.display(),
            fixture_script().display(),
            other.display()
        ),
    );
    let ts = TsCommand::from_vars(|name| (name == TsCommand::VAR).then(|| program.clone().into()));
    let mut options = Options::new(fixture.registration.clone(), root.to_owned(), &ts);
    options.timing = one_contender();
    (options, other, spawns)
}

// A round without an answer past a spawn delay starts a second contender by design (a stall probe): a probe that times
// out, or nothing registered yet. Under load a probe stalls past `fast`'s 100 ms (a stall of a second took every copy
// at once) and a contender registers after its 200 ms, at times after a second. The cases of another channel count
// contenders to test the answer they get, and their fixture takes no lock, so a second one breaks the first's
// registration. A probe waits until the deadline, and a contender gets two seconds to register.
fn one_contender() -> Timing {
    let deadline = Duration::from_secs(10);
    let delays = Delays { spawn: Duration::from_secs(2), max_spawn: Duration::from_secs(2) };
    Timing { request: deadline, delays, deadline, ..fast() }
}

fn spawned(spawns: &Path) -> usize {
    std::fs::read_to_string(spawns).unwrap_or_default().lines().count()
}

#[tokio::test(flavor = "multi_thread")]
async fn waits_for_its_starting_service_registered_under_another_channel() {
    needs_bun!();
    let fixture = Fixture::new();
    let (options, other, spawns) = channel_build(&fixture, "starting");
    let spawn = options.timing.delays.spawn;
    let pending = tokio::spawn(async move { run(&options).await });
    let status = PathBuf::from(format!("{}.status-request", other.display()));
    fixture.wait_for_file(&status).await;
    // Past two spawn delays while the service answers 503.
    tokio::time::sleep(spawn * 2).await;
    std::fs::write(format!("{}.release", other.display()), "").unwrap();
    let ensured = pending.await.unwrap().unwrap();
    assert_eq!(ensured.file, other);
    assert_eq!(spawned(&spawns), 1, "a second contender was started");
}

#[tokio::test(flavor = "multi_thread")]
async fn reports_its_failed_service_registered_under_another_channel_at_once() {
    needs_bun!();
    let fixture = Fixture::new();
    let (options, other, spawns) = channel_build(&fixture, "failed-owner");
    let started = Instant::now();
    let error = run(&options).await.unwrap_err().to_string();
    assert_eq!(error, "Background service failed to start");
    assert!(started.elapsed() < fast().deadline, "{:?}", started.elapsed());
    assert_eq!(spawned(&spawns), 1, "a second contender was started");
    let pid: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&other).unwrap()).unwrap();
    assert!(alive(pid["pid"].as_u64().unwrap() as u32));
}

#[tokio::test(flavor = "multi_thread")]
async fn a_restart_hands_persistent_terminals_to_the_next_service() {
    needs_bun!();
    let mut fixture = Fixture::new();
    let old = fixture.spawn("handoff", &[]);
    fixture.wait_for_file(&fixture.registration).await;
    stop::stop(transport(), &fixture.registration, Pty::Handoff, fast().stop).await.unwrap();
    fixture.exited(old).await;
    let prepared: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(fixture.file(".prepared")).unwrap()).unwrap();
    assert!(handoff::sidecar(&fixture.registration).exists());
    let ensured = run(&fixture.options(fixture.command("environment", &[]))).await.unwrap();
    fixture.pids.push(ensured.service.registration.pid);
    let adopted: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(fixture.file(".handoff")).unwrap()).unwrap();
    assert_eq!(adopted, prepared);
    // In use by a service it was not published for: cleared.
    assert!(!handoff::sidecar(&fixture.registration).exists());
}

const STANDALONE: &str = r#"
const server = Bun.serve({ port: 0, fetch: () => new Response("ok") })
await Bun.write(process.argv[1], process.env.OPENCODE_PASSWORD ?? "")
console.log(JSON.stringify({ url: server.url.toString() }))
for await (const _ of process.stdin.stream()) {}
process.exit(0)
"#;

#[tokio::test(flavor = "multi_thread")]
async fn a_standalone_server_reports_its_url_and_ends_with_its_lease() {
    needs_bun!();
    let dir = opencode_util::temp::tempdir().unwrap();
    let record = dir.path().join("password");
    let command: Vec<OsString> = vec!["bun".into(), "-e".into(), STANDALONE.into(), record.clone().into()];
    let server = standalone::start(&command, dir.path(), false).await.unwrap();
    assert!(server.endpoint.url.starts_with("http://"), "{:?}", server.endpoint);
    let password = std::fs::read_to_string(&record).unwrap();
    assert_eq!(password.len(), 43);
    assert_eq!(server.endpoint.auth, Some(opencode_api::client::Auth::password(password)));
    let pid = server.pid;
    drop(server);
    until(|| !alive(pid), "standalone exit").await;
}

#[tokio::test(flavor = "multi_thread")]
async fn a_standalone_server_that_exits_early_is_an_error() {
    let dir = opencode_util::temp::tempdir().unwrap();
    let error = standalone::start(&["true".into()], dir.path(), false).await.unwrap_err();
    assert_eq!(error.to_string(), "Standalone server exited before reporting readiness");
}

// `connect::resolve` on private XDG directories: the fixture registers under the channel `oc-x`.
struct Channel {
    fixture: Fixture,
    paths: Paths,
}

impl Channel {
    fn new() -> Self {
        let mut fixture = Fixture::new();
        let root = fixture.dir.path().to_owned();
        let paths = Paths::from_vars(|name| match name {
            "HOME" => Some(root.clone().into()),
            "XDG_STATE_HOME" => Some(root.join("xdg/state").into()),
            "XDG_CONFIG_HOME" => Some(root.join("xdg/config").into()),
            "XDG_DATA_HOME" => Some(root.join("xdg/data").into()),
            "XDG_CACHE_HOME" => Some(root.join("xdg/cache").into()),
            _ => None,
        })
        .unwrap();
        std::fs::create_dir_all(&paths.state).unwrap();
        fixture.registration = paths.state.join("service-oc-x.json");
        Self { fixture, paths }
    }
}

// A client of the channel `oc-x` whose TS binary prints `opencode v<binary>` for `--version` and serves `mode` (the
// fixture's) under `service-oc-x.json`, logging each start to `spawns`: the bundled binary of O-167.
fn restarting(channel: &Channel, binary: &str, mode: &str) -> (Env, PathBuf) {
    let root = channel.fixture.dir.path();
    let spawns = root.join("spawns");
    let program = root.join("opencode-bundled");
    write_script(
        &program,
        &format!(
            "#!/bin/sh\nif [ \"$1\" = --version ]; then echo opencode v{binary}; exit 0; fi\necho $$ >> {}\nexec bun {} {} {mode}\n",
            spawns.display(),
            fixture_script().display(),
            channel.fixture.registration.display()
        ),
    );
    let env = Env {
        ts_bin: Some(program.to_string_lossy().into_owned()),
        channel: Some("oc-x".to_owned()),
        ..Env::default()
    };
    (env, spawns)
}

async fn resolve_replacing(channel: &Channel, env: &Env) -> Result<Connection, connect::Error> {
    let options =
        connect::Options { client_version: "2.1.0-next.1".to_owned(), replace: true, ..connect::Options::default() };
    connect::resolve(transport(), &channel.paths, env, &options).await
}

// Expected (O-167, TS `default.ts` with `mismatch: "replace"`): the TUI's client restarts a service of another version
// in its channel on the TS binary it resolved, and attaches to the new one.
#[tokio::test(flavor = "multi_thread")]
async fn connect_restarts_a_service_of_another_version_and_attaches_to_the_new_one() {
    needs_bun!();
    let mut channel = Channel::new();
    let old = channel.fixture.spawn("incompatible", &[]);
    channel.fixture.wait_for_file(&channel.fixture.registration).await;
    let (env, spawns) = restarting(&channel, "2.1.0-next.1", "compatible");
    let connection = resolve_replacing(&channel, &env).await.unwrap();
    channel.fixture.pids.push(channel.fixture.pid());
    channel.fixture.exited(old).await;
    assert_eq!(connection.version, "2.1.0-next.1");
    assert_eq!(connection.endpoint.url, channel.fixture.info()["url"]);
    assert_eq!(status(&connection.endpoint.url).await["pid"], channel.fixture.pid());
    assert_eq!(spawned(&spawns), 1);
}

// Expected (O-167): a service of the client's version is not touched; one of another version is used as before when
// the client does not ask to replace (`mismatch: "ignore"`, every command but the TUI and `mini`), when it is
// registered in another channel than the client's, or when the resolved binary would start its version again.
#[tokio::test(flavor = "multi_thread")]
async fn connect_restarts_nothing_else() {
    needs_bun!();
    let mut channel = Channel::new();
    let same = channel.fixture.spawn("compatible", &[]);
    channel.fixture.wait_for_file(&channel.fixture.registration).await;
    let (env, spawns) = restarting(&channel, "2.1.0-next.1", "compatible");
    assert_eq!(resolve_replacing(&channel, &env).await.unwrap().version, "2.1.0-next.1");
    assert!(channel.fixture.running(same));
    signal(same, Signal::KILL);
    channel.fixture.exited(same).await;
    let old = channel.fixture.spawn("incompatible", &[]);
    until(|| channel.fixture.registration.exists() && channel.fixture.pid() == old, "the old service").await;
    let ignoring = connect::Options { client_version: "2.1.0-next.1".to_owned(), ..connect::Options::default() };
    let used = connect::resolve(transport(), &channel.paths, &env, &ignoring).await.unwrap();
    assert_eq!(used.version, "1.9.0");
    let other_channel = Env { channel: None, ..env.clone() };
    assert_eq!(resolve_replacing(&channel, &other_channel).await.unwrap().version, "1.9.0");
    let (same_binary, _) = restarting(&channel, "1.9.0", "incompatible");
    assert_eq!(resolve_replacing(&channel, &same_binary).await.unwrap().version, "1.9.0");
    assert!(channel.fixture.running(old));
    assert_eq!(spawned(&spawns), 0);
}

// Expected (O-167, TS `ensure`): when the replacement fails to start, the old service is already stopped and the
// command fails with the start's error, as TS's does; the client attaches to nothing.
#[tokio::test(flavor = "multi_thread")]
async fn connect_fails_with_the_start_error_when_the_restart_fails() {
    needs_bun!();
    let mut channel = Channel::new();
    let old = channel.fixture.spawn("incompatible", &[]);
    channel.fixture.wait_for_file(&channel.fixture.registration).await;
    let (env, spawns) = restarting(&channel, "2.1.0-next.1", "failed");
    let error = resolve_replacing(&channel, &env).await.unwrap_err().to_string();
    assert!(error.contains("Server process exited with code 1"), "{error}");
    channel.fixture.exited(old).await;
    assert!(spawned(&spawns) >= 1);
}
