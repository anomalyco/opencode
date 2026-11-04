//! `upgrade` (alias `update`), delegated to the TypeScript CLI.

use super::{Context, not_built};
use crate::args::UpgradeArgs;

pub fn run(_context: &Context, _args: &UpgradeArgs) -> anyhow::Result<()> {
    not_built("upgrade", "D.1")
}
