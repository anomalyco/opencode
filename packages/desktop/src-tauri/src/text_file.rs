use std::path::{Path, PathBuf};
use std::time::SystemTime;

fn resolve(root: &str, path: &str) -> PathBuf {
    PathBuf::from(root).join(path)
}

fn mtime_ms(p: &Path) -> Result<u64, String> {
    let md = std::fs::metadata(p).map_err(|e| format!("stat failed: {}: {}", p.display(), e))?;
    let mt = md.modified().map_err(|e| format!("modified failed: {}: {}", p.display(), e))?;
    let d = mt
        .duration_since(SystemTime::UNIX_EPOCH)
        .map_err(|e| format!("time before epoch: {}", e))?;
    Ok(d.as_millis() as u64)
}

#[tauri::command]
#[specta::specta]
pub fn get_file_mtime(root: String, path: String) -> Result<u64, String> {
    mtime_ms(&resolve(&root, &path))
}

#[tauri::command]
#[specta::specta]
pub fn write_text_file(
    root: String,
    path: String,
    content: String,
    expected_mtime: Option<u64>,
) -> Result<u64, String> {
    let full = resolve(&root, &path);

    // readonly 检测(若文件不存在则跳过,交给 write 决定)
    if let Ok(md) = std::fs::metadata(&full) {
        if md.permissions().readonly() {
            return Err(format!("readonly: {}", full.display()));
        }

        // mtime 冲突检测(仅当 expected 给出 + 文件已存在)
        if let Some(expected) = expected_mtime {
            let actual = md
                .modified()
                .ok()
                .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64);
            if let Some(a) = actual {
                if a != expected {
                    return Err(format!("mtime_conflict: disk={} expected={}", a, expected));
                }
            }
        }
    }

    std::fs::write(&full, content)
        .map_err(|e| format!("write failed: {}: {}", full.display(), e))?;

    // 返回写盘后的新 mtime(让前端更新 baseline)
    mtime_ms(&full)
}

const MAX_BINARY_READ_BYTES: u64 = 500 * 1024 * 1024;

#[tauri::command]
#[specta::specta]
pub fn read_binary_file_base64(root: String, path: String) -> Result<String, String> {
    use base64::Engine;
    let full = resolve(&root, &path);
    let metadata = std::fs::metadata(&full)
        .map_err(|e| format!("stat failed: {}: {}", full.display(), e))?;
    if metadata.len() > MAX_BINARY_READ_BYTES {
        return Err(format!("file too large: {} > {} bytes", metadata.len(), MAX_BINARY_READ_BYTES));
    }
    let bytes = std::fs::read(&full)
        .map_err(|e| format!("read failed: {}: {}", full.display(), e))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

// FORK: 文件树外部 OS 文件拖入(commit #4 of file-tree-dnd)— webview File 无 path,
// 前端走 FileReader → base64 → 此命令写盘(absolute path,会先校验不存在)2026-04-28
#[tauri::command]
#[specta::specta]
pub fn write_binary_file_absolute_base64(path: String, base64_content: String) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&base64_content)
        .map_err(|e| format!("base64 decode failed: {}", e))?;
    if bytes.len() > MAX_BINARY_READ_BYTES as usize {
        return Err(format!("file too large: {} bytes", bytes.len()));
    }
    let p = std::path::Path::new(&path);
    if p.exists() {
        return Err(format!("already_exists: {}", path));
    }
    std::fs::write(&path, bytes).map_err(|e| format!("write failed: {}: {}", path, e))
}
