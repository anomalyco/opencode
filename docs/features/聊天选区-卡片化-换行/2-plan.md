---
feat-id: 聊天选区-卡片化-换行
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 聊天选区-卡片化-换行 — 2-plan(实施步骤 + 决策)

## Step 顺序

实施前 user 拍板"**2 先 1 后**"(纯 CSS 先 ship 价值立刻兑现,数据/UI 大改稳扎稳打):

### Step 1:改动 2 wrap(CSS 一笔)

**文件**:`packages/app/src/components/prompt-input/context-items.tsx`

**改法**:
```diff
-      <div class="flex flex-nowrap items-start gap-2 p-2 overflow-x-auto no-scrollbar">
+      <div class="flex flex-wrap items-start gap-2 p-2 max-h-[180px] overflow-y-auto">
```

`max-h-[180px]` = 3×48(h-12)+ 2×8(gap)+ 2×8(padding)+ 余量 → 3 行卡片可见。

**验**:typecheck + 52 单测 + user 桌面验 ✓

**user 反馈调整**:首版 `max-h-[140px]` 只能装 2 行 → 改 180px 装 3 行(已 ship `3b74e93a2`)。

### Step 2:改动 1 chat 卡片化(数据 + UI + LLM 模板)

#### 2.1 数据模型扩 kind

`FileContextItem` 加 `kind?: "chat" | "file"`,类型同步扩到:
- `prompt.tsx` FileContextItem 主定义
- `submit.ts` CommentItem(restoreCommentItems 也加 kind 透传)
- `history.ts` PromptHistoryComment
- `build-request-parts.ts` ContextFile
- `comment-note.ts` PromptComment

5 处 union type 改动 + 1 处 add() 调用扩 kind 字段。

#### 2.2 dom-provider 给 chat 区返 sourceMeta

原现状:只对 `[data-slot="pdf-viewer"]` 返 sourceMeta,chat 区不返。
新现状:chat 区(`[data-slot="session-turn-list"]`)也返 `{ kind: "chat", path: "<chat selection>" }`。

path 用固定占位 `<chat selection>` — LLM 端 kind=chat 走专属模板不用 path,卡片 UI kind=chat 也不显示 path。

#### 2.3 host.tsx 整合 submitToChat 分流

**老逻辑**:`m.sourcePath` 非空 → 卡片;空 → 老 blockquote。
**新逻辑**:`m.sourceKind === "chat" || "file"` → 卡片 + 带 kind;其它(理论上不该出现)→ 兜底走老路径。

PDF/Office 跟 chat 共用一段卡片创建代码,只 commentOrigin/kind 不同。

#### 2.4 context-items.tsx 卡片 UI 按 kind 分流

```tsx
const isChatQuote = item.kind === "chat"
const label = isChatQuote ? t("prompt.context.chatQuoteLabel") : getFilenameTruncated(...)
const tooltipValue = isChatQuote ? <span>{item.preview}</span> : <span>...path...</span>

<Show when={isChatQuote} fallback={<FileIcon ... />}>
  <Icon name="bubble-5" class="size-3.5 text-text-weak" />
</Show>
```

行号显示 `<Show when={!isChatQuote && item.selection}>` 加 kind 判断避免 chat 卡片显示 `:undefined`。

删除按钮 aria-label 也按 kind 分流:`removeFile` vs `removeChatQuote`。

#### 2.5 LLM 模板 formatCommentNote 分流

```ts
if (input.kind === "chat") {
  return `The user is quoting text from earlier in this conversation:
"""
${preview}
"""

Their follow-up question/comment: ${input.comment}`
}
// 否则走原 file 模板
```

build-request-parts.ts isQuote 分支透传 `kind: item.kind` 给 formatCommentNote。

#### 2.6 i18n 加 3 keys(zh / en / zht 共 3 locale × 2 keys = 6 行)

- `prompt.context.chatQuoteLabel`: "聊天引用" / "Chat quote"
- `prompt.context.removeChatQuote`: "移除聊天引用" / "Remove chat quote"

#### 2.7 单测 6 个新测覆盖 formatCommentNote 分支

`packages/app/src/utils/__tests__/comment-note.test.ts`:
- kind="chat" + preview → 含 "quoting text from earlier" 段
- kind="chat" 无 preview → 只 comment 段
- kind="file" 走原 file 模板
- kind 未指定走 file 模板(向后兼容)
- createCommentMetadata / readCommentMetadata kind round-trip
- 非法 kind 值 readCommentMetadata 返 undefined

## 关键决策记录

### D1 — 为啥不直接复用 commentOrigin="quote" + path 前缀

考虑过用 `path = "chat://<sessionID>"` 作为 chat 标识,卡片 UI 检测 `path.startsWith("chat://")` 分支。**否决**理由:
- path 字符串语义overloaded,代码可读性差
- 未来加 OCR / iframe 时又要新前缀,字符串识别堆山
- LLM 端模板分流需要明确 kind,与其在多处 parse 字符串不如统一一个字段

### D2 — 为啥 kind 而非新 ContextItem union 类型

考虑过 `ChatQuoteContextItem extends ContextItem`。**否决**:
- 多处类型守卫 + dispatch 逻辑(渲染 / 删除 / 持久化 / 历史)都要 if-else
- FileContextItem 99% 字段对 chat quote 也适用(path/preview/comment/commentID),复制一遍冗余
- 加一个 `kind?` optional 字段,对老代码 100% 透明(undefined 走 file 路径)

### D3 — chat 选区 path 用什么字符串

`<chat selection>` 固定字符串。**理由**:
- LLM 端 kind=chat 走专属模板,path 不参与模板拼接(只在 createCommentMetadata 里存档元数据)
- 卡片 UI kind=chat 不显示 path
- contextItemKey dedup 靠 commentID(quote-{hash}-{ts}),不依赖 path 唯一性
- 用固定字符串简洁,future 想换成 session-derived 完全 backward compatible

### D4 — Step 顺序 2 先 1 后

**user 拍板**。理由:
- 改动 2 纯 CSS / 风险 0 / 立刻可用
- 改动 1 数据/UI/LLM 三处大改,稳扎稳打
- 如果 1 卡住,2 已独立 ship
