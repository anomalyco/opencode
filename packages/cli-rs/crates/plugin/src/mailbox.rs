//! A bounded queue from plugin workers to the UI thread. `send` never blocks; replacing by key updates the pending
//! entry in place.

use std::cell::RefCell;
use std::collections::VecDeque;
use std::sync::Weak;
use std::sync::{Arc, Mutex, PoisonError};

use opencode_plugin_abi::mail::{Link, Message, Outgoing, Refused};

use crate::abi;
use crate::activation::Wake;

/// What a mailbox has seen, for the plugin manager and the tests.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Stats {
    /// Entries waiting now.
    pub waiting: usize,
    /// The most entries it held at once.
    pub high: usize,
    /// Sends refused as `Full`.
    pub refused: u64,
    pub closed: bool,
    /// A thread's panic report waits, to be taken after the messages put in before it.
    pub reported: bool,
}

/// The longest panic report the host keeps, in bytes.
pub(crate) const REPORT: usize = 4096;

pub(crate) struct Mailbox {
    state: Mutex<State>,
    wake: Arc<Wake>,
    /// Budget for queued message bytes and keys.
    bytes: u64,
}

#[derive(Default)]
struct State {
    /// The messages that wait, each with its key and its place: how many were put in before it.
    entries: VecDeque<(Option<String>, Message, u64)>,
    /// The messages put in so far; a replaced one keeps its place.
    put: u64,
    closed: bool,
    /// The plugin registered no message handler: a message is `Closed`, though the plugin is active.
    refusing: bool,
    /// The first panic report, and the place it took: the messages put in before it go first.
    panic: Option<(String, u64)>,
    /// The bytes of the messages and keys that wait ([`Mailbox::bytes`]).
    held: u64,
    high: usize,
    refused: u64,
}

thread_local! {
    /// The mailbox of each plugin's current activation on this thread, by plugin ID: one row an ID.
    static MAILBOXES: RefCell<Vec<(String, Weak<Mailbox>)>> = RefCell::default();
}

/// What the mailbox of plugin `id`'s current activation has seen, if it has one: a failed, disabled or unloaded plugin
/// has none.
pub fn stats(id: &str) -> Option<Stats> {
    MAILBOXES.with(|boxes| {
        let boxes = boxes.borrow();
        let found = boxes.iter().find(|(known, _)| known == id).and_then(|(_, mailbox)| mailbox.upgrade());
        found.map(|mailbox| mailbox.stats())
    })
}

/// The mailbox of plugin `id`'s current activation, for the model that reaches into it.
#[cfg(test)]
pub(crate) fn current(id: &str) -> Option<Arc<Mailbox>> {
    MAILBOXES
        .with(|boxes| boxes.borrow().iter().find(|(known, _)| known == id).and_then(|(_, mailbox)| mailbox.upgrade()))
}

/// The rows the registry holds, for the test that toggles a plugin many times.
#[cfg(test)]
pub(crate) fn rows() -> usize {
    MAILBOXES.with(|boxes| boxes.borrow().len())
}

impl Mailbox {
    pub fn new(id: &str, wake: Arc<Wake>) -> Arc<Self> {
        let bytes = crate::limits::get().plugin_content;
        let mailbox = Arc::new(Self { state: Mutex::default(), wake, bytes });
        MAILBOXES.with(|boxes| {
            let mut boxes = boxes.borrow_mut();
            boxes.retain(|(known, mailbox)| known != id && mailbox.strong_count() > 0);
            boxes.push((id.to_owned(), Arc::downgrade(&mailbox)));
        });
        mailbox
    }

    pub fn wake(&self) -> &Arc<Wake> {
        &self.wake
    }

    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Puts `message` in, under `key` or at the end, and wakes the UI thread; or hands it back. A message it replaces
    /// is dropped once the lock is released.
    pub fn put(&self, key: Option<&str>, message: Message) -> Result<(), (Refused, Message)> {
        let key = key.filter(|key| !key.is_empty());
        let replaced = {
            let mut state = self.state();
            if state.closed || state.refusing {
                return Err((Refused::Closed, message));
            }
            let waiting =
                key.and_then(|key| state.entries.iter().position(|(known, ..)| known.as_deref() == Some(key)));
            let size = size(key, &message);
            let freed = waiting.map_or(0, |index| size_of(&state.entries[index]));
            if state.held - freed + size > self.bytes {
                state.refused += 1;
                return Err((Refused::Full, message));
            }
            state.held = state.held - freed + size;
            match waiting {
                Some(index) => Some(std::mem::replace(&mut state.entries[index].1, message)),
                None if state.entries.len() >= abi::BOUND => {
                    state.held -= size;
                    state.refused += 1;
                    return Err((Refused::Full, message));
                }
                None => {
                    let place = state.put;
                    state.entries.push_back((key.map(str::to_owned), message, place));
                    state.put += 1;
                    state.high = state.high.max(state.entries.len());
                    None
                }
            }
        };
        drop(replaced);
        self.wake.ring();
        Ok(())
    }

    /// A thread panicked: the first report of an open mailbox is kept, cut to [`REPORT`] bytes, and wakes the UI thread.
    pub fn panicked(&self, mut message: String) {
        {
            let mut state = self.state();
            if state.closed || state.panic.is_some() {
                return;
            }
            if message.len() > REPORT {
                let end = (0..=REPORT).rev().find(|end| message.is_char_boundary(*end)).unwrap_or(0);
                message.truncate(end);
            }
            state.panic = Some((message, state.put));
        }
        self.wake.ring();
    }

    /// The plugin has no message handler: every message is `Closed` from now on, also one sent during its setup, which
    /// is dropped after the lock is released. Its threads and their reports are not touched.
    pub fn refuse_messages(&self) {
        let dropped = {
            let mut state = self.state();
            state.refusing = true;
            state.held = 0;
            std::mem::take(&mut state.entries)
        };
        drop(dropped);
    }

    /// The plugin left `active`: every send is `Closed` from now on, and what waited is dropped, after the lock is
    /// released.
    pub fn close(&self) {
        let dropped = {
            let mut state = self.state();
            state.closed = true;
            state.panic = None;
            state.held = 0;
            std::mem::take(&mut state.entries)
        };
        drop(dropped);
    }

    /// The activation ended: the mailbox is closed and no longer the plugin's current one.
    pub fn retire(self: &Arc<Self>) {
        self.close();
        let this = Arc::downgrade(self);
        MAILBOXES.with(|boxes| boxes.borrow_mut().retain(|(_, mailbox)| !mailbox.ptr_eq(&this)));
    }

    pub fn closed(&self) -> bool {
        self.state().closed
    }

    /// Whether it holds all the entries, or all the bytes, it may.
    pub fn full(&self) -> bool {
        let state = self.state();
        state.entries.len() >= abi::BOUND || state.held >= self.bytes
    }

    /// The messages that wait, in order, and a thread's panic report.
    #[cfg(test)]
    pub fn take(&self) -> (Vec<Message>, Option<String>) {
        let mut state = self.state();
        state.held = 0;
        let messages = state.entries.drain(..).map(|(_, message, _)| message).collect();
        (messages, state.panic.take().map(|(report, _)| report))
    }

    /// How many messages were put in so far: a wake that comes now goes after them.
    pub fn placed(&self) -> u64 {
        self.state().put
    }

    /// The first message that waits, if it was put in before the panic report and before place `before`: its place
    /// in the mailbox is free at once.
    pub fn take_one(&self, before: Option<u64>) -> Option<Message> {
        let mut state = self.state();
        let bound = state.panic.as_ref().map(|(_, at)| *at).into_iter().chain(before).min();
        let (_, _, place) = state.entries.front()?;
        if bound.is_some_and(|bound| *place >= bound) {
            return None;
        }
        let entry = state.entries.pop_front()?;
        state.held -= size_of(&entry);
        Some(entry.1)
    }

    /// A thread's panic report.
    pub fn take_panic(&self) -> Option<String> {
        self.state().panic.take().map(|(report, _)| report)
    }

    pub fn stats(&self) -> Stats {
        let state = self.state();
        Stats {
            waiting: state.entries.len(),
            high: state.high,
            refused: state.refused,
            closed: state.closed,
            reported: state.panic.is_some(),
        }
    }
}

/// What a message under `key` counts of the mailbox's bytes: its key, and its JSON text, or as an in-process value was
/// written.
fn size(key: Option<&str>, message: &Message) -> u64 {
    let text = match message {
        Message::Json(text) => text.len(),
        Message::Value(_, bytes) => *bytes,
    };
    (key.map_or(0, str::len) + text) as u64
}

fn size_of((key, message, _): &(Option<String>, Message, u64)) -> u64 {
    size(key.as_deref(), message)
}

/// The mailbox of an in-process plugin: Rust values, each with the length of its JSON text.
impl Link for Mailbox {
    fn json(&self) -> bool {
        false
    }

    fn send(&self, key: Option<&str>, message: Outgoing) -> Result<(), (Refused, Outgoing)> {
        let message = match message {
            Outgoing::Value(value, bytes) => Message::Value(value, bytes),
            Outgoing::Json(text) => Message::Json(text),
        };
        self.put(key, message).map_err(|(refused, message)| {
            let message = match message {
                Message::Value(value, bytes) => Outgoing::Value(value, bytes),
                Message::Json(text) => Outgoing::Json(text),
            };
            (refused, message)
        })
    }

    fn report(&self, message: &str) {
        self.panicked(message.to_owned());
    }

    fn stopped(&self) -> bool {
        self.closed()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};

    use super::*;

    #[test]
    fn a_mailbox_holds_its_bytes_at_most() {
        let _limits =
            crate::limits::set(crate::limits::Limits { plugin_content: 100, ..crate::limits::Limits::default() });
        let mailbox = Mailbox::new("test.bytes", Arc::new(Wake::new(None)));
        let put = |key: Option<&str>, text: &str| {
            mailbox.put(key, Message::Json(text.to_owned())).map_err(|(refused, _)| refused)
        };
        let full = |put: Result<(), Refused>| matches!(put, Err(Refused::Full));
        let forty = format!("\"{}\"", "x".repeat(38));
        assert!(put(None, &forty).is_ok());
        assert!(put(None, &forty).is_ok());
        assert!(full(put(None, &forty)), "past the bytes");
        assert_eq!(mailbox.stats().waiting, 2);
        assert!(mailbox.take_one(None).is_some());
        assert!(put(None, &forty).is_ok(), "freed");
        // A key's bytes count, and a replace counts the difference.
        let twenty = format!("\"{}\"", "x".repeat(18));
        assert!(full(put(Some("k"), &twenty)), "80 bytes and 21");
        assert!(mailbox.take_one(None).is_some());
        assert!(put(Some("k"), &twenty).is_ok(), "40 bytes and 21");
        assert!(put(Some("k"), "1").is_ok(), "a replace by 2 bytes");
        assert!(put(Some("k"), &forty).is_ok(), "a replace by 41 bytes");
        assert!(full(put(Some("k"), &format!("{forty}{}", " ".repeat(20)))), "by 61");
    }

    #[test]
    fn closing_frees_what_waited() {
        let mailbox = Mailbox::new("test.close", Arc::new(Wake::new(None)));
        for number in 0..3 {
            assert!(mailbox.put(None, Message::Json(number.to_string())).is_ok());
        }
        mailbox.panicked("é".repeat(REPORT));
        mailbox.panicked("second".to_owned());
        assert_eq!(mailbox.stats(), Stats { waiting: 3, high: 3, refused: 0, closed: false, reported: true });
        let (_, panic) = mailbox.take();
        assert!(panic.is_some_and(|panic| panic.len() <= REPORT && panic.starts_with('é')));
        assert!(mailbox.put(Some("k"), Message::Json("1".into())).is_ok());
        mailbox.close();
        mailbox.panicked("late".to_owned());
        assert_eq!(mailbox.stats(), Stats { waiting: 0, high: 3, refused: 0, closed: true, reported: false });
        assert!(matches!(mailbox.put(None, Message::Json("9".into())), Err((Refused::Closed, _))));
        let (messages, panic) = mailbox.take();
        assert!(messages.is_empty() && panic.is_none());
    }

    /// A message whose drop sends to the mailbox it is in, and says it did.
    struct Reentrant(Arc<Mailbox>, Arc<AtomicBool>);

    impl Drop for Reentrant {
        fn drop(&mut self) {
            // Under the mailbox's lock this would never return.
            let _ = self.0.closed();
            let _ = self.0.put(None, Message::Json("0".into()));
            self.1.store(true, Ordering::SeqCst);
        }
    }

    #[test]
    fn a_message_dropped_by_the_mailbox_may_use_it() {
        for close in [false, true] {
            let mailbox = Mailbox::new("test.reentrant", Arc::new(Wake::new(None)));
            let dropped = Arc::new(AtomicBool::new(false));
            let message = Message::Value(Box::new(Reentrant(mailbox.clone(), dropped.clone())), 0);
            mailbox.put(Some("k"), message).map_err(|_| ()).unwrap();
            let (done, finished) = std::sync::mpsc::channel();
            let other = mailbox.clone();
            std::thread::spawn(move || {
                match close {
                    true => other.close(),
                    false => drop(other.put(Some("k"), Message::Json("1".into()))),
                }
                done.send(()).unwrap();
            });
            assert!(finished.recv_timeout(std::time::Duration::from_secs(10)).is_ok(), "close {close}: deadlock");
            assert!(dropped.load(Ordering::SeqCst));
        }
    }
    #[test]
    fn the_registry_keeps_one_row_a_plugin() {
        let before = rows();
        let mut kept = Vec::new();
        for _ in 0..50 {
            kept.push(Mailbox::new("test.rows", Arc::new(Wake::new(None))));
        }
        assert_eq!(rows(), before + 1);
        kept.last().unwrap().retire();
        assert_eq!((rows(), stats("test.rows")), (before, None));
    }
}
