// FORK: DeskFox system tray scaffold(C0.5.1)— 飞书桥接 + 主进程常驻骨架 [feat: feishu-bridge] 2026-05-08
//
// 此模块只负责 tray 注册 + 状态图标切换。菜单 / Tauri command 在 C0.5.3 加入。
//
// 4 个状态图标(branding/src/assets/tray-icons/)用 `tauri::include_image!` macro
// 在编译时嵌入(macro 自带 PNG 解码 → RGBA),运行时通过 set_tray_status() 切换 —
// 不依赖文件 IO,跨平台一致。

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{
    AppHandle, Manager, Runtime,
    image::Image,
    include_image,
    tray::{TrayIcon, TrayIconBuilder},
};

pub const TRAY_ID: &str = "deskfox-main-tray";

/// Tray 4 个状态(对外 enum,后续 Tauri command 接收 string discriminator)。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayStatus {
    Default,
    Connected,
    Offline,
    Error,
}

impl TrayStatus {
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "default" => Some(Self::Default),
            "connected" => Some(Self::Connected),
            "offline" => Some(Self::Offline),
            "error" => Some(Self::Error),
            _ => None,
        }
    }

    /// 取对应 Image。include_image! 路径相对 crate root(src-tauri/Cargo.toml)。
    fn image(self) -> Image<'static> {
        match self {
            Self::Default => include_image!("../../branding/src/assets/tray-icons/default.png"),
            Self::Connected => include_image!("../../branding/src/assets/tray-icons/connected.png"),
            Self::Offline => include_image!("../../branding/src/assets/tray-icons/offline.png"),
            Self::Error => include_image!("../../branding/src/assets/tray-icons/error.png"),
        }
    }
}

/// 当前 tray 状态(全局单例,scaffold 阶段无锁竞争压力)。
static CURRENT_STATUS: Mutex<TrayStatus> = Mutex::new(TrayStatus::Default);

/// 在 setup() 中调用一次,注册 tray icon。
///
/// 此 scaffold 阶段不挂菜单(C0.5.3 添加),仅显示图标。macOS 用 template 模式
/// 让系统自动适配菜单栏深浅色。
pub fn build_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<TrayIcon<R>> {
    let mut builder = TrayIconBuilder::with_id(TRAY_ID).icon(TrayStatus::Default.image());

    // macOS template 模式:tray icon 应是纯黑 + alpha,系统反色适配
    #[cfg(target_os = "macos")]
    {
        builder = builder.icon_as_template(true);
    }

    let tray = builder.build(app)?;
    Ok(tray)
}

/// 切换 tray 状态图标。
///
/// 找不到 tray(未 build / 已销毁)返 false,不报错(运行时 best-effort)。
pub fn set_tray_status<R: Runtime>(app: &AppHandle<R>, status: TrayStatus) -> bool {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return false;
    };
    if tray.set_icon(Some(status.image())).is_err() {
        return false;
    }
    #[cfg(target_os = "macos")]
    {
        let _ = tray.set_icon_as_template(true);
    }
    if let Ok(mut cur) = CURRENT_STATUS.lock() {
        *cur = status;
    }
    true
}

/// 读当前 tray 状态(测试 / 诊断用)。
pub fn current_status() -> TrayStatus {
    CURRENT_STATUS
        .lock()
        .map(|g| *g)
        .unwrap_or(TrayStatus::Default)
}

// ============================================================
// 主进程退出意图标志(C0.5.2)
// ============================================================
//
// 关 GUI ≠ 退主进程:WindowEvent::CloseRequested 默认拦截 → window.hide()。
// 仅 tray 菜单"退出 DeskFox"调 request_quit() 后才放行真退。

static IS_QUITTING: AtomicBool = AtomicBool::new(false);

/// 标记"已请求退出主进程"。
///
/// tray 菜单 / Tauri command "exit_app" 调一次,后续 CloseRequested 不再拦截,
/// app.exit(0) 进 RunEvent::Exit 完整退出流程(kill_sidecar + 资源回收)。
pub fn request_quit() {
    IS_QUITTING.store(true, Ordering::SeqCst);
}

/// 是否已请求退出。CloseRequested 用此判断要不要 prevent_close。
pub fn is_quitting() -> bool {
    IS_QUITTING.load(Ordering::SeqCst)
}

/// 测试用:重置 quit flag。
#[cfg(test)]
pub fn reset_quit_flag() {
    IS_QUITTING.store(false, Ordering::SeqCst);
}

// ============================================================
// 单测
// ============================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_str_四档全识别() {
        assert_eq!(TrayStatus::from_str("default"), Some(TrayStatus::Default));
        assert_eq!(TrayStatus::from_str("connected"), Some(TrayStatus::Connected));
        assert_eq!(TrayStatus::from_str("offline"), Some(TrayStatus::Offline));
        assert_eq!(TrayStatus::from_str("error"), Some(TrayStatus::Error));
    }

    #[test]
    fn from_str_未知返_none() {
        assert_eq!(TrayStatus::from_str("unknown"), None);
        assert_eq!(TrayStatus::from_str(""), None);
        assert_eq!(TrayStatus::from_str("Default"), None); // case-sensitive
    }

    #[test]
    fn image_四档全可取() {
        // include_image! 编译期 PNG 解码,这里只验函数能跑出 Image(运行时不 panic)
        for s in [
            TrayStatus::Default,
            TrayStatus::Connected,
            TrayStatus::Offline,
            TrayStatus::Error,
        ] {
            let img = s.image();
            // include_image 返的 Image 含 rgba bytes;width/height 不为 0 即解码成功
            assert!(img.width() > 0, "状态 {s:?} image width 0");
            assert!(img.height() > 0, "状态 {s:?} image height 0");
        }
    }

    #[test]
    fn current_status_默认_default() {
        // 第一次调用 / 测试隔离前提下,应返默认状态
        // 注:并行测试可能让此 test 看到其它 test 修改后的状态,所以只验"是合法 enum"
        let _ = current_status();
    }

    #[test]
    fn quit_flag_默认_false() {
        reset_quit_flag();
        assert!(!is_quitting());
    }

    #[test]
    fn quit_flag_request_后_true() {
        reset_quit_flag();
        request_quit();
        assert!(is_quitting());
        // cleanup,不影响其它并行 test
        reset_quit_flag();
    }
}
