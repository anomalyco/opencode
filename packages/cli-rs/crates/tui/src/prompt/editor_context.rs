//! IDE editor context (E.5, row P08): the file and selection open in the IDE the terminal runs in
//! (`context/editor.ts`, `editor.ts`, `editor-zed.ts`).
//!
//! Two sources, tried in this order on every connection attempt:
//!
//! - the IDE's MCP server over a WebSocket, at `CLAUDE_CODE_SSE_PORT` or `OPENCODE_EDITOR_SSE_PORT`, else at the
//!   port of the best `~/.claude/ide/<port>.lock` for the directory. It sends `selection_changed` and
//!   `at_mentioned` notifications;
//! - in a Zed terminal, Zed's SQLite database (`OPENCODE_ZED_DB`, else Zed's default path), read every second.
//!
//! A task on the runtime owns the socket and the polling; it posts what it reads to the UI thread, where
//! [`Context`] keeps the state the prompt shows. Changing the directory replaces the task.

use std::cell::RefCell;
use std::path::{Path, PathBuf};
use std::rc::{Rc, Weak};
use std::sync::Arc;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use opencode_ui::bind;
use opentui::keymap::Disposer;
use opentui::prelude::*;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio_tungstenite::tungstenite::Message as Frame;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;

use crate::app::Tui;

const MCP_PROTOCOL_VERSION: &str = "2025-11-25";
/// How often a Zed terminal reads the database again (`scheduleZedPoll`).
const ZED_POLL: Duration = Duration::from_secs(1);

/// Where the editor context comes from. [`Source::from_env`] reads the process environment; tests build one.
#[derive(Clone, Debug, Default)]
pub struct Source {
    /// `CLAUDE_CODE_SSE_PORT`, else `OPENCODE_EDITOR_SSE_PORT`.
    pub port: Option<u16>,
    /// The home directory whose `.claude/ide` lock files name IDE servers.
    pub home: Option<PathBuf>,
    /// `ZED_TERM=true` or `TERM_PROGRAM=zed`.
    pub zed_terminal: bool,
    /// The Zed database candidates; the first that is a file is read (`resolveZedDbPath`).
    pub zed_db: Vec<PathBuf>,
}

impl Source {
    pub fn from_env() -> Self {
        let var = |name: &str| std::env::var(name).ok().filter(|value| !value.is_empty());
        let home = var("HOME").map(PathBuf::from);
        let port = var("CLAUDE_CODE_SSE_PORT")
            .or_else(|| var("OPENCODE_EDITOR_SSE_PORT"))
            .and_then(|value| parse_port(&value));
        let zed_terminal = var("ZED_TERM").as_deref() == Some("true")
            || var("TERM_PROGRAM").is_some_and(|value| value.to_lowercase() == "zed");
        let zed_db = var("OPENCODE_ZED_DB")
            .map(PathBuf::from)
            .into_iter()
            .chain(home.iter().flat_map(|home| {
                [
                    home.join("Library/Application Support/Zed/db/0-stable/db.sqlite"),
                    home.join(".local/share/zed/db/0-stable/db.sqlite"),
                ]
            }))
            .collect();
        Self { port, home, zed_terminal, zed_db }
    }
}

/// A 1-based line and column, as the IDE sends them.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
pub struct Position {
    pub line: i64,
    pub character: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
pub struct Span {
    pub start: Position,
    pub end: Position,
}

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct Range {
    pub text: String,
    pub selection: Span,
}

impl Range {
    /// Whether the range selects something rather than only placing the cursor (`hasEditorRangeSelection`).
    pub fn selects(&self) -> bool {
        self.selection.start != self.selection.end
    }

    /// `#12` or `#12-20`, for a range that selects something (`getEditorRangeLabel`).
    pub fn label(&self) -> Option<String> {
        if !self.selects() {
            return None;
        }
        let (start, end) = (self.selection.start.line, self.selection.end.line);
        Some(if start == end { format!("#{start}") } else { format!("#{start}-{end}") })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceKind {
    Websocket,
    Zed,
}

/// The open file and its selections, at least one.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Selection {
    pub file_path: String,
    pub source: Option<SourceKind>,
    pub ranges: Vec<Range>,
}

impl Selection {
    /// Decodes either wire shape: `{filePath, ranges}` or one `{text, filePath, selection}` (`EditorSelectionSchema`).
    pub fn decode(value: &Value) -> Option<Self> {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Ranges {
            file_path: String,
            source: Option<SourceKind>,
            ranges: Vec<Range>,
        }
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Single {
            text: String,
            file_path: String,
            source: Option<SourceKind>,
            selection: Span,
        }
        if let Ok(value) = Ranges::deserialize(value)
            && !value.ranges.is_empty()
        {
            return Some(Self { file_path: value.file_path, source: value.source, ranges: value.ranges });
        }
        let value = Single::deserialize(value).ok()?;
        Some(Self {
            file_path: value.file_path,
            source: value.source,
            ranges: vec![Range { text: value.text, selection: value.selection }],
        })
    }

    /// What tells two selections apart (`editorSelectionKey`).
    pub fn key(&self) -> String {
        let mut parts = vec![self.file_path.clone()];
        for range in &self.ranges {
            let span = range.selection;
            parts.extend(
                [span.start.line, span.start.character, span.end.line, span.end.character]
                    .map(|value| value.to_string()),
            );
            parts.push(range.text.clone());
        }
        parts.join("\0")
    }

    /// The footer's label: the file name (with its directory for an `index.*`), the first selected range, and
    /// how many more ranges there are.
    pub fn label(&self) -> String {
        let path = Path::new(&self.file_path);
        let name = path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default();
        let is_index = name
            .strip_prefix("index.")
            .is_some_and(|extension| !extension.is_empty() && !extension.contains(['.', '/']));
        let file = match path.parent().and_then(Path::file_name) {
            Some(parent) if is_index => format!("{}/{name}", parent.to_string_lossy()),
            _ => name,
        };
        let first = self.ranges.iter().find(|range| range.selects()).or(self.ranges.first());
        let label =
            [first.and_then(Range::label), (self.ranges.len() > 1).then(|| format!("+{}", self.ranges.len() - 1))]
                .into_iter()
                .flatten()
                .collect::<Vec<_>>()
                .join(" ");
        format!("{file}{label}")
    }

    /// The synthetic message sent before the prompt (`formatEditorContext`).
    pub fn reminder(&self) -> String {
        let selected: Vec<&Range> = self.ranges.iter().filter(|range| range.selects()).collect();
        if selected.is_empty() {
            return format!(
                "<system-reminder>Note: The user opened the file \"{}\". This may or may not be relevant to the current task.</system-reminder>\n",
                self.file_path
            );
        }
        let ranges: Vec<String> = selected
            .iter()
            .enumerate()
            .map(|(index, range)| {
                let prefix = if selected.len() > 1 { format!("Selection {}: ", index + 1) } else { String::new() };
                format!(
                    "Note: The user selected {prefix}{} from \"{}\". ```{}```\n\n",
                    range.label().unwrap_or_default(),
                    self.file_path,
                    range.text
                )
            })
            .collect();
        format!(
            "<system-reminder>{} This may or may not be relevant to the current task.</system-reminder>\n",
            ranges.join("\n")
        )
    }
}

/// An `at_mentioned` notification: the IDE asks to mention a file, with its lines.
#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Mention {
    pub file_path: String,
    pub line_start: i64,
    pub line_end: i64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Status {
    #[default]
    Disabled,
    Connecting,
    Connected,
}

/// How the footer shows the file: not at all, highlighted until it is sent, or muted once sent.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LabelState {
    None,
    Pending,
    Sent,
}

/// The app-wide editor context (`useEditorContext`). Nothing connects until [`start`].
#[derive(Default)]
pub struct Context(Rc<RefCell<State>>);

#[derive(Default)]
struct State {
    status: Status,
    selection: Option<Selection>,
    sent: bool,
    /// The IDE server's `initialize` result.
    server: Option<Value>,
    last_zed_key: Option<String>,
    /// Keep the selection over the next reconnect: a new session opens with it.
    preserve: bool,
    directory: String,
    started: Option<Started>,
    generation: u64,
    next_listener: u64,
    mentions: Vec<(u64, MentionListener)>,
    watchers: Vec<(u64, Rc<dyn Fn()>)>,
}

type MentionListener = Rc<dyn Fn(&Mention)>;

struct Started {
    source: Arc<Source>,
    proxy: AppProxy,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for State {
    fn drop(&mut self) {
        if let Some(started) = &self.started {
            started.task.abort();
        }
    }
}

/// What the task posts to the UI thread, tagged with the task's generation.
struct Posted {
    generation: u64,
    event: Event,
}

enum Event {
    Status(Status),
    Selection(Selection),
    Mention(Mention),
    Server(Value),
    /// A Zed read: the selection, or `None` when Zed shows no file selection.
    Zed(Option<Selection>),
}

/// Starts reading the editor context from `source` for the TUI's directory.
pub fn start(tui: &Tui, source: Source) {
    let context = &tui.prompt.editor;
    if context.0.borrow().started.is_none() {
        let weak = Rc::downgrade(&context.0);
        tui.app.on_message(bind!(weak, |state, _, posted: &Posted| Context(state).apply(posted)));
    }
    let mut state = context.0.borrow_mut();
    if let Some(started) = state.started.take() {
        started.task.abort();
    }
    state.directory = tui.directory.clone();
    let source = Arc::new(source);
    let proxy = tui.app.proxy();
    state.generation += 1;
    let task = spawn(tui, &source, &state.directory, state.generation, &proxy);
    state.started = Some(Started { source, proxy, task });
}

fn spawn(
    tui: &Tui,
    source: &Arc<Source>,
    directory: &str,
    generation: u64,
    proxy: &AppProxy,
) -> tokio::task::JoinHandle<()> {
    tui.app.runtime().spawn(worker(source.clone(), directory.to_owned(), generation, proxy.clone()))
}

impl Context {
    pub fn status(&self) -> Status {
        self.0.borrow().status
    }

    pub fn selection(&self) -> Option<Selection> {
        self.0.borrow().selection.clone()
    }

    /// The IDE server's `initialize` result, once it answered.
    pub fn server(&self) -> Option<Value> {
        self.0.borrow().server.clone()
    }

    pub fn label_state(&self) -> LabelState {
        let state = self.0.borrow();
        match (&state.selection, state.sent) {
            (None, _) => LabelState::None,
            (Some(_), false) => LabelState::Pending,
            (Some(_), true) => LabelState::Sent,
        }
    }

    pub fn clear_selection(&self) {
        self.0.borrow_mut().last_zed_key = None;
        self.set_selection(None);
    }

    pub fn mark_sent(&self) {
        let changed = {
            let mut state = self.0.borrow_mut();
            let changed = state.selection.is_some() && !state.sent;
            state.sent |= state.selection.is_some();
            changed
        };
        if changed {
            self.notify();
        }
    }

    /// The home prompt sent the selection with a new session: its reconnect keeps it.
    pub fn preserve_from_new_session(&self) {
        self.0.borrow_mut().preserve = true;
    }

    /// Calls `listener` for each `at_mentioned` notification.
    pub fn on_mention(&self, listener: impl Fn(&Mention) + 'static) -> Disposer {
        let id = self.listener_id();
        self.0.borrow_mut().mentions.push((id, Rc::new(listener)));
        let weak = Rc::downgrade(&self.0);
        Disposer::new(bind!(weak, |state| state.borrow_mut().mentions.retain(|(other, _)| *other != id)))
    }

    /// Calls `listener` when the selection or its label state changes.
    pub fn subscribe(&self, listener: impl Fn() + 'static) -> Disposer {
        let id = self.listener_id();
        self.0.borrow_mut().watchers.push((id, Rc::new(listener)));
        let weak: Weak<RefCell<State>> = Rc::downgrade(&self.0);
        Disposer::new(bind!(weak, |state| state.borrow_mut().watchers.retain(|(other, _)| *other != id)))
    }

    /// Follows the session's directory (`reconnect`); `None` is the TUI's own directory. The selection is
    /// cleared unless a new session asked to keep it.
    pub fn reconnect(&self, tui: &Tui, directory: Option<&str>) {
        let resolved = directory.filter(|directory| !directory.is_empty()).unwrap_or(&tui.directory).to_owned();
        let same = self.0.borrow().directory == resolved;
        let preserved = std::mem::take(&mut self.0.borrow_mut().preserve);
        if !preserved {
            if !same {
                self.0.borrow_mut().last_zed_key = None;
            }
            self.set_selection(None);
        }
        if same {
            return;
        }
        let mut state = self.0.borrow_mut();
        state.directory = resolved;
        state.status = Status::Disabled;
        state.server = None;
        state.generation += 1;
        let generation = state.generation;
        let directory = state.directory.clone();
        if let Some(started) = &mut state.started {
            started.task.abort();
            started.task = spawn(tui, &started.source, &directory, generation, &started.proxy);
        }
    }

    fn listener_id(&self) -> u64 {
        let mut state = self.0.borrow_mut();
        state.next_listener += 1;
        state.next_listener
    }

    fn set_selection(&self, selection: Option<Selection>) {
        let changed = {
            let mut state = self.0.borrow_mut();
            let changed = state.selection.as_ref().map(Selection::key) != selection.as_ref().map(Selection::key);
            state.selection = selection;
            if changed {
                state.sent = false;
            }
            changed
        };
        if changed {
            self.notify();
        }
    }

    fn notify(&self) {
        let watchers: Vec<_> = self.0.borrow().watchers.iter().map(|(_, watcher)| watcher.clone()).collect();
        watchers.iter().for_each(|watcher| watcher());
    }

    fn apply(&self, posted: &Posted) {
        if posted.generation != self.0.borrow().generation {
            return;
        }
        match &posted.event {
            Event::Status(status) => self.0.borrow_mut().status = *status,
            Event::Server(server) => self.0.borrow_mut().server = Some(server.clone()),
            Event::Selection(selection) => {
                self.set_selection(Some(Selection { source: Some(SourceKind::Websocket), ..selection.clone() }))
            }
            Event::Mention(mention) => {
                let listeners: Vec<_> = self.0.borrow().mentions.iter().map(|(_, listener)| listener.clone()).collect();
                listeners.iter().for_each(|listener| listener(mention));
            }
            Event::Zed(selection) => {
                let key = selection.as_ref().map(Selection::key);
                if key == self.0.borrow().last_zed_key {
                    return;
                }
                self.0.borrow_mut().last_zed_key = key;
                self.0.borrow_mut().status = if selection.is_some() { Status::Connected } else { Status::Disabled };
                self.set_selection(selection.clone());
            }
        }
    }
}

/// Inserts the IDE's mention as a file part with its lines (`insertFileMention`): over the open `@` query, else
/// at the cursor. The path is relative to the prompt's location when it is inside it.
pub fn insert_mention(prompt: &crate::prompt::editor::Inner, tui: &Tui, mention: &Mention) {
    use crate::prompt::autocomplete::{parse, parts};
    let base = prompt.location(tui).directory;
    let path = parse::mention_path(&base, &mention.file_path);
    let end = (mention.line_end > mention.line_start).then_some(mention.line_end);
    let mut uri = parse::file_url(&absolute(&mention.file_path).to_string_lossy());
    uri.push_str(&format!("?start={}", mention.line_start));
    let mut name = format!("{path}#{}", mention.line_start);
    if let Some(end) = end {
        uri.push_str(&format!("&end={end}"));
        name.push_str(&format!("-{end}"));
    }
    let cursor = prompt.textarea.cursor_offset();
    let start = prompt.autocomplete.get().map_or(cursor, |complete| complete.mention_start(cursor));
    parts::insert(prompt, start, &name, parts::Kind::File, json!({ "uri": uri, "name": name }));
}

/// An IDE server to connect to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Connection {
    pub url: String,
    pub auth_token: Option<String>,
}

/// The environment's port, else the best lock file for `directory` (`resolveEditorConnection`).
pub fn resolve_connection(source: &Source, directory: &str) -> Option<Connection> {
    if let Some(port) = source.port {
        return Some(Connection { url: format!("ws://127.0.0.1:{port}"), auth_token: None });
    }
    discover(&source.home.as_ref()?.join(".claude").join("ide"), directory)
}

/// The `<port>.lock` in `root` whose workspace folder contains `directory` most closely, newest first on a tie
/// (`discoverEditorConnection`). Only WebSocket transports count.
pub fn discover(root: &Path, directory: &str) -> Option<Connection> {
    let directory = absolute(directory);
    let mut found: Vec<(usize, std::time::SystemTime, Connection)> = std::fs::read_dir(root)
        .ok()?
        .flatten()
        .filter_map(|entry| {
            let path = entry.path();
            let port = path.file_name()?.to_str()?.strip_suffix(".lock").and_then(parse_port)?;
            let value: Value = serde_json::from_str(&std::fs::read_to_string(&path).ok()?).ok()?;
            if value.get("transport").is_some_and(|transport| transport != "ws") {
                return None;
            }
            let score = value["workspaceFolders"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(|folder| {
                    let folder = absolute(folder);
                    if contains(&folder, &directory) { folder.to_string_lossy().encode_utf16().count() } else { 0 }
                })
                .max()
                .filter(|score| *score > 0)?;
            let modified = entry.metadata().ok()?.modified().ok()?;
            Some((
                score,
                modified,
                Connection {
                    url: format!("ws://127.0.0.1:{port}"),
                    auth_token: value["authToken"].as_str().map(str::to_owned),
                },
            ))
        })
        .collect();
    found.sort_by(|left, right| right.0.cmp(&left.0).then(right.1.cmp(&left.1)));
    found.into_iter().next().map(|(_, _, connection)| connection)
}

/// `Number.parseInt(value, 10)` limited to a port: leading digits, 1 to 65535.
fn parse_port(value: &str) -> Option<u16> {
    let value = value.trim_start();
    let value = value.strip_prefix('+').unwrap_or(value);
    let digits: String = value.chars().take_while(char::is_ascii_digit).collect();
    digits.parse::<u16>().ok().filter(|port| *port > 0)
}

/// `path.resolve`: absolute against the process's directory, and lexically normalized.
fn absolute(path: &str) -> PathBuf {
    let base = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
    PathBuf::from(super::autocomplete::parse::resolve(&base.to_string_lossy(), path))
}

/// Whether `child` is `parent` or inside it (`pathContains`); both absolute and normalized.
fn contains(parent: &Path, child: &Path) -> bool {
    child.starts_with(parent)
}

/// The connection loop: the IDE server when there is one, else Zed's database in a Zed terminal, else nothing,
/// retried with backoff (`connect` and `scheduleReconnect`).
async fn worker(source: Arc<Source>, directory: String, generation: u64, proxy: AppProxy) {
    let post = |event: Event| proxy.send(Posted { generation, event }).is_ok();
    let mut attempt: u32 = 0;
    let mut request_id: i64 = 0;
    loop {
        let connection = {
            let (source, directory) = (source.clone(), directory.clone());
            tokio::task::spawn_blocking(move || resolve_connection(&source, &directory)).await.ok().flatten()
        };
        let delay = match connection {
            Some(connection) => {
                if !post(Event::Status(Status::Connecting)) {
                    return;
                }
                if let Some(socket) = open(&connection).await {
                    attempt = 0;
                    if !post(Event::Status(Status::Connected)) {
                        return;
                    }
                    if !session(socket, &mut request_id, &post).await {
                        return;
                    }
                    if !post(Event::Status(Status::Connecting)) {
                        return;
                    }
                }
                attempt += 1;
                backoff(attempt)
            }
            None if source.zed_terminal => {
                let (source, directory) = (source.clone(), directory.clone());
                let read = tokio::task::spawn_blocking(move || {
                    let db = source.zed_db.iter().find(|path| path.is_file())?;
                    zed::resolve(db, Path::new(&directory))
                })
                .await
                .ok()
                .flatten();
                if let Some(selection) = read
                    && !post(Event::Zed(selection))
                {
                    return;
                }
                ZED_POLL
            }
            None => {
                if !post(Event::Status(Status::Disabled)) {
                    return;
                }
                attempt += 1;
                backoff(attempt)
            }
        };
        tokio::time::sleep(delay).await;
    }
}

/// One second, doubling per failed attempt, at most ten.
fn backoff(attempt: u32) -> Duration {
    Duration::from_millis((1000u64 << attempt.saturating_sub(1).min(4)).min(10_000))
}

type Socket = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn open(connection: &Connection) -> Option<Socket> {
    let mut request = connection.url.as_str().into_client_request().ok()?;
    if let Some(token) = &connection.auth_token {
        request.headers_mut().insert("x-claude-code-ide-authorization", HeaderValue::from_str(token).ok()?);
    }
    let (socket, _) = tokio_tungstenite::connect_async(request).await.ok()?;
    Some(socket)
}

/// Initializes the MCP session and posts the notifications until the socket closes. Returns `false` when the
/// UI is gone.
async fn session(mut socket: Socket, request_id: &mut i64, post: &impl Fn(Event) -> bool) -> bool {
    *request_id += 1;
    let initialize = *request_id;
    let request = json!({
        "jsonrpc": "2.0",
        "id": initialize,
        "method": "initialize",
        "params": {
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": { "name": "opencode", "version": "0.0.0" },
        },
    });
    if socket.send(Frame::text(request.to_string())).await.is_err() {
        return true;
    }
    let mut pending = Some(initialize);
    while let Some(Ok(frame)) = socket.next().await {
        let Frame::Text(text) = frame else { continue };
        let Ok(message) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        let method = message.get("method").and_then(Value::as_str);
        let params = message.get("params").unwrap_or(&Value::Null);
        if method == Some("selection_changed")
            && let Some(selection) = Selection::decode(params)
        {
            if !post(Event::Selection(selection)) {
                return false;
            }
            continue;
        }
        if method == Some("at_mentioned")
            && let Ok(mention) = Mention::deserialize(params)
        {
            if !post(Event::Mention(mention)) {
                return false;
            }
            continue;
        }
        let id = message.get("id").and_then(Value::as_f64);
        if id.is_none() || id != pending.map(|id| id as f64) {
            continue;
        }
        pending = None;
        if message.get("error").is_some_and(|error| !error.is_null()) {
            continue;
        }
        let result = message.get("result").cloned().unwrap_or(Value::Null);
        if !server_info(&result) {
            continue;
        }
        if !post(Event::Server(result)) {
            return false;
        }
        let initialized = json!({ "jsonrpc": "2.0", "method": "notifications/initialized" });
        if socket.send(Frame::text(initialized.to_string())).await.is_err() {
            return true;
        }
    }
    true
}

/// Whether an `initialize` result decodes as `EditorServerInfoSchema`: an object whose fields, when present, have
/// their types.
fn server_info(result: &Value) -> bool {
    let Some(result) = result.as_object() else {
        return false;
    };
    let string_or_absent = |value: Option<&Value>| value.is_none_or(Value::is_string);
    string_or_absent(result.get("protocolVersion"))
        && result.get("serverInfo").is_none_or(|info| {
            info.as_object()
                .is_some_and(|info| string_or_absent(info.get("name")) && string_or_absent(info.get("version")))
        })
}

/// Reading Zed's workspace database (`editor-zed.ts`).
pub mod zed {
    use std::path::Path;

    use rusqlite::types::Value as Sql;
    use rusqlite::{Connection, OpenFlags, params};

    use super::{Position, Range, Selection, SourceKind, Span};

    struct Editor {
        kind: String,
        editor_id: Option<i64>,
        workspace_id: i64,
        workspace_paths: Option<String>,
        timestamp: String,
        buffer_path: Option<String>,
    }

    /// The selection of the active editor in the Zed workspace that contains `cwd`: `Some(Some(_))` for a
    /// selection, `Some(None)` when Zed shows no editor there, and `None` when the database cannot tell
    /// (`resolveZedSelection`'s `unavailable`, which keeps the last selection).
    pub fn resolve(db: &Path, cwd: &Path) -> Option<Option<Selection>> {
        let db = Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_ONLY).ok()?;
        let Some(editor) = active_editor(&db, cwd)? else {
            return Some(None);
        };
        let Some(buffer) = editor.buffer_path.clone() else {
            return Some(None);
        };
        let editor_id = editor.editor_id?;
        let mut ranges = selections(&db, editor_id, editor.workspace_id)?;
        ranges.sort();
        if ranges.is_empty() {
            return None;
        }
        let text = match contents(&db, editor_id, editor.workspace_id) {
            Some(Some(text)) => text,
            _ => std::fs::read_to_string(&buffer).ok()?,
        };
        let ranges = ranges
            .into_iter()
            .map(|(start, end)| {
                let (start, end) = (char_end(&text, start), char_end(&text, end));
                Range {
                    text: text[start..end].to_owned(),
                    selection: Span { start: position(&text, start), end: position(&text, end) },
                }
            })
            .collect();
        Some(Some(Selection { file_path: buffer, source: Some(SourceKind::Zed), ranges }))
    }

    /// `None` when unavailable; `Some(None)` when no workspace contains `cwd` or its active item is no editor.
    fn active_editor(db: &Connection, cwd: &Path) -> Option<Option<Editor>> {
        let mut query = db
            .prepare(
                "select
                  i.kind as item_kind,
                  e.item_id as editor_id,
                  i.workspace_id as workspace_id,
                  w.paths as workspace_paths,
                  w.timestamp as timestamp,
                  e.buffer_path as buffer_path
                from items i
                join panes p on p.pane_id = i.pane_id and p.workspace_id = i.workspace_id
                join workspaces w on w.workspace_id = i.workspace_id
                left join editors e on e.item_id = i.item_id and e.workspace_id = i.workspace_id
                where i.active = 1 and p.active = 1
                order by w.timestamp desc",
            )
            .ok()?;
        let raw: Vec<[Sql; 6]> = query
            .query_map([], |row| Ok([row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?]))
            .ok()?
            .collect::<Result<_, _>>()
            .ok()?;
        let rows: Vec<Editor> = raw.iter().filter_map(editor_row).collect();
        if !raw.is_empty() && rows.is_empty() {
            return None;
        }
        let best = rows
            .into_iter()
            .map(|row| (workspace_score(row.workspace_paths.as_deref(), cwd), row))
            .filter(|(score, _)| *score > 0)
            .max_by(|(left, a), (right, b)| left.cmp(right).then(a.timestamp.cmp(&b.timestamp)));
        let Some((_, row)) = best else {
            return Some(None);
        };
        if row.kind != "Editor" {
            return None;
        }
        if row.editor_id.is_none() {
            return Some(None);
        }
        Some(Some(row))
    }

    fn editor_row(row: &[Sql; 6]) -> Option<Editor> {
        let text = |value: &Sql| match value {
            Sql::Text(text) => Some(text.clone()),
            _ => None,
        };
        let number = |value: &Sql| match value {
            Sql::Integer(number) => Some(*number),
            Sql::Real(number) if number.fract() == 0.0 => Some(*number as i64),
            _ => None,
        };
        Some(Editor {
            kind: text(&row[0])?,
            editor_id: match &row[1] {
                Sql::Null => None,
                value => Some(number(value)?),
            },
            workspace_id: number(&row[2])?,
            workspace_paths: match &row[3] {
                Sql::Null => None,
                value => Some(text(value)?),
            },
            timestamp: text(&row[4])?,
            buffer_path: match &row[5] {
                Sql::Null => None,
                value => Some(text(value)?),
            },
        })
    }

    /// Byte ranges, start before end, of the editor's selections.
    fn selections(db: &Connection, editor: i64, workspace: i64) -> Option<Vec<(usize, usize)>> {
        let mut query = db
            .prepare(
                "select start as selection_start, end as selection_end
                from editor_selections
                where editor_id = ?1 and workspace_id = ?2",
            )
            .ok()?;
        let raw: Vec<(Sql, Sql)> = query
            .query_map(params![editor, workspace], |row| Ok((row.get(0)?, row.get(1)?)))
            .ok()?
            .collect::<Result<_, _>>()
            .ok()?;
        let number = |value: &Sql| match value {
            Sql::Null => Some(None),
            Sql::Integer(number) => Some(Some(*number)),
            Sql::Real(number) => Some(Some(*number as i64)),
            _ => None,
        };
        let decoded: Vec<(Option<i64>, Option<i64>)> =
            raw.iter().filter_map(|(start, end)| Some((number(start)?, number(end)?))).collect();
        if !raw.is_empty() && decoded.is_empty() {
            return None;
        }
        Some(
            decoded
                .into_iter()
                .filter_map(|(start, end)| {
                    let (start, end) = (start?.max(0) as usize, end?.max(0) as usize);
                    Some((start.min(end), start.max(end)))
                })
                .collect(),
        )
    }

    /// `Some(None)` for a null `contents`, `None` when the row is missing or unreadable.
    fn contents(db: &Connection, editor: i64, workspace: i64) -> Option<Option<String>> {
        db.query_row(
            "select contents from editors where item_id = ?1 and workspace_id = ?2",
            params![editor, workspace],
            |row| row.get::<_, Option<String>>(0),
        )
        .ok()
    }

    /// The longest workspace path that contains `cwd`, in UTF-16 units as TS measures it; 0 for none.
    fn workspace_score(paths: Option<&str>, cwd: &Path) -> usize {
        let Some(paths) = paths else { return 0 };
        let list: Vec<String> = match serde_json::from_str::<serde_json::Value>(paths) {
            Ok(serde_json::Value::Array(items)) => {
                items.iter().filter_map(|item| item.as_str().map(str::to_owned)).collect()
            }
            _ => paths
                .split('\n')
                .map(|line| line.strip_suffix('\r').unwrap_or(line).to_owned())
                .filter(|line| !line.is_empty())
                .collect(),
        };
        let cwd = super::absolute(&cwd.to_string_lossy());
        list.iter()
            .map(|item| super::absolute(item))
            .filter(|item| super::contains(item, &cwd))
            .map(|item| item.to_string_lossy().encode_utf16().count())
            .max()
            .unwrap_or(0)
    }

    /// The end of the character that holds byte `offset`, clamped to the text (`utf8ByteOffsetToStringIndex`).
    fn char_end(text: &str, offset: usize) -> usize {
        if offset == 0 {
            return 0;
        }
        text.char_indices().map(|(index, c)| index + c.len_utf8()).find(|end| *end >= offset).unwrap_or(text.len())
    }

    /// The 1-based line and UTF-16 column of byte index `index` (`offsetsToSelection`).
    fn position(text: &str, index: usize) -> Position {
        let before = &text[..index];
        let line_start = before.rfind('\n').map_or(0, |at| at + 1);
        Position {
            line: before.matches('\n').count() as i64 + 1,
            character: before[line_start..].encode_utf16().count() as i64 + 1,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn range(text: &str, start: (i64, i64), end: (i64, i64)) -> Range {
        Range {
            text: text.to_owned(),
            selection: Span {
                start: Position { line: start.0, character: start.1 },
                end: Position { line: end.0, character: end.1 },
            },
        }
    }

    #[test]
    fn selections_decode_either_shape_and_label_as_typescript_does() {
        let single = Selection::decode(&json!({
            "text": "fn main",
            "filePath": "/w/src/index.ts",
            "selection": { "start": { "line": 3, "character": 1 }, "end": { "line": 3, "character": 8 } },
        }))
        .unwrap();
        assert_eq!(single.ranges, vec![range("fn main", (3, 1), (3, 8))]);
        assert_eq!(single.label(), "src/index.ts#3");
        let many = Selection::decode(&json!({
            "filePath": "/w/lib.rs",
            "source": "zed",
            "ranges": [
                { "text": "", "selection": { "start": { "line": 1, "character": 1 }, "end": { "line": 1, "character": 1 } } },
                { "text": "a\nb", "selection": { "start": { "line": 2, "character": 1 }, "end": { "line": 4, "character": 2 } } },
            ],
        }))
        .unwrap();
        assert_eq!(many.source, Some(SourceKind::Zed));
        assert_eq!(many.label(), "lib.rs#2-4 +1");
        assert!(Selection::decode(&json!({ "filePath": "/a", "ranges": [] })).is_none());
        assert!(Selection::decode(&json!({ "filePath": "/a", "source": "vim", "ranges": [] })).is_none());
        let cursor = Selection::decode(&json!({
            "text": "", "filePath": "/w/a.ts",
            "selection": { "start": { "line": 1, "character": 1 }, "end": { "line": 1, "character": 1 } },
        }))
        .unwrap();
        assert_eq!(cursor.label(), "a.ts");
        assert_eq!(
            cursor.reminder(),
            "<system-reminder>Note: The user opened the file \"/w/a.ts\". This may or may not be relevant to the current task.</system-reminder>\n"
        );
        assert_eq!(
            many.reminder(),
            "<system-reminder>Note: The user selected #2-4 from \"/w/lib.rs\". ```a\nb```\n\n This may or may not be relevant to the current task.</system-reminder>\n"
        );
    }

    #[test]
    fn lock_files_pick_the_closest_workspace() {
        let root = tempfile::tempdir().unwrap();
        let write = |name: &str, value: Value| {
            std::fs::write(root.path().join(name), value.to_string()).unwrap();
        };
        write("4100.lock", json!({ "workspaceFolders": ["/w"], "transport": "ws" }));
        write("4200.lock", json!({ "workspaceFolders": ["/w/app"], "authToken": "secret" }));
        write("4300.lock", json!({ "workspaceFolders": ["/w/app/deep"], "transport": "sse" }));
        write("nope.lock", json!({ "workspaceFolders": ["/w"] }));
        write("4400.lock", json!({ "workspaceFolders": ["/other"] }));
        assert_eq!(
            discover(root.path(), "/w/app/deep/src"),
            Some(Connection { url: "ws://127.0.0.1:4200".into(), auth_token: Some("secret".into()) })
        );
        assert_eq!(discover(root.path(), "/w/x").map(|found| found.url), Some("ws://127.0.0.1:4100".into()));
        assert_eq!(discover(root.path(), "/elsewhere"), None);
        assert_eq!(parse_port("8123abc"), Some(8123));
        assert_eq!(parse_port("0"), None);
        assert_eq!(parse_port("70000"), None);
    }

    #[test]
    fn zed_byte_offsets_become_utf16_positions() {
        let root = tempfile::tempdir().unwrap();
        let db = root.path().join("db.sqlite");
        let connection = rusqlite::Connection::open(&db).unwrap();
        connection
            .execute_batch(
                "create table workspaces (workspace_id integer, paths text, timestamp text);
            create table panes (pane_id integer, workspace_id integer, active integer);
            create table items (item_id integer, workspace_id integer, pane_id integer, kind text, active integer);
            create table editors (item_id integer, workspace_id integer, buffer_path text, contents text);
            create table editor_selections (editor_id integer, workspace_id integer, start integer, end integer);
            insert into workspaces values (1, '[\"/w\"]', '2026-01-01'), (2, '/w/app', '2026-01-02');
            insert into panes values (10, 1, 1), (20, 2, 1);
            insert into items values (100, 1, 10, 'Editor', 1), (200, 2, 20, 'Editor', 1);
            insert into editors values (100, 1, '/w/a.ts', 'x'), (200, 2, '/w/app/b.ts', 'héllo\n日本語 end');
            insert into editor_selections values (200, 2, 14, 1);",
            )
            .unwrap();
        drop(connection);
        let selection = zed::resolve(&db, Path::new("/w/app/src")).unwrap().unwrap();
        assert_eq!(selection.file_path, "/w/app/b.ts");
        // Bytes 1..14 end inside 語, so the range takes the whole character.
        assert_eq!(selection.ranges, vec![range("éllo\n日本語", (1, 2), (2, 4))]);
        // An editor without selections cannot tell, so the last selection stays.
        assert_eq!(zed::resolve(&db, Path::new("/w/lib")), None);
        assert_eq!(zed::resolve(&db, Path::new("/elsewhere")), Some(None));
        assert_eq!(zed::resolve(&root.path().join("missing"), Path::new("/w")), None);
    }

    #[test]
    fn backoff_doubles_to_ten_seconds() {
        let seconds: Vec<u64> = (1..=6).map(|attempt| backoff(attempt).as_millis() as u64).collect();
        assert_eq!(seconds, [1000, 2000, 4000, 8000, 10_000, 10_000]);
    }
}
