//! `session.test.ts`.

use serde_json::{Value, json};

use crate::wire::{RpcError, Wire, WireOptions, assert_matches, lock, make_session, start_wire};

fn current_value(result: &Value, id: &str) -> Value {
    result["configOptions"]
        .as_array()
        .and_then(|options| options.iter().find(|option| option["id"] == id))
        .map(|option| option["currentValue"].clone())
        .unwrap_or(Value::Null)
}

fn error(result: Result<Value, RpcError>) -> Value {
    match result {
        Ok(value) => panic!("expected an ACP error, got {value}"),
        Err(error) => error.json(),
    }
}

#[tokio::test]
async fn initialize_advertises_capabilities_and_offers_terminal_auth_only_when_asked() {
    let acp = start_wire(WireOptions::default()).await;

    let plain = acp.initialize(json!({ "_meta": {} })).await;
    let terminal =
        acp.initialize(json!({ "_meta": { "terminal-auth": true, "opencode/child-session-updates": true } })).await;
    let standard = acp
        .request("initialize", json!({ "protocolVersion": 1, "clientCapabilities": { "auth": { "terminal": true } } }))
        .await
        .unwrap();

    assert_matches(
        &plain,
        &json!({
            "protocolVersion": 1,
            "agentCapabilities": {
                "loadSession": true,
                "mcpCapabilities": { "http": true, "sse": false },
                "promptCapabilities": { "embeddedContext": true, "image": true },
                "sessionCapabilities": { "additionalDirectories": {}, "close": {}, "delete": {}, "fork": {}, "list": {}, "resume": {} },
                "_meta": { "opencode/child-session-updates": true },
            },
            "agentInfo": { "name": "OpenCode" },
        }),
    );
    assert_eq!(
        plain["authMethods"],
        json!([{ "id": "opencode-login", "name": "Login with opencode", "description": "Run `opencode auth login` in the terminal" }])
    );
    assert_eq!(
        terminal["authMethods"][0]["_meta"],
        json!({ "terminal-auth": { "command": "opencode", "args": ["auth", "login"], "label": "OpenCode Login" } })
    );
    assert_eq!(
        standard["authMethods"],
        json!([{
            "id": "opencode-login",
            "name": "Login with opencode",
            "description": "Run `opencode auth login` in the terminal",
            "type": "terminal",
            "args": ["--login"],
        }])
    );
    assert_eq!(acp.request("authenticate", json!({ "methodId": "opencode-login" })).await.unwrap(), json!({}));
    assert_matches(
        &error(acp.request("authenticate", json!({ "methodId": "missing" })).await),
        &json!({ "code": -32602, "data": { "methodId": "missing" } }),
    );
    assert_eq!(acp.request("initialize", json!({ "protocolVersion": 99 })).await.unwrap()["protocolVersion"], json!(1));
}

#[tokio::test]
async fn load_resume_and_fork_keep_the_selection_and_check_the_directory() {
    let acp = start_wire(WireOptions::default()).await;
    {
        let mut state = acp.server.state();
        let mut loaded = make_session("ses_loaded", "/workspace");
        loaded["agent"] = json!("plan");
        loaded["model"] = json!({ "providerID": "test", "id": "second-model", "variant": "medium" });
        state.sessions.insert("ses_loaded".to_owned(), loaded);
        let mut resume = make_session("ses_resume", "/workspace");
        resume["agent"] = json!("plan");
        resume["model"] = json!({ "providerID": "test", "id": "second-model", "variant": "low" });
        state.sessions.insert("ses_resume".to_owned(), resume);
        let history: Vec<Value> = (0..201)
            .map(|index| json!({ "id": format!("msg_{index}"), "type": "user", "text": format!("message {index}"), "time": { "created": index } }))
            .collect();
        state.messages.insert("ses_loaded".to_owned(), history);
        state.messages.insert(
            "ses_resume".to_owned(),
            vec![json!({ "id": "msg_resume", "type": "user", "text": "hidden", "time": { "created": 1 } })],
        );
    }
    acp.initialize(json!({})).await;
    let params = |cwd: &str, id: &str| json!({ "cwd": cwd, "sessionId": id, "mcpServers": [] });

    let loaded = acp.request("session/load", params("/workspace", "ses_loaded")).await.unwrap();
    let resumed = acp.request("session/resume", params("/workspace", "ses_resume")).await.unwrap();
    let forked = acp.request("session/fork", params("/workspace", "ses_loaded")).await.unwrap();

    assert_matches(
        &error(acp.request("session/load", params("/elsewhere", "ses_loaded")).await),
        &json!({ "code": -32602, "data": { "sessionId": "ses_loaded", "cwd": "/elsewhere" } }),
    );
    let sessions: Vec<String> = acp.server.state().sessions.keys().cloned().collect();
    assert_matches(
        &error(acp.request("session/fork", params("/elsewhere", "ses_loaded")).await),
        &json!({ "code": -32602, "data": { "sessionId": "ses_loaded", "cwd": "/elsewhere" } }),
    );
    assert_eq!(acp.server.state().sessions.keys().cloned().collect::<Vec<_>>(), sessions);
    assert_matches(
        &error(acp.request("session/load", params("/workspace", "ses_missing")).await),
        &json!({ "code": -32602, "data": { "sessionId": "ses_missing" } }),
    );
    assert_eq!(current_value(&loaded, "model"), json!("test/second-model"));
    assert_eq!(current_value(&loaded, "effort"), json!("medium"));
    assert_eq!(current_value(&loaded, "mode"), json!("plan"));
    assert_eq!(current_value(&resumed, "effort"), json!("low"));
    assert_eq!(current_value(&forked, "effort"), json!("medium"));
    let forked_id = forked["sessionId"].as_str().unwrap();
    assert!(acp.server.state().sessions.contains_key(forked_id));
    let replayed = |session_id: &str| -> Vec<Value> {
        acp.updates()
            .into_iter()
            .filter(|item| item["sessionId"] == session_id && item["update"]["sessionUpdate"] == "user_message_chunk")
            .map(|item| item["update"].clone())
            .collect()
    };
    let loaded_ids: Vec<Value> = replayed("ses_loaded").iter().map(|update| update["messageId"].clone()).collect();
    let history: Vec<Value> = (0..201).map(|index| json!(format!("msg_{index}"))).collect();
    assert_eq!(loaded_ids, history);
    assert!(replayed(forked_id).is_empty());
    assert!(replayed("ses_resume").is_empty());
    assert_eq!(
        replayed("ses_loaded")[0],
        json!({ "sessionUpdate": "user_message_chunk", "messageId": "msg_0", "content": { "type": "text", "text": "message 0" } })
    );
}

// Labels what the agent sends from the request until the commands that follow it, in wire order.
async fn until_commands(acp: &Wire, method: &str, params: Value) -> Vec<String> {
    let start = lock(&acp.received).len();
    acp.request(method, params).await.unwrap();
    acp.until("available commands", || {
        let labels: Vec<String> = lock(&acp.received)[start..]
            .iter()
            .map(|message| match message["method"].as_str() {
                Some("session/update") => {
                    message["params"]["update"]["sessionUpdate"].as_str().unwrap_or_default().to_owned()
                }
                Some(method) => method.to_owned(),
                None => "response".to_owned(),
            })
            .collect();
        labels.iter().any(|label| label == "available_commands_update").then_some(labels)
    })
    .await
}

#[tokio::test]
async fn publishes_a_sessions_commands_after_the_response_that_attaches_it() {
    let acp = start_wire(WireOptions::default()).await;
    acp.server.state().sessions.insert("ses_loaded".to_owned(), make_session("ses_loaded", "/workspace"));
    acp.server.state().messages.insert(
        "ses_loaded".to_owned(),
        vec![json!({ "id": "msg_0", "type": "user", "text": "hello", "time": { "created": 0 } })],
    );
    acp.initialize(json!({})).await;
    let params = json!({ "cwd": "/workspace", "sessionId": "ses_loaded", "mcpServers": [] });
    let expected = vec!["response".to_owned(), "available_commands_update".to_owned()];

    assert_eq!(until_commands(&acp, "session/new", json!({ "cwd": "/workspace", "mcpServers": [] })).await, expected);
    assert_eq!(
        until_commands(&acp, "session/load", params.clone()).await,
        ["user_message_chunk", "response", "available_commands_update"]
    );
    assert_eq!(until_commands(&acp, "session/resume", params.clone()).await, expected);
    assert_eq!(until_commands(&acp, "session/fork", params).await, expected);
}

#[tokio::test]
async fn converts_mcp_configs_and_deduplicates_registrations_per_session_and_config() {
    let local =
        json!({ "name": "tools", "command": "bun", "args": ["server.ts"], "env": [{ "name": "TOKEN", "value": "x" }] });
    let mut changed = local.clone();
    changed["args"] = json!(["changed.ts"]);
    let remote = json!({
        "type": "http", "name": "docs", "url": "https://example.com/mcp",
        "headers": [{ "name": "Authorization", "value": "Bearer x" }],
    });
    let acp = start_wire(WireOptions::default()).await;
    acp.initialize(json!({})).await;

    let first = acp.new_session("/workspace", json!([local, local, remote])).await.unwrap();
    let id = first["sessionId"].as_str().unwrap();
    for servers in [json!([local, remote]), json!([changed]), json!([local])] {
        acp.request("session/resume", json!({ "cwd": "/workspace", "sessionId": id, "mcpServers": servers }))
            .await
            .unwrap();
    }

    let local_config = |args: &[&str]| {
        let mut command = vec![json!("bun")];
        command.extend(args.iter().map(|arg| json!(arg)));
        json!({
            "name": "tools", "directory": "/workspace",
            "config": { "type": "local", "command": command, "environment": { "TOKEN": "x" } },
        })
    };
    let tools = |acp: &Wire| -> Vec<Value> {
        acp.server.state().mcp.iter().filter(|item| item["name"] == "tools").cloned().collect()
    };
    assert_eq!(
        tools(&acp),
        vec![local_config(&["server.ts"]), local_config(&["changed.ts"]), local_config(&["server.ts"]),]
    );

    acp.new_session("/workspace", json!([local])).await.unwrap();

    assert_eq!(acp.server.state().mcp.len(), 5);
    assert_eq!(
        tools(&acp),
        vec![
            local_config(&["server.ts"]),
            local_config(&["changed.ts"]),
            local_config(&["server.ts"]),
            local_config(&["server.ts"]),
        ]
    );
    assert_eq!(
        acp.server.state().mcp.iter().find(|item| item["name"] == "docs").cloned(),
        Some(json!({
            "name": "docs", "directory": "/workspace",
            "config": { "type": "remote", "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer x" }, "oauth": false },
        }))
    );
}

#[tokio::test]
async fn rejects_relative_cwds_mcp_over_acp_and_sse_servers_before_creating_or_loading() {
    let acp = start_wire(WireOptions::default()).await;
    acp.server.state().sessions.insert("ses_saved".to_owned(), make_session("ses_saved", "/workspace"));
    acp.initialize(json!({})).await;
    let existing: Vec<String> = acp.server.state().sessions.keys().cloned().collect();
    let mcp_servers = json!([{ "type": "acp", "name": "client", "serverId": "mcp_client" }]);
    let sse = json!([{ "type": "sse", "name": "events", "url": "https://example.com/sse", "headers": [] }]);
    let invalid = json!({
        "code": -32602,
        "message": "Invalid params: Only stdio and HTTP MCP servers are supported",
        "data": { "field": "mcpServers" },
    });
    let relative = json!({
        "code": -32602,
        "message": "Invalid params: cwd must be an absolute path: workspace",
        "data": { "field": "cwd" },
    });

    assert_eq!(error(acp.new_session("/workspace", mcp_servers.clone()).await), invalid);
    assert_eq!(error(acp.new_session("/workspace", sse).await), invalid);
    assert_eq!(
        error(
            acp.request(
                "session/load",
                json!({ "cwd": "/workspace", "sessionId": "ses_saved", "mcpServers": mcp_servers }),
            )
            .await
        ),
        invalid
    );
    assert_eq!(error(acp.new_session("workspace", json!([])).await), relative);
    assert_eq!(
        error(
            acp.request("session/load", json!({ "cwd": "workspace", "sessionId": "ses_saved", "mcpServers": [] }),)
                .await
        ),
        relative
    );
    assert_eq!(error(acp.request("session/list", json!({ "cwd": "workspace" })).await), relative);
    assert_matches(
        &error(acp.request("session/list", json!({ "cwd": "" })).await),
        &json!({ "code": -32602, "data": { "field": "cwd" } }),
    );
    assert_eq!(acp.server.state().sessions.keys().cloned().collect::<Vec<_>>(), existing);
    assert!(acp.server.state().requests.iter().all(|(_, path)| !path.contains("ses_saved")));
}

#[tokio::test]
async fn lists_sessions_with_titles_and_update_times() {
    let acp = start_wire(WireOptions::default()).await;
    {
        let mut state = acp.server.state();
        let mut titled = make_session("ses_titled", "/workspace");
        titled["time"] = json!({ "created": 0, "updated": 1_700_000_000_123_u64 });
        state.sessions.insert("ses_titled".to_owned(), titled);
        let mut untitled = make_session("ses_untitled", "/workspace");
        untitled.as_object_mut().unwrap().remove("title");
        state.sessions.insert("ses_untitled".to_owned(), untitled);
    }
    acp.initialize(json!({})).await;

    let listed = acp.request("session/list", json!({ "cwd": "/workspace" })).await.unwrap();

    assert_eq!(
        listed,
        json!({
            "sessions": [
                { "sessionId": "ses_titled", "cwd": "/workspace", "title": "Session ses_titled", "updatedAt": "2023-11-14T22:13:20.123Z" },
                { "sessionId": "ses_untitled", "cwd": "/workspace", "title": "New session - 1970-01-01T00:00:00.000Z", "updatedAt": "1970-01-01T00:00:00.000Z" },
            ],
        })
    );
}

#[tokio::test]
async fn answers_protocol_errors_and_unknown_methods() {
    let acp = start_wire(WireOptions::default()).await;

    assert_eq!(
        error(acp.request("session/unknown", json!({})).await),
        json!({ "code": -32601, "message": "\"Method not found\": session/unknown", "data": { "method": "session/unknown" } })
    );
    assert_eq!(
        error(acp.request("session/new", json!({ "mcpServers": [] })).await),
        json!({
            "code": -32602,
            "message": "Invalid params",
            "data": { "_errors": [], "cwd": { "_errors": ["Invalid input: expected string, received undefined"] } },
        })
    );
}
