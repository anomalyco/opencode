//! The sidebar's todo section (E.14, row F07, `feature-plugins/sidebar/todo.tsx`): the list of the latest
//! completed `todowrite` call before the revert boundary. Above two items the header folds the list, and the
//! folded header counts what remains. It is a plugin of the one API (O-67).

use opencode_api::generated::{SessionMessageAssistantContentItem, SessionMessageAssistantToolState};
use opencode_plugin::abi::{self, Changed, Click, Command, Layout, Node, Placement, Render, Span};
use opencode_plugin::slot;
use opencode_ui::tool_info::{Todo, TodoStatus, parse_todos, todo_marker};

use crate::prelude::*;

pub fn plugin() -> abi::Plugin {
    abi::Plugin { id: "opencode.sidebar.todo", setup }
}

/// The hidden command a click on the header runs.
const FOLD: &str = "sidebar.todo.fold";

fn setup(setup: &mut abi::Setup) -> Result<(), String> {
    setup.storage_key("view");
    setup.command(Command { name: FOLD.to_owned(), ..Command::default() }, |host, _| {
        host.storage_merge("view", serde_json::Map::from_iter([("open".to_owned(), json!(!open(host)))]));
    });
    let last: RefCell<Option<Last>> = RefCell::default();
    setup.slot(Placement::append(slot::SIDEBAR_CONTENT), move |read, input, changed| {
        let Some(session) = input.session_id.as_deref() else { return Render::Hide };
        let mut last = last.borrow_mut();
        let fresh = changed.all || changed.local || last.as_ref().is_none_or(|last| last.session != session);
        let last = match &mut *last {
            Some(last) if !fresh => last,
            last => last.insert(Last { session: session.to_owned(), boundary: None, input: None }),
        };
        if !last.update(read, changed, fresh) && !fresh {
            return Render::Keep;
        }
        let list = last.input.as_ref().map(parse_todos).unwrap_or_default();
        if list.is_empty() {
            return Render::Hide;
        }
        Render::Show(view(&list, open(read)))
    });
    Ok(())
}

/// The stored `{ open: true }` (`storage.store("view")`).
fn open(read: &dyn abi::Read) -> bool {
    read.storage_get("view").and_then(|value| value.get("open")?.as_bool()).unwrap_or(true)
}

/// What the section last read for its session: the revert boundary and the input of the `todowrite` call it found.
struct Last {
    session: String,
    boundary: Option<String>,
    input: Option<Value>,
}

impl Last {
    /// Reads what `changed` may have changed; whether the list it shows changed. A streamed delta that leaves the
    /// latest `todowrite` call as it was allocates nothing.
    fn update(&mut self, read: &dyn abi::Read, changed: &Changed, fresh: bool) -> bool {
        let info = fresh || changed.session(&self.session);
        if info {
            self.boundary =
                read.session(&self.session).and_then(|session| session.info.revert).map(|revert| revert.message_id.0);
        }
        let messages =
            info || changed.list(&self.session) || changed.messages.iter().any(|(session, _)| *session == self.session);
        if !messages {
            return false;
        }
        let mut same = true;
        read.messages(&self.session, &mut |messages| {
            let input = todo_input(messages, self.boundary.as_deref());
            if input != self.input.as_ref() {
                self.input = input.cloned();
                same = false;
            }
        });
        !same
    }
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
        header = header.on_click(Click::command(FOLD, None).on_down());
    }
    let mut children = vec![header];
    if !foldable || open {
        children.extend(list.iter().map(item));
    }
    Node::column(children)
}

/// `TodoItem`: the marker and the wrapped content, colored by status.
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
fn todo_input<'a>(messages: &'a [SessionMessageInfo], boundary: Option<&str>) -> Option<&'a Value> {
    let end = boundary
        .and_then(|boundary| messages.iter().position(|message| message.id() == boundary))
        .unwrap_or(messages.len());
    messages[..end]
        .iter()
        .flat_map(|message| match message {
            SessionMessageInfo::Assistant(message) => message.content.as_slice(),
            _ => &[],
        })
        .rev()
        .find_map(|item| match item {
            SessionMessageAssistantContentItem::Tool(tool) if tool.name == "todowrite" => match &tool.state {
                SessionMessageAssistantToolState::Completed(state) => state.input.get("todos"),
                _ => None,
            },
            _ => None,
        })
}
