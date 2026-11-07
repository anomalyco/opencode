//! `reload`: reload the server configuration (`packages/cli/src/commands/handlers/reload.ts`).

use super::Context;
use super::client::{block_on, connect};
use opencode_util::error;

pub fn run(context: &Context) -> error::Result<()> {
    block_on(async {
        let server = connect(context).await?;
        Ok::<_, error::Error>(server.client.location_reload().await?)
    })??;
    crate::output::print("Configuration reloaded\n")
}
