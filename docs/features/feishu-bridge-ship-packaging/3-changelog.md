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
| (本笔 commit) | `feat(branding): bundle 飞书桥接 plugin 进 installer + setup hook 注入 user opencode 配置 [feat: feishu-bridge-ship-packaging]` |

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
