//! A port of `opencode-subagents-sidebar` 0.1.6 (`src/tui.tsx`): the direct subagent sessions of the session in view,
//! newest activity first, in the sidebar. A green dot marks a running child. A row opens its child, the header folds
//! the list and remembers it, and `/subagents` picks a child from a list. A session without children draws nothing.
//! The sidebar shows ten children at most; the header keeps the count and a `+N more` row says what was left out.

use std::cell::RefCell;
use std::rc::Rc;

use opencode_plugin_abi::{
    Action, Click, Command, Dialog, Layout, Node, Placement, Read, Render, Route, Select, SelectOption, SessionStatus,
    Setup, Span, Wrap, export_plugin,
};
use serde_json::json;

const VISIBLE: usize = 10;
const OPEN: &str = "subagents-sidebar.open";
const TOGGLE: &str = "subagents-sidebar.toggle";

/// TS `theme.text.feedback.success.base` and `theme.text.muted`.
const GREEN: &str = "text.feedback.success.base";
const DIM: &str = "text.muted";

struct Child {
    id: String,
    title: String,
    running: bool,
}

fn setup(setup: &mut Setup) -> Result<(), String> {
    setup.storage_key("view");
    // The sessions of the mounted sidebars, latest last: TS registers `/subagents` in the sidebar component, so it
    // picks from the session that sidebar shows.
    let mounted: Rc<RefCell<Vec<String>>> = Rc::default();
    let pick = Command {
        name: "subagents-sidebar.pick".to_owned(),
        title: "Subagents: open one".to_owned(),
        group: Some("Session".to_owned()),
        slash: Some("subagents".to_owned()),
        palette: true,
        ..Command::default()
    };
    let shown = mounted.clone();
    setup.command(pick, move |host, _| {
        let Some(session) = shown.borrow().last().cloned() else { return };
        let list = children(host, &session);
        if list.is_empty() {
            return;
        }
        let options = list
            .into_iter()
            .map(|child| {
                SelectOption::new(child.title, child.id).description(if child.running { "running" } else { "done" })
            })
            .collect();
        let action = Action::Command { name: OPEN.to_owned(), input: None };
        host.dialog(Dialog::Select(Select {
            title: "Subagents".to_owned(),
            placeholder: None,
            options,
            current: None,
            action,
        }));
    });
    // Route navigation, as the TS plugin does: the built-in session list navigates this way too.
    setup.command(Command { name: OPEN.to_owned(), ..Command::default() }, |host, input| {
        if let Some(id) = input {
            host.navigate(Route::Session { id: id.to_owned() });
        }
    });
    setup.command(Command { name: TOGGLE.to_owned(), ..Command::default() }, |host, _| {
        let open = open(host);
        host.storage_merge("view", json!({ "open": !open }).as_object().cloned().unwrap_or_default());
    });
    let at = Placement::append("sidebar.content");
    setup.slot(at.clone(), |read, input, changed| {
        let Some(session) = input.session_id.as_deref() else { return Render::Hide };
        // Children come and go, and change, with session infos and statuses; the fold is in storage.
        if !(changed.all || changed.local || changed.woken || !changed.sessions.is_empty()) {
            return Render::Keep;
        }
        let children = children(read, session);
        if children.is_empty() {
            return Render::Hide;
        }
        Render::Show(sidebar(&children, open(read)))
    });
    setup.on_mount(at, move |_, input, mount| {
        let Some(session) = input.session_id.clone() else { return };
        let mut mounted = mounted.borrow_mut();
        match mount {
            true => mounted.push(session),
            false => {
                if let Some(index) = mounted.iter().rposition(|known| *known == session) {
                    mounted.remove(index);
                }
            }
        }
    });
    Ok(())
}

/// The direct children of `session`, last updated first; equal times keep the host's order.
fn children(read: &dyn Read, session: &str) -> Vec<Child> {
    let mut members: Vec<_> =
        read.family(session).members.into_iter().filter(|member| member.parent.as_deref() == Some(session)).collect();
    members.sort_by(|a, b| b.updated.total_cmp(&a.updated));
    members
        .into_iter()
        .map(|member| Child {
            title: read
                .session(&member.id)
                .and_then(|child| child.info.title)
                .filter(|title| !title.is_empty())
                .unwrap_or_else(|| "Subagent".to_owned()),
            running: member.status == SessionStatus::Running,
            id: member.id,
        })
        .collect()
}

/// Whether the list is unfolded: the stored `view`, open at first.
fn open(read: &dyn Read) -> bool {
    read.storage_get("view").and_then(|view| view.get("open")?.as_bool()).unwrap_or(true)
}

fn sidebar(children: &[Child], open: bool) -> Node {
    let running = children.iter().filter(|child| child.running).count();
    let mut title = vec![Span::new("Subagents").bold()];
    if !open {
        let running = if running > 0 { format!(", {running} running") } else { String::new() };
        title.push(Span::new(format!(" ({}{running})", children.len())).fg(DIM));
    }
    let header = Node::row(vec![
        Node::text([Span::new(if open { "▼" } else { "▶" })]).fg("text.base"),
        Node::text(title).fg("text.base"),
    ])
    .gap(1)
    .on_click(Click::command(TOGGLE, None).on_down());
    let mut rows = vec![header];
    if open {
        rows.extend(children.iter().take(VISIBLE).map(row));
        if children.len() > VISIBLE {
            rows.push(Node::text([Span::new(format!("+{} more", children.len() - VISIBLE))]).fg(DIM));
        }
    }
    Node::column(rows)
}

fn row(child: &Child) -> Node {
    let state = if child.running { "running" } else { "done" };
    Node::row(vec![
        Node::text([Span::new("•")])
            .fg(if child.running { GREEN } else { DIM })
            .layout(Layout::default().shrink(false)),
        Node::text([Span::new(child.title.clone())])
            .fg("text.base")
            .wrap(Wrap::None)
            .truncate()
            .layout(Layout::default().grow().shrink(true).min_width_zero()),
        Node::text([Span::new(state)]).fg(DIM).wrap(Wrap::None).layout(Layout::default().shrink(false)),
    ])
    .gap(1)
    .layout(Layout::default().min_width_zero())
    .on_click(Click::command(OPEN, Some(child.id.clone())).on_down())
}

export_plugin!("subagents-sidebar", setup);
