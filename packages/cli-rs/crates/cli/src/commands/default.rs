//! The root command, which opens the TUI (T.1, to C.13): connect, read `cli.json`, and run the TUI
//! until it quits. C.13 adds the remaining root flags.

use std::sync::Arc;

use opencode_api::generated::SessionID;
use opencode_api::transport::Reqwest;
use opencode_local::channel::Channels;
use opencode_local::cli_config::{CliConfig, Resolved};
use opencode_local::paths::{self, Paths};
use opencode_service::connect::{self, Env, Options};
use opencode_tui::{Deps, Launch, Route, app::Roots};

use super::Context;
use crate::args::RootArgs;

pub fn run(context: &Context, args: &RootArgs) -> anyhow::Result<()> {
    let directory = match &args.directory {
        Some(directory) => paths::enter(std::path::Path::new(directory))?,
        None => paths::start_directory()?,
    };
    let paths = Paths::from_env()?;
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_name("opencode-tui")
        .build()?;
    let transport = Arc::new(Reqwest::default());
    let connection = runtime.block_on(connect::resolve(
        transport.clone(),
        &paths,
        &Env::from_env(),
        &Options {
            server: context.server.server.clone(),
            standalone: context.server.standalone,
            client_version: crate::help::VERSION.to_owned(),
            standalone_fallback: false,
            on_start: Some(|| eprintln!("Starting background server...")),
        },
    ))?;
    let client = connection.endpoint.client(transport)?;
    let info = CliConfig::new(&paths).get().unwrap_or_else(|error| {
        log::warn!("failed to read cli.json: {error}");
        Default::default()
    });
    let config = Resolved::new(info, |name| std::env::var(name).ok());
    let route = match &args.session {
        Some(id) => Route::Session {
            id: SessionID(id.clone()),
        },
        None => Route::Home,
    };
    // The TUI's tasks run on this runtime: `App::runtime` uses the multi-threaded runtime it starts in.
    let _guard = runtime.enter();
    opencode_tui::run(Launch {
        deps: Deps {
            client,
            directory: directory.to_string_lossy().into_owned(),
            config,
            roots: Some(Roots {
                paths,
                storage_channel: Channels::from_env().storage,
            }),
            route,
            continue_: args.continue_ && args.session.is_none(),
            events: true,
        },
        keep: Box::new(connection),
    })?;
    Ok(())
}
