//! User messages (E.6a): `UserMessage` (`routes/session/index.tsx:2354-2479`). The text on a raised
//! surface behind a bar in the agent's color, then skill and file chips. Images (V16) are E.6b's,
//! and the pending-steer and message dialogs are E.10b's and DLG38's.

use std::cell::{Cell, RefCell};

use opencode_api::generated::{PromptFileSource, SessionMessageUser};
use opencode_ui::theme::ThemeMode;
use opentui::prelude::*;

use super::list::Context;

pub struct User {
    root: View,
    text: Text,
    skills: View,
    files: View,
    color: Cell<Option<Color>>,
    rendered: RefCell<Option<SessionMessageUser>>,
}

impl User {
    pub fn new(cx: &Context<'_>) -> Self {
        let theme = cx.theme;
        let raised = theme.background.raised.base;
        let text = Text::new(cx.app, "")
            .fg(theme.text.base)
            .wrap(WrapMode::Word);
        let chips = || {
            View::new(cx.app)
                .row()
                .flex_wrap(Wrap::Wrap)
                .gap(1)
                .padding_edge(Edge::Top, 1)
                .visible(false)
        };
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
        let root = View::new(cx.app)
            .column()
            .border(BorderStyle::Heavy)
            .border_sides(Sides::LEFT)
            .bg(raised)
            .child(&body);
        Self {
            root,
            text,
            skills,
            files,
            color: Cell::new(None),
            rendered: RefCell::default(),
        }
    }

    pub fn root(&self) -> &View {
        &self.root
    }

    pub fn update(&self, cx: &Context<'_>, message: &SessionMessageUser) {
        // The bar takes the session's agent color, which changes when the agents load.
        let color = cx.agent_color(cx.session_agent.unwrap_or("build"));
        if self.color.replace(Some(color)) != Some(color) {
            self.root.border_color(color);
        }
        if self.rendered.borrow().as_ref() == Some(message) {
            return;
        }
        let files = message.files.as_deref().unwrap_or_default();
        let skills = message.skills.as_deref().unwrap_or_default();
        self.root
            .visible(!message.text.trim().is_empty() || !files.is_empty() || !skills.is_empty());
        self.text.set_text(message.text.as_str());

        self.skills.clear();
        self.skills.visible(!skills.is_empty());
        for skill in skills {
            self.skills.add(&chip(cx, "skill", skill.name.as_str()));
        }
        self.files.clear();
        self.files.visible(!files.is_empty());
        for file in files {
            let label = if file.mime == "application/x-directory" {
                "dir"
            } else {
                "file"
            };
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
    let accent = theme.accent().step(if cx.mode == ThemeMode::Light {
        300
    } else {
        200
    });
    Text::new(
        cx.app,
        vec![
            Span::styled(
                format!(" {label} "),
                Style::new()
                    .bg(accent)
                    .fg(theme.background.raised.base)
                    .bold(),
            ),
            Span::styled(
                format!(" {name} "),
                Style::new()
                    .bg(theme.decrease(&theme.background.raised.base, 1))
                    .fg(theme.text.muted),
            ),
        ],
    )
    .fg(theme.text.base)
}
