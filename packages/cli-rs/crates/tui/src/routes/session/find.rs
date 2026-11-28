//! Plain case-insensitive text search over loaded session prompts, assistant text, and compaction summaries.

use std::sync::Arc;

use opencode_api::generated::{SessionMessageAssistantContentItem, SessionMessageCompaction, SessionMessageInfo};
use opencode_ui::theme::Theme;
use opentui::style::Span;
use opentui::widget::InlineSpan;
use regex::{Regex, RegexBuilder};
use unicode_width::UnicodeWidthChar;

use super::messages::list::{Messages, Part, Spec};

/// Synthetic fence language tagged onto untagged code blocks (plain fences and indented code)
/// while Find is open, so `Markdown::code_block_renderer` receives them without changing code text.
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

/// Each part's matches, counted by `count_part` over its rendered text model.
pub fn find_matches(
    parts: &[FindPart],
    pattern: Option<&FindPattern>,
    mut count_part: impl FnMut(&FindPart, &FindPattern) -> usize,
) -> Vec<FindMatch> {
    let Some(pattern) = pattern else { return Vec::new() };
    let mut matches = Vec::new();
    for part in parts {
        let count = count_part(part, pattern);
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
        let matches = find_matches(&parts, find_pattern("needle").as_ref(), |part, pattern| {
            find_ranges(&part.text, Some(pattern)).len()
        });
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
}
