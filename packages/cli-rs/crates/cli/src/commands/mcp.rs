//! `mcp`: MCP servers.

use super::{Context, not_built};
use crate::args::{McpArgs, McpCommand};

pub fn run(_context: &Context, args: &McpArgs) -> anyhow::Result<()> {
    match &args.command {
        None => crate::help::print(&["mcp"]),
        Some(McpCommand::List(_)) => not_built("mcp list", "C.6"),
        Some(McpCommand::Add(_)) => not_built("mcp add", "C.6"),
        Some(McpCommand::Auth(_)) => not_built("mcp auth", "C.6"),
        Some(McpCommand::Logout(_)) => not_built("mcp logout", "C.6"),
    }
}
