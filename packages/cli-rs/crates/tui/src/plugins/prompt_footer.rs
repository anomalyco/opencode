//! The prompt footer plugin (E.14, row F02, `feature-plugins/prompt/footer.tsx`), appended to `prompt.footer`:
//!
//! - the running subagents and shells of the session (a click opens the first child), its goal (`goal.rs`),
//!   and its context use and cost, as far as they fit;
//! - otherwise the `agents` and `commands` hints;
//! - in shell mode, `esc exit shell mode`.

use std::cell::RefCell;
use std::rc::{Rc, Weak};

use opencode_api::generated::SessionID;
use opencode_plugin::{Definition, Placement, SlotInput, Slotted, slot};
use opencode_store::{Changes, SessionStatus, State};
use opencode_ui::bind;
use opentui::prelude::*;
use unicode_width::UnicodeWidthStr;

use super::goal::{self, Goal, Goals, Tracker};
use super::sidebar_context::{SessionUsage, Usage, money};
use crate::app::Tui;

pub fn plugin() -> Definition<Tui> {
    Definition::new("opencode.prompt.footer", |cx| {
        let goals = Rc::new(Goals::default());
        goals.install(cx.host());
        let dispose = goals.clone();
        cx.on_dispose(move || dispose.dispose());
        cx.slot(Placement::append(slot::PROMPT_FOOTER), move |tui, input| Box::new(Footer::new(tui, &goals, input)));
    })
}

/// One mounted footer; the prompt mounts it again when its input changes.
struct Footer(Rc<Inner>);

struct Inner {
    root: View,
    session: Option<SessionID>,
    shell: bool,
    show_details: bool,
    goal: Option<Rc<Tracker>>,
    shown: RefCell<Option<Model>>,
    /// What the footer reads from the store, read again only on the changes that touch it.
    stored: RefCell<Option<Stored>>,
    usage: SessionUsage,
}

#[derive(Clone, Default)]
struct Stored {
    subagents: usize,
    shells: usize,
    usage: Option<Usage>,
    cost: f64,
    /// The usage and the cost as the footer prints them.
    status: Rc<[String]>,
}

/// What the footer shows; it renders again only when this changes.
#[derive(Clone, Debug, PartialEq)]
struct Model {
    width: u16,
    live: Option<Live>,
    goal: Option<Goal>,
    status: Rc<[String]>,
    usage: bool,
    shortcuts: bool,
    agents: String,
    commands: String,
    /// The session pane owns the input; the hints read as disabled while a right pane has it.
    interactive: bool,
}

#[derive(Clone, Debug, PartialEq)]
struct Live {
    key: Option<String>,
    subagents: Option<String>,
    shells: Option<String>,
}

impl Footer {
    fn new(tui: &Tui, goals: &Goals, input: &SlotInput) -> Self {
        let prompt =
            input.prompt.clone().unwrap_or(opencode_plugin::slot::PromptFooter { shell: false, show_details: true });
        let session = input.session_id.clone().map(SessionID);
        let inner = Rc::new_cyclic(|this: &Weak<Inner>| {
            let goal = session.clone().map(|session| {
                goals.track(tui, session, bind!(this, |inner, tui| inner.refresh(tui, &Changes::default())))
            });
            Inner {
                root: View::new(&tui.app).row().gap(2).min_width(0),
                session,
                shell: prompt.shell,
                show_details: prompt.show_details,
                goal,
                shown: RefCell::new(None),
                stored: RefCell::new(None),
                usage: SessionUsage::default(),
            }
        });
        inner.refresh(tui, &Changes::everything());
        Self(inner)
    }
}

impl Slotted<Tui> for Footer {
    fn root(&self) -> View {
        self.0.root.clone()
    }

    // The width, the shortcuts and the goal live outside the store, so any change reads them again.
    fn sync(&self, tui: &Tui, changes: &Changes) {
        if !changes.is_empty() {
            self.0.refresh(tui, changes);
        }
    }
}

impl Inner {
    fn model(&self, tui: &Tui, changes: &Changes) -> Model {
        let width = tui.app.size().0;
        if let Some(session) = &self.session {
            // A shell of the session may run in any location.
            tui.data.read(|state| {
                let stale = self.stored.borrow().is_none()
                    || !changes.locations.is_empty()
                    || crate::routes::session::sidebar::touches(state, changes, session);
                if stale {
                    let stored = self.read(state, changes, session);
                    *self.stored.borrow_mut() = Some(stored);
                }
            });
        }
        let stored = self.stored.borrow().clone().unwrap_or_default();
        let plural = |count: usize, what: &str| {
            (count > 0).then(|| format!("{count} {what}{}", if count == 1 { "" } else { "s" }))
        };
        let (subagents, shells) = (plural(stored.subagents, "subagent"), plural(stored.shells, "shell"));
        // The keymap reads the store, so it is asked after the read above.
        let keymap = &tui.keymap;
        let live = (subagents.is_some() || shells.is_some()).then(|| Live {
            key: keymap.shortcut("session.child.first"),
            subagents,
            shells,
        });
        let commands = keymap.shortcut("command.palette.show");
        let (usage, shortcuts) = if stored.status.is_empty() {
            (false, width >= 44)
        } else {
            layout(
                i64::from(width) - 8,
                &stored.status,
                commands.as_ref().map(|key| format!("{key} commands")).as_slice(),
            )
        };
        Model {
            width,
            live,
            goal: self.goal.as_ref().and_then(|goal| goal.goal()),
            status: stored.status,
            usage,
            shortcuts,
            agents: keymap.shortcut("agent.cycle").unwrap_or_default(),
            commands: commands.unwrap_or_default(),
            interactive: crate::frame::session_interactive(tui),
        }
    }

    fn read(&self, state: &State, changes: &Changes, session: &SessionID) -> Stored {
        let subagents = state
            .family(session)
            .iter()
            .filter(|id| *id != session && state.status(id) == SessionStatus::Running)
            .count();
        let shells = state.session_shells(session).len();
        let usage = self.usage.read(state, changes, session);
        let cost = state.cost(session);
        let status = match self.stored.borrow().as_ref() {
            Some(stored) if stored.usage == usage && stored.cost == cost => stored.status.clone(),
            _ => [usage.map(|usage| format_usage(usage.tokens, usage.percent)), (cost > 0.0).then(|| money(cost))]
                .into_iter()
                .flatten()
                .collect(),
        };
        Stored { subagents, shells, usage, cost, status }
    }

    fn refresh(&self, tui: &Tui, changes: &Changes) {
        let model = self.model(tui, changes);
        if self.shown.borrow().as_ref() == Some(&model) {
            return;
        }
        self.root.clear();
        self.render(tui, &model);
        *self.shown.borrow_mut() = Some(model);
        tui.app.request_redraw();
    }

    fn render(&self, tui: &Tui, model: &Model) {
        let theme = tui.page();
        let app = &tui.app;
        let root = &self.root;
        if self.shell {
            let label = if model.width < 44 { "shell" } else { "exit shell mode" };
            root.shrink(0.0);
            root.add(&Text::new(app, vec!["esc ".fg(theme.text.base), label.fg(theme.text.muted)]).shrink(0.0));
            return;
        }
        let details = self.show_details;
        let hint = |key: &str, label: &str| {
            if !model.interactive {
                return Text::new(app, format!("{key} {label}"))
                    .fg(theme.text.action.primary.disabled)
                    .dim()
                    .wrap(WrapMode::None)
                    .shrink(0.0);
            }
            Text::new(app, vec![format!("{key} ").fg(theme.text.base), label.fg(theme.text.muted)])
                .wrap(WrapMode::None)
                .shrink(0.0)
        };
        let busy = model.goal.is_some() || model.live.is_some() || !model.status.is_empty();
        if busy {
            let shrink = if details && model.usage { 0.0 } else { 1.0 };
            root.shrink(shrink);
            let status = View::new(app).row().shrink(shrink).min_width(0);
            if let Some(live) = &model.live {
                status.add(&live_view(tui, live));
            }
            if let (Some(goal), Some(tracker)) = (&model.goal, &self.goal) {
                if model.live.is_some() {
                    status.add(&Text::new(app, " · ").fg(theme.text.muted).wrap(WrapMode::None).shrink(0.0));
                }
                status.add(&goal::status(tui, tracker, goal));
            }
            if details && model.usage {
                let lead = if model.live.is_some() || model.goal.is_some() { " · " } else { "" };
                status.add(
                    &Text::new(app, format!("{lead}{}", model.status.join(" · ")))
                        .fg(theme.text.muted)
                        .wrap(WrapMode::None)
                        .shrink(0.0),
                );
            }
            root.add(&status);
        } else {
            root.shrink(0.0);
            if details && model.shortcuts {
                root.add(&hint(&model.agents, "agents"));
            }
        }
        if details && model.shortcuts {
            root.add(&hint(&model.commands, "commands"));
        }
    }
}

/// The running subagents and shells; they brighten under the pointer, and a click opens the first child.
fn live_view(tui: &Tui, live: &Live) -> View {
    let theme = tui.page();
    let app = &tui.app;
    let mut spans = Vec::new();
    if let Some(key) = &live.key {
        spans.push(format!("{key} ").fg(theme.text.base));
    }
    let parts: Vec<&str> = [&live.subagents, &live.shells].into_iter().flatten().map(String::as_str).collect();
    spans.push(parts.join(" · ").into());
    let text = Text::new(app, spans).fg(theme.text.muted).wrap(WrapMode::None);
    let hover = text.clone();
    let (base, muted) = (theme.text.base, theme.text.muted);
    text.on_hover(move |cx, hovered| {
        hover.fg(if hovered { base } else { muted });
        cx.app().request_redraw();
    });
    let weak = tui.weak();
    text.mouse_pointer(MousePointer::POINTER).on_mouse(move |_, event| {
        if matches!(event.kind, MouseEventKind::Up(_))
            && let Some(tui) = weak.upgrade()
        {
            tui.keymap.dispatch("session.child.first", None);
        }
    });
    View::new(app).shrink(0.0).child(&text)
}

/// `formatContextUsage`: `12.3K (45%)`.
fn format_usage(tokens: f64, percent: Option<i64>) -> String {
    let value = crate::routes::session::messages::compaction::number(tokens);
    match percent {
        Some(percent) => format!("{value} ({percent}%)"),
        None => value,
    }
}

/// `promptFooterLayout`: whether the usage and the shortcuts fit beside the location, which keeps at most 28
/// columns or half the width.
fn layout(width: i64, usage: &[String], shortcuts: &[String]) -> (bool, bool) {
    let width = width.max(0);
    let usage = usage.join(" · ");
    let shortcuts = shortcuts.join(" · ");
    let available = (width - (width / 2).min(28)).max(0) as usize;
    let fits = |text: &str| text.width() <= available;
    if !usage.is_empty() && !shortcuts.is_empty() && fits(&format!("{usage} · {shortcuts}")) {
        return (true, true);
    }
    if !usage.is_empty() && fits(&usage) {
        return (true, false);
    }
    if usage.is_empty() && !shortcuts.is_empty() && fits(&shortcuts) {
        return (false, true);
    }
    (false, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn layout_like_prompt_footer_layout() {
        let usage = ["12.3K (4%)".to_owned(), "$0.12".to_owned()];
        let commands = ["ctrl+p commands".to_owned()];
        // 92 wide keeps 28 for the location: 64 left.
        assert_eq!(layout(92, &usage, &commands), (true, true));
        // 40 wide keeps 20: 20 left, enough for the usage only.
        assert_eq!(layout(40, &usage, &commands), (true, false));
        assert_eq!(layout(20, &usage, &commands), (false, false));
        assert_eq!(layout(40, &[], &commands), (false, true));
        assert_eq!(format_usage(12_345.0, Some(4)), "12.3K (4%)");
        assert_eq!(format_usage(800.0, None), "800");
    }
}
