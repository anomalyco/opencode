//! User messages (E.6a): `UserMessage` (`routes/session/index.tsx:2354-2479`). The text on a raised
//! surface behind a bar in the agent's color, its images (E.6b), then skill and file chips. A click
//! opens E.10b's pending steer or message actions dialog.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use opencode_api::generated::{PromptFileSource, SessionInboxDelivery, SessionMessageUser};
use opencode_ui::theme::ThemeMode;
use opentui::prelude::*;

use super::images::{self, Images};
use super::list::Context;

pub struct User {
    root: View,
    text: Text,
    skills: View,
    files: View,
    images: Images,
    color: Cell<Option<Color>>,
    rendered: RefCell<Option<SessionMessageUser>>,
    /// The message a click opens dialogs for.
    id: Rc<RefCell<String>>,
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
            .bg(raised)
            .shrink(0.0)
            .child(&text)
            .child(&skills)
            .child(&files);
        let hovered = theme.decrease(&theme.background.raised.base, 1);
        let target = body.clone();
        body.on_hover(move |_, hover| {
            target.bg(if hover { hovered } else { raised });
        });
        // A release (`onMouseUp`) opens the pending steer dialog for a prompt waiting to steer, else the message
        // actions (E.10b); a release that ends a text selection opens neither.
        let id = Rc::new(RefCell::new(String::new()));
        let (weak, session, clicked) = (cx.tui.weak(), cx.session.clone(), id.clone());
        body.on_mouse(move |_, event| {
            if event.kind != MouseEventKind::Up(MouseButton::Left) {
                return;
            }
            let Some(tui) = weak.upgrade() else { return };
            if tui.app.selected_text().is_some_and(|text| !text.is_empty()) {
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
            .child(&body);
        Self { root, text, skills, files, images, color: Cell::new(None), rendered: RefCell::default(), id }
    }

    pub fn root(&self) -> &View {
        &self.root
    }

    pub fn update(&self, cx: &Context<'_>, message: &SessionMessageUser) {
        message.id.0.clone_into(&mut self.id.borrow_mut());
        // The bar takes the session's agent color, which changes when the agents load; a prompt still in the inbox
        // takes the border color.
        let pending = crate::routes::session::queued::delivery(cx.state, cx.session, &message.id.0);
        let color = match pending {
            Some(_) => cx.theme.border.base,
            None => cx.agent_color(cx.session_agent.unwrap_or("build")),
        };
        if self.color.replace(Some(color)) != Some(color) {
            self.root.border_color(color);
        }
        if self.rendered.borrow().as_ref() == Some(message) {
            return;
        }
        let files = message.files.as_deref().unwrap_or_default();
        self.images.update(cx, images::user_images(files));
        let skills = message.skills.as_deref().unwrap_or_default();
        self.root.visible(!message.text.trim().is_empty() || !files.is_empty() || !skills.is_empty());
        self.text.set_text(message.text.as_str());

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
}

/// ` label ` on the accent, then ` name ` on a darker raised surface.
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
