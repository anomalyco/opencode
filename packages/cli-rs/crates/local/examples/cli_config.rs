//! Reads the user's `cli.json` without writing anything, then edits a copy of it in a temporary
//! directory to show that comments and formatting stay.
//!
//!   bun run --cwd packages/cli-rs cargo run -q -p opencode-local --example cli_config

use std::fs;

use opencode_local::cli_config::{self, CliConfig, Resolved};
use opencode_local::paths::Paths;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let real = Paths::from_env()?;
    let file = real.config.join("cli.json");
    let text = fs::read_to_string(&file).unwrap_or_default();
    let info = cli_config::decode_text(&text).unwrap_or_default();
    let resolved = Resolved::new(info.clone(), |name| std::env::var(name).ok());
    let keys: Vec<String> = info
        .to_value()
        .as_object()
        .map_or(Vec::new(), |map| map.keys().cloned().collect());
    println!("file:      {} ({} bytes)", file.display(), text.len());
    // Compare with sha1(JSON.stringify(decoded)) on the TypeScript side.
    let decoded = opencode_local::jsonc::stringify(&info.to_value());
    println!("decoded:   sha1 {}", opencode_local::lock::hash(&decoded));
    println!("keys:      {}", keys.join(", "));
    println!(
        "theme:     {:?} / {:?}",
        info.theme.as_ref().and_then(|t| t.name.clone()),
        info.theme.as_ref().and_then(|t| t.mode).map(|m| m.as_str())
    );
    println!("keybinds:  {} overrides", resolved.keybinds().len());
    println!("leader:    {:?}", resolved.leader_timeout);
    println!(
        "tabs:      {} enabled={}",
        resolved.tabs.mode.as_str(),
        resolved.tabs.enabled
    );

    let temp = tempfile::tempdir()?;
    let paths = Paths::from_vars(|name| match name {
        "HOME" => Some(temp.path().into()),
        "XDG_CONFIG_HOME" => Some(temp.path().join("config").into()),
        "XDG_STATE_HOME" => Some(temp.path().join("state").into()),
        _ => None,
    })?;
    fs::create_dir_all(&paths.config)?;
    fs::write(paths.config.join("cli.json"), &text)?;
    let config = CliConfig::with_content(&paths, None);
    config.update(|info| {
        let theme = info.theme.get_or_insert_default();
        theme.mode = Some(match theme.mode {
            Some(cli_config::ThemeMode::Dark) => cli_config::ThemeMode::Light,
            _ => cli_config::ThemeMode::Dark,
        });
    })?;
    let updated = fs::read_to_string(config.path())?;
    let before: Vec<&str> = text.lines().collect();
    println!("edit of a temporary copy (theme.mode toggled), changed lines:");
    for line in updated.lines().filter(|line| !before.contains(line)) {
        println!("  + {line}");
    }
    for line in before
        .iter()
        .filter(|line| !updated.lines().any(|l| l == **line))
    {
        println!("  - {line}");
    }
    Ok(())
}
