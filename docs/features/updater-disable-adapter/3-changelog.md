---
feat-id: updater-disable-adapter
status: done
related: ./3-changelog.md
---

# updater-disable-adapter — changelog

## 背景

为下次 `git fetch upstream && git merge upstream/dev` 做 prep。fork 在 2026-04-28 落地的 `禁自动升级` 功能(commit `592ed714e`)采用"**条件 spread,UI 入口完全不暴露**"模式,让 polling/settings/menu/error 各 UI 入口通过 `if (!platform.checkUpdate) return` 自动失效。

之后 upstream 也加了相同的禁用能力,但走的是"**UI 入口永远存在,方法内部 sentinel 短路**"模式 —— 与 fork 走法**结构差异显著**,每次 upstream 改 createPlatform 都会跟 fork 撞。playbook §4.4 类型 4(策略路线分歧)。

**未来扩展**:user 计划上线 fork 自家 update 服务(DeskFox 自有 update server),届时同样的 UI 入口需要重新接到 fork 的服务上。这意味着 fork 当前"藏 UI"的工作未来要全部"露回 UI"——每藏一处,未来就多一笔反向改动。

## 调研:实际冲突 + 演进面

`git diff dev upstream/dev -- 6 个文件` 后定位:

| 文件 | Fork 现状 | Upstream 改动 | 冲突类型 | Fork 是否动过 |
|---|---|---|---|---|
| `desktop/src-tauri/src/constants.rs` | hard `false` + FORK marker | 反向回 `option_env!("...")` 检测 | 政策分歧(永远只能 take fork) | 是 |
| `desktop/src/index.tsx` createPlatform | conditional spread `...(UPDATER_ENABLED ? {...} : {})` | inline `if (!UPDATER_ENABLED) return ...` 哨兵 + rename `update → updateAndRestart` + 加 `relaunch()` | **结构分歧 + API rename + 行为变** | 是 |
| `desktop/src/menu.ts` | conditional spread 完全不渲染 | `enabled: UPDATER_ENABLED` 灰显 | **结构分歧 + UX 取舍** | 是 |
| `desktop/src-tauri/src/cli.rs` `OPENCODE_DISABLE_AUTOUPDATE` env | fork 加项 | 上游不动我们加的块周边 | 纯增量(永久 0 冲突) | 是(无须再动) |
| `app/{layout.tsx, error.tsx, settings-general.tsx}` | 调 `platform.update + platform.restart` | rename → `platform.updateAndRestart`(融合 install + relaunch) | 跟随 rename | **否**(fork 没改过,upstream merge 自动 take) |
| `desktop-electron/src/renderer/index.tsx` | 调 `update:` | rename → `updateAndRestart:` | 跟随 rename | **否**(fork 不 ship electron) |

## 三个原则下的方案推演

按 user 优先级:① 稳定第一 ② 跟上上游改进 ③ 能永久解决就永久解决。

### 方案 1(精简 prep,本次落地)
- 只对 fork-touched 文件做 **结构对齐**:sentinel pattern + menu enabled flag
- **不**做 rename(`update` 名称保留)、**不**预 do 加 `relaunch()`
- **不**碰 electron / app callers / Platform type(都是 fork 没动过的文件,上游 rename 在 merge 时自动落)

### 方案 2(完整 prep,未采用)
- 完整对齐上游 API:rename + relaunch + 改 Platform type + 改 app callers + 改 electron
- 触动 `desktop-electron/`(blacklist),需 R4 override 第 3 笔本季(超本季 ≤2 配额)
- 额外"永久解决"收益 = **0** —— 因为多动的文件(electron / app callers / platform.tsx)都是 fork 没改过的,upstream merge 时自动 take 上游就完事

### 决策

**关键洞察**:rename 是 **one-time 事件**(upstream 不会 rename 第二次),deferring 到 merge **不违背**"永久解决"。merge 那次应用一次,从此永远不再撞。

而 sentinel pattern 和 menu UX 是 **structural 选择**,fork 不主动适配则上游每次改 createPlatform 都可能再撞 —— **这才是真正需要"永久解决"的 surface**。

| 原则 | 方案 1 评估 | 方案 2 评估 |
|---|---|---|
| 稳定第一 | ✅ 0 R4,机械改动,风险低 | 🟡 R4 第 3 笔本季,超配额 |
| 跟上上游 | ✅ structural 已对齐;rename 跟着 merge 自动落 | ✅ 完全对齐 |
| 永久解决 | ✅ structural surface 永久 0 冲突;rename 一次性事件由 merge 处理 | ✅ 整 surface 永久 0 冲突 |

**方案 1 性价比明显更高,采纳**。

### 未来 fork updater 上线路径(本笔为之铺垫)

当 user 自家 update 服务上线时:
1. 在 `constants.rs` 翻 `UPDATER_ENABLED = true`(或换成 `UPDATER_BACKEND` switch)
2. 在 `desktop/src/index.tsx` 的 `checkUpdate` / `update` 内部把 `check()` / `update.install()` 换成 DeskFox API 调用
3. **UI 层(menu / settings / polling / error)无需改动,自动亮**

本次 sentinel pattern + menu enabled flag 适配,正是为这个未来路径铺好的载体 —— **不藏 UI,只关后端**。

## 实现

### EDIT `packages/desktop/src/index.tsx`(~22 行净改动)
- 删 conditional spread `...(UPDATER_ENABLED ? {...} : {})`
- `checkUpdate` 永远存在,首行 `if (!UPDATER_ENABLED) return { updateAvailable: false }`
- `update` 永远存在,首行 `if (!UPDATER_ENABLED || !update) return`
- **保留 `update` 旧名 + 旧行为**(install only,无 relaunch)— rename + relaunch 由 upstream merge 自然落
- FORK 注释更新,标 sentinel 用意 + future fork updater 路径 + 为何不预 rename

### EDIT `packages/desktop/src/menu.ts`(~7 行净改动)
- 删 conditional spread `...(UPDATER_ENABLED ? [...] : [])`
- 改成 `await MenuItem.new({ enabled: UPDATER_ENABLED, ... })` 直接渲染
- `UPDATER_ENABLED=false` 时菜单条目**灰显**(放弃原 spec "连 disabled 灰也不要")
- **UX 取舍理由**:
  - 未来 fork updater 上线时,菜单条目自动从灰显变可点,无需删 conditional 把它放回去
  - mac 才走该 menu(`if (ostype() !== "macos") return` 上游已 gate),Win 用户看不到此菜单 —— UX 影响面就 mac 一个端
  - 灰显是合适的"功能 placeholder"信号,告诉 user "这里以后会有"
- FORK 注释更新

### EDIT `packages/desktop/src-tauri/src/constants.rs`(注释更新,值不变)
- 值仍为 `UPDATER_ENABLED: bool = false`
- 注释从"永久关闭官方自动升级,防止 DeskFox 被替换为上游 OpenCode"
- 改为"updater backend 总开关 — 当前 false 防替换;**未来 fork 自家 updater 上线时翻 true**,UI 层自动亮"
- 强调这是 backend switch,不是永久关 UI

### 不动的文件
- `packages/desktop/src-tauri/src/cli.rs` `OPENCODE_DISABLE_AUTOUPDATE` env —— 跟 DeskFox 整壳更新无关(这是 opencode CLI sidecar 自更新通道 B 守卫,两者各自独立,守卫永远要在)
- `packages/app/{layout.tsx, error.tsx, settings-general.tsx}` —— fork 没动过,upstream rename 在 merge 时自动 take
- `packages/app/src/context/platform.tsx` Type 定义 —— 同上
- `packages/desktop-electron/src/renderer/index.tsx` —— 同上,且 DeskFox 不 ship electron

## 验证

| 项 | 结果 |
|---|---|
| `bun turbo typecheck --force`(全 monorepo,无缓存) | **15/15 successful** |
| `build-deskfox.ps1 -Env dev -NoBundle` 端到端 release build | **DeskFox.exe ready**(64s) |
| 实际"Check for Updates" 灰显 + 设置面板 polling no-op | 待 user 自验 |

## 影响范围

### 本次直接收益
- index.tsx tauri createPlatform 结构跟上游对齐
- menu.ts pattern 跟上游对齐
- constants.rs 注释强调"backend 总开关"语义,future fork updater 上线只需 1 行翻 `true`

### 下次 sync upstream merge 这 surface 的处理
| 文件 | 操作 |
|---|---|
| `constants.rs` | 1-line 冲突,take fork(政策行) |
| `index.tsx` tauri createPlatform | 上游加的 rename + relaunch 跟 fork 的 sentinel pattern 合并,~3-5 行机械冲突;take 上游的 rename + relaunch 即可 |
| `menu.ts` | 0 冲突 |
| `cli.rs` | 0 冲突(纯增量) |
| `app/{layout, error, settings-general}.tsx` | 0 冲突(fork 没动,take 上游 rename) |
| `app/context/platform.tsx` Type | 0 冲突(fork 没动) |
| `desktop-electron/index.tsx` | 0 冲突(fork 没动) |

预期 merge 这 surface 总工 < 5 分钟。

### 未来 fork updater 上线时的工
- `constants.rs`:翻 `UPDATER_ENABLED = true`,或换成 `UPDATER_BACKEND` switch
- `index.tsx`:`checkUpdate` 内 `check()` 换成 DeskFox API,`update` 内 `update.install()` 换成 DeskFox installer flow
- 其他全自动亮

## R4 override

**无**。3 个改动文件均不在 blacklist:
- `packages/desktop/` —— blacklist 列的是 `packages/desktop-electron/`,Tauri 包不在
- `packages/desktop/src-tauri/(tauri.*\.conf\.json|build\.rs|capabilities/|icons/|entitlements\.plist)` —— 仅这些特定 tauri 配置文件 blacklist,`src/constants.rs` 不在

## 回退方法

完全可逆。如果未来发现 sentinel + 灰显 menu 体验有问题,直接:
1. `git revert` 本笔 commit 回到 conditional spread 方案
2. 重新评估 + 重做

无 lock-in。
