//! Contract values into Luau: a value becomes JSON with `serde_json::to_value` (unless it is JSON already), then Luau
//! tables built on the VM's stack. The other way is [`super::decode`].

#![allow(unsafe_code)]

use std::os::raw::c_int;

use mlua::{Lua, Value, ffi};

/// `value` as a Luau value: an object a table of its fields (a `null` field left out), an array a sequence, `null` in
/// it mlua's `null`. A table is built in one protected call on the VM's stack, each table sized for what it holds.
pub(crate) fn luau(lua: &Lua, value: &serde_json::Value) -> mlua::Result<Value> {
    Ok(match value {
        serde_json::Value::Null => Value::Nil,
        serde_json::Value::Bool(value) => Value::Boolean(*value),
        serde_json::Value::Number(number) => Value::Number(number.as_f64().unwrap_or_default()),
        serde_json::Value::String(text) => Value::String(lua.create_string(text)?),
        // SAFETY: `exec_raw` runs the closure in protected mode with room for three slots, which `push` checks for
        // each table deeper; what it leaves on the stack is the value returned. It holds no Rust value that needs
        // dropping across a call that can raise.
        tree => unsafe { lua.exec_raw::<Value>((), |state| push(state, tree))? },
    })
}

/// Pushes `value` onto the stack of `state`, `null` as `nil`.
///
/// # Safety
/// In a protected call, with room for three slots.
unsafe fn push(state: *mut ffi::lua_State, value: &serde_json::Value) {
    let size = |count: usize| c_int::try_from(count).unwrap_or(0);
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
                        serde_json::Value::Null => ffi::lua_pushlightuserdata(state, std::ptr::null_mut()),
                        item => push(state, item),
                    }
                    ffi::lua_rawseti_(state, -2, c_int::try_from(index + 1).unwrap_or(c_int::MAX));
                }
            }
            serde_json::Value::Object(fields) => {
                ffi::luaL_checkstack(state, 3, c"a value nested too deep".as_ptr());
                ffi::lua_createtable(state, 0, size(fields.len()));
                for (name, field) in fields.iter().filter(|(_, field)| !field.is_null()) {
                    ffi::lua_pushlstring_(state, name.as_ptr().cast(), name.len());
                    push(state, field);
                    ffi::lua_rawset(state, -3);
                }
            }
        }
    }
}
