//! Startup flows: `--continue`, `--session`, `--fork`, `--prompt` (E.1, row T02). T.1 opens
//! `--session` and `--continue` itself (`app::mount`) and calls [`run`] after the first route mounts.

use crate::app::Tui;

pub fn run(_tui: &Tui) {}
