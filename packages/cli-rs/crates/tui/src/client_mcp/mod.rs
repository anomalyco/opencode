//! The client MCP socket (E.13b, rows A05 and X03): `context/client-mcp.tsx`.
//!
//! While the `client-mcp` experiment is on, the TUI serves two tools to the server as the client MCP server `tui`, so
//! the model sees `tui_open_terminal` and `tui_write_terminal`. Both act on the terminal of the calling session's
//! family that this TUI shows: the routed session if it is in that family, else the family's root while it is open in
//! a tab. The socket reconnects when the flag, the viewed location, or the server changes.

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::{Arc, Mutex};

use opencode_api::client::Auth;
use opencode_api::client_mcp::{
    self, Connection, Connector, Options, Tool, ToolResult, Tungstenite,
};
use opencode_api::generated::{SessionID, V2Event};
use serde_json::{Map, Value, json};
use tokio::sync::oneshot;

use crate::app::Tui;
use crate::routes::Route;

const EXPERIMENT: &str = "client-mcp";

#[derive(Default)]
pub struct ClientMcp {
    key: RefCell<Option<String>>,
    connection: RefCell<Option<Connection>>,
    connector: RefCell<Option<Arc<dyn Connector>>>,
}

impl ClientMcp {
    /// Replaces how the socket opens; tests serve a fake one. Takes effect at the next reconnect.
    pub fn set_connector(&self, connector: Arc<dyn Connector>) {
        *self.connector.borrow_mut() = Some(connector);
    }

    /// Whether a connection is running.
    pub fn connected(&self) -> bool {
        self.connection.borrow().is_some()
    }
}

/// A tool call, posted from the socket task to the UI thread.
struct Call {
    tool: Kind,
    session: Option<String>,
    text: Option<Value>,
    reply: Mutex<Option<oneshot::Sender<ToolResult>>>,
}

#[derive(Clone, Copy)]
enum Kind {
    Open,
    Write,
}

/// Takes tool calls on the UI thread and connects when the flag is on. `app::mount_with` calls it once.
pub fn install(tui: &Rc<Tui>) {
    let weak = tui.weak();
    tui.app.on_message(move |_, call: &Call| {
        let Some(tui) = weak.upgrade() else { return };
        let Some(reply) = call.reply.lock().ok().and_then(|mut reply| reply.take()) else {
            return;
        };
        let done = move |result: ToolResult| {
            let _ = reply.send(result);
        };
        match call.tool {
            Kind::Open => terminal_for(&tui, call.session.clone(), move |_, result| {
                done(match result {
                    Ok(id) => ToolResult::text(format!("Opened terminal {id}")),
                    Err(failure) => failure,
                })
            }),
            Kind::Write => {
                let Some(text) = call
                    .text
                    .as_ref()
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                else {
                    done(ToolResult::error("text must be a string"));
                    return;
                };
                terminal_for(&tui, call.session.clone(), move |tui, result| {
                    done(match result {
                        Ok(id) => {
                            tui.terminals.write(&id, text.as_bytes());
                            ToolResult::text(format!("Wrote to terminal {id}"))
                        }
                        Err(failure) => failure,
                    })
                })
            }
        }
    });
    tui.settings.on_change(sync);
    sync(tui);
}

/// `server.connected` (TS `client.event.on("server.connected", sync)`).
pub fn event(tui: &Tui, event: &V2Event) {
    if matches!(event, V2Event::ServerConnected(_)) {
        sync(tui);
    }
}

/// Connects, reconnects, or disconnects when the flag, the server, or the viewed location changed. Server MCP is
/// Location-scoped, so only sessions in the viewed location's directory see the tools.
pub fn sync(tui: &Tui) {
    let client = tui.data.client();
    let directory = crate::features::location::current(tui)
        .map(|location| location.directory)
        .unwrap_or_else(|| {
            tui.data
                .read(|state| state.default_location().directory.clone())
        });
    let (url, headers) = endpoint(client.base_url(), client.credentials());
    let key = tui
        .settings
        .experiment(EXPERIMENT)
        .then(|| json!([url.as_str(), headers, directory]).to_string());
    let state = &tui.client_mcp;
    if *state.key.borrow() == key {
        return;
    }
    state.connection.borrow_mut().take();
    *state.key.borrow_mut() = key.clone();
    if key.is_none() {
        return;
    }
    let connector = state
        .connector
        .borrow()
        .clone()
        .unwrap_or_else(|| Arc::new(Tungstenite));
    let _guard = tui.app.runtime().enter();
    let connection = client_mcp::connect(
        Options {
            url,
            name: "tui".to_owned(),
            directory: Some(directory),
            headers,
            tools: tools(tui.app.proxy()),
        },
        connector,
    );
    *state.connection.borrow_mut() = Some(connection);
}

/// The server URL and handshake headers: Basic credentials go in `authorization`, query credentials in `auth_token`.
fn endpoint(base: &url::Url, auth: Option<&Auth>) -> (url::Url, Vec<(String, String)>) {
    let mut url = base.clone();
    match auth {
        Some(auth @ Auth::Basic { .. }) => (
            url,
            vec![(
                "authorization".to_owned(),
                format!("Basic {}", auth.token()),
            )],
        ),
        Some(auth @ Auth::Query { .. }) => {
            url.query_pairs_mut()
                .append_pair("auth_token", &auth.token());
            (url, Vec::new())
        }
        None => (url, Vec::new()),
    }
}

fn tools(proxy: opentui::prelude::AppProxy) -> Vec<Tool> {
    let tool = |name: &str, description: &str, schema: Value, kind: Kind| {
        let proxy = proxy.clone();
        Tool {
            name: name.to_owned(),
            description: Some(description.to_owned()),
            input_schema: schema.as_object().cloned().unwrap_or_default(),
            handler: Arc::new(
                move |args: Map<String, Value>, context: client_mcp::Context| {
                    let (reply, result) = oneshot::channel();
                    let call = Call {
                        tool: kind,
                        session: context.session_id,
                        text: args.get("text").cloned(),
                        reply: Mutex::new(Some(reply)),
                    };
                    let sent = proxy.send(call).map_err(|error| error.to_string());
                    Box::pin(async move {
                        sent?;
                        result
                            .await
                            .map_err(|_| "Unable to load terminal".to_owned())
                    })
                },
            ),
        }
    };
    vec![
        tool(
            "open_terminal",
            "Open a terminal for the current session in the user's TUI, without taking keyboard focus.",
            json!({ "type": "object" }),
            Kind::Open,
        ),
        tool(
            "write_terminal",
            "Type text into the current session's terminal in the user's TUI, opening one first if needed. Text is sent as-is; include a trailing newline to run a command.",
            json!({
                "type": "object",
                "properties": {
                    "text": { "type": "string", "description": "Text to send to the terminal, e.g. \"ls\\n\" to run ls." },
                },
                "required": ["text"],
            }),
            Kind::Write,
        ),
    ]
}

type Done = Box<dyn FnOnce(&Tui, Result<String, ToolResult>)>;

/// The terminal `open_terminal` shows for the calling session (the selected one, else the newest, else a new one),
/// or a tool failure.
fn terminal_for(
    tui: &Tui,
    called_by: Option<String>,
    done: impl FnOnce(&Tui, Result<String, ToolResult>) + 'static,
) {
    let done: Done = Box::new(done);
    let Some(called_by) = called_by.map(SessionID) else {
        return done(tui, Err(ToolResult::error("Unknown session")));
    };
    known(tui, called_by.clone(), move |tui| {
        if !tui.data.read(|state| state.session(&called_by).is_some()) {
            return done(tui, Err(ToolResult::error("Unknown session")));
        }
        // The server's answer to `/api/info` arrives on connect, long before a model can call the tool.
        if !tui.terminals.available() {
            return done(
                tui,
                Err(ToolResult::error("This server does not support terminals")),
            );
        }
        let (root, routed_root) = tui.data.read(|state| {
            let routed = match tui.route() {
                Route::Session { id } => Some((id.clone(), state.root(&id))),
                _ => None,
            };
            (state.root(&called_by), routed)
        });
        // Terminal panes render for the routed session; tabs hold root sessions, which become routed when selected.
        let target = match routed_root {
            Some((routed, routed_root)) if routed_root == root => Some(routed),
            _ if crate::tabs::Tabs::enabled(tui) && tui.tabs.open_ids(tui).contains(&root.0) => {
                Some(root)
            }
            _ => None,
        };
        let Some(target) = target else {
            return done(tui, Err(ToolResult::error("session not open in this TUI")));
        };
        known(tui, target.clone(), move |tui| {
            let session = target.clone();
            crate::terminal::refresh(tui, &target, false, move |tui| {
                // The agent opened it, so don't move the user's keyboard focus into a live shell.
                let selected = tui.terminals.selected_id(&session.0);
                let existing = selected.clone().or_else(|| {
                    tui.terminals
                        .list(&session.0)
                        .last()
                        .map(|terminal| terminal.id.0.clone())
                });
                match existing {
                    Some(id) => {
                        if selected.as_ref() != Some(&id) {
                            crate::terminal::select(tui, &session.0, Some(&id), false);
                        }
                        done(tui, Ok(id));
                    }
                    None => {
                        crate::terminal::create(tui, &session, false, move |tui, id| match id {
                            Some(id) => done(tui, Ok(id)),
                            None => done(tui, Err(ToolResult::error("Unable to load terminal"))),
                        })
                    }
                }
            });
        });
    });
}

/// Runs `then` once the session is in the store, reading it first if it is not; a failed read is ignored.
fn known(tui: &Tui, session: SessionID, then: impl FnOnce(&Tui) + 'static) {
    if tui.data.read(|state| state.session(&session).is_some()) {
        return then(tui);
    }
    let weak = tui.weak();
    tui.app
        .spawn(tui.data.session_sync(&session, false), move |_, _| {
            if let Some(tui) = weak.upgrade() {
                then(&tui);
            }
        });
}
