//! Pipe processes on Windows.
//!
//! The child has no console (`CREATE_NO_WINDOW`), stdin on `NUL`, and stdout
//! and stderr on one inheritable byte-mode named pipe that the daemon reads
//! with overlapped I/O. The child is created inside a kill-on-close job, so
//! `TerminateJobObject` reaches every descendant and a daemon crash takes the
//! tree with it. No console signals are used: every `signal` is a hard kill of
//! the tree, and the exit reports the signal the daemon sent.

use std::cmp::Ordering;
use std::collections::HashMap;
use std::ffi::{OsStr, c_void};
use std::fs::File;
use std::io;
use std::mem::{size_of, size_of_val};
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::{AsRawHandle, OwnedHandle};
use std::path::Path;
use std::ptr::{null, null_mut};
use std::sync::{Arc, Mutex, PoisonError};
use std::thread;
use std::time::Instant;

use anyhow::{Context, Result, bail};
use windows_sys::Win32::Foundation::{
    DUPLICATE_SAME_ACCESS, DuplicateHandle, ERROR_ACCESS_DENIED, ERROR_BROKEN_PIPE,
    ERROR_IO_INCOMPLETE, ERROR_IO_PENDING, ERROR_NO_DATA, ERROR_OPERATION_ABORTED,
    ERROR_PIPE_CONNECTED, ERROR_PIPE_NOT_CONNECTED, GENERIC_READ, GENERIC_WRITE, HANDLE,
    WAIT_OBJECT_0, WAIT_TIMEOUT,
};
use windows_sys::Win32::Globalization::{
    CSTR_EQUAL, CSTR_GREATER_THAN, CSTR_LESS_THAN, CompareStringOrdinal,
};
use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;
use windows_sys::Win32::Storage::FileSystem::{
    BY_HANDLE_FILE_INFORMATION, CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_REPARSE_POINT,
    FILE_FLAG_FIRST_PIPE_INSTANCE, FILE_FLAG_OPEN_REPARSE_POINT, FILE_FLAG_OVERLAPPED,
    FILE_READ_ATTRIBUTES, FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE,
    GetFileInformationByHandle, OPEN_ALWAYS, OPEN_EXISTING, PIPE_ACCESS_INBOUND, ReadFile,
    SetEndOfFile,
};
use windows_sys::Win32::System::IO::{CancelIoEx, GetOverlappedResult, OVERLAPPED};
use windows_sys::Win32::System::JobObjects::{
    CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOBOBJECT_BASIC_LIMIT_INFORMATION,
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
    SetInformationJobObject, TerminateJobObject,
};
use windows_sys::Win32::System::Pipes::{
    ConnectNamedPipe, CreateNamedPipeW, PIPE_READMODE_BYTE, PIPE_REJECT_REMOTE_CLIENTS,
    PIPE_TYPE_BYTE, PIPE_WAIT,
};
use windows_sys::Win32::System::Threading::{
    CREATE_NO_WINDOW, CREATE_UNICODE_ENVIRONMENT, CreateProcessW, DeleteProcThreadAttributeList,
    EXTENDED_STARTUPINFO_PRESENT, GetCurrentProcess, GetExitCodeProcess, INFINITE,
    InitializeProcThreadAttributeList, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
    PROC_THREAD_ATTRIBUTE_JOB_LIST, PROCESS_INFORMATION, ResetEvent, STARTF_USESTDHANDLES,
    STARTUPINFOEXW, SetEvent, TerminateProcess, UpdateProcThreadAttribute, WaitForMultipleObjects,
    WaitForSingleObject,
};

use super::{DRAIN_AFTER_EXIT, Exit, OutputSink, exit_message, start_pipe};
use crate::service::{CreatePipe, ProcessSignal, TerminalHandle, TerminalId};
use crate::transport::retained::Retained;
use crate::transport::windows::{event, owned_handle, security::PrivateSecurity};

/// Cancel is first so a pipe that is always readable cannot starve it.
const CANCEL_READY: u32 = WAIT_OBJECT_0;
/// The read event, and the process handle after it.
const READ_READY: u32 = WAIT_OBJECT_0 + 1;
const PROCESS_READY: u32 = WAIT_OBJECT_0 + 2;

/// The pipe server's in-buffer: bytes the child can write before it blocks.
const BUFFER_BYTES: u32 = 64 * 1024;
/// The reader's fixed transfer size, as on Unix.
const READ_BYTES: usize = 8 * 1024;

impl TerminalHandle {
    pub(in crate::service) fn spawn_pipe(
        id: TerminalId,
        order: u64,
        request: CreatePipe,
    ) -> Result<Self> {
        let OutputPipe { server, client } = output_pipe()?;
        // Before spawning, so a bad path fails the request with nothing to
        // clean up; the reader is the file's only writer.
        let sink = open_output(&request.output_path)?;
        let job = Job::new(id);
        let process = Arc::new(spawn(id, &request, job.as_ref(), client)?);
        let cancel = Cancel::new()?;
        let reader = Arc::clone(&server);
        let reader_process = Arc::clone(&process);
        let reader_cancel = cancel.clone();
        start_pipe(
            id,
            order,
            request,
            Arc::clone(&process),
            sink,
            Box::new(cancel),
            super::Threads {
                reader: Box::new(move |sink| {
                    thread::Builder::new()
                        .name(format!("opencode-pty-reader-{id}"))
                        .spawn(move || read_output(reader, sink, reader_cancel, reader_process))
                }),
                waiter: Box::new(move |actor| {
                    // Spawned last: the waiter must be joined before `reap`.
                    thread::Builder::new()
                        .name(format!("opencode-pty-wait-{id}"))
                        .spawn(move || {
                            let _ = actor.send(exit_message(wait_exit(process)));
                        })
                }),
            },
        )
    }
}

/// A pipe child on Windows: the process object, the job that owns its tree
/// (unless one could not be used), and the signal the daemon sent, if any.
#[derive(Debug)]
pub(in crate::service) struct Process {
    pid: u32,
    /// Taken by `reap`, which closes both handles.
    handles: Mutex<Option<Handles>>,
    /// The signal recorded by `kill`/`signal` before terminating the tree.
    killed: Mutex<Option<&'static str>>,
}

#[derive(Debug)]
struct Handles {
    process: Arc<OwnedHandle>,
    job: Option<Arc<OwnedHandle>>,
}

impl Process {
    pub(super) fn pid(&self) -> u32 {
        self.pid
    }

    /// The process object, kept open until `reap` so its PID cannot be reused.
    fn process_handle(&self) -> Option<Arc<OwnedHandle>> {
        self.handles
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .as_ref()
            .map(|handles| Arc::clone(&handles.process))
    }

    /// Kills the process tree. Never terminates after `reap`.
    pub(super) fn kill(&self) {
        let handles = self.handles.lock().unwrap_or_else(PoisonError::into_inner);
        let Some(handles) = handles.as_ref() else {
            return;
        };
        self.record_kill("SIGKILL", handles);
        let _ = terminate(handles);
    }

    /// Hard-kills the process tree and records the signal the client will see.
    /// Allowed after the exit, to reach what is left of the job; refused after
    /// `reap`.
    pub(in crate::service) fn signal(&self, signal: ProcessSignal) -> Result<()> {
        let name = match signal {
            ProcessSignal::Term => "SIGTERM",
            ProcessSignal::Int => "SIGINT",
            ProcessSignal::Kill => "SIGKILL",
        };
        let handles = self.handles.lock().unwrap_or_else(PoisonError::into_inner);
        let Some(handles) = handles.as_ref() else {
            bail!("process has been reaped");
        };
        self.record_kill(name, handles);
        terminate(handles).context("failed to signal process")
    }

    /// Call only after the waiter has returned: closes the process and job
    /// handles. Closing the job alone kills anything still in it.
    pub(super) fn reap(&self) {
        self.handles
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
    }

    /// Records the signal only while the process still runs, so a process that
    /// exited on its own keeps its own exit code, as on Unix.
    fn record_kill(&self, name: &'static str, handles: &Handles) {
        // SAFETY: the handles lock keeps the process handle open.
        if unsafe { WaitForSingleObject(handles.process.as_raw_handle(), 0) } == WAIT_TIMEOUT {
            // Termination is asynchronous: the first signal that reached the
            // running process is the one the client should see.
            self.killed
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .get_or_insert(name);
        }
    }

    fn take_signal(&self) -> Option<&'static str> {
        self.killed
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take()
    }
}

/// Terminates the whole tree.
fn terminate(handles: &Handles) -> io::Result<()> {
    // SAFETY: the handles stay open while they are borrowed here.
    let terminated = unsafe {
        match &handles.job {
            Some(job) => TerminateJobObject(job.as_raw_handle(), 1),
            None => TerminateProcess(handles.process.as_raw_handle(), 1),
        }
    };
    if terminated != 0 {
        return Ok(());
    }
    let error = io::Error::last_os_error();
    // A process that has already exited refuses termination; signalling an
    // empty Unix process group is not an error either.
    if error.raw_os_error() == Some(ERROR_ACCESS_DENIED as i32) {
        return Ok(());
    }
    Err(error)
}

/// Returns the process and job handles for a spawned tree.
fn spawn(
    id: TerminalId,
    request: &CreatePipe,
    job: Option<&Job>,
    client: OwnedHandle,
) -> Result<Process> {
    let process = match create_process(request, job, &client) {
        Ok(process) => process,
        Err(error) if job.is_some() && error.raw_os_error() == Some(ERROR_ACCESS_DENIED as i32) => {
            // An outer job with UI restrictions refuses new members. Run the
            // command anyway; only the main process can be killed then.
            let process = create_process(request, None, &client)
                .with_context(|| format!("failed to spawn {}", request.program))?;
            eprintln!(
                "pipe process {id}: cannot join the job object, killing only the main process: {error}"
            );
            process
        }
        Err(error) => return Err(error).context(format!("failed to spawn {}", request.program)),
    };
    // The daemon's copy of the child's write end: holding it open would keep
    // the pipe from ever breaking.
    drop(client);
    Ok(process)
}

fn create_process(
    request: &CreatePipe,
    job: Option<&Job>,
    client: &OwnedHandle,
) -> io::Result<Process> {
    let stdin = null_handle()?;
    // A child that closes one of stdout or stderr must still write to the
    // other, so stderr gets its own handle to the same pipe.
    let stderr = duplicate(client)?;
    let handles = [
        stdin.as_raw_handle(),
        client.as_raw_handle(),
        stderr.as_raw_handle(),
    ];
    let jobs = job.map(|job| [job.handle()]);
    let mut entries = vec![(
        PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize,
        handles.as_ptr().cast::<c_void>(),
        size_of_val(&handles),
    )];
    entries.extend(jobs.as_ref().map(|jobs| {
        (
            PROC_THREAD_ATTRIBUTE_JOB_LIST as usize,
            jobs.as_ptr().cast::<c_void>(),
            size_of_val(jobs),
        )
    }));
    let attributes = Attributes::new(&entries)?;
    let mut command = command_line(&request.program, &request.args)?;
    let environment = environment_block(&request.env)?;
    let directory = wide(request.cwd.as_os_str())?;
    let mut startup = STARTUPINFOEXW::default();
    startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = stdin.as_raw_handle();
    startup.StartupInfo.hStdOutput = client.as_raw_handle();
    startup.StartupInfo.hStdError = stderr.as_raw_handle();
    startup.lpAttributeList = attributes.list();
    let mut info = PROCESS_INFORMATION::default();
    // SAFETY: every buffer and handle stays live through the call. The child
    // gets no window and shares the output pipe through the handle list; the
    // job list puts it in the job atomically, with no breakaway flags.
    let created = unsafe {
        CreateProcessW(
            null(),
            command.as_mut_ptr(),
            null(),
            null(),
            1,
            CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT | EXTENDED_STARTUPINFO_PRESENT,
            environment.as_ptr().cast(),
            directory.as_ptr(),
            (&raw const startup).cast(),
            &mut info,
        )
    };
    if created == 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: CreateProcessW returned new, uniquely owned handles; the thread
    // handle is not needed.
    let process = owned_handle(info.hProcess)?;
    drop(owned_handle(info.hThread)?);
    Ok(Process {
        pid: info.dwProcessId,
        handles: Mutex::new(Some(Handles {
            process: Arc::new(process),
            job: job.map(|job| Arc::clone(&job.0)),
        })),
        killed: Mutex::new(None),
    })
}

/// Waits for the child to exit, then reports the exit code, or the signal the
/// daemon sent when it terminated the tree.
fn wait_exit(process: Arc<Process>) -> io::Result<Exit> {
    let Some(handle) = process.process_handle() else {
        return Err(io::Error::other("process has been reaped"));
    };
    // SAFETY: the process object stays open for the whole wait.
    if unsafe { WaitForSingleObject(handle.as_raw_handle(), INFINITE) } != WAIT_OBJECT_0 {
        return Err(io::Error::last_os_error());
    }
    let mut code = 0;
    // SAFETY: a signalled process object has a final exit code.
    if unsafe { GetExitCodeProcess(handle.as_raw_handle(), &mut code) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(match process.take_signal() {
        Some(name) => Exit::Signal(name.to_string()),
        None => Exit::Code(code),
    })
}

/// Signals the reader to stop. Every clone can signal; the first drop sets the
/// event, and later ones are harmless.
#[derive(Clone)]
struct Cancel(Arc<OwnedHandle>);

impl Cancel {
    fn new() -> io::Result<Self> {
        event().map(|event| Self(Arc::new(event)))
    }

    fn handle(&self) -> HANDLE {
        self.0.as_raw_handle()
    }

    fn signalled(&self) -> bool {
        // SAFETY: the shared event stays open through the call.
        unsafe { WaitForSingleObject(self.0.as_raw_handle(), 0) == WAIT_OBJECT_0 }
    }
}

impl Drop for Cancel {
    fn drop(&mut self) {
        // SAFETY: the shared event stays open through the call.
        unsafe {
            SetEvent(self.0.as_raw_handle());
        }
    }
}

/// One overlapped read: stable allocations for the `OVERLAPPED` and the buffer
/// the kernel writes into, and an RAII drop that cancels and reaps a pending
/// operation before either allocation is released.
struct Read {
    // Fields drop in declaration order, so the allocations the kernel points
    // at go first and the handles they refer to stay open until last.
    overlapped: Retained<OVERLAPPED>,
    buffer: Retained<[u8; READ_BYTES]>,
    event: OwnedHandle,
    pipe: Arc<OwnedHandle>,
    pending: bool,
}

impl Read {
    fn new(pipe: Arc<OwnedHandle>) -> io::Result<Self> {
        let event = event()?;
        Ok(Self {
            overlapped: Retained::new(OVERLAPPED {
                hEvent: event.as_raw_handle(),
                ..Default::default()
            }),
            buffer: Retained::new([0; READ_BYTES]),
            event,
            pipe,
            pending: false,
        })
    }

    fn is_pending(&self) -> bool {
        self.pending
    }

    /// Submits one read. `Some` means it completed before returning.
    fn submit(&mut self) -> io::Result<Option<usize>> {
        debug_assert!(!self.pending);
        // SAFETY: the OVERLAPPED and buffer are stable Retained allocations and
        // stay live until the completion is reaped; only this struct uses them.
        unsafe {
            ResetEvent(self.event.as_raw_handle());
            if ReadFile(
                self.pipe.as_raw_handle(),
                self.buffer.as_ptr().cast::<u8>(),
                READ_BYTES as u32,
                null_mut(),
                self.overlapped.as_ptr(),
            ) != 0
            {
                self.pending = true;
                return self.complete().map(Some);
            }
        }
        let error = io::Error::last_os_error();
        if error.raw_os_error() != Some(ERROR_IO_PENDING as i32) {
            return Err(error);
        }
        self.pending = true;
        Ok(None)
    }

    /// Reaps the completion. Waiting is required once the event is signalled:
    /// the kernel may still be finishing the operation.
    fn complete(&mut self) -> io::Result<usize> {
        let mut count = 0;
        // SAFETY: this operation was submitted and its buffers are live.
        let completed = unsafe {
            GetOverlappedResult(
                self.pipe.as_raw_handle(),
                self.overlapped.as_ptr(),
                &mut count,
                1,
            )
        };
        if completed != 0 {
            self.pending = false;
            return Ok(count as usize);
        }
        let error = io::Error::last_os_error();
        if error.raw_os_error() == Some(ERROR_IO_INCOMPLETE as i32) {
            // Only possible without waiting; keep the operation pending so
            // dropping `Read` cancels and reaps it.
            return Err(error);
        }
        self.pending = false;
        Err(error)
    }

    /// The bytes of a completed read.
    fn bytes(&self, length: usize) -> &[u8] {
        debug_assert!(!self.pending);
        // SAFETY: no read is pending, so the kernel has stopped using the
        // allocation and this is its unique owner.
        unsafe { std::slice::from_raw_parts(self.buffer.as_ptr().cast::<u8>(), length) }
    }

    fn event(&self) -> HANDLE {
        self.event.as_raw_handle()
    }
}

impl Drop for Read {
    fn drop(&mut self) {
        if !self.pending {
            return;
        }
        let mut count = 0;
        // SAFETY: cancel THIS operation, then reap its completion before the
        // OVERLAPPED, buffer or event can be released. CancelIoEx alone does
        // not guarantee the kernel has stopped using them.
        unsafe {
            CancelIoEx(self.pipe.as_raw_handle(), self.overlapped.as_ptr());
            GetOverlappedResult(
                self.pipe.as_raw_handle(),
                self.overlapped.as_ptr(),
                &mut count,
                1,
            );
        }
        self.pending = false;
    }
}

/// Reads output until every writer is gone, until [`DRAIN_AFTER_EXIT`] after
/// the process exits, or until [`Cancel`] fires.
fn read_output(pipe: Arc<OwnedHandle>, sink: OutputSink, cancel: Cancel, process: Arc<Process>) {
    let mut sink = sink;
    let Some(process_object) = process.process_handle() else {
        return;
    };
    let mut read = match Read::new(pipe) {
        Ok(read) => read,
        Err(error) => {
            sink.failed(error.to_string());
            return;
        }
    };
    // The process may have exited before the reader started.
    let mut exited = process_exited(&process_object);
    let mut deadline = exited.then(|| Instant::now() + DRAIN_AFTER_EXIT);
    loop {
        // Cancellation and the exit win over output, so a descendant that
        // writes without pause cannot keep the reader from noticing them.
        if cancel.signalled() {
            sink.eof();
            return;
        }
        if !exited && process_exited(&process_object) {
            exited = true;
            deadline = Some(Instant::now() + DRAIN_AFTER_EXIT);
        }
        if deadline.is_some_and(|deadline| Instant::now() >= deadline) {
            // Dropping `read` cancels and reaps a pending operation.
            sink.eof();
            return;
        }
        if !read.is_pending() {
            match read.submit() {
                Ok(Some(0)) => {
                    sink.eof();
                    return;
                }
                Ok(Some(length)) => {
                    // Check cancel, the exit and the deadline again before
                    // reading more.
                    if !sink.write(read.bytes(length)) {
                        return;
                    }
                    continue;
                }
                Ok(None) => {}
                Err(error) => {
                    end_on_read_error(sink, error);
                    return;
                }
            }
        }
        let timeout = match deadline {
            None => INFINITE,
            Some(deadline) => {
                let left = deadline.saturating_duration_since(Instant::now());
                // Round up: a sub-millisecond remainder must not become a busy 0.
                left.as_nanos().div_ceil(1_000_000).min(u32::MAX as u128) as u32
            }
        };
        // Cancel is first: WaitForMultipleObjects reports the lowest signalled
        // index, so an always-readable pipe cannot starve it.
        let handles = [
            cancel.handle(),
            read.event(),
            process_object.as_raw_handle(),
        ];
        // Once the exit is seen, stop waiting on its signalled handle.
        let count = if exited { 2 } else { 3 };
        // SAFETY: every handle stays live through the wait.
        match unsafe { WaitForMultipleObjects(count, handles.as_ptr(), 0, timeout) } {
            CANCEL_READY => {
                sink.eof();
                return;
            }
            READ_READY => match read.complete() {
                Ok(0) => {
                    sink.eof();
                    return;
                }
                Ok(length) => {
                    if !sink.write(read.bytes(length)) {
                        return;
                    }
                }
                Err(error) => {
                    end_on_read_error(sink, error);
                    return;
                }
            },
            PROCESS_READY => {
                exited = true;
                deadline = Some(Instant::now() + DRAIN_AFTER_EXIT);
            }
            WAIT_TIMEOUT => {
                // The drain deadline passed with a descendant still writing.
                sink.eof();
                return;
            }
            _ => {
                let error = io::Error::last_os_error();
                sink.failed(error.to_string());
                return;
            }
        }
    }
}

fn process_exited(process: &OwnedHandle) -> bool {
    // SAFETY: the process handle stays open for the whole read.
    unsafe { WaitForSingleObject(process.as_raw_handle(), 0) == WAIT_OBJECT_0 }
}

fn end_on_read_error(sink: OutputSink, error: io::Error) {
    if is_end_of_output(&error) {
        sink.eof();
    } else {
        sink.failed(error.to_string());
    }
}

fn is_end_of_output(error: &io::Error) -> bool {
    matches!(
        error.raw_os_error(),
        Some(code)
            if code == ERROR_BROKEN_PIPE as i32
                || code == ERROR_PIPE_NOT_CONNECTED as i32
                || code == ERROR_NO_DATA as i32
                // Our own CancelIoEx, or the handle closing under us.
                || code == ERROR_OPERATION_ABORTED as i32
    )
}

/// The daemon's read end and the child's inheritable write end.
struct OutputPipe {
    server: Arc<OwnedHandle>,
    client: OwnedHandle,
}

fn output_pipe() -> Result<OutputPipe> {
    let security = PrivateSecurity::new()?;
    let name: Vec<u16> = format!(r"\\.\pipe\opencode-pty-{:032x}", rand::random::<u128>())
        .encode_utf16()
        .chain([0])
        .collect();
    // SAFETY: the name is NUL-terminated and the descriptor and attributes
    // outlive the call. One private, inbound, byte-mode instance with a 64 KiB
    // in-buffer, so the child can write ahead while the reader is busy.
    let server = unsafe {
        CreateNamedPipeW(
            name.as_ptr(),
            PIPE_ACCESS_INBOUND | FILE_FLAG_OVERLAPPED | FILE_FLAG_FIRST_PIPE_INSTANCE,
            PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
            1,
            0,
            BUFFER_BYTES,
            0,
            &security.attributes(),
        )
    };
    let server = Arc::new(owned_handle(server).context("failed to create output pipe")?);
    // SAFETY: the same NUL-terminated name; only the returned handle is
    // inheritable, and it is the only handle of this open. Read attributes
    // are included so clients that fstat their stdout (Git Bash, Python, Go)
    // can query the pipe.
    let client = unsafe {
        CreateFileW(
            name.as_ptr(),
            GENERIC_WRITE | FILE_READ_ATTRIBUTES,
            0,
            &inheritable(),
            OPEN_EXISTING,
            0,
            null_mut(),
        )
    };
    let client = owned_handle(client).context("failed to connect output pipe")?;
    let connect_event = event()?;
    let overlapped = Retained::new(OVERLAPPED {
        hEvent: connect_event.as_raw_handle(),
        ..Default::default()
    });
    // The client end is already open, so the connect normally completes at
    // once with ERROR_PIPE_CONNECTED instead of waiting.
    if unsafe { ConnectNamedPipe(server.as_raw_handle(), overlapped.as_ptr()) } == 0 {
        let error = io::Error::last_os_error();
        match error.raw_os_error() {
            Some(code) if code == ERROR_PIPE_CONNECTED as i32 => {}
            Some(code) if code == ERROR_IO_PENDING as i32 => {
                let mut count = 0;
                // SAFETY: the handle and the Retained OVERLAPPED stay live.
                if unsafe {
                    GetOverlappedResult(server.as_raw_handle(), overlapped.as_ptr(), &mut count, 1)
                } == 0
                {
                    let error = io::Error::last_os_error();
                    // Never return while the kernel might still own the
                    // OVERLAPPED: cancel and reap the completion.
                    unsafe {
                        CancelIoEx(server.as_raw_handle(), overlapped.as_ptr());
                        GetOverlappedResult(
                            server.as_raw_handle(),
                            overlapped.as_ptr(),
                            &mut count,
                            1,
                        );
                    }
                    return Err(error).context("failed to connect output pipe");
                }
            }
            _ => return Err(error).context("failed to connect output pipe"),
        }
    }
    Ok(OutputPipe { server, client })
}

/// A kill-on-close job: terminating it kills every descendant, and a crashed
/// daemon closes it and kills them too.
struct Job(Arc<OwnedHandle>);

impl Job {
    fn new(id: TerminalId) -> Option<Self> {
        // SAFETY: an unnamed job with default attributes, adopted on success.
        let job = match owned_handle(unsafe { CreateJobObjectW(null(), null()) }) {
            Ok(job) => job,
            Err(error) => {
                warn_no_job(id, &error);
                return None;
            }
        };
        let limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
            BasicLimitInformation: JOBOBJECT_BASIC_LIMIT_INFORMATION {
                LimitFlags: JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                ..Default::default()
            },
            ..Default::default()
        };
        // SAFETY: the job stays open through the call and the limits match
        // the extended-information class.
        if unsafe {
            SetInformationJobObject(
                job.as_raw_handle(),
                JobObjectExtendedLimitInformation,
                (&raw const limits).cast(),
                size_of_val(&limits) as u32,
            )
        } == 0
        {
            warn_no_job(id, &io::Error::last_os_error());
            return None;
        }
        Some(Self(Arc::new(job)))
    }

    fn handle(&self) -> HANDLE {
        self.0.as_raw_handle()
    }
}

fn warn_no_job(id: TerminalId, error: &io::Error) {
    eprintln!("pipe process {id}: running without a job object: {error}");
}

/// Opens the output file first, so a bad path fails the request with nothing
/// to clean up. Truncates through the handle without following a reparse point
/// planted at the final component.
fn open_output(path: &Path) -> Result<File> {
    let name = wide(path.as_os_str())?;
    let message = format!("failed to open output file {}", path.display());
    // SAFETY: the name is NUL-terminated; the returned handle is inherited by
    // nothing and adopted at once.
    let handle = unsafe {
        CreateFileW(
            name.as_ptr(),
            GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            null(),
            OPEN_ALWAYS,
            FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT,
            null_mut(),
        )
    };
    let file = File::from(owned_handle(handle).with_context(|| message.clone())?);
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    // SAFETY: the file owns a live handle and info is valid writable output.
    if unsafe { GetFileInformationByHandle(file.as_raw_handle(), &mut info) } == 0 {
        return Err(io::Error::last_os_error()).with_context(|| message);
    }
    if info.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
        bail!("{message}: output path is a reparse point");
    }
    // SAFETY: the handle has write access and the position is at the start
    // after opening.
    if unsafe { SetEndOfFile(file.as_raw_handle()) } == 0 {
        return Err(io::Error::last_os_error()).with_context(|| message);
    }
    Ok(file)
}

fn inheritable() -> SECURITY_ATTRIBUTES {
    SECURITY_ATTRIBUTES {
        nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: null_mut(),
        bInheritHandle: 1,
    }
}

fn null_handle() -> io::Result<OwnedHandle> {
    let name: Vec<u16> = "NUL\0".encode_utf16().collect();
    // SAFETY: the name is NUL-terminated; the handle is inheritable only for
    // the spawn that lists it.
    owned_handle(unsafe {
        CreateFileW(
            name.as_ptr(),
            GENERIC_READ,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            &inheritable(),
            OPEN_EXISTING,
            0,
            null_mut(),
        )
    })
}

/// Duplicates a handle for the child, inheritable and with the same access.
fn duplicate(handle: &OwnedHandle) -> io::Result<OwnedHandle> {
    let mut duplicate = null_mut();
    // SAFETY: both process handles are pseudo-handles for this process and the
    // source handle is live; the new handle is adopted below.
    if unsafe {
        DuplicateHandle(
            GetCurrentProcess(),
            handle.as_raw_handle(),
            GetCurrentProcess(),
            &mut duplicate,
            0,
            1,
            DUPLICATE_SAME_ACCESS,
        )
    } == 0
    {
        return Err(io::Error::last_os_error());
    }
    owned_handle(duplicate)
}

/// The command line `CreateProcessW` parses and the child recovers with
/// `CommandLineToArgvW`/MSVCRT rules: the same algorithm as Rust std.
fn command_line(program: &str, args: &[String]) -> io::Result<Vec<u16>> {
    // A NUL would truncate the line, and the program is always quoted, so a
    // quote in it cannot be represented.
    if program.contains(['\0', '"']) || args.iter().any(|arg| arg.contains('\0')) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "command cannot be passed to a child process",
        ));
    }
    let mut line = Vec::new();
    // Always quoted: CreateProcessW finds the executable in the first token,
    // and quoting removes any ambiguity for the child.
    line.push('"' as u16);
    line.extend(program.encode_utf16());
    line.push('"' as u16);
    for arg in args {
        line.push(' ' as u16);
        append_arg(&mut line, arg);
    }
    // CreateProcessW needs a terminated string; without this it reads past the
    // buffer and runs the last argument plus whatever follows it.
    line.push(0);
    Ok(line)
}

/// Quotes one argument only when it needs it, doubling backslashes before a
/// quote and at the end of a quoted argument.
fn append_arg(line: &mut Vec<u16>, arg: &str) {
    let quote = arg.is_empty() || arg.contains([' ', '\t']);
    if quote {
        line.push('"' as u16);
    }
    let mut backslashes = 0;
    for unit in arg.encode_utf16() {
        if unit == '\\' as u16 {
            backslashes += 1;
        } else {
            if unit == '"' as u16 {
                // Add n+1 backslashes to total 2n+1 before the internal quote.
                line.extend((0..=backslashes).map(|_| '\\' as u16));
            }
            backslashes = 0;
        }
        line.push(unit);
    }
    if quote {
        // Add n backslashes to total 2n before the closing quote.
        line.extend((0..backslashes).map(|_| '\\' as u16));
        line.push('"' as u16);
    }
}

/// Exactly the given environment, with nothing inherited from the daemon:
/// entries deduplicated and sorted the way Windows compares variable names,
/// terminated by a NUL, and a final NUL for the block.
fn environment_block(env: &HashMap<String, String>) -> io::Result<Vec<u16>> {
    let mut entries = Vec::with_capacity(env.len());
    for (key, value) in env {
        // Windows allows a leading `=` for per-drive current directories
        // (`=C:`), but no other `=` in the name, and a lone `=` is invalid.
        if key.is_empty()
            || key == "="
            || key.contains('\0')
            || value.contains('\0')
            || key.strip_prefix('=').unwrap_or(key).contains('=')
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "environment variable cannot be passed to a child process",
            ));
        }
        entries.push((
            key.encode_utf16().collect::<Vec<_>>(),
            value.encode_utf16().collect::<Vec<_>>(),
        ));
    }
    // Sort deterministically before collapsing case variants, so the same
    // request always produces the same block; the last variant wins.
    entries.sort();
    entries.sort_by(|a, b| compare_keys(&a.0, &b.0));
    let mut unique: Vec<(Vec<u16>, Vec<u16>)> = Vec::with_capacity(entries.len());
    for entry in entries {
        match unique.last_mut() {
            Some(last) if compare_keys(&last.0, &entry.0) == Ordering::Equal => *last = entry,
            _ => unique.push(entry),
        }
    }
    let mut block = Vec::new();
    // An empty environment is signalled by a null, like Rust std.
    if unique.is_empty() {
        block.push(0);
    }
    for (key, value) in unique {
        block.extend(key);
        block.push('=' as u16);
        block.extend(value);
        block.push(0);
    }
    block.push(0);
    Ok(block)
}

/// Compares variable names the way Windows does: case-insensitively, then
/// ordinally (`CompareStringOrdinal(..., TRUE)`, as Rust std's `EnvKey`).
fn compare_keys(a: &[u16], b: &[u16]) -> Ordering {
    // SAFETY: both slices are valid UTF-16 of the given length.
    let result =
        unsafe { CompareStringOrdinal(a.as_ptr(), a.len() as i32, b.as_ptr(), b.len() as i32, 1) };
    match result {
        CSTR_LESS_THAN => Ordering::Less,
        CSTR_GREATER_THAN => Ordering::Greater,
        CSTR_EQUAL => Ordering::Equal,
        // Not expected for valid UTF-16; keep a total order regardless.
        _ => a.cmp(b),
    }
}

fn wide(value: &OsStr) -> io::Result<Vec<u16>> {
    let mut wide = value.encode_wide().collect::<Vec<_>>();
    if wide.contains(&0) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "path contains a NUL",
        ));
    }
    wide.push(0);
    Ok(wide)
}

/// An initialized process-attribute list and the buffer it points into, freed
/// in the right order.
struct Attributes {
    // Never read: the list points into this allocation, which must stay put
    // and alive for the list's lifetime.
    _buffer: Vec<usize>,
    list: *mut c_void,
}

impl Attributes {
    fn new(entries: &[(usize, *const c_void, usize)]) -> io::Result<Self> {
        let mut bytes = 0;
        // SAFETY: the first call only reports the required size.
        unsafe {
            InitializeProcThreadAttributeList(null_mut(), entries.len() as u32, 0, &mut bytes);
        }
        if bytes == 0 {
            return Err(io::Error::last_os_error());
        }
        let mut buffer = vec![0_usize; bytes.div_ceil(size_of::<usize>())];
        let list = buffer.as_mut_ptr().cast::<c_void>();
        // SAFETY: the buffer is at least `bytes` long, `usize`-aligned, and
        // outlives the list.
        if unsafe { InitializeProcThreadAttributeList(list, entries.len() as u32, 0, &mut bytes) }
            == 0
        {
            return Err(io::Error::last_os_error());
        }
        let this = Self {
            _buffer: buffer,
            list,
        };
        for &(attribute, value, length) in entries {
            // SAFETY: the list was initialized for exactly `entries.len()`
            // attributes; every value outlives the list.
            if unsafe {
                UpdateProcThreadAttribute(
                    this.list,
                    0,
                    attribute,
                    value,
                    length,
                    null_mut(),
                    null(),
                )
            } == 0
            {
                return Err(io::Error::last_os_error());
            }
        }
        Ok(this)
    }

    fn list(&self) -> *mut c_void {
        self.list
    }
}

impl Drop for Attributes {
    fn drop(&mut self) {
        // SAFETY: the list was successfully initialized and is unused after.
        unsafe {
            DeleteProcThreadAttributeList(self.list);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::PipeMetadata;
    use windows_sys::Win32::System::JobObjects::IsProcessInJob;

    fn text(value: &[u16]) -> String {
        String::from_utf16(value).unwrap()
    }

    fn test_request(program: &str, args: &[&str]) -> CreatePipe {
        CreatePipe {
            program: program.into(),
            args: args.iter().map(|arg| arg.to_string()).collect(),
            cwd: std::env::current_dir().unwrap(),
            env: ["PATH", "SystemRoot", "TEMP"]
                .into_iter()
                .filter_map(|name| Some((name.to_string(), std::env::var(name).ok()?)))
                .collect(),
            group_id: "test".into(),
            output_path: std::env::temp_dir().join(format!(
                "opencode-pty-pipe-test-{:032x}.out",
                rand::random::<u128>()
            )),
            metadata: PipeMetadata::new(),
        }
    }

    #[test]
    fn command_lines_are_terminated_and_quoted_for_msvcrt_parsing() {
        let line = command_line("cmd.exe", &["/d".into(), "/c".into(), "echo hi".into()]).unwrap();
        assert_eq!(line.last(), Some(&0));
        assert_eq!(
            text(&line[..line.len() - 1]),
            r#""cmd.exe" /d /c "echo hi""#
        );

        let line = command_line("a b.exe", &[String::new(), r#"echo "hi""#.into()]).unwrap();
        assert_eq!(
            text(&line[..line.len() - 1]),
            r#""a b.exe" "" "echo \"hi\"""#
        );

        // A quoted argument with a trailing backslash keeps the closing quote.
        let line = command_line("x.exe", &[r"C:\a b\".into()]).unwrap();
        assert_eq!(text(&line[..line.len() - 1]), r#""x.exe" "C:\a b\\""#);
    }

    #[test]
    fn command_lines_reject_unrepresentable_programs_and_arguments() {
        assert!(command_line("a\0b", &[]).is_err());
        assert!(command_line("a\"b", &[]).is_err());
        assert!(command_line("x.exe", &["a\0b".into()]).is_err());
    }

    #[test]
    fn environment_blocks_are_sorted_and_double_terminated() {
        let env = HashMap::from([
            ("B".to_string(), "2".to_string()),
            ("A".to_string(), "1".to_string()),
        ]);
        let block = environment_block(&env).unwrap();
        assert_eq!(block, "A=1\0B=2\0\0".encode_utf16().collect::<Vec<_>>());

        let empty = environment_block(&HashMap::new()).unwrap();
        assert_eq!(empty, [0, 0]);
    }

    #[test]
    fn environment_blocks_accept_drive_directories_and_collapse_case_variants() {
        let env = HashMap::from([
            ("=C:".to_string(), r"C:\work".to_string()),
            ("PATH".to_string(), "upper".to_string()),
            ("Path".to_string(), "lower".to_string()),
        ]);
        let block = environment_block(&env).unwrap();
        let block = text(&block);
        // The last variant in ordinal order wins, deterministically.
        assert_eq!(block, "=C:=C:\\work\0Path=lower\0\0");

        for invalid in [("", "x"), ("=", "x"), ("A=B", "x"), ("A\0B", "x")] {
            let env = HashMap::from([(invalid.0.to_string(), invalid.1.to_string())]);
            assert!(environment_block(&env).is_err(), "{:?}", invalid.0);
        }
    }

    #[test]
    fn environment_blocks_are_ordered_like_compare_string_ordinal() {
        let env = HashMap::from([
            ("a".to_string(), "1".to_string()),
            ("B".to_string(), "2".to_string()),
        ]);
        let block = environment_block(&env).unwrap();
        // Case-insensitive ordinal puts `a` before `B`; raw UTF-16 orders `B`
        // first because its code unit is smaller.
        assert_eq!(text(&block), "a=1\0B=2\0\0");
    }

    #[test]
    fn a_jobless_spawn_runs_the_command_and_reports_its_exit() {
        let request = test_request("cmd.exe", &["/d", "/c", "exit /b 5"]);
        let OutputPipe { client, .. } = output_pipe().unwrap();
        let process = Arc::new(spawn(1, &request, None, client).unwrap());
        assert!(matches!(
            wait_exit(Arc::clone(&process)).unwrap(),
            Exit::Code(5)
        ));
        process.reap();
    }

    #[test]
    fn a_job_handle_without_assign_access_falls_back_to_a_jobless_spawn() {
        let job = Job::new(2).unwrap();
        let mut restricted = null_mut();
        // JOB_OBJECT_QUERY only: joining a job needs JOB_OBJECT_ASSIGN_PROCESS.
        const JOB_OBJECT_QUERY: u32 = 4;
        // SAFETY: both process handles are pseudo-handles for this process and
        // the job handle is live; the duplicate is adopted below.
        assert_ne!(
            unsafe {
                DuplicateHandle(
                    GetCurrentProcess(),
                    job.handle(),
                    GetCurrentProcess(),
                    &mut restricted,
                    JOB_OBJECT_QUERY,
                    0,
                    0,
                )
            },
            0
        );
        let job = Job(Arc::new(owned_handle(restricted).unwrap()));
        let request = test_request("cmd.exe", &["/d", "/c", "exit /b 5"]);
        let OutputPipe { client, .. } = output_pipe().unwrap();
        let process = Arc::new(spawn(2, &request, Some(&job), client).unwrap());
        let mut in_job = 0;
        // SAFETY: the process handle stays open until `reap` and the job is live.
        assert_ne!(
            unsafe {
                IsProcessInJob(
                    process.process_handle().unwrap().as_raw_handle(),
                    job.handle(),
                    &mut in_job,
                )
            },
            0
        );
        assert_eq!(in_job, 0, "the restricted job must have been refused");
        assert!(matches!(
            wait_exit(Arc::clone(&process)).unwrap(),
            Exit::Code(5)
        ));
        process.reap();
    }
}
