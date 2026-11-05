//! External plugins (P.4, `docs/P.4.md`, row F16): discovery in `plugins` directories, the `plugins` entries of
//! `cli.json`, and loading of native builds (shared libraries on the C ABI of `opencode-plugin-abi`, decision
//! O-42) through a [`Backend`], which is [`native::Native`] in the TUI. Targets without a native build
//! (TypeScript plugins) are listed as skipped.
//!
//! A [`Loader`] reconciles the targets with the [`Registry`]: it loads new and changed builds, keeps a running
//! plugin when its new build fails, and unloads removed ones. The host calls [`Loader::reconcile`] again when a
//! directory of [`Loader::watch_dirs`] changes, which gives hot reload.

pub mod native;

use std::cell::RefCell;
use std::collections::HashMap;
use std::hash::{DefaultHasher, Hasher};
use std::path::{Component, Path, PathBuf};
use std::rc::Rc;

use crate::{Definition, ErrorFn, Host, Registry, SKIPPED, Status};

/// The file name of a plugin directory's native build: `plugin.so`, `plugin.dylib`, or `plugin.dll`.
pub fn entry_file() -> String {
    format!("plugin.{}", std::env::consts::DLL_EXTENSION)
}

/// Loads native builds.
pub trait Backend<H: Host> {
    /// Loads the build `library` and runs its setup once with `options` (JSON text), returning the definition,
    /// not yet active, and its failure while it runs. An error is why the build cannot load.
    fn load(
        &self,
        library: &[u8],
        options: Option<&str>,
    ) -> Result<(Definition<H>, ErrorFn), String>;
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

pub struct Loader<H: Host> {
    backend: Rc<dyn Backend<H>>,
    /// The global config directory, whose `plugins` directory is always searched and which relative
    /// `plugins` paths start from (TS `path.dirname(config.path)`).
    config_dir: PathBuf,
    cwd: PathBuf,
    configured: Vec<Configured>,
    seen: RefCell<HashMap<String, Seen>>,
}

impl<H: Host> Loader<H> {
    pub fn new(
        backend: Rc<dyn Backend<H>>,
        config_dir: PathBuf,
        cwd: PathBuf,
        configured: Vec<Configured>,
    ) -> Self {
        Self {
            backend,
            config_dir,
            cwd,
            configured,
            seen: RefCell::default(),
        }
    }

    /// The discovered directories, then the configured entries, merged by local path (TS `mergePluginTargets`:
    /// a later entry replaces an earlier one in its place).
    pub fn targets(&self) -> Vec<Target> {
        let discovered = discover(&plugin_directories(&self.config_dir, &self.cwd))
            .into_iter()
            .map(|path| Target {
                target: path.to_string_lossy().into_owned(),
                local: Some(path),
                options: None,
            });
        let configured = self.configured.iter().map(|entry| Target {
            target: entry.target.clone(),
            local: local_source(&entry.target, &self.config_dir),
            options: entry.options.clone(),
        });
        let mut targets: Vec<Target> = Vec::new();
        for target in discovered.chain(configured) {
            let key = |target: &Target| {
                target.local.as_ref().map_or_else(
                    || target.target.clone(),
                    |local| local.to_string_lossy().into_owned(),
                )
            };
            match targets.iter_mut().find(|known| key(known) == key(&target)) {
                Some(known) => *known = target,
                None => targets.push(target),
            }
        }
        targets
    }

    /// The directories whose changes can change the targets: the `plugins` directories (or, while one is
    /// missing, the directory it would be made in), each local target's directory, and the directory of each
    /// configured library. Missing ones are left out.
    pub fn watch_dirs(&self) -> Vec<PathBuf> {
        let mut dirs: Vec<PathBuf> = plugin_directories(&self.config_dir, &self.cwd)
            .into_iter()
            .map(|dir| match (dir.is_dir(), dir.parent()) {
                (false, Some(parent)) => parent.to_path_buf(),
                _ => dir,
            })
            .collect();
        for target in self.targets() {
            let Some(local) = target.local else { continue };
            let dir = if local.is_dir() {
                local
            } else {
                local.parent().map(Path::to_path_buf).unwrap_or(local)
            };
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
    pub fn reconcile(&self, host: &Rc<H>, registry: &Registry<H>) -> bool {
        let targets = self.targets();
        let mut changed = false;
        let stale: Vec<String> = self
            .seen
            .borrow()
            .keys()
            .filter(|target| {
                !targets
                    .iter()
                    .any(|known| known.target == **target && known.library().is_some())
            })
            .cloned()
            .collect();
        for target in stale {
            self.seen.borrow_mut().remove(&target);
            registry.unload(&target);
            registry.set_unloaded(&target, None);
            changed = true;
        }
        for target in &targets {
            changed |= self.reconcile_target(host, registry, target);
        }
        if changed {
            host.remount();
        }
        changed
    }

    fn reconcile_target(&self, host: &Rc<H>, registry: &Registry<H>, target: &Target) -> bool {
        let name = target.target.as_str();
        let skip = |reason: &str| {
            let status = Some(Status::Skipped(reason.to_owned()));
            let changed = registry.entries().iter().all(|entry| {
                entry.target.as_deref() != Some(name) || Some(&entry.status) != status.as_ref()
            });
            registry.set_unloaded(name, status);
            changed
        };
        let Some(file) = target.library() else {
            if target.local.is_none() && registry.selects(name) {
                registry.set_unloaded(name, None);
                return false;
            }
            return skip(SKIPPED);
        };
        let bytes = match std::fs::read(&file) {
            Ok(bytes) => bytes,
            Err(error) => {
                return self.fail(registry, name, 0, format!("{}: {error}", file.display()));
            }
        };
        let mut hasher = DefaultHasher::new();
        hasher.write(&bytes);
        let digest = hasher.finish();
        if self
            .seen
            .borrow()
            .get(name)
            .is_some_and(|seen| seen.digest == digest)
        {
            return false;
        }
        let loaded = self
            .backend
            .load(&bytes, target.options.as_deref())
            .and_then(|loaded| match registry.id_taken(&loaded.0.id, name) {
                true => Err(format!("plugin ID {} is already registered", loaded.0.id)),
                false => Ok(loaded),
            });
        let (definition, error) = match loaded {
            Ok(loaded) => loaded,
            Err(error) => return self.fail(registry, name, digest, error),
        };
        log::info!("plugin {} loaded from {}", definition.id, file.display());
        let reload: Rc<RefCell<Option<String>>> = Rc::default();
        let failure = {
            let reload = reload.clone();
            Rc::new(move || error().or_else(|| reload.borrow().clone()))
        };
        self.seen
            .borrow_mut()
            .insert(name.to_owned(), Seen { digest, reload });
        registry.load(host, definition.external(name, failure));
        true
    }

    /// Records that the build of `target` failed: the running previous version, if any, keeps running and
    /// reports the failure; otherwise the target is listed as failed.
    fn fail(&self, registry: &Registry<H>, target: &str, digest: u64, error: String) -> bool {
        log::error!("plugin {target} failed to load: {error}");
        let mut seen = self.seen.borrow_mut();
        match seen.get_mut(target) {
            Some(previous) => {
                previous.digest = digest;
                *previous.reload.borrow_mut() =
                    Some(format!("{error} (previous version still active)"));
            }
            None => {
                seen.insert(
                    target.to_owned(),
                    Seen {
                        digest,
                        reload: Rc::default(),
                    },
                );
                registry.set_unloaded(target, Some(Status::Failed(error)));
            }
        }
        true
    }
}

/// The `plugins` directories to search (TS `localPluginDirectories`): the global config directory's, then each
/// `.opencode` directory from the project root down to `cwd`. The project root is the nearest ancestor with
/// `.git` or `.hg`, else `cwd`. Directories other than the global one and the project's that do not exist are
/// left out.
pub fn plugin_directories(config_dir: &Path, cwd: &Path) -> Vec<PathBuf> {
    let ancestors: Vec<PathBuf> = {
        let mut ancestors: Vec<PathBuf> = cwd.ancestors().map(Path::to_path_buf).collect();
        ancestors.reverse();
        ancestors
    };
    let project = ancestors
        .iter()
        .rposition(|dir| dir.join(".git").exists() || dir.join(".hg").exists())
        .unwrap_or(ancestors.len().saturating_sub(1));
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
                let name = path
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned();
                (name.to_lowercase(), name)
            });
            entries
        })
        .collect()
}

/// The local path a `plugins` target names (TS `localSource`): a `file://` URL, or a `./`, `../`, or absolute
/// path resolved against `directory`. A package name is not local.
pub fn local_source(target: &str, directory: &Path) -> Option<PathBuf> {
    let path = match target.strip_prefix("file://") {
        Some(path) => PathBuf::from(path),
        None if target.starts_with("./")
            || target.starts_with("../")
            || Path::new(target).is_absolute() =>
        {
            directory.join(target)
        }
        None => return None,
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
