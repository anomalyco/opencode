//! `uninstall`, delegated to the TypeScript CLI (D.1).

use opencode_service::delegate;

use super::Context;
use crate::args::UninstallArgs;

pub fn run(_context: &Context, _args: &UninstallArgs) -> anyhow::Result<()> {
    Err(delegate::forward().into())
}
