//! `acp`: the Agent Client Protocol server (`packages/cli/src/commands/handlers/acp.ts`).

use opencode_service::ts_command::TsCommand;

use super::{Context, not_built};
use crate::args::{AcpArgs, Cli, Command};
use crate::output::Exit;

/// Names the client `acp` in logs and in the server it starts (TS sets `OPENCODE_CLIENT` in the
/// handler). Runs before the logger and any other thread start.
#[allow(unsafe_code)]
pub fn before_logger(cli: &Cli) {
    if let Some(Command::Acp(args)) = &cli.command
        && !args.login
    {
        // SAFETY: called from `main` before the logger, signal, and runtime threads start.
        unsafe { std::env::set_var("OPENCODE_CLIENT", "acp") };
    }
}

pub fn run(_context: &Context, args: &AcpArgs) -> anyhow::Result<()> {
    if args.login {
        return opencode_acp::login::run().unwrap_or_else(|| not_built("acp --login", "C.12"));
    }
    let print_logs = std::env::var("OPENCODE_PRINT_LOGS").as_deref() == Ok("1");
    let failure = opencode_acp::run(
        &TsCommand::from_env().standalone(),
        print_logs,
        crate::help::VERSION,
    )?;
    let Some(failure) = failure else {
        return Ok(());
    };
    eprintln!("opencode acp: {failure}");
    Err(Exit(1).into())
}
