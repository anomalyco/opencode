//! Timelines (`packages/merman/src/timeline`): parser and the vertical terminal drawing.

use std::sync::LazyLock;

use regex::Regex;

use crate::core::canvas::{Canvas, SizeError};
use crate::core::text::{first_meaningful_line, js_trim, meaningful_lines, split_lines, strip_quotes, width};
use crate::{Kind, SyntaxError};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Style {
    Title,
    Section,
    Period,
    Spine,
    Event,
    /// `sectionFade1` to `sectionFade3`, as 0 to 2.
    SectionFade(u8),
    PeriodFade(u8),
}

pub type Grid = Canvas<Style>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Entry {
    Section(String),
    Period { period: String, events: Vec<String> },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Diagram {
    pub title: Option<String>,
    pub entries: Vec<Entry>,
}

fn pattern(source: &str) -> Regex {
    Regex::new(source).expect("timeline pattern")
}

static HEADER: LazyLock<Regex> = LazyLock::new(|| pattern(r"(?i)^timeline(?:\s+(TD|LR))?$"));
static TITLE: LazyLock<Regex> = LazyLock::new(|| pattern(r"(?i)^title(?:\s+(.+))?$"));
static SECTION: LazyLock<Regex> = LazyLock::new(|| pattern(r"(?i)^section(?:\s+(.+))?$"));
static ACCESSIBILITY: LazyLock<Regex> = LazyLock::new(|| pattern(r"(?i)^acc(?:Title|Descr)(?::|\s|$)"));
static ACC_BLOCK: LazyLock<Regex> = LazyLock::new(|| pattern(r"(?i)^accDescr\s*\{$"));

pub fn is_timeline(content: &str) -> bool {
    HEADER.is_match(first_meaningful_line(content).unwrap_or(""))
}

fn error(line: usize, source: &str, reason: &str) -> SyntaxError {
    SyntaxError::new(Kind::Timeline, line, source, reason)
}

pub fn parse(content: &str) -> Result<Diagram, SyntaxError> {
    let mut entries: Vec<Entry> = Vec::new();
    let mut title = None;
    // The index in `entries` of the period continuation lines add to.
    let mut current: Option<usize> = None;
    let mut in_description = false;
    for source in meaningful_lines(content) {
        let line = js_trim(source.text.find("%%").map_or(source.text, |index| &source.text[..index]));
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
        if line.is_empty() || line.starts_with('#') || ACCESSIBILITY.is_match(line) || HEADER.is_match(line) {
            continue;
        }
        if let Some(captures) = TITLE.captures(line) {
            let Some(value) = captures.get(1) else {
                return Err(error(n, line, "Timeline title cannot be empty"));
            };
            title = Some(strip_quotes(value.as_str()));
            continue;
        }
        if let Some(captures) = SECTION.captures(line) {
            let Some(value) = captures.get(1) else {
                return Err(error(n, line, "Timeline section cannot be empty"));
            };
            entries.push(Entry::Section(strip_quotes(value.as_str())));
            current = None;
            continue;
        }
        if let Some(rest) = line.strip_prefix(':') {
            let Some(index) = current else {
                return Err(error(n, line, "Timeline continuation requires a preceding period"));
            };
            let events = parse_events(split_fields(rest), n, line)?;
            if let Some(Entry::Period { events: existing, .. }) = entries.get_mut(index) {
                existing.extend(events);
            }
            continue;
        }
        let mut fields = split_fields(line);
        let period = strip_quotes(fields.remove(0));
        if period.is_empty() {
            return Err(error(n, line, "Timeline period cannot be empty"));
        }
        let events = if fields.is_empty() { Vec::new() } else { parse_events(fields, n, line)? };
        entries.push(Entry::Period { period, events });
        current = Some(entries.len() - 1);
    }
    Ok(Diagram { title, entries })
}

fn parse_events(fields: Vec<&str>, n: usize, line: &str) -> Result<Vec<String>, SyntaxError> {
    let events: Vec<String> = fields.into_iter().map(strip_quotes).collect();
    if events.is_empty() || events.iter().any(String::is_empty) {
        return Err(error(n, line, "Timeline event cannot be empty"));
    }
    Ok(events)
}

/// Splits on `:` followed by whitespace or the end, outside quotes.
fn split_fields(value: &str) -> Vec<&str> {
    let mut fields = Vec::new();
    let mut quote: Option<char> = None;
    let mut start = 0;
    let mut chars = value.char_indices().peekable();
    while let Some((index, ch)) = chars.next() {
        if ch == '"' || ch == '\'' {
            if quote == Some(ch) {
                quote = None;
            } else if quote.is_none() && js_trim(&value[start..index]).is_empty() {
                quote = Some(ch);
            }
            continue;
        }
        let next = chars.peek().map(|&(_, next)| next);
        if ch != ':' || quote.is_some() || next.is_some_and(|next| !next.is_whitespace()) {
            continue;
        }
        fields.push(&value[start..index]);
        start = index + 1;
    }
    fields.push(&value[start..]);
    fields
}

const JOIN_WIDTH: i32 = 3;
const SPINE_OFFSET: i32 = JOIN_WIDTH + 1;
const EVENT_OFFSET: i32 = 3;

pub fn draw(diagram: &Diagram) -> Result<Grid, SizeError> {
    let mut left_width = 0;
    let mut right_width = 0;
    let mut body_height = 0;
    struct Layout {
        period_lines: Vec<String>,
        event_lines: Vec<Vec<String>>,
        height: i32,
    }
    let mut layouts: Vec<Option<Layout>> = Vec::new();
    for entry in &diagram.entries {
        match entry {
            Entry::Section(label) => {
                let lines = split_lines(label);
                body_height += lines.len() as i32 + 1;
                left_width = lines.iter().map(|line| width(line)).fold(left_width, i32::max);
                layouts.push(None);
            }
            Entry::Period { period, events } => {
                let period_lines = split_lines(period);
                let event_lines: Vec<Vec<String>> = events.iter().map(|event| split_lines(event)).collect();
                let event_height: i32 = event_lines.iter().map(|lines| lines.len() as i32).sum();
                let height = (period_lines.len() as i32).max(event_height);
                left_width = period_lines.iter().map(|line| width(line)).fold(left_width, i32::max);
                right_width = event_lines.iter().flatten().map(|line| width(line)).fold(right_width, i32::max);
                body_height += height + 1;
                layouts.push(Some(Layout { period_lines, event_lines, height }));
            }
        }
    }
    let title_lines = diagram.title.as_deref().map(split_lines).unwrap_or_default();
    let empty = diagram.entries.is_empty();
    let body_width = if empty { 0 } else { left_width + SPINE_OFFSET + EVENT_OFFSET + right_width + 1 };
    let title_width = title_lines.iter().map(|line| width(line)).max().unwrap_or(0);
    let grid_width = body_width.max(title_width);
    let title_height = if title_lines.is_empty() { 0 } else { title_lines.len() as i32 + i32::from(!empty) };
    if grid_width == 0 {
        return Grid::new(0, 0, None);
    }
    let mut grid = Grid::new(grid_width, title_height + body_height, None)?;
    for (index, line) in title_lines.iter().enumerate() {
        grid.text((grid_width - width(line)).div_euclid(2), index as i32, line, Some(Style::Title));
    }
    if empty {
        return Ok(grid);
    }
    let spine = left_width + SPINE_OFFSET;
    let mut y = title_height;
    let mut rail_started = false;
    let join = |grid: &mut Grid, y: i32, fade: fn(u8) -> Style| {
        for index in 0..JOIN_WIDTH {
            grid.set(left_width + index + 1, y, "─", Some(fade(index as u8)));
        }
    };
    for (entry, layout) in diagram.entries.iter().zip(&layouts) {
        let (Entry::Period { .. }, Some(layout)) = (entry, layout) else {
            let Entry::Section(label) = entry else {
                continue;
            };
            let lines = split_lines(label);
            for (index, line) in lines.iter().enumerate() {
                let row = y + index as i32;
                grid.text(left_width - width(line), row, line, Some(Style::Section));
                if index > 0 {
                    grid.set(spine, row, "│", Some(Style::Spine));
                }
            }
            join(&mut grid, y, Style::SectionFade);
            grid.set(spine, y, if rail_started { "┤" } else { "┐" }, Some(Style::Spine));
            grid.set(spine, y + lines.len() as i32, "│", Some(Style::Spine));
            rail_started = true;
            y += lines.len() as i32 + 1;
            continue;
        };
        for row in 0..layout.height + 1 {
            grid.set(spine, y + row, "│", Some(Style::Spine));
        }
        rail_started = true;
        grid.set(spine, y, "●", Some(Style::Spine));
        for (index, line) in layout.period_lines.iter().enumerate() {
            grid.text(left_width - width(line), y + index as i32, line, Some(Style::Period));
        }
        join(&mut grid, y, Style::PeriodFade);
        let mut event_y = y;
        for lines in &layout.event_lines {
            for (index, line) in lines.iter().enumerate() {
                grid.text(spine + EVENT_OFFSET, event_y + index as i32, line, Some(Style::Event));
            }
            event_y += lines.len() as i32;
        }
        y += layout.height + 1;
    }
    Ok(grid)
}
