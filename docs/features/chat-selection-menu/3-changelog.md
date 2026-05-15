---
feat-id: chat-selection-menu
status: done
related: ./3-changelog.md
---

# 聊天对话区右键选区菜单

## 需求来源

User 2026-05-15 实测前一笔 `html-viewer-ux-polish` 后顺手反馈:聊天对话区(中间消息列表区,AI 回复 / user 发送的消息气泡)里选中文字右键时,WebView2 弹的是浏览器原生菜单(复制 / 复制链接 / 打印 / 更多工具),与文件查看器自家 mdMenu 体验不一致。希望换成 DeskFox 自家两项菜单,与文件查看器靠拢。

## 需求细节(user 拍板)

| Q | 选项 | 决策 |
|---|---|---|
| Q1 适用范围 | A 两种气泡都支持 / B 只 AI | **A** — scope 在 log 容器,不区分气泡来源 |
| Q2 添加到聊天行为 | A 直接塞引用 / B 弹输入面板跟文件查看器一致 | **B** — textarea + Ctrl/Cmd/Opt+Enter 提交,UX 一致 |
| Q3 无选区时 | A 始终显示两项灰显 / B 不弹菜单 / C 只一项 | **A** — `menu-always-show-with-disabled` 哲学一致 |
| Q4 选区高亮 | A 不加 overlay / B 加红色 overlay | **A→B follow-up** — 实测 textarea 焦点丢原生选区,user 反馈后改 B |

## 修法

### 1. 纯函数 helper(`chat-selection-quote.ts`)

```ts
composeQuotedMarkdown(selection, comment): string
  - 选区每行前缀 "> " + 空行 + user comment
  - 容错 CRLF / CR / 空选区 / 空 comment 4 种组合

insertTextIntoPrompt(prompt, text): ContentPart[]
  - 末尾 text 段非空 → 追加(空行分隔)
  - 末尾 text 段空 → 替换内容
  - 无 text 段 → 追加新 text part
```

R5 helper extract 模式 — 把无 SolidJS context 依赖的纯逻辑独立成文件,绕开 attachments.ts 同款"直接单测会撞 Client-only API server-side 错"问题。同时也便于回归保护。

### 2. 独立组件(`chat-selection-menu.tsx`)

- capture-phase `document.addEventListener("contextmenu")` 拦截
- scope filter:`target.closest('[data-slot="session-turn-list"]')` 确保只在聊天 log 内生效;文件树 / 文件查看器 / composer 输入框等其他区右键继续走原行为
- `preventDefault()` 阻 WebView2 原生菜单
- 自家 state(`menu` + `comment` + `highlightRects`),与 file-tabs 的 mdMenu 完全独立,不串台
- Portal 弹 menu(2 项 + Ctrl+C 提示)/ input(textarea + 提交/取消按钮 + 快捷键提示)双模式

### 3. 选区红色 overlay(Q4 follow-up)

input 模式 textarea 拿焦点后浏览器原生选区会自动清,user 无法看到自己选了什么。复用 file-tabs.tsx `setSelectionHighlight` 同套路:

- 右键时 `range.getClientRects()` 拿每行 rect → `highlightRects` 信号
- Portal `fixed` div 数组渲染,色 `rgba(209, 52, 56, 0.5)`(Microsoft Fluent 系统红 + 0.5 alpha,与文件查看器视觉一致)
- 滚动时 capture-phase listener 清掉(rect 是 viewport 坐标,滚动失效)
- 关菜单 / 提交 / 取消时一并清

### 4. 提交链路

```ts
const composed = composeQuotedMarkdown(menu.text, comment)  // "> 选中文字\n\n问题"
const next = insertTextIntoPrompt(prompt.current(), composed)
prompt.set(next, prompt.cursor())
```

User 在聊天输入框看到引用块 + 问题,可继续编辑或直接发送。Toast 提示"已加入聊天输入框(含问题)" / "已加入聊天输入框"。

## 文件改动

| 文件 | 改动 | 行数 |
|---|---|---|
| `packages/app/src/pages/session/chat-selection-quote.ts`(新)| pure helpers + FORK 注释 | +52 |
| `packages/app/src/pages/session/chat-selection-quote.test.ts`(新)| 12 单测覆盖 helper 边界 | +85 |
| `packages/app/src/pages/session/chat-selection-menu.tsx`(新)| 独立组件 contextmenu 拦截 + Portal 菜单 + overlay | +249 |
| `packages/app/src/pages/session/message-timeline.tsx` | import + `<Show>` 内挂载 | +4 / -0 |

总 +390,Medium 规模。

## R5 测试覆盖(12 单测)

`composeQuotedMarkdown` 6:
- empty selection + empty comment
- only comment
- only selection
- selection + comment
- CRLF / CR 归一化
- 首尾空白 trim

`insertTextIntoPrompt` 6:
- empty text returns copy
- append to last text part with content
- replace last text part when empty
- inserts at LAST text part position
- append new text part when no text part
- 不 mutate 输入

attachments.ts / file-tabs.tsx 同类 SolidJS context 链问题先例(`tests-codemirror-fixture-d3` / D 系列),helper extract 模式继续延续。

## 边界情况

| 场景 | 行为 |
|---|---|
| 聊天区无选区右键 | 菜单弹,两项灰显(Q3 一致) |
| 聊天区选中右键 → 直接复制 | navigator.clipboard.writeText,菜单关 |
| 文件树 / composer / 文件查看器右键 | 不被拦截,走原行为(scope filter) |
| 已选中右键打开 menu → ESC | 菜单关 + overlay 清 + 原生选区清 |
| 已打开 input 输入到一半 → 滚动 | overlay 清(rect 失效),菜单不关(textarea 焦点保留)|
| Ctrl/Cmd/Opt+Enter | 提交 |
| 取消按钮 | close,与 Esc 等价 |
| 拍空选区点"添加到聊天" | composed 空 → 直接 return,不污染 prompt |
| prompt 末尾 text 段已有内容 | 追加空行 + 引用块,不覆盖 user 已输入 |

## 验证

| 项 | 结果 |
|---|---|
| `bun test chat-selection-quote.test.ts` | ✅ 12/12 全过 |
| `bun run typecheck` | ✅ 16/16 全过 |
| `build-deskfox.ps1 -Env dev -NoBundle` | ✅ 1m32s |
| user runtime — 基本菜单两项 + 灰显 + 复制 + 添加到聊天 + 提交链路 | ✅ |
| user runtime — Q4 follow-up 红色 overlay 即使 textarea 焦点也保留 | ✅ |

## R 合规

- **R2** FORK marker 三处(quote.ts 头注 / menu.tsx 头注 / message-timeline.tsx import + 挂载 FORK 注释)
- **R3** 不涉及品牌/主题/icon
- **R4** 0 override(全 fork-only 新文件 + 1 个 fork-only 文件追加 4 行,packages/app/src/pages/session/ 在白名单)
- **R5** R5 决策 2 helper extract 模式 + 12 单测;Medium 规模新 feat,纪律达标
- **R6** 不涉及网络监听

## 回退

```
git revert b71a4ad2e
```

回退后三个新文件删除,message-timeline.tsx 回到不挂 ChatSelectionMenu 状态,user 重新撞此问题(聊天区右键弹 WebView2 原生菜单)。

## 关联

- **延续**:`html-viewer-allow-scripts` + `html-viewer-ux-polish` 的"DeskFox 自家右键菜单与 WebView2 原生菜单替换"主题
- **复用**:`menu-always-show-with-disabled` 的"始终显示 + 灰显"哲学(Q3)
- **复用**:`viewer-ctrlc-fix` / `右键选区-修复` 的红色 overlay 同套路(Q4 follow-up)
- **复用**:R5 决策 2 helper extract 模式(`tests-codemirror-fixture-d3` / `file-tree-multi-drag-to-chat` 同场景)
