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

/// Runs `plugin add` on the TypeScript binary, then names each entry it added to `cli.json` while `opencode-native` will
/// not load it ([`not_loaded`]): TS adds a package there only when it has a TUI part and no server part, and `opencode-native`
/// loads such a package from the cache the install filled only on its JS host, which is on by default (js-npm, O-166).
fn add() -> error::Result<()> {
    let config = CliConfig::new(&Paths::from_env()?);
    let before = targets(&config);
    let child = delegate::spawn(&TsCommand::from_env(), std::env::args_os().skip(1))?;
    let code = delegate::exit_code(crate::signals::wait_child("plugin add", child, false)?);
    if code != 0 {
        return Err(Exit(u8::try_from(code).unwrap_or(1)).into());
    }
    for added in targets(&config).into_iter().filter(|target| !before.contains(target)) {
        if let Some(line) = not_loaded(&added) {
            println!("{line}");
        }
    }
    Ok(())
}

/// What `plugin add` says of the TUI package `added` when `opencode-native` will not load it: this build has no JS host
/// (ts-feature), or `OPENCODE_PLUGIN_JS` turns it off. With the JS host on it says nothing more, as TS.
fn not_loaded(added: &str) -> Option<String> {
    #[cfg(not(feature = "ts"))]
    return Some(format!(
        "opencode-native will not load TUI plugin \"{added}\": this build has no TypeScript plugin support (built \
         without the ts feature). The TypeScript client (opencode) loads it as it is."
    ));
    #[cfg(feature = "ts")]
    return opencode_plugin::pipe::turned_off(std::env::var_os("OPENCODE_PLUGIN_JS").as_deref()).then(|| {
        format!(
            "opencode-native loads TUI plugin \"{added}\" on its JS host, which OPENCODE_PLUGIN_JS turns off: unset it \
             to load it. The TypeScript client (opencode) loads it as it is."
        )
    });
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
