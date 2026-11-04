//! The root command, which opens the TUI (`handlers/default.ts`): enter the directory, connect, read
//! `cli.json`, resolve `--session`, and run the TUI with the root flags until it quits.

use std::sync::Arc;

use opencode_api::generated::SessionID;
use opencode_api::transport::Reqwest;
use opencode_local::channel::Channels;
use opencode_local::cli_config::{CliConfig, Resolved};
use opencode_local::paths::{self, Paths};
use opencode_service::connect::{self, Env, Options, Source};
use opencode_tui::{Args, Deps, Launch, Route, app::Roots};

use super::Context;
use crate::args::RootArgs;

pub fn run(context: &Context, args: &RootArgs) -> anyhow::Result<()> {
    let directory = match &args.directory {
        Some(directory) => paths::enter(std::path::Path::new(directory))?,
        None => paths::start_directory()?,
    };
    let paths = Paths::from_env()?;
    crate::panic::install();
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_name("opencode-tui")
        .build()?;
    let transport = Arc::new(Reqwest::default());
    let env = Env::from_env();
    let connection = runtime.block_on(connect::resolve(
        transport.clone(),
        &paths,
        &env,
        &Options {
            server: context.server.server.clone(),
            standalone: context.server.standalone,
            client_version: crate::help::VERSION.to_owned(),
            standalone_fallback: false,
            // The Rust client never replaces a service, so TS's "Restarting background server (version
            // mismatch)..." has no counterpart.
            on_start: Some(|| {
                log::info!("background service starting reason=missing");
                eprintln!("Starting background server...");
            }),
        },
    ))?;
    // A managed service's client follows the service when it restarts on a new port or password.
    let client = opencode_service::follow::client(transport, &connection, &paths, &env)?;
    let info = CliConfig::new(&paths).get().unwrap_or_else(|error| {
        log::warn!("failed to read cli.json: {error}");
        Default::default()
    });
    let config = Resolved::new(info, |name| std::env::var(name).ok());
    // A `--session` ID the server does not know becomes the ID of the session the first prompt creates.
    let session = match &args.session {
        Some(id) => {
            let id = SessionID(id.clone());
            let found = runtime.block_on(opencode_store::target::find_session(&client, &id))?;
            Some((id, found.is_some()))
        }
        None => None,
    };
    let route = match &session {
        Some((id, true)) => Route::Session { id: id.clone() },
        _ => std::env::var("OPENCODE_ROUTE")
            .ok()
            .and_then(|value| opencode_tui::features::startup::env_route(&value))
            .unwrap_or(Route::Home),
    };
    // Managed and standalone servers run here; an explicit `--server` may be on another machine.
    let local = context.server.server.is_none();
    let tui_args = Args {
        version: crate::help::VERSION.to_owned(),
        prompt: args.prompt.clone(),
        new_session_id: session
            .as_ref()
            .and_then(|(id, found)| (!found).then(|| id.clone())),
        local,
        managed: matches!(connection.source, Source::Service { .. }),
        auto: args.permissions.auto(),
        environment: local.then(opencode_store::environment::session_environment),
        ..Args::default()
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
            // With `--session` too, TS opens that session, then the continued one replaces it.
            continue_: args.continue_,
            events: true,
        },
        args: tui_args,
        keep: Box::new(connection),
    })?;
    Ok(())
}
