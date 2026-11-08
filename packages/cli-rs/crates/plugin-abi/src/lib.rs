//! The C ABI of native opencode-rs TUI plugins (P.4, `docs/P.4.md`, decision O-42).
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
//! routes, and storage keys. Renderers return styled rows ([`Line`]); the host turns them into widgets. Panics are
//! caught at every boundary and reported to the host, which shows them in its plugin manager; the plugin's own
//! panic hook is silenced so nothing prints over the TUI. Keep the default `panic = "unwind"`. Other languages
//! implement the same structs and JSON by hand.

#![allow(unsafe_code)]

use std::ffi::c_void;
use std::panic::{AssertUnwindSafe, catch_unwind};

use serde::{Deserialize, Serialize};

/// The major version: changes only with a deliberate breaking change, and a mismatch refuses the plugin.
pub const ABI_MAJOR: u32 = 1;
/// The minor version: grows when entries are appended. 1.0 is the core; 1.1 adds [`PluginApi::describe`]; 1.2 adds
/// [`HostApi::theme_mode`]; 1.3 adds [`HostApi::wake`].
pub const ABI_MINOR: u32 = 3;

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
    /// so a plugin stops and joins every thread that may call it before `destroy` returns. A plugin reads it as
    /// [`Host::waker`].
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

/// Dark or light, from [`Host::theme_mode`].
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
}

/// Styled text. A color is a theme token path (`text.muted`, `markdown.heading`) or `#rrggbb`; an unknown token
/// draws in `text.base`.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Span {
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fg: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bg: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub bold: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub italic: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub underline: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub dim: bool,
}

impl Span {
    pub fn new(text: impl Into<String>) -> Self {
        Self { text: text.into(), ..Self::default() }
    }

    pub fn fg(mut self, color: impl Into<String>) -> Self {
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

/// A fenced Markdown code block.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Fence {
    pub language: String,
    pub info: String,
    pub code: String,
    /// The message is still streaming and the fence has not closed.
    pub streaming: bool,
}

/// From the host to the plugin. Results: `Fence` → `Option<Vec<Line>>`, `Slot` and `Route` → `Vec<Line>`,
/// `Command` → `null`.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum Request {
    Fence(Fence),
    Slot { claim: usize, session_id: Option<String> },
    Route { name: String },
    Command { name: String, input: Option<String> },
}

/// From the plugin to the host. Results: `StorageGet` → `Option<String>` (JSON text), everything else `null`.
/// A host that does not know a request answers it with an error.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum HostRequest {
    Log {
        level: Level,
        message: String,
    },
    Toast {
        variant: Toast,
        message: String,
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
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Level {
    Debug,
    Info,
    Warn,
    Error,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Toast {
    Info,
    Success,
    Warning,
    Error,
}

/// The host, as a plugin calls it. Valid while the instance lives.
#[derive(Clone, Copy)]
pub struct Host {
    api: *const HostApi,
}

impl Host {
    fn request(&self, request: &HostRequest) -> Result<serde_json::Value, String> {
        let json = serde_json::to_vec(request).map_err(|error| error.to_string())?;
        let mut out = Owned::EMPTY;
        // SAFETY: the host keeps `api` alive until it destroys the instance this handle belongs to.
        let api = unsafe { self.api.as_ref() }.ok_or("no host")?;
        let (Some(call), Some(free)) = (api.call, api.free) else {
            return Err("the host takes no requests".to_owned());
        };
        // SAFETY: `call` writes `out`, which `free` takes back.
        let (status, bytes) = unsafe {
            let status = call(api.ctx, Bytes::new(&json), &mut out);
            let bytes = out.to_vec();
            free(out);
            (status, bytes)
        };
        match status {
            OK => serde_json::from_slice(&bytes).map_err(|error| error.to_string()),
            _ => Err(String::from_utf8_lossy(&bytes).into_owned()),
        }
    }

    /// The JSON text stored under one of the plugin's storage keys.
    pub fn storage_get(&self, key: &str) -> Option<String> {
        let value = self.request(&HostRequest::StorageGet { key: key.to_owned() }).ok()?;
        serde_json::from_value(value).ok().flatten()
    }

    /// Stores JSON text (an object or an array) under one of the plugin's storage keys.
    pub fn storage_set(&self, key: &str, value: &str) -> Result<(), String> {
        self.request(&HostRequest::StorageSet { key: key.to_owned(), value: value.to_owned() }).map(drop)
    }

    /// Shows a toast once the current call returns.
    pub fn toast(&self, variant: Toast, message: &str) {
        let _ = self.request(&HostRequest::Toast { variant, message: message.to_owned() });
    }

    /// Opens one of the plugin's routes once the current call returns.
    pub fn open_route(&self, name: &str) {
        let _ = self.request(&HostRequest::OpenRoute { name: name.to_owned() });
    }

    pub fn log(&self, level: Level, message: &str) {
        let _ = self.request(&HostRequest::Log { level, message: message.to_owned() });
    }

    /// Whether the page theme is dark or light; `None` from a host older than 1.2.
    pub fn theme_mode(&self) -> Option<ThemeMode> {
        // SAFETY: the host keeps `api` alive until it destroys the instance; `size` says which entries it has.
        let mode = unsafe {
            let api = self.api.as_ref()?;
            let end = std::mem::offset_of!(HostApi, theme_mode) + size_of::<Option<unsafe extern "C" fn()>>();
            if api.size < end {
                return None;
            }
            (api.theme_mode?)(api.ctx)
        };
        match mode {
            THEME_DARK => Some(ThemeMode::Dark),
            THEME_LIGHT => Some(ThemeMode::Light),
            _ => None,
        }
    }

    /// A handle that wakes the host from any thread; `None` from a host older than 1.3.
    pub fn waker(&self) -> Option<Waker> {
        // SAFETY: the host keeps `api` alive until it destroys the instance; `size` says which entries it has.
        let api = unsafe { self.api.as_ref()? };
        let end = std::mem::offset_of!(HostApi, wake) + size_of::<Option<unsafe extern "C" fn()>>();
        (api.size >= end && api.wake.is_some()).then_some(Waker { api: self.api })
    }
}

/// Wakes the host from any thread (ABI 1.3), from [`Host::waker`]: the host then asks the plugin's mounted slot
/// claims and routes for their rows again, so a plugin that works on its own thread can show the result.
///
/// A wake is a redraw hint, not a message: it delivers nothing and drains nothing. Many wakes may become one redraw,
/// so the rows the host asks for must show every result that is ready, not one per wake. The host never loses the
/// last wake, even when its queue is full.
///
/// The host table a `Waker` points to is valid only until `destroy` returns. A thread that holds one must stop
/// before then: stop and join it when the instance's state drops, as the sample plugin's `Ticker` does. A detached
/// task that may still run, such as a cancelled async task, is not enough.
#[derive(Clone, Copy)]
pub struct Waker {
    api: *const HostApi,
}

// SAFETY: a 1.3 host's `wake` may be called from any thread, and the table does not change while the instance lives.
unsafe impl Send for Waker {}
unsafe impl Sync for Waker {}

impl Waker {
    pub fn wake(&self) {
        // SAFETY: `waker` checked that the table has a `wake`; the table outlives the instance's threads.
        unsafe {
            let api = &*self.api;
            if let Some(wake) = api.wake {
                wake(api.ctx);
            }
        }
    }
}

type FenceFn = Box<dyn Fn(&Fence) -> Option<Vec<Line>>>;
type SlotFn = Box<dyn Fn(Option<&str>) -> Vec<Line>>;
type RouteFn = Box<dyn Fn() -> Vec<Line>>;
type CommandFn = Box<dyn Fn(Option<&str>)>;

/// What a plugin registers (the C-ABI form of P.1's `Setup`). The instance keeps it until the host destroys it.
pub struct Setup {
    manifest: Manifest,
    options: Option<String>,
    host: Host,
    fences: Vec<(String, FenceFn)>,
    slots: Vec<SlotFn>,
    routes: Vec<(String, RouteFn)>,
    commands: Vec<(String, CommandFn)>,
}

impl Setup {
    pub fn id(&self) -> &str {
        &self.manifest.id
    }

    /// The `options` of the plugin's `plugins` entry, as JSON text.
    pub fn options(&self) -> Option<&str> {
        self.options.as_deref()
    }

    /// The host, for renderers and commands to keep.
    pub fn host(&self) -> Host {
        self.host
    }

    /// Declares storage key `key`; [`Host::storage_get`] and [`Host::storage_set`] accept declared keys only.
    pub fn storage_key(&mut self, key: &str) {
        let _ = self.host.request(&HostRequest::StorageKey { key: key.to_owned() });
        self.manifest.storage.push(key.to_owned());
    }

    /// Registers a command; `run` receives the slash command's text after its name.
    pub fn command(&mut self, command: Command, run: impl Fn(Option<&str>) + 'static) {
        self.commands.push((command.name.clone(), Box::new(run)));
        self.manifest.commands.push(command);
    }

    /// Renders Markdown fences of `language`; `None` keeps the plain code view.
    pub fn code_block(&mut self, language: &str, render: impl Fn(&Fence) -> Option<Vec<Line>> + 'static) {
        self.manifest.fences.push(language.to_owned());
        self.fences.push((language.to_owned(), Box::new(render)));
    }

    /// Claims a place in the slot tree; `render` receives the slot's session ID, if it has one.
    pub fn slot(&mut self, kind: SlotKind, path: &str, render: impl Fn(Option<&str>) -> Vec<Line> + 'static) {
        self.manifest.slots.push(SlotClaim { kind, path: path.to_owned() });
        self.slots.push(Box::new(render));
    }

    /// Registers a route the host opens as `plugin/<id>/<name>`.
    pub fn route(&mut self, name: &str, render: impl Fn() -> Vec<Line> + 'static) {
        self.manifest.routes.push(name.to_owned());
        self.routes.push((name.to_owned(), Box::new(render)));
    }

    fn handle(&self, request: Request) -> Result<serde_json::Value, String> {
        let json = |value: Result<serde_json::Value, serde_json::Error>| value.map_err(|error| error.to_string());
        match request {
            Request::Fence(fence) => {
                let render =
                    self.fences.iter().find(|(language, _)| *language == fence.language).map(|(_, render)| render);
                json(serde_json::to_value(render.and_then(|render| render(&fence))))
            }
            Request::Slot { claim, session_id } => {
                let render = self.slots.get(claim).ok_or("no such slot claim")?;
                json(serde_json::to_value(render(session_id.as_deref())))
            }
            Request::Route { name } => {
                let (_, render) = self.routes.iter().find(|(route, _)| *route == name).ok_or("no such route")?;
                json(serde_json::to_value(render()))
            }
            Request::Command { name, input } => {
                let (_, run) = self.commands.iter().find(|(command, _)| *command == name).ok_or("no such command")?;
                run(input.as_deref());
                Ok(serde_json::Value::Null)
            }
        }
    }
}

/// Exports a plugin: `export_plugin!("my.plugin", setup)` with `fn setup(setup: &mut Setup) -> Result<(), String>`.
/// It exports the current [`PluginApi`], with the crate's version as its [`Metadata`].
#[macro_export]
macro_rules! export_plugin {
    ($id:expr, $setup:path) => {
        $crate::export_plugin!(@version $crate::ABI_MAJOR, $crate::ABI_MINOR, 0, $id, $setup);
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
}

/// The shims [`export_plugin!`] wires into [`PluginApi`]. Each catches panics, so none unwinds into the host.
#[doc(hidden)]
pub mod runtime {
    use super::*;

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
        // A plugin has its own copy of std and so its own panic hook. The default one prints to stderr, over the
        // TUI; the host shows the caught message instead.
        static QUIET: std::sync::Once = std::sync::Once::new();
        QUIET.call_once(|| std::panic::set_hook(Box::new(|_| {})));
        // SAFETY: the host passes valid pointers for the length of the call.
        let options = unsafe { options.as_slice() };
        guard(out, || {
            let options = (!options.is_empty()).then(|| String::from_utf8_lossy(options).into_owned());
            let mut registered = Setup {
                manifest: Manifest { id: id.to_owned(), ..Manifest::default() },
                options,
                host: Host { api: host },
                fences: Vec::new(),
                slots: Vec::new(),
                routes: Vec::new(),
                commands: Vec::new(),
            };
            if instance.is_null() {
                return Err("no instance pointer".to_owned());
            }
            setup(&mut registered)?;
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
        let (setup, request) = unsafe { (instance.cast::<Setup>().as_ref(), request.as_slice()) };
        guard(out, || {
            let setup = setup.ok_or("no instance")?;
            let request: Request = serde_json::from_slice(request).map_err(|error| error.to_string())?;
            let value = setup.handle(request)?;
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
        let setup = unsafe { Box::from_raw(instance.cast::<Setup>()) };
        let _ = catch_unwind(AssertUnwindSafe(move || drop(setup)));
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
        assert_eq!(Host { api: &current }.theme_mode(), Some(ThemeMode::Light));
        let null = HostApi { theme_mode: None, ..current };
        assert_eq!(Host { api: &null }.theme_mode(), None);
        let old = HostApiV1_1 { size: size_of::<HostApiV1_1>(), major: 1, minor: 1, ctx, call, free };
        assert_eq!(Host { api: std::ptr::from_ref(&old).cast() }.theme_mode(), None);
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
        let waker = Host { api: &api }.waker().unwrap();
        std::thread::spawn(move || waker.wake()).join().unwrap();
        assert_eq!(wakes.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert!(Host { api: &HostApi { wake: None, ..api } }.waker().is_none());
        let old = HostApiV1_2 { size: size_of::<HostApiV1_2>(), major: 1, minor: 2, ctx, call, free, theme_mode: None };
        assert!(Host { api: std::ptr::from_ref(&old).cast() }.waker().is_none());
    }

    // Expected: a C host that passes no table, or leaves `call` or `free` null, gets errors, not a jump to address 0.
    #[test]
    fn a_null_host_or_host_callback_is_an_error() {
        let host = Host { api: std::ptr::null() };
        assert_eq!(host.storage_get("count"), None);
        assert_eq!(host.storage_set("count", "{}"), Err("no host".to_owned()));
        assert_eq!(host.theme_mode(), None);
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
        assert_eq!(Host { api: &api }.storage_set("count", "{}"), Err("the host takes no requests".to_owned()));
        let api = HostApi { call: Some(call), ..api };
        assert_eq!(Host { api: &api }.storage_set("count", "{}"), Err("the host takes no requests".to_owned()));
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
}
