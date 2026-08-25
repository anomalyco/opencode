//! pencode core: configuration, durable session storage, and the tool registry.

pub mod config;
pub mod session;
pub mod tool;

use std::path::PathBuf;

/// Root handle for everything the agent runtime needs.
#[derive(Debug, Clone)]
pub struct App {
    config: config::Config,
    store: session::Store,
}

impl App {
    pub fn load(directory: impl Into<PathBuf>) -> anyhow::Result<Self> {
        Ok(App {
            config: config::Config::load()?,
            store: session::Store::open(directory.into())?,
        })
    }

    pub fn config(&self) -> &config::Config {
        &self.config
    }

    pub fn store(&self) -> &session::Store {
        &self.store
    }
}
