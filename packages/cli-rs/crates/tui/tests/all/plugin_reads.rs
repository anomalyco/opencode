//! The small reads and verbs of ABI 1.6 (P0b) on the real TUI, each on both paths: in process and through the C
//! ABI's byte shims (`Loopback`). A test plugin shows what it reads in a sized `home.footer` claim and toasts what each
//! verb answers. The loader's tests compare the two paths on a test host
//! (`the_1_6_reads_and_verbs_are_the_same_in_process_and_through_the_library`).

use crate::support::{self, Harness};

use std::cell::{Cell, RefCell};
use std::ffi::c_void;
use std::rc::Rc;
use std::sync::Arc;

use opencode_api::memory::{Memory, Route as MemoryRoute};
use opencode_plugin::abi;
use opencode_tui::{Deps, Route};
use serde_json::{Value, json};

/// Commands of one verb each, which toast what the verb answered, and a sized home claim that shows what it reads.
fn reader(setup: &mut abi::Setup) -> Result<(), String> {
    let command = |name: &str| abi::Command { name: name.to_owned(), ..abi::Command::default() };
    let toast = |host: &dyn abi::Host, text: String| host.toast(abi::Toast::new(abi::Variant::Info, text));
    setup.command(command("p0b.open"), move |host, input| {
        let opened = host.edit_tab(abi::TabEdit::Open { session: input.unwrap_or_default().to_owned() });
        toast(host, format!("p0b open {opened}"));
    });
    setup.command(command("p0b.move"), move |host, input| {
        let moved = host.edit_tab(abi::TabEdit::Move { session: input.unwrap_or_default().to_owned(), index: 0 });
        toast(host, format!("p0b move {moved}"));
    });
    setup.command(command("p0b.close"), move |host, input| {
        let closed = host.edit_tab(abi::TabEdit::Close { session: input.map(str::to_owned) });
        toast(host, format!("p0b close {closed}"));
    });
    setup.command(command("p0b.theme"), move |host, input| {
        toast(host, format!("p0b theme {}", host.set_theme(input.unwrap_or_default())));
    });
    setup.command(command("p0b.variant"), move |host, _| {
        let (high, default) = (host.set_variant(Some("high")), host.set_variant(None));
        toast(host, format!("p0b variant {high} {default}"));
    });
    setup.command(command("p0b.selection"), move |host, _| {
        toast(host, format!("p0b selection {:?}", host.selection()));
        host.clear_selection();
    });
    setup.command(command("p0b.wide"), |host, _| {
        host.dialog(abi::Dialog::Panel(abi::Panel {
            key: "wide".to_owned(),
            size: abi::PanelSize::XLarge,
            title: vec![abi::Span::new("Wide")],
            subtitle: None,
            body: abi::Node::text([abi::Span::new("p0b wide body")]),
            actions: Vec::new(),
            binds: Vec::new(),
            bleed: false,
            centered: false,
        }));
    });
    let program = Rc::new(Cell::new(None));
    let asked = program.clone();
    setup.command(command("p0b.run"), move |host, input| {
        let args = vec!["-c".to_owned(), input.unwrap_or_default().to_owned()];
        // The test's working directory: the TUI's is a fake one.
        let cwd = Some(".".to_owned());
        asked.set(Some(host.foreground(abi::Foreground { command: "sh".to_owned(), args, cwd })));
    });
    let exited = Rc::new(RefCell::new("-".to_owned()));
    let told = exited.clone();
    setup.on_reply(move |_, id, result| {
        if program.get() == Some(id) {
            *told.borrow_mut() = result.map_or_else(|error| error, |value| value["code"].to_string());
        }
    });
    let deltas = Rc::new(RefCell::new(String::new()));
    let streamed = deltas.clone();
    setup.on_deltas(move |_, events| {
        // The host never calls with none.
        if events.is_empty() {
            streamed.borrow_mut().push('!');
        }
        for event in events {
            if let abi::types::V2Event::SessionTextDelta(delta) = event {
                streamed.borrow_mut().push_str(&delta.data.delta);
            }
        }
    });
    setup.slot(abi::Placement::append("home.footer"), move |read, input, _| {
        let tabs: Vec<String> = read.tabs().into_iter().map(|tab| tab.session_id).collect();
        let reachable = read.keymap_commands().iter().any(|command| command.id == "p0b.open");
        let pending: Vec<String> = read.keymap_pending().into_iter().map(|key| key.key).collect();
        let continues = read.keymap_active().iter().filter(|key| key.continues).count();
        let text = format!(
            "p0b w{} {} [{}] {} {reachable} {} {} d:{} x:{} c{}",
            input.width,
            read.theme().unwrap_or_default(),
            tabs.join(","),
            read.shortcuts("command.palette.show").join(","),
            pending.join(" "),
            read.variants().len(),
            deltas.borrow(),
            exited.borrow(),
            continues.min(1),
        );
        abi::Render::Show(abi::Node::text([abi::Span::new(text).link("https://opencode.ai/p0b")]))
    });
    setup.sized(abi::Placement::append("home.footer"));
    Ok(())
}

/// The TUI's home with `reader` active, in process or through the byte shims, on a server of two sessions, with
/// `config`; and the server.
fn home(loopback: bool, width: u16, config: Value) -> (Harness, Memory, opencode_util::temp::TempDir) {
    let root = opencode_util::temp::tempdir().unwrap();
    let paths = support::home_paths(root.path());
    std::fs::create_dir_all(&paths.state).unwrap();
    let mut routes: Vec<MemoryRoute> = [("ses_a", "Fix the parser"), ("ses_b", "Write the docs")]
        .iter()
        .flat_map(|(id, title)| support::session_routes(&support::test_session(id, title)))
        .collect();
    routes.push(MemoryRoute::json("GET", "/api/session", 200, &json!({ "data": [], "cursor": {} })));
    let memory = Memory::new(routes);
    let deps = Deps {
        route: Route::Home,
        config: support::config(support::decode(&config.to_string())),
        roots: support::roots(paths, "p0b"),
        events: true,
        ..support::deps(Arc::new(memory.clone()))
    };
    let h = support::mount(width, 30, deps);
    let create: unsafe extern "C" fn(*const abi::HostApi, abi::Bytes, *mut *mut c_void, *mut abi::Owned) -> i32 =
        abi::export_plugin!(@loopback "p0b", reader);
    let definition = match loopback {
        true => {
            opencode_plugin::loader::native::loopback(&opencode_tui::plugins::host::host(&h.tui), create).unwrap().0
        }
        false => abi::Plugin { id: "p0b", setup: reader }.into(),
    };
    opencode_tui::plugins::host::add(&h.tui, definition);
    (h, memory, root)
}

// Expected: a sized claim reads its laid-out width and renders again when a resize changes it; it reads the theme,
// the palette's key, that its own hidden command can be reached, and no variants without a model; a variant, also the
// default, is refused without a model, as TS refuses it. Its span is an OSC 8 link. On both paths.
#[test]
fn a_claim_reads_its_width_the_theme_and_the_keymap() {
    for loopback in [false, true] {
        let (h, _memory, _root) = home(loopback, 100, json!({}));
        let screen = h.wait_for("p0b w100 opencode [] ctrl+p true  0 d: x:-");
        let row = screen.lines().position(|line| line.contains("p0b w100")).unwrap();
        let column = screen.lines().nth(row).unwrap().find("p0b").unwrap();
        let link = opencode_tui::features::links::link_at(h.app.app(), column as u16, row as u16);
        assert_eq!(link.as_deref(), Some("https://opencode.ai/p0b"), "loopback {loopback}");
        h.app.resize(90, 30);
        h.wait_for("p0b w90 ");
        h.tui.keymap.dispatch("p0b.variant", None);
        h.wait_for("p0b variant false false");
    }
}

// Expected: the pending keys read as the TUI shows them, the active keys include one that continues a sequence (the
// leader), and the claim renders again as the sequence starts and ends.
#[test]
fn a_claim_follows_the_pending_keys() {
    for loopback in [false, true] {
        let (h, _memory, _root) = home(loopback, 120, json!({}));
        h.wait_for("p0b w120 ");
        h.wait_for(" c1");
        h.app.press("ctrl+x");
        h.wait_for("true ctrl+x 0");
        h.app.press("escape");
        h.wait_for("true  0");
    }
}

// Expected (TS `ui.tabs`): with tabs on, `open` adds a tab without showing it, `move` reorders an open tab and refuses
// one that is not open, and `close` closes a named tab and refuses with no tab on screen; the claim reads the tabs in
// order after each change. With tabs off every verb is refused. On both paths.
#[test]
fn tabs_open_move_and_close_as_ts_does() {
    for loopback in [false, true] {
        let (h, _memory, _root) = home(loopback, 120, json!({ "tabs": { "enabled": true } }));
        h.wait_for("p0b w120 ");
        h.tui.keymap.dispatch("p0b.open", Some("ses_a"));
        h.wait_for("p0b open true");
        h.wait_for("[ses_a]");
        assert!(matches!(h.tui.route(), Route::Home), "open showed the tab");
        h.tui.keymap.dispatch("p0b.open", Some("ses_b"));
        h.wait_for("[ses_a,ses_b]");
        h.tui.keymap.dispatch("p0b.move", Some("ses_b"));
        h.wait_for("[ses_b,ses_a]");
        h.tui.keymap.dispatch("p0b.close", Some("ses_b"));
        h.wait_for("[ses_a]");
        h.tui.keymap.dispatch("p0b.close", None);
        h.wait_for("p0b close false");
        h.tui.keymap.dispatch("p0b.move", Some("ses_b"));
        h.wait_for("p0b move false");

        let (h, _memory, _root) = home(loopback, 120, json!({ "tabs": { "enabled": false } }));
        h.wait_for("p0b w120 ");
        h.tui.keymap.dispatch("p0b.open", Some("ses_a"));
        h.wait_for("p0b open false");
    }
}

// Expected (TS 1.x `api.theme.set`): a known theme is selected, saved, and read back; an unknown one is refused and
// changes nothing. On both paths.
#[test]
fn a_plugin_selects_a_theme_it_knows() {
    for loopback in [false, true] {
        let (h, _memory, _root) = home(loopback, 120, json!({}));
        h.wait_for("p0b w120 opencode");
        h.tui.keymap.dispatch("p0b.theme", Some("nord"));
        h.wait_for("p0b theme true");
        h.wait_for("p0b w120 nord");
        h.tui.keymap.dispatch("p0b.theme", Some("not-a-theme"));
        h.wait_for("p0b theme false");
        assert_eq!(h.tui.theme.borrow().selected(), "nord");
    }
}

// Expected: the streaming deltas the store applies reach the plugin once a change batch, in order, which `on_event`
// never gets. On both paths.
#[test]
fn deltas_reach_the_plugin() {
    for loopback in [false, true] {
        let (h, memory, _root) = home(loopback, 120, json!({}));
        h.wait_for("p0b w120 ");
        for (ordinal, delta) in ["he", "ll", "o"].iter().enumerate() {
            memory.emit(&json!({
                "id": format!("evt_{ordinal}"), "created": 1, "type": "session.text.delta",
                "location": { "directory": support::DIRECTORY },
                "data": { "sessionID": "ses_a", "assistantMessageID": "msg_1", "ordinal": ordinal, "delta": delta },
            }));
        }
        h.wait_for("d:hello ");
    }
}

// Expected: a plugin reads the text the mouse selected and clears it; then nothing is selected. On both paths.
#[test]
fn a_plugin_reads_and_clears_the_selection() {
    for loopback in [false, true] {
        let (h, _memory, _root) = home(loopback, 120, json!({}));
        let screen = h.wait_for("p0b w120 ");
        let row = screen.lines().position(|line| line.contains("p0b w120")).unwrap() as u16;
        let column = screen.lines().nth(row.into()).unwrap().find("p0b").unwrap() as u16;
        h.app.drag((column, row), (column + 3, row));
        h.tui.keymap.dispatch("p0b.selection", None);
        h.wait_for(r#"p0b selection Some("p0b"#);
        let cleared = h.app.wait_until(std::time::Duration::from_secs(5), || h.app.selected_text().is_none());
        assert!(cleared, "loopback {loopback}: still selected");
    }
}

// Expected: an xlarge panel opens at the TUI's xlarge dialog size (TS `xlarge`). On both paths.
#[test]
fn an_xlarge_panel_opens_xlarge() {
    for loopback in [false, true] {
        let (h, _memory, _root) = home(loopback, 140, json!({}));
        h.wait_for("p0b w140 ");
        h.tui.keymap.dispatch("p0b.wide", None);
        h.wait_for("p0b wide body");
        assert_eq!(h.tui.dialogs.size(), opencode_ui::dialog::DialogSize::XLarge);
    }
}

// Expected: a program in the foreground runs with the terminal released, and its exit code comes back as a reply.
// On both paths.
#[cfg(unix)]
#[test]
fn a_program_runs_in_the_foreground_and_its_exit_code_comes_back() {
    for loopback in [false, true] {
        let (h, _memory, _root) = home(loopback, 120, json!({}));
        h.wait_for("p0b w120 ");
        h.tui.keymap.dispatch("p0b.run", Some("exit 3"));
        h.wait_for(" x:3");
    }
}
