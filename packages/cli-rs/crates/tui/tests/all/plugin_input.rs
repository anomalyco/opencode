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
    /// Text `t` tells the pointer entering and leaving.
    pub hover_t: bool,
    /// The `x` bind holds the keys after it.
    pub hold: bool,
    /// The panel's view.
    pub panel: Option<input::PanelInput>,
    pub views: usize,
    /// The rows of the rich select, and the word of their footers.
    pub rows: Vec<String>,
    pub footer: String,
    /// The rich select lists its rows by the plugin's search.
    pub search: bool,
    /// A strip of the plugin in the session's composer top, with a node that takes drops.
    pub strip: bool,
    /// A global layer that takes pastes.
    pub paste_global: bool,
    /// The panel leaves node `b` out.
    pub hide_b: bool,
    /// The selection copies on the reserved chord, and keeps it from the keymap (`terminal.copy` `manual`).
    pub manual_copy: bool,
    /// The rich select has no key.
    pub keyless: bool,
    /// The other plugin binds escape everywhere, above an overlay's own.
    pub other_escape: bool,
    /// The panel's handler panics as it hears an overlay of it closed.
    pub panic_closed: bool,
    /// A press on `a` gives the focus to `b`.
    pub down_focus_b: bool,
    /// Node `a` has padding, which builds it again; node `a` is left out; node `a` is on a background token.
    pub a_pad: bool,
    pub hide_a: bool,
    pub a_bg: Option<&'static str>,
    /// Node `a` is in a hidden box.
    pub a_in_hidden: bool,
    /// Each view of the panel: how it showed, and its mount's generation.
    pub panels: Vec<(Option<input::PanelInput>, u64)>,
    /// The panel's handler panics, which fails the plugin.
    pub panic: bool,
    /// The rich select has no footer action.
    pub no_update: bool,
    /// The rich select's first footer action, `launch`, runs on the row and does not say its group.
    pub launch: bool,
    /// Node `a` has a click of its own, on the press, which runs `input.row a`.
    pub click_a: bool,
    /// Two composer paste layers: an older one above, a newer one below.
    pub paste_rank: bool,
    /// The panel's texts may be selected.
    pub selectable: bool,
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
        Event::Key(key) => match key.bind.as_deref() {
            // The bind of several keys says which one it was.
            Some("v") => format!("key v as {}", key.key),
            Some(bind) => format!("key {bind}"),
            None => format!("any {}", key.key),
        },
        Event::Paste { text } => format!("paste {text}"),
        Event::Pointer(pointer) => {
            let from = pointer.from.as_ref().map(|from| format!(" from {}/{}", from.surface, from.node));
            format!("{:?} {} {},{}{}", pointer.kind, pointer.node, pointer.x, pointer.y, from.unwrap_or_default())
        }
        Event::Hover { node, inside } => format!("hover {node} {inside}"),
        Event::Closed { surface } => format!("closed {surface}"),
        Event::Scroll { event } => format!("scroll {event:?}"),
        Event::Change { node, text } => format!("change {node} {text}"),
        Event::Submit { node, text } => format!("submit {node} {text}"),
        Event::Mount { mounted, .. } => format!("mount {mounted}"),
    };
    probe(|probe| probe.log.push(format!("{owner}: {event} [{mode}]")));
}

pub fn setup(setup: &mut abi::Setup) -> Result<(), String> {
    let command = |name: &str| abi::Command { name: name.to_owned(), ..abi::Command::default() };
    setup.command(command("input.panel"), |host, input| {
        host.open_panel(OpenPanel { surface: "side".into(), session: None, fullscreen: input == Some("full") });
    });
    setup.command(command("input.close"), |host, _| host.close_panel("side"));
    setup.command(command("input.elsewhere"), |host, _| {
        host.open_panel(OpenPanel { surface: "side".into(), session: Some("ses_other".into()), fullscreen: false });
    });
    setup.command(command("input.overlay"), |host, _| {
        host.overlay(Overlay { surface: "menu".into(), anchor: Anchor::Point { x: 4, y: 3 }, width: 24, height: 4 });
    });
    // The overlay against an edge of the panel, inside it.
    setup.command(command("input.beside"), |host, _| {
        let anchor = Anchor::Surface { surface: "side".into(), edge: input::Edge::Left };
        host.overlay(Overlay { surface: "menu".into(), anchor, width: 12, height: 3 });
    });
    setup.command(command("input.focus"), |host, input| host.focus(input.unwrap_or("a")));
    // Picks the select's row as Enter would, but by the command's name.
    setup.command(command("input.submit"), |host, _| host.dispatch("dialog.select.submit", None));
    setup.command(command("input.release"), |host, _| host.release_keys());
    // Two moves of the focus in one call: out of the panel, and back.
    setup.command(command("input.bounce"), |host, _| {
        host.blur();
        host.focus("a");
    });
    setup.command(command("input.route"), |host, _| host.open_route("probe"));
    setup.command(command("input.nopanel"), |host, _| {
        host.open_panel(OpenPanel { surface: "nope".into(), session: None, fullscreen: false });
    });
    setup.command(command("input.unmenu"), |host, _| host.close_overlay("menu"));
    setup.command(command("input.edge"), |host, _| {
        let anchor = Anchor::Edge(input::Edge::Bottom);
        host.overlay(Overlay { surface: "menu".into(), anchor, width: 24, height: 2 });
    });
    // Changes nothing: the plugin's surfaces draw again after it, with what the probe says now.
    setup.command(command("input.redraw"), |_, _| {});
    // The geometry and focus reads, as a command makes them: of the plugin's mount that holds the node.
    setup.command(command("input.where"), |host, input| {
        let rect = host.rect(input.unwrap_or("a"));
        let focused = host.focused();
        probe(|probe| probe.log.push(format!("where {rect:?} {focused:?}")));
    });
    // The rich select: its rows follow the probe's `rows`, and it is shown again under its key as they change.
    setup.command(command("input.select"), |host, _| host.dialog(abi::Dialog::Select(select(host))));
    setup.command(command("input.reselect"), |host, _| {
        if host.dialog_open("pick") {
            host.dialog(abi::Dialog::Select(select(host)));
        }
    });
    // The toggle row's footer follows the plugins the host lists (P6b).
    setup.on_plugins(|host| {
        if host.dialog_open("pick") {
            host.dialog(abi::Dialog::Select(select(host)));
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
            reference: None,
            key: None,
        }));
    });
    // Lists, last first, the rows whose value holds the query, and logs what it was given.
    setup.search("probe", |_, query, options| {
        probe(|probe| probe.log.push(format!("search {query:?} {}", options.len())));
        options.iter().rev().filter(|option| option.value.contains(query)).map(|option| option.value.clone()).collect()
    });
    if probe(|probe| probe.strip) {
        let strip = v2::Surface::new("strip", v2::Place::Slot(abi::Placement::append("session.composer.top")), |_| {
            let interact = Interact { pointer: true, focusable: true, ..Interact::default() };
            v2::Node::row(vec![unselectable(v2::Node::text(vec![abi::Span::new("STRIP")]))])
                .with_id("s")
                .interact(interact)
        });
        let layers = vec![Layer { scope: LayerScope::Surface, paste: true, ..Layer::default() }];
        setup.surface(strip.layers(layers).on(|host, event| {
            log("strip", host, event);
            Handled::Consume
        }));
    }
    if probe(|probe| probe.paste_global) {
        // Passes a paste that starts with `pass`.
        setup.layer(Layer { scope: LayerScope::Global, paste: true, ..Layer::default() }, |host, event| {
            log("pasted", host, event);
            match event {
                Event::Paste { text } if text.starts_with("pass") => Handled::Pass,
                _ => Handled::Consume,
            }
        });
    }
    if probe(|probe| probe.paste_rank) {
        for (name, priority) in [("high", 5), ("low", 0)] {
            let layer = Layer { scope: LayerScope::Composer, priority, paste: true, ..Layer::default() };
            setup.layer(layer, move |host, event| {
                log(name, host, event);
                Handled::Consume
            });
        }
    }
    // A route of the plugin: its layer takes `k`, `w` (where its focus is) and pastes.
    let route = v2::Surface::new("probe", v2::Place::Route("probe".into()), |_| {
        let interact = Interact { focusable: true, ..Interact::default() };
        v2::Node::column(vec![
            unselectable(v2::Node::text(vec![abi::Span::new("ROUTE")])),
            v2::Node::row(vec![unselectable(v2::Node::text(vec![abi::Span::new("RRRR")]))])
                .with_id("r")
                .interact(interact),
        ])
    })
    .layers(vec![Layer {
        scope: LayerScope::Surface,
        priority: 5,
        paste: true,
        keys: vec![Bind::new("k", "k"), Bind::new("w", "where")],
        ..Layer::default()
    }])
    .on(|host, event| {
        log("route", host, event);
        if let Event::Paste { text } = event
            && text.starts_with("pass")
        {
            return Handled::Pass;
        }
        if let Event::Key(key) = event
            && key.bind.as_deref() == Some("where")
        {
            let (rect, focused) = (host.rect("r").is_some(), host.focused());
            probe(|probe| probe.log.push(format!("where {rect} {focused:?}")));
        }
        Handled::Consume
    });
    setup.surface(route);
    let side = v2::Surface::new("side", v2::Place::Panel("side".into()), side)
        .layers(vec![
            Layer {
                scope: LayerScope::Surface,
                priority: 5,
                paste: true,
                keys: vec![
                    Bind::new("x", "x"),
                    Bind::new("m", "mode"),
                    Bind::new("o", "overlay"),
                    Bind::new("ctrl+c", "c"),
                    Bind::new("Control + C", "c"),
                    Bind::new("a,ctrl+c", "c"),
                    Bind::new("ctrl+c x", "c"),
                    Bind::new("v,ctrl+t", "v"),
                ],
                ..Layer::default()
            },
            Layer { scope: LayerScope::Node("a".into()), keys: vec![Bind::new("y", "y")], ..Layer::default() },
            // A layer of the composer too: the panel's mode still holds where it was set.
            Layer { scope: LayerScope::Composer, keys: vec![Bind::new("z", "z")], ..Layer::default() },
            Layer {
                scope: LayerScope::Surface,
                mode: Some("menu".into()),
                keys: vec![Bind::new("j", "down")],
                ..Layer::default()
            },
        ])
        .on(|host, event| {
            assert!(!probe(|probe| probe.panic), "the probe asked for a panic");
            let closed = matches!(event, Event::Closed { .. });
            assert!(!(closed && probe(|probe| probe.panic_closed)), "the probe asked for a panic on a close");
            log("side", host, event);
            if let Event::Pointer(pointer) = event
                && pointer.kind == PointerKind::Down
                && probe(|probe| probe.down_focus_b)
            {
                host.focus("b");
            }
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
        .layers(vec![
            Layer {
                scope: LayerScope::Surface,
                keys: vec![Bind::new("k", "k"), Bind::new("n", "nav")],
                ..Layer::default()
            },
            Layer {
                scope: LayerScope::Surface,
                mode: Some("nav".into()),
                keys: vec![Bind::new("k", "k")],
                ..Layer::default()
            },
        ])
        .on(|host, event| {
            assert!(!probe(|probe| probe.panic), "the probe asked for a panic");
            log("menu", host, event);
            // `n`: a mode of the overlay, which binds no escape.
            if let Event::Key(key) = event
                && key.bind.as_deref() == Some("nav")
            {
                host.set_mode(Some("nav"));
            }
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
/// that toggles the probe itself (which the host refuses), with a footer action, a key, and live footers; the row that
/// toggles `test.other` says whether it is enabled, as the host lists it.
fn select(read: &dyn abi::Read) -> abi::Select {
    let other = read.plugins().into_iter().find(|entry| entry.id == "test.other").is_some_and(|entry| entry.active);
    let (rows, footer) = probe(|probe| (probe.rows.clone(), probe.footer.clone()));
    let command = |name: &str| abi::Action::Command { name: name.into(), input: None };
    let options = rows
        .iter()
        .flat_map(|row| {
            // `dup`: a hidden disabled row of the same value toggles the other plugin; the shown one does not.
            let hidden = (row == "dup").then(|| abi::SelectOption {
                disabled: true,
                toggle: Some("test.other".into()),
                ..abi::SelectOption::new("row hidden", "dup")
            });
            let mut option = abi::SelectOption::new(format!("row {row}"), row.clone());
            option.footer = Some(format!("{footer} {row}"));
            option.footer_color = Some(abi::Color::from("text.muted"));
            match row.as_str() {
                "beta" => option.action = Some(command("input.row")),
                "other" => {
                    option.toggle = Some("test.other".into());
                    option.footer = Some(if other { "enabled" } else { "disabled" }.into());
                }
                "self" => option.toggle = Some(ID.into()),
                "manager" => option.toggle = Some("opencode.plugins".into()),
                "acme" => option.toggle = Some("@acme/skipped".into()),
                "off" => option.disabled = true,
                "spin" => option.gutter = Some(abi::Gutter::Spinner),
                _ => option.gutter = Some(abi::Gutter::Span(abi::Span::new("x"))),
            }
            hidden.into_iter().chain([option])
        })
        .collect();
    abi::Select {
        title: "Pick".into(),
        placeholder: None,
        options,
        current: None,
        action: command("input.picked"),
        key: (!probe(|probe| probe.keyless)).then(|| "pick".into()),
        actions: match probe(|probe| probe.no_update) {
            true => Vec::new(),
            false => probe(|probe| probe.launch)
                .then(|| abi::SelectAction {
                    title: "launch".into(),
                    key: Some("f5".into()),
                    action: command("input.picked"),
                    hidden: Vec::new(),
                    primary: None,
                    rowless: false,
                    command: None,
                    disabled: false,
                })
                .into_iter()
                .chain([
                    abi::SelectAction {
                        title: "update".into(),
                        key: Some("ctrl+u".into()),
                        action: command("input.update"),
                        hidden: vec!["beta".into()],
                        primary: Some(false),
                        rowless: false,
                        command: None,
                        disabled: false,
                    },
                    abi::SelectAction {
                        title: "cut".into(),
                        key: Some("Ctrl + C".into()),
                        action: command("input.picked"),
                        hidden: Vec::new(),
                        primary: Some(false),
                        rowless: false,
                        command: None,
                        disabled: false,
                    },
                    abi::SelectAction {
                        title: "new".into(),
                        key: Some("ctrl+y".into()),
                        action: abi::Action::Command { name: "input.picked".into(), input: Some("new".into()) },
                        hidden: Vec::new(),
                        primary: None,
                        rowless: true,
                        command: None,
                        disabled: false,
                    },
                ])
                .collect(),
        },
        binds: vec![
            abi::PanelBind { key: "ctrl+e".into(), title: "echo".into(), action: command("input.picked") },
            abi::PanelBind { key: "Ctrl+C".into(), title: "copy".into(), action: command("input.picked") },
        ],
        search: probe(|probe| probe.search).then(|| "probe".into()),
        size: None,
        focus: None,
    }
}

/// The other plugin a select's row toggles: a line in the composer top while it is active, and a node of its own with
/// pointer events, which a drag may start on.
pub fn other(setup: &mut abi::Setup) -> Result<(), String> {
    setup.slot(abi::Placement::append("session.composer.top"), |_, _, _| {
        abi::Render::Show(abi::Node::text([abi::Span::new("OTHER ON")]))
    });
    setup.surface(v2::Surface::new("tag", v2::Place::Slot(abi::Placement::append("session.composer.top")), |_| {
        let interact = Interact { pointer: true, ..Interact::default() };
        v2::Node::row(vec![unselectable(v2::Node::text(vec![abi::Span::new("OTHER TAG")]))])
            .with_id("a")
            .interact(interact)
    }));
    setup.surface(
        v2::Surface::new("pop", v2::Place::Overlay("pop".into()), |_| {
            v2::Node::column(vec![v2::Node::text(vec![abi::Span::new("POP")])])
        })
        .on(|_, _| Handled::Consume),
    );
    let command = |name: &str| abi::Command { name: name.to_owned(), ..abi::Command::default() };
    setup.command(command("other.pop"), |host, _| {
        host.overlay(Overlay { surface: "pop".into(), anchor: Anchor::Point { x: 40, y: 8 }, width: 10, height: 2 });
    });
    setup.command(command("other.release"), |host, _| host.release_keys());
    if probe(|probe| probe.other_escape) {
        let layer = Layer {
            scope: LayerScope::Global,
            priority: 5,
            keys: vec![Bind::new("escape", "esc")],
            ..Layer::default()
        };
        setup.layer(layer, |host, event| {
            log("other", host, event);
            Handled::Consume
        });
    }
    // A mode of a plugin with only a global layer: in it, every key is the plugin's.
    setup.command(command("other.gmode"), |host, _| host.set_mode(Some("g")));
    setup.layer(
        Layer { scope: LayerScope::Global, mode: Some("g".into()), any: true, ..Layer::default() },
        |host, event| {
            log("gmode", host, event);
            Handled::Consume
        },
    );
    Ok(())
}

fn side(cx: &mut v2::View<'_>) -> v2::Node {
    let panel = cx.input.panel;
    let generation = cx.mount.generation;
    probe(|probe| {
        probe.panels.push((panel, generation));
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
    let selectable = probe(|probe| probe.selectable);
    let text = |text: &str| match selectable {
        true => v2::Node::text(vec![abi::Span::new(text)]),
        false => unselectable(v2::Node::text(vec![abi::Span::new(text)])),
    };
    let mut a = v2::Node::row(vec![text("AAAA")]).with_id("a").interact(interact(true, true, Some("#ff0000")));
    if let v2::Node::Box { padding, bg, .. } = &mut a {
        if probe(|probe| probe.a_pad) {
            *padding = (1, 0);
        }
        *bg = probe(|probe| probe.a_bg).map(abi::Color::from);
    }
    let a = match probe(|probe| probe.hide_a) {
        true => text("----"),
        false => a,
    };
    let a = match probe(|probe| probe.a_in_hidden) {
        true => v2::Node::column(vec![a]).with_id("ah").visible(false),
        false => a,
    };
    let a = match probe(|probe| probe.click_a) {
        true => a.on_click(abi::Click::command("input.row", Some("a".into())).on_down()),
        false => a,
    };
    // With pointer events, `b` takes no focus: a capture of it begins and ends with the focus elsewhere.
    let pointer_b = probe(|probe| probe.pointer_b);
    let b = v2::Node::row(vec![text("BBBB")]).with_id("b").interact(interact(!pointer_b, pointer_b, None));
    let b = match probe(|probe| probe.hide_b) {
        true => text("----"),
        false => b,
    };
    v2::Node::column(vec![
        text(&label),
        a,
        b,
        match probe(|probe| probe.hover_t) {
            true => text("TTTT").with_id("t").hover_events(),
            false => text("TTTT").with_id("t"),
        },
    ])
    .with_id("side")
    .interact(interact(true, false, None))
}

/// `node`, a text the mouse cannot select: a double click would select a word, and escape would clear it before any
/// layer.
fn unselectable(mut node: v2::Node) -> v2::Node {
    if let v2::Node::Text { selectable, .. } = &mut node {
        *selectable = false;
    }
    node
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
    let mut deps = Deps {
        builtins: vec![abi::Plugin { id: ID, setup }.into(), abi::Plugin { id: "test.other", setup: other }.into()],
        ..support::deps(Arc::new(support::Fake::new(|seen| support::base(seen, support::DIRECTORY))))
    };
    if probe(|probe| probe.manual_copy) {
        let copy = serde_json::json!({ "terminal": { "copy": "manual" } });
        deps.config = support::config(opencode_local::cli_config::merge(&[Some(copy)]));
    }
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
    // A panel beside a session that does not show opens nowhere.
    run(&harness, "input.elsewhere", None);
    assert!(!harness.app.text().contains("PANEL"), "{}", harness.app.text());
    run(&harness, "input.panel", None);
    let screen = harness.app.text();
    assert!(screen.contains("PANEL full=false focused=true"), "{screen}");
    let shown = interact::ledger(&*harness.tui);
    assert_eq!(shown.layers, before.layers + 4, "the panel's four layers: {shown:?}");
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
    // The chord reached the composer's own handler of it, in the base mode, which cleared it (carbon-1).
    assert_eq!(composer(&harness), "e");
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

// Expected (synchronous geometry reads): a call reads where a node of the plugin's mount is, as the last settled frame
// laid it out, and which of its nodes has the focus.
#[test]
fn a_call_reads_the_geometry_and_the_focus_of_its_mount() {
    let harness = open();
    run(&harness, "input.where", None);
    assert_eq!(taken(), ["where None Focused { node: None, surface: false }"]);
    run(&harness, "input.panel", None);
    let (x, y) = support::at(&harness.app.text(), "AAAA").unwrap();
    run(&harness, "input.focus", Some("a"));
    run(&harness, "input.where", None);
    let rect = input::Rect { x: i32::from(x), y: i32::from(y), width: 0, height: 1 };
    let [line] = taken().try_into().unwrap();
    let expected = format!("Rect {{ x: {}, y: {}, width: ", rect.x, rect.y);
    assert!(line.starts_with(&format!("where Some({expected}")), "{line}");
    assert!(line.ends_with("height: 1 }) Focused { node: Some(\"a\"), surface: true }"), "{line}");
}

// Expected (paste): a paste in a panel goes to its surface's layer that declares pastes.
#[test]
fn a_paste_in_a_panel_goes_to_its_paste_layer() {
    let harness = open();
    run(&harness, "input.panel", None);
    taken();
    harness.app.paste("zz");
    settle(&harness);
    assert_eq!(taken(), ["side: paste zz [-]"]);
}

// Expected (TS `dialog.select`'s `search`): a select that names the plugin's search lists the rows it returns, in its
// order and flat, for the query as it is typed and for the empty one as it opens; the search gets the enabled rows.
#[test]
fn a_rich_select_lists_the_rows_of_the_plugins_search() {
    let harness = open_with(|probe| probe.search = true);
    rows(&["alpha", "off", "beta", "gamma"], "f");
    run(&harness, "input.select", None);
    let screen = harness.app.text();
    let at = |row: &str| support::at(&screen, row).map(|(_, y)| y);
    assert!(at("row gamma") < at("row beta") && at("row beta") < at("row alpha"), "{screen}");
    harness.app.type_text("et");
    settle(&harness);
    let screen = harness.app.text();
    assert!(screen.contains("row beta") && !screen.contains("row alpha") && !screen.contains("row gamma"), "{screen}");
    harness.app.press("enter");
    settle(&harness);
    let log = taken();
    assert_eq!(log.first().map(String::as_str), Some("search \"\" 3"), "{log:?}");
    assert!(log.contains(&"search \"et\" 3".to_owned()), "{log:?}");
    assert_eq!(log.last().map(String::as_str), Some("row beta"), "{log:?}");
}

// Expected (capture, synthesis 4.4): a resize ends the capture, here one that squeezes the captured node off the
// screen: the drags after it reach no plugin, also once the node shows again.
#[test]
fn a_resize_that_removes_the_captured_node_ends_the_capture() {
    let harness = open();
    run(&harness, "input.panel", None);
    let (x, y) = support::at(&harness.app.text(), "AAAA").unwrap();
    taken();
    harness.app.mouse(MouseEventKind::Down(MouseButton::Left), x + 1, y);
    settle(&harness);
    assert!(interact::ledger(&*harness.tui).capture);
    harness.app.resize(120, 3);
    settle(&harness);
    assert!(!harness.app.text().contains("AAAA"), "{}", harness.app.text());
    harness.app.mouse(MouseEventKind::Drag(MouseButton::Left), 0, 0);
    settle(&harness);
    harness.app.resize(120, 30);
    settle(&harness);
    harness.app.mouse(MouseEventKind::Drag(MouseButton::Left), x + 2, y);
    settle(&harness);
    assert!(!interact::ledger(&*harness.tui).capture);
    let log: Vec<String> = taken().into_iter().filter(|line| !line.contains("hover")).collect();
    assert_eq!(log, ["side: Down a 1,0 [-]"]);
}

// Expected (hover on text, TS `onMouseOver` and `onMouseOut` on a `text`): a text with an id and hover events tells
// its mount when the pointer enters and leaves it, also one that gains them in place.
#[test]
fn a_text_with_hover_events_tells_the_pointer_entering_and_leaving() {
    let harness = open();
    run(&harness, "input.panel", None);
    let (x, y) = support::at(&harness.app.text(), "TTTT").unwrap();
    let pass = || {
        taken();
        harness.app.hover(x + 1, y);
        settle(&harness);
        harness.app.hover(0, 0);
        settle(&harness);
        taken().into_iter().filter(|line| line.contains("hover t")).collect::<Vec<String>>()
    };
    assert_eq!(pass(), Vec::<String>::new());
    probe(|probe| probe.hover_t = true);
    run(&harness, "input.redraw", None);
    assert_eq!(pass(), ["side: hover t true [-]", "side: hover t false [-]"]);
}

// Expected (an overlay anchored to another surface, synthesis 4.2): it shows inside that surface of the plugin,
// against the edge it names; anchored to one that does not show, it does not open.
#[test]
fn an_overlay_anchored_to_a_surface_shows_against_its_edge() {
    let harness = open_with(|probe| probe.strip = true);
    run(&harness, "input.beside", None);
    assert!(!harness.app.text().contains("MENU"), "{}", harness.app.text());
    run(&harness, "input.panel", None);
    run(&harness, "input.beside", None);
    let screen = harness.app.text();
    let (panel, top) = support::at(&screen, "PANEL").unwrap();
    let (x, y) = support::at(&screen, "MENU one").unwrap();
    assert_eq!(x, panel, "{screen}");
    assert!(y > top, "{screen}");
}

// Expected (a global layer's paste): it hears a paste in the composer before the composer does, and one that lands
// where no widget takes it; a host widget that takes a paste keeps it (TS offers every paste to a global listener
// first).
#[test]
fn a_global_paste_layer_hears_a_paste_no_host_widget_takes() {
    let harness = open_with(|probe| probe.paste_global = true);
    taken();
    harness.app.paste("c1");
    settle(&harness);
    assert_eq!(taken(), ["pasted: paste c1 [-]"]);
    assert_eq!(composer(&harness), "");
    harness.app.app().blur();
    harness.app.paste("e1");
    settle(&harness);
    assert_eq!(taken(), ["pasted: paste e1 [-]"]);
    // Passed in a surface whose layers take no paste, it is not offered again where it lands.
    opencode_plugin::Host::focus_composer(&*harness.tui);
    run(&harness, "input.panel", None);
    harness.app.press("o");
    settle(&harness);
    taken();
    harness.app.paste("pass1");
    settle(&harness);
    assert_eq!(taken(), ["pasted: paste pass1 [-]"]);
    harness.app.press("escape");
    run(&harness, "input.close", None);
    taken();
    rows(&["alpha"], "f");
    run(&harness, "input.select", None);
    harness.app.paste("d1");
    settle(&harness);
    assert_eq!(taken(), Vec::<String>::new());
    assert!(harness.app.text().contains("d1"), "{}", harness.app.text());
}

// Expected (drag and drop between mounts): a drag from a node of one mount of the plugin dropped on a node of another
// reaches the second with where it started; a drag from a host widget or another plugin's node drops nothing.
#[test]
fn a_drop_from_another_mount_of_the_plugin_says_where_it_started() {
    let harness = open_with(|probe| probe.strip = true);
    run(&harness, "input.panel", None);
    let screen = harness.app.text();
    let (x, y) = support::at(&screen, "AAAA").unwrap();
    let (sx, sy) = support::at(&screen, "STRIP").unwrap();
    let (ox, oy) = support::at(&screen, "OTHER ON").unwrap();
    let (tx, ty) = support::at(&screen, "OTHER TAG").unwrap();
    taken();
    harness.app.mouse(MouseEventKind::Down(MouseButton::Left), x + 1, y);
    harness.app.mouse(MouseEventKind::Drag(MouseButton::Left), sx + 1, sy);
    harness.app.mouse(MouseEventKind::Up(MouseButton::Left), sx + 1, sy);
    settle(&harness);
    harness.app.mouse(MouseEventKind::Down(MouseButton::Left), ox + 1, oy);
    harness.app.mouse(MouseEventKind::Drag(MouseButton::Left), sx + 2, sy);
    harness.app.mouse(MouseEventKind::Up(MouseButton::Left), sx + 2, sy);
    settle(&harness);
    harness.app.mouse(MouseEventKind::Down(MouseButton::Left), tx + 1, ty);
    harness.app.mouse(MouseEventKind::Drag(MouseButton::Left), sx + 3, sy);
    harness.app.mouse(MouseEventKind::Up(MouseButton::Left), sx + 3, sy);
    settle(&harness);
    let log: Vec<String> = taken().into_iter().filter(|line| line.starts_with("strip")).collect();
    assert_eq!(log, ["strip: Drop s 1,0 from side/a [-]"]);
}

/// Where the composer is on the screen.
fn composer_at(harness: &Harness) -> (u16, u16) {
    let rect = harness.tui.textarea.borrow().as_ref().map(opentui::prelude::Widget::rect).unwrap();
    (rect.screen_x as u16 + 1, rect.screen_y as u16)
}

// Expected (review 1, synthesis 3.6): a row that toggles a plugin does so only on a key or a click: a run of the
// select's submit by name changes nothing, and neither does an Enter whose select is closed or replaced by what runs
// before its toggle (a task queued before the key).
#[test]
fn a_toggle_row_moves_the_registry_only_on_a_key_or_a_click() {
    let harness = open();
    rows(&["other"], "f");
    run(&harness, "input.select", None);
    run(&harness, "input.submit", None);
    assert!(active(&harness, "test.other"), "a submit by name toggled the plugin");
    // P6b: the host's toggle action, run by name as a plugin's `dispatch` runs it.
    harness.tui.keymap.dispatch("plugins.toggle", None);
    settle(&harness);
    assert!(active(&harness, "test.other"), "the toggle action by name toggled the plugin");
    let tui = harness.tui.clone();
    harness.app.app().defer(move |_| tui.dialogs.clear());
    harness.app.press("enter");
    settle(&harness);
    assert!(active(&harness, "test.other"), "a toggle ran after its select closed");
    run(&harness, "input.select", None);
    // A host dialog that opens at once: the plugin manager's waits for its command to return, as any plugin's does.
    let tui = harness.tui.clone();
    harness.app.app().defer(move |_| {
        tui.keymap.dispatch("opencode.status", None);
    });
    harness.app.press("enter");
    settle(&harness);
    assert!(harness.app.text().contains("Status"), "{}", harness.app.text());
    assert!(active(&harness, "test.other"), "a toggle ran after its select was replaced");
    harness.app.press("escape");
    settle(&harness);
    run(&harness, "input.select", None);
    let (x, y) = support::at(&harness.app.text(), "row other").unwrap();
    harness.app.click(x + 1, y);
    settle(&harness);
    assert!(!active(&harness, "test.other"), "a click did not toggle the plugin");
}

// Expected (review 7): a select shown again under its key with other footer actions or keys has those, and keeps its
// filter and selection; after a toggle the row says what the registry holds at once, and the hint names the plugin.
#[test]
fn a_keyed_select_takes_new_actions_and_its_rows_follow_a_toggle() {
    let harness = open();
    rows(&["alpha", "beta", "gamma"], "f");
    run(&harness, "input.select", None);
    harness.app.type_text("gam");
    settle(&harness);
    probe(|probe| probe.no_update = true);
    run(&harness, "input.reselect", None);
    let screen = harness.app.text();
    assert!(screen.contains("row gamma") && !screen.contains("row alpha"), "{screen}");
    taken();
    harness.app.press("ctrl+u");
    settle(&harness);
    assert_eq!(taken(), Vec::<String>::new());
    harness.app.press("escape");
    settle(&harness);
    probe(|probe| probe.no_update = false);
    rows(&["other"], "f");
    run(&harness, "input.select", None);
    assert!(harness.app.text().contains("disable test.other"), "{}", harness.app.text());
    harness.app.press("enter");
    settle(&harness);
    let screen = harness.app.text();
    assert!(!active(&harness, "test.other"));
    assert!(screen.contains("disabled") && screen.contains("enable test.other"), "{screen}");
}

// Expected (review 2): what follows a hold key waits behind it in order, a paste included; input meant for a focus that
// a press or a command moved reaches nothing; a hold key routed again holds what follows it.
#[test]
fn a_hold_keeps_the_input_after_it_in_order_and_for_its_focus() {
    let harness = open_with(|probe| probe.hold = true);
    run(&harness, "input.panel", None);
    taken();
    harness.app.press("x");
    harness.app.press("m");
    harness.app.paste("P");
    harness.app.advance(input::HOLD + Duration::from_millis(1));
    settle(&harness);
    assert_eq!(taken(), ["side: key x [-]", "side: key mode [-]"], "a paste overtook a held key");
    // A panel mounted again, in no mode: a press on the composer moves the focus, and the held `m` was the panel's.
    run(&harness, "input.close", None);
    run(&harness, "input.panel", None);
    let (cx, cy) = composer_at(&harness);
    taken();
    harness.app.press("x");
    harness.app.press("m");
    harness.app.click(cx, cy);
    harness.app.advance(input::HOLD + Duration::from_millis(1));
    settle(&harness);
    assert_eq!(taken(), ["side: key x [-]"]);
    assert_eq!(composer(&harness), "");
    assert!(opencode_plugin::Host::composer_focused(&*harness.tui));
    // A command moves the focus away: the held `m` was the panel's, and reaches nothing.
    run(&harness, "input.close", None);
    run(&harness, "input.panel", None);
    taken();
    harness.app.press("x");
    harness.app.press("m");
    opencode_plugin::Host::focus_composer(&*harness.tui);
    harness.app.advance(input::HOLD + Duration::from_millis(1));
    settle(&harness);
    assert_eq!(taken(), ["side: key x [-]"]);
    assert_eq!(composer(&harness), "");
    // A held hold key holds what follows it when it is routed again.
    run(&harness, "input.close", None);
    run(&harness, "input.panel", None);
    taken();
    harness.app.press("x");
    harness.app.press("x");
    harness.app.press("m");
    harness.app.advance(input::HOLD + Duration::from_millis(1));
    settle(&harness);
    assert_eq!(taken(), ["side: key x [-]", "side: key x [-]"]);
    let ledger = interact::ledger(&*harness.tui);
    assert!(ledger.holding && ledger.held == 1, "{ledger:?}");
}

// Expected (review 3): a hold ends only by its own owner, its own timer or its limit: an earlier hold's timer and
// another plugin's release leave it, and a large read is routed in order with no more than the limit kept.
#[test]
fn a_hold_ends_by_its_own_owner_timer_or_limit() {
    let harness = open_with(|probe| {
        probe.hold = true;
        probe.listen = true;
    });
    run(&harness, "input.panel", None);
    taken();
    harness.app.press("x");
    harness.app.advance(Duration::from_millis(10));
    run(&harness, "input.release", None);
    harness.app.press("x");
    harness.app.press("m");
    run(&harness, "other.release", None);
    // Past the first hold's time, inside the second's.
    harness.app.advance(input::HOLD - Duration::from_millis(5));
    let ledger = interact::ledger(&*harness.tui);
    assert!(ledger.holding && ledger.held == 1 && ledger.timers == 1, "{ledger:?}");
    harness.app.advance(Duration::from_millis(20));
    settle(&harness);
    assert!(taken().contains(&"side: key mode [-]".to_owned()));
    // Mounted again, in no mode.
    run(&harness, "input.close", None);
    run(&harness, "input.panel", None);
    taken();
    // A read of many keys after a hold key, with no timer between them.
    let keys: Vec<Input> = std::iter::once(key(KeyCode::Char('x')))
        .chain(std::iter::repeat_n(key(KeyCode::Char('q')), interact::HOLD_LIMIT + 44))
        .collect();
    for event in &keys {
        harness.app.app().dispatch(event.clone());
        assert!(interact::ledger(&*harness.tui).held < interact::HOLD_LIMIT);
    }
    settle(&harness);
    let log = taken();
    assert_eq!(log.len(), 2 + interact::HOLD_LIMIT + 44, "{log:?}");
    assert!(log[2..].iter().all(|line| line == "global: any q [-]"), "{log:?}");
    assert!(!interact::ledger(&*harness.tui).holding);
}

// Expected (review 4, synthesis 3.8): the reserved chord is never held, however it is spelled no plugin key takes it,
// it resets the plugins' input before the host's selection may stop it, and the next key reaches the host past a
// listener that takes every key.
#[test]
fn the_reserved_chord_escapes_every_plugin_hold_spelling_and_listener() {
    let harness = open_with(|probe| {
        probe.hold = true;
        probe.selectable = true;
        probe.manual_copy = true;
    });
    run(&harness, "input.panel", None);
    taken();
    harness.app.press("x");
    harness.app.press("ctrl+c");
    let ledger = interact::ledger(&*harness.tui);
    assert!(!ledger.holding && ledger.held == 0 && ledger.timers == 0, "{ledger:?}");
    assert_eq!(taken(), ["side: key x [-]"], "a plugin key took the reserved chord");
    // The plugin's layers hold again once the focus moves. A mode, then a selection that copies on the chord: the mode
    // still ends.
    run(&harness, "input.focus", Some("a"));
    let base = interact::ledger(&*harness.tui).modes;
    harness.app.press("m");
    settle(&harness);
    assert_eq!(interact::ledger(&*harness.tui).modes, base + 1);
    let (x, y) = support::at(&harness.app.text(), "PANEL").unwrap();
    harness.app.click(x + 1, y);
    harness.app.click(x + 1, y);
    settle(&harness);
    assert!(harness.app.app().selected_text().is_some());
    harness.app.press("ctrl+c");
    settle(&harness);
    harness.app.press("j");
    settle(&harness);
    assert!(!taken().iter().any(|line| line.contains("down")), "the mode outlived the chord");
    // A listener that takes every key: after the chord the composer types again.
    opencode_plugin::Host::focus_composer(&*harness.tui);
    settle(&harness);
    probe(|probe| probe.swallow = true);
    harness.app.type_text("a");
    settle(&harness);
    harness.app.press("ctrl+c");
    harness.app.type_text("b");
    settle(&harness);
    assert_eq!(composer(&harness), "b");
    // The select's key and footer action spelled `Ctrl+C` and `Ctrl + C` are none of it.
    rows(&["alpha"], "f");
    run(&harness, "input.select", None);
    taken();
    harness.app.press("ctrl+c");
    settle(&harness);
    assert!(!taken().iter().any(|line| line.starts_with("picked")));
}

// Expected (review 5): a host dialog keeps its input over a plugin's mode, focus and overlay; a route's layer does not
// take keys from an overlay; an overlay in a mode with no escape of its own still closes on escape; closing the upper
// of two plugins' overlays gives the focus to the other.
#[test]
fn a_host_dialog_and_the_top_overlay_keep_their_input() {
    let harness = open();
    run(&harness, "input.panel", None);
    rows(&["alpha"], "f");
    run(&harness, "input.select", None);
    run(&harness, "other.gmode", None);
    run(&harness, "input.focus", Some("a"));
    run(&harness, "input.overlay", None);
    taken();
    harness.app.type_text("z");
    settle(&harness);
    let screen = harness.app.text();
    assert!(!screen.contains("MENU"), "{screen}");
    assert!(taken().is_empty(), "a plugin took a key of the host's dialog");
    assert!(screen.contains("No results") || screen.contains('z'), "{screen}");
    harness.app.press("escape");
    settle(&harness);
    run(&harness, "other.gmode", None);
    // Under the route's overlay, `k` is the overlay's.
    let harness = open();
    run(&harness, "input.route", None);
    assert!(harness.app.text().contains("ROUTE"), "{}", harness.app.text());
    run(&harness, "input.overlay", None);
    taken();
    harness.app.press("k");
    settle(&harness);
    assert_eq!(taken(), ["menu: key k [-]"]);
    // In the overlay's mode, escape still closes it.
    harness.app.press("n");
    settle(&harness);
    harness.app.press("escape");
    settle(&harness);
    assert!(!harness.app.text().contains("MENU"), "{}", harness.app.text());
    // Two plugins' overlays: closing the upper focuses the other.
    let harness = open();
    run(&harness, "input.overlay", None);
    run(&harness, "other.pop", None);
    assert!(harness.app.text().contains("POP"));
    harness.app.press("escape");
    settle(&harness);
    taken();
    harness.app.press("k");
    settle(&harness);
    assert_eq!(taken(), ["menu: key k [-]"]);
}

// Expected (review 8): a capture ends with a move of the focus even when the focus comes back before the drag, and a
// mode ends with a move out of its scope even when one call moves the focus out and back.
#[test]
fn a_capture_and_a_mode_end_with_a_move_out_and_back() {
    let harness = open();
    run(&harness, "input.panel", None);
    let (x, y) = support::at(&harness.app.text(), "AAAA").unwrap();
    harness.app.mouse(MouseEventKind::Down(MouseButton::Left), x + 1, y);
    settle(&harness);
    harness.app.press("y");
    settle(&harness);
    run(&harness, "input.focus", Some("a"));
    taken();
    harness.app.mouse(MouseEventKind::Drag(MouseButton::Left), x + 2, y);
    settle(&harness);
    assert!(!taken().iter().any(|line| line.contains("Drag")), "a capture came back with the focus");
    harness.app.mouse(MouseEventKind::Up(MouseButton::Left), x + 2, y);
    // Moved by the host's own focus keys, out and back.
    harness.app.mouse(MouseEventKind::Down(MouseButton::Left), x + 1, y);
    settle(&harness);
    harness.app.app().focus_next();
    harness.app.app().focus_previous();
    settle(&harness);
    taken();
    harness.app.mouse(MouseEventKind::Drag(MouseButton::Left), x + 2, y);
    settle(&harness);
    assert!(!taken().iter().any(|line| line.contains("Drag")), "a capture came back with the focus");
    harness.app.mouse(MouseEventKind::Up(MouseButton::Left), x + 2, y);
    harness.app.press("m");
    settle(&harness);
    run(&harness, "input.bounce", None);
    taken();
    harness.app.press("j");
    settle(&harness);
    assert!(!taken().iter().any(|line| line.contains("down")), "a mode came back with the focus");
}

// Expected (review 9): a paste goes to the listeners by priority, as a key does, and a paste in a route or a slot
// claim goes to its paste layer.
#[test]
fn a_paste_goes_by_priority_and_to_a_route_or_slot() {
    let harness = open_with(|probe| {
        probe.paste_rank = true;
        probe.strip = true;
        probe.paste_global = true;
    });
    taken();
    harness.app.paste("p1");
    settle(&harness);
    assert_eq!(taken(), ["high: paste p1 [-]"]);
    run(&harness, "input.focus", Some("s"));
    harness.app.paste("p2");
    settle(&harness);
    assert_eq!(taken(), ["strip: paste p2 [-]"]);
    run(&harness, "input.route", None);
    run(&harness, "input.focus", Some("r"));
    harness.app.paste("p3");
    settle(&harness);
    assert_eq!(taken(), ["route: paste p3 [-]"]);
    // Passed by the route and the global layer, it is not offered again where it lands.
    harness.app.paste("pass3");
    settle(&harness);
    assert_eq!(taken(), ["route: paste pass3 [-]", "pasted: paste pass3 [-]"]);
}

// Expected (review 8): the composer's mode ends as the composer goes with its route; back on the session, the
// composer types again.
#[test]
fn a_composer_mode_ends_with_its_route() {
    let harness = open();
    let base = interact::ledger(&*harness.tui).modes;
    harness.app.press("escape");
    settle(&harness);
    assert_eq!(interact::ledger(&*harness.tui).modes, base + 1);
    run(&harness, "input.route", None);
    harness.tui.navigate(opencode_tui::Route::Session { id: opencode_api::generated::SessionID("ses_a".into()) });
    settle(&harness);
    assert_eq!(interact::ledger(&*harness.tui).modes, base);
    harness.app.type_text("d");
    settle(&harness);
    assert_eq!(composer(&harness), "d");
}

// Expected (review 10): on a box with a click of its own and pointer events, a press the plugin consumes runs no
// click, and one it passes does.
#[test]
fn a_consumed_press_runs_no_click_of_the_same_box() {
    let harness = open_with(|probe| probe.click_a = true);
    run(&harness, "input.panel", None);
    let (x, y) = support::at(&harness.app.text(), "AAAA").unwrap();
    taken();
    harness.app.click(x + 1, y);
    settle(&harness);
    assert!(!taken().contains(&"row a".to_owned()), "a consumed press ran the click");
    probe(|probe| probe.pass_press = true);
    harness.app.click(x + 1, y);
    settle(&harness);
    assert!(taken().contains(&"row a".to_owned()), "a passed press ran no click");
}

// Expected (review 11): in a route, a handler's and a command's reads of the focus agree with the focused node.
#[test]
fn a_route_reads_its_focused_node() {
    let harness = open();
    run(&harness, "input.route", None);
    run(&harness, "input.focus", Some("r"));
    taken();
    harness.app.press("w");
    settle(&harness);
    assert_eq!(taken(), ["route: key where [-]", "where true Focused { node: Some(\"r\"), surface: true }"]);
    run(&harness, "input.where", Some("r"));
    let [line] = taken().try_into().unwrap();
    assert!(line.ends_with("Focused { node: Some(\"r\"), surface: true }"), "{line}");
}

// Expected (review 8 and 12): a capture of a node that takes no focus ends as the node leaves the tree the host
// accepts, with no pointer event and no read to end it; reading the ledger changes nothing.
#[test]
fn a_capture_ends_as_its_node_leaves_the_tree() {
    let harness = open_with(|probe| probe.pointer_b = true);
    run(&harness, "input.panel", None);
    let (x, y) = support::at(&harness.app.text(), "BBBB").unwrap();
    harness.app.mouse(MouseEventKind::Down(MouseButton::Left), x + 1, y);
    settle(&harness);
    assert!(interact::ledger(&*harness.tui).capture);
    probe(|probe| probe.hide_b = true);
    run(&harness, "input.redraw", None);
    assert!(!harness.app.text().contains("BBBB"));
    assert!(!interact::ledger(&*harness.tui).capture);
    assert_eq!(interact::ledger(&*harness.tui), interact::ledger(&*harness.tui));
}

// Expected (review 6): a panel that closes with the focus gives it to the composer, which types what comes next.
#[test]
fn a_closed_panel_gives_its_focus_to_the_composer() {
    let harness = open();
    run(&harness, "input.panel", None);
    run(&harness, "input.close", None);
    harness.app.type_text("q");
    settle(&harness);
    assert_eq!(composer(&harness), "q");
}

/// The registries of the same TUI with only the other test plugin.
fn without() -> interact::Ledger {
    let deps = Deps {
        builtins: vec![abi::Plugin { id: "test.other", setup: other }.into()],
        ..support::deps(Arc::new(support::Fake::new(|seen| support::base(seen, support::DIRECTORY))))
    };
    interact::ledger(&*support::mount(120, 30, deps).tui)
}

/// The test plugin's failure, if it failed.
fn failure(harness: &Harness) -> Option<String> {
    harness.tui.plugins.entries().into_iter().find(|entry| entry.id == ID).and_then(|entry| match entry.status {
        opencode_plugin::Status::Failed(error) => Some(error),
        _ => None,
    })
}

// Expected (P4c's containment of a handler): a handler is a plugin call, timed and contained; one that panics fails
// its plugin, and what the plugin held of the input goes by the owners' end: its layers, listeners and modes, a
// capture, a hold with a key behind it and its timer, an overlay. The focus goes to the composer, the held key reaches
// nothing, and the host goes on.
#[test]
fn a_panicking_handler_fails_its_plugin_and_leaves_no_input() {
    let twin = without();
    // A pointer handler, with a capture and a hold holding a key.
    let harness = open_with(|probe| probe.hold = true);
    run(&harness, "input.panel", None);
    let (x, y) = support::at(&harness.app.text(), "AAAA").unwrap();
    harness.app.mouse(MouseEventKind::Down(MouseButton::Left), x + 1, y);
    harness.app.press("x");
    harness.app.press("q");
    let armed = interact::ledger(&*harness.tui);
    assert!(armed.capture && armed.holding && armed.held == 1 && armed.timers == 1, "{armed:?}");
    probe(|probe| probe.panic = true);
    harness.app.mouse(MouseEventKind::Drag(MouseButton::Left), x + 2, y);
    probe(|probe| probe.panic = false);
    settle(&harness);
    harness.app.advance(input::HOLD * 2);
    settle(&harness);
    let error = failure(&harness).expect("the plugin failed");
    assert!(error.contains("handle panicked"), "{error}");
    assert_eq!(interact::ledger(&*harness.tui), twin);
    assert!(opencode_plugin::Host::composer_focused(&*harness.tui));
    harness.app.type_text("z");
    settle(&harness);
    assert_eq!(composer(&harness), "z", "the held key reached the composer, or the host stopped");
    // An overlay's handler, in the overlay's mode.
    let harness = open();
    run(&harness, "input.overlay", None);
    harness.app.press("n");
    settle(&harness);
    let armed = interact::ledger(&*harness.tui);
    assert!(armed.overlays > 0 && armed.modes > twin.modes, "{armed:?}");
    probe(|probe| probe.panic = true);
    harness.app.press("k");
    probe(|probe| probe.panic = false);
    settle(&harness);
    assert!(failure(&harness).is_some_and(|error| error.contains("handle panicked")));
    assert_eq!(interact::ledger(&*harness.tui), twin);
    assert!(!harness.app.text().contains("MENU"));
    assert!(opencode_plugin::Host::composer_focused(&*harness.tui));
}

// Expected (carbon-1): binds that hold the reserved chord in a list (`a,ctrl+c`), a sequence (`ctrl+c x`) or another
// spelling (`Control + C`) never take it, and no key after it is swallowed as the rest of a sequence.
#[test]
fn no_spelling_list_or_sequence_takes_the_reserved_chord() {
    let harness = open();
    run(&harness, "input.panel", None);
    run(&harness, "input.focus", Some("a"));
    taken();
    harness.app.press("ctrl+c");
    settle(&harness);
    run(&harness, "input.focus", Some("side"));
    harness.app.press("x");
    settle(&harness);
    assert_eq!(taken(), ["side: key x [-]"]);
}

// Expected (carbon-2): a mode the panel sets holds in the panel although the panel also has a layer of the composer;
// another plugin's global layer takes no escape or key from an overlay with the focus.
#[test]
fn a_mode_holds_where_it_was_set_and_an_overlay_keeps_its_keys() {
    let harness = open();
    run(&harness, "input.panel", None);
    harness.app.press("m");
    harness.app.press("j");
    settle(&harness);
    assert_eq!(taken(), ["side: key mode [-]", "side: key down [menu]"]);
    let harness = open_with(|probe| probe.other_escape = true);
    run(&harness, "input.overlay", None);
    run(&harness, "other.gmode", None);
    taken();
    harness.app.press("k");
    harness.app.press("escape");
    settle(&harness);
    assert_eq!(taken(), ["menu: key k [-]"]);
    assert!(!harness.app.text().contains("MENU"), "{}", harness.app.text());
}

// Expected (carbon-3): a focused node that the new tree builds again keeps the focus; one the tree leaves out gives it
// to the panel, whose layers hold.
#[test]
fn a_focus_the_new_tree_takes_away_comes_back() {
    let harness = open();
    run(&harness, "input.panel", None);
    run(&harness, "input.focus", Some("a"));
    probe(|probe| probe.a_pad = true);
    run(&harness, "input.redraw", None);
    taken();
    harness.app.press("y");
    settle(&harness);
    assert_eq!(taken(), ["side: key y [-]"], "the rebuilt node lost the focus");
    probe(|probe| probe.hide_b = true);
    run(&harness, "input.redraw", None);
    taken();
    harness.app.press("x");
    settle(&harness);
    assert_eq!(taken(), ["side: key x [-]"], "the panel lost the focus with its node");
}

// Expected (review carbon-5): a focused node that the new tree puts in a hidden box can take no focus, so the focus
// goes to the panel, as for a node left out.
#[test]
fn a_focus_the_new_tree_hides_goes_to_the_panel() {
    let harness = open();
    run(&harness, "input.panel", None);
    run(&harness, "input.focus", Some("a"));
    probe(|probe| probe.a_in_hidden = true);
    run(&harness, "input.redraw", None);
    taken();
    harness.app.press("x");
    settle(&harness);
    assert_eq!(taken(), ["side: key x [-]"], "the panel lost the focus to a hidden node");
    assert!(!harness.app.text().contains("AAAA"), "{}", harness.app.text());
}

// Expected (carbon-5): a press a node takes starts no selection of selectable text under it, so its drag goes on
// outside it and its drop lands; a release under a host dialog is not the plugin's; a handler that gives the focus
// away on the press keeps its capture; a press on a node that takes no focus focuses the panel.
#[test]
fn a_taken_press_owns_its_gesture() {
    let harness = open_with(|probe| {
        probe.selectable = true;
        probe.strip = true;
    });
    run(&harness, "input.panel", None);
    let screen = harness.app.text();
    let (x, y) = support::at(&screen, "AAAA").unwrap();
    let (sx, sy) = support::at(&screen, "STRIP").unwrap();
    taken();
    harness.app.mouse(MouseEventKind::Down(MouseButton::Left), x + 1, y);
    harness.app.mouse(MouseEventKind::Drag(MouseButton::Left), x + 1, y + 3);
    harness.app.mouse(MouseEventKind::Drag(MouseButton::Left), sx + 1, sy);
    harness.app.mouse(MouseEventKind::Up(MouseButton::Left), sx + 1, sy);
    settle(&harness);
    let log = taken();
    assert!(log.iter().any(|line| line.starts_with("side: Drag a")), "{log:?}");
    assert!(log.contains(&"strip: Drop s 1,0 from side/a [-]".to_owned()), "{log:?}");
    assert!(harness.app.app().selected_text().is_none());
    // A host dialog over the capture.
    harness.app.mouse(MouseEventKind::Down(MouseButton::Left), x + 1, y);
    settle(&harness);
    rows(&["alpha"], "f");
    run(&harness, "input.select", None);
    taken();
    harness.app.mouse(MouseEventKind::Up(MouseButton::Left), x + 1, y);
    settle(&harness);
    assert!(!taken().iter().any(|line| line.contains("Up a")), "a release under a dialog reached the plugin");
    // A drag the plugin took, dropped on its strip once a host dialog opened.
    harness.app.press("escape");
    settle(&harness);
    harness.app.mouse(MouseEventKind::Down(MouseButton::Left), x + 1, y);
    settle(&harness);
    run(&harness, "input.select", None);
    taken();
    harness.app.mouse(MouseEventKind::Drag(MouseButton::Left), sx + 1, sy);
    harness.app.mouse(MouseEventKind::Up(MouseButton::Left), sx + 1, sy);
    settle(&harness);
    assert!(!taken().iter().any(|line| line.contains("Drop")), "a drop under a dialog reached the plugin");
    // The dialog ended the capture: once it closes, the button still down, a drag is no longer the plugin's.
    harness.app.press("escape");
    settle(&harness);
    taken();
    harness.app.mouse(MouseEventKind::Drag(MouseButton::Left), x + 2, y);
    settle(&harness);
    assert!(!taken().iter().any(|line| line.contains("Drag a")), "a dialog left the capture");
    harness.app.mouse(MouseEventKind::Up(MouseButton::Left), x + 2, y);
    settle(&harness);
    // The focus given away on the press.
    let harness = open_with(|probe| probe.down_focus_b = true);
    run(&harness, "input.panel", None);
    let (x, y) = support::at(&harness.app.text(), "AAAA").unwrap();
    harness.app.mouse(MouseEventKind::Down(MouseButton::Left), x + 1, y);
    settle(&harness);
    taken();
    harness.app.mouse(MouseEventKind::Drag(MouseButton::Left), x + 2, y);
    settle(&harness);
    assert!(taken().iter().any(|line| line.starts_with("side: Drag a")), "the capture ended with its own focus move");
    // A node that takes no focus.
    let harness = open_with(|probe| probe.pointer_b = true);
    run(&harness, "input.panel", None);
    opencode_plugin::Host::focus_composer(&*harness.tui);
    settle(&harness);
    let (x, y) = support::at(&harness.app.text(), "BBBB").unwrap();
    harness.app.click(x + 1, y);
    settle(&harness);
    taken();
    harness.app.press("x");
    settle(&harness);
    assert_eq!(taken(), ["side: key x [-]"], "the press left the focus at the composer");
}

// Expected (carbon-6): a panel's first view sees how it shows and is the only view as it opens; a splitter drag gives
// it every width; a theme switch keeps its mount and restyles an overlay; a handler that fails as it hears its
// overlay replaced leaves no overlay; a panel the plugin does not have opens nothing.
#[test]
fn a_panel_shows_with_one_view_follows_its_room_and_its_theme() {
    let harness = open();
    run(&harness, "input.panel", None);
    let panels = probe(|probe| probe.panels.clone());
    assert_eq!(panels.len(), 1, "{panels:?}");
    assert!(panels[0].0.is_some_and(|panel| panel.focused && panel.width > 0), "{panels:?}");
    // The splitter, dragged left in steps.
    let (left, top) = support::at(&harness.app.text(), "PANEL").unwrap();
    harness.app.mouse(MouseEventKind::Down(MouseButton::Left), left - 1, top + 5);
    for step in 1..=4 {
        harness.app.mouse(MouseEventKind::Drag(MouseButton::Left), left - 1 - step * 3, top + 5);
        settle(&harness);
    }
    harness.app.mouse(MouseEventKind::Up(MouseButton::Left), left - 13, top + 5);
    settle(&harness);
    // Four steps of three cells: the view saw each width, not only the first two.
    let widths: Vec<u16> =
        probe(|probe| probe.panels.iter().filter_map(|(panel, _)| panel.map(|panel| panel.width)).collect());
    assert_eq!(widths.last(), Some(&(widths[0] + 12)), "the view did not follow the drag: {widths:?}");
    // A theme switch.
    let generation = probe(|probe| probe.panels.last().unwrap().1);
    harness.app.press("o");
    settle(&harness);
    let (mx, my) = support::at(&harness.app.text(), "MENU one").unwrap();
    let before = harness.app.render().cell(u32::from(mx), u32::from(my)).unwrap().fg;
    // A switch of the mode keeps the theme's name, which the plugins do not hear of: only the host restyles them.
    assert!(harness.tui.theme.borrow_mut().set_mode(Some(opencode_ui::theme::ThemeMode::Light), false));
    harness.tui.theme_changed();
    settle(&harness);
    assert_eq!(probe(|probe| probe.panels.last().unwrap().1), generation, "the panel mounted again");
    let after = harness.app.render().cell(u32::from(mx), u32::from(my)).unwrap().fg;
    assert_ne!(before, after, "the overlay kept the old theme");
    // A failure on hearing the overlay replaced.
    let twin = without();
    probe(|probe| probe.panic_closed = true);
    run(&harness, "input.overlay", None);
    probe(|probe| probe.panic_closed = false);
    settle(&harness);
    assert!(failure(&harness).is_some());
    assert_eq!(interact::ledger(&*harness.tui), twin);
    // A panel the plugin does not have.
    let harness = open();
    run(&harness, "input.nopanel", None);
    assert!(harness.tui.panels.current().is_none());
}

// Expected (carbon-7): a toggle row of a select with no key toggles; a hidden disabled row of the same value toggles
// nothing; rows naming the caller or the plugin manager show no toggle; a rowless action runs with no row.
#[test]
fn a_select_toggles_only_what_it_shows() {
    let harness = open_with(|probe| probe.keyless = true);
    rows(&["other"], "f");
    run(&harness, "input.select", None);
    harness.app.press("enter");
    settle(&harness);
    assert!(!active(&harness, "test.other"), "a keyless select's toggle did nothing");
    // A keyless select cannot be shown again in place: its rows stay as shown, and the host's hint follows the plugin.
    assert!(harness.app.text().contains("enable test.other"), "{}", harness.app.text());
    harness.app.press("escape");
    settle(&harness);
    run(&harness, "input.select", None);
    harness.app.press("enter");
    settle(&harness);
    assert!(active(&harness, "test.other"));
    let harness = open();
    rows(&["dup"], "f");
    run(&harness, "input.select", None);
    assert!(!harness.app.text().contains("test.other"), "a hidden row's toggle has a hint: {}", harness.app.text());
    taken();
    harness.app.press("enter");
    settle(&harness);
    assert!(active(&harness, "test.other"), "a hidden row toggled a plugin");
    assert_eq!(taken(), ["picked dup"]);
    harness.app.press("escape");
    settle(&harness);
    // A plugin the config names that never loaded: the host would not toggle it either.
    harness.tui.plugins.set_targets(&opencode_tui::plugins::host::host(&harness.tui), ["@acme/skipped"]);
    rows(&["self", "manager", "acme"], "f");
    run(&harness, "input.select", None);
    let screen = harness.app.text();
    assert!(!screen.contains("enabled") && !screen.contains("disable"), "{screen}");
    harness.app.press("down");
    settle(&harness);
    harness.app.press("enter");
    settle(&harness);
    assert!(active(&harness, "opencode.plugins"));
    harness.app.type_text("zzz");
    settle(&harness);
    taken();
    harness.app.press("ctrl+y");
    settle(&harness);
    assert_eq!(taken(), ["picked new"]);
}

// Expected (carbon-8): a chord types nothing, so a modal composer's `i` is not `alt+i`; a bind of several keys tells
// which one ran it; an overlay stays on the screen as it shrinks, and a wheel outside closes it.
#[test]
fn keys_say_what_was_pressed_and_overlays_stay_on_screen() {
    let harness = open();
    let base = interact::ledger(&*harness.tui).modes;
    harness.app.press("escape");
    harness.app.press("alt+i");
    settle(&harness);
    assert_eq!(interact::ledger(&*harness.tui).modes, base + 1, "alt+i left the composer's mode");
    harness.app.press("i");
    settle(&harness);
    assert_eq!(interact::ledger(&*harness.tui).modes, base);
    run(&harness, "input.panel", None);
    taken();
    harness.app.press("v");
    harness.app.press("ctrl+t");
    settle(&harness);
    assert_eq!(taken(), ["side: key v as v [-]", "side: key v as ctrl+t [-]"]);
    run(&harness, "input.edge", None);
    harness.app.resize(40, 8);
    settle(&harness);
    assert!(
        harness.app.text().contains("MENU"),
        "the overlay against the bottom edge left the screen: {}",
        harness.app.text()
    );
    harness.app.resize(120, 30);
    settle(&harness);
    taken();
    harness.app.mouse(MouseEventKind::ScrollDown, 100, 25);
    settle(&harness);
    assert!(!harness.app.text().contains("MENU"), "{}", harness.app.text());
}

// Expected (carbon-9): an overlay the plugin closes goes with no close event; one against the bottom edge shows there.
#[test]
fn an_overlay_closes_on_the_plugins_word_and_shows_against_an_edge() {
    let harness = open();
    run(&harness, "input.panel", None);
    harness.app.press("o");
    settle(&harness);
    taken();
    run(&harness, "input.unmenu", None);
    assert!(!harness.app.text().contains("MENU"));
    assert_eq!(taken(), Vec::<String>::new());
    run(&harness, "input.edge", None);
    // The overlay's blank cells show what is under them, so its line is found by its first word.
    let (_, y) = support::at(&harness.app.text(), "MENU").unwrap();
    assert_eq!(y, 28, "{}", harness.app.text());
}

// Expected (carbon-9): a box's background token, changed in place and switched with the theme, draws as a box mounted
// in that state does.
#[test]
fn a_pointer_box_restyles_in_place() {
    let open = || {
        let harness = Box::new(open_with(|probe| probe.a_bg = Some("background.panel")));
        run(&harness, "input.panel", None);
        probe(|probe| probe.a_bg = Some("background.element"));
        run(&harness, "input.redraw", None);
        harness
    };
    support::assert_restyles_in_place(open, |_| {}, |screen| screen.contains("AAAA"));
}

// Expected (carbon-7): an action on the row is primary unless it says, and a rowless one secondary, as TS's `group`
// defaults: listed first, the row action still shows after the rowless one, with the primary actions.
#[test]
fn a_row_action_is_primary_unless_it_says() {
    let harness = open_with(|probe| probe.launch = true);
    rows(&["alpha"], "f");
    run(&harness, "input.select", None);
    let screen = harness.app.text();
    let at = |word: &str| support::at(&screen, word).map(|(x, y)| (y, x));
    assert!(at("launch") > at("new") && at("new").is_some(), "{screen}");
}

// Expected (carbon-9): a hold whose owner ends goes with it, so a key typed at once after reaches the composer then,
// not at the hold's deadline.
#[test]
fn a_hold_goes_with_its_owner() {
    let harness = open_with(|probe| probe.hold = true);
    run(&harness, "input.panel", None);
    harness.app.press("x");
    settle(&harness);
    assert!(interact::ledger(&*harness.tui).holding, "x started no hold");
    run(&harness, "input.close", None);
    harness.app.type_text("q");
    settle(&harness);
    assert_eq!(composer(&harness), "q");
}
