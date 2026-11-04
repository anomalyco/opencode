//! Reasoning blocks (E.6a): `ReasoningPart` and `ReasoningHeader` (`message-parts.tsx:43-171`).
//! With `session.thinking: hide` a block is one header line that a click opens and closes.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use opencode_api::generated::{SessionMessageAssistant, SessionMessageAssistantReasoning};
use opencode_ui::motion::Spinner;
use opencode_ui::theme::Theme;
use opentui::prelude::*;
use opentui::widget::Markdown;

use super::footer::duration;
use super::list::Context;

pub struct Reasoning(Rc<Inner>);

struct Inner {
    app: App,
    theme: Theme,
    root: View,
    header: View,
    body: View,
    markdown: Markdown,
    state: RefCell<State>,
    expanded: Cell<bool>,
    animations: bool,
}

#[derive(Clone, Default, PartialEq)]
struct State {
    content: String,
    done: bool,
    duration: Option<String>,
    hide: bool,
    /// The header that is mounted: its open, toggleable, and title inputs.
    header: Option<Header>,
}

#[derive(Clone, PartialEq)]
struct Header {
    done: bool,
    open: bool,
    toggleable: bool,
    title: Option<String>,
    duration: Option<String>,
}

impl Reasoning {
    pub fn new(cx: &Context<'_>) -> Self {
        let border = cx.theme.decrease(&cx.theme.background.base, 1);
        let header = View::new(cx.app)
            .border(BorderStyle::Heavy)
            .border_sides(Sides::NONE)
            .border_color(border);
        let markdown = opencode_ui::markdown::view(
            cx.app,
            cx.theme,
            cx.thinking_syntax,
            cx.renderers,
            cx.conceal,
            true,
        )
        .colors(opentui::widget::MarkdownColors {
            text: cx.theme.text.muted,
            ..opencode_ui::markdown::colors(cx.theme)
        });
        let body = View::new(cx.app)
            .margin_edge(Edge::Top, 1)
            .border(BorderStyle::Heavy)
            .border_sides(Sides::LEFT)
            .border_color(border)
            .child(&markdown);
        let root = View::new(cx.app)
            .column()
            .padding_edge(Edge::Left, 3)
            .shrink(0.0)
            .child(&header)
            .child(&body);
        let inner = Rc::new(Inner {
            app: cx.app.clone(),
            theme: cx.theme.clone(),
            root,
            header,
            body,
            markdown,
            state: RefCell::default(),
            expanded: Cell::new(false),
            animations: cx.animations,
        });
        let weak = Rc::downgrade(&inner);
        inner.header.on_click(move |_, _| {
            let Some(inner) = weak.upgrade() else { return };
            if !inner.state.borrow().hide {
                return;
            }
            inner.expanded.set(!inner.expanded.get());
            inner.layout();
        });
        Self(inner)
    }

    pub fn root(&self) -> &View {
        &self.0.root
    }

    pub fn update(
        &self,
        cx: &Context<'_>,
        message: &SessionMessageAssistant,
        part: &SessionMessageAssistantReasoning,
    ) {
        let content = content(part);
        let time = part.time.as_ref();
        let done =
            time.and_then(|time| time.completed).is_some() || message.time.completed.is_some();
        let end = time
            .and_then(|time| time.completed)
            .or(message.time.completed);
        let start = time.map_or(message.time.created, |time| time.created);
        let mut state = self.0.state.borrow_mut();
        if state.content != content {
            self.0.markdown.set_markdown(content.as_str());
            state.content = content;
        }
        state.done = done;
        state.duration = done.then(|| duration(end.map_or(0.0, |end| (end - start).max(0.0))));
        state.hide = cx.hide_thinking;
        drop(state);
        self.0.layout();
    }
}

impl Inner {
    /// Shows the header and body for the current state and the expanded flag.
    fn layout(&self) {
        let mut state = self.state.borrow_mut();
        self.root.visible(!state.content.is_empty());
        let open = !state.hide || self.expanded.get();
        self.header
            .border_sides(if open { Sides::LEFT } else { Sides::NONE })
            .padding_edge(Edge::Left, if open { 1 } else { 0 });
        self.body.visible(open);
        self.body
            .padding_edge(Edge::Left, if state.hide { 3 } else { 1 });
        let header = Header {
            done: state.done,
            open,
            toggleable: state.hide,
            title: (state.hide && !self.expanded.get())
                .then(|| summary(&state.content))
                .flatten(),
            duration: state.duration.clone(),
        };
        if state.header.as_ref() == Some(&header) {
            return;
        }
        self.header.clear();
        let warning = self.theme.text.feedback.warning.base;
        // Open blocks dim the header to 60% (`RGBA.fromValues(…, 0.6)`).
        let fg = if open {
            warning.with_alpha(153)
        } else {
            warning
        };
        if header.done {
            let mut text = String::new();
            if header.toggleable {
                text.push_str(if header.open { "- " } else { "+ " });
            }
            text.push_str("Thought");
            if header.title.is_some() || header.duration.is_some() {
                text.push_str(": ");
            }
            if let Some(title) = &header.title {
                text.push_str(title);
            }
            if let Some(duration) = &header.duration {
                if header.title.is_some() {
                    text.push_str(" · ");
                }
                text.push_str(duration);
            }
            self.header
                .add(&Text::new(&self.app, text).fg(fg).wrap(WrapMode::None));
        } else {
            let label = match &header.title {
                Some(title) => format!("Thinking: {title}"),
                None => "Thinking".to_owned(),
            };
            let spinner = Spinner::new(&self.app)
                .color(fg)
                .label(label)
                .animations(self.animations);
            self.header.add(&View::new(&self.app).row().child(&spinner));
        }
        state.header = Some(header);
    }
}

/// `reasoningContent`: the text without OpenRouter's first `[REDACTED]` placeholder, trimmed.
fn content(part: &SessionMessageAssistantReasoning) -> String {
    part.text.replacen("[REDACTED]", "", 1).trim().to_owned()
}

/// The bold title block a reasoning summary starts with (`reasoningSummary`):
/// `**Title**` followed by a blank line or the end.
fn summary(content: &str) -> Option<String> {
    let rest = content.trim().strip_prefix("**")?;
    let end = rest.find(['*', '\n'])?;
    let after = rest[end..].strip_prefix("**")?;
    if end == 0 {
        return None;
    }
    let closed = after.is_empty()
        || after.starts_with("\n\n")
        || after.starts_with("\r\n\r\n")
        || after.starts_with("\n\r\n")
        || after.starts_with("\r\n\n");
    closed.then(|| rest[..end].trim().to_owned())
}

#[cfg(test)]
mod tests {
    use super::summary;

    #[test]
    fn summary_takes_a_leading_bold_block() {
        assert_eq!(
            summary("**Inspecting PR workflow**\n\nbody").as_deref(),
            Some("Inspecting PR workflow")
        );
        assert_eq!(summary("**Done**").as_deref(), Some("Done"));
        assert_eq!(summary("**Title** and more"), None);
        assert_eq!(summary("**Title**\nbody"), None);
        assert_eq!(summary("plain"), None);
        assert_eq!(summary("****\n\n"), None);
    }
}
