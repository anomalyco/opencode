//! Server-driven events (E.1, rows T10 to T12, `app.tsx:556-584,1338-1377`):
//!
//! - `tui.command.execute`, `tui.toast.show`, `tui.session.select`, and `tui.prompt.append`
//!   (`prompt/index.tsx:341-352`), for the current location only;
//! - `session.deleted` of the open session goes home with a toast;
//! - `session.execution.succeeded` of the open session reloads the usage limits (`usage.tsx:219-223`);
//! - a toast when an MCP server of the default location fails or needs authentication, once per state.
//!
//! `session.moved` updates the open dialog's cache, which E.11a replaced with the store's sessions.
//! `app::mount` calls [`install`] once and `Tui::sync` calls [`sync`]. The app's pump posts each store signal once as
//! a [`Signal`]; [`handle`] sees it first, then every [`subscribe`]r in order.

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use opencode_api::generated::{McpServerStatus, V2Event};
use opencode_store::Changes;
use opencode_ui::bind;
use opencode_ui::toast::{ToastOptions, Variant};
use opentui::keymap::Disposer;

use crate::app::Tui;
use crate::routes::Route;

type Subscribers = Rc<RefCell<Vec<(u64, Rc<dyn Fn(&Tui, &V2Event)>)>>>;

/// The last status each MCP server was alerted for, and the signal subscribers.
#[derive(Default)]
pub struct Events {
    alerted: RefCell<HashMap<String, &'static str>>,
    subscribers: Subscribers,
    next: Cell<u64>,
}

/// One event the store passed on, posted to the UI thread.
#[derive(Clone)]
pub(crate) struct Signal(pub Arc<V2Event>);

/// Declares [`Handled`], the events [`handle`] and the handlers it calls act on, and [`HANDLED`], their tags, which the
/// store passes on. The handlers match on [`Handled`], so acting on a type means adding it here.
macro_rules! handled {
    ($($tag:literal => $variant:ident($payload:ident)),* $(,)?) => {
        /// An event [`handle`] acts on.
        #[allow(dead_code, reason = "a handler may match a variant without reading its payload")]
        pub(crate) enum Handled<'a> {
            $($variant(&'a opencode_api::generated::$payload),)*
        }

        impl<'a> Handled<'a> {
            fn of(event: &'a V2Event) -> Option<Self> {
                match event {
                    $(V2Event::$variant(event) => Some(Self::$variant(event)),)*
                    _ => None,
                }
            }
        }

        /// Each tag of [`Handled`], with its variant.
        const HANDLED: &[(&str, &str)] = &[$(($tag, stringify!($variant))),*];
    };
}

handled! {
    "server.connected" => ServerConnected(V2EventServerConnected),
    "session.deleted" => SessionDeleted(SessionDeleted),
    "session.inbox.enqueued" => SessionInboxEnqueued(SessionInboxEnqueued),
    "session.execution.succeeded" => SessionExecutionSucceeded(SessionExecutionSucceeded),
    "worktree.updated" => WorktreeUpdated(WorktreeUpdated),
    "persistent-pty.added" => PersistentPtyAdded(PersistentPtyAdded),
    "persistent-pty.removed" => PersistentPtyRemoved(PersistentPtyRemoved),
    "persistent-pty.updated" => PersistentPtyUpdated(PersistentPtyUpdated),
    "tui.command.execute" => TuiCommandExecute(TuiCommandExecute),
    "tui.toast.show" => TuiToastShow(TuiToastShow),
    "tui.prompt.append" => TuiPromptAppend(TuiPromptAppend),
    "tui.session.select" => TuiSessionSelect(TuiSessionSelect),
}

pub fn install(tui: &Tui) {
    // For the TUI's lifetime.
    std::mem::forget(tui.data.listen(HANDLED.iter().map(|(tag, _)| *tag)));
    tui.app.on_message(bind!(tui, |tui, _, Signal(event)| {
        if let Some(event) = Handled::of(event) {
            handle(&tui, &event);
        }
        let subscribers: Vec<_> =
            tui.events.subscribers.borrow().iter().map(|(_, subscriber)| subscriber.clone()).collect();
        for subscriber in subscribers {
            subscriber(&tui, event);
        }
    }));
}

/// Calls `subscriber` with each store signal, after the TUI's own handling, until the disposer drops. The store passes
/// on the events of each type in `types`; `subscriber` also sees the types other subscribers asked for.
pub fn subscribe<S: Into<String>>(
    tui: &Tui,
    types: impl IntoIterator<Item = S>,
    subscriber: impl Fn(&Tui, &V2Event) + 'static,
) -> Disposer {
    let id = tui.events.next.get();
    tui.events.next.set(id + 1);
    tui.events.subscribers.borrow_mut().push((id, Rc::new(subscriber)));
    let subscribers = Rc::downgrade(&tui.events.subscribers);
    let listening = tui.data.listen(types);
    Disposer::new(move || {
        drop(listening);
        if let Some(subscribers) = subscribers.upgrade() {
            subscribers.borrow_mut().retain(|(other, _)| *other != id);
        }
    })
}

pub fn sync(tui: &Tui, changes: &Changes) {
    let default = tui.data.read(|state| state.default_location().clone());
    if changes.location(&default) {
        mcp_toasts(tui);
    }
    crate::dialogs::model::usage_alerts(&tui.local);
}

fn handle(tui: &Tui, event: &Handled) {
    // Pins and the worktrees dialog see every event, tabs or not (E.11b).
    crate::features::quick_switch::event(tui, event);
    crate::dialogs::worktrees::event(event);
    crate::dialogs::open::event(event);
    // Every connection, also one the connection status coalesced (`context/location.tsx`).
    if let Handled::ServerConnected(_) = event {
        crate::features::location::reconnected(tui);
    }
    if let Handled::SessionDeleted(event) = event {
        tui.local.forget(&event.data.session_id);
    }
    // The tab strip sees `session.deleted` first; with tabs on it leaves the deleted tab without a toast.
    if crate::tabs::event(tui, event) {
        return;
    }
    crate::terminal::event(tui, event);
    crate::client_mcp::event(tui, event);
    match event {
        Handled::TuiCommandExecute(event) if here(tui, event.location.as_ref()) => {
            tui.keymap.dispatch(&event.data.command, None);
        }
        Handled::TuiToastShow(event) if here(tui, event.location.as_ref()) => {
            let data = &event.data;
            let mut toast = ToastOptions::new(variant(data.variant.as_str()), data.message.clone());
            toast.title = data.title.clone();
            toast.duration = data.duration.map(|duration| Duration::from_millis(duration.max(0) as u64));
            tui.toasts.show(toast);
        }
        Handled::TuiPromptAppend(event) if here(tui, event.location.as_ref()) => {
            let prompt = tui.prompt.current.borrow().upgrade();
            if let Some(prompt) = prompt {
                prompt.textarea.insert(&event.data.text);
                prompt.textarea.set_cursor_offset(prompt.text_end());
            }
        }
        Handled::SessionExecutionSucceeded(event)
            if tui.route() == (Route::Session { id: event.data.session_id.clone() })
                && matches!(tui.local.usage(), Some(Some(_))) =>
        {
            tui.local.load_usage(true);
        }
        Handled::TuiSessionSelect(event) if here(tui, event.location.as_ref()) => {
            tui.navigate(Route::Session { id: event.data.session_id.clone() });
        }
        Handled::SessionDeleted(event) => {
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
        let toast = if status == "needs_auth" {
            ToastOptions::new(Variant::Warning, format!("Connect \"{name}\" to use its tools."))
                .title("MCP server needs authentication")
        } else {
            ToastOptions::new(Variant::Error, "Run /mcps to view details.").title(format!("MCP server failed: {name}"))
        };
        tui.toasts.show(toast.action(
            "Open MCP servers",
            bind!(tui, |tui| {
                tui.keymap.dispatch("mcp.list", None);
            }),
        ));
    }
}

#[cfg(test)]
mod tests {
    // Expected: each tag the store passes on for `handle` is the tag of the variant `handle` matches on.
    #[test]
    fn each_handled_tag_names_its_variant() {
        for (tag, variant) in super::HANDLED {
            let name: String = tag.split(['.', '-']).map(|part| part[..1].to_uppercase() + &part[1..]).collect();
            assert_eq!(&name, variant, "{tag}");
        }
    }
}
