//! Project plugins require approval for the discovered directory, its resolved path and the SHA-256 of its files. A
//! changed tree or path needs a new decision. Clients share decisions through a locked, user-private state file; if the
//! project can reach the file or others can write it, decisions stay in memory.

use std::cell::RefCell;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The file of the decisions in the client's state directory.
pub const FILE: &str = "plugin-approvals.json";

/// The most bytes of plugin files a hash reads: a larger tree is refused.
pub const LIMIT: u64 = 512 * 1024 * 1024;

/// What an approval names: the plugin directory it was found as, the real path of that directory, and the SHA-256 of
/// its files.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Artifact {
    pub target: PathBuf,
    pub path: PathBuf,
    pub sha256: String,
}

impl Artifact {
    /// The TypeScript plugin directory `target`, which the JS host would run: its real path, and the SHA-256 of what
    /// it holds. Each file's path and bytes count, in name order, hidden ones and its dependencies in `node_modules`
    /// too: whatever the JS host may import from it. The JS host reads the files itself, so a change after the hash is
    /// what the next reconcile sees: the watcher's, which holds the new files back. A file outside the directory that
    /// the plugin imports is not part of it.
    pub fn tree(target: &Path) -> Result<Self, String> {
        let error = |error: std::io::Error| format!("{}: {error}", target.display());
        let path = std::fs::canonicalize(target).map_err(error)?;
        if !path.is_dir() {
            return Err(format!("{}: not a directory", path.display()));
        }
        // A tree whose entries did not change since its last hash is not read again: every reconcile asks for it, and
        // the JS host's answers each start one. What runs is still what was approved: [`Artifact::stage`] hashes the
        // bytes it copies.
        let print = fingerprint(&path)?;
        let known =
            TREES.with(|trees| trees.borrow().get(&path).filter(|(at, _)| *at == print).map(|(_, sha)| sha.clone()));
        let sha256 = match known {
            Some(sha256) => sha256,
            None => {
                let sha256 = tree_sha256(&path, None)?;
                TREES.with(|trees| trees.borrow_mut().insert(path.clone(), (print, sha256.clone())));
                sha256
            }
        };
        let sha256 = match install_root(&path) {
            Some(root) => install_sha256(&sha256, &root)?,
            None => sha256,
        };
        Ok(Self { target: target.to_path_buf(), path, sha256 })
    }

    /// The tree [`Artifact::tree`] hashed, as a copy under `root` named by its hash, which the JS host imports instead
    /// of the directory: a save between the approval and the import changes the directory, not the copy. The copy is
    /// written from the bytes its hash is taken of as they are copied, and kept only if that hash is the one approved;
    /// else the directory changed since, and nothing of it runs. A copy made before is used again.
    pub fn stage(&self, root: &Path) -> Result<PathBuf, String> {
        let staged = root.join(&self.sha256);
        if staged.is_dir() {
            return Ok(staged);
        }
        let error = |error: std::io::Error| format!("{}: {error}", root.display());
        std::fs::create_dir_all(root).map_err(error)?;
        let partial = root.join(format!(
            ".{}.{}.{}",
            self.sha256,
            std::process::id(),
            STAGES.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&partial);
        std::fs::create_dir(&partial).map_err(error)?;
        let copied = tree_sha256(&self.path, Some(&partial));
        if copied.as_deref() != Ok(self.sha256.as_str()) {
            let _ = std::fs::remove_dir_all(&partial);
            return Err(match copied {
                Ok(_) => format!("{}: changed since it was approved", self.path.display()),
                Err(error) => error,
            });
        }
        // Another client may have staged the same tree meanwhile: its copy holds the same bytes.
        if std::fs::rename(&partial, &staged).is_err() && staged.is_dir() {
            let _ = std::fs::remove_dir_all(&partial);
        }
        staged.is_dir().then_some(staged).ok_or_else(|| format!("{}: cannot be staged", self.path.display()))
    }

    /// The first 16 hex digits of the hash, to show.
    pub fn short(&self) -> &str {
        &self.sha256[..self.sha256.len().min(16)]
    }
}

thread_local! {
    /// The last hash of each plugin tree, with the fingerprint of its entries then.
    static TREES: RefCell<std::collections::HashMap<PathBuf, (u64, String)>> = RefCell::default();
    /// The bytes of plugin files this thread read to hash them, for the rows that count the work.
    static HASHED: std::cell::Cell<u64> = const { std::cell::Cell::new(0) };
}

/// Forgets this thread's last hash of the tree `target`: the next [`Artifact::tree`] of it reads every file, however
/// its entries' metadata stayed.
#[cfg(any(feature = "ts", luau))]
pub(crate) fn forget(target: &Path) {
    if let Ok(path) = std::fs::canonicalize(target) {
        TREES.with(|trees| trees.borrow_mut().remove(&path));
    }
}

/// The bytes of plugin files this thread read to hash them so far.
#[doc(hidden)]
pub fn hashed() -> u64 {
    HASHED.with(std::cell::Cell::get)
}

/// What [`Artifact::tree`] reads, by the metadata of each entry alone: its path, kind, size, modification time and
/// file, as [`walk`] visits them. A save changes it; a reconcile that changed nothing finds it the same.
fn fingerprint(path: &Path) -> Result<u64, String> {
    use std::hash::{Hash, Hasher};
    fn visit(dir: &Path, hasher: &mut std::collections::hash_map::DefaultHasher, depth: usize) -> Result<(), String> {
        if depth > 32 {
            return Err(format!("{}: nested too deep", dir.display()));
        }
        let error = |error: std::io::Error| format!("{}: {error}", dir.display());
        let mut entries: Vec<_> = std::fs::read_dir(dir).map_err(error)?.collect::<Result<_, _>>().map_err(error)?;
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let metadata = std::fs::metadata(entry.path()).map_err(error)?;
            entry.file_name().hash(hasher);
            (metadata.is_dir(), metadata.len()).hash(hasher);
            metadata.modified().ok().hash(hasher);
            #[cfg(unix)]
            std::os::unix::fs::MetadataExt::ino(&metadata).hash(hasher);
            if metadata.is_dir() {
                visit(&entry.path(), hasher, depth + 1)?;
            }
        }
        Ok(())
    }
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    visit(path, &mut hasher, 0)?;
    Ok(hasher.finish())
}

/// Names each copy [`Artifact::stage`] starts apart.
static STAGES: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// The hash of the plugin directory `path`, copied under `copy` as it is read when there is one.
/// The install a package of the npm cache belongs to (`<cache>/npm/<key>/<generation>/node_modules/<name>`, a scoped
/// name one level deeper): the generation, whose `package.json` and lockfile name the package's dependencies, which sit
/// beside it rather than in it. `None` for any other directory, a project's plugin and a staged copy included.
pub(crate) fn install_root(dir: &Path) -> Option<PathBuf> {
    let dir = std::fs::canonicalize(dir).ok()?;
    let parent = dir.parent()?;
    let modules = match parent.file_name()?.to_str()?.starts_with('@') {
        true => parent.parent()?,
        false => parent,
    };
    let root = (modules.file_name()? == "node_modules").then(|| modules.parent()).flatten()?;
    let generation = root.file_name()?.to_str()?;
    (!generation.is_empty() && generation.bytes().all(|byte| byte.is_ascii_digit())).then(|| root.to_path_buf())
}

/// The approval hash of a package of the npm cache: its own tree's, and its dependencies by the install's
/// `package.json` and lockfile.
fn install_sha256(tree: &str, root: &Path) -> Result<String, String> {
    let mut context = ring::digest::Context::new(&ring::digest::SHA256);
    context.update(b"opencode-ts-package\0");
    context.update(tree.as_bytes());
    for name in ["package.json", "package-lock.json"] {
        context.update(b"\0");
        context.update(name.as_bytes());
        context.update(b"\0");
        match std::fs::read(root.join(name)) {
            Ok(bytes) => context.update(&bytes),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => context.update(b"-"),
            Err(error) => return Err(format!("{}: {error}", root.join(name).display())),
        }
    }
    Ok(context.finish().as_ref().iter().map(|byte| format!("{byte:02x}")).collect())
}

fn tree_sha256(path: &Path, copy: Option<&Path>) -> Result<String, String> {
    let mut context = ring::digest::Context::new(&ring::digest::SHA256);
    context.update(b"opencode-ts-plugin\0");
    let mut total = 0;
    walk(path, Path::new(""), &mut context, &mut total, 0, copy)?;
    Ok(context.finish().as_ref().iter().map(|byte| format!("{byte:02x}")).collect())
}

/// Hashes the entries of `dir` (at `relative` in the plugin) into `context`; `total` counts the bytes read, refused past
/// [`LIMIT`]. A link is followed (Bun follows it) to a depth of 32, past which the tree is refused. With `copy`, each
/// file is written there, at its place in the plugin, from the bytes that are hashed.
fn walk(
    dir: &Path,
    relative: &Path,
    context: &mut ring::digest::Context,
    total: &mut u64,
    depth: usize,
    copy: Option<&Path>,
) -> Result<(), String> {
    if depth > 32 {
        return Err(format!("{}: nested too deep", dir.display()));
    }
    let error = |error: std::io::Error| format!("{}: {error}", dir.display());
    let mut entries: Vec<_> = std::fs::read_dir(dir).map_err(error)?.collect::<Result<_, _>>().map_err(error)?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let name = entry.file_name();
        let (path, inner) = (entry.path(), relative.join(&name));
        let metadata = std::fs::metadata(&path).map_err(error)?;
        context.update(encode(&inner).as_bytes());
        context.update(b"\0");
        let to = copy.map(|copy| copy.join(&name));
        if metadata.is_dir() {
            if let Some(to) = &to {
                std::fs::create_dir(to).map_err(error)?;
            }
            walk(&path, &inner, context, total, depth + 1, to.as_deref())?;
        } else if metadata.is_file() {
            *total += metadata.len();
            if *total > LIMIT {
                return Err(format!("{}: larger than {} MiB", dir.display(), LIMIT / 1024 / 1024));
            }
            let mut file = File::open(&path).map_err(error)?;
            let digest = match &to {
                Some(to) => {
                    let mut out = std::io::BufWriter::new(File::create_new(to).map_err(error)?);
                    let digest = sha256(&mut Tee(&mut file, &mut out))?;
                    std::io::Write::flush(&mut out).map_err(error)?;
                    digest
                }
                None => sha256(&mut file)?,
            };
            context.update(digest.as_bytes());
        }
    }
    Ok(())
}

/// A reader that writes what it reads to `.1`: a copy of exactly the bytes hashed.
struct Tee<'a, R, W>(&'a mut R, &'a mut W);

impl<R: Read, W: std::io::Write> Read for Tee<'_, R, W> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        let read = self.0.read(buffer)?;
        self.1.write_all(&buffer[..read])?;
        Ok(read)
    }
}

/// The SHA-256 in hex of the file at `path`, counted in [`hashed`].
#[cfg(any(feature = "ts", luau))]
pub(crate) fn digest_file(path: &Path) -> Result<String, String> {
    let mut file = File::open(path).map_err(|error| format!("{}: {error}", path.display()))?;
    sha256(&mut file).map_err(|error| format!("{}: {error}", path.display()))
}

/// The SHA-256 in hex of what `reader` holds, refused past [`LIMIT`].
fn sha256(reader: &mut impl Read) -> Result<String, String> {
    let mut context = ring::digest::Context::new(&ring::digest::SHA256);
    let mut buffer = vec![0; 64 * 1024];
    let mut total: u64 = 0;
    loop {
        let read = reader.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        HASHED.with(|hashed| hashed.set(hashed.get() + read as u64));
        total += read as u64;
        if total > LIMIT {
            return Err(format!("larger than {} MiB", LIMIT / 1024 / 1024));
        }
        context.update(&buffer[..read]);
    }
    Ok(context.finish().as_ref().iter().map(|byte| format!("{byte:02x}")).collect())
}

/// What the user decided for an artifact.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Decision {
    Approved,
    Declined,
}

/// One decision as it is stored. Paths are kept losslessly: as text when they are Unicode, else as `hex:` and the
/// platform's encoded bytes, which no absolute path starts with.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
struct Stored {
    target: String,
    path: String,
    sha256: String,
    decision: Decision,
}

impl Stored {
    fn of(artifact: &Artifact, decision: Decision) -> Self {
        Self {
            target: encode(&artifact.target),
            path: encode(&artifact.path),
            sha256: artifact.sha256.clone(),
            decision,
        }
    }

    /// Whether it names the same plugin directory and real path as `other`.
    fn same_place(&self, other: &Stored) -> bool {
        (&self.target, &self.path) == (&other.target, &other.path)
    }
}

/// `path` as a decision keys it: one directory spelled with Windows' verbatim prefix (`\\?\C:\x`) or without it is
/// one place (win11-runs D3); another letter case is the start directory's to settle, which names the project as the
/// file system does (`opencode_local::paths::current_dir`).
fn encode(path: &Path) -> String {
    match path.to_str() {
        Some(text) => opencode_util::path::strip_verbatim(text).into_owned(),
        None => {
            let bytes = path.as_os_str().as_encoded_bytes();
            format!("hex:{}", bytes.iter().map(|byte| format!("{byte:02x}")).collect::<String>())
        }
    }
}

/// The user's decisions, at most one for a plugin directory and real path: the last.
pub struct Approvals {
    store: Store,
    /// Where [`Artifact::stage`] copies approved trees when decisions are not saved: a private directory of this client.
    scratch: RefCell<Option<opencode_util::temp::TempDir>>,
}

enum Store {
    /// Decisions that last as long as the client, and why they are not saved, if they would be otherwise.
    Memory(RefCell<Vec<Value>>, Option<String>),
    File(PathBuf),
}

impl Default for Approvals {
    /// In memory, as a TUI without real roots keeps them.
    fn default() -> Self {
        Self { store: Store::Memory(RefCell::default(), None), scratch: RefCell::default() }
    }
}

impl Approvals {
    /// The decisions kept in `file`, unless the project at `project` could reach it or other users can write its
    /// directory: then they last as long as the client, and [`Approvals::unsaved`] says why.
    pub fn open(file: PathBuf, project: &Path) -> Self {
        match trusted(&file, project) {
            Ok(()) => Self { store: Store::File(file), scratch: RefCell::default() },
            Err(reason) => {
                log::warn!("plugin approvals are not saved: {reason}");
                Self { store: Store::Memory(RefCell::default(), Some(reason)), scratch: RefCell::default() }
            }
        }
    }

    /// Where approved TypeScript trees are staged ([`Artifact::stage`]): beside the decisions when they are saved, in
    /// the private state directory a project cannot reach; else in a private directory that lasts as long as the client.
    pub fn staging(&self) -> Result<PathBuf, String> {
        if let Store::File(file) = &self.store
            && let Some(directory) = file.parent()
        {
            return Ok(directory.join("plugin-staged"));
        }
        let mut scratch = self.scratch.borrow_mut();
        if scratch.is_none() {
            *scratch = Some(opencode_util::temp::tempdir().map_err(|error| error.to_string())?);
        }
        Ok(scratch.as_ref().map(|scratch| scratch.path().to_path_buf()).unwrap_or_default())
    }

    /// Why decisions are not saved, when a store was asked for and refused.
    pub fn unsaved(&self) -> Option<&str> {
        match &self.store {
            Store::Memory(_, reason) => reason.as_deref(),
            Store::File(_) => None,
        }
    }

    /// The decision for `artifact`, if the user made one for exactly it. A store that cannot be read holds none.
    pub fn decision(&self, artifact: &Artifact) -> Option<Decision> {
        let entries = match &self.store {
            Store::Memory(entries, _) => entries.borrow().clone(),
            Store::File(file) => match load(file) {
                Ok(entries) => entries,
                Err(error) => {
                    log::warn!("plugin approvals {}: {error}", file.display());
                    return None;
                }
            },
        };
        let wanted = Stored::of(artifact, Decision::Approved);
        entries
            .into_iter()
            .filter_map(|entry| serde_json::from_value::<Stored>(entry).ok())
            .find(|stored| stored.same_place(&wanted) && stored.sha256 == wanted.sha256)
            .map(|stored| stored.decision)
    }

    /// Records `decision` for `artifact`; it replaces the decision for its place and keeps every other entry, also
    /// one this client cannot read. Nothing changes when it fails.
    pub fn decide(&self, artifact: &Artifact, decision: Decision) -> Result<(), String> {
        let stored = Stored::of(artifact, decision);
        let change = |entries: &mut Vec<Value>| {
            // An entry this client cannot read stays, as a newer client wrote it.
            entries.retain(|entry| {
                serde_json::from_value::<Stored>(entry.clone()).map_or(true, |known| !known.same_place(&stored))
            });
            entries.push(serde_json::to_value(&stored).map_err(|error| error.to_string())?);
            Ok(())
        };
        match &self.store {
            Store::Memory(entries, _) => change(&mut entries.borrow_mut()),
            Store::File(file) => update(file, change),
        }
    }
}

/// Whether `file` may hold decisions: an absolute path whose directory the project cannot reach and only this user can
/// write.
fn trusted(file: &Path, project: &Path) -> Result<(), String> {
    if !file.is_absolute() {
        return Err(format!("{} is not an absolute path", file.display()));
    }
    let directory = file.parent().ok_or_else(|| format!("{} has no directory", file.display()))?;
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
    builder.create(directory).map_err(|error| format!("{}: {error}", directory.display()))?;
    let real = std::fs::canonicalize(directory).map_err(|error| format!("{}: {error}", directory.display()))?;
    let project = std::fs::canonicalize(project).unwrap_or_else(|_| project.to_path_buf());
    if real.starts_with(&project) {
        return Err(format!("the state directory {} is inside the project", real.display()));
    }
    #[cfg(unix)]
    private(&std::fs::metadata(&real).map_err(|error| error.to_string())?)
        .map_err(|error| format!("the state directory {}: {error}", real.display()))?;
    Ok(())
}

/// Whether what `metadata` describes belongs to this user and nobody else can write it.
#[cfg(unix)]
fn private(metadata: &std::fs::Metadata) -> Result<(), String> {
    use std::os::unix::fs::MetadataExt;
    // SAFETY: `geteuid` has no preconditions and cannot fail.
    #[allow(unsafe_code)]
    let user = unsafe { libc::geteuid() };
    if metadata.uid() != user {
        return Err("belongs to another user".to_owned());
    }
    if metadata.mode() & 0o022 != 0 {
        return Err("other users can write it".to_owned());
    }
    Ok(())
}

/// The stored entries. A missing file holds none; one that is not a private regular file, cannot be read, or is not
/// a JSON list is an error, never an empty store.
fn load(file: &Path) -> Result<Vec<Value>, String> {
    let metadata = match std::fs::symlink_metadata(file) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        result => result.map_err(|error| error.to_string())?,
    };
    if !metadata.file_type().is_file() {
        return Err("not a regular file".to_owned());
    }
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::custom_flags(&mut options, libc::O_NOFOLLOW);
    let handle = options.open(file).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    private(&handle.metadata().map_err(|error| error.to_string())?)?;
    let mut bytes = Vec::new();
    handle.take(16 * 1024 * 1024).read_to_end(&mut bytes).map_err(|error| error.to_string())?;
    serde_json::from_slice(&bytes).map_err(|error| format!("not a list of decisions: {error}"))
}

/// Reads, changes and replaces the entries of `file` while holding its lock. The new file is written to a temporary
/// file of its own, private to the user, and renamed over the old one; on any error the old file stays and the
/// temporary file goes.
fn update(file: &Path, change: impl FnOnce(&mut Vec<Value>) -> Result<(), String>) -> Result<(), String> {
    let _lock = lock(file)?;
    let mut entries = load(file)?;
    change(&mut entries)?;
    let text = serde_json::to_vec_pretty(&entries).map_err(|error| error.to_string())?;
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let next = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let temp = file.with_file_name(format!(".{FILE}.{}.{next}.tmp", std::process::id()));
    // A new file, which must not exist, readable and writable by this user alone.
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    opencode_util::busy::replace(file, &temp, &options, &text).map_err(|error| format!("{}: {error}", file.display()))
}

/// The lock of `file`, a file beside it, held until the result drops. Another client holds it only while it writes,
/// so a wait over 3 s means it hangs; the user is told the decision was not saved, and can answer again.
fn lock(file: &Path) -> Result<File, String> {
    let path = file.with_file_name(format!("{FILE}.lock"));
    let mut options = std::fs::OpenOptions::new();
    options.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let handle = options.open(&path).map_err(|error| format!("{}: {error}", path.display()))?;
    for _ in 0..300 {
        match handle.try_lock() {
            Ok(()) => return Ok(handle),
            Err(std::fs::TryLockError::WouldBlock) => std::thread::sleep(Duration::from_millis(10)),
            Err(std::fs::TryLockError::Error(error)) => return Err(format!("{}: {error}", path.display())),
        }
    }
    Err(format!("{}: another opencode holds it", path.display()))
}
