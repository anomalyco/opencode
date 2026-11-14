//! The TUI's own files, as its `plugins` module has them.

#[path = "../../../../../tui/src/plugins/keep.rs"]
mod keep;

use keep::{hidden, kept};

#[path = "../../../../../tui/src/plugins/home_footer.rs"]
pub mod home_footer;
