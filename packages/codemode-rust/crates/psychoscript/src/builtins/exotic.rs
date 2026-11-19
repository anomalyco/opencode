//! Behaviour of standard-library kinds that the generic object model reaches through small hooks: accessor
//! properties, indexed elements, console and JSON forms.

use super::{bytes, regexp, web};
use crate::object::*;
use crate::value::{Id, Value};
use crate::vm::{Res, Vm};

/// Whether `kind` has properties the hooks below provide.
#[inline]
pub fn is_exotic(kind: &Kind) -> bool {
    matches!(
        kind,
        Kind::RegExp(_)
            | Kind::Bytes(_)
            | Kind::TextDecoder(_)
            | Kind::Url(_)
            | Kind::SearchParams(_)
            | Kind::Map(_)
            | Kind::Set(_)
            | Kind::Live(_)
    )
}

/// An own accessor or element of an exotic object, if `key` names one. Out of line, so every property read does
/// not set up what the RegExp accessors need.
#[inline(never)]
pub fn get(vm: &mut Vm, id: Id, key: Atom) -> Option<Value> {
    match &vm.heap[id as usize].kind {
        Kind::RegExp(_) => regexp::get_prop(vm, id, key),
        Kind::Bytes(_) => bytes::get_prop(vm, id, key),
        Kind::TextDecoder(_) => bytes::decoder_prop(vm, id, key),
        Kind::Url(_) => web::url_get(vm, id, key),
        Kind::SearchParams(_) if key == vm.names.size => {
            Some(Value::Num(web::params_size(vm, id) as f64))
        }
        // A host accessor may run host code (a streaming body's `cancel`), so it runs where the run is driven.
        Kind::Live(l) => {
            let g = l.getter(key)?;
            Some(match crate::offload::home(&vm.host.offload) {
                Some(home) => home.run(move || g()).unwrap_or(Value::Undef),
                None => g(),
            })
        }
        _ => None,
    }
}

/// Writes an accessor or element; `None` when `key` is an ordinary property.
pub fn set(vm: &mut Vm, id: Id, key: Atom, val: Value) -> Option<Result<(), Value>> {
    match &vm.heap[id as usize].kind {
        Kind::RegExp(_) => regexp::set_prop(vm, id, key, val),
        Kind::Bytes(_) => bytes::set_prop(vm, id, key, val),
        Kind::Url(_) => web::url_set(vm, id, key, val),
        Kind::SearchParams(_) | Kind::Map(_) | Kind::Set(_) if key == vm.names.size => Some(Err(
            vm.type_error("Cannot assign to read only property 'size'."),
        )),
        Kind::Live(l) if l.has(key) => {
            let k = vm.atoms.text(key).to_owned();
            Some(Err(vm.type_error(&format!(
                "Cannot assign to read only property '{k}'."
            ))))
        }
        Kind::TextDecoder(_)
            if matches!(vm.atoms.text(key), "encoding" | "fatal" | "ignoreBOM") =>
        {
            let k = vm.atoms.text(key).to_owned();
            Some(Err(vm.type_error(&format!(
                "Cannot assign to read only property '{k}'."
            ))))
        }
        _ => None,
    }
}

/// Whether `key` is an own element of an exotic object.
pub fn has_own(vm: &Vm, id: Id, key: Atom) -> bool {
    match &vm.heap[id as usize].kind {
        Kind::Bytes(_) => bytes::has_own(vm, id, key),
        Kind::Live(l) => l.has(key),
        _ => false,
    }
}

/// Deletes an element; `None` when `key` is an ordinary property.
pub fn delete(vm: &mut Vm, id: Id, key: Atom) -> Option<Result<bool, Value>> {
    match &vm.heap[id as usize].kind {
        Kind::Bytes(_) if bytes::has_own(vm, id, key) => {
            let k = vm.atoms.text(key).to_owned();
            Some(Err(vm.type_error(&format!("Cannot delete property '{k}'."))))
        }
        Kind::Live(_) => match &mut vm.heap[id as usize].kind {
            Kind::Live(l) => l.remove(key).then_some(Ok(true)),
            _ => None,
        },
        _ => None,
    }
}

/// The number of indexed own elements, listed before ordinary keys.
pub fn index_len(vm: &Vm, id: Id) -> usize {
    match &vm.heap[id as usize].kind {
        Kind::Bytes(_) => bytes::index_len(vm, id),
        _ => 0,
    }
}

/// Whether the default ToPrimitive hint reads as a string, as for Dates.
pub fn prefers_string(vm: &Vm, id: Id) -> bool {
    matches!(vm.heap[id as usize].kind, Kind::Date(_))
}

/// The console form of an exotic object.
pub fn inspect(vm: &mut Vm, id: Id) -> Option<String> {
    match &vm.heap[id as usize].kind {
        Kind::RegExp(_) => Some(regexp::inspect(vm, id)),
        Kind::Date(t) => Some(super::date::display(*t)),
        Kind::Bytes(_) => Some(bytes::inspect(vm, id)),
        Kind::WeakMap(_) => Some("WeakMap { <items unknown> }".into()),
        Kind::Url(_) => Some(web::url_href(vm, id)),
        Kind::SearchParams(_) => Some(web::params_text(vm, id)),
        Kind::Headers(_) => Some(web::headers_inspect(vm, id)),
        Kind::WeakSet(_) => Some("WeakSet { <items unknown> }".into()),
        _ => None,
    }
}

/// Whether this run may hold a value with its own JSON form: only once the byte or web groups are installed.
#[inline(always)]
pub fn may_have_json_forms(vm: &Vm) -> bool {
    vm.realm.std.loaded & (super::LAZY_BYTES | super::LAZY_WEB) != 0
}

/// Whether a kind serializes through `json_value` rather than as its own keys.
#[inline]
pub fn has_json_form(kind: &Kind) -> bool {
    matches!(
        kind,
        Kind::Bytes(_) | Kind::Headers(_) | Kind::SearchParams(_)
    )
}

/// The value a JSON walk serializes in place of an exotic object, after `toJSON`. `boundary` is the host boundary.
/// Inlined so the walk pays only a kind test for the values that are not exotic.
#[inline(always)]
pub fn json_value(vm: &mut Vm, v: &Value, boundary: bool) -> Res {
    if let Value::Obj(id) = v
        && has_json_form(&vm.heap[*id as usize].kind)
    {
        return json_special(vm, *id, v, boundary);
    }
    Ok(*v)
}

#[inline(never)]
fn json_special(vm: &mut Vm, id: Id, v: &Value, boundary: bool) -> Res {
    match &vm.heap[id as usize].kind {
        Kind::Bytes(_) => bytes::json_value(vm, id, boundary),
        Kind::Headers(_) => Ok(web::headers_object(vm, id)),
        Kind::SearchParams(_) if boundary => {
            let s = web::params_text(vm, id);
            Ok(vm.string_val(s))
        }
        _ => Ok(*v),
    }
}
