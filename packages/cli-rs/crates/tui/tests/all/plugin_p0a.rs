//! ABI 1.5 (P0a) in the real TUI: a plugin's confirm and alert, its composer read and edits, and its styled box. One
//! plugin source (`crates/plugin/examples/sample/src/p0a.rs`) runs on every carrier: linked, through the C ABI's byte
//! shims (`Loopback`), and in the sample library. Each table runs on the first two and compares what they draw; the
//! library runs the dialogs and the composer once more.
//!
//! The rows are named by the properties of the rich-plugins design (4.14) so they can move onto the model harness:
//! `no-effects` (a call that panics after queueing every 1.5 effect leaves none of them) and `ledger` (a dialog of a
//! plugin that left `active` calls nothing of it).

use crate::prompt::{Setup, session_route};
use crate::support::{self, Harness};

use std::sync::Arc;

use opencode_plugin::abi;
use opencode_tui::{Deps, Route};
use opentui::prelude::Widget;

#[path = "../../../plugin/examples/sample/src/p0a.rs"]
pub(crate) mod probe;

#[derive(Clone, Copy, Debug, PartialEq)]
enum Carrier {
    Linked,
    Loopback,
}

const CARRIERS: [Carrier; 2] = [Carrier::Linked, Carrier::Loopback];

/// Adds the probe to `h` on `carrier`.
fn add(h: &Harness, carrier: Carrier) {
    let definition = match carrier {
        Carrier::Linked => abi::Plugin { id: "p0a", setup: probe::setup }.into(),
        Carrier::Loopback => {
            opencode_plugin::loader::native::loopback(
                &opencode_tui::plugins::host::host(&h.tui),
                abi::export_plugin!(@loopback "p0a", probe::setup),
            )
            .unwrap()
            .0
        }
    };
    opencode_tui::plugins::host::add(&h.tui, definition);
}

fn home(carrier: Carrier) -> Harness {
    let h = support::mount(100, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    add(&h, carrier);
    h
}

/// The cells on screen without the composer's placeholder example, which is random on each mount: its row from the
/// example's column on, while no dialog covers it (`parity/scenarios/P.1/p0a-dialogs.app.ts` masks the same).
fn cells(h: &Harness) -> Vec<opentui::testing::Cell> {
    let capture = h.app.render();
    let row = h.app.text().lines().position(|line| line.contains("Ask anything")).filter(|_| !h.tui.dialogs.is_open());
    let width = capture.width as usize;
    let example = |index: usize| Some(index / width) == row && index % width >= 16;
    capture.cells.into_iter().enumerate().filter(|(index, _)| !example(*index)).map(|(_, cell)| cell).collect()
}

/// The probe's log, from its storage.
fn log(h: &Harness) -> Vec<String> {
    let json = opencode_plugin::Host::storage_read(&*opencode_tui::plugins::host::host(&h.tui), "plugin.p0a.log");
    json.and_then(|json| serde_json::from_str(&json).ok()).unwrap_or_default()
}

/// The entries of the probe's log that start with `prefix`.
fn logged(h: &Harness, prefix: &str) -> Vec<String> {
    log(h).into_iter().filter(|entry| entry.starts_with(prefix)).collect()
}

/// The lines on screen that contain `text`.
fn toasts(h: &Harness, text: &str) -> usize {
    h.app.text().lines().filter(|line| line.contains(text)).count()
}

// Expected: a confirm opens with `Confirm` active and its labels in title case; enter runs its action with `true`, a
// move to `Cancel` and enter with `false`, escape with `false` (TS `dialog.confirm` resolves `true`, `false`), and a
// dialog that replaces it runs nothing (TS resolves `undefined`). The cells are the same on both carriers.
#[test]
fn a_confirm_answers_true_false_or_nothing_on_both_carriers() {
    let rows: [(&[&str], Option<&str>); 4] = [
        (&["return"], Some("answered true")),
        (&["left", "return"], Some("answered false")),
        (&["escape"], Some("answered false")),
        (&[], None),
    ];
    let mut drawn = Vec::new();
    for carrier in CARRIERS {
        for (keys, answer) in rows {
            let h = home(carrier);
            h.tui.keymap.dispatch("p0a.confirm", None);
            let screen = h.wait_for("Delete the draft?");
            assert!(screen.contains("It cannot be undone.") && screen.contains("Delete"), "{carrier:?}: {screen}");
            assert!(screen.contains("Keep") && !screen.contains("Cancel"), "{carrier:?}: {screen}");
            if keys == ["return"] {
                drawn.push(cells(&h));
            }
            keys.iter().for_each(|key| h.app.press(key));
            match answer {
                Some(answer) => {
                    h.wait_for(answer);
                    h.wait_gone("Delete the draft?");
                    assert_eq!(toasts(&h, "answered"), 1, "{carrier:?} {keys:?}: {}", h.app.text());
                }
                // Replaced by the alert: the confirm's action does not run.
                None => {
                    h.tui.keymap.dispatch("p0a.alert", None);
                    h.wait_for("Heads up");
                    h.wait_gone("Delete the draft?");
                    h.app.advance(std::time::Duration::from_millis(50));
                    assert_eq!(toasts(&h, "answered"), 0, "{carrier:?}: {}", h.app.text());
                }
            }
        }
    }
    assert!(drawn[0] == drawn[1], "the loopback draws the confirm otherwise");
}

// Expected: an alert's action runs once after it closes, by enter, by escape, or when another dialog replaces it, as
// TS resolves the alert's promise in each case. The cells are the same on both carriers.
#[test]
fn an_alert_runs_its_action_once_however_it_closes() {
    let mut drawn = Vec::new();
    for carrier in CARRIERS {
        for close in ["return", "escape", "replace"] {
            let h = home(carrier);
            h.tui.keymap.dispatch("p0a.alert", None);
            let screen = h.wait_for("Heads up");
            assert!(screen.contains("The plugin says hello.") && screen.contains("ok"), "{carrier:?}: {screen}");
            if close == "return" {
                drawn.push(cells(&h));
            }
            match close {
                "replace" => drop(h.tui.keymap.dispatch("p0a.confirm", None)),
                key => h.app.press(key),
            }
            h.wait_for("alert closed");
            h.app.advance(std::time::Duration::from_millis(50));
            assert_eq!(logged(&h, "closed"), ["closed @1"], "{carrier:?} {close}");
            assert_eq!(h.tui.dialogs.is_open(), close == "replace", "{carrier:?} {close}");
        }
    }
    assert!(drawn[0] == drawn[1], "the loopback draws the alert otherwise");
}

/// The probe on `ses_a` with its catalogs loaded, so a submit sends.
fn session(carrier: Carrier) -> Setup {
    let setup = Setup::new(session_route());
    add(&setup, carrier);
    setup.ready();
    setup
}

/// What the probe's `p0a.read` says once the event is done.
fn read(setup: &Setup) -> String {
    // The toast of the last read has gone.
    setup.app.advance(std::time::Duration::from_secs(10));
    setup.wait_gone("composer ");
    setup.tui.keymap.dispatch("p0a.read", None);
    let screen = setup.wait_for("composer ");
    // The toast's rows from the read on, without its frame, joined where the toast wrapped them.
    let rows = screen.lines().skip_while(|line| !line.contains("composer ")).take(3);
    let text = rows.map(|row| row.trim().trim_matches('┃').trim()).collect::<Vec<_>>().join(" ");
    let start = text.find("composer ").unwrap();
    let end = ["true", "false"].iter().find_map(|focus| text.find(focus).map(|at| at + focus.len()));
    text[start..end.unwrap_or_else(|| panic!("no focus in the read:\n{screen}"))].to_owned()
}

// Expected: a plugin reads the composer's text, its cursor as a byte offset and its focus; an insert goes in at the
// cursor as typing does, a set replaces the text and puts the cursor at the end, and a submit sends what the composer
// shows and clears it, as enter does. Both carriers read and edit the same.
#[test]
fn the_composer_reads_and_edits_the_same_on_both_carriers() {
    for carrier in CARRIERS {
        let setup = session(carrier);
        setup.app.type_text("hello");
        setup.app.press("left");
        setup.app.press("left");
        assert_eq!(read(&setup), "composer \"hello\" at 3, focused true", "{carrier:?}");
        setup.tui.keymap.dispatch("p0a.insert", Some("XY"));
        setup.wait("the insert", || setup.textarea().text() == "helXYlo");
        // Typing goes on after what the plugin inserted.
        setup.app.type_text("!");
        assert_eq!(setup.textarea().text(), "helXY!lo", "{carrier:?}");
        setup.tui.keymap.dispatch("p0a.set", Some("héllo wörld"));
        setup.wait("the set", || setup.textarea().text() == "héllo wörld");
        assert_eq!(read(&setup), "composer \"héllo wörld\" at 13, focused true", "{carrier:?}");
        setup.tui.keymap.dispatch("p0a.submit", None);
        let prompts = setup.wait_request("POST", "/api/session/ses_a/prompt", 1);
        assert_eq!(prompts[0]["text"], "héllo wörld", "{carrier:?}");
        setup.wait("the clear", || setup.textarea().text().is_empty());
        // A set keeps the mode, as TS's `ref.set` does.
        setup.app.type_text("!");
        setup.wait_for("Shell");
        setup.tui.keymap.dispatch("p0a.set", Some("ls"));
        setup.wait("the set in shell mode", || setup.textarea().text() == "ls");
        setup.app.advance(std::time::Duration::from_millis(50));
        assert!(setup.app.text().contains("Shell"), "{carrier:?}: {}", setup.app.text());
        setup.app.press("escape");
        setup.wait_for("Build");
        setup.app.press("ctrl+c");
        // With a dialog open the composer keeps its text and loses the focus.
        setup.app.type_text("later");
        setup.tui.keymap.dispatch("p0a.alert", None);
        setup.wait_for("Heads up");
        assert_eq!(read(&setup), "composer \"later\" at 5, focused false", "{carrier:?}");
    }
}

// Expected (bigboi 6, carbon-p0a-5): the cursor a plugin reads is the byte where its insert goes: after a tab, which
// takes two columns in the buffer, across a line break, after a combining mark, a ZWJ emoji and wide characters.
#[test]
fn the_cursor_read_is_where_an_insert_goes() {
    let setup = session(Carrier::Linked);
    for (text, lefts) in [("a\tb", 1), ("\tab\ncd", 4), ("e\u{301}x", 1), ("👨‍👩‍👧x", 1), ("日本語", 1)]
    {
        setup.tui.keymap.dispatch("p0a.set", Some(text));
        setup.wait("the set", || setup.textarea().text() == text);
        (0..lefts).for_each(|_| setup.app.press("left"));
        let read = read(&setup);
        let cursor: usize =
            read.rsplit(" at ").next().and_then(|rest| rest.split(',').next()?.parse().ok()).expect(&read);
        setup.tui.keymap.dispatch("p0a.insert", Some("|"));
        setup.wait("the insert", || setup.textarea().text().contains('|'));
        assert_eq!(setup.textarea().text().find('|'), Some(cursor), "{text:?}: {read}");
    }
}

// Expected (bigboi 5, carbon-p0a-4): a set closes the completion popup of the text it replaces, as TS's `setText`
// tells it, so a set and a submit in one call send exactly the new text from a `/` or an `@` popup. A set whose text
// starts a completion opens its popup, and the submit then sends nothing, as enter does with a popup open.
#[test]
fn a_set_tells_the_completion_of_the_new_text() {
    for (typed, popup) in [("/", "Switch agent"), ("@", "@general")] {
        let setup = session(Carrier::Linked);
        setup.app.type_text(typed);
        setup.wait_for(popup);
        setup.tui.keymap.dispatch("p0a.send", Some("plain words"));
        let prompts = setup.wait_request("POST", "/api/session/ses_a/prompt", 1);
        assert_eq!(prompts[0]["text"], "plain words", "{typed}");
        setup.wait("the clear", || setup.textarea().text().is_empty());
        setup.wait_gone(popup);
    }
    let setup = session(Carrier::Linked);
    setup.tui.keymap.dispatch("p0a.send", Some("/rev"));
    setup.wait_for("/review");
    setup.app.advance(std::time::Duration::from_millis(50));
    assert_eq!(setup.textarea().text(), "/rev");
    assert!(setup.requests("POST", "/prompt").is_empty());
}

/// The probe with the prompt fixture on `route`, answering `reads`, once the catalogs are read, so a submit that the
/// host lets through would send.
fn serving(route: Route, reads: Vec<(&str, serde_json::Value)>) -> Setup {
    serving_at(route, reads, 90)
}

/// [`serving`] on a terminal `width` columns wide.
fn serving_at(route: Route, reads: Vec<(&str, serde_json::Value)>, width: u16) -> Setup {
    let setup = Setup::serving(route, reads, width);
    add(&setup, Carrier::Linked);
    setup.wait("the catalog", || !setup.requests("GET", "/api/model").is_empty());
    setup.app.advance(std::time::Duration::from_millis(50));
    setup
}

/// Asserts that a set and a submit from the plugin leave the composer's text `draft` and send nothing.
#[track_caller]
fn refused(setup: &Setup, draft: &str) {
    setup.tui.keymap.dispatch("p0a.send", Some("from the plugin"));
    setup.app.advance(std::time::Duration::from_millis(100));
    assert_eq!(setup.textarea().text(), draft);
    assert!(setup.requests("POST", "/prompt").is_empty(), "{:?}", setup.requests("POST", "/prompt"));
    assert!(setup.requests("POST", "/api/session").is_empty());
}

/// Asserts that the plugin reads no composer.
#[track_caller]
fn unread(setup: &Setup) {
    setup.tui.keymap.dispatch("p0a.read", None);
    setup.wait_for("no composer");
}

// Expected (bigboi 1, carbon-p0a-6): a composer that a session hides, where TS unmounts it, is no composer to a plugin:
// for a form, a permission and the drawer it reads `None`, and a set and a submit change and send nothing.
#[test]
fn a_hidden_composer_is_not_read_or_edited() {
    let field = serde_json::json!([{ "key": "ok", "type": "boolean", "title": "Continue?" }]);
    let form = serde_json::json!({ "id": "frm_1", "sessionID": "ses_a", "title": "Deploy settings", "fields": field });
    let permission = serde_json::json!({ "id": "per_1", "sessionID": "ses_a", "action": "shell", "resources": ["ls -la"], "save": [] });
    let rows = [
        ("/api/session/ses_a/form", serde_json::json!({ "data": [form] }), "Deploy settings"),
        ("/api/session/ses_a/permission", serde_json::json!({ "data": [permission] }), "ls -la"),
    ];
    for (path, value, shown) in rows {
        let setup = serving(session_route(), vec![(path, value)]);
        setup.wait_for(shown);
        setup.wait("the hidden prompt", || !setup.textarea().is_shown());
        unread(&setup);
        refused(&setup, "");
    }
    // The drawer hides the composer over a draft.
    let setup = serving(session_route(), Vec::new());
    setup.app.type_text("unsent");
    setup.tui.keymap.dispatch("session.child.first", None);
    setup.wait("the drawer", || !setup.textarea().is_shown());
    unread(&setup);
    refused(&setup, "unsent");
}

// Expected (bigboi 1, carbon-p0a-6): a composer that shows but may not submit, under a home form or while another
// pane owns the input, takes a set but no submit from a plugin, as TS's `ref.set` sets and its `submit` refuses a
// disabled prompt.
#[test]
fn a_disabled_composer_takes_no_submit() {
    let field = serde_json::json!([{ "key": "token", "type": "string", "title": "Token" }]);
    let form = serde_json::json!({ "id": "frm_g", "sessionID": "global", "title": "MCP server needs a token", "fields": field });
    let setup = serving(Route::Home, vec![("/api/form", support::list("/project", serde_json::json!([form])))]);
    setup.wait_for("MCP server needs a token");
    // The set edits the composer, which shows; the submit in the same call sends nothing.
    setup.tui.keymap.dispatch("p0a.send", Some("from the plugin"));
    setup.wait("the set", || setup.textarea().text() == "from the plugin");
    setup.app.advance(std::time::Duration::from_millis(100));
    assert!(setup.requests("POST", "/api/session").is_empty() && setup.requests("POST", "/prompt").is_empty());
    // The diff viewer, docked beside the session at this width, takes the input; the composer still shows.
    let diff = serde_json::json!({
        "file": "src/main.rs", "patch": "@@ -1 +1 @@\n-old\n+new\n", "additions": 1, "deletions": 1, "status": "modified",
    });
    let reads = vec![
        ("/api/session/ses_a/diff", serde_json::json!({ "data": [diff] })),
        ("/api/vcs/diff", support::list("/project", serde_json::json!([diff]))),
        ("/api/vcs/base", support::list("/project", serde_json::Value::Null)),
    ];
    let setup = serving_at(session_route(), reads, 160);
    setup.app.type_text("unsent");
    setup.tui.keymap.dispatch("diff.open", None);
    setup.wait_for("src/main.rs");
    setup.wait("the right pane", || !setup.textarea().is_focused());
    assert!(setup.textarea().is_shown(), "the diff viewer hides the composer:\n{}", setup.app.text());
    setup.tui.keymap.dispatch("p0a.submit", None);
    setup.app.advance(std::time::Duration::from_millis(100));
    assert_eq!(setup.textarea().text(), "unsent");
    assert!(setup.requests("POST", "/prompt").is_empty());
}

// Expected (bigboi 1): behind an ordinary dialog the composer still shows, and a plugin's submit sends it; the dialog
// stays open and nothing answers it.
#[test]
fn a_submit_behind_a_dialog_sends_and_leaves_the_dialog() {
    let setup = session(Carrier::Linked);
    setup.tui.keymap.dispatch("p0a.alert", None);
    setup.wait_for("Heads up");
    setup.tui.keymap.dispatch("p0a.send", Some("sent behind"));
    let prompts = setup.wait_request("POST", "/api/session/ses_a/prompt", 1);
    assert_eq!(prompts[0]["text"], "sent behind");
    setup.app.advance(std::time::Duration::from_millis(100));
    assert!(setup.tui.dialogs.is_open() && setup.app.text().contains("Heads up"), "{}", setup.app.text());
    assert!(!setup.app.text().contains("alert closed"), "{}", setup.app.text());
}

/// A store signal of event `kind` in the fixture's directory, with `data`.
fn event(kind: &str, data: serde_json::Value) -> opencode_api::generated::V2Event {
    let id = format!("evt_{}", data.to_string().len());
    let json = serde_json::json!({
        "id": id, "created": 1, "type": kind, "location": { "directory": support::DIRECTORY }, "data": data,
    });
    serde_json::from_value(json).unwrap()
}

fn changed(file: &str) -> opencode_api::generated::V2Event {
    event("filesystem.changed", serde_json::json!({ "file": file, "event": "change" }))
}

// Expected (bigboi 4): of two store signals the UI routes in one batch, the second sees the composer edit a plugin
// asked for while the first was handled, and a route switch that the second makes does not carry the edit to the
// next session's composer; on both carriers.
#[test]
fn a_composer_edit_is_not_overtaken_by_the_next_signal() {
    for carrier in CARRIERS {
        let setup = session(carrier);
        opencode_tui::features::events::testing::signal(&setup.tui, changed("src/set.rs"));
        opencode_tui::features::events::testing::signal(&setup.tui, changed("src/read.rs"));
        setup.wait("the read", || !logged(&setup, "read").is_empty());
        assert_eq!(logged(&setup, "read"), ["read from an event"], "{carrier:?}");
        // A wake in the same batch as the signal that set the composer: the wake handler reads the new text.
        setup.tui.keymap.dispatch("p0a.set", Some(""));
        setup.wait("the clear", || setup.textarea().text().is_empty());
        opencode_tui::features::events::testing::signal(&setup.tui, changed("src/set.rs"));
        setup.tui.keymap.dispatch("p0a.wake", None);
        setup.wait("the wake", || !logged(&setup, "woke").is_empty());
        assert_eq!(logged(&setup, "woke"), ["woke from an event"], "{carrier:?}");

        let setup = Setup::new(Route::Home);
        add(&setup, carrier);
        setup.ready();
        opencode_tui::features::events::testing::signal(&setup.tui, changed("src/set.rs"));
        let select = event("tui.session.select", serde_json::json!({ "sessionID": "ses_a" }));
        opencode_tui::features::events::testing::signal(&setup.tui, select);
        setup.wait("the session", || matches!(setup.tui.route(), Route::Session { .. }));
        setup.app.advance(std::time::Duration::from_millis(100));
        assert_eq!(setup.textarea().text(), "", "{carrier:?}");
        assert!(setup.requests("POST", "/prompt").is_empty(), "{carrier:?}");
    }
}

// Expected: a set starts the history over, as TS's `ref.set` does, so up then recalls the newest entry.
#[test]
fn a_set_starts_the_history_over() {
    let setup = session(Carrier::Linked);
    for (count, text) in [(1, "one"), (2, "two")] {
        setup.app.type_text(text);
        setup.app.press("return");
        setup.wait_request("POST", "/api/session/ses_a/prompt", count);
        setup.wait("the clear", || setup.textarea().text().is_empty());
    }
    setup.app.press("up");
    setup.app.press("up");
    assert_eq!(setup.textarea().text(), "one");
    setup.tui.keymap.dispatch("p0a.set", Some("fresh"));
    setup.wait("the set", || setup.textarea().text() == "fresh");
    // The first up moves to the start of the text, the second to the newest entry.
    setup.app.press("up");
    setup.app.press("up");
    assert_eq!(setup.textarea().text(), "two");
}

// Expected (`no-effects`): a call that sets, inserts and submits the composer and opens a confirm and an alert, then
// panics, leaves the composer's text, sends no prompt and opens no dialog, on both carriers. Guard: the same call
// without the panic does all of it.
#[test]
fn a_call_that_panics_leaves_no_composer_edit_and_no_dialog() {
    for carrier in CARRIERS {
        for panics in [false, true] {
            let setup = session(carrier);
            setup.app.type_text("draft");
            setup.tui.keymap.dispatch("p0a.all", panics.then_some("panic"));
            match panics {
                // Each effect shows: the prompt sent, the alert closed by the confirm that replaced it, the confirm.
                false => {
                    let prompts = setup.wait_request("POST", "/api/session/ses_a/prompt", 1);
                    assert_eq!(prompts[0]["text"], "all of it", "{carrier:?}");
                    setup.wait_for("Delete the draft?");
                    setup.wait("the alert's close", || logged(&setup, "closed") == ["closed @1"]);
                    assert_eq!(setup.textarea().text(), "", "{carrier:?}");
                }
                true => {
                    setup.wait_for("Plugin failed: p0a");
                    assert_eq!(setup.textarea().text(), "draft", "{carrier:?}");
                    assert!(setup.requests("POST", "/prompt").is_empty(), "{carrier:?}");
                    assert!(!setup.tui.dialogs.is_open(), "{carrier:?}: {}", setup.app.text());
                    assert!(logged(&setup, "closed").is_empty(), "{carrier:?}");
                }
            }
        }
    }
}

// Expected (`no-effects`; bigboi 3): of three dispose callbacks, the one that queues a set, a submit and an alert and
// then panics leaves none of it, and the two around it run and keep what they wrote; on both carriers.
#[test]
fn a_dispose_callback_that_panics_leaves_no_effects() {
    for carrier in CARRIERS {
        let setup = session(carrier);
        setup.app.type_text("untouched");
        setup.tui.keymap.dispatch("p0a.teardown", None);
        setup.wait("the arming", || logged(&setup, "teardown").len() == 1);
        let host = opencode_tui::plugins::host::host(&setup.tui);
        assert!(setup.tui.plugins.set_active(&host, "p0a", false));
        setup.app.advance(std::time::Duration::from_millis(100));
        assert_eq!(setup.textarea().text(), "untouched", "{carrier:?}");
        assert!(setup.requests("POST", "/prompt").is_empty(), "{carrier:?}");
        assert!(!setup.tui.dialogs.is_open(), "{carrier:?}: {}", setup.app.text());
        assert_eq!(logged(&setup, "disposed"), ["disposed last @1", "disposed first @1"], "{carrier:?}");
        assert!(logged(&setup, "teardown wrote").is_empty(), "{carrier:?}");
    }
}

/// A plugin that logs each run of its command `witness.ran` in its storage.
fn witness() -> abi::Plugin {
    fn setup(setup: &mut abi::Setup) -> Result<(), String> {
        setup.storage_key("ran");
        let command = abi::Command { name: "witness.ran".to_owned(), ..abi::Command::default() };
        setup.command(command, |host, _| {
            let ran = host.storage_get("ran").and_then(|ran| ran["count"].as_u64()).unwrap_or(0);
            host.storage_set("ran", serde_json::json!({ "count": ran + 1 }));
        });
        let alert = abi::Command { name: "witness.alert".to_owned(), ..abi::Command::default() };
        setup.command(alert, |host, _| {
            let message = "A dialog of another plugin.".to_owned();
            host.dialog(abi::Dialog::Alert(abi::Alert { title: "Witness says".to_owned(), message, action: None }));
        });
        Ok(())
    }
    abi::Plugin { id: "witness", setup }
}

/// How often `witness.ran` ran.
fn witnessed(h: &Harness) -> u64 {
    let json = opencode_plugin::Host::storage_read(&*opencode_tui::plugins::host::host(&h.tui), "plugin.witness.ran");
    json.and_then(|json| serde_json::from_str::<serde_json::Value>(&json).ok()?["count"].as_u64()).unwrap_or(0)
}

// Expected (`ledger`; bigboi 2, carbon-p0a-7): a plugin's alert closes when the plugin is disabled, and the composer
// has the focus again; nothing it answers reaches the old activation, the new one after the plugin is enabled again,
// or another plugin's command it names. The answer to a dialog that closes in the same turn as a disable and an enable
// reaches nobody either. The plugin model (`plugin_model.rs`) runs the rest of the confirm's and alert's life against
// its own commands; these rows add another plugin's command, a turn the model does not split, and both carriers.
#[test]
fn a_dialog_of_a_disabled_plugin_goes_and_answers_nobody() {
    for carrier in CARRIERS {
        for (open, title) in [("p0a.alert", "Heads up"), ("p0a.alert-foreign", "Heads up")] {
            let h = home(carrier);
            opencode_tui::plugins::host::add(&h.tui, witness().into());
            let host = opencode_tui::plugins::host::host(&h.tui);
            h.tui.keymap.dispatch(open, None);
            h.wait_for(title);
            assert!(h.tui.plugins.set_active(&host, "p0a", false));
            h.wait_gone(title);
            h.wait("the composer's focus", || h.textarea().is_focused());
            assert!(h.tui.plugins.set_active(&host, "p0a", true));
            h.app.press("return");
            h.app.advance(std::time::Duration::from_millis(50));
            let answers: Vec<_> = log(&h).into_iter().filter(|entry| !entry.starts_with("setup ")).collect();
            assert!(answers.iter().all(|entry| entry.starts_with("disposed ")), "{carrier:?} {open}: {answers:?}");
            assert_eq!(witnessed(&h), 0, "{carrier:?} {open}");
            // Disabled and enabled in one turn, then answered: the dialog of the first activation answers nobody.
            h.tui.keymap.dispatch(open, None);
            h.wait_for(title);
            assert!(h.tui.plugins.set_active(&host, "p0a", false) && h.tui.plugins.set_active(&host, "p0a", true));
            h.app.press("return");
            h.app.advance(std::time::Duration::from_millis(50));
            h.wait_gone(title);
            let answers: Vec<_> = log(&h).into_iter().filter(|entry| !entry.starts_with("setup ")).collect();
            assert!(answers.iter().all(|entry| entry.starts_with("disposed ")), "{carrier:?} {open}: {answers:?}");
            assert_eq!(witnessed(&h), 0, "{carrier:?} {open}");
        }
    }
}

// Expected (bigboi 2): a dialog that a plugin asked for and that arrives after the plugin was disabled does not show,
// so it does not replace the dialog the user has open.
#[test]
fn a_dialog_of_a_plugin_that_is_not_live_does_not_show() {
    for carrier in CARRIERS {
        let h = home(carrier);
        opencode_tui::plugins::host::add(&h.tui, witness().into());
        h.tui.keymap.dispatch("witness.alert", None);
        h.wait_for("Witness says");
        h.tui.keymap.dispatch("p0a.alert", None);
        assert!(h.tui.plugins.set_active(&opencode_tui::plugins::host::host(&h.tui), "p0a", false));
        h.app.advance(std::time::Duration::from_millis(50));
        let screen = h.app.text();
        assert!(screen.contains("Witness says") && !screen.contains("Heads up"), "{carrier:?}: {screen}");
    }
}

// Expected (`ledger`): a plugin's alert goes when a later call of the plugin panics, and the composer has the focus
// again; its action, another plugin's command, does not run as it closes: a failed plugin's dialog answers nobody.
#[test]
fn a_dialog_of_a_failed_plugin_goes_and_answers_nobody() {
    for carrier in CARRIERS {
        let h = home(carrier);
        opencode_tui::plugins::host::add(&h.tui, witness().into());
        h.tui.keymap.dispatch("p0a.alert-foreign", None);
        h.wait_for("Heads up");
        h.tui.keymap.dispatch("p0a.all", Some("panic"));
        h.wait_for("Plugin failed: p0a");
        h.wait_gone("Heads up");
        h.wait("the composer's focus", || h.textarea().is_focused());
        h.app.advance(std::time::Duration::from_millis(50));
        assert_eq!(witnessed(&h), 0, "{carrier:?}");
    }
}

// Expected: a confirm or an alert that closed no longer belongs to its plugin, so the dialog the host opens after it,
// the plugin manager, stays open when the plugin is disabled.
#[test]
fn a_closed_dialog_leaves_the_next_one_to_the_host() {
    for (open, title) in [("p0a.confirm", "Delete the draft?"), ("p0a.alert", "Heads up")] {
        let h = home(Carrier::Linked);
        h.tui.keymap.dispatch(open, None);
        h.wait_for(title);
        h.app.press("escape");
        h.wait_gone(title);
        h.tui.keymap.dispatch("plugins.list", None);
        h.wait("the plugin manager", || h.tui.dialogs.is_open());
        let manager = h.tui.dialogs.key();
        assert!(h.tui.plugins.set_active(&opencode_tui::plugins::host::host(&h.tui), "p0a", false));
        h.app.advance(std::time::Duration::from_millis(50));
        assert!(h.tui.dialogs.is_open() && h.tui.dialogs.key() == manager, "{open}: {}", h.app.text());
    }
}

// Expected (bigboi 2): a dialog of a live plugin that names another plugin's command runs it, once.
#[test]
fn a_live_dialog_runs_a_foreign_command_once() {
    let h = home(Carrier::Linked);
    opencode_tui::plugins::host::add(&h.tui, witness().into());
    h.tui.keymap.dispatch("p0a.alert-foreign", None);
    h.wait_for("Heads up");
    h.app.press("return");
    h.wait("the witness", || witnessed(&h) == 1);
    h.app.advance(std::time::Duration::from_millis(50));
    assert_eq!(witnessed(&h), 1);
}

// Expected: a styled box draws its rounded border with the centered title, the heavy left rule and its padding inside
// the box's padding, the chips wrapped to the box's width and cut at its height, at its margin and its width (the
// slot's root takes the margin, once); the same cells on both carriers.
#[test]
fn a_styled_box_draws_the_same_on_both_carriers() {
    let drawn: Vec<_> = CARRIERS
        .iter()
        .map(|carrier| {
            let h = home(*carrier);
            h.wait_for("p0a");
            (cells(&h), h.app.text())
        })
        .collect();
    let screen = &drawn[0].1;
    let rows: Vec<&str> = screen.lines().skip_while(|line| !line.contains("p0a")).take(5).collect();
    assert_eq!(
        rows.iter().map(|row| row.trim_end()).collect::<Vec<_>>(),
        // As TS draws it (parity/scenarios/P.1/p0a-dialogs.app.ts): the wrapped chips' second row is past the height.
        [
            "  ╭─────────p0a──────────╮",
            "  │  ┃ ruled             │",
            "  │  alpha beta gamma    │",
            "  │                      │",
            "  ╰──────────────────────╯",
        ],
        "{screen}"
    );
    assert!(drawn[0].0 == drawn[1].0, "the loopback draws the box otherwise");
}

// Expected: the sample library built with the probe shows the same confirm, answers it, and edits the composer.
#[test]
fn the_sample_library_confirms_and_edits_the_composer() {
    let h = crate::plugins::open(Route::Home, "", &crate::plugins::build("p0a"));
    h.wait_for("sample plugin v1: home.footer");
    h.tui.keymap.dispatch("p0a.confirm", None);
    h.wait_for("Delete the draft?");
    h.app.press("return");
    h.wait_for("answered true");
    h.tui.keymap.dispatch("p0a.insert", Some("from a library"));
    h.wait("the insert", || h.textarea().text() == "from a library");
    h.tui.keymap.dispatch("p0a.read", None);
    h.wait_for("composer \"from a library\" at 14, focused true");
}
