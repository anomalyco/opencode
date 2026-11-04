//! P-ORACLE: the generated client builds the same requests as the TypeScript Promise client.
//! `parity/oracle/F.2-requests.ts` records the TypeScript side into `parity/fixtures/F.2/requests.json`.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use base64::Engine;
use opencode_api::client::{Auth, Client, RequestOptions};
use opencode_api::generated::*;
use opencode_api::query;
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use serde_json::{Value, json};

/// Records every request and fails it, as the TypeScript oracle's fetch does.
#[derive(Default)]
struct Record(Mutex<Vec<Request>>);

impl Transport for Record {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        self.0.lock().unwrap().push(request);
        Box::pin(async { Err("recorded".to_owned()) })
    }
}

fn fixture() -> Value {
    serde_json::from_str(include_str!("../../../parity/fixtures/F.2/requests.json")).unwrap()
}

#[tokio::test]
async fn requests_match_the_typescript_client() {
    let record = Arc::new(Record::default());
    let client = Client::with_transport("http://127.0.0.1:4096/prefix", record.clone())
        .unwrap()
        .auth(Auth::Basic {
            username: "opencode".to_owned(),
            password: "secret".to_owned(),
        });
    let none = RequestOptions::default();
    let location = |directory: &str| {
        Some(LocationQueryInput {
            directory: Some(directory.to_owned()),
        })
    };
    let _ = client
        .config_get(&ConfigGetInput { location: location("/tmp/a b&c=d") }, &none)
        .await;
    let _ = client
        .session_list(
            &SessionListInput {
                limit: Some(5),
                order: Some(SessionListInputOrder::Desc),
                search: Some("héllo wörld+?".to_owned()),
                parent_id: Some(None),
                archived: Some(false),
                ..Default::default()
            },
            &none,
        )
        .await;
    let _ = client
        .session_get(
            &SessionGetInput { session_id: "ses_1 /?#%".into() },
            &RequestOptions::default().header("X-Opencode-Directory", "/override"),
        )
        .await;
    let _ = client
        .file_read(
            &FileReadInput {
                location: location("/w"),
                path: "dir/a b/c#?.txt".to_owned(),
            },
            &none,
        )
        .await;
    let _ = client
        .session_prompt(
            &SessionPromptInput {
                session_id: "ses_1".into(),
                id: None,
                text: "hi".to_owned(),
                files: None,
                agents: None,
                skills: None,
                metadata: Some(BTreeMap::from([("k".to_owned(), json!(1))])),
                delivery: None,
                resume: Some(None),
            },
            &none,
        )
        .await;
    let _ = client
        .experimental_file_write(
            &ExperimentalFileWriteInput {
                location: None,
                path: "a.txt".to_owned(),
                payload: bytes::Bytes::from_static(&[1, 2, 255]),
            },
            &none,
        )
        .await;
    let _ = client
        .event_subscribe(
            &EventSubscribeInput {
                types: Some(vec!["session.created".to_owned(), "rpc.x".to_owned()]),
            },
            &none,
        )
        .await;
    let _ = client
        .session_remove(&SessionRemoveInput { session_id: "ses_2".into() }, &none)
        .await;

    let actual = record.0.lock().unwrap();
    let expected = fixture()["requests"].as_array().unwrap().clone();
    assert_eq!(actual.len(), expected.len());
    for (request, expected) in actual.iter().zip(expected) {
        let name = expected["name"].as_str().unwrap();
        assert_eq!(request.method, expected["method"], "{name}: method");
        assert_eq!(request.url.as_str(), expected["url"], "{name}: url");
        let headers: BTreeMap<_, _> = request.headers.iter().cloned().collect();
        let wanted: BTreeMap<String, String> = serde_json::from_value(expected["headers"].clone()).unwrap();
        assert_eq!(headers, wanted, "{name}: headers");
        let body = request.body.as_ref();
        match (&expected["body"], &expected["bodyBase64"]) {
            (Value::String(text), _) => {
                assert_eq!(body.map(|body| String::from_utf8_lossy(body).into_owned()).as_deref(), Some(text.as_str()), "{name}: body")
            }
            (_, Value::String(encoded)) => {
                let bytes = base64::engine::general_purpose::STANDARD.decode(encoded).unwrap();
                assert_eq!(body.map(|body| body.to_vec()), Some(bytes), "{name}: body")
            }
            _ => assert!(body.is_none(), "{name}: no body"),
        }
    }
}

#[test]
fn query_values_match_append_query() {
    for case in fixture()["query"].as_array().unwrap() {
        let mut pairs = Vec::new();
        query::append(&mut pairs, "location", &case["value"]);
        assert_eq!(query::encode(&pairs), case["search"].as_str().unwrap(), "{}", case["value"]);
    }
}
