//! One-line tool summaries shared by `run`, mini and the full TUI.

use indexmap::IndexMap;
use opencode_api_types::js::js_string;
pub use opencode_api_types::tool::*;
use opencode_api_types::{SessionMessageAssistantTool, SessionMessageAssistantToolState, ToolContent};
use opencode_util::json_object;
use serde_json::{Map, Value};

/// The summary of one tool call.
#[derive(Debug, Clone, PartialEq)]
pub struct ToolInline {
    pub icon: &'static str,
    pub title: String,
    pub description: Option<String>,
    /// The TS `mode: "block"`: the tool shows `body` under the title.
    pub block: bool,
    pub body: Option<String>,
}

/// The summary of `part`. Paths are shown relative to `directory`, else to the current directory.
pub fn tool_inline_info(part: &SessionMessageAssistantTool, directory: Option<&str>) -> ToolInline {
    let frame = Frame::new(part, directory);
    let draw = match frame.kind {
        ToolKind::Invalid => run_invalid,
        ToolKind::Shell => run_shell,
        ToolKind::Write => run_write,
        ToolKind::Edit => run_edit,
        ToolKind::Patch => run_patch,
        ToolKind::Batch => run_batch,
        ToolKind::Subagent => run_task,
        ToolKind::Todo => run_todo,
        ToolKind::Question => run_question,
        ToolKind::Read => run_read,
        ToolKind::Glob => run_glob,
        ToolKind::Grep => run_grep,
        ToolKind::List => run_list,
        ToolKind::Lsp => run_lsp,
        ToolKind::WebFetch => run_webfetch,
        ToolKind::WebSearch => run_web_search,
        ToolKind::Skill => run_skill,
        _ => return fallback_inline(&frame),
    };
    draw(&frame).unwrap_or_else(|| fallback_inline(&frame))
}

pub fn finite_number(value: &Value) -> Option<f64> {
    value.as_f64().filter(|number| number.is_finite())
}

/// `[key=value, …]` over the string, number, and boolean entries of `input`, in wire order.
pub fn primitive_input_summary<'a>(input: impl IntoIterator<Item = (&'a String, &'a Value)>, omit: &[&str]) -> String {
    let entries: Vec<_> = input
        .into_iter()
        .filter(|(key, value)| {
            !omit.contains(&key.as_str()) && matches!(value, Value::String(_) | Value::Number(_) | Value::Bool(_))
        })
        .map(|(key, value)| format!("{key}={}", js_string(value)))
        .collect();
    if entries.is_empty() {
        return String::new();
    }
    format!("[{}]", entries.join(", "))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExecuteStatus {
    Running,
    Completed,
    Error,
}

/// One nested call of a code-mode `execute` tool, from its `toolCalls` metadata.
#[derive(Debug, Clone, PartialEq)]
pub struct ExecuteCall {
    pub tool: String,
    pub status: ExecuteStatus,
    pub input: Option<Map<String, Value>>,
}

pub fn execute_calls(value: &Value) -> Vec<ExecuteCall> {
    let Some(calls) = value.as_array() else { return Vec::new() };
    calls
        .iter()
        .filter_map(|call| {
            let call = call.as_object()?;
            let status = match call.get("status")?.as_str()? {
                "running" => ExecuteStatus::Running,
                "completed" => ExecuteStatus::Completed,
                "error" => ExecuteStatus::Error,
                _ => return None,
            };
            Some(ExecuteCall {
                tool: call.get("tool")?.as_str()?.to_owned(),
                status,
                input: call.get("input").and_then(Value::as_object).cloned(),
            })
        })
        .collect()
}

pub fn execute_call_summary(call: &ExecuteCall) -> String {
    call_summary(&call.tool, call.input.iter().flatten())
}

/// `tool [key=value …]`: a call by its name and the primitive entries of its input, on one line.
pub fn call_summary<'a>(tool: &str, input: impl IntoIterator<Item = (&'a String, &'a Value)>) -> String {
    let args = primitive_input_summary(input, &[]).split_whitespace().collect::<Vec<_>>().join(" ");
    if args.is_empty() {
        return tool.to_owned();
    }
    format!("{tool} {args}")
}

pub fn web_search_provider_name(provider: &Value) -> String {
    let Some(provider) = provider.as_str().filter(|provider| !provider.is_empty()) else { return String::new() };
    if provider == "opencode" {
        return "OpenCode".to_owned();
    }
    let mut chars = provider.chars();
    chars.next().map(|first| first.to_uppercase().chain(chars).collect()).unwrap_or_default()
}

pub fn web_search_provider_label(provider: &Value) -> String {
    let name = web_search_provider_name(provider);
    if name.is_empty() {
        return "Web Search".to_owned();
    }
    format!("Web Search via {name}")
}

/// The tool's metadata, or an empty map while it streams or when it has none.
pub fn tool_display_metadata(state: &SessionMessageAssistantToolState) -> Map<String, Value> {
    let metadata = match state {
        SessionMessageAssistantToolState::Streaming(_) => return Map::new(),
        SessionMessageAssistantToolState::Running(state) => Some(&state.metadata),
        SessionMessageAssistantToolState::Completed(state) => state.metadata.as_ref(),
        SessionMessageAssistantToolState::Error(state) => state.metadata.as_ref(),
        SessionMessageAssistantToolState::Unknown(state) => {
            if state.get("status").is_none() {
                return Map::new();
            }
            return state.get("metadata").and_then(Value::as_object).cloned().unwrap_or_default();
        }
    };
    metadata
        .map(|metadata| metadata.iter().map(|(key, value)| (key.clone(), value.clone())).collect())
        .unwrap_or_default()
}

/// The tool's content items, empty until it finishes.
pub fn tool_display_content(state: &SessionMessageAssistantToolState) -> std::borrow::Cow<'_, [ToolContent]> {
    match state {
        SessionMessageAssistantToolState::Streaming(_) | SessionMessageAssistantToolState::Running(_) => {
            Default::default()
        }
        SessionMessageAssistantToolState::Completed(state) => state.content.as_slice().into(),
        SessionMessageAssistantToolState::Error(state) => state.content.as_deref().unwrap_or_default().into(),
        // A state this client does not know may still carry content items.
        SessionMessageAssistantToolState::Unknown(state) => state
            .get("content")
            .and_then(|content| serde_json::from_value::<Vec<ToolContent>>(content.clone()).ok())
            .unwrap_or_default()
            .into(),
    }
}

/// The user-facing text of a tool's content items.
pub fn tool_output_text(name: &str, content: &[ToolContent]) -> String {
    fn text_of(item: &ToolContent) -> Option<Option<&str>> {
        match item {
            ToolContent::Text(text) => Some(Some(text.text.as_str())),
            _ => None,
        }
    }
    let kind = ToolKind::of(name);
    // V2 shell content appends model-only status after the user-visible command output.
    if kind == ToolKind::Shell {
        return content.iter().find_map(text_of).flatten().unwrap_or_default().to_owned();
    }
    let joined = content
        .iter()
        .filter_map(|item| text_of(item).flatten())
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if kind == ToolKind::Read {
        return read_display_text(&joined).unwrap_or(joined);
    }
    joined
}

/// Show paths inside the working directory as relative paths; leave outside paths absolute.
pub fn tool_path(input: &str, directory: Option<&str>, home: Option<&str>) -> String {
    if let Some(directory) = directory {
        return crate::path::format_path(input, directory, home, true);
    }
    let cwd = std::env::current_dir().unwrap_or_default();
    crate::path::format_path(input, &cwd.to_string_lossy(), home, true)
}

pub fn todo_marker(status: TodoStatus, ascii: bool) -> &'static str {
    match (status, ascii) {
        (TodoStatus::Completed, false) => "[✓]",
        (TodoStatus::Completed, true) => "[x]",
        (TodoStatus::InProgress, false) => "[•]",
        (TodoStatus::InProgress, true) => "[>]",
        (TodoStatus::Cancelled, _) => "[-]",
        (TodoStatus::Pending, _) => "[ ]",
    }
}

/// The TS `ToolFrame`: a tool part normalized for display.
struct Frame<'a> {
    directory: Option<&'a str>,
    name: &'a str,
    kind: ToolKind,
    input: ToolInput<'a>,
    meta: Map<String, Value>,
    status: &'a str,
    output: String,
}

impl<'a> Frame<'a> {
    fn new(part: &'a SessionMessageAssistantTool, directory: Option<&'a str>) -> Self {
        let kind = ToolKind::of(&part.name);
        Frame {
            directory,
            name: canonical_tool_name(&part.name),
            kind,
            input: ToolInput::of(&part.state),
            meta: normalize_metadata(kind, tool_display_metadata(&part.state)),
            status: part.state.tag(),
            output: tool_output_text(&part.name, &tool_display_content(&part.state)),
        }
    }

    fn completed_output(&self) -> Option<String> {
        (self.status == "completed").then(|| self.output.clone())
    }

    /// `displayPath(p, value)`: `None` where the TS would throw on a value that is not a string.
    fn path(&self, value: Field) -> Option<String> {
        if !value.truthy() {
            return Some(String::new());
        }
        Some(tool_path(value.str()?, self.directory, None))
    }
}

/// `normalizeMetadata`: the files of edit and patch metadata with legacy field names mapped.
pub fn normalize_metadata(kind: ToolKind, mut metadata: Map<String, Value>) -> Map<String, Value> {
    if !matches!(kind, ToolKind::Edit | ToolKind::Patch) {
        return metadata;
    }
    if let Some(Value::Array(files)) = metadata.get("files") {
        let files = files.iter().filter_map(normalize_file).collect();
        metadata.insert("files".to_owned(), Value::Array(files));
    }
    metadata
}

/// A file of edit or patch metadata, with legacy field names mapped to `file`, `status`, and `from`.
fn normalize_file(value: &Value) -> Option<Value> {
    let field = |key| value.get(key).and_then(Value::as_str).unwrap_or_default();
    let name = [field("file"), field("relativePath"), field("filePath")].into_iter().find(|name| !name.is_empty())?;
    let status = match (field("status"), field("type")) {
        ("", "add") => "added",
        ("", "delete") => "deleted",
        ("", "update") => "modified",
        ("", "move") => "moved",
        ("", legacy) => legacy,
        (status, _) => status,
    };
    let from = field("filePath");
    Some(json_object! {
        ..value.clone(),
        "file": name,
        "from"?: (status == "moved" && !from.is_empty()).then_some(from),
        "status"?: (!status.is_empty()).then_some(status),
    })
}

fn fallback_inline(frame: &Frame) -> ToolInline {
    let input = frame.input.iter().collect::<IndexMap<_, _>>();
    let input = if input.is_empty() { "Unknown".to_owned() } else { serde_json::to_string(&input).unwrap_or_default() };
    inline("⚙", format!("{} {input}", frame.name))
}

fn run_glob(frame: &Frame) -> Option<ToolInline> {
    search(frame, "Glob", "count")
}

fn run_grep(frame: &Frame) -> Option<ToolInline> {
    search(frame, "Grep", "matches")
}

fn search(frame: &Frame, label: &str, metadata: &str) -> Option<ToolInline> {
    let root = frame.input.path();
    let suffix = if root.truthy() { format!("in {}", frame.path(root)?) } else { String::new() };
    let description = match frame.meta.get(metadata) {
        None => suffix,
        Some(matches) => {
            let separator = if suffix.is_empty() { "" } else { " · " };
            let plural = if matches.as_f64() == Some(1.0) { "" } else { "es" };
            format!("{suffix}{separator}{} match{plural}", js_string(matches))
        }
    };
    let title = format!("{label} \"{}\"", SearchInput(frame.input).pattern().js());
    Some(ToolInline { description: non_empty(description), ..inline("✱", title) })
}

fn run_list(frame: &Frame) -> Option<ToolInline> {
    let dir = frame.input.path().text();
    if dir.is_empty() {
        return Some(inline("→", "List".to_owned()));
    }
    Some(inline("→", format!("List {}", tool_path(dir, frame.directory, None))))
}

fn run_read(frame: &Frame) -> Option<ToolInline> {
    let file = frame.path(frame.input.legacy_path())?;
    let description = non_empty(primitive_input_summary(frame.input.iter(), &["path"]));
    Some(ToolInline { description, ..inline("→", format!("Read {file}")) })
}

fn run_write(frame: &Frame) -> Option<ToolInline> {
    let title = format!("Write {}", frame.path(frame.input.legacy_path())?);
    Some(block("←", title, frame.completed_output()))
}

fn run_webfetch(frame: &Frame) -> Option<ToolInline> {
    let url = WebFetchInput(frame.input).url();
    if !url.truthy() {
        return Some(inline("%", "WebFetch".to_owned()));
    }
    Some(inline("%", format!("WebFetch {}", url.js())))
}

fn run_edit(frame: &Frame) -> Option<ToolInline> {
    let file = frame.meta.get("files").and_then(Value::as_array).and_then(|files| files.first());
    let patch = file.and_then(|file| file.get("patch")).filter(|patch| !patch.is_null());
    let body = patch.or_else(|| frame.meta.get("diff")).and_then(Value::as_str).map(str::to_owned);
    let title = format!("Edit {}", frame.path(frame.input.legacy_path())?);
    Some(block("←", title, body))
}

fn run_web_search(frame: &Frame) -> Option<ToolInline> {
    let title = web_search_provider_label(frame.meta.get("provider").unwrap_or(&Value::Null));
    let query = WebSearchInput(frame.input).query();
    if !query.truthy() {
        return Some(inline("◈", title));
    }
    Some(inline("◈", format!("{title} \"{}\"", query.js())))
}

fn run_task(frame: &Frame) -> Option<ToolInline> {
    let input = SubagentInput(frame.input);
    let agent = input.legacy_agent();
    let kind = titlecase(if agent.truthy() { agent.str()? } else { "unknown" });
    let icon = match frame.status {
        "error" => "✗",
        "running" => "•",
        _ => "✓",
    };
    let description = input.description();
    if !description.truthy() {
        return Some(inline(icon, format!("{kind} Subagent")));
    }
    Some(ToolInline { description: Some(format!("{kind} Agent")), ..inline(icon, description.js()) })
}

fn run_skill(frame: &Frame) -> Option<ToolInline> {
    let name = [frame.meta.get("name"), SkillInput(frame.input).id().value()]
        .into_iter()
        .flatten()
        .find(|name| !name.is_null());
    Some(inline("→", format!("Skill \"{}\"", name.map(js_string).unwrap_or_default())))
}

fn run_patch(frame: &Frame) -> Option<ToolInline> {
    // `metadata.files?.length ?? 0`
    let files = match frame.meta.get("files") {
        Some(Value::Array(files)) => files.len(),
        Some(Value::String(files)) => files.encode_utf16().count(),
        _ => 0,
    };
    if files == 0 {
        return Some(inline("%", "Patch".to_owned()));
    }
    Some(inline("%", format!("Patch {files} file{}", plural(files))))
}

fn run_todo(frame: &Frame) -> Option<ToolInline> {
    let body = TodoInput(frame.input)
        .items()
        .iter()
        .map(|todo| format!("{} {}", todo_marker(todo.status, false), todo.content))
        .collect::<Vec<_>>()
        .join("\n");
    Some(block("#", "Todos".to_owned(), Some(body)))
}

fn run_question(frame: &Frame) -> Option<ToolInline> {
    let total = QuestionInput(frame.input).questions().array().len();
    Some(inline("→", format!("Asked {total} question{}", plural(total))))
}

fn run_invalid(frame: &Frame) -> Option<ToolInline> {
    Some(block("✗", "Invalid Tool".to_owned(), frame.completed_output()))
}

fn run_batch(frame: &Frame) -> Option<ToolInline> {
    let calls = BatchInput(frame.input).tool_calls().array().len();
    let title = if calls > 0 { format!("Batch {calls} tool{}", plural(calls)) } else { "Batch".to_owned() };
    Some(block("#", title, frame.completed_output()))
}

fn run_lsp(frame: &Frame) -> Option<ToolInline> {
    let input = LspInput(frame.input);
    let operation = if input.operation().truthy() { input.operation().js() } else { "request".to_owned() };
    let file = frame.path(frame.input.legacy_path())?;
    if file.is_empty() {
        return Some(inline("→", format!("LSP {operation}")));
    }
    let number = |value: Option<&Value>| value.filter(|value| value.is_number()).map(js_string);
    let position = match (number(input.line().value()), number(input.character().value())) {
        (Some(line), Some(character)) => format!(":{line}:{character}"),
        _ => String::new(),
    };
    Some(inline("→", format!("LSP {operation} {file}{position}")))
}

fn run_shell(frame: &Frame) -> Option<ToolInline> {
    let command = ShellInput(frame.input).command();
    let title = if command.truthy() { command.js() } else { String::new() };
    let body = (frame.status == "completed").then(|| frame.output.trim().to_owned());
    Some(block("$", title, body))
}

fn inline(icon: &'static str, title: String) -> ToolInline {
    ToolInline { icon, title, description: None, block: false, body: None }
}

fn block(icon: &'static str, title: String, body: Option<String>) -> ToolInline {
    ToolInline { block: true, body, ..inline(icon, title) }
}

fn plural(count: usize) -> &'static str {
    if count == 1 { "" } else { "s" }
}

fn non_empty(text: String) -> Option<String> {
    (!text.is_empty()).then_some(text)
}

/// `Locale.titlecase`: uppercases every ASCII word character that starts a word.
pub fn titlecase(text: &str) -> String {
    let word = |char: char| char.is_ascii_alphanumeric() || char == '_';
    let mut previous = None;
    text.chars()
        .map(|char| {
            let start = word(char) && !previous.is_some_and(word);
            previous = Some(char);
            if start { char.to_ascii_uppercase() } else { char }
        })
        .collect()
}
