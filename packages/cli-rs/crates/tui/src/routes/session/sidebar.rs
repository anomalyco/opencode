//! The session sidebar (E.14). T.1 calls [`mount`] with the session route's row.

use opencode_api::generated::SessionID;
use opentui::prelude::View;

use crate::app::Tui;

pub fn mount(_tui: &Tui, _row: &View, _session: &SessionID) {}
