//! OpenAPI tools against the reference, from the `openapi` section of `conformance/catalog.json`, which
//! `bun conformance/catalog.ts` generates from the reference: generated signatures and schemas, skipped operations,
//! and for each call the requests a fake client receives, the credentials resolved, and the result.

use std::sync::{Arc, Mutex};

use psychoscript::openapi::{
    self, ApiKeyLocation, AuthContext, Credential, HttpClient, HttpRequest, HttpResponse,
    SecurityScheme,
};
use psychoscript::{BoxFuture, Json, Runtime, tool_expression};
use serde_json::json;

fn fixture() -> Json {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../conformance/catalog.json"
    );
    serde_json::from_str(&std::fs::read_to_string(path).expect("catalog.json")).expect("JSON")
}

/// Answers with the reply set for the current call and records every request.
#[derive(Default)]
struct Fake {
    reply: Mutex<Json>,
    requests: Mutex<Vec<Json>>,
}

impl HttpClient for Fake {
    fn execute(&self, request: HttpRequest) -> BoxFuture<'static, Result<HttpResponse, String>> {
        let mut headers: Vec<(String, String)> = request.headers.clone();
        headers.sort();
        let headers: serde_json::Map<String, Json> = headers
            .into_iter()
            .map(|(k, v)| (k, Json::String(v)))
            .collect();
        self.requests.lock().unwrap().push(json!({
            "method": request.method,
            "url": request.url,
            "headers": headers,
            "body": request.body.map(|b| String::from_utf8(b).unwrap()),
        }));
        let reply = self.reply.lock().unwrap().clone();
        let mut response = HttpResponse {
            status: reply["status"].as_u64().unwrap_or(200) as u16,
            headers: Vec::new(),
            body: reply["body"].as_str().unwrap_or("").as_bytes().to_vec(),
        };
        if let Some(t) = reply["contentType"].as_str() {
            response.headers.push(("content-type".into(), t.into()));
        }
        if let Some(l) = reply["contentLength"].as_str() {
            response.headers.push(("content-length".into(), l.into()));
        }
        Box::pin(std::future::ready(Ok(response)))
    }
}

fn credential(v: &Json) -> Credential {
    let s = |k: &str| v[k].as_str().unwrap_or_default().to_owned();
    match v["type"].as_str() {
        Some("bearer") => Credential::Bearer { token: s("token") },
        Some("basic") => Credential::Basic {
            username: s("username"),
            password: s("password"),
        },
        Some("apiKey") => Credential::ApiKey { value: s("value") },
        _ => Credential::Header {
            name: s("name"),
            value: s("value"),
        },
    }
}

/// The resolver's context as the reference's JSON shows it.
fn context_json(c: &AuthContext) -> Json {
    let definition = match &c.definition {
        SecurityScheme::ApiKey { name, location } => json!({
            "type": "apiKey",
            "name": name,
            "in": match location {
                ApiKeyLocation::Header => "header",
                ApiKeyLocation::Query => "query",
                ApiKeyLocation::Cookie => "cookie",
            },
        }),
        SecurityScheme::Http { scheme } => json!({ "type": "http", "scheme": scheme }),
        SecurityScheme::OAuth2 => json!({ "type": "oauth2" }),
        SecurityScheme::OpenIdConnect => json!({ "type": "openIdConnect" }),
    };
    let mut operation = serde_json::Map::new();
    if let Some(id) = &c.operation.operation_id {
        operation.insert("operationId".into(), id.clone().into());
    }
    operation.insert("method".into(), c.operation.method.clone().into());
    operation.insert("path".into(), c.operation.path.clone().into());
    if let Some(s) = &c.operation.summary {
        operation.insert("summary".into(), s.clone().into());
    }
    if let Some(d) = &c.operation.description {
        operation.insert("description".into(), d.clone().into());
    }
    json!({ "name": c.name, "definition": definition, "scopes": c.scopes, "operation": operation })
}

/// JSON equality where numbers compare by value and object keys in any order.
fn same(a: &Json, b: &Json) -> bool {
    match (a, b) {
        (Json::Number(x), Json::Number(y)) => x.as_f64() == y.as_f64(),
        (Json::Array(x), Json::Array(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(x, y)| same(x, y))
        }
        (Json::Object(x), Json::Object(y)) => {
            x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| same(v, w)))
        }
        _ => a == b,
    }
}

#[test]
fn openapi_tools_match_the_reference() {
    let fixture = fixture();
    let mut failures = Vec::new();
    for case in fixture["openapi"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let client = Arc::new(Fake::default());
        let resolutions = Arc::new(Mutex::new(Vec::new()));
        let auth = case["auth"].clone();
        let seen = resolutions.clone();
        let mut options =
            openapi::Options::new(case["spec"].clone(), client.clone()).auth(move |context| {
                seen.lock().unwrap().push(context_json(context));
                Ok(auth.get(&context.name).map(credential))
            });
        if let Some(url) = case["baseUrl"].as_str() {
            options = options.base_url(url);
        }
        if let Some(headers) = case["headers"].as_object() {
            for (k, v) in headers {
                options = options.header(k, v.as_str().unwrap());
            }
        }
        let generated = match (openapi::from_spec(options), case["error"].as_str()) {
            (Err(e), Some(expected)) => {
                if e.0 != expected {
                    failures.push(format!(
                        "{name}: error\n  expected {expected}\n  actual   {e}"
                    ));
                }
                continue;
            }
            (Err(e), None) => {
                failures.push(format!("{name}: unexpected error {e}"));
                continue;
            }
            (Ok(_), Some(expected)) => {
                failures.push(format!("{name}: expected the error {expected}"));
                continue;
            }
            (Ok(g), None) => g,
        };
        let skipped: Vec<Json> = generated
            .skipped
            .iter()
            .map(|s| json!({ "method": s.method, "path": s.path, "reason": s.reason }))
            .collect();
        if !same(&Json::from(skipped.clone()), &case["skipped"]) {
            failures.push(format!(
                "{name}: skipped\n  expected {}\n  actual   {}",
                case["skipped"],
                Json::from(skipped)
            ));
        }
        let mut sorted: Vec<&(String, psychoscript::Tool)> = generated.tools.iter().collect();
        sorted.sort_by(|a, b| a.0.cmp(&b.0));
        let schemas: Vec<Json> = sorted
            .into_iter()
            .map(|(path, tool)| {
                json!({
                    "path": path,
                    "input": tool.input.document(),
                    "output": tool.output.as_ref().map(|o| o.document().clone()),
                })
            })
            .collect();
        // Key order too: the reference's schemas are JavaScript objects, and signatures render in their order.
        let (actual, expected) = (
            Json::from(schemas.clone()).to_string(),
            case["schemas"].to_string(),
        );
        if actual != expected {
            failures.push(format!(
                "{name}: schemas\n  expected {}\n  actual   {}",
                case["schemas"],
                Json::from(schemas)
            ));
        }
        let rt = generated
            .tools
            .into_iter()
            .fold(Runtime::new(), |rt, (path, tool)| {
                rt.with_tool(&format!("api.{path}"), tool)
            });
        if !case["catalog"].is_null() {
            let catalog: Vec<Json> = rt
                .catalog()
                .into_iter()
                .map(|t| json!({ "path": t.path, "description": t.description, "signature": t.signature }))
                .collect();
            for (a, e) in catalog.iter().zip(case["catalog"].as_array().unwrap()) {
                if a != e {
                    failures.push(format!(
                        "{name}: catalog\n{}\n---\n{}",
                        e["signature"], a["signature"]
                    ));
                }
            }
            if catalog.len() != case["catalog"].as_array().unwrap().len() {
                failures.push(format!("{name}: catalog has {} tools", catalog.len()));
            }
        }
        for call in case["calls"].as_array().unwrap() {
            *client.reply.lock().unwrap() = call.get("reply").cloned().unwrap_or(json!({}));
            client.requests.lock().unwrap().clear();
            resolutions.lock().unwrap().clear();
            let path = format!("api.{}", call["tool"].as_str().unwrap());
            let code = format!("return await {}({})", tool_expression(&path), call["input"]);
            let outcome = match rt.execute(&code, &serde_json::Map::new()).result {
                Ok(value) => json!({ "ok": true, "value": value }),
                Err(d) => json!({ "ok": false, "kind": d.kind.name(), "message": d.message }),
            };
            let actual = json!({
                "outcome": outcome,
                "requests": *client.requests.lock().unwrap(),
                "resolutions": *resolutions.lock().unwrap(),
            });
            let expected = json!({
                "outcome": call["outcome"],
                "requests": call["requests"],
                "resolutions": call["resolutions"],
            });
            if !same(&actual, &expected) {
                failures.push(format!(
                    "{name}: {code}\n  expected {expected}\n  actual   {actual}"
                ));
            }
        }
    }
    assert!(
        failures.is_empty(),
        "{} mismatches:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

struct Down;

impl HttpClient for Down {
    fn execute(&self, _: HttpRequest) -> BoxFuture<'static, Result<HttpResponse, String>> {
        Box::pin(std::future::ready(Err("connection refused".to_owned())))
    }
}

fn happy_path() -> Json {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../codemode/test/fixtures/openapi-happy-path.json"
    );
    serde_json::from_str(&std::fs::read_to_string(path).expect("reference fixture")).expect("JSON")
}

#[test]
fn generated_operations_are_found_by_search_and_report_transport_errors() {
    let generated = openapi::from_spec(
        openapi::Options::new(happy_path(), Arc::new(Down)).base_url("http://localhost:4096"),
    )
    .unwrap();
    let rt = generated
        .tools
        .into_iter()
        .fold(Runtime::new(), |rt, (path, tool)| {
            rt.with_tool(&format!("api.{path}"), tool)
        });
    let found = rt
        .execute(
            r#"return search({ query: "get a user", namespace: "api", limit: 1 })"#,
            &serde_json::Map::new(),
        )
        .result
        .unwrap();
    assert_eq!(found["items"][0]["path"], "tools.api.users.get");
    assert_eq!(found["items"][0]["description"], "Get a user");
    assert!(found.to_string().contains("userId: string"));
    let d = rt
        .execute(
            r#"return await tools.api.search.run({})"#,
            &serde_json::Map::new(),
        )
        .result
        .unwrap_err();
    assert_eq!(d.message, "GET /search failed: transport error");
}
