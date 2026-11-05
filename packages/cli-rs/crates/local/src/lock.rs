//! Directory lock compatible with the TypeScript `Flock` (F.4).
//!
//! Ports `packages/util/src/flock.ts` (and `effect-flock.ts`, which writes the same layout), so a
//! Rust and a TypeScript process exclude each other on the same file. The lock for `key` is the
//! directory `<dir>/<sha1(key)>.lock`, created with `mkdir`. It holds an empty `heartbeat` file whose
//! modification time the owner refreshes and a `meta.json` with the owner's token. A lock whose
//! heartbeat is older than the stale time belongs to a crashed owner: one contender claims
//! `<lock>.breaker`, checks again, and removes it. Release removes the directory only while
//! `meta.json` still carries the owner's token.
//!
//! The calls block, so async callers run them on a blocking thread.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant, SystemTime};

use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};

/// `Hash.fast` from `packages/util/src/hash.ts`: lowercase SHA-1 hex.
pub fn hash(input: &str) -> String {
    Sha1::digest(input.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// Timing, with the TypeScript defaults.
#[derive(Clone, Debug)]
pub struct Options {
    pub stale: Duration,
    pub timeout: Duration,
    pub base_delay: Duration,
    pub max_delay: Duration,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            stale: Duration::from_secs(60),
            timeout: Duration::from_secs(5 * 60),
            base_delay: Duration::from_millis(100),
            max_delay: Duration::from_secs(2),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Timed out waiting for lock: {0}")]
    Timeout(String),
    #[error("{0}")]
    Compromised(&'static str),
    #[error(transparent)]
    Io(#[from] io::Error),
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Meta {
    token: String,
    pid: u32,
    hostname: String,
    created_at: String,
}

#[derive(Deserialize)]
struct TokenOnly {
    token: Option<serde_json::Value>,
}

/// A held lock. Dropping it releases it; call [`Lock::release`] to see release errors.
#[derive(Debug)]
pub struct Lock {
    dir: PathBuf,
    token: String,
    heartbeat: Option<(mpsc::Sender<()>, thread::JoinHandle<()>)>,
    released: bool,
}

/// Runs `f` while holding the lock for `key` in `dir`.
pub fn with_lock<T>(dir: &Path, key: &str, options: &Options, f: impl FnOnce() -> T) -> Result<T, Error> {
    let lock = acquire(dir, key, options)?;
    let value = f();
    lock.release()?;
    Ok(value)
}

/// Waits for the lock for `key` in `dir`, retrying with backoff until the timeout.
pub fn acquire(dir: &Path, key: &str, options: &Options) -> Result<Lock, Error> {
    fs::create_dir_all(dir)?;
    let lock_dir = dir.join(format!("{}.lock", hash(key)));
    let stop = Instant::now() + options.timeout;
    let mut delay = options.base_delay;
    loop {
        if let Some(mut lock) = try_acquire(&lock_dir, options)? {
            lock.start_heartbeat(options.stale);
            return Ok(lock);
        }
        if Instant::now() > stop {
            return Err(Error::Timeout(key.to_string()));
        }
        thread::sleep(jitter(delay));
        delay = options.max_delay.min(Duration::from_millis((delay.as_millis() as u64 * 17) / 10));
    }
}

// Within 30% either way, as the TypeScript `jitter`.
fn jitter(delay: Duration) -> Duration {
    let ms = delay.as_millis() as i64;
    let spread = ms * 3 / 10;
    Duration::from_millis((ms + rand::random_range(-spread..=spread)).max(0) as u64)
}

/// One attempt: `None` while another owner holds a fresh lock.
fn try_acquire(lock_dir: &Path, options: &Options) -> Result<Option<Lock>, Error> {
    let heartbeat = lock_dir.join("heartbeat");
    let meta = lock_dir.join("meta.json");
    match mkdir(lock_dir) {
        Ok(()) => {}
        Err(err) if err.kind() == io::ErrorKind::AlreadyExists => {
            if !stale(lock_dir, options.stale)? {
                return Ok(None);
            }
            let breaker = PathBuf::from(format!("{}.breaker", lock_dir.display()));
            match mkdir(&breaker) {
                Ok(()) => {}
                Err(err) if err.kind() == io::ErrorKind::AlreadyExists => {
                    if stat(&breaker)?.is_some_and(|m| age(&m) > options.stale) {
                        let _ = remove(&breaker);
                    }
                    return Ok(None);
                }
                Err(err) if gone(&err) => return Ok(None),
                Err(err) => return Err(err.into()),
            }
            // Owning the breaker makes this the only contender that cleans up the stale lock.
            let recreated = (|| -> io::Result<bool> {
                if !stale(lock_dir, options.stale)? {
                    return Ok(false);
                }
                remove(lock_dir)?;
                match mkdir(lock_dir) {
                    Ok(()) => Ok(true),
                    Err(err)
                        if err.kind() == io::ErrorKind::AlreadyExists
                            || err.kind() == io::ErrorKind::DirectoryNotEmpty =>
                    {
                        Ok(false)
                    }
                    Err(err) => Err(err),
                }
            })();
            let _ = remove(&breaker);
            if !recreated? {
                return Ok(None);
            }
        }
        Err(err) => return Err(err.into()),
    }

    let token = uuid::Uuid::new_v4().to_string();
    let body = serde_json::to_string_pretty(&Meta {
        token: token.clone(),
        pid: std::process::id(),
        hostname: hostname(),
        created_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    })
    .expect("meta serializes");
    if create_new(&heartbeat, b"").is_err() {
        let _ = remove(lock_dir);
        return Err(Error::Compromised("Lock acquired but heartbeat already existed (possible compromise)."));
    }
    if create_new(&meta, body.as_bytes()).is_err() {
        let _ = remove(lock_dir);
        return Err(Error::Compromised("Lock acquired but meta.json already existed (possible compromise)."));
    }
    Ok(Some(Lock { dir: lock_dir.to_path_buf(), token, heartbeat: None, released: false }))
}

impl Lock {
    /// The lock directory, `<dir>/<sha1(key)>.lock`.
    pub fn path(&self) -> &Path {
        &self.dir
    }

    // Refreshes the heartbeat every third of the stale time (at least 100 ms), so a long critical
    // section is not taken for a crashed owner.
    fn start_heartbeat(&mut self, stale: Duration) {
        let interval = Duration::from_millis(100).max(stale / 3);
        let file = self.dir.join("heartbeat");
        let (stop, stopped) = mpsc::channel();
        let handle = thread::spawn(move || {
            while let Err(mpsc::RecvTimeoutError::Timeout) = stopped.recv_timeout(interval) {
                let _ = fs::File::open(&file).and_then(|f| f.set_modified(SystemTime::now()));
            }
        });
        self.heartbeat = Some((stop, handle));
    }

    /// Releases the lock. Refuses when `meta.json` is missing, invalid, or carries another token,
    /// because then another process owns the directory.
    pub fn release(mut self) -> Result<(), Error> {
        self.release_inner()
    }

    fn release_inner(&mut self) -> Result<(), Error> {
        self.released = true;
        if let Some((stop, handle)) = self.heartbeat.take() {
            drop(stop);
            let _ = handle.join();
        }
        let raw = fs::read_to_string(self.dir.join("meta.json")).map_err(|err| {
            if gone(&err) {
                return Error::Compromised("Refusing to release: lock is compromised (metadata missing).");
            }
            Error::Io(err)
        })?;
        let current = match serde_json::from_str::<serde_json::Value>(&raw) {
            Err(_) => {
                return Err(Error::Compromised("Refusing to release: lock is compromised (metadata invalid)."));
            }
            Ok(value) => serde_json::from_value::<TokenOnly>(value).ok().and_then(|meta| meta.token),
        };
        if current.as_ref().and_then(|token| token.as_str()) != Some(self.token.as_str()) {
            return Err(Error::Compromised("Refusing to release: lock token mismatch (not the owner)."));
        }
        remove(&self.dir)?;
        Ok(())
    }
}

impl Drop for Lock {
    fn drop(&mut self) {
        if !self.released {
            let _ = self.release_inner();
        }
    }
}

fn stale(lock_dir: &Path, stale: Duration) -> io::Result<bool> {
    // The heartbeat, else meta.json, else the directory itself dates the owner.
    for path in [lock_dir.join("heartbeat"), lock_dir.join("meta.json"), lock_dir.to_path_buf()] {
        if let Some(meta) = stat(&path)? {
            return Ok(age(&meta) > stale);
        }
    }
    Ok(false)
}

fn age(meta: &fs::Metadata) -> Duration {
    meta.modified().ok().and_then(|time| SystemTime::now().duration_since(time).ok()).unwrap_or_default()
}

fn stat(path: &Path) -> io::Result<Option<fs::Metadata>> {
    match fs::metadata(path) {
        Ok(meta) => Ok(Some(meta)),
        Err(err) if gone(&err) => Ok(None),
        Err(err) => Err(err),
    }
}

fn gone(err: &io::Error) -> bool {
    matches!(err.kind(), io::ErrorKind::NotFound | io::ErrorKind::NotADirectory)
}

fn mkdir(path: &Path) -> io::Result<()> {
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
    builder.create(path)
}

fn create_new(path: &Path, body: &[u8]) -> io::Result<()> {
    fs::OpenOptions::new().write(true).create_new(true).open(path)?.write_all(body)
}

// `rm -rf`: a missing path is fine.
fn remove(path: &Path) -> io::Result<()> {
    match fs::remove_dir_all(path) {
        Err(err) if gone(&err) => Ok(()),
        other => other,
    }
}

#[cfg(unix)]
fn hostname() -> String {
    rustix::system::uname().nodename().to_string_lossy().into_owned()
}

#[cfg(not(unix))]
fn hostname() -> String {
    std::env::var("COMPUTERNAME").unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn quick() -> Options {
        Options {
            stale: Duration::from_secs(60),
            timeout: Duration::from_millis(300),
            base_delay: Duration::from_millis(10),
            max_delay: Duration::from_millis(50),
        }
    }

    #[test]
    fn hash_matches_node_sha1() {
        // node -e 'console.log(require("crypto").createHash("sha1").update("abc").digest("hex"))'
        assert_eq!(hash("abc"), "a9993e364706816aba3e25717850c26c9cd0d89d");
    }

    #[test]
    fn layout_and_release() {
        let dir = tempfile::tempdir().unwrap();
        let lock = acquire(dir.path(), "/some/file.json", &quick()).unwrap();
        let lock_dir = dir.path().join(format!("{}.lock", hash("/some/file.json")));
        assert_eq!(lock.path(), lock_dir);
        assert_eq!(fs::read(lock_dir.join("heartbeat")).unwrap(), b"");
        let meta: Meta = serde_json::from_str(&fs::read_to_string(lock_dir.join("meta.json")).unwrap()).unwrap();
        assert_eq!(meta.pid, std::process::id());
        lock.release().unwrap();
        assert!(!lock_dir.exists());
    }

    #[test]
    fn excludes_and_times_out() {
        let dir = tempfile::tempdir().unwrap();
        let held = acquire(dir.path(), "k", &quick()).unwrap();
        let err = acquire(dir.path(), "k", &quick()).unwrap_err();
        assert_eq!(err.to_string(), "Timed out waiting for lock: k");
        // Another key is independent.
        acquire(dir.path(), "other", &quick()).unwrap().release().unwrap();
        drop(held);
        acquire(dir.path(), "k", &quick()).unwrap().release().unwrap();
    }

    #[test]
    fn breaks_a_stale_lock() {
        let dir = tempfile::tempdir().unwrap();
        let options = Options { stale: Duration::from_millis(200), ..quick() };
        let lock_dir = dir.path().join(format!("{}.lock", hash("k")));
        fs::create_dir(&lock_dir).unwrap();
        fs::write(lock_dir.join("heartbeat"), "").unwrap();
        let old = SystemTime::now() - Duration::from_secs(5);
        fs::File::open(lock_dir.join("heartbeat")).unwrap().set_modified(old).unwrap();
        acquire(dir.path(), "k", &options).unwrap().release().unwrap();
    }

    #[test]
    fn heartbeat_keeps_a_long_hold_fresh() {
        let dir = tempfile::tempdir().unwrap();
        let options = Options { stale: Duration::from_millis(300), ..quick() };
        let held = acquire(dir.path(), "k", &options).unwrap();
        thread::sleep(Duration::from_millis(700));
        assert!(matches!(acquire(dir.path(), "k", &options), Err(Error::Timeout(_))));
        held.release().unwrap();
    }

    #[test]
    fn refuses_to_release_a_lock_it_lost() {
        let dir = tempfile::tempdir().unwrap();
        let lock = acquire(dir.path(), "k", &quick()).unwrap();
        fs::write(lock.path().join("meta.json"), r#"{"token":"someone-else"}"#).unwrap();
        let path = lock.path().to_path_buf();
        assert_eq!(
            lock.release().unwrap_err().to_string(),
            "Refusing to release: lock token mismatch (not the owner)."
        );
        assert!(path.exists());
    }

    #[test]
    fn with_lock_runs_and_releases() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(with_lock(dir.path(), "k", &quick(), || 7).unwrap(), 7);
        assert!(fs::read_dir(dir.path()).unwrap().next().is_none());
    }
}
