//! The root command, which opens the TUI (T.1, to C.13): connect, read `cli.json`, and run the TUI
//! until it quits. E.1 resolves `--session` and passes `--prompt` (`handlers/default.ts`); C.13 adds the
//! remaining root flags.

use std::sync::Arc;

use opencode_api::generated::SessionID;
use opencode_api::transport::Reqwest;
use opencode_local::channel::Channels;
use opencode_local::cli_config::{CliConfig, Permissions, Resolved};
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
    let mut config = Resolved::new(info, |name| std::env::var(name).ok());
    // `--auto` wins over `session.permissions` (`context/permission.tsx`).
    if args.permissions.auto() {
        config.permissions = Permissions::Autoaccept;
    }
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
    let local = context.server.server.is_none();
    let tui_args = Args {
        version: crate::help::VERSION.to_owned(),
        prompt: args.prompt.clone(),
        new_session_id: session
            .as_ref()
            .and_then(|(id, found)| (!found).then(|| id.clone())),
        local,
        managed: matches!(connection.source, Source::Service { .. }),
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
            continue_: args.continue_ && args.session.is_none(),
            events: true,
        },
        args: tui_args,
        keep: Box::new(connection),
    })?;
    Ok(())
}
