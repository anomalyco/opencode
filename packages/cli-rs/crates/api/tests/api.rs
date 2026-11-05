//! Decoding rules of docs/F.2.md and the request core, over a scripted transport.

use std::sync::{Arc, Mutex};

use bytes::Bytes;
use futures_util::StreamExt;
use opencode_api::client::{Auth, Client, RequestOptions};
use opencode_api::error::Error;
use opencode_api::events::Event;
use opencode_api::generated::*;
use opencode_api::transport::{BoxFuture, Request, Response, Transport};
use serde_json::{Value, json};

/// Answers every request with one canned response and records the requests.
struct Script {
    status: u16,
    content_type: &'static str,
    body: Vec<u8>,
    requests: Mutex<Vec<Request>>,
}

impl Script {
    fn new(status: u16, content_type: &'static str, body: impl Into<Vec<u8>>) -> Arc<Self> {
        Arc::new(Self { status, content_type, body: body.into(), requests: Mutex::default() })
    }
}

impl Transport for Script {
    fn send(&self, request: Request) -> BoxFuture<'_, Result<Response, String>> {
        self.requests.lock().unwrap().push(request);
        // Two chunks, so readers cannot assume one.
        let (head, tail) = self.body.split_at(self.body.len() / 2);
        let chunks = vec![Ok(Bytes::copy_from_slice(head)), Ok(Bytes::copy_from_slice(tail))];
        let response = Response {
            status: self.status,
            headers: vec![("content-type".to_owned(), self.content_type.to_owned())],
            body: Box::pin(futures_util::stream::iter(chunks)),
        };
        Box::pin(async move { Ok(response) })
    }
}

fn client(script: &Arc<Script>) -> Client {
    Client::with_transport("http://127.0.0.1:4096", script.clone()).unwrap()
}

#[test]
fn tagged_union_decodes_known_rpc_and_unknown_members() {
    let connected: V2Event =
        serde_json::from_value(json!({ "id": "evt_1", "type": "server.connected", "data": {} })).unwrap();
    assert!(matches!(connected, V2Event::ServerConnected(_)), "{connected:?}");
    assert_eq!(connected.kind(), "server.connected");

    let rpc = json!({
        "id": "evt_2", "created": 1.5, "type": "rpc.plugin.ping",
        "location": { "directory": "/w" }, "data": { "a": 1 }
    });
    let decoded: V2Event = serde_json::from_value(rpc.clone()).unwrap();
    let V2Event::Rpc(event) = &decoded else { panic!("{decoded:?}") };
    assert_eq!(event.r#type, "rpc.plugin.ping");
    assert_eq!(event.data["a"], json!(1));
    assert_eq!(decoded.tag(), "rpc.plugin.ping");
    assert_eq!(serde_json::to_value(&decoded).unwrap(), rpc);

    // An unknown tag keeps its payload, and serializes back unchanged.
    let future = json!({ "type": "future.event", "data": { "x": [1, 2] } });
    let decoded: V2Event = serde_json::from_value(future.clone()).unwrap();
    assert_eq!(decoded, V2Event::Unknown(future.clone()));
    assert_eq!(decoded.tag(), "future.event");
    assert_eq!(serde_json::to_value(&decoded).unwrap(), future);

    // No tag at all is unknown too; a known tag with a broken payload is an error.
    assert_eq!(serde_json::from_value::<V2Event>(json!({})).unwrap(), V2Event::Unknown(json!({})));
    let error = serde_json::from_value::<V2Event>(json!({ "type": "server.connected" })).unwrap_err();
    assert!(error.to_string().contains("missing field"), "{error}");
}

#[test]
fn tagged_union_ignores_unknown_fields() {
    let event: V2Event =
        serde_json::from_value(json!({ "id": "evt_1", "type": "server.connected", "data": {}, "added": "later" }))
            .unwrap();
    assert!(matches!(event, V2Event::ServerConnected(_)));
}

#[test]
fn literal_enum_keeps_unknown_values() {
    let order: SessionListInputOrder = serde_json::from_value(json!("sideways")).unwrap();
    assert_eq!(order, SessionListInputOrder::Unknown("sideways".to_owned()));
    assert_eq!(serde_json::to_value(&order).unwrap(), json!("sideways"));
    let desc: SessionListInputOrder = serde_json::from_value(json!("desc")).unwrap();
    assert_eq!(desc, SessionListInputOrder::Desc);
}

#[test]
fn optional_nullable_fields_keep_absent_and_null_apart() {
    let decode = |value: Value| serde_json::from_value::<SessionsResponseCursor>(value).unwrap();
    assert_eq!(decode(json!({})).previous, None);
    assert_eq!(decode(json!({ "previous": null })).previous, Some(None));
    assert!(matches!(decode(json!({ "previous": "c1" })).previous, Some(Some(_))));
    assert_eq!(serde_json::to_value(decode(json!({ "previous": null }))).unwrap()["previous"], Value::Null);
    assert!(serde_json::to_value(decode(json!({}))).unwrap().get("previous").is_none());
}

#[tokio::test]
async fn data_envelope_is_unwrapped() {
    let script = Script::new(200, "application/json", r#"{"data":{"ses_1":{"type":"busy"}}}"#);
    let active = client(&script).session_active(&RequestOptions::default()).await.unwrap();
    assert_eq!(active["ses_1"].r#type, "busy");
}

#[tokio::test]
async fn declared_errors_decode_and_other_statuses_do_not() {
    let body = r#"{"_tag":"SessionNotFoundError","message":"Session not found: ses_1","sessionID":"ses_1"}"#;
    let script = Script::new(404, "application/json; charset=utf-8", body);
    let input = SessionGetInput { session_id: "ses_1".into() };
    let error = client(&script).session_get(&input, &RequestOptions::default()).await.unwrap_err();
    let declared = error.declared().expect("declared");
    assert_eq!((declared.status, declared.tag.as_deref()), (404, Some("SessionNotFoundError")));
    assert_eq!(declared.message.as_deref(), Some("Session not found: ses_1"));
    assert_eq!(error.reason(), "SessionNotFoundError");
    assert_eq!(declared.body["sessionID"], "ses_1");

    let script = Script::new(502, "text/plain", "bad gateway");
    let error = client(&script).session_get(&input, &RequestOptions::default()).await.unwrap_err();
    assert!(matches!(error, Error::UnexpectedStatus { status: 502 }), "{error:?}");
}

#[tokio::test]
async fn content_type_and_empty_bodies_are_checked() {
    let script = Script::new(200, "text/html", "<html>");
    let error = client(&script).session_active(&RequestOptions::default()).await.unwrap_err();
    assert!(matches!(error, Error::UnsupportedContentType(Some(ref value)) if value == "text/html"), "{error:?}");

    let script = Script::new(200, "application/json", "");
    let error = client(&script).session_active(&RequestOptions::default()).await.unwrap_err();
    assert!(matches!(error, Error::MalformedResponse(_)), "{error:?}");

    // A schema mismatch names the field that failed.
    let script = Script::new(200, "application/json", r#"{"data":{"ses_1":{"type":7}}}"#);
    let error = client(&script).session_active(&RequestOptions::default()).await.unwrap_err();
    assert!(error.to_string().contains("data.ses_1.type"), "{error}");
}

#[tokio::test]
async fn binary_endpoints_return_and_send_bytes() {
    let script = Script::new(200, "image/png", vec![0x89, b'P', b'N', b'G', 0, 255]);
    let input = ExperimentalMediaGetInput { hash: "abc".into() };
    let bytes = client(&script).experimental_media_get(&input, &RequestOptions::default()).await.unwrap();
    assert_eq!(bytes.as_ref(), &[0x89, b'P', b'N', b'G', 0, 255]);

    let script = Script::new(200, "application/json", r#"{"ok":true}"#);
    let input = ExperimentalFileWriteInput {
        location: None,
        path: "a.bin".to_owned(),
        payload: Bytes::from_static(&[0, 1, 2]),
    };
    let _ = client(&script).experimental_file_write(&input, &RequestOptions::default()).await;
    let request = script.requests.lock().unwrap().pop().unwrap();
    assert_eq!(request.body.as_deref(), Some(&[0, 1, 2][..]));
    assert!(request.headers.contains(&("content-type".to_owned(), "application/octet-stream".to_owned())));
}

#[tokio::test]
async fn headers_layer_client_input_then_call() {
    let script = Script::new(204, "text/plain", "");
    let client = client(&script).auth(Auth::password("secret")).header("X-Client", "a").header("x-call", "client");
    let input = SessionRemoveInput { session_id: "ses_1".into() };
    let options = RequestOptions::default().header("X-Call", "call");
    client.session_remove(&input, &options).await.unwrap();
    let request = script.requests.lock().unwrap().pop().unwrap();
    let header = |name: &str| request.headers.iter().find(|(key, _)| key == name).map(|(_, value)| value.as_str());
    assert_eq!(header("authorization"), Some("Basic b3BlbmNvZGU6c2VjcmV0"));
    assert_eq!(header("x-client"), Some("a"));
    assert_eq!(header("x-call"), Some("call"));
    assert_eq!(request.headers.iter().filter(|(key, _)| key == "x-call").count(), 1);
}

#[tokio::test]
async fn query_auth_puts_the_token_in_the_url() {
    let script = Script::new(204, "text/plain", "");
    let client = client(&script).auth(Auth::Query { username: "opencode".to_owned(), password: "secret".to_owned() });
    let input = SessionRemoveInput { session_id: "ses_1".into() };
    client.session_remove(&input, &RequestOptions::default()).await.unwrap();
    let request = script.requests.lock().unwrap().pop().unwrap();
    assert_eq!(request.url.query(), Some("auth_token=b3BlbmNvZGU6c2VjcmV0"));
    assert!(!request.headers.iter().any(|(key, _)| key == "authorization"));
}

#[tokio::test]
async fn event_stream_decodes_generated_events() {
    let body = "data: {\"id\":\"e1\",\"type\":\"server.connected\",\"data\":{}}\n\n: keepalive\n\ndata: {\"type\":\"future.event\"}\n\n";
    let script = Script::new(200, "text/event-stream", body);
    let response =
        client(&script).event_subscribe(&EventSubscribeInput::default(), &RequestOptions::default()).await.unwrap();
    let events: Vec<_> = response.events(|| {}).collect().await;
    let kinds: Vec<_> = events.iter().map(|event| event.as_ref().unwrap().kind().to_owned()).collect();
    assert_eq!(kinds, ["server.connected", "future.event"]);

    let script = Script::new(200, "application/json", "{}");
    let error =
        client(&script).event_subscribe(&EventSubscribeInput::default(), &RequestOptions::default()).await.unwrap_err();
    assert!(matches!(error, Error::UnsupportedContentType(_)), "{error:?}");
}
