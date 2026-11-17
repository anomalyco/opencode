//! The tables a call's input and what changed reach a plugin in (a slot's input, a route's or a slot's `Changed`, a
//! view's input): one set an activation, filled in place for each call, and read-only to the plugin. So a
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

    /// What changed, as the contract's JSON has it: `false` and an empty list are `nil`. Each list table holds the
    /// last call's list while `last_changed` names it, and is changed only where the running call's differs: its
    /// strings stay referenced, and are not made again, from one call to the next.
    pub(crate) fn changed(&self, lua: &Lua, changed: &Changed) -> mlua::Result<Table> {
        if self.last_changed.borrow().as_ref() == Some(changed) {
            return Ok(self.changed.clone());
        }
        // Until the tables are filled, they hold nothing known: a fill that fails leaves the next one to start over.
        let mut last = self.last_changed.take();
        let (sessions, lists, messages) = match &mut last {
            Some(last) => (Some(&mut last.sessions), Some(&mut last.lists), Some(&mut last.messages)),
            None => (None, None, None),
        };
        fn pair((session, message): &(String, String)) -> [&str; 2] {
            [session.as_str(), message.as_str()]
        }
        // A tuple's `clone_from` clones anew: each part is copied on its own.
        fn assign(into: &mut (String, String), from: &(String, String)) {
            into.0.clone_from(&from.0);
            into.1.clone_from(&from.1);
        }
        let tables = (&self.changed, &self.sessions, &self.lists, &self.messages);
        // SAFETY: `exec_raw` pushes the four tables and runs the closure in protected mode with them at the top and
        // room for three more slots; each step pushes at most two, which it pops. No Rust value that needs dropping
        // lives across a call that can raise.
        let filled = unsafe {
            lua.exec_raw::<()>(tables, |state| {
                let top = ffi::lua_gettop(state);
                let (table, at_sessions, at_lists, at_messages) = (top - 3, top - 2, top - 1, top);
                fill_list(state, at_sessions, &changed.sessions, sessions, |id| [id.as_str()], String::clone_from);
                fill_list(state, at_lists, &changed.lists, lists, |id| [id.as_str()], String::clone_from);
                fill_list(state, at_messages, &changed.messages, messages, pair, assign);
                ffi::lua_setreadonly(state, table, 0);
                ffi::lua_cleartable(state, table);
                let flags =
                    [("all", changed.all), ("local", changed.local), ("size", changed.size), ("woken", changed.woken)];
                for (name, _) in flags.into_iter().filter(|(_, set)| *set) {
                    ffi::lua_pushlstring_(state, name.as_ptr().cast(), name.len());
                    ffi::lua_pushboolean(state, 1);
                    ffi::lua_rawset(state, table);
                }
                let named = [
                    ("sessions", at_sessions, changed.sessions.is_empty()),
                    ("lists", at_lists, changed.lists.is_empty()),
                    ("messages", at_messages, changed.messages.is_empty()),
                ];
                for (name, list, _) in named.into_iter().filter(|(_, _, empty)| !empty) {
                    ffi::lua_pushlstring_(state, name.as_ptr().cast(), name.len());
                    ffi::lua_pushvalue(state, list);
                    ffi::lua_rawset(state, table);
                }
                ffi::lua_setreadonly(state, table, 1);
            })
        };
        // Rare, and small: a table of its own each time.
        let filled = filled.and_then(|()| match changed.locations.is_empty() {
            true => Ok(()),
            false => {
                let locations = out(lua, &changed.locations)?;
                self.changed.set_readonly(false);
                let set = self.changed.raw_set("locations", locations);
                self.changed.set_readonly(true);
                set
            }
        });
        if let Err(error) = filled {
            // A fill an allocation failed leaves each table empty and read-only, and the error is the call's.
            for table in [&self.changed, &self.sessions, &self.lists, &self.messages] {
                table.set_readonly(false);
                let _ = table.clear();
                table.set_readonly(true);
            }
            return Err(error);
        }
        let last = match last {
            Some(mut last) => {
                let Changed { all, sessions: _, lists: _, messages: _, locations, local, size, woken } = changed;
                last.locations.clone_from(locations);
                (last.all, last.local, last.size, last.woken) = (*all, *local, *size, *woken);
                last
            }
            None => changed.clone(),
        };
        *self.last_changed.borrow_mut() = Some(last);
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

/// Makes the read-only list at stack slot `index`, which holds `old` (`None`: anything), hold `items` instead, and
/// `old` too, through `assign`: an item of one string is that string, an item of more is a read-only table of them (a
/// message's `{ session, message }`). Only the slots whose item differs from `old`'s are set, or copied.
///
/// # Safety
/// `index` is an absolute slot of `state` that holds a table, with room for two more slots, in a protected call.
unsafe fn fill_list<T: PartialEq + Clone, const N: usize>(
    state: *mut ffi::lua_State,
    index: c_int,
    items: &[T],
    mut old: Option<&mut Vec<T>>,
    parts: impl Fn(&T) -> [&str; N],
    assign: impl Fn(&mut T, &T),
) {
    if old.as_deref().is_some_and(|old| old == items) {
        return;
    }
    let slot = |at: usize| c_int::try_from(at + 1).unwrap_or(c_int::MAX);
    // SAFETY: as the caller's; each step pushes at most two slots and pops them.
    unsafe {
        ffi::lua_setreadonly(state, index, 0);
        if old.is_none() {
            ffi::lua_cleartable(state, index);
        }
        let had = old.as_deref().map_or(0, Vec::len);
        for (at, item) in items.iter().enumerate() {
            match old.as_deref_mut().and_then(|old| old.get_mut(at)) {
                Some(known) if known == item => continue,
                Some(known) => assign(known, item),
                None => {}
            }
            let parts = parts(item);
            if let [text] = parts.as_slice() {
                ffi::lua_pushlstring_(state, text.as_ptr().cast(), text.len());
            } else {
                ffi::lua_createtable(state, c_int::try_from(N).unwrap_or(0), 0);
                for (part, text) in parts.into_iter().enumerate() {
                    ffi::lua_pushlstring_(state, text.as_ptr().cast(), text.len());
                    ffi::lua_rawseti_(state, -2, slot(part));
                }
                ffi::lua_setreadonly(state, -1, 1);
            }
            ffi::lua_rawseti_(state, index, slot(at));
        }
        for at in (items.len()..had).rev() {
            ffi::lua_pushnil(state);
            ffi::lua_rawseti_(state, index, slot(at));
        }
        if let Some(old) = old {
            old.truncate(items.len());
            old.extend_from_slice(&items[had.min(items.len())..]);
        }
        ffi::lua_setreadonly(state, index, 1);
    }
}
