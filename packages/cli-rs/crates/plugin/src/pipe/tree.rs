//! What a TypeScript plugin's directory holds, worked out on a thread of its own: the UI thread never walks a plugin's
//! files, so no frame, the first included, waits on it. A question answers what the last walk found, at once, and
//! starts another walk when none runs; a walk that finds something new wakes the UI thread, which reconciles.
//!
//! - A **global** plugin's build is its own files' bytes, and its dependencies by version: each installed package's
//!   `package.json` and the lockfiles, not every file under `node_modules` (a dozen plugins hold 250,000 there). A
//!   save that changes nothing loads nothing; an install that changes a dependency loads it again.
//! - A **project** plugin's is the SHA-256 of every file, its dependencies' too, as its approval names it
//!   ([`Artifact::tree`]). It is taken again only once a stamp of the tree changed. What the JS host imports is the
//!   staged copy of the approved bytes, which [`Artifact::stage`] checks as it copies them, so an answer that is
//!   older than the disk never runs bytes that were not approved. The copy is made off the UI thread too
//!   ([`Trees::staged`]).
//!
//! The stamp is the metadata of the plugin's own files and of each dependency's package directory and `package.json`.

use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};

use crate::loader::approval::{self, Artifact};

/// The deepest a plugin's tree is walked, as [`Artifact::tree`] walks it.
const DEPTH: usize = 32;

pub(crate) struct Trees {
    state: Arc<Mutex<HashMap<PathBuf, Entry>>>,
    /// The copies of approved trees being made, by the tree and its hash, and each one's result until it is taken.
    stages: Arc<Mutex<Stages>>,
    /// The bytes of plugin files the walks and copies read.
    hashed: Arc<AtomicU64>,
    wake: Arc<dyn Fn() + Send + Sync>,
    /// Walks and copies that ended with something new and have not posted their wake yet: until they do, a walk is still
    /// running as far as [`Trees::walking`] says, so no one waits for walks, sees none, and misses the reconcile that
    /// wake brings (flakes-10).
    waking: Arc<AtomicUsize>,
    /// While set, a copy waits before it reads anything ([`Trees::pause_stages`]).
    paused: Arc<(Mutex<bool>, Condvar)>,
}

/// Each copy by the tree and its hash: the tree's [`Entry::changes`] when it began, and its result until it is taken.
type Stages = HashMap<(PathBuf, String), (u64, Option<Result<PathBuf, String>>)>;

/// What the last walk found of a tree: its light build and its artifact, each `None` until a walk took it.
type Answer = (Option<Result<u64, String>>, Option<Result<Artifact, String>>);

#[derive(Default)]
struct Entry {
    running: bool,
    /// A question came while a walk ran: one more walk follows it.
    again: bool,
    /// The full hash is asked for: the plugin is a project's.
    full: bool,
    /// The next walk hashes whatever the stamp says ([`Trees::rewalk`]).
    stale: bool,
    stamp: Option<u64>,
    light: Option<Result<u64, String>>,
    artifact: Option<Result<Artifact, String>>,
    /// How many walks found another artifact than the last: a copy that failed before the last of them failed on
    /// files that are no longer there.
    changes: u64,
}

impl Trees {
    /// `wake` runs on a walk's thread when a walk found something new, and on a copy's when it ended.
    pub(crate) fn new(wake: impl Fn() + Send + Sync + 'static) -> Self {
        Self {
            state: Arc::default(),
            stages: Arc::default(),
            hashed: Arc::default(),
            waking: Arc::default(),
            wake: Arc::new(wake),
            paused: Arc::default(),
        }
    }

    /// The build of the global plugin `dir` as the last walk found it, or `None` before the first walk ended.
    pub(crate) fn light(&self, dir: &Path) -> Option<Result<u64, String>> {
        self.ask(dir, false).0
    }

    /// The approval artifact of the project plugin `dir` as the last walk found it, or `None` before one ended.
    pub(crate) fn artifact(&self, dir: &Path) -> Option<Result<Artifact, String>> {
        self.ask(dir, true).1
    }

    /// Hashes the project plugin `dir` whole again, whatever its stamp says: its files changed under a stamp that did
    /// not, as a stage of the approved bytes found.
    pub(crate) fn rewalk(&self, dir: &Path) {
        // A failed copy's error is not kept for a later question: the files may come back as they were approved.
        let real = std::fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
        lock(&self.stages).retain(|(path, _), (_, staged)| !(path == &real && matches!(staged, Some(Err(_)))));
        lock(&self.state).entry(dir.to_path_buf()).or_default().stale = true;
        self.ask(dir, true);
    }

    /// The copy of the approved `artifact` under `root` that the JS host imports ([`Artifact::stage`]), made off the UI
    /// thread, or `None` until it is: a new copy reads and writes the whole tree. A copy made before is used at once.
    pub(crate) fn staged(&self, artifact: &Artifact, root: &Path) -> Option<Result<PathBuf, String>> {
        if root.join(&artifact.sha256).is_dir() {
            return artifact.stage(root).into();
        }
        let key = (artifact.path.clone(), artifact.sha256.clone());
        let changes = lock(&self.state).get(&artifact.target).map_or(0, |entry| entry.changes);
        let mut stages = lock(&self.stages);
        match stages.get(&key) {
            Some((_, None)) => return None,
            // Retry if the files that caused the failure changed.
            Some((began, Some(Err(_)))) if *began != changes => {}
            Some((_, Some(_))) => return stages.remove(&key).and_then(|(_, staged)| staged),
            None => {}
        }
        stages.insert(key, (changes, None));
        drop(stages);
        let (stages, hashed, wake) = (self.stages.clone(), self.hashed.clone(), self.wake.clone());
        let (owned, to, paused, waking) = (artifact.clone(), root.to_owned(), self.paused.clone(), self.waking.clone());
        let spawned = std::thread::Builder::new().name("plugin-stage".to_owned()).spawn(move || {
            let (flag, resumed) = &*paused;
            drop(resumed.wait_while(lock(flag), |paused| *paused).unwrap_or_else(|poisoned| poisoned.into_inner()));
            // Counted before the copy's result shows, so a wait on walks lasts until this wake is posted.
            waking.fetch_add(1, Ordering::SeqCst);
            stage(&stages, &hashed, &owned, &to, changes);
            wake();
            waking.fetch_sub(1, Ordering::SeqCst);
        });
        // Without a thread, the copy is made here.
        if spawned.is_err() {
            stage(&self.stages, &self.hashed, artifact, root, changes);
            return self.staged(artifact, root);
        }
        None
    }

    /// Holds every copy of an approved tree before it reads anything while `paused`, and lets them go on when not: a
    /// test saves a file between the approval and the copy.
    pub(crate) fn pause_stages(&self, paused: bool) {
        let (flag, resumed) = &*self.paused;
        *lock(flag) = paused;
        resumed.notify_all();
    }

    /// The bytes of plugin files the walks and copies read so far.
    pub(crate) fn hashed(&self) -> u64 {
        self.hashed.load(Ordering::Relaxed)
    }

    /// Whether a walk or a copy runs.
    pub(crate) fn walking(&self) -> bool {
        lock(&self.state).values().any(|entry| entry.running)
            || lock(&self.stages).values().any(|(_, staged)| staged.is_none())
            || self.waking.load(Ordering::SeqCst) > 0
    }

    fn ask(&self, dir: &Path, full: bool) -> Answer {
        let mut state = lock(&self.state);
        let entry = state.entry(dir.to_path_buf()).or_default();
        entry.full |= full;
        let answer = (entry.light.clone(), entry.artifact.clone());
        if entry.running {
            entry.again = true;
            return answer;
        }
        entry.running = true;
        drop(state);
        let (state, hashed, wake, owned) = (self.state.clone(), self.hashed.clone(), self.wake.clone(), dir.to_owned());
        let waking = self.waking.clone();
        let spawned = std::thread::Builder::new()
            .name("plugin-tree".to_owned())
            .spawn(move || walks(&state, &hashed, &waking, &*wake, &owned));
        // Without a thread (the system has none to give), the walk runs here: an answer is never left stale.
        if spawned.is_err() {
            walks(&self.state, &self.hashed, &self.waking, &|| {}, dir);
            let state = lock(&self.state);
            return state.get(dir).map_or(answer, |entry| (entry.light.clone(), entry.artifact.clone()));
        }
        answer
    }
}

/// Walks `dir` until no question came during the last walk.
fn walks(
    state: &Mutex<HashMap<PathBuf, Entry>>,
    hashed: &AtomicU64,
    waking: &AtomicUsize,
    wake: &dyn Fn(),
    dir: &Path,
) {
    loop {
        let (known, full, has, stale) = {
            let mut state = lock(state);
            let Some(entry) = state.get_mut(dir) else { return };
            (entry.stamp, entry.full, entry.artifact.is_some(), std::mem::take(&mut entry.stale))
        };
        let (stamp, racy) = match stamp(dir) {
            Ok((stamp, racy)) => (Some(stamp), racy),
            Err(_) => (None, true),
        };
        let new = racy || stale || stamp != known || (full && !has);
        let found = new.then(|| {
            let before = approval::hashed();
            let light = light(dir);
            if stale {
                approval::forget(dir);
            }
            let artifact = full.then(|| Artifact::tree(dir));
            hashed.fetch_add(approval::hashed() - before, Ordering::Relaxed);
            (light, artifact)
        });
        let (changed, again) = {
            let mut state = lock(state);
            let Some(entry) = state.get_mut(dir) else { return };
            let mut changed = false;
            if let Some((light, artifact)) = found {
                let other = artifact.is_some() && entry.artifact != artifact;
                changed = entry.light.as_ref() != Some(&light) || other;
                entry.changes += u64::from(other);
                entry.stamp = stamp;
                entry.light = Some(light);
                if artifact.is_some() {
                    entry.artifact = artifact;
                }
            }
            let again = std::mem::take(&mut entry.again);
            // Counted while the walk still runs, so no one sees it end before its wake is posted.
            if changed {
                waking.fetch_add(1, Ordering::SeqCst);
            }
            entry.running = again;
            (changed, again)
        };
        if changed {
            wake();
            waking.fetch_sub(1, Ordering::SeqCst);
        }
        if !again {
            return;
        }
    }
}

/// Copies the approved `artifact` under `root`, begun at the tree's `changes`, and keeps the copy or why it failed for
/// the next question.
fn stage(stages: &Mutex<Stages>, hashed: &AtomicU64, artifact: &Artifact, root: &Path, changes: u64) {
    let before = approval::hashed();
    let staged = artifact.stage(root);
    hashed.fetch_add(approval::hashed() - before, Ordering::Relaxed);
    lock(stages).insert((artifact.path.clone(), artifact.sha256.clone()), (changes, Some(staged)));
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The metadata of `dir`'s own files and of its dependencies' packages: what a change of the tree changes. And whether
/// it is racy: a file changed within [`approval::RACY`], whose next change may keep its size and, on a coarse clock,
/// its time, so the stamp cannot vouch for it (as git's racy-clean entries).
fn stamp(dir: &Path) -> Result<(u64, bool), String> {
    let mut hasher = DefaultHasher::new();
    let mut racy = false;
    let recent = approval::now() - approval::RACY;
    let mut visit = |_: &Path, metadata: &std::fs::Metadata, hasher: &mut DefaultHasher| {
        meta(metadata, hasher);
        racy |= metadata.modified().map_or(true, |modified| modified >= recent);
        Ok(())
    };
    own(dir, &mut hasher, 0, &mut visit)?;
    // A package of the npm cache is approved with its install's manifest and lockfile.
    if let Some(root) = approval::install_root(dir) {
        for file in ["package.json", "package-lock.json"].map(|name| root.join(name)) {
            if let Ok(metadata) = std::fs::metadata(&file) {
                visit(&file, &metadata, &mut hasher)?;
            }
        }
    }
    Ok((hasher.finish(), racy))
}

/// The bytes of `dir`'s own files, and its dependencies by their `package.json`.
pub(crate) fn light(dir: &Path) -> Result<u64, String> {
    let mut hasher = DefaultHasher::new();
    own(dir, &mut hasher, 0, &mut |path, metadata, hasher| {
        if metadata.len() > approval::LIMIT {
            return Err(format!("{}: larger than {} MiB", path.display(), approval::LIMIT / 1024 / 1024));
        }
        approval::digest_file(path)?.hash(hasher);
        Ok(())
    })?;
    Ok(hasher.finish())
}

type Visit<'a> = dyn FnMut(&Path, &std::fs::Metadata, &mut DefaultHasher) -> Result<(), String> + 'a;

/// Visits `dir`'s own files in name order with `file`, hidden ones too; a `node_modules` directory is its
/// dependencies ([`packages`]).
fn own(dir: &Path, hasher: &mut DefaultHasher, depth: usize, file: &mut Visit<'_>) -> Result<(), String> {
    for (name, path, metadata) in entries(dir, depth)? {
        name.hash(hasher);
        if metadata.is_dir() && name == "node_modules" {
            packages(&path, hasher, depth + 1, file)?;
        } else if metadata.is_dir() {
            own(&path, hasher, depth + 1, file)?;
        } else if metadata.is_file() {
            file(&path, &metadata, hasher)?;
        }
    }
    Ok(())
}

/// Visits the packages of the dependency directory `dir` (`@scope/name` too, and each one's own `node_modules`): its
/// directory's metadata, and its `package.json` with `file`.
fn packages(dir: &Path, hasher: &mut DefaultHasher, depth: usize, file: &mut Visit<'_>) -> Result<(), String> {
    for (name, path, metadata) in entries(dir, depth)? {
        if !metadata.is_dir() || name.to_string_lossy().starts_with('.') {
            continue;
        }
        if name.to_string_lossy().starts_with('@') {
            packages(&path, hasher, depth + 1, file)?;
            continue;
        }
        name.hash(hasher);
        meta(&metadata, hasher);
        let manifest = path.join("package.json");
        if let Ok(metadata) = std::fs::metadata(&manifest) {
            file(&manifest, &metadata, hasher)?;
        }
        let nested = path.join("node_modules");
        if nested.is_dir() {
            packages(&nested, hasher, depth + 1, file)?;
        }
    }
    Ok(())
}

/// The entries of `dir` in name order, each with its metadata (a link followed, as Bun follows it).
fn entries(dir: &Path, depth: usize) -> Result<Vec<(std::ffi::OsString, PathBuf, std::fs::Metadata)>, String> {
    if depth > DEPTH {
        return Err(format!("{}: nested too deep", dir.display()));
    }
    let error = |error: std::io::Error| format!("{}: {error}", dir.display());
    let mut entries: Vec<_> = std::fs::read_dir(dir).map_err(error)?.collect::<Result<_, _>>().map_err(error)?;
    entries.sort_by_key(|entry| entry.file_name());
    entries
        .into_iter()
        .map(|entry| {
            let metadata = std::fs::metadata(entry.path()).map_err(error)?;
            Ok((entry.file_name(), entry.path(), metadata))
        })
        .collect()
}

fn meta(metadata: &std::fs::Metadata, hasher: &mut DefaultHasher) {
    (metadata.is_dir(), metadata.len()).hash(hasher);
    metadata.modified().ok().hash(hasher);
    #[cfg(unix)]
    std::os::unix::fs::MetadataExt::ino(metadata).hash(hasher);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_stale_walk_reads_every_file_on_the_same_thread() {
        let root = opencode_util::temp::tempdir().unwrap();
        let (dir, file) = (root.path(), root.path().join("tui.ts"));
        let old = std::time::SystemTime::now() - std::time::Duration::from_secs(10);
        let write = |text: &str| {
            std::fs::write(&file, text).unwrap();
            std::fs::File::options().write(true).open(&file).unwrap().set_modified(old).unwrap();
        };
        write("a");
        let state = Mutex::new(HashMap::from([(dir.to_path_buf(), Entry { full: true, ..Entry::default() })]));
        let walk = |stale: bool| {
            lock(&state).get_mut(dir).unwrap().stale = stale;
            walks(&state, &AtomicU64::new(0), &AtomicUsize::new(0), &|| {}, dir);
            lock(&state)[dir].artifact.clone().unwrap().unwrap().sha256
        };
        let first = walk(false);
        write("b");
        assert_eq!(walk(false), first);
        assert_ne!(walk(true), first);
    }

    #[test]
    fn a_failed_copy_counts_only_for_the_files_it_failed_on() {
        let root = opencode_util::temp::tempdir().unwrap();
        let (dir, staging) = (root.path().join("p"), root.path().join("staged"));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("tui.ts"), "a").unwrap();
        let trees = Trees::new(|| {});
        let settle = || {
            while trees.walking() {
                std::thread::yield_now();
            }
        };
        trees.artifact(&dir);
        settle();
        let artifact = trees.artifact(&dir).unwrap().unwrap();
        settle();
        let key = (artifact.path.clone(), artifact.sha256.clone());
        let failed = |began: u64| lock(&trees.stages).insert(key.clone(), (began, Some(Err("failed".to_owned()))));
        let changes = lock(&trees.state)[&dir].changes;
        failed(changes);
        assert_eq!(trees.staged(&artifact, &staging), Some(Err("failed".to_owned())));
        failed(changes);
        trees.rewalk(&dir);
        settle();
        assert!(!lock(&trees.stages).contains_key(&key), "a hash again kept the failure");
        failed(changes - 1);
        assert_eq!(trees.staged(&artifact, &staging), None, "a failure on files since changed was given");
        settle();
        assert_eq!(trees.staged(&artifact, &staging), Some(Ok(staging.join(&artifact.sha256))));
    }

    #[test]
    fn a_walk_or_a_copy_runs_until_its_wake_is_posted() {
        let root = opencode_util::temp::tempdir().unwrap();
        let (dir, staging) = (root.path().join("p"), root.path().join("staged"));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("tui.ts"), "a").unwrap();
        let (entered, waking) = std::sync::mpsc::channel::<()>();
        let (release, go) = std::sync::mpsc::channel::<()>();
        let (entered, go) = (Mutex::new(entered), Mutex::new(go));
        let trees = Trees::new(move || {
            let _ = lock(&entered).send(());
            let _ = lock(&go).recv();
        });
        let ended = |trees: &Trees| {
            let begun = std::time::Instant::now();
            while trees.walking() {
                assert!(begun.elapsed() < std::time::Duration::from_secs(10), "it never ended");
                std::thread::yield_now();
            }
        };
        let posting = |trees: &Trees| {
            waking.recv_timeout(std::time::Duration::from_secs(10)).expect("a wake");
            assert!(trees.walking(), "it ended before its wake was posted");
            release.send(()).unwrap();
            ended(trees);
        };
        assert_eq!(trees.artifact(&dir), None);
        posting(&trees);
        let artifact = trees.artifact(&dir).unwrap().unwrap();
        assert_eq!(trees.staged(&artifact, &staging), None);
        posting(&trees);
        assert!(trees.staged(&artifact, &staging).unwrap().is_ok());
    }
}
