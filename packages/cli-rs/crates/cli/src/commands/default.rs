//! The root command, which opens the TUI. T.1 takes this file over, then C.13.

use super::Context;
use crate::args::RootArgs;

pub fn run(_context: &Context, _args: &RootArgs) -> anyhow::Result<()> {
    anyhow::bail!("the TUI is not built yet (plan step T.1)")
}
