//! Tool summaries, ported from `toolInlineInfo` (U.5).
//!
//! [`tool_inline_info`] is the one-line summary of a tool call that `run`, `mini`, and the TUI share
//! (`packages/tui/src/mini/tool.ts`). The other public functions are the tool display helpers of
//! `packages/tui/src/util/tool-display.ts` and `util/todo.ts`, which the TUI's tool views use too.
//!
//! The TypeScript works on untyped JSON and falls back to a generic summary when a rule throws. This
//! port reads the part as JSON the same way, and a rule that would throw returns `None`.

use opencode_api::generated::types::{SessionMessageAssistantTool, SessionMessageAssistantToolState, ToolContent};
use opencode_api::query::js_string;
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
    let draw = match frame.name {
        "invalid" => run_invalid,
        "shell" => run_shell,
        "write" => run_write,
        "edit" => run_edit,
        "patch" => run_patch,
        "batch" => run_batch,
        "subagent" => run_task,
        "todowrite" => run_todo,
        "question" => run_question,
        "read" => run_read,
        "glob" => run_glob,
        "grep" => run_grep,
        "list" => run_list,
        "lsp" => run_lsp,
        "webfetch" => run_webfetch,
        "websearch" => run_web_search,
        "skill" => run_skill,
        _ => return fallback_inline(&frame),
    };
    draw(&frame).unwrap_or_else(|| fallback_inline(&frame))
}

/// The current name of a tool whose persisted name is a legacy alias.
pub fn canonical_tool_name(name: &str) -> &str {
    match name {
        "bash" => "shell",
        "task" => "subagent",
        "apply_patch" => "patch",
        _ => name,
    }
}

pub fn finite_number(value: &Value) -> Option<f64> {
    value.as_f64().filter(|number| number.is_finite())
}

/// `[key=value, …]` over the string, number, and boolean entries of `input`, in wire order.
pub fn primitive_input_summary(input: &Map<String, Value>, omit: &[&str]) -> String {
    let entries: Vec<_> = input
        .iter()
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
    let Some(calls) = value.as_array() else {
        return Vec::new();
    };
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
    let args = primitive_input_summary(call.input.as_ref().unwrap_or(&Map::new()), &[]);
    let args = args.split(char::is_whitespace).filter(|part| !part.is_empty());
    let args = args.collect::<Vec<_>>().join(" ");
    if args.is_empty() {
        return call.tool.clone();
    }
    format!("{} {args}", call.tool)
}

pub fn web_search_provider_name(provider: &Value) -> String {
    let Some(provider) = provider.as_str().filter(|provider| !provider.is_empty()) else {
        return String::new();
    };
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
            return dict(state.get("metadata"));
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
    let name = canonical_tool_name(name);
    // V2 shell content appends model-only status after the user-visible command output.
    if name == "shell" {
        return content.iter().find_map(text_of).flatten().unwrap_or_default().to_owned();
    }
    let joined = content
        .iter()
        .filter_map(|item| text_of(item).flatten())
        .filter(|text| !text.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    if name == "read" {
        return read_display_text(&joined).unwrap_or(joined);
    }
    joined
}

/// Read's model content is a JSON page envelope; this unwraps the human-facing text.
pub fn read_display_text(text: &str) -> Option<String> {
    if !text.starts_with('{') {
        return None;
    }
    let envelope = dict(serde_json::from_str::<Value>(text).ok().as_ref());
    if let Some(content) = envelope.get("content").and_then(Value::as_str) {
        let page = envelope.get("type").and_then(Value::as_str) == Some("text-page");
        if page || envelope.get("encoding").and_then(Value::as_str) == Some("utf8") {
            return Some(content.to_owned());
        }
    }
    let entries = envelope.get("entries")?.as_array()?;
    let lines: Vec<_> =
        entries.iter().filter_map(|entry| entry.as_str().or_else(|| entry.get("path")?.as_str())).collect();
    Some(lines.join("\n"))
}

/// `input` relative to `directory` (else the current directory) when it is inside it. Outside, the
/// absolute path, with the home directory as `~` when `home` is given.
pub fn tool_path(input: &str, directory: Option<&str>, home: Option<&str>) -> String {
    if input.is_empty() {
        return String::new();
    }
    let cwd;
    let base = match directory {
        Some(directory) => directory,
        None => {
            cwd = std::env::current_dir().map(|dir| dir.to_string_lossy().into_owned()).unwrap_or_default();
            &cwd
        }
    };
    if !windows_path(base) && windows_path(input) {
        return input.replace('\\', "/");
    }
    let absolute = if input.starts_with('/') { input.to_owned() } else { resolve(base, input) };
    let relative = relative(base, &absolute);
    if relative.is_empty() {
        return ".".to_owned();
    }
    if relative != ".." && !relative.starts_with("../") {
        return relative;
    }
    match home {
        Some(home) if !home.is_empty() => abbreviate_home(&absolute, home),
        _ => absolute,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TodoStatus {
    Pending,
    InProgress,
    Completed,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Todo {
    pub content: String,
    pub status: TodoStatus,
}

/// The items of a `todowrite` input; an unknown status reads as pending.
pub fn parse_todos(value: &Value) -> Vec<Todo> {
    let Some(items) = value.as_array() else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let content = item.as_object()?.get("content")?.as_str().filter(|content| !content.is_empty())?;
            let status = match item.get("status").and_then(Value::as_str) {
                Some("in_progress") => TodoStatus::InProgress,
                Some("completed") => TodoStatus::Completed,
                Some("cancelled") => TodoStatus::Cancelled,
                _ => TodoStatus::Pending,
            };
            Some(Todo { content: content.to_owned(), status })
        })
        .collect()
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
    input: Map<String, Value>,
    meta: Map<String, Value>,
    status: &'a str,
    output: String,
}

impl<'a> Frame<'a> {
    fn new(part: &'a SessionMessageAssistantTool, directory: Option<&'a str>) -> Self {
        let name = canonical_tool_name(&part.name);
        let status = part.state.tag();
        if let SessionMessageAssistantToolState::Streaming(_) = part.state {
            return Frame { directory, name, input: Map::new(), meta: Map::new(), status, output: String::new() };
        }
        // Read the input as JSON so that a member this client does not know reads like a known one.
        let state = serde_json::to_value(&part.state).unwrap_or_default();
        Frame {
            directory,
            name,
            input: normalize_input(name, state.get("input")),
            meta: normalize_metadata(name, tool_display_metadata(&part.state)),
            status,
            output: tool_output_text(name, &tool_display_content(&part.state)),
        }
    }

    fn completed_output(&self) -> Option<String> {
        (self.status == "completed").then(|| self.output.clone())
    }

    /// `displayPath(p, value)`: `None` where the TS would throw on a value that is not a string.
    fn path(&self, value: Option<&Value>) -> Option<String> {
        if !truthy(value) {
            return Some(String::new());
        }
        Some(tool_path(value?.as_str()?, self.directory, None))
    }
}

fn normalize_input(name: &str, value: Option<&Value>) -> Map<String, Value> {
    let mut input = dict(value);
    let path = match input.get("path") {
        Some(Value::String(path)) => path.clone(),
        _ => text(input.get("filePath")).to_owned(),
    };
    let agent = match input.get("agent") {
        Some(Value::String(agent)) => agent.clone(),
        _ => text(input.get("subagent_type")).to_owned(),
    };
    if ["read", "write", "edit", "lsp"].contains(&name) && !path.is_empty() {
        input.insert("path".to_owned(), Value::String(path));
    }
    if name == "subagent" && !agent.is_empty() {
        input.insert("agent".to_owned(), Value::String(agent));
    }
    input
}

fn normalize_metadata(name: &str, mut metadata: Map<String, Value>) -> Map<String, Value> {
    if !["edit", "patch"].contains(&name) {
        return metadata;
    }
    if let Some(Value::Array(files)) = metadata.get("files") {
        let files = files.iter().filter_map(normalize_file).map(Value::Object).collect();
        metadata.insert("files".to_owned(), Value::Array(files));
    }
    metadata
}

/// A file of edit or patch metadata, with legacy field names mapped to `file`, `status`, and `from`.
fn normalize_file(value: &Value) -> Option<Map<String, Value>> {
    let mut file = dict(Some(value));
    let name = [text(file.get("file")), text(file.get("relativePath")), text(file.get("filePath"))]
        .into_iter()
        .find(|name| !name.is_empty())?
        .to_owned();
    let status = match (text(file.get("status")), text(file.get("type"))) {
        ("", "add") => "added",
        ("", "delete") => "deleted",
        ("", "update") => "modified",
        ("", "move") => "moved",
        ("", legacy) => legacy,
        (status, _) => status,
    }
    .to_owned();
    let from = text(file.get("filePath")).to_owned();
    file.insert("file".to_owned(), Value::String(name));
    if status == "moved" && !from.is_empty() {
        file.insert("from".to_owned(), Value::String(from));
    }
    if !status.is_empty() {
        file.insert("status".to_owned(), Value::String(status));
    }
    Some(file)
}

fn fallback_inline(frame: &Frame) -> ToolInline {
    let input = if frame.input.is_empty() {
        "Unknown".to_owned()
    } else {
        serde_json::to_string(&frame.input).unwrap_or_default()
    };
    inline("⚙", format!("{} {input}", frame.name))
}

fn run_glob(frame: &Frame) -> Option<ToolInline> {
    search(frame, "Glob", "count")
}

fn run_grep(frame: &Frame) -> Option<ToolInline> {
    search(frame, "Grep", "matches")
}

fn search(frame: &Frame, label: &str, metadata: &str) -> Option<ToolInline> {
    let root = frame.input.get("path").filter(|root| !root.is_null());
    let suffix = if truthy(root) { format!("in {}", frame.path(root)?) } else { String::new() };
    let description = match frame.meta.get(metadata) {
        None => suffix,
        Some(matches) => {
            let separator = if suffix.is_empty() { "" } else { " · " };
            let plural = if matches.as_f64() == Some(1.0) { "" } else { "es" };
            format!("{suffix}{separator}{} match{plural}", js_string(matches))
        }
    };
    let title = format!("{label} \"{}\"", or_empty(frame.input.get("pattern")));
    Some(ToolInline { description: non_empty(description), ..inline("✱", title) })
}

fn run_list(frame: &Frame) -> Option<ToolInline> {
    let dir = text(frame.input.get("path"));
    if dir.is_empty() {
        return Some(inline("→", "List".to_owned()));
    }
    Some(inline("→", format!("List {}", tool_path(dir, frame.directory, None))))
}

fn run_read(frame: &Frame) -> Option<ToolInline> {
    let file = frame.path(frame.input.get("path"))?;
    let description = non_empty(primitive_input_summary(&frame.input, &["path"]));
    Some(ToolInline { description, ..inline("→", format!("Read {file}")) })
}

fn run_write(frame: &Frame) -> Option<ToolInline> {
    let title = format!("Write {}", frame.path(frame.input.get("path"))?);
    Some(block("←", title, frame.completed_output()))
}

fn run_webfetch(frame: &Frame) -> Option<ToolInline> {
    let url = frame.input.get("url");
    if !truthy(url) {
        return Some(inline("%", "WebFetch".to_owned()));
    }
    Some(inline("%", format!("WebFetch {}", or_empty(url))))
}

fn run_edit(frame: &Frame) -> Option<ToolInline> {
    let file = frame.meta.get("files").and_then(Value::as_array).and_then(|files| files.first());
    let patch = file.and_then(|file| file.get("patch")).filter(|patch| !patch.is_null());
    let body = patch.or_else(|| frame.meta.get("diff")).and_then(Value::as_str).map(str::to_owned);
    let title = format!("Edit {}", frame.path(frame.input.get("path"))?);
    Some(block("←", title, body))
}

fn run_web_search(frame: &Frame) -> Option<ToolInline> {
    let title = web_search_provider_label(frame.meta.get("provider").unwrap_or(&Value::Null));
    let query = frame.input.get("query");
    if !truthy(query) {
        return Some(inline("◈", title));
    }
    Some(inline("◈", format!("{title} \"{}\"", or_empty(query))))
}

fn run_task(frame: &Frame) -> Option<ToolInline> {
    let agent = frame.input.get("agent");
    let kind = titlecase(if truthy(agent) { agent?.as_str()? } else { "unknown" });
    let icon = match frame.status {
        "error" => "✗",
        "running" => "•",
        _ => "✓",
    };
    let description = frame.input.get("description");
    if !truthy(description) {
        return Some(inline(icon, format!("{kind} Subagent")));
    }
    Some(ToolInline { description: Some(format!("{kind} Agent")), ..inline(icon, or_empty(description)) })
}

fn run_skill(frame: &Frame) -> Option<ToolInline> {
    let name = [frame.meta.get("name"), frame.input.get("id")].into_iter().flatten().find(|name| !name.is_null());
    Some(inline("→", format!("Skill \"{}\"", or_empty(name))))
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
    let todos = parse_todos(frame.input.get("todos").unwrap_or(&Value::Null));
    let body = todos
        .iter()
        .map(|todo| format!("{} {}", todo_marker(todo.status, false), todo.content))
        .collect::<Vec<_>>()
        .join("\n");
    Some(block("#", "Todos".to_owned(), Some(body)))
}

fn run_question(frame: &Frame) -> Option<ToolInline> {
    let total = list_len(frame.input.get("questions"));
    Some(inline("→", format!("Asked {total} question{}", plural(total))))
}

fn run_invalid(frame: &Frame) -> Option<ToolInline> {
    Some(block("✗", "Invalid Tool".to_owned(), frame.completed_output()))
}

fn run_batch(frame: &Frame) -> Option<ToolInline> {
    let calls = list_len(frame.input.get("tool_calls"));
    let title = if calls > 0 { format!("Batch {calls} tool{}", plural(calls)) } else { "Batch".to_owned() };
    Some(block("#", title, frame.completed_output()))
}

fn run_lsp(frame: &Frame) -> Option<ToolInline> {
    let operation = frame.input.get("operation");
    let operation = if truthy(operation) { or_empty(operation) } else { "request".to_owned() };
    let file = frame.path(frame.input.get("path"))?;
    if file.is_empty() {
        return Some(inline("→", format!("LSP {operation}")));
    }
    let number = |key| frame.input.get(key).filter(|value| value.is_number());
    let position = match (number("line"), number("character")) {
        (Some(line), Some(character)) => format!(":{}:{}", js_string(line), js_string(character)),
        _ => String::new(),
    };
    Some(inline("→", format!("LSP {operation} {file}{position}")))
}

fn run_shell(frame: &Frame) -> Option<ToolInline> {
    let command = frame.input.get("command");
    let title = if truthy(command) { or_empty(command) } else { String::new() };
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

fn dict(value: Option<&Value>) -> Map<String, Value> {
    value.and_then(Value::as_object).cloned().unwrap_or_default()
}

fn text(value: Option<&Value>) -> &str {
    value.and_then(Value::as_str).unwrap_or_default()
}

fn list_len(value: Option<&Value>) -> usize {
    value.and_then(Value::as_array).map_or(0, Vec::len)
}

/// JavaScript truthiness.
fn truthy(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(value)) => *value,
        Some(Value::Number(number)) => number.as_f64().is_some_and(|number| number != 0.0),
        Some(Value::String(text)) => !text.is_empty(),
        Some(Value::Array(_) | Value::Object(_)) => true,
    }
}

/// `${value ?? ""}` in a template literal.
fn or_empty(value: Option<&Value>) -> String {
    value.filter(|value| !value.is_null()).map(js_string).unwrap_or_default()
}

/// `Locale.titlecase`: uppercases every ASCII word character that starts a word.
fn titlecase(text: &str) -> String {
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

fn windows_path(input: &str) -> bool {
    let bytes = input.as_bytes();
    let drive = bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':';
    (drive && matches!(bytes[2], b'\\' | b'/')) || input.starts_with("\\\\")
}

/// `path.posix.resolve(base, input)` for an absolute `base`.
fn resolve(base: &str, input: &str) -> String {
    let joined = if input.starts_with('/') { input.to_owned() } else { format!("{base}/{input}") };
    let segments = joined.split('/').fold(Vec::new(), |mut segments, segment| {
        match segment {
            "" | "." => {}
            ".." => {
                segments.pop();
            }
            _ => segments.push(segment),
        }
        segments
    });
    format!("/{}", segments.join("/"))
}

/// `path.posix.relative(from, to)`.
fn relative(from: &str, to: &str) -> String {
    let from = resolve(from, "");
    let to = resolve(to, "");
    let from: Vec<_> = from.split('/').filter(|segment| !segment.is_empty()).collect();
    let to: Vec<_> = to.split('/').filter(|segment| !segment.is_empty()).collect();
    let common = from.iter().zip(&to).take_while(|(from, to)| from == to).count();
    let up = std::iter::repeat_n("..", from.len() - common);
    up.chain(to[common..].iter().copied()).collect::<Vec<_>>().join("/")
}

fn abbreviate_home(input: &str, home: &str) -> String {
    let relative = relative(home, input);
    if relative.is_empty() {
        return "~".to_owned();
    }
    if relative == ".." || relative.starts_with("../") {
        return input.to_owned();
    }
    format!("~/{relative}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_paths_stay_relative_only_inside_the_directory() {
        let path = |input| tool_path(input, Some("/work/project"), None);
        assert_eq!(path("..cache/result.txt"), "..cache/result.txt");
        assert_eq!(path("../shared/result.txt"), "/work/shared/result.txt");
        assert_eq!(path("/work/project"), ".");
        assert_eq!(path("/work/project/src/./a.ts"), "src/a.ts");
        assert_eq!(path("C:\\work\\a.ts"), "C:/work/a.ts");
        assert_eq!(tool_path("/home/me/x", Some("/work"), Some("/home/me")), "~/x");
    }

    #[test]
    fn titlecase_matches_javascript_word_boundaries() {
        assert_eq!(titlecase("general"), "General");
        assert_eq!(titlecase("code-review agent"), "Code-Review Agent");
        assert_eq!(titlecase("my_agent"), "My_agent");
    }
}
