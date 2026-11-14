//! P2's properties of routing (synthesis 4.14): `delivery`, and `ledger` for layers, modes, capture and overlays, on
//! the test plugin of `plugin_input` in the real TUI.
//!
//! `delivery`: an active plugin gets each key, paste and pointer event it is entitled to once, in the order of the
//! input, and no other; inside a batch, the effects of event n (a mode, a focus) apply before event n + 1 is routed.
//! The oracle is a reference router written here, a pure function of the event list over focus, layers, priorities
//! and modes, which shares no code with the host. It is compared with the plugin's own log, and with the composer's
//! text, which says which keys went on past the plugin.
//!
//! `ledger`: when a mount ends, nothing it owned of the input is left, and when the plugin leaves `active` nothing of
//! it is left and the focus is at the composer. The twin is the same TUI before the plugin registered anything: the
//! counts are read from the registries the host routes by (the keymap's layers and modes, the router's listeners and
//! capture, the overlay layer's widgets).

use crate::plugin_input::{self as plugin, probe};
use crate::support::model::{self, Failure, Model, Rng};
use crate::support::{self, Harness};

use opencode_plugin::interact::{self, Ledger};
use opencode_tui::Tui;
use opentui::input::{Event as Input, KeyCode, KeyEvent, Modifiers, MouseButton, MouseEventKind};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Key {
    X,
    Y,
    M,
    J,
    I,
    D,
    Q,
    Escape,
}

impl Key {
    const ALL: [Key; 8] = [Key::X, Key::Y, Key::M, Key::J, Key::I, Key::D, Key::Q, Key::Escape];

    fn event(self) -> Input {
        let code = match self {
            Key::Escape => KeyCode::Escape,
            key => KeyCode::Char(key.char().unwrap()),
        };
        Input::Key(KeyEvent::new(code, Modifiers::NONE))
    }

    fn char(self) -> Option<char> {
        Some(match self {
            Key::X => 'x',
            Key::Y => 'y',
            Key::M => 'm',
            Key::J => 'j',
            Key::I => 'i',
            Key::D => 'd',
            Key::Q => 'q',
            Key::Escape => return None,
        })
    }

    fn name(self) -> String {
        self.char().map_or_else(|| "escape".to_owned(), String::from)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Focus {
    Composer,
    /// The panel's root.
    Panel,
    A,
    B,
}

#[derive(Clone, Debug)]
enum Command {
    /// Keys in one polled batch: nothing deferred runs between them.
    Keys(Vec<Key>),
    /// The host moves the focus, by the composer's own focus or the plugin's `focus` from a command.
    Focus(Focus),
    /// The plugin's panel opens, or closes and the composer takes the focus.
    Panel(bool),
    /// The `x` binds pass the key on, or take it.
    Pass(bool),
    Paste,
    /// A press and a release on node `a`.
    Click,
}

/// The reference router: what the plugin is entitled to, and what the composer shows.
#[derive(Clone, Debug)]
struct Reference {
    panel: bool,
    focus: Focus,
    /// The composer layer's mode `normal`, and the panel's mode `menu`.
    normal: bool,
    menu: bool,
    pass: bool,
    log: Vec<String>,
    composer: String,
}

impl Reference {
    fn new() -> Self {
        Self {
            panel: false,
            focus: Focus::Composer,
            normal: false,
            menu: false,
            pass: false,
            log: Vec::new(),
            composer: String::new(),
        }
    }

    /// The mode the keymap is in: a mode holds only while the focus is in its scope.
    fn mode(&self) -> &'static str {
        match (self.focus, self.normal, self.menu) {
            (Focus::Composer, true, _) => "normal",
            (Focus::Panel | Focus::A | Focus::B, _, true) => "menu",
            _ => "-",
        }
    }

    /// Moves the focus; a mode whose scope it leaves ends for good.
    fn focus(&mut self, focus: Focus) {
        if focus != Focus::Composer {
            self.normal = false;
        }
        if focus == Focus::Composer {
            self.menu = false;
        }
        self.focus = focus;
    }

    /// Whether the run may send `key` now: escape outside the composer is the host's, which the reference does not
    /// model, so the run leaves it out.
    fn sendable(&self, key: Key) -> bool {
        key != Key::Escape || self.focus == Focus::Composer
    }

    fn key(&mut self, key: Key) {
        let mode = self.mode();
        // The listeners, before every layer: the global one in the base mode, the composer's in normal mode.
        match mode {
            "-" => self.log.push(format!("global: any {} [-]", key.name())),
            "normal" => {
                self.log.push(format!("setup: any {} [normal]", key.name()));
                if key == Key::I {
                    self.normal = false;
                }
                return;
            }
            _ => {}
        }
        // The keymap's layers that hold, by priority.
        let consumed = match (mode, self.focus, key) {
            ("-", Focus::Composer, Key::Escape) => {
                self.log.push("setup: key normal [-]".to_owned());
                self.normal = true;
                true
            }
            ("-", Focus::Panel | Focus::A | Focus::B, Key::X) => {
                self.log.push("side: key x [-]".to_owned());
                !self.pass
            }
            ("-", Focus::Panel | Focus::A | Focus::B, Key::M) => {
                self.log.push("side: key mode [-]".to_owned());
                self.menu = true;
                true
            }
            ("-", Focus::Composer, Key::X) => {
                self.log.push("setup: key cx [-]".to_owned());
                !self.pass
            }
            ("-", Focus::A, Key::Y) => {
                self.log.push("side: key y [-]".to_owned());
                self.focus = Focus::B;
                true
            }
            ("menu", Focus::Panel | Focus::A | Focus::B, Key::J) => {
                self.log.push("side: key down [menu]".to_owned());
                true
            }
            _ => false,
        };
        // Past the plugin, a typed key reaches the composer when it has the focus.
        if !consumed
            && self.focus == Focus::Composer
            && let Some(char) = key.char()
        {
            self.composer.push(char);
        }
    }

    /// A paste goes to the layer of its scope that declares pastes, in its mode, or on to the host.
    fn paste(&mut self) {
        match (self.focus, self.mode()) {
            (Focus::Composer, "normal") => self.log.push("setup: paste P [normal]".to_owned()),
            (Focus::Composer, _) => self.composer.push('P'),
            (_, "-") => self.log.push("side: paste P [-]".to_owned()),
            _ => {}
        }
    }

    /// A press on a focusable node gives it the focus before its handler runs.
    fn click(&mut self) {
        if !self.panel {
            return;
        }
        self.focus(Focus::A);
        let mode = self.mode();
        self.log.push(format!("side: Down a 1,0 [{mode}]"));
        self.log.push(format!("side: Up a 1,0 [{mode}]"));
    }
}

struct Delivery;

impl Model for Delivery {
    type Command = Command;

    fn generate(&self, rng: &mut Rng, steps: usize) -> Vec<Command> {
        (0..steps)
            .map(|_| match rng.below(12) {
                0..=3 => Command::Keys(vec![*rng.pick(&Key::ALL)]),
                4 | 5 => Command::Keys((0..2 + rng.below(4)).map(|_| *rng.pick(&Key::ALL)).collect()),
                6 | 7 => Command::Focus(*rng.pick(&[Focus::Composer, Focus::Panel, Focus::A, Focus::B])),
                8 => Command::Panel(rng.below(3) > 0),
                9 => Command::Pass(rng.below(2) == 0),
                10 => Command::Paste,
                _ => Command::Click,
            })
            .collect()
    }

    fn simplify(&self, command: &Command) -> Vec<Command> {
        match command {
            Command::Keys(keys) if keys.len() > 1 => (0..keys.len())
                .map(|skip| {
                    Command::Keys(keys.iter().enumerate().filter(|(i, _)| *i != skip).map(|(_, k)| *k).collect())
                })
                .collect(),
            _ => Vec::new(),
        }
    }

    fn run(&self, commands: &[Command]) -> Option<Failure> {
        let harness = plugin::open_with(|probe| probe.listen = true);
        let mut reference = Reference::new();
        for (step, command) in commands.iter().enumerate() {
            apply(&harness, &mut reference, command);
            // Hover is the host's with no call, and its events are `plugin_input`'s.
            let log: Vec<String> = plugin::taken().into_iter().filter(|line| !line.contains("hover")).collect();
            let fail = |site, detail: String| Some(Failure { property: "delivery", site, step, detail });
            if !model::skipped("delivery") && log != reference.log {
                return fail("log", format!("{command:?}: the plugin saw {log:?}, the reference {:?}", reference.log));
            }
            reference.log.clear();
            let composer = composer(&harness.tui);
            if !model::skipped("delivery") && composer != reference.composer {
                return fail(
                    "composer",
                    format!("{command:?}: the composer shows {composer:?}, not {:?}", reference.composer),
                );
            }
        }
        None
    }
}

/// Runs `command` on the TUI and on the reference.
fn apply(harness: &Harness, reference: &mut Reference, command: &Command) {
    let tui = &harness.tui;
    match command {
        Command::Keys(keys) => {
            let keys: Vec<Key> = {
                // Each key's sendability depends on the focus before it, which the keys before it may move.
                let mut probe = reference.clone();
                keys.iter()
                    .copied()
                    .filter(|key| {
                        let ok = probe.sendable(*key);
                        if ok {
                            probe.key(*key);
                        }
                        ok
                    })
                    .collect()
            };
            plugin::batch(harness, &keys.iter().map(|key| key.event()).collect::<Vec<_>>());
            keys.iter().for_each(|key| reference.key(*key));
        }
        Command::Focus(Focus::Composer) => {
            opencode_plugin::Host::focus_composer(&**tui);
            plugin::settle(harness);
            reference.focus(Focus::Composer);
        }
        Command::Focus(focus) => {
            if !reference.panel {
                return;
            }
            let node = match focus {
                Focus::Panel => "side",
                Focus::A => "a",
                _ => "b",
            };
            plugin::run(harness, "input.focus", Some(node));
            reference.focus(*focus);
        }
        Command::Panel(true) => {
            plugin::run(harness, "input.panel", None);
            if !reference.panel {
                reference.panel = true;
                reference.focus(Focus::Panel);
            }
        }
        Command::Panel(false) => {
            plugin::run(harness, "input.close", None);
            opencode_plugin::Host::focus_composer(&**tui);
            plugin::settle(harness);
            reference.panel = false;
            reference.focus(Focus::Composer);
        }
        Command::Pass(pass) => {
            probe(|probe| probe.pass_x = *pass);
            reference.pass = *pass;
        }
        Command::Paste => {
            harness.app.paste("P");
            plugin::settle(harness);
            reference.paste();
        }
        Command::Click => {
            if !reference.panel {
                return;
            }
            let Some((x, y)) = support::at(&harness.app.text(), "AAAA") else { return };
            harness.app.mouse(MouseEventKind::Down(MouseButton::Left), x + 1, y);
            harness.app.mouse(MouseEventKind::Up(MouseButton::Left), x + 1, y);
            plugin::settle(harness);
            reference.click();
        }
    }
}

fn composer(tui: &Tui) -> String {
    let mut text = String::new();
    opencode_plugin::Host::read(tui, &mut |read| {
        text = read.composer().map(|composer| composer.text).unwrap_or_default();
    });
    text
}

// Expected (`delivery`, 4.14): along any sequence of keys, bursts, focus moves, panel opens and closes, pastes and
// clicks, the plugin's own log equals the reference router's, and so does the composer's text.
#[test]
fn every_event_reaches_the_plugin_once_in_order() {
    model::check(&Delivery, 24, 24);
}

#[derive(Clone, Copy, Debug)]
enum Life {
    Panel(bool),
    /// A key of the panel: `x`, `m` (its mode), `o` (its overlay); or escape in the composer (the plugin's mode).
    Key(char),
    /// A press on node `a`, which the plugin consumes: the pointer is captured until a release.
    Press,
    Release,
    FocusComposer,
    /// The plugin leaves `active`, or comes back.
    Active(bool),
}

/// The `ledger` model's state of the plugin, as the test drives it.
#[derive(Clone, Copy, Debug)]
struct Shown {
    active: bool,
    panel: bool,
}

struct Ledgers;

impl Model for Ledgers {
    type Command = Life;

    fn generate(&self, rng: &mut Rng, steps: usize) -> Vec<Life> {
        (0..steps)
            .map(|_| match rng.below(10) {
                0 | 1 => Life::Panel(rng.below(3) > 0),
                2..=4 => Life::Key(*rng.pick(&['x', 'm', 'o', '\u{1b}'])),
                5 => Life::Press,
                6 => Life::Release,
                7 => Life::FocusComposer,
                _ => Life::Active(rng.below(3) > 0),
            })
            .collect()
    }

    fn run(&self, commands: &[Life]) -> Option<Failure> {
        // The twins: the TUI without the plugin, and with it before any mount, both on the same session.
        let without = ledger_of(
            &support::mount(
                120,
                30,
                support::deps(std::sync::Arc::new(support::Fake::new(|seen| support::base(seen, support::DIRECTORY)))),
            )
            .tui,
        );
        let harness = plugin::open();
        let unmounted = ledger_of(&harness.tui);
        let mut shown = Shown { active: true, panel: false };
        for (step, command) in commands.iter().enumerate() {
            live(&harness, &mut shown, *command);
            let ledger = ledger_of(&harness.tui);
            let fail = |site, detail: String| Some(Failure { property: "ledger", site, step, detail });
            if model::skipped("ledger") {
                continue;
            }
            if !shown.active {
                if ledger != without {
                    return fail("plugin", format!("{command:?}: a disabled plugin left {ledger:?}, not {without:?}"));
                }
                if !opencode_plugin::Host::composer_focused(&*harness.tui) {
                    return fail("focus", format!("{command:?}: the focus is not at the composer"));
                }
                continue;
            }
            // The mode of the plugin's own layers is the plugin's while the composer has the focus.
            let mode = usize::from(probe_mode(&harness));
            let expected = Ledger { modes: unmounted.modes + mode, ..unmounted };
            if !shown.panel && ledger != expected {
                return fail("mount", format!("{command:?}: a closed panel left {ledger:?}, not {expected:?}"));
            }
        }
        None
    }
}

/// The ledger, as the host reads it from its registries.
fn ledger_of(tui: &Tui) -> Ledger {
    interact::ledger(tui)
}

/// Whether the plugin's own mode holds now: it reads it in its composer layer's handler, so the test asks its host.
fn probe_mode(harness: &Harness) -> bool {
    harness.tui.keymap.mode().ends_with(":normal")
}

/// Runs `command` on the TUI.
fn live(harness: &Harness, shown: &mut Shown, command: Life) {
    let tui = &harness.tui;
    match command {
        Life::Panel(true) if shown.active => {
            plugin::run(harness, "input.panel", None);
            shown.panel = true;
        }
        Life::Panel(false) if shown.active => {
            plugin::run(harness, "input.close", None);
            opencode_plugin::Host::focus_composer(&**tui);
            plugin::settle(harness);
            shown.panel = false;
        }
        Life::Key('\u{1b}') => {
            // Escape is the host's outside the composer: the composer takes the focus first.
            opencode_plugin::Host::focus_composer(&**tui);
            plugin::settle(harness);
            harness.app.press("escape");
            plugin::settle(harness);
        }
        Life::Key(key) => {
            harness.app.press(&key.to_string());
            plugin::settle(harness);
        }
        Life::Press if shown.panel => {
            if let Some((x, y)) = support::at(&harness.app.text(), "AAAA") {
                harness.app.mouse(MouseEventKind::Down(MouseButton::Left), x + 1, y);
                plugin::settle(harness);
            }
        }
        Life::Release => {
            if let Some((x, y)) = support::at(&harness.app.text(), "AAAA") {
                harness.app.mouse(MouseEventKind::Up(MouseButton::Left), x + 1, y);
                plugin::settle(harness);
            }
        }
        Life::FocusComposer => {
            opencode_plugin::Host::focus_composer(&**tui);
            plugin::settle(harness);
        }
        Life::Active(active) if active != shown.active => {
            let host = opencode_tui::plugins::host::host(tui);
            tui.plugins.toggle(&host, plugin::ID, active);
            tui.navigate(tui.route());
            plugin::settle(harness);
            shown.active = active;
            shown.panel = false;
        }
        _ => {}
    }
    plugin::taken();
}

// Expected (`ledger`, 4.14): whatever the plugin's mounts held (layers, a mode, a capture, an overlay), a closed panel
// leaves the registries as the plugin left them with no mount, and a disabled plugin leaves them as a TUI without it,
// with the focus at the composer.
#[test]
fn nothing_an_ended_mount_or_plugin_held_is_left() {
    model::check(&Ledgers, 24, 24);
}

// Expected: the deep run's seed 553 (2,000 seeds), as a fixed row. Two clicks on the panel's text were a double click,
// whose word selection the host's escape cleared before any layer saw the key; the panel's texts now select nothing.
#[test]
fn a_double_click_in_the_panel_keeps_escape_for_the_composer() {
    let trace = [
        Command::Panel(true),
        Command::Click,
        Command::Click,
        Command::Focus(Focus::Composer),
        Command::Keys(vec![Key::Escape]),
    ];
    assert_eq!(Delivery.run(&trace), None);
}
