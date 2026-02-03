use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Default, Serialize, Deserialize)]
struct DisplayConfig {
    wayland: Option<bool>,
}

fn dir() -> Option<PathBuf> {
    if let Ok(value) = std::env::var("XDG_CONFIG_HOME") {
        return Some(PathBuf::from(value).join("opencode"));
    }

    let home = std::env::var("HOME").ok()?;
    Some(PathBuf::from(home).join(".config").join("opencode"))
}

fn path() -> Option<PathBuf> {
    dir().map(|dir| dir.join("desktop.json"))
}

pub fn read_wayland() -> Option<bool> {
    let path = path()?;
    let raw = std::fs::read_to_string(path).ok()?;
    let config = serde_json::from_str::<DisplayConfig>(&raw).ok()?;
    config.wayland
}

pub fn write_wayland(value: bool) -> Result<(), String> {
    let dir = dir().ok_or_else(|| "Could not resolve config directory".to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let data = serde_json::to_string_pretty(&DisplayConfig {
        wayland: Some(value),
    })
    .map_err(|e| e.to_string())?;
    std::fs::write(dir.join("desktop.json"), data).map_err(|e| e.to_string())?;
    Ok(())
}
