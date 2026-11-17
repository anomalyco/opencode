//! The C ABI of native TUI plugins for opencode-native (P.4, `docs/P.4.md`, decision O-42).
//!
//! A plugin is a shared library (`.so`, `.dylib`, `.dll`) that exports [`ENTRY`], a function returning a
//! [`PluginApi`]. Everything after that crosses the boundary as JSON in byte buffers: the plugin's [`Manifest`],
//! [`Request`]s from the host, and [`HostRequest`]s from the plugin. A buffer one side returns is freed by that
//! side's `free`, so each side keeps its own allocator.
//!
//! # Versions
//!
//! The ABI has a major and a minor version ([`ABI_MAJOR`], [`ABI_MINOR`]). A minor version only appends:
//!
//! - [`PluginApi`] and [`HostApi`] start with their own size and version. New entries are only ever added at the
//!   end, and each new entry is optional (an `Option` of a function, null when absent). A reader treats entries
//!   past the other side's size as absent, so a plugin built against an older minor version loads and works.
//!   Every callback is an `Option` of a function, which has the layout of a nullable C function pointer, so a
//!   null from C code is checked rather than called; the host refuses a plugin that leaves a required one null.
//! - JSON payloads only gain optional fields, and readers ignore fields they do not know.
//! - A newer plugin on an older host uses what the host offers: the host answers an unknown [`HostRequest`] with an
//!   error, and a plugin that cannot work without a newer host sets [`PluginApi::requires_minor`], which the host
//!   refuses with a message naming both versions.
//! - The major version is for a deliberate breaking change. A major the host does not serve is the only thing that
//!   refuses a plugin outright. The entry symbol carries the major version ([`ENTRY`], `opencode_plugin_v2`).
//! - Nothing is removed inside a major: an entry, a request or a field that a later 2.x replaces stays as an alias
//!   until 3.0, because a compiled library cannot follow a rename (decision O-125 (6)).
//! - A plugin that needs an optional feature of the host lists it in [`Metadata::requires`]; a host without it
//!   refuses the plugin at load and names the feature. The host lists its own in [`HostApi::features`].
//!
//! # 2.0
//!
//! ABI 2.0 is ABI 1.6 with the contract 2.0 of the rich-plugin design on the C ABI: keyed surfaces ([`v2`],
//! [`Request::View`]), renderer claims of tool calls and fences ([`claim`], [`Request::Claim`]), and threads that send messages to the UI thread through a bounded mailbox ([`mail`],
//! [`HostApi::send`]). Every 1.6 request and entry is still there. The host loads 1.x libraries as before, through
//! [`ENTRY_V1`], and serves them ABI 1.6; they get no surfaces and no mailbox. Every message's schema is
//! `schema/v2.json`, generated from these types ([`v2::schema`]).
//!
//! A plugin written in Rust is a `cdylib` that depends on this crate and calls [`export_plugin!`] with a setup
//! function. The setup registers the P.1 surface through [`Setup`]: commands, code-fence renderers, slot claims,
//! routes, storage keys, and handlers of events, replies, mounts, wakes and disposal. Renderers return data
//! ([`Fenced`], [`Render`] with [`Node`]s); the host turns it into widgets. `crates/plugin-abi/README.md` has a quick
//! start. Panics are caught at every boundary and reported to the host, which shows them in its plugin manager; the
//! plugin's own panic hook is silenced so nothing prints over the TUI. Keep the default `panic = "unwind"`. Other
//! languages implement the same structs and JSON by hand.
//!
//! # One API (O-67)
//!
//! The host's built-in plugins use the same [`Setup`], closures and types, called in process with Rust values; an
//! external plugin gets them over this ABI. A render (a code fence or a slot claim) receives a [`Read`]: it reads and
//! returns a value, and has no effects. Reads are pure too: a read of something the host has not loaded yet (a
//! catalog) returns `None`, and the host starts the load once the outermost plugin callback has returned. A command
//! or an event handler receives a [`Host`], which also has effects; they wait until then as well, so a plugin never reenters itself
//! through the host.
//!
//! Renders in this form (ABI 1.4) are opt-in on the wire: [`Setup`] sets [`Manifest::render`], and the host sends
//! [`Request::RenderFence`] and [`Request::Render`] only to a plugin that sets it. A 1.3 plugin gets the old requests
//! and answers in the old format. A 1.x plugin built with this crate (`export_plugin!(id, setup, requires_minor =
//! N)`, deprecated) sets [`PluginApi::requires_minor`] to at least 4, so a 1.3 host refuses it; a 2.x plugin sets the
//! minimum of ABI 2 it asks for with `requires_minor` on [`plugin!`], 0 by default.
//!
//! Session and catalog values are the HTTP API's generated types, re-exported as [`types`].

#![allow(unsafe_code)]

mod build;
pub mod canvas;
pub mod claim;
pub mod interact;
pub mod mail;
mod schema;
pub mod v2;

pub use mail::{BOUND, SendError, Sender, Spawner, Stop};

use std::borrow::Cow;
use std::ffi::c_void;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::rc::Rc;
use std::sync::{Arc, PoisonError, RwLock};

pub use opencode_api_types as types;
use serde::{Deserialize, Serialize};
use types::{
    IntegrationInfo, McpServer, ModelInfo, ModelRef, ProviderInfo, SessionInfo, SessionMessageInfo, UsageLimitsInfo,
    V2Event, VcsInfo,
};

/// The major version: changes only with a deliberate breaking change, and a major the host does not serve refuses the
/// plugin.
pub const ABI_MAJOR: u32 = 2;
/// The minor version of [`ABI_MAJOR`]. 2.0 adds [`HostApi::send`], [`HostApi::report`], [`HostApi::stopped`] and
/// [`HostApi::features`], [`Metadata::requires`], [`Manifest::surfaces`], [`Manifest::claims`],
/// [`Manifest::messages`], [`Manifest::layers`], [`Manifest::searches`] and [`Manifest::plugins`], and the requests
/// [`Request::View`], [`Request::Draw`], [`Request::Claim`], [`Request::Unmount`], [`Request::Message`],
/// [`Request::Layout`], [`Request::Input`], [`Request::Search`] and [`Request::Plugins`], with the host requests
/// of their surfaces (from [`HostRequest::Scroll`] on).
pub const ABI_MINOR: u32 = 0;

/// The symbol every 2.x plugin exports, of type [`EntryFn`].
pub const ENTRY: &str = "opencode_plugin_v2";

/// The last minor of ABI 1, which the host serves a 1.x library. 1.0 is the core; 1.1 adds [`PluginApi::describe`]; 1.2 adds
/// [`HostApi::theme_mode`]; 1.3 adds [`HostApi::wake`]; 1.4 adds [`Manifest::render`], [`Request::RenderFence`],
/// [`Request::Render`], [`Request::Event`], [`HostRequest::Color`], the session and catalog reads,
/// [`HostRequest::Info`], [`HostRequest::Route`], [`HostRequest::Dispatch`], [`HostRequest::Attention`], and the
/// requests of routes, replies, dialogs, navigation and the clipboard ([`Request::RenderRoute`], [`Request::Reply`],
/// [`HostRequest::Fetch`], [`HostRequest::Navigate`], [`HostRequest::Dialog`], [`HostRequest::Copy`]), and of mounts and
/// the prompt ([`Request::Mount`], [`HostRequest::Interactive`], [`HostRequest::Shortcut`],
/// [`HostRequest::DialogOpen`]), [`Dialog::Select`], [`Request::Wake`], [`Request::RouteMount`],
/// [`HostRequest::StorageMerge`] and [`Request::FenceGone`]. 1.5 adds [`Dialog::Confirm`] and [`Dialog::Alert`], the
/// box styling of [`Node::Box`] ([`Border`], [`Edges`], [`Overflow`]) and [`Layout`]'s heights and margins, and the
/// composer: [`HostRequest::Composer`] and [`HostRequest::ComposerEdit`]. 1.6 adds the small reads and verbs: a claim's
/// size in [`SlotInput`], the streaming deltas ([`Setup::on_deltas`]), the model's variants, the session tabs, the
/// keymap's state, the mouse selection, a program in the foreground, a link on a [`Span`], the terminal title, the
/// theme, and [`PanelSize::XLarge`] (see [`HostRequest`] from [`HostRequest::Variants`] on). 2.0 has all of 1.6.
pub const V1_MINOR: u32 = 6;

/// The symbol every 1.x plugin exports.
pub const ENTRY_V1: &str = "opencode_plugin_v1";

/// The optional features this crate's host side knows ([`HostApi::features`]).
pub const FEATURES: &[&str] = &[IMAGE_BOUNDS, FOCUS_INPUT, FENCE_NODE];

/// 2.0: the host answers [`HostRequest::ImageBounds`] with the bounds of the images it decodes, so the SDK answers
/// [`Read::image_size`] of bytes past them without sending them (PL-9). A host without it is asked every time.
pub const IMAGE_BOUNDS: &str = "image-bounds";

/// 2.0: [`Host::focus`] gives the focus to a [`v2::Node::Input`] with an id, as a click does, so what the user types
/// goes into the field. A host without it refuses that focus, and the field takes the focus only from the user's click.
/// A plugin that cannot work without it names it in `requires` on [`plugin!`]; one that can reads
/// [`Read::abi`]'s [`Abi::has_feature`].
pub const FOCUS_INPUT: &str = "focus-input";

/// 2.0: the host draws [`v2::Node::Fence`], its own code view of a claimed fence, in a fence claim's tree. A host
/// without it fails a plugin that sends one; [`v2::View::or`] lowers it for that host.
pub const FENCE_NODE: &str = "fence-node";

/// What [`HostRequest::ImageBounds`] answers: the most bytes one image may have, and the most pixels a side its header
/// may name, as the host decodes images; past either, [`Read::image_size`] is `None`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct ImageBounds {
    pub bytes: u64,
    pub side: u64,
}

impl ImageBounds {
    pub fn new(bytes: u64, side: u64) -> Self {
        Self { bytes, side }
    }

    /// Whether `bytes` are past the bounds, by their length or the size their header names.
    pub fn over(&self, bytes: &[u8]) -> bool {
        bytes.len() as u64 > self.bytes
            || image_size(bytes).is_some_and(|(width, height)| u64::from(width.max(height)) > self.side)
    }
}

/// The version a host serves a plugin ([`Read::abi`]): its major, its minor of that major, and its optional features.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Abi {
    pub major: u32,
    pub minor: u32,
    pub features: Vec<String>,
}

impl Abi {
    /// What a host of this crate serves: [`ABI_MAJOR`].[`ABI_MINOR`] with [`FEATURES`].
    pub fn current() -> Self {
        Self::new(ABI_MAJOR, ABI_MINOR, FEATURES.iter().map(|feature| (*feature).to_owned()).collect())
    }

    pub fn new(major: u32, minor: u32, features: Vec<String>) -> Self {
        Self { major, minor, features }
    }

    /// Whether the host has what minor `minor` of [`ABI_MAJOR`] added.
    pub fn has_minor(&self, minor: u32) -> bool {
        self.major == ABI_MAJOR && self.minor >= minor
    }

    /// Whether the host has the optional feature `name`.
    pub fn has_feature(&self, name: &str) -> bool {
        self.features.iter().any(|feature| feature == name)
    }
}

/// Status codes of [`PluginApi::create`], [`PluginApi::call`], and [`HostApi::call`]. With [`OK`] the output buffer
/// holds the JSON result; otherwise it holds the error text.
pub const OK: i32 = 0;
pub const ERROR: i32 = 1;
/// The callee panicked; the output holds the panic message.
pub const PANIC: i32 = 2;
/// [`HostApi::send`]: the mailbox holds [`BOUND`] entries, and nothing was stored.
pub const FULL: i32 = 3;
/// [`HostApi::send`]: the plugin has left `active`, and nothing was stored.
pub const CLOSED: i32 = 4;

pub type EntryFn = unsafe extern "C" fn() -> *const PluginApi;

/// Bytes borrowed for the length of one call.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct Bytes {
    pub ptr: *const u8,
    pub len: usize,
}

impl Bytes {
    pub fn new(bytes: &[u8]) -> Self {
        Self { ptr: bytes.as_ptr(), len: bytes.len() }
    }

    /// The bytes, checked as every receiver checks borrowed bytes: a null `ptr` with a length, or a length over
    /// [`MAX_BUFFER`], is refused before anything is read through it.
    ///
    /// # Safety
    /// A non-null `ptr` must point to `len` readable bytes of one allocation that outlive the returned slice.
    pub unsafe fn checked<'a>(self) -> Result<&'a [u8], String> {
        match (self.ptr.is_null(), self.len) {
            (true, 0) => Ok(&[]),
            (true, len) => Err(format!("a null buffer of {len} bytes")),
            (false, len) if len > MAX_BUFFER => Err(format!("a buffer of {len} bytes, over {MAX_BUFFER}")),
            // SAFETY: as documented; `len` is under `isize::MAX`.
            (false, len) => Ok(unsafe { std::slice::from_raw_parts(self.ptr, len) }),
        }
    }

    /// [`Bytes::checked`], with a refused descriptor read as no bytes.
    ///
    /// # Safety
    /// As for [`Bytes::checked`].
    pub unsafe fn as_slice<'a>(self) -> &'a [u8] {
        unsafe { self.checked() }.unwrap_or_default()
    }
}

/// The largest buffer either side takes from the other, borrowed ([`Bytes`]) or returned ([`Owned`]): 256 MiB.
pub const MAX_BUFFER: usize = 256 << 20;

/// A buffer the callee allocated; the caller copies it out, then passes it to the callee's `free`.
#[repr(C)]
pub struct Owned {
    pub ptr: *mut u8,
    pub len: usize,
    pub cap: usize,
}

impl Owned {
    pub const EMPTY: Self = Self { ptr: std::ptr::null_mut(), len: 0, cap: 0 };

    pub fn from_vec(bytes: Vec<u8>) -> Self {
        let mut bytes = std::mem::ManuallyDrop::new(bytes);
        Self { ptr: bytes.as_mut_ptr(), len: bytes.len(), cap: bytes.capacity() }
    }

    /// # Safety
    /// `self` must come from [`Owned::from_vec`] in the same library, unchanged, or be [`Owned::EMPTY`].
    pub unsafe fn into_vec(self) -> Vec<u8> {
        if self.ptr.is_null() {
            return Vec::new();
        }
        unsafe { Vec::from_raw_parts(self.ptr, self.len, self.cap) }
    }

    /// Frees a buffer this side made with [`Owned::from_vec`], as a `free` does: by its `ptr` and `cap`, whatever
    /// `len` says, so a descriptor whose `len` the other side broke frees what was allocated and reads nothing.
    ///
    /// # Safety
    /// `ptr` and `cap` must come from [`Owned::from_vec`] in the same library, or `ptr` be null.
    pub unsafe fn release(self) {
        if !self.ptr.is_null() {
            // SAFETY: as documented; a `Vec<u8>` of no length drops no element.
            drop(unsafe { Vec::from_raw_parts(self.ptr, 0, self.cap) });
        }
    }

    /// A copy of the bytes, leaving the buffer for its owner to free. A descriptor [`received`] refuses copies nothing.
    ///
    /// # Safety
    /// A non-null `ptr` must point to `len` readable bytes.
    pub unsafe fn to_vec(&self) -> Vec<u8> {
        unsafe { self.bytes() }.map(<[u8]>::to_vec).unwrap_or_default()
    }

    /// The initialized bytes, or why the descriptor cannot describe a buffer the other side allocated: a null `ptr`
    /// with a length, a `len` past `cap`, or a buffer over [`MAX_BUFFER`].
    unsafe fn bytes(&self) -> Result<&[u8], String> {
        if !self.ptr.is_null() && self.len > self.cap {
            return Err(format!("a buffer of {} bytes in {} of room", self.len, self.cap));
        }
        // SAFETY: as for `to_vec`.
        unsafe { Bytes { ptr: self.ptr, len: self.len }.checked() }
    }
}

/// What every receiver of the C ABI does with a buffer the other side returned ([`PluginApi::create`],
/// [`PluginApi::call`], [`PluginApi::describe`], [`HostApi::call`]): it checks the descriptor, copies the bytes out,
/// and hands that exact descriptor back to the other side's `free` once, also when it refuses it. A null `ptr` with a
/// length, a `len` past `cap`, and a buffer over [`MAX_BUFFER`] are refused unread.
///
/// # Safety
/// `out` was written by the side whose `free` this is; a non-null `ptr` points to `len` readable bytes when the
/// descriptor is not refused.
pub unsafe fn received(out: Owned, free: unsafe extern "C" fn(Owned)) -> Result<Vec<u8>, String> {
    // SAFETY: as documented.
    let bytes = unsafe { out.bytes() }.map(<[u8]>::to_vec);
    // SAFETY: the buffer goes back to the side that wrote it, once, as it was received.
    unsafe { free(out) };
    bytes
}

/// What the host gives a plugin instance. It stays valid until the host destroys the instance. A plugin reads an
/// entry only when `size` covers it.
#[repr(C)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct HostApi {
    /// `size_of::<HostApi>()` of the host's build.
    pub size: usize,
    pub major: u32,
    pub minor: u32,
    pub ctx: *mut c_void,
    /// Handles a [`HostRequest`] and writes the JSON result into `out`. A plugin treats a null entry, or a null
    /// `free`, as a host that answers every request with an error. Only on the thread that calls into the plugin (the
    /// UI thread): a call from another thread is refused with [`ERROR`] and does nothing; that thread calls `wake`.
    pub call: Option<unsafe extern "C" fn(ctx: *mut c_void, request: Bytes, out: *mut Owned) -> i32>,
    /// Frees a buffer `call` wrote.
    pub free: Option<unsafe extern "C" fn(owned: Owned)>,
    // 1.2
    /// Whether the page theme is dark ([`THEME_DARK`]) or light ([`THEME_LIGHT`]), as TS plugins read
    /// `api.themeMode`. Only on the UI thread, as `call`: another thread gets [`THEME_DARK`].
    pub theme_mode: Option<unsafe extern "C" fn(ctx: *mut c_void) -> u32>,
    // 1.3
    /// Asks the host to request the rows of the plugin's mounted slot claims and routes again, on its UI thread.
    /// It is a redraw hint: it carries no data and drains nothing for the plugin, which keeps its own results and
    /// reads all of them when the host asks for rows. Wakes that arrive before the host handles one count once, and
    /// the host never drops the last one. Callable from any thread, but `ctx` is valid only until `destroy` returns,
    /// so a plugin makes sure no thread calls it after that. A Rust plugin reads it as [`Setup::waker`], whose
    /// [`Waker`] the SDK revokes in `destroy`.
    pub wake: Option<unsafe extern "C" fn(ctx: *mut c_void)>,
    // 2.0
    /// Puts `message`, JSON text, in the plugin's mailbox: at the end with an empty `key`, else in the place of the
    /// entry that waits under `key`. Returns [`OK`], [`FULL`] or [`CLOSED`] at once and never blocks; [`ERROR`] for a
    /// message that is not JSON. The host then runs [`Request::Message`] on its UI thread. Callable from any thread
    /// until `destroy` returns, as `wake` is.
    pub send: Option<unsafe extern "C" fn(ctx: *mut c_void, key: Bytes, message: Bytes) -> i32>,
    /// A thread of the plugin panicked with `message`, text: the host fails the plugin and says so once. Callable
    /// from any thread until `destroy` returns.
    pub report: Option<unsafe extern "C" fn(ctx: *mut c_void, message: Bytes)>,
    /// 1 once the plugin has left `active`, else 0: its threads should end. Callable from any thread until `destroy`
    /// returns.
    pub stopped: Option<unsafe extern "C" fn(ctx: *mut c_void) -> u32>,
    /// The host's optional features, a JSON array of names, valid while the instance lives.
    pub features: Bytes,
}

/// [`HostApi::theme_mode`] results.
pub const THEME_DARK: u32 = 0;
pub const THEME_LIGHT: u32 = 1;

/// The 1.1 layout of [`HostApi`], a prefix of it. Hosts built against 1.1 pass this; kept to test that plugins
/// read only what such a host offers.
#[doc(hidden)]
#[repr(C)]
pub struct HostApiV1_1 {
    pub size: usize,
    pub major: u32,
    pub minor: u32,
    pub ctx: *mut c_void,
    pub call: Option<unsafe extern "C" fn(*mut c_void, Bytes, *mut Owned) -> i32>,
    pub free: Option<unsafe extern "C" fn(Owned)>,
}

/// The 1.2 layout of [`HostApi`], a prefix of it, without `wake`; kept to test that plugins read only what such a
/// host offers.
#[doc(hidden)]
#[repr(C)]
pub struct HostApiV1_2 {
    pub size: usize,
    pub major: u32,
    pub minor: u32,
    pub ctx: *mut c_void,
    pub call: Option<unsafe extern "C" fn(*mut c_void, Bytes, *mut Owned) -> i32>,
    pub free: Option<unsafe extern "C" fn(Owned)>,
    pub theme_mode: Option<unsafe extern "C" fn(*mut c_void) -> u32>,
}

/// Dark or light, from [`Read::theme_mode`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ThemeMode {
    Dark,
    Light,
}

/// What a plugin exports. The host reads an entry only when `size` covers it; entries added by later minor versions
/// go at the end and are optional.
#[repr(C)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct PluginApi {
    // 1.0: the core, which every plugin of major version 1 has.
    /// `size_of` the struct as the plugin built it.
    pub size: usize,
    pub major: u32,
    pub minor: u32,
    /// The oldest host minor version the plugin works with; 0 for any.
    pub requires_minor: u32,
    /// Runs the plugin's setup with `options` (the JSON of its `plugins` entry's options, or empty). On [`OK`] it
    /// sets `instance` and writes the [`Manifest`] JSON into `out`. Required: the host refuses a null entry.
    pub create: Option<
        unsafe extern "C" fn(host: *const HostApi, options: Bytes, instance: *mut *mut c_void, out: *mut Owned) -> i32,
    >,
    /// Handles a [`Request`] and writes the JSON result into `out`. Required.
    pub call: Option<unsafe extern "C" fn(instance: *mut c_void, request: Bytes, out: *mut Owned) -> i32>,
    /// Destroys an instance. Optional: a plugin without per-instance state leaves it null.
    pub destroy: Option<unsafe extern "C" fn(instance: *mut c_void)>,
    /// Frees a buffer `create`, `call`, or `describe` wrote. Required.
    pub free: Option<unsafe extern "C" fn(owned: Owned)>,
    // 1.1
    /// Writes the plugin's [`Metadata`] JSON into `out`.
    pub describe: Option<unsafe extern "C" fn(out: *mut Owned) -> i32>,
}

/// The 1.0 layout of [`PluginApi`], a prefix of it. Plugins built against 1.0 export this; kept to test that they
/// still load.
#[doc(hidden)]
#[repr(C)]
pub struct PluginApiV1_0 {
    pub size: usize,
    pub major: u32,
    pub minor: u32,
    pub requires_minor: u32,
    pub create: Option<unsafe extern "C" fn(*const HostApi, Bytes, *mut *mut c_void, *mut Owned) -> i32>,
    pub call: Option<unsafe extern "C" fn(*mut c_void, Bytes, *mut Owned) -> i32>,
    pub destroy: Option<unsafe extern "C" fn(*mut c_void)>,
    pub free: Option<unsafe extern "C" fn(Owned)>,
}

/// What [`PluginApi::describe`] returns (1.1).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Metadata {
    /// The plugin's own version, such as its crate version.
    #[serde(default)]
    pub version: Option<String>,
    /// The plugin's ID, the one its [`Manifest`] will have. A host that knows it before setup serves storage
    /// requests during setup; older hosts ignore it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    /// 2.0: the optional host features the plugin cannot work without. A host that lacks one refuses the plugin at
    /// load and names it.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub requires: Vec<String>,
}

/// Everything a plugin registered in its setup.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Manifest {
    pub id: String,
    pub commands: Vec<Command>,
    /// The languages of the code fences it renders.
    pub fences: Vec<String>,
    /// Slot claims, in order; [`Request::Slot`] names one by index.
    pub slots: Vec<SlotClaim>,
    pub routes: Vec<String>,
    /// Storage keys, stored by the host as `plugin.<id>.<key>`.
    pub storage: Vec<String>,
    /// 2 when the plugin answers the render requests of ABI 1.4 ([`Request::RenderFence`]) instead of the old ones
    /// ([`Request::Fence`]). [`Setup`] sets it; absent (0) in a 1.3 plugin.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub render: u32,
    /// The event types of each [`Setup::on_event`] handler, in order; [`Request::Event`] names one by index.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub events: Vec<Vec<String>>,
    /// The routes of [`Setup::route`], which answer [`Request::RenderRoute`]; [`Manifest::routes`] lists them too.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub render_routes: Vec<String>,
    /// The plugin has [`Setup::on_wake`] handlers, which [`Request::Wake`] runs.
    #[serde(default, skip_serializing_if = "is_false")]
    pub wake: bool,
    /// The routes with [`Setup::on_route_mount`] handlers, which [`Request::RouteMount`] runs.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub route_mounts: Vec<String>,
    /// The plugin has [`Setup::on_fence_gone`] handlers, which [`Request::FenceGone`] runs.
    #[serde(default, skip_serializing_if = "is_false")]
    pub fence_gone: bool,
    /// 1.6: the plugin has [`Setup::on_deltas`] handlers, which [`Request::Deltas`] runs.
    #[serde(default, skip_serializing_if = "is_false")]
    pub deltas: bool,
    /// 2.0 (P6b): the plugin has [`Setup::on_plugins`] handlers, which [`Request::Plugins`] runs.
    #[serde(default, skip_serializing_if = "is_false")]
    pub plugins: bool,
    /// 2.0: the surfaces of [`Setup::surface`], in order; [`Request::View`] names one by index.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub surfaces: Vec<SurfaceClaim>,
    /// 2.0: the renderer claims of [`Setup::claim`], in order; [`Request::Claim`] names one by index.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub claims: Vec<claim::Entry>,
    /// 2.0: the plugin has a [`Setup::messages`] handler, which [`Request::Message`] runs.
    #[serde(default, skip_serializing_if = "is_false")]
    pub messages: bool,
    /// 2.0 (P2): the key layers of [`Setup::layer`], in order; [`Request::Input`] names one by index.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub layers: Vec<interact::Layer>,
    /// 2.0 (P2): the names of the searches of [`Setup::search`], which [`Request::Search`] runs.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub searches: Vec<String>,
}

/// A surface of contract 2.0 as the manifest lists it ([`v2::Surface`] without its view).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct SurfaceClaim {
    pub name: String,
    pub place: SurfacePlace,
    /// The view reads [`v2::SurfaceInput::palette`]: only such a view gets the palette, and a theme change calls it.
    #[serde(default, skip_serializing_if = "is_false")]
    pub palette: bool,
    /// The surface has a draw ([`v2::Surface::draw`]), which [`Request::Draw`] runs for its canvases.
    #[serde(default, skip_serializing_if = "is_false")]
    pub draw: bool,
    /// 2.0 (P3): what the surface's `layout` is told about; [`Request::Layout`] runs it.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub notify: Vec<v2::Notify>,
    /// 2.0 (P3): the surface has a `layout`.
    #[serde(default, skip_serializing_if = "is_false")]
    pub layout: bool,
    /// P2: the surface has a handler ([`v2::Surface::on`]), which [`Request::Input`] calls.
    #[serde(default, skip_serializing_if = "is_false")]
    pub handler: bool,
    /// P2: the key layers each mount of it registers ([`v2::Surface::layers`]).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub layers: Vec<interact::Layer>,
    /// P6a: its handler hears [`interact::Event::Mount`] ([`v2::Surface::mounts`]).
    #[serde(default, skip_serializing_if = "is_false")]
    pub mounts: bool,
}

/// [`v2::Place`] on the wire.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum SurfacePlace {
    Route {
        name: String,
    },
    Slot {
        kind: SlotKind,
        path: String,
    },
    /// P2: a docked panel, and an overlay, which [`HostRequest::OpenPanel`] and [`HostRequest::Overlay`] open.
    Panel {
        name: String,
    },
    Overlay {
        name: String,
    },
}

impl From<&v2::Place> for SurfacePlace {
    fn from(place: &v2::Place) -> Self {
        match place {
            v2::Place::Route(name) => SurfacePlace::Route { name: name.clone() },
            v2::Place::Slot(at) => SurfacePlace::Slot { kind: at.kind, path: at.path.clone() },
            v2::Place::Panel(name) => SurfacePlace::Panel { name: name.clone() },
            v2::Place::Overlay(name) => SurfacePlace::Overlay { name: name.clone() },
        }
    }
}

impl From<&SurfacePlace> for v2::Place {
    fn from(place: &SurfacePlace) -> Self {
        match place {
            SurfacePlace::Route { name } => v2::Place::Route(name.clone()),
            SurfacePlace::Slot { kind, path } => v2::Place::Slot(Placement::new(*kind, path.clone())),
            SurfacePlace::Panel { name } => v2::Place::Panel(name.clone()),
            SurfacePlace::Overlay { name } => v2::Place::Overlay(name.clone()),
        }
    }
}

/// What [`Manifest::render`] is for the render requests of ABI 1.4.
pub const RENDER: u32 = 2;

fn is_zero(value: &u32) -> bool {
    *value == 0
}

/// A command: in the palette when `palette` is set, as `/slash`, and on `keybind` (such as `ctrl+shift+h`).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[non_exhaustive]
pub struct Command {
    pub name: String,
    pub title: String,
    pub group: Option<String>,
    pub slash: Option<String>,
    pub keybind: Option<String>,
    pub palette: bool,
    /// 1.4: a line under the title in the palette.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// 1.4: `/slash` keeps its text after the name and passes it as the input.
    #[serde(default, skip_serializing_if = "is_false")]
    pub arguments: bool,
    /// 1.4: where the command runs.
    #[serde(default, skip_serializing_if = "Scope::is_global")]
    pub scope: Scope,
}

/// 2.0 (P6c): a setter of each field, since `Command` is `#[non_exhaustive]`: a plugin builds it from
/// `Command::default()` and sets what it needs, so a field a later 2.x adds is no break of its source.
impl Command {
    /// Sets [`Self::name`].
    pub fn with_name(mut self, name: String) -> Self {
        self.name = name;
        self
    }

    /// Sets [`Self::title`].
    pub fn with_title(mut self, title: String) -> Self {
        self.title = title;
        self
    }

    /// Sets [`Self::group`].
    pub fn with_group(mut self, group: Option<String>) -> Self {
        self.group = group;
        self
    }

    /// Sets [`Self::slash`].
    pub fn with_slash(mut self, slash: Option<String>) -> Self {
        self.slash = slash;
        self
    }

    /// Sets [`Self::keybind`].
    pub fn with_keybind(mut self, keybind: Option<String>) -> Self {
        self.keybind = keybind;
        self
    }

    /// Sets [`Self::palette`].
    pub fn with_palette(mut self, palette: bool) -> Self {
        self.palette = palette;
        self
    }

    /// Sets [`Self::description`].
    pub fn with_description(mut self, description: Option<String>) -> Self {
        self.description = description;
        self
    }

    /// Sets [`Self::arguments`].
    pub fn with_arguments(mut self, arguments: bool) -> Self {
        self.arguments = arguments;
        self
    }

    /// Sets [`Self::scope`].
    pub fn with_scope(mut self, scope: Scope) -> Self {
        self.scope = scope;
        self
    }
}

/// Where a [`Command`] runs: everywhere, or while the plugin's route of that name shows.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Scope {
    #[default]
    Global,
    Route(String),
    /// P8: everywhere, while the keyboard is in its base mode (TS's keymap layer without `mode: "global"`): not while
    /// a dialog or a mode a plugin pushed has it. An older host refuses the manifest.
    Base,
}

impl Scope {
    fn is_global(&self) -> bool {
        *self == Scope::Global
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum SlotKind {
    Prepend,
    Append,
    Before,
    After,
    Replace,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct SlotClaim {
    pub kind: SlotKind,
    /// A host slot path, such as `home.footer` or `sidebar.content`.
    pub path: String,
    /// The claim answers [`Request::Render`] (ABI 1.4), not [`Request::Slot`]. Absent in a 1.3 plugin.
    #[serde(default, skip_serializing_if = "is_false")]
    pub render: bool,
    /// 1.4: the claim has a [`Setup::on_mount`] handler, which [`Request::Mount`] runs.
    #[serde(default, skip_serializing_if = "is_false")]
    pub mount: bool,
    /// 1.6: the claim reads its size ([`Setup::sized`]).
    #[serde(default, skip_serializing_if = "is_false")]
    pub size: bool,
}

/// Where a slot claim of [`Setup::slot`] goes.
#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Placement {
    pub kind: SlotKind,
    /// A host slot path, such as `home.footer` or `sidebar.content`.
    pub path: String,
}

impl Placement {
    pub fn new(kind: SlotKind, path: impl Into<String>) -> Self {
        Self { kind, path: path.into() }
    }

    pub fn append(path: impl Into<String>) -> Self {
        Self::new(SlotKind::Append, path)
    }

    pub fn prepend(path: impl Into<String>) -> Self {
        Self::new(SlotKind::Prepend, path)
    }
}

/// A color: a theme token path (`text.muted`, `markdown.heading`), a scale step (`categorical.3.300`,
/// `interactive.500`), `#rrggbb`, or an [`Rgba`]. On the wire it is that text, an [`Rgba`] as `#rrggbbaa`. An
/// unknown token draws in `text.base`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Color {
    Rgba(Rgba),
    Token(Cow<'static, str>),
}

impl From<&'static str> for Color {
    fn from(token: &'static str) -> Self {
        Color::Token(Cow::Borrowed(token))
    }
}

impl From<String> for Color {
    fn from(token: String) -> Self {
        Color::Token(Cow::Owned(token))
    }
}

impl From<Rgba> for Color {
    fn from(rgba: Rgba) -> Self {
        Color::Rgba(rgba)
    }
}

/// A color with alpha; the host blends a translucent one over what is below it. On the wire it is `#rrggbbaa`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Rgba {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

impl Rgba {
    pub const fn new(r: u8, g: u8, b: u8, a: u8) -> Self {
        Self { r, g, b, a }
    }

    /// `#rrggbbaa`, or `#rrggbb` for an opaque color.
    pub fn parse(text: &str) -> Option<Self> {
        let hex = text.strip_prefix('#').filter(|hex| matches!(hex.len(), 6 | 8) && hex.is_ascii())?;
        let channel = |index: usize| u8::from_str_radix(hex.get(index..index + 2)?, 16).ok();
        let a = if hex.len() == 8 { channel(6)? } else { 255 };
        Some(Self::new(channel(0)?, channel(2)?, channel(4)?, a))
    }
}

impl Serialize for Rgba {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let Self { r, g, b, a } = self;
        serializer.collect_str(&format_args!("#{r:02x}{g:02x}{b:02x}{a:02x}"))
    }
}

impl<'de> Deserialize<'de> for Rgba {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = Cow::<str>::deserialize(deserializer)?;
        // Only the 8-digit form: `#rrggbb` stays a token, so 1.3 rows read back as they were written.
        Self::parse(&text).filter(|_| text.len() == 9).ok_or_else(|| serde::de::Error::custom("not #rrggbbaa"))
    }
}

/// Styled text.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Span {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fg: Option<Color>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bg: Option<Color>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub bold: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub italic: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub underline: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub dim: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub strikethrough: bool,
    /// 1.6: an OSC 8 hyperlink to this URL (TS `<a href>`); a terminal without OSC 8 shows the text alone. An older
    /// host draws the text without it, and so does any host for a URL with a C0 or C1 control character or DEL
    /// (OpenTUI writes no such link).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link: Option<String>,
}

impl Span {
    pub fn new(text: impl Into<String>) -> Self {
        Self { text: text.into(), ..Self::default() }
    }

    pub fn fg(mut self, color: impl Into<Color>) -> Self {
        self.fg = Some(color.into());
        self
    }

    pub fn bold(mut self) -> Self {
        self.bold = true;
        self
    }

    /// The span as a hyperlink to `url` (1.6).
    pub fn link(mut self, url: impl Into<String>) -> Self {
        self.link = Some(url.into());
        self
    }
}

fn is_false(value: &bool) -> bool {
    !value
}

/// One row; the host draws rows without wrapping and scrolls a wide fence sideways.
pub type Line = Vec<Span>;

/// A fenced Markdown code block, as [`Setup::code_block`] renders it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Fence {
    pub language: String,
    pub info: String,
    pub code: String,
    /// The message is still streaming, so the block may be incomplete.
    pub streaming: bool,
    /// The closing fence has arrived.
    pub closed: bool,
    /// The host's name for this block. It stays the same while the block changes, across renders that return
    /// [`Fenced::Lines`] or [`Fenced::Keep`], so a plugin can keep its own state for the block by key, and drop it in
    /// [`Setup::on_fence_gone`].
    pub key: u64,
    /// The terminal's width in columns, for a plugin that lays out to fit it.
    #[serde(default)]
    pub width: u16,
}

/// What a fence render returns.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Fenced {
    /// The host's plain code view.
    Code,
    /// What the block showed before; the code view when it showed nothing of the plugin's.
    Keep,
    /// Rows the host draws without wrapping, scrolling sideways when wide: on a horizontal wheel, or with `drag`
    /// on a left drag, which swallows a horizontal wheel. `fg` draws spans without their own.
    Lines {
        lines: Vec<Line>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fg: Option<Color>,
        #[serde(default, skip_serializing_if = "is_false")]
        drag: bool,
    },
}

/// What a slot render ([`Setup::slot`]) returns.
// One a render, returned by value and dropped after: boxing `Show` would change every plugin's renders for no gain.
#[allow(clippy::large_enum_variant)]
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "node", rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Render {
    /// What the claim shows now stays. On a claim that has not drawn yet, it draws nothing.
    Keep,
    /// The claim hides, with the gap around it.
    Hide,
    /// The claim shows `node`. The host rebuilds its widgets only when `node` differs from the last one.
    Show(Node),
}

/// What a plugin draws: boxes and text.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Node {
    /// A box that lays out its children in a column, or in a row. An empty box still takes its place.
    Box {
        #[serde(default, skip_serializing_if = "is_false")]
        row: bool,
        /// Cells between the children.
        #[serde(default, skip_serializing_if = "is_zero_u16")]
        gap: u16,
        /// Cells inside the edge, left and right, then top and bottom.
        #[serde(default, skip_serializing_if = "is_no_padding")]
        padding: (u16, u16),
        /// How the children share the room left along the row or column.
        #[serde(default, skip_serializing_if = "Justify::is_start")]
        justify: Justify,
        /// Where the children sit across the row or column.
        #[serde(default, skip_serializing_if = "Align::is_stretch")]
        align: Align,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        bg: Option<Color>,
        #[serde(default, skip_serializing_if = "Layout::is_default")]
        layout: Layout,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        on_click: Option<Click>,
        #[serde(default)]
        children: Vec<Node>,
        /// 1.5: a border on the box's edge, inside its size and outside its padding.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        border: Option<std::boxed::Box<Border>>,
        /// 1.5: cells inside each edge, instead of `padding`. A negative side counts as 0.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        padding_sides: Option<Edges>,
        /// 1.5: children that do not fit go on to another row or column (TS `flexWrap="wrap"`).
        #[serde(default, skip_serializing_if = "is_false")]
        wrap: bool,
        /// 1.5: whether what does not fit in the box draws outside it.
        #[serde(default, skip_serializing_if = "Overflow::is_visible")]
        overflow: Overflow,
    },
    /// Styled text. `fg` draws spans without their own; by default `text.base`.
    Text {
        spans: Vec<Span>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fg: Option<Color>,
        #[serde(default, skip_serializing_if = "Wrap::is_word")]
        wrap: Wrap,
        /// Cuts lines that do not fit, instead of wrapping or overflowing.
        #[serde(default, skip_serializing_if = "is_false")]
        truncate: bool,
        /// Whether the mouse can select it. On by default.
        #[serde(default = "yes", skip_serializing_if = "is_true")]
        selectable: bool,
        /// What `fg` becomes while the pointer is over it.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        hover_fg: Option<Color>,
        #[serde(default, skip_serializing_if = "Layout::is_default")]
        layout: Layout,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        on_click: Option<Click>,
    },
    /// The claims of slot `path`, in place, as if they were children of this node's parent. `path` is a published
    /// slot inside the one the claim renders in, such as `home.footer.status` in `home.footer`; the host draws
    /// nothing for any other path. The host keeps the slot's claims mounted, and renders them with each change,
    /// also while this claim returns [`Render::Keep`].
    Slot { path: String },
    /// Markdown, drawn as the host draws a message, with the code-fence renderers of the active plugins.
    Markdown { text: String },
    /// A spinner with `label`, in the host's spinner color.
    Spinner { label: String },
}

impl Node {
    /// A box of `children` in a column.
    pub fn column(children: Vec<Node>) -> Self {
        Node::Box {
            row: false,
            gap: 0,
            padding: (0, 0),
            justify: Justify::Start,
            align: Align::Stretch,
            bg: None,
            layout: Layout::default(),
            on_click: None,
            children,
            border: None,
            padding_sides: None,
            wrap: false,
            overflow: Overflow::Visible,
        }
    }

    /// A box of `children` in a row.
    pub fn row(children: Vec<Node>) -> Self {
        let mut node = Self::column(children);
        if let Node::Box { row, .. } = &mut node {
            *row = true;
        }
        node
    }

    /// Selectable text of `spans` that wraps at words.
    pub fn text(spans: impl Into<Vec<Span>>) -> Self {
        Node::Text {
            spans: spans.into(),
            fg: None,
            wrap: Wrap::Word,
            truncate: false,
            selectable: true,
            hover_fg: None,
            layout: Layout::default(),
            on_click: None,
        }
    }

    /// The claims of slot `path` in place ([`Node::Slot`]).
    pub fn slot(path: impl Into<String>) -> Self {
        Node::Slot { path: path.into() }
    }

    /// The node with `click`; a slot is unchanged.
    pub fn on_click(mut self, click: Click) -> Self {
        if let Node::Box { on_click, .. } | Node::Text { on_click, .. } = &mut self {
            *on_click = Some(click);
        }
        self
    }

    /// The node laid out with `layout`; a slot is unchanged.
    pub fn layout(mut self, value: Layout) -> Self {
        if let Node::Box { layout, .. } | Node::Text { layout, .. } = &mut self {
            *layout = value;
        }
        self
    }

    /// A box with `cells` between its children; text is unchanged.
    pub fn gap(mut self, cells: u16) -> Self {
        if let Node::Box { gap, .. } = &mut self {
            *gap = cells;
        }
        self
    }

    /// A box with `x` cells inside its left and right edges and `y` inside its top and bottom; text is unchanged.
    pub fn padding(mut self, x: u16, y: u16) -> Self {
        if let Node::Box { padding, .. } = &mut self {
            *padding = (x, y);
        }
        self
    }

    /// A box whose children share the room left as `value` says; text is unchanged.
    pub fn justify(mut self, value: Justify) -> Self {
        if let Node::Box { justify, .. } = &mut self {
            *justify = value;
        }
        self
    }

    /// A box whose children sit across it as `value` says; text is unchanged.
    pub fn align(mut self, value: Align) -> Self {
        if let Node::Box { align, .. } = &mut self {
            *align = value;
        }
        self
    }

    /// Text the mouse cannot select; a box is unchanged.
    pub fn unselectable(mut self) -> Self {
        if let Node::Text { selectable, .. } = &mut self {
            *selectable = false;
        }
        self
    }

    /// A box on `color`; text is unchanged.
    pub fn bg(mut self, color: impl Into<Color>) -> Self {
        if let Node::Box { bg, .. } = &mut self {
            *bg = Some(color.into());
        }
        self
    }

    /// Text in `color` where its spans have none; a box is unchanged.
    pub fn fg(mut self, color: impl Into<Color>) -> Self {
        if let Node::Text { fg, .. } = &mut self {
            *fg = Some(color.into());
        }
        self
    }

    /// Text in `color` while the pointer is over it; a box is unchanged.
    pub fn hover_fg(mut self, color: impl Into<Color>) -> Self {
        if let Node::Text { hover_fg, .. } = &mut self {
            *hover_fg = Some(color.into());
        }
        self
    }

    /// Text that wraps as `value` says; a box is unchanged.
    pub fn wrap(mut self, value: Wrap) -> Self {
        if let Node::Text { wrap, .. } = &mut self {
            *wrap = value;
        }
        self
    }

    /// Text that cuts lines that do not fit; a box is unchanged.
    pub fn truncate(mut self) -> Self {
        if let Node::Text { truncate, .. } = &mut self {
            *truncate = true;
        }
        self
    }

    /// A box with `value` on its edge; text is unchanged.
    pub fn border(mut self, value: Border) -> Self {
        if let Node::Box { border, .. } = &mut self {
            *border = Some(std::boxed::Box::new(value));
        }
        self
    }

    /// A box with `edges` cells inside each edge, instead of [`Node::padding`]; text is unchanged.
    pub fn padding_sides(mut self, edges: Edges) -> Self {
        if let Node::Box { padding_sides, .. } = &mut self {
            *padding_sides = Some(edges);
        }
        self
    }

    /// A box whose children go on to another row or column when they do not fit; text is unchanged.
    pub fn flex_wrap(mut self) -> Self {
        if let Node::Box { wrap, .. } = &mut self {
            *wrap = true;
        }
        self
    }

    /// A box that draws what does not fit in it as `value` says; text is unchanged.
    pub fn overflow(mut self, value: Overflow) -> Self {
        if let Node::Box { overflow, .. } = &mut self {
            *overflow = value;
        }
        self
    }
}

/// 1.5: a border of a [`Node::Box`] (TS `border`, `borderStyle`, `borderColor`, `title` and `titleAlignment`).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Border {
    /// The sides that draw; all four by default.
    #[serde(default, skip_serializing_if = "Sides::is_all")]
    pub sides: Sides,
    #[serde(default, skip_serializing_if = "BorderStyle::is_single")]
    pub style: BorderStyle,
    /// White by default, as TS draws a border without a color; name a token such as `border.base` to follow the theme.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<Color>,
    /// A title on the top side, in the border's color.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "TitleAlign::is_left")]
    pub title_align: TitleAlign,
}

impl Border {
    /// A single white line on all four sides.
    pub fn new() -> Self {
        Self::default()
    }

    /// The border on `sides` only.
    pub fn sides(self, sides: Sides) -> Self {
        Self { sides, ..self }
    }

    pub fn style(self, style: BorderStyle) -> Self {
        Self { style, ..self }
    }

    pub fn color(self, color: impl Into<Color>) -> Self {
        Self { color: Some(color.into()), ..self }
    }

    pub fn title(self, title: impl Into<String>) -> Self {
        Self { title: Some(title.into()), ..self }
    }

    pub fn title_align(self, title_align: TitleAlign) -> Self {
        Self { title_align, ..self }
    }
}

/// Which sides of a [`Border`] draw.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Sides {
    #[serde(default)]
    pub top: bool,
    #[serde(default)]
    pub right: bool,
    #[serde(default)]
    pub bottom: bool,
    #[serde(default)]
    pub left: bool,
}

impl Sides {
    pub const ALL: Self = Self { top: true, right: true, bottom: true, left: true };
    pub const NONE: Self = Self { top: false, right: false, bottom: false, left: false };

    fn is_all(&self) -> bool {
        *self == Self::ALL
    }
}

impl Default for Sides {
    fn default() -> Self {
        Self::ALL
    }
}

/// The lines a [`Border`] draws with.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum BorderStyle {
    #[default]
    Single,
    Double,
    Rounded,
    Heavy,
}

impl BorderStyle {
    fn is_single(&self) -> bool {
        *self == BorderStyle::Single
    }
}

/// Where a [`Border`]'s title sits on its top side.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum TitleAlign {
    #[default]
    Left,
    Center,
    Right,
}

impl TitleAlign {
    fn is_left(&self) -> bool {
        *self == TitleAlign::Left
    }
}

/// Cells at each edge of a node: its padding ([`Node::padding_sides`]) or its margin ([`Layout::margin`]).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Edges {
    #[serde(default, skip_serializing_if = "is_zero_i16")]
    pub top: i16,
    #[serde(default, skip_serializing_if = "is_zero_i16")]
    pub right: i16,
    #[serde(default, skip_serializing_if = "is_zero_i16")]
    pub bottom: i16,
    #[serde(default, skip_serializing_if = "is_zero_i16")]
    pub left: i16,
}

impl Edges {
    pub const fn new(top: i16, right: i16, bottom: i16, left: i16) -> Self {
        Self { top, right, bottom, left }
    }

    /// `cells` at every edge.
    pub const fn all(cells: i16) -> Self {
        Self::new(cells, cells, cells, cells)
    }
}

fn is_zero_i16(value: &i16) -> bool {
    *value == 0
}

/// What a [`Node::Box`] does with what does not fit in it (TS `overflow`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Overflow {
    /// It draws outside the box.
    #[default]
    Visible,
    /// The box cuts it off.
    Hidden,
}

impl Overflow {
    fn is_visible(&self) -> bool {
        *self == Overflow::Visible
    }
}

/// What a click on a node runs.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Click {
    pub action: Action,
    /// On the press of the left button, or on its release.
    pub on: Press,
}

impl Click {
    /// Runs command `name` with `input` on the release of the left button.
    pub fn command(name: impl Into<String>, input: Option<String>) -> Self {
        Self { action: Action::Command { name: name.into(), input }, on: Press::Up }
    }

    /// The click on the press of the left button instead.
    pub fn on_down(self) -> Self {
        Self { on: Press::Down, ..self }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Press {
    Down,
    Up,
}

/// What a click asks the host to do, after the event that caused it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Action {
    /// Runs a registered command, the plugin's or the host's, palette or not, as [`Host::dispatch`] does.
    Command {
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        input: Option<String>,
    },
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Justify {
    #[default]
    Start,
    End,
    Center,
    SpaceBetween,
    SpaceAround,
}

/// Where a box's children sit across its row or column.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Align {
    #[default]
    Stretch,
    Start,
    Center,
    End,
}

impl Align {
    fn is_stretch(&self) -> bool {
        *self == Align::Stretch
    }
}

impl Justify {
    fn is_start(&self) -> bool {
        *self == Justify::Start
    }
}

/// How a node takes space in its parent's row or column.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Layout {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<Width>,
    /// Takes the room left over, from its own size up.
    #[serde(default, skip_serializing_if = "is_false")]
    pub grow: bool,
    /// Whether it gives up room when its parent is too small; the host's default when `None`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shrink: Option<bool>,
    /// May shrink below its content's width.
    #[serde(default, skip_serializing_if = "is_false")]
    pub min_width_zero: bool,
    /// 1.5: its height, in rows or percent of its parent's; its content's by default.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<Width>,
    /// 1.5: the least height it takes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_height: Option<Width>,
    /// 1.5: the most height it takes.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_height: Option<Width>,
    /// 1.5: cells outside each edge; a negative margin moves the node over its neighbors.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub margin: Option<Edges>,
    /// 2.0 (P8): out of its parent's flow, placed against its edges (TS `position: "absolute"`). An older host lays it
    /// out in the flow.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub absolute: Option<Absolute>,
}

/// 2.0 (P8): where an absolute node sits: cells from its parent's edges, a negative one outside them, and its paint
/// order among its siblings (TS `top`, `right`, `bottom`, `left` and `zIndex`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Absolute {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top: Option<i16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right: Option<i16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bottom: Option<i16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub left: Option<i16>,
    #[serde(default, skip_serializing_if = "is_zero_i32")]
    pub z: i32,
}

fn is_zero_i32(value: &i32) -> bool {
    *value == 0
}

impl Layout {
    fn is_default(&self) -> bool {
        *self == Self::default()
    }

    /// The layout `height` high.
    pub fn height(self, height: Width) -> Self {
        Self { height: Some(height), ..self }
    }

    /// The layout at least `height` high.
    pub fn min_height(self, height: Width) -> Self {
        Self { min_height: Some(height), ..self }
    }

    /// The layout at most `height` high.
    pub fn max_height(self, height: Width) -> Self {
        Self { max_height: Some(height), ..self }
    }

    /// The layout with `edges` cells outside each edge.
    pub fn margin(self, edges: Edges) -> Self {
        Self { margin: Some(edges), ..self }
    }

    /// The layout `width` wide.
    pub fn width(self, width: Width) -> Self {
        Self { width: Some(width), ..self }
    }

    /// The layout that grows into the room left over.
    pub fn grow(self) -> Self {
        Self { grow: true, ..self }
    }

    /// The layout that gives up room, or not, when its parent is too small.
    pub fn shrink(self, shrink: bool) -> Self {
        Self { shrink: Some(shrink), ..self }
    }

    /// The layout that may shrink below its content's width.
    pub fn min_width_zero(self) -> Self {
        Self { min_width_zero: true, ..self }
    }
}

/// A length in cells (rows, for a height) or in percent of the parent's.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Width {
    Cells(u16),
    Percent(f32),
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Wrap {
    #[default]
    Word,
    Char,
    None,
}

impl Wrap {
    fn is_word(&self) -> bool {
        *self == Wrap::Word
    }
}

fn yes() -> bool {
    true
}

fn is_true(value: &bool) -> bool {
    *value
}

fn is_zero_u16(value: &u16) -> bool {
    *value == 0
}

fn is_no_padding(value: &(u16, u16)) -> bool {
    *value == (0, 0)
}

/// What a slot passes to the claims that render in it. A path fills what it has.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct SlotInput {
    /// `prompt.footer*`, `session.composer.top` and `sidebar.*`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// `prompt.footer*`: the prompt's mode and whether its details show.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<PromptInput>,
    /// 1.6: the width in cells a frame laid out a claim of [`Setup::sized`] at, the last time it changed (TS
    /// `onSizeChange`); 0 before its first layout, so also as it mounts, and for any other claim. When it changes,
    /// the claim renders again with [`Changed::size`] in the same frame, so that frame shows what it renders for the
    /// size; it does not mount again. A claim whose node changes its size with each render renders at most twice a
    /// frame, then again after it. A hidden claim ([`Render::Hide`]) has no size, as in TS a claim that renders nothing
    /// has no box: one that follows the width while showing nothing returns an empty [`Node::column`]. A
    /// [`Changed::size`] for a terminal resize may come before the layout, with the old width. A route has the
    /// terminal's size in [`Info::size`].
    #[serde(default, skip_serializing_if = "is_zero_u16")]
    pub width: u16,
    /// 1.6: the claim's height in rows, as `width`.
    #[serde(default, skip_serializing_if = "is_zero_u16")]
    pub height: u16,
}

/// What the prompt passes to the claims of `prompt.footer*`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct PromptInput {
    /// The prompt is in shell mode.
    pub shell: bool,
    /// The footer has room for its details: the usage and the shortcuts.
    pub show_details: bool,
}

/// What changed since a claim last rendered. A claim that has not rendered yet gets `all`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Changed {
    /// Anything may have changed.
    #[serde(default, skip_serializing_if = "is_false")]
    pub all: bool,
    /// Sessions whose info or status changed.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub sessions: Vec<String>,
    /// Sessions whose message list changed: a message came or went, or the list was read again or paged. Such a
    /// change names no message.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub lists: Vec<String>,
    /// Messages that changed in place, as session and message IDs.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub messages: Vec<(String, String)>,
    /// Locations whose info or catalogs changed.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub locations: Vec<LocationRef>,
    /// The host's own state changed: the selected model, the usage limits, the settings, the plugins' storage, and
    /// (1.6) the session tabs, the pending keys and the themes.
    #[serde(default, skip_serializing_if = "is_false")]
    pub local: bool,
    /// The terminal changed size, or (1.6) the claim did: [`SlotInput::width`] and [`SlotInput::height`].
    #[serde(default, skip_serializing_if = "is_false")]
    pub size: bool,
    /// The plugin woke the host.
    #[serde(default, skip_serializing_if = "is_false")]
    pub woken: bool,
}

impl Changed {
    pub fn everything() -> Self {
        Self { all: true, ..Self::default() }
    }

    /// Whether session `id`'s info or status may have changed.
    pub fn session(&self, id: &str) -> bool {
        self.all || self.sessions.iter().any(|session| session == id)
    }

    /// Whether session `id`'s message list may have changed.
    pub fn list(&self, id: &str) -> bool {
        self.all || self.lists.iter().any(|session| session == id)
    }

    /// Whether `location`'s info or catalogs may have changed.
    pub fn location(&self, location: &LocationRef) -> bool {
        self.all || self.locations.contains(location)
    }
}

/// A location: a directory, and a workspace in it.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct LocationRef {
    pub directory: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum SessionStatus {
    #[default]
    Idle,
    Running,
}

/// A session, from [`Read::session`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Session {
    pub info: SessionInfo,
    pub status: SessionStatus,
}

/// A session's family, from [`Read::family`]: its root and every known descendant.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Family {
    pub members: Vec<Member>,
    /// A child's own cost, or a root's cost with every known descendant's.
    pub cost: f64,
    /// The shells the session runs, in any location. Claims render again with the locations in
    /// [`Changed::locations`] when they change.
    #[serde(default, skip_serializing_if = "is_zero_usize")]
    pub shells: usize,
}

/// The host, from [`Read::info`].
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Info {
    pub version: String,
    /// The terminal's columns and rows.
    pub size: (u16, u16),
    /// Where the TUI works: the location a catalog read of `None` reads.
    pub location: LocationRef,
    /// The TUI plugins and the server plugins that failed. Claims render again with [`Changed::local`] when it changes.
    #[serde(default, skip_serializing_if = "is_zero_usize")]
    pub failed_plugins: usize,
}

fn is_zero_usize(value: &usize) -> bool {
    *value == 0
}

/// 2.0 (P6b): a TUI plugin as the host lists it, from [`Read::plugins`]: a built-in, a plugin of the `plugins`
/// config or directories, or one of those that did not load. Only the host enables or disables one, on the user's
/// pick of a [`SelectOption::toggle`] row (synthesis 3.6). What failed is not in it: an error may hold paths, data or
/// a secret of another plugin, so only the host shows it, to the user ([`ErrorDetails::plugin`]).
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct PluginEntry {
    /// The host's name for this entry and no other, which a [`SelectOption::toggle`] names: a held build may share its
    /// ID with a loaded plugin.
    pub key: String,
    /// The plugin's ID; the configured target of one that never loaded.
    pub id: String,
    /// Where it comes from: its `plugins` target or path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    pub origin: PluginOrigin,
    pub status: PluginStatus,
    /// It has an activation, failed or not (TS `registered().active`): a toggle disables it.
    #[serde(default, skip_serializing_if = "is_false")]
    pub active: bool,
    /// What its calls cost, while it is slow (synthesis 4.4).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slow: Option<String>,
}

/// Where a [`PluginEntry`] comes from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum PluginOrigin {
    Builtin,
    /// Added by the host after the built-ins, such as a test plugin.
    Added,
    /// A `plugins` entry or a found directory that did not load: there is no plugin to enable.
    Configured,
    /// Loaded from a build.
    External,
}

/// What a [`PluginEntry`] is doing.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum PluginStatus {
    Active,
    Inactive,
    /// Configured and not loaded; the host's error view says why.
    Skipped,
    /// It failed to load or while it ran; the host's error view says how.
    Failed,
    /// Found in a project and waiting for the user's approval (rich-plugins 3.9); a toggle asks.
    Pending,
    /// Found in a project, and the user declined this build; a toggle asks again.
    Declined,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Member {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
    pub status: SessionStatus,
    /// When it last changed, in milliseconds since the epoch.
    pub updated: f64,
}

/// From the host to the plugin. Results: `Fence` → `Option<Vec<Line>>`, `RenderFence` → [`Fenced`], `Render` and
/// `RenderRoute` → [`Render`], `Slot` and `Route` → `Vec<Line>`, everything else `null`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Request {
    /// The fence request of ABI 1.3, sent to a plugin whose manifest has no [`Manifest::render`]. `streaming` is set
    /// while the message streams and the fence is open.
    Fence {
        language: String,
        info: String,
        code: String,
        streaming: bool,
    },
    Slot {
        claim: usize,
        session_id: Option<String>,
    },
    Route {
        name: String,
    },
    Command {
        name: String,
        input: Option<String>,
    },
    /// 1.4: renders a fence through [`Setup::code_block`].
    RenderFence(RenderFence),
    /// 1.4: renders a slot claim of [`Setup::slot`], which [`Manifest::slots`] names by index.
    Render {
        claim: usize,
        input: SlotInput,
        changed: Changed,
    },
    /// 1.4: runs a handler of [`Setup::on_event`], which [`Manifest::events`] names by index, with one of its
    /// events.
    Event {
        handler: usize,
        event: Box<V2Event>,
    },
    /// 1.4: renders a route of [`Setup::route`].
    RenderRoute {
        name: String,
        changed: Changed,
    },
    /// 1.4: the reply to a [`Host::fetch`], for the [`Setup::on_reply`] handlers: the JSON body, or the error.
    Reply {
        id: RequestId,
        result: Result<serde_json::Value, String>,
    },
    /// 1.4: runs the [`Setup::on_mount`] handlers of the slot claim [`Manifest::slots`] names by index: `mounted` as the
    /// host mounts the claim with `input`, before it first renders, and not as it unmounts it.
    Mount {
        claim: usize,
        input: SlotInput,
        mounted: bool,
    },
    /// 1.4: runs the [`Setup::on_wake`] handlers after the plugin woke the host, before its claims render again.
    Wake,
    /// 1.4: runs the [`Setup::on_route_mount`] handlers of route `name`, which [`Manifest::route_mounts`] lists:
    /// `mounted` as the host mounts the route, before it first renders, and not as it unmounts it.
    RouteMount {
        name: String,
        mounted: bool,
    },
    /// 1.4: runs the [`Setup::on_fence_gone`] handlers with a [`Fence::key`] the host no longer shows. The host sends
    /// it only when [`Manifest::fence_gone`] is set.
    FenceGone {
        key: u64,
    },
    /// 1.6: runs the [`Setup::on_deltas`] handlers with the streaming deltas that arrived since the last time, oldest
    /// first. The host sends it only when [`Manifest::deltas`] is set.
    Deltas {
        events: Vec<V2Event>,
    },
    /// 2.0: runs the view of the surface [`Manifest::surfaces`] names by index, for `mount`, with `input`. The content
    /// it gives the host is numbered after `next`. Result: [`ViewReply`].
    View {
        surface: usize,
        mount: v2::MountId,
        input: v2::SurfaceInput,
        next: u64,
    },
    /// 2.0: runs the draw of the surface [`Manifest::surfaces`] names by index, for canvas `canvas` of `mount` at
    /// `frame` ([`v2::Draw`]). Its result is not JSON: it is the list's bytes ([`canvas`]), or none to keep the list
    /// the host holds.
    Draw {
        surface: usize,
        mount: v2::MountId,
        canvas: String,
        frame: v2::Frame,
    },
    /// 2.0: runs the view of the claim [`Manifest::claims`] names by index on `part`, for the part's `mount`, with
    /// `input`. The content it gives the host is numbered after `next`. Result: [`claim::Reply`].
    Claim {
        claim: usize,
        mount: v2::MountId,
        input: v2::SurfaceInput,
        part: claim::Part,
        next: u64,
    },
    /// 2.0: `mount` (a surface's or a claimed part's) ended; the plugin drops what it kept for it, such as its
    /// [`v2::Memo`] table.
    Unmount {
        mount: v2::MountId,
    },
    /// 2.0: runs the [`Setup::messages`] handler with a message a thread sent, in the order the mailbox holds them.
    /// The message's JSON text, as its sender wrote it.
    Message {
        message: String,
    },
    /// 2.0 (P3): runs the `layout` of the surface [`Manifest::surfaces`] names by index, after the solve, with what it
    /// named. Result: [`v2::LayoutReply`].
    Layout {
        surface: usize,
        geometry: v2::Geometry,
    },
    /// 2.0 (P2): calls the handler `to` names with `event`. Result: [`interact::Handled`].
    Input {
        to: InputTo,
        event: interact::Event,
    },
    /// 2.0 (P2): runs the search `name` of [`Setup::search`] with `query` and the select's enabled `options`. Result:
    /// the values of the options to list, in order.
    Search {
        name: String,
        query: String,
        options: Vec<SelectOption>,
    },
    /// 2.0 (P6b): runs the [`Setup::on_plugins`] handlers after the plugins the host lists changed.
    Plugins,
}

/// Whose handler a [`Request::Input`] calls: a surface's, which [`Manifest::surfaces`] names by index, for the mount
/// the host routed the event to, or a layer's of [`Setup::layer`], which [`Manifest::layers`] names by index.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum InputTo {
    /// A surface's handler, for the mount the event is for (big-boi 4), which [`Read::mount`] names to the handler;
    /// none for [`interact::Event::Mount`], which the plugin hears rather than the mount, and which names its mount.
    #[cfg_attr(not(feature = "host"), non_exhaustive)]
    Surface {
        surface: usize,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        mount: Option<v2::MountId>,
    },
    #[cfg_attr(not(feature = "host"), non_exhaustive)]
    Layer { layer: usize },
}

thread_local! {
    /// The mount of the request the SDK runs on this thread, which [`Read::mount`] names over the C ABI.
    static CALLED: std::cell::RefCell<Option<v2::MountId>> = const { std::cell::RefCell::new(None) };
}

/// Runs `f` as a call for `mount`: [`Read::mount`] names it until `f` returns or unwinds.
fn for_mount<R>(mount: Option<&v2::MountId>, f: impl FnOnce() -> R) -> R {
    struct Restore(Option<v2::MountId>);
    impl Drop for Restore {
        fn drop(&mut self) {
            CALLED.with(|called| *called.borrow_mut() = self.0.take());
        }
    }
    let _restore = Restore(CALLED.with(|called| called.replace(mount.cloned())));
    f()
}

/// What [`Request::View`] returns: the tree, the content the view gave the host with its handles, and how many values
/// the mount's [`v2::Memo`] table holds after the view.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct ViewReply {
    pub node: v2::Node,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub content: Vec<(v2::ContentRef, Blob)>,
    /// The handles the view released ([`v2::View::release`]), after the content it gave.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub released: Vec<v2::ContentRef>,
    #[serde(default, skip_serializing_if = "is_zero_usize")]
    pub memo: usize,
}

/// Content bytes on the wire, whole: a JSON string when they are UTF-8, else `{"base64": "..."}` (standard alphabet,
/// padded), so an image or any other bytes cross unchanged.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Blob(pub Vec<u8>);

impl Serialize for Blob {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match std::str::from_utf8(&self.0) {
            Ok(text) => serializer.serialize_str(text),
            Err(_) => {
                use serde::ser::SerializeMap;
                let mut map = serializer.serialize_map(Some(1))?;
                map.serialize_entry("base64", &base64::encode(&self.0))?;
                map.end()
            }
        }
    }
}

impl<'de> Deserialize<'de> for Blob {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Wire {
            Text(String),
            Bytes { base64: String },
        }
        match Wire::deserialize(deserializer)? {
            Wire::Text(text) => Ok(Blob(text.into_bytes())),
            Wire::Bytes { base64 } => {
                base64::decode(&base64).map(Blob).ok_or_else(|| serde::de::Error::custom("bad base64"))
            }
        }
    }
}

/// Base64 of RFC 4648, with padding: what [`Blob`] needs, and no dependency. A plugin reads [`Fetch::bytes`] replies and
/// writes [`Image::data`] with it.
pub mod base64 {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    /// The sextet of each byte, or [`NONE`] for a byte not in [`ALPHABET`]: a lookup a character, as an image of
    /// megabytes crosses this way (PL-9).
    const SEXTETS: [u8; 256] = {
        let mut sextets = [NONE; 256];
        let mut index = 0;
        while index < 64 {
            sextets[ALPHABET[index] as usize] = index as u8;
            index += 1;
        }
        sextets
    };
    const NONE: u8 = 0xff;

    pub fn encode(bytes: &[u8]) -> String {
        let mut out = Vec::with_capacity(bytes.len().div_ceil(3) * 4);
        let sextets = |word: u32| [18, 12, 6, 0].map(|shift| ALPHABET[(word >> shift & 63) as usize]);
        let (chunks, rest) = bytes.as_chunks::<3>();
        for [a, b, c] in chunks {
            out.extend_from_slice(&sextets(u32::from(*a) << 16 | u32::from(*b) << 8 | u32::from(*c)));
        }
        if !rest.is_empty() {
            let word =
                rest.iter().enumerate().fold(0u32, |word, (index, byte)| word | u32::from(*byte) << (16 - 8 * index));
            let mut last = sextets(word);
            last[rest.len() + 1..].fill(b'=');
            out.extend_from_slice(&last);
        }
        String::from_utf8(out).expect("the alphabet is ASCII")
    }

    pub fn decode(text: &str) -> Option<Vec<u8>> {
        let text = text.as_bytes();
        if !text.len().is_multiple_of(4) {
            return None;
        }
        let mut out = Vec::with_capacity(text.len() / 4 * 3);
        // Padding may end only the last group; in another one `=` is a byte out of the alphabet.
        let (body, last) = text.split_at(text.len().saturating_sub(4));
        for chunk in body.as_chunks::<4>().0 {
            let [a, b, c, d] = chunk.map(|byte| SEXTETS[usize::from(byte)]);
            // A sextet is under 64; only [`NONE`] has the high bit.
            if (a | b | c | d) & 0x80 != 0 {
                return None;
            }
            let word = u32::from(a) << 18 | u32::from(b) << 12 | u32::from(c) << 6 | u32::from(d);
            out.extend_from_slice(&word.to_be_bytes()[1..]);
        }
        let padding = last.iter().rev().take_while(|byte| **byte == b'=').count();
        if padding > 2 {
            return None;
        }
        let mut word = 0u32;
        for (index, byte) in last[..last.len() - padding].iter().enumerate() {
            let sextet = SEXTETS[usize::from(*byte)];
            if sextet == NONE {
                return None;
            }
            word |= u32::from(sextet) << (18 - 6 * index);
        }
        if !last.is_empty() {
            out.extend_from_slice(&word.to_be_bytes()[1..4 - padding]);
        }
        Some(out)
    }
}

/// 2.0 (P6c): the width and height in pixels the header of a PNG, GIF, JPEG or WebP image names, as the host reads it
/// before it decodes a [`v2::Node::Image`]; `None` for other bytes, and for a header that names no pixels. It reads
/// only the header: [`Read::image_size`] is what the host decodes.
pub fn image_size(bytes: &[u8]) -> Option<(u32, u32)> {
    header_size(bytes).filter(|&(width, height)| width > 0 && height > 0)
}

fn header_size(bytes: &[u8]) -> Option<(u32, u32)> {
    let at = |from: usize, len: usize| bytes.get(from..from + len);
    let be = |from: usize, len: usize| Some(at(from, len)?.iter().fold(0u32, |n, byte| n << 8 | u32::from(*byte)));
    let le =
        |from: usize, len: usize| Some(at(from, len)?.iter().rev().fold(0u32, |n, byte| n << 8 | u32::from(*byte)));
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Some((be(16, 4)?, be(20, 4)?));
    }
    if bytes.starts_with(b"GIF8") {
        return Some((le(6, 2)?, le(8, 2)?));
    }
    if bytes.starts_with(b"RIFF") && at(8, 4) == Some(b"WEBP") {
        return match at(12, 4)? {
            b"VP8 " => Some((le(26, 2)? & 0x3fff, le(28, 2)? & 0x3fff)),
            b"VP8L" => {
                let bits = le(21, 4)?;
                Some(((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1))
            }
            b"VP8X" => Some((le(24, 3)? + 1, le(27, 3)? + 1)),
            _ => None,
        };
    }
    if !bytes.starts_with(&[0xff, 0xd8]) {
        return None;
    }
    // JPEG: the segments up to the first start of frame, which holds the size. A marker may follow fill bytes of 0xff
    // (ITU-T T.81 B.1.1.2), and the standalone markers (TEM, RST0 to RST7) have no length.
    let mut from = 2;
    loop {
        if *bytes.get(from)? != 0xff {
            return None;
        }
        while *bytes.get(from + 1)? == 0xff {
            from += 1;
        }
        let marker = *bytes.get(from + 1)?;
        if (0xc0..=0xcf).contains(&marker) && ![0xc4, 0xc8, 0xcc].contains(&marker) {
            return Some((be(from + 7, 2)?, be(from + 5, 2)?));
        }
        if marker == 0x01 || (0xd0..=0xd7).contains(&marker) {
            from += 2;
            continue;
        }
        // A length covers itself, so one under 2 names no segment; a start or an end of the image before a frame is
        // no image.
        let len = be(from + 2, 2)? as usize;
        if len < 2 || marker == 0xd8 || marker == 0xd9 {
            return None;
        }
        from += 2 + len;
    }
}

/// A fence for the render of [`Setup::code_block`] that [`Manifest::fences`] names by `index`. The host matches a fence
/// to its render by the language it registered, which [`Fence::language`] may not be: the host normalizes a language
/// (`ts` becomes `typescript`), so the plugin finds its render by `index`. A host that sends no `index` matches by
/// language.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct RenderFence {
    #[serde(flatten)]
    pub fence: Fence,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub index: Option<usize>,
}

/// From the plugin to the host. Results: `StorageGet` → `Option<String>` (JSON text), `Color` → `Option<Rgba>`, the
/// reads what the [`Read`] method of the same name returns, everything else `null`.
/// A host that does not know a request answers it with an error.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum HostRequest {
    Log {
        level: Level,
        message: String,
    },
    /// A toast; `title` and `session` are 1.4 ([`Host::toast`]).
    Toast {
        variant: Variant,
        message: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        title: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        session: Option<String>,
    },
    StorageGet {
        key: String,
    },
    /// `value` is JSON text: an object or an array.
    StorageSet {
        key: String,
        value: String,
    },
    OpenRoute {
        name: String,
    },
    /// Declares a storage key during setup, so setup itself may read and write it. The [`Manifest`] still lists
    /// every key; a host that does not know this request learns them from it.
    StorageKey {
        key: String,
    },
    /// 1.4: [`Read::color`].
    Color {
        token: String,
    },
    /// 1.4: [`Read::session`].
    Session {
        id: String,
    },
    /// 1.4: [`Read::family`].
    Family {
        id: String,
    },
    /// 1.4: [`Read::messages`], as a list.
    Messages {
        id: String,
    },
    /// 2.0 (P6a): [`Read::message`], one message or null.
    Message {
        session: String,
        message: String,
    },
    /// 1.4: [`Read::models`].
    Models {
        location: Option<LocationRef>,
    },
    /// 1.4: [`Read::model`].
    Model,
    /// 1.4: [`Read::limits`].
    Limits,
    /// 1.4: [`Read::providers`].
    Providers,
    /// 1.4: [`Read::info`].
    Info,
    /// 1.4: [`Read::mcp_servers`].
    McpServers {
        location: Option<LocationRef>,
    },
    /// 1.4: [`Read::integrations`].
    Integrations {
        location: Option<LocationRef>,
    },
    /// 1.4: [`Read::vcs`].
    Vcs {
        location: Option<LocationRef>,
    },
    /// 1.4: [`Read::route`].
    Route,
    /// 1.4: [`Host::dispatch`], once the current call returns.
    Dispatch {
        name: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        input: Option<String>,
    },
    /// 1.4: [`Host::attention`], once the current call returns.
    Attention(Attention),
    /// 1.4: [`Host::navigate`], once the current call returns.
    Navigate {
        route: Route,
    },
    /// 1.4: [`Host::fetch`], sent once the current call returns; answers the [`RequestId`].
    Fetch(Fetch),
    /// 1.4: [`Host::dialog`], once the current call returns.
    Dialog {
        /// Boxed: a select is the largest request.
        dialog: Box<Dialog>,
    },
    /// 1.4: [`Host::copy`], once the current call returns.
    Copy {
        text: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        then: Option<Action>,
    },
    /// 1.4: [`Read::interactive`].
    Interactive,
    /// 1.4: [`Read::shortcut`].
    Shortcut {
        name: String,
    },
    /// 1.4: [`Read::dialog_open`].
    DialogOpen {
        key: String,
    },
    /// 1.4: [`Host::storage_merge`], which the host sets in the latest stored object under the storage lock. A plugin
    /// whose host does not know it sends [`HostRequest::StorageSet`] instead.
    StorageMerge {
        key: String,
        fields: serde_json::Map<String, serde_json::Value>,
    },
    /// 1.5: [`Read::composer`].
    Composer,
    /// 1.5: [`Host::edit_composer`], once the current call returns.
    ComposerEdit {
        edit: ComposerEdit,
    },
    /// 1.5: marks what the current call asked for so far; answers the mark, a number. The SDK sends it before each
    /// dispose callback.
    Checkpoint,
    /// 1.5: drops what the current call asked for after `mark`, and puts back the storage it wrote since: the SDK sends
    /// it when a dispose callback panicked.
    Rollback {
        mark: u64,
    },
    // 1.6: the small reads and verbs. A host older than 1.6 answers each with an error, so a read returns its
    // default and a verb does nothing and returns `false`.
    /// 1.6: [`Read::variants`].
    Variants,
    /// 1.6: [`Host::set_variant`]; answers whether it will.
    SetVariant {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        variant: Option<String>,
    },
    /// 1.6: [`Host::set_model`], once the current call returns.
    SetModel {
        provider: String,
        model: String,
    },
    /// 1.6: [`Read::tabs_enabled`].
    TabsEnabled,
    /// 1.6: [`Read::tabs`].
    Tabs,
    /// 1.6: [`Host::edit_tab`]; answers whether it will.
    Tab {
        edit: TabEdit,
    },
    /// 1.6: [`Read::keymap_pending`].
    KeymapPending,
    /// 1.6: [`Read::keymap_active`].
    KeymapActive,
    /// 1.6: [`Read::keymap_commands`].
    KeymapCommands,
    /// 1.6: [`Read::shortcuts`].
    Shortcuts {
        name: String,
    },
    /// 1.6: [`Read::selection`].
    Selection,
    /// 1.6: [`Host::clear_selection`], once the current call returns.
    ClearSelection,
    /// 1.6: [`Host::foreground`], once the current call returns; answers the [`RequestId`].
    Foreground(Foreground),
    /// 1.6: [`Host::set_title`], once the current call returns.
    Title {
        title: String,
    },
    /// 1.6: [`Read::theme`].
    Theme,
    /// 1.6: [`Read::themes`].
    Themes,
    /// 2.0 (P6b): [`Read::plugins`].
    Plugins,
    /// 2.0 (P6c): [`Read::setting`].
    Setting {
        name: String,
    },
    /// 2.0 (P6c): [`Read::image_size`] of the bytes, in base64 ([`base64::encode`]).
    ImageSize {
        bytes: String,
    },
    /// 2.0, of a host with [`IMAGE_BOUNDS`]: the bounds of the images it decodes, an [`ImageBounds`].
    ImageBounds,
    /// 2.0 (P6c): [`Host::set_setting`], once the current call returns.
    SetSetting {
        name: String,
        value: serde_json::Value,
    },
    /// 1.6: [`Host::set_theme`]; answers whether it will.
    SetTheme {
        name: String,
    },
    /// 1.6: [`Host::install_theme`], once the current call returns.
    InstallTheme {
        name: String,
        theme: serde_json::Value,
    },
    /// 2.0 (P3): [`Host::scroll`], once the current call returns.
    Scroll {
        target: v2::Target,
        verb: v2::Scroll,
    },
    /// 2.0 (P3): [`Read::scroll_state`].
    ScrollState {
        target: v2::Target,
    },
    /// 2.0 (P3): [`Read::anchors`].
    Anchors {
        target: v2::Target,
        group: String,
    },
    /// 2.0 (P3): [`Read::top_anchor`].
    TopAnchor {
        target: v2::Target,
        group: String,
        #[serde(default)]
        inset: u16,
    },
    /// 2.0 (P3): [`Read::transcript`].
    Transcript,
    /// 2.0 (P2): [`Host::open_panel`], once the current call returns.
    OpenPanel(interact::OpenPanel),
    /// 2.0 (P2): [`Host::close_panel`], once the current call returns.
    ClosePanel {
        surface: String,
    },
    /// 2.0 (P2): [`Host::overlay`], once the current call returns, for the mount whose handler runs.
    Overlay(interact::Overlay),
    /// 2.0 (P2): [`Host::close_overlay`], once the current call returns.
    CloseOverlay {
        surface: String,
    },
    /// 2.0 (P2): [`Host::focus`], once the current call returns; of a field too, on a host with [`FOCUS_INPUT`].
    Focus {
        node: String,
    },
    /// 2.0 (P2): [`Host::blur`], once the current call returns.
    Blur,
    /// 2.0 (P2): [`Host::set_mode`], once the current call returns.
    SetMode {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        mode: Option<String>,
    },
    /// 2.0 (P2): [`Host::release_keys`], once the current call returns.
    ReleaseKeys,
    /// 2.0 (P2): [`Read::rect`].
    Rect {
        node: String,
    },
    /// 2.0 (P2): [`Read::focused`].
    Focused,
    /// 2.0 (P2): [`Read::mode`].
    InputMode,
    /// 2.0 (P8): [`Read::sessions`].
    Sessions,
    /// 2.0 (P8): [`Read::pending`].
    Pending {
        id: String,
    },
}

/// 1.5: the composer on screen, from [`Read::composer`].
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Composer {
    /// The text as the composer shows it: a compact paste is its label, such as `[Pasted ~3 lines]`.
    pub text: String,
    /// The cursor, as a byte offset into `text`.
    pub cursor: usize,
    /// The composer has the keyboard focus.
    pub focused: bool,
}

/// 1.5: an edit of the composer, for [`Host::edit_composer`]. It goes through the composer's own edit path, as typed
/// input and the TS composer's `ref` do.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum ComposerEdit {
    /// Replaces the text and its attachments, and puts the cursor at the end (TS `ref.set`). The mode stays.
    Set { text: String },
    /// Inserts `text` at the cursor, in place of a selection, as typing it does.
    Insert { text: String },
    /// Submits the composer as enter does, whether or not it has focus (TS `ref.submit`); nothing while it may not
    /// submit (a home form, another pane with the input), as TS's `submit` refuses a disabled prompt.
    Submit,
}

/// 1.6: a session tab, from [`Read::tabs`] (TS `ui.tabs.list()`).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Tab {
    /// The root session the tab shows.
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// The tab is the one on screen.
    #[serde(default, skip_serializing_if = "is_false")]
    pub active: bool,
    /// The session runs.
    #[serde(default, skip_serializing_if = "is_false")]
    pub busy: bool,
    /// A permission or a question waits on the user.
    #[serde(default, skip_serializing_if = "is_false")]
    pub attention: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unread: Option<Unread>,
}

/// 1.6: what a [`Tab`] has that the user has not seen.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Unread {
    Activity,
    Error,
}

/// 1.6: a change of the session tabs, for [`Host::edit_tab`] (TS `ui.tabs.open`, `focus`, `move` and `close`). A
/// session is named by any session of its family, a tab being its root's, except in `Close`, which takes the tab's
/// own ID as TS does. Each answer counts the edits the same call made before it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum TabEdit {
    /// Opens a tab for the session without showing it. `false` while tabs are off.
    Open { session: String },
    /// Opens a tab when needed and shows it. `false` while tabs are off.
    Focus { session: String },
    /// Moves an open tab to `index`. `false` while tabs are off or it is not open.
    Move { session: String, index: usize },
    /// Closes the open tab with ID `session` (a child's ID matches none), or the one on screen without a session.
    /// `false` while tabs are off or no tab matched.
    Close {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        session: Option<String>,
    },
}

/// 1.6: one stroke of the pending key sequence, from [`Read::keymap_pending`] (TS `keymap.pending()`).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct KeymapPending {
    /// As the host shows keys, such as `ctrl+x`.
    pub key: String,
    /// The token the stroke matched, such as `leader`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token: Option<String>,
}

/// 1.6: a key that does something now, from [`Read::keymap_active`] (TS `keymap.active()`): at the root, or one that
/// continues the pending sequence.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct KeymapActive {
    pub key: String,
    /// The title of the command it runs.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    /// More keys follow before something runs.
    #[serde(default, skip_serializing_if = "is_false")]
    pub continues: bool,
}

/// 1.6: a command that can be reached now, from [`Read::keymap_commands`] (TS `keymap.commands()`).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct KeymapCommand {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    pub enabled: bool,
    /// It is in the command palette.
    #[serde(default, skip_serializing_if = "is_false")]
    pub palette: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slash: Option<KeymapSlash>,
    /// The palette promotes it.
    #[serde(default, skip_serializing_if = "is_false")]
    pub suggested: bool,
}

/// 1.6: the slash command of a [`KeymapCommand`].
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct KeymapSlash {
    pub name: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
    /// `/name` keeps its text after the name and passes it as the input.
    #[serde(default, skip_serializing_if = "is_false")]
    pub arguments: bool,
}

/// 1.6: a program to run in the foreground, for [`Host::foreground`] (TS `renderer.suspend()`, then the program, then
/// `renderer.resume()`): the host gives it the terminal and waits, as it does for `$EDITOR`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Foreground {
    /// The program, found on `PATH` when it has no directory.
    pub command: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    /// Where it runs; without one, where the TUI works when that is a directory here, else the host's own.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cwd: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Level {
    Debug,
    Info,
    Warn,
    Error,
}

/// A toast's kind, which sets its color.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Variant {
    Info,
    Success,
    Warning,
    Error,
}

/// A toast, for [`Host::toast`]. With a `session`, the toast offers to open that session unless the session's
/// family is on screen.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Toast {
    pub variant: Variant,
    pub title: Option<String>,
    pub message: String,
    pub session: Option<String>,
}

impl Toast {
    pub fn new(variant: Variant, message: impl Into<String>) -> Self {
        Self { variant, title: None, message: message.into(), session: None }
    }

    pub fn title(self, title: impl Into<String>) -> Self {
        Self { title: Some(title.into()), ..self }
    }

    /// The toast about session `id`.
    pub fn session(self, id: impl Into<String>) -> Self {
        Self { session: Some(id.into()), ..self }
    }
}

/// A request for the user's attention, for [`Host::attention`]: a desktop notification through the terminal, a
/// sound, or both, each when the user's `attention` settings allow it and its focus rule holds.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Attention {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub message: String,
    /// When to send a notification; none without.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notify: Option<When>,
    /// Which sound to play, and when; none without.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sound: Option<Sound>,
}

/// When a notification or sound goes out, by the terminal's focus.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum When {
    Always,
    Focused,
    Blurred,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Sound {
    pub name: SoundName,
    pub when: When,
    /// Overrides the user's `attention.volume`, from 0 to 1.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub volume: Option<f64>,
}

/// The sounds of the user's `attention.sounds`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum SoundName {
    Default,
    Question,
    Permission,
    Error,
    Done,
    SubagentDone,
}

/// What the host shows, from [`Read::route`].
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Route {
    #[default]
    Home,
    Session {
        id: String,
    },
    /// A plugin's route.
    Plugin {
        id: String,
        name: String,
    },
}

/// A request to the server, for [`Host::fetch`]: it goes through the host's own client, to the server the host talks
/// to now, with the host's credentials. A path that would leave that server's origin, such as
/// `/https://elsewhere/`, is refused before the credentials go on.
///
/// The reply is the JSON body of any 2xx status, or `null` without a body. An error is text: a declared server error's
/// message (else its tag), `UnexpectedStatus: <status>: <body>` for another error status (the body trimmed and cut at
/// 200 characters; without a body just `UnexpectedStatus: <status>`), `Transport: …` when the request could not be
/// sent or would leave the origin, `MalformedResponse: …` for a body that is not JSON, and `unsupported method …` or
/// `the path … does not start with /` for a request the host does not send.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[non_exhaustive]
pub struct Fetch {
    /// `GET`, `POST`, `PUT`, `PATCH` or `DELETE`.
    pub method: String,
    /// The path on the server, such as `/api/session/ses_1/generate`.
    pub path: String,
    /// Query pairs, already encoded the way the server reads them (`location[directory]`).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub query: Vec<(String, String)>,
    /// A JSON body.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<serde_json::Value>,
    /// 2.0 (P6c): the reply is the body's bytes, whatever they are (a file the server reads), as a JSON string in
    /// base64 ([`base64::decode`]).
    #[serde(default, skip_serializing_if = "is_false")]
    pub bytes: bool,
}

/// 2.0 (P6c): a setter of each field, since `Fetch` is `#[non_exhaustive]`: a plugin builds it from
/// `Fetch::default()` and sets what it needs, so a field a later 2.x adds is no break of its source.
///
/// ```
/// let fetch = opencode_plugin_abi::Fetch::default().with_method("GET".to_owned()).with_path("/api/x".to_owned());
/// assert_eq!(fetch.path, "/api/x");
/// ```
///
/// A literal, even one that takes the rest from the default, does not compile outside the SDK:
///
/// ```compile_fail,E0639
/// let fetch = opencode_plugin_abi::Fetch { path: "/api/x".to_owned(), ..Default::default() };
/// ```
impl Fetch {
    /// Sets [`Self::method`].
    pub fn with_method(mut self, method: String) -> Self {
        self.method = method;
        self
    }

    /// Sets [`Self::path`].
    pub fn with_path(mut self, path: String) -> Self {
        self.path = path;
        self
    }

    /// Sets [`Self::query`].
    pub fn with_query(mut self, query: Vec<(String, String)>) -> Self {
        self.query = query;
        self
    }

    /// Sets [`Self::body`].
    pub fn with_body(mut self, body: Option<serde_json::Value>) -> Self {
        self.body = body;
        self
    }

    /// Sets [`Self::bytes`].
    pub fn with_bytes(mut self, bytes: bool) -> Self {
        self.bytes = bytes;
        self
    }
}

/// What [`Host::fetch`] returns, and [`Setup::on_reply`] gets back with the reply.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RequestId(pub u64);

/// A dialog, for [`Host::dialog`]. It replaces the dialogs that are open, unless it is a [`Panel`] whose key is open.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Dialog {
    /// A one-line text field. Enter closes it and runs `action` with the text as its input; escape closes it.
    Prompt {
        title: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        placeholder: Option<String>,
        action: Action,
    },
    Panel(Panel),
    /// Closes the plugin's [`Panel`] `key` if it is open; since P8, with an empty `key`, whatever dialog of the plugin
    /// shows.
    Close {
        key: String,
    },
    /// A list to pick from, with a filter. Enter or a click closes it and runs its `action` with the option's value as
    /// the input; escape closes it.
    Select(Select),
    /// 1.5: a question with `Cancel` and `Confirm` buttons (TS `dialog.confirm`). A 1.4 host shows nothing.
    Confirm(Confirm),
    /// 1.5: a message with `ok` (TS `dialog.alert`). A 1.4 host shows nothing.
    Alert(Alert),
    /// 2.0: an error's details, drawn by the host's own error view (TS `DialogErrorDetails`); `back` runs from its
    /// Back button and from escape.
    ErrorDetails(ErrorDetails),
    /// P8: `dialog`, whose `dismissed` runs once as it closes, after its own action if that ran as it closed: so a
    /// plugin that waits for an answer hears of each close, also escape, the backdrop, another plugin's dialog that
    /// replaces it, or its unload (TS settles the dialog's promise in each case). An older host shows nothing.
    Dismissable {
        dialog: Box<Dialog>,
        dismissed: Action,
    },
    /// 2.0 (P6c): images in the host's image preview (TS `DialogImagePreview`), starting at `index`.
    Images(Images),
}

/// A [`Dialog::Images`].
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[non_exhaustive]
pub struct Images {
    pub images: Vec<Image>,
    #[serde(default, skip_serializing_if = "is_zero_usize")]
    pub index: usize,
}

/// 2.0 (P6c): a setter of each field, since `Images` is `#[non_exhaustive]`: a plugin builds it from
/// `Images::default()` and sets what it needs, so a field a later 2.x adds is no break of its source.
impl Images {
    /// Sets [`Self::images`].
    pub fn with_images(mut self, images: Vec<Image>) -> Self {
        self.images = images;
        self
    }

    /// Sets [`Self::index`].
    pub fn with_index(mut self, index: usize) -> Self {
        self.index = index;
        self
    }
}

/// An image of [`Images`]: its bytes in base64 ([`base64::encode`]), and the name the preview shows.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[non_exhaustive]
pub struct Image {
    pub data: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// 2.0 (P6c): a setter of each field, since `Image` is `#[non_exhaustive]`: a plugin builds it from
/// `Image::default()` and sets what it needs, so a field a later 2.x adds is no break of its source.
impl Image {
    /// Sets [`Self::data`].
    pub fn with_data(mut self, data: String) -> Self {
        self.data = data;
        self
    }

    /// Sets [`Self::name`].
    pub fn with_name(mut self, name: Option<String>) -> Self {
        self.name = name;
        self
    }
}

/// A [`Dialog::ErrorDetails`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct ErrorDetails {
    pub title: String,
    pub error: String,
    /// Where the error came from, such as a file or a package.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    /// Lines of context under the error, such as `Status: failed`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub back: Option<Action>,
    /// 2.0 (P6b): the reference the user quotes to report it (TS `diagnosticRef`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
    /// 2.0 (P6b): the plugin's name for the view, which [`Read::dialog_open`] answers for while it shows.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    /// 2.0 (P6b): the [`PluginEntry::key`] of a TUI plugin whose error this is: the host shows that plugin's own error
    /// (or why it is skipped) in place of `error`, which no plugin reads.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plugin: Option<String>,
}

/// A [`Dialog::Confirm`]. `Confirm` is active as it opens; the arrows and tab move between the buttons, and enter or a
/// click closes it and runs `action` with `true` for `Confirm` or `false` for `Cancel` as the input, as TS resolves
/// `true` or `false`. Escape cancels. When another dialog replaces it, nothing runs, as TS resolves `undefined`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Confirm {
    pub title: String,
    /// Muted text under the title.
    pub message: String,
    /// The buttons' labels, which the host shows in title case.
    #[serde(default, skip_serializing_if = "ConfirmLabel::is_default")]
    pub label: ConfirmLabel,
    pub action: Action,
    /// 2.0: the dialog's width; [`PanelSize::Medium`] when unset (TS `dialog.set({ size })`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<PanelSize>,
    /// 2.0: in the middle of the screen, not a quarter of the way down (TS `dialog.set({ centered })`).
    #[serde(default, skip_serializing_if = "is_false")]
    pub centered: bool,
}

/// The labels of a [`Confirm`]'s buttons; `confirm` and `cancel` when unset.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct ConfirmLabel {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confirm: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cancel: Option<String>,
}

impl ConfirmLabel {
    fn is_default(&self) -> bool {
        *self == Self::default()
    }
}

/// A [`Dialog::Alert`]. Enter, a click on `ok`, escape, and another dialog that replaces it all close it, and then
/// `action` runs, once, as TS resolves the alert's promise in each case.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct Alert {
    pub title: String,
    /// Muted text under the title.
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<Action>,
    /// 2.0: the dialog's width; [`PanelSize::Medium`] when unset (TS `dialog.set({ size })`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<PanelSize>,
    /// 2.0: in the middle of the screen, not a quarter of the way down (TS `dialog.set({ centered })`).
    #[serde(default, skip_serializing_if = "is_false")]
    pub centered: bool,
}

/// A [`Dialog::Select`] (TS `dialog.select`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[non_exhaustive]
pub struct Select {
    pub title: String,
    /// The filter's placeholder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub placeholder: Option<String>,
    pub options: Vec<SelectOption>,
    /// The value of the option that is marked and selected as the list opens.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current: Option<String>,
    /// What picking an option runs, with its value as the input.
    pub action: Action,
    /// 2.0: the rich select (synthesis 4.10). A select shown again while one of the plugin's with this key is open
    /// changes in place: its rows, footers and actions, with the filter and the selected row kept. Picking a row no
    /// longer closes it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    /// 2.0: actions on the selected row, in the footer with their keys; each runs with the row's value as its input.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub actions: Vec<SelectAction>,
    /// 2.0: keys that run an action with the selected row's value as its input, or none without a row.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub binds: Vec<PanelBind>,
    /// 2.0: the plugin's search of this name ([`Setup::search`]) lists the rows for the query instead of the host's
    /// filter, in its order and flat, as TS's `search` does; the host calls it as the query changes, and for the empty
    /// query as the select opens.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search: Option<String>,
    /// 2.0 (P6b): the dialog's width; [`PanelSize::Medium`] when unset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<PanelSize>,
    /// 2.0 (P6b): the value of the option selected as the list opens, without `current`'s mark.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub focus: Option<String>,
    /// 2.0 (P6c): the host lists the rows as they are and filters none; it runs this with the filter's text as the
    /// input once the text has stayed `query_delay` milliseconds, so the plugin lists the rows for it, such as from the
    /// server (TS `skipFilter` with `onFilter`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub query: Option<Action>,
    #[serde(default, skip_serializing_if = "is_zero_u16")]
    pub query_delay: u16,
    /// 2.0 (P6c): no filter field, and no filtering (TS `skipFilter` with `renderFilter={false}`).
    #[serde(default, skip_serializing_if = "is_false")]
    pub filterless: bool,
    /// 2.0 (P6c): what shows while no row does, as the text of the plugin (TS `emptyView` and `noMatchView`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub empty: Option<Span>,
    /// 2.0 (P6c): a line under the rows (TS `footer`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<Span>,
    /// 2.0: in the middle of the screen, not a quarter of the way down (TS `dialog.set({ centered })`). A host that
    /// does not know it places the select as before.
    #[serde(default, skip_serializing_if = "is_false")]
    pub centered: bool,
}

/// 2.0 (P6c): a setter of each field, since `Select` is `#[non_exhaustive]`: a plugin builds it from
/// [`Select::new`] and sets what it needs, so a field a later 2.x adds is no break of its source.
impl Select {
    /// Sets [`Self::title`].
    pub fn with_title(mut self, title: String) -> Self {
        self.title = title;
        self
    }

    /// Sets [`Self::placeholder`].
    pub fn with_placeholder(mut self, placeholder: Option<String>) -> Self {
        self.placeholder = placeholder;
        self
    }

    /// Sets [`Self::options`].
    pub fn with_options(mut self, options: Vec<SelectOption>) -> Self {
        self.options = options;
        self
    }

    /// Sets [`Self::current`].
    pub fn with_current(mut self, current: Option<String>) -> Self {
        self.current = current;
        self
    }

    /// Sets [`Self::action`].
    pub fn with_action(mut self, action: Action) -> Self {
        self.action = action;
        self
    }

    /// Sets [`Self::key`].
    pub fn with_key(mut self, key: Option<String>) -> Self {
        self.key = key;
        self
    }

    /// Sets [`Self::actions`].
    pub fn with_actions(mut self, actions: Vec<SelectAction>) -> Self {
        self.actions = actions;
        self
    }

    /// Sets [`Self::binds`].
    pub fn with_binds(mut self, binds: Vec<PanelBind>) -> Self {
        self.binds = binds;
        self
    }

    /// Sets [`Self::search`].
    pub fn with_search(mut self, search: Option<String>) -> Self {
        self.search = search;
        self
    }

    /// Sets [`Self::size`].
    pub fn with_size(mut self, size: Option<PanelSize>) -> Self {
        self.size = size;
        self
    }

    /// Sets [`Self::focus`].
    pub fn with_focus(mut self, focus: Option<String>) -> Self {
        self.focus = focus;
        self
    }

    /// Sets [`Self::query`].
    pub fn with_query(mut self, query: Option<Action>) -> Self {
        self.query = query;
        self
    }

    /// Sets [`Self::query_delay`].
    pub fn with_query_delay(mut self, query_delay: u16) -> Self {
        self.query_delay = query_delay;
        self
    }

    /// Sets [`Self::filterless`].
    pub fn with_filterless(mut self, filterless: bool) -> Self {
        self.filterless = filterless;
        self
    }

    /// Sets [`Self::empty`].
    pub fn with_empty(mut self, empty: Option<Span>) -> Self {
        self.empty = empty;
        self
    }

    /// Sets [`Self::note`].
    pub fn with_note(mut self, note: Option<Span>) -> Self {
        self.note = note;
        self
    }

    /// Sets [`Self::centered`].
    pub fn with_centered(mut self, centered: bool) -> Self {
        self.centered = centered;
        self
    }
}

impl Select {
    /// A select of `options` titled `title`, whose pick runs `action` with the option's value; the fields this crate
    /// adds later default, so a plugin built with this constructor needs no change for them.
    pub fn new(title: impl Into<String>, options: Vec<SelectOption>, action: Action) -> Self {
        Self {
            title: title.into(),
            placeholder: None,
            options,
            current: None,
            action,
            key: None,
            actions: Vec::new(),
            binds: Vec::new(),
            search: None,
            size: None,
            focus: None,
            query: None,
            query_delay: 0,
            filterless: false,
            empty: None,
            note: None,
            centered: false,
        }
    }
}

/// An option of a [`Select`].
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[non_exhaustive]
pub struct SelectOption {
    pub title: String,
    pub value: String,
    /// Muted text after the title.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Text at the right of the row.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub footer: Option<String>,
    /// The heading the option is listed under.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub disabled: bool,
    /// 2.0: the footer's color.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub footer_color: Option<Color>,
    /// 2.0: a mark left of the title.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gutter: Option<Gutter>,
    /// 2.0: what picking this row runs, with its value as the input, instead of the select's action.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<Action>,
    /// 2.0: picking this row enables or disables a plugin, which the host does, and only the host (synthesis 3.6). From
    /// 2.0 P6b it names the entry by its [`PluginEntry::key`] (an ID still names a plugin of the registry): the host draws
    /// the `enable` or `disable` action from that entry's state, naming the plugin unless the row's title is its ID,
    /// refuses the caller's own plugin and the plugin manager, and runs it after the key, if the row still names that
    /// entry; for a held build, `enable` releases it. For a project plugin waiting for approval, the host asks the user
    /// to approve or decline the build it holds; once the question closes, it runs the row's `action`, if any, with
    /// the row's value, or shows the select again on that row.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub toggle: Option<String>,
    /// 2.0 (P6b): what the filter matches beside the title and the category (TS `searchText`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub search_text: Option<String>,
}

/// 2.0 (P6c): a setter of each field, since `SelectOption` is `#[non_exhaustive]`: a plugin builds it from
/// `SelectOption::default()` and sets what it needs, so a field a later 2.x adds is no break of its source.
impl SelectOption {
    /// Sets [`Self::title`].
    pub fn with_title(mut self, title: String) -> Self {
        self.title = title;
        self
    }

    /// Sets [`Self::value`].
    pub fn with_value(mut self, value: String) -> Self {
        self.value = value;
        self
    }

    /// Sets [`Self::description`].
    pub fn with_description(mut self, description: Option<String>) -> Self {
        self.description = description;
        self
    }

    /// Sets [`Self::footer`].
    pub fn with_footer(mut self, footer: Option<String>) -> Self {
        self.footer = footer;
        self
    }

    /// Sets [`Self::category`].
    pub fn with_category(mut self, category: Option<String>) -> Self {
        self.category = category;
        self
    }

    /// Sets [`Self::disabled`].
    pub fn with_disabled(mut self, disabled: bool) -> Self {
        self.disabled = disabled;
        self
    }

    /// Sets [`Self::footer_color`].
    pub fn with_footer_color(mut self, footer_color: Option<Color>) -> Self {
        self.footer_color = footer_color;
        self
    }

    /// Sets [`Self::gutter`].
    pub fn with_gutter(mut self, gutter: Option<Gutter>) -> Self {
        self.gutter = gutter;
        self
    }

    /// Sets [`Self::action`].
    pub fn with_action(mut self, action: Option<Action>) -> Self {
        self.action = action;
        self
    }

    /// Sets [`Self::toggle`].
    pub fn with_toggle(mut self, toggle: Option<String>) -> Self {
        self.toggle = toggle;
        self
    }

    /// Sets [`Self::search_text`].
    pub fn with_search_text(mut self, search_text: Option<String>) -> Self {
        self.search_text = search_text;
        self
    }
}

/// 2.0: a mark left of a [`SelectOption`]'s title.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Gutter {
    /// The host's spinner, in the row's color.
    Spinner,
    Span(Span),
}

/// 2.0: an action of a [`Select`] on the selected row.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct SelectAction {
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    pub action: Action,
    /// The values of the rows the action is hidden on; its key then goes on to the list.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub hidden: Vec<String>,
    /// In the footer's first group, beside `enable`/`disable` (`Some(true)`), or its second; by default the first for
    /// an action on the selected row and the second for a rowless one, as TS's `group`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub primary: Option<bool>,
    /// Runs with no row and no value, so it shows and runs also while no row matches (TS `selection: "none"`).
    #[serde(default, skip_serializing_if = "is_false")]
    pub rowless: bool,
    /// 2.0 (P6b): the name of the user's keybind for it, such as `dialog.plugins.check`: for a name the host's keybinds
    /// know, the config's keys alone run it (so the user's `none` turns it off), and `key` for any other name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    /// 2.0 (P6b): shown dimmed, and its key does nothing (TS `disabled`).
    #[serde(default, skip_serializing_if = "is_false")]
    pub disabled: bool,
    /// 2.0 (P6b): hidden on every row and with none, and its key goes on to the list; a select shown again with only
    /// this changed changes in place (TS `hidden`).
    #[serde(default, skip_serializing_if = "is_false")]
    pub hidden_all: bool,
}

impl SelectOption {
    pub fn new(title: impl Into<String>, value: impl Into<String>) -> Self {
        Self { title: title.into(), value: value.into(), ..Self::default() }
    }

    pub fn description(self, description: impl Into<String>) -> Self {
        Self { description: Some(description.into()), ..self }
    }
}

/// A dialog that shows a node, live: a panel shown again while its `key` is open changes in place and keeps where its
/// body is scrolled. The host scrolls the body with the arrows, `j`/`k`, page up and down, home and end.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[non_exhaustive]
pub struct Panel {
    /// The plugin's own name for the panel; the host keeps keys of different plugins apart.
    pub key: String,
    #[serde(default)]
    pub size: PanelSize,
    /// The header's title, which keeps its width.
    pub title: Vec<Span>,
    /// Muted text after the title on the same row, cut to fit.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subtitle: Option<String>,
    pub body: Node,
    /// The footer's actions, on the right; a click runs one.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub actions: Vec<PanelAction>,
    /// Keys that run an action while the panel is open.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub binds: Vec<PanelBind>,
    /// The body is on the raised background, edge to edge, at most 60% of the screen high.
    #[serde(default, skip_serializing_if = "is_false")]
    pub bleed: bool,
    /// The panel sits in the middle of the screen, rather than near its top as a dialog does.
    #[serde(default, skip_serializing_if = "is_false")]
    pub centered: bool,
    /// P8: only the dialog's frame around the body, as TS draws a plugin's own view (`ui.dialog.show`): no header,
    /// footer, inset or scroll, and the body lays itself out. The title, actions and keys go unused. An older host
    /// shows the panel whole.
    #[serde(default, skip_serializing_if = "is_false")]
    pub bare: bool,
    /// 2.0 (P6c): the header's close label; `esc` when unset.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub close: Option<String>,
    /// 2.0 (P6c): the body's rows, whatever it holds; it scrolls inside them. A panel of a set height without actions
    /// has no footer row (TS `DialogLayout` without a footer).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub height: Option<u16>,
}

/// 2.0 (P6c): a setter of each field, since `Panel` is `#[non_exhaustive]`: a plugin builds it from
/// [`Panel::new`] and sets what it needs, so a field a later 2.x adds is no break of its source.
impl Panel {
    /// A panel of `key` with `title` over `body`, of the medium size and nothing more: set the rest with the
    /// `with_` setters, as for every request a plugin builds (`#[non_exhaustive]`, so a later field is no break).
    pub fn new(key: impl Into<String>, title: Vec<Span>, body: Node) -> Self {
        Self {
            key: key.into(),
            size: PanelSize::default(),
            title,
            subtitle: None,
            body,
            actions: Vec::new(),
            binds: Vec::new(),
            bleed: false,
            centered: false,
            bare: false,
            close: None,
            height: None,
        }
    }

    /// Sets [`Self::bare`].
    pub fn with_bare(mut self, bare: bool) -> Self {
        self.bare = bare;
        self
    }

    /// Sets [`Self::key`].
    pub fn with_key(mut self, key: String) -> Self {
        self.key = key;
        self
    }

    /// Sets [`Self::size`].
    pub fn with_size(mut self, size: PanelSize) -> Self {
        self.size = size;
        self
    }

    /// Sets [`Self::title`].
    pub fn with_title(mut self, title: Vec<Span>) -> Self {
        self.title = title;
        self
    }

    /// Sets [`Self::subtitle`].
    pub fn with_subtitle(mut self, subtitle: Option<String>) -> Self {
        self.subtitle = subtitle;
        self
    }

    /// Sets [`Self::body`].
    pub fn with_body(mut self, body: Node) -> Self {
        self.body = body;
        self
    }

    /// Sets [`Self::actions`].
    pub fn with_actions(mut self, actions: Vec<PanelAction>) -> Self {
        self.actions = actions;
        self
    }

    /// Sets [`Self::binds`].
    pub fn with_binds(mut self, binds: Vec<PanelBind>) -> Self {
        self.binds = binds;
        self
    }

    /// Sets [`Self::bleed`].
    pub fn with_bleed(mut self, bleed: bool) -> Self {
        self.bleed = bleed;
        self
    }

    /// Sets [`Self::centered`].
    pub fn with_centered(mut self, centered: bool) -> Self {
        self.centered = centered;
        self
    }

    /// Sets [`Self::close`].
    pub fn with_close(mut self, close: Option<String>) -> Self {
        self.close = close;
        self
    }

    /// Sets [`Self::height`].
    pub fn with_height(mut self, height: Option<u16>) -> Self {
        self.height = height;
        self
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum PanelSize {
    #[default]
    Medium,
    Large,
    /// 1.6: the widest (TS `xlarge`). An older host shows it [`PanelSize::Large`].
    #[serde(rename = "xlarge")]
    XLarge,
}

/// A footer action of a [`Panel`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct PanelAction {
    pub title: String,
    /// The key shown after the title; [`Panel::binds`] binds it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    /// The color of the title and the key.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<Color>,
    /// The panel closes before the action runs.
    #[serde(default, skip_serializing_if = "is_false")]
    pub close: bool,
    pub action: Action,
}

/// A key of a [`Panel`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub struct PanelBind {
    pub key: String,
    pub title: String,
    pub action: Action,
}

/// What a render reads from the host. It has no effects, so a render may call it at any time, also inside
/// [`Read::messages`]'s visitor; the host answers from what it has. A read of a catalog the host has not loaded
/// returns `None` and asks for the load, which the host starts once the plugin's callback has returned; the claim
/// then renders again with the location in [`Changed::locations`].
///
/// A host without a value answers `None` or empty.
///
/// A read is the UI thread's, as a [`Host`] is: a render cannot hand it to another thread.
///
/// ```compile_fail,E0277
/// # use opencode_plugin_abi::*;
/// fn render(read: &dyn Read) {
///     std::thread::scope(|threads| {
///         threads.spawn(|| read.tabs());
///     });
/// }
/// ```
pub trait Read {
    /// Whether the page theme is dark or light (TS `api.themeMode`).
    fn theme_mode(&self) -> ThemeMode;
    /// A color of the page theme: a token path such as `text.muted`, or a scale step such as `categorical.3.300`
    /// or `interactive.500`. `None` when the theme has no such color.
    fn color(&self, token: &str) -> Option<Rgba>;
    /// Session `id` and whether it runs, when the host knows it.
    fn session(&self, _id: &str) -> Option<Session> {
        None
    }
    /// The family of session `id`.
    fn family(&self, _id: &str) -> Family {
        Family::default()
    }
    /// 2.0 (P8): every session the host has loaded, most recently updated first, and whether each runs (TS
    /// `data.session.list()`).
    fn sessions(&self) -> Vec<Session> {
        Vec::new()
    }
    /// 2.0 (P8): the inbox items of session `id` the server has not delivered yet, in the order they were admitted
    /// (TS `data.session.pending.list()`); empty when its inbox is not loaded.
    fn pending(&self, _id: &str) -> Vec<types::SessionInboxInfo> {
        Vec::new()
    }
    /// Calls `visit` with the loaded messages of session `id`, oldest first; empty when none are loaded. In process
    /// the host lends its own list; over the C ABI the plugin gets a copy.
    fn messages(&self, _id: &str, visit: &mut dyn FnMut(&[SessionMessageInfo])) {
        visit(&[]);
    }
    /// 2.0 (P6a): calls `visit` with loaded message `message` of session `session`, or `None`. Over the C ABI only that
    /// message crosses, so a view that hears a change in place of one message reads what changed, not the session.
    fn message(&self, session: &str, message: &str, visit: &mut dyn FnMut(Option<&SessionMessageInfo>)) {
        self.messages(session, &mut |messages| visit(messages.iter().find(|item| item.id() == message)));
    }
    /// The models of `location`, or of the location the TUI works in for `None`; `None` while they are not loaded.
    fn models(&self, _location: Option<&LocationRef>) -> Option<Vec<ModelInfo>> {
        None
    }
    /// The model the next prompt uses.
    fn model(&self) -> Option<ModelRef> {
        None
    }
    /// What the OpenCode Console workspace's limits allow, where the TUI works; `None` while they are not loaded or
    /// it is not signed in.
    fn limits(&self) -> Option<UsageLimitsInfo> {
        None
    }
    /// The providers where the TUI works; `None` while they are not loaded.
    fn providers(&self) -> Option<Vec<ProviderInfo>> {
        None
    }
    /// The value stored under one of the plugin's declared storage keys ([`Setup::storage_key`]). It shows a
    /// [`Host::storage_set`] at once, before the host has written it to disk.
    fn storage_get(&self, _key: &str) -> Option<serde_json::Value> {
        None
    }
    /// The host's version, the terminal's size, and where the TUI works.
    fn info(&self) -> Info {
        Info::default()
    }
    /// The MCP servers of `location` (where the TUI works for `None`); `None` while they are not loaded.
    fn mcp_servers(&self, _location: Option<&LocationRef>) -> Option<Vec<McpServer>> {
        None
    }
    /// The integrations of `location` (where the TUI works for `None`); `None` while they are not loaded.
    fn integrations(&self, _location: Option<&LocationRef>) -> Option<Vec<IntegrationInfo>> {
        None
    }
    /// The version control state of `location` (where the TUI works for `None`); `None` while it is not loaded.
    fn vcs(&self, _location: Option<&LocationRef>) -> Option<VcsInfo> {
        None
    }
    /// What the host shows.
    fn route(&self) -> Route {
        Route::Home
    }
    /// Whether the session pane owns the input (TS `useInteractivity`): no side pane has it and no panel is full
    /// screen. Claims render again with [`Changed::all`] when it changes; a claim stays mounted.
    fn interactive(&self) -> bool {
        true
    }
    /// The first key of command `name`, as the host shows keys, such as `ctrl+p`; `None` while it has none.
    fn shortcut(&self, _name: &str) -> Option<String> {
        None
    }
    /// Whether the plugin's [`Panel`] `key` is open; 2.0: also its [`Select`] or [`ErrorDetails`] of that key.
    fn dialog_open(&self, _key: &str) -> bool {
        false
    }
    /// 1.5: the composer on screen, on home or in a session; `None` without one, while the host hides it (for a
    /// permission or a form, as TS unmounts it), and from a 1.4 host.
    fn composer(&self) -> Option<Composer> {
        None
    }
    /// 1.5: the host's minor of ABI 1, so a plugin can fall back where an older host lacks a request, such as a
    /// [`Dialog::Select`] for a [`Dialog::Confirm`] below 5. A host of ABI 2 has all of 1.x and answers [`V1_MINOR`], as
    /// does a host in process.
    fn abi_minor(&self) -> u32 {
        V1_MINOR
    }
    /// 2.0: what the host serves the plugin, as it stated at load: its major, its minor of that major, and its
    /// optional features (big-boi 13). A plugin of this SDK that uses what a later 2.x minor adds checks it here, or
    /// lowers it with [`v2::View::or`]; one that cannot work without it sets `requires_minor` on [`plugin!`] instead,
    /// and an older host refuses it. In process the host is this crate's own.
    fn abi(&self) -> Abi {
        Abi::current()
    }
    /// 1.6: the variant IDs of the model the next prompt uses (TS `ui.model.variant.list()`); its variant is
    /// [`Read::model`]'s.
    fn variants(&self) -> Vec<String> {
        Vec::new()
    }
    /// 1.6: whether session tabs are on (TS `ui.tabs.enabled()`).
    fn tabs_enabled(&self) -> bool {
        false
    }
    /// 1.6: the open session tabs, in order (TS `ui.tabs.list()`). Claims render again with [`Changed::local`] when
    /// tabs open, close or move, and with the change batch when a tab's session changes.
    fn tabs(&self) -> Vec<Tab> {
        Vec::new()
    }
    /// 1.6: the pending key sequence, one entry a stroke (TS `keymap.pending()`). Claims render again with
    /// [`Changed::local`] when it changes, so they can show [`Read::keymap_active`] too.
    fn keymap_pending(&self) -> Vec<KeymapPending> {
        Vec::new()
    }
    /// 1.6: the keys that do something now (TS `keymap.active()`).
    fn keymap_active(&self) -> Vec<KeymapActive> {
        Vec::new()
    }
    /// 1.6: the commands that can be reached now, the plugins' and the host's (TS `keymap.commands()`).
    fn keymap_commands(&self) -> Vec<KeymapCommand> {
        Vec::new()
    }
    /// 1.6: every key of command `name`, as the host shows keys (TS `keymap.shortcuts(id)`); [`Read::shortcut`] is the
    /// first.
    fn shortcuts(&self, _name: &str) -> Vec<String> {
        Vec::new()
    }
    /// 1.6: the text the mouse selected, if any (TS `renderer.getSelection()?.getSelectedText()`). A plugin can clear
    /// the selection ([`Host::clear_selection`]) but not set it.
    fn selection(&self) -> Option<String> {
        None
    }
    /// 1.6: the name of the selected theme (TS 1.x `api.theme.selected`).
    fn theme(&self) -> Option<String> {
        None
    }
    /// 1.6: the names of the themes the host has, built in and installed (TS 1.x `api.theme.has(name)`).
    fn themes(&self) -> Vec<String> {
        Vec::new()
    }
    /// 2.0 (P3): where scroll `target` is, as of the last settled frame and the current offset.
    fn scroll_state(&self, _target: &v2::Target) -> Option<v2::ScrollState> {
        None
    }
    /// 2.0 (P3): the anchors of `group` in scroll `target`, in content order. A list's items that have no widgets
    /// give theirs, their own and those inside them, hunks included, at the row the host assumes for the item.
    fn anchors(&self, _target: &v2::Target, _group: &str) -> Vec<v2::AnchorAt> {
        Vec::new()
    }
    /// 2.0 (P3): the last anchor of `group`, in content order, at or above `inset` rows below the top of `target`.
    fn top_anchor(&self, _target: &v2::Target, _group: &str, _inset: u16) -> Option<v2::AnchorAt> {
        None
    }
    /// 2.0 (P3): the published `Viewport::Transcript`, while the session route shows.
    fn transcript(&self) -> Option<v2::TranscriptView> {
        None
    }
    /// 2.0: where the node with id `id` of the running call's mount is, as the last settled frame laid it out; `None`
    /// outside a mount's call, or for an id its tree does not hold.
    fn rect(&self, _id: &str) -> Option<interact::Rect> {
        None
    }
    /// 2.0: where the focus is, for the running call's mount.
    fn focused(&self) -> interact::Focused {
        interact::Focused::default()
    }
    /// 2.0: the mode the running call's owner, its mount or else the plugin, is in ([`Host::set_mode`]); `None` in the
    /// base mode, also after the host ended the mode.
    fn mode(&self) -> Option<String> {
        None
    }
    /// 2.0: the mount the running call is for: of a surface's handler ([`v2::Surface::on`]), its view, draw and
    /// `layout`; `None` for a call of the plugin's own (a command, a layer of setup, a message) (big-boi 4). Two mounts
    /// of one surface with the same tree hear the same events: a plugin with a model per mount finds the model by it,
    /// and drops it on [`interact::Event::Mount`] or [`Request::Unmount`].
    fn mount(&self) -> Option<v2::MountId> {
        None
    }
    /// 2.0 (P6b): the TUI plugins, in the host's order; [`Setup::on_plugins`] hears when they change.
    fn plugins(&self) -> Vec<PluginEntry> {
        Vec::new()
    }
    /// 2.0 (P6c): the user's setting `name`, one of the host's named settings ([`SETTINGS`]), as the TUI config
    /// (`tui.json`) holds it; `None` when it holds none, and for a name the host does not name. A change of it is a
    /// change of the host's own state ([`Changed::local`]).
    fn setting(&self, _name: &str) -> Option<serde_json::Value> {
        None
    }
    /// 2.0 (P6c): the width and height of the image `bytes` decode to in the host, or `None` where an image node of
    /// them would show nothing: not a PNG, GIF, JPEG or WebP image, past the host's bounds, or bytes that do not
    /// decode. [`image_size`] reads only the header. Over the C ABI the bytes cross to the host in base64, and the host
    /// decodes an image within its bounds: ask once per content and keep the answer, not in each view. A host with
    /// [`IMAGE_BOUNDS`] states its bounds once, and bytes past them answer `None` without crossing.
    fn image_size(&self, _bytes: &[u8]) -> Option<(u32, u32)> {
        None
    }
}

/// 2.0 (P6c): the user's settings a plugin reads ([`Read::setting`]) and writes ([`Host::set_setting`]), by name: the
/// diff viewer's (TS `config.diffs`).
pub const SETTINGS: [&str; 5] = ["diffs.source", "diffs.view", "diffs.fullscreen", "diffs.tree", "diffs.single"];

/// What a command or an event handler reads and asks of the host. An effect waits until the outermost plugin
/// callback has returned, and effects run in the order they were asked for.
///
/// A host is the UI thread's: a plugin's own thread cannot take one, and wakes the host with a [`Waker`] instead.
///
/// ```compile_fail,E0277
/// # use opencode_plugin_abi::*;
/// fn command(host: &dyn Host) {
///     std::thread::scope(|threads| {
///         threads.spawn(|| host.edit_composer(ComposerEdit::Submit));
///     });
/// }
/// ```
///
/// ```compile_fail,E0277
/// # use opencode_plugin_abi::*;
/// fn command(host: &dyn Host) {
///     std::thread::scope(|threads| {
///         threads.spawn(|| host.foreground(Foreground { command: "true".into(), ..Foreground::default() }));
///     });
/// }
/// ```
pub trait Host: Read {
    /// Stores `value`, an object or an array, under one of the plugin's declared storage keys. [`Read::storage_get`]
    /// reads it back at once; the host writes it to disk later, and claims render again with [`Changed::local`]. The
    /// host ignores any other value, and a key that was not declared.
    fn storage_set(&self, key: &str, value: serde_json::Value);
    /// Sets `fields` in the object stored under one of the plugin's declared storage keys and keeps its other fields
    /// (TS `update((draft) => { draft.open = … })`). A host with storage sets them in the latest stored object under
    /// the storage lock, so fields another client wrote stay.
    fn storage_merge(&self, key: &str, fields: serde_json::Map<String, serde_json::Value>) {
        storage_merge_whole(self, key, fields);
    }
    /// Runs the registered command `name` with `input`, the plugin's or the host's, palette or not.
    fn dispatch(&self, name: &str, input: Option<&str>);
    /// Shows `toast`.
    fn toast(&self, toast: Toast);
    /// Asks for the user's attention.
    fn attention(&self, attention: Attention);
    /// Opens the plugin's route `name`.
    fn open_route(&self, name: &str);
    /// Shows `route`: home, a session, or a plugin's route.
    fn navigate(&self, route: Route);
    /// 1.x: [`Host::try_fetch`], but a fetch the host did not take returns `RequestId(0)`, which no reply carries, as
    /// it does on a host without fetch. It keeps that meaning until 3.0, so a 1.x plugin's source builds unchanged
    /// (O-125, O-154).
    #[deprecated(
        note = "a fetch the host does not take returns RequestId(0) and never gets a reply; `try_fetch` returns it as \
                an `Err`"
    )]
    fn fetch(&self, fetch: Fetch) -> RequestId;
    /// 2.0: sends `fetch` to the server. [`Setup::on_reply`] gets the reply, with the ID this returns, while what
    /// owns the fetch lives, on every carrier:
    ///
    /// - A fetch a mount's call asks for (a command of the route it shows, or a handler of the mount's input) is that
    ///   mount's. Once the mount closes, it is not sent, and its reply is dropped, also when the surface opens again
    ///   under the same key: a reply never reaches another mount.
    /// - Any other (setup, a global command, an event, a wake, a message, a layer of setup, and the mount's begin and
    ///   end, [`interact::Event::Mount`], which the plugin hears, not the mount) is the activation's: its reply comes
    ///   unless the plugin is disposed first.
    ///
    /// An error is a fetch the host did not take, and no reply comes for it: its queue of effects is full, as when a
    /// plugin fans out without end, or it has no server. By default, [`Host::fetch`]'s `RequestId(0)` is that error.
    #[must_use = "a fetch the host did not take gets no reply"]
    fn try_fetch(&self, fetch: Fetch) -> Result<RequestId, String> {
        #[allow(deprecated)]
        let id = self.fetch(fetch);
        (id != RequestId(0)).then_some(id).ok_or_else(|| "the host did not take the fetch".to_owned())
    }
    /// Shows `dialog`.
    fn dialog(&self, dialog: Dialog);
    /// Copies `text` to the clipboard, then runs `then` once it is copied; a toast says so when it fails.
    fn copy(&self, text: &str, then: Option<Action>);
    /// 1.5: edits the composer on screen ([`Read::composer`]); without one, and on a 1.4 host, it does nothing.
    fn edit_composer(&self, _edit: ComposerEdit) {}
    /// 1.6: selects `variant` of the model the next prompt uses, or its default for `None` (TS
    /// `ui.model.variant.set`). `false`, and nothing happens, when no model is selected or it has no such variant.
    fn set_variant(&self, _variant: Option<&str>) -> bool {
        false
    }
    /// 1.6: selects model `model` of provider `provider` for the next prompt and adds it to the recent models, as the
    /// model dialog does. A model the host does not list is ignored.
    fn set_model(&self, _provider: &str, _model: &str) {}
    /// 1.6: opens, shows, moves or closes a session tab (TS `ui.tabs.*`); whether it will.
    fn edit_tab(&self, _edit: TabEdit) -> bool {
        false
    }
    /// 1.6: clears the mouse selection (TS `renderer.clearSelection()`).
    fn clear_selection(&self) {}
    /// 1.6: [`Host::try_foreground`], but a program the host did not take returns `RequestId(0)`, which no reply
    /// carries, as on an older host. It keeps that meaning until 3.0, as [`Host::fetch`] does.
    #[deprecated(
        note = "a program the host does not take returns RequestId(0) and never gets a reply; `try_foreground` \
                returns it as an `Err`"
    )]
    fn foreground(&self, _program: Foreground) -> RequestId {
        RequestId(0)
    }
    /// 2.0: gives the terminal to `program` until it exits, then takes it back, as the host does for `$EDITOR`.
    /// [`Setup::on_reply`] gets `{ "code": <exit code or null> }` with the ID this returns, plus `"signal"` on Unix when
    /// a signal ended it, or the error when it did not start. It starts once the current call is done, and not when
    /// the plugin was disposed or failed by then, another program has the terminal, or the host has none (headless).
    /// The program has the terminal on all three standard streams and gets the signals of its keys, the host does
    /// not: on Unix it is the terminal's foreground process group, and one that stops (Ctrl+Z) is continued at once,
    /// as the host has no shell to hand it to; on Windows the host ignores Ctrl+C and Ctrl+Break while it runs. Input
    /// it leaves unread is dropped. It is owned as a fetch is ([`Host::try_fetch`]): a mount's request does not start
    /// once its mount closed, and its reply reaches no other mount. An error is a program the host did not take, as
    /// for [`Host::try_fetch`], or an older host's: no reply comes for it. By default, [`Host::foreground`]'s `RequestId(0)` is that error.
    #[must_use = "a program the host did not take gets no reply"]
    fn try_foreground(&self, program: Foreground) -> Result<RequestId, String> {
        #[allow(deprecated)]
        let id = self.foreground(program);
        (id != RequestId(0)).then_some(id).ok_or_else(|| "the host did not take the program".to_owned())
    }
    /// 1.6: sets the terminal title (TS `renderer.setTerminalTitle`). The host sets its own again with its next
    /// change, such as a route change.
    fn set_title(&self, _title: &str) {}
    /// 1.6: selects theme `name` and saves it as the user's choice, as the theme dialog does (TS 1.x
    /// `api.theme.set`). `false`, and nothing happens, for a theme the host does not have.
    fn set_theme(&self, _name: &str) -> bool {
        false
    }
    /// 1.6: writes `theme`, a theme's JSON, as `<config>/themes/<name>.json`, and lists it among the themes (TS 1.x
    /// `api.theme.install`), at once for [`Host::set_theme`] in the same call. It does not select it. A name that is
    /// not a plain file name, or a value without `theme` or `base`, installs nothing.
    fn install_theme(&self, _name: &str, _theme: serde_json::Value) {}
    /// 2.0 (P6c): saves `value` as the user's setting `name` ([`SETTINGS`]) in the TUI config, once the call returns,
    /// as the host's settings dialog does. A name the host does not name, or a value the setting does not take, is not
    /// saved.
    fn set_setting(&self, _name: &str, _value: serde_json::Value) {}
    /// 2.0 (P3): scrolls `target` by `verb` once the call returns. The transcript takes a verb from a handler of the
    /// user's input only (a key, a click, the palette, the user's scroll), never from a view, `layout`, a wake, a
    /// reply, a command the plugin dispatched or the report of its own step.
    fn scroll(&self, _target: v2::Target, _verb: v2::Scroll) {}
    /// 2.0: opens the plugin's panel surface beside a session ([`v2::Place::Panel`]); it replaces the panel on screen.
    fn open_panel(&self, _open: interact::OpenPanel) {}
    /// 2.0: closes the plugin's panel `surface`, if it shows.
    fn close_panel(&self, _surface: &str) {}
    /// 2.0: opens the plugin's overlay surface ([`v2::Place::Overlay`]); it belongs to the running call's mount, or to
    /// the plugin, and replaces the plugin's overlay on screen.
    fn overlay(&self, _overlay: interact::Overlay) {}
    /// 2.0: closes the plugin's overlay `surface`, if it shows.
    fn close_overlay(&self, _surface: &str) {}
    /// 2.0: gives the focus to the node with id `id` of the running call's mount: a box with
    /// [`interact::Interact::focusable`], or, on a host with [`FOCUS_INPUT`], a [`v2::Node::Input`], as a click does, so
    /// what the user types goes into the field. Any other node, one in a hidden box, another plugin's node and a host
    /// widget are refused, as is any focus while a host dialog is open; a host without [`FOCUS_INPUT`] refuses a field.
    /// A call the user did not cause may ask for it too, as a click can: the host does not refuse it.
    fn focus(&self, _id: &str) {}
    /// 2.0: takes the focus from the running call's mount, if it has it, and gives it to the composer.
    fn blur(&self) {}
    /// 2.0: sets the mode of the running call's owner, its mount or else the plugin: its layers of that mode hold,
    /// and the host's base layers do not. `None` ends it. It ends too when the focus leaves the owner's scope, when
    /// the owner ends, and on [`interact::RESERVED`].
    fn set_mode(&self, _mode: Option<&str>) {}
    /// 2.0: routes the keys a [`interact::Bind::hold`] key held, in order.
    fn release_keys(&self) {}
    /// Declares storage key `key` of the plugin, for [`Setup::storage_key`].
    #[doc(hidden)]
    fn declare_storage_key(&self, _key: &str) {}
    /// 1.5: marks what the current call asked for so far, for [`Host::rollback`]; `None` from a host without marks.
    #[doc(hidden)]
    fn checkpoint(&self) -> Option<u64> {
        None
    }
    /// 1.5: drops what the current call asked for after `mark`, and puts back the storage it wrote since.
    #[doc(hidden)]
    fn rollback(&self, _mark: u64) {}
}

/// [`Host::storage_merge`] by reading the stored object and setting it whole.
fn storage_merge_whole<H: Host + ?Sized>(host: &H, key: &str, fields: serde_json::Map<String, serde_json::Value>) {
    let mut object = match host.storage_get(key) {
        Some(serde_json::Value::Object(object)) => object,
        _ => serde_json::Map::new(),
    };
    object.extend(fields);
    host.storage_set(key, serde_json::Value::Object(object));
}

/// The host table, as the plugin calls it. It is valid until the host destroys the instance, so it is the plugin's
/// own: a 1.4 plugin gets it only as the [`Read`] or [`Host`] of one callback.
#[derive(Clone, Default)]
struct HostHandle {
    api: *const HostApi,
    /// The bounds of the images the host decodes, asked once, on the first [`Read::image_size`]; `None` inside for a
    /// host that has no [`IMAGE_BOUNDS`] or did not answer. The instance's own: a table at the same address after it
    /// is another host's (bigboi's final pass).
    image_bounds: Rc<std::cell::OnceCell<Option<ImageBounds>>>,
}

impl HostHandle {
    fn new(api: *const HostApi) -> Self {
        Self { api, image_bounds: Rc::default() }
    }

    fn request(&self, request: &HostRequest) -> Result<serde_json::Value, String> {
        let json = serde_json::to_vec(request).map_err(|error| error.to_string())?;
        let mut out = Owned::EMPTY;
        let core = self.core().ok_or("no host")?;
        let (Some(call), Some(free)) = (core.call, core.free) else {
            return Err("the host takes no requests".to_owned());
        };
        // SAFETY: `call` writes `out`, which goes back to `free` as the host wrote it, also when it is refused.
        let (status, bytes) = unsafe {
            let status = call(core.ctx, Bytes::new(&json), &mut out);
            (status, received(out, free))
        };
        let bytes = bytes.map_err(|error| format!("the host returned a bad result: {error}"))?;
        match status {
            OK => serde_json::from_slice(&bytes).map_err(|error| error.to_string()),
            _ => Err(String::from_utf8_lossy(&bytes).into_owned()),
        }
    }

    /// The core every host table has, the 1.1 layout; `None` for a null, misaligned or shorter table. Nothing is read
    /// through the table's own type, which may be longer than the host's.
    fn core(&self) -> Option<&HostApiV1_1> {
        if self.api.is_null() || !self.api.is_aligned() {
            return None;
        }
        // SAFETY: the host keeps the table alive until it destroys the instance, and every table starts with `size`.
        let size = unsafe { std::ptr::addr_of!((*self.api).size).read() };
        // SAFETY: `size` covers the core, a prefix of the table.
        let core = (size >= size_of::<HostApiV1_1>()).then(|| unsafe { &*self.api.cast::<HostApiV1_1>() })?;
        // A host of a major version this SDK does not speak (1 or the current) is no host it can talk to.
        matches!(core.major, 1 | ABI_MAJOR).then_some(core)
    }

    /// Whether the table's `size` covers the entry that ends at `end`.
    fn covers(&self, end: usize) -> Option<&HostApiV1_1> {
        self.core().filter(|core| core.size >= end)
    }

    /// The JSON text stored under one of the plugin's storage keys.
    fn storage_text(&self, key: &str) -> Option<String> {
        let value = self.request(&HostRequest::StorageGet { key: key.to_owned() }).ok()?;
        serde_json::from_value(value).ok().flatten()
    }

    fn log(&self, level: Level, message: &str) {
        let _ = self.request(&HostRequest::Log { level, message: message.to_owned() });
    }

    /// Whether the page theme is dark or light; `None` from a host older than 1.2.
    fn mode(&self) -> Option<ThemeMode> {
        type Entry = Option<unsafe extern "C" fn(*mut c_void) -> u32>;
        let core = self.covers(std::mem::offset_of!(HostApi, theme_mode) + size_of::<Entry>())?;
        // SAFETY: `size` covers the entry; the host keeps it valid while the instance lives.
        let mode = unsafe { (std::ptr::addr_of!((*self.api).theme_mode).read()?)(core.ctx) };
        match mode {
            THEME_DARK => Some(ThemeMode::Dark),
            THEME_LIGHT => Some(ThemeMode::Light),
            _ => None,
        }
    }

    /// A handle that wakes the host from any thread; `None` from a host older than 1.3.
    fn waker(&self) -> Option<Waker> {
        type Entry = Option<unsafe extern "C" fn(*mut c_void)>;
        let core = self.covers(std::mem::offset_of!(HostApi, wake) + size_of::<Entry>())?;
        // SAFETY: `size` covers the entry.
        let wake = unsafe { std::ptr::addr_of!((*self.api).wake).read()? };
        let ctx = Ctx(core.ctx);
        // SAFETY: `ctx` is valid until `destroy` returns, and `destroy` revokes the waker first.
        Some(Waker::new(move || unsafe { wake(ctx.get()) }))
    }

    /// What the plugin's threads reach the host through; `None` from a host older than 2.0.
    fn link(&self) -> Option<Arc<dyn mail::Link>> {
        let core = self.v2()?;
        // SAFETY: `size` covers the entries.
        let (send, report, stopped) = unsafe {
            let api = self.api;
            (
                std::ptr::addr_of!((*api).send).read()?,
                std::ptr::addr_of!((*api).report).read()?,
                std::ptr::addr_of!((*api).stopped).read()?,
            )
        };
        Some(Arc::new(AbiLink { ctx: Ctx(core.ctx), send, report, stopped }))
    }

    /// The core of a host of ABI 2 or newer whose table has every entry of 2.0: by its major, not only its size, so a
    /// 1.x host's longer table is never read as 2.0's.
    fn v2(&self) -> Option<&HostApiV1_1> {
        self.covers(std::mem::offset_of!(HostApi, features) + size_of::<Bytes>()).filter(|core| core.major >= 2)
    }

    /// The host's optional features; none from a host older than 2.0.
    fn features(&self) -> Vec<String> {
        if self.v2().is_none() {
            return Vec::new();
        }
        // SAFETY: `size` covers the entry, and the host keeps its bytes while the instance lives.
        let bytes = unsafe { std::ptr::addr_of!((*self.api).features).read().as_slice() };
        serde_json::from_slice(bytes).unwrap_or_default()
    }
}

/// [`mail::Link`] over the C ABI: the host's entries, with its `ctx`, from any thread.
struct AbiLink {
    ctx: Ctx,
    send: unsafe extern "C" fn(*mut c_void, Bytes, Bytes) -> i32,
    report: unsafe extern "C" fn(*mut c_void, Bytes),
    stopped: unsafe extern "C" fn(*mut c_void) -> u32,
}

impl mail::Link for AbiLink {
    fn json(&self) -> bool {
        true
    }

    fn send(&self, key: Option<&str>, message: mail::Outgoing) -> Result<(), (mail::Refused, mail::Outgoing)> {
        let mail::Outgoing::Json(json) = &message else { return Err((mail::Refused::Closed, message)) };
        let key = key.unwrap_or_default();
        // SAFETY: `ctx` is valid until `destroy` returns, and `destroy` revokes this link first.
        let status = unsafe { (self.send)(self.ctx.get(), Bytes::new(key.as_bytes()), Bytes::new(json.as_bytes())) };
        match status {
            OK => Ok(()),
            FULL => Err((mail::Refused::Full, message)),
            CLOSED => Err((mail::Refused::Closed, message)),
            _ => Err((mail::Refused::Unencodable, message)),
        }
    }

    fn report(&self, message: &str) {
        // SAFETY: as for `send`.
        unsafe { (self.report)(self.ctx.get(), Bytes::new(message.as_bytes())) };
    }

    fn stopped(&self) -> bool {
        // SAFETY: as for `send`.
        unsafe { (self.stopped)(self.ctx.get()) != 0 }
    }
}

impl Read for HostHandle {
    fn theme_mode(&self) -> ThemeMode {
        self.mode().unwrap_or(ThemeMode::Dark)
    }

    fn color(&self, token: &str) -> Option<Rgba> {
        self.read(&HostRequest::Color { token: token.to_owned() })
    }

    fn session(&self, id: &str) -> Option<Session> {
        self.read(&HostRequest::Session { id: id.to_owned() })
    }

    fn family(&self, id: &str) -> Family {
        self.read(&HostRequest::Family { id: id.to_owned() }).unwrap_or_default()
    }

    fn sessions(&self) -> Vec<Session> {
        self.read(&HostRequest::Sessions).unwrap_or_default()
    }

    fn pending(&self, id: &str) -> Vec<types::SessionInboxInfo> {
        self.read(&HostRequest::Pending { id: id.to_owned() }).unwrap_or_default()
    }

    fn messages(&self, id: &str, visit: &mut dyn FnMut(&[SessionMessageInfo])) {
        // The copy is the plugin's own, so `visit` may call the host again.
        let messages: Vec<SessionMessageInfo> =
            self.read(&HostRequest::Messages { id: id.to_owned() }).unwrap_or_default();
        visit(&messages);
    }

    fn message(&self, session: &str, message: &str, visit: &mut dyn FnMut(Option<&SessionMessageInfo>)) {
        let request = HostRequest::Message { session: session.to_owned(), message: message.to_owned() };
        let found: Option<SessionMessageInfo> = self.read(&request);
        visit(found.as_ref());
    }

    fn models(&self, location: Option<&LocationRef>) -> Option<Vec<ModelInfo>> {
        self.read(&HostRequest::Models { location: location.cloned() })
    }

    fn model(&self) -> Option<ModelRef> {
        self.read(&HostRequest::Model)
    }

    fn limits(&self) -> Option<UsageLimitsInfo> {
        self.read(&HostRequest::Limits)
    }

    fn providers(&self) -> Option<Vec<ProviderInfo>> {
        self.read(&HostRequest::Providers)
    }

    fn storage_get(&self, key: &str) -> Option<serde_json::Value> {
        self.storage_text(key).and_then(|json| serde_json::from_str(&json).ok())
    }

    fn info(&self) -> Info {
        self.read(&HostRequest::Info).unwrap_or_default()
    }

    fn mcp_servers(&self, location: Option<&LocationRef>) -> Option<Vec<McpServer>> {
        self.read(&HostRequest::McpServers { location: location.cloned() })
    }

    fn integrations(&self, location: Option<&LocationRef>) -> Option<Vec<IntegrationInfo>> {
        self.read(&HostRequest::Integrations { location: location.cloned() })
    }

    fn vcs(&self, location: Option<&LocationRef>) -> Option<VcsInfo> {
        self.read(&HostRequest::Vcs { location: location.cloned() })
    }

    fn route(&self) -> Route {
        self.read(&HostRequest::Route).unwrap_or_default()
    }

    fn scroll_state(&self, target: &v2::Target) -> Option<v2::ScrollState> {
        self.read(&HostRequest::ScrollState { target: target.clone() })
    }

    fn anchors(&self, target: &v2::Target, group: &str) -> Vec<v2::AnchorAt> {
        self.read(&HostRequest::Anchors { target: target.clone(), group: group.to_owned() }).unwrap_or_default()
    }

    fn top_anchor(&self, target: &v2::Target, group: &str, inset: u16) -> Option<v2::AnchorAt> {
        self.read(&HostRequest::TopAnchor { target: target.clone(), group: group.to_owned(), inset })
    }

    fn transcript(&self) -> Option<v2::TranscriptView> {
        self.read(&HostRequest::Transcript)
    }

    fn interactive(&self) -> bool {
        self.read(&HostRequest::Interactive).unwrap_or(true)
    }

    fn shortcut(&self, name: &str) -> Option<String> {
        self.read(&HostRequest::Shortcut { name: name.to_owned() })
    }

    fn dialog_open(&self, key: &str) -> bool {
        self.read(&HostRequest::DialogOpen { key: key.to_owned() }).unwrap_or(false)
    }

    fn composer(&self) -> Option<Composer> {
        self.read(&HostRequest::Composer)
    }

    fn abi_minor(&self) -> u32 {
        self.core().map_or(0, |core| if core.major >= 2 { V1_MINOR } else { core.minor })
    }

    fn abi(&self) -> Abi {
        self.core().map_or(Abi::new(0, 0, Vec::new()), |core| Abi::new(core.major, core.minor, self.features()))
    }

    fn variants(&self) -> Vec<String> {
        self.read(&HostRequest::Variants).unwrap_or_default()
    }

    fn tabs_enabled(&self) -> bool {
        self.read(&HostRequest::TabsEnabled).unwrap_or(false)
    }

    fn tabs(&self) -> Vec<Tab> {
        self.read(&HostRequest::Tabs).unwrap_or_default()
    }

    fn keymap_pending(&self) -> Vec<KeymapPending> {
        self.read(&HostRequest::KeymapPending).unwrap_or_default()
    }

    fn keymap_active(&self) -> Vec<KeymapActive> {
        self.read(&HostRequest::KeymapActive).unwrap_or_default()
    }

    fn keymap_commands(&self) -> Vec<KeymapCommand> {
        self.read(&HostRequest::KeymapCommands).unwrap_or_default()
    }

    fn shortcuts(&self, name: &str) -> Vec<String> {
        self.read(&HostRequest::Shortcuts { name: name.to_owned() }).unwrap_or_default()
    }

    fn selection(&self) -> Option<String> {
        self.read(&HostRequest::Selection)
    }

    fn theme(&self) -> Option<String> {
        self.read(&HostRequest::Theme)
    }

    fn themes(&self) -> Vec<String> {
        self.read(&HostRequest::Themes).unwrap_or_default()
    }

    fn rect(&self, id: &str) -> Option<interact::Rect> {
        self.read(&HostRequest::Rect { node: id.to_owned() }).flatten()
    }

    fn focused(&self) -> interact::Focused {
        self.read(&HostRequest::Focused).unwrap_or_default()
    }

    fn mode(&self) -> Option<String> {
        self.read(&HostRequest::InputMode).flatten()
    }

    fn mount(&self) -> Option<v2::MountId> {
        CALLED.with(|called| called.borrow().clone())
    }

    fn plugins(&self) -> Vec<PluginEntry> {
        self.read(&HostRequest::Plugins).unwrap_or_default()
    }

    fn setting(&self, name: &str) -> Option<serde_json::Value> {
        self.read(&HostRequest::Setting { name: name.to_owned() }).flatten()
    }

    fn image_size(&self, bytes: &[u8]) -> Option<(u32, u32)> {
        // Bytes past the bounds the host states are no image it decodes: no need to encode and send them (PL-9).
        if self.image_bounds().is_some_and(|bounds| bounds.over(bytes)) {
            return None;
        }
        self.read(&HostRequest::ImageSize { bytes: base64::encode(bytes) }).flatten()
    }
}

impl HostHandle {
    /// The bounds of the images the host decodes, when it states them ([`IMAGE_BOUNDS`]).
    fn image_bounds(&self) -> Option<ImageBounds> {
        *self.image_bounds.get_or_init(|| {
            let stated = self.features().iter().any(|feature| feature == IMAGE_BOUNDS);
            stated.then(|| self.read::<ImageBounds>(&HostRequest::ImageBounds)).flatten()
        })
    }
}

impl Host for HostHandle {
    fn set_setting(&self, name: &str, value: serde_json::Value) {
        if let Err(error) = self.request(&HostRequest::SetSetting { name: name.to_owned(), value }) {
            self.log(Level::Warn, &format!("setting {name}: {error}"));
        }
    }

    fn scroll(&self, target: v2::Target, verb: v2::Scroll) {
        if let Err(error) = self.request(&HostRequest::Scroll { target, verb }) {
            self.log(Level::Warn, &format!("scroll: {error}"));
        }
    }

    fn storage_set(&self, key: &str, value: serde_json::Value) {
        let request = HostRequest::StorageSet { key: key.to_owned(), value: value.to_string() };
        if let Err(error) = self.request(&request) {
            self.log(Level::Warn, &format!("storage {key}: {error}"));
        }
    }

    fn storage_merge(&self, key: &str, fields: serde_json::Map<String, serde_json::Value>) {
        let request = HostRequest::StorageMerge { key: key.to_owned(), fields: fields.clone() };
        if self.request(&request).is_err() {
            // A host older than the request sets the whole object, as plugins built before it do.
            storage_merge_whole(self, key, fields);
        }
    }

    fn dispatch(&self, name: &str, input: Option<&str>) {
        let _ = self.request(&HostRequest::Dispatch { name: name.to_owned(), input: input.map(str::to_owned) });
    }

    fn toast(&self, toast: Toast) {
        let Toast { variant, title, message, session } = toast;
        let _ = self.request(&HostRequest::Toast { variant, message, title, session });
    }

    fn attention(&self, attention: Attention) {
        let _ = self.request(&HostRequest::Attention(attention));
    }

    fn open_route(&self, name: &str) {
        let _ = self.request(&HostRequest::OpenRoute { name: name.to_owned() });
    }

    fn navigate(&self, route: Route) {
        let _ = self.request(&HostRequest::Navigate { route });
    }

    fn fetch(&self, fetch: Fetch) -> RequestId {
        // As the 1.x SDK: a host that refuses it, or has no fetch, never replies.
        self.try_fetch(fetch).unwrap_or(RequestId(0))
    }

    fn try_fetch(&self, fetch: Fetch) -> Result<RequestId, String> {
        self.requested(&HostRequest::Fetch(fetch))
    }

    fn dialog(&self, dialog: Dialog) {
        // A host older than 1.6 does not know `xlarge` and would refuse the whole dialog: it gets the largest it knows.
        let dialog = match dialog {
            Dialog::Panel(mut panel) if panel.size == PanelSize::XLarge && self.abi_minor() < 6 => {
                panel.size = PanelSize::Large;
                Dialog::Panel(panel)
            }
            dialog => dialog,
        };
        let _ = self.request(&HostRequest::Dialog { dialog: Box::new(dialog) });
    }

    fn copy(&self, text: &str, then: Option<Action>) {
        let _ = self.request(&HostRequest::Copy { text: text.to_owned(), then });
    }

    fn edit_composer(&self, edit: ComposerEdit) {
        let _ = self.request(&HostRequest::ComposerEdit { edit });
    }

    fn checkpoint(&self) -> Option<u64> {
        self.read(&HostRequest::Checkpoint)
    }

    fn rollback(&self, mark: u64) {
        let _ = self.request(&HostRequest::Rollback { mark });
    }

    fn set_variant(&self, variant: Option<&str>) -> bool {
        self.read(&HostRequest::SetVariant { variant: variant.map(str::to_owned) }).unwrap_or(false)
    }

    fn set_model(&self, provider: &str, model: &str) {
        let _ = self.request(&HostRequest::SetModel { provider: provider.to_owned(), model: model.to_owned() });
    }

    fn open_panel(&self, open: interact::OpenPanel) {
        let _ = self.request(&HostRequest::OpenPanel(open));
    }

    fn close_panel(&self, surface: &str) {
        let _ = self.request(&HostRequest::ClosePanel { surface: surface.to_owned() });
    }

    fn overlay(&self, overlay: interact::Overlay) {
        let _ = self.request(&HostRequest::Overlay(overlay));
    }

    fn close_overlay(&self, surface: &str) {
        let _ = self.request(&HostRequest::CloseOverlay { surface: surface.to_owned() });
    }

    fn focus(&self, id: &str) {
        let _ = self.request(&HostRequest::Focus { node: id.to_owned() });
    }

    fn blur(&self) {
        let _ = self.request(&HostRequest::Blur);
    }

    fn set_mode(&self, mode: Option<&str>) {
        let _ = self.request(&HostRequest::SetMode { mode: mode.map(str::to_owned) });
    }

    fn release_keys(&self) {
        let _ = self.request(&HostRequest::ReleaseKeys);
    }

    fn edit_tab(&self, edit: TabEdit) -> bool {
        self.read(&HostRequest::Tab { edit }).unwrap_or(false)
    }

    fn clear_selection(&self) {
        let _ = self.request(&HostRequest::ClearSelection);
    }

    fn foreground(&self, program: Foreground) -> RequestId {
        self.try_foreground(program).unwrap_or(RequestId(0))
    }

    fn try_foreground(&self, program: Foreground) -> Result<RequestId, String> {
        self.requested(&HostRequest::Foreground(program))
    }

    fn set_title(&self, title: &str) {
        let _ = self.request(&HostRequest::Title { title: title.to_owned() });
    }

    fn set_theme(&self, name: &str) -> bool {
        self.read(&HostRequest::SetTheme { name: name.to_owned() }).unwrap_or(false)
    }

    fn install_theme(&self, name: &str, theme: serde_json::Value) {
        let _ = self.request(&HostRequest::InstallTheme { name: name.to_owned(), theme });
    }

    fn declare_storage_key(&self, key: &str) {
        let _ = self.request(&HostRequest::StorageKey { key: key.to_owned() });
    }
}

impl HostHandle {
    /// A read's answer; `None` from a host that does not know the request or has no value.
    fn read<T: serde::de::DeserializeOwned>(&self, request: &HostRequest) -> Option<T> {
        serde_json::from_value::<Option<T>>(self.request(request).ok()?).ok().flatten()
    }

    /// The ID of the reply to `request`; an error, the host's, when it did not take it.
    fn requested(&self, request: &HostRequest) -> Result<RequestId, String> {
        match serde_json::from_value(self.request(request)?) {
            // 0 names no request, so no reply carries it: an answer of 0 is malformed (bigboi's last pass).
            Ok(RequestId(0)) => Err("the host returned a bad result: request ID 0".to_owned()),
            Ok(id) => Ok(id),
            Err(error) => Err(format!("the host answered no request ID: {error}")),
        }
    }
}

/// Wakes the host from any thread, from [`Setup::waker`] (over the C ABI, a 1.3 host's [`HostApi::wake`]): the host
/// then runs the plugin's [`Setup::on_wake`] handlers and renders its mounted slot claims and routes again, with
/// [`Changed::woken`], so a plugin that works on its own thread can show the result.
///
/// A wake is a redraw hint, not a message: it delivers nothing and drains nothing. Many wakes may become one redraw,
/// so a render must show every result that is ready, not one per wake. The host never loses the last wake, even when
/// its queue is full.
///
/// Disposing the plugin revokes every clone of the waker before its [`Setup::on_dispose`] callbacks run: it waits for
/// the wakes in progress, and a later wake does nothing. A thread that holds one may outlive the plugin; stop it in
/// [`Setup::on_dispose`] or when the plugin's state drops all the same, as the sample plugin's `Ticker` does.
#[derive(Clone)]
pub struct Waker(Arc<RwLock<Option<WakeCall>>>);

/// What a [`Waker`] calls, until it is revoked.
type WakeCall = Box<dyn Fn() + Send + Sync>;

impl Waker {
    /// A waker that calls `wake` until it is revoked.
    #[doc(hidden)]
    pub fn new(wake: impl Fn() + Send + Sync + 'static) -> Self {
        Self(Arc::new(RwLock::new(Some(Box::new(wake)))))
    }

    pub fn wake(&self) {
        if let Some(wake) = &*self.0.read().unwrap_or_else(PoisonError::into_inner) {
            wake();
        }
    }

    /// Makes every later wake of every clone do nothing, once the wakes in progress have returned.
    #[doc(hidden)]
    pub fn revoke(&self) {
        self.0.write().unwrap_or_else(PoisonError::into_inner).take();
    }
}

/// The host's `ctx` as a wake of the C ABI takes it, from any thread.
#[derive(Clone, Copy)]
struct Ctx(*mut c_void);

// SAFETY: the host's `wake` may be called from any thread with its `ctx` until `destroy` returns ([`HostApi::wake`]).
unsafe impl Send for Ctx {}
unsafe impl Sync for Ctx {}

impl Ctx {
    fn get(self) -> *mut c_void {
        self.0
    }
}

/// A registered fence render.
pub type FenceFn = Rc<dyn Fn(&dyn Read, &Fence) -> Fenced>;
/// A registered slot render.
pub type RenderFn = Rc<dyn Fn(&dyn Read, &SlotInput, &Changed) -> Render>;
type LinesFn = Box<dyn Fn(Option<&str>) -> Vec<Line>>;
/// A slot claim's render: the 1.3 rows, or a [`Render`].
enum SlotFn {
    Lines(LinesFn),
    Render(RenderFn),
}
type LinesRouteFn = Box<dyn Fn() -> Vec<Line>>;
/// A registered route render of [`Setup::route`].
pub type RouteFn = Rc<dyn Fn(&dyn Read, &Changed) -> Render>;
/// A registered reply handler.
pub type ReplyFn = Rc<dyn Fn(&dyn Host, RequestId, Result<serde_json::Value, String>)>;
/// A registered command.
pub type CommandFn = Rc<dyn Fn(&dyn Host, Option<&str>)>;
/// A registered event handler.
pub type EventFn = Rc<dyn Fn(&dyn Host, &V2Event)>;
/// A registered mount handler of [`Setup::on_mount`].
pub type MountFn = Rc<dyn Fn(&dyn Host, &SlotInput, bool)>;
/// A registered route mount handler of [`Setup::on_route_mount`].
pub type RouteMountFn = Rc<dyn Fn(&dyn Host, bool)>;
/// A registered wake handler of [`Setup::on_wake`].
pub type WakeFn = Rc<dyn Fn(&dyn Host)>;
/// A handler of [`Setup::on_fence_gone`].
pub type FenceGoneFn = Rc<dyn Fn(u64)>;
/// A handler of [`Setup::on_deltas`].
pub type DeltasFn = Rc<dyn Fn(&dyn Host, &[V2Event])>;
/// A registered dispose callback.
pub type DisposeFn = Box<dyn FnOnce(&dyn Host)>;

/// What a plugin's setup registers through, for the length of setup (the C-ABI form of P.1's `Setup`).
///
/// A callback reaches the host only through the [`Read`] or [`Host`] it is called with, so a render cannot have
/// effects. Setup itself reaches it through [`Setup::host`], which no callback can keep:
///
/// ```compile_fail,E0521
/// # use opencode_plugin_abi::*;
/// fn setup(setup: &mut Setup) -> Result<(), String> {
///     let host = setup.host();
///     setup.slot(Placement::append("home.footer"), move |_, _, _| {
///         host.dispatch("x.hello", None);
///         Render::Hide
///     });
///     Ok(())
/// }
/// ```
///
/// Nor can a callback keep the setup itself, which lends that host:
///
/// ```compile_fail,E0521
/// # use opencode_plugin_abi::*;
/// fn setup(setup: &mut Setup) -> Result<(), String> {
///     let other = Box::leak(Box::new(Registered::new("x", None))).setup();
///     let original = std::mem::replace(setup, other);
///     setup.slot(Placement::append("home.footer"), move |_, _, _| {
///         original.host().toast(Toast::new(Variant::Info, "from render"));
///         Render::Hide
///     });
///     Ok(())
/// }
/// ```
///
/// ```
/// # use opencode_plugin_abi::*;
/// fn setup(setup: &mut Setup) -> Result<(), String> {
///     setup.host().toast(Toast::new(Variant::Info, "setup may show a toast"));
///     setup.command(Command::default().with_name("x.hello".to_owned()), |host, _| {
///         host.toast(Toast::new(Variant::Info, "a command may too"));
///     });
///     Ok(())
/// }
/// ```
pub struct Setup<'a> {
    registered: &'a mut Registered,
    /// The host of setup; the registration's own without one.
    host: Option<&'a dyn Host>,
}

impl Setup<'_> {
    pub fn id(&self) -> &str {
        &self.registered.manifest.id
    }

    /// The `options` of the plugin's `plugins` entry, as JSON text.
    pub fn options(&self) -> Option<&str> {
        self.registered.options.as_deref()
    }

    /// The host while setup runs: its reads, and effects that wait until setup has returned, on the host's one effect
    /// queue.
    pub fn host(&self) -> &dyn Host {
        self.host.unwrap_or(&self.registered.host)
    }

    /// What wakes the host from the plugin's own threads; `None` from a host older than 1.3.
    pub fn waker(&self) -> Option<Waker> {
        self.registered.waker.clone()
    }

    /// Runs `run` when the host disposes the plugin: on deactivation, unload, reload, when setup fails after it was
    /// registered, and when the host exits. Callbacks run in reverse order, before the plugin's state drops, each
    /// whatever the others do. Stop the plugin's threads here or when its state drops. After a call of the plugin
    /// panicked they never run, as the host calls a failed plugin no more and keeps its instance.
    pub fn on_dispose(&mut self, run: impl FnOnce(&dyn Host) + 'static) {
        self.registered.disposers.push(Box::new(run));
    }

    /// Declares storage key `key`; [`Read::storage_get`] and [`Host::storage_set`] accept declared keys only.
    pub fn storage_key(&mut self, key: &str) {
        self.host().declare_storage_key(key);
        self.registered.manifest.storage.push(key.to_owned());
    }

    /// Registers a command; `run` receives the input it was dispatched with, such as the slash command's text after
    /// its name. A command without `palette` and `slash` is hidden: a click or [`Host::dispatch`] runs it.
    pub fn command(&mut self, command: Command, run: impl Fn(&dyn Host, Option<&str>) + 'static) {
        self.registered.commands.push(Rc::new(run));
        self.registered.manifest.commands.push(command);
    }

    /// Calls `run` with each server event whose type is one of `types` (such as `session.execution.failed`), after
    /// the host has applied it, as the HTTP API's [`V2Event`]. The streaming deltas (`session.text.delta`,
    /// `session.reasoning.delta`, `session.tool.input.delta`, `session.compaction.delta`) never arrive. A UI thread
    /// that falls more than 1024 events behind (of the types anyone in the TUI listens to) skips the oldest.
    pub fn on_event(&mut self, types: &[&str], run: impl Fn(&dyn Host, &V2Event) + 'static) {
        self.registered.manifest.events.push(types.iter().map(|kind| (*kind).to_owned()).collect());
        self.registered.events.push(Rc::new(run));
    }

    /// Renders Markdown fences of `language`.
    pub fn code_block(&mut self, language: &str, render: impl Fn(&dyn Read, &Fence) -> Fenced + 'static) {
        self.registered.manifest.fences.push(language.to_owned());
        self.registered.fences.push((language.to_owned(), Rc::new(render)));
    }

    /// Claims a place in the slot tree. `render` reads what it shows and returns it; it gets the slot's input and
    /// what changed since it last rendered, and runs again with each change batch, each change of the host's own
    /// state, each wake, and after each of the plugin's commands and event, reply, mount and wake handlers (with
    /// [`Changed::woken`]).
    pub fn slot(&mut self, at: Placement, render: impl Fn(&dyn Read, &SlotInput, &Changed) -> Render + 'static) {
        let claim = SlotClaim { kind: at.kind, path: at.path, render: true, mount: false, size: false };
        self.registered.manifest.slots.push(claim);
        self.registered.slots.push(SlotFn::Render(Rc::new(render)));
    }

    /// 1.6: gives the claim registered last at `at` (by [`Setup::slot`]) its laid-out size in [`SlotInput::width`] and
    /// [`SlotInput::height`], and renders it again with [`Changed::size`] when that changes (TS `onSizeChange`). Other
    /// claims get 0, so a size they do not read costs them no render. Without a claim at `at`, it does nothing. An
    /// older host gives 0.
    pub fn sized(&mut self, at: Placement) {
        let claims = self.registered.manifest.slots.iter_mut();
        if let Some(claim) = claims.rev().find(|claim| claim.render && claim.kind == at.kind && claim.path == at.path) {
            claim.size = true;
        }
    }

    /// Calls `run` for each mount of the claim registered last at `at` (by [`Setup::slot`]): with `true` and the slot's
    /// input as the host mounts it, before it first renders, and with `false` as it unmounts it. A plugin keeps state
    /// per mount here, such as a request a mount starts. A slot mounts its claims again when its input changes, and
    /// the next mount may come before the last one goes. Without a claim at `at`, it registers one that draws nothing.
    pub fn on_mount(&mut self, at: Placement, run: impl Fn(&dyn Host, &SlotInput, bool) + 'static) {
        let found = self
            .registered
            .manifest
            .slots
            .iter()
            .rposition(|claim| claim.render && claim.kind == at.kind && claim.path == at.path);
        let claim = match found {
            Some(claim) => claim,
            None => {
                self.slot(at, |_, _, _| Render::Hide);
                self.registered.manifest.slots.len() - 1
            }
        };
        self.registered.manifest.slots[claim].mount = true;
        self.registered.mounts.push((claim, Rc::new(run)));
    }

    /// Claims a place in the slot tree with rows, as ABI 1.3 did; `render` receives the slot's session ID, if it
    /// has one.
    pub fn slot_lines(&mut self, kind: SlotKind, path: &str, render: impl Fn(Option<&str>) -> Vec<Line> + 'static) {
        let claim = SlotClaim { kind, path: path.to_owned(), render: false, mount: false, size: false };
        self.registered.manifest.slots.push(claim);
        self.registered.slots.push(SlotFn::Lines(Box::new(render)));
    }

    /// Registers route `name`, which [`Host::navigate`] opens as [`Route::Plugin`]. The host draws what `render`
    /// returns centered in a scroll box on the page background; `render` runs again with each change, as a slot
    /// claim's does. Commands of [`Scope::Route`] run while it shows.
    pub fn route(&mut self, name: &str, render: impl Fn(&dyn Read, &Changed) -> Render + 'static) {
        self.registered.manifest.routes.push(name.to_owned());
        self.registered.manifest.render_routes.push(name.to_owned());
        self.registered.views.push((name.to_owned(), Rc::new(render)));
    }

    /// Calls `run` for each mount of route `name` (TS `onMount` of the route's page): with `true` as the host mounts
    /// it, before it first renders, however it was opened, and with `false` as it unmounts it. A route starts its
    /// requests here. The host may mount it again before the last mount goes.
    pub fn on_route_mount(&mut self, name: &str, run: impl Fn(&dyn Host, bool) + 'static) {
        if !self.registered.manifest.route_mounts.iter().any(|known| known == name) {
            self.registered.manifest.route_mounts.push(name.to_owned());
        }
        self.registered.route_mounts.push((name.to_owned(), Rc::new(run)));
    }

    /// Registers a route of rows, as ABI 1.3 did.
    pub fn route_lines(&mut self, name: &str, render: impl Fn() -> Vec<Line> + 'static) {
        self.registered.manifest.routes.push(name.to_owned());
        self.registered.routes.push((name.to_owned(), Box::new(render)));
    }

    /// Calls `run` on the UI thread after the plugin's [`Waker`] woke the host, before its claims and routes render
    /// again with [`Changed::woken`]: a plugin whose thread keeps time asks the host for what a render cannot, such as
    /// a [`Host::fetch`]. Wakes that arrive together run it once.
    pub fn on_wake(&mut self, run: impl Fn(&dyn Host) + 'static) {
        self.registered.manifest.wake = true;
        self.registered.wakes.push(Rc::new(run));
    }

    /// 2.0 (P6b): calls `run` on the UI thread after the TUI plugins [`Read::plugins`] lists changed: one was enabled,
    /// disabled, loaded, approved or declined, failed, or became slow. Changes that come together run it once.
    pub fn on_plugins(&mut self, run: impl Fn(&dyn Host) + 'static) {
        self.registered.manifest.plugins = true;
        self.registered.plugins.push(Rc::new(run));
    }

    /// Calls `run` once with the [`Fence::key`] of each block whose output ([`Fenced::Lines`] or [`Fenced::Keep`]) the
    /// host no longer shows, as the block goes or falls back to the code view: the plugin drops the state it kept for
    /// that block. A key whose render returned [`Fenced::Code`] without output shown before does not come back here. It runs on the UI thread, after the event that freed the block.
    pub fn on_fence_gone(&mut self, run: impl Fn(u64) + 'static) {
        self.registered.manifest.fence_gone = true;
        self.registered.fence_gone.push(Rc::new(run));
    }

    /// Calls `run` with each reply to the plugin's [`Host::fetch`]es, on the UI thread, with the request's ID. A reply
    /// that arrives after the plugin was disposed is dropped.
    pub fn on_reply(&mut self, run: impl Fn(&dyn Host, RequestId, Result<serde_json::Value, String>) + 'static) {
        self.registered.replies.push(Rc::new(run));
    }

    /// 1.6: calls `run` with the streaming deltas (`session.text.delta`, `session.reasoning.delta`,
    /// `session.tool.input.delta`, `session.compaction.delta`), which [`Setup::on_event`] never gets: the deltas the
    /// host applied since the last call, or since setup, oldest first, at most once a frame and before it, never
    /// empty, with a store batch's deltas in one call (TS `data.on(type)` once an event). The host keeps at most 4096
    /// between calls and drops the oldest past that. An older host never calls it.
    pub fn on_deltas(&mut self, run: impl Fn(&dyn Host, &[V2Event]) + 'static) {
        self.registered.manifest.deltas = true;
        self.registered.deltas.push(Rc::new(run));
    }

    /// Registers a surface of contract 2.0 ([`v2`]): a route or a slot claim whose view returns a keyed tree, which
    /// the host reconciles. Over the C ABI from 2.0 ([`Request::View`]).
    pub fn surface(&mut self, surface: v2::Surface) {
        let claim = SurfaceClaim {
            name: surface.name.clone(),
            place: (&surface.place).into(),
            palette: surface.palette,
            draw: surface.draw.is_some(),
            notify: surface.notify.clone(),
            layout: surface.layout.is_some(),
            handler: surface.handler.is_some(),
            layers: surface.layers.clone(),
            mounts: surface.mounts,
        };
        self.registered.manifest.surfaces.push(claim);
        self.registered.surfaces.push(surface);
    }

    /// Registers what the plugin's threads send: `run` gets each message on the UI thread, in the order the mailbox
    /// holds them, as the plugin's `update`, with the host of a command; the plugin's claims and surfaces render again
    /// after it. The [`Sender`] it returns sends from any thread (see [`mail`]). A plugin has one message type: a
    /// second call is an error. A sender of a host older than 2.0 is closed.
    pub fn messages<M>(&mut self, run: impl Fn(&dyn Host, M) + 'static) -> Result<Sender<M>, String>
    where
        M: Serialize + serde::de::DeserializeOwned + Send + 'static,
    {
        if self.registered.message.is_some() {
            return Err("a plugin has one message type: messages is registered once".to_owned());
        }
        self.registered.manifest.messages = true;
        self.registered.message = Some(Rc::new(mail::handler(run)));
        Ok(Sender::new(self.registered.link.clone()))
    }

    /// What starts the plugin's threads, each with the plugin's [`Stop`] flag and a panic caught and reported.
    pub fn spawner(&self) -> Spawner {
        Spawner::new(&self.registered.manifest.id, self.registered.link.clone())
    }

    /// The host's optional features, for a plugin that uses one when it is there.
    pub fn features(&self) -> &[String] {
        &self.registered.features
    }

    /// 2.0: what the host serves the plugin: its major, minor and features ([`Read::abi`]). Its features are
    /// [`Setup::features`], on every carrier (bigboi's final pass).
    pub fn abi(&self) -> Abi {
        let served = match self.host {
            Some(host) => host.abi(),
            None if self.registered.host.api.is_null() => Abi::current(),
            None => self.registered.host.abi(),
        };
        Abi::new(served.major, served.minor, self.registered.features.clone())
    }

    /// 2.0: a search a [`Select`] names (`search`): with the host's reads, the query and the select's enabled options,
    /// it returns the values of the options to list, in order (TS `dialog.select`'s `search`). It runs as one call of
    /// the plugin, with no effects, while the user types; over the C ABI, as [`Request::Search`].
    pub fn search(&mut self, name: &str, search: impl Fn(&dyn Read, &str, &[SelectOption]) -> Vec<String> + 'static) {
        self.registered.manifest.searches.push(name.to_owned());
        self.registered.searches.push((name.to_owned(), Rc::new(search)));
    }

    /// 2.0: keys the plugin takes while `layer`'s scope holds ([`interact::Layer`]): of the composer, or global. They
    /// are the plugin's until it leaves `active`. A layer of a surface's own scope belongs on [`v2::Surface::layers`].
    /// Over the C ABI, its handler runs as [`Request::Input`].
    pub fn layer(
        &mut self,
        layer: interact::Layer,
        handler: impl Fn(&dyn Host, &interact::Event) -> interact::Handled + 'static,
    ) {
        self.registered.manifest.layers.push(layer.clone());
        self.registered.layers.push((layer, Rc::new(handler)));
    }

    /// Registers a renderer claim of contract 2.0 ([`claim`]): the tool calls of one tool, or the fences of one
    /// language, drawn in the transcript with a keyed tree, and the host's own row where the claim declines. At one
    /// tool or language the plugin last in activation order wins.
    pub fn claim(&mut self, claim: claim::Claim) {
        self.registered.manifest.claims.push((&claim).into());
        self.registered.claims.push(claim);
    }
}

/// What a plugin registered, which the host keeps while the plugin is active; the plugin registers through a
/// [`Setup`] it lends.
#[doc(hidden)]
#[derive(Default)]
pub struct Registered {
    manifest: Manifest,
    options: Option<String>,
    host: HostHandle,
    waker: Option<Waker>,
    fences: Vec<(String, FenceFn)>,
    slots: Vec<SlotFn>,
    routes: Vec<(String, LinesRouteFn)>,
    views: Vec<(String, RouteFn)>,
    commands: Vec<CommandFn>,
    events: Vec<EventFn>,
    replies: Vec<ReplyFn>,
    /// The mount handlers, with the index of their claim in [`Manifest::slots`].
    mounts: Vec<(usize, MountFn)>,
    route_mounts: Vec<(String, RouteMountFn)>,
    wakes: Vec<WakeFn>,
    /// The handlers of [`Setup::on_plugins`].
    plugins: Vec<WakeFn>,
    fence_gone: Vec<FenceGoneFn>,
    deltas: Vec<DeltasFn>,
    disposers: Vec<DisposeFn>,
    surfaces: Vec<v2::Surface>,
    /// The handler of [`Setup::messages`].
    message: Option<MessageFn>,
    /// What the plugin's threads reach the host through; disposal revokes it.
    link: mail::Revocable,
    features: Vec<String>,
    /// The [`v2::Memo`] table of each mount, by generation, for the views of [`Request::View`].
    memos: std::cell::RefCell<std::collections::HashMap<u64, v2::Memo>>,
    layers: Vec<(interact::Layer, interact::HandlerFn)>,
    searches: Vec<(String, SearchFn)>,
    claims: Vec<claim::Claim>,
    /// What the host of the C ABI serves the plugin, read once; `None` in process.
    abi: Option<Abi>,
}

/// A registered handler of [`Setup::messages`].
pub type MessageFn = Rc<dyn Fn(&dyn Host, mail::Message)>;
/// A search of [`Setup::search`].
pub type SearchFn = Rc<dyn Fn(&dyn Read, &str, &[SelectOption]) -> Vec<String>>;

impl Registered {
    /// The registrations of a plugin the host runs in process: without an ABI host, so a [`Setup`] of its own
    /// ([`Registered::setup`]) answers every request with an error.
    pub fn new(id: &str, options: Option<String>) -> Self {
        // The host in process is this crate's, with its features.
        Self { features: Abi::current().features, ..Self::with_host(id, options, std::ptr::null()) }
    }

    /// The setup that registers here, with the registration's own host.
    pub fn setup(&mut self) -> Setup<'_> {
        Setup { registered: self, host: None }
    }

    /// The setup that registers here, with `host`.
    pub fn setup_with<'a>(&'a mut self, host: &'a dyn Host) -> Setup<'a> {
        Setup { registered: self, host: Some(host) }
    }

    /// Sets what [`Setup::waker`] returns, for a plugin the host runs in process.
    pub fn set_waker(&mut self, waker: Waker) {
        self.waker = Some(waker);
    }

    /// Sets what the plugin's threads reach the host through ([`Setup::messages`], [`Setup::spawner`]), for a plugin
    /// the host runs in process.
    pub fn set_link(&mut self, link: Arc<dyn mail::Link>) {
        self.link = mail::Revocable::new(link);
    }

    /// The handler of [`Setup::messages`].
    pub fn message(&self) -> Option<&MessageFn> {
        self.message.as_ref()
    }

    /// Disposes the plugin: revokes its waker and its threads' link, waiting for the uses in progress, then runs the
    /// dispose callbacks, last registered first, with `host` (the registration's own without one). A callback that
    /// panics does not keep the others from running.
    pub fn dispose(&mut self, host: Option<&dyn Host>) {
        if let Some(waker) = &self.waker {
            waker.revoke();
        }
        self.link.revoke();
        let (disposers, own) = (std::mem::take(&mut self.disposers), self.host.clone());
        let host = host.unwrap_or(&own);
        for run in disposers.into_iter().rev() {
            // What a callback that panics asked for is dropped, and what the others asked for stays.
            let mark = host.checkpoint();
            if let Err(panic) = catch_unwind(AssertUnwindSafe(|| run(host))) {
                if let Some(mark) = mark {
                    host.rollback(mark);
                }
                own.log(Level::Error, &format!("a dispose callback panicked: {}", panic_message(&*panic)));
            }
        }
    }

    /// Ends a plugin the host failed, which it calls no more: revokes its waker, waiting for the wakes in progress,
    /// and drops its dispose callbacks without running them.
    pub fn abandon(&mut self) {
        if let Some(waker) = &self.waker {
            waker.revoke();
        }
        self.link.revoke();
        self.disposers.clear();
    }

    pub fn manifest(&self) -> &Manifest {
        &self.manifest
    }

    pub fn fences(&self) -> &[(String, FenceFn)] {
        &self.fences
    }

    /// The slot claims of [`Setup::slot`], with their index in [`Manifest::slots`] and their renders.
    pub fn renders(&self) -> impl Iterator<Item = (usize, &SlotClaim, &RenderFn)> {
        self.manifest.slots.iter().zip(&self.slots).enumerate().filter_map(|(index, (claim, render))| match render {
            SlotFn::Render(render) => Some((index, claim, render)),
            SlotFn::Lines(_) => None,
        })
    }

    /// The mount handlers, with the index of their claim in [`Manifest::slots`].
    pub fn mounts(&self) -> &[(usize, MountFn)] {
        &self.mounts
    }

    /// The route mount handlers, with their route.
    pub fn route_mounts(&self) -> &[(String, RouteMountFn)] {
        &self.route_mounts
    }

    /// The commands, with their runs.
    pub fn commands(&self) -> impl Iterator<Item = (&Command, &CommandFn)> {
        self.manifest.commands.iter().zip(&self.commands)
    }

    /// The routes of [`Setup::route`], with their renders.
    pub fn routes(&self) -> &[(String, RouteFn)] {
        &self.views
    }

    /// The wake handlers.
    pub fn wakes(&self) -> &[WakeFn] {
        &self.wakes
    }

    /// The handlers of [`Setup::on_plugins`].
    pub fn plugins(&self) -> &[WakeFn] {
        &self.plugins
    }

    /// The handlers of [`Setup::on_fence_gone`].
    pub fn fence_gone(&self) -> &[FenceGoneFn] {
        &self.fence_gone
    }

    /// The reply handlers.
    pub fn replies(&self) -> &[ReplyFn] {
        &self.replies
    }

    /// The handlers of [`Setup::on_deltas`].
    pub fn deltas(&self) -> &[DeltasFn] {
        &self.deltas
    }

    /// The surfaces of [`Setup::surface`].
    pub fn surfaces(&self) -> &[v2::Surface] {
        &self.surfaces
    }

    /// The searches of [`Setup::search`], by name.
    pub fn searches(&self) -> &[(String, SearchFn)] {
        &self.searches
    }

    /// The layers of [`Setup::layer`], with their handlers.
    pub fn layers(&self) -> &[(interact::Layer, interact::HandlerFn)] {
        &self.layers
    }

    /// The renderer claims of [`Setup::claim`].
    pub fn claims(&self) -> &[claim::Claim] {
        &self.claims
    }

    /// The event handlers, with the types each takes.
    pub fn events(&self) -> impl Iterator<Item = (&[String], &EventFn)> {
        self.manifest.events.iter().map(Vec::as_slice).zip(&self.events)
    }

    fn with_host(id: &str, options: Option<String>, host: *const HostApi) -> Self {
        let host = HostHandle::new(host);
        Self {
            manifest: Manifest { id: id.to_owned(), render: RENDER, ..Manifest::default() },
            options,
            waker: host.waker(),
            link: host.link().map(mail::Revocable::new).unwrap_or_default(),
            features: host.features(),
            abi: host.core().map(|_| host.abi()),
            host,
            ..Self::default()
        }
    }

    /// Runs the draw of surface `surface` for `canvas` of `mount` at `frame` ([`Request::Draw`]): the list's bytes,
    /// or none to keep the list.
    fn draw(&self, surface: usize, mount: &v2::MountId, canvas: &str, frame: v2::Frame) -> Result<Vec<u8>, String> {
        let surface = self.surfaces.get(surface).ok_or("no such surface")?;
        let draw = surface.draw.as_ref().ok_or("the surface has no draw")?;
        let list = for_mount(Some(mount), || draw(&mut v2::Draw { read: &self.host, mount, canvas, frame }));
        Ok(list.map(canvas::List::into_bytes).unwrap_or_default())
    }

    /// Refuses a tree that holds a node kind the host lacks, before it crosses: the author lowers it with
    /// [`v2::View::or`] (big-boi 13).
    fn lowered(&self, node: &v2::Node) -> Result<(), String> {
        let host = self.abi.as_ref().map_or_else(String::new, |abi| format!("{}.{}", abi.major, abi.minor));
        if let Some(feature) = self.abi.as_ref().and_then(|abi| v2::unknown_feature(node, abi)) {
            return Err(format!(
                "the view returned a node of the feature {feature}, which this host ({host}) lacks; lower it with View::or"
            ));
        }
        let Some(minor) = self.abi.as_ref().and_then(|abi| v2::unknown_to(node, abi)) else { return Ok(()) };
        Err(format!(
            "the view returned a node of ABI {ABI_MAJOR}.{minor}, which this host ({host}) lacks; lower it with View::or"
        ))
    }

    fn handle(&self, request: Request) -> Result<serde_json::Value, String> {
        let json = |value: Result<serde_json::Value, serde_json::Error>| value.map_err(|error| error.to_string());
        match request {
            Request::Fence { .. } => Err("this plugin renders fences through render-fence".to_owned()),
            Request::RenderFence(RenderFence { fence, index }) => {
                let render = match index {
                    Some(index) => self.fences.get(index),
                    None => self.fences.iter().find(|(language, _)| *language == fence.language),
                };
                let fenced = render.map_or(Fenced::Code, |(_, render)| render(&self.host, &fence));
                json(serde_json::to_value(fenced))
            }
            Request::Slot { claim, session_id } => match self.slots.get(claim).ok_or("no such slot claim")? {
                SlotFn::Lines(render) => json(serde_json::to_value(render(session_id.as_deref()))),
                SlotFn::Render(_) => Err("this slot claim renders through render".to_owned()),
            },
            Request::Render { claim, input, changed } => match self.slots.get(claim).ok_or("no such slot claim")? {
                SlotFn::Render(render) => json(serde_json::to_value(render(&self.host, &input, &changed))),
                SlotFn::Lines(_) => Err("this slot claim renders through slot".to_owned()),
            },
            Request::Route { name } => {
                let (_, render) = self.routes.iter().find(|(route, _)| *route == name).ok_or("no such route")?;
                json(serde_json::to_value(render()))
            }
            Request::Command { name, input } => {
                let (_, run) = self.commands().find(|(command, _)| command.name == name).ok_or("no such command")?;
                run(&self.host, input.as_deref());
                Ok(serde_json::Value::Null)
            }
            Request::Event { handler, event } => {
                self.events.get(handler).ok_or("no such event handler")?(&self.host, &event);
                Ok(serde_json::Value::Null)
            }
            Request::RenderRoute { name, changed } => {
                let (_, render) = self.views.iter().find(|(route, _)| *route == name).ok_or("no such route")?;
                json(serde_json::to_value(render(&self.host, &changed)))
            }
            // 0 names no request, so no handler hears a reply to it (bigboi's freeze pass).
            Request::Reply { id: RequestId(0), .. } => Err("the host sent a reply to request ID 0".to_owned()),
            Request::Reply { id, result } => {
                self.replies.iter().for_each(|run| run(&self.host, id, result.clone()));
                Ok(serde_json::Value::Null)
            }
            Request::Mount { claim, input, mounted } => {
                let runs = self.mounts.iter().filter(|(index, _)| *index == claim);
                runs.for_each(|(_, run)| run(&self.host, &input, mounted));
                Ok(serde_json::Value::Null)
            }
            Request::Wake => {
                self.wakes.iter().for_each(|run| run(&self.host));
                Ok(serde_json::Value::Null)
            }
            Request::Plugins => {
                self.plugins.iter().for_each(|run| run(&self.host));
                Ok(serde_json::Value::Null)
            }
            Request::RouteMount { name, mounted } => {
                let runs = self.route_mounts.iter().filter(|(route, _)| *route == name);
                runs.for_each(|(_, run)| run(&self.host, mounted));
                Ok(serde_json::Value::Null)
            }
            Request::FenceGone { key } => {
                self.fence_gone.iter().for_each(|run| run(key));
                Ok(serde_json::Value::Null)
            }
            Request::Deltas { events } => {
                self.deltas.iter().for_each(|run| run(&self.host, &events));
                Ok(serde_json::Value::Null)
            }
            Request::View { surface, mount, input, next } => {
                let surface = self.surfaces.get(surface).ok_or("no such surface")?;
                let mut memo = self.memos.borrow_mut().remove(&mount.generation).unwrap_or_default();
                let (mut next, mut content, mut released) = (next, Vec::new(), Vec::new());
                let mut give = |bytes: Vec<u8>| {
                    next += 1;
                    content.push((v2::ContentRef(next), Blob(bytes)));
                    v2::ContentRef(next)
                };
                let mut release = |handle| released.push(handle);
                let node = for_mount(Some(&mount), || {
                    (surface.view)(&mut v2::View::new(&self.host, &input, &mount, &mut memo, &mut give, &mut release))
                });
                self.lowered(&node)?;
                // The table keeps what the returned tree holds. A tree the host refuses is followed by a request for a
                // whole one, whose view starts with an empty table.
                memo.finish(std::slice::from_ref(&node));
                let reply = ViewReply { node, content, released, memo: memo.len() };
                self.memos.borrow_mut().insert(mount.generation, memo);
                json(serde_json::to_value(reply))
            }
            Request::Draw { .. } => Err("a draw answers with the list's bytes, not JSON".to_owned()),
            Request::Claim { claim, mount, input, part, next } => {
                let claim = self.claims.get(claim).ok_or("no such claim")?;
                let mut memo = self.memos.borrow_mut().remove(&mount.generation).unwrap_or_default();
                let (mut next, mut content, mut released) = (next, Vec::new(), Vec::new());
                let mut give = |bytes: Vec<u8>| {
                    next += 1;
                    content.push((v2::ContentRef(next), Blob(bytes)));
                    v2::ContentRef(next)
                };
                let mut release = |handle| released.push(handle);
                let node = for_mount(Some(&mount), || {
                    (claim.view)(
                        &mut v2::View::new(&self.host, &input, &mount, &mut memo, &mut give, &mut release),
                        &part,
                    )
                });
                if let Some(node) = &node {
                    self.lowered(node)?;
                }
                // A declined part keeps its table: the host asks for a whole tree when it next shows the part.
                match &node {
                    Some(node) => memo.finish(std::slice::from_ref(node)),
                    None => memo.discard(),
                }
                let reply = claim::Reply { node, content, released, memo: memo.len() };
                self.memos.borrow_mut().insert(mount.generation, memo);
                json(serde_json::to_value(reply))
            }
            Request::Unmount { mount } => {
                self.memos.borrow_mut().remove(&mount.generation);
                Ok(serde_json::Value::Null)
            }
            Request::Message { message } => {
                let run = self.message.as_ref().ok_or("no message handler")?;
                run(&self.host, mail::Message::Json(message));
                Ok(serde_json::Value::Null)
            }
            Request::Layout { surface, geometry } => {
                let layout =
                    self.surfaces.get(surface).and_then(|surface| surface.layout.as_ref()).ok_or("no layout")?;
                json(serde_json::to_value(for_mount(geometry.mount.as_ref(), || layout(&geometry))))
            }
            Request::Input { to, event } => {
                let (handler, mount) = match to {
                    InputTo::Surface { surface, mount } => {
                        (self.surfaces.get(surface).and_then(|surface| surface.handler.clone()), mount)
                    }
                    InputTo::Layer { layer } => (self.layers.get(layer).map(|(_, handler)| handler.clone()), None),
                };
                let handler = handler.ok_or("no such handler")?;
                json(serde_json::to_value(for_mount(mount.as_ref(), || handler(&self.host, &event))))
            }
            Request::Search { name, query, options } => {
                let (_, search) = self.searches.iter().find(|(known, _)| *known == name).ok_or("no such search")?;
                json(serde_json::to_value(search(&self.host, &query, &options)))
            }
        }
    }
}

/// A plugin the host runs in process: its ID and setup, as [`export_plugin!`] takes them.
#[derive(Clone, Copy)]
pub struct Plugin {
    pub id: &'static str,
    pub setup: fn(&mut Setup) -> Result<(), String>,
}

/// Exports a plugin from its setup, `fn setup(setup: &mut Setup) -> Result<(), String>`: `plugin!(setup)` with the
/// crate's package name as the plugin's ID, or `plugin!(id = "my.plugin", setup)`. The macro holds every `unsafe` the
/// C ABI needs: it exports [`ENTRY`] with the current [`PluginApi`], catches every panic at the edge, and describes
/// the plugin with the crate's version, so the author writes none.
///
/// A plugin that cannot work without what a later 2.x minor adds asks for that host with `requires_minor`, and an older
/// host refuses it at load with a message naming both versions; one that can do without reads [`Read::abi`] and falls
/// back ([`v2::View::or`]). One that needs an optional host feature names it with `requires`:
///
/// ```ignore
/// plugin!(id = "my.plugin", requires_minor = 1, setup);
/// plugin!(id = "my.plugin", requires_minor = 1, requires = ["terminal"], setup);
/// ```
#[macro_export]
macro_rules! plugin {
    // A plugin that cannot work without the optional host features it names (`Metadata::requires`).
    (id = $id:expr, requires = [$($feature:expr),* $(,)?], $setup:path) => {
        $crate::plugin!(id = $id, requires_minor = 0, requires = [$($feature),*], $setup);
    };
    // A plugin that cannot work without what host minor `requires_minor` of ABI 2 added (big-boi 13, carbon-4).
    (id = $id:expr, requires_minor = $requires:expr, requires = [$($feature:expr),* $(,)?], $setup:path) => {
        $crate::export_plugin!(@entry opencode_plugin_v2, $crate::ABI_MAJOR, $crate::ABI_MINOR, $requires, $id, $setup, [$($feature),*]);
    };
    (id = $id:expr, requires_minor = $requires:expr, $setup:path) => {
        $crate::plugin!(id = $id, requires_minor = $requires, requires = [], $setup);
    };
    (id = $id:expr, $setup:path) => {
        $crate::export_plugin!($id, $setup);
    };
    ($setup:path) => {
        $crate::export_plugin!(env!("CARGO_PKG_NAME"), $setup);
    };
}

/// Exports a plugin: `export_plugin!("my.plugin", setup)`, which [`plugin!`] calls. It exports the current
/// [`PluginApi`] as [`ENTRY`], with the crate's version as its [`Metadata`].
///
/// A plugin of ABI 1.x that cannot work without what a newer 1.x minor adds, such as the composer of 1.5, asks for that
/// host, and an older host refuses it with a message naming both versions rather than run it with its requests refused:
///
/// ```ignore
/// export_plugin!("my.plugin", setup, requires_minor = 5);
/// ```
///
/// That form exports [`ENTRY_V1`] at [`V1_MINOR`]; below 4 it requires 4. It keeps that meaning until 3.0 (O-125), and
/// warns as deprecated: a 2.x minimum is `plugin!(id = "my.plugin", requires_minor = 1, setup)`. A plugin that can do
/// without reads [`Read::abi_minor`] and falls back instead.
#[macro_export]
macro_rules! export_plugin {
    ($id:expr, $setup:path) => {
        $crate::export_plugin!(@entry opencode_plugin_v2, $crate::ABI_MAJOR, $crate::ABI_MINOR, 0, $id, $setup, []);
    };
    // ABI 1.x, which needs host 1.`requires_minor`. The deprecated function is named by the caller's own
    // `requires_minor` token, so the warning shows in the caller's crate.
    ($id:expr, $setup:path, $requires_minor:ident = $requires:expr) => {
        $crate::export_plugin!(@version 1, $crate::V1_MINOR, $crate::runtime::legacy::$requires_minor($requires), $id, $setup);
    };
    // A plugin built against ABI 1.x, or that pretends to be built against another version, for the loader's tests.
    (@version $major:expr, $minor:expr, $requires:expr, $id:expr, $setup:path) => {
        $crate::export_plugin!(@entry opencode_plugin_v1, $major, $minor, $requires, $id, $setup, []);
    };
    // The same through the entry of ABI 2.
    (@version2 $major:expr, $minor:expr, $requires:expr, $id:expr, $setup:path) => {
        $crate::export_plugin!(@entry opencode_plugin_v2, $major, $minor, $requires, $id, $setup, []);
    };
    (@entry $symbol:ident, $major:expr, $minor:expr, $requires:expr, $id:expr, $setup:path, [$($feature:expr),*]) => {
        // A panic is caught at the edge only when it unwinds; with `abort` it would end the client.
        #[cfg(panic = "abort")]
        compile_error!("an opencode plugin must be built with panic = \"unwind\"");
        #[unsafe(no_mangle)]
        pub extern "C" fn $symbol() -> *const $crate::PluginApi {
            $crate::export_plugin!(@create $id, $setup);
            unsafe extern "C" fn describe(out: *mut $crate::Owned) -> i32 {
                unsafe { $crate::runtime::describe($id, env!("CARGO_PKG_VERSION"), &[$($feature),*], out) }
            }
            static API: $crate::PluginApi = $crate::runtime::table($major, $minor, $requires, create, describe);
            &API
        }
    };
    // A plugin built against 1.0: the shorter table, without `describe`.
    (@v1_0 $id:expr, $setup:path) => {
        #[unsafe(no_mangle)]
        pub extern "C" fn opencode_plugin_v1() -> *const $crate::PluginApi {
            $crate::export_plugin!(@create $id, $setup);
            static API: $crate::PluginApiV1_0 = $crate::PluginApiV1_0 {
                size: ::std::mem::size_of::<$crate::PluginApiV1_0>(),
                major: 1,
                minor: 0,
                requires_minor: 0,
                create: Some(create),
                call: Some($crate::runtime::call),
                destroy: Some($crate::runtime::destroy),
                free: Some($crate::runtime::free),
            };
            (&API as *const $crate::PluginApiV1_0).cast()
        }
    };
    (@create $id:expr, $setup:path) => {
        unsafe extern "C" fn create(
            host: *const $crate::HostApi,
            options: $crate::Bytes,
            instance: *mut *mut ::std::ffi::c_void,
            out: *mut $crate::Owned,
        ) -> i32 {
            unsafe { $crate::runtime::create($id, $setup, host, options, instance, out) }
        }
    };
    // The `create` and `describe` of `$setup`, for tests that wire a plugin through the byte shims
    // (`loader::native::loopback`); a 2.x library describes itself with its ID before any `create`.
    (@loopback $id:expr, $setup:expr) => {{
        let (create, describe) = $crate::export_plugin!(@loopback_described $id, $setup);
        $crate::runtime::Loopback { create, describe }
    }};
    // The `create` of `$setup` alone, for a test that builds its own table.
    (@loopback_create $id:expr, $setup:expr) => {{
        #[allow(unsafe_code)]
        unsafe extern "C" fn create(
            host: *const $crate::HostApi,
            options: $crate::Bytes,
            instance: *mut *mut ::std::ffi::c_void,
            out: *mut $crate::Owned,
        ) -> i32 {
            // SAFETY: the loader passes what `PluginApi::create` documents.
            unsafe { $crate::runtime::create($id, $setup, host, options, instance, out) }
        }
        create
    }};
    // The `create` and `describe` of `$setup`, for `loader::native::loopback_described`.
    (@loopback_described $id:expr, $setup:expr) => {{
        #[allow(unsafe_code)]
        unsafe extern "C" fn describe(out: *mut $crate::Owned) -> i32 {
            // SAFETY: the loader passes what `PluginApi::describe` documents.
            unsafe { $crate::runtime::describe($id, env!("CARGO_PKG_VERSION"), &[], out) }
        }
        ($crate::export_plugin!(@loopback_create $id, $setup), describe)
    }};
}

/// The shims [`export_plugin!`] wires into [`PluginApi`]. Each catches panics, so none unwinds into the host.
#[doc(hidden)]
pub mod runtime {
    use super::*;

    /// A plugin has its own copy of std and so its own panic hook. The default one prints to stderr, over the TUI; the
    /// host shows the caught message instead, so the first `create` silences it.
    static QUIET: std::sync::Once = std::sync::Once::new();

    /// Keeps the process's panic hook: for a host that links these shims into its own process, as a test does, whose
    /// std is the plugin's. It marks the hook silenced without touching it, so no `create` replaces it.
    pub fn keep_panic_hook() {
        QUIET.call_once(|| {});
    }

    /// The host minor a plugin of this SDK requires when it asks for `minor`: at least 4, whose render requests the
    /// SDK answers.
    pub const fn requires(minor: u32) -> u32 {
        if minor < 4 { 4 } else { minor }
    }

    /// The table [`export_plugin!`] exports, built here rather than in the plugin's crate, so an entry a later 2.x
    /// appends to [`PluginApi`] is no break of the plugin's source (carbon-4).
    pub const fn table(
        major: u32,
        minor: u32,
        requires_minor: u32,
        create: unsafe extern "C" fn(*const HostApi, Bytes, *mut *mut c_void, *mut Owned) -> i32,
        describe: unsafe extern "C" fn(*mut Owned) -> i32,
    ) -> PluginApi {
        PluginApi {
            size: size_of::<PluginApi>(),
            major,
            minor,
            requires_minor,
            create: Some(create),
            call: Some(call),
            destroy: Some(destroy),
            free: Some(free),
            describe: Some(describe),
        }
    }

    /// What the 1.x form `export_plugin!(id, setup, requires_minor = N)` calls.
    pub mod legacy {
        /// The host minor of ABI 1 a plugin of `export_plugin!(id, setup, requires_minor = N)` requires.
        #[deprecated(
            note = "`export_plugin!(id, setup, requires_minor = N)` exports ABI 1.x; for a 2.x minimum write \
                    `plugin!(id = id, requires_minor = N, setup)`"
        )]
        pub const fn requires_minor(minor: u32) -> u32 {
            super::requires(minor)
        }
    }

    /// The entries `export_plugin!(@loopback ..)` makes of a setup, for the loader's tests.
    #[derive(Clone, Copy)]
    pub struct Loopback {
        pub create: unsafe extern "C" fn(*const HostApi, Bytes, *mut *mut c_void, *mut Owned) -> i32,
        pub describe: unsafe extern "C" fn(*mut Owned) -> i32,
    }

    /// Runs `setup`. When it fails or panics, the dispose callbacks it registered run before this returns, while the
    /// host is still valid.
    ///
    /// # Safety
    /// The host's pointers must be valid as [`PluginApi::create`] documents.
    pub unsafe fn create(
        id: &str,
        setup: fn(&mut Setup) -> Result<(), String>,
        host: *const HostApi,
        options: Bytes,
        instance: *mut *mut c_void,
        out: *mut Owned,
    ) -> i32 {
        QUIET.call_once(|| std::panic::set_hook(Box::new(|_| {})));
        // SAFETY: the host passes valid pointers for the length of the call.
        let options = unsafe { options.checked() };
        guard(out, || {
            let options = options.map_err(|error| format!("the host passed bad options: {error}"))?;
            if instance.is_null() {
                return Err("no instance pointer".to_owned());
            }
            let options = (!options.is_empty()).then(|| String::from_utf8_lossy(options).into_owned());
            let mut registered = Registered::with_host(id, options, host);
            match catch_unwind(AssertUnwindSafe(|| setup(&mut registered.setup()))) {
                Ok(Ok(())) => {}
                Ok(Err(error)) => {
                    registered.dispose(None);
                    return Err(error);
                }
                Err(panic) => {
                    registered.dispose(None);
                    std::panic::resume_unwind(panic);
                }
            }
            let manifest = serde_json::to_vec(&registered.manifest).map_err(|error| error.to_string())?;
            // SAFETY: `instance` is non-null and valid for writes during the call.
            unsafe { *instance = Box::into_raw(Box::new(registered)).cast() };
            Ok(manifest)
        })
    }

    /// # Safety
    /// `out` must be valid for writes.
    pub unsafe fn describe(id: &str, version: &str, requires: &[&str], out: *mut Owned) -> i32 {
        guard(out, || {
            let requires = requires.iter().map(|feature| (*feature).to_owned()).collect();
            let metadata = Metadata { version: Some(version.to_owned()), id: Some(id.to_owned()), requires };
            serde_json::to_vec(&metadata).map_err(|error| error.to_string())
        })
    }

    /// # Safety
    /// `instance` must come from [`create`] and not be destroyed, or be null.
    pub unsafe extern "C" fn call(instance: *mut c_void, request: Bytes, out: *mut Owned) -> i32 {
        // SAFETY: as documented.
        let (registered, request) = unsafe { (instance.cast::<Registered>().as_ref(), request.checked()) };
        guard(out, || {
            let request = request.map_err(|error| format!("the host sent a bad request: {error}"))?;
            let registered = registered.ok_or("no instance")?;
            let request: Request = serde_json::from_slice(request).map_err(|error| error.to_string())?;
            // A draw answers with its list's bytes as they are, which JSON would only wrap.
            if let Request::Draw { surface, mount, canvas, frame } = request {
                return registered.draw(surface, &mount, &canvas, frame);
            }
            let value = registered.handle(request)?;
            serde_json::to_vec(&value).map_err(|error| error.to_string())
        })
    }

    /// # Safety
    /// `instance` must come from [`create`] and not be destroyed, or be null.
    pub unsafe extern "C" fn destroy(instance: *mut c_void) {
        if instance.is_null() {
            return;
        }
        // SAFETY: as documented.
        let mut registered = unsafe { Box::from_raw(instance.cast::<Registered>()) };
        let _ = catch_unwind(AssertUnwindSafe(move || {
            registered.dispose(None);
            drop(registered);
        }));
    }

    /// # Safety
    /// `owned` must come from this library; only its `ptr` and `cap` are read.
    pub unsafe extern "C" fn free(owned: Owned) {
        // SAFETY: as documented.
        unsafe { owned.release() };
    }

    /// Runs `f` and writes its result into `out`. With a null `out` nothing runs: there is nowhere to put the
    /// result.
    fn guard(out: *mut Owned, f: impl FnOnce() -> Result<Vec<u8>, String>) -> i32 {
        if out.is_null() {
            return ERROR;
        }
        let (status, bytes) = match catch_unwind(AssertUnwindSafe(f)) {
            Ok(Ok(bytes)) => (OK, bytes),
            Ok(Err(error)) => (ERROR, error.into_bytes()),
            Err(panic) => (PANIC, panic_message(&*panic).into_bytes()),
        };
        // SAFETY: `out` is non-null and valid for writes during the call.
        unsafe { *out = Owned::from_vec(bytes) };
        status
    }
}

/// The text of a caught panic.
pub fn panic_message(panic: &(dyn std::any::Any + Send)) -> String {
    panic
        .downcast_ref::<&str>()
        .map(|message| (*message).to_owned())
        .or_else(|| panic.downcast_ref::<String>().cloned())
        .unwrap_or_else(|| "a panic without a message".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Expected (carbon's review of P6c, 6 and CM10): the header reader names the size of each format, past a JPEG's fill
    // bytes and standalone markers, and nothing for a header of no pixels or a segment length under 2.
    #[test]
    fn image_size_reads_each_format_header() {
        let png = |width: u32, height: u32| {
            let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\x0dIHDR".to_vec();
            bytes.extend(width.to_be_bytes().into_iter().chain(height.to_be_bytes()));
            bytes
        };
        assert_eq!(image_size(&png(8, 4)), Some((8, 4)));
        assert_eq!(image_size(&png(0, 4)), None, "a header of no pixels");
        assert_eq!(image_size(b"GIF89a\x03\0\x05\0"), Some((3, 5)));
        let webp = |chunk: &[u8], body: &[u8]| [b"RIFF\0\0\0\0WEBP".as_slice(), chunk, b"\0\0\0\0", body].concat();
        assert_eq!(image_size(&webp(b"VP8 ", b"\0\0\0\x9d\x01\x2a\x07\0\x09\0")), Some((7, 9)));
        let bits: u32 = (7 - 1) | ((9 - 1) << 14);
        assert_eq!(image_size(&webp(b"VP8L", &[[0x2f].as_slice(), &bits.to_le_bytes()].concat())), Some((7, 9)));
        assert_eq!(image_size(&webp(b"VP8X", b"\0\0\0\0\x06\0\0\x08\0\0")), Some((7, 9)));
        let frame = b"\xff\xc0\x00\x11\x08\x00\x09\x00\x07";
        let jpeg = |middle: &[u8]| [b"\xff\xd8".as_slice(), middle, frame].concat();
        assert_eq!(image_size(&jpeg(b"\xff\xe0\x00\x04\0\0")), Some((7, 9)));
        assert_eq!(image_size(&jpeg(b"\xff\xe0\x00\x04\0\0\xff")), Some((7, 9)), "a fill byte");
        assert_eq!(image_size(&jpeg(b"\xff\xd0")), Some((7, 9)), "a standalone marker");
        assert_eq!(image_size(&jpeg(b"\xff\xe0\x00\x00")), None, "a length under 2");
        assert_eq!(image_size(b"not an image"), None);
    }

    /// The registrations a test's setup made.
    impl std::ops::Deref for Setup<'_> {
        type Target = Registered;

        fn deref(&self) -> &Registered {
            self.registered
        }
    }

    unsafe extern "C" fn call(_: *mut c_void, _: Bytes, out: *mut Owned) -> i32 {
        unsafe { *out = Owned::EMPTY };
        ERROR
    }

    unsafe extern "C" fn free(_: Owned) {}

    unsafe extern "C" fn light(_: *mut c_void) -> u32 {
        THEME_LIGHT
    }

    // Expected: a plugin reads the theme mode from a 1.2 host, and gets `None`, without reading past the table, from
    // a 1.1 host or a 1.2 host that leaves the entry null.
    #[test]
    fn the_theme_mode_is_read_only_when_the_host_offers_it() {
        let ctx = std::ptr::null_mut();
        let (call, free) = (Some(call as _), Some(free as _));
        let current = HostApi {
            size: size_of::<HostApi>(),
            major: 1,
            minor: 3,
            ctx,
            call,
            free,
            theme_mode: Some(light),
            wake: None,
            send: None,
            report: None,
            stopped: None,
            features: Bytes::new(&[]),
        };
        assert_eq!(HostHandle::new(&current).mode(), Some(ThemeMode::Light));
        let null = HostApi { theme_mode: None, ..current };
        assert_eq!(HostHandle::new(&null).mode(), None);
        let old = HostApiV1_1 { size: size_of::<HostApiV1_1>(), major: 1, minor: 1, ctx, call, free };
        assert_eq!(HostHandle::new(std::ptr::from_ref(&old).cast()).mode(), None);
    }

    unsafe extern "C" fn answer(ctx: *mut c_void, _: Bytes, out: *mut Owned) -> i32 {
        // SAFETY: the test passes a live counter.
        unsafe { &*ctx.cast::<std::sync::atomic::AtomicUsize>() }.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        unsafe { *out = Owned::EMPTY };
        OK
    }

    // Expected (carbon-p0a-9): a table of another major version is no host: nothing is called and its minor reads 0.
    // The minor a plugin reads is of ABI 1: a 1.x host's own, and all of 1.x from a host of ABI 2 and in process.
    #[test]
    fn a_host_of_another_major_is_no_host() {
        let calls = std::sync::atomic::AtomicUsize::new(0);
        let ctx = std::ptr::from_ref(&calls).cast_mut().cast();
        let api = HostApi {
            size: size_of::<HostApi>(),
            major: ABI_MAJOR + 1,
            minor: 0,
            ctx,
            call: Some(answer),
            free: Some(free),
            theme_mode: Some(light),
            wake: Some(wake),
            send: None,
            report: None,
            stopped: None,
            features: Bytes::new(&[]),
        };
        let host = HostHandle::new(&api);
        assert_eq!(host.request(&HostRequest::Route), Err("no host".to_owned()));
        assert_eq!((host.abi_minor(), host.mode(), host.waker().is_none()), (0, None, true));
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 0);
        let older = HostHandle::new(&HostApi { major: 1, minor: 5, ..api });
        assert_eq!(older.abi_minor(), 5);
        let current = HostHandle::new(&HostApi { major: ABI_MAJOR, minor: 0, ..api });
        assert_eq!(current.abi_minor(), V1_MINOR);
        struct InProcess;
        impl Read for InProcess {
            fn theme_mode(&self) -> ThemeMode {
                ThemeMode::Dark
            }
            fn color(&self, _: &str) -> Option<Rgba> {
                None
            }
        }
        assert_eq!(InProcess.abi_minor(), V1_MINOR);
        assert_eq!((runtime::requires(0), runtime::requires(4), runtime::requires(5)), (4, 4, 5));
    }

    // Expected: a table whose `size` does not cover the 1.1 core, or a misaligned table, is no host: its `call` is
    // not read past `size`, let alone called.
    #[test]
    fn a_table_shorter_than_its_core_is_not_read() {
        let calls = std::sync::atomic::AtomicUsize::new(0);
        let ctx = std::ptr::from_ref(&calls).cast_mut().cast();
        let api = HostApi {
            size: std::mem::offset_of!(HostApi, ctx),
            major: 1,
            minor: 0,
            ctx,
            call: Some(answer),
            free: Some(free),
            theme_mode: Some(light),
            wake: Some(wake),
            send: None,
            report: None,
            stopped: None,
            features: Bytes::new(&[]),
        };
        let host = HostHandle::new(&api);
        assert_eq!(host.request(&HostRequest::Route), Err("no host".to_owned()));
        assert_eq!((host.mode(), host.waker().is_none()), (None, true));
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 0);
        let bytes = [0u64; 16];
        let misaligned = HostHandle::new(bytes.as_ptr().cast::<u8>().wrapping_add(1).cast());
        assert_eq!(misaligned.request(&HostRequest::Route), Err("no host".to_owned()));
        let full = HostHandle::new(&HostApi { size: size_of::<HostApi>(), ..api });
        assert!(full.request(&HostRequest::Route).is_err_and(|error| error.contains("EOF")));
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    }

    thread_local! {
        /// The descriptors the fake host's `free` took back, in order.
        static FREED: std::cell::RefCell<Vec<(usize, usize, usize)>> = const { std::cell::RefCell::new(Vec::new()) };
    }

    /// A host whose `call` answers what `ctx`, a `(status, Owned)`, holds, as it holds it.
    unsafe extern "C" fn answer_as(ctx: *mut c_void, _: Bytes, out: *mut Owned) -> i32 {
        // SAFETY: the test passes a live row.
        let (status, owned) = unsafe { &*ctx.cast::<(i32, Owned)>() };
        unsafe { *out = Owned { ptr: owned.ptr, len: owned.len, cap: owned.cap } };
        *status
    }

    unsafe extern "C" fn counted_free(owned: Owned) {
        FREED.with(|freed| freed.borrow_mut().push((owned.ptr as usize, owned.len, owned.cap)));
    }

    // Expected (big-boi 5, carbon-8): the SDK checks what the host returns as the host checks what a plugin returns: a
    // null pointer with a length, a length past the capacity and a buffer over the bound are refused unread, whatever
    // the status, and every descriptor, refused or not, goes back to the host's `free` once, exactly as it came.
    #[test]
    fn the_sdk_refuses_a_host_buffer_the_host_cannot_have_written() {
        let mut json = *b"null      ";
        let ptr = json.as_mut_ptr();
        let rows: [(_, Result<serde_json::Value, &str>); 7] = [
            ((OK, Owned { ptr, len: 4, cap: 10 }), Ok(serde_json::Value::Null)),
            ((OK, Owned { ptr: std::ptr::null_mut(), len: 5, cap: 5 }), Err("a null buffer of 5 bytes")),
            // The bytes past `cap` are there and read as JSON: only the check refuses them.
            ((OK, Owned { ptr, len: 10, cap: 4 }), Err("a buffer of 10 bytes in 4 of room")),
            ((OK, Owned { ptr, len: MAX_BUFFER + 1, cap: usize::MAX }), Err("over")),
            ((ERROR, Owned { ptr, len: 10, cap: 4 }), Err("in 4 of room")),
            ((PANIC, Owned { ptr: std::ptr::null_mut(), len: 1, cap: 0 }), Err("a null buffer")),
            ((ERROR, Owned { ptr, len: 4, cap: 10 }), Err("null")),
        ];
        for (index, (row, expected)) in rows.into_iter().enumerate() {
            let api = HostApi {
                size: size_of::<HostApi>(),
                major: ABI_MAJOR,
                minor: ABI_MINOR,
                ctx: std::ptr::from_ref(&row).cast_mut().cast(),
                call: Some(answer_as),
                free: Some(counted_free),
                theme_mode: None,
                wake: None,
                send: None,
                report: None,
                stopped: None,
                features: Bytes::new(&[]),
            };
            FREED.with(|freed| freed.borrow_mut().clear());
            let got = HostHandle::new(&api).request(&HostRequest::Route);
            match expected {
                Ok(value) => assert_eq!(got, Ok(value), "row {index}"),
                Err(needle) => assert!(got.as_ref().is_err_and(|error| error.contains(needle)), "row {index}: {got:?}"),
            }
            let freed = FREED.with(|freed| freed.borrow().clone());
            assert_eq!(
                freed,
                [(row.1.ptr as usize, row.1.len, row.1.cap)],
                "row {index} was not freed once, as it came"
            );
        }
    }

    unsafe extern "C" fn null_call(_: *mut c_void, _: Bytes, out: *mut Owned) -> i32 {
        // SAFETY: the SDK passes an `out` valid for writes.
        unsafe { *out = Owned::from_vec(b"null".to_vec()) };
        OK
    }

    // Expected (big-boi 13, synthesis 4.6): a node kind of a later 2.x minor with its author's fallback is lowered for
    // an older host before the SDK encodes the tree: the reply equals that of a plugin that wrote the fallback, and no
    // tag of the newer kind crosses. A newer host gets the kind. A view that gives no fallback is refused by the SDK
    // before anything crosses. The SDK reads the negotiated major, minor and features the host stated.
    #[test]
    fn a_later_node_lowers_to_its_fallback_on_an_older_host() {
        fn text() -> v2::Node {
            v2::Node::text(vec![Span::new("hi")]).with_id("n")
        }
        fn later() -> v2::Node {
            v2::Node::Later { id: Some("n".into()), text: "hi".into() }
        }
        fn lowering(setup: &mut Setup) -> Result<(), String> {
            setup.surface(v2::Surface::new("s", v2::Place::Route("r".into()), |cx| cx.or(later(), |_| text())));
            Ok(())
        }
        fn fallback(setup: &mut Setup) -> Result<(), String> {
            setup.surface(v2::Surface::new("s", v2::Place::Route("r".into()), |_| text()));
            Ok(())
        }
        fn forgetting(setup: &mut Setup) -> Result<(), String> {
            setup.surface(v2::Surface::new("s", v2::Place::Route("r".into()), |_| later()));
            Ok(())
        }
        let features = br#"["f"]"#;
        let viewed = |setup: fn(&mut Setup) -> Result<(), String>, minor: u32| {
            let api = HostApi {
                size: size_of::<HostApi>(),
                major: ABI_MAJOR,
                minor,
                ctx: std::ptr::null_mut(),
                call: Some(null_call),
                free: Some(runtime::free),
                theme_mode: None,
                wake: None,
                send: None,
                report: None,
                stopped: None,
                features: Bytes::new(features),
            };
            let mut registered = Registered::with_host("t", None, &api);
            setup(&mut registered.setup()).unwrap();
            assert_eq!(registered.setup().abi(), Abi::new(ABI_MAJOR, minor, vec!["f".to_owned()]));
            let mount = v2::MountId { surface: "s".into(), key: "s".into(), generation: 1 };
            let request = Request::View { surface: 0, mount, input: v2::SurfaceInput::default(), next: 0 };
            registered.handle(request).map(|reply| serde_json::to_string(&reply).unwrap())
        };
        let old = viewed(lowering, 0).unwrap();
        assert_eq!(old, viewed(fallback, 0).unwrap(), "the older host's tree is not the fallback's");
        assert!(!old.contains("later"), "{old}");
        assert!(viewed(lowering, 1).unwrap().contains(r#""type":"later""#));
        let refused = viewed(forgetting, 0).unwrap_err();
        assert!(refused.contains("ABI 2.1") && refused.contains("(2.0) lacks"), "{refused}");
        assert!(viewed(forgetting, 1).is_ok());
        assert_eq!(Registered::new("t", None).setup().abi(), Abi::current());
    }

    thread_local! {
        /// The requests the fake host below was sent, by type.
        static ASKED: std::cell::RefCell<Vec<String>> = const { std::cell::RefCell::new(Vec::new()) };
    }

    /// A host that answers every request with `0`.
    unsafe extern "C" fn zero_call(_: *mut c_void, _: Bytes, out: *mut Owned) -> i32 {
        // SAFETY: `out` is valid for writes.
        unsafe { *out = Owned::from_vec(b"0".to_vec()) };
        OK
    }

    // Expected (bigboi's last pass): a host that answers a fetch or a program OK with the ID 0, which names no
    // request, gave a malformed answer: the 2.x calls are an error, and the 1.x calls answer `RequestId(0)`, which no
    // reply carries.
    #[test]
    #[allow(deprecated)]
    fn a_request_id_of_zero_is_a_malformed_answer() {
        let api = HostApi {
            size: size_of::<HostApi>(),
            major: ABI_MAJOR,
            minor: ABI_MINOR,
            ctx: std::ptr::null_mut(),
            call: Some(zero_call),
            free: Some(runtime::free),
            theme_mode: None,
            wake: None,
            send: None,
            report: None,
            stopped: None,
            features: Bytes::new(b"[]"),
        };
        let host = HostHandle::new(&api);
        let fetch = || Fetch::default().with_method("GET".to_owned()).with_path("/api/session".to_owned());
        let program = || Foreground::new("true");
        assert!(host.try_fetch(fetch()).is_err_and(|error| error.contains("request ID 0")));
        assert!(host.try_foreground(program()).is_err_and(|error| error.contains("request ID 0")));
        assert_eq!((host.fetch(fetch()), host.foreground(program())), (RequestId(0), RequestId(0)));
    }

    /// A host that states image bounds of 100 bytes and 10 pixels a side, and answers an image's size as [4, 3].
    unsafe extern "C" fn bounded_call(_: *mut c_void, request: Bytes, out: *mut Owned) -> i32 {
        // SAFETY: the SDK lends the request for the call.
        let request: serde_json::Value = serde_json::from_slice(unsafe { request.as_slice() }).unwrap();
        let kind = request["type"].as_str().unwrap_or_default().to_owned();
        let answer = match kind.as_str() {
            "image-bounds" => r#"{"bytes":100,"side":10}"#,
            _ => "[4,3]",
        };
        ASKED.with_borrow_mut(|asked| asked.push(kind));
        // SAFETY: `out` is valid for writes.
        unsafe { *out = Owned::from_vec(answer.as_bytes().to_vec()) };
        OK
    }

    // Expected (PL-9, bigboi's re-review): a host with `image-bounds` states them once, and the SDK answers the size of
    // bytes past them, by length or by the size their header names, without sending them; bytes within them are asked
    // for. A host without the feature is asked for every image, as before.
    #[test]
    fn image_size_past_the_host_s_bounds_answers_without_the_host() {
        let png = |side: u32| {
            let mut bytes = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
            bytes.extend(side.to_be_bytes());
            bytes.extend(side.to_be_bytes());
            bytes
        };
        for (features, expected) in [
            (&br#"["image-bounds"]"#[..], ["image-bounds", "image-size"].as_slice()),
            (&b"[]"[..], ["image-size", "image-size", "image-size"].as_slice()),
        ] {
            ASKED.with_borrow_mut(Vec::clear);
            let api = HostApi {
                size: size_of::<HostApi>(),
                major: ABI_MAJOR,
                minor: ABI_MINOR,
                ctx: std::ptr::null_mut(),
                call: Some(bounded_call),
                free: Some(runtime::free),
                theme_mode: None,
                wake: None,
                send: None,
                report: None,
                stopped: None,
                features: Bytes::new(features),
            };
            let host = HostHandle::new(&api);
            let sizes = [host.image_size(&[0; 200]), host.image_size(&png(11)), host.image_size(&png(9))];
            let bounded = expected.len() == 2;
            let past = if bounded { None } else { Some((4, 3)) };
            assert_eq!(sizes, [past, past, Some((4, 3))], "features {}", String::from_utf8_lossy(features));
            assert_eq!(ASKED.with_borrow(Vec::clone), expected, "features {}", String::from_utf8_lossy(features));
        }
        assert!(FEATURES.contains(&IMAGE_BOUNDS));
    }

    // Expected (bigboi's final pass): image bounds belong to the instance that asked for them. An instance whose host
    // states bounds answers 200 bytes with `None`; once it is gone, an instance on a table at the same address whose
    // host states no bounds asks its host, which decodes them.
    #[test]
    fn image_bounds_end_with_their_instance() {
        let mut api = HostApi {
            size: size_of::<HostApi>(),
            major: ABI_MAJOR,
            minor: ABI_MINOR,
            ctx: std::ptr::null_mut(),
            call: Some(bounded_call),
            free: Some(runtime::free),
            theme_mode: None,
            wake: None,
            send: None,
            report: None,
            stopped: None,
            features: Bytes::new(br#"["image-bounds"]"#),
        };
        ASKED.with_borrow_mut(Vec::clear);
        let first = Registered::with_host("a", None, &api);
        assert_eq!(first.host.image_size(&[0; 200]), None);
        drop(first);
        api.features = Bytes::new(b"[]");
        let second = Registered::with_host("b", None, &api);
        assert_eq!(second.host.image_size(&[0; 200]), Some((4, 3)), "the first instance's bounds outlived it");
        assert_eq!(ASKED.with_borrow(Vec::clone), ["image-bounds", "image-size"]);
    }

    // Expected (carbon-8): borrowed bytes are refused unread when null with a length or over the bound, and `free`
    // reads only the pointer and the capacity, so a broken length frees what was allocated.
    #[test]
    fn borrowed_bytes_and_free_check_what_they_can() {
        let bytes = b"abc";
        let refused = [
            (Bytes { ptr: std::ptr::null(), len: 2 }, "a null buffer of 2 bytes"),
            (Bytes { ptr: bytes.as_ptr(), len: MAX_BUFFER + 1 }, "over"),
        ];
        for (borrowed, needle) in refused {
            // SAFETY: refused before anything is read, as the test checks.
            assert!(unsafe { borrowed.checked() }.is_err_and(|error| error.contains(needle)));
            assert!(unsafe { borrowed.as_slice() }.is_empty());
        }
        assert_eq!(unsafe { Bytes::new(bytes).checked() }, Ok(&bytes[..]));
        assert_eq!(unsafe { Bytes { ptr: std::ptr::null(), len: 0 }.checked() }, Ok(&[][..]));
        let mut owned = Owned::from_vec(b"abcdef".to_vec());
        owned.len = usize::MAX;
        // SAFETY: `ptr` and `cap` are `from_vec`'s.
        unsafe { runtime::free(owned) };
    }

    unsafe extern "C" fn wake(ctx: *mut c_void) {
        // SAFETY: the test passes a live counter.
        unsafe { &*ctx.cast::<std::sync::atomic::AtomicUsize>() }.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    }

    // Expected: a plugin wakes a 1.3 host from another thread, and gets no waker, without reading past the table, from
    // a 1.2 host or a 1.3 host that leaves the entry null.
    #[test]
    fn a_waker_wakes_the_host_from_another_thread_when_the_host_offers_it() {
        let wakes = std::sync::atomic::AtomicUsize::new(0);
        let ctx = std::ptr::from_ref(&wakes).cast_mut().cast();
        let (call, free) = (Some(call as _), Some(free as _));
        let api = HostApi {
            size: size_of::<HostApi>(),
            major: 1,
            minor: 3,
            ctx,
            call,
            free,
            theme_mode: None,
            wake: Some(wake),
            send: None,
            report: None,
            stopped: None,
            features: Bytes::new(&[]),
        };
        let waker = HostHandle::new(&api).waker().unwrap();
        std::thread::spawn(move || waker.wake()).join().unwrap();
        assert_eq!(wakes.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert!(HostHandle::new(&HostApi { wake: None, ..api }).waker().is_none());
        let old = HostApiV1_2 { size: size_of::<HostApiV1_2>(), major: 1, minor: 2, ctx, call, free, theme_mode: None };
        assert!(HostHandle::new(std::ptr::from_ref(&old).cast()).waker().is_none());
    }

    // Expected: a C host that passes no table, or leaves `call` or `free` null, gets errors, not a jump to address 0.
    #[test]
    fn a_null_host_or_host_callback_is_an_error() {
        let set = HostRequest::StorageSet { key: "count".into(), value: "{}".into() };
        let host = HostHandle::new(std::ptr::null());
        assert_eq!(host.storage_text("count"), None);
        assert_eq!(host.request(&set), Err("no host".to_owned()));
        assert_eq!(host.mode(), None);
        assert!(host.waker().is_none());
        let ctx = std::ptr::null_mut();
        let api = HostApi {
            size: size_of::<HostApi>(),
            major: 1,
            minor: 3,
            ctx,
            call: None,
            free: None,
            theme_mode: None,
            wake: None,
            send: None,
            report: None,
            stopped: None,
            features: Bytes::new(&[]),
        };
        assert_eq!(HostHandle::new(&api).request(&set), Err("the host takes no requests".to_owned()));
        let api = HostApi { call: Some(call), ..api };
        assert_eq!(HostHandle::new(&api).request(&set), Err("the host takes no requests".to_owned()));
    }

    // Expected: the 1.3 requests, rows and manifest keep their JSON byte for byte; only a plugin of this crate sets
    // the render marker, and its fence answers in the 1.4 form.
    #[test]
    fn the_1_3_wire_format_is_unchanged() {
        let fence = Request::Fence { language: "x".into(), info: "x y".into(), code: "a".into(), streaming: true };
        assert_eq!(
            serde_json::to_string(&fence).unwrap(),
            r#"{"type":"fence","language":"x","info":"x y","code":"a","streaming":true}"#
        );
        let line = vec![Span::new("a").fg("text.muted").bold(), Span { bg: Some("#102030".into()), ..Span::new("b") }];
        let json = r##"[{"text":"a","fg":"text.muted","bold":true},{"text":"b","bg":"#102030"}]"##;
        assert_eq!(serde_json::to_string(&line).unwrap(), json);
        assert_eq!(serde_json::from_str::<Line>(json).unwrap(), line);
        let old: Manifest =
            serde_json::from_str(r#"{"id":"old","commands":[],"fences":["x"],"slots":[],"routes":[],"storage":[]}"#)
                .unwrap();
        assert_eq!(old.render, 0);
        assert!(!serde_json::to_string(&old).unwrap().contains("render"));

        let mut registered = Registered::new("new", None);
        let mut setup = registered.setup();
        setup.code_block("x", |_, fence| match fence.key {
            0 => Fenced::Code,
            _ => Fenced::Lines { lines: vec![vec![Span::new(fence.code.clone())]], fg: None, drag: false },
        });
        assert_eq!(setup.manifest().render, RENDER);
        let fence = Fence {
            language: "x".into(),
            info: "x".into(),
            code: "a".into(),
            streaming: false,
            closed: true,
            key: 7,
            width: 80,
        };
        let request = |fence: &Fence, index| Request::RenderFence(RenderFence { fence: fence.clone(), index });
        let answer = setup.handle(request(&fence, None)).unwrap();
        assert_eq!(answer, serde_json::json!({ "type": "lines", "lines": [[{ "text": "a" }]] }));
        let unknown = Fence { language: "y".into(), ..fence.clone() };
        assert_eq!(setup.handle(request(&unknown, None)).unwrap(), serde_json::json!({ "type": "code" }));
        // A host that normalized the language names the render by index; the render sees the normalized language.
        let json = r#"{"type":"render-fence","language":"y","info":"x","code":"a","streaming":false,"closed":true,"key":7,"width":80,"index":0}"#;
        assert_eq!(serde_json::to_string(&request(&unknown, Some(0))).unwrap(), json);
        assert_eq!(serde_json::from_str::<Request>(json).unwrap(), request(&unknown, Some(0)));
        let answer = setup.handle(serde_json::from_str(json).unwrap()).unwrap();
        assert_eq!(answer, serde_json::json!({ "type": "lines", "lines": [[{ "text": "a" }]] }));
        assert_eq!(setup.handle(request(&fence, Some(1))).unwrap(), serde_json::json!({ "type": "code" }));
    }

    // Expected: what 1.4 adds for Mermaid is optional on the wire: an `Rgba` is `#rrggbbaa` and reads back as one,
    // `#rrggbb` stays a token, `fg` and `drag` are left out when unset, and a fence without `width` reads as 0.
    #[test]
    fn the_1_4_colors_and_rows_round_trip() {
        let line = vec![Span { bg: Some(Rgba::new(255, 255, 255, 20).into()), ..Span::new("a").fg("#102030") }];
        let fenced = Fenced::Lines { lines: vec![line], fg: Some(Rgba::new(1, 2, 3, 255).into()), drag: true };
        let json = r##"{"type":"lines","lines":[[{"text":"a","fg":"#102030","bg":"#ffffff14"}]],"fg":"#010203ff","drag":true}"##;
        assert_eq!(serde_json::to_string(&fenced).unwrap(), json);
        assert_eq!(serde_json::from_str::<Fenced>(json).unwrap(), fenced);
        let plain = Fenced::Lines { lines: Vec::new(), fg: None, drag: false };
        assert_eq!(serde_json::to_string(&plain).unwrap(), r#"{"type":"lines","lines":[]}"#);
        let fence: Fence =
            serde_json::from_str(r#"{"language":"x","info":"x","code":"a","streaming":false,"closed":true,"key":1}"#)
                .unwrap();
        assert_eq!(fence.width, 0);
        let request = HostRequest::Color { token: "categorical.3.300".into() };
        assert_eq!(serde_json::to_string(&request).unwrap(), r#"{"type":"color","token":"categorical.3.300"}"#);
        assert_eq!(Rgba::parse("#0a0b0c"), Some(Rgba::new(10, 11, 12, 255)));
        assert_eq!(Rgba::parse("#0a0b0"), None);
    }

    // Expected: a slot render's request and answer leave out what is unset, read back as written, and a 1.3 claim
    // keeps its JSON; each kind of slot claim refuses the other kind's request.
    #[test]
    fn the_1_4_slot_render_round_trips() {
        let changed = Changed { lists: vec!["ses_1".into()], local: true, ..Changed::default() };
        let request = Request::Render {
            claim: 1,
            input: SlotInput { session_id: Some("ses_1".into()), ..SlotInput::default() },
            changed,
        };
        let json =
            r#"{"type":"render","claim":1,"input":{"session_id":"ses_1"},"changed":{"lists":["ses_1"],"local":true}}"#;
        assert_eq!(serde_json::to_string(&request).unwrap(), json);
        assert_eq!(serde_json::from_str::<Request>(json).unwrap(), request);
        let node = Node::column(vec![Node::text([Span::new("a").bold()]), Node::row(Vec::new())]);
        let render = Render::Show(node);
        let json = r#"{"type":"show","node":{"type":"box","children":[{"type":"text","spans":[{"text":"a","bold":true}]},{"type":"box","row":true,"children":[]}]}}"#;
        assert_eq!(serde_json::to_string(&render).unwrap(), json);
        assert_eq!(serde_json::from_str::<Render>(json).unwrap(), render);
        assert_eq!(serde_json::to_string(&Render::Keep).unwrap(), r#"{"type":"keep"}"#);
        let old =
            SlotClaim { kind: SlotKind::Append, path: "home.footer".into(), render: false, mount: false, size: false };
        assert_eq!(serde_json::to_string(&old).unwrap(), r#"{"kind":"append","path":"home.footer"}"#);
        assert_eq!(serde_json::to_string(&HostRequest::Model).unwrap(), r#"{"type":"model"}"#);

        let mut registered = Registered::new("new", None);
        let mut setup = registered.setup();
        setup.slot_lines(SlotKind::Append, "home.footer", |_| Vec::new());
        setup.slot(Placement::append("sidebar.content"), |_, input, _| match &input.session_id {
            Some(_) => Render::Hide,
            None => Render::Keep,
        });
        assert_eq!(setup.renders().count(), 1);
        let render = |claim| Request::Render { claim, input: SlotInput::default(), changed: Changed::everything() };
        assert_eq!(setup.handle(render(1)).unwrap(), serde_json::json!({ "type": "keep" }));
        assert!(setup.handle(render(0)).is_err());
        assert!(setup.handle(Request::Slot { claim: 1, session_id: None }).is_err());
    }

    // Expected: a click, a hover color and a struck-through span cross the wire and read back as written, a
    // dispatch leaves out a missing input, and a command answers through the host it gets, with its input.
    #[test]
    fn clicks_hovers_and_dispatches_round_trip() {
        let text = Node::text([Span { strikethrough: true, ..Span::new("a") }])
            .hover_fg("text.base")
            .on_click(Click::command("x.open", Some("b".into())).on_down());
        let node = Node::row(vec![text]).justify(Justify::SpaceBetween);
        let json = r#"{"type":"box","row":true,"justify":"space-between","children":[{"type":"text","spans":[{"text":"a","strikethrough":true}],"hover_fg":"text.base","on_click":{"action":{"type":"command","name":"x.open","input":"b"},"on":"down"}}]}"#;
        assert_eq!(serde_json::to_string(&node).unwrap(), json);
        assert_eq!(serde_json::from_str::<Node>(json).unwrap(), node);
        let dispatch = HostRequest::Dispatch { name: "x.open".into(), input: None };
        assert_eq!(serde_json::to_string(&dispatch).unwrap(), r#"{"type":"dispatch","name":"x.open"}"#);

        let mut registered = Registered::new("new", None);
        let mut setup = registered.setup();
        let seen = Rc::new(std::cell::RefCell::new(Vec::new()));
        let into = seen.clone();
        setup.command(Command { name: "x.hidden".into(), ..Command::default() }, move |host, input| {
            into.borrow_mut().push((input.map(str::to_owned), host.storage_get("view")));
        });
        let request = Request::Command { name: "x.hidden".into(), input: Some("b".into()) };
        assert_eq!(setup.handle(request).unwrap(), serde_json::Value::Null);
        assert_eq!(*seen.borrow(), [(Some("b".to_owned()), None)]);
    }

    // Expected: a 1.3 toast keeps its JSON, and a 1.4 one adds its title and session; attention, the route and a nested
    // slot leave out what is unset; an event handler is named by index, gets its event back as written, and its
    // manifest entry is left out when there is none.
    #[test]
    fn events_toasts_attention_and_slots_round_trip() {
        let toast = HostRequest::Toast { variant: Variant::Info, message: "a".into(), title: None, session: None };
        assert_eq!(serde_json::to_string(&toast).unwrap(), r#"{"type":"toast","variant":"info","message":"a"}"#);
        let toast = Toast::new(Variant::Error, "boom").title("Session failed").session("ses_1");
        let request = HostRequest::Toast {
            variant: toast.variant,
            message: toast.message.clone(),
            title: toast.title.clone(),
            session: toast.session.clone(),
        };
        let json = r#"{"type":"toast","variant":"error","message":"boom","title":"Session failed","session":"ses_1"}"#;
        assert_eq!(serde_json::to_string(&request).unwrap(), json);
        assert_eq!(serde_json::from_str::<HostRequest>(json).unwrap(), request);
        let attention = HostRequest::Attention(Attention {
            title: None,
            message: "done".into(),
            notify: Some(When::Blurred),
            sound: Some(Sound { name: SoundName::SubagentDone, when: When::Always, volume: None }),
        });
        let json = r#"{"type":"attention","message":"done","notify":"blurred","sound":{"name":"subagent_done","when":"always"}}"#;
        assert_eq!(serde_json::to_string(&attention).unwrap(), json);
        assert_eq!(serde_json::from_str::<HostRequest>(json).unwrap(), attention);
        let route = Route::Session { id: "ses_1".into() };
        assert_eq!(serde_json::to_string(&route).unwrap(), r#"{"type":"session","id":"ses_1"}"#);
        let node = Node::row(vec![Node::slot("home.footer.status")]);
        let json = r#"{"type":"box","row":true,"children":[{"type":"slot","path":"home.footer.status"}]}"#;
        assert_eq!(serde_json::to_string(&node).unwrap(), json);
        assert_eq!(serde_json::from_str::<Node>(json).unwrap(), node);

        let mut registered = Registered::new("new", None);
        let mut setup = registered.setup();
        assert!(!serde_json::to_string(setup.manifest()).unwrap().contains("events"));
        let seen = Rc::new(std::cell::RefCell::new(Vec::new()));
        let into = seen.clone();
        setup.on_event(&["session.execution.started"], move |_, event| into.borrow_mut().push(event.clone()));
        assert_eq!(setup.manifest().events, [["session.execution.started"]]);
        let event: V2Event = serde_json::from_value(serde_json::json!({
            "id": "evt_1", "created": 1, "type": "session.execution.started",
            "durable": { "aggregateID": "ses_1", "seq": 1, "version": 1 }, "data": { "sessionID": "ses_1" },
        }))
        .unwrap();
        let request = Request::Event { handler: 0, event: Box::new(event.clone()) };
        let request = serde_json::from_slice(&serde_json::to_vec(&request).unwrap()).unwrap();
        assert_eq!(setup.handle(request).unwrap(), serde_json::Value::Null);
        assert_eq!(*seen.borrow(), std::slice::from_ref(&event));
        assert!(setup.handle(Request::Event { handler: 1, event: Box::new(event) }).is_err());
    }

    // Expected: what 1.4 adds for fetches, routes and dialogs reads back as written; a 1.3 command keeps its JSON;
    // a route renders and replies reach every handler through `handle`, by the IDs the host chose.
    #[test]
    fn fetches_routes_and_dialogs_round_trip() {
        let old = Command { name: "x.a".into(), title: "A".into(), ..Command::default() };
        let json = r#"{"name":"x.a","title":"A","group":null,"slash":null,"keybind":null,"palette":false}"#;
        assert_eq!(serde_json::to_string(&old).unwrap(), json);
        let scoped = Command { scope: Scope::Route("stats".into()), arguments: true, ..old };
        let json = serde_json::to_string(&scoped).unwrap();
        assert!(json.ends_with(r#""arguments":true,"scope":{"route":"stats"}}"#), "{json}");
        let fetch = Fetch {
            method: "POST".into(),
            path: "/api/x".into(),
            query: vec![("a".into(), "b".into())],
            body: Some(serde_json::json!({ "c": 1 })),
            bytes: false,
        };
        let action = Action::Command { name: "x.ask".into(), input: None };
        let panel = Panel {
            key: "k".into(),
            size: PanelSize::Large,
            title: vec![Span::new("t").bold()],
            subtitle: Some("s".into()),
            body: Node::Markdown { text: "**m**".into() },
            actions: vec![PanelAction {
                title: "a".into(),
                key: Some("c".into()),
                color: None,
                close: true,
                action: action.clone(),
            }],
            binds: vec![PanelBind { key: "c".into(), title: "C".into(), action: action.clone() }],
            bleed: true,
            centered: true,
            bare: false,
            close: None,
            height: None,
        };
        let requests = [
            HostRequest::Fetch(fetch),
            HostRequest::Navigate { route: Route::Session { id: "ses_1".into() } },
            HostRequest::Dialog { dialog: Box::new(Dialog::Panel(panel)) },
            HostRequest::Dialog { dialog: Box::new(Dialog::Prompt { title: "p".into(), placeholder: None, action }) },
            HostRequest::Copy { text: "x".into(), then: None },
            HostRequest::Dialog { dialog: Box::new(Dialog::Close { key: "k".into() }) },
            HostRequest::Interactive,
            HostRequest::Shortcut { name: "agent.cycle".into() },
            HostRequest::DialogOpen { key: "k".into() },
            HostRequest::Dialog {
                dialog: Box::new(Dialog::Select(Select {
                    title: "s".into(),
                    placeholder: None,
                    options: vec![SelectOption::new("A", "a").description("d"), SelectOption::new("B", "b")],
                    current: Some("b".into()),
                    action: Action::Command { name: "x.pick".into(), input: None },
                    key: None,
                    actions: Vec::new(),
                    binds: Vec::new(),
                    search: None,
                    size: Some(PanelSize::Large),
                    focus: Some("a".into()),
                    query: None,
                    query_delay: 0,
                    filterless: false,
                    empty: None,
                    note: None,
                    centered: false,
                })),
            },
        ];
        for request in requests {
            let json = serde_json::to_string(&request).unwrap();
            assert_eq!(serde_json::from_str::<HostRequest>(&json).unwrap(), request, "{json}");
        }
        let node =
            Node::row(vec![Node::Spinner { label: "/btw".into() }]).align(Align::Center).justify(Justify::SpaceAround);
        let json = r#"{"type":"box","row":true,"justify":"space-around","align":"center","children":[{"type":"spinner","label":"/btw"}]}"#;
        assert_eq!(serde_json::to_string(&node).unwrap(), json);
        assert_eq!(serde_json::from_str::<Node>(json).unwrap(), node);

        let mut registered = Registered::new("new", None);
        let mut setup = registered.setup();
        setup.route("page", |_, changed| match changed.woken {
            true => Render::Hide,
            false => Render::Keep,
        });
        let seen = Rc::new(std::cell::RefCell::new(Vec::new()));
        for _ in 0..2 {
            let into = seen.clone();
            setup.on_reply(move |_, id, result| into.borrow_mut().push((id, result)));
        }
        assert_eq!(
            (setup.manifest().routes.clone(), setup.manifest().render_routes.clone()),
            (vec!["page".to_owned()], vec!["page".to_owned()])
        );
        let render =
            Request::RenderRoute { name: "page".into(), changed: Changed { woken: true, ..Changed::default() } };
        assert_eq!(setup.handle(render).unwrap(), serde_json::json!({ "type": "hide" }));
        let reply = Request::Reply { id: RequestId(7), result: Err("gone".into()) };
        let reply = serde_json::from_slice(&serde_json::to_vec(&reply).unwrap()).unwrap();
        assert_eq!(setup.handle(reply).unwrap(), serde_json::Value::Null);
        assert_eq!(*seen.borrow(), [(RequestId(7), Err("gone".to_owned())), (RequestId(7), Err("gone".to_owned()))]);
        // A reply to ID 0, which names no request, is refused before a handler runs (bigboi's freeze pass).
        let zero = serde_json::json!({ "type": "reply", "id": 0, "result": { "Ok": null } });
        assert!(setup.handle(serde_json::from_value(zero).unwrap()).is_err());
        assert_eq!(seen.borrow().len(), 2, "a handler heard a reply to ID 0");
    }

    // Expected: the shims answer a null instance with an error, ignore a null `out` or a null `destroy`, and never
    // dereference either.
    #[test]
    fn the_shims_check_null_pointers() {
        let request = serde_json::to_vec(&Request::Route { name: "x".to_owned() }).unwrap();
        let mut out = Owned::EMPTY;
        // SAFETY: null pointers are what is under test; `out` is freed by the same library.
        unsafe {
            assert_eq!(runtime::call(std::ptr::null_mut(), Bytes::new(&request), &mut out), ERROR);
            assert_eq!(out.to_vec(), b"no instance");
            runtime::free(out);
            assert_eq!(runtime::call(std::ptr::null_mut(), Bytes::new(&request), std::ptr::null_mut()), ERROR);
            runtime::destroy(std::ptr::null_mut());
            let mut out = Owned::EMPTY;
            let status =
                runtime::create("x", |_| Ok(()), std::ptr::null(), Bytes::new(b""), std::ptr::null_mut(), &mut out);
            assert_eq!((status, out.to_vec()), (ERROR, b"no instance pointer".to_vec()));
            runtime::free(out);
            let mut instance = std::ptr::null_mut();
            let status = runtime::create(
                "x",
                |_| Ok(()),
                std::ptr::null(),
                Bytes::new(b""),
                &mut instance,
                std::ptr::null_mut(),
            );
            assert_eq!(status, ERROR);
            assert!(instance.is_null());
        }
    }

    thread_local! {
        /// The dispose callbacks that ran on this thread, in order.
        static DISPOSED: std::cell::RefCell<Vec<&'static str>> = const { std::cell::RefCell::new(Vec::new()) };
    }

    /// Registers three dispose callbacks, the middle one panicking, then fails as `options` says.
    fn failing(setup: &mut Setup) -> Result<(), String> {
        let disposed = |name: &'static str| move |_: &dyn Host| DISPOSED.with(|ran| ran.borrow_mut().push(name));
        setup.on_dispose(disposed("first"));
        setup.on_dispose(|_| panic!("a dispose callback panicked"));
        setup.on_dispose(disposed("last"));
        match setup.options() {
            Some("error") => Err("setup failed".to_owned()),
            Some("panic") => panic!("setup panicked"),
            _ => Ok(()),
        }
    }

    // Expected: a setup that fails or panics runs the dispose callbacks it registered before `create` returns, last
    // first, and one that panics keeps none of the others from running; `destroy` runs them the same.
    #[test]
    fn a_failed_setup_disposes_what_it_registered() {
        let hook = std::panic::take_hook();
        for (options, status, message) in
            [("error", ERROR, "setup failed"), ("panic", PANIC, "setup panicked"), ("", OK, "")]
        {
            let (mut instance, mut out) = (std::ptr::null_mut(), Owned::EMPTY);
            // SAFETY: valid pointers for the call; `out` is freed by the same library.
            let (got, bytes) = unsafe {
                let got = runtime::create(
                    "x",
                    failing,
                    std::ptr::null(),
                    Bytes::new(options.as_bytes()),
                    &mut instance,
                    &mut out,
                );
                let bytes = out.to_vec();
                runtime::free(out);
                (got, bytes)
            };
            assert_eq!(got, status, "{options}");
            if status != OK {
                assert_eq!(String::from_utf8(bytes).unwrap(), message);
                assert!(instance.is_null());
            } else {
                assert!(DISPOSED.with(|ran| ran.borrow().is_empty()));
                // SAFETY: `instance` came from `create`.
                unsafe { runtime::destroy(instance) };
            }
            assert_eq!(DISPOSED.with(|ran| ran.take()), ["last", "first"], "{options}");
        }
        std::panic::set_hook(hook);
    }

    // Expected: a route mount handler is listed in the manifest once per route, and `RouteMount` runs the handlers of
    // its route with whether it mounted; a manifest without one leaves the field out.
    #[test]
    fn route_mounts_round_trip() {
        let mut registered = Registered::new("new", None);
        let mut setup = registered.setup();
        assert!(!serde_json::to_string(setup.manifest()).unwrap().contains("route_mounts"));
        let seen = Rc::new(std::cell::RefCell::new(Vec::new()));
        for tag in ["a", "b"] {
            let into = seen.clone();
            setup.on_route_mount("page", move |_, mounted| into.borrow_mut().push((tag, mounted)));
        }
        assert_eq!(setup.manifest().route_mounts, ["page"]);
        let request: Request = serde_json::from_str(r#"{"type":"route-mount","name":"page","mounted":true}"#).unwrap();
        assert_eq!(setup.handle(request).unwrap(), serde_json::Value::Null);
        setup.handle(Request::RouteMount { name: "other".into(), mounted: true }).unwrap();
        setup.handle(Request::RouteMount { name: "page".into(), mounted: false }).unwrap();
        assert_eq!(*seen.borrow(), [("a", true), ("b", true), ("a", false), ("b", false)]);
    }

    thread_local! {
        /// The requests the recording host got on this thread.
        static REQUESTS: std::cell::RefCell<Vec<HostRequest>> = const { std::cell::RefCell::new(Vec::new()) };
    }

    /// A host that records each request and refuses `storage-merge` when `ctx` is non-null, as a host older than it.
    unsafe extern "C" fn record(ctx: *mut c_void, request: Bytes, out: *mut Owned) -> i32 {
        // SAFETY: the plugin passes the request for the length of the call.
        let request: HostRequest = serde_json::from_slice(unsafe { request.as_slice() }).unwrap();
        let refused = !ctx.is_null() && matches!(request, HostRequest::StorageMerge { .. });
        let answer = match &request {
            HostRequest::StorageGet { .. } => serde_json::json!("{\"sibling\":1}"),
            _ => serde_json::Value::Null,
        };
        REQUESTS.with(|requests| requests.borrow_mut().push(request));
        let bytes = if refused { b"unknown variant".to_vec() } else { serde_json::to_vec(&answer).unwrap() };
        // SAFETY: `out` is valid for writes during the call.
        unsafe { *out = Owned::from_vec(bytes) };
        if refused { ERROR } else { OK }
    }

    unsafe extern "C" fn release(owned: Owned) {
        // SAFETY: `record` made it.
        drop(unsafe { owned.into_vec() });
    }

    // Expected: `storage_merge` over the C ABI sends only the fields, for the host to set under its storage lock; a
    // host that does not know the request gets the whole object through `storage-set`, as before.
    #[test]
    fn storage_merge_sends_the_fields_and_falls_back_on_an_older_host() {
        let fields = serde_json::json!({ "open": false }).as_object().cloned().unwrap();
        for ctx in [std::ptr::null_mut(), std::ptr::dangling_mut::<u8>().cast()] {
            let api = HostApi {
                size: size_of::<HostApi>(),
                major: 1,
                minor: 4,
                ctx,
                call: Some(record),
                free: Some(release),
                theme_mode: None,
                wake: None,
                send: None,
                report: None,
                stopped: None,
                features: Bytes::new(&[]),
            };
            HostHandle::new(&api).storage_merge("view", fields.clone());
        }
        let merge = HostRequest::StorageMerge { key: "view".into(), fields };
        assert_eq!(
            REQUESTS.with(|requests| requests.take()),
            [
                merge.clone(),
                merge,
                HostRequest::StorageGet { key: "view".into() },
                HostRequest::StorageSet { key: "view".into(), value: "{\"sibling\":1,\"open\":false}".into() },
            ]
        );
    }

    // Expected: revoking a waker waits for the wake in progress, and every clone's later wake does nothing.
    #[test]
    fn a_revoked_waker_waits_for_the_wake_in_progress_and_does_nothing_after() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::mpsc;
        let (entered, enter) = mpsc::channel();
        let (leave, left) = mpsc::channel::<()>();
        let left = std::sync::Mutex::new(left);
        let wakes = Arc::new(AtomicUsize::new(0));
        let counted = wakes.clone();
        let waker = Waker::new(move || {
            entered.send(()).unwrap();
            left.lock().unwrap().recv().unwrap();
            counted.fetch_add(1, Ordering::SeqCst);
        });
        let thread = std::thread::spawn({
            let waker = waker.clone();
            move || waker.wake()
        });
        enter.recv().unwrap();
        let revoked = std::thread::spawn({
            let (waker, wakes) = (waker.clone(), wakes.clone());
            move || {
                waker.revoke();
                wakes.load(Ordering::SeqCst)
            }
        });
        std::thread::sleep(std::time::Duration::from_millis(50));
        assert!(!revoked.is_finished(), "revoke returned while a wake was in progress");
        leave.send(()).unwrap();
        assert_eq!(revoked.join().unwrap(), 1);
        thread.join().unwrap();
        waker.wake();
        assert_eq!(wakes.load(Ordering::SeqCst), 1);
    }

    // Expected: a mount handler attaches to the claim registered last at its placement, which the manifest marks, and
    // a `Mount` request runs it with the input and whether the claim mounted; without such a claim it registers a
    // hidden one. The prompt input and the requests of step 7 keep their JSON optional.
    #[test]
    fn mounts_and_the_prompt_input_round_trip() {
        let mut registered = Registered::new("new", None);
        let mut setup = registered.setup();
        setup.slot(Placement::append("prompt.footer"), |_, _, _| Render::Hide);
        let seen = Rc::new(std::cell::RefCell::new(Vec::new()));
        let into = seen.clone();
        setup.on_mount(Placement::append("prompt.footer"), move |_, input, mounted| {
            into.borrow_mut().push((input.clone(), mounted));
        });
        setup.on_mount(Placement::append("home.footer"), |_, _, _| {});
        let marks: Vec<_> = setup.manifest().slots.iter().map(|claim| (claim.path.as_str(), claim.mount)).collect();
        assert_eq!(marks, [("prompt.footer", true), ("home.footer", true)]);
        assert_eq!(setup.renders().count(), 2);
        let input = SlotInput {
            session_id: Some("ses_1".into()),
            prompt: Some(PromptInput { shell: false, show_details: true }),
            ..SlotInput::default()
        };
        let json = r#"{"type":"mount","claim":0,"input":{"session_id":"ses_1","prompt":{"shell":false,"show_details":true}},"mounted":true}"#;
        let request = Request::Mount { claim: 0, input: input.clone(), mounted: true };
        assert_eq!(serde_json::to_string(&request).unwrap(), json);
        setup.handle(serde_json::from_str(json).unwrap()).unwrap();
        setup.handle(Request::Mount { claim: 0, input: input.clone(), mounted: false }).unwrap();
        setup.handle(Request::Mount { claim: 1, input: SlotInput::default(), mounted: true }).unwrap();
        assert_eq!(*seen.borrow(), [(input.clone(), true), (input, false)]);
        assert_eq!(serde_json::to_string(&SlotInput::default()).unwrap(), "{}");
        assert_eq!(serde_json::to_string(&Family::default()).unwrap(), r#"{"members":[],"cost":0.0}"#);
    }

    // Expected: a select keeps its JSON small; a wake handler marks the manifest, and `wake` runs every handler, while a
    // plugin without one keeps the 1.4 manifest it had.
    #[test]
    fn selects_and_wakes_round_trip() {
        let select = Dialog::Select(Select {
            title: "Subagents".into(),
            placeholder: None,
            options: vec![SelectOption::new("Child", "ses_1").description("running")],
            current: None,
            action: Action::Command { name: "x.open".into(), input: None },
            key: None,
            actions: Vec::new(),
            binds: Vec::new(),
            search: None,
            size: None,
            focus: None,
            query: None,
            query_delay: 0,
            filterless: false,
            empty: None,
            note: None,
            centered: false,
        });
        let json = r#"{"type":"select","title":"Subagents","options":[{"title":"Child","value":"ses_1","description":"running"}],"action":{"type":"command","name":"x.open"}}"#;
        assert_eq!(serde_json::to_string(&select).unwrap(), json);
        assert_eq!(serde_json::from_str::<Dialog>(json).unwrap(), select);
        assert_eq!(serde_json::to_string(&Request::Wake).unwrap(), r#"{"type":"wake"}"#);

        let mut registered = Registered::new("new", None);
        let mut setup = registered.setup();
        assert!(!serde_json::to_string(setup.manifest()).unwrap().contains("wake"));
        let runs = Rc::new(std::cell::Cell::new(0));
        for _ in 0..2 {
            let runs = runs.clone();
            setup.on_wake(move |_| runs.set(runs.get() + 1));
        }
        assert!(setup.manifest().wake);
        assert_eq!(setup.handle(serde_json::from_str(r#"{"type":"wake"}"#).unwrap()).unwrap(), serde_json::Value::Null);
        assert_eq!(runs.get(), 2);
        // P6b: the plugins' change runs the plugins handlers alone, and a manifest without one does not name it.
        assert!(!serde_json::to_string(setup.manifest()).unwrap().contains("plugins"));
        let heard = runs.clone();
        setup.on_plugins(move |_| heard.set(heard.get() + 10));
        assert!(setup.manifest().plugins);
        assert_eq!(serde_json::to_string(&Request::Plugins).unwrap(), r#"{"type":"plugins"}"#);
        assert_eq!(setup.handle(Request::Plugins).unwrap(), serde_json::Value::Null);
        assert_eq!(runs.get(), 12);
    }

    // Expected: what 1.5 adds reads back as written and leaves out what is unset, so a 1.4 box, layout and dialog keep
    // their JSON byte for byte, and 1.4 JSON reads as the 1.5 defaults.
    #[test]
    fn the_1_5_additions_round_trip_and_keep_the_1_4_wire() {
        let rows: [(&str, serde_json::Value); 9] = [
            (r#"{"type":"box","children":[]}"#, serde_json::to_value(Node::column(Vec::new())).unwrap()),
            (
                r#"{"type":"box","children":[],"border":{}}"#,
                serde_json::to_value(Node::column(Vec::new()).border(Border::new())).unwrap(),
            ),
            (
                r#"{"type":"box","children":[],"border":{"sides":{"top":false,"right":false,"bottom":false,"left":true},"style":"heavy","color":"text.muted","title":"t","title_align":"center"}}"#,
                serde_json::to_value(
                    Node::column(Vec::new()).border(
                        Border::new()
                            .sides(Sides { left: true, ..Sides::NONE })
                            .style(BorderStyle::Heavy)
                            .color("text.muted")
                            .title("t")
                            .title_align(TitleAlign::Center),
                    ),
                )
                .unwrap(),
            ),
            (
                r#"{"type":"box","children":[],"padding_sides":{"right":1,"left":2},"wrap":true,"overflow":"hidden"}"#,
                serde_json::to_value(
                    Node::column(Vec::new())
                        .padding_sides(Edges::new(0, 1, 0, 2))
                        .flex_wrap()
                        .overflow(Overflow::Hidden),
                )
                .unwrap(),
            ),
            (
                r#"{"height":{"cells":5},"min_height":{"percent":10.0},"max_height":{"cells":8},"margin":{"top":-1}}"#,
                serde_json::to_value(
                    Layout::default()
                        .height(Width::Cells(5))
                        .min_height(Width::Percent(10.0))
                        .max_height(Width::Cells(8))
                        .margin(Edges::new(-1, 0, 0, 0)),
                )
                .unwrap(),
            ),
            (
                r#"{"type":"confirm","title":"T","message":"M","action":{"type":"command","name":"x.a"}}"#,
                serde_json::to_value(Dialog::Confirm(Confirm {
                    title: "T".into(),
                    message: "M".into(),
                    label: ConfirmLabel::default(),
                    action: Action::Command { name: "x.a".into(), input: None },
                    size: None,
                    centered: false,
                }))
                .unwrap(),
            ),
            (
                r#"{"type":"alert","title":"T","message":"M","action":{"type":"command","name":"x.a"}}"#,
                serde_json::to_value(Dialog::Alert(Alert {
                    title: "T".into(),
                    message: "M".into(),
                    action: Some(Action::Command { name: "x.a".into(), input: None }),
                    size: None,
                    centered: false,
                }))
                .unwrap(),
            ),
            (r#"{"type":"composer"}"#, serde_json::to_value(HostRequest::Composer).unwrap()),
            (
                r#"{"type":"composer-edit","edit":{"type":"insert","text":"a"}}"#,
                serde_json::to_value(HostRequest::ComposerEdit { edit: ComposerEdit::Insert { text: "a".into() } })
                    .unwrap(),
            ),
        ];
        for (json, value) in &rows {
            assert_eq!(value.to_string(), *json);
        }
        let node: Node = serde_json::from_str(rows[3].0).unwrap();
        assert_eq!(serde_json::to_string(&node).unwrap(), rows[3].0);
        let layout: Layout = serde_json::from_str(rows[4].0).unwrap();
        assert_eq!(serde_json::to_string(&layout).unwrap(), rows[4].0);
        for json in [rows[5].0, rows[6].0] {
            assert_eq!(serde_json::to_string(&serde_json::from_str::<Dialog>(json).unwrap()).unwrap(), json);
        }
        let label = r#"{"type":"confirm","title":"T","message":"M","label":{"confirm":"yes"},"action":{"type":"command","name":"x.a"}}"#;
        let Dialog::Confirm(confirm) = serde_json::from_str(label).unwrap() else { panic!("not a confirm") };
        assert_eq!(confirm.label, ConfirmLabel { confirm: Some("yes".into()), cancel: None });
        let edits = [ComposerEdit::Set { text: "s".into() }, ComposerEdit::Submit];
        assert_eq!(serde_json::to_string(&edits).unwrap(), r#"[{"type":"set","text":"s"},{"type":"submit"}]"#);
        let composer = Composer { text: "é".into(), cursor: 2, focused: true };
        let json = r#"{"text":"é","cursor":2,"focused":true}"#;
        assert_eq!(serde_json::to_string(&composer).unwrap(), json);
        assert_eq!(serde_json::from_str::<Composer>(json).unwrap(), composer);
        // A 1.4 box's JSON reads as a box with none of the 1.5 properties.
        let old = r#"{"type":"box","row":true,"padding":[1,0],"layout":{"grow":true},"children":[]}"#;
        assert_eq!(
            serde_json::from_str::<Node>(old).unwrap(),
            Node::row(Vec::new()).padding(1, 0).layout(Layout::default().grow())
        );
    }

    /// A 1.4 host's `call`: it knows no request of 1.5, which it answers with an error, as `serde` refuses an unknown
    /// tag; it counts the requests it knows.
    unsafe extern "C" fn host_1_4(ctx: *mut c_void, request: Bytes, out: *mut Owned) -> i32 {
        // SAFETY: the test passes a live counter and the request's bytes.
        let (known, request) = unsafe { (&*ctx.cast::<std::sync::atomic::AtomicUsize>(), request.as_slice()) };
        let text = String::from_utf8_lossy(request);
        let newer = ["\"composer\"", "\"composer-edit\"", "\"confirm\"", "\"alert\""];
        let (status, reply) = match newer.iter().any(|tag| text.contains(&format!("\"type\":{tag}"))) {
            true => (ERROR, b"unsupported host request (host ABI 1.4)".to_vec()),
            false => {
                known.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                (OK, b"null".to_vec())
            }
        };
        unsafe { *out = Owned::from_vec(reply) };
        status
    }

    unsafe extern "C" fn free_vec(owned: Owned) {
        drop(unsafe { owned.into_vec() });
    }

    // Expected: a 1.5 plugin on a 1.4 host gets what that host offers: no composer, and an edit, a confirm and an alert
    // that do nothing and fail nothing, while the 1.4 requests still go through.
    #[test]
    fn a_1_5_plugin_on_a_1_4_host_gets_what_the_host_offers() {
        let known = std::sync::atomic::AtomicUsize::new(0);
        let api = HostApi {
            size: size_of::<HostApi>(),
            major: 1,
            minor: 4,
            ctx: std::ptr::from_ref(&known).cast_mut().cast(),
            call: Some(host_1_4),
            free: Some(free_vec),
            theme_mode: None,
            wake: None,
            send: None,
            report: None,
            stopped: None,
            features: Bytes::new(&[]),
        };
        let host = HostHandle::new(&api);
        assert_eq!(host.abi_minor(), 4);
        assert_eq!(host.composer(), None);
        host.edit_composer(ComposerEdit::Submit);
        let action = Action::Command { name: "x.a".into(), input: None };
        host.dialog(Dialog::Confirm(Confirm::new("T", "M", action.clone())));
        host.dialog(Dialog::Alert(Alert::new("T", "M")));
        assert_eq!(known.load(std::sync::atomic::Ordering::SeqCst), 0);
        host.dialog(Dialog::Prompt { title: "T".into(), placeholder: None, action });
        host.toast(Toast::new(Variant::Info, "a"));
        assert_eq!(known.load(std::sync::atomic::Ordering::SeqCst), 2);
    }

    /// A text delta of message `msg_1` in `ses_1`.
    fn text_delta(delta: &str) -> V2Event {
        serde_json::from_value(serde_json::json!({
            "id": "evt_1",
            "created": 1,
            "type": "session.text.delta",
            "data": { "sessionID": "ses_1", "assistantMessageID": "msg_1", "ordinal": 0, "delta": delta },
        }))
        .unwrap()
    }

    // Expected: what 1.6 adds reads back as written and leaves out what is unset, so a 1.4 span, slot input, panel and
    // manifest keep their JSON byte for byte.
    #[test]
    fn the_1_6_additions_round_trip_and_keep_the_older_wire() {
        let rows: [(&str, serde_json::Value); 12] = [
            (r#"{"text":"a"}"#, serde_json::to_value(Span::new("a")).unwrap()),
            (
                r#"{"text":"a","link":"https://x.dev"}"#,
                serde_json::to_value(Span::new("a").link("https://x.dev")).unwrap(),
            ),
            (r#"{}"#, serde_json::to_value(SlotInput::default()).unwrap()),
            (
                r#"{"session_id":"s","width":40,"height":3}"#,
                serde_json::to_value(SlotInput { session_id: Some("s".into()), width: 40, height: 3, prompt: None })
                    .unwrap(),
            ),
            (r#""xlarge""#, serde_json::to_value(PanelSize::XLarge).unwrap()),
            (r#"{"type":"set-variant"}"#, serde_json::to_value(HostRequest::SetVariant { variant: None }).unwrap()),
            (
                r#"{"type":"tab","edit":{"type":"move","session":"ses_1","index":2}}"#,
                serde_json::to_value(HostRequest::Tab { edit: TabEdit::Move { session: "ses_1".into(), index: 2 } })
                    .unwrap(),
            ),
            (
                r#"{"type":"tab","edit":{"type":"close"}}"#,
                serde_json::to_value(HostRequest::Tab { edit: TabEdit::Close { session: None } }).unwrap(),
            ),
            (
                r#"{"type":"foreground","command":"less","args":["a.txt"]}"#,
                serde_json::to_value(HostRequest::Foreground(Foreground {
                    command: "less".into(),
                    args: vec!["a.txt".into()],
                    cwd: None,
                }))
                .unwrap(),
            ),
            (
                r#"{"session_id":"ses_1","active":true,"unread":"error"}"#,
                serde_json::to_value(Tab {
                    session_id: "ses_1".into(),
                    active: true,
                    unread: Some(Unread::Error),
                    ..Tab::default()
                })
                .unwrap(),
            ),
            (
                r#"{"id":"x.a","enabled":true,"slash":{"name":"a"}}"#,
                serde_json::to_value(KeymapCommand {
                    id: "x.a".into(),
                    enabled: true,
                    slash: Some(KeymapSlash { name: "a".into(), ..KeymapSlash::default() }),
                    ..KeymapCommand::default()
                })
                .unwrap(),
            ),
            (
                r#"{"key":"ctrl+x","continues":true}"#,
                serde_json::to_value(KeymapActive { key: "ctrl+x".into(), continues: true, ..KeymapActive::default() })
                    .unwrap(),
            ),
        ];
        for (json, value) in &rows {
            assert_eq!(value.to_string(), *json);
        }
        assert_eq!(serde_json::from_str::<Span>(rows[1].0).unwrap(), Span::new("a").link("https://x.dev"));
        let input: SlotInput = serde_json::from_str(rows[3].0).unwrap();
        assert_eq!((input.width, input.height), (40, 3));
        let edit: HostRequest = serde_json::from_str(rows[6].0).unwrap();
        assert_eq!(edit, HostRequest::Tab { edit: TabEdit::Move { session: "ses_1".into(), index: 2 } });
        assert_eq!(serde_json::from_str::<PanelSize>(r#""xlarge""#).unwrap(), PanelSize::XLarge);

        // Deltas: the manifest says so only with a handler, and the request runs each handler with the events.
        let mut registered = Registered::new("new", None);
        let mut setup = registered.setup();
        assert!(!serde_json::to_string(setup.manifest()).unwrap().contains("deltas"));
        let seen = Rc::new(std::cell::RefCell::new(Vec::new()));
        let into = seen.clone();
        setup.on_deltas(move |_, events| into.borrow_mut().push(events.len()));
        assert!(setup.manifest().deltas);
        let request = Request::Deltas { events: vec![text_delta("a"), text_delta("b")] };
        let json = serde_json::to_string(&request).unwrap();
        assert!(json.starts_with(r#"{"type":"deltas","events":[{"#), "{json}");
        assert_eq!(serde_json::from_str::<Request>(&json).unwrap(), request);
        assert_eq!(setup.handle(request).unwrap(), serde_json::Value::Null);
        assert_eq!(*seen.borrow(), [2]);
    }

    /// A 1.4 host: it decodes a toast and a dialog of a size it knows and answers `null`, logs every request in the
    /// `Vec` at `ctx`, and answers every other request, and a panel of a size it does not know, with an error.
    unsafe extern "C" fn host_before_1_6(ctx: *mut c_void, request: Bytes, out: *mut Owned) -> i32 {
        // SAFETY: the test passes a live log and the request's bytes.
        let (log, request) = unsafe { (&*ctx.cast::<std::sync::Mutex<Vec<String>>>(), request.as_slice()) };
        let text = String::from_utf8_lossy(request).into_owned();
        let json: serde_json::Value = serde_json::from_slice(request).unwrap();
        let known = match json["type"].as_str() {
            Some("toast") => true,
            Some("dialog") => ["medium", "large"].contains(&json["dialog"]["size"].as_str().unwrap_or("medium")),
            _ => false,
        };
        let (status, reply) = match known {
            true => (OK, b"null".to_vec()),
            false => (ERROR, b"unsupported host request (host ABI 1.4)".to_vec()),
        };
        log.lock().unwrap().push(text);
        unsafe { *out = Owned::from_vec(reply) };
        status
    }

    unsafe extern "C" fn free_buffer(owned: Owned) {
        drop(unsafe { owned.into_vec() });
    }

    // Expected: a 1.6 plugin on an older host gets what that host offers: every read its default, every verb `false`
    // or nothing, and an xlarge panel shown large, while the older requests still go through.
    #[test]
    fn a_1_6_plugin_on_an_older_host_gets_what_the_host_offers() {
        let log = std::sync::Mutex::new(Vec::<String>::new());
        let api = HostApi {
            size: size_of::<HostApi>(),
            major: 1,
            minor: 4,
            ctx: std::ptr::from_ref(&log).cast_mut().cast(),
            call: Some(host_before_1_6),
            free: Some(free_buffer),
            theme_mode: None,
            wake: None,
            send: None,
            report: None,
            stopped: None,
            features: Bytes::new(&[]),
        };
        let host = HostHandle::new(&api);
        assert_eq!((host.variants(), host.tabs_enabled(), host.tabs()), (Vec::new(), false, Vec::new()));
        assert_eq!((host.keymap_pending(), host.keymap_active()), (Vec::new(), Vec::new()));
        assert_eq!((host.keymap_commands(), host.shortcuts("x")), (Vec::new(), Vec::<String>::new()));
        assert_eq!((host.selection(), host.theme(), host.themes()), (None, None, Vec::<String>::new()));
        assert!(!host.set_variant(Some("high")));
        assert!(!host.edit_tab(TabEdit::Focus { session: "ses_1".into() }));
        assert!(!host.set_theme("nord"));
        assert!(host.try_foreground(Foreground { command: "less".into(), ..Foreground::default() }).is_err());
        host.set_model("p", "m");
        host.clear_selection();
        host.set_title("t");
        host.install_theme("t", serde_json::json!({}));
        host.toast(Toast::new(Variant::Info, "a"));
        let panel = |size| Panel {
            key: "k".into(),
            size,
            title: Vec::new(),
            subtitle: None,
            body: Node::column(Vec::new()),
            actions: Vec::new(),
            binds: Vec::new(),
            bleed: false,
            centered: false,
            bare: false,
            close: None,
            height: None,
        };
        host.dialog(Dialog::Panel(panel(PanelSize::XLarge)));
        // A panel whose text says `xlarge` is not one (review bigboi-12).
        host.dialog(Dialog::Panel(Panel { title: vec![Span::new("xlarge")], ..panel(PanelSize::Large) }));
        let log = std::mem::take(&mut *log.lock().unwrap());
        let shown: Vec<&String> = log.iter().filter(|request| request.contains("\"type\":\"dialog\"")).collect();
        // Each sent once, the xlarge one as large.
        assert_eq!(shown.len(), 2, "{log:?}");
        assert!(shown.iter().all(|shown| shown.contains("\"size\":\"large\"")), "{log:?}");
        assert_eq!(log.iter().filter(|request| request.contains("\"type\":\"toast\"")).count(), 1);
        // Every read and verb above asked once, and nothing more.
        assert_eq!(log.len(), 21, "{log:?}");

        // A 1.6 host gets xlarge, once, also when it refuses the dialog for another reason.
        let current = HostApi { minor: 6, ..api };
        let host = HostHandle::new(&current);
        host.dialog(Dialog::Panel(panel(PanelSize::XLarge)));
        let log = log_of(&current);
        assert_eq!(log.len(), 1, "{log:?}");
        assert!(log[0].contains("\"size\":\"xlarge\""), "{log:?}");
    }

    /// What `api`'s host logged.
    fn log_of(api: &HostApi) -> Vec<String> {
        // SAFETY: the test's `ctx` is a live log.
        let log = unsafe { &*api.ctx.cast::<std::sync::Mutex<Vec<String>>>() };
        std::mem::take(&mut *log.lock().unwrap())
    }

    unsafe extern "C" fn sent(_: *mut c_void, _: Bytes, _: Bytes) -> i32 {
        OK
    }

    unsafe extern "C" fn reported(_: *mut c_void, _: Bytes) {}

    unsafe extern "C" fn running(_: *mut c_void) -> u32 {
        0
    }

    // Expected (reviews carbon-2, carbon-7): a plugin reads the 2.0 entries and the features from a host of major 2 only;
    // a table of major 1, though as long, offers no link and no features.
    #[test]
    fn only_a_2_0_host_offers_threads_and_features() {
        let features = br#"["terminal"]"#;
        let api = HostApi {
            size: size_of::<HostApi>(),
            major: 2,
            minor: 0,
            ctx: std::ptr::null_mut(),
            call: Some(call),
            free: Some(free),
            theme_mode: None,
            wake: None,
            send: Some(sent),
            report: Some(reported),
            stopped: Some(running),
            features: Bytes::new(features),
        };
        let host = HostHandle::new(&api);
        assert!(host.link().is_some());
        assert_eq!(host.features(), ["terminal"]);
        let mut registered = Registered::with_host("x", None, &api);
        assert_eq!(registered.setup().features(), ["terminal"]);
        let old = HostApi { major: 1, minor: 4, ..api };
        let host = HostHandle::new(&old);
        assert!(host.link().is_none() && host.features().is_empty());
    }

    // Expected (reviews bigboi-5, carbon-7): a plugin has one message type; a second registration is an error.
    #[test]
    fn a_plugin_registers_one_message_type() {
        let mut registered = Registered::new("x", None);
        let mut setup = registered.setup();
        assert!(setup.messages(|_, _: u64| {}).is_ok());
        assert!(setup.messages(|_, _: i64| {}).is_err());
        assert!(setup.manifest().messages);
    }

    // Expected (reviews bigboi-5, carbon-4): a message that does not cross as JSON and come back as itself is handed back
    // as `Unencodable` before any carrier sees it: a NaN, a map whose keys are not strings, a serializer that fails.
    // One that does crosses (here to a closed plugin, so `Closed`), an integer past 64 bits too: the host keeps the
    // sender's JSON text and never reads it as a number of its own.
    #[test]
    fn a_message_json_cannot_carry_is_handed_back() {
        struct Failing;
        impl Serialize for Failing {
            fn serialize<S: serde::Serializer>(&self, _: S) -> Result<S::Ok, S::Error> {
                Err(serde::ser::Error::custom("no"))
            }
        }
        impl<'de> Deserialize<'de> for Failing {
            fn deserialize<D: serde::Deserializer<'de>>(_: D) -> Result<Self, D::Error> {
                Ok(Failing)
            }
        }
        let closed = mail::Revocable::default();
        assert!(matches!(Sender::<f64>::new(closed.clone()).send(f64::NAN), Err(SendError::Unencodable(_))));
        assert_eq!(Sender::<f64>::new(closed.clone()).send(1.5), Err(SendError::Closed(1.5)));
        let wide = u128::from(u64::MAX) + 1;
        assert_eq!(Sender::<u128>::new(closed.clone()).send(wide), Err(SendError::Closed(wide)));
        assert_eq!(Sender::<u128>::new(closed.clone()).send(7), Err(SendError::Closed(7)));
        let keys = std::collections::BTreeMap::from([(vec![1u8], 1u8)]);
        let sender = Sender::<std::collections::BTreeMap<Vec<u8>, u8>>::new(closed.clone());
        assert!(matches!(sender.send(keys), Err(SendError::Unencodable(_))));
        assert!(matches!(Sender::<Failing>::new(closed).send(Failing), Err(SendError::Unencodable(_))));
    }

    // Expected (review carbon-4): content crosses whole: UTF-8 as a string, other bytes as base64, both back as they
    // were; a view's content in a reply is the bytes it gave.
    #[test]
    fn content_crosses_whole() {
        for (bytes, base64) in
            [(&b""[..], ""), (b"f", "Zg=="), (b"fo", "Zm8="), (b"foo", "Zm9v"), (b"foob", "Zm9vYg==")]
        {
            assert_eq!(base64::encode(bytes), base64);
            assert_eq!(base64::decode(base64).as_deref(), Some(bytes));
        }
        assert_eq!(base64::decode("Zm9v=Zg="), None);
        assert_eq!(base64::decode("Zm9"), None);
        assert_eq!(base64::decode("Zm9!"), None, "a byte out of the alphabet");
        let every: Vec<u8> = (0..=255).chain((0..=255).rev()).collect();
        assert_eq!(base64::encode(&every[..255]).len(), 340);
        for len in 0..every.len() {
            assert_eq!(base64::decode(&base64::encode(&every[..len])).as_deref(), Some(&every[..len]), "{len}");
        }
        let binary = Blob(vec![0xff, 0x00, 0x89, b'P', b'N', b'G']);
        let json = serde_json::to_string(&binary).unwrap();
        assert_eq!(json, r#"{"base64":"/wCJUE5H"}"#);
        assert_eq!(serde_json::from_str::<Blob>(&json).unwrap(), binary);
        assert_eq!(serde_json::to_string(&Blob(b"text".to_vec())).unwrap(), r#""text""#);

        let mut registered = Registered::new("x", None);
        let given = binary.0.clone();
        registered.setup().surface(v2::Surface::new("s", v2::Place::Route("s".into()), move |cx| {
            let handle = cx.content(given.clone());
            v2::Node::Diff {
                id: None,
                content: v2::Source::Content(handle),
                view: v2::DiffView::Unified,
                filetype: None,
                hunks: None,
                wrap: Default::default(),
                padding: 0,
            }
        }));
        let mount = v2::MountId { surface: "s".into(), key: "s".into(), generation: 1 };
        let request = Request::View { surface: 0, mount, input: v2::SurfaceInput::default(), next: 4 };
        let reply: ViewReply = serde_json::from_value(registered.handle(request).unwrap()).unwrap();
        assert_eq!(reply.content, [(v2::ContentRef(5), binary)]);
    }

    // Expected (P5 over the C ABI): a surface with a draw says so in the manifest; a draw request carries its frame as
    // the header documents it, and the shim answers with the list's bytes as they are, none to keep the list, and an
    // error for a surface without a draw or a draw asked through JSON.
    #[test]
    fn a_draw_answers_with_the_lists_bytes() {
        let mut registered = Registered::new("x", None);
        let surface = |name: &str| v2::Surface::new(name, v2::Place::Route(name.into()), |_| v2::Node::canvas("c"));
        registered.setup().surface(surface("drawn").draw(|cx| {
            (cx.frame.cause == v2::Cause::Animate).then(|| {
                let mut list = canvas::List::new();
                list.text(0, 0, cx.canvas, canvas::Style::new());
                list
            })
        }));
        registered.setup().surface(surface("still"));
        let claims: Vec<bool> = registered.manifest.surfaces.iter().map(|claim| claim.draw).collect();
        assert_eq!(claims, [true, false]);
        let instance = Box::into_raw(Box::new(registered)).cast::<c_void>();
        let draw = |surface: usize, cause: v2::Cause| {
            let mount = v2::MountId { surface: "drawn".into(), key: "drawn".into(), generation: 1 };
            let frame = v2::Frame { width: 4, height: 1, cause, dt: std::time::Duration::from_micros(16_667) };
            let request = Request::Draw { surface, mount, canvas: "c".into(), frame };
            let json = serde_json::to_value(&request).unwrap();
            assert_eq!(
                json["frame"],
                serde_json::json!({ "width": 4, "height": 1, "cause": cause, "dt": { "secs": 0, "nanos": 16_667_000 } })
            );
            let mut out = Owned::EMPTY;
            // SAFETY: `instance` is the registration above, destroyed below; `out` goes back to this library's `free`.
            unsafe {
                let status = runtime::call(instance, Bytes::new(&serde_json::to_vec(&json).unwrap()), &mut out);
                let bytes = out.to_vec();
                runtime::free(out);
                (status, bytes)
            }
        };
        let mut list = canvas::List::new();
        list.text(0, 0, "c", canvas::Style::new());
        assert_eq!(draw(0, v2::Cause::Animate), (OK, list.into_bytes()));
        assert_eq!(draw(0, v2::Cause::Version), (OK, Vec::new()));
        assert_eq!(draw(1, v2::Cause::First), (ERROR, b"the surface has no draw".to_vec()));
        assert_eq!(draw(2, v2::Cause::First), (ERROR, b"no such surface".to_vec()));
        // SAFETY: as above.
        let registered = unsafe { Box::from_raw(instance.cast::<Registered>()) };
        let mount = v2::MountId { surface: "drawn".into(), key: "drawn".into(), generation: 1 };
        let frame = v2::Frame { width: 4, height: 1, cause: v2::Cause::First, dt: std::time::Duration::ZERO };
        let json = registered.handle(Request::Draw { surface: 0, mount, canvas: "c".into(), frame });
        assert_eq!(json, Err("a draw answers with the list's bytes, not JSON".to_owned()));
    }

    // Expected (review carbon-7): a thread the spawner starts is named `<plugin id>:<name>`.
    #[test]
    fn a_plugin_thread_carries_the_plugin_name() {
        let (named, name) = std::sync::mpsc::channel();
        let spawner = Spawner::new("x.y", mail::Revocable::default());
        spawner.spawn("work", move |_| named.send(std::thread::current().name().map(str::to_owned)).unwrap()).unwrap();
        assert_eq!(name.recv().unwrap().as_deref(), Some("x.y:work"));
    }

    fn named(_: &mut Setup) -> Result<(), String> {
        Ok(())
    }

    plugin!(named);

    // Expected (review carbon-7): `plugin!(setup)` takes the crate's package name as the plugin's ID.
    #[test]
    fn plugin_without_an_id_takes_the_package_name() {
        let api = opencode_plugin_v2();
        // SAFETY: the table the macro exported, with its `describe`.
        let describe = unsafe { (*api).describe.unwrap() };
        let mut out = Owned::EMPTY;
        // SAFETY: `out` is valid for writes, and goes back to the shims' `free`.
        let bytes = unsafe {
            assert_eq!(describe(&mut out), OK);
            out.into_vec()
        };
        let metadata: Metadata = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(metadata.id.as_deref(), Some("opencode-plugin-abi"));
    }
}
