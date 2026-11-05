//! The goal `/goal` set on a session (E.14, rows F02 and DLG45, `feature-plugins/prompt/goal.tsx`): the
//! goal plugin's RPC read, the status under the prompt, and the goal dialog.
//!
//! [`Goals`] forwards `rpc.opencode.goal.changed` and `server.connected` to every live [`Tracker`]. A tracker
//! reads its session's goal when it starts and after each reconnect, since changes published meanwhile were
//! missed, and follows the `changed` events.

use opencode_api::generated::{LocationQueryInput, RpcCallInput, SessionCommandInput, SessionID, V2Event};
use opencode_ui::bind;
use opencode_ui::dialog::{self, DialogOptions, FooterAction, FooterProps, HeaderProps};
use opencode_ui::keymap::{KeymapLayer, TuiCommand};
use opencode_ui::theme::Theme;
use opencode_ui::toast::{ToastOptions, Variant};
use opentui::keymap::{Condition, Disposer};
use opentui::prelude::*;
use serde::Deserialize;
use serde_json::json;
use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};

use crate::app::Tui;

const RPC: &str = "opencode.goal";
const CHANGED: &str = "rpc.opencode.goal.changed";
/// [`dialog::DialogOptions::key`] of the goal dialog.
const DIALOG: &str = "goal";

/// `Goal.State`, the fields the TUI shows.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Goal {
    pub objective: String,
    pub status: Status,
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Active,
    Paused,
    Complete,
}

/// The live trackers, and the event forwarding they share. One per plugin activation.
#[derive(Default)]
pub struct Goals {
    trackers: RefCell<Vec<Weak<Tracker>>>,
    subscription: RefCell<Option<Disposer>>,
}

impl Goals {
    /// Forwards the store's goal events to the trackers until [`Goals::dispose`].
    pub fn install(self: &Rc<Self>, tui: &Tui) {
        let subscription = crate::features::events::subscribe(tui, bind!(self, |goals, _, event| goals.event(event)));
        self.subscription.replace(Some(subscription));
    }

    pub fn dispose(&self) {
        self.subscription.take();
    }

    /// Starts following `session`'s goal; `changed` runs after each change of it.
    pub fn track(&self, tui: &Tui, session: SessionID, changed: impl Fn(&Tui) + 'static) -> Rc<Tracker> {
        let tracker = Rc::new_cyclic(|this| Tracker {
            tui: tui.weak(),
            session,
            goal: RefCell::new(None),
            turn: Cell::new(0),
            changed: Box::new(changed),
            this: this.clone(),
        });
        let mut trackers = self.trackers.borrow_mut();
        trackers.retain(|tracker| tracker.strong_count() > 0);
        trackers.push(Rc::downgrade(&tracker));
        drop(trackers);
        tracker.load(tui);
        tracker
    }

    fn event(&self, event: &V2Event) {
        let trackers: Vec<Rc<Tracker>> = self.trackers.borrow().iter().filter_map(Weak::upgrade).collect();
        for tracker in trackers {
            let Some(tui) = tracker.tui.upgrade() else {
                continue;
            };
            match event {
                V2Event::ServerConnected(_) => tracker.load(&tui),
                V2Event::Rpc(event) if event.r#type == CHANGED => {
                    if event.data.get("sessionID").and_then(|id| id.as_str()) != Some(tracker.session.0.as_str()) {
                        continue;
                    }
                    // A change that arrives while a read is in flight is newer than its reply.
                    tracker.turn.set(tracker.turn.get() + 1);
                    let goal = event.data.get("goal").and_then(|goal| Goal::deserialize(goal).ok());
                    tracker.set(&tui, goal);
                }
                _ => {}
            }
        }
    }
}

/// The goal of one session (TS `createGoal`).
pub struct Tracker {
    tui: Weak<Tui>,
    session: SessionID,
    goal: RefCell<Option<Goal>>,
    turn: Cell<u64>,
    changed: Box<dyn Fn(&Tui)>,
    this: Weak<Tracker>,
}

impl Tracker {
    pub fn goal(&self) -> Option<Goal> {
        self.goal.borrow().clone()
    }

    pub fn session(&self) -> &SessionID {
        &self.session
    }

    /// Reads the goal; a server without the goal plugin answers with an error, and the session shows none.
    fn load(&self, tui: &Tui) {
        let turn = self.turn.get() + 1;
        self.turn.set(turn);
        let directory =
            tui.data.read(|state| state.session(&self.session).map(|session| session.location.directory.0.clone()));
        let input = RpcCallInput {
            rpc_id: RPC.to_owned(),
            method: "get".to_owned(),
            location: directory.map(|directory| LocationQueryInput { directory: Some(directory) }),
            input: Some(json!({ "sessionID": self.session.0 })),
        };
        let client = tui.data.client().clone();
        let weak = self.this.clone();
        tui.app.spawn(
            async move { client.rpc_call(&input).await },
            bind!(weak, |tracker, _, result| {
                let Some(tui) = tracker.tui.upgrade() else {
                    return;
                };
                let Ok(output) = result else { return };
                if tracker.turn.get() != turn {
                    return;
                }
                let goal = output.output.and_then(|goal| Goal::deserialize(goal).ok());
                tracker.set(&tui, goal);
            }),
        );
    }

    fn set(&self, tui: &Tui, goal: Option<Goal>) {
        if *self.goal.borrow() == goal {
            return;
        }
        *self.goal.borrow_mut() = goal;
        (self.changed)(tui);
        // An open goal dialog follows the goal, as the TS dialog's accessor does.
        if tui.dialogs.key().as_deref() == Some(DIALOG) {
            match self.goal() {
                Some(_) => show(tui, self),
                None => tui.dialogs.clear(),
            }
        }
    }
}

fn color(theme: &Theme, goal: &Goal) -> Color {
    match goal.status {
        Status::Paused => theme.text.feedback.warning.base,
        Status::Complete => theme.text.feedback.success.base,
        Status::Active => theme.text.muted,
    }
}

fn label(goal: &Goal) -> &'static str {
    match goal.status {
        Status::Paused => "goal paused",
        Status::Complete => "goal met",
        Status::Active => "goal",
    }
}

/// `GoalStatus`: `◎ goal` under the prompt; it brightens under the pointer, and a click opens the dialog.
pub fn status(tui: &Tui, tracker: &Rc<Tracker>, goal: &Goal) -> View {
    let theme = tui.page();
    let rest = color(&theme, goal);
    let text = Text::new(&tui.app, format!("◎ {}", label(goal))).fg(rest).wrap(WrapMode::None);
    let hover = text.clone();
    let base = theme.text.base;
    text.on_hover(move |cx, hovered| {
        hover.fg(if hovered { base } else { rest });
        cx.app().request_redraw();
    });
    let weak = Rc::downgrade(tracker);
    text.mouse_pointer(MousePointer::POINTER).on_mouse(move |_, event| {
        if !matches!(event.kind, MouseEventKind::Up(_)) {
            return;
        }
        let Some(tracker) = weak.upgrade() else {
            return;
        };
        let Some(tui) = tracker.tui.upgrade() else {
            return;
        };
        open(&tui, &tracker);
    });
    View::new(&tui.app).shrink(0.0).child(&text)
}

/// `showGoal`: the dialog, or how to start a goal.
pub fn open(tui: &Tui, tracker: &Tracker) {
    if tracker.goal().is_none() {
        tui.toasts.show(ToastOptions::new(Variant::Info, "No goal is set. Start one with /goal <objective>."));
        return;
    }
    show(tui, tracker);
}

/// `GoalDialog`: the objective, the status and its reason, and pause, resume, and clear.
fn show(tui: &Tui, tracker: &Tracker) {
    let Some(goal) = tracker.goal() else { return };
    let session = tracker.session.clone();
    let weak = tui.weak();
    let run = move |text: &'static str| {
        let session = session.clone();
        Rc::new(bind!(weak, |tui| command(&tui, &session, text))) as Rc<dyn Fn()>
    };
    let (pause, resume, clear) = (run("pause"), run("resume"), run("clear"));
    tui.dialogs.replace(
        move |cx| {
            let theme = &cx.theme;
            let app = &cx.app;
            let action = |title: &str, key: &str, run: &Rc<dyn Fn()>| {
                let run = run.clone();
                FooterAction::new(title).key(key).on_trigger(move || run())
            };
            let mut primary = Vec::new();
            if goal.status == Status::Active {
                primary.push(action("pause", "p", &pause));
            }
            if goal.status == Status::Paused {
                primary.push(action("resume", "r", &resume));
            }
            primary.push(action("clear", "x", &clear));
            let bind = |key: &str, title: &str, enabled: bool, run: &Rc<dyn Fn()>| {
                let run = run.clone();
                TuiCommand::inline(key, move |_, _| run()).title(title).group("Dialog").enabled(if enabled {
                    Condition::Always
                } else {
                    Condition::Never
                })
            };
            cx.layer(KeymapLayer::new(vec![
                bind("p", "Pause goal", goal.status == Status::Active, &pause),
                bind("r", "Resume goal", goal.status == Status::Paused, &resume),
                bind("x", "Clear goal", true, &clear),
            ]));
            let state = match goal.status {
                Status::Active => "Active",
                Status::Paused => "Paused",
                Status::Complete => "Met",
            };
            let details = View::new(app)
                .child(&Text::new(app, format!("◎ {state}")).fg(color(theme, &goal)).wrap(WrapMode::None));
            if let Some(reason) = &goal.reason {
                details.add(&Text::new(app, reason.clone()).fg(theme.text.muted));
            }
            let body = View::new(app)
                .gap(1)
                .child(&Text::new(app, goal.objective.clone()).fg(theme.text.base))
                .child(&details);
            let header = dialog::header(cx, HeaderProps::new("Goal"));
            dialog::layout(cx, &header, &body, Some(FooterProps { primary, ..FooterProps::default() }))
        },
        None,
        DialogOptions::default().key(DIALOG),
    );
}

/// `/goal pause`, `/goal resume`, or `/goal clear` through `session.command`; clear closes the dialog first.
fn command(tui: &Tui, session: &SessionID, text: &str) {
    if text == "clear" {
        tui.dialogs.clear();
    }
    let client = tui.data.client().clone();
    let input = SessionCommandInput {
        session_id: session.clone(),
        name: "goal".to_owned(),
        text: text.to_owned(),
        ..SessionCommandInput::default()
    };
    let weak = tui.weak();
    tui.app.spawn(async move { client.session_command(&input).await }, move |_, result| {
        let (Err(error), Some(tui)) = (result, weak.upgrade()) else {
            return;
        };
        tui.toasts.show(ToastOptions::new(Variant::Error, error.to_string()).title("Failed to update the goal"));
    });
}
