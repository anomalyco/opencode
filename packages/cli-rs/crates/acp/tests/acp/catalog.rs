//! `catalog.test.ts`.

use std::time::Duration;

use serde_json::{Value, json};

use crate::wire::{WireOptions, assert_matches, second_model, start_wire};

fn current_value(result: &Value, id: &str) -> Value {
    result["configOptions"]
        .as_array()
        .and_then(|options| options.iter().find(|option| option["id"] == id))
        .map(|option| option["currentValue"].clone())
        .unwrap_or(Value::Null)
}

#[tokio::test]
async fn switches_model_effort_and_mode_against_the_warm_catalog() {
    let acp = start_wire(WireOptions::default()).await;
    let mut sub = second_model();
    sub["providerID"] = json!("test/sub");
    acp.server.state().models.push(sub);
    acp.initialize(json!({})).await;
    let session = acp.new_session("/workspace", json!([])).await.unwrap();
    let session_id = session["sessionId"].as_str().unwrap().to_owned();
    let set = |config: &str, value: &str| {
        acp.request(
            "session/set_config_option",
            json!({ "sessionId": session_id, "configId": config, "value": value }),
        )
    };

    let selected_model = set("model", "test/second-model").await.unwrap();
    let selected_effort = set("effort", "medium").await.unwrap();
    let selected_mode = set("mode", "plan").await.unwrap();
    acp.request(
        "session/set_mode",
        json!({ "sessionId": session_id, "modeId": "build" }),
    )
    .await
    .unwrap();

    assert_eq!(current_value(&selected_model, "model"), "test/second-model");
    assert_eq!(current_value(&selected_model, "effort"), "default");
    assert_eq!(current_value(&selected_effort, "effort"), "medium");
    assert_eq!(current_value(&selected_mode, "mode"), "plan");
    assert_eq!(
        acp.server.state().selections,
        vec![
            json!({ "sessionID": session_id, "model": { "providerID": "test", "id": "second-model" } }),
            json!({ "sessionID": session_id, "model": { "providerID": "test", "id": "second-model", "variant": "medium" } }),
            json!({ "sessionID": session_id, "agent": "plan" }),
            json!({ "sessionID": session_id, "agent": "build" }),
        ]
    );

    for (config, value, data) in [
        ("effort", "maximum", json!({ "effort": "maximum" })),
        ("mode", "missing", json!({ "mode": "missing" })),
        ("missing", "value", json!({ "configId": "missing" })),
        (
            "model",
            "test/missing-model",
            json!({ "modelId": "test/missing-model" }),
        ),
    ] {
        let error = set(config, value).await.expect_err(value);
        assert_matches(&error.json(), &json!({ "code": -32602, "data": data }));
    }
    let overlap = "test/sub/second-model";
    assert_eq!(
        current_value(&set("model", overlap).await.unwrap(), "model"),
        overlap
    );
    assert_eq!(
        current_value(
            &set("model", &format!("{overlap}/low")).await.unwrap(),
            "effort"
        ),
        "low"
    );
}

#[tokio::test]
async fn answers_the_first_session_after_a_cold_location_activates_its_plugins() {
    let acp = start_wire(WireOptions::default()).await;
    let plugins = {
        let mut state = acp.server.state();
        state.models.truncate(1);
        std::mem::take(&mut state.plugins)
    };
    acp.initialize(json!({})).await;
    let server = acp.server.clone();
    let activated = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(200)).await;
        let mut state = server.state();
        state.plugins.extend(plugins);
        state.models.push(second_model());
    });

    let session = acp.new_session("/workspace", json!([])).await.unwrap();
    let selected = acp
        .request(
            "session/set_config_option",
            json!({ "sessionId": session["sessionId"], "configId": "model", "value": "test/second-model" }),
        )
        .await
        .unwrap();
    activated.await.unwrap();

    let model = session["configOptions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|option| option["id"] == "model")
        .unwrap();
    assert_eq!(
        model["options"],
        json!([
            { "value": "test/second-model", "name": "test/Second Model" },
            { "value": "test/test-model", "name": "test/Test Model" },
        ])
    );
    assert_eq!(current_value(&selected, "model"), "test/second-model");
}
