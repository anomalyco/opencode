//! The JS host as a child process, supervised (synthesis 4.3): the UI thread never touches a pipe. The protocol runs
//! both ways on the child's standard input, one connection ([`channel`], js-stdio): a writer thread drains a bounded
//! queue into it; a reader thread reads and decodes frames from it into a bounded inbox and wakes the UI thread; a watch
//! thread names the JS host hung when the oldest event it has not acknowledged is over the limit, and over its memory
//! budget when its resident set is. Standard output and standard error are the plugins' own: what a plugin writes to
//! the descriptor itself (`fs.writeSync(1, …)`, which no JS-level redirect reaches) and its prints are logged, and
//! neither can break the protocol.
//!
//! What bounds what (S2):
//!
//! - host to child: the queued bytes ([`Limits::queued`]); a send over them waits in the host's overflow, up to
//!   [`Limits::inbox`] bytes, and past that is refused, but for what settles the JS host's work, which waits in a
//!   reserve as large again; past the reserve the host ends the JS host rather than block or drop it;
//! - child to host, ordered messages: their count and bytes unread by the UI thread ([`Limits::ordered`],
//!   [`Limits::inbox`]); over either, the JS host broke the contract (a flood of effects) and is ended;
//! - child to host, trees: after [`Limits::trees`] unread ones the reader stops reading, so the child blocks on its own
//!   pipe: a flood of trees costs neither memory nor the UI thread's time.
//!
//! The child dies with the host, and takes what it started with it: when its input ends (a rule of the protocol), when
//! a thread of its own sees its parent gone, and on Linux on the parent-death signal, it kills its descendants and its
//! process group, itself last (`host.ts` `killAll`). On Linux it is a child subreaper, so a descendant whose parent
//! exited stays its own, also one that left the group; elsewhere the group alone. The host kills the group whole when it
//! ends the child. On Windows a job holds the child and everything it starts, and the system closes it with the host.

#![allow(unsafe_code)]

use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Write};
use std::process::{ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use super::proto::{MAGIC, Revision, Up, VERSION};
use super::wire;

/// The bounds of one JS host. Starting values, as the other limits of 4.2 and 4.4.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Limits {
    /// Bytes queued for the child (bigboi: 1 MiB a direction).
    pub queued: usize,
    /// Ordered messages from the child the UI thread has not taken: 512 (FT-9), as a setup that watches the 128 reads a
    /// plugin may sends one message a watch, beside its others, while the UI thread may be busy (the lab's 140 watches
    /// flooded 256 under load). The bytes bound below holds their memory.
    pub ordered: usize,
    /// Bytes of them (bigboi: 8 MiB in all).
    pub inbox: usize,
    /// Trees from the child the UI thread has not taken, before the reader stops reading (S2: 8).
    pub trees: usize,
    /// How long the oldest event may wait for its acknowledgement (4.3: 1 s).
    pub ack: Duration,
    /// The same for a load or a setup, which may import a large module before it reads on: not a frame's event (4.4).
    /// Also for whatever waits on the JS host's own start, until its hello: Bun loading the host's modules.
    pub setup: Duration,
    /// The JS host's resident set (S2: a minimal Bun is 20 to 26 MiB; 58 MB a loaded one).
    pub memory: u64,
    /// How often the resident set is read.
    pub poll: Duration,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            queued: 1 << 20,
            ordered: 512,
            inbox: 8 << 20,
            trees: 8,
            ack: Duration::from_secs(1),
            setup: Duration::from_secs(10),
            memory: 512 << 20,
            poll: Duration::from_millis(500),
        }
    }
}

/// What the UI thread takes from the child.
#[derive(Debug)]
pub enum Event {
    Up(Box<Up>),
    Tree(Box<Revision>),
    /// The JS host ended or broke the protocol; why, and the plugin whose messages flooded the host, if that was it.
    /// Nothing follows.
    Gone(String, Option<String>),
    /// Event `seq` was not acknowledged within the limit.
    Hung {
        seq: u64,
    },
    /// The resident set, over the budget.
    Memory(u64),
}

/// What an event waits for before the JS host owes nothing for it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Wait {
    /// Its acknowledgement.
    Ack,
    /// Its answer: a handler returned and its views were sent, a view was sent, a ping was answered. An acknowledgement
    /// is not progress.
    Answer,
    /// A load's answer, whose setup may run up to [`Limits::setup`] once it started.
    Setup,
}

/// A send the queue refused.
#[derive(Debug, PartialEq, Eq)]
pub enum Refused {
    /// The queue holds too much: the child does not read.
    Full,
    /// The frame alone is over what the queue holds.
    TooLarge(usize),
}

/// What the JS host owes: the events it has not acknowledged or answered, and when it last sent anything.
struct Owed {
    /// Each event, what it waits for, and whether the JS host said it started it.
    events: VecDeque<(u64, Wait, bool)>,
    progress: Instant,
}

struct Out {
    /// A send was refused for the queue's bound: the writer wakes the UI thread once it takes a frame, so the host's
    /// overflow moves on, whether or not the child answers what it reads (overflow-flake).
    wants_room: bool,
    frames: VecDeque<Vec<u8>>,
    bytes: usize,
    closed: bool,
}

#[derive(Default)]
struct Inbox {
    events: VecDeque<Event>,
    ordered: usize,
    bytes: usize,
    trees: usize,
    /// The unread messages of each plugin's own: every one that names it ([`owner`]), such as its effects, its watches
    /// and the start of its code that ran for an answer (carbon-5: a flood of watches or logs is a plugin's too). The
    /// end of that code names no plugin; with the start counted, the plugin's own are still most of a flood of its
    /// effects and their answers.
    effects: std::collections::HashMap<String, usize>,
    /// The unread bytes of each plugin's own messages, which name it for a flood of bytes.
    sizes: std::collections::HashMap<String, usize>,
    /// A `Gone` was queued: nothing more is.
    ended: bool,
}

struct Shared {
    limits: Limits,
    out: Mutex<Out>,
    out_ready: Condvar,
    inbox: Mutex<Inbox>,
    room: Condvar,
    /// What the JS host owes. It is hung when it owes something and sent nothing for the limit: a queue that moves is
    /// not a hang, however long, and one handler that runs past the limit is (review bigboi-3).
    sent: Mutex<Owed>,
    watch: Condvar,
    /// The last acknowledged sequence.
    acked: AtomicU64,
    /// The JS host said the protocol's hello: it started.
    hello: AtomicBool,
    /// The reader waits for the host to take its trees: what the JS host sent after them is not read, so its silence
    /// is the host's, not the JS host's (FT-1).
    held: AtomicBool,
    /// Bytes read from the child, and of them in trees.
    read: AtomicU64,
    read_trees: AtomicU64,
    closed: AtomicBool,
    /// A wake waits for the UI thread.
    pending: AtomicBool,
    wake: Box<dyn Fn() + Send + Sync>,
    /// The last lines of standard error, for the report of a death.
    stderr: Mutex<VecDeque<String>>,
    /// The last records of what plugins wrote to standard output ([`stray`]).
    stray: Mutex<VecDeque<String>>,
    process: Mutex<Option<std::process::Child>>,
    pid: u32,
    /// The job that holds the child and what it starts; closing it ends them all. It goes when the child is killed, not
    /// when the `Child` drops, so a drop's grace period stands (review carbon-6).
    #[cfg(windows)]
    job: Mutex<Option<opencode_util::win::KillOnCloseJob>>,
}

/// A running JS host. Dropping it closes its input, which ends it; one that does not end within 500 ms is killed, off
/// the UI thread.
pub struct Child {
    shared: Arc<Shared>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Child {
    /// Starts `command` with the protocol's channel as its standard input, and its standard output and error piped to
    /// the log. `wake` runs on another thread, once per batch, when the UI thread has something to take.
    pub fn spawn(
        mut command: Command,
        limits: Limits,
        wake: impl Fn() + Send + Sync + 'static,
    ) -> std::io::Result<Self> {
        let (reader, writer, theirs) = channel::open()?;
        command.stdin(theirs).stdout(Stdio::piped()).stderr(Stdio::piped());
        contain(&mut command);
        let mut process = command.spawn()?;
        // The child's end goes with the command: the reader sees the end of the stream once the child's copies close.
        drop(command);
        // Without its job the child would outlive a client that dies: it is not run then (review bigboi-9).
        #[cfg(windows)]
        let job = match opencode_util::win::KillOnCloseJob::new().and_then(|job| job.assign(&process).map(|()| job)) {
            Ok(job) => job,
            Err(error) => {
                let _ = process.kill();
                let _ = process.wait();
                return Err(error);
            }
        };
        let (stdout, stderr) = (process.stdout.take(), process.stderr.take());
        let pid = process.id();
        let shared = Arc::new(Shared {
            limits,
            out: Mutex::new(Out { frames: VecDeque::new(), bytes: 0, closed: false, wants_room: false }),
            out_ready: Condvar::new(),
            inbox: Mutex::default(),
            room: Condvar::new(),
            sent: Mutex::new(Owed { events: VecDeque::new(), progress: Instant::now() }),
            watch: Condvar::new(),
            acked: AtomicU64::new(0),
            hello: AtomicBool::new(false),
            held: AtomicBool::new(false),
            read: AtomicU64::new(0),
            read_trees: AtomicU64::new(0),
            closed: AtomicBool::new(false),
            pending: AtomicBool::new(false),
            wake: Box::new(wake),
            stderr: Mutex::default(),
            stray: Mutex::default(),
            process: Mutex::new(Some(process)),
            pid,
            #[cfg(windows)]
            job: Mutex::new(Some(job)),
        });
        let child = Self { shared: shared.clone() };
        let named = |name: &str| std::thread::Builder::new().name(format!("js-host-{name}"));
        {
            let shared = shared.clone();
            named("writer").spawn(move || write(&shared, writer))?;
        }
        {
            let shared = shared.clone();
            named("reader").spawn(move || read(&shared, reader))?;
        }
        if let Some(stdout) = stdout {
            let shared = shared.clone();
            named("stdout").spawn(move || stray(&shared, stdout))?;
        }
        if let Some(stderr) = stderr {
            let shared = shared.clone();
            named("stderr").spawn(move || errors(&shared, stderr))?;
        }
        named("watch").spawn(move || watch(&shared))?;
        Ok(child)
    }

    pub fn pid(&self) -> u32 {
        self.shared.pid
    }

    /// Queues one frame; `seq` is the event it carries, whose acknowledgement or answer the watch waits for as `wait`
    /// says. Refused when the queue has no room, or the child ended.
    /// Queues the head of the stream, the host's hello, whatever the bound of the queued bytes ([`Limits::queued`]):
    /// without it the JS host follows nothing after it, so a fresh child takes it first. Only a closed child refuses
    /// it.
    pub fn send_head(&self, kind: u8, payload: &[u8]) -> Result<(), Refused> {
        let frame = wire::encode(kind, payload);
        let mut out = lock(&self.shared.out);
        if out.closed {
            return Err(Refused::Full);
        }
        out.bytes += frame.len();
        out.frames.push_back(frame);
        drop(out);
        self.shared.out_ready.notify_all();
        Ok(())
    }

    pub fn send(&self, kind: u8, payload: &[u8], seq: Option<u64>, wait: Wait) -> Result<(), Refused> {
        let frame = wire::encode(kind, payload);
        if frame.len() > self.shared.limits.queued {
            return Err(Refused::TooLarge(frame.len()));
        }
        {
            let mut out = lock(&self.shared.out);
            if out.closed || out.bytes + frame.len() > self.shared.limits.queued {
                out.wants_room = !out.closed;
                return Err(Refused::Full);
            }
            out.bytes += frame.len();
            out.frames.push_back(frame);
        }
        if let Some(seq) = seq {
            let mut owed = lock(&self.shared.sent);
            // The clock starts when something is owed, not at the JS host's last word before it.
            if owed.events.is_empty() {
                owed.progress = Instant::now();
            }
            owed.events.push_back((seq, wait, false));
            drop(owed);
            self.shared.watch.notify_all();
        }
        self.shared.out_ready.notify_all();
        Ok(())
    }

    /// What the child sent since the last take, in order.
    pub fn take(&self) -> Vec<Event> {
        self.shared.pending.store(false, Ordering::Release);
        let mut inbox = lock(&self.shared.inbox);
        let events: Vec<Event> = inbox.events.drain(..).collect();
        (inbox.ordered, inbox.bytes, inbox.trees) = (0, 0, 0);
        inbox.effects.clear();
        inbox.sizes.clear();
        drop(inbox);
        self.shared.room.notify_all();
        events
    }

    /// The bytes read from the child so far, and of them in trees.
    pub fn read(&self) -> (u64, u64) {
        (self.shared.read.load(Ordering::Relaxed), self.shared.read_trees.load(Ordering::Relaxed))
    }

    /// The last acknowledged sequence.
    pub fn acked(&self) -> u64 {
        self.shared.acked.load(Ordering::Acquire)
    }

    /// The child's resident set, in bytes, where the system tells it.
    pub fn resident(&self) -> Option<u64> {
        resident(&self.shared)
    }

    /// The last lines the child wrote to standard error.
    pub fn stderr(&self) -> Vec<String> {
        lock(&self.shared.stderr).iter().cloned().collect()
    }

    /// The last records of what the child's plugins wrote to standard output, as they were logged.
    pub fn stray(&self) -> Vec<String> {
        lock(&self.shared.stray).iter().cloned().collect()
    }

    /// Ends the child at once, with every process of its group, and reaps it.
    pub fn kill(&self) {
        close(&self.shared);
        kill(&self.shared);
    }
}

impl Drop for Child {
    fn drop(&mut self) {
        close(&self.shared);
        let shared = self.shared.clone();
        // The child ends when its input does; one that does not is killed. Off the UI thread, as a hang may be why it
        // is dropped.
        let reaped = std::thread::Builder::new().name("js-host-reap".to_owned()).spawn(move || {
            let deadline = Instant::now() + Duration::from_millis(500);
            while Instant::now() < deadline {
                let exited = lock(&shared.process).as_mut().is_none_or(exited);
                if exited {
                    // Its group may hold what it started.
                    kill(&shared);
                    return;
                }
                std::thread::sleep(Duration::from_millis(5));
            }
            kill(&shared);
        });
        if reaped.is_err() {
            kill(&self.shared);
        }
    }
}

/// Marks the child ended for every thread: the writer stops, so its input closes, and the reader stops waiting for room.
fn close(shared: &Shared) {
    shared.closed.store(true, Ordering::Release);
    lock(&shared.out).closed = true;
    shared.out_ready.notify_all();
    shared.room.notify_all();
    shared.watch.notify_all();
}

/// Ends the child's process group, then reaps the child: how it exited, once.
fn kill(shared: &Shared) -> Option<std::process::ExitStatus> {
    let mut process = lock(&shared.process).take()?;
    #[cfg(unix)]
    // SAFETY: a signal to the child's own process group, which `contain` made; nothing reaps the child before this (see
    // `exited`), so its ID still names it.
    unsafe {
        libc::kill(-(process.id() as libc::pid_t), libc::SIGKILL);
    }
    #[cfg(windows)]
    drop(lock(&shared.job).take());
    let _ = process.kill();
    process.wait().ok()
}

/// Whether the child exited, without reaping it on Unix: until [`kill`] signalled its group, its ID cannot name another
/// process (review carbon-6).
fn exited(process: &mut std::process::Child) -> bool {
    #[cfg(unix)]
    {
        // SAFETY: `info` is plain data, zeroed as POSIX asks before a `WNOHANG` call; it stays zero when nothing exited.
        let mut info: libc::siginfo_t = unsafe { std::mem::zeroed() };
        let options = libc::WEXITED | libc::WNOHANG | libc::WNOWAIT;
        // SAFETY: as above; `waitid` writes only `info`.
        let found = unsafe { libc::waitid(libc::P_PID, process.id() as libc::id_t, &mut info, options) };
        found == 0 && info.si_signo == libc::SIGCHLD
    }
    #[cfg(not(unix))]
    {
        matches!(process.try_wait(), Ok(Some(_)))
    }
}

/// Gives the child a process group of its own, and on Linux its death with the host's; on Windows a group of its own
/// for console events.
fn contain(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
        #[cfg(target_os = "linux")]
        {
            let parent = std::process::id() as libc::pid_t;
            // SAFETY: async-signal-safe calls only, between fork and exec.
            unsafe {
                command.pre_exec(move || {
                    // A signal the JS host answers by ending everything it started, then itself (`host.ts`
                    // `killAll`); as a subreaper, what its plugins started stays its descendant though its parent exits.
                    if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM) != 0
                        || libc::prctl(libc::PR_SET_CHILD_SUBREAPER, 1) != 0
                    {
                        return Err(std::io::Error::last_os_error());
                    }
                    // The host may have died before the call: then nobody would kill the child.
                    if libc::getppid() != parent {
                        libc::_exit(1);
                    }
                    Ok(())
                });
            }
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW);
    }
}

fn write(shared: &Shared, mut writer: channel::Writer) {
    loop {
        let (frame, room) = {
            let mut out = lock(&shared.out);
            loop {
                if let Some(frame) = out.frames.pop_front() {
                    out.bytes -= frame.len();
                    break (Some(frame), std::mem::take(&mut out.wants_room));
                }
                if out.closed {
                    break (None, false);
                }
                out = shared.out_ready.wait(out).unwrap_or_else(|poisoned| poisoned.into_inner());
            }
        };
        let Some(frame) = frame else { break };
        // The queue has room the host waits for: it moves what waits in its overflow.
        if room {
            (shared.wake)();
        }
        if writer.write_all(&frame).and_then(|()| writer.flush()).is_err() {
            break;
        }
    }
    // The end of input, which ends the child.
    writer.end();
}

/// The plugin a message of the JS host is its own, when it names one.
fn owner(up: &Up) -> Option<&str> {
    match up {
        Up::Effects { id, .. }
        | Up::Watch { id, .. }
        | Up::Unwatch { id, .. }
        | Up::Manifest { id, .. }
        | Up::Fail { id, .. }
        | Up::Entered { id: Some(id) }
        | Up::Log { id: Some(id), .. } => Some(id),
        _ => None,
    }
}

/// Queues `event` for the UI thread and wakes it, unless the stream ended. Over a bound, the stream ends instead.
fn deliver(shared: &Shared, event: Event, bytes: usize) -> bool {
    let mut inbox = lock(&shared.inbox);
    if inbox.ended {
        return false;
    }
    let event = match &event {
        Event::Tree(_) => {
            inbox.trees += 1;
            event
        }
        Event::Up(up) if inbox.ordered + 1 > shared.limits.ordered || inbox.bytes + bytes > shared.limits.inbox => {
            let why = format!(
                "the JS host sent over {} messages or {} bytes the host had not taken",
                shared.limits.ordered, shared.limits.inbox
            );
            // The plugin whose own messages are most of them flooded it, this one counted: by their bytes when the
            // bytes overflowed, else by their number.
            let (mut counts, mut sizes) = (inbox.effects.clone(), inbox.sizes.clone());
            if let Some(id) = owner(up) {
                *counts.entry(id.to_owned()).or_default() += 1;
                *sizes.entry(id.to_owned()).or_default() += bytes;
            }
            let (table, total) = match inbox.bytes + bytes > shared.limits.inbox {
                true => (sizes, inbox.bytes + bytes),
                false => (counts, inbox.ordered + 1),
            };
            let most = table.into_iter().max_by_key(|(_, count)| *count);
            Event::Gone(why, most.filter(|(_, count)| count * 2 > total).map(|(id, _)| id))
        }
        Event::Up(up) => {
            inbox.ordered += 1;
            inbox.bytes += bytes;
            if let Some(id) = owner(up) {
                *inbox.effects.entry(id.to_owned()).or_default() += 1;
                *inbox.sizes.entry(id.to_owned()).or_default() += bytes;
            }
            event
        }
        Event::Gone(..) | Event::Hung { .. } | Event::Memory(_) => event,
    };
    inbox.ended |= matches!(event, Event::Gone(..));
    let ended = inbox.ended;
    inbox.events.push_back(event);
    drop(inbox);
    if !shared.pending.swap(true, Ordering::AcqRel) {
        (shared.wake)();
    }
    !ended
}

fn read(shared: &Shared, reader: channel::Reader) {
    let mut input = std::io::BufReader::with_capacity(64 << 10, reader);
    let mut hello = false;
    loop {
        let frame = wire::read(&mut input);
        let gone = |why: String| Event::Gone(why, None);
        let (kind, payload) = match frame {
            Ok(Some(frame)) => frame,
            Ok(None) => {
                deliver(shared, gone(ended(shared, "the JS host exited")), 0);
                return;
            }
            Err(broken) => {
                deliver(shared, gone(ended(shared, &format!("the JS host broke the protocol: {broken}"))), 0);
                return;
            }
        };
        let len = payload.len();
        shared.read.fetch_add(len as u64 + 5, Ordering::Relaxed);
        if kind == wire::TREE {
            shared.read_trees.fetch_add(len as u64 + 5, Ordering::Relaxed);
        }
        let event = match kind {
            wire::TREE => serde_json::from_slice::<Revision>(&payload).map(|tree| Event::Tree(Box::new(tree))),
            _ => serde_json::from_slice::<Up>(&payload).map(|up| Event::Up(Box::new(up))),
        };
        let event = match event {
            Ok(event) => event,
            Err(error) => {
                let why = format!("the JS host sent a message the host cannot read: {error}");
                deliver(shared, gone(why), 0);
                return;
            }
        };
        if !hello {
            match &event {
                Event::Up(up) if matches!(&**up, Up::Hello { magic, version, .. } if magic == MAGIC && *version == VERSION) =>
                {
                    hello = true;
                    shared.hello.store(true, Ordering::Release);
                }
                _ => {
                    let why = format!("the JS host did not start with the protocol's hello (version {VERSION})");
                    deliver(shared, gone(why), 0);
                    return;
                }
            }
        }
        // Anything the JS host sends is progress.
        lock(&shared.sent).progress = Instant::now();
        if let Event::Up(up) = &event
            && let Up::Ack { seq } = **up
        {
            shared.acked.fetch_max(seq, Ordering::AcqRel);
            lock(&shared.sent).events.retain(|(sent, wait, _)| *sent > seq || *wait != Wait::Ack);
            shared.watch.notify_all();
            // It read: what waits in the host's overflow can go.
            if !shared.pending.swap(true, Ordering::AcqRel) {
                (shared.wake)();
            }
            continue;
        }
        if let Event::Up(up) = &event
            && let Up::Started { seq } = **up
        {
            let mut owed = lock(&shared.sent);
            owed.events.iter_mut().filter(|(sent, ..)| *sent == seq).for_each(|(_, _, started)| *started = true);
        }
        if let Event::Up(up) = &event
            && let Up::Done { seq, .. }
            | Up::Loaded { seq, .. }
            | Up::Described { seq, .. }
            | Up::Unsupported { seq }
            | Up::Pong { seq, .. } = &**up
        {
            lock(&shared.sent).events.retain(|(sent, ..)| sent != seq);
            shared.watch.notify_all();
        }
        if matches!(event, Event::Tree(_)) {
            // Backpressure: past the bound of unread trees the child blocks on its own pipe. Until the host takes them,
            // what the child sent after them waits unread: the time is not the child's silence.
            let mut inbox = lock(&shared.inbox);
            let held = inbox.trees >= shared.limits.trees;
            shared.held.store(held, Ordering::Release);
            while inbox.trees >= shared.limits.trees && !shared.closed.load(Ordering::Acquire) {
                inbox = shared.room.wait(inbox).unwrap_or_else(|poisoned| poisoned.into_inner());
            }
            drop(inbox);
            if held {
                lock(&shared.sent).progress = Instant::now();
                shared.held.store(false, Ordering::Release);
            }
        }
        if !deliver(shared, event, len) {
            return;
        }
    }
}

/// Why the child's output ended, with how it exited and its last words, as soon as the system tells them.
fn ended(shared: &Shared, why: &str) -> String {
    let deadline = Instant::now() + Duration::from_millis(100);
    let mut status = None;
    while Instant::now() < deadline {
        // It exited: its group goes with it, and then it is reaped.
        if lock(&shared.process).as_mut().is_some_and(exited) {
            status = kill(shared);
            break;
        }
        std::thread::sleep(Duration::from_millis(2));
    }
    let mut why = why.to_owned();
    if let Some(status) = status {
        why = format!("{why} ({status})");
    }
    let last: Vec<String> = lock(&shared.stderr).iter().rev().take(3).rev().cloned().collect();
    if !last.is_empty() {
        why = format!("{why}: {}", last.join(" / "));
    }
    why
}

fn errors(shared: &Shared, stderr: std::process::ChildStderr) {
    const LINES: usize = 16;
    const LINE: usize = 4096;
    let mut input = BufReader::new(stderr);
    let mut line = Vec::new();
    loop {
        line.clear();
        match std::io::Read::take(&mut input, LINE as u64).read_until(b'\n', &mut line) {
            Ok(0) | Err(_) => return,
            Ok(_) => {}
        }
        let text = String::from_utf8_lossy(&line).trim_end().to_owned();
        if text.is_empty() {
            continue;
        }
        log::warn!("js host: {text}");
        let mut last = lock(&shared.stderr);
        if last.len() == LINES {
            last.pop_front();
        }
        last.push_back(text);
    }
}

/// What marks, on standard output, whose code the JS host runs from then on: the plugin's ID as JSON, or `null`, up to
/// a NUL (`host.ts` `own`). What a plugin writes with `fs.writeSync(1, …)` while its code runs comes after its mark, as
/// writes to one descriptor from one thread keep their order.
const OWNER: &[u8] = b"\0OPENCODE_JS_HOST_OWNER ";

/// The most records of standard output logged in a second, the most bytes logged for one JS host, and the most of a
/// record's bytes shown.
const STRAY_LINES: u32 = 10;
const STRAY_TOTAL: u64 = 64 << 10;
const STRAY_SHOWN: usize = 200;

/// Logs what the child's plugins write to standard output, which is not the protocol and reaches no terminal (TS sends
/// it to the terminal; deviation F16): by the plugin whose code ran then, when the JS host marked one, at most
/// [`STRAY_LINES`] records a second and [`STRAY_TOTAL`] bytes in all, the rest counted.
fn stray(shared: &Shared, mut stdout: ChildStdout) {
    let mut log = Stray::default();
    let mut buffer = vec![0; 16 << 10];
    let mut pending = Vec::new();
    loop {
        let read = match std::io::Read::read(&mut stdout, &mut buffer) {
            Ok(0) | Err(_) => break,
            Ok(read) => read,
        };
        pending.extend_from_slice(&buffer[..read]);
        log.take(&mut pending);
        log.record();
        log.flush(shared);
    }
    log.bytes.append(&mut pending);
    log.record();
    log.flush(shared);
}

/// What [`stray`] reads: whose code runs, its bytes not recorded yet, the records not logged yet, and the bounds'
/// counts.
struct Stray {
    owner: Option<String>,
    bytes: Vec<u8>,
    records: Vec<String>,
    logged: u64,
    window: Instant,
    lines: u32,
    dropped: u64,
    capped: bool,
}

impl Default for Stray {
    fn default() -> Self {
        Self {
            owner: None,
            bytes: Vec::new(),
            records: Vec::new(),
            logged: 0,
            window: Instant::now(),
            lines: 0,
            dropped: 0,
            capped: false,
        }
    }
}

impl Stray {
    /// Splits what `pending` holds by the marks in it; what may be the start of a mark stays in it.
    fn take(&mut self, pending: &mut Vec<u8>) {
        loop {
            let Some(at) = pending.windows(OWNER.len()).position(|window| window == OWNER) else {
                // The longest end that could begin a mark waits for the next read.
                let keep = (1..OWNER.len().min(pending.len() + 1))
                    .rev()
                    .find(|keep| pending.ends_with(&OWNER[..*keep]))
                    .unwrap_or(0);
                self.bytes.extend(pending.drain(..pending.len() - keep));
                return;
            };
            let Some(end) = pending[at + OWNER.len()..].iter().position(|byte| *byte == 0) else {
                self.bytes.extend(pending.drain(..at));
                // A mark is short: one that does not end is a plugin's bytes.
                if pending.len() > 4096 {
                    self.bytes.extend(pending.drain(..1));
                    continue;
                }
                return;
            };
            let owner = serde_json::from_slice::<Option<String>>(&pending[at + OWNER.len()..at + OWNER.len() + end]);
            self.bytes.extend(pending.drain(..at));
            pending.drain(..OWNER.len() + end + 1);
            let owner = owner.unwrap_or(None);
            if owner != self.owner {
                self.record();
                self.owner = owner;
            }
        }
    }

    /// Logs the records made.
    fn flush(&mut self, shared: &Shared) {
        for record in self.records.drain(..) {
            log::warn!("js host: {record}");
            let mut last = lock(&shared.stray);
            if last.len() == 16 {
                last.pop_front();
            }
            last.push_back(record);
        }
    }

    /// Records the bytes kept, which go, unless a bound holds them back; then they are counted.
    fn record(&mut self) {
        if let Some(record) = self.made() {
            self.records.push(record);
        }
    }

    fn made(&mut self) -> Option<String> {
        if self.bytes.is_empty() {
            return None;
        }
        let bytes = std::mem::take(&mut self.bytes);
        let now = Instant::now();
        if now.duration_since(self.window) >= Duration::from_secs(1) {
            (self.window, self.lines) = (now, 0);
        }
        if self.logged >= STRAY_TOTAL {
            self.dropped += bytes.len() as u64;
            if !std::mem::replace(&mut self.capped, true) {
                return Some(format!(
                    "plugins wrote over {STRAY_TOTAL} bytes to standard output; what follows is not logged"
                ));
            }
            return None;
        }
        if self.lines >= STRAY_LINES {
            self.dropped += bytes.len() as u64;
            return None;
        }
        self.lines += 1;
        self.logged += bytes.len() as u64;
        let who = match &self.owner {
            Some(id) => format!("plugin {id}"),
            None => "a plugin (the JS host ran none's code as it was written, so it is not named)".to_owned(),
        };
        let mut shown: String =
            String::from_utf8_lossy(&bytes[..bytes.len().min(STRAY_SHOWN)]).escape_debug().collect();
        if bytes.len() > STRAY_SHOWN {
            shown.push('…');
        }
        let before = match std::mem::take(&mut self.dropped) {
            0 => String::new(),
            dropped => format!(" ({dropped} bytes before it were not logged)"),
        };
        Some(format!(
            "{who} wrote {} bytes to standard output, which reaches no terminal here{before}: \"{shown}\"",
            bytes.len()
        ))
    }
}

/// The protocol's connection with the child: one stream both ways, whose other end is the child's standard input, so
/// its standard output is free for what plugins write there (js-stdio). The child owns its end by construction: it is
/// made for it, and no name or path leads to it but its own descriptor.
mod channel {
    use std::process::Stdio;

    #[cfg(unix)]
    pub(super) struct Reader(std::os::unix::net::UnixStream);
    #[cfg(unix)]
    pub(super) struct Writer(std::os::unix::net::UnixStream);

    /// A socket pair: this process's reader and writer of one end, and the other end for the child's standard input.
    #[cfg(unix)]
    pub(super) fn open() -> std::io::Result<(Reader, Writer, Stdio)> {
        let (ours, theirs) = std::os::unix::net::UnixStream::pair()?;
        // A pipe's room either way, whatever a socket's default (8 KiB on macOS).
        for stream in [&ours, &theirs] {
            for option in [libc::SO_SNDBUF, libc::SO_RCVBUF] {
                let size: libc::c_int = 64 << 10;
                // SAFETY: a plain option of an open socket, the value's size given.
                unsafe {
                    libc::setsockopt(
                        std::os::fd::AsRawFd::as_raw_fd(stream),
                        libc::SOL_SOCKET,
                        option,
                        std::ptr::from_ref(&size).cast(),
                        size_of::<libc::c_int>() as libc::socklen_t,
                    );
                }
            }
        }
        Ok((Reader(ours.try_clone()?), Writer(ours), Stdio::from(std::os::fd::OwnedFd::from(theirs))))
    }

    #[cfg(unix)]
    impl Writer {
        /// The end of the child's input; what it still writes is read.
        pub(super) fn end(self) {
            let _ = self.0.shutdown(std::net::Shutdown::Write);
        }
    }

    #[cfg(windows)]
    pub(super) struct Reader(std::sync::Arc<opencode_util::win::Duplex>);
    #[cfg(windows)]
    pub(super) struct Writer(std::sync::Arc<opencode_util::win::Duplex>);

    /// A duplex named pipe ([`opencode_util::win::duplex`]): its end here, read and written apart, and the child's end.
    #[cfg(windows)]
    pub(super) fn open() -> std::io::Result<(Reader, Writer, Stdio)> {
        let (duplex, theirs) = opencode_util::win::duplex()?;
        let duplex = std::sync::Arc::new(duplex);
        Ok((Reader(duplex.clone()), Writer(duplex), Stdio::from(theirs)))
    }

    #[cfg(windows)]
    impl Writer {
        /// The end of the child's input. A named pipe has no half-close: it ends both ways, once the host wants nothing
        /// more of the child.
        pub(super) fn end(self) {
            self.0.disconnect();
        }
    }

    impl std::io::Read for Reader {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            #[cfg(unix)]
            return std::io::Read::read(&mut self.0, buffer);
            #[cfg(windows)]
            return self.0.read(buffer);
        }
    }

    impl std::io::Write for Writer {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            #[cfg(unix)]
            return std::io::Write::write(&mut self.0, bytes);
            #[cfg(windows)]
            return self.0.write(bytes);
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
}

fn watch(shared: &Shared) {
    // The progress a hang was named at, so one silence is named once.
    let mut named = None;
    let mut memory_told = false;
    let mut polled = Instant::now();
    let mut owed = lock(&shared.sent);
    loop {
        if shared.closed.load(Ordering::Acquire) {
            return;
        }
        let now = Instant::now();
        let mut wait = shared.limits.poll.saturating_sub(now - polled);
        // While the reader waits for the host to take its trees, the JS host's answers wait unread behind them.
        if shared.held.load(Ordering::Acquire) {
            owed.progress = now;
        }
        if !owed.events.is_empty() {
            // The JS host's start and a setup that started may take the setup's time; anything else, the limit.
            let setup = !shared.hello.load(Ordering::Acquire)
                || owed.events.iter().any(|(_, wait, started)| *started && *wait == Wait::Setup);
            let limit = if setup { shared.limits.setup } else { shared.limits.ack };
            let due = owed.progress + limit;
            if now >= due && named != Some(owed.progress) {
                named = Some(owed.progress);
                // The event it was running, if it said, else the oldest it owes.
                let running = owed.events.iter().find(|(.., started)| *started).or(owed.events.front());
                let seq = running.map_or(0, |(seq, ..)| *seq);
                drop(owed);
                deliver(shared, Event::Hung { seq }, 0);
                owed = lock(&shared.sent);
                continue;
            }
            wait = wait.min(due.saturating_duration_since(now).max(Duration::from_millis(1)));
        }
        if now.duration_since(polled) >= shared.limits.poll {
            polled = now;
            drop(owed);
            if let Some(rss) = resident(shared).filter(|rss| *rss > shared.limits.memory)
                && !memory_told
            {
                memory_told = true;
                deliver(shared, Event::Memory(rss), 0);
            }
            owed = lock(&shared.sent);
            continue;
        }
        owed = shared.watch.wait_timeout(owed, wait).map_or_else(|poisoned| poisoned.into_inner().0, |(owed, _)| owed);
    }
}

/// The resident set of the child, in bytes.
fn resident(shared: &Shared) -> Option<u64> {
    // Once reaped, its ID may name another process.
    lock(&shared.process).as_ref()?;
    #[cfg(target_os = "linux")]
    {
        let status = std::fs::read_to_string(format!("/proc/{}/status", shared.pid)).ok()?;
        let line = status.lines().find(|line| line.starts_with("VmRSS:"))?;
        let kib: u64 = line.split_whitespace().nth(1)?.parse().ok()?;
        Some(kib * 1024)
    }
    #[cfg(target_os = "macos")]
    {
        // SAFETY: `proc_pidinfo` writes at most the size given into `info`, a plain struct.
        unsafe {
            let mut info: libc::proc_taskinfo = std::mem::zeroed();
            let size = std::mem::size_of::<libc::proc_taskinfo>() as libc::c_int;
            let wrote = libc::proc_pidinfo(
                shared.pid as libc::c_int,
                libc::PROC_PIDTASKINFO,
                0,
                std::ptr::from_mut(&mut info).cast(),
                size,
            );
            (wrote == size).then_some(info.pti_resident_size)
        }
    }
    #[cfg(windows)]
    {
        lock(&shared.process).as_ref().and_then(opencode_util::win::process_resident).map(|bytes| bytes as u64)
    }
    #[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
    {
        let _ = shared;
        None
    }
}

#[cfg(test)]
mod stray_tests {
    use super::*;

    fn mark(id: Option<&str>) -> Vec<u8> {
        [OWNER, serde_json::to_string(&id).unwrap().as_bytes(), b"\0"].concat()
    }

    /// The records of `chunks` read one at a time, as [`stray`] reads them.
    fn records(chunks: &[Vec<u8>]) -> Vec<String> {
        let (mut log, mut pending, mut records) = (Stray::default(), Vec::new(), Vec::new());
        for chunk in chunks {
            pending.extend_from_slice(chunk);
            log.take(&mut pending);
            log.record();
            records.append(&mut log.records);
        }
        log.bytes.append(&mut pending);
        log.record();
        records.append(&mut log.records);
        records
    }

    // Expected (js-stdio): bytes are recorded by the plugin whose mark comes before them, a `null` mark names nobody, and
    // the records of several owners in one read are each kept; a mark cut across reads is still one mark, and bytes that
    // only look like the start of one are a plugin's.
    #[test]
    fn standard_output_is_recorded_by_the_plugin_marked() {
        let osc = b"\x1b]11;rgb:10/20/30\x07".to_vec();
        let one =
            [mark(Some("bg-sync")), osc.clone(), mark(None), b"timer\n".to_vec(), mark(Some("other")), b"x".to_vec()]
                .concat();
        let found = records(std::slice::from_ref(&one));
        assert_eq!(found.len(), 3, "{found:?}");
        assert!(found[0].starts_with("plugin bg-sync wrote 18 bytes"), "{found:?}");
        assert!(found[0].ends_with(r#": "\u{1b}]11;rgb:10/20/30\u{7}""#), "{found:?}");
        assert!(found[1].starts_with("a plugin (the JS host ran none's code"), "{found:?}");
        assert!(found[2].starts_with("plugin other wrote 1 bytes"), "{found:?}");
        // The same bytes in two reads, cut anywhere: in a mark too.
        let total = |found: &[String], who: &str| -> usize {
            found
                .iter()
                .filter(|record| record.starts_with(who))
                .map(|record| {
                    record.split(" wrote ").nth(1).unwrap().split(' ').next().unwrap().parse::<usize>().unwrap()
                })
                .sum()
        };
        for cut in 0..=one.len() {
            let found = records(&[one[..cut].to_vec(), one[cut..].to_vec()]);
            assert_eq!(total(&found, "plugin bg-sync"), 18, "{cut}: {found:?}");
            assert_eq!(total(&found, "a plugin"), 6, "{cut}: {found:?}");
            assert_eq!(total(&found, "plugin other"), 1, "{cut}: {found:?}");
            assert!(found.iter().all(|record| !record.contains("OPENCODE_JS_HOST_OWNER")), "{cut}: {found:?}");
        }
        // The start of a mark that never comes is the plugin's own.
        let found = records(&[b"a\0OPENCODE_JS".to_vec()]);
        assert_eq!(total(&found, "a plugin"), 13, "{found:?}");
    }

    // Expected (js-stdio): at most `STRAY_LINES` records a second are logged and `STRAY_TOTAL` bytes in all; what a bound
    // holds back is counted, said with the next record, and once the total is past, said once.
    #[test]
    fn standard_output_is_logged_within_its_bounds() {
        let mut log = Stray::default();
        let mut made = Vec::new();
        for _ in 0..STRAY_LINES + 5 {
            log.bytes.extend(b"line\n");
            log.record();
            made.append(&mut log.records);
        }
        assert_eq!(made.len(), STRAY_LINES as usize);
        log.window -= Duration::from_secs(1);
        log.bytes.extend(b"again\n");
        log.record();
        assert!(log.records[0].contains("(25 bytes before it were not logged)"), "{:?}", log.records);
        log.records.clear();
        log.window -= Duration::from_secs(1);
        log.lines = 0;
        log.bytes = vec![b'x'; STRAY_TOTAL as usize];
        log.record();
        log.window -= Duration::from_secs(1);
        log.lines = 0;
        for _ in 0..3 {
            log.bytes.extend(b"more");
            log.record();
        }
        assert_eq!(log.records.len(), 2, "{:?}", log.records);
        assert!(log.records[0].contains('…'));
        assert!(log.records[1].contains("what follows is not logged"), "{:?}", log.records);
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::pipe::proto::Up;
    use opencode_plugin_abi::{HostRequest, Level};

    /// A child that writes `frames` to its output and then waits for its input to end, as the JS host does.
    fn fake(frames: &[u8], limits: Limits) -> (Child, opencode_util::temp::TempDir) {
        let dir = opencode_util::temp::tempdir().unwrap();
        let file = dir.path().join("frames");
        std::fs::write(&file, frames).unwrap();
        let mut command = Command::new("sh");
        command.arg("-c").arg(format!("cat '{}' >&0; cat > /dev/null", file.display()));
        (Child::spawn(command, limits, || {}).unwrap(), dir)
    }

    fn control(up: &Up) -> Vec<u8> {
        wire::encode(wire::CONTROL, &serde_json::to_vec(up).unwrap())
    }

    fn hello() -> Vec<u8> {
        control(&Up::Hello { magic: MAGIC.to_owned(), version: VERSION, pid: 0 })
    }

    fn tree(rev: u64) -> Vec<u8> {
        let tree = serde_json::json!({
            "id": "p", "mount": { "surface": "s", "key": "k", "generation": 1 }, "rev": rev, "base": 0, "epoch": 0,
            "node": { "type": "text", "spans": [] },
        });
        wire::encode(wire::TREE, &serde_json::to_vec(&tree).unwrap())
    }

    /// Takes events until `done` says so, or two seconds pass; all it took.
    fn take_until(child: &Child, done: impl Fn(&[Event]) -> bool) -> Vec<Event> {
        let (mut events, begun) = (Vec::new(), Instant::now());
        while !done(&events) && begun.elapsed() < Duration::from_secs(2) {
            events.extend(child.take());
            std::thread::sleep(Duration::from_millis(2));
        }
        events
    }

    fn gone(events: &[Event]) -> Option<&str> {
        events.iter().find_map(|event| match event {
            Event::Gone(why, _) => Some(why.as_str()),
            _ => None,
        })
    }

    // Expected (overflow-flake): a send refused for the queue's bound wakes the host once the writer takes a frame, also
    // when the child answers nothing it reads, so the host's overflow moves on. Before, only the child's output woke the
    // host: a full queue whose frames brought no answer, or whose answer came in the same turn as the drain, stranded the
    // overflow while the child waited for input.
    #[test]
    fn a_full_queue_wakes_the_host_once_it_has_room() {
        let dir = opencode_util::temp::tempdir().unwrap();
        let file = dir.path().join("frames");
        std::fs::write(&file, hello()).unwrap();
        // It says hello, reads nothing for a while, then reads all and says nothing.
        let mut command = Command::new("sh");
        command.arg("-c").arg(format!("cat '{}' >&0; sleep 0.3; cat > /dev/null", file.display()));
        let wakes = Arc::new(AtomicU64::new(0));
        let woken = wakes.clone();
        let limits = Limits { queued: 4 << 10, ..Limits::default() };
        let child = Child::spawn(command, limits, move || {
            woken.fetch_add(1, Ordering::SeqCst);
        })
        .unwrap();
        // Its hello woke the host once, which takes it.
        assert!(!take_until(&child, |events| !events.is_empty()).is_empty(), "no hello");
        let payload = vec![b'x'; 1 << 10];
        // Nothing wakes the host while the queue fills: the count before the refusal is the one the wake must pass, which
        // the writer may give at once (bigboi's pipe pass).
        let before = wakes.load(Ordering::SeqCst);
        // The child's input and the queue fill: the OS pipe's buffer, then the queue's bound.
        let full =
            (0..10_000).find(|_| matches!(child.send(wire::CONTROL, &payload, None, Wait::Ack), Err(Refused::Full)));
        assert!(full.is_some(), "the queue never filled");
        let begun = Instant::now();
        while wakes.load(Ordering::SeqCst) == before && begun.elapsed() < Duration::from_secs(2) {
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(wakes.load(Ordering::SeqCst) > before, "the host was not woken when the queue had room");
    }

    // Expected (review F4): a child whose first message is not the protocol's hello is refused, before anything of it
    // reaches the host.
    #[test]
    fn a_child_that_does_not_say_hello_is_refused() {
        let mut frames = control(&Up::Pong { seq: 1, waiting: false });
        frames.extend(hello());
        let (child, _dir) = fake(&frames, Limits::default());
        let events = take_until(&child, |events| gone(events).is_some());
        assert!(gone(&events).is_some_and(|why| why.contains("hello")), "{events:?}");
        assert_eq!(events.len(), 1, "{events:?}");
    }

    // Expected (the bound on ordered messages): the bound's worth of messages the host has not taken is held; one more
    // ends the stream, naming the plugin whose effects were most of them.
    #[test]
    fn ordered_messages_past_the_bound_end_the_stream() {
        let limits = Limits { ordered: 8, ..Limits::default() };
        let effects = |id: &str| control(&Up::Effects { id: id.to_owned(), seq: 1, effects: Vec::new() });
        // With the hello and the quiet one: 8 messages, then 9.
        for (count, ends) in [(6, false), (7, true)] {
            let mut frames = hello();
            frames.extend(effects("quiet"));
            (0..count).for_each(|_| frames.extend(effects("loud")));
            let (child, _dir) = fake(&frames, limits);
            std::thread::sleep(Duration::from_millis(300));
            let events = child.take();
            let why = events.iter().find_map(|event| match event {
                Event::Gone(why, plugin) => Some((why.clone(), plugin.clone())),
                _ => None,
            });
            match ends {
                false => assert!(why.is_none(), "{count}: {events:?}"),
                true => assert_eq!(why.map(|(_, plugin)| plugin), Some(Some("loud".to_owned())), "{count}"),
            }
        }
        // The start of the code a plugin runs for the answers of its effects is its own too: a flood of effects with
        // each answered is still the plugin's (P8). Of the 16 held, 5 are its effects and 5 the starts of its code.
        let entered = |id: Option<&str>| control(&Up::Entered { id: id.map(str::to_owned) });
        let mut frames = hello();
        frames.extend(effects("quiet"));
        for _ in 0..5 {
            frames.extend(effects("loud"));
            frames.extend(entered(Some("loud")));
            frames.extend(entered(None));
        }
        let (child, _dir) = fake(&frames, Limits { ordered: 16, ..Limits::default() });
        std::thread::sleep(Duration::from_millis(300));
        let blamed = child.take().into_iter().find_map(|event| match event {
            Event::Gone(_, plugin) => Some(plugin),
            _ => None,
        });
        assert_eq!(blamed, Some(Some("loud".to_owned())));
        // Watches and logs name their plugin too (carbon-5), and a flood of bytes is blamed on the plugin whose bytes
        // are most of them, the one that overflowed counted, though another sent more messages.
        let watch = |id: &str, key: &str| {
            control(&Up::Watch { id: id.to_owned(), key: key.to_owned(), request: HostRequest::Route })
        };
        let mut frames = hello();
        (0..9).for_each(|index| frames.extend(watch("watcher", &format!("k{index}"))));
        let (child, _dir) = fake(&frames, limits);
        std::thread::sleep(Duration::from_millis(300));
        let blamed = child.take().into_iter().find_map(|event| match event {
            Event::Gone(_, plugin) => Some(plugin),
            _ => None,
        });
        assert_eq!(blamed, Some(Some("watcher".to_owned())));
        let log = |id: &str, size: usize| {
            control(&Up::Log { id: Some(id.to_owned()), level: Level::Info, message: "x".repeat(size) })
        };
        let mut frames = hello();
        (0..6).for_each(|_| frames.extend(log("chatty", 10)));
        frames.extend(log("heavy", 2000));
        let (child, _dir) = fake(&frames, Limits { inbox: 2048, ..limits });
        std::thread::sleep(Duration::from_millis(300));
        let blamed = child.take().into_iter().find_map(|event| match event {
            Event::Gone(_, plugin) => Some(plugin),
            _ => None,
        });
        assert_eq!(blamed, Some(Some("heavy".to_owned())));
    }

    // Expected (the flood of trees, S2): past the bound of trees the host has not taken, the reader stops reading, so
    // no more are held; once the host takes them, the rest come, every one.
    #[test]
    fn unread_trees_hold_the_reader_back() {
        let limits = Limits { trees: 4, ..Limits::default() };
        let mut frames = hello();
        (1..=20).for_each(|rev| frames.extend(tree(rev)));
        let (child, _dir) = fake(&frames, limits);
        std::thread::sleep(Duration::from_millis(300));
        let first = child.take();
        let trees = |events: &[Event]| events.iter().filter(|event| matches!(event, Event::Tree(_))).count();
        assert_eq!(trees(&first), 4, "{first:?}");
        let rest = take_until(&child, |events| trees(events) >= 16);
        assert_eq!(trees(&rest), 16);
    }

    // Expected (4.3, review F9): an acknowledgement is not progress: an event that waits for its answer is late at the
    // limit though it was acknowledged; one that waits only for its acknowledgement is not.
    #[test]
    fn an_acknowledged_handler_that_never_answers_is_late() {
        let limits = Limits { ack: Duration::from_millis(100), ..Limits::default() };
        for (wait, late) in [(Wait::Ack, false), (Wait::Answer, true)] {
            // The child acknowledges once it read the event, never before it was sent.
            let dir = opencode_util::temp::tempdir().unwrap();
            let (hello_file, ack_file) = (dir.path().join("hello"), dir.path().join("ack"));
            std::fs::write(&hello_file, hello()).unwrap();
            std::fs::write(&ack_file, control(&Up::Ack { seq: 1 })).unwrap();
            let script = format!(
                "cat '{}' >&0; head -c 7 > /dev/null; cat '{}' >&0; cat > /dev/null",
                hello_file.display(),
                ack_file.display()
            );
            let mut command = Command::new("sh");
            command.arg("-c").arg(script);
            let child = Child::spawn(command, limits, || {}).unwrap();
            child.send(wire::CONTROL, b"{}", Some(1), wait).unwrap();
            let events = take_until(&child, |events| events.iter().any(|event| matches!(event, Event::Hung { .. })));
            let hung = events.iter().any(|event| matches!(event, Event::Hung { seq: 1 }));
            assert_eq!(hung, late, "{wait:?}: {events:?}");
        }
    }

    // Expected (FT-1): an answer the JS host sent behind more trees than the host takes unread is not late while the host
    // does not take them, however long that is: the time is the host's, not the JS host's. Once taken, it is read.
    #[test]
    fn an_answer_behind_unread_trees_is_not_late() {
        let limits = Limits { ack: Duration::from_millis(100), trees: 2, ..Limits::default() };
        let dir = opencode_util::temp::tempdir().unwrap();
        let (hello_file, answer_file) = (dir.path().join("hello"), dir.path().join("answer"));
        std::fs::write(&hello_file, hello()).unwrap();
        let mut answer: Vec<u8> = (1..=4).flat_map(tree).collect();
        answer.extend(control(&Up::Done { seq: 1, effects: Vec::new(), error: None }));
        std::fs::write(&answer_file, answer).unwrap();
        // It answers once it read the event, never before it was sent.
        let script = format!(
            "cat '{}' >&0; head -c 7 > /dev/null; cat '{}' >&0; cat > /dev/null",
            hello_file.display(),
            answer_file.display()
        );
        let mut command = Command::new("sh");
        command.arg("-c").arg(script);
        let child = Child::spawn(command, limits, || {}).unwrap();
        child.send(wire::CONTROL, b"{}", Some(1), Wait::Answer).unwrap();
        // The host takes nothing for well past the limit.
        std::thread::sleep(Duration::from_millis(500));
        let events = take_until(&child, |events| {
            events.iter().any(|event| matches!(event, Event::Up(up) if matches!(**up, Up::Done { seq: 1, .. })))
        });
        assert!(!events.iter().any(|event| matches!(event, Event::Hung { .. })), "{events:?}");
    }

    // Expected: the JS host's start, until its hello, may take the setup's time, not the limit of an event, though the
    // host owes events sent before it: a machine under load starts Bun and its modules slowly. A start past the setup's
    // time is a hang.
    #[test]
    fn a_slow_start_is_not_a_hang() {
        for (setup, hung) in [(Duration::from_secs(5), false), (Duration::from_millis(200), true)] {
            let limits = Limits { ack: Duration::from_millis(100), setup, ..Limits::default() };
            let dir = opencode_util::temp::tempdir().unwrap();
            let (hello_file, ack_file) = (dir.path().join("hello"), dir.path().join("ack"));
            std::fs::write(&hello_file, hello()).unwrap();
            std::fs::write(&ack_file, control(&Up::Ack { seq: 1 })).unwrap();
            let script = format!(
                "sleep 0.6; cat '{}' >&0; head -c 7 > /dev/null; cat '{}' >&0; cat > /dev/null",
                hello_file.display(),
                ack_file.display()
            );
            let mut command = Command::new("sh");
            command.arg("-c").arg(script);
            let child = Child::spawn(command, limits, || {}).unwrap();
            child.send(wire::CONTROL, b"{}", Some(1), Wait::Ack).unwrap();
            let begun = Instant::now();
            let events = take_until(&child, |_| child.acked() == 1 && begun.elapsed() > Duration::from_millis(800));
            let late = events.iter().any(|event| matches!(event, Event::Hung { seq: 1 }));
            assert_eq!(late, hung, "setup {setup:?}: {events:?}");
        }
    }

    /// Not a row: the client that the next row kills outright. It starts a child that loops and never reads, prints its
    /// process ID, and waits to be killed.
    #[test]
    fn a_client_that_is_killed() {
        if std::env::var_os("PIPE_KILLED_CLIENT").is_none() {
            return;
        }
        let mut command = Command::new("sh");
        command.arg("-c").arg("while :; do :; done");
        let child = Child::spawn(command, Limits::default(), || {}).unwrap();
        println!("\nchild {} .", child.pid());
        std::thread::sleep(Duration::from_secs(30));
    }

    // Expected (review bigboi-9, Linux): a child the client started dies when the client is killed outright, with no
    // destructor and no reaper, though it is busy and reads nothing (`PR_SET_PDEATHSIG`). The JS host's
    // descendants are `plugin_pipe`'s row; neither macOS nor Windows runs this.
    #[cfg(target_os = "linux")]
    #[test]
    fn a_busy_child_dies_with_a_client_killed_outright() {
        use std::io::BufRead;
        let mut client = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "pipe::child::tests::a_client_that_is_killed", "--nocapture", "--test-threads=1"])
            .env("PIPE_KILLED_CLIENT", "1")
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let mut lines = std::io::BufReader::new(client.stdout.take().unwrap()).lines();
        let pid: u32 =
            lines.find_map(|line| line.ok()?.rsplit_once("child ")?.1.split(' ').next()?.parse().ok()).unwrap();
        assert!(std::path::Path::new(&format!("/proc/{pid}")).exists());
        // SAFETY: a signal to the client this test started.
        unsafe { libc::kill(client.id() as libc::pid_t, libc::SIGKILL) };
        client.wait().unwrap();
        let begun = Instant::now();
        while std::path::Path::new(&format!("/proc/{pid}")).exists() && begun.elapsed() < Duration::from_secs(5) {
            std::thread::sleep(Duration::from_millis(10));
        }
        // A zombie is gone too: its parent, the init process, reaps it.
        let state = std::fs::read_to_string(format!("/proc/{pid}/stat")).unwrap_or_default();
        assert!(state.is_empty() || state.contains(") Z "), "the child {pid} outlived its client: {state}");
    }

    // Expected (review carbon-6): telling that a child exited does not reap it: its ID names it, a zombie, until the
    // group is signalled and it is waited for.
    #[cfg(target_os = "linux")]
    #[test]
    fn telling_a_child_exited_does_not_reap_it() {
        let mut process = Command::new("sh").arg("-c").arg("exit 3").spawn().unwrap();
        let begun = Instant::now();
        while !exited(&mut process) {
            assert!(begun.elapsed() < Duration::from_secs(5), "the child never exited");
            std::thread::sleep(Duration::from_millis(5));
        }
        let state = std::fs::read_to_string(format!("/proc/{}/stat", process.id())).unwrap_or_default();
        assert!(state.contains(") Z "), "telling it exited reaped it: {state:?}");
        assert_eq!(process.wait().unwrap().code(), Some(3));
    }

    // Expected (review carbon-9, CM11): messages past the bytes the host has not taken end the stream, however few they
    // are, and name the plugin whose effects they are.
    #[test]
    fn messages_past_the_inbox_bytes_end_the_stream() {
        let limits = Limits { inbox: 64 << 10, ..Limits::default() };
        let request = opencode_plugin_abi::HostRequest::Log {
            level: opencode_plugin_abi::Level::Info,
            message: "x".repeat(20 << 10),
        };
        let effects = control(&Up::Effects { id: "loud".to_owned(), seq: 1, effects: vec![request] });
        for (count, ends) in [(2, false), (4, true)] {
            let mut frames = hello();
            (0..count).for_each(|_| frames.extend(&effects));
            let (child, _dir) = fake(&frames, limits);
            std::thread::sleep(Duration::from_millis(300));
            let why = child.take().into_iter().find_map(|event| match event {
                Event::Gone(_, plugin) => Some(plugin),
                _ => None,
            });
            assert_eq!(why, ends.then(|| Some("loud".to_owned())), "{count}");
        }
    }

    // Expected: a send past the bytes the queue holds is refused at once; the child is not waited for.
    #[test]
    fn a_full_queue_refuses() {
        let limits = Limits { queued: 64, ..Limits::default() };
        let mut command = Command::new("sh");
        // A child that never reads its input.
        command.arg("-c").arg("sleep 5");
        let child = Child::spawn(command, limits, || {}).unwrap();
        let payload = vec![b' '; 40];
        let sends: Vec<bool> = (0..200).map(|_| child.send(wire::CONTROL, &payload, None, Wait::Ack).is_ok()).collect();
        assert!(sends.iter().any(|sent| !sent), "the queue never filled");
        child.kill();
    }
}
