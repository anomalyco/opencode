//! Pipe processes on Windows.
//!
//! The child has no console (`CREATE_NO_WINDOW`), stdin on `NUL`, and stdout
//! and stderr on one inheritable byte-mode named pipe that the daemon reads
//! with overlapped I/O. The child is created inside a kill-on-close job, so
//! `TerminateJobObject` reaches every descendant and a daemon crash takes the
//! tree with it. No console signals are used: every `signal` is a hard kill of
//! the tree, and the exit reports the signal the daemon sent.

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
    ERROR_ACCESS_DENIED, ERROR_BROKEN_PIPE, ERROR_IO_PENDING, ERROR_NO_DATA,
    ERROR_OPERATION_ABORTED, ERROR_PIPE_CONNECTED, ERROR_PIPE_NOT_CONNECTED, GENERIC_READ,
    GENERIC_WRITE, HANDLE, WAIT_OBJECT_0, WAIT_TIMEOUT,
};
use windows_sys::Win32::Security::SECURITY_ATTRIBUTES;
use windows_sys::Win32::Storage::FileSystem::{
    BY_HANDLE_FILE_INFORMATION, CreateFileW, FILE_ATTRIBUTE_NORMAL, FILE_ATTRIBUTE_REPARSE_POINT,
    FILE_FLAG_FIRST_PIPE_INSTANCE, FILE_FLAG_OPEN_REPARSE_POINT, FILE_FLAG_OVERLAPPED,
    FILE_SHARE_DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE, GetFileInformationByHandle, OPEN_ALWAYS,
    OPEN_EXISTING, PIPE_ACCESS_INBOUND, ReadFile, SetEndOfFile,
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
    CREATE_NO_WINDOW, CREATE_UNICODE_ENVIRONMENT, CreateEventW, CreateProcessW,
    DeleteProcThreadAttributeList, EXTENDED_STARTUPINFO_PRESENT, GetExitCodeProcess, INFINITE,
    InitializeProcThreadAttributeList, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
    PROC_THREAD_ATTRIBUTE_JOB_LIST, PROCESS_INFORMATION, ResetEvent, STARTF_USESTDHANDLES,
    STARTUPINFOEXW, SetEvent, TerminateProcess, UpdateProcThreadAttribute, WaitForMultipleObjects,
    WaitForSingleObject,
};

use super::{DRAIN_AFTER_EXIT, Exit, OutputSink, exit_message, start_pipe};
use crate::service::{CreatePipe, ProcessSignal, TerminalHandle, TerminalId};
use crate::transport::windows::{owned_handle, security::PrivateSecurity};

/// Wakes the reader when the daemon stops it.
const CANCEL_READY: u32 = WAIT_OBJECT_0 + 1;
/// Wakes the reader when the child exits.
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
            *self.killed.lock().unwrap_or_else(PoisonError::into_inner) = Some(name);
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
            eprintln!(
                "pipe process {id}: cannot join the job object, killing only the main process: {error}"
            );
            create_process(request, None, &client)
                .with_context(|| format!("failed to spawn {}", request.program))?
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
    // stdout and stderr are the same handle; list it once.
    let handles = [stdin.as_raw_handle(), client.as_raw_handle()];
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
    let mut command = command_line(&request.program, &request.args);
    let environment = environment_block(&request.env)?;
    let directory = wide(request.cwd.as_os_str())?;
    let mut startup = STARTUPINFOEXW::default();
    startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = stdin.as_raw_handle();
    startup.StartupInfo.hStdOutput = client.as_raw_handle();
    startup.StartupInfo.hStdError = client.as_raw_handle();
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
            &raw const startup.StartupInfo,
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
}

impl Drop for Cancel {
    fn drop(&mut self) {
        // SAFETY: the shared event stays open through the call.
        unsafe {
            SetEvent(self.0.as_raw_handle());
        }
    }
}

/// An unnamed, non-inheritable, initially unset manual-reset event.
fn event() -> io::Result<OwnedHandle> {
    // SAFETY: all pointers are null; a successful handle is adopted below.
    owned_handle(unsafe { CreateEventW(null(), 1, 0, null()) })
}

/// Reads output until every writer is gone, until [`DRAIN_AFTER_EXIT`] after
/// the process exits, or until [`Cancel`] fires.
fn read_output(pipe: Arc<OwnedHandle>, sink: OutputSink, cancel: Cancel, process: Arc<Process>) {
    let mut sink = sink;
    let Some(process_object) = process.process_handle() else {
        return;
    };
    let pipe_handle = pipe.as_raw_handle();
    let mut buffer = [0_u8; READ_BYTES];
    let read_event = match event() {
        Ok(event) => event,
        Err(error) => {
            sink.failed(error.to_string());
            return;
        }
    };
    let mut overlapped = OVERLAPPED {
        hEvent: read_event.as_raw_handle(),
        ..Default::default()
    };
    // The process may have exited before the reader started.
    let mut exited =
        unsafe { WaitForSingleObject(process_object.as_raw_handle(), 0) } == WAIT_OBJECT_0;
    let mut deadline = exited.then(|| Instant::now() + DRAIN_AFTER_EXIT);
    let mut pending = false;
    loop {
        if !pending {
            // SAFETY: the event is ours and the buffer and OVERLAPPED stay
            // live until the read completes or is cancelled below.
            unsafe {
                ResetEvent(read_event.as_raw_handle());
                let submitted = ReadFile(
                    pipe_handle,
                    buffer.as_mut_ptr(),
                    buffer.len() as u32,
                    null_mut(),
                    &mut overlapped,
                );
                if submitted != 0 {
                    match completed(pipe_handle, &overlapped) {
                        Ok(0) => {
                            sink.eof();
                            return;
                        }
                        Ok(length) => {
                            if !sink.write(&buffer[..length]) {
                                return;
                            }
                            continue;
                        }
                        Err(error) => {
                            end_on_read_error(sink, error);
                            return;
                        }
                    }
                }
            }
            let error = io::Error::last_os_error();
            if error.raw_os_error() != Some(ERROR_IO_PENDING as i32) {
                end_on_read_error(sink, error);
                return;
            }
            pending = true;
        }
        let timeout = match deadline {
            None => INFINITE,
            Some(deadline) => {
                let left = deadline.saturating_duration_since(Instant::now());
                // Round up: a sub-millisecond remainder must not become a busy 0.
                left.as_nanos().div_ceil(1_000_000).min(u32::MAX as u128) as u32
            }
        };
        let handles = [
            read_event.as_raw_handle(),
            cancel.handle(),
            process_object.as_raw_handle(),
        ];
        // Once the exit is seen, stop waiting on its signalled handle.
        let count = if exited { 2 } else { 3 };
        // SAFETY: every handle stays live through the wait.
        let ready = unsafe { WaitForMultipleObjects(count, handles.as_ptr(), 0, timeout) };
        match ready {
            WAIT_OBJECT_0 => {
                pending = false;
                match completed(pipe_handle, &overlapped) {
                    Ok(0) => {
                        sink.eof();
                        return;
                    }
                    Ok(length) => {
                        if !sink.write(&buffer[..length]) {
                            return;
                        }
                    }
                    Err(error) => {
                        end_on_read_error(sink, error);
                        return;
                    }
                }
            }
            CANCEL_READY => {
                cancel_read(pipe_handle, &overlapped);
                sink.eof();
                return;
            }
            PROCESS_READY => {
                exited = true;
                deadline = Some(Instant::now() + DRAIN_AFTER_EXIT);
            }
            WAIT_TIMEOUT => {
                // The drain deadline passed with a descendant still holding
                // the pipe open.
                cancel_read(pipe_handle, &overlapped);
                sink.eof();
                return;
            }
            _ => {
                let error = io::Error::last_os_error();
                cancel_read(pipe_handle, &overlapped);
                sink.failed(error.to_string());
                return;
            }
        }
    }
}

/// Reaps the completion of an overlapped read.
fn completed(pipe: HANDLE, overlapped: &OVERLAPPED) -> io::Result<usize> {
    let mut count = 0;
    // SAFETY: a completion was observed for this operation, whose OVERLAPPED
    // and buffer are still live.
    if unsafe { GetOverlappedResult(pipe, overlapped, &mut count, 0) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(count as usize)
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

/// Cancels the pending read and waits for its completion, so the kernel has
/// stopped using the buffer and OVERLAPPED before they are released.
fn cancel_read(pipe: HANDLE, overlapped: &OVERLAPPED) {
    let mut count = 0;
    // SAFETY: the caller's buffer and OVERLAPPED stay live through the call.
    unsafe {
        CancelIoEx(pipe, overlapped);
        GetOverlappedResult(pipe, overlapped, &mut count, 1);
    }
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
    // inheritable, and it is the only handle of this open.
    let client = unsafe {
        CreateFileW(
            name.as_ptr(),
            GENERIC_WRITE,
            0,
            &inheritable(),
            OPEN_EXISTING,
            0,
            null_mut(),
        )
    };
    let client = owned_handle(client).context("failed to connect output pipe")?;
    let connect_event = event()?;
    let mut overlapped = OVERLAPPED {
        hEvent: connect_event.as_raw_handle(),
        ..Default::default()
    };
    // The client end is already open, so the connect normally completes at
    // once with ERROR_PIPE_CONNECTED instead of waiting.
    if unsafe { ConnectNamedPipe(server.as_raw_handle(), &mut overlapped) } == 0 {
        let error = io::Error::last_os_error();
        match error.raw_os_error() {
            Some(code) if code == ERROR_PIPE_CONNECTED as i32 => {}
            Some(code) if code == ERROR_IO_PENDING as i32 => {
                let mut count = 0;
                // SAFETY: both handles and the OVERLAPPED stay live here.
                if unsafe {
                    GetOverlappedResult(server.as_raw_handle(), &overlapped, &mut count, 1)
                } == 0
                {
                    return Err(io::Error::last_os_error())
                        .context("failed to connect output pipe");
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
            GENERIC_READ | GENERIC_WRITE,
            FILE_SHARE_READ | FILE_SHARE_WRITE,
            &inheritable(),
            OPEN_EXISTING,
            0,
            null_mut(),
        )
    })
}

/// The command line `CreateProcessW` parses and the child recovers with
/// `CommandLineToArgvW`/MSVCRT rules: the same algorithm as Rust std.
fn command_line(program: &str, args: &[String]) -> Vec<u16> {
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
    line
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
/// sorted UTF-16 entries terminated by a NUL, and a final NUL for the block.
fn environment_block(env: &HashMap<String, String>) -> io::Result<Vec<u16>> {
    let mut entries = Vec::with_capacity(env.len());
    for (key, value) in env {
        if key.is_empty() || key.contains(['\0', '=']) || value.contains('\0') {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "environment variable cannot be passed to a child process",
            ));
        }
        let mut entry: Vec<u16> = format!("{key}={value}").encode_utf16().collect();
        entry.push(0);
        entries.push(entry);
    }
    // Windows wants the block sorted; UTF-16 order matches the case-insensitive
    // ordinal order for the names environment variables use in practice.
    entries.sort();
    let mut block = Vec::new();
    // An empty environment is signalled by a null, like Rust std.
    if entries.is_empty() {
        block.push(0);
    }
    for entry in entries {
        block.extend(entry);
    }
    block.push(0);
    Ok(block)
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

    fn text(value: &[u16]) -> String {
        String::from_utf16(value).unwrap()
    }

    #[test]
    fn command_lines_are_terminated_and_quoted_for_msvcrt_parsing() {
        let line = command_line("cmd.exe", &["/d".into(), "/c".into(), "echo hi".into()]);
        assert_eq!(line.last(), Some(&0));
        assert_eq!(
            text(&line[..line.len() - 1]),
            r#""cmd.exe" /d /c "echo hi""#
        );

        let line = command_line("a b.exe", &[String::new(), r#"echo "hi""#.into()]);
        assert_eq!(
            text(&line[..line.len() - 1]),
            r#""a b.exe" "" "echo \"hi\"""#
        );

        // A quoted argument with a trailing backslash keeps the closing quote.
        let line = command_line("x.exe", &[r"C:\a b\".into()]);
        assert_eq!(text(&line[..line.len() - 1]), r#""x.exe" "C:\a b\\""#);
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
}
