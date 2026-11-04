//! `confirm` (`@clack/prompts` `confirm.ts` on `@clack/core`'s `ConfirmPrompt`).

use super::core::{self, Base, Prompt, move_cursor};
use super::style::{
    S_BAR, S_BAR_END, S_RADIO_ACTIVE, S_RADIO_INACTIVE, cyan, dim, gray, green, strikethrough,
    symbol,
};
use super::{Cancelled, Output, State};

/// Yes or no. Y and N answer at once; every movement key, Space included, flips the answer.
pub struct Confirm {
    message: String,
    active: String,
    inactive: String,
    initial_value: bool,
    output: Output,
}

pub fn confirm(message: impl Into<String>) -> Confirm {
    Confirm {
        message: message.into(),
        active: "Yes".to_string(),
        inactive: "No".to_string(),
        initial_value: true,
        output: Output::Stdout,
    }
}

impl Confirm {
    /// The label of `true` (default "Yes").
    pub fn active(mut self, label: impl Into<String>) -> Self {
        self.active = label.into();
        self
    }

    /// The label of `false` (default "No").
    pub fn inactive(mut self, label: impl Into<String>) -> Self {
        self.inactive = label.into();
        self
    }

    /// The answer selected first (default `true`).
    pub fn initial_value(mut self, value: bool) -> Self {
        self.initial_value = value;
        self
    }

    pub fn output(mut self, output: Output) -> Self {
        self.output = output;
        self
    }

    pub fn prompt(self) -> Result<bool, Cancelled> {
        let output = self.output;
        let mut prompt = ConfirmPrompt {
            value: self.initial_value,
            options: self,
        };
        core::run(&mut prompt, output, None)?;
        Ok(prompt.value)
    }
}

struct ConfirmPrompt {
    options: Confirm,
    value: bool,
}

impl Prompt for ConfirmPrompt {
    fn track(&self) -> bool {
        false
    }

    fn cursor(&mut self, _action: &str, _base: &mut Base) {
        self.value = !self.value;
    }

    fn confirm(&mut self, yes: bool, base: &mut Base) {
        // Clack closes here and once more after rendering, so it moves up to make up for one newline.
        base.write(&move_cursor(0, -1));
        self.value = yes;
        base.state = State::Submit;
        base.close();
    }

    fn render(&self, base: &Base) -> String {
        let title = format!(
            "{}\n{}  {}\n",
            gray(S_BAR()),
            symbol(base.state),
            self.options.message
        );
        let (active, inactive) = (&self.options.active, &self.options.inactive);
        let value = if self.value { active } else { inactive };
        match base.state {
            State::Submit => format!("{title}{}  {}", gray(S_BAR()), dim(value)),
            State::Cancel => format!(
                "{title}{}  {}\n{}",
                gray(S_BAR()),
                strikethrough(&dim(value)),
                gray(S_BAR())
            ),
            _ => {
                let choice = |selected: bool, label: &str| {
                    if selected {
                        format!("{} {label}", green(S_RADIO_ACTIVE()))
                    } else {
                        format!("{} {}", dim(S_RADIO_INACTIVE()), dim(label))
                    }
                };
                format!(
                    "{title}{}  {} {} {}\n{}\n",
                    cyan(S_BAR()),
                    choice(self.value, active),
                    dim("/"),
                    choice(!self.value, inactive),
                    cyan(S_BAR_END())
                )
            }
        }
    }
}
