//! `error.test.ts`. The log lines the TS case also checks ("ACP catalog event stream failed",
//! "ACP selection event stream failed") go to the `log` facade here and are not captured.

use serde_json::json;

use crate::wire::{Server, WireOptions, delivered, events, start_session, text_delta};

#[test]
fn wraps_unknown_defects_without_leaking_raw_details() {
    let error = opencode_acp::error::Failure::Defect {
        name: Some("Error".to_owned()),
        detail: "stack has sk-ant-secret and oauth refresh token".to_owned(),
    }
    .to_rpc();
    let serialized = error.to_json().to_string();

    assert_eq!(error.code, -32603);
    assert_eq!(error.message, "Internal error: Internal service failure");
    assert!(!serialized.contains("sk-ant-secret"));
    assert!(!serialized.contains("oauth refresh token"));
    assert!(!serialized.contains("stack"));
}

async fn unavailable(lose: fn(&Server)) {
    let acp = start_session(
        WireOptions {
            on_prompt: Some(events(|call| {
                vec![delivered(&call.session_id, &call.id), text_delta(&call.session_id, "msg_held", "working", 0)]
            })),
            ..WireOptions::default()
        },
        json!({}),
    )
    .await;
    let unavailable = json!({
        "code": -32603,
        "message": "Internal error: OpenCode server is unavailable",
        "data": { "errorName": "ServerUnavailable" },
    });

    let prompt = tokio::spawn(acp.begin_prompt("hold"));
    acp.wait_for_update("agent_message_chunk", |item| item["update"]["sessionUpdate"] == "agent_message_chunk").await;
    acp.request("session/set_mode", json!({ "sessionId": acp.session_id, "modeId": "build" })).await.unwrap();
    lose(&acp.server);

    assert_eq!(prompt.await.unwrap().unwrap_err().json(), unavailable);
    acp.server.stop();
    assert_eq!(acp.request("session/list", json!({})).await.unwrap_err().json(), unavailable);
}

#[tokio::test]
async fn reports_an_unavailable_server_when_the_event_stream_ends_mid_turn() {
    unavailable(Server::close_events).await;
}

#[tokio::test]
async fn reports_an_unavailable_server_when_the_event_stream_drops_mid_turn() {
    unavailable(Server::drop_events).await;
}
