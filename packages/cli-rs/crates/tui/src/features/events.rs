//! Dispatch store signals to the TUI, then subscribers in registration order.

use std::sync::Arc;

use opencode_api::generated::{EventKind, McpServerStatus, V2Event};
use opencode_api::kinds::EventKinds;

use crate::prelude::*;

type Subscribers = Rc<RefCell<Vec<(u64, Rc<dyn Fn(&Tui, &V2Event)>)>>>;
type DeltaSubscribers = Rc<RefCell<Vec<(u64, Rc<opencode_store::DeltaListening>, Rc<dyn Fn(&[V2Event])>)>>>;

/// Last reported MCP status per server and subscribers to signals and deltas.
#[derive(Default)]
pub struct Events {
    alerted: RefCell<HashMap<String, &'static str>>,
    subscribers: Subscribers,
    deltas: DeltaSubscribers,
    /// The deltas are handed over before the next frame.
    deltas_due: Cell<bool>,
    /// The signals a sync took, kept for their buffer.
    signals: Cell<Vec<V2Event>>,
    next: Cell<u64>,
    /// The route the usage alerts last looked at.
    alerted_route: RefCell<Option<Rc<Route>>>,
}

/// One signal posted to the UI, as a test sends it.
struct Signal(Arc<V2Event>);

/// Declares [`Handled`], the events [`handle`] and the handlers it calls act on, and [`HANDLED`], their kinds, which
/// the store passes on. The handlers match on [`Handled`], so acting on a type means adding it here.
macro_rules! handled {
    ($($variant:ident($payload:ident)),* $(,)?) => {
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

        const HANDLED: [EventKind; [$(EventKind::$variant),*].len()] = [$(EventKind::$variant),*];
    };
}

handled! {
    ServerConnected(V2EventServerConnected),
    SessionDeleted(SessionDeleted),
    SessionInboxEnqueued(SessionInboxEnqueued),
    SessionExecutionSucceeded(SessionExecutionSucceeded),
    WorktreeUpdated(WorktreeUpdated),
    PersistentPtyAdded(PersistentPtyAdded),
    PersistentPtyRemoved(PersistentPtyRemoved),
    PersistentPtyUpdated(PersistentPtyUpdated),
    TuiCommandExecute(TuiCommandExecute),
    TuiToastShow(TuiToastShow),
    TuiPromptAppend(TuiPromptAppend),
    TuiSessionSelect(TuiSessionSelect),
}

pub fn install(tui: &Tui) {
    std::mem::forget(tui.data.listen(HANDLED));
    tui.app.on_message(bind!(tui, |tui, _, Signal(event)| signal(&tui, event)));
}

#[doc(hidden)]
pub mod testing {
    use super::*;

    pub fn signal(tui: &Tui, event: V2Event) {
        let _ = tui.app.proxy().send(Signal(Arc::new(event)));
    }
}

/// Hands the events the store passed on since the last sync to the TUI and the subscribers, in order.
pub(crate) fn signals(tui: &Tui) {
    // Taken out of its cell, so a sync a handler runs takes its own.
    let mut events = tui.events.signals.take();
    tui.data.take_signals(&mut events);
    for event in &events {
        signal(tui, event);
    }
    events.clear();
    tui.events.signals.set(events);
}

fn signal(tui: &Tui, event: &V2Event) {
    // Flush the previous signal's plugin actions before the next signal can navigate.
    opencode_plugin::flush();
    if let Some(event) = Handled::of(event) {
        handle(tui, &event);
    }
    let subscribers: Vec<_> =
        tui.events.subscribers.borrow().iter().map(|(_, subscriber)| subscriber.clone()).collect();
    for subscriber in subscribers {
        subscriber(tui, event);
    }
}

/// Calls `subscriber` with each store signal, after the TUI's own handling, until the disposer drops. The store passes
/// on the events of each type in `types`; `subscriber` also sees the types other subscribers asked for.
pub fn subscribe(tui: &Tui, types: impl Into<EventKinds>, subscriber: impl Fn(&Tui, &V2Event) + 'static) -> Disposer {
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

/// Deliver accumulated streaming deltas once per frame until the subscription is disposed.
pub fn subscribe_deltas(tui: &Tui, subscriber: impl Fn(&[V2Event]) + 'static) -> Disposer {
    let id = tui.events.next.get();
    tui.events.next.set(id + 1);
    let listening = Rc::new(tui.data.listen_deltas());
    tui.events.deltas.borrow_mut().push((id, listening, Rc::new(subscriber)));
    let subscribers = Rc::downgrade(&tui.events.deltas);
    Disposer::new(move || {
        if let Some(subscribers) = subscribers.upgrade() {
            subscribers.borrow_mut().retain(|(other, ..)| *other != id);
        }
    })
}

/// Hands the deltas the store applied to the delta subscribers before the next frame, once for all the syncs until
/// then.
pub fn deltas(tui: &Tui) {
    if tui.events.deltas.borrow().is_empty() || tui.events.deltas_due.replace(true) {
        return;
    }
    tui.app.defer(bind!(tui, |tui, _| {
        tui.events.deltas_due.set(false);
        let subscribers = tui.events.deltas.borrow().clone();
        for (id, listening, subscriber) in subscribers {
            // One an earlier subscriber's call disposed gets none.
            if !tui.events.deltas.borrow().iter().any(|(other, ..)| *other == id) {
                continue;
            }
            listening.take(|events| {
                if !events.is_empty() {
                    subscriber(events);
                }
            });
        }
    }));
    tui.app.request_redraw();
}

pub fn sync(tui: &Tui, changes: &Changes) {
    if tui.data.read(|state| changes.location(state.default_location())) {
        mcp_toasts(tui);
    }
    // The alerts follow the local selections and catalogs on their own ([`crate::local::Local::sync`] tells of a
    // catalog change); here they follow the route and the routed session's selection.
    let route = tui.route();
    let moved = tui.events.alerted_route.borrow().as_ref().is_none_or(|seen| !Rc::ptr_eq(seen, &route));
    let session = matches!(&*route, Route::Session { id } if changes.has(id, Touched::INFO | Touched::SELECTED));
    if moved || session {
        crate::dialogs::model::usage_alerts(&tui.local);
    }
    *tui.events.alerted_route.borrow_mut() = Some(route);
}

fn handle(tui: &Tui, event: &Handled) {
    crate::features::quick_switch::event(tui, event);
    crate::dialogs::worktrees::event(event);
    crate::dialogs::open::event(event);
    // Include connections that coalesce into a single status change.
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
            if *tui.route() == (Route::Session { id: event.data.session_id.clone() })
                && matches!(tui.local.usage(), Some(Some(_))) =>
        {
            tui.local.load_usage(true);
        }
        Handled::TuiSessionSelect(event) if here(tui, event.location.as_ref()) => {
            tui.show_session(event.data.session_id.clone());
        }
        Handled::SessionDeleted(event) => {
            let route = tui.route();
            let Route::Session { id } = &*route else { return };
            if *id != event.data.session_id {
                return;
            }
            // The store already dropped the session; the title is the one last shown (`active`).
            let title = tui.title.active(id);
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
