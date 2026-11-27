//! Track the terminal's editor selection and turn IDE mentions into prompt attachments.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use futures_util::{SinkExt, StreamExt};
use opencode_ui::path::Flavor;
use serde::Deserialize;
use tokio_tungstenite::tungstenite::Message as Frame;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;

use crate::prelude::*;

const MCP_PROTOCOL_VERSION: &str = "2025-11-25";
const ZED_POLL: Duration = Duration::from_secs(1);

#[derive(Clone, Debug, Default)]
pub struct Source {
    pub port: Option<u16>,
    /// The home directory whose `.claude/ide` lock files name IDE servers.
    pub home: Option<PathBuf>,
    pub zed_terminal: bool,
    /// The Zed database candidates; the first that is a file is read (`resolveZedDbPath`).
    pub zed_db: Vec<PathBuf>,
}

impl Source {
    pub fn from_env() -> Self {
        let var = |name: &str| std::env::var(name).ok().filter(|value| !value.is_empty());
        let home = Some(opencode_local::paths::home()).filter(|home| !home.is_empty()).map(PathBuf::from);
        let port = var("CLAUDE_CODE_SSE_PORT")
            .or_else(|| var("OPENCODE_EDITOR_SSE_PORT"))
            .and_then(|value| parse_port(&value));
        let zed_terminal = var("ZED_TERM").as_deref() == Some("true")
            || var("TERM_PROGRAM").is_some_and(|value| value.to_lowercase() == "zed");
        let local_app_data = if cfg!(windows) { var("LOCALAPPDATA") } else { None };
        let zed_db = zed_db_candidates(var("OPENCODE_ZED_DB"), home.as_deref(), local_app_data);
        Self { port, home, zed_terminal, zed_db }
    }
}

/// Resolve the Zed database override before the platform's default locations.
fn zed_db_candidates(env: Option<String>, home: Option<&Path>, local_app_data: Option<String>) -> Vec<PathBuf> {
    let db = |dir: PathBuf| dir.join("db").join("0-stable").join("db.sqlite");
    env.map(PathBuf::from)
        .into_iter()
        .chain(home.into_iter().flat_map(|home| {
            [db(home.join("Library").join("Application Support").join("Zed")), db(home.join(".local/share/zed"))]
        }))
        .chain(local_app_data.map(|dir| db(PathBuf::from(dir).join("Zed"))))
        .collect()
}

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

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Selection {
    pub file_path: String,
    pub source: Option<SourceKind>,
    pub ranges: Vec<Range>,
}

impl Selection {
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
                "<system-update>Note: The user opened the file \"{}\". This may or may not be relevant to the current task.</system-update>\n",
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
            "<system-update>{} This may or may not be relevant to the current task.</system-update>\n",
            ranges.join("\n")
        )
    }
}

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
    server: Option<Value>,
    last_zed_key: Option<String>,
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
    Zed(Option<Selection>),
}

pub fn start(tui: &Tui, source: Source) {
    let context = &tui.prompt.editor;
    if context.0.borrow().started.is_none() {
        tui.app.on_message(bind!(context.0, |state, _, posted: &Posted| Context(state).apply(posted)));
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

    pub fn preserve_from_new_session(&self) {
        self.0.borrow_mut().preserve = true;
    }

    pub fn on_mention(&self, listener: impl Fn(&Mention) + 'static) -> Disposer {
        let id = self.listener_id();
        self.0.borrow_mut().mentions.push((id, Rc::new(listener)));
        Disposer::new(bind!(self.0, |state| state.borrow_mut().mentions.retain(|(other, _)| *other != id)))
    }

    pub fn subscribe(&self, listener: impl Fn() + 'static) -> Disposer {
        let id = self.listener_id();
        self.0.borrow_mut().watchers.push((id, Rc::new(listener)));
        Disposer::new(bind!(self.0, |state| state.borrow_mut().watchers.retain(|(other, _)| *other != id)))
    }

    /// Follows the session's directory (`reconnect`); `None` is the TUI's own directory. A new directory
    /// clears the selection unless a new session asked to keep it; the directory already followed keeps it, as a
    /// Zed selection can arrive before the session's location does.
    pub fn reconnect(&self, tui: &Tui, directory: Option<&str>) {
        let resolved = directory.filter(|directory| !directory.is_empty()).unwrap_or(&tui.directory).to_owned();
        if !self.retarget(&resolved) {
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

    /// Whether `directory` is new; a new one clears the selection unless a new session asked to keep it.
    fn retarget(&self, directory: &str) -> bool {
        let same = self.0.borrow().directory == directory;
        let preserved = std::mem::take(&mut self.0.borrow_mut().preserve);
        if same {
            return false;
        }
        if !preserved {
            self.0.borrow_mut().last_zed_key = None;
            self.set_selection(None);
        }
        true
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

pub fn insert_mention(prompt: &crate::prompt::editor::Inner, tui: &Tui, mention: &Mention) {
    use crate::prompt::autocomplete::{parse, parts};
    let base = prompt.location(tui).directory;
    let path = parse::mention_path(Flavor::NATIVE, &base, &mention.file_path);
    let end = (mention.line_end > mention.line_start).then_some(mention.line_end);
    let mut uri = parse::file_url(Flavor::NATIVE, &absolute(&mention.file_path).to_string_lossy());
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

#[derive(Clone, PartialEq, Eq)]
pub struct Connection {
    pub url: String,
    pub auth_token: Option<String>,
}

// Keeps the lock file's token out of logs.
impl std::fmt::Debug for Connection {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Connection")
            .field("url", &self.url)
            .field("auth_token", &self.auth_token.as_ref().map(|_| "<redacted>"))
            .finish()
    }
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

fn parse_port(value: &str) -> Option<u16> {
    let value = value.trim_start();
    let value = value.strip_prefix('+').unwrap_or(value);
    let digits: String = value.chars().take_while(char::is_ascii_digit).collect();
    digits.parse::<u16>().ok().filter(|port| *port > 0)
}

fn absolute(path: &str) -> PathBuf {
    let base = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/"));
    PathBuf::from(super::autocomplete::parse::resolve(Flavor::NATIVE, &base.to_string_lossy(), path))
}

fn contains(parent: &Path, child: &Path) -> bool {
    let relative = Flavor::NATIVE.relative(&parent.to_string_lossy(), &child.to_string_lossy());
    relative.is_empty() || !Flavor::NATIVE.outside(&relative)
}

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
        let Ok(message) = serde_json::from_str::<Value>(&text) else { continue };
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

fn server_info(result: &Value) -> bool {
    let Some(result) = result.as_object() else { return false };
    let string_or_absent = |value: Option<&Value>| value.is_none_or(Value::is_string);
    string_or_absent(result.get("protocolVersion"))
        && result.get("serverInfo").is_none_or(|info| {
            info.as_object()
                .is_some_and(|info| string_or_absent(info.get("name")) && string_or_absent(info.get("version")))
        })
}

/// Read workspace selections from Zed using dynamically loaded system SQLite. Missing SQLite disables this source.
pub mod zed {
    use std::path::Path;

    use super::sqlite::{Connection, READ_ONLY, READ_WRITE_CREATE, Sqlite, Value as Sql};
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
    /// (`resolveZedSelection`'s `unavailable`, which keeps the last selection), as when SQLite does not load.
    pub fn resolve(db: &Path, cwd: &Path) -> Option<Option<Selection>> {
        resolve_with(Sqlite::system(), db, cwd)
    }

    #[doc(hidden)]
    pub fn exec(db: &Path, sql: &str) -> Result<(), String> {
        let sqlite = Sqlite::system().ok_or("the system SQLite library is not available")?;
        Connection::open(sqlite, db, READ_WRITE_CREATE).ok_or("cannot open the database")?.exec(sql)
    }

    pub(super) fn resolve_with(sqlite: Option<&Sqlite>, db: &Path, cwd: &Path) -> Option<Option<Selection>> {
        let db = Connection::open(sqlite?, db, READ_ONLY)?;
        let Some(editor) = active_editor(&db, cwd)? else { return Some(None) };
        let Some(buffer) = editor.buffer_path.clone() else { return Some(None) };
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

    fn active_editor(db: &Connection, cwd: &Path) -> Option<Option<Editor>> {
        let raw = db.rows(
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
            &[],
            6,
        )?;
        let rows: Vec<Editor> = raw.iter().filter_map(|row| editor_row(row)).collect();
        if !raw.is_empty() && rows.is_empty() {
            return None;
        }
        let best = rows
            .into_iter()
            .map(|row| (workspace_score(row.workspace_paths.as_deref(), cwd), row))
            .filter(|(score, _)| *score > 0)
            .max_by(|(left, a), (right, b)| left.cmp(right).then(a.timestamp.cmp(&b.timestamp)));
        let Some((_, row)) = best else { return Some(None) };
        if row.kind != "Editor" {
            return None;
        }
        if row.editor_id.is_none() {
            return Some(None);
        }
        Some(Some(row))
    }

    fn editor_row(row: &[Sql]) -> Option<Editor> {
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
        let raw = db.rows(
            "select start as selection_start, end as selection_end
            from editor_selections
            where editor_id = ?1 and workspace_id = ?2",
            &[editor, workspace],
            2,
        )?;
        let number = |value: &Sql| match value {
            Sql::Null => Some(None),
            Sql::Integer(number) => Some(Some(*number)),
            Sql::Real(number) => Some(Some(*number as i64)),
            _ => None,
        };
        let decoded: Vec<(Option<i64>, Option<i64>)> =
            raw.iter().filter_map(|row| Some((number(&row[0])?, number(&row[1])?))).collect();
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

    fn contents(db: &Connection, editor: i64, workspace: i64) -> Option<Option<String>> {
        let rows =
            db.rows("select contents from editors where item_id = ?1 and workspace_id = ?2", &[editor, workspace], 1)?;
        match rows.into_iter().next()?.into_iter().next()? {
            Sql::Null => Some(None),
            Sql::Text(text) => Some(Some(text)),
            _ => None,
        }
    }

    /// Longest containing workspace path in UTF-16 units, or zero if no path contains `cwd`.
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

    /// Convert a byte offset to a one-based line and UTF-16 column.
    fn position(text: &str, index: usize) -> Position {
        let before = &text[..index];
        let line_start = before.rfind('\n').map_or(0, |at| at + 1);
        Position {
            line: before.matches('\n').count() as i64 + 1,
            character: before[line_start..].encode_utf16().count() as i64 + 1,
        }
    }
}

/// The few calls of SQLite's C API that [`zed`] needs, from the system library loaded at run time, so the binary
/// neither bundles SQLite nor needs it to start.
#[allow(unsafe_code)]
mod sqlite {
    use std::ffi::{CStr, CString, c_char, c_int, c_void};
    use std::path::Path;
    use std::sync::OnceLock;

    #[cfg(target_os = "macos")]
    const LIBRARY: &str = "/usr/lib/libsqlite3.dylib";
    // Use the SQLite library provided by Windows.
    #[cfg(windows)]
    const LIBRARY: &str = "winsqlite3.dll";
    #[cfg(not(any(target_os = "macos", windows)))]
    const LIBRARY: &str = "libsqlite3.so.0";

    pub const READ_ONLY: c_int = 0x1;
    pub const READ_WRITE_CREATE: c_int = 0x2 | 0x4;
    const OK: c_int = 0;
    const ROW: c_int = 100;
    const DONE: c_int = 101;
    const INTEGER: c_int = 1;
    const FLOAT: c_int = 2;
    const TEXT: c_int = 3;
    const NULL: c_int = 5;
    /// How long a read waits for Zed's writer (rusqlite's default, which this binding replaced).
    const BUSY_MS: c_int = 5000;

    type Db = *mut c_void;
    type Stmt = *mut c_void;

    pub enum Value {
        Null,
        Integer(i64),
        Real(f64),
        Text(String),
        Blob,
    }

    pub struct Sqlite {
        open_v2: unsafe extern "C" fn(*const c_char, *mut Db, c_int, *const c_char) -> c_int,
        close_v2: unsafe extern "C" fn(Db) -> c_int,
        busy_timeout: unsafe extern "C" fn(Db, c_int) -> c_int,
        errmsg: unsafe extern "C" fn(Db) -> *const c_char,
        exec: unsafe extern "C" fn(Db, *const c_char, *const c_void, *mut c_void, *mut *mut c_char) -> c_int,
        prepare_v2: unsafe extern "C" fn(Db, *const c_char, c_int, *mut Stmt, *mut *const c_char) -> c_int,
        bind_int64: unsafe extern "C" fn(Stmt, c_int, i64) -> c_int,
        step: unsafe extern "C" fn(Stmt) -> c_int,
        column_type: unsafe extern "C" fn(Stmt, c_int) -> c_int,
        column_int64: unsafe extern "C" fn(Stmt, c_int) -> i64,
        column_double: unsafe extern "C" fn(Stmt, c_int) -> f64,
        column_text: unsafe extern "C" fn(Stmt, c_int) -> *const u8,
        column_bytes: unsafe extern "C" fn(Stmt, c_int) -> c_int,
        finalize: unsafe extern "C" fn(Stmt) -> c_int,
        _library: opencode_util::dl::Library,
    }

    impl Sqlite {
        /// The system library, loaded once, on first use; `None` when it is missing, and always in a static musl build,
        /// which opens no library. Either way the Zed source stays silent.
        pub fn system() -> Option<&'static Sqlite> {
            static SYSTEM: OnceLock<Option<Sqlite>> = OnceLock::new();
            SYSTEM.get_or_init(|| Sqlite::load(LIBRARY)).as_ref()
        }

        pub fn load(name: &str) -> Option<Sqlite> {
            // SAFETY: SQLite's initializers have no preconditions.
            let library = unsafe { opencode_util::dl::Library::open(name) }.ok()?;
            macro_rules! symbol {
                ($name:literal) => {
                    // SAFETY: each field's type is the C signature of the symbol it names, and the library outlives
                    // the pointers because it is stored with them.
                    unsafe { library.symbol($name) }.ok()?
                };
            }
            Some(Sqlite {
                open_v2: symbol!("sqlite3_open_v2"),
                close_v2: symbol!("sqlite3_close_v2"),
                busy_timeout: symbol!("sqlite3_busy_timeout"),
                errmsg: symbol!("sqlite3_errmsg"),
                exec: symbol!("sqlite3_exec"),
                prepare_v2: symbol!("sqlite3_prepare_v2"),
                bind_int64: symbol!("sqlite3_bind_int64"),
                step: symbol!("sqlite3_step"),
                column_type: symbol!("sqlite3_column_type"),
                column_int64: symbol!("sqlite3_column_int64"),
                column_double: symbol!("sqlite3_column_double"),
                column_text: symbol!("sqlite3_column_text"),
                column_bytes: symbol!("sqlite3_column_bytes"),
                finalize: symbol!("sqlite3_finalize"),
                _library: library,
            })
        }
    }

    pub struct Connection<'a> {
        sqlite: &'a Sqlite,
        db: Db,
    }

    impl<'a> Connection<'a> {
        pub fn open(sqlite: &'a Sqlite, path: &Path, flags: c_int) -> Option<Self> {
            let path = CString::new(path.as_os_str().as_encoded_bytes()).ok()?;
            let mut db = std::ptr::null_mut();
            // SAFETY: `path` is a C string and `db` receives the handle, which `drop` closes even when opening
            // fails.
            let code = unsafe { (sqlite.open_v2)(path.as_ptr(), &mut db, flags, std::ptr::null()) };
            let connection = Connection { sqlite, db };
            if code != OK {
                return None;
            }
            // SAFETY: `db` is open.
            unsafe { (sqlite.busy_timeout)(db, BUSY_MS) };
            Some(connection)
        }

        /// Every row of `sql`, with `params` bound to `?1`, `?2`, …, as its first `columns` values; `None` on any
        /// error, a text that is not UTF-8 included.
        pub fn rows(&self, sql: &str, params: &[i64], columns: c_int) -> Option<Vec<Vec<Value>>> {
            let statement = self.prepare(sql)?;
            for (index, param) in (1..).zip(params) {
                // SAFETY: `statement.raw` is prepared until `statement` drops.
                if unsafe { (self.sqlite.bind_int64)(statement.raw, index, *param) } != OK {
                    return None;
                }
            }
            let mut rows = Vec::new();
            loop {
                // SAFETY: as above, and `value` reads the row `step` returned.
                match unsafe { (self.sqlite.step)(statement.raw) } {
                    ROW => {
                        // SAFETY: `step` returned a row, so `value` reads a column of the statement's current row.
                        rows.push((0..columns).map(|column| unsafe { statement.value(column) }).collect::<Option<_>>()?)
                    }
                    DONE => return Some(rows),
                    _ => return None,
                }
            }
        }

        pub fn exec(&self, sql: &str) -> Result<(), String> {
            let sql = CString::new(sql).map_err(|error| error.to_string())?;
            // SAFETY: `db` is open and `sql` is a C string; there is no callback and no error-message out pointer.
            let code = unsafe {
                (self.sqlite.exec)(self.db, sql.as_ptr(), std::ptr::null(), std::ptr::null_mut(), std::ptr::null_mut())
            };
            if code == OK {
                return Ok(());
            }
            // SAFETY: `errmsg` returns a C string owned by the connection.
            Err(unsafe { CStr::from_ptr((self.sqlite.errmsg)(self.db)) }.to_string_lossy().into_owned())
        }

        fn prepare(&self, sql: &str) -> Option<Statement<'a>> {
            let mut raw = std::ptr::null_mut();
            // SAFETY: `sql` is passed with its length, so it needs no terminator.
            let code = unsafe {
                (self.sqlite.prepare_v2)(
                    self.db,
                    sql.as_ptr().cast(),
                    sql.len() as c_int,
                    &mut raw,
                    std::ptr::null_mut(),
                )
            };
            let statement = Statement { sqlite: self.sqlite, raw };
            (code == OK && !raw.is_null()).then_some(statement)
        }
    }

    impl Drop for Connection<'_> {
        fn drop(&mut self) {
            // SAFETY: `db` came from `open_v2`; closing null is a no-op, and `close_v2` waits for statements that
            // are not finalized yet.
            unsafe { (self.sqlite.close_v2)(self.db) };
        }
    }

    struct Statement<'a> {
        sqlite: &'a Sqlite,
        raw: Stmt,
    }

    impl Statement<'_> {
        /// Column `column` of the current row; `None` for a text that is not UTF-8.
        ///
        /// # Safety
        ///
        /// The last `step` returned a row.
        unsafe fn value(&self, column: c_int) -> Option<Value> {
            let (sqlite, raw) = (self.sqlite, self.raw);
            // SAFETY: `raw` is on a row, as the caller promises, and the text is copied before the next call on it.
            unsafe {
                Some(match (sqlite.column_type)(raw, column) {
                    INTEGER => Value::Integer((sqlite.column_int64)(raw, column)),
                    FLOAT => Value::Real((sqlite.column_double)(raw, column)),
                    TEXT => {
                        let text = (sqlite.column_text)(raw, column);
                        let bytes = if text.is_null() {
                            &[][..]
                        } else {
                            std::slice::from_raw_parts(text, (sqlite.column_bytes)(raw, column) as usize)
                        };
                        Value::Text(std::str::from_utf8(bytes).ok()?.to_owned())
                    }
                    NULL => Value::Null,
                    _ => Value::Blob,
                })
            }
        }
    }

    impl Drop for Statement<'_> {
        fn drop(&mut self) {
            // SAFETY: `raw` is a prepared statement or null, and finalizing null is a no-op.
            unsafe { (self.sqlite.finalize)(self.raw) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A POSIX test path as an absolute path of this platform: `/w/app` is `C:\w\app` on Windows.
    fn abs(posix: &str) -> String {
        if cfg!(windows) { format!("C:{}", posix.replace('/', "\\")) } else { posix.to_owned() }
    }

    fn selection(file_path: &str) -> Selection {
        Selection {
            file_path: file_path.to_owned(),
            source: Some(SourceKind::Zed),
            ranges: vec![Range {
                text: "ab".to_owned(),
                selection: Span { start: Position { line: 2, character: 0 }, end: Position { line: 3, character: 0 } },
            }],
        }
    }

    #[test]
    fn a_zed_selection_survives_a_reconnect_to_the_directory_it_followed() {
        let context = Context::default();
        context.0.borrow_mut().directory = "/w".to_owned();
        let posted = |file_path: &str| Posted { generation: 0, event: Event::Zed(Some(selection(file_path))) };
        context.apply(&posted("/w/a.ts"));
        assert_eq!(context.selection().map(|selection| selection.label()), Some("a.ts#2-3".to_owned()));
        // The session's location lands after the first Zed poll; it names the directory already followed.
        assert!(!context.retarget("/w"));
        assert_eq!(context.selection().map(|selection| selection.label()), Some("a.ts#2-3".to_owned()));
        context.apply(&posted("/w/a.ts"));
        assert_eq!(context.selection().map(|selection| selection.label()), Some("a.ts#2-3".to_owned()));
        // A new directory clears it, and its own poll brings its selection in.
        assert!(context.retarget("/other"));
        assert!(context.selection().is_none());
        context.apply(&posted("/other/a.ts"));
        assert_eq!(context.selection().map(|selection| selection.label()), Some("a.ts#2-3".to_owned()));
    }

    #[test]
    fn debug_redacts_the_auth_token() {
        let connection = Connection { url: "ws://127.0.0.1:1".into(), auth_token: Some("t0ken".into()) };
        let shown = format!("{connection:?}");
        assert!(!shown.contains("t0ken") && shown.contains("auth_token: Some(\"<redacted>\")"), "{shown}");
        assert!(shown.contains("ws://127.0.0.1:1"), "{shown}");
    }

    #[test]
    fn zed_without_the_sqlite_library_is_unavailable() {
        let root = opencode_util::temp::tempdir().unwrap();
        let db = root.path().join("db.sqlite");
        zed::exec(
            &db,
            &format!(
                "create table workspaces (workspace_id integer, paths text, timestamp text);
                create table panes (pane_id integer, workspace_id integer, active integer);
                create table items (item_id integer, workspace_id integer, pane_id integer, kind text, active integer);
                create table editors (item_id integer, workspace_id integer, buffer_path text, contents text);
                create table editor_selections (editor_id integer, workspace_id integer, start integer, end integer);
                insert into workspaces values (1, '{}', '2026-01-01');
                insert into panes values (10, 1, 1);
                insert into items values (100, 1, 10, 'Editor', 1);
                insert into editors values (100, 1, '{}', 'abc');
                insert into editor_selections values (100, 1, 0, 2);",
                abs("/w"),
                abs("/w/a.ts"),
            ),
        )
        .unwrap();
        let cwd = abs("/w");
        assert_eq!(zed::resolve(&db, Path::new(&cwd)).unwrap().unwrap().ranges[0].text, "ab");
        let missing = sqlite::Sqlite::load("libsqlite3-missing.so.0");
        assert!(missing.is_none());
        // The caller keeps the last selection and polls again, as for a database it cannot read.
        assert_eq!(zed::resolve_with(missing.as_ref(), &db, Path::new(&cwd)), None);
    }

    #[test]
    fn zed_database_candidates_in_order() {
        let home = Path::new("/home/me");
        let mac = home.join("Library/Application Support/Zed/db/0-stable/db.sqlite");
        let linux = home.join(".local/share/zed/db/0-stable/db.sqlite");
        let windows =
            PathBuf::from(r"C:\Users\me\AppData\Local").join("Zed").join("db").join("0-stable").join("db.sqlite");
        let cases = [
            (None, None, None, vec![]),
            (Some("/x/db"), None, None, vec![PathBuf::from("/x/db")]),
            (Some("/x/db"), Some(home), None, vec![PathBuf::from("/x/db"), mac.clone(), linux.clone()]),
            (None, Some(home), Some(r"C:\Users\me\AppData\Local"), vec![mac, linux, windows]),
        ];
        for (env, home, local, expected) in cases {
            assert_eq!(zed_db_candidates(env.map(str::to_owned), home, local.map(str::to_owned)), expected);
        }
    }

    #[test]
    fn backoff_doubles_to_ten_seconds() {
        let seconds: Vec<u64> = (1..=6).map(|attempt| backoff(attempt).as_millis() as u64).collect();
        assert_eq!(seconds, [1000, 2000, 4000, 8000, 10_000, 10_000]);
    }
}
