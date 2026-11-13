//! The plugin model (O-124, phase Pt): the real TUI in a `TestApp` with one external plugin, `model.probe`, loaded by
//! the real `Loader` and driven through the C ABI's byte shims. The commands are what a user and a build can do to a
//! plugin today: toggle it in the plugin manager, run its commands, open, confirm and close its dialogs, navigate to
//! home and to its route, reload it with another build, arm a fault in its next `setup`, command or render, run a
//! command and a reload in one batch, and exit. The probe also acts after it registered: build 9 shows a toast and
//! asks for a prompt before its `setup` fails, build 3 asks for a prompt as it sets up, and every dispose callback asks
//! for one.
//!
//! The machines are in `steps/plugins-pt.md` (opendocs). After every command the host is checked against
//! [`Reference`], the plugin machine as code, which predicts from the commands alone what the probe gets, what the
//! host shows of it and what it reports; no expectation is read from the host:
//!
//! - `lifecycle`: the probe's own call log holds exactly the calls the reference expects, each with its command or
//!   surface; a command of the probe runs from the keymap exactly while it is active; after the run, dropping the TUI
//!   destroys an active instance once and a failed one not at all.
//! - `ledger`: the dialog on screen is the one the reference says is open, the manager lists the status it says, and
//!   no ended activation is held. While the probe is not active, the host equals a twin TUI that ran the same commands
//!   without it: commands, dialogs, focus and route, and the frame, which may differ only in the failure count.
//! - `reload-fresh`: after a reload that passed, the host is on the route the user chose and equals a fresh TUI that
//!   loaded the new build there, with the call log from `setup` on; after one that failed, it equals itself before.
//! - `reported-once`: the toasts are exactly the ones the reference expects: one per failure the manager did not list
//!   before, and the toasts the plugin asked for that may show.
//!
//! [`OPEN`] holds the shrunk traces of what the model found that is not fixed: each must still fail with its
//! property, so a fix fails the test until its row moves to [`FIXED`].

use crate::support::model::{self, Failure, Model, Rng};
use crate::support::{self, Harness};

use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::rc::{Rc, Weak};
use std::sync::Arc;
use std::time::Duration;

use opencode_plugin::loader::native::loopback_described;
use opencode_plugin::loader::{Backend, Loader, entry_file};
use opencode_plugin::{Definition, ErrorFn, Host, Status, abi};
use opencode_tui::plugins::host::host;
use opencode_tui::{Deps, Route};
use opentui::keymap::RunResult;
use opentui::prelude::*;
use opentui::testing::Capture;

const ID: &str = "model.probe";
/// The build whose `setup` shows a toast, asks for a prompt, and returns a failure.
const BAD: u8 = 9;
/// The build whose `setup` asks for its own prompt.
const PROMPTING: u8 = 3;
/// The report of a failure.
const FAILED: &str = "Plugin failed: model.probe";
/// The toast build 9 shows before its `setup` fails.
const BAD_TOAST: &str = "probe b9 setup";

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
    /// The command that opens that dialog, then a reload, with no frame between: the dialog's effect waits.
    DialogThenReload(Dialog, u8),
    /// A reload queued, then Enter on the open dialog: the confirmed action runs after the reload, in the same drain.
    EnterThenReload(u8),
    Exit,
}

/// Which of the probe's commands ran.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Which {
    Run,
    Panel,
    Prompt,
    Select,
}

/// Where the probe rendered.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Surface {
    Slot,
    Route,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Setup,
    Command(Which),
    Render(Surface),
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

/// The probe: a command that counts, a command for each of its dialogs, a replacement of `home.footer` and a route
/// that show the build and the count, and a dispose callback that asks for a prompt. Each logs its call, and panics
/// when its fault is armed. Build 9 shows a toast and asks for a prompt, then fails; build 3 asks for a prompt.
fn probe<const B: u8>(setup: &mut abi::Setup) -> Result<(), String> {
    let activation = ACTIVATIONS.with(|next| {
        next.set(next.get() + 1);
        next.get()
    });
    let token = Rc::new(());
    TOKENS.with_borrow_mut(|tokens| tokens.push((activation, Rc::downgrade(&token))));
    called(activation, B, Kind::Setup);
    if B == BAD {
        setup.host().toast(abi::Toast::new(abi::Variant::Info, BAD_TOAST));
        setup.host().dialog(prompt(B));
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
        called(activation, B, Kind::Command(Which::Run));
        counted.set(counted.get() + 1);
    });
    let held = token.clone();
    setup.command(command("probe.panel", "Probe panel"), move |host, _| {
        let _ = &held;
        called(activation, B, Kind::Command(Which::Panel));
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
    let held = token.clone();
    setup.command(command("probe.prompt", "Probe prompt"), move |host, _| {
        let _ = &held;
        called(activation, B, Kind::Command(Which::Prompt));
        host.dialog(prompt(B));
    });
    let held = token.clone();
    setup.command(command("probe.select", "Probe select"), move |host, _| {
        let _ = &held;
        called(activation, B, Kind::Command(Which::Select));
        host.dialog(abi::Dialog::Select(abi::Select {
            title: format!("Probe select b{B}"),
            placeholder: None,
            options: vec![abi::SelectOption::new("Probe option", "option")],
            current: None,
            action: confirmed(),
        }));
    });
    let (held, counted) = (token.clone(), count.clone());
    setup.slot(abi::Placement::new(abi::SlotKind::Replace, "home.footer"), move |_, _, _| {
        let _ = &held;
        called(activation, B, Kind::Render(Surface::Slot));
        abi::Render::Show(abi::Node::text([abi::Span::new(format!("probe b{B} n{}", counted.get()))]))
    });
    let held = token.clone();
    setup.route("probe", move |_, _| {
        let _ = &held;
        called(activation, B, Kind::Render(Surface::Route));
        abi::Render::Show(abi::Node::text([abi::Span::new(format!("probe route b{B} n{}", count.get()))]))
    });
    setup.on_dispose(move |host| {
        let _ = &token;
        called(activation, B, Kind::Dispose);
        host.dialog(abi::Dialog::Prompt {
            title: format!("Probe disposed b{B}"),
            placeholder: None,
            action: confirmed(),
        });
    });
    if B == PROMPTING {
        setup.host().dialog(prompt(B));
    }
    Ok(())
}

/// What a confirmed prompt or select runs.
fn confirmed() -> abi::Action {
    abi::Action::Command { name: "probe.run".to_owned(), input: None }
}

fn prompt(build: u8) -> abi::Dialog {
    abi::Dialog::Prompt { title: format!("Probe prompt b{build}"), placeholder: None, action: confirmed() }
}

/// Logs a call, then panics if its fault is armed; the fault is spent.
fn called(activation: u32, build: u8, kind: Kind) {
    let fault = match kind {
        Kind::Setup => Some(Fault::Setup),
        Kind::Command(_) => Some(Fault::Command),
        Kind::Render(_) => Some(Fault::Render),
        Kind::Dispose => None,
    };
    let panicked = fault.is_some() && ARMED.get() == fault;
    if panicked {
        ARMED.set(None);
    }
    LOG.with_borrow_mut(|log| log.push(Call { activation, build, kind, panicked }));
    if let (true, Some(fault)) = (panicked, fault) {
        panic!("probe {fault:?} fault");
    }
}

/// The probe's builds: the file holds the build's number.
struct Builds;

impl Backend for Builds {
    fn load(&self, host: &Rc<dyn Host>, library: &[u8], _: Option<&str>) -> Result<(Definition, ErrorFn), String> {
        match library {
            [1] => loopback_described(host, abi::export_plugin!(@loopback_described ID, probe::<1>)),
            [2] => loopback_described(host, abi::export_plugin!(@loopback_described ID, probe::<2>)),
            [PROMPTING] => loopback_described(host, abi::export_plugin!(@loopback_described ID, probe::<PROMPTING>)),
            [BAD] => loopback_described(host, abi::export_plugin!(@loopback_described ID, probe::<BAD>)),
            _ => Err("not a probe build".to_owned()),
        }
    }
}

/// A TUI on a route, with the probe's `build` in its plugins directory, or without the probe (the twin).
struct World {
    harness: Harness,
    probe: Option<(Rc<Loader>, std::path::PathBuf, opencode_util::temp::TempDir)>,
    exited: bool,
}

impl World {
    /// The TUI, not yet settled: the first [`World::settle`] drains what the load asked for.
    fn open(build: Option<u8>, route: Route) -> Self {
        let deps = Deps { route: Route::Home, ..support::deps(Arc::new(support::empty())) };
        let harness = support::mount(80, 24, deps);
        harness.tui.navigate(route);
        let probe = build.map(|build| {
            let root = opencode_util::temp::tempdir().unwrap();
            // The project root, so the loader looks for plugins in this directory and none above it.
            std::fs::create_dir(root.path().join(".git")).unwrap();
            let config = root.path().join("config");
            let dir = config.join("plugins").join("probe");
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(dir.join(entry_file()), [build]).unwrap();
            let loader = Rc::new(Loader::new(Rc::new(Builds), config, root.path().to_path_buf(), Vec::new()));
            loader.reconcile(&host(&harness.tui), &harness.tui.plugins);
            (loader, dir, root)
        });
        Self { harness, probe, exited: false }
    }

    /// Runs `command` as the user or a build would, without the frame after it. Returns, for a command of the probe,
    /// whether it ran from the keymap.
    fn apply(&mut self, command: Command) -> Option<bool> {
        let (app, tui) = (&self.harness.app, &self.harness.tui);
        if self.exited {
            app.advance(Duration::from_millis(16));
            return None;
        }
        match command {
            Command::Toggle => {
                // What the plugin manager's action does (`dialogs/plugins.rs`, `Manager::toggle`); its toast of a
                // failed enable is `a_failed_enable_shows_its_error_and_keeps_the_row`'s.
                let active = tui.plugins.entries().iter().any(|entry| entry.id == ID && entry.active);
                if tui.plugins.toggle(&host(tui), ID, !active).is_some() {
                    tui.navigate(tui.route());
                }
            }
            Command::Run => return Some(matches!(tui.keymap.dispatch("probe.run", None), RunResult::Ok)),
            Command::Dialog(dialog) => {
                let name = format!("probe.{}", format!("{dialog:?}").to_lowercase());
                return Some(matches!(tui.keymap.dispatch(&name, None), RunResult::Ok));
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
            // An event drains what it queued, so the reload is queued first: the confirmed action waits behind it.
            Command::EnterThenReload(build) => {
                if let Some((loader, dir, _)) = &self.probe {
                    std::fs::write(dir.join(entry_file()), [build]).unwrap();
                    let (loader, tui) = (loader.clone(), tui.clone());
                    app.app().defer(move |_| {
                        loader.reconcile(&host(&tui), &tui.plugins);
                    });
                }
                app.press("enter");
            }
            Command::DialogThenReload(..) => unreachable!("run splits a batch"),
            Command::Exit => {
                tui.plugins.deactivate_all();
                self.exited = true;
            }
        }
        None
    }

    /// Runs what the commands queued, and drains the toasts; returns their titles, or their messages.
    fn settle(&self) -> Vec<String> {
        let (app, tui) = (&self.harness.app, &self.harness.tui);
        // A failure a frame reports shows once what the frame queued has run.
        app.advance(Duration::from_millis(1));
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

    /// The probe's row, as the plugin manager lists it.
    fn status(&self) -> Option<Status> {
        self.harness.tui.plugins.entries().into_iter().find(|entry| entry.id == ID).map(|entry| entry.status)
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
    (0..a.height.max(b.height)).find_map(|y| {
        let differs = (0..a.width.max(b.width)).any(|x| !masked(x, y) && a.cell(x, y) != b.cell(x, y));
        (differs && !allowed(&row(b, y))).then(|| format!("row {y}:\n  {:?}\n  {:?}", row(a, y), row(b, y)))
    })
}

fn row(frame: &Capture, y: u32) -> String {
    (0..frame.width).filter_map(|x| frame.cell(x, y)).map(|cell| cell.symbol.as_str()).collect()
}

/// The plugin machine of `steps/plugins-pt.md` as code.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Life {
    Active(u32, u8),
    Failed(u32),
    /// Enabled, and its last `setup` failed.
    SetupFailed,
    Disabled,
    Exited,
}

/// The page the user chose.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Page {
    Home,
    Probe,
}

impl Page {
    fn route(self) -> Route {
        match self {
            Page::Home => Route::Home,
            Page::Probe => Route::Plugin { id: ID.to_owned(), name: "probe".to_owned() },
        }
    }
}

/// A call the reference expects, other than a render.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Expect {
    Setup(u8),
    Command(Which, u32),
    Dispose(u32),
    /// The action of a prompt or select of that activation, which reaches it only if it is still active.
    Confirm(u32),
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
    /// The activations that failed. The host keeps their instances, as it keeps a failed plugin's library (4.5): the
    /// C ABI's `destroy` would run their dispose callbacks.
    failed: Vec<u32>,
    /// The probe's dialog on screen: its kind, and the activation and build that opened it.
    dialog: Option<(Dialog, u32, u8)>,
    /// A confirmed prompt or select whose action waits for the frame.
    confirm: Option<u32>,
    page: Page,
    /// The failure the plugin manager lists.
    listed: Option<String>,
    /// The toast on screen at the next frame, if any.
    reports: Vec<String>,
}

impl Reference {
    fn new(build: u8) -> Self {
        Self {
            life: Life::Disabled,
            build,
            file: build,
            armed: None,
            last: 0,
            failed: Vec::new(),
            dialog: None,
            confirm: None,
            page: Page::Home,
            listed: None,
            reports: Vec::new(),
        }
    }

    fn active(&self) -> Option<u32> {
        match self.life {
            Life::Active(a, _) => Some(a),
            _ => None,
        }
    }

    /// Checks the calls the probe logged while `command` ran, and moves the machine. `reached` says whether a command
    /// of the probe ran from the keymap; `settled` that the frame after it ran, so a waiting action did too.
    fn step(
        &mut self,
        command: Option<Command>,
        reached: Option<bool>,
        settled: bool,
        calls: &[Call],
    ) -> Result<(), String> {
        if self.life == Life::Exited {
            return match calls {
                [] => Ok(()),
                _ => Err(format!("a call after the exit started: {calls:?}")),
            };
        }
        // The confirm comes first; its action waits behind the reload.
        let command = match command {
            Some(Command::EnterThenReload(build)) => {
                self.enter();
                Some(Command::Reload(build))
            }
            command => command,
        };
        let (before, listed) = (self.life, self.listed.clone());
        let mut expected: VecDeque<Expect> = VecDeque::new();
        match command {
            // The first load: the plugin is enabled.
            None => expected.push_back(Expect::Setup(self.build)),
            Some(Command::Toggle) => match self.life {
                Life::Active(a, _) => expected.push_back(Expect::Dispose(a)),
                Life::Failed(_) => {}
                Life::Disabled | Life::SetupFailed => expected.push_back(Expect::Setup(self.build)),
                Life::Exited => unreachable!(),
            },
            Some(Command::Run | Command::Dialog(_)) => {
                let which = match command {
                    Some(Command::Dialog(Dialog::Panel)) => Which::Panel,
                    Some(Command::Dialog(Dialog::Prompt)) => Which::Prompt,
                    Some(Command::Dialog(Dialog::Select)) => Which::Select,
                    _ => Which::Run,
                };
                // A command of the probe runs from the keymap exactly while the probe is active.
                if reached != Some(self.active().is_some()) {
                    return Err(format!(
                        "{which:?} ran from the keymap: {reached:?}, while the plugin is {:?}",
                        self.life
                    ));
                }
                if let Some(a) = self.active() {
                    expected.push_back(Expect::Command(which, a));
                }
            }
            Some(Command::Escape) => self.dialog = None,
            // A confirmed prompt or select runs `probe.run` once the frame comes. The panel has no action and stays.
            Some(Command::Enter) => self.enter(),
            Some(Command::Home) => self.page = Page::Home,
            Some(Command::Route) => self.page = Page::Probe,
            Some(Command::Reload(build)) if build != self.file => {
                self.file = build;
                match self.life {
                    Life::Active(..) | Life::Failed(_) | Life::SetupFailed => expected.push_back(Expect::Setup(build)),
                    Life::Disabled => (self.build, self.listed) = (build, None),
                    Life::Exited => unreachable!(),
                }
            }
            Some(Command::Arm(fault)) => self.armed = Some(fault),
            Some(Command::Exit) => {
                if let Some(a) = self.active() {
                    expected.push_back(Expect::Dispose(a));
                }
            }
            Some(_) => {}
        }
        if settled && let Some(a) = self.confirm.take() {
            expected.push_back(Expect::Confirm(a));
        }
        for call in calls {
            if let Kind::Render(surface) = call.kind {
                if self.active() != Some(call.activation) {
                    return Err(format!("a render while the plugin is {:?}: {call:?}", self.life));
                }
                self.fault(Fault::Render, call)?;
                if call.panicked {
                    let export = if surface == Surface::Slot { "render-slot" } else { "render-route" };
                    self.fail(call.activation, export, Fault::Render);
                }
                continue;
            }
            // A waiting action of an activation that ended reaches nothing.
            while let Some(Expect::Confirm(a)) = expected.front()
                && self.active() != Some(*a)
            {
                expected.pop_front();
            }
            let Some(next) = expected.pop_front() else {
                return Err(format!("an unexpected call while the plugin is {:?}: {call:?}", self.life));
            };
            match (next, call.kind) {
                (Expect::Setup(build), Kind::Setup) if call.build == build && call.activation > self.last => {
                    self.last = call.activation;
                    self.fault(Fault::Setup, call)?;
                    if !call.panicked && build == BAD {
                        self.report(BAD_TOAST);
                    }
                    let passed = !call.panicked && build != BAD;
                    let error = if call.panicked {
                        "setup panicked: probe Setup fault".to_owned()
                    } else {
                        format!("probe build {build} fails its setup")
                    };
                    match (before, command) {
                        (Life::Active(old, _), Some(Command::Reload(_))) if passed => {
                            (self.life, self.build, self.listed) = (Life::Active(call.activation, build), build, None);
                            expected.push_front(Expect::Dispose(old));
                        }
                        // A candidate that fails leaves the running build, which the manager lists with the error.
                        (Life::Active(..), Some(Command::Reload(_))) => {
                            self.listed = Some(format!("{error} (previous version still active)"))
                        }
                        // The manager's enable that fails leaves the plugin as it was (TS `plugins.tsx`).
                        (_, Some(Command::Toggle)) if !passed => {}
                        _ => {
                            self.build = build;
                            (self.life, self.listed) = match passed {
                                true => (Life::Active(call.activation, build), None),
                                false => (Life::SetupFailed, Some(error)),
                            };
                        }
                    }
                    if passed && build == PROMPTING {
                        self.dialog = Some((Dialog::Prompt, call.activation, build));
                    }
                    // A load tells a failure the manager did not list before it (TS `context.tsx`).
                    let load = matches!(command, None | Some(Command::Reload(_)));
                    if load && self.listed.is_some() && self.listed != listed {
                        self.report(FAILED);
                    }
                }
                (Expect::Command(which, a), Kind::Command(ran)) if call.activation == a && ran == which => {
                    self.fault(Fault::Command, call)?;
                    match (call.panicked, command) {
                        (true, _) => self.fail(a, "run-command", Fault::Command),
                        (false, Some(Command::Dialog(dialog))) => self.dialog = Some((dialog, a, self.build)),
                        _ => {}
                    }
                }
                (Expect::Confirm(a), Kind::Command(Which::Run)) if call.activation == a => {
                    self.fault(Fault::Command, call)?;
                    if call.panicked {
                        self.fail(a, "run-command", Fault::Command);
                    }
                }
                (Expect::Dispose(a), Kind::Dispose) if call.activation == a && !call.panicked => {
                    // A disposed activation gets no render after it.
                    if self.active() == Some(a) {
                        self.life = Life::Disabled;
                    }
                }
                _ => return Err(format!("expected {next:?} while the plugin is {before:?}, got {call:?}")),
            }
        }
        expected.retain(|next| !matches!(next, Expect::Confirm(a) if self.active() != Some(*a)));
        if let Some(next) = expected.front() {
            return Err(format!("expected {next:?} while the plugin is {before:?}, got {calls:?}"));
        }
        // What a command leaves behind once its calls are in.
        match command {
            Some(Command::Toggle) if matches!(before, Life::Active(..) | Life::Failed(_)) => {
                (self.life, self.listed) = (Life::Disabled, None)
            }
            Some(Command::Exit) => self.life = Life::Exited,
            _ => {}
        }
        // A dialog ends with the activation that opened it (4.14; deviation F16-plugin-dialog-ends-with-activation).
        if self.dialog.is_some_and(|(_, a, _)| self.active() != Some(a)) {
            self.dialog = None;
        }
        Ok(())
    }

    /// Enter on the dialog on screen: a confirmed prompt or select runs `probe.run` once the frame comes. The panel has
    /// no action and stays.
    fn enter(&mut self) {
        match self.dialog.take() {
            Some((Dialog::Panel, a, build)) => self.dialog = Some((Dialog::Panel, a, build)),
            Some((_, a, _)) => self.confirm = Some(a),
            None => {}
        }
    }

    /// Shows a toast. With none paused or queued, a toast replaces the one on screen (`opencode_ui::toast`), so the
    /// frame shows the last; a failure is reported after what the failing call asked for.
    fn report(&mut self, toast: &str) {
        self.reports = vec![toast.to_owned()];
    }

    /// A call of activation `a` panicked: it fails, the manager lists it, and the host reports it.
    fn fail(&mut self, a: u32, export: &str, fault: Fault) {
        self.life = Life::Failed(a);
        self.failed.push(a);
        self.listed = Some(format!("{export} panicked: probe {fault:?} fault"));
        self.report(FAILED);
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

    /// Whether the host may hold activation `a`: it is active, or it failed and its instance is kept.
    fn holds(&self, a: u32) -> bool {
        self.active() == Some(a) || self.failed.contains(&a)
    }

    /// The probe's row in the plugin manager.
    fn status(&self) -> Option<Status> {
        let failed = self.listed.clone().map(Status::Failed);
        match self.life {
            Life::Active(..) | Life::Failed(_) => Some(failed.unwrap_or(Status::Active)),
            Life::SetupFailed | Life::Disabled => Some(failed.unwrap_or(Status::Inactive)),
            Life::Exited => None,
        }
    }

    /// The text of the dialog the reference says is open.
    fn dialog_text(&self) -> Option<String> {
        self.dialog.map(|(dialog, _, build)| match dialog {
            Dialog::Panel => format!("probe panel b{build}"),
            Dialog::Prompt => format!("Probe prompt b{build}"),
            Dialog::Select => format!("Probe select b{build}"),
        })
    }
}

/// The new calls in the probe's log.
fn take_calls() -> Vec<Call> {
    LOG.with_borrow_mut(std::mem::take)
}

pub struct PluginModel;

/// One command of the generator, without the exit.
fn pick(rng: &mut Rng) -> Command {
    let dialog = |rng: &mut Rng| *rng.pick(&[Dialog::Panel, Dialog::Prompt, Dialog::Select]);
    let build = |rng: &mut Rng| *rng.pick(&[1, 2, PROMPTING, BAD]);
    match rng.below(100) {
        0..14 => Command::Toggle,
        14..23 => Command::Run,
        23..33 => Command::Dialog(dialog(rng)),
        33..38 => Command::Enter,
        38..43 => Command::Escape,
        43..48 => Command::Frame,
        48..53 => Command::Home,
        53..59 => Command::Route,
        59..76 => Command::Reload(build(rng)),
        76..92 => Command::Arm(*rng.pick(&[Fault::Setup, Fault::Command, Fault::Render])),
        92..96 => Command::DialogThenReload(dialog(rng), build(rng)),
        _ => Command::EnterThenReload(build(rng)),
    }
}

impl Model for PluginModel {
    type Command = Command;

    /// `steps` commands; half the seeds end with the exit and one frame after it.
    fn generate(&self, rng: &mut Rng, steps: usize) -> Vec<Command> {
        let mut commands: Vec<Command> = (0..steps.saturating_sub(2)).map(|_| pick(rng)).collect();
        match rng.below(2) {
            0 => commands.extend([Command::Exit, Command::Frame]),
            _ => commands.extend([pick(rng), pick(rng)]),
        }
        commands
    }

    fn run(&self, commands: &[Command]) -> Option<Failure> {
        run(commands)
    }

    fn simplify(&self, command: &Command) -> Vec<Command> {
        match *command {
            Command::Reload(build) if build != 1 && build != BAD => vec![Command::Reload(1)],
            Command::Dialog(Dialog::Panel) => vec![Command::Run],
            Command::Dialog(_) => vec![Command::Dialog(Dialog::Panel)],
            Command::Route => vec![Command::Home],
            Command::DialogThenReload(dialog, build) => vec![Command::Dialog(dialog), Command::Reload(build)],
            Command::EnterThenReload(build) => vec![Command::Enter, Command::Reload(build)],
            _ => Vec::new(),
        }
    }
}

/// A failure of `property` at check site `site`, unless `MODEL_SKIP` turns the property off.
fn check(property: &'static str, site: &'static str, step: usize, detail: Option<String>) -> Option<Failure> {
    let detail = detail?;
    (!model::skipped(property)).then_some(Failure { property, site, step, detail })
}

/// Runs `commands` on the host and its twin, and checks the properties after each. A batch runs its two commands
/// with no frame between, and is checked once after both.
fn run(commands: &[Command]) -> Option<Failure> {
    LOG.take();
    ARMED.set(None);
    TOKENS.take();
    let mut world = World::open(Some(1), Route::Home);
    let mut twin = World::open(None, Route::Home);
    let mut reference = Reference::new(1);
    let reports = world.settle();
    twin.settle();
    let first = reference.step(None, None, true, &take_calls()).err();
    if let Some(failure) = check("lifecycle", "calls", 0, first) {
        return Some(failure);
    }
    if let Some(failure) = check("reported-once", "reports", 0, reported(&mut reference, reports)) {
        return Some(failure);
    }
    for (step, &command) in commands.iter().enumerate() {
        let parts = match command {
            Command::DialogThenReload(dialog, build) => vec![Command::Dialog(dialog), Command::Reload(build)],
            command => vec![command],
        };
        let (life, last) = (reference.life, parts.len() - 1);
        let reload = parts.iter().any(
            |part| matches!(part, Command::Reload(build) | Command::EnterThenReload(build) if *build != reference.file),
        );
        let before = reload.then(|| (world.observe(false), world.frame(), life));
        let (mut calls, mut reports) = (Vec::new(), Vec::new());
        for (index, &part) in parts.iter().enumerate() {
            let reached = world.apply(part);
            twin.apply(part);
            if index == last {
                reports = world.settle();
                twin.settle();
            }
            let logged = take_calls();
            let stepped = reference.step(Some(part), reached, index == last, &logged).err();
            if let Some(failure) = check("lifecycle", "calls", step, stepped) {
                return Some(failure);
            }
            calls.extend(logged);
        }
        if let Some(failure) = check("reported-once", "reports", step, reported(&mut reference, reports)) {
            return Some(failure);
        }
        for (site, detail) in ledger(&world, &twin, &reference) {
            if let Some(failure) = check("ledger", site, step, Some(detail)) {
                return Some(failure);
            }
        }
        if let Some(before) = before
            && let Some((site, detail)) = reload_fresh(&world, before, &reference, &calls)
            && let Some(failure) = check("reload-fresh", site, step, Some(detail))
        {
            return Some(failure);
        }
    }
    // Dropping the TUI releases the plugin: an active instance is destroyed once, a failed one not at all.
    take_calls();
    let expected: Vec<Kind> = reference.active().filter(|_| !world.exited).map(|_| Kind::Dispose).into_iter().collect();
    // An open dialog's stack holds the app, and so the TUI, past the drop: the dialogs close first, as at an exit.
    world.harness.tui.dialogs.clear();
    drop(world);
    let dropped: Vec<Kind> = take_calls().iter().map(|call| call.kind).collect();
    let detail = (dropped != expected).then(|| format!("dropped while {:?}: {dropped:?}", reference.life));
    check("lifecycle", "drop", commands.len(), detail)
}

/// `reported-once`: the toasts of a frame, against the ones the reference expects, in any order.
fn reported(reference: &mut Reference, mut reports: Vec<String>) -> Option<String> {
    let mut expected = std::mem::take(&mut reference.reports);
    reports.sort();
    expected.sort();
    (reports != expected).then(|| format!("reported {reports:?}, expected {expected:?}"))
}

/// `ledger`: the dialog and the row are the reference's, no ended activation is held, and while the probe is not active
/// the host equals the twin. Each difference with its check site.
fn ledger(world: &World, twin: &World, reference: &Reference) -> Vec<(&'static str, String)> {
    let mut differences = Vec::new();
    if world.exited {
        return differences;
    }
    let held: Vec<u32> = TOKENS.with_borrow(|tokens| {
        tokens.iter().filter(|(a, token)| !reference.holds(*a) && token.strong_count() > 0).map(|(a, _)| *a).collect()
    });
    if !held.is_empty() {
        differences.push(("token", format!("activations {held:?} ended while the plugin is {:?}", reference.life)));
    }
    let (open, screen) = (world.harness.tui.dialogs.is_open(), world.frame());
    let text = (0..screen.height).map(|y| row(&screen, y)).collect::<Vec<_>>().join("\n");
    let shown = match reference.dialog_text() {
        Some(expected) => open && text.contains(&expected),
        None => !open,
    };
    if !shown {
        let expected = reference.dialog_text();
        differences.push(("dialog", format!("expected the dialog {expected:?}, the host shows {open}:\n{text}")));
    }
    if world.status() != reference.status() {
        let (status, expected) = (world.status(), reference.status());
        differences.push(("row", format!("the manager lists {status:?}, expected {expected:?}")));
    }
    if !differences.is_empty() || reference.active().is_some() {
        return differences;
    }
    // A failure the manager lists shows as a count in the home footer, so the widgets differ and the frame may differ
    // in that row only.
    let listed = reference.listed.is_some();
    if let Some(difference) = world.observe(!listed).diff(&twin.observe(!listed), !listed) {
        differences.push(("twin", format!("the plugin is {:?}; host and twin: {difference}", reference.life)));
        return differences;
    }
    let allowed = |row: &str| listed && row.contains("plugin failed");
    if let Some(row) = frame_diff(&twin.frame(), &world.frame(), world.mask(), allowed) {
        differences.push(("frame", format!("the plugin is {:?}; the frames differ at {row}", reference.life)));
    }
    differences
}

/// `reload-fresh`: a reload that passed leaves the user's route and equals a fresh host with the new build there; one
/// that failed while a build ran equals the host before it, but for the failure it lists.
fn reload_fresh(
    world: &World,
    (observed, frame, life): (Observed, Capture, Life),
    reference: &Reference,
    calls: &[Call],
) -> Option<(&'static str, String)> {
    match (life, reference.life) {
        // A reload that passed: the fresh twin, with the log from its `setup` on.
        (_, Life::Active(a, build)) if Some(a) != life_activation(life) => {
            let route = reference.page.route();
            if world.harness.tui.route() != route {
                return Some(("route", format!("after a reload the route is {:?}", world.harness.tui.route())));
            }
            let log: Vec<Kind> = collapse(calls.iter().filter(|call| call.activation == a));
            let (ours, frame) = (world.observe(true), world.frame());
            let (theirs, fresh_frame, fresh_log) = fresh(build, route);
            if log != fresh_log {
                return Some(("log", format!("the call log from setup on: host {log:?}, fresh {fresh_log:?}")));
            }
            if let Some(difference) = ours.diff(&theirs, true) {
                return Some(("fresh", format!("after a reload to build {build}, host and fresh: {difference}")));
            }
            frame_diff(&fresh_frame, &frame, world.mask(), |_| false)
                .map(|row| ("frame", format!("after a reload to build {build}, the frames differ at {row}")))
        }
        // A reload that failed while a build ran: that build, and the failure it lists.
        (Life::Active(a, _), Life::Active(b, _)) if a == b && calls.iter().any(|call| call.kind == Kind::Setup) => {
            if let Some(difference) = observed.diff(&world.observe(false), false) {
                return Some(("kept", format!("after a failed reload, before and after: {difference}")));
            }
            frame_diff(&frame, &world.frame(), world.mask(), |row| row.contains("plugin failed"))
                .map(|row| ("frame", format!("after a failed reload, the frames differ at {row}")))
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
    let world = World::open(Some(build), route);
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

/// The kinds of `calls`, with each run of renders of one surface as one.
fn collapse<'a>(calls: impl Iterator<Item = &'a Call>) -> Vec<Kind> {
    let mut kinds: Vec<Kind> = Vec::new();
    for call in calls {
        if !(matches!(call.kind, Kind::Render(_)) && kinds.last() == Some(&call.kind)) {
            kinds.push(call.kind);
        }
    }
    kinds
}

/// Shrunk traces of defects the model found and that are not fixed, each with the property it fails. Each must still
/// fail, so a fix fails the test until its row moves to [`FIXED`].
const OPEN: &[(&str, &str, &[Command])] = &[
    // Review bigboi-1: a failed plugin's replacement of `home.footer` still wins the slot and hides the footer.
    ("a-failed-slot-replacement-gives-the-slot-back", "lifecycle", &[Command::Arm(Fault::Command), Command::Run]),
    // Review bigboi-5: a failure is told again once the manager stopped listing it.
    (
        "a-failure-is-told-again-after-the-row-cleared",
        "reported-once",
        &[
            Command::Arm(Fault::Setup),
            Command::Reload(2),
            Command::Toggle,
            Command::Toggle,
            Command::Arm(Fault::Setup),
            Command::Reload(PROMPTING),
        ],
    ),
    // Review carbon-pt-2: an enable that failed leaves the plugin enabled, so a reload starts it.
    (
        "a-failed-enable-leaves-the-plugin-disabled",
        "lifecycle",
        &[Command::Toggle, Command::Arm(Fault::Setup), Command::Toggle, Command::Reload(2)],
    ),
    // Review bigboi-6: dropping the TUI destroys a failed instance, which runs its dispose callback.
    (
        "a-failed-plugin-is-not-disposed-when-dropped",
        "lifecycle",
        &[Command::Route, Command::Arm(Fault::Command), Command::Run],
    ),
];

/// Shrunk traces that failed once and pass now.
const FIXED: &[(&str, &[Command])] = &[
    // Seed 34 of the first search: a second reload that fails with the same error is not told again, as in TS.
    (
        "a-repeated-reload-failure-is-told-once",
        &[Command::Arm(Fault::Setup), Command::Reload(3), Command::Arm(Fault::Setup), Command::Reload(2)],
    ),
    // Seed 319 of the deep run: a reload that failed while the plugin ran is told after a setup failure with the same
    // error without "(previous version still active)".
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
    // A plugin's dialog ends with its activation: after a failure, a disable or a reload, and a stale prompt or select
    // runs no new build's command.
    ("a-dialog-ends-with-a-failure", &[Command::Arm(Fault::Render), Command::Dialog(Dialog::Panel)]),
    ("a-dialog-ends-with-a-disable", &[Command::Dialog(Dialog::Panel), Command::Toggle]),
    ("a-prompt-ends-with-a-disable", &[Command::Dialog(Dialog::Prompt), Command::Toggle]),
    ("a-select-ends-with-a-disable", &[Command::Dialog(Dialog::Select), Command::Toggle]),
    ("a-dialog-ends-with-a-reload", &[Command::Dialog(Dialog::Panel), Command::Reload(2)]),
    ("a-stale-prompt-reaches-no-new-build", &[Command::Dialog(Dialog::Prompt), Command::Reload(2), Command::Enter]),
    ("a-stale-select-reaches-no-new-build", &[Command::Dialog(Dialog::Select), Command::Reload(2), Command::Enter]),
    // A failed plugin gets no dispose callback as it is disabled, replaced, or the client exits.
    ("a-failed-plugin-is-not-disposed-on-disable", &[Command::Arm(Fault::Command), Command::Run, Command::Toggle]),
    ("a-failed-plugin-is-not-disposed-on-reload", &[Command::Arm(Fault::Render), Command::Run, Command::Reload(2)]),
    ("a-failed-plugin-is-not-disposed-on-exit", &[Command::Arm(Fault::Command), Command::Run, Command::Exit]),
    // Review bigboi-4: a reload on the plugin's route leaves the user there, on the new build's route.
    ("a-reload-keeps-the-plugin-route", &[Command::Route, Command::Reload(2)]),
    // Reviews bigboi-2 and carbon-pt-1: a dialog an activation that ended or a setup that failed asks for shows nowhere,
    // and the failure of a candidate is reported after the toast its setup asked for.
    ("a-dispose-opens-no-dialog-on-a-reload", &[Command::Reload(2)]),
    ("a-dispose-opens-no-dialog-on-a-disable", &[Command::Toggle]),
    ("a-failed-candidate-keeps-the-running-dialog", &[Command::Dialog(Dialog::Panel), Command::Reload(BAD)]),
    ("a-failed-setup-opens-no-dialog", &[Command::Toggle, Command::Reload(BAD), Command::Toggle]),
    ("a-dialog-asked-for-before-a-reload-opens-no-dialog", &[Command::DialogThenReload(Dialog::Prompt, 2)]),
    // Review carbon-pt-1: the action of a prompt confirmed as a reload is queued reaches no new build.
    ("a-confirm-before-a-reload-reaches-no-new-build", &[Command::Dialog(Dialog::Prompt), Command::EnterThenReload(2)]),
    // Review carbon-pt-3: a reload that fails after a panic does not wedge the plugin, and enabling it sets it up.
    (
        "a-failed-reload-of-a-failed-plugin-can-be-enabled",
        &[Command::Arm(Fault::Command), Command::Run, Command::Reload(BAD), Command::Toggle],
    ),
    // Review bigboi-2, the positive control: a candidate that passes keeps the prompt its setup asked for.
    ("a-passed-candidates-prompt-shows", &[Command::Dialog(Dialog::Panel), Command::Reload(PROMPTING)]),
];

// Expected (O-124, Pt): every property holds for 40 seeds of 64 commands. 4.14 asks for 256 seeds within about 3 s; a
// seed costs about 70 ms in a debug build (two TUIs stepped per command), so the seeds went down and the commands
// stayed. `MODEL_SEEDS` runs more.
#[test]
fn the_plugin_life_holds_its_properties() {
    model::check(&PluginModel, 40, 64);
}

#[test]
fn the_fixed_rows_pass_and_the_open_rows_still_fail() {
    for (name, commands) in FIXED {
        assert_eq!(run(commands), None, "{name}");
    }
    for (name, property, commands) in OPEN {
        let failure = run(commands);
        assert_eq!(failure.as_ref().map(|failure| failure.property), Some(*property), "{name}: {failure:?}");
    }
}

/// Toggles the probe in the real plugin manager; returns what it reported.
fn manager_toggle(world: &World) -> Vec<String> {
    let (app, tui) = (&world.harness.app, &world.harness.tui);
    tui.keymap.dispatch("plugins.list", None);
    world.settle();
    app.type_text("probe");
    world.settle();
    app.press("enter");
    let reports = world.settle();
    app.press("escape");
    world.settle();
    reports
}

// Expected (TS `plugins.tsx`): an enable in the plugin manager whose setup fails shows the setup's error and keeps the
// row as the last load listed it; it does not list the plugin failed.
#[test]
fn a_failed_enable_shows_its_error_and_keeps_the_row() {
    LOG.take();
    let world = World::open(Some(1), Route::Home);
    world.settle();
    assert_eq!(manager_toggle(&world), Vec::<String>::new());
    ARMED.set(Some(Fault::Setup));
    assert_eq!(manager_toggle(&world), ["setup panicked: probe Setup fault"]);
    assert_eq!(world.status(), Some(Status::Inactive));
    ARMED.set(None);
}

// Expected: the oracles are not empty. While the probe is active the host differs from the twin, and a host on build
// 2 differs from a fresh one on build 3; the reference refuses a command that did not run while the probe is active,
// and one that ran while it is disabled.
#[test]
fn the_oracles_can_fail() {
    LOG.take();
    let world = World::open(Some(1), Route::Home);
    let twin = World::open(None, Route::Home);
    world.settle();
    twin.settle();
    assert_ne!(world.observe(true), twin.observe(true));
    assert!(frame_diff(&twin.frame(), &world.frame(), world.mask(), |_| false).is_some());
    let two = World::open(Some(2), Route::Home);
    let three = World::open(Some(3), Route::Home);
    two.settle();
    three.settle();
    assert!(frame_diff(&two.frame(), &three.frame(), two.mask(), |_| false).is_some());
    let mut reference = Reference::new(1);
    reference.life = Life::Active(1, 1);
    assert!(reference.step(Some(Command::Run), Some(false), true, &[]).is_err());
    reference.life = Life::Disabled;
    let call = Call { activation: 1, build: 1, kind: Kind::Command(Which::Run), panicked: false };
    assert!(reference.step(Some(Command::Run), Some(true), true, &[call]).is_err());
}

// Expected: a property that `MODEL_SKIP` turns off does not fail, and the others still do.
#[test]
fn a_skipped_property_is_checked_no_more() {
    assert!(check("lifecycle", "calls", 0, None).is_none());
    let failure = check("lifecycle", "calls", 3, Some("wrong".to_owned()));
    assert_eq!(failure.map(|failure| (failure.site, failure.step)), Some(("calls", 3)));
}
