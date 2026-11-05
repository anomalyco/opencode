//! Client-local files shared with the TypeScript client: paths, locks, config, and state.

pub mod channel;
pub mod cli_config;
pub mod generated;
pub mod id;
pub mod jsonc;
pub mod jsonl;
pub mod lock;
pub mod migrate;
pub mod model_pref;
pub mod paths;
pub mod pins;
pub mod registration;
pub mod serial;
pub mod service_config;
pub mod storage;
pub mod watch;
