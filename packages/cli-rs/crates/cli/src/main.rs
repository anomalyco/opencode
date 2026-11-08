//! The opencode-rs binary.

mod args;
mod askpass;
mod commands;
mod completions;
mod env;
mod help;
mod output;
mod panic;
mod parse;
mod prompt;
mod signals;
mod telemetry;
mod update;
mod wizard;

#[cfg(test)]
mod tests;

use opencode_util::error;
use std::process::ExitCode;

use parse::Outcome;

fn main() -> ExitCode {
    env::apply_no_proxy();
    // OpenSSH runs this binary as its askpass helper; that mode skips the CLI and its logs.
    if let Some(port) = askpass::port() {
        return ExitCode::from(askpass::run(&port));
    }
    let raw: Vec<_> = std::env::args_os().collect();
    // Bun decodes the arguments the same way, with U+FFFD for bytes that are not UTF-8. Nothing reads the raw
    // arguments again.
    let args: Vec<String> = raw.iter().skip(1).map(|arg| arg.to_string_lossy().into_owned()).collect();
    prompt::init(&args);
    let invocation = match parse::parse(&args, &help::name()) {
        Outcome::Help(path) => return exit(help::show(&path)),
        Outcome::Version => return exit(help::version()),
        Outcome::Completions(shell) => return exit(help::completions(shell)),
        Outcome::Wizard(path) => {
            signals::install();
            let _terminal = signals::on_shutdown("restore the terminal", prompt::restore_terminal);
            return exit(wizard::run(&path, &raw));
        }
        // Effect CLI prints the command's help and the errors, and exits 1.
        Outcome::Usage { path, errors } => {
            let _ = help::show(&path);
            eprint!("{}", help::error_output(&errors, help::colors(), help::stderr_colors()));
            return ExitCode::from(1);
        }
        Outcome::Run(invocation) => invocation,
    };
    let cli = &invocation.cli;
    if cli.global.print_logs {
        set_print_logs();
    }
    commands::acp::before_logger(cli);
    telemetry::install(telemetry::Options::from_env(cli.global.log_level));
    signals::install();
    let _terminal = signals::on_shutdown("restore the terminal", prompt::restore_terminal);
    let logged = serde_json::to_string(&args).unwrap_or_default();
    log::info!(
        version = help::VERSION,
        channel = telemetry::CHANNEL,
        local = telemetry::CHANNEL == "local",
        client = env::client().as_str(),
        args = logged.as_str();
        "cli starting"
    );
    let result = commands::run(&commands::Context { server: invocation.server.clone(), args }, cli);
    if let Some(error) = result.as_ref().err().filter(|error| error.downcast_ref::<output::Exit>().is_none()) {
        log::error!(cause = format!("{error:#}").as_str(), args = logged.as_str(); "cli process failed");
    }
    exit(result)
}

fn exit(result: error::Result<()>) -> ExitCode {
    let code = match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => ExitCode::from(output::fail(error)),
    };
    telemetry::flush();
    code
}

// The TypeScript CLI sets OPENCODE_PRINT_LOGS for its logger and for the servers it starts
// (framework/runtime.ts:98).
#[allow(unsafe_code)]
fn set_print_logs() {
    // SAFETY: no other thread runs yet; handlers start their runtimes after this.
    unsafe { std::env::set_var("OPENCODE_PRINT_LOGS", "1") };
}
