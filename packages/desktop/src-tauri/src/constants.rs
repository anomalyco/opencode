use tauri_plugin_window_state::StateFlags;

pub const SETTINGS_STORE: &str = "opencode.settings.dat";
pub const DEFAULT_SERVER_URL_KEY: &str = "defaultServerUrl";
pub const WSL_ENABLED_KEY: &str = "wslEnabled";
// FORK: updater backend 总开关 — 当前 false 防 DeskFox 被上游 OpenCode 整壳替换。
// 未来 fork 自家 updater(DeskFox 自有 update 服务)上线时翻 true,index.tsx 内
// createPlatform 把 check()/install() 换成 DeskFox API 即可,UI 层(menu/settings/
// polling/error)无需改动,自动亮(updater-disable-adapter 2026-05-03)
pub const UPDATER_ENABLED: bool = false;

pub fn window_state_flags() -> StateFlags {
    StateFlags::all() - StateFlags::DECORATIONS - StateFlags::VISIBLE
}
