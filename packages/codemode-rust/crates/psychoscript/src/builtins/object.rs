//! Object, Function, Error, Boolean, Symbol, JSON, console and the global functions.

use super::{arg, this_obj};
use crate::convert;
use crate::object::*;
use crate::value::{Id, Value, parse_float_prefix, to_int32};
use crate::vm::{Res, Vm};

pub fn setup(vm: &mut Vm) {
    let op = vm.realm.object_proto;
    let object = vm.ctor("Object", 1, object_ctor, op, Value::Undef);
    vm.methods(
        object,
        &[
            ("keys", 1, object_keys),
            ("values", 1, object_values),
            ("entries", 1, object_entries),
            ("assign", 2, object_assign),
            ("fromEntries", 1, object_from_entries),
            ("hasOwn", 2, object_has_own),
            ("freeze", 1, object_freeze),
            ("isFrozen", 1, object_is_frozen),
            ("seal", 1, object_seal),
            ("isSealed", 1, object_is_sealed),
            ("preventExtensions", 1, object_prevent_extensions),
            ("isExtensible", 1, object_is_extensible),
            ("create", 2, object_create),
            ("getPrototypeOf", 1, object_get_prototype_of),
            ("is", 2, object_is),
        ],
    );
    vm.methods(
        op,
        &[
            ("hasOwnProperty", 1, proto_has_own_property),
            ("toString", 0, proto_to_string),
            ("toLocaleString", 0, proto_to_locale_string),
            ("valueOf", 0, proto_value_of),
            ("isPrototypeOf", 1, proto_is_prototype_of),
            ("propertyIsEnumerable", 1, proto_property_is_enumerable),
        ],
    );

    let fp = vm.realm.function_proto;
    vm.ctor("Function", 1, function_ctor, fp, Value::Undef);
    vm.methods(
        fp,
        &[
            ("call", 1, function_call),
            ("apply", 2, function_apply),
            ("bind", 1, function_bind),
        ],
    );

    let errors = [
        ("Error", vm.realm.error_proto),
        ("TypeError", vm.realm.type_error_proto),
        ("RangeError", vm.realm.range_error_proto),
        ("SyntaxError", vm.realm.syntax_error_proto),
        ("ReferenceError", vm.realm.reference_error_proto),
        ("AggregateError", vm.realm.aggregate_error_proto),
    ];
    let (nk, mk) = (vm.names.name, vm.names.message);
    let mut error_ctor_id = 0;
    for (name, proto) in errors {
        let f: crate::vm::NativeFn = if name == "AggregateError" {
            aggregate_error_ctor
        } else {
            error_ctor
        };
        let c = vm.ctor(name, 1, f, proto, Value::Obj(proto));
        if name == "Error" {
            error_ctor_id = c;
            vm.method(c, "isError", 1, error_is_error);
        } else {
            vm.heap[c as usize].proto = Some(error_ctor_id);
        }
        let (n, m) = (vm.static_str(name), vm.static_str(""));
        vm.define_hidden(proto, nk, n);
        vm.define_hidden(proto, mk, m);
    }
    for name in ["EvalError", "URIError"] {
        let ep = vm.realm.error_proto;
        let proto = vm.plain(ep);
        let c = vm.ctor(name, 1, error_ctor, proto, Value::Obj(proto));
        vm.heap[c as usize].proto = Some(error_ctor_id);
        let (n, m) = (vm.static_str(name), vm.static_str(""));
        vm.define_hidden(proto, nk, n);
        vm.define_hidden(proto, mk, m);
        if name == "URIError" {
            vm.realm.std.uri_error = proto;
        }
    }
    let ep = vm.realm.error_proto;
    vm.method(ep, "toString", 0, error_to_string);

    let bp = vm.realm.boolean_proto;
    vm.ctor("Boolean", 1, boolean_ctor, bp, Value::Undef);
    vm.methods(
        bp,
        &[
            ("toString", 0, boolean_to_string),
            ("valueOf", 0, boolean_value_of),
        ],
    );

    let sp = vm.realm.symbol_proto;
    let symbol = vm.ctor("Symbol", 0, symbol_ctor, sp, Value::Undef);
    vm.constant(symbol, "iterator", Value::Sym(0));
    vm.constant(symbol, "asyncIterator", Value::Sym(1));
    vm.methods(sp, &[("toString", 0, symbol_to_string)]);

    let json = vm.new_object();
    vm.methods(
        json,
        &[("parse", 2, json_parse), ("stringify", 3, json_stringify)],
    );
    vm.global("JSON", Value::Obj(json));

    let console = vm.new_object();
    vm.methods(
        console,
        &[
            ("log", 0, console_log),
            ("info", 0, console_log),
            ("debug", 0, console_debug),
            ("warn", 0, console_warn),
            ("error", 0, console_error),
            ("dir", 0, console_dir),
            ("table", 0, console_table),
        ],
    );
    vm.global("console", Value::Obj(console));

    let parse_int = vm.native_fn("parseInt", 2, global_parse_int, Value::Undef);
    let parse_float = vm.native_fn("parseFloat", 1, global_parse_float, Value::Undef);
    vm.global("parseInt", parse_int);
    vm.global("parseFloat", parse_float);
    let is_nan = vm.native_fn("isNaN", 1, global_is_nan, Value::Undef);
    let is_finite = vm.native_fn("isFinite", 1, global_is_finite, Value::Undef);
    vm.global("isNaN", is_nan);
    vm.global("isFinite", is_finite);
}

// ---------- Object ----------

fn object_ctor(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    match arg(args, 0) {
        Value::Undef | Value::Null => Ok(Value::Obj(vm.new_object())),
        v @ Value::Obj(_) => Ok(v),
        _ => Err(vm.type_error("Object() of a primitive value is not supported")),
    }
}

fn require_object_coercible(vm: &mut Vm, v: &Value) -> Result<(), Value> {
    if v.is_nullish() {
        return Err(vm.type_error("Cannot convert undefined or null to object"));
    }
    Ok(())
}

fn entries_of(vm: &mut Vm, v: &Value) -> Result<Vec<(Value, Value)>, Value> {
    require_object_coercible(vm, v)?;
    Ok(match v {
        Value::Obj(id) => {
            let id = *id;
            vm.own_entries(id)
                .into_iter()
                .map(|(k, v)| (Value::Str(vm.atoms.atom_str(k)), v))
                .collect()
        }
        Value::Str(s) => {
            let units = vm.atoms.sref(*s).utf16();
            units
                .iter()
                .enumerate()
                .map(|(i, c)| (vm.string_val(i.to_string()), vm.char_str(*c)))
                .collect()
        }
        _ => Vec::new(),
    })
}

fn object_keys(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let v = arg(args, 0);
    if let Value::Obj(id) = v {
        require_object_coercible(vm, &v)?;
        let keys = vm.own_keys(id);
        let items = keys
            .into_iter()
            .map(|k| Value::Str(vm.atoms.atom_str(k)))
            .collect();
        return Ok(vm.new_array(items));
    }
    let items = entries_of(vm, &v)?.into_iter().map(|(k, _)| k).collect();
    Ok(vm.new_array(items))
}

fn object_values(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let items = entries_of(vm, &arg(args, 0))?
        .into_iter()
        .map(|(_, v)| v)
        .collect();
    Ok(vm.new_array(items))
}

fn object_entries(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let pairs = entries_of(vm, &arg(args, 0))?;
    let items = pairs
        .into_iter()
        .map(|(k, v)| vm.new_array(vec![k, v]))
        .collect();
    Ok(vm.new_array(items))
}

fn object_assign(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let target = arg(args, 0);
    let Value::Obj(t) = target else {
        return Err(vm.type_error("Object.assign target must be an object"));
    };
    for src in args.iter().skip(1) {
        if let Value::Obj(s) = src {
            let mut entries = vm.own_entries(*s);
            entries.extend(vm.own_symbol_entries(*s));
            for (k, v) in entries {
                vm.reject_circular(t, &v, "Object.assign result")?;
                vm.set_obj(t, k, v)?;
            }
        } else {
            vm.copy_props(t, src, &[])?;
        }
    }
    Ok(target)
}

fn object_from_entries(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let items = vm.iterate_to_vec(&arg(args, 0))?;
    let id = vm.new_object();
    for item in items {
        let k = vm.get_elem(&item, &Value::Num(0.0))?;
        let v = vm.get_elem(&item, &Value::Num(1.0))?;
        let a = vm.key_of(&k)?;
        vm.define(id, a, v);
    }
    Ok(Value::Obj(id))
}

fn object_has_own(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let o = arg(args, 0);
    require_object_coercible(vm, &o)?;
    let k = vm.key_of(&arg(args, 1))?;
    Ok(Value::Bool(match o {
        Value::Obj(id) => vm.has_own(id, k),
        Value::Str(s) => vm
            .atoms
            .index(k)
            .is_some_and(|i| (i as usize) < vm.atoms.sref(s).len16()),
        _ => false,
    }))
}

fn set_flags(vm: &mut Vm, args: &[Value], flags: u8) -> Res {
    let v = arg(args, 0);
    if let Value::Obj(id) = v {
        vm.heap[id as usize].flags |= flags;
    }
    Ok(v)
}

fn has_flags(vm: &mut Vm, args: &[Value], flags: u8, primitive: bool) -> Res {
    Ok(Value::Bool(match arg(args, 0) {
        Value::Obj(id) => {
            let o = &vm.heap[id as usize];
            let empty =
                o.props.len() == 0 && !matches!(&o.kind, Kind::Array(items) if !items.is_empty());
            o.flags & flags == flags
                || (flags != NON_EXTENSIBLE && empty && o.flags & NON_EXTENSIBLE != 0)
        }
        _ => primitive,
    }))
}

fn object_freeze(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    set_flags(vm, args, FROZEN | SEALED | NON_EXTENSIBLE)
}
fn object_is_frozen(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    has_flags(vm, args, FROZEN, true)
}
fn object_seal(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    set_flags(vm, args, SEALED | NON_EXTENSIBLE)
}
fn object_is_sealed(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    has_flags(vm, args, SEALED, true)
}
fn object_prevent_extensions(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    set_flags(vm, args, NON_EXTENSIBLE)
}
fn object_is_extensible(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    Ok(Value::Bool(match arg(args, 0) {
        Value::Obj(id) => vm.heap[id as usize].flags & NON_EXTENSIBLE == 0,
        _ => false,
    }))
}

fn object_create(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let proto = match arg(args, 0) {
        Value::Obj(p) => Some(p),
        Value::Null => None,
        _ => return Err(vm.type_error("Object prototype may only be an Object or null")),
    };
    if !matches!(arg(args, 1), Value::Undef) {
        return Err(vm.type_error("Property descriptors are not supported"));
    }
    Ok(Value::Obj(vm.alloc(Obj::new(proto, Kind::Ordinary))))
}

fn object_get_prototype_of(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    Ok(match arg(args, 0) {
        Value::Obj(id) => vm.heap[id as usize]
            .proto
            .map(Value::Obj)
            .unwrap_or(Value::Null),
        Value::Str(_) => Value::Obj(vm.realm.string_proto),
        Value::Num(_) => Value::Obj(vm.realm.number_proto),
        Value::Bool(_) => Value::Obj(vm.realm.boolean_proto),
        _ => return Err(vm.type_error("Cannot convert undefined or null to object")),
    })
}

fn object_is(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let (a, b) = (arg(args, 0), arg(args, 1));
    Ok(Value::Bool(match (&a, &b) {
        (Value::Num(x), Value::Num(y)) => {
            (x.is_nan() && y.is_nan()) || (x == y && x.is_sign_negative() == y.is_sign_negative())
        }
        _ => vm.strict_eq(&a, &b),
    }))
}

/// The receiver of the `Object.prototype` methods that need an object: like the reference, primitives (which JS
/// would box) and tool references are rejected.
fn object_receiver(vm: &mut Vm, this: &Value, method: &str) -> Result<Id, Value> {
    if let Value::Obj(id) = this
        && !matches!(vm.heap[*id as usize].kind, Kind::ToolRef(_))
    {
        return Ok(*id);
    }
    Err(super::incompatible(
        vm,
        &format!("Object.prototype.{method}"),
        this,
    ))
}

fn is_tool_ref(vm: &Vm, v: &Value) -> bool {
    matches!(v, Value::Obj(id) if matches!(vm.heap[*id as usize].kind, Kind::ToolRef(_)))
}

fn proto_has_own_property(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = object_receiver(vm, &this, "hasOwnProperty")?;
    let k = vm.key_of(&arg(args, 0))?;
    Ok(Value::Bool(vm.has_own(id, k)))
}

pub fn tag_of(vm: &Vm, v: &Value) -> &'static str {
    match v {
        Value::Undef | Value::Uninit => "Undefined",
        Value::Null => "Null",
        Value::Num(_) => "Number",
        Value::Str(_) => "String",
        Value::Bool(_) => "Boolean",
        Value::Sym(_) => "Symbol",
        Value::Obj(id) => match &vm.heap[*id as usize].kind {
            Kind::Array(_) => "Array",
            Kind::Arguments(_) => "Arguments",
            Kind::Closure(_) | Kind::Native { .. } | Kind::Bound(_) => "Function",
            Kind::Error(_) => "Error",
            Kind::Promise(_) => "Promise",
            Kind::Map(_) => "Map",
            Kind::Set(_) => "Set",
            Kind::Generator(_) | Kind::IterHelper(_) => "Generator",
            Kind::ArrayIter { .. } => "Array Iterator",
            Kind::MapIter { target, .. } => match vm.heap[*target as usize].kind {
                Kind::Set(_) => "Set Iterator",
                _ => "Map Iterator",
            },
            Kind::StrIter { .. } => "String Iterator",
            Kind::RegExp(_) => "RegExp",
            Kind::Date(_) => "Date",
            Kind::Bytes(_) => "Uint8Array",
            Kind::WeakMap(_) => "WeakMap",
            Kind::Url(_) => "URL",
            Kind::SearchParams(_) => "URLSearchParams",
            Kind::Headers(_) => "Headers",
            Kind::WeakSet(_) => "WeakSet",
            Kind::ExoticIter { target, .. } => match vm.heap[*target as usize].kind {
                Kind::Bytes(_) => "Array Iterator",
                Kind::SearchParams(_) => "URLSearchParams Iterator",
                Kind::Headers(_) => "Headers Iterator",
                _ => "Iterator",
            },
            _ => "Object",
        },
    }
}

fn proto_to_string(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    if let Value::Obj(id) = this
        && let Kind::Error(_) = vm.heap[id as usize].kind
    {
        return Ok(vm.static_str("[object Error]"));
    }
    let t = format!("[object {}]", tag_of(vm, &this));
    Ok(vm.static_str(&t))
}

fn proto_to_locale_string(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    if this.is_nullish() || is_tool_ref(vm, &this) {
        return Err(vm.type_error("Object.prototype.toLocaleString called on null or undefined."));
    }
    let k = vm.names.to_string;
    let f = vm.get(&this, k)?;
    vm.call(&f, this, &[])
}

fn proto_value_of(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    if this.is_nullish() {
        return Err(vm.type_error("Object.prototype.valueOf called on null or undefined."));
    }
    Ok(this)
}

fn proto_is_prototype_of(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let p = object_receiver(vm, &this, "isPrototypeOf")?;
    let Value::Obj(mut cur) = arg(args, 0) else {
        return Ok(Value::Bool(false));
    };
    while let Some(next) = vm.heap[cur as usize].proto {
        if next == p {
            return Ok(Value::Bool(true));
        }
        cur = next;
    }
    Ok(Value::Bool(false))
}

fn proto_property_is_enumerable(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = object_receiver(vm, &this, "propertyIsEnumerable")?;
    let k = vm.key_of(&arg(args, 0))?;
    let o = &vm.heap[id as usize];
    if let Kind::Array(items) = &o.kind
        && let Some(i) = vm.atoms.index(k)
    {
        return Ok(Value::Bool(
            items
                .get(i as usize)
                .is_some_and(|v| !matches!(v, Value::Uninit)),
        ));
    }
    Ok(Value::Bool(
        o.props
            .find(k)
            .is_some_and(|i| o.props.items[i].flags & ENUMERABLE != 0),
    ))
}

// ---------- Function ----------

fn function_ctor(vm: &mut Vm, _this: Value, _args: &[Value], _: Id) -> Res {
    Err(vm.type_error("Function() is not supported; write a function expression instead"))
}

fn function_call(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let rest = if args.is_empty() { &[][..] } else { &args[1..] };
    vm.call(&this, arg(args, 0), rest)
}

fn function_apply(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let list = match arg(args, 1) {
        Value::Undef | Value::Null => Vec::new(),
        v @ Value::Obj(_) => array_like(vm, &v)?,
        _ => return Err(vm.type_error("CreateListFromArrayLike called on non-object")),
    };
    vm.call(&this, arg(args, 0), &list)
}

pub fn array_like(vm: &mut Vm, v: &Value) -> Result<Vec<Value>, Value> {
    let Value::Obj(id) = v else {
        return Ok(Vec::new());
    };
    if let Kind::Array(items) | Kind::Arguments(items) = &vm.heap[*id as usize].kind {
        return Ok(crate::ops::without_holes(items));
    }
    let lk = vm.names.length;
    let len = vm.get_obj(*id, lk);
    let n = crate::value::to_integer(vm.number_of(&len)?)
        .clamp(0.0, crate::ops::MAX_ARRAY_LEN as f64) as usize;
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        out.push(vm.get_elem(v, &Value::Num(i as f64))?);
    }
    Ok(out)
}

fn function_bind(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    if !vm.is_callable(&this) {
        return Err(vm.type_error("Bind must be called on a function"));
    }
    let rest: Vec<Value> = args.iter().skip(1).cloned().collect();
    // Like the reference: `bound <name>`, and the target's length less the bound arguments, at least 0.
    let (lk, nk) = (vm.names.length, vm.names.name);
    let length = match vm.get(&this, lk)? {
        Value::Num(n) if n == f64::INFINITY => n,
        Value::Num(n) if n.is_finite() => (n.trunc() - rest.len() as f64).max(0.0),
        _ => 0.0,
    };
    let name = match vm.get(&this, nk)? {
        Value::Str(s) => format!("bound {}", vm.text(s)),
        _ => "bound ".to_owned(),
    };
    let fp = vm.realm.function_proto;
    let id = vm.alloc(Obj::new(
        Some(fp),
        Kind::Bound(Box::new((this, arg(args, 0), rest))),
    ));
    let name = vm.string_val(name);
    vm.heap[id as usize].props.insert(lk, Value::Num(length), 0);
    vm.heap[id as usize].props.insert(nk, name, 0);
    Ok(Value::Obj(id))
}

// ---------- Error ----------

fn make_error_from(vm: &mut Vm, proto: Id, message: &Value, options: &Value) -> Res {
    let id = vm.alloc(Obj::new(Some(proto), Kind::Error(None)));
    if !matches!(message, Value::Undef) {
        let m = vm.string_of(message)?;
        let mk = vm.names.message;
        vm.define_hidden(id, mk, Value::Str(m));
    }
    if let Value::Obj(o) = options {
        let ck = vm.names.cause;
        if vm.has_key(*o, ck) {
            let c = vm.get_obj(*o, ck);
            vm.define_hidden(id, ck, c);
        }
    }
    Ok(Value::Obj(id))
}

fn error_ctor(vm: &mut Vm, _this: Value, args: &[Value], callee: Id) -> Res {
    let proto = vm
        .native_data(callee)
        .as_obj()
        .unwrap_or(vm.realm.error_proto);
    make_error_from(vm, proto, &arg(args, 0), &arg(args, 1))
}

fn aggregate_error_ctor(vm: &mut Vm, _this: Value, args: &[Value], callee: Id) -> Res {
    let proto = vm
        .native_data(callee)
        .as_obj()
        .unwrap_or(vm.realm.aggregate_error_proto);
    let e = make_error_from(vm, proto, &arg(args, 1), &arg(args, 2))?;
    let errors = vm.iterate_to_vec(&arg(args, 0))?;
    let arr = vm.new_array(errors);
    if let Value::Obj(id) = e {
        let ek = vm.names.errors;
        vm.define_hidden(id, ek, arr);
    }
    Ok(e)
}

fn error_is_error(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    Ok(Value::Bool(
        matches!(arg(args, 0), Value::Obj(id) if matches!(vm.heap[id as usize].kind, Kind::Error(_))),
    ))
}

fn error_to_string(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let id = this_obj(vm, &this, "Error.prototype.toString")?;
    let s = convert::error_to_string(vm, id);
    Ok(vm.string_val(s))
}

// ---------- Boolean and Symbol ----------

fn boolean_ctor(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    if let Value::Uninit = this {
        return Err(
            vm.type_error("Boolean wrapper objects are not supported; call Boolean(value) instead")
        );
    }
    Ok(Value::Bool(vm.truthy(&arg(args, 0))))
}

fn this_bool(vm: &mut Vm, this: &Value) -> Result<bool, Value> {
    match this {
        Value::Bool(b) => Ok(*b),
        _ => Err(vm.type_error("Boolean.prototype method called on an incompatible receiver")),
    }
}

fn boolean_to_string(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let b = this_bool(vm, &this)?;
    Ok(vm.static_str(if b { "true" } else { "false" }))
}

fn boolean_value_of(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    Ok(Value::Bool(this_bool(vm, &this)?))
}

fn symbol_ctor(vm: &mut Vm, _this: Value, _args: &[Value], _: Id) -> Res {
    Err(vm.type_error("Custom symbols are not supported"))
}

fn symbol_to_string(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let s = if let Value::Sym(s) = this { s } else { 0 };
    Ok(vm.atom_val(s))
}

// ---------- JSON ----------

fn json_parse(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let text = vm.string_of(&arg(args, 0))?;
    let text = vm.text(text).to_owned();
    let v = convert::parse(vm, &text)?;
    let reviver = arg(args, 1);
    if !vm.is_callable(&reviver) {
        return Ok(v);
    }
    let holder = vm.new_object();
    let empty = vm.atoms.intern_static("");
    vm.define(holder, empty, v);
    revive(vm, &reviver, Value::Obj(holder), empty)
}

fn revive(vm: &mut Vm, reviver: &Value, holder: Value, key: Atom) -> Res {
    let val = vm.get(&holder, key)?;
    if let Value::Obj(id) = val {
        let keys: Vec<Atom> = vm.own_keys(id);
        for k in keys {
            let nv = revive(vm, reviver, val, k)?;
            if let Value::Undef = nv {
                vm.delete(&val, k)?;
            } else {
                vm.set_obj(id, k, nv)?;
            }
        }
    }
    let kv = Value::Str(vm.atoms.atom_str(key));
    vm.call(reviver, holder, &[kv, val])
}

fn json_stringify(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let replacer = arg(args, 1);
    let mut opts = convert::Stringify {
        indent: String::new(),
        replacer_fn: None,
        allow: None,
    };
    if vm.is_callable(&replacer) {
        opts.replacer_fn = Some(replacer);
    } else if let Value::Obj(id) = replacer
        && let Kind::Array(items) = &vm.heap[id as usize].kind
    {
        let items = items.clone();
        let mut allow = Vec::new();
        for i in items {
            if matches!(i, Value::Str(_) | Value::Num(_)) {
                let a = vm.key_of(&i)?;
                if !allow.contains(&a) {
                    allow.push(a);
                }
            }
        }
        opts.allow = Some(allow);
    }
    match arg(args, 2) {
        Value::Num(n) => opts.indent = " ".repeat(n.clamp(0.0, 10.0) as usize),
        Value::Str(s) => opts.indent = vm.text(s).chars().take(10).collect(),
        _ => {}
    }
    Ok(match convert::stringify(vm, &arg(args, 0), &opts)? {
        Some(s) => vm.string_val(s),
        None => Value::Undef,
    })
}

// ---------- console ----------

fn log_line(vm: &mut Vm, prefix: &str, args: &[Value]) -> Res {
    let mut line = String::from(prefix);
    for (i, a) in args.iter().enumerate() {
        if i > 0 {
            line.push(' ');
        }
        line.push_str(&convert::format_value(vm, a));
    }
    vm.logs.push(line);
    Ok(Value::Undef)
}

fn console_log(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    log_line(vm, "", args)
}
fn console_debug(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    log_line(vm, "[debug] ", args)
}
fn console_warn(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    log_line(vm, "[warn] ", args)
}
fn console_error(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    log_line(vm, "[error] ", args)
}
fn console_dir(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    if args.is_empty() {
        vm.logs.push("undefined".into());
        return Ok(Value::Undef);
    }
    log_line(vm, "", &args[..1])
}

/// Whether a value holds an opaque reference (a function, promise, iterator or tool reference) anywhere in the
/// data objects and arrays it contains, as the reference's `containsOpaqueReference` walks it.
fn contains_opaque(vm: &Vm, v: &Value, seen: &mut Vec<Id>) -> bool {
    let Value::Obj(id) = v else { return false };
    let o = &vm.heap[*id as usize];
    match &o.kind {
        Kind::Ordinary | Kind::Error(_) | Kind::Arguments(_) | Kind::Array(_) | Kind::Live(_) => {}
        Kind::Map(_)
        | Kind::Set(_)
        | Kind::WeakMap(_)
        | Kind::WeakSet(_)
        | Kind::Date(_)
        | Kind::RegExp(_)
        | Kind::Bytes(_)
        | Kind::Url(_)
        | Kind::SearchParams(_)
        | Kind::Headers(_)
        | Kind::TextDecoder(_) => return false,
        _ => return true,
    }
    if seen.contains(id) {
        return false;
    }
    seen.push(*id);
    let mut children: Vec<Value> = o.props.items.iter().map(|p| p.value).collect();
    if let Kind::Array(items) | Kind::Arguments(items) = &o.kind {
        children.extend(items.iter().copied());
    }
    children.iter().any(|c| contains_opaque(vm, c, seen))
}

/// A row's cells: an object's own entries (or the chosen columns), or the value itself under `Value`.
fn table_values(vm: &mut Vm, v: &Value, columns: &Option<Vec<String>>) -> Vec<(String, Value)> {
    if let Value::Obj(id) = v
        && !matches!(vm.heap[*id as usize].kind, Kind::Array(_))
    {
        return match columns {
            Some(cols) => cols
                .iter()
                .map(|c| {
                    let k = vm.atoms.intern(c);
                    (c.clone(), vm.get_obj(*id, k))
                })
                .collect(),
            None => vm
                .own_entries(*id)
                .into_iter()
                .map(|(k, v)| (vm.atoms.text(k).to_owned(), v))
                .collect(),
        };
    }
    vec![("Value".to_owned(), *v)]
}

/// Orders record keys as a JavaScript object would: array indexes ascending, then the rest as first seen.
fn record_keys(keys: Vec<String>) -> Vec<String> {
    let mut ints: Vec<(u32, String)> = Vec::new();
    let mut rest: Vec<String> = Vec::new();
    for k in keys {
        if ints.iter().any(|(_, x)| x == &k) || rest.contains(&k) {
            continue;
        }
        match crate::value::index_of_key(&k) {
            Some(i) => ints.push((i, k)),
            None => rest.push(k),
        }
    }
    ints.sort_by_key(|(i, _)| *i);
    ints.into_iter().map(|(_, k)| k).chain(rest).collect()
}

fn console_table(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let data = arg(args, 0);
    if let Value::Undef = data {
        vm.logs.push("undefined".into());
        return Ok(Value::Undef);
    }
    if contains_opaque(vm, &data, &mut Vec::new()) {
        vm.logs.push("[opaque reference]".into());
        return Ok(Value::Undef);
    }
    let columns = match arg(args, 1) {
        Value::Obj(id) => match &vm.heap[id as usize].kind {
            Kind::Array(items) => {
                let items = items.clone();
                let mut cols = Vec::with_capacity(items.len());
                for i in items {
                    cols.push(super::builtin_string(vm, &i)?);
                }
                Some(cols)
            }
            _ => None,
        },
        _ => None,
    };
    let rows: Vec<(String, Vec<(String, Value)>)> = match data {
        Value::Obj(id) => match &vm.heap[id as usize].kind {
            Kind::Array(items) => {
                let items = items.clone();
                items
                    .iter()
                    .enumerate()
                    .map(|(i, item)| (i.to_string(), table_values(vm, item, &columns)))
                    .collect()
            }
            _ => {
                let entries = vm.own_entries(id);
                entries
                    .into_iter()
                    .map(|(k, item)| {
                        let k = vm.atoms.text(k).to_owned();
                        (k, table_values(vm, &item, &columns))
                    })
                    .collect()
            }
        },
        v => vec![("0".to_owned(), vec![("Value".to_owned(), v)])],
    };
    // Each row's cells read like an object record: later duplicates win, indexes sort first.
    let rows: Vec<(String, Vec<(String, Value)>)> = rows
        .into_iter()
        .map(|(index, cells)| {
            let keys = record_keys(cells.iter().map(|(k, _)| k.clone()).collect());
            let cells = keys
                .into_iter()
                .map(|k| {
                    let v = cells.iter().rev().find(|(c, _)| c == &k).map(|(_, v)| *v);
                    (k, v.unwrap_or_default())
                })
                .collect();
            (index, cells)
        })
        .collect();
    let keys = match &columns {
        Some(c) => c.clone(),
        None => {
            let mut keys: Vec<String> = Vec::new();
            for (_, cells) in &rows {
                for (k, _) in cells {
                    if !keys.contains(k) {
                        keys.push(k.clone());
                    }
                }
            }
            keys
        }
    };
    let mut lines = vec![
        std::iter::once("(index)".to_owned())
            .chain(keys.iter().cloned())
            .collect::<Vec<_>>()
            .join("\t"),
    ];
    for (index, cells) in &rows {
        let mut line = vec![index.clone()];
        for k in &keys {
            let cell = match cells.iter().find(|(c, _)| c == k) {
                None | Some((_, Value::Undef)) => String::new(),
                Some((_, Value::Str(s))) => vm.text(*s).to_owned(),
                Some((_, v)) => convert::format_value(vm, v),
            };
            line.push(cell);
        }
        lines.push(line.join("\t"));
    }
    vm.logs.push(lines.join("\n"));
    Ok(Value::Undef)
}

// ---------- global functions ----------

pub fn global_parse_int(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let s = vm.string_of(&arg(args, 0))?;
    let mut radix = to_int32(vm.number_of(&arg(args, 1))?);
    let owned = vm.text(s).to_owned();
    let t = owned.trim_start_matches(crate::value::is_js_whitespace);
    let (neg, mut t) = match t.as_bytes().first() {
        Some(b'-') => (true, &t[1..]),
        Some(b'+') => (false, &t[1..]),
        _ => (false, t),
    };
    if radix == 0 {
        radix = 10;
        if t.starts_with("0x") || t.starts_with("0X") {
            radix = 16;
            t = &t[2..];
        }
    } else if radix == 16 && (t.starts_with("0x") || t.starts_with("0X")) {
        t = &t[2..];
    }
    if !(2..=36).contains(&radix) {
        return Ok(Value::Num(f64::NAN));
    }
    let mut v = 0.0f64;
    let mut any = false;
    for c in t.chars() {
        match c.to_digit(radix as u32) {
            Some(d) => {
                v = v * radix as f64 + d as f64;
                any = true;
            }
            None => break,
        }
    }
    if !any {
        return Ok(Value::Num(f64::NAN));
    }
    Ok(Value::Num(if neg { -v } else { v }))
}

pub fn global_parse_float(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let s = vm.string_of(&arg(args, 0))?;
    Ok(Value::Num(parse_float_prefix(vm.text(s))))
}

fn global_is_nan(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    Ok(Value::Bool(vm.number_of(&arg(args, 0))?.is_nan()))
}

fn global_is_finite(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    Ok(Value::Bool(vm.number_of(&arg(args, 0))?.is_finite()))
}
