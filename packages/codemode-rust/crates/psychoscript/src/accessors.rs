//! Accessor properties, as the reference's language layer has them: program getters and setters (`get x() {}`,
//! `Object.defineProperty`), and the companions that stand for a built-in's accessor halves.
//!
//! - An accessor property is a prop with the `ACCESSOR` flag whose value is a `Kind::Accessor` object with its two
//!   halves. A half is a function or undefined. A native half is a companion (see `companion_get`), which reads stay
//!   on the native path for; any other function is a program half, which only program code calls.
//! - The VM's property instructions call a program getter or setter as a call from the instruction (see `Vm::op_read`).
//! - A built-in reading a property (`Vm::get_obj`) cannot call the program. Inside [`Vm::with_reads`] a program
//!   getter's value comes from the table of values read ahead, or reads as undefined and is recorded as missing; the
//!   VM then runs the missing getters as program code and runs the built-in again from the start, as the reference's
//!   `withReads` and `$vmReplay` do. Anywhere else reaching one fails the built-in's call (`Reads::fault`).

use crate::native::{Frame, Input, Step};
use crate::object::*;
use crate::value::{Id, Value};
use crate::vm::{Res, Vm};

/// The program getters a built-in reads ahead (the reference's `reads`).
#[derive(Default)]
pub(crate) struct Reads {
    /// Values read ahead by receiver and key, for the built-in running again.
    pub table: Vec<(Value, Atom, Value)>,
    /// Nesting of `with_reads`.
    pub depth: u32,
    /// The getters a `with_reads` round met that are not in the table yet, by receiver and key, each once.
    pub missing: Vec<(Value, Atom)>,
    /// A program accessor a built-in reached outside `with_reads`: its call fails once it returns.
    pub fault: Option<Atom>,
}

/// One own property as the descriptor built-ins see it.
#[derive(Clone, Copy)]
pub(crate) struct OwnSlot {
    /// The value, or for an accessor its halves.
    pub value: SlotValue,
    pub writable: bool,
    pub enumerable: bool,
    pub configurable: bool,
}

#[derive(Clone, Copy)]
pub(crate) enum SlotValue {
    Data(Value),
    Accessor(Value, Value),
}

/// A property descriptor a program gave (`ToPropertyDescriptor`): a field is `Some` when the descriptor has it.
#[derive(Clone, Copy, Default)]
pub(crate) struct Descriptor {
    pub value: Option<Value>,
    pub writable: Option<bool>,
    pub get: Option<Value>,
    pub set: Option<Value>,
    pub enumerable: Option<bool>,
    pub configurable: Option<bool>,
}

impl Descriptor {
    pub fn is_accessor(&self) -> bool {
        self.get.is_some() || self.set.is_some()
    }

    pub fn is_data(&self) -> bool {
        self.value.is_some() || self.writable.is_some()
    }
}

impl Vm {
    /// An accessor property's halves, from its value.
    #[inline]
    pub(crate) fn pair(&self, v: Value) -> Accessor {
        match v {
            Value::Obj(id) => match &self.heap[id as usize].kind {
                Kind::Accessor(a) => **a,
                _ => Accessor {
                    get: Value::Undef,
                    set: Value::Undef,
                },
            },
            _ => Accessor {
                get: Value::Undef,
                set: Value::Undef,
            },
        }
    }

    pub(crate) fn new_pair(&mut self, get: Value, set: Value) -> Value {
        Value::Obj(self.alloc(Obj::new(
            None,
            Kind::Accessor(Box::new(Accessor { get, set })),
        )))
    }

    /// Whether `v` is the companion of a built-in's accessor half.
    pub(crate) fn is_companion(&self, v: &Value) -> bool {
        matches!(v, Value::Obj(id) if matches!(&self.heap[*id as usize].kind,
            Kind::Native { f, .. } if std::ptr::fn_addr_eq(*f, companion_get as crate::vm::NativeFn)
                || std::ptr::fn_addr_eq(*f, companion_set as crate::vm::NativeFn)
                || std::ptr::fn_addr_eq(*f, crate::builtins::object::restricted as crate::vm::NativeFn)))
    }

    /// Whether `v` is a half of `Function.prototype`'s `caller` or `arguments`, which always throws.
    pub(crate) fn is_restricted(&self, v: &Value) -> bool {
        matches!(v, Value::Obj(id) if matches!(&self.heap[*id as usize].kind,
            Kind::Native { f, .. } if std::ptr::fn_addr_eq(*f, crate::builtins::object::restricted as crate::vm::NativeFn)))
    }

    /// Whether an accessor half is a program function, which only program code may call.
    #[inline]
    pub(crate) fn is_program_half(&self, v: &Value) -> bool {
        matches!(v, Value::Obj(_)) && !self.is_companion(v)
    }

    /// Whether an accessor property's value has a program half.
    pub(crate) fn is_program_accessor(&self, pair: Value) -> bool {
        let a = self.pair(pair);
        self.is_program_half(&a.get) || self.is_program_half(&a.set)
    }

    /// An accessor property's value for a read that finds it on `receiver`'s chain: a companion's value, or for a
    /// program getter what `Reads` gives (or, for an instruction, the getter to call; see `Vm::op_read`).
    pub(crate) fn accessor_read(&mut self, pair: Value, receiver: Value, key: Atom) -> Value {
        let a = self.pair(pair);
        if let Value::Undef = a.get {
            return Value::Undef;
        }
        if self.is_restricted(&a.get) {
            self.restricted_hit = true;
            return Value::Uninit;
        }
        if self.is_companion(&a.get) {
            return self.companion_value(receiver, key);
        }
        if self.op_access {
            self.getter_hit = Some(a.get);
            return Value::Undef;
        }
        self.program_read(receiver, key)
    }

    /// A program getter's value for a built-in: read ahead, or undefined and recorded as missing; outside
    /// `with_reads`, a fault.
    fn program_read(&mut self, receiver: Value, key: Atom) -> Value {
        if let Some(v) = self
            .reads
            .table
            .iter()
            .find(|(r, k, _)| *k == key && self.same_value(r, &receiver))
            .map(|(_, _, v)| *v)
        {
            return v;
        }
        if self.reads.depth == 0 {
            if self.reads.fault.is_none() {
                self.reads.fault = Some(key);
            }
            return Value::Undef;
        }
        if !self
            .reads
            .missing
            .iter()
            .any(|(r, k)| *k == key && self.same_value(r, &receiver))
        {
            self.reads.missing.push((receiver, key));
        }
        Value::Undef
    }

    /// The value a built-in accessor's getter gives `receiver`, or `Uninit` for a receiver of another kind (which a
    /// read turns into `accessor_error`).
    pub(crate) fn companion_value(&mut self, receiver: Value, key: Atom) -> Value {
        let Value::Obj(id) = receiver else {
            return Value::Uninit;
        };
        let kind = &self.heap[id as usize].kind;
        if let Kind::Map(m) | Kind::Set(m) = kind
            && key == self.names.size
        {
            return Value::Num(m.live as f64);
        }
        if crate::builtins::exotic::is_exotic(kind)
            && let Some(v) = crate::builtins::exotic::get(self, id, key)
        {
            return v;
        }
        Value::Uninit
    }

    /// The error for a built-in that reached a program accessor it cannot call.
    pub(crate) fn unreachable_accessor(&mut self, key: Atom) -> Value {
        let k = self.key_text(key);
        self.type_error(&format!(
            "A built-in cannot call the getter or setter '{k}' here; read the property into a variable first."
        ))
    }

    /// A native's result, failed instead when it reached a program accessor it cannot call.
    #[inline]
    pub(crate) fn checked_native(&mut self, r: Res) -> Res {
        match self.reads.fault.take() {
            None => r,
            Some(key) => Err(self.unreachable_accessor(key)),
        }
    }

    /// Runs a built-in body whose reads may meet program getters, as the reference's `withReads`: a getter not read
    /// yet reads as undefined and is recorded; if any were, the body's result (or failure) is dropped and the missing
    /// getters are left in `reads.missing` for the caller to run (`Vm::prefetch`), after which the body runs again
    /// from the start. So the body must be repeatable until it returns.
    pub(crate) fn with_reads<T>(
        &mut self,
        body: impl FnOnce(&mut Vm) -> Result<T, Value>,
    ) -> WithReads<T> {
        let outer = std::mem::take(&mut self.reads.missing);
        self.reads.depth += 1;
        let r = body(self);
        self.reads.depth -= 1;
        let missing = std::mem::replace(&mut self.reads.missing, outer);
        if missing.is_empty() {
            WithReads::Done(r)
        } else {
            WithReads::Prefetch(missing)
        }
    }

    /// Whether a read in this `with_reads` round met a getter not read yet, so what it gave is only a placeholder.
    pub(crate) fn reads_pending(&self) -> bool {
        !self.reads.missing.is_empty()
    }

    /// An object literal's `get x() {}` or `set x(v) {}` (and a host's live accessor): an existing accessor keeps its
    /// other half; a data property, or no property, becomes an accessor with only this half.
    pub(crate) fn define_accessor_half(
        &mut self,
        id: Id,
        key: Atom,
        setter: bool,
        f: Value,
        enumerable: bool,
    ) {
        let current = self.heap[id as usize]
            .props
            .prop(key)
            .filter(|p| p.flags & ACCESSOR != 0)
            .map(|p| self.pair(p.value));
        let mut a = current.unwrap_or(Accessor {
            get: Value::Undef,
            set: Value::Undef,
        });
        if setter {
            a.set = f;
        } else {
            a.get = f;
        }
        let pair = self.new_pair(a.get, a.set);
        let flags = ACCESSOR | if enumerable { ENUMERABLE } else { 0 };
        let o = &mut self.heap[id as usize];
        o.flags |= ACCESSORS;
        match o.props.find(key) {
            Some(i) => {
                o.props.items[i].value = pair;
                o.props.items[i].flags = flags;
            }
            None => o.props.push_new(key, pair, flags),
        }
    }

    /// Whether `id` or an object on its chain ever had a program accessor (the reference's `accessorsOnChain`).
    pub(crate) fn accessors_on_chain(&self, id: Id) -> bool {
        let mut cur = Some(id);
        while let Some(c) = cur {
            let o = &self.heap[c as usize];
            if o.flags & ACCESSORS != 0 {
                return true;
            }
            cur = o.proto;
        }
        false
    }

    /// The accessor property `key` on `id`'s chain, if the first property found there is one: its halves.
    pub(crate) fn accessor_on_chain(&self, id: Id, key: Atom) -> Option<Accessor> {
        let mut cur = Some(id);
        while let Some(c) = cur {
            let o = &self.heap[c as usize];
            if let Some(p) = o.props.prop(key) {
                return (p.flags & ACCESSOR != 0).then(|| self.pair(p.value));
            }
            if self.has_own(c, key) {
                return None;
            }
            cur = o.proto;
        }
        None
    }

    /// [[Get]] for display and diagnostics, which never run program code: a program getter reads as undefined (the
    /// reference's `peek`).
    pub(crate) fn peek(&mut self, id: Id, key: Atom) -> Value {
        let outer = self.op_access;
        self.op_access = true;
        let v = self.get_obj(id, key);
        self.op_access = outer;
        self.restricted_hit = false;
        match self.getter_hit.take() {
            Some(_) => Value::Undef,
            None => v,
        }
    }

    /// Own enumerable string entries for display, which runs no program code: a program accessor shows as its label
    /// (the reference's `shownEntries`), `Err` here.
    pub(crate) fn shown_entries(&mut self, id: Id) -> Vec<(Atom, Result<Value, &'static str>)> {
        let has_accessors = self.heap[id as usize].flags & ACCESSORS != 0;
        if !has_accessors {
            return self
                .own_entries(id)
                .into_iter()
                .map(|(k, v)| (k, Ok(v)))
                .collect();
        }
        let keys = self.own_keys(id);
        keys.into_iter()
            .map(|k| {
                let label = self.heap[id as usize]
                    .props
                    .prop(k)
                    .filter(|p| p.flags & ACCESSOR != 0)
                    .map(|p| p.value)
                    .filter(|pair| self.is_program_accessor(*pair))
                    .map(|pair| self.accessor_label(pair));
                match label {
                    Some(l) => (k, Err(l)),
                    None => (k, Ok(self.peek(id, k))),
                }
            })
            .collect()
    }

    /// A property as display shows it, own or inherited: a program accessor by its label (`shownProperty`).
    pub(crate) fn shown_property(&mut self, id: Id, key: Atom) -> Result<Value, &'static str> {
        let mut cur = Some(id);
        while let Some(c) = cur {
            if let Some(p) = self.heap[c as usize].props.prop(key) {
                if p.flags & ACCESSOR != 0 && self.is_program_accessor(p.value) {
                    return Err(self.accessor_label(p.value));
                }
                break;
            }
            if self.has_own(c, key) {
                break;
            }
            cur = self.heap[c as usize].proto;
        }
        Ok(self.peek(id, key))
    }

    /// Whether the property `key` found first on `id`'s chain is an accessor with no getter, which a copy for the host
    /// leaves out (the reference's `setterOnly`).
    pub(crate) fn setter_only(&self, id: Id, key: Atom) -> bool {
        self.accessor_on_chain(id, key)
            .is_some_and(|a| matches!(a.get, Value::Undef))
    }

    /// How display shows a program accessor in place of its value, in Node's words.
    pub(crate) fn accessor_label(&self, pair: Value) -> &'static str {
        let a = self.pair(pair);
        match (a.get, a.set) {
            (Value::Undef, _) => "[Setter]",
            (_, Value::Undef) => "[Getter]",
            _ => "[Getter/Setter]",
        }
    }
}

/// A method read (`o.m`, keeping `o`) that met a program getter: its frame's slots are the getter and the receiver,
/// and the slot under its callee is where the method goes (see `Vm::enter_getter_method`).
pub(crate) const SUB_GETTER_METHOD: u16 = 8;
/// A write that met a program setter: its slots are the setter, the receiver and the value, which the write gives.
pub(crate) const SUB_SETTER: u16 = 9;

pub(crate) fn getter_method_step(vm: &mut Vm, fr: Frame, input: Input) -> Result<Step, Value> {
    match input {
        Input::Start => {
            let (g, o) = (fr.slot(vm, 0), fr.slot(vm, 1));
            fr.call_slots(vm, g, o, [])
        }
        Input::Returned(f) => {
            vm.stack[fr.base() - 3] = f;
            Ok(Step::Done(fr.get(vm, 1)))
        }
        Input::Threw(e) => Err(e),
        Input::Finished(_) => Ok(Step::Done(Value::Undef)),
    }
}

pub(crate) fn setter_step(vm: &mut Vm, fr: Frame, input: Input) -> Result<Step, Value> {
    match input {
        Input::Start => {
            let (s, o, v) = (fr.slot(vm, 0), fr.slot(vm, 1), fr.slot(vm, 2));
            fr.call_slots(vm, s, o, [v])
        }
        Input::Returned(_) => Ok(Step::Done(fr.get(vm, 2))),
        Input::Threw(e) => Err(e),
        Input::Finished(_) => Ok(Step::Done(Value::Undef)),
    }
}

impl Vm {
    /// Calls the program getter an instruction's read met, with the read's receiver, as a call from the instruction:
    /// its result is the read's. Whether a frame was pushed.
    pub(crate) fn enter_getter(&mut self, g: Value, receiver: Value) -> Result<bool, Value> {
        self.push(g);
        self.push(receiver);
        self.call_op(0)
    }

    /// `enter_getter` for a method read, which leaves the method under its receiver.
    pub(crate) fn enter_getter_method(&mut self, g: Value, receiver: Value) -> Result<(), Value> {
        self.push(receiver);
        let r = self.enter_native_with(
            crate::native::NativeOp::Callbacks,
            SUB_GETTER_METHOD,
            Value::Undef,
            Value::Undef,
            &[g, receiver],
        );
        self.entered = false;
        r.map(|_| ())
    }

    /// Calls the program setter an instruction's write met, with the receiver and the value; the write gives the value.
    pub(crate) fn enter_setter(
        &mut self,
        s: Value,
        receiver: Value,
        v: Value,
    ) -> Result<(), Value> {
        let r = self.enter_native_with(
            crate::native::NativeOp::Callbacks,
            SUB_SETTER,
            Value::Undef,
            Value::Undef,
            &[s, receiver, v],
        );
        self.entered = false;
        r.map(|_| ())
    }

    /// An instruction's property read: the value, or `None` once it called a program getter (`pushed` says whether
    /// that left a frame to run, else the getter's value is on the stack already).
    #[inline]
    pub(crate) fn op_read(&mut self, o: &Value, key: Atom) -> Result<Read, Value> {
        self.op_access = true;
        let r = self.get(o, key);
        self.op_access = false;
        let v = r?;
        match self.getter_hit.take() {
            None => Ok(Read::Value(v)),
            Some(g) => Ok(Read::Getter(g)),
        }
    }

    /// [[Get]] for native code stepping the iterator protocol (`next`, `done`, `value`, `return`, `[Symbol.iterator]`),
    /// which the reference reads in program code: a program getter is called here, inline, to completion. A getter
    /// read this way cannot park or suspend the run.
    pub(crate) fn get_calling(&mut self, id: Id, key: Atom) -> Res {
        // Restored after, for the instruction whose read this is part of (a key's conversion).
        let outer = self.op_access;
        self.op_access = true;
        let v = self.get_obj(id, key);
        self.op_access = false;
        let r = match self.getter_hit.take() {
            Some(g) => self.call(&g, Value::Obj(id), &[]),
            None => Ok(v),
        };
        self.op_access = outer;
        r
    }

    /// `get_calling` for any value: a primitive's read through its prototype, an object's own.
    pub(crate) fn get_calling_value(&mut self, v: &Value, key: Atom) -> Res {
        let outer = self.op_access;
        self.op_access = true;
        let r = self.get(v, key);
        self.op_access = false;
        let r = match r {
            Err(e) => Err(e),
            Ok(x) => match self.getter_hit.take() {
                Some(g) => self.call(&g, *v, &[]),
                None => Ok(x),
            },
        };
        self.op_access = outer;
        r
    }

    /// Whether `id`'s chain has a program getter for `key` first, which `get_calling` would call.
    pub(crate) fn has_program_getter(&self, id: Id, key: Atom) -> bool {
        if !self.accessors_on_chain(id) {
            return false;
        }
        let mut cur = Some(id);
        while let Some(c) = cur {
            let o = &self.heap[c as usize];
            if let Some(p) = o.props.prop(key) {
                return p.flags & ACCESSOR != 0 && self.is_program_half(&self.pair(p.value).get);
            }
            if self.has_own(c, key) {
                return false;
            }
            cur = o.proto;
        }
        false
    }

    /// `op_read` for a computed key.
    #[inline]
    pub(crate) fn op_read_elem(&mut self, o: &Value, k: &Value) -> Result<Read, Value> {
        self.op_access = true;
        let r = self.get_elem(o, k);
        self.op_access = false;
        let v = r?;
        match self.getter_hit.take() {
            None => Ok(Read::Value(v)),
            Some(g) => Ok(Read::Getter(g)),
        }
    }

    /// An instruction's write: whether it met a program setter, which `setter_hit` holds.
    #[inline]
    pub(crate) fn op_write(
        &mut self,
        o: &Value,
        key: Atom,
        v: Value,
    ) -> Result<Option<Value>, Value> {
        self.op_access = true;
        let r = self.set(o, key, v);
        self.op_access = false;
        r?;
        Ok(self.setter_hit.take())
    }

    /// `op_write` for a computed key.
    #[inline]
    pub(crate) fn op_write_elem(
        &mut self,
        o: &Value,
        k: &Value,
        v: Value,
    ) -> Result<Option<Value>, Value> {
        self.op_access = true;
        let r = self.set_elem(o, k, v);
        self.op_access = false;
        r?;
        Ok(self.setter_hit.take())
    }
}

/// What an instruction's read found.
pub(crate) enum Read {
    Value(Value),
    Getter(Value),
}

/// What `Vm::with_reads` gives: the body's outcome, or the getters it still needs.
pub(crate) enum WithReads<T> {
    Done(Result<T, Value>),
    Prefetch(Vec<(Value, Atom)>),
}

/// The companion of a built-in accessor's getter, as a program sees it (`Object.getOwnPropertyDescriptor(Map.prototype,
/// "size").get`): its data is the prototype that has the accessor, and its name `get <key>`.
pub(crate) fn companion_get(vm: &mut Vm, this: Value, _args: &[Value], callee: Id) -> Res {
    let (owner, key) = companion_of(vm, callee);
    if !inherits(vm, &this, owner) {
        return Err(companion_error(vm, owner, key, &this));
    }
    let v = vm.companion_value(this, key);
    if let Value::Uninit = v {
        return Err(companion_error(vm, owner, key, &this));
    }
    Ok(v)
}

/// The companion of a built-in accessor's setter.
pub(crate) fn companion_set(vm: &mut Vm, this: Value, args: &[Value], callee: Id) -> Res {
    let (owner, key) = companion_of(vm, callee);
    if !inherits(vm, &this, owner) || matches!(vm.companion_value(this, key), Value::Uninit) {
        return Err(companion_error(vm, owner, key, &this));
    }
    let Value::Obj(id) = this else {
        return Err(companion_error(vm, owner, key, &this));
    };
    vm.set_obj(id, key, crate::builtins::arg(args, 0))?;
    Ok(Value::Undef)
}

/// Whether `owner` is on `v`'s prototype chain: the kind of receiver a built-in accessor of `owner` serves.
fn inherits(vm: &Vm, v: &Value, owner: Id) -> bool {
    let Value::Obj(id) = v else { return false };
    let mut cur = vm.heap[*id as usize].proto;
    while let Some(p) = cur {
        if p == owner {
            return true;
        }
        cur = vm.heap[p as usize].proto;
    }
    false
}

/// A companion's prototype and key.
fn companion_of(vm: &Vm, callee: Id) -> (Id, Atom) {
    match &vm.heap[callee as usize].kind {
        Kind::Native { data, name, .. } => {
            let owner = data.as_obj().unwrap_or(0);
            let text = vm.atoms.text(*name);
            let key = text.get(4..).and_then(|k| vm.atoms.lookup(k)).unwrap_or(0);
            (owner, key)
        }
        _ => (0, 0),
    }
}

fn companion_error(vm: &mut Vm, owner: Id, key: Atom, this: &Value) -> Value {
    let (pk, nk) = (vm.names.constructor, vm.names.name);
    let ctor = match vm.get_obj(owner, pk) {
        Value::Obj(c) => match vm.get_obj(c, nk) {
            Value::Str(s) => vm.text(s).to_owned(),
            _ => String::new(),
        },
        _ => String::new(),
    };
    let k = vm.atoms.text(key).to_owned();
    crate::builtins::incompatible(vm, &format!("{ctor}.prototype.{k}"), this)
}

impl Vm {
    /// The attributes an array's elements share (the reference's `Arr.elements`): `seal` and `freeze` narrow them.
    fn element_attrs(&self, id: Id) -> (bool, bool, bool) {
        let flags = self.heap[id as usize].flags;
        (flags & FROZEN == 0, true, flags & (FROZEN | SEALED) == 0)
    }

    /// The own property `key` of `id`, as `Object.getOwnPropertyDescriptor` and `defineProperty` see it (the
    /// reference's `own`): an array's live elements and `length`, a function's `name` and `length`, a built-in
    /// accessor (whose halves become its companions), or an ordinary property.
    pub(crate) fn own_slot(&mut self, id: Id, key: Atom) -> Option<OwnSlot> {
        let flags = self.heap[id as usize].flags;
        let index = self.atoms.index(key);
        let fixed_all = flags & (FROZEN | SEALED) != 0;
        let frozen = flags & FROZEN != 0;
        match &self.heap[id as usize].kind {
            Kind::Array(items) => {
                let (w, e, c) = self.element_attrs(id);
                if let Some(i) = index {
                    if let Some(v) = items.get(i as usize) {
                        if matches!(v, Value::Uninit) {
                            return None;
                        }
                        return Some(OwnSlot {
                            value: SlotValue::Data(*v),
                            writable: w,
                            enumerable: e,
                            configurable: c,
                        });
                    }
                    if flags & SPARSE == 0 {
                        return None;
                    }
                } else if key == self.names.length {
                    return Some(OwnSlot {
                        value: SlotValue::Data(Value::Num(self.array_len(id) as f64)),
                        writable: w,
                        enumerable: false,
                        configurable: false,
                    });
                }
            }
            Kind::Arguments(items) => {
                if let Some(i) = index
                    && let Some(v) = items.get(i as usize)
                    && !matches!(v, Value::Uninit)
                {
                    return Some(OwnSlot {
                        value: SlotValue::Data(*v),
                        writable: !frozen,
                        enumerable: true,
                        configurable: !fixed_all,
                    });
                }
            }
            Kind::Closure(_) | Kind::Native { .. }
                if self.heap[id as usize].props.find(key).is_none()
                    && ((key == self.names.name && flags & NAME_DELETED == 0)
                        || (key == self.names.length && flags & LENGTH_DELETED == 0)) =>
            {
                let v = self.get_obj(id, key);
                return Some(OwnSlot {
                    value: SlotValue::Data(v),
                    writable: false,
                    enumerable: false,
                    configurable: !fixed_all,
                });
            }
            Kind::Bytes(_) if crate::builtins::bytes::has_own(self, id, key) => {
                let v = self.get_obj(id, key);
                return Some(OwnSlot {
                    value: SlotValue::Data(v),
                    writable: true,
                    enumerable: true,
                    configurable: true,
                });
            }
            _ => {}
        }
        let i = self.heap[id as usize].props.find(key)?;
        let p = self.heap[id as usize].props.items[i].clone();
        if let Value::Uninit = p.value {
            // A built-in accessor: from now on its halves are its companions.
            let (get, set) = self.companions(id, key);
            let pair = self.new_pair(get, set);
            let o = &mut self.heap[id as usize];
            o.props.items[i].value = pair;
            o.props.items[i].flags = ACCESSOR;
            return Some(OwnSlot {
                value: SlotValue::Accessor(get, set),
                writable: false,
                enumerable: false,
                configurable: !fixed_all,
            });
        }
        let configurable = p.flags & FIXED == 0 && !fixed_all;
        let enumerable = p.flags & ENUMERABLE != 0;
        if p.flags & ACCESSOR != 0 {
            let a = self.pair(p.value);
            return Some(OwnSlot {
                value: SlotValue::Accessor(a.get, a.set),
                writable: false,
                enumerable,
                configurable,
            });
        }
        // A sparse array's far element shares the array's attributes; its length is the array's.
        let writable = p.flags & WRITABLE != 0 && !frozen;
        Some(OwnSlot {
            value: SlotValue::Data(p.value),
            writable,
            enumerable,
            configurable,
        })
    }

    /// The companions of the built-in accessor `key` of the prototype `owner`: its getter, and its setter when it has
    /// one (a URL's fields but `origin`).
    fn companions(&mut self, owner: Id, key: Atom) -> (Value, Value) {
        let text = self.key_text(key);
        let get_name = format!("get {text}");
        let fp = self.realm.function_proto;
        let make = |vm: &mut Vm, name: String, length: u8, f: crate::vm::NativeFn| {
            let n = vm.atoms.intern(&name);
            Value::Obj(vm.alloc(Obj::new(
                Some(fp),
                Kind::Native {
                    f,
                    data: Value::Obj(owner),
                    name: n,
                    length,
                    ctor: false,
                },
            )))
        };
        let get = make(self, get_name, 0, companion_get);
        let has_setter = owner == self.realm.std.url && text != "origin" && text != "searchParams";
        let set = if has_setter {
            make(self, format!("set {text}"), 1, companion_set)
        } else {
            Value::Undef
        };
        self.heap[owner as usize].flags |= ACCESSORS;
        (get, set)
    }

    /// Every own key of `id`, in the reference's `ownKeys` order: elements, an array's `length`, a function's `length`
    /// and `name`, then integer keys ascending, other strings in insertion order, and the iterator symbols.
    pub(crate) fn own_property_keys(&mut self, id: Id) -> Vec<Atom> {
        if self.is_namespace(id) {
            return self.namespace_names(id).unwrap_or_default();
        }
        let flags = self.heap[id as usize].flags;
        let (name, length) = (self.names.name, self.names.length);
        let mut out = Vec::new();
        let mut leading = Vec::new();
        match &self.heap[id as usize].kind {
            Kind::Array(items) | Kind::Arguments(items) => {
                let n = items.len();
                let present: Vec<usize> = (0..n)
                    .filter(|i| !matches!(items[*i], Value::Uninit))
                    .collect();
                for i in present {
                    out.push(self.atoms.intern(&i.to_string()));
                }
                if matches!(self.heap[id as usize].kind, Kind::Array(_)) {
                    if flags & SPARSE != 0 {
                        for (i, _) in self.sparse_tail(id) {
                            out.push(self.atoms.intern(&i.to_string()));
                        }
                    }
                    leading.push(length);
                }
            }
            Kind::Closure(_) | Kind::Native { .. } => {
                let props = &self.heap[id as usize].props;
                if flags & LENGTH_DELETED == 0 || props.find(length).is_some() {
                    leading.push(length);
                }
                if flags & NAME_DELETED == 0 || props.find(name).is_some() {
                    leading.push(name);
                }
            }
            k if crate::builtins::exotic::is_exotic(k) => {
                for i in 0..crate::builtins::exotic::index_len(self, id) {
                    out.push(self.atoms.intern(&i.to_string()));
                }
            }
            _ => {}
        }
        let is_array = matches!(self.heap[id as usize].kind, Kind::Array(_));
        let is_fn = matches!(
            self.heap[id as usize].kind,
            Kind::Closure(_) | Kind::Native { .. }
        );
        out.extend(leading.iter().copied());
        let props = &self.heap[id as usize].props;
        let mut ints = Vec::new();
        let mut strs = Vec::new();
        let mut syms = Vec::new();
        for p in &props.items {
            if leading.contains(&p.key) {
                continue;
            }
            if p.key <= SYM_ASYNC_ITERATOR {
                syms.push(p.key);
                continue;
            }
            match self.atoms.index(p.key) {
                // A sparse array's far elements are listed with its elements.
                Some(_) if is_array => {}
                Some(i) => ints.push((i, p.key)),
                None => strs.push(p.key),
            }
        }
        ints.sort_unstable_by_key(|(i, _)| *i);
        // A function's integer keys come before its `length` and `name`.
        if is_fn {
            out.truncate(out.len() - leading.len());
        }
        out.extend(ints.into_iter().map(|(_, k)| k));
        if is_fn {
            out.extend(leading.iter().copied());
        }
        out.extend(strs);
        out.extend(syms);
        out
    }
}

impl Vm {
    /// A built-in's getters to read ahead before it runs again (the reference's `Prefetch`), as the request of a
    /// restartable call (see `conversion.rs`): the sentinel error its body returns. A built-in that cannot run again
    /// fails as one that reached the getter.
    pub(crate) fn prefetch(&mut self, missing: Vec<(Value, Atom)>) -> Value {
        if self.convert_ok {
            if self.convert_req.is_none() {
                self.convert_req = Some(crate::conversion::Request::Read(missing));
            }
            return Value::Undef;
        }
        let key = missing.first().map_or(0, |(_, k)| *k);
        self.unreachable_accessor(key)
    }

    /// `with_reads`, with a `Prefetch` made the call's request.
    pub(crate) fn reading<T>(
        &mut self,
        body: impl FnOnce(&mut Vm) -> Result<T, Value>,
    ) -> Result<T, Value> {
        match self.with_reads(body) {
            WithReads::Done(r) => r,
            WithReads::Prefetch(missing) => Err(self.prefetch(missing)),
        }
    }

    /// ToPropertyDescriptor, under `with_reads`: each field through the chain, in the spec's order.
    pub(crate) fn property_descriptor(&mut self, v: &Value) -> Result<Descriptor, Value> {
        let Value::Obj(id) = *v else {
            let d = crate::builtins::describe_value(self, v);
            return Err(self.type_error(&format!("Property description must be an object: {d}")));
        };
        if self.is_namespace(id) {
            let d = crate::builtins::describe_value(self, v);
            return Err(self.type_error(&format!("Property description must be an object: {d}")));
        }
        let mut desc = Descriptor::default();
        let names = [
            "enumerable",
            "configurable",
            "value",
            "writable",
            "get",
            "set",
        ];
        for (i, name) in names.iter().enumerate() {
            let key = self.atoms.intern_static(name);
            if !self.has_key(id, key) {
                continue;
            }
            let x = self.get_obj(id, key);
            let x = if let Value::Uninit = x {
                return Err(crate::builtins::accessor_error(self, id, key));
            } else {
                x
            };
            match i {
                0 => desc.enumerable = Some(self.truthy(&x)),
                1 => desc.configurable = Some(self.truthy(&x)),
                2 => desc.value = Some(x),
                3 => desc.writable = Some(self.truthy(&x)),
                _ => {
                    let callable = matches!(x, Value::Obj(f) if self.heap[f as usize].is_callable() && !self.is_namespace(f));
                    if !matches!(x, Value::Undef) && !callable {
                        let d = crate::builtins::describe_value(self, &x);
                        let what = if i == 4 { "Getter" } else { "Setter" };
                        return Err(self.type_error(&format!("{what} must be a function: {d}")));
                    }
                    if i == 4 {
                        desc.get = Some(x);
                    } else {
                        desc.set = Some(x);
                    }
                }
            }
        }
        if desc.is_accessor() && desc.is_data() {
            return Err(self.type_error(
                "Invalid property descriptor. Cannot both specify accessors and a value or writable attribute.",
            ));
        }
        Ok(desc)
    }

    /// DefinePropertyOrThrow.
    pub(crate) fn define_or_throw(
        &mut self,
        id: Id,
        key: Atom,
        desc: &Descriptor,
    ) -> Result<(), Value> {
        if let Some(v @ Value::Obj(_)) = desc.value {
            let label = if matches!(self.heap[id as usize].kind, Kind::Array(_)) {
                "Array assignment result"
            } else {
                "Object assignment result"
            };
            self.reject_circular(id, &v, label)?;
        }
        if self.define_own_property(id, key, desc)? {
            return Ok(());
        }
        let k = self.key_text(key);
        if self.heap[id as usize].flags & NON_EXTENSIBLE != 0 && self.own_slot(id, key).is_none() {
            return Err(self.type_error(&format!(
                "Cannot define property {k}, object is not extensible"
            )));
        }
        Err(self.type_error(&format!("Cannot redefine property: {k}")))
    }

    /// ValidateAndApplyPropertyDescriptor for an own property, as the reference's `defineOwnProperty`: false where the
    /// spec answers false, and a TypeError for what the object model cannot hold (an accessor on an array element,
    /// elements whose attributes differ from their array's shared ones). Everything is checked before anything changes.
    pub(crate) fn define_own_property(
        &mut self,
        id: Id,
        key: Atom,
        desc: &Descriptor,
    ) -> Result<bool, Value> {
        let current = self.own_slot(id, key);
        let extensible = self.heap[id as usize].flags & NON_EXTENSIBLE == 0;
        if current.is_none() && !extensible {
            return Ok(false);
        }
        if let Some(c) = &current
            && !self.compatible(c, desc)
        {
            return Ok(false);
        }
        let index = self.atoms.index(key);
        match &self.heap[id as usize].kind {
            Kind::Array(_) if index.is_some() => {
                return self.define_element(id, index.unwrap_or_default() as usize, current, desc);
            }
            Kind::Array(_) if key == self.names.length => return self.define_length(id, desc),
            Kind::Bytes(_) if index.is_some() => {
                return self.define_byte(id, index.unwrap_or_default() as usize, key, desc);
            }
            Kind::Arguments(items)
                if index.is_some_and(|i| {
                    items
                        .get(i as usize)
                        .is_some_and(|v| !matches!(v, Value::Uninit))
                }) =>
            {
                // An argument with other attributes, or made an accessor, becomes an ordinary property.
                let i = index.unwrap_or_default() as usize;
                let slot = self.applied(current.as_ref(), desc);
                let plain = matches!(slot.value, SlotValue::Data(_))
                    && slot.writable
                    && slot.enumerable
                    && slot.configurable;
                if let (true, SlotValue::Data(v)) = (plain, slot.value)
                    && let Kind::Arguments(items) = &mut self.heap[id as usize].kind
                {
                    items[i] = v;
                    return Ok(true);
                }
                if let Kind::Arguments(items) = &mut self.heap[id as usize].kind {
                    items[i] = Value::Uninit;
                }
                self.write_slot(id, key, slot);
                return Ok(true);
            }
            _ => {}
        }
        let slot = self.applied(current.as_ref(), desc);
        self.write_slot(id, key, slot);
        Ok(true)
    }

    /// Whether `desc` may change a non-configurable `current` (a configurable one may change in any way).
    fn compatible(&self, current: &OwnSlot, desc: &Descriptor) -> bool {
        if current.configurable {
            return true;
        }
        if desc.configurable == Some(true) {
            return false;
        }
        if desc.enumerable.is_some_and(|e| e != current.enumerable) {
            return false;
        }
        match current.value {
            SlotValue::Data(v) => {
                if desc.is_accessor() {
                    return false;
                }
                if current.writable {
                    return true;
                }
                desc.writable != Some(true) && !desc.value.is_some_and(|x| !self.same_value(&x, &v))
            }
            SlotValue::Accessor(g, s) => {
                if desc.is_data() {
                    return false;
                }
                desc.get.is_none_or(|x| self.strict_eq(&x, &g))
                    && desc.set.is_none_or(|x| self.strict_eq(&x, &s))
            }
        }
    }

    /// The property `desc` makes: a new one from what it gives (false or undefined for what it leaves out), or an
    /// existing one with its fields applied, where a change of kind keeps only the attributes.
    fn applied(&self, current: Option<&OwnSlot>, desc: &Descriptor) -> OwnSlot {
        let created = |desc: &Descriptor, enumerable: bool, configurable: bool| {
            if desc.is_accessor() {
                OwnSlot {
                    value: SlotValue::Accessor(
                        desc.get.unwrap_or_default(),
                        desc.set.unwrap_or_default(),
                    ),
                    writable: false,
                    enumerable,
                    configurable,
                }
            } else {
                OwnSlot {
                    value: SlotValue::Data(desc.value.unwrap_or_default()),
                    writable: desc.writable.unwrap_or(false),
                    enumerable,
                    configurable,
                }
            }
        };
        let Some(c) = current else {
            return created(
                desc,
                desc.enumerable.unwrap_or(false),
                desc.configurable.unwrap_or(false),
            );
        };
        let enumerable = desc.enumerable.unwrap_or(c.enumerable);
        let configurable = desc.configurable.unwrap_or(c.configurable);
        match c.value {
            SlotValue::Data(_) if desc.is_accessor() => created(desc, enumerable, configurable),
            SlotValue::Accessor(..) if desc.is_data() => created(desc, enumerable, configurable),
            SlotValue::Data(v) => OwnSlot {
                value: SlotValue::Data(desc.value.unwrap_or(v)),
                writable: desc.writable.unwrap_or(c.writable),
                enumerable,
                configurable,
            },
            SlotValue::Accessor(g, s) => OwnSlot {
                value: SlotValue::Accessor(desc.get.unwrap_or(g), desc.set.unwrap_or(s)),
                writable: false,
                enumerable,
                configurable,
            },
        }
    }

    /// Stores a property as an ordinary one.
    fn write_slot(&mut self, id: Id, key: Atom, slot: OwnSlot) {
        let mut flags = 0;
        if slot.enumerable {
            flags |= ENUMERABLE;
        }
        if !slot.configurable {
            flags |= FIXED;
        }
        let value = match slot.value {
            SlotValue::Data(v) => {
                if slot.writable {
                    flags |= WRITABLE;
                }
                v
            }
            SlotValue::Accessor(g, s) => {
                flags |= ACCESSOR;
                if self.is_program_half(&g) || self.is_program_half(&s) {
                    self.heap[id as usize].flags |= ACCESSORS;
                }
                self.new_pair(g, s)
            }
        };
        let o = &mut self.heap[id as usize];
        match o.props.find(key) {
            Some(i) => {
                o.props.items[i].value = value;
                o.props.items[i].flags = flags;
            }
            None => o.props.push_new(key, value, flags),
        }
    }

    /// An array element: elements have no slots, so only data with the array's own attributes fits.
    fn define_element(
        &mut self,
        id: Id,
        i: usize,
        current: Option<OwnSlot>,
        desc: &Descriptor,
    ) -> Result<bool, Value> {
        if desc.is_accessor() {
            return Err(self.type_error(
                "Accessor properties are not supported on array elements; store the value or use a plain object.",
            ));
        }
        let (bw, be, bc) = current.map_or((false, false, false), |c| {
            (c.writable, c.enumerable, c.configurable)
        });
        let writable = desc.writable.unwrap_or(bw);
        let enumerable = desc.enumerable.unwrap_or(be);
        let configurable = desc.configurable.unwrap_or(bc);
        if (writable, enumerable, configurable) != self.element_attrs(id) {
            return Err(self.type_error(
                "Array elements share their attributes; only writable, enumerable and configurable equal to the array's are supported.",
            ));
        }
        if current.is_none() || desc.value.is_some() {
            let key = self.atoms.intern(&i.to_string());
            self.define(id, key, desc.value.unwrap_or_default());
        }
        Ok(true)
    }

    /// An array's `length`: its value, or making it read-only, which the shared element attributes can't separate.
    fn define_length(&mut self, id: Id, desc: &Descriptor) -> Result<bool, Value> {
        if desc.is_accessor() || desc.configurable == Some(true) || desc.enumerable == Some(true) {
            return Ok(false);
        }
        if desc.writable == Some(false) && self.element_attrs(id).0 {
            return Err(self.type_error(
                "Making an array's length read-only is not supported; use Object.freeze.",
            ));
        }
        if let Some(v) = desc.value {
            let n = crate::builtins::builtin_number(self, &v)?;
            if n != self.array_len(id) as f64 {
                if self.heap[id as usize].flags & FROZEN != 0 {
                    return Ok(false);
                }
                let lk = self.names.length;
                self.set_obj(id, lk, Value::Num(n))?;
            }
        }
        Ok(true)
    }

    /// A Uint8Array's element: data with the shared attributes, within its length.
    fn define_byte(
        &mut self,
        id: Id,
        i: usize,
        key: Atom,
        desc: &Descriptor,
    ) -> Result<bool, Value> {
        if desc.is_accessor() {
            return Err(self.type_error(
                "Accessor properties are not supported on array elements; store the value or use a plain object.",
            ));
        }
        if i >= crate::builtins::bytes::index_len(self, id) {
            return Ok(false);
        }
        let attrs = (
            desc.writable.unwrap_or(true),
            desc.enumerable.unwrap_or(true),
            desc.configurable.unwrap_or(true),
        );
        if attrs != (true, true, true) {
            return Err(self.type_error(
                "Array elements share their attributes; only writable, enumerable and configurable equal to the array's are supported.",
            ));
        }
        if let Some(v) = desc.value {
            let n = crate::builtins::builtin_number(self, &v)?;
            self.set_obj(id, key, Value::Num(n))?;
        }
        Ok(true)
    }

    /// FromPropertyDescriptor.
    pub(crate) fn descriptor_object(&mut self, slot: Option<OwnSlot>) -> Value {
        let Some(s) = slot else {
            return Value::Undef;
        };
        let id = self.new_object();
        let put = |vm: &mut Vm, name: &'static str, v: Value| {
            let k = vm.atoms.intern_static(name);
            vm.define(id, k, v);
        };
        match s.value {
            SlotValue::Data(v) => {
                put(self, "value", v);
                put(self, "writable", Value::Bool(s.writable));
            }
            SlotValue::Accessor(g, st) => {
                put(self, "get", g);
                put(self, "set", st);
            }
        }
        put(self, "enumerable", Value::Bool(s.enumerable));
        put(self, "configurable", Value::Bool(s.configurable));
        Value::Obj(id)
    }
}
