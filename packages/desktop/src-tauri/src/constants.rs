pub const SETTINGS_STORE: &str = "athena.settings.dat";
pub const DEFAULT_SERVER_URL_KEY: &str = "defaultServerUrl";
pub const DEFAULT_CDP_PORT: u16 = 9222;
pub const UPDATER_ENABLED: bool = option_env!("TAURI_SIGNING_PRIVATE_KEY").is_some();
