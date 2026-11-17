//! Property access, conversions, operators and iteration on program values.

use crate::builtins::exotic;
use crate::object::*;
use crate::strings::StrId;
use crate::value::{Id, Value, num_to_string, str_to_num};
use crate::vm::{REQ_NEXT, REQ_RETURN, Reaction, Res, Vm};

pub const MAX_STRING_LEN: usize = 1 << 24;
const UNAWAITED: &str = "This value is an un-awaited Promise; await it first - e.g. `const result = await tools.ns.tool(...)`.";
pub const MAX_ARRAY_LEN: usize = 10_000_000;

#[derive(Clone, Copy, PartialEq)]
pub enum Hint {
    Default,
    Number,
    String,
}

impl<'rt> Vm<'rt> {
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
                    return Err(self.invalid_data(UNAWAITED));
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
            Value::Sym(_) => {
                let p = self.realm.symbol_proto;
                Ok(self.get_obj(p, key))
            }
            Value::Undef | Value::Null | Value::Uninit => {
                let k = self.key_text(key);
                let t = if let Value::Null = v {
                    "null"
                } else {
                    "undefined"
                };
                Err(self.type_error(&format!("Cannot read properties of {t} (reading '{k}').")))
            }
        }
    }

    pub fn key_text(&self, key: Atom) -> String {
        self.atoms.text(key).to_owned()
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
                    } else if key == self.names.length {
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
                Kind::ToolRef(path) if cur == id => {
                    if key == self.names.then || key <= SYM_ASYNC_ITERATOR {
                        return Value::Undef;
                    }
                    let k = self.atoms.text(key);
                    let child = if path.is_empty() {
                        k.to_owned()
                    } else {
                        format!("{path}.{k}")
                    };
                    return self.tool_ref(&child);
                }
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
                let k = self
                    .string_of(k)
                    .map(|s| self.text(s).to_owned())
                    .unwrap_or_default();
                let t = if let Value::Null = v {
                    "null"
                } else {
                    "undefined"
                };
                return Err(
                    self.type_error(&format!("Cannot read properties of {t} (reading '{k}')."))
                );
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
                let p = self.primitive_of(k, Hint::String)?;
                return self.key_of(&p);
            }
            Value::Bool(b) => self.atoms.intern(if *b { "true" } else { "false" }),
            Value::Null => self.atoms.intern_static("null"),
            Value::Undef | Value::Uninit => self.atoms.intern_static("undefined"),
        })
    }

    // ---------- data guards ----------

    /// Promises and tool references are not data: operators reject them, as the reference does.
    pub fn is_opaque_operand(&self, v: &Value) -> bool {
        matches!(v, Value::Obj(id) if matches!(self.heap[*id as usize].kind, Kind::Promise(_) | Kind::ToolRef(_)))
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
            Value::Undef | Value::Null | Value::Uninit => {
                let k = self.key_text(key);
                let t = if let Value::Null = v {
                    "null"
                } else {
                    "undefined"
                };
                Err(self.type_error(&format!("Cannot set properties of {t} (setting '{k}').")))
            }
            _ => {
                let k = self.key_text(key);
                let t = self.type_of(v);
                Err(self.type_error(&format!("Cannot create property '{k}' on {t}")))
            }
        }
    }

    #[inline(never)]
    pub fn set_obj(&mut self, id: Id, key: Atom, val: Value) -> Result<(), Value> {
        if matches!(self.heap[id as usize].kind, Kind::Promise(_)) && !self.has_key(id, key) {
            return Err(self.invalid_data(UNAWAITED));
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
                    if i >= MAX_ARRAY_LEN {
                        return Err(self.range_error("Invalid array length."));
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
                        return Err(self.range_error("Invalid array length."));
                    }
                    if let Kind::Array(items) = &mut self.heap[id as usize].kind {
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
            Kind::ToolRef(_) => return Err(self.type_error("Cannot assign to a tool reference")),
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
        if v.is_nullish() {
            let k = self
                .string_of(k)
                .map(|s| self.text(s).to_owned())
                .unwrap_or_default();
            let t = if let Value::Null = v {
                "null"
            } else {
                "undefined"
            };
            return Err(self.type_error(&format!("Cannot set properties of {t} (setting '{k}').")));
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
            } else if i < MAX_ARRAY_LEN {
                items.resize(i, Value::Uninit);
                items.push(val);
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
            Kind::ToolRef(_) => return Err(self.invalid_data("Only data fields may be deleted.")),
            Kind::Array(_) if key == length => true,
            Kind::Array(items) | Kind::Arguments(items) if index.is_some() => {
                match items.get_mut(index.unwrap_or_default() as usize) {
                    Some(Value::Uninit) | None => false,
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
                Err(self.type_error(&format!("Cannot read properties of {t} (reading '{k}').")))
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
            _ => Ok(true),
        }
    }

    #[inline(never)]
    pub fn has_property(&mut self, o: &Value, k: &Value) -> Result<bool, Value> {
        let Value::Obj(id) = o else {
            let ks = self.string_of(k)?;
            let ks = self.text(ks).to_owned();
            let d = self.describe(o);
            return Err(self.type_error(&format!(
                "Cannot use 'in' operator to search for '{ks}' in {d}"
            )));
        };
        let key = self.key_of(k)?;
        Ok(self.has_key(*id, key))
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
                    return items
                        .get(i as usize)
                        .is_some_and(|v| !matches!(v, Value::Uninit));
                }
                if key == self.names.length && matches!(o.kind, Kind::Array(_)) {
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
        if !self.is_callable(c) {
            return Err(self.type_error("Right-hand side of 'instanceof' is not callable"));
        }
        let Value::Obj(cid) = c else { return Ok(false) };
        let pk = self.names.prototype;
        let Value::Obj(proto) = self.get_obj(*cid, pk) else {
            return Err(self.type_error("Function has non-object prototype in instanceof check"));
        };
        let Value::Obj(cur) = v else { return Ok(false) };
        let mut cur = *cur;
        while let Some(p) = self.heap[cur as usize].proto {
            if p == proto {
                return Ok(true);
            }
            cur = p;
        }
        Ok(false)
    }

    /// Own enumerable string keys in JavaScript order: integer keys ascending, then insertion order.
    pub fn own_keys(&mut self, id: Id) -> Vec<Atom> {
        if let Kind::ToolRef(path) = &self.heap[id as usize].kind {
            let children = self.host.setup.registry.children(path);
            return children.iter().map(|c| self.atoms.intern(c)).collect();
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

    pub fn describe(&self, v: &Value) -> String {
        match v {
            Value::Str(s) => format!("\"{}\"", self.atoms.get(*s)),
            Value::Num(n) => num_to_string(*n),
            Value::Bool(b) => b.to_string(),
            Value::Null => "null".into(),
            Value::Undef | Value::Uninit => "undefined".into(),
            Value::Sym(s) => self.atoms.text(*s).to_owned(),
            Value::Obj(id) => match &self.heap[*id as usize].kind {
                Kind::Array(_) => "array".into(),
                Kind::Closure(c) => {
                    let n = self.atoms.text(c.proto.name);
                    if n.is_empty() {
                        "function".into()
                    } else {
                        format!("function {n}")
                    }
                }
                Kind::ToolRef(p) => format!("tools.{p}"),
                _ => "object".into(),
            },
        }
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
                return Err(self.type_error("Cannot convert a Symbol value to a number"));
            }
            Value::Obj(_) => {
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
                match self.string_val(num_to_string(*n)) {
                    Value::Str(id) => id,
                    _ => 0,
                }
            }
            Value::Bool(b) => return Ok(self.static_id(if *b { "true" } else { "false" })),
            Value::Null => return Ok(self.static_id("null")),
            Value::Undef | Value::Uninit => return Ok(self.static_id("undefined")),
            Value::Sym(_) => {
                return Err(self.type_error("Cannot convert a Symbol value to a string"));
            }
            Value::Obj(_) => {
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

    pub fn primitive_of(&mut self, v: &Value, hint: Hint) -> Res {
        let Value::Obj(id) = v else {
            return Ok(*v);
        };
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
                let r = self.call(&f, *v, &[])?;
                if !matches!(r, Value::Obj(_)) {
                    return Ok(r);
                }
            }
        }
        Err(self.type_error("Cannot convert object to primitive value"))
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
                let y = self.string_of(&Value::Num(*y))?;
                return self.concat_ids(*x, y);
            }
            (Value::Num(x), Value::Str(y)) => {
                let x = num_to_string(*x);
                let y = self.atoms.get(*y).to_owned();
                return self.concat(&x, &y);
            }
            _ => {}
        }
        self.data_operands(&a, &b)?;
        let pa = self.primitive_of(&a, Hint::Default)?;
        let pb = self.primitive_of(&b, Hint::Default)?;
        if matches!(pa, Value::Str(_)) || matches!(pb, Value::Str(_)) {
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
                let (x, y) = (self.number_of(&a)?, self.number_of(&b)?);
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
            let pa = self.primitive_of(a, Hint::Number)?;
            (pa, self.primitive_of(b, Hint::Number)?)
        } else {
            let pb = self.primitive_of(b, Hint::Number)?;
            (self.primitive_of(a, Hint::Number)?, pb)
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
                return self.loose_eq(&p, b);
            }
            (Value::Num(_) | Value::Str(_) | Value::Sym(_), Value::Obj(_)) => {
                let p = self.primitive_of(b, Hint::Default)?;
                return self.loose_eq(a, &p);
            }
            _ => self.strict_eq(a, b),
        })
    }

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
        let mut out = Vec::new();
        while let Some(x) = self.iter_step(&it)? {
            if out.len() >= MAX_ARRAY_LEN {
                return Err(self.range_error("Invalid array length."));
            }
            out.push(x);
        }
        Ok(out)
    }

    /// Runs `f` on each value of `v` as iteration yields it; when `f` fails, the iterator is closed first, as a
    /// `for...of` loop closes it.
    pub fn for_each_value(
        &mut self,
        v: &Value,
        mut f: impl FnMut(&mut Vm<'rt>, Value) -> Result<(), Value>,
    ) -> Result<(), Value> {
        let it = self.get_iterator(v)?;
        while let Some(x) = self.iter_step(&it)? {
            if let Err(e) = f(self, x) {
                if self.fatal.is_none() {
                    let _ = self.iter_close(&it);
                }
                return Err(e);
            }
        }
        Ok(())
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

    /// How the reference names a value in a data error: `a data object`, `a function`, `null`.
    pub fn describe_data(&self, v: &Value) -> &'static str {
        match v {
            Value::Undef | Value::Uninit => "undefined",
            Value::Null => "null",
            Value::Bool(_) => "a boolean",
            Value::Num(_) => "a number",
            Value::Str(_) => "a string",
            Value::Sym(_) => "a symbol",
            Value::Obj(id) => match &self.heap[*id as usize].kind {
                Kind::Ordinary | Kind::Live(_) => "a data object",
                Kind::Array(_) => "an array",
                Kind::Closure(_) | Kind::Native { .. } | Kind::Bound(_) => "a function",
                Kind::Promise(_) => "an un-awaited Promise",
                Kind::Error(_) => "an Error",
                Kind::ToolRef(_) => "a tool reference",
                Kind::Generator(_) | Kind::AsyncGenerator(_) => "a generator",
                _ => "an object",
            },
        }
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
                    let items: std::rc::Rc<[Value]> =
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
        let d = self.describe(v);
        Err(self.type_error(&format!("{d} is not iterable")))
    }

    /// A `yield*` step on an iterator the VM runs itself, as a value and a done flag: `Ok(None)` for any other
    /// iterator, `Ok(Some(None))` when it lacks the `throw` or `return` method asked for.
    #[inline(never)]
    pub fn sync_delegate_step(
        &mut self,
        it: Value,
        kind: u8,
        received: Value,
    ) -> Result<Option<Option<(Value, bool)>>, Value> {
        let Value::Obj(id) = it else { return Ok(None) };
        match &self.heap[id as usize].kind {
            Kind::Generator(_) => {
                let mode = match kind {
                    REQ_NEXT => 0,
                    REQ_RETURN => 1,
                    _ => 2,
                };
                Ok(Some(Some(self.resume_generator(id, mode, received)?)))
            }
            Kind::ArrayIter { .. }
            | Kind::MapIter { .. }
            | Kind::StrIter { .. }
            | Kind::ListIter { .. } => {
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
    /// `throw` or `return` is missing.
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
        let args: &[Value] = match &arg {
            Some(a) => std::slice::from_ref(a),
            None => &[],
        };
        self.call(&m, it, args).map(Some)
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

    /// GetIterator with the async hint: `[Symbol.asyncIterator]()`, or the sync iterator adapted.
    #[inline(never)]
    /// GetIterator for `for await` (`ITER_FOR_AWAIT`) or an async generator's `yield*` (`ITER_DELEGATE`).
    pub fn get_async_iterator(&mut self, v: &Value, ctx: u8) -> Res {
        if let Value::Obj(id) = v {
            let f = self.get_obj(*id, SYM_ASYNC_ITERATOR);
            if !f.is_nullish() {
                return self.open_with(&f, v);
            }
        }
        let Value::Obj(sync) = self.get_iterator_in(v, ctx)? else {
            return Err(self.type_error("Iterator method result must be an object."));
        };
        let next = self.record_next(&Value::Obj(sync))?;
        let proto = self.realm.async_from_sync_proto;
        Ok(Value::Obj(self.alloc(Obj::new(
            Some(proto),
            Kind::AsyncFromSync { sync, next },
        ))))
    }

    /// The promise of an async-from-sync iterator's `next`, `throw` or `return`.
    fn async_from_sync_call(&mut self, sync: Id, next: Value, kind: u8, arg: Option<Value>) -> Res {
        let made = self.new_promise();
        let sv = Value::Obj(sync);
        let step = match kind {
            REQ_NEXT => self.sync_step(sv, arg, next),
            _ => {
                let name = self.request_name(kind);
                let m = self.get_obj(sync, name);
                if m.is_nullish() {
                    if kind == REQ_RETURN {
                        let r = self.iter_result(arg.unwrap_or_default(), true);
                        self.resolve_promise(made, r);
                    } else {
                        let closed = self.iter_close(&sv);
                        let e = match closed {
                            Err(e) => e,
                            Ok(()) => self.type_error(
                                "The delegated iterator does not provide a throw() method.",
                            ),
                        };
                        self.reject(made, e);
                    }
                    return Ok(Value::Obj(made));
                }
                let args: &[Value] = match &arg {
                    Some(a) => std::slice::from_ref(a),
                    None => &[],
                };
                self.call(&m, sv, args)
                    .and_then(|r| self.iter_result_parts(&r, kind))
            }
        };
        match step {
            Ok((v, done)) => {
                let close = (kind != REQ_RETURN && !done).then_some(sync);
                let w = self.promise_resolve(v);
                self.perform_then(w, Reaction::FromSync { made, done, close });
            }
            Err(e) => {
                if self.fatal.is_some() {
                    return Err(e);
                }
                self.reject(made, e);
            }
        }
        Ok(Value::Obj(made))
    }

    /// One `next` on a sync iterator, as a value and a done flag.
    fn sync_step(
        &mut self,
        it: Value,
        arg: Option<Value>,
        next: Value,
    ) -> Result<(Value, bool), Value> {
        if let Some(Some(step)) = self.sync_delegate_step(it, REQ_NEXT, arg.unwrap_or_default())? {
            return Ok(step);
        }
        let r = self
            .delegate_call(it, REQ_NEXT, arg, next)?
            .unwrap_or_default();
        self.iter_result_parts(&r, REQ_NEXT)
    }

    /// Starts closing an async iterator: the result of its `return()`, or `None` when it has none.
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
                self.call(&m, it, &[]).map(Some)
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
            | Kind::Generator(_)
            | Kind::AsyncFromSync { .. } => Ok(Value::Undef),
            _ => {
                let next = self.names.next;
                self.get(it, next)
            }
        }
    }

    /// One iterator step, calling `next` (when not `Undef`) instead of reading the iterator's `next` again.
    #[inline(never)]
    pub fn iter_step_with(&mut self, it: &Value, next: Value) -> Result<Option<Value>, Value> {
        let Value::Obj(id) = it else { return Ok(None) };
        let id = *id;
        match &self.heap[id as usize].kind {
            Kind::ArrayIter { target, pos, kind } => {
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
            Kind::MapIter { target, pos, kind } => {
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
            Kind::StrIter { s, pos } => {
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
            Kind::ListIter { items, pos } => {
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
                let r = self.call(&f, *it, &[])?;
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
