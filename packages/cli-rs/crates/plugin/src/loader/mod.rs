//! External plugins (P.4, `docs/P.4.md`, row F16): discovery in `plugins` directories, the `plugins` entries of
//! `cli.json`, and loading of native builds (shared libraries on the C ABI of `opencode-plugin-abi`, decision
//! O-42) through a [`Backend`], which is [`native::Native`] in the TUI. Targets without a native build
//! (TypeScript plugins) are listed as skipped.
//!
//! A [`Loader`] reconciles the targets with the [`Registry`]: it loads new and changed builds, keeps a running
//! plugin when its new build fails, and unloads removed ones. The host calls [`Loader::reconcile`] again when a
//! directory of [`Loader::watch_dirs`] changes, which gives hot reload. A build found in a project's
//! `.opencode/plugins` loads only once the user approved it ([`approval`]).

pub mod approval;
pub mod deps;
pub mod native;

use std::cell::RefCell;
use std::collections::hash_map::Entry;
use std::collections::{HashMap, HashSet};
use std::hash::{DefaultHasher, Hasher};
use std::path::{Component, Path, PathBuf};
use std::rc::Rc;

use crate::{Definition, ErrorFn, Host, Registry, SKIPPED, Status};
use approval::{Approvals, Artifact, Decision};

/// The file name of a plugin directory's native build: `plugin.so`, `plugin.dylib`, or `plugin.dll`.
pub fn entry_file() -> String {
    format!("plugin.{}", std::env::consts::DLL_EXTENSION)
}

/// Loads native builds.
pub trait Backend {
    /// Loads the build `library` against `host`, returning the definition, not yet active, and its failure while
    /// it runs. Setup runs with `options` (JSON text) on each activation, not here. An error is why the build
    /// cannot load.
    fn load(&self, host: &Rc<dyn Host>, library: &[u8], options: Option<&str>)
    -> Result<(Definition, ErrorFn), String>;
}

/// A `plugins` entry of `cli.json` that names no built-in: a TypeScript package or path, or a native build.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Configured {
    pub target: String,
    /// The entry's `options` as JSON text.
    pub options: Option<String>,
}

/// One plugin to reconcile: a discovered directory or a configured entry.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Target {
    /// The configured target, or the discovered directory's path.
    pub target: String,
    /// The local path the target names, if it is one.
    pub local: Option<PathBuf>,
    pub options: Option<String>,
    /// Found in a project's `plugins` directory, and not named by a `cli.json` entry: it needs approval.
    pub project: bool,
}

impl Target {
    /// The native build: the target itself when it is a shared library, else the directory's [`entry_file`].
    pub fn library(&self) -> Option<PathBuf> {
        let local = self.local.as_ref()?;
        let extension = std::env::consts::DLL_EXTENSION;
        if local.extension().is_some_and(|known| known == extension) && local.is_file() {
            return Some(local.clone());
        }
        Some(local.join(entry_file())).filter(|entry| entry.is_file())
    }
}

/// What the loader last saw of a target.
struct Seen {
    /// The digest of the build it loaded or failed on.
    digest: u64,
    /// The failure of a new build while the previous one keeps running.
    reload: Rc<RefCell<Option<String>>>,
}

pub struct Loader {
    backend: Rc<dyn Backend>,
    /// The global config directory, whose `plugins` directory is always searched and which relative
    /// `plugins` paths start from (TS `path.dirname(config.path)`).
    config_dir: PathBuf,
    cwd: PathBuf,
    configured: RefCell<Vec<Configured>>,
    seen: RefCell<HashMap<String, Seen>>,
    /// The targets of the last reconcile, so a removed one leaves the registry whatever its status.
    listed: RefCell<Vec<String>>,
    /// The targets logged as skipped.
    skipped: RefCell<HashSet<String>>,
    /// The targets whose last build was refused for an ID another plugin has, with that ID; each loads again once it is
    /// free.
    waiting: RefCell<HashMap<String, String>>,
    /// The user's decisions on project plugins.
    approvals: Approvals,
    /// The project targets held back for approval, with the artifact the user is asked about, or why it cannot be
    /// read.
    held: RefCell<HashMap<String, Result<Artifact, String>>>,
}

impl Loader {
    pub fn new(backend: Rc<dyn Backend>, config_dir: PathBuf, cwd: PathBuf, configured: Vec<Configured>) -> Self {
        Self {
            backend,
            config_dir,
            cwd,
            configured: RefCell::new(configured),
            seen: RefCell::default(),
            listed: RefCell::default(),
            skipped: RefCell::default(),
            waiting: RefCell::default(),
            approvals: Approvals::default(),
            held: RefCell::default(),
        }
    }

    /// Keeps the decisions on project plugins in `approvals` rather than in memory.
    pub fn with_approvals(self, approvals: Approvals) -> Self {
        Self { approvals, ..self }
    }

    /// The discovered directories, then the configured entries, merged by local path (TS `mergePluginTargets`:
    /// a later entry replaces an earlier one in its place). Only the global `plugins` directory is not a project's. A
    /// configured entry also replaces a project's plugin whose library is the same file under another spelling (a link,
    /// another case, or the library rather than its directory; carbon-4, bigboi-6), so it is not listed twice.
    pub fn targets(&self) -> Vec<Target> {
        let directories = plugin_directories(&self.config_dir, &self.cwd);
        let discovered = directories.iter().enumerate().flat_map(|(index, directory)| {
            discover(std::slice::from_ref(directory)).into_iter().map(move |path| Target {
                target: path.to_string_lossy().into_owned(),
                local: Some(path),
                options: None,
                project: index > 0,
            })
        });
        let configured = self.configured.borrow();
        let configured = configured.iter().map(|entry| Target {
            target: entry.target.clone(),
            local: local_source(&entry.target, &self.config_dir),
            options: entry.options.clone(),
            project: false,
        });
        let mut targets: Vec<Target> = Vec::new();
        for target in discovered.chain(configured) {
            let key = |target: &Target| {
                target
                    .local
                    .as_ref()
                    .map_or_else(|| target.target.clone(), |local| local.to_string_lossy().into_owned())
            };
            let alias = |known: &Target| {
                known.project && !target.project && {
                    let file = |target: &Target| target.library().and_then(|file| identity(&file));
                    file(known).is_some_and(|known| file(&target) == Some(known))
                }
            };
            match targets.iter_mut().find(|known| key(known) == key(&target) || alias(known)) {
                Some(known) => *known = target,
                None => targets.push(target),
            }
        }
        targets
    }

    /// The artifact the user is asked about for the project plugin of `target`, or why it cannot be read; `None` when
    /// the plugin is not held back.
    pub fn held(&self, target: &str) -> Option<Result<Artifact, String>> {
        self.held.borrow().get(target).cloned()
    }

    /// Why decisions are not saved, when the state directory was refused ([`Approvals::open`]).
    pub fn unsaved(&self) -> Option<String> {
        self.approvals.unsaved().map(str::to_owned)
    }

    /// Replaces the configured entries, after `cli.json` changed; the next [`Loader::reconcile`] applies them.
    pub fn set_configured(&self, configured: Vec<Configured>) {
        self.configured.replace(configured);
    }

    /// The directories whose changes can change the targets: the `plugins` directories and `cwd`'s (or, while
    /// one is missing, the nearest of its `.opencode` directory and the one above that exists), each local
    /// target's directory,
    /// and the directory of each configured library. Missing ones are left out.
    pub fn watch_dirs(&self) -> Vec<PathBuf> {
        let mut directories = plugin_directories(&self.config_dir, &self.cwd);
        directories.push(self.cwd.join(".opencode/plugins"));
        let mut dirs: Vec<PathBuf> = directories
            .iter()
            .filter_map(|dir| dir.ancestors().take(3).find(|dir| dir.is_dir()).map(Path::to_path_buf))
            .collect();
        for target in self.targets() {
            let Some(local) = target.local else { continue };
            let dir = if local.is_dir() { local } else { local.parent().map(Path::to_path_buf).unwrap_or(local) };
            dirs.push(dir);
        }
        let mut unique: Vec<PathBuf> = Vec::new();
        for dir in dirs.into_iter().filter(|dir| dir.is_dir()) {
            if !unique.contains(&dir) {
                unique.push(dir);
            }
        }
        unique
    }

    /// Brings the registry in line with the targets and their builds, then remounts the host's route when
    /// anything changed. Returns whether it did.
    pub fn reconcile(&self, host: &Rc<dyn Host>, registry: &Registry) -> bool {
        let targets = self.targets();
        let mut changed = false;
        let stale: Vec<String> = self
            .seen
            .borrow()
            .keys()
            .filter(|target| !targets.iter().any(|known| known.target == **target && known.library().is_some()))
            .cloned()
            .collect();
        let removed = self
            .listed
            .borrow()
            .iter()
            .filter(|target| !targets.iter().any(|known| known.target == **target))
            .cloned()
            .collect::<Vec<_>>();
        for target in stale.into_iter().chain(removed) {
            self.seen.borrow_mut().remove(&target);
            self.waiting.borrow_mut().remove(&target);
            self.held.borrow_mut().remove(&target);
            registry.unload(host, &target);
            registry.set_unloaded(&target, None);
            changed = true;
        }
        self.listed.replace(targets.iter().map(|target| target.target.clone()).collect());
        for target in &targets {
            changed |= self.reconcile_target(host, registry, target);
        }
        // A build refused for an ID loads again once its owner was removed or took another ID; a refused one waits
        // again, so this ends.
        loop {
            let mut free = Vec::new();
            self.waiting.borrow_mut().retain(|target, id| {
                let taken = registry.id_taken(id, target);
                if !taken {
                    free.push(target.clone());
                }
                taken
            });
            if free.is_empty() {
                break;
            }
            for target in targets.iter().filter(|target| free.contains(&target.target)) {
                self.seen.borrow_mut().remove(&target.target);
                changed |= self.reconcile_target(host, registry, target);
            }
        }
        if changed {
            host.remount();
        }
        changed
    }

    fn reconcile_target(&self, host: &Rc<dyn Host>, registry: &Registry, target: &Target) -> bool {
        let name = target.target.as_str();
        // What the manager lists before this reconcile: a failure is told only when it is not listed already.
        let listed = registry.entries().into_iter().find(|entry| entry.target.as_deref() == Some(name));
        let listed = listed.map(|entry| entry.status);
        let skip = |reason: &str| {
            let status = Some(Status::Skipped(reason.to_owned()));
            let changed = registry
                .entries()
                .iter()
                .all(|entry| entry.target.as_deref() != Some(name) || Some(&entry.status) != status.as_ref());
            // Only now is it known that the target has no native build.
            if self.skipped.borrow_mut().insert(name.to_owned()) {
                log::warn!("plugin {name} skipped: {reason}");
            }
            registry.set_unloaded(name, status);
            changed
        };
        let Some(file) = target.library() else {
            self.held.borrow_mut().remove(name);
            // What ran from a project's plugin whose build went stops now, not at the next reconcile (bigboi-8).
            if target.project {
                registry.unload(host, name);
                self.seen.borrow_mut().remove(name);
            }
            if target.local.is_none() && registry.selects(name) {
                registry.set_unloaded(name, None);
                return false;
            }
            return skip(SKIPPED);
        };
        // Setup runs with the options, so new options load the build again (TS `sameGeneration`).
        let digest = |build: &[u8]| {
            let mut hasher = DefaultHasher::new();
            hasher.write(build);
            hasher.write(target.options.as_deref().unwrap_or_default().as_bytes());
            hasher.finish()
        };
        let unchanged = |digest: u64| self.seen.borrow().get(name).is_some_and(|seen| seen.digest == digest);
        let (digest, bytes) = match target.project {
            // A project's build runs only once the user approved this artifact (3.9). Until then nothing of it is read
            // but its hash, nothing is opened, and it claims nothing. What is loaded is what was hashed. When it
            // cannot be identified, what ran from it stops (bigboi-8) and nothing is reported (carbon-5).
            true => {
                let (artifact, mut handle) = match Artifact::open(target.local.as_deref().unwrap_or(&file), &file) {
                    Ok(opened) => opened,
                    Err(error) => return self.hold(host, registry, name, Err(error), None),
                };
                match self.approvals.decision(&artifact) {
                    Some(Decision::Approved) => drop(self.held.borrow_mut().remove(name)),
                    decision => return self.hold(host, registry, name, Ok(artifact), decision),
                }
                let digest = digest(artifact.sha256.as_bytes());
                if unchanged(digest) {
                    return false;
                }
                match artifact.bytes(&mut handle) {
                    Ok(bytes) => (digest, bytes),
                    Err(error) => return self.hold(host, registry, name, Err(error), None),
                }
            }
            false => {
                let read = std::fs::metadata(&file).and_then(|metadata| match metadata.len() > approval::LIMIT {
                    true => Err(std::io::Error::other(format!("larger than {} MiB", approval::LIMIT / 1024 / 1024))),
                    false => std::fs::read(&file),
                });
                let bytes = match read {
                    Ok(bytes) => bytes,
                    Err(error) => {
                        return self.fail(&**host, registry, &listed, name, 0, format!("{}: {error}", file.display()));
                    }
                };
                let digest = digest(&bytes);
                if unchanged(digest) {
                    return false;
                }
                (digest, bytes)
            }
        };
        self.waiting.borrow_mut().remove(name);
        // Nothing the build names may come from the project, or leave its private copy (bigboi-3).
        let loaded = deps::check(&bytes, target.project);
        let loaded =
            loaded.and_then(|()| self.backend.load(host, &bytes, target.options.as_deref())).and_then(|loaded| {
                if !registry.id_taken(&loaded.0.id, name) {
                    return Ok(loaded);
                }
                self.waiting.borrow_mut().insert(name.to_owned(), loaded.0.id.clone());
                Err(format!("plugin ID {} is already registered", loaded.0.id))
            });
        let (definition, error) = match loaded {
            Ok(loaded) => loaded,
            Err(error) => return self.fail(&**host, registry, &listed, name, digest, error),
        };
        log::info!("plugin {} loaded from {}", definition.id, file.display());
        let reload: Rc<RefCell<Option<String>>> = Rc::default();
        let failure = {
            let reload = reload.clone();
            Rc::new(move || error().or_else(|| reload.borrow().clone()))
        };
        // Starting the plugin again (the plugin manager) starts this build; the failed build is old news.
        let setup = definition.setup.clone();
        let definition = Definition {
            setup: Rc::new({
                let reload = reload.clone();
                move |registering: &mut crate::Setup<'_>| {
                    reload.take();
                    setup(registering)
                }
            }),
            ..definition
        };
        match registry.load(host, definition.external(name, failure).digest(digest)) {
            Some(failed) if failed.kept => return self.fail(&**host, registry, &listed, name, digest, failed.error),
            // The plugin is listed as failed, and enabling it runs this build's setup again.
            Some(failed) => self.tell(&**host, registry, &listed, name, failed.error),
            None => {}
        }
        self.seen.borrow_mut().insert(name.to_owned(), Seen { digest, reload });
        true
    }

    /// Records that the build of `target` failed: the running previous version, if any, keeps running and
    /// reports the failure; otherwise the target is listed as failed. A new failure tells the host.
    fn fail(
        &self,
        host: &dyn Host,
        registry: &Registry,
        listed: &Option<Status>,
        target: &str,
        digest: u64,
        error: String,
    ) -> bool {
        log::error!("plugin {target} failed to load: {error}");
        let reload = match self.seen.borrow_mut().entry(target.to_owned()) {
            Entry::Occupied(mut seen) => {
                seen.get_mut().digest = digest;
                seen.get().reload.clone()
            }
            Entry::Vacant(seen) => seen.insert(Seen { digest, reload: Rc::default() }).reload.clone(),
        };
        // The registry asks the running build whether it panicked, without the last reload's failure.
        reload.take();
        // Told as listed, as TS compares the failures it lists: a failure that left the previous version running
        // is new after the same error without it.
        let error = match registry.failed_load(target, &error) {
            true => reload.borrow_mut().insert(format!("{error} (previous version still active)")).clone(),
            false => error,
        };
        self.tell(host, registry, listed, target, error);
        true
    }

    /// Records the user's `decision` on `artifact`, the build of `target` they were shown (bigboi-1, carbon-1). It is
    /// recorded only while that build is the one held back: `Ok(false)` records nothing when the build changed since,
    /// and the user is asked about the new one. An error when it cannot be saved; nothing changes then. The next
    /// [`Loader::reconcile`] applies it: an approved build loads, a declined one is not asked about again.
    pub fn decide(&self, target: &str, artifact: &Artifact, decision: Decision) -> Result<bool, String> {
        if self.held.borrow().get(target) != Some(&Ok(artifact.clone())) {
            return Ok(false);
        }
        self.approvals.decide(artifact, decision).map(|()| true)
    }

    /// Holds back the project build of `target` that the user has not approved, or that cannot be identified:
    /// whatever runs from `target` stops, and it is listed pending, or declined. A new pending build that can be read
    /// tells the host.
    fn hold(
        &self,
        host: &Rc<dyn Host>,
        registry: &Registry,
        target: &str,
        artifact: Result<Artifact, String>,
        decision: Option<Decision>,
    ) -> bool {
        let status = match decision {
            Some(Decision::Declined) => Status::Declined,
            _ => Status::Pending,
        };
        if let Err(error) = &artifact {
            log::warn!("plugin {target} is held back: {error}");
        }
        // A build that waits for its ID stays in `waiting`: once the ID is free, it is held again.
        registry.unload(host, target);
        self.seen.borrow_mut().remove(target);
        let listed =
            registry.entries().iter().any(|entry| entry.target.as_deref() == Some(target) && entry.status == status);
        registry.set_unloaded(target, Some(status.clone()));
        let asked = self.held.borrow_mut().insert(target.to_owned(), artifact.clone()).as_ref() == Some(&artifact);
        if status == Status::Pending && !asked && artifact.is_ok() {
            host.pending(target);
        }
        // A plugin loaded from `target` was not listed with this status, so its unload counts too.
        !listed
    }

    /// Tells the host that `target` failed with `error`, unless the manager `listed` that failure before this reconcile
    /// (TS `context.tsx` compares the failures it lists). The host names the plugin by the ID its build described, and by
    /// `target` only when no build of it ever described one.
    fn tell(&self, host: &dyn Host, registry: &Registry, listed: &Option<Status>, target: &str, error: String) {
        if listed.as_ref() != Some(&Status::Failed(error)) {
            let id = registry.with_target(target, |plugin| plugin.definition.id.clone());
            host.failed(id.as_deref().unwrap_or(target));
        }
    }
}

/// The project root of `cwd`: the nearest ancestor with `.git` or `.hg`, else `cwd`.
pub fn project_root(cwd: &Path) -> PathBuf {
    cwd.ancestors().find(|dir| dir.join(".git").exists() || dir.join(".hg").exists()).unwrap_or(cwd).to_path_buf()
}

/// What tells a file from another however it is named: its device and inode, or its file index on Windows.
fn identity(file: &Path) -> Option<(u64, u64)> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        std::fs::metadata(file).ok().map(|metadata| (metadata.dev(), metadata.ino()))
    }
    #[cfg(windows)]
    {
        opencode_util::win::file_index(file).ok().map(|index| (0, index))
    }
    #[cfg(not(any(unix, windows)))]
    {
        std::fs::canonicalize(file).ok().map(|_| (0, 0))
    }
}

/// Whether a native build is among the targets: the discovered directories and the `configured` entries, enabled or
/// not. The client starts under a parent only then (synthesis 4.5, decision 5). It reads directories and no library.
pub fn has_native_build(config_dir: &Path, cwd: &Path, configured: &[&str]) -> bool {
    let discovered = discover(&plugin_directories(config_dir, cwd)).into_iter().map(Some);
    let configured = configured.iter().map(|target| local_source(target, config_dir));
    discovered
        .chain(configured)
        .flatten()
        .any(|local| Target { target: String::new(), local: Some(local), options: None }.library().is_some())
}

/// The `plugins` directories to search (TS `localPluginDirectories`): the global config directory's, then each
/// `.opencode` directory from the project root ([`project_root`]) down to `cwd`. Directories other than the global
/// one and the project's that do not exist are left out.
pub fn plugin_directories(config_dir: &Path, cwd: &Path) -> Vec<PathBuf> {
    let ancestors: Vec<PathBuf> = {
        let mut ancestors: Vec<PathBuf> = cwd.ancestors().map(Path::to_path_buf).collect();
        ancestors.reverse();
        ancestors
    };
    let root = project_root(cwd);
    let project = ancestors.iter().position(|dir| *dir == root).unwrap_or(ancestors.len().saturating_sub(1));
    let project_config = ancestors.get(project).map(|dir| dir.join(".opencode"));
    let mut directories = vec![config_dir.to_path_buf()];
    directories.extend(
        ancestors
            .iter()
            .skip(project)
            .map(|dir| dir.join(".opencode"))
            .filter(|dir| Some(dir) == project_config.as_ref() || dir.is_dir()),
    );
    let mut unique: Vec<PathBuf> = Vec::new();
    for dir in directories {
        if !unique.contains(&dir) {
            unique.push(dir);
        }
    }
    unique.into_iter().map(|dir| dir.join("plugins")).collect()
}

/// The plugin directories inside `directories` (TS `discoverPluginTargets`): every subdirectory, or symlink to
/// one, by name in each.
pub fn discover(directories: &[PathBuf]) -> Vec<PathBuf> {
    directories
        .iter()
        .flat_map(|directory| {
            let mut entries: Vec<PathBuf> = std::fs::read_dir(directory)
                .into_iter()
                .flatten()
                .flatten()
                .map(|entry| entry.path())
                .filter(|path| path.is_dir())
                .collect();
            // `localeCompare` without the ICU tables: case-insensitive, then by code point.
            entries.sort_by_key(|path| {
                let name = path.file_name().unwrap_or_default().to_string_lossy().into_owned();
                (name.to_lowercase(), name)
            });
            entries
        })
        .collect()
}

/// The local path a `plugins` target names (TS `localSource`): a `file://` URL, or a `./`, `../`, or absolute
/// path resolved against `directory`. A package name is not local. A URL decodes as TS `fileURLToPath` does; one
/// that names no local file (a remote host) is not local. Absolute is `path.isAbsolute`: on Windows a rooted path
/// without a drive (`/abs/x`) is absolute too and takes `directory`'s drive.
pub fn local_source(target: &str, directory: &Path) -> Option<PathBuf> {
    let path = if target.starts_with("file://") {
        opencode_api_types::js::parse_url(target).ok()?.to_file_path().ok()?
    } else if target.starts_with("./") || target.starts_with("../") || Path::new(target).has_root() {
        directory.join(target)
    } else {
        return None;
    };
    let mut resolved = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                resolved.pop();
            }
            Component::CurDir => {}
            other => resolved.push(other),
        }
    }
    Some(resolved)
}

#[cfg(test)]
mod tests;
