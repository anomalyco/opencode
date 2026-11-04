//! The full-screen TUI (T.1): `packages/tui/src/app.tsx` on opentui-rust. Structure: `docs/T.1.md`.
//!
//! [`app::Tui`] is the shared context, [`routes`] the screens. Each later step fills its own modules;
//! a one-line file is a stub that names its step.

pub mod app;
pub mod client_mcp;
pub mod composer;
pub mod dialogs;
pub mod features;
pub mod frame;
pub mod panel;
pub mod plugins;
pub mod prompt;
pub mod routes;
pub mod status;
pub mod tabs;
pub mod terminal;

pub use app::{Deps, Launch, Tui, mount, run};
pub use routes::Route;
