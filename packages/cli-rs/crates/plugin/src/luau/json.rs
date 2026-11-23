//! Contract values into Luau: a value becomes JSON with `serde_json::to_value` (unless it is JSON already), then Luau
//! tables built on the VM's stack. The other way is [`super::decode`].
//!
//! A table built from a JSON array carries the array marker, and one built from an object the object marker: the
//! metatables [`ARRAY`] and [`OBJECT`] name in the registry, which `plugin.json.isArray` reads and
//! `plugin.json.array` and `plugin.json.object` set. Only an empty table needs one to cross back as what it was: the
//! decoder takes an empty table as an array unless it carries the object marker.

#![allow(unsafe_code)]

use std::ffi::CStr;
use std::os::raw::c_int;

use mlua::{Lua, Table, Value, ffi};

/// Where the registry keeps the array marker, a frozen metatable `{ __json = "array" }`.
pub(crate) const ARRAY: &CStr = c"opencode.json.array";

/// Where the registry keeps the object marker, a frozen metatable `{ __json = "object" }`.
pub(crate) const OBJECT: &CStr = c"opencode.json.object";

/// The field of a marker that names what it marks.
pub(crate) const MARK: &CStr = c"__json";

/// How a JSON `null` becomes Luau.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Nulls {
    /// As the carrier hands values over: a `null` field is left out, a `null` item is mlua's `null`, so items keep
    /// their places.
    Carrier,
    /// Mlua's `null` everywhere (`plugin.json.null`), for a plugin that tells a field that is `null` from one that is
    /// missing.
    Sentinel,
}

/// Makes the two markers and puts them in the registry; returns them, array first.
pub(crate) fn markers(lua: &Lua) -> mlua::Result<(Table, Table)> {
    let marker = |name: &CStr, kind: &str| {
        let table = lua.create_table()?;
        table.raw_set(MARK.to_str().unwrap_or_default(), kind)?;
        table.set_readonly(true);
        lua.set_named_registry_value(name.to_str().unwrap_or_default(), &table)?;
        Ok::<_, mlua::Error>(table)
    };
    Ok((marker(ARRAY, "array")?, marker(OBJECT, "object")?))
}

/// `value` as a Luau value: an object a table of its fields (a `null` field left out), an array a sequence, `null` in
/// it mlua's `null`. A table is built in one protected call on the VM's stack, each table sized for what it holds.
pub(crate) fn luau(lua: &Lua, value: &serde_json::Value) -> mlua::Result<Value> {
    luau_with(lua, value, Nulls::Carrier)
}

/// [`luau`], with `null` as `nulls` says.
pub(crate) fn luau_with(lua: &Lua, value: &serde_json::Value, nulls: Nulls) -> mlua::Result<Value> {
    Ok(match value {
        serde_json::Value::Null if nulls == Nulls::Sentinel => {
            Value::LightUserData(mlua::LightUserData(std::ptr::null_mut()))
        }
        serde_json::Value::Null => Value::Nil,
        serde_json::Value::Bool(value) => Value::Boolean(*value),
        serde_json::Value::Number(number) => Value::Number(number.as_f64().unwrap_or_default()),
        serde_json::Value::String(text) => Value::String(lua.create_string(text)?),
        // SAFETY: `exec_raw` runs the closure in protected mode with room for three slots, two of which take the
        // markers; the keys' slots are checked for, and `push` checks for room for each table deeper. What it leaves
        // on the stack is the value returned: the markers' and the keys' slots are dropped. It holds no Rust value that
        // needs dropping across a call that can raise.
        tree => unsafe {
            lua.exec_raw::<Value>((), |state| {
                let base = ffi::lua_gettop(state);
                let marks =
                    [ARRAY, OBJECT].map(|name| ffi::lua_rawgetfield(state, ffi::LUA_REGISTRYINDEX, name.as_ptr()));
                // A VM the carrier did not set up has no markers: its tables go unmarked.
                let marks = (marks == [ffi::LUA_TTABLE; 2]).then_some((base + 1, base + 2));
                ffi::luaL_checkstack(state, KEYS as c_int, c"a value nested too deep".as_ptr());
                ffi::lua_settop(state, base + 2 + KEYS as c_int);
                let mut keys = Keys { first: base + 3, names: [""; KEYS], len: 0, next: 0 };
                push(state, tree, Build { marks, nulls }, &mut keys);
                ffi::lua_replace(state, base + 1);
                ffi::lua_settop(state, base + 1);
            })?
        },
    })
}

/// How [`push`] builds: the stack slots of the markers, array then object, and what a `null` becomes.
#[derive(Clone, Copy)]
struct Build {
    marks: Option<(c_int, c_int)>,
    nulls: Nulls,
}

/// The most keys one conversion keeps ([`Keys`]).
const KEYS: usize = 32;

/// The object keys of one conversion, each made a Luau string once. The records of a page repeat their keys in the same
/// order, so the key asked for is most often the one after the last found. Key `i` of `names` is kept in stack slot
/// `first + i`, which keeps it alive while the conversion runs.
struct Keys<'a> {
    first: c_int,
    names: [&'a str; KEYS],
    len: usize,
    next: usize,
}

impl<'a> Keys<'a> {
    /// Pushes `name`: the kept string when there is one, else a new one, kept while there is room.
    ///
    /// # Safety
    /// In a protected call, with room for two slots, the [`KEYS`] slots from `first` the keys'.
    unsafe fn push(&mut self, state: *mut ffi::lua_State, name: &'a str) {
        let kept = &self.names[..self.len];
        // The next key, else a scan while there is room to keep more: once full, a miss is a new string.
        let found = match kept.get(self.next) == Some(&name) {
            true => Some(self.next),
            false if self.len < KEYS => kept.iter().position(|known| *known == name),
            false => None,
        };
        // SAFETY: as the caller's.
        unsafe {
            if let Some(at) = found {
                ffi::lua_pushvalue(state, self.first + at as c_int);
                self.next = at + 1;
                return;
            }
            ffi::lua_pushlstring_(state, name.as_ptr().cast(), name.len());
            if self.len < KEYS {
                ffi::lua_pushvalue(state, -1);
                ffi::lua_replace(state, self.first + self.len as c_int);
                self.names[self.len] = name;
                self.len += 1;
                self.next = self.len;
            }
        }
    }
}

/// Pushes `value` onto the stack of `state`, a top-level `null` as `nil`.
///
/// # Safety
/// In a protected call, with room for three slots, `build`'s marker slots and `keys`' slots valid.
unsafe fn push<'a>(state: *mut ffi::lua_State, value: &'a serde_json::Value, build: Build, keys: &mut Keys<'a>) {
    let size = |count: usize| c_int::try_from(count).unwrap_or(0);
    // SAFETY: `state` is in a protected call with room for three slots (the caller's promise); this pushes one.
    let null = || unsafe { ffi::lua_pushlightuserdata(state, std::ptr::null_mut()) };
    // SAFETY: as the caller's; a table checks for room for its key, its value and what the value needs to be built.
    unsafe {
        match value {
            serde_json::Value::Null => ffi::lua_pushnil(state),
            serde_json::Value::Bool(value) => ffi::lua_pushboolean(state, c_int::from(*value)),
            serde_json::Value::Number(number) => ffi::lua_pushnumber(state, number.as_f64().unwrap_or_default()),
            serde_json::Value::String(text) => ffi::lua_pushlstring_(state, text.as_ptr().cast(), text.len()),
            serde_json::Value::Array(items) => {
                ffi::luaL_checkstack(state, 3, c"a value nested too deep".as_ptr());
                ffi::lua_createtable(state, size(items.len()), 0);
                for (index, item) in items.iter().enumerate() {
                    match item {
                        serde_json::Value::Null => null(),
                        item => push(state, item, build, keys),
                    }
                    ffi::lua_rawseti_(state, -2, c_int::try_from(index + 1).unwrap_or(c_int::MAX));
                }
                if let Some((array, _)) = build.marks {
                    ffi::lua_pushvalue(state, array);
                    ffi::lua_setmetatable(state, -2);
                }
            }
            serde_json::Value::Object(fields) => {
                ffi::luaL_checkstack(state, 3, c"a value nested too deep".as_ptr());
                ffi::lua_createtable(state, 0, size(fields.len()));
                for (name, field) in fields {
                    match (field, build.nulls) {
                        (serde_json::Value::Null, Nulls::Carrier) => continue,
                        (serde_json::Value::Null, Nulls::Sentinel) => {
                            keys.push(state, name);
                            null();
                        }
                        (field, _) => {
                            keys.push(state, name);
                            push(state, field, build, keys);
                        }
                    }
                    ffi::lua_rawset(state, -3);
                }
                if let Some((_, object)) = build.marks {
                    ffi::lua_pushvalue(state, object);
                    ffi::lua_setmetatable(state, -2);
                }
            }
        }
    }
}

/// How many parts `value` holds, as the decoder charges them: each value one, each array and object one.
pub(crate) fn parts(value: &serde_json::Value) -> u64 {
    match value {
        serde_json::Value::Array(items) => 1 + items.iter().map(parts).sum::<u64>(),
        serde_json::Value::Object(fields) => 1 + fields.values().map(parts).sum::<u64>(),
        _ => 1,
    }
}
