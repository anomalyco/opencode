//! The sidebar's MCP section (E.14, row F06, `feature-plugins/sidebar/mcp.tsx`): each server of the session's
//! location with its status. Above two servers the header folds the list, and the folded header counts the
//! active servers and the errors. A click on a server opens the MCP dialog on it, and on its error when it failed
//! (`mcp.list` with the server's name). It is a plugin of the one API (O-67).

use opencode_api::generated::McpServer;
use opencode_plugin::abi::{self, Click, Command, Layout, Node, Placement, Render, Span, Wrap};
use opencode_plugin::slot;
use serde_json::json;

pub fn plugin() -> abi::Plugin {
    abi::Plugin { id: "opencode.sidebar.mcp", setup }
}

/// The hidden command a click on the header runs.
const FOLD: &str = "sidebar.mcp.fold";

fn setup(setup: &mut abi::Setup) -> Result<(), String> {
    setup.storage_key("view");
    setup.command(Command { name: FOLD.to_owned(), ..Command::default() }, |host, _| {
        host.storage_set("view", json!({ "open": !open(host) }));
    });
    setup.slot(Placement::append(slot::SIDEBAR_CONTENT), |read, input, changed| {
        let Some(session) = input.session_id.as_deref() else {
            return Render::Hide;
        };
        // The servers follow the session's location, the fold the storage.
        if !(changed.all || changed.local || changed.session(session) || !changed.locations.is_empty()) {
            return Render::Keep;
        }
        // Where the TUI works while the session is not known.
        let location = read
            .session(session)
            .map(|session| abi::LocationRef { directory: session.info.location.directory.0, workspace: None });
        let list = read.mcp_servers(location.as_ref()).unwrap_or_default();
        if list.is_empty() {
            return Render::Hide;
        }
        Render::Show(view(&list, open(read)))
    });
    Ok(())
}

/// The stored `{ open: true }` (`storage.store("view")`).
fn open(read: &dyn abi::Read) -> bool {
    read.storage_get("view").and_then(|value| value.get("open")?.as_bool()).unwrap_or(true)
}

fn view(list: &[McpServer], open: bool) -> Node {
    let on = list.iter().filter(|item| item.status.tag() == "connected").count();
    let bad = list.iter().filter(|item| matches!(item.status.tag(), "failed" | "needs_auth")).count();
    let foldable = list.len() > 2;
    let mut header = Vec::new();
    if foldable {
        header.push(Node::text([Span::new(if open { "▼" } else { "▶" }).fg("text.base")]));
    }
    let mut title = vec![Span::new("MCP").fg("text.base").bold()];
    if !open {
        let errors = match bad {
            0 => String::new(),
            1 => ", 1 error".to_owned(),
            bad => format!(", {bad} errors"),
        };
        title.push(Span::new(format!(" ({on} active{errors})")).fg("text.muted"));
    }
    header.push(Node::text(title));
    let mut header = Node::row(header).gap(1);
    if foldable {
        header = header.on_click(Click::command(FOLD, None).on_down());
    }
    let mut children = vec![header];
    if !foldable || open {
        children.extend(list.iter().map(row));
    }
    Node::column(children)
}

fn row(item: &McpServer) -> Node {
    let status = item.status.tag();
    let dot = match status {
        "connected" => "text.feedback.success.base",
        "failed" => "text.feedback.error.base",
        "needs_auth" => "text.feedback.warning.base",
        _ => "text.muted",
    };
    let label = match status {
        "connected" => "Connected",
        "pending" => "Connecting",
        "failed" => "Error",
        "disabled" => "Disabled",
        "needs_auth" => "Sign in",
        other => other,
    };
    let fixed = Layout::default().shrink(false);
    Node::row(vec![
        Node::text([Span::new("•").fg(dot)]).layout(fixed),
        Node::text([Span::new(item.name.clone()).fg("text.base").bold()])
            .wrap(Wrap::None)
            .truncate()
            .layout(Layout::default().grow().shrink(true).min_width_zero()),
        Node::text([Span::new(label).fg(if status == "failed" { "text.feedback.error.base" } else { "text.muted" })])
            .wrap(Wrap::None)
            .layout(fixed),
    ])
    .gap(1)
    .layout(Layout::default().min_width_zero())
    .on_click(Click::command("mcp.list", Some(item.name.clone())))
}
