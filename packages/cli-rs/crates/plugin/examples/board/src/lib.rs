//! The board as a library: [`board`] is the plugin, and this file only exports it. Tests link `board.rs` itself.

mod board;

opencode_plugin_abi::plugin!(id = "example.board", board::setup);
