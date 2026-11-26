//! Building the view tree clients get, natively (widgets.md, "Native hosts"): from a view as the program built it
//! (handler props as function markers, `key`s, `children` as written) straight to the wire JSON, while writing it. It
//! makes exactly what the prelude's `__widget_tree` makes: props in order without `key`, `id`, `pointer`, `onPress`,
//! `onChange`, `onPointer` and `children`; then `id` (the node's path) on controls, `pointer: true` on a canvas with a
//! handler, and `children` last, flattened. It also tells which ids have handlers and the canvas ids by key.
//!
//! It holds views to the rules of views (widgets.md, "Keys and depth"): a key is a string, a number or a boolean, and
//! a view nests at most [`LEVELS`] levels. A function anywhere but a node's handler props fails, as it fails a host
//! call's argument without `"mark"`.
//!
//! The walk is generic over the value it reads ([`View`]): a host call's argument ([`HostValue`]), or JSON in tests.
//! Numbers and strings are written as `JSON.stringify` writes them.

use std::borrow::Cow;
use std::collections::HashMap;
use std::fmt::Write as _;

use psychoscript::{HostString, HostValue};

/// The most levels a view nests (widgets.md, "Keys and depth").
pub const LEVELS: u32 = 100;
/// The failure of a view deeper than [`LEVELS`].
pub const DEEP: &str = "The view nests more than 100 levels";
/// The failure of a view with a key of another type.
pub const KEY: &str = "A node's key must be a string, a number or a boolean";

/// What a value is, as far as the walk cares.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// `undefined`, or a hole: falsy, left out of an object, `null` in an array.
    Undefined,
    /// A program function (the function marker): only a node's handler prop may hold one, which makes the node's id a
    /// handler's.
    Function,
    Null,
    Bool,
    Number,
    String,
    Array,
    Object,
    /// Another object (a `Date`, a `Map`, ...): written as JSON writes it ([`View::write_other`]).
    Other,
}

/// A string as the walk reads it: UTF-8, or UTF-16 code units when it has an unpaired surrogate.
pub enum Text<'a> {
    Str(&'a str),
    Units(Cow<'a, [u16]>),
}

/// A value the walk can read.
pub trait View: Sized {
    fn kind(&self) -> Kind;
    fn boolean(&self) -> bool;
    fn number(&self) -> f64;
    fn text(&self) -> Text<'_>;
    /// An array's items in order; `None` for a hole.
    fn items(&self) -> impl Iterator<Item = Option<&Self>>;
    /// An object's props in order.
    fn props(&self) -> impl Iterator<Item = (Text<'_>, &Self)>;
    /// An object's prop by name.
    fn get(&self, name: &str) -> Option<&Self>;
    /// A [`Kind::Other`] value as JSON.
    fn write_other(&self, out: &mut String) {
        out.push_str("null");
    }
}

/// The controls (widgets.md, Events): handler prop, event, whether it always has an id, whether a `key` gives one.
fn control(kind: &str) -> Option<(&'static str, &'static str, bool, bool)> {
    Some(match kind {
        "button" => ("onPress", "press", true, false),
        "card" => ("onPress", "press", false, false),
        "checkbox" => ("onChange", "change", true, false),
        "slider" => ("onChange", "change", true, false),
        "select" => ("onChange", "change", true, false),
        "input" => ("onChange", "change", true, false),
        "carousel" => ("onChange", "change", false, false),
        "canvas" => ("onPointer", "pointer", false, true),
        _ => return None,
    })
}

const HANDLERS: [&str; 3] = ["onPress", "onChange", "onPointer"];

/// What the walk learned of a view besides its JSON.
#[derive(Debug, Default)]
pub struct Tree {
    /// Some id has a handler.
    pub has_handlers: bool,
    /// The ids with handlers and their events, in the order met (a later node with the same id overrides), when asked
    /// for ([`Walk::handlers`]).
    pub handlers: Option<Vec<(String, &'static str)>>,
    /// The first canvas with each `String(key)`: its id and how it is drawn.
    pub canvases: HashMap<String, (String, Drawn)>,
}

/// How a canvas is drawn (widgets.md, Canvas; widgets-gpu.md): one way only.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Drawn {
    /// By draw commands.
    Commands,
    /// By its `wgsl`.
    Wgsl,
    /// By the program's WebGPU calls (`gpu: true`).
    Gpu,
}

/// Why a view didn't walk.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WalkError {
    /// It breaks a rule of views ([`KEY`], [`DEEP`]): a program error in phase `view`.
    View(&'static str),
    /// A function where none may go: the host call fails with the runtime's `TypeError`.
    Function,
    /// A key `encodeURIComponent` can't encode (a lone surrogate): the prelude's `URIError`.
    Uri,
}

/// One walk of one view.
pub struct Walk {
    tree: Tree,
    path: String,
}

impl Walk {
    pub fn new() -> Self {
        Walk {
            tree: Tree::default(),
            path: String::with_capacity(64),
        }
    }

    /// Also collect every handler id with its event (for tests; a host only needs [`Tree::has_handlers`]).
    pub fn handlers(mut self) -> Self {
        self.tree.handlers = Some(Vec::new());
        self
    }

    /// Writes the wire JSON of view `root` to `out`, and returns what it learned. `out` holds part of it on an error.
    pub fn run<V: View>(mut self, root: &V, out: &mut String) -> Result<Tree, WalkError> {
        self.path.clear();
        if root.kind() != Kind::Object {
            write_json(root, out)?;
            return Ok(self.tree);
        }
        match root.get("key") {
            Some(key) if keyed(key)? => segment(key, &mut self.path)?,
            _ => self.path.push('0'),
        }
        self.node(root, 1, out)?;
        Ok(self.tree)
    }

    /// Node `v` at `self.path`, at `level`, its key checked.
    fn node<V: View>(&mut self, v: &V, level: u32, out: &mut String) -> Result<(), WalkError> {
        out.push('{');
        let mut first = true;
        let mut kind = None;
        let mut children = None;
        for (text, prop) in v.props() {
            let name = match &text {
                Text::Str(s) => Some(*s),
                Text::Units(_) => None,
            };
            match name {
                Some("type") if prop.kind() == Kind::String => {
                    if let Text::Str(s) = prop.text() {
                        kind = control(s).map(|c| (s == "canvas", c));
                    }
                }
                Some("children") => {
                    children = Some(prop);
                    continue;
                }
                Some(n) if HANDLERS.contains(&n) => continue,
                Some("key" | "id" | "pointer") => {
                    if carries_function(prop) {
                        return Err(WalkError::Function);
                    }
                    continue;
                }
                _ => {}
            }
            match prop.kind() {
                Kind::Undefined => continue,
                Kind::Function => return Err(WalkError::Function),
                _ => {}
            }
            if !first {
                out.push(',');
            }
            first = false;
            write_text(&text, out);
            out.push(':');
            write_json(prop, out)?;
        }
        if let Some((canvas, (handler, event, always, by_key))) = kind {
            let handled = v.get(handler).is_some_and(|h| h.kind() == Kind::Function);
            let key = if by_key {
                v.get("key")
                    .filter(|k| !matches!(k.kind(), Kind::Undefined | Kind::Null))
            } else {
                None
            };
            if handled || always || key.is_some() {
                if !first {
                    out.push(',');
                }
                first = false;
                // A path is ASCII without quotes or backslashes: `0`, `/`, digits, `.`, `~` and encoded keys.
                out.push_str("\"id\":\"");
                out.push_str(&self.path);
                out.push('"');
                if handled {
                    self.tree.has_handlers = true;
                    if let Some(list) = &mut self.tree.handlers {
                        list.push((self.path.clone(), event));
                    }
                    if canvas {
                        out.push_str(",\"pointer\":true");
                    }
                }
                if let Some(key) = key {
                    let name = string_of(key);
                    if !self.tree.canvases.contains_key(&name) {
                        let drawn = if v.get("wgsl").is_some_and(|w| w.kind() == Kind::String) {
                            Drawn::Wgsl
                        } else if v
                            .get("gpu")
                            .is_some_and(|g| g.kind() == Kind::Bool && g.boolean())
                        {
                            Drawn::Gpu
                        } else {
                            Drawn::Commands
                        };
                        self.tree.canvases.insert(name, (self.path.clone(), drawn));
                    }
                }
            }
        }
        if let Some(list) = children.filter(|c| c.kind() != Kind::Undefined) {
            if !first {
                out.push(',');
            }
            out.push_str("\"children\":[");
            let mut seen: HashMap<String, u32> = HashMap::new();
            let mut any = false;
            if list.kind() == Kind::Array {
                self.flatten(list, "", level + 1, out, &mut seen, &mut any)?;
            } else {
                self.item(list, "0", level + 1, out, &mut seen, &mut any)?;
            }
            out.push(']');
        }
        out.push('}');
        Ok(())
    }

    /// An array of children at `prefix` (`""`, `"2."`, `"2.1."`), its items at `level`.
    fn flatten<V: View>(
        &mut self,
        list: &V,
        prefix: &str,
        level: u32,
        out: &mut String,
        seen: &mut HashMap<String, u32>,
        any: &mut bool,
    ) -> Result<(), WalkError> {
        let mut index = String::new();
        for (i, item) in list.items().enumerate() {
            let Some(item) = item else { continue };
            index.clear();
            index.push_str(prefix);
            let _ = write!(index, "{i}");
            self.item(item, &index, level, out, seen, any)?;
        }
        Ok(())
    }

    /// One item among a node's children, at `index` and `level`: skipped when falsy, flattened when an array.
    fn item<V: View>(
        &mut self,
        item: &V,
        index: &str,
        level: u32,
        out: &mut String,
        seen: &mut HashMap<String, u32>,
        any: &mut bool,
    ) -> Result<(), WalkError> {
        if falsy(item) {
            return Ok(());
        }
        let kind = item.kind();
        if level > LEVELS && matches!(kind, Kind::Array | Kind::Object | Kind::Other) {
            return Err(WalkError::View(DEEP));
        }
        if kind == Kind::Array {
            let mut deeper = String::with_capacity(index.len() + 1);
            deeper.push_str(index);
            deeper.push('.');
            return self.flatten(item, &deeper, level + 1, out, seen, any);
        }
        if *any {
            out.push(',');
        }
        *any = true;
        if kind != Kind::Object {
            // A string, a number, `true`, or another object.
            return write_json(item, out);
        }
        let len = self.path.len();
        self.path.push('/');
        match item.get("key") {
            Some(key) if keyed(key)? => {
                let at = self.path.len();
                segment(key, &mut self.path)?;
                let n = seen.entry(self.path[at..].to_owned()).or_insert(0);
                *n += 1;
                if *n > 1 {
                    let _ = write!(self.path, "~{n}");
                }
            }
            _ => self.path.push_str(index),
        }
        let done = self.node(item, level, out);
        self.path.truncate(len);
        done
    }
}

impl Default for Walk {
    fn default() -> Self {
        Self::new()
    }
}

/// Whether `key` names a node: `undefined` and `null` don't, a string, a number or a boolean does, and anything else
/// fails the view.
fn keyed<V: View>(key: &V) -> Result<bool, WalkError> {
    match key.kind() {
        Kind::Undefined | Kind::Null => Ok(false),
        Kind::String | Kind::Number | Kind::Bool => Ok(true),
        Kind::Function | Kind::Array | Kind::Object | Kind::Other => Err(WalkError::View(KEY)),
    }
}

/// Whether `v` is or holds a function.
fn carries_function<V: View>(v: &V) -> bool {
    match v.kind() {
        Kind::Function => true,
        Kind::Array => v.items().flatten().any(carries_function),
        Kind::Object => v.props().any(|(_, p)| carries_function(p)),
        _ => false,
    }
}

/// JavaScript's truthiness, for children.
fn falsy<V: View>(v: &V) -> bool {
    match v.kind() {
        Kind::Undefined | Kind::Null => true,
        Kind::Bool => !v.boolean(),
        Kind::Number => {
            let n = v.number();
            n == 0.0 || n.is_nan()
        }
        Kind::String => match v.text() {
            Text::Str(s) => s.is_empty(),
            Text::Units(u) => u.is_empty(),
        },
        Kind::Function | Kind::Array | Kind::Object | Kind::Other => false,
    }
}

/// `":" + encodeURIComponent(String(key))` of a key (a string, a number or a boolean), appended to `out`.
fn segment<V: View>(key: &V, out: &mut String) -> Result<(), WalkError> {
    out.push(':');
    match key.kind() {
        Kind::String => match key.text() {
            Text::Str(s) => encode(s, out),
            Text::Units(_) => return Err(WalkError::Uri),
        },
        _ => encode(&string_of(key), out),
    }
    Ok(())
}

/// `String(key)` of a key (a string, a number or a boolean), lossy for a lone surrogate (which `segment` refuses first).
fn string_of<V: View>(v: &V) -> String {
    match v.kind() {
        Kind::String => match v.text() {
            Text::Str(s) => s.to_owned(),
            Text::Units(u) => String::from_utf16_lossy(&u),
        },
        Kind::Number => number(v.number()),
        Kind::Bool => (if v.boolean() { "true" } else { "false" }).to_owned(),
        _ => String::new(),
    }
}

/// ECMAScript `Number::toString`.
fn number(n: f64) -> String {
    let mut buffer = ryu_js::Buffer::new();
    buffer.format(n).to_owned()
}

/// `encodeURIComponent` of well-formed text: UTF-8 bytes percent-encoded, uppercase, except `A-Z a-z 0-9 - _ . ! ~ * ' ( )`.
fn encode(s: &str, out: &mut String) {
    for &b in s.as_bytes() {
        if b.is_ascii_alphanumeric()
            || matches!(
                b,
                b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')'
            )
        {
            out.push(b as char);
        } else {
            let _ = write!(out, "%{b:02X}");
        }
    }
}

/// A value of a view as `JSON.stringify` writes it (`undefined` left out of objects, `null` in arrays, non-finite
/// numbers `null`); a function fails.
fn write_json<V: View>(v: &V, out: &mut String) -> Result<(), WalkError> {
    match v.kind() {
        Kind::Function => return Err(WalkError::Function),
        Kind::Undefined | Kind::Null => out.push_str("null"),
        Kind::Bool => out.push_str(if v.boolean() { "true" } else { "false" }),
        Kind::Number => {
            let n = v.number();
            if n.is_finite() {
                out.push_str(ryu_js::Buffer::new().format_finite(n));
            } else {
                out.push_str("null");
            }
        }
        Kind::String => write_text(&v.text(), out),
        Kind::Other => v.write_other(out),
        Kind::Array => {
            out.push('[');
            for (i, item) in v.items().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                match item {
                    Some(item) => write_json(item, out)?,
                    None => out.push_str("null"),
                }
            }
            out.push(']');
        }
        Kind::Object => {
            out.push('{');
            let mut first = true;
            for (name, prop) in v.props() {
                match prop.kind() {
                    Kind::Undefined => continue,
                    Kind::Function => return Err(WalkError::Function),
                    _ => {}
                }
                if !first {
                    out.push(',');
                }
                first = false;
                write_text(&name, out);
                out.push(':');
                write_json(prop, out)?;
            }
            out.push('}');
        }
    }
    Ok(())
}

fn write_text(t: &Text<'_>, out: &mut String) {
    match t {
        Text::Str(s) => write_str(s, out),
        Text::Units(u) => write_units(u, out),
    }
}

/// A string as `JSON.stringify` quotes it.
fn write_str(s: &str, out: &mut String) {
    out.push('"');
    let mut start = 0;
    for (i, b) in s.bytes().enumerate() {
        let escape = match b {
            b'"' => "\\\"",
            b'\\' => "\\\\",
            b'\n' => "\\n",
            b'\r' => "\\r",
            b'\t' => "\\t",
            0x08 => "\\b",
            0x0c => "\\f",
            0..=0x1f => "",
            _ => continue,
        };
        out.push_str(&s[start..i]);
        if escape.is_empty() {
            let _ = write!(out, "\\u{b:04x}");
        } else {
            out.push_str(escape);
        }
        start = i + 1;
    }
    out.push_str(&s[start..]);
    out.push('"');
}

/// UTF-16 text with unpaired surrogates, as `JSON.stringify` quotes it (`\udxxx` for each lone one).
fn write_units(units: &[u16], out: &mut String) {
    out.push('"');
    for unit in char::decode_utf16(units.iter().copied()) {
        match unit {
            Ok(c) => {
                let mut buf = [0u8; 4];
                let s: &str = c.encode_utf8(&mut buf);
                let mut quoted = String::new();
                write_str(s, &mut quoted);
                out.push_str(&quoted[1..quoted.len() - 1]);
            }
            Err(e) => {
                let _ = write!(out, "\\u{:04x}", e.unpaired_surrogate());
            }
        }
    }
    out.push('"');
}

fn host_text(s: &HostString) -> Text<'_> {
    match s.as_str() {
        Some(s) => Text::Str(s),
        None => Text::Units(s.to_utf16()),
    }
}

impl View for HostValue {
    fn kind(&self) -> Kind {
        match self {
            HostValue::Null => Kind::Null,
            HostValue::Bool(_) => Kind::Bool,
            HostValue::Number(_) => Kind::Number,
            HostValue::String(_) => Kind::String,
            HostValue::Array(_) => Kind::Array,
            HostValue::Object(_) => Kind::Object,
            HostValue::Function(_) | HostValue::FunctionMarker => Kind::Function,
            HostValue::Undefined
            | HostValue::Interrupt
            | HostValue::Durable(_)
            | HostValue::Namespace(_) => Kind::Undefined,
            _ => Kind::Other,
        }
    }
    fn boolean(&self) -> bool {
        matches!(self, HostValue::Bool(true))
    }
    fn number(&self) -> f64 {
        match self {
            HostValue::Number(n) => *n,
            _ => f64::NAN,
        }
    }
    fn text(&self) -> Text<'_> {
        match self {
            HostValue::String(s) => host_text(s),
            _ => Text::Str(""),
        }
    }
    fn items(&self) -> impl Iterator<Item = Option<&Self>> {
        let items: &[Option<HostValue>] = match self {
            HostValue::Array(items) => items,
            _ => &[],
        };
        items.iter().map(Option::as_ref)
    }
    fn props(&self) -> impl Iterator<Item = (Text<'_>, &Self)> {
        let props: &[(HostString, HostValue)] = match self {
            HostValue::Object(props) => props,
            _ => &[],
        };
        props.iter().map(|(k, v)| (host_text(k), v))
    }
    fn get(&self, name: &str) -> Option<&Self> {
        match self {
            HostValue::Object(props) => props.iter().rev().find(|(k, _)| k == name).map(|(_, v)| v),
            _ => None,
        }
    }
    fn write_other(&self, out: &mut String) {
        match self.to_json() {
            Some(json) => {
                let _ = write!(out, "{json}");
            }
            None => out.push_str("null"),
        }
    }
}
