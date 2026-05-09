// FORK-only: 把打进 installer 资源的飞书 plugin 路径注入 user opencode 配置
// [feat: feishu-bridge-ship-packaging] 2026-05-09
//
// installer 装好后,resource_dir 里有 plugin/feishu-bridge/ 整个 package
// (build-feishu-plugin.{sh,ps1} 出 dist/plugin.js + 一同 cp 进 .app/.exe resources)。
// 但 opencode-cli sidecar 只读 user `~/.config/opencode/opencode.{json,jsonc}` 里 `plugin` 字段,
// installer 不能动 user 配置,所以走 setup hook —— DeskFox 启动时检测 / 注入 plugin 路径,
// 之后 sidecar spawn 即能加载。
//
// idempotent:已存在指向本 plugin 的项就跳过,不重复加。user 手动改过别的 plugin 项不动。

use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const PLUGIN_DIR_NAME: &str = "plugin/feishu-bridge";

/// 主入口 — 在 .setup 里调,把 plugin 路径写进 user opencode 配置。
/// 失败仅 log,不阻断 DeskFox 启动(plugin 没起 user 仍能用其他功能)。
pub fn ensure_feishu_plugin_in_config(app: &AppHandle) {
    let plugin_dir = match resolve_plugin_dir(app) {
        Some(p) => p,
        None => {
            tracing::warn!("[feishu-plugin] resource plugin dir not found, skip injection");
            return;
        }
    };

    if !plugin_dir.join("package.json").exists() {
        tracing::warn!(
            "[feishu-plugin] resource plugin missing package.json: {}",
            plugin_dir.display()
        );
        return;
    }

    let config_path = match resolve_user_config_path() {
        Some(p) => p,
        None => {
            tracing::warn!("[feishu-plugin] cannot resolve user opencode config dir");
            return;
        }
    };

    if let Err(err) = inject_plugin(&config_path, &plugin_dir) {
        tracing::warn!("[feishu-plugin] inject failed: {err}");
    }
}

fn resolve_plugin_dir(app: &AppHandle) -> Option<PathBuf> {
    let resource_dir = app.path().resource_dir().ok()?;
    let candidate = resource_dir.join(PLUGIN_DIR_NAME);
    if candidate.is_dir() {
        return Some(candidate);
    }
    None
}

fn resolve_user_config_path() -> Option<PathBuf> {
    // 对齐 opencode 自己用的 xdg-basedir@5.1.0 npm 包行为(`packages/core/src/global.ts:12`)。
    // xdg-basedir 5.1.0 实际无 Win 特殊分支,三平台一致:`$XDG_CONFIG_HOME` 或 `~/.config`。
    //   - Linux:$XDG_CONFIG_HOME 或 ~/.config       → ~/.config/opencode/
    //   - macOS:~/.config(不用 Library)            → ~/.config/opencode/
    //   - Win:  ~/.config(不用 %APPDATA%)            → ~/.config/opencode/
    // 注:旧版逻辑用 `dirs::config_dir()` 在 Win 返 %APPDATA%\Roaming\,跟 sidecar
    // 实际查找路径不重叠,导致 plugin 注入永远命不中。三平台统一走 home/.config 修。
    let dir = dirs::home_dir()?.join(".config").join("opencode");

    let jsonc = dir.join("opencode.jsonc");
    if jsonc.exists() {
        return Some(jsonc);
    }
    let json = dir.join("opencode.json");
    if json.exists() {
        return Some(json);
    }
    // 都不存在 → 创建 opencode.json 给 user
    if let Err(err) = fs::create_dir_all(&dir) {
        tracing::warn!("[feishu-plugin] mkdir {} failed: {err}", dir.display());
        return None;
    }
    Some(json)
}

/// 把文件系统路径转成 opencode plugin loader 可接受的 `file://` URL。
///
/// Win 注意点:
///   - `Path::canonicalize()` / Tauri `resource_dir()` 在 Win 经常加扩展长度前缀 `\\?\`,
///     `import()` / Node URL parser 不接受 → 必须 strip
///   - 反斜杠 `\` 必须转 `/`,标准 file URL 用正斜杠
///   - 空格用 `%20` 编码(install 路径常见 `Program Files`)
/// Linux/Mac 走 fall-through 自然处理(无 UNC,无 backslash)。
fn to_file_url(path: &Path) -> String {
    let raw = path.display().to_string();
    let stripped = raw.strip_prefix(r"\\?\").unwrap_or(&raw);
    let normalized = stripped.replace('\\', "/");
    let encoded = normalized.replace(' ', "%20");
    if encoded.starts_with('/') {
        format!("file://{encoded}")
    } else {
        format!("file:///{encoded}")
    }
}

fn inject_plugin(config_path: &Path, plugin_dir: &Path) -> Result<(), String> {
    let plugin_url = to_file_url(plugin_dir);

    let raw = if config_path.exists() {
        fs::read_to_string(config_path).map_err(|e| format!("read config: {e}"))?
    } else {
        // 新建 user 配置 stub
        r#"{ "$schema": "https://opencode.ai/config.json" }"#.to_string()
    };

    // jsonc 允许 // 和 /* */ 注释,jsonc-parser 处理;但 user opencode 实际接受标准 JSON,
    // 这里走宽松解析:先 try 严格 JSON,失败 fallback 注释剥离。
    let mut json: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(_) => {
            let stripped = strip_comments(&raw);
            serde_json::from_str(&stripped).map_err(|e| format!("parse config: {e}"))?
        }
    };

    let obj = json
        .as_object_mut()
        .ok_or_else(|| "config root is not an object".to_string())?;

    // plugin 字段是 array;不存在创建空 array
    let plugin_arr = obj
        .entry("plugin".to_string())
        .or_insert_with(|| Value::Array(vec![]));

    let arr = plugin_arr
        .as_array_mut()
        .ok_or_else(|| "plugin field is not an array".to_string())?;

    // idempotent 检测:任何项已包含本 plugin 路径的尾段(plugin/feishu-bridge)就跳过。
    // 这样 user 手动配过开发版路径(不同前缀)我们也尊重不覆盖。
    let already_has = arr.iter().any(|v| match v {
        Value::String(s) => s.contains(PLUGIN_DIR_NAME),
        Value::Object(o) => o
            .get("path")
            .and_then(|x| x.as_str())
            .map(|p| p.contains(PLUGIN_DIR_NAME))
            .unwrap_or(false),
        _ => false,
    });

    if already_has {
        tracing::info!("[feishu-plugin] already in user config, skipping inject");
        return Ok(());
    }

    arr.push(Value::String(plugin_url.clone()));
    let pretty = serde_json::to_string_pretty(&json).map_err(|e| format!("serialize: {e}"))?;
    fs::write(config_path, pretty).map_err(|e| format!("write config: {e}"))?;
    tracing::info!("[feishu-plugin] injected {plugin_url} into {}", config_path.display());
    Ok(())
}

/// 简单去 jsonc 注释(line `//` + block `/* */`)— 不严格(够 user 写的 .jsonc 用)。
fn strip_comments(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    let mut in_string = false;
    let mut escape = false;
    while i < bytes.len() {
        let c = bytes[i];
        if in_string {
            out.push(c as char);
            if escape {
                escape = false;
            } else if c == b'\\' {
                escape = true;
            } else if c == b'"' {
                in_string = false;
            }
            i += 1;
            continue;
        }
        if c == b'"' {
            in_string = true;
            out.push('"');
            i += 1;
            continue;
        }
        if c == b'/' && i + 1 < bytes.len() {
            let n = bytes[i + 1];
            if n == b'/' {
                while i < bytes.len() && bytes[i] != b'\n' {
                    i += 1;
                }
                continue;
            }
            if n == b'*' {
                i += 2;
                while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                    i += 1;
                }
                i = (i + 2).min(bytes.len());
                continue;
            }
        }
        out.push(c as char);
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    // [bug-repro: Win 安装包 plugin URL 写出 `file://\\?\D:\...` 反斜杠 + UNC 前缀,
    //  opencode plugin loader / Node import() 不接受]
    #[test]
    fn unc_prefix_stripped_and_backslashes_converted() {
        let p = PathBuf::from(r"\\?\D:\project\plugin\feishu-bridge");
        assert_eq!(to_file_url(&p), "file:///D:/project/plugin/feishu-bridge");
    }

    #[test]
    fn plain_windows_path() {
        let p = PathBuf::from(r"D:\foo\bar");
        assert_eq!(to_file_url(&p), "file:///D:/foo/bar");
    }

    #[test]
    fn unix_path_uses_double_slash() {
        let p = PathBuf::from("/Users/u/foo");
        assert_eq!(to_file_url(&p), "file:///Users/u/foo");
    }

    #[test]
    fn space_encoded_as_pct20() {
        let p = PathBuf::from(r"C:\Program Files\DeskFox\plugin\feishu-bridge");
        assert_eq!(
            to_file_url(&p),
            "file:///C:/Program%20Files/DeskFox/plugin/feishu-bridge"
        );
    }
}
