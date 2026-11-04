//! `upgrade` (alias `update`), delegated to the TypeScript CLI (D.1).

use opencode_service::delegate;

use super::Context;
use crate::args::UpgradeArgs;

pub fn run(_context: &Context, _args: &UpgradeArgs) -> anyhow::Result<()> {
    // The TypeScript binary replaces this process, so this process's queued records go first.
    crate::telemetry::flush();
    Err(delegate::forward().into())
}
