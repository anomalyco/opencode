use std::cell::OnceCell;
use std::ops::Deref;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use opencode_api::generated::{
    IntegrationInfo, LocationQueryInput, McpServer, ModelInfo, ModelRef, PluginInfo, PluginListInput, PluginSource,
    PluginState, ProviderID, ProviderInfo, SessionInboxDelivery, UsageLimitsInfo, V2Event, VcsInfo,
};
use opencode_local::cli_config::AttentionSoundName;
use opencode_local::serial::Serial;
use opencode_local::storage::Storage;
use opencode_plugin::abi;
use opencode_plugin::loader::approval::{self, Approvals, Artifact, Decision};
use opencode_plugin::loader::{Configured, Loader, ServerPart};
use opencode_plugin::node::{abi_mode, assign, refill, theme_color};
use opencode_plugin::{Builtin, Definition, Host, Registry, RouteMount, SlotInput, SlotMount, Status};
use opencode_store::State;
use opencode_store::location::{Catalog, Location, LocationData};
use opencode_ui::dialog::DialogKeymap;
use opencode_ui::markdown::CodeBlockRenderers;

use crate::features::attention::focus::When;
use crate::features::attention::notify::{self, Request, Sound};
use crate::prelude::*;

pub struct Plugins {
    registry: Registry,
    loader: RefCell<Option<Rc<Loader>>>,
    #[cfg(feature = "ts")]
    pub scripts: RefCell<Option<Rc<opencode_plugin::pipe::Scripts>>>,
    /// Last plugin list delivered to subscribers.
    told: RefCell<Vec<opencode_plugin::Entry>>,
    telling: Cell<bool>,
    /// The host's own `/plugins` while the plugin manager has failed.
    fallback: RefCell<Option<Disposer>>,
    server_parts: RefCell<Vec<String>>,
    /// Wait for both local and server plugins before reporting skipped entries once per run.
    told_skipped: RefCell<std::collections::HashSet<String>>,
    heard_server: Cell<bool>,
}

impl Plugins {
    pub fn set_loader(&self, loader: Rc<Loader>) {
        self.loader.replace(Some(loader));
    }
}

impl Deref for Plugins {
    type Target = Registry;

    fn deref(&self) -> &Registry {
        &self.registry
    }
}

impl Host for Tui {
    fn app(&self) -> &App {
        &self.app
    }

    fn theme(&self) -> Theme {
        self.page()
    }

    fn theme_mode(&self) -> opentui::theme::ThemeMode {
        self.theme.borrow().mode()
    }

    fn keymap(&self) -> &DialogKeymap {
        &self.keymap
    }

    fn storage_read(&self, key: &str) -> Option<String> {
        // A refused write left a value no file holds: the keys are read from disk first, once no write is queued.
        if self.reads.dirty.load(Ordering::SeqCst) && reload_cache(self) {
            let weak = self.weak();
            self.app.defer(move |_| {
                if let Some(tui) = weak.upgrade() {
                    tui.reads.changed(&tui);
                }
            });
        }
        if let Some(json) = self.reads.stored.borrow().get(key) {
            return json.clone();
        }
        let json = self.storage().and_then(|storage| load(&storage, key));
        self.reads.stored.borrow_mut().insert(key.to_owned(), json.clone());
        json
    }

    fn storage_write(&self, key: &str, json: &str) -> Result<(), String> {
        let value: serde_json::Value = serde_json::from_str(json).map_err(|error| error.to_string())?;
        if !(value.is_object() || value.is_array()) {
            return Err("a stored value is an object or an array".to_owned());
        }
        store(self, key, value.clone(), move |stored| *stored = value);
        Ok(())
    }

    fn storage_merge(&self, key: &str, fields: serde_json::Map<String, serde_json::Value>) -> Result<(), String> {
        let shown = match self.storage_read(key).and_then(|json| serde_json::from_str(&json).ok()) {
            Some(serde_json::Value::Object(object)) => object.into_iter().chain(fields.clone()).collect(),
            _ => fields.clone(),
        };
        // Check the merged size under the storage lock; another client can enlarge the value.
        queue(self, key, Some(serde_json::Value::Object(shown).to_string()), move |storage, key| {
            let merge = move |stored: &mut Value| match stored.as_object_mut() {
                Some(object) => object.extend(fields),
                None => *stored = serde_json::Value::Object(fields),
            };
            storage.update_within(key, &serde_json::json!({}), opencode_plugin::storage::VALUE_BYTES, merge).map(drop)
        });
        Ok(())
    }

    fn storage_restore(&self, key: &str, json: Option<&str>) {
        match json.and_then(|json| serde_json::from_str::<Value>(json).ok()) {
            Some(value) => store(self, key, value.clone(), move |stored| *stored = value),
            // A key that held nothing goes, in order with the writes before it.
            None => queue(self, key, None, |storage, key| storage.remove(key)),
        }
    }

    fn storage_changed(&self) {
        self.reads.changed(self);
    }

    fn toast(&self, toast: &abi::Toast) {
        let variant = match toast.variant {
            abi::Variant::Info => Variant::Info,
            abi::Variant::Success => Variant::Success,
            abi::Variant::Warning => Variant::Warning,
            abi::Variant::Error => Variant::Error,
        };
        let mut options = ToastOptions::new(variant, toast.message.clone());
        options.title = toast.title.clone();
        // Only offer to open a session outside the visible family. Queue plugin toasts behind host failure notices.
        let Some(session) = toast.session.as_ref().map(|id| SessionID(id.clone())) else {
            return self.toasts.show_behind_kept(options);
        };
        let here = match self.route() {
            Route::Session { id: open } => self.data.read(|state| state.root(&open) == state.root(&session)),
            _ => false,
        };
        if !here {
            if options.title.is_none() {
                options.title = self.data.read(|state| state.session(&session).and_then(|info| info.title.clone()));
            }
            let route = Route::Session { id: session };
            options = options.action("Open", bind!(self, |tui| tui.navigate(route.clone())));
        }
        self.toasts.show_behind_kept(options);
    }

    fn failed(&self, id: &str) {
        // Show the failure report after the failing call's effects so an earlier toast cannot hide it.
        let title = format!("Plugin failed: {id}");
        self.app.defer(bind!(self, |tui, _| failed_toast(&tui, title.clone(), String::new())));
        self.reads.changed(self);
    }

    fn slow(&self, id: &str, cost: &str) {
        // A failed or disabled plugin already has its own report.
        if !self.plugins.entries().iter().any(|entry| entry.id == id && entry.status == Status::Active) {
            return;
        }
        let options = ToastOptions::new(Variant::Warning, format!("{cost}. Run /plugins for details."))
            .title(format!("Plugin is slow: {id}"))
            .keep();
        tell_plugins(self);
        // Keep the manager available to reopen `/plugins`.
        if id == super::manager::ID {
            return self.toasts.show(options);
        }
        let id = id.to_owned();
        self.toasts.show(options.action(
            "Disable",
            bind!(self, |tui| {
                tui.plugins.toggle(&host(&tui), &id, false);
                host(&tui).remount();
            }),
        ));
    }

    fn slow_changed(&self) {
        tell_plugins(self);
    }

    fn revoked(&self, id: &str) {
        super::panel::close(self, id);
        // A dialog surface on screen mounts again from the registration that replaced the one that ended.
        let reloaded = id.to_owned();
        self.app.defer(bind!(self, |tui, _| super::panel::remount(&tui, &reloaded)));
        // Keep the panel open across registration reloads and remount its new surface.
        let kept = self.panels.current().is_some_and(|target| {
            target.plugin == id
                && self.plugins.has_panel(id, &target.name)
                && self.plugins.entries().iter().any(|entry| entry.id == id && entry.status == Status::Active)
        });
        if kept {
            return self.app.defer(bind!(self, |tui, _| tui.frame.remount_panel(&tui)));
        }
        self.panels.release(self, id);
    }

    fn pending(&self, target: &str) {
        #[cfg(luau)]
        if held(self, target)
            .and_then(|(artifact, _)| artifact.ok())
            .as_ref()
            .is_some_and(opencode_plugin::luau::approves)
        {
            let message =
                "This project wants to run a Luau plugin inside opencode. Run /plugins to approve or decline it.";
            return pending_toast(self, target, message);
        }
        let message =
            "This project wants to run TypeScript code in opencode's JS host. Run /plugins to approve or decline it.";
        pending_toast(self, target, message);
    }

    fn attention(&self, attention: &abi::Attention) {
        let when = |when| match when {
            abi::When::Always => When::Always,
            abi::When::Focused => When::Focused,
            abi::When::Blurred => When::Blurred,
        };
        let sound = attention.sound.as_ref().map(|sound| Sound {
            name: match sound.name {
                abi::SoundName::Default => AttentionSoundName::Default,
                abi::SoundName::Question => AttentionSoundName::Question,
                abi::SoundName::Permission => AttentionSoundName::Permission,
                abi::SoundName::Error => AttentionSoundName::Error,
                abi::SoundName::Done => AttentionSoundName::Done,
                abi::SoundName::SubagentDone => AttentionSoundName::SubagentDone,
            },
            when: when(sound.when),
            volume: sound.volume,
        });
        let request = Request {
            title: attention.title.clone(),
            message: attention.message.clone(),
            notification: attention.notify.map(when),
            sound,
        };
        notify::notify(self, &request);
    }

    fn on_event(&self, types: &[String], run: Rc<dyn Fn(&V2Event)>) -> Option<Disposer> {
        Some(crate::features::events::subscribe(self, types.iter().cloned(), move |_, event| run(event)))
    }

    fn slot(&self, parent: &View, path: &str, input: &SlotInput) -> Option<SlotMount> {
        Some(self.plugins.mount(self, parent, path, input, |_| {}))
    }

    fn open_route(&self, id: &str, name: &str) {
        if guarded(self, id, "route") {
            return;
        }
        self.dialogs.clear();
        self.navigate(Route::Plugin { id: id.to_owned(), name: name.to_owned() });
    }

    fn remount(&self) {
        self.navigate(self.route());
        tell_plugins(self);
    }

    fn dispatch(&self, name: &str, input: Option<&str>) {
        self.keymap.dispatch(name, input);
    }

    fn navigate(&self, plugin: &str, route: &abi::Route) {
        let route = match route {
            abi::Route::Home => Route::Home,
            abi::Route::Session { id } => Route::Session { id: SessionID(id.clone()) },
            abi::Route::Plugin { id, name } => {
                if guarded(self, plugin, "navigation") {
                    return;
                }
                self.dialogs.clear();
                Route::Plugin { id: id.clone(), name: name.clone() }
            }
        };
        self.navigate(route);
    }

    fn fetch(&self, fetch: abi::Fetch, reply: Box<dyn FnOnce(Result<Value, String>)>) {
        let client = self.data.client().clone();
        let bytes = fetch.bytes;
        let call = super::fetch::call_of(fetch);
        let sent = async move {
            let call = call?;
            match bytes {
                true => client.reply_bytes(call).await.map(|body| Value::String(abi::base64::encode(&body))),
                false => client.reply(call).await,
            }
            .map_err(|error| error.tui_message())
        };
        self.app.spawn(sent, move |_, result| reply(result));
    }

    fn dialog(&self, id: &str, generation: u64, dialog: abi::Dialog) {
        if !self.plugins.live(id, generation) {
            return;
        }
        // One the host's own dialog keeps out closes at once, so a plugin that waits for its answer hears that.
        if guarded(self, id, "dialog") {
            return super::panel::refused(self, id, generation, dialog);
        }
        super::panel::show(self, id, generation, dialog);
    }

    fn dialog_open(&self, id: &str, key: &str) -> bool {
        super::panel::open(self, id, key)
    }

    fn copy(&self, text: &str) -> bool {
        let copied = crate::features::selection::put(&self.app, text);
        if !copied {
            self.toasts.error("Failed to copy to clipboard");
        }
        copied
    }

    fn edit_composer(&self, edit: abi::ComposerEdit) {
        let prompt = self.prompt.current.borrow().upgrade();
        let Some(prompt) = prompt.filter(|prompt| prompt.shown()) else { return };
        match edit {
            abi::ComposerEdit::Set { text } => prompt.set_text(&text),
            abi::ComposerEdit::Insert { text } => drop(prompt.textarea.insert(&text)),
            abi::ComposerEdit::Submit if prompt.submittable(self) => {
                crate::prompt::submit::submit(&prompt, SessionInboxDelivery::Steer);
            }
            abi::ComposerEdit::Submit => {}
        }
    }

    fn set_variant(&self, variant: Option<&str>) {
        self.local.set_variant(variant);
    }

    fn set_model(&self, provider: &str, model: &str) {
        self.local.set(&opencode_local::model_pref::Model::new(provider, model), true);
    }

    fn tab_allowed(&self, edit: &abi::TabEdit, staged: &[abi::TabEdit]) -> bool {
        if !crate::tabs::Tabs::enabled(self) {
            return false;
        }
        let root = |session: &str| self.data.read(|state| state.root(&SessionID(session.to_owned()))).0;
        // Apply tab edits in call order.
        let (mut open, mut current) = (self.tabs.open_ids(self), self.tabs.current(self));
        for edit in staged {
            match edit {
                abi::TabEdit::Open { session } | abi::TabEdit::Focus { session } => {
                    let root = root(session);
                    if !open.contains(&root) {
                        open.push(root.clone());
                    }
                    if matches!(edit, abi::TabEdit::Focus { .. }) {
                        current = Some(root);
                    }
                }
                abi::TabEdit::Move { .. } => {}
                abi::TabEdit::Close { session } => {
                    let closed = session.clone().or_else(|| current.clone());
                    open.retain(|id| Some(id) != closed.as_ref());
                    if current == closed {
                        current = None;
                    }
                }
            }
        }
        match edit {
            abi::TabEdit::Open { .. } | abi::TabEdit::Focus { .. } => true,
            // Move accepts any session in a tab family; close requires the tab's own ID.
            abi::TabEdit::Move { session, .. } => open.contains(&root(session)),
            abi::TabEdit::Close { session } => session.clone().or(current).is_some_and(|id| open.contains(&id)),
        }
    }

    fn edit_tab(&self, edit: abi::TabEdit) {
        match edit {
            abi::TabEdit::Open { session } => crate::tabs::open(self, &session),
            abi::TabEdit::Focus { session } => crate::tabs::select(self, &session),
            abi::TabEdit::Move { session, index } => crate::tabs::reorder(self, &session, index),
            abi::TabEdit::Close { session } => crate::tabs::close(self, session.as_deref()),
        }
    }

    fn foreground(&self, program: abi::Foreground, alive: Box<dyn Fn() -> bool>, reply: opencode_plugin::Reply) {
        crate::features::foreground::run(self, program, alive, reply);
    }

    fn set_title(&self, title: &str) {
        crate::features::title::set_by_plugin(self, title);
    }

    fn set_theme(&self, name: &str) {
        if self.theme.borrow().selected() != name {
            self.theme.borrow_mut().config_name(name);
            self.theme_changed();
        }
        // The settings write tells the claims with `local`, so they read the new theme.
        let name = Value::from(name);
        crate::dialogs::settings::update(self, move |draft| {
            crate::dialogs::settings::set_path(draft, &["theme", "name"], name)
        });
    }

    fn set_setting(&self, name: &str, value: Value) {
        set_setting(self, name, value);
    }

    fn install_theme(&self, name: &str, theme: Value) {
        if !opencode_plugin::theme_file_name(name) || !opencode_ui::theme::is_theme_source(&theme) {
            log::warn!("a plugin installs a theme that is not one, or not as a plain file name: {name:?}");
            return;
        }
        // Listed at once, so a `set_theme` queued after it finds it; the scan after the write lists it from disk.
        self.theme.borrow_mut().add_custom(name, theme.clone());
        self.theme_changed();
        local_changed(self);
        let file = format!("{name}.json");
        crate::app::discover_themes(self, move |config| {
            let themes = config.join("themes");
            // Written beside it and renamed over it: a scan never reads half a file, a failed write keeps the old
            // one, and a symlink there is replaced, not followed.
            let temporary = themes.join(format!(".{file}.tmp"));
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create(true).truncate(true);
            let bytes = serde_json::to_vec_pretty(&theme).unwrap_or_default();
            let written = std::fs::create_dir_all(&themes)
                .and_then(|()| opencode_util::busy::replace(&themes.join(&file), &temporary, &options, &bytes));
            if let Err(error) = written {
                log::error!("Failed to install theme {file}: {error}");
            }
        });
    }

    fn on_deltas(&self, run: opencode_plugin::Deltas) -> Option<Disposer> {
        Some(crate::features::events::subscribe_deltas(self, move |events| run(events)))
    }

    fn markdown(&self, text: &str) -> opentui::widget::Markdown {
        markdown(self).set_markdown(text)
    }

    fn read(&self, f: &mut dyn FnMut(&dyn abi::Read)) {
        // One store snapshot for every read within `f`, a whole plugin call, which reads again and again: the reads
        // nest in this one, and a batch another thread applies meanwhile waits until the call returns. Every read is
        // pure, so nothing writes the store inside it.
        self.data.read(|_| f(&Reader { tui: self, theme: OnceCell::new() }));
    }

    fn local_revision(&self) -> Option<u64> {
        Some(self.reads.revision.get())
    }

    fn router(&self) -> Option<&opencode_plugin::interact::Router> {
        Some(&self.router)
    }

    fn composer_focused(&self) -> bool {
        self.prompt.current.borrow().upgrade().is_some_and(|prompt| prompt.shown() && prompt.focused())
    }

    fn focus_moved(&self) {
        crate::frame::follow_focus(self);
    }

    fn commands_changed(&self) {
        self.keymap.conditions_changed();
        let prompt = self.prompt.current.borrow().upgrade();
        if let Some(complete) = prompt.as_ref().and_then(|prompt| prompt.autocomplete.get()) {
            complete.commands_changed();
        }
    }

    fn focus_composer(&self) {
        let prompt = self.prompt.current.borrow().upgrade();
        if let Some(prompt) = prompt.filter(|prompt| prompt.shown()) {
            crate::frame::activate_session(self);
            opencode_plugin::interact::refocus(self, || self.app.focus(&prompt.textarea));
        }
    }

    fn modal_open(&self) -> bool {
        self.dialogs.is_open()
    }

    fn reveal(&self, widget: &AnyWidget) {
        super::panel::reveal(self, widget);
    }

    fn modal_holds(&self, view: &View) -> bool {
        // The dialogs replace each other, so one under the dialogs' host is in the dialog on top.
        let host = self.dialogs.host().id();
        self.dialogs.is_open()
            && std::iter::successors(Some(view.as_any()), |widget| widget.parent()).any(|w| w.id() == host)
    }

    fn overlay_layer(&self) -> Option<View> {
        Some(self.plugin_overlays.clone())
    }

    fn open_panel(&self, id: &str, open: &abi::interact::OpenPanel) {
        if !self.plugins.has_panel(id, &open.surface) {
            log::warn!("plugin {id}: it has no panel surface {:?}", open.surface);
            return;
        }
        // Beside the session it names, or the one on screen, while that session shows.
        let Route::Session { id: shown } = self.route() else {
            log::warn!("plugin {id}: its panel {} opens beside a session, and none shows", open.surface);
            return;
        };
        if open.session.as_ref().is_some_and(|session| *session != shown.0) {
            log::warn!("plugin {id}: its panel {} names a session that is not on screen", open.surface);
            return;
        }
        let target = crate::panel::Target { plugin: id.to_owned(), name: open.surface.clone(), session: shown.0 };
        let presentation =
            if open.fullscreen { crate::panel::Presentation::Fullscreen } else { crate::panel::Presentation::Panel };
        self.panels.open(self, target, presentation);
    }

    fn close_panel(&self, id: &str, surface: &str) {
        if self.panels.current().is_some_and(|target| target.plugin == id && target.name == surface) {
            self.panels.close(self);
        }
    }

    fn panel_input(&self, id: &str, surface: &str) -> Option<abi::interact::PanelInput> {
        let target = self.panels.current().filter(|target| target.plugin == id && target.name == surface)?;
        let session = crate::frame::panel_state(self, &target)?;
        Some(
            abi::interact::PanelInput::default()
                .width(session.0)
                .when(
                    self.panels.presentation() == crate::panel::Presentation::Fullscreen,
                    abi::interact::PanelInput::fullscreen,
                )
                .when(session.1, abi::interact::PanelInput::focused)
                .when(!self.panels.can_split(), abi::interact::PanelInput::forced),
        )
    }

    fn watch(&self, push: Rc<dyn Fn(&abi::Changed)>) -> Option<Disposer> {
        // The revision counts each change once, before any watcher hears it ([`count_local`]).
        let local = abi::Changed { local: true, ..abi::Changed::default() };
        let listener = {
            let (push, local) = (push.clone(), local.clone());
            self.local.subscribe(move || push(&local))
        };
        let settings = {
            let push = push.clone();
            self.settings.subscribe(move |_| push(&local))
        };
        let resize = {
            let push = push.clone();
            self.app.on_resize(move |_, _, _| push(&abi::Changed { size: true, ..abi::Changed::default() }))
        };
        let mut watchers = self.reads.watchers.borrow_mut();
        watchers.retain(|watcher| watcher.strong_count() > 0);
        watchers.push(Rc::downgrade(&push));
        let app = self.app.clone();
        Some(Disposer::new(move || {
            listener.dispose();
            settings.dispose();
            app.remove_handler(resize);
            drop(push);
        }))
    }
}

/// Advance the shared local revision before notifying watchers, once per change.
pub(crate) fn count_local(tui: &Tui) {
    let revision = tui.reads.revision.clone();
    let local = tui.local.subscribe(move || revision.set(revision.get() + 1));
    let revision = tui.reads.revision.clone();
    let settings = tui.settings.subscribe(move |_| revision.set(revision.get() + 1));
    tui.reads.counting.borrow_mut().extend([local, settings]);
}

pub fn changed(tui: &Tui, changes: &Changes, sync: impl FnOnce(Option<&abi::Changed>)) {
    if changes.is_empty() {
        return sync(None);
    }
    // Refilled with each change batch, so a batch like the one before costs no allocation.
    let mut changed = tui.reads.batch.take();
    changed.all = changes.all;
    let sessions = changes.session.iter().chain(&changes.status).chain(changes.selected.keys()).chain(&changes.jobs);
    refill(&mut changed.sessions, sessions, |into, id| assign(into, &id.0));
    refill(&mut changed.lists, &changes.messages, |into, id| assign(into, &id.0));
    let messages = changes.message.iter().flat_map(|(session, ids)| ids.iter().map(move |id| (session, id)));
    refill(&mut changed.messages, messages, |(into_session, into_id), (session, id)| {
        assign(into_session, &session.0);
        assign(into_id, &id.0);
    });
    refill(&mut changed.locations, &changes.locations, |into, location| {
        assign(&mut into.directory, &location.directory);
        match &location.workspace_id {
            Some(workspace) => assign(into.workspace.get_or_insert_default(), workspace),
            None => into.workspace = None,
        }
    });
    (changed.local, changed.size, changed.woken) = (false, false, false);
    sync(Some(&changed));
    tui.reads.batch.replace(changed);
}

/// Shows `shown` under storage key `key` at once, and queues `change` of the latest stored value under the storage
/// lock after every write made before it. The plugin queues [`opencode_plugin::Host::storage_changed`] after it.
fn store(tui: &Tui, key: &str, shown: Value, change: impl FnOnce(&mut Value) + Send + 'static) {
    queue(tui, key, Some(shown.to_string()), |storage, key| {
        storage.update(key, &serde_json::json!({}), change).map(drop)
    });
}

/// Shows `shown` to reads of `key` at once, and runs `write` on the plugin storage's writer, after the writes before it.
fn queue(
    tui: &Tui,
    key: &str,
    shown: Option<String>,
    write: impl FnOnce(&Storage, &str) -> Result<(), opencode_local::storage::Error> + Send + 'static,
) {
    tui.reads.stored.borrow_mut().insert(key.to_owned(), shown);
    if let Some(storage) = tui.storage() {
        let (pending, dirty) = (tui.reads.pending.clone(), tui.reads.dirty.clone());
        pending.fetch_add(1, Ordering::SeqCst);
        let (key, proxy) = (key.to_owned(), tui.app.proxy());
        let writer = tui.reads.writer.get_or_init(|| {
            // A refused write leaves the disk unchanged; invalidate its optimistic value.
            let weak = tui.weak();
            tui.app.on_message(move |_, _: &Refused| {
                if let Some(tui) = weak.upgrade() {
                    reload_storage(&tui);
                }
            });
            Serial::new("plugin-storage")
        });
        writer.run(move || {
            let refused = match write(&storage, &key) {
                Ok(()) => false,
                Err(error) => {
                    log::error!("Failed to store {key}: {error}");
                    matches!(error, opencode_local::storage::Error::TooLarge(..))
                }
            };
            // The flag is set before the write counts as done, so a read that sees no write pending sees it; the
            // message only hurries the reload, and may be lost to a full queue.
            if refused {
                dirty.store(true, Ordering::SeqCst);
            }
            pending.fetch_sub(1, Ordering::SeqCst);
            if refused {
                let _ = proxy.send(Refused);
            }
        });
    }
}

/// Notification of a storage write refused under the lock.
struct Refused;

/// Waits until every plugin storage write queued so far is on disk.
pub fn flush_storage(tui: &Tui) {
    if let Some(writer) = tui.reads.writer.get() {
        writer.flush();
    }
}

fn load(storage: &Storage, key: &str) -> Option<String> {
    storage.load(key, &Value::Null).ok().filter(|value| !value.is_null()).map(|value| value.to_string())
}

/// Reads the plugins' stored keys again after the storage directory changed, so another client's writes show. While a
/// write of this TUI is queued the keys stay; its own change of the directory reads them again after it.
pub fn reload_storage(tui: &Tui) {
    if reload_cache(tui) {
        tui.reads.changed(tui);
    }
}

/// Reads every cached key from disk, unless a write is queued, and ends a refused write's [`Reads::dirty`]: whether a
/// value changed.
fn reload_cache(tui: &Tui) -> bool {
    let Some(storage) = tui.storage().filter(|_| tui.reads.pending.load(Ordering::SeqCst) == 0) else { return false };
    // Cleared before the reads, so a refusal that lands meanwhile sets it again.
    tui.reads.dirty.store(false, Ordering::SeqCst);
    let mut changed = false;
    for (key, json) in tui.reads.stored.borrow_mut().iter_mut() {
        let fresh = load(&storage, key);
        changed |= *json != fresh;
        *json = fresh;
    }
    changed
}

fn failed_toast(tui: &Tui, title: String, names: String) {
    let mut options = ToastOptions::new(Variant::Error, format!("{names}Run /plugins to view details.")).keep();
    options.title = Some(title);
    let options = options.action(
        "Open plugins",
        bind!(tui, |tui| {
            tui.keymap.dispatch("plugins.list", None);
        }),
    );
    tui.toasts.show(options);
}

type Push = dyn Fn(&abi::Changed);

/// The catalog loads plugin reads asked for, which start once the current event is handled, a session ID buffer, so a
/// read by ID allocates nothing, and the plugins' storage.
#[derive(Default)]
pub struct Reads {
    needs: RefCell<Vec<(Catalog, Location)>>,
    key: Cell<SessionID>,
    /// The JSON text of each storage key read or written, so a write shows at once and storage works without disk.
    stored: RefCell<HashMap<String, Option<String>>>,
    /// Serialize plugin storage writes.
    writer: OnceCell<Serial>,
    /// The writes queued and not yet on disk.
    pending: Arc<AtomicUsize>,
    /// Reload disk state after a refused write before trusting the cache.
    dirty: Arc<AtomicBool>,
    /// The mounted claims' pushes, which a storage write calls with `local` from the effect queue.
    watchers: RefCell<Vec<Weak<Push>>>,
    telling: Cell<bool>,
    revision: Rc<Cell<u64>>,
    counting: RefCell<Vec<Disposer>>,
    server: RefCell<(Option<Location>, Vec<PluginInfo>)>,
    /// What the last change batch changed, for the plugins.
    batch: RefCell<abi::Changed>,
    pub(super) panel: RefCell<Option<super::panel::Live>>,
    /// The plugin dialog surface on screen, which one of the same key changes in place.
    pub(super) surface: RefCell<Option<Rc<super::panel::Body>>>,
    /// The plugin and activation whose dialog is on screen, until it closes.
    pub(super) owner: RefCell<Option<(String, u64)>>,
    /// A close clears only its own showing, even when a new activation owns the next one.
    pub(super) showing: Cell<u64>,
    pub(super) showings: Cell<u64>,
    /// The action the next plugin dialog runs as it closes (`abi::Dialog::Dismissable`), until that dialog takes it.
    pub(super) dismissed: RefCell<Option<((String, u64), abi::Action)>>,
    pub(super) select: RefCell<Option<Rc<super::panel::Picker>>>,
    pub(super) kept: RefCell<Option<(String, Kept)>>,
}

pub(super) type Kept = (String, Option<String>);

impl Reads {
    /// Tells the mounted claims that the storage changed. The plugins queue it after a write, so it is in order with
    /// their other effects; it tells at the end of the queue, once for every write queued before then.
    fn changed(&self, tui: &Tui) {
        self.revision.set(self.revision.get() + 1);
        if self.telling.replace(true) {
            return;
        }
        tui.app.defer(bind!(tui, |tui, _| {
            tui.reads.telling.set(false);
            let pushes: Vec<_> = tui.reads.watchers.borrow().iter().filter_map(Weak::upgrade).collect();
            let local = abi::Changed { local: true, ..abi::Changed::default() };
            pushes.iter().for_each(|push| push(&local));
        }));
    }

    fn need(&self, tui: &Tui, catalog: Catalog, location: Location) {
        let mut needs = self.needs.borrow_mut();
        if needs.iter().any(|(known, at)| *known == catalog && *at == location) {
            return;
        }
        needs.push((catalog, location));
        if needs.len() > 1 {
            return;
        }
        tui.app.defer(bind!(tui, |tui, _| {
            let needs = std::mem::take(&mut *tui.reads.needs.borrow_mut());
            for (catalog, location) in needs {
                drop(tui.data.catalog_sync(catalog, Some(&location)));
            }
        }));
    }
}

struct Reader<'a> {
    tui: &'a Tui,
    theme: OnceCell<Theme>,
}

impl Reader<'_> {
    fn session<R>(&self, id: &str, f: impl FnOnce(&State, &SessionID) -> R) -> R {
        let mut key = self.tui.reads.key.take();
        assign(&mut key.0, id);
        let result = self.tui.data.read(|state| f(state, &key));
        self.tui.reads.key.set(key);
        result
    }

    fn catalog<T>(
        &self,
        location: Option<&abi::LocationRef>,
        catalog: Catalog,
        get: impl FnOnce(&LocationData) -> Option<T>,
    ) -> Option<T> {
        let location = self.location(location);
        let value = self.tui.data.read(|state| state.location(Some(&location)).and_then(get));
        if value.is_none() {
            self.tui.reads.need(self.tui, catalog, location);
        }
        value
    }

    fn location(&self, location: Option<&abi::LocationRef>) -> Location {
        match location {
            Some(location) => {
                Location { directory: location.directory.clone(), workspace_id: location.workspace.clone() }
            }
            None => self.tui.local.catalog_location(),
        }
    }
}

impl abi::Read for Reader<'_> {
    fn theme_mode(&self) -> abi::ThemeMode {
        abi_mode(self.tui.theme.borrow().mode())
    }

    fn color(&self, token: &str) -> Option<abi::Rgba> {
        theme_color(self.theme.get_or_init(|| self.tui.page()), token)
    }

    fn session(&self, id: &str) -> Option<abi::Session> {
        self.session(id, |state, id| {
            let info = state.session(id)?.clone();
            Some(abi::Session { info, status: status(state.status(id)) })
        })
    }

    fn family(&self, id: &str) -> abi::Family {
        self.session(id, |state, id| {
            let jobs = state.jobs(id);
            abi::Family {
                members: state
                    .family(id)
                    .iter()
                    .filter_map(|member| state.session(member))
                    .map(|info| abi::Member {
                        id: info.id.0.clone(),
                        parent: info.parent_id.as_ref().map(|parent| parent.0.clone()),
                        status: status(state.status(&info.id)),
                        updated: info.time.updated,
                        jobs: state.owned_jobs(&jobs, &info.id).len(),
                    })
                    .collect(),
                cost: state.cost(id),
                shells: state.session_shells(id).len(),
                scripts: jobs.iter().filter(|job| is_script(job, id)).count(),
            }
        })
    }

    fn sessions(&self) -> Vec<abi::Session> {
        self.tui.data.read(|state| {
            let sessions = state.sessions().into_iter();
            sessions.map(|info| abi::Session { info: info.clone(), status: status(state.status(&info.id)) }).collect()
        })
    }

    fn messages(&self, id: &str, visit: &mut dyn FnMut(&[SessionMessageInfo])) {
        // The store's reads nest, so `visit` may read again.
        self.session(id, |state, id| visit(state.messages(id)));
    }

    fn pending(&self, id: &str) -> Vec<abi::types::SessionInboxInfo> {
        self.session(id, |state, id| state.pending(id).to_vec())
    }

    fn models(&self, location: Option<&abi::LocationRef>) -> Option<Vec<ModelInfo>> {
        self.catalog(location, Catalog::Model, |data| data.model.clone())
    }

    fn model(&self) -> Option<ModelRef> {
        let selection = self.tui.local.selection()?;
        Some(ModelRef {
            id: selection.model.model_id,
            provider_id: ProviderID(selection.model.provider_id),
            variant: selection.variant,
        })
    }

    fn limits(&self) -> Option<UsageLimitsInfo> {
        self.tui.local.usage().flatten()
    }

    fn providers(&self) -> Option<Vec<ProviderInfo>> {
        self.catalog(None, Catalog::Provider, |data| data.provider.clone())
    }

    fn info(&self) -> abi::Info {
        let location = self.location(None);
        let failed =
            self.tui.plugins.entries().iter().filter(|entry| matches!(entry.status, Status::Failed(_))).count();
        abi::Info {
            version: self.tui.startup.args.version.clone(),
            size: self.tui.app.size(),
            location: abi::LocationRef { directory: location.directory, workspace: location.workspace_id },
            failed_plugins: failed + server_failed(&self.tui.reads.server.borrow().1),
            locale: opencode_plugin::facts::locale(),
        }
    }

    fn mcp_servers(&self, location: Option<&abi::LocationRef>) -> Option<Vec<McpServer>> {
        self.catalog(location, Catalog::McpServer, |data| data.mcp_server.clone())
    }

    fn integrations(&self, location: Option<&abi::LocationRef>) -> Option<Vec<IntegrationInfo>> {
        self.catalog(location, Catalog::Integration, |data| data.integration.clone())
    }

    fn vcs(&self, location: Option<&abi::LocationRef>) -> Option<VcsInfo> {
        self.catalog(location, Catalog::Vcs, |data| data.vcs.clone())
    }

    fn route(&self) -> abi::Route {
        match self.tui.route() {
            Route::Home => abi::Route::Home,
            Route::Session { id } => abi::Route::Session { id: id.0 },
            Route::Plugin { id, name } => abi::Route::Plugin { id, name },
        }
    }

    fn interactive(&self) -> bool {
        crate::frame::session_interactive(self.tui)
    }

    fn shortcut(&self, name: &str) -> Option<String> {
        self.tui.keymap.shortcut(name)
    }

    fn composer(&self) -> Option<abi::Composer> {
        let prompt = self.tui.prompt.current.borrow().upgrade().filter(|prompt| prompt.shown())?;
        let text = prompt.textarea.text();
        // The buffer converts the cursor's cells to a byte with its own widths: a tab takes the tab width.
        let cursor = opencode_ui::prompt_input::index_at(&prompt.textarea, prompt.textarea.cursor_offset());
        Some(abi::Composer { text, cursor, focused: prompt.focused() })
    }

    fn variants(&self) -> Vec<String> {
        self.tui.local.variants()
    }

    fn tabs_enabled(&self) -> bool {
        crate::tabs::Tabs::enabled(self.tui)
    }

    fn tabs(&self) -> Vec<abi::Tab> {
        let tabs = &self.tui.tabs;
        let current = tabs.current(self.tui);
        tabs.tabs(self.tui)
            .into_iter()
            .map(|tab| {
                let status = tabs.status(self.tui, &tab.session_id);
                abi::Tab {
                    active: current.as_deref() == Some(tab.session_id.as_str()),
                    busy: status.busy,
                    attention: status.attention.is_some(),
                    unread: status.unread.map(|unread| match unread {
                        crate::tabs::model::Unread::Activity => abi::Unread::Activity,
                        crate::tabs::model::Unread::Error => abi::Unread::Error,
                    }),
                    session_id: tab.session_id,
                    title: tab.title,
                }
            })
            .collect()
    }

    fn keymap_pending(&self) -> Vec<abi::KeymapPending> {
        let pending = self.tui.keymap.pending().into_iter();
        pending.map(|pending| abi::KeymapPending { key: pending.key, token: pending.token }).collect()
    }

    fn keymap_active(&self) -> Vec<abi::KeymapActive> {
        let active = self.tui.keymap.active().into_iter();
        active
            .map(|key| abi::KeymapActive {
                key: key.key,
                title: key.title,
                description: key.description,
                group: key.group,
                continues: key.continues,
            })
            .collect()
    }

    fn keymap_commands(&self) -> Vec<abi::KeymapCommand> {
        let commands = self.tui.keymap.commands().into_iter();
        commands
            .map(|command| abi::KeymapCommand {
                id: command.id,
                title: command.title,
                description: command.description,
                group: command.group,
                enabled: command.enabled,
                palette: command.palette,
                slash: command.slash.map(|slash| abi::KeymapSlash {
                    name: slash.name,
                    aliases: slash.aliases,
                    arguments: slash.arguments,
                }),
                suggested: command.suggested,
            })
            .collect()
    }

    fn shortcuts(&self, name: &str) -> Vec<String> {
        self.tui.keymap.shortcuts(name)
    }

    fn selection(&self) -> Option<String> {
        self.tui.app.selected_text()
    }

    fn theme(&self) -> Option<String> {
        Some(self.tui.theme.borrow().selected().to_owned())
    }

    fn themes(&self) -> Vec<String> {
        self.tui.theme.borrow().names()
    }

    fn plugins(&self) -> Vec<abi::PluginEntry> {
        self.tui.plugins.entries().into_iter().map(entry).collect()
    }

    fn setting(&self, name: &str) -> Option<Value> {
        let path = setting_path(name)?;
        let config = self.tui.settings.info().to_value();
        path.iter().try_fold(&config, |value, key| value.get(key)).filter(|value| !value.is_null()).cloned()
    }

    fn image_size(&self, bytes: &[u8]) -> Option<(u32, u32)> {
        opencode_plugin::surface::decoded_size(&self.tui.app, bytes)
    }

    fn utc_offset(&self, at: i64) -> i32 {
        opencode_plugin::facts::utc_offset(at)
    }

    fn measure(&self, text: &str) -> abi::Measure {
        opencode_plugin::facts::measure(&self.tui.app, text)
    }
}

/// The path in the TUI config of the plugins' setting `name` ([`abi::SETTINGS`]).
fn setting_path(name: &str) -> Option<Vec<&str>> {
    abi::SETTINGS.contains(&name).then(|| name.split('.').collect())
}

fn set_setting(tui: &Tui, name: &str, value: Value) {
    let Some(path) = setting_path(name) else {
        log::warn!("a plugin sets {name:?}, which is not one of the settings plugins set");
        return;
    };
    let mut candidate = Value::Object(Default::default());
    crate::dialogs::settings::set_path(&mut candidate, &path, value.clone());
    let decoded = opencode_local::cli_config::decode_text(&candidate.to_string()).map(|info| info.to_value());
    let taken = decoded.and_then(|decoded| path.iter().try_fold(decoded, |value, key| value.get(key).cloned()));
    if taken.as_ref() != Some(&value) {
        log::warn!("a plugin sets {name} to {value}, which the setting does not take");
        return;
    }
    let path: Vec<String> = path.into_iter().map(str::to_owned).collect();
    crate::dialogs::settings::update(tui, move |config| {
        let path: Vec<&str> = path.iter().map(String::as_str).collect();
        crate::dialogs::settings::set_path(config, &path, value);
    });
}

/// Omit error text from plugin-visible entries: it may contain another plugin's secrets.
fn entry(entry: opencode_plugin::Entry) -> abi::PluginEntry {
    let status = match entry.status {
        Status::Active => abi::PluginStatus::Active,
        Status::Inactive => abi::PluginStatus::Inactive,
        Status::Skipped(_) => abi::PluginStatus::Skipped,
        Status::Failed(_) => abi::PluginStatus::Failed,
        Status::Pending => abi::PluginStatus::Pending,
        Status::Declined => abi::PluginStatus::Declined,
    };
    abi::PluginEntry {
        key: entry.key,
        id: entry.id,
        target: entry.target,
        origin: match entry.source {
            opencode_plugin::Source::Builtin => abi::PluginOrigin::Builtin,
            opencode_plugin::Source::Added => abi::PluginOrigin::Added,
            opencode_plugin::Source::Configured => abi::PluginOrigin::Configured,
            opencode_plugin::Source::External => abi::PluginOrigin::External,
        },
        status,
        active: entry.active,
        slow: entry.slow,
    }
}

/// Tells the plugins that read the plugins ([`abi::Setup::on_plugins`]) that they changed, once the current event is
/// handled and only if what [`opencode_plugin::Registry::entries`] lists differs from what they heard last. While the
/// plugin manager has failed, the host's own `/plugins` stands in for it.
pub fn tell_plugins(tui: &Tui) {
    if tui.plugins.telling.replace(true) {
        return;
    }
    tui.app.defer(bind!(tui, |tui, _| {
        tui.plugins.telling.set(false);
        let entries: Vec<_> = tui
            .plugins
            .entries()
            .into_iter()
            .map(|entry| opencode_plugin::Entry { slow: entry.slow.map(|_| String::new()), ..entry })
            .collect();
        if *tui.plugins.told.borrow() == entries {
            return;
        }
        // Identify the active manager, not a held build sharing its ID.
        let manager = opencode_plugin::Entry::plugin_key(super::manager::ID);
        let failed = |entries: &[opencode_plugin::Entry]| {
            entries.iter().any(|entry| entry.key == manager && matches!(entry.status, Status::Failed(_)))
        };
        if failed(&entries) != tui.plugins.fallback.borrow().is_some() {
            let fallback = failed(&entries).then(|| super::fallback::activate(&tui));
            drop(tui.plugins.fallback.replace(fallback));
        }
        *tui.plugins.told.borrow_mut() = entries;
        tui.plugins.tell_plugins();
    }));
}

/// The dialog keys of the host's question about a project plugin, and of its own `/plugins`. A plugin's dialog key is
/// `<plugin>/<key>`, so no plugin names one without a `/`.
pub(super) const APPROVAL: &str = "host.approval";
pub(super) const FALLBACK: &str = "host.plugins";

/// Block plugin navigation and dialogs while the host approval question or fallback manager is visible.
fn guarded(tui: &Tui, id: &str, what: &str) -> bool {
    let guarded = matches!(tui.dialogs.key().as_deref(), Some(APPROVAL | FALLBACK));
    if guarded {
        log::warn!("plugin {id}: its {what} is dropped while the host's own dialog is open");
    }
    guarded
}

pub(super) fn fallback_shown(tui: &Tui) -> bool {
    tui.plugins.fallback.borrow().is_some()
}

/// Tells the mounted claims that the TUI's own state the plugins read changed ([`abi::Changed::local`]), such as the
/// session tabs, once the current event is handled.
pub fn local_changed(tui: &Tui) {
    tui.reads.changed(tui);
}

fn status(status: opencode_store::SessionStatus) -> abi::SessionStatus {
    match status {
        opencode_store::SessionStatus::Idle => abi::SessionStatus::Idle,
        opencode_store::SessionStatus::Running => abi::SessionStatus::Running,
    }
}

/// Register built-ins in palette order, including the renderers supplied through [`crate::Deps::builtins`].
fn builtins(external: Vec<Builtin>) -> Vec<Builtin> {
    let mut builtins = vec![
        super::home_footer::plugin().into(),
        super::prompt_footer::plugin().into(),
        super::btw::plugin().into(),
        super::sidebar_context::plugin().into(),
        super::sidebar_limit::plugin().into(),
        super::sidebar_mcp::plugin().into(),
        super::sidebar_todo::plugin().into(),
        super::sidebar_footer::plugin().into(),
        crate::plugins::notifications::plugin().into(),
        super::manager::plugin().into(),
        super::stats::plugin().into(),
    ];
    builtins.extend(external);
    builtins.push(super::diffs::plugin().into());
    builtins
}

/// The registry of the built-ins and the `plugins` config, not yet active.
pub fn registry(info: &opencode_local::cli_config::Info, external: Vec<Builtin>) -> Plugins {
    let targets = info.plugins.iter().flatten().map(target);
    Plugins {
        registry: Registry::new(builtins(external), targets),
        loader: RefCell::default(),
        #[cfg(feature = "ts")]
        scripts: RefCell::default(),
        told: RefCell::default(),
        telling: Cell::new(false),
        fallback: RefCell::default(),
        server_parts: RefCell::default(),
        told_skipped: RefCell::default(),
        heard_server: Cell::new(false),
    }
}

fn target(plugin: &opencode_local::cli_config::Plugin) -> &str {
    match plugin {
        opencode_local::cli_config::Plugin::Name(name) => name,
        opencode_local::cli_config::Plugin::Package { package, .. } => package,
    }
}

pub fn host(tui: &Rc<Tui>) -> Rc<dyn Host> {
    tui.clone()
}

/// Activates the plugins once the TUI is built.
pub fn install(tui: &Rc<Tui>) {
    let weak = tui.weak();
    tui.plugins.monitor().set_frames(move || weak.upgrade().map_or(0, |tui| tui.app.frame_number()));
    tui.plugins.activate(&host(tui));
    tell_plugins(tui);
    // Notify plugin keymap readers when pending keys, layers, or focus change.
    let keymap = tui.keymap.keymap().on_state(bind!(tui, |tui| local_changed(&tui)));
    tui.layers.borrow_mut().push(keymap);
    crate::features::events::subscribe(tui, ["plugin.updated", "server.connected"], |tui, event| {
        if matches!(event, V2Event::PluginUpdated(_) | V2Event::ServerConnected(_)) {
            sync_server_plugins(tui);
        }
    })
    .forget();
    sync_server_plugins(tui);
}

/// Reads the server plugins again once the default location changed.
pub fn sync(tui: &Tui) {
    let default = tui.data.read(|state| state.default_location().clone());
    if tui.reads.server.borrow().0.as_ref() != Some(&default) {
        sync_server_plugins(tui);
    }
}

fn sync_server_plugins(tui: &Tui) {
    let location = tui.data.read(|state| state.default_location().clone());
    let input = PluginListInput { location: Some(LocationQueryInput { directory: Some(location.directory.clone()) }) };
    tui.reads.server.borrow_mut().0 = Some(location);
    let client = tui.data.client().clone();
    tui.app.spawn(
        async move { client.plugin_list(&input).await },
        bind!(tui, |tui, _, result| {
            let Ok(output) = result else {
                tui.plugins.heard_server.set(true);
                return tell_skipped(&tui);
            };
            set_server_parts(&tui, &output.data);
            tui.plugins.heard_server.set(true);
            tell_skipped(&tui);
            let before = std::mem::replace(&mut tui.reads.server.borrow_mut().1, output.data.clone());
            let failed: Vec<String> = output
                .data
                .iter()
                .filter(|plugin| matches!(plugin.state, PluginState::Failed(_)))
                .filter(|plugin| {
                    !before
                        .iter()
                        .any(|previous| server_name(previous) == server_name(plugin) && previous.state == plugin.state)
                })
                .map(server_name)
                .collect();
            if server_failed(&before) != server_failed(&output.data) {
                tui.reads.changed(&tui);
            }
            match failed.as_slice() {
                [] => {}
                [name] => failed_toast(&tui, format!("Plugin failed: {name}"), String::new()),
                names => {
                    failed_toast(&tui, format!("{} plugins failed", names.len()), format!("{}\n", names.join(", ")))
                }
            }
        }),
    );
}

/// Reconcile TUI entries supplied by the active server plugins.
fn set_server_parts(tui: &Rc<Tui>, plugins: &[PluginInfo]) {
    let Some(loader) = tui.plugins.loader.borrow().clone() else { return };
    let here = same_machine(tui.startup.args.local, tui.data.client().base_url());
    let typed: Vec<ServerPart> = plugins
        .iter()
        .filter(|plugin| matches!(plugin.state, PluginState::Active(_)) && plugin.features.tui == Some(true))
        .filter_map(|plugin| {
            let id = plugin.id.as_ref().map(|id| id.0.clone());
            match &plugin.source {
                PluginSource::Package(package) => Some(ServerPart::Package { spec: package.target.clone(), id }),
                PluginSource::Local(local) if here => Some(ServerPart::Local { path: local.path.clone(), id }),
                _ => None,
            }
        })
        .collect();
    let parts: Vec<String> = typed
        .iter()
        .map(|part| match part {
            ServerPart::Package { spec: target, .. } | ServerPart::Local { path: target, .. } => target.clone(),
        })
        .collect();
    if js_host(tui) {
        tui.plugins.server_parts.replace(parts);
        if loader.set_server(typed, user_plugins(tui, loader.config_dir())) {
            loader.reconcile(&host(tui), &tui.plugins);
            tell_plugins(tui);
        }
        return;
    }
    let skipped = Status::Skipped(opencode_plugin::SKIPPED_OFF.to_owned());
    let before = tui.plugins.server_parts.replace(parts.clone());
    let entries = tui.plugins.entries();
    let status = |target: &str| entries.iter().find(|entry| entry.target.as_deref() == Some(target)).map(|e| &e.status);
    let mut changed = false;
    for gone in before.iter().filter(|target| !parts.contains(target)) {
        if status(gone) == Some(&skipped) {
            tui.plugins.set_unloaded(gone, None);
            changed = true;
        }
    }
    for part in parts.iter().filter(|target| status(target).is_none()) {
        log::warn!("plugin {part} skipped: {}", opencode_plugin::SKIPPED_OFF);
        tui.plugins.set_unloaded(part, Some(skipped.clone()));
        changed = true;
    }
    if changed {
        tell_plugins(tui);
    }
}

/// Report each skipped plugin once per run, grouped by reason: TypeScript plugins, unless a library or a Luau plugin is
/// among them, which a build without its carrier skips.
fn tell_skipped(tui: &Tui) {
    if !tui.plugins.heard_server.get() || tui.plugins.loader.borrow().is_none() {
        return;
    }
    let mut told = tui.plugins.told_skipped.borrow_mut();
    let mut reasons: Vec<(String, Vec<String>)> = Vec::new();
    for entry in tui.plugins.entries() {
        let Status::Skipped(reason) = &entry.status else { continue };
        let starting = reason == opencode_plugin::loader::STARTING;
        #[cfg(luau)]
        let starting = starting || reason == opencode_plugin::luau::STARTING;
        if !entry.key.starts_with("target:") || starting || !told.insert(entry.key) {
            continue;
        }
        match reasons.iter_mut().find(|(known, _)| known == reason) {
            Some((_, names)) => names.push(entry.id),
            None => reasons.push((reason.clone(), vec![entry.id])),
        }
    }
    drop(told);
    let count: usize = reasons.iter().map(|(_, names)| names.len()).sum();
    if count == 0 {
        return;
    }
    let lines: Vec<String> = reasons.iter().map(|(reason, names)| format!("{}: {reason}.", names.join(", "))).collect();
    let other = [opencode_plugin::SKIPPED_NATIVE, opencode_plugin::SKIPPED_NO_LUAU];
    let kind = match reasons.iter().any(|(reason, _)| other.contains(&reason.as_str())) {
        true => "",
        false => "TypeScript ",
    };
    let title = match count {
        1 => format!("1 {kind}plugin not loaded"),
        count => format!("{count} {kind}plugins not loaded"),
    };
    let options = ToastOptions::new(Variant::Warning, format!("{}\nRun /plugins to view details.", lines.join("\n")))
        .title(title)
        .keep()
        .action(
            "Open plugins",
            bind!(tui, |tui| {
                tui.keymap.dispatch("plugins.list", None);
            }),
        );
    tui.toasts.show(options);
}

/// Trust server filesystem paths only for a local server.
fn same_machine(local: bool, url: &url::Url) -> bool {
    local
        || match url.host() {
            Some(url::Host::Domain(domain)) => domain.eq_ignore_ascii_case("localhost"),
            Some(url::Host::Ipv4(address)) => address.is_loopback(),
            Some(url::Host::Ipv6(address)) => address.is_loopback(),
            None => false,
        }
}

/// Apply global config entries and removals in configuration order.
fn user_plugins(tui: &Tui, config_dir: &Path) -> Vec<String> {
    let global = ["opencode.json", "opencode.jsonc"]
        .iter()
        .filter_map(|name| std::fs::read_to_string(config_dir.join(name)).ok())
        .filter_map(|text| opencode_local::jsonc::parse(&text))
        .flat_map(|config| match config.get("plugins") {
            Some(Value::Array(entries)) => entries.clone(),
            _ => Vec::new(),
        })
        .filter_map(|entry| match entry {
            Value::String(spec) => Some(spec),
            Value::Object(entry) => entry.get("package").and_then(Value::as_str).map(str::to_owned),
            _ => None,
        });
    let cli = tui.config().info.plugins.clone().unwrap_or_default().into_iter().map(|plugin| match plugin {
        opencode_local::cli_config::Plugin::Name(name) => name,
        opencode_local::cli_config::Plugin::Package { package, .. } => package,
    });
    global.chain(cli).collect()
}

fn server_failed(plugins: &[PluginInfo]) -> usize {
    plugins.iter().filter(|plugin| matches!(plugin.state, PluginState::Failed(_))).count()
}

fn server_name(plugin: &PluginInfo) -> String {
    if let Some(id) = &plugin.id {
        return id.0.clone();
    }
    match &plugin.source {
        PluginSource::Package(package) => package.target.clone(),
        PluginSource::Local(local) => local.path.clone(),
        PluginSource::Builtin(source) => source.r#type.clone(),
        PluginSource::Sdk(source) => source.r#type.clone(),
        PluginSource::Unknown(value) => value.get("type").and_then(Value::as_str).unwrap_or_default().to_owned(),
    }
}

/// The toast that a project's plugin `target` waits for approval, saying `message`.
fn pending_toast(tui: &Tui, target: &str, message: &str) {
    let mut options = ToastOptions::new(Variant::Warning, message).keep();
    options.title = Some(format!("Plugin needs approval: {target}"));
    let open = bind!(tui, |tui| {
        tui.keymap.dispatch("plugins.list", None);
    });
    tui.toasts.show(options.action("Open plugins", open));
}

pub struct External {
    pub config_dir: PathBuf,
    pub cwd: PathBuf,
}

struct PluginsChanged;

/// How the JS host runs ([`external_with`]): `opencode_plugin::pipe::Config` in a build with the `ts` feature; in one
/// without it, nothing can be made, so only `None` is passed (ts-feature).
#[cfg(feature = "ts")]
pub type JsHost = opencode_plugin::pipe::Config;
/// How the JS host runs ([`external_with`]): in a build without the `ts` feature there is none (ts-feature).
#[cfg(not(feature = "ts"))]
pub enum JsHost {}

/// Whether this client can run JavaScript plugins.
fn js_host(tui: &Tui) -> bool {
    #[cfg(feature = "ts")]
    return tui.plugins.scripts.borrow().is_some();
    #[cfg(not(feature = "ts"))]
    return {
        let _ = tui;
        false
    };
}

#[cfg(not(feature = "ts"))]
pub fn external(tui: &Rc<Tui>, external: External) {
    external_with(tui, external, None);
}

#[cfg(feature = "ts")]
pub fn external(tui: &Rc<Tui>, external: External) {
    let args = &tui.startup.args;
    let server = match args.local {
        true => opencode_plugin::pipe::Server::Local(args.server_executable.clone()),
        false => opencode_plugin::pipe::Server::Remote,
    };
    let scripts = opencode_plugin::pipe::Config::from_env(&server).map(|config| opencode_plugin::pipe::Config {
        version: crate::dialogs::debug::VERSION.to_owned(),
        channel: opencode_local::channel::Channels::from_env().channel,
        ..config
    });
    external_with(tui, external, scripts);
}

/// Load external plugins using the given JS host configuration. Without a host, list TypeScript plugins as skipped.
pub fn external_with(tui: &Rc<Tui>, external: External, scripts: Option<JsHost>) {
    let entries = configured(tui, tui.plugins.skipped());
    let project = opencode_plugin::loader::project_root(&external.cwd);
    let loader = Loader::new(external.config_dir, external.cwd, entries);
    #[cfg(luau)]
    let loader = match opencode_plugin::luau::enabled() {
        true => {
            let proxy = tui.app.proxy();
            loader.with_luau(move || {
                let _ = proxy.send(PluginsChanged);
            })
        }
        false => loader,
    };
    let loader = match tui.cache_dir() {
        Some(cache) => loader.with_npm(cache),
        None => loader,
    };
    // Without real roots the decisions last as long as the TUI.
    let loader = match tui.state_dir() {
        Some(state) => loader.with_approvals(Approvals::open(state.join(approval::FILE), &project)),
        None => loader,
    };
    #[cfg(feature = "ts")]
    let loader = {
        let scripts = scripts.map(|config| opencode_plugin::pipe::Scripts::new(config, &host(tui)));
        let loader = Rc::new(match &scripts {
            Some(scripts) => loader.with_scripts(scripts.clone()),
            None => loader,
        });
        if let Some(scripts) = &scripts {
            let proxy = tui.app.proxy();
            scripts.on_reconcile(Rc::new(move || {
                let _ = proxy.send(PluginsChanged);
            }));
            *tui.plugins.scripts.borrow_mut() = Some(scripts.clone());
        }
        loader
    };
    #[cfg(not(feature = "ts"))]
    let loader = match scripts {
        None => Rc::new(loader),
        Some(none) => match none {},
    };
    tui.plugins.set_loader(loader.clone());
    loader.reconcile(&host(tui), &tui.plugins);
    let watches: Rc<RefCell<Vec<Watched>>> = Rc::default();
    watch(tui, &loader, &watches);
    tui.app.on_message({
        let (loader, watches) = (loader.clone(), watches.clone());
        bind!(tui, |tui, _, _: &PluginsChanged| {
            loader.reconcile(&host(&tui), &tui.plugins);
            watch(&tui, &loader, &watches);
            tell_skipped(&tui);
        })
    });
    let plugins = RefCell::new(tui.config().info.plugins.clone());
    tui.settings.on_change(bind!(tui, |tui, _| {
        let current = tui.config().info.plugins.clone();
        if *plugins.borrow() == current {
            return;
        }
        let host = host(&tui);
        let targets = tui.plugins.set_targets(&host, current.iter().flatten().map(target));
        plugins.replace(current);
        loader.set_configured(configured(&tui, targets));
        loader.set_user(user_plugins(&tui, loader.config_dir()));
        loader.reconcile(&host, &tui.plugins);
        watch(&tui, &loader, &watches);
        tell_plugins(&tui);
        tell_skipped(&tui);
    }));
    // Server entries can arrive before the loader starts.
    let server = tui.reads.server.borrow().1.clone();
    set_server_parts(tui, &server);
    tell_skipped(tui);
}

/// The build of the project plugin of `target` the user would be asked about, or why it cannot be read, and why
/// decisions are not saved, if they are not (rich-plugins 3.9).
pub fn held(tui: &Tui, target: &str) -> Option<(Result<Artifact, String>, Option<String>)> {
    let loader = tui.plugins.loader.borrow().clone()?;
    Some((loader.held(target)?, loader.unsaved()))
}

/// Reconcile external plugins against the current contents of their directories.
pub fn reconcile(tui: &Rc<Tui>) {
    let loader = tui.plugins.loader.borrow().clone();
    if let Some(loader) = loader {
        loader.reconcile(&host(tui), &tui.plugins);
    }
}

/// Recheck the on-disk artifact before applying the user's decision about a build.
pub fn decide(
    tui: &Rc<Tui>,
    target: &str,
    artifact: &Artifact,
    decision: Decision,
    done: impl FnOnce(&Rc<Tui>, Result<bool, String>) + 'static,
) {
    let Some(loader) = tui.plugins.loader.borrow().clone() else { return done(tui, Ok(false)) };
    let found = loader.found(target);
    let answer = loader.deciding(target);
    let (target, artifact) = (target.to_owned(), artifact.clone());
    let record = move |tui: &Rc<Tui>, now: Option<Result<Artifact, String>>| {
        if loader.superseded(&target, answer) {
            return;
        }
        let recorded = loader.decide(&target, &artifact, decision, now);
        if recorded == Ok(true) {
            loader.reconcile(&host(tui), &tui.plugins);
            tell_plugins(tui);
        }
        done(tui, recorded);
    };
    if !found.as_ref().is_some_and(opencode_plugin::loader::Found::walks) {
        return record(tui, found.map(opencode_plugin::loader::Found::identify));
    }
    let Some(found) = found else { return };
    let weak = tui.weak();
    tui.app.spawn(async move { tokio::task::spawn_blocking(move || found.identify()).await.ok() }, move |_, now| {
        if let Some(tui) = weak.upgrade() {
            record(&tui, now);
        }
    });
}

fn configured(tui: &Tui, targets: Vec<String>) -> Vec<Configured> {
    let options = |target: &str| {
        tui.config().info.plugins.iter().flatten().find_map(|plugin| match plugin {
            opencode_local::cli_config::Plugin::Package { package, options: Some(options) } if package == target => {
                Some(serde_json::Value::Object(options.clone()).to_string())
            }
            _ => None,
        })
    };
    targets.into_iter().map(|target| Configured { options: options(&target), target }).collect()
}

type Watched<W = opencode_local::watch::Watch> = (PathBuf, Option<u64>, W);

fn watch(tui: &Tui, loader: &Loader, watches: &RefCell<Vec<Watched>>) {
    let fresh = unwatched(&mut watches.borrow_mut(), loader.watch_dirs());
    for (dir, id) in fresh {
        let proxy = tui.app.proxy();
        let watch = opencode_local::watch::watch(
            &dir,
            |_| true,
            Duration::from_millis(100),
            move || {
                let _ = proxy.send(PluginsChanged);
            },
        );
        if let Some(watch) = watch {
            watches.borrow_mut().push((dir, id, watch));
        }
    }
}

/// Drops the watches of directories that are no longer in `dirs` or are not the directory they watched, and
/// returns the directories to watch, with their identity.
fn unwatched<W>(watches: &mut Vec<Watched<W>>, dirs: Vec<PathBuf>) -> Vec<(PathBuf, Option<u64>)> {
    let dirs: Vec<(PathBuf, Option<u64>)> = dirs
        .into_iter()
        .map(|dir| {
            let id = identity(&dir);
            (dir, id)
        })
        .collect();
    watches.retain(|(known, id, _)| dirs.iter().any(|(dir, current)| dir == known && current == id));
    dirs.into_iter().filter(|(dir, _)| !watches.iter().any(|(known, _, _)| known == dir)).collect()
}

#[cfg(unix)]
fn identity(dir: &std::path::Path) -> Option<u64> {
    use std::os::unix::fs::MetadataExt;
    std::fs::metadata(dir).ok().map(|metadata| metadata.ino())
}

#[cfg(windows)]
fn identity(dir: &std::path::Path) -> Option<u64> {
    opencode_util::win::file_index(dir).ok()
}

/// Adds and activates one more plugin, then remounts the route so its claims show.
pub fn add(tui: &Rc<Tui>, plugin: Definition) {
    tui.plugins.add(plugin);
    tui.plugins.activate(&host(tui));
    tui.navigate(tui.route());
    tell_plugins(tui);
}

pub fn slot(tui: &Tui, parent: &View, path: &str, input: &SlotInput, content: impl FnOnce(&View)) -> SlotMount {
    tui.plugins.mount(tui, parent, path, input, content)
}

pub fn route(tui: &Tui, id: &str, name: &str) -> Option<RouteMount> {
    tui.plugins.route(tui, id, name)
}

pub fn code_blocks(tui: &Tui) -> CodeBlockRenderers {
    let (weak, last) = (tui.weak(), tui.page());
    tui.plugins.code_blocks(Rc::new(move || weak.upgrade().map_or_else(|| last.clone(), |tui| tui.page())))
}

pub fn tool_claims(tui: &Tui) -> opencode_plugin::claim::ToolClaims {
    tui.plugins.tool_claims()
}

/// An empty [`abi::Node::Markdown`] widget: Markdown in the page theme with the plugins' fences, markers hidden unless
/// `session.markdown` is `source`.
pub fn markdown(tui: &Tui) -> opentui::widget::Markdown {
    markdown_with(tui, &code_blocks(tui))
}

pub fn markdown_with(tui: &Tui, renderers: &CodeBlockRenderers) -> opentui::widget::Markdown {
    let page = tui.page();
    let conceal = tui.config().info.session.as_ref().and_then(|session| session.markdown)
        != Some(opencode_local::cli_config::Markdown::Source);
    let syntax = opencode_ui::code::syntax_theme(&page);
    opencode_ui::markdown::view(&tui.app, &page, &syntax, renderers, conceal, false)
}

/// A Code Mode script the session itself runs (the prompt footer's and the Scripts tab's count).
pub(crate) fn is_script(job: &opencode_api::generated::JobInfo, session: &SessionID) -> bool {
    matches!(job, opencode_api::generated::JobInfo::Codemode(_)) && job.session_id() == session.0
}

#[cfg(test)]
mod tests {
    use super::*;

    // Expected: a plugin installs a theme only under a plain file name in the themes directory.
    #[test]
    fn an_installed_theme_has_a_plain_file_name() {
        for (name, plain) in [
            ("nord-2", true),
            ("my_theme.v2", true),
            ("", false),
            (".hidden", false),
            ("../escape", false),
            ("a/b", false),
            ("a\\b", false),
            ("tôkyo", false),
        ] {
            assert_eq!(opencode_plugin::theme_file_name(name), plain, "{name:?}");
        }
    }

    #[test]
    fn a_directory_made_again_is_watched_again() {
        let root = opencode_util::temp::tempdir().unwrap();
        let (a, b) = (root.path().join("a"), root.path().join("b"));
        std::fs::create_dir(&a).unwrap();
        std::fs::create_dir(&b).unwrap();
        let mut watches: Vec<Watched<()>> = Vec::new();
        let fresh = unwatched(&mut watches, vec![a.clone(), b.clone()]);
        watches.extend(fresh.into_iter().map(|(dir, id)| (dir, id, ())));
        assert!(unwatched(&mut watches, vec![a.clone(), b.clone()]).is_empty());
        // Keep the old directory alive under another name, so the new one cannot reuse its inode.
        std::fs::rename(&a, root.path().join("old")).unwrap();
        std::fs::create_dir(&a).unwrap();
        let fresh = unwatched(&mut watches, vec![a.clone()]);
        assert_eq!(fresh.iter().map(|(dir, _)| dir).collect::<Vec<_>>(), [&a]);
        assert!(watches.is_empty());
    }
}
