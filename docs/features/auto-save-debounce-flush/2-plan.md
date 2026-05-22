---
feat-id: auto-save-debounce-flush
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# auto-save-debounce-flush — 2-plan

## 现状调研发现

### 现行 file-tabs.tsx editing 关键代码(line 405-520)

```ts
// 状态
const [editing, setEditing] = createSignal(false)
const [draft, setDraft] = createSignal<string | null>(null)
const [loadedMtime, setLoadedMtime] = createSignal<number | null>(null)
const dirty = createMemo(() => {
  const d = draft()
  return d !== null && d !== contents()
})

// 现行核心 save
const saveEdit = async () => {
  // ... performWrite + reloadAndExitEdit + 成功 toast "Saved" ...
  // 错误处理:mtime_conflict / readonly / generic
}

// ⚠️ 关键:tab/path 切换时 silent 丢 editing
createEffect(on(path, () => {
  if (editing()) {
    setEditing(false)
    setDraft(null)    // ← 这里直接丢 draft,本笔要 fix
  }
}))
```

**核心发现**:tab/path 切换时**已经有 reactive effect**(line 507-516),但它**直接丢 draft**没有 flush。本笔在这个 effect 里加 flush 钩子。

### 现行 lib.rs window close 行为(line 521-533)

```rust
RunEvent::WindowEvent { label, event: window_event, .. }
    if label == MainWindow::LABEL =>
{
    if let tauri::WindowEvent::CloseRequested { api, .. } = window_event {
        if !system_tray::is_quitting() {
            api.prevent_close();
            // → hide 窗口(主进程仍跑,飞书 adapter 长驻)
        }
        // is_quitting=true 时直接关闭(真退出)
    }
}
```

**关键发现**:
- 点 ❌ = hide 窗口,**主进程仍跑**(因飞书 adapter)
- 真退出靠 tray "退出",`is_quitting()` 置 true → 不 prevent_close → 进程结束
- 真正会丢 dirty 数据的时机 = **真退出** + **未 hide 前的窗口 close**(都要 flush)

## 实施 3 阶段

### Phase 1 — debounce helper + auto-save 接入(0.5-1 天)

#### 1.1 新建 `packages/app/src/utils/debounce.ts`(pure helper,可单测)

```ts
// FORK: debounce + flush helper for auto-save [feat: auto-save-debounce-flush] 2026-05-21
export type DebouncedFn = {
  /** 调用一次 — 重置计时器,delay 毫秒后执行 fn */
  trigger: () => void
  /** 立即执行待执行的 fn(同步),清掉计时器 */
  flush: () => void
  /** 清掉计时器,不执行 */
  cancel: () => void
  /** 当前有挂起的 fn 调用?*/
  pending: () => boolean
}

export function createDebounced(fn: () => void | Promise<void>, delayMs: number): DebouncedFn {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    trigger: () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void fn()
      }, delayMs)
    },
    flush: () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
        void fn()
      }
    },
    cancel: () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    },
    pending: () => timer !== null,
  }
}
```

#### 1.2 单测 `debounce.test.ts`(R5 logic 清单,≥ 3 个边界)

- ✓ trigger 后 delayMs 内不调 fn / delayMs 后调 fn
- ✓ trigger 多次重置计时器,最后一次后 delayMs 触发
- ✓ flush 立即执行未挂起 fn,清计时器
- ✓ cancel 不执行,清计时器
- ✓ pending() 状态正确反映
- ✓ delayMs=0 edge case

#### 1.3 file-tabs.tsx 接入 auto-save

```ts
// FORK: debounce auto-save [feat: auto-save-debounce-flush] 2026-05-21
const AUTO_SAVE_DELAY_MS = 1000

// silent save(auto-save 路径,跟主动 Save 区分:不 toast)
const silentSave = async () => {
  if (!editing() || !dirty()) return
  await saveEditCore({ silent: true })   // saveEdit 重构后接受 silent flag
}

const autoSave = createDebounced(silentSave, AUTO_SAVE_DELAY_MS)

// draft 改动触发 debounce
createEffect(() => {
  draft()   // dependency
  if (editing() && dirty()) {
    autoSave.trigger()
  }
})

// editing 退出时取消挂起的 autoSave
createEffect(on(editing, (now) => {
  if (!now) autoSave.cancel()
}))

// unmount cleanup
onCleanup(() => autoSave.cancel())
```

#### 1.4 saveEdit 重构成 saveEditCore({ silent })

将现有 `saveEdit` 拆分为:
- `saveEditCore({ silent = false })` — 核心保存逻辑,silent=true 时不显示 "Saved" toast,但**错误仍 toast**(D4)
- `saveEdit()` — 调 `saveEditCore({ silent: false })`,保留按钮主路径行为

### Phase 2 — tab switch flush(0.5 天)

#### 2.1 改 createEffect(on(path, ...)) 加 flush 钩子

```ts
// 老:tab 切换时 silent 丢 draft
createEffect(on(path, async () => {
  if (editing()) {
    // FORK: tab 切换前 flush dirty draft [feat: auto-save-debounce-flush] 2026-05-21
    if (dirty()) {
      autoSave.cancel()      // 取消挂起的 debounce
      await silentSave()     // 同步 flush(等 save 完)
    }
    setEditing(false)
    setDraft(null)
  }
}))
```

**SolidJS createEffect 不直接支持 async** — 但 `() => { void async()() }` 模式可用,只是 effect 内部的 await 不会 block 后续 effect 调度。

**风险**:async createEffect 执行期间 path 又变了 → race。**缓解**:saveEdit 内部 mtime 检测会拦截过期写,跟现有保护一致。

#### 2.2 Edge case 处理

- path 变化但还没保存 → 上面 effect 处理
- path 变化期间 user 又改 draft → editing 已 false,draft 已 null,新 path 重新 startEdit
- 同 path 切到自己(不可能但要兜底)→ silentSave 内部 dirty 判断兜底,不重复

### Phase 3 — window close flush(0.5-1 天)

#### 3.1 全局 flush 信号机制设计

- file-tabs.tsx 暴露 `flushPendingSave()` 函数给外部调用
- 多 tab 场景:当前 file-tabs.tsx 只有 active tab 有 editing(Match when editing only on active);多 file-tabs 实例的 dirty 状态需要全局收集
- **简化决策**:本笔只处理 active tab editing,全局收集不在 scope(spec 已说"多 dirty tab 共存场景不存在")

#### 3.2 Tauri lib.rs CloseRequested handler 扩展

```rust
// FORK: dirty flush 兜底 [feat: auto-save-debounce-flush] 2026-05-21
if let tauri::WindowEvent::CloseRequested { api, .. } = window_event {
    // 发事件给前端 → 前端 flush dirty editors → 前端 ack 后才允许真关
    // 用 async 等 ack 不现实(Tauri RunEvent loop 不能 await)
    // 替代:emit "request_flush_before_close" → 前端 listener flush → 前端调
    //       `confirm_close` Tauri command 设 flag → 下次 close 事件不拦
    if !flush_acknowledged() {
        api.prevent_close();
        app.emit("flush-before-close", ()).ok();
        return;   // 等前端 ack 后再次触发 close 流程
    }
    if !system_tray::is_quitting() {
        api.prevent_close();
        // hide 窗口逻辑
    }
}
```

**实施细节**:
- 新 Tauri 命令 `confirm_close_after_flush()`:前端 flush 完调,设 `flush_acknowledged` flag,然后 webview emit "close" 事件再触发关闭
- 或更简:用 `tokio::sync::Notify` / channel + spawn task
- **本笔最简实现**:前端 listener 异步 flush → 调 `confirm_close_after_flush()` → Rust 重新发起 `app.exit(0)`(对真退出)/ `w.hide()`(对 hide)

#### 3.3 前端 listener

```ts
// 在 main app entry 处(layout.tsx 或类似)
import { listen } from "@tauri-apps/api/event"
import { invoke } from "@tauri-apps/api/core"

onMount(() => {
  listen("flush-before-close", async () => {
    // 触发当前 active tab 的 silentSave (如果有 dirty)
    // 通过全局 store 或 event bus(本笔用 custom DOM event 简化)
    window.dispatchEvent(new CustomEvent("deskfox-flush-now"))
    // 等 flush 完成(给 200ms 窗口,save 一般 <50ms)
    await new Promise((r) => setTimeout(r, 200))
    await invoke("confirm_close_after_flush")
  })
})

// file-tabs.tsx 内监听 custom event
onMount(() => {
  const handler = () => autoSave.flush()
  window.addEventListener("deskfox-flush-now", handler)
  onCleanup(() => window.removeEventListener("deskfox-flush-now", handler))
})
```

## 决策轨迹

### 关 app 时同步 vs 异步 flush

候选:
- A. 同步阻塞 close(Rust loop spin wait 等前端 ack)— 复杂,Tauri 不友好
- B. **prevent_close + 前端 flush + ack 后再关**(本笔采用)— 跟 Tauri event-driven 模型对齐
- C. 不拦截,close 时直接发 flush event 不等(可能丢)— 不可接受

### 全局 dirty store vs custom event

候选:
- A. 全局 SolidJS store(`createStore<{dirtyTabs: ...}>`)— 多 dirty tab 共存需求场景下需要,但本笔只有 active tab editing,过度设计
- B. **window CustomEvent 简化**(本笔采用)— file-tabs.tsx 自己监听 flush event,无需全局 store

### saveEdit 重构粒度

候选:
- A. 引入 silent 参数全方位重构(包括 toast / 错误处理 / mtime 冲突 confirm)
- B. **只 silence 成功 toast,其他保留**(本笔采用)— 错误情况 user 必须知道,mtime 冲突 confirm 是数据安全保护必须有

## R 合规执行

- **R2** FORK marker:debounce.ts 头注 + file-tabs.tsx 各改动点 + lib.rs CloseRequested 块
- **R3** 不涉及
- **R4** 0 override(`packages/app/src/utils/debounce.ts` 新文件,`file-tabs.tsx` / `lib.rs` 都在 fork 白名单)
- **R5** Medium feat,需 ≥ 1 e2e 或 3 unit。debounce helper 6 单测覆盖;集成路径 user runtime 验收(A1-A8)
- **R6** 不涉及

## 不确定 / 风险点(实施时可能微调)

1. **prevent_close + ack 机制**:Tauri RunEvent 模式没用过这种 round-trip,实施时可能要调整方案(可能改用 channel / once Notify)
2. **listen("flush-before-close")** 的接入位置:`layout.tsx` 还是 `session.tsx` 还是新建 hooks file — 看后续走读
3. **Save 失败时**:flush handler 也调了 invoke confirm_close_after_flush,close 仍会发生,user 改动丢。**缓解**:save 失败 toast 留在屏幕上(close 时若 prevent 不了至少有日志);**接受**:数据落盘失败本来就是 unrecoverable,告知 user 即可

## 后续(本笔不做,record 一下)

- "放弃所有改动"功能(还原文件到上次外部状态)— 单独 secondary feat
- Tab 标题 dirty 小圆点 UI 提示 — 跟 auto-save 体验冲突,暂不
- 多 dirty editor 全局收集 — 当前架构不需要,等未来场景驱动
