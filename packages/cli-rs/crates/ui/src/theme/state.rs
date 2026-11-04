//! The TUI's theme state (`packages/tui/src/context/theme.tsx`): the active theme, the dark or light mode and its
//! lock, the terminal palette behind `system`, and fallback to `opencode` when a theme fails to load.
//!
//! The state does no I/O. Methods queue [`Effect`]s (config writes, palette probes, the palette cache) and failed
//! loads queue a [`ThemeError`]; the owner drains both after each call and carries them out.

use indexmap::IndexMap;
use serde_json::Value;

use super::system::generate_system;
use super::{Catalog, TerminalColors, Theme, ThemeMode, terminal_mode};

/// `theme.mode` in `cli.json`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ModeSetting {
    Dark,
    Light,
    /// Follow the terminal.
    System,
}

impl ModeSetting {
    /// The `cli.json` value; anything other than `dark`, `light`, or `system` is `None`.
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "dark" => Some(Self::Dark),
            "light" => Some(Self::Light),
            "system" => Some(Self::System),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Dark => "dark",
            Self::Light => "light",
            Self::System => "system",
        }
    }

    fn lock(self) -> Option<ThemeMode> {
        match self {
            Self::Dark => Some(ThemeMode::Dark),
            Self::Light => Some(ThemeMode::Light),
            Self::System => None,
        }
    }

    fn from_lock(lock: Option<ThemeMode>) -> Self {
        match lock {
            Some(ThemeMode::Dark) => Self::Dark,
            Some(ThemeMode::Light) => Self::Light,
            None => Self::System,
        }
    }
}

/// Work the owner of a [`ThemeState`] carries out.
#[derive(Clone, Debug, PartialEq)]
pub enum Effect {
    /// Write `theme.name` to `cli.json`.
    PersistName(String),
    /// Write `theme.mode` to `cli.json`.
    PersistMode(ModeSetting),
    /// Ask the terminal for its palette (`getPalette({ size: 16 })`) and pass a usable answer to
    /// [`ThemeState::palette`]. Queued only while `system` is active. The owner probes after the first paint and runs
    /// one probe at a time, repeating once when another request arrived meanwhile.
    ProbePalette,
    /// Store the palette under the `system-theme` storage key as `{ colors }`.
    CachePalette(TerminalColors),
}

/// A theme that failed to load: the theme-error toast shows `Failed to load theme: {name}` and the message.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ThemeError {
    pub name: String,
    pub message: String,
}

/// What the TUI knows when the theme state starts.
#[derive(Clone, Debug)]
pub struct ThemeStateOptions {
    /// `theme.name` from `cli.json`.
    pub name: Option<String>,
    /// `theme.mode` from `cli.json`.
    pub mode: Option<ModeSetting>,
    /// The mode the terminal reported, if any.
    pub terminal: Option<ThemeMode>,
    /// The mode to use when neither config nor terminal decides.
    pub fallback: ThemeMode,
    /// The palette cached under `system-theme`, if any.
    pub palette: Option<TerminalColors>,
    /// Whether the `new-designs` experiment is on.
    pub new_designs: bool,
}

pub struct ThemeState {
    catalog: Catalog,
    mode: ThemeMode,
    lock: Option<ThemeMode>,
    active: String,
    terminal: Option<ThemeMode>,
    palette: Option<TerminalColors>,
    new_designs: bool,
    current: super::Loaded,
    effects: Vec<Effect>,
    error: Option<ThemeError>,
}

impl ThemeState {
    pub fn new(options: ThemeStateOptions) -> Self {
        let lock = options.mode.and_then(ModeSetting::lock);
        let mut mode = lock.or(options.terminal).unwrap_or(options.fallback);
        let palette = options.palette.filter(TerminalColors::usable);
        if let Some(palette) = &palette {
            mode = lock.or_else(|| terminal_mode(palette)).unwrap_or(mode);
        }
        let catalog = Catalog::default();
        let current = catalog
            .load("opencode", mode, options.new_designs)
            .expect("the built-in opencode theme loads");
        let mut state = Self {
            catalog,
            mode,
            lock,
            active: options.name.unwrap_or_else(|| "opencode".to_owned()),
            terminal: options.terminal,
            palette,
            new_designs: options.new_designs,
            current,
            effects: Vec::new(),
            error: None,
        };
        state.apply_palette();
        state.refresh_palette();
        state
    }

    /// The resolved theme on the page surface.
    pub fn theme(&self) -> &Theme {
        &self.current.theme
    }

    /// The configured theme name, which may differ from the loaded one until a failed theme falls back.
    pub fn selected(&self) -> &str {
        &self.active
    }

    /// The mode the current theme resolved in.
    pub fn mode(&self) -> ThemeMode {
        self.current.mode
    }

    /// The modes the current theme supports.
    pub fn modes(&self) -> &[ThemeMode] {
        &self.current.modes
    }

    pub fn supports(&self, mode: ThemeMode) -> bool {
        self.current.modes.contains(&mode)
    }

    pub fn locked(&self) -> bool {
        self.lock.is_some()
    }

    /// Theme names in list order.
    pub fn names(&self) -> Vec<String> {
        self.catalog.names(self.new_designs)
    }

    pub fn has(&self, name: &str) -> bool {
        self.catalog.has(name, self.new_designs)
    }

    /// Switches to `name` and persists it; false when no such theme exists.
    pub fn set(&mut self, name: &str) -> bool {
        if !self.has(name) {
            return false;
        }
        self.active = name.to_owned();
        self.refresh_palette();
        self.effects.push(Effect::PersistName(name.to_owned()));
        self.reload();
        true
    }

    /// Locks `mode` (the current mode when `None`); false when the theme does not support it.
    pub fn set_mode(&mut self, mode: Option<ThemeMode>, persist: bool) -> bool {
        let mode = mode.unwrap_or(self.current.mode);
        if !self.supports(mode) {
            return false;
        }
        self.pin(mode, persist);
        true
    }

    /// Locks the current mode and persists it.
    pub fn lock(&mut self) {
        self.pin(self.current.mode, true);
    }

    /// Follows the terminal again and persists `system`.
    pub fn unlock(&mut self) {
        self.free(true);
    }

    /// The terminal reported a mode change; ignored while the mode is locked.
    pub fn terminal_mode(&mut self, mode: ThemeMode) {
        self.terminal = Some(mode);
        if self.lock.is_none() {
            self.apply(mode);
        }
    }

    /// The terminal answered a palette probe. Unusable answers are ignored.
    pub fn palette(&mut self, colors: TerminalColors) {
        if !colors.usable() {
            return;
        }
        let mode = self
            .lock
            .or_else(|| terminal_mode(&colors))
            .unwrap_or(self.mode);
        self.palette = Some(colors.clone());
        self.mode = mode;
        self.apply_palette();
        self.effects.push(Effect::CachePalette(colors));
    }

    /// The terminal said its colors changed (`CSI ? 997 ; 1 n` or `; 2 n`), or the TUI got `SIGUSR2`.
    pub fn colors_changed(&mut self) {
        self.refresh_palette();
    }

    /// Custom themes were discovered (`discover`).
    pub fn custom_themes(&mut self, themes: IndexMap<String, Value>) {
        self.catalog.set_custom(themes);
        self.reload();
    }

    /// Custom theme discovery failed: TypeScript falls back to `opencode` without a toast.
    pub fn discovery_failed(&mut self) {
        self.active = "opencode".to_owned();
        self.reload();
    }

    /// `cli.json` changed `theme.name`.
    pub fn config_name(&mut self, name: &str) {
        if name.is_empty() {
            return;
        }
        self.active = name.to_owned();
        self.refresh_palette();
        self.reload();
    }

    /// `cli.json` changed `theme.mode`.
    pub fn config_mode(&mut self, setting: ModeSetting) {
        match setting.lock() {
            Some(mode) => self.pin(mode, false),
            None if self.lock.is_some() => self.free(false),
            None => {}
        }
    }

    /// The `new-designs` experiment was switched.
    pub fn set_new_designs(&mut self, enabled: bool) {
        self.new_designs = enabled;
        self.reload();
    }

    /// Effects queued since the last call.
    pub fn take_effects(&mut self) -> Vec<Effect> {
        std::mem::take(&mut self.effects)
    }

    /// The last theme that failed to load, if not yet shown.
    pub fn take_error(&mut self) -> Option<ThemeError> {
        self.error.take()
    }

    fn pin(&mut self, mode: ThemeMode, persist: bool) {
        self.lock = Some(mode);
        self.apply(mode);
        if persist {
            self.effects
                .push(Effect::PersistMode(ModeSetting::from_lock(Some(mode))));
        }
    }

    fn free(&mut self, persist: bool) {
        self.lock = None;
        self.apply(self.terminal.unwrap_or(self.mode));
        if persist {
            self.effects.push(Effect::PersistMode(ModeSetting::System));
        }
    }

    fn apply(&mut self, mode: ThemeMode) {
        if self.mode != mode {
            self.mode = mode;
            self.apply_palette();
        }
        self.refresh_palette();
    }

    /// Regenerates `system` from the palette for the current mode.
    fn apply_palette(&mut self) {
        let source = self
            .palette
            .as_ref()
            .map(|palette| generate_system(palette, self.mode));
        self.catalog.set_system(source);
        self.reload();
    }

    fn refresh_palette(&mut self) {
        if self.active == "system" && !self.effects.contains(&Effect::ProbePalette) {
            self.effects.push(Effect::ProbePalette);
        }
    }

    /// Loads the active theme, falling back to `opencode` with a [`ThemeError`] when it fails.
    fn reload(&mut self) {
        let name = if self.has(&self.active) {
            self.active.clone()
        } else {
            "opencode".to_owned()
        };
        match self.catalog.load(&name, self.mode, self.new_designs) {
            Ok(loaded) => self.current = loaded,
            Err(message) => {
                self.error = Some(ThemeError { name, message });
                self.active = "opencode".to_owned();
                self.current = self
                    .catalog
                    .load("opencode", self.mode, self.new_designs)
                    .expect("the built-in opencode theme loads");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options() -> ThemeStateOptions {
        ThemeStateOptions {
            name: None,
            mode: None,
            terminal: None,
            fallback: ThemeMode::Dark,
            palette: None,
            new_designs: false,
        }
    }

    fn palette(background: &str) -> TerminalColors {
        TerminalColors {
            palette: [
                "#000000", "#cc6666", "#b5bd68", "#f0c674", "#81a2be", "#b294bb", "#8abeb7",
                "#c5c8c6",
            ]
            .map(|hex| Some(hex.to_owned()))
            .to_vec(),
            default_background: Some(background.to_owned()),
            default_foreground: Some("#c5c8c6".to_owned()),
            ..TerminalColors::default()
        }
    }

    #[test]
    fn a_configured_mode_locks_until_unlocked() {
        let mut state = ThemeState::new(ThemeStateOptions {
            mode: Some(ModeSetting::Light),
            ..options()
        });
        assert_eq!((state.mode(), state.locked()), (ThemeMode::Light, true));
        state.terminal_mode(ThemeMode::Dark);
        assert_eq!(state.mode(), ThemeMode::Light);
        state.unlock();
        assert_eq!((state.mode(), state.locked()), (ThemeMode::Dark, false));
        assert_eq!(
            state.take_effects(),
            [Effect::PersistMode(ModeSetting::System)]
        );
        state.terminal_mode(ThemeMode::Light);
        assert_eq!(state.mode(), ThemeMode::Light);
        state.lock();
        assert_eq!(
            state.take_effects(),
            [Effect::PersistMode(ModeSetting::Light)]
        );
        state.config_mode(ModeSetting::System);
        assert!(!state.locked());
        assert!(
            state.take_effects().is_empty(),
            "config changes are not written back"
        );
    }

    #[test]
    fn set_switches_known_themes_and_respects_their_modes() {
        let mut state = ThemeState::new(options());
        assert!(!state.set("nope"));
        assert!(state.set("aura"));
        assert_eq!(
            state.take_effects(),
            [Effect::PersistName("aura".to_owned())]
        );
        assert_eq!(state.modes(), [ThemeMode::Dark]);
        assert!(
            !state.set_mode(Some(ThemeMode::Light), true),
            "aura has no light mode"
        );
        state.terminal_mode(ThemeMode::Light);
        assert_eq!(
            state.mode(),
            ThemeMode::Dark,
            "a dark-only theme resolves dark"
        );
        let names = state.names();
        assert_eq!(
            (
                names.first().map(String::as_str),
                names.last().map(String::as_str)
            ),
            (Some("aura"), Some("system"))
        );
        assert_eq!(names.len(), 34);
    }

    #[test]
    fn a_broken_custom_theme_falls_back_to_opencode_with_an_error() {
        let mut state = ThemeState::new(ThemeStateOptions {
            name: Some("mine".to_owned()),
            ..options()
        });
        let broken = serde_json::json!({ "theme": { "primary": "missing" } });
        state.custom_themes(IndexMap::from([
            ("mine".to_owned(), broken),
            ("notes".to_owned(), serde_json::json!([1])),
        ]));
        let error = state.take_error().unwrap();
        assert_eq!(error.name, "mine");
        assert_eq!(
            error.message,
            "Color reference \"missing\" not found in defs or theme"
        );
        assert_eq!(state.selected(), "opencode");
        assert!(
            !state.has("notes"),
            "values that are not themes are dropped"
        );
        assert!(state.take_error().is_none());
    }

    #[test]
    fn system_follows_the_terminal_palette() {
        let mut state = ThemeState::new(ThemeStateOptions {
            name: Some("system".to_owned()),
            palette: Some(palette("#1d1f21")),
            ..options()
        });
        assert_eq!(state.take_effects(), [Effect::ProbePalette]);
        assert_eq!(state.mode(), ThemeMode::Dark);
        let dark_background = state.theme().background.base;
        state.palette(palette("#fdf6e3"));
        assert_eq!(
            state.mode(),
            ThemeMode::Light,
            "a light background switches an unlocked mode"
        );
        assert_eq!(
            state.take_effects(),
            [Effect::CachePalette(palette("#fdf6e3"))]
        );
        assert_ne!(state.theme().background.base, dark_background);
        state.palette(TerminalColors::default());
        assert!(
            state.take_effects().is_empty(),
            "unusable palettes are ignored"
        );
        state.colors_changed();
        assert_eq!(state.take_effects(), [Effect::ProbePalette]);
    }

    #[test]
    fn without_a_palette_system_is_opencode() {
        let state = ThemeState::new(ThemeStateOptions {
            name: Some("system".to_owned()),
            ..options()
        });
        let opencode = ThemeState::new(options());
        assert_eq!(**state.theme(), **opencode.theme());
    }
}
