//! Opt-in live test (`OPENCODE_LIVE=1`): the GET endpoints the TUI uses decode against the running
//! service. The URL and password come from `opencode service status` and `opencode service get password`,
//! as `script/live.sh` does. Only reads; it uses the location of an existing session, so it adds none.
//!
//! `OPENCODE_LIVE_SESSIONS` (default 20) sets how many sessions get their per-session reads.

use std::time::Duration;

use futures_util::StreamExt;
use opencode_api::client::{Auth, Client};
use opencode_api::error::Error;
use opencode_api::events::Event;
use opencode_api::generated::*;

#[derive(Default)]
struct Report {
    rows: Vec<(String, String)>,
    failures: Vec<String>,
}

impl Report {
    /// Records one call. Declared errors (such as no VCS in a directory) are answers, not failures.
    fn check<T>(&mut self, name: &str, result: Result<T, Error>, summary: impl Fn(&T) -> String) -> Option<T> {
        match result {
            Ok(value) => {
                self.rows.push((name.to_owned(), format!("ok {}", summary(&value))));
                Some(value)
            }
            Err(Error::Declared(error)) => {
                self.rows.push((name.to_owned(), format!("declared {} {}", error.status, error)));
                None
            }
            Err(error) => {
                self.rows.push((name.to_owned(), format!("FAIL {error}")));
                self.failures.push(format!("{name}: {error}"));
                None
            }
        }
    }
}

fn command(args: &[&str]) -> String {
    let output = std::process::Command::new("opencode").args(args).output().expect("opencode runs");
    assert!(output.status.success(), "opencode {args:?} failed");
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

/// The item count of a list, or of a page's `data`.
fn count<T: serde::Serialize>(value: &T) -> String {
    let value = serde_json::to_value(value).unwrap_or_default();
    match value.as_array().or_else(|| value.get("data").and_then(serde_json::Value::as_array)) {
        Some(items) => format!("({} items)", items.len()),
        None => String::new(),
    }
}

#[tokio::test]
async fn live_reads_decode() {
    if std::env::var("OPENCODE_LIVE").as_deref() != Ok("1") {
        return;
    }
    let server = command(&["service", "status"]);
    let client = Client::new(&server).unwrap().auth(Auth::password(command(&["service", "get", "password"])));
    let sessions_wanted: usize =
        std::env::var("OPENCODE_LIVE_SESSIONS").ok().and_then(|value| value.parse().ok()).unwrap_or(20);
    let mut report = Report::default();

    let info = report.check("server.info", client.server_info().await, |info| format!("version {}", info.version));
    assert!(info.is_some(), "cannot reach {server}");
    report.check("session.active", client.session_active().await, |map| format!("({} busy)", map.len()));
    report.check("credential.list", client.credential_list().await, count);
    report.check("config.shells", client.config_shells().await, |_| String::new());
    let projects = report.check("project.list", client.project_list(&ProjectListInput::default()).await, count);
    let sessions = report
        .check(
            "session.list",
            client.session_list(&SessionListInput { limit: Some(100), ..Default::default() }).await,
            count,
        )
        .map(|page| page.data)
        .unwrap_or_default();
    // Not `experimental.session.stats`: without bounds it aggregates the whole history, and the shared
    // service went down under it three times in a row.

    // Location reads, in the location of the newest session.
    if let Some(session) = sessions.first() {
        let directory = session.location.directory.to_string();
        let location = || Some(LocationQueryInput { directory: Some(directory.clone()) });
        report.check("location.get", client.location_get(&LocationGetInput { location: location() }).await, |_| {
            directory.clone()
        });
        report.check("agent.list", client.agent_list(&AgentListInput { location: location() }).await, count);
        report.check(
            "model.list",
            client.model_list(&ModelListInput { location: location(), ..Default::default() }).await,
            count,
        );
        report.check("model.default", client.model_default(&ModelDefaultInput { location: location() }).await, |_| {
            String::new()
        });
        report.check("provider.list", client.provider_list(&ProviderListInput { location: location() }).await, count);
        report.check("command.list", client.command_list(&CommandListInput { location: location() }).await, count);
        report.check("skill.list", client.skill_list(&SkillListInput { location: location() }).await, count);
        report.check(
            "reference.list",
            client.reference_list(&ReferenceListInput { location: location() }).await,
            count,
        );
        report.check("mcp.list", client.mcp_list(&McpListInput { location: location() }).await, |_| String::new());
        report.check("plugin.list", client.plugin_list(&PluginListInput { location: location() }).await, count);
        report.check(
            "integration.list",
            client.integration_list(&IntegrationListInput { location: location() }).await,
            count,
        );
        report.check("config.get", client.config_get(&ConfigGetInput { location: location() }).await, count);
        report.check("form.list", client.form_list(&FormListInput { location: location() }).await, count);
        report.check(
            "permission.request.list",
            client.permission_request_list(&PermissionRequestListInput { location: location() }).await,
            count,
        );
        report.check(
            "permission.saved.list",
            client.permission_saved_list(&PermissionSavedListInput::default()).await,
            count,
        );
        report.check("vcs.get", client.vcs_get(&VcsGetInput { location: location() }).await, |_| String::new());
        report
            .check("vcs.status", client.vcs_status(&VcsStatusInput { location: location() }).await, |_| String::new());
        report.check(
            "vcs.branch.list",
            client.vcs_branch_list(&VcsBranchListInput { location: location(), ..Default::default() }).await,
            |_| String::new(),
        );
        report.check("shell.list", client.shell_list(&ShellListInput { location: location() }).await, count);
        report.check("pty.list", client.pty_list(&PtyListInput { location: location() }).await, count);
        report.check("file.list", client.file_list(&FileListInput { location: location(), path: None }).await, count);
        if let Some(project) = projects.as_ref().and_then(|items| items.first()) {
            let input = WorktreeListInput { project_id: project.id.clone() };
            report.check("worktree.list", client.worktree_list(&input).await, count);
        }
    }

    // Per-session reads: the transcript, inbox, forms, and permissions of the newest sessions.
    let mut messages = 0;
    for session in sessions.iter().take(sessions_wanted) {
        let id = session.id.clone();
        report.check("session.get", client.session_get(&SessionGetInput { session_id: id.clone() }).await, |session| {
            session.id.to_string()
        });
        let page = report.check(
            "message.list",
            client.message_list(&MessageListInput { session_id: id.clone(), ..Default::default() }).await,
            count,
        );
        if let Some(page) = page {
            messages += page.data.len();
            if let Some(first) = page.data.first() {
                let message_id = serde_json::to_value(first).unwrap()["id"].as_str().unwrap_or_default().to_owned();
                let input = SessionMessageGetInput { session_id: id.clone(), message_id: message_id.into() };
                report.check("session.message.get", client.session_message_get(&input).await, |_| String::new());
            }
        }
        let input = SessionInboxListInput { session_id: id.clone() };
        report.check("session.inbox.list", client.session_inbox_list(&input).await, count);
        let input = SessionFormListInput { session_id: id.to_string() };
        report.check("session.form.list", client.session_form_list(&input).await, count);
        let input = PermissionListInput { session_id: id.clone() };
        report.check("permission.list", client.permission_list(&input).await, count);
        let input = SessionContextInput { session_id: id.clone() };
        report.check("session.context", client.session_context(&input).await, |_| String::new());
    }

    // The session log of the newest sessions from the start, without following: durable events and the
    // `log.synced` marker, none of them unknown (carbon-1).
    let (mut durable, mut synced, mut unknown) = (0, 0, 0);
    for session in sessions.iter().take(sessions_wanted) {
        let input = ExperimentalSessionLogInput { session_id: session.id.clone(), after: Some(0), follow: Some(false) };
        let Some(log) =
            report.check("experimental.session.log", client.experimental_session_log(&input).await, |_| String::new())
        else {
            continue;
        };
        let items: Vec<_> =
            tokio::time::timeout(Duration::from_secs(30), log.events(|| {}).collect()).await.unwrap_or_default();
        for item in items {
            match item {
                Ok(SessionLogItem::LogSynced(_)) => synced += 1,
                Ok(SessionLogItem::Durable(SessionEventDurable::Unknown(_)) | SessionLogItem::Unknown(_)) => {
                    unknown += 1
                }
                Ok(SessionLogItem::Durable(_)) => durable += 1,
                Err(error) => report.failures.push(format!("experimental.session.log {}: {error}", session.id)),
            }
        }
    }
    if unknown > 0 {
        report.failures.push(format!("experimental.session.log: {unknown} unknown items"));
    }
    report.rows.push((
        "experimental.session.log items".to_owned(),
        format!("ok {durable} durable, {synced} log.synced, {unknown} unknown"),
    ));

    // The event stream starts with `server.connected`.
    let stream = report
        .check("event.subscribe", client.event_subscribe(&EventSubscribeInput::default()).await, |_| String::new());
    if let Some(stream) = stream {
        let mut events = Box::pin(stream.events(|| {}));
        let first = tokio::time::timeout(Duration::from_secs(10), events.next()).await;
        match first {
            Ok(Some(Ok(event))) => {
                report.rows.push(("event.subscribe first".to_owned(), format!("ok {}", event.kind())))
            }
            other => report.failures.push(format!("event.subscribe first: {other:?}")),
        }
    }

    // Collapse per-session rows into one line per endpoint.
    let mut summary: Vec<(String, usize, Vec<String>)> = Vec::new();
    for (name, outcome) in &report.rows {
        match summary.iter_mut().find(|(row, ..)| row == name) {
            Some((_, calls, outcomes)) => {
                *calls += 1;
                if !outcome.starts_with("ok") {
                    outcomes.push(outcome.clone());
                }
            }
            None => summary.push((name.clone(), 1, vec![outcome.clone()])),
        }
    }
    println!("live: {server}, {} sessions read, {messages} messages decoded", sessions.len().min(sessions_wanted));
    for (name, calls, outcomes) in &summary {
        let times = if *calls > 1 { format!(" x{calls}") } else { String::new() };
        println!("  {name:<28}{times:<5} {}", outcomes.join("; "));
    }
    assert!(report.failures.is_empty(), "decode failures:\n{}", report.failures.join("\n"));
}
