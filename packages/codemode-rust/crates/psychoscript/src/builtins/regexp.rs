//! RegExp, and the String methods that take a regular expression.
//!
//! Matching runs on `regress`, which implements ECMAScript regular expression semantics. ASCII text is matched as
//! UTF-8, where byte offsets are code-unit offsets; other text is matched as UTF-16, so offsets, `lastIndex` and
//! non-unicode patterns see code units exactly as JavaScript does.

use super::arg;
use super::regexp_syntax::{self, Mode};
use crate::object::*;
use crate::ops::{MAX_ARRAY_LEN, MAX_STRING_LEN};
use crate::strings::StrId;
use crate::value::{Id, Value, to_integer};
use crate::vm::{Res, Vm};

pub struct RegExpData {
    pub source: String,
    pub flags: String,
    pub regex: regress::Regex,
    pub last_index: f64,
}

impl RegExpData {
    fn has(&self, flag: char) -> bool {
        self.flags.contains(flag)
    }
    fn global(&self) -> bool {
        self.has('g')
    }
    fn sticky(&self) -> bool {
        self.has('y')
    }
    fn full_unicode(&self) -> bool {
        self.has('u') || self.has('v')
    }
}

const ESCAPE_HINT: &str = "To match special characters like ( ) [ ] { } + * ? . literally, escape them with a backslash (e.g. \"\\\\(\") or test for them with String.includes instead.";

pub enum CompileError {
    Flags,
    Pattern(String),
}

/// Validates and orders the flags, then compiles the pattern.
pub fn compile(pattern: &str, flags: &str) -> Result<(regress::Regex, String), CompileError> {
    const ORDER: &str = "dgimsuvy";
    let mut seen = [false; 8];
    for c in flags.chars() {
        let Some(i) = ORDER.find(c) else {
            return Err(CompileError::Flags);
        };
        if seen[i] {
            return Err(CompileError::Flags);
        }
        seen[i] = true;
    }
    if seen[5] && seen[6] {
        return Err(CompileError::Flags);
    }
    let ordered: String = ORDER
        .chars()
        .zip(seen)
        .filter(|(_, s)| *s)
        .map(|(c, _)| c)
        .collect();
    let rflags = regress::Flags {
        icase: seen[2],
        multiline: seen[3],
        dot_all: seen[4],
        unicode: seen[5],
        unicode_sets: seen[6],
        ..Default::default()
    };
    let mode = if rflags.unicode_sets {
        Mode::UnicodeSets
    } else if rflags.unicode {
        Mode::Unicode
    } else {
        Mode::Legacy
    };
    if let Some(code) =
        regexp_syntax::check(&crate::strings::units_of(pattern), mode, &EngineUnicode)
    {
        return Err(CompileError::Pattern(code.message().into()));
    }
    let expanded = rewrite_named_refs(pattern, rflags.unicode_sets);
    let pattern = expanded.as_deref().unwrap_or(pattern);
    // Without the unicode flags a pattern is code units, like the text it matches.
    // A carrier pattern holds lone surrogates, which only code points can pass on.
    let compiled = if (rflags.unicode || rflags.unicode_sets) && crate::strings::has_mark(pattern) {
        let points = char::decode_utf16(crate::strings::units_of(pattern)).map(|r| match r {
            Ok(c) => c as u32,
            Err(e) => e.unpaired_surrogate() as u32,
        });
        regress::Regex::from_unicode(points, rflags)
    } else if rflags.unicode || rflags.unicode_sets {
        regress::Regex::with_flags(pattern, rflags)
    } else {
        regress::Regex::from_unicode(
            crate::strings::units_of(pattern).into_iter().map(u32::from),
            rflags,
        )
        .or_else(|_| regress::Regex::with_flags(pattern, rflags))
    };
    match compiled {
        Ok(r) => Ok((r, ordered)),
        Err(e) => Err(CompileError::Pattern(e.to_string())),
    }
}

/// A pattern's named groups (name and capture index) and its `\\k<name>` references outside classes (span and
/// name).
struct NamedRefs {
    groups: Vec<(String, usize)>,
    refs: Vec<(usize, usize, String)>,
}

fn scan_named_refs(chars: &[char], nested_classes: bool) -> NamedRefs {
    let mut found = NamedRefs {
        groups: Vec::new(),
        refs: Vec::new(),
    };
    let (mut i, mut depth, mut count) = (0, 0usize, 0usize);
    let name_at = |from: usize| {
        let end = chars[from..]
            .iter()
            .position(|c| *c == '>')
            .map(|n| from + n)?;
        Some((end, chars[from..end].iter().collect::<String>()))
    };
    while i < chars.len() {
        match chars[i] {
            '\\' => {
                if chars.get(i + 1) == Some(&'k')
                    && depth == 0
                    && chars.get(i + 2) == Some(&'<')
                    && let Some((end, name)) = name_at(i + 3)
                {
                    found.refs.push((i, end + 1, name));
                }
                i += 2;
                continue;
            }
            '[' if depth == 0 || nested_classes => depth += 1,
            ']' if depth > 0 => depth -= 1,
            '(' if depth == 0 => {
                if chars.get(i + 1) != Some(&'?') {
                    count += 1;
                } else if chars.get(i + 2) == Some(&'<')
                    && !matches!(chars.get(i + 3), Some('=') | Some('!'))
                    && let Some((_, name)) = name_at(i + 3)
                {
                    count += 1;
                    found.groups.push((name, count));
                }
            }
            _ => {}
        }
        i += 1;
    }
    found
}

/// `regress` binds `\\k<name>` to the first group of that name only. When a name is duplicated at most one of its
/// groups participates, and a reference to a group that did not participate matches empty, so the reference
/// becomes the sequence of back-references to every group of that name, `(?:\\1\\2)`.
fn rewrite_named_refs(pattern: &str, nested_classes: bool) -> Option<String> {
    if !pattern.contains("\\k") {
        return None;
    }
    let chars: Vec<char> = pattern.chars().collect();
    let found = scan_named_refs(&chars, nested_classes);
    if found.groups.is_empty() {
        return None;
    }
    let indexes = |name: &str| -> Vec<usize> {
        found
            .groups
            .iter()
            .filter(|(n, _)| n == name)
            .map(|(_, i)| *i)
            .collect()
    };
    let mut out = String::new();
    let mut last = 0;
    for (start, end, name) in &found.refs {
        let indexes = indexes(name);
        if indexes.len() < 2 {
            continue;
        }
        out.extend(&chars[last..*start]);
        out.push_str("(?:");
        for i in indexes {
            out.push_str(&format!("\\{i}"));
        }
        out.push(')');
        last = *end;
    }
    if last == 0 {
        return None;
    }
    out.extend(&chars[last..]);
    Some(out)
}

/// The Unicode facts the syntax check needs, from `regress`, which runs the pattern.
struct EngineUnicode;

impl regexp_syntax::Unicode for EngineUnicode {
    fn property(&self, expression: &str, mode: Mode) -> Option<bool> {
        const STRINGS: [&str; 7] = [
            "Basic_Emoji",
            "Emoji_Keycap_Sequence",
            "RGI_Emoji_Modifier_Sequence",
            "RGI_Emoji_Flag_Sequence",
            "RGI_Emoji_Tag_Sequence",
            "RGI_Emoji_ZWJ_Sequence",
            "RGI_Emoji",
        ];
        let flags = regress::Flags {
            unicode: mode == Mode::Unicode,
            unicode_sets: mode == Mode::UnicodeSets,
            ..Default::default()
        };
        regress::Regex::with_flags(&format!("\\p{{{expression}}}"), flags).ok()?;
        Some(mode == Mode::UnicodeSets && STRINGS.contains(&expression))
    }

    fn identifier(&self, ch: u32, start: bool) -> bool {
        static START: std::sync::LazyLock<Option<regress::Regex>> =
            std::sync::LazyLock::new(|| regress::Regex::with_flags("^\\p{L}$", "u").ok());
        static PART: std::sync::LazyLock<Option<regress::Regex>> = std::sync::LazyLock::new(|| {
            regress::Regex::with_flags("^[\\p{L}\\p{Mn}\\p{Mc}\\p{Nd}\\p{Pc}]$", "u").ok()
        });
        let Some(c) = char::from_u32(ch) else {
            return false;
        };
        let re = if start { &*START } else { &*PART };
        re.as_ref()
            .is_some_and(|r| r.find(c.encode_utf8(&mut [0; 4])).is_some())
    }
}

/// The source as `RegExp.prototype.source` spells it: `/` and line terminators escaped outside classes.
fn escape_source(pattern: &str) -> String {
    if pattern.is_empty() {
        return "(?:)".into();
    }
    let mut out = String::with_capacity(pattern.len());
    let mut in_class = false;
    let mut chars = pattern.chars();
    while let Some(c) = chars.next() {
        match c {
            '\\' => {
                out.push('\\');
                if let Some(n) = chars.next() {
                    match n {
                        '\n' => out.push('n'),
                        '\r' => out.push('r'),
                        '\u{2028}' => out.push_str("u2028"),
                        '\u{2029}' => out.push_str("u2029"),
                        _ => out.push(n),
                    }
                }
            }
            '/' if !in_class => out.push_str("\\/"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\u{2028}' => out.push_str("\\u2028"),
            '\u{2029}' => out.push_str("\\u2029"),
            '[' => {
                in_class = true;
                out.push(c);
            }
            ']' => {
                in_class = false;
                out.push(c);
            }
            _ => out.push(c),
        }
    }
    out
}

fn quote_json(s: &str) -> String {
    let mut out = String::new();
    crate::convert::quote(&mut out, s);
    out
}

pub fn setup(vm: &mut Vm) {
    let op = vm.realm.object_proto;
    let proto = vm.plain(op);
    vm.realm.std.regexp = proto;
    let ctor = vm.ctor("RegExp", 2, regexp_ctor, proto, Value::Undef);
    vm.method(ctor, "escape", 1, regexp_escape);
    // The accessors live on the prototype, as in JS; instances answer them through `get_prop`.
    super::accessors(
        vm,
        proto,
        &[
            "source",
            "flags",
            "lastIndex",
            "hasIndices",
            "global",
            "ignoreCase",
            "multiline",
            "dotAll",
            "unicode",
            "unicodeSets",
            "sticky",
        ],
    );
    vm.methods(
        proto,
        &[
            ("exec", 1, re_exec),
            ("test", 1, re_test),
            ("toString", 0, re_to_string),
        ],
    );
}

/// A new RegExp object, or the program's `SyntaxError` when the pattern or flags are invalid.
pub fn new_regexp(vm: &mut Vm, pattern: &str, flags: &str) -> Res {
    super::ensure(vm, super::LAZY_REGEXP);
    match compile(pattern, flags) {
        Ok((regex, flags)) => {
            let proto = vm.realm.std.regexp;
            let data = RegExpData {
                source: escape_source(pattern),
                flags,
                regex,
                last_index: 0.0,
            };
            Ok(Value::Obj(
                vm.alloc(Obj::new(Some(proto), Kind::RegExp(Box::new(data)))),
            ))
        }
        Err(CompileError::Flags) => Err(vm.syntax_error(&format!(
            "new RegExp(...) received invalid flags {} (Invalid flags supplied to RegExp constructor.). Valid flags are d, g, i, m, s, u, v, and y.",
            quote_json(flags)
        ))),
        Err(CompileError::Pattern(reason)) => Err(vm.syntax_error(&format!(
            "new RegExp(...) received {}, which is not a valid regular expression pattern ({reason}). {ESCAPE_HINT}",
            quote_json(pattern)
        ))),
    }
}

/// Checks a regular expression literal at compile time.
pub fn validate_literal(pattern: &str, flags: &str) -> Result<(), String> {
    match compile(pattern, flags) {
        Ok(_) => Ok(()),
        Err(CompileError::Flags) => Err(format!("Invalid regular expression flags '{flags}'")),
        Err(CompileError::Pattern(reason)) => Err(format!(
            "Invalid regular expression: /{pattern}/{flags}: {reason}"
        )),
    }
}

pub fn as_regexp(vm: &Vm, v: &Value) -> Option<Id> {
    match v {
        Value::Obj(id) if matches!(vm.heap[*id as usize].kind, Kind::RegExp(_)) => Some(*id),
        _ => None,
    }
}

fn data(vm: &Vm, id: Id) -> &RegExpData {
    match &vm.heap[id as usize].kind {
        Kind::RegExp(r) => r,
        _ => unreachable!("checked by as_regexp"),
    }
}

fn data_mut(vm: &mut Vm, id: Id) -> &mut RegExpData {
    match &mut vm.heap[id as usize].kind {
        Kind::RegExp(r) => r,
        _ => unreachable!("checked by as_regexp"),
    }
}

fn this_regexp(vm: &mut Vm, this: &Value, name: &str) -> Result<Id, Value> {
    match as_regexp(vm, this) {
        Some(id) => Ok(id),
        None => Err(super::incompatible(
            vm,
            &format!("RegExp.prototype.{name}"),
            this,
        )),
    }
}

/// The accessor properties of a RegExp: `lastIndex`, `source`, `flags` and the flag booleans.
pub fn get_prop(vm: &mut Vm, id: Id, key: Atom) -> Option<Value> {
    let name = vm.atoms.text(key);
    let r = data(vm, id);
    let flag = match name {
        "lastIndex" => return Some(Value::Num(r.last_index)),
        "source" => {
            let s = r.source.clone();
            return Some(vm.string_val(s));
        }
        "flags" => {
            let s = r.flags.clone();
            return Some(vm.string_val(s));
        }
        "hasIndices" => 'd',
        "global" => 'g',
        "ignoreCase" => 'i',
        "multiline" => 'm',
        "dotAll" => 's',
        "unicode" => 'u',
        "unicodeSets" => 'v',
        "sticky" => 'y',
        _ => return None,
    };
    Some(Value::Bool(r.has(flag)))
}

pub fn set_prop(vm: &mut Vm, id: Id, key: Atom, val: Value) -> Option<Result<(), Value>> {
    match vm.atoms.text(key) {
        "lastIndex" => {
            Some(super::builtin_number(vm, &val).map(|n| data_mut(vm, id).last_index = n))
        }
        "source" | "flags" | "hasIndices" | "global" | "ignoreCase" | "multiline" | "dotAll"
        | "unicode" | "unicodeSets" | "sticky" => {
            let k = vm.atoms.text(key).to_owned();
            Some(Err(vm.type_error(&format!(
                "Cannot assign to read only property '{k}'."
            ))))
        }
        _ => None,
    }
}

pub fn inspect(vm: &Vm, id: Id) -> String {
    let r = data(vm, id);
    format!("/{}/{}", r.source, r.flags)
}

pub fn clone_regexp(vm: &mut Vm, id: Id) -> Value {
    let r = data(vm, id);
    let copy = RegExpData {
        source: r.source.clone(),
        flags: r.flags.clone(),
        regex: r.regex.clone(),
        last_index: 0.0,
    };
    let proto = vm.realm.std.regexp;
    Value::Obj(vm.alloc(Obj::new(Some(proto), Kind::RegExp(Box::new(copy)))))
}

// ---------- matching ----------

/// A string prepared for matching: ASCII text as is, anything else as UTF-16 code units.
pub struct Subject {
    pub text: String,
    pub units: Option<Vec<u16>>,
}

impl Subject {
    pub fn new(vm: &Vm, s: StrId) -> Subject {
        let r = vm.atoms.sref(s);
        Subject {
            text: r.s.to_owned(),
            units: if r.ascii { None } else { Some(r.utf16()) },
        }
    }

    pub fn len(&self) -> usize {
        match &self.units {
            Some(u) => u.len(),
            None => self.text.len(),
        }
    }

    pub fn slice(&self, a: usize, b: usize) -> String {
        let (a, b) = (a.min(self.len()), b.min(self.len()));
        if a >= b {
            return String::new();
        }
        match &self.units {
            Some(u) => crate::strings::from_units(&u[a..b]),
            None => self.text[a..b].to_owned(),
        }
    }

    /// AdvanceStringIndex: one code unit, or one code point under the unicode flags.
    fn advance(&self, i: usize, unicode: bool) -> usize {
        if unicode
            && let Some(u) = &self.units
            && (0xd800..0xdc00).contains(&u.get(i).copied().unwrap_or(0))
            && (0xdc00..0xe000).contains(&u.get(i + 1).copied().unwrap_or(0))
        {
            return i + 2;
        }
        i + 1
    }
}

/// The leftmost match starting at or after `start`.
pub fn find(
    re: &regress::Regex,
    unicode: bool,
    subject: &Subject,
    start: usize,
) -> Option<regress::Match> {
    if start > subject.len() {
        return None;
    }
    match &subject.units {
        None => re.find_from(&subject.text, start).next(),
        Some(units) if unicode => re.find_from_utf16(units, start).next(),
        Some(units) => re.find_from_ucs2(units, start).next(),
    }
}

/// RegExpBuiltinExec: one match honoring and updating `lastIndex`.
fn exec_raw(vm: &mut Vm, id: Id, subject: &Subject) -> Result<Option<regress::Match>, Value> {
    let li = data(vm, id).last_index;
    let li = to_integer(li).max(0.0);
    let r = data(vm, id);
    let (global, sticky, unicode) = (r.global(), r.sticky(), r.full_unicode());
    let start = if global || sticky { li } else { 0.0 };
    if start > subject.len() as f64 {
        if global || sticky {
            data_mut(vm, id).last_index = 0.0;
        }
        return Ok(None);
    }
    let start = start as usize;
    let m = find(&data(vm, id).regex, unicode, subject, start);
    let m = match m {
        Some(m) if !sticky || m.start() == start => m,
        _ => {
            if global || sticky {
                data_mut(vm, id).last_index = 0.0;
            }
            return Ok(None);
        }
    };
    if global || sticky {
        data_mut(vm, id).last_index = m.end() as f64;
    }
    Ok(Some(m))
}

fn opt_str(vm: &mut Vm, subject: &Subject, r: Option<regress::Range>) -> Value {
    match r {
        Some(r) => {
            let s = subject.slice(r.start, r.end);
            vm.string_val(s)
        }
        None => Value::Undef,
    }
}

fn has_named_groups(m: &regress::Match) -> bool {
    m.named_groups().next().is_some()
}

fn groups_object(vm: &mut Vm, subject: &Subject, m: &regress::Match) -> Value {
    let id = vm.new_object();
    let named: Vec<(String, Option<regress::Range>)> =
        m.named_groups().map(|(n, r)| (n.to_owned(), r)).collect();
    for (name, range) in named {
        let k = vm.atoms.intern(&name);
        let v = opt_str(vm, subject, range);
        vm.define(id, k, v);
    }
    Value::Obj(id)
}

/// The array `exec` returns: the match and captures, with `index`, `input`, `groups` and, under `d`, `indices`.
fn match_array(
    vm: &mut Vm,
    subject: &Subject,
    input: StrId,
    m: &regress::Match,
    indices: bool,
) -> Value {
    let items: Vec<Value> = m
        .groups()
        .collect::<Vec<_>>()
        .into_iter()
        .map(|g| opt_str(vm, subject, g))
        .collect();
    let arr = vm.new_array(items);
    let Value::Obj(aid) = arr else { return arr };
    let ik = vm.atoms.intern_static("index");
    vm.define(aid, ik, Value::Num(m.start() as f64));
    let ink = vm.atoms.intern_static("input");
    vm.define(aid, ink, Value::Str(input));
    let named = has_named_groups(m);
    if named {
        let g = groups_object(vm, subject, m);
        let gk = vm.atoms.intern_static("groups");
        vm.define(aid, gk, g);
    }
    if indices {
        let pairs: Vec<Option<regress::Range>> = m.groups().collect();
        let items: Vec<Value> = pairs
            .into_iter()
            .map(|r| match r {
                Some(r) => vm.new_array(vec![Value::Num(r.start as f64), Value::Num(r.end as f64)]),
                None => Value::Undef,
            })
            .collect();
        let ind = vm.new_array(items);
        let groups = if named {
            let gid = vm.new_object();
            let named: Vec<(String, Option<regress::Range>)> =
                m.named_groups().map(|(n, r)| (n.to_owned(), r)).collect();
            for (name, r) in named {
                let k = vm.atoms.intern(&name);
                let v = match r {
                    Some(r) => {
                        vm.new_array(vec![Value::Num(r.start as f64), Value::Num(r.end as f64)])
                    }
                    None => Value::Undef,
                };
                vm.define(gid, k, v);
            }
            Value::Obj(gid)
        } else {
            Value::Undef
        };
        if let Value::Obj(iid) = ind {
            let gk = vm.atoms.intern_static("groups");
            vm.define(iid, gk, groups);
        }
        let k = vm.atoms.intern_static("indices");
        vm.define(aid, k, ind);
    }
    arr
}

fn exec_value(vm: &mut Vm, id: Id, s: StrId) -> Res {
    let subject = Subject::new(vm, s);
    let indices = data(vm, id).has('d');
    match exec_raw(vm, id, &subject)? {
        Some(m) => Ok(match_array(vm, &subject, s, &m, indices)),
        None => Ok(Value::Null),
    }
}

// ---------- RegExp ----------

fn regexp_ctor(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let first = arg(args, 0);
    let pattern = match as_regexp(vm, &first) {
        Some(id) => {
            let src = data(vm, id).source.clone();
            if src == "(?:)" { String::new() } else { src }
        }
        None => match first {
            Value::Undef => String::new(),
            v => super::builtin_string(vm, &v)?,
        },
    };
    let flags = match arg(args, 1) {
        Value::Undef => match as_regexp(vm, &first) {
            Some(id) => data(vm, id).flags.clone(),
            None => String::new(),
        },
        Value::Str(s) => vm.text(s).to_owned(),
        other => {
            let t = if let Value::Null = other {
                "null"
            } else {
                vm.type_of(&other)
            };
            return Err(vm.syntax_error(&format!(
                "RegExp flags must be a string of flag characters (e.g. \"g\", \"gi\"), not {t}."
            )));
        }
    };
    new_regexp(vm, &pattern, &flags)
}

fn regexp_escape(vm: &mut Vm, _this: Value, args: &[Value], _: Id) -> Res {
    let Value::Str(s) = arg(args, 0) else {
        return Err(vm.type_error("RegExp.escape expects a string."));
    };
    let units = vm.atoms.sref(s).utf16();
    let mut out = String::new();
    for (i, c) in char::decode_utf16(units).enumerate() {
        let c = match c {
            Ok(c) => c,
            Err(e) => {
                out.push_str(&format!("\\u{:04x}", e.unpaired_surrogate()));
                continue;
            }
        };
        if i == 0 && c.is_ascii_alphanumeric() {
            out.push_str(&format!("\\x{:x}", c as u32));
            continue;
        }
        match c {
            '^' | '$' | '\\' | '.' | '*' | '+' | '?' | '(' | ')' | '[' | ']' | '{' | '}' | '|'
            | '/' => {
                out.push('\\');
                out.push(c);
            }
            '\t' => out.push_str("\\t"),
            '\n' => out.push_str("\\n"),
            '\u{b}' => out.push_str("\\v"),
            '\u{c}' => out.push_str("\\f"),
            '\r' => out.push_str("\\r"),
            ',' | '-' | '=' | '<' | '>' | '#' | '&' | '!' | '%' | ':' | ';' | '@' | '~' | '\''
            | '`' | '"' => out.push_str(&format!("\\x{:x}", c as u32)),
            c if crate::value::is_js_whitespace(c) => {
                if (c as u32) <= 0xff {
                    out.push_str(&format!("\\x{:x}", c as u32));
                } else {
                    let mut buf = [0u16; 2];
                    for u in c.encode_utf16(&mut buf) {
                        out.push_str(&format!("\\u{:04x}", u));
                    }
                }
            }
            c => crate::strings::push_char(&mut out, c),
        }
    }
    Ok(vm.string_val(out))
}

fn re_exec(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = this_regexp(vm, &this, "exec")?;
    let s = super::builtin_string(vm, &arg(args, 0))?;
    let s = vm.atoms.alloc(s);
    exec_value(vm, id, s)
}

fn re_test(vm: &mut Vm, this: Value, args: &[Value], _: Id) -> Res {
    let id = this_regexp(vm, &this, "test")?;
    let s = super::builtin_string(vm, &arg(args, 0))?;
    let s = vm.atoms.alloc(s);
    let subject = Subject::new(vm, s);
    Ok(Value::Bool(exec_raw(vm, id, &subject)?.is_some()))
}

fn re_to_string(vm: &mut Vm, this: Value, _args: &[Value], _: Id) -> Res {
    let id = this_regexp(vm, &this, "toString")?;
    let s = inspect(vm, id);
    Ok(vm.string_val(s))
}

// ---------- String methods ----------

/// A RegExp argument as is, or anything else compiled as a pattern string with `flags`.
fn pattern_arg(vm: &mut Vm, v: &Value, method: &str, flags: &str) -> Result<Id, Value> {
    super::ensure(vm, super::LAZY_REGEXP);
    if let Some(id) = as_regexp(vm, v) {
        return Ok(id);
    }
    let source = match v {
        Value::Undef => String::new(),
        v => {
            let s = vm.string_of(v)?;
            vm.text(s).to_owned()
        }
    };
    match compile(&source, flags) {
        Ok((regex, flags)) => {
            let proto = vm.realm.std.regexp;
            let data = RegExpData {
                source: escape_source(&source),
                flags,
                regex,
                last_index: 0.0,
            };
            Ok(vm.alloc(Obj::new(Some(proto), Kind::RegExp(Box::new(data)))))
        }
        Err(e) => {
            let reason = match e {
                CompileError::Flags => "Invalid flags".to_owned(),
                CompileError::Pattern(r) => r,
            };
            Err(vm.syntax_error(&format!(
                "String.{method} received the string {}, which is not a valid regular expression pattern ({reason}). {ESCAPE_HINT}",
                quote_json(&source)
            )))
        }
    }
}

pub fn string_match(vm: &mut Vm, s: StrId, pat: &Value) -> Res {
    let id = pattern_arg(vm, pat, "match", "")?;
    if !data(vm, id).global() {
        return exec_value(vm, id, s);
    }
    let subject = Subject::new(vm, s);
    let unicode = data(vm, id).full_unicode();
    data_mut(vm, id).last_index = 0.0;
    let mut out = Vec::new();
    while let Some(m) = exec_raw(vm, id, &subject)? {
        if out.len() >= MAX_ARRAY_LEN {
            return Err(vm.range_error("Invalid array length"));
        }
        let v = subject.slice(m.start(), m.end());
        out.push(vm.string_val(v));
        if m.start() == m.end() {
            let next = subject.advance(m.end(), unicode);
            data_mut(vm, id).last_index = next as f64;
        }
    }
    if out.is_empty() {
        return Ok(Value::Null);
    }
    Ok(vm.new_array(out))
}

pub fn string_match_all(vm: &mut Vm, s: StrId, pat: &Value) -> Res {
    let id = pattern_arg(vm, pat, "matchAll", "g")?;
    let r = data(vm, id);
    if !r.global() {
        let msg = format!(
            "String.matchAll requires a regular expression with the global (g) flag: write /{}/{}g, or use String.match for a single match.",
            r.source, r.flags
        );
        return Err(vm.type_error(&msg));
    }
    let last = r.last_index;
    let copy = clone_regexp(vm, id);
    let cid = copy.as_obj().unwrap_or(id);
    data_mut(vm, cid).last_index = last;
    let subject = Subject::new(vm, s);
    let unicode = data(vm, cid).full_unicode();
    let indices = data(vm, cid).has('d');
    let mut out = Vec::new();
    while let Some(m) = exec_raw(vm, cid, &subject)? {
        if out.len() >= MAX_ARRAY_LEN {
            return Err(vm.range_error("Invalid array length"));
        }
        out.push(match_array(vm, &subject, s, &m, indices));
        if m.start() == m.end() {
            let next = subject.advance(m.end(), unicode);
            data_mut(vm, cid).last_index = next as f64;
        }
    }
    Ok(vm.new_array(out))
}

pub fn string_search(vm: &mut Vm, s: StrId, pat: &Value) -> Res {
    let id = pattern_arg(vm, pat, "search", "")?;
    let subject = Subject::new(vm, s);
    let r = data(vm, id);
    let (sticky, unicode) = (r.sticky(), r.full_unicode());
    let m = find(&r.regex, unicode, &subject, 0);
    Ok(Value::Num(match m {
        Some(m) if !sticky || m.start() == 0 => m.start() as f64,
        _ => -1.0,
    }))
}

/// GetSubstitution: expands `$$`, `$&`, `` $` ``, `$'`, `$n`, `$nn` and `$<name>` in a replacement template.
pub fn substitute(
    template: &str,
    subject: &Subject,
    start: usize,
    end: usize,
    captures: &[Option<String>],
    groups: Option<&[(String, Option<String>)]>,
) -> String {
    let mut out = String::new();
    let t: Vec<char> = template.chars().collect();
    let m = captures.len();
    let mut i = 0;
    while i < t.len() {
        let c = t[i];
        if c != '$' || i + 1 >= t.len() {
            out.push(c);
            i += 1;
            continue;
        }
        let n = t[i + 1];
        match n {
            '$' => {
                out.push('$');
                i += 2;
            }
            '&' => {
                out.push_str(&subject.slice(start, end));
                i += 2;
            }
            '`' => {
                out.push_str(&subject.slice(0, start));
                i += 2;
            }
            '\'' => {
                out.push_str(&subject.slice(end, subject.len()));
                i += 2;
            }
            '0'..='9' => {
                let d1 = n as usize - '0' as usize;
                let two = t
                    .get(i + 2)
                    .filter(|c| c.is_ascii_digit())
                    .map(|c| d1 * 10 + (*c as usize - '0' as usize));
                if let Some(nn) = two
                    && nn >= 1
                    && nn <= m
                {
                    if let Some(s) = &captures[nn - 1] {
                        out.push_str(s);
                    }
                    i += 3;
                } else if d1 >= 1 && d1 <= m {
                    if let Some(s) = &captures[d1 - 1] {
                        out.push_str(s);
                    }
                    i += 2;
                } else {
                    out.push('$');
                    i += 1;
                }
            }
            '<' => match groups {
                None => {
                    out.push('$');
                    i += 1;
                }
                Some(groups) => {
                    let rest: String = t[i + 2..].iter().collect();
                    match rest.find('>') {
                        None => {
                            out.push('$');
                            i += 1;
                        }
                        Some(close) => {
                            let name = &rest[..close];
                            if let Some((_, Some(v))) = groups.iter().find(|(n, _)| n == name) {
                                out.push_str(v);
                            }
                            i += 2 + name.chars().count() + 1;
                        }
                    }
                }
            },
            _ => {
                out.push('$');
                i += 1;
            }
        }
    }
    out
}

struct Found {
    start: usize,
    end: usize,
    captures: Vec<Option<String>>,
    groups: Option<Vec<(String, Option<String>)>>,
}

fn collect_matches(vm: &mut Vm, id: Id, subject: &Subject, all: bool) -> Result<Vec<Found>, Value> {
    let unicode = data(vm, id).full_unicode();
    let global = data(vm, id).global();
    if global {
        data_mut(vm, id).last_index = 0.0;
    }
    let mut found = Vec::new();
    while let Some(m) = exec_raw(vm, id, subject)? {
        let captures = m
            .captures
            .iter()
            .map(|r| r.clone().map(|r| subject.slice(r.start, r.end)))
            .collect();
        let groups = if has_named_groups(&m) {
            Some(
                m.named_groups()
                    .map(|(n, r)| (n.to_owned(), r.map(|r| subject.slice(r.start, r.end))))
                    .collect(),
            )
        } else {
            None
        };
        found.push(Found {
            start: m.start(),
            end: m.end(),
            captures,
            groups,
        });
        if !global || !all {
            break;
        }
        if m.start() == m.end() {
            let next = subject.advance(m.end(), unicode);
            data_mut(vm, id).last_index = next as f64;
        }
    }
    Ok(found)
}

/// `replace`/`replaceAll` with a RegExp pattern, after the conversions `c` of the call.
pub fn string_replace(
    vm: &mut Vm,
    c: &super::fuel::Conversions,
    s: StrId,
    re: Id,
    rep: &Value,
    all: bool,
) -> Res {
    let r = data(vm, re);
    if all && !r.global() {
        let msg = format!(
            "String.replaceAll requires a regular expression with the global (g) flag: write /{}/{}g, or use String.replace to replace only the first match.",
            r.source, r.flags
        );
        return Err(vm.type_error(&msg));
    }
    let callable = vm.is_callable(rep);
    let template = if callable {
        None
    } else {
        let t = vm.string_of(rep)?;
        Some(vm.text(t).to_owned())
    };
    let subject = Subject::new(vm, s);
    let found = collect_matches(vm, re, &subject, true)?;
    // With a callback, the reference finds the matches, then hands them to its prelude's `replaceWith`.
    if callable {
        c.handoff(vm);
    }
    if found.is_empty() {
        if callable {
            vm.bytecode_builtin();
        }
        return Ok(Value::Str(s));
    }
    if template.is_none() {
        let mut gaps = Vec::with_capacity(found.len());
        let mut calls = Vec::with_capacity(found.len());
        let mut last = 0;
        for f in &found {
            gaps.push(vm.str_val(&subject.slice(last, f.start)));
            let mut cargs = Vec::with_capacity(f.captures.len() + 4);
            let whole = subject.slice(f.start, f.end);
            cargs.push(vm.string_val(whole));
            for c in &f.captures {
                let v = match c {
                    Some(c) => vm.str_val(c),
                    None => Value::Undef,
                };
                cargs.push(v);
            }
            cargs.push(Value::Num(f.start as f64));
            cargs.push(Value::Str(s));
            if let Some(groups) = &f.groups {
                let gid = vm.new_object();
                for (name, v) in groups {
                    let k = vm.atoms.intern(name);
                    let v = match v {
                        Some(v) => vm.str_val(v),
                        None => Value::Undef,
                    };
                    vm.define(gid, k, v);
                }
                cargs.push(Value::Obj(gid));
            }
            calls.push(cargs);
            last = f.end;
        }
        let tail = vm.str_val(&subject.slice(last, subject.len()));
        return super::string::enter_replace_with(vm, *rep, gaps, calls, tail, true);
    }
    let mut out = String::new();
    let mut last = 0;
    for f in &found {
        out.push_str(&subject.slice(last, f.start));
        if let Some(t) = &template {
            out.push_str(&substitute(
                t,
                &subject,
                f.start,
                f.end,
                &f.captures,
                f.groups.as_deref(),
            ));
        }
        if out.len() > MAX_STRING_LEN {
            return Err(vm.range_error("Invalid string length"));
        }
        last = f.end;
    }
    out.push_str(&subject.slice(last, subject.len()));
    if callable {
        vm.bytecode_builtin();
    }
    Ok(vm.string_val(out))
}

/// `split` with a RegExp separator, following the spec's sticky matching at each position.
pub fn string_split(vm: &mut Vm, s: StrId, re: Id, limit: Value) -> Res {
    let lim = match limit {
        Value::Undef => u32::MAX,
        v => crate::value::to_uint32(vm.number_of(&v)?),
    } as usize;
    let subject = Subject::new(vm, s);
    let r = data(vm, re);
    let unicode = r.full_unicode();
    let regex = r.regex.clone();
    let mut out: Vec<Value> = Vec::new();
    if lim == 0 {
        return Ok(vm.new_array(out));
    }
    let size = subject.len();
    if size == 0 {
        if find(&regex, unicode, &subject, 0).is_some_and(|m| m.start() == 0) {
            return Ok(vm.new_array(out));
        }
        return Ok(vm.new_array(vec![Value::Str(s)]));
    }
    let mut p = 0;
    let mut q = 0;
    while q < size {
        let Some(m) = find(&regex, unicode, &subject, q) else {
            break;
        };
        if m.start() >= size {
            break;
        }
        q = m.start();
        let e = m.end().min(size);
        if e == p {
            q = subject.advance(q, unicode);
            continue;
        }
        let piece = subject.slice(p, q);
        out.push(vm.string_val(piece));
        if out.len() >= lim {
            return Ok(vm.new_array(out));
        }
        for c in &m.captures {
            let v = opt_str(vm, &subject, c.clone());
            out.push(v);
            if out.len() >= lim {
                return Ok(vm.new_array(out));
            }
        }
        if out.len() >= MAX_ARRAY_LEN {
            return Err(vm.range_error("Invalid array length"));
        }
        p = e;
        q = p;
    }
    let tail = subject.slice(p, size);
    out.push(vm.string_val(tail));
    Ok(vm.new_array(out))
}
