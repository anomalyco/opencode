//! What the home footer's source reads of the host crate: the ABI crate as `abi`, and the slot paths it names, which
//! are the host's published ones (`crates/plugin/src/slot.rs`).

pub use opencode_plugin_abi as abi;

pub mod slot {
    pub const HOME_FOOTER: &str = "home.footer";
    pub const HOME_FOOTER_STATUS: &str = "home.footer.status";
}
