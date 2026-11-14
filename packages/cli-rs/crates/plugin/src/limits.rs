//! Limits on host work (synthesis 4.2, phase Pl): what a plugin's tree may make the host's UI thread build and hold,
//! on every carrier, built-ins too. Each limit is checked before anything is built: a tree's nodes, the rows the
//! host builds for it at once, a node's text and hunks, an image's header. Over a limit, the one node that crosses
//! it shows a placeholder and the rest of the tree draws ([`crate::reconcile`]); a malformed tree is still refused
//! whole.
//!
//! What the host holds for a plugin (the nodes of its mounted trees, its content and its decoded images) is charged
//! to the plugin and to the total, here, outside any mount: a plugin cannot spend what another left, and none can
//! spend more than the total. A charge is released when the tree, the content or the image goes. The canvas bounds
//! are [`crate::canvas`]'s, on the same rule.
//!
//! The numbers come from measurement (`steps/plugins-pl.md`); tests change them with [`set`].

use std::cell::{Cell, RefCell};
use std::collections::HashMap;

/// The limits. [`Limits::default`] is what the client runs with.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    /// The nodes of one tree, the data of a list's items and kept subtrees included.
    pub nodes: u64,
    /// The rows the host builds for one tree at once, by what each costs it: a node is one, a text's or Markdown's
    /// line one more, a line of code two, a patch's line one and its hunk 30. A list's items are built when they come
    /// into view, each under this limit of its own.
    pub rows: u64,
    /// The text of one node, in bytes: a patch, code, Markdown, a text's spans, an input's value.
    pub text: u64,
    /// The hunks of one patch.
    pub hunks: u64,
    /// One image's encoded bytes.
    pub image_bytes: u64,
    /// One image's width and its height, in pixels, as its header names them.
    pub image_side: u64,
    /// The nodes of one plugin's mounted trees, and of all plugins'.
    pub plugin_nodes: u64,
    pub all_nodes: u64,
    /// The content bytes one plugin's mounts hold, and all plugins'.
    pub plugin_content: u64,
    pub all_content: u64,
    /// The bytes of the images decoded for one plugin, and for all, at four bytes a pixel.
    pub plugin_images: u64,
    pub all_images: u64,
}

/// Measured in release, `TestApp` 200x58 (`steps/plugins-pl.md`): a row costs the host about 4 us to build and lay out
/// the first time, so 3,000 rows of any kind are under a 16.7 ms frame; 20,000 nodes of a list's data cost 12 ms; a
/// patch's hunk 0.12 ms; a text of 1 MiB 4 ms; an image of 2048x2048 pixels 28 ms to decode, which a worker does, and
/// 0.6 ms to copy in.
impl Default for Limits {
    fn default() -> Self {
        Self {
            nodes: 20_000,
            rows: 3_000,
            text: 1 << 20,
            hunks: 100,
            image_bytes: 8 << 20,
            image_side: 2048,
            plugin_nodes: 40_000,
            all_nodes: 100_000,
            plugin_content: 32 << 20,
            all_content: 128 << 20,
            plugin_images: 32 << 20,
            all_images: 96 << 20,
        }
    }
}

thread_local! {
    static LIMITS: Cell<Limits> = Cell::new(Limits::default());
    static HELD: RefCell<HashMap<String, Held>> = RefCell::default();
}

/// The limits on this thread.
pub fn get() -> Limits {
    LIMITS.with(Cell::get)
}

/// Sets this thread's limits until the guard drops, for tests.
pub fn set(limits: Limits) -> Restore {
    Restore(LIMITS.with(|cell| cell.replace(limits)))
}

/// Puts the limits back.
pub struct Restore(Limits);

impl Drop for Restore {
    fn drop(&mut self) {
        LIMITS.with(|cell| cell.set(self.0));
    }
}

/// What the host holds for a plugin, or for all of them.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Held {
    pub nodes: u64,
    pub content: u64,
    pub images: u64,
}

/// What is charged.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Nodes,
    Content,
    Images,
}

impl Held {
    fn of(&mut self, kind: Kind) -> &mut u64 {
        match kind {
            Kind::Nodes => &mut self.nodes,
            Kind::Content => &mut self.content,
            Kind::Images => &mut self.images,
        }
    }
}

/// The empty plugin ID stands for all plugins in [`HELD`].
const ALL: &str = "";

/// What the host holds for `plugin` now.
pub fn held(plugin: &str) -> Held {
    HELD.with(|held| held.borrow().get(plugin).copied().unwrap_or_default())
}

/// What the host holds for all plugins now.
pub fn total() -> Held {
    held(ALL)
}

fn bounds(kind: Kind) -> (u64, u64) {
    let limits = get();
    match kind {
        Kind::Nodes => (limits.plugin_nodes, limits.all_nodes),
        Kind::Content => (limits.plugin_content, limits.all_content),
        Kind::Images => (limits.plugin_images, limits.all_images),
    }
}

/// How much of `kind` `plugin` may hold for something that holds `old` of it now, and gives that back when it is
/// replaced: the least of what the plugin and all plugins have left.
pub fn room(plugin: &str, kind: Kind, old: u64) -> u64 {
    let (own, all) = bounds(kind);
    let mine = own.saturating_sub(held(plugin).of_kind(kind).saturating_sub(old));
    let left = all.saturating_sub(total().of_kind(kind).saturating_sub(old));
    mine.min(left)
}

/// Charges `amount` of `kind` to `plugin` if it fits beside what it holds already: whether it did.
pub fn charge(plugin: &str, kind: Kind, amount: u64) -> bool {
    if amount > room(plugin, kind, 0) {
        return false;
    }
    change(plugin, kind, |held| held.saturating_add(amount));
    true
}

/// Replaces a charge of `old` with `new`, which the caller admitted with [`room`].
pub fn recharge(plugin: &str, kind: Kind, old: u64, new: u64) {
    change(plugin, kind, |held| held.saturating_sub(old).saturating_add(new));
}

/// Gives back `amount` of `kind` that `plugin` held.
pub fn release(plugin: &str, kind: Kind, amount: u64) {
    change(plugin, kind, |held| held.saturating_sub(amount));
}

fn change(plugin: &str, kind: Kind, f: impl Fn(u64) -> u64) {
    HELD.with(|held| {
        let mut held = held.borrow_mut();
        for id in [plugin, ALL] {
            let entry = held.entry(id.to_owned()).or_default();
            *entry.of(kind) = f(*entry.of(kind));
            if id != ALL && *entry == Held::default() {
                held.remove(id);
            }
        }
    });
}

impl Held {
    fn of_kind(mut self, kind: Kind) -> u64 {
        *self.of(kind)
    }
}

/// Why a node shows a placeholder.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Over {
    /// The tree's nodes, or its plugin's, or all plugins'.
    Nodes,
    /// The rows the host would build at once.
    Rows,
    /// The node's text, in bytes.
    Text(u64),
    /// A patch's hunks.
    Hunks(u64),
    /// Content its plugin could not hold.
    Content,
    /// An image's bytes or pixels, or what its plugin or all plugins may hold decoded.
    Image,
}

impl std::fmt::Display for Over {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Over::Nodes => write!(f, "too many nodes"),
            Over::Rows => write!(f, "too large to build at once"),
            Over::Text(bytes) => write!(f, "too large: {bytes} bytes"),
            Over::Hunks(hunks) => write!(f, "too large: {hunks} hunks"),
            Over::Content => write!(f, "its content is past what the plugin may hold"),
            Over::Image => write!(f, "image too large"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Expected (4.2): a plugin cannot spend what another left, nor more than the total; a replacement gives back
    // what it replaces; a release ends the charge.
    #[test]
    fn a_plugin_spends_only_its_own_share_of_the_total() {
        let _limits = set(Limits { plugin_content: 10, all_content: 15, ..Limits::default() });
        assert!(charge("test.a", Kind::Content, 10));
        assert!(!charge("test.a", Kind::Content, 1), "past its own share");
        assert_eq!(room("test.b", Kind::Content, 0), 5, "what the total has left");
        assert!(!charge("test.b", Kind::Content, 6));
        assert!(charge("test.b", Kind::Content, 5));
        assert_eq!(room("test.a", Kind::Content, 4), 4, "a replacement of 4 gets back its own 4, and no more");
        recharge("test.a", Kind::Content, 4, 2);
        assert_eq!((held("test.a").content, total().content), (8, 13));
        release("test.a", Kind::Content, 8);
        release("test.b", Kind::Content, 5);
        assert_eq!((held("test.a"), held("test.b"), total()), (Held::default(), Held::default(), Held::default()));
    }
}
