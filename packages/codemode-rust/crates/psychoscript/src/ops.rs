//! Property access, conversions, operators and iteration on program values.

use crate::object::*;
use crate::strings::StrId;
use crate::value::{Id, Value, num_to_string, str_to_num};
use crate::vm::{Res, Vm};

pub const MAX_STRING_LEN: usize = 1 << 24;
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
            Value::Obj(id) => Ok(self.get_obj(*id, key)),
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
                Kind::Array(items) | Kind::Arguments(items) => {
                    if let Some(i) = self.atoms.index(key) {
                        return items.get(i as usize).cloned().unwrap_or_default();
                    }
                    if key == self.names.length {
                        return Value::Num(items.len() as f64);
                    }
                }
                Kind::Closure(c) if o.props.find(key).is_none() => {
                    if key == self.names.name {
                        return Value::Str(self.atoms.atom_str(c.proto.name));
                    }
                    if key == self.names.length {
                        return Value::Num(c.proto.length as f64);
                    }
                }
                Kind::Native { name, length, .. } if o.props.find(key).is_none() => {
                    if key == self.names.name {
                        return Value::Str(self.atoms.atom_str(*name));
                    }
                    if key == self.names.length {
                        return Value::Num(*length as f64);
                    }
                }
                Kind::Map(m) | Kind::Set(m) if cur == id && key == self.names.size => {
                    return Value::Num(m.live as f64);
                }
                Kind::ToolRef(path) if cur == id => {
                    if key == self.names.then || key == SYM_ITERATOR {
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

    #[inline(never)]
    pub fn get_elem(&mut self, v: &Value, k: &Value) -> Res {
        match (v, k) {
            (Value::Obj(id), Value::Num(n)) => {
                if let Kind::Array(items) = &self.heap[*id as usize].kind {
                    let i = *n as usize;
                    if i as f64 == *n {
                        return Ok(items.get(i).cloned().unwrap_or_default());
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
            Value::Sym(_) => SYM_ITERATOR,
            Value::Obj(_) => {
                let p = self.primitive_of(k, Hint::String)?;
                return self.key_of(&p);
            }
            Value::Bool(b) => self.atoms.intern(if *b { "true" } else { "false" }),
            Value::Null => self.atoms.intern_static("null"),
            Value::Undef | Value::Uninit => self.atoms.intern_static("undefined"),
        })
    }

    // ---------- property writes ----------

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
                    if i < items.len() {
                        items[i] = val;
                        return Ok(());
                    }
                    if flags & NON_EXTENSIBLE != 0 {
                        return Err(self.not_extensible(key));
                    }
                    if i >= MAX_ARRAY_LEN {
                        return Err(self.range_error("Invalid array length."));
                    }
                    items.resize(i, Value::Undef);
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
                        items.resize(n as usize, Value::Undef);
                    }
                    return Ok(());
                }
            }
            Kind::Arguments(items) => {
                if let Some(i) = index
                    && (i as usize) < items.len()
                {
                    items[i as usize] = val;
                    return Ok(());
                }
            }
            Kind::Closure(_) | Kind::Native { .. } | Kind::Bound(_) if is_name_or_length => {
                return Err(self.read_only(key));
            }
            Kind::ToolRef(_) => return Err(self.type_error("Cannot assign to a tool reference")),
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
        self.type_error(&format!(
            "Cannot assign to read only property '{k}' of object"
        ))
    }

    fn not_extensible(&mut self, key: Atom) -> Value {
        let k = self.key_text(key);
        self.type_error(&format!(
            "Cannot add property {k}, object is not extensible"
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
                items.resize(i, Value::Undef);
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
            if v.is_nullish() {
                let k = self.key_text(key);
                return Err(self.type_error(&format!(
                    "Cannot convert undefined or null to object (deleting '{k}')"
                )));
            }
            return Ok(true);
        };
        let id = *id;
        let flags = self.heap[id as usize].flags;
        let index = self.atoms.index(key);
        if let Kind::Array(items) = &mut self.heap[id as usize].kind {
            if key == self.names.length {
                return Err(self.type_error("Cannot delete property 'length' of [object Array]"));
            }
            if let Some(i) = index {
                if flags & (FROZEN | SEALED) != 0 {
                    let k = self.key_text(key);
                    return Err(self.type_error(&format!("Cannot delete property '{k}'")));
                }
                if let Some(slot) = items.get_mut(i as usize) {
                    *slot = Value::Undef;
                }
                return Ok(true);
            }
        }
        if self.heap[id as usize].props.find(key).is_some() && flags & (FROZEN | SEALED) != 0 {
            let k = self.key_text(key);
            return Err(self.type_error(&format!("Cannot delete property '{k}'")));
        }
        self.heap[id as usize].props.remove(key);
        Ok(true)
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
                        if (i as usize) < items.len() {
                            return true;
                        }
                    } else if key == self.names.length {
                        return true;
                    }
                }
                Kind::Closure(_) | Kind::Native { .. }
                    if key == self.names.name || key == self.names.length =>
                {
                    return true;
                }
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

    pub fn has_own(&self, id: Id, key: Atom) -> bool {
        let o = &self.heap[id as usize];
        match &o.kind {
            Kind::Array(items) | Kind::Arguments(items) => {
                if let Some(i) = self.atoms.index(key) {
                    return (i as usize) < items.len();
                }
                if key == self.names.length {
                    return true;
                }
            }
            Kind::Closure(_) | Kind::Native { .. }
                if key == self.names.name || key == self.names.length =>
            {
                return true;
            }
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
        let mut out = Vec::new();
        let len = match &self.heap[id as usize].kind {
            Kind::Array(items) | Kind::Arguments(items) => items.len(),
            _ => 0,
        };
        for i in 0..len {
            out.push(self.atoms.intern(&i.to_string()));
        }
        let props = &self.heap[id as usize].props;
        let mut ints = Vec::new();
        let mut strs = Vec::new();
        for p in &props.items {
            if p.flags & ENUMERABLE == 0 || p.key == SYM_ITERATOR {
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
                    .filter(|p| p.flags & ENUMERABLE != 0 && p.key != SYM_ITERATOR)
                    .map(|p| (p.key, p.value))
                    .collect();
            }
        }
        let keys = self.own_keys(id);
        keys.into_iter().map(|k| (k, self.get_obj(id, k))).collect()
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
                for (k, v) in self.own_entries(*id) {
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
            Value::Sym(_) => "Symbol(Symbol.iterator)".into(),
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
        let (a, b) = (self.atoms.get(x), self.atoms.get(y));
        if a.len() + b.len() > MAX_STRING_LEN {
            return Err(self.range_error("Invalid string length"));
        }
        let mut s = String::with_capacity(a.len() + b.len());
        s.push_str(a);
        s.push_str(b);
        Ok(self.string_val(s))
    }

    #[inline(never)]
    pub fn add(&mut self, a: Value, b: Value) -> Res {
        match (&a, &b) {
            (Value::Num(x), Value::Num(y)) => return Ok(Value::Num(x + y)),
            (Value::Str(x), Value::Str(y)) => return self.concat_ids(*x, *y),
            (Value::Str(x), Value::Num(y)) => {
                let y = num_to_string(*y);
                let x = self.atoms.get(*x).to_owned();
                return self.concat(&x, &y);
            }
            (Value::Num(x), Value::Str(y)) => {
                let x = num_to_string(*x);
                let y = self.atoms.get(*y).to_owned();
                return self.concat(&x, &y);
            }
            _ => {}
        }
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
                Kind::Array(items) => return Ok(items.clone()),
                Kind::Set(m) => {
                    return Ok(m.entries.iter().flatten().map(|(k, _)| *k).collect());
                }
                _ => {}
            }
        }
        if let Value::Str(s) = v {
            let chars: Vec<char> = self.atoms.get(*s).chars().collect();
            return Ok(chars
                .into_iter()
                .map(|c| {
                    if (c as u32) < 128 {
                        Value::Str(self.char_strs[c as usize])
                    } else {
                        self.string_val(c.to_string())
                    }
                })
                .collect());
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

    #[inline(never)]
    pub fn get_iterator(&mut self, v: &Value) -> Res {
        let proto = self.realm.iter_proto;
        match v {
            Value::Obj(id) => {
                let kind = match &self.heap[*id as usize].kind {
                    Kind::Array(_) | Kind::Arguments(_) => Some(Kind::ArrayIter {
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
                if self.is_callable(&f) {
                    let it = self.call(&f, *v, &[])?;
                    if !matches!(it, Value::Obj(_)) {
                        return Err(self
                            .type_error("Result of the Symbol.iterator method is not an object"));
                    }
                    return Ok(it);
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

    /// One step of `yield*`: the next value, or the delegate's completion value once it is done.
    #[inline(never)]
    pub fn delegate_step(&mut self, it: &Value) -> Result<(Value, bool), Value> {
        if let Value::Obj(id) = it {
            let id = *id;
            match &self.heap[id as usize].kind {
                Kind::Generator(_) => return self.resume_generator(id, 0, Value::Undef),
                Kind::ArrayIter { .. }
                | Kind::MapIter { .. }
                | Kind::StrIter { .. }
                | Kind::ListIter { .. } => {}
                _ => {
                    let next = self.names.next;
                    let f = self.get_obj(id, next);
                    let r = self.call(&f, *it, &[])?;
                    let Value::Obj(rid) = r else {
                        return Err(self.type_error("Iterator result is not an object"));
                    };
                    let (dk, vk) = (self.names.done, self.names.value);
                    let d = self.get_obj(rid, dk);
                    return Ok((self.get_obj(rid, vk), self.truthy(&d)));
                }
            }
        }
        Ok(match self.iter_step(it)? {
            Some(v) => (v, false),
            None => (Value::Undef, true),
        })
    }

    #[inline(never)]
    pub fn iter_step(&mut self, it: &Value) -> Result<Option<Value>, Value> {
        let Value::Obj(id) = it else { return Ok(None) };
        let id = *id;
        match &self.heap[id as usize].kind {
            Kind::ArrayIter { target, pos, kind } => {
                let (target, pos, kind) = (*target, *pos as usize, *kind);
                let item = match &self.heap[target as usize].kind {
                    Kind::Array(items) | Kind::Arguments(items) => items.get(pos).cloned(),
                    _ => None,
                };
                let Some(v) = item else { return Ok(None) };
                if let Kind::ArrayIter { pos: p, .. } = &mut self.heap[id as usize].kind {
                    *p += 1;
                }
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
                    *p = (pos + 1) as u32;
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
                let Some(c) = self.atoms.get(*s)[p..].chars().next() else {
                    return Ok(None);
                };
                let v = if (c as u32) < 128 {
                    self.char_str(c as u16)
                } else {
                    self.string_val(c.to_string())
                };
                if let Kind::StrIter { pos, .. } = &mut self.heap[id as usize].kind {
                    *pos += c.len_utf8() as u32;
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
                let next = self.names.next;
                let f = self.get_obj(id, next);
                let r = self.call(&f, *it, &[])?;
                let Value::Obj(rid) = r else {
                    let d = self.describe(&r);
                    return Err(self.type_error(&format!("Iterator result {d} is not an object")));
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
                if self.is_callable(&f) {
                    let r = self.call(&f, *it, &[])?;
                    if !matches!(r, Value::Obj(_)) {
                        return Err(self.type_error("Iterator result is not an object"));
                    }
                }
                Ok(())
            }
        }
    }
}
