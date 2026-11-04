//! Server-driven `tui.*` events, and `session.deleted` and `session.moved` for the open session (E.1,
//! rows T10 and T11). T.1 calls [`install`] once after mounting.

use crate::app::Tui;

pub fn install(_tui: &Tui) {}
