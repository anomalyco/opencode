//! The per-run string arena and the property-key interner.
//!
//! Strings live for the whole run, like objects, so `Value` can be `Copy`. They are immutable, except that a string
//! built by `local += x` is held only by that local until the local is read, and grows in place meanwhile.
//!
//! Concatenation results of some size are prefixes of a shared growable buffer. Appending to the string that ends
//! its buffer extends the buffer and makes a longer prefix, so `s = s + x` in a loop costs amortized linear time
//! while every earlier `s` keeps its text.

use std::borrow::Cow;

use rustc_hash::FxHashMap;

use crate::value::index_of_key;

pub type StrId = u32;
/// An interned property key.
pub type Atom = u32;

/// The atom of `Symbol.iterator`, unreachable from strings.
pub const SYM_ITERATOR: Atom = 0;
/// The atom of `Symbol.asyncIterator`, unreachable from strings.
pub const SYM_ASYNC_ITERATOR: Atom = 1;

pub struct StrBuf {
    /// Built-in names borrow their static text, so setting up a run allocates little.
    pub s: Cow<'static, str>,
    pub ascii: bool,
    /// Only one local slot holds this string, so `+=` may append in place.
    pub builder: bool,
    /// When not `NO_GROW`, the text is the first `len` bytes of `Strings::grow[grow]` rather than `s`.
    grow: u32,
    len: u32,
}

const NO_GROW: u32 = u32::MAX;
/// Concatenations shorter than this copy into a plain string.
const GROW_MIN: usize = 64;

pub struct Strings {
    pub bufs: Vec<StrBuf>,
    grow: Vec<String>,
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
            grow: Vec::new(),
            map: FxHashMap::default(),
            atom_str: Vec::new(),
            atom_index: Vec::new(),
        };
        for name in ["Symbol(Symbol.iterator)", "Symbol(Symbol.asyncIterator)"] {
            let id = s.alloc_static(name);
            s.atom_str.push(id);
            s.atom_index.push(u32::MAX);
        }
        s
    }

    #[inline]
    pub fn alloc(&mut self, s: String) -> StrId {
        let ascii = s.is_ascii();
        self.push(Cow::Owned(s), ascii)
    }

    pub fn alloc_static(&mut self, s: &'static str) -> StrId {
        self.push(Cow::Borrowed(s), s.is_ascii())
    }

    fn push(&mut self, s: Cow<'static, str>, ascii: bool) -> StrId {
        self.bufs.push(StrBuf {
            s,
            ascii,
            builder: false,
            grow: NO_GROW,
            len: 0,
        });
        (self.bufs.len() - 1) as StrId
    }

    #[inline]
    pub fn get(&self, id: StrId) -> &str {
        let b = &self.bufs[id as usize];
        if b.grow == NO_GROW {
            return &b.s;
        }
        self.grow[b.grow as usize]
            .get(..b.len as usize)
            .unwrap_or_default()
    }

    /// The concatenation of `parts`, which must not be empty. Extends the first part's buffer when it ends there.
    pub fn concat(&mut self, parts: &[StrId]) -> StrId {
        let Some((&first, rest)) = parts.split_first() else {
            return self.alloc_static("");
        };
        let total: usize = parts.iter().map(|p| self.get(*p).len()).sum();
        let ascii = parts.iter().all(|p| self.bufs[*p as usize].ascii);
        let f = &self.bufs[first as usize];
        let g = if f.grow != NO_GROW && self.grow[f.grow as usize].len() == f.len as usize {
            f.grow as usize
        } else if total >= GROW_MIN {
            let mut buf = String::with_capacity(total * 2);
            buf.push_str(self.get(first));
            self.grow.push(buf);
            self.grow.len() - 1
        } else {
            let mut out = String::with_capacity(total);
            for p in parts {
                out.push_str(self.get(*p));
            }
            return self.push(Cow::Owned(out), ascii);
        };
        let mut buf = std::mem::take(&mut self.grow[g]);
        for p in rest {
            self.append_to(&mut buf, g, *p);
        }
        let len = buf.len() as u32;
        self.grow[g] = buf;
        self.bufs.push(StrBuf {
            s: Cow::Borrowed(""),
            ascii,
            builder: false,
            grow: g as u32,
            len,
        });
        (self.bufs.len() - 1) as StrId
    }

    /// Appends `b` to `a` itself; only for a string that nothing else can observe.
    pub fn push_in_place(&mut self, a: StrId, b: StrId) {
        let ascii = self.bufs[b as usize].ascii;
        let ab = &self.bufs[a as usize];
        if ab.grow == NO_GROW {
            let mut s = std::mem::take(&mut self.bufs[a as usize].s);
            s.to_mut().push_str(self.get(b));
            let entry = &mut self.bufs[a as usize];
            entry.s = s;
            entry.ascii &= ascii;
            return;
        }
        let g = ab.grow as usize;
        if self.grow[g].len() != ab.len as usize {
            let mut s = String::with_capacity(ab.len as usize * 2);
            s.push_str(self.get(a));
            self.grow.push(s);
            self.bufs[a as usize].grow = (self.grow.len() - 1) as u32;
            return self.push_in_place(a, b);
        }
        let mut buf = std::mem::take(&mut self.grow[g]);
        self.append_to(&mut buf, g, b);
        let entry = &mut self.bufs[a as usize];
        entry.len = buf.len() as u32;
        entry.ascii &= ascii;
        self.grow[g] = buf;
    }

    /// Appends the text of `p` to `buf`, which was taken out of `grow[g]`.
    fn append_to(&self, buf: &mut String, g: usize, p: StrId) {
        let pb = &self.bufs[p as usize];
        if pb.grow as usize == g {
            buf.extend_from_within(..pb.len as usize);
        } else {
            buf.push_str(self.get(p));
        }
    }

    #[inline]
    pub fn sref(&self, id: StrId) -> StrRef<'_> {
        StrRef {
            s: self.get(id),
            ascii: self.bufs[id as usize].ascii,
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
        if let Some(a) = self.map.get(self.get(id)) {
            return *a;
        }
        let b = &self.bufs[id as usize];
        let text = if b.grow == NO_GROW {
            b.s.clone()
        } else {
            Cow::Owned(self.get(id).to_owned())
        };
        self.insert_atom(text, id)
    }

    /// How many strings and atoms there are, for a snapshot's base.
    pub(crate) fn counts(&self) -> (usize, usize) {
        (self.bufs.len(), self.atom_str.len())
    }

    /// The strings and atoms made after the given counts: each string's text and builder flag, and each atom's
    /// string.
    pub(crate) fn save_from(&self, bufs: usize, atoms: usize) -> (Vec<(String, bool)>, Vec<StrId>) {
        let texts = (bufs..self.bufs.len())
            .map(|i| (self.get(i as StrId).to_owned(), self.bufs[i].builder))
            .collect();
        (texts, self.atom_str[atoms..].to_vec())
    }

    /// Appends saved strings and atoms after the base this table has.
    pub(crate) fn restore(
        &mut self,
        texts: Vec<(String, bool)>,
        atoms: Vec<StrId>,
    ) -> Result<(), String> {
        for (text, builder) in texts {
            let id = self.alloc(text);
            self.bufs[id as usize].builder = builder;
        }
        for id in atoms {
            if id as usize >= self.bufs.len() {
                return Err(format!("atom string {id} does not exist"));
            }
            let text = self.get(id).to_owned();
            if self.map.contains_key(text.as_str()) {
                return Err(format!("atom {text:?} is saved twice"));
            }
            self.insert_atom(Cow::Owned(text), id);
        }
        Ok(())
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
