//! The plugin model (O-124, phase Pt): the real TUI in a `TestApp` with one external plugin, `model.probe`, loaded by
//! the real `Loader` and driven through the C ABI's byte shims. The commands are what a user and a build can do to a
//! plugin today: toggle it in the plugin manager, run its commands, open and close its panel, navigate to home and to
//! its route, reload it with another build, arm a fault in its next `setup`, command or render, and exit.
//!
//! The machines are in `steps/plugins-pt.md` (opendocs). Three properties are checked after every command, each
//! with an oracle that shares no code with the host:
//!
//! - `lifecycle`: the probe writes its own call log; [`Reference`] is the plugin machine as code, fed the same
//!   commands, and says which calls the log may hold.
//! - `ledger`: while the probe is not active, the host equals a twin TUI that ran the same commands without it:
//!   the reachable commands, the dialogs, focus and the widgets, read from the host, and the frame once it is
//!   disabled. Each activation holds a token that only its registrations hold: once it ended, the token is gone.
//! - `reload-fresh`: after a reload that passed, the host equals a fresh TUI that loaded the new build on the same
//!   route, with the call log from `setup` on; after one that failed, it equals itself before the reload, plus one
//!   report.
//!
//! [`OPEN`] holds the shrunk traces of what the model found that is not fixed: each must still fail with its
//! property, so a fix fails the test until its row moves to [`FIXED`].

use crate::support::model::{self, Failure, Model, Rng};
use crate::support::{self, Harness};

use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};
use std::sync::Arc;
use std::time::Duration;

use opencode_plugin::abi;
use opencode_plugin::loader::native::loopback_described;
use opencode_plugin::loader::{Backend, Loader, entry_file};
use opencode_plugin::{Definition, ErrorFn, Host};
use opencode_tui::plugins::host::host;
use opencode_tui::{Deps, Route};
use opentui::keymap::RunResult;
use opentui::prelude::*;
use opentui::testing::Capture;

const ID: &str = "model.probe";
/// The build whose `setup` returns a failure.
const BAD: u8 = 9;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fault {
    Setup,
    Command,
    Render,
}

/// The probe's dialogs. A prompt and a select run `probe.run` when they are confirmed; the panel has no action.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Dialog {
    Panel,
    Prompt,
    Select,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Command {
    /// The plugin manager's action on the probe's row.
    Toggle,
    /// The probe's command `probe.run`, which counts.
    Run,
    /// The probe's command that opens that dialog.
    Dialog(Dialog),
    /// Confirms the dialog that is open, if any.
    Enter,
    Escape,
    Frame,
    Home,
    /// The probe's route.
    Route,
    /// A new build in the probe's directory, then a reconcile.
    Reload(u8),
    /// Makes the probe's next call of that kind panic.
    Arm(Fault),
    Exit,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Setup,
    Command,
    Render,
    Dispose,
}

/// One call the probe got, as it logs it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Call {
    pub activation: u32,
    pub build: u8,
    pub kind: Kind,
    pub panicked: bool,
}

thread_local! {
    static LOG: RefCell<Vec<Call>> = const { RefCell::new(Vec::new()) };
    static ACTIVATIONS: Cell<u32> = const { Cell::new(0) };
    static ARMED: Cell<Option<Fault>> = const { Cell::new(None) };
    /// Each activation's token, which only the closures it registers hold.
    static TOKENS: RefCell<Vec<(u32, Weak<()>)>> = const { RefCell::new(Vec::new()) };
}

/// The probe: a command that counts, a command for each of its dialogs, a line in `home.footer` and a route that
/// show the build and the count, and a dispose callback. Each logs its call, and panics when its fault is armed.
fn probe<const B: u8>(setup: &mut abi::Setup) -> Result<(), String> {
    let activation = ACTIVATIONS.with(|next| {
        next.set(next.get() + 1);
        next.get()
    });
    let token = Rc::new(());
    TOKENS.with_borrow_mut(|tokens| tokens.push((activation, Rc::downgrade(&token))));
    called(activation, B, Kind::Setup);
    if B == BAD {
        return Err(format!("probe build {B} fails its setup"));
    }
    let count = Rc::new(Cell::new(0));
    let command = |name: &str, title: &str| abi::Command {
        name: name.to_owned(),
        title: title.to_owned(),
        palette: true,
        ..abi::Command::default()
    };
    let (held, counted) = (token.clone(), count.clone());
    setup.command(command("probe.run", "Probe run"), move |_, _| {
        let _ = &held;
        called(activation, B, Kind::Command);
        counted.set(counted.get() + 1);
    });
    let held = token.clone();
    setup.command(command("probe.panel", "Probe panel"), move |host, _| {
        let _ = &held;
        called(activation, B, Kind::Command);
        host.dialog(abi::Dialog::Panel(abi::Panel {
            key: "panel".to_owned(),
            size: abi::PanelSize::Medium,
            title: vec![abi::Span::new("Probe panel")],
            subtitle: None,
            body: abi::Node::text([abi::Span::new(format!("probe panel b{B}"))]),
            actions: Vec::new(),
            binds: Vec::new(),
            bleed: false,
            centered: false,
        }));
    });
    let run = || abi::Action::Command { name: "probe.run".to_owned(), input: None };
    let held = token.clone();
    setup.command(command("probe.prompt", "Probe prompt"), move |host, _| {
        let _ = &held;
        called(activation, B, Kind::Command);
        host.dialog(abi::Dialog::Prompt { title: format!("Probe prompt b{B}"), placeholder: None, action: run() });
    });
    let held = token.clone();
    setup.command(command("probe.select", "Probe select"), move |host, _| {
        let _ = &held;
        called(activation, B, Kind::Command);
        host.dialog(abi::Dialog::Select(abi::Select {
            title: format!("Probe select b{B}"),
            placeholder: None,
            options: vec![abi::SelectOption::new("Probe option", "option")],
            current: None,
            action: run(),
        }));
    });
    let (held, counted) = (token.clone(), count.clone());
    setup.slot(abi::Placement::append("home.footer"), move |_, _, _| {
        let _ = &held;
        called(activation, B, Kind::Render);
        abi::Render::Show(abi::Node::text([abi::Span::new(format!("probe b{B} n{}", counted.get()))]))
    });
    let held = token.clone();
    setup.route("probe", move |_, _| {
        let _ = &held;
        called(activation, B, Kind::Render);
        abi::Render::Show(abi::Node::text([abi::Span::new(format!("probe route b{B} n{}", count.get()))]))
    });
    setup.on_dispose(move |_| {
        let _ = &token;
        called(activation, B, Kind::Dispose);
    });
    Ok(())
}

/// Logs a call, then panics if its fault is armed; the fault is spent.
fn called(activation: u32, build: u8, kind: Kind) {
    let fault = match kind {
        Kind::Setup => Some(Fault::Setup),
        Kind::Command => Some(Fault::Command),
        Kind::Render => Some(Fault::Render),
        Kind::Dispose => None,
    };
    let panicked = fault.is_some() && ARMED.get() == fault;
    if panicked {
        ARMED.set(None);
    }
    LOG.with_borrow_mut(|log| log.push(Call { activation, build, kind, panicked }));
    if panicked {
        panic!("probe {kind:?} fault");
    }
}

/// The probe's builds: the file holds the build's number.
struct Builds;

impl Backend for Builds {
    fn load(&self, host: &Rc<dyn Host>, library: &[u8], _: Option<&str>) -> Result<(Definition, ErrorFn), String> {
        match library {
            [1] => loopback_described(host, abi::export_plugin!(@loopback_described ID, probe::<1>)),
            [2] => loopback_described(host, abi::export_plugin!(@loopback_described ID, probe::<2>)),
            [3] => loopback_described(host, abi::export_plugin!(@loopback_described ID, probe::<3>)),
            [BAD] => loopback_described(host, abi::export_plugin!(@loopback_described ID, probe::<BAD>)),
            _ => Err("not a probe build".to_owned()),
        }
    }
}

/// A TUI on home, with the probe's `build` in its plugins directory, or without the probe (the twin).
struct World {
    harness: Harness,
    probe: Option<(Loader, std::path::PathBuf, opencode_util::temp::TempDir)>,
    exited: bool,
}

impl World {
    fn open(build: Option<u8>) -> Self {
        let deps = Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) };
        let harness = support::mount(80, 24, deps);
        let probe = build.map(|build| {
            let root = opencode_util::temp::tempdir().unwrap();
            let config = root.path().join("config");
            let dir = config.join("plugins").join("probe");
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join(entry_file()), [build]).unwrap();
            let loader = Loader::new(Rc::new(Builds), config, root.path().to_path_buf(), Vec::new());
            loader.reconcile(&host(&harness.tui), &harness.tui.plugins);
            (loader, dir, root)
        });
        let world = Self { harness, probe, exited: false };
        world.settle();
        world
    }

    /// Runs `command` as the user or a build would. Returns whether a command of the probe ran from the keymap.
    fn apply(&mut self, command: Command) -> bool {
        let (app, tui) = (&self.harness.app, &self.harness.tui);
        if self.exited {
            app.advance(Duration::from_millis(16));
            return false;
        }
        let mut reached = false;
        match command {
            Command::Toggle => {
                // What the plugin manager's action does (`dialogs/plugins.rs`, `Manager::toggle`).
                let active = tui.plugins.entries().iter().any(|entry| entry.id == ID && entry.active);
                if let Some(toggled) = tui.plugins.toggle(&host(tui), ID, !active) {
                    if let Err(error) = toggled {
                        tui.toasts.error(error);
                    }
                    tui.navigate(tui.route());
                }
            }
            Command::Run => reached = matches!(tui.keymap.dispatch("probe.run", None), RunResult::Ok),
            Command::Dialog(dialog) => {
                let name = format!("probe.{}", format!("{dialog:?}").to_lowercase());
                reached = matches!(tui.keymap.dispatch(&name, None), RunResult::Ok);
            }
            Command::Enter => app.press("enter"),
            Command::Escape => app.press("escape"),
            Command::Frame => app.advance(Duration::from_millis(16)),
            Command::Home => tui.navigate(Route::Home),
            Command::Route => tui.navigate(Route::Plugin { id: ID.to_owned(), name: "probe".to_owned() }),
            Command::Reload(build) => {
                if let Some((loader, dir, _)) = &self.probe {
                    std::fs::write(dir.join(entry_file()), [build]).unwrap();
                    loader.reconcile(&host(tui), &tui.plugins);
                }
            }
            Command::Arm(fault) => {
                if self.probe.is_some() {
                    ARMED.set(Some(fault));
                }
            }
            Command::Exit => {
                tui.plugins.deactivate_all();
                self.exited = true;
            }
        }
        reached
    }

    /// Runs what the command queued, and drains the toasts; returns their titles.
    fn settle(&self) -> Vec<String> {
        let (app, tui) = (&self.harness.app, &self.harness.tui);
        app.advance(Duration::from_millis(1));
        let mut toasts = Vec::new();
        while let Some(toast) = tui.toasts.current() {
            toasts.push(toast.title.unwrap_or(toast.message));
            tui.toasts.dismiss();
        }
        app.advance(Duration::from_millis(1));
        toasts
    }

    /// What the ledger compares, read from the host; the widgets on screen only when `widgets` asks, as counting
    /// them hit-tests every cell.
    fn observe(&self, widgets: bool) -> Observed {
        let (app, tui) = (&self.harness.app, &self.harness.tui);
        // The keymap takes focus at the next key (`route_keys`); after a remount it is behind until then.
        tui.keymap.keymap().set_focus(opencode_ui::dialog::focus_path(app.app()));
        let mut commands: Vec<String> = tui.keymap.commands().into_iter().map(|command| command.id).collect();
        commands.sort();
        let composer = tui.textarea.borrow().as_ref().map(|textarea| textarea.id());
        let focus = match app.app().focused().map(|widget| widget.id()) {
            None => "none",
            Some(id) if Some(id) == composer => "composer",
            Some(_) => "other",
        };
        Observed {
            commands,
            dialogs: (tui.dialogs.len(), tui.dialogs.key()),
            focus,
            widgets: if widgets { self::widgets(app) } else { 0 },
            route: format!("{:?}", tui.route()),
        }
    }

    /// The probe's failure, as the plugin manager lists it.
    fn failure(&self) -> Option<String> {
        self.harness.tui.plugins.entries().into_iter().find(|entry| entry.id == ID).and_then(|entry| {
            match entry.status {
                opencode_plugin::Status::Failed(error) => Some(error),
                _ => None,
            }
        })
    }

    fn frame(&self) -> Capture {
        self.harness.app.render()
    }

    /// The composer's cells: its placeholder is random, so frames are compared without them.
    fn mask(&self) -> Option<(u32, u32, u32, u32)> {
        let textarea = self.harness.tui.textarea.borrow().clone()?;
        let rect = textarea.rect();
        Some((rect.screen_x as u32, rect.screen_y as u32, rect.width as u32, rect.height as u32))
    }
}

/// The widgets on screen: each cell's widget and its parents, once each.
fn widgets(app: &opentui::testing::TestApp) -> usize {
    app.render();
    let (width, height) = app.app().size();
    let mut seen = std::collections::HashSet::new();
    for (x, y) in (0..height).flat_map(|y| (0..width).map(move |x| (x, y))) {
        // A widget seen before has its parents seen too.
        for widget in std::iter::successors(app.app().widget_at(x, y), |widget| widget.parent()) {
            if !seen.insert(widget.id()) {
                break;
            }
        }
    }
    seen.len()
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Observed {
    commands: Vec<String>,
    dialogs: (usize, Option<String>),
    focus: &'static str,
    widgets: usize,
    route: String,
}

impl Observed {
    /// What differs from `other`, field by field; with `widgets`, the widget count too.
    fn diff(&self, other: &Observed, widgets: bool) -> Option<String> {
        let only = |a: &Observed, b: &Observed| -> Vec<String> {
            a.commands.iter().filter(|command| !b.commands.contains(command)).cloned().collect()
        };
        let mut differences = Vec::new();
        if self.commands != other.commands {
            differences.push(format!("commands only here {:?}, only there {:?}", only(self, other), only(other, self)));
        }
        if self.dialogs != other.dialogs {
            differences.push(format!("dialogs {:?} and {:?}", self.dialogs, other.dialogs));
        }
        if self.focus != other.focus {
            differences.push(format!("focus {} and {}", self.focus, other.focus));
        }
        if widgets && self.widgets != other.widgets {
            differences.push(format!("widgets {} and {}", self.widgets, other.widgets));
        }
        if self.route != other.route {
            differences.push(format!("route {} and {}", self.route, other.route));
        }
        (!differences.is_empty()).then(|| differences.join("; "))
    }
}

/// The first row where `a` and `b` differ outside `mask`, unless `allowed` accepts the row of `b`.
fn frame_diff(
    a: &Capture,
    b: &Capture,
    mask: Option<(u32, u32, u32, u32)>,
    allowed: impl Fn(&str) -> bool,
) -> Option<String> {
    let masked = |x: u32, y: u32| mask.is_some_and(|(mx, my, mw, mh)| x >= mx && x < mx + mw && y >= my && y < my + mh);
    let row = |frame: &Capture, y: u32| {
        (0..frame.width).filter_map(|x| frame.cell(x, y)).map(|cell| cell.symbol.as_str()).collect::<String>()
    };
    (0..a.height.max(b.height)).find_map(|y| {
        let differs = (0..a.width.max(b.width)).any(|x| !masked(x, y) && a.cell(x, y) != b.cell(x, y));
        (differs && !allowed(&row(b, y))).then(|| format!("row {y}:\n  {:?}\n  {:?}", row(a, y), row(b, y)))
    })
}

/// The plugin machine of `steps/plugins-pt.md` as code.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Life {
    Active(u32, u8),
    Failed(u32),
    SetupFailed,
    Broken,
    Disabled,
    Exited,
}

/// A call the reference expects, other than a render.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Expect {
    Setup(u8),
    Command(u32),
    Dispose(u32),
}

struct Reference {
    life: Life,
    /// The build the registry sets up on a toggle.
    build: u8,
    /// The build the loader last saw.
    file: u8,
    armed: Option<Fault>,
    /// The last activation seen.
    last: u32,
    /// Outside a strict run the open defect `a-failed-plugin-is-disposed` is expected: a failed plugin's dispose
    /// callbacks run as it leaves.
    strict: bool,
    /// The probe's dialog on screen, and the activation that opened it.
    dialog: Option<(Dialog, u32)>,
}

impl Reference {
    fn new(build: u8, strict: bool) -> Self {
        Self { life: Life::Disabled, build, file: build, armed: None, last: 0, strict, dialog: None }
    }

    /// Checks the calls the probe logged while `command` ran, and moves the machine. `reached` says whether one of
    /// its commands ran from the keymap.
    fn step(&mut self, command: Option<Command>, reached: bool, calls: &[Call]) -> Result<(), String> {
        if self.life == Life::Exited {
            return match calls {
                [] => Ok(()),
                _ => Err(format!("a call after the exit started: {calls:?}")),
            };
        }
        let mut expected: Vec<Expect> = Vec::new();
        // Where the life goes once a `setup` passed; `None` when the calls decide it.
        match command {
            // The first load: the plugin is enabled.
            None => expected.push(Expect::Setup(self.build)),
            Some(Command::Toggle) => match self.life {
                Life::Active(a, _) => expected.push(Expect::Dispose(a)),
                Life::Failed(a) if !self.strict => expected.push(Expect::Dispose(a)),
                Life::Failed(_) | Life::Broken => {}
                Life::Disabled | Life::SetupFailed => expected.push(Expect::Setup(self.build)),
                Life::Exited => unreachable!(),
            },
            Some(Command::Run | Command::Dialog(_)) => match self.life {
                Life::Active(a, _) if reached => expected.push(Expect::Command(a)),
                Life::Active(..) => {}
                _ if reached => return Err(format!("a command ran while the plugin is {:?}", self.life)),
                _ => {}
            },
            Some(Command::Escape) => self.dialog = None,
            // A confirmed prompt or select runs `probe.run`, which reaches only the activation that opened it. The
            // panel has no action and stays.
            Some(Command::Enter) => match self.dialog.take() {
                Some((Dialog::Panel, a)) => self.dialog = Some((Dialog::Panel, a)),
                Some((_, a)) if matches!(self.life, Life::Active(live, _) if live == a) => {
                    expected.push(Expect::Command(a))
                }
                _ => {}
            },
            Some(Command::Reload(build)) if build != self.file => {
                self.file = build;
                match self.life {
                    Life::Failed(a) if !self.strict => expected.extend([Expect::Setup(build), Expect::Dispose(a)]),
                    Life::Active(..) | Life::Failed(_) | Life::SetupFailed | Life::Broken => {
                        expected.push(Expect::Setup(build))
                    }
                    Life::Disabled => self.build = build,
                    Life::Exited => unreachable!(),
                }
            }
            Some(Command::Arm(fault)) => self.armed = Some(fault),
            Some(Command::Exit) => match self.life {
                Life::Active(a, _) => expected.push(Expect::Dispose(a)),
                Life::Failed(a) if !self.strict => expected.push(Expect::Dispose(a)),
                _ => {}
            },
            Some(_) => {}
        }
        let before = self.life;
        let mut expected = expected.into_iter();
        for call in calls {
            if call.kind == Kind::Render {
                let live = matches!(self.life, Life::Active(a, _) if a == call.activation);
                if !live {
                    return Err(format!("a render while the plugin is {:?}: {call:?}", self.life));
                }
                self.fault(Fault::Render, call)?;
                if call.panicked {
                    self.life = Life::Failed(call.activation);
                }
                continue;
            }
            let Some(next) = expected.next() else {
                return Err(format!("an unexpected call while the plugin is {:?}: {call:?}", self.life));
            };
            match (next, call.kind) {
                (Expect::Setup(build), Kind::Setup) if call.build == build && call.activation > self.last => {
                    self.last = call.activation;
                    self.fault(Fault::Setup, call)?;
                    let passed = !call.panicked && build != BAD;
                    match (before, command) {
                        // A candidate that fails leaves the running build; it replaces a failed one with its error.
                        (Life::Active(..), Some(Command::Reload(_))) if !passed => {}
                        (Life::Failed(_), Some(Command::Reload(_))) if !passed => self.life = Life::Broken,
                        (Life::Active(old, _), Some(Command::Reload(_))) => {
                            self.life = Life::Active(call.activation, build);
                            self.build = build;
                            expected =
                                vec![Expect::Dispose(old)].into_iter().chain(expected).collect::<Vec<_>>().into_iter();
                        }
                        _ => {
                            self.build = build;
                            self.life = if passed { Life::Active(call.activation, build) } else { Life::SetupFailed };
                        }
                    }
                }
                (Expect::Command(a), Kind::Command) if call.activation == a => {
                    self.fault(Fault::Command, call)?;
                    match (call.panicked, command) {
                        (true, _) => self.life = Life::Failed(a),
                        (false, Some(Command::Dialog(dialog))) => self.dialog = Some((dialog, a)),
                        _ => {}
                    }
                }
                (Expect::Dispose(a), Kind::Dispose) if call.activation == a && !call.panicked => {
                    // A disposed activation gets no render after it.
                    if matches!(self.life, Life::Active(live, _) if live == a) {
                        self.life = Life::Disabled;
                    }
                }
                _ => return Err(format!("expected {next:?} while the plugin is {before:?}, got {call:?}")),
            }
        }
        if let Some(next) = expected.next() {
            return Err(format!("expected {next:?} while the plugin is {before:?}, got {calls:?}"));
        }
        // What a command leaves behind once its calls are in.
        match command {
            Some(Command::Toggle) if matches!(before, Life::Failed(_)) => self.life = Life::Disabled,
            Some(Command::Exit) => self.life = Life::Exited,
            _ => {}
        }
        Ok(())
    }

    /// Checks that `call` panicked exactly when `fault` was armed for it, and spends the fault.
    fn fault(&mut self, fault: Fault, call: &Call) -> Result<(), String> {
        let armed = self.armed == Some(fault);
        if armed {
            self.armed = None;
        }
        match armed == call.panicked {
            true => Ok(()),
            false => Err(format!("armed {:?}, got {call:?}", self.armed)),
        }
    }

    /// The activation that may still hold registrations.
    fn holder(&self) -> Option<u32> {
        match self.life {
            Life::Active(a, _) | Life::Failed(a) => Some(a),
            _ => None,
        }
    }
}

/// The new calls in the probe's log.
fn take_calls() -> Vec<Call> {
    LOG.with_borrow_mut(std::mem::take)
}

pub struct PluginModel;

impl Model for PluginModel {
    type Command = Command;

    fn generate(&self, rng: &mut Rng, steps: usize) -> Vec<Command> {
        (0..steps)
            .map(|_| match rng.below(100) {
                0..15 => Command::Toggle,
                15..25 => Command::Run,
                25..35 => Command::Dialog(*rng.pick(&[Dialog::Panel, Dialog::Prompt, Dialog::Select])),
                35..40 => Command::Enter,
                40..46 => Command::Escape,
                46..52 => Command::Frame,
                52..58 => Command::Home,
                58..64 => Command::Route,
                64..82 => Command::Reload(*rng.pick(&[1, 2, 3, BAD])),
                82..98 => Command::Arm(*rng.pick(&[Fault::Setup, Fault::Command, Fault::Render])),
                _ => Command::Exit,
            })
            .collect()
    }

    fn run(&self, commands: &[Command]) -> Option<Failure> {
        run(commands, std::env::var_os("MODEL_STRICT").is_some())
    }

    fn simplify(&self, command: &Command) -> Vec<Command> {
        match command {
            Command::Reload(build) if *build != 1 && *build != BAD => vec![Command::Reload(1)],
            Command::Dialog(Dialog::Panel) => vec![Command::Run],
            Command::Dialog(_) => vec![Command::Dialog(Dialog::Panel)],
            Command::Route => vec![Command::Home],
            _ => Vec::new(),
        }
    }
}

fn fail(property: &'static str, step: usize, detail: String) -> Option<Failure> {
    Some(Failure { property, step, detail })
}

/// Runs `commands` on the host and its twin, and checks the three properties after each. A `strict` run does not
/// step past the open defects.
fn run(commands: &[Command], strict: bool) -> Option<Failure> {
    LOG.take();
    ARMED.set(None);
    TOKENS.take();
    let mut world = World::open(Some(1));
    let mut twin = World::open(None);
    let mut reference = Reference::new(1, strict);
    if let Err(detail) = reference.step(None, false, &take_calls()) {
        return fail("lifecycle", 0, detail);
    }
    // The failure the last reload that changed the build left, which the loader does not report twice (as TS's
    // reconcile, `context.tsx`: "repeated reconciles stay silent").
    let mut told: Option<String> = None;
    for (step, &command) in commands.iter().enumerate() {
        let life = reference.life;
        let reload = matches!(command, Command::Reload(build) if build != reference.file);
        let before = reload.then(|| (world.observe(false), world.frame(), life, told.clone()));
        let reached = world.apply(command);
        let reports = world.settle();
        twin.apply(command);
        twin.settle();
        let calls = take_calls();
        if let Err(detail) = reference.step(Some(command), reached, &calls) {
            return fail("lifecycle", step, detail);
        }
        // The open finding `a-dialog-outlives-its-activation`: outside a strict run, the dialog of an activation that
        // is no longer active is closed here, as 4.14 asks of the host, so the search goes on past it.
        let stale = reference.dialog.is_some_and(|(_, a)| !matches!(reference.life, Life::Active(b, _) if b == a));
        if !strict && stale {
            world.harness.tui.dialogs.clear();
            world.settle();
            reference.dialog = None;
        }
        if let Some(detail) = ledger(&world, &twin, &reference) {
            return fail("ledger", step, detail);
        }
        if let Some(before) = before {
            if let Some(detail) = reload_fresh(&world, before, &reference, &calls, &reports) {
                return fail("reload-fresh", step, detail);
            }
            told = world.failure();
        }
    }
    None
}

/// `ledger`: no ended activation is held, and while the probe is not active the host equals the twin.
fn ledger(world: &World, twin: &World, reference: &Reference) -> Option<String> {
    let held: Vec<u32> = TOKENS.with_borrow(|tokens| {
        tokens
            .iter()
            .filter(|(a, token)| Some(*a) != reference.holder() && token.strong_count() > 0)
            .map(|(a, _)| *a)
            .collect()
    });
    if !held.is_empty() {
        return Some(format!(
            "activations {held:?} ended while the plugin is {:?}, and the host holds them",
            reference.life
        ));
    }
    if matches!(reference.life, Life::Active(..) | Life::Exited) {
        return None;
    }
    // A failed plugin is reported in the home footer, so its widgets and frame are not the twin's.
    let disabled = reference.life == Life::Disabled;
    if let Some(difference) = world.observe(disabled).diff(&twin.observe(disabled), disabled) {
        return Some(format!("the plugin is {:?}; host and twin: {difference}", reference.life));
    }
    if !disabled {
        return None;
    }
    frame_diff(&twin.frame(), &world.frame(), world.mask(), |_| false)
        .map(|row| format!("the plugin is disabled; the frames differ at {row}"))
}

/// `reload-fresh`: a reload that passed equals a fresh host with the new build on the same route; one that failed
/// equals the host before it, plus one report.
fn reload_fresh(
    world: &World,
    (observed, frame, life, told): (Observed, Capture, Life, Option<String>),
    reference: &Reference,
    calls: &[Call],
    reports: &[String],
) -> Option<String> {
    let failed = reports.iter().filter(|title| *title == &format!("Plugin failed: {ID}")).count();
    match (life, reference.life) {
        // A reload that passed: the fresh twin, with the log from its `setup` on.
        (_, Life::Active(a, build)) if Some(a) != life_activation(life) => {
            if failed != 0 {
                return Some(format!("a reload that passed reported {reports:?}"));
            }
            let log: Vec<Kind> = collapse(calls.iter().filter(|call| call.activation == a));
            let (ours, frame) = (world.observe(true), world.frame());
            let (theirs, fresh_frame, fresh_log) = fresh(build, world.harness.tui.route());
            if log != fresh_log {
                return Some(format!("the call log from setup on: host {log:?}, fresh {fresh_log:?}"));
            }
            if let Some(difference) = ours.diff(&theirs, true) {
                return Some(format!("after a reload to build {build}, host and fresh: {difference}"));
            }
            frame_diff(&fresh_frame, &frame, world.mask(), |_| false)
                .map(|row| format!("after a reload to build {build}, the frames differ at {row}"))
        }
        // A reload that failed while a build ran: that build, plus one report.
        (Life::Active(a, _), Life::Active(b, _)) if a == b && calls.iter().any(|call| call.kind == Kind::Setup) => {
            let failure = world.failure();
            let expected = usize::from(failure != told);
            if failure.as_deref().is_none_or(|failure| !failure.ends_with("(previous version still active)")) {
                return Some(format!("a failed reload left the status {failure:?}"));
            }
            if failed != expected {
                return Some(format!("a failed reload reported {reports:?}, after {told:?}"));
            }
            // The report adds the footer's count, so the widgets are not compared.
            if let Some(difference) = observed.diff(&world.observe(false), false) {
                return Some(format!("after a failed reload, before and after: {difference}"));
            }
            frame_diff(&frame, &world.frame(), world.mask(), |row| row.contains("plugin failed"))
                .map(|row| format!("after a failed reload, the frames differ at {row}"))
        }
        _ => None,
    }
}

/// What a fresh host observes: the ledger, the frame and the call log from `setup` on.
type Fresh = (Observed, Capture, Vec<Kind>);

thread_local! {
    /// What a fresh host on each build and route observes, which depends on nothing else.
    static FRESH: RefCell<Vec<((u8, String), Fresh)>> = const { RefCell::new(Vec::new()) };
}

/// What a fresh TUI with the probe's `build`, navigated to `route`, observes.
fn fresh(build: u8, route: Route) -> Fresh {
    let key = (build, format!("{route:?}"));
    if let Some(seen) =
        FRESH.with_borrow(|fresh| fresh.iter().find(|(known, _)| *known == key).map(|(_, seen)| seen.clone()))
    {
        return seen;
    }
    // The fresh host's calls, fault and token are its own, also as it is dropped.
    let (held, armed, tokens) = (LOG.take(), ARMED.take(), TOKENS.with_borrow(Vec::len));
    let world = World::open(Some(build));
    world.harness.tui.navigate(route);
    world.settle();
    let (observed, frame) = (world.observe(true), world.frame());
    let log: Vec<Kind> = collapse(LOG.take().iter());
    drop(world);
    LOG.set(held);
    ARMED.set(armed);
    TOKENS.with_borrow_mut(|all| all.truncate(tokens));
    let seen = (observed, frame, log);
    FRESH.with_borrow_mut(|fresh| fresh.push((key, seen.clone())));
    seen
}

fn life_activation(life: Life) -> Option<u32> {
    match life {
        Life::Active(a, _) | Life::Failed(a) => Some(a),
        _ => None,
    }
}

/// The kinds of `calls`, with each run of renders as one.
fn collapse<'a>(calls: impl Iterator<Item = &'a Call>) -> Vec<Kind> {
    let mut kinds: Vec<Kind> = Vec::new();
    for call in calls {
        if !(call.kind == Kind::Render && kinds.last() == Some(&Kind::Render)) {
            kinds.push(call.kind);
        }
    }
    kinds
}

/// Shrunk traces of defects the model found, each with the property it fails. Each must still fail in a strict run.
const OPEN: &[(&str, &str, &[Command])] = &[
    // A plugin's dialog (panel, prompt, select) stays open, with focus, after its plugin failed, was disabled or was
    // replaced by a reload. TS keeps a plugin's dialog on deactivation and reload too (`plugin-keymap.test.tsx`, "a
    // component layer ends with its activation on reload while the component stays mounted"); 4.14 revokes it.
    ("a-dialog-outlives-its-activation", "ledger", &[Command::Arm(Fault::Render), Command::Dialog(Dialog::Panel)]),
    ("a-dialog-outlives-its-activation", "ledger", &[Command::Dialog(Dialog::Panel), Command::Toggle]),
    ("a-dialog-outlives-its-activation", "ledger", &[Command::Dialog(Dialog::Prompt), Command::Toggle]),
    ("a-dialog-outlives-its-activation", "ledger", &[Command::Dialog(Dialog::Select), Command::Toggle]),
    ("a-dialog-outlives-its-activation", "reload-fresh", &[Command::Dialog(Dialog::Panel), Command::Reload(2)]),
    ("a-dialog-outlives-its-activation", "reload-fresh", &[Command::Dialog(Dialog::Prompt), Command::Reload(2)]),
    // A plugin that failed gets its dispose callbacks as it is disabled, replaced or the client exits: the C ABI's
    // `destroy` and the in-process `Scope::dispose` run them. 4.14: a failed plugin is called no more.
    ("a-failed-plugin-is-disposed", "lifecycle", &[Command::Arm(Fault::Command), Command::Run, Command::Toggle]),
    ("a-failed-plugin-is-disposed", "lifecycle", &[Command::Arm(Fault::Render), Command::Run, Command::Reload(2)]),
    ("a-failed-plugin-is-disposed", "lifecycle", &[Command::Arm(Fault::Command), Command::Run, Command::Exit]),
];

/// Shrunk traces that failed once and pass now.
const FIXED: &[(&str, &[Command])] = &[
    // Seed 34 of the first search: a second reload that fails with the same error is not told again, as in TS. The
    // oracle had asked for a report each time.
    (
        "a-repeated-reload-failure-is-told-once",
        &[Command::Arm(Fault::Setup), Command::Reload(3), Command::Arm(Fault::Setup), Command::Reload(2)],
    ),
    // Seed 319 of the deep run: a reload that failed while the plugin ran was not told when the last failure the
    // loader told had the same error without "(previous version still active)". TS compares what it lists and tells
    // it; the loader now does too.
    (
        "a-kept-reload-failure-is-told-after-a-setup-failure",
        &[
            Command::Arm(Fault::Render),
            Command::Home,
            Command::Reload(9),
            Command::Arm(Fault::Setup),
            Command::Reload(2),
            Command::Toggle,
            Command::Arm(Fault::Setup),
            Command::Reload(1),
        ],
    ),
];

// Expected (O-124, Pt): `lifecycle`, `ledger` and `reload-fresh` hold for 40 seeds of 64 commands. 4.14 asks for
// 256 seeds within about 3 s; a seed costs about 70 ms in a debug build (two TUIs stepped per command), so the seeds
// went down and the commands stayed. `MODEL_SEEDS` runs more.
#[test]
fn the_plugin_life_holds_its_properties() {
    model::check(&PluginModel, 40, 64);
}

#[test]
fn the_fixed_rows_pass_and_the_open_rows_still_fail() {
    // Outside a strict run, so a fixed row is not failed by an open one on its way.
    for (name, commands) in FIXED {
        assert_eq!(run(commands, false), None, "{name}");
    }
    for (name, property, commands) in OPEN {
        assert_eq!(run(commands, false), None, "{name}: outside a strict run");
        let failure = run(commands, true);
        assert_eq!(failure.as_ref().map(|failure| failure.property), Some(*property), "{name}: {failure:?}");
    }
}

// Expected: the oracles are not empty. While the probe is active the host differs from the twin, and a host on build
// 2 differs from a fresh one on build 3; the reference refuses a command call while the probe is disabled.
#[test]
fn the_oracles_can_fail() {
    LOG.take();
    let world = World::open(Some(1));
    let twin = World::open(None);
    assert_ne!(world.observe(true), twin.observe(true));
    assert!(frame_diff(&twin.frame(), &world.frame(), world.mask(), |_| false).is_some());
    let two = World::open(Some(2));
    let three = World::open(Some(3));
    assert!(frame_diff(&two.frame(), &three.frame(), two.mask(), |_| false).is_some());
    let mut reference = Reference::new(1, true);
    reference.life = Life::Disabled;
    let call = Call { activation: 1, build: 1, kind: Kind::Command, panicked: false };
    assert!(reference.step(Some(Command::Run), true, &[call]).is_err());
}
