//! Recent models, favorites, variants and speeds in `<state>/model.json`. Locked updates preserve unrelated fields.

use std::path::{Path, PathBuf};

use indexmap::IndexMap;
use serde_json::{Map, Value};

use crate::lock;
use crate::storage::write_json_atomic;
use crate::watch::{self, Watch};

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct Model {
    pub provider_id: String,
    pub model_id: String,
}

impl Model {
    pub fn new(provider_id: impl Into<String>, model_id: impl Into<String>) -> Self {
        Self { provider_id: provider_id.into(), model_id: model_id.into() }
    }

    /// `modelPreferenceKey`: `<providerID>/<modelID>`.
    pub fn key(&self) -> String {
        format!("{}/{}", self.provider_id, self.model_id)
    }

    fn to_value(&self) -> Value {
        serde_json::json!({ "providerID": self.provider_id, "modelID": self.model_id })
    }
}

/// `ModelPreference`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Preference {
    pub recent: Vec<Model>,
    pub favorite: Vec<Model>,
    /// Variant by model key; `"default"` is kept, since it overrides an agent's configured variant.
    pub variant: IndexMap<String, String>,
    /// The speed last chosen for each model by its key; a model without an entry runs at its standard speed.
    pub speed: IndexMap<String, String>,
}

/// Which of [`Preference`]'s fields a write replaces.
#[derive(Clone, Copy, Default)]
struct Fields {
    recent: bool,
    favorite: bool,
    variant: bool,
    speed: bool,
}

const ALL: Fields = Fields { recent: true, favorite: true, variant: true, speed: true };

fn models(value: Option<&Value>) -> Vec<Model> {
    let Some(items) = value.and_then(Value::as_array) else { return Vec::new() };
    items
        .iter()
        .filter_map(|item| {
            let item = item.as_object()?;
            let text = |key: &str| item.get(key)?.as_str().filter(|s| !s.is_empty());
            Some(Model::new(text("providerID")?, text("modelID")?))
        })
        .collect()
}

fn variants(value: Option<&Value>) -> IndexMap<String, String> {
    let Some(map) = value.and_then(Value::as_object) else { return IndexMap::new() };
    map.iter()
        .filter_map(|(key, item)| {
            let item = item.as_str().filter(|s| !s.is_empty())?;
            (!key.is_empty()).then(|| (key.clone(), item.to_string()))
        })
        .collect()
}

/// `decodeModelPreference`: the document with sanitized `recent`, `favorite`, `variant`, and `speed`.
pub fn decode(value: Option<&Value>) -> Map<String, Value> {
    let mut document = value.and_then(Value::as_object).cloned().unwrap_or_default();
    let preference = preference(&document);
    put(&mut document, &preference, ALL);
    document
}

fn preference(document: &Map<String, Value>) -> Preference {
    Preference {
        recent: models(document.get("recent")),
        favorite: models(document.get("favorite")),
        variant: variants(document.get("variant")),
        speed: variants(document.get("speed")),
    }
}

fn put(document: &mut Map<String, Value>, value: &Preference, fields: Fields) {
    let list = |models: &[Model]| Value::Array(models.iter().map(Model::to_value).collect());
    let map = |map: &IndexMap<String, String>| {
        Value::Object(map.iter().map(|(key, item)| (key.clone(), Value::String(item.clone()))).collect())
    };
    if fields.recent {
        document.insert("recent".into(), list(&value.recent));
    }
    if fields.favorite {
        document.insert("favorite".into(), list(&value.favorite));
    }
    if fields.variant {
        document.insert("variant".into(), map(&value.variant));
    }
    if fields.speed {
        document.insert("speed".into(), map(&value.speed));
    }
}

/// `normalizeModelVariant`: `"default"` means none.
pub fn normalize_variant(value: Option<&str>) -> Option<&str> {
    value.filter(|v| *v != "default")
}

/// `recentModels`: `model` first, without repeats, at most 10.
pub fn recent_models(model: &Model, recent: &[Model]) -> Vec<Model> {
    let mut seen = std::collections::HashSet::new();
    std::iter::once(model).chain(recent).filter(|item| seen.insert(item.key())).take(10).cloned().collect()
}

/// `favoriteModels`: `same` names the entries that are `model`, such as the model saved at another speed.
pub fn favorite_models(model: &Model, favorite: &[Model], enabled: bool, same: impl Fn(&Model) -> bool) -> Vec<Model> {
    let rest = favorite.iter().filter(|item| !same(item)).cloned();
    if enabled { std::iter::once(model.clone()).chain(rest).collect() } else { rest.collect() }
}

/// `cycleModelSpeed`: slower speeds, then standard (`None`), then faster ones; wraps around. A speed the model no
/// longer has restarts from the slowest.
pub fn cycle_speed(current: Option<&str>, speeds: &[(&str, bool)]) -> Option<String> {
    let order: Vec<Option<&str>> = speeds
        .iter()
        .filter(|speed| !speed.1)
        .map(|speed| Some(speed.0))
        .chain([None])
        .chain(speeds.iter().filter(|speed| speed.1).map(|speed| Some(speed.0)))
        .collect();
    let next = order.iter().position(|speed| *speed == current).map_or(0, |at| (at + 1) % order.len());
    order[next].map(str::to_owned)
}

/// `cycleModelVariant`: the next named variant, or `None` after the last.
pub fn cycle_variant(current: Option<&str>, variants: &[&str]) -> Option<String> {
    let named: Vec<&str> = variants.iter().copied().filter(|v| *v != "default").collect();
    let first = *named.first()?;
    let Some(value) = normalize_variant(current) else { return Some(first.to_string()) };
    let index = named.iter().position(|v| *v == value)?;
    named.get(index + 1).map(|v| v.to_string())
}

/// `createModelPreferenceRepository(<state>/model.json)`.
#[derive(Clone, Debug)]
pub struct ModelPreferences {
    file: PathBuf,
    locks: PathBuf,
    lock: lock::Options,
}

impl ModelPreferences {
    pub fn new(state: &Path) -> Self {
        Self { file: state.join("model.json"), locks: state.join("locks"), lock: lock::Options::default() }
    }

    pub fn path(&self) -> &Path {
        &self.file
    }

    pub fn load(&self) -> Preference {
        preference(&self.read())
    }

    pub fn add_recent(&self, model: &Model) -> Result<(), lock::Error> {
        self.update(|current| {
            let recent = recent_models(model, &current.recent);
            (Preference { recent, ..Preference::default() }, Fields { recent: true, ..Fields::default() })
        })
    }

    /// `setFavorite`: `same` as in [`favorite_models`].
    pub fn set_favorite(&self, model: &Model, enabled: bool, same: impl Fn(&Model) -> bool) -> Result<(), lock::Error> {
        self.update(|current| {
            let favorite = favorite_models(model, &current.favorite, enabled, same);
            (Preference { favorite, ..Preference::default() }, Fields { favorite: true, ..Fields::default() })
        })
    }

    /// `resolveVariant`.
    pub fn resolve_variant(&self, model: &Model) -> Option<String> {
        let variant = self.load().variant.shift_remove(&model.key());
        normalize_variant(variant.as_deref()).map(str::to_string)
    }

    /// `saveVariant`: `None` saves `"default"`.
    pub fn save_variant(&self, model: &Model, value: Option<&str>) -> Result<(), lock::Error> {
        self.update(|current| {
            let mut variant = current.variant.clone();
            let next = normalize_variant(value).unwrap_or("default");
            variant.insert(model.key(), next.to_string());
            (Preference { variant, ..Preference::default() }, Fields { variant: true, ..Fields::default() })
        })
    }

    /// `saveSpeed`: `None`, the standard speed, removes the model's entry.
    pub fn save_speed(&self, model: &Model, value: Option<&str>) -> Result<(), lock::Error> {
        self.update(|current| {
            let mut speed = current.speed.clone();
            match value {
                Some(value) => speed.insert(model.key(), value.to_owned()),
                None => speed.shift_remove(&model.key()),
            };
            (Preference { speed, ..Preference::default() }, Fields { speed: true, ..Fields::default() })
        })
    }

    /// Calls `on_change` after `model.json` (or a temporary file of it) changes, debounced by 50 ms.
    pub fn watch(&self, on_change: impl FnMut() + Send + 'static) -> Option<Watch> {
        let name = self.file.file_name()?.to_string_lossy().into_owned();
        let dir = self.file.parent()?;
        let filter = move |changed: &std::ffi::OsStr| {
            let changed = changed.to_string_lossy();
            changed == name || changed.starts_with(&format!("{name}."))
        };
        watch::watch(dir, filter, watch::DEBOUNCE, on_change)
    }

    fn read(&self) -> Map<String, Value> {
        let value = crate::read_lossy(&self.file).ok().and_then(|text| serde_json::from_str::<Value>(&text).ok());
        decode(value.as_ref())
    }

    // `update(change)`: the patch replaces only the lists it names, sanitized again.
    fn update(&self, change: impl FnOnce(&Preference) -> (Preference, Fields)) -> Result<(), lock::Error> {
        lock::with_lock(&self.locks, &self.file.to_string_lossy(), &self.lock, || {
            let mut document = self.read();
            let (patch, fields) = change(&preference(&document));
            // As TS `patch()`: an empty ID, variant or speed is dropped rather than written.
            let mut staged = Map::new();
            put(&mut staged, &patch, ALL);
            put(&mut document, &preference(&staged), fields);
            write_json_atomic(&self.file, &Value::Object(document))
        })?
        .map_err(lock::Error::Io)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cycles_variants_like_typescript() {
        let variants = ["default", "low", "high"];
        assert_eq!(cycle_variant(None, &variants).as_deref(), Some("low"));
        assert_eq!(cycle_variant(Some("low"), &variants).as_deref(), Some("high"));
        assert_eq!(cycle_variant(Some("high"), &variants), None);
        assert_eq!(cycle_variant(Some("gone"), &variants), None);
        assert_eq!(cycle_variant(None, &["default"]), None);
    }

    #[test]
    fn an_empty_variant_is_dropped_as_typescript_drops_it() {
        let state = opencode_util::temp::tempdir().unwrap();
        let prefs = ModelPreferences::new(state.path());
        prefs.save_variant(&Model::new("p", "a"), Some("high")).unwrap();
        prefs.save_variant(&Model::new("p", "a"), Some("")).unwrap();
        assert_eq!(
            std::fs::read_to_string(prefs.path()).unwrap(),
            r#"{"recent":[],"favorite":[],"variant":{},"speed":{}}"#
        );
    }

    #[test]
    fn cycles_speeds_from_slowest_to_fastest_through_the_standard_speed() {
        let speeds = [("flex", false), ("fast", true), ("ultrafast", true)];
        assert_eq!(cycle_speed(Some("flex"), &speeds), None);
        assert_eq!(cycle_speed(None, &speeds).as_deref(), Some("fast"));
        assert_eq!(cycle_speed(Some("fast"), &speeds).as_deref(), Some("ultrafast"));
        assert_eq!(cycle_speed(Some("ultrafast"), &speeds).as_deref(), Some("flex"));
        assert_eq!(cycle_speed(Some("gone"), &speeds).as_deref(), Some("flex"));
    }

    #[test]
    fn the_standard_speed_is_the_absence_of_an_entry() {
        let state = opencode_util::temp::tempdir().unwrap();
        let prefs = ModelPreferences::new(state.path());
        prefs.save_speed(&Model::new("openai", "gpt-5"), Some("fast")).unwrap();
        assert_eq!(prefs.load().speed.get("openai/gpt-5").map(String::as_str), Some("fast"));
        prefs.save_speed(&Model::new("openai", "gpt-5"), None).unwrap();
        assert!(prefs.load().speed.is_empty());
    }
}
