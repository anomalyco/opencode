//! JSONC parsing and path edits that keep comments and formatting (F.5).
//!
//! A port of the parts of `jsonc-parser` 3.3.1 the TypeScript client uses
//! (`lib/esm/impl/{scanner,parser,edit,format}.js`): the scanner, the fault-tolerant tree, `parse` with
//! `allowTrailingComma`, and `modify` with `{ tabSize: 2, insertSpaces: true }` formatting. Edits come
//! out byte for byte as the TypeScript `applyEdits(text, modify(...))` gives them; see `docs/F.5.md`.
//!
//! Offsets are UTF-8 byte offsets where the library uses UTF-16 units. Every split is at a token
//! boundary and the formatter counts only ASCII spaces, tabs, and line breaks, so the text that comes
//! out is the same.

use serde_json::{Map, Number, Value};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Token {
    OpenBrace,
    CloseBrace,
    OpenBracket,
    CloseBracket,
    Comma,
    Colon,
    Null,
    True,
    False,
    String,
    Number,
    LineComment,
    BlockComment,
    LineBreak,
    Trivia,
    Unknown,
    Eof,
}

/// The token scanner of `scanner.js`, always with trivia.
pub struct Scanner<'a> {
    text: &'a [u8],
    pos: usize,
    value: String,
    token_offset: usize,
    token: Token,
    error: bool,
}

impl<'a> Scanner<'a> {
    pub fn new(text: &'a str) -> Self {
        Self {
            text: text.as_bytes(),
            pos: 0,
            value: String::new(),
            token_offset: 0,
            token: Token::Unknown,
            error: false,
        }
    }

    pub fn set_position(&mut self, pos: usize) {
        self.pos = pos;
        self.value.clear();
        self.token_offset = 0;
        self.token = Token::Unknown;
        self.error = false;
    }

    pub fn token(&self) -> Token {
        self.token
    }

    pub fn value(&self) -> &str {
        &self.value
    }

    pub fn offset(&self) -> usize {
        self.token_offset
    }

    pub fn length(&self) -> usize {
        self.pos - self.token_offset
    }

    /// Whether the last token had a scan error.
    pub fn error(&self) -> bool {
        self.error
    }

    // `charCodeAt` past the end is NaN in JS, which matches nothing; 0 matches nothing either here.
    fn at(&self, pos: usize) -> u8 {
        self.text.get(pos).copied().unwrap_or(0)
    }

    fn slice(&self, start: usize, end: usize) -> &'a str {
        let len = self.text.len();
        std::str::from_utf8(&self.text[start.min(len)..end.min(len)]).unwrap_or("")
    }

    pub fn scan(&mut self) -> Token {
        self.token = self.scan_next();
        self.token
    }

    fn scan_next(&mut self) -> Token {
        self.value.clear();
        self.error = false;
        self.token_offset = self.pos;
        let len = self.text.len();
        if self.pos >= len {
            self.token_offset = len;
            return Token::Eof;
        }
        let code = self.at(self.pos);
        if is_white_space(code) {
            while is_white_space(self.at(self.pos)) && self.pos < len {
                self.pos += 1;
            }
            return Token::Trivia;
        }
        if is_line_break(code) {
            self.pos += 1;
            if code == b'\r' && self.at(self.pos) == b'\n' {
                self.pos += 1;
            }
            return Token::LineBreak;
        }
        match code {
            b'{' => self.single(Token::OpenBrace),
            b'}' => self.single(Token::CloseBrace),
            b'[' => self.single(Token::OpenBracket),
            b']' => self.single(Token::CloseBracket),
            b':' => self.single(Token::Colon),
            b',' => self.single(Token::Comma),
            b'"' => {
                self.pos += 1;
                self.value = self.scan_string();
                Token::String
            }
            b'/' => {
                let start = self.pos;
                if self.at(self.pos + 1) == b'/' {
                    self.pos += 2;
                    while self.pos < len && !is_line_break(self.at(self.pos)) {
                        self.pos += 1;
                    }
                    self.value = self.slice(start, self.pos).to_string();
                    return Token::LineComment;
                }
                if self.at(self.pos + 1) == b'*' {
                    self.pos += 2;
                    let mut closed = false;
                    while self.pos + 1 < len {
                        if self.at(self.pos) == b'*' && self.at(self.pos + 1) == b'/' {
                            self.pos += 2;
                            closed = true;
                            break;
                        }
                        self.pos += 1;
                    }
                    if !closed {
                        // JS steps one past the end here; the clamp only shortens an error token.
                        self.pos = (self.pos + 1).min(len);
                        self.error = true;
                    }
                    self.value = self.slice(start, self.pos).to_string();
                    return Token::BlockComment;
                }
                self.single(Token::Unknown)
            }
            b'-' => {
                self.pos += 1;
                if self.pos == len || !self.at(self.pos).is_ascii_digit() {
                    return Token::Unknown;
                }
                self.pos -= 1;
                self.value = self.scan_number();
                Token::Number
            }
            b'0'..=b'9' => {
                self.value = self.scan_number();
                Token::Number
            }
            _ => {
                while self.pos < len && is_unknown_content(self.at(self.pos)) {
                    self.pos += 1;
                }
                if self.token_offset != self.pos {
                    return match self.slice(self.token_offset, self.pos) {
                        "true" => Token::True,
                        "false" => Token::False,
                        "null" => Token::Null,
                        _ => Token::Unknown,
                    };
                }
                self.single(Token::Unknown)
            }
        }
    }

    fn single(&mut self, token: Token) -> Token {
        self.pos += 1;
        token
    }

    // Starts at the sign or first digit; returns the literal text up to the last valid digit.
    fn scan_number(&mut self) -> String {
        let start = self.pos;
        let len = self.text.len();
        if self.at(self.pos) == b'-' {
            self.pos += 1;
        }
        if self.at(self.pos) == b'0' {
            self.pos += 1;
        } else {
            self.pos += 1;
            while self.pos < len && self.at(self.pos).is_ascii_digit() {
                self.pos += 1;
            }
        }
        if self.pos < len && self.at(self.pos) == b'.' {
            self.pos += 1;
            if self.pos < len && self.at(self.pos).is_ascii_digit() {
                while self.pos < len && self.at(self.pos).is_ascii_digit() {
                    self.pos += 1;
                }
            } else {
                self.error = true;
                return self.slice(start, self.pos).to_string();
            }
        }
        let mut end = self.pos;
        if self.pos < len && matches!(self.at(self.pos), b'E' | b'e') {
            self.pos += 1;
            if self.pos < len && self.at(self.pos) == b'+' || self.at(self.pos) == b'-' {
                self.pos += 1;
            }
            if self.pos < len && self.at(self.pos).is_ascii_digit() {
                while self.pos < len && self.at(self.pos).is_ascii_digit() {
                    self.pos += 1;
                }
                end = self.pos;
            } else {
                self.error = true;
            }
        }
        self.slice(start, end).to_string()
    }

    fn scan_string(&mut self) -> String {
        let len = self.text.len();
        let mut result = String::new();
        let mut start = self.pos;
        // A `\u` high surrogate waiting for its low half, as JS strings hold UTF-16 units.
        let mut high: Option<u16> = None;
        let flush = |result: &mut String, high: &mut Option<u16>| {
            if high.take().is_some() {
                result.push('\u{FFFD}');
            }
        };
        loop {
            if self.pos >= len {
                flush(&mut result, &mut high);
                result.push_str(self.slice(start, self.pos));
                self.error = true;
                break;
            }
            let ch = self.at(self.pos);
            if ch == b'"' {
                flush(&mut result, &mut high);
                result.push_str(self.slice(start, self.pos));
                self.pos += 1;
                break;
            }
            if ch == b'\\' {
                if start != self.pos {
                    flush(&mut result, &mut high);
                }
                result.push_str(self.slice(start, self.pos));
                self.pos += 1;
                if self.pos >= len {
                    flush(&mut result, &mut high);
                    self.error = true;
                    break;
                }
                let escape = self.at(self.pos);
                self.pos += 1;
                if escape != b'u' {
                    flush(&mut result, &mut high);
                }
                match escape {
                    b'"' => result.push('"'),
                    b'\\' => result.push('\\'),
                    b'/' => result.push('/'),
                    b'b' => result.push('\u{8}'),
                    b'f' => result.push('\u{c}'),
                    b'n' => result.push('\n'),
                    b'r' => result.push('\r'),
                    b't' => result.push('\t'),
                    b'u' => match self.scan_hex4() {
                        Some(unit) => {
                            if (0xDC00..0xE000).contains(&unit)
                                && let Some(h) = high.take()
                            {
                                let code = 0x10000
                                    + ((u32::from(h) - 0xD800) << 10)
                                    + (u32::from(unit) - 0xDC00);
                                result.push(char::from_u32(code).unwrap_or('\u{FFFD}'));
                            } else {
                                flush(&mut result, &mut high);
                                if (0xD800..0xDC00).contains(&unit) {
                                    high = Some(unit);
                                } else {
                                    result
                                        .push(char::from_u32(u32::from(unit)).unwrap_or('\u{FFFD}'));
                                }
                            }
                        }
                        None => {
                            flush(&mut result, &mut high);
                            self.error = true;
                        }
                    },
                    _ => self.error = true,
                }
                start = self.pos;
                continue;
            }
            if ch <= 0x1f {
                if is_line_break(ch) {
                    flush(&mut result, &mut high);
                    result.push_str(self.slice(start, self.pos));
                    self.error = true;
                    break;
                }
                self.error = true;
            }
            self.pos += 1;
        }
        result
    }

    fn scan_hex4(&mut self) -> Option<u16> {
        let mut value: u16 = 0;
        for _ in 0..4 {
            let digit = (self.at(self.pos) as char).to_digit(16)?;
            value = value * 16 + digit as u16;
            self.pos += 1;
        }
        Some(value)
    }
}

fn is_white_space(ch: u8) -> bool {
    ch == b' ' || ch == b'\t'
}

fn is_line_break(ch: u8) -> bool {
    ch == b'\n' || ch == b'\r'
}

fn is_unknown_content(ch: u8) -> bool {
    !(is_white_space(ch)
        || is_line_break(ch)
        || matches!(ch, b'}' | b']' | b'{' | b'[' | b'"' | b':' | b',' | b'/'))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Object,
    Array,
    Property,
    String,
    Number,
    Boolean,
    Null,
}

#[derive(Clone, Debug)]
pub struct Node {
    pub kind: Kind,
    pub offset: usize,
    pub length: usize,
    pub parent: Option<usize>,
    pub children: Vec<usize>,
    pub value: Value,
}

/// The tree of `parseTree`. Node 0 is the library's artificial root; `root()` is its first child.
pub struct Tree {
    pub nodes: Vec<Node>,
    pub errors: usize,
}

impl Tree {
    pub fn root(&self) -> Option<usize> {
        self.nodes[0].children.first().copied()
    }

    pub fn node(&self, id: usize) -> &Node {
        &self.nodes[id]
    }

    /// `findNodeAtLocation`.
    pub fn find(&self, from: Option<usize>, path: &[Segment]) -> Option<usize> {
        let mut node = from?;
        for segment in path {
            let current = &self.nodes[node];
            node = match segment {
                Segment::Key(key) => {
                    if current.kind != Kind::Object {
                        return None;
                    }
                    let property = current.children.iter().find(|&&property| {
                        let children = &self.nodes[property].children;
                        children.len() == 2 && self.nodes[children[0]].value.as_str() == Some(key)
                    })?;
                    self.nodes[*property].children[1]
                }
                Segment::Index(index) => {
                    if current.kind != Kind::Array {
                        return None;
                    }
                    *current.children.get(*index)?
                }
            };
        }
        Some(node)
    }

    /// `getNodeValue`.
    pub fn value(&self, id: usize) -> Value {
        let node = &self.nodes[id];
        match node.kind {
            Kind::Array => Value::Array(node.children.iter().map(|&c| self.value(c)).collect()),
            Kind::Object => {
                let mut map = Map::new();
                for &property in &node.children {
                    let children = &self.nodes[property].children;
                    if let (Some(&key), Some(&value)) = (children.first(), children.get(1))
                        && let Some(key) = self.nodes[key].value.as_str()
                    {
                        map.insert(key.to_string(), self.value(value));
                    }
                }
                Value::Object(map)
            }
            Kind::Property => Value::Null,
            _ => node.value.clone(),
        }
    }
}

/// `parseTree(text, errors, { allowTrailingComma: true })`.
pub fn parse_tree(text: &str) -> Tree {
    let mut parser = Parser {
        scanner: Scanner::new(text),
        tree: Tree {
            nodes: vec![node(Kind::Array, 0, None, Value::Null)],
            errors: 0,
        },
        current: 0,
    };
    parser.run();
    parser.tree
}

/// `parse(text, errors, { allowTrailingComma: true })`, or `None` when there are errors.
pub fn parse(text: &str) -> Option<Value> {
    let tree = parse_tree(text);
    if tree.errors > 0 {
        return None;
    }
    Some(tree.value(tree.root()?))
}

fn node(kind: Kind, offset: usize, parent: Option<usize>, value: Value) -> Node {
    Node {
        kind,
        offset,
        length: 0,
        parent,
        children: Vec::new(),
        value,
    }
}

struct Parser<'a> {
    scanner: Scanner<'a>,
    tree: Tree,
    current: usize,
}

impl Parser<'_> {
    fn push(&mut self, kind: Kind, value: Value) -> usize {
        let id = self.tree.nodes.len();
        let offset = self.scanner.offset();
        self.tree
            .nodes
            .push(node(kind, offset, Some(self.current), value));
        self.tree.nodes[self.current].children.push(id);
        id
    }

    fn ensure_property_complete(&mut self, end: usize) {
        let current = &mut self.tree.nodes[self.current];
        if current.kind == Kind::Property {
            current.length = end - current.offset;
            self.current = current.parent.unwrap_or(0);
        }
    }

    fn end_container(&mut self, object: bool) {
        let end = self.scanner.offset() + self.scanner.length();
        if object {
            self.ensure_property_complete(end);
        }
        let current = &mut self.tree.nodes[self.current];
        current.length = end - current.offset;
        self.current = current.parent.unwrap_or(0);
        self.ensure_property_complete(end);
    }

    fn literal(&mut self, kind: Kind, value: Value) {
        let length = self.scanner.length();
        let id = self.push(kind, value);
        self.tree.nodes[id].length = length;
        let end = self.scanner.offset() + length;
        self.ensure_property_complete(end);
    }

    fn separator(&mut self, comma: bool) {
        if comma && self.tree.nodes[self.current].kind == Kind::Property {
            let offset = self.scanner.offset();
            self.ensure_property_complete(offset);
        }
    }

    fn scan_next(&mut self) -> Token {
        loop {
            let token = self.scanner.scan();
            if self.scanner.error() {
                self.tree.errors += 1;
            }
            match token {
                Token::LineComment | Token::BlockComment | Token::Trivia | Token::LineBreak => {}
                Token::Unknown => self.tree.errors += 1,
                _ => return token,
            }
        }
    }

    fn handle_error(&mut self, skip_until_after: &[Token], skip_until: &[Token]) {
        self.tree.errors += 1;
        if skip_until_after.is_empty() && skip_until.is_empty() {
            return;
        }
        let mut token = self.scanner.token();
        while token != Token::Eof {
            if skip_until_after.contains(&token) {
                self.scan_next();
                break;
            }
            if skip_until.contains(&token) {
                break;
            }
            token = self.scan_next();
        }
    }

    fn parse_literal(&mut self) -> bool {
        match self.scanner.token() {
            Token::Number => {
                let number = js_number(self.scanner.value());
                self.literal(Kind::Number, number);
            }
            Token::Null => self.literal(Kind::Null, Value::Null),
            Token::True => self.literal(Kind::Boolean, Value::Bool(true)),
            Token::False => self.literal(Kind::Boolean, Value::Bool(false)),
            _ => return false,
        }
        self.scan_next();
        true
    }

    fn parse_property(&mut self) -> bool {
        if self.scanner.token() != Token::String {
            self.handle_error(&[], &[Token::CloseBrace, Token::Comma]);
            return false;
        }
        let name = Value::String(self.scanner.value().to_string());
        let length = self.scanner.length();
        let property = self.push(Kind::Property, Value::Null);
        self.current = property;
        let key = self.push(Kind::String, name);
        self.tree.nodes[key].length = length;
        self.scan_next();
        if self.scanner.token() == Token::Colon {
            self.scan_next();
            if !self.parse_value() {
                self.handle_error(&[], &[Token::CloseBrace, Token::Comma]);
            }
        } else {
            self.handle_error(&[], &[Token::CloseBrace, Token::Comma]);
        }
        true
    }

    fn parse_container(&mut self, object: bool) -> bool {
        let (kind, close) = if object {
            (Kind::Object, Token::CloseBrace)
        } else {
            (Kind::Array, Token::CloseBracket)
        };
        self.current = self.push(kind, Value::Null);
        self.scan_next();
        let mut needs_comma = false;
        while self.scanner.token() != close && self.scanner.token() != Token::Eof {
            if self.scanner.token() == Token::Comma {
                if !needs_comma {
                    self.handle_error(&[], &[]);
                }
                self.separator(true);
                self.scan_next();
                if self.scanner.token() == close {
                    break;
                }
            } else if needs_comma {
                self.handle_error(&[], &[]);
            }
            let parsed = if object {
                self.parse_property()
            } else {
                self.parse_value()
            };
            if !parsed {
                self.handle_error(&[], &[close, Token::Comma]);
            }
            needs_comma = true;
        }
        self.end_container(object);
        if self.scanner.token() != close {
            self.handle_error(&[close], &[]);
        } else {
            self.scan_next();
        }
        true
    }

    fn parse_value(&mut self) -> bool {
        match self.scanner.token() {
            Token::OpenBracket => self.parse_container(false),
            Token::OpenBrace => self.parse_container(true),
            Token::String => {
                let value = Value::String(self.scanner.value().to_string());
                self.literal(Kind::String, value);
                self.scan_next();
                true
            }
            _ => self.parse_literal(),
        }
    }

    fn run(&mut self) {
        self.scan_next();
        if self.scanner.token() == Token::Eof {
            self.handle_error(&[], &[]);
            return;
        }
        if !self.parse_value() {
            self.handle_error(&[], &[]);
            return;
        }
        if self.scanner.token() != Token::Eof {
            self.handle_error(&[], &[]);
        }
    }
}

// `Number(literal)`; integral values within 2^53 become integers so they print as JS prints them.
fn js_number(text: &str) -> Value {
    number(text.parse::<f64>().unwrap_or(0.0))
}

/// A JSON number from an `f64`, stored as an integer when it is one (JS has a single number type).
pub fn number(value: f64) -> Value {
    if value.fract() == 0.0 && value.abs() < 9_007_199_254_740_992.0 {
        return Value::Number(Number::from(value as i64));
    }
    Number::from_f64(value).map_or(Value::Null, Value::Number)
}

/// JS equality of two JSON values: numbers compare by value, objects regardless of key order.
pub fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b).all(|(a, b)| same(a, b))
        }
        (Value::Object(a), Value::Object(b)) => {
            a.len() == b.len()
                && a.iter()
                    .all(|(key, a)| b.get(key).is_some_and(|b| same(a, b)))
        }
        _ => a == b,
    }
}

/// `JSON.stringify(value)`.
pub fn stringify(value: &Value) -> String {
    let mut out = String::new();
    write_value(&mut out, value, None, 0);
    out
}

/// `JSON.stringify(value, null, 2)`.
pub fn stringify_pretty(value: &Value) -> String {
    let mut out = String::new();
    write_value(&mut out, value, Some(2), 0);
    out
}

fn write_value(out: &mut String, value: &Value, indent: Option<usize>, depth: usize) {
    let newline = |out: &mut String, depth: usize| {
        if let Some(width) = indent {
            out.push('\n');
            out.extend(std::iter::repeat_n(' ', width * depth));
        }
    };
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(value) => out.push_str(if *value { "true" } else { "false" }),
        Value::Number(number) => out.push_str(&number_text(number)),
        Value::String(text) => out.push_str(&serde_json::to_string(text).unwrap_or_default()),
        Value::Array(items) => {
            if items.is_empty() {
                out.push_str("[]");
                return;
            }
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                newline(out, depth + 1);
                write_value(out, item, indent, depth + 1);
            }
            newline(out, depth);
            out.push(']');
        }
        Value::Object(map) => {
            if map.is_empty() {
                out.push_str("{}");
                return;
            }
            out.push('{');
            for (index, (key, item)) in map.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                newline(out, depth + 1);
                out.push_str(&serde_json::to_string(key).unwrap_or_default());
                out.push(':');
                if indent.is_some() {
                    out.push(' ');
                }
                write_value(out, item, indent, depth + 1);
            }
            newline(out, depth);
            out.push('}');
        }
    }
}

// `Number.prototype.toString` for finite numbers.
fn number_text(number: &Number) -> String {
    if let Some(value) = number.as_i64() {
        return value.to_string();
    }
    if let Some(value) = number.as_u64() {
        return value.to_string();
    }
    let value = number.as_f64().unwrap_or(0.0);
    if value == 0.0 {
        return "0".to_string();
    }
    // `{:e}` gives the shortest round-trip digits, as JS does: `d.ddde<exp>`.
    let scientific = format!("{:e}", value.abs());
    let (mantissa, exponent) = scientific.split_once('e').unwrap_or((&scientific, "0"));
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i32;
    let n = exponent.parse::<i32>().unwrap_or(0) + 1;
    let sign = if value < 0.0 { "-" } else { "" };
    let body = if k <= n && n <= 21 {
        digits + &"0".repeat((n - k) as usize)
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{}", "0".repeat((-n) as usize), digits)
    } else {
        let exp = n - 1;
        let exp = if exp >= 0 {
            format!("+{exp}")
        } else {
            exp.to_string()
        };
        if k == 1 {
            format!("{digits}e{exp}")
        } else {
            format!("{}.{}e{exp}", &digits[..1], &digits[1..])
        }
    };
    format!("{sign}{body}")
}

/// A path segment of `modify`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Segment {
    Key(String),
    Index(usize),
}

impl From<&str> for Segment {
    fn from(key: &str) -> Self {
        Segment::Key(key.to_string())
    }
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum EditError {
    #[error("Can not delete in empty document")]
    DeleteInEmpty,
    #[error("Can not add {0} to parent of type {1}")]
    WrongParent(&'static str, &'static str),
    #[error("Can not {0} Array index {1} as length is not sufficient")]
    ArrayIndex(&'static str, usize),
}

/// `applyEdits(text, modify(text, path, value, { formattingOptions: { tabSize: 2, insertSpaces: true } }))`.
/// `None` removes the property or item.
pub fn modify(text: &str, path: &[Segment], value: Option<&Value>) -> Result<String, EditError> {
    let tree = parse_tree(text);
    let root = tree.root();
    let mut path = path.to_vec();
    let mut value = value.cloned();
    let mut parent = None;
    let mut last = None;
    while let Some(segment) = path.pop() {
        parent = tree.find(root, &path);
        last = Some(segment.clone());
        if parent.is_none()
            && let Some(inner) = value.take()
        {
            value = Some(match segment {
                Segment::Key(key) => Value::Object(Map::from_iter([(key, inner)])),
                Segment::Index(_) => Value::Array(vec![inner]),
            });
            continue;
        }
        break;
    }
    let Some(parent) = parent else {
        let Some(value) = value else {
            return Err(EditError::DeleteInEmpty);
        };
        let (offset, length) = root.map_or((0, 0), |r| (tree.node(r).offset, tree.node(r).length));
        return Ok(with_formatting(text, offset, length, &stringify(&value)));
    };
    let parent_node = tree.node(parent);
    let end = |id: usize| tree.node(id).offset + tree.node(id).length;
    match (parent_node.kind, last) {
        (Kind::Object, Some(Segment::Key(key))) => {
            let existing = tree.find(Some(parent), &[Segment::Key(key.clone())]);
            match (existing, value) {
                (Some(existing), None) => {
                    let property = tree.node(existing).parent.unwrap_or(existing);
                    let index = parent_node
                        .children
                        .iter()
                        .position(|&c| c == property)
                        .unwrap_or(0);
                    let mut remove_end = end(property);
                    let remove_begin = if index > 0 {
                        end(parent_node.children[index - 1])
                    } else {
                        if parent_node.children.len() > 1 {
                            remove_end = tree.node(parent_node.children[1]).offset;
                        }
                        parent_node.offset + 1
                    };
                    Ok(with_formatting(
                        text,
                        remove_begin,
                        remove_end - remove_begin,
                        "",
                    ))
                }
                (Some(existing), Some(value)) => {
                    let node = tree.node(existing);
                    Ok(with_formatting(
                        text,
                        node.offset,
                        node.length,
                        &stringify(&value),
                    ))
                }
                (None, None) => Ok(text.to_string()),
                (None, Some(value)) => {
                    let property = format!(
                        "{}: {}",
                        stringify(&Value::String(key)),
                        stringify(&value)
                    );
                    let (offset, content) = match parent_node.children.last() {
                        Some(&previous) => (end(previous), format!(",{property}")),
                        None => (parent_node.offset + 1, property),
                    };
                    Ok(with_formatting(text, offset, 0, &content))
                }
            }
        }
        (Kind::Array, Some(Segment::Index(index))) => {
            let children = &parent_node.children;
            match value {
                None => {
                    if index >= children.len() {
                        return Err(EditError::ArrayIndex("remove", index));
                    }
                    let (offset, length) = if children.len() == 1 {
                        (parent_node.offset + 1, parent_node.length - 2)
                    } else if children.len() - 1 == index {
                        let offset = end(children[index - 1]);
                        (offset, parent_node.offset + parent_node.length - 2 - offset)
                    } else {
                        let offset = tree.node(children[index]).offset;
                        (offset, tree.node(children[index + 1]).offset - offset)
                    };
                    Ok(with_formatting(text, offset, length, ""))
                }
                Some(value) => {
                    let item = stringify(&value);
                    if children.len() > index {
                        let node = tree.node(children[index]);
                        return Ok(with_formatting(text, node.offset, node.length, &item));
                    }
                    if children.is_empty() || index == 0 {
                        let content = if children.is_empty() {
                            item
                        } else {
                            format!("{item},")
                        };
                        return Ok(with_formatting(text, parent_node.offset + 1, 0, &content));
                    }
                    let previous = children[index.min(children.len()) - 1];
                    Ok(with_formatting(text, end(previous), 0, &format!(",{item}")))
                }
            }
        }
        (kind, last) => Err(EditError::WrongParent(
            match last {
                Some(Segment::Index(_)) => "property",
                _ => "index",
            },
            match kind {
                Kind::Object => "object",
                Kind::Array => "array",
                Kind::Property => "property",
                Kind::String => "string",
                Kind::Number => "number",
                Kind::Boolean => "boolean",
                Kind::Null => "null",
            },
        )),
    }
}

/// `withFormatting`: applies one edit and formats the lines it touched.
fn with_formatting(text: &str, offset: usize, length: usize, content: &str) -> String {
    let mut new_text = format!("{}{}{}", &text[..offset], content, &text[offset + length..]);
    let bytes = new_text.as_bytes();
    let mut begin = offset;
    let mut end = offset + content.len();
    if length == 0 || content.is_empty() {
        while begin > 0 && !is_line_break(bytes[begin - 1]) {
            begin -= 1;
        }
        while end < bytes.len() && !is_line_break(bytes[end]) {
            end += 1;
        }
    }
    for edit in format_range(&new_text, begin, end).iter().rev() {
        new_text.replace_range(edit.offset..edit.offset + edit.length, &edit.content);
    }
    new_text
}

struct Edit {
    offset: usize,
    length: usize,
    content: String,
}

/// `format(text, range, { tabSize: 2, insertSpaces: true, keepLines: false })`.
fn format_range(document: &str, range_start: usize, range_end: usize) -> Vec<Edit> {
    const INDENT: &str = "  ";
    let bytes = document.as_bytes();
    let mut start = range_start;
    while start > 0 && !is_line_break(bytes[start - 1]) {
        start -= 1;
    }
    let mut stop = range_end;
    while stop < bytes.len() && !is_line_break(bytes[stop]) {
        stop += 1;
    }
    let text = &document[start..stop];
    let initial_level = {
        let columns: usize = text
            .bytes()
            .take_while(|b| *b == b' ' || *b == b'\t')
            .map(|b| if b == b' ' { 1 } else { 2 })
            .sum();
        (columns / 2) as i64
    };
    let eol = match bytes.iter().position(|b| is_line_break(*b)) {
        Some(i) if bytes[i] == b'\r' && bytes.get(i + 1) == Some(&b'\n') => "\r\n",
        Some(i) if bytes[i] == b'\r' => "\r",
        _ => "\n",
    };

    let mut scanner = Scanner::new(text);
    let mut line_breaks = false;
    let mut has_error = false;
    let mut level: i64 = 0;
    let mut edits = Vec::new();

    let scan = |scanner: &mut Scanner, line_breaks: &mut bool, has_error: &mut bool| {
        let mut token = scanner.scan();
        *line_breaks = false;
        while matches!(token, Token::Trivia | Token::LineBreak) {
            if token == Token::LineBreak {
                *line_breaks = true;
            }
            token = scanner.scan();
        }
        *has_error = token == Token::Unknown || scanner.error();
        token
    };
    let indent = |level: i64| {
        format!(
            "{eol}{}",
            INDENT.repeat((initial_level + level).max(0) as usize)
        )
    };
    let mut add = |has_error: bool, content: String, from: usize, to: usize| {
        if !has_error && from < range_end && to > range_start && document[from..to] != content {
            edits.push(Edit {
                offset: from,
                length: to - from,
                content,
            });
        }
    };

    let mut first = scan(&mut scanner, &mut line_breaks, &mut has_error);
    if first != Token::Eof {
        let first_start = scanner.offset() + start;
        add(
            has_error,
            INDENT.repeat(initial_level as usize),
            start,
            first_start,
        );
    }
    while first != Token::Eof {
        let mut first_end = scanner.offset() + scanner.length() + start;
        let mut second = scan(&mut scanner, &mut line_breaks, &mut has_error);
        let mut replace = String::new();
        let mut needs_line_break = false;
        while !line_breaks && matches!(second, Token::LineComment | Token::BlockComment) {
            let comment_start = scanner.offset() + start;
            add(has_error, " ".to_string(), first_end, comment_start);
            first_end = scanner.offset() + scanner.length() + start;
            needs_line_break = second == Token::LineComment;
            replace = if needs_line_break {
                indent(level)
            } else {
                String::new()
            };
            second = scan(&mut scanner, &mut line_breaks, &mut has_error);
        }
        if second == Token::CloseBrace || second == Token::CloseBracket {
            let open = if second == Token::CloseBrace {
                Token::OpenBrace
            } else {
                Token::OpenBracket
            };
            if first != open {
                level -= 1;
                replace = indent(level);
            }
        } else {
            match first {
                Token::OpenBracket | Token::OpenBrace => {
                    level += 1;
                    replace = indent(level);
                }
                Token::Comma | Token::LineComment => replace = indent(level),
                Token::BlockComment => {
                    if line_breaks {
                        replace = indent(level);
                    } else if !needs_line_break {
                        replace = " ".to_string();
                    }
                }
                Token::Colon => {
                    if !needs_line_break {
                        replace = " ".to_string();
                    }
                }
                Token::String => {
                    if second == Token::Colon && !needs_line_break {
                        replace = String::new();
                    }
                }
                Token::Null
                | Token::True
                | Token::False
                | Token::Number
                | Token::CloseBrace
                | Token::CloseBracket => {
                    if matches!(second, Token::LineComment | Token::BlockComment)
                        && !needs_line_break
                    {
                        replace = " ".to_string();
                    } else if second != Token::Comma && second != Token::Eof {
                        has_error = true;
                    }
                }
                Token::Unknown => has_error = true,
                _ => {}
            }
            if line_breaks && matches!(second, Token::LineComment | Token::BlockComment) {
                replace = indent(level);
            }
        }
        if second == Token::Eof {
            replace = String::new();
        }
        let second_start = scanner.offset() + start;
        add(has_error, replace, first_end, second_start);
        first = second;
    }
    edits
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn key(path: &[&str]) -> Vec<Segment> {
        path.iter().map(|&k| Segment::from(k)).collect()
    }

    #[test]
    fn parses_jsonc_like_the_library() {
        assert_eq!(
            parse("// c\n{\"a\": [1, 2,], /* b */ \"b\": {\"c\": null,},}"),
            Some(json!({"a": [1, 2], "b": {"c": null}}))
        );
        assert_eq!(parse("{\"a\": 1, \"a\": 2}"), Some(json!({"a": 2})));
        assert_eq!(parse("{\"a\": \"\\ud83d\\ude00\"}"), Some(json!({"a": "😀"})));
        assert_eq!(parse(""), None);
        assert_eq!(parse("{\"a\" 1}"), None);
        assert_eq!(parse("{a: 1}"), None);
        assert_eq!(parse("[01]"), None);
        assert_eq!(parse("{\"a\": 1} x"), None);
    }

    #[test]
    fn stringify_formats_numbers_as_javascript() {
        let cases = [
            (1.0, "1"),
            (0.4, "0.4"),
            (-2.5, "-2.5"),
            (1e21, "1e+21"),
            (1.5e-7, "1.5e-7"),
            (0.000001, "0.000001"),
            (123456789012345680000.0, "123456789012345680000"),
            (1e300, "1e+300"),
        ];
        for (value, text) in cases {
            assert_eq!(stringify(&number(value)), text, "{value}");
        }
        assert_eq!(
            stringify_pretty(&json!({"a": [1, {}], "b": "\u{1}"})),
            "{\n  \"a\": [\n    1,\n    {}\n  ],\n  \"b\": \"\\u0001\"\n}"
        );
    }

    #[test]
    fn modify_inserts_replaces_and_removes() {
        let text = "{\n  // keep\n  \"a\": 1\n}\n";
        assert_eq!(
            modify(text, &key(&["b", "c"]), Some(&json!(true))).unwrap(),
            "{\n  // keep\n  \"a\": 1,\n  \"b\": {\n    \"c\": true\n  }\n}\n"
        );
        assert_eq!(
            modify(text, &key(&["a"]), Some(&json!("x"))).unwrap(),
            "{\n  // keep\n  \"a\": \"x\"\n}\n"
        );
        assert_eq!(
            modify(text, &key(&["a"]), None).unwrap(),
            "{\n}\n"
        );
        assert_eq!(
            modify("", &key(&["a"]), Some(&json!(1))).unwrap(),
            "{\n  \"a\": 1\n}"
        );
        assert_eq!(modify(text, &key(&["z"]), None).unwrap(), text);
    }
}
