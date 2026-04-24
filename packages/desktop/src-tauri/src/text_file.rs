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
