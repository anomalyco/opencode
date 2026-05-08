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
// 前端走 FileReader → base64 → 此命令写盘(absolute path,默认校验不存在)2026-04-28
// FORK: 加 allow_overwrite(2026-05-06)— 导出 Word 场景 save dialog 已让用户确认替换,
//       后端不再拦截;default false 保留拖入场景的"不覆盖" 语义不变
#[tauri::command]
#[specta::specta]
pub fn write_binary_file_absolute_base64(
    path: String,
    base64_content: String,
    allow_overwrite: Option<bool>,
) -> Result<(), String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&base64_content)
        .map_err(|e| format!("base64 decode failed: {}", e))?;
    if bytes.len() > MAX_BINARY_READ_BYTES as usize {
        return Err(format!("file too large: {} bytes", bytes.len()));
    }
    let p = std::path::Path::new(&path);
    if !allow_overwrite.unwrap_or(false) && p.exists() {
        return Err(format!("already_exists: {}", path));
    }
    // FORK: 父目录不存在则递归建 — 支持 .md 拖图到 <root>/Attachments/ 自动建目录 2026-05-05
    if let Some(parent) = p.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("create_dir_all failed: {}: {}", parent.display(), e))?;
        }
    }
    std::fs::write(&path, bytes).map_err(|e| format!("write failed: {}: {}", path, e))
}

// FORK: 远端图片 fetch → base64 — MD 导出 Word 时让 markdown-docx 通过 data: URL 嵌入图片,
// 绕过 WebView2 fetch CORS / 网络限制。8MB 上限防 DoS / 内存占用过大。2026-05-08
const MAX_FETCH_BYTES: u64 = 8 * 1024 * 1024;

#[tauri::command]
#[specta::specta]
pub async fn fetch_url_base64(url: String) -> Result<String, String> {
    use base64::Engine;
    let parsed = reqwest::Url::parse(&url).map_err(|e| format!("invalid url: {}", e))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(format!("scheme not allowed: {}", parsed.scheme()));
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("DeskFox/1.0 (md-export-word)")
        .build()
        .map_err(|e| format!("client build failed: {}", e))?;
    let resp = client
        .get(parsed)
        .send()
        .await
        .map_err(|e| format!("fetch failed: {}", e))?;
    if !resp.status().is_success() {
        return Err(format!("http {}", resp.status().as_u16()));
    }
    if let Some(len) = resp.content_length() {
        if len > MAX_FETCH_BYTES {
            return Err(format!("response too large: {} > {} bytes", len, MAX_FETCH_BYTES));
        }
    }
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("read body failed: {}", e))?;
    if bytes.len() as u64 > MAX_FETCH_BYTES {
        return Err(format!("response too large: {} bytes", bytes.len()));
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}
