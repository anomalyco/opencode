# 思考内容渲染优化 — 实施计划

## 问题定义

当前 `ReasoningPartDisplay` 组件（`message-part.tsx:1649-1692`）在**流式思考期间**和**完成后**都有严重性能问题：

### 流式期间（streaming=true）

1. **全量 Markdown 渲染**：即使 `streaming=true`，思考内容仍走 `Markdown` 组件的 `mode="fast"` 管道。思考文本可能数千字，每 100ms 触发一次 `marked.parseFast` + morphdom
2. **DOM 完整挂载**：思考内容全部渲染到 DOM，即使内容在视口之外
3. **Collapsible 默认展开**：`open` 初始值为 `true`，所有思考内容立即可见

### 思考完成后（streaming=false）

1. **默认展开**：`open` 初始值为 `true`，长思考内容全部渲染
2. **立即全量渲染**：KaTeX 数学公式在 `IntersectionObserver` 触发后批量升级，导致主线程阻塞（PRD 中的 Tier 2.5 问题）
3. **即使折叠后**：Kobalte `Collapsible.Content` 的 DOM 仍然存在于页面中（aria-hidden + height:0），Markdown 渲染管道不会因折叠而跳过

### 用户确认的设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| 流式期间默认状态 | **折叠（3行预览）** | 性能最优，消除流式期间 marked.parse 开销 |
| 完成后行为 | **自动折叠** | 即使之前展开，完成后也重置为折叠，显示"已思考"标签 |
| 再折叠时是否卸载 | **卸载 Markdown 内容** | 完全卸载组件，释放 DOM/IO，节省资源 |

---

## 方案设计

### 核心原则（来自 Metis 分析）

> **最关键的陷阱**：CSS 裁剪 ≠ 不渲染。`max-height: 3lh; overflow: hidden` 看起来只显示3行，但 Markdown 组件仍然挂载，仍然解析文本，仍然创建 IntersectionObserver。核心优化必须是**条件挂载**，而非视觉裁剪。

### 改动 1：ReasoningPartDisplay 组件重写

**文件**：`packages/ui/src/components/message-part.tsx`（第 1649-1692 行）

**当前实现**：

```tsx
PART_MAPPING["reasoning"] = function ReasoningPartDisplay(props) {
  const i18n = useI18n()
  const part = props.part as ReasoningPart
  const text = () => part.text.trim()
  const [open, setOpen] = createSignal(true)  // ← 默认展开
  const streaming = createMemo(() => {
    if (props.message.role !== "assistant") return false
    return typeof (props.message as AssistantMessage).time.completed !== "number"
  })
  const title = createMemo(() =>
    streaming() ? i18n.t("ui.messagePart.reasoning.thinking") : i18n.t("ui.messagePart.reasoning.thought"),
  )
  return (
    <Show when={text()}>
      <Collapsible open={open()} onOpenChange={setOpen} variant="ghost" class="reasoning-collapsible">
        <Collapsible.Trigger>
          <div data-component="reasoning-trigger" data-streaming={streaming()}>
            <div data-slot="reasoning-trigger-title">
              <span>{title()}</span>
              <Show when={streaming()} fallback={<Icon name="circle-check" size="small" />}>
                <Spinner />
              </Show>
            </div>
            <Collapsible.Arrow />
          </div>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <div data-component="reasoning-part">
            <Markdown text={text()} cacheKey={part.id} streaming={streaming()} ... />
          </div>
        </Collapsible.Content>
      </Collapsible>
    </Show>
  )
}
```

**新实现**：

```tsx
PART_MAPPING["reasoning"] = function ReasoningPartDisplay(props) {
  const i18n = useI18n()
  const part = props.part as ReasoningPart
  const text = () => part.text.trim()
  // 默认折叠：流式期间显示3行预览，完成后显示"已思考"
  const [open, setOpen] = createSignal(false)
  const streaming = createMemo(() => {
    if (props.message.role !== "assistant") return false
    return typeof (props.message as AssistantMessage).time.completed !== "number"
  })
  const title = createMemo(() =>
    streaming() ? i18n.t("ui.messagePart.reasoning.thinking") : i18n.t("ui.messagePart.reasoning.thought"),
  )

  // 流式期间的预览文本：取最后3行（最新思考内容）
  // 注意：用 createMemo 缓存，仅在 text() 变化时重算
  const previewText = createMemo(() => {
    const content = text()
    if (!content) return ""
    const lines = content.split('\n')
    return lines.slice(-3).join('\n')
  })

  return (
    <Show when={text()}>
      <Collapsible open={open()} onOpenChange={setOpen} variant="ghost" class="reasoning-collapsible">
        <Collapsible.Trigger>
          <div data-component="reasoning-trigger" data-streaming={streaming()}>
            <div data-slot="reasoning-trigger-title">
              <span>{title()}</span>
              <Show when={streaming()} fallback={<Icon name="circle-check" size="small" />}>
                <Spinner />
              </Show>
            </div>
            <Collapsible.Arrow />
          </div>
        </Collapsible.Trigger>
        <Collapsible.Content>
          <Show
            when={open()}
            fallback={
              // 折叠状态：仅在流式期间显示3行预览，完成后折叠只显示标题
              <Show when={streaming()}>
                <div data-component="reasoning-part" data-mode="preview">
                  <Markdown
                    text={previewText()}
                    cacheKey={`${part.id}:preview`}
                    plain={true}
                  />
                </div>
              </Show>
            }
          >
            {/* 展开状态：完整 Markdown 渲染 */}
            <div data-component="reasoning-part" data-mode="full">
              <Markdown
                text={text()}
                cacheKey={part.id}
                streaming={streaming()}
                eager={props.markdownEager}
                viewport={props.markdownViewport}
                highlight={props.markdownHighlight}
                math={streaming() ? "defer" : props.markdownMath}
              />
            </div>
          </Show>
        </Collapsible.Content>
      </Collapsible>
    </Show>
  )
}
```

### 改动设计要点

1. **`open` 初始值改为 `false`**：思考内容默认折叠

2. **`<Show when={open()}>` 控制挂载**：这是最关键的设计。**不是** CSS 裁剪，**不是** Kobalte 的 height:0 折叠，而是完全的条件渲染：
   - 折叠时：完整 `<Markdown>` 组件完全挂载/卸载
   - 展开时：首次挂载 `<Markdown>` 并走 IntersectionObserver 懒加载

3. **预览用 `plain=true`**：`Markdown` 的 `plain` 模式走 `fallback()` 路径（HTML escape + `<br>` 替换），**零 `marked.parse` 开销**。参考 `markdown.tsx:651-654`：
   ```tsx
   const mode = createMemo(() => {
     if (local.plain) return "plain"  // ← 直接走 fallback()
     ...
   })
   ```
   `fallback()` 函数（`markdown.tsx:69-71`）只做 `text.replace(/&/g,...).replace(/</g,...).replace(/\n/g, "<br>")`，没有异步解析。

4. **`previewText` 缓存**：用 `createMemo` 缓存，仅在 `text()` 信号变化时重算。SolidJS 的细粒度响应式确保不会每帧重算。

5. **完成后自动折叠**：由于 `open` 初始值是 `false`，完成时无需额外逻辑——用户如果展开过，`streaming` 从 `true` 变为 `false` 不会改变 `open` 状态。但根据用户需求"完成后自动折叠"，需要添加一个 effect：

```tsx
// 思考完成时自动折叠
createEffect(() => {
  // streaming() 从 true 变为 false 时，重置为折叠
  if (!streaming()) {
    setOpen(false)
  }
})
```

**注意**：这个 effect 会在 streaming 变为 false 时执行，但如果用户在完成后主动展开了，下一次 streaming 变化（新消息）也会触发折叠。这是正确行为——每条新的思考开始时都应该折叠。

**但有一个微妙的 bug 风险**：如果 `streaming()` 已经是 `false`（组件首次挂载时就是完成状态的无历史消息），这个 effect 会立即执行 `setOpen(false)`。由于 `open` 初始值已经是 `false`，这不会造成问题。但为了安全，应该用 `on` 而非裸 effect：

```tsx
// 思考完成时自动折叠——仅跟踪 streaming 从 true 变为 false 的时刻
createEffect(
  on(streaming, (now, prev) => {
    if (prev === true && now === false) {
      setOpen(false)
    }
  }),
)
```

6. **展开后流式期间用 `math="defer"`**：即使展开，也不做 KaTeX 渲染，等滚动到视口再升级
7. **完成后展开用完整 `math` prop**：展开时做完整数学渲染

### 改动 2：预览窗口 CSS

**文件**：`packages/ui/src/components/message-part.css`

```css
/* 思考内容预览：限制3行显示，渐变遮罩 */
[data-component="reasoning-part"][data-mode="preview"] {
  max-height: calc(var(--line-height-large, 1.6) * 3 * var(--font-size-base, 14px) + 4px);
  overflow: hidden;
  position: relative;

  &::after {
    content: "";
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 1.5em;
    background: linear-gradient(
      to bottom,
      transparent,
      var(--background-stronger)
    );
    pointer-events: none;
  }

  [data-component="markdown"] {
    font-style: normal;
    font-size: var(--font-size-base);
    color: var(--text-weak);
  }
}
```

**CSS 裁剪的设计意图**：这是对 `previewText()` 的**二重保障**。`previewText()` 只取最后3行文本，CSS `max-height` + 渐变遮罩处理的是换行后的超长行。这样即使单行非常长，视觉上也只用3行显示。

### 改动 3：无需修改 `session-turn.tsx`

当前 `session-turn.tsx:426-434` 的 `showThinking()` 逻辑只在**没有可见 part** 时显示"思考中"标签。当 `showReasoningSummaries=true` 时，`ReasoningPartDisplay` 自己显示触发器标签，`showThinking` 返回 `false`。

修改 `ReasoningPartDisplay` 为默认折叠后，这个逻辑依然正确——`reasoning` part 仍然是 `visible` 的（`renderable` 函数 `message-part.tsx:565` 检查 `part.text?.trim()`），只是组件内部折叠了内容。

---

## 性能收益预估

| 场景 | 优化前 | 优化后 |
|------|--------|--------|
| 流式思考（折叠状态） | `marked.parseFast` + morphdom 每 100ms | `fallback()`（纯文本 HTML 转义），~0 开销 |
| 流式思考（展开状态） | `marked.parseFast` + morphdom | `marked.parseFast`，但 `math="defer"` 不触发 KaTeX |
| 思考完成后（折叠） | Markdown 组件挂载 + KaTeX IO + defer→full 升级 | **Markdown 组件完全卸载，0 开销** |
| 思考完成后（首次展开） | 已渲染（morphdom 增量更新） | 首次挂载 Markdown 组件，走 IntersectionObserver |
| 用户再折叠后 | DOM 保留在页面（height:0） | **Markdown 组件再次卸载，0 开销** |
| N 个历史思考折叠 | N 个 Markdown 组件挂载 + N 个 IO | **0 个 Markdown 组件，0 开销** |

**关键收益**：
1. 流式期间：消除思考内容 `marked.parse` + morphdom 开销（如果保持折叠）
2. 批量升级问题（Tier 2.5）：**自然消除**，折叠 = 卸载，不渲染就不升级
3. 主线程占用：从 O(N) 个思考降为 O(展开数量) 个

---

## 边缘情况处理

| 场景 | 行为 |
|------|------|
| 非常短的思考（≤3行） | 预览就等于完整内容，但仍然默认折叠显示"已思考" |
| 思考为空字符串 | `text()` 非空才渲染（`Show when={text()}`），空思考不显示 |
| 用户在流式期间展开思考 | 立即挂载完整 Markdown 组件，`streaming=true` → `mode="fast"`，`math="defer"` |
| 用户在流式期间展开后重新折叠 | Markdown 组件通过 `<Show>` 卸载，释放所有 IntersectionObserver 和 DOM |
| 思考完成后展开 | Markdown 首次挂载，`streaming=false` → 走 IntersectionObserver，进入视口才 `mode="full"` |
| 用户展开后再折叠 | Markdown 组件卸载，再次展开时重新挂载和渲染（on-demand） |
| 多个 reasoning part | 每个 `ReasoningPartDisplay` 独立管理自己的 `open` 状态 |
| `showReasoningSummaries=false` | 不渲染 reasoning part，由 `session-turn.tsx` 的独立"思考中"行显示 |
| 浏览器查找/复制 | 折叠内容不在 DOM 中，无法通过 Ctrl+F 查找。展开后可查找。这是有意的性能权衡 |
| 无障碍（ARIA） | `Collapsible` 保留完整的 `aria-expanded` 语义，键盘可操作 |

---

## previewText 性能考虑

Metis 指出 `split('\n').slice(-3).join('\n')` 在思考文本非常长时是 O(n)。分析：

- 思考文本典型长度：100-5000 字符
- `String.split` 在 V8/SpiderMonkey 中高度优化，10000 字符的 split 约 0.1ms
- `createMemo` 确保只在 `text()` 信号变化时重算（每 100ms 最多一次，受 `TEXT_RENDER_THROTTLE_MS` 节流）
- 如果未来需要优化，可以改用字符计数切片：`text.slice(-500)` 然后 `lines.slice(-3)`，双重限制

当前方案不需要额外优化。

---

## 与现有优化的互补性

| 优化层级 | 本方案的关系 |
|---------|------------|
| Tier 1（content-visibility + MO 收窄） | 互补：Tier 1 减少非活跃 turn 的渲染，本方案减少思考内容本身的渲染 |
| Tier 2（KaTeX 滚动补偿） | 互补：折叠状态下不渲染故无需补偿；展开时首次渲染仍可能需要补偿 |
| Tier 2.5（批量升级节流） | **直接消除**：折叠 = 卸载，不存在批量升级问题 |

---

## 修改文件清单

| # | 文件 | 改动 | 行数 |
|---|------|------|------|
| 1 | `packages/ui/src/components/message-part.tsx` | `ReasoningPartDisplay` 重写 + 添加 streaming→collapsed auto-reset effect | ~45 |
| 2 | `packages/ui/src/components/message-part.css` | 新增 `[data-mode="preview"]` CSS 规则 | ~20 |

**总改动量**：约 65 行，低风险。

---

## 实施顺序

1. 修改 `ReasoningPartDisplay` 组件逻辑（message-part.tsx）
2. 添加预览窗口 CSS（message-part.css）
3. 执行 QA 验证（见下方）

---

## QA 验证场景

### 工具

- `bun run dev:desktop` 启动开发服务器
- Chrome DevTools Elements 面板：检查 DOM 结构和 data 属性
- Chrome DevTools Performance 面板：录制流式性能
- 选用含 reasoning 内容的会话（如 reproducer `ses_222c3a1f3ffeKdZxmCyui1E189` 或任何带深度思考的会话）

### 场景 QA-1：流式思考 — 折叠状态显示三行预览

**前置条件**：打开一个新会话，发送一条需要深度思考的问题

**步骤**：
1. 发送消息触发模型思考
2. 等待模型开始输出 thinking content
3. 在 DevTools Elements 中找到 `[data-component="reasoning-part"]`
4. 观察 `data-mode` 属性和子元素

**预期结果**：
- `[data-component="reasoning-trigger"]` 显示"正在思考..."文本 + Spinner
- `[data-component="reasoning-part"]` 有 `data-mode="preview"` 属性
- 预览内容只有最后3行文本，用纯 HTML 渲染（`<br>` 替代换行）
- **不存在** `[data-component="reasoning-part"][data-mode="full"]` 元素（完整内容未挂载）
- 预览区域有渐变遮罩（CSS `::after` 伪元素）
- DevTools Performance 中无 `marked.parse` 或 `marked.parseFast` 调用用于 reasoning part

### 场景 QA-2：流式思考 — 展开后显示完整内容

**步骤**：
1. 在流式思考期间，点击 Collapsible 触发器展开
2. 在 DevTools Elements 中检查 reasoning part 结构

**预期结果**：
- `[data-component="reasoning-part"]` 有 `data-mode="full"` 属性
- `[data-mode="preview"]` 元素已从 DOM 消失
- Markdown 组件挂载，用 `mode="fast"` 渲染（因为 `streaming=true`）
- `math` prop 为 `"defer"`，KaTeX 数学公式不立即渲染

### 场景 QA-3：流式思考 — 展开后重新折叠

**步骤**：
1. 在 QA-2 的基础上，再次点击触发器折叠
2. 在 DevTools Elements 中检查 DOM

**预期结果**：
- `[data-component="reasoning-part"][data-mode="full"]` 从 DOM 消失
- `[data-component="reasoning-part"][data-mode="preview"]` 重新出现
- Markdown 组件完全卸载（无 IntersectionObserver 残留）

### 场景 QA-4：思考完成 — 自动折叠

**步骤**：
1. 等待思考完成（模型停止输出）
2. 观察 reasoning part 的状态

**预期结果**：
- `[data-component="reasoning-trigger"]` 显示"已思考" + ✓ 图标
- `[data-component="reasoning-trigger"]` 有 `data-streaming="false"` 属性
- `Collapsible.Content` 内部**没有** `[data-component="reasoning-part"]`（完整内容已卸载）
- 也**没有** `[data-mode="preview"]`（完成后不显示预览）

### 场景 QA-5：思考完成 — 展开查看完整内容

**步骤**：
1. 在 QA-4 的基础上，点击触发器展开
2. 在 DevTools Elements 中检查结构

**预期结果**：
- `[data-component="reasoning-part"][data-mode="full"]` 出现
- Markdown 组件挂载，`streaming=false`
- `math` prop 从 IntersectionObserver 延迟加载（先 `mode="lit"` 或 `mode="fast"`，滚动到视口后升级为 `mode="full"` + KaTeX）
- 完整内容包含 markdown 格式和数学公式渲染

### 场景 QA-6：思考完成 — 再折叠后卸载

**步骤**：
1. 在 QA-5 的基础上，再次点击触发器折叠
2. 在 DevTools Elements 中检查

**预期结果**：
- `[data-component="reasoning-part"][data-mode="full"]` 从 DOM 消失
- Collapsible 触发器仍然显示"已思考" + ✓
- 再次展开时，Markdown 重新挂载和渲染

### 场景 QA-7：多 reasoning part 独立性

**步骤**：
1. 打开包含多个 assistant message 的会话，每个都有 reasoning part
2. 展开第一个 thinking
3. 折叠第一个 thinking
4. 展开第二个 thinking

**预期结果**：
- 每个 ReasoningPartDisplay 有独立的 `open` 信号
- 展开/折叠一个不影响其他
- 折叠的 thinking 内容完全卸载（0 Markdown 组件在 DOM 中）

### 场景 QA-8：回归 — 无 reasoning 的普通消息

**步骤**：
1. 发送一条不需要思考的简单问题
2. 观察回复

**预期结果**：
- 无 `[data-component="reasoning-part"]` 出现
- 普通 text part 和 tool part 渲染正常
- 不受本次改动影响

### 场景 QA-9：性能 — 长会话流式验证

**前置条件**：使用 reproducer 会话 `ses_222c3a1f3ffeKdZxmCyui1E189`（149 messages / 2855 parts）

**步骤**：
1. 打开该会话
2. 发送一条新消息触发思考
3. 用 DevTools Performance 面板录制 10 秒
4. 检查 Layout/Paint 占比

**预期结果**：
- 思考期间页帧率稳定（>30fps，目标 60fps）
- 折叠的 reasoning part 不触发 `marked.parse` 调用
- 展开 reasoning part 后 KaTeX 延迟加载（只在视口内渲染）
- `content-visibility: auto` 仍然生效（Tier 1 不受影响）

### 场景 QA-10：LSP 类型检查

**步骤**：
```bash
cd packages/opencode && bun typecheck
```

**预期结果**：0 类型错误