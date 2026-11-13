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

thread_local! {
    /// What `p0b.pair` runs between its reads of `ses_a` and `ses_b`.
    static BETWEEN: RefCell<Option<Box<dyn Fn()>>> = const { RefCell::new(None) };
    /// The costs of `ses_a` and `ses_b` that `p0b.pair` read.
    static PAIR: Cell<Option<(f64, f64)>> = const { Cell::new(None) };
    /// The tabs `p0b.tabs` read.
    static TABS: RefCell<Vec<abi::Tab>> = const { RefCell::new(Vec::new()) };
    /// The pending keys, active keys and commands `p0b.keys` read.
    static KEYS: RefCell<Keys> = RefCell::default();
}

type Keys = (Vec<abi::KeymapPending>, Vec<abi::KeymapActive>, Vec<abi::KeymapCommand>);

/// The built-in theme `aura`'s document, which loads as a custom theme.
fn aura() -> Value {
    let themes: Value = serde_json::from_str(include_str!("../../../ui/src/theme/generated/themes.json")).unwrap();
    let themes = themes["themes"].as_array().unwrap();
    themes.iter().find(|theme| theme["name"] == "aura").unwrap()["document"].clone()
}

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
    setup.command(command("p0b.tabs"), |host, _| TABS.set(host.tabs()));
    setup.command(command("p0b.keys"), |host, _| {
        KEYS.set((host.keymap_pending(), host.keymap_active(), host.keymap_commands()));
    });
    setup.command(command("p0b.pair"), |host, _| {
        let cost = |id: &str| host.session(id).map_or(-1.0, |session| session.info.cost);
        let a = cost("ses_a");
        BETWEEN.with_borrow(|between| between.iter().for_each(|between| between()));
        PAIR.set(Some((a, cost("ses_b"))));
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
                        let theme = if verb == "install" { aura() } else { json!({ "x": 1 }) };
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
            "p0b w{} {} [{}] {} {reachable} {} {} d:{} x:{} c{} ds{} i:{installed} n:{} a:{}",
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
            active.len(),
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

// Expected (reviews bigboi-11, carbon-4): a theme installed in a call can be selected in the same call, from both
// paths; writes land in the order asked, two names both stay listed, and a value that is not a theme leaves the file
// and the listed theme as they were.
#[test]
fn installs_land_in_order_and_select_at_once() {
    for loopback in [false, true] {
        let (h, _memory, _root) = home(loopback, 140, json!({}));
        h.wait_for("p0b w140 opencode");
        h.tui.keymap.dispatch("p0b.script", Some("install p0b-new;theme p0b-new;installbad p0b-bad;theme p0b-bad"));
        h.wait_for("p0b script1 -,true,-,false");
        h.wait_for("p0b w140 p0b-new");
        assert_eq!(h.tui.theme.borrow().selected(), "p0b-new", "loopback {loopback}");
    }
    let (h, _memory, root) = home(false, 140, json!({}));
    h.wait_for("p0b w140 opencode");
    let install = |name: &str, theme: Value| opencode_plugin::Host::install_theme(&*h.tui, name, theme);
    install("p0b-x", json!({ "theme": { "n": 1 } }));
    install("p0b-x", json!({ "theme": { "n": 2 } }));
    install("p0b-y", json!({ "theme": {} }));
    install("p0b-x", json!({ "not": "a theme" }));
    let file = |name: &str| walk(root.path()).into_iter().find(|path| path.ends_with(format!("{name}.json")));
    let listed =
        || ["p0b-x", "p0b-y"].iter().all(|name| h.tui.theme.borrow().names().iter().any(|known| known == name));
    let settled = h.app.wait_until(std::time::Duration::from_secs(10), || file("p0b-y").is_some() && listed());
    assert!(settled, "{:?}", h.tui.theme.borrow().names());
    // The last scan has applied: wait until no write or scan is pending, then read the bytes.
    h.app.wait_until(std::time::Duration::from_millis(200), || false);
    assert!(listed(), "{:?}", h.tui.theme.borrow().names());
    let written: Value = serde_json::from_slice(&std::fs::read(file("p0b-x").unwrap()).unwrap()).unwrap();
    assert_eq!(written, json!({ "theme": { "n": 2 } }));
    let leftovers: Vec<_> =
        walk(root.path()).into_iter().filter(|path| path.to_string_lossy().ends_with(".tmp")).collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");

    // Listed and selectable as it is installed, before any scan: here there is none, without config files.
    let h = support::mount(100, 30, Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) });
    opencode_plugin::Host::install_theme(&*h.tui, "p0b-mem", aura());
    opencode_plugin::Host::set_theme(&*h.tui, "p0b-mem");
    assert!(h.tui.theme.borrow().names().iter().any(|name| name == "p0b-mem"));
    assert_eq!(h.tui.theme.borrow().selected(), "p0b-mem");
    assert!(h.tui.theme.borrow_mut().take_error().is_none(), "the theme does not load");
}

// Expected (reviews bigboi-9, carbon-8): a claim reads a change of the tabs, the keymap and the selected theme in the
// first frame after it, also when another client reordered the tabs on disk, when a dialog changed what the keys
// reach while no key is pending, and when a preview selected a theme of the same palette. On both paths.
#[test]
fn a_claim_hears_of_tabs_keymap_and_theme_changes() {
    for loopback in [false, true] {
        let (h, _memory, root) = home(loopback, 160, json!({ "tabs": { "enabled": true } }));
        h.wait_for("p0b w160 ");
        h.tui.keymap.dispatch("p0b.script", Some("open ses_a;open ses_b"));
        h.wait_for("[ses_a,ses_b]");
        let file = || walk(root.path()).into_iter().find(|path| path.ends_with("tabs.json"));
        let written = h.app.wait_until(WAIT, || file().is_some_and(|file| read(&file).to_string().contains("ses_b")));
        assert!(written, "loopback {loopback}");
        let mut tabs = read(&file().unwrap());
        reverse_tabs(&mut tabs);
        std::fs::write(file().unwrap(), tabs.to_string()).unwrap();
        let ids = || h.tui.tabs.tabs(&h.tui).into_iter().map(|tab| tab.session_id).collect::<Vec<_>>();
        assert!(h.app.wait_until(WAIT, || ids() == ["ses_b", "ses_a"]), "{:?}", ids());
        let first = h.app.render().text();
        assert!(first.contains("[ses_b,ses_a]"), "loopback {loopback}:\n{first}");

        let keys = |screen: &str| {
            screen.split(" a:").nth(1).and_then(|rest| rest.split_whitespace().next()).map(str::to_owned)
        };
        let before = keys(&h.app.render().text());
        assert!(h.tui.keymap.pending().is_empty());
        h.tui.keymap.dispatch("command.palette.show", None);
        let first = h.app.render().text();
        assert_ne!(keys(&first), before, "loopback {loopback}:\n{first}");

        h.tui.dialogs.clear();
        h.app.render();
        h.tui.theme.borrow_mut().config_name("system");
        h.tui.theme_changed();
        let first = h.app.render().text();
        assert!(first.contains("p0b w160 system"), "loopback {loopback}:\n{first}");
    }
}

// Expected (review bigboi-14): every read of one plugin call sees one store snapshot. A batch that changes two
// sessions, applied on another thread between the call's reads of them, shows in neither, and in both after. On
// both paths.
#[test]
fn a_call_reads_one_snapshot() {
    for loopback in [false, true] {
        let (h, _memory, _root) = home(loopback, 160, json!({ "tabs": { "enabled": true } }));
        h.wait_for("p0b w160 ");
        h.tui.keymap.dispatch("p0b.script", Some("open ses_a;open ses_b"));
        let loaded = |id: &str| h.tui.data.read(|state| state.session(&SessionID(id.to_owned())).is_some());
        assert!(h.app.wait_until(WAIT, || loaded("ses_a") && loaded("ses_b")), "loopback {loopback}");
        let usage = |id: &str| -> opencode_api::generated::V2Event {
            serde_json::from_value(json!({
                "id": format!("evt_usage_{id}"), "created": 2, "type": "session.usage.updated",
                "durable": { "aggregateID": id, "seq": 100, "version": 1 },
                "location": { "directory": support::DIRECTORY },
                "data": { "sessionID": id, "cost": 5.0,
                          "tokens": { "input": 0, "output": 0, "reasoning": 0, "cache": { "read": 0, "write": 0 } } },
            }))
            .unwrap()
        };
        let batch = [usage("ses_a"), usage("ses_b")];
        let (go, started) = std::sync::mpsc::channel::<()>();
        let data = h.tui.data.clone();
        let writer = std::thread::spawn(move || {
            started.recv().unwrap();
            data.apply(&batch);
        });
        BETWEEN.set(Some(Box::new(move || {
            go.send(()).unwrap();
            // Long enough for the writer to apply, unless the call holds the store.
            std::thread::sleep(std::time::Duration::from_millis(200));
        })));
        h.tui.keymap.dispatch("p0b.pair", None);
        BETWEEN.set(None);
        assert_eq!(PAIR.take(), Some((0.0, 0.0)), "loopback {loopback}");
        writer.join().unwrap();
        h.tui.keymap.dispatch("p0b.pair", None);
        assert_eq!(PAIR.take(), Some((5.0, 5.0)), "loopback {loopback}");
    }
}

// Expected (review carbon-9): a tab reads its session's title, also one opened without being shown, which the TUI
// reads for it (carbon-8), whether the session runs, a permission waits, and what is unread. On both paths.
#[test]
fn tabs_read_their_metadata() {
    let routes = || {
        let failed = support::merge(
            support::test_session("ses_b", "Write the docs"),
            json!({ "time": { "created": 1, "updated": 1, "idle": 5 }, "outcome": "failed" }),
        );
        vec![
            MemoryRoute::json(
                "GET",
                "/api/session/active",
                200,
                &json!({ "data": { "ses_a": { "type": "running" } } }),
            ),
            MemoryRoute::json("GET", "/api/session/ses_b", 200, &json!({ "data": failed })),
        ]
    };
    for loopback in [false, true] {
        let (h, memory, _root) = home_on(loopback, 160, json!({ "tabs": { "enabled": true } }), routes());
        h.wait_for("p0b w160 ");
        h.tui.keymap.dispatch("p0b.script", Some("open ses_a;open ses_b"));
        // Read for the tabs it opens, with the store otherwise quiet.
        let titled = h.app.wait_until(WAIT, || {
            h.tui.keymap.dispatch("p0b.tabs", None);
            TABS.with_borrow(|tabs| tabs.iter().all(|tab| tab.title.is_some()) && tabs.len() == 2)
        });
        assert!(titled, "loopback {loopback}: {:?}", TABS.take());
        memory.emit(&json!({
            "id": "evt_asked", "created": 1, "type": "permission.asked",
            "location": { "directory": support::DIRECTORY },
            "data": { "id": "per_1", "sessionID": "ses_a", "action": "shell", "resources": ["ls"], "save": [] },
        }));
        let tab = |id: &str, title: &str| abi::Tab {
            session_id: id.to_owned(),
            title: Some(title.to_owned()),
            active: false,
            busy: false,
            attention: false,
            unread: None,
        };
        let want = [
            abi::Tab { busy: true, attention: true, ..tab("ses_a", "Fix the parser") },
            abi::Tab { unread: Some(abi::Unread::Error), ..tab("ses_b", "Write the docs") },
        ];
        let read = h.app.wait_until(WAIT, || {
            h.tui.keymap.dispatch("p0b.tabs", None);
            TABS.with_borrow(|tabs| tabs == &want)
        });
        assert!(read, "loopback {loopback}: {:?}", TABS.take());
    }
}

// Expected (review carbon-9): the keymap reads have every field: a pending key's token, an active key's key, title,
// description and group, and a command's title, description, group, and whether it is enabled, in the palette, a
// slash command or suggested. On both paths.
#[test]
fn keymap_reads_have_every_field() {
    for loopback in [false, true] {
        let (h, _memory, _root) = home(loopback, 160, json!({}));
        h.wait_for("p0b w160 ");
        h.app.press("ctrl+x");
        h.wait_for(" ctrl+x ");
        h.tui.keymap.dispatch("p0b.keys", None);
        h.app.press("escape");
        let (pending, active, commands) = KEYS.take();
        assert_eq!(pending, [abi::KeymapPending { key: "ctrl+x".into(), token: Some("leader".into()) }]);
        let editor = abi::KeymapActive {
            key: "e".into(),
            title: Some("Open editor".into()),
            description: Some("Open external editor".into()),
            group: Some("Session".into()),
            continues: false,
        };
        assert!(active.contains(&editor), "loopback {loopback}: {active:?}");
        let command = |id: &str| commands.iter().find(|command| command.id == id).cloned();
        let slash =
            |name: &str, arguments| Some(abi::KeymapSlash { name: name.into(), aliases: Vec::new(), arguments });
        let aside = abi::KeymapCommand {
            id: "session.aside".into(),
            title: Some("Ask a side question".into()),
            description: Some("One-shot answer from the session's context without adding to the conversation".into()),
            group: Some("Session".into()),
            enabled: true,
            palette: true,
            slash: slash("btw", true),
            suggested: false,
        };
        assert_eq!(command("session.aside"), Some(aside), "loopback {loopback}");
        let connect = abi::KeymapCommand {
            id: "provider.connect".into(),
            title: Some("Connect an integration".into()),
            description: None,
            group: Some("Integration".into()),
            enabled: true,
            palette: true,
            slash: slash("connect", false),
            suggested: true,
        };
        assert_eq!(command("provider.connect"), Some(connect), "loopback {loopback}");
    }
}

const WAIT: std::time::Duration = std::time::Duration::from_secs(10);

/// The JSON in `path`.
fn read(path: &std::path::Path) -> Value {
    serde_json::from_slice(&std::fs::read(path).unwrap_or_default()).unwrap_or_default()
}

/// Reverses every `tabs` list in a tabs file.
fn reverse_tabs(value: &mut Value) {
    match value {
        Value::Object(object) => object.iter_mut().for_each(|(key, value)| match value {
            Value::Array(tabs) if key == "tabs" => tabs.reverse(),
            value => reverse_tabs(value),
        }),
        Value::Array(items) => items.iter_mut().for_each(reverse_tabs),
        _ => {}
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
