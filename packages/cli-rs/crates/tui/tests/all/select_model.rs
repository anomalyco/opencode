//! A select dialog under random filters, moves, scrolls, resizes and option lists, against a reference selection.

use crate::support::model::{self, Failure, Model, Rng};

use opencode_ui::dialog::{DialogKeymap, Dialogs, route_keys};
use opencode_ui::keymap::{Keybinds, Options};
use opencode_ui::select::{self, SelectOption, SelectProps};
use opencode_ui::theme::{Catalog, ThemeMode};
use opentui::testing::TestApp;
use std::cell::RefCell;
use std::rc::Rc;

#[derive(Clone, Debug)]
enum Command {
    Type(char),
    Backspace,
    Key(&'static str),
    Resize(u16, u16),
    Scroll(bool),
    /// Options `first..first + count`, in categories when set.
    Options {
        first: usize,
        count: usize,
        categories: bool,
    },
}

const KEYS: &[&str] = &["up", "down", "pageup", "pagedown", "home", "end", "ctrl+n", "ctrl+p"];
const SIZES: &[(u16, u16)] = &[(1, 1), (8, 4), (30, 10), (40, 14), (40, 18), (72, 30), (120, 50), (300, 120)];

fn options(first: usize, count: usize, categories: bool) -> Vec<SelectOption<usize>> {
    (first..first + count)
        .map(|value| {
            let option = SelectOption::new(format!("Item {value:02}."), value);
            if categories { option.category(format!("Group {}", value % 3)) } else { option }
        })
        .collect()
}

/// The list order: the filtered options grouped by category, in order of first appearance.
fn flat(filtered: &[SelectOption<usize>]) -> Vec<usize> {
    let mut groups: Vec<(Option<String>, Vec<usize>)> = Vec::new();
    for option in filtered {
        match groups.iter_mut().find(|(category, _)| *category == option.category) {
            Some((_, members)) => members.push(option.value),
            None => groups.push((option.category.clone(), vec![option.value])),
        }
    }
    groups.into_iter().flat_map(|(_, members)| members).collect()
}

struct Selects;

impl Model for Selects {
    type Command = Command;

    fn generate(&self, rng: &mut Rng, steps: usize) -> Vec<Command> {
        (0..steps)
            .map(|_| match rng.below(100) {
                0..20 => Command::Type(*rng.pick(&['I', 't', 'e', 'm', ' ', '0', '1', '2', '5', '.', 'z'])),
                20..28 => Command::Backspace,
                28..65 => Command::Key(rng.pick(KEYS)),
                65..75 => {
                    let (width, height) = *rng.pick(SIZES);
                    Command::Resize(width, height)
                }
                75..85 => Command::Scroll(rng.below(2) == 0),
                _ => Command::Options { first: rng.below(20), count: rng.below(40), categories: rng.below(2) == 0 },
            })
            .collect()
    }

    fn run(&self, commands: &[Command]) -> Option<Failure> {
        // One app per thread: an app with dialogs is never freed, and a fresh select in it starts as a new one does.
        thread_local! {
            static KIT: (TestApp, Dialogs) = {
                let theme = Catalog::default().load("opencode", ThemeMode::Dark).unwrap().theme;
                let app = TestApp::new(72, 30);
                let keymap = Rc::new(DialogKeymap::new(Keybinds::defaults(), Options::default()));
                route_keys(&app, keymap.clone());
                let dialogs = Dialogs::new(&app, keymap, theme);
                (app, dialogs)
            };
        }
        KIT.with(|(app, dialogs)| {
            dialogs.clear();
            app.resize(72, 30);
            app.render();
            walk(app, dialogs, commands)
        })
    }

    fn simplify(&self, command: &Command) -> Vec<Command> {
        match command {
            Command::Options { first, count, categories } if *count > 1 => {
                vec![Command::Options { first: *first, count: count / 2, categories: *categories }]
            }
            _ => Vec::new(),
        }
    }
}

fn walk(app: &TestApp, dialogs: &Dialogs, commands: &[Command]) -> Option<Failure> {
    let handle = Rc::new(RefCell::new(None));
    let slot = handle.clone();
    dialogs.replace(
        move |cx| {
            let (view, select) = select::select(cx, SelectProps::new("Pick", options(0, 30, false)));
            *slot.borrow_mut() = Some(select);
            view
        },
        None,
        Default::default(),
    );
    app.render();
    let select: select::Select<usize> = handle.take().unwrap();
    // The reference: the selected position in the list, and whether a wheel scroll or new options may have left it
    // out of view.
    let (mut index, mut scrolled, mut size) = (0usize, false, (72u16, 30u16));
    for (step, command) in commands.iter().enumerate() {
        let fail = |site, detail: String| Some(Failure { property: "select", site, step, detail });
        match command {
            Command::Type(c) => app.type_text(&c.to_string()),
            Command::Backspace => app.press("backspace"),
            Command::Key(key) => app.press(key),
            Command::Resize(width, height) => {
                app.resize(*width, *height);
                size = (*width, *height);
            }
            Command::Scroll(down) => app.scroll(size.0 / 2, size.1 / 2, *down),
            Command::Options { first, count, categories } => select.set_options(options(*first, *count, *categories)),
        }
        // A scroll that waits for the list's new height shows in the frame after.
        let mut screen = app.render().text();
        if app.needs_frame() {
            screen = app.render().text();
        }
        let list = flat(&select.filtered());
        let count = list.len();
        // An empty list keeps the position, which the next list clamps.
        let step = |delta| if count == 0 { index } else { select::move_wrap(index, count, delta) };
        match command {
            Command::Type(_) | Command::Backspace if !select.filter().is_empty() => {
                if count > 0 {
                    (index, scrolled) = (0, false);
                }
            }
            Command::Key("up" | "ctrl+p") => index = step(-1),
            Command::Key("down" | "ctrl+n") => index = step(1),
            Command::Key("pageup") => index = step(-10),
            Command::Key("pagedown") => index = step(10),
            Command::Key("home") => index = 0,
            Command::Key("end") if count > 0 => index = count - 1,
            Command::Scroll(_) => scrolled = true,
            Command::Resize(..) | Command::Key(_) => {}
            // New options, and the options of a cleared filter, keep the position without scrolling to it, as TS's
            // options effect does.
            Command::Options { .. } | Command::Backspace => {
                scrolled = true;
                if count > 0 {
                    index = select::reconcile(index, count);
                }
            }
            _ if count > 0 => index = select::reconcile(index, count),
            _ => {}
        }
        if matches!(command, Command::Key(_) | Command::Resize(..)) {
            scrolled = false;
        }
        let selected = select.selected().map(|option| option.value);
        if selected != list.get(index).copied() {
            return fail("selected", format!("selected {selected:?}, the model {:?} of {list:?}", list.get(index)));
        }
        // The selected row shows unless the list scrolled or changed since the last move, or the list has too few rows
        // for it: the first option scrolls to the top, where its category's header takes a row.
        let roomy = size.0 >= 40 && size.1 >= 18;
        if let Some(value) = selected.filter(|_| roomy && !scrolled)
            && !screen.contains(&format!("Item {value:02}."))
        {
            return fail("visible", format!("Item {value:02}. is not on the screen:\n{screen}"));
        }
    }
    None
}

/// A move in a list with no rows, then a terminal tall enough for a few, shows the selected row rather than the end.
#[test]
fn a_move_while_the_list_has_no_rows_shows_the_selection_once_it_has() {
    let walk = [Command::Resize(1, 1), Command::Key("pagedown"), Command::Resize(40, 18)];
    assert_eq!(Selects.run(&walk), None);
}

#[test]
fn any_walk_keeps_the_selection_valid_and_in_view() {
    model::check(&Selects, 8, 32);
}
