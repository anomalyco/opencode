//! The notifications plugin (E.19a, row F09, `feature-plugins/system/notifications.ts`): asks for attention when
//! a session is done, a subagent is done, a form or a permission waits, or a session fails, and shows failures
//! as toasts. [`Tracker`] is the event logic; [`plugin`] feeds it the server's events. It is a plugin of the one API
//! (O-67).

use std::cell::RefCell;
use std::collections::HashSet;

use opencode_api::generated::V2Event;
use opencode_plugin::abi::{self, Attention, Sound, SoundName, Toast, Variant, When};

pub const ID: &str = "opencode.notifications";

pub fn plugin() -> abi::Plugin {
    abi::Plugin { id: ID, setup }
}

/// The events [`Tracker`] follows.
const EVENTS: [&str; 9] = [
    "form.created",
    "form.replied",
    "form.cancelled",
    "permission.asked",
    "permission.replied",
    "session.execution.started",
    "session.execution.succeeded",
    "session.execution.interrupted",
    "session.execution.failed",
];

fn setup(setup: &mut abi::Setup) -> Result<(), String> {
    let tracker = RefCell::new(Tracker::default());
    setup.on_event(&EVENTS, move |host, event| {
        for action in tracker.borrow_mut().event(event, &Reads(host)) {
            match action {
                Action::Notify(attention) => host.attention(attention),
                // A session-scoped toast (the plugin API's `toast.show` with `sessionID`).
                Action::Toast { session, message } => {
                    host.toast(Toast::new(Variant::Error, message).title("Session failed").session(session));
                }
            }
        }
    });
    Ok(())
}

/// What [`Tracker`] reads about sessions.
trait Sessions {
    fn title(&self, id: &str) -> Option<String>;
    fn parent(&self, id: &str) -> Option<String>;
    /// Whether a direct child of `id` runs.
    fn running_child(&self, id: &str) -> bool;
}

struct Reads<'a>(&'a dyn abi::Read);

impl Sessions for Reads<'_> {
    fn title(&self, id: &str) -> Option<String> {
        self.0.session(id)?.info.title
    }

    fn parent(&self, id: &str) -> Option<String> {
        Some(self.0.session(id)?.info.parent_id?.0)
    }

    fn running_child(&self, id: &str) -> bool {
        // Only direct children: a grandchild reports to its own parent, so waiting on it could mean no sound at
        // all. Running shells don't count, or a session with a dev server running would never play one.
        self.0.family(id).members.iter().any(|member| {
            member.id != id && member.parent.as_deref() == Some(id) && member.status == abi::SessionStatus::Running
        })
    }
}

#[derive(Debug, PartialEq)]
enum Action {
    Notify(Attention),
    Toast { session: String, message: String },
}

/// The plugin's state: failed and ended sessions, and the forms and permissions already announced.
#[derive(Default)]
struct Tracker {
    errored: HashSet<String>,
    terminal: HashSet<String>,
    forms: HashSet<String>,
    permissions: HashSet<String>,
}

impl Tracker {
    fn event(&mut self, event: &V2Event, sessions: &impl Sessions) -> Vec<Action> {
        let mut actions = Vec::new();
        match event {
            V2Event::FormCreated(event) => {
                let form = &event.data.form;
                if self.forms.insert(form.id.0.clone()) {
                    actions.push(request(
                        sessions,
                        Some(&form.session_id),
                        "Input needs response".to_owned(),
                        SoundName::Question,
                        Some(form.title.clone()),
                    ));
                }
            }
            V2Event::FormReplied(event) => {
                self.forms.remove(&event.data.id.0);
            }
            V2Event::FormCancelled(event) => {
                self.forms.remove(&event.data.id.0);
            }
            V2Event::PermissionAsked(event) => {
                if self.permissions.insert(event.data.id.0.clone()) {
                    actions.push(request(
                        sessions,
                        Some(&event.data.session_id.0),
                        "Permission needs input".to_owned(),
                        SoundName::Permission,
                        None,
                    ));
                }
            }
            V2Event::PermissionReplied(event) => {
                self.permissions.remove(&event.data.request_id.0);
            }
            V2Event::SessionExecutionStarted(event) => {
                let id = &event.data.session_id.0;
                self.errored.remove(id);
                self.terminal.remove(id);
            }
            V2Event::SessionExecutionSucceeded(event) => {
                // A running subagent's report wakes the session again, so it isn't done yet. Subagent sounds stay
                // as they were.
                let id = &event.data.session_id.0;
                if sessions.parent(id).is_some() || !sessions.running_child(id) {
                    self.ended(id, sessions, &mut actions);
                }
            }
            V2Event::SessionExecutionInterrupted(event) => {
                self.ended(&event.data.session_id.0, sessions, &mut actions);
            }
            V2Event::SessionExecutionFailed(event) => {
                let id = &event.data.session_id.0;
                if self.terminal.contains(id) {
                    return actions;
                }
                if !self.errored.insert(id.clone()) {
                    self.ended(id, sessions, &mut actions);
                    return actions;
                }
                let error = &event.data.error;
                if error.r#type != "provider.free-limit" && error.r#type != "provider.go-limit" {
                    actions.push(request(sessions, Some(id), error.message.clone(), SoundName::Error, None));
                    actions.push(Action::Toast { session: id.clone(), message: error.message.clone() });
                }
                self.ended(id, sessions, &mut actions);
            }
            _ => {}
        }
        actions
    }

    fn ended(&mut self, id: &str, sessions: &impl Sessions, actions: &mut Vec<Action>) {
        if !self.terminal.insert(id.to_owned()) {
            return;
        }
        if self.errored.remove(id) {
            return;
        }
        let sound = if sessions.parent(id).is_some() { SoundName::SubagentDone } else { SoundName::Done };
        actions.push(request(sessions, Some(id), "Session done".to_owned(), sound, None));
    }
}

/// `notify`: a subagent's request plays its sound only; others notify while the terminal is blurred.
fn request(
    sessions: &impl Sessions,
    session: Option<&str>,
    message: String,
    sound: SoundName,
    title: Option<String>,
) -> Action {
    let subagent = session.and_then(|id| sessions.parent(id)).is_some();
    Action::Notify(Attention {
        title: title.or_else(|| session.and_then(|id| sessions.title(id))),
        message,
        notify: (!subagent).then_some(When::Blurred),
        sound: Some(Sound { name: sound, when: When::Always, volume: None }),
    })
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    /// The sessions of `notifications.test.ts`.
    struct Fake {
        sessions: HashMap<&'static str, (&'static str, Option<&'static str>)>,
        running: HashSet<&'static str>,
    }

    impl Fake {
        fn new() -> Self {
            Self {
                sessions: HashMap::from([
                    ("session", ("Demo session", None)),
                    ("subagent", ("Subagent session", Some("session"))),
                    ("second", ("Second subagent session", Some("session"))),
                    ("nested", ("Nested subagent session", Some("subagent"))),
                ]),
                running: HashSet::new(),
            }
        }
    }

    impl Sessions for Fake {
        fn title(&self, id: &str) -> Option<String> {
            self.sessions.get(id).map(|(title, _)| (*title).to_owned())
        }

        fn parent(&self, id: &str) -> Option<String> {
            self.sessions.get(id)?.1.map(str::to_owned)
        }

        fn running_child(&self, id: &str) -> bool {
            self.sessions.iter().any(|(child, (_, parent))| *parent == Some(id) && self.running.contains(child))
        }
    }

    fn event(value: serde_json::Value) -> V2Event {
        let mut value = value;
        value["id"] = "evt".into();
        value["created"] = 0.into();
        if value["type"].as_str().unwrap().starts_with("session.") {
            let session = value["data"]["sessionID"].clone();
            value["durable"] = serde_json::json!({"aggregateID": session, "seq": 0, "version": 1});
        }
        serde_json::from_value(value).unwrap()
    }

    fn execution(kind: &str, session: &str) -> V2Event {
        let mut data = serde_json::json!({ "sessionID": session });
        if kind == "interrupted" {
            data["reason"] = "user".into();
        }
        event(serde_json::json!({ "type": format!("session.execution.{kind}"), "data": data }))
    }

    fn failed(session: &str, kind: &str) -> V2Event {
        event(serde_json::json!({
            "type": "session.execution.failed",
            "data": { "sessionID": session, "error": { "type": kind, "message": "boom" } },
        }))
    }

    fn form(kind: &str, id: &str, session: &str, title: &str) -> V2Event {
        let data = match kind {
            "created" => serde_json::json!({ "form": {
                "id": id, "sessionID": session, "title": title,
                "fields": [{ "key": "authorization", "type": "external", "url": "https://example.com" }],
            }}),
            _ => serde_json::json!({ "id": id, "sessionID": session, "answer": {} }),
        };
        event(serde_json::json!({ "type": format!("form.{kind}"), "data": data }))
    }

    fn permission(kind: &str, id: &str) -> V2Event {
        let data = match kind {
            "asked" => serde_json::json!({
                "id": id, "sessionID": "session", "action": "edit", "resources": [], "metadata": {}, "save": [],
            }),
            _ => serde_json::json!({ "sessionID": "session", "requestID": id, "reply": "once" }),
        };
        event(serde_json::json!({ "type": format!("permission.{kind}"), "data": data }))
    }

    fn notified(title: &str, message: &str, sound: SoundName, blurred: bool) -> Action {
        Action::Notify(Attention {
            title: Some(title.to_owned()),
            message: message.to_owned(),
            notify: blurred.then_some(When::Blurred),
            sound: Some(Sound { name: sound, when: When::Always, volume: None }),
        })
    }

    fn run(fake: &Fake, tracker: &mut Tracker, events: &[V2Event]) -> Vec<Action> {
        events.iter().flat_map(|event| tracker.event(event, fake)).collect()
    }

    fn done() -> Action {
        notified("Demo session", "Session done", SoundName::Done, true)
    }

    // Expected: each event the plugin follows crosses the C ABI as JSON and reads back as the same value.
    #[test]
    fn the_followed_events_read_back_from_json_as_written() {
        let events = [
            form("created", "form-1", "session", "Confirm"),
            form("replied", "form-1", "session", ""),
            form("cancelled", "form-1", "session", ""),
            permission("asked", "per_1"),
            permission("replied", "per_1"),
            execution("started", "session"),
            execution("succeeded", "session"),
            execution("interrupted", "session"),
            failed("session", "unknown"),
        ];
        assert_eq!(events.iter().map(V2Event::tag).collect::<Vec<_>>(), EVENTS);
        for event in events {
            let json = serde_json::to_string(&event).unwrap();
            assert_eq!(serde_json::from_str::<V2Event>(&json).unwrap(), event, "{json}");
        }
    }

    #[test]
    fn failures_toast_once_per_execution_except_usage_limits() {
        let fake = Fake::new();
        let mut tracker = Tracker::default();
        let boom = || notified("Demo session", "boom", SoundName::Error, true);
        let toast = || Action::Toast { session: "session".to_owned(), message: "boom".to_owned() };
        let started = || execution("started", "session");
        let actions = run(
            &fake,
            &mut tracker,
            &[
                started(),
                failed("session", "unknown"),
                failed("session", "unknown"),
                started(),
                failed("session", "unknown"),
                started(),
                failed("session", "provider.free-limit"),
                started(),
                failed("session", "provider.go-limit"),
            ],
        );
        assert_eq!(actions, [boom(), toast(), boom(), toast()]);
    }

    #[test]
    fn forms_and_permissions_notify_once_until_resolved() {
        let fake = Fake::new();
        let mut tracker = Tracker::default();
        let question = |title| notified(title, "Input needs response", SoundName::Question, true);
        let asked = || notified("Demo session", "Permission needs input", SoundName::Permission, true);
        let actions = run(
            &fake,
            &mut tracker,
            &[
                form("created", "form-1", "session", "Confirm deployment"),
                form("created", "form-1", "session", "Confirm deployment"),
                form("cancelled", "form-1", "session", ""),
                form("created", "form-1", "session", "Input requested"),
                form("replied", "form-1", "session", ""),
                form("created", "form-2", "global", "demo-mcp is requesting input"),
                permission("asked", "per_1"),
                permission("asked", "per_1"),
                permission("replied", "per_1"),
                permission("asked", "per_1"),
            ],
        );
        assert_eq!(
            actions,
            [
                question("Confirm deployment"),
                question("Input requested"),
                question("demo-mcp is requesting input"),
                asked(),
                asked(),
            ]
        );
    }

    #[test]
    fn sessions_are_done_once_per_execution() {
        let fake = Fake::new();
        let mut tracker = Tracker::default();
        let actions = run(
            &fake,
            &mut tracker,
            &[
                execution("succeeded", "session"),
                execution("succeeded", "session"),
                execution("started", "session"),
                execution("interrupted", "session"),
            ],
        );
        assert_eq!(actions, [done(), done()]);
    }

    #[test]
    fn subagents_only_play_a_sound() {
        let fake = Fake::new();
        let mut tracker = Tracker::default();
        let actions = run(
            &fake,
            &mut tracker,
            &[
                form("created", "form-1", "subagent", "Questions"),
                execution("started", "subagent"),
                execution("succeeded", "subagent"),
            ],
        );
        assert_eq!(
            actions,
            [
                notified("Questions", "Input needs response", SoundName::Question, false),
                notified("Subagent session", "Session done", SoundName::SubagentDone, false),
            ]
        );
    }

    #[test]
    fn done_waits_for_the_direct_children() {
        let mut fake = Fake::new();
        fake.running.extend(["subagent", "second", "nested"]);
        let mut tracker = Tracker::default();
        let cycle = || [execution("started", "session"), execution("succeeded", "session")];
        assert_eq!(run(&fake, &mut tracker, &cycle()), []);
        fake.running.remove("subagent");
        assert_eq!(run(&fake, &mut tracker, &cycle()), []);
        // The grandchild still running reports to its own parent.
        fake.running.remove("second");
        assert_eq!(run(&fake, &mut tracker, &cycle()), [done()]);
    }

    #[test]
    fn an_error_suppresses_the_following_done() {
        let fake = Fake::new();
        let mut tracker = Tracker::default();
        let actions = run(
            &fake,
            &mut tracker,
            &[execution("started", "session"), failed("session", "unknown"), execution("succeeded", "session")],
        );
        assert_eq!(actions.len(), 2, "{actions:?}");
        assert_eq!(actions[0], notified("Demo session", "boom", SoundName::Error, true));
    }
}
