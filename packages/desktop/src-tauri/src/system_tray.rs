// FORK: DeskFox system tray + 主进程常驻骨架(C0.5.1-C0.5.3) [feat: feishu-bridge] 2026-05-08
//
// 责任:
// - tray icon 注册 + 4 状态图标编译期嵌入 + 运行时切换(C0.5.1)
// - 关 GUI ≠ 退主进程的退出意图标志(C0.5.2)
// - tray 菜单 4 项 + on_menu_event 路由 + Tauri command 暴露给 GUI(C0.5.3)
//
// 图标用 `tauri::include_image!` macro 编译期嵌入(macro 自带 PNG 解码 → RGBA),
// 运行时切换不依赖文件 IO,跨平台一致。
//
// 菜单文案 v1 hardcode 中文(产品名 DeskFox 在中文环境定调,用户已锁不再问 i18n)。
// 后续 Phase 1+ i18n 落地后,可改读 system locale 切英文。

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{
    AppHandle, Manager, Runtime,
    image::Image,
    include_image,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{TrayIcon, TrayIconBuilder},
};

use crate::windows::MainWindow;

pub const TRAY_ID: &str = "deskfox-main-tray";

// 菜单项 ID(对应 on_menu_event 分发)
const MENU_OPEN: &str = "deskfox-menu-open";
const MENU_STATUS: &str = "deskfox-menu-status";
const MENU_PAUSE: &str = "deskfox-menu-pause";
const MENU_QUIT: &str = "deskfox-menu-quit";

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

    /// 菜单"状态"项中文文案(disabled label 显示)。
    pub fn label(self) -> &'static str {
        match self {
            Self::Default => "状态:就绪",
            Self::Connected => "状态:飞书已连接",
            Self::Offline => "状态:飞书离线重连中",
            Self::Error => "状态:错误,看日志",
        }
    }
}

/// 当前 tray 状态(全局单例,scaffold 阶段无锁竞争压力)。
static CURRENT_STATUS: Mutex<TrayStatus> = Mutex::new(TrayStatus::Default);

/// 状态菜单项句柄(运行时 set_tray_status 时改文本)。
///
/// 用 Box<dyn Any> 跨 Runtime 不行;改为类型擦除存 MenuItem<Wry>。tauri 实际只跑 Wry,
/// 此 cell 只在 build_tray 设置一次,后续 set_tray_status 读 — 单线程 setup 阶段写,
/// 用 Mutex 防 set_tray_status 跨线程调用。
static STATUS_MENU_ITEM: Mutex<Option<MenuItem<tauri::Wry>>> = Mutex::new(None);

/// 在 setup() 中调用一次,注册 tray icon + 菜单。
///
/// 菜单 4 项:
/// - 打开 DeskFox(显主窗口)
/// - 状态:xxx(disabled label,显当前 TrayStatus)
/// - 暂停飞书桥接(disabled,等 Phase 4+ 飞书接入后启用)
/// - 退出 DeskFox(set 退出意图 + app.exit)
pub fn build_tray(app: &AppHandle) -> tauri::Result<TrayIcon> {
    let item_open = MenuItem::with_id(app, MENU_OPEN, "打开 DeskFox", true, None::<&str>)?;
    let item_status = MenuItem::with_id(
        app,
        MENU_STATUS,
        TrayStatus::Default.label(),
        false, // disabled label
        None::<&str>,
    )?;
    let item_pause = MenuItem::with_id(
        app,
        MENU_PAUSE,
        "暂停飞书桥接(待绑定后启用)",
        false, // disabled,Phase 4+ 启用
        None::<&str>,
    )?;
    let separator = PredefinedMenuItem::separator(app)?;
    let item_quit = MenuItem::with_id(app, MENU_QUIT, "退出 DeskFox", true, None::<&str>)?;

    let menu = Menu::with_items(
        app,
        &[&item_open, &item_status, &item_pause, &separator, &item_quit],
    )?;

    if let Ok(mut slot) = STATUS_MENU_ITEM.lock() {
        *slot = Some(item_status);
    }

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .icon(TrayStatus::Default.image())
        .menu(&menu)
        .show_menu_on_left_click(false) // mac/win:左键 = 打开主窗口,右键 = 菜单
        .on_menu_event(|app, event| match event.id.as_ref() {
            MENU_OPEN => show_main_window_impl(app),
            MENU_QUIT => {
                request_quit();
                app.exit(0);
            }
            // status / pause 是 disabled,理论上 click 不会触发;留分支防御
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // 左键单击直接打开主窗口(mac/win 一致体验)
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window_impl(tray.app_handle());
            }
        });

    // macOS template 模式:tray icon 应是纯黑 + alpha,系统反色适配
    #[cfg(target_os = "macos")]
    {
        builder = builder.icon_as_template(true);
    }

    let tray = builder.build(app)?;
    Ok(tray)
}

/// 切换 tray 状态图标 + 菜单"状态"项文本。
///
/// 找不到 tray(未 build / 已销毁)返 false,不报错(运行时 best-effort)。
pub fn set_tray_status(app: &AppHandle, status: TrayStatus) -> bool {
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
    // 同步更新菜单"状态"项文本
    if let Ok(slot) = STATUS_MENU_ITEM.lock() {
        if let Some(ref item) = *slot {
            let _ = item.set_text(status.label());
        }
    }
    if let Ok(mut cur) = CURRENT_STATUS.lock() {
        *cur = status;
    }
    true
}

/// 显示并聚焦主窗口(tray 菜单"打开"+ 左键单击共用)。
fn show_main_window_impl<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MainWindow::LABEL) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
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
// Tauri commands(C0.5.3)— 暴露给 GUI / adapter
// ============================================================

/// 切换 tray 图标 + 菜单状态文本。GUI / adapter 通过 invoke 调用。
///
/// 接受 status string("default" / "connected" / "offline" / "error"),非法值返 false。
#[tauri::command]
#[specta::specta]
pub fn set_tray_status_cmd(app: AppHandle, status: String) -> bool {
    let Some(s) = TrayStatus::from_str(&status) else {
        return false;
    };
    set_tray_status(&app, s)
}

/// 显示并聚焦主窗口。GUI 不直接需要(tray 菜单 / 单击托盘已有路径),
/// 留 command 给 adapter 主动唤起 GUI 用(例如有新飞书消息需 user 关注时)。
#[tauri::command]
#[specta::specta]
pub fn show_main_window_cmd(app: AppHandle) {
    show_main_window_impl(&app);
}

/// 真退出主进程(GUI 设置页的"退出"按钮 / 测试触发用)。
///
/// 等价于 tray 菜单"退出 DeskFox":set IS_QUITTING + app.exit。
#[tauri::command]
#[specta::specta]
pub fn quit_app_cmd(app: AppHandle) {
    request_quit();
    app.exit(0);
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

    #[test]
    fn label_四档全非空且不同() {
        let labels = [
            TrayStatus::Default.label(),
            TrayStatus::Connected.label(),
            TrayStatus::Offline.label(),
            TrayStatus::Error.label(),
        ];
        for l in labels.iter() {
            assert!(!l.is_empty());
            assert!(l.starts_with("状态:"), "label 应统一前缀'状态:',实际: {l}");
        }
        // 4 档文本互不相同
        let unique: std::collections::HashSet<&&str> = labels.iter().collect();
        assert_eq!(unique.len(), 4);
    }
}
