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

#[derive(Clone, Copy, Debug, Default, PartialEq)]
enum Kind {
    #[default]
    Select,
    Prompt,
    Confirm,
    Alert,
}

#[derive(Clone, Debug)]
enum Command {
    Open(Kind),
    Type(char),
    Key(&'static str),
    Pop,
    Clear,
    /// A click on the backdrop, or on the dialog's title.
    Outside,
    Inside,
    /// The route under the dialogs changes, to home or to the session.
    Route(bool),
    Toast,
    Resize(u16, u16),
}

/// A dialog that opened: its input, how often its close handler ran and what its input held then, and the buttons
/// it ran and the model expects.
#[derive(Default)]
struct Entry {
    kind: Kind,
    input: RefCell<Option<Input>>,
    closes: Cell<u32>,
    closed: RefCell<Option<String>>,
    ran: Rc<RefCell<Vec<&'static str>>>,
    want: RefCell<Vec<&'static str>>,
}

#[derive(Clone)]
enum Input {
    Select(select::Select<usize>),
    Prompt(prompt::Prompt),
}

impl Entry {
    fn value(&self) -> Option<String> {
        match self.input.borrow().as_ref()? {
            Input::Select(select) => Some(select.filter()),
            Input::Prompt(prompt) => Some(prompt.value()),
        }
    }
}

type Entries = Rc<RefCell<Vec<Rc<Entry>>>>;

fn open(dialogs: &Dialogs, entries: &Entries, kind: Kind) {
    let ran = Rc::<RefCell<Vec<_>>>::default();
    let entry = Rc::new(Entry { kind, ran: ran.clone(), ..Entry::default() });
    entries.borrow_mut().push(entry.clone());
    let (built, closing) = (entry.clone(), entry);
    let build = move |cx: &Rc<opencode_ui::dialog::DialogCx>| {
        let dialogs = cx.dialogs.clone();
        let button = |name| {
            let ran = ran.clone();
            Some(Rc::new(move || ran.borrow_mut().push(name)) as Rc<dyn Fn()>)
        };
        let (view, input) = match kind {
            Kind::Select => {
                let options = (0..5).map(|index| SelectOption::new(format!("Option {index}"), index)).collect();
                let mut props = SelectProps::new("Pick", options);
                props.on_select = Some(Rc::new(move |_| dialogs.clear()));
                let (view, select) = select::select(cx, props);
                (view, Some(Input::Select(select)))
            }
            Kind::Prompt => {
                let on_confirm = Some(Rc::new(move |_: &str| dialogs.clear()) as select::OnText);
                let (view, prompt) =
                    prompt::prompt(cx, PromptProps { title: "Name".into(), on_confirm, ..PromptProps::default() });
                (view, Some(Input::Prompt(prompt)))
            }
            Kind::Confirm => {
                let (on_confirm, on_cancel) = (button("confirm"), button("cancel"));
                let props = ConfirmProps { title: "Sure?".into(), on_confirm, on_cancel, ..ConfirmProps::default() };
                (confirm::confirm(cx, props), None)
            }
            Kind::Alert => {
                let props = AlertProps { title: "Note".into(), message: String::new(), on_confirm: button("confirm") };
                (alert::alert(cx, props), None)
            }
        };
        *built.input.borrow_mut() = input;
        view
    };
    let close = move || {
        closing.closes.set(closing.closes.get() + 1);
        *closing.closed.borrow_mut() = closing.value();
    };
    dialogs.replace(build, Some(Box::new(close)), DialogOptions::default());
}

struct Stack;

impl Model for Stack {
    type Command = Command;

    fn generate(&self, rng: &mut Rng, steps: usize) -> Vec<Command> {
        let kinds = [Kind::Select, Kind::Prompt, Kind::Confirm, Kind::Alert];
        let keys = ["escape", "return", "ctrl+c", "backspace", "down", "tab"];
        (0..steps)
            .map(|_| match rng.below(100) {
                0..25 => Command::Open(*rng.pick(&kinds)),
                25..45 => Command::Type(*rng.pick(&['a', 'b', 'q', ' ', 'é'])),
                45..70 => Command::Key(rng.pick(&keys)),
                70..75 => Command::Pop,
                75..80 => Command::Clear,
                80..83 => Command::Outside,
                83..85 => Command::Inside,
                85..92 => Command::Route(rng.below(2) == 0),
                92..96 => Command::Toast,
                _ => Command::Resize(*rng.pick(&[40, 80, 120]), *rng.pick(&[12, 24, 40])),
            })
            .collect()
    }

    fn run(&self, commands: &[Command]) -> Option<Failure> {
        // One TUI per thread, on its own app options: one with dialogs is never freed.
        thread_local! {
            static KIT: Harness = {
                let fake = support::Fake::new(|seen| support::base(seen, support::DIRECTORY));
                let deps = Deps { config: support::config(support::still()), ..support::deps(Arc::new(fake)) };
                let app = opentui::testing::TestApp::with_options(80, 24, opencode_tui::app::options());
                let harness = support::mount_on(app, deps, opencode_tui::Args::default());
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

fn walk(harness: &Harness, commands: &[Command]) -> Option<Failure> {
    let (app, tui) = (&harness.app, &harness.tui);
    let entries = Entries::default();
    // The reference: the open dialog's kind, what its input holds, and whether a confirm's Confirm button is active.
    let (mut shown, mut value, mut yes) = (None::<Kind>, String::new(), true);
    for (step, command) in commands.iter().enumerate() {
        let fail = |site, detail: String| {
            Some(Failure { property: "dialogs", site, step, detail: format!("{detail}\n{}", app.text()) })
        };
        let (prompt, typed) = (harness.textarea(), harness.textarea().text());
        let input = shown.is_some_and(|kind| !matches!(kind, Kind::Confirm | Kind::Alert));
        let top = entries.borrow().last().cloned();
        // A select submits only while its filter matches an option.
        let matched = top.as_ref().is_none_or(|top| match top.input.borrow().as_ref() {
            Some(Input::Select(select)) => select.selected().is_some(),
            _ => true,
        });
        match command {
            Command::Open(kind) => {
                open(&tui.dialogs, &entries, *kind);
                (shown, value, yes) = (Some(*kind), String::new(), true);
            }
            Command::Type(c) => {
                app.type_text(&c.to_string());
                if input {
                    value.push(*c);
                }
            }
            // The route's own keys are not the model's: Ctrl+C would quit, and Down opens the composer.
            Command::Key(_) if shown.is_none() => {}
            Command::Key(key) => {
                app.press(key);
                let run = |button| top.as_ref().unwrap().want.borrow_mut().push(button);
                match (*key, shown) {
                    ("escape", Some(Kind::Confirm)) => (shown, ()) = (None, run("cancel")),
                    ("return", Some(Kind::Confirm)) => {
                        (shown, ()) = (None, run(if yes { "confirm" } else { "cancel" }))
                    }
                    ("return", Some(Kind::Alert)) => (shown, ()) = (None, run("confirm")),
                    ("tab", Some(Kind::Confirm)) => yes = !yes,
                    ("escape", _) => shown = None,
                    ("ctrl+c", _) if input && !value.is_empty() => value.clear(),
                    ("ctrl+c", _) => shown = None,
                    ("backspace", _) if input => drop(value.pop()),
                    ("return", Some(Kind::Select)) if !matched => {}
                    ("return", _) => shown = None,
                    _ => {}
                }
            }
            Command::Pop | Command::Clear | Command::Outside => {
                match command {
                    Command::Pop => tui.dialogs.pop(),
                    Command::Clear => tui.dialogs.clear(),
                    _ => app.click(0, app.app().size().1 - 1),
                }
                shown = None;
            }
            Command::Inside => {
                let titles = ["Pick", "Name", "Sure?", "Note"];
                if let Some((x, y)) = titles.iter().find_map(|title| support::at(&app.text(), title)) {
                    app.click(x, y);
                }
            }
            Command::Route(home) => tui.navigate(if *home { Route::Home } else { support::session_route("ses_a") }),
            Command::Toast => tui.toasts.show(ToastOptions::new(Variant::Info, "Saved")),
            Command::Resize(width, height) => app.resize(*width, *height),
        }
        settle(harness);
        let open = shown.is_some();
        if tui.dialogs.len() != usize::from(open) || (tui.keymap.mode() == "modal") != open {
            return fail("stack", format!("{} dialogs, the model {shown:?}", tui.dialogs.len()));
        }
        let entries = entries.borrow();
        let (closed, top) = entries.split_at(entries.len() - usize::from(open));
        let focused = app.focused();
        let route = harness.textarea();
        match top.first() {
            Some(top) => {
                let host = tui.dialogs.host().id();
                let path = std::iter::successors(focused.clone(), |widget| widget.parent());
                if path.clone().all(|widget| widget.id() != host) && (focused.is_some() || top.input.borrow().is_some())
                {
                    return fail("focus", format!("{:?} has the focus", focused.map(|widget| widget.id())));
                }
                if top.value().is_some_and(|shown| shown != value) || top.closes.get() != 0 {
                    return fail("input", format!("the dialog holds {:?}, the model {value:?}", top.value()));
                }
                if route.id() == prompt.id() && route.text() != typed {
                    return fail("leak", format!("the prompt under the dialog holds {:?}", route.text()));
                }
            }
            None => {
                if focused.as_ref().map(AnyWidget::id) != Some(route.id()) {
                    return fail("refocus", "the route's prompt does not have the focus".into());
                }
                if let Command::Type(c) = command
                    && !input
                    && route.text() != format!("{typed}{c}")
                {
                    return fail("typed", format!("the prompt went from {typed:?} to {:?}", route.text()));
                }
            }
        }
        if let Some(entry) = entries.iter().find(|entry| *entry.ran.borrow() != *entry.want.borrow()) {
            return fail("buttons", format!("a {:?} ran {:?}", entry.kind, entry.ran.borrow()));
        }
        let changed = |entry: &&Rc<Entry>| entry.closes.get() != 1 || entry.value() != *entry.closed.borrow();
        if let Some(entry) = closed.iter().find(changed) {
            return fail(
                "closed",
                format!("a closed {:?}: {} closes, {:?}", entry.kind, entry.closes.get(), entry.value()),
            );
        }
    }
    None
}

#[test]
fn any_walk_keeps_the_focus_on_the_top_dialog_or_the_route() {
    model::check(&Stack, 8, 32);
}

/// Tab in a dialog that does not bind it keeps the focus there, so what is typed next stays in the dialog.
#[test]
fn tab_in_a_dialog_keeps_the_focus_there() {
    assert_eq!(Stack.run(&[Command::Open(Kind::Prompt), Command::Key("tab"), Command::Type('a')]), None);
}
