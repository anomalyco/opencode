#[tauri::command]
#[specta::specta]
pub fn write_text_file(root: String, path: String, content: String) -> Result<(), String> {
    let full = std::path::PathBuf::from(&root).join(&path);
    std::fs::write(&full, content).map_err(|e| format!("write failed: {}: {}", full.display(), e))
}
