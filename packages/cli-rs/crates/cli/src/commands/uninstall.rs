//! `uninstall`, delegated to the TypeScript CLI.

use super::{Context, not_built};
use crate::args::UninstallArgs;

pub fn run(_context: &Context, _args: &UninstallArgs) -> anyhow::Result<()> {
    not_built("uninstall", "D.1")
}
