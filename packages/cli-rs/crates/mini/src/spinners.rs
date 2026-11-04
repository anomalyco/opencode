//! The 14 work spinners (`config/index.tsx:29-44`): M.4. M.1's footer shows no spinner.

use opencode_local::cli_config::MiniWorkSpinner;

/// The frames of `spinner`, and how long each shows. Empty until M.4.
pub fn frames(
    _spinner: MiniWorkSpinner,
    _mono: bool,
) -> (&'static [&'static str], std::time::Duration) {
    (&[], std::time::Duration::from_millis(80))
}
