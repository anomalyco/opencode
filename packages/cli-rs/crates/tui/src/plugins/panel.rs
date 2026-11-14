//! The plugins' dialogs ([`abi::Dialog`]): a prompt, a list to pick from, a confirm, an alert, and a live panel, which changes in place while its key is open
//! (TS `/btw`'s `Answer`: the header, a body that scrolls, at most 60% of the screen high, and footer actions).

use opencode_plugin::abi;
use opencode_plugin::node::{self, Act};
use opencode_ui::alert::AlertProps;
use opencode_ui::confirm::ConfirmProps;
use opencode_ui::dialog::{self, DIALOG_INSET, DialogCx, FooterAction, FooterProps, MODAL_MODE};
use opencode_ui::prompt::{PromptProps, prompt};

use crate::features::session_links::{self, Links};
use crate::prelude::*;

/// The panel on screen, which a panel of the same key changes in place.
pub struct Live {
    key: String,
    /// The plugin and activation that showed it, which its actions reach.
    owner: Owner,
    cx: Rc<DialogCx>,
    title: View,
    content: View,
    fit: Rc<RefCell<Option<Fit>>>,
    footer: View,
    /// The panel as last shown, which a build in a new theme shows again.
    shown: RefCell<abi::Panel>,
    binds: Rc<RefCell<Option<Disposer>>>,
    /// The texts the body's hover handlers change.
    hovers: RefCell<Vec<Rc<Text>>>,
    /// The session links of the body's Markdown (`/btw` only).
    links: RefCell<Vec<Rc<Links>>>,
}

/// What sizes the body's box. Its resize handlers reach it through a slot that closing the panel empties, so a closed
/// panel's widgets hold nothing that holds them.
struct Fit {
    scroll: ScrollBox,
    content: View,
    /// The rows of the body's padding.
    padding: u32,
}

impl Fit {
    /// `maxHeight`: the box is as high as the body and its padding, up to 60% of the screen.
    fn apply(&self, app: &App) {
        let height: f32 = self.content.children().iter().map(|child| child.rect().height).sum();
        self.scroll.height((height.ceil() as u32 + self.padding).clamp(1, max_rows(app)));
        app.request_redraw();
    }
}

/// The most rows the body takes: 60% of the screen, as it is now.
fn max_rows(app: &App) -> u32 {
    (u32::from(app.size().1) * 6 / 10).max(8)
}

/// The plugin and the activation a dialog belongs to ([`opencode_plugin::Registry::live`]).
type Owner = (String, u64);

/// Shows `dialog` of activation `generation` of plugin `id`, which owns it from now on.
pub fn show(tui: &Tui, id: &str, generation: u64, dialog: abi::Dialog) {
    let owner = (id.to_owned(), generation);
    match dialog {
        abi::Dialog::Prompt { title, placeholder, action } => ask(tui, owner, title, placeholder, action),
        abi::Dialog::Panel(panel) => self::panel(tui, owner, panel),
        abi::Dialog::Close { key } => {
            if open(tui, id, &key) {
                tui.dialogs.clear();
            }
        }
        abi::Dialog::Select(select) => pick(tui, owner, select),
        abi::Dialog::Confirm(confirm) => ask_yes(tui, owner, confirm),
        abi::Dialog::Alert(alert) => tell(tui, owner, alert),
        abi::Dialog::ErrorDetails(details) => detail(tui, owner, details),
    }
}

/// Whether plugin `id`'s panel `key` is open.
pub fn open(tui: &Tui, id: &str, key: &str) -> bool {
    let mine = tui.reads.owner.borrow().as_ref().is_some_and(|(owner, _)| owner == id);
    mine && tui.dialogs.key() == Some(format!("{id}/{key}"))
}

/// Closes the dialog plugin `id` opened, if it shows and the activation that opened it ended (4.14, deviation
/// `F16-plugin-dialog-ends-with-activation`). The dialogs replace each other, so the one on top is the only one.
pub fn close(tui: &Tui, id: &str) {
    let owner = tui.reads.owner.borrow().clone();
    if owner.is_some_and(|(owner, generation)| owner == id && !tui.plugins.live(id, generation)) {
        tui.dialogs.clear();
    }
}

/// Shows a dialog of `owner` with `replace`, which gets what the dialog runs as it closes, and records the owner
/// once the dialog it replaced has closed.
fn own(tui: &Tui, owner: Owner, replace: impl FnOnce(Box<dyn FnOnce()>)) {
    let forgotten = owner.clone();
    replace(Box::new(bind!(tui, |tui| {
        let mut current = tui.reads.owner.borrow_mut();
        if current.as_ref() == Some(&forgotten) {
            current.take();
        }
    })));
    *tui.reads.owner.borrow_mut() = Some(owner);
}

fn ask(tui: &Tui, owner: Owner, title: String, placeholder: Option<String>, action: abi::Action) {
    let (weak, clear, confirmed) = (tui.weak(), tui.dialogs.clone(), owner.clone());
    own(tui, owner, |on_close| {
        tui.dialogs.replace(
            move |cx| {
                let (clear, owner, action) = (clear.clone(), confirmed.clone(), action.clone());
                let on_confirm = bind!(weak, |tui, value: &str| {
                    tui.dialogs.clear();
                    run(&tui, &owner, &action, Some(value));
                });
                let (view, _) = prompt(
                    cx,
                    PromptProps {
                        title: title.clone(),
                        placeholder: placeholder.clone(),
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

/// The rich select on screen (synthesis 4.10): the select the plugin showed last, which a select of the same key
/// replaces in place, keeping the filter and the selected row.
pub struct Picker {
    key: String,
    owner: RefCell<Owner>,
    shown: RefCell<abi::Select>,
    handle: RefCell<Option<opencode_ui::select::Select<String>>>,
}

/// TS `dialog.select`: picking an option closes the list, then runs the action with the option's value. A select with
/// a key is the rich one: it stays open as a row is picked, and one shown again under its key changes in place.
fn pick(tui: &Tui, owner: Owner, select: abi::Select) {
    let keyed = select.key.as_ref().map(|key| format!("{}/{key}", owner.0));
    if let Some(keyed) = &keyed
        && open(tui, &owner.0, select.key.as_deref().unwrap_or_default())
    {
        let picker = tui.reads.select.borrow().clone().filter(|picker| picker.key == *keyed);
        // Its footer actions and keys are the dialog's layer, built with it: new ones build it again.
        let same = |picker: &Picker| {
            let shown = picker.shown.borrow();
            shown.actions == select.actions && shown.binds == select.binds
        };
        let handle = picker.as_ref().and_then(|picker| picker.handle.borrow().clone());
        match (picker, handle) {
            (Some(picker), Some(handle)) if same(&picker) => {
                *picker.shown.borrow_mut() = select;
                *picker.owner.borrow_mut() = owner.clone();
                *tui.reads.owner.borrow_mut() = Some(owner);
                let theme = opencode_ui::theme::Theme::clone(&tui.page());
                handle.set_options(options(tui, &theme, &picker.shown.borrow()));
                handle.refresh_footer();
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

/// Shows `select` as a new dialog, with the filter and the selected row of `kept`.
fn list(tui: &Tui, owner: Owner, select: abi::Select, kept: Option<(String, Option<String>)>) {
    let keyed = select.key.as_ref().map(|key| format!("{}/{key}", owner.0));
    let picker = Rc::new(Picker {
        key: keyed.clone().unwrap_or_default(),
        owner: RefCell::new(owner.clone()),
        shown: RefCell::new(select),
        handle: RefCell::default(),
    });
    *tui.reads.select.borrow_mut() = keyed.is_some().then(|| picker.clone());
    let dialog = keyed.as_ref().map_or_else(DialogOptions::default, |key| DialogOptions::default().key(key.clone()));
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
                    Rc::new(bind!(tui.weak(), |tui, _: &str| {
                        weak.upgrade().map_or_else(Vec::new, |picker| options(&tui, &theme, &picker.shown.borrow()))
                    }, else Vec::new())),
                );
                props.placeholder = shown.placeholder.clone();
                props.current = shown.current.clone();
                props.preserve_selection = shown.key.is_some();
                // The plugin's search lists the rows in place of the host's filter (TS `search`).
                if let Some(name) = shown.search.clone() {
                    let searched = Rc::downgrade(&picker);
                    props.search = Some(Rc::new(bind!(tui.weak(), |tui, query: &str| {
                        let Some(picker) = searched.upgrade() else { return Vec::new() };
                        let (owner, shown) = (picker.owner.borrow().clone(), picker.shown.borrow().clone());
                        let enabled: Vec<abi::SelectOption> =
                            shown.options.iter().filter(|option| !option.disabled).cloned().collect();
                        let host = super::host::host(&tui);
                        let values = tui.plugins.search(&*host, &owner.0, &name, query, &enabled);
                        let rows = options(&tui, &opencode_ui::theme::Theme::clone(&tui.page()), &shown);
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
                // A row that toggles a plugin shows what enter does to which plugin, from its state, not the row's.
                let hinted = Rc::downgrade(&picker);
                props.dynamic_hints = Some(Rc::new(bind!(tui.weak(), |tui| {
                    let Some(picker) = hinted.upgrade() else { return Vec::new() };
                    let selected = picker.handle.borrow().as_ref().and_then(|handle| handle.selected());
                    let plugin = selected.and_then(|selected| {
                        let shown = picker.shown.borrow();
                        shown.options.iter().find(|option| option.value == selected.value).and_then(|option| option.toggle.clone())
                    });
                    let Some((plugin, active)) =
                        plugin.and_then(|plugin| toggled(&tui, &plugin).map(|active| (plugin, active)))
                    else {
                        return Vec::new();
                    };
                    vec![opencode_ui::select::FooterHint {
                        title: format!("{} {plugin}", if active { "disable" } else { "enable" }),
                        label: "enter".to_owned(),
                        group: Some(opencode_ui::select::Group::Primary),
                    }]
                }, else Vec::new())));
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
}

impl Picker {
    /// Picks the row of `value`: a toggle, the row's action, or the select's; a plain select closes first.
    fn choose(self: &Rc<Self>, tui: &Tui, value: &str) {
        let shown = self.shown.borrow().clone();
        let owner = self.owner.borrow().clone();
        let Some(option) = shown.options.iter().find(|option| option.value == value) else { return };
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
        if plugin == caller || plugin == crate::dialogs::plugins::ID {
            log::warn!("plugin {caller}: a row may not toggle {plugin}");
            return;
        }
        let (picker, value, plugin) = (Rc::downgrade(self), value.to_owned(), plugin.to_owned());
        tui.app.defer(bind!(tui, |tui, _| {
            let Some(picker) = picker.upgrade() else { return };
            let owner = picker.owner.borrow().clone();
            let names = picker
                .shown
                .borrow()
                .options
                .iter()
                .any(|option| option.value == value && option.toggle.as_deref() == Some(plugin.as_str()));
            // The same select still on screen: closed or replaced, it is not the select any more.
            let shows = tui.reads.select.borrow().as_ref().is_some_and(|shown| Rc::ptr_eq(shown, &picker));
            if !(names && shows && tui.plugins.live(&owner.0, owner.1)) {
                return;
            }
            let Some(active) = toggled(&tui, &plugin) else { return };
            match tui.plugins.toggle(&super::host::host(&tui), &plugin, !active) {
                None => tui.toasts.error(format!("Failed to update plugin {plugin}")),
                Some(Err(error)) => tui.toasts.error(error),
                Some(Ok(())) => tui.navigate(tui.route()),
            }
            // The rows say what the registry holds now, as do the hints.
            if let Some(handle) = picker.handle.borrow().clone() {
                let theme = opencode_ui::theme::Theme::clone(&tui.page());
                handle.set_options(options(&tui, &theme, &picker.shown.borrow()));
                handle.refresh_footer();
            }
        }));
    }
}

/// Whether plugin `id` is active, for a toggle: `None` for a plugin the host cannot toggle.
fn toggled(tui: &Tui, id: &str) -> Option<bool> {
    tui.plugins.entries().into_iter().find(|entry| entry.id == id).map(|entry| entry.active)
}

/// The rows of `select`, in `theme`.
fn options(tui: &Tui, theme: &opencode_ui::theme::Theme, select: &abi::Select) -> Vec<SelectOption<String>> {
    select
        .options
        .iter()
        .map(|option| {
            let mut item = SelectOption::new(option.title.clone(), option.value.clone());
            item.description = option.description.clone();
            item.footer = option.footer.clone();
            item.category = option.category.clone();
            item.disabled = option.disabled;
            item.footer_color = option.footer_color.as_ref().and_then(|color| node::color_of(theme, color));
            // A toggle's footer is the host's: what the plugin's state is, not what the plugin says.
            if let Some(active) = option.toggle.as_deref().and_then(|plugin| toggled(tui, plugin)) {
                item.footer = Some(if active { "enabled" } else { "disabled" }.to_owned());
            }
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

/// The select's footer actions on the selected row.
fn actions(tui: &Tui, picker: &Rc<Picker>) -> Vec<opencode_ui::select::SelectAction<String>> {
    use opencode_ui::select::{Group, SelectAction};
    let shown = picker.shown.borrow().clone();
    shown
        .actions
        .iter()
        .enumerate()
        // No plugin's key may be the reserved chord.
        .filter(|(_, action)| !action.key.as_deref().is_some_and(|key| opencode_plugin::interact::reserved(tui, key)))
        .map(|(index, action)| {
            let (weak, hidden, run_action) = (Rc::downgrade(picker), action.hidden.clone(), action.action.clone());
            SelectAction {
                command: format!("plugin.select.{index}"),
                bind: action.key.clone(),
                group: action.primary.then_some(Group::Primary),
                hidden_when: Some(Rc::new(move |option: Option<&SelectOption<String>>| {
                    option.is_none_or(|option| hidden.contains(&option.value))
                })),
                ..SelectAction::new(
                    format!("plugin.select.{index}"),
                    action.title.clone(),
                    bind!(tui.weak(), |tui, option: &SelectOption<String>| {
                        if let Some(picker) = weak.upgrade() {
                            let owner = picker.owner.borrow().clone();
                            run(&tui, &owner, &run_action, Some(&option.value));
                        }
                    }),
                )
            }
        })
        .collect()
}

/// The select's extra keys: each runs its action with the selected row's value.
fn binds(tui: &Tui, picker: &Rc<Picker>) -> Vec<TuiCommand> {
    let shown = picker.shown.borrow().clone();
    shown
        .binds
        .into_iter()
        .filter(|bind| !opencode_plugin::interact::reserved(tui, &bind.key))
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

/// TS `DialogErrorDetails`, drawn by the host's own error view; Back and escape run `back`, or close it.
fn detail(tui: &Tui, owner: Owner, details: abi::ErrorDetails) {
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
                let props = crate::dialogs::error_details::Props {
                    title: details.title.clone(),
                    source: details.source.clone(),
                    error: details.error.clone(),
                    context: details.context.clone(),
                    diagnostic_ref: None,
                    on_back,
                };
                crate::dialogs::error_details::view(&tui, cx, props)
            }, else View::new(&cx.app)),
            Some(on_close),
            DialogOptions::new(DialogSize::Large),
        )
    });
}

/// TS `dialog.confirm`: `Confirm` runs the action with `true`, `Cancel` and escape with `false`; a dialog that replaces
/// it runs nothing.
fn ask_yes(tui: &Tui, owner: Owner, confirm: abi::Confirm) {
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
            DialogOptions::default(),
        )
    });
}

/// TS `dialog.alert`: however the alert closes, its action runs once after.
fn tell(tui: &Tui, owner: Owner, alert: abi::Alert) {
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
            DialogOptions::default(),
        )
    });
}

fn panel(tui: &Tui, owner: Owner, panel: abi::Panel) {
    let key = format!("{}/{}", owner.0, panel.key);
    let centered = panel.centered;
    let size = match panel.size {
        abi::PanelSize::Medium => DialogSize::Medium,
        abi::PanelSize::Large => DialogSize::Large,
        abi::PanelSize::XLarge => DialogSize::XLarge,
    };
    let mine = tui.reads.owner.borrow().as_ref().is_some_and(|(id, _)| *id == owner.0);
    if mine && tui.dialogs.key().as_deref() == Some(key.as_str()) {
        let live = tui.reads.panel.borrow_mut().take();
        if let Some(live) = live.filter(|live| live.key == key) {
            live.update(tui, panel);
            tui.dialogs.set_size(size);
            tui.dialogs.set_centered(centered);
            *tui.reads.panel.borrow_mut() = Some(live);
            *tui.reads.owner.borrow_mut() = Some(owner);
            tui.app.request_redraw();
            return;
        }
    }
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
    let header =
        dialog::header(cx, HeaderProps { gap: Some(2), title_view: Some(title.as_any()), ..HeaderProps::default() });
    let scroll = ScrollBox::new(app).scrollbars(false).height(1);
    let content = View::new(app).shrink(0.0);
    scroll.add(&content);
    // `DialogBleed`: the body's background reaches the dialog's edges, and its padding is inside it.
    let body = match panel.bleed {
        true => {
            content.padding_x(DIALOG_INSET).padding_y(1);
            View::new(app).margin_x(-(DIALOG_INSET as i32)).bg(page.background.raised.high).child(&scroll)
        }
        false => View::new(app).child(&scroll),
    };
    let footer = View::new(app);
    let layout = dialog::layout_view(cx, &header, &body, Some(&footer), DIALOG_INSET, 1);
    // A page is the body's most rows, as the screen is now.
    let step = |delta: f64, page: bool| {
        let (scroll, app) = (scroll.clone(), app.clone());
        move |_: Option<&str>, _: Option<&opentui::input::KeyEvent>| {
            let rows = if page { f64::from(max_rows(&app)) } else { 1.0 };
            scroll.scroll_by(0.0, delta * rows);
        }
    };
    let (top, bottom) = (scroll.clone(), scroll.clone());
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
    let fit = Rc::new(RefCell::new(Some(Fit {
        scroll: scroll.clone(),
        content: content.clone(),
        padding: if panel.bleed { 2 } else { 0 },
    })));
    // A terminal that only gets shorter resizes no body widget, so the box follows the screen too.
    let screen = fit.clone();
    let resize = app.on_resize(move |cx, _, _| {
        if let Some(fit) = &*screen.borrow() {
            fit.apply(cx.app());
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
    /// Shows `panel`'s header, actions and keys, and its body when that changed, which keeps where it is scrolled.
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
                    .layout(abi::Layout::default().grow().min_width_zero()),
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
            .map(|bind| {
                let (owner, action) = (self.owner.clone(), bind.action);
                TuiCommand::inline(bind.key, bind!(tui, |tui, _, _| run(&tui, &owner, &action, None)))
                    .title(bind.title)
                    .group("Dialog")
            })
            .collect();
        let layer = self.cx.keymap.layer(KeymapLayer::new(commands).mode(MODAL_MODE));
        // The old layer may be the one running the key that showed this panel again.
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
                let markdown = super::host::markdown(tui);
                links.borrow_mut().push(session_links::attach(tui, &markdown));
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
/// activation ended before then reaches nothing, not the build that replaced it (review carbon-pt-1).
fn run(tui: &Tui, owner: &Owner, action: &abi::Action, value: Option<&str>) {
    let abi::Action::Command { name, input } = action.clone();
    let input = value.map(str::to_owned).or(input);
    let owner = owner.clone();
    tui.app.defer(bind!(tui, |tui, _| {
        if tui.plugins.live(&owner.0, owner.1) {
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
