//! Tool rendering in the scrollback (`tool.ts`, the tool half of `stream-v2.subagent.ts` and
//! `stream-v2.image.ts`).
//!
//! A tool part becomes commits ([`commit`]): a start line, output that streams as progress, and a final line or a
//! structured snapshot (code, a diff, a task card, todos, questions). [`entry_body`] decides what each commit
//! draws, by the per-tool rules of `TOOL_RULES`. The one-line summaries `run` prints are [`tool_inline_info`];
//! the frame here adds what the scrollback needs on top of the same helpers.
//!
//! [`tool_inline_info`]: opencode_ui::tool_info::tool_inline_info

use opencode_api::generated::{SessionMessageAssistantTool, SessionMessageAssistantToolState as State, ToolContent};
use opencode_ui::prompt_input::paste::strip_ansi;
use opencode_ui::tool_info::{
    Todo, TodoStatus, canonical_tool_name, normalize_input, normalize_metadata, parse_todos, primitive_input_summary,
    todo_marker, tool_display_content, tool_display_metadata, tool_output_text, tool_path, web_search_provider_label,
};
use opentui::prelude::*;
use opentui::widget::{Code, DiffColors, DiffView, LineNumbers};
use serde_json::{Map, Value};

use crate::scrollback::{Body, BodyOptions, Commit, EntryKind, Phase, Source, ToolState};
use crate::theme::RunTheme;

/// A structured tool body (`ToolSnapshot`).
#[derive(Clone, Debug, PartialEq)]
pub enum Snapshot {
    Code { title: String, content: String, file: String },
    Diff { items: Vec<DiffItem> },
    Task { title: String, rows: Vec<String>, tail: String },
    Todo { items: Vec<Todo> },
    Question { items: Vec<(String, String)>, tail: String },
}

#[derive(Clone, Debug, PartialEq)]
pub struct DiffItem {
    pub title: String,
    pub diff: String,
    pub file: String,
    pub deletions: Option<u64>,
}

/// `ToolFrame`: a tool part normalized for display.
#[derive(Clone, Debug, Default)]
struct Frame {
    directory: Option<String>,
    raw: String,
    name: String,
    input: Map<String, Value>,
    meta: Map<String, Value>,
    status: String,
    error: String,
    output: String,
    start: Option<f64>,
    end: Option<f64>,
}

/// `frame`.
fn frame(part: &SessionMessageAssistantTool, directory: Option<&str>) -> Frame {
    let name = canonical_tool_name(&part.name).to_owned();
    let directory = directory.map(str::to_owned);
    if let State::Streaming(state) = &part.state {
        return Frame {
            directory,
            raw: state.input.clone(),
            name,
            status: "streaming".into(),
            start: Some(part.time.created),
            ..Frame::default()
        };
    }
    let output = tool_output_text(&name, &tool_display_content(&part.state));
    let state = serde_json::to_value(&part.state).unwrap_or_default();
    Frame {
        directory,
        raw: output.clone(),
        input: normalize_input(&name, state.get("input")),
        meta: normalize_metadata(&name, tool_display_metadata(&part.state)),
        status: part.state.tag().to_owned(),
        error: match &part.state {
            State::Error(state) => state.error.message.clone(),
            _ => String::new(),
        },
        output,
        start: Some(part.time.ran.unwrap_or(part.time.created)),
        end: part.time.completed,
        name,
    }
}

/// `toolFrame`: a commit's frame, with the commit's own state and text taking precedence.
fn tool_frame(commit: &Commit, raw: &str) -> Frame {
    let current = commit.part.as_ref().map(|part| frame(part, commit.directory.as_deref())).unwrap_or_default();
    let name = commit.tool.as_deref().filter(|name| !name.is_empty()).unwrap_or(match current.name.as_str() {
        "" => "tool",
        name => name,
    });
    let status = match commit.tool_state {
        Some(state) => state_name(state).to_owned(),
        None => current.status.clone(),
    };
    let error = commit.tool_error.clone().unwrap_or(current.error.clone()).trim().to_owned();
    Frame {
        directory: commit.directory.clone(),
        raw: raw.to_owned(),
        name: canonical_tool_name(name).to_owned(),
        output: if commit.part.is_some() { current.output.clone() } else { raw.to_owned() },
        status,
        error,
        ..current
    }
}

fn state_name(state: ToolState) -> &'static str {
    match state {
        ToolState::Running => "running",
        ToolState::Completed => "completed",
        ToolState::Error => "error",
    }
}

impl Frame {
    fn input(&self, key: &str) -> &str {
        self.input.get(key).and_then(Value::as_str).unwrap_or_default()
    }

    fn path(&self, input: &str, home: bool) -> String {
        let home = home.then(|| std::env::var("HOME").unwrap_or_default());
        tool_path(input, self.directory.as_deref(), home.as_deref())
    }

    /// `span`: how long the tool ran.
    fn span(&self) -> String {
        match (self.start, self.end) {
            (Some(start), Some(end)) if end > start => crate::shell::duration((end - start) as u64),
            _ => String::new(),
        }
    }

    fn files(&self) -> Vec<&Map<String, Value>> {
        self.meta.get("files").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_object).collect()
    }
}

/// `ToolView`: whether progress and final commits draw, and whether a completed final is a snapshot.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ToolView {
    output: bool,
    final_: bool,
    snap: bool,
}

/// The tools of `TOOL_RULES`.
const KNOWN: [&str; 17] = [
    "invalid",
    "shell",
    "write",
    "edit",
    "patch",
    "batch",
    "subagent",
    "todowrite",
    "question",
    "read",
    "glob",
    "grep",
    "list",
    "lsp",
    "webfetch",
    "websearch",
    "skill",
];

/// `toolView`.
fn tool_view(name: &str) -> ToolView {
    let view = |output, final_, snap| ToolView { output, final_, snap };
    match canonical_tool_name(name) {
        "invalid" | "shell" | "batch" => view(true, false, false),
        "write" | "edit" | "patch" | "subagent" | "todowrite" | "question" => view(false, true, true),
        "read" | "glob" | "grep" | "list" | "lsp" | "webfetch" | "websearch" | "skill" => view(false, false, false),
        _ => view(true, true, false),
    }
}

/// `toolScroll`: the text of one phase, by the tool's rule or the fallback.
fn scroll(phase: Phase, frame: &Frame) -> String {
    let name = frame.name.as_str();
    let rule = match (name, phase) {
        ("invalid" | "write" | "edit" | "patch" | "batch" | "subagent" | "todowrite" | "question", Phase::Start) => {
            Some(String::new())
        }
        ("shell", Phase::Start) => Some(shell_start(frame)),
        ("shell", Phase::Progress) => Some(shell_progress(frame)),
        ("shell", Phase::Final) => Some(shell_final(frame)),
        ("patch", Phase::Final) => Some(patch_final(frame)),
        ("subagent", Phase::Final) => Some(task_final(frame)),
        ("question", Phase::Final) => Some(question_final(frame)),
        ("read", Phase::Start) => {
            let extra = primitive_input_summary(&frame.input, &["path"]);
            let tail = if extra.is_empty() { String::new() } else { format!(" {extra}") };
            Some(format!("→ Read {}{tail}", frame.path(frame.input("path"), false)).trim().to_owned())
        }
        ("glob" | "grep", Phase::Start) => {
            let label = if name == "glob" { "Glob" } else { "Grep" };
            let pattern = frame.input("pattern");
            let head = if pattern.is_empty() { format!("✱ {label}") } else { format!("✱ {label} \"{pattern}\"") };
            let dir = frame.input("path");
            Some(if dir.is_empty() { head } else { format!("{head} in {}", frame.path(dir, false)) })
        }
        ("glob", Phase::Final) => Some(if tool_error(frame).is_empty() { fail(frame) } else { tool_error(frame) }),
        ("list", Phase::Start) => {
            let dir = frame.input("path");
            Some(if dir.is_empty() { "→ List".into() } else { format!("→ List {}", frame.path(dir, false)) })
        }
        ("lsp", Phase::Start) => Some(format!("→ {}", lsp_title(frame))),
        ("webfetch", Phase::Start) => {
            let url = frame.input("url");
            Some(if url.is_empty() { "% WebFetch".into() } else { format!("% WebFetch {url}") })
        }
        ("websearch", Phase::Start) => {
            let title = web_search_provider_label(frame.meta.get("provider").unwrap_or(&Value::Null));
            let query = frame.input("query");
            Some(if query.is_empty() { format!("◈ {title}") } else { format!("◈ {title} \"{query}\"") })
        }
        ("skill", Phase::Start) => {
            let name = [frame.meta.get("name"), frame.input.get("id")]
                .into_iter()
                .flatten()
                .find(|name| !name.is_null())
                .map(opencode_api::js::js_string)
                .unwrap_or_default();
            Some(format!("→ Skill \"{name}\""))
        }
        _ => None,
    };
    rule.unwrap_or_else(|| match phase {
        Phase::Start => {
            let extra = primitive_input_summary(&frame.input, &[]);
            if extra.is_empty() { format!("⚙ {name}") } else { format!("⚙ {name} {extra}") }
        }
        Phase::Progress => frame.raw.clone(),
        Phase::Final => fallback_final(frame),
    })
}

fn fail(frame: &Frame) -> String {
    let error = tool_error(frame);
    if error.is_empty() {
        return format!("✖ {} failed", frame.name);
    }
    format!("✖ {} failed: {error}", frame.name)
}

fn tool_error(frame: &Frame) -> String {
    if !frame.error.is_empty() {
        return frame.error.clone();
    }
    frame.raw.trim().to_owned()
}

fn fallback_final(frame: &Frame) -> String {
    if frame.status == "error" {
        return fail(frame);
    }
    if !frame.status.is_empty() && frame.status != "completed" {
        return frame.raw.trim().to_owned();
    }
    match frame.span() {
        time if time.is_empty() => format!("{} completed", frame.name),
        time => format!("{} completed · {time}", frame.name),
    }
}

fn shell_start(frame: &Frame) -> String {
    let command = frame.input("command");
    let workdir = frame.input("workdir");
    let formatted = if !workdir.is_empty() && workdir != "." { frame.path(workdir, true) } else { String::new() };
    let dir = if formatted == "." { "" } else { formatted.as_str() };
    match (command.is_empty(), dir.is_empty()) {
        (false, true) => format!("$ {command}"),
        (true, false) => format!("{dir}$"),
        (true, true) => String::new(),
        (false, false) => format!("{dir}$ {command}"),
    }
}

fn shell_progress(frame: &Frame) -> String {
    let out = strip_ansi(&frame.raw);
    let command = frame.input("command").trim();
    let format = |text: &str| {
        let body = text.trim_start_matches('\n').trim_end_matches('\n');
        if body.is_empty() { String::new() } else { format!("\n{body}") }
    };
    if command.is_empty() {
        return out.trim_end_matches('\n').to_owned();
    }
    let raw_dir = frame.input("workdir").trim();
    let dir = if raw_dir.is_empty() { String::new() } else { frame.path(raw_dir, true) };
    let lines: Vec<&str> = out.split('\n').collect();
    let first = lines.first().copied().unwrap_or_default().trim();
    let second = lines.get(1).copied().unwrap_or_default().trim();
    let rest = |skip: usize| lines.get(skip..).unwrap_or_default().join("\n");
    if !dir.is_empty() && (first == dir || first == raw_dir) && second == command {
        return format(&rest(2));
    }
    if first == command || first == format!("$ {command}") {
        return format(&rest(1));
    }
    if !dir.is_empty() && (first == format!("{dir} {command}") || first == format!("{raw_dir} {command}")) {
        return format(&rest(1));
    }
    format(&out)
}

fn shell_final(frame: &Frame) -> String {
    if frame.status == "error" {
        return fail(frame);
    }
    let time = frame.span();
    let suffix = if time.is_empty() { String::new() } else { format!(" · {time}") };
    match frame.meta.get("exit").filter(|exit| !exit.is_null()) {
        None => format!("shell completed{suffix}"),
        Some(code) => format!("shell completed (exit {}){suffix}", opencode_api::js::js_string(code)),
    }
}

fn file_text<'a>(file: &'a Map<String, Value>, key: &str) -> &'a str {
    file.get(key).and_then(Value::as_str).unwrap_or_default()
}

fn patch_line(file: &Map<String, Value>, frame: &Frame) -> String {
    let path = |key| tool_path(file_text(file, key), frame.directory.as_deref(), None);
    match file_text(file, "status") {
        "added" => format!("+ Created {}", path("file")),
        "deleted" => format!("- Deleted {}", path("file")),
        "moved" => format!("→ Moved {} → {}", path("from"), path("file")),
        _ => format!("~ Patched {}", path("file")),
    }
}

fn patch_title(file: &Map<String, Value>, frame: &Frame) -> String {
    let path = |key| tool_path(file_text(file, key), frame.directory.as_deref(), None);
    match file_text(file, "status") {
        "added" => format!("# Created {}", path("file")),
        "deleted" => format!("# Deleted {}", path("file")),
        "moved" => format!("# Moved {} -> {}", path("from"), path("file")),
        _ => format!("# Patched {}", path("file")),
    }
}

fn patch_final(frame: &Frame) -> String {
    if frame.status == "error" {
        return fail(frame);
    }
    let files = frame.files();
    if files.is_empty() {
        return match frame.span() {
            time if time.is_empty() => "patch".into(),
            time => format!("patch · {time}"),
        };
    }
    let status = |file: &Map<String, Value>| file_text(file, "status").to_owned();
    let show_modified = !files.iter().any(|file| !status(file).is_empty() && status(file) != "modified");
    let shown: Vec<_> = files.iter().filter(|file| show_modified || status(file) != "modified").collect();
    let mut rows: Vec<String> = shown.iter().take(6).map(|file| patch_line(file, frame)).collect();
    if shown.len() > 6 {
        rows.push(format!("… and {} more", shown.len() - 6));
    }
    if rows.is_empty() {
        return patch_line(files[0], frame);
    }
    rows.join("\n")
}

fn agent_kind(frame: &Frame, fallback: &str) -> String {
    opencode_ui::tool_info::titlecase(match frame.input("agent") {
        "" => fallback,
        agent => agent,
    })
}

fn task_final(frame: &Frame) -> String {
    if frame.status == "error" {
        return fail(frame);
    }
    let kind = agent_kind(frame, "general");
    match frame.input("description") {
        "" => format!("# {kind} Subagent"),
        row => format!("# {kind} Subagent\n{row}"),
    }
}

fn questions(frame: &Frame) -> Vec<String> {
    let list = frame.input.get("questions").and_then(Value::as_array).cloned().unwrap_or_default();
    list.iter().map(|item| item.get("question").and_then(Value::as_str).unwrap_or_default().to_owned()).collect()
}

fn answers(frame: &Frame, index: usize) -> Vec<String> {
    let answers = frame.meta.get("answers").and_then(Value::as_array);
    let answer = answers.and_then(|answers| answers.get(index)).and_then(Value::as_array);
    answer.into_iter().flatten().filter_map(Value::as_str).map(str::to_owned).collect()
}

fn question_final(frame: &Frame) -> String {
    let questions = questions(frame);
    if questions.is_empty() {
        return match frame.span() {
            time if time.is_empty() => "0 questions".into(),
            time => format!("0 questions · {time}"),
        };
    }
    let mut rows = Vec::new();
    for (index, question) in questions.iter().take(4).enumerate() {
        let reply = answers(frame, index);
        rows.push(match question.as_str() {
            "" => format!("? Question {}", index + 1),
            question => format!("? {question}"),
        });
        rows.push(format!("  {}", if reply.is_empty() { "(no answer)".into() } else { reply.join(", ") }));
    }
    if questions.len() > 4 {
        rows.push(format!("… and {} more", questions.len() - 4));
    }
    rows.join("\n")
}

fn lsp_title(frame: &Frame) -> String {
    let operation = match frame.input("operation") {
        "" => "request",
        operation => operation,
    };
    let file = frame.input("path");
    if file.is_empty() {
        return format!("LSP {operation}");
    }
    let number = |key| frame.input.get(key).filter(|value| value.is_number()).map(opencode_api::js::js_string);
    let position = match (number("line"), number("character")) {
        (Some(line), Some(character)) => format!(":{line}:{character}"),
        _ => String::new(),
    };
    format!("LSP {operation} {}{position}", frame.path(file, false))
}

/// `toolSnapshot`.
fn snapshot(frame: &Frame) -> Option<Snapshot> {
    match frame.name.as_str() {
        "write" => {
            let (file, content) = (frame.input("path"), frame.input("content"));
            if file.is_empty() && content.is_empty() {
                return None;
            }
            Some(Snapshot::Code {
                title: format!("# Wrote {}", frame.path(file, false)),
                content: content.to_owned(),
                file: file.to_owned(),
            })
        }
        "edit" => {
            let item = frame.files().first().copied();
            let file = item.map(|item| file_text(item, "file")).filter(|file| !file.is_empty());
            let file = file.unwrap_or(frame.input("path"));
            let diff = item.map(|item| file_text(item, "patch")).filter(|diff| !diff.is_empty());
            let diff = diff.unwrap_or(frame.meta.get("diff").and_then(Value::as_str).unwrap_or_default());
            if file.is_empty() || diff.trim().is_empty() {
                return None;
            }
            let title = format!("# Edited {}", frame.path(file, false));
            Some(Snapshot::Diff {
                items: vec![DiffItem { title, diff: diff.to_owned(), file: file.to_owned(), deletions: None }],
            })
        }
        "patch" => {
            let files = frame.files();
            let items: Vec<DiffItem> = files
                .iter()
                .filter(|file| !file_text(file, "patch").trim().is_empty())
                .map(|file| DiffItem {
                    title: patch_title(file, frame),
                    diff: file_text(file, "patch").to_owned(),
                    file: file_text(file, "file").to_owned(),
                    deletions: Some(file.get("deletions").and_then(Value::as_u64).unwrap_or(0)),
                })
                .collect();
            (!files.is_empty() && items.len() == files.len()).then_some(Snapshot::Diff { items })
        }
        "subagent" => {
            let rows = Some(frame.input("description")).filter(|row| !row.is_empty()).map(str::to_owned);
            Some(Snapshot::Task {
                title: format!("# {} Subagent", agent_kind(frame, "general")),
                rows: rows.into_iter().collect(),
                tail: String::new(),
            })
        }
        "todowrite" => Some(Snapshot::Todo { items: parse_todos(frame.input.get("todos").unwrap_or(&Value::Null)) }),
        "question" => {
            let items = questions(frame)
                .into_iter()
                .enumerate()
                .map(|(index, question)| {
                    let answer = answers(frame, index);
                    let question = if question.is_empty() { format!("Question {}", index + 1) } else { question };
                    (question, if answer.is_empty() { "(no answer)".into() } else { answer.join(", ") })
                })
                .collect();
            Some(Snapshot::Question { items, tail: String::new() })
        }
        _ => None,
    }
}

/// `taskResult`: the subagent's answer, inside `<task_result>` when it has one.
fn task_result(output: &str) -> Option<String> {
    if output.trim().is_empty() {
        return None;
    }
    if let Some((_, rest)) = output.split_once("<task_result>")
        && let Some((inner, _)) = rest.split_once("</task_result>")
    {
        return Some(inner.trim().to_owned()).filter(|text| !text.is_empty());
    }
    let next: Vec<&str> = output.split('\n').filter(|line| !line.starts_with("task_id:")).collect();
    Some(next.join("\n").trim().to_owned()).filter(|text| !text.is_empty())
}

const STRUCTURED_FALLBACK_LENGTH: usize = 4_096;

/// `structuredFallback`: the metadata of an unknown tool without output, as JSON.
fn structured_fallback(value: &Map<String, Value>) -> Option<Body> {
    if value.is_empty() {
        return None;
    }
    let content = serde_json::to_string_pretty(value).ok()?;
    let suffix = "\n… [truncated]";
    let content = if content.chars().count() <= STRUCTURED_FALLBACK_LENGTH {
        content
    } else {
        let head: String = content.chars().take(STRUCTURED_FALLBACK_LENGTH - suffix.chars().count()).collect();
        format!("{head}{suffix}")
    };
    Some(Body::Code { content, filetype: Some("json".into()) })
}

fn text_body(content: String) -> Option<Body> {
    (!content.is_empty()).then_some(Body::Text(content))
}

/// `toolEntryBody`: what a tool commit draws.
pub fn entry_body(commit: &Commit, raw: &str, options: BodyOptions) -> Option<Body> {
    if let Some(command) = &commit.shell {
        return match commit.phase {
            Phase::Start => text_body(format!("$ {command}")),
            Phase::Progress => {
                let body = strip_ansi(raw);
                let body = body.trim_start_matches('\n').trim_end_matches('\n');
                match (body.is_empty(), command.is_empty()) {
                    (true, _) => None,
                    (false, true) => text_body(body.to_owned()),
                    (false, false) => text_body(format!("\n{body}")),
                }
            }
            Phase::Final if commit.tool_state == Some(ToolState::Error) => {
                text_body(scroll(Phase::Final, &tool_frame(commit, raw)))
            }
            Phase::Final => None,
        };
    }
    let frame = tool_frame(commit, raw);
    let view = tool_view(&frame.name);
    if frame.name == "shell" && commit.phase == Phase::Progress && !options.shell_output {
        return None;
    }
    if frame.name == "subagent" {
        if commit.phase == Phase::Start {
            return None;
        }
        if commit.phase == Phase::Final
            && frame.status == "completed"
            && let Some(result) = task_result(&frame.output)
        {
            return Some(Body::Markdown(result));
        }
    }
    if commit.phase == Phase::Progress && !view.output {
        return None;
    }
    if commit.phase == Phase::Final {
        if frame.status == "error" {
            return text_body(scroll(Phase::Final, &frame));
        }
        if !view.final_ {
            return None;
        }
        if !frame.status.is_empty() && frame.status != "completed" {
            return text_body(frame.raw.trim().to_owned());
        }
        if structured_final(commit) {
            return snapshot(&frame).map(Body::Structured).or_else(|| text_body(scroll(Phase::Final, &frame)));
        }
        if !KNOWN.contains(&frame.name.as_str()) && frame.output.trim().is_empty() {
            return structured_fallback(&frame.meta).or_else(|| text_body(scroll(Phase::Final, &frame)));
        }
    }
    text_body(scroll(commit.phase, &frame))
}

/// `monoBody`: a structured or code body flattened to text, for mono. Todo cards keep their ASCII markers.
pub fn mono_body(body: Body) -> Body {
    let Body::Structured(snapshot) = body else {
        return match body {
            Body::Code { content, .. } => Body::Text(content),
            body => body,
        };
    };
    let text = match snapshot {
        Snapshot::Todo { .. } => return Body::Structured(snapshot),
        Snapshot::Code { title, content, .. } => format!("{title}\n{content}"),
        Snapshot::Diff { items } => items
            .iter()
            .map(|item| match item.diff.trim() {
                "" => format!("{}\n-{} lines", item.title, item.deletions.unwrap_or(0)),
                diff => format!("{}\n{diff}", item.title),
            })
            .collect::<Vec<_>>()
            .join("\n\n"),
        Snapshot::Task { title, rows, tail } => std::iter::once(title)
            .chain(rows)
            .chain([tail])
            .filter(|row| !row.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        Snapshot::Question { items, tail } => std::iter::once("# Questions".to_owned())
            .chain(items.into_iter().flat_map(|(question, answer)| [question, answer]))
            .chain([tail])
            .filter(|row| !row.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
    };
    if text.is_empty() { Body::None } else { Body::Text(text) }
}

/// `toolStructuredFinal`: whether a final tool commit draws a structured body, which groups on its own.
pub fn structured_final(commit: &Commit) -> bool {
    let state = commit.tool_state.map(state_name).or_else(|| commit.part.as_ref().map(|part| part.state.tag()));
    let name = commit.tool.as_deref().or(commit.part.as_ref().map(|part| part.name.as_str()));
    commit.kind == EntryKind::Tool
        && commit.phase == Phase::Final
        && state == Some("completed")
        && name.is_some_and(|name| tool_view(name).snap)
}

/// `toolCommit`: one commit of a tool part.
pub fn commit(
    part: &SessionMessageAssistantTool,
    message_id: &str,
    phase: Phase,
    value: Option<&str>,
    directory: Option<&str>,
    version: u32,
) -> Commit {
    let name = canonical_tool_name(&part.name);
    let partial = matches!(part.state, State::Error(_)) && phase == Phase::Progress && value.is_some();
    let running = || match name {
        "subagent" => "running subagent".to_owned(),
        name => format!("running {name}"),
    };
    let text = match &part.state {
        State::Running(_) => value.map(str::to_owned).unwrap_or_else(running),
        State::Error(_) if partial => value.map(str::to_owned).unwrap_or_else(running),
        State::Completed(_) => {
            value.map(str::to_owned).unwrap_or_else(|| tool_output_text(name, &tool_display_content(&part.state)))
        }
        State::Error(state) => state.error.message.clone(),
        _ => String::new(),
    };
    let (state, error) = match &part.state {
        State::Error(state) if !partial => (ToolState::Error, Some(state.error.message.clone())),
        State::Completed(_) => (ToolState::Completed, None),
        _ => (ToolState::Running, None),
    };
    let suffix = if version > 0 { format!(":snapshot:{version}") } else { String::new() };
    let mut commit = Commit::new(EntryKind::Tool, Source::Tool, phase, text)
        .message(message_id)
        .part_id(format!("prt_{}{suffix}", part.id));
    commit.tool = Some(name.to_owned());
    commit.directory = directory.map(str::to_owned);
    commit.part = Some(part.clone());
    commit.tool_state = Some(state);
    commit.tool_error = error;
    commit
}

/// `toolFinalPhase`: a completed tool whose output already streamed ends with that output as progress.
pub fn final_phase(part: &SessionMessageAssistantTool) -> Phase {
    let State::Completed(state) = &part.state else {
        return Phase::Final;
    };
    let name = canonical_tool_name(&part.name);
    if tool_view(name).output && !tool_output_text(name, &state.content).is_empty() {
        return Phase::Progress;
    }
    Phase::Final
}

/// `toolImageCommits`: the images a tool returned, one commit each.
pub fn image_commits(part: &SessionMessageAssistantTool, message_id: &str) -> Vec<Commit> {
    tool_display_content(&part.state)
        .iter()
        .filter_map(|content| match content {
            ToolContent::File(file) if file.mime.starts_with("image/") && file.uri.starts_with("data:image/") => {
                Some(file)
            }
            _ => None,
        })
        .enumerate()
        .map(|(index, file)| {
            let caption = file.name.clone().flatten().unwrap_or_else(|| format!("[Image {}]", index + 1));
            let mut commit = Commit::new(EntryKind::Tool, Source::Tool, Phase::Final, caption)
                .message(message_id)
                .part_id(format!("prt_{}:image:{index}", part.id));
            commit.image = Some(file.uri.clone());
            commit
        })
        .collect()
}

/// `toolFiletype`.
pub fn filetype(path: &str) -> Option<&'static str> {
    match opentui::syntax::filetype_for_path(path)? {
        "typescriptreact" | "javascriptreact" | "javascript" | "tsx" | "jsx" => Some("typescript"),
        filetype => Some(filetype),
    }
}

/// `PatchDiff`'s colors from the block theme, with `text` for the code (the scrollback's and the permission's).
pub fn diff_look(block: &crate::theme::BlockTheme, text: Color) -> opencode_ui::diff::Look {
    opencode_ui::diff::Look {
        colors: DiffColors {
            line_number: block.diff_line_number,
            line_number_bg: block.diff_context_bg,
            added_bg: block.diff_added_bg,
            removed_bg: block.diff_removed_bg,
            context_bg: block.diff_context_bg,
            added_content_bg: None,
            removed_content_bg: None,
            context_content_bg: None,
            added_sign: block.diff_highlight_added,
            removed_sign: block.diff_highlight_removed,
            added_line_number_bg: block.diff_added_line_number_bg,
            removed_line_number_bg: block.diff_removed_line_number_bg,
        },
        text,
        hunk_header: block.diff_line_number,
        hunk_header_bg: block.diff_context_bg,
    }
}

/// The widget of a structured body (`RunEntryContent`'s snapshot cases).
pub fn structured_widget(app: &App, snapshot: &Snapshot, theme: &RunTheme, mono: bool) -> AnyWidget {
    let block = &theme.block;
    let column = || View::new(app).width(Length::Percent(100.0)).direction(FlexDirection::Column);
    let text = |content: &str, color: Color| Text::new(app, content.to_owned()).wrap(WrapMode::Word).fg(color);
    let syntax = theme.syntax.clone().unwrap_or_default();
    match snapshot {
        Snapshot::Code { title, content, file } => {
            opencode_ui::grammars::register();
            let code = Code::new(app)
                .fg(block.text)
                .syntax_theme(syntax)
                .filetype(filetype(file))
                .set_code(content.clone())
                .wrap(WrapMode::Char)
                .focusable(false);
            code.grow(1.0).basis(Length::Auto);
            let numbered = LineNumbers::new(app, &code).fg(block.muted).gutter_min_width(3).gutter_padding(1);
            let body = View::new(app).width(Length::Percent(100.0)).padding_edge(Edge::Left, 1).child(&numbered);
            column().gap(1).child(&text(title, block.muted)).child(&body).as_any()
        }
        Snapshot::Diff { items } => {
            let look = diff_look(block, block.text);
            let root = column().gap(1);
            for item in items {
                let entry = column().gap(1).child(&text(&item.title, block.muted));
                if item.diff.trim().is_empty() {
                    let lines = item.deletions.unwrap_or(0);
                    let plural = if lines == 1 { "" } else { "s" };
                    entry.add(&text(&format!("-{lines} line{plural}"), block.diff_removed));
                } else {
                    let diff = opencode_ui::diff::view_with(
                        app,
                        &look,
                        &syntax,
                        &item.diff,
                        DiffView::Unified,
                        filetype(&item.file),
                        WrapMode::Word,
                        0,
                    );
                    entry.add(&View::new(app).width(Length::Percent(100.0)).padding_edge(Edge::Left, 1).child(&diff));
                }
                root.add(&entry);
            }
            root.as_any()
        }
        Snapshot::Task { title, rows, tail } => {
            let body = column().padding_edge(Edge::Left, 1);
            for row in rows {
                body.add(&text(row, block.text));
            }
            if !tail.is_empty() {
                body.add(&text(tail, block.muted));
            }
            column().gap(1).child(&text(title, block.muted)).child(&body).as_any()
        }
        Snapshot::Todo { items } => {
            let body = column();
            for item in items {
                let color = match item.status {
                    TodoStatus::InProgress => block.warning,
                    TodoStatus::Cancelled => block.faint,
                    _ => block.muted,
                };
                let marker = Text::new(app, format!("{} ", todo_marker(item.status, mono))).fg(color).shrink(0.0);
                let strike =
                    if item.status == TodoStatus::Cancelled { Attributes::STRIKETHROUGH } else { Attributes::NONE };
                let content = text(&item.content, color).attributes(strike);
                content.grow(1.0).basis(Length::Auto).shrink(1.0).min_width(0);
                body.add(
                    &View::new(app)
                        .width(Length::Percent(100.0))
                        .direction(FlexDirection::Row)
                        .child(&marker)
                        .child(&content),
                );
            }
            column().gap(1).child(&text("# Todos", block.muted)).child(&body).as_any()
        }
        Snapshot::Question { items, tail } => {
            let body = column().gap(1);
            for (question, answer) in items {
                body.add(&column().child(&text(question, block.muted)).child(&text(answer, block.text)));
            }
            if !tail.is_empty() {
                body.add(&text(tail, block.muted));
            }
            column().gap(1).child(&text("# Questions", block.muted)).child(&body).as_any()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn part(name: &str, state: Value) -> SessionMessageAssistantTool {
        serde_json::from_value(json!({ "type": "tool", "id": "call_1", "name": name, "state": state,
            "time": { "created": 1000, "ran": 1000, "completed": 3500 } }))
        .unwrap()
    }

    fn body(commit: &Commit) -> Option<Body> {
        entry_body(commit, &commit.text, BodyOptions { shell_output: true, mono: false })
    }

    fn text(body: Option<Body>) -> String {
        match body {
            Some(Body::Text(text)) => text,
            other => panic!("not text: {other:?}"),
        }
    }

    #[test]
    fn a_shell_call_draws_its_command_output_and_exit() {
        let running = part("bash", json!({ "status": "running", "input": { "command": "ls" }, "metadata": {} }));
        let start = commit(&running, "msg_a", Phase::Start, None, Some("/work"), 0);
        assert_eq!(start.part_id.as_deref(), Some("prt_call_1"));
        assert_eq!(text(body(&start)), "$ ls");
        let output = commit(&running, "msg_a", Phase::Progress, Some("$ ls\na\nb\n"), Some("/work"), 0);
        assert_eq!(text(body(&output)), "\na\nb");
        let hidden = entry_body(&output, &output.text, BodyOptions::default());
        assert_eq!(hidden, None);
        let done = part(
            "shell",
            json!({ "status": "completed", "input": { "command": "ls" }, "metadata": { "exit": 0 },
                "content": [{ "type": "text", "text": "a\nb\n" }] }),
        );
        assert_eq!(final_phase(&done), Phase::Progress);
        let failed = part(
            "shell",
            json!({ "status": "error", "input": { "command": "ls" }, "metadata": {},
                "error": { "type": "tool", "message": "boom" } }),
        );
        assert_eq!(text(body(&commit(&failed, "msg_a", Phase::Final, None, None, 0))), "✖ shell failed: boom");
        let mut finished = commit(&done, "msg_a", Phase::Final, None, None, 0);
        finished.tool_state = Some(ToolState::Completed);
        assert_eq!(body(&finished), None, "shell has no final line");
        assert_eq!(scroll(Phase::Final, &tool_frame(&finished, "")), "shell completed (exit 0) · 2.5s");
    }

    #[test]
    fn start_lines_follow_the_tool_rules() {
        let start = |name: &str, input: Value| {
            let tool = part(name, json!({ "status": "running", "input": input, "metadata": {} }));
            body(&commit(&tool, "msg_a", Phase::Start, None, Some("/work"), 0))
        };
        assert_eq!(text(start("read", json!({ "path": "/work/src/a.ts", "offset": 3 }))), "→ Read src/a.ts [offset=3]");
        assert_eq!(text(start("glob", json!({ "pattern": "*.rs", "path": "/work/src" }))), "✱ Glob \"*.rs\" in src");
        assert_eq!(text(start("grep", json!({ "pattern": "fn" }))), "✱ Grep \"fn\"");
        assert_eq!(text(start("webfetch", json!({ "url": "https://x.dev" }))), "% WebFetch https://x.dev");
        assert_eq!(
            text(start("lsp", json!({ "operation": "hover", "path": "a.rs", "line": 1, "character": 2 }))),
            "→ LSP hover a.rs:1:2"
        );
        assert_eq!(text(start("mystery", json!({ "flag": true }))), "⚙ mystery [flag=true]");
        assert_eq!(start("edit", json!({ "path": "a.rs" })), None);
        assert_eq!(start("task", json!({ "description": "look" })), None);
    }

    #[test]
    fn completed_edits_and_writes_are_snapshots() {
        let edit = part(
            "edit",
            json!({ "status": "completed", "input": { "filePath": "/work/a.rs" }, "content": [],
                "metadata": { "files": [{ "relativePath": "a.rs", "type": "update", "patch": "@@ -1 +1 @@\n-a\n+b\n" }] } }),
        );
        let final_ = commit(&edit, "msg_a", Phase::Final, None, Some("/work"), 0);
        assert!(structured_final(&final_));
        assert_eq!(
            body(&final_),
            Some(Body::Structured(Snapshot::Diff {
                items: vec![DiffItem {
                    title: "# Edited a.rs".into(),
                    diff: "@@ -1 +1 @@\n-a\n+b\n".into(),
                    file: "a.rs".into(),
                    deletions: None,
                }]
            }))
        );
        let write = part(
            "write",
            json!({ "status": "completed", "input": { "filePath": "/work/b.ts", "content": "x" }, "content": [] }),
        );
        let wrote = commit(&write, "msg_a", Phase::Final, None, Some("/work"), 0);
        let expected = Snapshot::Code { title: "# Wrote b.ts".into(), content: "x".into(), file: "/work/b.ts".into() };
        assert_eq!(body(&wrote), Some(Body::Structured(expected.clone())));
        assert_eq!(mono_body(Body::Structured(expected)), Body::Text("# Wrote b.ts\nx".into()));
        assert_eq!(filetype("a.tsx"), Some("typescript"));
    }

    #[test]
    fn subagents_patches_and_questions_end_with_their_summaries() {
        let task = part(
            "subagent",
            json!({ "status": "completed", "input": { "agent": "explore", "description": "Find it" },
                "content": [{ "type": "text", "text": "task_id: x\n<task_result>\nFound.\n</task_result>" }] }),
        );
        assert_eq!(body(&commit(&task, "m", Phase::Final, None, None, 0)), Some(Body::Markdown("Found.".into())));
        let frame = tool_frame(&commit(&task, "m", Phase::Final, None, None, 0), "");
        assert_eq!(task_final(&frame), "# Explore Subagent\nFind it");
        let patch = part(
            "apply_patch",
            json!({ "status": "completed", "input": {}, "content": [],
                "metadata": { "files": [{ "file": "a", "status": "added" }, { "file": "b", "status": "modified" }] } }),
        );
        let frame = tool_frame(&commit(&patch, "m", Phase::Final, None, Some("/w"), 0), "");
        assert_eq!(patch_final(&frame), "+ Created a");
        let question = part(
            "question",
            json!({ "status": "completed", "input": { "questions": [{ "question": "Why?" }, {}] }, "content": [],
                "metadata": { "answers": [["Because"]] } }),
        );
        let frame = tool_frame(&commit(&question, "m", Phase::Final, None, None, 0), "");
        assert_eq!(question_final(&frame), "? Why?\n  Because\n? Question 2\n  (no answer)");
    }

    #[test]
    fn a_direct_shell_draws_its_command_and_output() {
        let mut start = Commit::new(EntryKind::Tool, Source::Tool, Phase::Start, "running shell");
        start.shell = Some("ls".into());
        assert_eq!(text(body(&start)), "$ ls");
        let mut output = Commit { phase: Phase::Progress, text: "\u{1b}[1ma\u{1b}[0m\n".into(), ..start.clone() };
        output.tool_state = Some(ToolState::Completed);
        assert_eq!(text(body(&output)), "\na");
    }
}
