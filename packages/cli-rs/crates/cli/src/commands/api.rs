//! `api`: a request to the running server.

use super::{Context, not_built};
use crate::args::ApiArgs;

pub fn run(_context: &Context, _args: &ApiArgs) -> anyhow::Result<()> {
    not_built("api", "C.4")
}
