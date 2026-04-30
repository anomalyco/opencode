---
feat-id: 禁自动升级
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 禁自动升级 — spec

## 触发原因

user 担心 opencode 上游的自动升级机制把 DeskFox 替换为官方 OpenCode,导致 fork 改动被覆盖、版本不可用。需求:**关闭所有自动升级入口和通道**,user 双击 DeskFox 启动后绝对没有任何"自动检查 / 自动下载 / 自动安装"路径,UI 也不暴露任何升级入口让 user 误触。

链路调研得三个通道:

### 通道 A — Tauri shell 整壳替换(主战场)
通过 `@tauri-apps/plugin-updater` 替换整个 `.exe`,这是会"把 DeskFox 覆盖成上游"的元凶。

四个入口:
1. **每 10 分钟轮询** — `app/src/pages/layout.tsx:367-418` `useUpdatePolling` mount 后 setInterval
2. **设置面板按钮** — `app/src/components/settings-general.tsx:114-166` Updates section + "Check for updates"
3. **菜单栏菜单项** — `desktop/src/menu.ts:24-25` "Check for Updates..."
4. **错误页面按钮** — `app/src/pages/error.tsx:230,247` 崩溃恢复时

全部通过 `platform.checkUpdate / update / restart`(`desktop/src/index.tsx:287-308`)→ Tauri updater plugin → upstream 的 GitHub releases(配置在 `tauri.{prod,beta}.conf.json` 的 `updater` 段),用 upstream 的 minisign pubkey 验签。

编译时总闸:`constants.rs:6` `UPDATER_ENABLED = option_env!("TAURI_SIGNING_PRIVATE_KEY").is_some()`。当前 `build-deskfox.ps1` 不设此 env → `UPDATER_ENABLED=false` → plugin 不注册 → `checkUpdate` 总返 `{ updateAvailable: false }` → **功能层面已死**。但**入口仍可见**(菜单 disabled 项、设置 Updates 段、polling 仍每 10 分钟跑空转、error 页按钮),user confusion source。

### 通道 B — 内嵌 CLI sidecar 自更新(次)
`packages/opencode/src/cli/upgrade.ts` 通过 curl/brew/choco/npm 替换 `opencode-cli.exe` 自身。
- 触发点:`cli/cmd/tui/thread.ts:220`,**TUI 模式** 启动 1 秒后 RPC `checkUpgrade`
- DeskFox 走 `opencode serve`(server 模式)非 TUI,正常情况下**不进这条路径**
- 守卫 env:`OPENCODE_DISABLE_AUTOUPDATE=true` 或 config `autoupdate: false`

### 通道 C — install 脚本(边角)
`cli.rs:404-408` 仅在 WSL 启用 + sidecar 不存在 时跑 `curl https://opencode.ai/install | bash`。Tauri bundle 内置 sidecar,正常装机后不缺,几乎不触发。

## 验收标准

- [ ] **R1 编译时硬关** — `UPDATER_ENABLED` 在 fork 里是 `false`,即使后续误设 `TAURI_SIGNING_PRIVATE_KEY` env 也不会启用 updater plugin
- [ ] **R2 设置面板看不到 Updates 段** — Settings → General 不再渲染 Updates 整段(包括 "Check for updates" 按钮、版本号等)
- [ ] **R3 菜单栏看不到升级菜单项** — Help / Tools 等菜单不再出现 "Check for Updates..." 条目(连 disabled 灰也不要)
- [ ] **R4 polling 不跑** — DevTools 打开 30 分钟,不应观察到任何 polling 调用 checkUpdate 的日志/网络请求
- [ ] **R5 错误页面无升级按钮** — 模拟崩溃进 error 页,只有 Reload / Continue 等按钮,没有 Update 系列
- [ ] **R6 sidecar CLI 双保险** — 即便有人手动启用 updater 或上游 TUI 路径回流,sidecar env 中 `OPENCODE_DISABLE_AUTOUPDATE=true`,Channel B 也死
- [ ] **R7 不影响其他能力** — 文件查看器 / 聊天 / 文件树 / build 全套照常工作,无回归

## 不做什么

- **不删 `tauri.{prod,beta}.conf.json` 的 `updater` section** — 是 upstream 配置文件,改它是黑名单 override 范畴(R3 hardcode 禁令边界);plugin 已通过 `UPDATER_ENABLED=false` 不注册,configsection 留着无害,删了反而增加 rebase 摩擦。**保留**
- **不删 `cli.rs:404-408` WSL install 脚本路径** — 触发窗口极窄(WSL 启用 + sidecar 文件缺失),改了风险大于收益。**保留**
- **不拦用户手动 `opencode upgrade` CLI 命令** — 那是用户主动行为,不在"自动"范畴。但 DeskFox 用户多半不会拿到 sidecar 命令行,实际触达概率近零。**保留**
- **不做"DeskFox 自家更新通道"** — 是后续话题,本次只关上游入口。Roadmap 上可单独立 feat
- **不动 server 端代码** — 通道 B 守卫已经在(env 一加就生效),不需要改 `cli/upgrade.ts`

## 架构选型

走"**硬关编译时 + 平台接口收口 + sidecar env 双保险**":

1. **constants.rs 改 hard-code**:`UPDATER_ENABLED: bool = false`,加 FORK marker。理由:从源头永久关闭,不依赖签名 env 缺失这种"运气好"的兜底
2. **desktop platform interface 收口**:`desktop/src/index.tsx` 的 `checkUpdate` / `update` 在 `UPDATER_ENABLED=false` 时**完全不暴露**(spread `...(UPDATER_ENABLED ? {...} : {})`)。这样所有 4 个 UI 入口通过现有的 `if (!platform.checkUpdate) return` 自动失效,**不必逐个改 UI**(layout polling / settings UI / error page 全免改)
3. **menu.ts 条件渲染**:菜单项 build 时 `if (!UPDATER_ENABLED) return null`,菜单条干脆不出现
4. **cli.rs 加 env**:`OPENCODE_DISABLE_AUTOUPDATE=true` 加进 sidecar spawn env(原已有 `OPENCODE_EXPERIMENTAL_FILEWATCHER` 等,顺手加),通道 B 双保险

理由:① 平台接口收口比逐 UI 改干净(R1 三级跳里的 L2);② 编译时 hard-code 比依赖运行时 env 状态更稳,不会因将来 build 流程演化而复活;③ sidecar env 是低成本双保险,无副作用。

## 关联

- 现有 fork 安全约束:`CLAUDE.md` R3 hardcode 禁令(品牌字符串/主题色/icon)
- build wrapper:`packages/branding/scripts/build-deskfox.ps1`(memory:验证走 release exe)
- 上游配置:`tauri.{prod,beta}.conf.json` 的 `updater` section(本次不动)
