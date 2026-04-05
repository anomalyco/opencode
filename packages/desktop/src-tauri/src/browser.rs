use std::collections::HashMap;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, WebviewUrl};

#[derive(Default)]
pub struct BrowserState {
    pub positions: Mutex<HashMap<String, (f64, f64, f64, f64)>>,
}

impl BrowserState {
    fn insert(&self, label: String, pos: (f64, f64, f64, f64)) -> Result<(), String> {
        let mut guard = self.positions.lock().map_err(|e| format!("lock poisoned: {e}"))?;
        guard.insert(label, pos);
        Ok(())
    }

    fn remove(&self, label: &str) -> Result<(), String> {
        let mut guard = self.positions.lock().map_err(|e| format!("lock poisoned: {e}"))?;
        guard.remove(label);
        Ok(())
    }
}

#[tauri::command]
#[specta::specta]
pub async fn create_browser(
    app: AppHandle,
    label: String,
    url: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    let window = app.get_window("main").ok_or("main window not found")?;
    let parsed = url.parse::<url::Url>().map_err(|e| e.to_string())?;

    tracing::info!(%label, %url, "creating browser webview");

    let webview_builder = tauri::webview::WebviewBuilder::new(&label, WebviewUrl::External(parsed))
        .on_navigation(|url| url.scheme() == "https" || url.scheme() == "http")
        .auto_resize();

    window
        .add_child(webview_builder, tauri::LogicalPosition::new(x, y), tauri::LogicalSize::new(w, h))
        .map_err(|e| e.to_string())?;

    app.state::<BrowserState>().insert(label, (x, y, w, h))
}

#[tauri::command]
#[specta::specta]
pub async fn close_browser(app: AppHandle, label: String) -> Result<(), String> {
    tracing::info!(%label, "closing browser webview");
    if let Some(wv) = app.get_webview(&label) {
        wv.close().map_err(|e| e.to_string())?;
    }
    app.state::<BrowserState>().remove(&label)
}

#[tauri::command]
#[specta::specta]
pub async fn navigate_browser(app: AppHandle, label: String, url: String) -> Result<(), String> {
    let wv = app.get_webview(&label).ok_or("webview not found")?;
    let parsed = url.parse::<url::Url>().map_err(|e| e.to_string())?;
    tracing::debug!(%label, %url, "navigating browser");
    wv.navigate(parsed).map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn resize_browser(
    app: AppHandle,
    label: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
) -> Result<(), String> {
    let wv = app.get_webview(&label).ok_or("webview not found")?;
    wv.set_bounds(tauri::Rect {
        position: tauri::Position::Logical(tauri::LogicalPosition::new(x, y)),
        size: tauri::Size::Logical(tauri::LogicalSize::new(w, h)),
    })
    .map_err(|e| e.to_string())?;
    app.state::<BrowserState>().insert(label, (x, y, w, h))
}

#[tauri::command]
#[specta::specta]
pub async fn browser_go_back(app: AppHandle, label: String) -> Result<(), String> {
    let wv = app.get_webview(&label).ok_or("webview not found")?;
    wv.eval("window.history.back()").map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn browser_go_forward(app: AppHandle, label: String) -> Result<(), String> {
    let wv = app.get_webview(&label).ok_or("webview not found")?;
    wv.eval("window.history.forward()").map_err(|e| e.to_string())
}

#[tauri::command]
#[specta::specta]
pub async fn browser_reload(app: AppHandle, label: String) -> Result<(), String> {
    let wv = app.get_webview(&label).ok_or("webview not found")?;
    wv.eval("window.location.reload()").map_err(|e| e.to_string())
}