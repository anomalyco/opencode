//! Behaviour of standard-library kinds that the generic object model reaches through small hooks: accessor
//! properties, indexed elements, console and JSON forms.

use super::regexp;
use crate::object::*;
use crate::value::{Id, Value};
use crate::vm::{Res, Vm};

/// Whether `kind` has properties the hooks below provide.
#[inline]
pub fn is_exotic(kind: &Kind) -> bool {
    matches!(kind, Kind::RegExp(_))
}

/// An own accessor or element of an exotic object, if `key` names one.
pub fn get(vm: &mut Vm, id: Id, key: Atom) -> Option<Value> {
    match &vm.heap[id as usize].kind {
        Kind::RegExp(_) => regexp::get_prop(vm, id, key),
        _ => None,
    }
}

/// Writes an accessor or element; `None` when `key` is an ordinary property.
pub fn set(vm: &mut Vm, id: Id, key: Atom, val: Value) -> Option<Result<(), Value>> {
    match &vm.heap[id as usize].kind {
        Kind::RegExp(_) => regexp::set_prop(vm, id, key, val),
        _ => None,
    }
}

/// Whether `key` is an own element of an exotic object.
pub fn has_own(_vm: &Vm, _id: Id, _key: Atom) -> bool {
    false
}

/// The number of indexed own elements, listed before ordinary keys.
pub fn index_len(_vm: &Vm, _id: Id) -> usize {
    0
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
        _ => None,
    }
}

/// The value a JSON walk serializes in place of an exotic object, after `toJSON`. `boundary` is the host boundary.
pub fn json_value(_vm: &mut Vm, v: &Value, _boundary: bool) -> Res {
    Ok(*v)
}
