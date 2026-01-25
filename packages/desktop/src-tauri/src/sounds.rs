use std::fs;
use std::path::Path;

#[tauri::command]
async fn copy_sound_file(src: String, filename: String, category: String) -> Result<String, String> {
    let config_dir = dirs::config_dir().ok_or("Failed to get config dir")?;
    let sounds_dir = config_dir.join("opencode").join("sounds").join(&category);
    
    fs::create_dir_all(&sounds_dir).map_err(|e| e.to_string())?;
    
    let dest = sounds_dir.join(&filename);
    fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    
    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
async fn cleanup_old_sounds(category: String, keep_file: String) -> Result<(), String> {
    let config_dir = dirs::config_dir().ok_or("Failed to get config dir")?;
    let sounds_dir = config_dir.join("opencode").join("sounds").join(&category);
    
    if sounds_dir.exists() {
        for entry in fs::read_dir(&sounds_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.file_name() != keep_file {
                fs::remove_file(entry.path()).map_err(|e| e.to_string())?;
            }
        }
    }
    
    Ok(())
}

#[tauri::command]
async fn sound_file_exists(path: String) -> Result<bool, String> {
    Ok(Path::new(&path).exists())
}

#[tauri::command]
async fn get_file_size(path: String) -> Result<u64, String> {
    let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
    Ok(metadata.len())
}
