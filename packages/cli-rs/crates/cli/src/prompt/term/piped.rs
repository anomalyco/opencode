//! Stdin that cannot be waited on with a timeout, such as a pipe on Windows, read on a thread of its own.

use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::Duration;

use super::Read;

/// Chunks of `source` from a thread that reads one each time a prompt asks for one, so stdin is not consumed for a
/// prompt that stopped reading, and the rest of a chunk that did not fit the last read.
pub(super) struct Piped {
    requests: mpsc::SyncSender<()>,
    chunks: mpsc::Receiver<Vec<u8>>,
    /// A chunk was asked for and has not arrived; a wait that timed out leaves it pending for the next.
    requested: bool,
    rest: Vec<u8>,
}

impl Piped {
    pub(super) fn spawn(mut source: impl std::io::Read + Send + 'static) -> Piped {
        let (requests, asked) = mpsc::sync_channel(1);
        let (send, chunks) = mpsc::sync_channel(1);
        std::thread::spawn(move || {
            for () in asked {
                let mut chunk = vec![0; 1024];
                let count = loop {
                    match source.read(&mut chunk) {
                        Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                        Ok(count) if count > 0 => break count,
                        Ok(_) | Err(_) => return,
                    }
                };
                chunk.truncate(count);
                if send.send(chunk).is_err() {
                    return;
                }
            }
        });
        Piped { requests, chunks, requested: false, rest: Vec::new() }
    }

    /// Waits up to `wait` (forever with `None`) for a chunk, then copies what fits into `buffer`.
    pub(super) fn read(&mut self, wait: Option<Duration>, buffer: &mut [u8]) -> Read {
        if self.rest.is_empty() {
            // A reader that ended drops its receiver; the wait below then reports the end.
            if !self.requested {
                self.requested = self.requests.send(()).is_ok();
            }
            let chunk = match wait {
                None => self.chunks.recv().map_err(|_| RecvTimeoutError::Disconnected),
                Some(wait) => self.chunks.recv_timeout(wait),
            };
            self.rest = match chunk {
                Ok(chunk) => chunk,
                Err(RecvTimeoutError::Timeout) => return Read::Again,
                Err(RecvTimeoutError::Disconnected) => return Read::End,
            };
            self.requested = false;
        }
        let count = self.rest.len().min(buffer.len());
        buffer[..count].copy_from_slice(&self.rest[..count]);
        self.rest.drain(..count);
        Read::Data(count)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use super::*;

    /// Endless input that counts its reads.
    struct Counting(Arc<AtomicUsize>);

    impl std::io::Read for Counting {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            self.0.fetch_add(1, Ordering::SeqCst);
            buffer.fill(b'x');
            Ok(buffer.len())
        }
    }

    #[test]
    fn stdin_is_read_only_as_the_prompt_asks() {
        let reads = Arc::new(AtomicUsize::new(0));
        let mut piped = Piped::spawn(Counting(reads.clone()));
        let mut buffer = [0; 1024];
        assert!(matches!(piped.read(None, &mut buffer), Read::Data(1024)));
        // An idle prompt leaves stdin alone: only the chunk it asked for is read.
        std::thread::sleep(Duration::from_millis(50));
        assert_eq!(reads.load(Ordering::SeqCst), 1);
        assert!(matches!(piped.read(Some(Duration::from_secs(5)), &mut buffer[..10]), Read::Data(10)));
        assert!(matches!(piped.read(Some(Duration::from_secs(5)), &mut buffer), Read::Data(1014)));
    }

    #[test]
    fn the_end_of_stdin_ends_the_prompt_input() {
        let mut piped = Piped::spawn(std::io::Cursor::new(b"ab".to_vec()));
        let mut buffer = [0; 8];
        assert!(matches!(piped.read(None, &mut buffer), Read::Data(2)));
        assert_eq!(&buffer[..2], b"ab");
        assert!(matches!(piped.read(Some(Duration::from_secs(5)), &mut buffer), Read::End));
    }
}
