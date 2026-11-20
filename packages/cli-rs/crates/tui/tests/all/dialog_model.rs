//! The dialog stack under random opens, replacements and closes, with routes changing under it and toasts over it,
//! against a reference of what holds the focus and where keys go.

use crate::support::model::{self, Failure, Model, Rng};
use crate::support::{self, Harness};

use std::cell::{Cell, RefCell};
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use opencode_tui::{Deps, Route};
use opencode_ui::alert::{self, AlertProps};
use opencode_ui::confirm::{self, ConfirmProps};
use opencode_ui::dialog::{DialogOptions, Dialogs};
use opencode_ui::prompt::{self, PromptProps};
use opencode_ui::select::{self, SelectOption, SelectProps};
use opencode_ui::toast::{ToastOptions, Variant};
use opentui::prelude::*;

#[derive(Clone, Copy, Debug, PartialEq)]
enum Kind {
    Select,
    Prompt,
    Confirm,
    Alert,
    /// A select whose choice replaces it with a prompt.
    Chain,
    /// One of the TUI's own dialogs, by its command.
    Command(&'static str),
}

#[derive(Clone, Debug)]
enum Command {
    /// Replaces whatever is open with a new dialog.
    Open(Kind),
    Type(char),
    Key(&'static str),
    Pop,
    Clear,
    /// A click on the backdrop, outside the dialog.
    Outside,
    /// The route under the dialogs changes.
    Route(bool),
    Toast,
    Resize(u16, u16),
}

impl Kind {
    /// Whether the dialog has a text input, which typed keys reach.
    fn input(self) -> bool {
        !matches!(self, Self::Confirm | Self::Alert | Self::Command("help.show"))
    }
}

const KINDS: &[Kind] = &[
    Kind::Select,
    Kind::Prompt,
    Kind::Confirm,
    Kind::Alert,
    Kind::Chain,
    Kind::Command("help.show"),
    Kind::Command("session.list"),
    Kind::Command("model.list"),
];
const KEYS: &[&str] = &["escape", "return", "ctrl+c", "backspace", "down", "tab"];

/// What a dialog's input holds, read through its handle.
#[derive(Clone)]
enum Handle {
    Select(select::Select<usize>),
    Prompt(prompt::Prompt),
    None,
}

impl Handle {
    fn value(&self) -> Option<String> {
        match self {
            Self::Select(select) => Some(select.filter()),
            Self::Prompt(prompt) => Some(prompt.value()),
            Self::None => None,
        }
    }
}

type Slot = Rc<RefCell<Handle>>;

/// How often a dialog's close handler ran.
type Closes = Rc<Cell<u32>>;

/// One open dialog: its kind, its content's root, its input, and the close count of what shows.
struct Open {
    kind: Kind,
    root: Rc<RefCell<Option<View>>>,
    handle: Slot,
    closes: Rc<RefCell<Closes>>,
}

impl Open {
    fn new(kind: Kind) -> Self {
        Self { kind, root: Rc::default(), handle: Rc::new(RefCell::new(Handle::None)), closes: Rc::default() }
    }

    fn share(&self, kind: Kind) -> Self {
        Self { kind, root: self.root.clone(), handle: self.handle.clone(), closes: self.closes.clone() }
    }
}

fn build(tui: &opencode_tui::Tui, kind: Kind, open: &Open) {
    if let Kind::Command(command) = kind {
        tui.keymap.dispatch(command, None);
        *open.root.borrow_mut() = Some(tui.dialogs.host().clone());
        return;
    }
    replace(&tui.dialogs, kind, open);
}

fn replace(dialogs: &Dialogs, kind: Kind, open: &Open) {
    let (root, handle) = (open.root.clone(), open.handle.clone());
    let then = open.share(Kind::Prompt);
    let closes = Closes::default();
    *open.closes.borrow_mut() = closes.clone();
    dialogs.replace(
        move |cx| {
            let (view, value) = match kind {
                Kind::Select | Kind::Chain => {
                    let options = (0..5)
                        .map(|index| {
                            let option = SelectOption::new(format!("Option {index}"), index);
                            if kind != Kind::Chain {
                                return option;
                            }
                            let then = then.share(Kind::Prompt);
                            option.on_select(move |dialogs| replace(dialogs, Kind::Prompt, &then))
                        })
                        .collect();
                    let mut props = SelectProps::new("Pick", options);
                    if kind == Kind::Select {
                        let dialogs = cx.dialogs.clone();
                        props.on_select = Some(Rc::new(move |_| dialogs.clear()));
                    }
                    let (view, select) = select::select(cx, props);
                    (view, Handle::Select(select))
                }
                Kind::Prompt => {
                    let dialogs = cx.dialogs.clone();
                    let props = PromptProps {
                        title: "Name".into(),
                        on_confirm: Some(Rc::new(move |_| dialogs.clear())),
                        ..PromptProps::default()
                    };
                    let (view, prompt) = prompt::prompt(cx, props);
                    (view, Handle::Prompt(prompt))
                }
                Kind::Confirm => (
                    confirm::confirm(cx, ConfirmProps { title: "Sure?".into(), ..ConfirmProps::default() }),
                    Handle::None,
                ),
                Kind::Alert => {
                    (alert::alert(cx, AlertProps { title: "Note".into(), ..AlertProps::default() }), Handle::None)
                }
                Kind::Command(_) => unreachable!("the TUI builds its own dialogs"),
            };
            *root.borrow_mut() = Some(view.clone());
            *handle.borrow_mut() = value;
            view
        },
        Some(Box::new(move || closes.set(closes.get() + 1))),
        DialogOptions::default(),
    );
}

struct Stack;

impl Model for Stack {
    type Command = Command;

    fn generate(&self, rng: &mut Rng, steps: usize) -> Vec<Command> {
        (0..steps)
            .map(|_| match rng.below(100) {
                0..25 => Command::Open(*rng.pick(KINDS)),
                25..45 => Command::Type(*rng.pick(&['a', 'b', 'q', ' ', 'é'])),
                45..70 => Command::Key(rng.pick(KEYS)),
                70..75 => Command::Pop,
                75..80 => Command::Clear,
                80..85 => Command::Outside,
                85..92 => Command::Route(rng.below(2) == 0),
                92..96 => Command::Toast,
                _ => Command::Resize(*rng.pick(&[40, 80, 120]), *rng.pick(&[12, 24, 40])),
            })
            .collect()
    }

    fn run(&self, commands: &[Command]) -> Option<Failure> {
        // One TUI per thread: one with dialogs is never freed.
        thread_local! {
            static KIT: Harness = {
                let fake = support::Fake::new(|seen| support::base(seen, support::DIRECTORY));
                let deps = Deps { config: support::config(support::still()), ..support::deps(Arc::new(fake)) };
                // The TUI's own app options, which decide what keys no widget takes do.
                let app = opentui::testing::TestApp::with_options(80, 24, opencode_tui::app::options());
                let harness = support::mount_on(app, deps, opencode_tui::Args::default());
                // A still plugin clock: on a loaded machine a slow built-in's toast would come and go between steps.
                let now = std::time::Instant::now();
                harness.tui.plugins.monitor().set_clock(move || now);
                harness.wait_for("Fix the parser");
                harness
            };
        }
        KIT.with(|harness| {
            harness.tui.dialogs.clear();
            harness.app.resize(80, 24);
            harness.tui.navigate(support::session_route("ses_a"));
            settle(harness);
            harness.textarea().set_text("");
            walk(harness, commands)
        })
    }
}

fn settle(harness: &Harness) {
    for _ in 0..4 {
        harness.app.advance(Duration::from_millis(2));
        harness.app.render();
    }
}

/// Whether \`widget\` is \`root\` or inside it.
fn within(widget: &AnyWidget, root: &View) -> bool {
    std::iter::successors(Some(widget.clone()), |widget| widget.parent()).any(|widget| widget.id() == root.id())
}

fn walk(harness: &Harness, commands: &[Command]) -> Option<Failure> {
    let (app, tui) = (&harness.app, &harness.tui);
    let mut open: Option<Open> = None;
    // The top dialog's input, as the reference has it.
    let mut value = String::new();
    // The closed dialogs: their inputs, what those held when they closed, and their close counts.
    let mut closed: Vec<(Handle, Option<String>, Option<Closes>)> = Vec::new();
    for (step, command) in commands.iter().enumerate() {
        let fail = |site, detail: String| Some(Failure { property: "dialogs", site, step, detail });
        let (route_id, route_text) = (harness.textarea().id(), harness.textarea().text());
        let size = app.app().size();
        let kind = open.as_ref().map(|open| open.kind);
        // A chained select's choice replaces what the dialog's slots hold, so its count is read first.
        let counted = open.as_ref().map(|open| open.closes.borrow().clone());
        // A select submits only while its filter matches an option.
        let matched = open.as_ref().is_some_and(|open| match &*open.handle.borrow() {
            Handle::Select(select) => select.selected().is_some(),
            _ => true,
        });
        // What the command does to the stack: Some(kind) keeps or opens one, None closes it.
        let mut next = kind;
        let mut own = false;
        match command {
            Command::Open(kind) => {
                let dialog = Open::new(*kind);
                build(tui, *kind, &dialog);
                if let Some(old) = open.replace(dialog) {
                    closed.push(close(&old));
                }
                (next, value) = (Some(*kind), String::new());
            }
            Command::Type(c) => {
                app.type_text(&c.to_string());
                if kind.is_some_and(Kind::input) {
                    value.push(*c);
                }
            }
            // The route's own keys are not the model's: Ctrl+C would quit, and Down opens the composer.
            Command::Key(_) if kind.is_none() => {}
            Command::Key(key) => {
                app.press(key);
                let input = kind.is_some_and(Kind::input);
                match *key {
                    "escape" => next = None,
                    "ctrl+c" if input && !value.is_empty() => value.clear(),
                    "ctrl+c" => next = None,
                    "backspace" if input => drop(value.pop()),
                    "return" => match kind {
                        Some(Kind::Chain) if matched => {
                            closed.push((Handle::None, None, counted.clone()));
                            (next, value) = (Some(Kind::Prompt), String::new());
                        }
                        Some(Kind::Select | Kind::Chain) if !matched => {}
                        // What a TUI dialog's choice does is its own; whatever it opens or closes, the checks below hold.
                        Some(Kind::Command(_)) => own = true,
                        _ => next = None,
                    },
                    _ => {}
                }
            }
            Command::Pop | Command::Clear => {
                if let Command::Pop = command {
                    tui.dialogs.pop();
                } else {
                    tui.dialogs.clear();
                }
                next = None;
            }
            Command::Outside => {
                app.click(0, size.1 - 1);
                next = None;
            }
            Command::Route(home) => tui.navigate(if *home { Route::Home } else { support::session_route("ses_a") }),
            Command::Toast => tui.toasts.show(ToastOptions::new(Variant::Info, "Saved")),
            Command::Resize(width, height) => app.resize(*width, *height),
        }
        settle(harness);
        if own && !tui.dialogs.is_open() {
            next = None;
        }
        match next {
            None => {
                if let Some(old) = open.take() {
                    closed.push(close(&old));
                }
            }
            Some(kind) => {
                if let Some(open) = open.as_mut() {
                    open.kind = kind;
                }
            }
        }
        if tui.dialogs.is_open() != open.is_some() {
            return fail("stack", format!("open: {}, the model {:?}:\n{}", tui.dialogs.is_open(), next, app.text()));
        }
        let focused = app.focused();
        let route = harness.textarea();
        match &open {
            Some(open) => {
                let root = open.root.borrow().clone().expect("the dialog was built");
                if let Some(widget) = focused.as_ref().filter(|widget| !within(widget, &root)) {
                    let id = widget.id();
                    return fail("focus", format!("{id} has the focus over a {:?} dialog:\n{}", open.kind, app.text()));
                }
                let handle = open.handle.borrow().clone();
                if !matches!(handle, Handle::None) && focused.is_none() {
                    return fail(
                        "focus",
                        format!("nothing has the focus in a {:?} dialog:\n{}", open.kind, app.text()),
                    );
                }
                if let Some(shown) = handle.value().filter(|shown| *shown != value) {
                    return fail("input", format!("the {:?} dialog holds {shown:?}, the model {value:?}", open.kind));
                }
                if route.id() == route_id && route.text() != route_text {
                    return fail(
                        "leak",
                        format!("the prompt under a dialog went from {route_text:?} to {:?}", route.text()),
                    );
                }
            }
            None => {
                if focused.as_ref().map(AnyWidget::id) != Some(route.id()) {
                    return fail("refocus", format!("the route's prompt does not have the focus:\n{}", app.text()));
                }
                if let Command::Type(c) = command
                    && kind.is_none()
                    && route.text() != format!("{route_text}{c}")
                {
                    return fail("typed", format!("the prompt went from {route_text:?} to {:?}", route.text()));
                }
            }
        }
        if let Some((_, value, _)) = closed.iter().find(|(handle, value, _)| handle.value() != *value) {
            return fail("closed", format!("a closed dialog's input changed from {value:?}"));
        }
        let own = open.as_ref().is_some_and(|open| matches!(open.kind, Kind::Command(_)));
        if let Some(count) = closed.iter().filter_map(|(_, _, closes)| closes.as_ref()).find(|closes| closes.get() != 1)
        {
            return fail("closes", format!("a closed dialog's close handler ran {} times", count.get()));
        }
        if let Some(open) = open.as_ref().filter(|_| !own)
            && open.closes.borrow().get() != 0
        {
            return fail("closes", "the open dialog's close handler ran".to_owned());
        }
        if tui.dialogs.len() != usize::from(open.is_some()) || (tui.keymap.mode() == "modal") != open.is_some() {
            let mode = tui.keymap.mode();
            return fail(
                "mode",
                format!("{} dialogs in mode {mode:?}, the model {}", tui.dialogs.len(), open.is_some()),
            );
        }
    }
    None
}

/// What the model keeps of a dialog that closed. The TUI's own dialogs have their own close handlers.
fn close(open: &Open) -> (Handle, Option<String>, Option<Closes>) {
    let handle = open.handle.borrow().clone();
    let value = handle.value();
    let closes = (!matches!(open.kind, Kind::Command(_))).then(|| open.closes.borrow().clone());
    (handle, value, closes)
}

/// Tab in a dialog that does not bind it keeps the focus there, so what is typed next stays in the dialog.
#[test]
fn tab_in_a_dialog_keeps_the_focus_there() {
    let walk = [Command::Open(Kind::Prompt), Command::Key("tab"), Command::Type('a')];
    assert_eq!(Stack.run(&walk), None);
}

#[test]
fn any_walk_keeps_the_focus_on_the_top_dialog_or_the_route() {
    model::check(&Stack, 8, 32);
}
