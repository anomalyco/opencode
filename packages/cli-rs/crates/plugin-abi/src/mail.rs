//! Plugin worker threads send messages to a bounded mailbox; the UI thread runs [`crate::Setup::messages`].
//! [`Sender::send`] returns the message if the mailbox is full or closed. [`Sender::replace`] coalesces pending
//! messages with the same nonempty key.
//!
//! Messages must round-trip through JSON even in process; the encoded length counts against the mailbox budget.
//! Threads stop cooperatively through [`Stop`]. An uncaught worker panic fails the plugin.

use std::any::Any;
use std::marker::PhantomData;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::{Arc, PoisonError, RwLock};

use serde::Serialize;
use serde::de::DeserializeOwned;

/// Maximum pending messages per plugin.
pub const BOUND: usize = 256;

/// Why a send was refused; the message comes back.
#[derive(Debug, PartialEq, Eq)]
pub enum SendError<M> {
    /// The mailbox holds [`BOUND`] entries. Nothing was stored.
    Full(M),
    /// The plugin has left `active`: it was disabled, failed, or replaced, and its threads should end.
    Closed(M),
    /// The message does not cross as JSON and come back as itself. Nothing was stored.
    Unencodable(M),
}

impl<M> SendError<M> {
    pub fn into_inner(self) -> M {
        match self {
            SendError::Full(message) | SendError::Closed(message) | SendError::Unencodable(message) => message,
        }
    }
}

/// A refused send, as the host reports it.
#[doc(hidden)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(not(feature = "host"), non_exhaustive)]
pub enum Refused {
    Full,
    Closed,
    /// The host could not read the message.
    Unencodable,
}

/// A message on its way to the host: a Rust value in process, with the length of its JSON text; JSON text over the C
/// ABI.
#[doc(hidden)]
pub enum Outgoing {
    Value(Box<dyn Any + Send>, usize),
    Json(String),
}

/// A message the host delivers to the plugin's handler.
#[doc(hidden)]
pub enum Message {
    /// A Rust value, and the length of the JSON text it was read back from.
    Value(Box<dyn Any + Send>, usize),
    /// JSON text, as the sender wrote it.
    Json(String),
}

/// The host's side of a plugin's threads, callable from any thread.
#[doc(hidden)]
pub trait Link: Send + Sync {
    /// Whether messages go as JSON text ([`Outgoing::Json`]) rather than Rust values.
    fn json(&self) -> bool;
    /// Puts `message` in the mailbox: at the end, or in the place of the entry under `key`.
    fn send(&self, key: Option<&str>, message: Outgoing) -> Result<(), (Refused, Outgoing)>;
    /// A thread of the plugin panicked with `message`.
    fn report(&self, message: &str);
    /// The plugin has left `active`.
    fn stopped(&self) -> bool;
}

/// A [`Link`] that the plugin's disposal revokes: once revoked, every send is `Closed`, every flag is set, and no
/// thread reaches the host again, so none outlives what the host gave it. The guard is held only across a call into
/// the host, never across the author's own code, so a revocation waits for host calls alone.
#[doc(hidden)]
#[derive(Clone, Default)]
pub struct Revocable(Arc<Revoked>);

#[derive(Default)]
#[doc(hidden)]
pub struct Revoked {
    /// The link takes JSON text: it is fixed when the link is made, so a send reads it without the guard.
    json: bool,
    link: RwLock<Option<Arc<dyn Link>>>,
}

impl Revocable {
    pub fn new(link: Arc<dyn Link>) -> Self {
        Self(Arc::new(Revoked { json: link.json(), link: RwLock::new(Some(link)) }))
    }

    /// Makes every later use of every clone see a stopped plugin, once the uses in progress have returned.
    pub fn revoke(&self) {
        self.0.link.write().unwrap_or_else(PoisonError::into_inner).take();
    }

    fn with<T>(&self, f: impl FnOnce(Option<&dyn Link>) -> T) -> T {
        f(self.0.link.read().unwrap_or_else(PoisonError::into_inner).as_deref())
    }
}

/// Sends messages of type `M` to the plugin's [`crate::Setup::messages`] handler, from any thread.
pub struct Sender<M> {
    link: Revocable,
    _message: PhantomData<fn(M)>,
}

impl<M> Clone for Sender<M> {
    fn clone(&self) -> Self {
        Self { link: self.link.clone(), _message: PhantomData }
    }
}

impl<M: Serialize + DeserializeOwned + Send + 'static> Sender<M> {
    #[doc(hidden)]
    pub fn new(link: Revocable) -> Self {
        Self { link, _message: PhantomData }
    }

    /// Puts `message` at the end of the mailbox. It never blocks.
    pub fn send(&self, message: M) -> Result<(), SendError<M>> {
        self.post(None, message)
    }

    /// Puts `message` in the place of the one that waits under `key`, or at the end when none waits: the handler gets
    /// the last one sent under a key, and nothing older after it. A new key in a full mailbox is `Full`. An empty `key`
    /// is no key: this is [`Sender::send`].
    pub fn replace(&self, key: &str, message: M) -> Result<(), SendError<M>> {
        self.post(Some(key), message)
    }

    fn post(&self, key: Option<&str>, message: M) -> Result<(), SendError<M>> {
        // The author's code runs here, before the guard: a slow or failing serializer never holds a revocation up.
        let Some((json, read)) = encoded(&message) else { return Err(SendError::Unencodable(message)) };
        // In process the host gets what the JSON reads back as, as a library's handler does.
        let outgoing = match self.link.0.json {
            true => Outgoing::Json(json),
            false => Outgoing::Value(Box::new(read), json.len()),
        };
        let refused = self.link.with(|link| match link {
            Some(link) => link.send(key, outgoing).err(),
            None => Some((Refused::Closed, outgoing)),
        });
        // A refused message is dropped after the guard, so dropping it runs no author code under it either; the sender
        // gets its own message back.
        match refused {
            None => Ok(()),
            Some((refused, outgoing)) => {
                drop(outgoing);
                Err(refused.with(message))
            }
        }
    }
}

/// `message` as JSON text, and what it reads back as, when that is an `M`.
fn encoded<M: Serialize + DeserializeOwned>(message: &M) -> Option<(String, M)> {
    let json = serde_json::to_string(message).ok()?;
    let read = serde_json::from_str::<M>(&json).ok()?;
    Some((json, read))
}

impl Refused {
    fn with<M>(self, message: M) -> SendError<M> {
        match self {
            Refused::Full => SendError::Full(message),
            Refused::Closed => SendError::Closed(message),
            Refused::Unencodable => SendError::Unencodable(message),
        }
    }
}

/// Set when the plugin leaves `active`; a thread of the plugin ends when it sees it.
#[derive(Clone)]
pub struct Stop(Revocable);

impl Stop {
    pub fn stopped(&self) -> bool {
        self.0.with(|link| link.is_none_or(|link| link.stopped()))
    }
}

/// Starts the plugin's threads, from any thread.
#[derive(Clone)]
pub struct Spawner {
    id: Arc<str>,
    link: Revocable,
}

impl Spawner {
    #[doc(hidden)]
    pub fn new(id: &str, link: Revocable) -> Self {
        Self { id: id.into(), link }
    }

    /// Starts `run` on a thread named `<plugin id>:<name>`. A panic on it fails the plugin, and the host says so once.
    /// `run` gets the plugin's [`Stop`] flag, and should return once it is set.
    pub fn spawn(&self, name: &str, run: impl FnOnce(Stop) + Send + 'static) -> Result<(), String> {
        let (link, stop, label) = (self.link.clone(), Stop(self.link.clone()), name.to_owned());
        std::thread::Builder::new()
            .name(format!("{}:{name}", self.id))
            .spawn(move || {
                if let Err(panic) = catch_unwind(AssertUnwindSafe(|| run(stop))) {
                    let message = format!("thread {label} panicked: {}", crate::panic_message(&*panic));
                    link.with(|link| {
                        if let Some(link) = link {
                            link.report(&message);
                        }
                    });
                }
            })
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
}

/// The handler [`crate::Setup::messages`] registers, which decodes a delivered message as `M`. Every sender checked
/// that its message reads back as `M`, so one that does not is a broken contract: the handler panics, which fails the
/// plugin, and is never a quiet drop.
pub(crate) fn handler<M: DeserializeOwned + 'static>(
    run: impl Fn(&dyn crate::Host, M) + 'static,
) -> impl Fn(&dyn crate::Host, Message) + 'static {
    move |host, message| {
        let message = match message {
            Message::Value(value, _) => *value.downcast::<M>().unwrap_or_else(|_| panic!("a message of another type")),
            Message::Json(json) => serde_json::from_str::<M>(&json)
                .unwrap_or_else(|error| panic!("a message that does not read as the plugin's type: {error}")),
        };
        run(host, message);
    }
}
