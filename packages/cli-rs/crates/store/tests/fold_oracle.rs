//! P-ORACLE for the event fold (models step 7): folds every event of `parity/fixtures/F.7/folds.json`
//! (written by `parity/oracle/F.7-folds.ts` from the TS `createData`) with `Data::apply`, on an empty store and on
//! one loaded from the fixture's routes, and compares what the store holds and which reads the event started, field
//! by field. A difference the fixture's `allow` list names with its deviation file passes; an allow entry that no
//! longer differs fails, so the list stays current.

mod common;

use std::collections::{BTreeMap, BTreeSet};

use common::*;
use opencode_api::generated::{SessionID, V2Event};
use opencode_store::{Catalog, Data, Location, Options, Shell, State};
use serde_json::{Map, Value, json};

const FIXTURE: &str = include_str!("../../../parity/fixtures/F.7/folds.json");
const DEVIATIONS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../../parity/deviations");
const SESSIONS: [&str; 2] = ["ses_a", "ses_b"];
const DIRECTORY: &str = "/project";

#[tokio::test]
async fn every_event_folds_as_in_typescript() {
    let fixture: Value = serde_json::from_str(FIXTURE).unwrap();
    let allowed: BTreeMap<(String, String), String> = fixture["allow"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| {
            let deviation = entry["deviation"].as_str().unwrap().to_owned();
            assert!(
                std::path::Path::new(DEVIATIONS).join(&deviation).exists(),
                "allow entry names a missing deviation file: {deviation}"
            );
            ((entry["case"].as_str().unwrap().to_owned(), entry["field"].as_str().unwrap().to_owned()), deviation)
        })
        .collect();

    let cases = fixture["cases"].as_array().unwrap();
    let covered: BTreeSet<&str> = cases.iter().map(|case| case["event"]["type"].as_str().unwrap()).collect();
    for variant in fixture["variants"].as_array().unwrap() {
        assert!(covered.contains(variant.as_str().unwrap()), "no case for {variant}");
    }

    let mut differences = Vec::new();
    let mut used = BTreeSet::new();
    for case in cases {
        let name = format!("{}@{}", case["name"].as_str().unwrap(), case["state"].as_str().unwrap());
        let event: V2Event = serde_json::from_value(case["event"].clone())
            .unwrap_or_else(|error| panic!("{name}: the event does not decode: {error}"));
        assert!(!matches!(event, V2Event::Unknown(_)), "{name}: the event decodes as unknown");
        let actual = fold(&fixture["routes"], event, case["state"] == "loaded").await;
        for (field, expected, actual) in fields(&case["expected"], &actual) {
            if expected == actual {
                continue;
            }
            let key = (name.clone(), field.clone());
            if allowed.contains_key(&key) {
                used.insert(key);
                continue;
            }
            differences.push(format!("{name} {field}:\n  ts:   {expected}\n  rust: {actual}"));
        }
    }
    for (key, deviation) in &allowed {
        if !used.contains(key) {
            differences.push(format!("{} {}: allowed by {deviation}, but no longer differs", key.0, key.1));
        }
    }
    assert!(differences.is_empty(), "{} fold differences:\n{}", differences.len(), differences.join("\n"));
}

/// The store after `event`, with the reads it started, in the shape the TS oracle writes.
async fn fold(routes: &Value, event: V2Event, loaded: bool) -> Value {
    let requests = Log::<String>::default();
    let log = requests.clone();
    let routes = routes.clone();
    let data = data(
        handler(move |req: Req| {
            let mut query: Vec<String> = req.query.iter().map(|(key, value)| format!("{key}={value}")).collect();
            query.sort();
            let query = if query.is_empty() { String::new() } else { format!("?{}", query.join("&")) };
            log.push(format!("{} {}{query}", req.method, req.path));
            let route = (req.method == "GET").then(|| routes.get(&req.path).cloned()).flatten();
            async move {
                match route {
                    Some(route) => Reply::Json(route["status"].as_u64().unwrap() as u16, route["body"].clone()),
                    None => Reply::Text(599, format!("no route for {} {}", req.method, req.path)),
                }
            }
        }),
        Options::default(),
    );
    data.on_error(|_| {});
    if loaded {
        data.apply(&[common::event(json!({ "id": "evt_connected", "type": "server.connected", "data": {} }))]);
        quiet(&data, &requests).await;
        let session = SessionID("ses_a".into());
        // The reads start at once and run together, as the TS ones do.
        futures_util::future::join_all([
            data.session_sync(&session, false),
            data.message_sync(&session),
            data.permission_sync(&session),
            data.form_sync("ses_a", None),
            data.pending_sync(&session),
            data.location_sync(None),
            data.catalog_sync(Catalog::Config, None),
            data.catalog_sync(Catalog::UsageLimits, None),
            data.websearch_refresh(None),
        ])
        .await;
        quiet(&data, &requests).await;
    }
    let before = requests.len();
    let mcp = matches!(event, V2Event::McpStatusChanged(_));
    data.apply(&[event]);
    quiet(&data, &requests).await;
    // `mcp.status.changed` reads once its burst has been quiet for `SETTLE`.
    if mcp {
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        quiet(&data, &requests).await;
    }
    let mut observed = data.read(observe);
    let mut started = requests.get().split_off(before);
    started.sort();
    observed["requests"] = json!(started);
    data.dispose();
    observed
}

/// Lets spawned reads run until no request and no change happens for a while.
async fn quiet(data: &Data, requests: &Log<String>) {
    let mut last = (usize::MAX, u64::MAX);
    let mut turns = 0;
    while turns < 50 {
        tokio::task::yield_now().await;
        let now = (requests.len(), data.revision());
        turns = if now == last { turns + 1 } else { 0 };
        last = now;
    }
}

fn observe(state: &State) -> Value {
    let each = |read: &dyn Fn(&SessionID) -> Option<Value>| -> Value {
        SESSIONS
            .iter()
            .filter_map(|id| read(&SessionID((*id).into())).map(|value| ((*id).to_owned(), value)))
            .collect::<Map<_, _>>()
            .into()
    };
    let location = Location::new(DIRECTORY);
    let mut forms = each(&|id| {
        state.forms(&id.0, None).map(|forms| json!(forms.iter().map(|form| form_json(form)).collect::<Vec<_>>()))
    });
    if let Some(global) = state.forms(opencode_store::forms::GLOBAL, Some(&location)) {
        forms["global"] = json!(global.iter().map(|form| form_json(form)).collect::<Vec<_>>());
    }
    json!({
        "sessions": state.sessions().into_iter().map(|info| (info.id.0.clone(), json!(info))).collect::<Map<_, _>>(),
        "missing": SESSIONS.iter().filter(|id| state.is_missing(&SessionID((**id).into()))).collect::<Vec<_>>(),
        "family": each(&|id| Some(json!(state.family(id)))),
        "status": each(&|id| Some(json!(match state.status(id) {
            opencode_store::SessionStatus::Idle => "idle",
            opencode_store::SessionStatus::Running => "running",
        }))),
        "messages": each(&|id| Some(json!(state.messages(id)))),
        "more": each(&|id| Some(json!(state.has_more_messages(id)))),
        "pending": each(&|id| Some(json!(state.pending(id)))),
        "permissions": each(&|id| state.permissions(id).map(|list| json!(list))),
        "forms": forms,
        "projects": state.projects().into_iter().map(|project| (project.id.0.clone(), json!(project))).collect::<Map<_, _>>(),
        "location": location_json(state, &location),
    })
}

fn location_json(state: &State, location: &Location) -> Value {
    let mut out = Map::new();
    let shells: Vec<Value> = state.shells(Some(location)).into_iter().map(shell_json).collect();
    if let Some(data) = state.location(Some(location)) {
        let mut put = |key: &str, value: Option<Value>| {
            if let Some(value) = value {
                out.insert(key.to_owned(), value);
            }
        };
        put("info", data.info.as_ref().map(|value| json!(value)));
        put("vcs", data.vcs.as_ref().map(|value| json!(value)));
        put("agent", data.agent.as_ref().map(|value| json!(value)));
        put("command", data.command.as_ref().map(|value| json!(value)));
        put("config", data.config.as_ref().map(|value| json!(value)));
        put("integration", data.integration.as_ref().map(|value| json!(value)));
        put("mcpServer", data.mcp_server.as_ref().map(|value| json!(value)));
        put("mcpResource", data.mcp_resource.as_ref().map(|value| json!(value)));
        put("model", data.model.as_ref().map(|value| json!(value)));
        put("provider", data.provider.as_ref().map(|value| json!(value)));
        put("reference", data.reference.as_ref().map(|value| json!(value)));
        put("skill", data.skill.as_ref().map(|value| json!(value)));
        put("websearch", data.websearch.as_ref().map(|value| json!(value)));
        put("usageLimits", data.usage_limits.as_ref().map(|value| json!(value)));
    }
    out.insert("shell".into(), json!(shells));
    out.into()
}

fn with_location(mut value: Value, location: &Location) -> Value {
    let mut at = json!({ "directory": location.directory });
    if let Some(workspace) = &location.workspace_id {
        at["workspaceID"] = json!(workspace);
    }
    value["location"] = at;
    value
}

fn shell_json(shell: &Shell) -> Value {
    with_location(json!(shell.info), &shell.location)
}

fn form_json(form: &opencode_store::Form) -> Value {
    match &form.location {
        Some(location) => with_location(json!(form.info), location),
        None => json!(form.info),
    }
}

/// The compared fields: each key of an object field (`messages.ses_a`), or the whole field.
fn fields(expected: &Value, actual: &Value) -> Vec<(String, Value, Value)> {
    let keys: BTreeSet<&String> =
        expected.as_object().unwrap().keys().chain(actual.as_object().unwrap().keys()).collect();
    keys.into_iter()
        .flat_map(|key| {
            let (expected, actual) =
                (expected.get(key).cloned().unwrap_or(Value::Null), actual.get(key).cloned().unwrap_or(Value::Null));
            match (&expected, &actual) {
                (Value::Object(left), Value::Object(right)) => {
                    let inner: BTreeSet<&String> = left.keys().chain(right.keys()).collect();
                    inner
                        .into_iter()
                        .map(|inner| {
                            let missing = || Value::String("<absent>".into());
                            (
                                format!("{key}.{inner}"),
                                left.get(inner).cloned().unwrap_or_else(missing),
                                right.get(inner).cloned().unwrap_or_else(missing),
                            )
                        })
                        .collect::<Vec<_>>()
                }
                _ => vec![(key.clone(), expected, actual)],
            }
        })
        .collect()
}
