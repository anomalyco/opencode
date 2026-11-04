//! `pair`: one-time links for a browser or app.

use super::{Context, not_built};
use crate::args::PairArgs;

pub fn run(_context: &Context, _args: &PairArgs) -> anyhow::Result<()> {
    not_built("pair", "C.9")
}
