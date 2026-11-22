//! A tool call's kind, by its name, and borrowed views of its input, which each front end reads its own way.

use indexmap::IndexMap;
use serde_json::{Map, Value};

use crate::SessionMessageAssistantToolState;
use crate::js::{js_string, truthy};

macro_rules! tool_kinds {
    ($($kind:ident: $($name:literal)|+,)*) => {
        /// What a tool is, by its name. Permission requests name their action the same way.
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
        pub enum ToolKind {
            $($kind,)*
            #[default]
            Other,
        }

        impl ToolKind {
            pub fn of(name: &str) -> Self {
                match canonical_tool_name(name) {
                    $($($name)|+ => Self::$kind,)*
                    _ => Self::Other,
                }
            }
        }
    };
}

// `Context` is the Context7 tools, which ACP shows as searches.
tool_kinds! {
    Invalid: "invalid", Shell: "shell", Read: "read", Write: "write", Edit: "edit", Patch: "patch", Batch: "batch",
    Glob: "glob", Grep: "grep", List: "list", Lsp: "lsp", Subagent: "subagent", Todo: "todowrite",
    Question: "question", WebFetch: "webfetch", WebSearch: "websearch", Skill: "skill", Execute: "execute",
    Context: "context" | "context7_resolve_library_id" | "context7_get_library_docs",
    ExternalDirectory: "external_directory", DoomLoop: "doom_loop",
}

impl ToolKind {
    /// [`Self::of`] the name with its ASCII letters lowercased.
    pub fn of_ignore_ascii_case(name: &str) -> Self {
        let mut lower = [0; 32];
        let Some(lower) = lower.get_mut(..name.len()) else { return Self::Other };
        lower.copy_from_slice(name.as_bytes());
        lower.make_ascii_lowercase();
        std::str::from_utf8(lower).map_or(Self::Other, Self::of)
    }
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

/// A tool call's input, borrowed from the part or from a JSON value. It is empty while the input streams as text.
#[derive(Debug, Clone, Copy, Default)]
pub struct ToolInput<'a>(Fields<'a>);

#[derive(Debug, Clone, Copy, Default)]
enum Fields<'a> {
    #[default]
    Empty,
    Typed(&'a IndexMap<String, Value>),
    Json(&'a Map<String, Value>),
}

impl<'a> ToolInput<'a> {
    pub fn of(state: &'a SessionMessageAssistantToolState) -> Self {
        Self(match state {
            SessionMessageAssistantToolState::Streaming(_) => Fields::Empty,
            SessionMessageAssistantToolState::Running(state) => Fields::Typed(&state.input),
            SessionMessageAssistantToolState::Completed(state) => Fields::Typed(&state.input),
            SessionMessageAssistantToolState::Error(state) => Fields::Typed(&state.input),
            // A state this client does not know reads like a known one.
            SessionMessageAssistantToolState::Unknown(state) => {
                return state.get("input").map(Self::json).unwrap_or_default();
            }
        })
    }

    pub fn map(map: &'a IndexMap<String, Value>) -> Self {
        Self(Fields::Typed(map))
    }

    /// The input of a JSON object; any other value is an empty input.
    pub fn json(value: &'a Value) -> Self {
        Self(value.as_object().map_or(Fields::Empty, Fields::Json))
    }

    pub fn get(self, key: &str) -> Field<'a> {
        Field(match self.0 {
            Fields::Empty => None,
            Fields::Typed(map) => map.get(key),
            Fields::Json(map) => map.get(key),
        })
    }

    /// The entries in wire order.
    pub fn iter(self) -> impl Iterator<Item = (&'a String, &'a Value)> {
        let (typed, json) = match self.0 {
            Fields::Empty => (None, None),
            Fields::Typed(map) => (Some(map), None),
            Fields::Json(map) => (None, Some(map)),
        };
        typed.into_iter().flatten().chain(json.into_iter().flatten())
    }

    pub fn path(self) -> Field<'a> {
        self.get("path")
    }

    /// `normalizeInput`'s path: `path` when it is a string, else a non-empty `filePath`, which V1 sessions keep.
    pub fn legacy_path(self) -> Field<'a> {
        self.path().or_legacy(self.get("filePath"))
    }

    /// The permission prompt's path: the first non-empty `path`, `filePath` or `filepath`.
    pub fn any_path(self) -> Option<&'a str> {
        ["path", "filePath", "filepath"].into_iter().find_map(|key| self.get(key).non_empty())
    }

    /// ACP's path: the string `path`, else the string `filePath`.
    pub fn file_path(self) -> Option<&'a str> {
        self.path().str().or(self.get("filePath").str())
    }
}

/// One field of a tool's input. The front ends differ in what they accept, so each picks its own reading.
#[derive(Debug, Clone, Copy, Default)]
pub struct Field<'a>(Option<&'a Value>);

impl<'a> Field<'a> {
    pub fn value(self) -> Option<&'a Value> {
        self.0
    }

    pub fn str(self) -> Option<&'a str> {
        self.0.and_then(Value::as_str)
    }

    /// The field when it is a string, else empty.
    pub fn text(self) -> &'a str {
        self.str().unwrap_or_default()
    }

    pub fn non_empty(self) -> Option<&'a str> {
        self.str().filter(|text| !text.is_empty())
    }

    /// JavaScript truthiness.
    pub fn truthy(self) -> bool {
        self.0.is_some_and(truthy)
    }

    /// `${value ?? ""}` in a template literal.
    pub fn js(self) -> String {
        self.0.filter(|value| !value.is_null()).map(js_string).unwrap_or_default()
    }

    pub fn array(self) -> &'a [Value] {
        self.0.and_then(Value::as_array).map_or(&[], Vec::as_slice)
    }

    /// `normalizeInput`: this field when it is a string, else a non-empty `legacy` one, else this field.
    pub fn or_legacy(self, legacy: Self) -> Self {
        if self.str().is_some() || legacy.non_empty().is_none() { self } else { legacy }
    }
}

macro_rules! input_views {
    ($($view:ident { $($field:ident: $key:literal),* })*) => {$(
        #[derive(Debug, Clone, Copy)]
        pub struct $view<'a>(pub ToolInput<'a>);

        impl<'a> $view<'a> {
            $(pub fn $field(self) -> Field<'a> {
                self.0.get($key)
            })*
        }
    )*};
}

// The fields of each tool's input. A file's path is on `ToolInput`, which every tool that names one shares.
input_views! {
    ShellInput { command: "command", workdir: "workdir", cmd: "cmd", cwd: "cwd" }
    ReadInput { offset: "offset", limit: "limit" }
    WriteInput { content: "content" }
    EditInput { patch_text: "patchText" }
    PatchInput { patch_text: "patchText" }
    SearchInput { pattern: "pattern" }
    LspInput { operation: "operation", line: "line", character: "character" }
    SubagentInput { agent: "agent", subagent_type: "subagent_type", description: "description", session_id: "sessionID", model: "model" }
    TodoInput { todos: "todos" }
    QuestionInput { questions: "questions" }
    WebFetchInput { url: "url" }
    WebSearchInput { query: "query" }
    SkillInput { id: "id" }
    BatchInput { tool_calls: "tool_calls" }
    ExternalDirectoryInput { filepath: "filepath", description: "description", command: "command", parent_dir: "parentDir" }
}

impl<'a> SubagentInput<'a> {
    /// `normalizeInput`'s agent: `agent` when it is a string, else a non-empty `subagent_type`.
    pub fn legacy_agent(self) -> Field<'a> {
        self.agent().or_legacy(self.subagent_type())
    }
}

impl TodoInput<'_> {
    pub fn items(self) -> Vec<Todo> {
        parse_todos(self.todos().value().unwrap_or(&Value::Null))
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
    let Some(items) = value.as_array() else { return Vec::new() };
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

/// Read's model content is a JSON page envelope; this unwraps the human-facing text.
pub fn read_display_text(text: &str) -> Option<String> {
    if !text.starts_with('{') {
        return None;
    }
    let envelope = serde_json::from_str::<Map<String, Value>>(text).unwrap_or_default();
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
