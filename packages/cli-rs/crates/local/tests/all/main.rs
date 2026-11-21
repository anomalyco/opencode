//! The client-local files' integration tests, one module per area, linked into one binary. Select an area with
//! `cargo test -p opencode-local --test all <module>::`.

// `config_interop`'s `json!` literals nest deeper than the default limit.
#![recursion_limit = "512"]

mod support;

mod config_interop;
mod interop;
mod shared_files;
