//! Values between Luau and the contract through one `serde_json::Value` each way: a Luau value becomes JSON in one
//! bounded walk ([`Walk`]), then the contract's type with `serde_json::from_value`; a contract value becomes JSON with
//! `serde_json::to_value`, then Luau tables. No serde code is generated per type for mlua, as its own serde would.
//!
//! A Luau table is an array when its keys are exactly `1..n`, an object otherwise; an empty table is an empty array,
//! which serde also takes as a struct of defaults. A whole number is an integer, any other a float; `nil` in an array
//! and mlua's `null` are `null`. A function, a thread or userdata cannot cross.

#![allow(unsafe_code)]

use std::collections::HashSet;
use std::os::raw::c_int;

use mlua::{Lua, Value, ffi};
use serde_json::{Map, Number};

/// The parts (keys, values) a value may hold for each node a tree may hold ([`crate::limits::Limits::nodes`]).
const VALUES_A_NODE: u64 = 16;

/// How deep a value's tables may nest: past the layout depth ([`crate::reconcile::MAX_DEPTH`]) twice over, as a node's
/// children are a table in a table.
const DEPTH: usize = 2 * crate::reconcile::MAX_DEPTH as usize;

/// Why a value cannot cross: refused by a bound (`luau-1`, which fails the call) or not a value of the contract.
pub(crate) enum Refused {
    Bound(String),
    Value(String),
}

/// The walk of a Luau value into JSON, bounded as the host's limits are charged: the decoder that follows allocates on
/// the Rust heap, outside the VM's cap and with no safepoint of the budget's. Each table is taken once: a table reused
/// in one value (a DAG of shared tables) would be decoded once for each place it appears, exponentially more than the
/// VM holds.
pub(crate) struct Walk {
    values: u64,
    bytes: u64,
    most_values: u64,
    most_bytes: u64,
    seen: HashSet<*const std::ffi::c_void>,
}

impl Walk {
    pub(crate) fn new() -> Self {
        let limits = crate::limits::get();
        Self {
            values: 0,
            bytes: 0,
            most_values: VALUES_A_NODE * limits.nodes,
            most_bytes: limits.plugin_content,
            seen: HashSet::new(),
        }
    }

    /// `value` of the VM `lua` as JSON. A table is walked on the VM's stack, where reading a key, a value or a string
    /// makes no handle and allocates nothing in the VM.
    pub(crate) fn json(&mut self, lua: &Lua, value: &Value) -> Result<serde_json::Value, Refused> {
        let Value::Table(_) = value else { return self.scalar(value) };
        let mut walked = Err(Refused::Value("the table was not walked".to_owned()));
        // SAFETY: `exec_raw` pushes `value` and runs the closure in protected mode with it at the top; the walk only
        // reads the stack and pushes what `lua_rawiter` pushes, which it pops, and it raises no Lua error.
        let ran = unsafe { lua.exec_raw::<()>(value, |state| walked = self.raw(state, -1, 0)) };
        ran.map_err(|error| Refused::Value(error.to_string()))?;
        walked
    }

    /// A value that is not a table.
    fn scalar(&mut self, value: &Value) -> Result<serde_json::Value, Refused> {
        self.count()?;
        Ok(match value {
            Value::Nil => serde_json::Value::Null,
            Value::LightUserData(data) if data.0.is_null() => serde_json::Value::Null,
            Value::Boolean(value) => serde_json::Value::Bool(*value),
            Value::Integer(value) => serde_json::Value::Number((*value).into()),
            Value::Number(value) => number(*value)?,
            Value::String(text) => self.text(&text.as_bytes())?,
            other => return Err(Refused::Value(format!("a {} cannot cross to the host", other.type_name()))),
        })
    }

    fn count(&mut self) -> Result<(), Refused> {
        self.values += 1;
        if self.values > self.most_values {
            return Err(Refused::Bound(format!("it holds more than {} parts", self.most_values)));
        }
        Ok(())
    }

    fn text(&mut self, bytes: &[u8]) -> Result<serde_json::Value, Refused> {
        self.bytes += bytes.len() as u64;
        if self.bytes > self.most_bytes {
            return Err(Refused::Bound(format!("its text is more than {} bytes", self.most_bytes)));
        }
        match std::str::from_utf8(bytes) {
            Ok(text) => Ok(serde_json::Value::String(text.to_owned())),
            Err(_) => Err(Refused::Value("a string that is not UTF-8".to_owned())),
        }
    }

    /// The value at stack slot `index` of `state`.
    ///
    /// # Safety
    /// `index` is a valid slot of `state`, inside a protected call.
    unsafe fn raw(
        &mut self,
        state: *mut ffi::lua_State,
        index: c_int,
        depth: usize,
    ) -> Result<serde_json::Value, Refused> {
        // SAFETY: as the caller's.
        unsafe {
            let index = ffi::lua_absindex(state, index);
            match ffi::lua_type(state, index) {
                ffi::LUA_TTABLE => self.raw_table(state, index, depth),
                kind => {
                    self.count()?;
                    match kind {
                        ffi::LUA_TNIL => Ok(serde_json::Value::Null),
                        ffi::LUA_TBOOLEAN => Ok(serde_json::Value::Bool(ffi::lua_toboolean(state, index) != 0)),
                        ffi::LUA_TNUMBER => number(ffi::lua_tonumberx(state, index, std::ptr::null_mut())),
                        ffi::LUA_TSTRING => self.text(raw_bytes(state, index)),
                        ffi::LUA_TLIGHTUSERDATA if ffi::lua_touserdata(state, index).is_null() => {
                            Ok(serde_json::Value::Null)
                        }
                        _ => Err(Refused::Value(format!("a {} cannot cross to the host", type_name(kind)))),
                    }
                }
            }
        }
    }

    /// The table at absolute slot `index`: an array when its keys are `1..n`, an object otherwise.
    ///
    /// # Safety
    /// As for [`Walk::raw`], `index` absolute.
    unsafe fn raw_table(
        &mut self,
        state: *mut ffi::lua_State,
        index: c_int,
        depth: usize,
    ) -> Result<serde_json::Value, Refused> {
        self.count()?;
        if depth >= DEPTH {
            return Err(Refused::Bound(format!("its tables nest more than {DEPTH} deep")));
        }
        // SAFETY: as the caller's; each pair `lua_rawiter` pushes is popped before the next, also on an error.
        unsafe {
            if !self.seen.insert(ffi::lua_topointer(state, index)) {
                return Err(Refused::Bound(
                    "a table appears twice in it; give each place a table of its own (`table.clone`)".to_owned(),
                ));
            }
            if ffi::lua_checkstack(state, 2) == 0 {
                return Err(Refused::Bound("its tables nest too deep for the VM's stack".to_owned()));
            }
            let length = usize::try_from(ffi::lua_objlen_(state, index)).unwrap_or(0);
            let mut items: Vec<serde_json::Value> = Vec::with_capacity(length);
            let mut fields = Map::new();
            let mut array = true;
            let mut iter = 0;
            loop {
                iter = ffi::lua_rawiter(state, index, iter);
                if iter < 0 {
                    break;
                }
                let pair = self.raw_pair(state, length, &mut array, &mut items, &mut fields, depth);
                ffi::lua_pop(state, 2);
                pair?;
            }
            Ok(match array {
                true => serde_json::Value::Array(items),
                false => serde_json::Value::Object(fields),
            })
        }
    }

    /// The pair `lua_rawiter` pushed, its key at -2 and its value at -1, into `items` while the table is an array
    /// (keys `1..length`), else into `fields`.
    ///
    /// # Safety
    /// As for [`Walk::raw`], with the pair on the stack.
    unsafe fn raw_pair(
        &mut self,
        state: *mut ffi::lua_State,
        length: usize,
        array: &mut bool,
        items: &mut Vec<serde_json::Value>,
        fields: &mut Map<String, serde_json::Value>,
        depth: usize,
    ) -> Result<(), Refused> {
        // SAFETY: as the caller's.
        unsafe {
            let value = self.raw(state, -1, depth + 1)?;
            let key = ffi::lua_type(state, -2);
            let index = match key {
                ffi::LUA_TNUMBER => Some(ffi::lua_tonumberx(state, -2, std::ptr::null_mut())),
                _ => None,
            };
            if let Some(slot) =
                index.filter(|index| *array && index.fract() == 0.0 && *index >= 1.0 && *index <= length as f64)
            {
                let slot = slot as usize - 1;
                if items.len() <= slot {
                    items.resize(slot + 1, serde_json::Value::Null);
                }
                items[slot] = value;
                return Ok(());
            }
            // Not a sequence after all: the items so far are fields, by their index.
            if *array {
                *array = false;
                for (slot, item) in std::mem::take(items).into_iter().enumerate() {
                    fields.insert((slot + 1).to_string(), item);
                }
            }
            let name = match (key, index) {
                (ffi::LUA_TSTRING, _) => match std::str::from_utf8(raw_bytes(state, -2)) {
                    Ok(name) => name.to_owned(),
                    Err(_) => return Err(Refused::Value("a key that is not UTF-8".to_owned())),
                },
                (_, Some(index)) if index.fract() == 0.0 => (index as i64).to_string(),
                (_, Some(index)) => index.to_string(),
                _ => return Err(Refused::Value(format!("a key of type {}", type_name(key)))),
            };
            self.bytes += name.len() as u64;
            fields.insert(name, value);
            Ok(())
        }
    }
}

/// A Luau number as JSON: whole numbers as integers, as mlua reads them.
fn number(value: f64) -> Result<serde_json::Value, Refused> {
    if value.fract() == 0.0 && value.abs() < 9_007_199_254_740_992.0 {
        return Ok(serde_json::Value::Number((value as i64).into()));
    }
    Number::from_f64(value)
        .map(serde_json::Value::Number)
        .ok_or_else(|| Refused::Value(format!("{value} is not a finite number")))
}

/// The bytes of the string at slot `index`.
///
/// # Safety
/// The slot holds a string, which the VM keeps while the slot does.
unsafe fn raw_bytes<'a>(state: *mut ffi::lua_State, index: c_int) -> &'a [u8] {
    let mut length = 0;
    // SAFETY: as documented; `lua_tolstring` of a string converts nothing.
    unsafe {
        let text = ffi::lua_tolstring(state, index, &mut length);
        if text.is_null() {
            return &[];
        }
        std::slice::from_raw_parts(text.cast::<u8>(), length)
    }
}

fn type_name(kind: c_int) -> &'static str {
    match kind {
        ffi::LUA_TFUNCTION => "function",
        ffi::LUA_TUSERDATA | ffi::LUA_TLIGHTUSERDATA => "userdata",
        ffi::LUA_TTHREAD => "thread",
        ffi::LUA_TBUFFER => "buffer",
        ffi::LUA_TVECTOR => "vector",
        _ => "value",
    }
}

/// `value` as a Luau value: an object a table of its fields (a `null` field left out), an array a sequence.
pub(crate) fn luau(lua: &Lua, value: &serde_json::Value) -> mlua::Result<Value> {
    Ok(match value {
        serde_json::Value::Null => Value::Nil,
        serde_json::Value::Bool(value) => Value::Boolean(*value),
        serde_json::Value::Number(number) => Value::Number(number.as_f64().unwrap_or_default()),
        serde_json::Value::String(text) => Value::String(lua.create_string(text)?),
        serde_json::Value::Array(items) => {
            let table = lua.create_table_with_capacity(items.len(), 0)?;
            for (index, item) in items.iter().enumerate() {
                match item {
                    serde_json::Value::Null => {
                        table.raw_set(index + 1, Value::LightUserData(mlua::LightUserData(std::ptr::null_mut())))?
                    }
                    item => table.raw_set(index + 1, luau(lua, item)?)?,
                }
            }
            Value::Table(table)
        }
        serde_json::Value::Object(fields) => {
            let table = lua.create_table_with_capacity(0, fields.len())?;
            for (name, field) in fields {
                match field {
                    serde_json::Value::Null => {}
                    serde_json::Value::String(text) => table.raw_set(name.as_str(), text.as_str())?,
                    field => table.raw_set(name.as_str(), luau(lua, field)?)?,
                }
            }
            Value::Table(table)
        }
    })
}
