//! The permission prompt (E.9a). T.1 calls [`sync`] from the session route with the region above the
//! prompt.

use opencode_api::generated::SessionID;
use opencode_store::Changes;
use opentui::prelude::View;

use crate::app::Tui;

pub fn sync(_tui: &Tui, _region: &View, _session: &SessionID, _changes: &Changes) {}
