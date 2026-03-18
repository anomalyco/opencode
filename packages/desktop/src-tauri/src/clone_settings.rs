use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

use crate::constants::{DEFAULT_CLONE_DIRECTORY_KEY, SETTINGS_STORE};

fn default_dir(app: &AppHandle) -> Result<String, String> {
    let home = app
        .path()
        .home_dir()
        .map_err(|e| format!("Failed to resolve home directory: {e}"))?;

    #[cfg(target_os = "linux")]
    {
        return Ok(home.join("code").to_string_lossy().to_string());
    }

    #[cfg(not(target_os = "linux"))]
    {
        Ok(home
            .join("Documents")
            .join("code")
            .to_string_lossy()
            .to_string())
    }
}

#[tauri::command]
#[specta::specta]
pub fn get_default_clone_directory(app: AppHandle) -> Result<String, String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;
    let dir = store
        .get(DEFAULT_CLONE_DIRECTORY_KEY)
        .and_then(|v| v.as_str().map(str::to_string))
        .filter(|v| !v.trim().is_empty());

    if let Some(dir) = dir {
        return Ok(dir);
    }

    default_dir(&app)
}

#[tauri::command]
#[specta::specta]
pub fn set_default_clone_directory(
    app: AppHandle,
    directory: Option<String>,
) -> Result<(), String> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| format!("Failed to open settings store: {}", e))?;

    if let Some(dir) = directory
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
    {
        store.set(DEFAULT_CLONE_DIRECTORY_KEY, serde_json::Value::String(dir));
    } else {
        store.delete(DEFAULT_CLONE_DIRECTORY_KEY);
    }

    store
        .save()
        .map_err(|e| format!("Failed to save settings: {}", e))?;

    Ok(())
}
