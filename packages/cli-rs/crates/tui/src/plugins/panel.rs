//! The plugins' dialogs ([`abi::Dialog`]): a prompt, a list to pick from, and a live panel, which changes in place while its key is open
//! (TS `/btw`'s `Answer`: the header, a body that scrolls, at most 60% of the screen high, and footer actions).

use opencode_plugin::abi;
use opencode_plugin::node::{self, Act};
use opencode_ui::dialog::{self, DIALOG_INSET, DialogCx, FooterAction, FooterProps, MODAL_MODE};
use opencode_ui::prompt::{PromptProps, prompt};

use crate::features::session_links::{self, Links};
use crate::prelude::*;

/// The panel on screen, which a panel of the same key changes in place.
pub struct Live {
    key: String,
    plugin: String,
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

/// Shows plugin `id`'s `dialog`.
pub fn show(tui: &Tui, id: &str, dialog: abi::Dialog) {
    match dialog {
        abi::Dialog::Prompt { title, placeholder, action } => ask(tui, id, title, placeholder, action),
        abi::Dialog::Panel(panel) => self::panel(tui, id, panel),
        abi::Dialog::Close { key } => {
            if open(tui, id, &key) {
                tui.dialogs.clear();
            }
        }
        abi::Dialog::Select(select) => pick(tui, id, select),
    }
}

/// Whether plugin `id`'s panel `key` is open.
pub fn open(tui: &Tui, id: &str, key: &str) -> bool {
    tui.dialogs.key().is_some_and(|open| open.strip_prefix(id).and_then(|rest| rest.strip_prefix('/')) == Some(key))
}

/// The key of plugin `id`'s dialogs that have none of their own (a prompt, a list): no panel key matches it in
/// [`open`], since a panel's follows a `/`.
fn owned(id: &str) -> String {
    format!("{id}#")
}

/// Closes the dialog plugin `id` opened, if it shows: its activation ended (4.14, deviation
/// `F16-plugin-dialog-ends-with-activation`). The dialogs replace each other, so the one on top is the only one.
pub fn close(tui: &Tui, id: &str) {
    let key = tui.dialogs.key();
    let mine = key
        .as_deref()
        .is_some_and(|key| key == owned(id) || key.strip_prefix(id).is_some_and(|rest| rest.starts_with('/')));
    if mine {
        tui.dialogs.clear();
    }
}

fn ask(tui: &Tui, id: &str, title: String, placeholder: Option<String>, action: abi::Action) {
    let options = DialogOptions::default().key(owned(id));
    let (weak, clear, id) = (tui.weak(), tui.dialogs.clone(), id.to_owned());
    tui.dialogs.replace(
        move |cx| {
            let (clear, id, action) = (clear.clone(), id.clone(), action.clone());
            let on_confirm = bind!(weak, |tui, value: &str| {
                tui.dialogs.clear();
                run(&tui, &id, &action, Some(value));
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
        None,
        options,
    );
}

/// TS `dialog.select`: picking an option closes the list, then runs the action with the option's value.
fn pick(tui: &Tui, id: &str, select: abi::Select) {
    let options = DialogOptions::default().key(owned(id));
    let (weak, id) = (tui.weak(), id.to_owned());
    tui.dialogs.replace(
        move |cx| {
            let options = select
                .options
                .iter()
                .map(|option| {
                    let mut item = SelectOption::new(option.title.clone(), option.value.clone());
                    item.description = option.description.clone();
                    item.footer = option.footer.clone();
                    item.category = option.category.clone();
                    item.disabled = option.disabled;
                    item
                })
                .collect();
            let mut props = SelectProps::new(select.title.clone(), options);
            props.placeholder = select.placeholder.clone();
            props.current = select.current.clone();
            let (id, action) = (id.clone(), select.action.clone());
            props.on_select = Some(Rc::new(bind!(weak, |tui, option: &SelectOption<String>| {
                tui.dialogs.clear();
                run(&tui, &id, &action, Some(&option.value));
            })));
            opencode_ui::select::select(cx, props).0
        },
        None,
        options,
    );
}

fn panel(tui: &Tui, id: &str, panel: abi::Panel) {
    let key = format!("{id}/{}", panel.key);
    let centered = panel.centered;
    let size = match panel.size {
        abi::PanelSize::Medium => DialogSize::Medium,
        abi::PanelSize::Large => DialogSize::Large,
    };
    if tui.dialogs.key().as_deref() == Some(key.as_str()) {
        let live = tui.reads.panel.borrow_mut().take();
        if let Some(live) = live.filter(|live| live.key == key) {
            live.update(tui, panel);
            tui.dialogs.set_size(size);
            tui.dialogs.set_centered(centered);
            *tui.reads.panel.borrow_mut() = Some(live);
            tui.app.request_redraw();
            return;
        }
    }
    let plugin = id.to_owned();
    let options = DialogOptions::new(size).key(key.clone());
    tui.dialogs.replace(
        bind!(tui, |tui, cx| {
            // Built again in a new theme, the panel shows what the plugin sent last.
            let live = tui.reads.panel.borrow_mut().take_if(|live| live.key == key);
            let shown = live.as_ref().map_or_else(|| panel.clone(), |live| live.shown.borrow().clone());
            tui.app.defer(move |_| drop(live));
            let (view, live) = build(&tui, cx, key.clone(), plugin.clone(), shown);
            *tui.reads.panel.borrow_mut() = Some(live);
            view
        }, else View::new(&cx.app)),
        None,
        options,
    );
    tui.dialogs.set_centered(centered);
}

fn build(tui: &Tui, cx: &Rc<DialogCx>, key: String, plugin: String, panel: abi::Panel) -> (View, Live) {
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
        plugin,
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
                let (plugin, close, run_action) = (self.plugin.clone(), action.close, action.action);
                item.on_trigger(bind!(tui, |tui| {
                    if close {
                        tui.dialogs.clear();
                    }
                    run(&tui, &plugin, &run_action, None);
                }))
            })
            .collect();
        self.footer.clear();
        self.footer.add(&dialog::footer(&self.cx, FooterProps { primary: actions, ..FooterProps::default() }));
        let commands = panel
            .binds
            .into_iter()
            .map(|bind| {
                let (plugin, action) = (self.plugin.clone(), bind.action);
                TuiCommand::inline(bind.key, bind!(tui, |tui, _, _| run(&tui, &plugin, &action, None)))
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
                if self.plugin != super::btw::ID {
                    return tui.markdown(text);
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
        let plugin = self.plugin.clone();
        Rc::new(bind!(tui, |tui, action| run(&tui, &plugin, action, None)))
    }
}

/// Runs plugin `id`'s `action` once the current event is handled; `value`, a prompt's text, is its input.
fn run(tui: &Tui, _id: &str, action: &abi::Action, value: Option<&str>) {
    let abi::Action::Command { name, input } = action.clone();
    let input = value.map(str::to_owned).or(input);
    tui.app.defer(bind!(tui, |tui, _| {
        tui.keymap.dispatch(&name, input.as_deref());
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
