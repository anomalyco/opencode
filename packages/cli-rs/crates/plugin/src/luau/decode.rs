//! Decodes Luau stack values without an intermediate JSON tree. Known node shapes take a fast path; unknown fields,
//! kinds and types fall back to serde. Charge every table visit, including empty slots and fallback walks, before
//! allocating. Shared or sparse tables must not bypass the work budget. Unmarked empty tables decode as arrays; the
//! object marker forces an object.

#![allow(unsafe_code)]

use std::any::Any;
use std::borrow::Cow;
use std::fmt;
use std::os::raw::c_int;

use mlua::{AppDataRef, Function, LightUserData, Lua, Value, ffi};
use opencode_plugin_abi::{self as abi, v2};
use serde::de::{self, DeserializeOwned, DeserializeSeed, Deserializer, IntoDeserializer, Visitor};

/// The parts (keys, values) a value may hold for each node a tree may hold ([`crate::limits::Limits::nodes`]).
pub(crate) const VALUES_A_NODE: u64 = 16;

/// The table slots a decode may walk for each node a tree may hold ([`crate::limits::Limits::nodes`]): the work bound,
/// which a table walked again and again (a DAG of shared tables, a sparse table of a million slots shared a thousand
/// times) meets though its parts are few. A row of text is four tables and charges about 140, so a tree as large as
/// the node limit lets through decodes; the 20,000 nodes of the default limits allow 5.12 M.
const SLOTS_A_NODE: u64 = 256;

/// The work bound however small the node limit: a few milliseconds of host work, which a test's small limits leave to
/// the parts bound.
const LEAST_SLOTS: u64 = 1 << 20;

/// What a walk of a table costs beyond its slots, in slots: a lookup of its `type`, a check of its marker, and
/// serde's buffering where serde reads it. A tree of many small tables walked again and again meets the bound by
/// these, where its slots alone would let it run a few hundred milliseconds.
const SLOTS_A_WALK: u64 = 32;

/// The theme tokens a color names most, kept as these `'static` names rather than a `String` each: a render of many
/// spans names a few tokens again and again. Any other token is its own `String`.
pub(super) const TOKENS: &[&str] = &[
    "text.base",
    "text.muted",
    "text.faint",
    "text.feedback.error.base",
    "text.feedback.warning.base",
    "text.feedback.success.base",
    "text.feedback.info.base",
    "text.action.primary.base",
    "background.base",
    "background.raised.base",
    "border.base",
];

/// The items an array's `Vec` holds before it grows: its length, up to this, as a length is not yet charged.
const ITEMS_AHEAD: usize = 1024;

/// How deep a value's tables may nest: past the layout depth ([`crate::reconcile::MAX_DEPTH`]) twice over, as a node's
/// children are a table in a table.
const DEPTH: usize = 2 * crate::reconcile::MAX_DEPTH as usize;

/// Why a value cannot cross: refused by a bound (`luau-1`, which fails the call) or not a value of the contract.
#[derive(Debug)]
pub(crate) enum Refused {
    Bound(String),
    Value(String),
}

impl fmt::Display for Refused {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Refused::Bound(reason) | Refused::Value(reason) => f.write_str(reason),
        }
    }
}

impl std::error::Error for Refused {}

impl de::Error for Refused {
    fn custom<T: fmt::Display>(message: T) -> Self {
        Refused::Value(message.to_string())
    }
}

/// The C function a VM's decodes run in ([`enter`]), made at its first decode and kept: `exec_raw` makes a new closure
/// each call, for the collector to free.
struct Entry(Function);

impl Entry {
    fn get(lua: &Lua) -> mlua::Result<AppDataRef<'_, Entry>> {
        if let Some(entry) = lua.app_data_ref::<Entry>() {
            return Ok(entry);
        }
        // SAFETY: `enter` is called as a Luau C function, and only by `Decode::decode`.
        let function = unsafe { lua.create_c_function(enter) }?;
        lua.set_app_data(Entry(function));
        lua.app_data_ref::<Entry>().ok_or_else(|| mlua::Error::runtime("the decode's entry was not kept"))
    }
}

/// Runs the reader slot 1 points to on the value in slot 2 ([`Decode::decode`]). A panic aborts, as in `exec_raw`: it
/// cannot unwind through Luau.
unsafe extern "C-unwind" fn enter(state: *mut ffi::lua_State) -> c_int {
    // SAFETY: `Decode::decode` passes a pointer to its reader, which lives until the call returns.
    let read = unsafe { &mut *ffi::lua_tolightuserdata(state, 1).cast::<&mut dyn FnMut(*mut ffi::lua_State)>() };
    if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| read(state))).is_err() {
        std::process::abort();
    }
    0
}

/// One decode, bounded as the host's limits are charged: what it makes lives on the Rust heap, outside the VM's cap
/// and with no safepoint of the budget's.
pub(crate) struct Decode {
    values: u64,
    bytes: u64,
    most_values: u64,
    most_bytes: u64,
    /// The slots of tables walked: each walk of a table counts all of its slots, as `lua_rawiter` scans the empty ones
    /// too. Unlike the parts, a walk the hand decoder gives up and serde does again is counted twice, never undone.
    slots: u64,
    most_slots: u64,
}

impl Decode {
    pub(crate) fn new() -> Self {
        let limits = crate::limits::get();
        Self {
            values: 0,
            bytes: 0,
            most_values: VALUES_A_NODE * limits.nodes,
            most_bytes: limits.plugin_content,
            slots: 0,
            most_slots: (SLOTS_A_NODE * limits.nodes).max(LEAST_SLOTS),
        }
    }

    /// `value` of the VM `lua` as a `T`, read on the VM's stack, where reading a key, a value or a string makes no
    /// handle and allocates nothing in the VM.
    pub(crate) fn decode<T: DeserializeOwned + 'static>(&mut self, lua: &Lua, value: &Value) -> Result<T, Refused> {
        let mut decoded = Err(Refused::Value("the value was not read".to_owned()));
        // SAFETY: [`enter`] runs this in protected mode with `value` at slot 2 and room for the slots a C function
        // has, which each table checks for again as it goes deeper. The decode reads the stack, pops what it pushes,
        // and raises no Lua error of its own.
        let mut read = |state| decoded = unsafe { self.top(state, 2) };
        let mut read: &mut dyn FnMut(*mut ffi::lua_State) = &mut read;
        let ran = Entry::get(lua).and_then(|entry| entry.0.call::<()>((LightUserData((&raw mut read).cast()), value)));
        ran.map_err(|error| Refused::Value(error.to_string()))?;
        decoded
    }

    /// The value at absolute slot `index` as a `T`: a node tree by hand, anything else through serde.
    ///
    /// # Safety
    /// `index` is a valid absolute slot of `state`, inside a protected call.
    unsafe fn top<T: DeserializeOwned + 'static>(
        &mut self,
        state: *mut ffi::lua_State,
        index: c_int,
    ) -> Result<T, Refused> {
        let mut decoded: Option<T> = None;
        let out: &mut dyn Any = &mut decoded;
        // SAFETY: as the caller's.
        unsafe {
            if let Some(out) = out.downcast_mut::<Option<abi::Render>>() {
                *out = Some(self.render(state, index)?);
            } else if let Some(out) = out.downcast_mut::<Option<abi::Node>>() {
                *out = Some(self.node(state, index, 0)?);
            } else if let Some(out) = out.downcast_mut::<Option<v2::Node>>() {
                *out = Some(self.node2(state, index, 0)?);
            } else {
                return T::deserialize(Slot { decode: self, state, index, depth: 0 });
            }
        }
        decoded.ok_or_else(|| Refused::Value("the value was not read".to_owned()))
    }

    /// The parts and the bytes charged so far.
    #[cfg(test)]
    pub(crate) fn charged(&self) -> (u64, u64) {
        (self.values, self.bytes)
    }

    /// The table slots walked so far.
    #[cfg(test)]
    pub(crate) fn walked(&self) -> u64 {
        self.slots
    }

    /// Counts `parts` more parts.
    fn charge(&mut self, parts: u64) -> Result<(), Refused> {
        self.values += parts;
        if self.values > self.most_values {
            return Err(Refused::Bound(format!("it holds more than {} parts", self.most_values)));
        }
        Ok(())
    }

    /// Counts a walk of a table of `slots` slots: `lua_rawiter` scans each, empty or not, and the walk costs
    /// [`SLOTS_A_WALK`] more.
    fn walk(&mut self, slots: u64) -> Result<(), Refused> {
        self.slots += slots + SLOTS_A_WALK;
        if self.slots > self.most_slots {
            return Err(Refused::Bound(format!("its tables take more than {} slots to read", self.most_slots)));
        }
        Ok(())
    }

    /// Counts `bytes` of text and keys.
    fn charge_bytes(&mut self, bytes: usize) -> Result<(), Refused> {
        self.bytes += bytes as u64;
        if self.bytes > self.most_bytes {
            return Err(Refused::Bound(format!("its text is more than {} bytes", self.most_bytes)));
        }
        Ok(())
    }

    /// A string value: charged, and UTF-8.
    fn text<'s>(&mut self, bytes: &'s [u8]) -> Result<&'s str, Refused> {
        self.charge_bytes(bytes.len())?;
        utf8(bytes).ok_or_else(|| Refused::Value("a string that is not UTF-8".to_owned()))
    }

    /// A key: charged, and UTF-8.
    fn key<'s>(&mut self, bytes: &'s [u8]) -> Result<&'s str, Refused> {
        self.charge_bytes(bytes.len())?;
        utf8(bytes).ok_or_else(|| Refused::Value("a key that is not UTF-8".to_owned()))
    }

    /// Enters the table at `index`, `depth` deep: a part, within the depth, with room on the VM's stack for a pair and
    /// one more, and one walk of its slots charged to the work bound.
    ///
    /// # Safety
    /// As for [`Decode::top`], with a table at `index`.
    unsafe fn enter(&mut self, state: *mut ffi::lua_State, index: c_int, depth: usize) -> Result<(), Refused> {
        self.charge(1)?;
        // SAFETY: as the caller's.
        self.walk(unsafe { capacity(state, index) })?;
        if depth >= DEPTH {
            return Err(Refused::Bound(format!("its tables nest more than {DEPTH} deep")));
        }
        // SAFETY: as the caller's.
        if unsafe { ffi::lua_checkstack(state, 3) } == 0 {
            return Err(Refused::Bound("its tables nest too deep for the VM's stack".to_owned()));
        }
        Ok(())
    }

    /// The render at `index`: `{ type = "show", node = ... }`, `{ type = "keep" }` or `{ type = "hide" }`.
    ///
    /// # Safety
    /// As for [`Decode::top`].
    unsafe fn render(&mut self, state: *mut ffi::lua_State, index: c_int) -> Result<abi::Render, Refused> {
        // SAFETY: as the caller's.
        unsafe { self.or_serde(state, index, 0, |decode| decode.render_fast(state, index)) }
    }

    /// # Safety
    /// As for [`Decode::top`].
    unsafe fn render_fast(&mut self, state: *mut ffi::lua_State, index: c_int) -> Result<abi::Render, Slow> {
        // SAFETY: as the caller's; each pair is popped before the next.
        unsafe {
            table(state, index)?;
            self.enter(state, index, 0)?;
            let (mut kind, mut node) = (None, None);
            let mut iter = 0;
            loop {
                iter = ffi::lua_rawiter(state, index, iter);
                if iter < 0 {
                    break;
                }
                let top = ffi::lua_gettop(state);
                let pair = match self.field_name(state, top - 1) {
                    Ok(b"type") => self.word(state, top).map(|word| kind = Some(word)),
                    Ok(b"node") => self.node(state, top, 1).map(|value| node = Some(value)).map_err(Slow::from),
                    Ok(_) => Err(Slow::Serde),
                    Err(slow) => Err(slow),
                };
                ffi::lua_pop(state, 2);
                pair?;
            }
            match (kind, node) {
                (Some(b"show"), Some(node)) => Ok(abi::Render::Show(node)),
                (Some(b"keep"), None) => Ok(abi::Render::Keep),
                (Some(b"hide"), None) => Ok(abi::Render::Hide),
                _ => Err(Slow::Serde),
            }
        }
    }

    /// The node at `index`, `depth` deep.
    ///
    /// # Safety
    /// As for [`Decode::top`].
    unsafe fn node(&mut self, state: *mut ffi::lua_State, index: c_int, depth: usize) -> Result<abi::Node, Refused> {
        // SAFETY: as the caller's.
        unsafe { self.or_serde(state, index, depth, |decode| decode.node_fast(state, index, depth)) }
    }

    /// # Safety
    /// As for [`Decode::top`].
    unsafe fn node_fast(&mut self, state: *mut ffi::lua_State, index: c_int, depth: usize) -> Result<abi::Node, Slow> {
        // SAFETY: as the caller's.
        unsafe {
            table(state, index)?;
            match kind(state, index) {
                Some(b"box") => {
                    let mut f = BoxFields::new(Self::node);
                    self.fields(state, index, depth, |decode, name, at| f.read(decode, state, name, at, depth))?;
                    Ok(abi::Node::Box {
                        row: f.row,
                        gap: f.gap,
                        padding: f.padding,
                        justify: f.justify,
                        align: f.align,
                        bg: f.bg,
                        layout: f.layout,
                        on_click: f.on_click,
                        children: f.children,
                        border: f.border,
                        padding_sides: f.padding_sides,
                        wrap: f.wrap,
                        overflow: f.overflow,
                    })
                }
                Some(b"text") => {
                    let mut f = TextFields::default();
                    self.fields(state, index, depth, |decode, name, at| f.read(decode, state, name, at, depth))?;
                    Ok(abi::Node::Text {
                        spans: f.spans.ok_or(Slow::Serde)?,
                        fg: f.fg,
                        wrap: f.wrap,
                        truncate: f.truncate,
                        selectable: f.selectable,
                        hover_fg: f.hover_fg,
                        layout: f.layout,
                        on_click: f.on_click,
                    })
                }
                _ => Err(Slow::Serde),
            }
        }
    }

    /// The surface node at `index`, `depth` deep: boxes and text by hand, the other kinds through serde.
    ///
    /// # Safety
    /// As for [`Decode::top`].
    unsafe fn node2(&mut self, state: *mut ffi::lua_State, index: c_int, depth: usize) -> Result<v2::Node, Refused> {
        // SAFETY: as the caller's.
        unsafe { self.or_serde(state, index, depth, |decode| decode.node2_fast(state, index, depth)) }
    }

    /// # Safety
    /// As for [`Decode::top`].
    unsafe fn node2_fast(&mut self, state: *mut ffi::lua_State, index: c_int, depth: usize) -> Result<v2::Node, Slow> {
        // SAFETY: as the caller's.
        unsafe {
            table(state, index)?;
            match kind(state, index) {
                Some(b"box") => {
                    let mut f = BoxFields::new(Self::node2);
                    self.fields(state, index, depth, |decode, name, at| f.read2(decode, state, name, at, depth))?;
                    Ok(v2::Node::Box {
                        id: f.id,
                        row: f.row,
                        gap: f.gap,
                        padding: f.padding,
                        justify: f.justify,
                        align: f.align,
                        bg: f.bg,
                        layout: f.layout,
                        on_click: f.on_click,
                        children: f.children,
                        border: f.border,
                        padding_sides: f.padding_sides,
                        wrap: f.wrap,
                        overflow: f.overflow,
                        sticky: f.sticky,
                        anchor: f.anchor,
                        split: f.split,
                        // Its fields are the box's own keys (`flatten`): a box with any of them goes through serde.
                        interact: abi::interact::Interact::default(),
                        visible: f.visible,
                    })
                }
                Some(b"text") => {
                    let mut f = TextFields::default();
                    self.fields(state, index, depth, |decode, name, at| f.read2(decode, state, name, at, depth))?;
                    Ok(v2::Node::Text {
                        id: f.id,
                        spans: f.spans.ok_or(Slow::Serde)?,
                        fg: f.fg,
                        wrap: f.wrap,
                        truncate: f.truncate,
                        selectable: f.selectable,
                        hover_fg: f.hover_fg,
                        layout: f.layout,
                        on_click: f.on_click,
                        hover_events: f.hover_events,
                    })
                }
                _ => Err(Slow::Serde),
            }
        }
    }

    /// `fast`, or, where it cannot read the table at `index`, serde: the charges and the stack as they were before it.
    ///
    /// # Safety
    /// As for [`Decode::top`].
    unsafe fn or_serde<T: DeserializeOwned>(
        &mut self,
        state: *mut ffi::lua_State,
        index: c_int,
        depth: usize,
        fast: impl FnOnce(&mut Self) -> Result<T, Slow>,
    ) -> Result<T, Refused> {
        let (values, bytes) = (self.values, self.bytes);
        // SAFETY: as the caller's.
        let top = unsafe { ffi::lua_gettop(state) };
        match fast(self) {
            Ok(value) => Ok(value),
            Err(Slow::Refused(refused)) => Err(refused),
            Err(Slow::Serde) => {
                (self.values, self.bytes) = (values, bytes);
                // SAFETY: as the caller's; the fast decode left nothing the stack needs above `top`.
                unsafe { ffi::lua_settop(state, top) };
                T::deserialize(Slot { decode: self, state, index, depth })
            }
        }
    }

    /// Each pair of the table at `index`, `depth` deep, entered first: `read` gets the key and the value's absolute
    /// slot, and the pair is popped after it.
    ///
    /// # Safety
    /// As for [`Decode::top`], with a table at `index`.
    unsafe fn fields(
        &mut self,
        state: *mut ffi::lua_State,
        index: c_int,
        depth: usize,
        mut read: impl FnMut(&mut Self, &[u8], c_int) -> Result<(), Slow>,
    ) -> Result<(), Slow> {
        // SAFETY: as the caller's; each pair is popped before the next.
        unsafe {
            self.enter(state, index, depth)?;
            let mut iter = 0;
            loop {
                iter = ffi::lua_rawiter(state, index, iter);
                if iter < 0 {
                    return Ok(());
                }
                let top = ffi::lua_gettop(state);
                let pair = match self.field_name(state, top - 1) {
                    Ok(name) => read(self, name, top),
                    Err(slow) => Err(slow),
                };
                ffi::lua_pop(state, 2);
                pair?;
            }
        }
    }

    /// The string key at `index`, charged, as its bytes: a key a hand decoder knows is one of its ASCII field names,
    /// and any other is serde's to judge, UTF-8 included. Any key that is not a string is serde's too.
    ///
    /// # Safety
    /// As for [`Decode::top`].
    unsafe fn field_name<'s>(&mut self, state: *mut ffi::lua_State, index: c_int) -> Result<&'s [u8], Slow> {
        // SAFETY: as the caller's; the key lives while its table does.
        unsafe {
            if ffi::lua_type(state, index) != ffi::LUA_TSTRING {
                return Err(Slow::Serde);
            }
            let name = raw_bytes(state, index);
            self.charge_bytes(name.len())?;
            Ok(name)
        }
    }

    /// A boolean field.
    ///
    /// # Safety
    /// As for [`Decode::top`].
    unsafe fn boolean(&mut self, state: *mut ffi::lua_State, index: c_int) -> Result<bool, Slow> {
        // SAFETY: as the caller's.
        unsafe {
            if ffi::lua_type(state, index) != ffi::LUA_TBOOLEAN {
                return Err(Slow::Serde);
            }
            self.charge(1)?;
            Ok(ffi::lua_toboolean(state, index) != 0)
        }
    }

    /// A string field.
    ///
    /// # Safety
    /// As for [`Decode::top`].
    unsafe fn string(&mut self, state: *mut ffi::lua_State, index: c_int) -> Result<String, Slow> {
        // SAFETY: as the caller's.
        unsafe { self.str(state, index).map(str::to_owned) }
    }

    /// A string field, borrowed from the VM.
    ///
    /// # Safety
    /// As for [`Decode::top`].
    unsafe fn str<'s>(&mut self, state: *mut ffi::lua_State, index: c_int) -> Result<&'s str, Slow> {
        // SAFETY: as the caller's; the string lives while its table does.
        unsafe {
            if ffi::lua_type(state, index) != ffi::LUA_TSTRING {
                return Err(Slow::Serde);
            }
            self.charge(1)?;
            self.text(raw_bytes(state, index)).map_err(Slow::from_field)
        }
    }

    /// A string field as its bytes, charged, to match against ASCII words: a string that matches none is serde's to
    /// judge, UTF-8 included.
    ///
    /// # Safety
    /// As for [`Decode::top`].
    unsafe fn word<'s>(&mut self, state: *mut ffi::lua_State, index: c_int) -> Result<&'s [u8], Slow> {
        // SAFETY: as the caller's; the string lives while its table does.
        unsafe {
            if ffi::lua_type(state, index) != ffi::LUA_TSTRING {
                return Err(Slow::Serde);
            }
            self.charge(1)?;
            let word = raw_bytes(state, index);
            self.charge_bytes(word.len())?;
            Ok(word)
        }
    }

    /// A click field, `depth` deep: a command on a press or a release. Any other action is serde's.
    ///
    /// # Safety
    /// As for [`Decode::top`].
    unsafe fn click(
        &mut self,
        state: *mut ffi::lua_State,
        index: c_int,
        depth: usize,
    ) -> Result<Option<abi::Click>, Slow> {
        let (mut action, mut on) = (None, None);
        // SAFETY: as the caller's.
        unsafe {
            table(state, index)?;
            self.fields(state, index, depth, |decode, name, at| {
                match name {
                    b"action" => action = Some(decode.action(state, at, depth + 1)?),
                    b"on" => {
                        on = Some(match decode.word(state, at)? {
                            b"up" => abi::Press::Up,
                            b"down" => abi::Press::Down,
                            _ => return Err(Slow::Serde),
                        })
                    }
                    _ => return Err(Slow::Serde),
                }
                Ok(())
            })?;
        }
        Ok(Some(abi::Click { action: action.ok_or(Slow::Serde)?, on: on.ok_or(Slow::Serde)? }))
    }

    /// # Safety
    /// As for [`Decode::top`].
    unsafe fn action(&mut self, state: *mut ffi::lua_State, index: c_int, depth: usize) -> Result<abi::Action, Slow> {
        let (mut command, mut name, mut input) = (false, None, None);
        // SAFETY: as the caller's.
        unsafe {
            table(state, index)?;
            self.fields(state, index, depth, |decode, key, at| {
                match key {
                    b"type" => command = decode.word(state, at)? == b"command",
                    b"name" => name = Some(decode.string(state, at)?),
                    b"input" => input = Some(decode.string(state, at)?),
                    _ => return Err(Slow::Serde),
                }
                Ok(())
            })?;
        }
        match (command, name) {
            (true, Some(name)) => Ok(abi::Action::Command { name, input }),
            _ => Err(Slow::Serde),
        }
    }

    /// A `u16` field: a whole number in its range.
    ///
    /// # Safety
    /// As for [`Decode::top`].
    unsafe fn small(&mut self, state: *mut ffi::lua_State, index: c_int) -> Result<u16, Slow> {
        // SAFETY: as the caller's.
        unsafe {
            if ffi::lua_type(state, index) != ffi::LUA_TNUMBER {
                return Err(Slow::Serde);
            }
            let number = ffi::lua_tonumberx(state, index, std::ptr::null_mut());
            if number.fract() != 0.0 || !(0.0..=f64::from(u16::MAX)).contains(&number) {
                return Err(Slow::Serde);
            }
            self.charge(1)?;
            Ok(number as u16)
        }
    }

    /// An optional color field: a token or `#rrggbbaa` (`Color` is untagged, which serde decodes by buffering).
    ///
    /// # Safety
    /// As for [`Decode::top`].
    unsafe fn color(&mut self, state: *mut ffi::lua_State, index: c_int) -> Result<Option<abi::Color>, Slow> {
        // SAFETY: as the caller's.
        let text = unsafe { self.str(state, index)? };
        Ok(Some(match abi::Rgba::parse(text).filter(|_| text.len() == 9) {
            Some(rgba) => abi::Color::Rgba(rgba),
            None => abi::Color::Token(match TOKENS.iter().find(|token| **token == text) {
                Some(token) => Cow::Borrowed(token),
                None => Cow::Owned(text.to_owned()),
            }),
        }))
    }

    /// Any field, through serde: a value it refuses is serde's to report for the whole table.
    ///
    /// # Safety
    /// As for [`Decode::top`].
    unsafe fn serde<T: DeserializeOwned>(
        &mut self,
        state: *mut ffi::lua_State,
        index: c_int,
        depth: usize,
    ) -> Result<T, Slow> {
        T::deserialize(Slot { decode: self, state, index, depth }).map_err(Slow::from_field)
    }

    /// The spans at `index`, `depth` deep.
    ///
    /// # Safety
    /// As for [`Decode::top`].
    unsafe fn spans(&mut self, state: *mut ffi::lua_State, index: c_int, depth: usize) -> Result<Vec<abi::Span>, Slow> {
        // SAFETY: as the caller's.
        let mut spans = Vec::with_capacity(unsafe { length(state, index) });
        // SAFETY: as the caller's.
        unsafe {
            self.items(state, index, depth, |decode, at| {
                spans.push(decode.or_serde(state, at, depth + 1, |decode| decode.span(state, at, depth + 1))?);
                Ok(())
            })?;
        }
        Ok(spans)
    }

    /// # Safety
    /// As for [`Decode::top`].
    unsafe fn span(&mut self, state: *mut ffi::lua_State, index: c_int, depth: usize) -> Result<abi::Span, Slow> {
        // SAFETY: as the caller's.
        unsafe {
            table(state, index)?;
            let mut span = abi::Span::default();
            let mut text = None;
            self.fields(state, index, depth, |decode, name, at| {
                match name {
                    b"text" => text = Some(decode.string(state, at)?),
                    b"fg" => span.fg = decode.color(state, at)?,
                    b"bg" => span.bg = decode.color(state, at)?,
                    b"bold" => span.bold = decode.boolean(state, at)?,
                    b"italic" => span.italic = decode.boolean(state, at)?,
                    b"underline" => span.underline = decode.boolean(state, at)?,
                    b"dim" => span.dim = decode.boolean(state, at)?,
                    b"strikethrough" => span.strikethrough = decode.boolean(state, at)?,
                    b"link" => span.link = Some(decode.string(state, at)?),
                    _ => return Err(Slow::Serde),
                }
                Ok(())
            })?;
            span.text = text.ok_or(Slow::Serde)?;
            Ok(span)
        }
    }

    /// The children at `index`, `depth` deep being their parent's, each read by `node`.
    ///
    /// # Safety
    /// As for [`Decode::top`].
    unsafe fn children<N>(
        &mut self,
        state: *mut ffi::lua_State,
        index: c_int,
        depth: usize,
        node: NodeFn<N>,
    ) -> Result<Vec<N>, Slow> {
        // SAFETY: as the caller's.
        let mut children = Vec::with_capacity(unsafe { length(state, index) });
        // SAFETY: as the caller's.
        unsafe {
            self.items(state, index, depth + 1, |decode, at| {
                children.push(node(decode, state, at, depth + 2)?);
                Ok(())
            })?;
        }
        Ok(children)
    }

    /// Each item of the array at `index`, `depth` deep, in one pass: `read` gets the item's absolute slot, and the pair is
    /// popped after it. A table whose keys are not `1..n` in that order (`n` its border) is serde's to read.
    ///
    /// # Safety
    /// As for [`Decode::top`].
    unsafe fn items(
        &mut self,
        state: *mut ffi::lua_State,
        index: c_int,
        depth: usize,
        mut read: impl FnMut(&mut Self, c_int) -> Result<(), Slow>,
    ) -> Result<(), Slow> {
        // SAFETY: as the caller's; each pair is popped before the next.
        unsafe {
            table(state, index)?;
            self.enter(state, index, depth)?;
            if marked_object(state, index) {
                return Err(Slow::Serde);
            }
            let (mut iter, mut next) = (0, 1.0);
            loop {
                iter = ffi::lua_rawiter(state, index, iter);
                if iter < 0 {
                    break;
                }
                let top = ffi::lua_gettop(state);
                let in_order = ffi::lua_type(state, top - 1) == ffi::LUA_TNUMBER
                    && ffi::lua_tonumberx(state, top - 1, std::ptr::null_mut()) == next;
                let item = if in_order { read(self, top) } else { Err(Slow::Serde) };
                ffi::lua_pop(state, 2);
                item?;
                next += 1.0;
            }
            if next - 1.0 != ffi::lua_objlen_(state, index) as f64 {
                return Err(Slow::Serde);
            }
            Ok(())
        }
    }
}

/// Why a hand decode stopped: a refusal that stands (a bound, or a value serde refused deeper), or a table serde has to
/// read.
enum Slow {
    Refused(Refused),
    Serde,
}

impl From<Refused> for Slow {
    fn from(refused: Refused) -> Self {
        Slow::Refused(refused)
    }
}

impl Slow {
    /// A field's refusal: a bound stands, a value of the wrong kind is serde's to report.
    fn from_field(refused: Refused) -> Self {
        match refused {
            Refused::Bound(_) => Slow::Refused(refused),
            Refused::Value(_) => Slow::Serde,
        }
    }
}

/// What reads a node: [`Decode::node`] or [`Decode::node2`].
type NodeFn<N> = unsafe fn(&mut Decode, *mut ffi::lua_State, c_int, usize) -> Result<N, Refused>;

/// The fields of a box whose children are `N`, as its keys give them; the rest keep their defaults.
struct BoxFields<N> {
    /// What reads a child.
    node: NodeFn<N>,
    id: Option<String>,
    row: bool,
    gap: u16,
    padding: (u16, u16),
    justify: abi::Justify,
    align: abi::Align,
    bg: Option<abi::Color>,
    layout: abi::Layout,
    on_click: Option<abi::Click>,
    children: Vec<N>,
    border: Option<Box<abi::Border>>,
    padding_sides: Option<abi::Edges>,
    wrap: bool,
    overflow: abi::Overflow,
    sticky: Option<v2::Edge>,
    anchor: Option<v2::Anchor>,
    split: Option<v2::Split>,
    visible: bool,
}

impl<N> BoxFields<N> {
    fn new(node: NodeFn<N>) -> Self {
        Self {
            node,
            id: None,
            row: false,
            gap: 0,
            padding: (0, 0),
            justify: abi::Justify::default(),
            align: abi::Align::default(),
            bg: None,
            layout: abi::Layout::default(),
            on_click: None,
            children: Vec::new(),
            border: None,
            padding_sides: None,
            wrap: false,
            overflow: abi::Overflow::default(),
            sticky: None,
            anchor: None,
            split: None,
            visible: true,
        }
    }

    /// The key `name` of a box of contract 2.0, its value at `at`.
    ///
    /// # Safety
    /// As for [`Decode::top`].
    unsafe fn read(
        &mut self,
        decode: &mut Decode,
        state: *mut ffi::lua_State,
        name: &[u8],
        at: c_int,
        depth: usize,
    ) -> Result<(), Slow> {
        let (own, depth) = (depth, depth + 1);
        // SAFETY: as the caller's.
        unsafe {
            match name {
                b"type" => drop(decode.word(state, at)?),
                b"row" => self.row = decode.boolean(state, at)?,
                b"gap" => self.gap = decode.small(state, at)?,
                b"padding" => self.padding = decode.serde(state, at, depth)?,
                b"justify" => self.justify = decode.serde(state, at, depth)?,
                b"align" => self.align = decode.serde(state, at, depth)?,
                b"bg" => self.bg = decode.color(state, at)?,
                b"layout" => self.layout = decode.serde(state, at, depth)?,
                b"on_click" => self.on_click = decode.click(state, at, depth)?,
                b"children" => self.children = decode.children(state, at, own, self.node)?,
                b"border" => self.border = decode.serde(state, at, depth)?,
                b"padding_sides" => self.padding_sides = decode.serde(state, at, depth)?,
                b"wrap" => self.wrap = decode.boolean(state, at)?,
                b"overflow" => self.overflow = decode.serde(state, at, depth)?,
                _ => return Err(Slow::Serde),
            }
        }
        Ok(())
    }

    /// The key `name` of a surface's box, its value at `at`.
    ///
    /// # Safety
    /// As for [`Decode::top`].
    unsafe fn read2(
        &mut self,
        decode: &mut Decode,
        state: *mut ffi::lua_State,
        name: &[u8],
        at: c_int,
        depth: usize,
    ) -> Result<(), Slow> {
        // SAFETY: as the caller's.
        unsafe {
            match name {
                b"id" => self.id = Some(decode.string(state, at)?),
                b"sticky" => self.sticky = decode.serde(state, at, depth + 1)?,
                b"anchor" => self.anchor = decode.serde(state, at, depth + 1)?,
                b"split" => self.split = decode.serde(state, at, depth + 1)?,
                b"visible" => self.visible = decode.boolean(state, at)?,
                name => return self.read(decode, state, name, at, depth),
            }
        }
        Ok(())
    }
}

/// The fields of a text node, as its keys give them; the rest keep their defaults.
struct TextFields {
    id: Option<String>,
    spans: Option<Vec<abi::Span>>,
    fg: Option<abi::Color>,
    wrap: abi::Wrap,
    truncate: bool,
    selectable: bool,
    hover_fg: Option<abi::Color>,
    layout: abi::Layout,
    on_click: Option<abi::Click>,
    hover_events: bool,
}

impl Default for TextFields {
    fn default() -> Self {
        Self {
            id: None,
            spans: None,
            fg: None,
            wrap: abi::Wrap::default(),
            truncate: false,
            selectable: true,
            hover_fg: None,
            layout: abi::Layout::default(),
            on_click: None,
            hover_events: false,
        }
    }
}

impl TextFields {
    /// The key `name` of a text node of contract 2.0, its value at `at`.
    ///
    /// # Safety
    /// As for [`Decode::top`].
    unsafe fn read(
        &mut self,
        decode: &mut Decode,
        state: *mut ffi::lua_State,
        name: &[u8],
        at: c_int,
        depth: usize,
    ) -> Result<(), Slow> {
        let depth = depth + 1;
        // SAFETY: as the caller's.
        unsafe {
            match name {
                b"type" => drop(decode.word(state, at)?),
                b"spans" => self.spans = Some(decode.spans(state, at, depth)?),
                b"fg" => self.fg = decode.color(state, at)?,
                b"wrap" => self.wrap = decode.serde(state, at, depth)?,
                b"truncate" => self.truncate = decode.boolean(state, at)?,
                b"selectable" => self.selectable = decode.boolean(state, at)?,
                b"hover_fg" => self.hover_fg = decode.color(state, at)?,
                b"layout" => self.layout = decode.serde(state, at, depth)?,
                b"on_click" => self.on_click = decode.click(state, at, depth)?,
                _ => return Err(Slow::Serde),
            }
        }
        Ok(())
    }

    /// The key `name` of a surface's text node, its value at `at`.
    ///
    /// # Safety
    /// As for [`Decode::top`].
    unsafe fn read2(
        &mut self,
        decode: &mut Decode,
        state: *mut ffi::lua_State,
        name: &[u8],
        at: c_int,
        depth: usize,
    ) -> Result<(), Slow> {
        // SAFETY: as the caller's.
        unsafe {
            match name {
                b"id" => self.id = Some(decode.string(state, at)?),
                b"hover_events" => self.hover_events = decode.boolean(state, at)?,
                name => return self.read(decode, state, name, at, depth),
            }
        }
        Ok(())
    }
}

/// Serde's own `Deserializer` over one stack slot, `depth` deep.
struct Slot<'d> {
    decode: &'d mut Decode,
    state: *mut ffi::lua_State,
    index: c_int,
    depth: usize,
}

impl Slot<'_> {
    /// Whether the slot holds `nil` or mlua's `null`.
    fn null(&self) -> bool {
        // SAFETY: a slot is a valid absolute slot inside a protected call.
        unsafe {
            match ffi::lua_type(self.state, self.index) {
                ffi::LUA_TNIL => true,
                ffi::LUA_TLIGHTUSERDATA => ffi::lua_touserdata(self.state, self.index).is_null(),
                _ => false,
            }
        }
    }

    /// The table in the slot, entered: a sequence when its keys are `1..n`, a map otherwise.
    fn table<'de, V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, Refused> {
        // SAFETY: as for `null`.
        unsafe {
            self.decode.enter(self.state, self.index, self.depth)?;
            let length = usize::try_from(ffi::lua_objlen_(self.state, self.index)).unwrap_or(0);
            // A table with the object marker (`plugin.json.object`) is an object whatever its keys, an empty one too.
            if !marked_object(self.state, self.index) && {
                // Telling a sequence from a map is a walk of its own.
                self.decode.walk(capacity(self.state, self.index))?;
                is_array(self.state, self.index, length)
            } {
                let Slot { decode, state, index, depth } = self;
                return visitor.visit_seq(Seq { decode, state, index, depth, at: 1, length });
            }
            let Slot { decode, state, index, depth } = self;
            visitor.visit_map(Pairs { decode, state, index, depth, iter: 0 })
        }
    }
}

impl<'de> Deserializer<'de> for Slot<'_> {
    type Error = Refused;

    fn deserialize_any<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, Refused> {
        // SAFETY: as for `null`; a string lives while its slot does.
        unsafe {
            let kind = ffi::lua_type(self.state, self.index);
            if kind == ffi::LUA_TTABLE {
                return self.table(visitor);
            }
            self.decode.charge(1)?;
            match kind {
                ffi::LUA_TNIL => visitor.visit_unit(),
                ffi::LUA_TBOOLEAN => visitor.visit_bool(ffi::lua_toboolean(self.state, self.index) != 0),
                ffi::LUA_TNUMBER => match number(ffi::lua_tonumberx(self.state, self.index, std::ptr::null_mut()))? {
                    Number::Unsigned(value) => visitor.visit_u64(value),
                    Number::Signed(value) => visitor.visit_i64(value),
                    Number::Float(value) => visitor.visit_f64(value),
                },
                ffi::LUA_TSTRING => visitor.visit_str(self.decode.text(raw_bytes(self.state, self.index))?),
                ffi::LUA_TLIGHTUSERDATA if ffi::lua_touserdata(self.state, self.index).is_null() => {
                    visitor.visit_unit()
                }
                _ => Err(Refused::Value(format!("a {} cannot cross to the host", type_name(kind)))),
            }
        }
    }

    fn deserialize_option<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, Refused> {
        if self.null() {
            self.decode.charge(1)?;
            return visitor.visit_none();
        }
        visitor.visit_some(self)
    }

    fn deserialize_newtype_struct<V: Visitor<'de>>(self, _: &'static str, visitor: V) -> Result<V::Value, Refused> {
        visitor.visit_newtype_struct(self)
    }

    /// A string is a unit variant, a table of one key the variant of that name, as `serde_json` reads them.
    fn deserialize_enum<V: Visitor<'de>>(
        self,
        _: &'static str,
        _: &'static [&'static str],
        visitor: V,
    ) -> Result<V::Value, Refused> {
        // SAFETY: as for `null`; the pair stays on the stack while the variant is read, and is popped after.
        unsafe {
            match ffi::lua_type(self.state, self.index) {
                ffi::LUA_TSTRING => {
                    self.decode.charge(1)?;
                    let name = self.decode.text(raw_bytes(self.state, self.index))?;
                    visitor.visit_enum(<&str as IntoDeserializer<'de, Refused>>::into_deserializer(name))
                }
                ffi::LUA_TTABLE => {
                    self.decode.enter(self.state, self.index, self.depth)?;
                    let refused = || de::Error::invalid_value(de::Unexpected::Map, &"a table of one key");
                    let iter = ffi::lua_rawiter(self.state, self.index, 0);
                    if iter < 0 {
                        return Err(refused());
                    }
                    if ffi::lua_rawiter(self.state, self.index, iter) >= 0 {
                        ffi::lua_pop(self.state, 4);
                        return Err(refused());
                    }
                    let top = ffi::lua_gettop(self.state);
                    let Slot { decode, state, depth, .. } = self;
                    let variant = visitor.visit_enum(Variant { decode, state, key: top - 1, depth });
                    ffi::lua_pop(state, 2);
                    variant
                }
                _ => self.deserialize_any(visitor),
            }
        }
    }

    serde::forward_to_deserialize_any! {
        bool i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 f32 f64 char str string bytes byte_buf unit unit_struct seq tuple
        tuple_struct map struct identifier ignored_any
    }
}

/// A table's items `1..=length`, by index.
struct Seq<'d> {
    decode: &'d mut Decode,
    state: *mut ffi::lua_State,
    index: c_int,
    depth: usize,
    at: usize,
    length: usize,
}

impl<'de> de::SeqAccess<'de> for Seq<'_> {
    type Error = Refused;

    fn next_element_seed<T: DeserializeSeed<'de>>(&mut self, seed: T) -> Result<Option<T::Value>, Refused> {
        if self.at > self.length {
            return Ok(None);
        }
        // SAFETY: the table is at `index`, with room for one more slot, which is popped after.
        unsafe {
            ffi::lua_rawgeti_(self.state, self.index, self.at as _);
            let top = ffi::lua_gettop(self.state);
            let item =
                seed.deserialize(Slot { decode: self.decode, state: self.state, index: top, depth: self.depth + 1 });
            ffi::lua_pop(self.state, 1);
            self.at += 1;
            item.map(Some)
        }
    }

    fn size_hint(&self) -> Option<usize> {
        Some(self.length + 1 - self.at)
    }
}

/// A table's pairs, as `lua_rawiter` gives them: the pair stays on the stack from its key until its value is read.
struct Pairs<'d> {
    decode: &'d mut Decode,
    state: *mut ffi::lua_State,
    index: c_int,
    depth: usize,
    iter: c_int,
}

impl<'de> de::MapAccess<'de> for Pairs<'_> {
    type Error = Refused;

    fn next_key_seed<K: DeserializeSeed<'de>>(&mut self, seed: K) -> Result<Option<K::Value>, Refused> {
        // SAFETY: the table is at `index`, with room for a pair, which `next_value_seed` pops, or this on an error.
        unsafe {
            self.iter = ffi::lua_rawiter(self.state, self.index, self.iter);
            if self.iter < 0 {
                return Ok(None);
            }
            let key = ffi::lua_gettop(self.state) - 1;
            let read = seed.deserialize(Key { decode: self.decode, state: self.state, index: key });
            if read.is_err() {
                ffi::lua_pop(self.state, 2);
            }
            read.map(Some)
        }
    }

    fn next_value_seed<V: DeserializeSeed<'de>>(&mut self, seed: V) -> Result<V::Value, Refused> {
        // SAFETY: the pair `next_key_seed` pushed is on top, and is popped here.
        unsafe {
            let top = ffi::lua_gettop(self.state);
            let value =
                seed.deserialize(Slot { decode: self.decode, state: self.state, index: top, depth: self.depth + 1 });
            ffi::lua_pop(self.state, 2);
            value
        }
    }
}

/// The variant of a table of one key: the key names it, the value is its content.
struct Variant<'d> {
    decode: &'d mut Decode,
    state: *mut ffi::lua_State,
    key: c_int,
    depth: usize,
}

impl<'de, 'd> de::EnumAccess<'de> for Variant<'d> {
    type Error = Refused;
    type Variant = Slot<'d>;

    fn variant_seed<V: DeserializeSeed<'de>>(self, seed: V) -> Result<(V::Value, Slot<'d>), Refused> {
        let name = seed.deserialize(Key { decode: self.decode, state: self.state, index: self.key })?;
        Ok((name, Slot { decode: self.decode, state: self.state, index: self.key + 1, depth: self.depth + 1 }))
    }
}

impl<'de> de::VariantAccess<'de> for Slot<'_> {
    type Error = Refused;

    fn unit_variant(self) -> Result<(), Refused> {
        de::Deserialize::deserialize(self)
    }

    fn newtype_variant_seed<T: DeserializeSeed<'de>>(self, seed: T) -> Result<T::Value, Refused> {
        seed.deserialize(self)
    }

    fn tuple_variant<V: Visitor<'de>>(self, _: usize, visitor: V) -> Result<V::Value, Refused> {
        self.deserialize_any(visitor)
    }

    fn struct_variant<V: Visitor<'de>>(self, _: &'static [&'static str], visitor: V) -> Result<V::Value, Refused> {
        self.deserialize_any(visitor)
    }
}

/// A key: a string as it is, a number as its text, as JSON's object keys are.
struct Key<'d> {
    decode: &'d mut Decode,
    state: *mut ffi::lua_State,
    index: c_int,
}

impl<'de> Deserializer<'de> for Key<'_> {
    type Error = Refused;

    fn deserialize_any<V: Visitor<'de>>(self, visitor: V) -> Result<V::Value, Refused> {
        // SAFETY: the key is at `index`, and lives while its table does.
        unsafe {
            match ffi::lua_type(self.state, self.index) {
                ffi::LUA_TSTRING => visitor.visit_str(self.decode.key(raw_bytes(self.state, self.index))?),
                ffi::LUA_TNUMBER => {
                    let number = ffi::lua_tonumberx(self.state, self.index, std::ptr::null_mut());
                    let name = match number.fract() == 0.0 {
                        true => (number as i64).to_string(),
                        false => number.to_string(),
                    };
                    self.decode.charge_bytes(name.len())?;
                    visitor.visit_str(&name)
                }
                kind => Err(Refused::Value(format!("a key of type {}", type_name(kind)))),
            }
        }
    }

    serde::forward_to_deserialize_any! {
        bool i8 i16 i32 i64 i128 u8 u16 u32 u64 u128 f32 f64 char str string bytes byte_buf option unit unit_struct
        newtype_struct seq tuple tuple_struct map struct enum identifier ignored_any
    }
}

/// A table at `index`, or serde's to judge.
///
/// # Safety
/// `index` is a valid slot of `state`.
unsafe fn table(state: *mut ffi::lua_State, index: c_int) -> Result<(), Slow> {
    // SAFETY: as documented.
    match unsafe { ffi::lua_type(state, index) } {
        ffi::LUA_TTABLE => Ok(()),
        _ => Err(Slow::Serde),
    }
}

/// The `type` of the table at `index`, when it is a string.
///
/// # Safety
/// `index` is a valid absolute slot of `state` that holds a table, with room for one more slot.
unsafe fn kind<'a>(state: *mut ffi::lua_State, index: c_int) -> Option<&'a [u8]> {
    // SAFETY: as documented; the slot pushed is popped, and the string lives on in the table.
    unsafe {
        let kind =
            (ffi::lua_rawgetfield(state, index, c"type".as_ptr()) == ffi::LUA_TSTRING).then(|| raw_bytes(state, -1));
        ffi::lua_pop(state, 1);
        kind
    }
}

/// Whether the table at `index`, of border `length`, is a sequence: every key a whole number in `1..=length` (a hole
/// is `null`), as the walk to JSON took one.
///
/// # Safety
/// `index` is a valid absolute slot of `state` that holds a table, with room for a pair.
unsafe fn is_array(state: *mut ffi::lua_State, index: c_int, length: usize) -> bool {
    // SAFETY: as documented; each pair is popped before the next.
    unsafe {
        let mut iter = 0;
        loop {
            iter = ffi::lua_rawiter(state, index, iter);
            if iter < 0 {
                return true;
            }
            let item = ffi::lua_type(state, -2) == ffi::LUA_TNUMBER && {
                let key = ffi::lua_tonumberx(state, -2, std::ptr::null_mut());
                key.fract() == 0.0 && key >= 1.0 && key <= length as f64
            };
            ffi::lua_pop(state, 2);
            if !item {
                return false;
            }
        }
    }
}

/// How many slots the table at `index` has, empty ones too: its array part and its hash part, which `lua_rawiter`
/// scans in full. Luau's API gives no count of them, so they are read from the table's header (`LuaTable` of
/// `VM/src/lobject.h`, Luau 747): `lsizenode` at byte 6, `sizearray` at byte 8. A test holds the read to tables of
/// known sizes (`luau::tests::a_tables_slots_are_read_from_its_header`).
///
/// # Safety
/// `index` is a valid slot of `state` that holds a table.
pub(crate) unsafe fn capacity(state: *mut ffi::lua_State, index: c_int) -> u64 {
    // SAFETY: as documented: a table's pointer is its `LuaTable`, whose header holds these fields.
    unsafe {
        let table = ffi::lua_topointer(state, index).cast::<u8>();
        let lsizenode = table.add(6).read();
        let sizearray = table.add(8).cast::<i32>().read_unaligned();
        u64::try_from(sizearray).unwrap_or(0) + (1u64 << lsizenode.min(31))
    }
}

/// The slots of table `table` of VM `lua` ([`capacity`]).
#[cfg(test)]
pub(crate) fn slots(lua: &Lua, table: &mlua::Table) -> u64 {
    let mut slots = 0;
    // SAFETY: `exec_raw` pushes the table and runs the closure in protected mode with it at the top.
    let read = unsafe { lua.exec_raw::<()>(table, |state| slots = capacity(state, ffi::lua_gettop(state))) };
    read.map(|()| slots).unwrap_or(0)
}

/// Whether the table at `index` carries the object marker ([`super::json::OBJECT`]).
///
/// # Safety
/// `index` is a valid absolute slot of `state` that holds a table, with room for two more slots.
unsafe fn marked_object(state: *mut ffi::lua_State, index: c_int) -> bool {
    // SAFETY: as documented; what is pushed is popped.
    unsafe {
        if ffi::lua_getmetatable(state, index) == 0 {
            return false;
        }
        let object = ffi::lua_rawgetfield(state, -1, super::json::MARK.as_ptr()) == ffi::LUA_TSTRING
            && raw_bytes(state, -1) == b"object";
        ffi::lua_pop(state, 2);
        object
    }
}

enum Number {
    Unsigned(u64),
    Signed(i64),
    Float(f64),
}

/// A Luau number as JSON has it: whole numbers as integers, as mlua reads them.
fn number(value: f64) -> Result<Number, Refused> {
    if value.fract() == 0.0 && value.abs() < 9_007_199_254_740_992.0 {
        return Ok(match value >= 0.0 {
            true => Number::Unsigned(value as u64),
            false => Number::Signed(value as i64),
        });
    }
    match value.is_finite() {
        true => Ok(Number::Float(value)),
        false => Err(Refused::Value(format!("{value} is not a finite number"))),
    }
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

/// The capacity of a `Vec` for the array at `index`: its length, up to [`ITEMS_AHEAD`].
///
/// # Safety
/// `index` is a valid slot of `state`.
unsafe fn length(state: *mut ffi::lua_State, index: c_int) -> usize {
    // SAFETY: as documented. Only a table's: `lua_objlen` makes a number on the stack a string.
    unsafe {
        if ffi::lua_type(state, index) != ffi::LUA_TTABLE {
            return 0;
        }
        usize::try_from(ffi::lua_objlen_(state, index)).unwrap_or(0).min(ITEMS_AHEAD)
    }
}

/// `bytes` as UTF-8: most text a plugin returns is ASCII, which `is_ascii` reads a word at a time.
fn utf8(bytes: &[u8]) -> Option<&str> {
    if bytes.is_ascii() {
        // SAFETY: ASCII is UTF-8.
        return Some(unsafe { std::str::from_utf8_unchecked(bytes) });
    }
    std::str::from_utf8(bytes).ok()
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
