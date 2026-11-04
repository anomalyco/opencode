//! Client data store, ported from `packages/client/src/solid/data.ts`.

pub mod changes;
pub mod connection;
pub mod environment;
pub mod forms;
pub mod inbox;
pub mod location;
pub mod messages;
pub mod permissions;
pub mod projects;
pub mod sessions;
pub mod shells;
pub mod state;
pub mod target;

pub use changes::Changes;
pub use inbox::{InboxExt, PendingStatus, Prompt};
pub use messages::{LoadMore, MessageExt, Transcript};
pub use sessions::CreateSession;
pub use state::{Data, Error, Options, SessionStatus, State, Task};
