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
//! that finds the proxy's queue full is delivered once it has room, so the last one is never lost. From ABI 2.0 its
//! threads `send` messages to its mailbox ([`crate::mailbox`]), which the UI thread hands to the plugin one call each.
//!
//! Versions follow the ABI's rules. The host serves ABI 2.0 to a library that exports [`abi::ENTRY`], and ABI 1.4 to
//! one that exports only [`abi::ENTRY_V1`], as before. Only a major the host does not serve, a too-short table, a
//! plugin that requires a newer host minor version, or one that requires a feature the host lacks is refused. Entries
//! past the plugin's table size are absent.
//!
//! What the host takes from a plugin is decoded before anything of the call is applied: a buffer it cannot decode,
//! or one that breaks the contract, fails the plugin and leaves no effect, as a panic does (4.14, `no-effects`).
//!
//! Every crossing of the C ABI on the UI thread is told to the conformance tap ([`crate::conformance`]), which records
//! golden transcripts and checks the C ABI's protocol in the tests; it costs one thread-local read when nobody listens.
//!
//! Each build is copied to a file of its own before it is opened, because the platform loader returns the
//! library already open at a path, and a rebuilt library is often written over the old one. Libraries are never
//! unloaded: a running plugin's code must outlive every pointer into it, and a reload leaks one library.

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
    self as abi, ABI_MAJOR, ABI_MINOR, Bytes, Fenced, HostApi, HostRequest, Line, Manifest, Owned, PluginApi,
    PluginApiV1_0, Request, V1_MINOR, v2,
};
use opencode_ui::keymap::{KeymapLayer, TuiCommand};
use opencode_util::dl;
use opentui::keymap::Disposer;
use opentui::prelude::*;
use serde::de::DeserializeOwned;

use super::Backend;
use crate::activation::{Activation, Drawn, Wake};
use crate::behave;
use crate::conformance::{self, Event};
use crate::mailbox::Mailbox;
use crate::node::{Fences, MountFn, Scroll, SlotRender, lines_widget, theme_color};
use crate::slot::placement;
use crate::surface::{self, Viewed, Viewer, Viewing};
use crate::{Claimed, Definition, ErrorFn, Host, Setup, Undo, defer, fail, next_request, route, tui_command};

/// The host's minor version of the current major: it serves every entry and request up to it.
pub const HOST_MINOR: u32 = ABI_MINOR;

/// The minor a host that serves ABI 1 up to `v1` serves a library of `major`; `None` for a major it does not serve.
/// The host serves [`V1_MINOR`]; a test stands in for an older host with another.
fn served(major: u32, v1: u32) -> Option<u32> {
    match major {
        ABI_MAJOR => Some(HOST_MINOR),
        1 => Some(v1),
        _ => None,
    }
}

/// What crossed the C ABI on this thread, counted outside any plugin and any mount (4.14, `work`).
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
    CROSSED.with(|cell| {
        let mut crossed = cell.get();
        f(&mut crossed);
        cell.set(crossed);
    });
}

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
        let library = Library::open(library, None, V1_MINOR)?;
        let metadata = library.compatible()?;
        Ok(Inspected { major: library.major, minor: library.minor, version: metadata.version })
    }
}

impl Backend for Native {
    fn load(
        &self,
        host: &Rc<dyn Host>,
        library: &[u8],
        source: &Path,
        options: Option<&str>,
    ) -> Result<(Definition, ErrorFn), String> {
        define(host, Library::open(library, Some(source), V1_MINOR)?, options)
    }
}

/// The definition of the plugin `library` holds; setup runs on each activation.
fn define(host: &Rc<dyn Host>, library: Library, options: Option<&str>) -> Result<(Definition, ErrorFn), String> {
    let library = Rc::new(library);
    let metadata = library.compatible()?;
    if let Some(version) = &metadata.version {
        log::info!("plugin library version {version}, ABI {}.{}", library.major, library.minor);
    }
    let options = options.map(str::to_owned);
    // Setup runs on each activation only, so a disabled plugin starts nothing. A plugin without `describe`
    // (ABI 1.0) tells its ID only from setup, so for it setup runs once now, and that instance is destroyed.
    let id = match metadata.id {
        Some(id) => id,
        // That instance only tells the ID: nothing it asks for happens.
        None => Instance::create(&library, Rc::downgrade(host), "", options.as_deref(), true, None)?.1.id,
    };
    // The failure of the running instance, a panic, in a cell of each activation's own: a new activation leaves an old
    // one's failure as it was.
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

/// A plugin's `create`: a library's entry, or the SDK's shim of a plugin carried in process ([`carried`]).
type CreateFn = Rc<dyn Fn(*const HostApi, Bytes, *mut *mut c_void, *mut Owned) -> i32>;

/// An open library's entries. The library stays loaded for the life of the process.
struct Library {
    major: u32,
    minor: u32,
    /// The minor the host serves it, of its major.
    served: u32,
    create: CreateFn,
    call: unsafe extern "C" fn(*mut c_void, Bytes, *mut Owned) -> i32,
    destroy: Option<unsafe extern "C" fn(*mut c_void)>,
    free: unsafe extern "C" fn(Owned),
    describe: Option<Rc<dyn Fn(*mut Owned) -> i32>>,
}

impl Library {
    /// `plugin` through the SDK's own shims, as a library of the current ABI exports them.
    fn carried(plugin: abi::Plugin) -> Self {
        let id = plugin.id;
        conformance::tap(Event::Open {
            entry: ABI_MAJOR,
            major: ABI_MAJOR,
            minor: ABI_MINOR,
            requires_minor: 0,
            served: HOST_MINOR,
        });
        Self {
            major: ABI_MAJOR,
            minor: ABI_MINOR,
            served: HOST_MINOR,
            // SAFETY: the host calls it as `PluginApi::create` documents.
            create: Rc::new(move |host, options, instance, out| unsafe {
                abi::runtime::create(plugin.id, plugin.setup, host, options, instance, out)
            }),
            call: abi::runtime::call,
            destroy: Some(abi::runtime::destroy),
            free: abi::runtime::free,
            // SAFETY: the host passes an `out` valid for writes.
            describe: Some(Rc::new(move |out| unsafe { abi::runtime::describe(id, "", &[], out) })),
        }
    }

    /// Opens a library, `bytes` read from the file `source`, through a copy, so a new build can replace the file:
    /// through [`abi::ENTRY`] as ABI 2, else through [`abi::ENTRY_V1`] as ABI 1, for a host that serves ABI 1 up to
    /// `v1`. On macOS the copy carries the quarantine of the file, so the system checks it as it would the file (review
    /// carbon-6).
    fn open(bytes: &[u8], source: Option<&Path>, v1: u32) -> Result<Self, String> {
        let dir = staging()?;
        let file = dir.path().join(format!("plugin.{}", std::env::consts::DLL_EXTENSION));
        std::fs::write(&file, bytes).map_err(|error| format!("{}: {error}", file.display()))?;
        let quarantined = match source {
            Some(source) if cfg!(target_os = "macos") => keep_quarantine(source, &file)?,
            _ => false,
        };
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
        // SAFETY: both entries have type `EntryFn`, in every plugin of their major version.
        let entry = unsafe { library.symbol::<abi::EntryFn>(abi::ENTRY) }
            .map(|entry| (entry, ABI_MAJOR))
            .or_else(|_| unsafe { library.symbol::<abi::EntryFn>(abi::ENTRY_V1) }.map(|entry| (entry, 1)))
            .map_err(|_| format!("not an opencode-native plugin: no `{}` symbol", abi::ENTRY))?;
        // SAFETY: as above; the table it returns lives as long as the library.
        let opened = Self::from_table(unsafe { (entry.0)() }, entry.1, v1)?;
        library.leak();
        Ok(opened)
    }

    /// Checks the table `api` points to, found through the entry of major `entry`, for a host that serves ABI 1 up to
    /// `v1`, and takes its entries. Nothing past the `size` it declares is read.
    fn from_table(api: *const PluginApi, entry: u32, v1: u32) -> Result<Self, String> {
        let symbol = if entry == 1 { abi::ENTRY_V1 } else { abi::ENTRY };
        if api.is_null() {
            return Err(format!("`{symbol}` returned no table"));
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
        let Some(host_minor) = served(major, v1).filter(|_| major == entry) else {
            return Err(format!(
                "plugin ABI {major}.{minor} is not supported: this opencode-native loads ABI {ABI_MAJOR}.x plugins \
                 (up to {ABI_MAJOR}.{HOST_MINOR}) and ABI 1.x plugins (up to 1.{v1}); rebuild the plugin \
                 against opencode-plugin-abi {ABI_MAJOR}"
            ));
        };
        if size < size_of::<PluginApiV1_0>() {
            return Err(format!("plugin table is {size} bytes, shorter than the ABI {major}.0 core"));
        }
        // SAFETY: the 1.0 core is within `size`; its callbacks are nullable.
        let core = unsafe { &*api.cast::<PluginApiV1_0>() };
        if core.requires_minor > host_minor {
            return Err(format!(
                "plugin needs host ABI {major}.{} or newer, this opencode-native has {major}.{host_minor}; \
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
        // SAFETY: the host calls them as `PluginApi::create` and `PluginApi::describe` document.
        let create: CreateFn =
            Rc::new(move |host, options, instance, out| unsafe { create(host, options, instance, out) });
        let describe =
            describe.map(|describe| Rc::new(move |out| unsafe { describe(out) }) as Rc<dyn Fn(*mut Owned) -> i32>);
        let requires_minor = core.requires_minor;
        conformance::tap(Event::Open { entry, major, minor, requires_minor, served: host_minor });
        Ok(Self { major, minor, served: host_minor, create, call, destroy: core.destroy, free, describe })
    }

    /// What the plugin says about itself, when it has `describe` (1.1), checked against what this host offers: a 2.x
    /// library whose `describe` fails or answers what the host cannot read, or that requires a feature the host lacks,
    /// is refused before any setup. A 1.x library's metadata is a hint, as it always was.
    fn compatible(&self) -> Result<abi::Metadata, String> {
        let Some(describe) = &self.describe else { return Ok(abi::Metadata::default()) };
        let mut out = Owned::EMPTY;
        conformance::tap(Event::Describe);
        let status = describe(&mut out);
        // SAFETY: `describe` wrote `out`, which goes back to `free`.
        let received = unsafe { received(out, self.free) };
        conformance::tap(Event::Return { status, reply: received.as_deref().map_err(String::as_str) });
        let metadata = received.and_then(|bytes| match status {
            abi::OK => serde_json::from_slice::<abi::Metadata>(&bytes).map_err(|error| error.to_string()),
            _ => Err(String::from_utf8_lossy(&bytes).into_owned()),
        });
        if self.major < 2 {
            return Ok(abi::Metadata { requires: Vec::new(), ..metadata.unwrap_or_default() });
        }
        let metadata = metadata.map_err(|error| format!("plugin describe failed: {error}"))?;
        if let Some(feature) = metadata.requires.iter().find(|feature| !abi::FEATURES.contains(&feature.as_str())) {
            return Err(format!(
                "plugin requires the feature {feature}, which this opencode-native (ABI {ABI_MAJOR}.{HOST_MINOR}) \
                 lacks; update opencode-native"
            ));
        }
        Ok(metadata)
    }
}

/// The directory a library's copy is opened from: one this process makes, owner-only, so nobody else can place or swap
/// the file in it. Windows cannot remove a mapped library, so there the copies go under `opencode-plugins` in the temp
/// directory, and each open removes the directories there that no process maps any more (review carbon-6).
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

/// Puts the quarantine of `source`, which macOS gives a download, on its copy `copy`; whether there was one. A copy
/// that cannot carry it is not opened.
fn keep_quarantine(source: &Path, copy: &Path) -> Result<bool, String> {
    const XATTR: &str = "/usr/bin/xattr";
    const QUARANTINE: &str = "com.apple.quarantine";
    let read = std::process::Command::new(XATTR)
        .args(["-p", QUARANTINE])
        .arg(source)
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .map_err(|error| format!("{XATTR}: {error}"))?;
    if !read.status.success() {
        return Ok(false);
    }
    let value = String::from_utf8_lossy(&read.stdout).trim_end_matches('\n').to_owned();
    let written = std::process::Command::new(XATTR).args(["-w", QUARANTINE, &value]).arg(copy).status();
    if !written.is_ok_and(|status| status.success()) {
        return Err(format!("cannot keep the quarantine of {} on the copy the host opens", source.display()));
    }
    Ok(true)
}

/// Why the system refused to open a library, in words a user can act on (4.5, reviews F12, bigboi-13, carbon-6), on
/// macOS or elsewhere. On macOS a client signed with library validation refuses a library another team signed;
/// `dyld` refuses one whose signature is missing or invalid, and one that carries the quarantine of a download
/// (`quarantined`: the host put it on the copy, from the file `source`), with the same words.
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

/// Whether a table of `size` bytes holds an entry of type `T` at `offset`.
fn has<T>(size: usize, offset: usize) -> bool {
    size >= offset + size_of::<T>()
}

/// What the host's callbacks see: the plugin's identity, its storage keys, and what the running call asked for:
/// effects that wait for it to return, and the storage it wrote, which a panic puts back.
pub(crate) struct Ctx {
    pub(crate) host: Weak<dyn Host>,
    pub(crate) id: String,
    pub(crate) keys: Vec<String>,
    pub(crate) effects: Vec<Effect>,
    pub(crate) undo: Undo,
    /// What the call's verbs staged for its later ones.
    staged: crate::Staged,
    /// What it asks for is dropped.
    quiet: bool,
    /// A render of 1.4 on or a view runs: it may read, and ask for nothing.
    pub(crate) read_only: bool,
    /// What the calls hold of the input (P2), from the end of setup: setup itself has no mount and no owner.
    pub(crate) owners: Option<Rc<crate::Owners>>,
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

pub(crate) enum Effect {
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
    // 2.0 (P3): a scroll verb, bound to the mount it names when the plugin asked.
    Scroll(Box<dyn FnOnce()>),
    /// An input verb of P2, its owner taken as it was asked for.
    Input(crate::Effect),
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

/// The table a library of `major` gets, of `minor`: ABI 1.x's for a 1.x library, which ends before the entries of 2.0,
/// and the whole 2.0 table for a 2.x one.
fn host_table(major: u32, minor: u32, ctx: *mut c_void) -> HostApi {
    let v2 = major >= 2;
    HostApi {
        size: if v2 { size_of::<HostApi>() } else { offset_of!(HostApi, send) },
        major,
        minor,
        ctx,
        call: Some(host_call),
        free: Some(host_free),
        theme_mode: Some(host_theme_mode),
        wake: Some(host_wake),
        send: v2.then_some(host_send as unsafe extern "C" fn(*mut c_void, Bytes, Bytes) -> i32),
        report: v2.then_some(host_report as unsafe extern "C" fn(*mut c_void, Bytes)),
        stopped: v2.then_some(host_stopped as unsafe extern "C" fn(*mut c_void) -> u32),
        features: if v2 { Bytes::new(&FEATURES_JSON) } else { Bytes::new(&[]) },
    }
}

/// The largest buffer the host takes from a plugin.
const MAX_BUFFER: usize = 256 << 20;

/// The bytes of a buffer a plugin returned, which goes back to its `free` whatever it holds. A descriptor that cannot
/// describe a buffer the plugin allocated (a null pointer with a length, a length past the capacity) or one over
/// [`MAX_BUFFER`] is refused before anything is read through it.
///
/// # Safety
/// `out` was written by the plugin whose `free` this is.
unsafe fn received(out: Owned, free: unsafe extern "C" fn(Owned)) -> Result<Vec<u8>, String> {
    let bytes = match (out.ptr.is_null(), out.len) {
        (true, 0) => Ok(Vec::new()),
        (true, len) => Err(format!("a null buffer of {len} bytes")),
        (false, len) if len > out.cap => Err(format!("a buffer of {len} bytes in {} of room", out.cap)),
        (false, len) if len > MAX_BUFFER => Err(format!("a buffer of {len} bytes, over {MAX_BUFFER}")),
        // SAFETY: the plugin wrote `len` bytes at `ptr`, which it owns until `free`.
        (false, _) => Ok(unsafe { out.to_vec() }),
    };
    // SAFETY: the buffer goes back to the library that wrote it, once.
    unsafe { free(out) };
    bytes
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
        let table = host_table(library.major, library.served, shared.as_ptr().cast());
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
            // What the failed setup and its disposal asked for still happens; its fetches reach no activation.
            context.drain();
            return Err(text(bytes));
        }
        let instance = Self { library: library.clone(), tap, handle, api, shared };
        match bytes.and_then(|bytes| manifest(&bytes, library.major, expect)) {
            Ok(manifest) => {
                let mut ctx = context.ctx.borrow_mut();
                ctx.id = manifest.id.clone();
                ctx.keys = manifest.storage.clone();
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
            (status.unwrap_or(abi::PANIC), received(out, self.library.free))
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

/// The manifest `create` answered, checked: its ID, and, for a 1.x library, nothing of 2.0.
fn manifest(bytes: &[u8], major: u32, expect: Option<&str>) -> Result<Manifest, String> {
    let mut manifest: Manifest =
        serde_json::from_slice(bytes).map_err(|error| format!("setup returned a bad manifest: {error}"))?;
    if manifest.id.is_empty() {
        return Err("setup returned an empty plugin ID".to_owned());
    }
    if let Some(expect) = expect.filter(|expect| *expect != manifest.id) {
        return Err(format!("setup returned plugin ID {}, not {expect}", manifest.id));
    }
    if major < 2 && (!manifest.surfaces.is_empty() || !manifest.claims.is_empty() || manifest.messages) {
        log::warn!("plugin {}: a plugin of ABI {major}.x has no surfaces, claims or messages; ignored", manifest.id);
        (manifest.surfaces, manifest.claims, manifest.messages) = (Vec::new(), Vec::new(), false);
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

impl Ctx {
    /// The context of calls of plugin `id`, whose storage keys are `keys`, outside any instance: the pipe carrier's.
    pub(crate) fn new(host: Weak<dyn Host>, id: &str, keys: Vec<String>) -> Self {
        let (effects, undo, staged) = (Vec::new(), Undo::default(), crate::Staged::default());
        Self { host, id: id.to_owned(), keys, effects, undo, staged, quiet: false, read_only: false, owners: None }
    }

    /// What the calls asked for since it was last taken; what they staged goes with it.
    pub(crate) fn take(&mut self) -> (Vec<Effect>, Undo) {
        self.staged = crate::Staged::default();
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
    let (shared, request) = unsafe { (ctx.cast::<Shared>().as_ref(), request.as_slice()) };
    let result = catch_unwind(AssertUnwindSafe(|| {
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
    // SAFETY: `ctx` is this instance's `Shared`; `key` and `message` are valid for the call.
    let sent = catch_unwind(AssertUnwindSafe(|| unsafe {
        mailbox(ctx).map_or(abi::CLOSED, |mail| mail.put_json(key.as_slice(), message.as_slice()))
    }));
    let status = sent.unwrap_or(abi::ERROR);
    // SAFETY: as above.
    conformance::tap(Event::Send { key: unsafe { key.as_slice() }, message: unsafe { message.as_slice() }, status });
    status
}

/// The host's side of [`HostApi::report`], on any thread.
unsafe extern "C" fn host_report(ctx: *mut c_void, message: Bytes) {
    // SAFETY: as for `host_send`.
    let _ = catch_unwind(AssertUnwindSafe(|| unsafe {
        if let Some(mail) = mailbox(ctx) {
            mail.panicked(String::from_utf8_lossy(message.as_slice()).into_owned());
        }
    }));
    // SAFETY: as above.
    conformance::tap(Event::Report { message: unsafe { message.as_slice() } });
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

unsafe extern "C" fn host_free(owned: Owned) {
    // SAFETY: the host made `owned` with `Owned::from_vec`.
    drop(unsafe { owned.into_vec() });
}

pub(crate) fn handle(ctx: &mut Ctx, request: HostRequest) -> Result<serde_json::Value, String> {
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
        return Err("a render or a view reads the host and asks for no effect".to_owned());
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
            let staged = &ctx.staged;
            let known = read(ctx, |read| Ok(serde_json::Value::Bool(staged.variant_known(read, variant.as_deref()))))?;
            if known == serde_json::Value::Bool(true) {
                ctx.effects.push(Effect::Variant(variant));
            }
            return Ok(known);
        }
        HostRequest::SetModel { provider, model } => {
            let mut staged = std::mem::take(&mut ctx.staged);
            read(ctx, |read| {
                staged.set_model(read, &provider, &model);
                Ok(serde_json::Value::Null)
            })?;
            ctx.staged = staged;
            ctx.effects.push(Effect::Model(provider, model));
        }
        HostRequest::TabsEnabled => return read(ctx, |read| serde_json::to_value(read.tabs_enabled())),
        HostRequest::Tabs => return read(ctx, |read| serde_json::to_value(read.tabs())),
        HostRequest::Tab { edit } => {
            let allowed = ctx.host.upgrade().is_some_and(|host| ctx.staged.tab(&*host, &edit));
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
            let staged = &ctx.staged;
            let known = read(ctx, |read| Ok(serde_json::Value::Bool(staged.theme_known(read, &name))))?;
            if known == serde_json::Value::Bool(true) {
                ctx.effects.push(Effect::Theme(name));
            }
            return Ok(known);
        }
        HostRequest::InstallTheme { name, theme } => {
            if ctx.staged.install_theme(&name, &theme) {
                ctx.effects.push(Effect::InstallTheme(name, theme));
            }
        }
        // 2.0 (P3): the verbs and reads of the mount whose handler runs, else of the plugin's newest live mount of a
        // surface, as for a built-in's command, which a library's command is bound to no mount like. A transcript verb
        // answers the user's input only.
        HostRequest::Scroll { target, verb } => {
            if target == v2::Target::Transcript && !behave::in_handler() {
                return Err("a transcript verb outside a handler of the user's input is dropped".to_owned());
            }
            let host = ctx.host.upgrade().ok_or("the host is gone")?;
            let caller = behave::Caller { app: host.app(), plugin: &ctx.id, mount: called_mount(ctx) };
            ctx.effects.push(Effect::Scroll(behave::scroll(&caller, target, verb)));
        }
        HostRequest::ScrollState { target } => {
            let host = ctx.host.upgrade().ok_or("the host is gone")?;
            let caller = behave::Caller { app: host.app(), plugin: &ctx.id, mount: called_mount(ctx) };
            return Ok(serde_json::to_value(behave::scroll_state(&caller, &target)).unwrap_or_default());
        }
        HostRequest::Anchors { target, group } => {
            let host = ctx.host.upgrade().ok_or("the host is gone")?;
            let caller = behave::Caller { app: host.app(), plugin: &ctx.id, mount: called_mount(ctx) };
            return Ok(serde_json::to_value(behave::anchors(&caller, &target, &group)).unwrap_or_default());
        }
        HostRequest::TopAnchor { target, group, inset } => {
            let host = ctx.host.upgrade().ok_or("the host is gone")?;
            let caller = behave::Caller { app: host.app(), plugin: &ctx.id, mount: called_mount(ctx) };
            return Ok(serde_json::to_value(behave::top_anchor(&caller, &target, &group, inset)).unwrap_or_default());
        }
        HostRequest::Transcript => {
            let host = ctx.host.upgrade().ok_or("the host is gone")?;
            return Ok(serde_json::to_value(behave::transcript(host.app())).unwrap_or_default());
        }
        HostRequest::OpenPanel(open) => ctx.effects.push(Effect::Input(owners(ctx)?.open_panel(open))),
        HostRequest::ClosePanel { surface } => ctx.effects.push(Effect::Input(owners(ctx)?.close_panel(&surface))),
        HostRequest::Overlay(overlay) => {
            if let Some(effect) = owners(ctx)?.overlay(overlay) {
                ctx.effects.push(Effect::Input(effect));
            }
        }
        HostRequest::CloseOverlay { surface } => {
            ctx.effects.push(Effect::Input(owners(ctx)?.close_overlay(&surface)));
        }
        HostRequest::Focus { node } => ctx.effects.push(Effect::Input(owners(ctx)?.focus(&node))),
        HostRequest::Blur => ctx.effects.push(Effect::Input(owners(ctx)?.blur())),
        HostRequest::SetMode { mode } => ctx.effects.push(Effect::Input(owners(ctx)?.set_mode(mode.as_deref()))),
        HostRequest::ReleaseKeys => ctx.effects.push(Effect::Input(owners(ctx)?.release_keys())),
        HostRequest::Rect { node } => return Ok(serde_json::to_value(owners(ctx)?.rect(&node)).unwrap_or_default()),
        HostRequest::Focused => return Ok(serde_json::to_value(owners(ctx)?.focused()).unwrap_or_default()),
        HostRequest::InputMode => return Ok(serde_json::to_value(owners(ctx)?.mode()).unwrap_or_default()),
    }
    Ok(serde_json::Value::Null)
}

/// The mount whose handler or view runs, which P3's verbs and reads name; `None` for a command, which is bound to no
/// mount: then the plugin's newest live mount of the surface.
fn called_mount(ctx: &Ctx) -> Option<std::rc::Weak<()>> {
    ctx.owners.as_ref().and_then(|owners| owners.mounted())
}

/// What the calls hold of the input; a setup asks nothing of it, as it has no mount and no owner yet.
fn owners(ctx: &Ctx) -> Result<Rc<crate::Owners>, String> {
    ctx.owners.clone().ok_or_else(|| "setup has no input: it may open, focus and read nothing of it".to_owned())
}

/// Whether `request` is a render of 1.4 on, a view, a claim's view, a draw, a layout or a search, which read only, as in
/// process, where they get the host's reads alone. A 1.3 render is left as it was: its SDK let it
/// ask for effects, which apply when the host draws its answer.
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

/// Whether `request` asks for an effect, which a render may not. Every request is sorted, so a new one has to say.
fn effect(request: &HostRequest) -> bool {
    match request {
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
        | HostRequest::SetVariant { .. }
        | HostRequest::SetModel { .. }
        | HostRequest::Tab { .. }
        | HostRequest::ClearSelection
        | HostRequest::Foreground(_)
        | HostRequest::Title { .. }
        | HostRequest::SetTheme { .. }
        | HostRequest::InstallTheme { .. }
        | HostRequest::Scroll { .. }
        | HostRequest::OpenPanel(_)
        | HostRequest::ClosePanel { .. }
        | HostRequest::Overlay(_)
        | HostRequest::CloseOverlay { .. }
        | HostRequest::Focus { .. }
        | HostRequest::Blur
        | HostRequest::SetMode { .. }
        | HostRequest::ReleaseKeys => true,
        HostRequest::Log { .. }
        | HostRequest::StorageGet { .. }
        | HostRequest::StorageKey { .. }
        | HostRequest::Color { .. }
        | HostRequest::Session { .. }
        | HostRequest::Family { .. }
        | HostRequest::Messages { .. }
        | HostRequest::Models { .. }
        | HostRequest::Model
        | HostRequest::Limits
        | HostRequest::Providers
        | HostRequest::Info
        | HostRequest::McpServers { .. }
        | HostRequest::Integrations { .. }
        | HostRequest::Vcs { .. }
        | HostRequest::Route
        | HostRequest::Interactive
        | HostRequest::Shortcut { .. }
        | HostRequest::DialogOpen { .. }
        | HostRequest::Composer
        | HostRequest::Checkpoint
        | HostRequest::Rollback { .. }
        | HostRequest::Variants
        | HostRequest::TabsEnabled
        | HostRequest::Tabs
        | HostRequest::KeymapPending
        | HostRequest::KeymapActive
        | HostRequest::KeymapCommands
        | HostRequest::Shortcuts { .. }
        | HostRequest::Selection
        | HostRequest::Theme
        | HostRequest::Themes
        | HostRequest::ScrollState { .. }
        | HostRequest::Anchors { .. }
        | HostRequest::TopAnchor { .. }
        | HostRequest::Transcript
        | HostRequest::Rect { .. }
        | HostRequest::Focused
        | HostRequest::InputMode => false,
    }
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
    /// What a panic revokes at once, before deactivation: the commands' keymap layer and the event and delta
    /// subscriptions.
    revoked: RefCell<Vec<Disposer>>,
    /// The mounted slot claims and routes, which a wake draws again.
    activation: Rc<Activation>,
    /// What its calls hold of the input (P2).
    owners: Rc<crate::Owners>,
    monitor: Rc<crate::contain::Monitor>,
    slot: crate::contain::Slot,
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
            false => self.monitor.call(self.slot, "dispose", || drop(instance)).0,
        }
    }

    /// Sends one request. A failed or destroyed plugin is not called; a panic fails it, and its claims draw empty.
    fn request<T: DeserializeOwned>(self: &Rc<Self>, export: &'static str, request: &Request) -> Option<T> {
        self.checked(export, request, |_: &T| Ok(()))
    }

    /// [`Guest::request`] whose result `check` must accept. A result the host cannot decode, or that `check` refuses,
    /// fails the plugin as a panic does: what the call asked for is dropped, and the storage it wrote put back. An
    /// error the plugin returns is an answer: what the call asked for happens, and a 2.x plugin then fails (4.14), where
    /// a 1.x plugin's error is logged, as it always was. A render or a view may ask for nothing ([`asks`]). A call that
    /// returned late (an overrun, synthesis 4.4) did return: what it asked for happens, then it fails, which revokes it;
    /// a cause of the call's own (a refusal, or a 2.x error) names the failure before the overrun.
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
        let ((result, timed), major) = {
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
            (timed, instance.library.major)
        };
        let (effects, undo) = self.taken();
        let bad = |error: String| Failed::Refused(format!("returned a bad result: {error}"));
        let result = result.and_then(|bytes| decode(bytes).map_err(bad));
        let overrun = timed.overrun.then(|| {
            let limit = self.monitor.limits().overrun.as_millis();
            format!("{export} took {} ms, over the limit of {limit} ms", timed.took.as_millis())
        });
        let error = match &result {
            Ok(_) => {
                self.apply(effects);
                overrun
            }
            Err(Failed::Returned(error)) => {
                self.apply(effects);
                match major {
                    1 => {
                        log::warn!("plugin {}: {export}: {error}", self.id);
                        overrun
                    }
                    _ => Some(format!("{export} returned an error: {error}")),
                }
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
    fn deliver(self: &Rc<Self>, to: abi::InputTo) -> crate::interact::Deliver {
        let guest = Rc::downgrade(self);
        Rc::new(move |_: &dyn Host, owner: &Rc<crate::interact::Owner>, event: &abi::interact::Event| {
            let Some(guest) = guest.upgrade() else { return abi::interact::Handled::Pass };
            let request = Request::Input { to: to.clone(), event: event.clone() };
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
        // A handler answers `null` (O-135): anything else is a contract break.
        if self.request::<()>(export, request).is_some() {
            self.activation.invalidate();
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

/// The instance a fetch or a program in the foreground answers, on the library carrier or the pipe.
pub(crate) trait Answers {
    /// Whether a reply may still reach it: it lives and its activation did not end.
    fn live(&self) -> bool;
    /// Whether a program it asked for may still start: it lives and did not fail.
    fn running(&self) -> bool;
    fn owner(&self) -> Weak<dyn Host>;
    /// Hands it the reply, as its `on-reply` call.
    fn answer(self: Rc<Self>, request: Request);
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
}

/// Calls `send` unless the instance `guest` names is destroyed or its activation ended, as a call that panicked after
/// the one that asked for it ends it: a fetch or a program in the foreground. Its reply goes to the instance as
/// `request` on the effect queue, unless the instance is destroyed by then.
fn reply_to(
    guest: &Weak<dyn Answers>,
    host: &dyn Host,
    request: abi::RequestId,
    send: impl FnOnce(&dyn Host, crate::Reply),
) {
    let Some(live) = guest.upgrade().filter(|guest| guest.live()) else { return };
    let (guest, owner) = (guest.clone(), live.owner());
    send(
        host,
        Box::new(move |result| {
            defer(&owner, move |_| {
                if let Some(guest) = guest.upgrade() {
                    guest.answer(Request::Reply { id: request, result });
                }
            });
        }),
    );
}

/// Queues `effects` of plugin `id` on the effect queue, as the host would for a built-in; a fetch replies to `guest`, and
/// a dialog belongs to activation `generation`.
pub(crate) fn apply(
    host: &Weak<dyn Host>,
    id: String,
    guest: Weak<dyn Answers>,
    generation: Option<u64>,
    effects: Vec<Effect>,
) {
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
                    reply_to(&guest, host, request, |host, reply| host.fetch(fetch, reply));
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
                    let alive = Box::new(move || owner.upgrade().is_some_and(|guest| guest.running()));
                    reply_to(&guest, host, request, |host, reply| host.foreground(program, alive, reply));
                }
                Effect::Title(title) => host.set_title(&title),
                Effect::Theme(name) => host.set_theme(&name),
                Effect::InstallTheme(name, theme) => host.install_theme(&name, theme),
                Effect::Scroll(scroll) => scroll(),
                Effect::Input(effect) => effect(host),
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
    // P2: the searches, and the layers of setup, each with its own handler, the activation's.
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
        let deliver = guest.deliver(abi::InputTo::Layer { layer: index });
        guest.owners.input.register(&**setup.host(), std::slice::from_ref(layer), &deliver);
    }
    // 2.0: the surfaces, whose views run through `View`.
    for (index, claim) in manifest.surfaces.iter().enumerate() {
        let at: v2::Place = (&claim.place).into();
        // A library's commands run through its guest and apply what they asked for when the call returns, so they are
        // bound to no mount.
        let commands = match &at {
            v2::Place::Route(name) => route::commands(&scoped, name),
            v2::Place::Slot(_) | v2::Place::Panel(_) | v2::Place::Overlay(_) => Vec::new(),
        };
        let commands: surface::Commands = Rc::new(move |_| commands.clone());
        let failing = Rc::downgrade(guest);
        let fail: surface::Fail = Rc::new(move |error| {
            if let Some(guest) = failing.upgrade() {
                guest.fail(error);
            }
        });
        // P3: `layout` and the scroll handler run as calls of the library, as its view does.
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
            deliver: claim.handler.then(|| guest.deliver(abi::InputTo::Surface { surface: index })),
            layers: claim.layers.clone(),
            panel: matches!(place.at, v2::Place::Panel(_)),
        });
        let remote = Rc::new(Remote { guest: guest.clone(), index, draw: claim.draw });
        setup.surface(place, remote, commands, fail, calls, &guest.owners, input);
    }
    // 2.0: the renderer claims, whose views run through `Claim`.
    for (index, entry) in manifest.claims.iter().enumerate() {
        setup.renderer_claim(entry.clone(), Rc::new(RemoteClaim { guest: guest.clone(), index }), &guest.owners);
    }
    // 2.0: what the plugin's threads send runs `Message`, one call each, when its manifest says it takes messages; a
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

/// The nodes of `node` that carry an id, with what each keep holds again in the host's tree (`kept`): a library's memo
/// table keeps a value for each memo inside a kept one.
fn keyed(node: &v2::Node, kept: &dyn Fn(&str) -> usize) -> usize {
    match node {
        v2::Node::Keep { key } => kept(key).max(1),
        _ => usize::from(node.id().is_some()) + node.children().iter().map(|child| keyed(child, kept)).sum::<usize>(),
    }
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
        Some(Viewed { node: Some(reply.node), memo: Some(reply.memo) })
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
    ) -> Option<Option<Vec<u8>>> {
        let request = Request::Draw { surface: self.index, mount: mount.clone(), canvas: canvas.to_owned(), frame };
        // The result is the list's bytes as they are, which the canvas checks; none keeps the list. What the draw reads
        // of the input is its mount's, as a view's is.
        let drawn = self.guest.owners.as_owner(owner, || self.guest.exchange("draw", &request, Ok))?;
        Some(drawn.filter(|bytes| !bytes.is_empty()))
    }

    fn forget(&self, _: &dyn Host, mount: &v2::MountId) {
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
        requires_minor: 0,
        create: Some(create),
        call: Some(abi::runtime::call),
        destroy: Some(abi::runtime::destroy),
        free: Some(abi::runtime::free),
        describe,
    };
    // The shims would silence the process's panic hook on their first `create`, as a plugin's own std does; the process
    // here keeps its own. Taking and setting the hook around each load would race other threads' loads.
    abi::runtime::keep_panic_hook();
    Library::from_table(&api, ABI_MAJOR, V1_MINOR).and_then(|library| define(host, library, None))
}

/// The definition of the plugin whose table `api` is, found through the entry of major `entry`, as a library's: the
/// conformance tests' reference and the plugin that answers from a transcript.
#[cfg(test)]
pub(crate) fn from_api(
    host: &Rc<dyn Host>,
    api: *const PluginApi,
    entry: u32,
    options: Option<&str>,
) -> Result<(Definition, ErrorFn), String> {
    // As in `loopback`: the process keeps its panic hook.
    abi::runtime::keep_panic_hook();
    Library::from_table(api, entry, V1_MINOR).and_then(|library| define(host, library, options))
}

/// What the host makes of the table `api` found through the entry of major `entry`: the minor it serves it and what
/// it says about itself, or why it refuses it (the version gate).
#[cfg(test)]
pub(crate) fn gate(api: *const PluginApi, entry: u32) -> Result<(u32, abi::Metadata), String> {
    let library = Library::from_table(api, entry, V1_MINOR)?;
    let metadata = library.compatible()?;
    Ok((library.served, metadata))
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
                let made = define(setup.host(), Library::carried(plugin), None)?;
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
