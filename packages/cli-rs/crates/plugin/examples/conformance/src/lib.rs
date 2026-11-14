//! The conformance plugin as a library: [`conformance`] is the plugin, and this file only exports it, as ABI 2.0, or
//! as ABI 1.x with the `v1` feature. Tests link `conformance.rs` itself.

mod conformance;

#[cfg(not(feature = "v1"))]
opencode_plugin_abi::plugin!(id = "conformance", conformance::setup);

#[cfg(feature = "v1")]
opencode_plugin_abi::export_plugin!("conformance", conformance::setup, requires_minor = 4);
