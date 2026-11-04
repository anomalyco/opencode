//! `additional-directories.test.ts`.

use serde_json::{Value, json};

use crate::wire::{Wire, WireOptions, assert_matches, make_session, start_wire};

const KEY: &str = "opencode.acp.additionalDirectories";

fn grant(directory: &str) -> Value {
    json!({ "action": "external_directory", "resource": format!("{directory}/*"), "effect": "allow" })
}

fn user_grant() -> Value {
    json!({ "action": "external_directory", "resource": "/x/**", "effect": "allow" })
}

fn other() -> Vec<Value> {
    vec![
        json!({ "action": "read", "resource": "*.secret", "effect": "deny" }),
        json!({ "action": "external_directory", "resource": "/shared/lib/private/*", "effect": "deny" }),
    ]
}

fn rules(first: Vec<Value>) -> Value {
    let mut all = first;
    all.extend(other());
    json!(all)
}

fn updates(acp: &Wire) -> usize {
    acp.server
        .state()
        .requests
        .iter()
        .filter(|(method, path)| method == "PATCH" && path.starts_with("/api/session/"))
        .count()
}

#[tokio::test]
async fn rejects_invalid_directories_before_creating_a_session() {
    for directory in ["shared/lib", "", "/shared/*", "/shared/lib?"] {
        let acp = start_wire(WireOptions::default()).await;
        acp.initialize(json!({})).await;

        let error = acp
            .request(
                "session/new",
                json!({ "cwd": "/workspace", "additionalDirectories": ["/shared/ok", directory], "mcpServers": [] }),
            )
            .await
            .expect_err(directory);
        assert_matches(
            &error.json(),
            &json!({ "code": -32602, "data": { "additionalDirectory": directory } }),
        );
        assert!(acp.server.state().sessions.is_empty());
    }
}

#[tokio::test]
async fn load_and_resume_replace_acp_grants_and_keep_other_session_rules_and_metadata() {
    let acp = start_wire(WireOptions::default()).await;
    let mut saved = make_session("ses_saved", "/workspace");
    saved["metadata"] = json!({ "host": "tui", (KEY): ["/old"] });
    saved["permissions"] = rules(vec![grant("/old"), user_grant()]);
    acp.server
        .state()
        .sessions
        .insert("ses_saved".to_owned(), saved);
    acp.initialize(json!({})).await;

    acp.request(
        "session/load",
        json!({
            "cwd": "/workspace", "sessionId": "ses_saved",
            "additionalDirectories": ["/shared/lib", "/product-docs"], "mcpServers": [],
        }),
    )
    .await
    .unwrap();
    assert_matches(
        &acp.server.state().sessions["ses_saved"],
        &json!({
            "metadata": { "host": "tui", (KEY): ["/shared/lib", "/product-docs"] },
            "permissions": rules(vec![grant("/shared/lib"), grant("/product-docs"), user_grant()]),
        }),
    );

    acp.request(
        "session/resume",
        json!({ "cwd": "/workspace", "sessionId": "ses_saved", "additionalDirectories": ["/shared/lib", "/product-docs"] }),
    )
    .await
    .unwrap();
    assert_eq!(updates(&acp), 1);

    acp.request(
        "session/resume",
        json!({ "cwd": "/workspace", "sessionId": "ses_saved" }),
    )
    .await
    .unwrap();
    let saved = acp.server.state().sessions["ses_saved"].clone();
    assert_eq!(saved["metadata"], json!({ "host": "tui" }));
    assert_eq!(saved["permissions"], rules(vec![user_grant()]));
    let listed = acp
        .request("session/list", json!({ "cwd": "/workspace" }))
        .await
        .unwrap();
    assert!(listed["sessions"][0].get("additionalDirectories").is_none());
}

#[tokio::test]
async fn forks_replace_inherited_grants_with_the_requested_list() {
    let acp = start_wire(WireOptions::default()).await;
    let mut source = make_session("ses_source", "/workspace");
    source["metadata"] = json!({ (KEY): ["/old"] });
    source["permissions"] = rules(vec![grant("/old")]);
    acp.server
        .state()
        .sessions
        .insert("ses_source".to_owned(), source);
    acp.initialize(json!({})).await;

    let plain = acp
        .request(
            "session/fork",
            json!({ "cwd": "/workspace", "sessionId": "ses_source" }),
        )
        .await
        .unwrap();
    let granted = acp
        .request(
            "session/fork",
            json!({ "cwd": "/workspace", "sessionId": "ses_source", "additionalDirectories": ["/shared/lib"] }),
        )
        .await
        .unwrap();

    let sessions = acp.server.state().sessions.clone();
    assert_matches(
        &sessions[plain["sessionId"].as_str().unwrap()],
        &json!({ "metadata": {}, "permissions": other() }),
    );
    assert_matches(
        &sessions[granted["sessionId"].as_str().unwrap()],
        &json!({ "metadata": { (KEY): ["/shared/lib"] }, "permissions": rules(vec![grant("/shared/lib")]) }),
    );
    assert_eq!(
        sessions["ses_source"]["permissions"],
        rules(vec![grant("/old")])
    );
}
