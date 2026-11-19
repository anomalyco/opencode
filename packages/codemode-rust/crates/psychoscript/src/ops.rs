//! Property access, conversions, operators and iteration on program values.

use crate::builtins::exotic;
use crate::bytecode::{ITER_FOR_OF, Site};
use crate::iteration::{BY_CLOSE, BY_COUNTED, BY_RESUME, BY_UNCOUNTED};
use crate::object::*;
use crate::strings::StrId;
use crate::value::{Id, Value, num_to_string, str_to_num};
use crate::vm::{NATIVE_FUEL, REQ_NEXT, REQ_RETURN, Res, Vm};

pub const MAX_STRING_LEN: usize = 1 << 24;
const UNAWAITED: &str =
    "This value is an un-awaited Promise; await it first - e.g. `const result = await load(...)`.";
pub const MAX_ARRAY_LEN: usize = 10_000_000;

#[derive(Clone, Copy, PartialEq)]
pub enum Hint {
    Default,
    Number,
    String,
}

impl Vm {
    // ---------- property reads ----------

    #[inline(never)]
    pub fn get(&mut self, v: &Value, key: Atom) -> Res {
        match v {
            Value::Obj(id) => {
                let v = self.get_obj(*id, key);
                if let Value::Uninit = v {
                    return Err(crate::builtins::accessor_error(self, *id, key));
                }
                if matches!(v, Value::Undef)
                    && matches!(self.heap[*id as usize].kind, Kind::Promise(_))
                    && !self.has_key(*id, key)
                {
                    return Err(self.unawaited());
                }
                Ok(v)
            }
            Value::Str(s) => {
                let s = *s;
                if key == self.names.length {
                    return Ok(Value::Num(self.atoms.sref(s).len16() as f64));
                }
                if let Some(i) = self.atoms.index(key) {
                    return Ok(match self.atoms.sref(s).code_unit(i as usize) {
                        Some(c) => self.char_str(c),
                        None => Value::Undef,
                    });
                }
                let p = self.realm.string_proto;
                Ok(self.get_obj(p, key))
            }
            Value::Num(_) => {
                let p = self.realm.number_proto;
                Ok(self.get_obj(p, key))
            }
            Value::Bool(_) => {
                let p = self.realm.boolean_proto;
                Ok(self.get_obj(p, key))
            }
            // A symbol has no wrapper prototype in the reference.
            Value::Sym(_) => {
                Err(self.type_error("Cannot access a property on a non-object value."))
            }
            Value::Undef | Value::Null | Value::Uninit => {
                let k = self.key_text(key);
                let t = if let Value::Null = v {
                    "null"
                } else {
                    "undefined"
                };
                Err(self.nullish_read(t, &k))
            }
        }
    }

    /// A destructuring pattern's read: a member read, except that a promise's missing key reads as undefined
    /// instead of reporting a missing await, as the reference's `destructuredProperty` does.
    pub fn get_destructured(&mut self, v: &Value, key: Atom) -> Res {
        if let Value::Obj(id) = v
            && self.is_promise(*id)
        {
            let r = self.get_obj(*id, key);
            if let Value::Uninit = r {
                return Err(crate::builtins::accessor_error(self, *id, key));
            }
            return Ok(r);
        }
        self.get(v, key)
    }

    /// [`Vm::get_destructured`] with a key value `ToKey` made.
    pub fn get_elem_destructured(&mut self, v: &Value, k: &Value) -> Res {
        if let Value::Obj(id) = v
            && self.is_promise(*id)
        {
            let a = self.key_of(k)?;
            return self.get_destructured(v, a);
        }
        self.get_elem(v, k)
    }

    pub fn key_text(&self, key: Atom) -> String {
        if key <= SYM_ASYNC_ITERATOR {
            return symbol_text(key).to_owned();
        }
        self.atoms.text(key).to_owned()
    }

    /// A key's text in a message about a nullish base, made without calling the program, as the reference's
    /// `coerceToString` does.
    fn key_message(&mut self, k: &Value) -> String {
        match k {
            Value::Obj(_) => crate::builtins::builtin_string(self, k).unwrap_or_default(),
            k => self.quiet_string(k),
        }
    }

    #[inline(never)]
    pub fn get_obj(&mut self, id: Id, key: Atom) -> Value {
        let mut cur = id;
        loop {
            let o = &self.heap[cur as usize];
            match &o.kind {
                Kind::Array(items) => {
                    if let Some(i) = self.atoms.index(key) {
                        // A hole or an index past the end may still be inherited.
                        if let Some(v) = items.get(i as usize)
                            && !matches!(v, Value::Uninit)
                        {
                            return *v;
                        }
                    } else if key == self.names.length && o.flags & SPARSE == 0 {
                        return Value::Num(items.len() as f64);
                    }
                }
                Kind::Arguments(items) => {
                    // An arguments object is ordinary: an index past its arguments is a plain property, and its
                    // `length` is a hidden one.
                    if let Some(i) = self.atoms.index(key)
                        && let Some(v) = items.get(i as usize)
                        && !matches!(v, Value::Uninit)
                    {
                        return *v;
                    }
                }
                Kind::Closure(c) if o.props.find(key).is_none() => {
                    if key == self.names.name && o.flags & NAME_DELETED == 0 {
                        return Value::Str(self.atoms.atom_str(c.proto.name));
                    }
                    if key == self.names.length && o.flags & LENGTH_DELETED == 0 {
                        return Value::Num(c.proto.length as f64);
                    }
                }
                Kind::Native { name, length, .. } if o.props.find(key).is_none() => {
                    if key == self.names.name && o.flags & NAME_DELETED == 0 {
                        return Value::Str(self.atoms.atom_str(*name));
                    }
                    if key == self.names.length && o.flags & LENGTH_DELETED == 0 {
                        return Value::Num(*length as f64);
                    }
                }
                Kind::Map(m) | Kind::Set(m) if cur == id && key == self.names.size => {
                    return Value::Num(m.live as f64);
                }
                Kind::Namespace(_) if cur == id => {
                    // `then` is a path like any other; a namespace is never a thenable (`resolve_promise`).
                    if key <= SYM_ASYNC_ITERATOR {
                        return Value::Undef;
                    }
                    return self.ns_ref(NsPath {
                        parent: id,
                        name: key,
                    });
                }
                // A Map's or Set's only own accessor is `size`, above.
                Kind::Map(_) | Kind::Set(_) => {}
                k if cur == id && exotic::is_exotic(k) => {
                    if let Some(v) = exotic::get(self, id, key) {
                        return v;
                    }
                }
                _ => {}
            }
            let o = &self.heap[cur as usize];
            if let Some(v) = o.props.get(key) {
                return *v;
            }
            match o.proto {
                Some(p) => cur = p,
                None => return Value::Undef,
            }
        }
    }

    /// An array's element that is a hole or past its end, which its prototypes may still have.
    #[cold]
    pub(crate) fn missing_elem(&mut self, id: Id, i: usize) -> Value {
        self.inherited_elem(id, i).unwrap_or_default()
    }

    /// Element `i` of `id`'s prototypes, if one has it. An index never used as a key can still sit in an array
    /// prototype's items (`Array.prototype[0] = x`), which store it without interning it.
    #[cold]
    pub(crate) fn inherited_elem(&mut self, id: Id, i: usize) -> Option<Value> {
        if self.heap[id as usize].flags & SPARSE != 0
            && let Some(key) = self.atoms.lookup(&i.to_string())
            && let Some(v) = self.heap[id as usize].props.get(key)
        {
            return Some(*v);
        }
        let proto = self.heap[id as usize].proto?;
        if let Some(key) = self.atoms.lookup(&i.to_string()) {
            return self.has_key(proto, key).then(|| self.get_obj(proto, key));
        }
        let mut cur = Some(proto);
        while let Some(p) = cur {
            let o = &self.heap[p as usize];
            if let Kind::Array(items) = &o.kind
                && let Some(v) = items.get(i)
                && !matches!(v, Value::Uninit)
            {
                return Some(*v);
            }
            cur = o.proto;
        }
        None
    }

    #[inline(never)]
    pub fn get_elem(&mut self, v: &Value, k: &Value) -> Res {
        match (v, k) {
            (Value::Obj(id), Value::Num(n)) => {
                if let Kind::Array(items) = &self.heap[*id as usize].kind {
                    let i = *n as usize;
                    // 2^32 - 1 and above are not array indexes but plain keys.
                    if i as f64 == *n && i < u32::MAX as usize {
                        return Ok(match items.get(i) {
                            Some(v) if !matches!(v, Value::Uninit) => *v,
                            _ => self.missing_elem(*id, i),
                        });
                    }
                }
                if self.is_namespace(*id) {
                    return Err(self.namespace_key_error(*id));
                }
            }
            (Value::Obj(id), Value::Sym(_)) if self.is_namespace(*id) => {
                return Err(self.namespace_key_error(*id));
            }
            (Value::Str(s), Value::Num(n)) => {
                let i = *n as usize;
                if i as f64 == *n {
                    return Ok(match self.atoms.sref(*s).code_unit(i) {
                        Some(c) => self.char_str(c),
                        None => Value::Undef,
                    });
                }
            }
            (Value::Undef | Value::Null, _) => {
                let k = self.key_message(k);
                let t = if let Value::Null = v {
                    "null"
                } else {
                    "undefined"
                };
                return Err(self.nullish_read(t, &k));
            }
            _ => {}
        }
        let a = self.key_of(k)?;
        self.get(v, a)
    }

    #[inline(never)]
    pub fn key_of(&mut self, k: &Value) -> Result<Atom, Value> {
        Ok(match k {
            Value::Str(s) => self.atoms.intern_id(*s),
            Value::Num(n) => {
                let s = num_to_string(*n);
                self.atoms.intern(&s)
            }
            Value::Sym(s) => *s,
            Value::Obj(_) => {
                // A member's key that fails to convert fails at the key.
                let p = self
                    .primitive_of(k, Hint::String)
                    .map_err(|e| self.at_site(e, Site::Key))?;
                // A namespace or a promise stays as it is; its key is its text.
                if let Value::Obj(_) = p {
                    let s = self.string_of(&p)?;
                    return Ok(self.atoms.intern_id(s));
                }
                return self.key_of(&p);
            }
            Value::Bool(b) => self.atoms.intern(if *b { "true" } else { "false" }),
            Value::Null => self.atoms.intern_static("null"),
            Value::Undef | Value::Uninit => self.atoms.intern_static("undefined"),
        })
    }

    // ---------- data guards ----------

    /// Whether `id` is a namespace reference, which the reference keeps outside its objects (`HostNamespace`).
    #[inline]
    pub(crate) fn is_namespace(&self, id: Id) -> bool {
        matches!(self.heap[id as usize].kind, Kind::Namespace(_))
    }

    #[inline]
    pub(crate) fn is_promise(&self, id: Id) -> bool {
        matches!(self.heap[id as usize].kind, Kind::Promise(_))
    }

    /// Whether `v` is an object the reference converts (`instanceof Obj`): not a primitive and not a namespace.
    #[inline]
    pub(crate) fn is_convertible_obj(&self, v: &Value) -> bool {
        matches!(v, Value::Obj(id) if !self.is_namespace(*id))
    }

    /// Promises and namespace paths are not data: operators reject them, as the reference does.
    pub fn is_opaque_operand(&self, v: &Value) -> bool {
        matches!(v, Value::Obj(id) if matches!(self.heap[*id as usize].kind, Kind::Promise(_) | Kind::Namespace(_)))
    }

    pub fn data_operand(&mut self, v: &Value, msg: &str) -> Result<(), Value> {
        if self.is_opaque_operand(v) {
            return Err(self.invalid_data(msg));
        }
        Ok(())
    }

    #[inline]
    pub fn data_operands(&mut self, a: &Value, b: &Value) -> Result<(), Value> {
        if self.is_opaque_operand(a) || self.is_opaque_operand(b) {
            return Err(self.invalid_data("Binary operators require data values."));
        }
        Ok(())
    }

    /// `==` compares objects by identity and nullish values without coercion, so only a mixed comparison of an
    /// opaque value with data is rejected.
    pub fn loose_eq_operands(&mut self, a: &Value, b: &Value) -> Result<(), Value> {
        match (a, b) {
            (Value::Obj(_), Value::Obj(_)) => Ok(()),
            (x, y) if x.is_nullish() || y.is_nullish() => Ok(()),
            _ => self.data_operands(a, b),
        }
    }

    // ---------- property writes ----------

    /// Rejects storing `value` into `container` when `container` is reachable from it through data objects, as
    /// the reference does, so a value never refers to itself. Opaque values (functions, promises, collections) end
    /// the walk but still match.
    #[inline(never)]
    pub fn reject_circular(
        &mut self,
        container: Id,
        value: &Value,
        label: &str,
    ) -> Result<(), Value> {
        let Value::Obj(start) = value else {
            return Ok(());
        };
        let mut pending = vec![*start];
        let mut seen = rustc_hash::FxHashSet::default();
        while let Some(id) = pending.pop() {
            if id == container {
                let msg = format!("{label} contains a circular value.");
                let p = self.realm.type_error_proto;
                return Err(self.failure(p, &msg, crate::DiagnosticKind::InvalidDataValue));
            }
            if !seen.insert(id) {
                continue;
            }
            let o = &self.heap[id as usize];
            if let Kind::Array(items) | Kind::Arguments(items) = &o.kind {
                pending.extend(items.iter().filter_map(Value::as_obj));
            } else if !matches!(o.kind, Kind::Ordinary | Kind::Error(_) | Kind::Live(_)) {
                continue;
            }
            pending.extend(o.props.items.iter().filter_map(|p| p.value.as_obj()));
        }
        Ok(())
    }

    /// The circularity check of a member assignment `o[k] = v`.
    #[inline]
    pub fn check_assignment(&mut self, o: &Value, v: &Value) -> Result<(), Value> {
        if let (Value::Obj(c), Value::Obj(_)) = (o, v) {
            let label = if matches!(self.heap[*c as usize].kind, Kind::Array(_)) {
                "Array assignment result"
            } else {
                "Object assignment result"
            };
            return self.reject_circular(*c, v, label);
        }
        Ok(())
    }

    #[inline(never)]
    pub fn set(&mut self, v: &Value, key: Atom, val: Value) -> Result<(), Value> {
        match v {
            Value::Obj(id) => self.set_obj(*id, key, val),
            // The reference resolves the base as a read does, so a nullish one fails as a read.
            Value::Undef | Value::Null | Value::Uninit => {
                let k = self.key_text(key);
                let t = if let Value::Null = v {
                    "null"
                } else {
                    "undefined"
                };
                Err(self.nullish_read(t, &k))
            }
            Value::Sym(_) => {
                Err(self.type_error("Cannot access a property on a non-object value."))
            }
            // A string's length and indexes are its own values, not fields.
            Value::Str(_) if key == self.names.length || self.atoms.index(key).is_some() => {
                Err(self.type_error("Only data fields may be assigned."))
            }
            _ => {
                let k = self.key_text(key);
                let t = self.type_of(v);
                let s = self.string_of(v)?;
                let s = self.text(s).to_owned();
                Err(self.type_error(&format!("Cannot create property '{k}' on {t} '{s}'.")))
            }
        }
    }

    /// Whether a member write through `v` needs [`Vm::check_writable`]: it is not a plain object.
    #[inline]
    pub(crate) fn write_checked(&self, v: &Value) -> bool {
        !matches!(v, Value::Obj(id) if !self.is_namespace(*id) && !self.is_promise(*id))
    }

    /// The reference's check of the member an assignment or update writes through before it reads or writes it
    /// (`writableReference`, then `readReference`): only a data field of an object, of a promise one it has.
    #[cold]
    #[inline(never)]
    pub(crate) fn check_writable(&mut self, v: &Value, key: Atom) -> Result<(), Value> {
        match v {
            Value::Obj(id) if self.is_namespace(*id) => {
                if key <= SYM_ASYNC_ITERATOR {
                    return Err(self.namespace_key_error(*id));
                }
                Err(self.type_error("Only data fields may be assigned."))
            }
            Value::Obj(id) if self.is_promise(*id) && !self.has_key(*id, key) => {
                Err(self.unawaited())
            }
            Value::Obj(_) => Ok(()),
            Value::Undef | Value::Null | Value::Uninit => {
                let k = self.key_text(key);
                let t = if let Value::Null = v {
                    "null"
                } else {
                    "undefined"
                };
                Err(self.nullish_read(t, &k))
            }
            // A primitive has no field to write: the write fails as it would.
            v => self.set(v, key, Value::Undef),
        }
    }

    /// A computed member's key as a write target: `[o, k]` -> the key, after the base is checked as read (a nullish
    /// one fails before the key converts) and then as written, as the reference's `emitWritableKey` checks it.
    pub(crate) fn write_key(&mut self, o: &Value, k: &Value) -> Res {
        if o.is_nullish() {
            let k = self.key_message(k);
            let t = if let Value::Null = o {
                "null"
            } else {
                "undefined"
            };
            return Err(self.nullish_read(t, &k));
        }
        // A number stays a number, as the reference's `TO_KEY` keeps it: a namespace path refuses it.
        let key = match k {
            Value::Num(_) | Value::Str(_) | Value::Sym(_) => *k,
            k => {
                let a = self.key_of(k)?;
                if a <= SYM_ASYNC_ITERATOR {
                    Value::Sym(a)
                } else {
                    self.atom_val(a)
                }
            }
        };
        if self.write_checked(o) {
            if let (Value::Num(_), Value::Obj(id)) = (&key, o)
                && self.is_namespace(*id)
            {
                return Err(self.namespace_key_error(*id));
            }
            let a = self.key_of(&key)?;
            self.check_writable(o, a)?;
        }
        Ok(key)
    }

    #[inline(never)]
    pub fn set_obj(&mut self, id: Id, key: Atom, val: Value) -> Result<(), Value> {
        if matches!(self.heap[id as usize].kind, Kind::Promise(_)) && !self.has_key(id, key) {
            return Err(self.unawaited());
        }
        let flags = self.heap[id as usize].flags;
        let length = self.names.length;
        let index = self.atoms.index(key);
        let is_name_or_length = key == length || key == self.names.name;
        match &mut self.heap[id as usize].kind {
            Kind::Array(items) => {
                if let Some(i) = index {
                    let i = i as usize;
                    if flags & FROZEN != 0 {
                        return Err(self.read_only(key));
                    }
                    if i < items.len() && !matches!(items[i], Value::Uninit) {
                        items[i] = val;
                        return Ok(());
                    }
                    if flags & NON_EXTENSIBLE != 0 {
                        return Err(self.not_extensible(key));
                    }
                    if i < items.len() {
                        items[i] = val;
                        return Ok(());
                    }
                    if flags & SPARSE != 0 || i >= MAX_ARRAY_LEN {
                        self.sparse_set(id, key, i, val);
                        return Ok(());
                    }
                    items.resize(i, Value::Uninit);
                    items.push(val);
                    return Ok(());
                }
                if key == length {
                    if flags & FROZEN != 0 {
                        return Err(self.read_only(key));
                    }
                    let n = match val {
                        Value::Num(n) => n,
                        _ => self.number_of(&val)?,
                    };
                    if n < 0.0 || n.fract() != 0.0 || n as usize > MAX_ARRAY_LEN {
                        return Err(self.range_error("Invalid array length"));
                    }
                    if flags & SPARSE != 0 {
                        self.unsparse(id, n as usize);
                    } else if let Kind::Array(items) = &mut self.heap[id as usize].kind {
                        items.resize(n as usize, Value::Uninit);
                    }
                    return Ok(());
                }
            }
            Kind::Arguments(items) => {
                if let Some(i) = index
                    && let Some(slot) = items.get_mut(i as usize)
                {
                    if flags & FROZEN != 0 {
                        return Err(self.read_only(key));
                    }
                    if matches!(slot, Value::Uninit) && flags & NON_EXTENSIBLE != 0 {
                        return Err(self.not_extensible(key));
                    }
                    *slot = val;
                    return Ok(());
                }
            }
            Kind::Closure(_) | Kind::Native { .. } | Kind::Bound(_) if is_name_or_length => {
                return Err(self.read_only(key));
            }
            Kind::Namespace(_) => return Err(self.type_error("Only data fields may be assigned.")),
            k if exotic::is_exotic(k) => {
                if let Some(r) = exotic::set(self, id, key, val) {
                    return r;
                }
            }
            _ => {}
        }
        let o = &mut self.heap[id as usize];
        match o.props.find(key) {
            Some(i) => {
                if flags & FROZEN != 0 || o.props.items[i].flags & WRITABLE == 0 {
                    return Err(self.read_only(key));
                }
                o.props.items[i].value = val;
            }
            None => {
                if flags & NON_EXTENSIBLE != 0 {
                    return Err(self.not_extensible(key));
                }
                o.props.push_new(key, val, DEFAULT_FLAGS);
            }
        }
        Ok(())
    }

    fn read_only(&mut self, key: Atom) -> Value {
        let k = self.key_text(key);
        self.type_error(&format!("Cannot assign to read only property '{k}'."))
    }

    fn not_extensible(&mut self, key: Atom) -> Value {
        let k = self.key_text(key);
        self.type_error(&format!(
            "Cannot add property {k}, object is not extensible."
        ))
    }

    #[inline(never)]
    pub fn set_elem(&mut self, v: &Value, k: &Value, val: Value) -> Result<(), Value> {
        if let (Value::Obj(id), Value::Num(_) | Value::Sym(_)) = (v, k)
            && self.is_namespace(*id)
        {
            return Err(self.namespace_key_error(*id));
        }
        if let (Value::Obj(id), Value::Num(n)) = (v, k) {
            let o = &mut self.heap[*id as usize];
            if o.flags == 0
                && let Kind::Array(items) = &mut o.kind
            {
                let i = *n as usize;
                if i as f64 == *n && i < items.len() {
                    items[i] = val;
                    return Ok(());
                }
                if i as f64 == *n && i == items.len() {
                    items.push(val);
                    return Ok(());
                }
            }
        }
        // The reference resolves the base as a read does, so a nullish one fails as a read.
        if v.is_nullish() {
            let k = self.key_message(k);
            let t = if let Value::Null = v {
                "null"
            } else {
                "undefined"
            };
            return Err(self.nullish_read(t, &k));
        }
        let a = self.key_of(k)?;
        self.set(v, a, val)
    }

    /// Defines an own enumerable data property, as object literals do.
    #[inline(never)]
    pub fn define(&mut self, id: Id, key: Atom, val: Value) {
        let index = self.atoms.index(key);
        let o = &mut self.heap[id as usize];
        if let (Kind::Array(items), Some(i)) = (&mut o.kind, index) {
            let i = i as usize;
            if i < items.len() {
                items[i] = val;
            } else if i < MAX_ARRAY_LEN && o.flags & SPARSE == 0 {
                items.resize(i, Value::Uninit);
                items.push(val);
            } else {
                self.sparse_set(id, key, i, val);
            }
            return;
        }
        match o.props.find(key) {
            Some(i) => {
                o.props.items[i].value = val;
                o.props.items[i].flags = DEFAULT_FLAGS;
            }
            None => o.props.push_new(key, val, DEFAULT_FLAGS),
        }
    }

    pub fn define_hidden(&mut self, id: Id, key: Atom, val: Value) {
        self.heap[id as usize].props.insert(key, val, HIDDEN);
    }

    #[inline(never)]
    pub fn delete(&mut self, v: &Value, key: Atom) -> Result<bool, Value> {
        let Value::Obj(id) = v else {
            return self.delete_primitive(v, key);
        };
        let id = *id;
        if exotic::is_exotic(&self.heap[id as usize].kind)
            && let Some(r) = exotic::delete(self, id, key)
        {
            return r;
        }
        let flags = self.heap[id as usize].flags;
        let index = self.atoms.index(key);
        let (name, length) = (self.names.name, self.names.length);
        let fixed = flags & (FROZEN | SEALED) != 0;
        let own_fn_key = self.own_name_or_length(flags, key);
        // Whether an own property is there that cannot be deleted; a missing one deletes fine.
        let o = &mut self.heap[id as usize];
        let refused = match &mut o.kind {
            Kind::Namespace(_) => return Err(self.invalid_data("Only data fields may be deleted.")),
            Kind::Array(_) if key == length => true,
            Kind::Array(items) | Kind::Arguments(items) if index.is_some() => {
                match items.get_mut(index.unwrap_or_default() as usize) {
                    Some(Value::Uninit) => false,
                    // A sparse array's far element is a property.
                    None => fixed && o.props.find(key).is_some(),
                    Some(_) if fixed => true,
                    Some(slot) => {
                        *slot = Value::Uninit;
                        return Ok(true);
                    }
                }
            }
            Kind::Closure(_) | Kind::Native { .. } if own_fn_key && o.props.find(key).is_none() => {
                if !fixed {
                    o.flags |= if key == name {
                        NAME_DELETED
                    } else {
                        LENGTH_DELETED
                    };
                    return Ok(true);
                }
                true
            }
            _ => o
                .props
                .find(key)
                .is_some_and(|i| fixed || o.props.items[i].flags & FIXED != 0),
        };
        if refused {
            let k = self.key_text(key);
            return Err(self.type_error(&format!("Cannot delete property '{k}'.")));
        }
        self.heap[id as usize].props.remove(key);
        Ok(true)
    }

    /// `delete` on a primitive deletes from its wrapper, whose only own properties are a string's indexes and
    /// length.
    fn delete_primitive(&mut self, v: &Value, key: Atom) -> Result<bool, Value> {
        let k = self.key_text(key);
        match v {
            Value::Undef | Value::Null | Value::Uninit => {
                let t = if let Value::Null = v {
                    "null"
                } else {
                    "undefined"
                };
                Err(self.nullish_read(t, &k))
            }
            Value::Str(s)
                if key == self.names.length
                    || self
                        .atoms
                        .index(key)
                        .is_some_and(|i| (i as usize) < self.atoms.sref(*s).len16()) =>
            {
                let mut quoted = String::new();
                crate::convert::quote(&mut quoted, self.text(*s));
                Err(self.type_error(&format!("Cannot delete property '{k}' of {quoted}.")))
            }
            Value::Sym(_) => {
                Err(self.type_error("Cannot access a property on a non-object value."))
            }
            _ => Ok(true),
        }
    }

    #[inline(never)]
    pub fn has_property(&mut self, o: &Value, k: &Value) -> Result<bool, Value> {
        // The reference's `in`: a data object on the right and no namespace on the left, else an opaque operand is
        // not data, else the right side is no object.
        if let Value::Obj(id) = o
            && !self.is_namespace(*id)
            && !matches!(k, Value::Obj(kid) if self.is_namespace(*kid))
        {
            let key = self.key_of(k)?;
            return Ok(self.has_key(*id, key));
        }
        if self.is_opaque_value(o) || self.is_opaque_value(k) {
            return Err(self.invalid_data("Binary operators require data values."));
        }
        Err(self.type_error("The 'in' operator requires a data object on the right-hand side."))
    }

    /// The reference's `isOpaque`: a function, a promise, a generator, an iterator or a namespace.
    fn is_opaque_value(&self, v: &Value) -> bool {
        matches!(v, Value::Obj(id) if {
            let o = &self.heap[*id as usize];
            o.is_callable() || crate::cross::opaque(&o.kind)
        })
    }

    pub fn has_key(&self, id: Id, key: Atom) -> bool {
        let mut cur = id;
        loop {
            let o = &self.heap[cur as usize];
            match &o.kind {
                Kind::Array(items) | Kind::Arguments(items) => {
                    if let Some(i) = self.atoms.index(key) {
                        if items
                            .get(i as usize)
                            .is_some_and(|v| !matches!(v, Value::Uninit))
                        {
                            return true;
                        }
                    } else if key == self.names.length && matches!(o.kind, Kind::Array(_)) {
                        return true;
                    }
                }
                Kind::Closure(_) | Kind::Native { .. } if self.own_name_or_length(o.flags, key) => {
                    return true;
                }
                k if exotic::is_exotic(k) && exotic::has_own(self, cur, key) => return true,
                _ => {}
            }
            if o.props.find(key).is_some() {
                return true;
            }
            match o.proto {
                Some(p) => cur = p,
                None => return false,
            }
        }
    }

    /// Whether a function still has its own `name` or `length` slot for `key`.
    fn own_name_or_length(&self, flags: u8, key: Atom) -> bool {
        (key == self.names.name && flags & NAME_DELETED == 0)
            || (key == self.names.length && flags & LENGTH_DELETED == 0)
    }

    pub fn has_own(&self, id: Id, key: Atom) -> bool {
        let o = &self.heap[id as usize];
        match &o.kind {
            Kind::Array(items) | Kind::Arguments(items) => {
                if let Some(i) = self.atoms.index(key) {
                    // A sparse array keeps far elements as properties.
                    if items
                        .get(i as usize)
                        .is_some_and(|v| !matches!(v, Value::Uninit))
                    {
                        return true;
                    }
                } else if key == self.names.length && matches!(o.kind, Kind::Array(_)) {
                    return true;
                }
            }
            Kind::Closure(_) | Kind::Native { .. } if self.own_name_or_length(o.flags, key) => {
                return true;
            }
            k if exotic::is_exotic(k) && exotic::has_own(self, id, key) => return true,
            _ => {}
        }
        o.props.find(key).is_some()
    }

    #[inline(never)]
    pub fn instance_of(&mut self, v: &Value, c: &Value) -> Result<bool, Value> {
        let Value::Obj(cid) = c else {
            return Err(self.type_error("The right-hand side of 'instanceof' is not callable."));
        };
        if !self.is_callable(c) || self.is_namespace(*cid) {
            return Err(self.type_error("The right-hand side of 'instanceof' is not callable."));
        }
        let pk = self.names.prototype;
        let Value::Obj(proto) = self.get_obj(*cid, pk) else {
            return Err(
                self.type_error("The right-hand side of 'instanceof' has no 'prototype' object.")
            );
        };
        // A namespace is no object, so it has no prototype chain.
        let Value::Obj(cur) = v else { return Ok(false) };
        if self.is_namespace(*cur) {
            return Ok(false);
        }
        let mut cur = *cur;
        while let Some(p) = self.heap[cur as usize].proto {
            if p == proto {
                return Ok(true);
            }
            cur = p;
        }
        Ok(false)
    }

    /// An array's length; a sparse array keeps it as an own property.
    #[inline]
    pub fn array_len(&self, id: Id) -> usize {
        let o = &self.heap[id as usize];
        match &o.kind {
            Kind::Array(_) if o.flags & SPARSE != 0 => match o.props.get(self.names.length) {
                Some(Value::Num(n)) => *n as usize,
                _ => 0,
            },
            Kind::Array(items) => items.len(),
            _ => 0,
        }
    }

    /// Writes element `i` of an array past its items: a far element is an own property, which makes the array
    /// sparse, and the length grows to cover it.
    #[cold]
    #[inline(never)]
    fn sparse_set(&mut self, id: Id, key: Atom, i: usize, val: Value) {
        let len = self.array_len(id);
        let lk = self.names.length;
        let o = &mut self.heap[id as usize];
        o.flags |= SPARSE;
        o.props.insert(key, val, DEFAULT_FLAGS);
        if i >= len {
            o.props.insert(lk, Value::Num((i + 1) as f64), 0);
        }
    }

    /// The indexes and values of a sparse array's elements past its items, in index order.
    pub fn sparse_tail(&self, id: Id) -> Vec<(usize, Value)> {
        let o = &self.heap[id as usize];
        let mut tail: Vec<(usize, Value)> = o
            .props
            .items
            .iter()
            .filter_map(|p| Some((self.atoms.index(p.key)? as usize, p.value)))
            .collect();
        tail.sort_unstable_by_key(|(i, _)| *i);
        tail
    }

    /// Makes a sparse array of length `n` (at most `MAX_ARRAY_LEN`) dense again, dropping elements at `n` and past.
    #[cold]
    #[inline(never)]
    pub(crate) fn unsparse(&mut self, id: Id, n: usize) {
        let tail = self.sparse_tail(id);
        let lk = self.names.length;
        let o = &mut self.heap[id as usize];
        let keys: Vec<Atom> = o
            .props
            .items
            .iter()
            .filter(|p| p.key == lk || self.atoms.index(p.key).is_some())
            .map(|p| p.key)
            .collect();
        for k in keys {
            o.props.remove(k);
        }
        o.flags &= !SPARSE;
        if let Kind::Array(items) = &mut o.kind {
            items.resize(n, Value::Uninit);
            for (i, v) in tail {
                if i < n {
                    items[i] = v;
                }
            }
        }
    }

    /// Makes an array dense for code that walks its items, which fails when it is longer than an array may be.
    #[inline]
    pub fn densify(&mut self, id: Id) -> Result<(), Value> {
        if self.heap[id as usize].flags & SPARSE == 0 {
            return Ok(());
        }
        self.densify_sparse(id)
    }

    #[cold]
    #[inline(never)]
    fn densify_sparse(&mut self, id: Id) -> Result<(), Value> {
        let n = self.array_len(id);
        if n > MAX_ARRAY_LEN {
            return Err(self.range_error("Invalid array length."));
        }
        self.unsparse(id, n);
        Ok(())
    }

    /// Own enumerable string keys in JavaScript order: integer keys ascending, then insertion order.
    pub fn own_keys(&mut self, id: Id) -> Vec<Atom> {
        if self.is_namespace(id) {
            return self.namespace_names(id).unwrap_or_default();
        }
        let mut out = Vec::new();
        match &self.heap[id as usize].kind {
            Kind::Array(items) | Kind::Arguments(items) => {
                for (i, v) in items.iter().enumerate() {
                    if !matches!(v, Value::Uninit) {
                        out.push(self.atoms.intern(&i.to_string()));
                    }
                }
            }
            k if exotic::is_exotic(k) => {
                for i in 0..exotic::index_len(self, id) {
                    out.push(self.atoms.intern(&i.to_string()));
                }
            }
            _ => {}
        }
        let props = &self.heap[id as usize].props;
        let mut ints = Vec::new();
        let mut strs = Vec::new();
        for p in &props.items {
            if p.flags & ENUMERABLE == 0 || p.key <= SYM_ASYNC_ITERATOR {
                continue;
            }
            match self.atoms.index(p.key) {
                Some(i) => ints.push((i, p.key)),
                None => strs.push(p.key),
            }
        }
        if !ints.is_empty() {
            ints.sort_unstable_by_key(|(i, _)| *i);
            out.extend(ints.into_iter().map(|(_, k)| k));
        }
        out.extend(strs);
        out
    }

    /// Own enumerable entries of an object in key order.
    pub fn own_entries(&mut self, id: Id) -> Vec<(Atom, Value)> {
        if let Kind::Ordinary | Kind::Error(_) = self.heap[id as usize].kind {
            let props = &self.heap[id as usize].props;
            let simple = props
                .items
                .iter()
                .all(|p| self.atoms.index(p.key).is_none());
            if simple {
                return props
                    .items
                    .iter()
                    .filter(|p| p.flags & ENUMERABLE != 0 && p.key > SYM_ASYNC_ITERATOR)
                    .map(|p| (p.key, p.value))
                    .collect();
            }
        }
        let keys = self.own_keys(id);
        keys.into_iter().map(|k| (k, self.get_obj(id, k))).collect()
    }

    /// Own enumerable properties keyed by the two confined symbols, which spread and `Object.assign` copy too.
    pub fn own_symbol_entries(&self, id: Id) -> Vec<(Atom, Value)> {
        self.heap[id as usize]
            .props
            .items
            .iter()
            .filter(|p| p.key <= SYM_ASYNC_ITERATOR && p.flags & ENUMERABLE != 0)
            .map(|p| (p.key, p.value))
            .collect()
    }

    /// A namespace path read with a number or a symbol, which the reference refuses.
    #[cold]
    pub(crate) fn namespace_key_error(&mut self, id: Id) -> Value {
        let message = format!(
            "{} paths must use string property names.",
            self.namespace_root(id)
        );
        let e = self.type_error(&message);
        self.at_site(e, Site::Key)
    }

    /// Reading `key` of a nullish base, which the reference reports at the member's object.
    #[cold]
    fn nullish_read(&mut self, t: &str, k: &str) -> Value {
        let e = self.type_error(&format!("Cannot read properties of {t} (reading '{k}')."));
        self.at_site(e, Site::Object)
    }

    /// A member of a promise it doesn't have, read or written: a missing await, reported at the member's object.
    #[cold]
    fn unawaited(&mut self) -> Value {
        let e = self.invalid_data(UNAWAITED);
        self.at_site(e, Site::Object)
    }

    /// The reference's `enumerableSource`: the value whose own enumerable properties `label` (`Object.keys(...)`,
    /// `for...in`, `Object spread`, ...) reads. Null and undefined have none to read, and a promise or a namespace
    /// is not data; anything else reads as its own properties (a primitive as an empty object, a string as its
    /// characters).
    #[inline(never)]
    pub(crate) fn enumerable_source(&mut self, label: &str, v: &Value) -> Result<(), Value> {
        match v {
            Value::Null => {
                Err(self.type_error(&format!("{label} cannot convert null to an object.")))
            }
            Value::Undef | Value::Uninit => {
                Err(self.type_error(&format!("{label} cannot convert undefined to an object.")))
            }
            Value::Obj(id) if self.is_promise(*id) => Err(self.invalid_data(&format!(
                "{label} received an un-awaited Promise; await it before inspecting the result."
            ))),
            Value::Obj(id) if self.is_namespace(*id) => {
                let root = self.namespace_root(*id);
                Err(self.invalid_data(&format!(
                    "{label} cannot read {root}: it is a namespace of host functions, not plain data. Use \
                     Object.keys({root}) for its names."
                )))
            }
            _ => Ok(()),
        }
    }

    /// An object spread of `v` into `target`: null and undefined spread nothing.
    #[inline(never)]
    pub(crate) fn spread_props(&mut self, target: Id, v: &Value) -> Result<(), Value> {
        if !v.is_nullish() {
            self.enumerable_source("Object spread", v)?;
        }
        self.copy_props(target, v, &[])
    }

    /// An object rest pattern's properties of `v`, but `excluded`, copied into `target`.
    #[inline(never)]
    pub(crate) fn rest_props(
        &mut self,
        target: Id,
        v: &Value,
        excluded: &[Atom],
    ) -> Result<(), Value> {
        self.enumerable_source("Object destructuring", v)?;
        self.copy_props(target, v, excluded)
    }

    /// A `for...in` source: a namespace lists its names, and null and undefined iterate nothing.
    #[inline(never)]
    pub(crate) fn for_in_source(&mut self, v: &Value) -> Result<(), Value> {
        match v {
            Value::Obj(id) if self.is_namespace(*id) => Ok(()),
            v if v.is_nullish() => Ok(()),
            v => self.enumerable_source("for...in", v),
        }
    }

    /// The names under a namespace path, for `Object.keys` and `for...in`, or what listing them threw.
    pub(crate) fn namespace_names(&mut self, id: Id) -> Result<Vec<Atom>, Value> {
        if !self.is_namespace(id) {
            return Ok(Vec::new());
        }
        let names = crate::host::namespace_keys(self, id)?;
        Ok(names
            .iter()
            .map(|c| self.atoms.intern(&c.to_run_text()))
            .collect())
    }

    /// The global a namespace path is under, which names it in messages.
    pub(crate) fn namespace_root(&self, id: Id) -> String {
        let root = self.ns_path(id).root;
        self.atoms.text(root).to_owned()
    }

    #[inline(never)]
    pub fn copy_props(&mut self, target: Id, src: &Value, excluded: &[Atom]) -> Result<(), Value> {
        match src {
            Value::Obj(id) => {
                if let Kind::Map(_) | Kind::Set(_) | Kind::Closure(_) | Kind::Native { .. } =
                    self.heap[*id as usize].kind
                    && self.heap[*id as usize].props.len() == 0
                {
                    return Ok(());
                }
                let mut entries = self.own_entries(*id);
                entries.extend(self.own_symbol_entries(*id));
                for (k, v) in entries {
                    if !excluded.contains(&k) {
                        self.define(target, k, v);
                    }
                }
            }
            Value::Str(s) => {
                let units = self.atoms.sref(*s).utf16();
                for (i, c) in units.iter().enumerate() {
                    let k = self.atoms.intern(&i.to_string());
                    if !excluded.contains(&k) {
                        let v = self.char_str(*c);
                        self.define(target, k, v);
                    }
                }
            }
            _ => {}
        }
        Ok(())
    }

    #[inline(never)]
    pub fn for_in_keys(&mut self, v: &Value) -> Vec<Value> {
        match v {
            Value::Obj(id) => {
                let mut seen: Vec<Atom> = self.own_keys(*id);
                let mut cur = self.heap[*id as usize].proto;
                while let Some(p) = cur {
                    for k in self.own_keys(p) {
                        if !seen.contains(&k) {
                            seen.push(k);
                        }
                    }
                    cur = self.heap[p as usize].proto;
                }
                seen.into_iter()
                    .map(|k| Value::Str(self.atoms.atom_str(k)))
                    .collect()
            }
            Value::Str(s) => {
                let n = self.atoms.sref(*s).len16();
                (0..n).map(|i| self.string_val(i.to_string())).collect()
            }
            _ => Vec::new(),
        }
    }

    // ---------- conversions ----------

    pub fn truthy(&self, v: &Value) -> bool {
        match v {
            Value::Bool(b) => *b,
            Value::Num(n) => *n != 0.0 && !n.is_nan(),
            Value::Str(s) => !self.atoms.get(*s).is_empty(),
            Value::Obj(_) | Value::Sym(_) => true,
            Value::Undef | Value::Null | Value::Uninit => false,
        }
    }

    pub fn is_callable(&self, v: &Value) -> bool {
        match v {
            Value::Obj(id) => self.heap[*id as usize].is_callable(),
            _ => false,
        }
    }

    pub fn type_of(&self, v: &Value) -> &'static str {
        match v {
            Value::Undef | Value::Uninit => "undefined",
            Value::Null => "object",
            Value::Bool(_) => "boolean",
            Value::Num(_) => "number",
            Value::Str(_) => "string",
            Value::Sym(_) => "symbol",
            Value::Obj(_) => {
                if self.is_callable(v) {
                    "function"
                } else {
                    "object"
                }
            }
        }
    }

    /// A value's string for a message, made inline with a failure ignored: never a restartable conversion, whose
    /// request an ignored failure would leave behind (see `conversion.rs`).
    pub(crate) fn quiet_string(&mut self, v: &Value) -> String {
        let ok = std::mem::replace(&mut self.convert_ok, false);
        let s = self
            .string_of(v)
            .map(|s| self.text(s).to_owned())
            .unwrap_or_default();
        self.convert_ok = ok;
        s
    }

    #[inline(never)]
    pub fn number_of(&mut self, v: &Value) -> Result<f64, Value> {
        Ok(match v {
            Value::Num(n) => *n,
            Value::Str(s) => str_to_num(self.atoms.get(*s)),
            Value::Bool(b) => *b as u8 as f64,
            Value::Null => 0.0,
            Value::Undef | Value::Uninit => f64::NAN,
            Value::Sym(_) => {
                return Err(self.type_error("Cannot convert a symbol to a number"));
            }
            Value::Obj(id) => {
                // A namespace is not an object to the reference: it converts without a call, as "[object Object]".
                if self.is_namespace(*id) || self.is_promise(*id) {
                    return Ok(f64::NAN);
                }
                let p = self.primitive_of(v, Hint::Number)?;
                return self.number_of(&p);
            }
        })
    }

    #[inline(never)]
    pub fn string_of(&mut self, v: &Value) -> Result<StrId, Value> {
        Ok(match v {
            Value::Str(s) => *s,
            Value::Num(n) => {
                if *n >= 0.0 && *n < 10.0 && n.fract() == 0.0 {
                    return Ok(self.char_strs[b'0' as usize + *n as usize]);
                }
                if self.atoms.bufs.len() >= crate::vm::MAX_STRINGS {
                    self.out_of_memory();
                }
                self.atoms.alloc_num(*n)
            }
            Value::Bool(b) => return Ok(self.static_id(if *b { "true" } else { "false" })),
            Value::Null => return Ok(self.static_id("null")),
            Value::Undef | Value::Uninit => return Ok(self.static_id("undefined")),
            // The reference's ToString of a symbol is its host's `String`, which names it.
            Value::Sym(s) => return Ok(self.static_id(symbol_text(*s))),
            Value::Obj(id) => {
                if self.is_namespace(*id) {
                    return Ok(self.static_id("[object Object]"));
                }
                // A promise converts without consulting its methods (`$vmToPrimitive` keeps it).
                if self.is_promise(*id) {
                    return Ok(self.static_id("[object Promise]"));
                }
                let p = self.primitive_of(v, Hint::String)?;
                return self.string_of(&p);
            }
        })
    }

    pub fn map_key(&mut self, v: &Value) -> MapKey {
        match v {
            Value::Undef | Value::Uninit => MapKey::Undef,
            Value::Null => MapKey::Null,
            Value::Bool(b) => MapKey::Bool(*b),
            Value::Num(n) => {
                let n = if *n == 0.0 { 0.0 } else { *n };
                MapKey::Num(if n.is_nan() {
                    f64::NAN.to_bits()
                } else {
                    n.to_bits()
                })
            }
            Value::Str(s) => MapKey::Str(self.atoms.intern_id(*s)),
            Value::Obj(id) => MapKey::Obj(*id),
            Value::Sym(s) => MapKey::Sym(*s),
        }
    }

    pub fn static_id(&mut self, s: &str) -> StrId {
        let a = self.atoms.intern(s);
        self.atoms.atom_str(a)
    }

    /// ToPrimitive. The reference runs it in its internal bytecode (`$vmToPrimitive`), entered for one unit, and
    /// calls `toString` and `valueOf` as bytecode calls them (see `builtins/fuel.rs`).
    pub fn primitive_of(&mut self, v: &Value, hint: Hint) -> Res {
        let Value::Obj(id) = v else {
            return Ok(*v);
        };
        // A namespace is not an object to the reference's `$vmToPrimitive`: it stays as it is, for nothing.
        if self.is_namespace(*id) {
            return Ok(*v);
        }
        if self.convert_ok
            && let Some(r) = self.restartable_conversion(v, hint)
        {
            return r;
        }
        self.fuel(1);
        // `$vmToPrimitive` keeps a promise, so that what reads it rejects it as an un-awaited value.
        if self.is_promise(*id) {
            return Ok(*v);
        }
        let hint = if hint == Hint::Default && exotic::prefers_string(self, *id) {
            Hint::String
        } else {
            hint
        };
        let order = if hint == Hint::String {
            [self.names.to_string, self.names.value_of]
        } else {
            [self.names.value_of, self.names.to_string]
        };
        for name in order {
            let f = self.get_obj(*id, name);
            if self.is_callable(&f) {
                let r = self.call_counted(&f, *v, &[])?;
                if !matches!(r, Value::Obj(_)) {
                    return Ok(r);
                }
            }
        }
        Err(self.type_error("Cannot convert object to primitive value."))
    }

    /// An operand of a binary operator that converts its operands: once either is an object, the reference's
    /// `$vmBinary` runs ToPrimitive on both, so a primitive costs its call too.
    #[inline]
    pub fn op_primitive(&mut self, v: &Value, other: &Value, hint: Hint) -> Res {
        if !matches!(v, Value::Obj(_)) && matches!(other, Value::Obj(_)) {
            self.fuel(1);
        }
        self.primitive_of(v, hint)
    }

    /// `op_primitive` as a number.
    #[inline(never)]
    pub fn op_number(&mut self, v: &Value, other: &Value) -> Result<f64, Value> {
        let p = self.op_primitive(v, other, Hint::Number)?;
        self.number_of(&p)
    }

    /// `Strings::concat_num`, counted against the strings a run may make.
    #[inline]
    fn concat_num(&mut self, s: StrId, n: f64, num_first: bool) -> Option<Value> {
        if self.atoms.bufs.len() >= crate::vm::MAX_STRINGS {
            return None;
        }
        self.atoms.concat_num(s, n, num_first).map(Value::Str)
    }

    fn concat(&mut self, x: &str, y: &str) -> Res {
        if x.len() + y.len() > MAX_STRING_LEN {
            return Err(self.range_error("Invalid string length"));
        }
        let mut s = String::with_capacity(x.len() + y.len());
        s.push_str(x);
        s.push_str(y);
        Ok(self.string_val(s))
    }

    fn concat_ids(&mut self, x: StrId, y: StrId) -> Res {
        if self.atoms.get(x).len() + self.atoms.get(y).len() > MAX_STRING_LEN {
            return Err(self.range_error("Invalid string length"));
        }
        Ok(self.concat_strs(&[x, y]))
    }

    #[inline(never)]
    pub fn add(&mut self, a: Value, b: Value) -> Res {
        match (&a, &b) {
            (Value::Num(x), Value::Num(y)) => return Ok(Value::Num(x + y)),
            (Value::Str(x), Value::Str(y)) => return self.concat_ids(*x, *y),
            (Value::Str(x), Value::Num(y)) => {
                if let Some(s) = self.concat_num(*x, *y, false) {
                    return Ok(s);
                }
                let y = self.string_of(&Value::Num(*y))?;
                return self.concat_ids(*x, y);
            }
            (Value::Num(x), Value::Str(y)) => {
                if let Some(s) = self.concat_num(*y, *x, true) {
                    return Ok(s);
                }
                let x = num_to_string(*x);
                let y = self.atoms.get(*y).to_owned();
                return self.concat(&x, &y);
            }
            _ => {}
        }
        self.data_operands(&a, &b)?;
        let pa = self.op_primitive(&a, &b, Hint::Default)?;
        let pb = self.op_primitive(&b, &a, Hint::Default)?;
        if matches!(pa, Value::Str(_)) || matches!(pb, Value::Str(_)) {
            // The host's `+`, unlike its `String`, refuses to make a symbol text.
            if matches!(pa, Value::Sym(_)) || matches!(pb, Value::Sym(_)) {
                return Err(self.type_error("Cannot convert a symbol to a string"));
            }
            let x = self.string_of(&pa)?;
            let y = self.string_of(&pb)?;
            return self.concat_ids(x, y);
        }
        Ok(Value::Num(self.number_of(&pa)? + self.number_of(&pb)?))
    }

    /// The generic form of an operator fused with an immediate operand.
    #[inline(never)]
    pub fn arith(&mut self, op: crate::bytecode::Arith, a: Value, b: Value) -> Res {
        use crate::bytecode::Arith as A;
        if !matches!(op, A::Add | A::StrictEq | A::StrictNe) {
            self.data_operands(&a, &b)?;
        }
        Ok(match op {
            A::Add => return self.add(a, b),
            A::Sub | A::Mul | A::Div | A::Mod => {
                let x = self.op_number(&a, &b)?;
                let y = self.op_number(&b, &a)?;
                Value::Num(match op {
                    A::Sub => x - y,
                    A::Mul => x * y,
                    A::Div => x / y,
                    _ => crate::vm::js_rem(x, y),
                })
            }
            A::Lt => Value::Bool(self.less_than(&a, &b, true)?.unwrap_or(false)),
            A::Gt => Value::Bool(self.less_than(&b, &a, false)?.unwrap_or(false)),
            A::Le => Value::Bool(self.less_than(&b, &a, false)?.is_some_and(|v| !v)),
            A::Ge => Value::Bool(self.less_than(&a, &b, true)?.is_some_and(|v| !v)),
            A::StrictEq => Value::Bool(self.strict_eq(&a, &b)),
            A::StrictNe => Value::Bool(!self.strict_eq(&a, &b)),
        })
    }

    /// IsLessThan: `None` when either side is NaN.
    #[inline(never)]
    pub fn less_than(
        &mut self,
        a: &Value,
        b: &Value,
        left_first: bool,
    ) -> Result<Option<bool>, Value> {
        let (pa, pb) = if left_first {
            let pa = self.op_primitive(a, b, Hint::Number)?;
            (pa, self.op_primitive(b, a, Hint::Number)?)
        } else {
            let pb = self.op_primitive(b, a, Hint::Number)?;
            (self.op_primitive(a, b, Hint::Number)?, pb)
        };
        if let (Value::Str(x), Value::Str(y)) = (&pa, &pb) {
            return Ok(Some(self.atoms.sref(*x).cmp16(self.atoms.sref(*y)).is_lt()));
        }
        let x = self.number_of(&pa)?;
        let y = self.number_of(&pb)?;
        if x.is_nan() || y.is_nan() {
            return Ok(None);
        }
        Ok(Some(x < y))
    }

    #[inline(never)]
    pub fn loose_eq(&mut self, a: &Value, b: &Value) -> Result<bool, Value> {
        Ok(match (a, b) {
            (Value::Undef | Value::Null, Value::Undef | Value::Null) => true,
            (Value::Undef | Value::Null, _) | (_, Value::Undef | Value::Null) => false,
            (Value::Num(x), Value::Str(s)) | (Value::Str(s), Value::Num(x)) => {
                *x == str_to_num(self.atoms.get(*s))
            }
            (Value::Str(x), Value::Str(y)) => self.atoms.get(*x) == self.atoms.get(*y),
            (Value::Bool(x), _) => {
                let n = Value::Num(*x as u8 as f64);
                return self.loose_eq(&n, b);
            }
            (_, Value::Bool(y)) => {
                let n = Value::Num(*y as u8 as f64);
                return self.loose_eq(a, &n);
            }
            (Value::Obj(_), Value::Num(_) | Value::Str(_) | Value::Sym(_)) => {
                let p = self.primitive_of(a, Hint::Default)?;
                self.fuel(1);
                if let Value::Obj(_) = p {
                    return Ok(false);
                }
                return self.loose_eq(&p, b);
            }
            (Value::Num(_) | Value::Str(_) | Value::Sym(_), Value::Obj(_)) => {
                self.fuel(1);
                let p = self.primitive_of(b, Hint::Default)?;
                if let Value::Obj(_) = p {
                    return Ok(false);
                }
                return self.loose_eq(a, &p);
            }
            _ => self.strict_eq(a, b),
        })
    }

    #[cfg(feature = "test262")]
    pub fn error_text(&mut self, e: &Value) -> String {
        if let Value::Obj(id) = e
            && let Kind::Error(_) = self.heap[*id as usize].kind
        {
            let m = self.names.message;
            if let Value::Str(s) = self.get_obj(*id, m) {
                return self.text(s).to_owned();
            }
        }
        crate::convert::format_value(self, e)
    }

    // ---------- iteration ----------

    #[inline(never)]
    pub fn iterate_to_vec(&mut self, v: &Value) -> Result<Vec<Value>, Value> {
        if let Value::Obj(id) = v {
            match &self.heap[*id as usize].kind {
                Kind::Array(_) if self.heap[*id as usize].flags & SPARSE != 0 => {
                    if self.array_len(*id) > MAX_ARRAY_LEN {
                        return Err(self.range_error("Invalid array length"));
                    }
                    self.densify(*id)?;
                    return self.iterate_to_vec(v);
                }
                Kind::Array(items) => return Ok(without_holes(items)),
                Kind::Set(m) => {
                    return Ok(m.entries.iter().flatten().map(|(k, _)| *k).collect());
                }
                Kind::Generator(GenState::Suspended(_)) => return self.collect_generator(*id),
                _ => {}
            }
        }
        if let Value::Str(s) = v {
            let text = self.atoms.get(*s).to_owned();
            let mut out = Vec::new();
            let mut at = 0;
            while let Some(cp) = crate::strings::code_point_at(&text, at) {
                at += cp.len();
                out.push(match cp.as_bytes() {
                    [b] if *b < 128 => Value::Str(self.char_strs[*b as usize]),
                    _ => self.str_val(cp),
                });
            }
            return Ok(out);
        }
        let it = self.get_iterator(v)?;
        let next = self.record_next_of(v, &it)?;
        let mut out = Vec::new();
        while let Some(x) = self.iter_step_with(&it, next)? {
            if out.len() >= MAX_ARRAY_LEN {
                return Err(self.range_error("Invalid array length"));
            }
            out.push(x);
        }
        Ok(out)
    }

    /// Calls an iterator method that is present, which must be a function returning an object with a `next`
    /// method.
    fn open_with(&mut self, f: &Value, v: &Value) -> Res {
        if !self.is_callable(f) {
            return Err(self.type_error("Iterator method must be a function."));
        }
        let it = self.call(f, *v, &[])?;
        let Value::Obj(id) = it else {
            return Err(self.type_error("Iterator method result must be an object."));
        };
        let nk = self.names.next;
        let next = self.get_obj(id, nk);
        if !self.is_callable(&next) {
            return Err(self.type_error("Iterator next must be a function."));
        }
        Ok(it)
    }

    /// GetIterator, with the error for a value that is not iterable worded for where it is iterated.
    pub fn get_iterator_in(&mut self, v: &Value, ctx: u8) -> Res {
        if !self.is_iterable(v) {
            return Err(self.not_iterable(v, ctx));
        }
        self.get_iterator(v)
    }

    /// Whether `v` has a sync iterator to get.
    pub fn is_iterable(&mut self, v: &Value) -> bool {
        match v {
            Value::Str(_) => true,
            Value::Obj(id) => match &self.heap[*id as usize].kind {
                Kind::Array(_)
                | Kind::Arguments(_)
                | Kind::Map(_)
                | Kind::Set(_)
                | Kind::Generator(_)
                | Kind::ArrayIter { .. }
                | Kind::MapIter { .. }
                | Kind::StrIter { .. }
                | Kind::ListIter { .. } => true,
                _ => !self.get_obj(*id, SYM_ITERATOR).is_nullish(),
            },
            _ => false,
        }
    }

    /// How the reference names a value in a data error: `a data object`, `a function`, `null`, `a Date`.
    pub fn describe_data(&self, v: &Value) -> String {
        crate::builtins::describe_value(self, v)
    }

    pub fn not_iterable(&mut self, v: &Value, ctx: u8) -> Value {
        use crate::bytecode::{ITER_DELEGATE, ITER_DESTRUCTURE, ITER_FOR_AWAIT, ITER_SPREAD};
        match ctx {
            ITER_DESTRUCTURE => {
                self.type_error("Array destructuring requires a supported iterable value.")
            }
            ITER_DELEGATE => self.type_error("yield* requires a compatible iterable value."),
            ITER_SPREAD => self.type_error("Spread requires a synchronous iterable."),
            _ => {
                let what = if ctx == ITER_FOR_AWAIT {
                    "for await...of"
                } else {
                    "for...of"
                };
                let d = self.describe_data(v);
                self.invalid_data(&format!("{what} requires an iterable value, received {d}."))
            }
        }
    }

    #[inline(never)]
    pub fn get_iterator(&mut self, v: &Value) -> Res {
        let proto = self.realm.iter_proto;
        match v {
            Value::Obj(id) => {
                if let Kind::Arguments(_) = self.heap[*id as usize].kind {
                    // Like the reference: the values of its enumerable own keys when iteration starts.
                    let items: std::sync::Arc<[Value]> =
                        self.own_entries(*id).into_iter().map(|(_, v)| v).collect();
                    let it = Kind::ListIter { items, pos: 0 };
                    return Ok(Value::Obj(self.alloc(Obj::new(Some(proto), it))));
                }
                let kind = match &self.heap[*id as usize].kind {
                    Kind::Array(_) => Some(Kind::ArrayIter {
                        target: *id,
                        pos: 0,
                        kind: IterKind::Values,
                    }),
                    Kind::Map(_) => Some(Kind::MapIter {
                        target: *id,
                        pos: 0,
                        kind: IterKind::Entries,
                    }),
                    Kind::Set(_) => Some(Kind::MapIter {
                        target: *id,
                        pos: 0,
                        kind: IterKind::Values,
                    }),
                    Kind::Generator(_)
                    | Kind::ArrayIter { .. }
                    | Kind::MapIter { .. }
                    | Kind::StrIter { .. }
                    | Kind::ListIter { .. } => return Ok(*v),
                    _ => None,
                };
                if let Some(k) = kind {
                    return Ok(Value::Obj(self.alloc(Obj::new(Some(proto), k))));
                }
                let f = self.get_obj(*id, SYM_ITERATOR);
                if !f.is_nullish() {
                    return self.open_with(&f, v);
                }
            }
            Value::Str(s) => {
                return Ok(Value::Obj(
                    self.alloc(Obj::new(Some(proto), Kind::StrIter { s: *s, pos: 0 })),
                ));
            }
            _ => {}
        }
        // Where the reference iterates in its prelude, a value with no iterator fails its `for...of`.
        Err(self.not_iterable(v, crate::bytecode::ITER_FOR_OF))
    }

    /// A `yield*` step on an iterator the VM runs itself, as a value and a done flag: `Ok(None)` for any other
    /// iterator, `Ok(Some(None))` when it lacks the `throw` or `return` method asked for. A suspended generator is
    /// resumed in a frame (`Vm::resume_delegate_by_frame`), which hands its answer to the instruction itself: the
    /// caller sees `Vm::entered`.
    #[inline(never)]
    pub fn sync_delegate_step(
        &mut self,
        it: Value,
        kind: u8,
        received: Value,
    ) -> Result<Option<Option<(Value, bool)>>, Value> {
        let Value::Obj(id) = it else { return Ok(None) };
        match &self.heap[id as usize].kind {
            Kind::Generator(state) => {
                let mode = match kind {
                    REQ_NEXT => 0,
                    REQ_RETURN => 1,
                    _ => 2,
                };
                // The reference's `throw` or `return` here is the generator's native method, which costs fifty
                // unless it throws before the body runs (a running generator, or a finished one asked to throw).
                // `next` was charged by the caller.
                let charged = kind != REQ_NEXT;
                if matches!(state, GenState::Suspended(_)) {
                    if charged {
                        self.fuel(NATIVE_FUEL);
                    }
                    self.resume_delegate_by_frame(id, mode, received)?;
                    return Ok(Some(Some((Value::Undef, false))));
                }
                let step = self.resume_generator(id, mode, received)?;
                if charged {
                    self.fuel(NATIVE_FUEL);
                }
                Ok(Some(Some(step)))
            }
            Kind::ArrayIter { .. }
            | Kind::MapIter { .. }
            | Kind::StrIter { .. }
            | Kind::ListIter { .. }
            | Kind::ExoticIter { .. } => {
                if kind != REQ_NEXT {
                    return Ok(Some(None));
                }
                Ok(Some(Some(match self.iter_step(&it)? {
                    Some(v) => (v, false),
                    None => (Value::Undef, true),
                })))
            }
            _ => Ok(None),
        }
    }

    /// Calls an iterator's `next`, `throw` or `return` for `yield*` or `for await`, returning its result; `None` when
    /// `throw` or `return` is missing. A method of the program's is called by a frame, which pushes the result for
    /// the instruction itself: the caller sees `Vm::entered`.
    #[inline(never)]
    pub fn delegate_call(
        &mut self,
        it: Value,
        kind: u8,
        arg: Option<Value>,
        cached_next: Value,
    ) -> Result<Option<Value>, Value> {
        if let Value::Obj(id) = it
            && let Kind::AsyncFromSync { sync, next } = self.heap[id as usize].kind
        {
            // The adapter's `throw` and `return` are natives, each called for fifty (`next` was charged by the caller).
            if kind != REQ_NEXT {
                self.fuel(NATIVE_FUEL);
            }
            return self.async_from_sync_call(sync, next, kind, arg).map(Some);
        }
        let m = if kind == REQ_NEXT && !cached_next.is_nullish() {
            cached_next
        } else {
            let name = self.request_name(kind);
            self.get(&it, name)?
        };
        if kind != REQ_NEXT && m.is_nullish() {
            return Ok(None);
        }
        if kind != REQ_NEXT && !self.is_callable(&m) {
            let name = self.request_name(kind);
            let name = self.atoms.text(name).to_owned();
            return Err(self.type_error(&format!("Iterator {name} must be a function.")));
        }
        if self.calls_program(&m) {
            self.delegate_by_call(m, it, arg)?;
            return Ok(Some(Value::Undef));
        }
        // A native `throw` or `return` costs fifty, before an async generator's body it resumes runs.
        if kind != REQ_NEXT {
            self.fuel(NATIVE_FUEL);
        }
        let args: &[Value] = match &arg {
            Some(a) => std::slice::from_ref(a),
            None => &[],
        };
        self.call(&m, it, args).map(Some)
    }

    /// Whether a call of `f` as bytecode makes it runs a closure (through any bound functions), which costs one
    /// unit rather than a native's fifty.
    #[inline]
    pub(crate) fn calls_closure(&self, f: &Value) -> bool {
        let mut f = *f;
        while let Value::Obj(id) = f {
            match &self.heap[id as usize].kind {
                Kind::Closure(_) => return true,
                Kind::Bound(b) => f = b.0,
                _ => return false,
            }
        }
        false
    }

    fn request_name(&mut self, kind: u8) -> Atom {
        match kind {
            REQ_NEXT => self.names.next,
            REQ_RETURN => self.names.return_,
            _ => self.atoms.intern_static("throw"),
        }
    }

    /// The `value` and `done` of the result of an iterator's `next`, `throw` or `return` (`REQ_*`), which must be
    /// an object.
    pub fn iter_result_parts(&mut self, r: &Value, kind: u8) -> Result<(Value, bool), Value> {
        let Value::Obj(rid) = r else {
            let name = self.request_name(kind);
            let name = self.atoms.text(name).to_owned();
            return Err(self.type_error(&format!("Iterator {name}() result must be an object.")));
        };
        let (dk, vk) = (self.names.done, self.names.value);
        let d = self.get_obj(*rid, dk);
        let done = self.truthy(&d);
        Ok((self.get_obj(*rid, vk), done))
    }

    /// GetIterator for `for await` (`ITER_FOR_AWAIT`) or an async generator's `yield*` (`ITER_DELEGATE`), with the
    /// async hint: `[Symbol.asyncIterator]()`, or the sync iterator adapted. A method of the program's is called by a
    /// frame, which writes the instruction's iterator record in `slot` itself: the caller sees `Vm::entered`.
    #[inline(never)]
    pub fn get_async_iterator(&mut self, v: &Value, ctx: u8, slot: u32) -> Res {
        if let Value::Obj(id) = v {
            let f = self.get_obj(*id, SYM_ASYNC_ITERATOR);
            if !f.is_nullish() {
                if self.calls_program(&f) {
                    return self.open_async_by_call(f, *v, slot, None);
                }
                // The reference calls the method as bytecode calls it.
                let it = self.open_with(&f, v)?;
                if !self.is_closure(&f) {
                    self.fuel(NATIVE_FUEL);
                }
                return Ok(it);
            }
        }
        // Anything but a value the reference walks itself it opens in its internal bytecode
        // (`$vmOpenSyncForAsync`), entered for one unit, which calls the `Symbol.iterator` method.
        let open = self.open_fuel(v, ITER_FOR_OF);
        if !self.walks(v) && self.is_iterable(v) {
            self.fuel(1);
        }
        if self.is_iterable(v)
            && let Some(method) = self.program_iterator_method(v)
            && self.calls_program(&method)
        {
            return self.open_async_by_call(method, *v, slot, Some(open));
        }
        let Value::Obj(sync) = self.get_iterator_in(v, ctx)? else {
            return Err(self.type_error("Iterator method result must be an object."));
        };
        self.fuel(open);
        let next = self.record_next_of(v, &Value::Obj(sync))?;
        let proto = self.realm.async_from_sync_proto;
        Ok(Value::Obj(self.alloc(Obj::new(
            Some(proto),
            Kind::AsyncFromSync { sync, next },
        ))))
    }

    /// The promise of an async-from-sync iterator's `next`, `throw` or `return`. A step that calls the program or
    /// resumes a generator is taken by a frame (`Vm::adapt_by_frame`), which hands the promise to the instruction
    /// itself: the caller sees `Vm::entered`.
    fn async_from_sync_call(&mut self, sync: Id, next: Value, kind: u8, arg: Option<Value>) -> Res {
        let made = self.new_promise();
        let sv = Value::Obj(sync);
        let step = match kind {
            REQ_NEXT => self.sync_step(made, sync, arg, next),
            _ => {
                let name = self.request_name(kind);
                let m = self.get_obj(sync, name);
                if m.is_nullish() {
                    if kind == REQ_RETURN {
                        let r = self.iter_result(arg.unwrap_or_default(), true);
                        self.resolve_promise(made, r);
                        return Ok(Value::Obj(made));
                    }
                    let rk = self.names.return_;
                    let generator = matches!(
                        self.heap[sync as usize].kind,
                        Kind::Generator(GenState::Suspended(_))
                    );
                    let ret = match self.heap[sync as usize].kind {
                        // A suspended generator closes through its own `return`, from a frame, for nothing.
                        Kind::Generator(GenState::Suspended(_)) => self.get_obj(sync, rk),
                        Kind::Generator(_)
                        | Kind::ArrayIter { .. }
                        | Kind::MapIter { .. }
                        | Kind::StrIter { .. }
                        | Kind::ListIter { .. } => Value::Undef,
                        _ => self.get_obj(sync, rk),
                    };
                    let closed = if generator || self.calls_program(&ret) {
                        match self.adapt_by_frame(BY_CLOSE, made, sync, kind, None, ret) {
                            Ok(_) => return Ok(Value::Undef),
                            Err(e) => Err(e),
                        }
                    } else {
                        self.iter_close(&sv)
                    };
                    let e = match closed {
                        Err(e) => e,
                        Ok(()) => self.type_error(
                            "The delegated iterator does not provide a throw() method.",
                        ),
                    };
                    self.reject(made, e);
                    return Ok(Value::Obj(made));
                }
                if self.calls_program(&m) {
                    self.adapt_by_frame(BY_UNCOUNTED, made, sync, kind, arg, m)
                        .map(|_| None)
                } else if matches!(
                    self.heap[sync as usize].kind,
                    Kind::Generator(GenState::Suspended(_))
                ) {
                    // A generator's own method runs its body: from a frame, as bytecode calls it.
                    self.adapt_by_frame(BY_COUNTED, made, sync, kind, arg, m)
                        .map(|_| None)
                } else {
                    let args: &[Value] = match &arg {
                        Some(a) => std::slice::from_ref(a),
                        None => &[],
                    };
                    // `$vmAsyncFromSync` calls it as bytecode calls it.
                    self.call_counted(&m, sv, args)
                        .and_then(|r| self.iter_result_parts(&r, kind))
                        .map(Some)
                }
            }
        };
        let Some(step) = step.transpose() else {
            return Ok(Value::Undef);
        };
        self.settle_from_sync(made, sync, kind, step)?;
        Ok(Value::Obj(made))
    }

    /// One `next` on a sync iterator, as a value and a done flag, or `None` once a frame takes it for the promise
    /// `made` (a call of the program's `next`, a generator resumed). The reference's `$vmAsyncFromSync` calls it as
    /// bytecode calls it, except on an iterator it walks itself: a generator's or helper's native `next` costs its
    /// fifty before the body runs.
    fn sync_step(
        &mut self,
        made: Id,
        sync: Id,
        arg: Option<Value>,
        next: Value,
    ) -> Result<Option<(Value, bool)>, Value> {
        let it = Value::Obj(sync);
        let generator = matches!(
            self.heap[sync as usize].kind,
            Kind::Generator(_) | Kind::IterHelper(_)
        );
        if generator {
            self.fuel(NATIVE_FUEL);
        }
        if next.is_nullish() {
            if matches!(
                self.heap[sync as usize].kind,
                Kind::Generator(GenState::Suspended(_))
            ) {
                self.adapt_by_frame(BY_RESUME, made, sync, REQ_NEXT, arg, Value::Undef)?;
                return Ok(None);
            }
            if let Some(Some(step)) =
                self.sync_delegate_step(it, REQ_NEXT, arg.unwrap_or_default())?
            {
                return Ok(Some(step));
            }
        }
        let m = if next.is_nullish() {
            let nk = self.names.next;
            self.get(&it, nk)?
        } else {
            next
        };
        if self.calls_program(&m) {
            let how = if generator { BY_UNCOUNTED } else { BY_COUNTED };
            self.adapt_by_frame(how, made, sync, REQ_NEXT, arg, m)?;
            return Ok(None);
        }
        let args: &[Value] = match &arg {
            Some(a) => std::slice::from_ref(a),
            None => &[],
        };
        let r = if generator {
            self.call(&m, it, args)?
        } else {
            self.call_counted(&m, it, args)?
        };
        self.iter_result_parts(&r, REQ_NEXT).map(Some)
    }

    /// Starts closing an async iterator: the result of its `return()`, or `None` when it has none. A `return` of the
    /// program's is called by a frame, which pushes the result for the instruction itself: the caller sees
    /// `Vm::entered`.
    #[inline(never)]
    pub fn async_close(&mut self, it: Value) -> Result<Option<Value>, Value> {
        match it {
            Value::Undef | Value::Null => Ok(None),
            Value::Obj(id)
                if !matches!(self.heap[id as usize].kind, Kind::AsyncFromSync { .. }) =>
            {
                let rk = self.names.return_;
                let m = self.get(&it, rk)?;
                if m.is_nullish() {
                    return Ok(None);
                }
                if !self.is_callable(&m) {
                    return Err(self.type_error("Iterator return must be a function."));
                }
                if self.calls_program(&m) {
                    self.delegate_by_call(m, it, None)?;
                    return Ok(Some(Value::Undef));
                }
                // The reference calls it as bytecode calls it.
                self.call_counted(&m, it, &[]).map(Some)
            }
            _ => self.delegate_call(it, REQ_RETURN, None, Value::Undef),
        }
    }

    #[inline(never)]
    pub fn iter_step(&mut self, it: &Value) -> Result<Option<Value>, Value> {
        self.iter_step_with(it, Value::Undef)
    }

    /// The `next` method of an iterator the VM does not run itself, read once when it opens, as iterator records
    /// keep it; `Undef` for any other iterator.
    pub fn record_next(&mut self, it: &Value) -> Res {
        let Value::Obj(id) = it else {
            return Ok(Value::Undef);
        };
        match self.heap[*id as usize].kind {
            Kind::ArrayIter { .. }
            | Kind::MapIter { .. }
            | Kind::StrIter { .. }
            | Kind::ListIter { .. }
            | Kind::ExoticIter { .. }
            | Kind::Generator(_)
            | Kind::AsyncFromSync { .. } => Ok(Value::Undef),
            _ => {
                let next = self.names.next;
                self.get(it, next)
            }
        }
    }

    /// One iterator step, calling `next` (when not `Undef`) instead of reading the iterator's `next` again. A built-in
    /// iterator is stepped directly only when its record keeps no `next` (see `Vm::record_next_of`).
    #[inline(never)]
    pub fn iter_step_with(&mut self, it: &Value, next: Value) -> Result<Option<Value>, Value> {
        let Value::Obj(id) = it else { return Ok(None) };
        let id = *id;
        let direct = next.is_nullish();
        match &self.heap[id as usize].kind {
            Kind::ArrayIter { target, pos, kind } if direct => {
                let (target, pos, kind) = (*target, *pos as usize, *kind);
                let item = match &self.heap[target as usize].kind {
                    Kind::Array(items) | Kind::Arguments(items) => {
                        items.get(pos).map(|v| match v {
                            Value::Uninit => Value::Undef,
                            v => *v,
                        })
                    }
                    _ => None,
                };
                let item = match item {
                    None if self.heap[target as usize].flags & SPARSE != 0
                        && pos < self.array_len(target) =>
                    {
                        Some(self.inherited_elem(target, pos).unwrap_or_default())
                    }
                    item => item,
                };
                let step = if item.is_some() { 1 } else { u32::MAX };
                if let Kind::ArrayIter { pos: p, .. } = &mut self.heap[id as usize].kind {
                    *p = p.saturating_add(step);
                }
                let Some(v) = item else { return Ok(None) };
                Ok(Some(match kind {
                    IterKind::Values => v,
                    IterKind::Keys => Value::Num(pos as f64),
                    IterKind::Entries => self.new_array(vec![Value::Num(pos as f64), v]),
                }))
            }
            Kind::MapIter { target, pos, kind } if direct => {
                let (target, mut pos, kind) = (*target, *pos as usize, *kind);
                let (entry, is_set) = match &self.heap[target as usize].kind {
                    Kind::Map(m) | Kind::Set(m) => {
                        while pos < m.entries.len() && m.entries[pos].is_none() {
                            pos += 1;
                        }
                        (
                            m.entries.get(pos).cloned().flatten(),
                            matches!(self.heap[target as usize].kind, Kind::Set(_)),
                        )
                    }
                    _ => (None, false),
                };
                if let Kind::MapIter { pos: p, .. } = &mut self.heap[id as usize].kind {
                    *p = if entry.is_some() {
                        (pos + 1) as u32
                    } else {
                        u32::MAX
                    };
                }
                let Some((k, v)) = entry else { return Ok(None) };
                let v = if is_set { k } else { v };
                Ok(Some(match kind {
                    IterKind::Keys => k,
                    IterKind::Values => v,
                    IterKind::Entries => self.new_array(vec![k, v]),
                }))
            }
            Kind::StrIter { s, pos } if direct => {
                let p = *pos as usize;
                let Some(cp) = crate::strings::code_point_at(self.atoms.get(*s), p) else {
                    return Ok(None);
                };
                let step = cp.len() as u32;
                let v = match cp.as_bytes() {
                    [b] if *b < 128 => self.char_str(*b as u16),
                    _ => {
                        let cp = cp.to_owned();
                        self.string_val(cp)
                    }
                };
                if let Kind::StrIter { pos, .. } = &mut self.heap[id as usize].kind {
                    *pos += step;
                }
                Ok(Some(v))
            }
            Kind::ListIter { items, pos } if direct => {
                let v = items.get(*pos as usize).cloned();
                if v.is_some()
                    && let Kind::ListIter { pos, .. } = &mut self.heap[id as usize].kind
                {
                    *pos += 1;
                }
                Ok(v)
            }
            Kind::Generator(_) => {
                let (v, done) = self.resume_generator(id, 0, Value::Undef)?;
                Ok(if done { None } else { Some(v) })
            }
            _ => {
                let f = if next.is_nullish() {
                    let nk = self.names.next;
                    self.get_obj(id, nk)
                } else {
                    next
                };
                // The reference steps its own iterators and helpers without a call; any other `next` is called as
                // bytecode calls it.
                let r = if match self.heap[id as usize].kind {
                    Kind::IterHelper(_) => true,
                    Kind::ExoticIter { .. } => direct,
                    _ => false,
                } {
                    self.call(&f, *it, &[])?
                } else {
                    self.call_counted(&f, *it, &[])?
                };
                let Value::Obj(rid) = r else {
                    return Err(self.type_error("Iterator next() result must be an object."));
                };
                let done = self.names.done;
                let d = self.get_obj(rid, done);
                if self.truthy(&d) {
                    return Ok(None);
                }
                let value = self.names.value;
                Ok(Some(self.get_obj(rid, value)))
            }
        }
    }

    #[inline(never)]
    pub fn iter_close(&mut self, it: &Value) -> Result<(), Value> {
        let Value::Obj(id) = it else { return Ok(()) };
        let id = *id;
        match &self.heap[id as usize].kind {
            Kind::Generator(GenState::Suspended(_)) => {
                self.resume_generator(id, 1, Value::Undef)?;
                Ok(())
            }
            Kind::Generator(_)
            | Kind::ArrayIter { .. }
            | Kind::MapIter { .. }
            | Kind::StrIter { .. }
            | Kind::ListIter { .. } => Ok(()),
            _ => {
                let ret = self.names.return_;
                let f = self.get_obj(id, ret);
                if f.is_nullish() {
                    return Ok(());
                }
                if !self.is_callable(&f) {
                    return Err(self.type_error("Iterator return must be a function."));
                }
                let r = self.call(&f, *it, &[])?;
                if !matches!(r, Value::Obj(_)) {
                    return Err(self.type_error("Iterator return() result must be an object."));
                }
                Ok(())
            }
        }
    }
}

/// An array's items with each hole read as `undefined`, as spreading and iterating read them.
pub fn without_holes(items: &[Value]) -> Vec<Value> {
    let mut out = items.to_vec();
    for v in &mut out {
        if let Value::Uninit = v {
            *v = Value::Undef;
        }
    }
    out
}

/// How the reference's host names one of its two symbols.
pub(crate) fn symbol_text(s: Atom) -> &'static str {
    if s == SYM_ITERATOR {
        "Symbol(codemode.iterator)"
    } else {
        "Symbol(codemode.async-iterator)"
    }
}
