//! The question tool (E.7b): `Question` (`routes/session/index.tsx:3662-3696`). Once answered, each
//! question and its answer in a block; before that, one line with the count.
//!
//! The row only shows the call. The user answers in the question form, which is E.9b's.

use std::cell::RefCell;

use opentui::prelude::*;
use serde_json::Value;

use super::dispatch::{Block, BlockTool, Header, Inline, InlineTool, Props, content_width};
use crate::routes::session::messages::list::Context;

pub struct Question {
    root: View,
    inline: InlineTool,
    block: BlockTool,
    shown: RefCell<Option<Vec<(String, String)>>>,
}

impl Question {
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
        let questions = questions(props.input.get("questions"));
        let answers = answers(props.metadata.get("answers"));
        self.inline.root().visible(answers.is_none());
        self.block.root().visible(answers.is_some());
        let Some(answers) = answers else {
            let count = questions.len();
            self.inline.set(Inline {
                text: format!("Asked {count} question{}", if count == 1 { "" } else { "s" }),
                ..Inline::new(props, "→", "Asking questions…", count > 0)
            });
            return;
        };
        self.block.set(Block {
            header: Header::Title("# Questions".to_owned()),
            spinner: false,
            permission: props.permission,
            error: props.error().map(str::to_owned),
            clickable: false,
            width: content_width(cx),
        });
        let rows: Vec<(String, String)> = questions
            .into_iter()
            .enumerate()
            .map(|(index, question)| {
                let answer = answers
                    .get(index)
                    .filter(|answer| !answer.is_empty())
                    .map_or_else(|| "(no answer)".to_owned(), |answer| answer.join(", "));
                (question, answer)
            })
            .collect();
        if self.shown.borrow().as_ref() == Some(&rows) {
            return;
        }
        let children = self.block.children();
        children.clear();
        let list = View::new(cx.app).column().gap(1);
        for (question, answer) in &rows {
            list.add(
                &View::new(cx.app)
                    .column()
                    .child(&Text::new(cx.app, question.clone()).fg(cx.theme.text.muted))
                    .child(&Text::new(cx.app, answer.clone()).fg(cx.theme.text.base)),
            );
        }
        children.add(&list);
        self.block.show_children(true);
        *self.shown.borrow_mut() = Some(rows);
    }
}

/// `parseQuestions`: the text of each question that has one.
fn questions(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("question")?.as_str())
        .filter(|question| !question.is_empty())
        .map(str::to_owned)
        .collect()
}

/// `parseQuestionAnswers`: the string answers of each question, or `None` when there are none yet.
fn answers(value: Option<&Value>) -> Option<Vec<Vec<String>>> {
    Some(
        value?
            .as_array()?
            .iter()
            .map(|answer| {
                answer.as_array().into_iter().flatten().filter_map(Value::as_str).map(str::to_owned).collect()
            })
            .collect(),
    )
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{answers, questions};

    #[test]
    fn questions_and_answers_parse_as_ts_does() {
        let input = json!([{ "question": "Which?" }, { "question": "" }, { "header": "x" }, "y"]);
        assert_eq!(questions(Some(&input)), ["Which?"]);
        assert_eq!(answers(Some(&json!({}))), None);
        assert_eq!(answers(None), None);
        assert_eq!(
            answers(Some(&json!([["a", 1, "b"], "c", []]))),
            Some(vec![vec!["a".to_owned(), "b".to_owned()], vec![], vec![]])
        );
    }
}
