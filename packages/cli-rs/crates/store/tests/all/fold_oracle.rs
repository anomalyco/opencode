//! Compares store state and outgoing reads with the recorded event folds. A listed difference must still differ, so
//! stale exceptions fail.

use crate::common;

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use common::*;
use opencode_api::generated::{SessionID, V2Event};
use opencode_store::{Catalog, Data, Location, Options, Shell, State};
use opencode_util::rng::SplitMix64;
use serde_json::{Map, Value, json};

const FIXTURE: &str = include_str!("../../../../parity/fixtures/F.7/folds.json");
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
        let actual = fold(&fixture["routes"], vec![event], case["state"] == "loaded").await.remove(0);
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

/// The store after each event, with the reads it started, in the shape the TS oracle writes.
async fn fold(routes: &Value, events: Vec<V2Event>, loaded: bool) -> Vec<Value> {
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
    let mut observations = Vec::new();
    for event in events {
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
        observations.push(observed);
    }
    data.dispose();
    observations
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

/// Generated event sequences fold as in TypeScript, on an empty and on a loaded store: the recorded events, each given
/// IDs from a small pool so they meet (two sessions, messages loaded or not, tool calls, inbox items, requests, forms
/// and shells), new text, and increasing times and `durable.seq`. Text and reasoning parts start in order, as the
/// server starts them. A difference is shrunk to the fewest events. `MODEL_SEED`, `MODEL_CASES` and `MODEL_LEN` widen
/// the search; it skips without Bun.
#[test]
fn generated_sequences_fold_as_in_typescript() {
    let Some(root) = ts_root() else { return };
    let fixture: Value = serde_json::from_str(FIXTURE).unwrap();
    let templates: Vec<Value> = fixture["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|case| case["state"] == "loaded" && !case["name"].as_str().unwrap().contains("#no-previous"))
        .map(|case| case["event"].clone())
        // A reconnect reads again from routes that do not follow the events; the store model covers reconnects.
        .filter(|event| !matches!(event["type"].as_str(), Some("server.connected" | "mcp.status.changed")))
        .collect();
    let mut rng = SplitMix64(env("MODEL_SEED", 1));
    let len = env("MODEL_LEN", 12);
    let cases: Vec<(bool, Vec<Value>)> = (0..env("MODEL_CASES", 24))
        .map(|_| {
            let loaded = rng.below(4) != 0;
            (loaded, sequence(&templates, &mut rng, len, loaded))
        })
        .collect();
    let routes = &fixture["routes"];
    let runtime = tokio::runtime::Builder::new_current_thread().enable_time().build().unwrap();
    let differ = |cases: &[(bool, Vec<Value>)]| -> Vec<Option<String>> {
        let expected = bun_folds(&root, cases);
        cases
            .iter()
            .zip(expected)
            .map(|((loaded, events), expected)| {
                let decoded = events.iter().map(|event| serde_json::from_value(event.clone()).unwrap()).collect();
                let actual = runtime.block_on(fold(routes, decoded, *loaded));
                first_difference(&expected, &actual)
            })
            .collect()
    };
    let found = differ(&cases).into_iter().position(|difference| difference.is_some());
    let Some(index) = found else { return };
    // Drops one event at a time while the case still differs, all candidates of a round in one Bun run.
    let (loaded, mut events) = cases[index].clone();
    loop {
        let candidates: Vec<(bool, Vec<Value>)> = (0..events.len())
            .map(|skip| {
                (
                    loaded,
                    events.iter().enumerate().filter(|(at, _)| *at != skip).map(|(_, event)| event.clone()).collect(),
                )
            })
            .collect();
        match differ(&candidates).into_iter().position(|difference| difference.is_some()) {
            Some(at) if events.len() > 1 => events = candidates[at].1.clone(),
            _ => break,
        }
    }
    let difference = differ(&[(loaded, events.clone())]).remove(0).unwrap_or_default();
    let types: Vec<&str> = events.iter().map(|event| event["type"].as_str().unwrap()).collect();
    panic!(
        "case {index} ({}) differs; shrunk to {types:?}\n{difference}\nevents: {}",
        if loaded { "loaded" } else { "empty" },
        serde_json::to_string(&events).unwrap()
    );
}

/// The first event after which TS and Rust differ, and how.
fn first_difference(expected: &[Value], actual: &[Value]) -> Option<String> {
    expected.iter().zip(actual).enumerate().find_map(|(index, (expected, actual))| {
        let differences: Vec<String> = fields(expected, actual)
            .into_iter()
            .filter(|(_, expected, actual)| expected != actual)
            .map(|(field, expected, actual)| format!("{field}:\n  ts:   {expected}\n  rust: {actual}"))
            .collect();
        (!differences.is_empty()).then(|| format!("after event {index}: {}", differences.join("\n")))
    })
}

/// A sequence of `len` events from `templates`, with IDs from small pools.
fn sequence(templates: &[Value], rng: &mut SplitMix64, len: u64, loaded: bool) -> Vec<Value> {
    let mut seq: HashMap<String, i64> = HashMap::new();
    // Text and reasoning parts started per message; the loaded messages hold some already.
    let mut parts: HashMap<(String, String, &str), i64> = HashMap::new();
    for kind in ["text", "reasoning"] {
        parts.insert(("ses_a".into(), "msg_0005".into(), kind), 1);
    }
    parts.insert(("ses_a".into(), "msg_0002".into(), "text"), 1);
    let pick = |rng: &mut SplitMix64, items: &[&str]| items[rng.below(items.len() as u64) as usize].to_owned();
    // Events for a deleted session are left out until it is created again: Rust drops them, TS recreates the
    // session's lists (deviations O89-list-snapshots and O89-transcript-refresh).
    let mut deleted = HashSet::new();
    // Rust reads a synced transcript again for the delivery of an item it never saw admitted (deviation
    // O89-inbox-reconnect), so only admitted items, the loaded one first, are delivered.
    let mut admitted: HashSet<(String, String)> = HashSet::new();
    if loaded {
        admitted.insert(("ses_a".into(), "msg_0006".into()));
    }
    let mut calls = vec!["call_1".to_owned(), "call_2".to_owned(), "call_3".to_owned()];
    (0..len)
        .map(|serial| {
            let mut event = templates[rng.below(templates.len() as u64) as usize].clone();
            event["id"] = json!(format!("evt_{}", 9500 + serial));
            event["created"] = json!(2000 + serial);
            let kind = event["type"].as_str().unwrap().to_owned();
            let data = &mut event["data"];
            let fields: [(&str, &[&str]); 9] = [
                ("sessionID", &["ses_a", "ses_a", "ses_b"]),
                ("assistantMessageID", &["msg_0005", "msg_0005", "msg_0002", "msg_0008", "msg_0012"]),
                ("inboxID", &["msg_0006", "msg_0007", "msg_0011"]),
                ("requestID", &["per_1", "per_2", "per_3"]),
                ("to", &["msg_0002", "msg_0004", "msg_0008"]),
                ("delta", &["lo", " \u{e9}\u{1f600}", "", "\n"]),
                ("text", &["hello", "", "\u{4e2d}\u{6587}"]),
                ("started", &["30", "3000"]),
                ("inputID", &["msg_0009", "msg_0013"]),
            ];
            for (field, pool) in fields {
                if data.get(field).is_some_and(|value| value.is_string() || value.is_number()) {
                    let value = pick(rng, pool);
                    data[field] = if field == "started" { json!(value.parse::<i64>().unwrap()) } else { json!(value) };
                }
            }
            // A tool input starts once per call ID (deviation O5-text-started-replay); other tool events pick any.
            if kind == "session.tool.input.started" {
                calls.push(format!("call_new{serial}"));
                data["id"] = json!(calls.last().unwrap());
            } else if kind.starts_with("session.tool.") && data.get("id").is_some() {
                data["id"] = json!(calls[rng.below(calls.len() as u64) as usize]);
            }
            if kind.starts_with("shell.") || kind.starts_with("form.") || kind.starts_with("permission.asked") {
                let prefix = &kind[..kind.find('.').unwrap()];
                let id = format!(
                    "{}_{}",
                    match prefix {
                        "shell" => "sh",
                        "form" => "frm",
                        _ => "per",
                    },
                    1 + rng.below(3)
                );
                match kind.as_str() {
                    "shell.created" => data["info"]["id"] = json!(id),
                    "form.created" => data["form"]["id"] = json!(id),
                    _ => data["id"] = json!(id),
                }
            }
            if let Some(kind @ ("text" | "reasoning")) =
                kind.strip_prefix("session.").and_then(|rest| rest.strip_suffix(".started"))
            {
                let key = (
                    data["sessionID"].as_str().unwrap().to_owned(),
                    data["assistantMessageID"].as_str().unwrap().to_owned(),
                    if kind == "text" { "text" } else { "reasoning" },
                );
                let next = parts.entry(key).or_default();
                data["ordinal"] = json!(*next);
                *next += 1;
            }
            if event.get("durable").is_some() {
                let aggregate = event["durable"]["aggregateID"].as_str().unwrap_or_default().to_owned();
                let next = seq.entry(aggregate).or_insert(100);
                *next += 1;
                event["durable"]["seq"] = json!(*next);
            }
            event
        })
        .filter(|event| {
            let data = &event["data"];
            // TS adds the row of `session.model.selected` to a transcript some other event created empty, and reads
            // it; Rust only to a loaded one. Only the loaded transcript gets one.
            if event["type"] == "session.model.selected" && !(loaded && data["sessionID"] == "ses_a") {
                return false;
            }
            let session =
                data["sessionID"].as_str().or(data["form"]["sessionID"].as_str()).unwrap_or_default().to_owned();
            let item = (session.clone(), data["inboxID"].as_str().unwrap_or_default().to_owned());
            match event["type"].as_str() {
                Some("session.inbox.enqueued") => {
                    admitted.insert(item);
                }
                Some("session.inbox.cancelled") => {
                    admitted.remove(&item);
                }
                Some("session.revert.committed") => {
                    let to = data["to"].as_str().unwrap_or_default();
                    admitted.retain(|(owner, id)| *owner != session || id.as_str() < to);
                }
                Some("session.inbox.delivered") if !admitted.contains(&item) => return false,
                _ => {}
            }
            match event["type"].as_str() {
                Some("session.deleted") => {
                    deleted.insert(session);
                    true
                }
                Some("session.created") => {
                    deleted.remove(&session);
                    true
                }
                _ => !deleted.contains(&session),
            }
        })
        .collect()
}

fn env(name: &str, default: u64) -> u64 {
    std::env::var(name).ok().and_then(|value| value.parse().ok()).unwrap_or(default)
}

/// The TypeScript checkout with its dependencies, or `None` (and a note) without Bun.
fn ts_root() -> Option<PathBuf> {
    let root = std::env::var_os("OPENCODE_TS_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../..").canonicalize().unwrap());
    let present = root.join("node_modules").is_dir() && Command::new("bun").arg("--version").output().is_ok();
    if !present {
        assert!(
            std::env::var_os("OPENCODE_RS_REQUIRE_TS").is_none(),
            "OPENCODE_RS_REQUIRE_TS is set, but Bun is missing"
        );
        eprintln!("skipped: needs bun and {}/node_modules; set OPENCODE_TS_ROOT", root.display());
    }
    present.then_some(root)
}

/// The TypeScript store's observations after each event of each case, in one Bun run.
fn bun_folds(root: &Path, cases: &[(bool, Vec<Value>)]) -> Vec<Vec<Value>> {
    let input: String =
        cases.iter().map(|(loaded, events)| format!("{}\n", json!({ "loaded": loaded, "events": events }))).collect();
    let mut child = Command::new("bun")
        .arg("--cwd")
        .arg(root.join("packages/cli"))
        .arg(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../parity/oracle/F.7-folds.ts"))
        .arg("--sequences")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let writer = std::thread::spawn(move || stdin.write_all(input.as_bytes()).unwrap());
    let output = child.wait_with_output().unwrap();
    writer.join().unwrap();
    assert!(output.status.success(), "F.7-folds.ts --sequences failed");
    let lines: Vec<Vec<Value>> = String::from_utf8(output.stdout)
        .unwrap()
        .lines()
        .map(|line| {
            serde_json::from_str(line)
                .unwrap_or_else(|error| panic!("{error}: {}", &line[line.len().min(7600)..line.len().min(7800)]))
        })
        .collect();
    assert_eq!(lines.len(), cases.len());
    lines
}
