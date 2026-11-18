//! Inline math (`$…$`, `\(…\)`) on one row: [`linear`] rewrites what display math stacks into a one-line form, as
//! text would write it, and the layout draws the rest with every Unicode super- and subscript it has.
//!
//! - `\frac{a}{b}` is `a/b`, with parentheses around a numerator or denominator of several atoms: `(x + 1)/2`.
//! - `\sqrt{x}` is `√x`, `\sqrt[3]{x}` is `∛x`, and another index is a superscript before the radical.
//! - A script Unicode has no characters for is `^` or `_` and the script: `e^(iπ)`.
//! - Operator limits, `\overset` and `\underset` are scripts; `\overbrace` and `\underbrace` drop the brace.
//! - Accents are combining marks on each grapheme: `\hat{x}` is `x̂`.
//! - A matrix is its rows separated by `;` and its cells by `,`, in its delimiters; aligned rows by `;` alone.

use unicode_segmentation::UnicodeSegmentation;

use crate::layout::{self, Layout, Options};
use crate::parse::{self, Accent, Environment, Limits, Node, ParseError, Role};

/// Lays out `source` as inline math on one row.
pub fn render(source: &str) -> Result<Layout, ParseError> {
    crate::check_source(source)?;
    let node = linear(parse::parse(source)?);
    let options = Options { display: false, inline: true, ..Options::default() };
    let layout = layout::layout(&node, &options)
        .ok_or_else(|| fail(format!("LaTeX layout exceeds the {}-cell limit", layout::MAX_CELLS)))?;
    if layout.height != 1 || layout.width == 0 {
        return Err(fail("Inline math needs one non-empty row".into()));
    }
    Ok(layout)
}

fn fail(message: String) -> ParseError {
    ParseError { message, position: 0 }
}

/// `node` with nothing that takes more than one row.
pub fn linear(node: Node) -> Node {
    match node {
        Node::Row(body) => Node::Row(body.into_iter().map(linear).collect()),
        Node::Fraction { numerator, denominator, bar: true, .. } => {
            Node::Row(vec![group(linear(*numerator)), symbol("/"), group(linear(*denominator))])
        }
        Node::Fraction { numerator, denominator, bar: false, .. } => {
            Node::Row(vec![linear(*numerator), Node::Space(1), linear(*denominator)])
        }
        Node::Root { body, index } => Node::Row(vec![radical(index.map(|index| linear(*index))), group(linear(*body))]),
        Node::Scripts { base, superscript, subscript } => {
            scripts(linear(*base), superscript.map(|node| linear(*node)), subscript.map(|node| linear(*node)))
        }
        Node::OverUnder { base, over, under } => {
            scripts(linear(*base), over.map(|node| linear(*node)), under.map(|node| linear(*node)))
        }
        Node::Delimited { left, body, right } => Node::Delimited { left, body: Box::new(linear(*body)), right },
        Node::Matrix { rows, environment, .. } => matrix(rows, environment),
        Node::Brace { body, .. } => linear(*body),
        Node::Accent { accent, body } => marked(&body, mark(accent, &body))
            .unwrap_or_else(|| Node::Row(vec![group(linear(*body)), symbol(spacing(accent))])),
        Node::Variant { variant, body } => Node::Variant { variant, body: Box::new(linear(*body)) },
        Node::Color { color, body } => Node::Color { color, body: Box::new(linear(*body)) },
        // Limits above and below would take rows: they are scripts.
        Node::Operator { value, .. } => Node::Operator { value, limits: Limits::Never },
        node @ (Node::Symbol { .. } | Node::Text(_) | Node::Space(_)) => node,
    }
}

/// Scripts the layout draws compact, or `^` and `_` with the script beside the base.
fn scripts(base: Node, superscript: Option<Node>, subscript: Option<Node>) -> Node {
    let compact = |node: &Option<Node>, superscript: bool| {
        node.as_ref().is_none_or(|node| layout::script_text(node, superscript, true).is_some())
    };
    if compact(&superscript, true) && compact(&subscript, false) {
        return Node::Scripts {
            base: Box::new(base),
            superscript: superscript.map(Box::new),
            subscript: subscript.map(Box::new),
        };
    }
    let mut row = vec![base];
    for (mark, script) in [("_", subscript), ("^", superscript)] {
        if let Some(script) = script {
            // Punctuation, so no space comes between an operator and its scripts.
            row.extend([Node::Symbol { value: mark.into(), role: Some(Role::Punctuation) }, group(script)]);
        }
    }
    Node::Row(row)
}

/// The radical with its index: `∛` and `∜`, a superscript index, or the index in parentheses before `√`.
fn radical(index: Option<Node>) -> Node {
    let Some(index) = index else { return symbol("√") };
    match layout::script_text(&index, true, true).as_deref() {
        Some("³") => symbol("∛"),
        Some("⁴") => symbol("∜"),
        Some(index) => symbol(&format!("{index}√")),
        None => Node::Row(vec![group(index), symbol("√")]),
    }
}

fn matrix(rows: Vec<Vec<Node>>, environment: Environment) -> Node {
    let aligned =
        matches!(environment, Environment::Aligned | Environment::Align | Environment::Gathered | Environment::Gather);
    let mut body = Vec::new();
    for (index, row) in rows.into_iter().enumerate() {
        if index > 0 {
            body.extend([Node::Symbol { value: ";".into(), role: Some(Role::Punctuation) }, Node::Space(1)]);
        }
        for (column, cell) in row.into_iter().enumerate() {
            if column > 0 && !aligned {
                body.extend([Node::Symbol { value: ",".into(), role: Some(Role::Punctuation) }, Node::Space(1)]);
            }
            // Aligned cells are one row split at `&`: their atoms space across the split.
            match linear(cell) {
                Node::Row(atoms) if aligned => body.extend(atoms),
                cell => body.push(cell),
            }
        }
    }
    let delimiters = match environment {
        Environment::Pmatrix => Some(("(", ")")),
        Environment::Bmatrix => Some(("[", "]")),
        Environment::BigBmatrix => Some(("{", "}")),
        Environment::Vmatrix => Some(("│", "│")),
        Environment::BigVmatrix => Some(("║", "║")),
        Environment::Cases => Some(("{", "")),
        _ => None,
    };
    let body = Node::Row(body);
    match delimiters {
        Some((left, right)) => Node::Delimited { left: left.into(), body: Box::new(body), right: right.into() },
        None => body,
    }
}

/// `node` in parentheses when it is several atoms, so `/`, `^` and `√` take all of it.
fn group(node: Node) -> Node {
    let several = match &node {
        Node::Row(body) => body.iter().filter(|node| !matches!(node, Node::Space(_))).count() > 1,
        Node::Variant { body, .. } | Node::Color { body, .. } => matches!(**body, Node::Row(_)),
        _ => false,
    };
    if several {
        return Node::Delimited { left: "(".into(), body: Box::new(node), right: ")".into() };
    }
    node
}

fn symbol(value: &str) -> Node {
    Node::Symbol { value: value.into(), role: Some(Role::Ordinary) }
}

/// `node` with `mark` on each grapheme of its text, or `None` when it is more than styled text.
fn marked(node: &Node, mark: char) -> Option<Node> {
    let marks = |text: &str| text.graphemes(true).map(|grapheme| format!("{grapheme}{mark}")).collect::<String>();
    Some(match node {
        Node::Symbol { value, role } => Node::Symbol { value: marks(value), role: *role },
        Node::Text(value) => Node::Text(marks(value)),
        Node::Row(body) => Node::Row(body.iter().map(|node| marked(node, mark)).collect::<Option<_>>()?),
        Node::Variant { variant, body } => Node::Variant { variant: *variant, body: Box::new(marked(body, mark)?) },
        Node::Color { color, body } => Node::Color { color: color.clone(), body: Box::new(marked(body, mark)?) },
        _ => return None,
    })
}

/// The combining mark of `accent`: a macron over one grapheme, an overline over several.
fn mark(accent: Accent, body: &Node) -> char {
    match accent {
        Accent::Hat | Accent::Widehat => '\u{302}',
        Accent::Bar if matches!(body, Node::Symbol { value, .. } if value.graphemes(true).count() == 1) => '\u{304}',
        Accent::Bar | Accent::Overline => '\u{305}',
        Accent::Underline => '\u{332}',
        Accent::Vec => '\u{20d7}',
        Accent::Tilde => '\u{303}',
        Accent::Dot => '\u{307}',
        Accent::Ddot => '\u{308}',
    }
}

/// The spacing form of `accent`, after a body the marks cannot go on.
fn spacing(accent: Accent) -> &'static str {
    match accent {
        Accent::Hat | Accent::Widehat => "^",
        Accent::Bar | Accent::Overline => "‾",
        Accent::Underline => "_",
        Accent::Vec => "→",
        Accent::Tilde => "~",
        Accent::Dot => "˙",
        Accent::Ddot => "¨",
    }
}
