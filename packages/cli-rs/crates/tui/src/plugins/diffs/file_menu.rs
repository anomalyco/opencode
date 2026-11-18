//! Diff file menu (E.15b, row DLG49, `feature-plugins/system/diff-viewer-file-menu.tsx`): one row under a
//! right-clicked file heading or tree row that marks the file complete or incomplete. An overlay of the plugin's,
//! owned by the viewer's mount: it takes the focus, so the viewer's keys wait; Escape and a press outside close it,
//! and Enter or a click of the row runs it.

use opencode_plugin::abi::interact::{Anchor, Bind, Button, Event, Handled, Interact, Layer, Overlay, PointerKind};
use opencode_plugin::abi::v2::{self, Node};
use opencode_plugin::abi::{Host, Layout, Span, Width, Wrap};

use super::{Diffs, MENU};

const WIDTH: u16 = 19;
const ROW: &str = "row";

pub fn open(host: &dyn Host, x: u16, y: u16) {
    host.overlay(Overlay { surface: MENU.to_owned(), anchor: Anchor::Point { x, y: y + 1 }, width: WIDTH, height: 1 });
}

pub fn view(diffs: &Diffs, _: &mut v2::View<'_>) -> Node {
    let held = diffs.viewer.borrow();
    let reviewed = held.as_ref().and_then(|viewer| viewer.menu.map(|file| viewer.is_reviewed(file)));
    let label = if reviewed == Some(true) { "Mark incomplete" } else { "Mark complete" };
    Node::row(vec![Node::text([Span::new(label)]).fg("text.base").unselectable().wrap(Wrap::None).truncate()])
        .with_id(ROW)
        .bg("background.raised.high")
        .padding_sides(opencode_plugin::abi::Edges { left: 1, right: 1, ..Default::default() })
        .interact(Interact {
            pointer: true,
            hover: Some("background.action.primary.hovered".into()),
            ..Interact::default()
        })
        .layout(Layout::default().width(Width::Percent(100.0)).height(Width::Cells(1)))
}

pub fn layer() -> Layer {
    Layer::default().keys(vec![Bind::new("return", "run")])
}

pub fn handle(diffs: &Diffs, host: &dyn Host, event: &Event) -> Handled {
    match event {
        Event::Key(key) if key.bind.as_deref() == Some("run") => run(diffs, host),
        Event::Pointer(pointer) if pointer.node == ROW => match (pointer.kind, pointer.button) {
            (PointerKind::Down, Some(Button::Right)) => close(diffs, host),
            (PointerKind::Up, Some(Button::Left)) => run(diffs, host),
            _ => {}
        },
        _ => return Handled::Pass,
    }
    Handled::Consume
}

fn close(diffs: &Diffs, host: &dyn Host) {
    host.close_overlay(MENU);
    if let Some(viewer) = diffs.viewer.borrow_mut().as_mut() {
        viewer.menu = None;
    }
}

fn run(diffs: &Diffs, host: &dyn Host) {
    host.close_overlay(MENU);
    let mut held = diffs.viewer.borrow_mut();
    let Some(viewer) = held.as_mut() else { return };
    let file = viewer.menu.take();
    viewer.toggle_reviewed(host, file);
    viewer.drawn = false;
    viewer.follow_tree(host);
}
