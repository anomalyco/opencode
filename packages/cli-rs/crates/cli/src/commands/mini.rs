//! `mini`: the minimal interactive interface (`handlers/mini.ts`, `packages/cli/src/mini.ts`). The handler
//! checks the flags and the terminal, takes piped stdin, connects, and runs `opencode-mini`.

use std::io::IsTerminal;
use std::time::Instant;

use opencode_api::generated::SessionID;
use opencode_local::cli_config::CliConfig;
use opencode_local::paths::{self, Paths};
use opencode_mini::stdin::{self, INTERACTIVE_INPUT_ERROR};
use opencode_mini::{Input, InputError, signals::Trace};
use opencode_store::target::{self, TargetInput};

use super::Context;
use super::client::connect;
use crate::args::MiniArgs;
use crate::output::Exit;

pub fn run(context: &Context, args: &MiniArgs) -> anyhow::Result<()> {
    let start = Instant::now();
    if !std::io::stdout().is_terminal() {
        return fail("opencode mini requires a TTY stdout");
    }
    if let Some(limit) = args.replay_limit
        && limit <= 0
    {
        return fail("--replay-limit must be a positive integer");
    }
    if args.fork && !args.continue_ && args.session.is_none() {
        return fail("--fork requires --continue or --session");
    }
    let piped = match stdin::take_piped() {
        Ok(piped) => piped,
        Err(message) if message == INTERACTIVE_INPUT_ERROR => return fail(&message),
        Err(message) => anyhow::bail!(message),
    };
    let initial_input = stdin::merge_input(piped.as_deref(), args.prompt.as_deref());
    let Ok(directory) = paths::start_directory() else {
        let root = std::env::var("PWD").unwrap_or_default();
        return fail(&format!("Failed to change directory to {root}"));
    };
    let directory = directory.to_string_lossy().into_owned();
    let Ok(model) = target::parse_model(args.model.as_deref()) else {
        return fail("--model must use the format provider/model[#variant]");
    };
    let paths = Paths::from_env()?;
    let config = CliConfig::new(&paths).get().unwrap_or_else(|error| {
        log::warn!("failed to read cli.json: {error}");
        Default::default()
    });
    let mini = config.mini.clone().unwrap_or_default();
    // The TUI's tasks need a multi-threaded runtime: `App::runtime` uses the one it runs inside.
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .thread_name("opencode-mini")
        .build()?;
    let server = runtime.block_on(connect(context))?;
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let input = Input {
        client: server.client.clone(),
        theme_directories: opencode_ui::theme::config_directories(&paths.config, std::path::Path::new(&directory)),
        home: paths.home.clone(),
        trace: Trace::from_env(&paths.log, &directory, &argv),
        target: TargetInput {
            directory: Some(directory.clone()),
            continue_latest: args.continue_,
            session: args.session.clone().map(SessionID),
            fork: args.fork,
            model,
            agent: args.agent.clone(),
            environment: server.is_service().then(opencode_store::environment::session_environment),
        },
        directory,
        initial_input,
        replay: args.replay().or(mini.replay).unwrap_or(true),
        replay_limit: args.replay_limit.map(|limit| limit as u32).or(mini.replay_limit.map(|limit| limit.0 as u32)),
        config,
        version: crate::help::VERSION.to_owned(),
        start,
    };
    let _guard = runtime.enter();
    let result = opencode_mini::run(input);
    drop(server);
    match result {
        Err(error) if error.downcast_ref::<InputError>().is_some() => fail(&error.to_string()),
        result => result,
    }
}

/// `fail`: the error in TS's colors on stderr, then exit 1.
fn fail(message: &str) -> anyhow::Result<()> {
    eprintln!("\x1b[91m\x1b[1mError: \x1b[0m{message}");
    Err(Exit(1).into())
}
