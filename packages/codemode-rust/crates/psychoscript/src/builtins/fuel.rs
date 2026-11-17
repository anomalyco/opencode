//! The fuel the reference spends on the built-ins it writes in Code Mode itself, its bytecode prelude
//! (`packages/codemode/src/prelude/source.ts`), so a busy loop built on them starts queued host calls at the same
//! step (see `HANDOVER_FUEL` in `vm.rs`).
//!
//! The reference's interpreter spends one unit on a call into a bytecode function and on a loop back-edge, and fifty on
//! a call of a native, the prelude's `$` helpers included; its `VmIntrinsic`s (`$IsArray`, `$Call`) are free, and
//! `$Call` is lowered to a plain call of the callback. Each built-in below spends what its prelude function's bytecode
//! does, in the same order, for every check point counts: the reference refills its fuel where it runs out, so the
//! order of the charges matters, not only their sum. Callbacks are called with `Vm::call_counted`, as bytecode calls
//! them; a closure's frame costs its one unit on entry.
//!
//! A prelude function installed as the method itself (`Array.prototype.forEach`) is entered with one unit instead of
//! a native call's fifty, so such a built-in ends with `Vm::bytecode_builtin`. A native that hands its work on to
//! the prelude (`Array.from`, `sort` with a comparator) spends its own fifty first, then the prelude function's unit.

use crate::bytecode::ITER_FOR_OF;
use crate::value::Value;
use crate::vm::Vm;

/// A call into a bytecode function.
pub const FN: i32 = 1;
/// A loop back-edge.
pub const LOOP: i32 = 1;
/// A call of a native, a `$` helper included.
pub const NATIVE: i32 = 50;

/// Entering `Array$prototype$forEach` (and `map`, `filter`, `some`, `every`, the find methods, `reduce` and
/// `reduceRight`), up to its `$Receiver` check.
pub fn method(vm: &mut Vm) {
    vm.fuel(FN);
}

/// The `$Receiver` check passed, and the shared item loop (`forEachItem`, `mapItems`, ...) entered, up to its
/// `$Callback` check.
pub fn receiver_then_loop(vm: &mut Vm) {
    vm.fuel(NATIVE);
    vm.fuel(FN);
}

/// A `$` helper's call returned: `$Callback`, `$Receiver`, `$Table`, `String`.
pub fn native(vm: &mut Vm) {
    vm.fuel(NATIVE);
}

/// One loop iteration ended at its back-edge.
#[inline]
pub fn step(vm: &mut Vm) {
    vm.fuel(LOOP);
}

/// A native built-in (`Array.from`, `sort`) handing its work on to a prelude function: its own call, then the
/// prelude function's entry.
pub fn handoff(vm: &mut Vm) {
    vm.fuel(NATIVE);
    vm.fuel(FN);
}

/// A prelude `for...of` over `source`: opened as the reference opens it (free for a value it walks itself, else a
/// call of its `Symbol.iterator` method), `body` run on each value, and a back-edge spent after each. `body`
/// returning `false` leaves the loop, closing the iterator as a `return` inside the loop does; returns whether it
/// left early.
pub fn for_of(
    vm: &mut Vm,
    source: &Value,
    mut body: impl FnMut(&mut Vm, Value) -> Result<bool, Value>,
) -> Result<bool, Value> {
    let open = vm.open_fuel(source, ITER_FOR_OF);
    let it = vm.get_iterator(source)?;
    vm.fuel(open);
    while let Some(x) = vm.iter_step(&it)? {
        match body(vm, x) {
            Ok(true) => step(vm),
            Ok(false) => {
                let close = vm.close_fuel(&it);
                vm.iter_close(&it)?;
                vm.fuel(close);
                return Ok(true);
            }
            Err(e) => {
                if vm.fatal.is_none() {
                    let close = vm.close_fuel(&it);
                    let _ = vm.iter_close(&it);
                    vm.fuel(close);
                }
                return Err(e);
            }
        }
    }
    Ok(false)
}
