//! The clap command built from `args::Cli`, and the output of the built-in flags: help, version, completions.

use std::io::IsTerminal;

use clap::CommandFactory;

use crate::args::{Cli, Shell};
use crate::output;

// Like the TypeScript CLI, a build without OPENCODE_VERSION reports "local".
pub const VERSION: &str = match option_env!("OPENCODE_VERSION") {
    Some(version) => version,
    None => "local",
};

/// The program name in help, version, and completions (plan 6.1).
pub fn name() -> String {
    std::env::var("OPENCODE_CLI_NAME").ok().filter(|name| !name.is_empty()).unwrap_or_else(|| "opencode-rs".into())
}

/// The unbuilt tree: each command holds only the arguments it declares.
pub fn tree() -> clap::Command {
    let name = name();
    configure(Cli::command()).name(name.clone()).bin_name(name)
}

/// The tree with global flags propagated to every command, as parsing sees it.
pub fn command() -> clap::Command {
    let mut command = tree();
    command.build();
    headings(command)
}

// Like Effect CLI's help, a command's own flags come first and the global flags after them, each under a
// heading. Propagated globals keep the root's display order, which would mix them into the command's own.
fn headings(command: clap::Command) -> clap::Command {
    command
        .mut_args(|arg| match (arg.is_global_set(), arg.is_positional()) {
            (true, _) => {
                let order = arg.get_display_order();
                arg.help_heading("Global flags").display_order(1000 + order)
            }
            (false, true) => arg,
            (false, false) => arg.help_heading("Flags"),
        })
        .mut_subcommands(headings)
}

// Effect CLI has no `help` subcommand, describes `--help` itself (args::GlobalArgs), and reads `-1` as a value.
fn configure(command: clap::Command) -> clap::Command {
    command
        .disable_help_flag(true)
        .disable_version_flag(true)
        .disable_help_subcommand(true)
        .allow_negative_numbers(true)
        .mut_subcommands(configure)
}

/// Prints the help of the command at `path` (names below the root) to stdout.
pub fn print(path: &[&str]) -> anyhow::Result<()> {
    let mut command = command();
    let node =
        path.iter().fold(&mut command, |node, name| node.find_subcommand_mut(name).expect("help path names a command"));
    let help = node.render_help();
    match std::io::stdout().is_terminal() {
        true => output::print(&help.ansi().to_string()),
        false => output::print(&help.to_string()),
    }
}

pub fn version() -> anyhow::Result<()> {
    output::print(&format!("{} v{VERSION}\n", name()))
}

/// `sh` means bash and `pwsh` PowerShell, as in Effect CLI (GlobalFlag.ts:226-227).
pub fn completions(shell: Shell) -> anyhow::Result<()> {
    let shell = match shell {
        Shell::Bash | Shell::Sh => clap_complete::Shell::Bash,
        Shell::Zsh => clap_complete::Shell::Zsh,
        Shell::Fish => clap_complete::Shell::Fish,
        Shell::Powershell | Shell::Pwsh => clap_complete::Shell::PowerShell,
    };
    let mut command = command();
    let mut script = Vec::new();
    clap_complete::generate(shell, &mut command, name(), &mut script);
    output::print(&String::from_utf8_lossy(&script))
}
