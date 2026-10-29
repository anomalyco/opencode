#[cfg(target_os = "linux")]
use std::collections::HashSet;
use std::collections::{HashMap, VecDeque};
use std::env;
use std::io::{self, Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock, mpsc as std_mpsc};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, anyhow, bail};
use crossbeam_channel::{Receiver, Sender, bounded};
use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde::{Deserialize, Serialize};

use crate::ghostty::{Format, Terminal, TerminalOptions};
use crate::protocol::AttachmentRole;

#[cfg(windows)]
mod windows;

const DEFAULT_COLS: u16 = 100;
const DEFAULT_ROWS: u16 = 30;
const REPLAY_CAPACITY: usize = 2 * 1024 * 1024;
const ACTOR_QUEUE_CAPACITY: usize = 128;
const WRITER_QUEUE_CAPACITY: usize = 128;
const SUBSCRIBER_QUEUE_CAPACITY: usize = 1024;
const OUTPUT_BATCH_BYTES: usize = 8 * 1024;
const OUTPUT_BATCH_DELAY: Duration = Duration::from_millis(1);
const MAX_INPUT_BYTES: usize = 1024 * 1024;
const MAX_ROWS_BYTES: usize = 1024 * 1024;

pub type TerminalId = u64;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "status")]
pub enum TerminalLifecycle {
    Running,
    Exited { exit_code: Option<u32> },
    Failed { message: String },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TerminalInfo {
    pub id: TerminalId,
    pub pid: Option<u32>,
    pub title: String,
    pub foreground_process: Option<String>,
    pub group_id: String,
    pub command: Vec<String>,
    pub cwd: PathBuf,
    pub cols: u16,
    pub rows: u16,
    pub lifecycle: TerminalLifecycle,
    pub output_head: u64,
    pub output_tail: u64,
}

#[derive(Clone, Debug)]
pub struct TerminalSnapshot {
    pub info: TerminalInfo,
    pub text: String,
    pub checkpoint: Vec<u8>,
    pub cursor_x: u16,
    pub cursor_y: u16,
}

#[derive(Clone, Debug)]
pub struct TerminalRows {
    pub terminal: TerminalInfo,
    pub lines: Vec<String>,
    pub cursor_x: u16,
    pub cursor_y: u16,
}

#[derive(Clone, Debug)]
pub struct RawReplay {
    pub requested_offset: u64,
    pub available_offset: u64,
    pub end_offset: u64,
    pub truncated: bool,
    pub bytes: Vec<u8>,
}

#[derive(Clone, Debug)]
pub enum StreamEvent {
    Output {
        start: u64,
        end: u64,
        bytes: Vec<u8>,
    },
    Resized {
        cols: u16,
        rows: u16,
        generation: u64,
        checkpoint: Vec<u8>,
    },
    Exited {
        exit_code: Option<u32>,
        final_offset: u64,
    },
    ControllerChanged {
        attachment_id: Option<String>,
        generation: u64,
    },
    TitleChanged {
        title: String,
    },
    ForegroundProcessChanged {
        process: Option<String>,
    },
}

pub struct TerminalAttachment {
    pub terminal: TerminalInfo,
    pub role: AttachmentRole,
    pub generation: u64,
    pub replay: RawReplay,
    pub events: Receiver<StreamEvent>,
    actor_tx: Sender<ActorMessage>,
    attachment_id: String,
    disconnect_tx: Option<Sender<()>>,
}

impl Drop for TerminalAttachment {
    fn drop(&mut self) {
        // Guard lifetime, not the lifetime of public event-receiver clones,
        // controls subscription cancellation. Wake a blocked controller send
        // before reliably queuing Detach on the possibly full actor channel.
        drop(self.disconnect_tx.take());
        let _ = self.actor_tx.send(ActorMessage::Detach {
            attachment_id: self.attachment_id.clone(),
        });
    }
}

#[derive(Clone, Debug)]
pub struct CreateTerminal {
    pub program: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub title: String,
    pub group_id: String,
    pub env: HashMap<String, String>,
    pub cols: u16,
    pub rows: u16,
}

impl CreateTerminal {
    pub fn shell() -> Result<Self> {
        let program = default_shell();
        let title = PathBuf::from(&program)
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or("shell")
            .to_string();
        Ok(Self {
            program,
            args: Vec::new(),
            cwd: env::current_dir()?,
            title,
            group_id: format!("local:{}", env::current_dir()?.display()),
            env: HashMap::new(),
            cols: DEFAULT_COLS,
            rows: DEFAULT_ROWS,
        })
    }
}

pub struct TerminalService {
    terminals: Mutex<HashMap<TerminalId, Arc<TerminalHandle>>>,
    replay_capacity: usize,
}

impl Default for TerminalService {
    fn default() -> Self {
        Self::new(REPLAY_CAPACITY)
    }
}

impl TerminalService {
    pub fn new(replay_capacity: usize) -> Self {
        Self {
            terminals: Mutex::new(HashMap::new()),
            replay_capacity,
        }
    }

    pub fn create(&self, request: CreateTerminal) -> Result<TerminalInfo> {
        validate_size(request.cols, request.rows)?;
        if request.program.trim().is_empty() {
            bail!("terminal program cannot be empty");
        }

        let id = loop {
            // JSON clients can represent integers exactly only through 53 bits.
            let id = rand::random::<u64>() & ((1_u64 << 53) - 1);
            if id != 0
                && !self
                    .terminals
                    .lock()
                    .map_err(|_| anyhow!("terminal registry lock poisoned"))?
                    .contains_key(&id)
            {
                break id;
            }
        };
        let handle = TerminalHandle::spawn(id, request, self.replay_capacity)?;
        let info = handle.info();
        self.terminals
            .lock()
            .map_err(|_| anyhow!("terminal registry lock poisoned"))?
            .insert(id, Arc::new(handle));
        Ok(info)
    }

    pub fn list(&self) -> Result<Vec<TerminalInfo>> {
        let handles = self
            .terminals
            .lock()
            .map_err(|_| anyhow!("terminal registry lock poisoned"))?
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let mut terminals = Vec::with_capacity(handles.len());
        for terminal in handles {
            // Windows has no foreground query; do not wait behind actor
            // backpressure just to read its already-cached metadata.
            #[cfg(not(windows))]
            terminal.request(|reply| ActorMessage::RefreshForegroundProcess { reply })?;
            terminals.push(terminal.info());
        }
        terminals.sort_by_key(|terminal| terminal.id);
        Ok(terminals)
    }

    pub fn write(&self, id: TerminalId, bytes: Vec<u8>) -> Result<()> {
        self.write_for(id, None, bytes)
    }

    pub fn write_for(
        &self,
        id: TerminalId,
        attachment_id: Option<String>,
        bytes: Vec<u8>,
    ) -> Result<()> {
        if bytes.len() > MAX_INPUT_BYTES {
            bail!("input exceeds {MAX_INPUT_BYTES} byte limit");
        }
        self.get(id)?.request(|reply| ActorMessage::Write {
            attachment_id,
            bytes,
            reply,
        })
    }

    pub fn resize(&self, id: TerminalId, cols: u16, rows: u16) -> Result<()> {
        self.resize_for(id, None, cols, rows)
    }

    pub fn resize_for(
        &self,
        id: TerminalId,
        attachment_id: Option<String>,
        cols: u16,
        rows: u16,
    ) -> Result<()> {
        validate_size(cols, rows)?;
        self.get(id)?.request(|reply| ActorMessage::Resize {
            attachment_id,
            cols,
            rows,
            reply,
        })
    }

    pub fn control(
        &self,
        id: TerminalId,
        attachment_id: String,
        cols: u16,
        rows: u16,
    ) -> Result<()> {
        validate_size(cols, rows)?;
        self.get(id)?.request(|reply| ActorMessage::Control {
            attachment_id,
            cols,
            rows,
            bytes: None,
            reply,
        })
    }

    pub fn input(
        &self,
        id: TerminalId,
        attachment_id: String,
        cols: u16,
        rows: u16,
        bytes: Vec<u8>,
    ) -> Result<()> {
        validate_size(cols, rows)?;
        if bytes.len() > MAX_INPUT_BYTES {
            bail!("input exceeds {MAX_INPUT_BYTES} byte limit");
        }
        self.get(id)?.request(|reply| ActorMessage::Control {
            attachment_id,
            cols,
            rows,
            bytes: Some(bytes),
            reply,
        })
    }

    pub fn snapshot(&self, id: TerminalId) -> Result<TerminalSnapshot> {
        self.get(id)?
            .request(|reply| ActorMessage::Snapshot { reply })
    }

    pub fn read_rows(&self, id: TerminalId, rows: Option<u16>) -> Result<TerminalRows> {
        self.get(id)?
            .request(|reply| ActorMessage::ReadRows { rows, reply })
    }

    pub fn replay(&self, id: TerminalId, offset: u64) -> Result<RawReplay> {
        self.get(id)?
            .request(|reply| ActorMessage::Replay { offset, reply })
    }

    pub fn attach(
        &self,
        id: TerminalId,
        offset: u64,
        attachment_id: String,
        role: AttachmentRole,
        takeover: bool,
    ) -> Result<TerminalAttachment> {
        let terminal = self.get(id)?;
        let (reply_tx, reply_rx) = bounded(1);
        terminal
            .actor_tx
            .send(ActorMessage::Attach {
                offset,
                attachment_id: attachment_id.clone(),
                role,
                takeover,
                reply: reply_tx,
            })
            .map_err(|_| anyhow!("terminal actor stopped"))?;
        let attached = await_reply(&reply_rx, &terminal.actor_done)?;
        Ok(TerminalAttachment {
            terminal: terminal.info(),
            role,
            generation: attached.generation,
            replay: attached.replay,
            events: attached.events,
            actor_tx: terminal.actor_tx.clone(),
            attachment_id,
            disconnect_tx: Some(attached.disconnect_tx),
        })
    }

    pub fn terminate(&self, id: TerminalId) -> Result<()> {
        let terminal = self
            .terminals
            .lock()
            .map_err(|_| anyhow!("terminal registry lock poisoned"))?
            .remove(&id)
            .ok_or_else(|| anyhow!("terminal {id} not found"))?;
        terminal.shutdown()
    }

    fn get(&self, id: TerminalId) -> Result<Arc<TerminalHandle>> {
        self.terminals
            .lock()
            .map_err(|_| anyhow!("terminal registry lock poisoned"))?
            .get(&id)
            .cloned()
            .ok_or_else(|| anyhow!("terminal {id} not found"))
    }

    pub(crate) fn shutdown(&self) {
        let terminals = self
            .terminals
            .lock()
            .map(|mut terminals| {
                terminals
                    .drain()
                    .map(|(_, terminal)| terminal)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        // Start every terminal's existing kill/join path before waiting for any
        // one terminal's potentially blocked PTY workers.
        thread::scope(|scope| {
            for terminal in terminals {
                scope.spawn(move || {
                    let _ = terminal.shutdown();
                });
            }
        });
    }
}

impl Drop for TerminalService {
    fn drop(&mut self) {
        self.shutdown();
    }
}

struct TerminalHandle {
    actor_tx: Sender<ActorMessage>,
    /// Disconnects when the actor thread exits; never carries a message.
    actor_done: Receiver<()>,
    shutdown_tx: Mutex<Option<Sender<()>>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    info: Arc<RwLock<TerminalInfo>>,
    joins: Mutex<Option<Vec<JoinHandle<()>>>>,
}

impl TerminalHandle {
    fn spawn(id: TerminalId, request: CreateTerminal, replay_capacity: usize) -> Result<Self> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: request.rows,
                cols: request.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("failed to open PTY")?;

        let mut command = CommandBuilder::new(&request.program);
        command.args(request.args.iter());
        command.cwd(&request.cwd);
        for (key, value) in &request.env {
            command.env(key, value);
        }
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");

        let child = pair
            .slave
            .spawn_command(command)
            .with_context(|| format!("failed to spawn {}", request.program))?;
        let pid = child.process_id();
        let killer = child.clone_killer();
        let mut reader = pair
            .master
            .try_clone_reader()
            .context("failed to clone PTY reader")?;
        let writer = pair
            .master
            .take_writer()
            .context("failed to take PTY writer")?;
        drop(pair.slave);

        let info = Arc::new(RwLock::new(TerminalInfo {
            id,
            pid,
            title: request.title,
            foreground_process: None,
            group_id: request.group_id,
            command: std::iter::once(request.program)
                .chain(request.args)
                .collect(),
            cwd: request.cwd,
            cols: request.cols,
            rows: request.rows,
            lifecycle: TerminalLifecycle::Running,
            output_head: 0,
            output_tail: 0,
        }));

        let (actor_tx, actor_rx) = bounded(ACTOR_QUEUE_CAPACITY);
        let (writer_tx, writer_rx) = bounded(WRITER_QUEUE_CAPACITY);
        // Disconnecting this channel wakes every cancellable queue operation,
        // even when the actor cannot consume an ordinary shutdown message.
        let (shutdown_tx, shutdown) = bounded(0);
        #[cfg(windows)]
        let (close_tx, close_rx) = bounded(1);
        let (init_tx, init_rx) = std_mpsc::sync_channel(1);

        let actor_info = Arc::clone(&info);
        let actor_writer_tx = writer_tx.clone();
        let actor_shutdown = shutdown.clone();
        let (actor_done_tx, actor_done) = bounded::<()>(0);
        let actor_thread = thread::Builder::new()
            .name(format!("opencode-pty-actor-{id}"))
            .spawn(move || {
                let _actor_done = actor_done_tx;
                let result = run_actor(ActorConfig {
                    master: ActorMaster {
                        pty: Some(pair.master),
                        #[cfg(windows)]
                        close_tx,
                    },
                    messages: actor_rx,
                    writes: actor_writer_tx,
                    shutdown: actor_shutdown,
                    info: actor_info,
                    replay_capacity,
                    cols: request.cols,
                    rows: request.rows,
                    init_tx,
                });
                if let Err(error) = result {
                    eprintln!("terminal {id} actor failed: {error:#}");
                }
            })
            .context("failed to spawn terminal actor")?;

        match init_rx
            .recv()
            .context("terminal actor stopped during initialization")?
        {
            Ok(()) => {}
            Err(error) => {
                let mut killer = killer;
                let _ = killer.kill();
                let _ = actor_thread.join();
                bail!(error);
            }
        }

        let writer_actor_tx = actor_tx.clone();
        let writer_thread = thread::Builder::new()
            .name(format!("opencode-pty-writer-{id}"))
            .spawn(move || run_writer(writer, writer_rx, writer_actor_tx, shutdown))
            .context("failed to spawn terminal writer")?;

        let reader_actor_tx = actor_tx.clone();
        let reader_thread = thread::Builder::new()
            .name(format!("opencode-pty-reader-{id}"))
            .spawn(move || {
                let mut buffer = [0_u8; 8192];
                let mut forwarding = true;
                loop {
                    match reader.read(&mut buffer) {
                        Ok(0) => {
                            let _ = reader_actor_tx.send(ActorMessage::ReaderEof);
                            break;
                        }
                        Ok(length) => {
                            if forwarding {
                                forwarding = reader_actor_tx
                                    .send(ActorMessage::Output(buffer[..length].to_vec()))
                                    .is_ok();
                                #[cfg(unix)]
                                if !forwarding {
                                    break;
                                }
                            }
                            // On Windows, ClosePseudoConsole can wait for its
                            // output pipe to drain. Once the actor stops, keep
                            // this sole reader draining without forwarding.
                        }
                        Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                        #[cfg(unix)]
                        Err(error) if error.raw_os_error() == Some(libc::EIO) => {
                            let _ = reader_actor_tx.send(ActorMessage::ReaderEof);
                            break;
                        }
                        Err(error) => {
                            let _ =
                                reader_actor_tx.send(ActorMessage::ReaderFailed(error.to_string()));
                            break;
                        }
                    }
                }
            })
            .context("failed to spawn terminal reader")?;

        let wait_actor_tx = actor_tx.clone();
        let wait_thread = thread::Builder::new()
            .name(format!("opencode-pty-wait-{id}"))
            .spawn(move || {
                #[cfg(windows)]
                windows::wait_and_close(child, wait_actor_tx, close_rx);
                #[cfg(unix)]
                {
                    let mut child = child;
                    let result = child.wait().map(|status| Some(status.exit_code()));
                    let _ = wait_actor_tx.send(ActorMessage::ChildExited(
                        result.map_err(|error| error.to_string()),
                    ));
                }
            })
            .context("failed to spawn terminal child waiter")?;

        Ok(Self {
            actor_tx,
            actor_done,
            shutdown_tx: Mutex::new(Some(shutdown_tx)),
            killer: Mutex::new(killer),
            info,
            joins: Mutex::new(Some(vec![
                actor_thread,
                writer_thread,
                reader_thread,
                wait_thread,
            ])),
        })
    }

    fn info(&self) -> TerminalInfo {
        self.info
            .read()
            .map(|info| info.clone())
            .unwrap_or_else(|poisoned| poisoned.into_inner().clone())
    }

    fn request<T>(&self, make: impl FnOnce(Reply<Result<T>>) -> ActorMessage) -> Result<T> {
        let (reply_tx, reply_rx) = bounded(1);
        self.actor_tx
            .send(make(reply_tx))
            .map_err(|_| anyhow!("terminal actor stopped"))?;
        await_reply(&reply_rx, &self.actor_done)
    }

    fn shutdown(&self) -> Result<()> {
        // Keep this guard through the joins: concurrent shutdown callers must
        // not return early or signal the child again after it has been reaped.
        let mut joins = self
            .joins
            .lock()
            .map_err(|_| anyhow!("terminal join lock poisoned"))?;
        let Some(handles) = joins.take() else {
            return Ok(());
        };
        self.shutdown_tx
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take();
        if let Ok(mut killer) = self.killer.lock() {
            let _ = killer.kill();
        }
        for join in handles {
            let _ = join.join();
        }
        Ok(())
    }
}

type Reply<T> = Sender<T>;

/// A request accepted into the actor queue may never be handled: shutdown
/// overtakes queued work, and a stopped actor's buffered messages (with their
/// reply senders) stay alive while other handles hold queue senders. Waiting on
/// the actor's lifetime as well as the reply keeps callers from blocking forever.
fn await_reply<T>(reply: &Receiver<Result<T>>, actor_done: &Receiver<()>) -> Result<T> {
    crossbeam_channel::select_biased! {
        recv(reply) -> result => result.map_err(|_| anyhow!("terminal actor dropped response"))?,
        recv(actor_done) -> _ => reply
            .try_recv()
            .map_err(|_| anyhow!("terminal actor stopped"))?,
    }
}

enum ActorMessage {
    Output(Vec<u8>),
    ReaderEof,
    ReaderFailed(String),
    WriterFailed(String),
    ChildExited(Result<Option<u32>, String>),
    #[cfg(not(windows))]
    RefreshForegroundProcess {
        reply: Reply<Result<()>>,
    },
    Write {
        attachment_id: Option<String>,
        bytes: Vec<u8>,
        reply: Reply<Result<()>>,
    },
    Resize {
        attachment_id: Option<String>,
        cols: u16,
        rows: u16,
        reply: Reply<Result<()>>,
    },
    Control {
        attachment_id: String,
        cols: u16,
        rows: u16,
        bytes: Option<Vec<u8>>,
        reply: Reply<Result<()>>,
    },
    Snapshot {
        reply: Reply<Result<TerminalSnapshot>>,
    },
    ReadRows {
        rows: Option<u16>,
        reply: Reply<Result<TerminalRows>>,
    },
    Replay {
        offset: u64,
        reply: Reply<Result<RawReplay>>,
    },
    Attach {
        offset: u64,
        attachment_id: String,
        role: AttachmentRole,
        takeover: bool,
        reply: Reply<Result<Attached>>,
    },
    Detach {
        attachment_id: String,
    },
}

struct Attached {
    generation: u64,
    replay: RawReplay,
    events: Receiver<StreamEvent>,
    disconnect_tx: Sender<()>,
}

struct Subscriber {
    events: Sender<StreamEvent>,
    disconnected: Receiver<()>,
    role: AttachmentRole,
    last_control: u64,
}

impl Subscriber {
    fn is_disconnected(&self) -> bool {
        matches!(
            self.disconnected.try_recv(),
            Err(crossbeam_channel::TryRecvError::Disconnected)
        )
    }
}

enum WriterMessage {
    Bytes(Vec<u8>),
}

struct ActorMaster {
    pty: Option<Box<dyn MasterPty + Send>>,
    #[cfg(windows)]
    close_tx: Sender<Box<dyn MasterPty + Send>>,
}

impl ActorMaster {
    fn get(&self) -> Result<&(dyn MasterPty + Send)> {
        self.pty
            .as_deref()
            .ok_or_else(|| anyhow!("terminal child has exited"))
    }

    #[cfg(windows)]
    fn close(&mut self) -> Result<()> {
        if let Some(master) = self.pty.take() {
            // A capacity-one channel receives this unique master exactly once;
            // handoff cannot wait on ClosePseudoConsole or PTY output drainage.
            if let Err(error) = self.close_tx.send(master) {
                // Keep ownership on failure. The actor stops receiving before
                // dropping this fallback master, so its reader can still drain.
                self.pty = Some(error.0);
                bail!("terminal close worker stopped");
            }
        }
        Ok(())
    }
}

impl Drop for ActorMaster {
    fn drop(&mut self) {
        #[cfg(windows)]
        let _ = self.close();
    }
}

struct ActorConfig {
    master: ActorMaster,
    messages: Receiver<ActorMessage>,
    writes: Sender<WriterMessage>,
    shutdown: Receiver<()>,
    info: Arc<RwLock<TerminalInfo>>,
    replay_capacity: usize,
    cols: u16,
    rows: u16,
    init_tx: std_mpsc::SyncSender<std::result::Result<(), String>>,
}

fn run_actor(config: ActorConfig) -> Result<()> {
    let ActorConfig {
        master,
        messages,
        writes,
        shutdown,
        info,
        replay_capacity,
        cols,
        rows,
        init_tx,
    } = config;
    #[cfg(windows)]
    let mut master = master;
    let mut terminal = Terminal::new(TerminalOptions {
        cols,
        rows,
        max_scrollback: replay_capacity,
    })?;

    let mut replay = ReplayBuffer::new(replay_capacity);
    let mut subscribers = HashMap::<String, Subscriber>::new();
    let mut controller = None::<String>;
    let mut controller_generation = 0_u64;
    let mut child_exit = None::<std::result::Result<Option<u32>, String>>;
    let mut reader_eof = false;
    let mut final_exit = None::<StreamEvent>;
    let mut pending_message = None;
    let _ = init_tx.send(Ok(()));

    let result = loop {
        match receive_actor_message(&messages, &mut pending_message, &shutdown) {
            #[cfg(not(windows))]
            Ok(ActorMessage::RefreshForegroundProcess { reply }) => {
                if let Ok(master) = master.get() {
                    publish_foreground_process(
                        &shutdown,
                        master,
                        &info,
                        &mut subscribers,
                        &mut controller,
                        &mut controller_generation,
                    );
                }
                let _ = reply.send(Ok(()));
            }
            Ok(ActorMessage::Output(bytes)) => {
                let (start, end) = replay.append(&bytes);
                terminal.vt_write(&bytes);
                // Once the Windows master is handed off for closing, the writer
                // may already have stopped; replies to the closing console are
                // discarded so final output still reaches the real EOF.
                #[cfg(windows)]
                let closing = master.get().is_err();
                #[cfg(not(windows))]
                let closing = false;
                if closing {
                    terminal.take_writes();
                } else if let Err(error) = forward_replies(&mut terminal, &writes, &shutdown) {
                    break Err(error);
                }
                update_offsets(&info, &replay);
                broadcast(
                    &shutdown,
                    &mut subscribers,
                    &mut controller,
                    &mut controller_generation,
                    StreamEvent::Output { start, end, bytes },
                );
                if let Some(title) = terminal.take_title() {
                    let changed = if let Ok(mut value) = info.write() {
                        if value.title == title {
                            false
                        } else {
                            value.title = title.clone();
                            true
                        }
                    } else {
                        false
                    };
                    if changed {
                        broadcast(
                            &shutdown,
                            &mut subscribers,
                            &mut controller,
                            &mut controller_generation,
                            StreamEvent::TitleChanged { title },
                        );
                    }
                }
            }
            Ok(ActorMessage::Write {
                attachment_id,
                bytes,
                reply,
            }) => {
                let result =
                    authorize_controller(&controller, attachment_id.as_deref()).and_then(|_| {
                        #[cfg(windows)]
                        master.get()?;
                        queue_write(&writes, &shutdown, bytes)
                    });
                let _ = reply.send(result);
            }
            Ok(ActorMessage::Resize {
                attachment_id,
                cols,
                rows,
                reply,
            }) => {
                let result = (|| {
                    authorize_controller(&controller, attachment_id.as_deref())?;
                    master.get()?.resize(PtySize {
                        rows,
                        cols,
                        pixel_width: 0,
                        pixel_height: 0,
                    })?;
                    let resized = terminal.resize(cols, rows);
                    forward_replies(&mut terminal, &writes, &shutdown)?;
                    resized?;
                    if let Ok(mut value) = info.write() {
                        value.cols = cols;
                        value.rows = rows;
                    }
                    let generation = controller_generation;
                    let checkpoint = format_terminal(&terminal, Format::Vt)?.into_bytes();
                    broadcast(
                        &shutdown,
                        &mut subscribers,
                        &mut controller,
                        &mut controller_generation,
                        StreamEvent::Resized {
                            cols,
                            rows,
                            generation,
                            checkpoint,
                        },
                    );
                    Ok(())
                })();
                let _ = reply.send(result);
            }
            Ok(ActorMessage::Control {
                attachment_id,
                cols,
                rows,
                bytes,
                reply,
            }) => {
                let result = (|| {
                    if !subscribers.contains_key(&attachment_id) {
                        bail!("attachment {attachment_id} is not subscribed");
                    }
                    if controller.as_ref() != Some(&attachment_id) {
                        if let Some(current) = controller.as_ref()
                            && let Some(subscriber) = subscribers.get_mut(current)
                        {
                            subscriber.role = AttachmentRole::Observer;
                        }
                        controller_generation = controller_generation.saturating_add(1);
                        controller = Some(attachment_id.clone());
                        if let Some(subscriber) = subscribers.get_mut(&attachment_id) {
                            subscriber.role = AttachmentRole::Controller;
                            subscriber.last_control = controller_generation;
                        }
                        let generation = controller_generation;
                        broadcast(
                            &shutdown,
                            &mut subscribers,
                            &mut controller,
                            &mut controller_generation,
                            StreamEvent::ControllerChanged {
                                attachment_id: Some(attachment_id.clone()),
                                generation,
                            },
                        );
                    }
                    let changed = info
                        .read()
                        .map(|value| value.cols != cols || value.rows != rows)
                        .unwrap_or(true);
                    if changed {
                        master.get()?.resize(PtySize {
                            rows,
                            cols,
                            pixel_width: 0,
                            pixel_height: 0,
                        })?;
                        let resized = terminal.resize(cols, rows);
                        forward_replies(&mut terminal, &writes, &shutdown)?;
                        resized?;
                        if let Ok(mut value) = info.write() {
                            value.cols = cols;
                            value.rows = rows;
                        }
                        let generation = controller_generation;
                        let checkpoint = format_terminal(&terminal, Format::Vt)?.into_bytes();
                        broadcast(
                            &shutdown,
                            &mut subscribers,
                            &mut controller,
                            &mut controller_generation,
                            StreamEvent::Resized {
                                cols,
                                rows,
                                generation,
                                checkpoint,
                            },
                        );
                    }
                    if let Some(bytes) = bytes {
                        #[cfg(windows)]
                        master.get()?;
                        queue_write(&writes, &shutdown, bytes)?;
                    }
                    Ok(())
                })();
                let _ = reply.send(result);
            }
            Ok(ActorMessage::Snapshot { reply }) => {
                let _ = reply.send(make_snapshot(&terminal, &info));
            }
            Ok(ActorMessage::ReadRows { rows, reply }) => {
                let result = (|| {
                    Ok(TerminalRows {
                        lines: format_rows(&terminal, rows)?,
                        terminal: info
                            .read()
                            .map_err(|_| anyhow!("terminal info lock poisoned"))?
                            .clone(),
                        cursor_x: terminal.cursor_x()?,
                        cursor_y: terminal.cursor_y()?,
                    })
                })();
                let _ = reply.send(result);
            }
            Ok(ActorMessage::Replay { offset, reply }) => {
                let _ = reply.send(replay.read_from(offset));
            }
            Ok(ActorMessage::Attach {
                offset,
                attachment_id,
                role,
                takeover,
                reply,
            }) => {
                let result = (|| {
                    if role == AttachmentRole::Controller {
                        if let Some(current) = controller.as_ref() {
                            if current != &attachment_id && !takeover {
                                bail!("terminal already has controller {current}");
                            }
                            if current != &attachment_id
                                && let Some(subscriber) = subscribers.get_mut(current)
                            {
                                subscriber.role = AttachmentRole::Observer;
                            }
                        }
                        if controller.as_ref() != Some(&attachment_id) {
                            controller_generation = controller_generation.saturating_add(1);
                            controller = Some(attachment_id.clone());
                        }
                    }
                    let replay = replay.read_from(offset)?;
                    let (events_tx, events) = bounded(SUBSCRIBER_QUEUE_CAPACITY);
                    let (disconnect_tx, disconnected) = bounded(0);
                    subscribers.insert(
                        attachment_id.clone(),
                        Subscriber {
                            events: events_tx.clone(),
                            disconnected,
                            role,
                            last_control: if role == AttachmentRole::Controller {
                                controller_generation
                            } else {
                                0
                            },
                        },
                    );
                    if role == AttachmentRole::Controller {
                        let controller_id = controller.clone();
                        let generation = controller_generation;
                        broadcast(
                            &shutdown,
                            &mut subscribers,
                            &mut controller,
                            &mut controller_generation,
                            StreamEvent::ControllerChanged {
                                attachment_id: controller_id,
                                generation,
                            },
                        );
                    }
                    if let Some(event) = &final_exit {
                        // This fresh receiver is still actor-owned and has at
                        // most its initial ControllerChanged event queued.
                        let _ = events_tx.send(event.clone());
                    }
                    Ok(Attached {
                        generation: controller_generation,
                        replay,
                        events,
                        disconnect_tx,
                    })
                })();
                let _ = reply.send(result);
            }
            Ok(ActorMessage::Detach { attachment_id }) => {
                // A stale guard may share a string ID with a newer attachment.
                // Its queued message must not remove the newer, still-live guard.
                let removed = if subscribers
                    .get(&attachment_id)
                    .is_some_and(Subscriber::is_disconnected)
                {
                    subscribers.remove(&attachment_id)
                } else {
                    None
                };
                if removed.is_some() && controller.as_ref() == Some(&attachment_id) {
                    controller_generation = controller_generation.saturating_add(1);
                    controller = promote_latest(&mut subscribers, controller_generation);
                    let generation = controller_generation;
                    let attachment_id = controller.clone();
                    broadcast(
                        &shutdown,
                        &mut subscribers,
                        &mut controller,
                        &mut controller_generation,
                        StreamEvent::ControllerChanged {
                            attachment_id,
                            generation,
                        },
                    );
                }
            }
            Ok(ActorMessage::ChildExited(result)) => {
                child_exit = Some(result);
                // ConPTY keeps its output pipe open until HPCON is closed.
                // The wait worker closes it while this actor and the reader
                // keep processing output, including the real final EOF.
                #[cfg(windows)]
                if let Err(error) = master.close() {
                    break Err(error);
                }
            }
            Ok(ActorMessage::ReaderFailed(message)) | Ok(ActorMessage::WriterFailed(message)) => {
                // Closing ConPTY can finish a pending write with BrokenPipe
                // after the final exit event. Never overwrite a published exit.
                if final_exit.is_none()
                    && let Ok(mut value) = info.write()
                {
                    value.lifecycle = TerminalLifecycle::Failed { message };
                }
            }
            Ok(ActorMessage::ReaderEof) => reader_eof = true,
            Err(crossbeam_channel::RecvTimeoutError::Disconnected) => {
                break Ok(());
            }
            Err(crossbeam_channel::RecvTimeoutError::Timeout) => continue,
        }
        if reader_eof
            && final_exit.is_none()
            && let Some(result) = child_exit.take()
        {
            let exit_code = result.as_ref().ok().copied().flatten();
            if let Ok(mut value) = info.write() {
                value.lifecycle = match result {
                    Ok(exit_code) => TerminalLifecycle::Exited { exit_code },
                    Err(message) => TerminalLifecycle::Failed { message },
                };
            }
            let event = StreamEvent::Exited {
                exit_code,
                final_offset: replay.tail,
            };
            broadcast(
                &shutdown,
                &mut subscribers,
                &mut controller,
                &mut controller_generation,
                event.clone(),
            );
            final_exit = Some(event);
        }
    };
    // Release senders blocked on the actor queue before closing ConPTY. Its
    // synchronous close may need the reader to continue draining final output.
    drop(messages);
    drop(terminal);
    drop(master);
    drop(writes);
    if matches!(
        shutdown.try_recv(),
        Err(crossbeam_channel::TryRecvError::Disconnected)
    ) {
        // Interrupted terminal-generated replies are expected during shutdown.
        Ok(())
    } else {
        result
    }
}

fn receive_actor_message(
    messages: &Receiver<ActorMessage>,
    pending: &mut Option<ActorMessage>,
    shutdown: &Receiver<()>,
) -> std::result::Result<ActorMessage, crossbeam_channel::RecvTimeoutError> {
    if matches!(
        shutdown.try_recv(),
        Err(crossbeam_channel::TryRecvError::Disconnected)
    ) {
        return Err(crossbeam_channel::RecvTimeoutError::Disconnected);
    }
    let message = match pending.take() {
        Some(message) => message,
        None => crossbeam_channel::select_biased! {
            recv(shutdown) -> _ => return Err(crossbeam_channel::RecvTimeoutError::Disconnected),
            recv(messages) -> message => message.map_err(|_| crossbeam_channel::RecvTimeoutError::Disconnected)?,
        },
    };
    let ActorMessage::Output(mut bytes) = message else {
        return Ok(message);
    };
    let deadline = Instant::now() + OUTPUT_BATCH_DELAY;
    while bytes.len() < OUTPUT_BATCH_BYTES {
        match messages.recv_deadline(deadline) {
            Ok(ActorMessage::Output(next)) => bytes.extend(next),
            Ok(message) => {
                *pending = Some(message);
                break;
            }
            Err(crossbeam_channel::RecvTimeoutError::Timeout)
            | Err(crossbeam_channel::RecvTimeoutError::Disconnected) => break,
        }
    }
    Ok(ActorMessage::Output(bytes))
}

#[cfg(not(windows))]
fn publish_foreground_process(
    shutdown: &Receiver<()>,
    master: &dyn MasterPty,
    info: &Arc<RwLock<TerminalInfo>>,
    subscribers: &mut HashMap<String, Subscriber>,
    controller: &mut Option<String>,
    controller_generation: &mut u64,
) {
    let process = foreground_process(master);
    let changed = if let Ok(mut value) = info.write() {
        if value.foreground_process == process {
            false
        } else {
            value.foreground_process = process.clone();
            true
        }
    } else {
        false
    };
    if changed {
        broadcast(
            shutdown,
            subscribers,
            controller,
            controller_generation,
            StreamEvent::ForegroundProcessChanged { process },
        );
    }
}

#[cfg(target_os = "linux")]
fn foreground_process(master: &dyn MasterPty) -> Option<String> {
    let foreground_group = master.process_group_leader()?;
    let tty = master.tty_name();
    let processes = std::fs::read_dir("/proc")
        .ok()?
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| entry.file_name().to_str()?.parse::<i32>().ok())
        .filter_map(read_process)
        .collect::<Vec<_>>();
    let parents = processes
        .iter()
        .map(|process| (process.pid, process.ppid))
        .collect::<HashMap<_, _>>();
    let mut group = processes
        .iter()
        .filter(|process| process.pgrp == foreground_group)
        .collect::<Vec<_>>();
    if let Some(tty) = tty {
        let attached = group
            .iter()
            .copied()
            .filter(|process| process_attached_to_tty(process.pid, &tty))
            .collect::<Vec<_>>();
        if !attached.is_empty() {
            group = attached;
        }
    }
    group
        .into_iter()
        .max_by_key(|process| (process_depth(process.pid, &parents), process.pid))
        .map(|process| process.name.clone())
}

#[cfg(not(any(windows, target_os = "linux")))]
fn foreground_process(_master: &dyn MasterPty) -> Option<String> {
    None
}

#[cfg(target_os = "linux")]
struct ProcessInfo {
    pid: i32,
    ppid: i32,
    pgrp: i32,
    name: String,
}

#[cfg(target_os = "linux")]
fn read_process(pid: i32) -> Option<ProcessInfo> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    let fields = stat
        .get(stat.rfind(") ")? + 2..)?
        .split_whitespace()
        .collect::<Vec<_>>();
    Some(ProcessInfo {
        pid,
        ppid: fields.get(1)?.parse().ok()?,
        pgrp: fields.get(2)?.parse().ok()?,
        name: std::fs::read_to_string(format!("/proc/{pid}/comm"))
            .ok()?
            .trim()
            .to_string(),
    })
}

#[cfg(target_os = "linux")]
fn process_attached_to_tty(pid: i32, tty: &std::path::Path) -> bool {
    [0, 1, 2]
        .into_iter()
        .any(|fd| std::fs::read_link(format!("/proc/{pid}/fd/{fd}")).is_ok_and(|path| path == tty))
}

#[cfg(target_os = "linux")]
fn process_depth(pid: i32, parents: &HashMap<i32, i32>) -> usize {
    let mut current = pid;
    let mut seen = HashSet::new();
    while current > 0 && seen.insert(current) {
        let Some(parent) = parents.get(&current) else {
            break;
        };
        current = *parent;
    }
    seen.len()
}

// Forward effects immediately after each native mutation, even if it reports an
// error. In particular, resize notifications must precede any accompanying input.
// Actual PTY I/O remains on the single writer thread, never inside a callback.
fn forward_replies(
    terminal: &mut Terminal,
    writes: &Sender<WriterMessage>,
    shutdown: &Receiver<()>,
) -> Result<()> {
    for response in terminal.take_writes() {
        queue_write(writes, shutdown, response)?;
    }
    Ok(())
}

fn queue_write(
    writes: &Sender<WriterMessage>,
    shutdown: &Receiver<()>,
    bytes: Vec<u8>,
) -> Result<()> {
    crossbeam_channel::select_biased! {
        recv(shutdown) -> _ => bail!("terminal is stopping"),
        send(writes, WriterMessage::Bytes(bytes)) -> result => result.map_err(|_| anyhow!("terminal writer stopped")),
    }
}

fn run_writer(
    mut writer: Box<dyn Write + Send>,
    writer_rx: Receiver<WriterMessage>,
    actor_tx: Sender<ActorMessage>,
    shutdown: Receiver<()>,
) {
    loop {
        let message = crossbeam_channel::select_biased! {
            recv(shutdown) -> _ => break,
            recv(writer_rx) -> message => match message {
                Ok(message) => message,
                Err(_) => break,
            },
        };
        let result = match message {
            WriterMessage::Bytes(bytes) => writer.write_all(&bytes).and_then(|_| writer.flush()),
        };
        if let Err(error) = result {
            let _ = actor_tx.send(ActorMessage::WriterFailed(error.to_string()));
            break;
        }
    }
}

fn make_snapshot(
    terminal: &Terminal,
    info: &Arc<RwLock<TerminalInfo>>,
) -> Result<TerminalSnapshot> {
    let text = format_terminal(terminal, Format::Plain)?;
    let checkpoint = format_terminal(terminal, Format::Vt)?.into_bytes();
    let info = info
        .read()
        .map_err(|_| anyhow!("terminal info lock poisoned"))?
        .clone();
    Ok(TerminalSnapshot {
        info,
        text,
        checkpoint,
        cursor_x: terminal.cursor_x()?,
        cursor_y: terminal.cursor_y()?,
    })
}

fn format_rows(terminal: &Terminal, rows: Option<u16>) -> Result<Vec<String>> {
    let rows = rows.unwrap_or(terminal.rows()?);
    if rows == 0 {
        bail!("row count must be positive");
    }
    let total = terminal.total_rows()?;
    let count = usize::from(rows).min(total);
    // Charge both JSON punctuation and owned String slots, including empty rows.
    let mut bytes = 2 + count * (size_of::<String>() + 1);
    if bytes > MAX_ROWS_BYTES {
        bail!("rows exceed {MAX_ROWS_BYTES} byte limit");
    }
    let mut lines = Vec::with_capacity(count);
    let mut buffer = vec![0; MAX_ROWS_BYTES - bytes];
    for y in total - count..total {
        let y = u32::try_from(y).context("terminal row index exceeds u32")?;
        // A single-row selection preserves blank rows without joining soft wraps.
        let len = terminal
            .format_row(y, &mut buffer[..MAX_ROWS_BYTES - bytes])
            .with_context(|| {
                format!("rows exceed {MAX_ROWS_BYTES} byte limit or formatting failed")
            })?;
        let line = std::str::from_utf8(&buffer[..len])?;
        bytes += serde_json::to_vec(line)?.len();
        if bytes > MAX_ROWS_BYTES {
            bail!("rows exceed {MAX_ROWS_BYTES} byte limit");
        }
        lines.push(line.to_owned());
    }
    Ok(lines)
}

fn format_terminal(terminal: &Terminal, format: Format) -> Result<String> {
    let bytes = terminal.format(format)?;
    let output = String::from_utf8_lossy(bytes.as_ref()).into_owned();
    if format != Format::Vt {
        return Ok(output);
    }
    // Ghostty restores tab stops after screen state, moving the cursor in the process.
    Ok(format!(
        "{output}\x1b[{};{}H",
        terminal.cursor_y()? + 1,
        terminal.cursor_x()? + 1,
    ))
}

fn update_offsets(info: &Arc<RwLock<TerminalInfo>>, replay: &ReplayBuffer) {
    if let Ok(mut info) = info.write() {
        info.output_head = replay.head;
        info.output_tail = replay.tail;
    }
}

struct ReplayBuffer {
    bytes: VecDeque<u8>,
    capacity: usize,
    head: u64,
    tail: u64,
}

impl ReplayBuffer {
    fn new(capacity: usize) -> Self {
        Self {
            bytes: VecDeque::with_capacity(capacity.min(64 * 1024)),
            capacity,
            head: 0,
            tail: 0,
        }
    }

    fn append(&mut self, bytes: &[u8]) -> (u64, u64) {
        let start = self.tail;
        self.tail = self.tail.saturating_add(bytes.len() as u64);
        if self.capacity == 0 {
            self.bytes.clear();
            self.head = self.tail;
            return (start, self.tail);
        }
        self.bytes.extend(bytes);
        let excess = self.bytes.len().saturating_sub(self.capacity);
        self.bytes.drain(..excess);
        self.head = self.tail.saturating_sub(self.bytes.len() as u64);
        (start, self.tail)
    }

    fn read_from(&self, requested_offset: u64) -> Result<RawReplay> {
        if requested_offset > self.tail {
            bail!(
                "requested offset {requested_offset} is beyond tail {}",
                self.tail
            );
        }
        let available_offset = requested_offset.max(self.head);
        let skip = (available_offset - self.head) as usize;
        Ok(RawReplay {
            requested_offset,
            available_offset,
            end_offset: self.tail,
            truncated: requested_offset < self.head,
            bytes: self.bytes.iter().skip(skip).copied().collect(),
        })
    }
}

fn broadcast(
    shutdown: &Receiver<()>,
    subscribers: &mut HashMap<String, Subscriber>,
    controller: &mut Option<String>,
    controller_generation: &mut u64,
    event: StreamEvent,
) {
    let mut dropped = Vec::new();
    for (id, subscriber) in subscribers.iter() {
        if subscriber.is_disconnected() {
            dropped.push(id.clone());
            continue;
        }
        let failed = match subscriber.role {
            AttachmentRole::Controller => crossbeam_channel::select_biased! {
                // Quitting is not a subscriber disconnect: do not promote and
                // recursively notify controllers while tearing the actor down.
                recv(shutdown) -> _ => return,
                recv(subscriber.disconnected) -> _ => true,
                send(subscriber.events, event.clone()) -> result => result.is_err(),
            },
            AttachmentRole::Observer => subscriber.events.try_send(event.clone()).is_err(),
        };
        if failed {
            dropped.push(id.clone());
        }
    }
    if matches!(
        shutdown.try_recv(),
        Err(crossbeam_channel::TryRecvError::Disconnected)
    ) {
        return;
    }
    let mut controller_dropped = false;
    for id in dropped {
        subscribers.remove(&id);
        controller_dropped |= controller.as_ref() == Some(&id);
    }
    // Remove the whole failed set before selecting a replacement. In
    // particular, an already-full observer must not become a blocking sender.
    if controller_dropped {
        *controller_generation = controller_generation.saturating_add(1);
        *controller = promote_latest(subscribers, *controller_generation);
        let generation = *controller_generation;
        let attachment_id = controller.clone();
        broadcast(
            shutdown,
            subscribers,
            controller,
            controller_generation,
            StreamEvent::ControllerChanged {
                attachment_id,
                generation,
            },
        );
    }
}

fn promote_latest(
    subscribers: &mut HashMap<String, Subscriber>,
    generation: u64,
) -> Option<String> {
    subscribers.retain(|_, subscriber| !subscriber.is_disconnected());
    let attachment_id = subscribers
        .iter()
        .max_by_key(|(_, subscriber)| subscriber.last_control)
        .map(|(attachment_id, _)| attachment_id.clone())?;
    if let Some(subscriber) = subscribers.get_mut(&attachment_id) {
        subscriber.role = AttachmentRole::Controller;
        subscriber.last_control = generation;
    }
    Some(attachment_id)
}

fn authorize_controller(controller: &Option<String>, attachment_id: Option<&str>) -> Result<()> {
    let Some(attachment_id) = attachment_id else {
        if controller.is_none() {
            return Ok(());
        }
        bail!("terminal input requires the active controller attachment");
    };
    if controller.as_deref() != Some(attachment_id) {
        bail!("attachment {attachment_id} is not the terminal controller");
    }
    Ok(())
}

fn validate_size(cols: u16, rows: u16) -> Result<()> {
    if cols == 0 || rows == 0 {
        bail!("terminal dimensions must be positive");
    }
    Ok(())
}

fn default_shell() -> String {
    env::var("SHELL").unwrap_or_else(|_| {
        if cfg!(windows) {
            "cmd.exe".to_string()
        } else {
            "/bin/sh".to_string()
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestMaster;

    impl MasterPty for TestMaster {
        fn resize(&self, _: PtySize) -> Result<()> {
            Ok(())
        }
        fn get_size(&self) -> Result<PtySize> {
            Ok(PtySize::default())
        }
        fn try_clone_reader(&self) -> Result<Box<dyn Read + Send>> {
            unreachable!()
        }
        fn take_writer(&self) -> Result<Box<dyn Write + Send>> {
            unreachable!()
        }
        #[cfg(unix)]
        fn process_group_leader(&self) -> Option<libc::pid_t> {
            None
        }
        #[cfg(unix)]
        fn as_raw_fd(&self) -> Option<std::os::fd::RawFd> {
            None
        }
        #[cfg(unix)]
        fn tty_name(&self) -> Option<PathBuf> {
            None
        }
    }

    #[derive(Debug)]
    struct TestKiller;

    impl ChildKiller for TestKiller {
        fn kill(&mut self) -> io::Result<()> {
            Ok(())
        }
        fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
            Box::new(Self)
        }
    }

    fn test_info() -> TerminalInfo {
        TerminalInfo {
            id: 1,
            pid: None,
            title: "test".into(),
            foreground_process: None,
            group_id: "test".into(),
            command: vec![],
            cwd: PathBuf::new(),
            cols: 80,
            rows: 24,
            lifecycle: TerminalLifecycle::Running,
            output_head: 0,
            output_tail: 0,
        }
    }

    // Real actor/parser and bounded channels, without OS pipe capacity or a
    // large output flood. Native child/handle coverage lives in tests/runtime.rs.
    fn test_actor() -> (TerminalHandle, Receiver<WriterMessage>) {
        let (actor_tx, messages) = bounded(ACTOR_QUEUE_CAPACITY);
        let (writes, writer_rx) = bounded(1);
        let (shutdown_tx, shutdown) = bounded(0);
        #[cfg(windows)]
        let (close_tx, close_rx) = bounded(1);
        #[cfg(windows)]
        let closer = thread::spawn(move || {
            if let Ok(master) = close_rx.recv() {
                drop(master);
            }
        });
        let (init_tx, init_rx) = std_mpsc::sync_channel(1);
        let info = Arc::new(RwLock::new(test_info()));
        let actor_info = Arc::clone(&info);
        let (actor_done_tx, actor_done) = bounded::<()>(0);
        let actor = thread::spawn(move || {
            let _actor_done = actor_done_tx;
            run_actor(ActorConfig {
                master: ActorMaster {
                    pty: Some(Box::new(TestMaster)),
                    #[cfg(windows)]
                    close_tx,
                },
                messages,
                writes,
                shutdown,
                info: actor_info,
                replay_capacity: 4096,
                cols: 80,
                rows: 24,
                init_tx,
            })
            .unwrap()
        });
        init_rx.recv().unwrap().unwrap();
        (
            TerminalHandle {
                actor_tx,
                actor_done,
                shutdown_tx: Mutex::new(Some(shutdown_tx)),
                killer: Mutex::new(Box::new(TestKiller)),
                info,
                joins: Mutex::new(Some(vec![
                    actor,
                    #[cfg(windows)]
                    closer,
                ])),
            },
            writer_rx,
        )
    }

    #[test]
    #[cfg(windows)]
    fn windows_list_reads_metadata_without_an_actor_request() {
        let (actor, _writer) = test_actor();
        actor.shutdown().unwrap();
        let service = TerminalService::default();
        service.terminals.lock().unwrap().insert(1, Arc::new(actor));

        // Even a closed actor channel is irrelevant to cached Windows metadata.
        let terminals = service.list().unwrap();
        assert_eq!(terminals.len(), 1);
        assert_eq!(terminals[0].id, 1);
        assert_eq!(terminals[0].title, "test");
        assert!(terminals[0].foreground_process.is_none());
    }

    #[test]
    fn child_exit_and_reader_eof_are_distinct_actor_signals() {
        for eof_first in [false, true] {
            let (actor, _writer) = test_actor();
            actor
                .actor_tx
                .send(if eof_first {
                    ActorMessage::ReaderEof
                } else {
                    ActorMessage::ChildExited(Ok(Some(23)))
                })
                .unwrap();
            let snapshot = actor
                .request(|reply| ActorMessage::Snapshot { reply })
                .unwrap();
            assert_eq!(snapshot.info.lifecycle, TerminalLifecycle::Running);
            if !eof_first {
                actor
                    .actor_tx
                    .send(ActorMessage::Output(b"final".to_vec()))
                    .unwrap();
            }
            actor
                .actor_tx
                .send(if eof_first {
                    ActorMessage::ChildExited(Ok(Some(23)))
                } else {
                    ActorMessage::ReaderEof
                })
                .unwrap();
            let snapshot = actor
                .request(|reply| ActorMessage::Snapshot { reply })
                .unwrap();
            assert_eq!(
                snapshot.info.lifecycle,
                TerminalLifecycle::Exited {
                    exit_code: Some(23)
                }
            );
            if !eof_first {
                assert_eq!(snapshot.text, "final");
            }
            actor
                .actor_tx
                .send(ActorMessage::WriterFailed("late broken pipe".into()))
                .unwrap();
            let after_write_error = actor
                .request(|reply| ActorMessage::Snapshot { reply })
                .unwrap();
            assert_eq!(after_write_error.info.lifecycle, snapshot.info.lifecycle);
            actor.shutdown().unwrap();
            actor.shutdown().unwrap();
        }
    }

    #[test]
    fn late_attachments_receive_final_exit_after_replay_and_control() {
        let (actor, _writer) = test_actor();
        for message in [
            ActorMessage::Output(b"final".to_vec()),
            ActorMessage::ChildExited(Ok(Some(23))),
            ActorMessage::ReaderEof,
        ] {
            actor.actor_tx.send(message).unwrap();
        }
        let mut received = Vec::new();
        for role in [AttachmentRole::Observer, AttachmentRole::Controller] {
            let attached = actor
                .request(|reply| ActorMessage::Attach {
                    offset: 2,
                    attachment_id: "late".into(),
                    role,
                    takeover: false,
                    reply,
                })
                .unwrap();
            received.push((
                role,
                attached.replay.clone(),
                attached.events.try_iter().collect::<Vec<_>>(),
            ));
            drop(attached);
            actor
                .actor_tx
                .send(ActorMessage::Detach {
                    attachment_id: "late".into(),
                })
                .unwrap();
        }
        actor.shutdown().unwrap();
        for (role, replay, mut events) in received {
            assert_eq!(replay.bytes, b"nal");
            assert_eq!((replay.available_offset, replay.end_offset), (2, 5));
            if role == AttachmentRole::Controller {
                assert!(matches!(
                    events.remove(0),
                    StreamEvent::ControllerChanged { .. }
                ));
            }
            assert!(matches!(
                events.as_slice(),
                [StreamEvent::Exited {
                    exit_code: Some(23),
                    final_offset: 5
                }]
            ));
        }
    }

    #[test]
    #[cfg(windows)]
    fn failed_close_handoff_retains_master_ownership() {
        let (close_tx, close_rx) = bounded(1);
        drop(close_rx);
        let mut master = ActorMaster {
            pty: Some(Box::new(TestMaster)),
            close_tx,
        };
        assert!(master.close().is_err());
        assert!(master.get().is_ok());
    }

    #[test]
    fn attachment_drop_unblocks_controller_send_with_a_receiver_clone() {
        let (actor_tx, messages) = bounded(1);
        actor_tx.send(ActorMessage::ReaderEof).unwrap();
        let (events_tx, events) = bounded(1);
        events_tx
            .send(StreamEvent::TitleChanged {
                title: "queued".into(),
            })
            .unwrap();
        let retained_events = events.clone();
        let (disconnect_tx, disconnected) = bounded(0);
        let attachment = TerminalAttachment {
            terminal: test_info(),
            role: AttachmentRole::Controller,
            generation: 1,
            replay: ReplayBuffer::new(0).read_from(0).unwrap(),
            events,
            actor_tx,
            attachment_id: "controller".into(),
            disconnect_tx: Some(disconnect_tx),
        };
        let (shutdown_tx, shutdown) = bounded(0);
        let (done, finished) = std_mpsc::channel();
        let actor = thread::spawn(move || {
            let mut subscribers = HashMap::from([(
                "controller".into(),
                Subscriber {
                    events: events_tx,
                    disconnected,
                    role: AttachmentRole::Controller,
                    last_control: 1,
                },
            )]);
            let mut controller = Some("controller".into());
            let mut generation = 1;
            broadcast(
                &shutdown,
                &mut subscribers,
                &mut controller,
                &mut generation,
                StreamEvent::TitleChanged {
                    title: "blocked".into(),
                },
            );
            let removed = subscribers.is_empty() && controller.is_none();
            let _ = messages.recv(); // Release the actor queue's occupied slot.
            let detached = matches!(messages.recv_timeout(Duration::from_secs(1)),
                Ok(ActorMessage::Detach { attachment_id }) if attachment_id == "controller");
            let _ = done.send(removed && detached);
        });
        let dropper = thread::spawn(move || drop(attachment));
        let progress = finished.recv_timeout(Duration::from_secs(1));
        // A red regression can always unwind without leaking worker threads.
        drop(shutdown_tx);
        actor.join().unwrap();
        dropper.join().unwrap();
        assert_eq!(progress, Ok(true));
        assert_eq!(retained_events.len(), 1);
    }

    #[test]
    fn stale_detach_does_not_remove_a_live_replacement() {
        let (actor, _writer) = test_actor();
        let attach = || {
            actor
                .request(|reply| ActorMessage::Attach {
                    offset: 0,
                    attachment_id: "shared".into(),
                    role: AttachmentRole::Controller,
                    takeover: false,
                    reply,
                })
                .unwrap()
        };
        let old = attach();
        let current = attach();
        drop(old);
        actor
            .actor_tx
            .send(ActorMessage::Detach {
                attachment_id: "shared".into(),
            })
            .unwrap();
        let replacement = actor.request(|reply| ActorMessage::Control {
            attachment_id: "shared".into(),
            cols: 80,
            rows: 24,
            bytes: None,
            reply,
        });
        drop(current);
        actor
            .actor_tx
            .send(ActorMessage::Detach {
                attachment_id: "shared".into(),
            })
            .unwrap();
        let detached = actor.request(|reply| ActorMessage::Control {
            attachment_id: "shared".into(),
            cols: 80,
            rows: 24,
            bytes: None,
            reply,
        });
        actor.shutdown().unwrap();
        assert!(replacement.is_ok());
        assert!(detached.is_err());
    }

    #[test]
    fn broadcast_removes_failed_observers_before_promoting() {
        let mut subscribers = HashMap::new();
        let mut receivers = HashMap::new();
        let mut disconnects = Vec::new();
        for id in ["a", "b"] {
            let (events, receiver) = bounded(1);
            events
                .send(StreamEvent::TitleChanged {
                    title: "queued".into(),
                })
                .unwrap();
            let (disconnect, disconnected) = bounded(0);
            disconnects.push(disconnect);
            receivers.insert(id.to_string(), receiver);
            subscribers.insert(
                id.to_string(),
                Subscriber {
                    events,
                    disconnected,
                    role: AttachmentRole::Observer,
                    last_control: 1,
                },
            );
        }
        // Force the failed controller to precede the full observer in iteration
        // order, regardless of HashMap's randomized seed.
        let first = subscribers.keys().next().unwrap().clone();
        subscribers.get_mut(&first).unwrap().role = AttachmentRole::Controller;
        drop(receivers.remove(&first));
        let (shutdown_tx, shutdown) = bounded(0);
        let (done, finished) = std_mpsc::channel();
        let worker = thread::spawn(move || {
            let mut controller = Some(first);
            let mut generation = 1;
            broadcast(
                &shutdown,
                &mut subscribers,
                &mut controller,
                &mut generation,
                StreamEvent::TitleChanged {
                    title: "next".into(),
                },
            );
            let _ = done.send(subscribers.is_empty() && controller.is_none() && generation == 2);
        });
        let progress = finished.recv_timeout(Duration::from_secs(1));
        drop(shutdown_tx);
        worker.join().unwrap();
        assert_eq!(progress, Ok(true));
    }

    #[test]
    fn shutdown_interrupts_controller_backpressure() {
        let (actor, _writer) = test_actor();
        let attached = actor
            .request(|reply| ActorMessage::Attach {
                offset: 0,
                attachment_id: "controller".into(),
                role: AttachmentRole::Controller,
                takeover: false,
                reply,
            })
            .unwrap();
        // Attach already queued ControllerChanged. Force one output per batch
        // with a following actor request, filling the queue with only 1 KiB.
        for _ in 1..SUBSCRIBER_QUEUE_CAPACITY {
            actor
                .actor_tx
                .send(ActorMessage::Output(b"x".to_vec()))
                .unwrap();
            actor
                .request(|reply| ActorMessage::Replay { offset: 0, reply })
                .unwrap();
        }
        assert!(attached.events.is_full());
        actor
            .actor_tx
            .send(ActorMessage::Output(b"!".to_vec()))
            .unwrap();
        let (done, finished) = std_mpsc::channel();
        let shutdown = thread::spawn(move || {
            actor.shutdown().unwrap();
            done.send(()).unwrap();
        });
        let stopped = finished.recv_timeout(Duration::from_secs(1)).is_ok();
        // Release the test consumer even on failure so a red regression never
        // leaves a thread stuck or depends on the runtime-test watchdog.
        drop(attached);
        shutdown.join().unwrap();
        assert!(
            stopped,
            "shutdown waited for a controller to consume output"
        );
    }

    #[test]
    fn shutdown_interrupts_actor_to_writer_backpressure() {
        let (actor, writer) = test_actor();
        actor
            .request(|reply| ActorMessage::Write {
                attachment_id: None,
                bytes: b"first".to_vec(),
                reply,
            })
            .unwrap();
        assert!(writer.is_full());
        let (reply, _reply_rx) = bounded(1);
        actor
            .actor_tx
            .send(ActorMessage::Write {
                attachment_id: None,
                bytes: b"blocked".to_vec(),
                reply,
            })
            .unwrap();
        // Shutdown overtakes this queued request; its caller must still return.
        let actor = Arc::new(actor);
        let (queued_tx, queued) = std_mpsc::channel();
        let requester = thread::spawn({
            let actor = Arc::clone(&actor);
            move || {
                let _ = queued_tx.send(actor.request(|reply| ActorMessage::Snapshot { reply }));
            }
        });
        let (done, finished) = std_mpsc::channel();
        let shutdown = thread::spawn({
            let actor = Arc::clone(&actor);
            move || {
                actor.shutdown().unwrap();
                done.send(()).unwrap();
            }
        });
        let stopped = finished.recv_timeout(Duration::from_secs(1)).is_ok();
        let queued = queued.recv_timeout(Duration::from_secs(1));
        drop(writer);
        shutdown.join().unwrap();
        assert!(stopped, "shutdown waited for the full input queue");
        assert!(
            queued.is_ok_and(|result| result.is_err()),
            "a request queued before shutdown never returned"
        );
        requester.join().unwrap();
    }

    fn rows_terminal(cols: u16, rows: u16, input: &str) -> Terminal {
        let mut terminal = Terminal::new(TerminalOptions {
            cols,
            rows,
            max_scrollback: 2 * 1024 * 1024,
        })
        .unwrap();
        terminal.vt_write(input.as_bytes());
        terminal
    }

    #[test]
    fn forwarding_replies_drains_once_and_reports_writer_failure() {
        let mut terminal = rows_terminal(10, 3, "\x1b[5n\x1b[6n");
        let (writes, reader) = bounded(4);
        let (_shutdown_tx, shutdown) = bounded(0);
        forward_replies(&mut terminal, &writes, &shutdown).unwrap();
        for expected in [b"\x1b[0n".as_slice(), b"\x1b[1;1R".as_slice()] {
            let WriterMessage::Bytes(bytes) = reader.try_recv().unwrap();
            assert_eq!(bytes, expected);
        }
        assert!(reader.try_recv().is_err());
        assert!(terminal.take_writes().is_empty());

        terminal.vt_write(b"\x1b[5n");
        drop(reader);
        assert_eq!(
            forward_replies(&mut terminal, &writes, &shutdown)
                .unwrap_err()
                .to_string(),
            "terminal writer stopped",
        );
        assert!(terminal.take_writes().is_empty());
    }

    #[test]
    fn rows_include_live_height_and_preserve_blank_rows() {
        let terminal = rows_terminal(10, 5, "");
        assert_eq!(format_rows(&terminal, None).unwrap(), ["", "", "", "", ""]);
        let terminal = rows_terminal(10, 5, "\x1b[31mone  \x1b[0m\r\n\r\n  three\r\n");
        assert_eq!(
            format_rows(&terminal, None).unwrap(),
            ["one", "", "  three", "", ""]
        );
        assert_eq!(format_rows(&terminal, Some(2)).unwrap(), ["", ""]);
        assert_eq!(
            format_rows(&terminal, Some(u16::MAX)).unwrap(),
            ["one", "", "  three", "", ""]
        );
    }

    #[test]
    fn rows_include_history_only_when_requested() {
        let terminal = rows_terminal(10, 3, "one\r\ntwo\r\nthree\r\nfour\r\nfive");
        assert_eq!(
            format_rows(&terminal, None).unwrap(),
            ["three", "four", "five"]
        );
        assert_eq!(format_rows(&terminal, Some(2)).unwrap(), ["four", "five"]);
        assert_eq!(
            format_rows(&terminal, Some(4)).unwrap(),
            ["two", "three", "four", "five"]
        );
        assert_eq!(
            format_rows(&terminal, Some(u16::MAX)).unwrap(),
            ["one", "two", "three", "four", "five"]
        );
    }

    #[test]
    fn rows_keep_physical_wraps_and_unicode_graphemes() {
        let terminal = rows_terminal(4, 3, "abcdefghij");
        assert_eq!(
            format_rows(&terminal, None).unwrap(),
            ["abcd", "efgh", "ij"]
        );
        assert_eq!(format_rows(&terminal, Some(2)).unwrap(), ["efgh", "ij"]);
        let terminal = rows_terminal(4, 3, "a\u{301}\u{754c}bc");
        assert_eq!(
            format_rows(&terminal, None).unwrap(),
            ["a\u{301}\u{754c}b", "c", ""]
        );
    }

    #[test]
    fn rows_isolate_alternate_screen_and_restore_primary_history() {
        let mut terminal = rows_terminal(10, 3, "one\r\ntwo\r\nthree\r\nfour\r\nfive");
        let primary = format_rows(&terminal, Some(u16::MAX)).unwrap();
        terminal.vt_write(b"\x1b[?1049hA\r\nB\r\nC\r\nD\r\nE");
        assert_eq!(
            format_rows(&terminal, Some(u16::MAX)).unwrap(),
            ["C", "D", "E"]
        );
        assert_eq!(format_rows(&terminal, None).unwrap(), ["C", "D", "E"]);
        terminal.vt_write(b"\x1b[?1049l");
        assert_eq!(format_rows(&terminal, Some(u16::MAX)).unwrap(), primary);
    }

    #[test]
    fn rows_follow_resize_and_reflow() {
        let mut terminal = rows_terminal(4, 3, "abcdefghij");
        terminal.resize(6, 4).unwrap();
        assert_eq!(
            format_rows(&terminal, None).unwrap(),
            ["abcdef", "ghij", "", ""]
        );
        terminal.resize(4, 2).unwrap();
        assert_eq!(format_rows(&terminal, None).unwrap(), ["efgh", "ij"]);
        assert_eq!(
            format_rows(&terminal, Some(3)).unwrap(),
            ["abcd", "efgh", "ij"]
        );
    }

    #[test]
    fn rows_do_not_change_viewport_selection_cursor_or_checkpoint() {
        let mut terminal = rows_terminal(10, 3, "one\r\ntwo\r\nthree\r\nfour\r\nfive");
        terminal.scroll_to_top();
        terminal.set_selection((0, 0), (2, 0)).unwrap();
        let viewport = terminal.viewport_row().unwrap();
        let checkpoint = format_terminal(&terminal, Format::Vt).unwrap();
        let cursor = (terminal.cursor_x().unwrap(), terminal.cursor_y().unwrap());
        assert_eq!(
            format_rows(&terminal, None).unwrap(),
            ["three", "four", "five"]
        );
        assert_eq!(format_terminal(&terminal, Format::Vt).unwrap(), checkpoint);
        assert_eq!(
            (terminal.cursor_x().unwrap(), terminal.cursor_y().unwrap()),
            cursor
        );
        assert_eq!(terminal.viewport_row().unwrap(), viewport);
        let mut buffer = [0; 32];
        let len = terminal.selection_text(&mut buffer).unwrap().unwrap();
        assert_eq!(&buffer[..len], b"one");
    }

    #[test]
    fn rows_reject_zero_and_bound_escaped_payload_by_bytes() {
        let terminal = rows_terminal(10, 3, "");
        assert!(
            format_rows(&terminal, Some(0))
                .unwrap_err()
                .to_string()
                .contains("positive")
        );
        for (character, rows) in [("x", 1100), ("\"", 600)] {
            let terminal = rows_terminal(1000, rows, &character.repeat(1000 * usize::from(rows)));
            assert!(
                format_rows(&terminal, None)
                    .unwrap_err()
                    .to_string()
                    .contains("byte limit")
            );
            assert_eq!(
                format_rows(&terminal, Some(1)).unwrap(),
                [character.repeat(1000)]
            );
        }
        let terminal = rows_terminal(1, u16::MAX, "");
        assert!(
            format_rows(&terminal, None)
                .unwrap_err()
                .to_string()
                .contains("byte limit")
        );
        assert_eq!(format_rows(&terminal, Some(1)).unwrap(), [""]);
    }

    #[test]
    fn checkpoint_restores_cursor_and_tabstops() {
        for (cols, rows) in [(80, 24), (30, 100), (100, 30)] {
            for input in [
                "",
                "hello\r\nworld\x1b[2;3H",
                "\x1b[3g\x1b[5G\x1bH\x1b[15G\x1bH\x1b[3;4H",
                "\x1b[3;20r\x1b[5;7H",
            ] {
                let mut source = Terminal::new(TerminalOptions {
                    cols: 80,
                    rows: 24,
                    max_scrollback: 0,
                })
                .unwrap();
                source.vt_write(input.as_bytes());
                source.resize(cols, rows).unwrap();
                let checkpoint = format_terminal(&source, Format::Vt).unwrap();
                let mut restored = Terminal::new(TerminalOptions {
                    cols,
                    rows,
                    max_scrollback: 0,
                })
                .unwrap();
                restored.vt_write(checkpoint.as_bytes());

                assert_eq!(restored.cursor_x().unwrap(), source.cursor_x().unwrap());
                assert_eq!(restored.cursor_y().unwrap(), source.cursor_y().unwrap());
                assert_eq!(
                    format_terminal(&restored, Format::Plain).unwrap(),
                    format_terminal(&source, Format::Plain).unwrap(),
                );

                source.vt_write(b"\tcontinued");
                restored.vt_write(b"\tcontinued");
                assert_eq!(
                    format_terminal(&restored, Format::Plain).unwrap(),
                    format_terminal(&source, Format::Plain).unwrap(),
                );
            }
        }
    }

    #[test]
    fn checkpoint_does_not_leave_zsh_partial_line_marker() {
        let options = TerminalOptions {
            cols: 80,
            rows: 24,
            max_scrollback: 0,
        };
        let source = Terminal::new(options).unwrap();
        let checkpoint = format_terminal(&source, Format::Vt).unwrap();
        let mut restored = Terminal::new(TerminalOptions {
            cols: 80,
            rows: 24,
            max_scrollback: 0,
        })
        .unwrap();
        restored.vt_write(checkpoint.as_bytes());
        restored.vt_write(
            format!(
                "\x1b[1m\x1b[7m%\x1b[0m{}\r \r\r\x1b[Jprompt% ",
                " ".repeat(79)
            )
            .as_bytes(),
        );

        assert_eq!(
            format_terminal(&restored, Format::Plain).unwrap(),
            "prompt%"
        );
        assert_eq!(restored.cursor_y().unwrap(), 0);
    }

    #[test]
    fn replay_reports_truncation_and_offsets() {
        let mut replay = ReplayBuffer::new(5);
        replay.append(b"abc");
        replay.append(b"defg");
        assert_eq!(replay.head, 2);
        assert_eq!(replay.tail, 7);

        let value = replay.read_from(0).unwrap();
        assert!(value.truncated);
        assert_eq!(value.available_offset, 2);
        assert_eq!(value.bytes, b"cdefg");

        let value = replay.read_from(5).unwrap();
        assert!(!value.truncated);
        assert_eq!(value.bytes, b"fg");
    }

    #[test]
    fn controller_backpressures_instead_of_disconnecting() {
        let (_shutdown_tx, shutdown) = bounded(0);
        let (_disconnect_tx, disconnected) = bounded(0);
        let (events_tx, events) = bounded(1);
        events_tx
            .send(StreamEvent::Output {
                start: 0,
                end: 1,
                bytes: b"a".to_vec(),
            })
            .unwrap();
        let mut subscribers = HashMap::from([(
            "controller".to_string(),
            Subscriber {
                events: events_tx,
                disconnected,
                role: AttachmentRole::Controller,
                last_control: 1,
            },
        )]);
        let broadcast = std::thread::spawn(move || {
            let mut controller = Some("controller".to_string());
            let mut generation = 1;
            broadcast(
                &shutdown,
                &mut subscribers,
                &mut controller,
                &mut generation,
                StreamEvent::Output {
                    start: 1,
                    end: 2,
                    bytes: b"b".to_vec(),
                },
            );
            subscribers.contains_key("controller")
        });

        assert!(matches!(
            events.recv().unwrap(),
            StreamEvent::Output { start: 0, .. }
        ));
        assert!(matches!(
            events.recv().unwrap(),
            StreamEvent::Output { start: 1, .. }
        ));
        assert!(broadcast.join().unwrap());
    }

    #[test]
    fn slow_observer_is_disconnected() {
        let (_shutdown_tx, shutdown) = bounded(0);
        let (_disconnect_tx, disconnected) = bounded(0);
        let (events_tx, _events) = bounded(1);
        events_tx
            .send(StreamEvent::Output {
                start: 0,
                end: 1,
                bytes: b"a".to_vec(),
            })
            .unwrap();
        let mut subscribers = HashMap::from([(
            "observer".to_string(),
            Subscriber {
                events: events_tx,
                disconnected,
                role: AttachmentRole::Observer,
                last_control: 0,
            },
        )]);

        broadcast(
            &shutdown,
            &mut subscribers,
            &mut None,
            &mut 0,
            StreamEvent::Output {
                start: 1,
                end: 2,
                bytes: b"b".to_vec(),
            },
        );

        assert!(!subscribers.contains_key("observer"));
    }

    #[test]
    fn output_is_batched_without_reordering_other_messages() {
        let (_shutdown_tx, shutdown) = bounded(0);
        let (messages_tx, messages) = bounded(4);
        messages_tx
            .send(ActorMessage::Output(b"abc".to_vec()))
            .unwrap();
        messages_tx
            .send(ActorMessage::Output(b"def".to_vec()))
            .unwrap();
        messages_tx.send(ActorMessage::ReaderEof).unwrap();
        let mut pending = None;

        assert!(matches!(
            receive_actor_message(&messages, &mut pending, &shutdown).unwrap(),
            ActorMessage::Output(bytes) if bytes == b"abcdef"
        ));
        assert!(matches!(
            receive_actor_message(&messages, &mut pending, &shutdown).unwrap(),
            ActorMessage::ReaderEof
        ));
    }
}
