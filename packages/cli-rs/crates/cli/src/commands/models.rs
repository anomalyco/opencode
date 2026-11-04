//! `models`: list the available models.

use super::{Context, not_built};

pub fn run(_context: &Context) -> anyhow::Result<()> {
    not_built("models", "C.1")
}
