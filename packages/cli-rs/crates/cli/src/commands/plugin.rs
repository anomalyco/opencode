//! `plugin`, delegated to the TypeScript CLI (D.1): the subcommands install with npm and resolve
//! entrypoints with `Host.resolve`.

use opencode_service::delegate;
use opencode_util::error;

use super::Context;
use crate::args::PluginArgs;

pub fn run(_context: &Context, args: &PluginArgs) -> error::Result<()> {
    match &args.command {
        None => crate::help::print(&["plugin"]),
        Some(_) => {
            // The TypeScript binary replaces this process, so this process's queued records go first.
            crate::telemetry::flush();
            Err(delegate::forward().into())
        }
    }
}
