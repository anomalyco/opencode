//! The opencode-rs binary.

mod args;
mod askpass;
mod commands;
mod env;
mod help;
mod output;
mod panic;
mod prompt;
mod signals;
mod telemetry;
mod update;
mod wizard;

#[cfg(test)]
mod tests;

use std::process::ExitCode;

use clap::FromArgMatches;

fn main() -> ExitCode {
    env::apply_no_proxy();
    // OpenSSH runs this binary as its askpass helper; that mode skips the CLI and its logs.
    if let Some(port) = askpass::port() {
        return ExitCode::from(askpass::run(&port));
    }
    let command = help::command();
    let argv = match args::normalize(&command, std::env::args_os().collect()) {
        Ok(argv) => argv,
        Err(message) => return usage_error(&message),
    };
    let matches = match command.clone().try_get_matches_from(argv) {
        Ok(matches) => matches,
        Err(error) => {
            // Effect CLI exits 1 on a usage error; clap would exit 2. Help output (`--help`) exits 0.
            let _ = error.print();
            return ExitCode::from(u8::from(error.use_stderr()));
        }
    };
    let cli = match args::Cli::from_arg_matches(&matches) {
        Ok(cli) => cli,
        Err(error) => return usage_error(&error.to_string()),
    };
    let server = match args::validate(&command, &matches) {
        Ok(server) => server,
        Err(message) => return usage_error(&message),
    };
    let result = match &cli.global {
        // Effect CLI runs the first action flag given, in this order, instead of the command.
        global if global.version => help::version(),
        global if global.wizard => wizard::run(),
        args::GlobalArgs {
            completions: Some(shell),
            ..
        } => help::completions(*shell),
        global => {
            if global.print_logs {
                set_print_logs();
            }
            commands::acp::before_logger(&cli);
            telemetry::install(telemetry::Options::from_env(global.log_level));
            signals::install();
            let _terminal = signals::on_shutdown("restore the terminal", prompt::restore_terminal);
            let args = serde_json::to_string(
                &std::env::args_os()
                    .skip(1)
                    .map(|arg| arg.to_string_lossy().into_owned())
                    .collect::<Vec<_>>(),
            )
            .unwrap_or_default();
            log::info!(
                version = help::VERSION,
                channel = telemetry::CHANNEL,
                local = telemetry::CHANNEL == "local",
                client = env::client().as_str(),
                args = args.as_str();
                "cli starting"
            );
            let result = commands::run(
                &commands::Context {
                    global: global.clone(),
                    server,
                },
                &cli,
            );
            if let Some(error) = result
                .as_ref()
                .err()
                .filter(|error| error.downcast_ref::<output::Exit>().is_none())
            {
                log::error!(cause = format!("{error:#}").as_str(), args = args.as_str(); "cli process failed");
            }
            result
        }
    };
    let code = match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => ExitCode::from(output::fail(error)),
    };
    telemetry::flush();
    code
}

fn usage_error(message: &str) -> ExitCode {
    eprintln!("error: {message}\n\nFor more information, try '--help'.");
    ExitCode::from(1)
}

// The TypeScript CLI sets OPENCODE_PRINT_LOGS for its logger and for the servers it starts
// (framework/runtime.ts:98).
#[allow(unsafe_code)]
fn set_print_logs() {
    // SAFETY: no other thread runs yet; handlers start their runtimes after this.
    unsafe { std::env::set_var("OPENCODE_PRINT_LOGS", "1") };
}
