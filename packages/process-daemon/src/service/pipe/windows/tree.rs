//! The process tree of a pipe command, including processes that leave its job.
//!
//! A command runs in a kill-on-close job, but Windows lets two kinds of
//! process leave it. A Store app (an app execution alias such as Store
//! PowerShell 7, `wsl.exe` or `winget.exe`) started by a process in the job
//! moves to its package's own job, which ours cannot hold. And the children of
//! a Store app break away from every job, unless the app is the command itself
//! and so got the daemon's desktop-app policy. Nothing stops either, so a
//! watcher thread finds them afterwards.
//!
//! The watcher records every process that enters one of the tree's jobs, from
//! the jobs' completion-port messages, and keeps it open so its PID cannot be
//! reused. Every [`POLL_INTERVAL`] it walks a process snapshot for children of
//! recorded processes that are in none of the tree's jobs. One in no job joins
//! the command's job; one in another job (a Store app in its package's job)
//! gets a kill-on-close job of its own, nested inside that one. Killing the
//! tree terminates every job, then kills what escaped since the last poll.

use std::collections::HashMap;
use std::io;
use std::mem::{size_of, size_of_val};
use std::os::windows::io::{AsRawHandle, OwnedHandle};
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, OnceLock, PoisonError};
use std::time::{Duration, Instant};

use windows_sys::Win32::Foundation::{FILETIME, INVALID_HANDLE_VALUE, WAIT_TIMEOUT};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::IO::{
    CreateIoCompletionPort, GetQueuedCompletionStatus, OVERLAPPED, PostQueuedCompletionStatus,
};
use windows_sys::Win32::System::JobObjects::{
    IsProcessInJob, JOBOBJECT_ASSOCIATE_COMPLETION_PORT,
    JobObjectAssociateCompletionPortInformation, SetInformationJobObject, TerminateJobObject,
};
use windows_sys::Win32::System::Threading::{
    GetProcessTimes, INFINITE, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_QUOTA,
    PROCESS_SYNCHRONIZE, PROCESS_TERMINATE, TerminateProcess,
};

use super::{Job, is_signalled};
use crate::service::TerminalId;
use crate::transport::windows::owned_handle;

/// How long a process that left the tree's jobs can run before it is put back
/// in one, which only matters if the daemon dies: killing the tree finds it
/// anyway. A snapshot takes a few milliseconds, so polling more often costs
/// noticeable CPU while commands run.
const POLL_INTERVAL: Duration = Duration::from_secs(1);
/// Snapshots taken when killing the tree, while each still finds a process.
const KILL_SWEEPS: usize = 3;
/// The completion key that only wakes the watcher.
const WAKE: usize = 0;
/// winnt.h's job message for a process joining the job, which windows-sys
/// only exports with its SystemServices feature.
const JOB_OBJECT_MSG_NEW_PROCESS: u32 = 6;

/// A command's jobs and the processes known to be in its tree.
#[derive(Debug)]
pub(super) struct Tree {
    key: usize,
    state: Arc<Mutex<State>>,
}

#[derive(Debug)]
struct State {
    id: TerminalId,
    key: usize,
    /// The command's job first, then one per Store app that left it.
    jobs: Vec<Job>,
    members: HashMap<u32, Member>,
    killed: bool,
}

#[derive(Debug)]
struct Member {
    process: OwnedHandle,
    created: u64,
}

impl Tree {
    /// Watches the tree of `root`, which is in `job` and has not started yet.
    pub(super) fn watch(id: TerminalId, job: Job, root: u32) -> Self {
        let watcher = watcher();
        let key = watcher.map_or(WAKE, |watcher| {
            watcher.next_key.fetch_add(1, Ordering::Relaxed)
        });
        if let Some(watcher) = watcher
            && let Err(error) = watcher.notify(&job, key)
        {
            eprintln!("pipe process {id}: job notifications are unavailable: {error}");
        }
        let mut state = State {
            id,
            key,
            jobs: vec![job],
            members: HashMap::new(),
            killed: false,
        };
        state.record(root);
        let state = Arc::new(Mutex::new(state));
        if let Some(watcher) = watcher {
            watcher.trees().insert(key, Arc::clone(&state));
            watcher.wake();
        }
        Self { key, state }
    }

    /// Kills every process of the tree.
    pub(super) fn terminate(&self) -> io::Result<()> {
        self.lock().terminate()
    }

    /// Kills the tree first when the command failed. Otherwise what it left
    /// running keeps running: kill-on-close is cleared on every job. If the
    /// kill fails, dropping the still-armed jobs is the fallback.
    pub(super) fn finish(self, failed: bool) -> io::Result<()> {
        let mut state = self.lock();
        if failed {
            state.terminate()?;
        }
        state.jobs.iter().try_for_each(|job| job.set_limits(0))
    }

    #[cfg(test)]
    pub(super) fn job(&self) -> windows_sys::Win32::Foundation::HANDLE {
        self.lock().jobs[0].handle()
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        lock(&self.state)
    }
}

impl Drop for Tree {
    fn drop(&mut self) {
        if self.key != WAKE
            && let Some(watcher) = watcher()
        {
            watcher.trees().remove(&self.key);
        }
    }
}

impl State {
    /// Records a process that entered one of the tree's jobs. A late message
    /// can name a PID that already belongs to another process: only a process
    /// still in one of the jobs is ours.
    fn record(&mut self, pid: u32) {
        if self.members.contains_key(&pid) {
            return;
        }
        if let Some(process) = open(pid)
            && self.jobs.iter().any(|job| in_job(&process, job))
            && let Some(created) = created(&process)
        {
            self.members.insert(pid, Member { process, created });
        }
    }

    fn terminate(&mut self) -> io::Result<()> {
        self.killed = true;
        let mut result = Ok(());
        for job in &self.jobs {
            // SAFETY: the job handle stays open through the call.
            if unsafe { TerminateJobObject(job.handle(), 1) } == 0 && result.is_ok() {
                result = Err(io::Error::last_os_error());
            }
        }
        for _ in 0..KILL_SWEEPS {
            let Ok(processes) = snapshot() else {
                break;
            };
            if self.adopt(&processes) == 0 {
                break;
            }
        }
        result
    }

    /// Takes in every process in `processes` whose parent is a member, until
    /// none is left. Returns how many it took.
    fn adopt(&mut self, processes: &[Entry]) -> usize {
        let mut total = 0;
        loop {
            let mut taken = 0;
            for entry in processes {
                if self.members.contains_key(&entry.pid) {
                    continue;
                }
                let Some(parent) = self.members.get(&entry.parent) else {
                    continue;
                };
                let parent_created = parent.created;
                let Some(process) = open(entry.pid) else {
                    continue;
                };
                // Members are held open, so their PIDs are not reused; a
                // process older than its parent got that parent PID from an
                // earlier process.
                let Some(created) = created(&process).filter(|created| *created >= parent_created)
                else {
                    continue;
                };
                self.take(&process);
                self.members.insert(entry.pid, Member { process, created });
                taken += 1;
            }
            if taken == 0 {
                return total;
            }
            total += taken;
        }
    }

    /// Puts a process of the tree back in one of its jobs, or kills it once
    /// the tree has been killed.
    fn take(&mut self, process: &OwnedHandle) {
        if self.killed {
            // SAFETY: the process handle stays open through the call.
            unsafe { TerminateProcess(process.as_raw_handle(), 1) };
            return;
        }
        if self.jobs.iter().any(|job| in_job(process, job))
            || self.jobs.iter().any(|job| job.assign(process).is_ok())
        {
            return;
        }
        // A job we cannot join, such as a Store app's package job, can still
        // hold a job of ours.
        let Some(job) = Job::new(self.id) else {
            return;
        };
        if job.assign(process).is_err() {
            return;
        }
        if self.key != WAKE
            && let Some(watcher) = watcher()
        {
            let _ = watcher.notify(&job, self.key);
        }
        self.jobs.push(job);
    }

    /// Members that had exited before a snapshot cannot add to it, so they
    /// are dropped once it has been walked.
    fn exited(&self) -> Vec<u32> {
        self.members
            .iter()
            .filter(|(_, member)| is_signalled(&member.process))
            .map(|(pid, _)| *pid)
            .collect()
    }
}

/// The one thread that watches every tree.
struct Watcher {
    port: OwnedHandle,
    trees: Mutex<HashMap<usize, Arc<Mutex<State>>>>,
    next_key: AtomicUsize,
}

static WATCHER: OnceLock<Option<Watcher>> = OnceLock::new();

/// Starts the watcher on first use. Without it a tree is only its job.
fn watcher() -> Option<&'static Watcher> {
    WATCHER
        .get_or_init(|| {
            Watcher::new()
                .and_then(|watcher| {
                    std::thread::Builder::new()
                        .name("opencode-pty-job-watcher".into())
                        .spawn(|| {
                            if let Some(watcher) = WATCHER.wait() {
                                watcher.run();
                            }
                        })?;
                    Ok(watcher)
                })
                .inspect_err(|error| {
                    eprintln!(
                        "pipe processes: cannot watch for processes leaving their job: {error}"
                    )
                })
                .ok()
        })
        .as_ref()
}

impl Watcher {
    fn new() -> io::Result<Self> {
        // SAFETY: a new completion port not associated with any file.
        let port = owned_handle(unsafe {
            CreateIoCompletionPort(INVALID_HANDLE_VALUE, null_mut(), 0, 1)
        })?;
        Ok(Self {
            port,
            trees: Mutex::new(HashMap::new()),
            next_key: AtomicUsize::new(WAKE + 1),
        })
    }

    fn trees(&self) -> MutexGuard<'_, HashMap<usize, Arc<Mutex<State>>>> {
        self.trees.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Sends the job's messages to the watcher, tagged with the tree's key.
    fn notify(&self, job: &Job, key: usize) -> io::Result<()> {
        let port = JOBOBJECT_ASSOCIATE_COMPLETION_PORT {
            CompletionKey: key as *mut _,
            CompletionPort: self.port.as_raw_handle(),
        };
        // SAFETY: the job and port stay open through the call, and the value
        // matches the information class.
        if unsafe {
            SetInformationJobObject(
                job.handle(),
                JobObjectAssociateCompletionPortInformation,
                (&raw const port).cast(),
                size_of_val(&port) as u32,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(())
    }

    fn wake(&self) {
        // SAFETY: the port stays open; the packet carries no overlapped data.
        unsafe { PostQueuedCompletionStatus(self.port.as_raw_handle(), 0, WAKE, null()) };
    }

    fn run(&self) {
        let mut next_poll = Instant::now() + POLL_INTERVAL;
        loop {
            let timeout = if self.trees().is_empty() {
                INFINITE
            } else {
                next_poll
                    .saturating_duration_since(Instant::now())
                    .as_millis() as u32
            };
            let mut message = 0;
            let mut key = 0;
            let mut overlapped: *mut OVERLAPPED = null_mut();
            // SAFETY: the port stays open and every out-pointer is valid.
            let received = unsafe {
                GetQueuedCompletionStatus(
                    self.port.as_raw_handle(),
                    &mut message,
                    &mut key,
                    &mut overlapped,
                    timeout,
                )
            } != 0;
            if !received {
                let error = io::Error::last_os_error();
                if error.raw_os_error() != Some(WAIT_TIMEOUT as i32) {
                    eprintln!(
                        "pipe processes: stopped watching for processes leaving their job: {error}"
                    );
                    return;
                }
            }
            // For job messages the overlapped pointer carries the PID.
            if received && message == JOB_OBJECT_MSG_NEW_PROCESS {
                let tree = self.trees().get(&key).cloned();
                if let Some(tree) = tree {
                    lock(&tree).record(overlapped as usize as u32);
                }
            }
            if Instant::now() >= next_poll {
                self.poll();
                next_poll = Instant::now() + POLL_INTERVAL;
            }
        }
    }

    fn poll(&self) {
        let trees: Vec<_> = self.trees().values().cloned().collect();
        if trees.is_empty() {
            return;
        }
        let exited: Vec<_> = trees.iter().map(|tree| lock(tree).exited()).collect();
        let Ok(processes) = snapshot() else {
            return;
        };
        for (tree, exited) in trees.iter().zip(exited) {
            let mut state = lock(tree);
            state.adopt(&processes);
            for pid in exited {
                state.members.remove(&pid);
            }
        }
    }
}

fn lock(state: &Mutex<State>) -> MutexGuard<'_, State> {
    state.lock().unwrap_or_else(PoisonError::into_inner)
}

struct Entry {
    pid: u32,
    parent: u32,
}

/// Every running process with its parent's PID.
fn snapshot() -> io::Result<Vec<Entry>> {
    // SAFETY: a new process snapshot, adopted on success.
    let snapshot = owned_handle(unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) })?;
    let mut entry = PROCESSENTRY32W {
        dwSize: size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let mut processes = Vec::new();
    // SAFETY: the snapshot stays open and the entry's size is set.
    let mut more = unsafe { Process32FirstW(snapshot.as_raw_handle(), &mut entry) } != 0;
    while more {
        processes.push(Entry {
            pid: entry.th32ProcessID,
            parent: entry.th32ParentProcessID,
        });
        // SAFETY: as above.
        more = unsafe { Process32NextW(snapshot.as_raw_handle(), &mut entry) } != 0;
    }
    Ok(processes)
}

/// Opens a process with the access the tree needs, if it is ours to open.
fn open(pid: u32) -> Option<OwnedHandle> {
    // SAFETY: a new, non-inheritable handle, adopted on success.
    owned_handle(unsafe {
        OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION
                | PROCESS_SET_QUOTA
                | PROCESS_SYNCHRONIZE
                | PROCESS_TERMINATE,
            0,
            pid,
        )
    })
    .ok()
}

fn created(process: &OwnedHandle) -> Option<u64> {
    let mut created = FILETIME::default();
    let mut exited = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    // SAFETY: the process handle stays open and every out-pointer is valid.
    if unsafe {
        GetProcessTimes(
            process.as_raw_handle(),
            &mut created,
            &mut exited,
            &mut kernel,
            &mut user,
        )
    } == 0
    {
        return None;
    }
    Some(u64::from(created.dwHighDateTime) << 32 | u64::from(created.dwLowDateTime))
}

fn in_job(process: &OwnedHandle, job: &Job) -> bool {
    let mut result = 0;
    // SAFETY: both handles stay open through the call.
    let queried = unsafe { IsProcessInJob(process.as_raw_handle(), job.handle(), &mut result) };
    queried != 0 && result != 0
}

#[cfg(test)]
mod tests {
    use std::os::windows::io::FromRawHandle;

    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::Threading::{
        CREATE_NO_WINDOW, CreateProcessW, DeleteProcThreadAttributeList,
        EXTENDED_STARTUPINFO_PRESENT, InitializeProcThreadAttributeList,
        PROC_THREAD_ATTRIBUTE_PARENT_PROCESS, PROCESS_INFORMATION, STARTUPINFOEXW,
        UpdateProcThreadAttribute, WaitForSingleObject,
    };

    use super::super::tests::test_request;
    use super::super::{OutputPipe, Spawned, create_process, output_pipe};
    use super::*;

    /// A suspended `ping` that will be the tree's root, and a child of it
    /// created outside its job, the way a Store app's children leave it.
    fn root_with_escaped_child() -> (Spawned, OwnedHandle) {
        let request = test_request("ping.exe", &["-n", "30", "127.0.0.1"]);
        let OutputPipe { client, .. } = output_pipe().unwrap();
        let root = create_process(&request, &client).unwrap();
        let child = child_of(root.process());
        (root, child)
    }

    fn child_of(parent: &OwnedHandle) -> OwnedHandle {
        let mut bytes = 0;
        // SAFETY: the first call only reports the required size.
        unsafe { InitializeProcThreadAttributeList(null_mut(), 1, 0, &mut bytes) };
        let mut buffer = vec![0_usize; bytes.div_ceil(size_of::<usize>())];
        let list = buffer.as_mut_ptr().cast();
        let raw: HANDLE = parent.as_raw_handle();
        let mut command: Vec<u16> = "ping.exe -n 30 127.0.0.1\0".encode_utf16().collect();
        let mut info = PROCESS_INFORMATION::default();
        // SAFETY: the buffer is large enough and outlives the list, the parent
        // handle outlives the call, and the list is deleted before return.
        unsafe {
            assert_ne!(InitializeProcThreadAttributeList(list, 1, 0, &mut bytes), 0);
            assert_ne!(
                UpdateProcThreadAttribute(
                    list,
                    0,
                    PROC_THREAD_ATTRIBUTE_PARENT_PROCESS as usize,
                    (&raw const raw).cast(),
                    size_of::<HANDLE>(),
                    null_mut(),
                    null(),
                ),
                0
            );
            let mut startup = STARTUPINFOEXW::default();
            startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
            startup.lpAttributeList = list;
            let created = CreateProcessW(
                null(),
                command.as_mut_ptr(),
                null(),
                null(),
                0,
                CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT,
                null(),
                null(),
                (&raw const startup).cast(),
                &mut info,
            );
            DeleteProcThreadAttributeList(list);
            assert_ne!(created, 0, "{}", io::Error::last_os_error());
            CloseHandle(info.hThread);
            OwnedHandle::from_raw_handle(info.hProcess)
        }
    }

    fn in_raw_job(process: &OwnedHandle, job: HANDLE) -> bool {
        let mut result = 0;
        // SAFETY: both handles stay open through the call.
        let queried = unsafe { IsProcessInJob(process.as_raw_handle(), job, &mut result) };
        queried != 0 && result != 0
    }

    fn wait_until(what: &str, mut done: impl FnMut() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(10);
        while !done() {
            assert!(Instant::now() < deadline, "{what}");
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    struct KillOnDrop(OwnedHandle);

    impl Drop for KillOnDrop {
        fn drop(&mut self) {
            // SAFETY: the handle is this test's own child.
            unsafe { TerminateProcess(self.0.as_raw_handle(), 1) };
        }
    }

    #[test]
    fn the_watcher_puts_an_escaped_child_back_in_the_job() {
        let (root, child) = root_with_escaped_child();
        let child = KillOnDrop(child);
        let job = Job::new(1).unwrap();
        job.assign(root.process()).unwrap();
        let tree = Tree::watch(1, job, root.pid);
        let (_, root) = root.resume().unwrap();
        let _root = KillOnDrop(root);
        assert!(!in_raw_job(&child.0, tree.job()));
        wait_until("the child did not join the job", || {
            in_raw_job(&child.0, tree.job())
        });
        tree.terminate().unwrap();
        wait_until("the child survived the kill", || is_signalled(&child.0));
    }

    #[test]
    fn killing_the_tree_kills_an_escaped_child_the_watcher_has_not_seen() {
        let (root, child) = root_with_escaped_child();
        let child = KillOnDrop(child);
        let job = Job::new(2).unwrap();
        job.assign(root.process()).unwrap();
        // Not registered with the watcher: only the kill's own sweep finds it.
        let mut state = State {
            id: 2,
            key: WAKE,
            jobs: vec![job],
            members: HashMap::new(),
            killed: false,
        };
        state.record(root.pid);
        let (_, root) = root.resume().unwrap();
        let root = KillOnDrop(root);
        state.terminate().unwrap();
        wait_until("the root survived the kill", || is_signalled(&root.0));
        // SAFETY: the child handle stays open through the wait.
        assert_eq!(
            unsafe { WaitForSingleObject(child.0.as_raw_handle(), 5000) },
            0
        );
    }

    #[test]
    fn a_successful_command_leaves_an_adopted_child_running() {
        let (root, child) = root_with_escaped_child();
        let child = KillOnDrop(child);
        let job = Job::new(3).unwrap();
        job.assign(root.process()).unwrap();
        let tree = Tree::watch(3, job, root.pid);
        let (_, root) = root.resume().unwrap();
        let _root = KillOnDrop(root);
        wait_until("the child did not join the job", || {
            in_raw_job(&child.0, tree.job())
        });
        tree.finish(false).unwrap();
        std::thread::sleep(Duration::from_millis(300));
        assert!(
            !is_signalled(&child.0),
            "closing a disarmed job killed the child"
        );
    }
}
