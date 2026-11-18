//! Luau plugins (spike `luau-spike`, `steps/luau-spike.md`): a fourth carrier of contract 2.0, beside linked Rust, the
//! C ABI and the pipe to the JS host. A plugin is a directory with `plugin.toml` and `init.luau`; it runs in process,
//! on the UI thread, in a Luau VM of its own a activation, on the built-ins' linked path ([`crate::linked`]), so its
//! calls, reads, effects, ownership and limits are theirs. The carrier adds a sandbox (no file system, `require` held
//! to the plugin's own files, frozen globals), a CPU-time budget it enforces itself with Luau's interrupt, and a heap
//! cap. Behind the cargo feature `luau`, and at run time `OPENCODE_PLUGIN_LUAU=1`.

mod bind;
pub mod client;
mod current;
mod decode;
mod inputs;
mod json;
mod vm;

#[cfg(test)]
mod tests;

use std::collections::{BTreeMap, HashMap};
use std::hash::{DefaultHasher, Hasher};
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

pub use vm::MEMORY;

use crate::loader::approval::Artifact;
use crate::{Definition, ErrorFn};

/// The run-time flag that turns Luau plugins on, in a build with the feature.
pub const FLAG: &str = "OPENCODE_PLUGIN_LUAU";

/// A Luau plugin's manifest file.
pub const MANIFEST: &str = "plugin.toml";

/// The configuration file of Luau's require-by-string (aliases), which a plugin's `require` reads inside the plugin.
pub const LUAURC: &str = ".luaurc";

/// The most a plugin's sources may hold. Compiling takes about 110 times the source in memory, for a moment, outside
/// the VM's cap (`luau/steps/safety-audit.md` #7): a 1 MiB plugin about 120 MB.
pub const SOURCES: u64 = 1 << 20;

/// The stack a build compiles on. Luau's parser stops at 1000 levels of nesting, which needs less than 2 MiB.
const STACK: usize = 8 << 20;

/// How deep a plugin's modules may nest in directories.
const DEPTH: usize = 8;

/// Why a Luau plugin is listed and not active while its files are walked, off the UI thread.
pub const STARTING: &str = "reading its Luau files";

/// What a Luau plugin's approval names apart from a TypeScript plugin's of the same directory: the prefix of its
/// artifact's hash. A user who approved a sandboxed Luau plugin approved nothing that runs on the JS host.
pub const TAG: &str = "luau:";

/// The approval artifact of a Luau plugin whose directory hashes to `tree` ([`Artifact::tree`]).
pub fn artifact(tree: Artifact) -> Artifact {
    Artifact { sha256: format!("{TAG}{}", tree.sha256), ..tree }
}

/// The tree a Luau plugin's approval `artifact` names, as [`Artifact::stage`] copies it.
pub fn tree_of(artifact: &Artifact) -> Artifact {
    let sha256 = artifact.sha256.strip_prefix(TAG).unwrap_or(&artifact.sha256).to_owned();
    Artifact { sha256, ..artifact.clone() }
}

/// Whether `artifact` is a Luau plugin's approval artifact ([`artifact`]).
pub fn approves(artifact: &Artifact) -> bool {
    artifact.sha256.starts_with(TAG)
}

/// Turned on by [`enable`].
static ENABLED: AtomicBool = AtomicBool::new(false);

/// Turns Luau plugins on for the rest of the process, as `OPENCODE_PLUGIN_LUAU=1` does: for a test, which cannot set
/// the environment while other threads read it. A loader made before it keeps what it found.
pub fn enable() {
    ENABLED.store(true, Ordering::Relaxed);
}

/// Whether `OPENCODE_PLUGIN_LUAU=1`, or [`enable`], turns Luau plugins on.
pub fn enabled() -> bool {
    ENABLED.load(Ordering::Relaxed) || std::env::var(FLAG).as_deref() == Ok("1")
}

/// Whether `dir` is a Luau plugin: it holds a `plugin.toml`.
pub fn is_plugin(dir: &Path) -> bool {
    dir.join(MANIFEST).is_file()
}

/// A Luau plugin's files, read once: `plugin.toml`, every `.luau` file and every `.luaurc`, by their path in the plugin
/// with `/`. The VM loads from these bytes, never from the disk.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Sources {
    files: BTreeMap<String, Vec<u8>>,
}

impl Sources {
    /// Reads the plugin in `dir`: at most [`SOURCES`] bytes, [`DEPTH`] directories deep. Hidden entries but
    /// [`LUAURC`] are skipped. A
    /// link is followed only to a file or directory inside `dir`: one out of it is refused, so what loads is the
    /// plugin's own (`dir` itself may be a link).
    pub fn read(dir: &Path) -> Result<Self, String> {
        let root = std::fs::canonicalize(dir).map_err(|error| format!("{}: {error}", dir.display()))?;
        let mut sources = Self::default();
        let mut total = 0;
        read(&root, &root, "", &mut sources.files, &mut total, 0)?;
        Ok(sources)
    }

    /// Sources from `files`, path and text.
    pub fn from_files<'a>(files: impl IntoIterator<Item = (&'a str, &'a str)>) -> Self {
        let files = files.into_iter().map(|(path, text)| (path.to_owned(), text.as_bytes().to_vec())).collect();
        Self { files }
    }

    pub(crate) fn files(&self) -> impl Iterator<Item = (&str, &Vec<u8>)> {
        self.files.iter().map(|(path, bytes)| (path.as_str(), bytes))
    }

    /// What tells one build from another: its files, and the options its setup runs with.
    pub fn digest(&self, options: Option<&str>) -> u64 {
        let mut hasher = DefaultHasher::new();
        for (path, bytes) in &self.files {
            hasher.write(path.as_bytes());
            hasher.write_u8(0);
            hasher.write(bytes);
        }
        hasher.write(options.unwrap_or_default().as_bytes());
        hasher.finish()
    }

    fn text(&self, path: &str) -> Result<&str, String> {
        let bytes = self.files.get(path).ok_or_else(|| format!("the plugin has no {path}"))?;
        std::str::from_utf8(bytes).map_err(|_| format!("{path} is not UTF-8"))
    }
}

fn read(
    root: &Path,
    dir: &Path,
    relative: &str,
    files: &mut BTreeMap<String, Vec<u8>>,
    total: &mut u64,
    depth: usize,
) -> Result<(), String> {
    if depth > DEPTH {
        return Err(format!("{}: nested deeper than {DEPTH} directories", dir.display()));
    }
    let error = |error: std::io::Error| format!("{}: {error}", dir.display());
    for entry in std::fs::read_dir(dir).map_err(error)? {
        let entry = entry.map_err(error)?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') && name != LUAURC {
            continue;
        }
        let path = format!("{relative}{name}");
        let real = std::fs::canonicalize(entry.path()).map_err(error)?;
        if !real.starts_with(root) {
            return Err(format!(
                "{}: a link out of the plugin directory, to {}",
                entry.path().display(),
                real.display()
            ));
        }
        let metadata = std::fs::metadata(&real).map_err(error)?;
        if metadata.is_dir() {
            read(root, &real, &format!("{path}/"), files, total, depth + 1)?;
            continue;
        }
        if !(name.ends_with(".luau") || name == LUAURC || path == MANIFEST) {
            continue;
        }
        *total += metadata.len();
        if *total > SOURCES {
            return Err(format!("{}: sources larger than {} MiB", dir.display(), SOURCES >> 20));
        }
        files.insert(path, std::fs::read(&real).map_err(error)?);
    }
    Ok(())
}

/// What `plugin.toml` says: the flat subset of TOML rune-desktop's manifests use, `key = "string"` lines and comments.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Manifest {
    pub id: String,
    pub name: Option<String>,
    pub version: Option<String>,
    pub description: Option<String>,
    /// The entry module, `init.luau` unless named.
    pub entry: String,
}

impl Manifest {
    pub fn parse(text: &str) -> Result<Self, String> {
        let mut fields = BTreeMap::new();
        for (number, line) in text.lines().enumerate() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let unsupported = || format!("plugin.toml:{}: only `key = \"string\"` lines are read", number + 1);
            let (key, value) = line.split_once('=').ok_or_else(unsupported)?;
            let value = value.trim();
            let value = value.strip_prefix('"').and_then(|value| value.strip_suffix('"')).ok_or_else(unsupported)?;
            if value.contains(['"', '\\']) {
                return Err(unsupported());
            }
            fields.insert(key.trim().to_owned(), value.to_owned());
        }
        let id = fields.remove("id").filter(|id| !id.is_empty()).ok_or("plugin.toml names no id")?;
        if let Some(contract) = fields.get("contract").filter(|contract| contract.split('.').next() != Some("2")) {
            return Err(format!("plugin.toml asks for contract {contract}; this opencode-native serves 2.x"));
        }
        let entry = fields.remove("entry").unwrap_or_else(|| "init.luau".to_owned());
        if !entry.ends_with(".luau") || entry.split('/').any(|part| part.is_empty() || part == "..") {
            return Err(format!("plugin.toml's entry {entry:?} is not a .luau file of the plugin"));
        }
        Ok(Self {
            id,
            name: fields.remove("name"),
            version: fields.remove("version"),
            description: fields.remove("description"),
            entry,
        })
    }
}

/// A Luau plugin's build: its manifest and its modules compiled, made on any thread ([`Builds`]).
pub struct Built {
    manifest: Manifest,
    compiled: vm::Compiled,
}

impl Built {
    /// Compiles the plugin `sources` hold: a syntax error is the build's, before any setup.
    pub fn new(sources: &Sources) -> Result<Self, String> {
        let manifest = Manifest::parse(sources.text(MANIFEST)?)?;
        let compiled = vm::Compiled::new(sources, &manifest.id, &manifest.entry)?;
        Ok(Self { manifest, compiled })
    }

    /// The definition of this plugin, not yet active: each activation starts a new VM from its bytecode and runs its
    /// setup with `options` (JSON text), the heap capped at `memory` bytes.
    pub fn define(self, options: Option<&str>, memory: usize) -> Result<(Definition, ErrorFn), String> {
        let compiled = Rc::new(self.compiled);
        let options = options.map(str::to_owned);
        let run: crate::LinkedSetup = Rc::new(move |setup, limits| {
            bind::setup(&compiled, setup, limits.overrun, memory, options.as_deref()).map(drop)
        });
        let definition = crate::linked(self.manifest.id, run, true);
        let error = definition.error.clone().ok_or("a linked definition reports its failure")?;
        Ok((definition, error))
    }
}

/// The definition of the Luau plugin `sources` hold, compiled here ([`Built`]), with `options`.
pub fn define(sources: &Sources, options: Option<&str>) -> Result<(Definition, ErrorFn), String> {
    define_with(sources, options, MEMORY)
}

/// [`define`] with a heap cap of `memory` bytes a VM.
pub fn define_with(sources: &Sources, options: Option<&str>, memory: usize) -> Result<(Definition, ErrorFn), String> {
    Built::new(sources)?.define(options, memory)
}

/// Luau plugins read and compiled on threads of their own, so no frame waits on a big plugin
/// (`luau/steps/safety-audit.md` #7). A question answers at once: the build of a directory once it is ready, taken by
/// the asker, or `None` while it is made. A build that ends wakes the UI thread, which asks again.
pub(crate) struct Builds {
    state: Arc<Mutex<HashMap<PathBuf, Build>>>,
    wake: Arc<dyn Fn() + Send + Sync>,
    /// Builds being made, or made and not yet woken for.
    running: Arc<AtomicUsize>,
}

/// The build of a directory asked for last, by its key, and its result once made.
type Build = (u64, Option<Result<Built, String>>);

impl Builds {
    pub(crate) fn new(wake: Arc<dyn Fn() + Send + Sync>) -> Self {
        Self { state: Arc::default(), wake, running: Arc::default() }
    }

    /// The build of the plugin in `dir` whose files are `key`, or `None` until a thread read and compiled them. A
    /// build of another key made since is dropped.
    pub(crate) fn built(&self, dir: &Path, key: u64) -> Option<Result<Built, String>> {
        let mut state = lock(&self.state);
        match state.get(dir) {
            Some((known, Some(_))) if *known == key => return state.remove(dir).and_then(|(_, built)| built),
            Some((known, None)) if *known == key => return None,
            _ => {}
        }
        state.insert(dir.to_owned(), (key, None));
        drop(state);
        let (state, wake, running, owned) =
            (self.state.clone(), self.wake.clone(), self.running.clone(), dir.to_owned());
        running.fetch_add(1, Ordering::SeqCst);
        let spawned = std::thread::Builder::new().name("luau-compile".to_owned()).stack_size(STACK).spawn(move || {
            let built = Sources::read(&owned).and_then(|sources| Built::new(&sources));
            if let Some((known, slot)) = lock(&state).get_mut(&owned)
                && *known == key
            {
                *slot = Some(built);
            }
            wake();
            running.fetch_sub(1, Ordering::SeqCst);
        });
        // Without a thread (the system has none to give), the build is made here.
        if spawned.is_err() {
            self.running.fetch_sub(1, Ordering::SeqCst);
            lock(&self.state).remove(dir);
            return Some(Sources::read(dir).and_then(|sources| Built::new(&sources)));
        }
        None
    }

    /// Whether a build is being made.
    #[cfg(test)]
    pub(crate) fn running(&self) -> bool {
        self.running.load(Ordering::SeqCst) > 0
    }

    /// Whether a build is made and waits for its asker.
    #[cfg(test)]
    pub(crate) fn ready(&self) -> bool {
        lock(&self.state).values().any(|(_, built)| built.is_some())
    }
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The heap an idle VM of `sources` holds once its setup ran: what a plugin costs at rest (the spike's measure).
pub fn idle_memory(sources: &Sources) -> Result<usize, String> {
    let manifest = Manifest::parse(sources.text(MANIFEST)?)?;
    let compiled = Rc::new(vm::Compiled::new(sources, &manifest.id, &manifest.entry)?);
    let mut registered = opencode_plugin_abi::Registered::new(&manifest.id, None);
    let limit = crate::contain::Limits::default().overrun;
    let plugin = bind::setup(&compiled, &mut registered.setup(), limit, MEMORY, None)?;
    let vm = plugin.vm.borrow();
    let vm = vm.as_ref().ok_or("the plugin has ended")?;
    vm.lua.gc_collect().map_err(|error| error.to_string())?;
    Ok(vm.memory())
}
