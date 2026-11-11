//! Running shell commands (F.8), kept per location: read with the location's catalogs, added by
//! `shell.created`, and removed when they exit or are deleted.

use indexmap::IndexMap;
use opencode_api::generated::*;

use crate::location::{Catalog, Location};
use crate::state::{Data, Error, State, Task};

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
        self.location_mut(location).shell.get_or_insert_default().insert(info.id.clone(), shell);
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
        if let Some(shells) = self.location_mut(location).shell.as_mut() {
            shells.shift_remove(id);
        }
    }

    /// Adds a create (`Some`) or an exit to the overlay of the location's shell read in flight, if any.
    fn record_shell(&mut self, location: &Location, id: &ShellID, change: Option<Shell>) {
        let Some(read) = self.locations.get_mut(location).and_then(|data| data.shell_read.as_mut()) else {
            return;
        };
        let Some(changes) = read.changes.as_mut() else {
            return;
        };
        changes.insert(id.clone(), change);
        if changes.len() > OVERLAY {
            read.changes = None;
        }
    }

    /// Starts a shell read of `location` with an empty overlay; the returned ticket alone may publish it.
    fn begin_shell_read(&mut self, location: &Location) -> u64 {
        let ticket = self.token();
        let read = ShellRead { ticket, changes: Some(IndexMap::new()) };
        self.locations.entry(location.clone()).or_default().shell_read = Some(read);
        ticket
    }

    /// Publishes the list read `ticket` started, with its overlay applied. True when the overlay overflowed: the
    /// list is published alone and the read is invalidated, so the caller reads again.
    fn publish_shells(&mut self, location: &Location, ticket: u64, response: ShellListOutput) -> bool {
        let read =
            self.locations.get_mut(location).and_then(|data| data.shell_read.take_if(|read| read.ticket == ticket));
        let Some(read) = read else {
            return false;
        };
        let at = Location::from(&response.location);
        let mut shells: IndexMap<ShellID, Shell> = response
            .data
            .into_iter()
            .map(|info| {
                let info = from_list(info);
                (info.id.clone(), Shell { info, location: at.clone() })
            })
            .collect();
        let overflowed = read.changes.is_none();
        for (id, change) in read.changes.into_iter().flatten() {
            match change {
                Some(shell) => {
                    shells.insert(id, shell);
                }
                None => {
                    shells.shift_remove(&id);
                }
            }
        }
        if overflowed {
            self.syncs.invalidate(&Catalog::Shell.key(location));
        }
        self.location_mut(&at).shell = Some(shells);
        overflowed
    }
}

/// Creates and exits one shell read keeps (O-92 Q1 (a)); past it the read publishes its list alone and reads again.
const OVERLAY: usize = 1024;

/// A location's shell read in flight (M1): the ticket that may publish it, and the shells created (`Some`) and
/// exited (`None`) since it began, or `None` once more than [`OVERLAY`] arrived.
#[derive(Debug, Clone)]
pub(crate) struct ShellRead {
    ticket: u64,
    changes: Option<IndexMap<ShellID, Option<Shell>>>,
}

impl Data {
    /// Reads a location's running shells once per invalidation.
    pub fn shell_sync(&self, location: Option<&Location>) -> Task<()> {
        self.catalog_sync(Catalog::Shell, location)
    }

    pub fn shell_invalidate(&self, location: Option<&Location>) {
        self.catalog_invalidate(Catalog::Shell, location)
    }

    /// The `Catalog::Shell` read. A shell created or exited while it is in flight overrides the list it returns
    /// (deviation O92-shell-list), so the list never loses a new shell or brings back an exited one.
    pub(crate) fn shell_read(&self, location: Location) -> Task<()> {
        let begin = location.clone();
        self.sync_start(
            Catalog::Shell.key(&location),
            move |state| state.begin_shell_read(&begin),
            move |data, ticket| async move {
                let response = data
                    .client()
                    .shell_list(&ShellListInput { location: location.query() })
                    .await
                    .map_err(Error::new)?;
                if data.write(|state| state.publish_shells(&location, ticket, response)) {
                    data.refresh_catalogs(vec![Catalog::Shell], location);
                }
                Ok(())
            },
        )
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
