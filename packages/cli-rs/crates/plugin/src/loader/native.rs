//! Loads native plugins through the C ABI. Native code runs in process; the panic boundary does not isolate a
//! crash. Plugin effects commit when a call returns. If it panics, discard the effects, restore storage and stop
//! calling the plugin until reactivation. Worker threads communicate through the mailbox and wake the UI thread for
//! rendering. Deactivation destroys the instance even if a widget still holds one of its registrations.

#![allow(unsafe_code)]

use std::cell::{Cell, RefCell};
use std::ffi::c_void;
use std::mem::{offset_of, size_of};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::Path;
use std::ptr::NonNull;
use std::rc::{Rc, Weak};
use std::sync::Arc;
use std::time::Duration;

use opencode_plugin_abi::mail::Message;
use opencode_plugin_abi::{
    self as abi, ABI_MAJOR, ABI_MINOR, Bytes, Fenced, HostApi, HostRequest, Manifest, Owned, PluginApi, Request,
    received, v2,
};
use opencode_ui::keymap::TuiCommand;
use opencode_util::dl;
use opentui::keymap::Disposer;
use opentui::prelude::*;
use serde::de::DeserializeOwned;

use super::Backend;
use super::requests::{Answers, Ctx, Effect, To, apply, handle, keyed, routed};
use crate::activation::{Activation, Wake};
use crate::behave;
use crate::conformance::{self, Event};
use crate::mailbox::Mailbox;
use crate::node::{Fences, MountFn, SlotRender};
use crate::slot::placement;
use crate::surface::{self, Viewed, Viewer, Viewing};
use crate::{Definition, ErrorFn, Host, Setup, Undo, defer, fail, route, tui_command};

/// The host's minor version of the current major: it serves every entry and request up to it.
pub const HOST_MINOR: u32 = ABI_MINOR;

/// The entry of ABI 1.x, which no host serves any more: a library that exports it alone is refused by its major, with
/// a reason, not as no plugin.
const ENTRY_V1: &str = "opencode_plugin_v1";

/// What crossed the C ABI on this thread, counted outside any plugin and any mount.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Crossed {
    /// Calls the host made into plugins.
    pub calls: u64,
    /// Bytes the host handed plugins: requests, and the answers to their own requests.
    pub sent: u64,
    /// Bytes plugins handed the host: answers, and their own requests.
    pub received: u64,
}

impl Crossed {
    pub fn since(self, before: Crossed) -> Crossed {
        Crossed {
            calls: self.calls - before.calls,
            sent: self.sent - before.sent,
            received: self.received - before.received,
        }
    }
}

thread_local! {
    static CROSSED: Cell<Crossed> = const { Cell::new(Crossed { calls: 0, sent: 0, received: 0 }) };
}

/// What crossed the C ABI on this thread so far.
pub fn crossed() -> Crossed {
    CROSSED.with(Cell::get)
}

fn carry(f: impl FnOnce(&mut Crossed)) {
    crate::tally(&CROSSED, f);
}

/// Loads native plugins.
#[derive(Clone, Copy, Debug, Default)]
pub struct Native;

/// What a library reports about itself before it is set up.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Inspected {
    pub major: u32,
    pub minor: u32,
    /// The plugin's version from `describe`, when it names one.
    pub version: Option<String>,
}

impl Native {
    /// Opens `library` and checks its version without setting it up.
    pub fn inspect(&self, library: &[u8]) -> Result<Inspected, String> {
        let library = Library::open(library, None)?;
        let (_, metadata) = library.compatible()?;
        Ok(Inspected { major: library.major, minor: library.minor, version: metadata.version })
    }
}

impl Backend for Native {
    /// Bytes with no quarantine: ones not read through [`Backend::load_read`].
    fn load(
        &self,
        host: &Rc<dyn Host>,
        library: &[u8],
        source: &Path,
        options: Option<&str>,
    ) -> Result<(Definition, ErrorFn), String> {
        self.load_read(host, library, None, source, options)
    }

    fn load_read(
        &self,
        _host: &Rc<dyn Host>,
        library: &[u8],
        quarantine: Option<&[u8]>,
        source: &Path,
        options: Option<&str>,
    ) -> Result<(Definition, ErrorFn), String> {
        define(Library::open(library, Some((source, quarantine)))?, options)
    }
}

/// The definition of the plugin `library` holds; setup runs on each activation.
fn define(library: Library, options: Option<&str>) -> Result<(Definition, ErrorFn), String> {
    let library = Rc::new(library);
    let (id, metadata) = library.compatible()?;
    if let Some(version) = &metadata.version {
        log::info!("plugin library version {version}, ABI {}.{}", library.major, library.minor);
    }
    let options = options.map(str::to_owned);
    // Setup runs on each activation only, so a disabled plugin starts nothing: loading a library runs its native
    // initializers, never its setup. A library names its ID in `describe`, before any `create`. The failure of the
    // running instance, a panic, in a cell of each activation's own: a new activation leaves an old one's failure as
    // it was.
    let current: Rc<RefCell<Rc<RefCell<Option<String>>>>> = Rc::default();
    let definition = Definition::fallible(id, {
        let current = current.clone();
        move |setup: &mut Setup<'_>| {
            let host = Rc::downgrade(setup.host());
            let (monitor, slot) = (setup.monitor.clone(), setup.monitor.slot(&setup.artifact()));
            let (created, _) = monitor.call(slot, "setup", || {
                Instance::create(&library, host.clone(), setup.id(), options.as_deref(), false, Some(setup.id()))
            });
            let (instance, manifest) = created?;
            let failure: Rc<RefCell<Option<String>>> = Rc::default();
            *current.borrow_mut() = failure.clone();
            let failed = failure.clone();
            setup.failure(Rc::new(move || failed.borrow().clone()));
            let activation = Activation::new(setup.host(), instance.shared().mail.clone());
            let owners = crate::Owners::new(setup.id(), host.clone(), &activation);
            instance.shared().ctx.borrow_mut().owners = Some(owners.clone());
            activation.set_monitor(monitor.clone(), slot);
            let guest = Rc::new(Guest {
                instance: RefCell::new(Some(instance)),
                busy: Cell::new(false),
                failure,
                host,
                id: setup.id().to_owned(),
                generation: setup.generation(),
                revoked: RefCell::default(),
                activation,
                owners,
                monitor,
                slot,
                cancels: manifest.cancelled,
            });
            if manifest.wake {
                let woken = Rc::downgrade(&guest);
                guest.activation.on_wake(Rc::new(move || {
                    if let Some(guest) = woken.upgrade() {
                        guest.handle("on-wake", &Request::Wake);
                    }
                }));
            }
            if manifest.plugins {
                let heard = Rc::downgrade(&guest);
                setup.on_plugins(Rc::new(move || {
                    if let Some(guest) = heard.upgrade() {
                        guest.handle("on-plugins", &Request::Plugins);
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

/// A plugin's `create`: a library's entry, or the SDK's shim of a plugin carried in process ([`carried`]).
type CreateFn = Rc<dyn Fn(*const HostApi, Bytes, *mut *mut c_void, *mut Owned) -> i32>;

/// An open library's entries. The library stays loaded for the life of the process.
struct Library {
    major: u32,
    minor: u32,
    create: CreateFn,
    call: unsafe extern "C" fn(*mut c_void, Bytes, *mut Owned) -> i32,
    destroy: Option<unsafe extern "C" fn(*mut c_void)>,
    free: unsafe extern "C" fn(Owned),
    describe: Rc<dyn Fn(*mut Owned) -> i32>,
}

impl Library {
    /// `plugin` through the SDK's own shims, as a library of the current ABI exports them.
    fn carried(plugin: abi::Plugin) -> Self {
        let id = plugin.id;
        conformance::tap(Event::Open { major: ABI_MAJOR, minor: ABI_MINOR, requires_minor: 0, served: HOST_MINOR });
        Self {
            major: ABI_MAJOR,
            minor: ABI_MINOR,
            // SAFETY: the host calls it as `PluginApi::create` documents.
            create: Rc::new(move |host, options, instance, out| unsafe {
                abi::runtime::create(plugin.id, plugin.setup, host, options, instance, out)
            }),
            call: abi::runtime::call,
            destroy: Some(abi::runtime::destroy),
            free: abi::runtime::free,
            // SAFETY: the host passes an `out` valid for writes.
            describe: Rc::new(move |out| unsafe { abi::runtime::describe(id, "", &[], out) }),
        }
    }

    /// Opens a library, `bytes` read from the file `source` with its raw quarantine, through a copy, so a new build
    /// can replace the file, through [`abi::ENTRY`]. On macOS the copy carries the quarantine the bytes were read
    /// with, so the system checks it as it would the file; a copy that cannot carry it is not opened.
    fn open(bytes: &[u8], source: Option<(&Path, Option<&[u8]>)>) -> Result<Self, String> {
        let dir = staging()?;
        let file = dir.path().join(format!("plugin.{}", std::env::consts::DLL_EXTENSION));
        let error = |error: std::io::Error| format!("{}: {error}", file.display());
        let mut copy = std::fs::File::create(&file).map_err(error)?;
        std::io::Write::write_all(&mut copy, bytes).map_err(error)?;
        let quarantined = source.and_then(|(_, quarantine)| quarantine);
        if let (Some(value), Some((source, _))) = (quarantined, source) {
            super::quarantine::put(&copy, value).map_err(|error| format!("{}: {error}", source.display()))?;
        }
        drop(copy);
        let (source, quarantined) = (source.map(|(source, _)| source), quarantined.is_some());
        // SAFETY: loading runs the library's initializers; a plugin is code the user chose to run.
        let library = unsafe { dl::Library::open(&file) };
        // The mapping stays after the directory is gone (where the platform allows removing it).
        drop(dir);
        let library = library.map_err(|error| {
            // The system names the copy; the user knows the file.
            let error = error.to_string();
            let error = source
                .map_or(error.clone(), |source| error.replace(&*file.to_string_lossy(), &source.to_string_lossy()));
            explain_refusal(&error, cfg!(target_os = "macos"), quarantined, source)
        })?;
        // SAFETY: the entry has type `EntryFn` in every plugin of ABI 2. The entry of ABI 1 is only looked up, never
        // called.
        let entry = unsafe { library.symbol::<abi::EntryFn>(abi::ENTRY) }.map_err(|_| {
            // SAFETY: looking a symbol up runs no plugin code, and the entry of ABI 1 is never called.
            match unsafe { library.symbol::<abi::EntryFn>(ENTRY_V1) } {
                Ok(_) => unsupported("1.x"),
                Err(_) => format!("not an opencode-native plugin: no `{}` symbol", abi::ENTRY),
            }
        })?;
        // SAFETY: as above; the table it returns lives as long as the library.
        let opened = Self::from_table(unsafe { entry() })?;
        library.leak();
        Ok(opened)
    }

    /// Checks the table `api` points to, found through [`abi::ENTRY`], and takes its entries. Nothing past the `size`
    /// it declares is read.
    fn from_table(api: *const PluginApi) -> Result<Self, String> {
        if api.is_null() {
            return Err(format!("`{}` returned no table", abi::ENTRY));
        }
        if !api.is_aligned() {
            return Err("plugin table is not aligned".to_owned());
        }
        // SAFETY: every table of any version starts with `size`, and `api` is aligned and non-null.
        let size = unsafe { std::ptr::addr_of!((*api).size).read() };
        if size < offset_of!(PluginApi, requires_minor) {
            return Err(format!("plugin table is {size} bytes, shorter than its version header"));
        }
        // SAFETY: `size` covers `major` and `minor`.
        let (major, minor) =
            unsafe { (std::ptr::addr_of!((*api).major).read(), std::ptr::addr_of!((*api).minor).read()) };
        if major != ABI_MAJOR {
            return Err(unsupported(&format!("{major}.{minor}")));
        }
        if size < size_of::<PluginApi>() {
            return Err(format!("plugin table is {size} bytes, shorter than the ABI {major}.0 table"));
        }
        // SAFETY: the 2.0 table is within `size`; its callbacks are nullable.
        let core = unsafe { &*api };
        if core.requires_minor > HOST_MINOR {
            return Err(format!(
                "plugin needs host ABI {major}.{} or newer, this opencode-native has {major}.{HOST_MINOR}; \
                 update opencode-native",
                core.requires_minor
            ));
        }
        let required = |name: &str| format!("plugin table has a null `{name}` callback");
        let create = core.create.ok_or_else(|| required("create"))?;
        let call = core.call.ok_or_else(|| required("call"))?;
        let free = core.free.ok_or_else(|| required("free"))?;
        let describe = core.describe.ok_or_else(|| required("describe"))?;
        // SAFETY: the host calls them as `PluginApi::create` and `PluginApi::describe` document.
        let create: CreateFn =
            Rc::new(move |host, options, instance, out| unsafe { create(host, options, instance, out) });
        // SAFETY: the host passes `describe` an `out` valid for writes, as `PluginApi::describe` documents.
        let describe: Rc<dyn Fn(*mut Owned) -> i32> = Rc::new(move |out| unsafe { describe(out) });
        let requires_minor = core.requires_minor;
        conformance::tap(Event::Open { major, minor, requires_minor, served: HOST_MINOR });
        Ok(Self { major, minor, create, call, destroy: core.destroy, free, describe })
    }

    /// What the plugin says about itself, its ID and its metadata, checked against what this host offers: a library
    /// whose `describe` fails, answers what the host cannot read or no nonempty ID, or requires a feature the host lacks,
    /// is refused before any setup, at load and at inspection alike.
    fn compatible(&self) -> Result<(String, abi::Metadata), String> {
        let mut out = Owned::EMPTY;
        conformance::tap(Event::Describe);
        let status = (self.describe)(&mut out);
        // SAFETY: `describe` wrote `out`, which goes back to `free`.
        let received = unsafe { received(out, self.free) };
        conformance::tap(Event::Return { status, reply: received.as_deref().map_err(String::as_str) });
        let metadata = received
            .and_then(|bytes| match status {
                abi::OK => serde_json::from_slice::<abi::Metadata>(&bytes).map_err(|error| error.to_string()),
                _ => Err(String::from_utf8_lossy(&bytes).into_owned()),
            })
            .map_err(|error| format!("plugin describe failed: {error}"))?;
        let Some(id) = metadata.id.clone().filter(|id| !id.is_empty()) else {
            return Err(format!(
                "plugin of ABI {}.{} names no ID in `describe`: a plugin describes itself with a nonempty \"id\" before \
                 it is set up; rebuild it with `opencode_plugin_abi::plugin!`, or return the ID from `describe`",
                self.major, self.minor
            ));
        };
        if let Some(feature) = metadata.requires.iter().find(|feature| !abi::FEATURES.contains(&feature.as_str())) {
            return Err(format!(
                "plugin requires the feature {feature}, which this opencode-native (ABI {ABI_MAJOR}.{HOST_MINOR}) \
                 lacks; update opencode-native"
            ));
        }
        Ok((id, metadata))
    }
}

/// The directory a library's copy is opened from: one this process makes, owner-only, so nobody else can place or swap
/// the file in it. Windows cannot remove a mapped library, so there the copies go under `opencode-plugins` in the temp
/// directory, and each open removes the directories there that no process maps any more.
fn staging() -> Result<opencode_util::temp::TempDir, String> {
    let temp = std::env::temp_dir();
    let base = if cfg!(windows) { temp.join("opencode-plugins") } else { temp };
    if cfg!(windows) {
        sweep(&base, Duration::from_secs(600));
    }
    std::fs::create_dir_all(&base)
        .and_then(|()| opencode_util::temp::TempDir::new_in(&base))
        .map_err(|error| format!("{}: {error}", base.display()))
}

/// Removes the directories in `base` older than `age`, but those whose removal fails: a library another process maps.
/// A directory younger than `age` may be one another process made and has not opened its copy in yet.
fn sweep(base: &Path, age: Duration) {
    let Ok(entries) = std::fs::read_dir(base) else { return };
    for entry in entries.flatten() {
        let old = entry
            .metadata()
            .and_then(|metadata| metadata.modified())
            .is_ok_and(|modified| modified.elapsed().is_ok_and(|elapsed| elapsed > age));
        if old && entry.file_type().is_ok_and(|kind| kind.is_dir()) {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

/// Explains a platform loader refusal, including macOS quarantine and library validation.
pub fn explain_refusal(error: &str, macos: bool, quarantined: bool, source: Option<&Path>) -> String {
    let message = format!("cannot load the library: {error}");
    let lower = error.to_lowercase();
    if !macos {
        return message;
    }
    let file = source.map_or_else(|| "the library".to_owned(), |source| format!("'{}'", source.display()));
    if lower.contains("different team ids") || lower.contains("platform binary") {
        return format!(
            "{message}. This opencode-native is signed with library validation, so macOS lets it load only libraries \
             its own team signed; run a build of opencode-native without it, such as one built from source"
        );
    }
    let refused = ["library load disallowed", "code signature", "not valid for use in process"];
    if !refused.iter().any(|needle| lower.contains(needle)) {
        return message;
    }
    if quarantined {
        return format!(
            "{message}. macOS refused {file} because it carries the quarantine of a download; if you trust it, run \
             `xattr -d com.apple.quarantine {file}` and enable the plugin again"
        );
    }
    format!(
        "{message}. macOS refused the code signature of {file}, which is missing or invalid; if you trust it, sign it \
         ad hoc with `codesign --force --sign - {file}` and enable the plugin again"
    )
}

/// Why a library of ABI `version` is refused.
fn unsupported(version: &str) -> String {
    format!(
        "plugin ABI {version} is not supported: this opencode-native loads ABI {ABI_MAJOR}.x plugins (up to \
         {ABI_MAJOR}.{HOST_MINOR}); rebuild the plugin against opencode-plugin-abi {ABI_MAJOR}"
    )
}

/// What [`HostApi::ctx`] points to: the context of the UI thread's callbacks, and the mailbox that `wake`, `send`,
/// `report` and `stopped` reach from any thread.
struct Shared {
    ctx: RefCell<Ctx>,
    mail: Arc<Mailbox>,
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

/// The host's features as [`HostApi::features`] lists them.
static FEATURES_JSON: std::sync::LazyLock<Vec<u8>> =
    std::sync::LazyLock::new(|| serde_json::to_vec(abi::FEATURES).unwrap_or_else(|_| b"[]".to_vec()));

/// What a host table states as its features ([`HostApi::features`]).
fn features_json() -> &'static [u8] {
    #[cfg(test)]
    if let Some(stated) = super::requests::STATED.get() {
        return stated;
    }
    &FEATURES_JSON
}

/// One plugin instance; dropping it destroys the instance in the plugin.
///
/// The plugin keeps pointers to the host table and its context until `destroy` returns. So they are allocated once
/// and reached only through raw pointers: nothing moves them or borrows them mutably while the plugin may use them,
/// and they are freed after `destroy`. Without a `destroy`, or after a `create` that failed, nothing tells the
/// plugin's threads to stop, so they are never freed.
struct Instance {
    library: Rc<Library>,
    /// The instance's number in this process, as the conformance tap names it.
    tap: u64,
    handle: *mut c_void,
    api: NonNull<HostApi>,
    shared: NonNull<Shared>,
}

/// The table a library gets: the host's whole table, of [`ABI_MAJOR`].[`HOST_MINOR`].
fn host_table(ctx: *mut c_void) -> HostApi {
    HostApi {
        size: size_of::<HostApi>(),
        major: ABI_MAJOR,
        minor: HOST_MINOR,
        ctx,
        call: Some(host_call),
        free: Some(host_free),
        theme_mode: Some(host_theme_mode),
        wake: Some(host_wake),
        send: Some(host_send),
        report: Some(host_report),
        stopped: Some(host_stopped),
        features: Bytes::new(features_json()),
    }
}

thread_local! {
    /// The length of the last draw's list that [`received_list`] did not copy, as it was over one list's bytes.
    static OVER_LIST: Cell<Option<usize>> = const { Cell::new(None) };
}

/// Validate the buffer descriptor before inspecting status or reading bytes. Only successful draw results are
/// subject to display-list limits.
///
/// # Safety
/// As [`received`].
unsafe fn received_list(out: Owned, free: unsafe extern "C" fn(Owned), status: i32) -> Result<Vec<u8>, String> {
    let refused = out.ptr.is_null() || out.len > out.cap || out.len > abi::MAX_BUFFER;
    if status != abi::OK || refused || out.len <= abi::canvas::MAX_BYTES {
        // SAFETY: the caller's.
        return unsafe { received(out, free) };
    }
    // SAFETY: the plugin wrote `len` bytes at `ptr`, at least one, which it owns until `free`.
    let first = unsafe { *out.ptr };
    let len = out.len;
    // SAFETY: the buffer goes back to the library that wrote it, once.
    unsafe { free(out) };
    if first != abi::canvas::VERSION {
        return Err(abi::canvas::Error::Malformed("not a canvas list".into()).to_string());
    }
    OVER_LIST.set(Some(len));
    Ok(Vec::new())
}

/// A call's failure: the plugin panicked or the host refused its answer, which leaves no effect; or the plugin
/// returned an error, which is an answer.
enum Failed {
    Refused(String),
    Returned(String),
}

impl Instance {
    /// Runs setup. `id` is the plugin's ID, or empty while it is not known, so setup may use storage; `expect` is the ID
    /// its manifest must have. What a `quiet` instance asks for is dropped. A manifest the host refuses (bad, empty, or
    /// another ID) leaves no effect, as a setup that panics does: what setup asked for is dropped, its storage writes
    /// are put back, and the instance is destroyed quietly.
    fn create(
        library: &Rc<Library>,
        host: Weak<dyn Host>,
        id: &str,
        options: Option<&str>,
        quiet: bool,
        expect: Option<&str>,
    ) -> Result<(Self, Manifest), String> {
        let wake = Arc::new(Wake::new(host.upgrade().map(|host| host.app().proxy())));
        let ctx = RefCell::new(Ctx {
            host,
            id: id.to_owned(),
            keys: Vec::new(),
            effects: Vec::new(),
            undo: Undo::default(),
            staged: crate::Staged::default(),
            quiet,
            read_only: false,
            owners: None,
        });
        let ui = std::thread::current().id();
        let shared = NonNull::from(Box::leak(Box::new(Shared { ctx, mail: Mailbox::new(id, wake), ui })));
        let table = host_table(shared.as_ptr().cast());
        let api = NonNull::from(Box::leak(Box::new(table)));
        // SAFETY: allocated above, and never written.
        let table = unsafe { api.as_ref() };
        let mut handle = std::ptr::null_mut();
        let mut out = Owned::EMPTY;
        let options = options.unwrap_or_default();
        let tap = conformance::next_instance();
        conformance::tap(Event::Create {
            instance: tap,
            major: table.major,
            minor: table.minor,
            // SAFETY: the host's static list, or nothing.
            features: unsafe { table.features.as_slice() },
            options: options.as_bytes(),
        });
        // SAFETY: the pointers are valid for the call, and the table and its context outlive the instance.
        let (status, bytes) = unsafe {
            let status = crate::contain::catch(|| {
                (library.create)(api.as_ptr(), Bytes::new(options.as_bytes()), &mut handle, &mut out)
            });
            (status.unwrap_or(abi::PANIC), received(out, library.free))
        };
        conformance::tap(Event::Return { status, reply: bytes.as_deref().map_err(String::as_str) });
        // SAFETY: allocated above; only shared references reach it from here on.
        let context = unsafe { shared.as_ref() };
        let text = |bytes: Result<Vec<u8>, String>| match bytes {
            Ok(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
            Err(error) => error,
        };
        if status != abi::OK {
            context.mail.close();
            if status == abi::PANIC {
                // Nothing a setup that panicked asked for happens, nor what its disposal did within the call.
                context.undo();
                return Err(format!("setup panicked: {}", text(bytes)));
            }
            // An error the host cannot read is refused before its status is: nothing of it happens, as for a call.
            if let Err(error) = bytes {
                context.undo();
                return Err(format!("setup returned a bad result: {error}"));
            }
            // What the failed setup and its disposal asked for still happens; its fetches reach no activation.
            context.drain();
            return Err(text(bytes));
        }
        let instance = Self { library: library.clone(), tap, handle, api, shared };
        match bytes.and_then(|bytes| manifest(&bytes, expect)) {
            Ok(manifest) => {
                let mut ctx = context.ctx.borrow_mut();
                ctx.id = manifest.id.clone();
                ctx.keys = manifest.storage.iter().take(crate::storage::KEYS).cloned().collect();
                drop(ctx);
                Ok((instance, manifest))
            }
            Err(error) => {
                instance.refuse();
                Err(error)
            }
        }
    }

    fn shared(&self) -> &Shared {
        // SAFETY: allocated in `create`, freed only in `drop`; reached through shared references only.
        unsafe { self.shared.as_ref() }
    }

    /// Destroys an instance whose answer the host refused: what it asked for is dropped, its storage writes are put
    /// back, and what its disposal asks for is dropped too.
    fn refuse(self) {
        let shared = self.shared();
        shared.undo();
        shared.ctx.borrow_mut().quiet = true;
        drop(self);
    }

    /// Sends `request`. A panic, or an answer the host cannot take, is [`Failed::Refused`]; an error the plugin returned
    /// is [`Failed::Returned`].
    /// Sends one request: the bytes of its result, JSON but for a draw's.
    fn call(&self, request: &Request) -> Result<Vec<u8>, Failed> {
        let json = serde_json::to_vec(request).map_err(|error| Failed::Refused(error.to_string()))?;
        let mut out = Owned::EMPTY;
        conformance::tap(Event::Call { instance: self.tap, request: &json });
        // SAFETY: `handle` is live until drop; `out` goes back to the library's `free`.
        let (status, bytes) = unsafe {
            let status = crate::contain::catch(|| (self.library.call)(self.handle, Bytes::new(&json), &mut out));
            let status = status.unwrap_or(abi::PANIC);
            let bytes = match request {
                Request::Draw { .. } => received_list(out, self.library.free, status),
                _ => received(out, self.library.free),
            };
            (status, bytes)
        };
        conformance::tap(Event::Return { status, reply: bytes.as_deref().map_err(String::as_str) });
        let bytes = bytes.map_err(|error| Failed::Refused(format!("returned a bad result: {error}")))?;
        carry(|crossed| {
            crossed.calls += 1;
            crossed.sent += json.len() as u64;
            crossed.received += bytes.len() as u64;
        });
        match status {
            abi::OK => Ok(bytes),
            abi::PANIC => Err(Failed::Refused(format!("panicked: {}", String::from_utf8_lossy(&bytes)))),
            _ => Err(Failed::Returned(String::from_utf8_lossy(&bytes).into_owned())),
        }
    }
}

/// The manifest `create` answered, checked: its ID.
fn manifest(bytes: &[u8], expect: Option<&str>) -> Result<Manifest, String> {
    let manifest: Manifest =
        serde_json::from_slice(bytes).map_err(|error| format!("setup returned a bad manifest: {error}"))?;
    if manifest.id.is_empty() {
        return Err("setup returned an empty plugin ID".to_owned());
    }
    if let Some(expect) = expect.filter(|expect| *expect != manifest.id) {
        return Err(format!("setup returned plugin ID {}, not {expect}", manifest.id));
    }
    Ok(manifest)
}

impl Drop for Instance {
    fn drop(&mut self) {
        let shared = self.shared();
        // Its threads are told to end before `destroy` revokes what they reach the host through.
        shared.mail.close();
        let Some(destroy) = self.library.destroy else {
            shared.drain();
            return;
        };
        conformance::tap(Event::Destroy { instance: self.tap });
        // SAFETY: `handle` came from `create` and is destroyed once; the plugin catches its own panics.
        let _ = crate::contain::catch(|| unsafe { destroy(self.handle) });
        conformance::tap(Event::Destroyed);
        // What its dispose callbacks asked for still happens, as in process; their fetches reach no activation.
        shared.drain();
        // SAFETY: allocated in `create`; `destroy` has returned, so the plugin holds no pointer into them any more.
        unsafe {
            drop(Box::from_raw(self.api.as_ptr()));
            drop(Box::from_raw(self.shared.as_ptr()));
        }
    }
}

impl Shared {
    /// Queues the effects asked for so far, without an activation.
    fn drain(&self) {
        let mut ctx = self.ctx.borrow_mut();
        let (effects, _) = ctx.take();
        if !ctx.quiet {
            apply(&ctx.host, ctx.id.clone(), Weak::<Guest>::new(), None, effects);
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
    let (shared, checked) = unsafe { (ctx.cast::<Shared>().as_ref(), request.checked()) };
    let request = checked.as_deref().unwrap_or_default();
    let result = catch_unwind(AssertUnwindSafe(|| {
        checked.as_ref().map_err(|error| format!("a bad host request: {error}"))?;
        let ctx = &shared.ok_or("no host context")?.ctx;
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
    carry(|crossed| {
        crossed.received += request.len() as u64;
        crossed.sent += bytes.len() as u64;
    });
    conformance::tap(Event::Host { request, status, reply: &bytes });
    // SAFETY: `out` is valid for writes during the call.
    unsafe { *out = Owned::from_vec(bytes) };
    status
}

/// The mailbox of `ctx`, from any thread.
///
/// # Safety
/// `ctx` is an instance's `Shared`, which lives until `destroy` returns, or null. Only the mailbox, which is `Sync`,
/// is read off the UI thread.
unsafe fn mailbox<'a>(ctx: *mut c_void) -> Option<&'a Mailbox> {
    // SAFETY: as documented.
    (!ctx.is_null()).then(|| unsafe { &**std::ptr::addr_of!((*ctx.cast::<Shared>()).mail) })
}

/// The host's side of [`HostApi::send`], on any thread. Never blocks.
unsafe extern "C" fn host_send(ctx: *mut c_void, key: Bytes, message: Bytes) -> i32 {
    // SAFETY: `ctx` is this instance's `Shared`; `key` and `message` are valid for the call. A descriptor `checked`
    // refuses is not read, and sends nothing.
    let (key, message) = unsafe { (key.checked(), message.checked()) };
    let (Ok(key), Ok(message)) = (key, message) else { return abi::ERROR };
    // SAFETY: as above.
    let sent = catch_unwind(AssertUnwindSafe(|| unsafe {
        mailbox(ctx).map_or(abi::CLOSED, |mail| mail.put_json(key, message))
    }));
    let status = sent.unwrap_or(abi::ERROR);
    conformance::tap(Event::Send { key, message, status });
    status
}

/// The host's side of [`HostApi::report`], on any thread. Only the bytes the mailbox keeps of a report are read.
unsafe extern "C" fn host_report(ctx: *mut c_void, message: Bytes) {
    // SAFETY: as for `host_send`.
    let Ok(message) = (unsafe { message.checked() }) else { return };
    let kept = &message[..message.len().min(crate::mailbox::REPORT + 3)];
    // SAFETY: as for `host_send`.
    let _ = catch_unwind(AssertUnwindSafe(|| unsafe {
        if let Some(mail) = mailbox(ctx) {
            mail.panicked(String::from_utf8_lossy(kept).into_owned());
        }
    }));
    conformance::tap(Event::Report { message: kept });
}

/// The host's side of [`HostApi::stopped`], on any thread.
unsafe extern "C" fn host_stopped(ctx: *mut c_void) -> u32 {
    // SAFETY: as for `host_send`.
    let stopped = catch_unwind(AssertUnwindSafe(|| unsafe { mailbox(ctx).is_none_or(Mailbox::closed) }));
    let answer = u32::from(stopped.unwrap_or(true));
    conformance::tap(Event::Stopped { answer });
    answer
}

/// The host's side of [`HostApi::theme_mode`]. A host that is gone or panics answers dark.
unsafe extern "C" fn host_theme_mode(ctx: *mut c_void) -> u32 {
    // SAFETY: `ctx` is the `Shared` this instance was created with, or null. Another thread gets dark, as from a host
    // that is gone.
    if !unsafe { on_ui_thread(ctx) } {
        conformance::tap(Event::ThemeMode { answer: abi::THEME_DARK });
        return abi::THEME_DARK;
    }
    // SAFETY: `ctx` is the `Shared` this instance was created with, or null.
    let ctx = unsafe { ctx.cast::<Shared>().as_ref().map(|shared| &shared.ctx) };
    let host = ctx.and_then(|ctx| ctx.try_borrow().ok()).and_then(|ctx| ctx.host.upgrade());
    let light = catch_unwind(AssertUnwindSafe(|| host.is_some_and(|host| host.theme_mode() == ThemeMode::Light)));
    let answer = if light.unwrap_or(false) { abi::THEME_LIGHT } else { abi::THEME_DARK };
    conformance::tap(Event::ThemeMode { answer });
    answer
}

/// The host's side of [`HostApi::wake`], on any thread: posts one [`Woken`] until the UI thread handles it.
unsafe extern "C" fn host_wake(ctx: *mut c_void) {
    // SAFETY: `ctx` is this instance's `Shared`, which lives until `destroy` returns.
    if let Some(mail) = unsafe { mailbox(ctx) } {
        mail.wake().post();
    }
    conformance::tap(Event::Wake);
}

/// The host's side of [`HostApi::free`]: by the `ptr` and `cap` the host wrote, whatever `len` says.
unsafe extern "C" fn host_free(owned: Owned) {
    // SAFETY: the host made `owned` with `Owned::from_vec`.
    unsafe { owned.release() };
}

/// Whether `request` is a render, a view, a claim's view, a draw, a layout or a search, which read only, as in
/// process, where they get the host's reads alone.
fn renders(request: &Request) -> bool {
    matches!(
        request,
        Request::RenderFence(_)
            | Request::Render { .. }
            | Request::RenderRoute { .. }
            | Request::View { .. }
            | Request::Draw { .. }
            | Request::Layout { .. }
            | Request::Claim { .. }
            | Request::Search { .. }
    )
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
    /// What a panic revokes at once, before deactivation: the commands' keymap layer and the event and delta
    /// subscriptions.
    revoked: RefCell<Vec<Disposer>>,
    /// The mounted slot claims and routes, which a wake draws again.
    activation: Rc<Activation>,
    /// What its calls hold of the input.
    owners: Rc<crate::Owners>,
    monitor: Rc<crate::contain::Monitor>,
    slot: crate::contain::Slot,
    /// Its manifest has [`abi::Manifest::cancelled`]: it hears of a request its mount's close cancelled.
    cancels: bool,
}

/// Keep failed instances and their libraries alive: calling `destroy` would execute the failed plugin’s disposal
/// callbacks.
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
            false => self.monitor.call(self.slot, "dispose", || drop(instance)).0,
        }
    }

    /// Sends one request. A failed or destroyed plugin is not called; a panic fails it, and its claims draw empty.
    fn request<T: DeserializeOwned>(self: &Rc<Self>, export: &'static str, request: &Request) -> Option<T> {
        self.checked(export, request, |_: &T| Ok(()))
    }

    /// Checks the result before committing the call's effects. Malformed or refused results roll back storage. An
    /// error returned by the plugin or an overrun after a valid result commits effects, then fails the plugin. The
    /// call's own error takes precedence over an overrun.
    fn checked<T: DeserializeOwned>(
        self: &Rc<Self>,
        export: &'static str,
        request: &Request,
        check: impl FnOnce(&T) -> Result<(), String>,
    ) -> Option<T> {
        let decode = |bytes: Vec<u8>| {
            let value = serde_json::from_slice::<T>(&bytes).map_err(|error| error.to_string())?;
            check(&value)?;
            Ok(value)
        };
        self.exchange(export, request, decode)?
    }

    /// [`Guest::checked`] whose result `decode` reads from its bytes: `None` when the plugin was not called, as it
    /// failed before or runs already, else what `decode` made of the result, or `None` when the call failed.
    fn exchange<T>(
        self: &Rc<Self>,
        export: &'static str,
        request: &Request,
        decode: impl FnOnce(Vec<u8>) -> Result<T, String>,
    ) -> Option<Option<T>> {
        if self.failure.borrow().is_some() {
            return None;
        }
        let (result, timed) = {
            let instance = self.instance.borrow();
            let instance = instance.as_ref()?;
            if self.busy.replace(true) {
                log::warn!("plugin {}: {export} called while the plugin runs", self.id);
                return None;
            }
            instance.shared().ctx.borrow_mut().read_only = renders(request);
            // One store snapshot for the whole call, as in process: each read it asks for nests in this one.
            let timed = self.monitor.call(self.slot, export, || {
                // A command or a scroll event that answers the user's input is a handler of it, as in process.
                behave::calling(export, || {
                    let mut result = None;
                    if let Some(host) = self.host.upgrade() {
                        host.read(&mut |_| result = Some(instance.call(request)));
                    }
                    result.unwrap_or_else(|| instance.call(request))
                })
            });
            instance.shared().ctx.borrow_mut().read_only = false;
            self.busy.set(false);
            self.owners.end_call();
            timed
        };
        let (effects, undo) = self.taken();
        let bad = |error: String| Failed::Refused(format!("returned a bad result: {error}"));
        let result = result.and_then(|bytes| decode(bytes).map_err(bad));
        let overrun = timed.overrun.then(|| {
            let limit = self.monitor.limits().overrun.as_millis();
            match timed.cpu {
                Some(cpu) => format!("{export} used {} ms of CPU, over the limit of {limit} ms", cpu.as_millis()),
                None => format!("{export} took {} ms, over the limit of {limit} ms", timed.took.as_millis()),
            }
        });
        let error = match &result {
            Ok(_) => {
                self.apply(effects);
                overrun
            }
            Err(Failed::Returned(error)) => {
                self.apply(effects);
                Some(format!("{export} returned an error: {error}"))
            }
            // A result the host refuses, or a panic: nothing of it happens, and its storage writes go back.
            Err(Failed::Refused(error)) => {
                if let Some(host) = self.host.upgrade() {
                    undo.restore(&*host);
                }
                Some(format!("{export} {error}"))
            }
        };
        crate::budget(&self.host, &self.monitor, &self.id, &timed, error.is_some());
        if let Some(error) = error {
            self.fail(error);
            return Some(None);
        }
        Some(result.ok())
    }

    /// What delivers an event to the handler `to` names, as one call of the plugin, for the owner it is routed to; the
    /// plugin's surfaces draw again after it. A failed or busy plugin passes.
    fn deliver(self: &Rc<Self>, to: To) -> crate::interact::Deliver {
        let guest = Rc::downgrade(self);
        Rc::new(move |_: &dyn Host, owner: &Rc<crate::interact::Owner>, event: &abi::interact::Event| {
            let Some(guest) = guest.upgrade() else { return abi::interact::Handled::Pass };
            // A surface's handler hears which of its mounts the event is for.
            let to = match to {
                To::Surface(surface) => abi::InputTo::Surface { surface, mount: owner.id().cloned() },
                To::Layer(layer) => abi::InputTo::Layer { layer },
            };
            let request = Request::Input { to, event: event.clone() };
            let handled = guest.owners.as_owner(owner, || guest.request("handle", &request));
            if handled.is_some() {
                guest.activation.invalidate();
            }
            handled.unwrap_or(abi::interact::Handled::Pass)
        })
    }

    /// Fails the plugin with `error`: it is not called again, and the host says so once.
    fn fail(&self, error: String) {
        fail(&self.host, &self.id, &self.failure, self.revoked.take(), &self.activation, error);
    }

    /// Sends a request to a handler, then, if it ran, invalidates the claims, whose state it may have changed.
    fn handle(self: &Rc<Self>, export: &'static str, request: &Request) {
        // A handler answers `null`: anything else is a contract break.
        if self.request::<()>(export, request).is_some() {
            self.activation.invalidate();
        }
    }

    /// Runs a command, which answers `"pass"` to decline the key that ran it and `null` to take it. A call that
    /// failed took its key.
    fn command(self: &Rc<Self>, request: &Request) -> abi::interact::Handled {
        let answer = self.checked("run-command", request, |answer: &Option<String>| match answer.as_deref() {
            None | Some("pass") => Ok(()),
            Some(other) => Err(format!("a command answered {other:?}, where null or \"pass\" is")),
        });
        let Some(answer) = answer else { return abi::interact::Handled::Consume };
        self.activation.invalidate();
        match answer {
            Some(_) => abi::interact::Handled::Pass,
            None => abi::interact::Handled::Consume,
        }
    }

    /// What the instance asked for since it was last taken.
    fn taken(&self) -> (Vec<Effect>, Undo) {
        let instance = self.instance.borrow();
        instance.as_ref().map(|instance| instance.shared().ctx.borrow_mut().take()).unwrap_or_default()
    }

    /// Queues the effects of a call on the effect queue, as the host would for a built-in.
    fn apply(self: &Rc<Self>, effects: Vec<Effect>) {
        let guest: Weak<dyn Answers> = Rc::downgrade(self) as Weak<Guest>;
        apply(&self.host, self.id.clone(), guest, Some(self.generation), effects);
    }
}

impl Answers for Guest {
    fn live(&self) -> bool {
        self.instance.borrow().is_some() && !self.activation.disposed()
    }

    fn running(&self) -> bool {
        self.instance.borrow().is_some() && self.failure.borrow().is_none()
    }

    fn owner(&self) -> Weak<dyn Host> {
        self.host.clone()
    }

    fn answer(self: Rc<Self>, request: Request) {
        self.handle("on-reply", &request);
    }

    fn release(&self, request: abi::RequestId) {
        self.activation.cancel_timer(request);
    }

    fn activation(&self) -> Option<Rc<Activation>> {
        Some(self.activation.clone())
    }

    fn cancel(self: Rc<Self>, request: abi::RequestId) {
        if self.cancels && self.live() {
            self.handle("on-cancelled", &Request::Cancelled { id: request });
        }
    }

    fn cancels(&self) -> bool {
        self.cancels
    }
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
    guest.activation.commands(&manifest.commands);
    let commands: Vec<(abi::Scope, TuiCommand)> = manifest
        .commands
        .iter()
        .map(|command| {
            let guest = guest.clone();
            let name = command.name.clone();
            let enabled = crate::command_enabled(&guest.activation, &name);
            let run = tui_command(&manifest.id, command, enabled, move |input| {
                guest.command(&Request::Command { name: name.clone(), input: input.map(str::to_owned) })
            });
            (command.scope.clone(), run)
        })
        .collect();
    let (layers, scoped) = route::split(commands);
    for layer in layers.into_iter().filter(|layer| !layer.commands.is_empty()) {
        match setup.host().keymap().layer(layer) {
            Ok(disposer) => guest.revoked.borrow_mut().push(disposer),
            Err(error) => log::error!("plugin {} keymap layer: {error}", setup.id()),
        }
    }
    {
        let guest = guest.clone();
        setup.on_dispose(move || guest.revoked.take().into_iter().for_each(Disposer::dispose));
    }
    // A fence key that goes reaches the plugin once the event that freed its block is done.
    let gone = manifest.fence_gone.then(|| {
        let guest = Rc::downgrade(guest);
        Rc::new(move |key| {
            let guest = guest.clone();
            if let Some(host) = guest.upgrade().map(|guest| guest.host.clone()) {
                defer(&host, move |_| {
                    if let Some(guest) = guest.upgrade() {
                        guest.request::<()>("fence-gone", &Request::FenceGone { key });
                    }
                });
            }
        }) as crate::node::Gone
    });
    for (index, language) in manifest.fences.iter().enumerate() {
        // A fence renders through `RenderFence`, which names the registration, as the host may have normalized the
        // language the block has.
        let (guest, fences) = (guest.clone(), Fences::new(gone.clone()));
        setup.code_block(language.clone(), move |block, theme| {
            fences.render(block, theme, |fence| {
                let request = Request::RenderFence(abi::RenderFence { fence, index: Some(index) });
                guest.request("render-fence", &request).unwrap_or(Fenced::Code)
            })
        });
    }
    for (claim, slot) in manifest.slots.iter().enumerate() {
        let (guest, activation) = (guest.clone(), guest.activation.clone());
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
    }
    for (handler, types) in manifest.events.iter().enumerate() {
        let (called, kinds) = (guest.clone(), types.clone());
        let subscription = setup.host().on_event(
            types,
            Rc::new(move |event| {
                if kinds.iter().any(|kind| kind == event.tag()) {
                    called.handle("on-event", &Request::Event { handler, event: Box::new(event.clone()) });
                }
            }),
        );
        guest.revoked.borrow_mut().extend(subscription);
    }
    if manifest.deltas {
        let called = guest.clone();
        let subscription = setup.host().on_deltas(Rc::new(move |events| {
            // Before the copy: a failed plugin costs nothing until its subscription goes.
            if called.failure.borrow().is_none() {
                called.handle("on-deltas", &Request::Deltas { events: events.to_vec() });
            }
        }));
        guest.revoked.borrow_mut().extend(subscription);
    }
    for name in &manifest.routes {
        let (guest, request, activation) = (guest.clone(), name.clone(), guest.activation.clone());
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
    }
    // the searches, and the layers of setup, each with its own handler, the activation's.
    for name in &manifest.searches {
        let (guest, searched) = (guest.clone(), name.clone());
        let call: crate::SearchCall = Rc::new(move |_: &dyn Host, query: &str, options: &[abi::SelectOption]| {
            let request =
                Request::Search { name: searched.clone(), query: query.to_owned(), options: options.to_vec() };
            guest.request("search", &request)
        });
        setup.registration.searches.push((name.clone(), call));
    }
    for (index, layer) in manifest.layers.iter().enumerate() {
        let deliver = guest.deliver(To::Layer(index));
        guest.owners.input.register(&**setup.host(), std::slice::from_ref(layer), &deliver);
    }
    // the surfaces, whose views run through `View`.
    for (index, claim) in manifest.surfaces.iter().enumerate() {
        let at: v2::Place = (&claim.place).into();
        // A route's commands are bound to the mount they run for, as in process: what they ask for is that mount's.
        let commands: surface::Commands = match &at {
            v2::Place::Route(name) => {
                let routed = routed(manifest, name);
                let guest = guest.clone();
                Rc::new(move |alive: &Weak<()>| {
                    let command = |command: &abi::Command| {
                        let (plugin, alive, name) = (guest.id.clone(), alive.clone(), command.name.clone());
                        let guest = guest.clone();
                        let enabled = crate::command_enabled(&guest.activation, &name);
                        tui_command(&plugin, command, enabled, move |input| {
                            let request = Request::Command { name: name.clone(), input: input.map(str::to_owned) };
                            guest.owners.owned_by(&alive, || guest.command(&request))
                        })
                    };
                    routed.iter().map(command).collect()
                })
            }
            v2::Place::Slot(_) | v2::Place::Panel(_) | v2::Place::Overlay(_) | v2::Place::Dialog(_) => {
                Rc::new(|_| Vec::new())
            }
        };
        let failing = Rc::downgrade(guest);
        let fail: surface::Fail = Rc::new(move |error| {
            if let Some(guest) = failing.upgrade() {
                guest.fail(error);
            }
        });
        // `layout` and the scroll handler run as calls of the library, as its view does.
        let place =
            surface::Place { name: claim.name.clone(), at, palette: claim.palette, notify: claim.notify.clone() };
        let calls = behave::Calls {
            plugin: setup.id().to_owned(),
            layout: claim.layout.then(|| {
                let guest = Rc::downgrade(guest);
                Rc::new(move |geometry: &v2::Geometry| {
                    let request = Request::Layout { surface: index, geometry: geometry.clone() };
                    guest.upgrade().and_then(|guest| guest.request("layout", &request)).unwrap_or_default()
                }) as v2::LayoutFn
            }),
            ended: Some({
                let guest = Rc::downgrade(guest);
                Rc::new(move || {
                    guest.upgrade().is_none_or(|guest| guest.failure.borrow().is_some() || guest.activation.disposed())
                }) as Rc<dyn Fn() -> bool>
            }),
        };
        let input = Rc::new(surface::Input {
            plugin: manifest.id.clone(),
            deliver: claim.handler.then(|| guest.deliver(To::Surface(index))),
            layers: claim.layers.clone(),
            panel: matches!(place.at, v2::Place::Panel(_)),
            mounts: claim.mounts,
            activation: guest.owners.input.clone(),
        });
        let remote = Rc::new(Remote { guest: guest.clone(), index, draw: claim.draw });
        setup.surface(place, remote, commands, fail, calls, &guest.owners, input);
    }
    // the renderer claims, whose views run through `Claim`.
    for (index, entry) in manifest.claims.iter().enumerate() {
        setup.renderer_claim(entry.clone(), Rc::new(RemoteClaim { guest: guest.clone(), index }), &guest.owners);
    }
    // what the plugin's threads send runs `Message`, one call each, when its manifest says it takes messages; a
    // thread's panic fails the plugin, once.
    if !manifest.messages {
        guest.activation.mailbox.refuse_messages();
    }
    let (delivered, failing) = (Rc::downgrade(guest), Rc::downgrade(guest));
    guest.activation.on_mail(
        Rc::new(move |message| {
            if let (Some(guest), Message::Json(json)) = (delivered.upgrade(), message) {
                guest.handle("update", &Request::Message { message: json });
            }
        }),
        Rc::new(move |error| {
            if let Some(guest) = failing.upgrade() {
                guest.fail(error);
            }
        }),
    );
}

/// A surface's view in a library, through [`Request::View`].
struct Remote {
    guest: Rc<Guest>,
    index: usize,
    /// The surface has a draw ([`abi::SurfaceClaim::draw`]).
    draw: bool,
}

impl Viewer for Remote {
    fn view(&self, _: &dyn Host, viewing: Viewing<'_>) -> Option<Viewed> {
        // The library numbers its content after `next`, from the handle the host would give next, one each.
        let next = surface::next_content() - 1;
        let (mount, input, kept) = (viewing.mount.clone(), viewing.input.clone(), viewing.kept);
        let request = Request::View { surface: self.index, mount, input, next };
        // What the view reads of the input is its mount's.
        let reply: abi::ViewReply = self.guest.owners.as_owner(viewing.owner, || {
            self.guest.checked("view", &request, |reply: &abi::ViewReply| {
                let numbered = reply.content.iter().enumerate().all(|(index, (handle, _))| {
                    (index as u64).checked_add(1).and_then(|step| next.checked_add(step)) == Some(handle.0)
                });
                if !numbered {
                    return Err("content handles that do not follow the host's".to_owned());
                }
                // A memo table holds a value for each subtree the view built or kept by key, and no more.
                let keyed = keyed(&reply.node, kept);
                match reply.memo <= keyed {
                    true => Ok(()),
                    false => Err(format!("a memo table of {} values for a tree of {keyed} keyed nodes", reply.memo)),
                }
            })
        })?;
        surface::took_content(next + 1, reply.content.len() as u64);
        for (handle, bytes) in reply.content {
            (viewing.give)(handle, bytes.0);
        }
        reply.released.into_iter().for_each(|handle| (viewing.release)(handle));
        Some(Viewed { node: Some(reply.node), memo: Some(reply.memo), stand_in: false })
    }

    fn draws(&self) -> bool {
        self.draw
    }

    fn draw(
        &self,
        _: &dyn Host,
        owner: &Rc<crate::interact::Owner>,
        mount: &v2::MountId,
        canvas: &str,
        frame: v2::Frame,
    ) -> Option<Option<crate::canvas::Drawn>> {
        let request = Request::Draw { surface: self.index, mount: mount.clone(), canvas: canvas.to_owned(), frame };
        // The result is the list's bytes as they are, which the canvas checks; none keeps the list. What the draw reads
        // of the input is its mount's, as a view's is.
        OVER_LIST.set(None);
        let drawn = self.guest.owners.as_owner(owner, || self.guest.exchange("draw", &request, Ok))?;
        if let (Some(len), Some(_)) = (OVER_LIST.take(), &drawn) {
            return Some(Some(Err(abi::canvas::Error::Over(abi::canvas::Limit::Bytes(len)))));
        }
        Some(drawn.filter(|bytes| !bytes.is_empty()).map(Ok))
    }

    fn forget(&self, _: &dyn Host, mount: &v2::MountId, _: Option<String>) {
        // Once the event that ended the mount is done, so the plugin is never entered from within a call of its own.
        let (guest, mount) = (Rc::downgrade(&self.guest), mount.clone());
        defer(&self.guest.host, move |_| {
            if let Some(guest) = guest.upgrade() {
                guest.request::<()>("unmount", &Request::Unmount { mount });
            }
        });
    }
}

/// A renderer claim's view in a library, through [`Request::Claim`]. An overrun fails the plugin in its guest, so
/// every call that does not return is a failure here.
struct RemoteClaim {
    guest: Rc<Guest>,
    index: usize,
}

impl crate::claim::Viewer for RemoteClaim {
    fn view(&self, _: &dyn Host, viewing: Viewing<'_>, part: &abi::claim::Part) -> crate::claim::Viewed {
        let next = surface::next_content() - 1;
        let request = Request::Claim {
            claim: self.index,
            mount: viewing.mount.clone(),
            input: viewing.input.clone(),
            part: part.clone(),
            next,
        };
        let checked = self.guest.checked("view", &request, |reply: &abi::claim::Reply| {
            let numbered = reply.content.iter().enumerate().all(|(index, (handle, _))| {
                (index as u64).checked_add(1).and_then(|step| next.checked_add(step)) == Some(handle.0)
            });
            if !numbered {
                return Err("content handles that do not follow the host's".to_owned());
            }
            // A decline drops only what its view staged: the table holds no more than the last view left.
            let bound = reply.node.as_ref().map_or(viewing.held, |node| keyed(node, viewing.kept));
            match reply.memo <= bound {
                true => Ok(()),
                false => Err(format!("a memo table of {} values where {bound} may stay", reply.memo)),
            }
        });
        let Some(reply) = checked else { return crate::claim::Viewed::Failed };
        surface::took_content(next + 1, reply.content.len() as u64);
        for (handle, bytes) in reply.content {
            (viewing.give)(handle, bytes.0);
        }
        reply.released.into_iter().for_each(|handle| (viewing.release)(handle));
        crate::claim::Viewed::Returned(reply.node.map(Box::new), Some(reply.memo))
    }

    fn forget(&self, _: &dyn Host, mount: &v2::MountId) {
        let (guest, mount) = (Rc::downgrade(&self.guest), mount.clone());
        defer(&self.guest.host, move |_| {
            if let Some(guest) = guest.upgrade() {
                guest.request::<()>("unmount", &Request::Unmount { mount });
            }
        });
    }
}

/// The definition of a built-in whose `create` is `create`, wired through the byte shims of the C ABI as a loaded
/// library is, for the tests that prove a built-in on that path (`Loopback`).
#[doc(hidden)]
pub fn loopback(host: &Rc<dyn Host>, entries: abi::runtime::Loopback) -> Result<(Definition, ErrorFn), String> {
    loopback_with(host, entries.create, entries.describe)
}

/// [`loopback`] for a plugin that describes itself (`export_plugin!(@loopback_described ..)`), as every library does:
/// the host learns its ID without a `setup`.
#[doc(hidden)]
pub fn loopback_described(
    host: &Rc<dyn Host>,
    (create, describe): (
        unsafe extern "C" fn(*const HostApi, Bytes, *mut *mut c_void, *mut Owned) -> i32,
        unsafe extern "C" fn(*mut Owned) -> i32,
    ),
) -> Result<(Definition, ErrorFn), String> {
    loopback_with(host, create, describe)
}

fn loopback_with(
    _host: &Rc<dyn Host>,
    create: unsafe extern "C" fn(*const HostApi, Bytes, *mut *mut c_void, *mut Owned) -> i32,
    describe: unsafe extern "C" fn(*mut Owned) -> i32,
) -> Result<(Definition, ErrorFn), String> {
    let api = sdk_table(create, describe);
    // The shims would silence the process's panic hook on their first `create`, as a plugin's own std does; the process
    // here keeps its own. Taking and setting the hook around each load would race other threads' loads.
    abi::runtime::keep_panic_hook();
    Library::from_table(&api).and_then(|library| define(library, None))
}

fn sdk_table(
    create: unsafe extern "C" fn(*const HostApi, Bytes, *mut *mut c_void, *mut Owned) -> i32,
    describe: unsafe extern "C" fn(*mut Owned) -> i32,
) -> PluginApi {
    PluginApi {
        size: size_of::<PluginApi>(),
        major: ABI_MAJOR,
        minor: ABI_MINOR,
        requires_minor: 0,
        create: Some(create),
        call: Some(abi::runtime::call),
        destroy: Some(abi::runtime::destroy),
        free: Some(abi::runtime::free),
        describe: Some(describe),
    }
}

/// The definition of the plugin whose table `api` is, as a library's: the conformance tests' reference and the plugin
/// that answers from a transcript.
#[cfg(test)]
pub(crate) fn from_api(
    _host: &Rc<dyn Host>,
    api: *const PluginApi,
    options: Option<&str>,
) -> Result<(Definition, ErrorFn), String> {
    // As in `loopback`: the process keeps its panic hook.
    abi::runtime::keep_panic_hook();
    Library::from_table(api).and_then(|library| define(library, options))
}

/// What the host makes of the table `api`: what the plugin says about itself, or why the host refuses it (the version
/// gate).
#[cfg(test)]
pub(crate) fn gate(api: *const PluginApi) -> Result<abi::Metadata, String> {
    Library::from_table(api)?.compatible().map(|(_, metadata)| metadata)
}

/// Plugin `plugin` through the byte shims of the C ABI, as a loaded library runs it: the SDK's own `create`, `call`,
/// `destroy`, `free` and `describe`, with JSON both ways ([`crate::Builtin::Abi`]). The definition is made on the first
/// activation, when the host is known.
pub fn carried(plugin: abi::Plugin) -> Definition {
    let defined: Rc<RefCell<Option<(Definition, ErrorFn)>>> = Rc::default();
    let error: ErrorFn = {
        let defined = defined.clone();
        Rc::new(move || defined.borrow().as_ref().and_then(|(_, error)| error()))
    };
    let mut definition = Definition::fallible(plugin.id, move |setup: &mut Setup<'_>| {
        let made = defined.borrow().as_ref().map(|(definition, _)| definition.clone());
        let inner = match made {
            Some(inner) => inner,
            None => {
                // As in `loopback`: the process keeps its panic hook.
                abi::runtime::keep_panic_hook();
                let made = define(Library::carried(plugin), None)?;
                defined.borrow_mut().insert(made).0.clone()
            }
        };
        (inner.setup)(setup)
    });
    definition.error = Some(error);
    definition
}

#[cfg(test)]
mod tests;
