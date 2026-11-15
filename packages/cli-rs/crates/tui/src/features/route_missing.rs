//! The missing plugin route screen (E.1, row T26, `component/plugin-route-missing.tsx`): the route's name in
//! the warning color and a "go home" button, centered. The route of a plugin that failed says that instead, and points
//! to `/plugins` (PL-8, deviation `F16-plugin-failed-route`).

use crate::prelude::*;

pub fn mount(tui: &Tui, id: &str, name: &str) -> View {
    let app = &tui.app;
    let theme = tui.page();
    let failed = tui
        .plugins
        .entries()
        .into_iter()
        .any(|entry| entry.id == id && matches!(entry.status, opencode_plugin::Status::Failed(_)));
    let message = match failed {
        true => format!("Plugin {id} failed. Run /plugins for details."),
        false => format!("Unknown plugin route: {id}/{name}"),
    };
    let text = Text::new(app, message).fg(theme.text.feedback.warning.base);
    let weak = tui.weak();
    let home = View::new(app)
        .bg(theme.background.action.primary.hovered)
        .padding_x(1)
        .child(&Text::new(app, "go home").fg(theme.text.action.primary.hovered))
        .mouse_pointer(MousePointer::POINTER)
        .on_click(move |cx, _| {
            // Navigating replaces this view; do it after the click handler returns.
            cx.defer(bind!(weak, |tui, _| tui.navigate(Route::Home)));
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
