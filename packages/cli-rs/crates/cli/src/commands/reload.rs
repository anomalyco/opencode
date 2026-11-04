//! `reload`: reload the server configuration.

use super::{Context, not_built};

pub fn run(_context: &Context) -> anyhow::Result<()> {
    not_built("reload", "C.1")
}
