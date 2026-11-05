//! `acp`: the Agent Client Protocol server (`packages/cli/src/commands/handlers/acp.ts`).

use opencode_service::ts_command::TsCommand;

use super::Context;
use crate::args::{AcpArgs, AuthArgs, AuthCommand, AuthLoginArgs, Cli, Command, ServerFlags};
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

pub fn run(context: &Context, args: &AcpArgs) -> anyhow::Result<()> {
    if args.login {
        // TS runs the `auth login` handler with no target, method, or answers.
        let login = AuthLoginArgs { target: None, method: None, answer: Vec::new() };
        return super::auth::run(
            context,
            &AuthArgs { command: Some(AuthCommand::Login(login)), server: ServerFlags::default() },
        );
    }
    let print_logs = std::env::var("OPENCODE_PRINT_LOGS").as_deref() == Ok("1");
    let failure = opencode_acp::run(&TsCommand::from_env().standalone(), print_logs, crate::help::VERSION)?;
    let Some(failure) = failure else {
        return Ok(());
    };
    eprintln!("opencode acp: {failure}");
    Err(Exit(1).into())
}
