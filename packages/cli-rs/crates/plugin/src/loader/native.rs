//! The native backend (decision O-42): plugins are shared libraries on the C ABI of `opencode-plugin-abi`,
//! loaded with `opencode_util::dl`. There is no sandbox; it is the user's machine. The host only keeps a plugin's
//! panics out of the TUI:
//!
//! - the plugin's shims catch its panics, and the host's callbacks catch the host's, so no panic unwinds across
//!   the boundary (a crash such as a segfault still takes the process down);
//! - a panic fails the plugin: it is not called again, its fences fall back to the code view, its slots and routes
//!   draw empty, the plugin manager lists it as `failed` with the message, and a toast says so. Enabling it again
//!   in the plugin manager starts a fresh instance;
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
use std::sync::atomic::{AtomicUsize, Ordering};

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
use crate::{Claimed, Definition, ErrorFn, Host, Setup, defer, next_request, route, tui_command};

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
    // The failure of the running instance: a panic.
    let failure: Rc<RefCell<Option<String>>> = Rc::default();
    let definition = Definition::fallible(id, {
        let failure = failure.clone();
        move |setup: &mut Setup<'_>| {
            let host = Rc::downgrade(setup.host());
            let (instance, manifest) = Instance::create(&library, host.clone(), setup.id(), options.as_deref(), false)?;
            if manifest.id != setup.id() {
                return Err(format!("setup returned plugin ID {}, not {}", manifest.id, setup.id()));
            }
            *failure.borrow_mut() = None;
            let activation = Activation::new(setup.host(), instance.shared.wake.clone());
            let guest = Rc::new(Guest {
                instance: RefCell::new(Some(instance)),
                busy: Cell::new(false),
                failure: failure.clone(),
                host,
                id: setup.id().to_owned(),
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
            guest.apply(guest.effects());
            Ok(())
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
struct Ctx {
    host: Weak<dyn Host>,
    id: String,
    keys: Vec<String>,
    effects: Vec<Effect>,
    /// What it asks for is dropped.
    quiet: bool,
}

/// What [`HostApi::ctx`] points to: the context of the UI thread's callbacks, and what `wake` reads from any thread.
struct Shared {
    ctx: RefCell<Ctx>,
    wake: Arc<Wake>,
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
        let ctx = RefCell::new(Ctx { host, id: id.to_owned(), keys: Vec::new(), effects: Vec::new(), quiet });
        let shared = Box::new(Shared { ctx, wake });
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
        if status != abi::OK {
            // What the failed setup and its disposal asked for still happens; its fetches reach no activation.
            shared.drain();
        }
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
        let effects = std::mem::take(&mut ctx.effects);
        if !ctx.quiet {
            apply(&ctx.host, ctx.id.clone(), Weak::new(), effects);
        }
    }
}

/// The host's side of [`HostApi::call`]. Catches the host's panics.
unsafe extern "C" fn host_call(ctx: *mut c_void, request: Bytes, out: *mut Owned) -> i32 {
    if out.is_null() {
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
            host.storage_write(&stored, &value)?;
            ctx.effects.push(Effect::Stored);
        }
        HostRequest::StorageMerge { key: name, fields } => {
            let stored = key(ctx, &name)?;
            let host = ctx.host.upgrade().ok_or("the host is gone")?;
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
    }
    Ok(serde_json::Value::Null)
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
    /// The commands' keymap layer, until deactivation or a panic removes it.
    layer: RefCell<Option<Disposer>>,
    /// The mounted slot claims and routes, which a wake draws again.
    activation: Rc<Activation>,
}

impl Guest {
    /// Sends one request. A failed or destroyed plugin is not called; a panic fails it, and its claims draw empty.
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
            let result = instance.call(request);
            self.busy.set(false);
            result
        };
        self.apply(self.effects());
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
        defer(&self.host, move |host| {
            if let Some(layer) = layer {
                layer.dispose();
            }
            host.failed(&id);
            // The fences it drew fall back to the code view, as the ones it draws from now on do.
            host.remount();
        });
        self.activation.invalidate();
        None
    }

    /// Sends a request to a handler, then invalidates the claims, whose state it may have changed.
    fn handle(self: &Rc<Self>, export: &str, request: &Request) {
        self.request::<serde_json::Value>(export, request);
        self.activation.invalidate();
    }

    /// The effects the instance asked for since they were last taken.
    fn effects(&self) -> Vec<Effect> {
        let instance = self.instance.borrow();
        instance
            .as_ref()
            .map(|instance| std::mem::take(&mut instance.shared.ctx.borrow_mut().effects))
            .unwrap_or_default()
    }

    /// Queues the effects of a call on the effect queue, as the host would for a built-in.
    fn apply(self: &Rc<Self>, effects: Vec<Effect>) {
        apply(&self.host, self.id.clone(), Rc::downgrade(self), effects);
    }

    /// Sends `fetch` unless the instance is destroyed; its reply goes to the instance on the effect queue, unless the
    /// instance is destroyed by then.
    fn fetch(guest: &Weak<Self>, host: &dyn Host, request: abi::RequestId, fetch: abi::Fetch) {
        let Some(live) = guest.upgrade().filter(|guest| guest.instance.borrow().is_some()) else { return };
        let (guest, owner) = (guest.clone(), live.host.clone());
        host.fetch(
            fetch,
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

/// Queues `effects` of plugin `id` on the effect queue, as the host would for a built-in; a fetch replies to `guest`.
fn apply(host: &Weak<dyn Host>, id: String, guest: Weak<Guest>, effects: Vec<Effect>) {
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
                Effect::Fetch(request, fetch) => Guest::fetch(&guest, host, request, fetch),
                Effect::Dialog(dialog) => host.dialog(&id, dialog),
                Effect::Copy(text, then) => crate::copy(host, &text, then),
            }
        }
    });
}

/// Registers what the manifest lists, each calling into `guest`.
fn register(setup: &mut Setup<'_>, guest: &Rc<Guest>, manifest: &Manifest) {
    // Registered first, so it runs last: the instance is destroyed now, on deactivation, unload and reload, even while
    // a route, a claim or a dialog's fences of it are still mounted, which then draw nothing.
    let disposed = guest.clone();
    setup.on_dispose(move || {
        let instance = disposed.instance.borrow_mut().take();
        drop(instance);
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
            setup.claim(placement(slot), render, mount, &activation);
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
    let api = PluginApi {
        size: size_of::<PluginApi>(),
        major: ABI_MAJOR,
        minor: ABI_MINOR,
        requires_minor: 4,
        create: Some(create),
        call: Some(abi::runtime::call),
        destroy: Some(abi::runtime::destroy),
        free: Some(abi::runtime::free),
        describe: None,
    };
    // The shims silence the process's panic hook, as a plugin's own; the process here keeps its own.
    let hook = std::panic::take_hook();
    let defined = Library::from_table(&api, HOST_MINOR).and_then(|library| define(host, library, None));
    std::panic::set_hook(hook);
    defined
}

#[cfg(test)]
mod tests;
