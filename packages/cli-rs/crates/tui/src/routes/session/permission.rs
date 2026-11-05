//! The permission prompt (E.9a, row V17): `routes/session/permission.tsx`, `util/permission.ts`,
//! `context/permission.tsx`, and the session route's permission parts (`routes/session/index.tsx:207-283`,
//! `:1615-1622`).
//!
//! The session route owns one [`Permission`] in the region above the prompt. A root session prompts for the
//! first pending request of itself and its descendants; a child session prompts for none. The prompt hides the
//! session prompt while it shows. Ctrl+F (`permission.prompt.fullscreen`) moves it to a full-screen overlay. In
//! `autoaccept` mode (`session.permissions` in `cli.json`, or `--auto`) every request is answered `once`
//! instead.

use std::cell::{Cell, RefCell};
use std::collections::HashSet;
use std::rc::{Rc, Weak};

use opencode_api::generated::{
    PermissionID, PermissionReply, PermissionReplyInput, PermissionRequest, SessionID,
    SessionMessageAssistantContentItem, SessionMessageInfo,
};
use opencode_local::cli_config::{DiffView as ConfigDiffView, Permissions};
use opencode_store::{Changes, State};
use opencode_ui::keymap::{Bind, KeymapLayer, TuiCommand};
pub use opencode_ui::permission::{Presentation, always_lines, presentation};
use opencode_ui::theme::Theme;
use opentui::keymap::Disposer;
use opentui::prelude::*;
use opentui::widget::{DiffView, Textarea};
use serde_json::Value;

use crate::app::Tui;

const FULLSCREEN: &str = "permission.prompt.fullscreen";

pub struct Permission(Rc<Inner>);

struct Inner {
    tui: Weak<Tui>,
    session: SessionID,
    region: View,
    /// The full-screen host, above the route and below dialogs.
    overlay: View,
    prompted: RefCell<Prompted>,
    layer: RefCell<Option<Disposer>>,
    reject: RefCell<Option<Textarea>>,
    /// Sessions whose pending permissions were read since the last full sync.
    synced: RefCell<HashSet<SessionID>>,
    /// Requests answered by `autoaccept`.
    approved: RefCell<HashSet<PermissionID>>,
    resize: Cell<Option<HandlerId>>,
}

#[derive(Default)]
struct Prompted {
    request: Option<PermissionRequest>,
    stage: Stage,
    selected: usize,
    expanded: bool,
}

#[derive(Clone, Copy, Default, PartialEq, Eq)]
enum Stage {
    #[default]
    Permission,
    Reject,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Choice {
    Once,
    Always,
    Reject,
}

impl Choice {
    /// `permissionOptionLabel`.
    fn label(self) -> &'static str {
        match self {
            Choice::Once => "Allow once",
            Choice::Always => "Always allow",
            Choice::Reject => "Reject",
        }
    }
}

impl Permission {
    pub fn new(tui: &Tui, session: &SessionID) -> Self {
        let overlay = View::new(&tui.app)
            .absolute()
            .position(Edge::Top, 0)
            .position(Edge::Left, 0)
            .position(Edge::Right, 0)
            .position(Edge::Bottom, 0)
            .z_index(2000)
            .visible(false);
        tui.app.root().add(&overlay);
        let inner = Rc::new(Inner {
            tui: tui.weak(),
            session: session.clone(),
            region: View::new(&tui.app).column().shrink(0.0),
            overlay,
            prompted: RefCell::default(),
            layer: RefCell::default(),
            reject: RefCell::default(),
            synced: RefCell::default(),
            approved: RefCell::default(),
            resize: Cell::new(None),
        });
        let weak = Rc::downgrade(&inner);
        inner.resize.set(Some(tui.app.on_resize(move |_, _, _| {
            if let Some(inner) = weak.upgrade()
                && inner.prompted.borrow().stage == Stage::Permission
            {
                inner.render();
            }
        })));
        Self(inner)
    }

    pub fn root(&self) -> &View {
        &self.0.region
    }

    /// Whether a request is prompted; the session prompt hides meanwhile.
    pub fn active(&self) -> bool {
        self.0.prompted.borrow().request.is_some()
    }

    pub fn sync(&self, tui: &Tui, changes: &Changes) {
        let inner = &self.0;
        let (requests, family) = tui.data.read(|state| {
            let family = family(state, &inner.session);
            let requests: Vec<PermissionRequest> = family
                .iter()
                .flat_map(|id| state.permissions(id).unwrap_or_default())
                .cloned()
                .collect();
            (requests, family)
        });
        // A full sync (a reconnect) reads again: the store invalidated what it read before.
        if changes.all {
            inner.synced.borrow_mut().clear();
        }
        for id in family {
            if inner.synced.borrow_mut().insert(id.clone()) {
                // TS ignores failures (`routes/session/index.tsx:333-347`): a session still being
                // created reads as not found.
                super::form::quiet(tui, tui.data.permission_sync(&id));
            }
        }
        if tui.config().permissions == Permissions::Autoaccept {
            inner.auto_approve(tui, &requests);
            return;
        }
        let head = requests.into_iter().next();
        let current = inner
            .prompted
            .borrow()
            .request
            .as_ref()
            .map(|r| r.id.clone());
        if head.as_ref().map(|r| &r.id) != current.as_ref() {
            *inner.prompted.borrow_mut() = Prompted {
                request: head,
                ..Prompted::default()
            };
            inner.stage_changed();
            return;
        }
        // The presentation reads the tool call's input, which may still be arriving.
        let stage = inner.prompted.borrow().stage;
        if let Some(request) = head
            && stage == Stage::Permission
            && changes.any_message(&request.session_id)
        {
            inner.prompted.borrow_mut().request = Some(request);
            inner.render();
        }
    }
}

impl Drop for Permission {
    fn drop(&mut self) {
        let inner = &self.0;
        inner.overlay.detach();
        let Some(tui) = inner.tui.upgrade() else {
            return;
        };
        super::form::dispose_later(&tui.app, inner.layer.take().into_iter().collect());
        if let Some(id) = inner.resize.take() {
            tui.app.remove_handler(id);
        }
    }
}

/// `useToolPermission`: whether the tool call `part` waits on the session's first pending request, so the
/// transcript draws it in the warning color. It takes the store's state, since the transcript asks while
/// it reads the store.
pub fn tool_pending(tui: &Tui, state: &State, session: &SessionID, part: &str) -> bool {
    if tui.config().permissions == Permissions::Autoaccept {
        return false;
    }
    state
        .permissions(session)
        .and_then(<[_]>::first)
        .and_then(|request| request.source.as_ref())
        .is_some_and(|source| source.r#type == "tool" && source.id == part)
}

/// The sessions whose requests a session prompts for: a root and its descendants, a child none.
fn family(state: &State, session: &SessionID) -> Vec<SessionID> {
    if state
        .session(session)
        .is_some_and(|info| info.parent_id.is_some())
    {
        return Vec::new();
    }
    std::iter::once(session.clone())
        .chain(
            state
                .family(session)
                .iter()
                .filter(|id| *id != session)
                .cloned(),
        )
        .collect()
}

impl Inner {
    fn auto_approve(self: &Rc<Self>, tui: &Tui, requests: &[PermissionRequest]) {
        for request in requests {
            if !self.approved.borrow_mut().insert(request.id.clone()) {
                continue;
            }
            let weak = Rc::downgrade(self);
            let id = request.id.clone();
            reply(
                tui,
                request,
                PermissionReply::Once,
                None,
                Box::new(move || {
                    if let Some(inner) = weak.upgrade() {
                        inner.approved.borrow_mut().remove(&id);
                    }
                }),
            );
        }
    }

    fn choices(&self) -> Vec<Choice> {
        let prompted = self.prompted.borrow();
        let save = prompted
            .request
            .as_ref()
            .and_then(|request| request.save.as_ref())
            .is_some_and(|save| !save.is_empty());
        if save {
            return vec![Choice::Once, Choice::Always, Choice::Reject];
        }
        vec![Choice::Once, Choice::Reject]
    }

    /// Registers the stage's keys and draws it.
    fn stage_changed(self: &Rc<Self>) {
        self.reject.take();
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        super::form::dispose_later(&tui.app, self.layer.take().into_iter().collect());
        let stage = self.prompted.borrow().stage;
        let prompting = self.prompted.borrow().request.is_some();
        if prompting {
            let layer = match stage {
                Stage::Permission => self.question_layer(),
                Stage::Reject => self.reject_layer(),
            };
            match tui.keymap.layer(layer) {
                Ok(disposer) => *self.layer.borrow_mut() = Some(disposer),
                Err(error) => log::error!("permission keymap layer: {error}"),
            }
            // The session prompt hides; it must not keep the keys.
            tui.app.blur();
        }
        self.render();
        if let Some(field) = self.reject.borrow().as_ref() {
            field.focus();
        }
    }

    /// `SessionQuestion`'s layer.
    fn question_layer(self: &Rc<Self>) -> KeymapLayer<u32> {
        let run = |action: fn(&Rc<Inner>)| {
            let weak = Rc::downgrade(self);
            move |_: Option<&str>, _: Option<&KeyEvent>| {
                if let Some(inner) = weak.upgrade() {
                    action(&inner);
                }
            }
        };
        let mut commands = vec![
            TuiCommand::new("app.exit", run(Inner::dismiss))
                .title("Reject permission")
                .group("Permission")
                .bind(Bind::Off),
            TuiCommand::new(FULLSCREEN, run(Inner::toggle_fullscreen))
                .title("Toggle permission fullscreen")
                .group("Permission")
                .bind(Bind::Off),
        ];
        if self.choices().len() > 1 {
            commands.push(
                TuiCommand::inline("left,h", run(|inner| inner.move_selection(-1)))
                    .title("Previous option")
                    .group("Permission"),
            );
            commands.push(
                TuiCommand::inline("right,l", run(|inner| inner.move_selection(1)))
                    .title("Next option")
                    .group("Permission"),
            );
        }
        commands.push(
            TuiCommand::inline(
                "return",
                run(|inner| {
                    let selected = inner.prompted.borrow().selected;
                    inner.select(inner.choices()[selected]);
                }),
            )
            .title("Select option")
            .group("Permission"),
        );
        commands.push(
            TuiCommand::inline("escape", run(Inner::dismiss))
                .title("Reject permission")
                .group("Permission"),
        );
        KeymapLayer {
            commands,
            bindings: vec!["app.exit".to_owned(), FULLSCREEN.to_owned()],
            ..KeymapLayer::default()
        }
    }

    /// `RejectPrompt`'s layer.
    fn reject_layer(self: &Rc<Self>) -> KeymapLayer<u32> {
        let exit = Rc::downgrade(self);
        let escape = Rc::downgrade(self);
        let confirm = Rc::downgrade(self);
        KeymapLayer {
            commands: vec![
                TuiCommand::new("app.exit", move |_, event: Option<&KeyEvent>| {
                    let Some(inner) = exit.upgrade() else { return };
                    let ctrl_c = event.is_some_and(|event| event.matches("ctrl+c"));
                    let field = inner.reject.borrow().clone();
                    if let Some(field) = field.filter(|field| ctrl_c && !field.text().is_empty()) {
                        field.set_text("");
                        return;
                    }
                    inner.cancel_reject();
                })
                .title("Cancel permission rejection")
                .group("Permission"),
                TuiCommand::inline("escape", move |_, _| {
                    if let Some(inner) = escape.upgrade() {
                        inner.cancel_reject();
                    }
                })
                .title("Cancel permission rejection")
                .group("Permission"),
                TuiCommand::inline("return", move |_, _| {
                    if let Some(inner) = confirm.upgrade() {
                        inner.confirm_reject();
                    }
                })
                .title("Confirm permission rejection")
                .group("Permission"),
            ],
            ..KeymapLayer::default()
        }
    }

    fn dismiss(self: &Rc<Self>) {
        if self.prompted.borrow().expanded {
            self.prompted.borrow_mut().expanded = false;
            self.render();
            return;
        }
        self.select(Choice::Reject);
    }

    fn toggle_fullscreen(self: &Rc<Self>) {
        {
            let mut prompted = self.prompted.borrow_mut();
            prompted.expanded = !prompted.expanded;
        }
        self.render();
    }

    fn move_selection(self: &Rc<Self>, by: isize) {
        let count = self.choices().len() as isize;
        {
            let mut prompted = self.prompted.borrow_mut();
            prompted.selected = (prompted.selected as isize + by).rem_euclid(count) as usize;
        }
        self.render();
    }

    fn select(self: &Rc<Self>, choice: Choice) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        let Some(request) = self.prompted.borrow().request.clone() else {
            return;
        };
        let decision = match choice {
            Choice::Once => PermissionReply::Once,
            Choice::Always => PermissionReply::Always,
            Choice::Reject => {
                // A subagent's request asks what to do differently.
                let child = tui.data.read(|state| {
                    state
                        .session(&request.session_id)
                        .is_some_and(|info| info.parent_id.is_some())
                });
                if child {
                    self.prompted.borrow_mut().stage = Stage::Reject;
                    self.stage_changed();
                    return;
                }
                PermissionReply::Reject
            }
        };
        reply(&tui, &request, decision, None, Box::new(|| {}));
    }

    /// Back to the question, which starts over as TS remounts it.
    fn cancel_reject(self: &Rc<Self>) {
        let mut prompted = self.prompted.borrow_mut();
        prompted.stage = Stage::Permission;
        prompted.selected = 0;
        prompted.expanded = false;
        drop(prompted);
        self.stage_changed();
    }

    fn confirm_reject(self: &Rc<Self>) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        let Some(request) = self.prompted.borrow().request.clone() else {
            return;
        };
        let message = self
            .reject
            .borrow()
            .as_ref()
            .map(Textarea::text)
            .filter(|text| !text.is_empty());
        reply(
            &tui,
            &request,
            PermissionReply::Reject,
            message,
            Box::new(|| {}),
        );
    }

    fn render(self: &Rc<Self>) {
        self.region.clear();
        self.overlay.clear();
        self.overlay.visible(false);
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        let prompted = self.prompted.borrow();
        let Some(request) = prompted.request.clone() else {
            return;
        };
        let theme = tui.page();
        let narrow = tui.app.size().0 < 80;
        if prompted.stage == Stage::Reject {
            let (view, field) = self.reject_view(&tui, &theme, narrow);
            self.region.add(&view);
            *self.reject.borrow_mut() = Some(field);
            tui.app.request_redraw();
            return;
        }
        let choices = self.choices();
        let selected = choices[prompted.selected.min(choices.len() - 1)];
        let expanded = prompted.expanded;
        drop(prompted);
        let view = self.question_view(&tui, &theme, &request, &choices, selected, narrow);
        if expanded {
            // TS sets `top: -height + 1` from the region at the bottom of the screen, which keeps the first row.
            view.absolute()
                .position(Edge::Top, 1)
                .position(Edge::Bottom, 1)
                .position(Edge::Left, 2)
                .position(Edge::Right, 2);
            self.overlay.add(&view);
            self.overlay.visible(true);
        } else {
            self.region.add(&view.max_height(15));
        }
        tui.app.request_redraw();
    }

    fn question_view(
        self: &Rc<Self>,
        tui: &Tui,
        theme: &Theme,
        request: &PermissionRequest,
        choices: &[Choice],
        selected: Choice,
        narrow: bool,
    ) -> View {
        let app = &tui.app;
        let current = tui.data.read(|state| {
            let (input, metadata) = source(state, request);
            let directory = state
                .session(&request.session_id)
                .map(|info| info.location.directory.0.clone());
            let cwd = std::env::current_dir().unwrap_or_default();
            let home = std::env::home_dir();
            presentation(
                &request.action,
                &request.resources,
                request.metadata.as_ref(),
                &input,
                &metadata,
                &|path| {
                    opencode_ui::path::format(path, directory.as_deref(), &cwd, home.as_deref())
                },
            )
        });

        let title_row = View::new(app)
            .row()
            .gap(1)
            .shrink(0.0)
            .child(&Text::new(app, "△").fg(theme.text.feedback.warning.base))
            .child(&Text::new(app, "Permission required").fg(theme.text.base));
        let header = View::new(app).column().child(&title_row);
        if request.action != "shell" && !current.title.is_empty() {
            header.add(
                &View::new(app)
                    .row()
                    .gap(1)
                    .padding_edge(Edge::Left, 2)
                    .shrink(0.0)
                    .child(
                        &Text::new(app, current.icon)
                            .fg(theme.text.muted)
                            .shrink(0.0),
                    )
                    .child(&Text::new(app, current.title.clone()).fg(theme.text.base)),
            );
        }
        let body = if selected == Choice::Always {
            lines_view(
                app,
                &always_lines(&request.action, request.save.as_deref().unwrap_or_default()),
                |index| {
                    if index == 0 {
                        theme.text.muted
                    } else {
                        theme.text.base
                    }
                },
            )
        } else {
            presentation_body(tui, theme, request, &current)
        };
        let content = View::new(app)
            .column()
            .gap(1)
            .padding_edge(Edge::Left, 1)
            .padding_edge(Edge::Right, 3)
            .padding_edge(Edge::Top, 1)
            .padding_edge(Edge::Bottom, 1)
            .grow(1.0)
            .basis(Length::Auto)
            .min_height(0)
            .child(
                &View::new(app)
                    .padding_edge(Edge::Left, 1)
                    .shrink(0.0)
                    .child(&header),
            )
            .child(&body);

        let actions = View::new(app).row().gap(1).shrink(0.0);
        for (index, choice) in choices.iter().copied().enumerate() {
            let focused = choice == selected;
            let option = View::new(app)
                .padding_x(1)
                .bg(if focused {
                    theme.background.action.primary.focused
                } else {
                    theme.background.action.primary.base
                })
                .child(&Text::new(app, choice.label()).fg(if focused {
                    theme.text.action.primary.focused
                } else {
                    theme.text.action.primary.base
                }));
            let hover = Rc::downgrade(self);
            option.on_hover(move |_, over| {
                let Some(inner) = hover.upgrade() else { return };
                if over && inner.prompted.borrow().selected != index {
                    inner.prompted.borrow_mut().selected = index;
                    inner.render();
                }
            });
            let click = Rc::downgrade(self);
            option.on_click(move |_, _| {
                if let Some(inner) = click.upgrade() {
                    inner.prompted.borrow_mut().selected = index;
                    inner.select(choice);
                }
            });
            actions.add(&option);
        }
        let hints = View::new(app).row().gap(2).shrink(0.0);
        let expanded = self.prompted.borrow().expanded;
        if let Some(key) = tui.keymap.shortcut(FULLSCREEN) {
            hints.add(&hint(
                app,
                theme,
                &key,
                if expanded { "minimize" } else { "fullscreen" },
            ));
        }
        if choices.len() > 1 {
            hints.add(&hint(app, theme, "⇆", "select"));
        }
        hints.add(&hint(app, theme, "enter", "confirm"));

        View::new(app)
            .column()
            .bg(theme.background.raised.base)
            .border(BorderStyle::Heavy)
            .border_sides(Sides::LEFT)
            .border_color(theme.background.action.primary.focused)
            .child(&content)
            .child(&footer(app, theme, narrow).child(&actions).child(&hints))
    }

    fn reject_view(self: &Rc<Self>, tui: &Tui, theme: &Theme, narrow: bool) -> (View, Textarea) {
        let app = &tui.app;
        let heading = View::new(app)
            .column()
            .gap(1)
            .padding_edge(Edge::Left, 1)
            .padding_edge(Edge::Right, 3)
            .padding_edge(Edge::Top, 1)
            .padding_edge(Edge::Bottom, 1)
            .child(
                &View::new(app)
                    .row()
                    .gap(1)
                    .padding_edge(Edge::Left, 1)
                    .child(&Text::new(app, "△").fg(theme.text.feedback.error.base))
                    .child(&Text::new(app, "Reject permission").fg(theme.text.base)),
            )
            .child(&View::new(app).padding_edge(Edge::Left, 1).child(
                &Text::new(app, "Tell OpenCode what to do differently").fg(theme.text.muted),
            ));
        let field = Textarea::new(app)
            .mouse_pointer(MousePointer::DEFAULT)
            .grow(1.0)
            .basis(Length::Auto)
            .min_width(1)
            .colors(theme.text.base, Color::TRANSPARENT)
            .focused_colors(theme.text.base, Color::TRANSPARENT)
            .cursor_color(theme.text.base);
        let confirm = hint(app, theme, "enter", "confirm");
        let weak = Rc::downgrade(self);
        confirm.on_click(move |_, _| {
            if let Some(inner) = weak.upgrade() {
                inner.confirm_reject();
            }
        });
        let cancel = hint(app, theme, "esc", "cancel");
        let weak = Rc::downgrade(self);
        cancel.on_click(move |_, _| {
            if let Some(inner) = weak.upgrade() {
                inner.cancel_reject();
            }
        });
        let actions = View::new(app)
            .row()
            .gap(2)
            .shrink(0.0)
            .child(&confirm)
            .child(&cancel);
        let view = View::new(app)
            .column()
            .bg(theme.background.raised.base)
            .border(BorderStyle::Heavy)
            .border_sides(Sides::LEFT)
            .border_color(theme.text.feedback.error.base)
            .child(&heading)
            .child(&footer(app, theme, narrow).child(&field).child(&actions));
        (view, field)
    }
}

/// Sends the reply; the store drops the request once the server took it. A failure shows as a toast.
fn reply(
    tui: &Tui,
    request: &PermissionRequest,
    decision: PermissionReply,
    message: Option<String>,
    failed: Box<dyn FnOnce()>,
) {
    let data = tui.data.clone();
    let input = PermissionReplyInput {
        session_id: request.session_id.clone(),
        request_id: request.id.clone(),
        decision,
        message,
    };
    let weak = tui.weak();
    tui.app.spawn(
        async move { data.permission_reply(input).await },
        move |_, result| {
            let Err(error) = result else { return };
            failed();
            if let Some(tui) = weak.upgrade() {
                tui.toasts.error(error.to_string());
            }
        },
    );
}

/// The footer row both stages share; it stacks below 80 columns.
fn footer(app: &App, theme: &Theme, narrow: bool) -> View {
    View::new(app)
        .direction(if narrow {
            FlexDirection::Column
        } else {
            FlexDirection::Row
        })
        .shrink(0.0)
        .gap(1)
        .padding_edge(Edge::Top, 1)
        .padding_edge(Edge::Left, 2)
        .padding_edge(Edge::Right, 3)
        .padding_edge(Edge::Bottom, 1)
        .bg(theme.decrease(&theme.background.raised.base, 1))
        .justify(if narrow {
            Justify::Start
        } else {
            Justify::SpaceBetween
        })
        .align_items(if narrow { Align::Start } else { Align::Center })
}

/// `key` in the text color, then `label` muted.
/// `{key} <span muted>{label}</span>` in one text, so the space takes the key's color.
fn hint(app: &App, theme: &Theme, key: &str, label: &str) -> Text {
    Text::new(
        app,
        vec![
            format!("{key} ").fg(theme.text.base),
            label.to_owned().fg(theme.text.muted),
        ],
    )
    .shrink(0.0)
}

fn lines_view(app: &App, lines: &[String], color: impl Fn(usize) -> Color) -> View {
    let view = View::new(app).column().gap(1).padding_edge(Edge::Left, 1);
    for (index, line) in lines.iter().enumerate() {
        view.add(&Text::new(app, line.clone()).fg(color(index)));
    }
    view
}

fn presentation_body(
    tui: &Tui,
    theme: &Theme,
    request: &PermissionRequest,
    current: &Presentation,
) -> View {
    let app = &tui.app;
    if request.action == "edit" {
        return edit_body(tui, theme, current);
    }
    if request.action == "external_directory" {
        let view = View::new(app).column().gap(1).padding_edge(Edge::Left, 1);
        if current.lines.is_empty() {
            return view;
        }
        let patterns = View::new(app).column();
        for line in &current.lines {
            patterns.add(&Text::new(app, line.clone()).fg(theme.text.base));
        }
        return view
            .child(&Text::new(app, "Patterns").fg(theme.text.muted))
            .child(&patterns);
    }
    let color = if matches!(request.action.as_str(), "shell" | "subagent" | "task") {
        theme.text.base
    } else {
        theme.text.muted
    };
    let view = View::new(app).column().padding_edge(Edge::Left, 1);
    for line in &current.lines {
        view.add(&Text::new(app, line.clone()).fg(color));
    }
    view
}

/// `EditBody`: the diff, else the raw patch, else a note.
fn edit_body(tui: &Tui, theme: &Theme, current: &Presentation) -> View {
    let app = &tui.app;
    let syntax = opencode_ui::code::syntax_theme(theme);
    let scroll = || ScrollBox::new(app).height(Length::percent(100.0));
    let column = View::new(app)
        .column()
        .gap(1)
        .grow(1.0)
        .basis(Length::Auto)
        .min_height(0);
    if let Some(diff) = &current.diff {
        let view = match tui
            .config()
            .info
            .diffs
            .as_ref()
            .and_then(|diffs| diffs.view)
        {
            Some(ConfigDiffView::Unified) => DiffView::Unified,
            Some(ConfigDiffView::Split) => DiffView::Split,
            _ if tui.app.size().0 > 120 => DiffView::Split,
            _ => DiffView::Unified,
        };
        let file = current.file.as_deref().unwrap_or_default();
        let filetype = opentui::syntax::filetype_for_path(file);
        let diff =
            opencode_ui::diff::view(app, theme, &syntax, diff, view, filetype, WrapMode::Word, 0);
        return column.child(&scroll().child(&diff));
    }
    if let Some(patch) = &current.patch {
        let code =
            opencode_ui::code::view(app, theme, &syntax, Some("diff"), patch).fg(theme.text.muted);
        return column.child(&scroll().child(&code));
    }
    column.child(
        &View::new(app)
            .padding_edge(Edge::Left, 1)
            .child(&Text::new(app, "No diff provided").fg(theme.text.muted)),
    )
}

/// The tool call's input and metadata once it stopped streaming (`PermissionPrompt`'s `source`).
fn source(state: &State, request: &PermissionRequest) -> (Value, Value) {
    let found = request.source.as_ref().and_then(|source| {
        let Some(SessionMessageInfo::Assistant(message)) =
            state.message(&request.session_id, &source.message_id)
        else {
            return None;
        };
        message.content.iter().find_map(|item| match item {
            SessionMessageAssistantContentItem::Tool(part) if part.id == source.id => {
                serde_json::to_value(&part.state).ok()
            }
            _ => None,
        })
    });
    match found {
        Some(state) if state.get("status").and_then(Value::as_str) != Some("streaming") => (
            state.get("input").cloned().unwrap_or(Value::Null),
            state.get("metadata").cloned().unwrap_or(Value::Null),
        ),
        _ => (Value::Null, Value::Null),
    }
}
