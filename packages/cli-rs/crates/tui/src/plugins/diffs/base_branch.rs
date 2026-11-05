//! Base branch dialog (E.15b, row DLG46, `DiffBaseDialog` in `feature-plugins/system/diff-viewer.tsx`): the
//! location's local and remote branches, searched on the server as the user types (debounced by 150 ms). The
//! chosen branch is remembered per location and branch until the TUI exits.

use opencode_api::generated::{LocationQueryInput, VcsBranchListInput};
use opencode_ui::bind;
use opencode_ui::dialog::{DIALOG_LIST_INSET, DialogOptions};
use opencode_ui::select::{self, Select, SelectOption, SelectProps};
use opentui::prelude::*;
use std::cell::{Cell, RefCell};
use std::rc::{Rc, Weak};
use std::time::Duration;

use super::viewer::Viewer;
use crate::app::Tui;

/// `createDebouncedSignal("", 150)`.
const SEARCH_DEBOUNCE: Duration = Duration::from_millis(150);
const LIMIT: i64 = 100;

#[derive(Clone)]
enum Branches {
    Loading,
    Failed,
    Ready(Vec<String>),
}

struct Picker {
    tui: Weak<Tui>,
    viewer: Weak<Viewer>,
    location: Option<LocationQueryInput>,
    key: String,
    select: RefCell<Option<Select<String>>>,
    branches: RefCell<Branches>,
    filter: RefCell<String>,
    search: RefCell<Option<String>>,
    request: Cell<u64>,
    timer: Cell<Option<TimerId>>,
}

/// "Base" in the source dialog (`onChooseBase`): replaces it with the branch picker.
pub fn open(viewer: &Viewer) {
    let Some(tui) = viewer.tui() else { return };
    let key = viewer.base_key();
    viewer.ensure_base();
    let current = viewer
        .chosen_base(&key)
        .or_else(|| viewer.reported_base(&key).flatten().map(|base| base.reference))
        .map(|reference| short(&reference).to_owned());
    let picker = Rc::new(Picker {
        tui: tui.weak(),
        viewer: viewer.weak(),
        location: viewer.location(),
        key,
        select: RefCell::new(None),
        branches: RefCell::new(Branches::Loading),
        filter: RefCell::new(String::new()),
        search: RefCell::new(None),
        request: Cell::new(0),
        timer: Cell::new(None),
    });
    let built = picker.clone();
    tui.dialogs.replace(
        move |cx| {
            let picker = built;
            let weak = Rc::downgrade(&picker);
            let mut props = SelectProps::dynamic(
                "Base branch",
                Rc::new({
                    let weak = weak.clone();
                    move |_: &str| weak.upgrade().map(|picker| picker.options()).unwrap_or_default()
                }),
            );
            props.placeholder = Some("Search local and remote branches".to_owned());
            props.skip_filter = true;
            props.current = current;
            props.on_filter = Some(Rc::new(bind!(weak, |picker, filter: &str| {
                *picker.filter.borrow_mut() = filter.to_owned();
                picker.debounce();
            })));
            props.on_select = Some(Rc::new(bind!(weak, |picker, option: &SelectOption<String>| {
                let Some(tui) = picker.tui.upgrade() else {
                    return;
                };
                let reference = option.value.clone();
                let weak = picker.viewer.clone();
                let key = picker.key.clone();
                tui.app.defer(bind!(weak, |viewer, _| {
                    if let Some(tui) = viewer.tui() {
                        tui.dialogs.clear();
                    }
                    viewer.choose_base(&key, reference);
                }));
            })));
            let empty: Rc<dyn Fn() -> AnyWidget> = Rc::new({
                let weak = weak.clone();
                let app = cx.app.clone();
                let theme = cx.theme.clone();
                move || {
                    let branches = weak.upgrade().map_or(Branches::Loading, |picker| picker.branches.borrow().clone());
                    let (text, color) = match branches {
                        Branches::Loading => ("Loading branches…", theme.text.muted),
                        Branches::Failed => {
                            ("Could not load branches. Reopen the picker to try again.", theme.text.feedback.error.base)
                        }
                        Branches::Ready(_) => ("No branches found", theme.text.muted),
                    };
                    View::new(&app).padding_x(DIALOG_LIST_INSET).child(&Text::new(&app, text).fg(color)).as_any()
                }
            });
            props.empty_view = Some(empty.clone());
            props.no_match_view = Some(empty);
            props.footer = Some(Text::new(&cx.app, "Remembered until the TUI exits").fg(cx.theme.text.muted).as_any());
            let (view, select) = select::select(cx, props);
            *picker.select.borrow_mut() = Some(select);
            cx.on_close(opentui::keymap::Disposer::new(move || {
                if let (Some(timer), Some(tui)) = (picker.timer.take(), picker.tui.upgrade()) {
                    tui.app.cancel_timer(timer);
                }
                picker.select.borrow_mut().take();
            }));
            view
        },
        None,
        DialogOptions::default(),
    );
    picker.fetch(String::new());
}

impl Picker {
    fn options(&self) -> Vec<SelectOption<String>> {
        match &*self.branches.borrow() {
            Branches::Ready(names) => names.iter().map(|name| SelectOption::new(name.clone(), name.clone())).collect(),
            _ => Vec::new(),
        }
    }

    fn debounce(self: &Rc<Self>) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        if let Some(timer) = self.timer.take() {
            tui.app.cancel_timer(timer);
        }
        self.timer.set(Some(tui.app.set_timeout(
            SEARCH_DEBOUNCE,
            bind!(self, |picker, _| {
                picker.timer.set(None);
                let search = picker.filter.borrow().clone();
                picker.fetch(search);
            }),
        )));
    }

    /// `branches`: a resource of the debounced search, read again only when the search changes.
    fn fetch(self: &Rc<Self>, search: String) {
        if self.search.borrow().as_ref() == Some(&search) {
            return;
        }
        *self.search.borrow_mut() = Some(search.clone());
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        let request = self.request.get() + 1;
        self.request.set(request);
        *self.branches.borrow_mut() = Branches::Loading;
        self.refresh();
        let client = tui.data.client().clone();
        let input = VcsBranchListInput { location: self.location.clone(), search: Some(search), limit: Some(LIMIT) };
        tui.app.spawn(
            async move { client.vcs_branch_list(&input).await },
            bind!(self, |picker, _, result| {
                if picker.request.get() != request {
                    return;
                }
                *picker.branches.borrow_mut() = match result {
                    Ok(output) => Branches::Ready(output.data),
                    Err(error) => {
                        log::warn!("diff base branches: {error}");
                        Branches::Failed
                    }
                };
                picker.refresh();
            }),
        );
    }

    fn refresh(&self) {
        let select = self.select.borrow().clone();
        if let Some(select) = select {
            select.set_options(self.options());
        }
    }
}

/// The branch name of a ref, as the list shows it.
fn short(reference: &str) -> &str {
    reference.strip_prefix("refs/heads/").or_else(|| reference.strip_prefix("refs/remotes/")).unwrap_or(reference)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refs_show_as_branch_names() {
        assert_eq!(short("refs/heads/main"), "main");
        assert_eq!(short("refs/remotes/origin/dev"), "origin/dev");
        assert_eq!(short("main"), "main");
    }
}
