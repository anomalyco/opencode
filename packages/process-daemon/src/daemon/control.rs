#[cfg(all(test, unix))]
use std::sync::atomic::AtomicU64;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::Instant;

use anyhow::{Result, anyhow, bail};

use crate::ownership::{Ownership, Snapshot};
use crate::transport::Wake;

/// Daemon stop flag and ownership state, shared by the main loop and handlers.
///
/// Every write to either goes through a method here; the fields stay private to
/// this module so no caller can change them behind the main loop's back. Each
/// write happens under the ownership lock and notifies `wake` before releasing
/// it, which is what makes the missed-wake check in `tick` exact.
pub(super) struct Control {
    stop: AtomicBool,
    ownership: Mutex<Ownership>,
    wake: Wake,
    #[cfg(all(test, unix))]
    pub stats: Stats,
}

#[cfg(all(test, unix))]
#[derive(Default)]
pub(super) struct Stats {
    pub iterations: AtomicU64,
    pub missed_wakes: AtomicU64,
}

pub(super) struct Tick {
    pub stopped: bool,
    pub deadline: Option<Instant>,
}

impl Control {
    pub fn new(wake: Wake, ownership: Ownership) -> Self {
        Self {
            stop: AtomicBool::new(false),
            ownership: Mutex::new(ownership),
            wake,
            #[cfg(all(test, unix))]
            stats: Stats::default(),
        }
    }

    /// Never fails: a poisoned lock is recovered, because stopping must always work.
    /// Must not be called from an `update_ownership` closure.
    pub fn request_stop(&self) {
        let _ownership = self
            .ownership
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        self.stop.store(true, Ordering::Release);
        self.wake.notify();
    }

    pub fn stopping(&self) -> bool {
        self.stop.load(Ordering::Acquire)
    }

    /// Notifies even when `f` changes nothing, so every mutation wakes the loop.
    /// `f` must not call back into `Control`; the lock is not reentrant.
    pub fn update_ownership<T>(&self, f: impl FnOnce(&mut Ownership) -> T) -> Result<T> {
        let mut ownership = self.lock()?;
        let value = f(&mut ownership);
        self.wake.notify();
        Ok(value)
    }

    pub fn is_owner(&self, generation: u64) -> Result<bool> {
        Ok(self.lock()?.is_owner(generation))
    }

    /// Wakes the loop without changing state, e.g. when a handler finishes.
    pub fn notify(&self) {
        self.wake.notify();
    }

    /// Main loop only.
    pub fn wake(&self) -> &Wake {
        &self.wake
    }

    /// Main loop only. Drains wakes, detects a missed wake, and advances ownership in one
    /// critical section. Must never notify, or the loop would wake itself every pass.
    ///
    /// `last` is the snapshot left by the previous tick; `timed_out` is whether the wait
    /// before this tick slept for its whole timeout.
    pub fn tick(&self, now: Instant, last: &mut Snapshot, timed_out: bool) -> Result<Tick> {
        let mut ownership = self.lock()?;
        let woken = self.wake.drain();
        let stopping = self.stop.load(Ordering::Acquire);
        let observed = ownership.snapshot();
        // Every writer notifies before releasing this lock, so a change since `last` with
        // nothing drained means some writer skipped its wake.
        let missed = timed_out && !woken && (stopping || observed != *last);
        if missed {
            #[cfg(all(test, unix))]
            self.stats.missed_wakes.fetch_add(1, Ordering::Relaxed);
            eprintln!(
                "opencode-pty missed wake (stopping={stopping}, {last:?} -> {observed:?}); acted on via safety net"
            );
        }
        let stopped = stopping || ownership.tick(now);
        *last = ownership.snapshot();
        let deadline = ownership.deadline();
        drop(ownership);
        // An error rather than a panic, so cleanup still runs.
        if missed && cfg!(debug_assertions) {
            bail!("missed wake detected");
        }
        Ok(Tick { stopped, deadline })
    }

    fn lock(&self) -> Result<MutexGuard<'_, Ownership>> {
        self.ownership
            .lock()
            .map_err(|_| anyhow!("ownership lock poisoned"))
    }

    /// Detector tests only: sets the stop flag without a wake. Acts only when no wake is
    /// pending, which proves the loop has ticked past every earlier change. Returns whether
    /// it acted.
    #[cfg(all(test, unix))]
    pub fn set_stop_without_wake(&self) -> bool {
        let _ownership = self.ownership.lock().unwrap();
        if self.wake.pending() {
            return false;
        }
        self.stop.store(true, Ordering::Release);
        true
    }

    /// Detector tests only: like `set_stop_without_wake`, for an ownership change.
    #[cfg(all(test, unix))]
    pub fn update_ownership_without_wake(&self, f: impl FnOnce(&mut Ownership)) -> bool {
        let mut ownership = self.ownership.lock().unwrap();
        if self.wake.pending() {
            return false;
        }
        f(&mut ownership);
        true
    }
}
