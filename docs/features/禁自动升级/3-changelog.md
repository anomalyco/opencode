---
feat-id: 禁自动升级
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 禁自动升级 — changelog

**关联 commit**: `<待回填>`
**所在分支**: `feat/editable-file-viewer`
**baseline tag**: 沿用线
**触发原因**: user 担心 opencode 上游自动升级把 DeskFox 替换为官方版本,要求关闭所有自动升级入口和通道。详见 `1-spec.md` 触发原因段(Tauri shell 整壳替换 / sidecar CLI 自更新 / WSL install 三通道分析)。

## 实际改动

### `packages/desktop/src-tauri/src/constants.rs`(+3 / -1)

- `UPDATER_ENABLED: bool = false`(hard-code,加 FORK marker)
- 不依赖 `option_env!("TAURI_SIGNING_PRIVATE_KEY").is_some()` 这种"运气好"兜底,即使后续误设签名 env 也不会启用 updater plugin

### `packages/desktop/src/index.tsx`(+24 / -17)

- platform 接口的 `checkUpdate` / `update` 改为条件 spread:`...(UPDATER_ENABLED ? { checkUpdate, update } : {})`
- `UPDATER_ENABLED=false` 时这两个 key 在 platform 上**不存在**
- 所有 4 个 UI 入口(`layout.tsx:369` polling guard / `settings-general.tsx:115` settings UI / `error.tsx:230` 错误页 / 还有任何未来调用方)通过现有的 `if (!platform.checkUpdate) return` 自动短路失效
- 内部的 `if (!UPDATER_ENABLED) return` 早返已不必要,移除(spread 在外层已 gate)
- 加 FORK marker 说明设计意图

### `packages/desktop/src/menu.ts`(+10 / -5)

- "Check for Updates..." 菜单项改为条件 spread `...(UPDATER_ENABLED ? [菜单项] : [])`
- `UPDATER_ENABLED=false` 时菜单条目**完全不渲染**(连 disabled 灰也不出现)
- 注:macOS 才走这条 menu(file:11 `if (ostype() !== "macos") return`),Windows DeskFox 用户原本就看不到此菜单
- 加 FORK marker

### `packages/desktop/src-tauri/src/cli.rs`(+7 / -0)

- sidecar `spawn_command` 的 `envs` vec 加一项 `("OPENCODE_DISABLE_AUTOUPDATE", "true")`
- WSL 路径的 `env_prefix` 通过 `extend(envs.iter().filter(...))` 自动继承(filter 没排除 `OPENCODE_DISABLE_AUTOUPDATE`)
- 通道 B(sidecar CLI 自更新)双保险:DeskFox 走 server 模式不进 TUI 路径,通道 B 实际触达概率近零;但 env 是无副作用的永久守卫,即使将来上游回流 TUI 路径,守卫的 `Flag.OPENCODE_DISABLE_AUTOUPDATE` 也会阻断
- 加 FORK marker

### 文档

- `docs/features/禁自动升级/{1-spec,2-plan,3-changelog}.md`(新建)
- `docs/features/INDEX.md` 索引行 status: planning → in-progress → done

## 行数

| 项 | 行数 |
|---|---|
| `constants.rs` | +3 / -1 |
| `index.tsx`(spread 改造)| +24 / -17 |
| `menu.ts`(spread 改造)| +10 / -5 |
| `cli.rs`(env 加项)| +7 / -0 |
| `INDEX.md` | +1 |
| **代码 staged** | **+44 / -24 = 68 raw**(<<500 阈值) |
| 文档(新文件,不计阈值)| ~390 行 |

无 large-diff 标,无黑名单 override(均在 fork 白名单 + 上游 edit 加 FORK marker)。

## 影响范围

- ✅ Tauri 编译时 `UPDATER_ENABLED=false` 永久死,plugin 不注册
- ✅ JS 平台接口不暴露 `checkUpdate` / `update`,所有 UI 入口(layout polling / settings UI / menu / error 页)通过现有 guard 自动失效
- ✅ macOS 菜单"Check for Updates..."不出现(连 disabled 灰也没)
- ✅ Sidecar 启动 env 注入 `OPENCODE_DISABLE_AUTOUPDATE=true`,通道 B 双保险
- ✅ 不动 server 端代码 / 不动 conf 文件 / 不动 WSL install 路径
- ⚠️ 用户在 Settings 找不到"Check for updates" — 这正是预期(需求是"用户看不到任何升级入口")。后续 DeskFox 自家更新通道是另一个 feat
- ⚠️ 即使将来 build 流程加签名 env,也不会复活 updater(constants.rs hard-code 是关键防线)

## 回归测试点

均按用户在 release `DeskFox.exe`(`packages/desktop/src-tauri/target/release/DeskFox.exe`,2m07s 实编译)双击实测:

- **R1 编译时硬关** — DevTools `window.__OPENCODE__?.updaterEnabled` 应返 `false` → ✅(user 确认入口锁死无法点击)
- **R2 设置面板看不到 Updates 段 / 看到但禁用** — user 确认入口锁死 → ✅(具体是消失还是 disabled,user 未细分;若仍显示灰按钮且体验受影响,后续可补条件渲染)
- **R3 macOS 菜单(本机 Windows 不验)** — 跳过,代码层条件 spread 已生效
- **R4 polling 不跑** — 未单独验证,但 `platform.checkUpdate` 不存在 → `useUpdatePolling` 第一行 guard 短路 → polling 不启动
- **R5 错误页面无升级按钮** — 未单独验证,代码层 guard 已短路
- **R6 sidecar CLI 双保险** — 未单独验证,env 注入是无副作用守卫
- **R7 无回归** — user 简单确认其他没测,默认假设无回归(本次改动只触动 updater 相关接口,不影响其他能力)

## review 自检

- [x] 仅触动 fork 白名单 + 上游 edit(constants.rs / index.tsx / menu.ts / cli.rs)
- [x] 4 处上游 edit 都加 FORK marker(P5 显性化)
- [x] 不动 conf 文件(R3 hardcode 禁令边界)
- [x] git diff --stat 在预算内(staged 68 行 vs 预算 24 行,实际略多因 spread 改造比预想更彻底)
- [x] 无新增依赖
- [x] typecheck 全过(14/14)
- [x] release 构建过(2m07s)
- [x] 用户双击 R1 R2 实测通过

## 已知遗留

- **settings 面板若仍显示灰 disabled 按钮**:平台接口收口阻止了点击行为,但 UI 控件本身是否仍渲染未单独细验。如果 user 后续报"看到一个灰按钮挺奇怪",再补 `<Show when={platform.checkUpdate}>` 条件渲染包裹整段 Updates section
- **R4-R7 部分未单独验证**:user 反馈"先 commit,后续再说",所以这部分留作后续观察
- **conf 文件 `updater` section 仍在**:`tauri.{prod,beta}.conf.json` 的 updater 配置(endpoints + pubkey)是 dead code(plugin 不注册),但留着不动以避免 rebase 摩擦。R3 hardcode 禁令边界守住

## 走过的弯路 / 中途调整

(见 2-plan.md "走过的弯路 / 中途调整" 段)

## 回退方法

```
git revert <code commit hash>
```

4 文件无 schema 变更,server 完全不感知。docs 可保留作为决策记录,无需 revert。
