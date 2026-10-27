use std::io::{self, Read, Write};
use std::net::Shutdown;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::Path;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use crossbeam_channel::{Receiver, bounded};

pub(crate) struct Listener(Option<UnixListener>);

impl Listener {
    pub fn bind(endpoint: &Path) -> io::Result<Self> {
        let listener = UnixListener::bind(endpoint)?;
        listener.set_nonblocking(true)?;
        Ok(Self(Some(listener)))
    }

    /// Poll for a connection without blocking the daemon control path.
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
    use super::*;
    use crate::protocol::{Response, read_frame, write_frame};

    #[test]
    fn listener_polls_and_connections_roundtrip() {
        let endpoint =
            std::env::temp_dir().join(format!("pty-{:032x}.sock", rand::random::<u128>()));
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
