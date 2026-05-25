---
feat-id: 聊天选区-卡片化-换行
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 聊天选区-卡片化-换行 — 3-changelog(实际改动)

## 总览

| 维度 | 值 |
|---|---|
| 状态 | done(2026-05-25 单日完成 + ship) |
| 起止 | 2026-05-25 |
| commit 数 | 3 commits + 1 merge |
| 净增行 | +179 / -32 |
| 改上游文件 | 0 个(全 fork-only / 新文件) |
| R4 override | **0 笔**(纯 packages/app 内改动) |
| 测试 | 6 新单测(comment-note kind 分流) + 87 单测全过 + typecheck 全过 |

## 用户视角变化

1. **chat 选区右键 → 卡片**(改动 1)— 跟 PDF 卡片一致,但视觉区分(气泡 💬 + "聊天引用")
2. **textarea 不再被塞 blockquote** — 干净留给 user 写问题
3. **LLM 收到 "earlier in this conversation" 模板** — 明确引文是对话历史不是外部文件
4. **卡片溢出自动换行**(改动 2)— 3 行可见,超出纵向滚

## 文件改动清单

| 文件 | 改动 | 行数 |
|---|---|---|
| `packages/app/src/components/prompt-input/context-items.tsx` | 卡片 UI 按 kind 分流 + flex-wrap | +35 / -16 |
| `packages/app/src/utils/context-menu-host/host.tsx` | submitToChat 整合分流 + sourceKind 字段 | +21 / -16 |
| `packages/app/src/utils/context-menu-host/dom-provider.ts` | chat 区也返 sourceMeta | +9 |
| `packages/app/src/utils/comment-note.ts` | formatCommentNote kind 分流 + metadata 扩 kind | +17 |
| `packages/app/src/components/prompt-input/build-request-parts.ts` | isQuote 透传 kind | +3 |
| `packages/app/src/context/prompt.tsx` | FileContextItem 加 kind 字段 | +3 |
| `packages/app/src/components/prompt-input/submit.ts` | CommentItem 加 kind + restoreCommentItems 透传 | +2 |
| `packages/app/src/components/prompt-input/history.ts` | PromptHistoryComment 加 kind | +1 |
| `packages/app/src/i18n/{zh,en,zht}.ts` | chatQuoteLabel + removeChatQuote × 3 locale | +6 |
| `packages/app/src/utils/__tests__/comment-note.test.ts` | 新 6 单测 | +76 |

## commit 链

| # | hash | type | 一句话 |
|---|---|---|---|
| 1 | `27cdc7208` | fix | 改动 2 — 卡片区从横向滚改自动换行(flex-wrap + max-h-[140px])|
| 2 | `3b74e93a2` | fix | 改动 2 调整 — max-h 140 → 180 让 3 行卡片可见(user QA #1 反馈)|
| 3 | `c8fc84702` | feat | 改动 1 — chat 选区改卡片 + kind 字段 + LLM 模板分流(12 文件 +175 / -31) |
| merge | `79758e485` | Merge | Merge feat/聊天选区-卡片化-换行 into main(3 commits) |

## 关键设计决策回顾

### A. 为啥 kind 字段而非新 ContextItem 类型(方案 B vs C)

考虑过 `ChatQuoteContextItem extends ContextItem` 新 union 类型。否决因:
- 多处类型守卫 + dispatch 都要 if-else
- 99% 字段(path/preview/comment/commentID)对 chat quote 也适用,新类型冗余
- 加 `kind?` optional 对老代码 100% 透明(undefined 走 file 路径)

### B. LLM 模板分流为什么必要

A1 版本(`commentOrigin="quote"` + path="<chat selection>")让 LLM 读到 "regarding this file of <chat selection>" — 文法别扭。

新模板 "user is quoting text from earlier in this conversation" 让 LLM 明确**继承当前对话上下文**而非把它当外部文件,LLM 答复质量提升。

### C. Step 2 先 1 后

user 拍板。改动 2 纯 CSS 风险 0 立刻可用,改动 1 数据/UI/LLM 大改稳扎稳打。如果 1 卡住,2 已独立 ship。

### D. chat 选区 path 用 `<chat selection>` 固定字符串

LLM 端 kind=chat 走专属模板不用 path,卡片 UI kind=chat 不显示 path,dedup 靠 commentID(quote-{hash}-{ts})不依赖 path 唯一性 → 用固定字符串最简洁。

## 回归测试

| 维度 | 状态 |
|---|---|
| `bun run typecheck` monorepo | ✅ 全过 |
| `bun test src/utils/__tests__/comment-note.test.ts` | ✅ 6 pass(新测) |
| `bun test src/components/prompt-input src/utils/context-menu-host` | ✅ 81 pass |
| user 真桌面 QA | ✅ user 确认 "样式无问题了" + "测试通过,合主分支" |
| pre-push e2e gate | ✅ 11 pass / 1 skip |

## 回退方法

每笔 commit 单一主题,可独立 revert(P4 可逆):
- 若 chat 选区改卡片有 bug:revert `c8fc84702`,chat 选区回到 textarea blockquote(`27cdc7208` + `3b74e93a2` 改动 2 wrap 仍生效)
- 若 max-h 180 太大挤压视图:revert `3b74e93a2`,回到 140px
- 若 wrap 引起布局问题:revert `27cdc7208`,回到横向滚

## 经验沉淀

### L1 — Medium 规模 feat 必须建三文档

本次 feat 直接 ship 没建 1-spec/2-plan/3-changelog,事后(2026-05-25 文档审计)补齐。**下次 Medium 规模(50-500 行)feat 起手就建三文档骨架**,CLAUDE.md 规范 v2 明确要求,不能省。

### L2 — kind 字段贯穿 5 层比双 union 类型轻

数据模型扩字段 vs 新建 union 类型,前者改动量小 + 老代码透明 + 单 dispatch 点,显著优于后者(尤其当 99% 字段共享时)。原则:**先看字段共享率,90%+ 共享走字段扩,< 90% 才考虑新 union**。

### L3 — LLM 模板分流跟 UI 分流应同 kind 字段驱动

数据维度统一(kind),三层都按它分流:卡片 UI / LLM 模板 / 内部 dispatch。**避免 UI 用一个字段判断、LLM 模板用另一个字段判断**的情况(那就是 path 前缀方案 A 的坑)。

## 未来增量(v2+)

| 阶段 | 内容 | 触发 |
|---|---|---|
| v2 | **MD viewer 整合到 ContextMenuHost** + 用 kind=chat 等新维度 | 触动 MD viewer 时 |
| v3 | OCR Provider — 图片选区 kind="ocr" | OCR feat 立项时 |
| v3 | iframe Provider — HTML 预览选区 kind="iframe" | user 反馈 HTML 选不到字时 |
| v4 | quote 卡片 hover 展开"显示完整原文"(currently 只 tooltip) | user 反馈"hover 看不全"时 |
