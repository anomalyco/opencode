//! Syntax errors of regular expression patterns as the reference's host reports them: a port of the checks in
//! JavaScriptCore's `YarrParser` (the version Bun ships), which finds the first error in the order that parser meets
//! it. `regress` compiles the pattern afterwards; it accepts a few patterns JavaScriptCore rejects (such as `\b*`)
//! and words its errors differently, so the reference's error and wording come from here.

use std::collections::HashSet;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mode {
    Legacy,
    Unicode,
    UnicodeSets,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Code {
    PatternTooLarge,
    QuantifierOutOfOrder,
    QuantifierWithoutAtom,
    QuantifierTooLarge,
    QuantifierIncomplete,
    CantQuantifyAtom,
    MissingParentheses,
    BracketUnmatched,
    ParenthesesUnmatched,
    ParenthesesTypeInvalid,
    InvalidGroupName,
    DuplicateGroupName,
    CharacterClassUnmatched,
    CharacterClassRangeOutOfOrder,
    CharacterClassRangeInvalid,
    ClassStringDisjunctionUnmatched,
    EscapeUnterminated,
    InvalidUnicodeEscape,
    InvalidUnicodeCodePointEscape,
    InvalidBackreference,
    InvalidNamedBackReference,
    InvalidIdentityEscape,
    InvalidOctalEscape,
    InvalidControlLetterEscape,
    InvalidUnicodePropertyExpression,
    InvalidClassSetOperation,
    NegatedClassSetMayContainStrings,
    InvalidClassSetCharacter,
    InvalidRegularExpressionModifier,
    TooManyCaptures,
}

impl Code {
    /// The message JavaScriptCore gives, without its "Invalid regular expression: " prefix.
    pub fn message(self) -> &'static str {
        match self {
            Code::PatternTooLarge => "regular expression too large",
            Code::QuantifierOutOfOrder => "numbers out of order in {} quantifier",
            Code::QuantifierWithoutAtom => "nothing to repeat",
            Code::QuantifierTooLarge => "number too large in {} quantifier",
            Code::QuantifierIncomplete => "incomplete {} quantifier for Unicode pattern",
            Code::CantQuantifyAtom => "invalid quantifier",
            Code::MissingParentheses => "missing )",
            Code::BracketUnmatched => "unmatched ] or } bracket for Unicode pattern",
            Code::ParenthesesUnmatched => "unmatched parentheses",
            Code::ParenthesesTypeInvalid => "unrecognized character after (?",
            Code::InvalidGroupName => "invalid group specifier name",
            Code::DuplicateGroupName => "duplicate group specifier name",
            Code::CharacterClassUnmatched => "missing terminating ] for character class",
            Code::CharacterClassRangeOutOfOrder => "range out of order in character class",
            Code::CharacterClassRangeInvalid => {
                "invalid range in character class for Unicode pattern"
            }
            Code::ClassStringDisjunctionUnmatched => {
                "missing terminating } for class string disjunction"
            }
            Code::EscapeUnterminated => "\\ at end of pattern",
            Code::InvalidUnicodeEscape => "invalid Unicode \\u escape",
            Code::InvalidUnicodeCodePointEscape => "invalid Unicode code point \\u{} escape",
            Code::InvalidBackreference => "invalid backreference for Unicode pattern",
            Code::InvalidNamedBackReference => "invalid \\k<> named backreference",
            Code::InvalidIdentityEscape => "invalid escaped character for Unicode pattern",
            Code::InvalidOctalEscape => "invalid octal escape for Unicode pattern",
            Code::InvalidControlLetterEscape => "invalid \\c escape for Unicode pattern",
            Code::InvalidUnicodePropertyExpression => "invalid property expression",
            Code::InvalidClassSetOperation => "invalid operation in class set",
            Code::NegatedClassSetMayContainStrings => "negated class set may contain strings",
            Code::InvalidClassSetCharacter => "invalid class set character",
            Code::InvalidRegularExpressionModifier => "invalid regular expression modifier",
            Code::TooManyCaptures => "too many captures",
        }
    }
}

/// What the parser asks about Unicode, answered by the engine that runs the pattern.
pub trait Unicode {
    /// Whether `\p{expression}` names a property in this mode, and if so whether it may match strings.
    fn property(&self, expression: &str, mode: Mode) -> Option<bool>;
    /// Whether a code point may start (`start`) or continue a group name, beyond ASCII.
    fn identifier(&self, ch: u32, start: bool) -> bool;
}

/// The first syntax error of `pattern` (UTF-16 code units) in `mode`, as JavaScriptCore finds it.
pub fn check(pattern: &[u16], mode: Mode, unicode: &dyn Unicode) -> Option<Code> {
    if pattern.len() > MAX_PATTERN {
        return Some(Code::PatternTooLarge);
    }
    let mut p = Parser {
        data: pattern,
        i: 0,
        mode,
        unicode,
        error: None,
        back_reference_limit: u32::MAX,
        subpatterns: 0,
        max_back_reference: 0,
        captures: 0,
        named_forward_allowed: true,
        k_identity_seen: false,
        parens: Vec::new(),
        names: Names::new(),
        forward_names: HashSet::new(),
    };
    p.tokens();
    if p.error.is_none() {
        p.illegal_references();
    }
    p.error
}

const MAX_PATTERN: usize = 1024 * 1024;
const MAX_CAPTURES: u32 = (1 << 16) / 2;
const INFINITE: u64 = u32::MAX as u64;
const NO_CHAR: u32 = u32::MAX;

#[derive(Clone, Copy, PartialEq)]
enum Token {
    NotAtom,
    Atom,
    Lookbehind,
    SetDisjunction,
    SetDisjunctionStrings,
}

#[derive(Clone, Copy, PartialEq)]
enum Escape {
    Normal,
    Class,
    ClassSet,
    StringDisjunction,
}

#[derive(Clone, Copy, PartialEq)]
enum Paren {
    Subpattern,
    Assertion,
    Lookbehind,
}

/// Named groups seen so far: a name may repeat only in another alternative.
struct Names {
    all: HashSet<Vec<u32>>,
    nested: Vec<HashSet<Vec<u32>>>,
    active: Vec<HashSet<Vec<u32>>>,
}

impl Names {
    fn new() -> Names {
        Names {
            all: HashSet::new(),
            nested: vec![HashSet::new()],
            active: vec![HashSet::new()],
        }
    }

    fn next_alternative(&mut self) {
        let done = std::mem::take(self.active.last_mut().expect("a scope"));
        self.nested.last_mut().expect("a scope").extend(done);
        let n = self.active.len();
        if n > 1 {
            let outer = self.active[n - 2].clone();
            self.active[n - 1].extend(outer);
        }
    }

    fn push(&mut self) {
        let top = self.active.last().cloned().unwrap_or_default();
        self.nested.push(HashSet::new());
        self.active.push(top);
    }

    fn pop(&mut self) {
        let (Some(mut nested), Some(active)) = (self.nested.pop(), self.active.pop()) else {
            return;
        };
        nested.extend(active);
        if let Some(outer) = self.active.last_mut() {
            outer.extend(nested);
        }
    }

    /// Adds a name; false when it is already active in this alternative.
    fn add(&mut self, name: Vec<u32>) -> bool {
        self.all.insert(name.clone());
        self.active.last_mut().is_some_and(|a| a.insert(name))
    }
}

struct Parser<'a> {
    data: &'a [u16],
    i: usize,
    mode: Mode,
    unicode: &'a dyn Unicode,
    error: Option<Code>,
    back_reference_limit: u32,
    subpatterns: u32,
    max_back_reference: u32,
    captures: u32,
    named_forward_allowed: bool,
    k_identity_seen: bool,
    parens: Vec<Paren>,
    names: Names,
    forward_names: HashSet<Vec<u32>>,
}

/// What an escape adds to the construct it is in.
enum Item {
    Char(u32),
    Class { strings: bool },
    Other,
}

impl Parser<'_> {
    fn set(&mut self, code: Code) {
        self.error = Some(code);
    }

    fn failed(&self) -> bool {
        self.error.is_some()
    }

    fn unicode_mode(&self) -> bool {
        self.mode != Mode::Legacy
    }

    fn at_end(&self) -> bool {
        self.i >= self.data.len()
    }

    fn peek(&self) -> u32 {
        self.data.get(self.i).map_or(0, |c| *c as u32)
    }

    fn peek_is_digit(&self) -> bool {
        !self.at_end() && (b'0' as u32..=b'9' as u32).contains(&self.peek())
    }

    fn consume(&mut self) -> u32 {
        let c = self.peek();
        self.i += 1;
        c
    }

    fn try_consume(&mut self, c: u8) -> bool {
        if !self.at_end() && self.peek() == c as u32 {
            self.i += 1;
            return true;
        }
        false
    }

    fn consume_number(&mut self) -> u64 {
        let mut n: u64 = 0;
        let mut overflow = false;
        while self.peek_is_digit() {
            let d = (self.consume() - b'0' as u32) as u64;
            match n.checked_mul(10).and_then(|n| n.checked_add(d)) {
                Some(v) => n = v,
                None => overflow = true,
            }
        }
        if overflow { u64::MAX } else { n }
    }

    fn try_consume_hex(&mut self, count: usize) -> u32 {
        let start = self.i;
        let mut n = 0u32;
        for _ in 0..count {
            match char::from_u32(self.peek()).and_then(|c| c.to_digit(16)) {
                Some(d) if !self.at_end() => {
                    self.i += 1;
                    n = (n << 4) | d;
                }
                _ => {
                    self.i = start;
                    return NO_CHAR;
                }
            }
        }
        n
    }

    fn consume_possible_pair(&mut self, group_name: bool) -> u32 {
        let ch = self.consume();
        if (0xD800..0xDC00).contains(&ch) && (self.unicode_mode() || group_name) && !self.at_end() {
            let low = self.peek();
            if (0xDC00..0xE000).contains(&low) {
                self.i += 1;
                return 0x10000 + ((ch - 0xD800) << 10) + (low - 0xDC00);
            }
        }
        ch
    }

    fn identity_escape_error(&mut self, ch: u32, mode: Escape) -> bool {
        if !self.unicode_mode() {
            return false;
        }
        let allowed: &[u8] = if matches!(mode, Escape::ClassSet | Escape::StringDisjunction) {
            b"^$\\.*+?()[]{}|/&-!#%,:;<=>@`~"
        } else {
            b"^$\\.*+?()[]{}|/"
        };
        if ch == 0 || (ch < 128 && !allowed.contains(&(ch as u8))) {
            self.set(Code::InvalidIdentityEscape);
            return true;
        }
        false
    }

    // ---------- tokens ----------

    fn tokens(&mut self) {
        let mut last = Token::NotAtom;
        while !self.at_end() {
            match self.peek() {
                0x7C => {
                    self.consume();
                    last = Token::NotAtom;
                    self.names.next_alternative();
                }
                0x28 => {
                    self.parentheses_begin();
                    last = Token::NotAtom;
                }
                0x29 => last = self.parentheses_end(),
                0x5E | 0x24 => {
                    self.consume();
                    last = Token::NotAtom;
                }
                0x2E => {
                    self.consume();
                    last = Token::Atom;
                }
                0x5B => {
                    if self.mode == Mode::UnicodeSets {
                        self.class_set();
                    } else {
                        self.character_class();
                    }
                    last = Token::Atom;
                }
                0x5D | 0x7D => {
                    if self.unicode_mode() {
                        self.set(Code::BracketUnmatched);
                    } else {
                        self.consume();
                        last = Token::Atom;
                    }
                }
                0x5C => last = self.escape(Escape::Normal).0,
                0x2A | 0x2B | 0x3F => {
                    self.consume();
                    self.quantifier(last);
                    last = Token::NotAtom;
                }
                0x7B => {
                    let start = self.i;
                    self.consume();
                    let mut done = false;
                    if self.peek_is_digit() {
                        let min = self.consume_number();
                        let mut max = min;
                        if self.try_consume(b',') {
                            max = if self.peek_is_digit() {
                                self.consume_number()
                            } else {
                                u64::MAX
                            };
                        }
                        if self.try_consume(b'}') {
                            if min == u64::MAX {
                                self.set(Code::QuantifierTooLarge);
                            } else if min <= max {
                                let _ = (min.min(INFINITE), max.min(INFINITE));
                                self.quantifier(last);
                            } else {
                                self.set(Code::QuantifierOutOfOrder);
                            }
                            last = Token::NotAtom;
                            done = true;
                        }
                    }
                    if !done {
                        if self.unicode_mode() {
                            self.set(Code::QuantifierIncomplete);
                        } else {
                            self.i = start;
                            self.consume_possible_pair(false);
                            last = Token::Atom;
                        }
                    }
                }
                _ => {
                    self.consume_possible_pair(false);
                    last = Token::Atom;
                }
            }
            if self.failed() {
                return;
            }
        }
        if !self.parens.is_empty() {
            self.set(Code::MissingParentheses);
        }
    }

    fn quantifier(&mut self, last: Token) {
        match last {
            Token::Atom => {
                self.try_consume(b'?');
            }
            Token::Lookbehind => self.set(Code::CantQuantifyAtom),
            _ => self.set(Code::QuantifierWithoutAtom),
        }
    }

    fn count_captures(&mut self) {
        self.captures += 1;
        if self.captures > MAX_CAPTURES {
            self.set(Code::TooManyCaptures);
        }
    }

    fn parentheses_begin(&mut self) {
        self.consume();
        let mut kind = Paren::Subpattern;
        let mut non_capturing = false;
        if self.try_consume(b'?') {
            if self.at_end() {
                self.set(Code::ParenthesesTypeInvalid);
                return;
            }
            match self.peek() {
                0x3A => {
                    self.consume();
                    non_capturing = true;
                }
                0x3D | 0x21 => {
                    self.consume();
                    kind = Paren::Assertion;
                }
                0x3C => {
                    self.consume();
                    let name = self.group_name();
                    if self.failed() {
                        // An error while reading the name stops the parse.
                    } else if let Some(name) = name {
                        if self.k_identity_seen {
                            self.set(Code::InvalidNamedBackReference);
                        } else if self.names.add(name) {
                            self.count_captures();
                        } else {
                            self.set(Code::DuplicateGroupName);
                        }
                    } else if self.try_consume(b'=') || self.try_consume(b'!') {
                        kind = Paren::Lookbehind;
                    } else {
                        self.set(Code::InvalidGroupName);
                    }
                }
                0x69 | 0x6D | 0x73 | 0x2D => {
                    non_capturing = true;
                    self.modifiers();
                }
                _ => self.set(Code::ParenthesesTypeInvalid),
            }
        } else {
            self.count_captures();
        }
        if kind == Paren::Subpattern && !non_capturing {
            self.subpatterns += 1;
        }
        self.parens.push(kind);
        self.names.push();
    }

    /// `(?ims-ims:`: each flag at most once on each side, never on both, and at least one.
    fn modifiers(&mut self) {
        let (mut set, mut unset) = (0u8, 0u8);
        let mut negated = false;
        while !self.at_end() {
            let c = self.consume();
            if c == b':' as u32 {
                break;
            }
            let bit = match c {
                0x69 => 1,
                0x6D => 2,
                0x73 => 4,
                0x2D => {
                    if negated {
                        self.set(Code::InvalidRegularExpressionModifier);
                    }
                    negated = true;
                    continue;
                }
                _ => {
                    self.set(Code::ParenthesesTypeInvalid);
                    continue;
                }
            };
            let side = if negated { &mut unset } else { &mut set };
            if *side & bit != 0 {
                self.error = Some(Code::InvalidRegularExpressionModifier);
            }
            *side |= bit;
        }
        if self.failed() {
            return;
        }
        if set & unset != 0 || (set == 0 && unset == 0) {
            self.set(Code::InvalidRegularExpressionModifier);
        }
    }

    fn parentheses_end(&mut self) -> Token {
        self.consume();
        let Some(kind) = self.parens.pop() else {
            self.set(Code::ParenthesesUnmatched);
            return Token::NotAtom;
        };
        self.names.pop();
        match kind {
            Paren::Lookbehind => Token::Lookbehind,
            Paren::Subpattern => Token::Atom,
            Paren::Assertion if self.mode == Mode::Legacy => Token::Atom,
            Paren::Assertion => Token::NotAtom,
        }
    }

    fn illegal_references(&mut self) {
        let mut reparse = false;
        if self.max_back_reference > self.subpatterns {
            if self.unicode_mode() {
                self.set(Code::InvalidBackreference);
                return;
            }
            self.back_reference_limit = self.subpatterns;
            reparse = true;
        }
        if self.k_identity_seen && !self.names.all.is_empty() {
            self.set(Code::InvalidNamedBackReference);
            return;
        }
        let illegal_forward = !self.forward_names.is_empty()
            && (self.names.all.is_empty()
                || self
                    .forward_names
                    .iter()
                    .any(|n| !self.names.all.contains(n)));
        if illegal_forward {
            if self.unicode_mode() || !self.names.all.is_empty() {
                self.set(Code::InvalidNamedBackReference);
                return;
            }
            self.named_forward_allowed = false;
            reparse = true;
        }
        if reparse {
            self.i = 0;
            self.subpatterns = 0;
            self.max_back_reference = 0;
            self.k_identity_seen = false;
            self.parens.clear();
            self.names = Names::new();
            self.forward_names.clear();
            self.tokens();
        }
    }

    // ---------- escapes ----------

    /// An escape at `\`: the token it makes and what it adds to an enclosing class.
    fn escape(&mut self, mode: Escape) -> (Token, Item) {
        self.consume();
        if self.at_end() {
            self.set(Code::EscapeUnterminated);
            return (Token::NotAtom, Item::Other);
        }
        let c = self.peek();
        let ch = |c: u32| (Token::Atom, Item::Char(c));
        match c {
            0x62 => {
                self.consume();
                if mode == Escape::Normal {
                    return (Token::NotAtom, Item::Other);
                }
                ch(8)
            }
            0x42 => {
                self.consume();
                if mode == Escape::Normal {
                    return (Token::NotAtom, Item::Other);
                }
                self.identity_escape_error(c, mode);
                ch(c)
            }
            0x64 | 0x73 | 0x77 | 0x44 | 0x53 | 0x57 => {
                self.consume();
                if mode == Escape::StringDisjunction {
                    return ch(c);
                }
                (Token::Atom, Item::Class { strings: false })
            }
            0x30 => {
                self.consume();
                if !self.peek_is_digit() {
                    return ch(0);
                }
                if self.unicode_mode() {
                    self.set(Code::InvalidOctalEscape);
                    return ch(0);
                }
                ch(self.consume_octal(2))
            }
            0x31..=0x39 => {
                if mode == Escape::Normal {
                    let start = self.i;
                    let n = self.consume_number();
                    let n = u32::try_from(n).unwrap_or(u32::MAX);
                    if n <= self.back_reference_limit {
                        self.max_back_reference = self.max_back_reference.max(n);
                        return (Token::Atom, Item::Other);
                    }
                    self.i = start;
                    if self.unicode_mode() {
                        self.set(Code::InvalidBackreference);
                        return (Token::Atom, Item::Other);
                    }
                }
                if self.unicode_mode() {
                    self.set(Code::InvalidOctalEscape);
                    return (Token::Atom, Item::Other);
                }
                let v = if self.peek() < b'8' as u32 {
                    self.consume_octal(3)
                } else {
                    self.consume()
                };
                ch(v)
            }
            0x66 => {
                self.consume();
                ch(0x0C)
            }
            0x6E => {
                self.consume();
                ch(0x0A)
            }
            0x72 => {
                self.consume();
                ch(0x0D)
            }
            0x74 => {
                self.consume();
                ch(0x09)
            }
            0x76 => {
                self.consume();
                ch(0x0B)
            }
            0x63 => {
                let start = self.i;
                self.consume();
                if !self.at_end() {
                    let control = self.consume();
                    if char::from_u32(control).is_some_and(|c| c.is_ascii_alphabetic()) {
                        return ch(control & 0x1F);
                    }
                    if self.unicode_mode() {
                        self.set(Code::InvalidControlLetterEscape);
                        return ch(0);
                    }
                    if mode != Escape::Normal
                        && (char::from_u32(control).is_some_and(|c| c.is_ascii_digit())
                            || control == b'_' as u32)
                    {
                        return ch(control & 0x1F);
                    }
                }
                if self.unicode_mode() {
                    self.set(Code::InvalidIdentityEscape);
                    return ch(0);
                }
                self.i = start;
                ch(b'\\' as u32)
            }
            0x78 => {
                self.consume();
                let x = self.try_consume_hex(2);
                if x == NO_CHAR {
                    self.identity_escape_error(b'x' as u32, mode);
                    return ch(b'x' as u32);
                }
                ch(x)
            }
            0x6B => {
                self.consume();
                let start = self.i;
                if mode == Escape::Normal && self.try_consume(b'<') {
                    let name = self.group_name();
                    if self.failed() {
                        return (Token::Atom, Item::Other);
                    }
                    if let Some(name) = name {
                        if self.names.all.contains(&name) {
                            return (Token::Atom, Item::Other);
                        }
                        if self.named_forward_allowed {
                            self.forward_names.insert(name);
                            return (Token::Atom, Item::Other);
                        }
                    }
                }
                self.i = start;
                if !self.identity_escape_error(b'k' as u32, mode) {
                    self.k_identity_seen = true;
                }
                ch(b'k' as u32)
            }
            0x70 | 0x50 => {
                let e = self.consume();
                if self.mode == Mode::Legacy || mode == Escape::StringDisjunction {
                    self.identity_escape_error(e, mode);
                    return ch(e);
                }
                if !self.at_end() && self.peek() == b'{' as u32 {
                    self.consume();
                    let Some(strings) = self.property_expression() else {
                        return (Token::Atom, Item::Other);
                    };
                    if e == b'P' as u32 && strings {
                        self.set(Code::NegatedClassSetMayContainStrings);
                        return (Token::Atom, Item::Other);
                    }
                    return (Token::Atom, Item::Class { strings });
                }
                self.set(Code::InvalidUnicodePropertyExpression);
                (Token::Atom, Item::Other)
            }
            0x71 => {
                let e = self.consume();
                if mode == Escape::ClassSet {
                    if !self.at_end() && self.peek() == b'{' as u32 {
                        let strings = self.string_disjunction();
                        let token = if strings {
                            Token::SetDisjunctionStrings
                        } else {
                            Token::SetDisjunction
                        };
                        return (token, Item::Other);
                    }
                    self.set(Code::InvalidUnicodePropertyExpression);
                }
                self.identity_escape_error(e, mode);
                ch(e)
            }
            0x75 => {
                let cp = self.unicode_escape(false);
                if self.failed() {
                    return (Token::Atom, Item::Other);
                }
                ch(if cp == NO_CHAR { b'u' as u32 } else { cp })
            }
            _ => {
                if c == b'-' as u32 && self.unicode_mode() && mode != Escape::Normal {
                    return ch(self.consume());
                }
                if self.identity_escape_error(c, mode) {
                    return (Token::Atom, Item::Other);
                }
                ch(self.consume())
            }
        }
    }

    fn consume_octal(&mut self, count: usize) -> u32 {
        let mut v = 0;
        for _ in 0..count {
            if v >= 32 || self.at_end() || !(b'0' as u32..=b'7' as u32).contains(&self.peek()) {
                break;
            }
            v = v * 8 + (self.consume() - b'0' as u32);
        }
        v
    }

    fn unicode_escape(&mut self, group_name: bool) -> u32 {
        let unicode = self.unicode_mode() || group_name;
        if !self.try_consume(b'u') || self.at_end() {
            if unicode {
                self.set(Code::InvalidUnicodeEscape);
            }
            return NO_CHAR;
        }
        if unicode && self.try_consume(b'{') {
            let mut cp: u32 = 0;
            loop {
                let Some(d) = (!self.at_end())
                    .then(|| char::from_u32(self.peek()).and_then(|c| c.to_digit(16)))
                    .flatten()
                else {
                    self.set(Code::InvalidUnicodeCodePointEscape);
                    return NO_CHAR;
                };
                self.consume();
                cp = (cp << 4) | d;
                if cp > 0x10FFFF {
                    self.set(Code::InvalidUnicodeCodePointEscape);
                    return NO_CHAR;
                }
                if self.at_end() || self.peek() == b'}' as u32 {
                    break;
                }
            }
            if !self.try_consume(b'}') {
                self.set(Code::InvalidUnicodeCodePointEscape);
                return NO_CHAR;
            }
            return cp;
        }
        let unit = self.try_consume_hex(4);
        if unit == NO_CHAR {
            if unicode {
                self.set(Code::InvalidUnicodeEscape);
            }
            return NO_CHAR;
        }
        if (0xD800..0xDC00).contains(&unit)
            && unicode
            && self.data.len() - self.i >= 6
            && self.peek() == b'\\' as u32
        {
            let start = self.i;
            self.consume();
            if self.try_consume(b'u') {
                let low = self.try_consume_hex(4);
                if (0xDC00..0xE000).contains(&low) {
                    return 0x10000 + ((unit - 0xD800) << 10) + (low - 0xDC00);
                }
            }
            self.i = start;
        }
        unit
    }

    fn identifier_char(&mut self) -> u32 {
        if self.try_consume(b'\\') {
            return self.unicode_escape(true);
        }
        self.consume_possible_pair(true)
    }

    fn is_identifier(&self, ch: u32, start: bool) -> bool {
        if ch < 128 {
            let c = ch as u8;
            return c.is_ascii_alphabetic()
                || c == b'_'
                || c == b'$'
                || (!start && c.is_ascii_digit());
        }
        if ch == NO_CHAR {
            return false;
        }
        if !start && (ch == 0x200C || ch == 0x200D) {
            return true;
        }
        self.unicode.identifier(ch, start)
    }

    /// A group name up to `>`, or `None` (with the position restored) when there is none.
    fn group_name(&mut self) -> Option<Vec<u32>> {
        if self.at_end() {
            return None;
        }
        let start = self.i;
        let ch = self.identifier_char();
        if self.is_identifier(ch, true) {
            let mut name = vec![ch];
            while !self.at_end() {
                let ch = self.identifier_char();
                if ch == b'>' as u32 {
                    return Some(name);
                }
                if !self.is_identifier(ch, false) {
                    break;
                }
                name.push(ch);
            }
        }
        self.i = start;
        None
    }

    /// `\p{...}` after the brace: whether the property may match strings, or `None` after an error.
    fn property_expression(&mut self) -> Option<bool> {
        let ok = |c: u32| {
            char::from_u32(c).is_some_and(|c| c.is_ascii_alphanumeric() || c == '_' || c == '=')
        };
        if self.at_end() || !ok(self.peek()) {
            self.set(Code::InvalidUnicodePropertyExpression);
            return None;
        }
        let mut text = String::new();
        let mut equals = false;
        let mut errors = false;
        text.push(char::from_u32(self.consume()).unwrap_or('?'));
        while !self.at_end() {
            let c = self.consume();
            if c == b'}' as u32 {
                if errors {
                    break;
                }
                let found = self.unicode.property(&text, self.mode);
                if found.is_none() {
                    self.set(Code::InvalidUnicodePropertyExpression);
                }
                return found;
            }
            if c == b'=' as u32 {
                if equals {
                    errors = true;
                }
                equals = true;
                text.push('=');
            } else if !ok(c) {
                errors = true;
            } else {
                text.push(char::from_u32(c).unwrap_or('?'));
            }
        }
        self.set(Code::InvalidUnicodePropertyExpression);
        None
    }

    // ---------- classes ----------

    fn character_class(&mut self) {
        self.consume();
        self.try_consume(b'^');
        let unicode = self.mode == Mode::Unicode;
        let mut state = ClassState::Empty;
        let mut cached = 0u32;
        while !self.at_end() {
            let item = match self.peek() {
                0x5D => {
                    self.consume();
                    return;
                }
                0x5C => self.escape(Escape::Class).1,
                _ => {
                    let c = self.consume_possible_pair(false);
                    match state {
                        ClassState::AfterClass if c == b'-' as u32 => {
                            state = ClassState::AfterClassHyphen;
                            continue;
                        }
                        ClassState::Cached if c == b'-' as u32 => {
                            state = ClassState::CachedHyphen;
                            continue;
                        }
                        _ => Item::Char(c),
                    }
                }
            };
            if self.failed() {
                return;
            }
            match item {
                Item::Char(c) => match state {
                    ClassState::Empty | ClassState::AfterClass | ClassState::Cached => {
                        cached = c;
                        state = ClassState::Cached;
                    }
                    ClassState::CachedHyphen => {
                        if c < cached {
                            self.set(Code::CharacterClassRangeOutOfOrder);
                            return;
                        }
                        state = ClassState::Empty;
                    }
                    ClassState::AfterClassHyphen => {
                        if unicode {
                            self.set(Code::CharacterClassRangeInvalid);
                            return;
                        }
                        state = ClassState::Empty;
                    }
                },
                Item::Class { .. } => match state {
                    ClassState::Empty | ClassState::AfterClass | ClassState::Cached => {
                        state = ClassState::AfterClass;
                    }
                    ClassState::CachedHyphen | ClassState::AfterClassHyphen => {
                        if unicode {
                            self.set(Code::CharacterClassRangeInvalid);
                            return;
                        }
                        state = ClassState::Empty;
                    }
                },
                Item::Other => {}
            }
        }
        self.set(Code::CharacterClassUnmatched);
    }

    fn class_set(&mut self) {
        self.consume();
        let inverted = self.try_consume(b'^');
        let mut set = ClassSet::new(inverted);
        while !self.at_end() {
            match self.peek() {
                0x5D => {
                    self.consume();
                    if set.nested_end(&mut self.error) {
                        return;
                    }
                }
                0x5B => {
                    self.consume();
                    let invert = self.try_consume(b'^');
                    set.nested_begin(invert, &mut self.error);
                }
                0x5C => {
                    if !set.can_take_operand(&mut self.error) {
                        self.set(Code::InvalidClassSetOperation);
                        return;
                    }
                    let (token, item) = self.escape(Escape::ClassSet);
                    if self.failed() {
                        return;
                    }
                    match item {
                        Item::Char(c) => set.character(c, false, &mut self.error),
                        Item::Class { strings } => set.builtin(strings, &mut self.error),
                        Item::Other => {}
                    }
                    set.compute_strings(token == Token::SetDisjunctionStrings);
                    if matches!(token, Token::SetDisjunction | Token::SetDisjunctionStrings) {
                        set.after_operand(&mut self.error);
                    }
                }
                c @ (0x2D | 0x26) => {
                    let start = self.i;
                    self.consume();
                    if self.at_end() {
                        self.set(Code::CharacterClassUnmatched);
                        return;
                    }
                    if self.peek() == c {
                        self.consume();
                        if self.at_end() || self.peek() == c {
                            self.set(Code::InvalidClassSetCharacter);
                            return;
                        }
                        let op = if c == 0x2D {
                            SetOp::Subtraction
                        } else {
                            SetOp::Intersection
                        };
                        set.operator(op, &mut self.error);
                    } else {
                        self.i = start;
                        self.class_set_char(&mut set);
                    }
                }
                _ => self.class_set_char(&mut set),
            }
            if self.failed() {
                return;
            }
        }
        self.set(Code::CharacterClassUnmatched);
    }

    fn class_set_char(&mut self, set: &mut ClassSet) {
        let c = self.class_set_character();
        if c == NO_CHAR {
            return;
        }
        set.character(c, true, &mut self.error);
    }

    fn class_set_character(&mut self) -> u32 {
        let c = self.consume_possible_pair(false);
        if c == 0 {
            self.set(Code::InvalidClassSetCharacter);
            return NO_CHAR;
        }
        if c < 128 {
            if b"()[]{}/|".contains(&(c as u8)) {
                self.set(Code::InvalidClassSetCharacter);
                return NO_CHAR;
            }
            if !self.at_end() && self.peek() == c && b"&!#$%*+,.:;<=>?@^`~".contains(&(c as u8)) {
                self.set(Code::InvalidClassSetOperation);
                return NO_CHAR;
            }
        }
        c
    }

    /// `\q{...}` at the brace: whether it holds a string longer than one character.
    fn string_disjunction(&mut self) -> bool {
        self.consume();
        let mut strings = false;
        let mut len = 0;
        while !self.at_end() {
            match self.peek() {
                0x7D => {
                    self.consume();
                    return strings;
                }
                0x5C => {
                    let (_, item) = self.escape(Escape::StringDisjunction);
                    if matches!(item, Item::Char(_)) {
                        len += 1;
                    }
                }
                0x7C => {
                    self.consume();
                    len = 0;
                }
                0x2D => {
                    self.consume();
                    self.set(Code::InvalidClassSetCharacter);
                    return strings;
                }
                _ => {
                    if self.class_set_character() == NO_CHAR {
                        return strings;
                    }
                    len += 1;
                }
            }
            if len > 1 {
                strings = true;
            }
            if self.failed() {
                return strings;
            }
        }
        self.set(Code::ClassStringDisjunctionUnmatched);
        strings
    }
}

#[derive(Clone, Copy, PartialEq)]
enum ClassState {
    Empty,
    Cached,
    CachedHyphen,
    AfterClass,
    AfterClassHyphen,
}

#[derive(Clone, Copy, PartialEq)]
enum SetOp {
    Default,
    Union,
    Subtraction,
    Intersection,
}

#[derive(Clone, Copy, PartialEq)]
enum SetState {
    Empty,
    Cached,
    CachedHyphen,
    AfterClass,
    AfterClassHyphen,
    AfterRange,
    AfterOperand,
    AfterOperator,
}

/// The state `ClassSetParserDelegate` keeps for a `v`-mode class.
struct ClassSet {
    state: SetState,
    op: SetOp,
    strings: bool,
    inverted: bool,
    cached: u32,
    nesting: Vec<(SetOp, bool, bool)>,
}

impl ClassSet {
    fn new(inverted: bool) -> ClassSet {
        ClassSet {
            state: SetState::Empty,
            op: SetOp::Default,
            strings: false,
            inverted,
            cached: 0,
            nesting: Vec::new(),
        }
    }

    fn union_active(&self) -> bool {
        matches!(self.op, SetOp::Default | SetOp::Union)
    }

    fn flush(&mut self, error: &mut Option<Code>) {
        match self.state {
            SetState::Cached => self.state = SetState::Empty,
            SetState::CachedHyphen | SetState::AfterClassHyphen => {
                *error = Some(Code::InvalidClassSetCharacter)
            }
            _ => {}
        }
    }

    fn union_if_default(&mut self) {
        if self.op == SetOp::Default {
            self.op = SetOp::Union;
        }
    }

    fn nested_begin(&mut self, invert: bool, error: &mut Option<Code>) {
        self.flush(error);
        self.nesting.push((self.op, self.strings, self.inverted));
        self.op = SetOp::Default;
        self.strings = false;
        self.inverted = invert;
    }

    /// Ends a class; true when it was the outermost.
    fn nested_end(&mut self, error: &mut Option<Code>) -> bool {
        self.flush(error);
        if self.inverted && self.strings {
            *error = Some(Code::NegatedClassSetMayContainStrings);
        }
        let Some((op, strings, inverted)) = self.nesting.pop() else {
            if matches!(
                self.state,
                SetState::CachedHyphen | SetState::AfterClassHyphen | SetState::AfterOperator
            ) {
                *error = Some(Code::InvalidClassSetCharacter);
            }
            if self.inverted && self.strings {
                *error = Some(Code::NegatedClassSetMayContainStrings);
            }
            return true;
        };
        let inner = self.strings;
        self.op = op;
        self.inverted = inverted;
        self.strings = strings;
        self.state = SetState::AfterOperand;
        self.compute_strings(inner);
        false
    }

    fn operator(&mut self, op: SetOp, error: &mut Option<Code>) {
        if self.state == SetState::Empty || (self.op != SetOp::Default && self.op != op) {
            *error = Some(Code::InvalidClassSetOperation);
            return;
        }
        self.flush(error);
        self.op = op;
        self.state = SetState::AfterOperator;
    }

    fn compute_strings(&mut self, rhs: bool) {
        match self.op {
            SetOp::Default | SetOp::Union => self.strings |= rhs,
            SetOp::Intersection => self.strings = self.strings && rhs,
            SetOp::Subtraction => {}
        }
    }

    fn after_operand(&mut self, error: &mut Option<Code>) {
        self.flush(error);
        self.state = SetState::AfterOperand;
    }

    fn can_take_operand(&mut self, error: &mut Option<Code>) -> bool {
        let union = self.union_active();
        match self.state {
            SetState::Empty | SetState::AfterOperator => true,
            SetState::Cached => {
                if !union {
                    return false;
                }
                self.flush(error);
                true
            }
            _ => union,
        }
    }

    fn character(&mut self, ch: u32, hyphen_is_range: bool, error: &mut Option<Code>) {
        let union = self.union_active();
        let hyphen = ch == b'-' as u32;
        match self.state {
            SetState::AfterClass
            | SetState::AfterRange
            | SetState::Empty
            | SetState::AfterOperator => {
                if self.state == SetState::AfterClass && hyphen_is_range && union && hyphen {
                    self.state = SetState::AfterClassHyphen;
                    return;
                }
                if matches!(self.state, SetState::AfterClass | SetState::AfterRange) {
                    self.union_if_default();
                }
                if hyphen_is_range && hyphen {
                    *error = Some(Code::InvalidClassSetCharacter);
                    return;
                }
                self.cached = ch;
                self.state = SetState::Cached;
            }
            SetState::Cached => {
                if !union {
                    *error = Some(Code::InvalidClassSetOperation);
                    return;
                }
                if hyphen {
                    self.state = SetState::CachedHyphen;
                } else {
                    self.union_if_default();
                    self.cached = ch;
                }
            }
            SetState::CachedHyphen => {
                if ch < self.cached {
                    *error = Some(Code::CharacterClassRangeOutOfOrder);
                    return;
                }
                self.union_if_default();
                self.state = SetState::AfterRange;
            }
            SetState::AfterClassHyphen => *error = Some(Code::CharacterClassRangeInvalid),
            SetState::AfterOperand => {
                if !union || (hyphen_is_range && hyphen) {
                    *error = Some(Code::InvalidClassSetOperation);
                    return;
                }
                self.union_if_default();
                self.cached = ch;
                self.state = SetState::Cached;
            }
        }
    }

    fn builtin(&mut self, strings: bool, error: &mut Option<Code>) {
        let union = self.union_active();
        match self.state {
            SetState::Cached | SetState::AfterRange => {
                if self.state == SetState::Cached && !union {
                    *error = Some(Code::InvalidClassSetOperation);
                    return;
                }
                self.union_if_default();
            }
            SetState::Empty | SetState::AfterClass | SetState::AfterOperator => {}
            SetState::CachedHyphen | SetState::AfterClassHyphen => {
                *error = Some(Code::CharacterClassRangeInvalid);
                return;
            }
            SetState::AfterOperand => {
                if !union {
                    *error = Some(Code::InvalidClassSetOperation);
                }
            }
        }
        self.compute_strings(strings);
        self.state = SetState::AfterClass;
    }
}
