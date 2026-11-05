//! Status dialog (E.18b): `packages/tui/src/component/dialog-status.tsx`, `opencode.status` (`/status`,
//! `<leader>s`). It lists the default location's MCP servers and follows the store while it is open.

use std::cell::Cell;
use std::rc::{Rc, Weak};

use opencode_api::generated::{McpServer, McpServerStatus};
use opencode_store::Catalog;
use opencode_ui::bind;
use opencode_ui::dialog::{DialogCx, DialogOptions, HeaderProps, header, layout};
use opencode_ui::keymap::{Bind, GLOBAL_MODE, KeymapLayer, Slash, TuiCommand};
use opencode_ui::theme::Theme;
use opentui::keymap::Disposer;
use opentui::prelude::*;

use crate::app::Tui;

/// Registers `opencode.status` ("View status", `/status`) as `app.tsx:1054-1061` does.
pub fn install(tui: &Rc<Tui>) {
    let command = TuiCommand::new("opencode.status", bind!(tui, |tui, _, _| show(&tui)))
        .bind(Bind::Off)
        .title("View status")
        .group("System")
        .palette()
        .slash(Slash { name: "status".to_owned(), aliases: Vec::new(), arguments: false });
    let layers = [
        KeymapLayer { mode: Some(GLOBAL_MODE.to_owned()), commands: vec![command], ..KeymapLayer::default() },
        // `appBindingCommands`: `<leader>s` by default.
        KeymapLayer { bindings: vec!["opencode.status".to_owned()], ..KeymapLayer::default() },
    ];
    for layer in layers {
        // The layers live as long as the keymap, which the TUI owns.
        if let Err(error) = tui.keymap.layer(layer).map(Disposer::forget) {
            log::error!("status keymap layer: {error}");
        }
    }
}

/// `DialogStatus`, in place of any open dialog.
pub fn show(tui: &Tui) {
    let weak = tui.weak();
    tui.dialogs.replace(
        bind!(weak, |tui, cx| {
            // The store changes on other threads: take the revision before drawing, so a change in between redraws.
            let seen = tui.data.read(|state| state.revision());
            let body = View::new(&cx.app);
            draw(&body, cx, &servers(&tui));
            let status = Rc::new(Status {
                tui: tui.weak(),
                cx: Rc::downgrade(cx),
                body: body.clone(),
                seen: Cell::new(seen),
                open: Cell::new(true),
            });
            let closed = status.clone();
            cx.on_close(Disposer::new(move || closed.open.set(false)));
            status.load(&tui);
            layout(cx, &header(cx, HeaderProps { title: "Status".to_owned(), ..HeaderProps::default() }), &body, None)
        }, else View::new(&cx.app)),
        None,
        DialogOptions::default(),
    );
}

struct Status {
    tui: Weak<Tui>,
    cx: Weak<DialogCx>,
    body: View,
    seen: Cell<u64>,
    open: Cell<bool>,
}

impl Status {
    /// Reads the list when the store has none (TS loads it with the location at startup), then follows the store.
    fn load(self: &Rc<Self>, tui: &Tui) {
        let location = tui.data.read(|state| state.default_location().clone());
        let loaded =
            tui.data.read(|state| state.location(Some(&location)).is_some_and(|data| data.mcp_server.is_some()));
        if !loaded {
            tui.app.spawn(tui.data.catalog_sync(Catalog::McpServer, Some(&location)), |_, result| {
                if let Err(error) = result {
                    log::warn!("mcp list: {error}");
                }
            });
        }
        // A new receiver counts the current revision as seen; one written since `seen` must still redraw.
        let mut revisions = tui.data.subscribe();
        revisions.mark_changed();
        self.watch(revisions);
    }

    fn watch(self: &Rc<Self>, mut revisions: tokio::sync::watch::Receiver<u64>) {
        let Some(tui) = self.tui.upgrade() else {
            return;
        };
        let status = self.clone();
        tui.app.spawn(async move { revisions.changed().await.is_ok().then_some(revisions) }, move |_, revisions| {
            let (Some(tui), Some(cx), Some(revisions)) = (status.tui.upgrade(), status.cx.upgrade(), revisions) else {
                return;
            };
            if !status.open.get() {
                return;
            }
            let location = tui.data.read(|state| state.default_location().clone());
            let (revision, changes) = tui.data.changes_since(status.seen.get());
            status.seen.set(revision);
            if changes.location(&location) {
                draw(&status.body, &cx, &servers(&tui));
            }
            status.watch(revisions);
        });
    }
}

/// `data.location.mcp.server.list() ?? []` for the default location, in the server's order.
fn servers(tui: &Tui) -> Vec<McpServer> {
    tui.data.read(|state| {
        let location = state.default_location().clone();
        state.location(Some(&location)).and_then(|data| data.mcp_server.clone()).unwrap_or_default()
    })
}

fn draw(body: &View, cx: &DialogCx, servers: &[McpServer]) {
    let app = &cx.app;
    let theme = &cx.theme;
    body.clear();
    if servers.is_empty() {
        body.add(&Text::new(app, "No MCP servers").fg(theme.text.base));
        return;
    }
    let plural = if servers.len() == 1 { "" } else { "s" };
    body.add(&Text::new(app, format!("{} MCP server{plural}", servers.len())).fg(theme.text.base));
    for server in servers {
        let row = View::new(app).row().gap(1);
        row.add(&Text::new(app, "•").fg(color(theme, &server.status)).shrink(0.0));
        let text = Text::new(app, "").fg(theme.text.base).wrap(WrapMode::Word);
        text.set_text(vec![
            Span::styled(server.name.clone(), Style::new().fg(theme.text.base).bold()),
            Span::styled(" ", Style::new().fg(theme.text.base)),
            Span::styled(describe(&server.status), Style::new().fg(theme.text.muted)),
        ]);
        row.add(&text);
        body.add(&row);
    }
}

fn color(theme: &Theme, status: &McpServerStatus) -> Color {
    match status {
        McpServerStatus::Connected(_) => theme.text.feedback.success.base,
        McpServerStatus::Failed(_) => theme.text.feedback.error.base,
        McpServerStatus::NeedsAuth(_) => theme.text.feedback.warning.base,
        _ => theme.text.muted,
    }
}

/// The muted text after the name; an unknown status shows its name, as the TS `Switch` fallback does.
fn describe(status: &McpServerStatus) -> String {
    match status {
        McpServerStatus::Connected(_) => "Connected".to_owned(),
        McpServerStatus::Failed(failed) => failed.error.clone(),
        McpServerStatus::Disabled(_) => "Disabled in configuration".to_owned(),
        McpServerStatus::NeedsAuth(auth) => format!("Needs authentication: {}", auth.error),
        McpServerStatus::Pending(_) => "pending".to_owned(),
        McpServerStatus::Unknown(value) => {
            value.get("status").and_then(serde_json::Value::as_str).unwrap_or_default().to_owned()
        }
    }
}
