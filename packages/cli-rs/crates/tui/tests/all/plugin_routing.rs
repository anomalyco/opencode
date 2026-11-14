//! P2's properties of routing (synthesis 4.14): `delivery`, and `ledger` for layers, modes, capture, holds and
//! overlays, on the test plugin of `plugin_input` in the real TUI.
//!
//! `delivery`: an active plugin gets each key, paste and pointer event it is entitled to once, in the order of the
//! input, and no other; inside a batch, the effects of event n (a mode, a focus) apply before event n + 1 is routed.
//! The oracle is a reference router written here, a pure function of the event list over focus, layers, priorities,
//! modes, the overlay, a host dialog and the host's selection, which shares no code with the host. The events are
//! chosen from the reference alone, never from the screen; a target the reference expects and the screen lacks fails
//! the run. It is compared with the plugin's own log and with what the host shows: the composer's text and cursor,
//! whether the composer has the focus, and whether a selection holds.
//!
//! `ledger`: when a mount ends, nothing it owned of the input is left, and when the plugin leaves `active`, by a
//! disable or a failure, nothing of it is left and the focus is at the composer. The expected counts come from the
//! twin, the same TUI with the plugin before any mount (or without it), and the plugin's mode from the trace; a hold,
//! a capture, a mode and an overlay are armed before the exits, and time passes beyond a hold's deadline.

use std::time::Duration;

use crate::plugin_input::{self as plugin, probe};
use crate::support::model::{self, Failure, Model, Rng};
use crate::support::{self, Harness};

use opencode_plugin::abi;
use opencode_plugin::interact::{self, Ledger};
use opencode_tui::{Deps, Tui};
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
    O,
    K,
    N,
    Left,
    Backspace,
    Escape,
}

impl Key {
    const ALL: [Key; 13] = [
        Key::X,
        Key::Y,
        Key::M,
        Key::J,
        Key::I,
        Key::D,
        Key::Q,
        Key::O,
        Key::K,
        Key::N,
        Key::Left,
        Key::Backspace,
        Key::Escape,
    ];

    fn event(self) -> Input {
        let code = match self {
            Key::Escape => KeyCode::Escape,
            Key::Left => KeyCode::Left,
            Key::Backspace => KeyCode::Backspace,
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
            Key::O => 'o',
            Key::K => 'k',
            Key::N => 'n',
            Key::Left | Key::Backspace | Key::Escape => return None,
        })
    }

    fn name(self) -> String {
        match self {
            Key::Escape => "escape".to_owned(),
            Key::Left => "left".to_owned(),
            Key::Backspace => "backspace".to_owned(),
            key => key.char().unwrap().to_string(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Focus {
    Composer,
    /// The panel's root.
    Panel,
    A,
    B,
    /// The overlay's frame.
    Overlay,
}

#[derive(Clone, Debug)]
enum Command {
    /// Keys in one polled batch: nothing deferred runs between them.
    Keys(Vec<Key>),
    /// The host moves the focus, by the composer's own focus or the plugin's `focus` from a command.
    Focus(Focus),
    /// The plugin's panel opens, or closes.
    Panel(bool),
    /// The `x` binds pass the key on, or take it.
    Pass(bool),
    Paste,
    /// A press and a release on node `a`, long after any press before it.
    Click,
    /// Two presses and releases on node `a`, a double click.
    DoubleClick,
    /// A double click on the panel's first line, which no pointer node takes.
    DoubleClickLabel,
    /// A press on node `a`, a drag in it and a release.
    Drag,
    /// The panel's texts may be selected, or not.
    Selectable(bool),
    /// The plugin's select, a dialog of the host, opens.
    Dialog,
}

/// The reference router: what the plugin is entitled to, and what the host shows.
#[derive(Clone, Debug)]
struct Reference {
    panel: bool,
    overlay: bool,
    dialog: bool,
    focus: Focus,
    /// The composer layer's mode `normal`, the panel's `menu`, the overlay's `nav`.
    normal: bool,
    menu: bool,
    nav: bool,
    pass: bool,
    selectable: bool,
    selection: bool,
    log: Vec<String>,
    composer: String,
    cursor: usize,
}

impl Reference {
    fn new() -> Self {
        Self {
            panel: false,
            overlay: false,
            dialog: false,
            focus: Focus::Composer,
            normal: false,
            menu: false,
            nav: false,
            pass: false,
            selectable: false,
            selection: false,
            log: Vec::new(),
            composer: String::new(),
            cursor: 0,
        }
    }

    fn in_panel(&self) -> bool {
        matches!(self.focus, Focus::Panel | Focus::A | Focus::B)
    }

    /// The mode the keymap is in: a host dialog's over the plugins'; a plugin's holds only while the focus is in its
    /// scope.
    fn mode(&self) -> &'static str {
        match (self.dialog, self.focus) {
            (true, _) => "dialog",
            (_, Focus::Composer) if self.normal => "normal",
            (_, Focus::Panel | Focus::A | Focus::B) if self.menu => "menu",
            (_, Focus::Overlay) if self.nav => "nav",
            _ => "-",
        }
    }

    /// Moves the focus; a mode whose scope it leaves ends for good.
    fn focus(&mut self, focus: Focus) {
        if focus != Focus::Composer {
            self.normal = false;
        }
        if !matches!(focus, Focus::Panel | Focus::A | Focus::B) {
            self.menu = false;
        }
        if focus != Focus::Overlay {
            self.nav = false;
        }
        self.focus = focus;
    }

    /// The overlay closes, and the opener hears it; a focus it had goes back to the panel.
    fn close_overlay(&mut self) {
        self.overlay = false;
        if self.focus == Focus::Overlay {
            self.focus(Focus::Panel);
        }
        // The panel reads its own mode, which holds while the focus is in it.
        let mode = if self.in_panel() && self.menu { "menu" } else { "-" };
        self.log.push(format!("side: closed menu [{mode}]"));
    }

    fn key(&mut self, key: Key) {
        // A selection takes escape before anything, and goes with any other key.
        if self.selection {
            self.selection = false;
            if key == Key::Escape {
                return;
            }
        }
        if self.dialog {
            // Its filter types the key; escape closes it, and the focus goes back.
            if key == Key::Escape {
                self.dialog = false;
            }
            return;
        }
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
        let panel = self.in_panel();
        let consumed = match (mode, self.focus, key) {
            ("-", Focus::Composer, Key::Escape) => {
                self.log.push("setup: key normal [-]".to_owned());
                self.normal = true;
                true
            }
            ("-", Focus::Composer, Key::X) => {
                self.log.push("setup: key cx [-]".to_owned());
                !self.pass
            }
            ("-", _, Key::X) if panel => {
                self.log.push("side: key x [-]".to_owned());
                !self.pass
            }
            ("-", _, Key::M) if panel => {
                self.log.push("side: key mode [-]".to_owned());
                self.menu = true;
                true
            }
            ("-", _, Key::O) if panel => {
                self.log.push("side: key overlay [-]".to_owned());
                // It replaces an overlay on screen, whose opener hears it closed.
                if self.overlay {
                    self.log.push("side: closed menu [-]".to_owned());
                }
                self.overlay = true;
                self.focus(Focus::Overlay);
                true
            }
            ("-", Focus::A, Key::Y) => {
                self.log.push("side: key y [-]".to_owned());
                self.focus(Focus::B);
                true
            }
            ("menu", _, Key::J) if panel => {
                self.log.push("side: key down [menu]".to_owned());
                true
            }
            ("-", Focus::Overlay, Key::K) => {
                self.log.push("menu: key k [-]".to_owned());
                true
            }
            ("nav", Focus::Overlay, Key::K) => {
                self.log.push("menu: key k [nav]".to_owned());
                true
            }
            ("-", Focus::Overlay, Key::N) => {
                self.log.push("menu: key nav [-]".to_owned());
                self.nav = true;
                true
            }
            (_, Focus::Overlay, Key::Escape) => {
                self.close_overlay();
                true
            }
            _ => false,
        };
        // Past the plugin, the composer edits at its cursor while it has the focus.
        if consumed || self.focus != Focus::Composer {
            return;
        }
        match key {
            Key::Left => self.cursor = self.cursor.saturating_sub(1),
            Key::Backspace if self.cursor > 0 => {
                self.cursor -= 1;
                self.composer.remove(self.cursor);
            }
            key => {
                if let Some(char) = key.char() {
                    self.composer.insert(self.cursor, char);
                    self.cursor += 1;
                }
            }
        }
    }

    /// A paste goes to the layer of its scope that declares pastes, in its mode, or on to the host.
    fn paste(&mut self) {
        if self.dialog {
            return;
        }
        match (self.focus, self.mode()) {
            (Focus::Composer, "normal") => self.log.push("setup: paste P [normal]".to_owned()),
            (Focus::Composer, _) => {
                self.composer.insert(self.cursor, 'P');
                self.cursor += 1;
            }
            (Focus::Panel | Focus::A | Focus::B, "-") => self.log.push("side: paste P [-]".to_owned()),
            _ => {}
        }
    }

    /// A press over the overlay's backdrop closes it and goes no further; else a press on the focusable pointer node
    /// `a` gives it the focus before its handler runs, which takes the press: no selection starts under it. Either ends
    /// a selection.
    fn press(&mut self, kinds: &[&str]) {
        self.selection = false;
        if self.overlay {
            self.close_overlay();
            return;
        }
        self.focus(Focus::A);
        let mode = self.mode();
        for kind in kinds {
            self.log.push(format!("side: {kind} [{mode}]"));
        }
    }
}

struct Delivery;

impl Model for Delivery {
    type Command = Command;

    fn generate(&self, rng: &mut Rng, steps: usize) -> Vec<Command> {
        (0..steps)
            .map(|_| match rng.below(16) {
                0..=3 => Command::Keys(vec![*rng.pick(&Key::ALL)]),
                4 | 5 => Command::Keys((0..2 + rng.below(4)).map(|_| *rng.pick(&Key::ALL)).collect()),
                6 | 7 => Command::Focus(*rng.pick(&[Focus::Composer, Focus::Panel, Focus::A, Focus::B])),
                8 => Command::Panel(rng.below(3) > 0),
                9 => Command::Pass(rng.below(2) == 0),
                10 => Command::Paste,
                11 => Command::Click,
                12 if rng.below(2) == 0 => Command::DoubleClick,
                12 => Command::DoubleClickLabel,
                13 => Command::Drag,
                14 => Command::Selectable(rng.below(2) == 0),
                _ => Command::Dialog,
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
        let harness = plugin::open_with(|probe| {
            probe.listen = true;
            probe.rows = vec!["alpha".to_owned()];
        });
        let mut reference = Reference::new();
        for (step, command) in commands.iter().enumerate() {
            apply(&harness, &mut reference, command);
            // Hover is the host's with no call, and its events are `plugin_input`'s.
            let log: Vec<String> = plugin::taken().into_iter().filter(|line| !line.contains("hover")).collect();
            let fail = |site, detail: String| Some(Failure { property: "delivery", site, step, detail });
            if model::skipped("delivery") {
                continue;
            }
            if log != reference.log {
                return fail("log", format!("{command:?}: the plugin saw {log:?}, the reference {:?}", reference.log));
            }
            reference.log.clear();
            let (text, cursor) = composer(&harness.tui);
            if (text.as_str(), cursor) != (reference.composer.as_str(), reference.cursor) {
                return fail(
                    "composer",
                    format!(
                        "{command:?}: the composer shows {text:?} at {cursor}, not {:?} at {}",
                        reference.composer, reference.cursor
                    ),
                );
            }
            let focused = opencode_plugin::Host::composer_focused(&*harness.tui);
            if focused != (reference.focus == Focus::Composer && !reference.dialog) {
                return fail("focus", format!("{command:?}: the composer has the focus: {focused}, {reference:?}"));
            }
            let selection = harness.app.app().selected_text().is_some();
            if selection != reference.selection {
                return fail("selection", format!("{command:?}: a selection holds: {selection}, {reference:?}"));
            }
        }
        None
    }
}

/// Where `text` is on the screen; the reference expects it there.
fn target(harness: &Harness, text: &str) -> (u16, u16) {
    support::at(&harness.app.text(), text)
        .unwrap_or_else(|| panic!("the reference expects {text} on the screen:\n{}", harness.app.text()))
}

/// Runs `command` on the TUI and on the reference. What it sends depends on the reference only.
fn apply(harness: &Harness, reference: &mut Reference, command: &Command) {
    let tui = &harness.tui;
    // While a host dialog is open, the run sends only keys and pastes.
    if reference.dialog && !matches!(command, Command::Keys(_) | Command::Paste) {
        return;
    }
    match command {
        Command::Keys(keys) => {
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
            if reference.panel {
                // The overlay ends with its opener, which hears nothing; the panel's texts and their selection go,
                // and a focus in them goes to the composer.
                reference.panel = false;
                reference.overlay = false;
                reference.selection = false;
                if reference.focus != Focus::Composer {
                    reference.focus(Focus::Composer);
                }
            }
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
        Command::Click | Command::Drag if reference.panel => {
            // Long after any press before it: no double click.
            harness.app.advance(Duration::from_secs(1));
            let (x, y) = target(harness, "AAAA");
            harness.app.mouse(MouseEventKind::Down(MouseButton::Left), x + 1, y);
            let kinds: &[&str] = match command {
                Command::Drag => {
                    harness.app.mouse(MouseEventKind::Drag(MouseButton::Left), x + 2, y);
                    harness.app.mouse(MouseEventKind::Up(MouseButton::Left), x + 2, y);
                    &["Down a 1,0", "Drag a 2,0", "Up a 2,0"]
                }
                _ => {
                    harness.app.mouse(MouseEventKind::Up(MouseButton::Left), x + 1, y);
                    &["Down a 1,0", "Up a 1,0"]
                }
            };
            plugin::settle(harness);
            reference.press(kinds);
        }
        Command::DoubleClick if reference.panel && !reference.overlay => {
            harness.app.advance(Duration::from_secs(1));
            let (x, y) = target(harness, "AAAA");
            for _ in 0..2 {
                harness.app.mouse(MouseEventKind::Down(MouseButton::Left), x + 1, y);
                harness.app.mouse(MouseEventKind::Up(MouseButton::Left), x + 1, y);
            }
            plugin::settle(harness);
            reference.press(&["Down a 1,0", "Up a 1,0", "Down a 1,0", "Up a 1,0"]);
        }
        Command::DoubleClickLabel if reference.panel && !reference.overlay => {
            harness.app.advance(Duration::from_secs(1));
            let (x, y) = target(harness, "PANEL");
            for _ in 0..2 {
                harness.app.mouse(MouseEventKind::Down(MouseButton::Left), x + 1, y);
                harness.app.mouse(MouseEventKind::Up(MouseButton::Left), x + 1, y);
            }
            plugin::settle(harness);
            // The panel takes the focus; its text selects a word when it may.
            if !reference.in_panel() {
                reference.focus(Focus::Panel);
            }
            reference.selection = reference.selectable;
        }
        Command::Selectable(selectable) => {
            probe(|probe| probe.selectable = *selectable);
            plugin::run(harness, "input.redraw", None);
            if reference.panel && reference.selectable != *selectable {
                reference.selection = false;
            }
            reference.selectable = *selectable;
        }
        Command::Dialog if !reference.overlay => {
            plugin::run(harness, "input.select", None);
            // It takes the focus: the mode of the scope the focus leaves ends.
            let focus = reference.focus;
            reference.focus(Focus::Overlay);
            reference.focus = focus;
            reference.dialog = true;
        }
        _ => {}
    }
}

/// The composer's text and cursor.
fn composer(tui: &Tui) -> (String, usize) {
    let mut composer = (String::new(), 0);
    opencode_plugin::Host::read(tui, &mut |read| {
        composer = read.composer().map(|composer| (composer.text, composer.cursor)).unwrap_or_default();
    });
    composer
}

// Expected (`delivery`, 4.14): along any sequence of keys, bursts, focus moves, panel opens and closes, pastes,
// presses, double clicks, drags, an overlay and a host dialog, the plugin's own log equals the reference router's, and
// so do the composer's text and cursor, the composer's focus and the host's selection.
#[test]
fn every_event_reaches_the_plugin_once_in_order() {
    model::check(&Delivery, 24, 24);
}

#[derive(Clone, Copy, Debug)]
enum Life {
    Panel(bool),
    /// A key of the panel: `x` (which holds what follows it), `m` (its mode), `o` (its overlay); or escape in the
    /// composer (the plugin's mode). Time then passes beyond a hold's deadline, so no hold spans two steps.
    Key(char),
    /// A press on node `a`, which the plugin consumes: the pointer is captured until a release. Over the overlay, its
    /// backdrop takes it and closes the overlay.
    Press,
    Release,
    FocusComposer,
    /// The plugin leaves `active`, or comes back.
    Active(bool),
    /// A handler of the panel panics on a key: the plugin fails.
    Fail,
    /// The plugin's route shows, or the session again.
    Route(bool),
    /// With a hold armed in the panel and a key behind it, the panel closes, the plugin leaves `active`, or its route
    /// shows; then time passes beyond the hold's deadline and a fresh key comes.
    HeldExit(Exit),
}

#[derive(Clone, Copy, Debug)]
enum Exit {
    Close,
    Disable,
    Route,
}

/// Where the focus is, as the trace moved it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum At {
    Composer,
    Panel,
    Overlay,
}

/// The `ledger` model's state of the plugin, from the trace.
#[derive(Clone, Copy, Debug)]
struct Shown {
    active: bool,
    panel: bool,
    overlay: bool,
    route: bool,
    at: At,
    /// The composer's mode `normal`: escape in the composer sets it; the focus leaving the composer ends it.
    normal: bool,
    /// A press on `a` that the plugin took holds the pointer, until a release or a move of the focus (carbon-9).
    captured: bool,
    /// The panel's mode `menu`, in which its base keys (`x`, `m`, `o`) are none of it.
    menu: bool,
}

impl Shown {
    fn new(active: bool) -> Self {
        Self {
            active,
            panel: false,
            overlay: false,
            route: false,
            at: At::Composer,
            normal: false,
            captured: false,
            menu: false,
        }
    }

    fn focus(&mut self, at: At) {
        if at != At::Composer {
            self.normal = false;
        }
        if at != At::Panel {
            self.menu = false;
        }
        self.at = at;
        self.captured = false;
    }
}

struct Ledgers;

impl Model for Ledgers {
    type Command = Life;

    fn generate(&self, rng: &mut Rng, steps: usize) -> Vec<Life> {
        (0..steps)
            .map(|_| match rng.below(14) {
                0 | 1 => Life::Panel(rng.below(3) > 0),
                2..=4 => Life::Key(*rng.pick(&['x', 'm', 'o', '\u{1b}'])),
                5 => Life::Press,
                6 => Life::Release,
                7 => Life::FocusComposer,
                8 => Life::Active(rng.below(3) > 0),
                9 => Life::Fail,
                10 => Life::Route(rng.below(2) == 0),
                _ => Life::HeldExit(*rng.pick(&[Exit::Close, Exit::Disable, Exit::Route])),
            })
            .collect()
    }

    fn run(&self, commands: &[Life]) -> Option<Failure> {
        // The twins: the TUI without the plugin (the other test plugin only), and with it before any mount, both on
        // the same session.
        let deps = Deps {
            builtins: vec![abi::Plugin { id: "test.other", setup: plugin::other }.into()],
            ..support::deps(std::sync::Arc::new(support::Fake::new(|seen| support::base(seen, support::DIRECTORY))))
        };
        let without = interact::ledger(&*support::mount(120, 30, deps).tui);
        let harness = plugin::open_with(|probe| probe.hold = true);
        let unmounted = interact::ledger(&*harness.tui);
        let mut shown = Shown::new(true);
        for (step, command) in commands.iter().enumerate() {
            live(&harness, &mut shown, *command);
            let ledger = interact::ledger(&*harness.tui);
            let fail = |site, detail: String| Some(Failure { property: "ledger", site, step, detail });
            if model::skipped("ledger") {
                continue;
            }
            if !shown.active {
                if ledger != without {
                    return fail("plugin", format!("{command:?}: a plugin that left left {ledger:?}, not {without:?}"));
                }
                if !opencode_plugin::Host::composer_focused(&*harness.tui) {
                    return fail("focus", format!("{command:?}: the focus is not at the composer"));
                }
                continue;
            }
            // On every step, the capture is what the trace says, whatever else the mounts hold.
            if ledger.capture != shown.captured {
                return fail("capture", format!("{command:?}: the capture is {}, the trace {shown:?}", ledger.capture));
            }
            let expected = Ledger { modes: unmounted.modes + usize::from(shown.normal), ..unmounted };
            if !shown.panel && !shown.route && ledger != expected {
                return fail("mount", format!("{command:?}: no mount left {ledger:?}, not {expected:?}"));
            }
        }
        None
    }
}

/// Lets time pass beyond a hold's deadline.
fn wait(harness: &Harness) {
    harness.app.advance(opencode_plugin::abi::interact::HOLD * 2);
    plugin::settle(harness);
}

/// Runs `command` on the TUI and on the trace's state; the driver repairs nothing.
fn live(harness: &Harness, shown: &mut Shown, command: Life) {
    let tui = &harness.tui;
    match command {
        Life::Panel(true) if shown.active && !shown.route => {
            plugin::run(harness, "input.panel", None);
            if !shown.panel {
                shown.focus(At::Panel);
            }
            shown.panel = true;
        }
        Life::Panel(false) if shown.active => {
            plugin::run(harness, "input.close", None);
            close(shown);
        }
        Life::Key('\u{1b}') => {
            // Escape in the composer: the composer takes the focus first.
            opencode_plugin::Host::focus_composer(&**tui);
            plugin::settle(harness);
            harness.app.press("escape");
            wait(harness);
            shown.focus(At::Composer);
            shown.normal = shown.active && !shown.route;
        }
        Life::Key(key) => {
            harness.app.press(&key.to_string());
            wait(harness);
            let panel = shown.active && shown.panel && shown.at == At::Panel && !shown.menu;
            match key {
                'o' if panel => {
                    shown.overlay = true;
                    shown.focus(At::Overlay);
                }
                'm' if panel => shown.menu = true,
                _ => {}
            }
            // Time passed beyond a hold's deadline, which is no resize: a capture stays.
        }
        Life::Press if shown.panel => {
            let (x, y) = support::at(&harness.app.text(), "AAAA").expect("the panel shows AAAA");
            harness.app.mouse(MouseEventKind::Down(MouseButton::Left), x + 1, y);
            plugin::settle(harness);
            match shown.overlay {
                true => {
                    shown.overlay = false;
                    if shown.at == At::Overlay {
                        shown.focus(At::Panel);
                    }
                }
                false => {
                    shown.focus(At::Panel);
                    shown.captured = true;
                }
            }
        }
        Life::Release if shown.panel => {
            let (x, y) = support::at(&harness.app.text(), "AAAA").expect("the panel shows AAAA");
            harness.app.mouse(MouseEventKind::Up(MouseButton::Left), x + 1, y);
            plugin::settle(harness);
            shown.captured = false;
        }
        Life::FocusComposer => {
            opencode_plugin::Host::focus_composer(&**tui);
            plugin::settle(harness);
            shown.focus(At::Composer);
        }
        Life::Active(active) if active != shown.active => toggle(harness, shown, active),
        Life::Fail if shown.active && shown.panel => {
            probe(|probe| probe.panic = true);
            plugin::run(harness, "input.focus", Some("a"));
            harness.app.press("x");
            plugin::settle(harness);
            probe(|probe| probe.panic = false);
            // A capture means `a` has the focus already: focusing it moves nothing, and the capture stays.
            let captured = shown.captured;
            shown.focus(At::Panel);
            shown.captured = captured;
            if !runs(tui) {
                *shown = Shown::new(false);
                session(harness);
            }
        }
        Life::Route(true) if shown.active && !shown.route => {
            plugin::run(harness, "input.route", None);
            *shown = Shown { panel: false, overlay: false, route: true, ..*shown };
            shown.focus(At::Panel);
        }
        Life::Route(false) if shown.route => {
            session(harness);
            shown.route = false;
            shown.at = if opencode_plugin::Host::composer_focused(&**tui) { At::Composer } else { At::Panel };
        }
        Life::HeldExit(exit) if shown.active && shown.panel => {
            // Out of the panel and back, which ends its mode, so `x` is a key of it again.
            opencode_plugin::Host::focus_composer(&**tui);
            plugin::settle(harness);
            plugin::run(harness, "input.focus", Some("a"));
            shown.focus(At::Panel);
            shown.overlay = false;
            harness.app.press("x");
            harness.app.press("q");
            assert!(interact::ledger(&**tui).holding, "the hold is armed");
            match exit {
                Exit::Close => {
                    plugin::run(harness, "input.close", None);
                    close(shown);
                }
                Exit::Disable => toggle(harness, shown, false),
                Exit::Route => {
                    plugin::run(harness, "input.route", None);
                    *shown = Shown { panel: false, overlay: false, route: true, ..*shown };
                }
            }
            wait(harness);
            harness.app.press("q");
            plugin::settle(harness);
        }
        _ => {}
    }
    plugin::taken();
}

/// The panel closed: its overlay goes with it, and a focus in either goes to the composer.
fn close(shown: &mut Shown) {
    if shown.panel {
        shown.panel = false;
        shown.overlay = false;
        shown.captured = false;
        if shown.at != At::Composer {
            shown.focus(At::Composer);
        }
    }
}

/// The plugin leaves `active`, or comes back.
fn toggle(harness: &Harness, shown: &mut Shown, active: bool) {
    let tui = &harness.tui;
    let host = opencode_tui::plugins::host::host(tui);
    tui.plugins.toggle(&host, plugin::ID, active);
    tui.navigate(tui.route());
    plugin::settle(harness);
    let route = shown.route && runs(tui);
    *shown = Shown { route, ..Shown::new(runs(tui)) };
    // The route of a plugin that left shows nothing: the user goes back to the session.
    if !shown.active {
        session(harness);
    }
}

/// Whether the test plugin runs: active, and not failed.
fn runs(tui: &Tui) -> bool {
    tui.plugins.entries().iter().any(|entry| entry.id == plugin::ID && entry.status == opencode_plugin::Status::Active)
}

/// Shows the session again.
fn session(harness: &Harness) {
    let route = opencode_tui::Route::Session { id: opencode_api::generated::SessionID("ses_a".into()) };
    if harness.tui.route() != route {
        harness.tui.navigate(route);
        plugin::settle(harness);
    }
}

// Expected (`ledger`, 4.14): whatever the plugin's mounts held (layers, a mode, a capture, a hold with a key behind it
// and its timer, an overlay), a closed panel or a route left leaves the registries as the plugin left them with no
// mount, also after the hold's deadline and a fresh key, and a disabled or failed plugin leaves them as a TUI without
// it, with the focus at the composer.
#[test]
fn nothing_an_ended_mount_or_plugin_held_is_left() {
    model::check(&Ledgers, 24, 24);
}

// Expected: the deep run's seed 553 (2,000 seeds), as fixed rows. A double click on the panel's selectable text makes
// a selection, which takes the next escape before any layer, also in the composer; on text that selects nothing, or
// on a node that takes the press (carbon-5), escape is the plugin's.
#[test]
fn a_double_click_in_the_panel_selects_only_selectable_text() {
    for (selectable, click) in
        [(false, Command::DoubleClickLabel), (true, Command::DoubleClickLabel), (true, Command::DoubleClick)]
    {
        let trace = [
            Command::Selectable(selectable),
            Command::Panel(true),
            click,
            Command::Focus(Focus::Composer),
            Command::Keys(vec![Key::Escape]),
        ];
        assert_eq!(Delivery.run(&trace), None, "selectable: {selectable}");
    }
}
