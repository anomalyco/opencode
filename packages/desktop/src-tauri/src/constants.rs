use tauri_plugin_window_state::StateFlags;

pub const SETTINGS_STORE: &str = "opencode.settings.dat";
pub const DEFAULT_SERVER_URL_KEY: &str = "defaultServerUrl";
pub const CUSTOM_EDITOR_PATH_KEY: &str = "customEditorPath";
pub const DEFAULT_EDITOR_KEY: &str = "defaultEditor";
pub const WSL_ENABLED_KEY: &str = "wslEnabled";
pub const OPENCLAW_URL_KEY: &str = "openclawUrl";
pub const OPENCLAW_TOKEN_KEY: &str = "openclawToken";
pub const OPENCLAW_ENABLED_KEY: &str = "openclawEnabled";
pub const GENERICAGENT_ENABLED_KEY: &str = "genericagentEnabled";
pub const GENERICAGENT_PYTHON_KEY: &str = "genericagentPython";
pub const GENERICAGENT_DIR_KEY: &str = "genericagentDir";
pub const UPDATER_ENABLED: bool = option_env!("TAURI_SIGNING_PRIVATE_KEY").is_some();

pub fn window_state_flags() -> StateFlags {
    StateFlags::all() - StateFlags::DECORATIONS - StateFlags::VISIBLE
}
