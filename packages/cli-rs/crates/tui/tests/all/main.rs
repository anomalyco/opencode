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
mod plugin_fetch;
mod plugin_gate;
mod plugin_machines;
mod plugin_model;
mod plugin_p0a;
mod plugin_reads;
mod plugin_reconcile;
mod plugin_surface;
mod plugins;
mod ports;
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
