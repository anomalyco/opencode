//! Running shell commands by location. Exit and deletion both remove a shell from the list.

use indexmap::IndexMap;
use opencode_api::generated::*;

use crate::changes::Parts;
use crate::core::{Effect, Shells, Ticket};
use crate::location::{Catalog, Location};
use crate::reads::{Read, ReadKey};
use crate::state::{Overlay, State};

/// What a change of the shells changes of their location.
const SHELLS: Parts = Parts::catalogs(&[Catalog::Shell]);

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
        self.record_shell(location, &info.id, Some(shell.clone()));
        self.location_mut(location, SHELLS).shell.get_or_insert_default().insert(info.id.clone(), shell);
    }

    pub(crate) fn remove_shell(&mut self, id: &ShellID, location: &Location) {
        self.record_shell(location, id, None);
        let present = self
            .locations
            .get(location)
            .and_then(|data| data.shell.as_ref())
            .is_some_and(|shells| shells.contains_key(id));
        if !present {
            return;
        }
        if let Some(shells) = self.location_mut(location, SHELLS).shell.as_mut() {
            shells.shift_remove(id);
        }
    }

    /// Adds a create (`Some`) or an exit to the overlay of the location's shell read in flight, if any.
    fn record_shell(&mut self, location: &Location, id: &ShellID, change: Option<Shell>) {
        if let Some(read) = self.locations.get_mut(location).and_then(|data| data.shell_read.as_mut()) {
            read.record(&id.0, change);
        }
    }

    /// Begins a shell read of `location` with an empty overlay; its ticket alone may publish it. Shell creation and
    /// exit events received during the read take precedence over its answer.
    pub(crate) fn begin_shells(&mut self, ticket: Ticket) -> Shells {
        let ReadKey::Catalog(Catalog::Shell, at) = ticket.key else { unreachable!("a shell read") };
        let location = self.read_location(at);
        let read = self.token();
        self.locations.entry(location.clone()).or_default().shell_read = Some(Overlay::new(read));
        Shells { ticket, location, read }
    }

    /// Publishes the list read `read` began, with its overlay applied. An overflowed overlay publishes the list alone
    /// and invalidates the read, which reads again.
    pub(crate) fn complete_shells(&mut self, shells: Shells, response: ShellListOutput, effects: &mut Vec<Effect>) {
        let location = shells.location;
        let read = self
            .locations
            .get_mut(&location)
            .and_then(|data| data.shell_read.take_if(|read| read.ticket() == shells.read));
        let Some(read) = read else { return };
        let at = Location::from(&response.location);
        let mut shells: IndexMap<ShellID, Shell> = response
            .data
            .into_iter()
            .map(|info| {
                let info = from_list(info);
                (info.id.clone(), Shell { info, location: at.clone() })
            })
            .collect();
        let changes = read.into_changes();
        let overflowed = changes.is_none();
        for (id, change) in changes.into_iter().flatten() {
            match change {
                Some(shell) => {
                    shells.insert(ShellID(id), shell);
                }
                None => {
                    shells.shift_remove(&ShellID(id));
                }
            }
        }
        if overflowed {
            self.invalidate(Read::Catalog(Catalog::Shell, &location));
        }
        self.location_mut(&at, SHELLS).shell = Some(shells);
        if overflowed {
            effects.push(Effect::Catalogs(vec![Catalog::Shell], location));
        }
    }
}

/// Shells created or exited during an in-flight read. An overflowed overlay still publishes the list and triggers
/// another read.
pub(crate) type ShellRead = Overlay<Shell>;

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
