//! The conformance suite of the plugin C ABI (Pc, `rich-plugins/synthesis.md` 4.6 and 4.14): golden transcripts of
//! every request and reply that the host and a library exchange through the C ABI in a scripted session.
//!
//! A transcript is recorded from the reference, the conformance plugin of `examples/conformance`, linked into the
//! loader's tests and called through the C ABI's byte shims. It is then checked on both sides of the C ABI:
//!
//! - **The host side.** The host runs the same script against a plugin that answers from the transcript; what the host
//!   sends and shows must equal the transcript. So a host change that changes the C ABI changes a transcript, and a
//!   transcript change without a host change fails.
//! - **The library side** ([`replay`], `plugin test --conformance`). A host that sends the transcript's requests and
//!   answers its host requests drives a library; what the library answers and asks must equal the transcript. The
//!   library is the reference built as a `cdylib`, or the same plugin written in C against `opencode_plugin.h`.
//!
//! Each side also runs as a later minor of the other ([`replay`]'s `future`; the host side in the tests): fields and
//! requests it does not know must change nothing.
//!
//! What crosses on the UI thread is seen through a tap the loader calls ([`Event`], [`watch`]). The same tap feeds
//! [`Protocol`], the C ABI's machine as `opencode_plugin.h` states it, which the models of the plugin tests run under.
//!
//! What a transcript holds, and how it compares:
//!
//! - Bytes the host sends are kept as JSON values, and compare exactly, but for two numbers the host draws from
//!   process-wide counters: a mount's `generation`, numbered by first appearance, and the content handles, counted from
//!   the first `next` of the transcript ([`Normal`]).
//! - Bytes the library sends are kept as the host reads them: decoded with the host's own types and written again, so
//!   field order, white space, defaults left out and fields the host does not know do not count, and everything the
//!   host reads does ([`canonical`]).
//! - A status compares exactly, and so does the text of an error or a panic, which the user reads in the plugin manager.
//! - Calls of the plugin's own threads are not in it: their order is the scheduler's.

#![allow(unsafe_code)]

use std::cell::RefCell;
use std::collections::HashMap;
use std::ffi::c_void;
use std::mem::size_of;
use std::path::Path;

use opencode_plugin_abi::{self as abi, Bytes, HostApi, Owned, PluginApi};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The golden transcripts, as their writer wrote them (`CONFORMANCE_WRITE=1` on the loader's conformance tests).
pub const TRANSCRIPTS: &str = include_str!("../conformance/transcripts.jsonl");

/// The scripts the transcripts are recorded from: the input of the writer, written by hand.
pub const SCRIPTS: &str = include_str!("../conformance/scripts.json");

/// One crossing of the C ABI, a line of a transcript.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Entry {
    /// The host took the library's table: the table's version, and the minor the host serves.
    Open { major: u32, minor: u32, requires_minor: u32, served: u32 },
    /// The host calls `describe`.
    Describe,
    /// The host calls `create` with a host table of `major.minor` and `features`, and `options`.
    Create { major: u32, minor: u32, features: Value, options: String },
    /// The host calls `call`.
    Call { request: Value },
    /// The host calls `destroy`.
    Destroy,
    /// What `describe`, `create` or `call` returned.
    Return { status: i32, reply: Value },
    /// `destroy` returned.
    Destroyed,
    /// Inside a call, the library called the host table's `call`.
    Host { request: Value, status: i32, reply: Value },
    /// Inside a call, the library called `send`.
    Send { key: String, message: Value, status: i32 },
    /// Inside a call, the library called `wake`.
    Wake,
    /// Inside a call, the library called `stopped`.
    Stopped { answer: u32 },
    /// Inside a call, the library called `theme_mode`.
    ThemeMode { answer: u32 },
    /// Inside a call, the library called `report`.
    Report { message: String },
    /// What the user sees at a step of the script: the host's side only.
    Observe { seen: Value },
}

impl Entry {
    /// Whether the library makes it, inside a call of the host's.
    pub fn nested(&self) -> bool {
        matches!(
            self,
            Entry::Host { .. }
                | Entry::Send { .. }
                | Entry::Wake
                | Entry::Stopped { .. }
                | Entry::ThemeMode { .. }
                | Entry::Report { .. }
        )
    }
}

/// What a transcript is for, and the script of host steps it is recorded from.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Header {
    pub transcript: String,
    pub about: String,
    pub script: Vec<Step>,
}

/// A step of a script: what the host does, or `Observe`, which records what the user sees.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "do", rename_all = "kebab-case")]
pub enum Step {
    /// Loads the library with `options` and activates it; with `features`, the host table states those, as an older
    /// host's would, so the library lowers what that host lacks.
    Load {
        #[serde(default)]
        options: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        features: Option<Vec<String>>,
    },
    /// Runs a command of the plugin; with `took`, the call takes that many milliseconds on the host's clock.
    Command {
        name: String,
        #[serde(default, skip_serializing_if = "is_zero")]
        took: u64,
    },
    /// Opens a route of the plugin and draws it.
    Open {
        route: String,
    },
    /// Shows a pending call of tool `tool` in the transcript, through the plugin's renderer claim of it (Pr), and
    /// draws it.
    Claim {
        tool: String,
    },
    /// The claimed call of tool `tool` completes with its output, which the host keeps from the claim's view, and
    /// draws.
    Complete {
        tool: String,
    },
    /// Shows Markdown `text` as the transcript does, whose fences the plugins' claims and renderers draw, and draws it.
    Markdown {
        text: String,
    },
    /// Closes the route, the claimed call, or the Markdown.
    Close,
    /// The user presses `key` (P2), as the keymap names one (`ctrl+g`); what its handler asked for applies after it.
    Press {
        key: String,
    },
    /// The user pastes `text` (P2).
    Paste {
        text: String,
    },
    /// The user clicks the screen cell at `x`, `y` (P2): a press and a release.
    Click {
        x: u16,
        y: u16,
    },
    /// A select runs the plugin's search `name` for `query` over `options` (P2); what it answers is recorded as seen.
    Search {
        name: String,
        query: String,
        options: Vec<abi::SelectOption>,
    },
    /// Runs the host's deferred work: effects, wakes, the mailbox.
    Advance,
    /// The user disables the plugin, or enables it again.
    Disable,
    Enable,
    /// The plugin list changed (P6b): the host tells the plugins that hear it.
    Plugins,
    /// The theme's mode, `dark` or `light`.
    Mode {
        light: bool,
    },
    Observe,
}

fn is_zero(value: &u64) -> bool {
    *value == 0
}

/// A transcript: its header and its entries.
#[derive(Clone, Debug, PartialEq)]
pub struct Transcript {
    pub header: Header,
    pub entries: Vec<Entry>,
}

/// The transcripts of `text`, one header line each, then its entries.
pub fn parse(text: &str) -> Result<Vec<Transcript>, String> {
    let mut transcripts: Vec<Transcript> = Vec::new();
    for (index, line) in text.lines().enumerate().filter(|(_, line)| !line.trim().is_empty()) {
        let value: Value = serde_json::from_str(line).map_err(|error| format!("line {}: {error}", index + 1))?;
        if value.get("transcript").is_some() {
            let header = serde_json::from_value(value).map_err(|error| format!("line {}: {error}", index + 1))?;
            transcripts.push(Transcript { header, entries: Vec::new() });
            continue;
        }
        let entry = serde_json::from_value(value).map_err(|error| format!("line {}: {error}", index + 1))?;
        transcripts.last_mut().ok_or("an entry before the first header")?.entries.push(entry);
    }
    Ok(transcripts)
}

/// `transcripts` as their file holds them.
pub fn write(transcripts: &[Transcript]) -> String {
    let mut text = String::new();
    for transcript in transcripts {
        let lines = std::iter::once(serde_json::to_string(&transcript.header))
            .chain(transcript.entries.iter().map(serde_json::to_string));
        for line in lines {
            text.push_str(&line.unwrap_or_default());
            text.push('\n');
        }
    }
    text
}

/// The scripts of [`SCRIPTS`].
pub fn scripts() -> Result<Vec<Header>, String> {
    serde_json::from_str(SCRIPTS).map_err(|error| format!("scripts.json: {error}"))
}

/// The golden transcripts of [`TRANSCRIPTS`].
pub fn golden() -> Result<Vec<Transcript>, String> {
    parse(TRANSCRIPTS)
}

// The tap.

/// What the loader reports as it crosses the C ABI on the UI thread.
#[derive(Clone, Copy, Debug)]
pub enum Event<'a> {
    Open {
        major: u32,
        minor: u32,
        requires_minor: u32,
        served: u32,
    },
    Describe,
    /// `instance` numbers the instance in this process.
    Create {
        instance: u64,
        major: u32,
        minor: u32,
        features: &'a [u8],
        options: &'a [u8],
    },
    Call {
        instance: u64,
        request: &'a [u8],
    },
    Destroy {
        instance: u64,
    },
    /// A buffer the host refused unread is `Err` with why.
    Return {
        status: i32,
        reply: Result<&'a [u8], &'a str>,
    },
    Destroyed,
    Host {
        request: &'a [u8],
        status: i32,
        reply: &'a [u8],
    },
    Send {
        key: &'a [u8],
        message: &'a [u8],
        status: i32,
    },
    Wake,
    Stopped {
        answer: u32,
    },
    ThemeMode {
        answer: u32,
    },
    Report {
        message: &'a [u8],
    },
}

type Sink = Box<dyn FnMut(&Event<'_>)>;

thread_local! {
    static SINKS: RefCell<Vec<Sink>> = const { RefCell::new(Vec::new()) };
}

/// Runs `f` with `sink` told of every crossing on this thread; sinks nest, the outer ones told too.
pub fn watch<R>(sink: impl FnMut(&Event<'_>) + 'static, f: impl FnOnce() -> R) -> R {
    struct Pop;
    impl Drop for Pop {
        fn drop(&mut self) {
            SINKS.with_borrow_mut(Vec::pop);
        }
    }
    SINKS.with_borrow_mut(|sinks| sinks.push(Box::new(sink)));
    let _pop = Pop;
    f()
}

/// Tells the sinks of this thread of `event`. A sink that is busy, because the crossing came from inside it, is not
/// told again.
pub(crate) fn tap(event: Event<'_>) {
    let taken = SINKS.with(|sinks| match sinks.try_borrow_mut() {
        Ok(mut sinks) if !sinks.is_empty() => Some(std::mem::take(&mut *sinks)),
        _ => None,
    });
    let Some(mut taken) = taken else { return };
    taken.iter_mut().for_each(|sink| sink(&event));
    SINKS.with_borrow_mut(|sinks| {
        let added = std::mem::take(sinks);
        *sinks = taken;
        sinks.extend(added);
    });
}

/// A number for each instance the host creates in this process.
pub(crate) fn next_instance() -> u64 {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
}

// Recording.

/// The numbers the host draws from process-wide counters, made the transcript's own: a mount's generation and a fence's
/// mount key (`fence-N`) by their first appearance (1, 2, ...), and content handles by the order the transcript's views gave them, which other hosts in the
/// process do not shift. A view's `next` is the count given before it.
#[derive(Default)]
pub struct Normal {
    generations: Vec<u64>,
    /// The mount keys of fences (`fence-N`), which the host numbers process-wide too.
    fences: Vec<String>,
    /// The content handles given so far: the host's, and the transcript's.
    handles: Vec<(u64, u64)>,
    /// The host's `next` of the running view less the transcript's.
    offset: u64,
}

impl Normal {
    /// A request of the host's, made the transcript's.
    pub fn request(&mut self, value: &mut Value) {
        self.generations(value);
        if let Some(next) = value.get_mut("next")
            && let Some(number) = next.as_u64()
        {
            let given = self.handles.len() as u64;
            self.offset = number.saturating_sub(given);
            *next = Value::from(given);
        }
    }

    fn generations(&mut self, value: &mut Value) {
        match value {
            Value::Object(object) => {
                for (key, field) in object.iter_mut() {
                    let fence =
                        field.as_str().filter(|text| key == "key" && text.starts_with("fence-")).map(str::to_owned);
                    if let Some(fence) = fence {
                        let at = self.fences.iter().position(|known| *known == fence).unwrap_or_else(|| {
                            self.fences.push(fence);
                            self.fences.len() - 1
                        });
                        *field = Value::from(format!("fence-{}", at + 1));
                        continue;
                    }
                    match (key.as_str(), field.as_u64()) {
                        ("generation", Some(generation)) => {
                            let at = match self.generations.iter().position(|known| *known == generation) {
                                Some(at) => at,
                                None => {
                                    self.generations.push(generation);
                                    self.generations.len() - 1
                                }
                            };
                            *field = Value::from(at as u64 + 1);
                        }
                        _ => self.generations(field),
                    }
                }
            }
            Value::Array(items) => items.iter_mut().for_each(|item| self.generations(item)),
            _ => {}
        }
    }

    /// A view's reply of the host's, made the transcript's; with `back`, one of the transcript's made the host's, for
    /// the view whose request [`Normal::request`] saw last.
    pub fn reply(&mut self, value: &mut Value, back: bool) {
        let offset = self.offset;
        if let Some(Value::Array(content)) = value.get_mut("content") {
            for pair in content {
                if let Some(handle) = pair.get_mut(0).filter(|handle| handle.is_u64()) {
                    let number = handle.as_u64().unwrap_or_default();
                    let (host, own) = match back {
                        true => (number + offset, number),
                        false => (number, number.saturating_sub(offset)),
                    };
                    self.handles.push((host, own));
                    *handle = Value::from(if back { host } else { own });
                }
            }
        }
        let handles = &self.handles;
        let shift = |number: u64| match back {
            true => handles.iter().find(|(_, own)| *own == number).map_or(number + offset, |(host, _)| *host),
            false => {
                handles.iter().find(|(host, _)| *host == number).map_or(number.saturating_sub(offset), |(_, own)| *own)
            }
        };
        if let Some(Value::Array(released)) = value.get_mut("released") {
            for handle in released.iter_mut().filter(|handle| handle.is_u64()) {
                *handle = Value::from(shift(handle.as_u64().unwrap_or_default()));
            }
        }
        if let Some(node) = value.get_mut("node") {
            sources(node, &shift);
        }
    }
}

/// Every `{"content": handle}` source in a tree, shifted.
fn sources(value: &mut Value, shift: &dyn Fn(u64) -> u64) {
    match value {
        Value::Object(object) => {
            if object.len() == 1
                && let Some(handle) = object.get_mut("content").filter(|handle| handle.is_u64())
            {
                *handle = Value::from(shift(handle.as_u64().unwrap_or_default()));
                return;
            }
            object.values_mut().for_each(|field| sources(field, shift));
        }
        Value::Array(items) => items.iter_mut().for_each(|item| sources(item, shift)),
        _ => {}
    }
}

/// What a reply is read as, by the host.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    Describe,
    Manifest,
    View,
    Render,
    Fence,
    /// A canvas's list (P5): bytes, not JSON.
    Draw,
    /// What a `layout` returns (P3).
    Layout,
    /// What a renderer claim's view returns (Pr): a tree as a view's, or none.
    Claim,
    /// Anything else, such as a handler's `null`, as JSON.
    Raw,
}

impl Kind {
    /// What the reply to `request` is read as.
    pub fn of(request: &Value) -> Kind {
        match request.get("type").and_then(Value::as_str) {
            Some("view") => Kind::View,
            Some("render" | "render-route") => Kind::Render,
            Some("render-fence") => Kind::Fence,
            Some("draw") => Kind::Draw,
            Some("layout") => Kind::Layout,
            Some("claim") => Kind::Claim,
            _ => Kind::Raw,
        }
    }
}

/// `value` as the host reads it as `T`: decoded and written again, or as it is when it does not decode.
fn typed<T: serde::de::DeserializeOwned + Serialize>(value: Value) -> Value {
    serde_json::from_value::<T>(value.clone()).ok().and_then(|typed| serde_json::to_value(typed).ok()).unwrap_or(value)
}

/// A reply of the library's as the transcript keeps it: the JSON the host reads, for `OK`; the text, for an error or a
/// panic; `{"refused": why}` for a buffer the host refused unread, `{"bytes": text}` for one that is not JSON, and
/// `{"list": hex}` for a draw's list, whose bytes the host reads as they are.
pub fn canonical(kind: Kind, status: i32, reply: Result<&[u8], &str>) -> Value {
    let bytes = match reply {
        Ok(bytes) => bytes,
        Err(why) => return serde_json::json!({ "refused": why }),
    };
    if status != abi::OK {
        return Value::String(String::from_utf8_lossy(bytes).into_owned());
    }
    if kind == Kind::Draw {
        let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
        return serde_json::json!({ "list": hex });
    }
    let Ok(value) = serde_json::from_slice::<Value>(bytes) else {
        return serde_json::json!({ "bytes": String::from_utf8_lossy(bytes) });
    };
    match kind {
        Kind::Describe => typed::<abi::Metadata>(value),
        Kind::Manifest => typed::<abi::Manifest>(value),
        Kind::View => typed::<abi::ViewReply>(value),
        Kind::Render => typed::<abi::Render>(value),
        Kind::Fence => typed::<abi::Fenced>(value),
        Kind::Layout => typed::<abi::v2::LayoutReply>(value),
        Kind::Claim => typed::<abi::claim::Reply>(value),
        Kind::Draw | Kind::Raw => value,
    }
}

/// A host request of the library's as the host reads it.
pub fn canonical_request(bytes: &[u8]) -> Value {
    match serde_json::from_slice::<Value>(bytes) {
        Ok(value) => typed::<abi::HostRequest>(value),
        Err(_) => serde_json::json!({ "bytes": String::from_utf8_lossy(bytes) }),
    }
}

/// JSON text as a value, or the text when it is not JSON.
fn json_or_text(bytes: &[u8]) -> Value {
    serde_json::from_slice(bytes).unwrap_or_else(|_| Value::String(String::from_utf8_lossy(bytes).into_owned()))
}

/// Builds a transcript's entries from the tap's events.
#[derive(Default)]
pub struct Recorder {
    entries: Vec<Entry>,
    normal: Normal,
    /// What each open call's reply is read as.
    open: Vec<Kind>,
}

impl Recorder {
    pub fn event(&mut self, event: &Event<'_>) {
        let entry = match event {
            Event::Open { major, minor, requires_minor, served } => {
                Entry::Open { major: *major, minor: *minor, requires_minor: *requires_minor, served: *served }
            }
            Event::Describe => {
                self.open.push(Kind::Describe);
                Entry::Describe
            }
            Event::Create { major, minor, features, options, .. } => {
                self.open.push(Kind::Manifest);
                Entry::Create {
                    major: *major,
                    minor: *minor,
                    features: if features.is_empty() { Value::Null } else { json_or_text(features) },
                    options: String::from_utf8_lossy(options).into_owned(),
                }
            }
            Event::Call { request, .. } => {
                let mut request = json_or_text(request);
                self.normal.request(&mut request);
                self.open.push(Kind::of(&request));
                Entry::Call { request }
            }
            Event::Destroy { .. } => Entry::Destroy,
            Event::Return { status, reply } => {
                let kind = self.open.pop().unwrap_or(Kind::Raw);
                let mut reply = canonical(kind, *status, *reply);
                if matches!(kind, Kind::View | Kind::Claim) {
                    self.normal.reply(&mut reply, false);
                }
                Entry::Return { status: *status, reply }
            }
            Event::Destroyed => Entry::Destroyed,
            Event::Host { request, status, reply } => {
                Entry::Host { request: canonical_request(request), status: *status, reply: json_or_text(reply) }
            }
            Event::Send { key, message, status } => Entry::Send {
                key: String::from_utf8_lossy(key).into_owned(),
                message: json_or_text(message),
                status: *status,
            },
            Event::Wake => Entry::Wake,
            Event::Stopped { answer } => Entry::Stopped { answer: *answer },
            Event::ThemeMode { answer } => Entry::ThemeMode { answer: *answer },
            Event::Report { message } => Entry::Report { message: String::from_utf8_lossy(message).into_owned() },
        };
        self.entries.push(entry);
    }

    /// Adds what the user sees now.
    pub fn observe(&mut self, seen: Value) {
        self.entries.push(Entry::Observe { seen });
    }

    pub fn entries(&self) -> &[Entry] {
        &self.entries
    }

    pub fn into_entries(self) -> Vec<Entry> {
        self.entries
    }
}

/// Where two lists of entries part, with a few entries of context; `None` when they are equal.
pub fn diff(expected: &[Entry], got: &[Entry]) -> Option<String> {
    let at = expected.iter().zip(got).position(|(expected, got)| expected != got);
    let at = match at {
        Some(at) => at,
        None if expected.len() == got.len() => return None,
        None => expected.len().min(got.len()),
    };
    let show = |entries: &[Entry]| {
        entries[at.saturating_sub(2)..(at + 3).min(entries.len())]
            .iter()
            .map(|entry| serde_json::to_string(entry).unwrap_or_default())
            .collect::<Vec<_>>()
            .join("\n    ")
    };
    Some(format!(
        "entry {at} differs\n  expected (from {}):\n    {}\n  got (from {}):\n    {}",
        at.saturating_sub(2),
        show(expected),
        at.saturating_sub(2),
        show(got)
    ))
}

// The protocol machine.

/// The C ABI's machine as `opencode_plugin.h` states it, fed the tap's events (4.14, "every model again through the
/// transcripts"). It is written from the header, not from the loader:
///
/// - At most one call into a library runs, and the host is not entered again from it: no call starts while one runs.
/// - The host table's `call` and `theme_mode` answer inside a call of the host's (they are the UI thread's), never
///   with `PANIC`, and `describe` asks for nothing.
/// - An instance is called only between a `create` that returned `OK` and its `destroy`, which comes once; an instance
///   whose `create` failed is never destroyed.
/// - After a call that panicked, an error, a reply the host cannot read (a handler's that is not `null`, a view's that
///   is no tree, a buffer refused unread), the instance is called no more, not even destroyed.
/// - A message goes only to an instance whose manifest takes messages; a view only of a
///   surface the manifest lists, and of no mount that ended; a draw or a layout only of a surface that declares one;
///   input only to a surface with a handler or a layer of the manifest; a claim's view and a search only of what the
///   manifest declares; a change of the plugin list (P6b) only to an instance whose manifest hears it.
/// - A render, a view, a claim's view, a draw, a layout or a search reads only: every request of it that asks for
///   something is answered `ERROR`.
/// - Every request is one the contract names, and so is every host request ([`EFFECTS`], [`READS`]).
#[derive(Default)]
pub struct Protocol {
    instances: HashMap<u64, Instance>,
    running: Option<Running>,
    broken: Option<String>,
}

struct Instance {
    state: State,
    /// What the manifest declares.
    manifest: abi::Manifest,
    ended: Vec<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum State {
    Creating,
    Live,
    /// `create` returned a manifest the host refused: the host destroys it, and calls nothing else.
    Refused,
    /// `create` did not return `OK`, or the host failed it.
    Dead,
    Destroyed,
}

struct Running {
    instance: Option<u64>,
    what: Call,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Call {
    Describe,
    Create,
    Request { kind: String, reads: bool },
    Destroy,
}

/// The requests of the host table that ask for something, by their `type`, as `opencode_plugin.h` lists them.
pub const EFFECTS: &[&str] = &[
    "toast",
    "storage-set",
    "storage-merge",
    "open-route",
    "dispatch",
    "attention",
    "navigate",
    "fetch",
    "dialog",
    "copy",
    "composer-edit",
    "set-variant",
    "set-model",
    "tab",
    "clear-selection",
    "foreground",
    "timer",
    "title",
    "set-theme",
    "install-theme",
    "scroll",
    "open-panel",
    "close-panel",
    "overlay",
    "close-overlay",
    "focus",
    "blur",
    "set-mode",
    "release-keys",
];

/// The requests of the host table that read, or shape only the call's own effects, as `opencode_plugin.h` lists them.
pub const READS: &[&str] = &[
    "log",
    "storage-get",
    "storage-key",
    "color",
    "session",
    "family",
    "messages",
    "message",
    "models",
    "model",
    "limits",
    "providers",
    "info",
    "mcp-servers",
    "integrations",
    "vcs",
    "route",
    "interactive",
    "shortcut",
    "dialog-open",
    "composer",
    "checkpoint",
    "rollback",
    "variants",
    "tabs-enabled",
    "tabs",
    "keymap-pending",
    "keymap-active",
    "keymap-commands",
    "shortcuts",
    "selection",
    "owner",
    "set-owner",
    "theme",
    "themes",
    "scroll-state",
    "anchors",
    "top-anchor",
    "transcript",
    "rect",
    "focused",
    "input-mode",
    "plugins",
    "utc-offset",
    "measure",
];

/// The requests of the host, by their `type`.
const REQUESTS: &[&str] = &[
    "command",
    "render-fence",
    "render",
    "event",
    "render-route",
    "reply",
    "mount",
    "wake",
    "route-mount",
    "fence-gone",
    "deltas",
    "view",
    "draw",
    "unmount",
    "message",
    "layout",
    "claim",
    "input",
    "search",
    "plugins",
    "cancelled",
];

/// The requests that run handlers, whose reply is `null`.
const HANDLERS: &[&str] = &[
    "command",
    "event",
    "reply",
    "mount",
    "wake",
    "route-mount",
    "fence-gone",
    "deltas",
    "unmount",
    "message",
    "plugins",
    "cancelled",
];

/// The requests that read only.
const RENDERS: &[&str] = &["render-fence", "render", "render-route", "view", "claim", "draw", "layout", "search"];

impl Protocol {
    /// The first rule broken so far.
    pub fn broken(&self) -> Option<&str> {
        self.broken.as_deref()
    }

    pub fn event(&mut self, event: &Event<'_>) {
        if self.broken.is_some() {
            return;
        }
        if let Err(error) = self.step(event) {
            self.broken = Some(format!("{error} (at {})", shown(event)));
        }
    }

    fn start(&mut self, instance: Option<u64>, what: Call) -> Result<(), String> {
        if let Some(running) = &self.running {
            return Err(format!("a call into a library started while {:?} runs", running.what));
        }
        self.running = Some(Running { instance, what });
        Ok(())
    }

    fn live(&mut self, instance: u64) -> Result<&mut Instance, String> {
        let known = self.instances.get_mut(&instance).ok_or("a call into an instance never created")?;
        match known.state {
            State::Live => Ok(known),
            state => Err(format!("a call into an instance that is {state:?}")),
        }
    }

    fn step(&mut self, event: &Event<'_>) -> Result<(), String> {
        match event {
            Event::Open { .. } => {}
            Event::Describe => self.start(None, Call::Describe)?,
            Event::Create { instance, .. } => {
                self.start(Some(*instance), Call::Create)?;
                let created =
                    Instance { state: State::Creating, manifest: abi::Manifest::default(), ended: Vec::new() };
                self.instances.insert(*instance, created);
            }
            Event::Call { instance, request } => {
                let request: Value = serde_json::from_slice(request).map_err(|_| "a request that is not JSON")?;
                let kind = request.get("type").and_then(Value::as_str).unwrap_or_default().to_owned();
                let known = self.live(*instance)?;
                if !REQUESTS.contains(&kind.as_str()) {
                    return Err(format!("a request the contract does not name: {kind}"));
                }
                let manifest = &known.manifest;
                if kind == "message" && !manifest.messages {
                    return Err("a message to a plugin whose manifest takes none".to_owned());
                }
                if kind == "plugins" && !manifest.plugins {
                    return Err("a change of the plugin list to a plugin whose manifest hears none".to_owned());
                }
                if let Some(surface) = request.get("surface") {
                    let at = surface.as_u64().and_then(|at| usize::try_from(at).ok());
                    let Some(claim) = at.and_then(|at| manifest.surfaces.get(at)) else {
                        return Err(format!("a {kind} of surface {surface} of {}", manifest.surfaces.len()));
                    };
                    let declared = match kind.as_str() {
                        "draw" => claim.draw,
                        "layout" => claim.layout,
                        _ => true,
                    };
                    if !declared {
                        return Err(format!("a {kind} of surface {surface}, which has none"));
                    }
                }
                let index = |field: &Value| field.as_u64().and_then(|at| usize::try_from(at).ok());
                let declared = match kind.as_str() {
                    "input" => {
                        let to = &request["to"];
                        match to.get("type").and_then(Value::as_str) {
                            Some("surface") => index(&to["surface"])
                                .and_then(|at| manifest.surfaces.get(at))
                                .is_some_and(|surface| surface.handler),
                            Some("layer") => index(&to["layer"]).is_some_and(|at| at < manifest.layers.len()),
                            _ => false,
                        }
                    }
                    "claim" => index(&request["claim"]).is_some_and(|at| at < manifest.claims.len()),
                    "search" => {
                        request["name"].as_str().is_some_and(|name| manifest.searches.iter().any(|known| known == name))
                    }
                    _ => true,
                };
                if !declared {
                    return Err(format!("a {kind} of what the manifest does not declare"));
                }
                let generation = request.pointer("/mount/generation").and_then(Value::as_u64);
                if let Some(generation) = generation.filter(|generation| known.ended.contains(generation)) {
                    return Err(format!("a {kind} of mount generation {generation}, which ended"));
                }
                if let (Some(generation), "unmount") = (generation, kind.as_str()) {
                    known.ended.push(generation);
                }
                let reads = RENDERS.contains(&kind.as_str());
                self.start(Some(*instance), Call::Request { kind, reads })?;
            }
            Event::Destroy { instance } => {
                let refused = self.instances.get(instance).is_some_and(|known| known.state == State::Refused);
                if !refused {
                    self.live(*instance)?;
                }
                self.start(Some(*instance), Call::Destroy)?;
            }
            Event::Return { status, reply } => {
                let running = self.running.take().ok_or("a return with no call")?;
                let instance = running.instance.and_then(|instance| self.instances.get_mut(&instance));
                match (running.what, instance) {
                    (Call::Describe, _) => {}
                    (Call::Create, Some(instance)) => {
                        let manifest = reply.ok().and_then(|bytes| serde_json::from_slice::<abi::Manifest>(bytes).ok());
                        match (*status, manifest) {
                            (abi::OK, Some(manifest)) => {
                                instance.state = State::Live;
                                instance.manifest = manifest;
                            }
                            (abi::OK, None) => instance.state = State::Refused,
                            _ => instance.state = State::Dead,
                        }
                    }
                    (Call::Request { kind, .. }, Some(instance)) => {
                        let readable = match reply {
                            Ok(bytes) if *status == abi::OK => match kind.as_str() {
                                "view" => serde_json::from_slice::<abi::ViewReply>(bytes).is_ok(),
                                "layout" => serde_json::from_slice::<abi::v2::LayoutReply>(bytes).is_ok(),
                                "claim" => serde_json::from_slice::<abi::claim::Reply>(bytes).is_ok(),
                                "input" => serde_json::from_slice::<abi::interact::Handled>(bytes).is_ok(),
                                "search" => serde_json::from_slice::<Vec<String>>(bytes).is_ok(),
                                // A list's bytes, which the canvas checks.
                                "draw" => true,
                                kind if HANDLERS.contains(&kind) => serde_json::from_slice::<()>(bytes).is_ok(),
                                _ => serde_json::from_slice::<Value>(bytes).is_ok(),
                            },
                            Ok(_) => true,
                            Err(_) => false,
                        };
                        let failed = *status == abi::PANIC || *status == abi::ERROR;
                        if failed || !readable {
                            instance.state = State::Dead;
                        }
                    }
                    (what, _) => return Err(format!("a return of {what:?}")),
                }
            }
            Event::Destroyed => {
                let running = self.running.take().ok_or("destroy returned with no call")?;
                let instance = running.instance.and_then(|instance| self.instances.get_mut(&instance));
                match (running.what, instance) {
                    (Call::Destroy, Some(instance)) => instance.state = State::Destroyed,
                    (what, _) => return Err(format!("destroy returned from {what:?}")),
                }
            }
            Event::Host { request, status, .. } => {
                let running = self.running.as_ref().ok_or("a host request outside any call")?;
                if running.what == Call::Describe {
                    return Err("a host request inside describe".to_owned());
                }
                if *status == abi::PANIC {
                    return Err("the host panicked answering a request".to_owned());
                }
                let request: Option<Value> = serde_json::from_slice(request).ok();
                let kind = request.as_ref().and_then(|request| request.get("type")).and_then(Value::as_str);
                let effect = kind.is_some_and(|kind| EFFECTS.contains(&kind));
                let named = effect || kind.is_some_and(|kind| READS.contains(&kind));
                if named && effect && matches!(running.what, Call::Request { reads: true, .. }) && *status != abi::ERROR
                {
                    return Err(format!("a render was granted {kind:?}"));
                }
                if !named && *status == abi::OK {
                    return Err(format!("the host answered a request the contract does not name: {kind:?}"));
                }
            }
            Event::ThemeMode { .. } => {
                if self.running.as_ref().is_none_or(|running| running.what == Call::Describe) {
                    return Err("theme_mode outside a call".to_owned());
                }
            }
            Event::Send { .. } | Event::Wake | Event::Stopped { .. } | Event::Report { .. } => {}
        }
        Ok(())
    }
}

/// `event` as text, its bytes as the JSON they hold.
fn shown(event: &Event<'_>) -> String {
    let text = |bytes: &[u8]| String::from_utf8_lossy(bytes).into_owned();
    match event {
        Event::Call { instance, request } => format!("call of instance {instance}: {}", text(request)),
        Event::Host { request, status, reply } => {
            format!("host request {} answered {status}: {}", text(request), text(reply))
        }
        Event::Return { status, reply: Ok(reply) } => format!("return {status}: {}", text(reply)),
        other => format!("{other:?}"),
    }
}

/// Runs `f` with a [`Protocol`] fed this thread's crossings, and returns the first rule broken.
pub fn checked<R>(f: impl FnOnce() -> R) -> (R, Option<String>) {
    let protocol = std::rc::Rc::new(RefCell::new(Protocol::default()));
    let fed = protocol.clone();
    let result = watch(move |event| fed.borrow_mut().event(event), f);
    let broken = protocol.borrow().broken().map(str::to_owned);
    (result, broken)
}

// The library side.

/// A request no host of any minor sends, for [`replay`]'s `future`: a library answers it `ERROR`.
pub const FUTURE_REQUEST: &str = r#"{"type":"x-future-request"}"#;

/// A field no host of any minor writes, added to every request of [`replay`]'s `future`.
pub const FUTURE_FIELD: &str = "x-future";

/// A host table of a later minor: 2.0's, then an entry 2.0 does not have.
#[repr(C)]
struct Later {
    api: HostApi,
    later: Option<unsafe extern "C" fn(*mut c_void)>,
}

/// The host side of [`replay`]: the transcript's answers, in order.
struct Fake {
    entries: Vec<Entry>,
    at: usize,
    failure: Option<String>,
}

impl Fake {
    fn fail(&mut self, failure: String) {
        if self.failure.is_none() {
            self.failure = Some(format!("entry {}: {failure}", self.at));
        }
    }

    /// The next entry, when it is one the library makes inside a call.
    fn nested(&mut self, what: &str) -> Option<Entry> {
        match self.entries.get(self.at) {
            Some(entry) if entry.nested() => {
                self.at += 1;
                Some(entry.clone())
            }
            other => {
                self.fail(format!("the library called {what}, where the transcript has {other:?}"));
                None
            }
        }
    }
}

thread_local! {
    /// The replay running on this thread: the fake host's entries reach it from the library's calls.
    static FAKE: RefCell<Option<Fake>> = const { RefCell::new(None) };
}

fn with_fake<R>(f: impl FnOnce(&mut Fake) -> R) -> Option<R> {
    FAKE.with_borrow_mut(|fake| fake.as_mut().map(f))
}

unsafe extern "C" fn fake_call(_: *mut c_void, request: Bytes, out: *mut Owned) -> i32 {
    // SAFETY: the library passes bytes valid for the call.
    let got = canonical_request(unsafe { request.as_slice() });
    let answer = with_fake(|fake| match fake.nested("the host's call") {
        Some(Entry::Host { request, status, reply }) if request == got => Some((status, reply)),
        Some(other) => {
            fake.at -= 1;
            fake.fail(format!("the library asked the host {got}, where the transcript has {other:?}"));
            None
        }
        None => None,
    });
    let (status, bytes) = match answer.flatten() {
        Some((abi::OK, reply)) => (abi::OK, serde_json::to_vec(&reply).unwrap_or_default()),
        Some((status, reply)) => (status, reply.as_str().unwrap_or_default().as_bytes().to_vec()),
        None => (abi::ERROR, b"not in the transcript".to_vec()),
    };
    if !out.is_null() {
        // SAFETY: `out` is valid for writes during the call.
        unsafe { *out = Owned::from_vec(bytes) };
    }
    status
}

unsafe extern "C" fn fake_free(owned: Owned) {
    // SAFETY: `fake_call` made it with `Owned::from_vec`.
    drop(unsafe { owned.into_vec() });
}

unsafe extern "C" fn fake_theme_mode(_: *mut c_void) -> u32 {
    let answer = with_fake(|fake| match fake.nested("theme_mode") {
        Some(Entry::ThemeMode { answer }) => answer,
        Some(other) => {
            fake.at -= 1;
            fake.fail(format!("the library called theme_mode, where the transcript has {other:?}"));
            abi::THEME_DARK
        }
        None => abi::THEME_DARK,
    });
    answer.unwrap_or(abi::THEME_DARK)
}

unsafe extern "C" fn fake_wake(_: *mut c_void) {
    with_fake(|fake| match fake.nested("wake") {
        Some(Entry::Wake) | None => {}
        Some(other) => {
            fake.at -= 1;
            fake.fail(format!("the library called wake, where the transcript has {other:?}"));
        }
    });
}

unsafe extern "C" fn fake_send(_: *mut c_void, key: Bytes, message: Bytes) -> i32 {
    // SAFETY: the library passes bytes valid for the call.
    let (key, message) = unsafe { (String::from_utf8_lossy(key.as_slice()).into_owned(), message.as_slice()) };
    let message = json_or_text(message);
    let status = with_fake(|fake| match fake.nested("send") {
        Some(Entry::Send { key: want, message: wanted, status }) if want == key && wanted == message => status,
        Some(other) => {
            fake.at -= 1;
            fake.fail(format!("the library sent {key:?} {message}, where the transcript has {other:?}"));
            abi::CLOSED
        }
        None => abi::CLOSED,
    });
    status.unwrap_or(abi::CLOSED)
}

unsafe extern "C" fn fake_report(_: *mut c_void, message: Bytes) {
    // SAFETY: the library passes bytes valid for the call.
    let message = String::from_utf8_lossy(unsafe { message.as_slice() }).into_owned();
    with_fake(|fake| match fake.nested("report") {
        Some(Entry::Report { message: want }) if want == message => {}
        Some(other) => {
            fake.at -= 1;
            fake.fail(format!("the library reported {message:?}, where the transcript has {other:?}"));
        }
        None => {}
    });
}

unsafe extern "C" fn fake_stopped(_: *mut c_void) -> u32 {
    let answer = with_fake(|fake| match fake.nested("stopped") {
        Some(Entry::Stopped { answer }) => answer,
        Some(other) => {
            fake.at -= 1;
            fake.fail(format!("the library called stopped, where the transcript has {other:?}"));
            1
        }
        None => 1,
    });
    answer.unwrap_or(1)
}

/// The entries of an opened library.
struct Opened {
    major: u32,
    minor: u32,
    requires_minor: u32,
    create: unsafe extern "C" fn(*const HostApi, Bytes, *mut *mut c_void, *mut Owned) -> i32,
    call: unsafe extern "C" fn(*mut c_void, Bytes, *mut Owned) -> i32,
    destroy: Option<unsafe extern "C" fn(*mut c_void)>,
    free: unsafe extern "C" fn(Owned),
    describe: unsafe extern "C" fn(*mut Owned) -> i32,
}

impl Opened {
    /// The entries of the table `api` points to, checked as the host checks them.
    ///
    /// # Safety
    /// `api` is null or points to a table that starts as [`PluginApi`] and covers its `size`.
    unsafe fn new(api: *const PluginApi) -> Result<Self, String> {
        if api.is_null() || !api.is_aligned() {
            return Err("the entry returned no table, or one that is not aligned".to_owned());
        }
        // SAFETY: as documented; nothing past `size` is read.
        let size = unsafe { std::ptr::addr_of!((*api).size).read() };
        if size < size_of::<PluginApi>() {
            return Err(format!("the table is {size} bytes, shorter than the 2.0 table"));
        }
        // SAFETY: `size` covers the 2.0 table.
        let core = unsafe { &*api };
        let missing = |name: &str| format!("the table has a null `{name}`");
        Ok(Self {
            major: core.major,
            minor: core.minor,
            requires_minor: core.requires_minor,
            create: core.create.ok_or_else(|| missing("create"))?,
            call: core.call.ok_or_else(|| missing("call"))?,
            destroy: core.destroy,
            free: core.free.ok_or_else(|| missing("free"))?,
            describe: core.describe.ok_or_else(|| missing("describe"))?,
        })
    }

    /// The status and bytes of a call that wrote `out`, which goes back to the library's `free`. A descriptor that
    /// cannot describe what the library allocated is refused unread.
    unsafe fn taken(&self, status: i32, out: Owned) -> (i32, Result<Vec<u8>, String>) {
        let bytes = match (out.ptr.is_null(), out.len) {
            (true, 0) => Ok(Vec::new()),
            (true, len) => Err(format!("a null buffer of {len} bytes")),
            (false, len) if len > out.cap => Err(format!("a buffer of {len} bytes in {} of room", out.cap)),
            // SAFETY: the library wrote `len` bytes at `ptr`, which it owns until `free`.
            (false, _) => Ok(unsafe { out.to_vec() }),
        };
        // SAFETY: the buffer goes back to the library that wrote it, once.
        unsafe { (self.free)(out) };
        (status, bytes)
    }
}

/// Drives the library whose table `api` is through `transcript` from the host's side, and checks that every reply and
/// every request of the library's equals the transcript's. With `future` the host is of a later minor: its table is
/// longer and says minor 1 and a feature the library does not know, every request carries a field the library does not
/// know, and after `create` it sends a request the library does not know, which must answer `ERROR` and change
/// nothing.
///
/// # Safety
/// `api` points to a library's table, which stays loaded; the library keeps to `opencode_plugin.h`.
pub unsafe fn replay(api: *const PluginApi, transcript: &Transcript, future: bool) -> Result<(), String> {
    // SAFETY: as documented.
    let library = unsafe { Opened::new(api)? };
    // The fake host reads the transcript through a thread-local while the library calls it.
    struct Clear;
    impl Drop for Clear {
        fn drop(&mut self) {
            FAKE.set(None);
        }
    }
    FAKE.set(Some(Fake { entries: transcript.entries.clone(), at: 0, failure: None }));
    let _clear = Clear;
    // What the host tables point to lives until the replay ends, past every call of the library's.
    let mut features: Vec<Vec<u8>> = Vec::new();
    let mut tables: Vec<Box<Later>> = Vec::new();
    let mut instance: *mut c_void = std::ptr::null_mut();
    loop {
        let Some((at, entry)) = with_fake(|fake| {
            let at = fake.at;
            fake.at += 1;
            fake.entries.get(at).map(|entry| (at, entry.clone()))
        })
        .flatten() else {
            break;
        };
        let call = |name: &str, run: &mut dyn FnMut(*mut Owned) -> i32, kind: Kind| -> Result<(), String> {
            let mut out = Owned::EMPTY;
            let status = run(&mut out);
            // SAFETY: the library wrote `out`.
            let (status, bytes) = unsafe { library.taken(status, out) };
            let got = canonical(kind, status, bytes.as_deref().map_err(String::as_str));
            check(name, at, &Entry::Return { status, reply: got })
        };
        let result = match entry {
            Entry::Open { major, minor, requires_minor, .. } => {
                let got = (library.major, library.minor, library.requires_minor);
                match got == (major, minor, requires_minor) {
                    true => Ok(()),
                    false => Err(format!(
                        "entry {at}: the library's table is {}.{} requiring {}, the transcript's {major}.{minor} \
                         requiring {requires_minor}",
                        got.0, got.1, got.2
                    )),
                }
            }
            // SAFETY: `out` is valid for writes.
            Entry::Describe => call("describe", &mut |out| unsafe { (library.describe)(out) }, Kind::Describe),
            Entry::Create { major, minor, features: listed, options } => {
                // A later host has every feature the transcript's host stated, and one no library knows.
                let listed = match (future, listed) {
                    (true, Value::Array(mut names)) => {
                        names.push(serde_json::json!(format!("{FUTURE_FIELD}-feature")));
                        Value::Array(names)
                    }
                    (true, _) => serde_json::json!([format!("{FUTURE_FIELD}-feature")]),
                    (false, listed) => listed,
                };
                features.push(match listed {
                    Value::Null => Vec::new(),
                    listed => serde_json::to_vec(&listed).unwrap_or_default(),
                });
                let later = Box::new(Later {
                    api: HostApi {
                        size: if future { size_of::<Later>() } else { size_of::<HostApi>() },
                        major,
                        minor: if future { minor + 1 } else { minor },
                        ctx: std::ptr::null_mut(),
                        call: Some(fake_call),
                        free: Some(fake_free),
                        theme_mode: Some(fake_theme_mode),
                        wake: Some(fake_wake),
                        send: Some(fake_send),
                        report: Some(fake_report),
                        stopped: Some(fake_stopped),
                        features: Bytes::new(features.last().map_or(&[][..], Vec::as_slice)),
                    },
                    later: None,
                });
                let host: *const HostApi = &later.api;
                tables.push(later);
                let mut created = std::ptr::null_mut();
                let run = &mut |out| {
                    // SAFETY: the table lives until the replay ends, past every call of the library's.
                    unsafe { (library.create)(host, Bytes::new(options.as_bytes()), &mut created, out) }
                };
                let result = call("create", run, Kind::Manifest);
                instance = created;
                match (future, result) {
                    (true, Ok(())) if !instance.is_null() => future_request(&library, instance),
                    (_, result) => result,
                }
            }
            Entry::Call { mut request } => {
                if let (true, Value::Object(object)) = (future, &mut request) {
                    object.insert(FUTURE_FIELD.to_owned(), Value::Bool(true));
                }
                let kind = Kind::of(&request);
                let bytes = serde_json::to_vec(&request).unwrap_or_default();
                // SAFETY: `instance` came from `create`; `out` is valid for writes.
                call("call", &mut |out| unsafe { (library.call)(instance, Bytes::new(&bytes), out) }, kind)
            }
            Entry::Destroy => {
                if let Some(destroy) = library.destroy {
                    // SAFETY: `instance` came from `create` and is destroyed once.
                    unsafe { destroy(instance) };
                }
                check("destroy", at, &Entry::Destroyed)
            }
            Entry::Observe { .. } => Ok(()),
            nested => Err(format!("entry {at}: the transcript has the library make {nested:?} here, and it did not")),
        };
        let failure = with_fake(|fake| fake.failure.take()).flatten();
        if let Some(failure) = failure {
            return Err(failure);
        }
        result?;
    }
    Ok(())
}

/// After the nested entries of a call the library returned from: the next entry must be `expected`.
fn check(name: &str, at: usize, expected: &Entry) -> Result<(), String> {
    let next = with_fake(|fake| {
        let next = fake.entries.get(fake.at).cloned();
        fake.at += 1;
        next
    })
    .flatten();
    match next {
        Some(entry) if entry == *expected => Ok(()),
        Some(entry) if entry.nested() => {
            Err(format!("entry {at}: {name} returned before the library made {entry:?}; it returned {expected:?}"))
        }
        Some(Entry::Return { status, reply }) => {
            let wanted = Entry::Return { status, reply };
            Err(format!("entry {at}: {name} returned\n    {expected:?}\n  where the transcript has\n    {wanted:?}"))
        }
        other => Err(format!("entry {at}: {name} returned {expected:?}, where the transcript has {other:?}")),
    }
}

/// [`FUTURE_REQUEST`] to `instance`: answered `ERROR`, with no request of the library's.
fn future_request(library: &Opened, instance: *mut c_void) -> Result<(), String> {
    let mut out = Owned::EMPTY;
    let before = with_fake(|fake| fake.at).unwrap_or_default();
    // SAFETY: `instance` came from `create`; `out` is valid for writes.
    let status = unsafe { (library.call)(instance, Bytes::new(FUTURE_REQUEST.as_bytes()), &mut out) };
    // SAFETY: the library wrote `out`.
    let (status, _) = unsafe { library.taken(status, out) };
    let after = with_fake(|fake| fake.at).unwrap_or_default();
    match (status, after == before) {
        (abi::ERROR, true) => Ok(()),
        (abi::ERROR, false) => Err("a request the library does not know made it call the host".to_owned()),
        (status, _) => Err(format!("a request the library does not know was answered {status}, not ERROR")),
    }
}

/// What [`check_library`] found for one transcript.
#[derive(Debug)]
pub struct Outcome {
    pub transcript: String,
    pub future: bool,
    pub result: Result<(), String>,
}

/// Replays every golden transcript against the library at `path`, also as a host of a later minor: `plugin test
/// --conformance`. A library passes when it is the conformance plugin, in any language (`examples/conformance`).
pub fn check_library(path: &Path) -> Result<Vec<Outcome>, String> {
    // SAFETY: loading runs the library's initializers; a plugin is code the user chose to run.
    let library = unsafe { opencode_util::dl::Library::open(path) }.map_err(|error| error.to_string())?;
    // SAFETY: the entry has type `EntryFn`.
    let entry = unsafe { library.symbol::<abi::EntryFn>(abi::ENTRY) }
        .map_err(|_| format!("not an opencode-native plugin: no `{}` symbol", abi::ENTRY))?;
    // SAFETY: as above; the table lives as long as the library, which stays loaded.
    let api = unsafe { entry() };
    library.leak();
    let mut outcomes = Vec::new();
    for transcript in golden()?.iter() {
        for future in [false, true] {
            // SAFETY: the library stays loaded.
            let result = unsafe { replay(api, transcript, future) };
            outcomes.push(Outcome { transcript: transcript.header.transcript.clone(), future, result });
        }
    }
    Ok(outcomes)
}

#[cfg(test)]
mod tests;
