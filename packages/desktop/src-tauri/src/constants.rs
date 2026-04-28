use tauri_plugin_window_state::StateFlags;

pub const SETTINGS_STORE: &str = "opencode.settings.dat";
pub const DEFAULT_SERVER_URL_KEY: &str = "defaultServerUrl";
pub const WSL_ENABLED_KEY: &str = "wslEnabled";
// FORK: 永久关闭官方自动升级,防止 DeskFox 被替换为上游 OpenCode(禁自动升级 2026-04-28)
// 不依赖 TAURI_SIGNING_PRIVATE_KEY env 缺失这种"运气好"的兜底,直接 hard-code false
pub const UPDATER_ENABLED: bool = false;

pub fn window_state_flags() -> StateFlags {
    StateFlags::all() - StateFlags::DECORATIONS - StateFlags::VISIBLE
}
