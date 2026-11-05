//! The todowrite tool (E.7b): `TodoWrite` (`routes/session/index.tsx:3636-3660`) and `TodoItem`
//! (`component/todo-item.tsx`). Once written, the list in a block; before that, or for an empty list,
//! one line.

use std::cell::RefCell;

use opencode_ui::theme::Theme;
use opencode_ui::tool_info::{Todo as Item, TodoStatus, parse_todos, todo_marker};
use opentui::prelude::*;
use serde_json::Value;

use super::dispatch::{Block, BlockTool, Header, Inline, InlineTool, Props, Status, content_width};
use crate::routes::session::messages::list::Context;

pub struct Todo {
    root: View,
    inline: InlineTool,
    block: BlockTool,
    shown: RefCell<Option<Vec<Item>>>,
}

impl Todo {
    pub fn new(cx: &Context<'_>) -> Self {
        let inline = InlineTool::new(cx);
        let block = BlockTool::new(cx);
        let root = View::new(cx.app).column().shrink(0.0).child(inline.root()).child(block.root());
        Self { root, inline, block, shown: RefCell::default() }
    }

    pub fn root(&self) -> &View {
        &self.root
    }

    pub fn update(&self, cx: &Context<'_>, props: &Props<'_>) {
        let status = props.status();
        let todos = parse_todos(props.input.get("todos").unwrap_or(&Value::Null));
        let listed = status == Status::Completed && !todos.is_empty();
        self.inline.root().visible(!listed);
        self.block.root().visible(listed);
        if !listed {
            self.inline.set(Inline {
                text: if status == Status::Error { "Todo update failed" } else { "Cleared todos" }.to_owned(),
                ..Inline::new(props, "⚙", "Updating todos…", matches!(status, Status::Completed | Status::Error))
            });
            return;
        }
        self.block.set(Block {
            header: Header::Title("# Todos".to_owned()),
            spinner: false,
            permission: props.permission,
            error: None,
            clickable: false,
            width: content_width(cx),
        });
        if self.shown.borrow().as_ref() == Some(&todos) {
            return;
        }
        let children = self.block.children();
        children.clear();
        let list = View::new(cx.app).column();
        for todo in &todos {
            list.add(&item(cx.app, cx.theme, todo));
        }
        children.add(&list);
        self.block.show_children(true);
        *self.shown.borrow_mut() = Some(todos);
    }
}

/// `TodoItem`: the marker, then the text, colored by status; a cancelled item is struck through.
pub fn item(app: &App, theme: &Theme, todo: &Item) -> View {
    let fg = match todo.status {
        TodoStatus::InProgress => theme.text.feedback.warning.base,
        TodoStatus::Cancelled => theme.text.faint,
        _ => theme.text.muted,
    };
    let text = Text::new(app, todo.content.clone()).grow(1.0).wrap(WrapMode::Word).fg(fg);
    if todo.status == TodoStatus::Cancelled {
        text.strikethrough();
    }
    View::new(app)
        .row()
        .child(&Text::new(app, format!("{} ", todo_marker(todo.status, false))).shrink(0.0).fg(fg))
        .child(&text)
}
