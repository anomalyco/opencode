use std::sync::Mutex;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Webview, WebviewBuilder, WebviewUrl};
use tauri::webview::PageLoadEvent;

const LABEL: &str = "design-preview";

pub struct DesignWebviewState(pub Mutex<Option<Webview>>);

#[tauri::command]
#[specta::specta]
pub fn create_design_webview(
    app: AppHandle,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    script: Option<String>,
) -> Result<(), String> {
    let state = app.state::<DesignWebviewState>();
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;

    if let Some(old) = slot.take() {
        let _ = old.close();
    }

    let window = app
        .get_window(crate::windows::MainWindow::LABEL)
        .ok_or("main window not found")?;

    let parsed = tauri::Url::parse(&url).map_err(|e| format!("{e}"))?;
    let mut builder = WebviewBuilder::new(LABEL, WebviewUrl::External(parsed))
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");

    if let Some(js) = script {
        builder = builder.on_page_load(move |webview, payload| {
            if matches!(payload.event(), PageLoadEvent::Finished) {
                let _ = webview.eval(&js);
            }
        });
    }

    let webview = window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|e: tauri::Error| e.to_string())?;

    *slot = Some(webview);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn resize_design_webview(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    let state = app.state::<DesignWebviewState>();
    let slot = state.0.lock().map_err(|e| e.to_string())?;
    let wv = slot.as_ref().ok_or("design webview not open")?;
    wv.set_position(LogicalPosition::new(x, y))
        .map_err(|e: tauri::Error| e.to_string())?;
    wv.set_size(LogicalSize::new(width, height))
        .map_err(|e: tauri::Error| e.to_string())?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn close_design_webview(app: AppHandle) -> Result<(), String> {
    let state = app.state::<DesignWebviewState>();
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(wv) = slot.take() {
        wv.close().map_err(|e: tauri::Error| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn eval_design_webview(app: AppHandle, script: String) -> Result<(), String> {
    let state = app.state::<DesignWebviewState>();
    let slot = state.0.lock().map_err(|e| e.to_string())?;
    let wv = slot.as_ref().ok_or("design webview not open")?;
    wv.eval(&script).map_err(|e: tauri::Error| e.to_string())?;
    Ok(())
}

/// Bridge command: child webview calls this via __TAURI_INTERNALS__.invoke,
/// and we re-emit the payload as a Tauri event that the main webview picks up.
#[tauri::command]
#[specta::specta]
pub fn design_bridge(app: AppHandle, event: String, payload: String) -> Result<(), String> {
    app.emit(&event, payload).map_err(|e| e.to_string())?;
    Ok(())
}
