//! `plugin`, delegated to the TypeScript CLI (D.1): the subcommands install with npm and resolve
//! entrypoints with `Host.resolve`. `plugin add` waits for it, and then says when what it added to `cli.json` is a TUI
//! plugin `opencode-native` will not load (FT-11).

use opencode_local::cli_config::{self, CliConfig, Plugin};
use opencode_local::paths::Paths;
use opencode_service::delegate;
use opencode_service::ts_command::TsCommand;
use opencode_util::error;

use super::Context;
use crate::args::{PluginArgs, PluginCommand};
use crate::output::Exit;

pub fn run(_context: &Context, args: &PluginArgs) -> error::Result<()> {
    // The TypeScript binary replaces this process, or runs beside it, so this process's queued records go first.
    match &args.command {
        None => crate::help::print(&["plugin"]),
        Some(PluginCommand::Add) => {
            crate::telemetry::flush();
            add()
        }
        Some(_) => {
            crate::telemetry::flush();
            Err(delegate::forward().into())
        }
    }
}

/// Runs `plugin add` on the TypeScript binary, then names each entry it added to `cli.json`: TS adds a package there
/// only when it has a TUI part and no server part, and `opencode-native` loads no TUI plugin named by npm package.
fn add() -> error::Result<()> {
    let config = CliConfig::new(&Paths::from_env()?);
    let before = targets(&config);
    let child = delegate::spawn(&TsCommand::from_env(), std::env::args_os().skip(1))?;
    let code = delegate::exit_code(crate::signals::wait_child("plugin add", child, false)?);
    if code != 0 {
        return Err(Exit(u8::try_from(code).unwrap_or(1)).into());
    }
    let plugins = config.path().parent().map(|dir| dir.join("plugins")).unwrap_or_default();
    for added in targets(&config).into_iter().filter(|target| !before.contains(target)) {
        println!(
            "opencode-native will not load TUI plugin \"{added}\": it does not install or load TUI plugins named by npm \
             package. The TypeScript client (opencode) loads it. To try it in opencode-native, install the package as a \
             directory under {} and set OPENCODE_PLUGIN_JS=1.",
            plugins.display()
        );
    }
    Ok(())
}

/// The `plugins` targets of `cli.json` as the file holds them now.
fn targets(config: &CliConfig) -> Vec<String> {
    let info = std::fs::read_to_string(config.path()).ok().and_then(|text| cli_config::decode_text(&text));
    let plugins = info.and_then(|info| info.plugins).unwrap_or_default();
    plugins
        .into_iter()
        .map(|plugin| match plugin {
            Plugin::Name(name) => name,
            Plugin::Package { package, .. } => package,
        })
        .collect()
}
