//! The native backend (decision O-42): plugins are shared libraries on the C ABI of `opencode-plugin-abi`,
//! loaded with `opencode_util::dl`. There is no sandbox; it is the user's machine. The host only keeps a plugin's
//! panics out of the TUI:
//!
//! - the plugin's shims catch its panics, and the host's callbacks catch the host's, so no panic unwinds across
//!   the boundary (a crash such as a segfault still takes the process down);
//! - a panic fails the plugin: it is not called again, its fences fall back to the code view, its slots and routes
//!   draw empty, the plugin manager lists it as `failed` with the message, and a toast says so. Enabling it again
//!   in the plugin manager starts a fresh instance;
//! - host effects (toasts, routes) wait until the plugin returns, so it never reenters itself through the host.
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
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::time::Duration;

use opencode_plugin_abi::{
    self as abi, ABI_MAJOR, ABI_MINOR, Bytes, Fenced, HostApi, HostRequest, Line, Manifest, Owned, PluginApi,
    PluginApiV1_0, Request,
};
use opencode_ui::keymap::{Bind, KeymapLayer, Slash, TuiCommand};
use opencode_util::dl;
use opentui::app::ProxyError;
use opentui::keymap::Disposer;
use opentui::prelude::*;
use serde::de::DeserializeOwned;

use super::Backend;
use crate::node::{Fences, lines_widget};
use crate::{Definition, ErrorFn, Host, Kind, Placement, Setup, Slotted, Toast};

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

impl<H: Host> Backend<H> for Native {
    fn load(&self, host: &Rc<H>, library: &[u8], options: Option<&str>) -> Result<(Definition<H>, ErrorFn), String> {
        define(host, Library::open(library, HOST_MINOR)?, options)
    }
}

/// The definition of the plugin `library` holds; setup runs on each activation.
fn define<H: Host>(host: &Rc<H>, library: Library, options: Option<&str>) -> Result<(Definition<H>, ErrorFn), String> {
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
        None => Instance::create(&library, Rc::downgrade(host), "", options.as_deref())?.1.id,
    };
    let failure: Rc<RefCell<Option<String>>> = Rc::default();
    let definition = Definition::new(id, {
        let failure = failure.clone();
        move |setup: &mut Setup<'_, H>| {
            let host = Rc::downgrade(setup.host());
            let instance = Instance::create(&library, host.clone(), setup.id(), options.as_deref()).and_then(
                |(instance, manifest)| match manifest.id == setup.id() {
                    true => Ok((instance, manifest)),
                    false => Err(format!("setup returned plugin ID {}, not {}", manifest.id, setup.id())),
                },
            );
            let (instance, manifest) = match instance {
                Ok(instance) => instance,
                Err(error) => {
                    log::error!("plugin {} failed: {error}", setup.id());
                    *failure.borrow_mut() = Some(error);
                    return;
                }
            };
            *failure.borrow_mut() = None;
            let woken = instance.shared.wake.id;
            let guest = Rc::new_cyclic(|guest: &Weak<Guest<H>>| {
                let guest = guest.clone();
                let handler = setup.host().app().on_message(move |_, message: &Woken| {
                    if let Some(guest) = guest.upgrade().filter(|_| message.0 == woken) {
                        guest.redraw();
                    }
                });
                Guest {
                    instance,
                    busy: Cell::new(false),
                    failure: failure.clone(),
                    host,
                    id: setup.id().to_owned(),
                    layer: RefCell::new(None),
                    claims: RefCell::default(),
                    handler,
                }
            });
            register(setup, &guest, &manifest);
            // What setup asked for (toasts, routes) happens now that the plugin is active.
            let effects = std::mem::take(&mut guest.instance.shared.ctx.borrow_mut().effects);
            guest.apply(effects);
        }
    });
    let error: ErrorFn = Rc::new(move || failure.borrow().clone());
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
        static OPENED: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!("opencode-rs-plugins-{}", std::process::id()));
        std::fs::create_dir_all(&dir).map_err(|error| format!("{}: {error}", dir.display()))?;
        let file = dir.join(format!("{}.{}", OPENED.fetch_add(1, Ordering::Relaxed), std::env::consts::DLL_EXTENSION));
        std::fs::write(&file, bytes).map_err(|error| format!("{}: {error}", file.display()))?;
        // SAFETY: loading runs the library's initializers; a plugin is code the user chose to run.
        let library = unsafe { dl::Library::open(&file) };
        // The mapping stays after the file is gone (where the platform allows removing it).
        let _ = std::fs::remove_file(&file);
        let library = library.map_err(|error| format!("cannot load the library: {error}"))?;
        // SAFETY: `ENTRY` has type `EntryFn` in every plugin of this major version.
        let entry = unsafe { library.symbol::<abi::EntryFn>(abi::ENTRY) }
            .map_err(|_| format!("not an opencode-rs plugin: no `{}` symbol", abi::ENTRY))?;
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
                "plugin ABI {major}.{minor} is not supported: this opencode-rs loads ABI {ABI_MAJOR}.x plugins \
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
                "plugin needs host ABI {ABI_MAJOR}.{} or newer, this opencode-rs has {ABI_MAJOR}.{host_minor}; \
                 update opencode-rs",
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
        let Some(describe) = self.describe else {
            return abi::Metadata::default();
        };
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

/// What the host's callbacks see: the plugin's identity, its storage keys, and effects that wait for the call to
/// return.
struct Ctx<H: Host> {
    host: Weak<H>,
    id: String,
    keys: Vec<String>,
    effects: Vec<Effect>,
}

/// What [`HostApi::ctx`] points to: the context of the UI thread's callbacks, and what `wake` reads from any thread.
struct Shared<H: Host> {
    ctx: RefCell<Ctx<H>>,
    wake: Wake,
}

/// An instance's wakes: `pending` while a [`Woken`] waits for the UI thread, so a burst posts one.
struct Wake {
    id: u64,
    pending: AtomicBool,
    proxy: Option<AppProxy>,
}

/// Posted by `wake`: the instance whose claims draw again.
struct Woken(u64);

enum Effect {
    Toast(Toast, String),
    Route(String),
}

/// One plugin instance; dropping it destroys the instance in the plugin.
struct Instance<H: Host> {
    library: Rc<Library>,
    handle: *mut c_void,
    // The plugin keeps pointers to these until `destroy`, so they are boxed and dropped after it.
    _api: Box<HostApi>,
    shared: Box<Shared<H>>,
}

impl<H: Host> Instance<H> {
    /// Runs setup. `id` is the plugin's ID, or empty while it is not known, so setup may use storage.
    fn create(
        library: &Rc<Library>,
        host: Weak<H>,
        id: &str,
        options: Option<&str>,
    ) -> Result<(Self, Manifest), String> {
        static INSTANCES: AtomicU64 = AtomicU64::new(0);
        let proxy = host.upgrade().map(|host| host.app().proxy());
        let wake = Wake { id: INSTANCES.fetch_add(1, Ordering::Relaxed), pending: AtomicBool::new(false), proxy };
        let ctx = RefCell::new(Ctx { host, id: id.to_owned(), keys: Vec::new(), effects: Vec::new() });
        let shared = Box::new(Shared { ctx, wake });
        let api = Box::new(HostApi {
            size: size_of::<HostApi>(),
            major: ABI_MAJOR,
            minor: HOST_MINOR,
            ctx: std::ptr::from_ref::<Shared<H>>(&shared).cast_mut().cast(),
            call: Some(host_call::<H>),
            free: Some(host_free),
            theme_mode: Some(host_theme_mode::<H>),
            wake: Some(host_wake::<H>),
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
            abi::PANIC => return Err(format!("setup panicked: {}", text())),
            _ => return Err(text()),
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

impl<H: Host> Drop for Instance<H> {
    fn drop(&mut self) {
        if let Some(destroy) = self.library.destroy {
            // SAFETY: `handle` came from `create` and is destroyed once; the plugin catches its own panics.
            unsafe { destroy(self.handle) };
        }
    }
}

/// The host's side of [`HostApi::call`]. Catches the host's panics.
unsafe extern "C" fn host_call<H: Host>(ctx: *mut c_void, request: Bytes, out: *mut Owned) -> i32 {
    if out.is_null() {
        return abi::ERROR;
    }
    // SAFETY: `ctx` is the `Shared<H>` this instance was created with, or null; `request` is valid for the call.
    let (ctx, request) = unsafe { (ctx.cast::<Shared<H>>().as_ref().map(|shared| &shared.ctx), request.as_slice()) };
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
unsafe extern "C" fn host_theme_mode<H: Host>(ctx: *mut c_void) -> u32 {
    // SAFETY: `ctx` is the `Shared<H>` this instance was created with, or null.
    let ctx = unsafe { ctx.cast::<Shared<H>>().as_ref().map(|shared| &shared.ctx) };
    let host = ctx.and_then(|ctx| ctx.try_borrow().ok()).and_then(|ctx| ctx.host.upgrade());
    let light = catch_unwind(AssertUnwindSafe(|| host.is_some_and(|host| host.theme_mode() == ThemeMode::Light)));
    if light.unwrap_or(false) { abi::THEME_LIGHT } else { abi::THEME_DARK }
}

/// The host's side of [`HostApi::wake`], on any thread: posts one [`Woken`] until the UI thread handles it.
unsafe extern "C" fn host_wake<H: Host>(ctx: *mut c_void) {
    if ctx.is_null() {
        return;
    }
    // SAFETY: `ctx` is this instance's `Shared<H>`, which lives until `destroy` returns. Only `wake`, which is
    // `Sync`, is read off the UI thread.
    let wake = unsafe { &*std::ptr::addr_of!((*ctx.cast::<Shared<H>>()).wake) };
    let _ = catch_unwind(AssertUnwindSafe(|| {
        if wake.pending.swap(true, Ordering::AcqRel) {
            return;
        }
        let Some(proxy) = &wake.proxy else {
            wake.pending.store(false, Ordering::Release);
            return;
        };
        match proxy.send(Woken(wake.id)) {
            Ok(()) => {}
            Err(ProxyError::Closed) => wake.pending.store(false, Ordering::Release),
            // The UI thread is behind. The wake stays pending, so later ones join it, and a thread delivers it once
            // the queue has room, as `App::spawn` does with a completion. That thread holds no pointer into the
            // instance, so it may outlive it; a `Woken` for a destroyed instance finds no handler.
            Err(ProxyError::Full) => {
                let (proxy, id) = (proxy.clone(), wake.id);
                let retry = std::thread::Builder::new().name("plugin-wake".to_owned()).spawn(move || {
                    while proxy.send(Woken(id)) == Err(ProxyError::Full) {
                        std::thread::sleep(Duration::from_millis(1));
                    }
                });
                if retry.is_err() {
                    wake.pending.store(false, Ordering::Release);
                }
            }
        }
    }));
}

unsafe extern "C" fn host_free(owned: Owned) {
    // SAFETY: the host made `owned` with `Owned::from_vec`.
    drop(unsafe { owned.into_vec() });
}

fn handle<H: Host>(ctx: &mut Ctx<H>, request: HostRequest) -> Result<serde_json::Value, String> {
    let key = |ctx: &Ctx<H>, key: &str| {
        if ctx.id.is_empty() {
            return Err("the plugin ID is not known during setup".to_owned());
        }
        ctx.keys
            .iter()
            .any(|known| known == key)
            .then(|| format!("plugin.{}.{key}", ctx.id))
            .ok_or_else(|| format!("storage key {key} was not declared"))
    };
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
        HostRequest::Toast { variant, message } => {
            let variant = match variant {
                abi::Toast::Info => Toast::Info,
                abi::Toast::Success => Toast::Success,
                abi::Toast::Warning => Toast::Warning,
                abi::Toast::Error => Toast::Error,
            };
            ctx.effects.push(Effect::Toast(variant, message));
        }
        HostRequest::StorageGet { key: name } => {
            let stored = key(ctx, &name)?;
            let value = ctx.host.upgrade().and_then(|host| host.storage_read(&stored));
            return Ok(serde_json::to_value(value).unwrap_or_default());
        }
        HostRequest::StorageSet { key: name, value } => {
            let stored = key(ctx, &name)?;
            let host = ctx.host.upgrade().ok_or("the host is gone")?;
            host.storage_write(&stored, &value)?;
        }
        HostRequest::OpenRoute { name } => ctx.effects.push(Effect::Route(name)),
        HostRequest::StorageKey { key } => {
            if !ctx.keys.contains(&key) {
                ctx.keys.push(key);
            }
        }
    }
    Ok(serde_json::Value::Null)
}

/// One activation's instance, as registrations call it.
struct Guest<H: Host> {
    instance: Instance<H>,
    busy: Cell<bool>,
    failure: Rc<RefCell<Option<String>>>,
    host: Weak<H>,
    id: String,
    /// The commands' keymap layer, until deactivation or a panic removes it.
    layer: RefCell<Option<Disposer>>,
    /// The mounted slot claims and routes, which a wake draws again.
    claims: RefCell<Vec<Weak<Claim<H>>>>,
    /// The handler of this instance's [`Woken`].
    handler: HandlerId,
}

impl<H: Host> Drop for Guest<H> {
    fn drop(&mut self) {
        if let Some(host) = self.host.upgrade() {
            host.app().remove_handler(self.handler);
        }
    }
}

impl<H: Host> Guest<H> {
    /// Sends one request. A failed plugin is not called again; a panic fails it.
    fn request<T: DeserializeOwned>(&self, export: &str, request: &Request) -> Option<T> {
        if self.failure.borrow().is_some() {
            return None;
        }
        if self.busy.replace(true) {
            log::warn!("plugin {}: {export} called while the plugin runs", self.id);
            return None;
        }
        let result = self.instance.call(request);
        self.busy.set(false);
        let effects = std::mem::take(&mut self.instance.shared.ctx.borrow_mut().effects);
        self.apply(effects);
        let error = match result {
            Ok(value) => {
                return serde_json::from_value(value)
                    .inspect_err(|error| log::warn!("plugin {}: {export}: {error}", self.id))
                    .ok();
            }
            Err(None) => return None,
            Err(Some(error)) => format!("{export} {error}"),
        };
        log::error!("plugin {} failed: {error}", self.id);
        *self.failure.borrow_mut() = Some(error);
        let id = self.id.clone();
        // The layer goes once the key that may have run the panicking command is handled.
        let layer = self.layer.borrow_mut().take();
        self.defer(move |host| {
            if let Some(layer) = layer {
                layer.dispose();
            }
            host.toast(Toast::Error, Some(&format!("Plugin failed: {id}")), "Run /plugins to view details.");
        });
        None
    }

    /// Draws the mounted claims again, after the plugin woke the host.
    fn redraw(&self) {
        self.instance.shared.wake.pending.store(false, Ordering::Release);
        let Some(host) = self.host.upgrade() else {
            return;
        };
        let claims: Vec<Rc<Claim<H>>> = {
            let mut claims = self.claims.borrow_mut();
            claims.retain(|claim| claim.strong_count() > 0);
            claims.iter().filter_map(Weak::upgrade).collect()
        };
        claims.iter().for_each(|claim| claim.draw(&host));
    }

    /// Applies the effects of a call once the current event is handled, as the host would for a built-in.
    fn apply(&self, effects: Vec<Effect>) {
        if effects.is_empty() {
            return;
        }
        let id = self.id.clone();
        self.defer(move |host| {
            for effect in effects {
                match effect {
                    Effect::Toast(variant, message) => host.toast(variant, None, &message),
                    Effect::Route(name) => host.open_route(&id, &name),
                }
            }
        });
    }

    fn defer(&self, f: impl FnOnce(&H) + 'static) {
        let Some(host) = self.host.upgrade() else {
            return;
        };
        let weak = self.host.clone();
        host.app().set_timeout(Duration::ZERO, move |_| {
            if let Some(host) = weak.upgrade() {
                f(&host);
            }
        });
    }
}

/// Registers what the manifest lists, each calling into `guest`.
fn register<H: Host>(setup: &mut Setup<'_, H>, guest: &Rc<Guest<H>>, manifest: &Manifest) {
    let commands: Vec<TuiCommand> = manifest
        .commands
        .iter()
        .map(|command| {
            let guest = guest.clone();
            let name = command.name.clone();
            let mut entry = TuiCommand::new(command.name.clone(), move |input, _| {
                let request = Request::Command { name: name.clone(), input: input.map(str::to_owned) };
                guest.request::<serde_json::Value>("run-command", &request);
            })
            .title(command.title.clone())
            .bind(command.keybind.clone().map_or(Bind::Default, Bind::Key));
            if command.palette {
                entry = entry.palette();
            }
            if let Some(group) = &command.group {
                entry = entry.group(group.clone());
            }
            if let Some(slash) = &command.slash {
                entry = entry.slash(Slash { name: slash.clone(), aliases: Vec::new(), arguments: false });
            }
            entry
        })
        .collect();
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
    for language in &manifest.fences {
        let guest = guest.clone();
        // A 1.4 plugin renders through `RenderFence`; a 1.3 plugin gets the 1.3 request.
        let fences = (manifest.render >= abi::RENDER).then(Fences::default);
        setup.code_block(language.clone(), move |block, theme| {
            if let Some(fences) = &fences {
                return fences.render(block, theme, |fence| {
                    guest.request("render-fence", &Request::RenderFence(fence)).unwrap_or(Fenced::Code)
                });
            }
            let request = Request::Fence {
                language: block.language.to_owned(),
                info: block.info.to_owned(),
                code: block.code.to_owned(),
                streaming: block.streaming && !block.closed,
            };
            let lines = guest.request::<Option<Vec<Line>>>("render-fence", &request).flatten()?;
            Some(lines_widget(block.app, theme, &lines, true))
        });
    }
    for (claim, slot) in manifest.slots.iter().enumerate() {
        let guest = guest.clone();
        let kind = match slot.kind {
            abi::SlotKind::Prepend => Kind::Prepend,
            abi::SlotKind::Append => Kind::Append,
            abi::SlotKind::Before => Kind::Before,
            abi::SlotKind::After => Kind::After,
            abi::SlotKind::Replace => Kind::Replace,
        };
        setup.slot(Placement::new(kind, slot.path.clone()), move |host, input| {
            let request = Request::Slot { claim, session_id: input.session_id.clone() };
            Box::new(Claim::mount(host, &guest, "render-slot", request))
        });
    }
    for name in &manifest.routes {
        let guest = guest.clone();
        let request = Request::Route { name: name.clone() };
        setup.route(name.clone(), move |host| Box::new(Claim::mount(host, &guest, "render-route", request.clone())));
    }
}

/// A mounted slot claim or route: the plugin's rows in a view, empty when it drew nothing or failed. It asks for
/// them again with each change batch and each wake, and rebuilds the view only when they differ.
struct Claim<H: Host> {
    guest: Rc<Guest<H>>,
    export: &'static str,
    request: Request,
    view: View,
    lines: RefCell<Vec<Line>>,
}

impl<H: Host> Claim<H> {
    fn mount(host: &H, guest: &Rc<Guest<H>>, export: &'static str, request: Request) -> Rc<Self> {
        let view = View::new(host.app()).shrink(0.0);
        let claim = Rc::new(Self { guest: guest.clone(), export, request, view, lines: RefCell::default() });
        guest.claims.borrow_mut().push(Rc::downgrade(&claim));
        claim.draw(host);
        claim
    }

    fn draw(&self, host: &H) {
        let lines = self.guest.request::<Vec<Line>>(self.export, &self.request).unwrap_or_default();
        if *self.lines.borrow() == lines {
            return;
        }
        self.view.clear();
        if !lines.is_empty() {
            self.view.add(&lines_widget(host.app(), &host.theme(), &lines, false));
        }
        self.lines.replace(lines);
        host.app().request_redraw();
    }
}

impl<H: Host> Slotted<H> for Rc<Claim<H>> {
    fn root(&self) -> View {
        self.view.clone()
    }

    fn sync(&self, host: &H, changes: &H::Changes) {
        if !H::unchanged(changes) {
            self.draw(host);
        }
    }
}

#[cfg(test)]
mod tests;
