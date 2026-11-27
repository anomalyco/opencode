//! The app root's children. Each layout round walks the tree depth first in paint order, z-index then child order, so
//! the root's last child is resized after every earlier subtree; but a node added or moved in a frame is resized before
//! its siblings in it, and re-adding a child in place is a move (OpenTUI's walk order). A node whose resize must come
//! last (the plugin behaviors' hook) is therefore put in once and kept last: every child added after it goes in before
//! it, through [`add`].

use std::cell::RefCell;
use std::collections::HashMap;

use opentui::prelude::*;

thread_local! {
    /// Each app's node kept last, by the address of its session, which lives as long as the app.
    static LAST: RefCell<HashMap<usize, AnyWidget>> = RefCell::default();
}

fn key(app: &App) -> usize {
    std::ptr::from_ref(app.session()) as usize
}

/// Adds `widget` to the root of `app` as its last child, before the node kept last, if there is one.
pub fn add(app: &App, widget: &impl Widget) {
    let root = app.root();
    let last = LAST.with(|last| last.borrow().get(&key(app)).cloned());
    let at = last.and_then(|last| root.children().iter().position(|child| child.id() == last.id()));
    match at {
        Some(at) => drop(root.insert(at, widget)),
        None => drop(root.add(widget)),
    }
}

/// Puts `widget` in as the root's last child, once, and keeps it last until [`release`].
pub fn keep_last(app: &App, widget: &impl Widget) {
    app.root().add(widget);
    LAST.with(|last| last.borrow_mut().insert(key(app), widget.as_any()));
}

/// Takes the node kept last out of the root of `app`.
pub fn release(app: &App) {
    if let Some(widget) = LAST.with(|last| last.borrow_mut().remove(&key(app))) {
        widget.detach();
    }
}
