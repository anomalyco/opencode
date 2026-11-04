//! The home footer plugin (E.14, row F01, `feature-plugins/home/footer.tsx`). E.1 shows the version in the
//! bottom right corner so the home matches TS; E.14 adds the MCP and plugin counts and the status slot.

use opentui::prelude::*;

use crate::app::Tui;

pub fn mount(tui: &Tui, home: &View) {
    let app = &tui.app;
    let (width, height) = app.size();
    if height < 14 || width < 44 {
        return;
    }
    let padding = if height < 16 { 0 } else { 1 };
    let row = View::new(app)
        .row()
        .width(Length::percent(100.0))
        .padding_y(padding)
        .padding_x(2)
        .gap(2)
        .shrink(0.0)
        .child(&View::new(app).grow(1.0));
    // `homeFooterVisibility`: the version from 64 columns.
    if width >= 64 {
        row.add(
            &View::new(app)
                .shrink(0.0)
                .child(&Text::new(app, tui.startup.args.version.clone()).fg(tui.page().text.muted)),
        );
    }
    home.add(&row);
}
