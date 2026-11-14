//! The home route (E.1, row T17): the logo, the prompt, and the footer slot (`routes/home.tsx`,
//! `component/logo.tsx`). The session list is a dialog (E.11a).

use opencode_ui::theme::tint;

use super::RouteView;

use crate::prelude::*;

/// `logo.ts`: `_` is a shadow-filled space, `^` a `▀` on the shadow, `~` a shadow-colored `▀`, and `,` a
/// shadow-colored `▄`.
pub(crate) const LOGO_LEFT: [&str; 4] =
    ["                   ", "█▀▀█ █▀▀█ █▀▀█ █▀▀▄", "█__█ █__█ █^^^ █__█", "▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀~~▀"];
pub(crate) const LOGO_RIGHT: [&str; 4] =
    ["             ▄     ", "█▀▀▀ █▀▀█ █▀▀█ █▀▀█", "█___ █__█ █__█ █^^^", "▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀"];
pub(crate) const GO_RIGHT: [&str; 4] = ["    ", "█▀▀█", "█__█", "▀▀▀▀"];

pub struct Home {
    root: View,
    logo: View,
    prompt: crate::prompt::editor::Prompt,
    /// The global form overlay (E.9b); while it holds the keys, the prompt must not take the focus.
    forms: crate::features::home_forms::HomeForms,
    /// The `home.footer` slot's plugin claims (P.1), and the box they mount in.
    slot: Rc<RefCell<Rc<opencode_plugin::SlotMount>>>,
    footer: View,
}

impl Home {
    pub fn new(tui: &Tui) -> Self {
        let app = &tui.app;
        let theme = tui.page();
        let (width, height) = app.size();
        let logo = View::new(app).column().shrink(0.0);
        paint_logo(app, &logo, &theme, width, height);
        let update = View::new(app).column().shrink(0.0);
        crate::features::update_notification::mount(tui, &update);
        let prompt = crate::prompt::editor::mount(tui, None);
        let composer = View::new(app)
            .column()
            .width(Length::percent(100.0))
            .max_width(75)
            .z_index(1000)
            .padding_edge(Edge::Top, 1)
            .shrink(0.0)
            .child(prompt.root());
        let spacer = || View::new(app).grow(1.0).min_height(0);
        let center = View::new(app)
            .column()
            .grow(1.0)
            .basis(Length::Auto)
            .align_items(Align::Center)
            .padding_x(padding(width))
            .child(&spacer())
            .child(&View::new(app).height(3).min_height(0).shrink(1.0))
            .child(&logo)
            .child(&View::new(app).height(1).shrink(0.0))
            .child(&update)
            .child(&composer)
            .child(&spacer());
        let footer = View::new(app).column().width(Length::percent(100.0)).shrink(0.0);
        let slot = Rc::new(RefCell::new(Rc::new(footer_slot(tui, &footer))));
        let root = View::new(app).column().grow(1.0).basis(Length::Auto).min_height(0).child(&center).child(&footer);
        let forms = crate::features::home_forms::mount(tui, &root);
        // The logo, the side padding and the footer follow the terminal size (`useTerminalDimensions`).
        let size = std::cell::Cell::new((width, height));
        let (footer_slot, painted) = (slot.clone(), logo.clone());
        root.on_resize(bind!(tui, |tui, cx, _| {
            let (width, height) = cx.app().size();
            if size.replace((width, height)) == (width, height) {
                return;
            }
            center.padding_x(padding(width));
            paint_logo(&tui.app, &painted, &tui.page(), width, height);
            let slot = footer_slot.borrow().clone();
            crate::plugins::host::changed(&tui, &Changes::everything(), |changed| slot.sync(&*tui, changed));
            tui.app.request_redraw();
        }));
        Self { root, logo, prompt, forms, slot, footer }
    }
}

/// The `home.footer` slot; the footer itself is the `opencode.home.footer` plugin's claim (E.14).
fn footer_slot(tui: &Tui, footer: &View) -> opencode_plugin::SlotMount {
    crate::plugins::host::slot(tui, footer, opencode_plugin::slot::HOME_FOOTER, &Default::default(), |_| {})
}

impl RouteView for Home {
    fn root(&self) -> View {
        self.root.clone()
    }

    fn sync(&self, tui: &Tui, changes: &Changes) {
        crate::features::location::follow_default(tui);
        self.prompt.sync(tui, changes);
        let slot = self.slot.borrow().clone();
        crate::plugins::host::changed(tui, changes, |changed| slot.sync(tui, changed));
        // The last form closed: the prompt takes the keys back, after any open dialog.
        let closed = self.forms.sync(tui, changes);
        self.prompt.set_disabled(self.forms.active());
        if !closed {
            return;
        }
        if tui.dialogs.is_open() {
            tui.dialogs.refocus(self.prompt.textarea());
        } else {
            self.prompt.focus(tui);
        }
    }

    fn focus_target(&self) -> Option<AnyWidget> {
        (!self.forms.active()).then(|| self.prompt.textarea().as_any())
    }

    fn restyle(&self, tui: &Tui) -> bool {
        let (width, height) = tui.app.size();
        paint_logo(&tui.app, &self.logo, &tui.page(), width, height);
        crate::features::update_notification::restyle(tui);
        self.prompt.restyle(tui);
        self.forms.restyle();
        // The footer's plugin claims take the theme in place; one that cannot mounts again with the footer.
        if !self.slot.borrow().restyle(tui) {
            self.footer.clear();
            *self.slot.borrow_mut() = Rc::new(footer_slot(tui, &self.footer));
        }
        true
    }
}

fn padding(width: u16) -> u16 {
    if width < 44 { 1 } else { 2 }
}

/// `Logo`: nothing below 12 rows, the short mark below 22 columns, the two words stacked below 44.
pub(crate) fn paint_logo(app: &App, logo: &View, theme: &Theme, width: u16, height: u16) {
    logo.clear();
    let muted = theme.text.muted;
    let base = theme.text.base;
    let line = |left: Option<&str>, right: Option<&str>| {
        let row = View::new(app).row().gap(1);
        if let Some(left) = left {
            row.add(&Text::new(app, spans(theme, left, muted, false)).selectable(false));
        }
        if let Some(right) = right {
            row.add(&Text::new(app, spans(theme, right, base, true)).selectable(false));
        }
        logo.add(&row);
    };
    if height < 12 {
        return;
    }
    if width < 22 {
        GO_RIGHT[1..].iter().for_each(|right| line(None, Some(right)));
        return;
    }
    if width < 44 {
        LOGO_LEFT[1..].iter().for_each(|left| line(Some(left), None));
        LOGO_RIGHT.iter().for_each(|right| line(None, Some(right)));
        return;
    }
    LOGO_LEFT.iter().zip(LOGO_RIGHT).for_each(|(left, right)| line(Some(left), Some(right)));
}

/// `renderLine`: one span per cell, so each shadow cell gets its own colors.
fn spans(theme: &Theme, line: &str, fg: Color, bold: bool) -> Vec<Span<'static>> {
    let shadow = tint(theme.background.base, fg, 0.25);
    let attributes = if bold { Attributes::BOLD } else { Attributes::NONE };
    line.chars()
        .map(|char| {
            let (text, style) = match char {
                '_' => (' ', Style::new().fg(fg).bg(shadow)),
                '^' => ('▀', Style::new().fg(fg).bg(shadow)),
                '~' => ('▀', Style::new().fg(shadow)),
                ',' => ('▄', Style::new().fg(shadow)),
                char => (char, Style::new().fg(fg)),
            };
            Span::styled(text.to_string(), style.add(attributes))
        })
        .collect()
}
