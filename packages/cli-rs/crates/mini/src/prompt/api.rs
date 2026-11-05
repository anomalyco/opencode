//! The requests the footer prompt makes: the completion catalogs (`catalog.shared.ts`), the file search, the
//! session's prompt history (`resolveCurrentSession`), and the turns it sends (`admitPrompt`, `runShellTurn`,
//! `session.compact`, `session.inbox.update` in `stream-v2.transport.ts` and `runtime.ts`).

use opencode_api::client::{Call, Client};
use opencode_api::error::Error;
use opencode_api::generated::{
    AgentID, AgentListInput, CommandListInput, FileFindInput, FileSystemEntryType, LocationQueryInput,
    ReferenceListInput, SessionCommandInput, SessionCompactInput, SessionID, SessionInboxCancelInput,
    SessionInboxDelivery, SessionInboxUpdateInput, SessionMessageID, SessionPromptInput, SessionShellInput,
    SessionSwitchAgentInput, SessionSwitchModelInput,
};
use serde_json::{Map, Value, json};

use super::complete::{Agent, Catalog, Command, Reference};
use super::parts::{Delivery, RunPrompt};

fn error(error: Error) -> String {
    error.to_string()
}

fn location(directory: &str) -> Option<LocationQueryInput> {
    Some(LocationQueryInput { directory: Some(directory.to_owned()) })
}

async fn list(client: &Client, call: Result<Call, Error>) -> Result<Vec<Value>, String> {
    let value: Value = client.json(call.map_err(error)?).await.map_err(error)?;
    Ok(value["data"].as_array().cloned().unwrap_or_default())
}

/// `loadCatalog`: agents, references, and commands of the location; a failed list is empty.
pub async fn catalog(client: &Client, directory: &str) -> Catalog {
    let (agents, references, commands) = futures_util::future::join3(
        list(client, Client::agent_list_call(&AgentListInput { location: location(directory) })),
        list(client, Client::reference_list_call(&ReferenceListInput { location: location(directory) })),
        list(client, Client::command_list_call(&CommandListInput { location: location(directory) })),
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
                description: text(&agent["description"]),
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
    let input = FileFindInput {
        location: location(directory),
        query: query.to_owned(),
        r#type: Some(FileSystemEntryType::File),
        limit: None,
    };
    let Ok(call) = Client::file_find_call(&input) else {
        return Vec::new();
    };
    client
        .json::<Value>(call)
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
pub async fn admit(client: &Client, session: &str, prompt: &RunPrompt, delivery: Delivery) -> Result<(), String> {
    let session_id = SessionID(session.to_owned());
    let mut body = Map::new();
    // The parts pass through as the prompt holds them, so the call keeps its route and takes this body.
    let mut call = match &prompt.command {
        Some(command) => {
            body.insert("name".into(), command.name.clone().into());
            body.insert("text".into(), command.arguments.clone().into());
            Client::session_command_call(&SessionCommandInput { session_id, ..Default::default() })
        }
        None => {
            if let Some(id) = &prompt.message_id {
                body.insert("id".into(), id.clone().into());
            }
            body.insert("text".into(), prompt.text.clone().into());
            Client::session_prompt_call(&SessionPromptInput { session_id, ..Default::default() })
        }
    }
    .map_err(error)?;
    for (key, list) in [("files", prompt.files()), ("agents", prompt.agents()), ("skills", prompt.skills())] {
        if !list.is_empty() {
            body.insert(key.into(), Value::Array(list));
        }
    }
    body.insert("delivery".into(), delivery.as_str().into());
    call.json(&Value::Object(body)).map_err(error)?;
    if prompt.command.is_some() {
        return client.empty(call).await.map_err(error);
    }
    client.json::<Value>(call).await.map(drop).map_err(error)
}

/// `runShellTurn`: `session.shell`, which answers once the command ran.
pub async fn shell(client: &Client, session: &str, id: &str, command: &str) -> Result<(), String> {
    let input = SessionShellInput {
        session_id: SessionID(session.to_owned()),
        id: Some(SessionMessageID(id.to_owned())),
        command: command.to_owned(),
    };
    client.session_shell(&input).await.map_err(error)
}

/// `session.compact`.
pub async fn compact(client: &Client, session: &str) -> Result<(), String> {
    let call = Client::session_compact_call(&SessionCompactInput {
        session_id: SessionID(session.to_owned()),
        ..Default::default()
    })
    .map_err(error)?;
    client.json::<Value>(call).await.map(drop).map_err(error)
}

/// `onQueuedPromptAction`: `session.inbox.cancel` for `None`, else `session.inbox.update` to move a pending
/// prompt between queue and steer.
pub async fn queued_action(
    client: &Client,
    session: &str,
    inbox: &str,
    delivery: Option<Delivery>,
) -> Result<(), String> {
    let (session_id, inbox_id) = (SessionID(session.to_owned()), SessionMessageID(inbox.to_owned()));
    match delivery {
        None => client.session_inbox_cancel(&SessionInboxCancelInput { session_id, inbox_id }).await.map_err(error),
        Some(delivery) => client
            .session_inbox_update(&SessionInboxUpdateInput {
                session_id,
                inbox_id,
                delivery: SessionInboxDelivery::from(delivery.as_str()),
            })
            .await
            .map_err(error),
    }
}

/// `switchAgent` and `switchModel` before an ordinary prompt; a command keeps the session's selection.
pub async fn select(client: &Client, session: &str, agent: Option<&str>, model: Option<&Value>) -> Result<(), String> {
    let session_id = SessionID(session.to_owned());
    if let Some(agent) = agent {
        let input = SessionSwitchAgentInput { session_id: session_id.clone(), agent: AgentID(agent.to_owned()) };
        client.session_switch_agent(&input).await.map_err(error)?;
    }
    let Some(model) = model else { return Ok(()) };
    // The model passes through in the key order it came in.
    let mut call = Client::session_switch_model_call(&SessionSwitchModelInput { session_id, ..Default::default() })
        .map_err(error)?;
    call.json(&json!({ "model": model })).map_err(error)?;
    client.empty(call).await.map_err(error)
}
