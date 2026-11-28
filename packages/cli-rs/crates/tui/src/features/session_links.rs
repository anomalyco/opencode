//! Link known, unarchived session IDs in transcript text, compaction summaries, and `/btw` answers. Title changes
//! invalidate only blocks that mention the session.

use std::collections::HashSet;

use opencode_ui::markdown::CodeBlockRenderers;
use opentui::widget::{InlineContext, InlineSpan, Markdown};

use crate::prelude::*;

/// A Markdown with session links. Its owner holds it; the TUI's [`Registry`] and the click handler hold it weakly.
pub struct Links {
    pub markdown: Markdown,
    /// Last rendered label by ID; `None` denotes an unlinked ID.
    used: Rc<RefCell<HashMap<SessionID, Option<String>>>>,
    /// Where a plain left press went down, until its release.
    pressed: Cell<Option<(u16, u16)>>,
}

#[derive(Default)]
pub struct Registry {
    links: RefCell<Vec<Weak<Links>>>,
}

/// Makes `markdown`, a view made with `renderers`, show session links: registers the inline hook, after the inline
/// math renderer's, and the click handler.
pub fn attach(tui: &Tui, markdown: &Markdown, renderers: &CodeBlockRenderers) -> Rc<Links> {
    let used: Rc<RefCell<HashMap<SessionID, Option<String>>>> = Rc::default();
    let links = Rc::new(Links { markdown: markdown.clone(), used: used.clone(), pressed: Cell::new(None) });
    let weak = tui.weak();
    opencode_ui::markdown::inline_hook(markdown, renderers, move |spans, cx| match weak.upgrade() {
        Some(tui) => link_spans(&tui, Some(&used), spans, cx),
        None => spans,
    });
    let (weak, this) = (tui.weak(), Rc::downgrade(&links));
    markdown.on_mouse(move |cx, event| {
        let (Some(tui), Some(links)) = (weak.upgrade(), this.upgrade()) else { return };
        if let Some(id) = links.clicked(&tui, event) {
            cx.stop_propagation();
            tui.app.defer(bind!(tui, |tui, _| {
                if tui.dialogs.is_open() {
                    tui.dialogs.clear();
                }
                tui.show_session(SessionID(id));
            }));
        }
    });
    let mut registered = tui.session_links.links.borrow_mut();
    registered.retain(|links| links.strong_count() > 0);
    registered.push(Rc::downgrade(&links));
    links
}

pub fn sync(tui: &Tui, changes: &Changes) {
    if !changes.any(Touched::INFO) {
        return;
    }
    let live: Vec<Rc<Links>> = tui.session_links.links.borrow().iter().filter_map(Weak::upgrade).collect();
    for links in live {
        let changed: HashSet<SessionID> = links
            .used
            .borrow_mut()
            .iter_mut()
            .filter(|(id, _)| changes.has(id, Touched::INFO))
            .filter_map(|(id, used)| {
                let label = label_of(tui, id, true);
                (*used != label).then(|| {
                    *used = label;
                    id.clone()
                })
            })
            .collect();
        if changed.is_empty() {
            continue;
        }
        links.markdown.rerun_inline_hook(|source| mentions_any(source, &changed));
    }
}

fn mentions_any(source: &str, sessions: &HashSet<SessionID>) -> bool {
    mentions(source).any(|mention| sessions.iter().any(|id| id.0 == mention.id(source)))
}

/// Transforms inline Markdown spans to link known session IDs without recording or triggering
/// fetches, for unmounted Markdown inspection.
pub fn transform_readonly(tui: &Tui, spans: Vec<InlineSpan>, cx: &InlineContext<'_>) -> Vec<InlineSpan> {
    link_spans(tui, None, spans, cx)
}

impl Links {
    /// Transforms inline Markdown spans to link known session IDs, using this instance's tracked IDs.
    pub fn transform(&self, tui: &Tui, spans: Vec<InlineSpan>, cx: &InlineContext<'_>) -> Vec<InlineSpan> {
        link_spans(tui, Some(&self.used), spans, cx)
    }

    /// The session a plain left click opens: a press and a release on the same cell, without a modifier or selected
    /// text (the [`crate::features::links`] rules), on a link the last frame drew.
    fn clicked(&self, tui: &Tui, event: &MouseEvent) -> Option<String> {
        let plain = [Modifiers::CTRL, Modifiers::ALT, Modifiers::SHIFT]
            .into_iter()
            .all(|modifier| !event.modifiers.contains(modifier));
        match event.kind {
            MouseEventKind::Down(MouseButton::Left) => self.pressed.set(plain.then_some((event.x, event.y))),
            MouseEventKind::Drag(_) => self.pressed.set(None),
            MouseEventKind::Up(MouseButton::Left) => {
                let click = self.pressed.take() == Some((event.x, event.y)) && plain;
                if click && tui.app.selected_text().is_none() {
                    return self.markdown.target_at(event.x, event.y);
                }
            }
            _ => {}
        }
        None
    }
}

fn link_spans(
    tui: &Tui,
    used: Option<&RefCell<HashMap<SessionID, Option<String>>>>,
    spans: Vec<InlineSpan>,
    cx: &InlineContext<'_>,
) -> Vec<InlineSpan> {
    // Table cells bypass the chunk callback and keep literal IDs.
    if cx.table_cell {
        return spans;
    }
    let url = cx.syntax.merge(["markup.link.url"]);
    let mut out = Vec::with_capacity(spans.len());
    for span in spans {
        let text = span.span.content.as_ref();
        // Like the web app, a code span links only when it is exactly a session ID, so a command such as
        // `opencode --session ses_…` stays copyable.
        let plain = span.span.link.is_some() || (span.code && parse(strip_ticks(text)).is_none());
        if plain || !text.contains("ses_") {
            out.push(span);
            continue;
        }
        let mut last = 0;
        for mention in mentions(text) {
            let id = SessionID(mention.id(text).to_owned());
            let label = label_of(tui, &id, used.is_some());
            // A label that differs from the one recorded stays recorded, so the next sync draws the other blocks
            // that show it again.
            if let Some(used) = used {
                used.borrow_mut().entry(id.clone()).or_insert_with(|| label.clone());
            }
            let Some(label) = label else { continue };
            if last < mention.start {
                out.push(piece(&span, &text[last..mention.start]));
            }
            let shown = if cx.conceal { format!("@{label}") } else { text[mention.start..mention.end].to_owned() };
            let mut link = piece(&span, &shown);
            link.span.style = Style {
                fg: url.fg.or(span.span.style.fg),
                attributes: url.attributes.union(Attributes::UNDERLINE),
                ..span.span.style
            };
            link.target = Some(id.0);
            out.push(link);
            last = mention.end;
        }
        match last {
            0 => out.push(span),
            last if last < text.len() => out.push(piece(&span, &text[last..])),
            _ => {}
        }
    }
    out
}

fn piece(span: &InlineSpan, text: &str) -> InlineSpan {
    let mut piece = span.clone();
    piece.span.content = text.to_owned().into();
    piece
}

fn label_of(tui: &Tui, id: &SessionID, fetch: bool) -> Option<String> {
    if *tui.route() == (Route::Session { id: id.clone() }) {
        return None;
    }
    let label = tui.data.read(|state| match state.session(id) {
        Some(session) => Ok(session
            .time
            .archived
            .is_none()
            .then(|| display_label(session.title.as_deref(), session.parent_id.is_some()))),
        None => Err(state.is_missing(id)),
    });
    if fetch && label == Err(false) {
        // Reads dedupe in-flight and finished loads; a miss marks the session missing. Hooks can run under a store
        // read, which must not write.
        let id = id.clone();
        tui.app
            .defer(bind!(tui, |tui, _| crate::routes::session::form::quiet(&tui, tui.data.session_sync(&id, false))));
    }
    label.ok().flatten()
}

/// `displayLabel`: the title, or the kind of session for a missing or timestamped fallback title.
pub fn display_label(title: Option<&str>, child: bool) -> String {
    match title {
        Some(title) if !title.is_empty() && !crate::features::title::is_fallback(title) => title.to_owned(),
        Some(title) if !title.is_empty() => title.split(" - ").next().unwrap_or(title).to_owned(),
        _ if child => "Child session".to_owned(),
        _ => "New session".to_owned(),
    }
}

/// One session mention: the byte range of its text, with the optional `@session:` prefix.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Mention {
    pub start: usize,
    pub end: usize,
}

impl Mention {
    pub fn id<'a>(&self, text: &'a str) -> &'a str {
        &text[self.end - ID_LEN..self.end]
    }
}

const PREFIX: &str = "@session:";
const ID_LEN: usize = 30;

/// `sessionMentions` (`@opencode/util/session-mention`): complete generated IDs, optionally after `@session:`, not
/// inside a word, path or URL: `(?<![\w/:@-])(?:@session:)?(ses_[A-Za-z0-9]{26})(?![\w/-])`.
pub fn mentions(text: &str) -> impl Iterator<Item = Mention> + '_ {
    let bytes = text.as_bytes();
    // `\w` without the `u` flag is ASCII only.
    let word = |byte: &u8| byte.is_ascii_alphanumeric() || *byte == b'_';
    let before =
        move |at: usize| at == 0 || !(word(&bytes[at - 1]) || matches!(bytes[at - 1], b'/' | b':' | b'@' | b'-'));
    let mut from = 0;
    std::iter::from_fn(move || {
        while let Some(found) = text[from..].find("ses_") {
            let at = from + found;
            from = at + 4;
            let end = at + ID_LEN;
            let suffix = bytes.get(at + 4..end).is_some_and(|suffix| suffix.iter().all(u8::is_ascii_alphanumeric));
            let after = bytes.get(end).is_none_or(|next| !(word(next) || matches!(next, b'/' | b'-')));
            if !suffix || !after {
                continue;
            }
            // `strip_suffix`, not a slice nine bytes back, which can land inside a multibyte character.
            let start = match text[..at].strip_suffix(PREFIX).map(str::len) {
                Some(start) if before(start) => start,
                _ if before(at) => at,
                _ => continue,
            };
            from = end;
            return Some(Mention { start, end });
        }
        None
    })
}

pub fn parse(text: &str) -> Option<&str> {
    mentions(text)
        .next()
        .filter(|mention| mention.start == 0 && mention.end == text.len())
        .map(|mention| mention.id(text))
}

/// A code span's text without its backticks and the space beside them (`/^`+\s?|\s?`+$/g`).
fn strip_ticks(text: &str) -> &str {
    let text = match text.trim_start_matches('`') {
        rest if rest.len() < text.len() => rest.strip_prefix(char::is_whitespace).unwrap_or(rest),
        rest => rest,
    };
    match text.trim_end_matches('`') {
        rest if rest.len() < text.len() => rest.strip_suffix(char::is_whitespace).unwrap_or(rest),
        rest => rest,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const KNOWN: &str = "ses_knownknownknownknownknownk";

    fn found(text: &str) -> Vec<&str> {
        mentions(text).map(|mention| &text[mention.start..mention.end]).collect()
    }

    #[test]
    fn standalone_mentions_survive_unicode_and_reject_word_and_path_contexts() {
        let prefixed = format!("@session:{KNOWN}");
        for shown in [KNOWN, &prefixed] {
            for left in ["", "see ", "(", "`", "中文", "现abcd文", "é", "e\\u{301}", "🙂"] {
                for right in ["", ".", ")", "`", "中文", "\\u{301}", "🙂"] {
                    let text = format!("{left}{shown}{right}");
                    assert_eq!(found(&text), [shown], "{text}");
                    assert_eq!(mentions(&text).next().unwrap().id(&text), KNOWN);
                }
            }
            for prefix in ["x", "/", "a:", "@", "-", "_", "https://example.com/s/", "文x"] {
                assert!(found(&format!("{prefix}{shown}")).is_empty(), "{prefix}{shown}");
            }
            for suffix in ["x", "/", "-", "_"] {
                assert!(found(&format!("{shown}{suffix}")).is_empty(), "{shown}{suffix}");
            }
            assert_eq!(found(&format!("{shown}文{shown}")), [shown, shown]);
        }
        for prefix in ["session:", "@session", "@Session:"] {
            assert!(found(&format!("文{prefix}{KNOWN}")).is_empty());
        }
        assert!(found(&KNOWN[..KNOWN.len() - 1]).is_empty());
        assert!(found(&KNOWN.to_uppercase()).is_empty());
        assert!(found(&format!("{KNOWN}{KNOWN}")).is_empty());
        assert_eq!(found(&format!("{KNOWN}{prefixed}:{KNOWN}")), [KNOWN]);
    }

    #[test]
    fn mentions_never_panic_on_mixed_scripts() {
        // A seeded walk over pieces that put every byte offset of every width next to an ID and its prefix.
        let pieces = ["a", "_", ":", "@", "-", "/", " ", "现", "é", "\u{301}", "🙂", "@session:", "ses_", KNOWN];
        let mut seed = 0x9e37_79b9_7f4a_7c15_u64;
        let mut next = move || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed as usize
        };
        for _ in 0..20_000 {
            let text: String = (0..next() % 12).map(|_| pieces[next() % pieces.len()]).collect();
            for mention in mentions(&text) {
                let shown = text.get(mention.start..mention.end);
                assert!(shown.is_some_and(|shown| shown.strip_prefix(PREFIX).unwrap_or(shown) == KNOWN), "{text}");
            }
        }
    }
}
