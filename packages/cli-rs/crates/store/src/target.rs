//! Session target resolution (D03), ported from `packages/cli/src/session-target.ts`: which
//! session `run`, `mini`, and the TUI open for `--session`, `--continue`, and `--fork`, at which
//! location, with which model and agent; and new worktree locations.

use std::future::Future;

use indexmap::IndexMap;
use opencode_api::client::{Client, RequestOptions};
use opencode_api::generated::*;

/// Sessions per page while looking for the latest session of a directory.
const SESSION_PAGE_LIMIT: i64 = 50;

/// What to open. Every field is optional; the default creates a new session at the server's
/// default location.
#[derive(Debug, Clone, Default)]
pub struct TargetInput {
    /// The location directory; the server's default when `None`.
    pub directory: Option<String>,
    /// Continue the latest top-level, unarchived session of the location (`--continue`).
    pub continue_latest: bool,
    /// Open this session, or create it with this ID when it does not exist (`--session`).
    pub session: Option<SessionID>,
    /// Fork the selected session and open the fork (`--fork`).
    pub fork: bool,
    pub model: Option<ModelRef>,
    pub agent: Option<String>,
    /// Uploaded to the resolved session ([`crate::environment`]).
    pub environment: Option<IndexMap<String, String>>,
}

/// What `prepare` sees before a session is created: the requested model and agent, or the
/// selected session's.
#[derive(Debug, Clone)]
pub struct Preparation {
    pub location: LocationPublicInfo,
    pub session: Option<SessionInfo>,
    pub model: Option<ModelRef>,
    pub agent: Option<String>,
}

/// The model and agent to use, as `prepare` resolved them.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Prepared {
    pub model: Option<ModelRef>,
    pub agent: Option<String>,
}

#[derive(Debug, Clone)]
pub struct SessionTarget {
    pub session: SessionInfo,
    pub location: LocationPublicInfo,
    pub model: Option<ModelRef>,
    pub agent: Option<String>,
    /// True when an existing session (or a fork of one) was selected.
    pub resume: bool,
}

#[derive(Debug)]
pub enum TargetError {
    /// `--fork` named a session that does not exist.
    SessionNotFound,
    /// A create, fork, or environment upload failed. The server may have applied it, so callers
    /// must not retry (`SessionTargetMutationError`).
    Mutation(opencode_api::error::Error),
    /// A read failed.
    Request(opencode_api::error::Error),
    /// `prepare` failed.
    Prepare(String),
}

impl std::fmt::Display for TargetError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TargetError::SessionNotFound => f.write_str("Session not found"),
            // `SessionTargetMutationError` and a rethrown client error both read as `errorMessage`.
            TargetError::Mutation(error) | TargetError::Request(error) => {
                f.write_str(&error.error_message())
            }
            TargetError::Prepare(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for TargetError {}

/// Resolves the session to open (`resolveSessionTarget`). `prepare` runs once the location is
/// known and before any creation, so it can resolve the model and agent at that location.
pub async fn resolve_session_target<F>(
    client: &Client,
    input: TargetInput,
    prepare: impl FnOnce(Preparation) -> F,
) -> Result<SessionTarget, TargetError>
where
    F: Future<Output = Result<Prepared, TargetError>>,
{
    let (selected, location) = select_session(client, &input).await?;
    let location = match location {
        Some(location) => location,
        None => {
            let directory = match &selected {
                Some(session) => Some(session.location.directory.0.clone()),
                None => input.directory.clone(),
            };
            resolve_location(client, directory)
                .await
                .map_err(TargetError::Request)?
        }
    };
    let prepared = prepare(Preparation {
        location: location.clone(),
        session: selected.clone(),
        model: input
            .model
            .clone()
            .or_else(|| selected.as_ref().and_then(|session| session.model.clone())),
        agent: input.agent.clone().or_else(|| {
            selected
                .as_ref()
                .and_then(|session| session.agent.as_ref().map(|agent| agent.0.clone()))
        }),
    })
    .await?;
    let resume = selected.is_some();
    let session = match selected {
        Some(session) => session,
        None => client
            .session_create(
                &SessionCreateInput {
                    id: input.session.clone().map(Some),
                    agent: prepared.agent.clone().map(|agent| Some(AgentID(agent))),
                    model: prepared.model.clone().map(Some),
                    location: Some(Some(LocationPublicRef {
                        directory: location.directory.clone(),
                    })),
                    ..Default::default()
                },
                &RequestOptions::default(),
            )
            .await
            .map_err(TargetError::Mutation)?,
    };
    if let Some(variables) = input.environment {
        crate::environment::upload(client, &session.id, variables)
            .await
            .map_err(TargetError::Mutation)?;
    }
    let agent = prepared
        .agent
        .or_else(|| session.agent.as_ref().map(|agent| agent.0.clone()));
    Ok(SessionTarget {
        session,
        location,
        model: prepared.model,
        agent,
        resume,
    })
}

/// The selected session, and the location when finding it already read it.
async fn select_session(
    client: &Client,
    input: &TargetInput,
) -> Result<(Option<SessionInfo>, Option<LocationPublicInfo>), TargetError> {
    if let Some(id) = &input.session {
        let Some(explicit) = find_session(client, id)
            .await
            .map_err(TargetError::Request)?
        else {
            if input.fork {
                return Err(TargetError::SessionNotFound);
            }
            return Ok((None, None));
        };
        return Ok((Some(fork_if(client, explicit, input.fork).await?), None));
    }
    if !input.continue_latest {
        return Ok((None, None));
    }
    let location = resolve_location(client, input.directory.clone())
        .await
        .map_err(TargetError::Request)?;
    let Some(selected) = latest_session(client, &location)
        .await
        .map_err(TargetError::Request)?
    else {
        return Ok((None, Some(location)));
    };
    Ok((Some(fork_if(client, selected, input.fork).await?), None))
}

async fn fork_if(
    client: &Client,
    session: SessionInfo,
    fork: bool,
) -> Result<SessionInfo, TargetError> {
    if !fork {
        return Ok(session);
    }
    client
        .session_fork(
            &SessionForkInput {
                session_id: session.id,
                before: None,
            },
            &RequestOptions::default(),
        )
        .await
        .map_err(TargetError::Mutation)
}

/// A session, or `None` when the server does not know it (`findSession`).
pub async fn find_session(
    client: &Client,
    id: &SessionID,
) -> Result<Option<SessionInfo>, opencode_api::error::Error> {
    match client
        .session_get(
            &SessionGetInput {
                session_id: id.clone(),
            },
            &RequestOptions::default(),
        )
        .await
    {
        Ok(session) => Ok(Some(session)),
        Err(error)
            if error.declared().is_some_and(|declared| {
                declared.tag.as_deref() == Some("SessionNotFoundError")
            }) =>
        {
            Ok(None)
        }
        Err(error) => Err(error),
    }
}

/// The newest top-level, unarchived session whose directory is exactly the location's. Pages
/// until one matches, since the list also returns sessions of subdirectories.
async fn latest_session(
    client: &Client,
    location: &LocationPublicInfo,
) -> Result<Option<SessionInfo>, opencode_api::error::Error> {
    let mut cursor = None;
    loop {
        let page = client
            .session_list(
                &SessionListInput {
                    directory: Some(location.directory.clone()),
                    parent_id: Some(None),
                    archived: Some(false),
                    limit: Some(SESSION_PAGE_LIMIT),
                    order: Some(SessionListInputOrder::Desc),
                    cursor: cursor.take(),
                    ..Default::default()
                },
                &RequestOptions::default(),
            )
            .await?;
        let empty = page.data.is_empty();
        if let Some(session) = page
            .data
            .into_iter()
            .find(|session| session.location.directory == location.directory)
        {
            return Ok(Some(session));
        }
        let Some(Some(next)) = page.cursor.next else {
            return Ok(None);
        };
        if empty {
            return Ok(None);
        }
        cursor = Some(next);
    }
}

async fn resolve_location(
    client: &Client,
    directory: Option<String>,
) -> Result<LocationPublicInfo, opencode_api::error::Error> {
    client
        .location_get(
            &LocationGetInput {
                location: directory.map(|directory| LocationQueryInput {
                    directory: Some(directory),
                }),
            },
            &RequestOptions::default(),
        )
        .await
}

/// A new worktree: its root, and the directory to open in it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorktreeLocation {
    pub root: String,
    pub directory: String,
}

/// Creates a worktree of the location's project, keeping the caller's subfolder when the worktree
/// has it (`createWorktreeLocation`).
pub async fn create_worktree_location(
    client: &Client,
    directory: Option<String>,
    name: Option<String>,
) -> Result<WorktreeLocation, TargetError> {
    let base = resolve_location(client, directory)
        .await
        .map_err(TargetError::Request)?;
    let created = client
        .worktree_create(
            &WorktreeCreateInput {
                project_id: base.project.id.clone(),
                from: Some(base.project.directory.clone()),
                name,
                ..Default::default()
            },
            &RequestOptions::default(),
        )
        .await
        .map_err(TargetError::Mutation)?;
    let root = created.directory.0;
    let Some(subfolder) = subfolder(&base.project.directory.0, &base.directory.0) else {
        return Ok(WorktreeLocation {
            directory: root.clone(),
            root,
        });
    };
    let directory = format!("{}/{subfolder}", root.trim_end_matches('/'));
    let directory = match resolve_location(client, Some(directory.clone())).await {
        Ok(_) => directory,
        Err(_) => root.clone(),
    };
    Ok(WorktreeLocation { root, directory })
}

/// `directory` relative to `project` when it is strictly inside it (`path.relative`).
fn subfolder(project: &str, directory: &str) -> Option<String> {
    let segments = |value: &str| -> Vec<String> {
        value
            .split('/')
            .fold(Vec::new(), |mut result: Vec<String>, segment| {
                match segment {
                    "" | "." => {}
                    ".." => {
                        result.pop();
                    }
                    _ => result.push(segment.to_owned()),
                }
                result
            })
    };
    let project = segments(project);
    let directory = segments(directory);
    let inside = directory.len() > project.len() && directory.starts_with(&project);
    inside.then(|| directory[project.len()..].join("/"))
}

/// `parseSessionTargetModel`: `provider/model` or `provider/model#variant`.
pub fn parse_model(value: Option<&str>) -> Result<Option<ModelRef>, String> {
    let Some(value) = value.filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    let invalid = || format!("Invalid model reference: {value}");
    let provider_end = value.find('/').filter(|at| *at > 0).ok_or_else(invalid)?;
    let provider = &value[..provider_end];
    let rest = &value[provider_end + 1..];
    let (id, variant) = match rest.find('#') {
        Some(at) => (&rest[..at], Some(&rest[at + 1..])),
        None => (rest, None),
    };
    if id.is_empty()
        || provider.contains('#')
        || variant.is_some_and(|variant| variant.is_empty() || variant.contains('#'))
    {
        return Err(invalid());
    }
    Ok(Some(ModelRef {
        id: id.to_owned(),
        provider_id: ProviderID(provider.to_owned()),
        variant: variant.map(str::to_owned),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn subfolders_stay_inside_the_project() {
        assert_eq!(
            subfolder("/project", "/project/packages/cli").as_deref(),
            Some("packages/cli")
        );
        assert_eq!(subfolder("/project", "/project"), None);
        assert_eq!(subfolder("/project", "/projects/other"), None);
        assert_eq!(subfolder("/project", "/project/../other"), None);
    }
}
