//! The per-run string arena and the property-key interner.
//!
//! Strings live for the whole run, like objects, so `Value` can be `Copy`. They are immutable, except that a string
//! built by `local += x` is held only by that local until the local is read, and grows in place meanwhile.
//!
//! Concatenation results of some size are prefixes of a shared growable buffer. Appending to the string that ends
//! its buffer extends the buffer and makes a longer prefix, so `s = s + x` in a loop costs amortized linear time
//! while every earlier `s` keeps its text.
//!
//! A string that is not well-formed UTF-16 (it holds a lone surrogate) has no UTF-8 form. It keeps its code units in
//! `Strings::wtf`, and its text is a carrier: UTF-8 in which each lone surrogate is `MARK` followed by one
//! private-use character that encodes it, and a real `MARK` is doubled. The carrier is canonical, so text equality
//! is string equality and property keys work unchanged, and every allocation decodes it again, which joins a high
//! and a low surrogate brought together into their character. Code that works on code units reads `wtf` through
//! `StrRef`; text that leaves the run goes through `host_text`, where lone surrogates become U+FFFD as in UTF-8.

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
    /// When not `NO_WTF`, the text is a carrier and `Strings::wtf[wtf]` holds the code units.
    wtf: u32,
}

const NO_GROW: u32 = u32::MAX;
const NO_WTF: u32 = u32::MAX;

/// Starts an escape in a carrier text. U+10FFFF is a noncharacter, so real text almost never holds one.
pub const MARK: char = '\u{10FFFF}';
/// A lone surrogate `u` follows `MARK` as the character `PAYLOAD + (u - 0xD800)`.
const PAYLOAD: u32 = 0x10F000;
const MARK_UTF8: [u8; 4] = [0xF4, 0x8F, 0xBF, 0xBF];

/// Whether `s` holds `MARK`, so it may be a carrier.
#[inline]
pub fn has_mark(s: &str) -> bool {
    if s.is_ascii() {
        return false;
    }
    let b = s.as_bytes();
    let mut from = 0;
    while let Some(i) = b[from..].iter().position(|c| *c == 0xF4) {
        if b.get(from + i..from + i + 4) == Some(&MARK_UTF8[..]) {
            return true;
        }
        from += i + 1;
    }
    false
}

/// The text of UTF-16 code units: plain UTF-8 when they are well formed and hold no `MARK`, else the carrier.
pub fn from_units(units: &[u16]) -> String {
    let mut out = String::with_capacity(units.len());
    for r in char::decode_utf16(units.iter().copied()) {
        match r {
            Ok(MARK) => {
                out.push(MARK);
                out.push(MARK);
            }
            Ok(c) => out.push(c),
            Err(e) => {
                out.push(MARK);
                let c = PAYLOAD + (e.unpaired_surrogate() as u32 - 0xD800);
                out.push(char::from_u32(c).unwrap_or(char::REPLACEMENT_CHARACTER));
            }
        }
    }
    out
}

/// Appends a decoded character to text that becomes a string: a real `MARK` is doubled.
#[inline]
pub fn push_char(out: &mut String, c: char) {
    out.push(c);
    if c == MARK {
        out.push(MARK);
    }
}

/// The UTF-16 code units of a text, decoding a carrier.
pub fn units_of(text: &str) -> Vec<u16> {
    let mut out = Vec::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    let mut buf = [0u16; 2];
    while let Some(c) = chars.next() {
        if c == MARK {
            match chars.peek().map(|n| *n as u32) {
                Some(n) if n == MARK as u32 => {
                    chars.next();
                }
                Some(n) if (PAYLOAD..PAYLOAD + 0x800).contains(&n) => {
                    chars.next();
                    out.push((0xD800 + n - PAYLOAD) as u16);
                    continue;
                }
                _ => {}
            }
        }
        out.extend_from_slice(c.encode_utf16(&mut buf));
    }
    out
}

/// The text of the code point at byte `at` of a text: one character, or the two that escape a lone surrogate or a
/// `MARK` in a carrier.
pub fn code_point_at(text: &str, at: usize) -> Option<&str> {
    let rest = text.get(at..)?;
    let mut chars = rest.chars();
    let c = chars.next()?;
    let mut end = c.len_utf8();
    if c == MARK
        && let Some(n) = chars.next()
        && (n == MARK || (PAYLOAD..PAYLOAD + 0x800).contains(&(n as u32)))
    {
        end += n.len_utf8();
    }
    Some(&rest[..end])
}

/// Text as it leaves the run for the host, logs or UTF-8 bytes: a lone surrogate becomes U+FFFD, as `TextEncoder`
/// writes it.
pub fn host_text(s: &str) -> Cow<'_, str> {
    if !has_mark(s) {
        return Cow::Borrowed(s);
    }
    Cow::Owned(String::from_utf16_lossy(&units_of(s)))
}

/// Text from outside the run, which is plain UTF-8: a `MARK` in it is real, so it is doubled to keep it.
pub fn external_text(s: String) -> String {
    if !has_mark(&s) {
        return s;
    }
    s.replace(MARK, "\u{10FFFF}\u{10FFFF}")
}
/// Concatenations shorter than this copy into a plain string.
const GROW_MIN: usize = 64;

pub struct Strings {
    pub bufs: Vec<StrBuf>,
    grow: Vec<String>,
    wtf: Vec<Box<[u16]>>,
    map: FxHashMap<Cow<'static, str>, Atom>,
    atom_str: Vec<StrId>,
    atom_index: Vec<u32>,
}

/// A borrowed string with its ASCII flag and, for a carrier, its code units, for code-unit arithmetic.
#[derive(Clone, Copy)]
pub struct StrRef<'a> {
    pub s: &'a str,
    pub ascii: bool,
    pub units: Option<&'a [u16]>,
}

impl Strings {
    pub fn new() -> Self {
        let mut s = Strings {
            bufs: Vec::new(),
            grow: Vec::new(),
            wtf: Vec::new(),
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
        if !ascii {
            return self.alloc_wide(s);
        }
        self.push(Cow::Owned(s), ascii)
    }

    /// `alloc` for text beyond ASCII, which may be a carrier.
    #[inline(never)]
    fn alloc_wide(&mut self, s: String) -> StrId {
        if has_mark(&s) {
            return self.alloc_units(&units_of(&s));
        }
        self.push(Cow::Owned(s), false)
    }

    /// A string of UTF-16 code units, which may hold lone surrogates.
    pub fn alloc_units(&mut self, units: &[u16]) -> StrId {
        let text = from_units(units);
        if !has_mark(&text) {
            let ascii = text.is_ascii();
            return self.push(Cow::Owned(text), ascii);
        }
        let id = self.push(Cow::Owned(text), false);
        self.bufs[id as usize].wtf = self.wtf.len() as u32;
        self.wtf.push(units.into());
        id
    }

    /// Whether a string's text is a carrier.
    #[inline]
    pub fn is_wtf(&self, id: StrId) -> bool {
        self.bufs[id as usize].wtf != NO_WTF
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
            wtf: NO_WTF,
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
        // A carrier is never ASCII.
        if !ascii && parts.iter().any(|p| self.is_wtf(*p)) {
            return self.concat_wtf(parts, total);
        }
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
            wtf: NO_WTF,
        });
        (self.bufs.len() - 1) as StrId
    }

    /// `concat` with a carrier among the parts, decoded afresh so a high and a low surrogate that meet become one
    /// character.
    #[cold]
    #[inline(never)]
    fn concat_wtf(&mut self, parts: &[StrId], total: usize) -> StrId {
        let mut out = String::with_capacity(total);
        for p in parts {
            out.push_str(self.get(*p));
        }
        self.alloc(out)
    }

    /// Appends `b` to `a` itself; only for a string that nothing else can observe.
    #[inline(never)]
    pub fn push_in_place(&mut self, a: StrId, b: StrId) {
        let ascii = self.bufs[b as usize].ascii;
        if !(ascii && self.bufs[a as usize].ascii) && (self.is_wtf(a) || self.is_wtf(b)) {
            return self.push_wtf(a, b);
        }
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

    /// `push_in_place` with a carrier: the joined text is decoded afresh into `a`'s entry.
    #[cold]
    #[inline(never)]
    fn push_wtf(&mut self, a: StrId, b: StrId) {
        let joined = format!("{}{}", self.get(a), self.get(b));
        let made = self.alloc(joined);
        let builder = self.bufs[a as usize].builder;
        if let Some(mut entry) = self.bufs.pop().filter(|_| made as usize == self.bufs.len()) {
            entry.builder = builder;
            self.bufs[a as usize] = entry;
        }
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
        let b = &self.bufs[id as usize];
        StrRef {
            s: self.get(id),
            ascii: b.ascii,
            units: (b.wtf != NO_WTF).then(|| &*self.wtf[b.wtf as usize]),
        }
    }

    pub fn intern(&mut self, s: &str) -> Atom {
        if let Some(a) = self.map.get(s) {
            return *a;
        }
        if has_mark(s) {
            // Keyed by the canonical carrier the string gets.
            let id = self.alloc(s.to_owned());
            return self.intern_id(id);
        }
        let id = self.alloc(s.to_owned());
        self.insert_atom(Cow::Owned(s.to_owned()), id)
    }

    /// The atom for `s` if one was ever made; no object can have a key that has no atom.
    pub fn lookup(&self, s: &str) -> Option<Atom> {
        self.map.get(s).copied()
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
        match self.units {
            Some(u) => u.len(),
            None if self.ascii => self.s.len(),
            None => self.s.encode_utf16().count(),
        }
    }

    pub fn utf16(self) -> Vec<u16> {
        match self.units {
            Some(u) => u.to_vec(),
            None => self.s.encode_utf16().collect(),
        }
    }

    /// The code units one by one.
    pub fn iter16(self) -> Units16<'a> {
        match self.units {
            Some(u) => Units16::Units(u.iter()),
            None => Units16::Text(self.s.encode_utf16()),
        }
    }

    pub fn code_unit(self, i: usize) -> Option<u16> {
        match self.units {
            Some(u) => u.get(i).copied(),
            None if self.ascii => self.s.as_bytes().get(i).map(|b| *b as u16),
            None => self.s.encode_utf16().nth(i),
        }
    }

    /// Whether the string is well-formed UTF-16: it holds no lone surrogate.
    pub fn well_formed(self) -> bool {
        self.units
            .is_none_or(|u| char::decode_utf16(u.iter().copied()).all(|r| r.is_ok()))
    }

    /// The code units `start..end` (clamped), as text: a slice that cuts a pair holds a lone surrogate.
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
            from_units(&units[s..e])
        }
    }

    /// Compares by UTF-16 code units, as JavaScript orders strings.
    pub fn cmp16(self, other: StrRef) -> std::cmp::Ordering {
        if self.ascii && other.ascii {
            return self.s.cmp(other.s);
        }
        self.iter16().cmp(other.iter16())
    }
}

/// The code units of a `StrRef`.
pub enum Units16<'a> {
    Units(std::slice::Iter<'a, u16>),
    Text(std::str::EncodeUtf16<'a>),
}

impl Iterator for Units16<'_> {
    type Item = u16;

    #[inline]
    fn next(&mut self) -> Option<u16> {
        match self {
            Units16::Units(u) => u.next().copied(),
            Units16::Text(t) => t.next(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn carriers_round_trip_code_units() {
        let cases: [&[u16]; 6] = [
            &[0x61, 0xd800, 0x62],
            &[0xdc00, 0xd800],
            &[0xd83d, 0xde00],
            &[0xdbff, 0xdfff, 0xd800],
            &[0xdbff, 0xdfff],
            &[],
        ];
        for units in cases {
            let text = from_units(units);
            assert_eq!(units_of(&text), units);
        }
        assert!(!has_mark(&from_units(&[0xd83d, 0xde00])));
        assert!(has_mark(&from_units(&[0xdbff, 0xdfff])));
    }

    #[test]
    fn allocation_joins_surrogates_that_meet() {
        let mut s = Strings::new();
        let (h, l) = (s.alloc_units(&[0xd83d]), s.alloc_units(&[0xde00]));
        assert!(s.is_wtf(h) && s.is_wtf(l));
        let joined = s.concat(&[h, l]);
        assert!(!s.is_wtf(joined));
        assert_eq!(s.get(joined), "\u{1f600}");
        let back = s.concat(&[l, h]);
        assert_eq!(s.sref(back).utf16(), [0xde00, 0xd83d]);
        assert_eq!(host_text(s.get(back)), "\u{fffd}\u{fffd}");
    }

    #[test]
    fn external_marks_stay_one_code_point() {
        let mut s = Strings::new();
        let id = s.alloc(external_text("\u{10ffff}".to_owned()));
        assert_eq!(s.sref(id).utf16(), [0xdbff, 0xdfff]);
        assert_eq!(host_text(s.get(id)), "\u{10ffff}");
    }
}
