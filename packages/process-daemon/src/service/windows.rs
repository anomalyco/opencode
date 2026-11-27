use std::io;
use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle, RawHandle};
use std::ptr::null;
use std::time::Duration;

use crossbeam_channel::{Receiver, RecvTimeoutError, Sender};
use portable_pty::{Child, MasterPty};
use windows_sys::Win32::{
    Foundation::{WAIT_OBJECT_0, WAIT_TIMEOUT},
    System::JobObjects::{AssignProcessToJobObject, CreateJobObjectW, TerminateJobObject},
    System::Threading::{INFINITE, WaitForSingleObject},
};

use super::{ActorMessage, TerminalId};

const EXIT_POLL_INTERVAL: Duration = Duration::from_millis(25);

/// Keep blocking ClosePseudoConsole off the actor/reader without introducing
/// another worker. The actor hands its unique master here on root exit or on
/// teardown; closing it then produces the real output-pipe EOF.
/// Root-exit detection uses a 25 ms poll interval. After reaping, the
/// worker blocks on the close channel rather than continuing to poll.
pub(super) fn wait_and_close(
    mut child: Box<dyn Child + Send + Sync>,
    events: Sender<ActorMessage>,
    close: Receiver<Box<dyn MasterPty + Send>>,
) {
    let mut reported = false;
    loop {
        if !reported {
            // SAFETY: the child owns this process handle throughout this call;
            // cloned killer handles do not close or replace it. Poll the wait
            // handle rather than GetExitCodeProcess so exit code 259 is not
            // confused with STILL_ACTIVE by portable-pty's try_wait.
            let ready = child
                .as_raw_handle()
                .is_none_or(|handle| unsafe { WaitForSingleObject(handle, 0) != WAIT_TIMEOUT });
            if ready {
                report_exit(&mut *child, &events);
                reported = true;
            }
        }
        let request = if reported {
            close.recv().map_err(|_| RecvTimeoutError::Disconnected)
        } else {
            close.recv_timeout(EXIT_POLL_INTERVAL)
        };
        match request {
            Ok(master) => {
                if !reported {
                    // Also cover actor failure/early teardown, not just normal
                    // exit or the service's already-issued termination request.
                    let _ = child.kill();
                }
                drop(master);
                break;
            }
            Err(RecvTimeoutError::Disconnected) => break,
            Err(RecvTimeoutError::Timeout) => {}
        }
    }
    if !reported {
        report_exit(&mut *child, &events);
    }
}

fn report_exit(child: &mut dyn Child, events: &Sender<ActorMessage>) {
    let result = (|| {
        if let Some(handle) = child.as_raw_handle() {
            // SAFETY: this worker owns the child and therefore its wait handle.
            // GetExitCodeProcess can expose the termination status before the
            // process object is signaled; portable-pty's wait fast path is not
            // sufficient to prove that TerminateProcess teardown has finished.
            if unsafe { WaitForSingleObject(handle, INFINITE) } != WAIT_OBJECT_0 {
                return Err(std::io::Error::last_os_error());
            }
        }
        child.wait().map(|status| Some(status.exit_code()))
    })();
    let _ = events.send(ActorMessage::ChildExited(
        result.map_err(|error| error.to_string()),
    ));
}

/// The job a terminal's root shell runs in, and with it everything the shell
/// starts. It is not kill-on-close: programs started from a terminal outlive it
/// as before. Terminate ends the job only when closing the pseudo console left
/// a program attached to it (see `TerminalHandle::release_stuck_console`).
/// The root joins once it is running, so a descendant it starts before that
/// stays outside the job.
pub(super) struct TerminalJob(OwnedHandle);

impl TerminalJob {
    pub(super) fn assign(id: TerminalId, process: Option<RawHandle>) -> Option<Self> {
        let process = process?;
        // SAFETY: an unnamed job with default attributes, adopted on success.
        let job = unsafe { CreateJobObjectW(null(), null()) };
        if job.is_null() {
            warn_no_job(id, &io::Error::last_os_error());
            return None;
        }
        // SAFETY: CreateJobObjectW returned a new handle that nothing else owns.
        let job = Self(unsafe { OwnedHandle::from_raw_handle(job) });
        // SAFETY: the job and the child's process handle are live through the call.
        if unsafe { AssignProcessToJobObject(job.0.as_raw_handle(), process) } == 0 {
            warn_no_job(id, &io::Error::last_os_error());
            return None;
        }
        Some(job)
    }

    pub(super) fn terminate(&self) {
        // SAFETY: the job handle is owned and live. Failure leaves the old
        // behavior: terminate stops waiting after its grace period.
        unsafe { TerminateJobObject(self.0.as_raw_handle(), 1) };
    }
}

fn warn_no_job(id: TerminalId, error: &io::Error) {
    eprintln!("terminal {id}: running without a job object: {error}");
}
