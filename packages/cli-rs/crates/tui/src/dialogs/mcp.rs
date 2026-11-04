//! MCP servers dialog (E.17b, row DLG11): `packages/tui/src/component/dialog-mcp.tsx`.
//!
//! "MCP servers": the servers of the current location by name, each with its status as the footer.
//! Space (`dialog.mcp.toggle`) connects, disconnects, or retries the selected server; the
//! `mcp.status.changed` event refreshes the list through the store. Enter shows a failed server's
//! error. A server that needs sign-in through an integration goes to the integration flow (E.17a).

use std::cell::{Cell, RefCell};
use std::collections::HashSet;
use std::rc::{Rc, Weak};

use opencode_api::client::RequestOptions;
use opencode_api::generated::{
    ExperimentalMcpConnectInput, ExperimentalMcpDisconnectInput, LocationQueryInput, McpServer,
    McpServerStatus,
};
use opencode_store::{Catalog, Location};
use opencode_ui::dialog::DialogOptions;
use opencode_ui::keymap::{Bind, GLOBAL_MODE, KeymapLayer, Slash, TuiCommand};
use opencode_ui::select::{
    self, FooterHint, Group, Select, SelectAction, SelectOption, SelectProps,
};
use opencode_ui::theme::Theme;
use opentui::prelude::*;

use super::error_details;
use super::session_list::dialog_theme;
use crate::app::Tui;
use crate::routes::Route;

/// Registers `mcp.list` (`/mcps`) and its binding as `app.tsx:158,967-975` do.
pub fn install(tui: &Rc<Tui>) {
    let weak = tui.weak();
    let command = TuiCommand::new("mcp.list", move |_, _| {
        if let Some(tui) = weak.upgrade() {
            show(&tui);
        }
    })
    .bind(Bind::Off)
    .title("MCP servers")
    .group("Agent")
    .palette()
    .slash(Slash {
        name: "mcps".to_owned(),
        aliases: Vec::new(),
        arguments: false,
    });
    let layers = [
        KeymapLayer {
            mode: Some(GLOBAL_MODE.to_owned()),
            commands: vec![command],
            ..KeymapLayer::default()
        },
        // `appGlobalBindingCommands`.
        KeymapLayer {
            mode: Some(GLOBAL_MODE.to_owned()),
            bindings: vec!["mcp.list".to_owned()],
            ..KeymapLayer::default()
        },
    ];
    for layer in layers {
        // The layers live as long as the keymap, which the TUI owns.
        if let Err(error) = tui.keymap.layer(layer) {
            log::error!("mcp keymap layer: {error}");
        }
    }
}

/// Opens the dialog (`mcp.list`).
pub fn show(tui: &Tui) {
    show_server(tui, None, false);
}

/// Opens the dialog on `initial`; with `details`, a failed `initial` opens on its error (the
/// sidebar's MCP section).
pub fn show_server(tui: &Tui, initial: Option<String>, details: bool) {
    let mcp = Rc::new(Mcp {
        tui: tui.weak(),
        location: current_location(tui),
        loading: RefCell::new(HashSet::new()),
        select: RefCell::new(None),
        seen: Cell::new(tui.data.read(|state| state.revision())),
    });
    if details
        && let Some(server) = initial
            .as_ref()
            .and_then(|name| mcp.server(name))
            .filter(|server| kind(&server.status) == "failed")
    {
        mcp.detail(server);
        return;
    }
    let built = mcp.clone();
    tui.dialogs.replace(
        move |cx| {
            let mcp = built;
            let weak = Rc::downgrade(&mcp);
            let mut props = SelectProps::new("MCP servers", mcp.options(&cx.theme));
            props.search_in_title = true;
            props.title_placeholder = Some("Search MCP servers".to_owned());
            props.preserve_selection = true;
            props.on_select = Some(Rc::new({
                let weak = weak.clone();
                move |option: &SelectOption<String>| {
                    if let Some(mcp) = weak.upgrade() {
                        mcp.select(&option.value);
                    }
                }
            }));
            props.actions = vec![SelectAction {
                title: Rc::new({
                    let weak = weak.clone();
                    move |option: Option<&SelectOption<String>>| {
                        let server = weak
                            .upgrade()
                            .zip(option)
                            .and_then(|(mcp, option)| mcp.server(&option.value));
                        toggle_title(server.as_ref()).to_owned()
                    }
                }),
                ..SelectAction::new("dialog.mcp.toggle", "connect", {
                    let weak = weak.clone();
                    move |option: &SelectOption<String>| {
                        if let Some(mcp) = weak.upgrade() {
                            mcp.toggle(&option.value);
                        }
                    }
                })
            }];
            props.dynamic_hints = Some(Rc::new({
                let weak = weak.clone();
                move || {
                    let Some(mcp) = weak.upgrade() else {
                        return Vec::new();
                    };
                    if !mcp
                        .focused()
                        .is_some_and(|server| focused_error(&server).is_some())
                    {
                        return Vec::new();
                    }
                    vec![FooterHint {
                        title: "view error".into(),
                        label: "enter".into(),
                        group: Some(Group::Primary),
                    }]
                }
            }));
            let (view, handle) = select::select(cx, props);
            if let Some(name) = &initial {
                handle.move_to(name);
            }
            *mcp.select.borrow_mut() = Some(handle);
            // The footer reads the selection through the handle, which exists only now.
            mcp.refresh();
            // The dialog owns the list; handlers hold weak references.
            cx.on_close(opentui::keymap::Disposer::new(move || {
                mcp.select.borrow_mut().take();
            }));
            view
        },
        None,
        DialogOptions::default(),
    );
    mcp.load();
}

struct Mcp {
    tui: Weak<Tui>,
    location: Location,
    /// Servers with a connect or disconnect in flight.
    loading: RefCell<HashSet<String>>,
    select: RefCell<Option<Select<String>>>,
    /// The store revision the list last saw.
    seen: Cell<u64>,
}

impl Mcp {
    /// Reads the list when the location has none yet, then follows the store.
    fn load(self: &Rc<Self>) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        let loaded = tui.data.read(|state| {
            state
                .location(Some(&self.location))
                .is_some_and(|data| data.mcp_server.is_some())
        });
        if !loaded {
            let weak = Rc::downgrade(self);
            tui.app.spawn(
                tui.data
                    .catalog_sync(Catalog::McpServer, Some(&self.location)),
                move |_, result| {
                    if let Err(error) = result {
                        log::warn!("mcp list: {error}");
                    }
                    if let Some(mcp) = weak.upgrade() {
                        mcp.refresh();
                    }
                },
            );
        }
        self.watch(tui.data.subscribe());
    }

    /// Refreshes the list after each store flush that touched the location, while the dialog is open.
    fn watch(self: &Rc<Self>, mut revisions: tokio::sync::watch::Receiver<u64>) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        let weak = Rc::downgrade(self);
        tui.app.spawn(
            async move { revisions.changed().await.is_ok().then_some(revisions) },
            move |_, revisions| {
                let (Some(mcp), Some(revisions)) = (weak.upgrade(), revisions) else {
                    return;
                };
                let Some(tui) = mcp.tui.upgrade() else { return };
                let (revision, changes) = tui.data.changes_since(mcp.seen.get());
                mcp.seen.set(revision);
                if changes.location(&mcp.location) {
                    mcp.refresh();
                }
                mcp.watch(revisions);
            },
        );
    }

    /// The location's servers by name.
    fn servers(&self) -> Vec<McpServer> {
        let Some(tui) = self.tui.upgrade() else {
            return Vec::new();
        };
        let mut servers = tui.data.read(|state| {
            state
                .location(Some(&self.location))
                .and_then(|data| data.mcp_server.clone())
                .unwrap_or_default()
        });
        servers.sort_by(|a, b| a.name.cmp(&b.name));
        servers
    }

    fn server(&self, name: &str) -> Option<McpServer> {
        self.servers()
            .into_iter()
            .find(|server| server.name == name)
    }

    /// The selected server (TS `focusedServer`).
    fn focused(&self) -> Option<McpServer> {
        let selected = self.select.borrow().as_ref()?.selected()?;
        self.server(&selected.value)
    }

    fn options(&self, theme: &Theme) -> Vec<SelectOption<String>> {
        let loading = self.loading.borrow();
        self.servers()
            .into_iter()
            .map(|server| {
                let status = kind(&server.status);
                let pending = loading.contains(&server.name) || status == "pending";
                let mut option = SelectOption::new(server.name.clone(), server.name);
                // TS wraps "Connected ✓" in a bold span, which the row's `<text>` draws plain.
                option.footer = Some(status_label(status, pending).to_owned());
                option.footer_color = Some(if pending {
                    theme.text.muted
                } else {
                    status_color(theme, status)
                });
                option
            })
            .collect()
    }

    fn refresh(&self) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        let select = self.select.borrow().clone();
        if let Some(select) = select {
            select.set_options(self.options(&dialog_theme(&tui)));
        }
    }

    /// Enter: the integration flow for a sign-in, else the error of a failed server.
    fn select(self: &Rc<Self>, name: &str) {
        let Some(server) = self.server(name) else {
            return;
        };
        if kind(&server.status) == "needs_auth"
            && let Some(integration) = server.integration_id.clone()
        {
            let weak = self.tui.clone();
            if let Some(tui) = self.tui.upgrade() {
                tui.app.defer(move |_| {
                    if let Some(tui) = weak.upgrade() {
                        super::integration::show_auto_connect(&tui, &integration);
                    }
                });
            }
            return;
        }
        if status_error(&server.status).is_none() {
            return;
        }
        self.detail(server);
    }

    /// Space: connect or disconnect. The `mcp.status.changed` event refreshes the list.
    fn toggle(self: &Rc<Self>, name: &str) {
        if self.loading.borrow().contains(name) {
            return;
        }
        let Some(server) = self.server(name) else {
            return;
        };
        let status = kind(&server.status);
        if status == "pending" {
            return;
        }
        if status == "needs_auth" && server.integration_id.is_some() {
            self.select(name);
            return;
        }
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        self.loading.borrow_mut().insert(name.to_owned());
        self.refresh();
        let client = tui.data.client().clone();
        let location = Some(LocationQueryInput {
            directory: Some(self.location.directory.clone()),
        });
        let server = name.to_owned();
        let connected = status == "connected";
        let weak = Rc::downgrade(self);
        let toasts = tui.weak();
        tui.app.spawn(
            async move {
                let options = RequestOptions::default();
                if connected {
                    let input = ExperimentalMcpDisconnectInput { server, location };
                    return client.experimental_mcp_disconnect(&input, &options).await;
                }
                let input = ExperimentalMcpConnectInput { server, location };
                client.experimental_mcp_connect(&input, &options).await
            },
            {
                let name = name.to_owned();
                move |_, result| {
                    if let Err(error) = result
                        && let Some(tui) = toasts.upgrade()
                    {
                        tui.toasts.error(error.to_string());
                    }
                    if let Some(mcp) = weak.upgrade() {
                        mcp.loading.borrow_mut().remove(&name);
                        mcp.refresh();
                    }
                }
            },
        );
    }

    /// The error view in place of the list; Escape goes back to the list on this server.
    fn detail(self: &Rc<Self>, server: McpServer) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        let weak = tui.weak();
        let mut context = format!(
            "Status: {}\nConfiguration: mcp.servers.{}",
            kind(&server.status),
            server.name
        );
        if let Some(integration) = &server.integration_id {
            context.push_str(&format!("\nIntegration: {}", integration.0));
        }
        let props = error_details::Props {
            title: format!("MCP server: {}", server.name),
            source: None,
            error: status_error(&server.status)
                .unwrap_or("Unknown MCP connection error")
                .to_owned(),
            context: Some(context),
            diagnostic_ref: None,
            on_back: Rc::new({
                let name = server.name.clone();
                move || {
                    let Some(tui) = weak.upgrade() else { return };
                    let (weak, name) = (tui.weak(), name.clone());
                    tui.app.defer(move |_| {
                        if let Some(tui) = weak.upgrade() {
                            show_server(&tui, Some(name), false);
                        }
                    });
                }
            }),
        };
        let open = tui.weak();
        tui.app.defer(move |_| {
            let Some(tui) = open.upgrade() else { return };
            tui.dialogs.replace(
                |cx| error_details::view(&tui, cx, props),
                None,
                DialogOptions::default(),
            );
        });
    }
}

/// `location.ref ?? data.location.default()`: the session's location on a session route.
fn current_location(tui: &Tui) -> Location {
    let session = match tui.route() {
        Route::Session { id } => tui.data.read(|state| state.session(&id).cloned()),
        _ => None,
    };
    match session {
        Some(session) => Location::new(session.location.directory.0),
        None => tui.data.read(|state| state.default_location().clone()),
    }
}

/// The status name (`status.status`); an unknown member keeps the name it arrived with.
fn kind(status: &McpServerStatus) -> &str {
    match status {
        McpServerStatus::Connected(_) => "connected",
        McpServerStatus::Pending(_) => "pending",
        McpServerStatus::Disabled(_) => "disabled",
        McpServerStatus::Failed(_) => "failed",
        McpServerStatus::NeedsAuth(_) => "needs_auth",
        McpServerStatus::Unknown(value) => value
            .get("status")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default(),
    }
}

/// `statusError`.
fn status_error(status: &McpServerStatus) -> Option<&str> {
    match status {
        McpServerStatus::Failed(failed) => Some(&failed.error),
        McpServerStatus::NeedsAuth(auth) => Some(&auth.error),
        _ => None,
    }
}

/// `focusedError`: a sign-in through an integration is not shown as an error.
fn focused_error(server: &McpServer) -> Option<&str> {
    if kind(&server.status) == "needs_auth" && server.integration_id.is_some() {
        return None;
    }
    status_error(&server.status)
}

/// `Status`.
fn status_label(status: &str, pending: bool) -> &'static str {
    if pending {
        return "Connecting …";
    }
    match status {
        "connected" => "Connected ✓",
        "failed" => "Failed !",
        "needs_auth" => "Sign in required →",
        _ => "Disabled ○",
    }
}

/// `statusColor`.
fn status_color(theme: &Theme, status: &str) -> Color {
    match status {
        "connected" => theme.text.feedback.success.base,
        "failed" => theme.text.feedback.error.base,
        "needs_auth" => theme.text.feedback.warning.base,
        _ => theme.text.muted,
    }
}

/// `toggleTitle`.
fn toggle_title(server: Option<&McpServer>) -> &'static str {
    match server.map(|server| kind(&server.status)) {
        Some("connected") => "disconnect",
        Some("failed") => "retry",
        Some("needs_auth") => "sign in",
        _ => "connect",
    }
}
