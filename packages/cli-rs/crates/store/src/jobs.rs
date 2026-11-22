//! Running background jobs of the session trees a view synced (TS `data.job`). Settled jobs leave the store.

use std::collections::HashSet;

use indexmap::IndexMap;
use opencode_api::generated::*;

use crate::changes::Touched;
use crate::core::{Effect, Jobs, Ticket};
use crate::reads::{Read, SessionRead};
use crate::sessions::SessionKey;
use crate::state::{Error, Overlay, State};

impl State {
    /// Running jobs owned by `session` or any session below it: a synced tree's listed members, plus jobs whose
    /// owner loaded session info places below it. In arrival order.
    pub fn jobs(&self, session: &SessionID) -> Vec<&JobInfo> {
        let members = self.sessions.get(session).and_then(|session| session.job_tree.as_ref());
        self.jobs
            .values()
            .filter(|job| members.is_some_and(|members| members.contains(job.id())) || self.job_within(job, session))
            .collect()
    }

    /// `owned_jobs` by the parents in loaded session info.
    pub fn owned_jobs<'a>(&self, jobs: &[&'a JobInfo], session: &SessionID) -> Vec<&'a JobInfo> {
        owned_jobs(jobs, session, |id| self.session(id).and_then(|info| info.parent_id.clone()))
    }

    pub(crate) fn on_job_updated(&mut self, info: &JobInfo) {
        let running = info.status() == Some(&JobStatus::Running);
        for read in self.sessions.iter_mut().filter_map(|session| session.job_read.as_mut()) {
            read.record(info.id(), running.then(|| info.clone()));
        }
        if !running {
            if self.jobs.shift_remove(info.id()).is_none() {
                return;
            }
            for members in self.sessions.iter_mut().filter_map(|session| session.job_tree.as_mut()) {
                members.remove(info.id());
            }
            self.log_job(info);
            return;
        }
        self.jobs.insert(info.id().to_owned(), info.clone());
        let roots: Vec<SessionKey> = self
            .sessions
            .iter()
            .filter(|session| session.job_tree.is_some() && self.job_within(info, &session.id))
            .filter_map(|session| self.sessions.key(&session.id))
            .collect();
        for root in roots {
            self.sessions[root].job_tree.get_or_insert_default().insert(info.id().to_owned());
        }
        self.log_job(info);
    }

    /// Forgets a tree's jobs (its session was removed).
    pub(crate) fn remove_job_tree(&mut self, root: SessionKey) {
        let session = &mut self.sessions[root];
        session.job_read = None;
        session.reads[SessionRead::Jobs].invalidate();
        let Some(members) = session.job_tree.take() else { return };
        for id in &members {
            if let Some(job) = self.jobs.shift_remove(id) {
                self.log_job(&job);
            }
        }
    }

    /// Logs a job's owner, and the child a subagent job runs.
    fn log_job(&mut self, job: &JobInfo) {
        self.touch(job.session_id(), Touched::JOBS);
        if let JobInfo::Subagent(job) = job {
            self.touch(&job.child_session_id, Touched::JOBS);
        }
    }

    /// Reads the synced trees again, after `server.connected`.
    pub(crate) fn job_roots(&mut self, effects: &mut Vec<Effect>) {
        for session in self.sessions.iter_mut().filter(|session| session.job_tree.is_some()) {
            session.reads[SessionRead::Jobs].invalidate();
            effects.push(Effect::Jobs(session.id.clone()));
        }
    }

    /// Whether a session is `ancestor` or below it, by the parents in loaded session info.
    fn within_tree(&self, session: &SessionID, ancestor: &SessionID) -> bool {
        let mut seen = HashSet::new();
        let mut current = Some(session);
        while let Some(id) = current {
            if id == ancestor {
                return true;
            }
            if !seen.insert(id) {
                return false;
            }
            current = self.session(id).and_then(|info| info.parent_id.as_ref());
        }
        false
    }

    /// A subagent job's session is the parent of the child it runs, so either places it in a tree.
    fn job_within(&self, job: &JobInfo, ancestor: &SessionID) -> bool {
        let owner = SessionID(job.session_id().to_owned());
        self.within_tree(&owner, ancestor)
            || matches!(job, JobInfo::Subagent(job) if self.within_tree(&job.child_session_id, ancestor))
    }

    /// Begins a read of the running jobs of the tree under the session of `ticket`. Job events received during the read
    /// apply over its answer.
    pub(crate) fn begin_jobs(&mut self, ticket: Ticket) -> Jobs {
        let read = self.token();
        let record = &mut self.sessions[ticket.session()];
        record.job_read = Some(Overlay::new(read));
        Jobs { ticket, root: record.id.clone(), read }
    }

    /// Publishes the job read `read` of `root`, with the events that overtook it. An overflowed overlay publishes
    /// nothing and reads again.
    pub(crate) fn complete_jobs(&mut self, jobs: Jobs, result: Result<Vec<JobInfo>, Error>, effects: &mut Vec<Effect>) {
        let root = jobs.root;
        let read = self
            .sessions
            .get_mut(&root)
            .and_then(|session| session.job_read.take_if(|read| read.ticket() == jobs.read));
        let list = match result {
            Ok(list) => list,
            Err(error) => return self.evict_missing(&error),
        };
        let Some(read) = read else { return };
        let Some(changes) = read.into_changes() else {
            self.invalidate(Read::Session(root.as_str(), SessionRead::Jobs));
            effects.push(Effect::Jobs(root));
            return;
        };
        let listed: HashSet<String> = list.iter().map(|job| job.id().to_owned()).collect();
        let mut next: IndexMap<String, JobInfo> = list.into_iter().map(|job| (job.id().to_owned(), job)).collect();
        for (id, change) in changes {
            match change {
                None => {
                    next.shift_remove(&id);
                }
                Some(info) if listed.contains(&id) || self.job_within(&info, &root) => {
                    next.insert(id, info);
                }
                Some(_) => {}
            }
        }
        // Replaced below, and nothing in between reads it.
        let previous = self.sessions.get_mut(&root).and_then(|session| session.job_tree.take()).unwrap_or_default();
        let stale: Vec<String> = self
            .jobs
            .iter()
            .filter(|(id, job)| !next.contains_key(*id) && (previous.contains(*id) || self.job_within(job, &root)))
            .map(|(id, _)| id.clone())
            .collect();
        for id in stale {
            if let Some(job) = self.jobs.shift_remove(&id) {
                self.log_job(&job);
            }
        }
        self.sessions.get_or_insert(&root).job_tree = Some(next.keys().cloned().collect());
        for job in next.values() {
            self.log_job(job);
        }
        self.jobs.extend(next);
        self.touch(&root, Touched::JOBS);
    }
}

/// Running jobs in `session`'s tree (TS `ownedJobs`). A subagent job belongs to the child it runs, which runs in a
/// direct child of the session that started it, so a child whose parent is not loaded still reaches it.
pub fn owned_jobs<'a>(
    jobs: &[&'a JobInfo],
    session: &SessionID,
    parent: impl Fn(&SessionID) -> Option<SessionID>,
) -> Vec<&'a JobInfo> {
    let owned = |job: &JobInfo| {
        let child = match job {
            JobInfo::Subagent(job) => Some(&job.child_session_id),
            _ => None,
        };
        let mut seen = HashSet::new();
        let mut current = Some(child.cloned().unwrap_or_else(|| SessionID(job.session_id().to_owned())));
        while let Some(id) = current {
            if id == *session {
                return true;
            }
            if !seen.insert(id.clone()) {
                return false;
            }
            current = parent(&id).or_else(|| (Some(&id) == child).then(|| SessionID(job.session_id().to_owned())));
        }
        false
    };
    jobs.iter().copied().filter(|job| owned(job)).collect()
}
