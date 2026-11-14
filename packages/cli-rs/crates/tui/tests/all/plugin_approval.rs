//! The approval model (O-124, phase Pa; rich-plugins 3.9 and 4.14): the plugin model's probe, found in the project's
//! `.opencode/plugins` instead of the global directory, so it runs only once the user approved its build. The
//! commands are what a user and a build can do to it: open the question in the real plugin manager and answer it
//! (approve, decline, or close it) as separate steps, so the library can be replaced while it is open; replace the
//! library, also with a build whose setup fails; toggle it, run its command, navigate, and start the client again on the
//! same state.
//!
//! Checked after every command, each with an oracle that shares no code with the host:
//!
//! - `pending` ("a `pending` plugin equals no plugin", 4.14's row Pa): while the probe is not approved, or does not
//!   run, the host equals a twin TUI that never had it: the reachable commands, the dialogs, focus, the widgets, the
//!   route and the frame. While it is not approved, the backend opened no build since the run began or the probe last
//!   ran, no registry holds its ID, and no activation's token is held.
//! - `lifecycle`: the probe's own call log holds exactly the setups, disposes and commands that [`Gate`], the approval
//!   machine as code, expects.
//! - `asked`: the manager lists the probe as [`Gate`] does, and the reports of the step are exactly the ones `Gate`
//!   expects: a question for each build held back, a failure for a failing build that loads, a setup error and the
//!   setup's toast for an enable that fails, and a notice when an answer named a build that changed.

use crate::plugin_model::{BAD_TOAST, Call, Kind, LOADS, LOG, PROMPTING, TOKENS, Which, World, frame_diff, take_calls};
use crate::support::model::{self, Failure, Model, Rng};

use opencode_plugin::Status;
use opencode_plugin::loader::approval::Decision;
use opencode_plugin::loader::entry_file;
use opencode_tui::Route;
use opentui::keymap::RunResult;

/// The build whose `setup` returns a failure.
const BAD: u8 = 9;
const ID: &str = "model.probe";
const CHANGED: &str = "The plugin changed while you were asked, so nothing was saved. Review the new build.";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Answer {
    /// The Approve button.
    Approve,
    /// The Decline button, which is active at first.
    Decline,
    /// Escape: the question closes and the plugin stays pending.
    Dismiss,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Command {
    /// Enter on the probe's row in the plugin manager, which asks about the build held back.
    Open,
    /// Answers the open question, then closes the list it comes back to.
    Answer(Answer),
    /// A new build in the probe's directory, then a reconcile, as the watcher runs it also while the question is open.
    Reload(u8),
    /// The plugin manager's action on the probe's row, as the plugin model runs it.
    Toggle,
    Run,
    Frame,
    Home,
    Route,
    /// The client exits and starts again, on the same approvals.
    Restart,
}

/// The approval machine of 3.9 and 4.14 as code: the user's last decision on the probe's place, what the loader holds
/// back, and the question on screen.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Gate {
    /// The build in the probe's directory.
    file: u8,
    /// The last decision for the place, with the build it named.
    decision: Option<(u8, Decision)>,
    /// The build held back and asked about, if any.
    held: Option<u8>,
    /// A toggle in the manager; a plugin loaded again starts enabled.
    enabled: bool,
    /// The build the open question asks about.
    question: Option<u8>,
}

impl Gate {
    fn new() -> Self {
        Self { file: 1, decision: None, held: None, enabled: true, question: None }
    }

    fn approved(&self) -> bool {
        self.decision == Some((self.file, Decision::Approved))
    }

    fn running(&self) -> bool {
        self.approved() && self.enabled && self.file != BAD
    }

    fn listed(&self) -> Status {
        match self.decision {
            _ if self.approved() && self.file == BAD => Status::Failed(format!("probe build {BAD} fails its setup")),
            _ if self.running() => Status::Active,
            _ if self.approved() => Status::Inactive,
            Some((build, Decision::Declined)) if build == self.file => Status::Declined,
            _ => Status::Pending,
        }
    }

    /// A reconcile; returns the reports it makes.
    fn reconcile(&mut self, loaded: bool) -> Vec<String> {
        if self.approved() {
            self.held = None;
            // A failing build that loads now is told.
            return match loaded && self.file == BAD {
                true => vec![format!("Plugin failed: {ID}")],
                false => Vec::new(),
            };
        }
        // What ran from the target was unloaded; a plugin loaded again starts enabled.
        if self.held.is_none() {
            self.enabled = true;
        }
        let asked = self.listed() == Status::Pending && self.held != Some(self.file);
        self.held = Some(self.file);
        match asked {
            true => vec!["Plugin needs approval: <target>".to_owned()],
            false => Vec::new(),
        }
    }

    /// Moves the machine; returns the reports it expects, `<target>` standing for the probe's directory.
    fn step(&mut self, command: Command) -> Vec<String> {
        let closes = !matches!(command, Command::Reload(_) | Command::Frame | Command::Answer(_));
        if closes {
            self.question = None;
        }
        let (approved, running) = (self.approved(), self.running());
        match command {
            Command::Open if self.held.is_some() && self.question.is_none() => {
                self.question = Some(self.file);
                Vec::new()
            }
            Command::Answer(answer) => {
                let Some(shown) = self.question.take() else { return Vec::new() };
                let decision = match answer {
                    Answer::Approve => Decision::Approved,
                    Answer::Decline => Decision::Declined,
                    Answer::Dismiss => return Vec::new(),
                };
                // The answer names the build shown, and counts only while that build is the one held back.
                if self.held != Some(shown) {
                    return vec![CHANGED.to_owned()];
                }
                self.decision = Some((shown, decision));
                self.reconcile(!approved)
            }
            Command::Reload(build) => {
                let changed = build != self.file;
                self.file = build;
                let reports = self.reconcile(changed);
                // An approved build that starts at once and opens a prompt as it sets up replaces the question, as
                // any dialog replaces another.
                if !running && self.running() && self.file == PROMPTING {
                    self.question = None;
                }
                reports
            }
            // The manager's error, then the toast the failing setup showed.
            Command::Toggle if self.approved() && self.file == BAD => {
                vec![format!("probe build {BAD} fails its setup"), BAD_TOAST.to_owned()]
            }
            Command::Toggle if self.approved() => {
                self.enabled = !self.enabled;
                Vec::new()
            }
            Command::Restart => {
                (self.held, self.enabled) = (None, true);
                self.reconcile(true)
            }
            _ => Vec::new(),
        }
    }

    /// The calls of the probe that moving from `before` to `self` by `command` makes, other than renders.
    fn calls(&self, before: &Gate, command: Option<Command>) -> Vec<(Kind, Option<u8>)> {
        let started = command.is_none() || command == Some(Command::Restart);
        let mut expected = Vec::new();
        if before.running() && (!self.running() || started && command.is_some()) {
            expected.push((Kind::Dispose, None));
        }
        if self.running() && (!before.running() || started) {
            expected.push((Kind::Setup, Some(self.file)));
        }
        let loads = self.approved() && (!before.approved() || started);
        let enables = command == Some(Command::Toggle) && before.approved();
        if self.file == BAD && self.approved() && (loads || enables) {
            expected.push((Kind::Setup, Some(BAD)));
        }
        if command == Some(Command::Run) && self.running() {
            expected.push((Kind::Command(Which::Run), None));
        }
        expected
    }
}

pub struct ApprovalModel;

impl Model for ApprovalModel {
    type Command = Command;

    fn generate(&self, rng: &mut Rng, steps: usize) -> Vec<Command> {
        (0..steps)
            .map(|_| match rng.below(100) {
                0..14 => Command::Open,
                14..20 => Command::Answer(Answer::Approve),
                20..25 => Command::Answer(Answer::Decline),
                25..29 => Command::Answer(Answer::Dismiss),
                29..51 => Command::Reload(*rng.pick(&[1, 2, 3, BAD])),
                51..60 => Command::Toggle,
                60..69 => Command::Run,
                69..75 => Command::Frame,
                75..80 => Command::Home,
                80..88 => Command::Route,
                _ => Command::Restart,
            })
            .collect()
    }

    fn run(&self, commands: &[Command]) -> Option<Failure> {
        run(commands)
    }

    fn simplify(&self, command: &Command) -> Vec<Command> {
        match command {
            Command::Reload(build) if *build != 1 && *build != BAD => vec![Command::Reload(1)],
            Command::Answer(Answer::Decline | Answer::Dismiss) => vec![Command::Answer(Answer::Approve)],
            Command::Restart => vec![Command::Frame],
            Command::Route => vec![Command::Home],
            _ => Vec::new(),
        }
    }
}

/// The probe in the project's plugins directory, on build `build`; `root` keeps the approvals of a client before.
fn open(build: u8, root: Option<opencode_util::temp::TempDir>) -> World {
    let root = root.unwrap_or_else(|| opencode_util::temp::tempdir().unwrap());
    World::load(Some((root.path().join("work/.opencode/plugins/probe"), build, root)), Route::Home)
}

fn target(world: &World) -> String {
    world.probe.as_ref().unwrap().1.to_string_lossy().into_owned()
}

/// Runs `command` on the host as the user or a build would. Returns whether the probe's command ran from the keymap,
/// and the reports of the settles it needed on the way.
fn apply(world: &mut World, command: Command, gate: &Gate) -> (bool, Vec<String>) {
    let mut reports = Vec::new();
    let press = |world: &World, key: &str, reports: &mut Vec<String>| {
        world.harness.app.press(key);
        reports.extend(world.settle());
    };
    // Any other command closes the question first, and the list it comes back to.
    let closes = !matches!(command, Command::Reload(_) | Command::Frame | Command::Answer(_));
    let mut asking = gate.question.is_some();
    if closes && asking {
        press(world, "escape", &mut reports);
        press(world, "escape", &mut reports);
        asking = false;
    }
    let (app, tui) = (&world.harness.app, &world.harness.tui);
    match command {
        // The manager offers the question only on a row it holds back; on another row Enter toggles.
        Command::Open if gate.held.is_some() && !asking => {
            tui.keymap.dispatch("plugins.list", None);
            reports.extend(world.settle());
            app.type_text("probe");
            reports.extend(world.settle());
            press(world, "enter", &mut reports);
        }
        Command::Open => {}
        Command::Answer(answer) if asking => {
            match answer {
                Answer::Approve => {
                    app.press("right");
                    press(world, "enter", &mut reports);
                }
                Answer::Decline => press(world, "enter", &mut reports),
                Answer::Dismiss => press(world, "escape", &mut reports),
            }
            // The list it comes back to.
            press(world, "escape", &mut reports);
        }
        Command::Answer(_) => {}
        Command::Reload(build) => {
            let (loader, dir, _) = world.probe.as_ref().unwrap();
            std::fs::write(dir.join(entry_file()), [build]).unwrap();
            loader.reconcile(&opencode_tui::plugins::host::host(tui), &tui.plugins);
        }
        Command::Toggle => reports.extend(toggle(world)),
        Command::Run => return (matches!(tui.keymap.dispatch("probe.run", None), RunResult::Ok), reports),
        Command::Frame => app.advance(std::time::Duration::from_millis(16)),
        Command::Home => tui.navigate(Route::Home),
        Command::Route => tui.navigate(Route::Plugin { id: ID.to_owned(), name: "probe".to_owned() }),
        Command::Restart => {
            tui.plugins.deactivate_all();
            let (_, _, root) = world.probe.take().unwrap();
            *world = open(gate.file, Some(root));
        }
    }
    (false, reports)
}

/// What the plugin manager's action does (`Manager::toggle`), as the plugin model runs it; its error is the report.
fn toggle(world: &World) -> Vec<String> {
    let tui = &world.harness.tui;
    let active = tui.plugins.entries().iter().any(|entry| entry.id == ID && entry.active);
    match tui.plugins.toggle(&opencode_tui::plugins::host::host(tui), ID, !active) {
        Some(toggled) => {
            tui.navigate(tui.route());
            toggled.err().into_iter().collect()
        }
        None => Vec::new(),
    }
}

/// The twin has no probe: only what does not name it applies.
fn apply_twin(twin: &mut World, command: Command) {
    let tui = &twin.harness.tui;
    match command {
        Command::Frame => twin.harness.app.advance(std::time::Duration::from_millis(16)),
        Command::Home | Command::Restart => tui.navigate(Route::Home),
        Command::Route => tui.navigate(Route::Plugin { id: ID.to_owned(), name: "probe".to_owned() }),
        Command::Run => drop(tui.keymap.dispatch("probe.run", None)),
        _ => {}
    }
}

/// A failure of `property` at `site` with `detail`, unless `MODEL_SKIP` turns the property off.
fn check(property: &'static str, site: &'static str, step: usize, detail: Option<String>) -> Option<Failure> {
    let detail = detail?;
    (!model::skipped(property)).then_some(Failure { property, site, step, detail })
}

fn run(commands: &[Command]) -> Option<Failure> {
    LOG.take();
    TOKENS.take();
    crate::plugin_model::ARMED.set(None);
    // Before the first client: a build opened as the client starts counts too.
    let mut loads = LOADS.get();
    let mut gate = Gate::new();
    let mut world = open(1, None);
    let mut twin = World::load(None, Route::Home);
    twin.settle();
    let mut expected = gate.reconcile(true);
    let mut reports = world.settle();
    let mut before = gate;
    let mut reached = false;
    for (step, command) in [None].into_iter().chain(commands.iter().copied().map(Some)).enumerate() {
        if let Some(command) = command {
            before = gate;
            expected = gate.step(command);
            let (ran, mut seen) = apply(&mut world, command, &before);
            seen.extend(world.settle());
            (reached, reports) = (ran, seen);
            apply_twin(&mut twin, command);
            twin.settle();
        }
        let calls = take_calls();
        let held = !gate.approved();
        let opened = LOADS.get() - loads;
        let registered = world.harness.tui.plugins.entries().into_iter().find(|entry| entry.id == ID);
        // The question is the host's own dialog, which the twin never opened; a failed build is counted in the footer.
        let alone = !gate.running() && gate.question.is_none() && !(gate.approved() && gate.file == BAD);
        let failure = check("lifecycle", "calls", step, lifecycle(&before, &gate, command, reached, &calls))
            .or_else(|| check("asked", "listed", step, listed(&world, &gate)))
            .or_else(|| check("asked", "reported", step, reported(&world, &expected, &reports)))
            .or_else(|| {
                let detail = format!("the backend opened {opened} builds while the probe is {gate:?}");
                check("pending", "loads", step, (held && opened != 0).then_some(detail))
            })
            .or_else(|| {
                let detail = |entry| format!("the registry holds the probe while it is {gate:?}: {entry:?}");
                check("pending", "registry", step, registered.filter(|_| held).map(detail))
            })
            .or_else(|| {
                let detail = |detail| format!("the probe is {:?}: {detail}", gate.listed());
                check("pending", "twin", step, alone.then(|| pending(&world, &twin)).flatten().map(detail))
            });
        if failure.is_some() {
            return failure;
        }
        // An approved build may load from here on.
        if gate.approved() {
            loads = LOADS.get();
        }
    }
    None
}

/// `lifecycle`: the calls the probe logged while `command` moved the gate from `before` to `after`.
fn lifecycle(before: &Gate, after: &Gate, command: Option<Command>, reached: bool, calls: &[Call]) -> Option<String> {
    let expected = after.calls(before, command);
    if reached != (command == Some(Command::Run) && after.running()) {
        return Some(format!("the probe's command ran: {reached}, while {after:?}"));
    }
    let (renders, others): (Vec<&Call>, Vec<&Call>) =
        calls.iter().partition(|call| matches!(call.kind, Kind::Render(_)));
    if !renders.is_empty() && !before.running() && !after.running() {
        return Some(format!("renders while the probe does not run: {renders:?}"));
    }
    let matches = others.len() == expected.len()
        && others.iter().zip(&expected).all(|(call, (kind, build))| {
            call.kind == *kind && !call.panicked && build.is_none_or(|build| call.build == build)
        });
    (!matches).then(|| format!("expected {expected:?} from {before:?} to {after:?}, got {others:?}"))
}

/// `asked`: the manager lists the probe as the gate does.
fn listed(world: &World, gate: &Gate) -> Option<String> {
    let target = target(world);
    let listed = world.harness.tui.plugins.entries().into_iter().find(|entry| entry.target.as_deref() == Some(&target));
    let status = listed.map(|entry| entry.status);
    (status.as_ref() != Some(&gate.listed()))
        .then(|| format!("listed {status:?}, expected {:?} ({gate:?})", gate.listed()))
}

/// `asked`: the step reported exactly what the gate expects.
fn reported(world: &World, expected: &[String], reports: &[String]) -> Option<String> {
    let target = target(world);
    let expected: Vec<String> = expected.iter().map(|report| report.replace("<target>", &target)).collect();
    (reports != expected).then(|| format!("reported {reports:?}, expected {expected:?}"))
}

/// `pending`: the host equals the twin, and holds no activation of the probe.
fn pending(world: &World, twin: &World) -> Option<String> {
    let held = TOKENS.with_borrow(|tokens| tokens.iter().filter(|(_, token)| token.strong_count() > 0).count());
    if held != 0 {
        return Some(format!("the host holds {held} activations"));
    }
    if let Some(difference) = world.observe(true).diff(&twin.observe(true), true) {
        return Some(format!("host and twin: {difference}"));
    }
    frame_diff(&twin.frame(), &world.frame(), world.mask(), |_| false).map(|row| format!("the frames differ at {row}"))
}

/// Shrunk traces that failed once and pass now, and the faults of 4.14's row Pa and of the reviews.
const FIXED: &[(&str, &[Command])] = &[
    ("a-replaced-library-is-pending-again", &[Command::Open, Command::Answer(Answer::Approve), Command::Reload(2)]),
    ("an-approval-lasts-across-clients", &[Command::Open, Command::Answer(Answer::Approve), Command::Restart]),
    (
        "a-changed-library-asks-a-new-client",
        &[Command::Open, Command::Answer(Answer::Approve), Command::Reload(2), Command::Restart],
    ),
    (
        "a-decline-names-its-build",
        &[Command::Open, Command::Answer(Answer::Decline), Command::Reload(2), Command::Reload(1)],
    ),
    (
        "an-approval-of-an-older-build-holds",
        &[Command::Open, Command::Answer(Answer::Approve), Command::Reload(2), Command::Reload(1)],
    ),
    (
        "a-disabled-plugin-replaced-starts-enabled",
        &[
            Command::Open,
            Command::Answer(Answer::Approve),
            Command::Toggle,
            Command::Reload(2),
            Command::Open,
            Command::Answer(Answer::Approve),
        ],
    ),
    // bigboi-1, carbon-1: the library is replaced while the question is open; the answer records nothing.
    (
        "an-approval-of-a-replaced-build-records-nothing",
        &[Command::Open, Command::Reload(2), Command::Answer(Answer::Approve)],
    ),
    (
        "a-decline-of-a-replaced-build-records-nothing",
        &[Command::Open, Command::Reload(2), Command::Answer(Answer::Decline)],
    ),
    // The build shown comes back while the question is open: the answer holds for it.
    (
        "an-approval-of-a-build-that-came-back-holds",
        &[Command::Open, Command::Reload(2), Command::Reload(1), Command::Answer(Answer::Approve)],
    ),
    // carbon-6: closing the question decides nothing.
    (
        "a-closed-question-leaves-the-plugin-pending",
        &[Command::Open, Command::Answer(Answer::Dismiss), Command::Restart],
    ),
    // Deep run, seed 33: an approved build that comes back while the question is open starts at once, and the prompt
    // its setup opens replaces the question; Enter then answers the prompt.
    (
        "a-prompt-of-an-approved-build-replaces-the-question",
        &[
            Command::Reload(PROMPTING),
            Command::Open,
            Command::Answer(Answer::Approve),
            Command::Reload(1),
            Command::Open,
            Command::Reload(PROMPTING),
            Command::Answer(Answer::Approve),
        ],
    ),
    (
        "a-failing-build-approved-fails-once",
        &[Command::Reload(BAD), Command::Open, Command::Answer(Answer::Approve), Command::Toggle],
    ),
];

// Expected (O-124, Pa): `pending`, `lifecycle` and `asked` hold for 12 seeds of 64 commands. A seed costs about
// 280 ms in a debug build (two TUIs, the manager's dialogs, a fresh client on each restart, the twin's widgets and
// frame whenever the probe does not run), so the seeds went down and the commands stayed, as 4.14 allows.
// `MODEL_SEEDS` runs more.
#[test]
fn a_project_plugin_waits_for_approval() {
    model::check(&ApprovalModel, 12, 64);
}

#[test]
fn the_fixed_approval_rows_pass() {
    for (name, commands) in FIXED {
        assert_eq!(run(commands), None, "{name}");
    }
}

// Expected: the oracles are not empty. A running probe differs from the twin, and the gate refuses a setup while
// the probe is pending, a report it does not expect, and a listing it does not have.
#[test]
fn the_approval_oracles_can_fail() {
    LOG.take();
    let mut world = open(1, None);
    let mut gate = Gate::new();
    gate.reconcile(true);
    world.settle();
    let mut twin = World::load(None, Route::Home);
    twin.settle();
    assert_eq!(pending(&world, &twin), None);
    apply(&mut world, Command::Open, &gate);
    gate.step(Command::Open);
    apply(&mut world, Command::Answer(Answer::Approve), &gate);
    world.settle();
    apply_twin(&mut twin, Command::Answer(Answer::Approve));
    assert!(pending(&world, &twin).is_some());
    let pending_gate = Gate::new();
    let call = Call { activation: 1, build: 1, kind: Kind::Setup, panicked: false };
    assert!(lifecycle(&pending_gate, &pending_gate, Some(Command::Frame), false, &[call]).is_some());
    assert!(listed(&world, &pending_gate).is_some());
    let running = Gate { decision: Some((1, Decision::Approved)), ..Gate::new() };
    assert_eq!(listed(&world, &running), None);
    assert!(reported(&world, &[], &["unexpected".to_owned()]).is_some());
}

/// Opens the manager on the probe's row.
fn manager(world: &World) {
    world.harness.tui.keymap.dispatch("plugins.list", None);
    world.settle();
    world.harness.app.type_text("probe");
    world.settle();
}

// Expected (3.9, carbon-6, bigboi-1): the toast names the plugin and opens the manager; the manager lists it pending,
// and Enter asks before it runs: the directory, the library that would run and its hash, without suggesting a sandbox,
// with Decline active. Approving runs it at once.
#[test]
fn the_manager_asks_before_a_project_plugin_runs() {
    LOG.take();
    let world = open(1, None);
    let target = target(&world);
    let (app, tui) = (&world.harness.app, &world.harness.tui);
    let toast = tui.toasts.current().unwrap();
    assert_eq!(toast.title.as_deref(), Some(&*format!("Plugin needs approval: {target}")));
    assert_eq!(
        (toast.variant, toast.message.as_str(), toast.action.as_ref().map(|action| action.label.as_str())),
        (
            opencode_ui::toast::Variant::Warning,
            "This project wants to run native code inside opencode. Run /plugins to approve or decline it.",
            Some("Open plugins")
        )
    );
    tui.toasts.activate();
    world.settle();
    assert!(app.text().contains("pending, local"), "{}", app.text());
    app.press("escape");
    world.settle();
    world.settle();
    tui.keymap.dispatch("plugins.list", None);
    world.settle();
    // A status the user must act on, in the warning color; a row shows it while another is selected, here an internal
    // plugin's.
    app.press("ctrl+a");
    app.press("up");
    world.settle();
    let (x, y) = world.harness.find("pending, local");
    let warning = tui.page().text.feedback.warning.base;
    assert_eq!(app.render().cell(u32::from(x), u32::from(y)).unwrap().fg, warning, "{}", app.text());
    app.press("ctrl+a");
    app.type_text("probe");
    world.settle();
    let screen = app.text();
    assert!(screen.contains("pending, local") && screen.contains("approve or decline"), "{screen}");
    app.press("enter");
    world.settle();
    let screen = app.text();
    let (loader, _, _) = world.probe.as_ref().unwrap();
    let shown = loader.held(&target).unwrap().unwrap();
    assert!(screen.contains("Run project plugin?") && screen.contains("native code inside opencode"), "{screen}");
    assert!(screen.contains("Approve") && screen.contains("Decline"), "{screen}");
    assert!(screen.contains(&format!("SHA-256: {}", shown.short())), "{screen}");
    assert!(screen.contains("Library: ") && !screen.contains("outside this plugin directory"), "{screen}");
    assert!(!screen.to_lowercase().contains("sandbox"), "{screen}");
    app.press("right");
    app.press("enter");
    world.settle();
    let screen = app.text();
    assert!(screen.contains("model.probe") && !screen.contains("pending"), "{screen}");
    app.press("escape");
    world.settle();
    assert!(app.text().contains("probe b1 n0"), "{}", app.text());
}

// Expected (3.9, carbon-6): Enter on the question declines, as Decline is active at first; the row says so and still
// offers the decision, and the declined build is not asked about again.
#[test]
fn a_declined_project_plugin_is_listed_declined() {
    LOG.take();
    let world = open(1, None);
    world.settle();
    let (app, tui) = (&world.harness.app, &world.harness.tui);
    manager(&world);
    app.press("enter");
    world.settle();
    app.press("enter");
    world.settle();
    let screen = app.text();
    assert!(screen.contains("declined, local") && screen.contains("approve or decline"), "{screen}");
    let (loader, _, _) = world.probe.as_ref().unwrap();
    loader.reconcile(&opencode_tui::plugins::host::host(tui), &tui.plugins);
    assert_eq!(world.settle(), Vec::<String>::new());
    assert!(LOG.with_borrow(Vec::is_empty));
}

// Expected (carbon-6): Escape, Ctrl+C, the header's `esc` and a click on the backdrop close the question without a
// decision, and the list comes back with the plugin pending.
#[test]
fn closing_the_question_decides_nothing() {
    for how in ["escape", "ctrl+c", "header", "backdrop"] {
        LOG.take();
        let world = open(1, None);
        world.settle();
        let (app, tui) = (&world.harness.app, &world.harness.tui);
        manager(&world);
        app.press("enter");
        world.settle();
        assert!(app.text().contains("Run project plugin?"), "{how}");
        match how {
            "header" => {
                // The question's own `esc`, at the end of its title's row.
                let (_, y) = world.harness.find("Run project plugin?");
                let row = app.text().lines().nth(usize::from(y)).unwrap().to_owned();
                let x = row.rfind("esc").unwrap();
                app.click(row[..x].chars().count() as u16, y);
            }
            "backdrop" => app.click(0, 0),
            key => app.press(key),
        }
        world.settle();
        world.settle();
        let screen = app.text();
        assert!(!screen.contains("Run project plugin?") && screen.contains("pending, local"), "{how}: {screen}");
        let entry = tui.plugins.entries().into_iter().find(|entry| entry.status == Status::Pending);
        assert!(entry.is_some(), "{how}");
        assert!(!world.probe.as_ref().unwrap().2.path().join("state").join("plugin-approvals.json").exists(), "{how}");
    }
}

// Expected (carbon-6): a dialog that replaces the question stays; the list does not come back over it.
#[test]
fn a_dialog_that_replaces_the_question_stays() {
    LOG.take();
    let world = open(1, None);
    world.settle();
    let (app, tui) = (&world.harness.app, &world.harness.tui);
    manager(&world);
    app.press("enter");
    world.settle();
    assert!(app.text().contains("Run project plugin?"));
    tui.keymap.dispatch("command.palette.show", None);
    world.settle();
    world.settle();
    let screen = app.text();
    assert!(screen.contains("Search commands") && !screen.contains("pending, local"), "{screen}");
}

// Expected (carbon-5): a project plugin whose library cannot be read offers nothing to approve, and says why.
#[cfg(unix)]
#[test]
fn a_plugin_that_cannot_be_read_cannot_be_approved() {
    if std::fs::metadata("/proc/self").is_ok_and(|metadata| std::os::unix::fs::MetadataExt::uid(&metadata) == 0) {
        return;
    }
    use std::os::unix::fs::PermissionsExt;
    LOG.take();
    let world = open(1, None);
    world.settle();
    let (loader, dir, _) = world.probe.as_ref().unwrap();
    let library = dir.join(entry_file());
    std::fs::set_permissions(&library, std::fs::Permissions::from_mode(0o000)).unwrap();
    let tui = &world.harness.tui;
    loader.reconcile(&opencode_tui::plugins::host::host(tui), &tui.plugins);
    assert_eq!(world.settle(), Vec::<String>::new());
    manager(&world);
    world.harness.app.press("enter");
    let reports = world.settle();
    assert!(reports.iter().any(|report| report.starts_with("This plugin cannot be approved:")), "{reports:?}");
    assert!(!world.harness.app.text().contains("Run project plugin?"));
}

// Expected (bigboi-1): the build is replaced while the question is open, and the watcher reconciles before the answer:
// Approve records nothing, says why, and the new build is asked about.
#[test]
fn an_answer_on_a_replaced_build_records_nothing_and_says_so() {
    LOG.take();
    let loads = LOADS.get();
    let mut world = open(1, None);
    world.settle();
    manager(&world);
    world.harness.app.press("enter");
    world.settle();
    let mut gate = Gate { held: Some(1), question: Some(1), ..Gate::new() };
    let (_, mut reports) = apply(&mut world, Command::Reload(2), &gate);
    reports.extend(world.settle());
    assert_eq!(reports, [format!("Plugin needs approval: {}", target(&world))]);
    assert!(world.harness.app.text().contains("Run project plugin?"));
    gate.held = Some(2);
    let (_, mut reports) = apply(&mut world, Command::Answer(Answer::Approve), &gate);
    reports.extend(world.settle());
    assert_eq!(reports, [CHANGED]);
    let tui = &world.harness.tui;
    assert!(tui.plugins.entries().iter().any(|entry| entry.status == Status::Pending));
    assert_eq!(LOADS.get(), loads);
    assert!(LOG.with_borrow(Vec::is_empty));
}

// Expected (bigboi-7): a decision that cannot be saved says so, and the build stays pending.
#[cfg(unix)]
#[test]
fn a_decision_that_cannot_be_saved_says_so() {
    if std::fs::metadata("/proc/self").is_ok_and(|metadata| std::os::unix::fs::MetadataExt::uid(&metadata) == 0) {
        return;
    }
    use std::os::unix::fs::PermissionsExt;
    LOG.take();
    let world = open(1, None);
    world.settle();
    let state = world.probe.as_ref().unwrap().2.path().join("state");
    std::fs::set_permissions(&state, std::fs::Permissions::from_mode(0o500)).unwrap();
    let app = &world.harness.app;
    manager(&world);
    app.press("enter");
    world.settle();
    app.press("right");
    app.press("enter");
    let reports = world.settle();
    std::fs::set_permissions(&state, std::fs::Permissions::from_mode(0o700)).unwrap();
    assert!(reports.iter().any(|report| report.starts_with("The decision was not saved:")), "{reports:?}");
    assert!(world.harness.tui.plugins.entries().iter().any(|entry| entry.status == Status::Pending));
    assert!(LOG.with_borrow(Vec::is_empty));
}
