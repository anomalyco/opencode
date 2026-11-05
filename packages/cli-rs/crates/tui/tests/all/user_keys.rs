//! The user's `keybinds` and `tabs` from `cli.json` (rs-user-keys), fed as the bytes real terminals send: legacy,
//! Kitty (Ghostty adds the Num Lock bit, `CSI 92;133u`), and xterm's modifyOtherKeys.

use crate::support::{self, Harness, WAIT, deref_harness};

use std::sync::Arc;

use opencode_api::memory::{Memory, Route as MemoryRoute};
use opencode_tui::Deps;
use opencode_tui::dialogs::settings;
use serde_json::json;

const LEADERS: [&[u8]; 4] = [b"\x1c", b"\x1b[92;5u", b"\x1b[92;133u", b"\x1b[27;5;92~"];

struct Keys {
    harness: Harness,
    _home: tempfile::TempDir,
}

deref_harness!(Keys);

/// The user's `cli.json`, with `tabs.mode` set to `mode`, at 100 columns.
fn mount(mode: &str) -> Keys {
    mount_at(mode, 100)
}

/// [`mount`] at `width` columns. The vertical rail needs 130 (`sessionTabsFitVertically`).
fn mount_at(mode: &str, width: u16) -> Keys {
    let home = tempfile::tempdir().unwrap();
    let paths = support::home_paths(home.path());
    std::fs::create_dir_all(&paths.state).unwrap();
    let config = json!({
        "keybinds": {
            "leader": "ctrl+\\",
            "session.tab.next": "tab",
            "session.tab.previous": "shift+tab",
            "session.tab.close": "ctrl+w",
            "session.new": "ctrl+n",
            "agent.cycle": "none",
            "input.delete.word.backward": "ctrl+backspace,alt+backspace",
        },
        "tabs": { "enabled": true, "layout": "vertical", "mode": mode },
        "session": { "sidebar": "hide", "verbosity": "low" },
        "experimental": { "new-designs": true },
        "animations": false,
    });
    // On disk as in the user's file (`"ctrl+\\"`), so a settings write keeps the rest of it.
    let text = serde_json::to_string_pretty(&config).unwrap();
    assert!(text.contains(r#""leader": "ctrl+\\""#), "{text}");
    std::fs::create_dir_all(&paths.config).unwrap();
    std::fs::write(paths.config.join("cli.json"), &text).unwrap();
    let deps = Deps {
        config: support::config(support::decode(&text)),
        roots: support::roots(paths, "test"),
        events: true,
        ..support::deps(Arc::new(Memory::new(routes())))
    };
    let h = Keys { harness: support::mount(width, 30, deps), _home: home };
    h.tui.navigate(support::session_route("ses_b"));
    assert!(h.app.wait_until(WAIT, || h.app.text().contains("commands")), "{}", h.app.text());
    h
}

fn routes() -> Vec<MemoryRoute> {
    let mut routes = vec![
        MemoryRoute::json("GET", "/api/session", 200, &json!({ "data": [], "cursor": {} })),
        MemoryRoute::json("GET", "/api/config", 200, &json!([])),
    ];
    for (id, title) in [("ses_a", "Fix the parser"), ("ses_b", "Write the docs")] {
        routes.extend(support::session_routes(&support::test_session(id, title)));
    }
    routes
}

#[test]
fn the_leader_opens_its_commands_in_every_terminal_encoding() {
    for mode in ["off", "on"] {
        let h = mount(mode);
        for leader in LEADERS {
            // After typed text too: the prompt must not take the key after the leader.
            h.app.type_text("hi");
            h.app.feed(leader);
            assert!(h.tui.keymap.leader_active(), "{mode} {leader:?}");
            h.app.feed(b"l");
            let opened = h.app.wait_until(WAIT, || h.app.text().contains("Search sessions"));
            assert!(opened, "{mode} {leader:?}:\n{}", h.app.text());
            h.app.feed(b"\x1b");
            assert!(h.app.wait_until(WAIT, || !h.app.text().contains("Search sessions")));
        }
    }
}

#[test]
fn tab_and_shift_tab_cycle_tabs_only_while_tabs_are_on() {
    // `tabs.mode` wins over the legacy `enabled` (TS `config/index.tsx:295`), so "off" turns tabs off.
    let h = mount("off");
    for key in [&b"\t"[..], b"\x1b[Z"] {
        h.app.feed(key);
        assert_eq!(h.tui.route(), support::session_route("ses_b"));
    }
    assert!(h.tui.tabs.tabs(&h.tui).is_empty());

    let h = mount("on");
    // Legacy, Kitty, Kitty with Num Lock (Ghostty), and modifyOtherKeys forms of tab and shift+tab.
    let steps: [(&[u8], &str); 7] = [
        (b"\t", "ses_a"),
        (b"\x1b[9u", "ses_b"),
        (b"\x1b[Z", "ses_a"),
        (b"\x1b[9;2u", "ses_b"),
        (b"\x1b[9;130u", "ses_a"),
        (b"\x1b[27;2;9~", "ses_b"),
        (b"\x17", "ses_a"),
    ];
    for (key, target) in steps {
        h.app.feed(key);
        let moved = h.app.wait_until(WAIT, || h.tui.route() == support::session_route(target));
        assert!(moved, "{key:?}: {:?}", h.tui.route());
    }
    // `ctrl+w` closed ses_b.
    let ids: Vec<String> = h.tui.tabs.tabs(&h.tui).into_iter().map(|tab| tab.session_id).collect();
    assert_eq!(ids, ["ses_a"]);
}

#[test]
fn turning_tabs_on_in_settings_shows_a_rail_that_keys_and_clicks_drive() {
    let h = mount_at("off", 130);
    assert!(!h.app.text().contains("Write the docs"), "{}", h.app.text());

    // `/settings` → Tabs → Mode, as the user would switch it.
    settings::update(&h.tui, |draft| settings::set_path(draft, &["tabs", "mode"], json!("on")));
    let shown = h.app.wait_until(WAIT, || h.app.text().contains("Write the docs"));
    assert!(shown, "the routed session got no tab:\n{}", h.app.text());
    h.tui.navigate(support::session_route("ses_a"));
    let both = h.app.wait_until(WAIT, || {
        let text = h.app.text();
        text.contains("Write the docs") && text.contains("Fix the parser")
    });
    assert!(both, "{}", h.app.text());

    h.app.feed(b"\t");
    assert!(h.app.wait_until(WAIT, || h.tui.route() == support::session_route("ses_b")));

    // A click on the other tab's title in the vertical rail selects it.
    let text = h.app.text();
    assert!(text.contains("+ New session"), "no vertical rail:\n{text}");
    let (row, line) = text.lines().enumerate().find(|(_, line)| line.contains("Fix the parser")).unwrap();
    let column = line[..line.find("Fix the parser").unwrap()].chars().count();
    h.app.click(column as u16 + 2, row as u16);
    let selected = h.app.wait_until(WAIT, || h.tui.route() == support::session_route("ses_a"));
    assert!(selected, "{:?}:\n{}", h.tui.route(), h.app.text());
}
