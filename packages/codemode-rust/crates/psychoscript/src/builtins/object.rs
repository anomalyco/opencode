//! Object, Function, Error, Boolean, Symbol, JSON, console and the global functions.

use super::{arg, fuel, this_obj};
use crate::convert;
use crate::object::*;
use crate::ops::Hint;
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
    // `Symbol` is neither a callback nor a constructor: `new Symbol()` asks for a call instead, as the reference does.
    vm.heap[symbol as usize].flags |= NOT_CALLBACK;
    if let Kind::Native { ctor, .. } = &mut vm.heap[symbol as usize].kind {
        *ctor = false;
    }
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
        Value::Obj(id) if !vm.is_namespace(id) => Ok(Value::Obj(id)),
        // The reference names the host's typeof, which is "object" for a namespace.
        v => {
            let t = match v {
                Value::Obj(_) => "object",
                v => vm.type_of(&v),
            };
            Err(vm.type_error(&format!(
                "Object({t}) wrapper objects are not supported; use the primitive value directly."
            )))
        }
    }
}

fn entries_of(vm: &mut Vm, label: &str, v: &Value) -> Result<Vec<(Value, Value)>, Value> {
    vm.enumerable_source(label, v)?;
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
    // A namespace lists its names.
    if let Value::Obj(id) = v
        && (vm.is_namespace(id) || !vm.is_promise(id))
    {
        let keys = match vm.is_namespace(id) {
            true => vm.namespace_names(id)?,
            false => vm.own_keys(id),
        };
        let items = keys
            .into_iter()
            .map(|k| Value::Str(vm.atoms.atom_str(k)))
            .collect();
        return Ok(vm.new_array(items));
    }
    let items = entries_of(vm, "Object.keys(...)", &v)?
        .into_iter()
        .map(|(k, _)| k)
        .collect();
    Ok(vm.new_array(items))
}

fn object_values(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let items = entries_of(vm, "Object.values(...)", &arg(args, 0))?
        .into_iter()
        .map(|(_, v)| v)
        .collect();
    Ok(vm.new_array(items))
}

fn object_entries(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let pairs = entries_of(vm, "Object.entries(...)", &arg(args, 0))?;
    let items = pairs
        .into_iter()
        .map(|(k, v)| vm.new_array(vec![k, v]))
        .collect();
    Ok(vm.new_array(items))
}

fn object_assign(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let target = arg(args, 0);
    let t = match target {
        Value::Obj(t) if !vm.is_namespace(t) => t,
        _ => {
            let d = super::describe_value(vm, &target);
            return Err(vm.type_error(&format!(
                "Object.assign expects a data object or array target, received {d}."
            )));
        }
    };
    for src in args.iter().skip(1) {
        if src.is_nullish() {
            continue;
        }
        vm.enumerable_source("Object.assign(...)", src)?;
        if let Value::Obj(s) = src {
            let mut entries = vm.own_entries(*s);
            entries.extend(vm.own_symbol_entries(*s));
            // The reference sets the fields as they are, on a promise too.
            let promise = vm.is_promise(t);
            for (k, v) in entries {
                vm.reject_circular(t, &v, "Object.assign result")?;
                if promise {
                    vm.define(t, k, v);
                } else {
                    vm.set_obj(t, k, v)?;
                }
            }
        } else {
            vm.copy_props(t, src, &[])?;
        }
    }
    Ok(target)
}

fn object_from_entries(vm: &mut Vm, _this: Value, args: &[Value], callee: Id) -> Res {
    // The reference's for...of over the entries: each entry is read as it comes, and a bad one closes the iterator.
    // Its fuel is the prelude's `Object$fromEntries` (see `fuel.rs`).
    fuel::method(vm);
    let source = arg(args, 0);
    if !vm.is_iterable(&source) {
        return Err(vm.not_iterable(&source, crate::bytecode::ITER_FOR_OF));
    }
    let id = vm.new_object();
    crate::native::enter_for_of_sub(
        vm,
        crate::native::NativeOp::Callbacks,
        SUB_FROM_ENTRIES,
        callee,
        Value::Undef,
        source,
        &[Value::Obj(id), Value::Undef],
    )
}

/// `Object.fromEntries` over its entries: its own slots are the object it fills and the value of an entry whose key
/// is converted by a call.
struct FromEntries;

impl crate::native::ForOf for FromEntries {
    fn item(vm: &mut Vm, fr: crate::native::Frame, x: Value) -> Result<crate::native::Flow, Value> {
        // One entry: `$IsObject`, `String` of its key, `$Define`.
        fuel::native(vm);
        if !matches!(x, Value::Obj(_)) || contains_opaque(vm, &x, &mut Vec::new()) {
            return Err(vm.type_error("Object.fromEntries expects [key, value] entry objects."));
        }
        let k = vm.get_elem(&x, &Value::Num(0.0))?;
        let v = vm.get_elem(&x, &Value::Num(1.0))?;
        if vm.converts_by_call(&k, Hint::String) {
            fr.set(vm, crate::native::FOR_OF_SLOTS + 1, v);
            let step = super::convert_catching(vm, fr, k, Hint::String)?;
            return Ok(crate::native::Flow::Call(step));
        }
        define_entry(vm, fr, &k, v)?;
        Ok(crate::native::Flow::Next)
    }

    fn returned(
        vm: &mut Vm,
        fr: crate::native::Frame,
        r: crate::value::Slot,
    ) -> Result<crate::native::Flow, Value> {
        let v = fr.get(vm, crate::native::FOR_OF_SLOTS + 1);
        define_entry(vm, fr, &r.get(), v)?;
        Ok(crate::native::Flow::Next)
    }

    fn finish(vm: &mut Vm, fr: crate::native::Frame) -> Res {
        vm.bytecode_builtin();
        Ok(fr.get(vm, crate::native::FOR_OF_SLOTS))
    }
}

/// An entry's key made a property key, then its value defined.
fn define_entry(vm: &mut Vm, fr: crate::native::Frame, k: &Value, v: Value) -> Result<(), Value> {
    let id = fr
        .get(vm, crate::native::FOR_OF_SLOTS)
        .as_obj()
        .unwrap_or(0);
    let a = vm.key_of(k)?;
    fuel::native(vm);
    vm.define(id, a, v);
    fuel::native(vm);
    Ok(())
}

fn object_has_own(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let o = arg(args, 0);
    vm.enumerable_source("Object.hasOwn(...)", &o)?;
    let k = vm.key_of(&arg(args, 1))?;
    Ok(Value::Bool(match o {
        Value::Obj(id) => vm.has_own(id, k),
        // A string reads as the array of its characters.
        Value::Str(s) => {
            k == vm.names.length
                || vm
                    .atoms
                    .index(k)
                    .is_some_and(|i| (i as usize) < vm.atoms.sref(s).len16())
        }
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
        // A namespace is no object: as a primitive, it is frozen and sealed.
        Value::Obj(id) if !vm.is_namespace(id) => {
            let o = &vm.heap[id as usize];
            // An arguments object always has its own `length`, so it is never empty.
            let empty = o.props.len() == 0
                && !matches!(&o.kind, Kind::Array(items) if !items.is_empty())
                && !matches!(&o.kind, Kind::Arguments(_));
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
        Value::Obj(id) if !vm.is_namespace(id) => vm.heap[id as usize].flags & NON_EXTENSIBLE == 0,
        _ => false,
    }))
}

fn object_create(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let proto = match arg(args, 0) {
        Value::Obj(p) if !vm.is_namespace(p) => Some(p),
        Value::Null => None,
        _ => return Err(vm.type_error("Object prototype may only be an Object or null.")),
    };
    if !matches!(arg(args, 1), Value::Undef) {
        return Err(vm.type_error(
            "Object.create property descriptors are not supported; assign the fields after creating the object.",
        ));
    }
    Ok(Value::Obj(vm.alloc(Obj::new(proto, Kind::Ordinary))))
}

fn object_get_prototype_of(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    Ok(match arg(args, 0) {
        Value::Obj(id) if !vm.is_namespace(id) => vm.heap[id as usize]
            .proto
            .map(Value::Obj)
            .unwrap_or(Value::Null),
        Value::Str(_) => Value::Obj(vm.realm.string_proto),
        Value::Num(_) => Value::Obj(vm.realm.number_proto),
        Value::Bool(_) => Value::Obj(vm.realm.boolean_proto),
        v => {
            let d = super::describe_value(vm, &v);
            return Err(vm.type_error(&format!(
                "Object.getPrototypeOf cannot convert {d} to an object."
            )));
        }
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
/// would box) and namespace references are rejected.
fn object_receiver(vm: &mut Vm, this: &Value, method: &str) -> Result<Id, Value> {
    if let Value::Obj(id) = this
        && !matches!(vm.heap[*id as usize].kind, Kind::Namespace(_))
    {
        return Ok(*id);
    }
    Err(super::incompatible(
        vm,
        &format!("Object.prototype.{method}"),
        this,
    ))
}

fn is_namespace_ref(vm: &Vm, v: &Value) -> bool {
    matches!(v, Value::Obj(id) if matches!(vm.heap[*id as usize].kind, Kind::Namespace(_)))
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
    // The reference has no tag of its own for a symbol.
    if let Value::Sym(_) = this {
        return Ok(vm.static_str("[object Object]"));
    }
    let t = format!("[object {}]", tag_of(vm, &this));
    Ok(vm.static_str(&t))
}

fn proto_to_locale_string(vm: &mut Vm, this: Value, _args: &[Value], callee: Id) -> Res {
    // A symbol has no prototype to find the method on, as null and undefined have none.
    if this.is_nullish() || is_namespace_ref(vm, &this) || matches!(this, Value::Sym(_)) {
        return Err(vm.type_error("Object.prototype.toLocaleString called on null or undefined."));
    }
    let k = vm.names.to_string;
    let f = vm.get(&this, k)?;
    // The reference hands on to `toString` as `call` does (`invokeMethod`).
    invoke(vm, callee, f, this, &[])
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
    // A sparse array's far elements are properties, read below.
    if let Kind::Array(items) = &o.kind
        && let Some(i) = vm.atoms.index(k)
        && items
            .get(i as usize)
            .is_some_and(|v| !matches!(v, Value::Uninit))
    {
        return Ok(Value::Bool(true));
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

/// The receiver of `Function.prototype.call`, `apply` or `bind`, which must be callable.
fn function_receiver(vm: &mut Vm, this: &Value, method: &str) -> Result<(), Value> {
    if vm.is_callable(this) && !matches!(this, Value::Obj(id) if vm.is_namespace(*id)) {
        return Ok(());
    }
    let d = vm.describe_data(this);
    Err(vm.type_error(&format!(
        "Function.prototype.{method} called on incompatible receiver {d}."
    )))
}

fn function_call(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    function_receiver(vm, &this, "call")?;
    let rest = if args.is_empty() { &[][..] } else { &args[1..] };
    invoke(vm, callee, this, arg(args, 0), rest)
}

/// Calls `f` as the reference's `call` and `apply` do: they cost a native call before they hand on to `f`, which
/// costs what a call of it from bytecode costs (see `fuel.rs`). The call is made from a native frame.
fn invoke(vm: &mut Vm, callee: Id, f: Value, this: Value, args: &[Value]) -> Res {
    super::fuel::native(vm);
    let mut slots = vec![f, this, Value::Num(args.len() as f64)];
    slots.extend_from_slice(args);
    vm.enter_native(
        crate::native::NativeOp::Invoke,
        callee,
        Value::Undef,
        &slots,
    )
}

/// The step of `call` and `apply`'s frame: its slots are the function, the receiver, the argument count and the
/// arguments.
pub(crate) fn invoke_step(
    vm: &mut Vm,
    fr: crate::native::Frame,
    input: crate::native::Input,
) -> Result<crate::native::Step, Value> {
    use crate::native::{Input, Step};
    match input {
        Input::Start => {
            let (f, this, argc) = (fr.slot(vm, 0), fr.slot(vm, 1), fr.index(vm, 2));
            let at = fr.base() + 3;
            let args: Vec<_> = vm.stack[at..at + argc].to_vec();
            vm.stack.extend_from_slice(&[f, this]);
            vm.stack.extend_from_slice(&args);
            vm.native_call(argc)
        }
        Input::Returned(r) => {
            vm.bytecode_builtin();
            Ok(Step::Done(r.get()))
        }
        Input::Threw(e) => Err(e),
        Input::Finished(_) => Ok(Step::Done(Value::Undef)),
    }
}

fn function_apply(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    function_receiver(vm, &this, "apply")?;
    let list = match arg(args, 1) {
        Value::Undef | Value::Null => Vec::new(),
        Value::Obj(id) if !vm.is_namespace(id) => array_like(vm, &Value::Obj(id))?,
        _ => {
            return Err(
                vm.type_error("Function.prototype.apply expects an array-like argument list.")
            );
        }
    };
    invoke(vm, callee, this, arg(args, 0), &list)
}

pub fn array_like(vm: &mut Vm, v: &Value) -> Result<Vec<Value>, Value> {
    let Value::Obj(id) = v else {
        return Ok(Vec::new());
    };
    if let Kind::Array(_) = &vm.heap[*id as usize].kind {
        vm.densify(*id)?;
        if let Kind::Array(items) = &vm.heap[*id as usize].kind {
            return Ok(crate::ops::without_holes(items));
        }
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
    function_receiver(vm, &this, "bind")?;
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
    let mut c = fuel::Conversions::default();
    let message = error_message(vm, &mut c, arg(args, 0))?;
    let r = make_error_from(vm, proto, &message, &arg(args, 1));
    c.finish(vm, r)
}

/// An error constructor's message, when there is one, is its list of conversions, made a string.
fn error_message(vm: &mut Vm, c: &mut fuel::Conversions, message: Value) -> Res {
    let mut m = [message];
    if !matches!(message, Value::Undef) {
        c.convert(vm, &[Hint::String], &mut m, true)?;
    }
    Ok(m[0])
}

fn aggregate_error_ctor(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    let proto = vm
        .native_data(callee)
        .as_obj()
        .unwrap_or(vm.realm.aggregate_error_proto);
    let mut c = fuel::Conversions::default();
    let message = error_message(vm, &mut c, arg(args, 1))?;
    let e = make_error_from(vm, proto, &message, &arg(args, 2))?;
    // The errors are read in the reference's prelude (`aggregateError`), after the call itself when it is not `new`.
    let called = !matches!(this, Value::Uninit);
    if called {
        c.handoff(vm);
    } else {
        fuel::method(vm);
    }
    let source = arg(args, 0);
    if !vm.is_iterable(&source) {
        return Err(vm.not_iterable(&source, crate::bytecode::ITER_FOR_OF));
    }
    let errors = vm.new_array(Vec::new());
    let own = [e, errors, Value::Bool(called)];
    crate::native::enter_for_of_sub(
        vm,
        crate::native::NativeOp::Callbacks,
        SUB_AGGREGATE,
        callee,
        Value::Undef,
        source,
        &own,
    )
}

/// `AggregateError` reading its errors: its own slots are the error, the errors read so far (an internal array) and
/// whether it was called without `new`.
struct Aggregate;

impl crate::native::ForOf for Aggregate {
    fn item(vm: &mut Vm, fr: crate::native::Frame, x: Value) -> Result<crate::native::Flow, Value> {
        let errors = fr.get(vm, crate::native::FOR_OF_SLOTS + 1).as_obj();
        if let Some(errors) = errors
            && let Kind::Array(items) = &mut vm.heap[errors as usize].kind
        {
            items.push(x);
        }
        Ok(crate::native::Flow::Next)
    }

    fn finish(vm: &mut Vm, fr: crate::native::Frame) -> Res {
        let base = crate::native::FOR_OF_SLOTS;
        let (e, errors) = (fr.get(vm, base), fr.get(vm, base + 1));
        fuel::native(vm);
        if let Value::Obj(id) = e {
            let ek = vm.names.errors;
            vm.define_hidden(id, ek, errors);
        }
        if vm.truthy(&fr.get(vm, base + 2)) {
            vm.bytecode_builtin();
        }
        Ok(e)
    }
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
        return Err(vm.type_error(
            "new Boolean(...) is not supported; call Boolean(...) without new instead.",
        ));
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
    Err(vm.type_error(
        "Symbol is not callable; only Symbol.asyncIterator and Symbol.iterator are available.",
    ))
}

fn symbol_to_string(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let s = if let Value::Sym(s) = this { s } else { 0 };
    Ok(vm.atom_val(s))
}

// ---------- JSON ----------

fn json_parse(vm: &mut Vm, _this: Value, args: &[Value], callee: Id) -> Res {
    let mut c = fuel::Conversions::default();
    let r = parse(vm, &mut c, args, callee);
    c.finish(vm, r)
}

/// `JSON.parse` after its text, a list of conversions of its own.
fn parse(vm: &mut Vm, c: &mut fuel::Conversions, args: &[Value], callee: Id) -> Res {
    let mut text = [arg(args, 0)];
    c.convert(vm, &[Hint::String], &mut text, false)?;
    let text = vm.string_of(&text[0])?;
    let text = vm.text(text).to_owned();
    let v = convert::parse(vm, &text)?;
    let reviver = arg(args, 1);
    if vm.type_of(&reviver) != "function" {
        return Ok(v);
    }
    let reviver = super::require_callback(vm, &reviver, "JSON.parse")?;
    let holder = vm.new_object();
    let empty = vm.atoms.intern_static("");
    vm.define(holder, empty, v);
    // The reference revives in its prelude (`revive`), after `JSON.parse`'s own call.
    c.call(vm);
    let key = vm.static_str("");
    let op = crate::native::NativeOp::Revive;
    vm.enter_native(op, callee, Value::Undef, &[reviver, Value::Num(0.0)])?;
    push_level(vm, Value::Obj(holder), key);
    Ok(Value::Undef)
}

// The slots of a reviving frame: the reviver and how many levels deep it is; then, per level, the holder, the key, the
// value, the value's keys (an internal array, or undefined for a primitive) and the next of them to revive.
const REV_F: usize = 0;
const REV_DEPTH: usize = 1;
const REV_LEVELS: usize = 2;
const LEVEL: usize = 5;
const L_HOLDER: usize = 0;
const L_KEY: usize = 1;
const L_VAL: usize = 2;
const L_KEYS: usize = 3;
const L_I: usize = 4;

/// Pushes a level to revive `key` of `holder`, on top of the frame's slots.
fn push_level(vm: &mut Vm, holder: Value, key: Value) {
    vm.stack.extend(
        [holder, key, Value::Undef, Value::Undef, Value::Num(0.0)].map(crate::value::Slot::pack),
    );
}

/// The step of a reviving frame: the prelude's `revive`, entered once per value; an object's `$IsObject` and
/// `$Keys`, a back-edge per key, then the reviver, children first.
pub(crate) fn revive_step(
    vm: &mut Vm,
    fr: crate::native::Frame,
    input: crate::native::Input,
) -> Result<crate::native::Step, Value> {
    use crate::native::{Input, Step};
    let mut depth = fr.index(vm, REV_DEPTH);
    let at = |depth: usize, k: usize| REV_LEVELS + depth * LEVEL + k;
    // Whether the level on top is visited already, its keys walked from `L_I`.
    let mut visited = false;
    match input {
        Input::Start => {}
        Input::Returned(nv) => {
            let nv = nv.get();
            if depth == 0 {
                vm.bytecode_builtin();
                return Ok(Step::Done(nv));
            }
            vm.stack.truncate(fr.base() + at(depth, 0));
            depth -= 1;
            fr.set_index(vm, REV_DEPTH, depth);
            let val = fr.get(vm, at(depth, L_VAL));
            let keys = fr.get(vm, at(depth, L_KEYS)).as_obj().unwrap_or(0);
            let i = fr.index(vm, at(depth, L_I));
            let k = match &vm.heap[keys as usize].kind {
                Kind::Array(items) => items.get(i).copied().unwrap_or_default(),
                _ => Value::Undef,
            };
            let k = vm.key_of(&k)?;
            if let Value::Undef = nv {
                vm.delete(&val, k)?;
            } else if let Value::Obj(id) = val {
                vm.set_obj(id, k, nv)?;
            }
            fuel::step(vm);
            fr.set_index(vm, at(depth, L_I), i + 1);
            visited = true;
        }
        Input::Threw(e) => return Err(e),
        Input::Finished(_) => {}
    }
    loop {
        let (holder, key) = (
            fr.get(vm, at(depth, L_HOLDER)),
            fr.get(vm, at(depth, L_KEY)),
        );
        if !visited {
            fuel::method(vm);
            let k = vm.key_of(&key)?;
            let val = vm.get(&holder, k)?;
            fuel::native(vm);
            fr.set(vm, at(depth, L_VAL), val);
            if let Value::Obj(id) = val {
                let keys: Vec<Value> = vm
                    .own_keys(id)
                    .into_iter()
                    .map(|a| vm.atom_val(a))
                    .collect();
                fuel::native(vm);
                let keys = vm.new_array(keys);
                fr.set(vm, at(depth, L_KEYS), keys);
            }
        }
        let val = fr.get(vm, at(depth, L_VAL));
        let next_key = match fr
            .get(vm, at(depth, L_KEYS))
            .as_obj()
            .map(|k| &vm.heap[k as usize].kind)
        {
            Some(Kind::Array(items)) => items.get(fr.index(vm, at(depth, L_I))).copied(),
            _ => None,
        };
        if let Some(k) = next_key {
            push_level(vm, val, k);
            depth += 1;
            fr.set_index(vm, REV_DEPTH, depth);
            visited = false;
            continue;
        }
        let f = fr.slot(vm, REV_F);
        let (holder, key, val) = (
            crate::value::Slot::pack(holder),
            crate::value::Slot::pack(key),
            crate::value::Slot::pack(val),
        );
        return fr.call_slots(vm, f, holder, [key, val]);
    }
}

fn json_stringify(vm: &mut Vm, _this: Value, args: &[Value], callee: Id) -> Res {
    let replacer = arg(args, 1);
    let mut opts = convert::Stringify {
        indent: String::new(),
        replacer_fn: None,
        allow: None,
    };
    if vm.type_of(&replacer) == "function" {
        opts.replacer_fn = Some(super::require_callback(vm, &replacer, "JSON.stringify")?);
    } else if let Value::Obj(id) = replacer
        && matches!(vm.heap[id as usize].kind, Kind::Array(_))
        && vm.densify(id).is_ok()
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
        Value::Str(s) => opts.indent = vm.atoms.sref(s).slice16(0, 10),
        _ => {}
    }
    let v = arg(args, 0);
    match convert::stringify(vm, &v, &opts)? {
        Some(Some(s)) => Ok(vm.string_val(s)),
        Some(None) => Ok(Value::Undef),
        None => convert::enter_stringify(vm, callee, v, opts),
    }
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

/// Whether a value holds an opaque reference (a function, promise, iterator or namespace path) anywhere in the
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
    for v in [data, arg(args, 1)] {
        if let Value::Obj(id) = v
            && matches!(vm.heap[id as usize].kind, Kind::Array(_))
        {
            vm.densify(id)?;
        }
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
    let listed = [arg(args, 0), arg(args, 1)];
    fuel::with_primitives(vm, &[Hint::String, Hint::Number], listed, false, parse_int)
}

fn parse_int(vm: &mut Vm, [text, radix]: [Value; 2]) -> Res {
    let s = vm.string_of(&text)?;
    let mut radix = to_int32(vm.number_of(&radix)?);
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
    fuel::with_primitives(vm, &[Hint::String], [arg(args, 0)], false, |vm, [v]| {
        let s = vm.string_of(&v)?;
        Ok(Value::Num(parse_float_prefix(vm.text(s))))
    })
}

fn global_is_nan(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    fuel::with_primitives(vm, &[Hint::Number], [arg(args, 0)], false, |vm, [v]| {
        Ok(Value::Bool(vm.number_of(&v)?.is_nan()))
    })
}

fn global_is_finite(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    fuel::with_primitives(vm, &[Hint::Number], [arg(args, 0)], false, |vm, [v]| {
        Ok(Value::Bool(vm.number_of(&v)?.is_finite()))
    })
}

// The sub-ops of `NativeOp::Callbacks`; a number keeps its meaning once a snapshot may hold it.
/// `Object.fromEntries`.
pub(crate) const SUB_FROM_ENTRIES: u16 = 0;
/// `AggregateError` reading its errors.
pub(crate) const SUB_AGGREGATE: u16 = 1;
/// `Math.sumPrecise` (`builtins::string::SumPrecise`).
pub(crate) const SUB_SUM_PRECISE: u16 = 2;
/// The pairs of `new URLSearchParams(...)` and `new Headers(...)`, and the parts of one pair (`builtins::web`).
pub(crate) const SUB_PAIRS: u16 = 3;
pub(crate) const SUB_PAIR: u16 = 4;
/// `JSON.stringify`'s internal walk (`convert::stringify_step`).
pub(crate) const SUB_STRINGIFY: u16 = 5;
/// The program result's crossing to the host, which calls a `toJSON` of the program's (`cross::frame_step`).
pub(crate) const SUB_CROSS: u16 = 6;
/// A synchronous host call waiting for promises in its arguments (`cross::wait_step`).
pub(crate) const SUB_HOST_WAIT: u16 = 7;

/// The steps of this family's native frames (`native::NativeOp::Callbacks`), by sub-op; see `native.rs`.
pub(crate) fn family_step(
    vm: &mut Vm,
    sub: u16,
    fr: crate::native::Frame,
    input: crate::native::Input,
) -> Result<crate::native::Step, Value> {
    use crate::native::for_of_step;
    match sub {
        SUB_FROM_ENTRIES => for_of_step::<FromEntries>(vm, fr, input),
        SUB_AGGREGATE => for_of_step::<Aggregate>(vm, fr, input),
        SUB_SUM_PRECISE => for_of_step::<super::string::SumPrecise>(vm, fr, input),
        SUB_PAIRS => for_of_step::<super::web::Pairs>(vm, fr, input),
        SUB_PAIR => for_of_step::<super::web::Pair>(vm, fr, input),
        SUB_STRINGIFY => convert::stringify_step(vm, fr, input),
        SUB_CROSS => crate::cross::frame_step(vm, fr, input),
        SUB_HOST_WAIT => crate::cross::wait_step(vm, fr, input),
        _ => Ok(crate::native::Step::Done(Value::Undef)),
    }
}
