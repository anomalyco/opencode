//! Transcript rows. `list` holds the transcript and dispatches each row to its module.

pub mod assistant;
pub mod background;
pub mod compaction;
pub mod errors;
pub mod footer;
pub mod images;
pub mod list;
pub mod reasoning;
pub mod revert;
pub mod shell;
pub mod skill;
pub mod user;
