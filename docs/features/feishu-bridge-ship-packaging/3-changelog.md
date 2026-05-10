---
feat-id: feishu-bridge-ship-packaging
status: done
related: ./3-changelog.md
---

# feishu-bridge-ship-packaging — changelog

## 一句话

让飞书桥接真正进 installer — 之前 Mac 端能跑只因开发者手动改了 `~/.config/opencode/opencode.jsonc` 加 plugin 字段指向本地 source,这个动作没进 commit / build script / installer,真用户装完 .dmg / .exe 跟本没 plugin 文件可指。本笔补齐:bun build bundle plugin → tauri resources 打进 .app/.exe → DeskFox 启动时把 plugin 路径注入 user opencode 配置。

> Medium 规模:5 个新文件 + 4 个文件改动;无 1-spec/2-plan(需求 user 一句话定下),见本文。

## commit 列表

| commit | 简述 |
|---|---|
| `e3feb3467` | `feat(branding): bundle 飞书桥接 plugin 进 installer + setup hook 注入 user opencode 配置 [feat: feishu-bridge-ship-packaging]`(主 commit) |
| `7e5a3ef9b` | `fix(feishu-plugin-install): Win 用 %APPDATA% 路径对齐 xdg-basedir,Mac/Linux 仍 ~/.config`(Win 兼容 follow-up,见下方"Follow-up #1") |

## 改动文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `packages/branding/plugin/feishu-bridge/package.json`(新) | 1 文件 | plugin package metadata,opencode plugin loader 用 `exports["./server"]` 找 entry |
| `packages/branding/plugin/feishu-bridge/.gitignore`(新) | 1 文件 | dist/ 不入仓 |
| `packages/branding/scripts/build-feishu-plugin.sh`(新) | ~55 行 | bun build → 单 dist/plugin.js;时间戳判断同 sidecar(src 新于 dist 才 rebuild) |
| `packages/branding/scripts/build-feishu-plugin.ps1`(新) | ~50 行 | Win 对称版本 |
| `packages/desktop/src-tauri/src/feishu_plugin_install.rs`(新) | ~155 行 | runtime 注入 user opencode config — `resource_dir + plugin/feishu-bridge` 路径 → `~/.config/opencode/opencode.{json,jsonc}` 的 `plugin` 字段;idempotent(已有同 path 子串跳过)+ jsonc 注释剥离 fallback |
| `packages/desktop/src-tauri/src/lib.rs`(改) | +5 行 | mod 注册 + setup hook 调用 ensure_feishu_plugin_in_config |
| `packages/desktop/src-tauri/tauri.conf.json`(改) | +3 行 | bundle.resources map 把 plugin/feishu-bridge/{package.json,dist/plugin.js} 打进 .app Resources / .exe |
| `packages/branding/scripts/build-deskfox.sh`(改) | +3 行 | 0.5 步:调 build-feishu-plugin.sh 确保 plugin bundled |
| `packages/branding/scripts/build-deskfox.ps1`(改) | +3 行 | 同上 Win 版 |

## 数据流

```
┌─ build-time ─────────────────────────────────────────────────────────────┐
│                                                                            │
│   adapter-feishu-lark/src/plugin.ts (+ deps: @larksuiteoapi, axios, qrcode-│
│         │                            terminal, zod)                        │
│         │                                                                  │
│         ▼ build-feishu-plugin.{sh,ps1} 调 bun build --target=bun           │
│         │  external @opencode-ai/{plugin,sdk,sdk/v2,core,core/*}           │
│         ▼                                                                  │
│   packages/branding/plugin/feishu-bridge/dist/plugin.js (~3.4MB 单文件)    │
│         │                                                                  │
│         ▼ tauri.conf.json bundle.resources                                 │
│         ▼                                                                  │
│   .app/Contents/Resources/plugin/feishu-bridge/{package.json,dist/plugin.js}│
│   .exe NSIS resources/plugin/feishu-bridge/{package.json,dist/plugin.js}   │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘

┌─ runtime ────────────────────────────────────────────────────────────────┐
│                                                                            │
│   DeskFox 启动 .setup() hook                                              │
│         │                                                                  │
│         ▼ feishu_plugin_install::ensure_feishu_plugin_in_config           │
│         │   1. app.path().resource_dir() + "plugin/feishu-bridge"          │
│         │   2. 读 ~/.config/opencode/opencode.{jsonc,json}(优先 jsonc)    │
│         │   3. 检查 plugin 数组里有没 path 含 "plugin/feishu-bridge"       │
│         │      a. 有 → 跳过(idempotent)                                  │
│         │      b. 无 → 加 file:///.../plugin/feishu-bridge → 写回           │
│         ▼                                                                  │
│   sidecar 启动 → 读 user 配置 → import plugin → WSS 起来                   │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

## 验证

- ✅ `bun build` adapter-feishu-lark/src/plugin.ts 含全 deps:**3.44MB 单文件**,export `server / default / FeishuBridgePlugin` 完整
- ✅ tauri build 完成后 `.app/Contents/Resources/plugin/feishu-bridge/{package.json,dist/plugin.js}` 都在
- ✅ 启动 DeskFox Dev.app(模拟 fresh user,先清掉 user config 的 plugin 字段)
- ✅ app log:`[feishu-plugin] injected file:///<resource_dir>/plugin/feishu-bridge into ~/.config/opencode/opencode.jsonc`
- ✅ sidecar log:`[feishu-plugin] server: http://127.0.0.1:xxxxx`(plugin server 起来了)
- ✅ sidecar log:`[feishu-plugin] synced: WSS=2/2 pipelines=2`(2 个 user 之前绑定的账号 WSS 长连接成功)

## idempotent 行为

inject 已存在同 path 子串(`plugin/feishu-bridge`)的项就跳过 — 重启 DeskFox 不会重复加,user 自己手动配过开发版同 path 也不动。

但 **dev 历史**:dev 在自己机器上手动配过 dev source 路径(`adapter-feishu-lark/src/plugin.ts`)时,跟 installer 路径**不同子串**,会**两条共存**(plugin 模块级 `initialized = false` flag 防止重复 setup 但 sidecar 仍会 import 两次)。dev 自己删一条即可。Real user 不会遇到这个边角。

## 已知 trade-off

1. **inject 路径写绝对路径**:不同 user 机器装不同 .app 位置 → user config 内绝对路径不通用。但 DeskFox 每次启动都重算 + idempotent 检测,不阻断。
2. **bundled plugin 静态打 deps**:adapter-feishu-lark 改 deps 后必须重 build plugin(由 build-feishu-plugin.{sh,ps1} 时间戳判断自动触发)+ 重 build .app/.exe(让新 plugin.js 进 Resources)。
3. **jsonc 注释剥离是简化版**:line `//` + block `/* */`,不严格;复杂 jsonc 文件可能解析失败,但当前 user opencode 配置不太会遇到。

## 关联

- 起源:Win 用户反馈"feishu 桥接 plugin 没在 installer 里",一查 Mac 也是 dev 改 user config 才能跑 — 整个 feat ship 流程不完整。
- Sibling 修复:Mac sidecar 过期陷阱(`fix/macos-docx-viewer`)— 同一波 build-pipeline 调研顺手发现 plugin packaging 缺口。

## 回退

```sh
git revert <本笔 commit>
```

回退 = `bundle.resources` 还原、setup hook 不再调,user config 已 inject 的 plugin 行不动(idempotent 不重复加,但已有的不删)。

## 影响范围

- 0 行代码改 packages/opencode/(纯 fork-only)
- 0 行代码改 ui pkg / app pkg
- 增加 build 时间:plugin bundle ~80ms(可忽略)
- 增加 .app/.exe 体积:~3.4MB(plugin bundled 文件)
- 0 R4 override
- Win/Mac 双端 build script 同步改

## FUTURE

- 把"installer ship plugin" 抽象成通用模式(以后 multi-IM:Slack/WeChat plugin 同套机制)
- inject hook 加 unhealthy detection:resource 文件丢失时清掉无效 plugin entry,防 sidecar 启动失败循环

## Follow-up #1(2026-05-09):Win 端 user config 路径对齐 xdg-basedir(commit `7e5a3ef9b`)

**起源**:Mac 端实测通过 push 完之后,review `feishu_plugin_install::resolve_user_config_path` 发现 Win 兼容性 bug — 硬编码 `dirs::home_dir() + .config/opencode/` 在 Win 上算到 `C:\Users\<user>\.config\opencode\`,但 opencode 自己用 `xdg-basedir` npm 包,Win 行为是 **`%APPDATA%\opencode\`**(读 `process.env.APPDATA`)。如果不修,Win 端 inject 跑了但写到错位置,sidecar 读不到 plugin 字段,等于没注入。

**修法**(`packages/desktop/src-tauri/src/feishu_plugin_install.rs`):

```rust
#[cfg(target_os = "windows")]
let dir = dirs::config_dir()?.join("opencode");           // %APPDATA%\Roaming\opencode\
#[cfg(not(target_os = "windows"))]
let dir = dirs::home_dir()?.join(".config").join("opencode");  // ~/.config/opencode/
```

`dirs::config_dir()` 在 Win 返 `%APPDATA%\Roaming\` — xdg-basedir 在 Win 上读的是 `%APPDATA%`(默认就是 Roaming),所以对齐。

**为什么不直接 `dirs::config_dir()` 一个跨平台**:macOS 上 `dirs::config_dir()` 返 `~/Library/Application Support/`,跟 xdg-basedir 在 darwin 上的 `~/.config/` 冲突。所以分平台。

**验证**:Mac 端 cargo check 通过(Win cfg 分支 cfg-gated dead code,Mac 不参与编译);Win 端实测要等 Win user 拉新 dev build。

**为什么这笔没跟主 commit 一起**:主 commit 已 push 完才发现的 Win 兼容性 review 漏掉,follow-up 单独 commit 走 fix 分支(同 feat-id 标记 `[feat: feishu-bridge-ship-packaging]`)。本笔 changelog 当时漏补,user 提醒后 docs 分支补落盘 — 教训:**bug-repro 类的 commit 不仅 commit message 标 tag,changelog follow-up 段同步落地**。

> **2026-05-10 续笔修正**:本 follow-up 基于错误假设(以为 xdg-basedir 在 Win 用 `%APPDATA%`)。实际 `xdg-basedir@5.1.0` 三平台一致 `$XDG_CONFIG_HOME` 或 `~/.config`,**没有 Win 特殊分支**。Win 端实测后此笔注入仍命不中 sidecar 路径(`%APPDATA%\Roaming\opencode\` 跟 `~/.config/opencode/` 不重叠),且 `file://` URL 还有反斜杠 + `\\?\` UNC 前缀第二个 bug。两 bug 真正修复见独立 follow-up feat [`feishu-plugin-install-win-path`](../feishu-plugin-install-win-path/3-changelog.md)(commit `7f65c691e`,Win 端 user 实测扫码绑定通)。教训:**修跨平台 bug 不靠目标平台实测就 commit + push 是漏洞,Win 端 fork-only 改动应让 Win 端 review 闸把守**。

## Follow-up #2(2026-05-10):Win Inno Setup `.iss` 没 bundle plugin

**起源**:user 在 Win 端 build 第一笔 prod installer `DeskFox-2026.5.10.1-setup.exe` 装到 user 机器后,飞书桥接 tab 仍显示"未启动"警告 — 跟修 ship-packaging 之前一模一样。复盘发现 ISCC log 编译 installer 时 `[Files]` 只 3 行(`DeskFox.exe` + `opencode-cli.exe` + `opencode_lib.dll`),plugin/ 整个目录**不进** setup.exe。

**根因**:本笔(主 commit `e3feb3467`)只动了 `tauri.conf.json` 的 `bundle.resources`,让 **Tauri 自带的 NSIS bundler** 把 plugin 打入 .app/.exe(Mac 路径走通)。但本仓 Win 端用 **Inno Setup**(`packages/branding/installer/DeskFox.iss`),`.iss` 是独立配置,主笔没补 [Files] 段 → installer 不带 plugin → install 后路径不存在 → resolve_plugin_dir 返 None → 整个注入流程跳过。

**修法 + 实测**:见独立 follow-up feat [`feishu-installer-bundle-plugin`](../feishu-installer-bundle-plugin/3-changelog.md)(commit `39e487f75`,Win user 装新 installer 后飞书桥接直接到 "添加账号" 空态)。

**教训**:跨平台 ship 路径不能假设"一种打包格式做完了别的也跟着做完"。Tauri NSIS bundler(默认)和 Inno Setup(本仓 Win 自定义)是两套独立配置,后续任何往 install dir 加资源的改动都要同步动两处:`tauri.conf.json` `bundle.resources` 和 `DeskFox.iss` `[Files]` 段。
