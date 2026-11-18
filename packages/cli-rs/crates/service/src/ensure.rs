//! Ensure a background service runs (F.9).
//!
//! Ports `ensure` (`packages/client/src/effect/service.ts:45-127`) with the policy of
//! `docs/architecture.md`: reuse a service that answers, whatever its version unless a version is required;
//! wait for one that is starting; start TypeScript contenders only when none is registered or the
//! registered process is gone; never stop a running service this call did not start, except one of
//! another version than [`Options::version`] requires (O-167), which it replaces as TS does.

use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures_util::future::join_all;
use opencode_api::transport::Transport;
use opencode_local::registration::{self, Registration};

use crate::contender::{Delays, Pool};
use crate::discover;
use crate::handoff;
use crate::probe::{self, Decision, LocalService, Probe};
use crate::spawn::Contender;
use crate::stop::{self, Poll};
use crate::ts_command::TsCommand;

/// `EnsureTiming` (`packages/client/src/service-timing.ts`).
#[derive(Clone, Copy, Debug)]
pub struct Timing {
    pub poll: Duration,
    pub request: Duration,
    pub delays: Delays,
    /// Wall-clock bound of the whole wait (`promiseTimeout`).
    pub deadline: Duration,
    pub stop: Poll,
}

impl Default for Timing {
    /// `defaultEnsureTiming`.
    fn default() -> Self {
        Self {
            poll: Duration::from_millis(25),
            request: probe::REQUEST_TIMEOUT,
            delays: Delays { spawn: Duration::from_secs(5), max_spawn: Duration::from_secs(30) },
            deadline: Duration::from_secs(120),
            stop: Poll::default(),
        }
    }
}

/// How `ensure` finds and starts the service.
#[derive(Clone, Debug)]
pub struct Options {
    /// The client channel's registration file, probed with the full TS semantics.
    pub file: PathBuf,
    /// The state directory, scanned for the registration of a started TS binary of another channel.
    pub state: PathBuf,
    /// The service command, program first (`TsCommand::service`).
    pub command: Vec<OsString>,
    /// Added to the inherited environment (the service config's `env`).
    pub env: Vec<(String, String)>,
    /// The version a service registered in `file` before this call must have (`EnsureOptions.version`, exact): one of
    /// another version is stopped, handing its terminals over when it is ready, and replaced (O-167). A service this
    /// call started is used whatever its version, so a TS binary of another version than required is not replaced in
    /// a loop. `None` uses any version.
    pub version: Option<String>,
    pub timing: Timing,
}

impl Options {
    pub fn new(file: PathBuf, state: PathBuf, ts: &TsCommand) -> Self {
        Self { file, state, command: ts.service(), env: Vec::new(), version: None, timing: Timing::default() }
    }
}

/// Why `ensure` starts a service (`EnsureReason`), with the version of the service it replaces.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Reason {
    Missing,
    VersionMismatch { previous: Option<String> },
}

/// The service to use, and where it is registered.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Ensured {
    pub service: LocalService,
    pub file: PathBuf,
}

#[derive(Debug, thiserror::Error)]
#[error("{0}")]
pub struct Error(pub String);

/// Probes in a row without an answer before a registered service counts as unresponsive.
const UNRESPONSIVE: u32 = 3;

/// Returns a ready service, starting one when needed. `on_start` runs once, with the first reason: before a service of
/// another version is stopped, or before the first contender starts.
pub async fn ensure(
    transport: Arc<dyn Transport>,
    options: &Options,
    on_start: &mut (dyn FnMut(Reason) + Send),
) -> Result<Ensured, Error> {
    let mut run = Run {
        transport,
        options,
        pool: Pool::new(options.timing.delays),
        timeouts: None,
        announced: false,
        spawned: false,
        on_start,
    };
    let start = Instant::now();
    let result = loop {
        match run.round().await {
            Ok(Some(found)) => break Ok(found),
            Err(error) => break Err(error),
            Ok(None) => {}
        }
        if start.elapsed() >= options.timing.deadline {
            break Err(Error(
                run.pool
                    .failure()
                    .map_or_else(|| "Timed out waiting for the background service to start".to_owned(), str::to_owned),
            ));
        }
        tokio::time::sleep(options.timing.poll).await;
    };
    run.pool.release_all();
    result
}

struct Run<'a> {
    transport: Arc<dyn Transport>,
    options: &'a Options,
    pool: Pool<Contender>,
    timeouts: Option<(Registration, u32)>,
    announced: bool,
    spawned: bool,
    on_start: &'a mut (dyn FnMut(Reason) + Send),
}

impl Run<'_> {
    async fn round(&mut self) -> Result<Option<Ensured>, Error> {
        let file = &self.options.file;
        let info = registration::read(file);
        let probe = match &info {
            Some(info) => probe::probe(self.transport.as_ref(), info, self.options.timing.request).await,
            None => Probe { service: None, timed_out: false },
        };
        match (&info, probe.timed_out) {
            (Some(info), true) => self.unresponsive(info).await?,
            _ => self.timeouts = None,
        }
        // Only a service registered in `file` before this call started one is held to the version (TS checks its own
        // file alone); one registered elsewhere is the TS binary's of another channel.
        let required = self.options.version.as_deref().filter(|_| !self.spawned);
        let matches = |version: &str| Some(version) == required;
        let answered = match probe.service {
            Some(service) => Some((service, file.clone(), required.is_some())),
            None if self.spawned => started_elsewhere(self.transport.as_ref(), self.options, &self.pool)
                .await
                .map(|(service, file)| (service, file, false)),
            None => None,
        };
        if let Some((service, file, held)) = answered {
            self.pool.service_answered();
            let requirement: probe::Requirement<'_> = if held { Some(&matches) } else { None };
            return match probe::decide(&service, requirement) {
                Decision::Fail(reason) => Err(Error(reason)),
                Decision::Reuse => {
                    handoff::complete(&file, &service.registration);
                    Ok(Some(Ensured { service, file }))
                }
                Decision::Replace { handoff } => {
                    self.replace(&service, handoff).await;
                    Ok(None)
                }
                Decision::Wait => Ok(None),
            };
        }
        if let Some(failure) = self.pool.reap() {
            return Err(Error(failure));
        }
        if self.pool.should_recruit(info.is_some(), Instant::now()) {
            self.announce();
            let contender = Contender::spawn(&self.options.command, &self.environment())
                .map_err(|error| Error(spawn_error(&self.options.command, &error)))?;
            self.pool.add(contender, Instant::now());
            self.spawned = true;
        }
        Ok(None)
    }

    // A registered service that keeps timing out. TS stops it and starts another; the Rust client
    // does that only for a process it started itself or one that no longer runs (a stale
    // registration: on Windows a killed service's closed port times out rather than refuses), and
    // otherwise gives up (docs/architecture.md).
    async fn unresponsive(&mut self, info: &Registration) -> Result<(), Error> {
        let count = match &self.timeouts {
            Some((previous, count)) if previous.same(info) => count + 1,
            _ => 1,
        };
        self.timeouts = Some((info.clone(), count));
        if count < UNRESPONSIVE {
            return Ok(());
        }
        if !self.pool.owns(info.pid) && stop::running(info.pid) {
            return Err(Error(format!(
                "Background service at {} (pid {}) is not responding. Stop it with `opencode service stop`, or pass --server.",
                info.url, info.pid
            )));
        }
        self.announce();
        handoff::clear(&self.options.file);
        stop::terminate(info, &self.options.file, self.options.timing.stop)
            .await
            .map_err(|error| Error(error.to_string()))?;
        self.pool.evict(info.pid);
        self.pool.recruit_now(Instant::now());
        self.timeouts = None;
        Ok(())
    }

    // A service of another version than required (`decision._tag === "replace"`, `service.ts:98-104`): announced,
    // stopped with its terminals handed over when it is ready, and evicted, so the next round starts the replacement.
    // A failed stop is ignored, as TS ignores it; the next round finds the service again and tries again.
    async fn replace(&mut self, service: &LocalService, handoff: bool) {
        self.announce_reason(Reason::VersionMismatch { previous: service.version.clone() });
        if !handoff {
            log::warn!("Background service is not ready; replacement cannot preserve persistent terminals");
        }
        let pty = if handoff { stop::Pty::Handoff } else { stop::Pty::Clear };
        if let Err(error) = stop::stop(self.transport.clone(), &self.options.file, pty, self.options.timing.stop).await
        {
            log::warn!("failed to stop the background service of another version: {error}");
        }
        self.pool.evict(service.registration.pid);
    }

    fn announce(&mut self) {
        self.announce_reason(Reason::Missing);
    }

    fn announce_reason(&mut self, reason: Reason) {
        if !self.announced {
            self.announced = true;
            (self.on_start)(reason);
        }
    }

    fn environment(&self) -> Vec<(String, Option<String>)> {
        self.options
            .env
            .iter()
            .map(|(name, value)| (name.clone(), Some(value.clone())))
            .chain([handoff::environment(&self.options.file)])
            .collect()
    }
}

// The TS binary registers under its own build channel, which may not be the client's. Any other
// registration that answers ready is taken, newest first. One that is starting or failed counts
// only when this call started its process: it is the service this call waits for.
async fn started_elsewhere(
    transport: &dyn Transport,
    options: &Options,
    pool: &Pool<Contender>,
) -> Option<(LocalService, PathBuf)> {
    let files = discover::scan(&options.state, std::slice::from_ref(&options.file));
    let probes = files.into_iter().map(|file| async move {
        let info = registration::read(&file)?;
        let service = probe::probe(transport, &info, options.timing.request).await.service?;
        Some((service, file))
    });
    let mut answered: Vec<_> = join_all(probes).await.into_iter().flatten().collect();
    let ready = answered.iter().position(|(service, _)| probe::decide(service, None) == Decision::Reuse);
    let owned = answered.iter().position(|(service, _)| pool.owns(service.registration.pid));
    ready.or(owned).map(|index| answered.swap_remove(index))
}

fn spawn_error(command: &[OsString], error: &std::io::Error) -> String {
    let program = command.first().map(|program| program.to_string_lossy().into_owned()).unwrap_or_default();
    format!(
        "Failed to start server: {program}: {error}. Install opencode or set {} to the TypeScript opencode binary.",
        TsCommand::VAR
    )
}
