use super::*;
use opentui::input::{Event, Input, Parser};
use serde_json::Value;
use std::time::Instant;

/// Replays recorded input sequences and checks which commands actually run.
#[test]
fn oracle_key_sequences_run_the_commands_typescript_runs() {
    let fixture: Value = serde_json::from_str(include_str!("../../../../parity/fixtures/U.2/keymap.json")).unwrap();
    let names: Vec<&str> =
        DEFINITIONS.iter().map(|definition| definition.name).filter(|name| *name != "leader").collect();
    let mut failures = Vec::new();
    let mut total = 0;
    for scenario in fixture["scenarios"].as_array().unwrap() {
        let keybinds = Keybinds::<u32>::resolve(
            scenario["keybinds"].as_object().unwrap(),
            scenario["terminalSuspend"].as_bool().unwrap(),
        )
        .unwrap();
        let options = Options {
            leader_timeout: Duration::from_millis(scenario["leaderTimeout"].as_u64().unwrap_or(2000)),
            textarea_enabled: scenario["textarea"].as_bool().unwrap().into(),
            ..Options::default()
        };
        let tui = TuiKeymap::new(keybinds, options);
        let calls = Rc::new(RefCell::new(Vec::<String>::new()));
        let recorder = |ids: &[&str]| {
            let commands = ids
                .iter()
                .map(|id| {
                    let calls = calls.clone();
                    let name = (*id).to_owned();
                    TuiCommand::new(*id, move |_, _| calls.borrow_mut().push(name.clone()))
                })
                .collect();
            tui.layer(KeymapLayer { commands, ..KeymapLayer::default() }).unwrap()
        };
        let isolated = scenario["layout"] == "isolated";
        let _all = (!isolated).then(|| recorder(&names));
        let mut parser = Parser::standalone().unwrap();
        let mut now = Instant::now();
        let cases = scenario["cases"].as_array().unwrap();
        assert!(!cases.is_empty(), "no sequences for {}", scenario["name"]);
        for case in cases {
            total += 1;
            let _layer = case["command"].as_str().map(|command| recorder(&[command]));
            tui.keymap().clear_pending_sequence();
            calls.borrow_mut().clear();
            for key in case["keys"].as_array().unwrap() {
                if let Some(wait) = key.as_u64() {
                    // The timer `dialog::expire_leader` sets fires within the wait.
                    if let Some(generation) = tui.leader_armed()
                        && Duration::from_millis(wait) >= tui.leader_timeout()
                    {
                        tui.expire_leader(generation);
                    }
                    continue;
                }
                let mut out = Vec::new();
                parser.feed(key.as_str().unwrap().as_bytes(), now, &mut out).unwrap();
                now += Duration::from_secs(1);
                parser.expire(now, &mut out).unwrap();
                for input in out {
                    if let Input::Event(Event::Key(event)) = input {
                        tui.handle_key(&event);
                    }
                }
            }
            let expected: Vec<String> =
                case["commands"].as_array().unwrap().iter().map(|id| id.as_str().unwrap().to_owned()).collect();
            if *calls.borrow() != expected {
                failures.push(format!(
                    "{}: {} {:?}: TypeScript ran {expected:?}, Rust ran {:?}",
                    scenario["name"].as_str().unwrap(),
                    case["command"].as_str().unwrap_or("-"),
                    case["keys"].as_array().unwrap(),
                    calls.borrow()
                ));
            }
        }
    }
    assert!(failures.is_empty(), "{} of {total} cases differ:\n{}", failures.len(), failures.join("\n"));
}

#[test]
fn oracle_invalid_configs_fail_as_typescript_does() {
    let fixture: Value = serde_json::from_str(include_str!("../../../../parity/fixtures/U.2/keymap.json")).unwrap();
    for case in fixture["errors"].as_array().unwrap() {
        let error = Keybinds::<u32>::resolve(case["keybinds"].as_object().unwrap(), true).err();
        let expected = case["error"].as_str().unwrap();
        // TS's text for an invalid value comes from Effect Schema; only the unknown-name text is shared.
        if expected.starts_with("Unrecognized") {
            assert_eq!(error.as_deref(), Some(expected));
        } else {
            assert!(error.is_some(), "{} should fail: {expected}", case["keybinds"]);
        }
    }
}

#[test]
fn modes_gate_layers_and_dispatch_passes_input() {
    let tui = TuiKeymap::<u32>::new(Keybinds::defaults(), Options::default());
    let calls = Rc::new(RefCell::new(Vec::<String>::new()));
    let record = |label: &'static str| {
        let calls = calls.clone();
        move |input: Option<&str>, _: Option<&KeyEvent>| calls.borrow_mut().push(format!("{label}:{input:?}"))
    };
    tui.layer(KeymapLayer { commands: vec![TuiCommand::new("session.new", record("base"))], ..KeymapLayer::default() })
        .unwrap()
        .forget();
    tui.layer(KeymapLayer {
        mode: Some("modal".to_owned()),
        commands: vec![TuiCommand::inline("x", record("modal"))],
        ..KeymapLayer::default()
    })
    .unwrap()
    .forget();
    let active = Rc::new(Cell::new(true));
    let pop = tui.push_mode(
        "modal",
        Condition::when({
            let active = active.clone();
            move || active.get()
        }),
    );
    assert_eq!(tui.mode(), "modal");
    // A layer whose mode is not current counts as disabled.
    assert_eq!(tui.dispatch("session.new", Some("arg")), RunResult::Disabled);
    tui.handle_key(&KeyEvent::new(opentui::input::KeyCode::Char('x'), opentui::input::Modifiers::NONE));
    active.set(false);
    assert_eq!(tui.mode(), "base");
    assert_eq!(tui.dispatch("session.new", Some("arg")), RunResult::Ok);
    drop(pop);
    assert_eq!(*calls.borrow(), ["modal:None", "base:Some(\"arg\")"]);
    assert_eq!(tui.shortcut("session.new").as_deref(), Some("ctrl+x n"));
    assert_eq!(tui.shortcut_all("app.exit"), None);
    assert!(tui.commands().iter().any(|command| command.id == "session.new"));
}

#[test]
fn active_keys_follow_a_mode_condition() {
    let tui = TuiKeymap::<u32>::new(Keybinds::defaults(), Options::default());
    tui.layer(KeymapLayer {
        mode: Some("modal".to_owned()),
        commands: vec![TuiCommand::inline("x", |_, _| ()).title("Modal x")],
        ..KeymapLayer::default()
    })
    .unwrap()
    .forget();
    let active = Rc::new(Cell::new(false));
    let _pop = tui.push_mode(
        "modal",
        Condition::when({
            let active = active.clone();
            move || active.get()
        }),
    );
    let reaches = |tui: &TuiKeymap<u32>| tui.active().iter().any(|key| key.key == "x");
    assert!(!reaches(&tui));
    active.set(true);
    assert!(reaches(&tui), "{:?}", tui.active());
}

#[test]
fn layer_rejects_the_command_shapes_typescript_rejects() {
    let tui = TuiKeymap::<u32>::new(Keybinds::defaults(), Options::default());
    let layer =
        |command: TuiCommand| tui.layer(KeymapLayer { commands: vec![command], ..KeymapLayer::default() }).err();
    assert_eq!(layer(TuiCommand::new("", |_, _| ())).as_deref(), Some("Keymap command IDs cannot be empty"));
    assert_eq!(layer(TuiCommand::inline("", |_, _| ())).as_deref(), Some("Keymap command bindings cannot be empty"));
    assert_eq!(layer(TuiCommand::inline("x", |_, _| ()).palette()).as_deref(), Some("Palette commands require an ID"));
    assert_eq!(
        layer(TuiCommand::inline("x", |_, _| ()).bind(Bind::Off)).as_deref(),
        Some("Inline keymap commands require bind")
    );
}

#[test]
fn a_binding_parses_as_its_layer_registers_it() {
    let tui = TuiKeymap::<u32>::new(Keybinds::defaults(), Options::default());
    let strokes = |parts: &[opentui::keymap::KeySequencePart]| {
        parts.iter().map(|part| format!("{:?}", part.stroke)).collect::<Vec<_>>()
    };
    for key in [
        "esc",
        "ESC",
        "esc<",
        "esc<leader>",
        "<leader>esc",
        "ctrl+esc",
        "Esc+ctrl",
        "esc,ctrl+e",
        "x, esc",
        "g esc",
        "escx",
        "xesc",
        "enter",
        "pgup",
        "ctrl+e",
        "a,,b",
        "",
    ] {
        let layer =
            tui.layer(KeymapLayer::new(vec![TuiCommand::new("probe.key", |_, _| {}).bind(Bind::Key(key.to_owned()))]));
        let bound = tui.keymap().command_bindings(Visibility::Registered, &["probe.key"]);
        let mut engine: Vec<Vec<String>> = match &layer {
            Ok(_) => bound.get("probe.key").into_iter().flatten().map(|binding| strokes(&binding.sequence)).collect(),
            Err(_) => Vec::new(),
        };
        let mut ours: Vec<Vec<String>> = tui
            .parse_binding(key)
            .unwrap_or_default()
            .iter()
            .filter(|parts| !parts.is_empty())
            .map(|parts| strokes(parts))
            .collect();
        engine.sort();
        ours.sort();
        assert_eq!(ours, engine, "{key:?}");
        drop(layer);
    }
    let escape = tui.keymap().parse_key("escape").unwrap().stroke;
    let takes_escape = |key: &str| tui.parse_binding(key).unwrap().iter().flatten().any(|part| part.stroke == escape);
    for key in ["esc", "esc<", "esc<leader>", "<leader>esc", "g esc", "x, esc"] {
        assert!(takes_escape(key), "{key:?}");
    }
    for key in ["escx", "xesc", "ctrl+e"] {
        assert!(!takes_escape(key), "{key:?}");
    }
}

#[test]
fn commands_list_in_the_order_of_typescript_layers() {
    let tui = TuiKeymap::<u32>::new(Keybinds::defaults(), Options::default());
    let layer = |ids: &[&str]| {
        let commands = ids.iter().map(|id| TuiCommand::new(*id, |_, _| {})).collect();
        tui.layer(KeymapLayer::global(commands)).unwrap().forget();
    };
    tui.set_first_layer(["app.b", "app.a", "app.c"].map(String::from));
    layer(&["app.a"]);
    layer(&["app.b", "app.c"]);
    let held = tui.hold(|| layer(&["plugin.a"]));
    layer(&["route.a", "route.b"]);
    // The textarea addon's `input.*` commands come last, as TS registers them with the keymap.
    let order = || {
        let ids = tui.commands().into_iter().map(|command| command.id).collect::<Vec<_>>();
        assert!(ids.last().is_some_and(|id| id.starts_with("input.")), "{ids:?}");
        ids.into_iter().filter(|id| !id.starts_with("input.")).collect::<Vec<_>>()
    };
    assert_eq!(order(), ["route.a", "route.b", "plugin.a", "app.b", "app.a", "app.c"]);
    drop(held);
    assert_eq!(order(), ["plugin.a", "route.a", "route.b", "app.b", "app.a", "app.c"]);

    let shown = Rc::new(Cell::new(false));
    let when = Condition::when({
        let shown = shown.clone();
        move || shown.get()
    });
    tui.layer(KeymapLayer::global(vec![TuiCommand::new("variant.list", |_, _| {}).palette_when(when)]))
        .unwrap()
        .forget();
    let palette = || tui.commands().into_iter().find(|command| command.id == "variant.list").unwrap().palette;
    assert!(!palette());
    shown.set(true);
    assert!(palette());
}

#[test]
fn a_plugin_slash_name_never_takes_another_commands() {
    let tui = TuiKeymap::<u32>::new(Keybinds::defaults(), Options::default());
    let slash = |id: &str, slash: Slash| {
        tui.layer(KeymapLayer::global(vec![TuiCommand::new(id, |_, _| {}).slash(slash)])).unwrap().forget();
    };
    let plugin = |name: &str, aliases: &[&str], plugin: &str| Slash {
        plugin: Some(plugin.to_owned()),
        ..Slash::new(name).aliases(aliases.iter().copied()).arguments()
    };
    slash("first.run", plugin("first", &["shared"], "first"));
    slash("taker.run", plugin("plugins", &["harmless", "cd", "shared", "harmless"], "taker"));
    slash("whole.run", plugin("plugins", &["shared"], "whole"));
    // The host's own registers after the plugins, as a route's layer does, and still wins.
    slash("plugins.list", Slash::new("plugins"));
    slash("prompt.cd", Slash::new("cd").arguments());
    let names = |id: &str| {
        let command = tui.commands().into_iter().find(|command| command.id == id).unwrap();
        command.slash.map(|slash| std::iter::once(slash.name).chain(slash.aliases).collect::<Vec<_>>())
    };
    assert_eq!(names("plugins.list"), Some(vec!["plugins".to_owned()]));
    assert_eq!(names("prompt.cd"), Some(vec!["cd".to_owned()]));
    assert_eq!(names("first.run"), Some(vec!["first".to_owned(), "shared".to_owned()]));
    assert_eq!(names("taker.run"), Some(vec!["harmless".to_owned()]));
    assert_eq!(names("whole.run"), None);
}
