//! `debug`: debugging and troubleshooting tools.

use super::{Context, not_built};
use crate::args::{DebugArgs, DebugCommand};

pub fn run(_context: &Context, args: &DebugArgs) -> anyhow::Result<()> {
    match &args.command {
        None => crate::help::print(&["debug"]),
        Some(DebugCommand::Agents(_)) => not_built("debug agents", "C.1"),
        Some(DebugCommand::Config(_)) => not_built("debug config", "C.1"),
        Some(DebugCommand::HeapDump(_)) => not_built("debug heap-dump", "C.1"),
        Some(DebugCommand::Paths(_)) => not_built("debug paths", "C.1"),
    }
}
