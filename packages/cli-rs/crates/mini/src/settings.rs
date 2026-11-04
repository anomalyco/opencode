//! Mini settings (`mini.*` in `cli.json`, `runtime.boot.ts:resolveMiniSettings`). M.1 resolves them at start;
//! the `/settings` panel and verbosity presets that change them are M.4's.

use opencode_local::cli_config::{Mini, MiniWorkSpinner, Visibility};

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
}
