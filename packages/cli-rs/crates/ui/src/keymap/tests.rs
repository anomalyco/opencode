use super::*;
use opentui::input::{Event, Input, Parser};
use serde_json::{Map, Value};

/// P-ORACLE: replays `parity/fixtures/U.2/keymap.json`, written by `parity/oracle/U.2-keymap.ts` from the
/// TypeScript TUI's keymap, and expects the same commands for every case.
#[test]
fn oracle_key_sequences_run_the_commands_typescript_runs() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../../../parity/fixtures/U.2/keymap.json")).unwrap();
    let names: Vec<&str> = DEFINITIONS
        .iter()
        .map(|definition| definition.name)
        .filter(|name| *name != "leader")
        .collect();
    let mut failures = Vec::new();
    let mut total = 0;
    for scenario in fixture["scenarios"].as_array().unwrap() {
        let keybinds = Keybinds::<u32>::resolve(
            scenario["keybinds"].as_object().unwrap(),
            scenario["terminalSuspend"].as_bool().unwrap(),
        )
        .unwrap();
        let options = Options {
            leader_timeout: Duration::from_millis(
                scenario["leaderTimeout"].as_u64().unwrap_or(2000),
            ),
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
            tui.layer(KeymapLayer {
                commands,
                ..KeymapLayer::default()
            })
            .unwrap()
        };
        let isolated = scenario["layout"] == "isolated";
        let all = (!isolated).then(|| recorder(&names));
        let mut parser = Parser::standalone().unwrap();
        let mut now = Instant::now();
        for case in scenario["cases"].as_array().unwrap() {
            total += 1;
            let layer = case["command"].as_str().map(|command| recorder(&[command]));
            tui.keymap().clear_pending_sequence();
            calls.borrow_mut().clear();
            for key in case["keys"].as_array().unwrap() {
                if let Some(wait) = key.as_u64() {
                    tui.expire_leader(Instant::now() + Duration::from_millis(wait));
                    continue;
                }
                let mut out = Vec::new();
                parser
                    .feed(key.as_str().unwrap().as_bytes(), now, &mut out)
                    .unwrap();
                now += Duration::from_secs(1);
                parser.expire(now, &mut out).unwrap();
                for input in out {
                    if let Input::Event(Event::Key(event)) = input {
                        tui.handle_key(&event);
                    }
                }
            }
            let expected: Vec<String> = case["commands"]
                .as_array()
                .unwrap()
                .iter()
                .map(|id| id.as_str().unwrap().to_owned())
                .collect();
            if *calls.borrow() != expected {
                failures.push(format!(
                    "{}: {} {:?}: TypeScript ran {expected:?}, Rust ran {:?}",
                    scenario["name"].as_str().unwrap(),
                    case["command"].as_str().unwrap_or("-"),
                    case["keys"].as_array().unwrap(),
                    calls.borrow()
                ));
            }
            if let Some(layer) = layer {
                layer.dispose();
            }
        }
        if let Some(all) = all {
            all.dispose();
        }
    }
    assert!(total > 2000, "the fixture has {total} cases");
    assert!(
        failures.is_empty(),
        "{} of {total} cases differ:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

#[test]
fn oracle_invalid_configs_fail_as_typescript_does() {
    let fixture: Value =
        serde_json::from_str(include_str!("../../../../parity/fixtures/U.2/keymap.json")).unwrap();
    for case in fixture["errors"].as_array().unwrap() {
        let error = Keybinds::<u32>::resolve(case["keybinds"].as_object().unwrap(), true).err();
        let expected = case["error"].as_str().unwrap();
        // TS's text for an invalid value comes from Effect Schema; only the unknown-name text is shared.
        if expected.starts_with("Unrecognized") {
            assert_eq!(error.as_deref(), Some(expected));
        } else {
            assert!(
                error.is_some(),
                "{} should fail: {expected}",
                case["keybinds"]
            );
        }
    }
}

#[test]
fn generated_definitions_cover_every_name_once() {
    assert_eq!(DEFINITIONS.len(), 244);
    let mut names: Vec<&str> = DEFINITIONS
        .iter()
        .map(|definition| definition.name)
        .collect();
    names.sort_unstable();
    names.dedup();
    assert_eq!(names.len(), 244);
    assert_eq!(
        DEFINITIONS
            .iter()
            .filter(|definition| definition.name.starts_with("which-key."))
            .count(),
        11
    );
    let keybinds = Keybinds::<u32>::defaults();
    assert_eq!(keybinds.get("session.share").len(), 0);
    assert_eq!(
        keybinds.get("app.exit")[0].desc.as_deref(),
        Some("Exit the application")
    );
}

#[test]
fn windows_config_turns_off_suspend_and_adds_ctrl_z_undo() {
    let keybinds = Keybinds::<u32>::resolve(&Map::new(), false).unwrap();
    assert!(keybinds.get("terminal.suspend").is_empty());
    let keys: Vec<String> = keybinds
        .get("input.undo")
        .iter()
        .map(|binding| binding.key.to_string())
        .collect();
    assert_eq!(keys, ["ctrl+z,ctrl+-,super+z"]);
}

#[test]
fn modes_gate_layers_and_dispatch_passes_input() {
    let tui = TuiKeymap::<u32>::new(Keybinds::defaults(), Options::default());
    let calls = Rc::new(RefCell::new(Vec::<String>::new()));
    let record = |label: &'static str| {
        let calls = calls.clone();
        move |input: Option<&str>, _: Option<&KeyEvent>| {
            calls.borrow_mut().push(format!("{label}:{input:?}"))
        }
    };
    tui.layer(KeymapLayer {
        commands: vec![TuiCommand::new("session.new", record("base"))],
        ..KeymapLayer::default()
    })
    .unwrap();
    tui.layer(KeymapLayer {
        mode: Some("modal".to_owned()),
        commands: vec![TuiCommand::inline("x", record("modal"))],
        ..KeymapLayer::default()
    })
    .unwrap();
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
    assert_eq!(
        tui.dispatch("session.new", Some("arg")),
        RunResult::Disabled
    );
    tui.handle_key(&KeyEvent::new(
        opentui::input::KeyCode::Char('x'),
        opentui::input::Modifiers::NONE,
    ));
    active.set(false);
    assert_eq!(tui.mode(), "base");
    assert_eq!(tui.dispatch("session.new", Some("arg")), RunResult::Ok);
    pop.dispose();
    assert_eq!(*calls.borrow(), ["modal:None", "base:Some(\"arg\")"]);
    assert_eq!(tui.shortcut("session.new").as_deref(), Some("ctrl+x n"));
    assert_eq!(tui.shortcut_all("app.exit"), None);
    assert!(
        tui.commands()
            .iter()
            .any(|command| command.id == "session.new")
    );
}

#[test]
fn layer_rejects_the_command_shapes_typescript_rejects() {
    let tui = TuiKeymap::<u32>::new(Keybinds::defaults(), Options::default());
    let layer = |command: TuiCommand| {
        tui.layer(KeymapLayer {
            commands: vec![command],
            ..KeymapLayer::default()
        })
        .err()
    };
    assert_eq!(
        layer(TuiCommand::new("", |_, _| ())).as_deref(),
        Some("Keymap command IDs cannot be empty")
    );
    assert_eq!(
        layer(TuiCommand::inline("", |_, _| ())).as_deref(),
        Some("Keymap command bindings cannot be empty")
    );
    assert_eq!(
        layer(TuiCommand::inline("x", |_, _| ()).palette()).as_deref(),
        Some("Palette commands require an ID")
    );
    assert_eq!(
        layer(TuiCommand::inline("x", |_, _| ()).bind(Bind::Off)).as_deref(),
        Some("Inline keymap commands require bind")
    );
}
