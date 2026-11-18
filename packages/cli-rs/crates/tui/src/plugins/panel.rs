//! The plugins' dialogs ([`abi::Dialog`]): a prompt, a list to pick from, a confirm, an alert, and a live panel, which changes in place while its key is open
//! (TS `/btw`'s `Answer`: the header, a body that scrolls, at most 60% of the screen high, and footer actions).

use opencode_plugin::abi;
use opencode_plugin::node::{self, Act};
use opencode_ui::alert::AlertProps;
use opencode_ui::confirm::ConfirmProps;
use opencode_ui::dialog::{self, DIALOG_INSET, DialogCx, FooterAction, FooterProps, HeaderProps, MODAL_MODE};
use opencode_ui::prompt::{PromptProps, prompt};

use crate::features::session_links::{self, Links};
use crate::prelude::*;

const TOGGLE: &str = "plugins.toggle";

pub struct Live {
    key: String,
    owner: Owner,
    cx: Rc<DialogCx>,
    title: View,
    content: View,
    fit: Rc<RefCell<Option<Fit>>>,
    footer: View,
    /// The panel as last shown, which a build in a new theme shows again.
    shown: RefCell<abi::Panel>,
    binds: Rc<RefCell<Option<Disposer>>>,
    hovers: RefCell<Vec<Rc<Text>>>,
    /// The session links of the body's Markdown (`/btw` only).
    links: RefCell<Vec<Rc<Links>>>,
}

/// What sizes the body's box. Its resize handlers reach it through a slot that closing the panel empties, so a closed
/// panel's widgets hold nothing that holds them.
struct Fit {
    scroll: ScrollBox,
    content: View,
    padding: u32,
}

impl Fit {
    fn apply(&self, app: &App) {
        let height: f32 = self.content.children().iter().map(|child| child.rect().height).sum();
        self.scroll.height((height.ceil() as u32 + self.padding).clamp(1, max_rows(app)));
        app.request_redraw();
    }
}

fn max_rows(app: &App) -> u32 {
    (u32::from(app.size().1) * 6 / 10).max(8)
}

type Owner = (String, u64);

/// Shows `dialog` of activation `generation` of plugin `id`, which owns it from now on.
pub fn show(tui: &Tui, id: &str, generation: u64, dialog: abi::Dialog) {
    let owner = (id.to_owned(), generation);
    match dialog {
        abi::Dialog::Prompt(prompt) => ask(tui, owner, prompt),
        abi::Dialog::Panel(panel) => self::panel(tui, owner, panel),
        abi::Dialog::Close { key } => {
            let mine = || tui.reads.owner.borrow().as_ref().is_some_and(|(owner, _)| owner == id);
            if open(tui, id, &key) || (key.is_empty() && mine()) {
                tui.dialogs.clear();
            }
        }
        abi::Dialog::Dismissable { dialog, dismissed } => {
            *tui.reads.dismissed.borrow_mut() = Some((owner, dismissed));
            show(tui, id, generation, *dialog);
            tui.reads.dismissed.borrow_mut().take();
        }
        abi::Dialog::Select(select) => pick(tui, owner, select),
        abi::Dialog::Surface(shown) => surface(tui, owner, shown),
        abi::Dialog::Confirm(confirm) => ask_yes(tui, owner, confirm),
        abi::Dialog::Alert(alert) => tell(tui, owner, alert),
        abi::Dialog::ErrorDetails(details) => detail(tui, owner, details),
        abi::Dialog::Images(images) => {
            // An image past what the host decodes is left out, as an image node of it would show nothing.
            let shown: Vec<(String, Option<String>)> = images
                .images
                .into_iter()
                .filter(|image| {
                    let decodes = abi::base64::decode(&image.data)
                        .is_some_and(|bytes| opencode_plugin::surface::within_bounds(&bytes));
                    if !decodes {
                        log::warn!("plugin {id}: an image of its preview is not one the host decodes");
                    }
                    decodes
                })
                .map(|image| (format!("data:application/octet-stream;base64,{}", image.data), image.name))
                .collect();
            if !shown.is_empty() {
                let key = Some(format!("{id}/images"));
                own(tui, owner, |on_close| {
                    crate::dialogs::image_preview::show_closing(tui, shown, images.index, Some(on_close), key)
                });
            }
        }
    }
}

/// Plugin `id`'s `dialog`, which the host did not open: a [`abi::Dialog::Dismissable`] runs its `dismissed` as one that
/// closed with no answer does, so a plugin that waits for its answer goes on.
pub fn refused(tui: &Tui, id: &str, generation: u64, dialog: abi::Dialog) {
    if let abi::Dialog::Dismissable { dismissed, .. } = dialog {
        run(tui, &(id.to_owned(), generation), &dismissed, None);
    }
}

pub fn open(tui: &Tui, id: &str, key: &str) -> bool {
    let mine = tui.reads.owner.borrow().as_ref().is_some_and(|(owner, _)| owner == id);
    mine && tui.dialogs.key() == Some(format!("{id}/{key}"))
}

/// Closes the dialog plugin `id` opened, if it shows and the activation that opened it ended (4.14, deviation
/// `F16-plugin-dialog-ends-with-activation`). The dialogs replace each other, so the one on top is the only one.
pub fn close(tui: &Tui, id: &str) {
    let owner = tui.reads.owner.borrow().clone();
    if owner.is_some_and(|(owner, generation)| owner == id && !tui.plugins.owns(id, generation)) {
        tui.dialogs.clear();
    }
}

/// Shows a dialog of `owner` with `replace`, which gets what the dialog runs as it closes, and records the owner
/// once the dialog it replaced has closed.
fn own(tui: &Tui, owner: Owner, replace: impl FnOnce(Box<dyn FnOnce()>)) {
    let showing = tui.reads.showings.get() + 1;
    tui.reads.showings.set(showing);
    let dismissed = tui.reads.dismissed.borrow_mut().take().filter(|(of, _)| *of == owner);
    replace(Box::new(bind!(tui, |tui| {
        // The owner of this showing, also once a reload's activation updated it in place.
        if tui.reads.showing.get() == showing {
            tui.reads.owner.borrow_mut().take();
        }
        // After the dialog's own action, which an answer runs once the event that closed it is handled.
        if let Some((owner, action)) = dismissed {
            tui.app.defer(bind!(tui, |tui, _| run(&tui, &owner, &action, None)));
        }
    })));
    *tui.reads.owner.borrow_mut() = Some(owner);
    tui.reads.showing.set(showing);
}

fn ask(tui: &Tui, owner: Owner, asked: abi::Prompt) {
    let (weak, clear, confirmed) = (tui.weak(), tui.dialogs.clone(), owner.clone());
    let abi::Prompt { title, placeholder, value, description, action, .. } = asked;
    // The field is one row: a line break would scroll the text out of it (deviation CF3-plugin-prompt).
    let value = value
        .as_deref()
        .map(|value| bounded(value).split(['\r', '\n']).filter(|line| !line.is_empty()).collect::<Vec<_>>().join(" "));
    let description: Option<Rc<str>> = description.as_deref().map(|text| bounded(text).into());
    own(tui, owner, |on_close| {
        tui.dialogs.replace(
            move |cx| {
                let (clear, owner, action) = (clear.clone(), confirmed.clone(), action.clone());
                let on_confirm = bind!(weak, |tui, value: &str| {
                    tui.dialogs.clear();
                    run(&tui, &owner, &action, Some(value));
                });
                // TS draws the description as a text of its own above the field (`<text>{description}</text>`), in
                // OpenTUI's default text color; here in the color of the host's own prompt descriptions, over a few
                // rows, so the field stays on screen.
                let description = description.clone().map(|text| {
                    Rc::new(move |cx: &DialogCx| {
                        Text::new(&cx.app, &*text).fg(cx.theme.text.muted).max_height(DESCRIPTION_ROWS).as_any()
                    }) as opencode_ui::prompt::Description
                });
                let (view, _) = prompt(
                    cx,
                    PromptProps {
                        title: title.clone(),
                        placeholder: placeholder.clone(),
                        value: value.clone(),
                        description,
                        on_confirm: Some(Rc::new(on_confirm)),
                        on_cancel: Some(Rc::new(move || clear.clear())),
                        ..PromptProps::default()
                    },
                );
                view
            },
            Some(on_close),
            DialogOptions::default(),
        )
    });
}

const DESCRIPTION_ROWS: u32 = 8;

fn bounded(text: &str) -> &str {
    &text[..text.floor_char_boundary(opencode_plugin::limits::get().text as usize)]
}

/// The rich select on screen (synthesis 4.10): the select the plugin showed last, which a select of the same key
/// replaces in place, keeping the filter and the selected row.
pub struct Picker {
    key: String,
    owner: RefCell<Owner>,
    shown: RefCell<abi::Select>,
    handle: RefCell<Option<opencode_ui::select::Select<String>>>,
}

fn pick(tui: &Tui, owner: Owner, select: abi::Select) {
    let keyed = select.key.as_ref().map(|key| format!("{}/{key}", owner.0));
    if let Some(keyed) = &keyed
        && open(tui, &owner.0, select.key.as_deref().unwrap_or_default())
    {
        let picker = tui.reads.select.borrow().clone().filter(|picker| picker.key == *keyed);
        // Its footer actions' keys and its extra keys are the dialog's layer, built with it; what else an action holds
        // it reads as it shows.
        let keys = |actions: &[abi::SelectAction]| -> Vec<_> {
            actions
                .iter()
                .map(|action| (action.key.clone(), action.command.clone(), action.rowless, action.primary))
                .collect()
        };
        let same = |picker: &Picker| {
            let shown = picker.shown.borrow();
            keys(&shown.actions) == keys(&select.actions)
                && shown.binds == select.binds
                && (&shown.title, &shown.placeholder, shown.size, &shown.search, shown.centered)
                    == (&select.title, &select.placeholder, select.size, &select.search, select.centered)
                && (&shown.query, shown.query_delay, shown.filterless, &shown.focus, &shown.note)
                    == (&select.query, select.query_delay, select.filterless, &select.focus, &select.note)
                && shown.empty.is_some() == select.empty.is_some()
                && shown.current == select.current
        };
        let handle = picker.as_ref().and_then(|picker| picker.handle.borrow().clone());
        match (picker, handle) {
            (Some(picker), Some(handle)) if same(&picker) => {
                *picker.shown.borrow_mut() = select;
                *picker.owner.borrow_mut() = owner.clone();
                *tui.reads.owner.borrow_mut() = Some(owner);
                let theme = opencode_ui::theme::Theme::clone(&tui.page());
                // The footer draws again only if what it shows changed, so a press on it is not lost to a rebuild.
                handle.set_options(options(&theme, &picker.shown.borrow()));
                tui.app.request_redraw();
                return;
            }
            (_, Some(handle)) => {
                let kept = (handle.filter(), handle.selected().map(|option| option.value));
                return list(tui, owner, select, Some(kept));
            }
            _ => {}
        }
    }
    list(tui, owner, select, None);
}

fn list(tui: &Tui, owner: Owner, select: abi::Select, kept: Option<(String, Option<String>)>) {
    let keyed = select.key.as_ref().map(|key| format!("{}/{key}", owner.0));
    let left = tui.reads.kept.borrow_mut().take();
    let kept = kept.or_else(|| left.filter(|(key, _)| Some(key) == keyed.as_ref()).map(|(_, kept)| kept));
    let picker = Rc::new(Picker {
        key: keyed.clone().unwrap_or_default(),
        owner: RefCell::new(owner.clone()),
        shown: RefCell::new(select),
        handle: RefCell::default(),
    });
    *tui.reads.select.borrow_mut() = keyed.is_some().then(|| picker.clone());
    let (size, centered) = {
        let shown = picker.shown.borrow();
        (shown.size.map(dialog_size).unwrap_or_default(), shown.centered)
    };
    let dialog = keyed.as_ref().map_or(DialogOptions::new(size), |key| DialogOptions::new(size).key(key.clone()));
    let kept = RefCell::new(kept);
    own(tui, owner, |on_close| {
        // Closed or replaced, it is no longer the select on screen, and drops its handle.
        let closed = Rc::downgrade(&picker);
        let on_close: Box<dyn FnOnce()> = Box::new(bind!(tui, |tui| {
            on_close();
            let mine =
                tui.reads.select.borrow().as_ref().is_some_and(|shown| Weak::ptr_eq(&Rc::downgrade(shown), &closed));
            if mine {
                tui.reads.select.borrow_mut().take();
            }
        }));
        tui.dialogs.replace(
            bind!(tui, |tui, cx| {
                let shown = picker.shown.borrow().clone();
                let theme = cx.theme.page();
                let weak = Rc::downgrade(&picker);
                let mut props = SelectProps::dynamic(
                    shown.title.clone(),
                    Rc::new(move |_: &str| {
                        weak.upgrade().map_or_else(Vec::new, |picker| options(&theme, &picker.shown.borrow()))
                    }),
                );
                props.placeholder = shown.placeholder.clone();
                props.current = shown.current.clone();
                props.skip_filter = shown.query.is_some() || shown.filterless;
                props.render_filter = !shown.filterless;
                if shown.query.is_some() {
                    props.on_filter = Some(query(&tui, &picker));
                }
                if shown.empty.is_some() {
                    let (empty, app, theme) = (Rc::downgrade(&picker), cx.app.clone(), cx.theme.clone());
                    let view: Rc<dyn Fn() -> AnyWidget> = Rc::new(move || {
                        let span = empty.upgrade().and_then(|picker| picker.shown.borrow().empty.clone());
                        let text = span.map(|span| styled(&app, &theme, &span)).unwrap_or_else(|| Text::new(&app, ""));
                        View::new(&app).padding_x(opencode_ui::dialog::DIALOG_LIST_INSET).child(&text).as_any()
                    });
                    props.empty_view = Some(view.clone());
                    props.no_match_view = Some(view);
                }
                if let Some(note) = &shown.note {
                    props.footer = Some(styled(&cx.app, &cx.theme, note).as_any());
                }
                props.focus_target = shown.focus.clone();
                props.preserve_selection = shown.key.is_some();
                if let Some(name) = shown.search.clone() {
                    let searched = Rc::downgrade(&picker);
                    props.search = Some(Rc::new(bind!(tui.weak(), |tui, query: &str| {
                        let Some(picker) = searched.upgrade() else { return Vec::new() };
                        let (owner, shown) = (picker.owner.borrow().clone(), picker.shown.borrow().clone());
                        let enabled: Vec<abi::SelectOption> =
                            shown.options.iter().filter(|option| !option.disabled).cloned().collect();
                        let host = super::host::host(&tui);
                        let values = tui.plugins.search(&*host, &owner.0, &name, query, &enabled);
                        let theme = opencode_ui::theme::Theme::clone(&tui.page());
                        let rows = options(&theme, &shown);
                        values
                            .unwrap_or_default()
                            .iter()
                            .filter_map(|value| rows.iter().find(|row| row.value == *value).cloned())
                            .collect()
                    }, else Vec::new())));
                }
                let picked = Rc::downgrade(&picker);
                props.on_select = Some(Rc::new(bind!(tui.weak(), |tui, option: &SelectOption<String>| {
                    if let Some(picker) = picked.upgrade() {
                        picker.choose(&tui, &option.value);
                    }
                })));
                props.actions = actions(&tui, &picker);
                props.actions.push(toggle(&tui, &picker));
                props.bindings = binds(&tui, &picker);
                let (view, handle) = opencode_ui::select::select(cx, props);
                *picker.handle.borrow_mut() = Some(handle.clone());
                if let Some((filter, selected)) = kept.borrow_mut().take() {
                    handle.set_filter(&filter);
                    if let Some(selected) = selected {
                        handle.move_to(&selected);
                    }
                }
                // The first footer was drawn before the hints could see the selection.
                handle.refresh_footer();
                view
            }, else View::new(&cx.app)),
            Some(on_close),
            dialog,
        )
    });
    tui.dialogs.set_centered(centered);
}

/// A text of `span` in `theme`, its color `text.base` unless it names one.
fn styled(app: &App, theme: &opencode_ui::theme::Theme, span: &abi::Span) -> Text {
    let fg = span.fg.as_ref().and_then(|fg| node::color_of(theme, fg)).unwrap_or(theme.text.base);
    Text::new(app, span.text.clone()).fg(fg)
}

/// What a select with a query does as its filter changes (P6c): once the text has stayed the select's delay, its action
/// runs with the text, as TS's debounced `onFilter` (`createDebouncedSignal`).
fn query(tui: &Tui, picker: &Rc<Picker>) -> Rc<dyn Fn(&str)> {
    let (weak, timer) = (Rc::downgrade(picker), Rc::new(Cell::new(None::<TimerId>)));
    Rc::new(bind!(tui.weak(), |tui, text: &str| {
        let Some(picker) = weak.upgrade() else { return };
        if let Some(previous) = timer.take() {
            tui.app.cancel_timer(previous);
        }
        let delay = Duration::from_millis(u64::from(picker.shown.borrow().query_delay));
        let (picker, text, fired) = (Rc::downgrade(&picker), text.to_owned(), timer.clone());
        timer.set(Some(tui.app.set_timeout(
            delay,
            bind!(tui.weak(), |tui, _| {
                fired.set(None);
                let Some(picker) = picker.upgrade() else { return };
                let (owner, action) = (picker.owner.borrow().clone(), picker.shown.borrow().query.clone());
                if let (Some(action), true) = (action, picker.handle.borrow().is_some()) {
                    run(&tui, &owner, &action, Some(&text));
                }
            }),
        )));
    }))
}

fn toggle(tui: &Tui, picker: &Rc<Picker>) -> opencode_ui::select::SelectAction<String> {
    use opencode_ui::select::{Group, SelectAction};
    let target = {
        let (tui, picker) = (tui.weak(), Rc::downgrade(picker));
        move |option: Option<&SelectOption<String>>| -> Option<(opencode_plugin::Entry, Toggle, String)> {
            let (tui, picker, option) = (tui.upgrade()?, picker.upgrade()?, option?);
            let plugin = picker
                .shown
                .borrow()
                .options
                .iter()
                .find(|row| row.value == option.value && !row.disabled)
                .and_then(|row| row.toggle.clone())?;
            let caller = picker.owner.borrow().0.clone();
            let (entry, toggle) = toggled(&tui, &caller, &plugin)?;
            Some((entry, toggle, option.title.clone()))
        }
    };
    let (titled, hidden) = (target.clone(), target);
    let (weak, picked) = (tui.weak(), Rc::downgrade(picker));
    let mut action = SelectAction::new(
        TOGGLE,
        "toggle",
        bind!(weak, |tui, option: &SelectOption<String>| {
            let Some(picker) = picked.upgrade() else { return };
            let Some(plugin) = picker.toggled(&option.value) else { return };
            // Only the user toggles a plugin: a key or a click, never a run of the command by name.
            if picker.handle.borrow().as_ref().is_some_and(|handle| handle.by_input()) {
                picker.toggle(&tui, &option.value, &plugin);
            }
        }),
    );
    action.title = Rc::new(move |option| match titled(option) {
        Some((entry, toggle, title)) => {
            let named = if title == entry.id { String::new() } else { format!(" {}", entry.id) };
            match toggle {
                Toggle::Switch(true) => format!("disable{named}"),
                Toggle::Switch(false) => format!("enable{named}"),
                Toggle::Ask(_) => "approve or decline".to_owned(),
            }
        }
        None => "toggle".to_owned(),
    });
    action.group = Some(Group::Primary);
    action.hidden_when = Some(Rc::new(move |option| hidden(option).is_none()));
    action
}

impl Picker {
    fn toggled(&self, value: &str) -> Option<String> {
        let shown = self.shown.borrow();
        shown.options.iter().find(|option| option.value == value && !option.disabled)?.toggle.clone()
    }

    /// Picks the row of `value`: a toggle, the row's action, or the select's; a plain select closes first.
    fn choose(self: &Rc<Self>, tui: &Tui, value: &str) {
        let shown = self.shown.borrow().clone();
        let owner = self.owner.borrow().clone();
        let Some(option) = shown.options.iter().find(|option| option.value == value && !option.disabled) else {
            return;
        };
        if let Some(plugin) = &option.toggle {
            // Only the user toggles a plugin: a key or a click, never a run of the command by name (synthesis 3.6).
            let by_input = self.handle.borrow().as_ref().is_some_and(|handle| handle.by_input());
            if !by_input {
                log::warn!("plugin {}: a row toggles a plugin only on a key or a click", owner.0);
                return;
            }
            return self.toggle(tui, value, plugin);
        }
        if shown.key.is_none() {
            tui.dialogs.clear();
        }
        let action = option.action.as_ref().unwrap_or(&shown.action);
        run(tui, &owner, action, Some(value));
    }

    /// Enables or disables `plugin` for the row of `value`, as the host does (synthesis 3.6): never the caller itself
    /// or the plugin manager, after the key is handled, and only if the row still names that plugin then.
    fn toggle(self: &Rc<Self>, tui: &Tui, value: &str, plugin: &str) {
        let caller = self.owner.borrow().0.clone();
        if toggled(tui, &caller, plugin).is_none() {
            log::warn!("plugin {caller}: a row may not toggle {plugin}");
            return;
        }
        let (picker, value, plugin) = (Rc::downgrade(self), value.to_owned(), plugin.to_owned());
        tui.app.defer(bind!(tui, |tui, _| {
            let Some(picker) = picker.upgrade() else { return };
            let owner = picker.owner.borrow().clone();
            let names = picker.shown.borrow().options.iter().any(|option| {
                option.value == value && !option.disabled && option.toggle.as_deref() == Some(plugin.as_str())
            });
            // No close or end of the plugin can come between the key and this: the app runs what is deferred after each
            // event, and a plugin that leaves `active` closes its dialogs first.
            if !names {
                return;
            }
            let (entry, active) = match toggled(&tui, &owner.0, &plugin) {
                Some((entry, Toggle::Switch(active))) => (entry, active),
                // The host's question, after which the list comes back on the row, unless a dialog replaced it.
                Some((_, Toggle::Ask(target))) => {
                    // The question replaces the select, which then holds the picker no more. The row's own action
                    // asks its plugin for the list as it is now (review bigboi-5); without one, the list as it was.
                    let (shown, value) = (picker.shown.borrow().clone(), value.clone());
                    let then =
                        shown.options.iter().find(|option| option.value == value).and_then(|row| row.action.clone());
                    let filter = picker.handle.borrow().as_ref().map(|handle| handle.filter()).unwrap_or_default();
                    let keyed = picker.key.clone();
                    return super::approve::ask(
                        &tui,
                        &target,
                        bind!(tui, |tui| {
                            if tui.dialogs.is_open() || !tui.plugins.live(&owner.0, owner.1) {
                                return;
                            }
                            let kept = (filter.clone(), Some(value.clone()));
                            match &then {
                                Some(action) => {
                                    tui.reads.kept.replace(Some((keyed.clone(), kept)));
                                    run(&tui, &owner, action, Some(&value));
                                }
                                None => list(&tui, owner.clone(), shown.clone(), Some(kept)),
                            }
                        }),
                    );
                }
                None => return,
            };
            match tui.plugins.toggle_entry(&super::host::host(&tui), &entry.key, !active) {
                None => {
                    tui.toasts.error(format!("Failed to update plugin {}", entry.id));
                    return;
                }
                Some(Err(error)) => tui.toasts.error(error),
                Some(Ok(())) => {}
            }
            tui.navigate(tui.route());
            // The hints say what the registry holds now; the rows are the plugin's, which hears of the change.
            if let Some(handle) = picker.handle.borrow().clone() {
                handle.refresh_footer();
            }
            super::host::tell_plugins(&tui);
        }));
    }
}

enum Toggle {
    Switch(bool),
    Ask(String),
}

/// What a toggle of the entry `name` does for plugin `caller`'s select: `name` is an entry's key, or the ID of a plugin
/// of the registry. `None` for an entry it cannot toggle, one that never loaded, and any entry of the caller's ID or
/// the plugin manager's.
fn toggled(tui: &Tui, caller: &str, name: &str) -> Option<(opencode_plugin::Entry, Toggle)> {
    let entries = tui.plugins.entries();
    let plugin = opencode_plugin::Entry::plugin_key(name);
    // A target names the entry it is now: a project's build keeps its target once approved (review carbon-2).
    let entry = entries
        .iter()
        .find(|entry| entry.key == name)
        .or_else(|| entries.iter().find(|entry| entry.key == plugin))
        .or_else(|| entries.iter().find(|entry| entry.target.as_deref() == Some(name)))?;
    // Never the caller or the manager that runs: a held build of their ID is another plugin (review carbon-3).
    let refused = [opencode_plugin::Entry::plugin_key(caller), opencode_plugin::Entry::plugin_key(super::manager::ID)];
    if refused.contains(&entry.key) {
        return None;
    }
    if matches!(entry.status, opencode_plugin::Status::Pending | opencode_plugin::Status::Declined) {
        let target = entry.target.clone().unwrap_or_else(|| entry.id.clone());
        return Some((entry.clone(), Toggle::Ask(target)));
    }
    (entry.source != opencode_plugin::Source::Configured).then(|| (entry.clone(), Toggle::Switch(entry.active)))
}

fn options(theme: &opencode_ui::theme::Theme, select: &abi::Select) -> Vec<SelectOption<String>> {
    select
        .options
        .iter()
        .map(|option| {
            let mut item = SelectOption::new(option.title.clone(), option.value.clone());
            item.description = option.description.clone();
            item.footer = option.footer.clone();
            item.category = option.category.clone();
            item.disabled = option.disabled;
            item.search_text = option.search_text.clone();
            item.footer_color = option.footer_color.as_ref().and_then(|color| node::color_of(theme, color));
            item.gutter = option.gutter.as_ref().map(|gutter| -> opencode_ui::select::Gutter {
                match gutter {
                    abi::Gutter::Spinner => {
                        Rc::new(|app: &App, color: Color| opencode_ui::motion::Spinner::new(app).color(color).as_any())
                    }
                    abi::Gutter::Span(span) => {
                        let (text, fg) = (span.text.clone(), span.fg.as_ref().and_then(|fg| node::color_of(theme, fg)));
                        Rc::new(move |app: &App, color: Color| {
                            Text::new(app, text.clone()).fg(fg.unwrap_or(color)).as_any()
                        })
                    }
                }
            });
            item
        })
        .collect()
}

/// The select's footer actions on the selected row. Each reads its title, the rows it hides on, whether it is disabled
/// and what it runs from the select as last shown, so a select shown again with only those changed stays in place.
fn actions(tui: &Tui, picker: &Rc<Picker>) -> Vec<opencode_ui::select::SelectAction<String>> {
    use opencode_ui::select::{ActionRun, Group, SelectAction};
    let shown = picker.shown.borrow().clone();
    shown
        .actions
        .iter()
        .enumerate()
        .filter(|(_, action)| usable_action(tui, action))
        .map(|(index, action)| {
            let weak = Rc::downgrade(picker);
            let read = move |f: &dyn Fn(&abi::SelectAction) -> bool| {
                weak.upgrade().is_some_and(|picker| picker.shown.borrow().actions.get(index).is_some_and(f))
            };
            let runs = |value: bool| {
                let weak = Rc::downgrade(picker);
                bind!(tui.weak(), |tui, option: Option<&str>| {
                    let Some(picker) = weak.upgrade() else { return };
                    let action = picker.shown.borrow().actions.get(index).map(|action| action.action.clone());
                    let owner = picker.owner.borrow().clone();
                    if let Some(action) = action {
                        run(&tui, &owner, &action, option.filter(|_| value));
                    }
                })
            };
            // As TS's `group`: the first group for a row's action, the second for a rowless one.
            let group = match action.primary.unwrap_or(!action.rowless) {
                true => Group::Primary,
                false => Group::Secondary,
            };
            let on_row = runs(true);
            let mut item = SelectAction::new(
                action.command.clone().unwrap_or_else(|| format!("plugin.select.{index}")),
                action.title.clone(),
                move |option: &SelectOption<String>| on_row(Some(&option.value)),
            );
            let titled = Rc::downgrade(picker);
            item.title = Rc::new(move |_| {
                titled
                    .upgrade()
                    .and_then(|picker| picker.shown.borrow().actions.get(index).map(|action| action.title.clone()))
                    .unwrap_or_default()
            });
            // A keybind name the config knows takes only the config's keys, so the user's `none` turns it off; `key`
            // is for a name of the plugin's own.
            let known = action
                .command
                .as_deref()
                .is_some_and(|name| opencode_ui::keymap::DEFINITIONS.iter().any(|definition| definition.name == name));
            item.bind = if known { None } else { action.key.clone() };
            item.group = Some(group);
            let disabled = read.clone();
            item.disabled = Some(Rc::new(move |_: Option<&SelectOption<String>>| disabled(&|action| action.disabled)));
            match action.rowless {
                // It needs no row: shown and run also while none matches, with no value.
                true => {
                    let rowless = runs(false);
                    item.run = ActionRun::Dialog(Rc::new(move || rowless(None)));
                    item.hidden_when = Some(Rc::new(move |_: Option<&SelectOption<String>>| read(&|a| a.hidden_all)));
                }
                false => {
                    item.hidden_when = Some(Rc::new(move |option: Option<&SelectOption<String>>| {
                        option.is_none_or(|option| {
                            read(&|action| action.hidden_all || action.hidden.contains(&option.value))
                        })
                    }));
                }
            }
            item
        })
        .collect()
}

/// Whether the select's action `action` can be the dialog's: its keys parse and are not the reserved chord, and its
/// keybind name is not one the host's own select uses, which it would take over (review carbon-1). The host's keymap
/// refuses an empty name or key, which would end the TUI.
fn usable_action(tui: &Tui, action: &abi::SelectAction) -> bool {
    let command = action
        .command
        .as_deref()
        .is_none_or(|name| !name.trim().is_empty() && name != TOGGLE && !name.starts_with("dialog.select."));
    let usable = command && action.key.as_deref().is_none_or(|key| usable_key(tui, key));
    if !usable {
        log::warn!("a plugin's select action {:?} cannot be bound; it is left out", action.title);
    }
    usable
}

/// Whether `key` parses as keys of the host's keymap and holds neither the reserved chord nor escape: the dialog's two
/// close keys, which a plugin's layer above them would take, keeping the user in its dialog (review carbon-5).
fn usable_key(tui: &Tui, key: &str) -> bool {
    let keymap = tui.keymap.keymap();
    let closing: Vec<_> = ["escape", opencode_plugin::abi::interact::RESERVED]
        .into_iter()
        .filter_map(|key| keymap.parse_key(key).ok().map(|chord| chord.stroke))
        .collect();
    tui.keymap.parse_binding(key).is_ok_and(|bindings| {
        bindings.iter().all(|parts| !parts.is_empty() && parts.iter().all(|part| !closing.contains(&part.stroke)))
    })
}

fn binds(tui: &Tui, picker: &Rc<Picker>) -> Vec<TuiCommand> {
    let shown = picker.shown.borrow().clone();
    shown
        .binds
        .into_iter()
        .filter(|bind| usable_key(tui, &bind.key))
        .map(|bind| {
            let (weak, action) = (Rc::downgrade(picker), bind.action);
            TuiCommand::inline(
                bind.key,
                bind!(tui.weak(), |tui, _, _| {
                    let Some(picker) = weak.upgrade() else { return };
                    let owner = picker.owner.borrow().clone();
                    let value =
                        picker.handle.borrow().as_ref().and_then(|handle| handle.selected()).map(|option| option.value);
                    run(&tui, &owner, &action, value.as_deref());
                }),
            )
            .title(bind.title)
            .group("Dialog")
        })
        .collect()
}

fn detail(tui: &Tui, owner: Owner, details: abi::ErrorDetails) {
    let large = DialogOptions::new(DialogSize::Large);
    let dialog = match &details.key {
        Some(key) => large.key(format!("{}/{key}", owner.0)),
        None => large,
    };
    let backed = owner.clone();
    own(tui, owner, |on_close| {
        tui.dialogs.replace(
            bind!(tui, |tui, cx| {
                let (owner, back) = (backed.clone(), details.back.clone());
                let on_back: Rc<dyn Fn()> = Rc::new(bind!(tui.weak(), |tui| {
                    tui.dialogs.clear();
                    if let Some(back) = &back {
                        run(&tui, &owner, back, None);
                    }
                }));
                // A TUI plugin's own error, which only the host reads (review bigboi-2).
                let error = details.plugin.as_deref().and_then(|key| plugin_error(&tui, key));
                let props = crate::dialogs::error_details::Props {
                    title: details.title.clone(),
                    source: details.source.clone(),
                    error: error.unwrap_or_else(|| details.error.clone()),
                    context: details.context.clone(),
                    diagnostic_ref: details.reference.clone(),
                    on_back,
                };
                crate::dialogs::error_details::view(&tui, cx, props)
            }, else View::new(&cx.app)),
            Some(on_close),
            dialog,
        )
    });
}

fn plugin_error(tui: &Tui, key: &str) -> Option<String> {
    let entry = tui.plugins.entries().into_iter().find(|entry| entry.key == key)?;
    match entry.status {
        opencode_plugin::Status::Failed(error) | opencode_plugin::Status::Skipped(error) => Some(error),
        _ => None,
    }
}

fn ask_yes(tui: &Tui, owner: Owner, confirm: abi::Confirm) {
    let (size, centered) = (confirm.size.map(dialog_size).unwrap_or_default(), confirm.centered);
    let (weak, answered) = (tui.weak(), owner.clone());
    own(tui, owner, |on_close| {
        tui.dialogs.replace(
            move |cx| {
                let answer = |value: &'static str| -> Rc<dyn Fn()> {
                    let (owner, action) = (answered.clone(), confirm.action.clone());
                    Rc::new(bind!(weak, |tui| run(&tui, &owner, &action, Some(value))))
                };
                opencode_ui::confirm::confirm(
                    cx,
                    ConfirmProps {
                        title: confirm.title.clone(),
                        message: confirm.message.clone(),
                        on_confirm: Some(answer("true")),
                        on_cancel: Some(answer("false")),
                        confirm_label: confirm.label.confirm.clone(),
                        cancel_label: confirm.label.cancel.clone(),
                        ..ConfirmProps::default()
                    },
                )
            },
            Some(on_close),
            DialogOptions::new(size),
        )
    });
    tui.dialogs.set_centered(centered);
}

/// TS `dialog.alert`: however the alert closes, its action runs once after.
fn tell(tui: &Tui, owner: Owner, alert: abi::Alert) {
    let (size, centered) = (alert.size.map(dialog_size).unwrap_or_default(), alert.centered);
    let props = AlertProps { title: alert.title, message: alert.message, on_confirm: None };
    let (weak, closed) = (tui.weak(), owner.clone());
    own(tui, owner, |on_close| {
        let on_close = Box::new(move || {
            on_close();
            if let (Some(tui), Some(action)) = (weak.upgrade(), &alert.action) {
                run(&tui, &closed, action, None);
            }
        });
        tui.dialogs.replace(
            move |cx| opencode_ui::alert::alert(cx, props.clone()),
            Some(on_close),
            DialogOptions::new(size),
        )
    });
    tui.dialogs.set_centered(centered);
}

/// A plugin's dialog surface on screen (TS `ui.dialog.show`): the frame, with a header when it has a title, and in its
/// body the mount of the plugin's surface, which ends as the dialog closes. Built again in a new theme, it keeps its
/// widgets and the mount.
pub struct Body {
    key: String,
    /// The key the plugin named, which the mount's ID has.
    named: String,
    surface: String,
    owner: RefCell<Owner>,
    title: RefCell<Option<String>>,
    frame: View,
    header: View,
    /// The body's bounded scroll, which holds the body while it is taller than the room the screen leaves: it then
    /// scrolls, and a focused node in it shows. A body that fits sits in the frame itself, laid out as TS's.
    scroll: ScrollBox,
    /// The rows the screen leaves the body, and whether the scroll holds it.
    room: Cell<u32>,
    wrapped: Cell<bool>,
    body: View,
    /// The build of the moment, which the header is drawn in.
    cx: RefCell<Option<Rc<DialogCx>>>,
    mount: RefCell<Option<opencode_plugin::PanelMount>>,
    /// What runs as the dialog closes for the requests that changed it in place (`abi::Dialog::Dismissable`).
    dismissed: RefCell<Vec<(Owner, abi::Action)>>,
    /// A node that took the focus before a solve laid it out, which the scroll brings into view once one does.
    revealing: RefCell<Option<opentui::widget::WeakWidget>>,
}

/// Shows `shown`: a new mount of the plugin's dialog surface, or, under the key that is open, the same mount in a frame
/// changed in place.
fn surface(tui: &Tui, owner: Owner, shown: abi::DialogSurface) {
    let key = format!("{}/{}", owner.0, shown.shown_key());
    let (size, centered) = (shown.size.map(dialog_size).unwrap_or_default(), shown.centered);
    let open = open(tui, &owner.0, shown.shown_key()).then(|| tui.reads.surface.borrow().clone()).flatten();
    if let Some(body) = open.filter(|body| body.key == key && body.surface == shown.surface) {
        // A request that changes it in place and waits for its close hears it too (big-boi ds-10).
        let dismissed = tui.reads.dismissed.borrow_mut().take().filter(|(of, _)| *of == owner);
        body.dismissed.borrow_mut().extend(dismissed);
        *body.owner.borrow_mut() = owner.clone();
        *body.title.borrow_mut() = shown.title;
        body.draw_header();
        tui.dialogs.set_size(size);
        tui.dialogs.set_centered(centered);
        body.fit(tui);
        *tui.reads.owner.borrow_mut() = Some(owner);
        tui.app.request_redraw();
        return;
    }
    if !tui.plugins.has_dialog(&owner.0, &shown.surface) {
        log::warn!("plugin {}: it has no dialog surface {:?}", owner.0, shown.surface);
        // A plugin that waits for its answer hears it closed.
        if let Some((owner, action)) = tui.reads.dismissed.borrow_mut().take() {
            run(tui, &owner, &action, None);
        }
        return;
    }
    let app = &tui.app;
    let (header, body) = (View::new(app), View::new(app).column().focusable(true));
    // As high as the body, up to the screen's room: a taller body scrolls rather than leaving the screen (big-boi ds-9).
    let scroll = ScrollBox::new(app)
        .scrollbar_colors(Color::rgb(0x9a, 0x9e, 0xa3), Color::rgb(0x25, 0x25, 0x27))
        .min_height(0)
        .shrink(0.0);
    let frame = View::new(app).column().child(&header).child(&body);
    let shown = Rc::new(Body {
        key: key.clone(),
        named: shown.shown_key().to_owned(),
        surface: shown.surface,
        owner: RefCell::new(owner.clone()),
        title: RefCell::new(shown.title),
        frame,
        header,
        scroll,
        body,
        cx: RefCell::default(),
        mount: RefCell::default(),
        dismissed: RefCell::default(),
        revealing: RefCell::default(),
        room: Cell::new(u32::MAX),
        wrapped: Cell::new(false),
    });
    // Once a layout placed the body, after the frame that laid it out, as the scroll reads that frame's positions.
    let laid = Rc::downgrade(&shown);
    shown.body.on_resize(move |cx, _| {
        let Some(body) = laid.upgrade() else { return };
        body.wrap(cx.app());
        if body.revealing.borrow().is_none() {
            return;
        }
        let laid = laid.clone();
        cx.app().set_timeout(Duration::ZERO, move |_| {
            let Some(body) = laid.upgrade() else { return };
            let widget = body.revealing.borrow_mut().take().and_then(|widget| widget.upgrade());
            if let Some(widget) = widget.filter(|_| body.overflows()) {
                body.scroll.scroll_into_view(&widget);
            }
        });
    });
    *tui.reads.surface.borrow_mut() = Some(shown.clone());
    let closed = Rc::downgrade(&shown);
    own(tui, owner, |on_close| {
        let on_close: Box<dyn FnOnce()> = Box::new(bind!(tui, |tui| {
            on_close();
            let mine =
                tui.reads.surface.borrow().as_ref().is_some_and(|body| Weak::ptr_eq(&Rc::downgrade(body), &closed));
            if mine {
                tui.reads.surface.borrow_mut().take();
            }
            // The mount ends now, so nothing it asked for after the close goes out; its handler hears it closed, as
            // the plugin's call, after the event that closed it.
            let body = closed.upgrade();
            let mount = body.as_ref().and_then(|body| body.mount.borrow_mut().take());
            if let Some(tell) = mount.and_then(opencode_plugin::PanelMount::close) {
                tui.app.defer(bind!(tui, |tui, _| tell(&*super::host::host(&tui))));
            }
            let dismissed = body.map(|body| body.dismissed.take()).unwrap_or_default();
            for (owner, action) in dismissed {
                tui.app.defer(bind!(tui, |tui, _| run(&tui, &owner, &action, None)));
            }
        }));
        tui.dialogs.replace(
            bind!(tui, |tui, cx| shown.build(&tui, cx), else View::new(&cx.app)),
            Some(on_close),
            DialogOptions::new(size).key(key),
        )
    });
    tui.dialogs.set_centered(centered);
    if let Some(body) = tui.reads.surface.borrow().clone() {
        body.fit(tui);
    }
}

/// Brings `widget` into view in the scroll of the plugin dialog's body, if it is in it.
pub fn reveal(tui: &Tui, widget: &AnyWidget) {
    let Some(body) = tui.reads.surface.borrow().clone() else { return };
    let within = std::iter::successors(widget.parent(), |widget| widget.parent()).any(|w| w.id() == body.body.id());
    if !within {
        return;
    }
    // A node no solve has laid out yet shows once the body's next layout places it; a body that fits never scrolls.
    match widget.rect().height > 0.0 {
        true if body.overflows() => drop(body.scroll.scroll_into_view(widget)),
        true => {}
        false => *body.revealing.borrow_mut() = Some(widget.downgrade()),
    }
}

/// A reload of plugin `id`'s registrations ended the mount of its dialog surface on screen: the dialog stays and mounts
/// again from the registration that replaced it, under the same key, so the JS host adopts what it rendered, as a
/// panel does (CT-29). Its handler hears no close.
pub fn remount(tui: &Rc<Tui>, id: &str) {
    let Some(body) = tui.reads.surface.borrow().clone() else { return };
    if body.owner.borrow().0 != id || !open(tui, id, &body.named) || !tui.plugins.has_dialog(id, &body.surface) {
        return;
    }
    let old = body.mount.borrow_mut().take();
    body.body.clear();
    let host = super::host::host(tui);
    let new = tui.plugins.dialog(&*host, id, &body.surface, &body.named, &body.body);
    // What the user typed stays, with the caret: the plugin keeps its components, and an uncontrolled field's value is
    // the host's (big-boi ds-2).
    if let (Some(old), Some(new)) = (&old, &new) {
        old.hand_over(new);
    }
    drop(old);
    *body.mount.borrow_mut() = new;
}

impl Body {
    /// The frame in the build `cx`: the mount the first time, the same mount in the new theme after.
    fn build(self: &Rc<Self>, tui: &Rc<Tui>, cx: &Rc<DialogCx>) -> View {
        *self.cx.borrow_mut() = Some(cx.clone());
        self.draw_header();
        // Built again in a new theme, the frame is put back: the node of the body that had the focus takes it again
        // (big-boi ds-6).
        let frame = self.frame.id();
        let focused = tui.app.focused().filter(|widget| {
            std::iter::successors(Some(widget.clone()), |widget| widget.parent()).any(|widget| widget.id() == frame)
        });
        if let Some(widget) = focused {
            cx.focus(&widget);
        }
        let fitted = Rc::downgrade(self);
        let resize = tui.app.on_resize(bind!(tui.weak(), |tui, _, _, _| {
            if let Some(body) = fitted.upgrade() {
                body.fit(&tui);
            }
        }));
        let resizes = tui.app.clone();
        cx.on_close(Disposer::new(move || {
            resizes.remove_handler(resize);
        }));
        let host = super::host::host(tui);
        // `ctrl+c` empties the field of the mount that has the focus before it closes the dialog.
        let cleared = Rc::downgrade(self);
        cx.editor(bind!(tui.weak(), |tui| {
            let Some(body) = cleared.upgrade() else { return false };
            let mount = body.mount.borrow();
            mount.as_ref().is_some_and(|mount| mount.clear_field(&*super::host::host(&tui)))
        }, else false));
        let mounted = self.mount.borrow().as_ref().map(|mount| mount.restyle(&*host));
        if mounted.is_none() {
            let owner = self.owner.borrow().clone();
            let mount = tui.plugins.dialog(&*host, &owner.0, &self.surface, &self.named, &self.body);
            if mount.is_none() {
                log::warn!("plugin {}: its dialog surface {:?} did not mount", owner.0, self.surface);
            }
            *self.mount.borrow_mut() = mount;
        }
        self.fit(tui);
        self.frame.clone()
    }

    /// Whether the body is taller than the room its scroll has.
    fn overflows(&self) -> bool {
        self.wrapped.get()
    }

    /// The room the screen leaves the body where the dialog shows: a centered dialog's row of margin on each side,
    /// else a quarter of the screen above it, and its header.
    fn fit(&self, tui: &Tui) {
        let rows = u32::from(tui.app.size().1);
        let above = if tui.dialogs.centered() { 1 } else { rows / 4 };
        let header = if self.title.borrow().is_some() { 3 } else { 0 };
        self.room.set(rows.saturating_sub(above + 2 + header).max(3));
        self.wrap(&tui.app);
    }

    /// Puts the body in its scroll while it is taller than its room, and back in the frame once it fits; the node of
    /// the body that had the focus keeps it.
    fn wrap(&self, app: &App) {
        let (room, height) = (self.room.get(), self.body.rect().height.ceil() as u32);
        let tall = height > room;
        if tall {
            self.scroll.height(room);
        }
        if tall == self.wrapped.get() {
            return;
        }
        let within = self.body.id();
        let focused = app.focused().filter(|widget| {
            std::iter::successors(Some(widget.clone()), |widget| widget.parent()).any(|widget| widget.id() == within)
        });
        self.body.detach();
        match tall {
            true => {
                self.scroll.add(&self.body);
                self.frame.add(&self.scroll);
            }
            false => {
                self.scroll.detach();
                self.frame.add(&self.body);
            }
        }
        self.wrapped.set(tall);
        if let Some(widget) = focused {
            app.focus(&widget);
        }
        app.request_redraw();
    }

    /// The header, with the title and the close label, and the dialog's inset around the body; neither without a
    /// title, where the view draws the whole dialog.
    fn draw_header(&self) {
        let Some(cx) = self.cx.borrow().clone() else { return };
        self.header.clear();
        let title = self.title.borrow().clone();
        let inset = if title.is_some() { DIALOG_INSET } else { 0 };
        self.frame.padding_x(inset).padding_edge(Edge::Bottom, inset.min(1)).gap(inset.min(1));
        self.header.visible(title.is_some());
        if let Some(title) = title {
            self.header.add(&dialog::header(&cx, HeaderProps::new(title)));
        }
    }
}

fn dialog_size(size: abi::PanelSize) -> DialogSize {
    match size {
        abi::PanelSize::Medium => DialogSize::Medium,
        abi::PanelSize::Large => DialogSize::Large,
        abi::PanelSize::XLarge => DialogSize::XLarge,
    }
}

fn panel(tui: &Tui, owner: Owner, panel: abi::Panel) {
    let key = format!("{}/{}", owner.0, panel.key);
    let centered = panel.centered;
    let size = dialog_size(panel.size);
    let mine = tui.reads.owner.borrow().as_ref().is_some_and(|(id, _)| *id == owner.0);
    if mine && tui.dialogs.key().as_deref() == Some(key.as_str()) {
        let live = tui.reads.panel.borrow_mut().take();
        if let Some(live) = live.filter(|live| live.key == key) {
            let same = {
                let shown = live.shown.borrow();
                let footed = |panel: &abi::Panel| panel.height.is_none() || !panel.actions.is_empty();
                (&shown.close, shown.height, shown.bare, shown.bleed, footed(&shown))
                    == (&panel.close, panel.height, panel.bare, panel.bleed, footed(&panel))
            };
            if !same {
                *live.shown.borrow_mut() = panel.clone();
                *tui.reads.panel.borrow_mut() = Some(live);
                return show_panel(tui, owner, panel, key);
            }
            live.update(tui, panel);
            tui.dialogs.set_size(size);
            tui.dialogs.set_centered(centered);
            *tui.reads.panel.borrow_mut() = Some(live);
            *tui.reads.owner.borrow_mut() = Some(owner);
            tui.app.request_redraw();
            return;
        }
    }
    show_panel(tui, owner, panel, key);
}

fn show_panel(tui: &Tui, owner: Owner, panel: abi::Panel, key: String) {
    let (centered, size) = (panel.centered, dialog_size(panel.size));
    let options = DialogOptions::new(size).key(key.clone());
    let built = owner.clone();
    own(tui, owner, |on_close| {
        tui.dialogs.replace(
            bind!(tui, |tui, cx| {
                // Built again in a new theme, the panel shows what the plugin sent last.
                let live = tui.reads.panel.borrow_mut().take_if(|live| live.key == key);
                let shown = live.as_ref().map_or_else(|| panel.clone(), |live| live.shown.borrow().clone());
                tui.app.defer(move |_| drop(live));
                let (view, live) = build(&tui, cx, key.clone(), built.clone(), shown);
                *tui.reads.panel.borrow_mut() = Some(live);
                view
            }, else View::new(&cx.app)),
            Some(on_close),
            options,
        )
    });
    tui.dialogs.set_centered(centered);
}

fn build(tui: &Tui, cx: &Rc<DialogCx>, key: String, owner: Owner, panel: abi::Panel) -> (View, Live) {
    let app = &cx.app;
    let page = cx.theme.page();
    let title = View::new(app).row().gap(2).grow(1.0).min_width(0);
    let header = dialog::header(
        cx,
        HeaderProps {
            gap: Some(2),
            title_view: Some(title.as_any()),
            close_label: panel.close.clone(),
            ..HeaderProps::default()
        },
    );
    let set = |app: &App, height: u16| u32::from(height).min(u32::from(app.size().1).saturating_sub(6)).max(1);
    let scroll = ScrollBox::new(app).scrollbars(false).height(panel.height.map_or(1, |height| set(app, height)));
    let content = View::new(app).shrink(0.0);
    // A bare panel is the dialog's frame and its body, which no box sizes or scrolls (TS `Dialog` around a plugin's
    // own view); its header and footer are built and never shown.
    let fitted = !panel.bare;
    if fitted {
        scroll.add(&content);
    }
    let body = match panel.bleed {
        true => {
            content.padding_x(DIALOG_INSET).padding_y(1);
            View::new(app).margin_x(-(DIALOG_INSET as i32)).bg(page.background.raised.high).child(&scroll)
        }
        false => View::new(app).child(&scroll),
    };
    let footer = View::new(app);
    // A panel of a set height without actions has no footer row (TS `DialogLayout` without a footer).
    let footed = panel.height.is_none() || !panel.actions.is_empty();
    let layout = match fitted {
        true => dialog::layout_view(cx, &header, &body, footed.then_some(&footer), DIALOG_INSET, 1),
        false => content.clone(),
    };
    let step = |delta: f64, page: bool| {
        let (scroll, app) = (scroll.clone(), app.clone());
        move |_: Option<&str>, _: Option<&opentui::input::KeyEvent>| {
            let rows = if page { f64::from(max_rows(&app)) } else { 1.0 };
            scroll.scroll_by(0.0, delta * rows);
        }
    };
    let (top, bottom) = (scroll.clone(), scroll.clone());
    if fitted {
        cx.layer(KeymapLayer::new(vec![
            TuiCommand::inline("up,k", step(-1.0, false)).group("Dialog"),
            TuiCommand::inline("down,j", step(1.0, false)).group("Dialog"),
            TuiCommand::inline("pageup", step(-1.0, true)).group("Dialog"),
            TuiCommand::inline("pagedown", step(1.0, true)).group("Dialog"),
            TuiCommand::inline("home", move |_, _| {
                top.scroll_to(0.0, 0.0);
            })
            .group("Dialog"),
            TuiCommand::inline("end", move |_, _| {
                bottom.scroll_to(0.0, f64::MAX);
            })
            .group("Dialog"),
        ]));
    }
    let fit = Rc::new(RefCell::new((fitted && panel.height.is_none()).then(|| Fit {
        scroll: scroll.clone(),
        content: content.clone(),
        padding: if panel.bleed { 2 } else { 0 },
    })));
    // A terminal that only gets shorter resizes no body widget, so the box follows the screen too.
    let (screen, sized, height) = (fit.clone(), scroll.clone(), panel.height);
    let resize = app.on_resize(move |cx, _, _| {
        if let Some(fit) = &*screen.borrow() {
            fit.apply(cx.app());
        }
        if let Some(height) = height {
            sized.height(set(cx.app(), height));
        }
    });
    let binds: Rc<RefCell<Option<Disposer>>> = Rc::default();
    let (held, emptied, resizes) = (binds.clone(), fit.clone(), app.clone());
    cx.on_close(Disposer::new(move || {
        drop(held.borrow_mut().take());
        drop(emptied.borrow_mut().take());
        resizes.remove_handler(resize);
    }));
    let (closed, app) = (key.clone(), app.clone());
    cx.on_dismiss(bind!(tui, |tui| {
        let live = tui.reads.panel.borrow_mut().take_if(|live| live.key == closed);
        app.defer(move |_| drop(live));
    }));
    let live = Live {
        key,
        owner,
        cx: cx.clone(),
        title,
        content,
        fit,
        footer,
        shown: RefCell::new(panel.clone()),
        binds,
        hovers: RefCell::default(),
        links: RefCell::default(),
    };
    live.fill_body(tui, &panel.body);
    live.update(tui, panel);
    cx.keep_scroll(&scroll);
    (layout, live)
}

impl Live {
    fn update(&self, tui: &Tui, panel: abi::Panel) {
        let theme = &self.cx.theme;
        let refill = self.shown.borrow().body != panel.body;
        *self.shown.borrow_mut() = panel.clone();
        let mut title = vec![abi::Node::text(panel.title).layout(abi::Layout::default().shrink(false))];
        if let Some(subtitle) = panel.subtitle {
            let subtitle = abi::Node::text([abi::Span::new(subtitle.split_whitespace().collect::<Vec<_>>().join(" "))]);
            title.push(
                subtitle
                    .fg("text.muted")
                    .wrap(abi::Wrap::None)
                    .truncate()
                    .layout(abi::Layout::default().grow().min_width(0)),
            );
        }
        self.title.clear();
        let act = self.act(tui);
        let mut hovers = Vec::new();
        for node in &title {
            node::add(
                &self.cx.app,
                theme,
                &self.title,
                node,
                &act,
                &mut hovers,
                &|_| View::new(&self.cx.app).as_any(),
                &mut |_, _| {},
            );
        }
        if refill {
            self.fill_body(tui, &panel.body);
        }

        let actions = panel
            .actions
            .into_iter()
            .map(|action| {
                let mut item = FooterAction::new(action.title);
                item.key = action.key;
                item.color = action.color.as_ref().and_then(|color| node::color_of(theme, color));
                let (owner, close, run_action) = (self.owner.clone(), action.close, action.action);
                item.on_trigger(bind!(tui, |tui| {
                    if close {
                        tui.dialogs.clear();
                    }
                    run(&tui, &owner, &run_action, None);
                }))
            })
            .collect();
        self.footer.clear();
        self.footer.add(&dialog::footer(&self.cx, FooterProps { primary: actions, ..FooterProps::default() }));
        let commands = panel
            .binds
            .into_iter()
            .filter(|bind| {
                let usable = usable_key(tui, &bind.key);
                if !usable {
                    log::warn!("a plugin's panel key {:?} cannot be bound; it is left out", bind.key);
                }
                usable
            })
            .map(|bind| {
                let (owner, action) = (self.owner.clone(), bind.action);
                TuiCommand::inline(bind.key, bind!(tui, |tui, _, _| run(&tui, &owner, &action, None)))
                    .title(bind.title)
                    .group("Dialog")
            })
            .collect();
        let layer = self.cx.keymap.layer(KeymapLayer::new(commands).mode(MODAL_MODE));
        let old = self.binds.replace(layer.map_err(|error| log::error!("plugin panel keymap layer: {error}")).ok());
        tui.app.defer(move |_| drop(old));
    }

    fn fill_body(&self, tui: &Tui, body: &abi::Node) {
        use opencode_plugin::Host;
        self.content.clear();
        if !node::fits(body) {
            log::error!("plugin {}: its panel's body nests too deep or has a size OpenTUI refuses", self.owner.0);
            return;
        }
        if let Err(over) = node::admits(body) {
            self.content.add(&node::add_placeholder(&self.cx.app, &self.cx.theme, &over));
            return;
        }
        let act = self.act(tui);
        let mut hovers = Vec::new();
        let links = RefCell::new(Vec::new());
        node::add(
            &self.cx.app,
            &self.cx.theme,
            &self.content,
            body,
            &act,
            &mut hovers,
            &|text| {
                // As in TS, of the plugins' Markdown only the `/btw` answer links sessions (`btw.tsx`).
                if self.owner.0 != super::btw::ID {
                    return tui.markdown(text).as_any();
                }
                let renderers = super::host::code_blocks(tui);
                let markdown = super::host::markdown_with(tui, &renderers);
                links.borrow_mut().push(session_links::attach(tui, &markdown, &renderers));
                markdown.set_markdown(text).as_any()
            },
            &mut |_, path| {
                log::warn!("a plugin panel cannot show slot {path}");
            },
        );
        *self.hovers.borrow_mut() = hovers;
        *self.links.borrow_mut() = links.into_inner();
        for child in self.content.children() {
            let fit = self.fit.clone();
            child.on_resize(move |cx, _| {
                if let Some(fit) = &*fit.borrow() {
                    fit.apply(cx.app());
                }
            });
        }
    }

    fn act(&self, tui: &Tui) -> Act {
        let owner = self.owner.clone();
        Rc::new(bind!(tui, |tui, action| run(&tui, &owner, action, None)))
    }
}

/// Runs `owner`'s `action` once the current event is handled; `value`, a prompt's text, is its input. An action whose
/// activation ended before then reaches nothing, not the build that replaced it (review carbon-pt-1), unless the
/// activation that replaced it goes on from it (a reload of a JS plugin's registrations, FT-4).
fn run(tui: &Tui, owner: &Owner, action: &abi::Action, value: Option<&str>) {
    let abi::Action::Command { name, input } = action.clone();
    let input = value.map(str::to_owned).or(input);
    let owner = owner.clone();
    tui.app.defer(bind!(tui, |tui, _| {
        if tui.plugins.owns(&owner.0, owner.1) {
            tui.keymap.dispatch(&name, input.as_deref());
        }
    }));
}

#[doc(hidden)]
pub mod testing {
    use super::*;

    /// Gives each widget of the open panel's body a handler that holds `marker`, so its count shows whether they are
    /// freed.
    pub fn mark(tui: &Tui, marker: &Rc<()>) {
        let Some(live) = &*tui.reads.panel.borrow() else { return };
        for child in live.content.children() {
            let marker = marker.clone();
            child.on_resize(move |_, _| {
                let _ = &marker;
            });
        }
    }
}
