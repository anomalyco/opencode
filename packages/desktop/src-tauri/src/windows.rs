use crate::constants::{UPDATER_ENABLED, window_state_flags};
use std::{ops::Deref, time::Duration};
use tauri::{AppHandle, LogicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_window_state::AppHandleExt;
use tokio::sync::mpsc;

pub struct MainWindow(WebviewWindow);

impl Deref for MainWindow {
    type Target = WebviewWindow;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl MainWindow {
    pub const LABEL: &str = "main";

    pub fn create(app: &AppHandle) -> Result<Self, tauri::Error> {
        let primary_monitor = app.primary_monitor().ok().flatten();
        let size = primary_monitor
            .map(|m| m.size().to_logical(m.scale_factor()))
            .unwrap_or(LogicalSize::new(1920, 1080));

        let window_builder =
            WebviewWindowBuilder::new(app, Self::LABEL, WebviewUrl::App("/".into()))
                .title("OpenCode")
                .decorations(true)
                .disable_drag_drop_handler()
                .zoom_hotkeys_enabled(false)
                .inner_size(size.width as f64, size.height as f64)
                .visible(false)
                .initialization_script(format!(
                    r#"
            window.__OPENCODE__ ??= {{}};
            window.__OPENCODE__.updaterEnabled = {UPDATER_ENABLED};
          "#
                ));

        #[cfg(target_os = "macos")]
        let window_builder = window_builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(tauri::LogicalPosition::new(12.0, 18.0));

        #[cfg(windows)]
        let window_builder = window_builder
			// Some VPNs set a global/system proxy that WebView2 applies even for loopback
			// connections, which breaks the app's localhost sidecar server.
			// Note: when setting additional args, we must re-apply wry's default
			// `--disable-features=...` flags.
	        .additional_browser_args(
	            "--proxy-bypass-list=<-loopback> --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection",
	        )
	        .decorations(false);

        let window = window_builder.build()?;

        setup_window_state_listener(app, &window);

        #[cfg(windows)]
        let _ = window.create_overlay_titlebar();

        Ok(Self(window))
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
        let window_builder =
            WebviewWindowBuilder::new(app, Self::LABEL, tauri::WebviewUrl::App("/loading".into()))
                .inner_size(640.0, 480.0)
                .visible(false);

        #[cfg(target_os = "macos")]
        let window_builder = window_builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .resizable(false)
            .center()
            .traffic_light_position(tauri::LogicalPosition::new(12.0, 18.0));

        Ok(Self(window_builder.build()?))
    }
}
