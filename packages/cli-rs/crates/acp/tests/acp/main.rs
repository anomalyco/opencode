//! The in-process ACP tests of `packages/cli/test/acp` that C.11 covers, ported to the Rust agent. Cases
//! that depend on C.12's files (tool locations, diffs, compaction updates, replay, permission titles)
//! are left to C.12; each module names them.

mod error;
mod prompt;
mod session;
mod translate;
mod turn;
mod wire;
