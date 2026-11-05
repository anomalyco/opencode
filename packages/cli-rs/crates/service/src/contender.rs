//! Contender pool (F.9).
//!
//! Ports `contenderPool` (`packages/client/src/service-contender.ts:57-136`): the startup attempts of
//! one `ensure` call. It keeps at most two alive, remembers the first startup failure, and backs off
//! when attempts exit cleanly because another one won. The clock is an argument, so tests need
//! neither processes nor sleeps.

use std::time::{Duration, Instant};

use crate::spawn::Contender;

/// What the pool needs to know about one startup attempt.
pub trait Attempt {
    fn pid(&self) -> u32;
    /// Exited with stderr closed (Node's `close`).
    fn finished(&self) -> bool;
    /// Exited with code 0, because another attempt won.
    fn clean(&self) -> bool;
    /// Why the attempt failed to start, once it has finished.
    fn failure(&self) -> Option<String>;
    fn release(&self);
}

impl Attempt for Contender {
    fn pid(&self) -> u32 {
        self.pid
    }

    fn finished(&self) -> bool {
        self.status().is_some()
    }

    fn clean(&self) -> bool {
        self.status().is_some_and(|status| status.code() == Some(0))
    }

    fn failure(&self) -> Option<String> {
        let status = self.status()?;
        let message = match (status.code(), signal(status)) {
            (Some(0), _) => return None,
            (Some(code), _) => format!("Server process exited with code {code}"),
            (None, Some(signal)) => format!("Server process terminated by {signal}"),
            (None, None) => return None,
        };
        let stderr = self.stderr();
        Some(if stderr.is_empty() { message } else { format!("{message}\n{stderr}") })
    }

    fn release(&self) {
        Contender::release(self);
    }
}

#[cfg(unix)]
fn signal(status: std::process::ExitStatus) -> Option<String> {
    let number = std::os::unix::process::ExitStatusExt::signal(&status)?;
    Some(
        match number {
            1 => "SIGHUP",
            2 => "SIGINT",
            3 => "SIGQUIT",
            6 => "SIGABRT",
            9 => "SIGKILL",
            11 => "SIGSEGV",
            13 => "SIGPIPE",
            15 => "SIGTERM",
            _ => return Some(format!("signal {number}")),
        }
        .to_owned(),
    )
}

#[cfg(not(unix))]
fn signal(_: std::process::ExitStatus) -> Option<String> {
    None
}

/// The pool's delays (`spawnDelay`, `maxSpawnDelay`).
#[derive(Clone, Copy, Debug)]
pub struct Delays {
    pub spawn: Duration,
    pub max_spawn: Duration,
}

pub struct Pool<A> {
    delays: Delays,
    contenders: Vec<A>,
    failure: Option<String>,
    spawn_delay: Duration,
    last_spawn: Option<Instant>,
}

impl<A: Attempt> Pool<A> {
    pub fn new(delays: Delays) -> Self {
        Self { delays, contenders: Vec::new(), failure: None, spawn_delay: delays.spawn, last_spawn: None }
    }

    /// The first startup failure seen since the last eviction.
    pub fn failure(&self) -> Option<&str> {
        self.failure.as_deref()
    }

    /// Whether `pid` is one of this pool's attempts, alive or not yet reaped.
    pub fn owns(&self, pid: u32) -> bool {
        self.contenders.iter().any(|item| item.pid() == pid)
    }

    /// A registered service answered, so the next attempt waits the base delay again.
    pub fn service_answered(&mut self) {
        self.spawn_delay = self.delays.spawn;
    }

    /// The owner `pid` was stopped. Drop its attempt and any finished ones, forget their failure,
    /// and restart the spawn clock.
    pub fn evict(&mut self, pid: u32) {
        self.contenders.retain(|item| {
            let keep = item.pid() != pid && !item.finished();
            if !keep {
                item.release();
            }
            keep
        });
        self.failure = None;
        self.last_spawn = None;
    }

    /// Lets the next attempt start without waiting a spawn delay.
    pub fn recruit_now(&mut self, now: Instant) {
        self.last_spawn = Some(now.checked_sub(self.spawn_delay).unwrap_or(now));
    }

    /// Collects finished attempts. Returns the startup failure once no attempt is left alive.
    pub fn reap(&mut self) -> Option<String> {
        let (finished, alive): (Vec<A>, Vec<A>) =
            std::mem::take(&mut self.contenders).into_iter().partition(Attempt::finished);
        self.contenders = alive;
        if self.failure.is_none() {
            self.failure = finished.iter().find_map(Attempt::failure);
        }
        if finished.iter().any(Attempt::clean) {
            self.spawn_delay = (self.spawn_delay * 2).min(self.delays.max_spawn);
        }
        if self.contenders.is_empty() { self.failure.clone() } else { None }
    }

    /// Whether to start another attempt now. A registration that has not answered yet gets one
    /// spawn delay before an attempt competes with it.
    pub fn should_recruit(&mut self, registered: bool, now: Instant) -> bool {
        if self.last_spawn.is_none() && registered {
            self.last_spawn = Some(now);
        }
        // One candidate plus one lock probe for stalls before the lock. After a failure, let the
        // survivors finish without recruiting replacements that could hide the error.
        self.failure.is_none()
            && self.contenders.len() < 2
            && self.last_spawn.is_none_or(|last| now.saturating_duration_since(last) >= self.spawn_delay)
    }

    pub fn add(&mut self, contender: A, now: Instant) {
        self.contenders.push(contender);
        self.last_spawn = Some(now);
    }

    pub fn release_all(&self) {
        self.contenders.iter().for_each(Attempt::release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::rc::Rc;

    // The cases of `packages/client/test/service-contender-pool.test.ts`, on fake attempts.
    #[derive(Clone)]
    struct Fake {
        pid: u32,
        exit: Rc<Cell<Option<i32>>>,
        released: Rc<Cell<bool>>,
    }

    impl Fake {
        fn new(pid: u32) -> Self {
            Self { pid, exit: Rc::default(), released: Rc::default() }
        }

        fn exit(&self, code: i32) {
            self.exit.set(Some(code));
        }
    }

    impl Attempt for Fake {
        fn pid(&self) -> u32 {
            self.pid
        }
        fn finished(&self) -> bool {
            self.exit.get().is_some()
        }
        fn clean(&self) -> bool {
            self.exit.get() == Some(0)
        }
        fn failure(&self) -> Option<String> {
            self.exit.get().filter(|code| *code != 0).map(|code| format!("failure of {} ({code})", self.pid))
        }
        fn release(&self) {
            self.released.set(true);
        }
    }

    fn pool(spawn: u64, max_spawn: u64) -> Pool<Fake> {
        Pool::new(Delays { spawn: Duration::from_millis(spawn), max_spawn: Duration::from_millis(max_spawn) })
    }

    fn ms(start: Instant, offset: u64) -> Instant {
        start + Duration::from_millis(offset)
    }

    #[test]
    fn remembers_the_first_startup_failure_and_reports_it_once_no_attempt_is_left() {
        let now = Instant::now();
        let mut pool = pool(0, 30_000);
        let survivor = Fake::new(1);
        let failed = Fake::new(2);
        pool.add(survivor.clone(), now);
        pool.add(failed.clone(), now);
        failed.exit(1);
        assert_eq!(pool.reap(), None);
        assert_eq!(pool.failure(), Some("failure of 2 (1)"));
        assert!(!pool.should_recruit(false, now));
        survivor.exit(1);
        assert_eq!(pool.reap().as_deref(), Some("failure of 2 (1)"));
    }

    #[test]
    fn evicting_a_stopped_owner_forgets_its_failure_and_restarts_the_spawn_clock() {
        let now = Instant::now();
        let mut pool = pool(60_000, 60_000);
        let owner = Fake::new(1);
        let failed = Fake::new(2);
        pool.add(owner.clone(), now);
        pool.add(failed.clone(), now);
        failed.exit(1);
        assert_eq!(pool.reap(), None);
        assert!(pool.failure().is_some());
        assert!(pool.owns(1));
        pool.evict(1);
        assert!(owner.released.get());
        assert!(!pool.owns(1));
        assert_eq!(pool.failure(), None);
        assert_eq!(pool.reap(), None);
        assert!(pool.should_recruit(false, now));
    }

    #[test]
    fn an_unanswered_registration_gets_one_spawn_delay_before_an_attempt_competes() {
        let now = Instant::now();
        assert!(pool(60_000, 60_000).should_recruit(false, now));
        let mut registered = pool(60_000, 60_000);
        assert!(!registered.should_recruit(true, now));
        assert!(!registered.should_recruit(true, ms(now, 59_999)));
        assert!(registered.should_recruit(true, ms(now, 60_000)));
        let mut forced = pool(60_000, 60_000);
        assert!(!forced.should_recruit(true, ms(now, 60_000)));
        forced.recruit_now(ms(now, 60_000));
        assert!(forced.should_recruit(true, ms(now, 60_000)));
    }

    #[test]
    fn keeps_at_most_two_attempts_alive() {
        let now = Instant::now();
        let mut pool = pool(0, 30_000);
        let exiting = Fake::new(2);
        pool.add(Fake::new(1), now);
        pool.add(exiting.clone(), now);
        assert!(!pool.should_recruit(false, now));
        exiting.exit(0);
        assert_eq!(pool.reap(), None);
        assert!(pool.should_recruit(false, now));
    }

    #[test]
    fn clean_exits_back_off_up_to_the_maximum_spawn_delay() {
        let now = Instant::now();
        let mut pool = pool(200, 300);
        let exiting = Fake::new(1);
        pool.add(exiting.clone(), now);
        exiting.exit(0);
        assert_eq!(pool.reap(), None);
        // The base delay has passed, the backed-off one (capped at 300, not 400) has not.
        assert!(!pool.should_recruit(false, ms(now, 250)));
        assert!(pool.should_recruit(false, ms(now, 300)));
    }

    #[test]
    fn an_answering_service_resets_the_backoff_to_the_base_spawn_delay() {
        let now = Instant::now();
        let mut pool = pool(200, 1_000);
        let exiting = Fake::new(1);
        pool.add(exiting.clone(), now);
        exiting.exit(0);
        assert_eq!(pool.reap(), None);
        pool.service_answered();
        assert!(pool.should_recruit(false, ms(now, 250)));
    }

    #[test]
    fn a_real_contender_reports_its_exit_code_and_stderr() {
        let contender = Contender::spawn(&["sh".into(), "-c".into(), "echo denied >&2; exit 23".into()], &[]).unwrap();
        while !contender.finished() {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(contender.failure().as_deref(), Some("Server process exited with code 23\ndenied"));
        let killed = Contender::spawn(&["sh".into(), "-c".into(), "kill -9 $$".into()], &[]).unwrap();
        while !killed.finished() {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(killed.failure().as_deref(), Some("Server process terminated by SIGKILL"));
    }
}
