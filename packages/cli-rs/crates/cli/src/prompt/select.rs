//! `select` and `multiselect` (`@clack/prompts` `select.ts`, `multi-select.ts`, `limit-options.ts`).

use super::core::{self, Base, Prompt};
use super::style::{
    S_BAR, S_BAR_END, S_CHECKBOX_ACTIVE, S_CHECKBOX_INACTIVE, S_CHECKBOX_SELECTED, S_RADIO_ACTIVE,
    S_RADIO_INACTIVE, bg_white, cyan, dim, gray, green, inverse, reset, strikethrough, symbol,
    yellow,
};
use super::{Cancelled, Output, State, term};

/// One option of a list prompt.
#[derive(Clone, Debug, PartialEq)]
pub struct Choice<T> {
    pub value: T,
    pub label: String,
    /// Shown dim next to the focused option.
    pub hint: Option<String>,
}

impl<T> Choice<T> {
    pub fn new(value: T, label: impl Into<String>) -> Choice<T> {
        Choice {
            value,
            label: label.into(),
            hint: None,
        }
    }

    pub fn hint(mut self, hint: impl Into<String>) -> Choice<T> {
        self.hint = Some(hint.into());
        self
    }
}

impl<T: ToString> Choice<T> {
    #[allow(dead_code, reason = "only opencode-prompt-demo uses it")]
    /// An option labeled with its value, as Clack labels an option without `label`.
    pub fn plain(value: T) -> Choice<T> {
        let label = value.to_string();
        Choice {
            value,
            label,
            hint: None,
        }
    }
}

/// The visible window of a long list: at most `max_items` rows (at least 5), never more than the
/// terminal has rows for, with `...` in place of the first or last row when more lie beyond.
pub fn limit_options<T>(
    options: &[T],
    cursor: usize,
    max_items: Option<usize>,
    output: Output,
    style: impl Fn(&T, bool) -> String,
) -> Vec<String> {
    window(options, cursor, max_items, term::rows(output), style)
}

fn window<T>(
    options: &[T],
    cursor: usize,
    max_items: Option<usize>,
    rows: usize,
    style: impl Fn(&T, bool) -> String,
) -> Vec<String> {
    let rows = rows as i64;
    let length = options.len() as i64;
    let cursor = cursor as i64;
    let wanted = max_items.map_or(i64::MAX, |items| items as i64);
    let max = (rows - 4).max(0).min(wanted.max(5));
    let start = if cursor >= max - 3 {
        (cursor - max + 3).min(length - max).max(0)
    } else {
        0
    };
    let top = max < length && start > 0;
    let bottom = max < length && start + max < length;
    let end = (start + max).min(length);
    let visible = &options[start as usize..end.max(start) as usize];
    visible
        .iter()
        .enumerate()
        .map(|(index, option)| {
            if (index == 0 && top) || (index == visible.len() - 1 && bottom) {
                dim("...")
            } else {
                style(option, index as i64 + start == cursor)
            }
        })
        .collect()
}

/// One value from a list. Arrows (and H, J, K, L) move with wrap-around; Enter submits.
pub struct Select<T> {
    message: String,
    options: Vec<Choice<T>>,
    initial_value: Option<T>,
    max_items: Option<usize>,
}

pub fn select<T: Clone + PartialEq>(
    message: impl Into<String>,
    options: Vec<Choice<T>>,
) -> Select<T> {
    Select {
        message: message.into(),
        options,
        initial_value: None,
        max_items: None,
    }
}

impl<T: Clone + PartialEq> Select<T> {
    /// The option focused first; the first option when none matches.
    pub fn initial_value(mut self, value: T) -> Self {
        self.initial_value = Some(value);
        self
    }

    #[allow(dead_code, reason = "only opencode-prompt-demo uses it")]
    pub fn max_items(mut self, items: usize) -> Self {
        self.max_items = Some(items);
        self
    }

    /// Cancelled without showing anything when there are no options.
    pub fn prompt(self) -> Result<T, Cancelled> {
        if self.options.is_empty() {
            return Err(Cancelled);
        }
        let cursor = self
            .initial_value
            .as_ref()
            .and_then(|initial| {
                self.options
                    .iter()
                    .position(|option| option.value == *initial)
            })
            .unwrap_or(0);
        let mut prompt = SelectPrompt {
            options: self,
            cursor,
        };
        core::run(&mut prompt, Output::Stdout, None)?;
        Ok(prompt.options.options[prompt.cursor].value.clone())
    }
}

struct SelectPrompt<T> {
    options: Select<T>,
    cursor: usize,
}

impl<T> Prompt for SelectPrompt<T> {
    fn track(&self) -> bool {
        false
    }

    fn cursor(&mut self, action: &str, _base: &mut Base) {
        self.cursor = step(self.cursor, self.options.options.len(), action);
    }

    fn render(&self, base: &Base) -> String {
        let title = format!(
            "{}\n{}  {}\n",
            gray(S_BAR()),
            symbol(base.state),
            self.options.message
        );
        let current = &self.options.options[self.cursor];
        match base.state {
            State::Submit => format!("{title}{}  {}", gray(S_BAR()), dim(&current.label)),
            State::Cancel => {
                format!(
                    "{title}{}  {}\n{}",
                    gray(S_BAR()),
                    strikethrough(&dim(&current.label)),
                    gray(S_BAR())
                )
            }
            _ => {
                let rows = limit_options(
                    &self.options.options,
                    self.cursor,
                    self.options.max_items,
                    Output::Stdout,
                    |option, active| {
                        if active {
                            let hint = option
                                .hint
                                .as_deref()
                                .map(|hint| dim(&format!("({hint})")))
                                .unwrap_or_default();
                            format!("{} {} {hint}", green(S_RADIO_ACTIVE()), option.label)
                        } else {
                            format!("{} {}", dim(S_RADIO_INACTIVE()), dim(&option.label))
                        }
                    },
                );
                format!(
                    "{title}{}  {}\n{}\n",
                    cyan(S_BAR()),
                    rows.join(&format!("\n{}  ", cyan(S_BAR()))),
                    cyan(S_BAR_END())
                )
            }
        }
    }
}

/// Moves a list cursor for a Clack cursor action, wrapping at both ends.
fn step(cursor: usize, length: usize, action: &str) -> usize {
    match action {
        "left" | "up" => {
            if cursor == 0 {
                length - 1
            } else {
                cursor - 1
            }
        }
        "down" | "right" => {
            if cursor + 1 == length {
                0
            } else {
                cursor + 1
            }
        }
        _ => cursor,
    }
}

/// Any number of values from a list. Space toggles, A toggles all, Enter submits.
pub struct MultiSelect<T> {
    message: String,
    options: Vec<Choice<T>>,
    initial_values: Vec<T>,
    required: bool,
}

pub fn multiselect<T: Clone + PartialEq>(
    message: impl Into<String>,
    options: Vec<Choice<T>>,
) -> MultiSelect<T> {
    MultiSelect {
        message: message.into(),
        options,
        initial_values: Vec::new(),
        required: true,
    }
}

impl<T: Clone + PartialEq> MultiSelect<T> {
    pub fn initial_values(mut self, values: Vec<T>) -> Self {
        self.initial_values = values;
        self
    }

    /// Whether at least one value must be selected (default `true`).
    pub fn required(mut self, required: bool) -> Self {
        self.required = required;
        self
    }

    /// The selected values in the order they were selected. Cancelled without showing anything when
    /// there are no options.
    pub fn prompt(self) -> Result<Vec<T>, Cancelled> {
        if self.options.is_empty() {
            return Err(Cancelled);
        }
        let value = self.initial_values.clone();
        let mut prompt = MultiSelectPrompt {
            options: self,
            cursor: 0,
            value,
        };
        core::run(&mut prompt, Output::Stdout, None)?;
        Ok(prompt.value)
    }
}

struct MultiSelectPrompt<T> {
    options: MultiSelect<T>,
    cursor: usize,
    value: Vec<T>,
}

impl<T: Clone + PartialEq> MultiSelectPrompt<T> {
    fn label(&self, option: &Choice<T>, state: &str) -> String {
        let hint = option
            .hint
            .as_deref()
            .map(|hint| dim(&format!("({hint})")))
            .unwrap_or_default();
        let label = &option.label;
        match state {
            "active" => format!("{} {label} {hint}", cyan(S_CHECKBOX_ACTIVE())),
            "selected" => format!("{} {} {hint}", green(S_CHECKBOX_SELECTED()), dim(label)),
            "cancelled" => strikethrough(&dim(label)),
            "active-selected" => format!("{} {label} {hint}", green(S_CHECKBOX_SELECTED())),
            "submitted" => dim(label),
            _ => format!("{} {}", dim(S_CHECKBOX_INACTIVE()), dim(label)),
        }
    }

    fn rows(&self, bar: &str) -> String {
        limit_options(
            &self.options.options,
            self.cursor,
            None,
            Output::Stdout,
            |option, active| {
                let selected = self.value.contains(&option.value);
                let state = match (active, selected) {
                    (true, true) => "active-selected",
                    (false, true) => "selected",
                    (true, false) => "active",
                    (false, false) => "inactive",
                };
                self.label(option, state)
            },
        )
        .join(&format!("\n{bar}  "))
    }

    fn chosen(&self, state: &str) -> String {
        let labels: Vec<String> = self
            .options
            .options
            .iter()
            .filter(|option| self.value.contains(&option.value))
            .map(|option| self.label(option, state))
            .collect();
        labels.join(&dim(", "))
    }
}

impl<T: Clone + PartialEq> Prompt for MultiSelectPrompt<T> {
    fn track(&self) -> bool {
        false
    }

    fn key(&mut self, char: Option<&str>, _key: &term::Key, _base: &mut Base) {
        if char == Some("a") {
            let all = self.value.len() == self.options.options.len();
            self.value = if all {
                Vec::new()
            } else {
                self.options
                    .options
                    .iter()
                    .map(|option| option.value.clone())
                    .collect()
            };
        }
    }

    fn cursor(&mut self, action: &str, _base: &mut Base) {
        if action == "space" {
            let current = &self.options.options[self.cursor].value;
            match self.value.iter().position(|value| value == current) {
                Some(_) => self.value.retain(|value| value != current),
                None => self.value.push(current.clone()),
            }
            return;
        }
        self.cursor = step(self.cursor, self.options.options.len(), action);
    }

    fn validate(&self, _base: &Base) -> Option<String> {
        (self.options.required && self.value.is_empty()).then(|| {
            let key = |name: &str| gray(&bg_white(&inverse(name)));
            format!(
                "Please select at least one option.\n{}",
                reset(&dim(&format!(
                    "Press {} to select, {} to submit",
                    key(" space "),
                    key(" enter ")
                )))
            )
        })
    }

    fn render(&self, base: &Base) -> String {
        let title = format!(
            "{}\n{}  {}\n",
            gray(S_BAR()),
            symbol(base.state),
            self.options.message
        );
        match base.state {
            State::Submit => {
                let chosen = self.chosen("submitted");
                format!(
                    "{title}{}  {}",
                    gray(S_BAR()),
                    if chosen.is_empty() {
                        dim("none")
                    } else {
                        chosen
                    }
                )
            }
            State::Cancel => {
                let chosen = self.chosen("cancelled");
                let rest = if chosen.trim().is_empty() {
                    String::new()
                } else {
                    format!("{chosen}\n{}", gray(S_BAR()))
                };
                format!("{title}{}  {rest}", gray(S_BAR()))
            }
            State::Error => {
                let footer: Vec<String> = base
                    .error
                    .split('\n')
                    .enumerate()
                    .map(|(index, line)| {
                        if index == 0 {
                            format!("{}  {}", yellow(S_BAR_END()), yellow(line))
                        } else {
                            format!("   {line}")
                        }
                    })
                    .collect();
                format!(
                    "{title}{}  {}\n{}\n",
                    yellow(S_BAR()),
                    self.rows(&yellow(S_BAR())),
                    footer.join("\n")
                )
            }
            _ => format!(
                "{title}{}  {}\n{}\n",
                cyan(S_BAR()),
                self.rows(&cyan(S_BAR())),
                cyan(S_BAR_END())
            ),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_long_lists_like_limit_options() {
        // Ten rows (non-terminal output) leave room for 6 items.
        let items: Vec<usize> = (0..20).collect();
        let at = |cursor| {
            window(&items, cursor, Some(7), 10, |item, active| {
                format!("{}{item}", if active { ">" } else { "" })
            })
        };
        let plain = |rows: Vec<String>| {
            rows.into_iter()
                .map(|row| super::super::wrap::strip(&row).into_owned())
                .collect::<Vec<_>>()
        };
        assert_eq!(plain(at(0)), [">0", "1", "2", "3", "4", "..."]);
        assert_eq!(plain(at(3)), ["0", "1", "2", ">3", "4", "..."]);
        assert_eq!(plain(at(4)), ["...", "2", "3", ">4", "5", "..."]);
        assert_eq!(plain(at(19)), ["...", "15", "16", "17", "18", ">19"]);
    }
}
