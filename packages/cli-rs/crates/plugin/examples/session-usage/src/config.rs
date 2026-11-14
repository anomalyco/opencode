//! TS `src/config.ts`: the settings, from defaults, then the config file, then the plugin's options.

use std::path::PathBuf;

use serde_json::{Map, Value};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Position {
    Top,
    Bottom,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Config {
    /// The interval of the usage limits read, in milliseconds; 0 reads on events only.
    pub refresh_ms: u64,
    pub position: Position,
    pub compact: bool,
    pub title: String,
    pub show_estimate: bool,
    pub show_meters: bool,
    pub show_bars: bool,
    pub bar_width: usize,
    pub show_reset: bool,
    pub warn_at: f64,
    pub critical_at: f64,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            refresh_ms: 120_000,
            position: Position::Top,
            compact: false,
            title: "Usage".to_owned(),
            show_estimate: true,
            show_meters: true,
            show_bars: true,
            bar_width: 22,
            show_reset: true,
            warn_at: 70.0,
            critical_at: 90.0,
        }
    }
}

const MIN_REFRESH_MS: f64 = 30_000.0;
const MAX_TITLE: usize = 40;

/// Defaults, then `file`, then `options`, each validated as TS `parseConfig` does.
pub fn merge(file: &Value, options: &Value) -> Config {
    let mut config = Config::default();
    apply(&mut config, file);
    apply(&mut config, options);
    config
}

/// The file and `options`: a missing or malformed file is no settings.
pub fn load(options: &Value) -> Config {
    let file =
        std::fs::read_to_string(path()).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or(Value::Null);
    merge(&file, options)
}

/// `$OPENCODE_USAGE_CONFIG`, else `$XDG_CONFIG_HOME/opencode/usage-sidebar.json`, else
/// `~/.config/opencode/usage-sidebar.json`.
pub fn path() -> PathBuf {
    let var =
        |name: &str| std::env::var(name).ok().map(|value| value.trim().to_owned()).filter(|value| !value.is_empty());
    if let Some(path) = var("OPENCODE_USAGE_CONFIG") {
        return PathBuf::from(path);
    }
    let home = || PathBuf::from(std::env::var_os("HOME").unwrap_or_default()).join(".config");
    var("XDG_CONFIG_HOME").map_or_else(home, PathBuf::from).join("opencode").join("usage-sidebar.json")
}

/// TS `parseConfig` merged into `config`: each valid key wins, and `criticalAt` is at least `warnAt` when both are set.
fn apply(config: &mut Config, value: &Value) {
    let empty = Map::new();
    let input = value.as_object().unwrap_or(&empty);
    if input.get("refreshMs").and_then(Value::as_f64) == Some(0.0) {
        config.refresh_ms = 0;
    } else if let Some(refresh) = number_in(input.get("refreshMs"), MIN_REFRESH_MS, 86_400_000.0) {
        config.refresh_ms = refresh as u64;
    }
    match input.get("position").and_then(Value::as_str) {
        Some("top") => config.position = Position::Top,
        Some("bottom") => config.position = Position::Bottom,
        _ => {}
    }
    if let Some(title) = input.get("title").and_then(Value::as_str).map(str::trim).filter(|title| !title.is_empty()) {
        // `slice` counts UTF-16 units; titles are short, so characters are close enough.
        config.title = title.chars().take(MAX_TITLE).collect();
    }
    let flag = |key: &str| input.get(key).and_then(Value::as_bool);
    let flags = [
        ("compact", &mut config.compact),
        ("showEstimate", &mut config.show_estimate),
        ("showMeters", &mut config.show_meters),
        ("showBars", &mut config.show_bars),
        ("showReset", &mut config.show_reset),
    ];
    for (key, into) in flags {
        if let Some(value) = flag(key) {
            *into = value;
        }
    }
    if let Some(width) = number_in(input.get("barWidth"), 8.0, 60.0) {
        config.bar_width = width as usize;
    }
    let warn = number_in(input.get("warnAt"), 0.0, 100.0);
    let critical = number_in(input.get("criticalAt"), 0.0, 100.0);
    if let Some(warn) = warn {
        config.warn_at = warn;
    }
    if let Some(critical) = critical {
        config.critical_at = match warn {
            Some(warn) if critical < warn => warn,
            _ => critical,
        };
    }
}

/// A finite number, rounded as `Math.round` does and clamped to `min..=max`.
fn number_in(value: Option<&Value>, min: f64, max: f64) -> Option<f64> {
    let value = value?.as_f64().filter(|value| value.is_finite())?;
    Some(crate::usage::js_round(value).clamp(min, max))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // Expected: TS `mergeConfig`: options win over the file, a refresh is floored at 30 s unless it is 0, the bar
    // width is clamped, critical is lifted to warn, and a blank title or a bad position is ignored.
    #[test]
    fn options_win_over_the_file_and_values_are_validated() {
        let file = json!({ "refreshMs": 1000, "barWidth": 99, "warnAt": 80, "criticalAt": 50, "title": "  ", "position": "left" });
        let config = merge(&file, &json!({ "compact": true, "title": " Go " }));
        assert_eq!(config.refresh_ms, 30_000);
        assert_eq!((config.bar_width, config.warn_at, config.critical_at), (60, 80.0, 80.0));
        assert_eq!((config.compact, config.title.as_str(), config.position), (true, "Go", Position::Top));
        assert_eq!(merge(&json!({ "refreshMs": 0 }), &Value::Null).refresh_ms, 0);
        assert_eq!(merge(&Value::Null, &Value::Null), Config::default());
    }
}
