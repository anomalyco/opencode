//! `autocomplete` (`@clack/prompts` `autocomplete.ts` on `@clack/core`'s `AutocompletePrompt`), single
//! value only. A custom `render` covers pickers like `packages/cli/src/ui/integration-picker.ts`.

use super::core::{self, Base, Prompt};
use super::select::{Choice, limit_options};
use super::style::{
    S_BAR, S_BAR_END, S_RADIO_ACTIVE, S_RADIO_INACTIVE, cyan, dim, gray, green, hidden, inverse,
    strikethrough, symbol, yellow,
};
use super::{Cancelled, Output, State, Validate};

type Filter<'a, T> = Box<dyn Fn(&str, &Choice<T>) -> bool + 'a>;
type Render<'a, T> = Box<dyn Fn(&View<'_, T>) -> String + 'a>;

/// A list filtered by typing. Arrows move; typing filters; Enter submits the focused option.
pub struct Autocomplete<'a, T> {
    message: String,
    options: Vec<Choice<T>>,
    placeholder: Option<String>,
    initial_value: Option<T>,
    initial_user_input: Option<String>,
    max_items: Option<usize>,
    validate: Option<Validate<'a, Option<T>>>,
    filter: Option<Filter<'a, T>>,
    render: Option<Render<'a, T>>,
    output: Output,
}

pub fn autocomplete<T: Clone + PartialEq + ToString>(
    message: impl Into<String>,
    options: Vec<Choice<T>>,
) -> Autocomplete<'static, T> {
    Autocomplete {
        message: message.into(),
        options,
        placeholder: None,
        initial_value: None,
        initial_user_input: None,
        max_items: None,
        validate: None,
        filter: None,
        render: None,
        output: Output::Stdout,
    }
}

/// What a custom `render` sees, as the `this` of a Clack `render`.
pub struct View<'v, T> {
    pub state: State,
    pub error: &'v str,
    pub user_input: &'v str,
    /// The input with its cursor drawn in.
    pub user_input_with_cursor: String,
    /// Set by the first arrow key; typing does not clear it.
    pub is_navigating: bool,
    /// The focused row in `filtered`.
    pub cursor: usize,
    pub filtered: Vec<&'v Choice<T>>,
    /// The submitted option, once there is one.
    pub value: Option<&'v Choice<T>>,
}

impl<'a, T: Clone + PartialEq + ToString> Autocomplete<'a, T> {
    /// Shown instead of the search text. Clack shows it for as long as nothing is submitted.
    pub fn placeholder(mut self, placeholder: impl Into<String>) -> Self {
        self.placeholder = Some(placeholder.into());
        self
    }

    pub fn initial_value(mut self, value: T) -> Self {
        self.initial_value = Some(value);
        self
    }

    pub fn initial_user_input(mut self, input: impl Into<String>) -> Self {
        self.initial_user_input = Some(input.into());
        self
    }

    pub fn max_items(mut self, items: usize) -> Self {
        self.max_items = Some(items);
        self
    }

    pub fn output(mut self, output: Output) -> Self {
        self.output = output;
        self
    }

    /// Checks the focused value on Enter; `None` when no option matches the search.
    pub fn validate<'b>(
        self,
        validate: impl Fn(&Option<T>) -> Option<String> + 'b,
    ) -> Autocomplete<'b, T>
    where
        'a: 'b,
    {
        Autocomplete {
            validate: Some(Box::new(validate)),
            ..self
        }
    }

    /// Replaces the default filter, which matches the label, hint, or value, ignoring case.
    pub fn filter<'b>(self, filter: impl Fn(&str, &Choice<T>) -> bool + 'b) -> Autocomplete<'b, T>
    where
        'a: 'b,
    {
        Autocomplete {
            filter: Some(Box::new(filter)),
            ..self
        }
    }

    /// Replaces the frame Clack's `autocomplete` draws.
    pub fn render<'b>(self, render: impl Fn(&View<'_, T>) -> String + 'b) -> Autocomplete<'b, T>
    where
        'a: 'b,
    {
        Autocomplete {
            render: Some(Box::new(render)),
            ..self
        }
    }

    /// The focused option on Enter, `None` when nothing matched the search.
    pub fn prompt(self) -> Result<Option<T>, Cancelled> {
        let initial = self
            .initial_value
            .clone()
            .or_else(|| self.options.first().map(|option| option.value.clone()));
        let cursor =
            initial.and_then(|value| self.options.iter().position(|option| option.value == value));
        let input = self.initial_user_input.clone();
        let output = self.output;
        let mut prompt = AutocompletePrompt {
            filtered: (0..self.options.len()).collect(),
            selected: cursor.map(|cursor| vec![Some(cursor)]).unwrap_or_default(),
            focused: self
                .options
                .get(cursor.unwrap_or(0))
                .map(|_| cursor.unwrap_or(0)),
            cursor: cursor.unwrap_or(0),
            navigating: false,
            last_input: String::new(),
            value: None,
            options: self,
        };
        core::run(&mut prompt, output, input.as_deref())?;
        Ok(prompt
            .value
            .flatten()
            .map(|index| prompt.options.options[index].value.clone()))
    }
}

/// Options are kept by index; Clack compares values, which is the same for distinct values.
struct AutocompletePrompt<'a, T> {
    options: Autocomplete<'a, T>,
    filtered: Vec<usize>,
    selected: Vec<Option<usize>>,
    focused: Option<usize>,
    cursor: usize,
    navigating: bool,
    last_input: String,
    /// Set on Enter: the first selected option, which is `Some(None)` when nothing was focused.
    value: Option<Option<usize>>,
}

impl<T: Clone + PartialEq + ToString> AutocompletePrompt<'_, T> {
    fn matches(&self, search: &str, option: &Choice<T>) -> bool {
        if let Some(filter) = &self.options.filter {
            return filter(search, option);
        }
        let term = search.to_lowercase();
        search.is_empty()
            || option.label.to_lowercase().contains(&term)
            || option
                .hint
                .as_deref()
                .unwrap_or("")
                .to_lowercase()
                .contains(&term)
            || option.value.to_string().to_lowercase().contains(&term)
    }

    fn user_input_with_cursor(base: &Base) -> String {
        if base.user_input.is_empty() {
            return inverse(&hidden("_"));
        }
        let chars: Vec<char> = base.user_input.chars().collect();
        if base.cursor >= chars.len() {
            return format!("{}█", base.user_input);
        }
        let before: String = chars[..base.cursor].iter().collect();
        let after: String = chars[base.cursor + 1..].iter().collect();
        format!(
            "{before}{}{after}",
            inverse(&chars[base.cursor].to_string())
        )
    }

    fn view<'v>(&'v self, base: &'v Base) -> View<'v, T> {
        View {
            state: base.state,
            error: &base.error,
            user_input: &base.user_input,
            user_input_with_cursor: Self::user_input_with_cursor(base),
            is_navigating: self.navigating,
            cursor: self.cursor,
            filtered: self
                .filtered
                .iter()
                .map(|index| &self.options.options[*index])
                .collect(),
            value: self
                .value
                .flatten()
                .map(|index| &self.options.options[index]),
        }
    }
}

impl<T: Clone + PartialEq + ToString> Prompt for AutocompletePrompt<'_, T> {
    fn track(&self) -> bool {
        true
    }

    fn user_input(&mut self, base: &mut Base) {
        if base.user_input == self.last_input {
            return;
        }
        self.last_input = base.user_input.clone();
        self.filtered = (0..self.options.options.len())
            .filter(|index| {
                base.user_input.is_empty()
                    || self.matches(&base.user_input, &self.options.options[*index])
            })
            .collect();
        self.cursor = self
            .focused
            .and_then(|focused| self.filtered.iter().position(|index| *index == focused))
            .unwrap_or(0);
        self.focused = self.filtered.get(self.cursor).copied();
        self.selected = self
            .focused
            .map(|focused| vec![Some(focused)])
            .unwrap_or_default();
    }

    fn key(&mut self, _char: Option<&str>, key: &super::term::Key, _base: &mut Base) {
        if key.is("up") || key.is("down") {
            let last = self.filtered.len() as i64 - 1;
            let next = self.cursor as i64 + if key.is("up") { -1 } else { 1 };
            self.cursor = next.min(last).max(0) as usize;
            self.focused = self.filtered.get(self.cursor).copied();
            self.selected = vec![self.focused];
            self.navigating = true;
            return;
        }
        if key.is("return") {
            self.value = Some(self.selected.first().copied().flatten());
            return;
        }
        if let Some(focused) = self.focused {
            self.selected = vec![Some(focused)];
        }
    }

    fn validate(&self, _base: &Base) -> Option<String> {
        let value = self
            .value
            .flatten()
            .map(|index| self.options.options[index].value.clone());
        self.options
            .validate
            .as_ref()
            .and_then(|validate| validate(&value))
    }

    fn render(&self, base: &Base) -> String {
        if let Some(render) = &self.options.render {
            return render(&self.view(base));
        }
        let title = format!(
            "{}\n{}  {}\n",
            gray(S_BAR()),
            symbol(base.state),
            self.options.message
        );
        match base.state {
            State::Submit => {
                let labels: Vec<&str> = self
                    .options
                    .options
                    .iter()
                    .enumerate()
                    .filter(|(index, _)| self.selected.contains(&Some(*index)))
                    .map(|(_, option)| option.label.as_str())
                    .collect();
                format!("{title}{}  {}", gray(S_BAR()), dim(&labels.join(", ")))
            }
            State::Cancel => format!(
                "{title}{}  {}",
                gray(S_BAR()),
                strikethrough(&dim(&base.user_input))
            ),
            _ => {
                // Clack compares `String(this.value ?? "")`, which stays empty until Enter.
                let placeholder = self
                    .options
                    .placeholder
                    .as_deref()
                    .filter(|_| self.value.flatten().is_none());
                let search = match placeholder {
                    Some(placeholder) => dim(placeholder),
                    None if self.navigating => dim(&base.user_input),
                    None => Self::user_input_with_cursor(base),
                };
                let count = self.filtered.len();
                let matches = if count != self.options.options.len() {
                    dim(&format!(
                        " ({count} match{})",
                        if count == 1 { "" } else { "es" }
                    ))
                } else {
                    String::new()
                };
                let filtered: Vec<usize> = self.filtered.clone();
                let rows = if filtered.is_empty() {
                    Vec::new()
                } else {
                    limit_options(
                        &filtered,
                        self.cursor,
                        self.options.max_items,
                        self.options.output,
                        |index, active| {
                            let option = &self.options.options[*index];
                            let hint = match &option.hint {
                                Some(hint) if self.focused == Some(*index) => {
                                    dim(&format!(" ({hint})"))
                                }
                                _ => String::new(),
                            };
                            if active {
                                format!("{} {}{hint}", green(S_RADIO_ACTIVE()), option.label)
                            } else {
                                format!("{} {}{hint}", dim(S_RADIO_INACTIVE()), dim(&option.label))
                            }
                        },
                    )
                };
                let instructions = [
                    format!("{} to select", dim("↑/↓")),
                    format!("{} confirm", dim("Enter:")),
                    format!("{} to search", dim("Type:")),
                ];
                let mut lines = vec![
                    title,
                    format!("{}  {} {search}{matches}", cyan(S_BAR()), dim("Search:")),
                ];
                if filtered.is_empty() && !base.user_input.is_empty() {
                    lines.push(format!("{}  {}", cyan(S_BAR()), yellow("No matches found")));
                }
                if base.state == State::Error {
                    lines.push(format!("{}  {}", yellow(S_BAR()), yellow(&base.error)));
                }
                lines.extend(
                    rows.into_iter()
                        .map(|row| format!("{}  {row}", cyan(S_BAR()))),
                );
                lines.push(format!(
                    "{}  {}",
                    cyan(S_BAR()),
                    dim(&instructions.join(" • "))
                ));
                lines.push(cyan(S_BAR_END()));
                lines.join("\n")
            }
        }
    }
}
