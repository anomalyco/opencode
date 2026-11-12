//! The current location (E.1, `context/location.tsx`): the location the home or the open session works in,
//! read with `location.sync` while connected, and the "location not found" error the session route shows as
//! the location-missing view (row T18).
//!
//! Home sets its target (the one [`navigate_home`] passed, else the default), the session route sets the
//! session's location, and every new connection reads it again. Opening a session also uploads the
//! terminal's environment to it when the server is local (row G13, `app.tsx:529-539`).

use std::cell::{Cell, RefCell};
use std::time::Duration;

use opencode_api::generated::SessionID;
use opencode_store::location::Catalog;
use opencode_store::{Error, Location};
use opencode_ui::bind;

use crate::app::Tui;
use crate::routes::Route;

/// `retry`'s defaults: three attempts, 500 ms doubling.
const ATTEMPTS: u32 = 3;
const DELAY: Duration = Duration::from_millis(500);

#[derive(Default)]
pub struct LocationState {
    reference: RefCell<Option<Location>>,
    error: RefCell<Option<Location>>,
    generation: Cell<u64>,
    /// Where the next home works, from the open dialog or `session.new` (TS `HomeRoute.location`).
    home: RefCell<Option<Location>>,
    /// The mounted home's own location (TS `route.location`), `None` for the default.
    target: RefCell<Option<Location>>,
    /// The default location the home follows, `None` while it works where [`navigate_home`] sent it.
    followed: RefCell<Option<Location>>,
    /// The session whose environment was uploaded on this connection.
    uploaded: RefCell<Option<SessionID>>,
}

/// The location as set, before the server answered (`location.ref`).
pub fn current(tui: &Tui) -> Option<Location> {
    tui.location.reference.borrow().clone()
}

/// `location.ref ?? data.location.default()`.
pub fn active(tui: &Tui) -> Location {
    current(tui).unwrap_or_else(|| tui.data.read(|state| state.default_location().clone()))
}

/// The home route's location: `route.location ?? data.location.default()`.
pub fn home_target(tui: &Tui) -> Location {
    let target = tui.location.target.borrow().clone();
    target.unwrap_or_else(|| tui.data.read(|state| state.default_location().clone()))
}

/// Whether [`navigate_home`] asked for a home that has not mounted yet. Home to home still applies it.
pub(crate) fn pending(tui: &Tui) -> bool {
    tui.location.home.borrow().is_some()
}

/// The location whose directory the server reported missing (`location.error.location`).
pub fn error(tui: &Tui) -> Option<Location> {
    tui.location.error.borrow().clone()
}

/// Goes home to work in `location` (the default location for `None`).
pub fn navigate_home(tui: &Tui, location: Option<Location>) {
    *tui.location.home.borrow_mut() = location;
    tui.navigate(Route::Home);
}

/// The home route's location: the one [`navigate_home`] passed, else the default.
pub fn home(tui: &Tui) {
    let explicit = tui.location.home.borrow_mut().take();
    let default = tui.data.read(|state| state.default_location().clone());
    *tui.location.target.borrow_mut() = explicit.clone();
    *tui.location.followed.borrow_mut() = explicit.is_none().then(|| default.clone());
    set(tui, explicit.unwrap_or(default));
}

/// A home without a location of its own moves with the default, as a read adopts the server's directory
/// (`home.tsx`'s effect). A `/cd` holds until the default changes.
pub fn follow_default(tui: &Tui) {
    let default = tui.data.read(|state| state.default_location().clone());
    let mut followed = tui.location.followed.borrow_mut();
    if followed.as_ref().is_none_or(|followed| *followed == default) {
        return;
    }
    *followed = Some(default.clone());
    drop(followed);
    set(tui, default);
}

/// The session route's location, once the session is known; and its environment upload.
pub fn session(tui: &Tui, id: &SessionID) {
    let Some((location, creating)) = tui
        .data
        .read(|state| state.session(id).map(|session| (Location::from(&session.location), state.is_creating(id))))
    else {
        return;
    };
    if current(tui).as_ref() != Some(&location) {
        set(tui, location);
    }
    if !creating && connected(tui) {
        upload_environment(tui, id);
    }
}

/// `server.connected`: reads the location again.
pub(crate) fn reconnected(tui: &Tui) {
    sync(tui, current(tui));
    if let Route::Session { id } = tui.route() {
        session(tui, &id);
    }
}

/// The status turned connected: uploads the open session's environment again. TS runs the upload as an
/// effect of the connection status (`app.tsx:529-539`), which turns connected after `server.connected`.
pub(crate) fn connected_again(tui: &Tui) {
    tui.location.uploaded.borrow_mut().take();
    if let Route::Session { id } = tui.route() {
        session(tui, &id);
    }
}

/// `location.set`.
pub(crate) fn set(tui: &Tui, location: Location) {
    *tui.location.reference.borrow_mut() = Some(location.clone());
    tui.local.sync(&opencode_store::Changes::default());
    crate::client_mcp::sync(tui);
    if connected(tui) {
        sync(tui, Some(location));
    }
}

fn connected(tui: &Tui) -> bool {
    crate::features::overlays::connected(tui)
}

/// Reads the location, retrying anything but the server's "location not found".
fn sync(tui: &Tui, location: Option<Location>) {
    let Some(location) = location else { return };
    let attempt = tui.location.generation.get() + 1;
    tui.location.generation.set(attempt);
    let target = tui.data.read(|state| (*state.default_location() != location).then(|| location.clone()));
    tui.location.error.borrow_mut().take();
    let data = tui.data.clone();
    tui.app.spawn(
        async move {
            let mut tries = 0;
            loop {
                // The TUI's `location.sync` also reads the config (`context/data.tsx`).
                let read = async {
                    data.location_sync_info(target.as_ref()).await?;
                    let config = data.catalog_sync(Catalog::Config, target.as_ref());
                    let (sync, config) = futures_util::future::join(data.location_sync(target.as_ref()), config).await;
                    sync.and(config)
                };
                match read.await {
                    Ok(()) => return Ok(()),
                    Err(error) if tries + 1 < ATTEMPTS && !not_found(&error) => {
                        tokio::time::sleep(DELAY * 2u32.pow(tries)).await;
                        tries += 1;
                    }
                    Err(error) => return Err(error),
                }
            }
        },
        bind!(tui, |tui, _, result: Result<(), Error>| {
            let Err(error) = result else { return };
            let current = tui.location.reference.borrow().clone();
            if !not_found(&error) || tui.location.generation.get() != attempt || current.as_ref() != Some(&location) {
                return;
            }
            *tui.location.error.borrow_mut() = Some(location);
            tui.resync();
        }),
    );
}

fn not_found(error: &Error) -> bool {
    error.declared().is_some_and(|declared| declared.tag.as_deref() == Some("LocationNotFoundError"))
}

/// `session.environment` with the terminal's variables, once per session and connection.
fn upload_environment(tui: &Tui, id: &SessionID) {
    let Some(variables) = tui.startup.args.environment.clone() else { return };
    if tui.location.uploaded.borrow().as_ref() == Some(id) {
        return;
    }
    *tui.location.uploaded.borrow_mut() = Some(id.clone());
    let client = tui.data.client().clone();
    let id = id.clone();
    tui.request(async move { opencode_store::environment::upload(&client, &id, variables).await }, |_, ()| {});
}
