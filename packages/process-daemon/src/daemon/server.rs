use std::io::{self, ErrorKind};
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, anyhow};
use base64::Engine;

use super::control::Control;
use super::{Registration, platform};
use crate::ownership::{Ownership, Snapshot};
use crate::protocol::{Request, Response, read_envelope, write_frame, write_output_frame};
use crate::service::{CreatePipe, CreatePty, StreamEvent, TerminalService};
use crate::transport::{Cancellation, Connection, Listener, Readiness, Wake};

const ACCEPT_BACKOFF: Duration = Duration::from_millis(100);
const MAX_ACCEPTS_PER_PASS: usize = 64;

pub fn run(directory: &Path) -> Result<()> {
    // First, before bind starts the sweeper thread: every thread created after
    // this inherits the mask, so only the signal thread ever receives them.
    #[cfg(unix)]
    let signals = signals::block()?;
    // Before bind, so a failure here leaves nothing to clean up.
    let wake = Wake::new()?;
    let (runtime, listener) = platform::Runtime::bind(directory)?;
    // Created after bind so bind I/O does not consume the acquire window.
    let control = Arc::new(Control::new(wake, Ownership::new(Instant::now())));
    #[cfg(unix)]
    if let Err(error) = signals::stop_on(signals, &control) {
        let _ = runtime.finish();
        return Err(error);
    }
    serve(runtime, listener, control, Settings::default())
}

/// Turns SIGTERM and SIGINT into an orderly stop, so children are killed and
/// the runtime directory is removed instead of the daemon dying with both left
/// behind.
///
/// Children inherit the signal mask across `exec`. portable-pty resets it for
/// PTY children; anything else the daemon spawns must reset it itself.
#[cfg(unix)]
mod signals {
    use std::io;
    use std::sync::Arc;
    use std::thread;
    use std::time::{Duration, Instant};

    use anyhow::{Context, Result};

    use super::Control;

    const STOP: [libc::c_int; 2] = [libc::SIGTERM, libc::SIGINT];
    /// A second signal this soon after the first is part of the same stop
    /// (Ctrl-C plus a wrapper's SIGTERM), not a sign that the stop is stuck.
    const REPEAT_GRACE: Duration = Duration::from_secs(1);

    pub(super) struct Blocked(libc::sigset_t);

    /// Blocks the stop signals on the calling thread, and restores their
    /// default action: macOS never delivers an ignored signal to `sigwait`,
    /// and a launcher may have left SIGINT ignored.
    pub(super) fn block() -> Result<Blocked> {
        // SAFETY: plain libc calls on a local, initialized signal set.
        unsafe {
            let mut set: libc::sigset_t = std::mem::zeroed();
            libc::sigemptyset(&mut set);
            for signal in STOP {
                libc::sigaddset(&mut set, signal);
            }
            let result = libc::pthread_sigmask(libc::SIG_BLOCK, &set, std::ptr::null_mut());
            if result != 0 {
                return Err(io::Error::from_raw_os_error(result))
                    .context("failed to block stop signals");
            }
            // Only after blocking, so there is no window where the default
            // action could kill the daemon.
            for signal in STOP {
                libc::signal(signal, libc::SIG_DFL);
            }
            Ok(Blocked(set))
        }
    }

    pub(super) fn stop_on(signals: Blocked, control: &Arc<Control>) -> Result<()> {
        let control = Arc::clone(control);
        thread::Builder::new()
            .name("opencode-pty-signals".into())
            .spawn(move || {
                wait(&signals);
                let stopped = Instant::now();
                control.request_stop();
                loop {
                    let signal = wait(&signals);
                    if stopped.elapsed() >= REPEAT_GRACE {
                        // The orderly stop is stuck. Exit without running exit
                        // handlers, which other threads may be blocking.
                        // SAFETY: `_exit` is always safe to call.
                        unsafe { libc::_exit(128 + signal) };
                    }
                }
            })
            .context("failed to start the signal thread")?;
        Ok(())
    }

    fn wait(signals: &Blocked) -> libc::c_int {
        loop {
            let mut signal = 0;
            // SAFETY: valid set and out pointer; `sigwait` returns an error
            // number instead of setting errno, and fills `signal` on success.
            let result = unsafe { libc::sigwait(&signals.0, &mut signal) };
            if result == 0 {
                return signal;
            }
            // EINTR (after SIGSTOP and SIGCONT) just retries. Nothing else is
            // expected for valid signals; pause so it can't spin.
            if result != libc::EINTR {
                thread::sleep(Duration::from_millis(100));
            }
        }
    }
}

struct Settings {
    /// Longest the loop sleeps without a wake or deadline.
    safety_net: Duration,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            safety_net: Duration::from_secs(2),
        }
    }
}

struct Handler {
    cancellation: Cancellation,
    done: Arc<AtomicBool>,
    thread: thread::JoinHandle<()>,
}

/// Marks a handler finished once its connection has been dropped, even on panic,
/// then wakes the loop so it releases the handler's `Cancellation` promptly.
struct Done {
    done: Arc<AtomicBool>,
    control: Arc<Control>,
}

impl Drop for Done {
    fn drop(&mut self) {
        self.done.store(true, Ordering::Release);
        self.control.notify();
    }
}

fn serve(
    runtime: platform::Runtime,
    mut listener: Listener,
    control: Arc<Control>,
    settings: Settings,
) -> Result<()> {
    let registration = runtime.registration.clone();
    let registration = &registration;

    let service = Arc::new(TerminalService::default());
    let mut handlers = Vec::<Handler>::new();
    let result = (|| -> Result<()> {
        let mut ready = Readiness::default();
        let mut last = Snapshot::default();
        let mut accept_paused_until: Option<Instant> = None;
        loop {
            let tick = control.tick(Instant::now(), &mut last, ready.timed_out)?;
            if tick.stopped {
                break;
            }
            // After the tick's drain: a `Done` sets its flag before notifying, so any
            // handler whose wake was just consumed is reaped here.
            for handler in handlers.extract_if(.., |handler| {
                handler.done.load(Ordering::Acquire) || handler.thread.is_finished()
            }) {
                drop(handler.cancellation);
                let _ = handler.thread.join();
            }
            if ready.connection {
                // Bounded so a connection flood cannot starve stop and deadlines.
                for _ in 0..MAX_ACCEPTS_PER_PASS {
                    let stream = match listener.accept() {
                        Ok(Some(stream)) => stream,
                        Ok(None) => break,
                        Err(error)
                            if matches!(
                                error.kind(),
                                ErrorKind::ConnectionAborted | ErrorKind::Interrupted
                            ) =>
                        {
                            continue;
                        }
                        // The listener stays readable, so retrying at once would spin.
                        Err(error) if is_resource_exhaustion(&error) => {
                            pause_accept(&mut accept_paused_until, &error);
                            break;
                        }
                        Err(error) => return Err(error.into()),
                    };
                    let cancellation = match stream.cancellation() {
                        Ok(cancellation) => cancellation,
                        Err(error) if is_resource_exhaustion(&error) => {
                            drop(stream);
                            pause_accept(&mut accept_paused_until, &error);
                            break;
                        }
                        Err(error) => return Err(error.into()),
                    };
                    let done = Arc::new(AtomicBool::new(false));
                    let thread = {
                        let done = Arc::clone(&done);
                        let service = Arc::clone(&service);
                        let control = Arc::clone(&control);
                        let registration = registration.clone();
                        thread::spawn(move || {
                            let _done = Done {
                                done,
                                control: Arc::clone(&control),
                            };
                            if let Err(error) =
                                handle_connection(stream, &service, &registration, &control)
                            {
                                eprintln!("opencode-pty request failed: {error:#}");
                            }
                        })
                    };
                    handlers.push(Handler {
                        cancellation,
                        done,
                        thread,
                    });
                }
            }

            // A fresh clock: the accept batch may have taken a while.
            let now = Instant::now();
            if accept_paused_until.is_some_and(|until| now >= until) {
                accept_paused_until = None;
            }
            let mut timeout = settings.safety_net;
            if let Some(deadline) = tick.deadline {
                timeout = timeout.min(deadline.saturating_duration_since(now));
            }
            if let Some(until) = accept_paused_until {
                timeout = timeout.min(until.saturating_duration_since(now));
            }
            ready = listener.wait(control.wake(), accept_paused_until.is_none(), timeout)?;
            #[cfg(all(test, unix))]
            control.stats.iterations.fetch_add(1, Ordering::Relaxed);
        }
        Ok(())
    })();

    control.request_stop();
    listener.stop();
    // Unblock partial requests, owner reads, and backpressured subscriptions
    // before joining. PTY workers still use their existing termination path.
    for handler in &handlers {
        handler.cancellation.cancel();
    }
    let (cleanup_tx, cleanup_rx) = crossbeam_channel::bounded::<()>(1);
    let cleanup = runtime.cleanup.clone();
    let watchdog = thread::spawn(move || {
        if cleanup_rx.recv_timeout(Duration::from_secs(5)).is_err() {
            eprintln!("opencode-pty cleanup timed out; forcing exit");
            let _ = cleanup.run();
            std::process::exit(1);
        }
    });
    service.shutdown();
    for handler in handlers {
        let _ = handler.thread.join();
    }
    drop(service);
    let cleanup = runtime.finish();
    drop(listener);
    let _ = cleanup_tx.send(());
    let _ = watchdog.join();
    result.and(cleanup)
}

fn pause_accept(until: &mut Option<Instant>, error: &io::Error) {
    eprintln!("opencode-pty accept paused: {error}");
    *until = Some(Instant::now() + ACCEPT_BACKOFF);
}

#[cfg(unix)]
fn is_resource_exhaustion(error: &io::Error) -> bool {
    matches!(
        error.raw_os_error(),
        Some(libc::EMFILE | libc::ENFILE | libc::ENOBUFS | libc::ENOMEM)
    )
}

#[cfg(windows)]
fn is_resource_exhaustion(_error: &io::Error) -> bool {
    false
}

fn handle_connection(
    mut stream: Connection,
    service: &TerminalService,
    registration: &Registration,
    control: &Control,
) -> Result<()> {
    let (token, request) = read_envelope(&mut stream)?;
    if token != registration.token {
        return send_response(
            &mut stream,
            &Response::Error {
                message: "authentication failed".to_string(),
            },
        );
    }
    let request = match request {
        Ok(request) => request,
        Err(message) => return send_response(&mut stream, &Response::Error { message }),
    };
    if let Request::Own {
        instance_id,
        ticket,
    } = request
    {
        let claim = if instance_id != registration.instance_id {
            Err(anyhow!("daemon instance_id mismatch"))
        } else if control.stopping() {
            Err(anyhow!("daemon is stopping"))
        } else {
            control
                .update_ownership(|ownership| ownership.claim(ticket.as_deref(), Instant::now()))?
        };
        let generation = match claim {
            Ok(generation) => generation,
            Err(error) => {
                return send_response(
                    &mut stream,
                    &Response::Error {
                        message: error.to_string(),
                    },
                );
            }
        };
        let result = owner_connection(&mut stream, registration, control, generation);
        control.update_ownership(|ownership| ownership.disconnect(generation, Instant::now()))?;
        return result;
    }
    if let Request::Wait { id } = request {
        return wait_for_exit(&mut stream, service, control, id);
    }
    if let Request::Subscribe {
        id,
        offset,
        attachment_id,
        role,
        takeover,
    } = request
    {
        return stream_subscription(
            &mut stream,
            service,
            control,
            SubscriptionRequest {
                id,
                offset,
                attachment_id,
                role,
                takeover,
            },
        );
    }
    let stopping = matches!(request, Request::Shutdown);
    let response =
        dispatch(request, service, registration).unwrap_or_else(|error| Response::Error {
            message: format!("{error:#}"),
        });
    let result = send_response(&mut stream, &response);
    if stopping {
        control.request_stop();
    }
    result
}

fn owner_connection(
    stream: &mut Connection,
    registration: &Registration,
    control: &Control,
    generation: u64,
) -> Result<()> {
    write_frame(&mut *stream, &Response::Owned)?;
    while !control.stopping() {
        let (token, request) = read_envelope(&mut *stream)?;
        if !control.is_owner(generation)? {
            return send_response(
                stream,
                &Response::Error {
                    message: "owner connection has been superseded".to_string(),
                },
            );
        }
        let stopping = token == registration.token && matches!(request, Ok(Request::Shutdown));
        let response = if token != registration.token {
            Response::Error {
                message: "authentication failed".to_string(),
            }
        } else {
            match request {
                Err(message) => Response::Error { message },
                Ok(Request::PrepareHandoff) => {
                    let unix_ms = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
                    let handoff = control.update_ownership(|ownership| {
                        ownership.prepare(generation, Instant::now(), unix_ms)
                    })??;
                    Response::Handoff {
                        ticket: handoff.ticket,
                        expires_at: handoff.expires_at,
                    }
                }
                Ok(Request::Shutdown) => Response::Ok,
                Ok(_) => Response::Error {
                    message: "owner connection only accepts prepare_handoff or shutdown"
                        .to_string(),
                },
            }
        };
        if stopping {
            let result = send_response(stream, &response);
            // A takeover may have occurred while writing the response.
            if control.is_owner(generation)? {
                control.request_stop();
            }
            return result;
        }
        write_frame(&mut *stream, &response)?;
    }
    Ok(())
}

struct SubscriptionRequest {
    id: crate::service::TerminalId,
    offset: u64,
    attachment_id: String,
    role: crate::protocol::AttachmentRole,
    takeover: bool,
}

fn stream_subscription(
    stream: &mut Connection,
    service: &TerminalService,
    control: &Control,
    request: SubscriptionRequest,
) -> Result<()> {
    let attachment = service.attach(
        request.id,
        request.offset,
        request.attachment_id,
        request.role,
        request.takeover,
    )?;
    write_frame(
        &mut *stream,
        &Response::Attached {
            process: attachment.process.clone(),
            role: attachment.role,
            generation: attachment.generation,
            requested_offset: attachment.replay.requested_offset,
            available_offset: attachment.replay.available_offset,
            end_offset: attachment.replay.end_offset,
            truncated: attachment.replay.truncated,
            replay_base64: base64::engine::general_purpose::STANDARD
                .encode(&attachment.replay.bytes),
        },
    )?;
    let monitor = stream.monitor_disconnect()?;
    let result = (|| loop {
        if control.stopping() {
            break Ok(());
        }
        let event = crossbeam_channel::select! {
            recv(monitor.disconnected()) -> _ => break Ok(()),
            recv(attachment.events) -> event => match event {
                Ok(event) => event,
                Err(_) => break Ok(()),
            },
        };
        let response = match event {
            StreamEvent::Output { start, end, bytes } => {
                write_output_frame(&mut *stream, start, end, &bytes)?;
                continue;
            }
            StreamEvent::Resized {
                cols,
                rows,
                generation,
                checkpoint,
            } => Response::Resized {
                cols,
                rows,
                generation,
                checkpoint_base64: base64::engine::general_purpose::STANDARD.encode(checkpoint),
            },
            StreamEvent::Exited(exit) => exit.into(),
            StreamEvent::ControllerChanged {
                attachment_id,
                generation,
            } => Response::ControllerChanged {
                attachment_id,
                generation,
            },
            StreamEvent::TitleChanged { title } => Response::TitleChanged { title },
            StreamEvent::ForegroundProcessChanged { process } => {
                Response::ForegroundProcessChanged { process }
            }
        };
        write_frame(&mut *stream, &response)?;
        if matches!(response, Response::Exited { .. }) {
            break Ok(());
        }
    })();
    monitor.finish();
    result
}

/// Answers a `wait` with one `Exited` once the pipe process exits. Errors
/// that need no waiting (unknown id, a PTY) are answered before monitoring.
fn wait_for_exit(
    stream: &mut Connection,
    service: &TerminalService,
    control: &Control,
    id: crate::service::TerminalId,
) -> Result<()> {
    let wait = match service.wait(id) {
        Ok(wait) => wait,
        Err(error) => {
            return send_response(
                stream,
                &Response::Error {
                    message: format!("{error:#}"),
                },
            );
        }
    };
    let monitor = stream.monitor_disconnect()?;
    // `Err` when the client is gone (or the daemon is stopping): nobody to tell.
    let exit = crossbeam_channel::select_biased! {
        recv(wait.exit) -> exit => Ok(exit.ok()),
        recv(monitor.disconnected()) -> _ => Err(()),
        recv(wait.actor_done) -> _ => Ok(wait.exit.try_recv().ok()),
    };
    let response = match exit {
        Err(()) => None,
        Ok(Some(exit)) => Some(Response::from(exit)),
        // Terminated before it exited; the daemon stopping is not news.
        Ok(None) if control.stopping() => None,
        Ok(None) => Some(Response::Error {
            message: "terminated".to_string(),
        }),
    };
    let result = response.map_or(Ok(()), |response| write_frame(&mut *stream, &response));
    monitor.finish();
    result
}

fn send_response(stream: &mut Connection, response: &Response) -> Result<()> {
    write_frame(&mut *stream, response)?;
    stream.finish_response()?;
    Ok(())
}

fn dispatch(
    request: Request,
    service: &TerminalService,
    registration: &Registration,
) -> Result<Response> {
    Ok(match request {
        Request::Ping => Response::Pong {
            instance_id: registration.instance_id.clone(),
            pid: registration.pid,
            protocol: registration.protocol,
            features: registration.features.clone(),
        },
        Request::CreatePty {
            program,
            args,
            cwd,
            env,
            group_id,
            title,
            cols,
            rows,
        } => Response::Created {
            process: service.create_pty(CreatePty {
                program,
                args,
                cwd,
                env,
                group_id,
                title,
                cols,
                rows,
            })?,
        },
        Request::CreatePipe {
            program,
            args,
            cwd,
            env,
            group_id,
            output_path,
            metadata,
        } => Response::Created {
            process: service.create_pipe(CreatePipe {
                program,
                args,
                cwd,
                env,
                group_id,
                output_path,
                metadata,
            })?,
        },
        Request::List { mode } => Response::Processes {
            processes: service.list(mode)?,
        },
        Request::Get { id } => Response::Process {
            process: service.get(id)?,
        },
        Request::Signal { id, signal } => {
            service.signal(id, signal)?;
            Response::Ok
        }
        Request::SetMetadata { id, metadata } => {
            service.set_metadata(id, metadata)?;
            Response::Ok
        }
        Request::Write {
            id,
            attachment_id,
            data_base64,
        } => {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(data_base64)
                .context("invalid input base64")?;
            service.write_for(id, attachment_id, bytes)?;
            Response::Ok
        }
        Request::Resize {
            id,
            attachment_id,
            cols,
            rows,
        } => {
            service.resize_for(id, attachment_id, cols, rows)?;
            Response::Ok
        }
        Request::Control {
            id,
            attachment_id,
            cols,
            rows,
        } => {
            service.control(id, attachment_id, cols, rows)?;
            Response::Ok
        }
        Request::Input {
            id,
            attachment_id,
            cols,
            rows,
            data_base64,
        } => {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(data_base64)
                .context("invalid input base64")?;
            service.input(id, attachment_id, cols, rows, bytes)?;
            Response::Ok
        }
        Request::Snapshot { id } => {
            let snapshot = service.snapshot(id)?;
            Response::Snapshot {
                process: snapshot.info,
                text: snapshot.text,
                checkpoint_base64: base64::engine::general_purpose::STANDARD
                    .encode(snapshot.checkpoint),
                cursor_x: snapshot.cursor_x,
                cursor_y: snapshot.cursor_y,
            }
        }
        Request::ReadRows { id, rows } => {
            let rows = service.read_rows(id, rows)?;
            Response::Rows {
                process: rows.process,
                lines: rows.lines,
                cursor_x: rows.cursor_x,
                cursor_y: rows.cursor_y,
            }
        }
        Request::Rename { id, title } => {
            service.rename(id, title)?;
            Response::Ok
        }
        Request::Replay { id, offset } => {
            let replay = service.replay(id, offset)?;
            Response::Replay {
                requested_offset: replay.requested_offset,
                available_offset: replay.available_offset,
                end_offset: replay.end_offset,
                truncated: replay.truncated,
                data_base64: base64::engine::general_purpose::STANDARD.encode(replay.bytes),
            }
        }
        Request::Subscribe { .. } | Request::Wait { .. } => {
            unreachable!("streaming requests are handled before dispatch")
        }
        Request::Terminate { id } => {
            service.terminate(id)?;
            Response::Ok
        }
        Request::Shutdown => Response::Ok,
        Request::Own { .. } => unreachable!("ownership is handled before dispatch"),
        Request::PrepareHandoff => Response::Error {
            message: "handoff requires the owner connection".to_string(),
        },
    })
}

#[cfg(all(test, unix))]
mod tests {
    use std::io::Read;
    use std::path::PathBuf;
    use std::sync::Barrier;
    use std::sync::atomic::AtomicUsize;

    use crossbeam_channel::Receiver;

    use super::*;
    use crate::protocol::{Envelope, read_frame};

    const TEST_HANDOFF: Duration = Duration::from_secs(60);
    /// Long enough that only a real wake can make a test pass in time.
    const NO_SAFETY_NET: Duration = Duration::from_secs(60);

    struct TestDaemon {
        root: PathBuf,
        registration: Registration,
        start: Instant,
        control: Arc<Control>,
        exited: Receiver<(Result<()>, Instant)>,
        thread: Option<thread::JoinHandle<()>>,
    }

    impl TestDaemon {
        fn start(acquire: Duration, handoff: Duration, safety_net: Duration) -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let root = std::env::temp_dir().join(format!(
                "opencode-pty-server-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            // The sweeper scans the runtime directory's siblings; keep it alone in `root`.
            let wake = Wake::new().unwrap();
            let (runtime, listener) = platform::Runtime::bind(&root.join("runtime")).unwrap();
            let registration = runtime.registration.clone();
            let start = Instant::now();
            let control = Arc::new(Control::new(
                wake,
                Ownership::with_timeouts(start, acquire, handoff),
            ));
            let (sender, exited) = crossbeam_channel::bounded(1);
            let thread = {
                let control = Arc::clone(&control);
                thread::spawn(move || {
                    let result = serve(runtime, listener, control, Settings { safety_net });
                    let _ = sender.send((result, Instant::now()));
                })
            };
            Self {
                root,
                registration,
                start,
                control,
                exited,
                thread: Some(thread),
            }
        }

        fn connect(&self) -> Connection {
            let stream = Connection::connect(&self.registration.socket).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            stream
                .set_write_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            stream
        }

        fn send(&self, stream: &mut Connection, request: Request) -> Response {
            write_frame(
                &mut *stream,
                &Envelope {
                    token: self.registration.token.clone(),
                    request,
                },
            )
            .unwrap();
            read_frame(stream).unwrap()
        }

        fn own(&self, ticket: Option<String>) -> Connection {
            let mut stream = self.connect();
            let request = Request::Own {
                instance_id: self.registration.instance_id.clone(),
                ticket,
            };
            match self.send(&mut stream, request) {
                Response::Owned => stream,
                response => panic!("own: {response:?}"),
            }
        }

        fn claim(&self) -> Connection {
            self.own(None)
        }

        fn prepare(&self, owner: &mut Connection) -> String {
            match self.send(owner, Request::PrepareHandoff) {
                Response::Handoff { ticket, .. } => ticket,
                response => panic!("prepare: {response:?}"),
            }
        }

        fn iterations(&self) -> u64 {
            self.control.stats.iterations.load(Ordering::Relaxed)
        }

        fn missed_wakes(&self) -> u64 {
            self.control.stats.missed_wakes.load(Ordering::Relaxed)
        }

        fn exit_within(&self, timeout: Duration) -> Option<(Result<()>, Instant)> {
            self.exited.recv_timeout(timeout).ok()
        }

        fn stopped_within(&self, timeout: Duration) -> Instant {
            let (result, returned_at) = self
                .exit_within(timeout)
                .expect("daemon did not stop in time");
            result.unwrap();
            returned_at
        }
    }

    impl Drop for TestDaemon {
        fn drop(&mut self) {
            self.control.request_stop();
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn shutdown_request_stops_immediately() {
        let daemon = TestDaemon::start(Duration::from_secs(60), TEST_HANDOFF, NO_SAFETY_NET);
        let _owner = daemon.claim();
        assert!(matches!(
            daemon.send(&mut daemon.connect(), Request::Shutdown),
            Response::Ok
        ));
        daemon.stopped_within(Duration::from_secs(1));
    }

    #[test]
    fn owner_shutdown_stops_immediately() {
        let daemon = TestDaemon::start(Duration::from_secs(60), TEST_HANDOFF, NO_SAFETY_NET);
        let mut owner = daemon.claim();
        assert!(matches!(
            daemon.send(&mut owner, Request::Shutdown),
            Response::Ok
        ));
        daemon.stopped_within(Duration::from_secs(1));
    }

    #[test]
    fn owner_disconnect_without_handoff_stops_immediately() {
        let daemon = TestDaemon::start(Duration::from_secs(60), TEST_HANDOFF, NO_SAFETY_NET);
        drop(daemon.claim());
        daemon.stopped_within(Duration::from_secs(1));
    }

    #[test]
    fn starting_deadline_fires_on_time() {
        let daemon = TestDaemon::start(Duration::from_millis(300), TEST_HANDOFF, NO_SAFETY_NET);
        let elapsed = daemon.stopped_within(Duration::from_secs(3)) - daemon.start;
        assert!(
            (Duration::from_millis(300)..=Duration::from_millis(1500)).contains(&elapsed),
            "{elapsed:?}"
        );
    }

    #[test]
    fn waiting_deadline_fires_on_time() {
        let daemon = TestDaemon::start(
            Duration::from_secs(60),
            Duration::from_millis(500),
            NO_SAFETY_NET,
        );
        let mut owner = daemon.claim();
        let before = Instant::now();
        daemon.prepare(&mut owner);
        let after = Instant::now();
        drop(owner);
        let returned_at = daemon.stopped_within(Duration::from_secs(3));
        assert!(returned_at >= before + Duration::from_millis(500));
        assert!(returned_at <= after + Duration::from_millis(1500));
    }

    #[test]
    fn handoff_claim_transfers_without_spurious_stop() {
        let daemon = TestDaemon::start(Duration::from_secs(60), TEST_HANDOFF, NO_SAFETY_NET);
        let mut owner = daemon.claim();
        let ticket = daemon.prepare(&mut owner);
        let successor = daemon.own(Some(ticket));
        drop(owner);
        assert!(daemon.exit_within(Duration::from_millis(300)).is_none());
        drop(successor);
        daemon.stopped_within(Duration::from_secs(1));
    }

    #[test]
    fn owned_handoff_expiry_keeps_daemon() {
        let daemon = TestDaemon::start(
            Duration::from_secs(60),
            Duration::from_millis(300),
            NO_SAFETY_NET,
        );
        let mut owner = daemon.claim();
        let ticket = daemon.prepare(&mut owner);
        thread::sleep(Duration::from_millis(600));
        // The owner connection stays open, so only the prepare wake told the loop about
        // this deadline; the loop's own expiry clears it.
        let deadline = daemon
            .control
            .update_ownership(|ownership| ownership.deadline());
        assert_eq!(deadline.unwrap(), None);
        let request = Request::Own {
            instance_id: daemon.registration.instance_id.clone(),
            ticket: Some(ticket),
        };
        assert!(matches!(
            daemon.send(&mut daemon.connect(), request),
            Response::Error { .. }
        ));
        assert!(daemon.exit_within(Duration::ZERO).is_none());
        assert_eq!(daemon.missed_wakes(), 0);
    }

    #[test]
    fn idle_loop_does_not_spin() {
        let safety_net = Duration::from_secs(2);
        let owned = TestDaemon::start(Duration::from_secs(10), TEST_HANDOFF, safety_net);
        let _owner = owned.claim();
        let starting = TestDaemon::start(Duration::from_secs(10), TEST_HANDOFF, safety_net);
        thread::sleep(Duration::from_millis(200));
        let before = [owned.iterations(), starting.iterations()];
        thread::sleep(Duration::from_millis(1500));
        let after = [owned.iterations(), starting.iterations()];
        assert!(after[0] - before[0] <= 1, "owned: {before:?} -> {after:?}");
        assert!(
            after[1] - before[1] <= 1,
            "starting: {before:?} -> {after:?}"
        );
    }

    #[test]
    fn connect_does_not_wait_for_timeout() {
        let daemon = TestDaemon::start(Duration::from_secs(60), TEST_HANDOFF, NO_SAFETY_NET);
        let _owner = daemon.claim();
        thread::sleep(Duration::from_millis(100));
        let started = Instant::now();
        assert!(matches!(
            daemon.send(&mut daemon.connect(), Request::Ping),
            Response::Pong { .. }
        ));
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn handler_completion_closes_socket_promptly() {
        let daemon = TestDaemon::start(Duration::from_secs(60), TEST_HANDOFF, NO_SAFETY_NET);
        let _owner = daemon.claim();
        let mut stream = daemon.connect();
        // Set before the request: macOS rejects socket options once the peer has closed.
        stream
            .set_read_timeout(Some(Duration::from_secs(1)))
            .unwrap();
        assert!(matches!(
            daemon.send(&mut stream, Request::Ping),
            Response::Pong { .. }
        ));
        // The peer sees EOF only once the loop drops the handler's `Cancellation`.
        assert_eq!(stream.read(&mut [0_u8; 1]).unwrap(), 0);
    }

    #[test]
    fn unknown_requests_get_an_error_reply() {
        let daemon = TestDaemon::start(Duration::from_secs(60), TEST_HANDOFF, NO_SAFETY_NET);
        let mut owner = daemon.claim();
        let mut stream = daemon.connect();
        write_frame(
            &mut stream,
            &serde_json::json!({
                "token": daemon.registration.token,
                "request": {"op": "teleport"},
            }),
        )
        .unwrap();
        assert!(matches!(
            read_frame(&mut stream).unwrap(),
            Response::Error { message } if message == "unsupported request: teleport"
        ));
        // A bad token is reported before the request is looked at.
        let mut stream = daemon.connect();
        write_frame(
            &mut stream,
            &serde_json::json!({"token": "wrong", "request": {"op": "teleport"}}),
        )
        .unwrap();
        assert!(matches!(
            read_frame(&mut stream).unwrap(),
            Response::Error { message } if message == "authentication failed"
        ));
        // The owner connection survives an unknown request too.
        write_frame(
            &mut owner,
            &serde_json::json!({
                "token": daemon.registration.token,
                "request": {"op": "teleport"},
            }),
        )
        .unwrap();
        assert!(matches!(
            read_frame(&mut owner).unwrap(),
            Response::Error { message } if message == "unsupported request: teleport"
        ));
        assert!(matches!(
            daemon.send(&mut owner, Request::PrepareHandoff),
            Response::Handoff { .. }
        ));
    }

    fn create_pipe(daemon: &TestDaemon, script: &str) -> crate::service::ProcessInfo {
        std::fs::create_dir_all(&daemon.root).unwrap();
        let output_path = daemon
            .root
            .join(format!("{:016x}.out", rand::random::<u64>()));
        match daemon.send(
            &mut daemon.connect(),
            Request::CreatePipe {
                program: "/bin/sh".into(),
                args: vec!["-c".into(), script.into()],
                cwd: "/".into(),
                env: Default::default(),
                group_id: "test".into(),
                output_path,
                metadata: Default::default(),
            },
        ) {
            Response::Created { process } => process,
            response => panic!("create_pipe: {response:?}"),
        }
    }

    fn start_wait(daemon: &TestDaemon, id: u64) -> Connection {
        let mut stream = daemon.connect();
        write_frame(
            &mut stream,
            &Envelope {
                token: daemon.registration.token.clone(),
                request: Request::Wait { id },
            },
        )
        .unwrap();
        stream
    }

    #[test]
    fn wait_replies_once_with_the_exit() {
        let daemon = TestDaemon::start(Duration::from_secs(60), TEST_HANDOFF, NO_SAFETY_NET);
        let _owner = daemon.claim();
        let process = create_pipe(&daemon, "sleep 0.2; echo one; exit 3");
        let mut waits = [
            start_wait(&daemon, process.id),
            start_wait(&daemon, process.id),
        ];
        for stream in &mut waits {
            assert!(matches!(
                read_frame(&mut *stream).unwrap(),
                Response::Exited {
                    exit_code: Some(3),
                    output_lines: Some(1),
                    final_offset: 4,
                    ..
                }
            ));
            // Then the connection closes.
            assert_eq!(stream.read(&mut [0_u8; 1]).unwrap(), 0);
        }
        // Already exited: answered at once.
        assert!(matches!(
            read_frame(start_wait(&daemon, process.id)).unwrap(),
            Response::Exited {
                exit_code: Some(3),
                ..
            }
        ));
    }

    #[test]
    fn wait_errors_for_unknown_ids_and_terminals() {
        let daemon = TestDaemon::start(Duration::from_secs(60), TEST_HANDOFF, NO_SAFETY_NET);
        let _owner = daemon.claim();
        assert!(matches!(
            read_frame(start_wait(&daemon, 42)).unwrap(),
            Response::Error { message } if message.contains("not found")
        ));
        let Response::Created { process } = daemon.send(
            &mut daemon.connect(),
            Request::CreatePty {
                program: "/bin/sh".into(),
                args: vec!["-c".into(), "exec cat".into()],
                cwd: "/".into(),
                env: Default::default(),
                group_id: "test".into(),
                title: "t".into(),
                cols: 80,
                rows: 24,
            },
        ) else {
            panic!("create_pty");
        };
        assert!(matches!(
            read_frame(start_wait(&daemon, process.id)).unwrap(),
            Response::Error { message } if message.contains("not a pipe process")
        ));
    }

    #[test]
    fn terminate_ends_a_wait_with_an_error() {
        let daemon = TestDaemon::start(Duration::from_secs(60), TEST_HANDOFF, NO_SAFETY_NET);
        let _owner = daemon.claim();
        let process = create_pipe(&daemon, "exec sleep 30");
        let mut wait = start_wait(&daemon, process.id);
        // Let the wait register before terminating.
        thread::sleep(Duration::from_millis(100));
        assert!(matches!(
            daemon.send(&mut daemon.connect(), Request::Terminate { id: process.id }),
            Response::Ok
        ));
        assert!(matches!(
            read_frame(&mut wait).unwrap(),
            Response::Error { message } if message == "terminated"
        ));
    }

    #[test]
    fn a_client_leaving_a_wait_ends_its_handler() {
        let daemon = TestDaemon::start(Duration::from_secs(60), TEST_HANDOFF, NO_SAFETY_NET);
        let _owner = daemon.claim();
        let process = create_pipe(&daemon, "exec sleep 30");
        thread::sleep(Duration::from_millis(100));
        let before = daemon.iterations();
        drop(start_wait(&daemon, process.id));
        // The handler's `Done` wakes the loop once it returns.
        let deadline = Instant::now() + Duration::from_secs(3);
        while daemon.iterations() < before + 2 {
            assert!(Instant::now() < deadline, "wait handler did not return");
            thread::sleep(Duration::from_millis(10));
        }
        // The process is untouched.
        assert!(matches!(
            daemon.send(&mut daemon.connect(), Request::Get { id: process.id }),
            Response::Process { process: info }
                if info.lifecycle == crate::service::TerminalLifecycle::Running
        ));
    }

    #[test]
    fn daemon_shutdown_closes_a_wait_without_a_reply() {
        let daemon = TestDaemon::start(Duration::from_secs(60), TEST_HANDOFF, NO_SAFETY_NET);
        let _owner = daemon.claim();
        let process = create_pipe(&daemon, "exec sleep 30");
        let mut wait = start_wait(&daemon, process.id);
        thread::sleep(Duration::from_millis(100));
        daemon.control.request_stop();
        daemon.stopped_within(Duration::from_secs(3));
        assert!(read_frame::<Response>(&mut wait).is_err());
    }

    /// Breaks the wake invariant on purpose and expects the detector to catch it.
    fn expect_missed_wake(break_invariant: impl Fn(&Control, u64) -> bool) {
        let daemon = TestDaemon::start(
            Duration::from_secs(60),
            TEST_HANDOFF,
            Duration::from_millis(300),
        );
        // Kept open until `serve` returns so the real disconnect path cannot run first.
        let owner = daemon.claim();
        let generation = 1;
        assert!(daemon.control.is_owner(generation).unwrap());
        // Each helper acts only when no wake is pending, which proves the loop has
        // already ticked past the claim.
        let guard = Instant::now() + Duration::from_secs(5);
        while !break_invariant(&daemon.control, generation) {
            assert!(Instant::now() < guard, "loop never went idle");
            thread::sleep(Duration::from_millis(10));
        }
        let (result, _) = daemon
            .exit_within(Duration::from_secs(2))
            .expect("daemon did not stop in time");
        if cfg!(debug_assertions) {
            assert!(format!("{:#}", result.unwrap_err()).contains("missed wake"));
        } else {
            result.unwrap();
        }
        assert_eq!(daemon.missed_wakes(), 1);
        drop(owner);
    }

    #[test]
    fn missed_wake_is_detected() {
        expect_missed_wake(|control, _| control.set_stop_without_wake());
    }

    #[test]
    fn missed_disconnect_is_detected() {
        expect_missed_wake(|control, generation| {
            control.update_ownership_without_wake(|ownership| {
                ownership.disconnect(generation, Instant::now())
            })
        });
    }

    #[test]
    fn notify_storm_is_not_missed() {
        let daemon = TestDaemon::start(
            Duration::from_secs(60),
            TEST_HANDOFF,
            Duration::from_millis(20),
        );
        let _owner = daemon.claim();
        let barrier = Arc::new(Barrier::new(5));
        let workers = (0..4)
            .map(|_| {
                let control = Arc::clone(&daemon.control);
                let barrier = Arc::clone(&barrier);
                thread::spawn(move || {
                    barrier.wait();
                    for _ in 0..10_000 {
                        control
                            .update_ownership(|ownership| ownership.deadline())
                            .unwrap();
                    }
                })
            })
            .collect::<Vec<_>>();
        barrier.wait();
        daemon.control.request_stop();
        daemon.stopped_within(Duration::from_secs(1));
        assert_eq!(daemon.missed_wakes(), 0);
        for worker in workers {
            worker.join().unwrap();
        }
    }
}
