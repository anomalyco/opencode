//! Reconnecting, startup loading, error boundary, and migration overlays (E.1, rows T04 to T07). T.1
//! calls [`install`] once after mounting.

use crate::app::Tui;

pub fn install(_tui: &Tui) {}
