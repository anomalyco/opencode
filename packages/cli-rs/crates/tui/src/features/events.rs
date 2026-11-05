//! Server-driven events (E.1, rows T10 to T12, `app.tsx:556-584,1338-1377`):
//!
//! - `tui.command.execute`, `tui.toast.show`, `tui.session.select`, and `tui.prompt.append`
//!   (`prompt/index.tsx:341-352`), for the current location only;
//! - `session.deleted` of the open session goes home with a toast;
//! - `session.execution.succeeded` of the open session reloads the usage limits (`usage.tsx:219-223`);
//! - a toast when an MCP server of the default location fails or needs authentication, once per state.
//!
//! `session.moved` updates the open dialog's cache, which E.11a replaced with the store's sessions.
//! `app::mount` calls [`install`] once and `Tui::sync` calls [`sync`].

use std::cell::RefCell;
use std::collections::HashMap;
use std::time::Duration;

use opencode_api::generated::{McpServerStatus, V2Event};
use opencode_store::Changes;
use opencode_ui::toast::{ToastOptions, Variant};

use crate::app::Tui;
use crate::routes::Route;

/// The last status each MCP server was alerted for.
#[derive(Default)]
pub struct Events {
    alerted: RefCell<HashMap<String, &'static str>>,
}

/// One event the store passed on, posted to the UI thread.
struct Signal(V2Event);

pub fn install(tui: &Tui) {
    let weak = tui.weak();
    tui.app.on_message(move |_, Signal(event)| {
        if let Some(tui) = weak.upgrade() {
            handle(&tui, event);
        }
    });
    let mut signals = tui.data.signals();
    let proxy = tui.app.proxy();
    tui.app.runtime().spawn(async move {
        loop {
            match signals.recv().await {
                Ok(event) => {
                    if proxy.send(Signal(event)).is_err() {
                        return;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(skipped)) => {
                    log::warn!("the UI skipped {skipped} server events");
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => return,
            }
        }
    });
}

pub fn sync(tui: &Tui, changes: &Changes) {
    let default = tui.data.read(|state| state.default_location().clone());
    if changes.location(&default) {
        mcp_toasts(tui);
    }
    crate::dialogs::model::usage_alerts(&tui.local);
}

fn handle(tui: &Tui, event: &V2Event) {
    // Pins and the worktrees dialog see every event, tabs or not (E.11b).
    crate::features::quick_switch::event(tui, event);
    crate::dialogs::worktrees::event(event);
    if let V2Event::SessionDeleted(event) = event {
        tui.local.forget(&event.data.session_id);
    }
    // The tab strip sees `session.deleted` first; with tabs on it leaves the deleted tab without a toast.
    if crate::tabs::event(tui, event) {
        return;
    }
    crate::terminal::event(tui, event);
    crate::client_mcp::event(tui, event);
    match event {
        V2Event::TuiCommandExecute(event) if here(tui, event.location.as_ref()) => {
            tui.keymap.dispatch(&event.data.command, None);
        }
        V2Event::TuiToastShow(event) if here(tui, event.location.as_ref()) => {
            let data = &event.data;
            let mut toast = ToastOptions::new(variant(data.variant.as_str()), data.message.clone());
            toast.title = data.title.clone();
            toast.duration = data
                .duration
                .map(|duration| Duration::from_millis(duration.max(0) as u64));
            tui.toasts.show(toast);
        }
        V2Event::TuiPromptAppend(event) if here(tui, event.location.as_ref()) => {
            let prompt = tui.prompt.current.borrow().upgrade();
            if let Some(prompt) = prompt {
                prompt.textarea.insert(&event.data.text);
                prompt.textarea.set_cursor_offset(prompt.text_end());
            }
        }
        V2Event::SessionExecutionSucceeded(event)
            if tui.route()
                == (Route::Session {
                    id: event.data.session_id.clone(),
                })
                && matches!(tui.local.usage(), Some(Some(_))) =>
        {
            tui.local.load_usage(true);
        }
        V2Event::TuiSessionSelect(event) if here(tui, event.location.as_ref()) => {
            tui.navigate(Route::Session {
                id: event.data.session_id.clone(),
            });
        }
        V2Event::SessionDeleted(event) => {
            let Route::Session { id } = tui.route() else {
                return;
            };
            if id != event.data.session_id {
                return;
            }
            // The store already dropped the session; the title is the one last shown (`active`).
            let title = tui.title.active(&id);
            tui.navigate(Route::Home);
            tui.toasts.show(ToastOptions::new(
                Variant::Info,
                match title {
                    Some(title) => format!("Session \"{title}\" was deleted"),
                    None => "The current session was deleted".to_owned(),
                },
            ));
        }
        _ => {}
    }
}

/// Whether an event's location is the current one (`location.current?.directory ?? default`).
fn here(tui: &Tui, location: Option<&opencode_api::generated::LocationRef>) -> bool {
    let current = crate::features::location::current(tui)
        .unwrap_or_else(|| tui.data.read(|state| state.default_location().clone()));
    location.is_some_and(|location| location.directory.0 == current.directory)
}

fn variant(name: &str) -> Variant {
    match name {
        "success" => Variant::Success,
        "warning" => Variant::Warning,
        "error" => Variant::Error,
        _ => Variant::Info,
    }
}

/// Toasts once when an MCP server enters a failed or needs-auth state; a server that recovers can alert
/// again.
fn mcp_toasts(tui: &Tui) {
    let servers: Vec<(String, Option<&'static str>)> = tui.data.read(|state| {
        state
            .location(None)
            .and_then(|location| location.mcp_server.as_ref())
            .map(|servers| {
                servers
                    .iter()
                    .map(|server| {
                        let status = match server.status {
                            McpServerStatus::Failed(_) => Some("failed"),
                            McpServerStatus::NeedsAuth(_) => Some("needs_auth"),
                            _ => None,
                        };
                        (server.name.clone(), status)
                    })
                    .collect()
            })
            .unwrap_or_default()
    });
    for (name, status) in servers {
        let Some(status) = status else {
            tui.events.alerted.borrow_mut().remove(&name);
            continue;
        };
        if tui.events.alerted.borrow_mut().insert(name.clone(), status) == Some(status) {
            continue;
        }
        let weak = tui.weak();
        let toast = if status == "needs_auth" {
            ToastOptions::new(
                Variant::Warning,
                format!("Connect \"{name}\" to use its tools."),
            )
            .title("MCP server needs authentication")
        } else {
            ToastOptions::new(Variant::Error, "Run /mcps to view details.")
                .title(format!("MCP server failed: {name}"))
        };
        tui.toasts.show(toast.action("Open MCP servers", move || {
            if let Some(tui) = weak.upgrade() {
                tui.keymap.dispatch("mcp.list", None);
            }
        }));
    }
}
