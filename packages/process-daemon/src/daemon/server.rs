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
use crate::protocol::{Envelope, Request, Response, read_frame, write_frame, write_output_frame};
use crate::service::{CreateTerminal, StreamEvent, TerminalService};
use crate::transport::{Cancellation, Connection, Listener, Readiness, Wake};

const ACCEPT_BACKOFF: Duration = Duration::from_millis(100);
const MAX_ACCEPTS_PER_PASS: usize = 64;

pub fn run(directory: &Path) -> Result<()> {
    // Before bind, so a failure here leaves nothing to clean up.
    let wake = Wake::new()?;
    let (runtime, listener) = platform::Runtime::bind(directory)?;
    // Created after bind so bind I/O does not consume the acquire window.
    let control = Arc::new(Control::new(wake, Ownership::new(Instant::now())));
    serve(runtime, listener, control, Settings::default())
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
    let envelope: Envelope = read_frame(&mut stream)?;
    if envelope.token != registration.token {
        return send_response(
            &mut stream,
            &Response::Error {
                message: "authentication failed".to_string(),
            },
        );
    }
    if let Request::Own {
        instance_id,
        ticket,
    } = envelope.request
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
    if let Request::Subscribe {
        id,
        offset,
        attachment_id,
        role,
        takeover,
    } = envelope.request
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
    let stopping = matches!(envelope.request, Request::Shutdown);
    let response =
        dispatch(envelope.request, service, registration).unwrap_or_else(|error| Response::Error {
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
        let envelope: Envelope = read_frame(&mut *stream)?;
        if !control.is_owner(generation)? {
            return send_response(
                stream,
                &Response::Error {
                    message: "owner connection has been superseded".to_string(),
                },
            );
        }
        let stopping =
            envelope.token == registration.token && matches!(envelope.request, Request::Shutdown);
        let response = if envelope.token != registration.token {
            Response::Error {
                message: "authentication failed".to_string(),
            }
        } else {
            match envelope.request {
                Request::PrepareHandoff => {
                    let unix_ms = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
                    let handoff = control.update_ownership(|ownership| {
                        ownership.prepare(generation, Instant::now(), unix_ms)
                    })??;
                    Response::Handoff {
                        ticket: handoff.ticket,
                        expires_at: handoff.expires_at,
                    }
                }
                Request::Shutdown => Response::Ok,
                _ => Response::Error {
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
            terminal: attachment.terminal.clone(),
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
            StreamEvent::Exited {
                exit_code,
                final_offset,
            } => Response::Exited {
                exit_code,
                final_offset,
            },
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
        },
        Request::Create {
            program,
            args,
            cwd,
            title,
            group_id,
            env,
            cols,
            rows,
        } => Response::Created {
            terminal: service.create(CreateTerminal {
                program,
                args,
                cwd,
                title,
                group_id,
                env,
                cols,
                rows,
            })?,
        },
        Request::List => Response::Terminals {
            terminals: service.list()?,
        },
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
                terminal: snapshot.info,
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
                terminal: rows.terminal,
                lines: rows.lines,
                cursor_x: rows.cursor_x,
                cursor_y: rows.cursor_y,
            }
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
        Request::Subscribe { .. } => unreachable!("subscriptions are handled before dispatch"),
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
