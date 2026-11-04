//! `acp`: the Agent Client Protocol server.

use super::{Context, not_built};
use crate::args::AcpArgs;

pub fn run(_context: &Context, _args: &AcpArgs) -> anyhow::Result<()> {
    not_built("acp", "C.11")
}
