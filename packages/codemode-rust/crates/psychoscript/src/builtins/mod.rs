//! Native built-ins: prototypes, constructors and global functions, created fresh for every run.

pub(crate) mod array;
mod buffer;
pub mod bytes;
pub(crate) mod collections;
pub mod date;
pub mod exotic;
pub(crate) mod fuel;
pub mod iterator;
mod numfmt;
pub(crate) mod object;
pub mod regexp;
mod regexp_syntax;
pub(crate) mod sets;
pub(crate) mod string;
mod uri;
pub mod web;

use crate::object::*;
use crate::value::{Id, Value};
use crate::vm::{NativeFn, Vm};

/// Prototypes of the standard-library kinds beyond the core ones in `Realm`.
#[derive(Default)]
pub struct StdProtos {
    pub regexp: Id,
    pub date: Id,
    pub uint8: Id,
    pub buffer: Id,
    pub text_encoder: Id,
    pub text_decoder: Id,
    pub weak_map: Id,
    pub weak_set: Id,
    pub iterator_helper: Id,
    pub uri_error: Id,
    pub url: Id,
    pub params: Id,
    pub headers: Id,
    /// The lazily installed groups already set up (see `LAZY`).
    pub loaded: u8,
}

/// Built-in groups installed only when a program names one of their globals (or makes one of their values), so a
/// run pays for what it uses: (bit, globals, setup).
/// A lazy group: its bit, the globals it defines, and its setup.
type LazyGroup = (u8, &'static [&'static str], fn(&mut Vm));

const LAZY: &[LazyGroup] = &[
    (1, &["RegExp"], regexp::setup),
    (2, &["Date"], date::setup),
    (
        4,
        &[
            "Uint8Array",
            "Buffer",
            "TextEncoder",
            "TextDecoder",
            "atob",
            "btoa",
        ],
        setup_bytes,
    ),
    (
        8,
        &["Map", "Set", "Object", "WeakMap", "WeakSet"],
        sets::setup,
    ),
    (
        16,
        &[
            "encodeURI",
            "encodeURIComponent",
            "decodeURI",
            "decodeURIComponent",
        ],
        uri::setup,
    ),
    (32, &["URL", "URLSearchParams", "Headers"], web::setup),
    (64, &["crypto", "structuredClone"], web::setup_globals),
];

pub const LAZY_REGEXP: u8 = 1;
pub const LAZY_DATE: u8 = 2;
pub const LAZY_BYTES: u8 = 4;
pub const LAZY_WEB: u8 = 32;

fn setup_bytes(vm: &mut Vm) {
    bytes::setup(vm);
    buffer::setup(vm);
}

/// Installs the lazy group with `bit`, once.
pub fn ensure(vm: &mut Vm, bit: u8) {
    if vm.realm.std.loaded & bit != 0 {
        return;
    }
    vm.realm.std.loaded |= bit;
    if let Some((_, _, setup)) = LAZY.iter().find(|(b, _, _)| *b == bit) {
        setup(vm);
    }
}

/// Installs the lazy group that defines the global `name`; false when no group does.
pub fn ensure_global(vm: &mut Vm, name: &str) -> bool {
    match LAZY.iter().find(|(_, names, _)| names.contains(&name)) {
        Some((bit, _, _)) => {
            ensure(vm, *bit);
            true
        }
        None => false,
    }
}

/// Installs the lazy groups a program's referenced globals need.
pub fn ensure_globals(vm: &mut Vm, globals: &[Atom]) {
    for a in globals {
        let name = vm.atoms.text(*a);
        if let Some((bit, _, _)) = LAZY.iter().find(|(_, names, _)| names.contains(&name)) {
            ensure(vm, *bit);
        }
    }
}

/// Global names a program cannot assign to.
pub const GLOBAL_NAMES: &[&str] = &[
    "Object",
    "Function",
    "Array",
    "String",
    "Number",
    "Boolean",
    "Symbol",
    "Math",
    "JSON",
    "Promise",
    "Map",
    "Set",
    "Error",
    "TypeError",
    "RangeError",
    "SyntaxError",
    "ReferenceError",
    "EvalError",
    "URIError",
    "AggregateError",
    "RegExp",
    "Date",
    "Uint8Array",
    "Buffer",
    "WeakMap",
    "WeakSet",
    "Iterator",
    "URL",
    "URLSearchParams",
    "Headers",
    "crypto",
    "structuredClone",
    "encodeURI",
    "encodeURIComponent",
    "decodeURI",
    "decodeURIComponent",
    "TextEncoder",
    "TextDecoder",
    "atob",
    "btoa",
    "console",
    "parseInt",
    "parseFloat",
    "isNaN",
    "isFinite",
    "NaN",
    "Infinity",
    "globalThis",
];

#[inline]
pub fn arg(args: &[Value], i: usize) -> Value {
    args.get(i).cloned().unwrap_or_default()
}

impl Vm {
    pub fn native_fn(&mut self, name: &'static str, length: u8, f: NativeFn, data: Value) -> Value {
        let name = self.atoms.intern_static(name);
        let proto = self.realm.function_proto;
        Value::Obj(self.alloc(Obj::new(
            Some(proto),
            Kind::Native {
                f,
                data,
                name,
                length,
                ctor: false,
            },
        )))
    }

    pub fn method(&mut self, target: Id, name: &'static str, length: u8, f: NativeFn) -> Value {
        let v = self.native_fn(name, length, f, Value::Undef);
        let key = self.atoms.intern(name);
        self.define_hidden(target, key, v);
        v
    }

    fn methods(&mut self, target: Id, list: &[(&'static str, u8, NativeFn)]) {
        for (name, len, f) in list {
            self.method(target, name, *len, *f);
        }
    }

    fn constant(&mut self, target: Id, name: &'static str, v: Value) {
        let key = self.atoms.intern_static(name);
        self.heap[target as usize].props.insert(key, v, FIXED);
    }

    /// A constructor whose `prototype` is `proto`; `data` reaches the native as its callee data.
    fn ctor(&mut self, name: &'static str, length: u8, f: NativeFn, proto: Id, data: Value) -> Id {
        let name_atom = self.atoms.intern_static(name);
        let fp = self.realm.function_proto;
        let c = self.alloc(Obj::new(
            Some(fp),
            Kind::Native {
                f,
                data,
                name: name_atom,
                length,
                ctor: true,
            },
        ));
        let (pk, ck) = (self.names.prototype, self.names.constructor);
        self.heap[c as usize]
            .props
            .insert(pk, Value::Obj(proto), FIXED);
        self.define_hidden(proto, ck, Value::Obj(c));
        self.global(name, Value::Obj(c));
        c
    }

    fn global(&mut self, name: &'static str, v: Value) {
        let a = self.atoms.intern_static(name);
        self.global_map.insert(a, v);
    }

    fn plain(&mut self, proto: Id) -> Id {
        self.alloc(Obj::new(Some(proto), Kind::Ordinary))
    }

    pub fn native_data(&self, callee: Id) -> Value {
        match &self.heap[callee as usize].kind {
            Kind::Native { data, .. } => *data,
            _ => Value::Undef,
        }
    }

    /// An iterator result `{ value, done }`.
    pub fn iter_result(&mut self, value: Value, done: bool) -> Value {
        let id = self.new_object();
        let (vk, dk) = (self.names.value, self.names.done);
        let props = &mut self.heap[id as usize].props;
        props.push_new(vk, value, DEFAULT_FLAGS);
        props.push_new(dk, Value::Bool(done), DEFAULT_FLAGS);
        Value::Obj(id)
    }

    pub fn setup(&mut self) {
        let object_proto = self.alloc(Obj::new(None, Kind::Ordinary));
        self.realm.object_proto = object_proto;
        // Function.prototype is itself a function that accepts anything and returns undefined, as in JS.
        let name = self.atoms.intern_static("");
        let function_proto = self.alloc(Obj::new(
            Some(object_proto),
            Kind::Native {
                f: function_proto_call,
                data: Value::Undef,
                name,
                length: 0,
                ctor: false,
            },
        ));
        self.realm.function_proto = function_proto;
        // Array.prototype is itself an array, as in the reference.
        self.realm.array_proto = self.alloc(Obj::new(Some(object_proto), Kind::Array(Vec::new())));
        self.realm.string_proto = self.plain(object_proto);
        self.realm.number_proto = self.plain(object_proto);
        self.realm.boolean_proto = self.plain(object_proto);
        self.realm.symbol_proto = self.plain(object_proto);
        self.realm.error_proto = self.plain(object_proto);
        let ep = self.realm.error_proto;
        self.realm.type_error_proto = self.plain(ep);
        self.realm.range_error_proto = self.plain(ep);
        self.realm.syntax_error_proto = self.plain(ep);
        self.realm.reference_error_proto = self.plain(ep);
        self.realm.aggregate_error_proto = self.plain(ep);
        self.realm.promise_proto = self.plain(object_proto);
        self.realm.map_proto = self.plain(object_proto);
        self.realm.set_proto = self.plain(object_proto);
        self.realm.iter_proto = self.plain(object_proto);
        let ip = self.realm.iter_proto;
        self.realm.generator_proto = self.plain(ip);

        object::setup(self);
        array::setup(self);
        string::setup(self);
        collections::setup(self);
        iterator::setup(self);
        iterator::setup_helpers(self);
        self.setup_async_iteration();

        self.global("NaN", Value::Num(f64::NAN));
        self.global("Infinity", Value::Num(f64::INFINITY));
        self.global("undefined", Value::Undef);
    }
}

fn function_proto_call(_vm: &mut Vm, _this: Value, _args: &[Value], _: Id) -> crate::vm::Res {
    Ok(Value::Undef)
}

pub fn this_obj(vm: &mut Vm, this: &Value, what: &str) -> Result<Id, Value> {
    match this {
        Value::Obj(id) => Ok(*id),
        _ => Err(vm.type_error(&format!("{what} called on a non-object"))),
    }
}

/// `Frame::convert` with what the conversion throws coming back to the frame as `Input::Threw`, as `Frame::catching`
/// calls: a `ForOf` body that converts waits on it with `Flow::Call`, so a throw closes the iterator.
pub(crate) fn convert_catching(
    vm: &mut Vm,
    fr: crate::native::Frame,
    v: Value,
    hint: crate::ops::Hint,
) -> Result<crate::native::Step, Value> {
    let sp = (vm.stack.len() - fr.base()) as u32;
    vm.handlers_mut().push(crate::vm::Handler {
        pc: crate::native::THREW as u32,
        sp,
    });
    fr.convert(vm, v, hint)
}

pub fn to_index(vm: &mut Vm, v: &Value, len: usize, default: usize) -> Result<usize, Value> {
    if let Value::Undef = v {
        return Ok(default);
    }
    let n = crate::value::to_integer(vm.number_of(v)?);
    Ok(if n < 0.0 {
        (len as f64 + n).max(0.0) as usize
    } else {
        n.min(len as f64) as usize
    })
}

/// ToString without consulting program-defined methods, as the reference's `coerceToString`: an array joins its
/// elements, a Date, RegExp or Error uses its built-in form, any other object is `[object Tag]`.
pub fn builtin_string(vm: &mut Vm, v: &Value) -> Result<String, Value> {
    let Value::Obj(id) = v else {
        let s = vm.string_of(v)?;
        return Ok(vm.text(s).to_owned());
    };
    let id = *id;
    if matches!(vm.heap[id as usize].kind, Kind::Array(_)) {
        vm.densify(id)?;
    }
    Ok(match &vm.heap[id as usize].kind {
        Kind::Array(items) => {
            let items = items.clone();
            let mut out = String::new();
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                if !matches!(item, Value::Undef | Value::Null | Value::Uninit) {
                    out.push_str(&builtin_string(vm, item)?);
                }
                if out.len() > crate::ops::MAX_STRING_LEN {
                    return Err(vm.range_error("Invalid string length"));
                }
            }
            out
        }
        Kind::Date(t) => date::display(*t),
        Kind::RegExp(_) => regexp::inspect(vm, id),
        Kind::Bytes(b) if b.buffer => {
            crate::strings::external_text(String::from_utf8_lossy(&b.to_vec()).into_owned())
        }
        Kind::Bytes(b) => {
            let parts: Vec<String> = b.to_vec().iter().map(u8::to_string).collect();
            parts.join(",")
        }
        Kind::Error(_) => {
            let (nk, mk) = (vm.names.name, vm.names.message);
            let name = match vm.get_obj(id, nk) {
                Value::Str(s) => vm.text(s).to_owned(),
                _ => "Error".to_owned(),
            };
            let message = match vm.get_obj(id, mk) {
                Value::Str(s) => vm.text(s).to_owned(),
                _ => String::new(),
            };
            if message.is_empty() {
                name
            } else if name.is_empty() {
                message
            } else {
                format!("{name}: {message}")
            }
        }
        Kind::Namespace(_) => "[object Object]".to_owned(),
        Kind::Url(_) => web::url_href(vm, id),
        Kind::SearchParams(_) => web::params_text(vm, id),
        _ => format!("[object {}]", object::tag_of(vm, v)),
    })
}

/// ToNumber without consulting program-defined methods, as the reference's `coerceToNumber`.
pub fn builtin_number(vm: &mut Vm, v: &Value) -> Result<f64, Value> {
    match v {
        Value::Obj(id) => {
            if let Kind::Date(t) = vm.heap[*id as usize].kind {
                return Ok(t);
            }
            if let Kind::Namespace(_) = vm.heap[*id as usize].kind {
                return Ok(f64::NAN);
            }
            let s = builtin_string(vm, v)?;
            Ok(crate::value::str_to_num(&s))
        }
        v => vm.number_of(v),
    }
}

/// ToIntegerOrInfinity over `builtin_number`.
pub fn builtin_integer(vm: &mut Vm, v: &Value) -> Result<f64, Value> {
    Ok(crate::value::to_integer(builtin_number(vm, v)?))
}

/// How diagnostics refer to a value, as the reference's `describeValue` does: `a number`, `an array`, `a Date`.
pub fn describe_value(vm: &Vm, v: &Value) -> String {
    let tag = match v {
        Value::Undef | Value::Uninit => return "undefined".into(),
        Value::Null => return "null".into(),
        Value::Obj(id) => match &vm.heap[*id as usize].kind {
            Kind::Array(_) => return "an array".into(),
            Kind::Namespace(_) => return "a namespace reference".into(),
            Kind::Closure(_) | Kind::Native { .. } | Kind::Bound(_) => return "a function".into(),
            Kind::Promise(_) => return "an un-awaited Promise".into(),
            Kind::Generator(_) => return "a generator".into(),
            Kind::ArrayIter { .. }
            | Kind::MapIter { .. }
            | Kind::StrIter { .. }
            | Kind::ListIter { .. } => return "an iterator".into(),
            _ => object::tag_of(vm, v),
        },
        _ => return format!("a {}", vm.type_of(v)),
    };
    if tag == "Object" {
        return "a data object".into();
    }
    let article = if tag.starts_with(['A', 'E', 'I', 'O']) {
        "an"
    } else {
        "a"
    };
    format!("{article} {tag}")
}

/// The reference's error for a method called on the wrong kind of receiver.
pub fn incompatible(vm: &mut Vm, method: &str, this: &Value) -> Value {
    let d = describe_value(vm, this);
    vm.type_error(&format!("{method} called on incompatible receiver {d}."))
}

/// Checks a callback argument, as the reference's `requireCallback` does.
pub fn require_callback(vm: &mut Vm, f: &Value, name: &str) -> Result<Value, Value> {
    if supported_callback(vm, f) {
        return Ok(*f);
    }
    if vm.type_of(f) == "function" {
        return Err(unsupported_callable(
            vm,
            name,
            "callback",
            "(value) => fn(value)",
        ));
    }
    Err(vm.type_error(&format!("{name} expects a function callback.")))
}

/// Whether callback sites (array methods, replacers, promise reactions) admit `f`, as the reference's
/// `isSupportedCallback`: any function but a namespace reference and the built-ins marked `NOT_CALLBACK`.
pub fn supported_callback(vm: &Vm, f: &Value) -> bool {
    let Value::Obj(id) = f else {
        return false;
    };
    let o = &vm.heap[*id as usize];
    match o.kind {
        Kind::Namespace(_) => false,
        Kind::Native { .. } => o.flags & NOT_CALLBACK == 0,
        _ => o.is_callable(),
    }
}

/// The error for a function a callback site doesn't admit, with the arrow function to wrap it in.
pub fn unsupported_callable(vm: &mut Vm, name: &str, role: &str, example: &str) -> Value {
    vm.type_error(&format!(
        "{name} cannot use this callable as a {role}; wrap it in an arrow function, e.g. {example}."
    ))
}

/// Declares getter-only accessor properties on a built-in prototype. Instances answer them through their exotic
/// hooks; the slot on the prototype holds `Uninit`, which a property read turns into `accessor_error`, so reading
/// one from the prototype itself (or an object that merely inherits it) throws as the reference's getters do.
fn accessors(vm: &mut Vm, proto: Id, names: &[&'static str]) {
    for name in names {
        let k = vm.atoms.intern_static(name);
        vm.heap[proto as usize].props.insert(k, Value::Uninit, 0);
    }
}

/// The error for reading an accessor of `this`, which is not the kind the accessor belongs to.
pub fn accessor_error(vm: &mut Vm, this: Id, key: Atom) -> Value {
    let (pk, nk) = (vm.names.constructor, vm.names.name);
    let mut owner = Some(this);
    while let Some(o) = owner {
        if matches!(vm.heap[o as usize].props.get(key), Some(Value::Uninit)) {
            break;
        }
        owner = vm.heap[o as usize].proto;
    }
    let ctor = match owner.map(|o| vm.get_obj(o, pk)) {
        Some(Value::Obj(c)) => match vm.get_obj(c, nk) {
            Value::Str(s) => vm.text(s).to_owned(),
            _ => String::new(),
        },
        _ => String::new(),
    };
    let k = vm.atoms.text(key).to_owned();
    incompatible(vm, &format!("{ctor}.prototype.{k}"), &Value::Obj(this))
}
