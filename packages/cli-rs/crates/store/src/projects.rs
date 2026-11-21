//! Adopts sessions into their project when `worktree.resolved` supplies the repository root.
use std::collections::HashSet;

use opencode_api::generated::*;

use crate::connection::Follow;
use crate::state::{Data, Error, State, Task};

/// The project of sessions outside any repository (`Project.ID.global`).
const GLOBAL_PROJECT: &str = "global";

impl State {
    /// Projects that are not archived, most recently active first. Equal ones keep TS's
    /// `Object.values` order: array-index IDs ascending, then the rest in insertion order.
    pub fn projects(&self) -> Vec<&Project> {
        let mut projects: Vec<&Project> =
            self.projects.values().filter(|project| project.time.archived.is_none()).collect();
        projects.sort_by_key(|project| {
            (std::cmp::Reverse(project.time.active), array_index(&project.id.0).is_none(), array_index(&project.id.0))
        });
        projects
    }

    pub fn project(&self, id: &ProjectID) -> Option<&Project> {
        self.projects.get(id)
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

    /// Replaces the cached set as Solid's `reconcile` does: a kept project keeps its place, a new one
    /// goes last, so the order of projects that sort equal does not change between reads.
    fn replace_projects(&mut self, projects: Vec<Project>) {
        let ids: HashSet<&ProjectID> = projects.iter().map(|project| &project.id).collect();
        self.projects.retain(|id, _| ids.contains(id));
        for project in projects {
            self.projects.insert(project.id.clone(), project);
        }
        self.log.projects();
    }

    /// Moves cached sessions into the resolved repository's project. A session of an adopted
    /// project matches by the project's canonical directory; a session whose adopted project is not
    /// cached is read again instead.
    pub(crate) fn on_worktree_resolved(&mut self, data: &WorktreeResolvedData) -> Vec<Follow> {
        let mut follow = Vec::new();
        let ids: Vec<SessionID> = self.info.keys().cloned().collect();
        for id in ids {
            let Some(info) = self.info.get(&id) else { continue };
            let explicit = data.adopted.as_ref().is_some_and(|adopted| adopted.contains(&info.project_id));
            let directory = if explicit {
                self.projects.get(&info.project_id).map(|project| project.canonical.0.clone())
            } else {
                Some(info.location.directory.0.clone())
            };
            let Some(directory) = directory else {
                self.syncs.invalidate(&format!("session:{}", id.0));
                follow.push(Follow::Session(id));
                continue;
            };
            let Some((project, subpath)) = adopt(&info.project_id.0, &directory, data) else { continue };
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
pub fn adopt(project: &str, directory: &str, event: &WorktreeResolvedData) -> Option<(String, Option<String>)> {
    let adopted = event.adopted.as_ref().is_some_and(|adopted| adopted.iter().any(|id| id.0 == project));
    if project != event.previous.0 && project != GLOBAL_PROJECT && !adopted {
        return None;
    }
    if project == event.project_id.0 {
        return None;
    }
    let directory = normalize(directory);
    let root = normalize(&event.directory.0);
    let windows = is_windows_root(&root);
    let key = if windows { directory.to_lowercase() } else { directory.clone() };
    let parent = if windows { root.to_lowercase() } else { root.clone() };
    if key != parent && !key.starts_with(&format!("{parent}/")) {
        return None;
    }
    // Case folding can change byte length, so count matching path segments rather than slicing at the root's byte
    // length.
    let subpath =
        (key != parent).then(|| directory.split('/').skip(root.split('/').count()).collect::<Vec<_>>().join("/"));
    Some((event.project_id.0.clone(), subpath))
}

/// Forward slashes, no empty or `.` segments, `..` applied.
fn normalize(value: &str) -> String {
    value.replace('\\', "/").split('/').fold(String::new(), |mut result, segment| {
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

/// The value of a JS array-index key: a canonical decimal below 2^32 - 1, so not `"02"`.
fn array_index(key: &str) -> Option<u32> {
    let value: u32 = key.parse().ok()?;
    (value != u32::MAX && value.to_string() == key).then_some(value)
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
            let projects = data.client().project_list(&ProjectListInput::default()).await.map_err(Error::new)?;
            data.write(|state| state.replace_projects(projects));
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(directory: &str) -> WorktreeResolvedData {
        WorktreeResolvedData {
            project_id: ProjectID("repository".into()),
            directory: AbsolutePath(directory.into()),
            previous: ProjectID("global".into()),
            adopted: Some(Vec::new()),
        }
    }

    /// Windows: backslashes, and a drive root that matches whatever the case. Case folding can change a string's
    /// length (`İ`), so the root matches by segments, not by its byte length.
    #[test]
    fn a_windows_root_adopts_sessions_whatever_their_case_or_slashes() {
        let adopted = |subpath: &str| Some(("repository".to_owned(), Some(subpath.to_owned())));
        assert_eq!(adopt("global", "\\repo\\.\\Legacy", &event("/repo")), adopted("Legacy"));
        assert_eq!(adopt("global", "c:/repo/App", &event("C:\\Repo")), adopted("App"));
        assert_eq!(adopt("global", "C:\\\u{130}\\ä", &event("c:\\i\u{307}")), adopted("ä"));
    }
}
