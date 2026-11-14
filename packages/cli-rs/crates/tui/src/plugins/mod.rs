//! Built-in feature plugins and the plugin host. Each file belongs to the step that names it.

pub mod btw;
pub mod contain;
pub mod diffs;
pub mod fetch;
pub mod goal;
pub mod home_footer;
pub mod host;
pub mod notifications;
pub mod panel;
pub mod prompt_footer;
pub mod sidebar_context;
pub mod sidebar_footer;
pub mod sidebar_limit;
pub mod sidebar_mcp;
pub mod sidebar_todo;
pub mod stats;

use opencode_plugin::abi::v2::Node;

/// What a built-in's slot surface (contract 2.0, P6a) answers when nothing it shows changed: its last tree, kept whole
/// by the host with no work, as a 1.x render's `Render::Keep`. The surface's root carries the id `root`.
pub(crate) fn kept(root: &str) -> Node {
    Node::Keep { key: root.to_owned() }
}

/// What a built-in's slot surface shows when it shows nothing, as a 1.x render's `Render::Hide`: a hidden root.
pub(crate) fn hidden(root: &str) -> Node {
    Node::column(Vec::new()).visible(false).with_id(root)
}
