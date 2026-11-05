//! Mini settings (`mini.*` in `cli.json`, `runtime.boot.ts:resolveMiniSettings`) and the changes the `/settings`
//! panel makes, with the verbosity presets of `verbosity.ts`.

use opencode_local::cli_config::{Info, Mini, MiniWorkSpinner, Visibility};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MiniSettings {
    pub thinking: Visibility,
    pub tools: Visibility,
    pub shell_output: Visibility,
    pub turn_summary: Visibility,
    pub footer: Visibility,
    pub splash: Visibility,
    pub work_spinner: MiniWorkSpinner,
    pub mono: bool,
}

impl MiniSettings {
    /// `resolveMiniSettings`: the configured values with mini's defaults.
    pub fn resolve(mini: Option<&Mini>) -> Self {
        let mini = mini.cloned().unwrap_or_default();
        Self {
            thinking: mini.thinking.unwrap_or(Visibility::Show),
            tools: mini.tools.unwrap_or(Visibility::Hide),
            shell_output: mini.shell_output.unwrap_or(Visibility::Hide),
            turn_summary: mini.turn_summary.unwrap_or(Visibility::Show),
            footer: mini.footer.unwrap_or(Visibility::Show),
            splash: mini.splash.unwrap_or(Visibility::Show),
            work_spinner: mini.work_spinner.unwrap_or(MiniWorkSpinner::BlockSoftSlide),
            mono: mini.mono.unwrap_or(false),
        }
    }
}

/// A setting the panel changes (`MiniSettingChange["key"]`).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Key {
    Verbosity,
    Thinking,
    Tools,
    ShellOutput,
    TurnSummary,
    Footer,
    Splash,
    Mono,
    WorkSpinner,
}

/// `MiniVerbosity`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Verbosity {
    Quiet,
    Default,
    Everything,
}

const LEVELS: [Verbosity; 3] = [Verbosity::Quiet, Verbosity::Default, Verbosity::Everything];

/// `MiniSettingChange`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Change {
    Verbosity(Verbosity),
    Visibility(Key, Visibility),
    Mono(bool),
    WorkSpinner(MiniWorkSpinner),
}

impl Verbosity {
    /// `verbosityPreset`: thinking, tools, shell output, turn summary, and footer.
    fn preset(self) -> [Visibility; 5] {
        use Visibility::{Hide, Show};
        match self {
            Self::Quiet => [Hide; 5],
            Self::Default => [Show, Hide, Hide, Show, Show],
            Self::Everything => [Show; 5],
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Quiet => "Quiet",
            Self::Default => "Default",
            Self::Everything => "Everything",
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Quiet => "quiet",
            Self::Default => "default",
            Self::Everything => "everything",
        }
    }
}

impl MiniSettings {
    fn knobs(&self) -> [Visibility; 5] {
        [self.thinking, self.tools, self.shell_output, self.turn_summary, self.footer]
    }

    pub fn visibility(&self, key: Key) -> Option<Visibility> {
        Some(match key {
            Key::Thinking => self.thinking,
            Key::Tools => self.tools,
            Key::ShellOutput => self.shell_output,
            Key::TurnSummary => self.turn_summary,
            Key::Footer => self.footer,
            Key::Splash => self.splash,
            _ => return None,
        })
    }

    /// `matchMiniVerbosity`: the preset the knobs match, else `None` for custom.
    pub fn verbosity(&self) -> Option<Verbosity> {
        LEVELS.into_iter().find(|level| level.preset() == self.knobs())
    }

    /// `verbosityLabel(matchMiniVerbosity(settings))`.
    pub fn verbosity_label(&self) -> &'static str {
        self.verbosity().map_or("Custom", Verbosity::label)
    }

    /// `verbosityChange`: the next preset in `direction`, or `None` at either end.
    pub fn verbosity_change(&self, forward: bool) -> Option<Change> {
        let index = match self.verbosity() {
            Some(level) => LEVELS.iter().position(|item| *item == level).unwrap_or(0),
            // `nearestMiniVerbosity`: the preset with the fewest differing knobs, the first on a tie.
            None => (0..LEVELS.len())
                .min_by_key(|index| LEVELS[*index].preset().iter().zip(self.knobs()).filter(|(a, b)| **a != *b).count())
                .unwrap_or(0),
        };
        let next = if forward { (index + 1).min(LEVELS.len() - 1) } else { index.saturating_sub(1) };
        let value = LEVELS[next];
        (self.verbosity() != Some(value)).then_some(Change::Verbosity(value))
    }

    /// The change Enter or a left/right key makes to `key`.
    pub fn change(&self, key: Key, forward: bool) -> Option<Change> {
        let flip = |value| if value == Visibility::Show { Visibility::Hide } else { Visibility::Show };
        match key {
            Key::Verbosity => self.verbosity_change(forward),
            Key::Mono => Some(Change::Mono(!self.mono)),
            Key::WorkSpinner => {
                let names = &opencode_ui::motion::WORK_SPINNER_NAMES;
                let index = names.iter().position(|name| *name == self.work_spinner.as_str()).unwrap_or(0);
                let next = if forward { (index + 1) % names.len() } else { (index + names.len() - 1) % names.len() };
                spinner(names[next]).map(Change::WorkSpinner)
            }
            key => Some(Change::Visibility(key, flip(self.visibility(key)?))),
        }
    }

    /// `applyMiniSettingChange`.
    pub fn apply(mut self, change: Change) -> Self {
        match change {
            Change::Verbosity(level) => {
                [self.thinking, self.tools, self.shell_output, self.turn_summary, self.footer] = level.preset();
            }
            Change::Visibility(key, value) => match key {
                Key::Thinking => self.thinking = value,
                Key::Tools => self.tools = value,
                Key::ShellOutput => self.shell_output = value,
                Key::TurnSummary => self.turn_summary = value,
                Key::Footer => self.footer = value,
                Key::Splash => self.splash = value,
                _ => {}
            },
            Change::Mono(mono) => self.mono = mono,
            Change::WorkSpinner(spinner) => self.work_spinner = spinner,
        }
        self
    }
}

/// Writes only what `change` touches into `info.mini` (`config.update`'s draft).
pub fn write_change(info: &mut Info, change: Change) {
    let mini = info.mini.get_or_insert_with(Mini::default);
    match change {
        Change::Verbosity(level) => {
            let [thinking, tools, shell_output, turn_summary, footer] = level.preset();
            mini.thinking = Some(thinking);
            mini.tools = Some(tools);
            mini.shell_output = Some(shell_output);
            mini.turn_summary = Some(turn_summary);
            mini.footer = Some(footer);
        }
        Change::Visibility(key, value) => match key {
            Key::Thinking => mini.thinking = Some(value),
            Key::Tools => mini.tools = Some(value),
            Key::ShellOutput => mini.shell_output = Some(value),
            Key::TurnSummary => mini.turn_summary = Some(value),
            Key::Footer => mini.footer = Some(value),
            Key::Splash => mini.splash = Some(value),
            _ => {}
        },
        Change::Mono(mono) => mini.mono = Some(mono),
        Change::WorkSpinner(spinner) => mini.work_spinner = Some(spinner),
    }
}

/// The `work_spinner` value of a name.
pub fn spinner(name: &str) -> Option<MiniWorkSpinner> {
    use opencode_local::cli_config::Decode;
    MiniWorkSpinner::decode(&serde_json::Value::String(name.to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_resolve_mini_settings() {
        let settings = MiniSettings::resolve(None);
        assert_eq!(settings.thinking, Visibility::Show);
        assert_eq!(settings.tools, Visibility::Hide);
        assert_eq!(settings.splash, Visibility::Show);
        assert!(!settings.mono);
        let mono = MiniSettings::resolve(Some(&Mini {
            mono: Some(true),
            thinking: Some(Visibility::Hide),
            ..Mini::default()
        }));
        assert!(mono.mono);
        assert_eq!(mono.thinking, Visibility::Hide);
    }

    #[test]
    fn verbosity_presets_match_and_cycle_like_verbosity_ts() {
        let settings = MiniSettings::resolve(None);
        assert_eq!(settings.verbosity(), Some(Verbosity::Default));
        assert_eq!(settings.verbosity_change(true), Some(Change::Verbosity(Verbosity::Everything)));
        let everything = settings.apply(Change::Verbosity(Verbosity::Everything));
        assert_eq!(everything.tools, Visibility::Show);
        assert_eq!(everything.verbosity_change(true), None, "the last preset stays");
        let custom = settings.apply(Change::Visibility(Key::Tools, Visibility::Show));
        assert_eq!(custom.verbosity_label(), "Custom");
        // Nearest is Default (one knob off), so forward goes to Everything.
        assert_eq!(custom.verbosity_change(true), Some(Change::Verbosity(Verbosity::Everything)));
        assert_eq!(
            settings.change(Key::WorkSpinner, false),
            Some(Change::WorkSpinner(MiniWorkSpinner::Seed)),
            "spinners wrap around"
        );
        assert_eq!(settings.change(Key::Thinking, true), Some(Change::Visibility(Key::Thinking, Visibility::Hide)));
    }
}
