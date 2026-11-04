//! Git graphs (`packages/merman/src/gitgraph`): parser and the vertical terminal drawing.

use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

use indexmap::IndexMap;
use regex::Regex;

use crate::core::canvas::{Canvas, SizeError};
use crate::core::text::{first_meaningful_line, js_trim, meaningful_lines, strip_quotes, width};
use crate::{Kind, SyntaxError};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Style {
    /// `branch0` to `branch7`.
    Branch(u8),
    Commit,
    Merge,
    Highlight,
    Reverse,
    Label,
}

pub type Grid = Canvas<Style>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CommitType {
    Normal,
    Reverse,
    Highlight,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Branch {
    pub name: String,
    pub order: Option<i64>,
    pub head: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Commit {
    pub id: String,
    pub message: Option<String>,
    pub tags: Vec<String>,
    pub kind: CommitType,
    pub branch: String,
    pub parents: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Diagram {
    pub branches: Vec<Branch>,
    pub commits: Vec<Commit>,
}

static HEADER: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^gitGraph(?:\s+(LR|TB|BT))?\s*:?$").expect("header"));
static ACCESSIBILITY: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^acc(?:Title|Descr)(?::|\s|$)").expect("accessibility"));
static ACC_BLOCK: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)^accDescr\s*\{$").expect("accDescr"));
static TITLE: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^title(?:\s|$)").expect("title"));

pub fn is_gitgraph(content: &str) -> bool {
    HEADER.is_match(first_meaningful_line(content).unwrap_or(""))
}

fn error(line: usize, source: &str, reason: &str) -> SyntaxError {
    SyntaxError::new(Kind::GitGraph, line, source, reason)
}

type Attributes = IndexMap<String, Vec<String>>;

pub fn parse(content: &str) -> Result<Diagram, SyntaxError> {
    let first = first_meaningful_line(content).unwrap_or("");
    if !HEADER.is_match(first) {
        return Err(error(1, first, "GitGraph header is required"));
    }
    let mut branches = vec![Branch {
        name: "main".to_string(),
        order: Some(0),
        head: None,
    }];
    let mut commits: Vec<Commit> = Vec::new();
    let mut heads: IndexMap<String, Option<String>> = IndexMap::from([("main".to_string(), None)]);
    let mut ids: HashSet<String> = HashSet::new();
    let mut current = "main".to_string();
    let mut generated = 1;
    let mut in_description = false;
    let mut header = false;
    for source in meaningful_lines(content) {
        let line = strip_comment(source.text);
        let n = source.number;
        if in_description {
            if line == "}" {
                in_description = false;
            }
            continue;
        }
        if ACC_BLOCK.is_match(line) {
            in_description = true;
            continue;
        }
        if line.is_empty() || ACCESSIBILITY.is_match(line) || TITLE.is_match(line) {
            continue;
        }
        if HEADER.is_match(line) {
            if header {
                return Err(error(n, line, "GitGraph header can only appear once"));
            }
            header = true;
            continue;
        }
        let mut rest = tokenize(line);
        let command = if rest.is_empty() {
            String::new()
        } else {
            rest.remove(0)
        };
        let operation = command.to_lowercase();
        let single = |attributes: &Attributes, key: &str| -> Result<Option<String>, SyntaxError> {
            match attributes.get(key) {
                Some(values) if values.len() > 1 => Err(error(
                    n,
                    line,
                    &format!("GitGraph attribute \"{key}\" cannot repeat"),
                )),
                Some(values) => Ok(values.first().cloned()),
                None => Ok(None),
            }
        };
        match operation.as_str() {
            "commit" => {
                let quoted = rest.first().is_some_and(|token| {
                    let mut chars = token.chars();
                    let first = chars.next();
                    let last = chars.next_back();
                    matches!(first, Some('"' | '\'')) && first == last
                });
                let shorthand = quoted.then(|| strip_quotes(&rest.remove(0)));
                let attributes = parse_attributes(&rest, n, line, &["id", "msg", "tag", "type"])?;
                let id = match single(&attributes, "id")? {
                    Some(id) => id,
                    None => {
                        generated += 1;
                        format!("commit-{}", generated - 1)
                    }
                };
                if id.is_empty() {
                    return Err(error(n, line, "GitGraph commit id cannot be empty"));
                }
                if ids.contains(&id) {
                    return Err(error(n, line, &format!("Duplicate commit id \"{id}\"")));
                }
                let kind = commit_type(single(&attributes, "type")?, n, line)?;
                let parent = heads.get(&current).cloned().flatten();
                let message = single(&attributes, "msg")?.or(shorthand);
                commits.push(Commit {
                    id: id.clone(),
                    message,
                    tags: attributes.get("tag").cloned().unwrap_or_default(),
                    kind,
                    branch: current.clone(),
                    parents: parent.into_iter().collect(),
                });
                ids.insert(id.clone());
                heads.insert(current.clone(), Some(id));
            }
            "branch" => {
                let Some(first) = rest.first() else {
                    return Err(error(n, line, "GitGraph branch name cannot be empty"));
                };
                let name = strip_quotes(first);
                if name.is_empty() {
                    return Err(error(n, line, "GitGraph branch name cannot be empty"));
                }
                if heads.contains_key(&name) {
                    return Err(error(n, line, &format!("Duplicate branch \"{name}\"")));
                }
                let attributes = parse_attributes(&rest[1..], n, line, &["order"])?;
                let order = match single(&attributes, "order")? {
                    None => None,
                    Some(value) => {
                        let trimmed = js_trim(&value);
                        let number = if trimmed.is_empty() {
                            Some(0.0)
                        } else {
                            trimmed.parse::<f64>().ok()
                        };
                        match number {
                            Some(number)
                                if number.fract() == 0.0 && number >= 0.0 && number.is_finite() =>
                            {
                                Some(number as i64)
                            }
                            _ => {
                                return Err(error(
                                    n,
                                    line,
                                    "GitGraph branch order must be a non-negative integer",
                                ));
                            }
                        }
                    }
                };
                branches.push(Branch {
                    name: name.clone(),
                    order,
                    head: None,
                });
                let head = heads.get(&current).cloned().flatten();
                heads.insert(name.clone(), head);
                current = name;
            }
            "checkout" | "switch" => {
                if rest.len() != 1 {
                    return Err(error(
                        n,
                        line,
                        &format!("GitGraph {operation} requires one branch"),
                    ));
                }
                let name = strip_quotes(&rest[0]);
                if !heads.contains_key(&name) {
                    return Err(error(n, line, &format!("Unknown branch \"{name}\"")));
                }
                current = name;
            }
            "merge" => {
                let Some(first) = rest.first() else {
                    return Err(error(n, line, "GitGraph merge requires a branch"));
                };
                let branch = strip_quotes(first);
                if !heads.contains_key(&branch) {
                    return Err(error(n, line, &format!("Unknown branch \"{branch}\"")));
                }
                if branch == current {
                    return Err(error(n, line, "GitGraph cannot merge a branch into itself"));
                }
                let Some(current_head) = heads.get(&current).cloned().flatten() else {
                    return Err(error(
                        n,
                        line,
                        &format!("Branch \"{current}\" has no commits"),
                    ));
                };
                let Some(merged_head) = heads.get(&branch).cloned().flatten() else {
                    return Err(error(
                        n,
                        line,
                        &format!("Branch \"{branch}\" has no commits"),
                    ));
                };
                if current_head == merged_head {
                    return Err(error(
                        n,
                        line,
                        &format!("Branches already share head \"{merged_head}\""),
                    ));
                }
                let attributes = parse_attributes(&rest[1..], n, line, &["id", "tag", "type"])?;
                let id = match single(&attributes, "id")? {
                    Some(id) => id,
                    None => {
                        generated += 1;
                        format!("commit-{}", generated - 1)
                    }
                };
                if ids.contains(&id) {
                    return Err(error(n, line, &format!("Duplicate commit id \"{id}\"")));
                }
                let kind = commit_type(single(&attributes, "type")?, n, line)?;
                commits.push(Commit {
                    id: id.clone(),
                    message: None,
                    tags: attributes.get("tag").cloned().unwrap_or_default(),
                    kind,
                    branch: current.clone(),
                    parents: vec![current_head, merged_head],
                });
                ids.insert(id.clone());
                heads.insert(current.clone(), Some(id));
            }
            "cherry-pick" => return Err(error(n, line, "Cherry-pick is not supported")),
            _ => return Err(SyntaxError::unsupported(Kind::GitGraph, n, line)),
        }
    }
    for branch in &mut branches {
        branch.head = heads.get(&branch.name).cloned().flatten();
    }
    let main = branches.remove(0);
    let mut rest: Vec<(usize, Branch)> = branches.into_iter().enumerate().collect();
    let mut ordered: Vec<(usize, Branch)> = Vec::new();
    rest.retain(|(index, branch)| {
        if branch.order.is_some() {
            ordered.push((*index, branch.clone()));
            false
        } else {
            true
        }
    });
    ordered.sort_by(|a, b| a.1.order.cmp(&b.1.order).then(a.0.cmp(&b.0)));
    let branches = std::iter::once(main)
        .chain(rest.into_iter().map(|e| e.1))
        .chain(ordered.into_iter().map(|e| e.1))
        .collect();
    Ok(Diagram { branches, commits })
}

fn tokenize(line: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut token = String::new();
    let mut quote: Option<char> = None;
    for ch in line.chars() {
        if (ch == '"' || ch == '\'') && (quote.is_none() || quote == Some(ch)) {
            quote = if quote == Some(ch) { None } else { Some(ch) };
            token.push(ch);
            continue;
        }
        if ch.is_whitespace() && quote.is_none() {
            if !token.is_empty() {
                tokens.push(std::mem::take(&mut token));
            }
            continue;
        }
        token.push(ch);
    }
    if quote.is_some() {
        return vec![line.to_string()];
    }
    if !token.is_empty() {
        tokens.push(token);
    }
    tokens
}

fn parse_attributes(
    tokens: &[String],
    n: usize,
    line: &str,
    allowed: &[&str],
) -> Result<Attributes, SyntaxError> {
    let mut result = Attributes::new();
    let mut index = 0;
    while index < tokens.len() {
        let key_token = &tokens[index];
        let separator = key_token.find(':');
        let key = separator
            .map_or(key_token.as_str(), |s| &key_token[..s])
            .to_lowercase();
        if !allowed.contains(&key.as_str()) {
            return Err(error(
                n,
                line,
                &format!("Unsupported GitGraph attribute \"{key}\""),
            ));
        }
        let inline = separator.map_or("", |s| &key_token[s + 1..]);
        let value = if inline.is_empty() {
            index += 1;
            tokens.get(index).map(String::as_str)
        } else {
            Some(inline)
        };
        let Some(value) = value else {
            return Err(error(
                n,
                line,
                &format!("GitGraph attribute \"{key}\" requires a value"),
            ));
        };
        result.entry(key).or_default().push(strip_quotes(value));
        index += 1;
    }
    Ok(result)
}

fn commit_type(value: Option<String>, n: usize, line: &str) -> Result<CommitType, SyntaxError> {
    let Some(value) = value else {
        return Ok(CommitType::Normal);
    };
    match value.to_uppercase().as_str() {
        "NORMAL" => Ok(CommitType::Normal),
        "REVERSE" => Ok(CommitType::Reverse),
        "HIGHLIGHT" => Ok(CommitType::Highlight),
        _ => Err(error(
            n,
            line,
            &format!("Unknown GitGraph commit type \"{value}\""),
        )),
    }
}

fn strip_comment(value: &str) -> &str {
    let mut quote: Option<char> = None;
    let mut chars = value.char_indices().peekable();
    while let Some((index, ch)) = chars.next() {
        let Some(&(_, next)) = chars.peek() else {
            break;
        };
        if (ch == '"' || ch == '\'') && (quote.is_none() || quote == Some(ch)) {
            quote = if quote == Some(ch) { None } else { Some(ch) };
            continue;
        }
        if quote.is_none() && ch == '%' && next == '%' {
            return js_trim(&value[..index]);
        }
    }
    js_trim(value)
}

// Drawing.

const LANE_WIDTH: i32 = 2;
const LABEL_GAP: i32 = 2;

#[derive(Clone, Copy, Default)]
struct Connections {
    up: bool,
    down: bool,
    left: bool,
    right: bool,
    style: Option<Style>,
}

/// One connection update: `Some` sets a direction, `None` keeps it.
#[derive(Clone, Copy, Default)]
struct Additions {
    up: Option<bool>,
    down: Option<bool>,
    left: Option<bool>,
    right: Option<bool>,
}

type Cells = IndexMap<i32, Connections>;

fn connect(cells: &mut Cells, x: i32, additions: Additions, style: Style) {
    let current = cells.get(&x).copied().unwrap_or_default();
    cells.insert(
        x,
        Connections {
            up: additions.up.unwrap_or(current.up),
            down: additions.down.unwrap_or(current.down),
            left: additions.left.unwrap_or(current.left),
            right: additions.right.unwrap_or(current.right),
            style: current.style.or(Some(style)),
        },
    );
}

fn true_or_none(value: bool) -> Option<bool> {
    value.then_some(true)
}

fn connect_horizontal(
    cells: &mut Cells,
    source_lane: i32,
    target_lane: i32,
    vertical: [bool; 4],
    style: Style,
) {
    if source_lane == target_lane {
        return;
    }
    let source = source_lane * LANE_WIDTH;
    let target = target_lane * LANE_WIDTH;
    let direction = (target - source).signum();
    let [source_up, source_down, target_up, target_down] = vertical;
    let side = |forward: bool| {
        if forward {
            Additions {
                right: Some(true),
                ..Default::default()
            }
        } else {
            Additions {
                left: Some(true),
                ..Default::default()
            }
        }
    };
    connect(
        cells,
        source,
        Additions {
            up: true_or_none(source_up),
            down: true_or_none(source_down),
            ..side(direction > 0)
        },
        style,
    );
    let mut x = source + direction;
    while x != target {
        connect(
            cells,
            x,
            Additions {
                left: Some(true),
                right: Some(true),
                ..Default::default()
            },
            style,
        );
        x += direction;
    }
    connect(
        cells,
        target,
        Additions {
            up: true_or_none(target_up),
            down: true_or_none(target_down),
            ..side(direction < 0)
        },
        style,
    );
}

fn glyph(connections: &Connections) -> &'static str {
    match (
        connections.up,
        connections.down,
        connections.left,
        connections.right,
    ) {
        (true, true, false, false) | (true, false, false, false) | (false, true, false, false) => {
            "│"
        }
        (false, false, true, true) | (false, false, true, false) | (false, false, false, true) => {
            "─"
        }
        (false, true, false, true) => "╭",
        (false, true, true, false) => "╮",
        (true, false, false, true) => "╰",
        (true, false, true, false) => "╯",
        (true, true, false, true) => "├",
        (true, true, true, false) => "┤",
        (false, true, true, true) => "┬",
        (true, false, true, true) => "┴",
        (true, true, true, true) => "┼",
        (false, false, false, false) => " ",
    }
}

fn paint(grid: &mut Grid, cells: &Cells, y: i32) {
    for (x, connections) in cells {
        grid.set(*x, y, glyph(connections), connections.style);
    }
}

fn branch_style(lane: i32) -> Style {
    Style::Branch((lane % 8) as u8)
}

pub fn draw(diagram: &Diagram) -> Result<Grid, SizeError> {
    if diagram.commits.is_empty() {
        return Grid::new(0, 0, None);
    }
    let lane_of: HashMap<&str, i32> = diagram
        .branches
        .iter()
        .enumerate()
        .map(|(index, branch)| (branch.name.as_str(), index as i32))
        .collect();
    let by_id: HashMap<&str, &Commit> = diagram
        .commits
        .iter()
        .map(|commit| (commit.id.as_str(), commit))
        .collect();
    let mut spans: IndexMap<&str, (usize, usize)> = IndexMap::new();
    for (index, commit) in diagram.commits.iter().enumerate() {
        match spans.get_mut(commit.branch.as_str()) {
            Some(span) => span.1 = index,
            None => {
                spans.insert(&commit.branch, (index, index));
            }
        }
        for parent in &commit.parents {
            let Some(parent) = by_id.get(parent.as_str()) else {
                continue;
            };
            if parent.branch == commit.branch {
                continue;
            }
            if let Some(span) = spans.get_mut(parent.branch.as_str()) {
                span.1 = span.1.max(index);
            }
        }
    }
    let mut heads: HashMap<&str, Vec<&str>> = HashMap::new();
    for branch in &diagram.branches {
        if let Some(head) = &branch.head {
            heads.entry(head.as_str()).or_default().push(&branch.name);
        }
    }
    let label = |commit: &Commit| {
        let subject = commit.message.clone().unwrap_or_else(|| commit.id.clone());
        let decorations: Vec<String> = heads
            .get(commit.id.as_str())
            .into_iter()
            .flatten()
            .map(|name| name.to_string())
            .chain(commit.tags.iter().cloned())
            .map(|value| format!("[{value}]"))
            .collect();
        if decorations.is_empty() {
            subject
        } else {
            format!("{subject}  {}", decorations.join(" "))
        }
    };
    let graph_width = (diagram.branches.len() as i32 - 1) * LANE_WIDTH + 1;
    let label_width = diagram
        .commits
        .iter()
        .map(|commit| width(&label(commit)))
        .max()
        .unwrap_or(0)
        .max(0);
    let first_parent = |commit: &Commit| {
        commit
            .parents
            .first()
            .and_then(|id| by_id.get(id.as_str()).copied())
    };
    let forks: Vec<bool> = diagram
        .commits
        .iter()
        .map(|commit| {
            first_parent(commit).is_some_and(|parent| {
                lane_of.get(parent.branch.as_str()) != lane_of.get(commit.branch.as_str())
            })
        })
        .collect();
    let height = (diagram.commits.len() + forks.iter().filter(|&&fork| fork).count()) as i32;
    let mut grid = Grid::new(graph_width + LABEL_GAP + label_width, height, None)?;
    let mut row = 0;
    for (index, commit) in diagram.commits.iter().enumerate() {
        let lane = lane_of[commit.branch.as_str()];
        if forks[index] {
            let mut cells = Cells::new();
            for (branch, span) in &spans {
                if span.0 >= index || span.1 < index {
                    continue;
                }
                let branch_lane = lane_of[branch];
                connect(
                    &mut cells,
                    branch_lane * LANE_WIDTH,
                    Additions {
                        up: Some(true),
                        down: Some(true),
                        ..Default::default()
                    },
                    branch_style(branch_lane),
                );
            }
            if let Some(parent) = first_parent(commit)
                && parent.branch != commit.branch
            {
                let parent_lane = lane_of[parent.branch.as_str()];
                connect_horizontal(
                    &mut cells,
                    parent_lane,
                    lane,
                    [true, true, false, true],
                    branch_style(lane),
                );
            }
            paint(&mut grid, &cells, row);
            row += 1;
        }
        let mut cells = Cells::new();
        for branch in &diagram.branches {
            let Some(span) = spans.get(branch.name.as_str()) else {
                continue;
            };
            if span.0 > index || (span.1 <= index && branch.name != commit.branch) {
                continue;
            }
            let branch_lane = lane_of[branch.name.as_str()];
            connect(
                &mut cells,
                branch_lane * LANE_WIDTH,
                Additions {
                    up: Some(index > 0),
                    down: Some(span.1 > index),
                    ..Default::default()
                },
                branch_style(branch_lane),
            );
        }
        if let Some(parent) = commit.parents.get(1).and_then(|id| by_id.get(id.as_str())) {
            let parent_lane = lane_of[parent.branch.as_str()];
            connect_horizontal(
                &mut cells,
                lane,
                parent_lane,
                [true, false, true, false],
                branch_style(parent_lane),
            );
        }
        paint(&mut grid, &cells, row);
        let (glyph, style) = match commit.kind {
            CommitType::Reverse => ("⊗", Style::Reverse),
            CommitType::Highlight => ("◆", Style::Highlight),
            CommitType::Normal if commit.parents.len() > 1 => ("◎", Style::Merge),
            CommitType::Normal => ("●", Style::Commit),
        };
        grid.set(lane * LANE_WIDTH, row, glyph, Some(style));
        grid.text(
            graph_width + LABEL_GAP,
            row,
            &label(commit),
            Some(Style::Label),
        );
        row += 1;
    }
    Ok(grid)
}
