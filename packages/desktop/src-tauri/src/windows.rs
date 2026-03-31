use crate::{
    constants::{UPDATER_ENABLED, window_state_flags},
    server::get_wsl_config,
};
use std::{ops::Deref, time::Duration};
use tauri::{
    AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, Runtime, WebviewUrl,
    WebviewWindow, WebviewWindowBuilder,
};
use tauri_plugin_window_state::AppHandleExt;
use tokio::sync::mpsc;

#[cfg(target_os = "linux")]
use std::sync::OnceLock;

#[cfg(target_os = "linux")]
fn use_decorations() -> bool {
    static DECORATIONS: OnceLock<bool> = OnceLock::new();
    *DECORATIONS.get_or_init(|| {
        crate::linux_windowing::use_decorations(&crate::linux_windowing::SessionEnv::capture())
    })
}

#[cfg(not(target_os = "linux"))]
fn use_decorations() -> bool {
    true
}

pub struct MainWindow(WebviewWindow);

impl Deref for MainWindow {
    type Target = WebviewWindow;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl MainWindow {
    pub const LABEL: &str = "main";

    pub fn present(window: &WebviewWindow) {
        present(window, true);
    }

    // During startup, macOS can still report a disconnected monitor in
    // available_monitors(). The loading window reliably appears on the visible
    // screen, so we use its current monitor as the anchor for the main window.
    pub fn present_on(window: &WebviewWindow, monitor: &Monitor) {
        present_on(window, monitor, true);
    }

    pub fn anchor(window: &WebviewWindow) {
        present(window, false);
    }

    pub fn anchor_on(window: &WebviewWindow, monitor: &Monitor) {
        // Startup monitor repair may keep running after the user has already switched
        // away from OpenCode. This path repositions the window without reclaiming focus.
        present_on(window, monitor, false);
    }

    pub fn reveal(window: &WebviewWindow, path: Option<&str>) {
        ensure_window_visible(window);
        let _ = window.set_focus();
        let _ = window.unminimize();
        if let Some(path) = path {
            let _ = window.emit("opencode:open-path", path);
        }
    }

    pub fn create_hidden_with_path(
        app: &AppHandle,
        initial_path: Option<&str>,
    ) -> Result<Self, tauri::Error> {
        Self::create(app, initial_path, false)
    }

    fn create(
        app: &AppHandle,
        initial_path: Option<&str>,
        visible: bool,
    ) -> Result<Self, tauri::Error> {
        if let Some(window) = app.get_webview_window(Self::LABEL) {
            Self::reveal(&window, initial_path);
            return Ok(Self(window));
        }

        let initial_path_js = initial_path
            .map(|p| format!("\"{}\"", p.replace('\\', "\\\\").replace('"', "\\\"")))
            .unwrap_or_else(|| "null".to_string());

        let wsl_enabled = get_wsl_config(app.clone())
            .ok()
            .map(|v| v.enabled)
            .unwrap_or(false);
        let decorations = use_decorations();
        let window_builder = base_window_config(
            WebviewWindowBuilder::new(app, Self::LABEL, WebviewUrl::App("/".into())),
            app,
            decorations,
        )
        .title("OpenCode")
        .decorations(true)
        .zoom_hotkeys_enabled(false)
        .visible(visible)
        .maximized(true)
        .initialization_script(format!(
            r#"
            window.__OPENCODE__ ??= {{}};
            window.__OPENCODE__.updaterEnabled = {UPDATER_ENABLED};
            window.__OPENCODE__.initialPath = {initial_path_js};
            window.__OPENCODE__.wsl = {wsl_enabled};
          "#
        ));

        let window = window_builder.build()?;

        ensure_window_visible(&window);

        // Hidden startup creation must not focus the app. Doing so on macOS can pull
        // OpenCode to the foreground before the user has chosen to activate it.
        if visible {
            let _ = window.set_focus();
        }

        setup_window_state_listener(app, &window);

        Ok(Self(window))
    }
}

fn present(window: &WebviewWindow, focus: bool) {
    let _ = window.show();
    ensure_window_visible(window);
    if focus {
        let _ = window.set_focus();
    }
}

fn present_on(window: &WebviewWindow, monitor: &Monitor, focus: bool) {
    let _ = window.show();

    if window
        .current_monitor()
        .ok()
        .flatten()
        .is_some_and(|current| same_monitor(&current, monitor))
    {
        if focus {
            let _ = window.set_focus();
        }
        return;
    }

    let max = window.is_maximized().unwrap_or(false);
    if max {
        let _ = window.unmaximize();
    }

    if let Err(err) = set_window_to_monitor(window, monitor) {
        tracing::warn!(label = %window.label(), error = ?err, "failed to place window on target monitor");
    }

    if max {
        let _ = window.maximize();
    }
    if focus {
        let _ = window.set_focus();
    }
}

fn monitor_has_point(monitor: &Monitor, x: i32, y: i32) -> bool {
    let pos = monitor.position();
    let size = monitor.size();
    let left = pos.x;
    let right = pos.x + size.width as i32;
    let top = pos.y;
    let bottom = pos.y + size.height as i32;

    x >= left && x < right && y >= top && y < bottom
}

fn monitor_intersects(
    monitor: &Monitor,
    pos: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
) -> bool {
    let right = pos.x + size.width.saturating_sub(1) as i32;
    let bottom = pos.y + size.height.saturating_sub(1) as i32;

    [
        (pos.x, pos.y),
        (right, pos.y),
        (pos.x, bottom),
        (right, bottom),
    ]
    .into_iter()
    .any(|(x, y)| monitor_has_point(monitor, x, y))
}

fn same_monitor(a: &Monitor, b: &Monitor) -> bool {
    let apos = a.position();
    let asize = a.size();
    let bpos = b.position();
    let bsize = b.size();

    apos.x == bpos.x
        && apos.y == bpos.y
        && asize.width == bsize.width
        && asize.height == bsize.height
}

fn reset_window_position(window: &WebviewWindow) -> tauri::Result<()> {
    let size = window.outer_size()?;
    let monitor = window.primary_monitor()?.or_else(|| {
        window
            .available_monitors()
            .ok()
            .and_then(|list| list.into_iter().next())
    });

    let Some(monitor) = monitor else {
        return window.center();
    };

    let pos = monitor.position();
    let area = monitor.size();
    let width = size.width.min(area.width);
    let height = size.height.min(area.height);
    let x = pos.x + ((area.width.saturating_sub(width)) / 2) as i32;
    let y = pos.y + ((area.height.saturating_sub(height)) / 2) as i32;

    let _ = window.set_size(PhysicalSize { width, height });
    window.set_position(PhysicalPosition { x, y })
}

fn set_window_to_monitor(window: &WebviewWindow, monitor: &Monitor) -> tauri::Result<()> {
    let size = window.outer_size()?;
    let pos = monitor.position();
    let area = monitor.size();
    let width = size.width.min(area.width);
    let height = size.height.min(area.height);
    let x = pos.x + ((area.width.saturating_sub(width)) / 2) as i32;
    let y = pos.y + ((area.height.saturating_sub(height)) / 2) as i32;

    let _ = window.set_size(PhysicalSize { width, height });
    window.set_position(PhysicalPosition { x, y })
}

fn ensure_window_visible(window: &WebviewWindow) {
    let Ok(pos) = window.outer_position() else {
        tracing::warn!(label = %window.label(), "failed to read window position");
        return;
    };

    let Ok(size) = window.outer_size() else {
        tracing::warn!(label = %window.label(), "failed to read window size");
        return;
    };

    let Ok(monitors) = window.available_monitors() else {
        tracing::warn!(label = %window.label(), "failed to read display list");
        return;
    };

    if monitors
        .iter()
        .any(|monitor| monitor_intersects(monitor, pos, size))
    {
        return;
    }

    let max = window.is_maximized().unwrap_or(false);
    tracing::warn!(
        label = %window.label(),
        x = pos.x,
        y = pos.y,
        width = size.width,
        height = size.height,
        monitors = monitors.len(),
        maximized = max,
        "window restored outside visible displays, resetting position"
    );

    if max {
        let _ = window.unmaximize();
    }

    if let Err(err) = reset_window_position(window) {
        tracing::warn!(label = %window.label(), error = ?err, "failed to reset window position");
        return;
    }

    if max {
        let _ = window.maximize();
    }
}

fn setup_window_state_listener(app: &AppHandle, window: &WebviewWindow) {
    let (tx, mut rx) = mpsc::channel::<()>(1);

    window.on_window_event(move |event| {
        use tauri::WindowEvent;
        if !matches!(event, WindowEvent::Moved(_) | WindowEvent::Resized(_)) {
            return;
        }
        let _ = tx.try_send(());
    });

    tokio::spawn({
        let app = app.clone();

        async move {
            let save = || {
                let handle = app.clone();
                let app = app.clone();
                let _ = handle.run_on_main_thread(move || {
                    let _ = app.save_window_state(window_state_flags());
                });
            };

            while rx.recv().await.is_some() {
                tokio::time::sleep(Duration::from_millis(200)).await;

                save();
            }
        }
    });
}

pub struct LoadingWindow(WebviewWindow);

impl Deref for LoadingWindow {
    type Target = WebviewWindow;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl LoadingWindow {
    pub const LABEL: &str = "loading";

    pub fn create(app: &AppHandle) -> Result<Self, tauri::Error> {
        if let Some(window) = app.get_webview_window(Self::LABEL) {
            return Ok(Self(window));
        }

        let decorations = use_decorations();

        let window_builder = base_window_config(
            WebviewWindowBuilder::new(app, Self::LABEL, tauri::WebviewUrl::App("/loading".into())),
            app,
            decorations,
        )
        .title("OpenCode")
        .zoom_hotkeys_enabled(false)
        .center()
        .resizable(false)
        .inner_size(720.0, 520.0)
        .visible(true);

        Ok(Self(window_builder.build()?))
    }
}

fn base_window_config<'a, R: Runtime, M: Manager<R>>(
    window_builder: WebviewWindowBuilder<'a, R, M>,
    _app: &AppHandle,
    decorations: bool,
) -> WebviewWindowBuilder<'a, R, M> {
    let window_builder = window_builder.decorations(decorations);

    #[cfg(windows)]
    let window_builder = window_builder
        // Some VPNs set a global/system proxy that WebView2 applies even for loopback
        // connections, which breaks the app's localhost sidecar server.
        // Note: when setting additional args, we must re-apply wry's default
        // `--disable-features=...` flags.
        .additional_browser_args(
            "--proxy-bypass-list=<-loopback> --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection",
        )
        .data_directory(_app.path().config_dir().expect("Failed to get config dir").join(_app.config().product_name.clone().unwrap()))
        .decorations(false);

    #[cfg(target_os = "macos")]
    let window_builder = window_builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(12.0, 18.0));

    window_builder
}
