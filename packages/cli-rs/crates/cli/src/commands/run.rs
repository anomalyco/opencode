//! `run`: send a message and print the reply.

use super::{Context, not_built};
use crate::args::RunArgs;

pub fn run(_context: &Context, _args: &RunArgs) -> anyhow::Result<()> {
    not_built("run", "C.10")
}
