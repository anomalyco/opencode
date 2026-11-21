//! Discovers plugin targets and reconciles them with the registry. A failed rebuild leaves the running plugin
//! active. Project plugins require approval before loading.

// A build with no carrier of external plugins (no `ts` or `luau`) lists every target as skipped: what loads
// one goes unused.
#![cfg_attr(not(any(feature = "ts", feature = "luau")), allow(dead_code, unused_imports, unused_variables))]

pub mod approval;
pub mod npm;
pub(crate) mod requests;

use std::cell::RefCell;
use std::collections::hash_map::Entry;
use std::collections::{HashMap, HashSet};
use std::hash::{DefaultHasher, Hasher};
use std::path::{Component, Path, PathBuf};
use std::rc::Rc;

#[cfg(feature = "ts")]
use crate::pipe::{Scripts, Step};
use crate::{Definition, ErrorFn, Host, Registry, SKIPPED, SKIPPED_OFF, Status};
use approval::{Approvals, Artifact, Decision};

/// The file name of a native plugin library, which no carrier loads: `plugin.so`, `plugin.dylib`, or `plugin.dll`.
pub fn entry_file() -> String {
    format!("plugin.{}", std::env::consts::DLL_EXTENSION)
}

/// A `plugins` entry of `cli.json` that names no built-in: a TypeScript package or path, or a Luau plugin directory.
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
    /// The native plugin library the target is or holds ([`entry_file`]), which is skipped ([`crate::SKIPPED_NATIVE`]).
    pub fn library(&self) -> Option<PathBuf> {
        let local = self.local.as_ref()?;
        let extension = std::env::consts::DLL_EXTENSION;
        if local.extension().is_some_and(|known| known == extension) && local.is_file() {
            return Some(local.clone());
        }
        Some(local.join(entry_file())).filter(|entry| entry.is_file())
    }
}

/// A server plugin's TUI part as `GET /api/plugin` reports it: its source, and the plugin's ID when the server gives
/// one, which the user's `-<id>` removals select.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ServerPart {
    /// A package spec, found in the npm cache ([`npm::resolve`]).
    Package { spec: String, id: Option<String> },
    /// An absolute path on the server's machine.
    Local { path: String, id: Option<String> },
}

/// The build a target holds on the disk now ([`Loader::found`]).
pub enum Found {
    /// Nothing to approve, and why: a target that names no plugin the loader runs.
    Refused(String),
    /// A TypeScript plugin's directory, whose full hash can take seconds with a large `node_modules`: the caller runs
    /// [`Found::identify`] off the UI thread.
    Tree(PathBuf),
    /// A Luau plugin's directory, hashed as a TypeScript plugin's tree and approved as a Luau plugin
    /// ([`crate::luau::artifact`]); also identified off the UI thread.
    #[cfg(luau)]
    Luau(PathBuf),
}

impl Found {
    /// The artifact: a tree is hashed now ([`Artifact::tree`]).
    pub fn identify(self) -> Result<Artifact, String> {
        match self {
            Self::Refused(error) => Err(error),
            Self::Tree(dir) => Artifact::tree(&dir),
            #[cfg(luau)]
            Self::Luau(dir) => Artifact::tree(&dir).map(crate::luau::artifact),
        }
    }

    /// Whether [`Found::identify`] walks a tree, which the caller runs off the UI thread.
    pub fn walks(&self) -> bool {
        match self {
            Self::Refused(_) => false,
            Self::Tree(_) => true,
            #[cfg(luau)]
            Self::Luau(_) => true,
        }
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
    /// The last answer the user gave on each target, counted ([`Loader::deciding`]).
    answers: RefCell<HashMap<String, u64>>,
    /// The JS host, which runs the targets that have no native build.
    #[cfg(feature = "ts")]
    scripts: Option<Rc<Scripts>>,
    /// The global cache directory TS installs packages into (`~/.cache/opencode`), where a target named by npm
    /// package is found ([`npm::resolve`]), and nothing installed.
    npm: Option<PathBuf>,
    /// The TUI parts of the active server plugins, and the `plugins` entries of the user's global opencode config,
    /// which vouch for the parts they name.
    server: RefCell<(Vec<ServerPart>, Vec<String>)>,
    /// Cache the resolved entry while the spec remains configured. Installing a newer generation must not move a
    /// running plugin.
    packages: RefCell<HashMap<String, npm::Package>>,
    /// A directory with a `plugin.toml` and no native build runs as a Luau plugin ([`crate::luau`]), its files walked,
    /// hashed and staged on threads of their own, as a TypeScript plugin's are.
    #[cfg(luau)]
    luau: Option<crate::pipe::tree::Trees>,
    /// A Luau plugin's sources, read and compiled on threads of their own.
    #[cfg(luau)]
    luau_builds: Option<crate::luau::Builds>,
}

/// The path `realpath` gives: `canonicalize`, without the verbatim prefix it gives on Windows (`\\?\C:\x` is `C:\x`),
/// so a path compares with one written as the user or the server writes it, and the JS host is handed one Bun and Node
/// read alike.
fn real(path: &Path) -> Option<PathBuf> {
    std::fs::canonicalize(path).ok().map(plain)
}

/// `path` without a verbatim prefix ([`opencode_util::path::strip_verbatim`]).
fn plain(path: PathBuf) -> PathBuf {
    match path.to_str() {
        Some(text) => PathBuf::from(opencode_util::path::strip_verbatim(text).into_owned()),
        None => path,
    }
}

/// Matches an exact plugin ID, a `prefix.*` selector, or `*`.
fn selects(selector: &str, name: &str) -> bool {
    selector == "*"
        || match selector.strip_suffix('*').filter(|prefix| prefix.ends_with('.')) {
            Some(prefix) => name.starts_with(prefix),
            None => selector == name,
        }
}

/// The `name` of the `package.json` in `dir`, which names a plugin that is not loaded in place of its path.
fn package_name(dir: &Path) -> Option<String> {
    let text = std::fs::read_to_string(dir.join("package.json")).ok()?;
    let package: serde_json::Value = serde_json::from_str(&text).ok()?;
    package.get("name")?.as_str().filter(|name| !name.is_empty()).map(str::to_owned)
}

/// Why a TypeScript plugin is listed and not active while the JS host loads it.
pub const STARTING: &str = "starting on the JS host";

impl Loader {
    pub fn new(config_dir: PathBuf, cwd: PathBuf, configured: Vec<Configured>) -> Self {
        Self {
            config_dir,
            cwd,
            configured: RefCell::new(configured),
            seen: RefCell::default(),
            listed: RefCell::default(),
            skipped: RefCell::default(),
            waiting: RefCell::default(),
            approvals: Approvals::default(),
            held: RefCell::default(),
            answers: RefCell::default(),
            #[cfg(feature = "ts")]
            scripts: None,
            npm: None,
            server: RefCell::default(),
            packages: RefCell::default(),
            #[cfg(luau)]
            luau: None,
            #[cfg(luau)]
            luau_builds: None,
        }
    }

    /// Runs the directories with a `plugin.toml` and no native build as Luau plugins. `walked` runs on a walk's thread
    /// when a walk of a plugin's files found something new, a copy of approved files ended, or a build was compiled:
    /// the host reconciles.
    #[cfg(luau)]
    pub fn with_luau(self, walked: impl Fn() + Send + Sync + 'static) -> Self {
        let walked: std::sync::Arc<dyn Fn() + Send + Sync> = std::sync::Arc::new(walked);
        let wake = walked.clone();
        Self {
            luau: Some(crate::pipe::tree::Trees::new(move || wake())),
            luau_builds: Some(crate::luau::Builds::new(walked)),
            ..self
        }
    }

    /// Whether `target` runs as a Luau plugin: it is a directory with a `plugin.toml` and no native build.
    #[cfg(luau)]
    fn luau_target(&self, target: &Target) -> bool {
        self.luau.is_some()
            && target.library().is_none()
            && target.local.as_deref().is_some_and(|dir| dir.is_dir() && crate::luau::is_plugin(dir))
    }

    /// Whether a walk, a copy or a compilation of a Luau plugin's files runs.
    #[cfg(all(test, luau))]
    pub(crate) fn luau_walking(&self) -> bool {
        self.luau.as_ref().is_some_and(crate::pipe::tree::Trees::walking)
            || self.luau_builds.as_ref().is_some_and(crate::luau::Builds::running)
    }

    /// Whether a compiled Luau build waits for the next reconcile.
    #[cfg(all(test, luau))]
    pub(crate) fn luau_ready(&self) -> bool {
        self.luau_builds.as_ref().is_some_and(crate::luau::Builds::ready)
    }

    #[cfg(not(luau))]
    fn luau_target(&self, _: &Target) -> bool {
        false
    }

    /// Finds a target named by npm package in the package cache under `cache`, as the TS client does.
    pub fn with_npm(self, cache: PathBuf) -> Self {
        Self { npm: Some(cache), ..self }
    }

    /// Replaces the TUI parts of the server's plugins, after the server listed its plugins, and the `plugins` entries
    /// of the user's own configuration as written, in order and removals included: the global opencode config's
    /// (`opencode.json`, then `opencode.jsonc`, in the config directory), then `cli.json`'s;
    /// the next [`Loader::reconcile`] applies them. They load on the JS host only. Whether either changed.
    pub fn set_server(&self, parts: Vec<ServerPart>, user: Vec<String>) -> bool {
        let next = (parts, user);
        let changed = *self.server.borrow() != next;
        self.server.replace(next);
        changed
    }

    /// Replaces the `plugins` entries of the user's own configuration ([`Loader::set_server`]), after `cli.json` or the
    /// global opencode config changed.
    pub fn set_user(&self, user: Vec<String>) {
        self.server.borrow_mut().1 = user;
    }

    /// The global config directory, which holds `cli.json` and the global opencode config.
    pub fn config_dir(&self) -> &Path {
        &self.config_dir
    }

    /// The local path a configured target names, or the package an npm spec names in the cache.
    fn local(&self, target: &str) -> Option<PathBuf> {
        local_source(target, &self.config_dir).or_else(|| self.package(target))
    }

    /// The name of the package the npm spec `spec` names: by the spec, else as the cache holds it (a git spec). `None`
    /// for a local path.
    fn package_name(&self, spec: &str) -> Option<String> {
        if local_source(spec, &self.config_dir).is_some() {
            return None;
        }
        npm::name(spec).or_else(|| {
            self.package(spec)?;
            self.packages.borrow().get(spec).map(|package| package.name.clone())
        })
    }

    /// The package `spec` names in the cache (with the JS host only, which is what runs it), pinned once found.
    fn package(&self, spec: &str) -> Option<PathBuf> {
        if let Some(pinned) = self.packages.borrow().get(spec) {
            return Some(pinned.directory.clone());
        }
        let cache = self.npm.as_deref().filter(|_| self.js())?;
        let npm::Package { directory, name } = npm::resolve(spec, cache)?;
        self.packages.borrow_mut().insert(spec.to_owned(), npm::Package { directory: directory.clone(), name });
        Some(directory)
    }

    /// Does the user's global configuration vouch for this server part? Project configuration can request a plugin,
    /// but cannot approve it.
    fn vouched(&self, user: &[String], spec: &str, local: Option<&Path>, id: Option<&str>) -> bool {
        let dirs = ["plugin", "plugins"].map(|name| real(&self.config_dir.join(name)));
        let child = local.is_some_and(|_| {
            let parent = Path::new(spec).parent().and_then(real);
            parent.is_some_and(|parent| dirs.contains(&Some(parent)))
        });
        let (mut named, mut enabled) = (child, child);
        let select = |selector: &str| selects(selector, spec) || id.is_some_and(|id| selects(selector, id));
        for entry in user {
            if let Some(selector) = entry.strip_prefix('-') {
                enabled &= !select(selector);
                continue;
            }
            let names = match (local, local_source(entry, &self.config_dir)) {
                (Some(local), Some(path)) => real(&path).as_deref() == Some(local),
                (None, None) => entry == spec,
                _ => false,
            };
            if names {
                named = true;
            }
            if names || entry == "*" || entry.ends_with(".*") || entry.starts_with("opencode.") || select(entry) {
                enabled = true;
            }
        }
        named && enabled
    }

    /// Runs the targets without a native build on `scripts`.
    #[cfg(feature = "ts")]
    pub fn with_scripts(self, scripts: Rc<Scripts>) -> Self {
        Self { scripts: Some(scripts), ..self }
    }

    /// Whether a JS host runs the TypeScript plugins: never in a build without the `ts` feature (ts-feature).
    fn js(&self) -> bool {
        #[cfg(feature = "ts")]
        return self.scripts.is_some();
        #[cfg(not(feature = "ts"))]
        return false;
    }

    /// Whether `target` runs on the JS host: it has no native build, and it is a directory.
    fn scripted(&self, target: &Target) -> bool {
        self.js()
            && target.library().is_none()
            && target.local.as_ref().is_some_and(|dir| dir.is_dir())
            && !self.luau_target(target)
    }

    /// Keeps the decisions on project plugins in `approvals` rather than in memory.
    pub fn with_approvals(self, approvals: Approvals) -> Self {
        Self { approvals, ..self }
    }

    /// Merges discovered and configured targets by local path. Later entries replace earlier ones in place.
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
        // Later entries take precedence: discovery, server parts, then `cli.json`.
        let (parts, user) = if self.js() { self.server.borrow().clone() } else { Default::default() };
        // Skip unresolved optional parts. Only the user's configuration can vouch for a server part.
        let configured = self.configured.borrow();
        let named: Vec<String> = configured.iter().filter_map(|entry| self.package_name(&entry.target)).collect();
        let server = parts.into_iter().filter_map(|part| {
            let (target, local, vouched) = match part {
                ServerPart::Package { spec, id } => {
                    if self.package_name(&spec).is_some_and(|name| named.contains(&name)) {
                        return None;
                    }
                    let local = self.package(&spec)?;
                    let vouched = self.vouched(&user, &spec, None, id.as_deref());
                    (spec, local, vouched)
                }
                ServerPart::Local { path, id } => {
                    let local = Path::new(&path).is_absolute().then(|| real(Path::new(&path))).flatten()?;
                    let vouched = self.vouched(&user, &path, Some(&local), id.as_deref());
                    (path, local, vouched)
                }
            };
            let target = Target { local: Some(local), target, options: None, project: !vouched };
            target.library().is_none().then_some((target, true))
        });
        let configured = configured.iter().map(|entry| Target {
            target: entry.target.clone(),
            local: self.local(&entry.target),
            options: entry.options.clone(),
            project: false,
        });
        let mut targets: Vec<Target> = Vec::new();
        let discovered = discovered.map(|target| (target, false));
        let configured = configured.map(|target| (target, false));
        // The targets that came from the server's parts, by their index.
        let mut served: Vec<usize> = Vec::new();
        for (target, from_server) in discovered.chain(server).chain(configured) {
            let key = |target: &Target| {
                target
                    .local
                    .as_ref()
                    .map_or_else(|| target.target.clone(), |local| local.to_string_lossy().into_owned())
            };
            // A library's file, or a TypeScript plugin's directory.
            let same_file = |known: &Target| {
                let file = |target: &Target| {
                    target.library().or_else(|| target.local.clone()).and_then(|file| identity(&file))
                };
                file(known).is_some_and(|known| file(&target) == Some(known))
            };
            // Only a configured entry stands in for a project's plugin: a server's never does.
            let alias = |known: &Target| !from_server && known.project && !target.project && same_file(known);
            // A server part that names a target already found, under any spelling, is that target: one target, one
            // approval.
            if from_server && targets.iter().any(|known| key(known) == key(&target) || same_file(known)) {
                continue;
            }
            // Compare real paths so a `cli.json` entry overrides the same server part reached through a symlink or
            // Windows verbatim path.
            let real_path = |target: &Target| target.local.as_deref().and_then(real);
            let same_part = |index: usize, known: &Target| {
                !from_server
                    && served.contains(&index)
                    && real_path(known).is_some_and(|known| Some(known) == real_path(&target))
            };
            match targets
                .iter()
                .enumerate()
                .position(|(index, known)| key(known) == key(&target) || alias(known) || same_part(index, known))
            {
                Some(index) => {
                    served.retain(|served| *served != index);
                    targets[index] = target;
                }
                None => {
                    if from_server {
                        served.push(targets.len());
                    }
                    targets.push(target);
                }
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
            // A package in the npm cache changes only by an install, which TS does not reload either (js-npm).
            if local_source(&target.target, &self.config_dir).is_none() {
                continue;
            }
            // A TypeScript plugin's modules may sit in its subdirectories, whose saves reload it too; its dependencies
            // change by an install, which touches the directory itself. So may a Luau plugin's.
            if (self.scripted(&target) || self.luau_target(&target))
                && let Some(local) = &target.local
            {
                let mut found = Vec::new();
                subdirectories(local, &mut found, 0);
                dirs.extend(found);
            }
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
            .filter(|target| {
                !targets.iter().any(|known| {
                    known.target == **target
                        && (known.library().is_some() || self.scripted(known) || self.luau_target(known))
                })
            })
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
            #[cfg(feature = "ts")]
            if let Some(scripts) = &self.scripts {
                scripts.forget(&target);
            }
            self.seen.borrow_mut().remove(&target);
            self.waiting.borrow_mut().remove(&target);
            self.held.borrow_mut().remove(&target);
            registry.unload(host, &target);
            registry.set_unloaded(&target, None);
            changed = true;
        }
        self.listed.replace(targets.iter().map(|target| target.target.clone()).collect());
        #[cfg(luau)]
        if let Some(builds) = &self.luau_builds {
            builds.retain(|name| targets.iter().any(|known| known.target == name && self.luau_target(known)));
        }
        self.packages.borrow_mut().retain(|spec, _| targets.iter().any(|known| known.target == *spec));
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
            crate::behave::remount(&**host);
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
                if let Some(package) = target.local.as_deref().and_then(package_name) {
                    registry.set_label(name, package);
                }
            }
            registry.set_unloaded(name, status);
            changed
        };
        #[cfg(luau)]
        if self.luau_target(target)
            && let Some(dir) = &target.local
        {
            return self.luau(host, registry, target, dir, &listed);
        }
        #[cfg(not(luau))]
        if target.library().is_none() && target.local.as_deref().is_some_and(|dir| dir.join("plugin.toml").is_file()) {
            return skip(crate::SKIPPED_NO_LUAU);
        }
        #[cfg(feature = "ts")]
        if self.scripted(target)
            && let (Some(scripts), Some(dir)) = (&self.scripts, &target.local)
        {
            // Bun is looked for only now, for the first TypeScript plugin; without it the plugin is skipped.
            if !scripts.runtime() {
                return skip(crate::SKIPPED_NO_BUN);
            }
            return self.script(host, registry, target, scripts, dir, &listed);
        }
        if target.library().is_none() {
            self.held.borrow_mut().remove(name);
            // What ran from a project's plugin whose build went stops now, not at the next reconcile.
            if target.project {
                registry.unload(host, name);
                self.seen.borrow_mut().remove(name);
            }
            if target.local.is_none() && registry.selects(name) {
                registry.set_unloaded(name, None);
                return false;
            }
            // Why, with the way to load it where there is one.
            return skip(&match (&target.local, self.js()) {
                (None, true) => npm::missing(name),
                (None, false) => SKIPPED_OFF.to_owned(),
                (Some(local), false) if local.is_dir() => SKIPPED_OFF.to_owned(),
                _ => SKIPPED.to_owned(),
            });
        }
        skip(crate::SKIPPED_NATIVE)
    }

    /// Registers the `definition` of `target`'s build `digest`, whose failure `error` reports.
    #[allow(clippy::too_many_arguments)]
    fn register(
        &self,
        host: &Rc<dyn Host>,
        registry: &Registry,
        listed: &Option<Status>,
        name: &str,
        definition: Definition,
        error: ErrorFn,
        digest: u64,
    ) -> bool {
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
            Some(failed) if failed.kept => return self.fail(&**host, registry, listed, name, digest, failed.error),
            // The plugin is listed as failed, and enabling it runs this build's setup again.
            Some(failed) => self.tell(&**host, registry, listed, name, failed.error),
            None => {}
        }
        self.seen.borrow_mut().insert(name.to_owned(), Seen { digest, reload });
        true
    }

    /// Brings the TypeScript plugin of `target`, the directory `dir`, in line with the JS host: its load is sent when it
    /// is new or changed, and registered once it is answered. A running build keeps running while the next loads.
    #[cfg(feature = "ts")]
    fn script(
        &self,
        host: &Rc<dyn Host>,
        registry: &Registry,
        target: &Target,
        scripts: &Rc<Scripts>,
        dir: &Path,
        listed: &Option<Status>,
    ) -> bool {
        let name = target.target.as_str();
        // A project's TypeScript plugin runs only once the user approved its files: until then
        // nothing of it reaches the JS host, which does not start for it. What the JS host imports is a copy of
        // exactly the approved files; a save since the approval holds the plugin back for a decision on it. Its files
        // are hashed and copied off the UI thread: until the first walk, or the copy of an approved tree, ended it is
        // starting. A copy that does not stage, as the files changed under a stamp the walk could not tell from the
        // approved one, is held back with why, and its tree is hashed whole again off the UI thread: the new build is
        // asked about once that walk ends. A package from the npm cache a server part names is approved by its files
        // and its install's `package.json` and lockfile ([`Artifact::tree`]), and runs where it is: its dependencies
        // sit beside it, not in it, so a copy of it could not import them.
        let package = self.packages.borrow().values().any(|known| known.directory == dir);
        let staged = match target.project {
            true => {
                let Some(tree) = scripts.tree(dir) else {
                    return !registry.loaded(name) && starting(registry, name, listed);
                };
                match self.approved(host, registry, name, tree) {
                    Ok(_) if package => None,
                    Ok(artifact) => match self.approvals.staging().map(|root| scripts.staged(&artifact, &root)) {
                        Ok(None) => return !registry.loaded(name) && starting(registry, name, listed),
                        Ok(Some(Ok(staged))) => Some(staged),
                        Ok(Some(Err(error))) | Err(error) => {
                            scripts.forget(name);
                            scripts.rewalk(dir);
                            return self.hold(host, registry, name, Err(error), None);
                        }
                    },
                    Err(changed) => {
                        scripts.forget(name);
                        return changed;
                    }
                }
            }
            false => None,
        };
        let dir = staged.as_deref().unwrap_or(dir);
        match scripts.step(name, dir, target.options.as_deref(), staged.is_some()) {
            Step::Same => false,
            // Its setup runs only when it starts enabled.
            Step::Described(id) => {
                match registry.starts_enabled(name, &id) {
                    true => scripts.set_up(name),
                    false => {
                        scripts.inactive(name);
                        return self.script(host, registry, target, scripts, dir, listed);
                    }
                }
                false
            }
            Step::Starting if registry.loaded(name) => false,
            Step::Starting => starting(registry, name, listed),
            Step::Unsupported(reason) => {
                registry.unload(host, name);
                self.seen.borrow_mut().remove(name);
                let reason = format!("{}: {reason}", crate::NO_TUI_MODULE);
                let status = Status::Skipped(reason.clone());
                let changed = listed.as_ref() != Some(&status);
                if changed {
                    log::warn!("plugin {name} skipped: {reason}");
                }
                registry.set_unloaded(name, Some(status));
                changed
            }
            Step::Failed(_, digest) if self.seen.borrow().get(name).is_some_and(|seen| seen.digest == digest) => false,
            Step::Failed(error, digest) => {
                if let Some(package) = package_name(dir) {
                    registry.set_label(name, package);
                }
                self.fail(&**host, registry, listed, name, digest, error)
            }
            Step::Ready(definition, error, digest) => {
                if registry.id_taken(&definition.id, name) {
                    // What the JS host set up of it goes.
                    scripts.forget(name);
                    let error = format!("plugin ID {} is already registered", definition.id);
                    return self.fail(&**host, registry, listed, name, digest, error);
                }
                log::info!("plugin {} loaded on the JS host from {}", definition.id, dir.display());
                self.register(host, registry, listed, name, definition, error, digest)
            }
        }
    }

    /// Brings the Luau plugin of `target`, the directory `dir`, in line with its files: loaded when new or changed,
    /// in process ([`crate::luau`]). A running build keeps running while the next fails to compile or set up. A walk on a
    /// thread of its own finds a plugin's files changed, and another thread reads and compiles them; until the first
    /// build is compiled the plugin is starting. A project's plugin runs only once the user approved its directory as a Luau plugin
    /// ([`crate::luau::artifact`]), from the staged copy of the approved bytes, made off the UI thread too.
    #[cfg(luau)]
    fn luau(
        &self,
        host: &Rc<dyn Host>,
        registry: &Registry,
        target: &Target,
        dir: &Path,
        listed: &Option<Status>,
    ) -> bool {
        let name = target.target.as_str();
        let (Some(trees), Some(builds)) = (&self.luau, &self.luau_builds) else { return false };
        let walking = || !registry.loaded(name) && luau_starting(registry, name, listed);
        let (from, build) = match target.project {
            true => {
                let Some(tree) = trees.artifact(dir) else { return walking() };
                let artifact = match self.approved(host, registry, name, tree.map(crate::luau::artifact)) {
                    Ok(artifact) => artifact,
                    Err(changed) => return changed,
                };
                let mut hasher = DefaultHasher::new();
                hasher.write(artifact.sha256.as_bytes());
                let tree = crate::luau::tree_of(&artifact);
                match self.approvals.staging().map(|root| trees.staged(&tree, &root)) {
                    Ok(None) => return walking(),
                    Ok(Some(Ok(staged))) => (staged, hasher.finish()),
                    Ok(Some(Err(error))) | Err(error) => {
                        trees.rewalk(dir);
                        return self.hold(host, registry, name, Err(error), None);
                    }
                }
            }
            false => match trees.light(dir) {
                None => return walking(),
                Some(Ok(light)) => (dir.to_path_buf(), light),
                Some(Err(error)) => return self.fail(&**host, registry, listed, name, 0, error),
            },
        };
        let digest = {
            let mut hasher = DefaultHasher::new();
            hasher.write_u64(build);
            hasher.write(target.options.as_deref().unwrap_or_default().as_bytes());
            hasher.finish()
        };
        if self.seen.borrow().get(name).is_some_and(|seen| seen.digest == digest) {
            return false;
        }
        // A project's plugin loads from a staged copy named by its hash; a global one's key is its walk's light hash.
        let built = match builds.built(name, &from, build, !target.project) {
            None => return walking(),
            Some(Ok(built)) => built,
            Some(Err(error)) => return self.fail(&**host, registry, listed, name, digest, error),
        };
        self.waiting.borrow_mut().remove(name);
        let loaded = built.define(target.options.as_deref(), crate::luau::MEMORY).and_then(|loaded| {
            if !registry.id_taken(&loaded.0.id, name) {
                return Ok(loaded);
            }
            self.waiting.borrow_mut().insert(name.to_owned(), loaded.0.id.clone());
            Err(format!("plugin ID {} is already registered", loaded.0.id))
        });
        match loaded {
            Ok((definition, error)) => {
                log::info!("plugin {} loaded as Luau from {}", definition.id, from.display());
                self.register(host, registry, listed, name, definition, error, digest)
            }
            Err(error) => self.fail(&**host, registry, listed, name, digest, error),
        }
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
        // The same error is a new notification if the previous build no longer runs.
        let error = match registry.failed_load(target, &error) {
            true => reload.borrow_mut().insert(format!("{error} (previous version still active)")).clone(),
            false => error,
        };
        self.tell(host, registry, listed, target, error);
        true
    }

    /// Records the user's `decision` on `artifact`, the build of `target` they were shown, once `now`, what
    /// [`Loader::found`] identified on the disk after the answer, is that build. It is recorded only while that build
    /// is the one held back: `Ok(false)` records nothing when the build changed since, and the user is asked about the
    /// new one. An error when it cannot be saved; nothing changes then. The next [`Loader::reconcile`] applies it: an
    /// approved build loads, a declined one is not asked about again.
    pub fn decide(
        &self,
        target: &str,
        artifact: &Artifact,
        decision: Decision,
        now: Option<Result<Artifact, String>>,
    ) -> Result<bool, String> {
        if self.held.borrow().get(target) != Some(&Ok(artifact.clone())) {
            return Ok(false);
        }
        // An approval applies only if the build on disk still matches the one shown in the prompt.
        if now.as_ref().is_none_or(|now| now.as_ref() != Ok(artifact)) {
            return Ok(false);
        }
        self.approvals.decide(artifact, decision).map(|()| true)
    }

    /// Sequence answers because their disk checks can finish out of order.
    pub fn deciding(&self, target: &str) -> u64 {
        let mut answers = self.answers.borrow_mut();
        let answer = answers.entry(target.to_owned()).or_default();
        *answer += 1;
        *answer
    }

    /// Whether the user answered on `target` again since the answer [`Loader::deciding`] counted as `answer`: then that
    /// answer is not recorded, and nothing is said about it.
    pub fn superseded(&self, target: &str, answer: u64) -> bool {
        self.answers.borrow().get(target).is_some_and(|last| *last != answer)
    }

    /// The build `target` holds on the disk now, as a reconcile reads it, for [`Loader::decide`]: its TypeScript or
    /// Luau tree to hash ([`Found::identify`]). `None` when it is no target.
    pub fn found(&self, target: &str) -> Option<Found> {
        let known = self.targets().into_iter().find(|known| known.target == target)?;
        #[cfg(luau)]
        if let (true, Some(dir)) = (self.luau_target(&known), &known.local) {
            return Some(Found::Luau(dir.clone()));
        }
        if let (true, Some(dir)) = (self.scripted(&known), &known.local) {
            return Some(Found::Tree(dir.clone()));
        }
        Some(Found::Refused(match known.library() {
            Some(file) => format!("{}: {}", file.display(), crate::SKIPPED_NATIVE),
            None => format!("{}: no build", known.target),
        }))
    }

    /// Returns the approved artifact or holds the target pending. The error indicates whether the manager list
    /// changed.
    fn approved(
        &self,
        host: &Rc<dyn Host>,
        registry: &Registry,
        target: &str,
        artifact: Result<Artifact, String>,
    ) -> Result<Artifact, bool> {
        let artifact = match artifact {
            Ok(artifact) => artifact,
            Err(error) => return Err(self.hold(host, registry, target, Err(error), None)),
        };
        match self.approvals.decision(&artifact) {
            Some(Decision::Approved) => {
                self.held.borrow_mut().remove(target);
                Ok(artifact)
            }
            decision => Err(self.hold(host, registry, target, Ok(artifact), decision)),
        }
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

/// Lists the Luau plugin `name` as starting while its files are walked: whether the manager's list changed.
#[cfg(luau)]
fn luau_starting(registry: &Registry, name: &str, listed: &Option<Status>) -> bool {
    let status = Status::Skipped(crate::luau::STARTING.to_owned());
    let changed = listed.as_ref() != Some(&status);
    registry.set_unloaded(name, Some(status));
    changed
}

/// Lists the TypeScript plugin `name` as starting on the JS host: whether the manager's list changed.
#[cfg(feature = "ts")]
fn starting(registry: &Registry, name: &str, listed: &Option<Status>) -> bool {
    let status = Status::Skipped(STARTING.to_owned());
    let changed = listed.as_ref() != Some(&status);
    registry.set_unloaded(name, Some(status));
    changed
}

/// The subdirectories of `dir`, `node_modules` and `.git` left out, to a depth of 8 and at most 64 in all.
fn subdirectories(dir: &Path, found: &mut Vec<PathBuf>, depth: usize) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name();
        if depth >= 8 || found.len() >= 64 || name == "node_modules" || name == ".git" || !entry.path().is_dir() {
            continue;
        }
        found.push(entry.path());
        subdirectories(&entry.path(), found, depth + 1);
    }
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

/// The `plugins` directories to search: the global config directory's, then each `.opencode` directory from the
/// project root ([`project_root`]) down to `cwd`. Directories other than the global one and the project's that do not
/// exist are left out.
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

/// The plugin directories inside `directories`: every subdirectory, or symlink to one, by name in each.
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

/// The local path a `plugins` target names: a `file://` URL, or a `./`, `../`, or absolute path resolved against
/// `directory`. A package name is not local. A URL decodes as TS `fileURLToPath` does; one that names no local file (a
/// remote host) is not local. Absolute is `path.isAbsolute`: on Windows a rooted path without a drive (`/abs/x`) is
/// absolute too and takes `directory`'s drive.
pub fn local_source(target: &str, directory: &Path) -> Option<PathBuf> {
    let path = if target.starts_with("file://") {
        opencode_api_types::js::parse_url(target).ok()?.to_file_path().ok()?
    } else if target.starts_with("./")
        || target.starts_with("../")
        || (cfg!(windows) && (target.starts_with(".\\") || target.starts_with("..\\")))
        || Path::new(target).has_root()
    {
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
    // Bun resolves nothing under a verbatim directory (win11-runs D2): `\\?\C:\x` is handed on as `C:\x`.
    Some(plain(resolved))
}

#[cfg(test)]
pub(crate) mod tests;
