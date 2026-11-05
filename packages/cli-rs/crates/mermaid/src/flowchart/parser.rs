//! Flowchart parser (`flowchart/parser.ts`).

use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use std::sync::LazyLock;

use indexmap::IndexMap;
use regex::Regex;

use super::types::{Diagram, Edge, EdgeStyle, FlowDirection, Node, Shape, Subgraph};
use crate::core::text::{first_meaningful_line, js_trim, meaningful_lines, strip_quotes};
use crate::{Kind, SyntaxError};

const MAX_LINE_LENGTH: usize = 10_000;
const ID: &str = "[A-Za-z_][A-Za-z0-9_.-]*";

fn pattern(source: &str) -> Regex {
    Regex::new(source).expect("flowchart pattern")
}

static HEADER: LazyLock<Regex> = LazyLock::new(|| pattern(r"(?i)^(flowchart|graph)(?:\s+(TB|TD|BT|LR|RL))?$"));
static SUBGRAPH: LazyLock<Regex> = LazyLock::new(|| pattern(r"(?i)^subgraph\s+(.+)$"));
static SUBGRAPH_WITH_LABEL: LazyLock<Regex> = LazyLock::new(|| pattern(&format!(r"^({ID})\s*\[(.+)\]$")));
static SUBGRAPH_DIRECTION: LazyLock<Regex> = LazyLock::new(|| pattern(r"(?i)^direction\s+(TB|TD|BT|LR|RL)$"));
static IGNORED: LazyLock<Regex> = LazyLock::new(|| pattern(r"(?i)^(?:classDef|class|style|linkStyle)\b"));
static DATABASE: LazyLock<Regex> = LazyLock::new(|| pattern(&format!(r"^({ID})\[\((.+)\)\]$")));
static SUBROUTINE: LazyLock<Regex> = LazyLock::new(|| pattern(&format!(r"^({ID})\[\[(.+)\]\]$")));
static ROUNDED_BRACKET: LazyLock<Regex> = LazyLock::new(|| pattern(&format!(r"^({ID})\(\[(.+)\]\)$")));
static ROUNDED: LazyLock<Regex> = LazyLock::new(|| pattern(&format!(r"^({ID})\((.+)\)$")));
static DECISION: LazyLock<Regex> = LazyLock::new(|| pattern(&format!(r"^({ID})\{{(.+)\}}$")));
static BOX: LazyLock<Regex> = LazyLock::new(|| pattern(&format!(r"^({ID})\[(.+)\]$")));
static ID_ONLY: LazyLock<Regex> = LazyLock::new(|| pattern(&format!("^{ID}$")));
static EXPLICIT_SHAPE: LazyLock<Regex> = LazyLock::new(|| pattern(&format!(r"^{ID}(?:\[|\(|\{{)")));
static CIRCLE: LazyLock<Regex> = LazyLock::new(|| pattern(&format!(r"^{ID}\(\(.+\)\)$")));
static CLASS_SUFFIX: LazyLock<Regex> = LazyLock::new(|| pattern(r"\s*:::.*$"));
static END: LazyLock<Regex> = LazyLock::new(|| pattern(r"(?i)^end$"));
// TS `EDGE_OPERATOR_RE`; the lookahead needs fancy-regex.
static EDGE_OPERATOR: LazyLock<fancy_regex::Regex> = LazyLock::new(|| {
    fancy_regex::Regex::new(
        r"(-\.(?!->)(.+?)\.(?:->|-))|(--|==|-\.)\s+(.+?)\s+(-->|==>|\.->|-\.->|\.-)|(<-->|-->|==>|-\.->|---|~~~)\s*(?:\|([^|]*)\|\s*)?",
    )
    .expect("edge operator pattern")
});

pub fn is_flowchart(content: &str) -> bool {
    HEADER.is_match(first_meaningful_line(content).unwrap_or(""))
}

fn syntax(line: usize, source: &str, reason: &str) -> SyntaxError {
    SyntaxError::new(Kind::Flowchart, line, source, reason)
}

fn strip_semicolon(value: &str) -> &str {
    value.strip_suffix(';').unwrap_or(value)
}

fn parse_subgraph_token(token: &str, index: usize) -> (String, String) {
    let trimmed = CLASS_SUFFIX.replace(js_trim(token), "");
    let trimmed = strip_semicolon(&trimmed);
    if let Some(captures) = SUBGRAPH_WITH_LABEL.captures(trimmed) {
        return (captures[1].to_string(), strip_quotes(&captures[2]));
    }
    let label = strip_quotes(trimmed);
    let stripped = strip_quotes(trimmed);
    let id = if ID_ONLY.is_match(&stripped) { stripped } else { format!("subgraph_{}", index + 1) };
    (id, label)
}

fn parse_node_token(token: &str) -> Node {
    let trimmed = strip_semicolon(js_trim(token));
    let shapes: [(&Regex, Shape); 6] = [
        (&DATABASE, Shape::Database),
        (&SUBROUTINE, Shape::Subroutine),
        (&ROUNDED_BRACKET, Shape::Rounded),
        (&ROUNDED, Shape::Rounded),
        (&DECISION, Shape::Decision),
        (&BOX, Shape::Box),
    ];
    for (regex, shape) in shapes {
        if let Some(captures) = regex.captures(trimmed) {
            return Node { id: captures[1].to_string(), label: strip_quotes(&captures[2]), shape };
        }
    }
    Node { id: trimmed.to_string(), label: trimmed.to_string(), shape: Shape::Box }
}

fn strip_node_token(token: &str) -> String {
    let stripped = CLASS_SUFFIX.replace(token, "");
    js_trim(strip_semicolon(&stripped)).to_string()
}

fn is_supported_node_token(token: &str) -> bool {
    let trimmed = strip_node_token(token);
    if CIRCLE.is_match(&trimmed) {
        return false;
    }
    [&*ID_ONLY, &DATABASE, &SUBROUTINE, &ROUNDED_BRACKET, &ROUNDED, &DECISION, &BOX]
        .iter()
        .any(|regex| regex.is_match(&trimmed))
}

fn has_explicit_shape(token: &str) -> bool {
    EXPLICIT_SHAPE.is_match(js_trim(token))
}

fn close_of(open: char) -> Option<char> {
    match open {
        '[' => Some(']'),
        '(' => Some(')'),
        '{' => Some('}'),
        _ => None,
    }
}

/// Bracket and quote tracking shared by the line scanners below.
struct Scanner {
    stack: Vec<char>,
    quoted: bool,
}

enum Scan {
    /// Inside quotes (true when this character closes them).
    Quoted,
    Open,
    Close,
    Other,
}

impl Scanner {
    fn new() -> Self {
        Self { stack: Vec::new(), quoted: false }
    }

    fn step(&mut self, ch: char, previous: Option<char>) -> Scan {
        if self.quoted {
            if ch == '"' && previous != Some('\\') {
                self.quoted = false;
            }
            return Scan::Quoted;
        }
        if ch == '"' {
            self.quoted = true;
            return Scan::Other;
        }
        if close_of(ch).is_some() {
            self.stack.push(ch);
            return Scan::Open;
        }
        if let Some(&open) = self.stack.last()
            && close_of(open) == Some(ch)
        {
            self.stack.pop();
            return Scan::Close;
        }
        Scan::Other
    }
}

/// Splits an `&`-joined node group, leaving `&` inside labels (brackets or quotes) untouched.
fn split_node_group(token: &str) -> Vec<&str> {
    let mut groups = Vec::new();
    let mut scanner = Scanner::new();
    let mut start = 0;
    let mut previous = None;
    for (index, ch) in token.char_indices() {
        let scan = scanner.step(ch, previous);
        previous = Some(ch);
        if matches!(scan, Scan::Other) && ch == '&' && scanner.stack.is_empty() && !scanner.quoted {
            groups.push(&token[start..index]);
            start = index + 1;
        }
    }
    groups.push(&token[start..]);
    groups
}

fn mask_node_label_operators(line: &str) -> String {
    let mut scanner = Scanner::new();
    let mut previous = None;
    let operator = |ch: char| matches!(ch, '<' | '>' | '=' | '.' | '-');
    line.chars()
        .map(|ch| {
            let was_quoted = scanner.quoted;
            let scan = scanner.step(ch, previous);
            previous = Some(ch);
            let masked = match scan {
                Scan::Quoted => was_quoted && scanner.quoted && operator(ch),
                Scan::Other => !scanner.stack.is_empty() && operator(ch) && ch != '"',
                Scan::Open | Scan::Close => false,
            };
            if masked { ' ' } else { ch }
        })
        .collect()
}

fn has_internal_statement_separator(line: &str) -> bool {
    let mut scanner = Scanner::new();
    let mut edge_label = false;
    let final_index = line.trim_end().char_indices().last().map_or(-1, |(index, _)| index as i64);
    let mut previous = None;
    for (index, ch) in line.char_indices() {
        let scan = scanner.step(ch, previous);
        previous = Some(ch);
        if !matches!(scan, Scan::Other) || ch == '"' {
            continue;
        }
        if scanner.stack.is_empty() && ch == '|' {
            edge_label = !edge_label;
            continue;
        }
        if ch == ';' && (index as i64) < final_index && scanner.stack.is_empty() && !edge_label {
            return true;
        }
    }
    false
}

struct Operator {
    index: usize,
    end: usize,
    label: String,
    style: Option<EdgeStyle>,
    arrowhead: bool,
    source_arrowhead: bool,
    order_only: bool,
}

fn edge_style(arrows: &[&str]) -> Option<EdgeStyle> {
    if arrows.iter().any(|arrow| arrow.contains("==")) {
        return Some(EdgeStyle::Thick);
    }
    if arrows.iter().any(|arrow| arrow.contains('.')) {
        return Some(EdgeStyle::Dashed);
    }
    None
}

fn parse_edge_operators(line: &str) -> Vec<Operator> {
    let masked = mask_node_label_operators(line);
    EDGE_OPERATOR
        .captures_iter(&masked)
        .filter_map(Result::ok)
        .map(|captures| {
            let whole = captures.get(0).expect("match");
            let inline = captures.get(1).map(|m| m.as_str());
            let group = |index: usize| captures.get(index).map(|m| m.as_str());
            let start_arrow = inline.or(group(3)).or(group(6)).unwrap_or("");
            let end_arrow = inline.or(group(5)).or(group(6)).unwrap_or("");
            let label_range = [2, 4, 7]
                .into_iter()
                .find_map(|index| captures.get(index).filter(|m| !m.as_str().is_empty()).map(|m| m.range()));
            Operator {
                index: whole.start(),
                end: whole.end(),
                label: strip_quotes(label_range.map_or("", |range| &line[range])),
                style: edge_style(&[start_arrow, end_arrow]),
                arrowhead: end_arrow == "~~~" || end_arrow.ends_with('>'),
                source_arrowhead: start_arrow.starts_with('<'),
                order_only: end_arrow == "~~~",
            }
        })
        .collect()
}

pub fn parse(content: &str) -> Result<Diagram, SyntaxError> {
    let mut parser = Parser::default();
    let mut direction = FlowDirection::TD;

    for source in meaningful_lines(content) {
        let line = source.text;
        if line.len() > MAX_LINE_LENGTH {
            return Err(syntax(source.number, line, "Flowchart statement is too long"));
        }
        if has_internal_statement_separator(line) {
            return Err(SyntaxError::unsupported(Kind::Flowchart, source.number, line));
        }
        if let Some(header) = HEADER.captures(line) {
            direction = header.get(2).and_then(|m| FlowDirection::parse(m.as_str())).unwrap_or(FlowDirection::TD);
            continue;
        }
        // Mermaid CSS styling does not apply to terminal theme rendering.
        if IGNORED.is_match(line) {
            continue;
        }
        if let Some(captures) = SUBGRAPH.captures(line) {
            let (id, label) = parse_subgraph_token(&captures[1], parser.subgraphs.len());
            let parent_id = parser.stack.last().map(|open| parser.subgraphs[open.0].id.clone());
            parser.subgraphs.push(Subgraph { id, label, node_ids: Vec::new(), parent_id, direction: None });
            parser.stack.push((parser.subgraphs.len() - 1, source.number, line.to_string()));
            continue;
        }
        if END.is_match(line) {
            if parser.stack.pop().is_none() {
                return Err(syntax(source.number, line, "Unexpected \"end\" without an open subgraph"));
            }
            continue;
        }
        let current = parser.stack.last().map(|open| open.0);
        if let Some(captures) = SUBGRAPH_DIRECTION.captures(line) {
            let Some(current) = current else {
                return Err(syntax(source.number, line, "A \"direction\" statement requires an open subgraph"));
            };
            parser.subgraphs[current].direction = FlowDirection::parse(&captures[1]);
            continue;
        }

        let operators = parse_edge_operators(line);
        if !operators.is_empty() {
            // Each chain position may be an `&` group (`A & B --> C`), so endpoints are lists of node tokens.
            let mut slices = vec![&line[..operators[0].index]];
            for (index, operator) in operators.iter().enumerate() {
                let end = operators.get(index + 1).map_or(line.len(), |next| next.index);
                slices.push(&line[operator.end.min(end)..end]);
            }
            let groups: Vec<Vec<String>> = slices
                .iter()
                .map(|group| split_node_group(group).into_iter().map(strip_node_token).collect())
                .collect();
            if groups.iter().all(|group| group.iter().all(|token| !token.is_empty())) {
                if groups.iter().any(|group| group.iter().any(|token| !is_supported_node_token(token))) {
                    return Err(SyntaxError::unsupported(Kind::Flowchart, source.number, line));
                }
                let chain: Vec<Vec<String>> =
                    groups.iter().map(|group| group.iter().map(|token| parser.track(token)).collect()).collect();
                for id in chain.iter().flatten() {
                    if parser.nodes.contains_key(id) {
                        parser.add_to_subgraph(current, id);
                    }
                }
                for (index, operator) in operators.iter().enumerate() {
                    for from in &chain[index] {
                        for to in &chain[index + 1] {
                            let id = parser.edges.len();
                            parser.edges.push(Edge {
                                id,
                                from: from.clone(),
                                to: to.clone(),
                                label: operator.label.clone(),
                                style: operator.style,
                                arrowhead: operator.arrowhead,
                                source_arrowhead: operator.source_arrowhead,
                                order_only: operator.order_only,
                            });
                        }
                    }
                }
                continue;
            }
        }

        let group = split_node_group(line);
        if group.iter().all(|token| is_supported_node_token(token)) {
            for token in group {
                let id = parser.track(&strip_node_token(token));
                parser.add_to_subgraph(current, &id);
            }
            continue;
        }
        return Err(SyntaxError::unsupported(Kind::Flowchart, source.number, line));
    }

    if let Some((_, number, line)) = parser.stack.last() {
        return Err(syntax(*number, line, "Unclosed subgraph; expected \"end\""));
    }
    Ok(parser.finish(direction))
}

#[derive(Default)]
struct Parser {
    nodes: IndexMap<String, Node>,
    edges: Vec<Edge>,
    subgraphs: Vec<Subgraph>,
    /// Open subgraphs: index, line number, source line.
    stack: Vec<(usize, usize, String)>,
    explicit_shape_ids: HashSet<String>,
    referenced_in_open: HashMap<String, HashSet<String>>,
}

impl Parser {
    fn track(&mut self, token: &str) -> String {
        let node = parse_node_token(token);
        let explicit = has_explicit_shape(token);
        let id = node.id.clone();
        match self.nodes.get_mut(&id) {
            None => {
                self.nodes.insert(id.clone(), node);
            }
            Some(existing) if explicit => {
                existing.label = node.label;
                existing.shape = node.shape;
            }
            Some(_) => {}
        }
        if explicit {
            self.explicit_shape_ids.insert(id.clone());
        }
        for open in &self.stack {
            self.referenced_in_open.entry(id.clone()).or_default().insert(self.subgraphs[open.0].id.clone());
        }
        id
    }

    fn add_to_subgraph(&mut self, subgraph: Option<usize>, id: &str) {
        if let Some(subgraph) = subgraph {
            let node_ids = &mut self.subgraphs[subgraph].node_ids;
            if !node_ids.iter().any(|existing| existing == id) {
                node_ids.push(id.to_string());
            }
        }
    }

    fn finish(mut self, direction: FlowDirection) -> Diagram {
        self.resolve_subgraph_endpoints();
        Diagram {
            direction,
            nodes: self.nodes.into_values().collect(),
            edges: self.edges.into_iter().map(Rc::new).collect(),
            subgraphs: self.subgraphs,
        }
    }

    /// A node whose ID names a subgraph is that subgraph, unless it has a shape or its own edges.
    fn resolve_subgraph_endpoints(&mut self) {
        let mut resolved: HashSet<String> = HashSet::new();
        for index in (0..self.subgraphs.len()).rev() {
            self.subgraphs[index].node_ids.retain(|id| !resolved.contains(id));
            let subgraph = &self.subgraphs[index];
            let descendants = descendants_of(&self.subgraphs, &subgraph.id);
            let mut members: HashSet<&str> = HashSet::new();
            for candidate in &self.subgraphs {
                if candidate.id != subgraph.id && !descendants.contains(&candidate.id) {
                    continue;
                }
                for id in &candidate.node_ids {
                    if *id == subgraph.id || descendants.contains(id) || resolved.contains(id) {
                        continue;
                    }
                    members.insert(id);
                }
            }
            let links_self_or_descendant = self.edges.iter().any(|edge| {
                (edge.from == subgraph.id
                    && (edge.to == subgraph.id || members.contains(edge.to.as_str()) || descendants.contains(&edge.to)))
                    || (edge.to == subgraph.id
                        && (members.contains(edge.from.as_str()) || descendants.contains(&edge.from)))
            });
            let self_referenced =
                self.referenced_in_open.get(&subgraph.id).is_some_and(|open| open.contains(&subgraph.id));
            if self.explicit_shape_ids.contains(&subgraph.id)
                || self_referenced
                || members.is_empty()
                || links_self_or_descendant
            {
                continue;
            }
            let id = subgraph.id.clone();
            self.nodes.shift_remove(&id);
            resolved.insert(id);
        }
        for subgraph in &mut self.subgraphs {
            subgraph.node_ids.retain(|id| !resolved.contains(id));
        }
    }
}

fn descendants_of(subgraphs: &[Subgraph], id: &str) -> HashSet<String> {
    let mut ids = HashSet::new();
    for child in subgraphs {
        if child.parent_id.as_deref() != Some(id) {
            continue;
        }
        ids.insert(child.id.clone());
        ids.extend(descendants_of(subgraphs, &child.id));
    }
    ids
}
