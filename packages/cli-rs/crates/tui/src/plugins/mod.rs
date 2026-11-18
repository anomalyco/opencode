pub mod approve;
pub mod btw;
pub mod contain;
pub mod diffs;
pub mod fallback;
pub mod fetch;
pub mod goal;
pub mod home_footer;
pub mod host;
pub mod manager;
pub mod notifications;
pub mod panel;
pub mod prompt_footer;
pub mod sidebar_context;
pub mod sidebar_footer;
pub mod sidebar_limit;
pub mod sidebar_mcp;
pub mod sidebar_todo;
pub mod stats;

mod keep;

pub(crate) use keep::{hidden, kept};
