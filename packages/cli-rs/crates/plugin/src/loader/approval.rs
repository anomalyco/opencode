//! Approval of project plugins (rich-plugins 3.9, decision O-125): a native build found in a project's
//! `.opencode/plugins` runs only once the user approved it. A decision names an [`Artifact`]: the directory it was
//! found as, the real path of its library, and the SHA-256 of the bytes that are loaded. A changed library, another
//! path to it, or the same library found as another plugin directory (another project's) is pending again. The global
//! `plugins` directory and `cli.json` entries need none: a project cannot write them.
//!
//! The decisions are kept in one file of the client's state directory, read at each lookup, so another client's
//! decision applies at the next reconcile. An update is one read, change and replace under a lock, so concurrent
//! clients never lose or bring back each other's decisions. The file is private to the user; a store the project could
//! reach, or that others can write, is not used, and decisions then last as long as the client.

use std::cell::RefCell;
use std::fs::File;
use std::io::{Read, Seek};
use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The file of the decisions in the client's state directory.
pub const FILE: &str = "plugin-approvals.json";

/// The largest library the loader reads (carbon-5): a bigger file is refused before anything is allocated for it.
pub const LIMIT: u64 = 512 * 1024 * 1024;

/// What an approval names: the plugin directory it was found as, the real path of its library, and the SHA-256 of the
/// library's bytes in hex.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Artifact {
    pub target: PathBuf,
    pub path: PathBuf,
    pub sha256: String,
}

impl Artifact {
    /// Opens the library `file` of plugin directory `target` once and hashes what it reads (bigboi-5). The returned
    /// handle is the file that was hashed, for [`Artifact::bytes`]. An error when the file is not a regular file, is
    /// over [`LIMIT`], or its name led to another file by the time it was read.
    pub fn open(target: &Path, file: &Path) -> Result<(Self, File), String> {
        let error = |error: std::io::Error| format!("{}: {error}", file.display());
        let path = std::fs::canonicalize(file).map_err(error)?;
        #[cfg(windows)]
        let index = opencode_util::win::file_index(&path).map_err(error)?;
        let mut handle = File::open(&path).map_err(error)?;
        let metadata = handle.metadata().map_err(error)?;
        if !metadata.is_file() {
            return Err(format!("{}: not a regular file", path.display()));
        }
        if metadata.len() > LIMIT {
            return Err(format!("{}: larger than {} MiB", path.display(), LIMIT / 1024 / 1024));
        }
        let sha256 = sha256(&mut handle).map_err(|error| format!("{}: {error}", path.display()))?;
        #[cfg(test)]
        AFTER_HASH.with_borrow(|after| after.as_ref().map(|after| after()));
        // The name still leads to the file that was read: a link or a directory swapped meanwhile is another file.
        let same = std::fs::canonicalize(file).map_err(error)? == path && {
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                let now = std::fs::metadata(&path).map_err(error)?;
                (now.dev(), now.ino()) == (metadata.dev(), metadata.ino())
            }
            #[cfg(windows)]
            {
                opencode_util::win::file_index(&path).map_err(error)? == index
            }
            #[cfg(not(any(unix, windows)))]
            true
        };
        if !same {
            return Err(format!("{}: changed while it was read", file.display()));
        }
        Ok((Self { target: target.to_path_buf(), path, sha256 }, handle))
    }

    /// The bytes of `handle`, the file [`Artifact::open`] hashed, once they are checked to be the ones it hashed: what
    /// is loaded is what was approved (bigboi-1).
    pub fn bytes(&self, handle: &mut File) -> Result<Vec<u8>, String> {
        let error = |error: std::io::Error| format!("{}: {error}", self.path.display());
        handle.rewind().map_err(error)?;
        let mut bytes = Vec::new();
        handle.take(LIMIT + 1).read_to_end(&mut bytes).map_err(error)?;
        match sha256(&mut bytes.as_slice()) {
            Ok(digest) if digest == self.sha256 => Ok(bytes),
            _ => Err(format!("{}: changed since it was hashed", self.path.display())),
        }
    }

    /// The first 16 hex digits of the hash, to show.
    pub fn short(&self) -> &str {
        &self.sha256[..self.sha256.len().min(16)]
    }
}

#[cfg(test)]
thread_local! {
    /// Runs in [`Artifact::open`] once the file is hashed, to change the disk at that moment.
    pub(crate) static AFTER_HASH: RefCell<Option<Box<dyn Fn()>>> = RefCell::new(None);
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

/// One decision as it is stored. Paths are kept losslessly (bigboi-7): as text when they are Unicode, else as `hex:`
/// and the platform's encoded bytes, which no absolute path starts with.
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

    /// Whether it names the same plugin directory and library path as `other`.
    fn same_place(&self, other: &Stored) -> bool {
        (&self.target, &self.path) == (&other.target, &other.path)
    }
}

fn encode(path: &Path) -> String {
    match path.to_str() {
        Some(text) => text.to_owned(),
        None => {
            let bytes = path.as_os_str().as_encoded_bytes();
            format!("hex:{}", bytes.iter().map(|byte| format!("{byte:02x}")).collect::<String>())
        }
    }
}

/// The user's decisions, at most one for a plugin directory and library path: the last.
pub struct Approvals {
    store: Store,
}

enum Store {
    /// Decisions that last as long as the client, and why they are not saved, if they would be otherwise.
    Memory(RefCell<Vec<Value>>, Option<String>),
    File(PathBuf),
}

impl Default for Approvals {
    /// In memory, as a TUI without real roots keeps them.
    fn default() -> Self {
        Self { store: Store::Memory(RefCell::default(), None) }
    }
}

impl Approvals {
    /// The decisions kept in `file`, unless the project at `project` could reach it or other users can write its
    /// directory (bigboi-2): then they last as long as the client, and [`Approvals::unsaved`] says why.
    pub fn open(file: PathBuf, project: &Path) -> Self {
        match trusted(&file, project) {
            Ok(()) => Self { store: Store::File(file) },
            Err(reason) => {
                log::warn!("plugin approvals are not saved: {reason}");
                Self { store: Store::Memory(RefCell::default(), Some(reason)) }
            }
        }
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

/// Reads, changes and replaces the entries of `file` while holding its lock (bigboi-4, carbon-3). The new file is
/// written to a temporary file of its own, private to the user, and renamed over the old one; on any error the old
/// file stays and the temporary file goes.
fn update(file: &Path, change: impl FnOnce(&mut Vec<Value>) -> Result<(), String>) -> Result<(), String> {
    let _lock = lock(file)?;
    let mut entries = load(file)?;
    change(&mut entries)?;
    let text = serde_json::to_vec_pretty(&entries).map_err(|error| error.to_string())?;
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let next = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let temp = file.with_file_name(format!(".{FILE}.{}.{next}.tmp", std::process::id()));
    let written = create_private(&temp).and_then(|mut handle| {
        std::io::Write::write_all(&mut handle, &text)?;
        handle.sync_all()?;
        std::fs::rename(&temp, file)
    });
    written.map_err(|error| {
        let _ = std::fs::remove_file(&temp);
        format!("{}: {error}", file.display())
    })
}

/// A new file at `path`, which must not exist, readable and writable by this user alone.
fn create_private(path: &Path) -> std::io::Result<File> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    options.open(path)
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
