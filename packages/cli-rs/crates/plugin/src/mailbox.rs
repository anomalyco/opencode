//! A plugin's mailbox (synthesis 4.2, "When a queue is full"; property `backlog`): what its threads send, which the
//! UI thread hands to its message handler as the plugin's `update`. It holds at most [`abi::BOUND`] entries, and a send
//! never blocks and never drops in silence:
//!
//! - `send` puts a message at the end, or refuses it with `Full` and stores nothing;
//! - `replace` under a key takes the place of the entry that waits under that key, so a key holds one entry; a new key
//!   in a full mailbox is `Full`; an empty key is no key;
//! - once the plugin leaves `active` every send is `Closed`, and what waited is dropped; a plugin without a message
//!   handler refuses messages the same way, and its threads still run;
//! - a thread's panic report is one flag a plugin: the first is kept, the plugin fails once.
//!
//! No message is dropped while the mailbox's lock is held: a message in process is the author's value, whose `Drop`
//! may come back to the mailbox (a `Stop` check, a send) or wait for a thread that does. Replaced and closed entries
//! are dropped after the lock is released.
//!
//! A send posts the activation's [`Wake`], so a burst wakes the UI thread once, and the last send is never lost.

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
}

/// The longest panic report the host keeps, in bytes.
const REPORT: usize = 4096;

pub(crate) struct Mailbox {
    state: Mutex<State>,
    wake: Arc<Wake>,
}

#[derive(Default)]
struct State {
    entries: VecDeque<(Option<String>, Message)>,
    closed: bool,
    /// The plugin registered no message handler: a message is `Closed`, though the plugin is active.
    refusing: bool,
    panic: Option<String>,
    high: usize,
    refused: u64,
}

thread_local! {
    /// The mailbox of each plugin's current activation on this thread, by plugin ID: one row an ID.
    static MAILBOXES: RefCell<Vec<(String, Weak<Mailbox>)>> = RefCell::default();
}

/// What the mailbox of plugin `id`'s current activation has seen, if it has one: a failed plugin's shows it closed; a
/// disabled or unloaded plugin has none.
pub fn stats(id: &str) -> Option<Stats> {
    MAILBOXES.with(|boxes| {
        let boxes = boxes.borrow();
        let found = boxes.iter().find(|(known, _)| known == id).and_then(|(_, mailbox)| mailbox.upgrade());
        found.map(|mailbox| mailbox.stats())
    })
}

/// The rows the registry holds, for the test that toggles a plugin many times.
#[cfg(test)]
pub(crate) fn rows() -> usize {
    MAILBOXES.with(|boxes| boxes.borrow().len())
}

impl Mailbox {
    pub fn new(id: &str, wake: Arc<Wake>) -> Arc<Self> {
        let mailbox = Arc::new(Self { state: Mutex::default(), wake });
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
            let waiting = key.and_then(|key| state.entries.iter().position(|(known, _)| known.as_deref() == Some(key)));
            match waiting {
                Some(index) => Some(std::mem::replace(&mut state.entries[index].1, message)),
                None if state.entries.len() >= abi::BOUND => {
                    state.refused += 1;
                    return Err((Refused::Full, message));
                }
                None => {
                    state.entries.push_back((key.map(str::to_owned), message));
                    state.high = state.high.max(state.entries.len());
                    None
                }
            }
        };
        drop(replaced);
        self.wake.ring();
        Ok(())
    }

    /// [`Mailbox::put`] of JSON text from the C ABI. A closed or full mailbox answers before the text is read; text
    /// that is not JSON, or a key that is not UTF-8, is [`abi::ERROR`].
    pub fn put_json(&self, key: &[u8], message: &[u8]) -> i32 {
        let Ok(key) = std::str::from_utf8(key) else { return abi::ERROR };
        let key = (!key.is_empty()).then_some(key);
        {
            let state = self.state();
            let waiting = key.is_some_and(|key| state.entries.iter().any(|(known, _)| known.as_deref() == Some(key)));
            if state.closed || state.refusing {
                return abi::CLOSED;
            }
            if !waiting && state.entries.len() >= abi::BOUND {
                drop(state);
                return self.refuse_full();
            }
        }
        let Ok(text) = std::str::from_utf8(message) else { return abi::ERROR };
        if serde_json::from_str::<serde::de::IgnoredAny>(text).is_err() {
            return abi::ERROR;
        }
        match self.put(key, Message::Json(text.to_owned())) {
            Ok(()) => abi::OK,
            Err((Refused::Full, _)) => abi::FULL,
            Err((Refused::Closed, _)) => abi::CLOSED,
            Err((Refused::Unencodable, _)) => abi::ERROR,
        }
    }

    fn refuse_full(&self) -> i32 {
        self.state().refused += 1;
        abi::FULL
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
            state.panic = Some(message);
        }
        self.wake.ring();
    }

    /// The plugin has no message handler: every message is `Closed` from now on, also one sent during its setup, which
    /// is dropped after the lock is released. Its threads and their reports are not touched.
    pub fn refuse_messages(&self) {
        let dropped = {
            let mut state = self.state();
            state.refusing = true;
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

    /// The messages that wait, in order, and a thread's panic report.
    pub fn take(&self) -> (Vec<Message>, Option<String>) {
        let mut state = self.state();
        let messages = state.entries.drain(..).map(|(_, message)| message).collect();
        (messages, state.panic.take())
    }

    pub fn stats(&self) -> Stats {
        let state = self.state();
        Stats { waiting: state.entries.len(), high: state.high, refused: state.refused, closed: state.closed }
    }
}

/// The mailbox of an in-process plugin: Rust values, no bytes.
impl Link for Mailbox {
    fn json(&self) -> bool {
        false
    }

    fn send(&self, key: Option<&str>, message: Outgoing) -> Result<(), (Refused, Outgoing)> {
        let message = match message {
            Outgoing::Value(value) => Message::Value(value),
            Outgoing::Json(text) => Message::Json(text),
        };
        self.put(key, message).map_err(|(refused, message)| {
            let message = match message {
                Message::Value(value) => Outgoing::Value(value),
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

    // Expected (4.2): closing frees what waited, at once, and refuses every send after; the first panic report of an
    // open mailbox is kept, cut to its bound, and one after the close is not.
    #[test]
    fn closing_frees_what_waited() {
        let mailbox = Mailbox::new("test.close", Arc::new(Wake::new(None)));
        for number in 0..3 {
            assert!(mailbox.put(None, Message::Json(number.to_string())).is_ok());
        }
        mailbox.panicked("é".repeat(REPORT));
        mailbox.panicked("second".to_owned());
        assert_eq!(mailbox.stats(), Stats { waiting: 3, high: 3, refused: 0, closed: false });
        let (_, panic) = mailbox.take();
        assert!(panic.is_some_and(|panic| panic.len() <= REPORT && panic.starts_with('é')));
        assert!(mailbox.put(Some("k"), Message::Json("1".into())).is_ok());
        mailbox.close();
        mailbox.panicked("late".to_owned());
        assert_eq!(mailbox.stats(), Stats { waiting: 0, high: 3, refused: 0, closed: true });
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

    // Expected (review bigboi-1): a replaced or a closed message's drop may use its own mailbox; it runs after the lock
    // is released, so neither the sender nor the UI thread waits for ever.
    #[test]
    fn a_message_dropped_by_the_mailbox_may_use_it() {
        for close in [false, true] {
            let mailbox = Mailbox::new("test.reentrant", Arc::new(Wake::new(None)));
            let dropped = Arc::new(AtomicBool::new(false));
            let message = Message::Value(Box::new(Reentrant(mailbox.clone(), dropped.clone())));
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

    // Expected (reviews bigboi-11, carbon-7): an empty key is no key; a key that is not UTF-8 or a message that is not
    // JSON is an error; a full or closed mailbox answers before the text is read.
    #[test]
    fn the_c_abi_send_reads_keys_and_text() {
        let mailbox = Mailbox::new("test.json", Arc::new(Wake::new(None)));
        assert_eq!(mailbox.put_json(b"", b"1"), abi::OK);
        assert_eq!(mailbox.put_json(b"", b"2"), abi::OK);
        assert_eq!(mailbox.stats().waiting, 2, "an empty key replaced");
        assert!(mailbox.put(Some(""), Message::Json("3".into())).is_ok());
        assert_eq!(mailbox.stats().waiting, 3, "an empty key replaced in process");
        assert_eq!(mailbox.put_json(&[0xff], b"1"), abi::ERROR);
        assert_eq!(mailbox.put_json(b"k", b"{not json"), abi::ERROR);
        assert_eq!(mailbox.put_json(b"k", &[0xff]), abi::ERROR);
        for number in 3..abi::BOUND {
            assert_eq!(mailbox.put_json(b"", number.to_string().as_bytes()), abi::OK);
        }
        assert_eq!(mailbox.put_json(b"", b"{not json"), abi::FULL);
        mailbox.close();
        assert_eq!(mailbox.put_json(b"", b"{not json"), abi::CLOSED);
    }

    // Expected (review bigboi low): toggling a plugin keeps one row of it, and a retired mailbox leaves none.
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
