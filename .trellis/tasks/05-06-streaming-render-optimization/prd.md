# 流式期间 Inactive Turn 渲染开销优化

## Problem Statement

`message-timeline.tsx` 第 301 行:

```typescript
const canWindow = createMemo(() => !isWorking() && !sessionSwitching())
```

流式生成期间（`isWorking()=true`），虚拟化**完全禁用**。这意味着:
1. 所有 turn（无论多少条消息）全部在 DOM 中
2. `morphdom` diff 需要遍历整个消息树的顶层子节点做 `isEqualNode` 比对
3. `MutationObserver` 以 `subtree:true + characterData:true` 观察整个 `contentRef`，DOM 内任何文本变化都触发 `scrollTop = scrollHeight`，强制 layout/reflow
4. 每个 `TimelineItem` 的 `ResizeObserver` 持续测量高度（即使内容稳定）

在 149 条消息 / 2855 个 part 的场景下，每 16ms（SSE flush cadence）就要走一遍上述完整管道，导致**流式期间严重卡顿甚至 UI 失去响应**。

已有任务 `05-01-streaming-flicker-and-perf` 解决了两个特定问题:
- **Bug 1**: `canWindow` 在 tool-call 边界翻转导致内容消失 → 通过 `canWindow` hysteresis（800ms）修复
- **Bug 2**: KaTeX 导致 `non-prefix morph` 风暴 → 通过 paragraph-level stable/tail split 修复

本任务解决的是**持续性性能问题**——即使上述两个 bug 修好了，流式期间仍有大量无意义的渲染开销。

## 为什么不能直接用虚拟化

用户顾虑（verbatim）:

> 对非活跃 turn 启用 display:none 或内容卸载，这感觉会对内容高度的估算产生巨大影响，导致滚动过程出现跳跃，或者点击用户消息跳转会跳到错误的地方。

**这个顾虑完全正确。** `display:none` 会从布局流中移除元素，`scrollHeight` 改变 → spacer 计算错乱 → 滚动跳跃。虚拟化窗口的 `start/end` 重算也会因为高度变化产生错误的偏移。

## 方案选择：A + B 组合（均保留完整布局高度）

两个方案都**不改变元素的盒子模型**，`scrollHeight` / `offsetHeight` 保持不变，不影响:
- 滚动贴底算法（`scrollTop = scrollHeight` 目标值不变）
- `turnHeights` Map 中的测量值（高度不变）
- 用户消息跳转定位（锚点元素位置不变）
- 虚拟化窗口 spacer 计算（`windowed.top / bottom` 不变）

---

## 方案 A：`content-visibility: auto` — CSS 原生渲染跳过

### 技术原理

CSS `content-visibility: auto` 是 CSS Containment Level 2 规范中的属性。当元素不在视口附近时，浏览器**完全跳过该元素子树的布局、绘制和合成**:

- **盒子模型保留**: `scrollHeight`、`offsetHeight`、`getBoundingClientRect()` 返回值不变
- **`contain-intrinsic-size`**: 提供一个估算值用于首次布局，后续浏览器自动学习实际尺寸
- **自动恢复**: 元素滚动到视口附近的 `contain-intrinsic-size` 范围内时，浏览器自动渲染子树
- **`ResizeObserver` 行为**: 元素被跳过时，其 `ResizeObserver` 不会触发（因为没有实际回流）

### 实现细节

**文件: `packages/app/src/pages/session/message-timeline.tsx`**

在 `TimelineItem` 组件中（约第 1696 行），为非活跃 turn 添加 CSS class:

```typescript
// TimelineItem return (约第 1696 行)
<div
  ref={(el) => { rootRef = el; ... }}
  data-message-id={item.messageID}
  classList={{
    "min-w-0 w-full max-w-full": true,
    // 新增: 流式期间非活跃 turn 跳过渲染
    "turn-content-skip": isWorking() && !eager(),
  }}
  style={itemStyle(props.centered)}
>
```

配合独立标记避免与 eager/active 冲突:
```typescript
const isActive = createMemo(() => activeMessageID() === item.messageID)
const isEager = createMemo(() => isActive() || item.index >= rendered().length - 3)
// content-visibility target: streaming AND NOT the active/recent turns
const skipRender = createMemo(() => isWorking() && !isEager())
```

**文件: `packages/ui/src/components/markdown.css`**（或对应的 Tailwind 配置）

```css
/* 流式期间非活跃 turn: 保留盒子模型，跳过子内容渲染 */
.turn-content-skip {
  content-visibility: auto;
  contain-intrinsic-size: auto 680px; /* 首次估算，后续自动学习实际高度 */
}
```

或在 `packages/ui/src/styles/index.css` 中定义全局工具类:

```css
.content-skip {
  content-visibility: auto;
  contain-intrinsic-size: auto 500px;
}
```

### 行为矩阵

| 场景 | 行为 |
|------|------|
| 流式期间，非活跃 turn（不在最后 3 条） | 元素盒子保留，子内容不渲染/不绘制 |
| 流式期间，活跃 turn / 最后 3 条 turn | 正常渲染 |
| 用户向上滚动到某个被跳过的 turn | 浏览器检测到元素进入视口 → 自动渲染 → 内容出现（无闪烁） |
| 流式结束 | `isWorking()=false` → class 移除 → 所有 turn 恢复完整渲染 |
| 会话切换跳转到某条消息 | 目标 turn 的 eager=true（因为 active=true）→ 一直渲染 |

### 性能收益预估

以 149 条消息的会话为例:
- 流式期间只有 ~3 条 turn（活跃 + 最近 2 条）正常渲染
- 其余 ~146 条 turn 的 layout/paint 被浏览器跳过
- `morphdom` 只对活跃 turn 做 diff（因为其他 turn 的内容不变且被跳过）
- 每帧的 layout 开销从 O(全部消息) 降为 O(活跃消息)
- 保守估计每帧节省 60-80% 的渲染耗时

### 浏览器兼容性

| 浏览器 | 支持版本 | 备注 |
|--------|---------|------|
| Chrome / Edge | 85+ | 完全支持 |
| Safari | 15.4+ | 完全支持 |
| Firefox | 不支持 | 降级为普通渲染（无性能损失，也无性能收益） |
| Tauri (WebKit) | 15.4+ | macOS Safari equivalent |

桌面应用使用 Tauri（WebKit），Safari 15.4+ 完全支持。TUI 不需要。

### 备选：仅对 Markdown 组件生效（更细粒度）

如果不希望对整个 `TimelineItem` 的 div 做 content-visibility（可能影响 tool parts 的 collapsible 动画），可以**仅对 Markdown 组件**施加:

在 `markdown.tsx` 的 `Markdown` 组件渲染中:

```typescript
// Markdown 组件 return
<div
  data-component="markdown"
  classList={{
    ...(local.classList ?? {}),
    [local.class ?? ""]: !!local.class,
    "content-skip": !local.eager && local.streaming, // 新增
  }}
  ref={setRoot}
  {...others}
/>
```

这样只跳过非活跃 turn 的 markdown 内容渲染，tool parts 的交互不受影响。

---

## 方案 B：MutationObserver 观察范围收窄

### 当前问题

`message-timeline.tsx` 第 708-722 行:

```typescript
const observer = new MutationObserver(schedule)  // schedule → rAF → scrollTop = scrollHeight
observer.observe(body, {
  childList: true,
  subtree: true,        // ← 观察整个 contentRef 子树
  characterData: true,  // ← 观察所有文本节点变化
})
```

- `body` = `contentRef`，包含**所有 turn 的整个 DOM 树**
- `subtree: true` 意味着任何 turn 的任何文本变化都触发回调
- 即使代码高亮完成、工具状态文字更新、ResizeObserver 触发的布局变化，都会导致 `scrollTop = scrollHeight` 的强制 reflow
- 在 149 消息 / 2855 part 的场景下，每分钟可能有数百到数千次回调

### 实现：仅观察活跃 Turn

```typescript
// message-timeline.tsx，替换现有的 MutationObserver createEffect

createEffect(() => {
  const body = contentRef
  if (!body) return
  if (!isWorking()) return
  if (!props.live && !props.scroll.bottom) return

  // 找到当前活跃消息对应的 DOM 元素
  const activeID = activeMessageID()
  if (!activeID) return

  const key = typeof CSS === "undefined" ? activeID : CSS.escape(activeID)
  const activeEl = body.querySelector(`[data-message-id="${key}"]`)
  // 如果找不到（尚未渲染），回退到观察整个 contentRef 的末尾子节点
  const target = activeEl ?? body.lastElementChild ?? body

  // ... flush / schedule 函数同现有实现 ...

  const observer = new MutationObserver(schedule)
  observer.observe(target, {
    childList: true,
    subtree: true,        // 现在只观察活跃 turn 的子树
    characterData: true,
  })

  onCleanup(() => {
    observer.disconnect()
    if (mutationFrame === undefined) return
    cancelAnimationFrame(mutationFrame)
    mutationFrame = undefined
    queued = false
  })
})
```

### 行为对比

| 变化来源 | 当前（subtree 全树） | 优化后（仅活跃 turn） |
|----------|---------------------|----------------------|
| 活跃 turn 的 markdown 文本增长 | 触发 | 触发（正确） |
| 历史 turn 的 Shiki 代码高亮完成 | 触发（不必要） | 不触发 |
| 历史 turn 的 KaTeX 数学渲染完成 | 触发（不必要） | 不触发 |
| 历史 turn 的 tool 状态更新 | 触发（不必要） | 不触发 |
| 历史 turn 的 ResizeObserver 触发的回流 | 触发（不必要） | 不触发 |

### 降级策略

如果 `activeEl` 和 `body.lastElementChild` 都找不到（极端边缘情况），回退到观察整个 `body`，行为与现状完全一致。

---

## 方案 A + B 组合效果

### 协同增益

A 和 B 是**互补增强**的:

- **A 减少渲染工作量** → 非活跃 turn 不参与 layout/paint → 每帧耗时大幅降低
- **B 减少不必要的回调** → 只有活跃 turn 的变化触发滚动锁定 → 减少强制 reflow 次数

两者叠加: 流式期间，只有 1-3 个活跃 turn 实际渲染 + 只有 1 个 turn 触发 MutationObserver → 其他 turn 完全静默。

### 不影响的功能

| 功能 | 影响 | 说明 |
|------|------|------|
| 滚动贴底 | 无 | `scrollHeight` 不变，`scrollTop = scrollHeight` 目标值不变 |
| 用户消息跳转 | 无 | 锚点元素位置不变，跳转到目标 message 后该 turn 变为 eager |
| 会话切换 | 无 | `isWorking()=false` 时方案 A/B 均不激活 |
| 加载更早消息 | 无 | 同上 |
| 虚拟化 spacer | 无 | `turnHeights` 中存储的测量值不变 |

---

## Implementation Plan

### Step 1: 方案 B — MutationObserver 范围收窄

**文件**: `packages/app/src/pages/session/message-timeline.tsx`
**改动量**: ~20 行（修改现有 createEffect）
**风险**: 极低（降级策略确保不劣于现状）

变更点:
1. 在 MutationObserver 的 createEffect 中，根据 `activeMessageID()` 定位目标 DOM 元素
2. 将 `observer.observe(body, ...)` 改为 `observer.observe(target, ...)`

验证:
- 流式期间，历史 turn 的内容变化不再触发 `[timeline] slow mutation scroll`
- 控制台不再出现每帧的 mutation scroll 日志
- 贴底行为与优化前一致

### Step 2: 方案 A — `content-visibility: auto`

**文件**: `packages/app/src/pages/session/message-timeline.tsx` + `packages/ui/src/styles/index.css`
**改动量**: ~15 行（新增 CSS rule + TimelineItem class 条件）
**风险**: 低（CSS 降级安全、Firefox 不生效也无副作用）

变更点:
1. 在 `packages/ui/src/styles/index.css` 添加 `.content-skip` 工具类
2. 在 `TimelineItem` 的 classList 中添加流式时非活跃 turn 的条件 class
3. 可选用: 仅对 Markdown 组件施加（更细粒度）

验证:
- 流式期间，Performance 面板中 Layout/Paint 耗时显著下降
- 滚动贴底正常，无跳跃
- 会话切换 / 消息跳转功能正常
- 流式结束后所有 turn 恢复完整渲染

### Step 3: 性能对比测试

使用与 `05-01-streaming-flicker-and-perf` 相同的 reproducer 会话（`ses_222c3a1f3ffeKdZxmCyui1E189`，149 messages / 2855 parts），在优化前后分别记录:

| 指标 | 优化前预期 | 优化后目标 |
|------|-----------|-----------|
| `[timeline] slow scroll lock` 频率 | 持续出现 | 偶尔出现 |
| `[timeline] slow mutation scroll` 频率 | 持续出现 | 几乎不出现 |
| 单帧 layout 耗时 | 30-100ms | < 16ms |
| 流式期间 UI 响应性 | 严重卡顿 | 流畅可滚动 |

---

## 与现有任务的关系

| 任务 | 解决的问题 | 本任务与之的关系 |
|------|-----------|-----------------|
| `05-01-streaming-flicker-and-perf` | canWindow 翻转导致内容消失 + non-prefix morph 风暴 | **互补**: 05-01 消除"闪烁/bug"；本任务消除"持续卡顿"。方案之间无冲突。 |
| `04-16-04-16-message-jump-blank-page` | 会话切换后虚拟化白屏 + 跳转失效 | **无关**: 触发条件不同（session switch vs streaming），修复路径独立。但虚拟化系统的脆弱性是共同根源。 |

### 建议执行顺序

```
1. 先执行 05-01 的 Step 1 (canWindow hysteresis) — 消除内容消失
2. 再执行本任务的 Step 1+2                        — 消除持续卡顿
3. 最后执行 05-01 的 Step 2 (stable/tail split)   — 消除 math morph 风暴
```

之所以这样排序: canWindow hysteresis 解决了最严重的视觉效果（内容消失），且改动最小；本任务解决了最影响使用体验的性能问题（卡顿）；stable/tail split 改动最大（~200 行重构），放到最后。

---

## Out of Scope

- `display:none` 或 DOM 卸载方案（用户明确否决，因为破坏高度）
- `virtua` 库替换自定义虚拟化（风险较大，另开专门任务更合适）
- session.tsx 组件拆分（架构级变更，不在本任务范围内）
- KaTeX Worker 迁移（复杂度过高，需要独立评估可行性）

## References

- Reproducer session: `ses_222c3a1f3ffeKdZxmCyui1E189` ("04-18-flavored-Schur-index续推至下一阶")
- Sibling task: `.trellis/tasks/05-01-streaming-flicker-and-perf/`
- Sibling task: `.trellis/tasks/04-16-04-16-message-jump-blank-page/`
- CSS Spec: [CSS Containment Level 2 — content-visibility](https://www.w3.org/TR/css-contain-2/#content-visibility)
- Key source files:
  - `packages/app/src/pages/session/message-timeline.tsx` — 虚拟化 + MutationObserver + 滚动锁定
  - `packages/ui/src/components/markdown.tsx` — morphdom + 模式切换
  - `packages/app/src/pages/session.tsx` — outer ResizeObserver + scroll state

## Status

Planning only. 待用户审阅后确认是否执行。