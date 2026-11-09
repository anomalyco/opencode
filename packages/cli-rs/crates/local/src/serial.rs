//! One worker thread that runs blocking file jobs in the order they were sent, so writes that wait
//! on a file lock stay off the UI thread and land in order.

use std::sync::mpsc;

type Job = Box<dyn FnOnce() + Send>;

#[derive(Clone, Debug)]
pub struct Serial(mpsc::Sender<Job>);

impl Serial {
    /// Starts the worker; it stops once every clone is dropped and the queued jobs ran.
    pub fn new(name: &str) -> Self {
        let (send, receive) = mpsc::channel::<Job>();
        let spawned = std::thread::Builder::new().name(name.to_owned()).spawn(move || {
            for job in receive {
                job();
            }
        });
        if let Err(error) = spawned {
            log::warn!("{name}: {error}");
        }
        Self(send)
    }

    /// Queues `job` after every job sent before it.
    pub fn run(&self, job: impl FnOnce() + Send + 'static) {
        let _ = self.0.send(Box::new(job));
    }

    /// Waits until every job sent before it ran.
    pub fn flush(&self) {
        let (done, wait) = mpsc::channel();
        self.run(move || {
            let _ = done.send(());
        });
        let _ = wait.recv();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[test]
    fn flush_waits_for_the_jobs_sent_before_it() {
        let serial = Serial::new("test");
        let ran = Arc::new(Mutex::new(Vec::new()));
        for at in 0..3 {
            let ran = ran.clone();
            serial.run(move || {
                std::thread::sleep(std::time::Duration::from_millis(20));
                ran.lock().unwrap().push(at);
            });
        }
        serial.flush();
        assert_eq!(*ran.lock().unwrap(), [0, 1, 2]);
    }
}
