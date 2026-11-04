//! `session`: list, delete, export, and import sessions.

use super::{Context, not_built};
use crate::args::{SessionArgs, SessionCommand};

pub fn run(_context: &Context, args: &SessionArgs) -> anyhow::Result<()> {
    match &args.command {
        None => crate::help::print(&["session"]),
        Some(SessionCommand::List(_)) => not_built("session list", "C.2"),
        Some(SessionCommand::Delete(_)) => not_built("session delete", "C.2"),
        Some(SessionCommand::Export(_)) => not_built("session export", "C.2"),
        Some(SessionCommand::Import(_)) => not_built("session import", "C.2"),
    }
}
