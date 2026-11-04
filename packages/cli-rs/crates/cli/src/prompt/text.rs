//! `text` and `password` (`@clack/prompts` `text.ts`, `password.ts` on `@clack/core`'s
//! `TextPrompt` and `PasswordPrompt`).

use super::core::{self, Base, Prompt};
use super::style::{
    S_BAR, S_BAR_END, S_PASSWORD_MASK, cyan, dim, gray, hidden, inverse, strikethrough, symbol,
    yellow,
};
use super::{Cancelled, Output, State, Validate};

/// A line of text. Enter submits; an empty answer becomes the default value, else `""`.
pub struct Text<'a> {
    message: String,
    placeholder: Option<String>,
    default_value: Option<String>,
    initial_value: Option<String>,
    validate: Option<Validate<'a, str>>,
}

pub fn text(message: impl Into<String>) -> Text<'static> {
    Text {
        message: message.into(),
        placeholder: None,
        default_value: None,
        initial_value: None,
        validate: None,
    }
}

impl<'a> Text<'a> {
    /// Shown dim while the input is empty; it is not a value.
    pub fn placeholder(mut self, placeholder: impl Into<String>) -> Self {
        self.placeholder = Some(placeholder.into());
        self
    }

    #[allow(dead_code, reason = "only opencode-prompt-demo uses it")]
    /// The answer when the input is empty on submit.
    pub fn default_value(mut self, value: impl Into<String>) -> Self {
        self.default_value = Some(value.into());
        self
    }

    /// Text already in the input, which the user can edit.
    pub fn initial_value(mut self, value: impl Into<String>) -> Self {
        self.initial_value = Some(value.into());
        self
    }

    /// Returns the problem with an answer; the prompt stays open until there is none. An untouched
    /// input is validated as `""`.
    pub fn validate<'b>(self, validate: impl Fn(&str) -> Option<String> + 'b) -> Text<'b>
    where
        'a: 'b,
    {
        Text {
            validate: Some(Box::new(validate)),
            ..self
        }
    }

    pub fn prompt(self) -> Result<String, Cancelled> {
        let initial = self.initial_value.clone();
        let mut prompt = TextPrompt {
            options: self,
            value: None,
        };
        core::run(&mut prompt, Output::Stdout, initial.as_deref())?;
        Ok(prompt.value.unwrap_or_default())
    }
}

struct TextPrompt<'a> {
    options: Text<'a>,
    value: Option<String>,
}

impl Prompt for TextPrompt<'_> {
    fn track(&self) -> bool {
        true
    }

    fn user_input(&mut self, base: &mut Base) {
        self.value = Some(base.user_input.clone());
    }

    fn finalize(&mut self, _base: &mut Base) {
        if self.value.as_deref().is_none_or(str::is_empty) {
            self.value = self.options.default_value.clone();
        }
        if self.value.is_none() {
            self.value = Some(String::new());
        }
    }

    fn validate(&self, _base: &Base) -> Option<String> {
        self.options
            .validate
            .as_ref()
            .and_then(|validate| validate(self.value.as_deref().unwrap_or("")))
    }

    fn render(&self, base: &Base) -> String {
        let title = format!(
            "{}\n{}  {}\n",
            gray(S_BAR()),
            symbol(base.state),
            self.options.message
        );
        let placeholder = match self.options.placeholder.as_deref() {
            Some(placeholder) if !placeholder.is_empty() => {
                let split = placeholder.chars().next().map_or(0, char::len_utf8);
                inverse(&placeholder[..split]) + &dim(&placeholder[split..])
            }
            _ => inverse(&hidden("_")),
        };
        let input = if base.user_input.is_empty() {
            placeholder
        } else {
            with_cursor(base)
        };
        let value = self.value.as_deref().unwrap_or("");
        match base.state {
            State::Error => format!(
                "{}\n{}  {input}\n{}  {}\n",
                title.trim(),
                yellow(S_BAR()),
                yellow(S_BAR_END()),
                yellow(&base.error)
            ),
            State::Submit => format!("{title}{}  {}", gray(S_BAR()), dim(value)),
            State::Cancel => format!(
                "{title}{}  {}{}",
                gray(S_BAR()),
                strikethrough(&dim(value)),
                if value.trim().is_empty() {
                    String::new()
                } else {
                    format!("\n{}", gray(S_BAR()))
                }
            ),
            _ => format!("{title}{}  {input}\n{}\n", cyan(S_BAR()), cyan(S_BAR_END())),
        }
    }
}

/// `TextPrompt.userInputWithCursor`: a block at the end, or the character under the cursor inverted.
pub fn with_cursor(base: &Base) -> String {
    if base.state == State::Submit {
        return base.user_input.clone();
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

/// Hidden input shown as one mask character per character.
pub struct Password<'a> {
    message: String,
    validate: Option<Validate<'a, str>>,
}

pub fn password(message: impl Into<String>) -> Password<'static> {
    Password {
        message: message.into(),
        validate: None,
    }
}

impl<'a> Password<'a> {
    pub fn validate<'b>(self, validate: impl Fn(&str) -> Option<String> + 'b) -> Password<'b>
    where
        'a: 'b,
    {
        Password {
            validate: Some(Box::new(validate)),
            ..self
        }
    }

    pub fn prompt(self) -> Result<String, Cancelled> {
        let mut prompt = PasswordPrompt {
            options: self,
            value: String::new(),
        };
        core::run(&mut prompt, Output::Stdout, None)?;
        Ok(prompt.value)
    }
}

struct PasswordPrompt<'a> {
    options: Password<'a>,
    value: String,
}

impl PasswordPrompt<'_> {
    /// `userInput.replaceAll(/./g, mask)`: line terminators stay as they are.
    fn masked(&self, base: &Base) -> String {
        let mask = S_PASSWORD_MASK();
        base.user_input
            .chars()
            .map(|char| {
                if matches!(char, '\n' | '\r' | '\u{2028}' | '\u{2029}') {
                    char.to_string()
                } else {
                    mask.to_string()
                }
            })
            .collect()
    }

    fn with_cursor(&self, base: &Base) -> String {
        let masked = self.masked(base);
        if matches!(base.state, State::Submit | State::Cancel) {
            return masked;
        }
        if base.cursor >= base.user_input.chars().count() {
            return format!("{masked}{}", inverse(&hidden("_")));
        }
        let chars: Vec<char> = masked.chars().collect();
        let cursor = base.cursor;
        let before: String = chars[..cursor].iter().collect();
        let after: String = chars[cursor + 1..].iter().collect();
        format!("{before}{}{after}", inverse(&chars[cursor].to_string()))
    }
}

impl Prompt for PasswordPrompt<'_> {
    fn track(&self) -> bool {
        true
    }

    fn user_input(&mut self, base: &mut Base) {
        self.value = base.user_input.clone();
    }

    fn validate(&self, _base: &Base) -> Option<String> {
        self.options
            .validate
            .as_ref()
            .and_then(|validate| validate(&self.value))
    }

    fn render(&self, base: &Base) -> String {
        let title = format!(
            "{}\n{}  {}\n",
            gray(S_BAR()),
            symbol(base.state),
            self.options.message
        );
        let masked = self.masked(base);
        match base.state {
            State::Error => format!(
                "{}\n{}  {masked}\n{}  {}\n",
                title.trim(),
                yellow(S_BAR()),
                yellow(S_BAR_END()),
                yellow(&base.error)
            ),
            State::Submit => format!("{title}{}  {}", gray(S_BAR()), dim(&masked)),
            State::Cancel => format!(
                "{title}{}  {}{}",
                gray(S_BAR()),
                strikethrough(&dim(&masked)),
                if masked.is_empty() {
                    String::new()
                } else {
                    format!("\n{}", gray(S_BAR()))
                }
            ),
            _ => format!(
                "{title}{}  {}\n{}\n",
                cyan(S_BAR()),
                self.with_cursor(base),
                cyan(S_BAR_END())
            ),
        }
    }
}
