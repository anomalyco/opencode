//! The host's side of what a plugin asks for in a [`HostRequest`], and the effects and replies it leads to: one plugin's
//! calls, outside any carrier. The C ABI's carrier ([`super::native`]) and the pipe each hand their plugins' requests
//! here.

// A build with neither the C ABI nor the JS host has no plugin that sends requests: only the replies and the cancels of
// the linked plugins' fetches are used.
#![cfg_attr(not(any(native, feature = "ts")), allow(dead_code))]

use std::cell::RefCell;
use std::rc::{Rc, Weak};

use opencode_plugin_abi::{self as abi, HostRequest, Manifest, Request, v2};

use crate::activation::Activation;
use crate::node::theme_color;
use crate::{Host, Undo, behave, defer, next_request};

/// What the host's callbacks see: the plugin's identity, its storage keys, and what the running call asked for:
/// effects that wait for it to return, and the storage it wrote, which a panic puts back.
pub(crate) struct Ctx {
    pub(crate) host: Weak<dyn Host>,
    pub(crate) id: String,
    pub(crate) keys: Vec<String>,
    pub(crate) effects: Vec<Effect>,
    pub(crate) undo: Undo,
    /// What the call's verbs staged for its later ones.
    pub(crate) staged: crate::Staged,
    /// What it asks for is dropped.
    pub(crate) quiet: bool,
    /// A render or a view runs: it may read, and ask for nothing.
    pub(crate) read_only: bool,
    /// What the calls hold of the input, from the end of setup: setup itself has no mount and no owner.
    pub(crate) owners: Option<Rc<crate::Owners>>,
}

#[cfg(test)]
thread_local! {
    /// The features a test's host tables state instead, as an older host's would: a library then lowers what that host
    /// lacks, and the host does what such a host does for a feature that changes its behavior ([`serves`]).
    pub(crate) static STATED: std::cell::Cell<Option<&'static [u8]>> = const { std::cell::Cell::new(None) };
}

/// Whether the host serves `feature`, which it states ([`HostApi::features`]): it does only what it states, as a host
/// that lacks the feature would not (`focus-input`'s focus of a field).
pub(crate) fn serves(feature: &str) -> bool {
    #[cfg(test)]
    if let Some(stated) = STATED.get() {
        return serde_json::from_slice::<Vec<String>>(stated)
            .is_ok_and(|stated| stated.iter().any(|name| name == feature));
    }
    abi::FEATURES.contains(&feature)
}

pub(crate) enum Effect {
    Toast(abi::Toast),
    Route(String),
    Dispatch(String, Option<String>),
    Attention(abi::Attention),
    /// A storage write, which the host already shows to reads, for the claims to hear of.
    Stored,
    Navigate(abi::Route),
    /// A fetch, with the mount that owns it ([`crate::Owners::owning`]).
    Fetch(abi::RequestId, abi::Fetch, Option<Weak<()>>),
    Dialog(Box<abi::Dialog>),
    Copy(String, Option<abi::Action>),
    Composer(abi::ComposerEdit),
    // The small verbs.
    Variant(Option<String>),
    Model(String, String),
    Tab(abi::TabEdit),
    ClearSelection,
    Foreground(abi::RequestId, abi::Foreground, Option<Weak<()>>),
    /// A timer, with the mount that owns it.
    Timer(abi::RequestId, std::time::Duration, Option<Weak<()>>),
    /// A timer let go of ([`abi::Host::cancel_timer`]).
    CancelTimer(abi::RequestId),
    Title(String),
    Theme(String),
    InstallTheme(String, serde_json::Value),

    Setting(String, serde_json::Value),
    // a scroll verb, bound to the mount it names when the plugin asked.
    Scroll(Box<dyn FnOnce()>),
    /// Capture the owner when the input verb is requested.
    Input(crate::Effect),
}

impl Ctx {
    /// The context of calls of plugin `id`, whose storage keys are `keys`, outside any instance: the pipe carrier's.
    #[cfg_attr(not(feature = "ts"), allow(dead_code))]
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

pub(crate) fn handle(ctx: &mut Ctx, request: HostRequest) -> Result<serde_json::Value, String> {
    // The host's names of a declared key, which no other plugin's key shares.
    let key = |ctx: &Ctx, key: &str| {
        if ctx.id.is_empty() {
            return Err("the plugin ID is not known during setup".to_owned());
        }
        if !ctx.keys.iter().any(|known| known == key) {
            return Err(format!("storage key {key} was not declared"));
        }
        crate::storage::name(&ctx.id, key)
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
            let value = ctx.host.upgrade().and_then(|host| crate::storage::read(&*host, &stored));
            return Ok(serde_json::to_value(value).unwrap_or_default());
        }
        HostRequest::StorageSet { key: name, value } => {
            let stored = key(ctx, &name)?;
            crate::storage::bounded(value.len())?;
            let host = ctx.host.upgrade().ok_or("the host is gone")?;
            ctx.undo.record(&*host, &stored.now);
            host.storage_write(&stored.now, &value)?;
            ctx.effects.push(Effect::Stored);
        }
        HostRequest::StorageMerge { key: name, fields } => {
            let stored = key(ctx, &name)?;
            let host = ctx.host.upgrade().ok_or("the host is gone")?;
            crate::storage::bounded_merge(&*host, &stored, &fields)?;
            ctx.undo.record(&*host, &stored.now);
            crate::storage::migrate(&*host, &stored)?;
            host.storage_merge(&stored.now, fields)?;
            ctx.effects.push(Effect::Stored);
        }
        HostRequest::OpenRoute { name } => ctx.effects.push(Effect::Route(name)),
        HostRequest::Color { token } => {
            let color = ctx.host.upgrade().and_then(|host| theme_color(&host.theme(), &token));
            return Ok(serde_json::to_value(color).unwrap_or_default());
        }
        HostRequest::StorageKey { key } => crate::storage::declare(&mut ctx.keys, &key)?,
        HostRequest::Session { id } => return read(ctx, &mut |read| serde_json::to_value(read.session(&id))),
        HostRequest::Family { id } => return read(ctx, &mut |read| serde_json::to_value(read.family(&id))),
        HostRequest::Sessions => return read(ctx, &mut |read| serde_json::to_value(read.sessions())),
        HostRequest::Pending { id } => return read(ctx, &mut |read| serde_json::to_value(read.pending(&id))),
        HostRequest::Messages { id } => {
            return read(ctx, &mut |read| {
                let mut value = Ok(serde_json::Value::Null);
                read.messages(&id, &mut |messages| value = serde_json::to_value(messages));
                value
            });
        }
        HostRequest::Message { session, message } => {
            return read(ctx, &mut |read| {
                let mut value = Ok(serde_json::Value::Null);
                read.message(&session, &message, &mut |found| value = serde_json::to_value(found));
                value
            });
        }
        HostRequest::Models { location } => {
            return read(ctx, &mut |read| serde_json::to_value(read.models(location.as_ref())));
        }
        HostRequest::Model => return read(ctx, &mut |read| serde_json::to_value(read.model())),
        HostRequest::Limits => return read(ctx, &mut |read| serde_json::to_value(read.limits())),
        HostRequest::Providers => return read(ctx, &mut |read| serde_json::to_value(read.providers())),
        HostRequest::Info => return read(ctx, &mut |read| serde_json::to_value(read.info())),
        HostRequest::Plugins => return read(ctx, &mut |read| serde_json::to_value(read.plugins())),
        HostRequest::Setting { name } => return read(ctx, &mut |read| serde_json::to_value(read.setting(&name))),
        HostRequest::ImageSize { bytes } => {
            // Bytes past what the host decodes show nothing, which their length says before they are decoded.
            if (bytes.len() / 4 * 3) as u64 > crate::limits::get().image_bytes + 2 {
                return Ok(serde_json::Value::Null);
            }
            let bytes = abi::base64::decode(&bytes).ok_or("image bytes that are not base64")?;
            return read(ctx, &mut |read| serde_json::to_value(read.image_size(&bytes)));
        }
        HostRequest::UtcOffset { at } => return read(ctx, &mut |read| serde_json::to_value(read.utc_offset(at))),
        // Past one node's text it is not measured: a plugin measures what it would draw.
        HostRequest::Measure { text } if text.len() as u64 > crate::limits::get().text => {
            return Err(format!("a text of {} bytes to measure, more than a node holds", text.len()));
        }
        HostRequest::Measure { text } => return read(ctx, &mut |read| serde_json::to_value(read.measure(&text))),
        HostRequest::ImageBounds => {
            let limits = crate::limits::get();
            return Ok(
                serde_json::to_value(abi::ImageBounds::new(limits.image_bytes, limits.image_side)).unwrap_or_default()
            );
        }
        HostRequest::SetSetting { name, value } => ctx.effects.push(Effect::Setting(name, value)),
        HostRequest::McpServers { location } => {
            return read(ctx, &mut |read| serde_json::to_value(read.mcp_servers(location.as_ref())));
        }
        HostRequest::Integrations { location } => {
            return read(ctx, &mut |read| serde_json::to_value(read.integrations(location.as_ref())));
        }
        HostRequest::Vcs { location } => {
            return read(ctx, &mut |read| serde_json::to_value(read.vcs(location.as_ref())));
        }
        HostRequest::Route => return read(ctx, &mut |read| serde_json::to_value(read.route())),
        HostRequest::Dispatch { name, input } => ctx.effects.push(Effect::Dispatch(name, input)),
        HostRequest::Attention(attention) => ctx.effects.push(Effect::Attention(attention)),
        HostRequest::Navigate { route } => ctx.effects.push(Effect::Navigate(route)),
        HostRequest::Fetch(fetch) => {
            // An ID is a promise of a reply: none is given unless the fetch's effect has room.
            if !crate::has_room(ctx.effects.len()) {
                return Err(crate::REFUSED.to_owned());
            }
            let id = next_request();
            ctx.effects.push(Effect::Fetch(id, fetch, owning(ctx)));
            return Ok(serde_json::to_value(id).unwrap_or_default());
        }
        HostRequest::Dialog { dialog } => ctx.effects.push(Effect::Dialog(dialog)),
        HostRequest::Copy { text, then } => ctx.effects.push(Effect::Copy(text, then)),
        HostRequest::Interactive => return read(ctx, &mut |read| serde_json::to_value(read.interactive())),
        HostRequest::Shortcut { name } => return read(ctx, &mut |read| serde_json::to_value(read.shortcut(&name))),
        HostRequest::DialogOpen { key } => {
            let open = ctx.host.upgrade().is_some_and(|host| host.dialog_open(&ctx.id, &key));
            return Ok(serde_json::Value::Bool(open));
        }
        HostRequest::Composer => return read(ctx, &mut |read| serde_json::to_value(read.composer())),
        HostRequest::ComposerEdit { edit } => ctx.effects.push(Effect::Composer(edit)),
        HostRequest::Checkpoint => return Ok(crate::mark(ctx.effects.len(), ctx.undo.len()).into()),
        HostRequest::Rollback { mark } => {
            let (effects, writes) = crate::marked(mark);
            ctx.effects.truncate(effects);
            let host = ctx.host.upgrade().ok_or("the host is gone")?;
            ctx.undo.restore_after(&*host, writes);
        }
        HostRequest::Variants => return read(ctx, &mut |read| serde_json::to_value(read.variants())),
        HostRequest::SetVariant { variant } => {
            let staged = &ctx.staged;
            let known =
                read(ctx, &mut |read| Ok(serde_json::Value::Bool(staged.variant_known(read, variant.as_deref()))))?;
            if known == serde_json::Value::Bool(true) {
                ctx.effects.push(Effect::Variant(variant));
            }
            return Ok(known);
        }
        HostRequest::SetModel { provider, model } => {
            let mut staged = std::mem::take(&mut ctx.staged);
            read(ctx, &mut |read| {
                staged.set_model(read, &provider, &model);
                Ok(serde_json::Value::Null)
            })?;
            ctx.staged = staged;
            ctx.effects.push(Effect::Model(provider, model));
        }
        HostRequest::TabsEnabled => return read(ctx, &mut |read| serde_json::to_value(read.tabs_enabled())),
        HostRequest::Tabs => return read(ctx, &mut |read| serde_json::to_value(read.tabs())),
        HostRequest::Tab { edit } => {
            let allowed = ctx.host.upgrade().is_some_and(|host| ctx.staged.tab(&*host, &edit));
            if allowed {
                ctx.effects.push(Effect::Tab(edit));
            }
            return Ok(serde_json::Value::Bool(allowed));
        }
        HostRequest::KeymapPending => return read(ctx, &mut |read| serde_json::to_value(read.keymap_pending())),
        HostRequest::KeymapActive => return read(ctx, &mut |read| serde_json::to_value(read.keymap_active())),
        HostRequest::KeymapCommands => return read(ctx, &mut |read| serde_json::to_value(read.keymap_commands())),
        HostRequest::Shortcuts { name } => return read(ctx, &mut |read| serde_json::to_value(read.shortcuts(&name))),
        HostRequest::Selection => return read(ctx, &mut |read| serde_json::to_value(read.selection())),
        HostRequest::ClearSelection => ctx.effects.push(Effect::ClearSelection),
        HostRequest::Foreground(program) => {
            if !crate::has_room(ctx.effects.len()) {
                return Err(crate::REFUSED.to_owned());
            }
            let id = next_request();
            ctx.effects.push(Effect::Foreground(id, program, owning(ctx)));
            return Ok(serde_json::to_value(id).unwrap_or_default());
        }
        HostRequest::Timer { ms } => {
            if !crate::has_room(ctx.effects.len()) {
                return Err(crate::REFUSED.to_owned());
            }
            let id = next_request();
            ctx.effects.push(Effect::Timer(id, std::time::Duration::from_millis(ms), owning(ctx)));
            return Ok(serde_json::to_value(id).unwrap_or_default());
        }
        HostRequest::CancelTimer { id } => ctx.effects.push(Effect::CancelTimer(id)),
        HostRequest::Owner => return Ok(crate::owner_id(owning(ctx).as_ref()).into()),
        HostRequest::SetOwner { owner } => {
            if let Some(owners) = &ctx.owners {
                owners.set_owner(owner);
            }
        }
        HostRequest::Title { title } => ctx.effects.push(Effect::Title(title)),
        HostRequest::Theme => return read(ctx, &mut |read| serde_json::to_value(read.theme())),
        HostRequest::Themes => return read(ctx, &mut |read| serde_json::to_value(read.themes())),
        HostRequest::SetTheme { name } => {
            let staged = &ctx.staged;
            let known = read(ctx, &mut |read| Ok(serde_json::Value::Bool(staged.theme_known(read, &name))))?;
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
        // the verbs and reads of the mount whose handler runs, else of the plugin's newest live mount of a surface, as
        // for a built-in's command, which a library's command is bound to no mount like. A transcript verb answers the
        // user's input only.
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
        // Setup has no activation yet: a command that starts disabled says so in its `enabled`.
        HostRequest::SetEnabled { name, enabled } => {
            ctx.effects.push(Effect::Input(owners(ctx)?.set_enabled(&name, enabled)));
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

/// Scroll commands use the current call's mount, or the newest live mount of the named surface if called outside a
/// mount.
fn called_mount(ctx: &Ctx) -> Option<std::rc::Weak<()>> {
    // The mount the call is of, also a route command's, which holds no input.
    ctx.owners.as_ref().and_then(|owners| owners.owning())
}

/// What the calls hold of the input; a setup asks nothing of it, as it has no mount and no owner yet.
fn owners(ctx: &Ctx) -> Result<Rc<crate::Owners>, String> {
    ctx.owners.clone().ok_or_else(|| "setup has no input: it may open, focus and read nothing of it".to_owned())
}

/// Whether `request` asks for an effect, which a render may not. Every request is sorted, so a new one has to say.
fn effect(request: &HostRequest) -> bool {
    match request {
        HostRequest::Toast { .. }
        | HostRequest::StorageSet { .. }
        | HostRequest::StorageMerge { .. }
        | HostRequest::OpenRoute { .. }
        | HostRequest::Dispatch { .. }
        | HostRequest::SetEnabled { .. }
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
        | HostRequest::Timer { .. }
        | HostRequest::CancelTimer { .. }
        | HostRequest::Title { .. }
        | HostRequest::SetTheme { .. }
        | HostRequest::InstallTheme { .. }
        | HostRequest::SetSetting { .. }
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
        | HostRequest::Message { .. }
        | HostRequest::Models { .. }
        | HostRequest::Model
        | HostRequest::Limits
        | HostRequest::Providers
        | HostRequest::Info
        | HostRequest::Plugins
        | HostRequest::Setting { .. }
        | HostRequest::ImageSize { .. }
        | HostRequest::ImageBounds
        | HostRequest::UtcOffset { .. }
        | HostRequest::Measure { .. }
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
        | HostRequest::Owner
        | HostRequest::SetOwner { .. }
        | HostRequest::Theme
        | HostRequest::Themes
        | HostRequest::ScrollState { .. }
        | HostRequest::Anchors { .. }
        | HostRequest::TopAnchor { .. }
        | HostRequest::Transcript
        | HostRequest::Rect { .. }
        | HostRequest::Focused
        | HostRequest::InputMode
        | HostRequest::Sessions
        | HostRequest::Pending { .. } => false,
    }
}

/// Answers a read through the host's [`Host::read`], as a built-in reads in process.
fn read(
    ctx: &Ctx,
    answer: &mut dyn FnMut(&dyn abi::Read) -> serde_json::Result<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let host = ctx.host.upgrade().ok_or("the host is gone")?;
    let (mut answered, mut value) = (false, Ok(serde_json::Value::Null));
    host.read(&mut |read| {
        if !std::mem::replace(&mut answered, true) {
            value = answer(read);
        }
    });
    value.map_err(|error| error.to_string())
}

/// Whose handler a delivery calls: a surface's, by index, for the mount the event is routed to; or a layer's of
/// setup, by index.
#[derive(Clone, Copy)]
pub(crate) enum To {
    Surface(usize),
    Layer(usize),
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
    /// The host cancelled `request`, as the mount that owns it closed: no reply comes. It is told once, never after the
    /// reply: a plugin whose manifest has [`abi::Manifest::cancelled`] as [`Request::Cancelled`] (a library, or one in
    /// process), the JS host as the rejection of the promise that waits for the reply.
    fn cancel(self: Rc<Self>, request: abi::RequestId);
    /// Whether [`Answers::cancel`] tells it anything, so a mount's close queues a cancel for it at all.
    fn cancels(&self) -> bool;
    /// Lets go at once of what the host holds for `request`, which its mount's close cancelled: a timer's schedule.
    fn release(&self, _request: abi::RequestId) {}
    /// Its activation, whose timers it asks for; none for the JS host, whose timers are its own.
    fn activation(&self) -> Option<Rc<Activation>> {
        None
    }
}

/// Calls `send` unless the instance `guest` names is destroyed or its activation ended, as a call that panicked after
/// the one that asked for it ends it, or the mount that owns it closed: a fetch or a program in the foreground. Its
/// reply goes to the instance as `request` on the effect queue, unless the instance is destroyed or that mount closed
/// by then, as in process: a reply never reaches a mount opened again.
pub(crate) fn reply_to(
    guest: &Weak<dyn Answers>,
    host: &dyn Host,
    request: abi::RequestId,
    mount: Option<Weak<()>>,
    send: impl FnOnce(&dyn Host, crate::Reply),
) {
    let Some(running) = guest.upgrade().filter(|guest| guest.live()) else { return };
    if let Some(mount) = &mount {
        if mount.upgrade().is_none() {
            return running.cancel(request);
        }
        // Past the cap the request is not sent, and its reply is that refusal.
        if !wait(mount, guest, request) {
            let error = format!("more than {MOUNT_REQUESTS} requests of the plugin's mounts wait");
            return running.answer(Request::Reply { id: request, result: Err(error) });
        }
    }
    let (guest, owner) = (guest.clone(), running.owner());
    send(
        host,
        Box::new(move |result| {
            defer(&owner, move |_| {
                // A mount's request its mount's close cancelled already ([`cancel_closed`]) waits no more.
                let waiting = mount.is_none() || take_inflight(request);
                let Some(guest) = guest.upgrade().filter(|_| waiting) else { return };
                match mount.as_ref().is_none_or(|mount| mount.upgrade().is_some()) {
                    true => guest.answer(Request::Reply { id: request, result }),
                    false => guest.cancel(request),
                }
            });
        }),
    );
}

/// The most requests of one instance's mounts that wait for their reply at once: so many cancels fit in one frame's
/// effects (`FRAME_EFFECTS`) when its mounts close.
pub(crate) const MOUNT_REQUESTS: usize = 1024;

/// The requests of mounts that wait for their reply ([`reply_to`]), by request and by mount, so that a reply and a
/// mount's close each touch only their own, and how many each instance has.
#[derive(Default)]
struct Inflight {
    /// Each request: its mount's key, and the instance that asked.
    requests: std::collections::HashMap<abi::RequestId, (usize, Weak<dyn Answers>)>,
    /// Each instance's requests that wait, by its address, at most [`MOUNT_REQUESTS`].
    instances: std::collections::HashMap<usize, usize>,
    /// Each mount's requests, by its key: the address of its token, which the weak reference here keeps from another
    /// mount while any of its requests waits.
    mounts: std::collections::HashMap<usize, (Weak<()>, std::collections::HashSet<abi::RequestId>)>,
}

thread_local! {
    static INFLIGHT: RefCell<Inflight> = RefCell::default();
}

/// The key of mount `mount` in [`Inflight`].
pub(crate) fn mount_key(mount: &Weak<()>) -> usize {
    mount.as_ptr() as usize
}

/// Keeps `request` of mount `mount`, which `guest` asked for, until its reply or the mount's close; `false`, and keeps
/// nothing, when [`MOUNT_REQUESTS`] of `guest` wait already.
fn wait(mount: &Weak<()>, guest: &Weak<dyn Answers>, request: abi::RequestId) -> bool {
    let key = mount_key(mount);
    INFLIGHT.with_borrow_mut(|inflight| {
        let count = inflight.instances.entry(instance(guest)).or_default();
        if *count >= MOUNT_REQUESTS {
            return false;
        }
        *count += 1;
        inflight.requests.insert(request, (key, guest.clone()));
        inflight.mounts.entry(key).or_insert_with(|| (mount.clone(), Default::default())).1.insert(request);
        true
    })
}

/// The key of instance `guest` in [`Inflight::instances`].
fn instance(guest: &Weak<dyn Answers>) -> usize {
    guest.as_ptr().cast::<()>() as usize
}

impl Inflight {
    /// Counts one request of `guest` less.
    fn release(&mut self, guest: &Weak<dyn Answers>) {
        let key = instance(guest);
        if let Some(count) = self.instances.get_mut(&key) {
            *count -= 1;
            if *count == 0 {
                self.instances.remove(&key);
            }
        }
    }
}

/// Forgets `request` of a mount: a timer let go of, whose reply never comes.
pub(crate) fn forget(request: abi::RequestId) {
    take_inflight(request);
}

/// Whether `request` waited for its reply, which it does no more.
fn take_inflight(request: abi::RequestId) -> bool {
    INFLIGHT.with_borrow_mut(|inflight| {
        let Some((key, guest)) = inflight.requests.remove(&request) else { return false };
        inflight.release(&guest);
        if let Some((_, waiting)) = inflight.mounts.get_mut(&key) {
            waiting.remove(&request);
            if waiting.is_empty() {
                inflight.mounts.remove(&key);
            }
        }
        true
    })
}

/// Cancels at once the waiting requests of the mount whose key is `key`, which closed, rather than once their replies
/// come: the JS host's fetch of a mount that closed settles while the server still holds it. A surface's mount calls
/// it as it ends. Each cancel an instance hears is an effect of its own, so many spread over frames as replies do. How
/// many requests it cancelled: no other mount's are looked at.
pub(crate) fn cancel_closed(key: usize) -> usize {
    let cancelled: Vec<_> = INFLIGHT.with_borrow_mut(|inflight| {
        let Some((_, waiting)) = inflight.mounts.remove(&key) else { return Vec::new() };
        let cancelled: Vec<_> =
            waiting.into_iter().filter_map(|request| Some((request, inflight.requests.remove(&request)?.1))).collect();
        cancelled.iter().for_each(|(_, guest)| inflight.release(guest));
        cancelled
    });
    let count = cancelled.len();
    for (request, guest) in cancelled {
        let Some(running) = guest.upgrade() else { continue };
        running.release(request);
        if !running.cancels() {
            continue;
        }
        let owner = running.owner();
        defer(&owner, move |_| {
            if let Some(guest) = guest.upgrade() {
                guest.cancel(request);
            }
        });
    }
    count
}

/// The requests that wait, for the tests.
#[cfg(test)]
pub(crate) fn waiting() -> usize {
    INFLIGHT.with_borrow(|inflight| inflight.requests.len())
}

/// The mount that owns a request of the running call, as in process ([`crate::Owners::owning`]).
fn owning(ctx: &Ctx) -> Option<Weak<()>> {
    ctx.owners.as_ref().and_then(|owners| owners.owning())
}

/// Queues `effects` of plugin `id` on the effect queue, as the host would for a built-in; a fetch replies to `guest`,
/// and a dialog belongs to activation `generation`. Each effect is an entry of its own, as on the linked carrier, so
/// each counts against the frame's bound and the dispatch depth.
pub(crate) fn apply(
    host: &Weak<dyn Host>,
    id: String,
    guest: Weak<dyn Answers>,
    generation: Option<u64>,
    effects: Vec<Effect>,
) {
    let id: Rc<str> = Rc::from(id);
    for effect in effects {
        let (id, guest) = (id.clone(), guest.clone());
        let plugin = id.clone();
        // A request given an ID had its room reserved then ([`crate::has_room`]): it is admitted past the bound.
        let reserved = matches!(effect, Effect::Fetch(..) | Effect::Foreground(..) | Effect::Timer(..));
        let effect = move |host: &dyn Host| run(host, effect, &id, &guest, generation);
        match reserved {
            true => defer(host, effect),
            false => crate::request(host, &plugin, effect),
        }
    }
}

/// Does `effect` of plugin `id`.
fn run(host: &dyn Host, effect: Effect, id: &str, guest: &Weak<dyn Answers>, generation: Option<u64>) {
    match effect {
        Effect::Toast(toast) => host.toast(&toast),
        Effect::Route(name) => host.open_route(id, &name),
        Effect::Dispatch(name, input) => crate::dispatch(host, &name, input.as_deref()),
        Effect::Attention(attention) => host.attention(&attention),
        Effect::Stored => host.storage_changed(),
        Effect::Navigate(route) => host.navigate(id, &route),
        Effect::Fetch(request, fetch, mount) => {
            reply_to(guest, host, request, mount, |host, reply| host.fetch(fetch, reply));
        }
        // The host shows it only while its activation is live. What a setup that failed or a destroyed instance asked
        // for has none, and shows nowhere.
        Effect::Dialog(dialog) => {
            if let Some(generation) = generation {
                host.dialog(id, generation, *dialog);
            }
        }
        Effect::Copy(text, then) => crate::copy(host, &text, then),
        Effect::Composer(edit) => host.edit_composer(edit),
        Effect::Variant(variant) => host.set_variant(variant.as_deref()),
        Effect::Model(provider, model) => host.set_model(&provider, &model),
        Effect::Tab(edit) => host.edit_tab(edit),
        Effect::ClearSelection => host.clear_selection(),
        Effect::Foreground(request, program, mount) => {
            // The program starts later, once the turn is done: only if the instance is still live then, and the mount
            // that owns it is still open.
            let (owner, owning) = (guest.clone(), mount.clone());
            let alive = Box::new(move || {
                let open = owning.as_ref().is_none_or(|mount| mount.upgrade().is_some());
                open && owner.upgrade().is_some_and(|guest| guest.running())
            });
            reply_to(guest, host, request, mount, |host, reply| host.foreground(program, alive, reply));
        }
        // Setup asks before its activation exists: the timer finds it as it starts.
        Effect::Timer(request, delay, mount) => {
            let Some(activation) = guest.upgrade().and_then(|guest| guest.activation()) else { return };
            reply_to(guest, host, request, mount, move |host, reply| {
                activation.start_timer(host.app(), request, delay, reply);
            });
        }
        // After the timer's own effect, which a call asks for before it lets the timer go.
        Effect::CancelTimer(request) => {
            if let Some(activation) = guest.upgrade().and_then(|guest| guest.activation()) {
                activation.cancel_timer(request);
            }
            take_inflight(request);
        }
        Effect::Title(title) => host.set_title(&title),
        Effect::Theme(name) => host.set_theme(&name),
        Effect::InstallTheme(name, theme) => host.install_theme(&name, theme),
        Effect::Setting(name, value) => host.set_setting(&name, value),
        Effect::Scroll(scroll) => scroll(),
        Effect::Input(effect) => effect(host),
    }
}

/// The commands `manifest` scopes to its route `name`.
pub(crate) fn routed(manifest: &Manifest, name: &str) -> Vec<abi::Command> {
    let scope = abi::Scope::Route(name.to_owned());
    manifest.commands.iter().filter(|command| command.scope == scope).cloned().collect()
}

/// The nodes of `node` that carry an id, with what each keep holds again in the host's tree (`kept`): a library's memo
/// table keeps a value for each memo inside a kept one.
pub(crate) fn keyed(node: &v2::Node, kept: &dyn Fn(&str) -> usize) -> usize {
    let inside: usize = match node {
        v2::Node::Keep { key } => return kept(key).max(1),
        v2::Node::List { items, .. } => items.iter().map(|item| keyed(&item.node, kept)).sum(),
        _ => node.children().iter().map(|child| keyed(child, kept)).sum(),
    };
    usize::from(node.id().is_some()) + inside
}

#[cfg(test)]
mod tests;
