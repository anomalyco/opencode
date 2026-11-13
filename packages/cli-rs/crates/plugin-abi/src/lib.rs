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
//! - The major version is for a deliberate breaking change. A major mismatch is the only thing that refuses a
//!   plugin outright. The entry symbol carries the major version (`opencode_plugin_v1`).
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
//! and answers in the old format. A plugin built with this crate sets [`PluginApi::requires_minor`] to 4, so a 1.3
//! host refuses it.
//!
//! Session and catalog values are the HTTP API's generated types, re-exported as [`types`].

#![allow(unsafe_code)]

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

/// The major version: changes only with a deliberate breaking change, and a mismatch refuses the plugin.
pub const ABI_MAJOR: u32 = 1;
/// The minor version: grows when entries are appended. 1.0 is the core; 1.1 adds [`PluginApi::describe`]; 1.2 adds
/// [`HostApi::theme_mode`]; 1.3 adds [`HostApi::wake`]; 1.4 adds [`Manifest::render`], [`Request::RenderFence`],
/// [`Request::Render`], [`Request::Event`], [`HostRequest::Color`], the session and catalog reads,
/// [`HostRequest::Info`], [`HostRequest::Route`], [`HostRequest::Dispatch`], [`HostRequest::Attention`], and the
/// requests of routes, replies, dialogs, navigation and the clipboard ([`Request::RenderRoute`], [`Request::Reply`],
/// [`HostRequest::Fetch`], [`HostRequest::Navigate`], [`HostRequest::Dialog`], [`HostRequest::Copy`]), and of mounts and
/// the prompt ([`Request::Mount`], [`HostRequest::Interactive`], [`HostRequest::Shortcut`],
/// [`HostRequest::DialogOpen`]), [`Dialog::Select`], [`Request::Wake`], [`Request::RouteMount`],
/// [`HostRequest::StorageMerge`] and [`Request::FenceGone`]. 1.5 adds [`Dialog::Confirm`] and [`Dialog::Alert`], the
/// box styling of [`Node::Box`] ([`Border`], [`Edges`], [`Overflow`]) and [`Layout`]'s heights and margins, and the
/// composer: [`HostRequest::Composer`] and [`HostRequest::ComposerEdit`].
pub const ABI_MINOR: u32 = 5;

/// The symbol every plugin exports, of type [`EntryFn`].
pub const ENTRY: &str = "opencode_plugin_v1";

/// Status codes of [`PluginApi::create`], [`PluginApi::call`], and [`HostApi::call`]. With [`OK`] the output buffer
/// holds the JSON result; otherwise it holds the error text.
pub const OK: i32 = 0;
pub const ERROR: i32 = 1;
/// The callee panicked; the output holds the panic message.
pub const PANIC: i32 = 2;

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

    /// # Safety
    /// `ptr` must point to `len` readable bytes that outlive the returned slice, or be null.
    pub unsafe fn as_slice<'a>(self) -> &'a [u8] {
        if self.ptr.is_null() {
            return &[];
        }
        unsafe { std::slice::from_raw_parts(self.ptr, self.len) }
    }
}

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
    /// `self` must come from [`Owned::from_vec`] in the same library, or be [`Owned::EMPTY`].
    pub unsafe fn into_vec(self) -> Vec<u8> {
        if self.ptr.is_null() {
            return Vec::new();
        }
        unsafe { Vec::from_raw_parts(self.ptr, self.len, self.cap) }
    }

    /// A copy of the bytes, leaving the buffer for its owner to free.
    ///
    /// # Safety
    /// `ptr` must point to `len` readable bytes, or be null.
    pub unsafe fn to_vec(&self) -> Vec<u8> {
        unsafe { Bytes { ptr: self.ptr, len: self.len }.as_slice().to_vec() }
    }
}

/// What the host gives a plugin instance. It stays valid until the host destroys the instance. A plugin reads an
/// entry only when `size` covers it.
#[repr(C)]
pub struct HostApi {
    /// `size_of::<HostApi>()` of the host's build.
    pub size: usize,
    pub major: u32,
    pub minor: u32,
    pub ctx: *mut c_void,
    /// Handles a [`HostRequest`] and writes the JSON result into `out`. A plugin treats a null entry, or a null
    /// `free`, as a host that answers every request with an error.
    pub call: Option<unsafe extern "C" fn(ctx: *mut c_void, request: Bytes, out: *mut Owned) -> i32>,
    /// Frees a buffer `call` wrote.
    pub free: Option<unsafe extern "C" fn(owned: Owned)>,
    // 1.2
    /// Whether the page theme is dark ([`THEME_DARK`]) or light ([`THEME_LIGHT`]), as TS plugins read
    /// `api.themeMode`.
    pub theme_mode: Option<unsafe extern "C" fn(ctx: *mut c_void) -> u32>,
    // 1.3
    /// Asks the host to request the rows of the plugin's mounted slot claims and routes again, on its UI thread.
    /// It is a redraw hint: it carries no data and drains nothing for the plugin, which keeps its own results and
    /// reads all of them when the host asks for rows. Wakes that arrive before the host handles one count once, and
    /// the host never drops the last one. Callable from any thread, but `ctx` is valid only until `destroy` returns,
    /// so a plugin makes sure no thread calls it after that. A Rust plugin reads it as [`Setup::waker`], whose
    /// [`Waker`] the SDK revokes in `destroy`.
    pub wake: Option<unsafe extern "C" fn(ctx: *mut c_void)>,
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
pub struct Metadata {
    /// The plugin's own version, such as its crate version.
    #[serde(default)]
    pub version: Option<String>,
    /// The plugin's ID, the one its [`Manifest`] will have. A host that knows it before setup serves storage
    /// requests during setup; older hosts ignore it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
}

/// Everything a plugin registered in its setup.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
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
}

/// What [`Manifest::render`] is for the render requests of ABI 1.4.
pub const RENDER: u32 = 2;

fn is_zero(value: &u32) -> bool {
    *value == 0
}

/// A command: in the palette when `palette` is set, as `/slash`, and on `keybind` (such as `ctrl+shift+h`).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
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

/// Where a [`Command`] runs: everywhere, or while the plugin's route of that name shows.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Scope {
    #[default]
    Global,
    Route(String),
}

impl Scope {
    fn is_global(&self) -> bool {
        *self == Scope::Global
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SlotKind {
    Prepend,
    Append,
    Before,
    After,
    Replace,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
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
}

/// Where a slot claim of [`Setup::slot`] goes.
#[derive(Clone, Debug, PartialEq, Eq)]
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
}

fn is_false(value: &bool) -> bool {
    !value
}

/// One row; the host draws rows without wrapping and scrolls a wide fence sideways.
pub type Line = Vec<Span>;

/// A fenced Markdown code block, as [`Setup::code_block`] renders it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
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
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", content = "node", rename_all = "kebab-case")]
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
pub enum Press {
    Down,
    Up,
}

/// What a click asks the host to do, after the event that caused it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
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
pub enum Width {
    Cells(u16),
    Percent(f32),
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
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
pub struct SlotInput {
    /// `prompt.footer*`, `session.composer.top` and `sidebar.*`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// `prompt.footer*`: the prompt's mode and whether its details show.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt: Option<PromptInput>,
}

/// What the prompt passes to the claims of `prompt.footer*`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PromptInput {
    /// The prompt is in shell mode.
    pub shell: bool,
    /// The footer has room for its details: the usage and the shortcuts.
    pub show_details: bool,
}

/// What changed since a claim last rendered. A claim that has not rendered yet gets `all`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
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
    /// The host's own state changed: the selected model, the usage limits, the settings, the plugins' storage.
    #[serde(default, skip_serializing_if = "is_false")]
    pub local: bool,
    /// The terminal changed size.
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
pub struct LocationRef {
    pub directory: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SessionStatus {
    #[default]
    Idle,
    Running,
}

/// A session, from [`Read::session`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Session {
    pub info: SessionInfo,
    pub status: SessionStatus,
}

/// A session's family, from [`Read::family`]: its root and every known descendant.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
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

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
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
}

/// A fence for the render of [`Setup::code_block`] that [`Manifest::fences`] names by `index`. The host matches a fence
/// to its render by the language it registered, which [`Fence::language`] may not be: the host normalizes a language
/// (`ts` becomes `typescript`), so the plugin finds its render by `index`. A host that sends no `index` matches by
/// language.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
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
        dialog: Dialog,
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
}

/// 1.5: the composer on screen, from [`Read::composer`].
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
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
pub enum ComposerEdit {
    /// Replaces the text and its attachments, and puts the cursor at the end (TS `ref.set`). The mode stays.
    Set { text: String },
    /// Inserts `text` at the cursor, in place of a selection, as typing it does.
    Insert { text: String },
    /// Submits the composer as enter does, whether or not it has focus (TS `ref.submit`).
    Submit,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Level {
    Debug,
    Info,
    Warn,
    Error,
}

/// A toast's kind, which sets its color.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Variant {
    Info,
    Success,
    Warning,
    Error,
}

/// A toast, for [`Host::toast`]. With a `session`, the toast offers to open that session unless the session's
/// family is on screen.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
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
pub enum When {
    Always,
    Focused,
    Blurred,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
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
}

/// What [`Host::fetch`] returns, and [`Setup::on_reply`] gets back with the reply.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct RequestId(pub u64);

/// A dialog, for [`Host::dialog`]. It replaces the dialogs that are open, unless it is a [`Panel`] whose key is open.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Dialog {
    /// A one-line text field. Enter closes it and runs `action` with the text as its input; escape closes it.
    Prompt {
        title: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        placeholder: Option<String>,
        action: Action,
    },
    Panel(Panel),
    /// Closes the plugin's [`Panel`] `key` if it is open.
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
}

/// A [`Dialog::Confirm`]. `Confirm` is active as it opens; the arrows and tab move between the buttons, and enter or a
/// click closes it and runs `action` with `true` for `Confirm` or `false` for `Cancel` as the input, as TS resolves
/// `true` or `false`. Escape cancels. When another dialog replaces it, nothing runs, as TS resolves `undefined`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Confirm {
    pub title: String,
    /// Muted text under the title.
    pub message: String,
    /// The buttons' labels, which the host shows in title case.
    #[serde(default, skip_serializing_if = "ConfirmLabel::is_default")]
    pub label: ConfirmLabel,
    pub action: Action,
}

/// The labels of a [`Confirm`]'s buttons; `confirm` and `cancel` when unset.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
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
pub struct Alert {
    pub title: String,
    /// Muted text under the title.
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub action: Option<Action>,
}

/// A [`Dialog::Select`] (TS `dialog.select`).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
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
}

/// An option of a [`Select`].
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
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
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PanelSize {
    #[default]
    Medium,
    Large,
}

/// A footer action of a [`Panel`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
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
    /// Calls `visit` with the loaded messages of session `id`, oldest first; empty when none are loaded. In process
    /// the host lends its own list; over the C ABI the plugin gets a copy.
    fn messages(&self, _id: &str, visit: &mut dyn FnMut(&[SessionMessageInfo])) {
        visit(&[]);
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
    /// Whether the plugin's [`Panel`] `key` is open.
    fn dialog_open(&self, _key: &str) -> bool {
        false
    }
    /// 1.5: the composer on screen, on home or in a session; `None` without one, and from a 1.4 host.
    fn composer(&self) -> Option<Composer> {
        None
    }
}

/// What a command or an event handler reads and asks of the host. An effect waits until the outermost plugin
/// callback has returned, and effects run in the order they were asked for.
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
    /// Sends `fetch` to the server. [`Setup::on_reply`] gets the reply, with the ID this returns, unless the plugin is
    /// disposed first.
    fn fetch(&self, fetch: Fetch) -> RequestId;
    /// Shows `dialog`.
    fn dialog(&self, dialog: Dialog);
    /// Copies `text` to the clipboard, then runs `then` once it is copied; a toast says so when it fails.
    fn copy(&self, text: &str, then: Option<Action>);
    /// 1.5: edits the composer on screen; without one, and on a 1.4 host, it does nothing.
    fn edit_composer(&self, _edit: ComposerEdit) {}
    /// Declares storage key `key` of the plugin, for [`Setup::storage_key`].
    #[doc(hidden)]
    fn declare_storage_key(&self, _key: &str) {}
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
#[derive(Clone, Copy, Default)]
struct HostHandle {
    api: *const HostApi,
}

impl HostHandle {
    fn request(&self, request: &HostRequest) -> Result<serde_json::Value, String> {
        let json = serde_json::to_vec(request).map_err(|error| error.to_string())?;
        let mut out = Owned::EMPTY;
        let core = self.core().ok_or("no host")?;
        let (Some(call), Some(free)) = (core.call, core.free) else {
            return Err("the host takes no requests".to_owned());
        };
        // SAFETY: `call` writes `out`, which `free` takes back.
        let (status, bytes) = unsafe {
            let status = call(core.ctx, Bytes::new(&json), &mut out);
            let bytes = out.to_vec();
            free(out);
            (status, bytes)
        };
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
        (size >= size_of::<HostApiV1_1>()).then(|| unsafe { &*self.api.cast::<HostApiV1_1>() })
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

    fn messages(&self, id: &str, visit: &mut dyn FnMut(&[SessionMessageInfo])) {
        // The copy is the plugin's own, so `visit` may call the host again.
        let messages: Vec<SessionMessageInfo> =
            self.read(&HostRequest::Messages { id: id.to_owned() }).unwrap_or_default();
        visit(&messages);
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
}

impl Host for HostHandle {
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
        // A host without fetch never replies; an ID no reply carries is as good as any.
        self.read(&HostRequest::Fetch(fetch)).unwrap_or(RequestId(0))
    }

    fn dialog(&self, dialog: Dialog) {
        let _ = self.request(&HostRequest::Dialog { dialog });
    }

    fn copy(&self, text: &str, then: Option<Action>) {
        let _ = self.request(&HostRequest::Copy { text: text.to_owned(), then });
    }

    fn edit_composer(&self, edit: ComposerEdit) {
        let _ = self.request(&HostRequest::ComposerEdit { edit });
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
///     setup.command(Command { name: "x.hello".into(), ..Command::default() }, |host, _| {
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
        self.registered.manifest.slots.push(SlotClaim { kind: at.kind, path: at.path, render: true, mount: false });
        self.registered.slots.push(SlotFn::Render(Rc::new(render)));
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
        self.registered.manifest.slots.push(SlotClaim { kind, path: path.to_owned(), render: false, mount: false });
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
    fence_gone: Vec<FenceGoneFn>,
    disposers: Vec<DisposeFn>,
}

impl Registered {
    /// The registrations of a plugin the host runs in process: without an ABI host, so a [`Setup`] of its own
    /// ([`Registered::setup`]) answers every request with an error.
    pub fn new(id: &str, options: Option<String>) -> Self {
        Self::with_host(id, options, std::ptr::null())
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

    /// Disposes the plugin: revokes its waker, waiting for the wakes in progress, then runs the dispose callbacks, last
    /// registered first, with `host` (the registration's own without one). A callback that panics does not keep the
    /// others from running.
    pub fn dispose(&mut self, host: Option<&dyn Host>) {
        if let Some(waker) = &self.waker {
            waker.revoke();
        }
        let (disposers, own) = (std::mem::take(&mut self.disposers), self.host);
        let host = host.unwrap_or(&own);
        for run in disposers.into_iter().rev() {
            if let Err(panic) = catch_unwind(AssertUnwindSafe(|| run(host))) {
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

    /// The handlers of [`Setup::on_fence_gone`].
    pub fn fence_gone(&self) -> &[FenceGoneFn] {
        &self.fence_gone
    }

    /// The reply handlers.
    pub fn replies(&self) -> &[ReplyFn] {
        &self.replies
    }

    /// The event handlers, with the types each takes.
    pub fn events(&self) -> impl Iterator<Item = (&[String], &EventFn)> {
        self.manifest.events.iter().map(Vec::as_slice).zip(&self.events)
    }

    fn with_host(id: &str, options: Option<String>, host: *const HostApi) -> Self {
        let host = HostHandle { api: host };
        Self {
            manifest: Manifest { id: id.to_owned(), render: RENDER, ..Manifest::default() },
            options,
            host,
            waker: host.waker(),
            ..Self::default()
        }
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
            Request::RouteMount { name, mounted } => {
                let runs = self.route_mounts.iter().filter(|(route, _)| *route == name);
                runs.for_each(|(_, run)| run(&self.host, mounted));
                Ok(serde_json::Value::Null)
            }
            Request::FenceGone { key } => {
                self.fence_gone.iter().for_each(|run| run(key));
                Ok(serde_json::Value::Null)
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

/// Exports a plugin: `export_plugin!("my.plugin", setup)` with `fn setup(setup: &mut Setup) -> Result<(), String>`.
/// It exports the current [`PluginApi`], with the crate's version as its [`Metadata`]. It requires a 1.4 host, which
/// sends the render requests [`Setup`] answers.
#[macro_export]
macro_rules! export_plugin {
    ($id:expr, $setup:path) => {
        $crate::export_plugin!(@version $crate::ABI_MAJOR, $crate::ABI_MINOR, 4, $id, $setup);
    };
    // A plugin that pretends to be built against another version, for the loader's tests.
    (@version $major:expr, $minor:expr, $requires:expr, $id:expr, $setup:path) => {
        #[unsafe(no_mangle)]
        pub extern "C" fn opencode_plugin_v1() -> *const $crate::PluginApi {
            $crate::export_plugin!(@create $id, $setup);
            unsafe extern "C" fn describe(out: *mut $crate::Owned) -> i32 {
                unsafe { $crate::runtime::describe($id, env!("CARGO_PKG_VERSION"), out) }
            }
            static API: $crate::PluginApi = $crate::PluginApi {
                size: ::std::mem::size_of::<$crate::PluginApi>(),
                major: $major,
                minor: $minor,
                requires_minor: $requires,
                create: Some(create),
                call: Some($crate::runtime::call),
                destroy: Some($crate::runtime::destroy),
                free: Some($crate::runtime::free),
                describe: Some(describe),
            };
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
    // The `create` of `$setup`, for tests that wire a plugin through the byte shims (`loader::native::loopback`).
    (@loopback $id:expr, $setup:expr) => {{
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
            unsafe { $crate::runtime::describe($id, env!("CARGO_PKG_VERSION"), out) }
        }
        ($crate::export_plugin!(@loopback $id, $setup), describe)
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
        let options = unsafe { options.as_slice() };
        guard(out, || {
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
    pub unsafe fn describe(id: &str, version: &str, out: *mut Owned) -> i32 {
        guard(out, || {
            let metadata = Metadata { version: Some(version.to_owned()), id: Some(id.to_owned()) };
            serde_json::to_vec(&metadata).map_err(|error| error.to_string())
        })
    }

    /// # Safety
    /// `instance` must come from [`create`] and not be destroyed, or be null.
    pub unsafe extern "C" fn call(instance: *mut c_void, request: Bytes, out: *mut Owned) -> i32 {
        // SAFETY: as documented.
        let (registered, request) = unsafe { (instance.cast::<Registered>().as_ref(), request.as_slice()) };
        guard(out, || {
            let registered = registered.ok_or("no instance")?;
            let request: Request = serde_json::from_slice(request).map_err(|error| error.to_string())?;
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
    /// `owned` must come from this library.
    pub unsafe extern "C" fn free(owned: Owned) {
        // SAFETY: as documented.
        drop(unsafe { owned.into_vec() });
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
        };
        assert_eq!(HostHandle { api: &current }.mode(), Some(ThemeMode::Light));
        let null = HostApi { theme_mode: None, ..current };
        assert_eq!(HostHandle { api: &null }.mode(), None);
        let old = HostApiV1_1 { size: size_of::<HostApiV1_1>(), major: 1, minor: 1, ctx, call, free };
        assert_eq!(HostHandle { api: std::ptr::from_ref(&old).cast() }.mode(), None);
    }

    unsafe extern "C" fn answer(ctx: *mut c_void, _: Bytes, out: *mut Owned) -> i32 {
        // SAFETY: the test passes a live counter.
        unsafe { &*ctx.cast::<std::sync::atomic::AtomicUsize>() }.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        unsafe { *out = Owned::EMPTY };
        OK
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
        };
        let host = HostHandle { api: &api };
        assert_eq!(host.request(&HostRequest::Route), Err("no host".to_owned()));
        assert_eq!((host.mode(), host.waker().is_none()), (None, true));
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 0);
        let bytes = [0u64; 16];
        let misaligned = HostHandle { api: bytes.as_ptr().cast::<u8>().wrapping_add(1).cast() };
        assert_eq!(misaligned.request(&HostRequest::Route), Err("no host".to_owned()));
        let full = HostHandle { api: &HostApi { size: size_of::<HostApi>(), ..api } };
        assert!(full.request(&HostRequest::Route).is_err_and(|error| error.contains("EOF")));
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
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
        };
        let waker = HostHandle { api: &api }.waker().unwrap();
        std::thread::spawn(move || waker.wake()).join().unwrap();
        assert_eq!(wakes.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert!(HostHandle { api: &HostApi { wake: None, ..api } }.waker().is_none());
        let old = HostApiV1_2 { size: size_of::<HostApiV1_2>(), major: 1, minor: 2, ctx, call, free, theme_mode: None };
        assert!(HostHandle { api: std::ptr::from_ref(&old).cast() }.waker().is_none());
    }

    // Expected: a C host that passes no table, or leaves `call` or `free` null, gets errors, not a jump to address 0.
    #[test]
    fn a_null_host_or_host_callback_is_an_error() {
        let set = HostRequest::StorageSet { key: "count".into(), value: "{}".into() };
        let host = HostHandle { api: std::ptr::null() };
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
        };
        assert_eq!(HostHandle { api: &api }.request(&set), Err("the host takes no requests".to_owned()));
        let api = HostApi { call: Some(call), ..api };
        assert_eq!(HostHandle { api: &api }.request(&set), Err("the host takes no requests".to_owned()));
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
        let old = SlotClaim { kind: SlotKind::Append, path: "home.footer".into(), render: false, mount: false };
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
        };
        let requests = [
            HostRequest::Fetch(fetch),
            HostRequest::Navigate { route: Route::Session { id: "ses_1".into() } },
            HostRequest::Dialog { dialog: Dialog::Panel(panel) },
            HostRequest::Dialog { dialog: Dialog::Prompt { title: "p".into(), placeholder: None, action } },
            HostRequest::Copy { text: "x".into(), then: None },
            HostRequest::Dialog { dialog: Dialog::Close { key: "k".into() } },
            HostRequest::Interactive,
            HostRequest::Shortcut { name: "agent.cycle".into() },
            HostRequest::DialogOpen { key: "k".into() },
            HostRequest::Dialog {
                dialog: Dialog::Select(Select {
                    title: "s".into(),
                    placeholder: None,
                    options: vec![SelectOption::new("A", "a").description("d"), SelectOption::new("B", "b")],
                    current: Some("b".into()),
                    action: Action::Command { name: "x.pick".into(), input: None },
                }),
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
            };
            HostHandle { api: &api }.storage_merge("view", fields.clone());
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
                }))
                .unwrap(),
            ),
            (
                r#"{"type":"alert","title":"T","message":"M","action":{"type":"command","name":"x.a"}}"#,
                serde_json::to_value(Dialog::Alert(Alert {
                    title: "T".into(),
                    message: "M".into(),
                    action: Some(Action::Command { name: "x.a".into(), input: None }),
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
        };
        let host = HostHandle { api: &api };
        assert_eq!(host.composer(), None);
        host.edit_composer(ComposerEdit::Submit);
        let action = Action::Command { name: "x.a".into(), input: None };
        let confirm =
            Confirm { title: "T".into(), message: "M".into(), label: ConfirmLabel::default(), action: action.clone() };
        host.dialog(Dialog::Confirm(confirm));
        host.dialog(Dialog::Alert(Alert { title: "T".into(), message: "M".into(), action: None }));
        assert_eq!(known.load(std::sync::atomic::Ordering::SeqCst), 0);
        host.dialog(Dialog::Prompt { title: "T".into(), placeholder: None, action });
        host.toast(Toast::new(Variant::Info, "a"));
        assert_eq!(known.load(std::sync::atomic::Ordering::SeqCst), 2);
    }
}
