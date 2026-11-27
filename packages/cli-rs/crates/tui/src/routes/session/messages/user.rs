//! User prompts, attachments, and mention chips.

use std::sync::LazyLock;

use opencode_api::generated::{PromptFileSource, SessionInboxDelivery, SessionMessageUser};
use opencode_ui::theme::ThemeMode;
use regex::Regex;

use super::super::find::{FindMatch, FindPartKey, find_ranges, paint_spans, wrapped_row};
use super::images::{self, Images};
use super::list::Context;

use crate::prelude::*;

#[derive(PartialEq)]
struct UserFind {
    pattern_key: String,
    current: Option<usize>,
    colors: (Color, Color, Color),
}

pub struct User {
    root: View,
    text: Text,
    skills: View,
    files: View,
    images: Images,
    color: Cell<Option<Color>>,
    rendered: RefCell<Option<SessionMessageUser>>,
    find_applied: Cell<bool>,
    find_state: RefCell<Option<UserFind>>,
    hover: Rc<Cell<bool>>,
    id: Rc<RefCell<String>>,
    /// The box its hover handler restyles. The handler holds it weakly: a widget whose handler holds the widget
    /// is never freed.
    _body: Rc<View>,
}

impl User {
    pub fn new(cx: &Context<'_>) -> Self {
        let theme = cx.theme;
        let raised = theme.background.raised.base;
        let text = Text::new(cx.app, "").fg(theme.text.base).wrap(WrapMode::Word);
        let chips = || View::new(cx.app).row().flex_wrap(Wrap::Wrap).gap(1).padding_edge(Edge::Top, 1).visible(false);
        let (skills, files) = (chips(), chips());
        let body = View::new(cx.app)
            .column()
            .padding_edge(Edge::Top, 1)
            .padding_edge(Edge::Bottom, 1)
            .padding_edge(Edge::Left, 2)
            .padding_edge(Edge::Right, 2)
            .bg(raised)
            .shrink(0.0)
            .child(&text)
            .child(&skills)
            .child(&files);
        let body = Rc::new(body);
        let (live, hover) = (cx.tui.live_theme(), Rc::new(Cell::new(false)));
        let hovering = hover.clone();
        body.on_hover(bind!(body, |body, _, hovered| {
            hovering.set(hovered);
            paint_body(&body, &live.get(), hovered);
        }));
        // A release ending a selection must not open message actions.
        let id = Rc::new(RefCell::new(String::new()));
        let (weak, session, clicked) = (cx.tui.weak(), cx.session.clone(), id.clone());
        body.mouse_pointer(MousePointer::POINTER).on_mouse(move |_, event| {
            if event.kind != MouseEventKind::Up(MouseButton::Left) {
                return;
            }
            let Some(tui) = weak.upgrade() else { return };
            if tui.app.selected_text().is_some_and(|text| !text.is_empty()) {
                return;
            }
            // The app opens the clicked link.
            if crate::features::links::link_at(&tui.app, event.x, event.y).is_some() {
                return;
            }
            let message = clicked.borrow().clone();
            let delivery = tui.data.read(|state| crate::routes::session::queued::delivery(state, &session, &message));
            if delivery == Some(SessionInboxDelivery::Steer) {
                crate::dialogs::pending_steer::show(&tui, session.clone(), message);
                return;
            }
            crate::dialogs::message::show(&tui, session.clone(), message);
        });
        let images = Images::new(cx, 2);
        let root = View::new(cx.app)
            .column()
            .border(BorderStyle::Heavy)
            .border_sides(Sides::LEFT)
            .bg(raised)
            .child(images.root())
            .child(&*body);
        Self {
            root,
            text,
            skills,
            files,
            images,
            color: Cell::new(None),
            rendered: RefCell::default(),
            find_applied: Cell::new(false),
            find_state: RefCell::default(),
            hover,
            id,
            _body: body,
        }
    }

    pub fn root(&self) -> &View {
        &self.root
    }

    pub fn restyle(&self, cx: &Context<'_>) {
        let raised = cx.theme.background.raised.base;
        self.text.fg(cx.theme.text.base);
        self.root.bg(raised);
        paint_body(&self._body, cx.theme, self.hover.get());
        self.color.set(None);
        self.rendered.take();
        self.find_state.take();
        self.images.restyle(cx.theme);
    }

    pub fn update(&self, cx: &Context<'_>, message: &SessionMessageUser) {
        message.id.0.clone_into(&mut self.id.borrow_mut());
        let pending = crate::routes::session::queued::delivery(cx.state, cx.session, &message.id.0);
        let color = match pending {
            Some(_) => cx.theme.border.base,
            None => cx.agent_color(cx.session_agent.unwrap_or("build")),
        };
        if self.color.replace(Some(color)) != Some(color) {
            self.root.border_color(color);
        }
        if self.rendered.borrow().as_ref() == Some(message) {
            self.update_find(cx, message);
            return;
        }
        let files = message.files.as_deref().unwrap_or_default();
        self.images.update(cx, images::user_images(files));
        let skills = message.skills.as_deref().unwrap_or_default();
        self.root.visible(!message.text.trim().is_empty() || !files.is_empty() || !skills.is_empty());
        self.find_state.take();
        if cx.find.is_some() {
            self.paint_find(cx, message);
        } else {
            self.find_applied.set(false);
            self.text.set_text(linked(&message.text, cx.theme.markdown.link));
        }

        self.skills.clear();
        self.skills.visible(!skills.is_empty());
        for skill in skills {
            self.skills.add(&chip(cx, "skill", skill.name.as_str()));
        }
        self.files.clear();
        self.files.visible(!files.is_empty());
        for file in files {
            let label = if file.mime == "application/x-directory" { "dir" } else { "file" };
            let name = match (&file.name, &file.source) {
                (Some(name), _) => name.as_str(),
                (None, PromptFileSource::Uri(source)) => source.uri.as_str(),
                (None, _) => "attachment",
            };
            self.files.add(&chip(cx, label, name));
        }
        *self.rendered.borrow_mut() = Some(message.clone());
    }

    pub fn update_find(&self, cx: &Context<'_>, message: &SessionMessageUser) {
        if cx.find.is_none() && !self.find_applied.get() {
            return;
        }
        self.paint_find(cx, message);
    }

    fn paint_find(&self, cx: &Context<'_>, message: &SessionMessageUser) {
        let Some(active) = cx.find else {
            if self.find_applied.replace(false) {
                self.find_state.take();
                self.text.set_text(linked(&message.text, cx.theme.markdown.link));
            }
            return;
        };
        let key = FindPartKey::message(&message.id.0);
        let current = active.current_occurrence(&key);
        let colors = (cx.theme.find.text.current, cx.theme.find.background.r#match, cx.theme.find.background.current);
        let next = UserFind { pattern_key: active.pattern.key.clone(), current, colors };
        if self.find_applied.get() && self.find_state.borrow().as_ref() == Some(&next) {
            return;
        }
        let ranges = find_ranges(&message.text, Some(&active.pattern));
        let spans = paint_spans(linked(&message.text, cx.theme.markdown.link), &ranges, 0, current, cx.theme);
        self.text.set_text(spans);
        self.find_applied.set(true);
        *self.find_state.borrow_mut() = Some(next);
        if let Some(occurrence) = current
            && let Some(range) = ranges.get(occurrence)
        {
            let widget = self.text.downgrade();
            let text = message.text.clone();
            let offset = range.start;
            active.located(FindMatch { key, occurrence }, move || {
                let widget = widget.upgrade()?;
                let rect = widget.rect();
                (rect.height > 0.0).then(|| rect.screen_y + f64::from(wrapped_row(&text, offset, rect.width as u16)))
            });
        }
    }
}

/// The prompt as written, with its http(s) URLs as links, split like the web app's linked text.
fn linked(text: &str, link: Color) -> Vec<Span<'static>> {
    static URL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"https?://[^\s<>"'`]+"#).expect("valid regex"));
    let mut spans = Vec::new();
    let mut last = 0;
    for found in URL.find_iter(text) {
        // Sentence punctuation and closing brackets after a URL are almost never part of it.
        let href = found.as_str().trim_end_matches([')', ',', '.', ';', ':', '!', '?', ']']);
        if opencode_api::js::parse_url(href).is_err() {
            continue;
        }
        if found.start() > last {
            spans.push(Span::raw(text[last..found.start()].to_owned()));
        }
        spans.push(Span::styled(href.to_owned(), Style::new().fg(link).underline()).link(href.to_owned()));
        last = found.start() + href.len();
    }
    if last < text.len() {
        spans.push(Span::raw(text[last..].to_owned()));
    }
    spans
}

fn paint_body(body: &View, theme: &Theme, hover: bool) {
    let raised = &theme.background.raised.base;
    body.bg(if hover { theme.decrease(raised, 1) } else { *raised });
}

fn chip(cx: &Context<'_>, label: &str, name: &str) -> Text {
    let theme = cx.theme;
    let accent = theme.accent().step(if cx.mode == ThemeMode::Light { 300 } else { 200 });
    Text::new(
        cx.app,
        vec![
            Span::styled(format!(" {label} "), Style::new().bg(accent).fg(theme.background.raised.base).bold()),
            Span::styled(
                format!(" {name} "),
                Style::new().bg(theme.decrease(&theme.background.raised.base, 1)).fg(theme.text.muted),
            ),
        ],
    )
    .fg(theme.text.base)
}
