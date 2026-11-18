//! Show the most recent completed todo list before the revert boundary.

use opencode_api::generated::{SessionMessageAssistantContentItem, SessionMessageAssistantToolState};
use opencode_plugin::abi::v2::{Node, Place, Surface};
use opencode_plugin::abi::{self, Changed, Click, Command, Layout, Placement, Span};
use opencode_plugin::slot;
use opencode_ui::tool_info::{Todo, TodoStatus, parse_todos, todo_marker};

use super::{hidden, kept};
use crate::prelude::*;

pub fn plugin() -> abi::Plugin {
    abi::Plugin { id: "opencode.sidebar.todo", setup }
}

const FOLD: &str = "sidebar.todo.fold";
const ROOT: &str = "todo";

fn setup(setup: &mut abi::Setup) -> Result<(), String> {
    setup.storage_key("view");
    setup.command(Command::new(FOLD), |host, _| {
        host.storage_merge("view", serde_json::Map::from_iter([("open".to_owned(), json!(!open(host)))]));
    });
    let last: RefCell<Option<Last>> = RefCell::default();
    let surface = Surface::new("todo", Place::Slot(Placement::append(slot::SIDEBAR_CONTENT)), move |cx| {
        let Some(session) = cx.input.slot.as_ref().and_then(|slot| slot.session_id.as_deref()) else {
            return hidden(ROOT);
        };
        let changed = &cx.input.changed;
        let mut last = last.borrow_mut();
        let fresh = changed.all || changed.local || last.as_ref().is_none_or(|last| last.session != session);
        let last = match &mut *last {
            Some(last) if !fresh => last,
            last => last.insert(Last { session: session.to_owned(), boundary: None, input: None, source: None }),
        };
        if !last.update(cx.read, changed, fresh) && !fresh {
            return kept(ROOT);
        }
        let list = last.input.as_ref().map(parse_todos).unwrap_or_default();
        if list.is_empty() {
            return hidden(ROOT);
        }
        view(&list, open(cx.read)).with_id(ROOT)
    });
    setup.surface(surface);
    Ok(())
}

fn open(read: &dyn abi::Read) -> bool {
    read.storage_get("view").and_then(|value| value.get("open")?.as_bool()).unwrap_or(true)
}

/// What the section last read for its session: the revert boundary and the input of the `todowrite` call it found.
struct Last {
    session: String,
    boundary: Option<String>,
    input: Option<Value>,
    source: Option<String>,
}

impl Last {
    /// Refresh the displayed list only when a relevant message or boundary changes.
    fn update(&mut self, read: &dyn abi::Read, changed: &Changed, fresh: bool) -> bool {
        let info = fresh || changed.session(&self.session);
        if info {
            self.boundary =
                read.session(&self.session).and_then(|session| session.info.revert).map(|revert| revert.message_id.0);
        }
        let mut messages = info || changed.list(&self.session);
        // Inspect changed messages individually; unrelated deltas must not rescan the transcript.
        for (session, id) in &changed.messages {
            if messages {
                break;
            }
            if *session == self.session {
                messages = self.source.as_deref() == Some(id.as_str());
                read.message(&self.session, id, &mut |message| messages |= message.is_some_and(writes_todos));
            }
        }
        if !messages {
            return false;
        }
        let mut same = true;
        read.messages(&self.session, &mut |messages| {
            let found = todo_input(messages, self.boundary.as_deref());
            self.source = found.map(|(source, _)| source.to_owned());
            let input = found.map(|(_, input)| input);
            if input != self.input.as_ref() {
                self.input = input.cloned();
                same = false;
            }
        });
        !same
    }
}

/// Whether `message` holds a `todowrite` call, in any state.
fn writes_todos(message: &SessionMessageInfo) -> bool {
    let SessionMessageInfo::Assistant(message) = message else { return false };
    message
        .content
        .iter()
        .any(|item| matches!(item, SessionMessageAssistantContentItem::Tool(tool) if tool.name == "todowrite"))
}

fn view(list: &[Todo], open: bool) -> Node {
    let foldable = list.len() > 2;
    let mut header = Vec::new();
    if foldable {
        header.push(Node::text([Span::new(if open { "▼" } else { "▶" }).fg("text.base")]));
    }
    let mut title = vec![Span::new("Todo").fg("text.base").bold()];
    if foldable && !open {
        let remaining =
            list.iter().filter(|item| matches!(item.status, TodoStatus::Pending | TodoStatus::InProgress)).count();
        title.push(Span::new(format!(" ({remaining} remaining)")).fg("text.muted"));
    }
    header.push(Node::text(title));
    let mut header = Node::row(header).gap(1);
    if foldable {
        header = header.on_click(Click::command(FOLD).on_down());
    }
    let mut children = vec![header];
    if !foldable || open {
        children.extend(list.iter().map(item));
    }
    Node::column(children)
}

fn item(todo: &Todo) -> Node {
    let color = match todo.status {
        TodoStatus::InProgress => "text.feedback.warning.base",
        TodoStatus::Cancelled => "text.faint",
        _ => "text.muted",
    };
    let content = Span { strikethrough: todo.status == TodoStatus::Cancelled, ..Span::new(todo.content.clone()) };
    Node::row(vec![
        Node::text([Span::new(format!("{} ", todo_marker(todo.status, false)))])
            .fg(color)
            .layout(Layout::default().shrink(false)),
        Node::text([content]).fg(color).layout(Layout::default().grow()),
    ])
}

/// `sessionTodos`: the input of the latest completed `todowrite` call before `boundary`.
/// With the id of the message that holds it.
fn todo_input<'a>(messages: &'a [SessionMessageInfo], boundary: Option<&str>) -> Option<(&'a str, &'a Value)> {
    let end = boundary
        .and_then(|boundary| messages.iter().position(|message| message.id() == boundary))
        .unwrap_or(messages.len());
    messages[..end].iter().rev().find_map(|message| {
        let SessionMessageInfo::Assistant(assistant) = message else { return None };
        let input = assistant.content.iter().rev().find_map(|item| match item {
            SessionMessageAssistantContentItem::Tool(tool) if tool.name == "todowrite" => match &tool.state {
                SessionMessageAssistantToolState::Completed(state) => state.input.get("todos"),
                _ => None,
            },
            _ => None,
        });
        input.map(|input| (message.id(), input))
    })
}
