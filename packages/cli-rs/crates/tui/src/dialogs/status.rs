//! Status dialog (E.18b): `packages/tui/src/component/dialog-status.tsx`, `opencode.status` (`/status`,
//! `<leader>s`). It lists the default location's MCP servers and follows the store while it is open.

use opencode_api::generated::{McpServer, McpServerStatus};
use opencode_store::Catalog;
use opencode_ui::dialog::{DialogCx, layout};

use crate::prelude::*;

/// Registers `opencode.status` ("View status", `/status`) as `app.tsx:1054-1061` does.
pub fn install(tui: &Rc<Tui>) {
    let command = TuiCommand::new("opencode.status", bind!(tui, |tui, _, _| show(&tui)))
        .bind(Bind::Off)
        .title("View status")
        .group("System")
        .palette()
        .slash("status");
    tui.keymap.install(
        "status",
        [
            KeymapLayer::global(vec![command]),
            // `appBindingCommands`: `<leader>s` by default.
            KeymapLayer::default().bindings(["opencode.status"]),
        ],
    );
}

/// `DialogStatus`, in place of any open dialog.
pub fn show(tui: &Tui) {
    tui.dialogs.replace(
        bind!(tui, |tui, cx| {
            let body = View::new(&cx.app);
            draw(&body, cx, &servers(&tui));
            load(&tui);
            // A flush after the draw above reaches `Tui::sync`, which redraws.
            let drawn = body.clone();
            cx.on_close(tui.follow(cx, move |cx, tui, changes| {
                let location = tui.data.read(|state| state.default_location().clone());
                if changes.location(&location) {
                    draw(&drawn, cx, &servers(tui));
                }
            }));
            layout(cx, &header(cx, HeaderProps::new("Status")), &body, None)
        }, else View::new(&cx.app)),
        None,
        DialogOptions::default(),
    );
}

/// Reads the list when the store has none (TS loads it with the location at startup).
fn load(tui: &Tui) {
    let location = tui.data.read(|state| state.default_location().clone());
    let loaded = tui.data.read(|state| state.location(Some(&location)).is_some_and(|data| data.mcp_server.is_some()));
    if !loaded {
        tui.app.spawn(tui.data.catalog_sync(Catalog::McpServer, Some(&location)), |_, result| {
            if let Err(error) = result {
                log::warn!("mcp list: {error}");
            }
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
