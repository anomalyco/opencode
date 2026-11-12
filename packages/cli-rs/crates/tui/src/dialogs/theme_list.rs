//! Themes dialog (E.18b): `packages/tui/src/component/dialog-theme-list.tsx`, `/themes` (`theme.switch`) and
//! Settings → Theme.
//!
//! Moving, or filtering to a first match, previews the theme; Enter keeps it and Escape restores the theme the
//! dialog opened with. A preview stays in memory and only Enter writes `theme.name`; TS writes on every move and
//! writes the old name back on cancel, which leaves the same file.

use opencode_ui::select::{Select, select};

use crate::dialogs::settings::{set_path, update};
use crate::prelude::*;

/// Registers `theme.switch` ("Switch theme", `/themes`) as `app.tsx:1130-1137` does.
pub fn install(tui: &Rc<Tui>) {
    let command = TuiCommand::new("theme.switch", bind!(tui, |tui, _, _| show(&tui, None)))
        .bind(Bind::Off)
        .title("Switch theme")
        .group("System")
        .palette()
        .slash("themes");
    tui.keymap.install(
        "theme list",
        [
            KeymapLayer::global(vec![command]),
            // `appBindingCommands`: the configured keybind (`none` by default).
            KeymapLayer::default().bindings(["theme.switch"]),
        ],
    );
}

/// `DialogThemeList`, in place of any open dialog. `on_close` returns to the caller (Settings) on Escape and
/// after a pick, instead of closing every dialog.
pub fn show(tui: &Tui, on_close: Option<Rc<dyn Fn()>>) {
    let list = Rc::new(List {
        tui: tui.weak(),
        initial: tui.theme.borrow().selected().to_owned(),
        on_close,
        confirmed: Cell::new(false),
        select: RefCell::new(None),
    });
    list.open();
}

struct List {
    tui: Weak<Tui>,
    /// The theme the dialog opened with, restored unless a theme is picked.
    initial: String,
    on_close: Option<Rc<dyn Fn()>>,
    confirmed: Cell<bool>,
    select: RefCell<Option<Select<String>>>,
}

impl List {
    fn open(self: &Rc<Self>) {
        let Some(tui) = self.tui.upgrade() else { return };
        let list = self.clone();
        let rows = options(&tui);
        tui.dialogs.replace(
            move |cx| {
                let mut props = SelectProps::new("Themes", rows.clone());
                props.search_in_title = true;
                props.title_placeholder = Some("Search themes".to_owned());
                props.current = Some(list.initial.clone());
                props.on_move = Some(Rc::new({
                    let list = Rc::downgrade(&list);
                    bind!(list, |list, option| list.preview(&option.value))
                }));
                props.on_select = Some(Rc::new({
                    let list = Rc::downgrade(&list);
                    bind!(list, |list, option| list.pick(&option.value))
                }));
                props.on_filter = Some(Rc::new({
                    let list = Rc::downgrade(&list);
                    bind!(list, |list, query| list.filtered(query))
                }));
                // Escape and the close label run it.
                props.on_cancel = list.on_close.clone();
                let (view, handle) = select(cx, props);
                *list.select.borrow_mut() = Some(handle);
                // The dialog owns the list; its callbacks hold weak references.
                let owner = list.clone();
                cx.on_dismiss(move || owner.closed());
                view
            },
            None,
            DialogOptions::default(),
        );
    }

    /// `themes.set(name)` without the write.
    fn preview(&self, name: &str) {
        let Some(tui) = self.tui.upgrade() else { return };
        if tui.theme.borrow().selected() == name {
            return;
        }
        tui.theme.borrow_mut().config_name(name);
        tui.theme_changed();
    }

    /// `onFilter`: the first match, or the opening theme once the filter is empty.
    fn filtered(self: &Rc<Self>, query: &str) {
        if query.is_empty() {
            let initial = self.initial.clone();
            self.preview(&initial);
            return;
        }
        // The select filters the rows after it reports the query.
        let Some(tui) = self.tui.upgrade() else { return };
        let list = self.clone();
        tui.app.defer(move |_| {
            let first = list.select.borrow().as_ref().and_then(|select| select.filtered().into_iter().next());
            if let Some(first) = first {
                list.preview(&first.value);
            }
        });
    }

    fn pick(self: &Rc<Self>, name: &str) {
        let Some(tui) = self.tui.upgrade() else { return };
        self.confirmed.set(true);
        if tui.theme.borrow().selected() != name {
            tui.theme.borrow_mut().config_name(name);
            tui.theme_changed();
        }
        let name = Value::from(name);
        update(&tui, move |draft| set_path(draft, &["theme", "name"], name));
        match &self.on_close {
            Some(on_close) => on_close(),
            None => tui.dialogs.clear(),
        }
    }

    /// `onCleanup`: restores the opening theme unless one was picked.
    fn closed(&self) {
        if self.confirmed.get() {
            return;
        }
        let Some(tui) = self.tui.upgrade() else { return };
        if tui.theme.borrow().selected() == self.initial {
            return;
        }
        tui.theme.borrow_mut().config_name(&self.initial);
        tui.theme_changed();
    }
}

/// The theme names in `localeCompare` base order.
fn options(tui: &Tui) -> Vec<SelectOption<String>> {
    let mut names = tui.theme.borrow().names();
    names.sort_by_key(|name| name.to_lowercase());
    names.into_iter().map(|name| SelectOption::new(name.clone(), name)).collect()
}
