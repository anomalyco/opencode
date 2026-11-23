//! Track the location of home or the open session. On reconnect, refresh it and upload the terminal environment only to
//! a local server.

use opencode_store::location::Catalog;
use opencode_store::{Error, Location};

use crate::prelude::*;

const ATTEMPTS: u32 = 3;
const DELAY: Duration = Duration::from_millis(500);

#[derive(Default)]
pub struct LocationState {
    pub(crate) reference: RefCell<Option<Location>>,
    error: RefCell<Option<Location>>,
    generation: Cell<u64>,
    home: RefCell<Option<Location>>,
    target: RefCell<Option<Location>>,
    /// The default location the home follows, `None` while it works where [`navigate_home`] sent it.
    followed: RefCell<Option<Location>>,
    uploaded: RefCell<Option<SessionID>>,
}

/// The location as set, before the server answered (`location.ref`).
pub fn current(tui: &Tui) -> Option<Location> {
    tui.location.reference.borrow().clone()
}

pub fn active(tui: &Tui) -> Location {
    current(tui).unwrap_or_else(|| tui.data.read(|state| state.default_location().clone()))
}

pub fn home_target(tui: &Tui) -> Location {
    let target = tui.location.target.borrow().clone();
    target.unwrap_or_else(|| tui.data.read(|state| state.default_location().clone()))
}

pub(crate) fn pending(tui: &Tui) -> bool {
    tui.location.home.borrow().is_some()
}

pub fn error(tui: &Tui) -> Option<Location> {
    tui.location.error.borrow().clone()
}

pub fn navigate_home(tui: &Tui, location: Option<Location>) {
    *tui.location.home.borrow_mut() = location;
    tui.navigate(Route::Home);
}

pub fn home(tui: &Tui) {
    let explicit = tui.location.home.borrow_mut().take();
    let default = tui.data.read(|state| state.default_location().clone());
    *tui.location.target.borrow_mut() = explicit.clone();
    *tui.location.followed.borrow_mut() = explicit.is_none().then(|| default.clone());
    set(tui, explicit.unwrap_or(default));
}

/// A home without its own location follows the default. A `/cd` selection lasts until the default changes.
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

pub(crate) fn reconnected(tui: &Tui) {
    sync(tui, current(tui));
    if let Route::Session { id } = &*tui.route() {
        session(tui, id);
    }
}

/// Upload the open session's environment when its connection becomes ready.
pub(crate) fn connected_again(tui: &Tui) {
    tui.location.uploaded.borrow_mut().take();
    if let Route::Session { id } = &*tui.route() {
        session(tui, id);
    }
}

pub(crate) fn set(tui: &Tui, location: Location) {
    *tui.location.reference.borrow_mut() = Some(location.clone());
    tui.local.sync(&opencode_store::Changes::nothing(&tui.data));
    crate::client_mcp::sync(tui);
    if connected(tui) {
        sync(tui, Some(location));
    }
}

fn connected(tui: &Tui) -> bool {
    crate::features::overlays::connected(tui)
}

fn sync(tui: &Tui, location: Option<Location>) {
    let Some(location) = location else { return };
    let attempt = tui.location.generation.get() + 1;
    tui.location.generation.set(attempt);
    let target = tui.data.read(|state| (*state.default_location() != location).then(|| location.clone()));
    tui.location.error.borrow_mut().take();
    let remote = tui.data.remote();
    // The first try's read begins now; a retry's, on this thread once its delay ends.
    let mut first = Some(tui.data.location_sync_info(target.as_ref()));
    tui.app.spawn(
        async move {
            let mut tries = 0;
            loop {
                let read = async {
                    let info = match first.take() {
                        Some(info) => info,
                        None => {
                            let target = target.clone();
                            remote.call(move |data| data.location_sync_info(target.as_ref())).await?
                        }
                    };
                    info.await?;
                    let target = target.clone();
                    let (sync, config) = remote
                        .call(move |data| {
                            let config = data.catalog_sync(Catalog::Config, target.as_ref());
                            (data.location_sync(target.as_ref()), config)
                        })
                        .await?;
                    let (sync, config) = futures_util::future::join(sync, config).await;
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
