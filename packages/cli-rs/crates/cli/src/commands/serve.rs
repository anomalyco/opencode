//! `serve`, delegated to the TypeScript CLI (D.1).

use opencode_service::delegate;

use super::Context;
use crate::args::ServeArgs;

pub fn run(_context: &Context, _args: &ServeArgs) -> anyhow::Result<()> {
    Err(delegate::forward().into())
}
