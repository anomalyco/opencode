//! What a TypeScript plugin's directory holds, worked out on a thread of its own (FT-2): the UI thread never walks a
//! plugin's files, so no frame, the first included, waits on it. A question answers what the last walk found, at once,
//! and starts another walk when none runs; a walk that finds something new wakes the UI thread, which reconciles.
//!
//! - A **global** plugin's build is its own files' bytes, and its dependencies by version: each installed package's
//!   `package.json` and the lockfiles, not every file under `node_modules` (a dozen plugins hold 250,000 there). A
//!   save that changes nothing loads nothing; an install that changes a dependency loads it again.
//! - A **project** plugin's is the SHA-256 of every file, its dependencies' too, as its approval names it
//!   ([`Artifact::tree`]). It is taken again only once a stamp of the tree changed. What the JS host imports is the
//!   staged copy of the approved bytes, which [`Artifact::stage`] checks as it copies them, so an answer that is
//!   older than the disk never runs bytes that were not approved.
//!
//! The stamp is the metadata of the plugin's own files and of each dependency's package directory and `package.json`.

use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use crate::loader::approval::{self, Artifact};

/// The deepest a plugin's tree is walked, as [`Artifact::tree`] walks it.
const DEPTH: usize = 32;

pub(crate) struct Trees {
    state: Arc<Mutex<HashMap<PathBuf, Entry>>>,
    /// The bytes of plugin files the walks read.
    hashed: Arc<AtomicU64>,
    wake: Arc<dyn Fn() + Send + Sync>,
}

/// What the last walk found of a tree: its light build and its artifact, each `None` until a walk took it.
type Answer = (Option<Result<u64, String>>, Option<Result<Artifact, String>>);

#[derive(Default)]
struct Entry {
    running: bool,
    /// A question came while a walk ran: one more walk follows it.
    again: bool,
    /// The full hash is asked for: the plugin is a project's.
    full: bool,
    stamp: Option<u64>,
    light: Option<Result<u64, String>>,
    artifact: Option<Result<Artifact, String>>,
}

impl Trees {
    /// `wake` runs on a walk's thread when a walk found something new.
    pub(crate) fn new(wake: impl Fn() + Send + Sync + 'static) -> Self {
        Self { state: Arc::default(), hashed: Arc::default(), wake: Arc::new(wake) }
    }

    /// The build of the global plugin `dir` as the last walk found it, or `None` before the first walk ended.
    pub(crate) fn light(&self, dir: &Path) -> Option<Result<u64, String>> {
        self.ask(dir, false).0
    }

    /// The approval artifact of the project plugin `dir` as the last walk found it, or `None` before one ended.
    pub(crate) fn artifact(&self, dir: &Path) -> Option<Result<Artifact, String>> {
        self.ask(dir, true).1
    }

    /// The bytes of plugin files the walks read so far.
    pub(crate) fn hashed(&self) -> u64 {
        self.hashed.load(Ordering::Relaxed)
    }

    /// Whether a walk runs.
    pub(crate) fn walking(&self) -> bool {
        lock(&self.state).values().any(|entry| entry.running)
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
        let spawned = std::thread::Builder::new()
            .name("plugin-tree".to_owned())
            .spawn(move || walks(&state, &hashed, &*wake, &owned));
        // Without a thread (the system has none to give), the walk runs here: an answer is never left stale.
        if spawned.is_err() {
            walks(&self.state, &self.hashed, &|| {}, dir);
            let state = lock(&self.state);
            return state.get(dir).map_or(answer, |entry| (entry.light.clone(), entry.artifact.clone()));
        }
        answer
    }
}

/// Walks `dir` until no question came during the last walk.
fn walks(state: &Mutex<HashMap<PathBuf, Entry>>, hashed: &AtomicU64, wake: &dyn Fn(), dir: &Path) {
    loop {
        let (known, full, has) = {
            let state = lock(state);
            let Some(entry) = state.get(dir) else { return };
            (entry.stamp, entry.full, entry.artifact.is_some())
        };
        let (stamp, racy) = match stamp(dir) {
            Ok((stamp, racy)) => (Some(stamp), racy),
            Err(_) => (None, true),
        };
        let new = racy || stamp != known || (full && !has);
        let found = new.then(|| {
            let before = approval::hashed();
            let light = light(dir);
            let artifact = full.then(|| Artifact::tree(dir));
            hashed.fetch_add(approval::hashed() - before, Ordering::Relaxed);
            (light, artifact)
        });
        let (changed, again) = {
            let mut state = lock(state);
            let Some(entry) = state.get_mut(dir) else { return };
            let mut changed = false;
            if let Some((light, artifact)) = found {
                changed = entry.light.as_ref() != Some(&light) || (artifact.is_some() && entry.artifact != artifact);
                entry.stamp = stamp;
                entry.light = Some(light);
                if artifact.is_some() {
                    entry.artifact = artifact;
                }
            }
            let again = std::mem::take(&mut entry.again);
            entry.running = again;
            (changed, again)
        };
        if changed {
            wake();
        }
        if !again {
            return;
        }
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The metadata of `dir`'s own files and of its dependencies' packages: what a change of the tree changes. And whether
/// it is racy: a file changed within [`RACY`], whose next change may keep its size and, on a coarse clock, its time,
/// so the stamp cannot vouch for it (as git's racy-clean entries).
fn stamp(dir: &Path) -> Result<(u64, bool), String> {
    let mut hasher = DefaultHasher::new();
    let mut racy = false;
    let recent = std::time::SystemTime::now() - RACY;
    own(dir, &mut hasher, 0, &mut |_, metadata, hasher| {
        meta(metadata, hasher);
        racy |= metadata.modified().map_or(true, |modified| modified >= recent);
        Ok(())
    })?;
    Ok((hasher.finish(), racy))
}

/// How recent a change makes a stamp racy.
const RACY: std::time::Duration = std::time::Duration::from_secs(2);

/// The bytes of `dir`'s own files, and its dependencies by their `package.json`.
fn light(dir: &Path) -> Result<u64, String> {
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
