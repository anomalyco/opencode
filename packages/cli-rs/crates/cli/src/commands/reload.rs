//! `reload`: reload the server configuration (`packages/cli/src/commands/handlers/reload.ts`).

use opencode_api::client::RequestOptions;

use super::Context;
use super::client::{block_on, connect};

pub fn run(context: &Context) -> anyhow::Result<()> {
    block_on(async {
        let (_, client) = connect(context).await?;
        anyhow::Ok(client.location_reload(&RequestOptions::default()).await?)
    })??;
    crate::output::print("Configuration reloaded\n")
}
