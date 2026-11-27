use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::json;

use crate::wire::{
    WireOptions, assert_matches, current_value, durable_event, json_response, lock, second_model, start_session,
    start_wire,
};

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
        acp.request("session/set_config_option", json!({ "sessionId": session_id, "configId": config, "value": value }))
    };

    let selected_model = set("model", "test/second-model").await.unwrap();
    let selected_effort = set("effort", "medium").await.unwrap();
    let selected_mode = set("mode", "plan").await.unwrap();
    acp.request("session/set_mode", json!({ "sessionId": session_id, "modeId": "build" })).await.unwrap();

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
        ("model", "test/missing-model", json!({ "modelId": "test/missing-model" })),
    ] {
        let error = set(config, value).await.expect_err(value);
        assert_matches(&error.json(), &json!({ "code": -32602, "data": data }));
    }
    let overlap = "test/sub/second-model";
    assert_eq!(current_value(&set("model", overlap).await.unwrap(), "model"), overlap);
    assert_eq!(current_value(&set("model", &format!("{overlap}/low")).await.unwrap(), "effort"), "low");
}

#[tokio::test]
async fn keeps_the_previous_selection_when_a_model_or_agent_switch_fails() {
    let failing = Arc::new(Mutex::new(HashSet::<String>::new()));
    let hook = failing.clone();
    let acp = start_session(
        WireOptions {
            fetch: Some(Arc::new(move |_, request| {
                if request["method"] != "POST" {
                    return None;
                }
                let kind = request["path"].as_str().and_then(|path| path.rsplit('/').next()).unwrap_or_default();
                if !lock(&hook).remove(kind) {
                    return None;
                }
                Some(Box::pin(async {
                    json_response(503, json!({ "_tag": "ServiceUnavailableError", "message": "unavailable" }))
                }))
            })),
            ..WireOptions::default()
        },
        json!({}),
    )
    .await;
    let set = |config: &str, value: &str| {
        acp.request(
            "session/set_config_option",
            json!({ "sessionId": acp.session_id, "configId": config, "value": value }),
        )
    };
    set("effort", "high").await.unwrap();
    {
        let mut set = lock(&failing);
        set.insert("model".to_owned());
        set.insert("agent".to_owned());
    }

    set("model", "test/second-model").await.unwrap_err();
    set("mode", "plan").await.unwrap_err();
    let selected = set("effort", "high").await.unwrap();

    assert_eq!(current_value(&selected, "model"), "test/test-model");
    assert_eq!(current_value(&selected, "effort"), "high");
    assert_eq!(current_value(&selected, "mode"), "build");
}

#[tokio::test]
async fn answers_with_the_newest_selection_when_an_earlier_switch_echo_lands_late() {
    let acp = start_session(WireOptions::default(), json!({})).await;
    let session_id = acp.session_id.clone();
    let set = |config: &str, value: &str| {
        acp.request("session/set_config_option", json!({ "sessionId": session_id, "configId": config, "value": value }))
    };
    let echo = |id: &str, variant: Option<&str>| {
        let mut model = json!({ "providerID": "test", "id": id });
        if let Some(variant) = variant {
            model["variant"] = json!(variant);
        }
        durable_event("session.model.selected", json!({ "sessionID": session_id, "model": model }))
    };

    set("model", "test/second-model").await.unwrap();
    set("model", "test/test-model").await.unwrap();
    acp.server.send(&[
        echo("second-model", None),
        // Selection and title events share one stream, so the title arriving means the echo was seen.
        durable_event("session.renamed", json!({ "sessionID": session_id, "title": "seen" })),
    ]);
    acp.wait_for_update("renamed", |item| item["update"]["sessionUpdate"] == "session_info_update").await;
    let selected = set("effort", "high").await.unwrap();

    assert_eq!(current_value(&selected, "model"), "test/test-model");
    assert_eq!(current_value(&selected, "effort"), "high");
    assert!(acp.updates().iter().all(|item| item["update"]["sessionUpdate"] != "config_option_update"));

    // Once its own switches are echoed, another client's switch still reaches this one.
    acp.server.send(&[echo("test-model", None), echo("test-model", Some("high")), echo("second-model", None)]);
    let update =
        acp.wait_for_update("external switch", |item| item["update"]["sessionUpdate"] == "config_option_update").await;
    assert_eq!(current_value(&update["update"], "model"), "test/second-model");
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

    let model = session["configOptions"].as_array().unwrap().iter().find(|option| option["id"] == "model").unwrap();
    assert_eq!(
        model["options"],
        json!([
            { "value": "test/second-model", "name": "Test Provider / Second Model" },
            { "value": "test/test-model", "name": "Test Provider / Test Model" },
        ])
    );
    assert_eq!(current_value(&selected, "model"), "test/second-model");
}

// Expected: models and commands that arrive after the session opened reach the client through their `*.updated`
// events, as config options and available commands.
#[tokio::test]
async fn updated_events_refresh_an_open_session() {
    let acp = start_wire(WireOptions::default()).await;
    let commands = {
        let mut state = acp.server.state();
        state.models.truncate(1);
        std::mem::take(&mut state.commands)
    };
    acp.initialize(json!({})).await;
    let session = acp.new_session("/workspace", json!([])).await.unwrap();
    acp.wait_for_update("the first commands", |item| item["update"]["sessionUpdate"] == "available_commands_update")
        .await;
    {
        let mut state = acp.server.state();
        state.models.push(second_model());
        state.commands.extend(commands);
    }
    let location = json!({ "directory": "/workspace" });
    acp.server.send(&[
        json!({ "id": "", "created": 0, "type": "model.updated", "location": location, "data": {} }),
        json!({ "id": "", "created": 0, "type": "command.updated", "location": location, "data": {} }),
    ]);

    let update = acp
        .wait_for_update("the new model", |item| {
            item["update"]["sessionUpdate"] == "config_option_update"
                && item["update"]["configOptions"].to_string().contains("test/second-model")
        })
        .await;
    assert_eq!(update["sessionId"], session["sessionId"]);
    acp.wait_for_update("the new commands", |item| {
        item["update"]["sessionUpdate"] == "available_commands_update"
            && item["update"]["availableCommands"].to_string().contains("review")
    })
    .await;
}
