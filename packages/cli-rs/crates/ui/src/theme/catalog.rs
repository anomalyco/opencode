//! Which themes exist and how one loads (`allThemes`, `parseTheme`, and `loadTheme` in `packages/tui/src/theme` and
//! `context/theme.tsx`).

use std::borrow::Cow;
use std::sync::LazyLock;

use indexmap::{IndexMap, IndexSet};
use serde::Deserialize;
use serde_json::Value;

use super::document::{decode, modes};
use super::{Theme, ThemeMode, resolve, v1, v1_new};

#[derive(Deserialize)]
struct Builtin {
    name: String,
    current: Value,
    #[serde(rename = "newDesigns")]
    new_designs: Option<Value>,
}

#[derive(Deserialize)]
struct Builtins {
    themes: Vec<Builtin>,
    opencode2: Value,
}

static BUILTINS: LazyLock<Builtins> = LazyLock::new(|| {
    serde_json::from_str(include_str!("generated/themes.json"))
        .expect("generated/themes.json is valid")
});

/// Where a theme comes from.
#[derive(Clone, Copy, Debug)]
pub enum ThemeSource<'a> {
    /// A built-in document, already in V2 form.
    Builtin(&'static Value),
    /// A custom file or the generated `system` theme: V1 (`{ theme }`) or V2 (`{ base, light, dark }`).
    Custom(&'a Value),
}

/// A theme resolved in a mode: the modes it supports and the one it resolved in.
#[derive(Clone, Debug)]
pub struct Loaded {
    pub modes: Vec<ThemeMode>,
    pub mode: ThemeMode,
    pub theme: Theme,
}

/// The built-in themes plus the custom and `system` themes currently known.
#[derive(Clone, Debug, Default)]
pub struct Catalog {
    custom: IndexMap<String, Value>,
    system: Option<Value>,
}

impl Catalog {
    /// Replaces the custom themes; values that are not theme documents are dropped (`setCustomThemes`).
    pub fn set_custom(&mut self, themes: IndexMap<String, Value>) {
        self.custom = themes
            .into_iter()
            .filter(|(_, source)| is_theme_source(source))
            .collect();
    }

    /// The generated `system` theme, or `None` to fall back to a custom `system` theme or `opencode`.
    pub fn set_system(&mut self, source: Option<Value>) {
        self.system = source;
    }

    /// Theme names in list order: `opencode2` under the `new-designs` experiment, the built-ins, custom themes not
    /// named like a built-in, then `system`.
    pub fn names(&self, new_designs: bool) -> Vec<String> {
        let mut names = IndexSet::new();
        if new_designs {
            names.insert("opencode2".to_owned());
        }
        names.extend(BUILTINS.themes.iter().map(|theme| theme.name.clone()));
        names.extend(self.custom.keys().cloned());
        names.insert("system".to_owned());
        names.into_iter().collect()
    }

    pub fn has(&self, name: &str, new_designs: bool) -> bool {
        !name.is_empty() && self.source(name, new_designs).is_some()
    }

    pub fn source(&self, name: &str, new_designs: bool) -> Option<ThemeSource<'_>> {
        if name == "system" {
            let system = self.system.as_ref().or_else(|| self.custom.get("system"));
            return system
                .map(ThemeSource::Custom)
                .or_else(|| self.source("opencode", new_designs));
        }
        if let Some(custom) = self.custom.get(name) {
            return Some(ThemeSource::Custom(custom));
        }
        if let Some(builtin) = BUILTINS.themes.iter().find(|theme| theme.name == name) {
            let document = if new_designs {
                builtin.new_designs.as_ref()
            } else {
                None
            };
            return Some(ThemeSource::Builtin(document.unwrap_or(&builtin.current)));
        }
        (new_designs && name == "opencode2").then(|| ThemeSource::Builtin(&BUILTINS.opencode2))
    }

    /// `loadTheme`: the theme `name` in `mode`, or in its first mode when it lacks `mode`.
    pub fn load(&self, name: &str, mode: ThemeMode, new_designs: bool) -> Result<Loaded, String> {
        let source = self
            .source(name, new_designs)
            .ok_or_else(|| format!("Theme \"{name}\" was not found"))?;
        let document = parse(source, name, new_designs)?;
        let modes = modes(&document);
        let requested = if modes.contains(&mode) {
            mode
        } else {
            modes.first().copied().unwrap_or(mode)
        };
        let (theme, mode) = resolve(&document, requested)?;
        Ok(Loaded { modes, mode, theme })
    }
}

/// `isThemeSource`: an object with `theme` (V1) or `base` (V2).
fn is_theme_source(source: &Value) -> bool {
    source
        .as_object()
        .is_some_and(|object| object.contains_key("theme") || object.contains_key("base"))
}

/// `parseTheme`: V1 sources migrate, V2 sources pass the schema and must resolve in every mode they define.
fn parse<'a>(
    source: ThemeSource<'a>,
    name: &str,
    new_designs: bool,
) -> Result<Cow<'a, Value>, String> {
    let source = match source {
        ThemeSource::Builtin(document) => return Ok(Cow::Borrowed(document)),
        ThemeSource::Custom(source) => source,
    };
    if source.get("theme").is_some() {
        let migrated = if new_designs {
            v1_new::migrate(source)
        } else {
            v1::migrate(source)
        };
        return migrated.map(Cow::Owned);
    }
    let document = decode(source).map_err(|issue| invalid(name, &issue.value()))?;
    for mode in modes(&document) {
        resolve(&document, mode).map_err(|_| invalid(name, "value"))?;
    }
    Ok(Cow::Owned(document))
}

/// `themeDecodeError`'s message.
fn invalid(name: &str, value: &str) -> String {
    format!("Invalid theme: {name} {value} is an invalid value")
}
