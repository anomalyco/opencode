//! The conformance plugin as a library: [`conformance`] is the plugin, and this file only exports it, as ABI 2.0.
//! Tests link `conformance.rs` itself.

mod conformance;

opencode_plugin_abi::plugin!(id = "conformance", conformance::setup);
