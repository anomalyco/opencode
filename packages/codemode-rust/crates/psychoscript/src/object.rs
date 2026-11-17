//! Heap objects, property storage and the atom interner.

use std::rc::Rc;

use rustc_hash::FxHashMap;

use crate::DiagnosticKind;
use crate::bytecode::FuncProto;
pub use crate::strings::{Atom, SYM_ITERATOR};
use crate::value::{Id, Value};
use crate::vm::{NativeFn, SavedFrame};

pub const ENUMERABLE: u8 = 1;
pub const WRITABLE: u8 = 2;
pub const DEFAULT_FLAGS: u8 = ENUMERABLE | WRITABLE;
pub const HIDDEN: u8 = WRITABLE;

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

/// A failure the interpreter or host raised, kept on the error object so a rethrow reports the same diagnostic.
#[derive(Clone, Debug)]
pub struct Failure {
    pub kind: DiagnosticKind,
    pub message: String,
    /// Source offset of the instruction that raised it, filled in when first thrown.
    pub offset: Option<u32>,
}

pub struct Closure {
    pub proto: Rc<FuncProto>,
    pub upvals: Rc<[u32]>,
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
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub enum MapKey {
    Undef,
    Null,
    Bool(bool),
    Num(u64),
    Str(Atom),
    Obj(Id),
    Sym(u32),
}

/// Insertion-ordered hash map with tombstones, so iterators stay valid across deletes.
#[derive(Default)]
pub struct OrderedMap {
    pub entries: Vec<Option<(Value, Value)>>,
    index: FxHashMap<MapKey, u32>,
    pub live: usize,
}

impl OrderedMap {
    pub fn get(&self, key: MapKey) -> Option<Value> {
        let i = *self.index.get(&key)?;
        self.entries[i as usize].as_ref().map(|e| e.1)
    }

    pub fn has(&self, key: MapKey) -> bool {
        self.index.contains_key(&key)
    }

    pub fn set(&mut self, key: MapKey, k: Value, v: Value) {
        if let Some(i) = self.index.get(&key) {
            if let Some(e) = &mut self.entries[*i as usize] {
                e.1 = v;
            }
            return;
        }
        let k = if let Value::Num(n) = k {
            Value::Num(if n == 0.0 { 0.0 } else { n })
        } else {
            k
        };
        self.index.insert(key, self.entries.len() as u32);
        self.entries.push(Some((k, v)));
        self.live += 1;
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
    Suspended(Box<SavedFrame>),
    /// Running, holding the emptied box its frame came from.
    Running(Option<Box<SavedFrame>>),
    Done,
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
        items: Rc<[Value]>,
        pos: u32,
    },
    ToolRef(Rc<str>),
    /// Shared state of a promise's resolve/reject pair: the promise, and whether either already ran.
    Resolvers {
        promise: Id,
        done: bool,
    },
    /// Shared state of a `Promise.all`-family combinator.
    Combinator(Box<Combinator>),
    /// A generator `return()` travelling through `finally` blocks.
    ReturnSignal(Value),
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

pub struct Obj {
    pub proto: Option<Id>,
    pub props: Props,
    pub kind: Kind,
    pub flags: u8,
}

impl Obj {
    pub fn new(proto: Option<Id>, kind: Kind) -> Obj {
        Obj {
            proto,
            props: Props::default(),
            kind,
            flags: 0,
        }
    }

    pub fn is_callable(&self) -> bool {
        match &self.kind {
            Kind::Closure(_) | Kind::Native { .. } | Kind::Bound(_) => true,
            Kind::ToolRef(p) => !p.is_empty(),
            _ => false,
        }
    }
}
