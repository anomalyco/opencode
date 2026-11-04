//! `serve`, delegated to the TypeScript CLI.

use super::{Context, not_built};
use crate::args::ServeArgs;

pub fn run(_context: &Context, _args: &ServeArgs) -> anyhow::Result<()> {
    not_built("serve", "D.1")
}
