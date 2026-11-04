//! Diff file menu (E.15b, row DLG49, `feature-plugins/system/diff-viewer-file-menu.tsx`): one row under a
//! right-clicked file heading or tree row that marks the file complete or incomplete. It holds the `menu` input
//! mode while open, so the viewer's keys wait; Escape, Ctrl+C, or a click elsewhere close it.

use std::rc::Weak;

use opencode_ui::keymap::{KeymapLayer, TuiCommand};
use opentui::keymap::{Condition, Disposer};
use opentui::prelude::*;

use super::viewer::{ID, Viewer};

const MODE: &str = "menu";
const WIDTH: u16 = 19;
/// Above the panels and routes, below the dialogs (3000).
const Z_INDEX: i32 = 2600;

/// The open menu; dropping it closes it.
pub struct Menu {
    app: App,
    overlay: View,
    // The layer goes before the mode.
    _layer: Option<Disposer>,
    _mode: Disposer,
}

impl Drop for Menu {
    fn drop(&mut self) {
        self.overlay.detach();
        self.app.request_redraw();
    }
}

/// A right-click on a file's header or tree row (`openFileMenu`), at cell `x`, `y`.
pub fn open(viewer: &Viewer, file: usize, x: u16, y: u16) {
    let Some(tui) = viewer.tui() else { return };
    // The previous menu goes first, so its mode and layer do not stack.
    drop(viewer.menu.take());
    let app = &tui.app;
    let theme = tui.page();
    let (width, height) = app.size();
    let label = if viewer.is_reviewed(file) {
        "Mark incomplete"
    } else {
        "Mark complete"
    };
    let menu_width = WIDTH.min(width);
    let base = theme.background.raised.high;
    let hovered = theme.background.action.primary.hovered;
    let row = View::new(app)
        .absolute()
        .position(Edge::Left, x.min(width - menu_width))
        .position(Edge::Top, (y + 1).min(height.saturating_sub(1)))
        .width(menu_width)
        .height(1)
        .padding_edge(Edge::Left, 1)
        .padding_edge(Edge::Right, 1)
        .bg(base)
        .child(
            &Text::new(app, label)
                .fg(theme.text.base)
                .selectable(false)
                .wrap(WrapMode::None)
                .truncate(true),
        );
    let overlay = View::new(app)
        .absolute()
        .position(Edge::Left, 0)
        .position(Edge::Top, 0)
        .width(width)
        .height(height)
        .z_index(Z_INDEX)
        .child(&row);

    let weak = viewer.weak();
    let painted = row.clone();
    row.on_hover(move |cx, over| {
        painted.bg(if over { hovered } else { base });
        cx.request_redraw();
    });
    let menu = weak.clone();
    row.on_mouse(move |cx, event| match event.kind {
        MouseEventKind::Down(button) => {
            if button == MouseButton::Right {
                close(&menu);
            }
            cx.prevent_default();
            cx.stop_propagation();
        }
        MouseEventKind::Up(button) => {
            cx.prevent_default();
            cx.stop_propagation();
            if button == MouseButton::Left {
                run(&menu, file);
            }
        }
        _ => {}
    });
    let menu = weak.clone();
    overlay.on_mouse(move |cx, event| {
        if matches!(event.kind, MouseEventKind::Down(_)) {
            close(&menu);
            cx.prevent_default();
            cx.stop_propagation();
        }
    });
    app.root().add(&overlay);

    let mode = tui.keymap.push_mode(MODE, Condition::Always);
    let (on_close, on_run) = (weak.clone(), weak);
    let layer = tui
        .keymap
        .layer(KeymapLayer {
            mode: Some(MODE.to_owned()),
            commands: vec![
                TuiCommand::inline("escape,ctrl+c", move |_, _| close(&on_close))
                    .title("Close file menu")
                    .group("Diff"),
                TuiCommand::inline("return", move |_, _| run(&on_run, file))
                    .title(label)
                    .group("Diff"),
            ],
            ..KeymapLayer::default()
        })
        .inspect_err(|error| log::error!("{ID} file menu layer: {error}"))
        .ok();
    *viewer.menu.borrow_mut() = Some(Menu {
        app: app.clone(),
        overlay,
        _layer: layer,
        _mode: mode,
    });
    app.request_redraw();
}

/// Closes the menu after the event that asked for it, so its widgets outlive their own handlers.
fn close(viewer: &Weak<Viewer>) {
    let Some(tui) = viewer.upgrade().and_then(|viewer| viewer.tui()) else {
        return;
    };
    let viewer = viewer.clone();
    tui.app.defer(move |_| {
        if let Some(viewer) = viewer.upgrade() {
            drop(viewer.menu.take());
        }
    });
}

/// The menu's one action: closes it, then toggles the file's mark (`run`).
fn run(viewer: &Weak<Viewer>, file: usize) {
    let Some(tui) = viewer.upgrade().and_then(|viewer| viewer.tui()) else {
        return;
    };
    let viewer = viewer.clone();
    tui.app.defer(move |_| {
        let Some(viewer) = viewer.upgrade() else {
            return;
        };
        drop(viewer.menu.take());
        viewer.toggle_reviewed(Some(file));
    });
}
