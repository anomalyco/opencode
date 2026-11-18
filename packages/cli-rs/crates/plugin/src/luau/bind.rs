//! Binds Luau setup, reads and effects to the linked SDK. A Luau error fails the call and discards its effects.

use std::any::Any;
use std::cell::RefCell;
use std::rc::{Rc, Weak};
use std::sync::OnceLock;
use std::time::Duration;

use mlua::chunk::Compiler;
use mlua::{Function, Lua, MultiValue, Table, Value};
use opencode_plugin_abi::interact::{self, Handled};
use opencode_plugin_abi::{self as abi, v2};
use serde::Serialize;
use serde::de::DeserializeOwned;

use super::current::{Current, Enter, Slot};
use super::inputs::Inputs;
use super::vm::{self, Compiled, Vm};
use super::{decode, json};

/// A plugin activation: its VM, what its calls reach, and the objects every call is handed.
pub(crate) struct Plugin {
    /// Its VM, until a call fails: a failed plugin is called no more, so its heap goes at once, not at its unload.
    pub(crate) vm: RefCell<Option<Vm>>,
    current: Rc<Slot>,
    read: Table,
    host: Table,
    memo: Function,
    /// The tables its calls' inputs are handed in ([`Inputs`]).
    inputs: Rc<Inputs>,
}

/// The module `@opencode/plugin`: `plugin.define` and the node helpers, in Luau.
const MODULE: &str = include_str!("plugin.luau");

/// [`MODULE`] compiled once a process, as `Lua::load` compiles a source (optimization and debug level 1): each VM
/// loads the host's own bytecode.
fn prelude() -> Result<&'static [u8], String> {
    static PRELUDE: OnceLock<Result<Vec<u8>, String>> = OnceLock::new();
    let compiled = PRELUDE.get_or_init(|| Compiler::new().compile(MODULE).map_err(|error| error.to_string()));
    compiled.as_deref().map_err(Clone::clone)
}

/// The prelude's chunk in the VM `lua`, loaded lazily (`luau_loadlazy`): each of its functions is built from the
/// bytecode at its first call, so a VM holds only the helpers its plugin has run. The bytecode is the process's
/// ([`prelude`]), so it outlives every VM that loads it, and there is no owner to release.
fn load_prelude(lua: &Lua) -> Result<Function, String> {
    let code = prelude()?;
    // SAFETY: `exec_raw` runs the closure in protected mode with room for three slots; `luau_loadlazy` pushes one value,
    // the chunk or why it did not load, and raises nothing. `code` is a static, which the lazy functions read later.
    #[allow(unsafe_code)]
    let loaded = unsafe {
        lua.exec_raw::<Value>((), |state| {
            let name = c"=@opencode/plugin".as_ptr();
            mlua::ffi::luau_loadlazy(state, name, code.as_ptr().cast(), code.len(), 0, std::ptr::null_mut(), None);
        })
    };
    match loaded.map_err(|error| error.to_string())? {
        Value::Function(chunk) => Ok(chunk),
        Value::String(why) => Err(format!("the prelude did not load: {}", why.to_string_lossy())),
        other => Err(format!("the prelude did not load: {other:?}")),
    }
}

/// Runs a Luau plugin's setup on `setup`: a new VM whose entry module returns `plugin.define(fn)`, then `fn(setup)`.
/// The returned plugin lives as long as its registrations hold it.
pub(crate) fn setup(
    compiled: &Rc<Compiled>,
    setup: &mut abi::Setup<'_>,
    limit: Duration,
    memory: usize,
    options: Option<&str>,
) -> Result<Rc<Plugin>, String> {
    let error = |error: mlua::Error| error.to_string();
    let vm = Vm::new(compiled, limit, memory).map_err(error)?;
    let current = Rc::new(Slot::default());
    let (read, host, memo) = objects(&vm.lua, &current).map_err(error)?;
    let prelude = load_prelude(&vm.lua)?;
    // What fails a call whose task ran out of memory, or whose error is huge: the latch the call ends with
    // ([`vm::refuse`]), as raising an error in Luau would need memory the heap no longer has. `frames` is the task's
    // traceback (`"\nstack traceback:\n..."`), which the host joins to the message on its own heap.
    let fail = vm
        .lua
        .create_function(|lua, (message, frames): (mlua::LuaString, Option<mlua::LuaString>)| -> mlua::Result<()> {
            let message = message.to_string_lossy();
            let frames = frames.map(|frames| frames.to_string_lossy()).unwrap_or_default();
            vm::refuse(lua, &format!("{message}{frames}"));
            Err(mlua::Error::runtime(message))
        })
        .map_err(error)?;
    let native = natives(&vm.lua).map_err(error)?;
    let module: Table = prelude.call((fail, native)).map_err(error)?;
    vm.lua.register_module("@opencode/plugin", &module).map_err(error)?;
    let lua = vm.lua.clone();
    let inputs = Inputs::new(&lua).map_err(error)?;
    let plugin = Rc::new(Plugin { vm: RefCell::new(Some(vm)), current, read, host, memo, inputs });
    let started = |f: &mut dyn FnMut(&Vm) -> Result<Value, String>| match &*plugin.vm.borrow() {
        Some(vm) => f(vm),
        None => Err("the plugin has ended".to_owned()),
    };
    let defined = {
        let _enter = Enter::new(&plugin.current, Current::setting_up(setup));
        started(&mut |vm| vm.start(compiled))?
    };
    let run = match &defined {
        Value::Table(defined) => defined.raw_get::<Option<Function>>("__opencode_setup").map_err(error)?,
        _ => None,
    };
    let run = run.ok_or("init.luau must return plugin.define(function(setup) ... end)")?;
    let object = setup_object(&plugin, &lua, setup.id(), options).map_err(error)?;
    let _enter = Enter::new(&plugin.current, Current::setting_up(setup));
    started(&mut |vm| vm.call(|| run.call::<()>(object.clone())).map(|()| Value::Nil))?;
    Ok(plugin.clone())
}

impl Plugin {
    /// Calls `f`, one call of the plugin, with `current` reachable from its `read` and `host`; a failure unwinds to the
    /// host's catch, which fails the plugin, once the VM is let go.
    fn run<R>(&self, current: Current, f: impl FnOnce(&Lua) -> mlua::Result<R>) -> R {
        let called = {
            let _enter = Enter::new(&self.current, current);
            match &*self.vm.borrow() {
                Some(vm) => vm.call(|| f(&vm.lua)),
                None => Err("the plugin has ended".to_owned()),
            }
        };
        called.unwrap_or_else(|error| {
            self.vm.borrow_mut().take();
            fail(error)
        })
    }
}

/// Fails the running call of the plugin: the host's catch stops the unwind and fails the plugin with `error`, as for a
/// panic, with no panic hook printing over the TUI.
fn fail(error: String) -> ! {
    std::panic::resume_unwind(Box::new(error))
}

/// A value of the contract as a Luau value: `None` is `nil`, a sequence a plain table ([`json::luau`]). A value that is
/// JSON already (a reply, the messages read) is not copied first.
pub(crate) fn out<T: Serialize + Any>(lua: &Lua, value: &T) -> mlua::Result<Value> {
    if let Some(value) = (value as &dyn Any).downcast_ref::<serde_json::Value>() {
        return json::luau(lua, value);
    }
    let value = serde_json::to_value(value).map_err(|error| mlua::Error::runtime(error.to_string()))?;
    json::luau(lua, &value)
}

/// What the prelude's `plugin.json` is built on: `decode(text, nulls)`, `encode(value)`, `null`, and the array and object
/// markers ([`json::markers`]).
fn natives(lua: &Lua) -> mlua::Result<Table> {
    let (array, object) = json::markers(lua)?;
    let native = lua.create_table()?;
    native.raw_set("array", array)?;
    native.raw_set("object", object)?;
    native.raw_set("null", Value::LightUserData(mlua::LightUserData(std::ptr::null_mut())))?;
    // `value, nil`, or `nil, why` for a text that is not JSON or is past the bounds a value from a plugin is held to:
    // its bytes, its depth (serde_json's 128) and its parts, checked before a table is built.
    let decode = lua.create_function(|lua, (text, nulls): (mlua::LuaString, bool)| {
        let limits = crate::limits::get();
        let text = text.as_bytes();
        if text.len() as u64 > limits.plugin_content {
            return Ok((Value::Nil, Some(format!("its text is more than {} bytes", limits.plugin_content))));
        }
        let value = match serde_json::from_slice::<serde_json::Value>(&text) {
            Ok(value) => value,
            Err(error) => return Ok((Value::Nil, Some(error.to_string()))),
        };
        let most = decode::VALUES_A_NODE * limits.nodes;
        if json::parts(&value) > most {
            return Ok((Value::Nil, Some(format!("it holds more than {most} parts"))));
        }
        let nulls = if nulls { json::Nulls::Sentinel } else { json::Nulls::Carrier };
        Ok((json::luau_with(lua, &value, nulls)?, None))
    })?;
    native.raw_set("decode", decode)?;
    // The text of `value`, read as any value a plugin hands the host is ([`read`]): a bound it passes fails the call.
    let encode = lua.create_function(|lua, value: Value| {
        let value: serde_json::Value = read(lua, &value)?;
        serde_json::to_string(&value).map_err(|error| mlua::Error::runtime(error.to_string()))
    })?;
    native.raw_set("encode", encode)?;
    Ok(native)
}

/// A Luau value as JSON ([`read`]).
fn json(lua: &Lua, value: &Value) -> mlua::Result<serde_json::Value> {
    read(lua, value)
}

/// A Luau value as a value of the contract, read off the VM's stack against bounds ([`decode::Decode`]): a value past
/// them is refused before more is made of it, and the refusal fails the call ([`vm::refuse`]).
fn read<T: DeserializeOwned + 'static>(lua: &Lua, value: &Value) -> mlua::Result<T> {
    match decode::Decode::new().decode(lua, value) {
        Ok(value) => Ok(value),
        Err(decode::Refused::Bound(reason)) => {
            let reason = format!("the plugin's value is refused: {reason}");
            vm::refuse(lua, &reason);
            Err(mlua::Error::runtime(reason))
        }
        Err(decode::Refused::Value(reason)) => Err(mlua::Error::runtime(reason)),
    }
}

/// A Luau table as a JSON object: an empty table, which is an empty array otherwise, is no fields.
fn object(lua: &Lua, value: &Value) -> mlua::Result<serde_json::Map<String, serde_json::Value>> {
    match json(lua, value)? {
        serde_json::Value::Object(fields) => Ok(fields),
        serde_json::Value::Array(items) if items.is_empty() => Ok(serde_json::Map::new()),
        _ => Err(mlua::Error::runtime("the fields to merge are a table of named fields")),
    }
}

/// A Luau value as a value of the contract ([`read`]).
fn input<T: DeserializeOwned + 'static>(lua: &Lua, value: Value) -> mlua::Result<T> {
    read(lua, &value)
}

/// A Luau value as a value of the contract whose fields the table leaves out are its defaults' (a command needs only
/// its `name`).
fn defaulted<T: Default + Serialize + DeserializeOwned>(lua: &Lua, value: Value) -> mlua::Result<T> {
    let error = |error: serde_json::Error| mlua::Error::runtime(error.to_string());
    let mut whole = serde_json::to_value(T::default()).map_err(error)?;
    if let (Some(whole), serde_json::Value::Object(given)) = (whole.as_object_mut(), json(lua, &value)?) {
        whole.extend(given);
    }
    serde_json::from_value(whole).map_err(error)
}

/// `nil`, or what `value` decodes to.
fn optional<T: DeserializeOwned + 'static>(lua: &Lua, value: Value) -> mlua::Result<Option<T>> {
    match value {
        Value::Nil => Ok(None),
        value => input(lua, value).map(Some),
    }
}

type Register = fn(&Rc<Plugin>, &mut abi::Setup<'_>, &Lua, MultiValue) -> mlua::Result<()>;

/// The `setup` object: its registrations, which take effect only while setup runs.
fn setup_object(plugin: &Rc<Plugin>, lua: &Lua, id: &str, options: Option<&str>) -> mlua::Result<Table> {
    let object = lua.create_table()?;
    object.raw_set("id", id)?;
    // The `options` of the plugin's `plugins` entry, decoded: Luau has no JSON reader of its own.
    let options = options.map(serde_json::from_str::<serde_json::Value>).transpose();
    let options = options.map_err(|error| mlua::Error::runtime(format!("the plugin's options: {error}")))?;
    object.raw_set("options", out(lua, &options)?)?;
    object.raw_set("host", &plugin.host)?;
    let weak = Rc::downgrade(plugin);
    let register = |name: &'static str, f: Register| {
        let weak: Weak<Plugin> = weak.clone();
        let method = lua.create_function(move |lua, mut args: MultiValue| {
            args.pop_front();
            let plugin = weak.upgrade().ok_or_else(|| mlua::Error::runtime("the plugin has ended"))?;
            let current = plugin.current.get();
            let setup = current
                .setup()
                .ok_or_else(|| mlua::Error::runtime(format!("setup:{name} registers only while setup runs")))?;
            f(&plugin, setup, lua, args)
        })?;
        object.raw_set(name, method)
    };
    register("storageKey", |_, setup, lua, args| {
        let key: String = lua.unpack_multi(args)?;
        setup.storage_key(&key);
        Ok(())
    })?;
    register("command", |plugin, setup, lua, args| {
        let (command, run): (Value, Function) = lua.unpack_multi(args)?;
        let command: abi::Command = defaulted(lua, command)?;
        let plugin = plugin.clone();
        setup.command(command, move |host, input| {
            plugin.run(Current::acting(host), |lua| {
                let value = run.call::<Value>((&plugin.host, input))?;
                // `"pass"` declines the key that ran it; the prelude's task gives nothing else.
                Ok(optional::<Handled>(lua, value)?.unwrap_or(Handled::Consume))
            })
        });
        Ok(())
    })?;
    register("slot", |plugin, setup, lua, args| {
        let (at, render): (Value, Function) = lua.unpack_multi(args)?;
        let at: Placement = input(lua, at)?;
        let plugin = plugin.clone();
        setup.slot(abi::Placement::new(at.kind, at.path), move |read, slot, changed| {
            plugin.run(Current::reading(read), |lua| {
                let value = plugin.inputs.lend(lua, |inputs| {
                    render.call::<Value>((&plugin.read, inputs.slot(slot)?, inputs.changed(lua, changed)?))
                })?;
                Ok(optional(lua, value)?.unwrap_or(abi::Render::Hide))
            })
        });
        Ok(())
    })?;
    register("onMount", |plugin, setup, lua, args| {
        let (at, run): (Value, Function) = lua.unpack_multi(args)?;
        let at: Placement = input(lua, at)?;
        let plugin = plugin.clone();
        setup.on_mount(abi::Placement::new(at.kind, at.path), move |host, slot, mounted| {
            plugin.run(Current::acting(host), |lua| {
                plugin.inputs.lend(lua, |inputs| run.call::<()>((&plugin.host, inputs.slot(slot)?, mounted)))
            });
        });
        Ok(())
    })?;
    register("route", |plugin, setup, lua, args| {
        let (name, render): (String, Function) = lua.unpack_multi(args)?;
        let plugin = plugin.clone();
        setup.route(&name, move |read, changed| {
            plugin.run(Current::reading(read), |lua| {
                let value = plugin
                    .inputs
                    .lend(lua, |inputs| render.call::<Value>((&plugin.read, inputs.changed(lua, changed)?)))?;
                Ok(optional(lua, value)?.unwrap_or(abi::Render::Hide))
            })
        });
        Ok(())
    })?;
    register("onRouteMount", |plugin, setup, lua, args| {
        let (name, run): (String, Function) = lua.unpack_multi(args)?;
        let plugin = plugin.clone();
        setup.on_route_mount(&name, move |host, mounted| {
            plugin.run(Current::acting(host), |_| run.call::<()>((&plugin.host, mounted)));
        });
        Ok(())
    })?;
    register("codeBlock", |plugin, setup, lua, args| {
        let (language, render): (String, Function) = lua.unpack_multi(args)?;
        let plugin = plugin.clone();
        setup.code_block(&language, move |read, fence| {
            plugin.run(Current::reading(read), |lua| {
                let value = render.call::<Value>((&plugin.read, out(lua, fence)?))?;
                Ok(optional(lua, value)?.unwrap_or(abi::Fenced::Code))
            })
        });
        Ok(())
    })?;
    register("onEvent", |plugin, setup, lua, args| {
        let (types, run): (Vec<String>, Function) = lua.unpack_multi(args)?;
        let plugin = plugin.clone();
        let types: Vec<&str> = types.iter().map(String::as_str).collect();
        setup.on_event(&types, move |host, event| {
            plugin.run(Current::acting(host), |lua| run.call::<()>((&plugin.host, out(lua, event)?)));
        });
        Ok(())
    })?;
    register("onReply", |plugin, setup, lua, args| {
        let run: Function = lua.unpack_multi(args)?;
        let plugin = plugin.clone();
        setup.on_reply(move |host, id, result| {
            plugin.run(Current::acting(host), |lua| {
                let (value, error) = match &result {
                    Ok(value) => (out(lua, value)?, None),
                    Err(error) => (Value::Nil, Some(error.as_str())),
                };
                run.call::<()>((&plugin.host, id.0, value, error))
            });
        });
        Ok(())
    })?;
    register("onCancelled", |plugin, setup, lua, args| {
        let run: Function = lua.unpack_multi(args)?;
        let plugin = plugin.clone();
        setup.on_cancelled(move |host, id| {
            plugin.run(Current::acting(host), |_| run.call::<()>((&plugin.host, id.0)));
        });
        Ok(())
    })?;
    register("onDispose", |plugin, setup, lua, args| {
        let run: Function = lua.unpack_multi(args)?;
        let plugin = plugin.clone();
        setup.on_dispose(move |host| {
            plugin.run(Current::acting(host), |_| run.call::<()>(&plugin.host));
        });
        Ok(())
    })?;
    register("layer", |plugin, setup, lua, args| {
        let (layer, handler): (Value, Function) = lua.unpack_multi(args)?;
        let layer: interact::Layer = input(lua, layer)?;
        let plugin = plugin.clone();
        setup.layer(layer, move |host, event| handle(&plugin, &handler, host, event));
        Ok(())
    })?;
    register("surface", |plugin, setup, lua, args| {
        let (spec, view, handler): (Value, Function, Option<Function>) = lua.unpack_multi(args)?;
        let spec: SurfaceSpec = input(lua, spec)?;
        let viewing = plugin.clone();
        let mut surface =
            v2::Surface::new(spec.name, (&spec.place).into(), move |surface| surface_view(&viewing, &view, surface))
                .layers(spec.layers);
        if spec.mounts {
            surface = surface.mounts();
        }
        if spec.palette {
            surface = surface.palette();
        }
        if let Some(handler) = handler {
            let plugin = plugin.clone();
            surface = surface.on(move |host, event| handle(&plugin, &handler, host, event));
        }
        setup.surface(surface);
        Ok(())
    })?;
    Ok(object)
}

/// A surface's view: `view(view)` with `view.read`, `view.input` and `view:memo(key, value, build)`.
fn surface_view(plugin: &Rc<Plugin>, view: &Function, surface: &mut v2::View<'_>) -> v2::Node {
    let surface_input = surface.input;
    plugin.run(Current::viewing(surface), |lua| {
        let node = plugin.inputs.lend(lua, |inputs| {
            let object = lua.create_table()?;
            object.raw_set("read", &plugin.read)?;
            object.raw_set("input", inputs.surface(lua, surface_input)?)?;
            object.raw_set("memo", plugin.memo.clone())?;
            view.call::<Value>(object)
        })?;
        input(lua, node)
    })
}

/// A handler of input: `nil` passes the event on.
fn handle(plugin: &Rc<Plugin>, handler: &Function, host: &dyn abi::Host, event: &interact::Event) -> Handled {
    plugin.run(Current::acting(host), |lua| {
        let value = handler.call::<Value>((&plugin.host, out(lua, event)?))?;
        Ok(optional(lua, value)?.unwrap_or(Handled::Pass))
    })
}

/// Where a slot claim goes: `{ path, kind }`, `kind` `append` when left out.
#[derive(serde::Deserialize)]
struct Placement {
    path: String,
    #[serde(default = "append")]
    kind: abi::SlotKind,
}

fn append() -> abi::SlotKind {
    abi::SlotKind::Append
}

/// A surface as `setup:surface` takes it: the manifest's `SurfaceClaim`, less what Luau cannot register yet (a canvas
/// draw, `layout`).
#[derive(serde::Deserialize)]
struct SurfaceSpec {
    name: String,
    place: abi::SurfacePlace,
    #[serde(default)]
    layers: Vec<interact::Layer>,
    #[serde(default)]
    mounts: bool,
    #[serde(default)]
    palette: bool,
}

/// The `read` and `host` objects of a VM, and `view:memo`. Each method reaches what the running call was given; outside
/// a call it is an error, and so is an effect of `host` during a render or a view.
fn objects(lua: &Lua, current: &Rc<Slot>) -> mlua::Result<(Table, Table, Function)> {
    let read = lua.create_table()?;
    let host = lua.create_table()?;
    lazy(lua, &read, current, false)?;
    lazy(lua, &host, current, true)?;
    // A request that gets an ID answers `id, nil`, or `nil, why` when the host does not take it. The prelude puts its
    // waiting `host:fetch` and `host:foreground` in their place, and keeps `setup:onReply` and `setup:onCancelled` to itself.
    for (name, foreground) in [("fetch", false), ("foreground", true)] {
        let current = current.clone();
        let f = lua.create_function(move |lua, (_this, request): (Value, Value)| {
            let now = current.get();
            let host = now.host()?;
            let asked = match foreground {
                false => host.try_fetch(input(lua, request)?),
                true => host.try_foreground(input(lua, request)?),
            };
            Ok(match asked {
                Ok(id) => (Some(id.0), None),
                Err(error) => (None, Some(error)),
            })
        })?;
        host.raw_set(name, f)?;
    }
    // `plugin.client`'s request: operation `name` with `input`, built from the operations table and sent as a fetch. It
    // answers `id, nil, reply` (how the reply reads: `data` is unwrapped by the prelude), or `nil, why`.
    {
        let current = current.clone();
        let f = lua.create_function(move |lua, (_this, name, request): (Value, String, Value)| {
            let built = super::client::request(&name, &json(lua, &request)?);
            let asked = built.and_then(|(fetch, reply)| {
                let now = current.get();
                let host = now.host().map_err(|error| error.to_string())?;
                host.try_fetch(fetch).map(|id| (id, reply))
            });
            Ok(match asked {
                Ok((id, reply)) => (Some(id.0), None, Some(reply.name())),
                Err(error) => (None, Some(error), None),
            })
        })?;
        host.raw_set("call", f)?;
    }
    // A timer of `ms` milliseconds, which the prelude's `plugin.sleep` waits on, as a fetch.
    let timer = {
        let current = current.clone();
        lua.create_function(move |_, (_this, ms): (Value, f64)| {
            // The time asked for, a part of a millisecond kept; one too long to wait (`math.huge`) never fires.
            let delay = match ms {
                ms if ms.is_nan() || ms <= 0.0 => std::time::Duration::ZERO,
                ms => std::time::Duration::try_from_secs_f64(ms / 1000.0).unwrap_or(std::time::Duration::MAX),
            };
            Ok(match current.get().host()?.try_timer(delay) {
                Ok(id) => (Some(id.0), None),
                Err(error) => (None, Some(error)),
            })
        })?
    };
    host.raw_set("timer", timer)?;
    // A task's owner, which the prelude keeps for the task and gives back as it goes on (`abi::Host::set_owner`). The
    // prelude takes both off `host`.
    let owner = {
        let current = current.clone();
        lua.create_function(move |lua, _this: Value| out(lua, &current.get().host()?.owner()))?
    };
    host.raw_set("owner", owner)?;
    let set_owner = {
        let current = current.clone();
        lua.create_function(move |lua, (_this, owner): (Value, Option<u64>)| {
            out(lua, &current.get().host()?.set_owner(owner))
        })?
    };
    host.raw_set("setOwner", set_owner)?;
    let memo = {
        let current = current.clone();
        lua.create_function(move |lua, (this, key, value, build): (Value, String, Value, Function)| {
            let value = json(lua, &value)?;
            let view = current.get().view().ok_or_else(|| mlua::Error::runtime("view:memo runs only in a view"))?;
            let mut failed = None;
            let node = view.memo(key, value, |inner| {
                let _enter = Enter::new(&current, Current::viewing(inner));
                match build.call::<Value>(this).and_then(|node| input(lua, node)) {
                    Ok(node) => node,
                    Err(error) => {
                        failed = Some(error);
                        v2::Node::column(Vec::new())
                    }
                }
            });
            match failed {
                Some(error) => Err(error),
                None => out(lua, &node),
            }
        })?
    };
    Ok((read, host, memo))
}

/// Gives `object` (`read`, or `host` when `host`) an `__index` that makes a binding at its first lookup and keeps it in
/// the object: a VM makes only the bindings its plugin uses, each an mlua function and its callback userdata. A key the
/// plugin cleared or set is its own, as before.
fn lazy(lua: &Lua, object: &Table, current: &Rc<Slot>, host: bool) -> mlua::Result<()> {
    let current = current.clone();
    let index = lua.create_function(move |lua, (object, name): (Table, Value)| {
        let Value::String(name) = name else { return Ok(None) };
        let Some(made) = binding(lua, &current, &name.to_str()?, host)? else { return Ok(None) };
        // A plugin may freeze the object: each lookup then makes the binding anew.
        if !object.is_readonly() {
            object.raw_set(name, &made)?;
        }
        Ok(Some(made))
    })?;
    let meta = lua.create_table()?;
    meta.raw_set("__index", index)?;
    object.set_metatable(Some(meta))
}

/// The binding `name` of `read`, or of `host` when `host`, made anew; `None` when the object has none. A read is on
/// both objects, an effect on `host` only.
fn binding(lua: &Lua, current: &Rc<Slot>, name: &str, host: bool) -> mlua::Result<Option<Function>> {
    macro_rules! reads {
        ($($name:literal => |$r:ident, $lua:ident $(, $arg:ident: $ty:ty)*| $body:expr;)*) => {$(
            if name == $name {
                let current = current.clone();
                return lua.create_function(move |$lua, (_this, $($arg,)*): (Value, $($ty,)*)| {
                    let now = current.get();
                    let $r = now.read()?;
                    let value = $body;
                    out($lua, &value)
                }).map(Some);
            }
        )*};
    }
    macro_rules! verbs {
        ($($name:literal => |$h:ident, $lua:ident $(, $arg:ident: $ty:ty)*| $body:expr;)*) => {$(
            if host && name == $name {
                let current = current.clone();
                return lua.create_function(move |$lua, (_this, $($arg,)*): (Value, $($ty,)*)| {
                    let now = current.get();
                    let $h = now.host()?;
                    let value = $body;
                    out($lua, &value)
                }).map(Some);
            }
        )*};
    }
    reads! {
        "themeMode" => |r, _lua| match r.theme_mode() { abi::ThemeMode::Dark => "dark", abi::ThemeMode::Light => "light" };
        "color" => |r, _lua, token: String| r.color(&token);
        "storageGet" => |r, _lua, key: String| r.storage_get(&key);
        "session" => |r, _lua, id: String| r.session(&id);
        "sessions" => |r, _lua| r.sessions();
        "family" => |r, _lua, id: String| r.family(&id);
        "messages" => |r, _lua, id: String| {
            let mut list = Ok(serde_json::Value::Null);
            r.messages(&id, &mut |messages| list = serde_json::to_value(messages));
            list.map_err(|error| mlua::Error::runtime(error.to_string()))?
        };
        "pending" => |r, _lua, id: String| r.pending(&id);
        "models" => |r, lua, location: Value| r.models(optional::<abi::LocationRef>(lua, location)?.as_ref());
        "providers" => |r, _lua| r.providers();
        "limits" => |r, _lua| r.limits();
        "model" => |r, _lua| r.model();
        "info" => |r, _lua| r.info();
        "route" => |r, _lua| r.route();
        "interactive" => |r, _lua| r.interactive();
        "shortcut" => |r, _lua, name: String| r.shortcut(&name);
        "dialogOpen" => |r, _lua, key: String| r.dialog_open(&key);
        "composer" => |r, _lua| r.composer();
        "tabs" => |r, _lua| r.tabs();
        "tabsEnabled" => |r, _lua| r.tabs_enabled();
        "theme" => |r, _lua| r.theme();
        "themes" => |r, _lua| r.themes();
        "selection" => |r, _lua| r.selection();
        "rect" => |r, _lua, id: String| r.rect(&id);
        "focused" => |r, _lua| r.focused();
        "mode" => |r, _lua| r.mode();
        "mount" => |r, _lua| r.mount();
        "setting" => |r, _lua, name: String| r.setting(&name);
        "plugins" => |r, _lua| r.plugins();
        // The host's version and optional features (`focus-input`, `fence-node`), for a plugin that falls back on a
        // host without one.
        "abi" => |r, _lua| {
            let abi = r.abi();
            serde_json::json!({ "major": abi.major, "minor": abi.minor, "features": abi.features })
        };
        "hasFeature" => |r, _lua, name: String| r.abi().has_feature(&name);
        // The facts no data of the server holds.
        "utcOffset" => |r, _lua, at: f64| r.utc_offset(at as i64);
        "measure" => |r, _lua, text: String| r.measure(&text);
    }
    verbs! {
        "storageSet" => |h, lua, key: String, value: Value| h.storage_set(&key, input(lua, value)?);
        "storageMerge" => |h, lua, key: String, fields: Value| h.storage_merge(&key, object(lua, &fields)?);
        "dispatch" => |h, _lua, name: String, value: Option<String>| h.dispatch(&name, value.as_deref());
        "setEnabled" => |h, _lua, name: String, enabled: bool| h.set_enabled(&name, enabled);
        "toast" => |h, lua, toast: Value| h.toast(input(lua, toast)?);
        "attention" => |h, lua, attention: Value| h.attention(input(lua, attention)?);
        "openRoute" => |h, _lua, name: String| h.open_route(&name);
        "navigate" => |h, lua, route: Value| h.navigate(input(lua, route)?);
        "dialog" => |h, lua, dialog: Value| h.dialog(input(lua, dialog)?);
        "copy" => |h, lua, text: String, then: Value| h.copy(&text, optional(lua, then)?);
        "editComposer" => |h, lua, edit: Value| h.edit_composer(input(lua, edit)?);
        "setTitle" => |h, _lua, title: String| h.set_title(&title);
        "setVariant" => |h, _lua, variant: Option<String>| h.set_variant(variant.as_deref());
        "setModel" => |h, _lua, provider: String, model: String| h.set_model(&provider, &model);
        "editTab" => |h, lua, edit: Value| h.edit_tab(input(lua, edit)?);
        "clearSelection" => |h, _lua| h.clear_selection();
        "setTheme" => |h, _lua, name: String| h.set_theme(&name);
        "setSetting" => |h, lua, name: String, value: Value| h.set_setting(&name, input(lua, value)?);
        "scroll" => |h, lua, target: Value, verb: Value| h.scroll(input(lua, target)?, input(lua, verb)?);
        "openPanel" => |h, lua, open: Value| h.open_panel(input(lua, open)?);
        "closePanel" => |h, _lua, surface: String| h.close_panel(&surface);
        "overlay" => |h, lua, overlay: Value| h.overlay(input(lua, overlay)?);
        "closeOverlay" => |h, _lua, surface: String| h.close_overlay(&surface);
        "focus" => |h, _lua, id: String| h.focus(&id);
        "blur" => |h, _lua| h.blur();
        "setMode" => |h, _lua, mode: Option<String>| h.set_mode(mode.as_deref());
        "releaseKeys" => |h, _lua| h.release_keys();
    }
    Ok(None)
}
