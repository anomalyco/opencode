//! Native tree building (`widgets.md`, Native hosts, protocol 2): the view as the program built it (handlers as
//! function markers, `key`s, children as written) walked while it is encoded, into the bytes of exactly the tree the
//! prelude's `__widget_tree` makes, with its handler ids and canvases by key. The walk checks Keys and depth and the
//! function rule as it goes.

use std::borrow::Cow;
use std::collections::HashMap;
use std::fmt::Write as _;

use psychoscript::HostValue;

use crate::encode::{Streams, field, json_value, prop, write_node};
use crate::schema::{K_INT, K_STR, T_UNKNOWN, is_container, type_id};

/// The most levels a view nests (`widgets.md`, Keys and depth).
pub const LEVELS: usize = 100;
/// The failures of a view that breaks Keys and depth: program errors in phase `view`.
pub const DEEP: &str = "The view nests more than 100 levels";
pub const KEY: &str = "A node's key must be a string, a number or a boolean";

/// What a walk found besides the bytes.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Found {
    /// Each id given a handler, with its event (`press`, `change`, `pointer`), in walk order; a later one with the
    /// same id takes its place.
    pub handlers: Vec<(String, &'static str)>,
    /// Each keyed canvas, the first by its key (`String(key)`): its key, id and whether it has `wgsl` or `gpu: true`.
    pub canvases: Vec<Canvas>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Canvas {
    pub key: String,
    pub id: String,
    pub wgsl: bool,
    /// A GPU canvas (`gpu: true`, `widgets-gpu.md`).
    pub gpu: bool,
}

/// Why a walk stopped.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Stop {
    /// The view breaks Keys and depth (`KEY`, `DEEP`).
    View(&'static str),
    /// A function where none may go: the call fails with the runtime's `TypeError`.
    Function,
    /// A key `encodeURIComponent` can't write (a lone surrogate): the prelude's `URIError`.
    Uri,
}

struct Control {
    handler: &'static str,
    event: &'static str,
    always: bool,
    canvas: bool,
}

fn control(ty: &str) -> Option<Control> {
    let (handler, event, always, canvas) = match ty {
        "button" => ("onPress", "press", true, false),
        "card" => ("onPress", "press", false, false),
        "checkbox" | "slider" | "select" | "input" => ("onChange", "change", true, false),
        "carousel" => ("onChange", "change", false, false),
        "canvas" => ("onPointer", "pointer", false, true),
        _ => return None,
    };
    Some(Control {
        handler,
        event,
        always,
        canvas,
    })
}

fn handler_prop(k: &str) -> bool {
    matches!(k, "onPress" | "onChange" | "onPointer")
}

/// Whether `v` holds a function marker anywhere.
pub(crate) fn marked(v: &HostValue) -> bool {
    match v {
        HostValue::FunctionMarker => true,
        HostValue::Array(items) => items.iter().flatten().any(marked),
        HostValue::Object(fields) => fields.iter().any(|(_, v)| marked(v)),
        _ => false,
    }
}

/// An object as JavaScript sees one (`typeof v === "object"`, not `null`): the walk's nodes and arrays.
fn object_like(v: &HostValue) -> bool {
    !matches!(
        v,
        HostValue::Undefined
            | HostValue::Null
            | HostValue::Bool(_)
            | HostValue::Number(_)
            | HostValue::String(_)
            | HostValue::FunctionMarker
    )
}

/// A node's `key`: `None` when absent, `undefined` or `null`; a string, a number or a boolean; else the view fails.
fn key(v: &HostValue) -> Result<Option<&HostValue>, Stop> {
    match v.get("key") {
        None | Some(HostValue::Undefined | HostValue::Null) => Ok(None),
        Some(k @ (HostValue::String(_) | HostValue::Number(_) | HostValue::Bool(_))) => Ok(Some(k)),
        Some(_) => Err(Stop::View(KEY)),
    }
}

/// `String(key)`.
pub(crate) fn key_string(k: &HostValue) -> Cow<'_, str> {
    match k {
        HostValue::String(s) => s.to_string_lossy(),
        HostValue::Number(n) => Cow::Owned(js_number(*n)),
        HostValue::Bool(b) => Cow::Borrowed(if *b { "true" } else { "false" }),
        _ => Cow::Borrowed(""),
    }
}

/// `":" + encodeURIComponent(String(key))`.
fn segment(k: &HostValue) -> Result<String, Stop> {
    if let HostValue::String(s) = k
        && s.as_str().is_none()
    {
        return Err(Stop::Uri);
    }
    let text = key_string(k);
    let mut out = String::with_capacity(text.len() + 1);
    out.push(':');
    for b in text.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) {
            out.push(b as char);
        } else {
            let _ = write!(out, "%{b:02X}");
        }
    }
    Ok(out)
}

/// ECMAScript `Number::toString` (radix 10): the shortest digits that round-trip, in its notation.
pub(crate) fn js_number(x: f64) -> String {
    if x.is_nan() {
        return "NaN".into();
    }
    if x == 0.0 {
        return "0".into();
    }
    if x.is_infinite() {
        return if x > 0.0 { "Infinity" } else { "-Infinity" }.into();
    }
    let sci = format!("{:e}", x.abs());
    let (mantissa, exp) = sci.split_once('e').unwrap_or((&sci, "0"));
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let (k, n) = (digits.len() as i32, exp.parse::<i32>().unwrap_or(0) + 1);
    let mut out = String::with_capacity(k as usize + 8);
    if x < 0.0 {
        out.push('-');
    }
    if k <= n && n <= 21 {
        out.push_str(&digits);
        (0..n - k).for_each(|_| out.push('0'));
    } else if 0 < n && n <= 21 {
        out.push_str(&digits[..n as usize]);
        out.push('.');
        out.push_str(&digits[n as usize..]);
    } else if -6 < n && n <= 0 {
        out.push_str("0.");
        (0..-n).for_each(|_| out.push('0'));
        out.push_str(&digits);
    } else {
        out.push_str(&digits[..1]);
        if k > 1 {
            out.push('.');
            out.push_str(&digits[1..]);
        }
        let _ = write!(out, "e{}{}", if n > 0 { "+" } else { "-" }, (n - 1).abs());
    }
    out
}

/// What JavaScript skips among children: a hole, `undefined`, `null`, `false`, `0`, `-0`, `NaN`, `""`; and what goes
/// out as JSON's `null`, which clients drop too: `±Infinity`.
fn falsy(item: Option<&HostValue>) -> bool {
    match item {
        None | Some(HostValue::Undefined | HostValue::Null | HostValue::Bool(false)) => true,
        Some(HostValue::Number(n)) => *n == 0.0 || !n.is_finite(),
        Some(HostValue::String(s)) => s.as_str() == Some(""),
        _ => false,
    }
}

/// Walks `root` (writing its bytes into `s`, when given) and returns what it found.
pub(crate) fn walk(s: Option<&mut Streams>, root: &HostValue) -> Result<Found, Stop> {
    let mut walk = Walk {
        path: String::new(),
        found: Found::default(),
    };
    if !object_like(root) || matches!(root, HostValue::Array(_)) {
        // Not a node: as JSON holds it.
        if marked(root) {
            return Err(Stop::Function);
        }
        if let Some(s) = s {
            write_node(s, &json_value(root), 0).map_err(|_| Stop::View(DEEP))?;
        }
        return Ok(walk.found);
    }
    walk.path = match key(root)? {
        Some(k) => segment(k)?,
        None => "0".into(),
    };
    walk.node(s, root, 1)?;
    Ok(walk.found)
}

struct Walk {
    /// The current node's path.
    path: String,
    found: Found,
}

/// A node's children: a list, or one value that isn't.
#[derive(Clone, Copy)]
enum Items<'a> {
    Many(&'a [Option<HostValue>]),
    One(&'a HostValue),
}

impl<'a> Items<'a> {
    /// Each item with its index (a hole as `None`).
    fn iter(self) -> impl Iterator<Item = (usize, Option<&'a HostValue>)> {
        let (many, one) = match self {
            Items::Many(items) => (items, None),
            Items::One(v) => (&[][..], Some(v)),
        };
        many.iter()
            .map(Option::as_ref)
            .chain(one.map(Some))
            .enumerate()
    }
}

impl Walk {
    /// A node (an object) at `level`, its key already checked.
    fn node(&mut self, s: Option<&mut Streams>, v: &HostValue, level: usize) -> Result<(), Stop> {
        let fields: &[(psychoscript::HostString, HostValue)] = match v {
            HostValue::Object(fields) => fields,
            // Another kind of object (a Date, a Set...): a node with no props.
            _ => &[],
        };
        let name = match field(v, "type") {
            Some(HostValue::String(t)) => t.to_string_lossy(),
            _ => Cow::Borrowed(""),
        };
        let t = type_id(&name);
        let mut s = s;
        if let Some(s) = s.as_deref_mut() {
            s.int(t);
            if t == T_UNKNOWN {
                s.int(0);
                s.str(&name);
            }
        }
        // A type the encoder doesn't know writes no props or children, but its subtree still counts.
        let mut props = match s {
            Some(s) if t != T_UNKNOWN => Some(s),
            _ => None,
        };
        for (k, pv) in fields {
            let Some(k) = k.as_str() else {
                if marked(pv) {
                    return Err(Stop::Function);
                }
                continue;
            };
            if k == "children" || handler_prop(k) {
                continue;
            }
            if marked(pv) {
                return Err(Stop::Function);
            }
            if let Some(st) = props.as_deref_mut()
                && !matches!(k, "type" | "key" | "id" | "pointer")
            {
                prop(st, k, &json_value(pv));
            }
        }
        if let Some(c) = control(&name) {
            let handled = matches!(field(v, c.handler), Some(HostValue::FunctionMarker));
            let keyed = if c.canvas { key(v)? } else { None };
            if handled || c.always || keyed.is_some() {
                if let Some(st) = props.as_deref_mut() {
                    st.tag(10, K_STR);
                    st.str(&self.path);
                    if c.canvas && handled {
                        st.tag(35, K_INT);
                        st.int(1);
                    }
                }
                if handled {
                    self.found.handlers.push((self.path.clone(), c.event));
                }
                if let Some(k) = keyed {
                    let k = key_string(k);
                    if !self.found.canvases.iter().any(|c| c.key == k) {
                        self.found.canvases.push(Canvas {
                            key: k.into_owned(),
                            id: self.path.clone(),
                            wgsl: matches!(field(v, "wgsl"), Some(HostValue::String(_))),
                            gpu: matches!(field(v, "gpu"), Some(HostValue::Bool(true))),
                        });
                    }
                }
            }
        }
        if let Some(st) = props.as_deref_mut() {
            st.int(0);
        }
        let st = props.filter(|_| is_container(t));
        let items = match field(v, "children") {
            None => {
                if let Some(st) = st {
                    st.int(0);
                }
                return Ok(());
            }
            Some(HostValue::Array(items)) => Items::Many(items),
            Some(one) => Items::One(one),
        };
        let st = match st {
            Some(st) => {
                st.int(count(items));
                Some(st)
            }
            None => None,
        };
        let mut prefix = String::new();
        let mut seen = HashMap::new();
        self.items(st, items, &mut prefix, &mut seen, level + 1)
    }

    /// The items of a node's `children` (or of an array in them) at `level`.
    fn items(
        &mut self,
        mut s: Option<&mut Streams>,
        items: Items,
        prefix: &mut String,
        seen: &mut HashMap<String, u32>,
        level: usize,
    ) -> Result<(), Stop> {
        for (i, item) in items.iter() {
            if falsy(item) {
                continue;
            }
            let Some(item) = item else { continue };
            if level > LEVELS && object_like(item) {
                return Err(Stop::View(DEEP));
            }
            match item {
                HostValue::Array(nested) => {
                    let len = prefix.len();
                    let _ = write!(prefix, "{i}.");
                    self.items(
                        s.as_deref_mut(),
                        Items::Many(nested),
                        prefix,
                        seen,
                        level + 1,
                    )?;
                    prefix.truncate(len);
                }
                HostValue::FunctionMarker => return Err(Stop::Function),
                child if object_like(child) => {
                    let k = key(child)?;
                    let len = self.path.len();
                    self.path.push('/');
                    match k {
                        Some(k) => {
                            let seg = segment(k)?;
                            let n = seen.entry(seg.clone()).or_insert(0);
                            *n += 1;
                            self.path.push_str(&seg);
                            if *n > 1 {
                                let _ = write!(self.path, "~{n}");
                            }
                        }
                        None => {
                            self.path.push_str(prefix);
                            let _ = write!(self.path, "{i}");
                        }
                    }
                    self.node(s.as_deref_mut(), child, level)?;
                    self.path.truncate(len);
                }
                // A string, a number, `true`: as it is.
                v => {
                    if let Some(s) = s.as_deref_mut() {
                        write_node(s, v, 0).map_err(|_| Stop::View(DEEP))?;
                    }
                }
            }
        }
        Ok(())
    }
}

/// How many children go out: every item not skipped, an array's in its place.
fn count(items: Items) -> u32 {
    let mut n = 0;
    for (_, item) in items.iter() {
        match item {
            _ if falsy(item) => {}
            Some(HostValue::Array(nested)) => n += count(Items::Many(nested)),
            _ => n += 1,
        }
    }
    n
}
