//! Message actions dialog (E.10b).

use opencode_api::generated::SessionID;

use crate::app::Tui;

/// `DialogMessage` for one message; the timeline's Enter (E.10a) calls it. E.10b fills it in.
pub fn show(_tui: &Tui, _session: SessionID, _message: String) {}
