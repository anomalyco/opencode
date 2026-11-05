//! The prompt's history ring (`prompt.shared.ts`): the session's earlier prompts and those sent since. Up at the
//! start of the text saves the draft and steps back; Down at the end steps forward, and past the newest entry
//! restores the draft.

use opencode_ui::prompt_input::parse::measure;

use super::parts::RunPrompt;

/// `HISTORY_LIMIT`.
const LIMIT: usize = 200;

/// `PromptHistoryState`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct History {
    pub items: Vec<RunPrompt>,
    pub index: Option<usize>,
    pub draft: String,
}

/// `PromptMove`: the new state, and the text and cursor to show when the move applies.
#[derive(Debug, PartialEq)]
pub struct Move {
    pub state: History,
    pub apply: Option<(String, u32)>,
}

impl History {
    /// `createPromptHistory`: entries with content, without adjacent repeats, the newest `LIMIT`.
    pub fn new(items: &[RunPrompt]) -> Self {
        let mut next: Vec<RunPrompt> = Vec::new();
        for item in items.iter().filter(|item| item.has_content()) {
            if next.last().is_some_and(|last| last.same(item)) {
                continue;
            }
            next.push(item.copy());
        }
        let skip = next.len().saturating_sub(LIMIT);
        Self {
            items: next.split_off(skip),
            index: None,
            draft: String::new(),
        }
    }

    /// `pushPromptHistory`.
    pub fn push(&self, prompt: &RunPrompt) -> Self {
        if !prompt.has_content() {
            return self.clone();
        }
        let mut items = self.items.clone();
        if !items.last().is_some_and(|last| last.same(prompt)) {
            items.push(prompt.copy());
        }
        let skip = items.len().saturating_sub(LIMIT);
        Self {
            items: items.split_off(skip),
            index: None,
            draft: String::new(),
        }
    }

    /// `movePromptHistory`.
    pub fn step(&self, up: bool, text: &str, cursor: u32) -> Move {
        let none = || Move {
            state: self.clone(),
            apply: None,
        };
        if self.items.is_empty() || (up && cursor != 0) || (!up && cursor != measure(text)) {
            return none();
        }
        let Some(index) = self.index else {
            if !up {
                return none();
            }
            let index = self.items.len() - 1;
            return Move {
                state: Self {
                    index: Some(index),
                    draft: text.to_owned(),
                    ..self.clone()
                },
                apply: Some((self.items[index].text.clone(), 0)),
            };
        };
        if up && index == 0 {
            return none();
        }
        let next = if up { index - 1 } else { index + 1 };
        if next >= self.items.len() {
            return Move {
                state: Self {
                    index: None,
                    ..self.clone()
                },
                apply: Some((self.draft.clone(), measure(&self.draft))),
            };
        }
        let text = self.items[next].text.clone();
        let cursor = if up { 0 } else { measure(&text) };
        Move {
            state: Self {
                index: Some(next),
                ..self.clone()
            },
            apply: Some((text, cursor)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(history: &History) -> Vec<&str> {
        history.items.iter().map(|item| item.text.as_str()).collect()
    }

    #[test]
    fn entries_drop_empties_and_adjacent_repeats() {
        let history = History::new(&[
            RunPrompt::text("a"),
            RunPrompt::text("  "),
            RunPrompt::text("a"),
            RunPrompt::text("b"),
            RunPrompt::text("a"),
        ]);
        assert_eq!(texts(&history), ["a", "b", "a"]);
        assert_eq!(texts(&history.push(&RunPrompt::text("a"))), ["a", "b", "a"]);
        assert_eq!(texts(&history.push(&RunPrompt::text("c"))), ["a", "b", "a", "c"]);
        let many: Vec<RunPrompt> = (0..205).map(|i| RunPrompt::text(i.to_string())).collect();
        let history = History::new(&many);
        assert_eq!(history.items.len(), 200);
        assert_eq!(history.items[0].text, "5");
    }

    #[test]
    fn steps_follow_the_cursor_and_restore_the_draft() {
        let history = History::new(&[RunPrompt::text("first"), RunPrompt::text("second")]);
        // Up away from the start does nothing.
        assert_eq!(history.step(true, "draft", 3).apply, None);
        let up = history.step(true, "draft", 0);
        assert_eq!(up.apply, Some(("second".into(), 0)));
        let up = up.state.step(true, "second", 0);
        assert_eq!(up.apply, Some(("first".into(), 0)));
        assert_eq!(up.state.step(true, "first", 0).apply, None);
        let down = up.state.step(false, "first", 5);
        assert_eq!(down.apply, Some(("second".into(), 6)));
        let down = down.state.step(false, "second", 6);
        assert_eq!(down.apply, Some(("draft".into(), 5)));
        assert_eq!(down.state.index, None);
        assert_eq!(down.state.step(false, "draft", 5).apply, None);
    }
}
