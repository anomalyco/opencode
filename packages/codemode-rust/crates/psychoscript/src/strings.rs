//! The per-run string arena and the property-key interner.
//!
//! Strings live for the whole run, like objects, so `Value` can be `Copy`. They are immutable, except that a string
//! built by `local += x` is held only by that local until the local is read, and grows in place meanwhile.

use std::borrow::Cow;

use rustc_hash::FxHashMap;

use crate::value::index_of_key;

pub type StrId = u32;
/// An interned property key.
pub type Atom = u32;

/// The atom of `Symbol.iterator`, unreachable from strings.
pub const SYM_ITERATOR: Atom = 0;

pub struct StrBuf {
    /// Built-in names borrow their static text, so setting up a run allocates little.
    pub s: Cow<'static, str>,
    pub ascii: bool,
    /// Only one local slot holds this string, so `+=` may append in place.
    pub builder: bool,
}

pub struct Strings {
    pub bufs: Vec<StrBuf>,
    map: FxHashMap<Cow<'static, str>, Atom>,
    atom_str: Vec<StrId>,
    atom_index: Vec<u32>,
}

/// A borrowed string with its ASCII flag, for code-unit arithmetic.
#[derive(Clone, Copy)]
pub struct StrRef<'a> {
    pub s: &'a str,
    pub ascii: bool,
}

impl Strings {
    pub fn new() -> Self {
        let mut s = Strings {
            bufs: Vec::new(),
            map: FxHashMap::default(),
            atom_str: Vec::new(),
            atom_index: Vec::new(),
        };
        let id = s.alloc("Symbol(Symbol.iterator)".to_owned());
        s.atom_str.push(id);
        s.atom_index.push(u32::MAX);
        s
    }

    #[inline]
    pub fn alloc(&mut self, s: String) -> StrId {
        let ascii = s.is_ascii();
        self.bufs.push(StrBuf {
            s: Cow::Owned(s),
            ascii,
            builder: false,
        });
        (self.bufs.len() - 1) as StrId
    }

    pub fn alloc_static(&mut self, s: &'static str) -> StrId {
        self.bufs.push(StrBuf {
            s: Cow::Borrowed(s),
            ascii: s.is_ascii(),
            builder: false,
        });
        (self.bufs.len() - 1) as StrId
    }

    #[inline]
    pub fn get(&self, id: StrId) -> &str {
        &self.bufs[id as usize].s
    }

    #[inline]
    pub fn sref(&self, id: StrId) -> StrRef<'_> {
        let b = &self.bufs[id as usize];
        StrRef {
            s: &b.s,
            ascii: b.ascii,
        }
    }

    pub fn intern(&mut self, s: &str) -> Atom {
        if let Some(a) = self.map.get(s) {
            return *a;
        }
        let id = self.alloc(s.to_owned());
        self.insert_atom(Cow::Owned(s.to_owned()), id)
    }

    pub fn intern_static(&mut self, s: &'static str) -> Atom {
        if let Some(a) = self.map.get(s) {
            return *a;
        }
        let id = self.alloc_static(s);
        self.insert_atom(Cow::Borrowed(s), id)
    }

    pub fn intern_id(&mut self, id: StrId) -> Atom {
        if let Some(a) = self.map.get(&*self.bufs[id as usize].s) {
            return *a;
        }
        let text = self.bufs[id as usize].s.clone();
        self.insert_atom(text, id)
    }

    fn insert_atom(&mut self, s: Cow<'static, str>, id: StrId) -> Atom {
        let a = self.atom_str.len() as Atom;
        self.atom_str.push(id);
        self.atom_index.push(index_of_key(&s).unwrap_or(u32::MAX));
        self.map.insert(s, a);
        a
    }

    /// The string value of an atom.
    #[inline]
    pub fn atom_str(&self, a: Atom) -> StrId {
        self.atom_str[a as usize]
    }

    #[inline]
    pub fn text(&self, a: Atom) -> &str {
        self.get(self.atom_str[a as usize])
    }

    /// The array index an atom names, if it is canonical.
    #[inline]
    pub fn index(&self, a: Atom) -> Option<u32> {
        let i = self.atom_index[a as usize];
        if i == u32::MAX { None } else { Some(i) }
    }
}

impl<'a> StrRef<'a> {
    /// Length in UTF-16 code units, as JavaScript counts it.
    pub fn len16(self) -> usize {
        if self.ascii {
            self.s.len()
        } else {
            self.s.encode_utf16().count()
        }
    }

    pub fn utf16(self) -> Vec<u16> {
        self.s.encode_utf16().collect()
    }

    pub fn code_unit(self, i: usize) -> Option<u16> {
        if self.ascii {
            self.s.as_bytes().get(i).map(|b| *b as u16)
        } else {
            self.s.encode_utf16().nth(i)
        }
    }

    /// The code units `start..end` (clamped).
    pub fn slice16(self, start: usize, end: usize) -> String {
        if self.ascii {
            let len = self.s.len();
            let (s, e) = (start.min(len), end.min(len));
            return if s >= e {
                String::new()
            } else {
                self.s[s..e].to_owned()
            };
        }
        let units = self.utf16();
        let (s, e) = (start.min(units.len()), end.min(units.len()));
        if s >= e {
            String::new()
        } else {
            String::from_utf16_lossy(&units[s..e])
        }
    }

    /// Compares by UTF-16 code units, as JavaScript orders strings.
    pub fn cmp16(self, other: StrRef) -> std::cmp::Ordering {
        if self.ascii && other.ascii {
            return self.s.cmp(other.s);
        }
        self.s.encode_utf16().cmp(other.s.encode_utf16())
    }
}
