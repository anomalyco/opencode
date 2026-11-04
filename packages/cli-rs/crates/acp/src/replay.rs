//! `session/load` history replay (`packages/cli/src/acp/replay.ts`).
//!
//! C.12 (`rs-acp-rest`) owns this file. C.11 left the signature `session/load` calls; it replays
//! nothing yet. `content::parts_to_content_chunks` and `translate::reasoning_message_id` are ready
//! for it.

use opencode_api::client::Client;

use crate::capabilities::Capabilities;
use crate::connection::Connection;
use crate::error::Failure;
use crate::sessions::Attached;

/// Sends the session's stored messages to the client as session updates, oldest first.
pub async fn history(
    _client: &Client,
    _connection: &Connection,
    _attached: &Attached,
    _capabilities: &Capabilities,
) -> Result<(), Failure> {
    Ok(())
}
