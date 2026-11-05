//! Running shell commands (F.8), kept per location: read with the location's catalogs, added by
//! `shell.created`, and removed when they exit or are deleted.

use opencode_api::generated::*;

use crate::location::{Catalog, Location};
use crate::state::{Data, State, Task};

/// A running shell and the location that reported it.
#[derive(Debug, Clone, PartialEq)]
pub struct Shell {
    pub info: ShellInfo,
    pub location: Location,
}

impl Shell {
    /// The session that started the shell, if any (`metadata.sessionID`).
    pub fn session_id(&self) -> Option<&str> {
        self.info.metadata.get("sessionID").and_then(serde_json::Value::as_str)
    }
}

impl State {
    /// Running shells of a location (the default one for `None`), in arrival order.
    pub fn shells(&self, location: Option<&Location>) -> Vec<&Shell> {
        self.location(location)
            .and_then(|data| data.shell.as_ref())
            .map(|shells| shells.values().collect())
            .unwrap_or_default()
    }

    /// Running shells a session started, across every location.
    pub fn session_shells(&self, session: &SessionID) -> Vec<&Shell> {
        self.locations
            .values()
            .flat_map(|data| data.shell.iter().flat_map(|shells| shells.values()))
            .filter(|shell| shell.session_id() == Some(session.0.as_str()))
            .collect()
    }

    pub fn shell(&self, id: &ShellID) -> Option<&Shell> {
        self.locations.values().find_map(|data| data.shell.as_ref().and_then(|shells| shells.get(id)))
    }

    pub(crate) fn on_shell_created(&mut self, info: &ShellInfo, location: &Location) {
        let shell = Shell { info: info.clone(), location: location.clone() };
        self.location_mut(location).shell.get_or_insert_default().insert(info.id.clone(), shell);
    }

    pub(crate) fn remove_shell(&mut self, id: &ShellID, location: &Location) {
        let present = self
            .locations
            .get(location)
            .and_then(|data| data.shell.as_ref())
            .is_some_and(|shells| shells.contains_key(id));
        if !present {
            return;
        }
        if let Some(shells) = self.location_mut(location).shell.as_mut() {
            shells.shift_remove(id);
        }
    }
}

impl Data {
    /// Reads a location's running shells once per invalidation.
    pub fn shell_sync(&self, location: Option<&Location>) -> Task<()> {
        self.catalog_sync(Catalog::Shell, location)
    }

    pub fn shell_invalidate(&self, location: Option<&Location>) {
        self.catalog_invalidate(Catalog::Shell, location)
    }
}

/// The list read's shell type has the same fields as the event's.
pub(crate) fn from_list(info: ShellInfo) -> ShellInfo {
    ShellInfo {
        id: info.id,
        status: info.status,
        command: info.command,
        cwd: info.cwd,
        shell: info.shell,
        file: info.file,
        pid: info.pid,
        exit: info.exit,
        signal: info.signal,
        metadata: info.metadata,
        time: info.time,
    }
}
