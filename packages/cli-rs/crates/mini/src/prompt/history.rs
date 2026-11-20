//! Stepping back saves the draft; stepping past the newest entry restores it.

use super::parts::RunPrompt;

const LIMIT: usize = 200;

#[derive(Clone, Debug, Default, PartialEq)]
pub struct History {
    pub items: Vec<RunPrompt>,
    pub index: Option<usize>,
    pub draft: String,
}

/// `PromptMove`: the new state, and the text and cursor to show when the move applies; no cursor is the end.
#[derive(Debug, PartialEq)]
pub struct Move {
    pub state: History,
    pub apply: Option<(String, Option<u32>)>,
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
        Self { items: next.split_off(skip), index: None, draft: String::new() }
    }

    pub fn push(&self, prompt: &RunPrompt) -> Self {
        if !prompt.has_content() {
            return self.clone();
        }
        let mut items = self.items.clone();
        if !items.last().is_some_and(|last| last.same(prompt)) {
            items.push(prompt.copy());
        }
        let skip = items.len().saturating_sub(LIMIT);
        Self { items: items.split_off(skip), index: None, draft: String::new() }
    }

    /// `movePromptHistory`, with the cursor in `text` and `end`, the offset at its end.
    pub fn step(&self, up: bool, text: &str, cursor: u32, end: u32) -> Move {
        let none = || Move { state: self.clone(), apply: None };
        if self.items.is_empty() || (up && cursor != 0) || (!up && cursor != end) {
            return none();
        }
        let Some(index) = self.index else {
            if !up {
                return none();
            }
            let index = self.items.len() - 1;
            return Move {
                state: Self { index: Some(index), draft: text.to_owned(), ..self.clone() },
                apply: Some((self.items[index].text.clone(), Some(0))),
            };
        };
        if up && index == 0 {
            return none();
        }
        let next = if up { index - 1 } else { index + 1 };
        if next >= self.items.len() {
            return Move { state: Self { index: None, ..self.clone() }, apply: Some((self.draft.clone(), None)) };
        }
        let text = self.items[next].text.clone();
        let cursor = up.then_some(0);
        Move { state: Self { index: Some(next), ..self.clone() }, apply: Some((text, cursor)) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appended_and_loaded_histories_keep_the_same_recent_prompts() {
        for n in [0usize, 1, 2, 3, 199, 200, 201, 205] {
            let distinct: Vec<_> = (0..n).map(|i| RunPrompt::text((i % 3).to_string())).collect();
            let noisy: Vec<_> = distinct.iter().flat_map(|p| [p.clone(), RunPrompt::text(" "), p.clone()]).collect();
            let appended = noisy.iter().fold(History::default(), |history, prompt| history.push(prompt));
            let expected = &distinct[n.saturating_sub(200)..];
            assert_eq!(History::new(&noisy).items, expected, "load {n}");
            assert_eq!(appended.items, expected, "append {n}");
        }
    }
}
