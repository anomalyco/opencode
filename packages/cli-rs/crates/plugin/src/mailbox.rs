//! A plugin's mailbox (synthesis 4.2, "When a queue is full"; property `backlog`): what its threads send, which the
//! UI thread hands to its message handler as the plugin's `update`. It holds at most [`abi::BOUND`] entries, and a send
//! never blocks and never drops in silence:
//!
//! - `send` puts a message at the end, or refuses it with `Full` and stores nothing;
//! - `replace` under a key takes the place of the entry that waits under that key, so a key holds one entry; a new key
//!   in a full mailbox is `Full`;
//! - once the plugin leaves `active` every send is `Closed`, and what waited is dropped;
//! - a thread's panic report is one flag a plugin: the first is kept, the plugin fails once.
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

pub(crate) struct Mailbox {
    state: Mutex<State>,
    wake: Arc<Wake>,
}

#[derive(Default)]
struct State {
    entries: VecDeque<(Option<String>, Message)>,
    closed: bool,
    panic: Option<String>,
    high: usize,
    refused: u64,
}

thread_local! {
    /// The mailboxes of the activations on this thread, by plugin ID, newest last.
    static MAILBOXES: RefCell<Vec<(String, Weak<Mailbox>)>> = RefCell::default();
}

/// What the mailbox of plugin `id`'s newest activation has seen, if it has one.
pub fn stats(id: &str) -> Option<Stats> {
    MAILBOXES.with(|boxes| {
        let mut boxes = boxes.borrow_mut();
        boxes.retain(|(_, mailbox)| mailbox.strong_count() > 0);
        boxes.iter().rev().find(|(known, _)| known == id).and_then(|(_, mailbox)| mailbox.upgrade()).map(|m| m.stats())
    })
}

impl Mailbox {
    pub fn new(id: &str, wake: Arc<Wake>) -> Arc<Self> {
        let mailbox = Arc::new(Self { state: Mutex::default(), wake });
        MAILBOXES.with(|boxes| boxes.borrow_mut().push((id.to_owned(), Arc::downgrade(&mailbox))));
        mailbox
    }

    pub fn wake(&self) -> &Arc<Wake> {
        &self.wake
    }

    fn state(&self) -> std::sync::MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Puts `message` in, under `key` or at the end, and wakes the UI thread; or hands it back.
    pub fn put(&self, key: Option<&str>, message: Message) -> Result<(), (Refused, Message)> {
        {
            let mut state = self.state();
            if state.closed {
                return Err((Refused::Closed, message));
            }
            let waiting = key.and_then(|key| state.entries.iter().position(|(known, _)| known.as_deref() == Some(key)));
            match waiting {
                Some(index) => state.entries[index].1 = message,
                None if state.entries.len() >= abi::BOUND => {
                    state.refused += 1;
                    return Err((Refused::Full, message));
                }
                None => {
                    state.entries.push_back((key.map(str::to_owned), message));
                    state.high = state.high.max(state.entries.len());
                }
            }
        }
        self.wake.ring();
        Ok(())
    }

    /// [`Mailbox::put`] of JSON text from the C ABI: an [`abi::ERROR`] for one that is not JSON.
    pub fn put_json(&self, key: &[u8], message: &[u8]) -> i32 {
        let (Ok(key), Ok(json)) = (std::str::from_utf8(key), serde_json::from_slice(message)) else {
            return abi::ERROR;
        };
        match self.put((!key.is_empty()).then_some(key), Message::Json(json)) {
            Ok(()) => abi::OK,
            Err((Refused::Full, _)) => abi::FULL,
            Err((Refused::Closed, _)) => abi::CLOSED,
        }
    }

    /// A thread panicked: the first report of an open mailbox is kept, and wakes the UI thread.
    pub fn panicked(&self, message: String) {
        {
            let mut state = self.state();
            if state.closed || state.panic.is_some() {
                return;
            }
            state.panic = Some(message);
        }
        self.wake.ring();
    }

    /// The plugin left `active`: every send is `Closed` from now on, and what waited is dropped.
    pub fn close(&self) {
        let mut state = self.state();
        state.closed = true;
        state.entries.clear();
        state.panic = None;
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
            Outgoing::Json(text) => match serde_json::from_str(&text) {
                Ok(json) => Message::Json(json),
                Err(_) => return Err((Refused::Closed, Outgoing::Json(text))),
            },
        };
        self.put(key, message).map_err(|(refused, message)| {
            let message = match message {
                Message::Value(value) => Outgoing::Value(value),
                Message::Json(json) => Outgoing::Json(json.to_string()),
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
    use super::*;

    // Expected (4.2): closing frees what waited, at once, and refuses every send after; the first panic report of an
    // open mailbox is kept, and one after the close is not.
    #[test]
    fn closing_frees_what_waited() {
        let mailbox = Mailbox::new("test.close", Arc::new(Wake::new(None)));
        for number in 0..3 {
            assert!(mailbox.put(None, Message::Json(number.into())).is_ok());
        }
        mailbox.panicked("first".to_owned());
        mailbox.panicked("second".to_owned());
        assert_eq!(mailbox.stats(), Stats { waiting: 3, high: 3, refused: 0, closed: false });
        let (_, panic) = mailbox.take();
        assert_eq!(panic.as_deref(), Some("first"));
        assert!(mailbox.put(Some("k"), Message::Json(1.into())).is_ok());
        mailbox.close();
        mailbox.panicked("late".to_owned());
        assert_eq!(mailbox.stats(), Stats { waiting: 0, high: 3, refused: 0, closed: true });
        assert!(matches!(mailbox.put(None, Message::Json(9.into())), Err((Refused::Closed, _))));
        let (messages, panic) = mailbox.take();
        assert!(messages.is_empty() && panic.is_none());
    }
}
