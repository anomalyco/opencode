//! The sidebar's MCP section (E.14, row F06, `feature-plugins/sidebar/mcp.tsx`): each server of the session's
//! location with its status. Above two servers the header folds the list, and the folded header counts the
//! active servers and the errors. A click on a server opens the MCP dialog on it (E.17b's `show_server`).

use std::rc::Rc;

use opencode_api::generated::{McpServer, SessionID};
use opencode_plugin::{Definition, Placement, slot};
use opencode_store::{Catalog, Location};
use opencode_ui::theme::Theme;
use opentui::prelude::*;

use crate::app::Tui;
use crate::routes::session::sidebar::{Fold, Section, on_click, sync_catalogs};

pub fn plugin() -> Definition<Tui> {
    Definition::new("opencode.sidebar.mcp", |cx| {
        let fold = Fold::load(cx.host(), cx.storage_key("view"));
        cx.slot(Placement::append(slot::SIDEBAR_CONTENT), move |tui, input| {
            let session = SessionID(input.session_id.clone().unwrap_or_default());
            let fold = fold.clone();
            Box::new(Section::new(tui, move |tui| view(tui, &session, &fold)))
        });
    })
}

fn view(tui: &Tui, session: &SessionID, fold: &Rc<Fold>) -> Option<View> {
    sync_catalogs(tui, session, &[Catalog::McpServer]);
    let list = servers(tui, session);
    if list.is_empty() {
        return None;
    }
    let theme = tui.page();
    let app = &tui.app;
    let on = list.iter().filter(|item| item.status.tag() == "connected").count();
    let bad = list.iter().filter(|item| matches!(item.status.tag(), "failed" | "needs_auth")).count();
    let foldable = list.len() > 2;
    let header = View::new(app).row().gap(1);
    if foldable {
        header.add(&Text::new(app, if fold.open() { "▼" } else { "▶" }).fg(theme.text.base));
    }
    let mut title = vec!["MCP".fg(theme.text.base).bold()];
    if !fold.open() {
        let errors = match bad {
            0 => String::new(),
            1 => ", 1 error".to_owned(),
            bad => format!(", {bad} errors"),
        };
        title.push(format!(" ({on} active{errors})").fg(theme.text.muted));
    }
    header.add(&Text::new(app, title));
    let weak = tui.weak();
    let toggle = fold.clone();
    on_click(&header, true, move || {
        if let Some(tui) = weak.upgrade()
            && foldable
        {
            toggle.toggle(&tui);
        }
    });
    let root = View::new(app).child(&header);
    if !foldable || fold.open() {
        for item in list {
            root.add(&row(tui, &theme, item));
        }
    }
    Some(root)
}

/// The MCP servers of the session's location.
fn servers(tui: &Tui, session: &SessionID) -> Vec<McpServer> {
    tui.data.read(|state| {
        let location = state.session(session).map(|info| Location::from(&info.location));
        state.location(location.as_ref()).and_then(|data| data.mcp_server.clone()).unwrap_or_default()
    })
}

fn row(tui: &Tui, theme: &Theme, item: McpServer) -> View {
    let app = &tui.app;
    let status = item.status.tag().to_owned();
    let dot = match status.as_str() {
        "connected" => theme.text.feedback.success.base,
        "failed" => theme.text.feedback.error.base,
        "needs_auth" => theme.text.feedback.warning.base,
        _ => theme.text.muted,
    };
    let label = match status.as_str() {
        "connected" => "Connected",
        "pending" => "Connecting",
        "failed" => "Error",
        "disabled" => "Disabled",
        "needs_auth" => "Sign in",
        other => other,
    }
    .to_owned();
    let row = View::new(app)
        .row()
        .gap(1)
        .min_width(0)
        .child(&Text::new(app, "•").fg(dot).shrink(0.0))
        .child(
            &Text::new(app, item.name.clone())
                .fg(theme.text.base)
                .bold()
                .wrap(WrapMode::None)
                .truncate(true)
                .grow(1.0)
                .shrink(1.0)
                .min_width(0),
        )
        .child(
            &Text::new(app, label)
                .fg(if status == "failed" { theme.text.feedback.error.base } else { theme.text.muted })
                .wrap(WrapMode::None)
                .shrink(0.0),
        );
    let weak = tui.weak();
    let failed = status == "failed";
    on_click(&row, false, move || {
        if let Some(tui) = weak.upgrade() {
            crate::dialogs::mcp::show_server(&tui, Some(item.name.clone()), failed);
        }
    });
    row
}
