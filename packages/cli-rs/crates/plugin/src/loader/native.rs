//! The native backend (decision O-42): plugins are shared libraries on the C ABI of `opencode-plugin-abi`,
//! loaded with `opencode_util::dl`. There is no sandbox; it is the user's machine. The host only keeps a plugin's
//! panics out of the TUI:
//!
//! - the plugin's shims catch its panics, and the host's callbacks catch the host's, so no panic unwinds across
//!   the boundary (a crash such as a segfault still takes the process down);
//! - a panic fails the plugin: it is not called again, its fences fall back to the code view, its slots and routes
//!   draw empty, the plugin manager lists it as `failed` with the message, and a toast says so. Enabling it again
//!   in the plugin manager starts a fresh instance. Nothing the call that panicked asked for happens, and the storage
//!   it wrote gets back what it held, as for a built-in;
//! - host effects (toasts, attention, routes, dispatches, storage notifications) wait until the plugin returns, on the
//!   effect queue in-process plugins share, so it never reenters itself through the host.
//!
//! An instance lives while its plugin is active: deactivation, unload and reload destroy it at once, whatever still
//! holds a claim, route or fence of it, which then draw nothing.
//!
//! Every call into a plugin runs on the UI thread. A plugin that works on its own thread calls `wake` (ABI 1.3),
//! which posts through the app's proxy; the host then asks that plugin's mounted claims for their rows again. A wake
//! that finds the proxy's queue full is delivered once it has room, so the last one is never lost.
//!
//! Versions follow the ABI's rules: only a major mismatch, a too-short table, or a plugin that requires a newer
//! host minor version is refused. Entries past the plugin's table size are absent.
//!
//! Each build is copied to a file of its own before it is opened, because the platform loader returns the
//! library already open at a path, and a rebuilt library is often written over the old one. Libraries are never
//! unloaded: a running plugin's code must outlive every pointer into it, and a reload leaks one library.

#![allow(unsafe_code)]

use std::cell::{Cell, RefCell};
use std::ffi::c_void;
use std::mem::{offset_of, size_of};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::rc::{Rc, Weak};
use std::sync::Arc;

use opencode_plugin_abi::{
    self as abi, ABI_MAJOR, ABI_MINOR, Bytes, Fenced, HostApi, HostRequest, Line, Manifest, Owned, PluginApi,
    PluginApiV1_0, Request,
};
use opencode_ui::keymap::{KeymapLayer, TuiCommand};
use opencode_util::dl;
use opentui::keymap::Disposer;
use opentui::prelude::*;
use serde::de::DeserializeOwned;

use super::Backend;
use crate::activation::{Activation, Drawn, Wake};
use crate::node::{Fences, MountFn, Scroll, SlotRender, lines_widget, theme_color};
use crate::slot::placement;
use crate::{Claimed, Definition, ErrorFn, Host, Setup, Undo, defer, fail, next_request, route, tui_command};

/// The host's minor version: it serves every entry and request up to it.
pub const HOST_MINOR: u32 = ABI_MINOR;

/// Loads native plugins.
#[derive(Clone, Copy, Debug, Default)]
pub struct Native;

/// What a library reports about itself before it is set up.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Inspected {
    pub major: u32,
    pub minor: u32,
    /// The plugin's version from `describe` (ABI 1.1), when its table has it.
    pub version: Option<String>,
}

impl Native {
    /// Opens `library` and checks its version without setting it up.
    pub fn inspect(&self, library: &[u8]) -> Result<Inspected, String> {
        let library = Library::open(library, HOST_MINOR)?;
        Ok(Inspected { major: ABI_MAJOR, minor: library.minor, version: library.metadata().version })
    }
}

impl Backend for Native {
    fn load(
        &self,
        host: &Rc<dyn Host>,
        library: &[u8],
        options: Option<&str>,
    ) -> Result<(Definition, ErrorFn), String> {
        define(host, Library::open(library, HOST_MINOR)?, options)
    }
}

/// The definition of the plugin `library` holds; setup runs on each activation.
fn define(host: &Rc<dyn Host>, library: Library, options: Option<&str>) -> Result<(Definition, ErrorFn), String> {
    let library = Rc::new(library);
    let metadata = library.metadata();
    if let Some(version) = &metadata.version {
        log::info!("plugin library version {version}, ABI {ABI_MAJOR}.{}", library.minor);
    }
    let options = options.map(str::to_owned);
    // Setup runs on each activation only, so a disabled plugin starts nothing. A plugin without `describe`
    // (ABI 1.0) tells its ID only from setup, so for it setup runs once now, and that instance is destroyed.
    let id = match metadata.id {
        Some(id) => id,
        // That instance only tells the ID: nothing it asks for happens.
        None => Instance::create(&library, Rc::downgrade(host), "", options.as_deref(), true)?.1.id,
    };
    // The failure of the running instance, a panic, in a cell of each activation's own: a new activation leaves an old
    // one's failure as it was.
    let current: Rc<RefCell<Rc<RefCell<Option<String>>>>> = Rc::default();
    let definition = Definition::fallible(id, {
        let current = current.clone();
        move |setup: &mut Setup<'_>| {
            let host = Rc::downgrade(setup.host());
            let (instance, manifest) = Instance::create(&library, host.clone(), setup.id(), options.as_deref(), false)?;
            if manifest.id != setup.id() {
                return Err(format!("setup returned plugin ID {}, not {}", manifest.id, setup.id()));
            }
            let failure: Rc<RefCell<Option<String>>> = Rc::default();
            *current.borrow_mut() = failure.clone();
            let failed = failure.clone();
            setup.failure(Rc::new(move || failed.borrow().clone()));
            let activation = Activation::new(setup.host(), instance.shared.wake.clone());
            let guest = Rc::new(Guest {
                instance: RefCell::new(Some(instance)),
                busy: Cell::new(false),
                failure,
                host,
                id: setup.id().to_owned(),
                generation: setup.generation(),
                layer: RefCell::new(None),
                activation,
            });
            if manifest.wake {
                let woken = Rc::downgrade(&guest);
                guest.activation.on_wake(Rc::new(move || {
                    if let Some(guest) = woken.upgrade() {
                        guest.handle("on-wake", &Request::Wake);
                    }
                }));
            }
            register(setup, &guest, &manifest);
            // What setup asked for (toasts, routes) happens now that the plugin is active.
            guest.apply(guest.taken().0);
            Ok(())
        }
    });
    let error: ErrorFn = Rc::new(move || current.borrow().borrow().clone());
    Ok((definition, error))
}

/// An open library's entries. The library stays loaded for the life of the process.
struct Library {
    minor: u32,
    create: unsafe extern "C" fn(*const HostApi, Bytes, *mut *mut c_void, *mut Owned) -> i32,
    call: unsafe extern "C" fn(*mut c_void, Bytes, *mut Owned) -> i32,
    destroy: Option<unsafe extern "C" fn(*mut c_void)>,
    free: unsafe extern "C" fn(Owned),
    describe: Option<unsafe extern "C" fn(*mut Owned) -> i32>,
}

impl Library {
    /// Opens a library for a host of minor version `host_minor`.
    fn open(bytes: &[u8], host_minor: u32) -> Result<Self, String> {
        // A directory this process creates, owner-only, so nobody else can place or swap the file it opens.
        let dir =
            opencode_util::temp::tempdir().map_err(|error| format!("{}: {error}", std::env::temp_dir().display()))?;
        let file = dir.path().join(format!("plugin.{}", std::env::consts::DLL_EXTENSION));
        std::fs::write(&file, bytes).map_err(|error| format!("{}: {error}", file.display()))?;
        // SAFETY: loading runs the library's initializers; a plugin is code the user chose to run.
        let library = unsafe { dl::Library::open(&file) };
        // The mapping stays after the directory is gone (where the platform allows removing it).
        drop(dir);
        let library = library.map_err(|error| format!("cannot load the library: {error}"))?;
        // SAFETY: `ENTRY` has type `EntryFn` in every plugin of this major version.
        let entry = unsafe { library.symbol::<abi::EntryFn>(abi::ENTRY) }
            .map_err(|_| format!("not an opencode-native plugin: no `{}` symbol", abi::ENTRY))?;
        // SAFETY: as above; the table it returns lives as long as the library.
        let opened = Self::from_table(unsafe { entry() }, host_minor)?;
        library.leak();
        Ok(opened)
    }

    /// Checks the table `api` points to and takes its entries. Nothing past the `size` it declares is read.
    fn from_table(api: *const PluginApi, host_minor: u32) -> Result<Self, String> {
        if api.is_null() {
            return Err(format!("`{}` returned no table", abi::ENTRY));
        }
        if !api.is_aligned() {
            return Err("plugin table is not aligned".to_owned());
        }
        // SAFETY: every table of any version starts with `size`, and `api` is aligned and non-null.
        let size = unsafe { std::ptr::addr_of!((*api).size).read() };
        if size < offset_of!(PluginApiV1_0, requires_minor) {
            return Err(format!("plugin table is {size} bytes, shorter than its version header"));
        }
        // SAFETY: `size` covers `major` and `minor`.
        let (major, minor) =
            unsafe { (std::ptr::addr_of!((*api).major).read(), std::ptr::addr_of!((*api).minor).read()) };
        if major != ABI_MAJOR {
            return Err(format!(
                "plugin ABI {major}.{minor} is not supported: this opencode-native loads ABI {ABI_MAJOR}.x plugins \
                 (up to {ABI_MAJOR}.{host_minor}); rebuild the plugin against opencode-plugin-abi {ABI_MAJOR}"
            ));
        }
        if size < size_of::<PluginApiV1_0>() {
            return Err(format!("plugin table is {size} bytes, shorter than the ABI {ABI_MAJOR}.0 core"));
        }
        // SAFETY: the 1.0 core is within `size`; its callbacks are nullable.
        let core = unsafe { &*api.cast::<PluginApiV1_0>() };
        if core.requires_minor > host_minor {
            return Err(format!(
                "plugin needs host ABI {ABI_MAJOR}.{} or newer, this opencode-native has {ABI_MAJOR}.{host_minor}; \
                 update opencode-native",
                core.requires_minor
            ));
        }
        let required = |name: &str| format!("plugin table has a null `{name}` callback");
        let create = core.create.ok_or_else(|| required("create"))?;
        let call = core.call.ok_or_else(|| required("call"))?;
        let free = core.free.ok_or_else(|| required("free"))?;
        let describe = has::<Option<unsafe extern "C" fn(*mut Owned) -> i32>>(size, offset_of!(PluginApi, describe))
            // SAFETY: `size` covers the entry.
            .then(|| unsafe { std::ptr::addr_of!((*api).describe).read() })
            .flatten();
        Ok(Self { minor, create, call, destroy: core.destroy, free, describe })
    }

    /// What the plugin says about itself, when it has `describe` (1.1).
    fn metadata(&self) -> abi::Metadata {
        let Some(describe) = self.describe else { return abi::Metadata::default() };
        let mut out = Owned::EMPTY;
        // SAFETY: `describe` writes `out`, which `free` takes back.
        let (status, bytes) = unsafe {
            let status = describe(&mut out);
            let bytes = out.to_vec();
            (self.free)(out);
            (status, bytes)
        };
        (status == abi::OK).then(|| serde_json::from_slice(&bytes).ok()).flatten().unwrap_or_default()
    }
}

/// Whether a table of `size` bytes holds an entry of type `T` at `offset`.
fn has<T>(size: usize, offset: usize) -> bool {
    size >= offset + size_of::<T>()
}

/// What the host's callbacks see: the plugin's identity, its storage keys, and what the running call asked for:
/// effects that wait for it to return, and the storage it wrote, which a panic puts back.
struct Ctx {
    host: Weak<dyn Host>,
    id: String,
    keys: Vec<String>,
    effects: Vec<Effect>,
    undo: Undo,
    /// What it asks for is dropped.
    quiet: bool,
    /// The running call is a render, which reads and asks for no effect.
    read_only: bool,
}

/// What [`HostApi::ctx`] points to: the context of the UI thread's callbacks, and what `wake` reads from any thread.
struct Shared {
    ctx: RefCell<Ctx>,
    wake: Arc<Wake>,
    /// The thread that created the instance, the only one `call` and `theme_mode` serve. Written before the plugin has
    /// the table and never after, so any thread may read it.
    ui: std::thread::ThreadId,
}

/// Whether the caller of a host callback with `ctx`, a `Shared` or null, runs on the instance's UI thread. Nothing of
/// `Shared` but `ui` is read before that holds: its `RefCell` and the host's `Rc` are the UI thread's alone.
///
/// # Safety
/// `ctx` is null or the `Shared` of a live instance.
unsafe fn on_ui_thread(ctx: *mut c_void) -> bool {
    // SAFETY: as documented; `ui` is immutable.
    !ctx.is_null() && unsafe { std::ptr::addr_of!((*ctx.cast::<Shared>()).ui).read() } == std::thread::current().id()
}

enum Effect {
    Toast(abi::Toast),
    Route(String),
    Dispatch(String, Option<String>),
    Attention(abi::Attention),
    /// A storage write, which the host already shows to reads, for the claims to hear of.
    Stored,
    Navigate(abi::Route),
    Fetch(abi::RequestId, abi::Fetch),
    Dialog(abi::Dialog),
    Copy(String, Option<abi::Action>),
    Composer(abi::ComposerEdit),
    // 1.6
    Variant(Option<String>),
    Model(String, String),
    Tab(abi::TabEdit),
    ClearSelection,
    Foreground(abi::RequestId, abi::Foreground),
    Title(String),
    Theme(String),
    InstallTheme(String, serde_json::Value),
}

/// One plugin instance; dropping it destroys the instance in the plugin.
struct Instance {
    library: Rc<Library>,
    handle: *mut c_void,
    // The plugin keeps pointers to these until `destroy`, so they are boxed and dropped after it.
    _api: Box<HostApi>,
    shared: Box<Shared>,
}

impl Instance {
    /// Runs setup. `id` is the plugin's ID, or empty while it is not known, so setup may use storage. What a `quiet`
    /// instance asks for is dropped.
    fn create(
        library: &Rc<Library>,
        host: Weak<dyn Host>,
        id: &str,
        options: Option<&str>,
        quiet: bool,
    ) -> Result<(Self, Manifest), String> {
        let wake = Arc::new(Wake::new(host.upgrade().map(|host| host.app().proxy())));
        let ctx = RefCell::new(Ctx {
            host,
            id: id.to_owned(),
            keys: Vec::new(),
            effects: Vec::new(),
            undo: Undo::default(),
            quiet,
            read_only: false,
        });
        let shared = Box::new(Shared { ctx, wake, ui: std::thread::current().id() });
        let api = Box::new(HostApi {
            size: size_of::<HostApi>(),
            major: ABI_MAJOR,
            minor: HOST_MINOR,
            ctx: std::ptr::from_ref::<Shared>(&shared).cast_mut().cast(),
            call: Some(host_call),
            free: Some(host_free),
            theme_mode: Some(host_theme_mode),
            wake: Some(host_wake),
        });
        let mut handle = std::ptr::null_mut();
        let mut out = Owned::EMPTY;
        let options = options.unwrap_or_default();
        // SAFETY: the pointers are valid for the call, and `api` and `ctx` outlive the instance.
        let (status, bytes) = unsafe {
            let status = (library.create)(&*api, Bytes::new(options.as_bytes()), &mut handle, &mut out);
            let bytes = out.to_vec();
            (library.free)(out);
            (status, bytes)
        };
        let text = || String::from_utf8_lossy(&bytes).into_owned();
        match status {
            abi::OK => {}
            // Nothing a setup that panicked asked for happens, nor what its disposal did within the call.
            abi::PANIC => {
                shared.undo();
                return Err(format!("setup panicked: {}", text()));
            }
            // What the failed setup and its disposal asked for still happens; its fetches reach no activation.
            _ => {
                shared.drain();
                return Err(text());
            }
        }
        let instance = Self { library: library.clone(), handle, _api: api, shared };
        let manifest: Manifest =
            serde_json::from_slice(&bytes).map_err(|error| format!("setup returned a bad manifest: {error}"))?;
        if manifest.id.is_empty() {
            return Err("setup returned an empty plugin ID".to_owned());
        }
        {
            let mut ctx = instance.shared.ctx.borrow_mut();
            ctx.id = manifest.id.clone();
            ctx.keys = manifest.storage.clone();
        }
        Ok((instance, manifest))
    }

    /// Sends `request`; a panic is `Err(Some(message))`, an error the plugin returned `Err(None)` after logging.
    fn call(&self, request: &Request) -> Result<serde_json::Value, Option<String>> {
        let json = serde_json::to_vec(request).map_err(|error| Some(error.to_string()))?;
        let mut out = Owned::EMPTY;
        // SAFETY: `handle` is live until drop; `out` goes back to the library's `free`.
        let (status, bytes) = unsafe {
            let status = (self.library.call)(self.handle, Bytes::new(&json), &mut out);
            let bytes = out.to_vec();
            (self.library.free)(out);
            (status, bytes)
        };
        let text = String::from_utf8_lossy(&bytes);
        match status {
            abi::OK => serde_json::from_slice(&bytes).map_err(|error| Some(error.to_string())),
            abi::PANIC => Err(Some(format!("panicked: {text}"))),
            _ => {
                log::warn!("plugin {}: {text}", self.shared.ctx.borrow().id);
                Err(None)
            }
        }
    }
}

impl Drop for Instance {
    fn drop(&mut self) {
        if let Some(destroy) = self.library.destroy {
            // SAFETY: `handle` came from `create` and is destroyed once; the plugin catches its own panics.
            unsafe { destroy(self.handle) };
        }
        // What its dispose callbacks asked for still happens, as in process; their fetches reach no activation.
        self.shared.drain();
    }
}

impl Shared {
    /// Queues the effects asked for so far, without an activation.
    fn drain(&self) {
        let mut ctx = self.ctx.borrow_mut();
        let (effects, _) = ctx.take();
        if !ctx.quiet {
            apply(&ctx.host, ctx.id.clone(), Weak::new(), None, effects);
        }
    }

    /// Drops the effects asked for so far, and puts back the storage written.
    fn undo(&self) {
        let (_, undo) = self.ctx.borrow_mut().take();
        if let Some(host) = self.ctx.borrow().host.upgrade() {
            undo.restore(&*host);
        }
    }
}

impl Ctx {
    /// What the calls asked for since it was last taken.
    fn take(&mut self) -> (Vec<Effect>, Undo) {
        (std::mem::take(&mut self.effects), std::mem::take(&mut self.undo))
    }
}

/// The host's side of [`HostApi::call`]. Catches the host's panics.
unsafe extern "C" fn host_call(ctx: *mut c_void, request: Bytes, out: *mut Owned) -> i32 {
    if out.is_null() {
        return abi::ERROR;
    }
    // SAFETY: `ctx` is the `Shared` this instance was created with, or null.
    if !ctx.is_null() && !unsafe { on_ui_thread(ctx) } {
        let error = "a host request must come from the UI thread; another thread may only call HostApi::wake";
        // SAFETY: `out` is valid for writes during the call.
        unsafe { *out = Owned::from_vec(error.as_bytes().to_vec()) };
        return abi::ERROR;
    }
    // SAFETY: `ctx` is the `Shared` this instance was created with, or null; `request` is valid for the call.
    let (ctx, request) = unsafe { (ctx.cast::<Shared>().as_ref().map(|shared| &shared.ctx), request.as_slice()) };
    let result = catch_unwind(AssertUnwindSafe(|| {
        let ctx = ctx.ok_or("no host context")?;
        let request: HostRequest = serde_json::from_slice(request)
            .map_err(|error| format!("unsupported host request (host ABI {ABI_MAJOR}.{HOST_MINOR}): {error}"))?;
        let mut ctx = ctx.try_borrow_mut().map_err(|_| "the host is busy".to_owned())?;
        handle(&mut ctx, request)
    }));
    let (status, bytes) = match result {
        Ok(Ok(value)) => (abi::OK, serde_json::to_vec(&value).unwrap_or_default()),
        Ok(Err(error)) => (abi::ERROR, error.into_bytes()),
        Err(panic) => (abi::PANIC, abi::panic_message(&*panic).into_bytes()),
    };
    // SAFETY: `out` is valid for writes during the call.
    unsafe { *out = Owned::from_vec(bytes) };
    status
}

/// The host's side of [`HostApi::theme_mode`]. A host that is gone or panics answers dark.
unsafe extern "C" fn host_theme_mode(ctx: *mut c_void) -> u32 {
    // SAFETY: `ctx` is the `Shared` this instance was created with, or null. Another thread gets dark, as from a host
    // that is gone.
    if !unsafe { on_ui_thread(ctx) } {
        return abi::THEME_DARK;
    }
    // SAFETY: `ctx` is the `Shared` this instance was created with, or null.
    let ctx = unsafe { ctx.cast::<Shared>().as_ref().map(|shared| &shared.ctx) };
    let host = ctx.and_then(|ctx| ctx.try_borrow().ok()).and_then(|ctx| ctx.host.upgrade());
    let light = catch_unwind(AssertUnwindSafe(|| host.is_some_and(|host| host.theme_mode() == ThemeMode::Light)));
    if light.unwrap_or(false) { abi::THEME_LIGHT } else { abi::THEME_DARK }
}

/// The host's side of [`HostApi::wake`], on any thread: posts one [`Woken`] until the UI thread handles it.
unsafe extern "C" fn host_wake(ctx: *mut c_void) {
    if ctx.is_null() {
        return;
    }
    // SAFETY: `ctx` is this instance's `Shared`, which lives until `destroy` returns. Only `wake`, which is
    // `Sync`, is read off the UI thread.
    let wake = unsafe { &*std::ptr::addr_of!((*ctx.cast::<Shared>()).wake) };
    wake.post();
}

unsafe extern "C" fn host_free(owned: Owned) {
    // SAFETY: the host made `owned` with `Owned::from_vec`.
    drop(unsafe { owned.into_vec() });
}

fn handle(ctx: &mut Ctx, request: HostRequest) -> Result<serde_json::Value, String> {
    let key = |ctx: &Ctx, key: &str| {
        if ctx.id.is_empty() {
            return Err("the plugin ID is not known during setup".to_owned());
        }
        ctx.keys
            .iter()
            .any(|known| known == key)
            .then(|| format!("plugin.{}.{key}", ctx.id))
            .ok_or_else(|| format!("storage key {key} was not declared"))
    };
    if ctx.read_only && effect(&request) {
        return Err("a render reads the host and asks for no effect".to_owned());
    }
    match request {
        HostRequest::Log { level, message } => {
            let level = match level {
                abi::Level::Debug => log::Level::Debug,
                abi::Level::Info => log::Level::Info,
                abi::Level::Warn => log::Level::Warn,
                abi::Level::Error => log::Level::Error,
            };
            log::log!(level, "plugin {}: {message}", ctx.id);
        }
        HostRequest::Toast { variant, message, title, session } => {
            ctx.effects.push(Effect::Toast(abi::Toast { variant, title, message, session }));
        }
        // An instance that only tells its ID changes nothing, also as it is destroyed.
        HostRequest::StorageSet { .. } | HostRequest::StorageMerge { .. } if ctx.quiet => {}
        HostRequest::StorageGet { key: name } => {
            let stored = key(ctx, &name)?;
            let value = ctx.host.upgrade().and_then(|host| host.storage_read(&stored));
            return Ok(serde_json::to_value(value).unwrap_or_default());
        }
        HostRequest::StorageSet { key: name, value } => {
            let stored = key(ctx, &name)?;
            let host = ctx.host.upgrade().ok_or("the host is gone")?;
            ctx.undo.record(&*host, &stored);
            host.storage_write(&stored, &value)?;
            ctx.effects.push(Effect::Stored);
        }
        HostRequest::StorageMerge { key: name, fields } => {
            let stored = key(ctx, &name)?;
            let host = ctx.host.upgrade().ok_or("the host is gone")?;
            ctx.undo.record(&*host, &stored);
            host.storage_merge(&stored, fields)?;
            ctx.effects.push(Effect::Stored);
        }
        HostRequest::OpenRoute { name } => ctx.effects.push(Effect::Route(name)),
        HostRequest::Color { token } => {
            let color = ctx.host.upgrade().and_then(|host| theme_color(&host.theme(), &token));
            return Ok(serde_json::to_value(color).unwrap_or_default());
        }
        HostRequest::StorageKey { key } => {
            if !ctx.keys.contains(&key) {
                ctx.keys.push(key);
            }
        }
        HostRequest::Session { id } => return read(ctx, |read| serde_json::to_value(read.session(&id))),
        HostRequest::Family { id } => return read(ctx, |read| serde_json::to_value(read.family(&id))),
        HostRequest::Messages { id } => {
            return read(ctx, |read| {
                let mut value = Ok(serde_json::Value::Null);
                read.messages(&id, &mut |messages| value = serde_json::to_value(messages));
                value
            });
        }
        HostRequest::Models { location } => {
            return read(ctx, |read| serde_json::to_value(read.models(location.as_ref())));
        }
        HostRequest::Model => return read(ctx, |read| serde_json::to_value(read.model())),
        HostRequest::Limits => return read(ctx, |read| serde_json::to_value(read.limits())),
        HostRequest::Providers => return read(ctx, |read| serde_json::to_value(read.providers())),
        HostRequest::Info => return read(ctx, |read| serde_json::to_value(read.info())),
        HostRequest::McpServers { location } => {
            return read(ctx, |read| serde_json::to_value(read.mcp_servers(location.as_ref())));
        }
        HostRequest::Integrations { location } => {
            return read(ctx, |read| serde_json::to_value(read.integrations(location.as_ref())));
        }
        HostRequest::Vcs { location } => return read(ctx, |read| serde_json::to_value(read.vcs(location.as_ref()))),
        HostRequest::Route => return read(ctx, |read| serde_json::to_value(read.route())),
        HostRequest::Dispatch { name, input } => ctx.effects.push(Effect::Dispatch(name, input)),
        HostRequest::Attention(attention) => ctx.effects.push(Effect::Attention(attention)),
        HostRequest::Navigate { route } => ctx.effects.push(Effect::Navigate(route)),
        HostRequest::Fetch(fetch) => {
            let id = next_request();
            ctx.effects.push(Effect::Fetch(id, fetch));
            return Ok(serde_json::to_value(id).unwrap_or_default());
        }
        HostRequest::Dialog { dialog } => ctx.effects.push(Effect::Dialog(dialog)),
        HostRequest::Copy { text, then } => ctx.effects.push(Effect::Copy(text, then)),
        HostRequest::Interactive => return read(ctx, |read| serde_json::to_value(read.interactive())),
        HostRequest::Shortcut { name } => return read(ctx, |read| serde_json::to_value(read.shortcut(&name))),
        HostRequest::DialogOpen { key } => {
            let open = ctx.host.upgrade().is_some_and(|host| host.dialog_open(&ctx.id, &key));
            return Ok(serde_json::Value::Bool(open));
        }
        HostRequest::Composer => return read(ctx, |read| serde_json::to_value(read.composer())),
        HostRequest::ComposerEdit { edit } => ctx.effects.push(Effect::Composer(edit)),
        HostRequest::Checkpoint => return Ok(crate::mark(ctx.effects.len(), ctx.undo.len()).into()),
        HostRequest::Rollback { mark } => {
            let (effects, writes) = crate::marked(mark);
            ctx.effects.truncate(effects);
            let host = ctx.host.upgrade().ok_or("the host is gone")?;
            ctx.undo.restore_after(&*host, writes);
        }
        HostRequest::Variants => return read(ctx, |read| serde_json::to_value(read.variants())),
        HostRequest::SetVariant { variant } => {
            let known = read(ctx, |read| Ok(serde_json::Value::Bool(crate::variant_known(read, variant.as_deref()))))?;
            if known == serde_json::Value::Bool(true) {
                ctx.effects.push(Effect::Variant(variant));
            }
            return Ok(known);
        }
        HostRequest::SetModel { provider, model } => ctx.effects.push(Effect::Model(provider, model)),
        HostRequest::TabsEnabled => return read(ctx, |read| serde_json::to_value(read.tabs_enabled())),
        HostRequest::Tabs => return read(ctx, |read| serde_json::to_value(read.tabs())),
        HostRequest::Tab { edit } => {
            let allowed = ctx.host.upgrade().is_some_and(|host| host.tab_allowed(&edit));
            if allowed {
                ctx.effects.push(Effect::Tab(edit));
            }
            return Ok(serde_json::Value::Bool(allowed));
        }
        HostRequest::KeymapPending => return read(ctx, |read| serde_json::to_value(read.keymap_pending())),
        HostRequest::KeymapActive => return read(ctx, |read| serde_json::to_value(read.keymap_active())),
        HostRequest::KeymapCommands => return read(ctx, |read| serde_json::to_value(read.keymap_commands())),
        HostRequest::Shortcuts { name } => return read(ctx, |read| serde_json::to_value(read.shortcuts(&name))),
        HostRequest::Selection => return read(ctx, |read| serde_json::to_value(read.selection())),
        HostRequest::ClearSelection => ctx.effects.push(Effect::ClearSelection),
        HostRequest::Foreground(program) => {
            let id = next_request();
            ctx.effects.push(Effect::Foreground(id, program));
            return Ok(serde_json::to_value(id).unwrap_or_default());
        }
        HostRequest::Title { title } => ctx.effects.push(Effect::Title(title)),
        HostRequest::Theme => return read(ctx, |read| serde_json::to_value(read.theme())),
        HostRequest::Themes => return read(ctx, |read| serde_json::to_value(read.themes())),
        HostRequest::SetTheme { name } => {
            let known = read(ctx, |read| Ok(serde_json::Value::Bool(crate::theme_known(read, &name))))?;
            if known == serde_json::Value::Bool(true) {
                ctx.effects.push(Effect::Theme(name));
            }
            return Ok(known);
        }
        HostRequest::InstallTheme { name, theme } => ctx.effects.push(Effect::InstallTheme(name, theme)),
    }
    Ok(serde_json::Value::Null)
}

/// Whether `request` asks for an effect, which a render may not.
fn effect(request: &HostRequest) -> bool {
    matches!(
        request,
        HostRequest::Toast { .. }
            | HostRequest::StorageSet { .. }
            | HostRequest::StorageMerge { .. }
            | HostRequest::OpenRoute { .. }
            | HostRequest::Dispatch { .. }
            | HostRequest::Attention(_)
            | HostRequest::Navigate { .. }
            | HostRequest::Fetch(_)
            | HostRequest::Dialog { .. }
            | HostRequest::Copy { .. }
            | HostRequest::ComposerEdit { .. }
    )
}

/// Answers a read through the host's [`Host::read`], as a built-in reads in process.
fn read(
    ctx: &Ctx,
    answer: impl FnOnce(&dyn abi::Read) -> serde_json::Result<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let host = ctx.host.upgrade().ok_or("the host is gone")?;
    let (mut answer, mut value) = (Some(answer), Ok(serde_json::Value::Null));
    host.read(&mut |read| {
        if let Some(answer) = answer.take() {
            value = answer(read);
        }
    });
    value.map_err(|error| error.to_string())
}

/// One activation's instance, as registrations call it.
struct Guest {
    /// The instance, until the registration's disposal takes it, which destroys it.
    instance: RefCell<Option<Instance>>,
    busy: Cell<bool>,
    failure: Rc<RefCell<Option<String>>>,
    host: Weak<dyn Host>,
    id: String,
    /// The activation ([`crate::Registry::live`]), which owns the dialogs it asks for.
    generation: u64,
    /// The commands' keymap layer, until deactivation or a panic removes it.
    layer: RefCell<Option<Disposer>>,
    /// The mounted slot claims and routes, which a wake draws again.
    activation: Rc<Activation>,
}

/// However the guest goes, by a disposal or by the host dropping the registry, a failed instance is not destroyed:
/// `destroy` would run its dispose callbacks, and a failed plugin is called no more (4.14). It is kept, as its library
/// is (4.5).
impl Drop for Guest {
    fn drop(&mut self) {
        self.release();
    }
}

impl Guest {
    /// Destroys the instance, or keeps a failed one; it is called no more either way.
    fn release(&self) {
        let instance = self.instance.borrow_mut().take();
        match self.failure.borrow().is_some() {
            true => std::mem::forget(instance),
            false => drop(instance),
        }
    }

    /// Sends one request. A failed or destroyed plugin is not called; a panic fails it, and its claims draw empty.
    /// What a call that fails it asked for is dropped, and the storage it wrote put back.
    fn request<T: DeserializeOwned>(self: &Rc<Self>, export: &str, request: &Request) -> Option<T> {
        if self.failure.borrow().is_some() {
            return None;
        }
        let result = {
            let instance = self.instance.borrow();
            let instance = instance.as_ref()?;
            if self.busy.replace(true) {
                log::warn!("plugin {}: {export} called while the plugin runs", self.id);
                return None;
            }
            // The renders of 1.4 on, whose SDK hands them only reads; a 1.3 render is left as it was.
            let render =
                matches!(request, Request::RenderFence(_) | Request::Render { .. } | Request::RenderRoute { .. });
            instance.shared.ctx.borrow_mut().read_only = render;
            let result = instance.call(request);
            instance.shared.ctx.borrow_mut().read_only = false;
            self.busy.set(false);
            result
        };
        let (effects, undo) = self.taken();
        let error = match result {
            Err(Some(error)) => format!("{export} {error}"),
            // A call that returned a failure did return: its effects apply (rich plugins 4.14).
            Err(None) => {
                self.apply(effects);
                return None;
            }
            Ok(value) => match serde_json::from_value(value) {
                Ok(typed) => {
                    self.apply(effects);
                    return Some(typed);
                }
                // A result the host refuses leaves no effect, and its storage writes go back.
                Err(error) => {
                    log::warn!("plugin {}: {export}: {error}", self.id);
                    if let Some(host) = self.host.upgrade() {
                        undo.restore(&*host);
                    }
                    return None;
                }
            },
        };
        if let Some(host) = self.host.upgrade() {
            undo.restore(&*host);
        }
        fail(&self.host, &self.id, &self.failure, self.layer.borrow_mut().take(), &self.activation, error);
        None
    }

    /// Sends a request to a handler, then, if it ran, invalidates the claims, whose state it may have changed.
    fn handle(self: &Rc<Self>, export: &str, request: &Request) {
        if self.request::<serde_json::Value>(export, request).is_some() {
            self.activation.invalidate();
        }
    }

    /// What the instance asked for since it was last taken.
    fn taken(&self) -> (Vec<Effect>, Undo) {
        let instance = self.instance.borrow();
        instance.as_ref().map(|instance| instance.shared.ctx.borrow_mut().take()).unwrap_or_default()
    }

    /// Queues the effects of a call on the effect queue, as the host would for a built-in.
    fn apply(self: &Rc<Self>, effects: Vec<Effect>) {
        apply(&self.host, self.id.clone(), Rc::downgrade(self), Some(self.generation), effects);
    }

    /// Calls `send` unless the instance is destroyed or its activation ended, as a call that panicked after the one
    /// that asked for it ends it: a fetch or a program in the foreground. Its reply goes to the instance as `request` on
    /// the effect queue, unless the instance is destroyed by then.
    fn send(guest: &Weak<Self>, host: &dyn Host, request: abi::RequestId, send: impl FnOnce(&dyn Host, crate::Reply)) {
        let live = guest.upgrade().filter(|guest| guest.instance.borrow().is_some() && !guest.activation.disposed());
        let Some(live) = live else { return };
        let (guest, owner) = (guest.clone(), live.host.clone());
        send(
            host,
            Box::new(move |result| {
                defer(&owner, move |_| {
                    if let Some(guest) = guest.upgrade() {
                        guest.handle("on-reply", &Request::Reply { id: request, result });
                    }
                });
            }),
        );
    }
}

/// Queues `effects` of plugin `id` on the effect queue, as the host would for a built-in; a fetch replies to `guest`, and
/// a dialog belongs to activation `generation`.
fn apply(host: &Weak<dyn Host>, id: String, guest: Weak<Guest>, generation: Option<u64>, effects: Vec<Effect>) {
    if effects.is_empty() {
        return;
    }
    defer(host, move |host| {
        for effect in effects {
            match effect {
                Effect::Toast(toast) => host.toast(&toast),
                Effect::Route(name) => host.open_route(&id, &name),
                Effect::Dispatch(name, input) => host.dispatch(&name, input.as_deref()),
                Effect::Attention(attention) => host.attention(&attention),
                Effect::Stored => host.storage_changed(),
                Effect::Navigate(route) => host.navigate(&id, &route),
                Effect::Fetch(request, fetch) => {
                    Guest::send(&guest, host, request, |host, reply| host.fetch(fetch, reply));
                }
                // The host shows it only while its activation is live. What a setup that failed or a destroyed
                // instance asked for has none, and shows nowhere.
                Effect::Dialog(dialog) => {
                    if let Some(generation) = generation {
                        host.dialog(&id, generation, dialog);
                    }
                }
                Effect::Copy(text, then) => crate::copy(host, &text, then),
                Effect::Composer(edit) => host.edit_composer(edit),
                Effect::Variant(variant) => host.set_variant(variant.as_deref()),
                Effect::Model(provider, model) => host.set_model(&provider, &model),
                Effect::Tab(edit) => host.edit_tab(edit),
                Effect::ClearSelection => host.clear_selection(),
                Effect::Foreground(request, program) => {
                    // The program starts later, once the turn is done: only if the instance is still live then.
                    let owner = guest.clone();
                    let alive = Box::new(move || {
                        owner
                            .upgrade()
                            .is_some_and(|guest| guest.instance.borrow().is_some() && guest.failure.borrow().is_none())
                    });
                    Guest::send(&guest, host, request, |host, reply| host.foreground(program, alive, reply));
                }
                Effect::Title(title) => host.set_title(&title),
                Effect::Theme(name) => host.set_theme(&name),
                Effect::InstallTheme(name, theme) => host.install_theme(&name, theme),
            }
        }
    });
}

/// Registers what the manifest lists, each calling into `guest`.
fn register(setup: &mut Setup<'_>, guest: &Rc<Guest>, manifest: &Manifest) {
    // Registered first, so it runs last: the instance is released now, on deactivation, unload and reload, even while
    // a route, a claim or a dialog's fences of it are still mounted, which then draw nothing.
    let disposed = guest.clone();
    setup.on_dispose(move || {
        disposed.release();
        disposed.activation.dispose();
    });
    let commands: Vec<(abi::Scope, TuiCommand)> = manifest
        .commands
        .iter()
        .map(|command| {
            let guest = guest.clone();
            let name = command.name.clone();
            let run = tui_command(command, move |input| {
                guest.handle("run-command", &Request::Command { name: name.clone(), input: input.map(str::to_owned) });
            });
            (command.scope.clone(), run)
        })
        .collect();
    let (commands, scoped) = route::split(commands);
    if !commands.is_empty() {
        match setup.host().keymap().layer(KeymapLayer::global(commands)) {
            Ok(disposer) => {
                guest.layer.replace(Some(disposer));
                let guest = guest.clone();
                setup.on_dispose(move || {
                    if let Some(layer) = guest.layer.take() {
                        layer.dispose();
                    }
                });
            }
            Err(error) => log::error!("plugin {} keymap layer: {error}", setup.id()),
        }
    }
    // A fence key that goes reaches the plugin once the event that freed its block is done.
    let gone = manifest.fence_gone.then(|| {
        let guest = Rc::downgrade(guest);
        Rc::new(move |key| {
            let guest = guest.clone();
            if let Some(host) = guest.upgrade().map(|guest| guest.host.clone()) {
                defer(&host, move |_| {
                    if let Some(guest) = guest.upgrade() {
                        guest.request::<serde_json::Value>("fence-gone", &Request::FenceGone { key });
                    }
                });
            }
        }) as crate::node::Gone
    });
    for (index, language) in manifest.fences.iter().enumerate() {
        let (guest, language) = (guest.clone(), language.clone());
        // A 1.4 plugin renders through `RenderFence`, which names the registration, as the host may have normalized
        // the language the block has; a 1.3 plugin gets the 1.3 request, with the language it registered.
        let fences = (manifest.render >= abi::RENDER).then(|| Fences::new(gone.clone()));
        setup.code_block(language.clone(), move |block, theme| {
            if let Some(fences) = &fences {
                return fences.render(block, theme, |fence| {
                    let request = Request::RenderFence(abi::RenderFence { fence, index: Some(index) });
                    guest.request("render-fence", &request).unwrap_or(Fenced::Code)
                });
            }
            let request = Request::Fence {
                language: language.clone(),
                info: block.info.to_owned(),
                code: block.code.to_owned(),
                streaming: block.streaming && !block.closed,
            };
            let lines = guest.request::<Option<Vec<Line>>>("render-fence", &request).flatten()?;
            Some(lines_widget(block.app, theme, &lines, None, Scroll::Wheel))
        });
    }
    for (claim, slot) in manifest.slots.iter().enumerate() {
        let guest = guest.clone();
        // A 1.4 claim renders through `Render`; a 1.3 claim gets the 1.3 request.
        if manifest.render >= abi::RENDER && slot.render {
            let activation = guest.activation.clone();
            let mount = slot.mount.then(|| {
                let guest = guest.clone();
                Rc::new(move |_: &dyn Host, input: &abi::SlotInput, mounted: bool| {
                    guest.handle("on-mount", &Request::Mount { claim, input: input.clone(), mounted });
                }) as MountFn
            });
            let render: SlotRender = Rc::new(move |_, input, changed| {
                let request = Request::Render { claim, input: input.clone(), changed: changed.clone() };
                guest.request("render-slot", &request).unwrap_or(abi::Render::Hide)
            });
            setup.claim(placement(slot), render, mount, slot.size, &activation);
            continue;
        }
        setup.slot(placement(slot), move |host, input| {
            let request = Request::Slot { claim, session_id: input.session_id.clone() };
            Box::new(Claim::mount(host, &guest, "render-slot", request))
        });
    }
    for (handler, types) in manifest.events.iter().enumerate() {
        let (guest, kinds) = (guest.clone(), types.clone());
        let subscription = setup.host().on_event(
            types,
            Rc::new(move |event| {
                if kinds.iter().any(|kind| kind == event.tag()) {
                    guest.handle("on-event", &Request::Event { handler, event: Box::new(event.clone()) });
                }
            }),
        );
        if let Some(subscription) = subscription {
            setup.on_dispose(move || drop(subscription));
        }
    }
    if manifest.deltas {
        let guest = guest.clone();
        let subscription = setup.host().on_deltas(Rc::new(move |events| {
            guest.handle("on-deltas", &Request::Deltas { events: events.to_vec() });
        }));
        if let Some(subscription) = subscription {
            setup.on_dispose(move || drop(subscription));
        }
    }
    for name in &manifest.routes {
        let guest = guest.clone();
        if manifest.render >= abi::RENDER && manifest.render_routes.contains(name) {
            let (request, activation) = (name.clone(), guest.activation.clone());
            let mount = manifest.route_mounts.contains(name).then(|| {
                let (guest, name) = (guest.clone(), name.clone());
                Rc::new(move |_: &dyn Host, _: &abi::SlotInput, mounted: bool| {
                    guest.handle("on-route-mount", &Request::RouteMount { name: name.clone(), mounted });
                }) as MountFn
            });
            let render: SlotRender = Rc::new(move |_, _, changed| {
                let request = Request::RenderRoute { name: request.clone(), changed: changed.clone() };
                guest.request("render-route", &request).unwrap_or(abi::Render::Hide)
            });
            setup.view_route(name, render, route::commands(&scoped, name), mount, &activation);
            continue;
        }
        let request = Request::Route { name: name.clone() };
        setup.route(name.clone(), move |host| Box::new(Claim::mount(host, &guest, "render-route", request.clone())));
    }
}

/// A mounted slot claim or route: the plugin's rows in a view, empty when it drew nothing or failed. It asks for
/// them again with each change batch and each wake, and rebuilds the view only when they differ.
struct Claim {
    guest: Rc<Guest>,
    export: &'static str,
    request: Request,
    view: View,
    lines: RefCell<Vec<Line>>,
}

impl Claim {
    fn mount(host: &dyn Host, guest: &Rc<Guest>, export: &'static str, request: Request) -> Rc<Self> {
        let view = View::new(host.app()).shrink(0.0);
        let claim = Rc::new(Self { guest: guest.clone(), export, request, view, lines: RefCell::default() });
        guest.activation.track(Rc::downgrade(&claim) as Weak<dyn Drawn>);
        claim.draw(host);
        claim
    }

    fn draw(&self, host: &dyn Host) {
        let lines = self.guest.request::<Vec<Line>>(self.export, &self.request).unwrap_or_default();
        if *self.lines.borrow() == lines {
            return;
        }
        self.view.clear();
        if !lines.is_empty() {
            self.view.add(&lines_widget(host.app(), &host.theme(), &lines, None, Scroll::None));
        }
        self.lines.replace(lines);
        host.app().request_redraw();
    }
}

impl Claimed for Rc<Claim> {
    fn root(&self) -> View {
        self.view.clone()
    }

    fn sync(&self, host: &dyn Host, _: &abi::Changed) {
        self.draw(host);
    }
}

impl Drawn for Claim {
    fn woken(&self, host: &dyn Host) {
        self.draw(host);
    }
}

/// The definition of a built-in whose `create` is `create`, wired through the byte shims of the C ABI as a loaded
/// library is, for the tests that prove a built-in on that path (`Loopback`).
#[doc(hidden)]
pub fn loopback(
    host: &Rc<dyn Host>,
    create: unsafe extern "C" fn(*const HostApi, Bytes, *mut *mut c_void, *mut Owned) -> i32,
) -> Result<(Definition, ErrorFn), String> {
    loopback_with(host, create, None)
}

/// [`loopback`] for a plugin that describes itself (`export_plugin!(@loopback_described ..)`), as every library
/// built against ABI 1.1 or newer does: the host learns its ID without a `setup`.
#[doc(hidden)]
pub fn loopback_described(
    host: &Rc<dyn Host>,
    (create, describe): (
        unsafe extern "C" fn(*const HostApi, Bytes, *mut *mut c_void, *mut Owned) -> i32,
        unsafe extern "C" fn(*mut Owned) -> i32,
    ),
) -> Result<(Definition, ErrorFn), String> {
    loopback_with(host, create, Some(describe))
}

fn loopback_with(
    host: &Rc<dyn Host>,
    create: unsafe extern "C" fn(*const HostApi, Bytes, *mut *mut c_void, *mut Owned) -> i32,
    describe: Option<unsafe extern "C" fn(*mut Owned) -> i32>,
) -> Result<(Definition, ErrorFn), String> {
    let api = PluginApi {
        size: size_of::<PluginApi>(),
        major: ABI_MAJOR,
        minor: ABI_MINOR,
        requires_minor: 4,
        create: Some(create),
        call: Some(abi::runtime::call),
        destroy: Some(abi::runtime::destroy),
        free: Some(abi::runtime::free),
        describe,
    };
    // The shims would silence the process's panic hook on their first `create`, as a plugin's own std does; the process
    // here keeps its own. Taking and setting the hook around each load would race other threads' loads.
    abi::runtime::keep_panic_hook();
    Library::from_table(&api, HOST_MINOR).and_then(|library| define(host, library, None))
}

#[cfg(test)]
mod tests;
