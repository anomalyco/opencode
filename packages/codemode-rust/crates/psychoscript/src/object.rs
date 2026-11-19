//! Heap objects, property storage and the atom interner.

use std::sync::Arc;

use rustc_hash::FxHashMap;

use crate::DiagnosticKind;
use crate::bytecode::FuncProto;
pub use crate::strings::{Atom, SYM_ASYNC_ITERATOR, SYM_ITERATOR};
use crate::value::{Id, Value};
use crate::vm::{NativeFn, SavedFrame};

pub const ENUMERABLE: u8 = 1;
pub const WRITABLE: u8 = 2;
pub const DEFAULT_FLAGS: u8 = ENUMERABLE | WRITABLE;
pub const HIDDEN: u8 = WRITABLE;
/// Not configurable, so `delete` refuses it: the reference's frozen built-in constants and prototypes.
pub const FIXED: u8 = 4;
/// An accessor property: its value is a `Kind::Accessor` object holding the getter and the setter. Its `WRITABLE`
/// bit means nothing.
pub const ACCESSOR: u8 = 8;

#[derive(Clone)]
pub struct Prop {
    pub key: Atom,
    pub value: Value,
    pub flags: u8,
}

/// Insertion-ordered properties; small objects scan linearly, larger ones keep a hash index.
#[derive(Default, Clone)]
pub struct Props {
    pub items: Vec<Prop>,
    index: Option<Box<FxHashMap<Atom, u32>>>,
}

const INDEX_THRESHOLD: usize = 12;

impl Props {
    pub fn from_items(items: Vec<Prop>) -> Self {
        let mut props = Props::default();
        for p in items {
            props.push_new(p.key, p.value, p.flags);
        }
        props
    }

    #[inline]
    pub fn find(&self, key: Atom) -> Option<usize> {
        if let Some(idx) = &self.index {
            return idx.get(&key).map(|i| *i as usize);
        }
        self.items.iter().position(|p| p.key == key)
    }

    #[inline]
    pub fn get(&self, key: Atom) -> Option<&Value> {
        self.find(key).map(|i| &self.items[i].value)
    }

    pub fn insert(&mut self, key: Atom, value: Value, flags: u8) {
        if let Some(i) = self.find(key) {
            self.items[i].value = value;
            return;
        }
        self.push_new(key, value, flags);
    }

    /// Appends a key known to be absent.
    pub fn push_new(&mut self, key: Atom, value: Value, flags: u8) {
        let i = self.items.len();
        self.items.push(Prop { key, value, flags });
        if let Some(idx) = &mut self.index {
            idx.insert(key, i as u32);
        } else if self.items.len() > INDEX_THRESHOLD {
            let map = self
                .items
                .iter()
                .enumerate()
                .map(|(i, p)| (p.key, i as u32))
                .collect();
            self.index = Some(Box::new(map));
        }
    }

    pub fn remove(&mut self, key: Atom) -> bool {
        let Some(i) = self.find(key) else {
            return false;
        };
        self.items.remove(i);
        if self.index.is_some() {
            let map = self
                .items
                .iter()
                .enumerate()
                .map(|(i, p)| (p.key, i as u32))
                .collect();
            self.index = Some(Box::new(map));
        }
        true
    }

    pub fn len(&self) -> usize {
        self.items.len()
    }

    /// The property `key`, data or accessor.
    #[inline]
    pub fn prop(&self, key: Atom) -> Option<&Prop> {
        self.find(key).map(|i| &self.items[i])
    }
}

/// An accessor property's halves: a function, or undefined for a missing half. A native half is the companion of a
/// built-in's accessor (see `builtins::accessors`); anything else callable is a program function, which only program
/// code may call.
#[derive(Clone, Copy, Debug)]
pub struct Accessor {
    pub get: Value,
    pub set: Value,
}

/// A path into a host namespace among the globals, as a small heap object: the path it was read from (`parent`) and
/// the name read (`name`); a namespace global itself has no parent, and its name is the global's label. Each read makes
/// a new one, as the reference's `HostNamespace` does; its whole path and label are built only when a call or a
/// message needs them (`Vm::ns_path`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct NsPath {
    pub parent: u32,
    pub name: crate::strings::Atom,
}

impl NsPath {
    /// The `parent` of a namespace global.
    pub const ROOT: u32 = u32::MAX;

    pub fn is_root(&self) -> bool {
        self.parent == Self::ROOT
    }
}

/// A namespace path spelled out: the global it is under, by its label's atom, and the names below it.
pub struct NsRef {
    pub root: crate::strings::Atom,
    pub keys: Vec<crate::HostString>,
}

/// Appends `.key`, or `["key"]` when the key is not an identifier, to a label, as the reference's `member` writes it
/// (`JSON.stringify` escapes an unpaired surrogate, so a label is always well formed).
pub fn push_member(out: &mut String, key: &crate::HostString) {
    let ident = key.as_str().filter(|k| {
        let mut chars = k.chars();
        chars
            .next()
            .is_some_and(|c| c.is_ascii_alphabetic() || c == '_' || c == '$')
            && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '$')
    });
    match ident {
        Some(k) => {
            out.push('.');
            out.push_str(k);
        }
        None => {
            out.push('[');
            out.push_str(&crate::Data::String(key.clone()).to_json_string());
            out.push(']');
        }
    }
}

/// A failure the interpreter or host raised, kept on the error object so a rethrow reports the same diagnostic.
#[derive(Clone, Debug)]
pub struct Failure {
    pub kind: DiagnosticKind,
    pub message: String,
    /// Source offset of the instruction that raised it, filled in when first thrown.
    pub offset: Option<u32>,
    /// The part of the raising member expression the offset is taken from when it is filled in.
    pub site: crate::bytecode::Site,
}

pub struct Closure {
    pub proto: Arc<FuncProto>,
    pub upvals: Arc<[u32]>,
    pub this: Value,
    /// [[HomeObject]]: the object a method was defined on, which `super` reads from; undefined for others.
    pub home: Value,
    /// A class constructor's instance field initializer, once its class has one.
    pub fields: Value,
}

pub enum PromiseState {
    Pending,
    Fulfilled(Value),
    Rejected(Value),
}

pub struct PromiseData {
    pub state: PromiseState,
    pub reactions: Vec<crate::vm::Reaction>,
}

/// Key for Map and Set under SameValueZero; strings compare by their interned atom.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum MapKey {
    Undef,
    Null,
    Bool(bool),
    Num(u64),
    Str(Atom),
    Obj(Id),
    Sym(u32),
}

/// One word per key. A number's bits fold their high half into the low half: an integer's double has its low
/// mantissa bits all zero, and those are the bits the Fx hash puts in the table's tag, which then matches in every
/// slot of a probed group.
impl std::hash::Hash for MapKey {
    fn hash<H: std::hash::Hasher>(&self, state: &mut H) {
        let (tag, x) = match *self {
            MapKey::Undef => (0u64, 0),
            MapKey::Null => (1, 0),
            MapKey::Bool(b) => (2, b as u64),
            MapKey::Num(n) => (3, n ^ (n >> 32)),
            MapKey::Str(a) => (4, a as u64),
            MapKey::Obj(id) => (5, id as u64),
            MapKey::Sym(s) => (6, s as u64),
        };
        state.write_u64(x ^ (tag << 61));
    }
}

/// Insertion-ordered hash map. Each entry has a logical position, numbered in insertion order and never reused, and
/// iterators hold logical positions, so they stay valid across deletes, inserts, `clear()` and compaction.
/// A delete leaves a tombstone (`None`); once tombstones outnumber live entries they are dropped.
#[derive(Default)]
pub struct OrderedMap {
    entries: Vec<Option<(Value, Value)>>,
    /// While `sparse` is `None`, entry `i` is at logical position `base + i`.
    base: u64,
    sparse: Option<Sparse>,
    /// Key to slot in `entries`, plus `shift` (wrapping), so dropping entries off the front leaves it as it is.
    index: FxHashMap<MapKey, u32>,
    shift: u32,
    pub live: usize,
}

/// The logical positions of a map whose compaction left gaps between them.
struct Sparse {
    /// One per entry, increasing.
    positions: Vec<u64>,
    /// The position the next inserted entry gets.
    next: u64,
}

impl OrderedMap {
    /// A map with these live entries at these logical positions and the position the next insert gets, as a
    /// snapshot saved it, or `None` if the positions don't increase below `end`.
    pub fn restore(end: u64, entries: Vec<(u64, Value, Value)>, keys: Vec<MapKey>) -> Option<Self> {
        if !entries.windows(2).all(|w| w[0].0 < w[1].0)
            || entries.last().is_some_and(|e| e.0 >= end)
        {
            return None;
        }
        let positions = entries.iter().map(|e| e.0).collect();
        let mut map = OrderedMap {
            index: keys.into_iter().zip(0..).collect(),
            live: entries.len(),
            entries: entries.into_iter().map(|e| Some((e.1, e.2))).collect(),
            ..OrderedMap::default()
        };
        map.place(positions, end);
        Some(map)
    }

    /// The storage, deleted entries included, for tracing it a range at a time. A delete may compact it; the collector
    /// traces a map whole before any write to it, so a range never shifts under it.
    pub fn slots(&self) -> &[Option<(Value, Value)>] {
        &self.entries
    }

    /// The live entries in insertion order.
    pub fn iter(&self) -> impl Iterator<Item = &(Value, Value)> {
        self.entries.iter().flatten()
    }

    /// The live entries in insertion order, with their logical positions.
    pub fn positioned(&self) -> impl Iterator<Item = (u64, Value, Value)> + '_ {
        self.entries
            .iter()
            .enumerate()
            .filter_map(|(i, e)| e.map(|(k, v)| (self.position(i), k, v)))
    }

    /// The logical position the next inserted entry gets.
    pub fn end(&self) -> u64 {
        match &self.sparse {
            Some(s) => s.next,
            None => self.base + self.entries.len() as u64,
        }
    }

    /// The first live entry at logical position `*at` or after; moves `*at` just past it.
    #[inline(always)]
    pub fn next_entry(&self, at: &mut u64) -> Option<(Value, Value)> {
        // An iterator's next entry is usually the one right after its last.
        if self.sparse.is_none()
            && let Some(&Some(e)) = at
                .checked_sub(self.base)
                .and_then(|i| self.entries.get(usize::try_from(i).ok()?))
        {
            *at += 1;
            return Some(e);
        }
        self.seek(at)
    }

    /// Out of line, so iterators inline only the common case of `next_entry`.
    #[inline(never)]
    fn seek(&self, at: &mut u64) -> Option<(Value, Value)> {
        let mut i = match &self.sparse {
            Some(s) => s.positions.partition_point(|&q| q < *at),
            None => usize::try_from(at.saturating_sub(self.base)).unwrap_or(usize::MAX),
        };
        while let Some(e) = self.entries.get(i) {
            if let Some(e) = *e {
                *at = self.position(i) + 1;
                return Some(e);
            }
            i += 1;
        }
        None
    }

    fn position(&self, i: usize) -> u64 {
        match &self.sparse {
            Some(s) => s.positions[i],
            None => self.base + i as u64,
        }
    }

    pub fn get(&self, key: MapKey) -> Option<Value> {
        let i = self.index.get(&key)?.wrapping_sub(self.shift);
        self.entries[i as usize].as_ref().map(|e| e.1)
    }

    pub fn has(&self, key: MapKey) -> bool {
        self.index.contains_key(&key)
    }

    pub fn set(&mut self, key: MapKey, k: Value, v: Value) {
        let next = (self.entries.len() as u32).wrapping_add(self.shift);
        match self.index.entry(key) {
            std::collections::hash_map::Entry::Occupied(i) => {
                if let Some(e) = &mut self.entries[i.get().wrapping_sub(self.shift) as usize] {
                    e.1 = v;
                }
            }
            std::collections::hash_map::Entry::Vacant(slot) => {
                slot.insert(next);
                let k = if let Value::Num(n) = k {
                    Value::Num(if n == 0.0 { 0.0 } else { n })
                } else {
                    k
                };
                self.entries.push(Some((k, v)));
                if let Some(s) = &mut self.sparse {
                    s.positions.push(s.next);
                    s.next += 1;
                }
                self.live += 1;
            }
        }
    }

    pub fn delete(&mut self, key: MapKey) -> bool {
        let Some(i) = self.index.remove(&key) else {
            return false;
        };
        self.entries[i.wrapping_sub(self.shift) as usize] = None;
        self.live -= 1;
        if self.entries.len() - self.live > self.live.max(32) {
            self.compact();
        }
        true
    }

    /// Entries added after a `clear()` follow every position handed out before it, so iterators continue with them.
    pub fn clear(&mut self) {
        let end = self.end();
        self.entries.clear();
        self.index.clear();
        self.live = 0;
        self.place(Vec::new(), end);
    }

    /// Drops the tombstones, keeping each survivor's logical position: those in front alone if few are left behind
    /// them, which moves the rest down without touching the index.
    #[inline(never)]
    fn compact(&mut self) {
        let end = self.end();
        let front = self.entries.iter().take_while(|e| e.is_none()).count();
        if self.entries.len() - self.live - front <= self.live.max(32) / 2 {
            self.entries.drain(..front);
            self.shift = self.shift.wrapping_add(front as u32);
            match self.sparse.take() {
                Some(mut s) => {
                    s.positions.drain(..front);
                    self.place(s.positions, end);
                }
                None => self.base += front as u64,
            }
            return;
        }
        let old = self.sparse.take();
        let mut slots = vec![0; self.entries.len()];
        let mut positions = Vec::with_capacity(self.live);
        let mut kept = 0;
        for i in 0..self.entries.len() {
            slots[i] = kept as u32;
            if let Some(e) = self.entries[i] {
                self.entries[kept] = Some(e);
                positions.push(match &old {
                    Some(old) => old.positions[i],
                    None => self.base + i as u64,
                });
                kept += 1;
            }
        }
        self.entries.truncate(kept);
        for i in self.index.values_mut() {
            *i = slots[i.wrapping_sub(self.shift) as usize];
        }
        self.shift = 0;
        self.place(positions, end);
    }

    /// Gives the entries these increasing logical positions, below `end`, the position the next insert gets.
    fn place(&mut self, positions: Vec<u64>, end: u64) {
        match positions.first() {
            None => {
                self.base = end;
                self.sparse = None;
            }
            Some(&first) if first + positions.len() as u64 == end => {
                self.base = first;
                self.sparse = None;
            }
            Some(_) => {
                self.sparse = Some(Sparse {
                    positions,
                    next: end,
                })
            }
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum IterKind {
    Keys,
    Values,
    Entries,
}

pub enum GenState {
    /// Not running: its frame and its own value stack.
    Suspended(Box<SavedFrame>),
    /// Running on its own stack; the box holds the stack of whoever resumed it, until it yields or finishes.
    Running(Box<SavedFrame>),
    Done,
}

/// An async generator: its body, where it is, and the requests waiting for it.
pub struct AsyncGen {
    pub state: GenState,
    pub phase: AsyncPhase,
    pub queue: std::collections::VecDeque<AsyncRequest>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum AsyncPhase {
    Start,
    /// Suspended at a `yield`, waiting for a request.
    Yield,
    /// Running, or suspended at an `await` inside its body.
    Executing,
    /// Settling a `return` request after the body ended.
    AwaitingReturn,
    Completed,
}

/// A `next`, `throw` or `return` (0, 1, 2) request and the promise it answers.
pub struct AsyncRequest {
    pub kind: u8,
    pub value: Value,
    pub promise: Id,
}

pub enum Kind {
    Ordinary,
    Array(Vec<Value>),
    Arguments(Vec<Value>),
    Closure(Box<Closure>),
    Native {
        f: NativeFn,
        data: Value,
        name: Atom,
        length: u8,
        ctor: bool,
    },
    Bound(Box<(Value, Value, Vec<Value>)>),
    Error(Option<Box<Failure>>),
    Promise(Box<PromiseData>),
    Map(Box<OrderedMap>),
    Set(Box<OrderedMap>),
    Generator(GenState),
    ArrayIter {
        target: Id,
        pos: u32,
        kind: IterKind,
    },
    MapIter {
        target: Id,
        /// The logical position to continue from (see `OrderedMap`), `u64::MAX` once done.
        pos: u64,
        kind: IterKind,
    },
    StrIter {
        s: crate::strings::StrId,
        pos: u32,
    },
    ListIter {
        items: Arc<[Value]>,
        pos: u32,
    },
    /// A path into a host namespace among the globals, the reference's `HostNamespace`.
    Namespace(NsPath),
    /// Shared state of a promise's resolve/reject pair: the promise, and whether either already ran.
    Resolvers {
        promise: Id,
        done: bool,
    },
    /// Shared state of a `Promise.all`-family combinator.
    Combinator(Box<Combinator>),
    RegExp(Box<crate::builtins::regexp::RegExpData>),
    /// A Date's time value.
    Date(f64),
    Bytes(Box<crate::builtins::bytes::Bytes>),
    TextDecoder(Box<crate::builtins::bytes::Decoder>),
    WeakMap(Box<OrderedMap>),
    WeakSet(Box<OrderedMap>),
    IterHelper(Box<crate::builtins::iterator::Helper>),
    Url(Box<crate::builtins::web::UrlData>),
    SearchParams(Box<crate::builtins::web::Params>),
    Headers(Box<crate::builtins::web::HeaderList>),
    /// A live iterator over a standard-library collection.
    /// A crossing to the host in progress (see `cross`).
    Cross(Box<crate::cross::Cross>),
    ExoticIter {
        target: Id,
        pos: u32,
        kind: IterKind,
    },
    AsyncGenerator(Box<AsyncGen>),
    /// An async iterator over a sync one, for `for await` and an async generator's `yield*`.
    AsyncFromSync {
        sync: Id,
        next: Value,
    },
    /// An object with accessors the host answers, such as a streaming response.
    /// The getter and setter of an accessor property (see `ACCESSOR`), never reachable as a value.
    Accessor(Box<Accessor>),
}

pub struct Combinator {
    pub kind: CombKind,
    pub promise: Id,
    pub values: Vec<Value>,
    pub remaining: usize,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CombKind {
    All,
    AllSettled,
    Any,
}

pub const NON_EXTENSIBLE: u8 = 1;
pub const FROZEN: u8 = 2;
pub const SEALED: u8 = 4;
/// A function whose own `name` was deleted; it reads the inherited one.
pub const NAME_DELETED: u8 = 8;
/// A function whose own `length` was deleted; it reads the inherited one.
pub const LENGTH_DELETED: u8 = 16;
/// An array too long for its items: they hold a dense prefix, and its other elements and its length are own
/// properties (see `Vm::array_len`).
pub const SPARSE: u8 = 32;
/// A built-in callback sites don't admit (the reference's `callback: false`): the `Promise` statics and `Symbol`.
pub const NOT_CALLBACK: u8 = 64;
/// A program accessor was defined here at some point (the reference's `hasProgramAccessors`): the bulk readers' cue to
/// take their slow paths.
pub const ACCESSORS: u8 = 128;

pub struct Obj {
    pub proto: Option<Id>,
    pub props: Props,
    pub kind: Kind,
    pub flags: u8,
    /// The native `JSON.stringify` walk that last visited it (`Vm::json_walk`); it fits in the padding.
    pub visit: u32,
}

impl Obj {
    pub fn new(proto: Option<Id>, kind: Kind) -> Obj {
        Obj {
            proto,
            props: Props::default(),
            kind,
            flags: 0,
            visit: 0,
        }
    }

    pub fn is_callable(&self) -> bool {
        match &self.kind {
            Kind::Closure(_) | Kind::Native { .. } | Kind::Bound(_) => true,
            Kind::Namespace(n) => !n.is_root(),
            _ => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(n: u64) -> (MapKey, Value) {
        (MapKey::Num((n as f64).to_bits()), Value::Num(n as f64))
    }

    fn num(v: Value) -> f64 {
        match v {
            Value::Num(n) => n,
            _ => unreachable!(),
        }
    }

    fn keys(m: &OrderedMap) -> Vec<f64> {
        m.iter().map(|(k, _)| num(*k)).collect()
    }

    /// A small deterministic generator.
    fn lcg(state: &mut u64) -> u64 {
        *state = state
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        *state >> 33
    }

    fn assert_bounded(m: &OrderedMap) {
        assert!(
            m.entries.len() <= m.live + m.live.max(32),
            "{} slots for {} entries",
            m.entries.len(),
            m.live
        );
    }

    #[test]
    fn churn_around_two_thousand_entries_stays_within_twice_the_live_ones() {
        // A Map deleting random keys, and a Set deleting its oldest: 400k operations each around 2,000 entries.
        let (mut map, mut set) = (OrderedMap::default(), OrderedMap::default());
        let (mut live, mut order) = (Vec::new(), std::collections::VecDeque::new());
        let mut rng = 7;
        for n in 0..200_000u64 {
            let (k, v) = key(n);
            map.set(k, v, v);
            set.set(k, v, Value::Undef);
            live.push(n);
            order.push_back(n);
            if live.len() > 2000 {
                let gone = live.swap_remove(lcg(&mut rng) as usize % live.len());
                assert!(map.delete(key(gone).0));
                assert!(set.delete(key(order.pop_front().unwrap()).0));
            }
            assert_bounded(&map);
            assert_bounded(&set);
        }
        live.sort_unstable();
        let mut got = keys(&map);
        got.sort_by(f64::total_cmp);
        assert_eq!(got, live.iter().map(|&n| n as f64).collect::<Vec<_>>());
        assert_eq!(
            keys(&set),
            order.iter().map(|&n| n as f64).collect::<Vec<_>>()
        );
        assert_eq!(map.get(key(199_999).0).map(num), Some(199_999.0));
    }

    #[test]
    fn a_permanent_first_key_with_churn_behind_it_stays_bounded() {
        let mut m = OrderedMap::default();
        let (k, v) = key(u64::MAX >> 12);
        m.set(k, v, v);
        for n in 0..400_000u64 {
            let (k, v) = key(n);
            m.set(k, v, v);
            if n >= 2000 {
                assert!(m.delete(key(n - 2000).0));
            }
            assert_bounded(&m);
        }
        assert!(m.sparse.is_some());
        let got = keys(&m);
        assert_eq!(got[0], (u64::MAX >> 12) as f64);
        assert_eq!(
            got[1..],
            (398_000..400_000).map(|n| n as f64).collect::<Vec<_>>()[..]
        );
        let mut at = 0;
        assert_eq!(m.next_entry(&mut at).map(|e| num(e.0)), Some(num(v)));
        assert_eq!(m.get(key(399_999).0).map(num), Some(399_999.0));
    }

    /// Cursors over a compacting map step exactly as over a list that only ever gains tombstones.
    #[test]
    fn cursors_follow_logical_positions_through_compaction_and_clear() {
        let mut m = OrderedMap::default();
        let mut model: Vec<Option<u64>> = Vec::new();
        let mut slot = std::collections::HashMap::new();
        let mut live = Vec::new();
        let mut cursors = [(0u64, 0usize); 4];
        let mut rng = 11;
        let mut next = 0;
        for round in 0..200_000 {
            match lcg(&mut rng) % 100 {
                0..45 => {
                    let (k, v) = key(next);
                    m.set(k, v, v);
                    slot.insert(next, model.len());
                    model.push(Some(next));
                    live.push(next);
                    next += 1;
                }
                45..90 if !live.is_empty() => {
                    let gone = live.swap_remove(lcg(&mut rng) as usize % live.len());
                    assert!(m.delete(key(gone).0));
                    model[slot.remove(&gone).unwrap()] = None;
                }
                90 if round % 7 == 0 => {
                    m.clear();
                    model.iter_mut().for_each(|e| *e = None);
                    slot.clear();
                    live.clear();
                }
                _ => {
                    let (at, i) = &mut cursors[lcg(&mut rng) as usize % 4];
                    while *i < model.len() && model[*i].is_none() {
                        *i += 1;
                    }
                    let want = model.get(*i).copied().flatten();
                    if want.is_some() {
                        *i += 1;
                    }
                    let got = m.next_entry(at).map(|e| num(e.0));
                    assert_eq!(got, want.map(|n| n as f64));
                }
            }
            assert_bounded(&m);
        }
    }
}
