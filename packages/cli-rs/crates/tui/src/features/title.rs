//! The terminal title (E.1, row T09). T.1 calls [`install`] once and [`route_changed`] after each
//! navigation. Until E.1 the title stays "OpenCode", set by `app::run`.

use crate::app::Tui;

pub fn install(_tui: &Tui) {}

pub fn route_changed(_tui: &Tui) {}
