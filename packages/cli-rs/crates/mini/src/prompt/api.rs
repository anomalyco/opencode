//! The requests the footer prompt makes: the completion catalogs (`catalog.shared.ts`), the file search, the
//! session's prompt history (`resolveCurrentSession`), and the turns it sends (`admitPrompt`, `runShellTurn`,
//! `session.compact`, `session.inbox.update` in `stream-v2.transport.ts` and `runtime.ts`).

use opencode_api::client::{Call, Client, RequestOptions};
use opencode_api::generated::{
    SessionID, SessionInboxCancelInput, SessionInboxDelivery, SessionInboxUpdateInput,
    SessionMessageID,
};
use serde_json::{Map, Value, json};

use super::complete::{Agent, Catalog, Command, Reference};
use super::parts::{Delivery, RunPrompt};
use crate::replay::encode;

fn error(error: opencode_api::error::Error) -> String {
    error.to_string()
}

async fn list(client: &Client, path: &str, directory: &str) -> Result<Vec<Value>, String> {
    let mut call = Call::new("GET", path.to_owned(), 200, &[400, 401, 404]);
    call.query("location", &json!({ "directory": directory }))
        .map_err(error)?;
    let value: Value = client
        .json(call, &RequestOptions::default())
        .await
        .map_err(error)?;
    Ok(value["data"].as_array().cloned().unwrap_or_default())
}

/// `loadCatalog`: agents, references, and commands of the location; a failed list is empty.
pub async fn catalog(client: &Client, directory: &str) -> Catalog {
    let (agents, references, commands) = futures_util::future::join3(
        list(client, "/api/agent", directory),
        list(client, "/api/reference", directory),
        list(client, "/api/command", directory),
    )
    .await;
    let text = |value: &Value| value.as_str().map(str::to_owned);
    Catalog {
        agents: agents
            .unwrap_or_default()
            .iter()
            .map(|agent| Agent {
                id: text(&agent["id"]).unwrap_or_default(),
                name: text(&agent["name"]).unwrap_or_default(),
                mode: text(&agent["mode"]).unwrap_or_default(),
                hidden: agent["hidden"].as_bool().unwrap_or(false),
            })
            .collect(),
        references: references
            .unwrap_or_default()
            .iter()
            .filter(|reference| !reference["hidden"].as_bool().unwrap_or(false))
            .map(|reference| Reference {
                name: text(&reference["name"]).unwrap_or_default(),
                path: text(&reference["path"]).unwrap_or_default(),
                description: text(&reference["description"])
                    .or_else(|| match reference["source"]["type"].as_str() {
                        Some("git") => text(&reference["source"]["repository"]),
                        _ => text(&reference["source"]["path"]),
                    })
                    .unwrap_or_default(),
            })
            .collect(),
        // `runCommand` keeps the name and description only.
        commands: Some(
            commands
                .unwrap_or_default()
                .iter()
                .map(|command| Command {
                    name: text(&command["name"]).unwrap_or_default(),
                    description: text(&command["description"]),
                    source: None,
                })
                .collect(),
        ),
    }
}

/// `findFiles`: the paths of the location's files that match `query`; nothing on a failure.
pub async fn find_files(client: &Client, directory: &str, query: &str) -> Vec<String> {
    let mut call = Call::new("GET", "/api/fs/find".to_owned(), 200, &[400, 401, 404]);
    let built = [
        call.query("location", &json!({ "directory": directory })),
        call.query("query", query),
        call.query("type", "file"),
    ];
    if built.iter().any(Result::is_err) {
        return Vec::new();
    }
    client
        .json::<Value>(call, &RequestOptions::default())
        .await
        .map(|value| {
            value["data"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|entry| entry["path"].as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

/// `sessionHistory` of `resolveCurrentSession`: the session's user prompts, oldest first.
pub async fn history(client: &Client, session: &str) -> Vec<RunPrompt> {
    crate::replay::messages(client, session, 200)
        .await
        .unwrap_or_default()
        .iter()
        .filter(|message| message["type"] == "user")
        .map(RunPrompt::from_message)
        .collect()
}

/// `admitPrompt`: `session.command` for a prompt that names a server command, else `session.prompt`.
pub async fn admit(
    client: &Client,
    session: &str,
    prompt: &RunPrompt,
    delivery: Delivery,
) -> Result<(), String> {
    let mut body = Map::new();
    let (path, status) = match &prompt.command {
        Some(command) => {
            body.insert("name".into(), command.name.clone().into());
            body.insert("text".into(), command.arguments.clone().into());
            ("command", 204)
        }
        None => {
            if let Some(id) = &prompt.message_id {
                body.insert("id".into(), id.clone().into());
            }
            body.insert("text".into(), prompt.text.clone().into());
            ("prompt", 200)
        }
    };
    for (key, list) in [
        ("files", prompt.files()),
        ("agents", prompt.agents()),
        ("skills", prompt.skills()),
    ] {
        if !list.is_empty() {
            body.insert(key.into(), Value::Array(list));
        }
    }
    body.insert("delivery".into(), delivery.as_str().into());
    let mut call = Call::new(
        "POST",
        format!("/api/session/{}/{path}", encode(session)),
        status,
        &[400, 401, 404, 409, 500],
    );
    call.json(&Value::Object(body)).map_err(error)?;
    if status == 204 {
        return client
            .empty(call, &RequestOptions::default())
            .await
            .map_err(error);
    }
    client
        .json::<Value>(call, &RequestOptions::default())
        .await
        .map(drop)
        .map_err(error)
}

/// `runShellTurn`: `session.shell`, which answers once the command ran.
pub async fn shell(client: &Client, session: &str, id: &str, command: &str) -> Result<(), String> {
    let mut call = Call::new(
        "POST",
        format!("/api/session/{}/shell", encode(session)),
        204,
        &[400, 401, 404, 409],
    );
    call.json(&json!({ "id": id, "command": command }))
        .map_err(error)?;
    client
        .empty(call, &RequestOptions::default())
        .await
        .map_err(error)
}

/// `session.compact`.
pub async fn compact(client: &Client, session: &str) -> Result<(), String> {
    let mut call = Call::new(
        "POST",
        format!("/api/session/{}/compact", encode(session)),
        200,
        &[400, 401, 404, 409],
    );
    call.json(&json!({})).map_err(error)?;
    client
        .json::<Value>(call, &RequestOptions::default())
        .await
        .map(drop)
        .map_err(error)
}

/// `onQueuedPromptAction`: `session.inbox.cancel` for `None`, else `session.inbox.update` to move a pending
/// prompt between queue and steer.
pub async fn queued_action(
    client: &Client,
    session: &str,
    inbox: &str,
    delivery: Option<Delivery>,
) -> Result<(), String> {
    let (session_id, inbox_id) = (
        SessionID(session.to_owned()),
        SessionMessageID(inbox.to_owned()),
    );
    let options = RequestOptions::default();
    match delivery {
        None => client
            .session_inbox_cancel(
                &SessionInboxCancelInput {
                    session_id,
                    inbox_id,
                },
                &options,
            )
            .await
            .map_err(error),
        Some(delivery) => client
            .session_inbox_update(
                &SessionInboxUpdateInput {
                    session_id,
                    inbox_id,
                    delivery: SessionInboxDelivery::from(delivery.as_str()),
                },
                &options,
            )
            .await
            .map_err(error),
    }
}

/// `switchAgent` and `switchModel` before an ordinary prompt; a command keeps the session's selection.
pub async fn select(
    client: &Client,
    session: &str,
    agent: Option<&str>,
    model: Option<&Value>,
) -> Result<(), String> {
    for (path, body) in [
        ("agent", agent.map(|agent| json!({ "agent": agent }))),
        ("model", model.map(|model| json!({ "model": model }))),
    ] {
        let Some(body) = body else { continue };
        let mut call = Call::new(
            "POST",
            format!("/api/session/{}/{path}", encode(session)),
            204,
            &[400, 401, 404],
        );
        call.json(&body).map_err(error)?;
        client
            .empty(call, &RequestOptions::default())
            .await
            .map_err(error)?;
    }
    Ok(())
}
