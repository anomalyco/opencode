//! Full-duplex, overlapped byte-mode named pipes. Every pending operation owns
//! its OVERLAPPED/event and is cancelled and reaped before its buffer is released.
//! No FlushFileBuffers: it can wait indefinitely for an uncooperative client.

use std::io::{self, Read, Write};
use std::os::windows::ffi::OsStrExt;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
use std::path::Path;
use std::ptr::{null, null_mut};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crossbeam_channel::{Receiver, bounded};
use windows_sys::Win32::Foundation::{
    ERROR_BROKEN_PIPE, ERROR_IO_INCOMPLETE, ERROR_IO_PENDING, ERROR_NO_DATA, ERROR_PIPE_BUSY,
    ERROR_PIPE_CONNECTED, ERROR_PIPE_NOT_CONNECTED, GENERIC_READ, GENERIC_WRITE, HANDLE,
    INVALID_HANDLE_VALUE, WAIT_OBJECT_0, WAIT_TIMEOUT,
};
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, FILE_FLAG_FIRST_PIPE_INSTANCE, FILE_FLAG_OVERLAPPED, OPEN_EXISTING,
    PIPE_ACCESS_DUPLEX, ReadFile, SECURITY_IDENTIFICATION, SECURITY_SQOS_PRESENT, WriteFile,
};
use windows_sys::Win32::System::IO::{CancelIoEx, GetOverlappedResult, OVERLAPPED};
use windows_sys::Win32::System::Pipes::{
    ConnectNamedPipe, CreateNamedPipeW, GetNamedPipeServerProcessId, PIPE_READMODE_BYTE,
    PIPE_REJECT_REMOTE_CLIENTS, PIPE_TYPE_BYTE, PIPE_UNLIMITED_INSTANCES, PIPE_WAIT,
    WaitNamedPipeW,
};
use windows_sys::Win32::System::Threading::{
    CreateEventW, INFINITE, SetEvent, WaitForMultipleObjects, WaitForSingleObject,
};

pub(crate) mod security;
use super::retained::Retained;
use security::PrivateSecurity;

const BUFFER_BYTES: u32 = 64 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const COMPLETION_TIMEOUT: Duration = Duration::from_secs(2);

pub(crate) struct Listener {
    endpoint: Vec<u16>,
    security: PrivateSecurity,
    pending: PendingConnection,
    stopped: bool,
}

impl Listener {
    pub fn bind(endpoint: &Path) -> io::Result<Self> {
        let endpoint = endpoint_name(endpoint)?;
        let security = PrivateSecurity::new()?;
        // Fail closed if anyone already owns this name. Never attach to or
        // replace an existing server, even one with the same user SID.
        let pending = PendingConnection::new(&endpoint, &security, true)?;
        Ok(Self {
            endpoint,
            security,
            pending,
            stopped: false,
        })
    }

    pub fn accept(&mut self) -> io::Result<Option<Connection>> {
        if self.stopped || !self.pending.ready()? {
            return Ok(None);
        }
        // Create the next instance BEFORE handing off the connected one, so the
        // registered name is continuously owned even between short requests.
        let next = PendingConnection::new(&self.endpoint, &self.security, false)?;
        let previous = std::mem::replace(&mut self.pending, next);
        Ok(Some(Connection {
            pipe: Arc::clone(&previous.operation.pipe),
            read_timeout: None,
            write_timeout: None,
        }))
    }

    /// Stop accepting without releasing the namespace. Keep the listener alive
    /// until registration is removed, including throughout daemon cleanup.
    pub fn stop(&mut self) {
        self.stopped = true;
        self.pending.operation.pipe.cancel();
    }
}

struct PendingConnection {
    operation: Operation,
    connected: bool,
}

impl PendingConnection {
    fn new(endpoint: &[u16], security: &PrivateSecurity, first: bool) -> io::Result<Self> {
        let flags = PIPE_ACCESS_DUPLEX
            | FILE_FLAG_OVERLAPPED
            | if first {
                FILE_FLAG_FIRST_PIPE_INSTANCE
            } else {
                0
            };
        // SAFETY: endpoint is NUL-terminated; attributes and their descriptor live
        // through the call. The returned handle is uniquely adopted below.
        let handle = unsafe {
            CreateNamedPipeW(
                endpoint.as_ptr(),
                flags,
                PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS,
                PIPE_UNLIMITED_INSTANCES,
                BUFFER_BYTES,
                BUFFER_BYTES,
                0,
                &security.attributes(),
            )
        };
        let pipe = Arc::new(Pipe::new(owned_handle(handle)?)?);
        let mut operation = Operation::new(pipe)?;
        let connected = match operation.begin(|handle, overlapped| {
            // SAFETY: Operation retains the handle and OVERLAPPED through completion.
            unsafe { ConnectNamedPipe(handle, overlapped) }
        }) {
            Ok(result) => result.is_some(),
            // A client can connect (and even close) between CreateNamedPipe and
            // ConnectNamedPipe. Hand off that connection; its reader sees EOF.
            Err(error) if matches!(error.raw_os_error(), Some(code) if code == ERROR_PIPE_CONNECTED as i32 || code == ERROR_NO_DATA as i32) => {
                true
            }
            Err(error) => return Err(error),
        };
        Ok(Self {
            operation,
            connected,
        })
    }

    fn ready(&mut self) -> io::Result<bool> {
        if !self.connected {
            self.connected = self.operation.poll()?.is_some();
        }
        Ok(self.connected)
    }
}

struct Pipe {
    handle: OwnedHandle,
    cancelled: OwnedHandle,
}

impl Pipe {
    fn new(handle: OwnedHandle) -> io::Result<Self> {
        Ok(Self {
            handle,
            cancelled: event()?,
        })
    }

    fn cancel(&self) {
        // SAFETY: this manual-reset event stays valid while any operation or
        // cancellation handle holds the Pipe. Signalling it is idempotent.
        unsafe {
            SetEvent(self.cancelled.as_raw_handle());
        }
    }
}

pub struct Connection {
    pipe: Arc<Pipe>,
    read_timeout: Option<Duration>,
    write_timeout: Option<Duration>,
}

impl Connection {
    pub fn connect(endpoint: &Path) -> io::Result<Self> {
        let endpoint = endpoint_name(endpoint)?;
        let deadline = Instant::now() + CONNECT_TIMEOUT;
        loop {
            // SECURITY_IDENTIFICATION prevents a rogue server from impersonating
            // this client. Client handles are non-inheritable and overlapped too.
            // SAFETY: endpoint is NUL-terminated; unused pointers are null.
            let handle = unsafe {
                CreateFileW(
                    endpoint.as_ptr(),
                    GENERIC_READ | GENERIC_WRITE,
                    0,
                    null(),
                    OPEN_EXISTING,
                    FILE_FLAG_OVERLAPPED | SECURITY_SQOS_PRESENT | SECURITY_IDENTIFICATION,
                    null_mut(),
                )
            };
            match owned_handle(handle) {
                Ok(handle) => {
                    return Ok(Self {
                        pipe: Arc::new(Pipe::new(handle)?),
                        read_timeout: None,
                        write_timeout: None,
                    });
                }
                Err(error) if error.raw_os_error() == Some(ERROR_PIPE_BUSY as i32) => {
                    if Instant::now() >= deadline {
                        return Err(io::Error::new(
                            io::ErrorKind::TimedOut,
                            "named pipe is busy",
                        ));
                    }
                    // SAFETY: endpoint is valid; each kernel wait is bounded.
                    unsafe {
                        WaitNamedPipeW(endpoint.as_ptr(), 10);
                    }
                }
                Err(error) => return Err(error),
            }
        }
    }

    /// Connects only if the pipe server is the registered daemon process.
    ///
    /// Pipe names are visible to other local users. After a daemon crash its
    /// registration remains, and another user could create a pipe with the
    /// stale name; the endpoint's protections only last while the daemon holds
    /// it. Clients must verify the server before sending credentials or input.
    pub fn connect_to(endpoint: &Path, server_pid: u32) -> io::Result<Self> {
        let connection = Self::connect(endpoint)?;
        let mut pid = 0;
        // SAFETY: the connection owns a live pipe handle; pid is valid output.
        if unsafe { GetNamedPipeServerProcessId(connection.pipe.handle.as_raw_handle(), &mut pid) }
            == 0
        {
            return Err(io::Error::last_os_error());
        }
        if pid != server_pid {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "named pipe server is not the registered opencode-pty daemon",
            ));
        }
        Ok(connection)
    }

    /// A timed-out operation is cancelled but may already have transferred
    /// some bytes, so the protocol stream is no longer framed reliably.
    /// Discard the connection after any timeout error.
    pub fn set_read_timeout(&mut self, timeout: Option<Duration>) {
        self.read_timeout = timeout;
    }

    pub fn set_write_timeout(&mut self, timeout: Option<Duration>) {
        self.write_timeout = timeout;
    }

    pub(crate) fn cancellation(&self) -> io::Result<Cancellation> {
        Ok(Cancellation(Arc::clone(&self.pipe)))
    }

    /// Protocol 7 has an explicit response/final event, not a pipe half-close.
    /// Retain the pipe until the client reads that frame and closes its end.
    /// An uncooperative peer is cancelled after a bounded grace period.
    pub(crate) fn finish_response(&mut self) -> io::Result<()> {
        match self.read_with_timeout(&mut [0], Some(COMPLETION_TIMEOUT)) {
            Ok(0) => Ok(()),
            Ok(_) => Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "unexpected data after request",
            )),
            Err(error) => {
                self.pipe.cancel();
                Err(error)
            }
        }
    }

    pub(crate) fn monitor_disconnect(&self) -> io::Result<DisconnectMonitor> {
        let mut reader = Self {
            pipe: Arc::clone(&self.pipe),
            read_timeout: None,
            write_timeout: None,
        };
        let cancellation = self.cancellation()?;
        let (sender, disconnected) = bounded(1);
        let thread = thread::spawn(move || {
            let _ = reader.read(&mut [0]);
            let _ = sender.send(());
        });
        Ok(DisconnectMonitor {
            disconnected,
            cancellation,
            thread,
        })
    }

    fn read_with_timeout(
        &mut self,
        bytes: &mut [u8],
        timeout: Option<Duration>,
    ) -> io::Result<usize> {
        if bytes.is_empty() {
            return Ok(0);
        }
        let mut operation = Operation::new(Arc::clone(&self.pipe))?;
        let result = operation
            .begin(|handle, overlapped| {
                // SAFETY: bytes and the OVERLAPPED remain live until wait/drop reaps
                // the operation. Only one reader is used on each end of a pipe.
                unsafe {
                    ReadFile(
                        handle,
                        bytes.as_mut_ptr(),
                        bytes.len().min(BUFFER_BYTES as usize) as u32,
                        null_mut(),
                        overlapped,
                    )
                }
            })
            .and_then(|ready| match ready {
                Some(count) => Ok(count),
                None => operation.wait(timeout),
            });
        match result {
            Ok(count) => Ok(count as usize),
            Err(error) if matches!(error.raw_os_error(), Some(code) if code == ERROR_BROKEN_PIPE as i32 || code == ERROR_PIPE_NOT_CONNECTED as i32 || code == ERROR_NO_DATA as i32) => {
                Ok(0)
            }
            Err(error) => Err(error),
        }
    }
}

impl Read for Connection {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        self.read_with_timeout(bytes, self.read_timeout)
    }
}

impl Write for Connection {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.is_empty() {
            return Ok(0);
        }
        let mut operation = Operation::new(Arc::clone(&self.pipe))?;
        let ready = operation.begin(|handle, overlapped| {
            // SAFETY: bytes and OVERLAPPED remain live through completion; at
            // most BUFFER_BYTES are submitted, bounding each kernel I/O buffer.
            unsafe {
                WriteFile(
                    handle,
                    bytes.as_ptr(),
                    bytes.len().min(BUFFER_BYTES as usize) as u32,
                    null_mut(),
                    overlapped,
                )
            }
        })?;
        Ok(match ready {
            Some(count) => count,
            None => operation.wait(self.write_timeout)?,
        } as usize)
    }

    fn flush(&mut self) -> io::Result<()> {
        // No userspace buffering. FlushFileBuffers is NOT a cancellable stream
        // flush and must never be used for framing or shutdown.
        Ok(())
    }
}

pub(crate) struct Cancellation(Arc<Pipe>);

impl Cancellation {
    pub fn cancel(&self) {
        self.0.cancel();
    }
}

pub(crate) struct DisconnectMonitor {
    disconnected: Receiver<()>,
    cancellation: Cancellation,
    thread: JoinHandle<()>,
}

impl DisconnectMonitor {
    pub fn disconnected(&self) -> &Receiver<()> {
        &self.disconnected
    }

    pub fn finish(self) {
        // No half-close exists. Protocol clients close after their final frame;
        // retain queued bytes for them, but never wait indefinitely for closure.
        if self.disconnected.recv_timeout(COMPLETION_TIMEOUT).is_err() {
            self.cancellation.cancel();
        }
        let _ = self.thread.join();
    }
}

struct Operation {
    pipe: Arc<Pipe>,
    overlapped: Retained<OVERLAPPED>,
    event: OwnedHandle,
    pending: bool,
}

impl Operation {
    fn new(pipe: Arc<Pipe>) -> io::Result<Self> {
        // SAFETY: the event is owned by pipe and zero timeout only queries it.
        if unsafe { WaitForSingleObject(pipe.cancelled.as_raw_handle(), 0) } == WAIT_OBJECT_0 {
            return Err(cancelled());
        }
        let event = event()?;
        let overlapped = Retained::new(OVERLAPPED {
            hEvent: event.as_raw_handle(),
            ..Default::default()
        });
        Ok(Self {
            pipe,
            overlapped,
            event,
            pending: false,
        })
    }

    fn begin(
        &mut self,
        submit: impl FnOnce(HANDLE, *mut OVERLAPPED) -> i32,
    ) -> io::Result<Option<u32>> {
        self.pending = true;
        if submit(self.pipe.handle.as_raw_handle(), self.overlapped.as_ptr()) != 0 {
            return self.poll();
        }
        let error = io::Error::last_os_error();
        if error.raw_os_error() == Some(ERROR_IO_PENDING as i32) {
            Ok(None)
        } else {
            self.pending = false;
            Err(error)
        }
    }

    fn poll(&mut self) -> io::Result<Option<u32>> {
        let mut count = 0;
        // SAFETY: both handle and OVERLAPPED belong to this live operation.
        if unsafe {
            GetOverlappedResult(
                self.pipe.handle.as_raw_handle(),
                self.overlapped.as_ptr(),
                &mut count,
                0,
            )
        } != 0
        {
            self.pending = false;
            return Ok(Some(count));
        }
        let error = io::Error::last_os_error();
        if error.raw_os_error() == Some(ERROR_IO_INCOMPLETE as i32) {
            return Ok(None);
        }
        self.pending = false;
        Err(error)
    }

    fn wait(&mut self, timeout: Option<Duration>) -> io::Result<u32> {
        let handles = [
            self.pipe.cancelled.as_raw_handle(),
            self.event.as_raw_handle(),
        ];
        let milliseconds = timeout.map_or(INFINITE, |time| {
            time.as_millis().min((INFINITE - 1) as u128) as u32
        });
        // SAFETY: both event handles remain live throughout this bounded or
        // explicitly cancellable wait. Cancellation wins if both are signalled.
        let result = unsafe { WaitForMultipleObjects(2, handles.as_ptr(), 0, milliseconds) };
        if result == WAIT_OBJECT_0 {
            return Err(cancelled());
        }
        if result == WAIT_TIMEOUT {
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                "named pipe completion timed out",
            ));
        }
        if result != WAIT_OBJECT_0 + 1 {
            return Err(io::Error::last_os_error());
        }
        self.poll()?
            .ok_or_else(|| io::Error::other("named pipe signalled before I/O completion"))
    }
}

impl Drop for Operation {
    fn drop(&mut self) {
        if self.pending {
            // SAFETY: cancel THIS operation, then reap its completion before
            // freeing the OVERLAPPED/event or returning the borrowed I/O buffer.
            // CancelIoEx alone does not guarantee the kernel has stopped using it.
            unsafe {
                CancelIoEx(self.pipe.handle.as_raw_handle(), self.overlapped.as_ptr());
                let mut count = 0;
                GetOverlappedResult(
                    self.pipe.handle.as_raw_handle(),
                    self.overlapped.as_ptr(),
                    &mut count,
                    1,
                );
            }
        }
    }
}

fn event() -> io::Result<OwnedHandle> {
    // SAFETY: create an unnamed, non-inheritable, initially unset manual-reset event.
    owned_handle(unsafe { CreateEventW(null(), 1, 0, null()) })
}

pub(crate) fn owned_handle(handle: HANDLE) -> io::Result<OwnedHandle> {
    if handle.is_null() || handle == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: callers pass newly created, uniquely owned handles.
    Ok(unsafe { OwnedHandle::from_raw_handle(handle) })
}

fn cancelled() -> io::Error {
    // Not Interrupted: Read::read_exact retries Interrupted forever.
    io::Error::new(
        io::ErrorKind::ConnectionAborted,
        "named pipe operation cancelled",
    )
}

fn endpoint_name(endpoint: &Path) -> io::Result<Vec<u16>> {
    let value = endpoint.as_os_str().encode_wide().collect::<Vec<_>>();
    let prefix = r"\\.\pipe\opencode-pty-".encode_utf16().collect::<Vec<_>>();
    if !value.starts_with(&prefix)
        || value.len() == prefix.len()
        || value[prefix.len()..]
            .iter()
            .any(|unit| *unit == 0 || *unit == b'\\' as u16 || *unit == b'/' as u16)
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "expected a local opencode-pty named-pipe endpoint",
        ));
    }
    Ok(value.into_iter().chain([0]).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{Response, read_frame, write_frame};
    use std::path::PathBuf;

    fn endpoint() -> PathBuf {
        PathBuf::from(format!(
            r"\\.\pipe\opencode-pty-{:032x}",
            rand::random::<u128>()
        ))
    }

    fn accept(listener: &mut Listener) -> Connection {
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            if let Some(connection) = listener.accept().unwrap() {
                return connection;
            }
            assert!(Instant::now() < deadline, "named pipe accept timed out");
            thread::sleep(Duration::from_millis(1));
        }
    }

    #[test]
    fn multiple_byte_stream_connections_and_namespace_ownership() {
        let endpoint = endpoint();
        let mut listener = Listener::bind(&endpoint).unwrap();
        assert!(listener.accept().unwrap().is_none());
        assert!(
            Listener::bind(&endpoint).is_err(),
            "must not join an existing server name"
        );
        let mut first = Connection::connect(&endpoint).unwrap();
        let mut first_server = accept(&mut listener);
        let mut second = Connection::connect(&endpoint).unwrap();
        let mut second_server = accept(&mut listener);
        // Split writes are a byte stream, not Windows message-mode records.
        first.write_all(b"ab").unwrap();
        first.write_all(b"cd").unwrap();
        second.write_all(b"xy").unwrap();
        let mut bytes = [0; 4];
        first_server.read_exact(&mut bytes).unwrap();
        assert_eq!(&bytes, b"abcd");
        second_server.read_exact(&mut bytes[..2]).unwrap();
        assert_eq!(&bytes[..2], b"xy");
        write_frame(&mut first_server, &Response::Owned).unwrap();
        assert!(matches!(read_frame(&mut first).unwrap(), Response::Owned));
        drop((first, first_server, second, second_server));
        assert!(Listener::bind(&endpoint).is_err());
        listener.stop();
        assert!(listener.accept().unwrap().is_none());
        assert!(
            Listener::bind(&endpoint).is_err(),
            "stop must retain the registered name"
        );
        drop(listener);
        Listener::bind(&endpoint).unwrap();
    }

    #[test]
    fn cancellation_wakes_partial_request_reads() {
        let endpoint = endpoint();
        let mut listener = Listener::bind(&endpoint).unwrap();
        let mut client = Connection::connect(&endpoint).unwrap();
        let mut server = accept(&mut listener);
        let cancellation = server.cancellation().unwrap();
        client.write_all(&[0, 0]).unwrap();
        let (sender, receiver) = bounded(1);
        let reader = thread::spawn(move || {
            sender.send(read_frame::<Response>(&mut server)).unwrap();
        });
        cancellation.cancel();
        cancellation.cancel();
        assert!(
            receiver
                .recv_timeout(Duration::from_secs(3))
                .unwrap()
                .is_err()
        );
        reader.join().unwrap();
    }

    #[test]
    fn cancellation_wakes_backpressured_writes() {
        let endpoint = endpoint();
        let mut listener = Listener::bind(&endpoint).unwrap();
        let _client = Connection::connect(&endpoint).unwrap();
        let mut server = accept(&mut listener);
        let cancellation = server.cancellation().unwrap();
        let (started, ready) = bounded(1);
        let (sender, receiver) = bounded(1);
        let writer = thread::spawn(move || {
            started.send(()).unwrap();
            sender
                .send(server.write_all(&[2; 2 * BUFFER_BYTES as usize]))
                .unwrap();
        });
        ready.recv_timeout(Duration::from_secs(3)).unwrap();
        assert!(
            receiver.recv_timeout(Duration::from_millis(50)).is_err(),
            "write should be backpressured"
        );
        cancellation.cancel();
        assert!(
            receiver
                .recv_timeout(Duration::from_secs(3))
                .unwrap()
                .is_err()
        );
        writer.join().unwrap();
    }

    #[test]
    fn final_response_survives_until_client_reads_and_disconnects() {
        let endpoint = endpoint();
        let mut listener = Listener::bind(&endpoint).unwrap();
        let mut client = Connection::connect(&endpoint).unwrap();
        let mut server = accept(&mut listener);
        let (sender, receiver) = bounded(1);
        let writer = thread::spawn(move || {
            write_frame(
                &mut server,
                &Response::Exited {
                    exit_code: Some(0),
                    final_offset: 123,
                },
            )
            .unwrap();
            sender.send(server.finish_response()).unwrap();
        });
        assert!(
            receiver.recv_timeout(Duration::from_millis(50)).is_err(),
            "server must retain final response"
        );
        assert!(matches!(
            read_frame(&mut client).unwrap(),
            Response::Exited {
                final_offset: 123,
                ..
            }
        ));
        drop(client);
        receiver
            .recv_timeout(Duration::from_secs(3))
            .unwrap()
            .unwrap();
        writer.join().unwrap();
    }

    #[test]
    fn subscription_completion_is_bounded_and_cancellable() {
        let endpoint = endpoint();
        let mut listener = Listener::bind(&endpoint).unwrap();
        let _client = Connection::connect(&endpoint).unwrap();
        let server = accept(&mut listener);
        let monitor = server.monitor_disconnect().unwrap();
        let start = Instant::now();
        monitor.finish();
        assert!(start.elapsed() < Duration::from_secs(4));

        let _client = Connection::connect(&endpoint).unwrap();
        let server = accept(&mut listener);
        let monitor = server.monitor_disconnect().unwrap();
        let cancellation = server.cancellation().unwrap();
        cancellation.cancel();
        monitor
            .disconnected()
            .recv_timeout(Duration::from_secs(3))
            .unwrap();
        monitor.finish();
    }

    #[test]
    fn verified_connect_requires_the_expected_server_process() {
        let endpoint = endpoint();
        let mut listener = Listener::bind(&endpoint).unwrap();
        let _verified = Connection::connect_to(&endpoint, std::process::id()).unwrap();
        let _server = accept(&mut listener);
        let error = Connection::connect_to(&endpoint, std::process::id().wrapping_add(4))
            .err()
            .expect("a different server process must be rejected");
        assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
    }

    #[test]
    fn remote_and_non_pipe_endpoints_are_rejected() {
        for endpoint in [
            r"\\remote\pipe\opencode-pty-test",
            r"C:\tmp\pipe",
            r"\\.\pipe\opencode-pty-test\nested",
        ] {
            assert!(Connection::connect(Path::new(endpoint)).is_err());
            assert!(Listener::bind(Path::new(endpoint)).is_err());
        }
    }
}
