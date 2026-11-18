//! Code Mode, built on the language layer (`crate::language`): tools and their schemas, the catalog, `search`,
//! OpenAPI tools, hooks, and the runtime a host makes, as the reference's `src/codemode/` is.

pub(crate) mod hooks;
pub mod openapi;
pub(crate) mod program;
pub(crate) mod run;
pub(crate) mod runtime;
pub(crate) mod schema;
pub(crate) mod search;
#[cfg(feature = "test262")]
pub mod test262;
pub(crate) mod tool;
