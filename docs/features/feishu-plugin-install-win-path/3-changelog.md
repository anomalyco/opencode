---
feat-id: feishu-plugin-install-win-path
status: done
related: ./3-changelog.md
---

# feishu-plugin-install-win-path — changelog

## 一句话

补完 `feishu-bridge-ship-packaging` 在 Win 端实际仍跑不通的两个 bug — Win user config 路径选错 + plugin URL 写成 `\\?\D:\...` UNC 反斜杠版,Node `import()` / opencode plugin loader 不接受。Mac 端原 follow-up `7e5a3ef9b` 基于错误假设(以为 xdg-basedir 在 Win 用 `%APPDATA%`),实际 xdg-basedir@5.1.0 三平台一致 `~/.config`,Win 端实测后才暴露。

> Tiny:1 文件 / 净 +53 行(含 4 单测)/ 0 R4 / 0 上游侵入。

## commit 列表

| commit | 简述 |
|---|---|
| `7f65c691e` | `fix(feishu-plugin-install): Win 安装包 plugin 注入命不中 sidecar 路径 + UNC 前缀坏 URL [bug-repro: Win 路径选错 + UNC 前缀]`(主 commit) |
| `e58e2030c` | merge 进 dev |

## 改动文件

| 文件 | 改动 | 说明 |
|---|---|---|
| `packages/desktop/src-tauri/src/feishu_plugin_install.rs` | +63 / -10 | Win 分支删,三平台统一 `home_dir().join(".config/opencode")`;新加 `to_file_url(path)` helper(strip `\\?\` 前缀 + `\` → `/` + 空格 → `%20` + 三斜杠 `file:///`);加 `#[cfg(test)] mod tests` 4 个单测覆盖 UNC / 普通 Win / Unix / Program Files 空格 4 case |

## 两个 bug 实际现象

### Bug 1 — Win 配置路径选错

**症状**:DeskFox setup hook 跑了,但写到的位置 sidecar 永远读不到 → 飞书桥接 UI 永远显示"未启动"警告。

**根因**:

```rust
// 旧(Mac 端 7e5a3ef9b 修法,Win 仍未通):
#[cfg(target_os = "windows")]
let dir = dirs::config_dir()?.join("opencode");  // %APPDATA%\Roaming\opencode\
```

但 `packages/core/src/global.ts:12` opencode-cli 用 `xdgConfig` 来自 npm 包 `xdg-basedir@5.1.0`。看 `node_modules/.../xdg-basedir@5.1.0/index.js:10-11`:

```js
export const xdgConfig = env.XDG_CONFIG_HOME ||
    (homeDirectory ? path.join(homeDirectory, '.config') : undefined);
```

**完全没有 Win 特殊分支**,三平台一致 `$XDG_CONFIG_HOME` 或 `~/.config`。Mac 那笔 `7e5a3ef9b` 基于"xdg-basedir 在 Win 用 APPDATA"的错误假设,实测后才暴露。

**修法**:三平台统一 `dirs::home_dir()?.join(".config").join("opencode")`(对齐 xdg-basedir 实际行为)。

### Bug 2 — plugin URL 反斜杠 + UNC 前缀

**症状**:即使 Bug 1 修了,写进 config 的 URL 是:

```
"file://\\\\?\\D:\\project\\opencode-fork\\packages\\desktop\\src-tauri\\target\\release\\plugin\\feishu-bridge"
```

(`\\?\` 是 Rust `canonicalize()` / Tauri `resource_dir()` 在 Win 上加的扩展长度路径前缀。)Node `import()` / opencode plugin loader 都不接受。

**修法**:抽 `to_file_url(path: &Path) -> String` helper:

```rust
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
```

边界覆盖:
- UNC 前缀 → strip
- 反斜杠 → 正斜杠
- 空格(`C:\Program Files\...`)→ `%20`
- Unix abs 路径 → 无变化(已是正斜杠,起头 `/`)

## 验证

### R5 测试

`#[cfg(test)] mod tests` 4 个单测覆盖 `to_file_url`:

1. UNC 前缀 strip:`\\?\D:\project\plugin\feishu-bridge` → `file:///D:/project/plugin/feishu-bridge`
2. 普通 Win 路径:`D:\foo\bar` → `file:///D:/foo/bar`
3. Unix 路径:`/Users/u/foo` → `file:///Users/u/foo`
4. Program Files 空格:`C:\Program Files\DeskFox\plugin\feishu-bridge` → `file:///C:/Program%20Files/DeskFox/plugin/feishu-bridge`

测试代码 cargo test 编译通过(`Finished test profile`),运行时挂在 cdylib DLL 加载 0xc0000139 — 本 crate 既有 `feishu_adapter` / `cli` 测试同状态(预存基础设施 gap,跟本 fix 无关),基础设施修后一并跑。

### 实测端到端

Win 端 user 拉本笔 build 后:

1. ✅ DeskFox 启动 → setup hook 注入 `~/.config/opencode/opencode.jsonc` 加 plugin 字段(三斜杠 + 正斜杠 + 无 UNC):
   ```
   "plugin": ["file:///D:/project/opencode-fork/packages/desktop/src-tauri/target/release/plugin/feishu-bridge"]
   ```
2. ✅ sidecar 加载 plugin → plugin server 起在 `127.0.0.1:13002`
3. ✅ `~/.opencode/feishu-plugin-server.json` 写出
4. ✅ 设置 → 飞书桥接 tab 切到"添加飞书账号"空态(不再"未启动"警告)
5. ✅ user 扫码绑定 `xiaobei_win` 飞书账号成功

## 教训

- Mac 端假设其他平台行为前要看实际包源码 — `xdg-basedir` 这种 cross-platform npm 包**不一定有 Win 特殊分支**,默认全平台 `~/.config`
- Tauri `resource_dir()` 在 Win dev `--no-bundle` build 下会返扩展长度 `\\?\` 路径,format file URL 必须 strip
- Mac 端 review 修 Win bug 不靠 Win 实测就 commit + push 是漏洞,后续 Win 端 fork-only 改动让 Win 端 review 闸把守

## R4 / 上游侵入

- 0 R4 override(0 黑名单文件,0 bun.lock 改动)
- 0 上游侵入(改的是 fork-only 文件 `feishu_plugin_install.rs`)
