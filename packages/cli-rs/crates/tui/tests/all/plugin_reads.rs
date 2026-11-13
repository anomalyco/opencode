//! The small reads and verbs of ABI 1.6 (P0b) on the real TUI, each on both paths: in process and through the C
//! ABI's byte shims (`Loopback`). A test plugin shows what it reads in a sized `app` claim, under every route, and
//! toasts what each verb answers. The loader's tests compare the two paths on a test host
//! (`the_1_6_reads_and_verbs_are_the_same_in_process_and_through_the_library`).

use crate::support::{self, Harness};

use std::cell::{Cell, RefCell};
use std::ffi::c_void;
use std::rc::Rc;
use std::sync::Arc;

use opencode_api::generated::SessionID;
use opencode_api::memory::{Memory, Route as MemoryRoute};
use opencode_plugin::abi;
use opencode_tui::{Deps, Route};
use serde_json::{Value, json};

/// Commands of one verb each, which toast what the verb answered, and a sized `app` claim that shows what it reads.
fn reader(setup: &mut abi::Setup) -> Result<(), String> {
    let command = |name: &str| abi::Command { name: name.to_owned(), ..abi::Command::default() };
    let toast = |host: &dyn abi::Host, text: String| host.toast(abi::Toast::new(abi::Variant::Info, text));
    setup.command(command("p0b.open"), move |host, input| {
        let opened = host.edit_tab(abi::TabEdit::Open { session: input.unwrap_or_default().to_owned() });
        toast(host, format!("p0b open {opened}"));
    });
    setup.command(command("p0b.focus"), move |host, input| {
        let focused = host.edit_tab(abi::TabEdit::Focus { session: input.unwrap_or_default().to_owned() });
        toast(host, format!("p0b focus {focused}"));
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
    setup.command(command("p0b.install"), |host, input| {
        host.install_theme(input.unwrap_or_default(), json!({ "theme": {} }));
    });
    // Several verbs in one call, `;`-separated, such as `open ses_a;close ses_a`: what each answered, `-` for none,
    // after the number of the script.
    let scripts = Cell::new(0);
    setup.command(command("p0b.script"), move |host, input| {
        scripts.set(scripts.get() + 1);
        let answers: Vec<String> = input
            .unwrap_or_default()
            .split(';')
            .map(|verb| {
                let (verb, arg) = verb.split_once(' ').unwrap_or((verb, ""));
                let session = arg.to_owned();
                let answer = match verb {
                    "open" => host.edit_tab(abi::TabEdit::Open { session }),
                    "focus" => host.edit_tab(abi::TabEdit::Focus { session }),
                    "move" => host.edit_tab(abi::TabEdit::Move { session, index: 0 }),
                    "close" => host.edit_tab(abi::TabEdit::Close { session: Some(session).filter(|s| !s.is_empty()) }),
                    "variant" => host.set_variant(Some(arg).filter(|arg| !arg.is_empty())),
                    "theme" => host.set_theme(arg),
                    "model" => {
                        let (provider, model) = arg.split_once('/').unwrap_or_default();
                        host.set_model(provider, model);
                        return "-".to_owned();
                    }
                    "install" | "installbad" => {
                        let theme = if verb == "install" { json!({ "theme": {} }) } else { json!({ "x": 1 }) };
                        host.install_theme(arg, theme);
                        return "-".to_owned();
                    }
                    other => panic!("no verb {other}"),
                };
                answer.to_string()
            })
            .collect();
        toast(host, format!("p0b script{} {}", scripts.get(), answers.join(",")));
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
    let calls = Rc::new(Cell::new(0));
    let called = calls.clone();
    setup.on_deltas(move |_, events| {
        called.set(called.get() + 1);
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
    setup.slot(abi::Placement::append("app"), move |read, input, _| {
        let tabs: Vec<String> = read
            .tabs()
            .into_iter()
            .map(|tab| format!("{}{}", tab.session_id, if tab.active { "*" } else { "" }))
            .collect();
        let reachable = read.keymap_commands().iter().any(|command| command.id == "p0b.open");
        let pending: Vec<String> = read.keymap_pending().into_iter().map(|key| key.key).collect();
        let active = read.keymap_active();
        let continues = active.iter().filter(|key| key.continues).count();
        let described = active.iter().filter(|key| key.description.is_some()).count();
        let installed = read.themes().iter().any(|name| name == "p0b-theme");
        let text = format!(
            "p0b w{} {} [{}] {} {reachable} {} {} d:{} x:{} c{} ds{} i:{installed} n:{}",
            input.width,
            read.theme().unwrap_or_default(),
            tabs.join(","),
            read.shortcuts("command.palette.show").join(","),
            pending.join(" "),
            read.variants().len(),
            deltas.borrow(),
            exited.borrow(),
            continues.min(1),
            described.min(1),
            calls.get(),
        );
        abi::Render::Show(abi::Node::text([abi::Span::new(text).link("https://opencode.ai/p0b")]))
    });
    setup.sized(abi::Placement::append("app"));
    Ok(())
}

/// The TUI's home with `reader` active, in process or through the byte shims, on a server of two sessions and a child
/// `ses_c` of `ses_a`, with `config`; and the server.
fn home(loopback: bool, width: u16, config: Value) -> (Harness, Memory, opencode_util::temp::TempDir) {
    home_on(loopback, width, config, Vec::new())
}

/// [`home`] on a server that also answers `routes`.
fn home_on(
    loopback: bool,
    width: u16,
    config: Value,
    mut routes: Vec<MemoryRoute>,
) -> (Harness, Memory, opencode_util::temp::TempDir) {
    let root = opencode_util::temp::tempdir().unwrap();
    let paths = support::home_paths(root.path());
    std::fs::create_dir_all(&paths.state).unwrap();
    let child = support::merge(support::test_session("ses_c", "A child"), json!({ "parentID": "ses_a" }));
    routes.extend(
        [support::test_session("ses_a", "Fix the parser"), support::test_session("ses_b", "Write the docs"), child]
            .iter()
            .flat_map(support::session_routes),
    );
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
        // The first frame at the new size shows the claim's new width (reviews bigboi-3, carbon-2).
        let first = h.app.render().text();
        assert!(first.contains("p0b w90 "), "loopback {loopback}:\n{first}");
        h.tui.keymap.dispatch("p0b.variant", None);
        h.wait_for("p0b variant false false");
    }
}

// Expected: the pending keys read as the TUI shows them, the active keys include one that continues a sequence (the
// leader) and one with a description, and the claim renders again as the sequence starts and ends.
#[test]
fn a_claim_follows_the_pending_keys() {
    for loopback in [false, true] {
        let (h, _memory, _root) = home(loopback, 120, json!({}));
        h.wait_for("p0b w120 ");
        h.wait_for(" c1 ds1 ");
        h.app.press("ctrl+x");
        h.wait_for("true ctrl+x 0");
        h.app.press("escape");
        h.wait_for("true  0");
    }
}

// Expected (TS `ui.tabs`): with tabs on, `close` with no tab on screen is refused, `open` adds a tab without showing
// it, `move` reorders an open tab and refuses one that is not open, `focus` shows a tab, which reads as active, and
// `close` closes a named tab; the claim reads the tabs in order after each change, also one the TUI itself makes. With
// tabs off every verb is refused. On both paths.
#[test]
fn tabs_open_move_and_close_as_ts_does() {
    for loopback in [false, true] {
        let (h, _memory, _root) = home(loopback, 120, json!({ "tabs": { "enabled": true } }));
        h.wait_for("p0b w120 ");
        h.tui.keymap.dispatch("p0b.close", None);
        h.wait_for("p0b close false");
        h.tui.keymap.dispatch("p0b.open", Some("ses_a"));
        h.wait_for("p0b open true");
        h.wait_for("[ses_a]");
        assert!(matches!(h.tui.route(), Route::Home), "open showed the tab");
        h.tui.keymap.dispatch("p0b.open", Some("ses_b"));
        h.wait_for("[ses_a,ses_b]");
        opencode_tui::tabs::reorder(&h.tui, "ses_b", 0);
        h.wait_for("[ses_b,ses_a]");
        h.tui.keymap.dispatch("p0b.move", Some("ses_a"));
        h.wait_for("[ses_a,ses_b]");
        h.tui.keymap.dispatch("p0b.focus", Some("ses_b"));
        h.wait_for("[ses_a,ses_b*]");
        assert!(matches!(h.tui.route(), Route::Session { id } if id.0 == "ses_b"), "focus did not show the tab");
        h.tui.keymap.dispatch("p0b.close", Some("ses_b"));
        h.wait_for("[ses_a*]");
        h.tui.keymap.dispatch("p0b.move", Some("ses_b"));
        h.wait_for("p0b move false");

        let (h, _memory, _root) = home(loopback, 120, json!({ "tabs": { "enabled": false } }));
        h.wait_for("p0b w120 ");
        h.tui.keymap.dispatch("p0b.open", Some("ses_a"));
        h.wait_for("p0b open false");
    }
}

// Expected (reviews bigboi-8, carbon-7): a verb answers for the state the same call's earlier verbs left, as TS's act
// in order: a variant is checked against the model the call selected, and a tab against the tabs it opened and closed.
// On both paths.
#[test]
fn verbs_in_one_call_see_the_earlier_ones() {
    let catalog = || {
        let model = |id: &str, variant: &str| {
            support::merge(support::model("p", id, id), json!({ "variants": [{ "id": variant }] }))
        };
        let list = |data: Value| json!({ "location": { "directory": support::DIRECTORY }, "data": data });
        vec![
            MemoryRoute::json("GET", "/api/agent", 200, &list(json!([support::agent("build", "primary", false)]))),
            MemoryRoute::json("GET", "/api/model", 200, &list(json!([model("a", "low"), model("b", "high")]))),
            MemoryRoute::json("GET", "/api/provider", 200, &list(json!([]))),
        ]
    };
    for loopback in [false, true] {
        let (h, _memory, _root) = home_on(loopback, 160, json!({ "tabs": { "enabled": true } }), catalog());
        h.wait_for("p0b w160 ");
        let selected = || h.tui.local.selection().map(|selection| (selection.model.model_id, selection.variant));
        h.tui.keymap.dispatch("p0b.script", Some("model p/a"));
        h.wait_for("p0b script1 -");
        assert_eq!(selected(), Some(("a".to_owned(), None)), "loopback {loopback}");
        h.tui.keymap.dispatch("p0b.script", Some("model p/b;variant high"));
        h.wait_for("p0b script2 -,true");
        assert_eq!(selected(), Some(("b".to_owned(), Some("high".to_owned()))), "loopback {loopback}");
        h.tui.keymap.dispatch("p0b.script", Some("model p/a;variant high"));
        h.wait_for("p0b script3 -,false");
        assert_eq!(selected().map(|selected| selected.0), Some("a".to_owned()), "loopback {loopback}");

        h.tui.keymap.dispatch("p0b.script", Some("open ses_a;close ses_a;close ses_a"));
        h.wait_for("p0b script4 true,true,false");
        assert!(h.tui.tabs.open_ids(&h.tui).is_empty(), "loopback {loopback}");
        h.tui.keymap.dispatch("p0b.script", Some("open ses_b;move ses_b;focus ses_a;close"));
        h.wait_for("p0b script5 true,true,true,true");
        h.wait_for("[ses_b");
        assert_eq!(h.tui.tabs.open_ids(&h.tui), ["ses_b"], "loopback {loopback}");
    }
}

// Expected (review bigboi-10, TS `ui.tabs`): `move` takes any session of an open tab's family, `close` only the tab's
// own ID, so a child's ID closes nothing. On both paths.
#[test]
fn close_takes_the_tab_id_and_move_a_child() {
    for loopback in [false, true] {
        let (h, _memory, _root) = home(loopback, 120, json!({ "tabs": { "enabled": true } }));
        h.wait_for("p0b w120 ");
        h.tui.navigate(Route::Session { id: SessionID("ses_c".to_owned()) });
        h.wait_for("[ses_a*]");
        h.tui.keymap.dispatch("p0b.script", Some("close ses_c;move ses_c"));
        h.wait_for("p0b script1 false,true");
        h.wait_for("[ses_a*]");
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

// Expected (TS 1.x `api.theme.install`): an installed theme is written to the config's themes directory and then
// listed, without being selected; a name that is not a plain file name installs nothing. On both paths.
#[test]
fn a_plugin_installs_a_theme() {
    for loopback in [false, true] {
        let (h, _memory, root) = home(loopback, 140, json!({}));
        h.wait_for("p0b w140 opencode");
        h.tui.keymap.dispatch("p0b.install", Some("../p0b-theme"));
        h.tui.keymap.dispatch("p0b.install", Some("p0b-theme"));
        h.wait_for(" i:true");
        assert_eq!(h.tui.theme.borrow().selected(), "opencode");
        let written: Vec<_> = walk(root.path()).into_iter().filter(|path| path.ends_with("p0b-theme.json")).collect();
        assert_eq!(written.len(), 1, "loopback {loopback}: {written:?}");
        assert!(written[0].parent().is_some_and(|dir| dir.ends_with("themes")), "{written:?}");
    }
}

/// Every file under `dir`.
fn walk(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let entries = std::fs::read_dir(dir).into_iter().flatten().flatten();
    entries.flat_map(|entry| if entry.path().is_dir() { walk(&entry.path()) } else { vec![entry.path()] }).collect()
}

// Expected: the streaming deltas the store applies reach the plugin once a change batch, in order, which `on_event`
// never gets; a sync with no delta calls nothing. On both paths.
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
        opencode_tui::features::events::deltas(&h.tui);
        h.app.wait_until(std::time::Duration::from_millis(50), || false);
        assert!(h.app.text().contains("d:hello "), "loopback {loopback}: {}", h.app.text());
    }
}

// Expected (review bigboi-7): the deltas of two store batches synced before one frame reach the plugin in one call,
// before that frame, in order. On both paths.
#[test]
fn deltas_reach_the_plugin_once_a_frame() {
    for loopback in [false, true] {
        let (h, _memory, _root) = home(loopback, 120, json!({}));
        h.wait_for("p0b w120 ");
        let delta = |ordinal: usize, delta: &str| -> opencode_api::generated::V2Event {
            serde_json::from_value(json!({
                "id": format!("evt_{ordinal}"), "created": 1, "type": "session.text.delta",
                "location": { "directory": support::DIRECTORY },
                "data": { "sessionID": "ses_a", "assistantMessageID": "msg_1", "ordinal": ordinal, "delta": delta },
            }))
            .unwrap()
        };
        h.tui.data.apply(&[delta(0, "a")]);
        opencode_tui::features::events::deltas(&h.tui);
        h.tui.data.apply(&[delta(1, "b"), delta(2, "c")]);
        opencode_tui::features::events::deltas(&h.tui);
        let first = h.app.render().text();
        assert!(first.contains("d:abc ") && first.contains(" n:1"), "loopback {loopback}:\n{first}");
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

// Expected (reviews bigboi-4, carbon-1): the terminal goes to one program at a time. A second one asked for before the
// first ran is refused with its own reply (as is the external editor, which takes the same slot); once the first ran,
// the next one runs.
#[cfg(unix)]
#[test]
fn a_second_program_is_refused_until_the_first_ran() {
    let (h, _memory, _root) = home(false, 200, json!({}));
    h.wait_for("p0b w200 ");
    h.tui.keymap.dispatch("p0b.run", Some("exit 3"));
    h.tui.keymap.dispatch("p0b.run", Some("exit 4"));
    h.wait_for(" x:another program is in the foreground ");
    h.tui.keymap.dispatch("p0b.run", Some("exit 5"));
    h.wait_for(" x:5");
}
