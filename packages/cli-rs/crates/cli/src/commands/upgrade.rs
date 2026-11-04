//! `upgrade` (alias `update`), delegated to the TypeScript CLI (D.1).

use opencode_service::delegate;

use super::Context;
use crate::args::UpgradeArgs;

pub fn run(_context: &Context, _args: &UpgradeArgs) -> anyhow::Result<()> {
    Err(delegate::forward().into())
}
