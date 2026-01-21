use tauri::{plugin::Plugin, Manager, Runtime, Window};

pub struct PinchZoomDisablePlugin;

impl Default for PinchZoomDisablePlugin {
    fn default() -> Self {
        Self
    }
}

impl<R: Runtime> Plugin<R> for PinchZoomDisablePlugin {
    fn name(&self) -> &'static str {
        "Does not matter here"
    }

    fn window_created(&mut self, window: Window<R>) {
        let Some(webview_window) = window.get_webview_window(window.label()) else {
            return;
        };

        let _ = webview_window.with_webview(|_webview| {
            #[cfg(target_os = "linux")]
            unsafe {
                use gtk::glib::ObjectExt;
                use gtk::GestureZoom;
                use webkit2gtk::glib::gobject_ffi;

                if let Some(data) = _webview.inner().data::<GestureZoom>("wk-view-zoom-gesture") {
                    gobject_ffi::g_signal_handlers_destroy(data.as_ptr().cast());
                }
            }
        });
    }
}
