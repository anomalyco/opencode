//! Running background jobs of the session trees a view synced (TS `data.job`). Settled jobs leave the store.

use std::collections::HashSet;

use indexmap::IndexMap;
use opencode_api::generated::*;

use crate::state::{Data, Error, Overlay, State, Task, evict_missing};

impl State {
    /// Running jobs owned by `session` or any session below it: a synced tree's listed members, plus jobs whose
    /// owner loaded session info places below it. In arrival order.
    pub fn jobs(&self, session: &SessionID) -> Vec<&JobInfo> {
        let members = self.job_trees.get(session);
        self.jobs
            .values()
            .filter(|job| members.is_some_and(|members| members.contains(job.id())) || self.job_within(job, session))
            .collect()
    }

    pub(crate) fn on_job_updated(&mut self, info: &JobInfo) {
        let running = info.status() == Some(&JobStatus::Running);
        for read in self.job_reads.values_mut() {
            read.record(info.id(), running.then(|| info.clone()));
        }
        if !running {
            if self.jobs.shift_remove(info.id()).is_none() {
                return;
            }
            for members in self.job_trees.values_mut() {
                members.remove(info.id());
            }
            self.log_job(info);
            return;
        }
        self.jobs.insert(info.id().to_owned(), info.clone());
        let roots: Vec<SessionID> = self.job_trees.keys().filter(|root| self.job_within(info, root)).cloned().collect();
        for root in roots {
            self.job_trees.entry(root).or_default().insert(info.id().to_owned());
        }
        self.log_job(info);
    }

    /// Forgets a tree's jobs (its session was removed).
    pub(crate) fn remove_job_tree(&mut self, root: &SessionID) {
        self.job_reads.remove(root);
        self.syncs.invalidate(&job_key(root));
        let Some(members) = self.job_trees.remove(root) else { return };
        for id in &members {
            if let Some(job) = self.jobs.shift_remove(id) {
                self.log_job(&job);
            }
        }
    }

    /// Logs a job's owner, and the child a subagent job runs.
    fn log_job(&mut self, job: &JobInfo) {
        self.log.jobs(&SessionID(job.session_id().to_owned()));
        if let JobInfo::Subagent(job) = job {
            self.log.jobs(&job.child_session_id);
        }
    }

    /// The synced trees, read again after `server.connected`.
    pub(crate) fn job_roots(&mut self) -> Vec<SessionID> {
        let roots: Vec<SessionID> = self.job_trees.keys().cloned().collect();
        for root in &roots {
            self.syncs.invalidate(&job_key(root));
        }
        roots
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
            current = self.info.get(id).and_then(|info| info.parent_id.as_ref());
        }
        false
    }

    /// A subagent job's session is the parent of the child it runs, so either places it in a tree.
    fn job_within(&self, job: &JobInfo, ancestor: &SessionID) -> bool {
        let owner = SessionID(job.session_id().to_owned());
        self.within_tree(&owner, ancestor)
            || matches!(job, JobInfo::Subagent(job) if self.within_tree(&job.child_session_id, ancestor))
    }

    fn begin_job_read(&mut self, root: &SessionID) -> u64 {
        let ticket = self.token();
        self.job_reads.insert(root.clone(), Overlay::new(ticket));
        ticket
    }

    /// Publishes the list read `ticket` started, with the events that overtook it. True when the overlay
    /// overflowed: nothing is published and the caller reads again.
    fn publish_jobs(&mut self, root: &SessionID, ticket: u64, list: Vec<JobInfo>) -> bool {
        let Some(read) = Overlay::take(&mut self.job_reads, root, ticket) else { return false };
        let Some(changes) = read.into_changes() else {
            self.syncs.invalidate(&job_key(root));
            return true;
        };
        let listed: HashSet<String> = list.iter().map(|job| job.id().to_owned()).collect();
        let mut next: IndexMap<String, JobInfo> = list.into_iter().map(|job| (job.id().to_owned(), job)).collect();
        for (id, change) in changes {
            match change {
                None => {
                    next.shift_remove(&id);
                }
                Some(info) if listed.contains(&id) || self.job_within(&info, root) => {
                    next.insert(id, info);
                }
                Some(_) => {}
            }
        }
        let previous = self.job_trees.get(root).cloned().unwrap_or_default();
        let stale: Vec<String> = self
            .jobs
            .iter()
            .filter(|(id, job)| !next.contains_key(*id) && (previous.contains(*id) || self.job_within(job, root)))
            .map(|(id, _)| id.clone())
            .collect();
        for id in stale {
            if let Some(job) = self.jobs.shift_remove(&id) {
                self.log_job(&job);
            }
        }
        self.job_trees.insert(root.clone(), next.keys().cloned().collect());
        for job in next.values() {
            self.log_job(job);
        }
        self.jobs.extend(next);
        self.log.jobs(root);
        false
    }
}

fn job_key(root: &SessionID) -> String {
    format!("job:{}", root.0)
}

impl Data {
    /// Reads the running jobs of the tree under `root` once per invalidation. Job events received during the read
    /// apply over its answer.
    pub fn job_sync(&self, root: &SessionID) -> Task<()> {
        let (begin, fetched) = (root.clone(), root.clone());
        self.sync_start(
            job_key(root),
            move |state| state.begin_job_read(&begin),
            move |data, ticket| async move {
                let input = ExperimentalJobListInput {
                    session_id: Some(fetched.clone()),
                    status: Some(JobStatus::Running),
                    descendants: Some(true),
                    ..ExperimentalJobListInput::default()
                };
                let list = match data.client().experimental_job_list(&input).await {
                    Ok(list) => list,
                    Err(error) => {
                        data.write(|state| Overlay::take(&mut state.job_reads, &fetched, ticket));
                        return Err(evict_missing(&data, error));
                    }
                };
                if data.write(|state| state.publish_jobs(&fetched, ticket, list)) {
                    let again = fetched.clone();
                    data.refresh(move |data| data.job_sync(&again));
                }
                Ok(())
            },
        )
    }

    /// Cancels a running job, interrupting the work it started; a finished job stays finished.
    pub async fn job_cancel(&self, id: &str) -> Result<(), Error> {
        let input = ExperimentalJobCancelInput { id: id.to_owned() };
        self.client().experimental_job_cancel(&input).await.map_err(Error::new)
    }
}
