//! `auth`: integrations and credentials.

use super::{Context, not_built};
use crate::args::{AuthArgs, AuthCommand};

pub fn run(_context: &Context, args: &AuthArgs) -> anyhow::Result<()> {
    match &args.command {
        None => crate::help::print(&["auth"]),
        Some(AuthCommand::List(_)) => not_built("auth list", "C.5"),
        Some(AuthCommand::Login(_)) => not_built("auth login", "C.5"),
        Some(AuthCommand::Logout(_)) => not_built("auth logout", "C.5"),
        Some(AuthCommand::Export(_)) => not_built("auth export", "C.5"),
        Some(AuthCommand::Import(_)) => not_built("auth import", "C.5"),
        Some(AuthCommand::Switch(_)) => not_built("auth switch", "C.5"),
    }
}
