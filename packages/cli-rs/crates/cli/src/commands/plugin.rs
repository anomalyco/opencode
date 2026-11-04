//! `plugin`, delegated to the TypeScript CLI.

use super::{Context, not_built};
use crate::args::{PluginArgs, PluginCommand};

pub fn run(_context: &Context, args: &PluginArgs) -> anyhow::Result<()> {
    match &args.command {
        None => crate::help::print(&["plugin"]),
        Some(PluginCommand::List(_)) => not_built("plugin list", "D.1"),
        Some(PluginCommand::Add(_)) => not_built("plugin add", "D.1"),
        Some(PluginCommand::Check(_)) => not_built("plugin check", "D.1"),
        Some(PluginCommand::Update(_)) => not_built("plugin update", "D.1"),
        Some(PluginCommand::Remove(_)) => not_built("plugin remove", "D.1"),
    }
}
