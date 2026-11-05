//! `reload`: reload the server configuration (`packages/cli/src/commands/handlers/reload.ts`).

use super::Context;
use super::client::{block_on, connect};

pub fn run(context: &Context) -> anyhow::Result<()> {
    block_on(async {
        let server = connect(context).await?;
        anyhow::Ok(server.client.location_reload().await?)
    })??;
    crate::output::print("Configuration reloaded\n")
}
