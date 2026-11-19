//! Parses with oxc, resolves bindings with oxc_semantic, rejects syntax outside the subset, and emits bytecode.

use std::sync::Arc;

use oxc_allocator::Allocator;
use oxc_ast::ast::*;
use oxc_ast_visit::{Visit, walk};
use oxc_parser::{ParseOptions, Parser, ParserReturn};
use oxc_semantic::{AstNodes, Scoping, SemanticBuilder};
use oxc_span::{GetSpan, SourceType};
use oxc_syntax::operator::{
    AssignmentOperator, BinaryOperator, LogicalOperator, UnaryOperator, UpdateOperator,
};
use oxc_syntax::scope::ScopeId;
use oxc_syntax::symbol::{SymbolFlags, SymbolId};
use rustc_hash::{FxHashMap, FxHashSet};

use crate::DiagnosticKind;
use crate::bytecode::{
    Arith, Capture, FuncProto, ITER_DELEGATE, ITER_DESTRUCTURE, ITER_FOR_AWAIT, ITER_FOR_OF, Op,
    Program, TemplateSite,
};
use crate::strings::{Atom, Strings};
use crate::value::{Value, num_to_string};
use crate::vm::{REQ_NEXT, REQ_RETURN, REQ_THROW};

pub struct CompileError {
    pub kind: DiagnosticKind,
    pub message: String,
    pub offset: Option<u32>,
}

type R<T> = Result<T, CompileError>;

/// Deepest syntactic nesting a program may have; it bounds the recursion of analysis and compilation.
const MAX_NESTING: u32 = 2_000;
/// Largest program accepted, which bounds the parser's own recursion.
const MAX_SOURCE_BYTES: usize = 256 * 1024;

pub fn compile(source: &str, atoms: &mut Strings) -> R<Program> {
    if source.len() > MAX_SOURCE_BYTES {
        return Err(CompileError {
            kind: DiagnosticKind::ParseError,
            message: format!("Program is larger than {MAX_SOURCE_BYTES} bytes."),
            offset: None,
        });
    }
    if source.trim().is_empty() {
        return Err(CompileError {
            kind: DiagnosticKind::ParseError,
            message: "Code cannot be empty.".into(),
            offset: None,
        });
    }
    let renamed: String;
    let mut await_alias = None;
    let allocator = Allocator::default();
    let mut parsed = parse(&allocator, source, SourceType::mjs());
    // The reference parses a script that allows top-level `await`: `await` is a plain name there, read as the
    // operator only where an expression starts with it. A program whose first error is naming something `await` is
    // parsed again as a script, unless it also uses `await` as an expression at the top level; then the names are
    // renamed for the parse instead, keeping the expressions.
    if parsed
        .diagnostics
        .errors()
        .next()
        .is_some_and(|d| names_await(source, d))
    {
        let script = parse(&allocator, source, SourceType::script());
        if script.diagnostics.errors().next().is_none()
            && !script.fatal_error
            && !TopLevelAwait::uses(&script.program)
        {
            parsed = script;
        } else if let Some((text, alias)) = rename_await_names(source) {
            renamed = text;
            parsed = parse(&allocator, &renamed, SourceType::mjs());
            await_alias = Some(alias);
        }
    }
    if let Some(d) = parsed
        .diagnostics
        .errors()
        .find(|d| !accepted_by_reference(d))
    {
        return Err(parse_error(source, &parsed.program, d));
    }
    if parsed.fatal_error {
        return Err(CompileError {
            kind: DiagnosticKind::ParseError,
            message: parse_message("Unexpected token"),
            offset: None,
        });
    }
    // Parsed as a module for top-level `await`, but bound as a script, like the reference: top-level functions and
    // `var`s share one scope, so redeclaring one as the other is allowed.
    parsed.program.source_type = SourceType::script();
    let program = &parsed.program;
    if let Some(export) = program
        .body
        .iter()
        .find(|s| s.is_module_declaration() && !matches!(s, Statement::ImportDeclaration(_)))
    {
        return Err(CompileError {
            kind: DiagnosticKind::ParseError,
            message: "SyntaxError: Exports aren't available. Return the result instead.".into(),
            offset: Some(export.span().start),
        });
    }
    let mut depth = DepthCheck {
        depth: 0,
        deepest: None,
    };
    depth.visit_program(program);
    if let Some(offset) = depth.deepest {
        return Err(CompileError {
            kind: DiagnosticKind::ParseError,
            message: format!("SyntaxError: Program is nested more than {MAX_NESTING} levels deep."),
            offset: Some(offset),
        });
    }
    let semantic = SemanticBuilder::new()
        .with_check_syntax_error(true)
        .with_build_nodes(true)
        .build(program);
    if let Some(d) = semantic.diagnostics.errors().next() {
        return Err(parse_error(source, program, d));
    }
    let scoping = semantic.semantic.scoping();
    let mut c = Compiler::new(scoping, semantic.semantic.nodes(), atoms);
    c.await_alias = await_alias;
    c.find_unbound(program);
    c.compute_captured();
    c.compile_program(program)?;
    Ok(Program {
        protos: c.protos.into_iter().map(Arc::new).collect(),
        consts: c.consts,
        globals: c.globals,
        templates: c.templates,
    })
}

fn parse<'a>(allocator: &'a Allocator, text: &'a str, source_type: SourceType) -> ParserReturn<'a> {
    let options = ParseOptions {
        allow_return_outside_function: true,
        preserve_parens: false,
        ..ParseOptions::default()
    };
    Parser::new(allocator, text, source_type)
        .with_options(options)
        .parse()
}

/// The source with each `await` the reference reads as a name replaced by the returned five-letter identifier, which
/// the source does not contain, padded with spaces to keep every offset (an escaped `await` is longer); `await`
/// expressions stay. `None` when the module parse fails for another reason.
fn rename_await_names(source: &str) -> Option<(String, String)> {
    let alias = (0..100)
        .map(|i| format!("$aw{i:02}"))
        .find(|p| !source.contains(p.as_str()))?;
    let mut text = source.to_owned();
    for _ in 0..256 {
        let allocator = Allocator::default();
        let parsed = parse(&allocator, &text, SourceType::mjs());
        let first = parsed.diagnostics.errors().next();
        // After an escaped `await` label, its `break` reports a plain unexpected token.
        let escaped_await = |d: &oxc_diagnostics::OxcDiagnostic| {
            d.labels.first().is_some_and(|l| {
                text.get(l.offset() as usize..(l.offset() + l.len()) as usize)
                    .is_some_and(|w| w != "await" && unescape_identifier(w) == "await")
            })
        };
        if first
            .is_some_and(|d| !names_await(&text, d) && !(parsed.fatal_error && escaped_await(d)))
        {
            return None;
        }
        let spans: Vec<(usize, usize)> = match first {
            // An escaped `await` stops the parse where it is: rename it and parse again.
            Some(d) if parsed.fatal_error => d
                .labels
                .first()
                .map(|l| (l.offset() as usize, l.offset() as usize + l.len() as usize))
                .into_iter()
                .collect(),
            _ => {
                let mut names = AwaitNames {
                    source: &text,
                    alias: &alias,
                    asyncs: Vec::new(),
                    arrow_params: false,
                    spans: Vec::new(),
                    invalid: false,
                };
                names.visit_program(&parsed.program);
                if names.invalid {
                    return None;
                }
                names.spans
            }
        };
        if spans.is_empty() {
            return first.is_none().then_some((text, alias));
        }
        for (start, end) in spans {
            let word = text.get(start..end)?;
            if word.len() < alias.len() || !word.is_ascii() || word.starts_with(alias.as_str()) {
                return None;
            }
            let name = format!("{alias}{}", " ".repeat(word.len() - alias.len()));
            text.replace_range(start..end, &name);
        }
    }
    None
}

/// The `await`s the reference reads as names. Outside every function, a plain `await` starts an `await` expression
/// unless it declares something; inside a function, every `await` is a name; inside an async function's parameters
/// or body, none is. An arrow's parameters belong to the code around it, read as an expression first, and a function
/// declaration's name too.
struct AwaitNames<'s> {
    source: &'s str,
    alias: &'s str,
    /// Whether each enclosing function, innermost last, is async.
    asyncs: Vec<bool>,
    /// In an arrow's parameters, where declarations are read like references.
    arrow_params: bool,
    spans: Vec<(usize, usize)>,
    /// An escaped `await` renamed earlier turned out to be in an async function, where the reference rejects it.
    invalid: bool,
}

impl AwaitNames<'_> {
    fn note(&mut self, name: &str, span: oxc_span::Span, declares: bool) {
        let in_async = self.asyncs.last() == Some(&true);
        if name == self.alias {
            self.invalid |= in_async;
            return;
        }
        if name != "await" || in_async {
            return;
        }
        let escaped = self.source.get(span.start as usize..span.end as usize) != Some("await");
        if !self.asyncs.is_empty() || (declares && !self.arrow_params) || escaped {
            self.spans.push((span.start as usize, span.end as usize));
        }
    }
}

impl<'a> Visit<'a> for AwaitNames<'_> {
    fn visit_function(&mut self, it: &Function<'a>, _flags: oxc_syntax::scope::ScopeFlags) {
        let declared = it.is_declaration();
        if declared && let Some(id) = &it.id {
            self.visit_binding_identifier(id);
        }
        let arrow_params = std::mem::replace(&mut self.arrow_params, false);
        self.asyncs.push(it.r#async);
        if !declared && let Some(id) = &it.id {
            self.visit_binding_identifier(id);
        }
        self.visit_formal_parameters(&it.params);
        if let Some(body) = &it.body {
            self.visit_function_body(body);
        }
        self.asyncs.pop();
        self.arrow_params = arrow_params;
    }

    fn visit_arrow_function_expression(&mut self, it: &ArrowFunctionExpression<'a>) {
        let arrow_params = std::mem::replace(&mut self.arrow_params, true);
        if it.r#async {
            self.asyncs.push(true);
        }
        self.visit_formal_parameters(&it.params);
        if it.r#async {
            self.asyncs.pop();
        }
        self.arrow_params = false;
        self.asyncs.push(it.r#async);
        self.visit_arrow_function_body(&it.body);
        self.asyncs.pop();
        self.arrow_params = arrow_params;
    }

    fn visit_binding_identifier(&mut self, it: &BindingIdentifier<'a>) {
        self.note(it.name.as_str(), it.span, true);
    }

    fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
        self.note(it.name.as_str(), it.span, false);
    }

    fn visit_label_identifier(&mut self, it: &LabelIdentifier<'a>) {
        self.note(it.name.as_str(), it.span, false);
    }
}

/// Whether a parse error is only about `await` used as a name, which a module rejects and a script allows.
fn names_await(source: &str, d: &oxc_diagnostics::OxcDiagnostic) -> bool {
    if d.message == "Cannot use `await` as an identifier in an async context" {
        return true;
    }
    let Some(label) = d.labels.first() else {
        return false;
    };
    d.message == "Keywords cannot contain escape characters"
        && source
            .get(label.offset() as usize..(label.offset() + label.len()) as usize)
            .is_some_and(|word| unescape_identifier(word) == "await")
}

/// An identifier's text with its `\uXXXX` and `\u{X}` escapes decoded.
fn unescape_identifier(word: &str) -> String {
    let mut out = String::new();
    let mut rest = word;
    while let Some(at) = rest.find("\\u") {
        out.push_str(&rest[..at]);
        rest = &rest[at + 2..];
        let (hex, after) = match rest.strip_prefix('{') {
            Some(braced) => match braced.find('}') {
                Some(end) => (&braced[..end], &braced[end + 1..]),
                None => return word.to_owned(),
            },
            None if rest.len() >= 4 && rest.is_char_boundary(4) => (&rest[..4], &rest[4..]),
            None => return word.to_owned(),
        };
        match u32::from_str_radix(hex, 16).ok().and_then(char::from_u32) {
            Some(c) => out.push(c),
            None => return word.to_owned(),
        }
        rest = after;
    }
    out.push_str(rest);
    out
}

/// Finds `await` read as a name outside every function, where the reference reads it as the operator.
struct TopLevelAwait {
    functions: u32,
    /// In the parameters of an arrow outside every function.
    arrow_params: bool,
    found: bool,
}

impl TopLevelAwait {
    fn uses(program: &oxc_ast::ast::Program) -> bool {
        let mut v = TopLevelAwait {
            functions: 0,
            arrow_params: false,
            found: false,
        };
        v.visit_program(program);
        v.found
    }
}

impl<'a> Visit<'a> for TopLevelAwait {
    fn visit_function(&mut self, it: &Function<'a>, flags: oxc_syntax::scope::ScopeFlags) {
        self.functions += 1;
        walk::walk_function(self, it, flags);
        self.functions -= 1;
    }

    fn visit_arrow_function_expression(&mut self, it: &ArrowFunctionExpression<'a>) {
        // The parameters are read as an expression around the arrow first, where a plain `await` awaits.
        if self.functions == 0 {
            self.arrow_params = true;
            self.visit_formal_parameters(&it.params);
            self.arrow_params = false;
        }
        self.functions += 1;
        walk::walk_arrow_function_expression(self, it);
        self.functions -= 1;
    }

    fn visit_binding_identifier(&mut self, it: &BindingIdentifier<'a>) {
        if self.functions == 0 && self.arrow_params && it.name == "await" && it.span.size() == 5 {
            self.found = true;
        }
    }

    fn visit_identifier_reference(&mut self, it: &IdentifierReference<'a>) {
        if self.functions == 0 && it.name == "await" {
            self.found = true;
        }
    }

    fn visit_label_identifier(&mut self, it: &LabelIdentifier<'a>) {
        if self.functions == 0 && it.name == "await" && it.span.size() == 5 {
            self.found = true;
        }
    }
}

/// Measures nesting without recursing past the limit.
struct DepthCheck {
    depth: u32,
    deepest: Option<u32>,
}

impl DepthCheck {
    fn enter(&mut self, offset: u32) -> bool {
        self.depth += 1;
        if self.depth > MAX_NESTING {
            self.deepest.get_or_insert(offset);
            return false;
        }
        true
    }
}

impl<'a> Visit<'a> for DepthCheck {
    fn visit_expression(&mut self, it: &Expression<'a>) {
        if self.enter(it.span().start) {
            walk::walk_expression(self, it);
        }
        self.depth -= 1;
    }

    fn visit_statement(&mut self, it: &Statement<'a>) {
        if self.enter(it.span().start) {
            walk::walk_statement(self, it);
        }
        self.depth -= 1;
    }

    fn visit_binding_pattern(&mut self, it: &BindingPattern<'a>) {
        if self.enter(it.span().start) {
            walk::walk_binding_pattern(self, it);
        }
        self.depth -= 1;
    }

    fn visit_assignment_target(&mut self, it: &AssignmentTarget<'a>) {
        if self.enter(it.span().start) {
            walk::walk_assignment_target(self, it);
        }
        self.depth -= 1;
    }
}

/// A parse error as the reference reports it: acorn's wording and position for what oxc found, with the reference's
/// hint that the code must be a plain JavaScript program body.
fn parse_error(
    source: &str,
    program: &oxc_ast::ast::Program,
    d: &oxc_diagnostics::OxcDiagnostic,
) -> CompileError {
    let (reason, offset) = acorn_error(source, program, d);
    CompileError {
        kind: DiagnosticKind::ParseError,
        message: parse_message(&reason),
        offset,
    }
}

fn parse_message(reason: &str) -> String {
    let dot = if reason.ends_with('.') { "" } else { "." };
    format!("SyntaxError: {reason}{dot} Code must be plain JavaScript written as a program body.")
}

/// oxc reports these where acorn, parsing a script that allows imports and exports anywhere, reads on: an import
/// below the top level is ignored or throws when it runs, and a nested export throws as unsupported syntax.
fn accepted_by_reference(d: &oxc_diagnostics::OxcDiagnostic) -> bool {
    d.message == "'import statement' declaration can only be used at the top level of a module"
        || d.message
            == "'export statement' declaration can only be used at the top level of a module"
}

/// Acorn's message and offset for an oxc diagnostic. Where acorn stops at a later token than oxc names, the offset
/// moves there; a diagnostic with no acorn counterpart keeps oxc's text.
fn acorn_error(
    source: &str,
    program: &oxc_ast::ast::Program,
    d: &oxc_diagnostics::OxcDiagnostic,
) -> (String, Option<u32>) {
    let msg: &str = &d.message;
    let label = |i: usize| d.labels.get(i).map(|l| (l.offset(), l.len()));
    let Some((at, len)) = label(0) else {
        return (msg.to_owned(), None);
    };
    let second = label(1).map_or(at, |l| l.0);
    let text = |a: u32, b: u32| source.get(a as usize..b as usize).unwrap_or("");
    let before = |a: u32| source.get(..a as usize).unwrap_or("");
    let unexpected = |o: u32| ("Unexpected token".to_owned(), Some(o));
    let named = |m: &str| -> Option<String> {
        let rest = msg.strip_prefix(m)?;
        Some(rest.split('`').next().unwrap_or("").to_owned())
    };
    let same = |o: u32| (msg.trim_end_matches('.').to_owned(), Some(o));
    let r = |m: &str, o: u32| (m.to_owned(), Some(o));
    match msg {
        "Unexpected token" if text(at, at + 4) == "enum" => r("The keyword 'enum' is reserved", at),
        "Unexpected token"
        | "Invalid function declaration"
        | "Invalid class declaration"
        | "Expected function name"
        | "Invalid rest element target in destructuring pattern"
        | "Argument of dynamic import cannot be a spread element."
        | "Unexpected JSX expression" => unexpected(at),
        "Type assertion expressions can only be used in TypeScript files." => {
            unexpected(next_token(source, word_end(source, at)))
        }
        "The left-hand side of a `for...of` statement may not start with `let`" => r(
            "The left-hand side of a for-of loop may not start with 'let'.",
            at,
        ),
        "The left-hand side of a `for...of` statement may not be `async`" => {
            let of = next_token(source, at + len);
            unexpected(next_token(source, word_end(source, of)))
        }
        "Lexical declaration cannot appear in a single-statement context" => {
            let decl = text(at, at + len);
            if decl.starts_with("using") || decl.starts_with("await") {
                r(
                    "Using declaration cannot appear in the top level when source type is `script` or in the bare case statement",
                    at,
                )
            } else {
                unexpected(at)
            }
        }
        "Invalid escape sequence" => {
            let esc = text(at, (at + len.max(2) + 16).min(source.len() as u32));
            let reason = match esc.get(1..3) {
                Some("u{") => {
                    let body = &esc[3..];
                    let hex = body.split('}').next().unwrap_or("");
                    let closed = body.len() > hex.len();
                    if closed && !hex.is_empty() && hex.chars().all(|c| c.is_ascii_hexdigit()) {
                        ("Code point out of bounds", at + 3)
                    } else {
                        ("Bad character escape sequence", at + 3)
                    }
                }
                _ => ("Bad character escape sequence", at + 2),
            };
            r(reason.0, reason.1)
        }
        "Expected a semicolon or an implicit semicolon after a statement, but found none" => {
            unexpected(next_token(source, at))
        }
        "Only a single declaration is allowed in a `for...of` statement" => {
            unexpected(next_token(source, at + len))
        }
        "A 'yield' expression is only allowed in a generator body."
        | "`await` is only allowed within async functions and at the top levels of modules"
        | "A rest parameter cannot have an initializer." => {
            unexpected(next_token(source, word_end(source, at)))
        }
        "Generators can only be declared at the top level or inside a block" => {
            unexpected(next_token(source, word_end(source, at)))
        }
        "import() requires a specifier." => {
            let open = text(at, at + len)
                .find('(')
                .map_or(at, |i| at + i as u32 + 1);
            unexpected(next_token(source, open))
        }
        "Missing initializer in const declaration" => unexpected(at + len),
        "Using declarations must have an initializer." => {
            r("Missing initializer in using declaration", at + len)
        }
        "Missing initializer in destructuring declaration" => r(
            "Complex binding patterns require an initialization value",
            at + len,
        ),
        "`let` cannot be declared as a variable name inside of a `let` declaration" => {
            r("let is disallowed as a lexically bound name", at)
        }
        "Delete of an unqualified identifier in strict mode." => r(
            "Deleting local variable in strict mode",
            keyword_before(before(at), "delete"),
        ),
        "The operand of a 'delete' operator cannot be a private identifier." => r(
            "Private fields can not be deleted",
            keyword_before(before(at), "delete"),
        ),
        "'0'-prefixed octal literals and octal escape sequences are deprecated" => {
            if text(at, at + 1) == "\"" || text(at, at + 1) == "'" {
                let slash = text(at, at + len).find('\\').map_or(at, |i| at + i as u32);
                r("Octal literal in strict mode", slash)
            } else {
                r("Invalid number", at)
            }
        }
        "Cannot use `await` as an identifier in an async context" => r(
            "Cannot use 'await' as identifier inside an async function",
            at,
        ),
        "Cannot use `yield` as an identifier in a generator context" => {
            r("Cannot use 'yield' as identifier inside a generator", at)
        }
        "Unterminated string" => match text(at, at + 1) {
            "`" => r("Unterminated template", at + 1),
            _ => r("Unterminated string constant", at),
        },
        "Unterminated multiline comment" => r("Unterminated comment", at),
        "Numeric separators must appear between digits" => {
            if text(at + 1, at + 2) == "_" {
                r("Numeric separator must be exactly one underscore", at + 1)
            } else if before(at).ends_with(|c: char| c.is_ascii_alphanumeric()) {
                r("Numeric separator is not allowed at the last of digits", at)
            } else {
                r(
                    "Numeric separator is not allowed at the first of digits",
                    at + 1,
                )
            }
        }
        "Unexpected end of file" | "Invalid characters after number" => {
            let prefix = before(at);
            let radix = |p: &str| {
                let lower = p.to_ascii_lowercase();
                [("0x", 16), ("0o", 8), ("0b", 2)]
                    .into_iter()
                    .find(|(k, _)| lower.ends_with(k))
                    .map(|(_, n)| n)
            };
            if msg == "Invalid characters after number" && text(at, at + 1) == "_" {
                r(
                    "Numeric separator is not allowed at the first of digits",
                    at,
                )
            } else if msg == "Invalid characters after number" {
                r("Identifier directly after number", at)
            } else if let Some(n) = radix(prefix) {
                (format!("Expected number in radix {n}"), Some(at))
            } else if prefix.ends_with(['e', 'E', '.', '+', '-']) {
                r("Invalid number", number_start(prefix))
            } else {
                unexpected(at)
            }
        }
        "Invalid assignment in object literal" => {
            let eq = text(at, at + len).find('=').map_or(at, |i| at + i as u32);
            r(
                "Shorthand property assignments are valid only in destructuring patterns",
                eq,
            )
        }
        "A 'get' accessor must not have any formal parameters." => {
            r("getter should have no params", at)
        }
        "A 'set' accessor must have exactly one parameter." => {
            r("setter should have exactly one param", at)
        }
        "A 'set' accessor cannot have rest parameter." => r("Setter cannot use rest params", at),
        "Logical expressions and coalesce expressions cannot be mixed" => {
            let span = text(at, at + len);
            let op = span
                .match_indices("??")
                .chain(span.match_indices("||"))
                .chain(span.match_indices("&&"))
                .map(|(i, _)| i)
                .filter(|i| *i > 0)
                .max()
                .map_or(at, |i| at + i as u32);
            r(
                "Logical expressions and coalesce expressions cannot be mixed. Wrap either by parentheses",
                op,
            )
        }
        "Missing catch or finally clause" => r(msg, keyword_before(before(at), "try")),
        "A 'default' clause cannot appear more than once in a 'switch' statement." => {
            r("Multiple default clauses", second)
        }
        "Illegal break statement" => r("Unsyntactic break", at),
        "Illegal continue statement: no surrounding iteration statement" => {
            r("Unsyntactic continue", at)
        }
        "Use of undefined label" => {
            let b = before(at).rfind("break");
            let c = before(at).rfind("continue");
            let (word, o) = match (b, c) {
                (Some(b), Some(c)) if c > b => ("continue", c),
                (Some(b), _) => ("break", b),
                (None, c) => ("continue", c.unwrap_or(at as usize)),
            };
            (format!("Unsyntactic {word}"), Some(o as u32))
        }
        "A `continue` statement can only jump to a label of an enclosing `for`, `while` or `do while` statement." => {
            r(
                "Unsyntactic continue",
                keyword_before(before(second), "continue"),
            )
        }
        "Invalid optional chain from new expression." => r(
            "Optional chaining cannot appear in the callee of new expressions",
            at,
        ),
        "Tagged template expressions are not permitted in an optional chain" => r(
            "Optional chaining cannot appear in the tag of tagged template expressions",
            at,
        ),
        "The only valid property accesses on import are `import.meta`, `import.source()`, and `import.defer()`" => {
            r(
                "The only valid meta property for import is 'import.meta'",
                after_dot(source, at),
            )
        }
        "The only valid meta property for new is new.target" => r(
            "The only valid meta property for new is 'new.target'",
            after_dot(source, at),
        ),
        "Unexpected new.target expression" => r(
            "'new.target' can only be used in functions and class static block",
            at,
        ),
        "'super' can only be referenced in members of derived classes or object literal expressions." => {
            r("'super' keyword outside a method", at)
        }
        "Super calls are not permitted outside constructors or in nested functions inside constructors." => {
            if in_method(program, at) {
                r("super() call outside constructor of a subclass", at)
            } else {
                r("'super' keyword outside a method", at)
            }
        }
        "'super' can only be referenced in a derived class." => {
            r("super() call outside constructor of a subclass", at)
        }
        "A rest parameter or binding pattern may not have a trailing comma." => {
            r("Comma is not permitted after the rest element", at)
        }
        "Illegal 'use strict' directive in function with non-simple parameter list" => {
            r(msg, enclosing_function(program, at).unwrap_or(at))
        }
        "Cannot assign to this expression" => {
            if text(at, at + len).contains("?.") {
                r("Optional chaining cannot appear in left-hand side", at)
            } else {
                r("Assigning to rvalue", at)
            }
        }
        "'with' statements are not allowed" => r("'with' in strict mode", at),
        "'using' declarations are not allowed at the top level of a script"
        | "'using' declaration cannot appear in the bare case statement." => r(
            "Using declaration cannot appear in the top level when source type is `script` or in the bare case statement",
            at,
        ),
        "Multiple constructor implementations are not allowed." => {
            r("Duplicate constructor in the same class", second)
        }
        "Classes may not have a static property named 'prototype'" => {
            r("Classes can't have a static field named 'prototype'", at)
        }
        "A 'return' statement cannot be used inside a class static block." => {
            r("'return' outside of function", at)
        }
        "Flag g is mentioned twice in regular expression literal" => r(
            "Duplicate regular expression flag",
            regex_start(before(at)) + 1,
        ),
        _ => {
            if let Some(name) = named("Identifier `") {
                return if name == "__proto__" {
                    r("Redefinition of __proto__ property", second)
                } else if label(1).is_some_and(|l| params_hold(program, at, l.0)) {
                    r("Argument name clash", second)
                } else {
                    (
                        format!("Identifier '{name}' has already been declared"),
                        Some(second),
                    )
                };
            }
            if let Some(name) = named("Label `") {
                return (format!("Label '{name}' is already declared"), Some(second));
            }
            if msg.starts_with("Expected `") && msg.contains("` but found `") {
                return unexpected(at);
            }
            if let Some(flag) = msg
                .strip_prefix("Flag ")
                .and_then(|m| m.strip_suffix(" is mentioned twice in regular expression literal"))
                && !flag.is_empty()
            {
                return r(
                    "Duplicate regular expression flag",
                    regex_start(before(at)) + 1,
                );
            }
            if msg.starts_with("Unexpected flag ")
                && msg.ends_with(" in regular expression literal")
            {
                return r(
                    "Invalid regular expression flag",
                    regex_start(before(at)) + 1,
                );
            }
            if let Some(name) = msg
                .strip_prefix("Cannot assign to '")
                .and_then(|m| m.strip_suffix("' in strict mode"))
            {
                let how = if binds_at(program, at) {
                    "Binding"
                } else {
                    "Assigning to"
                };
                return (format!("{how} {name} in strict mode"), Some(at));
            }
            if let Some(word) = msg
                .strip_prefix("Identifier expected. '")
                .and_then(|m| m.strip_suffix("' is a reserved word that cannot be used here."))
            {
                let reserved = matches!(
                    word,
                    "enum"
                        | "implements"
                        | "interface"
                        | "let"
                        | "package"
                        | "private"
                        | "protected"
                        | "public"
                        | "static"
                        | "yield"
                        | "await"
                );
                return if reserved {
                    (format!("The keyword '{word}' is reserved"), Some(at))
                } else {
                    (format!("Unexpected keyword '{word}'"), Some(at))
                };
            }
            if let Some(c) = msg
                .strip_prefix("Invalid Character `")
                .and_then(|m| m.strip_suffix('`'))
            {
                let lower = before(at).to_ascii_lowercase();
                return match [("0x", 16), ("0o", 8), ("0b", 2)]
                    .into_iter()
                    .find(|(k, _)| lower.ends_with(k))
                {
                    Some(_) if c == "_" => r(
                        "Numeric separator is not allowed at the first of digits",
                        at,
                    ),
                    Some((_, n)) => (format!("Expected number in radix {n}"), Some(at)),
                    None => (format!("Unexpected character '{c}'"), Some(at)),
                };
            }
            if let Some(name) = msg
                .strip_prefix("Private identifier '")
                .and_then(|m| m.strip_suffix("' is not allowed outside class bodies"))
            {
                return (
                    format!("Private field '{name}' must be declared in an enclosing class"),
                    Some(at),
                );
            }
            same(at)
        }
    }
}

/// Acorn's reason for a regular expression literal that the engine's syntax check (worded as the reference's host
/// words `new RegExp` failures) refuses.
fn acorn_regex_reason(reason: &str) -> &str {
    match reason {
        "missing )" => "Unterminated group",
        "unmatched parentheses" => "Unmatched ')'",
        "nothing to repeat" => "Nothing to repeat",
        "range out of order in character class" => "Range out of order in character class",
        "missing terminating ] for character class" => "Unterminated character class",
        "duplicate group specifier name" => "Duplicate capture group name",
        "invalid group specifier name" => "Invalid capture group name",
        "invalid property expression" => "Invalid property name",
        "invalid \\k<> named backreference" => "Invalid named capture referenced",
        "invalid escaped character for Unicode pattern" => "Invalid escape",
        "invalid Unicode \\u escape" => "Invalid unicode escape",
        "invalid class set character" | "invalid operation in class set" => {
            "Invalid character in character class"
        }
        "invalid range in character class for Unicode pattern" => "Invalid character class",
        "unmatched ] or } bracket for Unicode pattern" => "Lone quantifier brackets",
        "incomplete {} quantifier for Unicode pattern" => "Incomplete quantifier",
        "negated class set may contain strings" => "Negated character class may contain strings",
        "unrecognized character after (?" => "Invalid group",
        "invalid regular expression modifier" => "Invalid regular expression modifiers",
        other => other,
    }
}

/// Where the next token after `from` starts, past whitespace and comments.
fn next_token(source: &str, from: u32) -> u32 {
    let bytes = source.as_bytes();
    let mut i = from as usize;
    loop {
        match bytes.get(i) {
            Some(b' ' | b'\t' | b'\n' | b'\r') => i += 1,
            Some(b'/') if bytes.get(i + 1) == Some(&b'/') => {
                while bytes.get(i).is_some_and(|b| *b != b'\n') {
                    i += 1;
                }
            }
            Some(b'/') if bytes.get(i + 1) == Some(&b'*') => {
                match source.get(i + 2..).and_then(|r| r.find("*/")) {
                    Some(end) => i += end + 4,
                    None => return i as u32,
                }
            }
            Some(_) if source.get(i..).is_some_and(|r| r.starts_with('\u{a0}')) => i += 2,
            _ => return i as u32,
        }
    }
}

/// The end of the word that starts at `at`.
fn word_end(source: &str, at: u32) -> u32 {
    let rest = source.get(at as usize..).unwrap_or("");
    let n = rest
        .find(|c: char| !(c.is_alphanumeric() || c == '_' || c == '$'))
        .unwrap_or(rest.len());
    at + n as u32
}

/// The start of the last `word` in `before`, or its end when there is none.
fn keyword_before(before: &str, word: &str) -> u32 {
    before.rfind(word).unwrap_or(before.len()) as u32
}

/// The offset of the property after `new.` or `import.` at `at`.
fn after_dot(source: &str, at: u32) -> u32 {
    let rest = source.get(at as usize..).unwrap_or("");
    match rest.find('.') {
        Some(i) => next_token(source, at + i as u32 + 1),
        None => at,
    }
}

/// Where the number literal that `before` ends in starts.
fn number_start(before: &str) -> u32 {
    let n = before
        .bytes()
        .rev()
        .take_while(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'+' | b'-'))
        .count();
    let start = before.len() - n;
    // A sign belongs to the number only after an exponent.
    let digits = before[start..].trim_start_matches(['+', '-']);
    (before.len() - digits.len()) as u32
}

/// Where the regular expression literal whose flags `before` ends inside starts: the `/` that opens it.
fn regex_start(before: &str) -> u32 {
    let close = before.rfind('/').unwrap_or(0);
    let bytes = before.as_bytes();
    let mut i = close;
    while i > 0 {
        i -= 1;
        if bytes[i] == b'/' && (i == 0 || bytes[i - 1] != b'\\') {
            return i as u32;
        }
    }
    close as u32
}

/// Whether one parameter list holds both offsets: a duplicate parameter, which acorn calls a clash.
fn params_hold(program: &oxc_ast::ast::Program, a: u32, b: u32) -> bool {
    struct Find(u32, u32, bool);
    impl<'a> Visit<'a> for Find {
        fn visit_formal_parameters(&mut self, it: &FormalParameters<'a>) {
            if it.span.start <= self.0.min(self.1) && self.0.max(self.1) < it.span.end {
                self.2 = true;
            }
            walk::walk_formal_parameters(self, it);
        }
    }
    let mut f = Find(a, b, false);
    f.visit_program(program);
    f.2
}

/// Whether a name is declared, not assigned, at `at`.
fn binds_at(program: &oxc_ast::ast::Program, at: u32) -> bool {
    struct Find(u32, bool);
    impl<'a> Visit<'a> for Find {
        fn visit_binding_identifier(&mut self, it: &BindingIdentifier<'a>) {
            self.1 |= it.span.start == self.0;
        }
    }
    let mut f = Find(at, false);
    f.visit_program(program);
    f.1
}

/// Where the innermost function around `at` starts, with any `async` or `function` keyword before it.
fn enclosing_function(program: &oxc_ast::ast::Program, at: u32) -> Option<u32> {
    struct Find(u32, Option<oxc_span::Span>);
    impl Find {
        fn see(&mut self, span: oxc_span::Span) {
            if span.start <= self.0
                && self.0 < span.end
                && self.1.is_none_or(|s| span.size() < s.size())
            {
                self.1 = Some(span);
            }
        }
    }
    impl<'a> Visit<'a> for Find {
        fn visit_function(&mut self, it: &Function<'a>, flags: oxc_syntax::scope::ScopeFlags) {
            self.see(it.span);
            walk::walk_function(self, it, flags);
        }
        fn visit_arrow_function_expression(&mut self, it: &ArrowFunctionExpression<'a>) {
            self.see(it.span);
            walk::walk_arrow_function_expression(self, it);
        }
    }
    let mut f = Find(at, None);
    f.visit_program(program);
    f.1.map(|s| s.start)
}

/// Whether the innermost non-arrow function around `at` is a method, where acorn allows `super` but not `super()`.
fn in_method(program: &oxc_ast::ast::Program, at: u32) -> bool {
    struct Find {
        at: u32,
        methods: FxHashSet<u32>,
        inner: Option<oxc_span::Span>,
    }
    impl<'a> Visit<'a> for Find {
        fn visit_object_property(&mut self, it: &ObjectProperty<'a>) {
            if it.method || it.kind != PropertyKind::Init {
                self.methods.insert(it.value.span().start);
            }
            walk::walk_object_property(self, it);
        }
        fn visit_method_definition(&mut self, it: &MethodDefinition<'a>) {
            self.methods.insert(it.value.span.start);
            walk::walk_method_definition(self, it);
        }
        fn visit_function(&mut self, it: &Function<'a>, flags: oxc_syntax::scope::ScopeFlags) {
            let s = it.span;
            if s.start <= self.at
                && self.at < s.end
                && self.inner.is_none_or(|i| s.size() < i.size())
            {
                self.inner = Some(s);
            }
            walk::walk_function(self, it, flags);
        }
    }
    let mut f = Find {
        at,
        methods: FxHashSet::default(),
        inner: None,
    };
    f.visit_program(program);
    f.inner.is_some_and(|s| f.methods.contains(&s.start))
}

/// The reference's orientation to the supported subset, which unsupported syntax reports and suggests.
pub const SUPPORTED_SYNTAX: &str = "This is a restricted JavaScript-like language. Supported: plain and async functions, data literals, destructuring, standard control flow, await and Promise, and built-ins such as Array, Object, Math, JSON, Date, RegExp, Map, Set, and URL. Unsupported: classes, getters/setters, BigInt, and custom Symbols. Use plain functions and data objects instead.";

fn unsupported(what: &str, span: oxc_span::Span) -> CompileError {
    CompileError {
        kind: DiagnosticKind::UnsupportedSyntax,
        message: format!(
            "{what} is not supported. This is a restricted JavaScript-like language: use plain functions and data objects instead."
        ),
        offset: Some(span.start),
    }
}

#[derive(Clone, Copy)]
enum Store {
    Local(u32),
    Cell(u32),
}

#[derive(Clone, Copy)]
struct SymInfo {
    depth: usize,
    store: Store,
    tdz: bool,
    is_const: bool,
    decl_end: u32,
    switch_scoped: bool,
    name: Atom,
}

enum Control<'a> {
    Loop {
        labels: Vec<&'a str>,
        breaks: Vec<usize>,
        continues: Vec<usize>,
        /// The iterator slot of a `for...of`, and whether it is a `for await`.
        iter: Option<(u32, bool)>,
    },
    Label {
        label: &'a str,
        breaks: Vec<usize>,
    },
    Switch {
        labels: Vec<&'a str>,
        breaks: Vec<usize>,
    },
    Try,
    /// Array destructuring, guarded by a handler that closes its iterator.
    Iter(u32),
    Finally {
        body: &'a BlockStatement<'a>,
    },
}

struct FnState<'a> {
    code: Vec<Op>,
    pos: Vec<u32>,
    nlocals: u32,
    captures: Vec<Capture>,
    upval_of: FxHashMap<SymbolId, u32>,
    /// Where this function keeps its `arguments` object, made once at entry.
    args_store: Option<Store>,
    /// The upvalue an arrow reads its enclosing function's `arguments` through.
    args_upval: Option<u32>,
    controls: Vec<Control<'a>>,
    is_arrow: bool,
    is_async: bool,
    is_generator: bool,
    needs_extra: bool,
    callees: Vec<(u32, Box<str>)>,
    sites: Vec<(u32, [u32; 2])>,
    /// The instruction index a jump may land on; no instruction fuses across it.
    barrier: usize,
}

struct Compiler<'a, 's> {
    scoping: &'s Scoping,
    nodes: &'s AstNodes<'a>,
    atoms: &'s mut Strings,
    fns: Vec<FnState<'a>>,
    syms: FxHashMap<SymbolId, SymInfo>,
    captured: FxHashSet<SymbolId>,
    protos: Vec<FuncProto>,
    consts: Vec<Value>,
    str_consts: FxHashMap<String, u32>,
    num_consts: FxHashMap<u64, u32>,
    globals: Vec<Atom>,
    global_of: FxHashMap<Atom, u32>,
    templates: Vec<TemplateSite>,
    pos: u32,
    chains: Vec<Vec<usize>>,
    switch_scopes: FxHashSet<ScopeId>,
    /// Bindings that assignment cannot change: a named function expression's own name.
    readonly: FxHashSet<SymbolId>,
    /// The name `await` names were renamed to for parsing (see `rename_await_names`), which compiles as `await`.
    await_alias: Option<String>,
    /// Parameters of a function with parameter expressions, which are in their TDZ until bound in order.
    param_tdz: FxHashSet<SymbolId>,
    /// Function scopes whose `arguments` is read, and whether an arrow inside reads it.
    args_owner: FxHashMap<ScopeId, bool>,
    /// `var`s declared only inside a `with` body, which never runs, so the reference never binds them.
    unbound: FxHashSet<SymbolId>,
}

#[derive(Clone, Copy, PartialEq)]
enum BindMode {
    /// A declaration's initialization: no TDZ check, `const` allowed.
    Init,
    /// A plain assignment.
    Assign,
}

impl<'a, 's> Compiler<'a, 's> {
    fn new(scoping: &'s Scoping, nodes: &'s AstNodes<'a>, atoms: &'s mut Strings) -> Self {
        Compiler {
            scoping,
            nodes,
            atoms,
            fns: Vec::new(),
            syms: FxHashMap::default(),
            captured: FxHashSet::default(),
            protos: Vec::new(),
            consts: Vec::new(),
            str_consts: FxHashMap::default(),
            num_consts: FxHashMap::default(),
            globals: Vec::new(),
            global_of: FxHashMap::default(),
            templates: Vec::new(),
            pos: 0,
            chains: Vec::new(),
            switch_scopes: FxHashSet::default(),
            readonly: FxHashSet::default(),
            await_alias: None,
            param_tdz: FxHashSet::default(),
            args_owner: FxHashMap::default(),
            unbound: FxHashSet::default(),
        }
    }

    fn fn_scope_of(&self, mut scope: ScopeId) -> ScopeId {
        loop {
            let flags = self.scoping.scope_flags(scope);
            if flags.is_function() || flags.is_top() {
                return scope;
            }
            match self.scoping.scope_parent_id(scope) {
                Some(p) => scope = p,
                None => return scope,
            }
        }
    }

    /// A binding is captured when any reference to it sits in a different function than its declaration.
    fn compute_captured(&mut self) {
        // `arguments` belongs to the nearest enclosing function that is not an arrow.
        if let Some(refs) = self.scoping.root_unresolved_references().get("arguments") {
            for rid in refs {
                let mut scope = self.scoping.get_reference(*rid).scope_id();
                let mut through_arrow = false;
                loop {
                    let flags = self.scoping.scope_flags(scope);
                    if flags.is_top() {
                        break;
                    }
                    if flags.is_function() && !flags.is_arrow() {
                        *self.args_owner.entry(scope).or_insert(false) |= through_arrow;
                        break;
                    }
                    if flags.is_arrow() {
                        through_arrow = true;
                    }
                    match self.scoping.scope_parent_id(scope) {
                        Some(p) => scope = p,
                        None => break,
                    }
                }
            }
        }
        let mut memo: FxHashMap<ScopeId, ScopeId> = FxHashMap::default();
        for sym in self.scoping.symbol_ids() {
            let decl_scope = self.scoping.symbol_scope_id(sym);
            let decl_fn = *memo
                .entry(decl_scope)
                .or_insert_with(|| self.fn_scope_of(decl_scope));
            for rid in self.scoping.get_resolved_reference_ids(sym) {
                let rs = self.scoping.get_reference(*rid).scope_id();
                let ref_fn = match memo.get(&rs) {
                    Some(f) => *f,
                    None => {
                        let f = self.fn_scope_of(rs);
                        memo.insert(rs, f);
                        f
                    }
                };
                if ref_fn != decl_fn {
                    self.captured.insert(sym);
                    break;
                }
            }
        }
    }

    // ---------- emission helpers ----------

    fn f(&mut self) -> &mut FnState<'a> {
        self.fns.last_mut().expect("function state")
    }

    fn emit(&mut self, op: Op) -> usize {
        let pos = self.pos;
        let f = self.f();
        // Peephole fusion with the previous instruction, unless a jump lands between the two.
        if f.barrier != f.code.len()
            && let Some(prev) = f.code.last_mut()
        {
            let fused = match (*prev, op) {
                // The operator raises any error, so the fused instruction is at the operator.
                (Op::Int(k), op) => Arith::of(op).map(|a| {
                    if let Some(p) = f.pos.last_mut() {
                        *p = pos;
                    }
                    Op::ArithI(a, k)
                }),
                (Op::GetLocal(a), Op::GetLocal(b)) => Some(Op::GetLocal2(a, b)),
                (Op::ArithI(a, k), Op::JumpIfFalse(t)) if a.is_comparison() => {
                    Some(Op::JumpUnlessI(a, k, t))
                }
                (prev, Op::JumpIfFalse(t)) => Arith::of(prev)
                    .filter(|a| a.is_comparison())
                    .map(|a| Op::JumpUnless(a, t)),
                _ => None,
            };
            if let Some(fused) = fused {
                *prev = fused;
                return f.code.len() - 1;
            }
            // A binding's TDZ marker that its initialization overwrites at once is dead.
            let n = f.code.len();
            if let Op::SetLocal(l) = op
                && n >= 2
                && f.barrier + 2 <= n
                && f.code[n - 2] == Op::Uninit
                && f.code[n - 1] == Op::SetLocal(l)
            {
                f.code.truncate(n - 2);
                f.pos.truncate(n - 2);
            }
        }
        f.code.push(op);
        f.pos.push(pos);
        f.code.len() - 1
    }

    /// Emits a member instruction, recording where its object and key are when an error from it may point at them
    /// (see [`Site`]): the reference's object node has no parentheses, and its key is the computed key's expression.
    fn emit_member(&mut self, op: Op, object: &Expression, key: Option<&Expression>) -> usize {
        let at = self.emit(op);
        let pos = self.pos;
        let object = object.without_parentheses().span().start;
        let key = key.map_or(pos, |k| k.without_parentheses().span().start);
        if object != pos || key != pos {
            self.f().sites.push((at as u32, [object, key]));
        }
        at
    }

    fn emit_at(&mut self, pos: u32, op: Op) -> usize {
        let saved = std::mem::replace(&mut self.pos, pos);
        let at = self.emit(op);
        self.pos = saved;
        at
    }

    fn here(&mut self) -> u32 {
        let f = self.f();
        f.barrier = f.code.len();
        f.code.len() as u32
    }

    fn patch(&mut self, at: usize) {
        let target = self.here();
        let op = &mut self.f().code[at];
        *op = match *op {
            Op::Jump(_) => Op::Jump(target),
            Op::JumpIfFalse(_) => Op::JumpIfFalse(target),
            Op::JumpIfTrue(_) => Op::JumpIfTrue(target),
            Op::JumpUnless(a, _) => Op::JumpUnless(a, target),
            Op::JumpUnlessI(a, k, _) => Op::JumpUnlessI(a, k, target),
            Op::JumpIfFalseKeep(_) => Op::JumpIfFalseKeep(target),
            Op::JumpIfTrueKeep(_) => Op::JumpIfTrueKeep(target),
            Op::JumpIfNotNullishKeep(_) => Op::JumpIfNotNullishKeep(target),
            Op::JumpIfNotUndef(_) => Op::JumpIfNotUndef(target),
            Op::OptChain(_) => Op::OptChain(target),
            Op::OptCall(_) => Op::OptCall(target),
            Op::PushCatch(_) => Op::PushCatch(target),
            Op::PushFinally(_) => Op::PushFinally(target),
            Op::IterNext(s, _) => Op::IterNext(s, target),
            Op::Yield(_) => Op::Yield(target),
            Op::YieldDrop(_) => Op::YieldDrop(target),
            Op::YieldStar(_) => Op::YieldStar(target),
            Op::DelegateCall(s, k, _) => Op::DelegateCall(s, k, target),
            Op::DelegateResult(_, k) => Op::DelegateResult(target, k),
            Op::AsyncClose(s, _) => Op::AsyncClose(s, target),
            other => other,
        };
    }

    /// Two locals for an open iterator: the iterator, then its `next` method, read once when it opens.
    fn iter_slot(&mut self) -> u32 {
        let slot = self.new_local();
        self.new_local();
        slot
    }

    fn new_local(&mut self) -> u32 {
        let f = self.f();
        f.nlocals += 1;
        f.nlocals - 1
    }

    /// A local slot that holds a closure cell's index.
    fn new_cell(&mut self) -> u32 {
        self.new_local()
    }

    fn atom(&mut self, s: &str) -> Atom {
        let s = self.real_name(s);
        self.atoms.intern(s)
    }

    /// A name as the program wrote it: `await` for a name renamed for parsing.
    fn real_name<'n>(&self, s: &'n str) -> &'n str {
        match &self.await_alias {
            Some(alias) if s == alias => "await",
            _ => s,
        }
    }

    /// Compiles syntax the language does not support, named by its ESTree node type, to a throw at the node: as in
    /// the reference, it fails only when it runs.
    fn throw_syntax(&mut self, kind: &str, span: oxc_span::Span) -> R<()> {
        let k = self.str_const(kind);
        self.emit_at(span.start, Op::ThrowUnsupported(k));
        Ok(())
    }

    fn str_const(&mut self, s: &str) -> u32 {
        if let Some(i) = self.str_consts.get(s) {
            return *i;
        }
        let i = self.consts.len() as u32;
        let id = self.atoms.alloc(s.to_owned());
        self.consts.push(Value::Str(id));
        self.str_consts.insert(s.to_owned(), i);
        i
    }

    fn push_num(&mut self, n: f64) {
        if n.fract() == 0.0 && n.abs() <= i32::MAX as f64 && !(n == 0.0 && n.is_sign_negative()) {
            self.emit(Op::Int(n as i32));
            return;
        }
        let bits = n.to_bits();
        let i = match self.num_consts.get(&bits) {
            Some(i) => *i,
            None => {
                let i = self.consts.len() as u32;
                self.consts.push(Value::Num(n));
                self.num_consts.insert(bits, i);
                i
            }
        };
        self.emit(Op::Const(i));
    }

    fn push_str(&mut self, s: &str) {
        let i = self.str_const(s);
        self.emit(Op::Const(i));
    }

    fn global_slot(&mut self, name: &str) -> u32 {
        let a = self.atom(name);
        if let Some(s) = self.global_of.get(&a) {
            return *s;
        }
        let s = self.globals.len() as u32;
        self.globals.push(a);
        self.global_of.insert(a, s);
        s
    }

    fn depth(&self) -> usize {
        self.fns.len() - 1
    }

    // ---------- scopes and bindings ----------

    /// Allocates storage for a scope's bindings and returns them in declaration order.
    fn declare_scope(&mut self, scope: ScopeId) -> Vec<SymbolId> {
        let mut syms: Vec<SymbolId> = self.scoping.get_bindings(scope).values().copied().collect();
        syms.sort();
        let switch_scoped = self.switch_scopes.contains(&scope);
        syms.retain(|s| self.is_bound(*s));
        for s in &syms {
            if self.syms.contains_key(s) {
                continue;
            }
            self.declare_symbol(*s, None, switch_scoped);
        }
        syms
    }

    fn declare_symbol(&mut self, s: SymbolId, param_slot: Option<u32>, switch_scoped: bool) {
        let flags = self.scoping.symbol_flags(s);
        let store = if self.captured.contains(&s) {
            Store::Cell(self.new_cell())
        } else {
            Store::Local(param_slot.unwrap_or_else(|| self.new_local()))
        };
        let tdz = (flags.intersects(SymbolFlags::BlockScopedVariable | SymbolFlags::ConstVariable)
            && !flags.contains(SymbolFlags::Function))
            || self.param_tdz.contains(&s);
        let decl_end = self.decl_end(s);
        let name = self.atom(self.scoping.symbol_name(s));
        self.syms.insert(
            s,
            SymInfo {
                depth: self.depth(),
                store,
                tdz,
                is_const: flags.contains(SymbolFlags::ConstVariable),
                decl_end,
                switch_scoped,
                name,
            },
        );
    }

    fn decl_end(&self, s: SymbolId) -> u32 {
        // The end of the whole declaration, so references from inside the initializer stay checked.
        self.nodes
            .kind(self.scoping.symbol_declaration(s))
            .span()
            .end
    }

    /// Emits a scope's entry: fresh cells, TDZ markers, `var` initial values.
    fn init_scope(&mut self, syms: &[SymbolId]) {
        for s in syms {
            let Some(info) = self.syms.get(s).copied() else {
                continue;
            };
            if info.depth != self.depth() {
                continue;
            }
            let flags = self.scoping.symbol_flags(*s);
            if flags.contains(SymbolFlags::CatchVariable) {
                continue;
            }
            match info.store {
                Store::Cell(c) => {
                    self.emit(Op::NewCell(c));
                    if !info.tdz && !flags.contains(SymbolFlags::Function) {
                        self.emit(Op::Undef);
                        self.emit(Op::SetCell(c));
                    }
                }
                Store::Local(l) => {
                    if info.tdz {
                        self.emit(Op::Uninit);
                        self.emit(Op::SetLocal(l));
                    }
                }
            }
        }
    }

    /// Binds every `import` before the body runs, loading each module through the host's `%import(specifier,
    /// kind, name)` global: kind 0 a default import, 1 a namespace, 2 a named export, 3 a bare import.
    fn imports(&mut self, stmts: &'a [Statement<'a>]) -> R<()> {
        for st in stmts {
            let Statement::ImportDeclaration(d) = st else {
                continue;
            };
            if d.import_kind.is_type() || d.phase.is_some() {
                return Err(unsupported("This form of `import`", d.span));
            }
            let source = js_str(&d.source.value);
            let source = source.as_str();
            let Some(specifiers) = &d.specifiers else {
                self.import_call(
                    d.span.start,
                    |c| {
                        c.push_str(source);
                        Ok(())
                    },
                    3,
                    None,
                )?;
                self.emit(Op::Pop);
                continue;
            };
            if specifiers.is_empty() {
                self.import_call(
                    d.span.start,
                    |c| {
                        c.push_str(source);
                        Ok(())
                    },
                    3,
                    None,
                )?;
                self.emit(Op::Pop);
            }
            for spec in specifiers {
                let (kind, name, local, pos) = match spec {
                    ImportDeclarationSpecifier::ImportDefaultSpecifier(x) => {
                        (0, None, &x.local, x.span.start)
                    }
                    ImportDeclarationSpecifier::ImportNamespaceSpecifier(x) => {
                        (1, None, &x.local, x.span.start)
                    }
                    ImportDeclarationSpecifier::ImportSpecifier(x) => {
                        (2, Some(x.imported.name().as_str()), &x.local, x.span.start)
                    }
                };
                self.import_call(
                    pos,
                    |c| {
                        c.push_str(source);
                        Ok(())
                    },
                    kind,
                    name,
                )?;
                match local.symbol_id.get() {
                    Some(s) => self.store_symbol(s, BindMode::Init, pos)?,
                    None => {
                        self.emit(Op::Pop);
                    }
                }
            }
        }
        Ok(())
    }

    /// `%import(<specifier>, kind, name)`, leaving its result on the stack.
    fn import_call(
        &mut self,
        pos: u32,
        specifier: impl FnOnce(&mut Self) -> R<()>,
        kind: u8,
        name: Option<&str>,
    ) -> R<()> {
        let g = self.global_slot(crate::host::IMPORT_GLOBAL);
        self.emit(Op::GetGlobal(g));
        self.emit(Op::Undef);
        specifier(self)?;
        self.push_num(f64::from(kind));
        let argc = match name {
            Some(name) => {
                self.push_str(name);
                3
            }
            None => 2,
        };
        self.pos = pos;
        self.emit(Op::Call(argc));
        Ok(())
    }

    fn hoist_functions(&mut self, stmts: &'a [Statement<'a>]) -> R<()> {
        for st in stmts {
            if let Statement::FunctionDeclaration(f) = st {
                self.closure_for_function(f, None)?;
                let id = f.id.as_ref().and_then(|id| id.symbol_id.get());
                match id {
                    Some(s) => self.store_symbol(s, BindMode::Init, f.span.start)?,
                    None => {
                        self.emit(Op::Pop);
                    }
                }
            }
        }
        Ok(())
    }

    fn needs_check(&self, info: &SymInfo, ref_pos: u32) -> bool {
        info.tdz && (info.depth != self.depth() || info.switch_scoped || ref_pos < info.decl_end)
    }

    fn resolve_upval(&mut self, depth: usize, s: SymbolId) -> R<u32> {
        if let Some(i) = self.fns[depth].upval_of.get(&s) {
            return Ok(*i);
        }
        let info = self.syms[&s];
        let cap = if depth - 1 == info.depth {
            match info.store {
                Store::Cell(c) => Capture::Cell(c),
                Store::Local(_) => {
                    return Err(CompileError {
                        kind: DiagnosticKind::ExecutionFailure,
                        message: "internal: captured binding has no cell".into(),
                        offset: Some(self.pos),
                    });
                }
            }
        } else {
            Capture::Upval(self.resolve_upval(depth - 1, s)?)
        };
        let f = &mut self.fns[depth];
        f.captures.push(cap);
        let i = f.captures.len() as u32 - 1;
        f.upval_of.insert(s, i);
        Ok(i)
    }

    fn symbol_info(&self, s: SymbolId) -> R<SymInfo> {
        self.syms.get(&s).copied().ok_or_else(|| CompileError {
            kind: DiagnosticKind::UnsupportedSyntax,
            message: format!(
                "'{}' is used before its scope is entered.",
                self.scoping.symbol_name(s)
            ),
            offset: Some(self.pos),
        })
    }

    fn load_symbol(&mut self, s: SymbolId, ref_pos: u32) -> R<()> {
        let info = self.symbol_info(s)?;
        let chk = self.needs_check(&info, ref_pos);
        if info.depth == self.depth() {
            match (info.store, chk) {
                (Store::Local(l), false) => self.emit(Op::GetLocal(l)),
                (Store::Local(l), true) => self.emit(Op::GetLocalChk(l, info.name)),
                (Store::Cell(c), false) => self.emit(Op::GetCell(c)),
                (Store::Cell(c), true) => self.emit(Op::GetCellChk(c, info.name)),
            };
        } else {
            let u = self.resolve_upval(self.depth(), s)?;
            self.emit(if chk {
                Op::GetUpvalChk(u, info.name)
            } else {
                Op::GetUpval(u)
            });
        }
        Ok(())
    }

    /// Pops the top of the stack into the binding.
    fn store_symbol(&mut self, s: SymbolId, mode: BindMode, ref_pos: u32) -> R<()> {
        let info = self.symbol_info(s)?;
        if mode == BindMode::Assign {
            if info.is_const || self.readonly.contains(&s) {
                self.emit(Op::Pop);
                self.emit(Op::ThrowConst(info.name));
                return Ok(());
            }
            if self.needs_check(&info, ref_pos) {
                self.load_symbol(s, ref_pos)?;
                self.emit(Op::Pop);
            }
        }
        if info.depth == self.depth() {
            match info.store {
                Store::Local(l) => self.emit(Op::SetLocal(l)),
                Store::Cell(c) => self.emit(Op::SetCell(c)),
            };
        } else {
            let u = self.resolve_upval(self.depth(), s)?;
            self.emit(Op::SetUpval(u));
        }
        Ok(())
    }

    /// The binding a name refers to; `None` for a global. A class's name is not a binding: classes do not run, so as
    /// in the reference, the name reads the global of that name.
    fn ident_symbol(&self, id: &IdentifierReference) -> Option<SymbolId> {
        id.reference_id
            .get()
            .and_then(|r| self.scoping.get_reference(r).symbol_id())
            .filter(|s| self.is_bound(*s))
    }

    /// Whether the reference binds a declared name: not a class's name, nor a `var` that only syntax that never runs
    /// declares.
    fn is_bound(&self, s: SymbolId) -> bool {
        !self.scoping.symbol_flags(s).is_class() && !self.unbound.contains(&s)
    }

    fn find_unbound(&mut self, program: &oxc_ast::ast::Program) {
        struct Withs(Vec<oxc_span::Span>);
        impl<'a> Visit<'a> for Withs {
            fn visit_with_statement(&mut self, it: &WithStatement<'a>) {
                self.0.push(it.body.span());
            }
        }
        let mut withs = Withs(Vec::new());
        withs.visit_program(program);
        if withs.0.is_empty() {
            return;
        }
        let inside = |span: oxc_span::Span| {
            withs
                .0
                .iter()
                .any(|w| w.start <= span.start && span.end <= w.end)
        };
        for sym in self.scoping.symbol_ids() {
            if inside(self.scoping.symbol_span(sym))
                && self
                    .scoping
                    .symbol_redeclarations(sym)
                    .iter()
                    .all(|r| inside(r.span))
            {
                self.unbound.insert(sym);
            }
        }
    }

    /// Reads a name, failing (unknown, or in its TDZ) at the name itself, as the reference locates it even when it is
    /// parenthesized or the target of an assignment.
    fn load_ident(&mut self, id: &IdentifierReference) -> R<()> {
        let saved = std::mem::replace(&mut self.pos, id.span.start);
        let r = self.load_ident_here(id);
        self.pos = saved;
        r
    }

    fn load_ident_here(&mut self, id: &IdentifierReference) -> R<()> {
        if let Some(s) = self.ident_symbol(id) {
            return self.load_symbol(s, id.span.start);
        }
        match id.name.as_str() {
            "undefined" => {
                self.emit(Op::Undef);
            }
            "arguments" if self.f().args_store.is_some() => match self.f().args_store {
                Some(Store::Cell(c)) => {
                    self.emit(Op::GetCell(c));
                }
                _ => {
                    let l = match self.f().args_store {
                        Some(Store::Local(l)) => l,
                        _ => 0,
                    };
                    self.emit(Op::GetLocal(l));
                }
            },
            "arguments" if self.f().is_arrow && self.args_depth().is_some() => {
                let u = self.resolve_args_upval(self.depth())?;
                self.emit(Op::GetUpval(u));
            }
            name => {
                let g = self.global_slot(name);
                self.emit(Op::GetGlobal(g));
            }
        }
        Ok(())
    }

    /// The depth of the function whose `arguments` an arrow at the current depth reads.
    fn args_depth(&self) -> Option<usize> {
        let d = self.fns.iter().rposition(|f| !f.is_arrow)?;
        self.fns[d].args_store.map(|_| d)
    }

    fn resolve_args_upval(&mut self, depth: usize) -> R<u32> {
        if let Some(u) = self.fns[depth].args_upval {
            return Ok(u);
        }
        let parent = depth - 1;
        let cap = if self.fns[parent].is_arrow {
            Capture::Upval(self.resolve_args_upval(parent)?)
        } else {
            match self.fns[parent].args_store {
                Some(Store::Cell(c)) => Capture::Cell(c),
                _ => {
                    return Err(CompileError {
                        kind: DiagnosticKind::ExecutionFailure,
                        message: "internal: captured arguments have no cell".into(),
                        offset: Some(self.pos),
                    });
                }
            }
        };
        let f = &mut self.fns[depth];
        f.captures.push(cap);
        let i = f.captures.len() as u32 - 1;
        f.args_upval = Some(i);
        Ok(i)
    }

    /// Pops the top of the stack into a name, failing at the name itself (see `load_ident`).
    fn store_ident(&mut self, id: &IdentifierReference) -> R<()> {
        let saved = std::mem::replace(&mut self.pos, id.span.start);
        let r = self.store_ident_here(id);
        self.pos = saved;
        r
    }

    fn store_ident_here(&mut self, id: &IdentifierReference) -> R<()> {
        match self.ident_symbol(id) {
            Some(s) => self.store_symbol(s, BindMode::Assign, id.span.start),
            // `arguments` is a mutable binding of its function.
            None if id.name == "arguments"
                && (self.f().args_store.is_some()
                    || (self.f().is_arrow && self.args_depth().is_some())) =>
            {
                match self.f().args_store {
                    Some(Store::Cell(c)) => self.emit(Op::SetCell(c)),
                    Some(Store::Local(l)) => self.emit(Op::SetLocal(l)),
                    None => {
                        let u = self.resolve_args_upval(self.depth())?;
                        self.emit(Op::SetUpval(u))
                    }
                };
                Ok(())
            }
            None => {
                let a = self.atom(id.name.as_str());
                self.emit(Op::Pop);
                if self.global_of.contains_key(&a)
                    || is_builtin_global(id.name.as_str())
                    || id.name == "undefined"
                {
                    self.emit(Op::ThrowConst(a));
                } else {
                    self.emit(Op::ThrowRef(a));
                }
                Ok(())
            }
        }
    }

    /// A plain, initialized-for-sure local of the current function, for fused instructions.
    fn plain_local(&self, id: &IdentifierReference) -> Option<u32> {
        let s = self.ident_symbol(id)?;
        let info = self.syms.get(&s)?;
        if info.depth != self.depth() || info.is_const || self.needs_check(info, id.span.start) {
            return None;
        }
        match info.store {
            Store::Local(l) => Some(l),
            Store::Cell(_) => None,
        }
    }

    // ---------- functions ----------

    fn compile_program(&mut self, program: &'a oxc_ast::ast::Program<'a>) -> R<()> {
        self.fns.push(FnState::new(false));
        self.f().is_async = true;
        let name = self.atom("");
        let syms = match program.scope_id.get() {
            Some(scope) => self.declare_scope(scope),
            None => Vec::new(),
        };
        self.init_scope(&syms);
        self.imports(&program.body)?;
        self.hoist_functions(&program.body)?;
        if program.body.is_empty()
            && let Some(d) = program.directives.last()
        {
            let text = js_str(&d.expression.value);
            self.push_str(&text);
            self.emit(Op::Return);
        }
        let n = program.body.len();
        for (i, st) in program.body.iter().enumerate() {
            if i + 1 == n
                && let Statement::ExpressionStatement(e) = st
            {
                self.pos = e.span.start;
                self.expr(&e.expression)?;
                self.emit(Op::Return);
                break;
            }
            self.stmt(st)?;
        }
        self.emit(Op::Undef);
        self.emit(Op::Return);
        let f = self.fns.pop().expect("program state");
        self.protos.insert(
            0,
            FuncProto {
                name,
                code: f.code,
                pos: f.pos,
                nparams: 0,
                length: 0,
                nlocals: f.nlocals,
                captures: Vec::new(),
                is_async: true,
                is_generator: false,
                is_arrow: false,
                is_program: true,
                needs_extra: false,
                callees: f.callees,
                sites: f.sites,
            },
        );
        // Closure instructions index `protos` assuming the program is not in the list; shift them.
        for p in self.protos.iter_mut() {
            for op in p.code.iter_mut() {
                if let Op::Closure(i) = op {
                    *i += 1;
                }
            }
        }
        Ok(())
    }

    fn closure_for_function(&mut self, f: &'a Function<'a>, name: Option<&str>) -> R<()> {
        let Some(body) = &f.body else {
            return Err(unsupported("Function declarations without a body", f.span));
        };
        let own_name =
            f.id.as_ref()
                .map(|id| id.name.as_str())
                .or(name)
                .unwrap_or("");
        let self_sym = match f.r#type {
            FunctionType::FunctionExpression => f.id.as_ref().and_then(|id| id.symbol_id.get()),
            _ => None,
        };
        let idx = self.compile_function(FnSpec {
            name: own_name,
            params: &f.params,
            body: FnBody::Block(body),
            scope: f.scope_id.get(),
            is_async: f.r#async,
            is_generator: f.generator,
            is_arrow: false,
            self_sym,
        })?;
        self.emit(Op::Closure(idx));
        Ok(())
    }

    fn closure_for_arrow(
        &mut self,
        f: &'a ArrowFunctionExpression<'a>,
        name: Option<&str>,
    ) -> R<()> {
        let body = match &f.body {
            ArrowFunctionBody::FunctionBody(b) => FnBody::Block(b),
            other => match other.as_expression() {
                Some(e) => FnBody::Expr(e),
                None => return Err(unsupported("This arrow function body", f.span)),
            },
        };
        let idx = self.compile_function(FnSpec {
            name: name.unwrap_or(""),
            params: &f.params,
            body,
            scope: f.scope_id.get(),
            is_async: f.r#async,
            is_generator: false,
            is_arrow: true,
            self_sym: None,
        })?;
        self.emit(Op::Closure(idx));
        Ok(())
    }

    fn compile_function(&mut self, spec: FnSpec<'a, '_>) -> R<u32> {
        let saved_pos = self.pos;
        let saved_chains = std::mem::take(&mut self.chains);
        self.fns.push(FnState::new(spec.is_arrow));
        self.f().is_async = spec.is_async;
        self.f().is_generator = spec.is_generator;
        let params = spec.params;
        let nparams = params.items.len() as u32;
        self.f().nlocals = nparams;
        let length = params
            .items
            .iter()
            .take_while(|p| p.initializer.is_none())
            .count() as u32;
        if params.rest.is_some() {
            self.f().needs_extra = true;
        }
        // Simple parameters bind straight to their argument slot. With parameter expressions, every parameter is
        // bound in order instead, so one read before its turn is in its TDZ.
        let simple = params.rest.is_none()
            && params.items.iter().all(|p| {
                p.initializer.is_none() && matches!(p.pattern, BindingPattern::BindingIdentifier(_))
            });
        for (i, p) in params.items.iter().enumerate() {
            if let BindingPattern::BindingIdentifier(id) = &p.pattern
                && let Some(s) = id.symbol_id.get()
            {
                if simple {
                    self.declare_symbol(s, Some(i as u32), false);
                } else {
                    self.param_tdz.insert(s);
                }
            }
        }
        let syms = match spec.scope {
            Some(scope) => self.declare_scope(scope),
            None => Vec::new(),
        };
        self.init_scope(&syms);
        if !spec.is_arrow
            && let Some(captured) = spec.scope.and_then(|s| self.args_owner.get(&s).copied())
        {
            self.f().needs_extra = true;
            self.emit(Op::Arguments);
            let store = if captured {
                let c = self.new_cell();
                self.emit(Op::NewCell(c));
                self.emit(Op::SetCell(c));
                Store::Cell(c)
            } else {
                let l = self.new_local();
                self.emit(Op::SetLocal(l));
                Store::Local(l)
            };
            self.f().args_store = Some(store);
        }
        // A named function expression's own name is bound outside its parameters, so their defaults see it too.
        if let Some(s) = spec.self_sym
            && self.syms.get(&s).is_some_and(|i| i.depth == self.depth())
        {
            self.readonly.insert(s);
            self.emit(Op::Callee);
            self.store_symbol(s, BindMode::Init, 0)?;
        }
        for (i, p) in params.items.iter().enumerate() {
            if simple
                && let BindingPattern::BindingIdentifier(id) = &p.pattern
                && let Some(s) = id.symbol_id.get()
            {
                if let Some(Store::Cell(c)) = self.syms.get(&s).map(|i| i.store) {
                    self.emit(Op::GetLocal(i as u32));
                    self.emit(Op::SetCell(c));
                }
                continue;
            }
            self.pos = p.span.start;
            self.emit(Op::GetLocal(i as u32));
            if let Some(init) = &p.initializer {
                let j = self.emit(Op::JumpIfNotUndef(0));
                self.emit(Op::Pop);
                let hint = pattern_name(&p.pattern);
                self.expr_named(init, hint)?;
                self.patch(j);
            }
            self.bind_pattern(&p.pattern, BindMode::Init)?;
        }
        if let Some(rest) = &params.rest {
            self.emit(Op::Rest(nparams));
            self.bind_pattern(&rest.rest.argument, BindMode::Init)?;
        }
        if spec.is_generator {
            self.emit(Op::GeneratorStart);
        }
        match spec.body {
            FnBody::Block(b) => {
                self.hoist_functions(&b.statements)?;
                for st in &b.statements {
                    self.stmt(st)?;
                }
                self.emit(Op::Undef);
                self.emit(Op::Return);
            }
            FnBody::Expr(e) => {
                self.expr(e)?;
                self.emit(Op::Return);
            }
        }
        let f = self.fns.pop().expect("function state");
        self.chains = saved_chains;
        self.pos = saved_pos;
        let name = self.atom(spec.name);
        self.protos.push(FuncProto {
            name,
            code: f.code,
            pos: f.pos,
            nparams,
            length,
            nlocals: f.nlocals,
            captures: f.captures,
            is_async: spec.is_async,
            is_generator: spec.is_generator,
            is_arrow: spec.is_arrow,
            is_program: false,
            needs_extra: f.needs_extra,
            callees: f.callees,
            sites: f.sites,
        });
        Ok(self.protos.len() as u32 - 1)
    }

    // ---------- statements ----------

    fn stmts(&mut self, stmts: &'a [Statement<'a>]) -> R<()> {
        for s in stmts {
            self.stmt(s)?;
        }
        Ok(())
    }

    fn block(&mut self, b: &'a BlockStatement<'a>) -> R<()> {
        let syms = match b.scope_id.get() {
            Some(scope) => self.declare_scope(scope),
            None => Vec::new(),
        };
        self.init_scope(&syms);
        self.hoist_functions(&b.body)?;
        self.stmts(&b.body)
    }

    fn stmt(&mut self, st: &'a Statement<'a>) -> R<()> {
        self.pos = st.span().start;
        match st {
            Statement::BlockStatement(b) => self.block(b),
            Statement::EmptyStatement(_) => Ok(()),
            Statement::DebuggerStatement(d) => self.throw_syntax("DebuggerStatement", d.span),
            Statement::ExpressionStatement(e) => self.expr_stmt(&e.expression),
            Statement::VariableDeclaration(d) => self.var_decl(d),
            Statement::FunctionDeclaration(_) => Ok(()),
            Statement::IfStatement(s) => {
                self.expr(&s.test)?;
                let j = self.emit(Op::JumpIfFalse(0));
                self.stmt(&s.consequent)?;
                match &s.alternate {
                    Some(alt) => {
                        let end = self.emit(Op::Jump(0));
                        self.patch(j);
                        self.stmt(alt)?;
                        self.patch(end);
                    }
                    None => self.patch(j),
                }
                Ok(())
            }
            Statement::ReturnStatement(r) => {
                match &r.argument {
                    Some(a) => {
                        self.expr(a)?;
                        if self.f().is_async && self.f().is_generator {
                            self.emit(Op::Await);
                        }
                    }
                    None => {
                        self.emit(Op::Undef);
                    }
                }
                self.emit_return()
            }
            Statement::ThrowStatement(t) => {
                self.expr(&t.argument)?;
                self.emit(Op::Throw);
                Ok(())
            }
            Statement::WhileStatement(w) => self.while_loop(w, Vec::new()),
            Statement::DoWhileStatement(w) => self.do_while(w, Vec::new()),
            Statement::ForStatement(f) => self.for_loop(f, Vec::new()),
            Statement::ForOfStatement(f) => self.for_of(f, Vec::new()),
            Statement::ForInStatement(f) => self.for_in(f, Vec::new()),
            Statement::BreakStatement(b) => {
                self.jump_out(true, b.label.as_ref().map(|l| l.name.as_str()))
            }
            Statement::ContinueStatement(c) => {
                self.jump_out(false, c.label.as_ref().map(|l| l.name.as_str()))
            }
            Statement::LabeledStatement(l) => self.labeled(l),
            Statement::SwitchStatement(s) => self.switch(s, Vec::new()),
            Statement::TryStatement(t) => self.try_stmt(t),
            Statement::ClassDeclaration(c) => self.throw_syntax("ClassDeclaration", c.span),
            Statement::WithStatement(w) => self.throw_syntax("WithStatement", w.span),
            // Bound before the body runs (see `imports`); one below the top level of the program does nothing there,
            // and in a function throws when it runs.
            Statement::ImportDeclaration(d) => {
                if self.depth() > 0 {
                    let msg = self.str_const(
                        "An import declaration may only appear at the top level of the program.",
                    );
                    self.emit_at(d.span.start, Op::ThrowSyntax(msg));
                }
                Ok(())
            }
            // Only reached below the top level: `compile` refuses an export at the top.
            Statement::ExportAllDeclaration(d) => self.throw_syntax("ExportAllDeclaration", d.span),
            Statement::ExportDefaultDeclaration(d) => {
                self.throw_syntax("ExportDefaultDeclaration", d.span)
            }
            Statement::ExportNamedDeclaration(d) => {
                self.throw_syntax("ExportNamedDeclaration", d.span)
            }
            Statement::ExportDeclaration(d) => self.throw_syntax("ExportNamedDeclaration", d.span),
            Statement::ExportFromDeclaration(d) => {
                self.throw_syntax("ExportNamedDeclaration", d.span)
            }
            other => Err(unsupported("TypeScript syntax", other.span())),
        }
    }

    fn expr_stmt(&mut self, e: &'a Expression<'a>) -> R<()> {
        if let Expression::UpdateExpression(u) = e
            && u.operator == UpdateOperator::Increment
            && let SimpleAssignmentTarget::AssignmentTargetIdentifier(id) = &u.argument
            && let Some(l) = self.plain_local(id)
        {
            self.pos = u.span.start;
            self.emit(Op::IncLocal(l));
            return Ok(());
        }
        if let Expression::AssignmentExpression(a) = e
            && a.operator == AssignmentOperator::Assign
            && let AssignmentTarget::AssignmentTargetIdentifier(id) = &a.left
        {
            self.pos = a.span.start;
            self.expr_named(&a.right, Some(id.name.as_str()))?;
            return self.store_ident(id);
        }
        if let Expression::AssignmentExpression(a) = e
            && a.operator == AssignmentOperator::Addition
            && let AssignmentTarget::AssignmentTargetIdentifier(id) = &a.left
            && let Some(l) = self.plain_local(id)
        {
            self.pos = a.span.start;
            self.expr(&a.right)?;
            self.emit(Op::AddLocal(l));
            return Ok(());
        }
        if let Expression::YieldExpression(y) = e
            && !y.delegate
        {
            return self.yield_expr(y, true);
        }
        self.expr(e)?;
        self.emit(Op::Pop);
        Ok(())
    }

    /// A `yield`. Resuming it with `next(v)` continues after the inline return path with `v` pushed, unless `drop`;
    /// `return(v)` runs that path with `v` pushed, and `throw(e)` throws at the `yield`.
    fn yield_expr(&mut self, y: &'a YieldExpression<'a>, drop: bool) -> R<()> {
        match &y.argument {
            Some(a) => self.expr(a)?,
            None => {
                self.emit(Op::Undef);
            }
        }
        if y.delegate {
            self.yield_delegate()?;
            if drop {
                self.emit(Op::Pop);
            }
            return Ok(());
        }
        let is_async = self.f().is_async;
        if is_async {
            self.emit(Op::Await);
        }
        let at = self.emit(if drop { Op::YieldDrop(0) } else { Op::Yield(0) });
        self.return_path(is_async)?;
        self.patch(at);
        Ok(())
    }

    /// What a `return(v)` request runs at a `yield`: `v` is on the stack.
    fn return_path(&mut self, is_async: bool) -> R<()> {
        if is_async {
            self.emit(Op::Await);
        }
        self.emit_return()
    }

    /// `yield*` over the iterable on the stack, forwarding `next`, `throw` and `return` requests to its iterator.
    fn yield_delegate(&mut self) -> R<()> {
        let is_async = self.f().is_async;
        let flag = if is_async { DELEGATE_ASYNC } else { 0 };
        let it = self.iter_slot();
        self.emit(if is_async {
            Op::GetAsyncIter(it, ITER_DELEGATE)
        } else {
            Op::GetIter(it, ITER_DELEGATE)
        });
        self.emit(Op::Undef);
        let lp = self.here();
        self.emit(Op::DelegateCall(it, flag, 0));
        if is_async {
            self.emit(Op::Await);
        }
        let mut dones = vec![self.emit(Op::DelegateResult(0, REQ_NEXT))];
        let ys = self.here();
        self.emit(Op::YieldStar(lp));
        let to_ret = self.emit(Op::Jump(0));
        // A `throw(e)` request resumes here with `e` on the stack.
        let no_throw = self.emit(Op::DelegateCall(it, flag | 1, 0));
        if is_async {
            self.emit(Op::Await);
        }
        dones.push(self.emit(Op::DelegateResult(0, REQ_THROW)));
        self.emit(Op::Jump(ys));
        self.patch(no_throw);
        self.emit(Op::Pop);
        self.close_iter(it, is_async);
        let msg = self.str_const("The delegated iterator does not provide a throw() method.");
        self.emit(Op::ThrowType(msg));
        self.patch(to_ret);
        if is_async {
            self.emit(Op::Await);
        }
        let plain = self.emit(Op::DelegateCall(it, flag | 2, 0));
        if is_async {
            self.emit(Op::Await);
        }
        let ret_done = self.emit(Op::DelegateResult(0, REQ_RETURN));
        self.emit(Op::Jump(ys));
        self.patch(plain);
        self.patch(ret_done);
        self.emit_return()?;
        for d in dones {
            self.patch(d);
        }
        Ok(())
    }

    /// Closes the iterator in `slot` on a normal completion: calls its `return()` and checks the result.
    fn close_iter(&mut self, slot: u32, is_async: bool) {
        if !is_async {
            self.emit(Op::IterClose(slot));
            return;
        }
        let skip = self.emit(Op::AsyncClose(slot, 0));
        self.emit(Op::Await);
        self.emit(Op::CheckObject);
        self.emit(Op::Pop);
        self.patch(skip);
    }

    fn var_decl(&mut self, d: &'a VariableDeclaration<'a>) -> R<()> {
        match d.kind {
            // A `using` binding is a `const` that nothing disposes, as in the reference.
            VariableDeclarationKind::Var
            | VariableDeclarationKind::Let
            | VariableDeclarationKind::Const
            | VariableDeclarationKind::Using
            | VariableDeclarationKind::AwaitUsing => {}
        }
        for decl in &d.declarations {
            self.pos = decl.span.start;
            match &decl.init {
                Some(init) => {
                    self.expr_named(init, pattern_name(&decl.id))?;
                    self.bind_pattern(&decl.id, BindMode::Init)?;
                }
                None => {
                    if d.kind != VariableDeclarationKind::Var {
                        self.emit(Op::Undef);
                        self.bind_pattern(&decl.id, BindMode::Init)?;
                    }
                }
            }
        }
        Ok(())
    }

    fn emit_return(&mut self) -> R<()> {
        let unwinding = self.f().controls.iter().any(|c| {
            matches!(
                c,
                Control::Try
                    | Control::Iter(_)
                    | Control::Finally { .. }
                    | Control::Loop { iter: Some(_), .. }
            )
        });
        if !unwinding {
            self.emit(Op::Return);
            return Ok(());
        }
        let tmp = self.new_local();
        self.emit(Op::SetLocal(tmp));
        let n = self.f().controls.len();
        self.unwind_to(0, n)?;
        self.emit(Op::GetLocal(tmp));
        self.emit(Op::Return);
        Ok(())
    }

    /// Emits the cleanup for leaving controls `from..to` (innermost first).
    fn unwind_to(&mut self, from: usize, to: usize) -> R<()> {
        for i in (from..to).rev() {
            match &self.f().controls[i] {
                Control::Try => {
                    self.emit(Op::PopTry);
                }
                Control::Iter(slot) => {
                    let slot = *slot;
                    self.emit(Op::PopTry);
                    self.emit(Op::IterClose(slot));
                }
                Control::Loop {
                    iter: Some((slot, is_async)),
                    ..
                } => {
                    let (slot, is_async) = (*slot, *is_async);
                    self.emit(Op::PopTry);
                    self.close_iter(slot, is_async);
                }
                Control::Finally { body } => {
                    let body: &'a BlockStatement<'a> = body;
                    self.emit(Op::PopTry);
                    let tail = self.f().controls.split_off(i);
                    let r = self.block(body);
                    self.f().controls.extend(tail);
                    r?;
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn jump_out(&mut self, is_break: bool, label: Option<&str>) -> R<()> {
        let controls = &self.f().controls;
        let mut target = None;
        for (i, c) in controls.iter().enumerate().rev() {
            let hit = match (c, label) {
                (Control::Loop { .. }, None) => true,
                (Control::Switch { .. }, None) => is_break,
                (Control::Loop { labels, .. }, Some(l)) => labels.contains(&l),
                (Control::Switch { labels, .. }, Some(l)) => is_break && labels.contains(&l),
                (Control::Label { label: x, .. }, Some(l)) => is_break && *x == l,
                _ => false,
            };
            if hit {
                target = Some(i);
                break;
            }
        }
        let Some(t) = target else {
            return Err(CompileError {
                kind: DiagnosticKind::ParseError,
                message: "SyntaxError: Illegal break or continue statement".into(),
                offset: Some(self.pos),
            });
        };
        let n = self.f().controls.len();
        self.unwind_to(t + 1, n)?;
        if is_break
            && let Control::Loop {
                iter: Some((slot, is_async)),
                ..
            } = self.f().controls[t]
        {
            self.emit(Op::PopTry);
            self.close_iter(slot, is_async);
        }
        let j = self.emit(Op::Jump(0));
        match &mut self.f().controls[t] {
            Control::Loop {
                breaks, continues, ..
            } => {
                if is_break {
                    breaks.push(j)
                } else {
                    continues.push(j)
                }
            }
            Control::Switch { breaks, .. } | Control::Label { breaks, .. } => breaks.push(j),
            _ => {}
        }
        Ok(())
    }

    fn push_loop(&mut self, labels: Vec<&'a str>, iter: Option<(u32, bool)>) {
        self.f().controls.push(Control::Loop {
            labels,
            breaks: Vec::new(),
            continues: Vec::new(),
            iter,
        });
    }

    /// Pops the loop control, patching continues to `cont` and breaks to here.
    fn pop_loop_continues(&mut self, cont: u32) -> Vec<usize> {
        let Some(Control::Loop {
            breaks, continues, ..
        }) = self.f().controls.pop()
        else {
            return Vec::new();
        };
        for c in continues {
            if let Op::Jump(_) = self.f().code[c] {
                self.f().code[c] = Op::Jump(cont);
            }
        }
        breaks
    }

    fn while_loop(&mut self, w: &'a WhileStatement<'a>, labels: Vec<&'a str>) -> R<()> {
        let top = self.here();
        self.expr(&w.test)?;
        let exit = self.emit(Op::JumpIfFalse(0));
        self.push_loop(labels, None);
        self.stmt(&w.body)?;
        self.emit(Op::Jump(top));
        let breaks = self.pop_loop_continues(top);
        self.patch(exit);
        for b in breaks {
            self.patch(b);
        }
        Ok(())
    }

    fn do_while(&mut self, w: &'a DoWhileStatement<'a>, labels: Vec<&'a str>) -> R<()> {
        let top = self.here();
        self.push_loop(labels, None);
        self.stmt(&w.body)?;
        let cont = self.here();
        let breaks = self.pop_loop_continues(cont);
        self.expr(&w.test)?;
        self.emit(Op::JumpIfTrue(top));
        for b in breaks {
            self.patch(b);
        }
        Ok(())
    }

    fn for_loop(&mut self, f: &'a ForStatement<'a>, labels: Vec<&'a str>) -> R<()> {
        let syms = match f.scope_id.get() {
            Some(scope) => self.declare_scope(scope),
            None => Vec::new(),
        };
        self.init_scope(&syms);
        match &f.init {
            Some(ForStatementInit::VariableDeclaration(d)) => self.var_decl(d)?,
            Some(other) => {
                if let Some(e) = other.as_expression() {
                    self.expr(e)?;
                    self.emit(Op::Pop);
                }
            }
            None => {}
        }
        let per_iteration: Vec<u32> = syms
            .iter()
            .filter_map(|s| match self.syms.get(s) {
                Some(SymInfo {
                    store: Store::Cell(c),
                    depth,
                    ..
                }) if *depth == self.depth() => Some(*c),
                _ => None,
            })
            .collect();
        // The first iteration gets its own copy too, so closures made by the initializer keep the initial binding.
        for c in &per_iteration {
            self.emit(Op::GetCell(*c));
            self.emit(Op::NewCell(*c));
            self.emit(Op::SetCell(*c));
        }
        let top = self.here();
        let exit = match &f.test {
            Some(t) => {
                self.expr(t)?;
                Some(self.emit(Op::JumpIfFalse(0)))
            }
            None => None,
        };
        self.push_loop(labels, None);
        self.stmt(&f.body)?;
        let cont = self.here();
        let breaks = self.pop_loop_continues(cont);
        for c in &per_iteration {
            self.emit(Op::GetCell(*c));
            self.emit(Op::NewCell(*c));
            self.emit(Op::SetCell(*c));
        }
        if let Some(u) = &f.update {
            self.expr_stmt(u)?;
        }
        self.emit(Op::Jump(top));
        if let Some(e) = exit {
            self.patch(e);
        }
        for b in breaks {
            self.patch(b);
        }
        Ok(())
    }

    /// Binds the loop variable of a `for...of`/`for...in` head from the value on the stack.
    fn bind_for_left(&mut self, left: &'a ForStatementLeft<'a>, syms: &[SymbolId]) -> R<()> {
        self.init_scope(syms);
        match left {
            ForStatementLeft::VariableDeclaration(d) => {
                let Some(decl) = d.declarations.first() else {
                    return Ok(());
                };
                self.bind_pattern(&decl.id, BindMode::Init)
            }
            other => match other.as_assignment_target() {
                Some(t) => self.assign_target(t),
                None => Err(unsupported("This loop head", other.span())),
            },
        }
    }

    fn for_of(&mut self, f: &'a ForOfStatement<'a>, labels: Vec<&'a str>) -> R<()> {
        if f.r#await {
            return self.for_await(f, labels);
        }
        let syms = match f.scope_id.get() {
            Some(scope) => self.declare_scope(scope),
            None => Vec::new(),
        };
        self.init_scope(&syms);
        self.loop_head_expr(&f.right, &syms)?;
        let slot = self.iter_slot();
        self.emit(Op::GetIter(slot, ITER_FOR_OF));
        let handler = self.emit(Op::PushFinally(0));
        let top = self.here();
        let exit = self.emit(Op::IterNext(slot, 0));
        self.push_loop(labels, Some((slot, false)));
        self.bind_for_left(&f.left, &syms)?;
        self.stmt(&f.body)?;
        self.emit(Op::Jump(top));
        let breaks = self.pop_loop_continues(top);
        self.patch(exit);
        self.emit(Op::PopTry);
        let end = self.emit(Op::Jump(0));
        self.patch(handler);
        let exc = self.new_local();
        self.emit(Op::SetLocal(exc));
        self.emit(Op::IterCloseQuiet(slot));
        self.emit(Op::GetLocal(exc));
        self.emit(Op::Throw);
        self.patch(end);
        for b in breaks {
            self.patch(b);
        }
        Ok(())
    }

    /// `for await`: each step awaits `next()` outside the body's handler, so a failed step does not close the
    /// iterator, while a throw from the binding or body closes it and awaits `return()`.
    fn for_await(&mut self, f: &'a ForOfStatement<'a>, labels: Vec<&'a str>) -> R<()> {
        let syms = match f.scope_id.get() {
            Some(scope) => self.declare_scope(scope),
            None => Vec::new(),
        };
        self.init_scope(&syms);
        self.loop_head_expr(&f.right, &syms)?;
        let slot = self.iter_slot();
        self.emit(Op::GetAsyncIter(slot, ITER_FOR_AWAIT));
        let top = self.here();
        self.emit(Op::Undef);
        self.emit(Op::DelegateCall(slot, DELEGATE_ASYNC | DELEGATE_NO_ARG, 0));
        self.emit(Op::Await);
        let exit = self.emit(Op::DelegateResult(0, REQ_NEXT));
        let handler = self.emit(Op::PushFinally(0));
        self.push_loop(labels, Some((slot, true)));
        self.bind_for_left(&f.left, &syms)?;
        self.stmt(&f.body)?;
        let cont = self.here();
        self.emit(Op::PopTry);
        self.emit(Op::Jump(top));
        let breaks = self.pop_loop_continues(cont);
        self.patch(handler);
        let exc = self.new_local();
        self.emit(Op::SetLocal(exc));
        let swallow = self.emit(Op::PushCatch(0));
        let skip = self.emit(Op::AsyncClose(slot, 0));
        self.emit(Op::Await);
        self.emit(Op::Pop);
        self.patch(skip);
        self.emit(Op::PopTry);
        let rethrow = self.emit(Op::Jump(0));
        self.patch(swallow);
        self.emit(Op::Pop);
        self.patch(rethrow);
        self.emit(Op::GetLocal(exc));
        self.emit(Op::Throw);
        self.patch(exit);
        self.emit(Op::Pop);
        for b in breaks {
            self.patch(b);
        }
        Ok(())
    }

    /// The iterated expression of a `for...of`/`for...in` head, which sees the loop's own bindings in their TDZ
    /// although it comes after them in the source.
    fn loop_head_expr(&mut self, e: &'a Expression<'a>, syms: &[SymbolId]) -> R<()> {
        let mut forced = Vec::new();
        for s in syms {
            if let Some(info) = self.syms.get_mut(s)
                && info.tdz
                && !info.switch_scoped
            {
                info.switch_scoped = true;
                forced.push(*s);
            }
        }
        let r = self.expr(e);
        for s in forced {
            if let Some(info) = self.syms.get_mut(&s) {
                info.switch_scoped = false;
            }
        }
        r
    }

    fn for_in(&mut self, f: &'a ForInStatement<'a>, labels: Vec<&'a str>) -> R<()> {
        let syms = match f.scope_id.get() {
            Some(scope) => self.declare_scope(scope),
            None => Vec::new(),
        };
        self.init_scope(&syms);
        self.loop_head_expr(&f.right, &syms)?;
        let slot = self.iter_slot();
        self.pos = f.right.span().start;
        self.emit(Op::ForIn(slot));
        self.pos = f.span.start;
        let top = self.here();
        let exit = self.emit(Op::IterNext(slot, 0));
        self.push_loop(labels, None);
        self.bind_for_left(&f.left, &syms)?;
        self.stmt(&f.body)?;
        self.emit(Op::Jump(top));
        let breaks = self.pop_loop_continues(top);
        self.patch(exit);
        for b in breaks {
            self.patch(b);
        }
        Ok(())
    }

    fn labeled(&mut self, l: &'a LabeledStatement<'a>) -> R<()> {
        let mut labels = vec![l.label.name.as_str()];
        let mut body = &l.body;
        while let Statement::LabeledStatement(inner) = body {
            labels.push(inner.label.name.as_str());
            body = &inner.body;
        }
        self.pos = body.span().start;
        match body {
            Statement::WhileStatement(w) => self.while_loop(w, labels),
            Statement::DoWhileStatement(w) => self.do_while(w, labels),
            Statement::ForStatement(f) => self.for_loop(f, labels),
            Statement::ForOfStatement(f) => self.for_of(f, labels),
            Statement::ForInStatement(f) => self.for_in(f, labels),
            Statement::SwitchStatement(s) => self.switch(s, labels),
            other => {
                for label in &labels {
                    self.f().controls.push(Control::Label {
                        label,
                        breaks: Vec::new(),
                    });
                }
                self.stmt(other)?;
                for _ in &labels {
                    if let Some(Control::Label { breaks, .. }) = self.f().controls.pop() {
                        for b in breaks {
                            self.patch(b);
                        }
                    }
                }
                Ok(())
            }
        }
    }

    fn switch(&mut self, s: &'a SwitchStatement<'a>, labels: Vec<&'a str>) -> R<()> {
        self.expr(&s.discriminant)?;
        let tmp = self.new_local();
        self.emit(Op::SetLocal(tmp));
        let syms = match s.scope_id.get() {
            Some(scope) => {
                self.switch_scopes.insert(scope);
                self.declare_scope(scope)
            }
            None => Vec::new(),
        };
        self.init_scope(&syms);
        for case in &s.cases {
            self.hoist_functions(&case.consequent)?;
        }
        let mut jumps = Vec::new();
        for case in &s.cases {
            if let Some(t) = &case.test {
                self.emit(Op::GetLocal(tmp));
                self.expr(t)?;
                self.emit(Op::StrictEq);
                jumps.push(Some(self.emit(Op::JumpIfTrue(0))));
            } else {
                jumps.push(None);
            }
        }
        let to_default = self.emit(Op::Jump(0));
        self.f().controls.push(Control::Switch {
            labels,
            breaks: Vec::new(),
        });
        let mut default_at = None;
        for (case, j) in s.cases.iter().zip(jumps) {
            match j {
                Some(j) => self.patch(j),
                None => default_at = Some(self.here()),
            }
            self.stmts(&case.consequent)?;
        }
        let Some(Control::Switch { breaks, .. }) = self.f().controls.pop() else {
            return Ok(());
        };
        match default_at {
            Some(d) => self.f().code[to_default] = Op::Jump(d),
            None => self.patch(to_default),
        }
        for b in breaks {
            self.patch(b);
        }
        Ok(())
    }

    fn try_stmt(&mut self, t: &'a TryStatement<'a>) -> R<()> {
        let fin = if let Some(fb) = &t.finalizer {
            let h = self.emit(Op::PushFinally(0));
            self.f().controls.push(Control::Finally { body: fb });
            Some((h, fb))
        } else {
            None
        };
        match &t.handler {
            Some(h) => {
                let catch_at = self.emit(Op::PushCatch(0));
                self.f().controls.push(Control::Try);
                self.block(&t.block)?;
                self.f().controls.pop();
                self.emit(Op::PopTry);
                let after = self.emit(Op::Jump(0));
                self.patch(catch_at);
                let mut syms = match h.scope_id.get() {
                    Some(scope) => self.declare_scope(scope),
                    None => Vec::new(),
                };
                if let Some(scope) = h.body.scope_id.get() {
                    syms.extend(self.declare_scope(scope));
                }
                self.init_scope(&syms);
                for s in &syms {
                    if self
                        .scoping
                        .symbol_flags(*s)
                        .contains(SymbolFlags::CatchVariable)
                        && let Some(SymInfo {
                            store: Store::Cell(c),
                            ..
                        }) = self.syms.get(s)
                    {
                        let c = *c;
                        self.emit(Op::NewCell(c));
                    }
                }
                match &h.param {
                    Some(p) => self.bind_pattern(&p.pattern, BindMode::Init)?,
                    None => {
                        self.emit(Op::Pop);
                    }
                }
                self.block(&h.body)?;
                self.patch(after);
            }
            None => self.block(&t.block)?,
        }
        if let Some((h, fb)) = fin {
            self.f().controls.pop();
            self.emit(Op::PopTry);
            self.block(fb)?;
            let end = self.emit(Op::Jump(0));
            self.patch(h);
            let exc = self.new_local();
            self.emit(Op::SetLocal(exc));
            self.block(fb)?;
            self.emit(Op::GetLocal(exc));
            self.emit(Op::Throw);
            self.patch(end);
        }
        Ok(())
    }

    // ---------- patterns ----------

    /// Binds a declaration pattern from the value on the stack, consuming it.
    fn bind_pattern(&mut self, p: &'a BindingPattern<'a>, mode: BindMode) -> R<()> {
        match p {
            BindingPattern::BindingIdentifier(id) => match id.symbol_id.get() {
                Some(s) => self.store_symbol(s, mode, id.span.start),
                None => {
                    self.emit(Op::Pop);
                    Ok(())
                }
            },
            BindingPattern::AssignmentPattern(a) => {
                let j = self.emit(Op::JumpIfNotUndef(0));
                self.emit(Op::Pop);
                self.expr_named(&a.right, pattern_name(&a.left))?;
                self.patch(j);
                self.bind_pattern(&a.left, mode)
            }
            BindingPattern::ObjectPattern(o) => {
                let saved = self.pos;
                self.pos = o.span.start;
                self.emit(Op::RequireCoercible);
                let mut saved_keys = Vec::new();
                for prop in &o.properties {
                    self.pos = prop.span.start;
                    self.emit(Op::Dup);
                    let k =
                        self.destruct_key(&prop.key, prop.computed, prop.span, o.rest.is_some())?;
                    saved_keys.push(k);
                    self.bind_pattern(&prop.value, mode)?;
                }
                let r = match &o.rest {
                    Some(rest) => {
                        self.pos = rest.span.start;
                        self.push_keys(&saved_keys);
                        self.emit(Op::ObjRest(saved_keys.len() as u32));
                        self.bind_pattern(&rest.argument, mode)
                    }
                    None => {
                        self.emit(Op::Pop);
                        Ok(())
                    }
                };
                self.pos = saved;
                r
            }
            BindingPattern::ArrayPattern(a) => {
                let saved = self.pos;
                self.pos = a.span.start;
                let slot = self.iter_slot();
                self.emit(Op::GetIter(slot, ITER_DESTRUCTURE));
                let guard = self.emit(Op::PushFinally(0));
                self.f().controls.push(Control::Iter(slot));
                for el in &a.elements {
                    self.pos = el.as_ref().map_or(a.span.start, |p| p.span().start);
                    self.emit(Op::IterStep(slot));
                    match el {
                        Some(p) => self.bind_pattern(p, mode)?,
                        None => {
                            self.emit(Op::Pop);
                        }
                    }
                }
                if let Some(rest) = &a.rest {
                    self.pos = rest.span.start;
                    self.emit(Op::IterRest(slot));
                    self.bind_pattern(&rest.argument, mode)?;
                }
                self.pos = a.span.start;
                self.close_iter_guard(guard, slot);
                self.pos = saved;
                Ok(())
            }
        }
    }

    /// Reads a destructuring pattern property's key from the object on the stack, at the property, as the
    /// reference's `GET_PROP`/`GET_ELEM` in destructuring mode do. A computed key is made a key at its expression
    /// first, and kept in a local when `keep` (an object rest excludes it).
    fn destruct_key(
        &mut self,
        key: &'a PropertyKey<'a>,
        computed: bool,
        span: Span,
        keep: bool,
    ) -> R<KeyRef> {
        if let Some(k) = static_key(key, computed) {
            let a = self.atom(&k);
            self.emit(Op::DestructProp(a));
            return Ok(KeyRef::Static(k));
        }
        let Some(e) = key.as_expression() else {
            return Err(unsupported("Private names", span));
        };
        self.expr(e)?;
        self.pos = e.span().start;
        self.emit(Op::ToKey);
        self.pos = span.start;
        let k = if keep {
            let t = self.new_local();
            self.emit(Op::Dup);
            self.emit(Op::SetLocal(t));
            KeyRef::Local(t)
        } else {
            KeyRef::Static(String::new())
        };
        self.emit(Op::DestructElem);
        Ok(k)
    }

    /// Ends array destructuring guarded by the `PushFinally` at `guard`: closes the iterator, and on an abrupt
    /// completion closes it quietly and rethrows.
    fn close_iter_guard(&mut self, guard: usize, slot: u32) {
        self.f().controls.pop();
        self.emit(Op::PopTry);
        self.emit(Op::IterClose(slot));
        let end = self.emit(Op::Jump(0));
        self.patch(guard);
        let exc = self.new_local();
        self.emit(Op::SetLocal(exc));
        self.emit(Op::IterCloseQuiet(slot));
        self.emit(Op::GetLocal(exc));
        self.emit(Op::Throw);
        self.patch(end);
    }

    fn push_keys(&mut self, keys: &[KeyRef]) {
        for k in keys {
            match k {
                KeyRef::Static(s) => self.push_str(s),
                KeyRef::Local(l) => {
                    self.emit(Op::GetLocal(*l));
                }
            }
        }
    }

    /// Assigns the value on the stack to an assignment target, consuming it.
    fn assign_target(&mut self, t: &'a AssignmentTarget<'a>) -> R<()> {
        match t {
            AssignmentTarget::ArrayAssignmentTarget(a) => {
                let saved = self.pos;
                self.pos = a.span.start;
                let slot = self.iter_slot();
                self.emit(Op::GetIter(slot, ITER_DESTRUCTURE));
                let guard = self.emit(Op::PushFinally(0));
                self.f().controls.push(Control::Iter(slot));
                for el in &a.elements {
                    self.pos = el.as_ref().map_or(a.span.start, |m| m.span().start);
                    self.emit(Op::IterStep(slot));
                    match el {
                        Some(m) => self.assign_maybe_default(m)?,
                        None => {
                            self.emit(Op::Pop);
                        }
                    }
                }
                if let Some(rest) = &a.rest {
                    self.pos = rest.span.start;
                    self.emit(Op::IterRest(slot));
                    self.assign_target(&rest.target)?;
                }
                self.pos = a.span.start;
                self.close_iter_guard(guard, slot);
                self.pos = saved;
                Ok(())
            }
            AssignmentTarget::ObjectAssignmentTarget(o) => {
                let saved = self.pos;
                self.pos = o.span.start;
                self.emit(Op::RequireCoercible);
                let mut saved_keys = Vec::new();
                for prop in &o.properties {
                    self.pos = prop.span().start;
                    self.emit(Op::Dup);
                    match prop {
                        AssignmentTargetProperty::AssignmentTargetPropertyIdentifier(p) => {
                            let name = p.binding.name.as_str();
                            let a = self.atom(name);
                            self.emit(Op::DestructProp(a));
                            saved_keys.push(KeyRef::Static(name.to_owned()));
                            if let Some(init) = &p.init {
                                let j = self.emit(Op::JumpIfNotUndef(0));
                                self.emit(Op::Pop);
                                self.expr_named(init, Some(name))?;
                                self.patch(j);
                            }
                            self.pos = p.binding.span.start;
                            self.store_ident(&p.binding)?;
                        }
                        AssignmentTargetProperty::AssignmentTargetPropertyProperty(p) => {
                            let k =
                                self.destruct_key(&p.name, p.computed, p.span, o.rest.is_some())?;
                            saved_keys.push(k);
                            self.assign_maybe_default(&p.binding)?;
                        }
                    }
                }
                let r = match &o.rest {
                    Some(rest) => {
                        self.pos = rest.span.start;
                        self.push_keys(&saved_keys);
                        self.emit(Op::ObjRest(saved_keys.len() as u32));
                        self.assign_target(&rest.target)
                    }
                    None => {
                        self.emit(Op::Pop);
                        Ok(())
                    }
                };
                self.pos = saved;
                r
            }
            other => match other.as_simple_assignment_target() {
                Some(s) => {
                    let saved = self.pos;
                    self.pos = s.span().start;
                    let r = self.assign_simple(s);
                    self.pos = saved;
                    r
                }
                None => Err(unsupported("This assignment target", other.span())),
            },
        }
    }

    fn assign_maybe_default(&mut self, m: &'a AssignmentTargetMaybeDefault<'a>) -> R<()> {
        match m {
            AssignmentTargetMaybeDefault::AssignmentTargetWithDefault(d) => {
                let j = self.emit(Op::JumpIfNotUndef(0));
                self.emit(Op::Pop);
                self.expr(&d.init)?;
                self.patch(j);
                self.assign_target(&d.binding)
            }
            other => match other.as_assignment_target() {
                Some(t) => self.assign_target(t),
                None => Err(unsupported("This assignment target", other.span())),
            },
        }
    }

    fn assign_simple(&mut self, s: &'a SimpleAssignmentTarget<'a>) -> R<()> {
        match s {
            SimpleAssignmentTarget::AssignmentTargetIdentifier(id) => self.store_ident(id),
            SimpleAssignmentTarget::StaticMemberExpression(m) => {
                self.expr(&m.object)?;
                self.emit(Op::Swap);
                let a = self.atom(m.property.name.as_str());
                self.emit_member(Op::SetProp(a), &m.object, None);
                self.emit(Op::Pop);
                Ok(())
            }
            SimpleAssignmentTarget::ComputedMemberExpression(m) => {
                self.expr(&m.object)?;
                self.expr(&m.expression)?;
                self.emit_member(Op::WriteKey, &m.object, Some(&m.expression));
                self.emit(Op::Rot3Back);
                self.emit_member(Op::SetElem, &m.object, Some(&m.expression));
                self.emit(Op::Pop);
                Ok(())
            }
            other => Err(unsupported("This assignment target", other.span())),
        }
    }

    // ---------- expressions ----------

    fn expr_named(&mut self, e: &'a Expression<'a>, name: Option<&str>) -> R<()> {
        match e {
            Expression::ArrowFunctionExpression(a) => {
                self.pos = a.span.start;
                self.closure_for_arrow(a, name)
            }
            Expression::FunctionExpression(f) if f.id.is_none() => {
                self.pos = f.span.start;
                self.closure_for_function(f, name)
            }
            _ => self.expr(e),
        }
    }

    fn expr(&mut self, e: &'a Expression<'a>) -> R<()> {
        let saved = self.pos;
        self.pos = e.span().start;
        let r = self.expr_inner(e);
        self.pos = saved;
        r
    }

    fn expr_inner(&mut self, e: &'a Expression<'a>) -> R<()> {
        match e {
            Expression::BooleanLiteral(b) => {
                self.emit(if b.value { Op::True } else { Op::False });
            }
            Expression::NullLiteral(_) => {
                self.emit(Op::Null);
            }
            Expression::NumericLiteral(n) => self.push_num(n.value),
            Expression::StringLiteral(s) => {
                let text = js_str(&s.value);
                self.push_str(&text);
            }
            Expression::TemplateLiteral(t) => self.template(t)?,
            Expression::Identifier(id) => self.load_ident(id)?,
            Expression::ThisExpression(_) => {
                self.emit(Op::This);
            }
            Expression::ArrayExpression(a) => self.array_lit(a)?,
            Expression::ObjectExpression(o) => self.object_lit(o)?,
            Expression::ArrowFunctionExpression(a) => self.closure_for_arrow(a, None)?,
            Expression::FunctionExpression(f) => self.closure_for_function(f, None)?,
            Expression::UnaryExpression(u) => self.unary(u)?,
            Expression::BinaryExpression(b) => {
                self.expr(&b.left)?;
                self.expr(&b.right)?;
                self.emit(binary_op(b.operator));
            }
            Expression::LogicalExpression(l) => {
                self.expr(&l.left)?;
                let j = self.emit(match l.operator {
                    LogicalOperator::And => Op::JumpIfFalseKeep(0),
                    LogicalOperator::Or => Op::JumpIfTrueKeep(0),
                    LogicalOperator::Coalesce => Op::JumpIfNotNullishKeep(0),
                });
                self.expr(&l.right)?;
                self.patch(j);
            }
            Expression::ConditionalExpression(c) => {
                self.expr(&c.test)?;
                let j = self.emit(Op::JumpIfFalse(0));
                self.expr(&c.consequent)?;
                let end = self.emit(Op::Jump(0));
                self.patch(j);
                self.expr(&c.alternate)?;
                self.patch(end);
            }
            Expression::AssignmentExpression(a) => self.assignment(a)?,
            Expression::UpdateExpression(u) => self.update(u)?,
            Expression::SequenceExpression(s) => {
                let n = s.expressions.len();
                for (i, x) in s.expressions.iter().enumerate() {
                    self.expr(x)?;
                    if i + 1 < n {
                        self.emit(Op::Pop);
                    }
                }
            }
            Expression::ParenthesizedExpression(p) => self.expr(&p.expression)?,
            Expression::CallExpression(c) => self.call(c)?,
            Expression::NewExpression(n) => {
                self.expr(&n.callee)?;
                self.emit(Op::Undef);
                let argc = self.args(&n.arguments)?;
                self.pos = n.span.start;
                let at = match argc {
                    Some(argc) => self.emit(Op::New(argc)),
                    None => self.emit(Op::NewSpread),
                };
                self.name_callee(at, &n.callee);
            }
            Expression::StaticMemberExpression(m) => {
                self.expr(&m.object)?;
                if m.optional {
                    self.opt_chain();
                }
                let a = self.atom(m.property.name.as_str());
                self.emit_member(Op::GetProp(a), &m.object, None);
            }
            Expression::ComputedMemberExpression(m) => {
                self.expr(&m.object)?;
                if m.optional {
                    self.opt_chain();
                }
                self.elem_key(&m.object, &m.expression)?;
            }
            Expression::ChainExpression(c) => {
                self.chains.push(Vec::new());
                match &c.expression {
                    ChainElement::CallExpression(call) => self.call(call)?,
                    other => match other.as_member_expression() {
                        Some(m) => self.expr(m_as_expr(m))?,
                        None => return Err(unsupported("TypeScript syntax", other.span())),
                    },
                }
                let patches = self.chains.pop().unwrap_or_default();
                for p in patches {
                    self.patch(p);
                }
            }
            Expression::AwaitExpression(a) => {
                self.expr(&a.argument)?;
                self.emit(Op::Await);
            }
            Expression::YieldExpression(y) => self.yield_expr(y, false)?,
            Expression::ClassExpression(c) => self.throw_syntax("ClassExpression", c.span)?,
            Expression::RegExpLiteral(r) => {
                let pattern = r.regex.pattern.text.as_str();
                let flags = r.regex.flags.to_string();
                if let Err(message) = crate::builtins::regexp::validate_literal(pattern, &flags) {
                    let prefix = format!("Invalid regular expression: /{pattern}/{flags}: ");
                    let reason = match message.strip_prefix(&prefix) {
                        Some(reason) => format!(
                            "Invalid regular expression: /{pattern}/: {}",
                            acorn_regex_reason(reason)
                        ),
                        None => "Invalid regular expression flag".to_owned(),
                    };
                    // Acorn locates a literal's errors just after its opening slash.
                    return Err(CompileError {
                        kind: DiagnosticKind::ParseError,
                        message: parse_message(&reason),
                        offset: Some(r.span.start + 1),
                    });
                }
                self.push_str(pattern);
                self.push_str(&flags);
                self.emit(Op::RegExp);
            }
            Expression::BigIntLiteral(_) => {
                let msg = self.str_const("BigInt literals are not supported.");
                self.emit(Op::ThrowType(msg));
            }
            Expression::TaggedTemplateExpression(t) => self.tagged_template(t)?,
            Expression::Super(s) => self.throw_syntax("Super", s.span)?,
            Expression::ImportExpression(i) => match &i.options {
                // The options are evaluated, after the specifier's string, and ignored.
                Some(options) => self.import_call(
                    i.span.start,
                    |c| {
                        c.expr(&i.source)?;
                        c.emit_at(i.source.span().start, Op::ToStr);
                        c.expr(options)?;
                        c.emit(Op::Pop);
                        Ok(())
                    },
                    4,
                    None,
                )?,
                None => self.import_call(i.span.start, |c| c.expr(&i.source), 4, None)?,
            },
            Expression::ImportMeta(m) => self.throw_syntax("MetaProperty", m.span)?,
            Expression::NewTarget(m) => self.throw_syntax("MetaProperty", m.span)?,
            Expression::PrivateFieldExpression(p) => {
                return Err(unsupported("Private fields", p.span));
            }
            Expression::PrivateInExpression(p) => {
                return Err(unsupported("Private fields", p.span));
            }
            other => return Err(unsupported("This syntax", other.span())),
        }
        Ok(())
    }

    fn opt_chain(&mut self) {
        let j = self.emit(Op::OptChain(0));
        if let Some(c) = self.chains.last_mut() {
            c.push(j);
        }
    }

    fn elem_key(&mut self, object: &'a Expression<'a>, key: &'a Expression<'a>) -> R<()> {
        if let Expression::StringLiteral(s) = key {
            let a = self.atom(&js_str(&s.value));
            if self.atoms.index(a).is_none() {
                self.emit_member(Op::GetProp(a), object, Some(key));
                return Ok(());
            }
        }
        self.expr(key)?;
        self.emit_member(Op::GetElem, object, Some(key));
        Ok(())
    }

    fn template(&mut self, t: &'a TemplateLiteral<'a>) -> R<()> {
        let mut parts = 0u32;
        for (i, q) in t.quasis.iter().enumerate() {
            let cooked =
                q.value.cooked.as_ref().map(js_str).unwrap_or_else(|| {
                    crate::strings::external_text(q.value.raw.as_str().to_owned())
                });
            if !cooked.is_empty() || (t.expressions.is_empty() && i == 0) {
                self.push_str(&cooked);
                parts += 1;
            }
            if let Some(e) = t.expressions.get(i) {
                self.expr(e)?;
                self.emit_at(e.without_parentheses().span().start, Op::ToStr);
                parts += 1;
            }
        }
        if parts != 1 {
            self.emit(Op::Concat(parts));
        }
        Ok(())
    }

    /// `tag\`...\``: calls the tag, read like a callee, with the site's strings array and the substitutions.
    fn tagged_template(&mut self, t: &'a TaggedTemplateExpression<'a>) -> R<()> {
        match &t.tag {
            Expression::StaticMemberExpression(m) => {
                self.expr(&m.object)?;
                let a = self.atom(m.property.name.as_str());
                self.emit_member(Op::GetMethod(a), &m.object, None);
            }
            Expression::ComputedMemberExpression(m) => {
                self.expr(&m.object)?;
                self.emit(Op::Dup);
                self.elem_key(&m.object, &m.expression)?;
                self.emit(Op::Swap);
            }
            tag => {
                self.expr(tag)?;
                self.emit(Op::Undef);
            }
        }
        let quasis = &t.quasi.quasis;
        let cooked = quasis
            .iter()
            .map(|q| {
                q.value.cooked.as_ref().map(|c| {
                    let i = self.str_const(&js_str(c));
                    self.consts[i as usize]
                })
            })
            .collect();
        let raw = quasis
            .iter()
            .map(|q| {
                let i = self.str_const(&crate::strings::external_text(
                    q.value.raw.as_str().to_owned(),
                ));
                self.consts[i as usize]
            })
            .collect();
        self.templates.push(TemplateSite { cooked, raw });
        self.emit(Op::Template(self.templates.len() as u32 - 1));
        for e in &t.quasi.expressions {
            self.expr(e)?;
        }
        self.pos = t.span.start;
        self.emit(Op::Call(1 + t.quasi.expressions.len() as u32));
        Ok(())
    }

    fn array_lit(&mut self, a: &'a ArrayExpression<'a>) -> R<()> {
        let simple = a.elements.iter().all(|e| e.as_expression().is_some());
        if simple {
            for el in &a.elements {
                if let Some(e) = el.as_expression() {
                    self.expr(e)?;
                }
            }
            self.emit(Op::NewArray(a.elements.len() as u32));
            return Ok(());
        }
        self.emit(Op::NewArray(0));
        for el in &a.elements {
            match el {
                ArrayExpressionElement::SpreadElement(s) => {
                    self.expr(&s.argument)?;
                    self.pos = s.span.start;
                    self.emit(Op::ArraySpread);
                }
                ArrayExpressionElement::Elision(_) => {
                    // The TDZ marker is how an array holds a hole.
                    self.emit(Op::Uninit);
                    self.emit(Op::ArrayPush);
                }
                other => {
                    if let Some(e) = other.as_expression() {
                        self.expr(e)?;
                        self.emit(Op::ArrayPush);
                    }
                }
            }
        }
        Ok(())
    }

    fn object_lit(&mut self, o: &'a ObjectExpression<'a>) -> R<()> {
        self.emit(Op::NewObject);
        for p in &o.properties {
            match p {
                ObjectPropertyKind::SpreadProperty(s) => {
                    self.expr(&s.argument)?;
                    self.pos = s.span.start;
                    self.emit(Op::ObjectSpread);
                }
                ObjectPropertyKind::ObjectProperty(p) => {
                    // Like the reference, an accessor fails when the literal runs, after the properties before it.
                    if p.kind != PropertyKind::Init {
                        let msg = self.str_const("Only init object properties are supported.");
                        self.pos = p.span.start;
                        self.emit(Op::ThrowType(msg));
                        continue;
                    }
                    self.pos = p.span.start;
                    match static_key(&p.key, p.computed) {
                        Some(k) => {
                            self.expr_named(&p.value, Some(&k))?;
                            let a = self.atom(&k);
                            self.emit(Op::DefineField(a));
                        }
                        None => {
                            let Some(e) = p.key.as_expression() else {
                                return Err(unsupported("Private names", p.span));
                            };
                            self.expr(e)?;
                            self.emit_at(e.without_parentheses().span().start, Op::ToKey);
                            self.expr(&p.value)?;
                            self.emit(Op::DefineElem);
                        }
                    }
                }
            }
        }
        Ok(())
    }

    /// Pushes call arguments; returns the count, or `None` after building one array for spread arguments.
    fn args(&mut self, args: &'a [Argument<'a>]) -> R<Option<u32>> {
        if args.iter().all(|a| a.as_expression().is_some()) {
            for a in args {
                if let Some(e) = a.as_expression() {
                    self.expr(e)?;
                }
            }
            return Ok(Some(args.len() as u32));
        }
        self.emit(Op::NewArray(0));
        for a in args {
            match a {
                Argument::SpreadElement(s) => {
                    self.expr(&s.argument)?;
                    self.pos = s.span.start;
                    self.emit(Op::ArraySpread);
                }
                other => {
                    if let Some(e) = other.as_expression() {
                        self.expr(e)?;
                        self.emit(Op::ArrayPush);
                    }
                }
            }
        }
        Ok(None)
    }

    /// `delete`: a member expression deletes, optionally; an identifier fails when it runs, as in the reference;
    /// anything else is evaluated and gives true.
    fn delete(&mut self, argument: &'a Expression<'a>) -> R<()> {
        let argument = argument.without_parentheses();
        if let Expression::Identifier(id) = argument {
            let msg = self.str_const("Only data fields may be deleted.");
            self.pos = id.span.start;
            self.emit(Op::ThrowType(msg));
            return Ok(());
        }
        let member = match argument {
            Expression::ChainExpression(c) => c.expression.as_member_expression(),
            other => other.as_member_expression(),
        };
        let Some(member) = member else {
            self.expr(argument)?;
            self.emit(Op::Pop);
            self.emit(Op::True);
            return Ok(());
        };
        self.chains.push(Vec::new());
        match member {
            MemberExpression::StaticMemberExpression(m) => {
                self.expr(&m.object)?;
                if m.optional {
                    self.opt_chain();
                }
                let a = self.atom(m.property.name.as_str());
                self.pos = m.span.start;
                self.emit_member(Op::DelProp(a), &m.object, None);
            }
            MemberExpression::ComputedMemberExpression(m) => {
                self.expr(&m.object)?;
                if m.optional {
                    self.opt_chain();
                }
                self.expr(&m.expression)?;
                self.pos = m.span.start;
                self.emit_member(Op::DelElem, &m.object, Some(&m.expression));
            }
            MemberExpression::PrivateFieldExpression(p) => {
                return Err(unsupported("Private fields", p.span));
            }
        }
        // A short-circuited chain deletes nothing and gives true.
        let patches = self.chains.pop().unwrap_or_default();
        if !patches.is_empty() {
            let end = self.emit(Op::Jump(0));
            for p in patches {
                self.patch(p);
            }
            self.emit(Op::Pop);
            self.emit(Op::True);
            self.patch(end);
        }
        Ok(())
    }

    fn call(&mut self, c: &'a CallExpression<'a>) -> R<()> {
        match &c.callee {
            Expression::StaticMemberExpression(m) => {
                self.expr(&m.object)?;
                if m.optional {
                    self.opt_chain();
                }
                let a = self.atom(m.property.name.as_str());
                self.emit_member(Op::GetMethod(a), &m.object, None);
            }
            Expression::ComputedMemberExpression(m) => {
                self.expr(&m.object)?;
                if m.optional {
                    self.opt_chain();
                }
                self.emit(Op::Dup);
                self.elem_key(&m.object, &m.expression)?;
                self.emit(Op::Swap);
            }
            Expression::Super(s) => {
                self.throw_syntax("Super", s.span)?;
                return Ok(());
            }
            callee => {
                self.expr(callee)?;
                self.emit(Op::Undef);
            }
        }
        if c.optional {
            let j = self.emit(Op::OptCall(0));
            if let Some(ch) = self.chains.last_mut() {
                ch.push(j);
            }
        }
        self.pos = c.span.start;
        let argc = self.args(&c.arguments)?;
        self.pos = c.span.start;
        let at = match argc {
            Some(argc) => self.emit(Op::Call(argc)),
            None => self.emit(Op::CallSpread),
        };
        self.name_callee(at, &c.callee);
        // A callee that isn't a function fails at the callee, which the reference's node has without parentheses.
        let callee = c.callee.without_parentheses().span().start;
        if callee != self.pos {
            self.f().sites.push((at as u32, [callee, callee]));
        }
        Ok(())
    }

    /// Notes how the call or `new` at `at` names its callee in errors, when it can be named.
    fn name_callee(&mut self, at: usize, callee: &Expression) {
        if let Some(name) = callee_name(callee, &|n| self.real_name(n)) {
            self.f().callees.push((at as u32, name.into()));
        }
    }

    fn unary(&mut self, u: &'a UnaryExpression<'a>) -> R<()> {
        match u.operator {
            UnaryOperator::Typeof => {
                if let Expression::Identifier(id) = &u.argument
                    && self.ident_symbol(id).is_none()
                    && id.name.as_str() != "undefined"
                    && id.name.as_str() != "arguments"
                {
                    let g = self.global_slot(id.name.as_str());
                    self.emit(Op::TypeofGlobal(g));
                    return Ok(());
                }
                self.expr(&u.argument)?;
                self.emit(Op::Typeof);
            }
            UnaryOperator::Delete => self.delete(&u.argument)?,
            UnaryOperator::Void => {
                self.expr(&u.argument)?;
                self.emit(Op::Pop);
                self.emit(Op::Undef);
            }
            op => {
                if let (UnaryOperator::UnaryNegation, Expression::NumericLiteral(n)) =
                    (op, &u.argument)
                {
                    self.push_num(-n.value);
                    return Ok(());
                }
                self.expr(&u.argument)?;
                self.emit(match op {
                    UnaryOperator::UnaryPlus => Op::ToNumber,
                    UnaryOperator::UnaryNegation => Op::Neg,
                    UnaryOperator::LogicalNot => Op::Not,
                    _ => Op::BitNot,
                });
            }
        }
        Ok(())
    }

    fn assignment(&mut self, a: &'a AssignmentExpression<'a>) -> R<()> {
        let op = a.operator;
        if op == AssignmentOperator::Assign {
            match &a.left {
                AssignmentTarget::AssignmentTargetIdentifier(id) => {
                    self.expr_named(&a.right, Some(id.name.as_str()))?;
                    self.emit(Op::Dup);
                    return self.store_ident(id);
                }
                AssignmentTarget::StaticMemberExpression(m) => {
                    self.expr(&m.object)?;
                    self.expr(&a.right)?;
                    let at = self.atom(m.property.name.as_str());
                    self.emit_member(Op::SetProp(at), &m.object, None);
                    return Ok(());
                }
                AssignmentTarget::ComputedMemberExpression(m) => {
                    self.expr(&m.object)?;
                    self.expr(&m.expression)?;
                    self.emit_member(Op::WriteKey, &m.object, Some(&m.expression));
                    self.expr(&a.right)?;
                    self.emit_member(Op::SetElem, &m.object, Some(&m.expression));
                    return Ok(());
                }
                AssignmentTarget::ArrayAssignmentTarget(_)
                | AssignmentTarget::ObjectAssignmentTarget(_) => {
                    self.expr(&a.right)?;
                    self.emit(Op::Dup);
                    return self.assign_target(&a.left);
                }
                other => return Err(unsupported("This assignment target", other.span())),
            }
        }
        let logical = match op {
            AssignmentOperator::LogicalAnd => Some(Op::JumpIfFalseKeep(0)),
            AssignmentOperator::LogicalOr => Some(Op::JumpIfTrueKeep(0)),
            AssignmentOperator::LogicalNullish => Some(Op::JumpIfNotNullishKeep(0)),
            _ => None,
        };
        match &a.left {
            AssignmentTarget::AssignmentTargetIdentifier(id) => {
                if let Some(jop) = logical {
                    self.load_ident(id)?;
                    let j = self.emit(jop);
                    self.expr_named(&a.right, Some(id.name.as_str()))?;
                    self.emit(Op::Dup);
                    self.store_ident(id)?;
                    self.patch(j);
                    return Ok(());
                }
                self.load_ident(id)?;
                self.expr(&a.right)?;
                self.emit(compound_op(op));
                self.emit(Op::Dup);
                self.store_ident(id)
            }
            AssignmentTarget::StaticMemberExpression(m) => {
                let at = self.atom(m.property.name.as_str());
                self.expr(&m.object)?;
                self.emit(Op::Dup);
                self.emit_member(Op::GetPropW(at), &m.object, None);
                if let Some(jop) = logical {
                    let j = self.emit(jop);
                    self.expr(&a.right)?;
                    self.emit_member(Op::SetProp(at), &m.object, None);
                    let end = self.emit(Op::Jump(0));
                    self.patch(j);
                    self.emit(Op::Swap);
                    self.emit(Op::Pop);
                    self.patch(end);
                    return Ok(());
                }
                self.expr(&a.right)?;
                self.emit(compound_op(op));
                self.emit_member(Op::SetProp(at), &m.object, None);
                Ok(())
            }
            AssignmentTarget::ComputedMemberExpression(m) => {
                self.expr(&m.object)?;
                self.expr(&m.expression)?;
                self.emit_member(Op::WriteKey, &m.object, Some(&m.expression));
                self.emit(Op::Dup2);
                self.emit_member(Op::GetElem, &m.object, Some(&m.expression));
                if let Some(jop) = logical {
                    let j = self.emit(jop);
                    self.expr(&a.right)?;
                    self.emit_member(Op::SetElem, &m.object, Some(&m.expression));
                    let end = self.emit(Op::Jump(0));
                    self.patch(j);
                    self.emit(Op::Rot3);
                    self.emit(Op::Pop);
                    self.emit(Op::Pop);
                    self.patch(end);
                    return Ok(());
                }
                self.expr(&a.right)?;
                self.emit(compound_op(op));
                self.emit_member(Op::SetElem, &m.object, Some(&m.expression));
                Ok(())
            }
            other => Err(unsupported("This assignment target", other.span())),
        }
    }

    fn update(&mut self, u: &'a UpdateExpression<'a>) -> R<()> {
        let step = if u.operator == UpdateOperator::Increment {
            Op::Inc
        } else {
            Op::Dec
        };
        match &u.argument {
            SimpleAssignmentTarget::AssignmentTargetIdentifier(id) => {
                self.load_ident(id)?;
                if u.prefix {
                    self.emit(step);
                    self.emit(Op::Dup);
                } else {
                    self.emit(Op::ToNumeric);
                    self.emit(Op::Dup);
                    self.emit(step);
                }
                self.store_ident(id)
            }
            SimpleAssignmentTarget::StaticMemberExpression(m) => {
                let at = self.atom(m.property.name.as_str());
                self.expr(&m.object)?;
                self.emit(Op::Dup);
                self.emit_member(Op::GetPropW(at), &m.object, None);
                if u.prefix {
                    self.emit(step);
                    self.emit_member(Op::SetProp(at), &m.object, None);
                } else {
                    self.emit(Op::ToNumeric);
                    self.emit(Op::Dup);
                    self.emit(Op::Rot3);
                    self.emit(step);
                    self.emit_member(Op::SetProp(at), &m.object, None);
                    self.emit(Op::Pop);
                }
                Ok(())
            }
            SimpleAssignmentTarget::ComputedMemberExpression(m) => {
                self.expr(&m.object)?;
                self.expr(&m.expression)?;
                self.emit_member(Op::WriteKey, &m.object, Some(&m.expression));
                self.emit(Op::Dup2);
                self.emit_member(Op::GetElem, &m.object, Some(&m.expression));
                if u.prefix {
                    self.emit(step);
                    self.emit_member(Op::SetElem, &m.object, Some(&m.expression));
                } else {
                    let t = self.new_local();
                    self.emit(Op::ToNumeric);
                    self.emit(Op::Dup);
                    self.emit(Op::SetLocal(t));
                    self.emit(step);
                    self.emit_member(Op::SetElem, &m.object, Some(&m.expression));
                    self.emit(Op::Pop);
                    self.emit(Op::GetLocal(t));
                }
                Ok(())
            }
            other => Err(unsupported("This update target", other.span())),
        }
    }
}

/// The `DelegateCall` flag for an async generator's `yield*`, whose results are awaited.
pub const DELEGATE_ASYNC: u8 = 4;
/// The `DelegateCall` flag for `for await`, which calls `next()` without an argument.
pub const DELEGATE_NO_ARG: u8 = 8;

enum KeyRef {
    Static(String),
    Local(u32),
}

enum FnBody<'a> {
    Block(&'a FunctionBody<'a>),
    Expr(&'a Expression<'a>),
}

struct FnSpec<'a, 'n> {
    name: &'n str,
    params: &'a FormalParameters<'a>,
    body: FnBody<'a>,
    scope: Option<ScopeId>,
    is_async: bool,
    is_generator: bool,
    is_arrow: bool,
    self_sym: Option<SymbolId>,
}

impl<'a> FnState<'a> {
    fn new(is_arrow: bool) -> Self {
        FnState {
            code: Vec::new(),
            pos: Vec::new(),
            nlocals: 0,
            captures: Vec::new(),
            upval_of: FxHashMap::default(),
            args_store: None,
            args_upval: None,
            controls: Vec::new(),
            is_arrow,
            is_async: false,
            is_generator: false,
            needs_extra: false,
            callees: Vec::new(),
            sites: Vec::new(),
            barrier: 0,
        }
    }
}

/// How the reference names a callee, like native engines: identifiers, member chains with plain keys, and calls of
/// those (`search(...).catch`). A chain with any other link has no name.
fn callee_name(e: &Expression, real: &dyn Fn(&str) -> &str) -> Option<String> {
    match e {
        Expression::Identifier(id) => Some(real(id.name.as_str()).to_owned()),
        Expression::CallExpression(c) => Some(format!("{}(...)", callee_name(&c.callee, real)?)),
        Expression::StaticMemberExpression(m) => Some(format!(
            "{}.{}",
            callee_name(&m.object, real)?,
            m.property.name
        )),
        Expression::ComputedMemberExpression(m) => match &m.expression {
            Expression::StringLiteral(s) => Some(format!(
                "{}.{}",
                callee_name(&m.object, real)?,
                js_str(&s.value)
            )),
            _ => None,
        },
        _ => None,
    }
}

fn m_as_expr<'x, 'a>(m: &'x MemberExpression<'a>) -> &'x Expression<'a> {
    m.as_expression()
}

fn js_str(s: &oxc_str::JSStr) -> String {
    match s.as_str() {
        Some(t) => crate::strings::external_text(t.to_owned()),
        None => crate::strings::from_units(&s.encode_utf16().collect::<Vec<u16>>()),
    }
}

fn static_key(key: &PropertyKey, computed: bool) -> Option<String> {
    match key {
        PropertyKey::StaticIdentifier(id) if !computed => Some(id.name.as_str().to_owned()),
        PropertyKey::StringLiteral(s) => Some(js_str(&s.value)),
        PropertyKey::NumericLiteral(n) => Some(num_to_string(n.value)),
        _ => None,
    }
}

fn pattern_name<'x>(p: &'x BindingPattern) -> Option<&'x str> {
    match p {
        BindingPattern::BindingIdentifier(id) => Some(id.name.as_str()),
        _ => None,
    }
}

fn is_builtin_global(name: &str) -> bool {
    crate::builtins::GLOBAL_NAMES.contains(&name)
}

fn binary_op(op: BinaryOperator) -> Op {
    match op {
        BinaryOperator::Equality => Op::Eq,
        BinaryOperator::Inequality => Op::Ne,
        BinaryOperator::StrictEquality => Op::StrictEq,
        BinaryOperator::StrictInequality => Op::StrictNe,
        BinaryOperator::LessThan => Op::Lt,
        BinaryOperator::LessEqualThan => Op::Le,
        BinaryOperator::GreaterThan => Op::Gt,
        BinaryOperator::GreaterEqualThan => Op::Ge,
        BinaryOperator::Addition => Op::Add,
        BinaryOperator::Subtraction => Op::Sub,
        BinaryOperator::Multiplication => Op::Mul,
        BinaryOperator::Division => Op::Div,
        BinaryOperator::Remainder => Op::Mod,
        BinaryOperator::Exponential => Op::Pow,
        BinaryOperator::ShiftLeft => Op::Shl,
        BinaryOperator::ShiftRight => Op::Shr,
        BinaryOperator::ShiftRightZeroFill => Op::UShr,
        BinaryOperator::BitwiseOR => Op::BitOr,
        BinaryOperator::BitwiseXOR => Op::BitXor,
        BinaryOperator::BitwiseAnd => Op::BitAnd,
        BinaryOperator::In => Op::In,
        BinaryOperator::Instanceof => Op::InstanceOf,
    }
}

fn compound_op(op: AssignmentOperator) -> Op {
    match op {
        AssignmentOperator::Addition => Op::Add,
        AssignmentOperator::Subtraction => Op::Sub,
        AssignmentOperator::Multiplication => Op::Mul,
        AssignmentOperator::Division => Op::Div,
        AssignmentOperator::Remainder => Op::Mod,
        AssignmentOperator::Exponential => Op::Pow,
        AssignmentOperator::ShiftLeft => Op::Shl,
        AssignmentOperator::ShiftRight => Op::Shr,
        AssignmentOperator::ShiftRightZeroFill => Op::UShr,
        AssignmentOperator::BitwiseOR => Op::BitOr,
        AssignmentOperator::BitwiseXOR => Op::BitXor,
        AssignmentOperator::BitwiseAnd => Op::BitAnd,
        _ => Op::Nop,
    }
}
