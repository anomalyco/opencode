use serde::{Deserialize, Serialize};
use serde_json::json;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

use crate::constants::SETTINGS_STORE;

pub const LINUX_DISPLAY_CONFIG_KEY: &str = "linuxDisplayConfig";

#[derive(Default, Serialize, Deserialize)]
struct DisplayConfig {
    wayland: Option<bool>,
}

fn dir() -> Option<PathBuf> {
    Some(dirs::data_dir()?.join("ai.opencode.desktop"))
}

fn path() -> Option<PathBuf> {
    dir().map(|dir| dir.join(SETTINGS_STORE))
}

pub fn read_wayland() -> Option<bool> {
    let path = path()?;
    let raw = std::fs::read_to_string(path).ok()?;
    let config = serde_json::from_str::<DisplayConfig>(&raw).ok()?;
    config.wayland
}

pub fn write_wayland(app: &AppHandle, value: bool) -> Result<(), String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;

    store.set(
        LINUX_DISPLAY_CONFIG_KEY,
        json!(DisplayConfig {
            wayland: Some(value),
        }),
    );
    store
        .save()
        .map_err(|e| format!("Failed to save settings store: {}", e))?;

    Ok(())
}
