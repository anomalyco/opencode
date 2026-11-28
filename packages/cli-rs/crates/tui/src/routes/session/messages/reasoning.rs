//! Expandable assistant reasoning.

use opencode_api::generated::{
    SessionMessageAssistant, SessionMessageAssistantContentItem, SessionMessageAssistantReasoning,
};
use opencode_ui::motion::Spinner;
use opentui::widget::Markdown;

use super::list::{Context, Switch};
use opencode_ui::locale::duration;

use crate::prelude::*;

pub struct Reasoning(Rc<Inner>);

struct Inner {
    app: App,
    theme: RefCell<Theme>,
    root: View,
    header: View,
    body: View,
    markdown: Markdown,
    state: RefCell<State>,
    expanded: Switch,
    hover: Cell<bool>,
    painted: RefCell<Painted>,
}

#[derive(Clone, Default, PartialEq)]
struct State {
    content: String,
    done: bool,
    duration: Option<String>,
    hide: bool,
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

enum Painted {
    None,
    Done(Vec<Text>),
    Thinking(Spinner),
}

impl Reasoning {
    pub fn new(cx: &Context<'_>) -> Self {
        let border = border(cx.theme);
        let header = View::new(cx.app).border(BorderStyle::Heavy).border_sides(Sides::NONE).border_color(border);
        let markdown =
            opencode_ui::markdown::view(cx.app, cx.theme, cx.thinking_syntax, cx.renderers, cx.conceal, true)
                .colors(colors(cx.theme));
        let body = View::new(cx.app)
            .margin_edge(Edge::Top, 1)
            .border(BorderStyle::Heavy)
            .border_sides(Sides::LEFT)
            .border_color(border)
            .child(&markdown);
        let root = View::new(cx.app).column().padding_edge(Edge::Left, 3).shrink(0.0).child(&header).child(&body);
        let inner = Rc::new(Inner {
            app: cx.app.clone(),
            theme: RefCell::new(cx.theme.clone()),
            root,
            header,
            body,
            markdown,
            state: RefCell::default(),
            expanded: cx.toggles.switch(),
            hover: Cell::new(false),
            painted: RefCell::new(Painted::None),
        });
        inner.header.on_click(bind!(inner, |inner, _, _| {
            if !inner.state.borrow().hide {
                return;
            }
            inner.expanded.flip();
            inner.layout();
        }));
        inner.header.on_hover(bind!(inner, |inner, _, hovered| {
            inner.header.mouse_pointer(opencode_ui::click_pointer(inner.state.borrow().hide));
            inner.hover.set(hovered);
            inner.layout();
        }));
        Self(inner)
    }

    pub fn root(&self) -> &View {
        &self.0.root
    }

    pub fn restyle(&self, cx: &Context<'_>) {
        let inner = &self.0;
        *inner.theme.borrow_mut() = cx.theme.clone();
        let border = border(cx.theme);
        inner.header.border_color(border);
        inner.body.border_color(border);
        opencode_ui::markdown::restyle(&inner.markdown, cx.theme, colors(cx.theme), cx.thinking_syntax);
        // The header recolors as on a hover, so a running spinner keeps its frame.
        inner.layout();
    }

    pub fn update(&self, cx: &Context<'_>, message: &SessionMessageAssistant, part: &SessionMessageAssistantReasoning) {
        // The part has no ID of its own: its place in the message names it.
        let place = message.content.iter().position(|item| {
            matches!(item, SessionMessageAssistantContentItem::Reasoning(reasoning) if std::ptr::eq(reasoning, part))
        });
        self.0.expanded.key(format!("reasoning {} {}", message.id, place.unwrap_or_default()));
        let content = content(part);
        let time = part.time.as_ref();
        let done = time.and_then(|time| time.completed).is_some() || message.time.completed.is_some();
        let end = time.and_then(|time| time.completed).or(message.time.completed);
        let start = time.map_or(message.time.created, |time| time.created);
        self.0.markdown.conceal(cx.conceal);
        let mut state = self.0.state.borrow_mut();
        // `ReasoningBody streaming={!isDone()}`: a finished thought's last line is final (#63989).
        if state.content.is_empty() || state.done != done {
            self.0.markdown.streaming(!done);
        }
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
    fn layout(&self) {
        let mut state = self.state.borrow_mut();
        self.root.visible(!state.content.is_empty());
        let open = !state.hide || self.expanded.get();
        self.header
            .border_sides(if open { Sides::LEFT } else { Sides::NONE })
            .padding_edge(Edge::Left, if open { 1 } else { 0 });
        self.body.visible(open);
        self.body.padding_edge(Edge::Left, if state.hide { 3 } else { 1 });
        let header = Header {
            done: state.done,
            open,
            toggleable: state.hide,
            title: (state.hide && !self.expanded.get()).then(|| summary(&state.content)).flatten(),
            duration: state.duration.clone(),
        };
        let theme = self.theme.borrow();
        let warning = theme.text.feedback.warning.base;
        let dim = warning.with_alpha(153);
        let fg = match (header.toggleable, header.done) {
            (false, _) => dim,
            (true, false) => theme.text.base,
            (true, true) if self.hover.get() || header.open => warning,
            (true, true) => dim,
        };
        // A hover only recolors: rebuilding would drop the widget a click is pressing.
        if state.header.as_ref() == Some(&header) {
            match &*self.painted.borrow() {
                Painted::Done(texts) => texts.iter().for_each(|text| {
                    text.fg(fg);
                }),
                Painted::Thinking(spinner) => spinner.set_color(fg),
                Painted::None => {}
            }
            return;
        }
        self.header.clear();
        if header.done {
            let row = View::new(&self.app).row();
            let mut texts = Vec::new();
            if header.toggleable {
                texts.push(Text::new(&self.app, if header.open { "-" } else { "+" }).width(2).shrink(0.0).fg(fg));
            }
            let mut text = "Thought".to_owned();
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
            texts.push(Text::new(&self.app, text).fg(fg).wrap(WrapMode::None));
            for text in &texts {
                row.add(text);
            }
            self.header.add(&row);
            *self.painted.borrow_mut() = Painted::Done(texts);
        } else {
            let label = match &header.title {
                Some(title) => format!("Thinking: {title}"),
                None => "Thinking".to_owned(),
            };
            let spinner = Spinner::new(&self.app).color(fg).label(label);
            self.header.add(&View::new(&self.app).row().child(&spinner));
            *self.painted.borrow_mut() = Painted::Thinking(spinner);
        }
        state.header = Some(header);
    }
}

fn border(theme: &Theme) -> Color {
    theme.decrease(&theme.background.base, 1)
}

fn colors(theme: &Theme) -> opentui::widget::MarkdownColors {
    opentui::widget::MarkdownColors { text: theme.text.muted, ..opencode_ui::markdown::colors(theme) }
}

/// `reasoningContent`: the text without OpenRouter's first `[REDACTED]` placeholder, trimmed.
pub(crate) fn content(part: &SessionMessageAssistantReasoning) -> String {
    part.text.replacen("[REDACTED]", "", 1).trim().to_owned()
}

pub(crate) fn summary(content: &str) -> Option<String> {
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
