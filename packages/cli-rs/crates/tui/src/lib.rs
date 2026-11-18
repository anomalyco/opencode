//! The native terminal UI.

pub mod app;
pub mod client_mcp;
pub mod composer;
pub mod dialogs;
pub mod features;
pub mod frame;
pub mod local;
pub mod panel;
pub mod plugins;
mod prelude;
pub mod prompt;
pub mod routes;
pub mod tabs;
pub mod terminal;

pub use app::{Deps, Launch, Tui, mount, mount_with, run};
pub use features::startup::Args;
pub use routes::Route;
