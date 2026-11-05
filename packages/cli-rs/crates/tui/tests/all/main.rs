//! The TUI's integration tests, one module per area, linked into one binary so a suite run links the static
//! OpenTUI and tree-sitter set once. Select an area with `cargo test -p opencode-tui --test all <module>::`.

mod support {
    pub mod ide;
    pub mod wait;
}

mod actions;
mod app;
mod attach;
mod complete;
mod composer;
mod config_live;
mod diffs;
mod editor;
mod form;
mod integrations;
mod mcp;
mod messages;
mod models;
mod more_tools;
mod navigate;
mod permission;
mod prompt;
mod queue;
mod review_ms1;
mod root;
mod sessions;
mod settings;
mod shared_state;
mod shell;
mod system;
mod system_commands;
mod tabs;
mod terminal;
mod tools;
mod transcript;
mod user_keys;
mod worktrees;
