//! What a built-in's slot surface (contract 2.0, P6a) answers for 1.x's `Render::Keep` and `Render::Hide`. Its own file,
//! so a built-in's source builds as a library too (`crates/plugin/examples/home-footer`).

use opencode_plugin::abi::v2::Node;

/// What a built-in's slot surface answers when nothing it shows changed: its last tree, kept whole by the host with no
/// work, as a 1.x render's `Render::Keep`. The surface's root carries the id `root`.
pub(crate) fn kept(root: &str) -> Node {
    Node::keep(root)
}

/// What a built-in's slot surface shows when it shows nothing, as a 1.x render's `Render::Hide`: a hidden root.
pub(crate) fn hidden(root: &str) -> Node {
    Node::column(Vec::new()).visible(false).with_id(root)
}
