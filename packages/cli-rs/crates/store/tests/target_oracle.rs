//! P-ORACLE for session target resolution: serves the routes of
//! `parity/fixtures/F.8/session-target.json` (written by `parity/oracle/F.8-session-target.ts`
//! from the TS `resolveSessionTarget`, `createWorktreeLocation`, and `parseSessionTargetModel`) to
//! the Rust port, and compares the requests, what `prepare` saw, and the outcome.

mod common;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use common::*;
use opencode_api::client::Client;
use opencode_api::generated::*;
use opencode_store::target::{
    Prepared, TargetError, TargetInput, create_worktree_location, parse_model, resolve_session_target,
};
use serde_json::{Value, json};

const FIXTURE: &str = include_str!("../../../parity/fixtures/F.8/session-target.json");

/// The routes of one case, answering as the TS fake server does: the first route whose method,
/// path, and listed query values match, its replies in order with the last one repeating.
fn serve(routes: &Value, requests: &Log<Value>) -> Client {
    let routes = routes.as_array().unwrap().clone();
    let used = Arc::new(Mutex::new(HashMap::<usize, usize>::new()));
    let log = requests.clone();
    let handler = handler(move |req: Req| {
        let mut query = req.query.clone();
        query.sort();
        log.push(json!({
            "method": req.method, "path": req.path, "query": query,
            "body": req.body.clone().unwrap_or(Value::Null),
        }));
        let found = routes.iter().position(|route| {
            route["method"] == req.method.as_str()
                && route["path"] == req.path.as_str()
                && route["query"]
                    .as_object()
                    .is_none_or(|query| query.iter().all(|(key, value)| req.param(key) == value.as_str()))
        });
        let reply = found.map(|at| {
            let mut used = used.lock().unwrap();
            let index = used.entry(at).or_default();
            let replies = routes[at]["replies"].as_array().unwrap();
            let reply = replies[(*index).min(replies.len() - 1)].clone();
            *index += 1;
            reply
        });
        async move {
            let Some(reply) = reply else {
                return Reply::Text(599, format!("no route for {} {}", req.method, req.path));
            };
            let status = reply["status"].as_u64().unwrap() as u16;
            match &reply["body"] {
                Value::Null => Reply::Text(status, String::new()),
                Value::String(text) => Reply::Text(status, text.clone()),
                body => Reply::Json(status, body.clone()),
            }
        }
    });
    common::client(handler)
}

fn failure(error: &TargetError) -> Value {
    let kind = match error {
        TargetError::SessionNotFound => "not-found",
        TargetError::Mutation(_) => "mutation",
        TargetError::Request(_) | TargetError::Prepare(_) => "request",
    };
    json!({ "error": { "kind": kind } })
}

fn optional(value: &Value) -> Option<String> {
    value.as_str().map(str::to_owned)
}

#[tokio::test]
async fn session_targets_match_the_typescript_resolver() {
    let fixture: Value = serde_json::from_str(FIXTURE).unwrap();
    for case in fixture["targets"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let requests = Log::<Value>::default();
        let client = serve(&case["routes"], &requests);
        let input = &case["input"];
        let prepared = Arc::new(Mutex::new(Value::Null));
        let seen = prepared.clone();
        let agent = optional(&case["prepare"]["agent"]);
        let outcome = resolve_session_target(
            &client,
            TargetInput {
                directory: optional(&input["directory"]),
                continue_latest: input["continue"].as_bool().unwrap_or(false),
                session: optional(&input["session"]).map(SessionID),
                fork: input["fork"].as_bool().unwrap_or(false),
                model: serde_json::from_value(input["model"].clone()).unwrap(),
                agent: optional(&input["agent"]),
                environment: serde_json::from_value(input["environment"].clone()).unwrap(),
            },
            |preparation| async move {
                *seen.lock().unwrap() = json!({
                    "location": preparation.location.directory.0,
                    "session": preparation.session.as_ref().map(|session| session.id.0.clone()),
                    "model": preparation.model,
                    "agent": preparation.agent,
                });
                Ok(Prepared { model: preparation.model, agent: agent.or(preparation.agent) })
            },
        )
        .await;
        let outcome = match outcome {
            Ok(target) => json!({ "ok": {
                "session": target.session.id.0, "location": target.location.directory.0,
                "model": target.model, "agent": target.agent, "resume": target.resume,
            } }),
            Err(error) => failure(&error),
        };
        let expected = &case["expected"];
        assert_eq!(Value::Array(requests.get()), expected["requests"], "{name}: requests");
        assert_eq!(*prepared.lock().unwrap(), expected["prepared"], "{name}: prepare");
        assert_eq!(outcome, expected["outcome"], "{name}: outcome");
    }
}

#[tokio::test]
async fn worktree_locations_match_the_typescript_resolver() {
    let fixture: Value = serde_json::from_str(FIXTURE).unwrap();
    for case in fixture["worktrees"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let requests = Log::<Value>::default();
        let client = serve(&case["routes"], &requests);
        let outcome =
            create_worktree_location(&client, optional(&case["input"]["directory"]), optional(&case["input"]["name"]))
                .await;
        let outcome = match outcome {
            Ok(location) => {
                json!({ "ok": { "root": location.root, "directory": location.directory } })
            }
            Err(error) => failure(&error),
        };
        let expected = &case["expected"];
        assert_eq!(Value::Array(requests.get()), expected["requests"], "{name}: requests");
        assert_eq!(outcome, expected["outcome"], "{name}: outcome");
    }
}

#[test]
fn model_references_parse_like_typescript() {
    let fixture: Value = serde_json::from_str(FIXTURE).unwrap();
    for case in fixture["models"].as_array().unwrap() {
        let value = case["value"].as_str().unwrap();
        let actual = match parse_model(Some(value)) {
            Ok(model) => json!({ "value": value, "ok": model }),
            Err(error) => json!({ "value": value, "error": error }),
        };
        assert_eq!(actual, *case, "{value}");
    }
}
