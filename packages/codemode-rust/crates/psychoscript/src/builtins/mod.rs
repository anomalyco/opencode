//! Native built-ins: prototypes, constructors and global functions, created fresh for every run.

mod array;
mod collections;
mod object;
mod string;

use crate::object::*;
use crate::value::{Id, Value};
use crate::vm::{NativeFn, Vm};

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
    "console",
    "parseInt",
    "parseFloat",
    "isNaN",
    "isFinite",
    "NaN",
    "Infinity",
    "tools",
    "globalThis",
];

#[inline]
pub fn arg(args: &[Value], i: usize) -> Value {
    args.get(i).cloned().unwrap_or_default()
}

impl<'rt> Vm<'rt> {
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
        self.heap[target as usize].props.insert(key, v, 0);
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
        self.heap[c as usize].props.insert(pk, Value::Obj(proto), 0);
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
        let function_proto = self.plain(object_proto);
        self.realm.function_proto = function_proto;
        self.realm.array_proto = self.plain(object_proto);
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

        let tools = self.tool_ref("");
        self.realm.tools = tools.as_obj().unwrap_or(0);
        self.global("tools", tools);
        self.global("NaN", Value::Num(f64::NAN));
        self.global("Infinity", Value::Num(f64::INFINITY));
        self.global("undefined", Value::Undef);
    }
}

pub fn this_obj(vm: &mut Vm, this: &Value, what: &str) -> Result<Id, Value> {
    match this {
        Value::Obj(id) => Ok(*id),
        _ => Err(vm.type_error(&format!("{what} called on a non-object"))),
    }
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
