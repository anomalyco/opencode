//! The plugins' dialogs ([`abi::Dialog`]): a prompt, and a live panel, which changes in place while its key is open
//! (TS `/btw`'s `Answer`: the header, a body that scrolls, at most 60% of the screen high, and footer actions).

use std::cell::RefCell;
use std::rc::Rc;

use opencode_plugin::abi;
use opencode_plugin::node::{self, Act};
use opencode_ui::dialog::{
    self, DIALOG_INSET, DialogCx, DialogOptions, DialogSize, FooterAction, FooterProps, HeaderProps, MODAL_MODE,
};
use opencode_ui::keymap::{KeymapLayer, TuiCommand};
use opencode_ui::prompt::{PromptProps, prompt};
use opencode_ui::theme::Theme;
use opentui::keymap::Disposer;
use opentui::prelude::*;

use crate::app::Tui;

/// The panel on screen, which a panel of the same key changes in place.
pub struct Live {
    key: String,
    plugin: String,
    cx: Rc<DialogCx>,
    title: View,
    content: View,
    scroll: ScrollBox,
    /// The most rows the body takes: 60% of the screen.
    max: u32,
    /// The rows of the body's padding.
    padding: u32,
    footer: View,
    body: RefCell<abi::Node>,
    binds: Rc<RefCell<Option<Disposer>>>,
    /// The texts the body's hover handlers change.
    hovers: RefCell<Vec<Rc<Text>>>,
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
    }
}

/// Whether plugin `id`'s panel `key` is open.
pub fn open(tui: &Tui, id: &str, key: &str) -> bool {
    tui.dialogs.key().is_some_and(|open| open.strip_prefix(id).and_then(|rest| rest.strip_prefix('/')) == Some(key))
}

fn ask(tui: &Tui, id: &str, title: String, placeholder: Option<String>, action: abi::Action) {
    let (weak, clear, id) = (tui.weak(), tui.dialogs.clone(), id.to_owned());
    tui.dialogs.replace(
        move |cx| {
            let on_confirm = move |value: &str| {
                let Some(tui) = weak.upgrade() else { return };
                tui.dialogs.clear();
                run(&tui, &id, &action, Some(value));
            };
            let (view, _) = prompt(
                cx,
                PromptProps {
                    title,
                    placeholder,
                    on_confirm: Some(Rc::new(on_confirm)),
                    on_cancel: Some(Rc::new(move || clear.clear())),
                    ..PromptProps::default()
                },
            );
            view
        },
        None,
        DialogOptions::default(),
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
    let built: Rc<RefCell<Option<Live>>> = Rc::default();
    let into = built.clone();
    let (page, plugin) = (tui.page(), id.to_owned());
    let (weak, options) = (tui.weak(), DialogOptions::new(size).key(key.clone()));
    tui.dialogs.replace(
        move |cx| {
            let Some(tui) = weak.upgrade() else { return View::new(&cx.app) };
            let (view, live) = build(&tui, cx, &page, key, plugin, panel);
            *into.borrow_mut() = Some(live);
            view
        },
        None,
        options,
    );
    tui.dialogs.set_centered(centered);
    *tui.reads.panel.borrow_mut() = built.borrow_mut().take();
}

fn build(tui: &Tui, cx: &Rc<DialogCx>, page: &Theme, key: String, plugin: String, panel: abi::Panel) -> (View, Live) {
    let app = &cx.app;
    let max = (u32::from(app.size().1) * 6 / 10).max(8);
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
    let step = |delta: f64| {
        let scroll = scroll.clone();
        move |_: Option<&str>, _: Option<&opentui::input::KeyEvent>| {
            scroll.scroll_by(0.0, delta);
        }
    };
    let (top, bottom, rows) = (scroll.clone(), scroll.clone(), f64::from(max));
    cx.layer(KeymapLayer::new(vec![
        TuiCommand::inline("up,k", step(-1.0)).group("Dialog"),
        TuiCommand::inline("down,j", step(1.0)).group("Dialog"),
        TuiCommand::inline("pageup", step(-rows)).group("Dialog"),
        TuiCommand::inline("pagedown", step(rows)).group("Dialog"),
        TuiCommand::inline("home", move |_, _| {
            top.scroll_to(0.0, 0.0);
        })
        .group("Dialog"),
        TuiCommand::inline("end", move |_, _| {
            bottom.scroll_to(0.0, f64::MAX);
        })
        .group("Dialog"),
    ]));
    let binds: Rc<RefCell<Option<Disposer>>> = Rc::default();
    let held = binds.clone();
    cx.on_close(Disposer::new(move || drop(held.borrow_mut().take())));
    let live = Live {
        key,
        plugin,
        cx: cx.clone(),
        title,
        content,
        scroll: scroll.clone(),
        max,
        padding: if panel.bleed { 2 } else { 0 },
        footer,
        body: RefCell::new(panel.body.clone()),
        binds,
        hovers: RefCell::default(),
    };
    live.fill_body(tui, &panel.body);
    live.update(tui, panel);
    (layout, live)
}

impl Live {
    /// Shows `panel`'s header, actions and keys, and its body when that changed, which keeps where it is scrolled.
    fn update(&self, tui: &Tui, panel: abi::Panel) {
        let theme = &self.cx.theme;
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
        if *self.body.borrow() != panel.body {
            self.fill_body(tui, &panel.body);
            *self.body.borrow_mut() = panel.body;
        }
        let actions = panel
            .actions
            .into_iter()
            .map(|action| {
                let mut item = FooterAction::new(action.title);
                item.key = action.key;
                item.color = action.color.as_ref().and_then(|color| node::color_of(theme, color));
                let (weak, plugin, close, run_action) = (tui.weak(), self.plugin.clone(), action.close, action.action);
                item.on_trigger(move || {
                    let Some(tui) = weak.upgrade() else { return };
                    if close {
                        tui.dialogs.clear();
                    }
                    run(&tui, &plugin, &run_action, None);
                })
            })
            .collect();
        self.footer.clear();
        self.footer.add(&dialog::footer(&self.cx, FooterProps { primary: actions, ..FooterProps::default() }));
        let commands = panel
            .binds
            .into_iter()
            .map(|bind| {
                let (weak, plugin, action) = (tui.weak(), self.plugin.clone(), bind.action);
                TuiCommand::inline(bind.key, move |_, _| {
                    if let Some(tui) = weak.upgrade() {
                        run(&tui, &plugin, &action, None);
                    }
                })
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
        node::add(
            &self.cx.app,
            &self.cx.theme,
            &self.content,
            body,
            &act,
            &mut hovers,
            &|text| tui.markdown(text),
            &mut |_, path| {
                log::warn!("a plugin panel cannot show slot {path}");
            },
        );
        *self.hovers.borrow_mut() = hovers;
        // `maxHeight`: the box is as high as the body and its padding, up to 60% of the screen.
        for child in self.content.children() {
            let (fit, content, max, padding) = (self.scroll.clone(), self.content.clone(), self.max, self.padding);
            child.on_resize(move |cx, _| {
                let height: f32 = content.children().iter().map(|child| child.rect().height).sum();
                fit.height((height.ceil() as u32 + padding).clamp(1, max));
                cx.app().request_redraw();
            });
        }
    }

    fn act(&self, tui: &Tui) -> Act {
        let (weak, plugin) = (tui.weak(), self.plugin.clone());
        Rc::new(move |action| {
            if let Some(tui) = weak.upgrade() {
                run(&tui, &plugin, action, None);
            }
        })
    }
}

/// Runs plugin `id`'s `action` once the current event is handled; `value`, a prompt's text, is its input.
fn run(tui: &Tui, _id: &str, action: &abi::Action, value: Option<&str>) {
    let abi::Action::Command { name, input } = action.clone();
    let input = value.map(str::to_owned).or(input);
    let weak = tui.weak();
    tui.app.defer(move |_| {
        if let Some(tui) = weak.upgrade() {
            tui.keymap.dispatch(&name, input.as_deref());
        }
    });
}
