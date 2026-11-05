//! Plugin manager dialog (E.18b): `packages/tui/src/feature-plugins/system/plugins.tsx`, the built-in plugin
//! `opencode.plugins` with `plugins.list` (`/plugins`).
//!
//! TUI rows come from the plugin registry (`Registry::entries`): built-ins are internal and hidden until
//! `ctrl+a`; a configured TypeScript plugin is listed as `skipped` with the reason as its error (F16), and an
//! external WASM plugin that failed to load or crashed as `failed` with its error (P.4). Server rows
//! come from `GET /api/plugin`. Enter toggles a TUI plugin through `Registry::set_active`, then the route mounts
//! again so slots follow; on another row it opens the error, if any.

use std::cell::{Cell, RefCell};
use std::cmp::Ordering;
use std::rc::{Rc, Weak};

use opencode_api::client::RequestOptions;
use opencode_api::generated::{
    LocationQueryInput, PluginCheckInput, PluginInfo, PluginListInput, PluginSource, PluginState,
    PluginUpdateInput, V2Event,
};
use opencode_plugin::{Definition, Setup, Source, Status};
use opencode_ui::dialog::{DialogOptions, DialogSize};
use opencode_ui::keymap::{Bind, GLOBAL_MODE, KeymapLayer, Slash, TuiCommand};
use opencode_ui::motion::Spinner;
use opencode_ui::select::{
    ActionRun, FooterHint, Group, Select, SelectAction, SelectOption, SelectProps, select,
};
use opencode_ui::theme::Theme;
use opentui::prelude::*;

use super::error_details;
use crate::app::Tui;

pub const ID: &str = "opencode.plugins";

/// The built-in: `plugins.list` in the global layer.
pub fn plugin() -> Definition<Tui> {
    Definition::new(ID, |setup: &mut Setup<'_, Tui>| {
        let weak = setup.host().weak();
        setup.layer(KeymapLayer {
            mode: Some(GLOBAL_MODE.to_owned()),
            commands: vec![
                TuiCommand::new("plugins.list", move |_, _| {
                    if let Some(tui) = weak.upgrade() {
                        show(&tui);
                    }
                })
                .bind(Bind::Default)
                .title("Plugins")
                .group("System")
                .palette()
                .slash(Slash {
                    name: "plugins".to_owned(),
                    aliases: Vec::new(),
                    arguments: false,
                }),
            ],
            ..KeymapLayer::default()
        });
    })
}

/// `PluginsDialog`, in place of any open dialog.
pub fn show(tui: &Tui) {
    let manager = Rc::new(Manager {
        tui: tui.weak(),
        directory: tui
            .data
            .read(|state| state.default_location().directory.clone()),
        server: RefCell::new(None),
        locked: Cell::new(false),
        checking: Cell::new(false),
        show_internal: Cell::new(false),
        pending: RefCell::new(Vec::new()),
        select: RefCell::new(None),
        open: Cell::new(false),
    });
    manager.open(None);
    manager.refetch();
    manager.follow();
}

#[derive(Clone)]
enum Entry {
    Tui {
        key: String,
        internal: bool,
        /// `None` for an entry that never loaded, which cannot be toggled.
        id: Option<String>,
        target: String,
        status: &'static str,
        error: Option<String>,
    },
    Server {
        key: String,
        internal: bool,
        /// `source(plugin)`, formatted against the location.
        source: String,
        plugin: PluginInfo,
    },
}

struct Manager {
    tui: Weak<Tui>,
    /// `context.location ?? data.location.default()`.
    directory: String,
    server: RefCell<Option<Vec<PluginInfo>>>,
    locked: Cell<bool>,
    checking: Cell<bool>,
    show_internal: Cell<bool>,
    /// Keys of server plugins with an update in flight.
    pending: RefCell<Vec<String>>,
    select: RefCell<Option<Select<String>>>,
    /// The list (not the error view) is on screen.
    open: Cell<bool>,
}

impl Manager {
    fn location(&self) -> Option<LocationQueryInput> {
        Some(LocationQueryInput {
            directory: Some(self.directory.clone()),
        })
    }

    /// Builds the list, focused on `focus` when given (back from an error).
    fn open(self: &Rc<Self>, focus: Option<String>) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        let manager = self.clone();
        tui.dialogs.replace(
            move |cx| {
                let weak = Rc::downgrade(&manager);
                let mut props = SelectProps::new("Plugins", manager.options(&cx.theme));
                props.preserve_selection = true;
                props.locked = manager.locked.get();
                props.focus_target = focus;
                props.bindings = vec![
                    TuiCommand::inline("ctrl+a", {
                        let weak = weak.clone();
                        move |_, _| {
                            if let Some(manager) = weak.upgrade() {
                                manager.show_internal.set(!manager.show_internal.get());
                                manager.refresh();
                            }
                        }
                    })
                    .title("Toggle internal plugins")
                    .group("Plugins"),
                ];
                props.dynamic_hints = Some(Rc::new({
                    let weak = weak.clone();
                    move || {
                        let Some(manager) = weak.upgrade() else {
                            return Vec::new();
                        };
                        let focused = manager.focused();
                        let mut hints = Vec::new();
                        if focused.as_ref().and_then(error).is_some()
                            && manager.toggleable(focused.as_ref()).is_none()
                        {
                            hints.push(FooterHint {
                                title: "view error".to_owned(),
                                label: "enter".to_owned(),
                                group: Some(Group::Primary),
                            });
                        }
                        let internal = if manager.show_internal.get() {
                            "hide"
                        } else {
                            "show"
                        };
                        hints.push(FooterHint {
                            title: format!("{internal} internal"),
                            label: "ctrl+a".to_owned(),
                            group: None,
                        });
                        hints
                    }
                }));
                props.on_select = Some(Rc::new({
                    let weak = weak.clone();
                    move |option| {
                        let Some(manager) = weak.upgrade() else {
                            return;
                        };
                        let entry = manager.entry(&option.value);
                        if manager.toggleable(entry.as_ref()).is_some() {
                            manager.toggle(entry.as_ref());
                            return;
                        }
                        if let Some(entry) = entry.filter(|entry| error(entry).is_some()) {
                            manager.detail(entry);
                        }
                    }
                }));
                props.actions = manager.actions();
                let (view, handle) = select(cx, props);
                *manager.select.borrow_mut() = Some(handle.clone());
                // The first footer was drawn before the hints could see the selection.
                handle.refresh_footer();
                manager.open.set(true);
                let closed = manager.clone();
                cx.on_close(opentui::keymap::Disposer::new(move || {
                    closed.open.set(false)
                }));
                view
            },
            None,
            DialogOptions {
                size: DialogSize::Large,
                ..DialogOptions::default()
            },
        );
    }

    fn actions(self: &Rc<Self>) -> Vec<SelectAction<String>> {
        let weak = Rc::downgrade(self);
        let with = |run: fn(&Rc<Manager>, Option<Entry>)| {
            let weak = weak.clone();
            move |option: &SelectOption<String>| {
                if let Some(manager) = weak.upgrade() {
                    let entry = manager.entry(&option.value);
                    run(&manager, entry);
                }
            }
        };
        let hidden = |test: fn(&Manager, Option<&Entry>) -> bool| {
            let weak = weak.clone();
            Rc::new(move |option: Option<&SelectOption<String>>| {
                weak.upgrade().is_none_or(|manager| {
                    let entry = option.and_then(|option| manager.entry(&option.value));
                    test(&manager, entry.as_ref())
                })
            })
        };
        vec![
            SelectAction {
                title: Rc::new({
                    let weak = weak.clone();
                    move |_| {
                        let checking = weak.upgrade().is_some_and(|manager| manager.checking.get());
                        if checking {
                            "checking for updates"
                        } else {
                            "check for updates"
                        }
                        .to_owned()
                    }
                }),
                hidden_when: Some(hidden(|manager, _| {
                    !manager
                        .entries()
                        .iter()
                        .any(|entry| package(entry).is_some())
                })),
                disabled: Some(Rc::new({
                    let weak = weak.clone();
                    move |_| weak.upgrade().is_some_and(|manager| manager.checking.get())
                })),
                run: ActionRun::Dialog(Rc::new({
                    let weak = weak.clone();
                    move || {
                        if let Some(manager) = weak.upgrade() {
                            manager.check();
                        }
                    }
                })),
                ..SelectAction::new("dialog.plugins.check", "check for updates", |_| {})
            },
            SelectAction {
                hidden_when: Some(hidden(|manager, entry| {
                    manager.toggleable(entry).and_then(error).is_none()
                })),
                ..SelectAction::new(
                    "dialog.plugins.error",
                    "view error",
                    with(|manager, entry| {
                        if let Some(entry) = entry.filter(|entry| error(entry).is_some()) {
                            manager.detail(entry);
                        }
                    }),
                )
            },
            SelectAction {
                title: Rc::new({
                    let weak = weak.clone();
                    move |option: Option<&SelectOption<String>>| {
                        let Some(manager) = weak.upgrade() else {
                            return "toggle".to_owned();
                        };
                        let entry = option.and_then(|option| manager.entry(&option.value));
                        match manager.toggleable(entry.as_ref()).map(Manager::active) {
                            Some(true) => "disable".to_owned(),
                            Some(false) => "enable".to_owned(),
                            None => "toggle".to_owned(),
                        }
                    }
                }),
                group: Some(Group::Primary),
                hidden_when: Some(hidden(|manager, entry| manager.toggleable(entry).is_none())),
                ..SelectAction::new(
                    "plugins.toggle",
                    "toggle",
                    with(|manager, entry| manager.toggle(entry.as_ref())),
                )
            },
            SelectAction {
                group: Some(Group::Primary),
                hidden_when: Some(hidden(|manager, entry| !manager.updatable(entry))),
                ..SelectAction::new(
                    "dialog.plugins.update",
                    "update",
                    with(|manager, entry| manager.update(entry)),
                )
            },
        ]
    }

    /// Every row: the TUI plugins, then the server plugins, each sorted by label.
    fn entries(&self) -> Vec<Entry> {
        let Some(tui) = self.tui.upgrade() else {
            return Vec::new();
        };
        let mut local: Vec<Entry> = tui
            .plugins
            .entries()
            .into_iter()
            .filter(|entry| entry.id != ID)
            .map(|entry| {
                let (status, error) = match &entry.status {
                    Status::Active => ("active", None),
                    Status::Inactive => ("inactive", None),
                    Status::Skipped(reason) => ("skipped", Some(reason.clone())),
                    Status::Failed(error) => ("failed", Some(error.clone())),
                };
                // Only a plugin with a definition can be toggled; an unloaded target cannot.
                let loaded = entry.source != Source::Configured;
                Entry::Tui {
                    key: format!("tui:{}", entry.target.as_ref().unwrap_or(&entry.id)),
                    internal: entry.source == Source::Builtin,
                    id: loaded.then(|| entry.id.clone()),
                    target: entry.target.unwrap_or(entry.id),
                    status,
                    error,
                }
            })
            .collect();
        // A package without a server part runs nothing there; its TUI part has its own row.
        let mut server: Vec<Entry> = self
            .server
            .borrow()
            .iter()
            .flatten()
            .filter(|plugin| {
                plugin.features.server == Some(true)
                    || matches!(plugin.state, PluginState::Failed(_))
            })
            .map(|plugin| {
                let source = source(plugin, &self.directory);
                Entry::Server {
                    key: format!("server:{}", plugin.id.as_ref().map_or(&source, |id| &id.0)),
                    internal: matches!(plugin.source, PluginSource::Builtin(_)),
                    source,
                    plugin: plugin.clone(),
                }
            })
            .collect();
        local.sort_by(|a, b| locale_compare(&label(a), &label(b)));
        server.sort_by(|a, b| locale_compare(&label(a), &label(b)));
        local.extend(server);
        local
    }

    fn visible(&self) -> Vec<Entry> {
        self.entries()
            .into_iter()
            .filter(|entry| {
                self.show_internal.get() || !internal(entry) || status(entry) == "failed"
            })
            .collect()
    }

    fn entry(&self, key: &str) -> Option<Entry> {
        self.entries()
            .into_iter()
            .find(|entry| self.key(entry) == key)
    }

    fn key(&self, entry: &Entry) -> String {
        match entry {
            Entry::Tui { key, .. } | Entry::Server { key, .. } => key.clone(),
        }
    }

    fn focused(&self) -> Option<Entry> {
        let selected = self.select.borrow().as_ref()?.selected()?;
        self.entry(&selected.value)
    }

    /// `focusedTui`: a TUI row with a plugin ID.
    fn toggleable<'a>(&self, entry: Option<&'a Entry>) -> Option<&'a Entry> {
        entry.filter(|entry| matches!(entry, Entry::Tui { id: Some(_), .. }))
    }

    fn active(entry: &Entry) -> bool {
        status(entry) == "active"
    }

    fn updating(&self, entry: &Entry) -> bool {
        self.pending.borrow().contains(&self.key(entry))
            || package(entry).is_some_and(|package| package.updating == Some(true))
    }

    fn updatable(&self, entry: Option<&Entry>) -> bool {
        entry.is_some_and(|entry| outdated(entry) && !self.updating(entry))
    }

    fn options(&self, theme: &Theme) -> Vec<SelectOption<String>> {
        self.visible()
            .into_iter()
            .map(|entry| {
                let mut option =
                    SelectOption::new(label(&entry), self.key(&entry)).category(match entry {
                        Entry::Tui { .. } => "TUI",
                        Entry::Server { .. } => "Server",
                    });
                option.search_text = Some(match &entry {
                    Entry::Tui { target, .. } => target.clone(),
                    Entry::Server { source, .. } => source.clone(),
                });
                let updating = self.updating(&entry);
                option.footer = if updating {
                    Some("updating".to_owned())
                } else {
                    footer(&entry)
                };
                let failed = status(&entry) == "failed";
                option.footer_color = Some(if failed {
                    theme.text.feedback.error.base
                } else if outdated(&entry) {
                    theme.text.feedback.info.base
                } else {
                    theme.text.muted
                });
                let error_color = theme.text.feedback.error.base;
                if updating {
                    option.gutter = Some(Rc::new(|app: &App, color: Color| {
                        Spinner::new(app).color(color).as_any()
                    }));
                } else if failed {
                    option.gutter = Some(Rc::new(move |app: &App, _: Color| {
                        Text::new(app, "x").fg(error_color).as_any()
                    }));
                }
                option
            })
            .collect()
    }

    /// Redraws the rows and the footer after the state changed.
    fn refresh(&self) {
        if !self.open.get() {
            return;
        }
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        let select = self.select.borrow().clone();
        if let Some(select) = select {
            select.set_options(self.options(&super::session_list::dialog_theme(&tui)));
        }
    }

    fn refetch(self: &Rc<Self>) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        let client = tui.data.client().clone();
        let input = PluginListInput {
            location: self.location(),
        };
        let weak = Rc::downgrade(self);
        tui.app.spawn(
            async move { client.plugin_list(&input, &RequestOptions::default()).await },
            move |_, result| {
                let Some(manager) = weak.upgrade() else {
                    return;
                };
                match result {
                    Ok(output) => {
                        *manager.server.borrow_mut() = Some(output.data);
                        manager.refresh();
                    }
                    Err(error) => log::warn!("plugin list: {error}"),
                }
            },
        );
    }

    /// Reads the server plugins again on `plugin.updated` while the dialog is open.
    fn follow(self: &Rc<Self>) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        let mut signals = tui.data.signals();
        let weak = Rc::downgrade(self);
        tui.app.spawn(
            async move {
                loop {
                    match signals.recv().await {
                        Ok(V2Event::PluginUpdated(_)) => return Some(signals),
                        Ok(_) | Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {}
                        Err(tokio::sync::broadcast::error::RecvError::Closed) => return None,
                    }
                }
            },
            move |_, signals| {
                let (Some(manager), Some(_)) = (weak.upgrade(), signals) else {
                    return;
                };
                if !manager.open.get() {
                    return;
                }
                manager.refetch();
                manager.follow();
            },
        );
    }

    fn toggle(self: &Rc<Self>, entry: Option<&Entry>) {
        let Some(Entry::Tui { id: Some(id), .. }) = self.toggleable(entry).cloned() else {
            return;
        };
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        if self.locked.get() {
            return;
        }
        let active = entry.is_some_and(Manager::active);
        let manager = self.clone();
        // Deactivating disposes the plugin's keymap layers, so it waits until the key that asked for it is done.
        tui.app.defer(move |_| {
            let Some(tui) = manager.tui.upgrade() else {
                return;
            };
            if !tui.plugins.set_active(&tui, &id, !active) {
                tui.toasts.error(format!("Failed to update plugin {id}"));
                return;
            }
            // Slots and routes mount again with the plugin's claims.
            tui.navigate(tui.route());
            manager.refresh();
        });
    }

    fn update(self: &Rc<Self>, entry: Option<Entry>) {
        let Some(entry) = entry.filter(|entry| self.updatable(Some(entry))) else {
            return;
        };
        let Some(target) = package(&entry).map(|package| package.target.clone()) else {
            return;
        };
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        let key = self.key(&entry);
        self.pending.borrow_mut().push(key.clone());
        self.refresh();
        let client = tui.data.client().clone();
        let input = PluginUpdateInput {
            location: self.location(),
            targets: vec![target],
        };
        let weak = Rc::downgrade(self);
        tui.app.spawn(
            async move {
                client
                    .plugin_update(&input, &RequestOptions::default())
                    .await
            },
            move |_, result| {
                let Some(manager) = weak.upgrade() else {
                    return;
                };
                manager
                    .pending
                    .borrow_mut()
                    .retain(|pending| *pending != key);
                match result {
                    Ok(()) => manager.refetch(),
                    Err(error) => {
                        if let Some(tui) = manager.tui.upgrade() {
                            tui.toasts.error(error.to_string());
                        }
                        manager.refresh();
                    }
                }
            },
        );
    }

    /// The server re-checks package sources only at startup; the answer carries fresh `outdated` flags.
    fn check(self: &Rc<Self>) {
        if self.checking.replace(true) {
            return;
        }
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        self.refresh();
        let client = tui.data.client().clone();
        let input = PluginCheckInput {
            location: self.location(),
            ..PluginCheckInput::default()
        };
        let weak = Rc::downgrade(self);
        tui.app.spawn(
            async move {
                client
                    .plugin_check(&input, &RequestOptions::default())
                    .await
            },
            move |_, result| {
                let Some(manager) = weak.upgrade() else {
                    return;
                };
                manager.checking.set(false);
                match result {
                    Ok(output) => *manager.server.borrow_mut() = Some(output.data),
                    Err(error) => {
                        if let Some(tui) = manager.tui.upgrade() {
                            tui.toasts.error(error.to_string());
                        }
                    }
                }
                manager.refresh();
            },
        );
    }

    /// `DialogErrorDetails` for `entry`; Back returns to the list on it.
    fn detail(self: &Rc<Self>, entry: Entry) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        let runtime = match entry {
            Entry::Tui { .. } => "tui",
            Entry::Server { .. } => "server",
        };
        let source = plugin_source(&entry);
        let props = error_details::Props {
            title: format!(
                "{} plugin error",
                if runtime == "tui" { "TUI" } else { "Server" }
            ),
            source: Some(source.clone()),
            error: error(&entry).unwrap_or_else(|| "Unknown plugin error".to_owned()),
            context: Some(format!(
                "Plugin: {}\nStatus: failed\nRuntime: {runtime}\nSource: {source}",
                label(&entry)
            )),
            diagnostic_ref: match &entry {
                Entry::Server {
                    plugin:
                        PluginInfo {
                            state: PluginState::Failed(failed),
                            ..
                        },
                    ..
                } => failed.r#ref.clone(),
                _ => None,
            },
            // The error view owns the manager while it is open.
            on_back: Rc::new({
                let (manager, key) = (self.clone(), self.key(&entry));
                move || {
                    let Some(tui) = manager.tui.upgrade() else {
                        return;
                    };
                    let (manager, key) = (manager.clone(), key.clone());
                    tui.app.defer(move |_| manager.open(Some(key)));
                }
            }),
        };
        let weak = tui.weak();
        // The select is still handling the key that opened the error.
        tui.app.defer(move |_| {
            let Some(tui) = weak.upgrade() else { return };
            tui.dialogs.replace(
                |cx| error_details::view(&tui, cx, props),
                None,
                DialogOptions {
                    size: DialogSize::Large,
                    ..DialogOptions::default()
                },
            );
        });
    }
}

fn label(entry: &Entry) -> String {
    match entry {
        Entry::Tui { id, target, .. } => id.clone().unwrap_or_else(|| target.clone()),
        Entry::Server { plugin, source, .. } => plugin
            .id
            .as_ref()
            .map_or_else(|| source.clone(), |id| id.0.clone()),
    }
}

fn plugin_source(entry: &Entry) -> String {
    match entry {
        Entry::Tui { target, .. } => target.clone(),
        Entry::Server { source, .. } => source.clone(),
    }
}

/// The package target, the local path relative to the location's directory, else the source type.
fn source(plugin: &PluginInfo, directory: &str) -> String {
    match &plugin.source {
        PluginSource::Package(package) => package.target.clone(),
        PluginSource::Local(local) => opencode_ui::path::format(
            &local.path,
            Some(directory),
            &std::env::current_dir().unwrap_or_default(),
            std::env::home_dir().as_deref(),
        ),
        other => other.tag().to_owned(),
    }
}

fn internal(entry: &Entry) -> bool {
    match entry {
        Entry::Tui { internal, .. } | Entry::Server { internal, .. } => *internal,
    }
}

fn is_local(entry: &Entry) -> bool {
    match entry {
        Entry::Server { plugin, .. } => matches!(plugin.source, PluginSource::Local(_)),
        Entry::Tui { target, .. } => {
            target.starts_with("file://")
                || target.starts_with("./")
                || target.starts_with("../")
                || std::path::Path::new(target).is_absolute()
        }
    }
}

fn status(entry: &Entry) -> &str {
    match entry {
        Entry::Server { plugin, .. } => plugin.state.tag(),
        Entry::Tui { status, .. } => status,
    }
}

fn package(entry: &Entry) -> Option<&opencode_api::generated::PluginSourcePackage> {
    match entry {
        Entry::Server {
            plugin:
                PluginInfo {
                    source: PluginSource::Package(package),
                    ..
                },
            ..
        } => Some(package),
        _ => None,
    }
}

fn outdated(entry: &Entry) -> bool {
    package(entry).is_some_and(|package| package.outdated == Some(true))
}

fn footer(entry: &Entry) -> Option<String> {
    let mut details = Vec::new();
    if status(entry) != "active" {
        details.push(status(entry).to_owned());
    }
    if is_local(entry) {
        details.push("local".to_owned());
    }
    if let Some(version) = package(entry).and_then(|package| package.version.as_deref()) {
        details.push(display_version(version));
    }
    if outdated(entry) {
        details.push("update available".to_owned());
    }
    (!details.is_empty()).then(|| details.join(", "))
}

/// A commit hash shows as its first 7 characters.
fn display_version(version: &str) -> String {
    let hash = matches!(version.len(), 40 | 64) && version.chars().all(|c| c.is_ascii_hexdigit());
    if hash {
        version[..7].to_owned()
    } else {
        version.to_owned()
    }
}

fn error(entry: &Entry) -> Option<String> {
    match entry {
        Entry::Server { plugin, .. } => match &plugin.state {
            PluginState::Failed(failed) => Some(failed.error.clone()),
            _ => None,
        },
        Entry::Tui { error, .. } => error.clone(),
    }
}

/// `localeCompare` for plugin labels: by letters ignoring case, lowercase first on a tie.
fn locale_compare(a: &str, b: &str) -> Ordering {
    a.to_lowercase()
        .cmp(&b.to_lowercase())
        .then_with(|| b.cmp(a))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_and_labels_order_as_in_typescript() {
        assert_eq!(display_version(&"a".repeat(40)), "aaaaaaa");
        assert_eq!(display_version("1.2.3"), "1.2.3");
        let mut labels = vec!["beta", "Alpha", "alpha"];
        labels.sort_by(|a, b| locale_compare(a, b));
        assert_eq!(labels, ["alpha", "Alpha", "beta"]);
    }
}
