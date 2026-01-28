use tauri::{AppHandle, Manager};

const SETTINGS_STORE: &str = "opencode.settings.dat";
const SERVER_URL_KEY: &str = "server_url";

/// Get the configured server URL
pub fn get_server_url(app: &AppHandle) -> Option<String> {
    let store = app.store(SETTINGS_STORE).ok()?;

    let url = store.get(SERVER_URL_KEY);
    url.and_then(|v| v.as_str().map(String::from))
}

/// Set the server URL
pub fn set_server_url(app: &AppHandle, url: String) -> Result<(), String> {
    let store = app.store(SETTINGS_STORE).map_err(|e| format!("Failed to open settings store: {}", e))?;

    store.set(SERVER_URL_KEY, serde_json::Value::String(url));
    store.save().map_err(|e| format!("Failed to save settings: {}", e))?;

    Ok(())
}

/// Clear the server URL (reset to default)
pub fn clear_server_url(app: &AppHandle) -> Result<(), String> {
    let store = app.store(SETTINGS_STORE).map_err(|e| format!("Failed to open settings store: {}", e))?;

    store.delete(SERVER_URL_KEY);
    store.save().map_err(|e| format!("Failed to save settings: {}", e))?;

    Ok(())
}

/// Check if a server URL is configured
pub fn has_server_url(app: &AppHandle) -> bool {
    get_server_url(app).is_some()
}
