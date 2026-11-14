//! The built-in home footer as a library: its source and the helpers it uses are the TUI's own files, unchanged. The
//! ID is the test's, so the library loads beside the TUI with its linked footer disabled.

mod plugins;

fn setup(setup: &mut opencode_plugin_abi::Setup) -> Result<(), String> {
    (plugins::home_footer::plugin().setup)(setup)
}

opencode_plugin_abi::plugin!(id = "file.home.footer", setup);
