#[tauri::command]
#[specta::specta]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| format!("write failed: {}: {}", path, e))
}
