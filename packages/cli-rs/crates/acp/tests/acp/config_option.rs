//! `config-option.test.ts`.

use opencode_acp::catalog::{Catalog, Mode};
use opencode_acp::config_option::{Selection, config_options, parse_model_selection};
use opencode_api::generated::{ModelInfo, ModelRef, ProviderID};
use serde_json::json;

fn model(provider: &str, id: &str, name: &str, variants: &[&str]) -> ModelInfo {
    let mut value = crate::wire::model(id, name, variants, 100_000);
    value["providerID"] = json!(provider);
    serde_json::from_value(value).expect("model")
}

fn model_ref(provider: &str, id: &str, variant: Option<&str>) -> ModelRef {
    ModelRef {
        id: id.to_owned(),
        provider_id: ProviderID(provider.to_owned()),
        variant: variant.map(str::to_owned),
    }
}

fn catalog() -> Catalog {
    Catalog {
        models: vec![
            model(
                "anthropic",
                "claude/sonnet-4",
                "Claude Sonnet 4",
                &["default", "high", "very-high"],
            ),
            model("anthropic", "claude-haiku", "Claude Haiku", &[]),
            model("openai", "gpt-5", "GPT-5", &["minimal", "low"]),
            model("test", "effort", "Effort", &["low", "default", "high"]),
        ],
        default_model: model_ref("openai", "gpt-5", None),
        modes: vec![Mode {
            id: "build".to_owned(),
            name: "Build".to_owned(),
            description: None,
        }],
        default_mode_id: "build".to_owned(),
        commands: Vec::new(),
    }
}

fn effort_option(provider: &str, id: &str) -> Option<serde_json::Value> {
    let selection = Selection {
        model: Some(model_ref(provider, id, Some("missing"))),
        mode_id: None,
    };
    config_options(&catalog(), &selection)
        .into_iter()
        .find(|option| option["id"] == "effort")
}

#[test]
fn builds_effort_option_from_variants_and_falls_back_to_default_when_current_variant_is_invalid() {
    assert_eq!(
        effort_option("test", "effort"),
        Some(json!({
            "id": "effort",
            "name": "Effort",
            "description": "Available effort levels for this model",
            "category": "thought_level",
            "type": "select",
            "currentValue": "default",
            "options": [
                { "value": "low", "name": "Low" },
                { "value": "default", "name": "Default" },
                { "value": "high", "name": "High" },
            ],
        }))
    );
    assert_eq!(
        effort_option("openai", "gpt-5").unwrap()["currentValue"],
        "minimal"
    );
}

#[test]
fn parses_the_model_selection_preferring_exact_slash_containing_model_ids() {
    let rows = [
        ("openai/gpt-5", model_ref("openai", "gpt-5", None)),
        (
            "openai/gpt-5/low",
            model_ref("openai", "gpt-5", Some("low")),
        ),
        (
            "anthropic/claude/sonnet-4",
            model_ref("anthropic", "claude/sonnet-4", None),
        ),
        (
            "anthropic/claude/sonnet-4/high",
            model_ref("anthropic", "claude/sonnet-4", Some("high")),
        ),
        (
            "anthropic/claude/sonnet-4/missing",
            model_ref("anthropic", "claude/sonnet-4/missing", None),
        ),
    ];
    let models = catalog().models;
    for (value, expected) in rows {
        assert_eq!(parse_model_selection(value, &models), expected, "{value}");
    }
}
