//! Finding, probing, and starting the OpenCode server.

pub mod connect;
pub mod contender;
pub mod delegate;
pub mod discover;
pub mod ensure;
pub mod handoff;
pub mod probe;
pub mod spawn;
pub mod standalone;
pub mod stop;
pub mod ts_command;

#[cfg(test)]
mod testing;
