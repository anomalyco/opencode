---
feat-id: auto-save-debounce-flush
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# auto-save-debounce-flush — changelog

**关联 commit**: `<本笔 commit>`
**所在分支**: `feat/auto-save-debounce-flush`
**规模**: Medium(~190 行代码 + ~120 行单测 + ~500 行三文档,2 个新文件)
**触发**: 2026-05-21 落地 `large-file-preview-guard` 后 user 提出数据丢失痛点:Edit 改了文件没保存,切 tab / 关 app 直接丢改动 → 拍 C 方案(混合 debounce auto-save + flush,跟 Obsidian 风对齐)

## 实际改动

### 1. 新 `packages/app/src/utils/debounce.ts`(+30)

pure helper(无 SolidJS 依赖,可单测):
- `createDebounced(fn, delayMs)` 返回 `{ trigger, flush, cancel, pending }`
- `trigger` 重置计时器,`flush` 立即执行待执行 fn,`cancel` 只清不执行

### 2. 新 `packages/app/src/utils/debounce.test.ts`(+118)

9 单测:trigger 后 delay 内不调 / 多次 trigger 重置 / flush 同步触发 / flush 无挂起 noop / cancel 不执行 / 重复 cancel 安全 / pending 状态正确 / async fn fire-and-forget / delayMs=0 edge case

### 3. `packages/app/src/context/file.tsx`(+43)

加 2 个新方法挂 file context:
- **`markSelfWriting(path, windowMs=500)`** — 标记 500ms 自写窗口
- **`setStoredContent(path, content)`** — 直接更新 store 的 content(同步,不走 IO)
- `notifyDirtyConflict` 入口检测 `isSelfWriting`,跳过 toast(防 auto-save 写盘触发 watcher → 误弹"AI 修改了此文件")

### 4. `packages/app/src/pages/session/file-tabs.tsx`(+117 / -16)

核心改造:
- **`saveEditCore({ silent })`**:重构原 saveEdit,silent 路径不 toast、不退编辑、不 reloadAndExitEdit,只更新 mtime;mtime 冲突 silent 模式不弹 confirm(留 draft 让 user 主动 Save 时再处理),toast 警告"自动保存暂停"
- **debounce auto-save effect**:`draft` 变化 + `editing && dirty` → `autoSave.trigger()`(1s debounce)
- **`editing` 退出 effect**:`autoSave.cancel()` 清挂起任务
- **`onCleanup` flush**:**unmount 时(切 tab / `<Show keyed>` remount)**同步 snapshot path/draft/mtime/root,fire-and-forget IIFE 写盘 + `setStoredContent` 立即更新 store
- **window close listener**:`onMount` 注册 `deskfox-flush-now` DOM 事件,触发时调 `autoSave.flush()`

### 5. `packages/app/src/pages/layout.tsx`(+16)

`onMount` 注册 Tauri `listen("deskfox-flush-before-close")` 监听,转发为 DOM `CustomEvent("deskfox-flush-now")`(让 file-tabs 消费)。

### 6. `packages/desktop/src-tauri/src/lib.rs`(+9 / -2)

`CloseRequested` handler 前置 `app.emit("deskfox-flush-before-close", ())`,让前端 listener 在 hide 窗口 / 退出前触发 flush。

## 调研期重大发现 / 决策反复

### 🔴 决策反复 1:tab switch flush 位置(effect → onCleanup)

**初版误判**:在 `createEffect(on(path, ...))` 里 flush — 假设 path 信号变化时 effect 触发。

**实测发现**:`session-side-panel.tsx` 用 `<Show when={activeFileTab()} keyed>` 渲染 `FileTabContent`,**切 tab 时整个组件 unmount + remount**。path 信号每次都是新组件实例首次出现,从未"变化"。effect 永远不 fire。

**修法**:flush 逻辑搬到 `onCleanup`(组件 unmount 真触发点)。snapshot 模式 + `setStoredContent` 保留。

### 🔴 决策反复 2:tab switch flush 用 file.load(force) vs setStoredContent

**初版**:IIFE 写盘后调 `file.load(oldPath, {force: true})` 走 sdk.client.file.read 刷 store。

**问题**:
1. IO 100-200ms,跟 user 切回 tab race(user 快切回看 stale 内容)
2. `session.tsx:488` 切 tab 时调 `file.load(path)` **不加 force** → store.loaded=true 早返回,不重拉,看 stale

**修法**:暴露 `file.setStoredContent(path, content)` 同步直接更新 store,跳过 IO。因为我们 KNOW 磁盘内容 = 刚写的 snap,无需再读。

### 🔴 决策反复 3:saveEditCore silent 路径不调 file.load force

**初版**:silent save 完成后也调 file.load force 让 store 同步磁盘。

**问题**:user 还在 editing,store contents 变化 → CodeMirror `value` prop 变化 → 可能 reset editor 内容 → user 输入丢失(race)

**修法**:silent save 只更新 loadedMtime,不刷 store。store 留 stale(无伤,user 看的是 draft 不是 contents)。切 tab 退 editing 后(onCleanup IIFE)才用 `setStoredContent` 刷 store。

### 🟡 注意点:isSelfWriting + watcher dispatch

`watcher.ts` 的 isDirty branch 看到 isDirty=true 仍 return without loadFile。我加 isSelfWriting 只跳过 notifyDirtyConflict toast,**没让 loadFile 跑**。store 刷新靠 onCleanup IIFE 的 setStoredContent 完成,跟 watcher 解耦。

## 行数

| 项 | 行数 |
|---|---|
| debounce.ts(新)| +30 |
| debounce.test.ts(新)| +118 |
| context/file.tsx | +43 |
| pages/session/file-tabs.tsx | +117 / -16 |
| pages/layout.tsx | +16 |
| src-tauri/src/lib.rs | +9 / -2 |
| 三文档(1-spec + 2-plan + 3-changelog)| ~500 |
| **总(代码 + 单测 + doc)** | **~830 行** |

代码 + 单测 = 333 行,Medium 规模(50-500 之间)。

## 验证

| 项 | 结果 |
|---|---|
| `bun run typecheck` | 16/16 全过 |
| `bun test debounce.test.ts` | 9/9 全过 |
| `build-deskfox.ps1 -Env dev -NoBundle` | 多次 rebuild 成功 |
| **user runtime A1**:编辑改字 → 等 1s → 看磁盘有新内容 | ✅ |
| **user runtime A3**:编辑改字 → 切 tab → 切回 → 看新内容 | ✅ |
| **user runtime A5 / Bug 1**:auto-save 不弹"AI 修改了此文件"误 toast | ✅ |
| **user runtime "等 1s 切 tab 切回"完整 happy path** | ✅(user 2026-05-22 确认通过) |

## 决策点(spec 已写但实施时确认)

| ID | 决策 | 决议 |
|---|---|---|
| D1 | debounce 时长 | 1 秒(VSCode `files.autoSave: afterDelay` 默认对齐)|
| D2 | flush 同步阻塞 | fire-and-forget IIFE,实际 IO <50ms,race 由 markSelfWriting + setStoredContent 兜底 |
| D3 | mtime 冲突 silent 不弹 confirm | toast warning,留 draft 让 user 主动 Save 时再处理 |
| D4 | Auto-save 成功不 toast | 是,只在失败 toast |
| D5 | debounce timer cleanup | editing 退出 + onCleanup 都清 |
| D6 | 不做 dirty UI 提示 / "放弃所有改动"功能 | 是(secondary feature 等需求驱动)|

## 不做的(本笔 scope 外)

- **"放弃所有改动"功能**(还原文件到上次 save / git HEAD)— 单独 secondary feat,等 user 撞真实场景再做
- **Tab 标题 dirty 小圆点 / 星号 UI 提示** — 跟 auto-save 体验冲突,先不做
- **多个 dirty editor 全局收集**(同时编辑 N 个文件)— 当前 `<Show keyed>` 一次只有 1 个 FileTabContent 实例,N>1 场景不存在
- **关 app force kill 不可拦截**(任务管理器杀)— 接受现状

## R 合规

- **R2** FORK marker:debounce.ts 头注 + file.tsx 各改动点 + file-tabs.tsx 关键段 + lib.rs CloseRequested + layout.tsx listener
- **R3** 不涉及品牌
- **R4** 0 override(全 fork 白名单)
- **R5** Medium feat,9 单测覆盖 debounce helper logic 清单(R5 决策 2);集成路径 user runtime e2e 验收(A1-A8 happy path 全过)
- **R6** 不涉及网络监听

## 回退

```
git revert <本笔 commit>
```

回退后文件查看器编辑回到"必须主动按 Save"模式,切 tab / 关窗口未保存改动会丢(回 user 报告前的状态)。

## 关联

- **直接前置**:`large-file-preview-guard`(数据安全维度同套件:防 OOM 丢编辑 + canEdit tooLarge 守卫)
- **跟 file 守卫机制兼容**:mtime 冲突检测 + dirty 守卫(`查看器-自动刷新` feat)+ self-writing 窗口(本笔加)三层
- **debounce helper 可复用**:未来 chat input 防抖 / file tree 操作防抖等场景都能用
