//! Session config options: model, effort, and mode (`packages/cli/src/acp/config-option.ts`).

use opencode_api::generated::{ModelInfo, ModelRef, ProviderID};
use opencode_api::js::locale_compare;
use serde_json::{Map, Value, json};

use crate::catalog::{BUILTIN_COMMANDS, Catalog, find_model};
use crate::error::Failure;

const DEFAULT_VARIANT: &str = "default";

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Selection {
    pub model: Option<ModelRef>,
    pub mode_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Change {
    Model(ModelRef),
    Mode(String),
}

impl Selection {
    pub fn apply(&self, change: &Change) -> Self {
        match change {
            Change::Model(model) => Self { model: Some(model.clone()), ..self.clone() },
            Change::Mode(mode) => Self { mode_id: Some(mode.clone()), ..self.clone() },
        }
    }
}

pub fn current_model(catalog: &Catalog, selection: &Selection) -> ModelRef {
    selection.model.clone().unwrap_or_else(|| catalog.default_model.clone())
}

pub fn config_options(catalog: &Catalog, selection: &Selection) -> Vec<Value> {
    let model = current_model(catalog, selection);
    let variants: Vec<String> = find_model(&catalog.models, &model)
        .map(|item| item.variants.iter().map(|variant| variant.id.clone()).collect())
        .unwrap_or_default();
    let mut models: Vec<&ModelInfo> = catalog.models.iter().collect();
    models.sort_by(|a, b| a.provider_id.0.cmp(&b.provider_id.0).then_with(|| locale_compare(&a.name, &b.name)));
    let mut options = vec![json!({
        "id": "model",
        "name": "Model",
        "category": "model",
        "type": "select",
        "currentValue": advertised(&model.provider_id.0, &model.id),
        "options": models
            .iter()
            .map(|item| json!({
                "value": advertised(&item.provider_id.0, &item.id),
                "name": format!("{}/{}", item.provider_id.0, item.name),
            }))
            .collect::<Vec<_>>(),
    })];
    if !variants.is_empty() {
        let mut values: Vec<String> = Vec::new();
        for variant in variants.iter().cloned().chain([DEFAULT_VARIANT.to_owned()]) {
            if !values.contains(&variant) {
                values.push(variant);
            }
        }
        options.push(json!({
            "id": "effort",
            "name": "Effort",
            "description": "Available effort levels for this model",
            "category": "thought_level",
            "type": "select",
            "currentValue": select_variant(model.variant.as_deref(), &variants),
            "options": values
                .iter()
                .map(|value| json!({ "value": value, "name": title_case(value) }))
                .collect::<Vec<_>>(),
        }));
    }
    options.push(json!({
        "id": "mode",
        "name": "Session Mode",
        "category": "mode",
        "type": "select",
        "currentValue": selection.mode_id.clone().unwrap_or_else(|| catalog.default_mode_id.clone()),
        "options": catalog
            .modes
            .iter()
            .map(|mode| {
                let mut option = Map::new();
                option.insert("value".to_owned(), json!(mode.id));
                option.insert("name".to_owned(), json!(mode.name));
                if let Some(description) = mode.description.as_ref().filter(|text| !text.is_empty()) {
                    option.insert("description".to_owned(), json!(description));
                }
                Value::Object(option)
            })
            .collect::<Vec<_>>(),
    }));
    options
}

pub fn available_commands(catalog: &Catalog) -> Vec<Value> {
    catalog
        .commands
        .iter()
        .map(|command| {
            json!({
                "name": command.name,
                "description": command.description.clone().unwrap_or_default(),
            })
        })
        .chain(
            BUILTIN_COMMANDS.iter().map(|(name, description, _)| json!({ "name": name, "description": description })),
        )
        .collect()
}

pub fn resolve_change(
    catalog: &Catalog,
    selection: &Selection,
    config_id: &str,
    value: &str,
) -> Result<Change, Failure> {
    let current = current_model(catalog, selection);
    match config_id {
        "model" => require_model(catalog, value, &current).map(Change::Model),
        "effort" => {
            let model = find_model(&catalog.models, &current);
            let known = model.is_some_and(|model| {
                value == DEFAULT_VARIANT || model.variants.iter().any(|variant| variant.id == value)
            });
            if !known {
                return Err(Failure::InvalidEffort { effort: value.to_owned() });
            }
            Ok(Change::Model(ModelRef { variant: Some(value.to_owned()), ..current }))
        }
        "mode" => catalog
            .modes
            .iter()
            .find(|mode| mode.id == value)
            .map(|mode| Change::Mode(mode.id.clone()))
            .ok_or_else(|| Failure::InvalidMode { mode: value.to_owned() }),
        _ => Err(Failure::InvalidConfigOption { config_id: config_id.to_owned() }),
    }
}

pub fn parse_model_selection(value: &str, models: &[ModelInfo]) -> ModelRef {
    let reference = |model: &ModelInfo, variant: Option<String>| ModelRef {
        id: model.id.clone(),
        provider_id: model.provider_id.clone(),
        variant,
    };
    if let Some(exact) = models.iter().find(|model| advertised(&model.provider_id.0, &model.id) == value) {
        return reference(exact, None);
    }
    let separator = value.rfind('/');
    let variant = separator.map_or(value, |index| &value[index + 1..]);
    let base_value = separator.map_or("", |index| &value[..index]);
    // JS `slice(0, -1)` when there is no slash.
    let base_value =
        if separator.is_none() { value.get(..value.len().saturating_sub(1)).unwrap_or_default() } else { base_value };
    if let Some(base) = models.iter().find(|model| {
        advertised(&model.provider_id.0, &model.id) == base_value
            && model.variants.iter().any(|item| item.id == variant)
    }) {
        return reference(base, Some(variant.to_owned()));
    }
    match value.find('/') {
        None => ModelRef { id: String::new(), provider_id: ProviderID(value.to_owned()), variant: None },
        Some(index) => ModelRef {
            id: value[index + 1..].to_owned(),
            provider_id: ProviderID(value[..index].to_owned()),
            variant: None,
        },
    }
}

fn require_model(catalog: &Catalog, value: &str, current: &ModelRef) -> Result<ModelRef, Failure> {
    let selected = parse_model_selection(value, &catalog.models);
    let Some(model) = find_model(&catalog.models, &selected) else {
        return Err(Failure::InvalidModel { model_id: value.to_owned(), provider_id: Some(selected.provider_id.0) });
    };
    let selected_variant = model.variants.iter().find(|variant| Some(&variant.id) == selected.variant.as_ref());
    if let Some(variant) = &selected.variant
        && selected_variant.is_none()
    {
        return Err(Failure::InvalidEffort { effort: variant.clone() });
    }
    let same = current.provider_id == model.provider_id && current.id == model.id;
    let keeps = current
        .variant
        .as_deref()
        .is_some_and(|variant| variant == DEFAULT_VARIANT || model.variants.iter().any(|item| item.id == variant));
    let variant = selected_variant
        .map(|variant| variant.id.clone())
        .or_else(|| (same && keeps).then(|| current.variant.clone()).flatten());
    Ok(ModelRef { id: model.id.clone(), provider_id: model.provider_id.clone(), variant })
}

fn advertised(provider_id: &str, id: &str) -> String {
    format!("{provider_id}/{id}")
}

fn select_variant(variant: Option<&str>, variants: &[String]) -> String {
    let Some(variant) = variant.filter(|variant| !variant.is_empty() && *variant != DEFAULT_VARIANT) else {
        return DEFAULT_VARIANT.to_owned();
    };
    if variants.iter().any(|item| item == variant) {
        return variant.to_owned();
    }
    if variants.iter().any(|item| item == DEFAULT_VARIANT) {
        return DEFAULT_VARIANT.to_owned();
    }
    variants.first().cloned().unwrap_or_else(|| DEFAULT_VARIANT.to_owned())
}

fn title_case(value: &str) -> String {
    value
        .split(['_', '-'])
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().chain(chars).collect(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}
