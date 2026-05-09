// FORK-only: 把打进 installer 资源的飞书 plugin 路径注入 user opencode 配置
// [feat: feishu-bridge-ship-packaging] 2026-05-09
//
// installer 装好后,resource_dir 里有 plugin/feishu-bridge/ 整个 package
// (build-feishu-plugin.{sh,ps1} 出 dist/plugin.js + 一同 cp 进 .app/.exe resources)。
// 但 opencode-cli sidecar 只读 user `~/.config/opencode/opencode.{json,jsonc}` 里 `plugin` 字段,
// installer 不能动 user 配置,所以走 setup hook —— DeskFox 启动时检测 / 注入 plugin 路径,
// 之后 sidecar spawn 即能加载。
//
// idempotent:已存在指向本 plugin 的有效项就跳过;失效项(路径已不存在)清理后重新注入。
// 失效场景实例 — user 在 .dmg 挂载点双击 .app,inject 写入 /Volumes/... 路径,卸载挂载点后路径失效;
// user 拖 .app 到 Applications 后下次启动需自愈,不能因子串匹配就跳过保留废 entry [feat: feishu-bridge-newuser-onboarding] 2026-05-10。

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

    // idempotent + 失效自愈:遍历 plugin 数组,把含 PLUGIN_DIR_NAME 子串的项分类
    //   - 路径仍存在 → 保留(若就是当前 plugin_url 视为已注入,跳过 push)
    //   - 路径已失效 → 移除 + log(挂载点卸载 / 旧版本 .app 删除等情况自愈)
    let mut found_current = false;
    let mut removed = 0_usize;
    arr.retain(|v| {
        let path_str = match v {
            Value::String(s) => Some(s.as_str()),
            Value::Object(o) => o.get("path").and_then(|x| x.as_str()),
            _ => return true, // 非本 plugin 形状 → 不动
        };
        let Some(s) = path_str else { return true };
        if !s.contains(PLUGIN_DIR_NAME) {
            return true; // 不是本 plugin entry → 保持
        }
        // 是本 plugin entry → 检测路径是否仍存在
        if path_still_valid(s) {
            if s == plugin_url {
                found_current = true;
            }
            true
        } else {
            tracing::info!("[feishu-plugin] removing stale entry: {s}");
            removed += 1;
            false
        }
    });

    if found_current {
        if removed > 0 {
            // 当前 entry 已存在,但顺手清掉了别的 stale entry(罕见:前后两次 inject 路径一致 + 旧版残留)
            let pretty =
                serde_json::to_string_pretty(&json).map_err(|e| format!("serialize: {e}"))?;
            fs::write(config_path, pretty).map_err(|e| format!("write config: {e}"))?;
            tracing::info!(
                "[feishu-plugin] {plugin_url} already present; cleaned {removed} stale entry(ies)"
            );
        } else {
            tracing::info!("[feishu-plugin] already in user config, skipping inject");
        }
        return Ok(());
    }

    arr.push(Value::String(plugin_url.clone()));
    let pretty = serde_json::to_string_pretty(&json).map_err(|e| format!("serialize: {e}"))?;
    fs::write(config_path, pretty).map_err(|e| format!("write config: {e}"))?;
    if removed > 0 {
        tracing::info!(
            "[feishu-plugin] injected {plugin_url} (replaced {removed} stale entry(ies)) into {}",
            config_path.display()
        );
    } else {
        tracing::info!(
            "[feishu-plugin] injected {plugin_url} into {}",
            config_path.display()
        );
    }
    Ok(())
}

/// 字符串路径(可能带 file:// 前缀,可能是裸路径)→ 判断对应文件系统路径是否存在
fn path_still_valid(raw: &str) -> bool {
    let trimmed = raw.strip_prefix("file://").unwrap_or(raw);
    // file:// URL 在不同平台前导斜杠数量不同,Path::new 在 Mac/Linux 上 "/path" 直接可用;
    // Win 上是 "/C:/path" 形式 — Path::new 也能识别(strip leading slash 兼容)
    #[cfg(target_os = "windows")]
    let trimmed = trimmed.strip_prefix('/').unwrap_or(trimmed);
    Path::new(trimmed).exists()
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
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    // ---- to_file_url 转换覆盖(Win UNC 前缀 / 反斜杠 / 空格 / 跨平台)----
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

    // ---- inject_plugin idempotent + 失效自愈覆盖 ----

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    /// 造一个独立 tmp 目录做测试根 — 不依赖 tempfile crate
    struct Sandbox {
        root: PathBuf,
    }
    impl Sandbox {
        fn new(label: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let n = COUNTER.fetch_add(1, Ordering::SeqCst);
            let root = std::env::temp_dir()
                .join(format!("deskfox-feishu-plugin-install-test-{label}-{nanos}-{n}"));
            fs::create_dir_all(&root).unwrap();
            Self { root }
        }
        fn make_plugin_dir(&self, name: &str) -> PathBuf {
            // plugin_dir 必须含 plugin/feishu-bridge 尾段(对齐真实 layout)
            let dir = self.root.join(name).join(PLUGIN_DIR_NAME);
            fs::create_dir_all(&dir).unwrap();
            // 顺手放 package.json,inject_plugin 不读 plugin_dir 内容,但语义对齐
            fs::write(dir.join("package.json"), "{}").unwrap();
            dir
        }
    }
    impl Drop for Sandbox {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn read_plugin_array(config: &Path) -> Vec<String> {
        let raw = fs::read_to_string(config).unwrap();
        let v: Value = serde_json::from_str(&raw).unwrap();
        v.get("plugin")
            .and_then(|p| p.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default()
    }

    #[test]
    fn first_inject_writes_entry_into_empty_config() {
        let s = Sandbox::new("fresh");
        let plugin_dir = s.make_plugin_dir("install-A");
        let cfg = s.root.join("opencode.json");
        fs::write(&cfg, r#"{ "$schema": "x" }"#).unwrap();
        inject_plugin(&cfg, &plugin_dir).unwrap();
        let arr = read_plugin_array(&cfg);
        assert_eq!(arr.len(), 1);
        assert!(arr[0].ends_with(PLUGIN_DIR_NAME));
        assert!(arr[0].starts_with("file://"));
    }

    #[test]
    fn idempotent_when_same_path_present_and_valid() {
        let s = Sandbox::new("idem");
        let plugin_dir = s.make_plugin_dir("install-A");
        let cfg = s.root.join("opencode.json");
        fs::write(&cfg, r#"{ "$schema": "x" }"#).unwrap();
        inject_plugin(&cfg, &plugin_dir).unwrap();
        let mtime_before = fs::metadata(&cfg).unwrap().modified().unwrap();
        // 第二次 inject 同路径 — 不应改变 entry 数 / 不应触发文件 rewrite(found_current 路径)
        std::thread::sleep(std::time::Duration::from_millis(20));
        inject_plugin(&cfg, &plugin_dir).unwrap();
        let arr = read_plugin_array(&cfg);
        assert_eq!(arr.len(), 1, "second inject must not duplicate");
        let mtime_after = fs::metadata(&cfg).unwrap().modified().unwrap();
        assert_eq!(
            mtime_before, mtime_after,
            "no-op inject should not rewrite file"
        );
    }

    #[test]
    fn stale_entry_is_replaced_when_path_changes() {
        // 模拟 user 在 .dmg 挂载点双击 .app — inject 写 /Volumes/... 路径,卸载后 user 拖 Applications 再启动
        let s = Sandbox::new("heal");
        let mountpoint_dir = s.make_plugin_dir("Volumes-DMG");
        let cfg = s.root.join("opencode.json");
        fs::write(&cfg, r#"{ "$schema": "x" }"#).unwrap();
        inject_plugin(&cfg, &mountpoint_dir).unwrap();
        // 模拟挂载点卸载 — 删 dir
        fs::remove_dir_all(&mountpoint_dir).unwrap();
        assert!(!mountpoint_dir.exists());

        // 拖 Applications 后再启动 — 新 plugin_dir 路径
        let app_dir = s.make_plugin_dir("Applications-App");
        inject_plugin(&cfg, &app_dir).unwrap();
        let arr = read_plugin_array(&cfg);
        assert_eq!(arr.len(), 1, "stale entry replaced, single entry remains");
        assert!(
            arr[0].contains("Applications-App"),
            "new path injected: {arr:?}"
        );
        assert!(
            !arr[0].contains("Volumes-DMG"),
            "stale path removed: {arr:?}"
        );
    }

    #[test]
    fn unrelated_plugin_entries_preserved() {
        let s = Sandbox::new("preserve");
        let plugin_dir = s.make_plugin_dir("install-A");
        let cfg = s.root.join("opencode.json");
        // 已有一个 user 自己加的非本 plugin entry
        fs::write(
            &cfg,
            r#"{ "$schema": "x", "plugin": ["file:///some/other/plugin"] }"#,
        )
        .unwrap();
        inject_plugin(&cfg, &plugin_dir).unwrap();
        let arr = read_plugin_array(&cfg);
        assert_eq!(arr.len(), 2);
        assert!(arr.iter().any(|s| s == "file:///some/other/plugin"));
        assert!(arr.iter().any(|s| s.contains(PLUGIN_DIR_NAME)));
    }

    #[test]
    fn path_still_valid_strips_file_url_prefix() {
        let s = Sandbox::new("path");
        let dir = s.make_plugin_dir("X");
        let url = format!("file://{}", dir.display());
        assert!(path_still_valid(&url));
        fs::remove_dir_all(&dir).unwrap();
        assert!(!path_still_valid(&url));
    }
}
