//! Models and variants (`variant.shared.ts`, `catalog.shared.ts`'s providers): the provider catalog the status row
//! names models from and the model panel lists, and variant cycling, saved per model in `model.json`.

use indexmap::IndexMap;
use opencode_api::client::Client;
use opencode_api::generated::{LocationQueryInput, ModelInfoStatus, ModelListInput, ProviderListInput};
use opencode_local::model_pref::{self, ModelPreferences};

/// A model selection (`{ providerID, modelID }`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModelSelection {
    pub provider_id: String,
    pub model_id: String,
}

/// `RunProviderModel`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Model {
    pub name: String,
    /// The default tier's input cost, 0 when every tier is free.
    pub cost: Option<f64>,
    pub context: u64,
    pub deprecated: bool,
    pub variants: Vec<String>,
}

/// `RunProvider`.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Provider {
    pub id: String,
    pub name: String,
    pub models: IndexMap<String, Model>,
}

/// `loadRunProviders`: the providers and models of `directory`, grouped (`runProviders`).
pub async fn load(client: &Client, directory: &str) -> Result<Vec<Provider>, String> {
    let location = Some(LocationQueryInput { directory: Some(directory.to_owned()) });
    let (providers, models) = futures_util::future::try_join(
        client.provider_list(&ProviderListInput { location: location.clone() }),
        client.model_list(&ModelListInput { location, types: None }),
    )
    .await
    .map_err(|error| error.to_string())?;
    let mut grouped: IndexMap<String, Provider> = providers
        .data
        .into_iter()
        .map(|provider| {
            let id = provider.id.0;
            (id.clone(), Provider { id, name: provider.name, models: IndexMap::new() })
        })
        .collect();
    for model in models.data {
        let provider = grouped.entry(model.provider_id.0.clone()).or_insert_with(|| Provider {
            id: model.provider_id.0.clone(),
            name: model.provider_id.0.clone(),
            models: IndexMap::new(),
        });
        let picked = model.cost.iter().find(|cost| cost.tier.is_none()).or(model.cost.first());
        let cost = picked.map(|cost| if model.cost.iter().all(|cost| cost.input == 0.0) { 0.0 } else { cost.input });
        provider.models.insert(
            model.id,
            Model {
                name: model.name,
                cost,
                context: model.limit.context as u64,
                deprecated: model.status == ModelInfoStatus::Deprecated,
                variants: model.variants.into_iter().map(|variant| variant.id).collect(),
            },
        );
    }
    Ok(grouped.into_values().collect())
}

fn find<'a>(providers: &'a [Provider], model: &ModelSelection) -> (Option<&'a Provider>, Option<&'a Model>) {
    let provider = providers.iter().find(|provider| provider.id == model.provider_id);
    (provider, provider.and_then(|provider| provider.models.get(&model.model_id)))
}

/// `modelInfo`: the provider's and model's names, else their IDs.
pub fn model_info(providers: &[Provider], model: &ModelSelection) -> (String, String) {
    let (provider, info) = find(providers, model);
    (
        info.map_or_else(|| model.model_id.clone(), |info| info.name.clone()),
        provider.map_or_else(|| model.provider_id.clone(), |provider| provider.name.clone()),
    )
}

/// `formatModelLabel`: `model · provider`, then the variant.
pub fn format_model_label(model: &ModelSelection, variant: Option<&str>, providers: &[Provider]) -> String {
    let (name, provider) = model_info(providers, model);
    let variant = variant.map(|variant| format!(" · {variant}")).unwrap_or_default();
    format!("{name} · {provider}{variant}")
}

/// `variantsFor`.
pub fn variants_for(providers: &[Provider], model: &ModelSelection) -> Vec<String> {
    find(providers, model).1.map(|model| model.variants.clone()).unwrap_or_default()
}

/// The context window of a model, for the footer's `% ctx` (`contextLimit`).
pub fn context_limit(providers: &[Provider], model: &ModelSelection) -> Option<u64> {
    find(providers, model).1.map(|model| model.context).filter(|context| *context > 0)
}

/// `cycleVariant`.
pub fn cycle_variant(current: Option<&str>, variants: &[String]) -> Option<String> {
    let variants: Vec<&str> = variants.iter().map(String::as_str).collect();
    model_pref::cycle_variant(current, &variants)
}

/// `resolveVariant`: the flag wins, then the session's variant, then the saved one; the last two only while the
/// model still offers them.
pub fn resolve_variant(
    input: Option<&str>,
    session: Option<&str>,
    saved: Option<&str>,
    variants: &[String],
) -> Option<String> {
    if let Some(input) = input {
        return model_pref::normalize_variant(Some(input)).map(str::to_owned);
    }
    let fit = |value: Option<&str>| {
        model_pref::normalize_variant(value)
            .filter(|value| variants.is_empty() || variants.iter().any(|variant| variant == value))
            .map(str::to_owned)
    };
    fit(session).or_else(|| fit(saved))
}

/// The saved variant of `model` (`preferences.resolveVariant`).
pub fn saved_variant(preferences: &ModelPreferences, model: &ModelSelection) -> Option<String> {
    preferences.resolve_variant(&model_pref::Model::new(&model.provider_id, &model.model_id))
}

/// `preferences.saveVariant`; a failure is ignored, as in TS.
pub fn save_variant(preferences: &ModelPreferences, model: &ModelSelection, variant: Option<&str>) {
    let model = model_pref::Model::new(&model.provider_id, &model.model_id);
    if let Err(error) = preferences.save_variant(&model, variant) {
        log::warn!("mini could not save the variant: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn catalog() -> Vec<Provider> {
        let model = Model {
            name: "Claude".into(),
            variants: vec!["high".into(), "max".into()],
            context: 200_000,
            ..Model::default()
        };
        vec![Provider { id: "anthropic".into(), name: "Anthropic".into(), models: [("claude".into(), model)].into() }]
    }

    #[test]
    fn labels_use_the_catalog_names_else_the_ids() {
        let known = ModelSelection { provider_id: "anthropic".into(), model_id: "claude".into() };
        assert_eq!(format_model_label(&known, Some("high"), &catalog()), "Claude · Anthropic · high");
        let unknown = ModelSelection { provider_id: "demo".into(), model_id: "model".into() };
        assert_eq!(format_model_label(&unknown, None, &catalog()), "model · demo");
        assert_eq!(variants_for(&catalog(), &known), ["high", "max"]);
        assert_eq!(context_limit(&catalog(), &known), Some(200_000));
    }

    #[test]
    fn variants_resolve_and_cycle_like_variant_shared() {
        let variants = vec!["high".to_owned(), "max".to_owned()];
        assert_eq!(resolve_variant(Some("low"), Some("high"), None, &variants).as_deref(), Some("low"));
        assert_eq!(resolve_variant(None, Some("gone"), Some("max"), &variants).as_deref(), Some("max"));
        assert_eq!(resolve_variant(None, None, Some("gone"), &variants), None);
        assert_eq!(cycle_variant(None, &variants).as_deref(), Some("high"));
        assert_eq!(cycle_variant(Some("max"), &variants), None);
    }
}
