//! Additional directories: validation, permission grants, and their record in session metadata
//! (`packages/cli/src/acp/directories.ts`).
//!
//! Owned by C.12 (`rs-acp-rest`). C.11 filled it because `session/new`, `load`, `resume`, `fork`, and
//! `list` validate `cwd` through it; C.12 ports its tests (`additional-directories.test.ts`).

use opencode_api::client::{Client, RequestOptions};
use opencode_api::generated::{
    PermissionEffect, PermissionRule, SessionInfo, SessionMetadata, SessionUpdateInput,
};
use serde_json::{Value, json};

use crate::client::check;
use crate::error::Failure;
use crate::paths::{fs_resolve, is_absolute, resolve_lexical};

const KEY: &str = "opencode.acp.additionalDirectories";

// Permission resources treat `*` and `?` as wildcards.
pub fn parse(cwd: &str, directories: &[String]) -> Result<Vec<String>, Failure> {
    parse_cwd(cwd)?;
    if let Some(invalid) = directories
        .iter()
        .find(|directory| !is_absolute(directory) || directory.contains(['*', '?']))
    {
        return Err(Failure::InvalidAdditionalDirectory {
            directory: invalid.clone(),
        });
    }
    let root = fs_resolve(cwd);
    let mut unique: Vec<String> = Vec::new();
    for directory in directories
        .iter()
        .map(|directory| resolve_lexical(directory))
    {
        if !unique.contains(&directory) {
            unique.push(directory);
        }
    }
    Ok(unique
        .into_iter()
        .filter(|directory| fs_resolve(directory) != root)
        .collect())
}

pub fn parse_cwd(cwd: &str) -> Result<String, Failure> {
    if !is_absolute(cwd) {
        return Err(Failure::invalid_request(
            format!("cwd must be an absolute path: {cwd}"),
            Some("cwd"),
        ));
    }
    Ok(cwd.to_owned())
}

/// The permissions and metadata a new session starts with.
pub fn grant(directories: &[String]) -> (Option<Vec<PermissionRule>>, Option<SessionMetadata>) {
    if directories.is_empty() {
        return (None, None);
    }
    let mut metadata = SessionMetadata::new();
    metadata.insert(KEY.to_owned(), json!(directories));
    (Some(rules(directories)), Some(metadata))
}

pub fn list(session: &SessionInfo) -> Vec<String> {
    session
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.get(KEY))
        .and_then(Value::as_array)
        .filter(|items| items.iter().all(Value::is_string))
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

pub async fn activate(
    client: &Client,
    session: &SessionInfo,
    directories: &[String],
) -> Result<(), Failure> {
    let previous = list(session);
    let owned = rules(&previous);
    let current = session.permissions.clone().unwrap_or_default();
    // ACP rules lead so the session's other rules keep precedence for the same paths.
    let permissions: Vec<PermissionRule> = rules(directories)
        .into_iter()
        .chain(current.iter().filter(|rule| !owned.contains(rule)).cloned())
        .collect();
    let mut metadata: SessionMetadata = session
        .metadata
        .clone()
        .unwrap_or_default()
        .into_iter()
        .filter(|(name, _)| name != KEY)
        .collect();
    if !directories.is_empty() {
        metadata.insert(KEY.to_owned(), json!(directories));
    }
    let permissions_changed = permissions != current;
    let metadata_changed = previous != directories;
    if !permissions_changed && !metadata_changed {
        return Ok(());
    }
    check(
        client
            .session_update(
                &SessionUpdateInput {
                    session_id: session.id.clone(),
                    permissions: permissions_changed.then_some(permissions),
                    metadata: metadata_changed.then_some(metadata),
                    ..SessionUpdateInput::default()
                },
                &RequestOptions::default(),
            )
            .await,
    )
}

// Tools compare the written path without following symlinks, so both spellings of a root are granted.
fn rules(directories: &[String]) -> Vec<PermissionRule> {
    let mut roots: Vec<String> = Vec::new();
    for directory in directories
        .iter()
        .flat_map(|directory| [directory.clone(), fs_resolve(directory)])
    {
        if !roots.contains(&directory) {
            roots.push(directory);
        }
    }
    roots
        .into_iter()
        .map(|directory| PermissionRule {
            action: "external_directory".to_owned(),
            resource: format!("{}/*", directory.trim_end_matches('/')),
            effect: PermissionEffect::Allow,
        })
        .collect()
}
