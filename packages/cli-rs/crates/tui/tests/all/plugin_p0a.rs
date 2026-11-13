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

/// The cells on screen without the composer's row, whose placeholder example is random on each mount.
fn cells(h: &Harness) -> Vec<opentui::testing::Cell> {
    let capture = h.app.render();
    let row = h.app.text().lines().position(|line| line.contains("Ask")).unwrap_or(usize::MAX);
    let width = capture.width as usize;
    capture.cells.into_iter().enumerate().filter(|(index, _)| index / width != row).map(|(_, cell)| cell).collect()
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
            assert!(screen.contains("Cancel"), "{carrier:?}: {screen}");
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
            assert_eq!(toasts(&h, "alert closed"), 1, "{carrier:?} {close}: {}", h.app.text());
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
                false => {
                    let prompts = setup.wait_request("POST", "/api/session/ses_a/prompt", 1);
                    assert_eq!(prompts[0]["text"], "all of it", "{carrier:?}");
                    setup.wait_for("Heads up");
                    assert_eq!(setup.textarea().text(), "", "{carrier:?}");
                }
                true => {
                    setup.wait_for("Plugin failed: p0a");
                    assert_eq!(setup.textarea().text(), "draft", "{carrier:?}");
                    assert!(setup.requests("POST", "/prompt").is_empty(), "{carrier:?}");
                    assert!(!setup.tui.dialogs.is_open(), "{carrier:?}: {}", setup.app.text());
                }
            }
        }
    }
}

// Expected (`ledger`): a confirm or an alert that is open when its plugin is disabled calls nothing of the plugin
// once it closes.
#[test]
fn a_dialog_of_a_disabled_plugin_calls_nothing_of_it() {
    for carrier in CARRIERS {
        for (open, title, done) in
            [("p0a.confirm", "Delete the draft?", "answered"), ("p0a.alert", "Heads up", "closed")]
        {
            let h = home(carrier);
            h.tui.keymap.dispatch(open, None);
            h.wait_for(title);
            assert!(h.tui.plugins.set_active(&opencode_tui::plugins::host::host(&h.tui), "p0a", false));
            h.app.press("return");
            h.wait_gone(title);
            h.app.advance(std::time::Duration::from_millis(50));
            assert_eq!(toasts(&h, done), 0, "{carrier:?} {open}: {}", h.app.text());
        }
    }
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
