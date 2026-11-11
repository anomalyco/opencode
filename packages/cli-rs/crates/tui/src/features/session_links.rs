//! Session IDs as links (`ui/session-link.ts`, `useSessionLinks`, #63224 and #63247): a Markdown that names another
//! session by ID shows it as `@<title>` (the ID itself when markers are shown) in `markup.link.url`, underlined, and
//! a plain click on it opens that session. The current session, archived sessions and sessions that cannot be loaded
//! stay plain IDs. When a title changes, only the blocks that mention that session are drawn again.
//!
//! The transcript's text parts, the compaction summary and the Markdown of plugin dialogs (the `/btw` answer) use
//! it, through [`attach`].

use std::cell::{Cell, RefCell};
use std::collections::{HashMap, HashSet};
use std::rc::{Rc, Weak};

use opencode_api::generated::SessionID;
use opencode_store::Changes;
use opencode_ui::bind;
use opentui::prelude::*;
use opentui::widget::{InlineContext, InlineSpan, Markdown};

use crate::app::Tui;
use crate::routes::Route;

/// A Markdown with session links. Its owner holds it; the TUI's [`Registry`] and the click handler hold it weakly.
pub struct Links {
    pub markdown: Markdown,
    /// The label each mentioned ID was last drawn with (`None`: plain), so a sync draws again only on a change.
    used: Rc<RefCell<HashMap<SessionID, Option<String>>>>,
    /// Where a plain left press went down, until its release.
    pressed: Cell<Option<(u16, u16)>>,
}

/// The TUI's linked Markdown documents, for label changes. Plugin dialogs own nothing that could hold theirs, so
/// those are kept here until they leave the screen.
#[derive(Default)]
pub struct Registry {
    links: RefCell<Vec<Weak<Links>>>,
    pinned: RefCell<Vec<Rc<Links>>>,
}

/// Makes `markdown` show session links: registers the inline hook and the click handler.
pub fn attach(tui: &Tui, markdown: &Markdown) -> Rc<Links> {
    let used: Rc<RefCell<HashMap<SessionID, Option<String>>>> = Rc::default();
    let links = Rc::new(Links { markdown: markdown.clone(), used: used.clone(), pressed: Cell::new(None) });
    let weak = tui.weak();
    markdown.inline_hook(move |spans, cx| match weak.upgrade() {
        Some(tui) => link_spans(&tui, &used, spans, cx),
        None => spans,
    });
    let (weak, this) = (tui.weak(), Rc::downgrade(&links));
    markdown.on_mouse(move |cx, event| {
        let (Some(tui), Some(links)) = (weak.upgrade(), this.upgrade()) else { return };
        if let Some(id) = links.clicked(&tui, event) {
            cx.stop_propagation();
            // The click runs inside the view the navigation replaces.
            tui.app.defer(bind!(tui, |tui, _| {
                if tui.dialogs.is_open() {
                    tui.dialogs.clear();
                }
                tui.navigate(Route::Session { id: SessionID(id) });
            }));
        }
    });
    let mut registered = tui.session_links.links.borrow_mut();
    registered.retain(|links| links.strong_count() > 0);
    registered.push(Rc::downgrade(&links));
    links
}

/// [`attach`] for a Markdown nothing else owns, such as one in a plugin dialog: kept until it leaves the screen.
pub fn pin(tui: &Tui, markdown: &Markdown) {
    let links = attach(tui, markdown);
    let mut pinned = tui.session_links.pinned.borrow_mut();
    pinned.retain(|links| shown(&tui.app, &links.markdown));
    pinned.push(links);
}

/// Draws again the blocks that mention a session whose label changed (#63247).
pub fn sync(tui: &Tui, changes: &Changes) {
    if !changes.all && changes.session.is_empty() {
        return;
    }
    tui.session_links.pinned.borrow_mut().retain(|links| shown(&tui.app, &links.markdown));
    let live: Vec<Rc<Links>> = tui.session_links.links.borrow().iter().filter_map(Weak::upgrade).collect();
    for links in live {
        let changed: HashSet<SessionID> = links
            .used
            .borrow_mut()
            .iter_mut()
            .filter(|(id, _)| changes.all || changes.session.contains(*id))
            .filter_map(|(id, used)| {
                let label = label_of(tui, id);
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

/// Whether a block's `source` mentions one of `sessions`: the blocks a label change draws again.
fn mentions_any(source: &str, sessions: &HashSet<SessionID>) -> bool {
    mentions(source).any(|mention| sessions.iter().any(|id| id.0 == mention.id(source)))
}

impl Links {
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

/// `linkChunks`: the spans of one paragraph or heading, with each linkable mention replaced by its link.
fn link_spans(
    tui: &Tui,
    used: &RefCell<HashMap<SessionID, Option<String>>>,
    spans: Vec<InlineSpan>,
    cx: &InlineContext<'_>,
) -> Vec<InlineSpan> {
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
            let label = label_of(tui, &id);
            // A label that differs from the one recorded stays recorded, so the next sync draws the other blocks
            // that show it again.
            used.borrow_mut().entry(id.clone()).or_insert_with(|| label.clone());
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

/// `span` with other text.
fn piece(span: &InlineSpan, text: &str) -> InlineSpan {
    let mut piece = span.clone();
    piece.span.content = text.to_owned().into();
    piece
}

/// `labelOf`: the label a link to `id` shows, or `None` to leave it plain: the current session, an archived one, and
/// one not loaded (which starts loading).
fn label_of(tui: &Tui, id: &SessionID) -> Option<String> {
    if tui.route() == (Route::Session { id: id.clone() }) {
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
    if label == Err(false) {
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

/// Whether `widget` is on the screen: its ancestors reach the root.
fn shown(app: &App, widget: &Markdown) -> bool {
    let mut top = widget.as_any();
    while let Some(parent) = top.parent() {
        top = parent;
    }
    top.id() == app.root().id()
}

/// One session mention: the byte range of its text, with the optional `@session:` prefix.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Mention {
    pub start: usize,
    pub end: usize,
}

impl Mention {
    /// The ID it names.
    pub fn id<'a>(&self, text: &'a str) -> &'a str {
        &text[self.end - ID_LEN..self.end]
    }
}

const PREFIX: &str = "@session:";
/// `ses_` and 26 letters or digits.
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
            let start = match at.checked_sub(PREFIX.len()) {
                Some(start) if &text[start..at] == PREFIX && before(start) => start,
                _ if before(at) => at,
                _ => continue,
            };
            from = end;
            return Some(Mention { start, end });
        }
        None
    })
}

/// `parseSessionMention`: the ID when `text` is exactly one mention.
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
    fn mentions_match_complete_ids_outside_words_paths_and_urls() {
        assert_eq!(KNOWN.len(), ID_LEN);
        let prefixed = format!("@session:{KNOWN}");
        assert_eq!(found(&format!("see {KNOWN}, ({prefixed}) and `{KNOWN}`.")), [KNOWN, &prefixed, KNOWN]);
        for text in [
            format!("x{KNOWN}"),
            format!("/{KNOWN}"),
            format!("a:{KNOWN}"),
            format!("@{KNOWN}"),
            format!("-{KNOWN}"),
            format!("_{KNOWN}"),
            format!("{KNOWN}x"),
            format!("{KNOWN}/"),
            format!("{KNOWN}-"),
            format!("{KNOWN}_"),
            format!("x@session:{KNOWN}"),
            format!("https://opencode.ai/s/{KNOWN}"),
            KNOWN[..ID_LEN - 1].to_owned(),
        ] {
            assert_eq!(found(&text), Vec::<&str>::new(), "{text}");
        }
        assert_eq!(found(&format!("中文{KNOWN}.")), [KNOWN]);
        assert_eq!(found(&format!("{KNOWN} {KNOWN}")), [KNOWN, KNOWN]);
        assert_eq!(mentions(&prefixed).next().map(|mention| mention.id(&prefixed)), Some(KNOWN));
    }

    #[test]
    fn a_code_span_is_a_mention_only_when_it_is_exactly_one() {
        assert_eq!(parse(strip_ticks(&format!("`{KNOWN}`"))), Some(KNOWN));
        assert_eq!(parse(strip_ticks(&format!("`` {KNOWN} ``"))), Some(KNOWN));
        assert_eq!(parse(strip_ticks(KNOWN)), Some(KNOWN));
        assert_eq!(parse(strip_ticks(&format!("`opencode --session {KNOWN}`"))), None);
        assert_eq!(parse(&format!("{KNOWN}.")), None);
    }

    #[test]
    fn a_label_change_selects_only_the_blocks_that_mention_the_session() {
        let other = format!("ses_{:0<26}", "other");
        let changed = HashSet::from([SessionID(KNOWN.to_owned())]);
        assert!(mentions_any(&format!("First {KNOWN}"), &changed));
        assert!(mentions_any(&format!("@session:{KNOWN} and {other}"), &changed));
        assert!(!mentions_any(&format!("Second {other}"), &changed));
        assert!(!mentions_any(&format!("x{KNOWN}"), &changed));
    }

    #[test]
    fn display_label_collapses_fallback_titles() {
        assert_eq!(display_label(Some("Fix the parser"), false), "Fix the parser");
        assert_eq!(display_label(Some("New session - 2026-03-01T12:00:00.000Z"), false), "New session");
        assert_eq!(display_label(Some("Child session - 2026-03-01T12:00:00.000Z"), true), "Child session");
        assert_eq!(display_label(Some("New session - today"), false), "New session - today");
        assert_eq!(display_label(None, false), "New session");
        assert_eq!(display_label(Some(""), true), "Child session");
    }
}
