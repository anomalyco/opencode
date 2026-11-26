pub mod agent;
pub mod debug;
pub mod error_details;
pub mod execute;
pub mod experiments;
pub mod export;
pub mod file_changes;
pub mod fork;
pub mod free_models;
pub mod go_upsell;
pub mod go_upsell_art;
pub mod highlights;
pub mod image_preview;
pub mod integration;
pub mod mcp;
pub mod message;
pub mod model;
pub mod open;
pub mod pair;
pub mod pending_steer;
pub mod queued;
pub mod rename;
pub mod session_list;
pub mod settings;
pub mod shell_output;
pub mod skill;
pub mod speed;
pub mod stash;
pub mod status;
pub mod theme_list;
pub mod timeline;
pub mod update;
pub mod usage;
pub mod usage_model;
pub mod variant;
pub mod working_directory;
pub mod worktree_name;
pub mod worktrees;

use opencode_local::cli_config::Info;
use opencode_ui::scroll;

/// TS `getScrollAcceleration(config)`: `scroll.acceleration` first, then `scroll.speed`, else 3 rows a step.
pub fn scroll_config(info: &Info) -> scroll::Config {
    let config = info.scroll.as_ref();
    scroll::Config {
        speed: config.and_then(|config| config.speed).map_or(3.0, |speed| speed.0),
        acceleration: config.and_then(|config| config.acceleration) == Some(true),
    }
}
