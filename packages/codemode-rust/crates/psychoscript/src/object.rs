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

/// Insertion-ordered hash map with tombstones, so iterators stay valid across deletes.
#[derive(Default)]
pub struct OrderedMap {
    pub entries: Vec<Option<(Value, Value)>>,
    index: FxHashMap<MapKey, u32>,
    pub live: usize,
}

impl OrderedMap {
    /// A map with these entries, tombstones (`None`) included, as a snapshot saved it.
    pub fn restore(entries: Vec<Option<(Value, Value)>>, keys: Vec<Option<MapKey>>) -> Self {
        let mut index = FxHashMap::default();
        let mut live = 0;
        for (i, k) in keys.into_iter().enumerate() {
            if let Some(k) = k {
                index.insert(k, i as u32);
                live += 1;
            }
        }
        OrderedMap {
            entries,
            index,
            live,
        }
    }

    pub fn get(&self, key: MapKey) -> Option<Value> {
        let i = *self.index.get(&key)?;
        self.entries[i as usize].as_ref().map(|e| e.1)
    }

    pub fn has(&self, key: MapKey) -> bool {
        self.index.contains_key(&key)
    }

    pub fn set(&mut self, key: MapKey, k: Value, v: Value) {
        let next = self.entries.len() as u32;
        match self.index.entry(key) {
            std::collections::hash_map::Entry::Occupied(i) => {
                if let Some(e) = &mut self.entries[*i.get() as usize] {
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
                self.live += 1;
            }
        }
    }

    pub fn delete(&mut self, key: MapKey) -> bool {
        match self.index.remove(&key) {
            Some(i) => {
                self.entries[i as usize] = None;
                self.live -= 1;
                true
            }
            None => false,
        }
    }

    pub fn clear(&mut self) {
        self.entries.fill(None);
        self.index.clear();
        self.live = 0;
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
        pos: u32,
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
    Live(Box<crate::streaming::Live>),
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
