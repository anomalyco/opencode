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

use std::borrow::Cow;

use crate::bytecode::ITER_FOR_OF;
use crate::ops::Hint;
use crate::value::Value;
use crate::vm::{Res, Vm};

/// A call into a bytecode function.
pub const FN: i32 = 1;
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
    vm.fuel_step();
}

/// A native built-in (`Array.from`, `sort`) handing its work on to a prelude function: its own call, then the
/// prelude function's entry.
pub fn handoff(vm: &mut Vm) {
    vm.fuel(NATIVE);
    vm.fuel(FN);
}

/// The reference's `withPrimitives`: a built-in lists the values it needs as primitives, and once a list holds an
/// object it returns, the reference converts the list in its internal bytecode (`$vmConvert`), then runs the
/// built-in again on the primitives. A call from bytecode has spent the built-in's fifty by then, so it is spent before
/// the first conversion and the call costs nothing more; a later list costs that loop's back-edge. Each listed value,
/// a primitive too, costs a back-edge after its ToPrimitive (`Vm::primitive_of`, which spends that call's fuel). A
/// list of primitives costs nothing. One per built-in call, ended with `finish`.
#[derive(Default)]
pub struct Conversions {
    requested: bool,
    paid: bool,
}

impl Conversions {
    /// Converts `values` in place, in order, the value at `i` with `hints[i]` (the last hint for those past the end;
    /// every built-in names at least one). With `coerce`, each is also made a number or a string by its hint before
    /// the next converts.
    pub fn convert(
        &mut self,
        vm: &mut Vm,
        hints: &[Hint],
        values: &mut [Value],
        coerce: bool,
    ) -> Result<(), Value> {
        if !values.iter().any(|v| matches!(v, Value::Obj(_))) {
            return Ok(());
        }
        if self.requested {
            step(vm);
        } else {
            self.requested = true;
            if vm.host.meter.counted {
                vm.fuel(NATIVE);
                self.paid = true;
            }
        }
        // A list holding an object whose conversion calls the program is converted in a convert frame, and the
        // built-in run again with it (see `conversion.rs`).
        if let Some(r) = vm.restartable_list(hints, values, coerce) {
            let list = r?;
            for (v, c) in values.iter_mut().zip(list) {
                *v = c;
            }
            return Ok(());
        }
        for (i, v) in values.iter_mut().enumerate() {
            let hint = hints[i.min(hints.len() - 1)];
            *v = vm.primitive_of(v, hint)?;
            if coerce {
                *v = match hint {
                    Hint::String => Value::Str(vm.string_of(v)?),
                    _ => Value::Num(vm.number_of(v)?),
                };
            }
            step(vm);
        }
        Ok(())
    }

    /// `values` as `convert` leaves them, copied only when one is an object.
    pub fn converted<'a>(
        &mut self,
        vm: &mut Vm,
        hints: &[Hint],
        values: &'a [Value],
        coerce: bool,
    ) -> Result<Cow<'a, [Value]>, Value> {
        if !values.iter().any(|v| matches!(v, Value::Obj(_))) {
            return Ok(Cow::Borrowed(values));
        }
        let mut owned = values.to_vec();
        self.convert(vm, hints, &mut owned, coerce)?;
        Ok(Cow::Owned(owned))
    }

    /// The built-in's own fifty where a built-in handing its work on spends it, unless its conversions spent it.
    pub fn call(&self, vm: &mut Vm) {
        if !self.paid {
            vm.fuel(NATIVE);
        }
    }

    /// A native handing its work on to a prelude function after its conversions (see `handoff`).
    pub fn handoff(&self, vm: &mut Vm) {
        self.call(vm);
        vm.fuel(FN);
    }

    /// Ends the built-in with `r`: once it spent its call's fifty, the call costs nothing more.
    pub fn finish<T>(&self, vm: &mut Vm, r: Result<T, Value>) -> Result<T, Value> {
        if self.paid && r.is_ok() {
            vm.bytecode_builtin();
        }
        r
    }
}

/// A built-in whose `values` are its one list of conversions (see `Conversions`): `body` runs on the primitives.
pub fn with_primitives<const N: usize>(
    vm: &mut Vm,
    hints: &[Hint],
    mut values: [Value; N],
    coerce: bool,
    body: impl FnOnce(&mut Vm, [Value; N]) -> Res,
) -> Res {
    let mut c = Conversions::default();
    c.convert(vm, hints, &mut values, coerce)?;
    let r = body(vm, values);
    c.finish(vm, r)
}

/// `with_primitives` over a list of any length.
pub fn with_primitive_list(
    vm: &mut Vm,
    hints: &[Hint],
    values: &[Value],
    coerce: bool,
    body: impl FnOnce(&mut Vm, &[Value]) -> Res,
) -> Res {
    let mut c = Conversions::default();
    let values = c.converted(vm, hints, values, coerce)?;
    let r = body(vm, &values);
    c.finish(vm, r)
}

/// A prelude `for...of` over `source` that collects its values: opened as the reference opens it (free for a value it
/// walks itself, else a call of its `Symbol.iterator` method), and a back-edge spent after each value. Nothing runs
/// between the steps, so the loop never leaves early and closes nothing.
pub fn for_of(vm: &mut Vm, source: &Value) -> Result<Vec<Value>, Value> {
    let open = vm.open_fuel(source, ITER_FOR_OF);
    let it = vm.get_iterator(source)?;
    vm.fuel(open);
    let next = vm.record_next_of(source, &it)?;
    let mut values = Vec::new();
    while let Some(x) = vm.iter_step_with(&it, next)? {
        values.push(x);
        step(vm);
    }
    Ok(values)
}
