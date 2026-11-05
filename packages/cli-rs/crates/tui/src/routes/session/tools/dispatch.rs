//! Tool dispatch (E.7a): `ToolPart` (`routes/session/index.tsx:2570-2649`) picks a view by the tool's
//! canonical name, and the shared rows the views are built from: `InlineTool` with `InlineToolRow`
//! (`index.tsx:2802-2871`, `message-parts.tsx:202-317`) and `BlockTool` (`index.tsx:2896-2978`).
//!
//! E.7b adds webfetch, websearch, subagent, execute, patch, todowrite, question, and skill.

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use opencode_api::generated::{
    SessionMessageAssistant, SessionMessageAssistantTool, SessionMessageAssistantToolState, ToolContent,
};
use opencode_ui::bind;
use opencode_ui::motion::Spinner;
use opencode_ui::theme::Theme;
use opencode_ui::tool_info::{canonical_tool_name, tool_display_content, tool_display_metadata};
use opentui::prelude::*;
use serde_json::{Map, Value};
use unicode_width::UnicodeWidthStr;

use super::{
    edit, execute, generic, glob, grep, patch, question, read, shell, skill, subagent, todo, webfetch, websearch, write,
};
use crate::dialogs::open::truncate_file_path;
use crate::routes::session::messages::images::{Images, tool_images};
use crate::routes::session::messages::list::Context;
use crate::routes::session::messages::shell::strip_ansi;
use crate::routes::session::permission;

/// `INLINE_TOOL_ICON_WIDTH`.
pub const ICON_WIDTH: u16 = 2;

/// A tool call's row: created once per call, updated whenever its message changes.
pub struct Tool {
    root: View,
    body: View,
    view: RefCell<Option<(&'static str, Body)>>,
    /// `ToolImages`: the call's image results under its row.
    images: Images,
}

enum Body {
    Shell(shell::Shell),
    Glob(glob::Glob),
    Read(read::Read),
    Grep(grep::Grep),
    Write(write::Write),
    Edit(edit::Edit),
    WebFetch(webfetch::WebFetch),
    WebSearch(websearch::WebSearch),
    Subagent(subagent::Subagent),
    Execute(execute::Execute),
    Patch(patch::Patch),
    Todo(todo::Todo),
    Question(question::Question),
    Skill(skill::Skill),
    Generic(generic::Generic),
}

impl Tool {
    pub fn new(cx: &Context<'_>) -> Self {
        let body = View::new(cx.app).column().shrink(0.0);
        let images = Images::new(cx, 3);
        let root = View::new(cx.app).column().shrink(0.0).child(&body).child(images.root());
        Self { root, body, view: RefCell::default(), images }
    }

    pub fn root(&self) -> &View {
        &self.root
    }

    pub fn update(&self, cx: &Context<'_>, _message: &SessionMessageAssistant, part: &SessionMessageAssistantTool) {
        let display = display(&part.name);
        let mut view = self.view.borrow_mut();
        if view.as_ref().is_none_or(|(current, _)| *current != display) {
            self.body.clear();
            let body = match display {
                "shell" => Body::Shell(shell::Shell::new(cx)),
                "glob" => Body::Glob(glob::Glob::new(cx)),
                "read" => Body::Read(read::Read::new(cx)),
                "grep" => Body::Grep(grep::Grep::new(cx)),
                "write" => Body::Write(write::Write::new(cx)),
                "edit" => Body::Edit(edit::Edit::new(cx)),
                "webfetch" => Body::WebFetch(webfetch::WebFetch::new(cx)),
                "websearch" => Body::WebSearch(websearch::WebSearch::new(cx)),
                "subagent" => Body::Subagent(subagent::Subagent::new(cx)),
                "execute" => Body::Execute(execute::Execute::new(cx)),
                "patch" => Body::Patch(patch::Patch::new(cx)),
                "todowrite" => Body::Todo(todo::Todo::new(cx)),
                "question" => Body::Question(question::Question::new(cx)),
                "skill" => Body::Skill(skill::Skill::new(cx)),
                _ => Body::Generic(generic::Generic::new(cx)),
            };
            self.body.add(match &body {
                Body::Shell(view) => view.root(),
                Body::Glob(view) => view.root(),
                Body::Read(view) => view.root(),
                Body::Grep(view) => view.root(),
                Body::Write(view) => view.root(),
                Body::Edit(view) => view.root(),
                Body::WebFetch(view) => view.root(),
                Body::WebSearch(view) => view.root(),
                Body::Subagent(view) => view.root(),
                Body::Execute(view) => view.root(),
                Body::Patch(view) => view.root(),
                Body::Todo(view) => view.root(),
                Body::Question(view) => view.root(),
                Body::Skill(view) => view.root(),
                Body::Generic(view) => view.root(),
            });
            *view = Some((display, body));
        }
        let props = Props::new(cx, part);
        match &view.as_ref().expect("tool view").1 {
            Body::Shell(view) => view.update(cx, &props),
            Body::Glob(view) => view.update(cx, &props),
            Body::Read(view) => view.update(cx, &props),
            Body::Grep(view) => view.update(cx, &props),
            Body::Write(view) => view.update(cx, &props),
            Body::Edit(view) => view.update(cx, &props),
            Body::WebFetch(view) => view.update(cx, &props),
            Body::WebSearch(view) => view.update(cx, &props),
            Body::Subagent(view) => view.update(cx, &props),
            Body::Execute(view) => view.update(cx, &props),
            Body::Patch(view) => view.update(cx, &props),
            Body::Todo(view) => view.update(cx, &props),
            Body::Question(view) => view.update(cx, &props),
            Body::Skill(view) => view.update(cx, &props),
            Body::Generic(view) => view.update(cx, &props),
        }
        self.images.update(cx, tool_images(part));
    }
}

/// `toolDisplay`: the view for a tool name.
fn display(name: &str) -> &'static str {
    match canonical_tool_name(name) {
        "shell" => "shell",
        "glob" => "glob",
        "read" => "read",
        "grep" => "grep",
        "webfetch" => "webfetch",
        "websearch" => "websearch",
        "write" => "write",
        "edit" => "edit",
        "subagent" => "subagent",
        "execute" => "execute",
        "patch" => "patch",
        "todowrite" => "todowrite",
        "question" => "question",
        "skill" => "skill",
        _ => "generic",
    }
}

/// `ToolProps`: what every view reads from the call.
pub struct Props<'a> {
    pub part: &'a SessionMessageAssistantTool,
    /// The input, or empty while it streams as text.
    pub input: Map<String, Value>,
    pub metadata: Map<String, Value>,
    /// The text of the content items, `None` while the input streams.
    pub output: Option<String>,
    /// The session's first permission request waits on this call (`useToolPermission`).
    pub permission: bool,
}

impl<'a> Props<'a> {
    fn new(cx: &Context<'_>, part: &'a SessionMessageAssistantTool) -> Self {
        let state = serde_json::to_value(&part.state).unwrap_or_default();
        let input = state.get("input").and_then(Value::as_object).cloned().unwrap_or_default();
        let streaming = matches!(part.state, SessionMessageAssistantToolState::Streaming(_));
        let output = (!streaming).then(|| {
            tool_display_content(&part.state)
                .iter()
                .filter_map(|content| match content {
                    ToolContent::Text(text) => Some(text.text.clone()),
                    ToolContent::File(file) => Some(file.name.clone().flatten().unwrap_or_else(|| file.uri.clone())),
                    ToolContent::Unknown(_) => None,
                })
                .collect::<Vec<_>>()
                .join("\n")
        });
        Self {
            part,
            input,
            metadata: tool_display_metadata(&part.state),
            output,
            permission: permission::tool_pending(cx.tui, cx.state, cx.session, &part.id),
        }
    }

    pub fn status(&self) -> Status {
        match &self.part.state {
            SessionMessageAssistantToolState::Streaming(_) => Status::Streaming,
            SessionMessageAssistantToolState::Running(_) => Status::Running,
            SessionMessageAssistantToolState::Completed(_) => Status::Completed,
            SessionMessageAssistantToolState::Error(_) => Status::Error,
            SessionMessageAssistantToolState::Unknown(_) => Status::Unknown,
        }
    }

    /// The error message of a failed call.
    pub fn error(&self) -> Option<&str> {
        match &self.part.state {
            SessionMessageAssistantToolState::Error(state) => Some(state.error.message.as_str()),
            _ => None,
        }
    }

    /// `stringValue(props.input[key])`.
    pub fn input_str(&self, key: &str) -> Option<&str> {
        self.input.get(key).and_then(Value::as_str)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Streaming,
    Running,
    Completed,
    Error,
    Unknown,
}

/// `usePathFormatter().format`: relative to the session's directory, with `~` for the home directory.
pub fn format_path(cx: &Context<'_>, input: Option<&str>) -> String {
    let cwd = std::env::current_dir().unwrap_or_default();
    let home = std::env::home_dir();
    opencode_ui::path::format(input.unwrap_or_default(), cx.directory, &cwd, home.as_deref())
}

/// The width tool rows lay out in (`ctx.width`).
pub fn content_width(cx: &Context<'_>) -> i64 {
    cx.content_width() as i64
}

/// A number as JavaScript prints it.
pub fn number(value: f64) -> String {
    opencode_api::query::js_string(&Value::from(value))
}

/// JavaScript truthiness.
pub fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) | Some(Value::Bool(false)) => false,
        Some(Value::Number(number)) => number.as_f64().is_some_and(|number| number != 0.0),
        Some(Value::String(text)) => !text.is_empty(),
        Some(_) => true,
    }
}

/// `finiteNumber(value)`, when it is not 0 (`finiteNumber(x) || …`).
pub fn finite(value: Option<&Value>) -> Option<f64> {
    value.and_then(opencode_ui::tool_info::finite_number).filter(|number| *number != 0.0)
}

/// What an [`InlineTool`] shows.
#[derive(Clone, Debug, PartialEq)]
pub struct Inline {
    pub icon: &'static str,
    /// The `color` prop: overrides every other color.
    pub color: Option<Color>,
    pub complete: bool,
    pub pending: String,
    pub spinner: bool,
    pub text: String,
    pub permission: bool,
    /// The call's error, unless it is still running.
    pub error: Option<String>,
    /// A click does something besides expanding the error.
    pub clickable: bool,
    /// The `status` prop: a [`status_badge`] after the text.
    pub badge: Option<String>,
    /// `onErrorClick`: a click on a failed call runs the click handler instead of expanding the error.
    pub error_click: bool,
}

impl Inline {
    pub fn new(props: &Props<'_>, icon: &'static str, pending: &str, complete: bool) -> Self {
        Self {
            icon,
            color: None,
            complete,
            pending: pending.to_owned(),
            spinner: false,
            text: String::new(),
            permission: props.permission,
            error: props.error().map(strip_ansi),
            clickable: false,
            badge: None,
            error_click: false,
        }
    }

    /// A denied call: rejected, ruled out, or dismissed by the user, drawn struck through.
    fn denied(&self) -> bool {
        self.error.as_deref().is_some_and(|error| {
            ["QuestionRejectedError", "rejected permission", "specified a rule", "user dismissed"]
                .iter()
                .any(|needle| error.contains(needle))
        })
    }

    fn failed(&self) -> bool {
        self.error.as_deref().is_some_and(|error| !error.is_empty()) && !self.denied()
    }
}

/// `InlineTool`: one line, `icon text` once complete, else a spinner with the pending label; a click
/// on a failed call shows its error.
pub struct InlineTool(Rc<InlineInner>);

struct InlineInner {
    app: App,
    theme: Theme,
    animations: bool,
    root: View,
    error: View,
    state: RefCell<Option<Inline>>,
    hover: Cell<bool>,
    expanded: Cell<bool>,
    painted: RefCell<Painted>,
    click: RefCell<Option<Rc<dyn Fn()>>>,
}

enum Painted {
    None,
    Spinner(Spinner),
    /// A bare spinner before the text and a badge.
    Labeled(Spinner, Text),
    /// The icon and the text.
    Row(Text, Text),
}

impl InlineTool {
    pub fn new(cx: &Context<'_>) -> Self {
        let error = View::new(cx.app).padding_edge(Edge::Left, ICON_WIDTH).visible(false);
        let root = View::new(cx.app).column().padding_edge(Edge::Left, 3).shrink(0.0);
        let inner = Rc::new(InlineInner {
            app: cx.app.clone(),
            theme: cx.theme.clone(),
            animations: cx.animations,
            root,
            error,
            state: RefCell::default(),
            hover: Cell::new(false),
            expanded: Cell::new(false),
            painted: RefCell::new(Painted::None),
            click: RefCell::default(),
        });
        inner.root.on_hover(bind!(inner, |inner, _, hovered| {
            let clickable = inner.state.borrow().as_ref().is_some_and(|state| state.clickable || state.failed());
            inner.root.mouse_pointer(opencode_ui::click_pointer(clickable));
            inner.hover.set(hovered && clickable);
            inner.recolor();
        }));
        inner.root.on_click(bind!(inner, |inner, cx, _| {
            if cx.app().selected_text().is_some_and(|text| !text.is_empty()) {
                return;
            }
            let (failed, error_click) =
                inner.state.borrow().as_ref().map_or((false, false), |state| (state.failed(), state.error_click));
            if failed && !error_click {
                inner.expanded.set(!inner.expanded.get());
                inner.paint_error();
                return;
            }
            let click = inner.click.borrow().clone();
            if let Some(click) = click {
                click();
            }
        }));
        Self(inner)
    }

    pub fn root(&self) -> &View {
        &self.0.root
    }

    /// What a click on a call that did not fail does.
    pub fn on_click(&self, click: impl Fn() + 'static) {
        *self.0.click.borrow_mut() = Some(Rc::new(click));
    }

    pub fn set(&self, inline: Inline) {
        let inner = &self.0;
        if inner.state.borrow().as_ref() == Some(&inline) {
            return;
        }
        inner.root.clear();
        let fg = inner.fg(&inline);
        let error_color = inner.theme.text.feedback.error.base;
        let badge = |app: &App| inline.badge.as_deref().map(|label| status_badge(app, &inner.theme, label, false));
        // `InlineToolLabel`: the text, then the badge, wrapping under it when the row is full.
        let label = |text: &Text, badge: Text| {
            View::new(&inner.app)
                .row()
                .flex_wrap(Wrap::Wrap)
                .column_gap(1)
                .grow(1.0)
                .child(&text.shrink(0.0).grow(0.0).max_width(Length::Percent(100.0)))
                .child(&badge)
        };
        let painted = if inline.spinner || !(inline.complete || inline.failed()) {
            let text = if inline.spinner { inline.text.clone() } else { inline.pending.clone() };
            let spinner = Spinner::new(&inner.app).color(fg).animations(inner.animations);
            match badge(&inner.app).filter(|_| inline.spinner) {
                Some(badge) => {
                    let text = Text::new(&inner.app, text).fg(fg);
                    inner.root.add(&View::new(&inner.app).row().gap(1).child(&spinner).child(&label(&text, badge)));
                    Painted::Labeled(spinner, text)
                }
                None => {
                    spinner.set_label(Some(text));
                    inner.root.add(&spinner);
                    Painted::Spinner(spinner)
                }
            }
        } else {
            let failed = inline.failed();
            let icon = Text::new(&inner.app, inline.icon).width(ICON_WIDTH).shrink(0.0).fg(if failed {
                error_color
            } else {
                fg
            });
            let text = Text::new(&inner.app, inline.text.clone()).grow(1.0).fg(if failed { error_color } else { fg });
            if inline.denied() {
                icon.strikethrough();
                text.strikethrough();
            }
            let row = View::new(&inner.app).row().child(&icon);
            match badge(&inner.app) {
                Some(badge) => row.add(&label(&text, badge)),
                None => row.add(&text),
            };
            inner.root.add(&row);
            Painted::Row(icon, text)
        };
        inner.root.add(&inner.error);
        *inner.painted.borrow_mut() = painted;
        *inner.state.borrow_mut() = Some(inline);
        inner.paint_error();
    }
}

impl InlineInner {
    fn fg(&self, state: &Inline) -> Color {
        if let Some(color) = state.color {
            return color;
        }
        if state.permission {
            return self.theme.text.feedback.warning.base;
        }
        if state.failed() {
            return self.theme.text.feedback.error.base;
        }
        if self.hover.get() && state.clickable {
            return self.theme.text.base;
        }
        self.theme.text.muted
    }

    /// Hover only recolors: rebuilding would drop the widget a click is pressing.
    fn recolor(&self) {
        let state = self.state.borrow();
        let Some(state) = state.as_ref() else { return };
        let fg = self.fg(state);
        match &*self.painted.borrow() {
            Painted::Spinner(spinner) => spinner.set_color(fg),
            Painted::Labeled(spinner, text) => {
                spinner.set_color(fg);
                text.fg(fg);
            }
            Painted::Row(icon, text) if !state.failed() => {
                icon.fg(fg);
                text.fg(fg);
            }
            _ => {}
        }
    }

    fn paint_error(&self) {
        let state = self.state.borrow();
        let error =
            state.as_ref().filter(|state| state.failed() && self.expanded.get()).and_then(|state| state.error.clone());
        self.error.clear();
        self.error.visible(error.is_some());
        if let Some(error) = error {
            self.error.add(&Text::new(&self.app, error).fg(self.theme.text.feedback.error.base));
        }
    }
}

/// `BlockTool`'s header: a title, or a label and a path.
#[derive(Clone, Debug, PartialEq)]
pub enum Header {
    None,
    Title(String),
    Path { label: String, value: String },
}

/// What a [`BlockTool`] shows besides its children.
#[derive(Clone, Debug, PartialEq)]
pub struct Block {
    pub header: Header,
    pub spinner: bool,
    pub permission: bool,
    pub error: Option<String>,
    pub clickable: bool,
    /// [`content_width`], which bounds the path.
    pub width: i64,
}

/// `BlockTool`'s `headerColor` and `errorColor`: overrides of the muted header and the error color.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct BlockColors {
    pub header: Option<Color>,
    pub error: Option<Color>,
}

/// `BlockTool`: a raised panel with a left rule, a header, the view's children, and the error.
pub struct BlockTool(Rc<BlockInner>);

struct BlockInner {
    app: App,
    theme: Theme,
    animations: bool,
    root: View,
    header: View,
    /// The view's children, with the panel's gap between them.
    children: View,
    error: Text,
    state: RefCell<Option<Block>>,
    colors: Cell<BlockColors>,
    hover: Cell<bool>,
    click: RefCell<Option<Rc<dyn Fn()>>>,
}

impl BlockTool {
    pub fn new(cx: &Context<'_>) -> Self {
        let theme = cx.theme;
        let header = View::new(cx.app).row().gap(1).min_width(0).visible(false);
        let children = View::new(cx.app).column().gap(1).visible(false);
        let error = Text::new(cx.app, "").fg(theme.text.feedback.error.base).visible(false);
        let root = View::new(cx.app)
            .column()
            .shrink(0.0)
            .gap(1)
            .border(BorderStyle::Heavy)
            .border_sides(Sides::LEFT)
            .border_color(theme.background.base)
            .padding_edge(Edge::Top, 1)
            .padding_edge(Edge::Bottom, 1)
            .padding_edge(Edge::Left, 2)
            .bg(theme.background.raised.base)
            .child(&header)
            .child(&children)
            .child(&error);
        let inner = Rc::new(BlockInner {
            app: cx.app.clone(),
            theme: theme.clone(),
            animations: cx.animations,
            root,
            header,
            children,
            error,
            state: RefCell::default(),
            colors: Cell::default(),
            hover: Cell::new(false),
            click: RefCell::default(),
        });
        inner.root.on_hover(bind!(inner, |inner, _, hovered| {
            let clickable = inner.state.borrow().as_ref().is_some_and(|state| state.clickable);
            inner.root.mouse_pointer(opencode_ui::click_pointer(clickable));
            inner.hover.set(hovered && clickable);
            // `decrease` finds the token by reference, so it takes the theme's own field.
            let raised = &inner.theme.background.raised.base;
            inner.root.bg(if inner.hover.get() { inner.theme.decrease(raised, 1) } else { *raised });
        }));
        inner.root.on_click(bind!(inner, |inner, cx, _| {
            if cx.app().selected_text().is_some_and(|text| !text.is_empty()) {
                return;
            }
            let clickable = inner.state.borrow().as_ref().is_some_and(|state| state.clickable);
            let click = inner.click.borrow().clone();
            if let (true, Some(click)) = (clickable, click) {
                click();
            }
        }));
        Self(inner)
    }

    pub fn root(&self) -> &View {
        &self.0.root
    }

    /// The column the view adds its children to.
    pub fn children(&self) -> &View {
        &self.0.children
    }

    pub fn on_click(&self, click: impl Fn() + 'static) {
        *self.0.click.borrow_mut() = Some(Rc::new(click));
    }

    /// Sets the header and error colors the next [`BlockTool::set`] paints with.
    pub fn colors(&self, colors: BlockColors) {
        if self.0.colors.replace(colors) != colors {
            self.0.state.take();
        }
    }

    /// Shows the children column when it has a visible child (an empty one would add a gap).
    pub fn show_children(&self, visible: bool) {
        self.0.children.visible(visible);
    }

    pub fn set(&self, block: Block) {
        let inner = &self.0;
        if inner.state.borrow().as_ref() == Some(&block) {
            return;
        }
        let theme = &inner.theme;
        let raised = &theme.background.raised.base;
        if !block.clickable {
            inner.hover.set(false);
        }
        inner.root.bg(if inner.hover.get() { theme.decrease(raised, 1) } else { *raised });
        let colors = inner.colors.get();
        let spinner_fg = if block.permission { theme.text.feedback.warning.base } else { theme.text.muted };
        let fg =
            if block.permission { theme.text.feedback.warning.base } else { colors.header.unwrap_or(theme.text.muted) };
        let spinner = |label: &str| {
            Spinner::new(&inner.app)
                .color(spinner_fg)
                .label(label.strip_prefix("# ").unwrap_or(label))
                .animations(inner.animations)
        };
        inner.header.clear();
        inner.header.visible(block.header != Header::None);
        match &block.header {
            Header::None => {}
            Header::Title(title) if block.spinner => {
                inner.header.add(&spinner(title));
            }
            Header::Title(title) => {
                inner.header.add(&Text::new(&inner.app, title.clone()).fg(fg));
            }
            Header::Path { label, value } => {
                if block.spinner {
                    inner.header.add(&spinner(label).shrink(0.0));
                } else {
                    inner.header.add(&Text::new(&inner.app, label.clone()).shrink(0.0).fg(fg));
                }
                let max = (block.width - 4 - label.width() as i64 - if block.spinner { 2 } else { 0 }).max(2);
                inner.header.add(
                    &Text::new(&inner.app, truncate_file_path(value, max)).fg(fg).wrap(WrapMode::None).truncate(true),
                );
            }
        }
        let error = block.error.as_deref().map(strip_ansi).unwrap_or_default();
        inner.error.visible(!error.is_empty());
        inner.error.fg(colors.error.unwrap_or(theme.text.feedback.error.base));
        inner.error.set_text(error);
        *inner.state.borrow_mut() = Some(block);
    }
}

/// `StatusBadge`: a padded label on a darker background.
pub fn status_badge(app: &App, theme: &Theme, label: &str, raised: bool) -> Text {
    // `decrease` finds the token by reference, so this borrows the theme's own field.
    let background = if raised { &theme.background.raised.base } else { &theme.background.base };
    Text::new(app, format!(" {label} ")).shrink(0.0).bg(theme.decrease(background, 1)).fg(theme.text.muted)
}
