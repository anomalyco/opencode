//! One module per top-level command. Each step fills its own module (plan 8.4).

pub mod acp;
pub mod api;
pub mod auth;
pub mod client;
pub mod debug;
pub mod default;
pub mod mcp;
pub mod mini;
pub mod models;
pub mod pair;
pub mod plugin;
pub mod reload;
pub mod run;
pub mod serve;
pub mod service;
pub mod session;
pub mod stats;
pub mod uninstall;
pub mod upgrade;

use crate::args::{Cli, Command, GlobalArgs, ServerFlags};

/// What every handler gets besides its own arguments.
#[allow(dead_code, reason = "read by the handlers of later steps")]
pub struct Context {
    pub global: GlobalArgs,
    /// `--standalone` and `--server` for the selected command, wherever they were given (`args::validate`).
    pub server: ServerFlags,
}

pub fn run(context: &Context, cli: &Cli) -> anyhow::Result<()> {
    let Some(command) = &cli.command else {
        return default::run(context, &cli.root);
    };
    match command {
        Command::Upgrade(args) => upgrade::run(context, args),
        Command::Uninstall(args) => uninstall::run(context, args),
        Command::Acp(args) => acp::run(context, args),
        Command::Api(args) => api::run(context, args),
        Command::Debug(args) => debug::run(context, args),
        Command::Auth(args) => auth::run(context, args),
        Command::Mcp(args) => mcp::run(context, args),
        Command::Plugin(args) => plugin::run(context, args),
        Command::Models(_) => models::run(context),
        Command::Stats(args) => stats::run(context, args),
        Command::Mini(args) => mini::run(context, args),
        Command::Run(args) => run::run(context, args),
        Command::Session(args) => session::run(context, args),
        Command::Service(args) => service::run(context, args),
        Command::Reload(_) => reload::run(context),
        Command::Pair(args) => pair::run(context, args),
        Command::Serve(args) => serve::run(context, args),
    }
}
