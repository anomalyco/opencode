//! What a Luau plugin reaches: `setup`, `read` and `host`, bound onto the linked path's `abi::Setup`, `abi::Read` and
//! `abi::Host` (`steps/luau-spike.md` 1.2). Tables cross as the contract's own types, through serde, with no JSON
//! text. A Luau error in any call fails the plugin as a panic of a built-in does: none of the call's effects apply.

use std::rc::{Rc, Weak};
use std::time::Duration;

use mlua::{Function, Lua, LuaSerdeExt, MultiValue, Table, Value};
use opencode_plugin_abi::interact::{self, Handled};
use opencode_plugin_abi::{self as abi, v2};
use serde::Serialize;
use serde::de::DeserializeOwned;

use super::current::{Current, Enter, Slot};
use super::vm::{Compiled, Vm};

/// A plugin activation: its VM, what its calls reach, and the objects every call is handed.
pub(crate) struct Plugin {
    pub(crate) vm: Vm,
    current: Rc<Slot>,
    read: Table,
    host: Table,
    memo: Function,
}

/// The module `@opencode/plugin`: `plugin.define` and the node helpers, in Luau.
const MODULE: &str = include_str!("plugin.luau");

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
    let module: Table = vm.lua.load(MODULE).set_name("=@opencode/plugin").call(()).map_err(error)?;
    vm.lua.register_module("@opencode/plugin", &module).map_err(error)?;
    let plugin = Rc::new(Plugin { vm, current, read, host, memo });
    let defined = {
        let _enter = Enter::new(&plugin.current, Current::setting_up(setup));
        plugin.vm.start(compiled)?
    };
    let run = match &defined {
        Value::Table(defined) => defined.raw_get::<Option<Function>>("__opencode_setup").map_err(error)?,
        _ => None,
    };
    let run = run.ok_or("init.luau must return plugin.define(function(setup) ... end)")?;
    let object = setup_object(&plugin, setup.id(), options).map_err(error)?;
    let _enter = Enter::new(&plugin.current, Current::setting_up(setup));
    plugin.vm.call(|| run.call::<()>(object))?;
    Ok(plugin.clone())
}

impl Plugin {
    /// Calls `f`, one call of the plugin, with `current` reachable from its `read` and `host`; a failure unwinds to the
    /// host's catch, which fails the plugin.
    fn run<R>(&self, current: Current, f: impl FnOnce(&Lua) -> mlua::Result<R>) -> R {
        let _enter = Enter::new(&self.current, current);
        self.vm.call(|| f(&self.vm.lua)).unwrap_or_else(|error| fail(error))
    }
}

/// Fails the running call of the plugin: the host's catch stops the unwind and fails the plugin with `error`, as for a
/// panic, with no panic hook printing over the TUI.
fn fail(error: String) -> ! {
    std::panic::resume_unwind(Box::new(error))
}

/// A value of the contract as a Luau value: `None` is `nil`, a sequence a plain table.
pub(crate) fn out<T: Serialize + ?Sized>(lua: &Lua, value: &T) -> mlua::Result<Value> {
    let options = mlua::serde::ser::Options::new()
        .serialize_none_to_null(false)
        .serialize_unit_to_null(false)
        .set_array_metatable(false);
    lua.to_value_with(value, options)
}

/// A Luau value as a value of the contract.
fn input<T: DeserializeOwned>(lua: &Lua, value: Value) -> mlua::Result<T> {
    lua.from_value(value)
}

/// A Luau value as a value of the contract whose fields the table leaves out are its defaults' (a command needs only
/// its `name`).
fn defaulted<T: Default + Serialize + DeserializeOwned>(lua: &Lua, value: Value) -> mlua::Result<T> {
    let error = |error: serde_json::Error| mlua::Error::runtime(error.to_string());
    let mut whole = serde_json::to_value(T::default()).map_err(error)?;
    if let (Some(whole), serde_json::Value::Object(given)) = (whole.as_object_mut(), input(lua, value)?) {
        whole.extend(given);
    }
    serde_json::from_value(whole).map_err(error)
}

/// `nil`, or what `value` decodes to.
fn optional<T: DeserializeOwned>(lua: &Lua, value: Value) -> mlua::Result<Option<T>> {
    match value {
        Value::Nil => Ok(None),
        value => input(lua, value).map(Some),
    }
}

type Register = fn(&Rc<Plugin>, &mut abi::Setup<'_>, &Lua, MultiValue) -> mlua::Result<()>;

/// The `setup` object: its registrations, which take effect only while setup runs.
fn setup_object(plugin: &Rc<Plugin>, id: &str, options: Option<&str>) -> mlua::Result<Table> {
    let lua = &plugin.vm.lua;
    let object = lua.create_table()?;
    object.raw_set("id", id)?;
    // The `options` of the plugin's `plugins` entry, decoded: Luau has no JSON reader of its own.
    let options = options.map(serde_json::from_str::<serde_json::Value>).transpose();
    let options = options.map_err(|error| mlua::Error::runtime(format!("the plugin's options: {error}")))?;
    object.raw_set("options", out(lua, &options)?)?;
    object.raw_set("host", plugin.host.clone())?;
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
            plugin.run(Current::acting(host), |_| run.call::<()>((plugin.host.clone(), input)));
        });
        Ok(())
    })?;
    register("slot", |plugin, setup, lua, args| {
        let (at, render): (Value, Function) = lua.unpack_multi(args)?;
        let at: Placement = input(lua, at)?;
        let plugin = plugin.clone();
        setup.slot(abi::Placement::new(at.kind, at.path), move |read, slot, changed| {
            plugin.run(Current::reading(read), |lua| {
                let value = render.call::<Value>((plugin.read.clone(), out(lua, slot)?, out(lua, changed)?))?;
                Ok(optional(lua, value)?.unwrap_or(abi::Render::Hide))
            })
        });
        Ok(())
    })?;
    register("route", |plugin, setup, lua, args| {
        let (name, render): (String, Function) = lua.unpack_multi(args)?;
        let plugin = plugin.clone();
        setup.route(&name, move |read, changed| {
            plugin.run(Current::reading(read), |lua| {
                let value = render.call::<Value>((plugin.read.clone(), out(lua, changed)?))?;
                Ok(optional(lua, value)?.unwrap_or(abi::Render::Hide))
            })
        });
        Ok(())
    })?;
    register("onRouteMount", |plugin, setup, lua, args| {
        let (name, run): (String, Function) = lua.unpack_multi(args)?;
        let plugin = plugin.clone();
        setup.on_route_mount(&name, move |host, mounted| {
            plugin.run(Current::acting(host), |_| run.call::<()>((plugin.host.clone(), mounted)));
        });
        Ok(())
    })?;
    register("codeBlock", |plugin, setup, lua, args| {
        let (language, render): (String, Function) = lua.unpack_multi(args)?;
        let plugin = plugin.clone();
        setup.code_block(&language, move |read, fence| {
            plugin.run(Current::reading(read), |lua| {
                let value = render.call::<Value>((plugin.read.clone(), out(lua, fence)?))?;
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
            plugin.run(Current::acting(host), |lua| run.call::<()>((plugin.host.clone(), out(lua, event)?)));
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
                run.call::<()>((plugin.host.clone(), id.0, value, error))
            });
        });
        Ok(())
    })?;
    register("onDispose", |plugin, setup, lua, args| {
        let run: Function = lua.unpack_multi(args)?;
        let plugin = plugin.clone();
        setup.on_dispose(move |host| {
            plugin.run(Current::acting(host), |_| run.call::<()>(plugin.host.clone()));
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
        let object = lua.create_table()?;
        object.raw_set("read", plugin.read.clone())?;
        object.raw_set("input", out(lua, surface_input)?)?;
        object.raw_set("memo", plugin.memo.clone())?;
        let node = view.call::<Value>(object)?;
        input(lua, node)
    })
}

/// A handler of input: `nil` passes the event on.
fn handle(plugin: &Rc<Plugin>, handler: &Function, host: &dyn abi::Host, event: &interact::Event) -> Handled {
    plugin.run(Current::acting(host), |lua| {
        let value = handler.call::<Value>((plugin.host.clone(), out(lua, event)?))?;
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
    // A read, on both objects.
    macro_rules! reads {
        ($($name:literal => |$r:ident, $lua:ident $(, $arg:ident: $ty:ty)*| $body:expr;)*) => {$({
            let current = current.clone();
            let f = lua.create_function(move |$lua, (_this, $($arg,)*): (Value, $($ty,)*)| {
                let now = current.get();
                let $r = now.read()?;
                let value = $body;
                out($lua, &value)
            })?;
            read.raw_set($name, f.clone())?;
            host.raw_set($name, f)?;
        })*};
    }
    // An effect, on `host` only.
    macro_rules! verbs {
        ($($name:literal => |$h:ident, $lua:ident $(, $arg:ident: $ty:ty)*| $body:expr;)*) => {$({
            let current = current.clone();
            let f = lua.create_function(move |$lua, (_this, $($arg,)*): (Value, $($ty,)*)| {
                let now = current.get();
                let $h = now.host()?;
                let value = $body;
                out($lua, &value)
            })?;
            host.raw_set($name, f)?;
        })*};
    }
    reads! {
        "themeMode" => |r, _lua| match r.theme_mode() { abi::ThemeMode::Dark => "dark", abi::ThemeMode::Light => "light" };
        "color" => |r, _lua, token: String| r.color(&token);
        "storageGet" => |r, _lua, key: String| r.storage_get(&key);
        "session" => |r, _lua, id: String| r.session(&id);
        "sessions" => |r, _lua| r.sessions();
        "family" => |r, _lua, id: String| r.family(&id);
        "messages" => |r, lua, id: String| {
            let mut list = Value::Nil;
            let mut failed = None;
            r.messages(&id, &mut |messages| match out(lua, messages) {
                Ok(value) => list = value,
                Err(error) => failed = Some(error),
            });
            if let Some(error) = failed {
                return Err(error);
            }
            list
        };
        "model" => |r, _lua| r.model();
        "info" => |r, _lua| r.info();
        "route" => |r, _lua| r.route();
        "interactive" => |r, _lua| r.interactive();
        "shortcut" => |r, _lua, name: String| r.shortcut(&name);
        "dialogOpen" => |r, _lua, key: String| r.dialog_open(&key);
        "composer" => |r, _lua| r.composer();
        "tabs" => |r, _lua| r.tabs();
        "theme" => |r, _lua| r.theme();
        "themes" => |r, _lua| r.themes();
        "selection" => |r, _lua| r.selection();
        "rect" => |r, _lua, id: String| r.rect(&id);
        "focused" => |r, _lua| r.focused();
        "mode" => |r, _lua| r.mode();
        "mount" => |r, _lua| r.mount();
        "setting" => |r, _lua, name: String| r.setting(&name);
        "plugins" => |r, _lua| r.plugins();
    }
    verbs! {
        "storageSet" => |h, lua, key: String, value: Value| h.storage_set(&key, input(lua, value)?);
        "storageMerge" => |h, lua, key: String, fields: Value| h.storage_merge(&key, input(lua, fields)?);
        "dispatch" => |h, _lua, name: String, value: Option<String>| h.dispatch(&name, value.as_deref());
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
    // A request that gets an ID answers `id, nil`, or `nil, why` when the host does not take it.
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
    let memo = {
        let current = current.clone();
        lua.create_function(move |lua, (this, key, value, build): (Value, String, Value, Function)| {
            let value: serde_json::Value = input(lua, value)?;
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
