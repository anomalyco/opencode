//! The LaTeX math parser, a port of `packages/latex/src/parser.ts` and `limits.ts` in strict mode, the mode the
//! TypeScript plugin uses. User macros are not ported: the plugin never passes any.

use crate::symbols;

/// Longest accepted source, in characters (`DEFAULT_MAX_SOURCE_LENGTH`).
const MAX_SOURCE_LENGTH: usize = 100_000;
/// Deepest accepted brace or construct nesting (`DEFAULT_MAX_NESTING_DEPTH`).
const MAX_DEPTH: usize = 256;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Ordinary,
    Binary,
    Relation,
    Operator,
    Punctuation,
    Opening,
    Closing,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Variant {
    Normal,
    Bold,
    Italic,
    Sans,
    Monospace,
    DoubleStruck,
    Script,
    Fraktur,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Environment {
    Matrix,
    Pmatrix,
    Bmatrix,
    BigBmatrix,
    Vmatrix,
    BigVmatrix,
    Cases,
    Aligned,
    Align,
    Gathered,
    Gather,
    Smallmatrix,
    Array,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Accent {
    Hat,
    Widehat,
    Bar,
    Overline,
    Underline,
    Vec,
    Tilde,
    Dot,
    Ddot,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Align {
    Left,
    Right,
}

/// A parsed formula (TS `MathNode`).
#[derive(Clone, Debug, PartialEq)]
pub enum Node {
    Row(Vec<Node>),
    Symbol { value: String, role: Option<Role> },
    Text(String),
    Space(usize),
    Fraction { numerator: Box<Node>, denominator: Box<Node>, bar: bool, align: Option<Align> },
    Root { body: Box<Node>, index: Option<Box<Node>> },
    Scripts { base: Box<Node>, superscript: Option<Box<Node>>, subscript: Option<Box<Node>> },
    Delimited { left: String, body: Box<Node>, right: String },
    Matrix { rows: Vec<Vec<Node>>, environment: Environment, columns: Option<String> },
    Brace { body: Box<Node>, over: bool },
    Accent { accent: Accent, body: Box<Node> },
    Variant { variant: Variant, body: Box<Node> },
    Operator { value: String, limits: bool },
    OverUnder { base: Box<Node>, over: Option<Box<Node>>, under: Option<Box<Node>> },
    Color { color: String, body: Box<Node> },
}

/// Why a source is not rendered (TS `LatexParseError`); the plugin then shows the source.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParseError {
    pub message: String,
    /// The offset in characters.
    pub position: usize,
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} at offset {}", self.message, self.position)
    }
}

impl std::error::Error for ParseError {}

type Result<T> = std::result::Result<T, ParseError>;

pub fn parse(source: &str) -> Result<Node> {
    let source: Vec<char> = source.chars().collect();
    if source.len() > MAX_SOURCE_LENGTH {
        return Err(ParseError {
            message: format!("LaTeX source exceeds the {MAX_SOURCE_LENGTH}-character limit"),
            position: MAX_SOURCE_LENGTH,
        });
    }
    check_nesting(&source)?;
    let mut parser = Parser { source, position: 0, depth: 0 };
    let body = parser.row(&|_| false)?;
    parser.skip_whitespace();
    if !parser.done() {
        return parser.fail(format!("Unexpected \"{}\"", parser.peek_str()));
    }
    Ok(row(body))
}

/// Rejects brace nesting deeper than [`MAX_DEPTH`] before parsing (`assertNestingDepth`).
fn check_nesting(source: &[char]) -> Result<()> {
    let mut depth = 0usize;
    let mut slashes = 0usize;
    for (index, &char) in source.iter().enumerate() {
        if char == '\\' {
            slashes += 1;
            continue;
        }
        let escaped = slashes % 2 == 1;
        slashes = 0;
        if char == '{' && !escaped {
            depth += 1;
            if depth > MAX_DEPTH {
                return Err(ParseError {
                    message: format!("LaTeX nesting exceeds the {MAX_DEPTH}-level limit"),
                    position: index,
                });
            }
        } else if char == '}' && !escaped {
            depth = depth.saturating_sub(1);
        }
    }
    Ok(())
}

struct Parser {
    source: Vec<char>,
    position: usize,
    depth: usize,
}

type Stop<'a> = &'a dyn Fn(&Parser) -> bool;

impl Parser {
    fn row(&mut self, stop: Stop<'_>) -> Result<Vec<Node>> {
        let mut body = Vec::new();
        while !self.done() {
            self.skip_whitespace();
            if self.done() || stop(self) {
                break;
            }
            let current = self.peek();
            if current == Some('}') {
                break;
            }
            if current == Some('^') || current == Some('_') {
                self.position += 1;
                let script = Box::new(self.argument()?);
                let previous = body.pop().unwrap_or(Node::Row(Vec::new()));
                let mut scripts = match previous {
                    scripts @ Node::Scripts { .. } => scripts,
                    base => Node::Scripts { base: Box::new(base), superscript: None, subscript: None },
                };
                if let Node::Scripts { superscript, subscript, .. } = &mut scripts {
                    match current {
                        Some('^') => *superscript = Some(script),
                        _ => *subscript = Some(script),
                    }
                }
                body.push(scripts);
                continue;
            }
            if current == Some('\\') && self.limits_modifier(&mut body) {
                continue;
            }
            body.push(self.atom()?);
        }
        Ok(body)
    }

    fn atom(&mut self) -> Result<Node> {
        self.depth += 1;
        let result = if self.depth > MAX_DEPTH {
            self.fail(format!("LaTeX nesting exceeds the {MAX_DEPTH}-level limit"))
        } else {
            self.atom_inner()
        };
        self.depth -= 1;
        result
    }

    fn atom_inner(&mut self) -> Result<Node> {
        match self.peek() {
            Some('{') => self.group(),
            Some('\\') => self.command(),
            Some('~') => {
                self.position += 1;
                Ok(Node::Space(1))
            }
            current => {
                // At the end TS reads an empty symbol; keep that so `\not` at the end behaves the same.
                self.position += 1;
                let value = current.map(String::from).unwrap_or_default();
                let role = infer_role(&value);
                Ok(Node::Symbol { value, role: Some(role) })
            }
        }
    }

    fn command(&mut self) -> Result<Node> {
        let start = self.position;
        let command = self.read_command()?;
        let command = command.as_str();
        match command {
            "\\" => return Ok(Node::Row(Vec::new())),
            "begin" => return self.environment(),
            "frac" | "dfrac" | "tfrac" | "cfrac" => {
                self.skip_whitespace();
                let mut align = None;
                if command == "cfrac" && self.peek() == Some('[') {
                    let option = ["[]", "[l]", "[r]"].into_iter().find(|option| self.starts_with(option));
                    let Some(option) = option else {
                        return self.fail("Unsupported \\cfrac alignment; expected [l], [r], or []".into());
                    };
                    self.position += option.chars().count();
                    align = match option {
                        "[l]" => Some(Align::Left),
                        "[r]" => Some(Align::Right),
                        _ => None,
                    };
                }
                return Ok(Node::Fraction {
                    numerator: Box::new(self.argument()?),
                    denominator: Box::new(self.argument()?),
                    bar: true,
                    align,
                });
            }
            "binom" | "dbinom" | "tbinom" => {
                let fraction = Node::Fraction {
                    numerator: Box::new(self.argument()?),
                    denominator: Box::new(self.argument()?),
                    bar: false,
                    align: None,
                };
                return Ok(Node::Delimited { left: "(".into(), body: Box::new(fraction), right: ")".into() });
            }
            "sqrt" => {
                let index = self.optional_argument()?.map(Box::new);
                return Ok(Node::Root { body: Box::new(self.argument()?), index });
            }
            "left" => return self.left_right(),
            "middle" => {
                return Ok(Node::Symbol { value: self.read_delimiter()?, role: None });
            }
            "right" => {
                self.position = start;
                return self.fail("Unexpected \\right".into());
            }
            _ => {}
        }
        if let Some(accent) = accent(command) {
            return Ok(Node::Accent { accent, body: Box::new(self.argument()?) });
        }
        if let Some(variant) = variant(command) {
            let body = match command {
                "textrm" => Node::Text(self.read_text_group()?),
                _ => self.argument()?,
            };
            return Ok(Node::Variant { variant, body: Box::new(body) });
        }
        match command {
            "text" | "mbox" => return Ok(Node::Text(self.read_text_group()?)),
            "operatorname" => {
                let limits = self.peek() == Some('*');
                if limits {
                    self.position += 1;
                }
                return Ok(Node::Operator { value: self.read_text_group()?, limits });
            }
            "overset" | "stackrel" => {
                let over = Box::new(self.argument()?);
                let base = Box::new(self.argument()?);
                return Ok(Node::OverUnder { base, over: Some(over), under: None });
            }
            "underset" => {
                let under = Box::new(self.argument()?);
                let base = Box::new(self.argument()?);
                return Ok(Node::OverUnder { base, over: None, under: Some(under) });
            }
            "overbrace" | "underbrace" => {
                return Ok(Node::Brace { body: Box::new(self.argument()?), over: command == "overbrace" });
            }
            "textcolor" => {
                let color = self.read_raw_group()?;
                return Ok(Node::Color { color, body: Box::new(self.argument()?) });
            }
            "color" => {
                let color = self.read_raw_group()?;
                return Ok(Node::Color { color, body: Box::new(row(self.row(&|_| false)?)) });
            }
            "not" => {
                return Ok(match self.atom()? {
                    Node::Symbol { value, role } => Node::Symbol { value: negate(&value), role },
                    target => Node::Row(vec![Node::Symbol { value: "¬".into(), role: None }, target]),
                });
            }
            "pmod" => {
                return Ok(Node::Row(vec![
                    Node::Space(1),
                    Node::Text("(mod ".into()),
                    self.argument()?,
                    Node::Text(")".into()),
                ]));
            }
            "mod" | "bmod" => {
                return Ok(Node::Operator { value: "mod".into(), limits: false });
            }
            "displaylines" => {
                self.skip_whitespace();
                self.expect("{")?;
                return self.matrix(Environment::Gathered, "}", None);
            }
            "limits" | "nolimits" | "displaystyle" | "textstyle" | "scriptstyle" | "scriptscriptstyle" => {
                return Ok(Node::Row(Vec::new()));
            }
            _ => {}
        }
        if is_big(command) {
            return Ok(Node::Symbol { value: self.read_delimiter()?, role: None });
        }
        if let Some(width) = symbols::spacing(command) {
            return Ok(Node::Space(width));
        }
        if let Some((value, role)) = symbols::symbol(command) {
            return Ok(Node::Symbol { value: value.into(), role: Some(role) });
        }
        if let Some(value) = symbols::large_operator(command) {
            return Ok(Node::Operator { value: value.into(), limits: !command.contains("int") });
        }
        if symbols::is_named_operator(command) {
            let limits = command.starts_with("lim") || command == "min" || command == "max";
            return Ok(Node::Operator { value: command.into(), limits });
        }
        if command == "backslash" {
            return Ok(Node::Symbol { value: "\\".into(), role: None });
        }
        if let Some(value) = symbols::delimiter(&format!("\\{command}")).or_else(|| symbols::delimiter(command)) {
            return Ok(Node::Symbol { value: value.into(), role: None });
        }
        if matches!(command, "{" | "}" | "%" | "#" | "$" | "&" | "_") {
            return Ok(Node::Symbol { value: command.into(), role: None });
        }
        self.fail_at(format!("Unsupported command \\{command}"), start)
    }

    fn environment(&mut self) -> Result<Node> {
        let raw = self.read_raw_group()?;
        let name = raw.strip_suffix('*').unwrap_or(&raw);
        let Some(environment) = environment(name) else {
            return self.fail(format!("Unsupported environment {name}"));
        };
        let columns = match environment {
            Environment::Array => {
                let columns: String = self.read_raw_group()?.chars().filter(|c| !c.is_whitespace()).collect();
                let valid = !columns.is_empty()
                    && columns.chars().all(|c| "lcr|".contains(c))
                    && columns.chars().any(|c| "lcr".contains(c));
                if !valid {
                    return self.fail("Unsupported array columns; expected l, c, r, and |".into());
                }
                Some(columns)
            }
            _ => None,
        };
        self.matrix(environment, &format!("\\end{{{raw}}}"), columns)
    }

    fn matrix(&mut self, environment: Environment, end: &str, columns: Option<String>) -> Result<Node> {
        let mut rows = Vec::new();
        let mut cells = Vec::new();
        while !self.done() {
            self.skip_whitespace();
            if self.starts_with(end) && cells.is_empty() {
                break;
            }
            let cell_start = self.position;
            let cell = self
                .row(&|parser| parser.peek() == Some('&') || parser.starts_with("\\\\") || parser.starts_with(end))?;
            cells.push(row(cell));
            self.skip_whitespace();
            if self.peek() == Some('&') {
                self.position += 1;
                continue;
            }
            if self.starts_with("\\\\") {
                self.position += 2;
                self.skip_optional_bracket();
                rows.push(std::mem::take(&mut cells));
                continue;
            }
            if self.starts_with(end) {
                break;
            }
            // Empty cells are valid only when a cell, row, or closing delimiter advances the parser.
            if self.position == cell_start {
                return self.fail(format!("Unexpected \"{}\" in {}", self.peek_str(), environment_name(environment)));
            }
        }
        if !self.starts_with(end) {
            return self.fail(format!("Missing {end}"));
        }
        self.expect(end)?;
        if !cells.is_empty() || rows.is_empty() {
            rows.push(cells);
        }
        Ok(Node::Matrix { rows, environment, columns })
    }

    fn left_right(&mut self) -> Result<Node> {
        let left = self.read_delimiter()?;
        let at_right = |parser: &Parser| {
            parser.starts_with("\\right")
                && !parser.source.get(parser.position + 6).is_some_and(|&c| is_command_letter(c))
        };
        let body = row(self.row(&at_right)?);
        if !at_right(self) {
            return self.fail("Missing \\right".into());
        }
        self.read_command()?;
        let right = self.read_delimiter()?;
        Ok(Node::Delimited { left, body: Box::new(body), right })
    }

    fn argument(&mut self) -> Result<Node> {
        self.skip_whitespace();
        if self.peek() == Some('{') {
            return self.group();
        }
        if self.done() {
            return self.fail("Expected an argument".into());
        }
        self.atom()
    }

    fn group(&mut self) -> Result<Node> {
        self.expect("{")?;
        let body = row(self.row(&|_| false)?);
        self.expect("}")?;
        Ok(body)
    }

    fn optional_argument(&mut self) -> Result<Option<Node>> {
        self.skip_whitespace();
        if self.peek() != Some('[') {
            return Ok(None);
        }
        self.position += 1;
        let body = row(self.row(&|parser| parser.peek() == Some(']'))?);
        self.expect("]")?;
        Ok(Some(body))
    }

    fn skip_optional_bracket(&mut self) {
        self.skip_whitespace();
        if self.peek() != Some('[') {
            return;
        }
        let mut depth = 0usize;
        while let Some(char) = self.next() {
            if char == '[' {
                depth += 1;
            }
            if char == ']' {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    return;
                }
            }
        }
    }

    fn read_delimiter(&mut self) -> Result<String> {
        self.skip_whitespace();
        if self.done() {
            return self.fail("Expected a delimiter".into());
        }
        let start = self.position;
        if self.peek() == Some('\\') {
            let command = self.read_command()?;
            return match symbols::delimiter(&format!("\\{command}")).or_else(|| symbols::delimiter(&command)) {
                Some(delimiter) => Ok(delimiter.into()),
                None => self.fail_at(format!("Unsupported delimiter \\{command}"), start),
            };
        }
        let token = self.next().map(String::from).unwrap_or_default();
        Ok(symbols::delimiter(&token).map_or(token, str::to_owned))
    }

    fn read_command(&mut self) -> Result<String> {
        self.expect("\\")?;
        let Some(next) = self.peek() else {
            return Ok("\\".into());
        };
        if !is_command_letter(next) {
            self.position += 1;
            return Ok(next.into());
        }
        let start = self.position;
        while self.peek().is_some_and(is_command_letter) {
            self.position += 1;
        }
        let command = self.source[start..self.position].iter().collect();
        if self.peek() == Some(' ') {
            self.position += 1;
        }
        Ok(command)
    }

    fn read_raw_group(&mut self) -> Result<String> {
        self.skip_whitespace();
        self.expect("{")?;
        let start = self.position;
        let mut depth = 1usize;
        while let Some(char) = self.next() {
            let escaped = (char == '{' || char == '}') && self.is_escaped(self.position - 1);
            if char == '{' && !escaped {
                depth += 1;
            }
            if char == '}' && !escaped {
                depth -= 1;
                if depth == 0 {
                    return Ok(self.source[start..self.position - 1].iter().collect());
                }
            }
        }
        self.fail_at("Unterminated group".into(), start)
    }

    fn limits_modifier(&mut self, body: &mut [Node]) -> bool {
        let Some(name) = ["limits", "nolimits"].into_iter().find(|name| {
            self.starts_with(&format!("\\{name}"))
                && !self.source.get(self.position + 1 + name.len()).is_some_and(|&c| is_command_letter(c))
        }) else {
            return false;
        };
        self.position += 1 + name.len();
        let operator = match body.last_mut() {
            Some(Node::Operator { limits, .. }) => Some(limits),
            Some(Node::Scripts { base, .. }) => match base.as_mut() {
                Node::Operator { limits, .. } => Some(limits),
                _ => None,
            },
            _ => None,
        };
        if let Some(limits) = operator {
            *limits = name == "limits";
        }
        true
    }

    fn is_escaped(&self, index: usize) -> bool {
        self.source[..index].iter().rev().take_while(|&&c| c == '\\').count() % 2 == 1
    }

    /// A raw group with TeX's text escapes resolved (`readTextGroup`).
    fn read_text_group(&mut self) -> Result<String> {
        let raw: Vec<char> = self.read_raw_group()?.chars().collect();
        let mut text = String::new();
        let mut index = 0;
        while index < raw.len() {
            let char = raw[index];
            // TS's `\\([A-Za-z@]+|.)`: `.` does not match a line break.
            if char != '\\' || raw.get(index + 1).is_none_or(|&c| c == '\n' || c == '\r') {
                text.push(if char == '~' { ' ' } else { char });
                index += 1;
                continue;
            }
            let start = index + 1;
            let mut end = start;
            while raw.get(end).is_some_and(|&c| is_command_letter(c)) {
                end += 1;
            }
            let end = if end == start { start + 1 } else { end };
            let command: String = raw[start..end].iter().collect();
            if command.chars().count() == 1 && "{}%#$&_ ".contains(command.as_str()) {
                text.push_str(&command);
            } else if command == "textbackslash" {
                text.push('\\');
            } else if command == "!" {
            } else if let Some(width) = symbols::spacing(&command) {
                text.push_str(&" ".repeat(width.max(1)));
            } else {
                text.push('\\');
                text.extend(command.chars().map(|c| if c == '~' { ' ' } else { c }));
            }
            index = end;
        }
        Ok(text)
    }

    fn skip_whitespace(&mut self) {
        while let Some(char) = self.peek() {
            if char.is_whitespace() {
                self.position += 1;
            } else if char == '%' {
                while self.peek().is_some_and(|c| c != '\n') {
                    self.position += 1;
                }
            } else {
                break;
            }
        }
    }

    fn expect(&mut self, value: &str) -> Result<()> {
        if !self.starts_with(value) {
            return self.fail(format!("Expected \"{value}\""));
        }
        self.position += value.chars().count();
        Ok(())
    }

    fn starts_with(&self, value: &str) -> bool {
        let mut index = self.position;
        value.chars().all(|char| {
            let matched = self.source.get(index) == Some(&char);
            index += 1;
            matched
        })
    }

    fn peek(&self) -> Option<char> {
        self.source.get(self.position).copied()
    }

    fn peek_str(&self) -> String {
        self.peek().map(String::from).unwrap_or_default()
    }

    fn next(&mut self) -> Option<char> {
        let char = self.peek();
        if char.is_some() {
            self.position += 1;
        }
        char
    }

    fn done(&self) -> bool {
        self.position >= self.source.len()
    }

    fn fail<T>(&self, message: String) -> Result<T> {
        self.fail_at(message, self.position)
    }

    fn fail_at<T>(&self, message: String, position: usize) -> Result<T> {
        Err(ParseError { message, position })
    }
}

fn row(mut body: Vec<Node>) -> Node {
    if body.len() == 1 {
        return body.remove(0);
    }
    Node::Row(body)
}

fn is_command_letter(char: char) -> bool {
    char.is_ascii_alphabetic() || char == '@'
}

fn is_big(command: &str) -> bool {
    let base = command.strip_suffix(['l', 'r', 'm']).unwrap_or(command);
    matches!(base, "big" | "Big" | "bigg" | "Bigg")
}

/// The spacing role of a literal character. As in TS, an empty value (read at the end) is binary.
fn infer_role(value: &str) -> Role {
    if "+-*/×÷±∓".contains(value) {
        return Role::Binary;
    }
    if "=<>≤≥≠≈∈∉⊂⊃".contains(value) {
        return Role::Relation;
    }
    if ",;:".contains(value) {
        return Role::Punctuation;
    }
    if "([{".contains(value) {
        return Role::Opening;
    }
    if ")]}".contains(value) {
        return Role::Closing;
    }
    Role::Ordinary
}

fn negate(value: &str) -> String {
    let negated = match value {
        "=" => "≠",
        "∈" => "∉",
        "∋" => "∌",
        "≡" => "≢",
        "≈" => "≉",
        "∼" => "≁",
        "<" => "≮",
        ">" => "≯",
        "≤" => "≰",
        "≥" => "≱",
        "⊂" => "⊄",
        "⊃" => "⊅",
        "⊆" => "⊈",
        "⊇" => "⊉",
        "∣" => "∤",
        "∥" => "∦",
        _ => return format!("{value}\u{338}"),
    };
    negated.into()
}

fn accent(command: &str) -> Option<Accent> {
    Some(match command {
        "hat" => Accent::Hat,
        "widehat" => Accent::Widehat,
        "bar" => Accent::Bar,
        "overline" => Accent::Overline,
        "underline" => Accent::Underline,
        "vec" => Accent::Vec,
        "tilde" | "widetilde" => Accent::Tilde,
        "dot" => Accent::Dot,
        "ddot" => Accent::Ddot,
        _ => return None,
    })
}

fn variant(command: &str) -> Option<Variant> {
    Some(match command {
        "mathrm" | "textrm" | "mathnormal" => Variant::Normal,
        "mathbf" | "boldsymbol" | "bm" => Variant::Bold,
        "mathit" => Variant::Italic,
        "mathsf" => Variant::Sans,
        "mathtt" => Variant::Monospace,
        "mathbb" => Variant::DoubleStruck,
        "mathcal" | "mathscr" => Variant::Script,
        "mathfrak" => Variant::Fraktur,
        _ => return None,
    })
}

const ENVIRONMENTS: &[(&str, Environment)] = &[
    ("matrix", Environment::Matrix),
    ("pmatrix", Environment::Pmatrix),
    ("bmatrix", Environment::Bmatrix),
    ("Bmatrix", Environment::BigBmatrix),
    ("vmatrix", Environment::Vmatrix),
    ("Vmatrix", Environment::BigVmatrix),
    ("cases", Environment::Cases),
    ("aligned", Environment::Aligned),
    ("align", Environment::Align),
    ("gathered", Environment::Gathered),
    ("gather", Environment::Gather),
    ("smallmatrix", Environment::Smallmatrix),
    ("array", Environment::Array),
];

fn environment(name: &str) -> Option<Environment> {
    ENVIRONMENTS.iter().find(|(key, _)| *key == name).map(|(_, environment)| *environment)
}

fn environment_name(environment: Environment) -> &'static str {
    ENVIRONMENTS.iter().find(|(_, value)| *value == environment).map_or("", |(name, _)| name)
}
