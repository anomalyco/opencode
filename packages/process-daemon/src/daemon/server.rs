use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, anyhow};
use base64::Engine;

use super::{Registration, platform};
use crate::ownership::Ownership;
use crate::protocol::{Envelope, Request, Response, read_frame, write_frame, write_output_frame};
use crate::service::{CreateTerminal, StreamEvent, TerminalService};
use crate::transport::{Cancellation, Connection};

pub fn run(directory: &Path) -> Result<()> {
    let (runtime, mut listener) = platform::Runtime::bind(directory)?;
    let registration = runtime.registration.clone();
    let registration = &registration;
    let ownership = Arc::new(Mutex::new(Ownership::new(Instant::now())));

    let service = Arc::new(TerminalService::default());
    let shutdown = Arc::new(AtomicBool::new(false));
    let mut handlers = Vec::<(Cancellation, thread::JoinHandle<()>)>::new();
    let result = (|| -> Result<()> {
        while !shutdown.load(Ordering::Acquire) {
            if ownership
                .lock()
                .map_err(|_| anyhow!("ownership lock poisoned"))?
                .tick(Instant::now())
            {
                shutdown.store(true, Ordering::Release);
                break;
            }
            for (_, handler) in handlers.extract_if(.., |(_, handler)| handler.is_finished()) {
                let _ = handler.join();
            }
            match listener.accept() {
                Ok(Some(stream)) => {
                    let control = stream.cancellation()?;
                    let service = Arc::clone(&service);
                    let shutdown = Arc::clone(&shutdown);
                    let ownership = Arc::clone(&ownership);
                    let registration = registration.clone();
                    let handle = thread::spawn(move || {
                        if let Err(error) = handle_connection(
                            stream,
                            &service,
                            &registration,
                            &shutdown,
                            &ownership,
                        ) {
                            eprintln!("opencode-pty request failed: {error:#}");
                        }
                    });
                    handlers.push((control, handle));
                }
                Ok(None) => {
                    thread::sleep(Duration::from_millis(10));
                }
                Err(error) => return Err(error.into()),
            }
        }
        Ok(())
    })();

    shutdown.store(true, Ordering::Release);
    listener.stop();
    // Unblock partial requests, owner reads, and backpressured subscriptions
    // before joining. PTY workers still use their existing termination path.
    for (cancellation, _) in &handlers {
        cancellation.cancel();
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
    for (_, handler) in handlers {
        let _ = handler.join();
    }
    drop(service);
    let cleanup = runtime.finish();
    drop(listener);
    let _ = cleanup_tx.send(());
    let _ = watchdog.join();
    result.and(cleanup)
}

fn handle_connection(
    mut stream: Connection,
    service: &TerminalService,
    registration: &Registration,
    shutdown: &AtomicBool,
    ownership: &Mutex<Ownership>,
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
        } else if shutdown.load(Ordering::Acquire) {
            Err(anyhow!("daemon is stopping"))
        } else {
            ownership
                .lock()
                .map_err(|_| anyhow!("ownership lock poisoned"))?
                .claim(ticket.as_deref(), Instant::now())
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
        let result = owner_connection(&mut stream, registration, shutdown, ownership, generation);
        ownership
            .lock()
            .map_err(|_| anyhow!("ownership lock poisoned"))?
            .disconnect(generation, Instant::now());
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
            shutdown,
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
        shutdown.store(true, Ordering::Release);
    }
    result
}

fn owner_connection(
    stream: &mut Connection,
    registration: &Registration,
    shutdown: &AtomicBool,
    ownership: &Mutex<Ownership>,
    generation: u64,
) -> Result<()> {
    write_frame(&mut *stream, &Response::Owned)?;
    while !shutdown.load(Ordering::Acquire) {
        let envelope: Envelope = read_frame(&mut *stream)?;
        if !ownership
            .lock()
            .map_err(|_| anyhow!("ownership lock poisoned"))?
            .is_owner(generation)
        {
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
                    let handoff = ownership
                        .lock()
                        .map_err(|_| anyhow!("ownership lock poisoned"))?
                        .prepare(
                            generation,
                            Instant::now(),
                            SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64,
                        )?;
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
            if ownership
                .lock()
                .map_err(|_| anyhow!("ownership lock poisoned"))?
                .is_owner(generation)
            {
                shutdown.store(true, Ordering::Release);
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
    shutdown: &AtomicBool,
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
        if shutdown.load(Ordering::Acquire) {
            break Ok(());
        }
        let event = crossbeam_channel::select! {
            recv(monitor.disconnected()) -> _ => break Ok(()),
            recv(attachment.events) -> event => match event {
                Ok(event) => event,
                Err(_) => break Ok(()),
            },
            default(Duration::from_millis(100)) => continue,
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
