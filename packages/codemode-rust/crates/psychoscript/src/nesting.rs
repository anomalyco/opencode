//! A cheap upper bound on how deeply a program's syntax nests, read from its bytes without parsing. Parsing and
//! compiling recurse once per level of syntax, and the parser has no guard of its own: a bound that came out too low
//! could overflow the native stack, which aborts the process. So the bound is conservative by construction: wherever
//! the scan cannot tell how the parser reads the source, it takes a reading that can only count more.
//!
//! Within one bracket group, a path through the syntax tree passes at most one node per token of the statement or
//! list item it is in, so the bound adds the tokens of the longest item in each group along the deepest chain of
//! groups. `;`, `,` and line breaks where a statement cannot continue end an item. `else` and `do` chain statements
//! across semicolons, so they count for the whole group.
//!
//! The only doubt in reading JavaScript without parsing it is whether a `/` starts a regular expression or divides.
//! Each `/` is a regex, a division, or either, by the token before it. From a `/` that may be either, the rest of the
//! line is counted raw: every non-blank byte is a token, every opening bracket opens a group, and closing brackets
//! close nothing. No reading of that line can nest deeper than that, and the readings agree again at the line's end,
//! unless the line can start something that spans lines (a template, a block comment, a string continued with a
//! backslash); then, as after source the parser cannot tokenize, everything to the end counts raw.

/// The bound for `code`: never less than its deepest syntax nesting, close to it for ordinary programs.
pub fn bound(code: &str) -> usize {
    let mut scan = Scan {
        src: code.as_bytes(),
        at: 0,
        frames: vec![Frame::new(b'\0', false)],
        prev: START,
        newline: false,
        control: false,
        dot: false,
    };
    scan.run();
    let mut child = 0;
    while let Some(mut frame) = scan.frames.pop() {
        frame.child = frame.child.max(child);
        child = frame.close();
    }
    child
}

struct Frame {
    /// The bracket that opened the group, `$` for a template substitution.
    open: u8,
    /// Tokens of the current item, and the deepest group nested in it.
    tokens: usize,
    child: usize,
    /// The deepest item closed so far.
    best: usize,
    /// `else` and `do` seen anywhere in the group.
    chained: usize,
    /// Parentheses holding an `if`, `for`, `while` or `with` head: a statement follows.
    control: bool,
}

impl Frame {
    fn new(open: u8, control: bool) -> Self {
        Self {
            open,
            tokens: 0,
            child: 0,
            best: 0,
            chained: 0,
            control,
        }
    }

    fn end_item(&mut self) {
        self.best = self.best.max(self.tokens + self.child);
        self.tokens = 0;
        self.child = 0;
    }

    fn close(&mut self) -> usize {
        self.end_item();
        1 + self.best + self.chained
    }
}

/// How a `/` after a token reads.
#[derive(Clone, Copy, PartialEq)]
enum Slash {
    Regex,
    Division,
    Either,
}

/// What the previous token tells the scan: how a `/` after it reads, and whether a line break after it may end a
/// statement before a token that starts one.
#[derive(Clone, Copy, PartialEq)]
struct Prev {
    slash: Slash,
    ends: bool,
}

/// The start, an operator, an opening bracket, a separator, or a keyword an expression follows.
const START: Prev = Prev {
    slash: Slash::Regex,
    ends: false,
};
const OPERATOR: Prev = START;
/// The closing parenthesis of a control head: a statement follows.
const CONTROL_HEAD: Prev = START;
/// A name, literal, `)` or `]`.
const VALUE: Prev = Prev {
    slash: Slash::Division,
    ends: true,
};
/// A name a line break may not end, such as `get` before a method name.
const PREFIX: Prev = Prev {
    slash: Slash::Division,
    ends: false,
};
/// A `}`, which ends a block (a regex may follow) or an object (a division may).
const BRACE: Prev = Prev {
    slash: Slash::Either,
    ends: true,
};
/// A token the scan cannot place: `++`, `--`, a name that may be a keyword, a byte outside ASCII, or the end of a
/// line counted raw.
const EITHER: Prev = Prev {
    slash: Slash::Either,
    ends: false,
};

struct Scan<'a> {
    src: &'a [u8],
    at: usize,
    frames: Vec<Frame>,
    prev: Prev,
    /// A line break since the previous token.
    newline: bool,
    /// The previous token was `if`, `for`, `while` or `with`.
    control: bool,
    /// The previous token was a `.` of member access: a keyword after it is a property name.
    dot: bool,
}

impl Scan<'_> {
    fn run(&mut self) {
        if self.src.starts_with(b"#!") {
            self.raw(false);
        }
        while let Some(&b) = self.src.get(self.at) {
            match b {
                b'\n' | b'\r' => {
                    self.newline = true;
                    self.at += 1;
                }
                0xe2 if line_separator(self.src, self.at) => {
                    self.newline = true;
                    self.at += 3;
                }
                b' ' | b'\t' | 0x0b | 0x0c => self.at += 1,
                b'/' if self.peek(1) == Some(b'/') => self.at = line_end(self.src, self.at),
                b'/' if self.peek(1) == Some(b'*') => {
                    let rest = &self.src[self.at + 2..];
                    let len = rest.windows(2).position(|w| w == b"*/");
                    let body = &rest[..len.unwrap_or(rest.len())];
                    self.newline |= line_end(body, 0) < body.len();
                    self.at += 2 + len.map_or(rest.len(), |n| n + 2);
                }
                // An HTML-like comment in a script, an operator in a module: counted raw, either way.
                b'<' if self.src[self.at..].starts_with(b"<!--") => self.raw(false),
                b'-' if self.src[self.at..].starts_with(b"-->")
                    && (self.newline || self.prev == START) =>
                {
                    self.raw(false)
                }
                b'(' | b'[' | b'{' => {
                    self.token(false);
                    let control = b == b'(' && self.control;
                    self.frames.push(Frame::new(b, control));
                    self.after(OPERATOR);
                    self.at += 1;
                }
                b')' | b']' | b'}' => {
                    self.at += 1;
                    self.close(b);
                }
                b';' | b',' => {
                    self.top().end_item();
                    self.after(OPERATOR);
                    self.at += 1;
                }
                b'\'' | b'"' => {
                    let start = self.at;
                    self.token(true);
                    if !self.string(b) {
                        self.at = start;
                        return self.raw(true);
                    }
                    self.after(VALUE);
                }
                b'`' => {
                    self.token(false);
                    self.at += 1;
                    self.template();
                }
                b'/' => match self.prev.slash {
                    Slash::Regex => {
                        let start = self.at;
                        self.token(false);
                        if !self.regex() {
                            self.at = start;
                            return self.raw(true);
                        }
                        self.after(VALUE);
                    }
                    Slash::Division => {
                        self.token(false);
                        self.after(OPERATOR);
                        self.at += 1;
                    }
                    Slash::Either => self.raw(false),
                },
                b'0'..=b'9' => {
                    self.token(true);
                    self.number();
                    self.after(VALUE);
                }
                b'.' if self.peek(1).is_some_and(|c| c.is_ascii_digit()) => {
                    self.token(true);
                    self.number();
                    self.after(VALUE);
                }
                _ if is_name(b) => self.word(),
                b'.' => {
                    self.token(false);
                    let spread = self.peek(1) == Some(b'.')
                        || (self.at > 0 && self.src[self.at - 1] == b'.');
                    self.after(OPERATOR);
                    self.dot = !spread;
                    self.at += 1;
                }
                // `++` and `--` may be postfix, after which a `/` divides, or prefix, after which it may not.
                b'+' | b'-' => {
                    self.token(false);
                    let doubled = self.at > 0 && self.src[self.at - 1] == b;
                    self.after(if doubled { EITHER } else { OPERATOR });
                    self.at += 1;
                }
                // Outside ASCII a byte may be part of a name or a space; a backslash starts an escaped name.
                _ if b >= 0x80 || b == b'\\' => {
                    self.token(false);
                    self.after(EITHER);
                    self.at += 1;
                }
                // Every other character is an operator or part of one; counting each keeps `!!x` and `~~x` deep.
                _ => {
                    self.token(false);
                    self.after(OPERATOR);
                    self.at += 1;
                }
            }
        }
    }

    fn peek(&self, n: usize) -> Option<u8> {
        self.src.get(self.at + n).copied()
    }

    fn top(&mut self) -> &mut Frame {
        self.frames
            .last_mut()
            .expect("the program's own frame stays")
    }

    /// Counts a token in the current item, first ending the item when a line break before it ends a statement.
    fn token(&mut self, starts_statement: bool) {
        if self.newline && starts_statement && self.prev.ends {
            self.top().end_item();
        }
        self.newline = false;
        self.top().tokens += 1;
    }

    fn after(&mut self, prev: Prev) {
        self.prev = prev;
        self.control = false;
        self.dot = false;
    }

    /// Counts from here to the end of the line, or of the source, without telling code from text: every non-blank
    /// byte is a token and every opening bracket opens a group that only a later closer outside the raw span closes.
    fn raw(&mut self, to_end: bool) {
        let line = line_end(self.src, self.at);
        let spans_lines = {
            let rest = &self.src[self.at..line];
            rest.contains(&b'`')
                || rest.windows(2).any(|w| w == b"/*")
                || rest.last() == Some(&b'\\')
        };
        let end = if to_end || spans_lines {
            self.src.len()
        } else {
            line
        };
        self.newline = false;
        for i in self.at..end {
            let b = self.src[i];
            if b.is_ascii_whitespace() {
                continue;
            }
            self.top().tokens += 1;
            if matches!(b, b'(' | b'[' | b'{') {
                self.frames.push(Frame::new(b, false));
            }
        }
        self.at = end;
        self.after(EITHER);
    }

    fn close(&mut self, b: u8) {
        let open = match b {
            b')' => b'(',
            b']' => b'[',
            _ => b'{',
        };
        // A closer that does not match is counted, not obeyed: popping on it could only lower the bound.
        let top = self.top().open;
        if self.frames.len() == 1 || (top != open && !(top == b'$' && b == b'}')) {
            self.token(false);
            self.after(EITHER);
            return;
        }
        let mut frame = self.frames.pop().expect("checked above");
        let depth = frame.close();
        let parent = self.top();
        parent.child = parent.child.max(depth);
        match frame.open {
            b'$' => self.template(),
            b'{' => self.after(BRACE),
            _ if frame.control => self.after(CONTROL_HEAD),
            _ => self.after(VALUE),
        }
    }

    fn word(&mut self) {
        let start = self.at;
        while self
            .src
            .get(self.at)
            .is_some_and(|&c| is_name(c) || c.is_ascii_digit())
        {
            self.at += 1;
        }
        let word = &self.src[start..self.at];
        let member = self.dot;
        // Words that continue the statement before a line break.
        let continues = !member
            && matches!(
                word,
                b"in" | b"instanceof" | b"of" | b"else" | b"catch" | b"finally" | b"while"
            );
        self.token(!continues);
        if matches!(word, b"else" | b"do") {
            self.top().chained += 1;
        }
        let prev = match word {
            _ if member => VALUE,
            b"this" | b"null" | b"true" | b"false" | b"super" => VALUE,
            // Keywords in some places and names in others.
            b"await" | b"yield" | b"of" | b"let" => EITHER,
            b"get" | b"set" | b"static" | b"async" | b"accessor" => PREFIX,
            _ if is_keyword(word) => OPERATOR,
            _ => VALUE,
        };
        let control = !member
            && (matches!(word, b"if" | b"for" | b"while" | b"with")
                || (self.control && word == b"await"));
        self.after(prev);
        self.control = control;
    }

    /// Scans a string; false when it does not end on its line.
    fn string(&mut self, quote: u8) -> bool {
        self.at += 1;
        while let Some(&c) = self.src.get(self.at) {
            self.at += 1;
            match c {
                b'\\' if self.src[self.at..].starts_with(b"\r\n") => self.at += 2,
                b'\\' => self.at += 1,
                b'\n' | b'\r' => return false,
                _ if c == quote => return true,
                _ => {}
            }
        }
        false
    }

    /// Scans template text up to its end or its next substitution, which opens a group.
    fn template(&mut self) {
        while let Some(&c) = self.src.get(self.at) {
            self.at += 1;
            match c {
                b'\\' => self.at += 1,
                b'`' => {
                    self.after(VALUE);
                    return;
                }
                b'$' if self.src.get(self.at) == Some(&b'{') => {
                    self.at += 1;
                    self.frames.push(Frame::new(b'$', false));
                    self.after(OPERATOR);
                    return;
                }
                _ => {}
            }
        }
    }

    /// Scans a regex; false when it does not end on its line.
    fn regex(&mut self) -> bool {
        self.at += 1;
        let mut class = false;
        loop {
            if self.at >= self.src.len() || matches!(self.src[self.at], b'\n' | b'\r') {
                return false;
            }
            if line_separator(self.src, self.at) {
                return false;
            }
            let c = self.src[self.at];
            self.at += 1;
            match c {
                b'\\' => {
                    let next = self.src.get(self.at);
                    if next.is_none_or(|&n| matches!(n, b'\n' | b'\r'))
                        || line_separator(self.src, self.at)
                    {
                        return false;
                    }
                    self.at += 1;
                }
                b'[' => class = true,
                b']' => class = false,
                b'/' if !class => break,
                _ => {}
            }
        }
        while self.src.get(self.at).is_some_and(|&c| is_name(c)) {
            self.at += 1;
        }
        true
    }

    fn number(&mut self) {
        let hex = matches!(self.src.get(self.at + 1), Some(b'x' | b'X'));
        while let Some(&c) = self.src.get(self.at) {
            let exponent_sign =
                !hex && matches!(c, b'+' | b'-') && matches!(self.src[self.at - 1], b'e' | b'E');
            if !(c.is_ascii_alphanumeric() || c == b'.' || c == b'_' || exponent_sign) {
                return;
            }
            self.at += 1;
        }
    }
}

fn is_name(b: u8) -> bool {
    b.is_ascii_alphabetic() || b == b'_' || b == b'$'
}

/// U+2028 or U+2029, which end a line as `\n` does.
fn line_separator(src: &[u8], at: usize) -> bool {
    src[at..].starts_with(&[0xe2, 0x80, 0xa8]) || src[at..].starts_with(&[0xe2, 0x80, 0xa9])
}

/// Where the line holding `at` ends.
fn line_end(src: &[u8], at: usize) -> usize {
    (at..src.len())
        .find(|&i| matches!(src[i], b'\n' | b'\r') || line_separator(src, i))
        .unwrap_or(src.len())
}

/// Words after which an expression, not an operator, comes next.
fn is_keyword(word: &[u8]) -> bool {
    matches!(
        word,
        b"break"
            | b"case"
            | b"catch"
            | b"class"
            | b"const"
            | b"continue"
            | b"debugger"
            | b"default"
            | b"delete"
            | b"do"
            | b"else"
            | b"export"
            | b"extends"
            | b"finally"
            | b"for"
            | b"function"
            | b"if"
            | b"import"
            | b"in"
            | b"instanceof"
            | b"new"
            | b"return"
            | b"switch"
            | b"throw"
            | b"try"
            | b"typeof"
            | b"var"
            | b"void"
            | b"while"
            | b"with"
    )
}

#[cfg(test)]
mod tests {
    use super::bound;

    #[test]
    fn brackets_in_strings_comments_templates_and_regexes_do_not_count() {
        assert_eq!(bound("return 1"), bound(r#"return ")))(((" // ((((("#));
        assert_eq!(bound("return 1"), bound("/* ((( */ return 1"));
        assert_eq!(bound("return `${1}`"), bound("return `((( ${1} )))`"));
        assert_eq!(bound("return 1"), bound(r"return /[)\]]((/g"));
    }

    #[test]
    fn grows_with_every_nesting_form() {
        let forms: &[(&str, &str, &str)] = &[
            ("return ", "(", ")"),
            ("return ", "[", "]"),
            ("", "{", "}"),
            ("return ", "!", ""),
            ("return ", "- ", ""),
            ("return ", "a ? 1 : ", "0"),
            ("let a; return ", "a = ", "1"),
            ("return ", "() => ", "1"),
            ("return 1", " + 1", ""),
            ("return o", ".a()", ""),
            ("return ", "`${", "}`"),
            ("let a = 1; ", "if (a) ", "a = 2"),
            ("let a = 1; ", "if (a)\n", "a = 2"),
            ("let a = 1; ", "if (a) a = 1; else ", "a = 2"),
            ("let a = 1;\n", "if (a) a = 1\nelse ", "a = 2"),
            ("", "do ", "x; while (a)"),
            ("", "a: ", "x"),
            ("return ", "function () { return ", " }"),
        ];
        for (head, open, close) in forms {
            let at = |n: usize| bound(&format!("{head}{}1{}", open.repeat(n), close.repeat(n)));
            assert!(
                at(200) - at(100) >= 100,
                "{open:?} grows by {}",
                at(200) - at(100)
            );
        }
    }

    #[test]
    fn statements_on_their_own_lines_do_not_add_up() {
        let line =
            "if (event.type === \"x\") { const s = await tools.git.status(); return { s } }\n";
        let calls = "f(x)\nlet y = 1\nconsole.log(y)\n";
        assert!(
            bound(&line.repeat(200)) < 30,
            "{}",
            bound(&line.repeat(200))
        );
        assert!(
            bound(&calls.repeat(200)) < 30,
            "{}",
            bound(&calls.repeat(200))
        );
        assert!(bound(&"x = 1;".repeat(1000)) < 10);
    }

    /// Stack bytes per repetition of each form, measured with `bench/examples/stack_probe.rs` (release, debug).
    #[test]
    fn covers_the_measured_stack_use() {
        let measured: &[(&str, &str, &str, usize, usize)] = &[
            ("return ", "(", ")", 778, 3481),
            ("return ", "[", "]", 819, 12574),
            ("return ", "{a:", "}", 942, 13189),
            ("", "{", "}", 942, 3031),
            ("return ", "f(", ")", 1147, 14540),
            ("return ", "() => ", "", 1475, 16261),
            ("return ", "function () { return ", " }", 2171, 18472),
            ("", "if (a) {} else ", "{}", 655, 2212),
            ("", "if (a) ", "", 655, 2212),
            ("return ", "!", "", 819, 12902),
            ("return ", "a ? 1 : ", "0", 860, 11509),
            ("return ", "a = ", "", 983, 17858),
            ("return 1", " + 1", "", 819, 11509),
            ("return o", ".a()", "", 983, 13475),
            ("return ", "`${", "}`", 1761, 12247),
            ("return ", "typeof ", "", 819, 12902),
            ("return ", "void ", "", 819, 12902),
            ("return ", "await ", "", 819, 11509),
            ("return ", "new ", "()", 819, 11509),
            ("return ", "- ", "", 819, 12861),
            ("return ", "[...", "]", 860, 12574),
            ("const ", "[", "]", 1270, 2294),
            ("(", "{a:", "}", 1270, 4915),
            ("return o", "?.a", "", 819, 11509),
            ("", "while (a) ", "", 655, 3113),
        ];
        for (head, open, close, release, debug) in measured {
            let at = |n: usize| bound(&format!("{head}{}1{}", open.repeat(n), close.repeat(n)));
            let per = (at(600) - at(200)) / 400;
            let need = if cfg!(debug_assertions) {
                debug
            } else {
                release
            };
            assert!(
                per * crate::run::COMPILE_STACK_PER_LEVEL >= *need,
                "{open:?}: {per} per level"
            );
        }
    }

    /// Each source hides a group nested 400 deep from a scan that guessed wrong about a `/`, a line end, or a byte.
    #[test]
    fn no_reading_of_an_unclear_token_hides_nesting() {
        let n = 400;
        let d = format!("{}1{}", "(".repeat(n), ")".repeat(n));
        let typeofs = "typeof\u{a0}".repeat(n);
        let cases = [
            format!("let a = 1, g = 1; a++ / {d} / g"),
            format!("let a = 1, g = 1; a-- /{d}/ g"),
            format!("function f(s) {{ if (s) {{}} /}}/.test(s); return {d} }}"),
            format!("function f(s) {{ if (s) {{}} /))))/.test(s); return [{d}] }}"),
            format!("const o = {{}} / {d} / 2"),
            format!("let await = 1, g = 1; await / {d} / g"),
            format!("let of = 1, g = 1; of / {d} / g"),
            format!("const x = {{}}; x.return / {d} / 2"),
            format!("let a = 1; a\u{a0}/ {d} /\u{a0}1"),
            format!("return {typeofs}1"),
            format!("x = 1 <!-- {d}"),
            format!("x = 1\n--> {d}"),
            format!("// note\u{2028}{d}"),
            format!("/* note */ {d}"),
            format!("const s = 'unterminated\n{d}"),
            format!("const r = /unterminated\n{d}"),
            format!("let a = 1; a++ / `${{1}}\n${{{d}}}` / 1"),
            format!("let a = 1; a++ / 1 /* ((( \n */ {d}"),
            format!("let a = 1; x = a++ / 'x\\\n{d}'"),
        ];
        for case in cases {
            let b = bound(&case);
            assert!(b >= n, "{} is bounded by {b}", &case[..case.len().min(70)]);
        }
    }

    #[test]
    fn regexes_and_divisions_the_scan_is_sure_of_stay_cheap() {
        let plain = bound("const r = /[(]+/g; const q = a / b / c; return r.test(q)");
        assert!(plain < 20, "{plain}");
        let after_block = bound("if (a) { b() }\nconst c = d / e");
        assert!(after_block < 20, "{after_block}");
    }

    #[test]
    fn unmatched_closers_do_not_lower_the_bound() {
        let deep = format!("return {}1{}", "(".repeat(300), ")".repeat(300));
        assert!(bound(&format!("{deep} ]]]}}}}")) >= bound(&deep));
        assert!(bound(&format!("]]]}}}} {deep}")) >= bound(&deep));
    }
}
