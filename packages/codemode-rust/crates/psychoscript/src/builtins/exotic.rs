//! Behaviour of standard-library kinds that the generic object model reaches through small hooks: accessor
//! properties, indexed elements, console and JSON forms.

use super::{bytes, regexp};
use crate::object::*;
use crate::value::{Id, Value};
use crate::vm::{Res, Vm};

/// Whether `kind` has properties the hooks below provide.
#[inline]
pub fn is_exotic(kind: &Kind) -> bool {
    matches!(
        kind,
        Kind::RegExp(_) | Kind::Bytes(_) | Kind::TextDecoder(_)
    )
}

/// An own accessor or element of an exotic object, if `key` names one.
pub fn get(vm: &mut Vm, id: Id, key: Atom) -> Option<Value> {
    match &vm.heap[id as usize].kind {
        Kind::RegExp(_) => regexp::get_prop(vm, id, key),
        Kind::Bytes(_) => bytes::get_prop(vm, id, key),
        Kind::TextDecoder(_) => bytes::decoder_prop(vm, id, key),
        _ => None,
    }
}

/// Writes an accessor or element; `None` when `key` is an ordinary property.
pub fn set(vm: &mut Vm, id: Id, key: Atom, val: Value) -> Option<Result<(), Value>> {
    match &vm.heap[id as usize].kind {
        Kind::RegExp(_) => regexp::set_prop(vm, id, key, val),
        Kind::Bytes(_) => bytes::set_prop(vm, id, key, val),
        _ => None,
    }
}

/// Whether `key` is an own element of an exotic object.
pub fn has_own(vm: &Vm, id: Id, key: Atom) -> bool {
    match &vm.heap[id as usize].kind {
        Kind::Bytes(_) => bytes::has_own(vm, id, key),
        _ => false,
    }
}

/// Deletes an element; `None` when `key` is an ordinary property.
pub fn delete(vm: &mut Vm, id: Id, key: Atom) -> Option<Result<bool, Value>> {
    match &vm.heap[id as usize].kind {
        Kind::Bytes(_) if bytes::has_own(vm, id, key) => {
            let k = vm.atoms.text(key).to_owned();
            Some(Err(vm.type_error(&format!(
                "Cannot delete property '{k}' of [object Uint8Array]"
            ))))
        }
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
        Kind::WeakSet(_) => Some("WeakSet { <items unknown> }".into()),
        _ => None,
    }
}

/// The value a JSON walk serializes in place of an exotic object, after `toJSON`. `boundary` is the host boundary.
pub fn json_value(vm: &mut Vm, v: &Value, boundary: bool) -> Res {
    let Value::Obj(id) = v else { return Ok(*v) };
    match &vm.heap[*id as usize].kind {
        Kind::Bytes(_) => bytes::json_value(vm, *id, boundary),
        _ => Ok(*v),
    }
}
