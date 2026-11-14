//! Contract 2.0's input and surfaces (P2, synthesis 3.8 and 4.2) on a linked test plugin in the real TUI: a docked
//! panel, focus, key layers with `Pass`, modes, the `Any` listener, pointer and hover, an overlay, the hold, and the
//! composer's layers with the burst rules.
//!
//! The plugin `test.input` writes its own call log: which owner a call came to (`side`, its panel; `menu`, its
//! overlay; `setup`, its layers of setup), the event, and the mode the call read.

use crate::support::{self, Harness};

use std::cell::RefCell;
use std::sync::Arc;
use std::time::Duration;

use opencode_plugin::abi::interact::{
    self as input, Anchor, Bind, Event, Handled, Interact, Layer, LayerScope, OpenPanel, Overlay, PointerKind,
};
use opencode_plugin::abi::{self, v2};
use opencode_plugin::interact;
use opencode_tui::Deps;
use opentui::input::{Event as Input, KeyCode, KeyEvent, Modifiers, MouseButton, MouseEventKind};

pub const ID: &str = "test.input";

/// What the test plugin does and saw.
#[derive(Default)]
pub struct Probe {
    /// The plugin's own log of its calls.
    pub log: Vec<String>,
    /// The keys of the `x` bind pass instead of being consumed.
    pub pass_x: bool,
    /// The global listener logs the keys it sees.
    pub listen: bool,
    /// The global listener consumes every key.
    pub swallow: bool,
    /// The two later global listeners log the keys they see.
    pub listen_more: bool,
    /// The panel passes a press, which captures nothing.
    pub pass_press: bool,
    /// Node `b` takes pointer events.
    pub pointer_b: bool,
    /// The `x` bind holds the keys after it.
    pub hold: bool,
    /// The panel's view.
    pub panel: Option<input::PanelInput>,
    pub views: usize,
    /// The rows of the rich select, and the word of their footers.
    pub rows: Vec<String>,
    pub footer: String,
}

thread_local! {
    pub static PROBE: RefCell<Probe> = RefCell::new(Probe::default());
}

pub fn probe<T>(f: impl FnOnce(&mut Probe) -> T) -> T {
    PROBE.with(|probe| f(&mut probe.borrow_mut()))
}

fn log(owner: &str, host: &dyn abi::Host, event: &Event) {
    let mode = host.mode().unwrap_or_else(|| "-".to_owned());
    let event = match event {
        Event::Key(key) => match &key.bind {
            Some(bind) => format!("key {bind}"),
            None => format!("any {}", key.key),
        },
        Event::Paste { text } => format!("paste {text}"),
        Event::Pointer(pointer) => format!("{:?} {} {},{}", pointer.kind, pointer.node, pointer.x, pointer.y),
        Event::Hover { node, inside } => format!("hover {node} {inside}"),
        Event::Closed { surface } => format!("closed {surface}"),
    };
    probe(|probe| probe.log.push(format!("{owner}: {event} [{mode}]")));
}

pub fn setup(setup: &mut abi::Setup) -> Result<(), String> {
    let command = |name: &str| abi::Command { name: name.to_owned(), ..abi::Command::default() };
    setup.command(command("input.panel"), |host, input| {
        host.open_panel(OpenPanel { surface: "side".into(), session: None, fullscreen: input == Some("full") });
    });
    setup.command(command("input.close"), |host, _| host.close_panel("side"));
    setup.command(command("input.overlay"), |host, _| {
        host.overlay(Overlay { surface: "menu".into(), anchor: Anchor::Point { x: 4, y: 3 }, width: 24, height: 4 });
    });
    setup.command(command("input.focus"), |host, input| host.focus(input.unwrap_or("a")));
    // Changes nothing: the plugin's surfaces draw again after it, with what the probe says now.
    setup.command(command("input.redraw"), |_, _| {});
    // The rich select: its rows follow the probe's `rows`, and it is shown again under its key as they change.
    setup.command(command("input.select"), |host, _| host.dialog(abi::Dialog::Select(select())));
    setup.command(command("input.reselect"), |host, _| {
        if host.dialog_open("pick") {
            host.dialog(abi::Dialog::Select(select()));
        }
    });
    setup.command(command("input.picked"), |_, input| {
        probe(|probe| probe.log.push(format!("picked {}", input.unwrap_or("-"))));
    });
    setup.command(command("input.row"), |_, input| {
        probe(|probe| probe.log.push(format!("row {}", input.unwrap_or("-"))));
    });
    setup.command(command("input.update"), |_, input| {
        probe(|probe| probe.log.push(format!("update {}", input.unwrap_or("-"))));
    });
    setup.command(command("input.details"), |host, _| {
        host.dialog(abi::Dialog::ErrorDetails(abi::ErrorDetails {
            title: "Probe error".into(),
            error: "it broke".into(),
            source: Some("probe.rs".into()),
            context: Some("Status: failed".into()),
            back: Some(abi::Action::Command { name: "input.picked".into(), input: Some("back".into()) }),
        }));
    });
    let side = v2::Surface::new("side", v2::Place::Panel("side".into()), side)
        .layers(vec![
            Layer {
                scope: LayerScope::Surface,
                priority: 5,
                keys: vec![
                    Bind::new("x", "x"),
                    Bind::new("m", "mode"),
                    Bind::new("o", "overlay"),
                    Bind::new("ctrl+c", "c"),
                ],
                ..Layer::default()
            },
            Layer { scope: LayerScope::Node("a".into()), keys: vec![Bind::new("y", "y")], ..Layer::default() },
            Layer {
                scope: LayerScope::Surface,
                mode: Some("menu".into()),
                keys: vec![Bind::new("j", "down")],
                ..Layer::default()
            },
        ])
        .on(|host, event| {
            log("side", host, event);
            match event {
                Event::Key(key) => match key.bind.as_deref() {
                    Some("x") if probe(|probe| probe.pass_x) => Handled::Pass,
                    Some("x") => Handled::Consume,
                    Some("y") => {
                        host.focus("b");
                        Handled::Consume
                    }
                    Some("mode") => {
                        let next = if host.mode().is_some() { None } else { Some("menu") };
                        host.set_mode(next);
                        Handled::Consume
                    }
                    Some("overlay") => {
                        let anchor = Anchor::Node { node: "a".into() };
                        host.overlay(Overlay { surface: "menu".into(), anchor, width: 20, height: 3 });
                        Handled::Consume
                    }
                    _ => Handled::Consume,
                },
                Event::Pointer(pointer) if pointer.kind == PointerKind::WheelDown => Handled::Pass,
                Event::Pointer(pointer) if pointer.kind == PointerKind::Down && probe(|probe| probe.pass_press) => {
                    Handled::Pass
                }
                _ => Handled::Consume,
            }
        });
    // The bind of `x` holds the keys after it while the probe asks.
    let side = match probe(|probe| probe.hold) {
        true => {
            let mut layers = side.layers.clone();
            layers[0].keys[0].hold = true;
            side.layers(layers)
        }
        false => side,
    };
    setup.surface(side);
    setup.surface(
        v2::Surface::new("menu", v2::Place::Overlay("menu".into()), |_| {
            v2::Node::column(vec![
                v2::Node::text(vec![abi::Span::new("MENU one")]),
                v2::Node::text(vec![abi::Span::new("MENU two")]),
            ])
        })
        .layers(vec![Layer { scope: LayerScope::Surface, keys: vec![Bind::new("k", "k")], ..Layer::default() }])
        .on(|host, event| {
            log("menu", host, event);
            Handled::Consume
        }),
    );
    // A modal composer: `escape` enters normal mode, where every key is taken, and `i` leaves it.
    setup.layer(
        Layer {
            scope: LayerScope::Composer,
            priority: 10,
            keys: vec![Bind::new("escape", "normal")],
            ..Layer::default()
        },
        |host, event| {
            log("setup", host, event);
            host.set_mode(Some("normal"));
            Handled::Consume
        },
    );
    setup.layer(
        Layer { scope: LayerScope::Composer, mode: Some("normal".into()), any: true, paste: true, ..Layer::default() },
        |host, event| {
            log("setup", host, event);
            match event {
                Event::Key(key) if key.text.as_deref() == Some("i") => host.set_mode(None),
                Event::Key(key) if key.text.as_deref() == Some("p") => {
                    host.edit_composer(abi::ComposerEdit::Insert { text: "P".into() });
                }
                _ => {}
            }
            Handled::Consume
        },
    );
    setup.layer(Layer { scope: LayerScope::Global, any: true, ..Layer::default() }, |host, event| {
        if probe(|probe| probe.listen) {
            log("global", host, event);
        }
        if probe(|probe| probe.swallow) { Handled::Consume } else { Handled::Pass }
    });
    // Two more global listeners: one newer at the same priority, one above it.
    for (name, priority) in [("newer", 0), ("above", 1)] {
        setup.layer(
            Layer { scope: LayerScope::Global, priority, any: true, ..Layer::default() },
            move |host, event| {
                if probe(|probe| probe.listen_more) {
                    log(name, host, event);
                }
                Handled::Pass
            },
        );
    }
    // `x` in the composer: taken, or passed on to the composer, which types it.
    setup.layer(
        Layer { scope: LayerScope::Composer, keys: vec![Bind::new("x", "cx")], ..Layer::default() },
        |host, event| {
            log("setup", host, event);
            if probe(|probe| probe.pass_x) { Handled::Pass } else { Handled::Consume }
        },
    );
    Ok(())
}

/// The probe's rich select: a row of each of its `rows`, one with its own action, one that toggles `test.other`, one
/// that toggles the probe itself (which the host refuses), with a footer action, a key, and live footers.
fn select() -> abi::Select {
    let (rows, footer) = probe(|probe| (probe.rows.clone(), probe.footer.clone()));
    let command = |name: &str| abi::Action::Command { name: name.into(), input: None };
    let options = rows
        .iter()
        .map(|row| {
            let mut option = abi::SelectOption::new(format!("row {row}"), row.clone());
            option.footer = Some(format!("{footer} {row}"));
            option.footer_color = Some(abi::Color::from("text.muted"));
            match row.as_str() {
                "beta" => option.action = Some(command("input.row")),
                "other" => option.toggle = Some("test.other".into()),
                "self" => option.toggle = Some(ID.into()),
                "spin" => option.gutter = Some(abi::Gutter::Spinner),
                _ => option.gutter = Some(abi::Gutter::Span(abi::Span::new("x"))),
            }
            option
        })
        .collect();
    abi::Select {
        title: "Pick".into(),
        placeholder: None,
        options,
        current: None,
        action: command("input.picked"),
        key: Some("pick".into()),
        actions: vec![abi::SelectAction {
            title: "update".into(),
            key: Some("ctrl+u".into()),
            action: command("input.update"),
            hidden: vec!["beta".into()],
            primary: false,
        }],
        binds: vec![abi::PanelBind { key: "ctrl+e".into(), title: "echo".into(), action: command("input.picked") }],
    }
}

/// The other plugin a select's row toggles: a line in the home footer while it is active.
pub fn other(setup: &mut abi::Setup) -> Result<(), String> {
    setup.slot(abi::Placement::append("session.composer.top"), |_, _, _| {
        abi::Render::Show(abi::Node::text([abi::Span::new("OTHER ON")]))
    });
    Ok(())
}

fn side(cx: &mut v2::View<'_>) -> v2::Node {
    let panel = cx.input.panel;
    probe(|probe| {
        probe.panel = panel;
        probe.views += 1;
    });
    let label = panel
        .map_or("no panel".to_owned(), |panel| format!("PANEL full={} focused={}", panel.fullscreen, panel.focused));
    let interact = |focusable, pointer, hover: Option<&'static str>| Interact {
        focusable,
        pointer,
        hover: hover.map(abi::Color::from),
        hover_events: pointer,
    };
    v2::Node::column(vec![
        v2::Node::text(vec![abi::Span::new(label)]),
        v2::Node::row(vec![v2::Node::text(vec![abi::Span::new("AAAA")])]).with_id("a").interact(interact(
            true,
            true,
            Some("#ff0000"),
        )),
        v2::Node::row(vec![v2::Node::text(vec![abi::Span::new("BBBB")])]).with_id("b").interact(interact(
            true,
            probe(|probe| probe.pointer_b),
            None,
        )),
    ])
    .with_id("side")
    .interact(interact(true, false, None))
}

pub fn open() -> Harness {
    open_with(|_| {})
}

/// The TUI on session `ses_a` with the test plugin, set up after `prepare` set the probe.
pub fn open_with(prepare: impl FnOnce(&mut Probe)) -> Harness {
    probe(|probe| {
        *probe = Probe::default();
        prepare(probe);
    });
    let deps = Deps {
        builtins: vec![abi::Plugin { id: ID, setup }.into(), abi::Plugin { id: "test.other", setup: other }.into()],
        ..support::deps(Arc::new(support::Fake::new(|seen| support::base(seen, support::DIRECTORY))))
    };
    let harness = support::mount(120, 30, deps);
    settle(&harness);
    harness
}

pub fn settle(harness: &Harness) {
    for _ in 0..3 {
        harness.app.advance(Duration::from_millis(1));
        harness.app.render();
    }
}

pub fn run(harness: &Harness, command: &str, input: Option<&str>) {
    harness.tui.keymap.dispatch(command, input);
    settle(harness);
}

pub fn taken() -> Vec<String> {
    probe(|probe| std::mem::take(&mut probe.log))
}

fn key(code: KeyCode) -> Input {
    Input::Key(KeyEvent::new(code, Modifiers::NONE))
}

/// Dispatches `keys` as one polled batch: nothing deferred runs between them.
pub fn batch(harness: &Harness, keys: &[Input]) {
    for event in keys {
        harness.app.app().dispatch(event.clone());
    }
    settle(harness);
}

fn composer(harness: &Harness) -> String {
    let mut text = String::new();
    opencode_plugin::Host::read(&*harness.tui, &mut |read| {
        text = read.composer().map(|composer| composer.text).unwrap_or_default();
    });
    text
}

// Expected (P2, the docked panel): a command opens the panel surface beside the session, its view gets the panel's
// input (split, with the input), keys of its surface layer reach its handler while it has the focus, and closing it
// revokes every layer it registered.
#[test]
fn a_panel_surface_docks_takes_keys_and_revokes_them() {
    let harness = open();
    let before = interact::ledger(&*harness.tui);
    run(&harness, "input.panel", None);
    let screen = harness.app.text();
    assert!(screen.contains("PANEL full=false focused=true"), "{screen}");
    let shown = interact::ledger(&*harness.tui);
    assert_eq!(shown.layers, before.layers + 3, "the panel's three layers: {shown:?}");
    harness.app.press("x");
    settle(&harness);
    assert_eq!(taken(), ["side: key x [-]"]);
    // The node layer holds only while its node has the focus.
    harness.app.press("y");
    settle(&harness);
    assert_eq!(taken(), Vec::<String>::new());
    run(&harness, "input.focus", Some("a"));
    harness.app.press("y");
    settle(&harness);
    assert_eq!(taken(), ["side: key y [-]"]);
    // `y` gave the focus to `b`: `y` no longer reaches the node layer of `a`.
    harness.app.press("y");
    settle(&harness);
    assert_eq!(taken(), Vec::<String>::new());
    run(&harness, "input.panel", Some("full"));
    assert!(harness.app.text().contains("PANEL full=true"), "{}", harness.app.text());
    run(&harness, "input.close", None);
    assert!(!harness.app.text().contains("PANEL"), "{}", harness.app.text());
    assert_eq!(interact::ledger(&*harness.tui), before);
}

// Expected (`Pass`): a bind whose handler passes lets the key go on down the host's order, as if the plugin were not
// there; a consumed one goes no further.
#[test]
fn a_passed_key_goes_on_and_a_consumed_one_does_not() {
    let harness = open();
    harness.app.type_text("x");
    settle(&harness);
    assert_eq!(composer(&harness), "");
    assert_eq!(taken(), ["setup: key cx [-]"]);
    probe(|probe| {
        probe.pass_x = true;
        probe.listen = true;
    });
    harness.app.type_text("x");
    settle(&harness);
    assert_eq!(composer(&harness), "x");
    assert_eq!(taken(), ["global: any x [-]", "setup: key cx [-]"]);
}

// Expected (3.8, `delivery`): a modal composer's mode switch applies before the next key of the same batch: `esc`,
// `d`, `w` in one read inserts nothing, and `i` then text loses no character.
#[test]
fn a_mode_switch_applies_before_the_next_key_of_the_batch() {
    let harness = open_with(|probe| probe.listen = true);
    harness.app.type_text("ab");
    settle(&harness);
    assert_eq!(composer(&harness), "ab");
    batch(
        &harness,
        &[
            key(KeyCode::Escape),
            key(KeyCode::Char('d')),
            key(KeyCode::Char('w')),
            key(KeyCode::Char('i')),
            key(KeyCode::Char('c')),
        ],
    );
    assert_eq!(composer(&harness), "abc");
    let log = taken();
    assert_eq!(
        log,
        [
            "global: any a [-]",
            "global: any b [-]",
            "global: any escape [-]",
            "setup: key normal [-]",
            "setup: any d [normal]",
            "setup: any w [normal]",
            "setup: any i [normal]",
            "global: any c [-]",
        ]
    );
    // An edit asked for in normal mode goes through the composer's own edit path before the next key.
    batch(&harness, &[key(KeyCode::Escape), key(KeyCode::Char('p')), key(KeyCode::Char('i')), key(KeyCode::Char('z'))]);
    assert_eq!(composer(&harness), "abcPz");
    // A paste in normal mode is the layer's, which takes it.
    batch(&harness, &[key(KeyCode::Escape)]);
    harness.app.paste("pasted");
    settle(&harness);
    assert_eq!(composer(&harness), "abcPz");
    assert!(taken().contains(&"setup: paste pasted [normal]".to_owned()));
}

// Expected (3.8): a mode ends when the focus leaves its scope, and does not come back with the focus; the reserved
// chord ends every plugin mode and reaches the app; no layer may bind it.
#[test]
fn a_mode_ends_with_its_scope_and_on_the_reserved_chord() {
    let harness = open();
    let base = interact::ledger(&*harness.tui);
    batch(&harness, &[key(KeyCode::Escape)]);
    assert_eq!(interact::ledger(&*harness.tui).modes, base.modes + 1);
    // The panel takes the focus; the composer's mode ends.
    run(&harness, "input.panel", None);
    run(&harness, "input.close", None);
    opencode_plugin::Host::focus_composer(&*harness.tui);
    settle(&harness);
    harness.app.type_text("d");
    settle(&harness);
    assert_eq!(composer(&harness), "d", "a mode came back with the focus");
    assert_eq!(interact::ledger(&*harness.tui).modes, base.modes, "an ended mode stayed on the keymap's stack");
    // The reserved chord.
    batch(&harness, &[key(KeyCode::Escape)]);
    probe(|probe| probe.listen = true);
    taken();
    harness.app.press("ctrl+c");
    settle(&harness);
    harness.app.type_text("e");
    settle(&harness);
    assert!(composer(&harness).ends_with('e'), "{}", composer(&harness));
    assert!(!taken().iter().any(|line| line.contains("ctrl+c")), "a listener saw the reserved chord");
    assert_eq!(interact::ledger(&*harness.tui).modes, base.modes, "an ended mode stayed past the next key");
    // A panel's mode ends as the focus leaves the panel, with no key after it.
    run(&harness, "input.panel", None);
    harness.app.press("m");
    settle(&harness);
    assert_eq!(interact::ledger(&*harness.tui).modes, base.modes + 1);
    opencode_plugin::Host::focus_composer(&*harness.tui);
    settle(&harness);
    assert_eq!(interact::ledger(&*harness.tui).modes, base.modes, "a mode stayed past its scope's blur");
}

// Expected (the `Any` listener): a global listener sees every key in the base mode before the host's layers, and one
// that consumes takes the key from them.
#[test]
fn a_global_listener_sees_every_key_and_may_take_it() {
    let harness = open_with(|probe| probe.listen = true);
    harness.app.type_text("hi");
    settle(&harness);
    assert_eq!(taken(), ["global: any h [-]", "global: any i [-]"]);
    assert_eq!(composer(&harness), "hi");
    probe(|probe| probe.swallow = true);
    harness.app.type_text("j");
    settle(&harness);
    assert_eq!(composer(&harness), "hi");
    assert_eq!(taken(), ["global: any j [-]"]);
}

// Expected (pointer and hover): a press, a drag after a consumed press, a release and the wheel reach a pointer node
// with the cell in the node; the hover color is the host's with no call; the drag ends with the release.
#[test]
fn pointer_events_carry_the_cell_and_a_consumed_press_captures_the_drag() {
    let harness = open();
    run(&harness, "input.panel", None);
    let (x, y) = support::at(&harness.app.text(), "AAAA").unwrap();
    taken();
    harness.app.mouse(MouseEventKind::Down(MouseButton::Left), x + 1, y);
    settle(&harness);
    assert!(interact::ledger(&*harness.tui).capture);
    harness.app.mouse(MouseEventKind::Drag(MouseButton::Left), x + 2, y);
    harness.app.mouse(MouseEventKind::Up(MouseButton::Left), x + 2, y);
    settle(&harness);
    assert!(!interact::ledger(&*harness.tui).capture);
    harness.app.mouse(MouseEventKind::ScrollDown, x + 1, y);
    settle(&harness);
    let log = taken();
    let pointer: Vec<&String> = log.iter().filter(|line| !line.contains("hover")).collect();
    assert_eq!(
        pointer,
        ["side: Down a 1,0 [-]", "side: Drag a 2,0 [-]", "side: Up a 2,0 [-]", "side: WheelDown a 1,0 [-]"]
    );
    assert!(log.contains(&"side: hover a true [-]".to_owned()), "{log:?}");
    // The hover color, under the pointer.
    let capture = harness.app.render();
    let cell = capture.cell(u32::from(x), u32::from(y)).unwrap();
    assert_eq!(cell.bg, opentui::style::Color::rgb(255, 0, 0));
}

// Expected (the overlay): it opens at its anchor over the session, takes the focus and its own keys, and escape closes
// it, which its opener hears; a press outside it closes it too; it ends with its opener.
#[test]
fn an_overlay_takes_the_focus_and_closes_on_escape_or_outside() {
    let harness = open();
    run(&harness, "input.panel", None);
    let base = interact::ledger(&*harness.tui);
    harness.app.press("o");
    settle(&harness);
    assert!(harness.app.text().contains("MENU one"), "{}", harness.app.text());
    assert_eq!(interact::ledger(&*harness.tui).overlays, base.overlays + 2, "the backdrop and the frame");
    taken();
    harness.app.press("k");
    settle(&harness);
    harness.app.press("escape");
    settle(&harness);
    assert!(!harness.app.text().contains("MENU one"));
    assert_eq!(taken(), ["menu: key k [-]", "side: closed menu [-]"]);
    harness.app.press("o");
    settle(&harness);
    harness.app.click(0, 0);
    settle(&harness);
    assert!(!harness.app.text().contains("MENU one"));
    assert_eq!(taken(), ["side: key overlay [-]", "side: closed menu [-]"]);
    // The opener goes: its overlay goes with it, and nothing tells it.
    harness.app.press("o");
    settle(&harness);
    run(&harness, "input.close", None);
    assert!(!harness.app.text().contains("MENU one"));
    assert_eq!(interact::ledger(&*harness.tui).overlays, 0);
    assert_eq!(taken(), ["side: key overlay [-]"]);
}

// Expected (the hold): after a consumed hold key the host holds the keys that follow until the plugin releases them
// or the hold's time passes, then routes them in their order.
#[test]
fn a_hold_key_holds_the_keys_after_it_until_the_time_passes() {
    let harness = open_with(|probe| probe.hold = true);
    run(&harness, "input.panel", None);
    taken();
    harness.app.press("x");
    harness.app.press("m");
    harness.app.press("j");
    assert_eq!(interact::ledger(&*harness.tui).held, 2);
    assert_eq!(taken(), ["side: key x [-]"]);
    harness.app.advance(input::HOLD + Duration::from_millis(1));
    settle(&harness);
    assert_eq!(taken(), ["side: key mode [-]", "side: key down [menu]"]);
    assert_eq!(interact::ledger(&*harness.tui).held, 0);
}

fn rows(rows: &[&str], footer: &str) {
    probe(|probe| {
        probe.rows = rows.iter().map(|row| (*row).to_owned()).collect();
        probe.footer = footer.to_owned();
    });
}

/// Whether plugin `id` is active.
fn active(harness: &Harness, id: &str) -> bool {
    harness.tui.plugins.entries().iter().any(|entry| entry.id == id && entry.active)
}

// Expected (the rich select, 4.10): a select shown again under its key while it is open changes in place, keeping the
// filter and the selected row; footers and colors are the plugin's, live; a plugin that finds it closed shows nothing.
#[test]
fn a_rich_select_changes_in_place_and_keeps_its_filter() {
    let harness = open();
    rows(&["alpha", "beta", "gamma"], "old");
    run(&harness, "input.select", None);
    harness.app.type_text("gam");
    settle(&harness);
    rows(&["alpha", "beta", "gamma", "delta"], "new");
    run(&harness, "input.reselect", None);
    let screen = harness.app.text();
    assert!(screen.contains("row gamma") && screen.contains("new gamma"), "{screen}");
    assert!(!screen.contains("row alpha"), "the filter went: {screen}");
    assert!(screen.contains("gam"), "{screen}");
    // Picking the row runs the select's action and leaves it open: it has a key.
    harness.app.press("enter");
    settle(&harness);
    assert_eq!(taken(), ["picked gamma"]);
    assert!(harness.app.text().contains("row gamma"));
    harness.app.press("escape");
    settle(&harness);
    run(&harness, "input.reselect", None);
    assert!(!harness.app.text().contains("Pick"), "a closed select opened again");
}

// Expected (4.10): a row's own action runs instead of the select's; a footer action runs with the selected row's
// value and is hidden on the rows it names; an extra key runs with the selected row.
#[test]
fn a_rich_select_runs_row_actions_footer_actions_and_keys() {
    let harness = open();
    rows(&["alpha", "beta"], "f");
    run(&harness, "input.select", None);
    harness.app.press("ctrl+u");
    settle(&harness);
    harness.app.press("ctrl+e");
    settle(&harness);
    harness.app.press("down");
    settle(&harness);
    harness.app.press("enter");
    settle(&harness);
    // `update` is hidden on `beta`: its key goes on to the list.
    harness.app.press("ctrl+u");
    settle(&harness);
    assert_eq!(taken(), ["update alpha", "picked alpha", "row beta"]);
}

// Expected (3.6): a row may toggle another plugin, which the host does after the key and labels from the plugin's
// real state; a row that names its own plugin is refused.
#[test]
fn a_select_row_toggles_another_plugin_but_never_its_own() {
    let harness = open();
    assert!(active(&harness, "test.other"));
    rows(&["other", "self"], "f");
    run(&harness, "input.select", None);
    let screen = harness.app.text();
    assert!(screen.contains("enabled") && screen.contains("disable"), "{screen}");
    harness.app.press("enter");
    settle(&harness);
    assert!(!active(&harness, "test.other"));
    run(&harness, "input.reselect", None);
    assert!(harness.app.text().contains("disabled"), "{}", harness.app.text());
    harness.app.press("down");
    settle(&harness);
    harness.app.press("enter");
    settle(&harness);
    assert!(active(&harness, ID), "a row toggled its own plugin");
}

// Expected (the error view): the host's own error details show the plugin's error, and escape runs its back action.
#[test]
fn error_details_show_and_go_back() {
    let harness = open();
    run(&harness, "input.details", None);
    let screen = harness.app.text();
    assert!(screen.contains("Probe error") && screen.contains("it broke"), "{screen}");
    harness.app.press("escape");
    settle(&harness);
    assert!(!harness.app.text().contains("Probe error"));
    assert_eq!(taken(), ["picked back"]);
}

// Expected: no layer may bind the reserved chord; a pointer drag without a consumed press reaches nobody.
#[test]
fn the_reserved_chord_and_an_uncaptured_drag_reach_no_plugin() {
    let harness = open();
    run(&harness, "input.panel", None);
    taken();
    harness.app.press("ctrl+c");
    settle(&harness);
    assert!(!taken().iter().any(|line| line.contains("key c")));
    let (x, y) = support::at(&harness.app.text(), "AAAA").unwrap();
    harness.app.mouse(MouseEventKind::Drag(MouseButton::Left), x + 1, y);
    settle(&harness);
    assert!(!taken().iter().any(|line| line.contains("Drag")));
}

// Expected (the listeners' order): listeners run by priority, the newest first among equals, before any layer.
#[test]
fn listeners_run_by_priority_then_newest_first() {
    let harness = open_with(|probe| {
        probe.listen = true;
        probe.listen_more = true;
    });
    harness.app.type_text("q");
    settle(&harness);
    assert_eq!(taken(), ["above: any q [-]", "newer: any q [-]", "global: any q [-]"]);
}

// Expected (capture): a press the plugin passes captures nothing, so the drag after it reaches no plugin.
#[test]
fn a_passed_press_captures_nothing() {
    let harness = open_with(|probe| probe.pass_press = true);
    run(&harness, "input.panel", None);
    let (x, y) = support::at(&harness.app.text(), "AAAA").unwrap();
    taken();
    harness.app.mouse(MouseEventKind::Down(MouseButton::Left), x + 1, y);
    harness.app.mouse(MouseEventKind::Drag(MouseButton::Left), x + 2, y);
    settle(&harness);
    assert!(!interact::ledger(&*harness.tui).capture);
    let log: Vec<String> = taken().into_iter().filter(|line| !line.contains("hover")).collect();
    assert_eq!(log, ["side: Down a 1,0 [-]"]);
}

// Expected (`reconcile-fresh` for input): a box whose pointer flag changes is wired again, so its events follow the
// tree the host accepted last.
#[test]
fn a_box_that_gains_pointer_events_gets_them() {
    let harness = open();
    run(&harness, "input.panel", None);
    let (x, y) = support::at(&harness.app.text(), "BBBB").unwrap();
    taken();
    harness.app.click(x + 1, y);
    settle(&harness);
    assert_eq!(taken(), Vec::<String>::new());
    probe(|probe| probe.pointer_b = true);
    run(&harness, "input.redraw", None);
    harness.app.click(x + 1, y);
    settle(&harness);
    let log: Vec<String> = taken().into_iter().filter(|line| !line.contains("hover")).collect();
    assert_eq!(log, ["side: Down b 1,0 [-]", "side: Up b 1,0 [-]"]);
}
