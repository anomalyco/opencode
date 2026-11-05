//! The missing plugin route screen (E.1, row T26, `component/plugin-route-missing.tsx`): the route's name in
//! the warning color and a "go home" button, centered.

use opentui::prelude::*;

use crate::app::Tui;
use crate::routes::Route;

pub fn mount(tui: &Tui, id: &str, name: &str) -> View {
    let app = &tui.app;
    let theme = tui.page();
    let text = Text::new(app, format!("Unknown plugin route: {id}/{name}")).fg(theme.text.feedback.warning.base);
    let weak = tui.weak();
    let home = View::new(app)
        .bg(theme.background.action.primary.hovered)
        .padding_x(1)
        .child(&Text::new(app, "go home").fg(theme.text.action.primary.hovered))
        .on_click(move |cx, _| {
            let weak = weak.clone();
            // Navigating replaces this view; do it after the click handler returns.
            cx.defer(move |_| {
                if let Some(tui) = weak.upgrade() {
                    tui.navigate(Route::Home);
                }
            });
        });
    View::new(app)
        .column()
        .width(Length::percent(100.0))
        .height(Length::percent(100.0))
        .align_items(Align::Center)
        .justify(Justify::Center)
        .gap(1)
        .child(&text)
        .child(&home)
}
