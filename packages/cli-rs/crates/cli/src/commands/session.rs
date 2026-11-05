//! `session`: list, delete, export, and import sessions
//! (`packages/cli/src/commands/handlers/session/*.ts`).

use std::io::{IsTerminal, Write};
use std::process::{Command, Stdio};

use chrono::{Local, TimeZone};
use opencode_api::client::Client;
use opencode_api::error::Error as ApiError;
use opencode_api::generated::types::{
    AbsolutePath, ExperimentalSessionExportInput, LocationGetInput, LocationQueryInput, ProjectID, SessionListInput,
    SessionListInputOrder, SessionRemoveInput,
};
use serde_json::{Map, Value};

use super::Context;
use super::client::{block_on, connect, pretty};
use crate::args::{
    SessionArgs, SessionCommand, SessionDeleteArgs, SessionExportArgs, SessionImportArgs, SessionListArgs,
    SessionListFormat,
};
use crate::output::{Exit, print};
use crate::prompt::{self, Choice, Output};

pub fn run(context: &Context, args: &SessionArgs) -> anyhow::Result<()> {
    match &args.command {
        None => crate::help::print(&["session"]),
        Some(SessionCommand::List(args)) => caught(list(context, args)),
        Some(SessionCommand::Delete(args)) => caught(delete(context, args)),
        Some(SessionCommand::Export(args)) => caught(export(context, args)),
        Some(SessionCommand::Import(args)) => import(context, args),
    }
}

// `list`, `delete`, and `export` catch every failure and print its bare message with exit 1, as their
// `Effect.catch` does with `errorMessage`. `import` lets failures escape (C40-handler-errors).
fn caught(result: anyhow::Result<()>) -> anyhow::Result<()> {
    let Err(error) = result else { return Ok(()) };
    if error.is::<Exit>() {
        return Err(error);
    }
    eprintln!("{}", message(&error));
    Err(Exit(1).into())
}

fn list(context: &Context, args: &SessionListArgs) -> anyhow::Result<()> {
    let sessions = block_on(async {
        let server = connect(context).await?;
        let location = location(&server.client, &cwd()?).await?;
        let input = SessionListInput {
            limit: Some(args.max_count.map_or(100, i64::from)),
            order: Some(SessionListInputOrder::Desc),
            parent_id: Some(None),
            project: location["project"]["id"].as_str().map(ProjectID::from),
            ..Default::default()
        };
        anyhow::Ok(data(server.client.json(Client::session_list_call(&input)?).await?))
    })??;
    if args.format == SessionListFormat::Table && sessions.is_empty() {
        return Ok(());
    }
    let output = match args.format {
        SessionListFormat::Json => pretty(&Value::Array(sessions.iter().map(summary).collect::<Vec<_>>()))?,
        SessionListFormat::Table => table(&sessions) + "\n",
    };
    if !std::io::stdout().is_terminal() || args.max_count.is_some() || args.format == SessionListFormat::Json {
        return print(&output);
    }
    page(&output)
}

// `less -R -S` reads the list on stdin and draws on the terminal; without `less`, the list is printed.
fn page(output: &str) -> anyhow::Result<()> {
    let Ok(mut pager) = Command::new("less").args(["-R", "-S"]).stdin(Stdio::piped()).spawn() else {
        return print(output);
    };
    // Quitting `less` before it read everything closes the pipe; that is not an error.
    if let Some(mut stdin) = pager.stdin.take() {
        let _ = stdin.write_all(output.as_bytes());
    }
    crate::signals::wait_child("stop pager", pager, true)?;
    Ok(())
}

// The JSON format's fields; a missing one stays missing, as `JSON.stringify` drops `undefined`.
fn summary(session: &Value) -> Value {
    let fields = [
        ("id", &["id"][..]),
        ("title", &["title"]),
        ("updated", &["time", "updated"]),
        ("created", &["time", "created"]),
        ("projectId", &["projectID"]),
        ("directory", &["location", "directory"]),
    ];
    Value::Object(
        fields
            .iter()
            .filter_map(|(key, path)| {
                let value = path.iter().try_fold(session, |value, name| value.get(name))?;
                Some((key.to_string(), value.clone()))
            })
            .collect::<Map<_, _>>(),
    )
}

fn table(sessions: &[Value]) -> String {
    sessions
        .iter()
        .map(|session| {
            let title = session["title"].as_str().unwrap_or("Untitled session").replace(['\r', '\n', '\t'], " ");
            format!("{}\t{title}\t{}", text(&session["id"]), locale_string(&session["time"]["updated"]))
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn delete(context: &Context, args: &SessionDeleteArgs) -> anyhow::Result<()> {
    block_on(async {
        let server = connect(context).await?;
        anyhow::Ok(
            server.client.session_remove(&SessionRemoveInput { session_id: args.session_id.clone().into() }).await?,
        )
    })??;
    print(&format!("Session {} deleted\n", args.session_id))
}

fn export(context: &Context, args: &SessionExportArgs) -> anyhow::Result<()> {
    if args.session.is_none() && !std::io::stdin().is_terminal() {
        anyhow::bail!("Pass a session ID when running without an interactive terminal");
    }
    let data = block_on(async {
        let server = connect(context).await?;
        let session = match &args.session {
            Some(session) => session.clone(),
            None => match pick(&server.client).await? {
                Some(session) => session,
                None => return anyhow::Ok(None),
            },
        };
        let input = ExperimentalSessionExportInput { session_id: session.into(), sanitize: Some(args.sanitize) };
        let mut response: Value = server.client.json(Client::experimental_session_export_call(&input)?).await?;
        anyhow::Ok(Some(response["data"].take()))
    })??;
    match data {
        Some(data) => print(&pretty(&data)?),
        None => Ok(()),
    }
}

// The picker of the 50 newest top-level sessions in this directory, drawn on stderr. `None` ends the
// command quietly: no sessions, or no option matched the search.
async fn pick(client: &Client) -> anyhow::Result<Option<String>> {
    let output = Output::Stderr;
    output.intro("Export session");
    let location = location(client, &cwd()?).await?;
    let input = SessionListInput {
        limit: Some(50),
        order: Some(SessionListInputOrder::Desc),
        parent_id: Some(None),
        directory: location["directory"].as_str().map(AbsolutePath::from),
        ..Default::default()
    };
    let sessions = data(client.json(Client::session_list_call(&input)?).await?);
    if sessions.is_empty() {
        output.log("No sessions found", &prompt::red(prompt::S_ERROR()));
        output.outro("Done");
        return Ok(None);
    }
    let choices = sessions
        .iter()
        .map(|session| {
            let id = text(&session["id"]);
            let label = session["title"].as_str().map_or(id.clone(), str::to_owned);
            let tail = id.chars().rev().take(8).collect::<Vec<_>>();
            let hint = format!(
                "{} - {}",
                locale_string(&session["time"]["updated"]),
                tail.into_iter().rev().collect::<String>()
            );
            Choice::new(id, label).hint(hint)
        })
        .collect();
    let selected = prompt::autocomplete("Select session to export", choices).max_items(10).output(output).prompt();
    let Ok(selected) = selected else {
        output.cancel("Cancelled");
        return Err(Exit(130).into());
    };
    output.outro("Exporting session...");
    Ok(selected)
}

fn import(context: &Context, args: &SessionImportArgs) -> anyhow::Result<()> {
    let text =
        block_on(read(&args.file))?.map_err(|error| anyhow::anyhow!("Failed to read session data: {error:#}"))?;
    let Value::Object(mut body) = serde_json::from_str::<Value>(&text)? else {
        anyhow::bail!("Expected an object, got {}", text.trim());
    };
    let directory = match &args.directory {
        Some(directory) if std::path::Path::new(directory).is_absolute() => super::debug::normalize(directory, false),
        Some(directory) => super::debug::normalize(&format!("{}/{directory}", cwd()?), false),
        None => cwd()?,
    };
    let imported = block_on(async {
        let server = connect(context).await?;
        let location = location(&server.client, &directory).await?;
        // A `location` in the file keeps its place and takes the new value, as the TS spread does.
        body.insert("location".to_owned(), serde_json::json!({ "directory": location["directory"] }));
        // The file goes as it is, unknown fields included.
        let mut call = Client::experimental_session_import_call(&Default::default())?;
        call.json(&body)?;
        // TS reads the raw response, so a declared error prints its status text, as an undeclared one does.
        let status = match server.client.json::<Value>(call).await {
            Ok(response) => return anyhow::Ok(Some(text_of(&response["data"]["id"])?)),
            Err(ApiError::UnexpectedStatus { status }) => status,
            Err(ApiError::Declared(error)) => error.status,
            Err(error) => return Err(error.into()),
        };
        if status == 409 {
            return Ok(None);
        }
        anyhow::bail!(
            "Failed to import session: {}",
            reqwest::StatusCode::from_u16(status).ok().and_then(|status| status.canonical_reason()).unwrap_or_default()
        )
    })??;
    match imported {
        Some(id) => print(&format!("Imported session: {id}\n")),
        None => {
            eprintln!("Session already exists");
            Ok(())
        }
    }
}

async fn read(file: &str) -> anyhow::Result<String> {
    if !file.starts_with("http://") && !file.starts_with("https://") {
        // Bun's wording for the common failures; others keep the OS message.
        return std::fs::read_to_string(file).map_err(|error| match error.kind() {
            std::io::ErrorKind::NotFound => {
                anyhow::anyhow!("ENOENT: no such file or directory, open '{file}'")
            }
            std::io::ErrorKind::PermissionDenied => {
                anyhow::anyhow!("EACCES: permission denied, open '{file}'")
            }
            _ => error.into(),
        });
    }
    let response = opencode_api::transport::http_client().get(file).send().await?;
    if !response.status().is_success() {
        anyhow::bail!("Failed to fetch session data: {}", response.status().canonical_reason().unwrap_or_default());
    }
    Ok(response.text().await?)
}

fn text_of(value: &Value) -> anyhow::Result<String> {
    value
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| anyhow::anyhow!("The server answered the import without a session ID"))
}

async fn location(client: &Client, directory: &str) -> Result<Value, ApiError> {
    let input = LocationGetInput { location: Some(LocationQueryInput { directory: Some(directory.to_owned()) }) };
    client.json(Client::location_get_call(&input)?).await
}

fn data(mut response: Value) -> Vec<Value> {
    match response["data"].take() {
        Value::Array(items) => items,
        _ => Vec::new(),
    }
}

fn cwd() -> anyhow::Result<String> {
    Ok(std::env::current_dir()?.to_string_lossy().into_owned())
}

// `errorMessage`: a declared error's message, else the `ClientError` message (`reason: detail`).
fn message(error: &anyhow::Error) -> String {
    match error.downcast_ref::<ApiError>().and_then(ApiError::declared) {
        Some(declared) => declared.message.clone().unwrap_or_default(),
        None => format!("{error:#}"),
    }
}

// A value in a template string: a string as it is, a missing field as `undefined`.
fn text(value: &Value) -> String {
    match value {
        Value::String(value) => value.clone(),
        Value::Null => "undefined".to_owned(),
        value => value.to_string(),
    }
}

/// `new Date(ms).toLocaleString()` as Bun writes it: `en-US` in the local time zone, whatever `LANG`
/// says, for example `11/4/2025, 4:04:05 PM`.
fn locale_string(value: &Value) -> String {
    let Some(time) = value.as_f64().and_then(|ms| Local.timestamp_millis_opt(ms as i64).single()) else {
        return "Invalid Date".to_owned();
    };
    time.format("%-m/%-d/%Y, %-I:%M:%S %p").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn table_rows_follow_format_list() {
        let sessions = [
            json!({ "id": "ses_a", "title": "one\ttwo\nthree", "time": { "updated": 0 } }),
            json!({ "id": "ses_b", "title": null, "time": {} }),
        ];
        let rows = table(&sessions);
        let rows: Vec<_> = rows.split('\n').collect();
        assert!(rows[0].starts_with("ses_a\tone two three\t"));
        assert_eq!(rows[1], "ses_b\tUntitled session\tInvalid Date");
    }

    #[test]
    fn summary_drops_missing_fields_and_keeps_order() {
        let session = json!({
            "id": "ses_a", "projectID": "prj_1",
            "time": { "created": 1, "updated": 2 },
            "location": { "directory": "/w" },
        });
        assert_eq!(
            serde_json::to_string(&summary(&session)).unwrap(),
            r#"{"id":"ses_a","updated":2,"created":1,"projectId":"prj_1","directory":"/w"}"#
        );
    }

    #[test]
    fn locale_string_is_en_us() {
        let text = locale_string(&json!(1_762_268_645_123_u64));
        let pattern = regex::Regex::new(r"^\d{1,2}/\d{1,2}/2025, \d{1,2}:\d{2}:\d{2} (AM|PM)$");
        assert!(pattern.unwrap().is_match(&text), "{text}");
    }
}
