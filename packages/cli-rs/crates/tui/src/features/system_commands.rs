//! System commands and toggles (E.20, row T19). T.1 registers `app.exit`, `help.show`, `session.new`,
//! and the palette in `app::install_keys`, and calls [`install`] once for the rest.

use crate::app::Tui;

pub fn install(_tui: &Tui) {}
