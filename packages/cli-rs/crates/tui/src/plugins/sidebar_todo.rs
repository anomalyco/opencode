//! The sidebar's todo section (E.14, row F07, `feature-plugins/sidebar/todo.tsx`): the list of the latest
//! completed `todowrite` call before the revert boundary. Above two items the header folds the list, and the
//! folded header counts what remains.

use std::rc::Rc;

use opencode_api::generated::{
    SessionID, SessionMessageAssistantContentItem, SessionMessageAssistantToolState, SessionMessageInfo,
};
use opencode_plugin::{Definition, Placement, slot};
use opencode_store::MessageExt;
use opencode_ui::theme::Theme;
use opentui::prelude::*;
use serde_json::Value;

use crate::app::Tui;
use crate::routes::session::sidebar::{Fold, Section, on_click};

pub fn plugin() -> Definition<Tui> {
    Definition::new("opencode.sidebar.todo", |cx| {
        let fold = Fold::load(cx.host(), cx.storage_key("view"));
        cx.slot(Placement::append(slot::SIDEBAR_CONTENT), move |tui, input| {
            let session = SessionID(input.session_id.clone().unwrap_or_default());
            let (model, render) = (fold.clone(), fold.clone());
            Box::new(Section::new(
                tui,
                Some(session.clone()),
                move |tui, _| {
                    let list = tui.data.read(|state| {
                        let boundary = state.session(&session).and_then(|info| info.revert.as_ref());
                        todos(state.messages(&session), boundary.map(|revert| revert.message_id.0.as_str()))
                    });
                    (!list.is_empty()).then(|| (list, model.open()))
                },
                move |tui, (list, _)| view(tui, list, &render),
            ))
        });
    })
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status {
    Pending,
    InProgress,
    Completed,
    Cancelled,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Todo {
    pub content: String,
    pub status: Status,
}

fn view(tui: &Tui, list: &[Todo], fold: &Rc<Fold>) -> View {
    let theme = tui.page();
    let app = &tui.app;
    let foldable = list.len() > 2;
    let header = View::new(app).row().gap(1);
    if foldable {
        header.add(&Text::new(app, if fold.open() { "▼" } else { "▶" }).fg(theme.text.base));
    }
    let mut title = vec!["Todo".fg(theme.text.base).bold()];
    if foldable && !fold.open() {
        let remaining = list.iter().filter(|item| matches!(item.status, Status::Pending | Status::InProgress)).count();
        title.push(format!(" ({remaining} remaining)").fg(theme.text.muted));
    }
    header.add(&Text::new(app, title));
    let weak = tui.weak();
    let toggle = fold.clone();
    on_click(&header, true, move || {
        if let Some(tui) = weak.upgrade()
            && foldable
        {
            toggle.toggle(&tui);
        }
    });
    let root = View::new(app).child(&header);
    if !foldable || fold.open() {
        for item in list {
            root.add(&item_view(app, &theme, item));
        }
    }
    root
}

/// `TodoItem`: the marker and the wrapped content, colored by status.
fn item_view(app: &App, theme: &Theme, todo: &Todo) -> View {
    let color = match todo.status {
        Status::InProgress => theme.text.feedback.warning.base,
        Status::Cancelled => theme.text.faint,
        _ => theme.text.muted,
    };
    let content = Text::new(app, todo.content.clone()).fg(color).wrap(WrapMode::Word).grow(1.0);
    if todo.status == Status::Cancelled {
        content.strikethrough();
    }
    View::new(app)
        .row()
        .child(&Text::new(app, format!("{} ", marker(todo.status))).fg(color).shrink(0.0))
        .child(&content)
}

/// `todoMarker`.
pub fn marker(status: Status) -> &'static str {
    match status {
        Status::Completed => "[✓]",
        Status::InProgress => "[•]",
        Status::Cancelled => "[-]",
        Status::Pending => "[ ]",
    }
}

/// `sessionTodos`: the input of the latest completed `todowrite` call before `boundary`.
pub fn todos(messages: &[SessionMessageInfo], boundary: Option<&str>) -> Vec<Todo> {
    let end = boundary
        .and_then(|boundary| messages.iter().position(|message| message.id() == boundary))
        .unwrap_or(messages.len());
    let input = messages[..end]
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
        });
    parse(input)
}

/// `parseTodos`: entries with non-empty content; an unknown status reads as pending.
fn parse(value: Option<&Value>) -> Vec<Todo> {
    let Some(Value::Array(items)) = value else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let content = item.get("content")?.as_str().filter(|text| !text.is_empty())?;
            let status = match item.get("status").and_then(Value::as_str) {
                Some("in_progress") => Status::InProgress,
                Some("completed") => Status::Completed,
                Some("cancelled") => Status::Cancelled,
                _ => Status::Pending,
            };
            Some(Todo { content: content.to_owned(), status })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_like_parse_todos() {
        let value = json!([
            { "content": "a", "status": "completed" },
            { "content": "", "status": "pending" },
            { "content": "b", "status": "weird" },
            { "status": "pending" },
            { "content": "c", "status": "in_progress" },
        ]);
        let list = parse(Some(&value));
        assert_eq!(
            list.iter().map(|todo| (todo.content.as_str(), todo.status)).collect::<Vec<_>>(),
            [("a", Status::Completed), ("b", Status::Pending), ("c", Status::InProgress)]
        );
        assert!(parse(Some(&json!({}))).is_empty());
    }
}
