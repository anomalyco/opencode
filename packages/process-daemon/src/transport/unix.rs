use std::io::{self, Read, Write};
use std::net::Shutdown;
use std::os::fd::AsFd;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::Path;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use crossbeam_channel::{Receiver, bounded};
use nix::errno::Errno;
use nix::poll::{PollFd, PollFlags, PollTimeout, poll};

pub(crate) struct Listener(Option<UnixListener>);

impl Listener {
    pub fn bind(endpoint: &Path) -> io::Result<Self> {
        let listener = UnixListener::bind(endpoint)?;
        listener.set_nonblocking(true)?;
        Ok(Self(Some(listener)))
    }

    /// Non-blocking; call after `wait` reports `connection`.
    pub fn accept(&mut self) -> io::Result<Option<Connection>> {
        let Some(listener) = &self.0 else {
            return Ok(None);
        };
        match listener.accept() {
            Ok((stream, _)) => {
                // macOS inherits the listener's nonblocking mode on accepted sockets.
                stream.set_nonblocking(false)?;
                Ok(Some(Connection(stream)))
            }
            Err(error) if error.kind() == io::ErrorKind::WouldBlock => Ok(None),
            Err(error) => Err(error),
        }
    }

    pub fn stop(&mut self) {
        self.0.take();
    }

    /// Block until a connection may be pending, `wake` is notified, or `timeout` elapses.
    /// `listen == false` leaves the listener out of the poll set (accept back-off).
    pub fn wait(&self, wake: &Wake, listen: bool, timeout: Duration) -> io::Result<Readiness> {
        let wake_fd = PollFd::new(wake.reader.as_fd(), PollFlags::POLLIN);
        let mut fds = [wake_fd, wake_fd];
        let count = match &self.0 {
            Some(listener) if listen => {
                fds[1] = PollFd::new(listener.as_fd(), PollFlags::POLLIN);
                2
            }
            _ => 1,
        };
        let fds = &mut fds[..count];
        // Round up: truncating a sub-millisecond remainder to 0 would spin until the deadline.
        let millis = timeout.as_nanos().div_ceil(1_000_000).min(i32::MAX as u128);
        let timeout = PollTimeout::try_from(millis).map_err(io::Error::other)?;
        match poll(fds, timeout) {
            // EINTR must never look like a timeout, or the missed-wake detector could fire.
            Err(Errno::EINTR) => return Ok(Readiness::default()),
            Err(error) => return Err(error.into()),
            Ok(0) => {
                return Ok(Readiness {
                    connection: false,
                    timed_out: true,
                });
            }
            Ok(_) => {}
        }
        // `revents` is `None` only for flags nix does not know; treat that as "maybe ready".
        if fds.iter().any(|fd| {
            fd.revents()
                .is_some_and(|events| events.contains(PollFlags::POLLNVAL))
        }) {
            return Err(io::Error::other("poll reported a closed descriptor"));
        }
        // Wake POLLIN is handled by the caller's drain. Errors cannot occur while `Wake` owns
        // both ends, so fail rather than spin on them.
        if fds[0]
            .revents()
            .is_some_and(|events| events.intersects(PollFlags::POLLERR | PollFlags::POLLHUP))
        {
            return Err(io::Error::other("wake channel failed"));
        }
        // Readiness may be spurious; the listener stays non-blocking and accept reports the
        // real error, if any.
        let connection = fds.get(1).is_some_and(|fd| {
            fd.revents().is_none_or(|events| {
                events.intersects(PollFlags::POLLIN | PollFlags::POLLERR | PollFlags::POLLHUP)
            })
        });
        Ok(Readiness {
            connection,
            timed_out: false,
        })
    }
}

/// Readiness reported by `Listener::wait`. `connection` means "call accept now"; it may be
/// spurious, so the listener stays non-blocking. `timed_out` is true only when poll returned 0.
/// Wake-channel readiness is not reported: the loop learns it from `Wake::drain`.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct Readiness {
    pub connection: bool,
    pub timed_out: bool,
}

/// Self-pipe that wakes the daemon loop. Both ends are non-blocking and close-on-exec
/// (std creates socket pairs close-on-exec).
pub(crate) struct Wake {
    reader: UnixStream,
    writer: UnixStream,
}

impl Wake {
    pub fn new() -> io::Result<Self> {
        let (reader, writer) = UnixStream::pair()?;
        reader.set_nonblocking(true)?;
        writer.set_nonblocking(true)?;
        Ok(Self { reader, writer })
    }

    /// Never blocks. A full buffer (`WouldBlock`) already guarantees a pending wake.
    pub fn notify(&self) {
        loop {
            match (&self.writer).write(&[1]) {
                Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                Ok(_) => return,
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => return,
                Err(error) => {
                    eprintln!("opencode-pty wake failed: {error}");
                    return;
                }
            }
        }
    }

    /// Read until `WouldBlock`. Returns whether at least one byte was consumed.
    pub fn drain(&self) -> bool {
        let mut woken = false;
        let mut buffer = [0_u8; 64];
        loop {
            match (&self.reader).read(&mut buffer) {
                Ok(0) => return woken,
                Ok(_) => woken = true,
                Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => return woken,
                Err(error) => {
                    eprintln!("opencode-pty wake drain failed: {error}");
                    return woken;
                }
            }
        }
    }

    /// Whether a wake byte is pending, without consuming it.
    #[cfg(test)]
    pub fn pending(&self) -> bool {
        let mut fds = [PollFd::new(self.reader.as_fd(), PollFlags::POLLIN)];
        poll(&mut fds, PollTimeout::ZERO).unwrap() > 0
    }
}

pub(crate) struct Connection(UnixStream);

impl Connection {
    pub fn connect(endpoint: &Path) -> io::Result<Self> {
        UnixStream::connect(endpoint).map(Self)
    }

    pub fn set_read_timeout(&self, timeout: Option<Duration>) -> io::Result<()> {
        self.0.set_read_timeout(timeout)
    }

    pub fn set_write_timeout(&self, timeout: Option<Duration>) -> io::Result<()> {
        self.0.set_write_timeout(timeout)
    }

    pub fn cancellation(&self) -> io::Result<Cancellation> {
        self.0.try_clone().map(Cancellation)
    }

    /// Unix close preserves queued response bytes; no peer acknowledgement is needed.
    pub fn finish_response(&mut self) -> io::Result<()> {
        Ok(())
    }

    /// Subscriptions have no more request input. A read detects peer closure (or
    /// unexpected extra input) while the handler writes events.
    pub fn monitor_disconnect(&self) -> io::Result<DisconnectMonitor> {
        let mut reader = self.0.try_clone()?;
        let stream = self.0.try_clone()?;
        let (sender, disconnected) = bounded(1);
        let thread = thread::spawn(move || {
            let _ = reader.read(&mut [0_u8; 1]);
            let _ = sender.send(());
        });
        Ok(DisconnectMonitor {
            stream,
            disconnected,
            thread,
        })
    }
}

impl Read for Connection {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        self.0.read(bytes)
    }
}

impl Write for Connection {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0.write(bytes)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.0.flush()
    }
}

pub(crate) struct Cancellation(UnixStream);

impl Cancellation {
    /// Idempotently wake partial request reads and backpressured writes.
    pub fn cancel(&self) {
        let _ = self.0.shutdown(Shutdown::Both);
    }
}

pub(crate) struct DisconnectMonitor {
    stream: UnixStream,
    disconnected: Receiver<()>,
    thread: JoinHandle<()>,
}

impl DisconnectMonitor {
    pub fn disconnected(&self) -> &Receiver<()> {
        &self.disconnected
    }

    pub fn finish(self) {
        // A full shutdown can discard a just-written final frame on macOS.
        // Half-close first so the peer drains queued output before closing.
        // Daemon-wide cancellation still interrupts this wait during shutdown.
        let _ = self.stream.shutdown(Shutdown::Write);
        let _ = self.thread.join();
    }
}

#[cfg(test)]
mod tests {
    use std::os::fd::AsRawFd;
    use std::time::Instant;

    use super::*;
    use crate::protocol::{Response, read_frame, write_frame};

    fn endpoint() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("pty-{:032x}.sock", rand::random::<u128>()))
    }

    #[test]
    fn wake_is_cloexec_and_nonblocking() {
        let wake = Wake::new().unwrap();
        for fd in [wake.reader.as_raw_fd(), wake.writer.as_raw_fd()] {
            // SAFETY: fcntl only queries flags of a descriptor owned by `wake`.
            let descriptor = unsafe { libc::fcntl(fd, libc::F_GETFD) };
            // SAFETY: as above.
            let status = unsafe { libc::fcntl(fd, libc::F_GETFL) };
            assert!(descriptor >= 0 && status >= 0);
            assert_ne!(descriptor & libc::FD_CLOEXEC, 0);
            assert_ne!(status & libc::O_NONBLOCK, 0);
        }
    }

    #[test]
    fn wake_notify_never_blocks_and_drain_empties() {
        let wake = Wake::new().unwrap();
        assert!(!wake.pending());
        for _ in 0..100_000 {
            wake.notify();
        }
        assert!(wake.pending());
        assert!(wake.drain());
        assert!(!wake.drain());
        assert!(!wake.pending());
    }

    #[test]
    fn listener_wait_reports_each_source() {
        let endpoint = endpoint();
        let mut listener = Listener::bind(&endpoint).unwrap();
        let wake = Wake::new().unwrap();

        let ready = listener
            .wait(&wake, true, Duration::from_millis(20))
            .unwrap();
        assert!(ready.timed_out && !ready.connection);

        wake.notify();
        let started = Instant::now();
        let ready = listener.wait(&wake, true, Duration::from_secs(5)).unwrap();
        assert!(started.elapsed() < Duration::from_secs(1));
        assert!(!ready.timed_out && !ready.connection);
        assert!(wake.drain());

        let _client = Connection::connect(&endpoint).unwrap();
        let ready = listener.wait(&wake, true, Duration::from_secs(5)).unwrap();
        assert!(!ready.timed_out && ready.connection);
        assert!(listener.accept().unwrap().is_some());

        let _pending = Connection::connect(&endpoint).unwrap();
        let ready = listener
            .wait(&wake, false, Duration::from_millis(20))
            .unwrap();
        assert!(ready.timed_out && !ready.connection);

        drop(listener);
        std::fs::remove_file(endpoint).unwrap();
    }

    #[test]
    fn listener_wait_rounds_timeout_up() {
        let endpoint = endpoint();
        let listener = Listener::bind(&endpoint).unwrap();
        let wake = Wake::new().unwrap();
        let started = Instant::now();
        let ready = listener
            .wait(&wake, true, Duration::from_micros(300))
            .unwrap();
        assert!(ready.timed_out && !ready.connection);
        assert!(started.elapsed() >= Duration::from_micros(300));
        drop(listener);
        std::fs::remove_file(endpoint).unwrap();
    }

    #[test]
    fn listener_polls_and_connections_roundtrip() {
        let endpoint = endpoint();
        let mut listener = Listener::bind(&endpoint).unwrap();
        assert!(listener.accept().unwrap().is_none());
        let mut client = Connection::connect(&endpoint).unwrap();
        client
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut server = listener.accept().unwrap().unwrap();
        write_frame(&mut client, &Response::Owned).unwrap();
        assert!(matches!(read_frame(&mut server).unwrap(), Response::Owned));
        write_frame(&mut server, &Response::Ok).unwrap();
        server.finish_response().unwrap();
        assert!(matches!(read_frame(&mut client).unwrap(), Response::Ok));
        drop(listener);
        std::fs::remove_file(endpoint).unwrap();
    }

    #[test]
    fn cancellation_wakes_partial_reads_and_is_idempotent() {
        let (reader, mut peer) = UnixStream::pair().unwrap();
        let mut connection = Connection(reader);
        let cancellation = connection.cancellation().unwrap();
        peer.write_all(&[0, 0]).unwrap();
        let (sender, receiver) = bounded(1);
        let reader = thread::spawn(move || {
            sender
                .send(read_frame::<Response>(&mut connection))
                .unwrap();
        });
        cancellation.cancel();
        cancellation.cancel();
        assert!(
            receiver
                .recv_timeout(Duration::from_secs(2))
                .unwrap()
                .is_err()
        );
        reader.join().unwrap();
    }

    #[test]
    fn subscription_completion_preserves_final_frame() {
        let (server, client) = UnixStream::pair().unwrap();
        let mut server = Connection(server);
        let mut client = Connection(client);
        client
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let monitor = server.monitor_disconnect().unwrap();
        let writer = thread::spawn(move || {
            write_frame(
                &mut server,
                &Response::Exited {
                    exit_code: Some(0),
                    final_offset: 123,
                },
            )
            .unwrap();
            monitor.finish();
        });
        assert!(matches!(
            read_frame(&mut client).unwrap(),
            Response::Exited {
                exit_code: Some(0),
                final_offset: 123,
            }
        ));
        assert_eq!(client.read(&mut [0]).unwrap(), 0);
        drop(client);
        writer.join().unwrap();
    }
}
