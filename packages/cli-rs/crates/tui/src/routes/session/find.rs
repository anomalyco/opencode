//! Plain case-insensitive text search over loaded session prompts, assistant text, and compaction summaries.

use std::sync::Arc;

use opencode_api::generated::{SessionMessageAssistantContentItem, SessionMessageCompaction, SessionMessageInfo};
use opencode_ui::theme::Theme;
use opentui::style::Span;
use opentui::widget::InlineSpan;
use regex::{Regex, RegexBuilder};
use unicode_width::UnicodeWidthChar;

use super::messages::list::{Messages, Part, Spec};

/// Synthetic fence language tagged onto plain (info-less) fenced code blocks while Find is open,
/// so `Markdown::code_block_renderer` receives them without altering visible text.
pub const PLAIN_FENCE_LANG: &str = "_opencode_find_plain";

/// Which part of a message a match belongs to, keyed like its transcript anchor.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum FindPartId {
    Message,
    Text(usize),
}

/// Stable identifier of a searchable transcript part across syncs and window shifts.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct FindPartKey {
    pub message_id: String,
    pub part: FindPartId,
}

impl FindPartKey {
    pub fn message(message_id: impl Into<String>) -> Self {
        Self { message_id: message_id.into(), part: FindPartId::Message }
    }

    pub fn text(message_id: impl Into<String>, ordinal: usize) -> Self {
        Self { message_id: message_id.into(), part: FindPartId::Text(ordinal) }
    }
}

/// A user prompt, assistant text part, or compaction summary in transcript order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FindPart {
    pub key: FindPartKey,
    pub text: String,
    pub markdown: bool,
}

/// One occurrence inside a transcript part.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FindMatch {
    pub key: FindPartKey,
    pub occurrence: usize,
}

/// Half-open UTF-8 byte range inside a text string.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FindRange {
    pub start: usize,
    pub end: usize,
}

/// Compiled case-insensitive literal search pattern. Queries differing only in case or surrounding
/// whitespace share the same `key` and compare equal so the active match survives them.
#[derive(Clone, Debug)]
pub struct FindPattern {
    pub key: String,
    regex: Arc<Regex>,
}

impl PartialEq for FindPattern {
    fn eq(&self, other: &Self) -> bool {
        self.key == other.key
    }
}

impl Eq for FindPattern {}

/// Plain, case-insensitive text; surrounding whitespace in the query is ignored.
pub fn find_pattern(query: &str) -> Option<FindPattern> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return None;
    }
    // Lowercased so queries that differ only in case compare equal by key. A character whose
    // lowercase form expands (such as İ -> i + U+0307) stays as typed so case-folding matches it.
    let key: String = trimmed
        .chars()
        .map(|ch| {
            let mut lower = ch.to_lowercase();
            match (lower.next(), lower.next()) {
                (Some(folded), None) => folded,
                _ => ch,
            }
        })
        .collect();
    let regex = RegexBuilder::new(&regex::escape(&key)).case_insensitive(true).build().ok()?;
    Some(FindPattern { key, regex: Arc::new(regex) })
}

/// Non-overlapping occurrences in UTF-8 byte order.
pub fn find_ranges(text: &str, pattern: Option<&FindPattern>) -> Vec<FindRange> {
    let Some(pattern) = pattern else { return Vec::new() };
    pattern.regex.find_iter(text).map(|found| FindRange { start: found.start(), end: found.end() }).collect()
}

/// Searchable text in transcript order: prompts, assistant text, and compaction summaries, not
/// reasoning or tool output.
pub fn find_parts(specs: &[Spec], lookup: Messages<'_>) -> Vec<FindPart> {
    let mut parts = Vec::new();
    for spec in specs {
        match spec {
            Spec::Message(key) => {
                let Some(message) = lookup.get(*key) else { continue };
                match message {
                    SessionMessageInfo::User(user) if !user.text.is_empty() => {
                        parts.push(FindPart {
                            key: FindPartKey::message(&user.id.0),
                            text: user.text.clone(),
                            markdown: false,
                        });
                    }
                    SessionMessageInfo::Compaction(compaction) => {
                        let text = match compaction {
                            SessionMessageCompaction::Completed(done) => done.summary.trim(),
                            SessionMessageCompaction::Failed(failed) if failed.error.r#type != "aborted" => {
                                failed.error.message.trim()
                            }
                            _ => "",
                        };
                        if !text.is_empty() {
                            parts.push(FindPart {
                                key: FindPartKey::message(message.id()),
                                text: text.to_owned(),
                                markdown: true,
                            });
                        }
                    }
                    _ => {}
                }
            }
            Spec::Part { message, part: part @ Part::Text(ordinal) } => {
                let Some(assistant) = lookup.assistant(*message) else { continue };
                let Some(SessionMessageAssistantContentItem::Text(text)) = part.resolve(assistant) else { continue };
                let trimmed = text.text.trim();
                if !trimmed.is_empty() {
                    parts.push(FindPart {
                        key: FindPartKey::text(&assistant.id.0, *ordinal),
                        text: trimmed.to_owned(),
                        markdown: true,
                    });
                }
            }
            _ => {}
        }
    }
    parts
}

/// Each part's matches, as many as `shown` says it displays; parts not yet rendered for the
/// pattern count what their text shows.
pub fn find_matches(
    parts: &[FindPart],
    pattern: Option<&FindPattern>,
    conceal: bool,
    shown: impl Fn(&FindPart) -> Option<usize>,
) -> Vec<FindMatch> {
    let Some(pattern) = pattern else { return Vec::new() };
    let mut matches = Vec::new();
    for part in parts {
        let count = shown(part).unwrap_or_else(|| {
            if part.markdown {
                markdown_shown_count(&part.text, conceal, pattern)
            } else {
                find_ranges(&part.text, Some(pattern)).len()
            }
        });
        for occurrence in 0..count {
            matches.push(FindMatch { key: part.key.clone(), occurrence });
        }
    }
    matches
}

/// Splits spans at `ranges` (byte offsets into their joined text) and paints each covered piece
/// with the find match or current-match colors.
pub fn paint_spans(
    spans: Vec<Span<'static>>,
    ranges: &[FindRange],
    first_occurrence: usize,
    current: Option<usize>,
    theme: &Theme,
) -> Vec<Span<'static>> {
    if ranges.is_empty() {
        return spans;
    }
    let mut out = Vec::with_capacity(spans.len() + ranges.len() * 2);
    let mut offset = 0usize;
    for span in spans {
        let start = offset;
        let len = span.content.len();
        offset += len;
        let covering: Vec<(usize, FindRange)> = ranges
            .iter()
            .enumerate()
            .filter(|(_, range)| range.start < offset && range.end > start)
            .map(|(index, range)| (index, *range))
            .collect();
        if covering.is_empty() {
            out.push(span);
            continue;
        }
        let mut pos = start;
        for (index, range) in covering {
            let cut_start = range.start.max(start);
            let cut_end = range.end.min(offset);
            if cut_start > pos {
                out.push(slice_span(&span, pos - start, cut_start - start));
            }
            if cut_end > cut_start {
                let mut piece = slice_span(&span, cut_start - start, cut_end - start);
                let occurrence = first_occurrence + index;
                if current == Some(occurrence) {
                    piece.style.fg = Some(theme.find.text.current);
                    piece.style.bg = Some(theme.find.background.current);
                } else {
                    piece.style.bg = Some(theme.find.background.r#match);
                }
                out.push(piece);
            }
            pos = cut_end;
        }
        if pos < offset {
            out.push(slice_span(&span, pos - start, len));
        }
    }
    out
}

/// Splits `InlineSpan`s at `ranges` and paints covered pieces, preserving links, click targets,
/// and inline attributes.
pub fn paint_inline_spans(
    spans: Vec<InlineSpan>,
    ranges: &[FindRange],
    first_occurrence: usize,
    current: Option<usize>,
    theme: &Theme,
) -> Vec<InlineSpan> {
    if ranges.is_empty() {
        return spans;
    }
    let mut out = Vec::with_capacity(spans.len() + ranges.len() * 2);
    let mut offset = 0usize;
    for span in spans {
        let start = offset;
        let len = span.span.content.len();
        offset += len;
        let covering: Vec<(usize, FindRange)> = ranges
            .iter()
            .enumerate()
            .filter(|(_, range)| range.start < offset && range.end > start)
            .map(|(index, range)| (index, *range))
            .collect();
        if covering.is_empty() {
            out.push(span);
            continue;
        }
        let mut pos = start;
        for (index, range) in covering {
            let cut_start = range.start.max(start);
            let cut_end = range.end.min(offset);
            if cut_start > pos {
                out.push(slice_inline_span(&span, pos - start, cut_start - start));
            }
            if cut_end > cut_start {
                let mut piece = slice_inline_span(&span, cut_start - start, cut_end - start);
                let occurrence = first_occurrence + index;
                if current == Some(occurrence) {
                    piece.span.style.fg = Some(theme.find.text.current);
                    piece.span.style.bg = Some(theme.find.background.current);
                } else {
                    piece.span.style.bg = Some(theme.find.background.r#match);
                }
                out.push(piece);
            }
            pos = cut_end;
        }
        if pos < offset {
            out.push(slice_inline_span(&span, pos - start, len));
        }
    }
    out
}

fn slice_span(span: &Span<'static>, start: usize, end: usize) -> Span<'static> {
    Span { content: span.content[start..end].to_owned().into(), style: span.style, link: span.link.clone() }
}

fn slice_inline_span(span: &InlineSpan, start: usize, end: usize) -> InlineSpan {
    let mut piece = span.clone();
    piece.span = slice_span(&span.span, start, end);
    piece
}

/// Visual row (0-based) from the top of a word-wrapped text widget showing `byte_offset`.
pub fn wrapped_row(text: &str, byte_offset: usize, width: u16) -> u32 {
    let target = byte_offset.min(text.len());
    if width == 0 {
        return text[..target].bytes().filter(|&byte| byte == b'\n').count() as u32;
    }
    let max_width = usize::from(width);
    let mut row = 0u32;
    let mut offset = 0usize;
    for line in text.split('\n') {
        let line_end = offset + line.len();
        if target <= line_end {
            return row + wrapped_line_row(line, target - offset, max_width);
        }
        row += wrapped_line_count(line, max_width);
        offset = line_end + 1;
    }
    row
}

fn wrapped_line_count(line: &str, max_width: usize) -> u32 {
    if line.is_empty() {
        return 1;
    }
    wrapped_line_row(line, line.len(), max_width) + 1
}

/// Word-wrapped row offset of `target` (byte offset within one logical line without `\n`).
fn wrapped_line_row(line: &str, target: usize, max_width: usize) -> u32 {
    let mut row = 0u32;
    let mut col = 0usize;
    let mut index = 0usize;
    let bytes = line.as_bytes();
    while index < line.len() {
        let is_space = bytes[index] == b' ' || bytes[index] == b'\t';
        let token_start = index;
        if is_space {
            while index < line.len() && (bytes[index] == b' ' || bytes[index] == b'\t') {
                index += 1;
            }
        } else {
            while index < line.len() && bytes[index] != b' ' && bytes[index] != b'\t' {
                let ch = line[index..].chars().next().expect("non-empty slice");
                index += ch.len_utf8();
            }
        }
        let token = &line[token_start..index];
        let token_width: usize = token.chars().map(char_width).sum();
        if !is_space && col > 0 && col + token_width > max_width {
            row += 1;
            col = 0;
        }
        for (rel, ch) in token.char_indices() {
            let at = token_start + rel;
            let w = char_width(ch);
            if col > 0 && col + w > max_width {
                row += 1;
                col = 0;
            }
            if at >= target {
                return row;
            }
            col += w;
        }
        if target < index {
            return row;
        }
    }
    row
}

fn char_width(ch: char) -> usize {
    if ch == '\t' { 4 } else { ch.width().unwrap_or(0) }
}

/// Opening fence delimiter: fence char (`\`` or `~`), delimiter count, and info string.
struct FenceOpen<'a> {
    marker: u8,
    len: usize,
    info: &'a str,
    /// Byte offset inside the line right after the closing delimiter char of the opening fence.
    after_fence: usize,
}

fn strip_container_prefix(line: &str) -> (&str, usize) {
    let mut rest = line;
    let mut consumed = 0;
    loop {
        let trimmed = rest.trim_start_matches(' ');
        let spaces = rest.len() - trimmed.len();
        if let Some(after) = trimmed.strip_prefix('>') {
            let skip = spaces + 1 + usize::from(after.starts_with(' '));
            consumed += skip;
            rest = &rest[skip..];
            continue;
        }
        break;
    }
    (rest, consumed)
}

fn parse_fence_open(line: &str) -> Option<FenceOpen<'_>> {
    let (rest, prefix) = strip_container_prefix(line);
    let trimmed = rest.trim_start_matches(' ');
    let indent = rest.len() - trimmed.len();
    if indent > 3 {
        return None;
    }
    let first = *trimmed.as_bytes().first()?;
    if first != b'`' && first != b'~' {
        return None;
    }
    let len = trimmed.bytes().take_while(|&byte| byte == first).count();
    if len < 3 {
        return None;
    }
    let info = trimmed[len..].trim();
    if first == b'`' && info.contains('`') {
        return None;
    }
    Some(FenceOpen { marker: first, len, info, after_fence: prefix + indent + len })
}

fn is_fence_close(line: &str, marker: u8, min_len: usize) -> bool {
    let (rest, _) = strip_container_prefix(line);
    let trimmed = rest.trim_start_matches(' ');
    if rest.len() - trimmed.len() > 3 {
        return false;
    }
    let count = trimmed.bytes().take_while(|&byte| byte == marker).count();
    count >= min_len && trimmed[count..].trim().is_empty()
}

/// Resolved filetypes named by fenced code blocks in `source`, plus whether any fence has an empty
/// info string.
pub fn scan_fences(source: &str) -> (Vec<String>, bool) {
    let mut languages = Vec::new();
    let mut has_plain = false;
    let mut open: Option<(u8, usize)> = None;
    for line in source.lines() {
        if let Some((marker, len)) = open {
            if is_fence_close(line, marker, len) {
                open = None;
            }
            continue;
        }
        if let Some(fence) = parse_fence_open(line) {
            open = Some((fence.marker, fence.len));
            if fence.info.is_empty() {
                has_plain = true;
            } else if let Some(ft) = opentui::syntax::filetype_for_info_string(fence.info)
                && !languages.contains(&ft)
            {
                languages.push(ft);
            }
        }
    }
    (languages, has_plain)
}

/// Inserts [`PLAIN_FENCE_LANG`] on opening fenced code blocks that have no info string so
/// `Markdown::code_block_renderer` receives them. Returns `None` when no fence needed tagging.
pub fn tag_plain_fences(source: &str) -> Option<String> {
    let mut out = String::new();
    let mut changed = false;
    let mut open: Option<(u8, usize)> = None;
    for chunk in source.split_inclusive('\n') {
        let line = chunk.strip_suffix('\n').unwrap_or(chunk);
        let line = line.strip_suffix('\r').unwrap_or(line);
        let ending = &chunk[line.len()..];
        if let Some((marker, len)) = open {
            if is_fence_close(line, marker, len) {
                open = None;
            }
            out.push_str(chunk);
            continue;
        }
        if let Some(fence) = parse_fence_open(line) {
            open = Some((fence.marker, fence.len));
            if fence.info.is_empty() {
                changed = true;
                out.push_str(&line[..fence.after_fence]);
                out.push_str(PLAIN_FENCE_LANG);
                out.push_str(ending);
                continue;
            }
        }
        out.push_str(chunk);
    }
    changed.then_some(out)
}

/// Top-level block summary for mapping a rendered match back to `Markdown::block_rows()`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TopBlock {
    pub start: usize,
    pub end: usize,
    pub table_rows: Option<usize>,
}

/// Splits Markdown `source` into top-level blocks matching CommonMark/GFM block boundaries so a
/// match's byte offset resolves to its `Markdown::block_rows()` entry.
pub fn top_level_blocks(source: &str) -> Vec<TopBlock> {
    let lines: Vec<(usize, &str)> = {
        let mut out = Vec::new();
        let mut offset = 0;
        for chunk in source.split_inclusive('\n') {
            let line = chunk.strip_suffix('\n').unwrap_or(chunk);
            let line = line.strip_suffix('\r').unwrap_or(line);
            out.push((offset, line));
            offset += chunk.len();
        }
        out
    };
    let mut blocks = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let (start, line) = lines[i];
        let trimmed = line.trim();
        if trimmed.is_empty() {
            i += 1;
            continue;
        }
        if let Some(fence) = parse_fence_open(line) {
            let mut j = i + 1;
            while j < lines.len() {
                if is_fence_close(lines[j].1, fence.marker, fence.len) {
                    j += 1;
                    break;
                }
                j += 1;
            }
            let end = end_offset(&lines, j, source.len());
            blocks.push(TopBlock { start, end, table_rows: None });
            i = j;
            continue;
        }
        if is_atx_heading(trimmed) {
            let end = end_offset(&lines, i + 1, source.len());
            blocks.push(TopBlock { start, end, table_rows: None });
            i += 1;
            continue;
        }
        if is_thematic_break(trimmed) {
            let end = end_offset(&lines, i + 1, source.len());
            blocks.push(TopBlock { start, end, table_rows: None });
            i += 1;
            continue;
        }
        if i + 1 < lines.len() && is_table_delimiter(lines[i + 1].1) && lines[i].1.contains('|') {
            let mut j = i + 2;
            let mut rows = 1usize;
            while j < lines.len() && !lines[j].1.trim().is_empty() && lines[j].1.contains('|') {
                rows += 1;
                j += 1;
            }
            let end = end_offset(&lines, j, source.len());
            blocks.push(TopBlock { start, end, table_rows: Some(rows) });
            i = j;
            continue;
        }
        if trimmed.starts_with('>') {
            let mut j = i + 1;
            while j < lines.len() && !lines[j].1.trim().is_empty() {
                j += 1;
            }
            let end = end_offset(&lines, j, source.len());
            blocks.push(TopBlock { start, end, table_rows: None });
            i = j;
            continue;
        }
        if let Some(ordered) = list_marker(line) {
            let mut j = i + 1;
            while j < lines.len() {
                let next = lines[j].1;
                if next.trim().is_empty() {
                    let mut k = j + 1;
                    while k < lines.len() && lines[k].1.trim().is_empty() {
                        k += 1;
                    }
                    if k < lines.len()
                        && (list_marker(lines[k].1) == Some(ordered)
                            || lines[k].1.starts_with("  ")
                            || lines[k].1.starts_with('\t'))
                    {
                        j = k;
                        continue;
                    }
                    break;
                }
                if list_marker(next).is_some_and(|kind| kind != ordered)
                    || is_atx_heading(next.trim())
                    || parse_fence_open(next).is_some()
                {
                    break;
                }
                j += 1;
            }
            let end = end_offset(&lines, j, source.len());
            blocks.push(TopBlock { start, end, table_rows: None });
            i = j;
            continue;
        }
        let mut j = i + 1;
        while j < lines.len() {
            let next = lines[j].1;
            let next_trimmed = next.trim();
            if next_trimmed.is_empty() {
                break;
            }
            if is_setext_underline(next_trimmed) {
                j += 1;
                break;
            }
            if parse_fence_open(next).is_some()
                || is_atx_heading(next_trimmed)
                || is_thematic_break(next_trimmed)
                || next_trimmed.starts_with('>')
                || list_marker(next).is_some()
                || (j + 1 < lines.len() && is_table_delimiter(lines[j + 1].1) && next.contains('|'))
            {
                break;
            }
            j += 1;
        }
        let end = end_offset(&lines, j, source.len());
        blocks.push(TopBlock { start, end, table_rows: None });
        i = j;
    }
    blocks
}

fn end_offset(lines: &[(usize, &str)], next: usize, total: usize) -> usize {
    lines.get(next).map_or(total, |(offset, _)| *offset)
}

fn is_atx_heading(trimmed: &str) -> bool {
    let hashes = trimmed.bytes().take_while(|&byte| byte == b'#').count();
    (1..=6).contains(&hashes) && trimmed.as_bytes().get(hashes).is_none_or(|&byte| byte == b' ' || byte == b'\t')
}

fn is_thematic_break(trimmed: &str) -> bool {
    let Some(first) = trimmed.bytes().next().filter(|byte| matches!(byte, b'-' | b'*' | b'_')) else {
        return false;
    };
    let mut count = 0;
    for byte in trimmed.bytes() {
        if byte == first {
            count += 1;
        } else if byte != b' ' && byte != b'\t' {
            return false;
        }
    }
    count >= 3
}

fn is_setext_underline(trimmed: &str) -> bool {
    let Some(first) = trimmed.bytes().next().filter(|byte| matches!(byte, b'=' | b'-')) else {
        return false;
    };
    trimmed.bytes().all(|byte| byte == first)
}

fn is_table_delimiter(line: &str) -> bool {
    let trimmed = line.trim();
    if !trimmed.contains('-') || !trimmed.contains('|') {
        return false;
    }
    let cells = split_table_cells(trimmed);
    !cells.is_empty()
        && cells.iter().all(|cell| {
            let cell = cell.trim();
            let cell = cell.strip_prefix(':').unwrap_or(cell);
            let cell = cell.strip_suffix(':').unwrap_or(cell);
            !cell.is_empty() && cell.bytes().all(|byte| byte == b'-')
        })
}

fn split_table_cells(line: &str) -> Vec<&str> {
    let trimmed = line.trim();
    let trimmed = trimmed.strip_prefix('|').unwrap_or(trimmed);
    let trimmed = trimmed.strip_suffix('|').unwrap_or(trimmed);
    trimmed.split('|').collect()
}

/// Returns `Some(true)` for an ordered list item, `Some(false)` for an unordered list item.
fn list_marker(line: &str) -> Option<bool> {
    let trimmed = line.trim_start_matches(' ');
    if line.len() - trimmed.len() > 3 {
        return None;
    }
    if let Some(first) = trimmed.bytes().next()
        && matches!(first, b'-' | b'*' | b'+')
        && trimmed.as_bytes().get(1).is_some_and(|&byte| byte == b' ' || byte == b'\t')
    {
        return Some(false);
    }
    let digits = trimmed.bytes().take_while(u8::is_ascii_digit).count();
    if (1..=9).contains(&digits)
        && trimmed.as_bytes().get(digits).is_some_and(|&byte| byte == b'.' || byte == b')')
        && trimmed.as_bytes().get(digits + 1).is_some_and(|&byte| byte == b' ' || byte == b'\t')
    {
        return Some(true);
    }
    None
}

/// Estimates how many matches an unmounted Markdown part will display, without mounting a widget:
/// skips fence info strings and delimiters, table delimiter rows, and (when `conceal` is on)
/// inline markup markers and link URLs. Mounted parts replace this with their exact rendered count.
pub fn markdown_shown_count(source: &str, conceal: bool, pattern: &FindPattern) -> usize {
    let mut total = 0usize;
    let mut fence: Option<(u8, usize)> = None;
    let mut code = String::new();
    let mut para = String::new();
    let lines: Vec<&str> = source.lines().collect();
    let flush_para = |para: &mut String, total: &mut usize| {
        if para.is_empty() {
            return;
        }
        let shown = if conceal { strip_inline_markup(para) } else { para.clone() };
        *total += find_ranges(&shown, Some(pattern)).len();
        para.clear();
    };
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        if let Some((marker, len)) = fence {
            if is_fence_close(line, marker, len) {
                total += find_ranges(code.trim_end_matches('\n'), Some(pattern)).len();
                code.clear();
                fence = None;
            } else {
                code.push_str(line);
                code.push('\n');
            }
            i += 1;
            continue;
        }
        if let Some(open) = parse_fence_open(line) {
            flush_para(&mut para, &mut total);
            fence = Some((open.marker, open.len));
            i += 1;
            continue;
        }
        if i + 1 < lines.len() && is_table_delimiter(lines[i + 1]) && line.contains('|') {
            flush_para(&mut para, &mut total);
            for cell in split_table_cells(line) {
                let text = cell.trim();
                let shown = if conceal { strip_inline_markup(text) } else { text.to_owned() };
                total += find_ranges(&shown, Some(pattern)).len();
            }
            i += 2;
            while i < lines.len() && !lines[i].trim().is_empty() && lines[i].contains('|') {
                for cell in split_table_cells(lines[i]) {
                    let text = cell.trim();
                    let shown = if conceal { strip_inline_markup(text) } else { text.to_owned() };
                    total += find_ranges(&shown, Some(pattern)).len();
                }
                i += 1;
            }
            continue;
        }
        let trimmed = line.trim();
        if trimmed.is_empty() || is_thematic_break(trimmed) {
            flush_para(&mut para, &mut total);
            i += 1;
            continue;
        }
        if is_atx_heading(trimmed) {
            flush_para(&mut para, &mut total);
            let text = if conceal { trimmed.trim_start_matches('#').trim() } else { trimmed };
            let shown = if conceal { strip_inline_markup(text) } else { text.to_owned() };
            total += find_ranges(&shown, Some(pattern)).len();
            i += 1;
            continue;
        }
        let body = strip_block_prefix(line, conceal);
        if !para.is_empty() {
            para.push(' ');
        }
        para.push_str(body);
        i += 1;
    }
    if fence.is_some() {
        total += find_ranges(code.trim_end_matches('\n'), Some(pattern)).len();
    }
    flush_para(&mut para, &mut total);
    total
}

fn strip_block_prefix(line: &str, conceal: bool) -> &str {
    let (mut rest, _) = strip_container_prefix(line);
    if !conceal {
        return rest.trim();
    }
    rest = rest.trim_start();
    if let Some(ordered) = list_marker(rest) {
        if ordered {
            let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
            rest = rest[digits + 1..].trim_start();
        } else {
            rest = rest[1..].trim_start();
        }
        if let Some(after) =
            rest.strip_prefix("[ ] ").or_else(|| rest.strip_prefix("[x] ")).or_else(|| rest.strip_prefix("[X] "))
        {
            rest = after;
        }
    }
    rest
}

/// Removes concealed inline Markdown markers (`**`, `*`, `__`, `_`, `~~`, backticks,
/// `[label](url)` targets, and backslash escapes) for unmounted match counting.
fn strip_inline_markup(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' if i + 1 < bytes.len() && bytes[i + 1].is_ascii_punctuation() => {
                out.push(bytes[i + 1] as char);
                i += 2;
            }
            b'`' => {
                let ticks = bytes[i..].iter().take_while(|&&b| b == b'`').count();
                let start = i + ticks;
                if let Some(close) = find_closing_ticks(bytes, start, ticks) {
                    let inner = &input[start..close];
                    let inner = if inner.len() >= 2
                        && inner.starts_with(' ')
                        && inner.ends_with(' ')
                        && inner.bytes().any(|b| b != b' ')
                    {
                        &inner[1..inner.len() - 1]
                    } else {
                        inner
                    };
                    out.push_str(inner);
                    i = close + ticks;
                } else {
                    out.push_str(&input[i..start]);
                    i = start;
                }
            }
            b'!' if i + 1 < bytes.len() && bytes[i + 1] == b'[' => {
                if let Some((label, end)) = parse_inline_link(input, i + 1) {
                    out.push_str(&strip_inline_markup(label));
                    i = end;
                } else {
                    out.push('!');
                    i += 1;
                }
            }
            b'[' => {
                if let Some((label, end)) = parse_inline_link(input, i) {
                    out.push_str(&strip_inline_markup(label));
                    i = end;
                } else {
                    out.push('[');
                    i += 1;
                }
            }
            b'*' | b'~' => {
                let marker = bytes[i];
                let count = bytes[i..].iter().take_while(|&&b| b == marker).count();
                if marker == b'~' && count > 2 {
                    out.push_str(&input[i..i + count]);
                    i += count;
                    continue;
                }
                if let Some(close) = find_closing_delim(bytes, i + count, marker, count) {
                    out.push_str(&strip_inline_markup(&input[i + count..close]));
                    i = close + count;
                } else {
                    out.push_str(&input[i..i + count]);
                    i += count;
                }
            }
            b'_' => {
                let prev_alnum = i > 0 && input[..i].chars().next_back().is_some_and(char::is_alphanumeric);
                let count = bytes[i..].iter().take_while(|&&b| b == b'_').count();
                if !prev_alnum && let Some(close) = find_closing_underscore(input, i + count, count) {
                    out.push_str(&strip_inline_markup(&input[i + count..close]));
                    i = close + count;
                } else {
                    out.push_str(&input[i..i + count]);
                    i += count;
                }
            }
            _ => {
                let ch = input[i..].chars().next().expect("valid utf-8");
                out.push(ch);
                i += ch.len_utf8();
            }
        }
    }
    out
}

fn find_closing_ticks(bytes: &[u8], from: usize, ticks: usize) -> Option<usize> {
    let mut i = from;
    while i < bytes.len() {
        if bytes[i] == b'`' {
            let run = bytes[i..].iter().take_while(|&&b| b == b'`').count();
            if run == ticks {
                return Some(i);
            }
            i += run;
        } else {
            i += 1;
        }
    }
    None
}

fn parse_inline_link(input: &str, open_bracket: usize) -> Option<(&str, usize)> {
    let bytes = input.as_bytes();
    let mut depth = 0usize;
    let mut i = open_bracket;
    while i < bytes.len() {
        match bytes[i] {
            b'\\' => i += 2,
            b'[' => {
                depth += 1;
                i += 1;
            }
            b']' => {
                depth -= 1;
                if depth == 0 {
                    if bytes.get(i + 1) != Some(&b'(') {
                        return None;
                    }
                    let mut pdepth = 1usize;
                    let mut j = i + 2;
                    while j < bytes.len() && pdepth > 0 {
                        match bytes[j] {
                            b'\\' => j += 2,
                            b'(' => {
                                pdepth += 1;
                                j += 1;
                            }
                            b')' => {
                                pdepth -= 1;
                                j += 1;
                            }
                            _ => j += 1,
                        }
                    }
                    if pdepth == 0 {
                        return Some((&input[open_bracket + 1..i], j));
                    }
                    return None;
                }
                i += 1;
            }
            _ => i += 1,
        }
    }
    None
}

fn find_closing_delim(bytes: &[u8], from: usize, marker: u8, count: usize) -> Option<usize> {
    if from >= bytes.len() || bytes[from].is_ascii_whitespace() {
        return None;
    }
    let mut i = from;
    while i + count <= bytes.len() {
        if bytes[i] == b'\\' {
            i += 2;
            continue;
        }
        if bytes[i] == marker {
            let run = bytes[i..].iter().take_while(|&&b| b == marker).count();
            if run >= count && !bytes[i - 1].is_ascii_whitespace() {
                return Some(i);
            }
            i += run;
            continue;
        }
        i += 1;
    }
    None
}

fn find_closing_underscore(input: &str, from: usize, count: usize) -> Option<usize> {
    let bytes = input.as_bytes();
    if from >= bytes.len() || bytes[from].is_ascii_whitespace() {
        return None;
    }
    let mut i = from;
    while i + count <= bytes.len() {
        if bytes[i] == b'\\' {
            i += 2;
            continue;
        }
        if bytes[i] == b'_' {
            let run = bytes[i..].iter().take_while(|&&b| b == b'_').count();
            let after = i + count;
            let next_alnum = input[after..].chars().next().is_some_and(char::is_alphanumeric);
            if run == count && !bytes[i - 1].is_ascii_whitespace() && !next_alnum {
                return Some(i);
            }
            i += run;
            continue;
        }
        i += 1;
    }
    None
}

#[cfg(test)]
mod tests {
    use opencode_store::MessageKey;
    use opencode_ui::theme::{Catalog, ThemeMode};
    use opentui::style::Style;
    use serde_json::json;

    use super::*;

    fn messages(value: serde_json::Value) -> Vec<SessionMessageInfo> {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn matches_plain_text_without_case_ignoring_surrounding_whitespace() {
        assert!(find_pattern("   ").is_none());
        assert_eq!(
            find_ranges("Needle, needle, NEEDLE", find_pattern(" needle ").as_ref()),
            vec![FindRange { start: 0, end: 6 }, FindRange { start: 8, end: 14 }, FindRange { start: 16, end: 22 },]
        );
        assert_eq!(find_ranges("a.b axb (x)", find_pattern("a.b").as_ref()), vec![FindRange { start: 0, end: 3 }]);
        assert_eq!(find_ranges("call (x) now", find_pattern("(x)").as_ref()), vec![FindRange { start: 5, end: 8 }]);
        assert_eq!(
            find_ranges("aaaa", find_pattern("aa").as_ref()),
            vec![FindRange { start: 0, end: 2 }, FindRange { start: 2, end: 4 }]
        );
        assert_eq!(find_pattern("Needle"), find_pattern("needle"));
        assert_eq!(find_pattern("  Needle  "), find_pattern("needle"));
        let dotted = find_pattern("İstanbul").unwrap();
        assert_eq!(find_ranges("İstanbul", Some(&dotted)), vec![FindRange { start: 0, end: "İstanbul".len() }]);
    }

    #[test]
    fn searches_prompts_assistant_text_and_compaction_summaries_in_transcript_order() {
        let list = messages(json!([
            { "id": "u1", "type": "user", "text": "find the needle", "time": { "created": 1 } },
            {
                "id": "c1",
                "type": "compaction",
                "status": "completed",
                "reason": "manual",
                "summary": " a needle summary ",
                "time": { "created": 2 }
            },
            {
                "id": "c2",
                "type": "compaction",
                "status": "failed",
                "reason": "manual",
                "error": { "type": "aborted", "message": "needle cancelled" },
                "time": { "created": 3 }
            },
            {
                "id": "c3",
                "type": "compaction",
                "status": "failed",
                "reason": "manual",
                "error": { "type": "provider", "message": " needle failed " },
                "time": { "created": 4 }
            },
            {
                "id": "a1",
                "type": "assistant",
                "agent": "build",
                "model": { "providerID": "p", "id": "m" },
                "time": { "created": 5 },
                "content": [
                    { "type": "reasoning", "text": "needle in my thoughts" },
                    { "type": "text", "text": "  first needle  " },
                    { "type": "tool", "id": "tool-1", "name": "grep", "state": { "status": "completed", "input": { "pattern": "needle" }, "content": [] }, "time": { "created": 5 } },
                    { "type": "text", "text": "second needle" }
                ]
            }
        ]));
        let specs = vec![
            Spec::Message(MessageKey(0)),
            Spec::Message(MessageKey(1)),
            Spec::Message(MessageKey(2)),
            Spec::Message(MessageKey(3)),
            Spec::Part { message: MessageKey(4), part: Part::Reasoning(0) },
            Spec::Part { message: MessageKey(4), part: Part::Text(0) },
            Spec::Part { message: MessageKey(4), part: Part::Tool(2) },
            Spec::Part { message: MessageKey(4), part: Part::Text(1) },
        ];
        let parts = find_parts(&specs, Messages::of(&list));
        assert_eq!(
            parts,
            vec![
                FindPart { key: FindPartKey::message("u1"), text: "find the needle".into(), markdown: false },
                FindPart { key: FindPartKey::message("c1"), text: "a needle summary".into(), markdown: true },
                FindPart { key: FindPartKey::message("c3"), text: "needle failed".into(), markdown: true },
                FindPart { key: FindPartKey::text("a1", 0), text: "first needle".into(), markdown: true },
                FindPart { key: FindPartKey::text("a1", 1), text: "second needle".into(), markdown: true },
            ]
        );
        let matches = find_matches(&parts, find_pattern("needle").as_ref(), true, |_| None);
        assert_eq!(matches.len(), 5);
        assert_eq!(
            matches.iter().map(|m| (&m.key.message_id[..], m.key.part)).collect::<Vec<_>>(),
            vec![
                ("u1", FindPartId::Message),
                ("c1", FindPartId::Message),
                ("c3", FindPartId::Message),
                ("a1", FindPartId::Text(0)),
                ("a1", FindPartId::Text(1)),
            ]
        );
    }

    #[test]
    fn counts_what_a_rendered_part_shows_over_its_source() {
        let parts = vec![FindPart {
            key: FindPartKey::text("a1", 0),
            text: "```typescript\nconst x = 1\n```\n\nWe use typescript, **foo**bar.".into(),
            markdown: true,
        }];
        assert_eq!(find_matches(&parts, find_pattern("typescript").as_ref(), true, |_| None).len(), 1);
        assert_eq!(find_matches(&parts, find_pattern("foobar").as_ref(), true, |_| None).len(), 1);
        assert_eq!(find_matches(&parts, find_pattern("foobar").as_ref(), false, |_| None).len(), 0);
        assert_eq!(find_matches(&parts, find_pattern("typescript").as_ref(), true, |_| Some(3)).len(), 3);
    }

    #[test]
    fn paints_ranges_across_span_boundaries() {
        let theme = Catalog::default().load("opencode", ThemeMode::Dark).unwrap().theme;
        let spans = vec![Span::raw("Hello "), Span::styled("world", Style::new().bold())];
        let painted = paint_spans(spans, &[FindRange { start: 4, end: 8 }], 0, None, &theme);
        let summary: Vec<(&str, bool, bool)> = painted
            .iter()
            .map(|span| {
                (
                    span.content.as_ref(),
                    span.style.bg == Some(theme.find.background.r#match),
                    span.style.attributes.contains(opentui::style::Attributes::BOLD),
                )
            })
            .collect();
        assert_eq!(
            summary,
            vec![("Hell", false, false), ("o ", true, false), ("wo", true, true), ("rld", false, true)]
        );

        let current = paint_spans(
            vec![Span::raw("Hello "), Span::raw("world")],
            &[FindRange { start: 4, end: 8 }],
            0,
            Some(0),
            &theme,
        );
        assert_eq!(current[1].style.fg, Some(theme.find.text.current));
        assert_eq!(current[1].style.bg, Some(theme.find.background.current));
    }

    #[test]
    fn finds_the_wrapped_row_that_shows_an_offset() {
        let text = "alpha beta gamma\nsecond";
        assert_eq!(wrapped_row(text, text.find("beta").unwrap(), 11), 0);
        assert_eq!(wrapped_row(text, text.find("gamma").unwrap(), 11), 1);
        assert_eq!(wrapped_row(text, text.find("second").unwrap(), 11), 2);
    }

    #[test]
    fn scans_and_tags_plain_fences_without_touching_named_fences() {
        let source = "intro\n\n```ts\nconst a = 1\n```\n\n```\nplain needle\n```";
        let (langs, plain) = scan_fences(source);
        assert_eq!(langs, vec!["typescript".to_owned()]);
        assert!(plain);
        let tagged = tag_plain_fences(source).unwrap();
        assert!(tagged.contains("```ts\nconst a = 1\n```"));
        assert!(tagged.contains(&format!("```{PLAIN_FENCE_LANG}\nplain needle\n```")));
        assert!(tag_plain_fences("```rs\nfn f() {}\n```").is_none());
    }

    #[test]
    fn splits_top_level_blocks_for_prose_code_and_tables() {
        let source =
            "The **Needle** is in the code:\n\n```ts\nconst needle = 1\n```\n\n| a | b |\n|---|---|\n| hay | needle |";
        let blocks = top_level_blocks(source);
        assert_eq!(blocks.len(), 3);
        assert_eq!(blocks[0].table_rows, None);
        assert_eq!(blocks[1].table_rows, None);
        assert_eq!(blocks[2].table_rows, Some(2));
    }
}
