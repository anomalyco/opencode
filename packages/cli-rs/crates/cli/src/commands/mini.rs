//! `mini`: the minimal interactive interface.

use super::{Context, not_built};
use crate::args::MiniArgs;

pub fn run(_context: &Context, _args: &MiniArgs) -> anyhow::Result<()> {
    not_built("mini", "M.1")
}
