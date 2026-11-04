//! Projects and their saved permissions (F.8), and the adoption of sessions into a project when
//! its repository is resolved (`worktree.resolved`).

use opencode_api::client::RequestOptions;
use opencode_api::generated::*;

use crate::connection::Follow;
use crate::state::{Data, Error, State, Task};

/// The project of sessions outside any repository (`Project.ID.global`).
const GLOBAL_PROJECT: &str = "global";

impl State {
    /// Projects that are not archived, most recently active first.
    pub fn projects(&self) -> Vec<&Project> {
        let mut projects: Vec<&Project> = self
            .projects
            .values()
            .filter(|project| project.time.archived.is_none())
            .collect();
        projects.sort_by_key(|project| std::cmp::Reverse(project.time.active));
        projects
    }

    pub fn project(&self, id: &ProjectID) -> Option<&Project> {
        self.projects.get(id)
    }

    /// Saved permissions of a project; none until read.
    pub fn project_permissions(&self, id: &ProjectID) -> Option<&[PermissionSavedInfo]> {
        self.project_permissions.get(id).map(Vec::as_slice)
    }

    /// `project.updated` replaces the project: a field the event leaves out is cleared.
    pub(crate) fn on_project_updated(&mut self, data: &ProjectUpdatedData) {
        let project = Project {
            id: data.id.clone(),
            canonical: data.canonical.clone(),
            vcs: data.vcs.clone(),
            name: data.name.clone(),
            icon: data.icon.clone(),
            commands: data.commands.clone(),
            time: data.time.clone(),
            sandboxes: data.sandboxes.clone(),
        };
        self.projects.insert(data.id.clone(), project);
        self.log.projects();
    }

    /// Moves cached sessions into the resolved repository's project. A session of an adopted
    /// project matches by the project's canonical directory; a session whose adopted project is not
    /// cached is read again instead.
    pub(crate) fn on_worktree_resolved(&mut self, data: &WorktreeResolvedData) -> Vec<Follow> {
        let mut follow = Vec::new();
        let ids: Vec<SessionID> = self.info.keys().cloned().collect();
        for id in ids {
            let Some(info) = self.info.get(&id) else {
                continue;
            };
            let explicit = data
                .adopted
                .as_ref()
                .is_some_and(|adopted| adopted.contains(&info.project_id));
            let directory = if explicit {
                self.projects
                    .get(&info.project_id)
                    .map(|project| project.canonical.0.clone())
            } else {
                Some(info.location.directory.0.clone())
            };
            let Some(directory) = directory else {
                self.syncs.invalidate(&format!("session:{}", id.0));
                follow.push(Follow::Session(id));
                continue;
            };
            let Some((project, subpath)) = adopt(&info.project_id.0, &directory, data) else {
                continue;
            };
            if let Some(info) = self.info.get_mut(&id) {
                info.project_id = ProjectID(project);
                info.subpath = subpath.map(RelativePath);
            }
            self.log.session(&id);
        }
        follow
    }
}

/// `Worktree.adopt`: the project and subpath a session at `directory` takes when `event` resolves
/// a repository, or `None` when the session stays where it is.
pub fn adopt(
    project: &str,
    directory: &str,
    event: &WorktreeResolvedData,
) -> Option<(String, Option<String>)> {
    let adopted = event
        .adopted
        .as_ref()
        .is_some_and(|adopted| adopted.iter().any(|id| id.0 == project));
    if project != event.previous.0 && project != GLOBAL_PROJECT && !adopted {
        return None;
    }
    if project == event.project_id.0 {
        return None;
    }
    let directory = normalize(directory);
    let root = normalize(&event.directory.0);
    let windows = is_windows_root(&root);
    let key = if windows {
        directory.to_lowercase()
    } else {
        directory.clone()
    };
    let parent = if windows {
        root.to_lowercase()
    } else {
        root.clone()
    };
    if key != parent && !key.starts_with(&format!("{parent}/")) {
        return None;
    }
    let subpath = (key != parent).then(|| directory[root.len() + 1..].to_owned());
    Some((event.project_id.0.clone(), subpath))
}

/// Forward slashes, no empty or `.` segments, `..` applied.
fn normalize(value: &str) -> String {
    value
        .replace('\\', "/")
        .split('/')
        .fold(String::new(), |mut result, segment| {
            match segment {
                "" | "." => {}
                ".." => result.truncate(result.rfind('/').unwrap_or(0)),
                _ => {
                    result.push('/');
                    result.push_str(segment);
                }
            }
            result
        })
}

/// `/^\/[a-z]:/i`
fn is_windows_root(root: &str) -> bool {
    let bytes = root.as_bytes();
    bytes.len() >= 3 && bytes[0] == b'/' && bytes[1].is_ascii_alphabetic() && bytes[2] == b':'
}

impl Data {
    /// Reads every project once per invalidation; the read replaces the cached set.
    pub fn project_sync(&self) -> Task<()> {
        self.sync_run("project".to_owned(), |data| async move {
            let projects = data
                .client()
                .project_list(&ProjectListInput::default(), &RequestOptions::default())
                .await
                .map_err(Error::new)?;
            data.write(|state| {
                state.projects = projects
                    .into_iter()
                    .map(|project| (project.id.clone(), project))
                    .collect();
                state.log.projects();
            });
            Ok(())
        })
    }

    pub fn project_invalidate(&self) {
        self.write(|state| state.syncs.invalidate("project"));
    }

    /// Reads a project's saved permissions once per invalidation.
    pub fn project_permission_sync(&self, id: &ProjectID) -> Task<()> {
        let id = id.clone();
        self.sync_run(
            format!("project.permission:{}", id.0),
            move |data| async move {
                let saved = data
                    .client()
                    .permission_saved_list(
                        &PermissionSavedListInput {
                            project_id: Some(id.clone()),
                        },
                        &RequestOptions::default(),
                    )
                    .await
                    .map_err(Error::new)?;
                data.write(|state| {
                    state.project_permissions.insert(id, saved);
                    state.log.projects();
                });
                Ok(())
            },
        )
    }

    pub fn project_permission_invalidate(&self, id: &ProjectID) {
        self.write(|state| {
            state
                .syncs
                .invalidate(&format!("project.permission:{}", id.0))
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(directory: &str, adopted: &[&str]) -> WorktreeResolvedData {
        WorktreeResolvedData {
            project_id: ProjectID("repository".into()),
            directory: AbsolutePath(directory.into()),
            previous: ProjectID("global".into()),
            adopted: Some(adopted.iter().map(|id| ProjectID((*id).into())).collect()),
        }
    }

    #[test]
    fn adopts_sessions_under_the_repository_root() {
        let resolved = event("/repo", &["directory-root"]);
        let adopt = |project: &str, directory: &str| adopt(project, directory, &resolved);
        assert_eq!(
            adopt("directory-root", "/repo"),
            Some(("repository".into(), None))
        );
        assert_eq!(
            adopt("global", "/repo/alias/../app/"),
            Some(("repository".into(), Some("app".into())))
        );
        assert_eq!(adopt("global", "/repo/../other"), None);
        assert_eq!(adopt("global", "/repo-other"), None);
        assert_eq!(adopt("other-repository", "/repo/vendor"), None);
        assert_eq!(adopt("repository", "/repo/app"), None);
        assert_eq!(
            adopt("global", "\\repo\\.\\Legacy"),
            Some(("repository".into(), Some("Legacy".into())))
        );
        let windows = event("C:\\Repo", &[]);
        assert_eq!(
            super::adopt("global", "c:/repo/App", &windows),
            Some(("repository".into(), Some("App".into())))
        );
    }
}
