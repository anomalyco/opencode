//! Classes, as the reference's language layer has them: `class` declarations and expressions whose constructor only
//! `new` calls, instance and static methods, accessors and fields, and `extends` another class or an Error type with
//! `super(...)` and `super.x`.
//!
//! - A class is its constructor, a closure whose `FuncProto::class` is set, with a frozen `prototype`. Its methods
//!   are closures with a home object (`Closure::home`), which `super.x` reads from; an arrow made in a method takes
//!   its home with it. Its instance fields are a function of their own (`Closure::fields`) that defines them on
//!   `this`, run when the constructor starts, or right after `super()` returns in a derived one.
//! - `new C(...)` calls the constructor with a fresh instance of `C.prototype` as `this`; a derived constructor gets
//!   its new target there instead and binds `this` when `super()` returns. Its `return`s go through
//!   `Op::CtorReturn`, which applies the return rules.

use crate::bytecode::CLASS_DERIVED;
use crate::object::*;
use crate::value::{Id, Slot, Value};
use crate::vm::Vm;

const THIS_BEFORE_SUPER: &str = "Must call super constructor in derived class before accessing 'this' or returning from derived constructor";

impl Vm {
    /// The class flags of `v`'s code, when it is a class constructor.
    pub(crate) fn class_of(&self, v: &Value) -> u8 {
        match v {
            Value::Obj(id) => match &self.heap[*id as usize].kind {
                Kind::Closure(c) => c.proto.class,
                _ => 0,
            },
            _ => 0,
        }
    }

    /// The error for calling a class constructor without `new`.
    pub(crate) fn class_call_error(&mut self, id: Id) -> Value {
        let nk = self.names.name;
        let name = match self.peek(id, nk) {
            Value::Str(s) => self.text(s).to_owned(),
            v => self.quiet_string(&v),
        };
        self.type_error(&format!(
            "Class constructor {name} cannot be invoked without 'new'"
        ))
    }

    /// `new C(...)`, or `super(...)` for `new_target`: pushes C's constructor frame on a new instance of
    /// `new_target.prototype`, or with `new_target` itself as `this` when C is derived (see `Op::SuperBind`). The
    /// arguments are on the stack above the callee and receiver slots at `fpos`.
    pub(crate) fn construct_class(
        &mut self,
        ctor: Id,
        new_target: Id,
        fpos: usize,
        argc: usize,
    ) -> Result<(), Value> {
        let derived = self.class_of(&Value::Obj(ctor)) == CLASS_DERIVED;
        let this = if derived {
            Value::Obj(new_target)
        } else {
            let pk = self.names.prototype;
            let proto = match self.get_obj(new_target, pk) {
                Value::Obj(p) => p,
                _ => self.realm.object_proto,
            };
            Value::Obj(self.alloc(Obj::new(Some(proto), Kind::Ordinary)))
        };
        self.stack[fpos] = Slot::pack(Value::Obj(ctor));
        self.stack[fpos + 1] = Slot::pack(this);
        self.constructing = true;
        let r = self.enter_closure(ctor, fpos, argc);
        self.constructing = false;
        r
    }

    /// `Op::Class`: the constructor on top gets its prototype, and with a parent inherits from it.
    pub(crate) fn class_op(&mut self, derived: bool) -> Result<(), Value> {
        let ctor = self.pop().as_obj().unwrap_or(0);
        let parent = if derived {
            Some(self.class_parent()?)
        } else {
            None
        };
        let proto_of_proto = match parent {
            Some(p) => {
                let pk = self.names.prototype;
                match self.get_obj(p, pk) {
                    Value::Obj(pp) => Some(pp),
                    _ => Some(self.realm.object_proto),
                }
            }
            None => Some(self.realm.object_proto),
        };
        let proto = self.alloc(Obj::new(proto_of_proto, Kind::Ordinary));
        if let Some(p) = parent {
            self.heap[ctor as usize].proto = Some(p);
        }
        if let Kind::Closure(c) = &mut self.heap[ctor as usize].kind {
            c.home = Value::Obj(proto);
        }
        let (pk, ck) = (self.names.prototype, self.names.constructor);
        self.define_flags(ctor, pk, Value::Obj(proto), FIXED);
        self.define_flags(proto, ck, Value::Obj(ctor), HIDDEN);
        self.push(Value::Obj(ctor));
        self.push(Value::Obj(proto));
        Ok(())
    }

    /// What a class may extend, popped: another class or an Error type. Other built-ins and `null` are refused.
    fn class_parent(&mut self) -> Result<Id, Value> {
        let parent = self.pop();
        match parent {
            Value::Null => Err(self.type_error("Classes extending null are not supported.")),
            Value::Obj(id)
                if self.class_of(&parent) != 0 || self.error_ctor_proto(id).is_some() =>
            {
                Ok(id)
            }
            Value::Obj(id)
                if matches!(self.heap[id as usize].kind, Kind::Native { ctor: true, .. }) =>
            {
                let nk = self.names.name;
                let name = match self.peek(id, nk) {
                    Value::Str(s) => self.text(s).to_owned(),
                    v => self.quiet_string(&v),
                };
                Err(self.type_error(&format!(
                    "Extending the built-in {name} is not supported. Only classes and Error types can be extended."
                )))
            }
            _ => {
                let d = crate::builtins::describe_value(self, &parent);
                Err(self.type_error(&format!(
                    "Class extends value {d} is not a constructor or null."
                )))
            }
        }
    }

    /// Whether `id` is an error type's constructor (`is_error_ctor`), as `Some(id)`.
    pub(crate) fn error_ctor_proto(&mut self, id: Id) -> Option<Id> {
        crate::builtins::object::is_error_ctor(self, id).then_some(id)
    }

    /// Sets a property's value and attributes, replacing whatever was there (the reference's `define`).
    pub(crate) fn define_flags(&mut self, id: Id, key: Atom, val: Value, flags: u8) {
        let o = &mut self.heap[id as usize];
        match o.props.find(key) {
            Some(i) => {
                o.props.items[i].value = val;
                o.props.items[i].flags = flags;
            }
            None => o.props.push_new(key, val, flags),
        }
    }

    /// `Op::DefineMethod`.
    pub(crate) fn define_method(&mut self, key: Atom, flags: u8) -> Result<(), Value> {
        let f = self.pop();
        let key = if flags & 2 != 0 {
            let k = self.pop();
            self.key_of(&k)?
        } else {
            key
        };
        let n = self.stack.len();
        let at = if flags & 1 != 0 { n - 2 } else { n - 1 };
        let home = self.stack[at].get().as_obj().unwrap_or(0);
        let Value::Obj(fid) = f else { return Ok(()) };
        if let Kind::Closure(c) = &mut self.heap[fid as usize].kind {
            c.home = Value::Obj(home);
        }
        if key == self.names.prototype && self.class_of(&Value::Obj(home)) != 0 {
            return Err(
                self.type_error("Classes may not have a static property named 'prototype'.")
            );
        }
        let shown = self.key_shown(key);
        let nk = self.names.name;
        if flags & 12 == 0 {
            let name = self.str_val(&shown);
            self.define_flags(fid, nk, name, 0);
            self.define_flags(home, key, f, HIDDEN);
            return Ok(());
        }
        let setter = flags & 8 != 0;
        let name = self.str_val(&format!("{} {shown}", if setter { "set" } else { "get" }));
        self.define_flags(fid, nk, name, 0);
        self.define_accessor_half(home, key, setter, f, false);
        Ok(())
    }

    /// A key as a function's name: `[Symbol.iterator]` for the iterator symbols.
    pub(crate) fn key_shown(&self, key: Atom) -> String {
        match key {
            SYM_ITERATOR => "[Symbol.iterator]".to_owned(),
            SYM_ASYNC_ITERATOR => "[Symbol.asyncIterator]".to_owned(),
            _ => self.key_text(key),
        }
    }

    /// `Op::NameByKey`: names the function on top by the key under it, unless it is a class with a static `name`.
    pub(crate) fn name_by_key(&mut self, mode: u8) -> Result<(), Value> {
        let n = self.stack.len();
        let Value::Obj(fid) = self.stack[n - 1].get() else {
            return Ok(());
        };
        if !matches!(self.heap[fid as usize].kind, Kind::Closure(_)) || self.has_static_name(fid) {
            return Ok(());
        }
        let k = self.stack[n - 2].get();
        let key = self.key_of(&k)?;
        let shown = self.key_shown(key);
        let name = match mode {
            1 => format!("get {shown}"),
            2 => format!("set {shown}"),
            _ => shown,
        };
        let name = self.str_val(&name);
        let nk = self.names.name;
        self.define_flags(fid, nk, name, 0);
        Ok(())
    }

    /// Whether a class has a static `name` member of its own: a method, an accessor, or anything not a string.
    fn has_static_name(&self, fid: Id) -> bool {
        if self.class_of(&Value::Obj(fid)) == 0 {
            return false;
        }
        self.heap[fid as usize]
            .props
            .prop(self.names.name)
            .is_some_and(|p| p.flags & ACCESSOR != 0 || !matches!(p.value, Value::Str(_)))
    }

    /// `Op::SetFields`.
    pub(crate) fn set_fields(&mut self) {
        let f = self.pop();
        let n = self.stack.len();
        let (ctor, proto) = (self.stack[n - 2].get(), self.stack[n - 1].get());
        if let Value::Obj(fid) = f
            && let Kind::Closure(c) = &mut self.heap[fid as usize].kind
        {
            c.home = proto;
        }
        if let Value::Obj(cid) = ctor
            && let Kind::Closure(c) = &mut self.heap[cid as usize].kind
        {
            c.fields = f;
        }
    }

    /// `Op::InitFields` in the frame whose callee is at `callee`: calls the class's field initializer on `this` (on
    /// top), or gives undefined when it has none. Whether a frame was pushed.
    pub(crate) fn init_fields(&mut self, callee: Value) -> Result<bool, Value> {
        let this = self.pop();
        let fields = match callee {
            Value::Obj(id) => match &self.heap[id as usize].kind {
                Kind::Closure(c) => c.fields,
                _ => Value::Undef,
            },
            _ => Value::Undef,
        };
        if let Value::Undef = fields {
            self.push(Value::Undef);
            return Ok(false);
        }
        self.push(fields);
        self.push(this);
        self.call_op(0)
    }

    /// `Op::InitStatic`: `[ctor, fn]`, `fn` called on the constructor, its home.
    pub(crate) fn init_static(&mut self) -> Result<bool, Value> {
        let f = self.pop();
        let ctor = self.pop();
        if let Value::Obj(fid) = f
            && let Kind::Closure(c) = &mut self.heap[fid as usize].kind
        {
            c.home = ctor;
        }
        self.push(f);
        self.push(ctor);
        self.call_op(0)
    }

    /// `Op::SuperCall` in the frame at `base`: constructs the running constructor's parent for the new target.
    /// Whether a frame was pushed.
    pub(crate) fn super_call(&mut self, base: usize, argc: u32, nt: u32) -> Result<bool, Value> {
        let args: Vec<Value> = if argc == u32::MAX {
            match self.pop() {
                Value::Obj(id) => match &self.heap[id as usize].kind {
                    Kind::Array(items) => crate::ops::without_holes(items),
                    _ => Vec::new(),
                },
                _ => Vec::new(),
            }
        } else {
            let n = self.stack.len() - argc as usize;
            self.stack.drain(n..).map(|s| s.get()).collect()
        };
        let new_target = self.stack[base + nt as usize].get().as_obj().unwrap_or(0);
        let callee = self.stack[base - 2].get().as_obj().unwrap_or(0);
        let parent = self.heap[callee as usize].proto;
        let fpos = self.stack.len();
        self.push(Value::Undef);
        self.push(Value::Undef);
        self.stack.extend(args.iter().map(|v| Slot::pack(*v)));
        match parent {
            Some(p) if self.class_of(&Value::Obj(p)) != 0 => {
                self.construct_class(p, new_target, fpos, args.len())?;
                Ok(true)
            }
            Some(p) if self.error_ctor_proto(p).is_some() => {
                self.stack[fpos] = Slot::pack(Value::Obj(p));
                self.new_target = Some(new_target);
                let r = self.construct_op(args.len());
                self.new_target = None;
                r
            }
            _ => {
                self.stack.truncate(fpos);
                let p = parent.map_or(Value::Null, Value::Obj);
                let d = crate::builtins::describe_value(self, &p);
                Err(self.type_error(&format!(
                    "Super constructor {d} of anonymous class is not a constructor"
                )))
            }
        }
    }

    /// `Op::SuperBind`: `[instance, this] -> [instance]`, once.
    pub(crate) fn super_bind(&mut self) -> Result<(), Value> {
        let this = self.pop();
        if !matches!(this, Value::Uninit) {
            return Err(self.reference_error("Super constructor may only be called once"));
        }
        Ok(())
    }

    /// The object `super.x` reads from: the home object's prototype.
    fn super_base(&mut self, home: Value) -> Result<Id, Value> {
        match home {
            Value::Obj(h) => {
                match self.heap[h as usize].proto {
                    Some(p) => Ok(p),
                    None => Err(self
                        .type_error("Cannot use 'super' here: the home object has no prototype.")),
                }
            }
            _ => Err(self.type_error("Cannot use 'super' here: the home object has no prototype.")),
        }
    }

    /// `Op::GetSuper`: the value, or `Some` getter to call with `this` (the receiver is pushed already when kept).
    pub(crate) fn get_super(
        &mut self,
        key: Atom,
        flags: u8,
    ) -> Result<Option<(Value, Value)>, Value> {
        let key = if flags & 2 != 0 {
            let k = self.pop();
            self.key_of(&k)?
        } else {
            key
        };
        let this = self.pop();
        let home = self.pop();
        let proto = self.super_base(home)?;
        let v = self.read_with_receiver(proto, key, this);
        if let Value::Uninit = v {
            return Err(crate::builtins::accessor_error(self, proto, key));
        }
        if let Some(g) = self.getter_hit.take() {
            if flags & 1 != 0 {
                return Ok(Some((g, this)));
            }
            return Ok(Some((g, this)));
        }
        self.push(v);
        if flags & 1 != 0 {
            self.push(this);
        }
        Ok(None)
    }

    /// A named read from `proto`'s chain with `receiver` as the getter's receiver (the reference's `readObjProp`): a
    /// program getter is handed back in `getter_hit`.
    fn read_with_receiver(&mut self, proto: Id, key: Atom, receiver: Value) -> Value {
        let mut cur = Some(proto);
        while let Some(c) = cur {
            if let Some(p) = self.heap[c as usize].props.prop(key) {
                if p.flags & ACCESSOR == 0 {
                    if let Value::Uninit = p.value {
                        // A built-in accessor serves the receiver if it is of its kind.
                        return self.companion_value(receiver, key);
                    }
                    return p.value;
                }
                let pair = p.value;
                self.op_access = true;
                let v = self.accessor_read(pair, receiver, key);
                self.op_access = false;
                return v;
            }
            if self.has_own(c, key) {
                return self.get_obj(c, key);
            }
            cur = self.heap[c as usize].proto;
        }
        Value::Undef
    }

    /// `Op::PutSuper`: whether it met a program setter, which `setter_hit` holds for the instruction to call with
    /// `this`; the value is pushed otherwise.
    pub(crate) fn put_super(
        &mut self,
        key: Atom,
        flags: u8,
    ) -> Result<Option<(Value, Value, Value)>, Value> {
        let v = self.pop();
        let key = if flags & 2 != 0 {
            let k = self.pop();
            self.key_of(&k)?
        } else {
            key
        };
        let this = self.pop();
        let home = self.pop();
        let proto = self.super_base(home)?;
        if let Some((pair, uninit)) = self.slot_on_chain(proto, key) {
            if uninit {
                let k = self.key_text(key);
                return Err(self.type_error(&format!(
                    "Cannot set property {k}, which has only a getter."
                )));
            }
            let s = self.pair(pair).set;
            if let Value::Undef = s {
                let k = self.key_text(key);
                return Err(self.type_error(&format!(
                    "Cannot set property {k}, which has only a getter."
                )));
            }
            if self.is_companion(&s) {
                let id = s.as_obj().unwrap_or(0);
                crate::accessors::companion_set(self, this, &[v], id)?;
                self.push(v);
                return Ok(None);
            }
            return Ok(Some((s, this, v)));
        }
        if !matches!(this, Value::Obj(_)) {
            let k = self.key_text(key);
            let d = crate::builtins::describe_value(self, &this);
            return Err(self.type_error(&format!("Cannot set property {k} of {d}.")));
        }
        self.check_assignment_at(&this, key, &v)?;
        if let Some(s) = self.op_write(&this, key, v)? {
            return Ok(Some((s, this, v)));
        }
        self.push(v);
        Ok(None)
    }

    /// The accessor first found for `key` on `id`'s chain: its pair, or a built-in accessor (`true`).
    fn slot_on_chain(&self, id: Id, key: Atom) -> Option<(Value, bool)> {
        let mut cur = Some(id);
        while let Some(c) = cur {
            if let Some(p) = self.heap[c as usize].props.prop(key) {
                if p.flags & ACCESSOR != 0 {
                    return Some((p.value, false));
                }
                return matches!(p.value, Value::Uninit).then_some((Value::Undef, true));
            }
            if self.has_own(c, key) {
                return None;
            }
            cur = self.heap[c as usize].proto;
        }
        None
    }

    /// `Op::CtorReturn`.
    pub(crate) fn ctor_return(&mut self, derived: bool) -> Result<(), Value> {
        let this = self.pop();
        let v = self.pop();
        if matches!(v, Value::Obj(_)) {
            self.push(v);
            return Ok(());
        }
        if derived {
            if !matches!(v, Value::Undef) {
                return Err(
                    self.type_error("Derived constructors may only return object or undefined")
                );
            }
            if matches!(this, Value::Uninit) {
                return Err(self.reference_error(THIS_BEFORE_SUPER));
            }
        }
        self.push(this);
        Ok(())
    }

    /// The `this` TDZ error of a derived constructor.
    pub(crate) fn this_before_super(&mut self) -> Value {
        self.reference_error(THIS_BEFORE_SUPER)
    }

    /// `Op::DefineClassField`: CreateDataPropertyOrThrow.
    pub(crate) fn define_class_field(&mut self, key: Atom, computed: bool) -> Result<(), Value> {
        let v = self.pop();
        let key = if computed {
            let k = self.pop();
            self.key_of(&k)?
        } else {
            key
        };
        let Value::Obj(id) = self.top() else {
            return Ok(());
        };
        let desc = crate::accessors::Descriptor {
            value: Some(v),
            writable: Some(true),
            enumerable: Some(true),
            configurable: Some(true),
            ..Default::default()
        };
        if !self.define_own_property(id, key, &desc)? {
            let k = match key {
                SYM_ITERATOR => "Symbol(Symbol.iterator)".to_owned(),
                SYM_ASYNC_ITERATOR => "Symbol(Symbol.asyncIterator)".to_owned(),
                _ => self.key_text(key),
            };
            return Err(self.type_error(&format!("Cannot define property {k}.")));
        }
        Ok(())
    }

    /// The running frame's home object: its callee's.
    pub(crate) fn home_of(&self, callee: Value) -> Value {
        match callee {
            Value::Obj(id) => match &self.heap[id as usize].kind {
                Kind::Closure(c) => c.home,
                _ => Value::Undef,
            },
            _ => Value::Undef,
        }
    }

    /// A function's own `name` when it is a string, else empty (the reference's `ownName`).
    fn own_name(&mut self, id: Id) -> String {
        let nk = self.names.name;
        match self.own_slot(id, nk) {
            Some(crate::accessors::OwnSlot {
                value: crate::accessors::SlotValue::Data(Value::Str(s)),
                ..
            }) => self.text(s).to_owned(),
            _ => String::new(),
        }
    }

    /// How `console.log` shows a class: `[class A]`, `[class B extends A]`.
    pub(crate) fn class_shown(&mut self, id: Id) -> String {
        let name = match self.own_name(id) {
            n if n.is_empty() => "(anonymous)".to_owned(),
            n => n,
        };
        let parent = match self.heap[id as usize].proto {
            Some(p)
                if self.class_of(&Value::Obj(id)) == CLASS_DERIVED
                    && self.heap[p as usize].is_callable() =>
            {
                self.own_name(p)
            }
            _ => String::new(),
        };
        if parent.is_empty() {
            format!("[class {name}]")
        } else {
            format!("[class {name} extends {parent}]")
        }
    }

    /// The class an instance was made by, from its prototype's own `constructor`, without running program code.
    pub(crate) fn instance_class_name(&mut self, id: Id) -> Option<String> {
        let proto = self.heap[id as usize].proto?;
        let ck = self.names.constructor;
        let ctor = self.heap[proto as usize]
            .props
            .prop(ck)
            .filter(|p| p.flags & ACCESSOR == 0)
            .map(|p| p.value)?;
        if self.class_of(&ctor) == 0 {
            return None;
        }
        let name = self.own_name(ctor.as_obj()?);
        (!name.is_empty()).then_some(name)
    }
}
