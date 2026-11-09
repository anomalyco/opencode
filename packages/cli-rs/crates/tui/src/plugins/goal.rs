//! The goal `/goal` set on a session (E.14, rows F02 and DLG45, `feature-plugins/prompt/goal.tsx`): the goal plugin's
//! RPC read, the status under the prompt, and the goal panel, for the prompt footer plugin.
//!
//! [`Goals`] keeps the goal of each session a mounted footer shows. The first footer of a session reads its goal, and
//! every tracked session is read again after a reconnect, since changes published meanwhile were missed; the `changed`
//! events keep them current. A change that arrives while a read is in flight is newer than its reply, so each read and
//! change takes a turn, and a reply of an older turn is dropped.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;

use opencode_api::client::Client;
use opencode_api::generated::{
    LocationQueryInput, RpcCallInput, RpcCallOutput, SessionCommandInput, SessionID, V2Event,
};
use opencode_plugin::abi::{
    self, Action, Click, Command, Dialog, Host, Layout, Node, Panel, PanelAction, PanelBind, PanelSize, RequestId,
    Span, Toast, Variant, Wrap,
};
use serde::Deserialize;
use serde_json::json;

use super::fetch::fetch_of;

const RPC: &str = "opencode.goal";
const CHANGED: &str = "rpc.opencode.goal.changed";
/// The key of the goal panel.
const PANEL: &str = "goal";
/// The hidden commands of the status and the panel. Each takes the session as its input.
const SHOW: &str = "prompt.goal.show";
const PAUSE: &str = "prompt.goal.pause";
const RESUME: &str = "prompt.goal.resume";
const CLEAR: &str = "prompt.goal.clear";

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

/// The goals of the sessions the mounted footers show (TS `createGoal`, once per session).
#[derive(Default)]
pub struct Goals {
    sessions: RefCell<HashMap<String, Tracked>>,
    pending: RefCell<HashMap<RequestId, Pending>>,
    turns: Cell<u64>,
    /// The session whose goal the panel shows.
    shown: RefCell<Option<String>>,
}

#[derive(Default)]
struct Tracked {
    mounts: usize,
    goal: Option<Rc<Goal>>,
    turn: u64,
}

enum Pending {
    Read { session: String, turn: u64 },
    Command,
}

impl Goals {
    /// Registers the events, replies and hidden commands the goals follow.
    pub fn register(self: &Rc<Self>, setup: &mut abi::Setup) {
        let goals = self.clone();
        setup.on_event(&[CHANGED, "server.connected"], move |host, event| goals.event(host, event));
        let goals = self.clone();
        setup.on_reply(move |host, id, result| goals.reply(host, id, result));
        for (name, text) in [(SHOW, None), (PAUSE, Some("pause")), (RESUME, Some("resume")), (CLEAR, Some("clear"))] {
            let goals = self.clone();
            setup.command(Command { name: name.to_owned(), ..Command::default() }, move |host, session| {
                let Some(session) = session else { return };
                match text {
                    None => goals.show(host, session),
                    Some(text) => goals.command(host, session, text),
                }
            });
        }
    }

    pub fn goal(&self, session: &str) -> Option<Rc<Goal>> {
        self.sessions.borrow().get(session).and_then(|tracked| tracked.goal.clone())
    }

    /// A footer of `session` mounted, or went: the first one reads the goal, and the last one forgets it.
    pub fn mounted(&self, host: &dyn Host, session: &str, mounted: bool) {
        let mut sessions = self.sessions.borrow_mut();
        if mounted {
            let tracked = sessions.entry(session.to_owned()).or_default();
            tracked.mounts += 1;
            let first = tracked.mounts == 1;
            drop(sessions);
            if first {
                self.load(host, session);
            }
            return;
        }
        if let Some(tracked) = sessions.get_mut(session) {
            tracked.mounts -= 1;
            if tracked.mounts == 0 {
                sessions.remove(session);
            }
        }
    }

    /// Reads the goal; a server without the goal plugin answers with an error, and the session shows none.
    fn load(&self, host: &dyn Host, session: &str) {
        let turn = self.turn(session);
        let directory = host.session(session).map(|session| session.info.location.directory.0);
        let input = RpcCallInput {
            rpc_id: RPC.to_owned(),
            method: "get".to_owned(),
            location: directory.map(|directory| LocationQueryInput { directory: Some(directory) }),
            input: Some(json!({ "sessionID": session })),
        };
        let call = Client::rpc_call_call(&input).expect("the goal read encodes");
        let read = Pending::Read { session: session.to_owned(), turn };
        self.pending.borrow_mut().insert(host.fetch(fetch_of(call)), read);
    }

    /// A new turn of `session`, which outdates the reads in flight.
    fn turn(&self, session: &str) -> u64 {
        let turn = self.turns.get() + 1;
        self.turns.set(turn);
        if let Some(tracked) = self.sessions.borrow_mut().get_mut(session) {
            tracked.turn = turn;
        }
        turn
    }

    fn event(&self, host: &dyn Host, event: &V2Event) {
        match event {
            V2Event::ServerConnected(_) => {
                let sessions: Vec<String> = self.sessions.borrow().keys().cloned().collect();
                sessions.iter().for_each(|session| self.load(host, session));
            }
            V2Event::Rpc(event) if event.r#type == CHANGED => {
                let Some(session) = event.data.get("sessionID").and_then(|id| id.as_str()) else { return };
                if !self.sessions.borrow().contains_key(session) {
                    return;
                }
                self.turn(session);
                let goal = event.data.get("goal").and_then(|goal| Goal::deserialize(goal).ok());
                self.set(host, session, goal);
            }
            _ => {}
        }
    }

    fn reply(&self, host: &dyn Host, id: RequestId, result: Result<serde_json::Value, String>) {
        let Some(pending) = self.pending.borrow_mut().remove(&id) else { return };
        match pending {
            Pending::Command => {
                if let Err(error) = result {
                    host.toast(Toast::new(Variant::Error, error).title("Failed to update the goal"));
                }
            }
            Pending::Read { session, turn } => {
                let Ok(value) = result else { return };
                if self.sessions.borrow().get(&session).is_none_or(|tracked| tracked.turn != turn) {
                    return;
                }
                let output = serde_json::from_value::<RpcCallOutput>(value).ok().and_then(|output| output.output);
                self.set(host, &session, output.and_then(|goal| Goal::deserialize(goal).ok()));
            }
        }
    }

    fn set(&self, host: &dyn Host, session: &str, goal: Option<Goal>) {
        {
            let mut sessions = self.sessions.borrow_mut();
            let Some(tracked) = sessions.get_mut(session) else { return };
            if tracked.goal.as_deref() == goal.as_ref() {
                return;
            }
            tracked.goal = goal.map(Rc::new);
        }
        // An open goal panel follows the goal, as the TS dialog's accessor does.
        if self.shown.borrow().as_deref() == Some(session) && host.dialog_open(PANEL) {
            match self.goal(session) {
                Some(goal) => host.dialog(Dialog::Panel(panel(session, &goal))),
                None => host.dialog(Dialog::Close { key: PANEL.to_owned() }),
            }
        }
    }

    /// `showGoal`: the panel, or how to start a goal.
    fn show(&self, host: &dyn Host, session: &str) {
        let Some(goal) = self.goal(session) else {
            host.toast(Toast::new(Variant::Info, "No goal is set. Start one with /goal <objective>."));
            return;
        };
        *self.shown.borrow_mut() = Some(session.to_owned());
        host.dialog(Dialog::Panel(panel(session, &goal)));
    }

    /// `/goal pause`, `/goal resume`, or `/goal clear` through `session.command`; clear closes the panel first.
    fn command(&self, host: &dyn Host, session: &str, text: &str) {
        if text == "clear" {
            host.dialog(Dialog::Close { key: PANEL.to_owned() });
        }
        let input = SessionCommandInput {
            session_id: SessionID(session.to_owned()),
            name: "goal".to_owned(),
            text: text.to_owned(),
            ..SessionCommandInput::default()
        };
        let call = Client::session_command_call(&input).expect("the goal command encodes");
        self.pending.borrow_mut().insert(host.fetch(fetch_of(call)), Pending::Command);
    }
}

fn color(goal: &Goal) -> &'static str {
    match goal.status {
        Status::Paused => "text.feedback.warning.base",
        Status::Complete => "text.feedback.success.base",
        Status::Active => "text.muted",
    }
}

fn label(goal: &Goal) -> &'static str {
    match goal.status {
        Status::Paused => "goal paused",
        Status::Complete => "goal met",
        Status::Active => "goal",
    }
}

/// `GoalStatus`: `◎ goal` under the prompt; it brightens under the pointer, and a click opens the panel.
pub fn status(session: &str, goal: &Goal) -> Node {
    Node::text([Span::new(format!("◎ {}", label(goal)))])
        .fg(color(goal))
        .hover_fg("text.base")
        .wrap(Wrap::None)
        .layout(Layout::default().shrink(false))
        .on_click(Click::command(SHOW, Some(session.to_owned())))
}

/// `GoalDialog`: the objective, the status and its reason, and pause, resume, and clear.
fn panel(session: &str, goal: &Goal) -> Panel {
    let run = |name: &str| Action::Command { name: name.to_owned(), input: Some(session.to_owned()) };
    let mut keys = Vec::new();
    if goal.status == Status::Active {
        keys.push(("pause", "p", "Pause goal", PAUSE));
    }
    if goal.status == Status::Paused {
        keys.push(("resume", "r", "Resume goal", RESUME));
    }
    keys.push(("clear", "x", "Clear goal", CLEAR));
    let actions = keys
        .iter()
        .map(|(title, key, _, name)| PanelAction {
            title: (*title).to_owned(),
            key: Some((*key).to_owned()),
            color: None,
            close: false,
            action: run(name),
        })
        .collect();
    let binds = keys
        .iter()
        .map(|(_, key, title, name)| PanelBind {
            key: (*key).to_owned(),
            title: (*title).to_owned(),
            action: run(name),
        })
        .collect();
    let state = match goal.status {
        Status::Active => "Active",
        Status::Paused => "Paused",
        Status::Complete => "Met",
    };
    let mut details = vec![Node::text([Span::new(format!("◎ {state}"))]).fg(color(goal)).wrap(Wrap::None)];
    if let Some(reason) = &goal.reason {
        details.push(Node::text([Span::new(reason.clone())]).fg("text.muted"));
    }
    Panel {
        key: PANEL.to_owned(),
        size: PanelSize::Medium,
        title: vec![Span::new("Goal")],
        subtitle: None,
        body: Node::column(vec![
            Node::text([Span::new(goal.objective.clone())]).fg("text.base"),
            Node::column(details),
        ])
        .gap(1),
        actions,
        binds,
        bleed: false,
        centered: false,
    }
}
