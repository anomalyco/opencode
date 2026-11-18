//! The TUI's integration tests, one module per area, linked into one binary so a suite run links the static
//! OpenTUI and tree-sitter set once. Select an area with `cargo test -p opencode-tui --test all <module>::`.

mod support;

#[global_allocator]
static HEAP: support::heap::Counting = support::heap::Counting;

mod actions;
mod animations;
mod app;
mod attach;
mod attention;
mod click_focus;
mod cold_catalogs;
mod complete;
mod composer;
mod config_live;
mod diffs;
mod drive;
mod editor;
mod form;
mod home_footer;
mod hover_pointer;
mod integrations;
mod mcp;
mod messages;
mod models;
mod more_tools;
mod navigate;
mod permission;
mod plugin_approval;
mod plugin_behave;
mod plugin_builtins;
mod plugin_canvas;
mod plugin_carriers;
mod plugin_claim;
// The JS host's rows (TypeScript plugins): in a build with the `ts` feature only (ts-feature).
#[cfg(feature = "ts")]
mod plugin_compat;
// The JS host's rows (TypeScript plugins): in a build with the `ts` feature only (ts-feature).
mod plugin_contain;
#[cfg(feature = "ts")]
mod plugin_fences;
mod plugin_fetch;
mod plugin_flood;
pub mod plugin_input;
mod plugin_limits;
#[cfg(luau)]
mod plugin_luau;
mod plugin_machines;
mod plugin_mail;
mod plugin_manager;
mod plugin_model;
// The JS host's rows (TypeScript plugins): in a build with the `ts` feature only (ts-feature).
#[cfg(feature = "ts")]
mod plugin_npm;
// The JS host's rows (TypeScript plugins): in a build with the `ts` feature only (ts-feature).
mod plugin_field_echo;
#[cfg(feature = "ts")]
mod plugin_ownership;
mod plugin_p0a;
mod plugin_pending_focus;
// The JS host's rows (TypeScript plugins): in a build with the `ts` feature only (ts-feature).
#[cfg(feature = "ts")]
mod plugin_pipe;
mod plugin_reads;
mod plugin_reconcile;
mod plugin_routing;
mod plugin_surface;
mod plugin_timers;
mod plugins;
// The JS host's rows (TypeScript plugins): in a build with the `ts` feature only (ts-feature).
#[cfg(feature = "ts")]
mod ports;
#[cfg(feature = "ts")]
mod ports_trio;
mod prompt;
mod prompt_footer;
mod pump;
mod queue;
mod reconnect;
mod resize;
mod review_ms1;
mod review_ms34;
mod root;
mod session_links;
mod session_view;
mod sessions;
mod settings;
mod shared_state;
mod shell;
mod sidebar;
mod system;
mod system_commands;
mod tabs;
mod terminal;
mod tools;
mod transcript;
mod tui_drop;
mod user_keys;
mod worktrees;
