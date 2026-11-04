//! "Connect an integration" (E.17a).

use opencode_api::generated::IntegrationID;

use crate::app::Tui;

/// `DialogIntegration { integrationID, autoConnect }`, which the MCP dialog (E.17b) opens for a
/// server that needs sign-in. A stub until E.17a.
pub fn show_auto_connect(_tui: &Tui, integration: &IntegrationID) {
    log::info!("integration sign-in is not built yet: {}", integration.0);
}
