//! The MS1 review fixes carbon-3 and carbon-7 through the whole TUI:
//!
//! - model and agent state follow the open session's location, and acknowledged commits clear their
//!   drafts (`context/local.tsx`);
//! - `session.json` and `prompt-history.jsonl` keep what another client wrote, prompts submitted before
//!   the history loads are kept, and `session.deleted` prunes its pin.

use crate::support::{self, Fake, Harness, Log, WAIT, deref_harness, list};

use std::rc::Rc;
use std::sync::Arc;

use opencode_api::generated::{SessionID, V2Event};
use opencode_local::model_pref::Model;
use opencode_tui::dialogs::session_list::pins;
use opencode_tui::prompt::history::History;
use opencode_tui::{Deps, Route};
use opentui::testing::TestApp;
use serde_json::{Value, json};

/// Serves `ses_b` in `/project-b` with its project-local primary agent `reviewer`, which `/project`
/// lacks, and the prompt writes.
fn fake() -> Fake {
    Fake::new(|seen| {
        let directory = Some(seen.param("location[directory]")).filter(|value| !value.is_empty());
        let directory = directory.as_deref().unwrap_or("/project");
        let agent = |id| support::agent(id, "primary", false);
        let agents = if directory == "/project-b" {
            json!([agent("build"), agent("reviewer")])
        } else {
            json!([agent("build"), agent("plan")])
        };
        match (seen.method.as_str(), seen.path.as_str()) {
            ("GET", "/api/session") => (200, json!({ "data": [session()], "cursor": {} })),
            ("GET", "/api/session/ses_b") => (200, json!({ "data": session() })),
            ("GET", "/api/session/ses_b/message") => (200, json!({ "data": [], "cursor": {} })),
            ("GET", "/api/agent") => (200, list(directory, agents)),
            ("GET", "/api/model") => (
                200,
                list(
                    directory,
                    json!([
                        support::model("anthropic", "claude-sonnet", "Claude Sonnet"),
                        support::model("anthropic", "claude-haiku", "Claude Haiku"),
                        support::model("openai", "gpt-5", "GPT-5"),
                    ]),
                ),
            ),
            ("GET", "/api/config") => (200, json!([])),
            ("GET", "/api/location") => (200, support::location(directory)),
            ("GET", path) if path.starts_with("/api/") && !path.starts_with("/api/session") => {
                (200, list(directory, json!([])))
            }
            ("POST", path) if path.ends_with("/prompt") => (200, support::prompted(seen, "steer")),
            ("POST", path) if path.ends_with("/model") || path.ends_with("/agent") => (204, Value::Null),
            ("GET", path) if path.starts_with("/api/session/ses_b/") => (200, json!({ "data": [] })),
            _ => support::not_found(),
        }
    })
}

fn session() -> Value {
    json!({
        "id": "ses_b", "title": "Review the change", "projectID": "project-b", "cost": 0,
        "agent": "reviewer", "model": { "providerID": "anthropic", "id": "claude-sonnet" },
        "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } },
        "time": { "created": 1, "updated": 1 },
        "location": { "directory": "/project-b" },
    })
}

struct Setup {
    harness: Harness,
    seen: Log,
    home: tempfile::TempDir,
    seq: std::cell::Cell<u64>,
}

deref_harness!(Setup);

impl Setup {
    /// The TUI on `ses_b`, started from `/project`, with `state` files written first.
    fn new(state: &[(&str, &str)]) -> Self {
        Self::at(support::session_route("ses_b"), state)
    }

    fn at(route: Route, state: &[(&str, &str)]) -> Self {
        let home = tempfile::tempdir().unwrap();
        let paths = support::paths(home.path());
        std::fs::create_dir_all(&paths.state).unwrap();
        for (name, text) in state {
            std::fs::write(paths.state.join(name), text).unwrap();
        }
        let fake = fake();
        let seen = fake.log();
        let deps = Deps { roots: support::roots(paths, "latest"), route, ..support::deps(Arc::new(fake)) };
        Self { harness: support::mount(100, 30, deps), seen, home, seq: std::cell::Cell::new(0) }
    }

    fn state(&self) -> std::path::PathBuf {
        self.home.path().join("state")
    }

    fn wait(&self, what: &str, check: impl Fn() -> bool) {
        let done = self.app.wait_until(WAIT, &check);
        assert!(done, "{what} never happened:\n{}", self.app.text());
    }

    fn agent(&self) -> Option<String> {
        self.tui.local.agent().map(|agent| agent.id.0)
    }

    fn writes(&self, suffix: &str) -> Vec<Value> {
        self.seen
            .lock()
            .unwrap()
            .iter()
            .filter(|seen| seen.method == "POST" && seen.path.ends_with(suffix))
            .map(|seen| seen.body.clone())
            .collect()
    }

    fn submit(&self, text: &str, prompts: usize) {
        self.app.type_text(text);
        self.app.press("return");
        self.wait("the prompt", || self.writes("/prompt").len() >= prompts);
    }

    /// A durable `ses_b` event, as another client's switch or this one's commit reports it.
    fn emit(&self, kind: &str, data: Value) {
        self.seq.set(self.seq.get() + 1);
        let event: V2Event = serde_json::from_value(json!({
            "id": format!("evt_{}", self.seq.get()), "created": self.seq.get(), "type": kind,
            "durable": { "aggregateID": "ses_b", "seq": self.seq.get(), "version": 1 },
            "location": { "directory": "/project-b" },
            "data": data,
        }))
        .unwrap();
        self.tui.data.apply(&[event]);
    }

    fn file(&self, name: &str) -> String {
        std::fs::read_to_string(self.state().join(name)).unwrap_or_default()
    }
}

/// carbon-3: a session in another project keeps its project-local agent, and a submit does not switch it
/// to `build`.
#[test]
fn a_session_in_another_location_keeps_its_own_agent() {
    let setup = Setup::new(&[]);
    setup.wait("the session's catalog", || {
        setup.tui.local.catalog_ready() && setup.agent().as_deref() == Some("reviewer")
    });
    setup.submit("hello", 1);
    assert!(setup.writes("/agent").is_empty(), "the submit switched the agent: {:?}", setup.writes("/agent"));
}

/// carbon-3: home's `/cd` moves the model and agent state to the new directory, as the prompt's own
/// catalog moves.
#[test]
fn cd_on_home_moves_the_agents_to_the_new_directory() {
    let setup = Setup::at(Route::Home, &[]);
    setup.wait("the home catalog", || setup.tui.local.agents().iter().any(|agent| agent.id.0 == "plan"));
    setup.app.type_text("/cd /project-b");
    setup.app.press("escape");
    setup.app.press("return");
    setup.wait("the new directory's agents", || setup.tui.local.agents().iter().any(|agent| agent.id.0 == "reviewer"));
}

/// carbon-3: once the session reports the agent and model a submit committed, the drafts give way, so a
/// later switch from another client shows.
#[test]
fn acknowledged_commits_clear_the_drafts() {
    let setup = Setup::new(&[]);
    setup.wait("the session's catalog", || setup.agent().as_deref() == Some("reviewer"));
    setup.tui.local.set_agent("build");
    setup.tui.local.set(&Model::new("openai", "gpt-5"), false);
    setup.submit("switch", 1);
    assert_eq!(setup.writes("/agent")[0]["agent"], "build");
    // The model acknowledgment clears the model draft, which `Local` reports.
    let changed = Rc::new(std::cell::Cell::new(false));
    let _listener = setup.tui.local.subscribe({
        let changed = changed.clone();
        move || changed.set(true)
    });
    setup.emit("session.agent.selected", json!({ "sessionID": "ses_b", "agent": "build" }));
    setup.emit(
        "session.model.selected",
        json!({ "sessionID": "ses_b", "model": { "providerID": "openai", "id": "gpt-5" } }),
    );
    // The rename shows once the TUI has synced the acknowledgments with it. Another notification can come
    // first, and a switch applied before that sync would join the acknowledgments' batch.
    setup.emit("session.renamed", json!({ "sessionID": "ses_b", "title": "Acknowledged" }));
    setup.wait_for("Acknowledged");
    assert!(changed.get());
    // Another client switches the model, then the agent.
    setup.emit(
        "session.model.selected",
        json!({ "sessionID": "ses_b", "model": { "providerID": "anthropic", "id": "claude-haiku" } }),
    );
    setup.wait("the other client's model", || {
        setup.tui.local.current() == Some(Model::new("anthropic", "claude-haiku"))
    });
    setup.emit("session.agent.selected", json!({ "sessionID": "ses_b", "agent": "reviewer" }));
    setup.wait("the other client's agent", || setup.agent().as_deref() == Some("reviewer"));
}

/// carbon-7: a pin keeps the pins another client wrote after this one read the file, and
/// `session.deleted` prunes it.
#[test]
fn pins_keep_other_clients_pins_and_prune_deleted_sessions() {
    let setup = Setup::new(&[("session.json", r#"{"pinned":["ses_old"]}"#)]);
    assert_eq!(pins::list(&setup.tui), [SessionID("ses_old".into())]);
    // The TS TUI pins `ses_ts` meanwhile.
    std::fs::write(setup.state().join("session.json"), r#"{"pinned":["ses_old","ses_ts"]}"#).unwrap();
    pins::toggle(&setup.tui, &SessionID("ses_b".into()));
    let pinned = r#"{"pinned":["ses_old","ses_ts","ses_b"]}"#;
    setup.wait("the pin", || setup.file("session.json") == pinned);
    // Quick toggles land in order; the last one pins `ses_old` again, at the end.
    for _ in 0..4 {
        pins::toggle(&setup.tui, &SessionID("ses_old".into()));
    }
    setup.emit("session.deleted", json!({ "sessionID": "ses_b" }));
    let pruned = r#"{"pinned":["ses_ts","ses_old"]}"#;
    setup.wait("the prune", || setup.file("session.json") == pruned);
    assert!(!pins::list(&setup.tui).contains(&SessionID("ses_b".into())));
}

/// carbon-7: a prompt submitted while the history still loads is kept, in memory and in the file.
#[test]
fn a_prompt_appended_before_the_history_loads_is_kept() {
    let state = tempfile::tempdir().unwrap();
    // A long, broken file takes a while to read and heal.
    let junk = "not json\n".repeat(400_000);
    let file = state.path().join("prompt-history.jsonl");
    std::fs::write(&file, format!("{{\"text\":\"old\",\"pasted\":[]}}\n{junk}")).unwrap();
    let app = TestApp::new(20, 5);
    let history = History::load(&app, Some(state.path().to_owned()));
    let entry = json!({ "text": "early", "pasted": [] });
    history.append(&app, entry.clone());
    let saved = app.wait_until(WAIT, || {
        std::fs::read_to_string(&file)
            .is_ok_and(|text| text == "{\"text\":\"old\",\"pasted\":[]}\n{\"text\":\"early\",\"pasted\":[]}\n")
    });
    assert!(saved, "{:?}", std::fs::read_to_string(&file).unwrap().get(..200));
    assert_eq!(history.step(-1, ""), Some(entry));
    assert_eq!(history.step(-1, "early").unwrap()["text"], "old");
}

/// carbon-7: a save past the limit keeps a line the TS TUI appended after this one loaded; the next
/// load trims the file to the newest 50.
#[test]
fn a_save_past_the_limit_keeps_lines_another_client_appended() {
    let full: String = (0..50).map(|n| format!("{{\"text\":\"{n}\",\"pasted\":[]}}\n")).collect();
    let setup = Setup::new(&[("prompt-history.jsonl", &full)]);
    setup.wait("the catalog", || setup.tui.local.catalog_ready());
    // Wait for the load: Up shows the newest entry.
    setup.wait("the history", || setup.tui.prompt.history.step(-1, "").is_some());
    setup.tui.prompt.history.step(1, "49");
    let file = setup.state().join("prompt-history.jsonl");
    let mut append = std::fs::OpenOptions::new().append(true).open(&file).unwrap();
    std::io::Write::write_all(&mut append, b"{\"text\":\"from ts\",\"pasted\":[]}\n").unwrap();
    setup.submit("from rust", 1);
    setup.wait("the save", || setup.file("prompt-history.jsonl").contains("from rust"));
    let history = opencode_local::jsonl::History::load(&setup.state());
    let texts: Vec<&str> = history.entries().iter().filter_map(|entry| entry["text"].as_str()).collect();
    assert_eq!(texts.len(), 50);
    assert_eq!(texts[0], "2");
    assert_eq!(texts[48..], ["from ts", "from rust"]);
    assert_eq!(setup.file("prompt-history.jsonl").lines().count(), 50);
}
