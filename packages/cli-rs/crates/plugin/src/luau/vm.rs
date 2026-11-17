//! One Luau VM a plugin activation: the sources compiled once a build, the sandbox, `require` by Luau's
//! require-by-string rules over the plugin's own files, the budget's interrupt and the memory cap
//! (`steps/luau-spike.md` 1.3, 1.4; `luau/steps/better-audit.md` 2).

use std::cell::{Cell, RefCell};
use std::collections::{BTreeMap, BTreeSet};
use std::rc::Rc;
use std::time::{Duration, Instant};

use mlua::chunk::ChunkMode;
use mlua::luau::{NavigateError, Require};
use mlua::{Function, Lua, MultiValue, Table, Value, VmState};

use super::Sources;

/// The heap a VM may hold: the content a plugin may hold (O-147).
pub const MEMORY: usize = 32 << 20;

/// The most of one `print` the log keeps, in bytes of the plugin's text.
pub(crate) const PRINT: usize = 4 << 10;

/// How near its cap a VM's heap may be once a call returned, after a full collection: nearer, the plugin ran out of
/// memory and caught the error, and every binding would fail at random from then on.
const MARGIN: usize = 1 << 20;

/// How many interrupts pass between two reads of the clock, as rune-luau's watchdog does.
const TICKS: u32 = 256;

/// The modules of plugin `id`'s build, compiled once: bytecode by module name (`init`, `lib/util`, `x/init`), the
/// plugin's `.luaurc` files by their directory (`""` is the plugin's root), every directory that holds either, and the
/// entry's name.
pub(crate) struct Compiled {
    id: String,
    modules: BTreeMap<String, Vec<u8>>,
    configs: BTreeMap<String, Vec<u8>>,
    dirs: BTreeSet<String>,
    entry: String,
}

impl Compiled {
    /// Compiles every `.luau` file of `sources`; a syntax error is the build's, before any setup, and reads
    /// `<id>: <file>.luau:<line>: <message>`.
    pub(crate) fn new(sources: &Sources, id: &str, entry: &str) -> Result<Self, String> {
        let compiler = mlua::chunk::Compiler::new().set_optimization_level(1).set_debug_level(1);
        let (mut modules, mut configs) = (BTreeMap::new(), BTreeMap::new());
        for (path, bytes) in sources.files() {
            if let Some(dir) = path.strip_suffix(super::LUAURC).filter(|dir| dir.is_empty() || dir.ends_with('/')) {
                configs.insert(dir.trim_end_matches('/').to_owned(), bytes.clone());
                continue;
            }
            let Some(name) = path.strip_suffix(".luau") else { continue };
            let code = compiler.compile(bytes).map_err(|error| match error {
                // Luau's message starts with the line: `3: Expected identifier ...`.
                mlua::Error::SyntaxError { message, .. } => format!("{id}: {path}:{}", message.trim_start_matches(':')),
                error => format!("{id}: {path}: {error}"),
            })?;
            modules.insert(name.to_owned(), code);
        }
        let dirs = modules
            .keys()
            .filter_map(|name| name.rsplit_once('/').map(|(dir, _)| dir))
            .chain(configs.keys().map(String::as_str))
            .flat_map(|dir| dir.match_indices('/').map(|(at, _)| &dir[..at]).chain([dir]))
            .chain([""])
            .map(str::to_owned)
            .collect();
        let entry = entry.strip_suffix(".luau").unwrap_or(entry).to_owned();
        if !modules.contains_key(&entry) {
            return Err(format!("plugin.toml names the entry {entry}.luau, which the plugin does not have"));
        }
        Ok(Self { id: id.to_owned(), modules, configs, dirs, entry })
    }

    /// The module at `path` (`""` is the plugin's root), as Luau's require-by-string finds one: `path.luau` or
    /// `path/init.luau`, and both is an ambiguity; `None` for a directory with neither. A path whose last part is
    /// `init` names no module of its own: its directory is the module.
    fn resolve(&self, path: &str) -> Result<Option<&str>, NavigateError> {
        let init = if path.is_empty() { "init".to_owned() } else { format!("{path}/init") };
        let file = (!path.is_empty() && path.rsplit('/').next() != Some("init")).then_some(path);
        let mut found = [file, Some(init.as_str())]
            .into_iter()
            .flatten()
            .filter_map(|key| self.modules.get_key_value(key).map(|(key, _)| key.as_str()));
        match (found.next(), found.next()) {
            (Some(_), Some(_)) => Err(NavigateError::Ambiguous),
            (Some(key), None) => Ok(Some(key)),
            _ if self.dirs.contains(path) => Ok(None),
            _ => Err(NavigateError::NotFound),
        }
    }
}

/// The budget of one call: armed by the outermost entry into the VM, read at the interrupt.
pub(crate) struct Budget {
    limit: Duration,
    /// When the outermost call began, and the thread's CPU time then.
    armed: Cell<Option<(Instant, Option<Duration>)>>,
    ticks: Cell<u32>,
    /// Why the interrupt stopped this call: the call fails with it, also when the plugin caught the error.
    stopped: RefCell<Option<String>>,
}

impl Budget {
    fn interrupt(&self) -> mlua::Result<VmState> {
        // Once it fired, every safepoint raises again: a plugin that catches the error with `pcall` meets it at the next
        // safepoint outside its `pcall`, so the call ends.
        if let Some(stopped) = &*self.stopped.borrow() {
            return Err(mlua::Error::runtime(stopped));
        }
        let ticks = self.ticks.get().wrapping_add(1);
        self.ticks.set(ticks);
        if !ticks.is_multiple_of(TICKS) {
            return Ok(VmState::Continue);
        }
        let Some((start, cpu)) = self.armed.get() else { return Ok(VmState::Continue) };
        // CPU time cannot pass wall time on one thread: the cheap clock gates the dear one.
        if start.elapsed() < self.limit {
            return Ok(VmState::Continue);
        }
        let used = match (crate::contain::thread_cpu(), cpu) {
            (Some(now), Some(then)) => now.saturating_sub(then),
            // Where the OS gives no CPU time the wall-time rule applies, as for the other carriers.
            _ => start.elapsed(),
        };
        if used < self.limit {
            return Ok(VmState::Continue);
        }
        let stopped = format!(
            "used {} ms of CPU, over the limit of {} ms: stopped by the Luau budget",
            used.as_millis(),
            self.limit.as_millis()
        );
        *self.stopped.borrow_mut() = Some(stopped.clone());
        Err(mlua::Error::runtime(stopped))
    }
}

/// A plugin's VM: its Luau state, sandboxed, with the plugin's modules behind `require`.
pub(crate) struct Vm {
    pub(crate) lua: Lua,
    budget: Rc<Budget>,
    /// The heap's cap.
    cap: usize,
    /// The modules being loaded, outermost first: one asked for again is a cycle.
    loading: Rc<RefCell<Vec<String>>>,
    /// The plugin's ID, which its errors start with.
    id: String,
}

impl Vm {
    /// A new VM for `compiled`, CPU time limited to `limit` a call and the heap to `memory`. The globals are frozen
    /// once it starts; nothing of the plugin has run yet.
    pub(crate) fn new(compiled: &Rc<Compiled>, limit: Duration, memory: usize) -> mlua::Result<Self> {
        let lua = Lua::new();
        lua.set_memory_limit(memory)?;
        let budget =
            Rc::new(Budget { limit, armed: Cell::new(None), ticks: Cell::new(0), stopped: RefCell::new(None) });
        let interrupt = budget.clone();
        lua.set_interrupt(move |_| interrupt.interrupt());
        // What a binding reaches to fail the call ([`refuse`]).
        lua.set_app_data(budget.clone());
        let loading = Rc::default();
        let files =
            Files { compiled: compiled.clone(), loading: Rc::clone(&loading), requirer: String::new(), at: None };
        let globals = lua.globals();
        // Luau has no `io`; `os` reads clocks. What mlua adds that reaches beyond the plugin goes: the file system's
        // `require`, and `loadstring`, which would compile code the sandbox never saw.
        globals.raw_set("loadstring", Value::Nil)?;
        globals.raw_set("require", lua.create_require_function(files)?)?;
        // Luau's `print` writes to the process's stdout, the terminal under the TUI: escape sequences would reach it, and
        // a big print blocks on it without using CPU time, so the budget never ends it.
        globals.raw_set("print", print(&lua, &compiled.id)?)?;
        Ok(Self { lua, budget, loading, id: compiled.id.clone(), cap: memory })
    }

    /// Runs the entry module and returns what it returned. Freezes the globals first (`Lua::sandbox`). The entry is
    /// `require`'s too: a module that requires it while it runs is a cycle, and once it ran it is what it returned.
    pub(crate) fn start(&self, compiled: &Compiled) -> Result<Value, String> {
        self.lua.sandbox(true).map_err(|error| error.to_string())?;
        let entry = &compiled.entry;
        let loader = load(&self.lua, compiled, &self.loading, entry).map_err(|error| error.to_string())?;
        let module = self.call(|| loader.call::<Value>(()))?;
        // mlua's `require` keeps what each module returned in this registry table, by its cache key.
        let cached = self.lua.named_registry_value::<Option<Table>>("__MLUA_LOADER_CACHE");
        if let Ok(Some(cached)) = cached {
            cached.raw_set(entry.as_str(), &module).map_err(|error| error.to_string())?;
        }
        Ok(module)
    }

    /// Calls into the VM within the budget: the outermost call arms it. A Luau error, the budget's interrupt (also
    /// one the plugin caught), an allocation over the cap, or a heap the outermost call left at the cap (an allocation
    /// over it the plugin caught) is the error's text, after the plugin's ID ([`report`]).
    pub(crate) fn call<R>(&self, f: impl FnOnce() -> mlua::Result<R>) -> Result<R, String> {
        let outer = self.budget.armed.get().is_none();
        if outer {
            // The monitor's reading as the call began, when it took one: one CPU clock read a call.
            let cpu = crate::contain::call_cpu().or_else(crate::contain::thread_cpu);
            self.budget.armed.set(Some((Instant::now(), cpu)));
            self.budget.stopped.take();
        }
        let result = f();
        if !outer {
            return result.map_err(|error| error.to_string());
        }
        self.budget.armed.set(None);
        if let Some(stopped) = self.budget.stopped.take() {
            return Err(format!("{}: {stopped}", self.id));
        }
        let result = result.map_err(|error| report(&self.id, &error.to_string()))?;
        if self.lua.used_memory() + MARGIN >= self.cap {
            // Garbage does not count: only what a full collection leaves.
            let _ = self.lua.gc_collect();
            let used = self.lua.used_memory();
            if used + MARGIN >= self.cap {
                return Err(format!(
                    "{}: holds {used} bytes of its {} MiB heap after a call: out of memory, stopped by the Luau memory cap",
                    self.id,
                    self.cap >> 20
                ));
            }
        }
        Ok(result)
    }

    /// The bytes the VM's heap holds.
    pub(crate) fn memory(&self) -> usize {
        self.lua.used_memory()
    }
}

/// What an author reads for Luau error `error` of plugin `id`: `<id>: <file>.luau:<line>: <message>`, then the
/// traceback's frames in the plugin's own files. mlua's `runtime error:` prefix goes, and so do the frames of C
/// functions, of mlua's `require` and of the host's `@opencode/plugin`, which say nothing about the plugin.
fn report(id: &str, error: &str) -> String {
    let (message, traceback) = error.split_once("\nstack traceback:\n").unwrap_or((error, ""));
    let message = message.trim_end().strip_prefix("runtime error: ").unwrap_or(message.trim_end());
    let frames: Vec<&str> = traceback
        .lines()
        .map(|line| line.trim_start_matches(['\t', ' ', '>']))
        .filter(|frame| frame.split(':').next().is_some_and(|file| file.ends_with(".luau")))
        .collect();
    if frames.is_empty() {
        return format!("{id}: {message}");
    }
    format!("{id}: {message}\nstack traceback:\n\t{}", frames.join("\n\t"))
}

/// Fails the running call of the VM `lua` with `reason`, also when the plugin catches the error a binding raises: the
/// call ends with it, and every safepoint until then raises it again, as the budget's interrupt does.
pub(crate) fn refuse(lua: &Lua, reason: &str) {
    if let Some(budget) = lua.app_data_ref::<Rc<Budget>>() {
        budget.stopped.borrow_mut().get_or_insert_with(|| reason.to_owned());
    }
}

/// The plugin's `print`: its arguments as `tostring` gives them, separated by tabs, as one line of the client's log
/// naming the plugin. At most [`PRINT`] bytes of them, with control characters (the tabs too) escaped.
fn print(lua: &Lua, id: &str) -> mlua::Result<Function> {
    let id = id.to_owned();
    lua.create_function(move |_, values: MultiValue| {
        let (mut kept, mut total) = (Vec::new(), 0);
        let mut keep = |part: &[u8]| {
            kept.extend_from_slice(&part[..part.len().min(PRINT - kept.len())]);
            total += part.len();
        };
        for (index, value) in values.iter().enumerate() {
            if index > 0 {
                keep(b"\t");
            }
            match value {
                // Only what is kept is copied: a print of 16 MiB costs what one of 4 KiB does.
                Value::String(text) => keep(&text.as_bytes()),
                value => keep(value.to_string()?.as_bytes()),
            }
        }
        let line: String = String::from_utf8_lossy(&kept)
            .chars()
            .flat_map(|char| match char.is_control() {
                true => char.escape_default().collect::<Vec<_>>(),
                false => vec![char],
            })
            .collect();
        match total > PRINT {
            true => log::info!("plugin {id} printed: {line}... ({total} bytes, cut at {PRINT})"),
            false => log::info!("plugin {id} printed: {line}"),
        }
        Ok(())
    })
}

/// The plugin's files as Luau's require-by-string sees them (mlua's [`Require`]), from the bytes read at load: the
/// disk is never read again. `./x` is beside the requiring module and `@self/x` inside it, so in `init.luau`, which
/// is the plugin's root module, `./x` is outside the plugin and `@self/x` is `x.luau`. Nothing above the root is
/// reached, only a `.luaurc` inside the plugin is read, and `@opencode` is always the host's, whatever a `.luaurc`
/// says: `@opencode/plugin` is registered (`Lua::register_module`), and anything else under it is not found.
struct Files {
    compiled: Rc<Compiled>,
    loading: Rc<RefCell<Vec<String>>>,
    /// The requiring module, by its path in the plugin: `""` is the root, the module of `init.luau`.
    requirer: String,
    /// Where navigation is: a path in the plugin, or `None` for the host's `@opencode`, which holds no file.
    at: Option<String>,
}

impl Files {
    fn module(&self) -> Option<&str> {
        self.at.as_deref().and_then(|at| self.compiled.resolve(at).ok().flatten())
    }
}

impl Require for Files {
    fn is_require_allowed(&self, chunk_name: &str) -> bool {
        chunk_name.starts_with('@')
    }

    fn reset(&mut self, chunk_name: &str) -> Result<(), NavigateError> {
        let name = chunk_name.strip_prefix('@').and_then(|name| name.strip_suffix(".luau"));
        let name = name.filter(|name| self.compiled.modules.contains_key(*name)).ok_or(NavigateError::NotFound)?;
        let path = if name == "init" { "" } else { name.strip_suffix("/init").unwrap_or(name) };
        self.requirer = path.to_owned();
        self.at = Some(path.to_owned());
        Ok(())
    }

    /// An alias whose path is not relative to its `.luaurc` leaves the plugin.
    fn jump_to_alias(&mut self, _path: &str) -> Result<(), NavigateError> {
        Err(NavigateError::NotFound)
    }

    fn to_alias_override(&mut self, alias: &str) -> Result<(), NavigateError> {
        self.at = match alias {
            "opencode" => None,
            // Luau 747's rule already: `@self` is the requiring module, which no `.luaurc` overrides.
            "self" => Some(self.requirer.clone()),
            _ => return Err(NavigateError::NotFound),
        };
        Ok(())
    }

    fn to_parent(&mut self) -> Result<(), NavigateError> {
        let parent = match self.at.as_deref() {
            None | Some("") => return Err(NavigateError::NotFound),
            Some(at) => at.rsplit_once('/').map_or("", |(parent, _)| parent).to_owned(),
        };
        self.compiled.resolve(&parent)?;
        self.at = Some(parent);
        Ok(())
    }

    fn to_child(&mut self, name: &str) -> Result<(), NavigateError> {
        let child = match self.at.as_deref() {
            None => return Err(NavigateError::NotFound),
            Some("") => name.to_owned(),
            Some(at) => format!("{at}/{name}"),
        };
        self.compiled.resolve(&child)?;
        self.at = Some(child);
        Ok(())
    }

    fn has_module(&self) -> bool {
        self.module().is_some()
    }

    fn cache_key(&self) -> String {
        self.module().unwrap_or_default().to_owned()
    }

    fn has_config(&self) -> bool {
        self.at.as_ref().is_some_and(|at| self.compiled.configs.contains_key(at))
    }

    fn config(&self) -> std::io::Result<Vec<u8>> {
        Ok(self.at.as_ref().and_then(|at| self.compiled.configs.get(at)).cloned().unwrap_or_default())
    }

    fn loader(&self, lua: &Lua) -> mlua::Result<Function> {
        load(lua, &self.compiled, &self.loading, self.module().unwrap_or_default())
    }
}

/// What runs module `key` of `compiled`: its bytecode, named `@<key>.luau`, within the record of the modules being
/// loaded. A module asked for while it loads is a cycle, an error naming it. The check is the loader's own, because
/// Luau's `require` keeps the loader by its cache key and calls it again until mlua's cache holds the module.
fn load(lua: &Lua, compiled: &Compiled, loading: &Rc<RefCell<Vec<String>>>, key: &str) -> mlua::Result<Function> {
    let code = compiled.modules.get(key).ok_or_else(|| mlua::Error::runtime(format!("no module {key}.luau")))?;
    let chunk = lua.load(code).set_name(format!("@{key}.luau")).set_mode(ChunkMode::Binary).into_function()?;
    let (loading, key) = (loading.clone(), key.to_owned());
    lua.create_function(move |_, ()| {
        if loading.borrow().contains(&key) {
            let chain = loading.borrow().join(" -> ");
            return Err(mlua::Error::runtime(format!("require cycle: {chain} -> {key}")));
        }
        loading.borrow_mut().push(key.clone());
        let module = chunk.call::<Value>(());
        loading.borrow_mut().pop();
        module
    })
}
