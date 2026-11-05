//! The native backend (decision O-42): plugins are shared libraries on the C ABI of `opencode-plugin-abi`,
//! loaded with `libloading`. There is no sandbox; it is the user's machine. The host only keeps a plugin's
//! panics out of the TUI:
//!
//! - the plugin's shims catch its panics, and the host's callbacks catch the host's, so no panic unwinds across
//!   the boundary (a crash such as a segfault still takes the process down);
//! - a panic fails the plugin: it is not called again, its fences fall back to the code view, its slots and routes
//!   draw empty, the plugin manager lists it as `failed` with the message, and a toast says so. Enabling it again
//!   in the plugin manager starts a fresh instance;
//! - host effects (toasts, routes) wait until the plugin returns, so it never reenters itself through the host.
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
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use opencode_plugin_abi::{
    self as abi, ABI_MAJOR, ABI_MINOR, Bytes, HostApi, HostRequest, Line, Manifest, Owned,
    PluginApi, PluginApiV1_0, Request,
};
use opencode_ui::keymap::{Bind, GLOBAL_MODE, KeymapLayer, Slash, TuiCommand};
use opencode_ui::theme::Theme;
use opentui::prelude::*;
use opentui::style::Color;
use serde::de::DeserializeOwned;

use super::Backend;
use crate::{Definition, ErrorFn, Host, Kind, Placement, Setup, Toast};

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
        let library = Library::open(library)?;
        Ok(Inspected {
            major: ABI_MAJOR,
            minor: library.minor,
            version: library.version(),
        })
    }
}

impl<H: Host> Backend<H> for Native {
    fn load(
        &self,
        library: &[u8],
        options: Option<&str>,
    ) -> Result<(Definition<H>, ErrorFn), String> {
        let library = Rc::new(Library::open(library)?);
        if let Some(version) = library.version() {
            log::info!("plugin library version {version}, ABI {ABI_MAJOR}.{}", library.minor);
        }
        let options = options.map(str::to_owned);
        // Setup runs once now, to check the build and learn its ID; the first activation takes this instance.
        let first = Instance::<H>::create(&library, Weak::new(), options.as_deref())?;
        let id = first.1.id.clone();
        let failure: Rc<RefCell<Option<String>>> = Rc::default();
        let prepared = RefCell::new(Some(first));
        let definition = Definition::new(id, {
            let failure = failure.clone();
            move |setup: &mut Setup<'_, H>| {
                let host = Rc::downgrade(setup.host());
                let instance = match prepared.borrow_mut().take() {
                    Some(first) => {
                        first.0.ctx.borrow_mut().host = host.clone();
                        Ok(first)
                    }
                    None => Instance::create(&library, host.clone(), options.as_deref()),
                };
                let (instance, manifest) = match instance {
                    Ok(instance) => instance,
                    Err(error) => {
                        log::error!("plugin {} failed: {error}", setup.id());
                        *failure.borrow_mut() = Some(error);
                        return;
                    }
                };
                *failure.borrow_mut() = None;
                let guest = Rc::new(Guest {
                    instance,
                    busy: Cell::new(false),
                    failure: failure.clone(),
                    host,
                    id: setup.id().to_owned(),
                });
                register(setup, &guest, &manifest);
            }
        });
        let error: ErrorFn = Rc::new(move || failure.borrow().clone());
        Ok((definition, error))
    }
}

/// An open library's entries. The library stays loaded for the life of the process.
struct Library {
    minor: u32,
    create: unsafe extern "C" fn(*const HostApi, Bytes, *mut *mut c_void, *mut Owned) -> i32,
    call: unsafe extern "C" fn(*mut c_void, Bytes, *mut Owned) -> i32,
    destroy: unsafe extern "C" fn(*mut c_void),
    free: unsafe extern "C" fn(Owned),
    describe: Option<unsafe extern "C" fn(*mut Owned) -> i32>,
}

impl Library {
    fn open(bytes: &[u8]) -> Result<Self, String> {
        static OPENED: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!("opencode-rs-plugins-{}", std::process::id()));
        std::fs::create_dir_all(&dir).map_err(|error| format!("{}: {error}", dir.display()))?;
        let file = dir.join(format!(
            "{}.{}",
            OPENED.fetch_add(1, Ordering::Relaxed),
            std::env::consts::DLL_EXTENSION
        ));
        std::fs::write(&file, bytes).map_err(|error| format!("{}: {error}", file.display()))?;
        // SAFETY: loading runs the library's initializers; a plugin is code the user chose to run.
        let library = unsafe { libloading::Library::new(&file) };
        // The mapping stays after the file is gone (where the platform allows removing it).
        let _ = std::fs::remove_file(&file);
        let library = library.map_err(|error| format!("cannot load the library: {error}"))?;
        // SAFETY: `ENTRY` has type `EntryFn` in every plugin of this major version.
        let entry = unsafe { library.get::<abi::EntryFn>(abi::ENTRY.as_bytes()) }
            .map_err(|_| format!("not an opencode-rs plugin: no `{}` symbol", abi::ENTRY))?;
        // SAFETY: as above; the table it returns lives as long as the library.
        let api = unsafe { entry() };
        if api.is_null() {
            return Err(format!("`{}` returned no table", abi::ENTRY));
        }
        // SAFETY: every table of any version starts with `size`, `major`, and `minor`.
        let (size, major, minor) = unsafe {
            (
                std::ptr::addr_of!((*api).size).read(),
                std::ptr::addr_of!((*api).major).read(),
                std::ptr::addr_of!((*api).minor).read(),
            )
        };
        if major != ABI_MAJOR {
            return Err(format!(
                "plugin ABI {major}.{minor} is not supported: this opencode-rs loads ABI {ABI_MAJOR}.x plugins \
                 (up to {ABI_MAJOR}.{HOST_MINOR}); rebuild the plugin against opencode-plugin-abi {ABI_MAJOR}"
            ));
        }
        if size < size_of::<PluginApiV1_0>() {
            return Err(format!("plugin table is {size} bytes, shorter than the ABI {ABI_MAJOR}.0 core"));
        }
        // SAFETY: the 1.0 core is within `size`.
        let core = unsafe { &*api.cast::<PluginApiV1_0>() };
        if core.requires_minor > HOST_MINOR {
            return Err(format!(
                "plugin needs host ABI {ABI_MAJOR}.{} or newer, this opencode-rs has {ABI_MAJOR}.{HOST_MINOR}; \
                 update opencode-rs",
                core.requires_minor
            ));
        }
        let describe = has::<Option<unsafe extern "C" fn(*mut Owned) -> i32>>(
            size,
            offset_of!(PluginApi, describe),
        )
        // SAFETY: `size` covers the entry.
        .then(|| unsafe { std::ptr::addr_of!((*api).describe).read() })
        .flatten();
        let opened = Self {
            minor,
            create: core.create,
            call: core.call,
            destroy: core.destroy,
            free: core.free,
            describe,
        };
        std::mem::forget(library);
        Ok(opened)
    }

    /// The plugin's version, when it has `describe` (1.1).
    fn version(&self) -> Option<String> {
        let describe = self.describe?;
        let mut out = Owned::EMPTY;
        // SAFETY: `describe` writes `out`, which `free` takes back.
        let (status, bytes) = unsafe {
            let status = describe(&mut out);
            let bytes = out.to_vec();
            (self.free)(out);
            (status, bytes)
        };
        (status == abi::OK)
            .then(|| serde_json::from_slice::<abi::Metadata>(&bytes).ok())
            .flatten()
            .and_then(|metadata| metadata.version)
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
    ctx: Box<RefCell<Ctx<H>>>,
}

impl<H: Host> Instance<H> {
    fn create(
        library: &Rc<Library>,
        host: Weak<H>,
        options: Option<&str>,
    ) -> Result<(Self, Manifest), String> {
        let ctx = Box::new(RefCell::new(Ctx {
            host,
            id: String::new(),
            keys: Vec::new(),
            effects: Vec::new(),
        }));
        let api = Box::new(HostApi {
            size: size_of::<HostApi>(),
            major: ABI_MAJOR,
            minor: HOST_MINOR,
            ctx: std::ptr::from_ref::<RefCell<Ctx<H>>>(&ctx).cast_mut().cast(),
            call: host_call::<H>,
            free: host_free,
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
        let instance = Self {
            library: library.clone(),
            handle,
            _api: api,
            ctx,
        };
        let manifest: Manifest = serde_json::from_slice(&bytes)
            .map_err(|error| format!("setup returned a bad manifest: {error}"))?;
        if manifest.id.is_empty() {
            return Err("setup returned an empty plugin ID".to_owned());
        }
        {
            let mut ctx = instance.ctx.borrow_mut();
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
                log::warn!("plugin {}: {text}", self.ctx.borrow().id);
                Err(None)
            }
        }
    }
}

impl<H: Host> Drop for Instance<H> {
    fn drop(&mut self) {
        // SAFETY: `handle` came from `create` and is destroyed once; the plugin catches its own panics.
        unsafe { (self.library.destroy)(self.handle) };
    }
}

/// The host's side of [`HostApi::call`]. Catches the host's panics.
unsafe extern "C" fn host_call<H: Host>(ctx: *mut c_void, request: Bytes, out: *mut Owned) -> i32 {
    // SAFETY: `ctx` is the `RefCell<Ctx<H>>` this instance was created with; `request` is valid for the call.
    let (ctx, request) = unsafe { (&*ctx.cast::<RefCell<Ctx<H>>>(), request.as_slice()) };
    let result = catch_unwind(AssertUnwindSafe(|| {
        let request: HostRequest = serde_json::from_slice(request).map_err(|error| {
            format!("unsupported host request (host ABI {ABI_MAJOR}.{HOST_MINOR}): {error}")
        })?;
        let mut ctx = ctx
            .try_borrow_mut()
            .map_err(|_| "the host is busy".to_owned())?;
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

unsafe extern "C" fn host_free(owned: Owned) {
    // SAFETY: the host made `owned` with `Owned::from_vec`.
    drop(unsafe { owned.into_vec() });
}

fn handle<H: Host>(ctx: &mut Ctx<H>, request: HostRequest) -> Result<serde_json::Value, String> {
    let key = |ctx: &Ctx<H>, key: &str| {
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
        let effects = std::mem::take(&mut self.instance.ctx.borrow_mut().effects);
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
        self.defer(move |host| {
            host.toast(
                Toast::Error,
                Some(&format!("Plugin failed: {id}")),
                "Run /plugins to view details.",
            );
        });
        None
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
                let request = Request::Command {
                    name: name.clone(),
                    input: input.map(str::to_owned),
                };
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
                entry = entry.slash(Slash {
                    name: slash.clone(),
                    aliases: Vec::new(),
                    arguments: false,
                });
            }
            entry
        })
        .collect();
    if !commands.is_empty() {
        setup.layer(KeymapLayer {
            mode: Some(GLOBAL_MODE.to_owned()),
            commands,
            ..KeymapLayer::default()
        });
    }
    for language in &manifest.fences {
        let guest = guest.clone();
        setup.code_block(language.clone(), move |block, theme| {
            let request = Request::Fence(abi::Fence {
                language: block.language.to_owned(),
                info: block.info.to_owned(),
                code: block.code.to_owned(),
                streaming: block.streaming && !block.closed,
            });
            let lines = guest
                .request::<Option<Vec<Line>>>("render-fence", &request)
                .flatten()?;
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
            let request = Request::Slot {
                claim,
                session_id: input.session_id.clone(),
            };
            let lines = guest
                .request::<Vec<Line>>("render-slot", &request)
                .unwrap_or_default();
            Box::new(lines_view(host.app(), &host.theme(), &lines))
        });
    }
    for name in &manifest.routes {
        let guest = guest.clone();
        let request = Request::Route { name: name.clone() };
        setup.route(name.clone(), move |host| {
            let lines = guest
                .request::<Vec<Line>>("render-route", &request)
                .unwrap_or_default();
            Box::new(lines_view(host.app(), &host.theme(), &lines))
        });
    }
}

/// Rows of spans as one no-wrap text. A fence scrolls sideways, as the LaTeX and Mermaid renderers do.
fn lines_widget(app: &App, theme: &Theme, lines: &[Line], scroll: bool) -> AnyWidget {
    let width = lines
        .iter()
        .map(|line| {
            line.iter()
                .map(|span| unicode_width::UnicodeWidthStr::width(span.text.as_str()))
                .sum::<usize>()
        })
        .max()
        .unwrap_or(0);
    let height = lines.len().max(1) as f32;
    let mut spans: Vec<Span<'static>> = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        if index > 0 {
            spans.push(Span::styled("\n", Style::new().fg(theme.text.base)));
        }
        spans.extend(line.iter().map(|span| {
            let mut attributes = Attributes::NONE;
            for (set, attribute) in [
                (span.bold, Attributes::BOLD),
                (span.italic, Attributes::ITALIC),
                (span.underline, Attributes::UNDERLINE),
                (span.dim, Attributes::DIM),
            ] {
                if set {
                    attributes |= attribute;
                }
            }
            let fg = color(theme, span.fg.as_deref()).unwrap_or(theme.text.base);
            let mut style = Style::new().fg(fg);
            if let Some(bg) = color(theme, span.bg.as_deref()) {
                style = style.bg(bg);
            }
            Span::styled(span.text.clone(), Style { attributes, ..style })
        }));
    }
    let text = Text::new(app, spans)
        .width(Length::percent(100.0))
        .min_width(width as f32)
        .height(height)
        .wrap(WrapMode::None)
        .selectable(false)
        .shrink(0.0);
    if !scroll {
        return text.as_any();
    }
    ScrollBox::new(app)
        .width(Length::percent(100.0))
        .height(height)
        .shrink(0.0)
        .axes(true, false)
        .scrollbars(false)
        .child(&text)
        .as_any()
}

/// A slot claim or route: the rows in a view, empty when the plugin drew nothing or failed.
fn lines_view(app: &App, theme: &Theme, lines: &[Line]) -> View {
    let view = View::new(app).shrink(0.0);
    if !lines.is_empty() {
        view.add(&lines_widget(app, theme, lines, false));
    }
    view
}

/// A theme token path, or `#rrggbb`.
fn color(theme: &Theme, value: Option<&str>) -> Option<Color> {
    let value = value?;
    if let Some(hex) = value.strip_prefix('#').filter(|hex| hex.len() == 6) {
        let channel = |index: usize| u8::from_str_radix(&hex[index..index + 2], 16).ok();
        return Some(Color::rgb(channel(0)?, channel(2)?, channel(4)?));
    }
    theme.get(value).copied()
}

#[cfg(test)]
mod tests;
