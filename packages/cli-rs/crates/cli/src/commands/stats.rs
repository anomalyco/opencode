//! `stats`: usage statistics.

use super::{Context, not_built};
use crate::args::StatsArgs;

pub fn run(_context: &Context, _args: &StatsArgs) -> anyhow::Result<()> {
    not_built("stats", "C.3")
}
