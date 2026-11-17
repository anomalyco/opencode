//! Live iterators over standard-library collections, and the shared iterator prototype's `next`.

use crate::object::*;
use crate::value::{Id, Value};
use crate::vm::{Res, Vm};

pub fn setup(vm: &mut Vm) {
    let ip = vm.realm.iter_proto;
    vm.method(ip, "next", 0, iter_next);
}

/// A live iterator over the elements of `target`.
pub fn exotic_iter(vm: &mut Vm, target: Id, kind: IterKind) -> Value {
    let proto = vm.realm.iter_proto;
    Value::Obj(vm.alloc(Obj::new(
        Some(proto),
        Kind::ExoticIter {
            target,
            pos: 0,
            kind,
        },
    )))
}

fn exotic_step(vm: &mut Vm, id: Id) -> Option<Value> {
    let Kind::ExoticIter { target, pos, kind } = vm.heap[id as usize].kind else {
        return None;
    };
    let v = match &vm.heap[target as usize].kind {
        Kind::Bytes(_) => super::bytes::iter_step(vm, target, pos as usize, kind),
        _ => None,
    };
    if v.is_some()
        && let Kind::ExoticIter { pos, .. } = &mut vm.heap[id as usize].kind
    {
        *pos += 1;
    }
    v
}

fn iter_next(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let r = match this {
        Value::Obj(id) if matches!(vm.heap[id as usize].kind, Kind::ExoticIter { .. }) => {
            exotic_step(vm, id)
        }
        _ => vm.iter_step(&this)?,
    };
    Ok(match r {
        Some(v) => vm.iter_result(v, false),
        None => vm.iter_result(Value::Undef, true),
    })
}
