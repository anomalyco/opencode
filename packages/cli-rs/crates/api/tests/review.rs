use opencode_api::error::{DeclaredError, TaggedError};
use opencode_api::generated::*;
use serde_json::json;

#[test]
fn session_log_routes_log_synced_and_durable_events() {
    let synced: SessionLogItem =
        serde_json::from_value(json!({ "type": "log.synced", "aggregateID": "ses_1", "seq": 4 })).unwrap();
    let SessionLogItem::LogSynced(item) = &synced else { panic!("{synced:?}") };
    assert_eq!(item.aggregate_id, "ses_1");
    assert_eq!(synced.tag(), "log.synced");

    let unknown: SessionLogItem = serde_json::from_value(json!({ "type": "session.future" })).unwrap();
    assert!(matches!(unknown, SessionLogItem::Unknown(_)), "{unknown:?}");
}

#[test]
fn non_empty_arrays_keep_their_item_type() {
    let form: FormInfo = serde_json::from_value(json!({
        "id": "frm_1", "sessionID": "ses_1", "title": "Deploy",
        "fields": [{ "key": "env", "type": "string", "title": "Environment" }]
    }))
    .unwrap();
    let FormField::String(field) = &form.fields[0] else { panic!("{:?}", form.fields) };
    assert_eq!(field.key, "env");

    let content: Vec<ToolContent> = serde_json::from_value(json!([
        { "type": "text", "text": "ok" },
        { "type": "file", "uri": "data:image/png;base64,AA", "mime": "image/png" }
    ]))
    .unwrap();
    assert!(matches!(&content[0], ToolContent::Text(text) if text.text == "ok"));
    assert!(matches!(&content[1], ToolContent::File(file) if file.mime == "image/png"));
}

#[test]
fn lsp_server_entry_with_disabled_keeps_its_command() {
    let entry: ConfigEntryDocumentInfoLspObjectValue =
        serde_json::from_value(json!({ "command": ["rust-analyzer"], "disabled": false, "extensions": [".rs"] }))
            .unwrap();
    let ConfigEntryDocumentInfoLspObjectValue::Object2(server) = &entry else { panic!("{entry:?}") };
    assert_eq!(server.command, ["rust-analyzer"]);
    assert_eq!(server.disabled, Some(false));

    let disabled: ConfigEntryDocumentInfoLspObjectValue = serde_json::from_value(json!({ "disabled": true })).unwrap();
    assert!(matches!(disabled, ConfigEntryDocumentInfoLspObjectValue::Object(_)), "{disabled:?}");
}

#[test]
fn declared_error_decode_checks_the_tag() {
    let error = DeclaredError::new(
        404,
        json!({ "_tag": "SessionNotFoundError", "sessionID": "ses_1", "message": "Session not found" }),
    );
    assert!(error.decode::<InvalidCursorError>().is_err());
    assert!(!error.is::<InvalidCursorError>());
    assert!(error.is::<SessionNotFoundError>());
    let decoded = error.decode::<SessionNotFoundError>().unwrap();
    assert_eq!(decoded.tag, SessionNotFoundError::TAG);
}
