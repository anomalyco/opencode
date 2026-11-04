//! `plugin`, delegated to the TypeScript CLI (D.1): the subcommands install with npm and resolve
//! entrypoints with `Host.resolve`.

use opencode_service::delegate;

use super::Context;
use crate::args::PluginArgs;

pub fn run(_context: &Context, args: &PluginArgs) -> anyhow::Result<()> {
    match &args.command {
        None => crate::help::print(&["plugin"]),
        Some(_) => Err(delegate::forward().into()),
    }
}
