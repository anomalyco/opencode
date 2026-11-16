//! The tables a call's input and what changed reach a plugin in (a slot's input, a route's or a slot's `Changed`, a
//! view's input): one set an activation, cleared and filled in place for each call, and read-only to the plugin. So a
//! render allocates none of them, and no call sees what another was handed: each field the call does not have is
//! cleared, and the plugin cannot write a field of its own into them. A table the plugin kept from an earlier call
//! shows the running call's values. A call handed what the table holds already leaves it as it is, as the plugin cannot
//! have changed it. A call that comes while the set is lent (none does today) gets a set of its own.

#![allow(unsafe_code)]

use std::cell::{Cell, RefCell};
use std::os::raw::c_int;
use std::rc::Rc;

use mlua::{Lua, Table, Value, ffi};
use opencode_plugin_abi::{Changed, SlotInput, v2};

use super::bind::out;

pub(crate) struct Inputs {
    lent: Cell<bool>,
    slot: Table,
    prompt: Table,
    changed: Table,
    sessions: Table,
    lists: Table,
    messages: Table,
    surface: Table,
    /// The last palette a view was handed, and its table: a palette changes with the theme only.
    palette: RefCell<Option<(v2::Palette, Value)>>,
    /// What `slot` and `changed` hold now.
    last_slot: RefCell<Option<SlotInput>>,
    last_changed: RefCell<Option<Changed>>,
}

impl Inputs {
    pub(crate) fn new(lua: &Lua) -> mlua::Result<Rc<Self>> {
        let table = || {
            let table = lua.create_table()?;
            table.set_readonly(true);
            Ok::<_, mlua::Error>(table)
        };
        Ok(Rc::new(Self {
            lent: Cell::new(false),
            slot: table()?,
            prompt: table()?,
            changed: table()?,
            sessions: table()?,
            lists: table()?,
            messages: table()?,
            surface: table()?,
            palette: RefCell::default(),
            last_slot: RefCell::default(),
            last_changed: RefCell::default(),
        }))
    }

    /// Runs `f` with the set, or with a set of its own when the set is lent already.
    pub(crate) fn lend<R>(self: &Rc<Self>, lua: &Lua, f: impl FnOnce(&Inputs) -> mlua::Result<R>) -> mlua::Result<R> {
        if self.lent.replace(true) {
            return f(&*Self::new(lua)?);
        }
        struct Back<'a>(&'a Cell<bool>);
        impl Drop for Back<'_> {
            fn drop(&mut self) {
                self.0.set(false);
            }
        }
        let _back = Back(&self.lent);
        f(self)
    }

    /// The slot's input, as the contract's JSON has it: a field left out is `nil`.
    pub(crate) fn slot(&self, input: &SlotInput) -> mlua::Result<Table> {
        if self.last_slot.borrow().as_ref() == Some(input) {
            return Ok(self.slot.clone());
        }
        self.last_slot.take();
        refill(&self.slot, |table| {
            if let Some(session) = &input.session_id {
                table.raw_set("session_id", session.as_str())?;
            }
            if let Some(prompt) = &input.prompt {
                refill(&self.prompt, |table| {
                    table.raw_set("shell", prompt.shell)?;
                    table.raw_set("show_details", prompt.show_details)
                })?;
                table.raw_set("prompt", &self.prompt)?;
            }
            for (name, size) in [("width", input.width), ("height", input.height)] {
                if size > 0 {
                    table.raw_set(name, size)?;
                }
            }
            Ok(())
        })?;
        *self.last_slot.borrow_mut() = Some(input.clone());
        Ok(self.slot.clone())
    }

    /// What changed, as the contract's JSON has it: `false` and an empty list are `nil`.
    pub(crate) fn changed(&self, lua: &Lua, changed: &Changed) -> mlua::Result<Table> {
        if self.last_changed.borrow().as_ref() == Some(changed) {
            return Ok(self.changed.clone());
        }
        self.last_changed.take();
        refill(&self.changed, |table| {
            for (name, set) in
                [("all", changed.all), ("local", changed.local), ("size", changed.size), ("woken", changed.woken)]
            {
                if set {
                    table.raw_set(name, true)?;
                }
            }
            for (name, list, ids) in
                [("sessions", &self.sessions, &changed.sessions), ("lists", &self.lists, &changed.lists)]
            {
                if !ids.is_empty() {
                    fill_list(lua, list, ids.iter().map(|id| [id.as_str()].into_iter()))?;
                    table.raw_set(name, list)?;
                }
            }
            if !changed.messages.is_empty() {
                let pairs =
                    changed.messages.iter().map(|(session, message)| [session.as_str(), message.as_str()].into_iter());
                fill_list(lua, &self.messages, pairs)?;
                table.raw_set("messages", &self.messages)?;
            }
            // Rare, and small: a table of its own each time.
            if !changed.locations.is_empty() {
                table.raw_set("locations", out(lua, &changed.locations)?)?;
            }
            Ok(())
        })?;
        *self.last_changed.borrow_mut() = Some(changed.clone());
        Ok(self.changed.clone())
    }

    /// A view's input: its size, its palette, its panel, what changed and its slot's input.
    pub(crate) fn surface(&self, lua: &Lua, input: &v2::SurfaceInput) -> mlua::Result<Table> {
        let palette = {
            let mut cached = self.palette.borrow_mut();
            match &*cached {
                Some((known, table)) if *known == input.palette => table.clone(),
                _ => {
                    let table = out(lua, &input.palette)?;
                    freeze(&table)?;
                    *cached = Some((input.palette.clone(), table.clone()));
                    table
                }
            }
        };
        let changed = (input.changed != Changed::default()).then(|| self.changed(lua, &input.changed)).transpose()?;
        let slot = input.slot.as_ref().map(|slot| self.slot(slot)).transpose()?;
        refill(&self.surface, |table| {
            table.raw_set("width", input.width)?;
            table.raw_set("height", input.height)?;
            table.raw_set("palette", palette)?;
            table.raw_set("full", input.full.then_some(true))?;
            if let Some(panel) = &input.panel {
                table.raw_set("panel", out(lua, panel)?)?;
            }
            table.raw_set("changed", changed)?;
            table.raw_set("slot", slot)
        })?;
        Ok(self.surface.clone())
    }
}

/// Clears `table` and fills it with `fill`, read-only to the plugin before and after.
fn refill(table: &Table, fill: impl FnOnce(&Table) -> mlua::Result<()>) -> mlua::Result<()> {
    table.set_readonly(false);
    let filled = table.clear().and_then(|()| fill(table));
    table.set_readonly(true);
    filled
}

/// Makes `value` and the tables in it read-only to the plugin: a table a later call is handed again.
fn freeze(value: &Value) -> mlua::Result<()> {
    if let Value::Table(table) = value {
        table.for_each::<Value, Value>(|_, inner| freeze(&inner))?;
        table.set_readonly(true);
    }
    Ok(())
}

/// Clears the read-only list `table` and fills it with `items` on the VM's stack: an item of one string is that
/// string, an item of more is a read-only table of them (a message's `{ session, message }`). A list left half filled
/// by an allocation that failed is cleared and read-only again, and the error is the call's.
fn fill_list<'a, I>(lua: &Lua, table: &Table, items: impl Iterator<Item = I>) -> mlua::Result<()>
where
    I: ExactSizeIterator<Item = &'a str>,
{
    // SAFETY: `exec_raw` pushes `table` and runs the closure in protected mode with it at the top and room for three
    // more slots; each step pushes at most two, which `lua_rawseti_` pops, so the table stays at -1 between items.
    let filled = unsafe {
        lua.exec_raw::<()>(table, |state| {
            ffi::lua_setreadonly(state, -1, 0);
            ffi::lua_cleartable(state, -1);
            for (index, item) in items.enumerate() {
                let slot = c_int::try_from(index + 1).unwrap_or(c_int::MAX);
                if item.len() == 1 {
                    for text in item {
                        ffi::lua_pushlstring_(state, text.as_ptr().cast(), text.len());
                    }
                } else {
                    ffi::lua_createtable(state, c_int::try_from(item.len()).unwrap_or(0), 0);
                    for (part, text) in item.enumerate() {
                        ffi::lua_pushlstring_(state, text.as_ptr().cast(), text.len());
                        ffi::lua_rawseti_(state, -2, c_int::try_from(part + 1).unwrap_or(c_int::MAX));
                    }
                    ffi::lua_setreadonly(state, -1, 1);
                }
                ffi::lua_rawseti_(state, -2, slot);
            }
            ffi::lua_setreadonly(state, -1, 1);
        })
    };
    if filled.is_err() {
        table.set_readonly(false);
        let _ = table.clear();
        table.set_readonly(true);
    }
    filled
}
