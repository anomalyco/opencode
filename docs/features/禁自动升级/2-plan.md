---
feat-id: 禁自动升级
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 禁自动升级 — plan

## 实施步骤

### 1. `packages/desktop/src-tauri/src/constants.rs`(改 1 行 + FORK marker)

改前:
```rust
pub const UPDATER_ENABLED: bool = option_env!("TAURI_SIGNING_PRIVATE_KEY").is_some();
```

改后:
```rust
// FORK: 永久关闭官方自动升级,防止 DeskFox 被替换为上游 OpenCode(禁自动升级 2026-04-28)
pub const UPDATER_ENABLED: bool = false;
```

### 2. `packages/desktop/src/index.tsx`(条件不暴露 checkUpdate / update)

改前:
```ts
checkUpdate: async () => {
  if (!UPDATER_ENABLED) return { updateAvailable: false }
  ...
},
update: async () => {
  if (!UPDATER_ENABLED || !update) return
  ...
},
```

改后:
- 把这两个 key 移到一个 spread 块,通过 `UPDATER_ENABLED` 决定是否合入 platform 对象。`UPDATER_ENABLED=false` 时这俩 key 在 platform 上不存在,所有 `if (!platform.checkUpdate) return` 自动短路
- 加 FORK marker

具体:platform 对象构造里加
```ts
// FORK: UPDATER_ENABLED=false 时不暴露 checkUpdate/update,让所有 UI 入口自动失效(禁自动升级)2026-04-28
...(UPDATER_ENABLED
  ? {
      checkUpdate: async () => { /* 原逻辑 */ },
      update: async () => { /* 原逻辑 */ },
    }
  : {}),
```

### 3. `packages/desktop/src/menu.ts`(条件不渲染 "Check for Updates...")

改前:
```ts
{
  enabled: UPDATER_ENABLED,
  action: () => runUpdater({ alertOnFail: true }),
  text: t("desktop.menu.checkForUpdates"),
}
```

改后:菜单项 build 阶段直接跳过(返 null/undefined),不出 disabled 灰条目。具体形式根据 menu 数组结构调整(可能是过滤掉这一项)。加 FORK marker。

### 4. `packages/desktop/src-tauri/src/cli.rs`(sidecar env 加双保险)

`spawn_command` 函数里 `envs` 数组加一项 `("OPENCODE_DISABLE_AUTOUPDATE", "true")`,WSL 路径的 env_prefix 也加一行 `"OPENCODE_DISABLE_AUTOUPDATE=true"`。加 FORK marker。

理由:DeskFox 启的是 `opencode serve` 不走 TUI 路径,通道 B 实际触达概率近零;但 env 加了不花钱、不增加副作用,作为永久双保险。

### 5. `packages/app/src/pages/layout.tsx` 和 `settings-general.tsx` 和 `error.tsx`(可能不动)

预期:**不动**。理由:
- `useUpdatePolling`(layout.tsx:369)首句 `if (!platform.checkUpdate || !platform.update || !platform.restart) return` — 第 2 步移除 platform key 后自动短路 ✓
- `settings-general.tsx:606` `disabled={!platform.checkUpdate}` — 同理短路;但 disabled 按钮仍占位置,**视觉上仍出现一个灰按钮**。需要进一步包条件渲染才算彻底隐藏。**第二轮验证后决定是否补**
- `error.tsx:230` `if (!platform.checkUpdate) return` — 短路 ✓

第一轮验证(R1-R7)后若发现 settings UI 仍出现 disabled 控件,补包 `<Show when={platform.checkUpdate}>`。这步留作"如有必要"。

### 6. 同笔 commit(预算 ≤30 行代码)

第 1-4 步合 1 笔,跨 Rust + TS,主题"禁自动升级"强耦合。如第 5 步必要可同笔。预估 ~20-30 行 staged。

## 决策轨迹

| 决策点 | 选项 | 取舍 | 理由 |
|---|---|---|---|
| 关闭 updater 的层 | A. 删 conf updater 段 / B. 编译时 hard-code 关 / C. 运行时 flag | B | A 改 upstream 黑名单文件成本高且没必要;C 不稳(env 流程演化可能复活);B hard-code 永久死,FORK marker 可见 |
| UI 入口隐藏方式 | A. 逐 UI(4 处)改条件渲染 / B. platform 接口收口 | B | platform 接口是单点,4 处 UI 通过现有 guard 自动失效,改动从 4×N 降到 1×1 |
| sidecar Channel B 守恒 | A. 改 cli/upgrade.ts 内部 / B. cli.rs spawn env 加 OPENCODE_DISABLE_AUTOUPDATE | B | A 动 server 代码增加 rebase 摩擦;B 是 fork-only 的 spawn 注入,顺手 |
| 是否动 conf 文件 | A. 删 updater 段 / B. 留着 | B | plugin 已不注册,conf 段是 dead code;删它没收益增加 rebase 冲突点 |
| FORK marker 数量 | 多处 / 几处 | 4 处都加 | constants.rs / index.tsx / menu.ts / cli.rs 都触动 upstream,P5 显性化 |

## 风险

- **错误页 / 设置页仍可见 disabled 控件**:platform 接口短路只是阻止动作,UI 控件本身可能仍渲染但 disabled。如果 user 报"我看到一个灰的检查更新按钮",再补条件渲染。低风险,验证后定
- **Rebase 时 upstream 改 constants.rs**:upstream 若改 `UPDATER_ENABLED` 周边代码,FORK marker 让 rebase 冲突可见,手工合并 — 这正是 P5 显性化的设计意图
- **若 user 错装上游 OpenCode 在同机**:不冲突,DeskFox 自己的 updater 关了不影响 OpenCode 自己升级它的副本(identifier 不同,目录不同)
- **回退**:`git revert` 一次到位,4 文件都是改单点常量/spread/数组/env,无 schema 变更

## 预算

| 项 | 行数 |
|---|---|
| `constants.rs` | ~3 行(常量改 + FORK 注释) |
| `index.tsx`(spread 改造)| ~10 行 |
| `menu.ts`(过滤菜单项)| ~5 行 |
| `cli.rs`(env 加 1-2 项)| ~6 行(主 + WSL 两份) |
| **代码 staged** | **~24 行**(<<500 阈值) |
| 文档(本目录三件)| ~250 行 |

无 large-diff,无黑名单 override(均在 fork 白名单或常规上游 edit + FORK marker)。

## 验证脚本

照规范走 `D:\project\opencode-fork\packages\branding\scripts\build-deskfox.ps1 -Env dev -NoBundle`,~1-2 分钟出 `DeskFox.exe`,user 双击验 R1-R7。

R1 验证方法:DevTools Console 跑 `window.__OPENCODE__?.updaterEnabled` 应返 `false`。

## 走过的弯路 / 中途调整

- **设计 / 实施零弯路**:三通道的根因调研一次到位,选型 platform 接口收口 + hard-code constants + sidecar env 三条策略一次写完即过 typecheck + build + R1 实测。
- **微调 — 内部 `if (!UPDATER_ENABLED) return` 早返清理**:第 2 步 spread 改造后,checkUpdate / update 函数体内的早返 guard 变成 dead code(spread 在外层已 gate)。原计划保留但实际清理掉,代码更干净 — 这是顺手的简化,不是反复。
- **R2 视觉细节没纠结**:平台接口短路阻止了所有点击行为(R1 锁死),但 settings UI 是否仍渲染一个灰 disabled 按钮未单独验。user 反馈"看了检查更新已经入口已经锁死,无法点击" — 没明确说是消失还是 disabled。本次按"功能层面已死"收口,视觉清理留作后续如有反馈再补。
