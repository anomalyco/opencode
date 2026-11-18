//! The language layer: compiler, VM, runtime, standard library, host functions and their crossing, and snapshots. It
//! knows nothing about tools; the Code Mode layer (`crate::codemode`) builds them on it, as the reference's
//! `src/language/` and `src/codemode/` are split.

pub(crate) mod builtins;
pub(crate) mod bytecode;
pub(crate) mod compiler;
pub(crate) mod conversion;
pub(crate) mod convert;
pub(crate) mod cross;
pub(crate) mod diagnostic;
pub(crate) mod exec;
pub(crate) mod extension;
pub(crate) mod host;
pub(crate) mod iteration;
pub(crate) mod native;
pub(crate) mod object;
pub(crate) mod ops;
pub(crate) mod promise;
pub(crate) mod reach;
pub(crate) mod snapshot;
pub(crate) mod streaming;
pub(crate) mod strings;
pub(crate) mod value;
pub(crate) mod vm;
