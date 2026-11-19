mod args;
mod askpass;
mod commands;
mod completions;
mod contain;
mod env;
mod help;
mod output;
mod panic;
mod parse;
mod prompt;
mod signals;
mod telemetry;
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
    // Before any thread starts: the TUI may run under a parent that restarts it after a plugin crash.
    let raw = match contain::start(std::env::args_os().collect()) {
        Ok(raw) => raw,
        // The client's whole code: on Windows it may not fit in a byte.
        Err(code) => std::process::exit(code),
    };
    // Bun decodes the arguments the same way, with U+FFFD for bytes that are not UTF-8. Nothing reads the raw
    // arguments again.
    let args: Vec<String> = raw.iter().skip(1).map(|arg| arg.to_string_lossy().into_owned()).collect();
    // `plugin dev` and `plugin test` are the native plugin author's, and not in the TypeScript tree the parser follows.
    // `plugin dev` starts once the rest of its line parsed as the TUI's, and the process environment is set.
    let (args, dev) = match commands::plugin_dev::take(&args) {
        None => (args, None),
        Some(Err(error)) => return exit(Err(error)),
        Some(Ok(commands::plugin_dev::Native::Help(usage))) => {
            println!("{usage}");
            return ExitCode::SUCCESS;
        }
        Some(Ok(commands::plugin_dev::Native::Test(test))) => {
            return exit(commands::plugin_dev::test(&test, &mut std::io::stdout()));
        }
        Some(Ok(commands::plugin_dev::Native::Dev { dir, rest })) => (rest, Some(dir)),
    };
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
    let options = telemetry::Options::from_env(cli.global.log_level);
    let channel = options.channel.clone();
    telemetry::install(options);
    signals::install();
    let _terminal = signals::on_shutdown("restore the terminal", prompt::restore_terminal);
    let dev = match dev.map(|dir| commands::plugin_dev::start(&dir, cli.command.is_none())).transpose() {
        Ok(dev) => dev,
        Err(error) => return exit(Err(error)),
    };
    let logged = serde_json::to_string(&logged_args(&args)).unwrap_or_default();
    log::info!(
        version = help::VERSION,
        commit = help::COMMIT,
        channel = channel.as_str(),
        local = channel == "local",
        client = env::client().as_str(),
        args = logged.as_str();
        "cli starting"
    );
    if let Some(server) = opencode_util::bundle::server() {
        log::info!(path = server.display().to_string().as_str(); "bundled server");
    }
    let context =
        commands::Context { server: invocation.server.clone(), args, dev: dev.as_ref().map(|dev| dev.library.clone()) };
    let result = commands::run(&context, cli);
    if let Some(error) = result.as_ref().err().filter(|error| error.downcast_ref::<output::Exit>().is_none()) {
        log::error!(cause = format!("{error:#}").as_str(), args = logged.as_str(); "cli process failed");
    }
    exit(result)
}

/// `service set <key> <value>` and `service set env <name> <value>` carry secrets such as the password or a provider
/// key; the logged arguments keep the values out. Flags and their values may come first, so the pair is found anywhere.
fn logged_args(args: &[String]) -> Vec<&str> {
    let set = args.windows(2).position(|pair| pair[0] == "service" && pair[1] == "set");
    let kept =
        set.map_or(args.len(), |set| set + if args.get(set + 2).is_some_and(|arg| arg == "env") { 4 } else { 3 });
    args.iter().enumerate().map(|(index, arg)| if index < kept { arg.as_str() } else { "<redacted>" }).collect()
}

fn exit(result: error::Result<()>) -> ExitCode {
    let code = match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => ExitCode::from(output::fail(error)),
    };
    telemetry::flush();
    code
}

// Child servers inherit the print-logs setting.
#[allow(unsafe_code)]
fn set_print_logs() {
    // SAFETY: no other thread runs yet; handlers start their runtimes after this.
    unsafe { std::env::set_var("OPENCODE_PRINT_LOGS", "1") };
}
