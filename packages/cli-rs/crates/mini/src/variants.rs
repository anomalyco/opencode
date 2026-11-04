//! Models and variants (`variant.shared.ts`): M.4 adds variant cycling and the names from the provider list.

/// A model selection (`{ providerID, modelID }`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModelSelection {
    pub provider_id: String,
    pub model_id: String,
}

/// `formatModelLabel`: `model · provider`, then the variant. M.1 has no provider list, so it shows the IDs.
pub fn format_model_label(model: &ModelSelection, variant: Option<&str>) -> String {
    let variant = variant
        .map(|variant| format!(" · {variant}"))
        .unwrap_or_default();
    format!("{} · {}{variant}", model.model_id, model.provider_id)
}
