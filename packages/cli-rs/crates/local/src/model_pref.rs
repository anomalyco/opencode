//! Model preferences in `<state>/model.json` (F.5, row L07).
//!
//! Ports `packages/tui/src/model-preference.ts`: the lenient decoder, the recent and favorite lists,
//! variants, and updates under the `Flock` lock in `<state>/locks` that keep every other field of the
//! document.

use std::fs;
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
        Self {
            provider_id: provider_id.into(),
            model_id: model_id.into(),
        }
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
}

fn models(value: Option<&Value>) -> Vec<Model> {
    let Some(items) = value.and_then(Value::as_array) else {
        return Vec::new();
    };
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
    let Some(map) = value.and_then(Value::as_object) else {
        return IndexMap::new();
    };
    map.iter()
        .filter_map(|(key, item)| {
            let item = item.as_str().filter(|s| !s.is_empty())?;
            (!key.is_empty()).then(|| (key.clone(), item.to_string()))
        })
        .collect()
}

/// `decodeModelPreference`: the document with sanitized `recent`, `favorite`, and `variant`.
pub fn decode(value: Option<&Value>) -> Map<String, Value> {
    let mut document = value
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let preference = preference(&document);
    put(&mut document, &preference, true, true, true);
    document
}

fn preference(document: &Map<String, Value>) -> Preference {
    Preference {
        recent: models(document.get("recent")),
        favorite: models(document.get("favorite")),
        variant: variants(document.get("variant")),
    }
}

fn put(
    document: &mut Map<String, Value>,
    value: &Preference,
    recent: bool,
    favorite: bool,
    variant: bool,
) {
    let list = |models: &[Model]| Value::Array(models.iter().map(Model::to_value).collect());
    if recent {
        document.insert("recent".into(), list(&value.recent));
    }
    if favorite {
        document.insert("favorite".into(), list(&value.favorite));
    }
    if variant {
        let map = value
            .variant
            .iter()
            .map(|(key, item)| (key.clone(), Value::String(item.clone())))
            .collect();
        document.insert("variant".into(), Value::Object(map));
    }
}

/// `normalizeModelVariant`: `"default"` means none.
pub fn normalize_variant(value: Option<&str>) -> Option<&str> {
    value.filter(|v| *v != "default")
}

/// `recentModels`: `model` first, without repeats, at most 10.
pub fn recent_models(model: &Model, recent: &[Model]) -> Vec<Model> {
    let mut seen = std::collections::HashSet::new();
    std::iter::once(model)
        .chain(recent)
        .filter(|item| seen.insert(item.key()))
        .take(10)
        .cloned()
        .collect()
}

/// `favoriteModels`.
pub fn favorite_models(model: &Model, favorite: &[Model], enabled: bool) -> Vec<Model> {
    let rest = favorite
        .iter()
        .filter(|item| item.key() != model.key())
        .cloned();
    if enabled {
        std::iter::once(model.clone()).chain(rest).collect()
    } else {
        rest.collect()
    }
}

/// `cycleModelVariant`: the next named variant, or `None` after the last.
pub fn cycle_variant(current: Option<&str>, variants: &[&str]) -> Option<String> {
    let named: Vec<&str> = variants
        .iter()
        .copied()
        .filter(|v| *v != "default")
        .collect();
    let first = *named.first()?;
    let Some(value) = normalize_variant(current) else {
        return Some(first.to_string());
    };
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
        Self {
            file: state.join("model.json"),
            locks: state.join("locks"),
            lock: lock::Options::default(),
        }
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
            (
                Preference {
                    recent,
                    ..Preference::default()
                },
                (true, false, false),
            )
        })
    }

    pub fn set_favorite(&self, model: &Model, enabled: bool) -> Result<(), lock::Error> {
        self.update(|current| {
            let favorite = favorite_models(model, &current.favorite, enabled);
            (
                Preference {
                    favorite,
                    ..Preference::default()
                },
                (false, true, false),
            )
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
            (
                Preference {
                    variant,
                    ..Preference::default()
                },
                (false, false, true),
            )
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
        let value = fs::read_to_string(&self.file)
            .ok()
            .and_then(|text| serde_json::from_str::<Value>(&text).ok());
        decode(value.as_ref())
    }

    // `update(change)`: the patch replaces only the lists it names, sanitized again.
    fn update(
        &self,
        change: impl FnOnce(&Preference) -> (Preference, (bool, bool, bool)),
    ) -> Result<(), lock::Error> {
        lock::with_lock(
            &self.locks,
            &self.file.to_string_lossy(),
            &self.lock,
            || {
                let mut document = self.read();
                let (patch, (recent, favorite, variant)) = change(&preference(&document));
                put(&mut document, &patch, recent, favorite, variant);
                write_json_atomic(&self.file, &Value::Object(document))
            },
        )?
        .map_err(lock::Error::Io)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn updates_keep_other_fields_and_sanitize() {
        let state = tempfile::tempdir().unwrap();
        let file = state.path().join("model.json");
        fs::write(
            &file,
            r#"{"x":1,"recent":[{"providerID":"a","modelID":"b"},{"providerID":""},5],"variant":{"a/b":"high","":"x","c/d":""}}"#,
        )
        .unwrap();
        let prefs = ModelPreferences::new(state.path());
        let model = Model::new("p", "m");
        prefs.add_recent(&model).unwrap();
        assert_eq!(
            fs::read_to_string(&file).unwrap(),
            r#"{"x":1,"recent":[{"providerID":"p","modelID":"m"},{"providerID":"a","modelID":"b"}],"variant":{"a/b":"high"},"favorite":[]}"#
        );
        prefs.set_favorite(&model, true).unwrap();
        prefs.save_variant(&model, None).unwrap();
        let loaded = prefs.load();
        assert_eq!(loaded.favorite, vec![model.clone()]);
        assert_eq!(
            loaded.variant.get("p/m").map(String::as_str),
            Some("default")
        );
        assert_eq!(prefs.resolve_variant(&model), None);
        assert_eq!(decode(Some(&json!([1]))), decode(None));
    }

    #[test]
    fn cycles_variants_like_typescript() {
        let variants = ["default", "low", "high"];
        assert_eq!(cycle_variant(None, &variants).as_deref(), Some("low"));
        assert_eq!(
            cycle_variant(Some("low"), &variants).as_deref(),
            Some("high")
        );
        assert_eq!(cycle_variant(Some("high"), &variants), None);
        assert_eq!(cycle_variant(Some("gone"), &variants), None);
        assert_eq!(cycle_variant(None, &["default"]), None);
    }
}
