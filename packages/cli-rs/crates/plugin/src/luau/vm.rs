//! One Luau VM a plugin activation: the sources compiled once a build, the sandbox, `require` held to the plugin's own
//! files, the budget's interrupt and the memory cap (`steps/luau-spike.md` 1.3, 1.4).

use std::cell::{Cell, RefCell};
use std::collections::BTreeMap;
use std::rc::Rc;
use std::time::{Duration, Instant};

use mlua::chunk::ChunkMode;
use mlua::{Function, Lua, Table, Value, VmState};

use super::Sources;

/// The heap a VM may hold: the content a plugin may hold (O-147).
pub const MEMORY: usize = 32 << 20;

/// How many interrupts pass between two reads of the clock, as rune-luau's watchdog does.
const TICKS: u32 = 256;

/// The modules of a build, compiled once: bytecode by module name (`init`, `lib/util`), and the entry's name.
pub(crate) struct Compiled {
    modules: BTreeMap<String, Vec<u8>>,
    entry: String,
}

impl Compiled {
    /// Compiles every `.luau` file of `sources`; a syntax error is the build's, before any setup.
    pub(crate) fn new(sources: &Sources, entry: &str) -> Result<Self, String> {
        let compiler = mlua::chunk::Compiler::new().set_optimization_level(1).set_debug_level(1);
        let mut modules = BTreeMap::new();
        for (path, bytes) in sources.files() {
            let Some(name) = path.strip_suffix(".luau") else { continue };
            let code = compiler.compile(bytes).map_err(|error| format!("{path}: {error}"))?;
            modules.insert(name.to_owned(), code);
        }
        let entry = entry.strip_suffix(".luau").unwrap_or(entry).to_owned();
        if !modules.contains_key(&entry) {
            return Err(format!("plugin.toml names the entry {entry}.luau, which the plugin does not have"));
        }
        Ok(Self { modules, entry })
    }

    /// The module `name` resolves to: `name` itself, or `name/init`.
    fn module(&self, name: &str) -> Option<(&str, &[u8])> {
        let init = format!("{name}/init");
        [name, init.as_str()]
            .into_iter()
            .find_map(|key| self.modules.get_key_value(key).map(|(key, code)| (key.as_str(), code.as_slice())))
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
}

impl Vm {
    /// A new VM for `compiled`, with the host's module `plugin` as `@opencode/plugin`, CPU time limited to `limit` a call
    /// and the heap to `memory`. The globals are frozen; nothing of the plugin has run yet.
    pub(crate) fn new(compiled: &Rc<Compiled>, limit: Duration, memory: usize) -> mlua::Result<Self> {
        let lua = Lua::new();
        lua.set_memory_limit(memory)?;
        let budget =
            Rc::new(Budget { limit, armed: Cell::new(None), ticks: Cell::new(0), stopped: RefCell::new(None) });
        let interrupt = budget.clone();
        lua.set_interrupt(move |_| interrupt.interrupt());
        let globals = lua.globals();
        // Luau has no `io`; `os` reads clocks. What mlua adds that reaches beyond the plugin goes: the file system's
        // `require`, and `loadstring`, which would compile code the sandbox never saw.
        globals.raw_set("loadstring", Value::Nil)?;
        globals.raw_set("require", require(&lua, compiled)?)?;
        Ok(Self { lua, budget })
    }

    /// Runs the entry module and returns what it returned. Freezes the globals first (`Lua::sandbox`).
    pub(crate) fn start(&self, compiled: &Compiled) -> Result<Value, String> {
        self.lua.sandbox(true).map_err(|error| error.to_string())?;
        let entry = load(&self.lua, compiled, &compiled.entry).map_err(|error| error.to_string())?;
        self.call(|| entry.call::<Value>(()))
    }

    /// Calls into the VM within the budget: the outermost call arms it. A Luau error, the budget's interrupt (also
    /// one the plugin caught) or an allocation over the cap is the error's text.
    pub(crate) fn call<R>(&self, f: impl FnOnce() -> mlua::Result<R>) -> Result<R, String> {
        let outer = self.budget.armed.get().is_none();
        if outer {
            self.budget.armed.set(Some((Instant::now(), crate::contain::thread_cpu())));
            self.budget.stopped.take();
        }
        let result = f();
        if !outer {
            return result.map_err(|error| error.to_string());
        }
        self.budget.armed.set(None);
        match self.budget.stopped.take() {
            Some(stopped) => Err(stopped),
            None => result.map_err(|error| error.to_string()),
        }
    }

    /// The bytes the VM's heap holds.
    pub(crate) fn memory(&self) -> usize {
        self.lua.used_memory()
    }
}

/// The plugin's `require`: `@opencode/plugin`, which the host registers, or a module of the plugin by `./name` or
/// `@self/name` from its root. Anything else is an error; nothing is read from the disk after load.
fn require(lua: &Lua, compiled: &Rc<Compiled>) -> mlua::Result<Function> {
    let compiled = compiled.clone();
    let loaded = lua.create_table()?;
    lua.create_function(move |lua, name: String| {
        if let Some(module) = loaded.raw_get::<Option<Value>>(name.as_str())? {
            return Ok(module);
        }
        // What the host registered (`Lua::register_module` keeps the names in lower case).
        let registered: Option<Table> = lua.named_registry_value("_REGISTEREDMODULES")?;
        let module = registered.map(|known| known.raw_get::<Option<Value>>(name.to_ascii_lowercase())).transpose()?;
        if let Some(module) = module.flatten() {
            return Ok(module);
        }
        let Some(path) = name.strip_prefix("./").or_else(|| name.strip_prefix("@self/")) else {
            return Err(mlua::Error::runtime(format!(
                "require({name:?}): a plugin requires @opencode/plugin, or its own modules as ./name or @self/name"
            )));
        };
        if path.split('/').any(|part| part.is_empty() || part == "." || part == "..") {
            return Err(mlua::Error::runtime(format!("require({name:?}): no module outside the plugin")));
        }
        // Marked while it loads, so a cycle is an error and not a stack overflow.
        loaded.raw_set(name.as_str(), false)?;
        let module = load(lua, &compiled, path)?.call::<Value>(());
        let module = match module {
            Ok(Value::Nil) => Value::Boolean(true),
            Ok(module) => module,
            Err(error) => {
                loaded.raw_set(name.as_str(), Value::Nil)?;
                return Err(error);
            }
        };
        loaded.raw_set(name.as_str(), &module)?;
        Ok(module)
    })
}

/// The function of module `name`'s bytecode.
fn load(lua: &Lua, compiled: &Compiled, name: &str) -> mlua::Result<Function> {
    let (key, code) =
        compiled.module(name).ok_or_else(|| mlua::Error::runtime(format!("the plugin has no module {name}.luau")))?;
    lua.load(code).set_name(format!("@{key}.luau")).set_mode(ChunkMode::Binary).into_function()
}
