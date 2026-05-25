---
feat-id: 聊天选区-卡片化-换行
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# 聊天选区-卡片化-换行 — 1-spec(需求 + 验收)

## 背景

`office-选中加聊天` v1 已 ship,实现了 PDF/Office 选区 → 卡片 + LLM 干净 token。但**两个遗留问题**:

1. **chat 区(AI / user 消息气泡)选中文字 → 加聊天** 仍走老 markdown blockquote 塞 textarea 路径,跟 PDF 卡片体验**不一致**
2. **卡片溢出 → 横向滚** 隐藏 `no-scrollbar`,user 多卡时不知道还有下一个,UX 不友好

## 用户视角

### 改动 1:chat 选区也走卡片

**操作**:在 AI 或 user 消息气泡选中文字 → 右键 → 添加到聊天 → 写后续问题 → 提交。

**期望**:
- 卡片出现在 prompt 上方(跟 PDF 同区域)
- 卡片视觉**跟 PDF 卡片不同** — 聊天气泡 💬 图标 + "聊天引用"标签(区分来源)
- hover 卡片 tooltip 显示完整选中文字
- textarea 保持干净(不塞 blockquote)
- LLM 答复**针对选中那段**,并理解**这是同一对话里的引用**(不是新外部文件)

### 改动 2:卡片溢出自动换行

**操作**:产生 4+ 张卡片。

**期望**:
- 卡片**自动换行**(不再横向滚)
- 3 行内可见,超出**纵向滚**(`max-h-[180px]`)
- 不挤压聊天显示区 / 输入框

## 设计选型

### 改动 1 — 方案 B (kind 字段贯穿)

| 方案 | 数据 | 卡片 | LLM 模板 | 改动量 |
|---|---|---|---|---|
| A 伪 path 前缀 | 0 改 | path 字符串识别 | 不分流 | ~50 行 |
| **B kind 字段** | +1 字段 | 按 kind 分支 | 按 kind 分流 | ~150 行 |
| C 新 ContextItem 类型 | 新 union | 彻底分流 | 彻底分流 | ~300 行 |

**选 B** — 数据上诚实(明确说这是 chat 不是 file),卡片视觉 + LLM 模板都按 kind 分流;未来加 OCR / iframe 等场景只需新加 kind 值,平滑可扩展。

### 改动 2 — flex-wrap + max-h 兜底

`flex-nowrap + overflow-x-auto + no-scrollbar` → `flex-wrap + max-h-[180px] + overflow-y-auto`。3 行 CSS class 调整,无数据/逻辑影响。

## 范围限定

- **覆盖**:chat 区(`session-turn-list` 子树)所有 message 气泡的选区
- **不覆盖**:MD viewer(`mdMenu`)— 仍走老路径,统一改造留 v2(office v1 spec 已固化)
- **不变**:PDF/Office 卡片路径不动(已 ship)、跨页选区 hint 不动、顶栏"用本机软件打开"不动

## LLM 模板差异

**file 卡片**(原模板):
```
The user made the following comment regarding this file of {path}: {comment}

Selected text:
"""
{preview}
"""
```

**chat 卡片**(新模板):
```
The user is quoting text from earlier in this conversation:
"""
{preview}
"""

Their follow-up question/comment: {comment}
```

差别:chat 不说"file",改说 "earlier in this conversation",让 LLM 明确**继承当前对话上下文**而非把它当外部文件处理。

## 验收标准

1. ✅ chat 选区 → 右键 → 添加到聊天 → 卡片出现(气泡图标 + "聊天引用"标签 + 删除按钮)
2. ✅ 卡片 hover tooltip 显示选中文字原文(不是文件名/路径)
3. ✅ textarea 不再被塞 markdown blockquote
4. ✅ LLM 收到 prompt 含 "quoting text from earlier in this conversation",回复针对选中那段
5. ✅ 同时 PDF 卡片 + chat 卡片混合时,**视觉清晰区分**两种来源
6. ✅ 卡片产生 4+ 张时自动换行,3 行可见,超出纵向滚不破布局
7. ✅ typecheck + 单测全过(72 → 87 +6 新单测)
8. ✅ R4 0 笔(全 fork-only 新文件 + 数据维度扩字段,无 packages/ui 黑名单触碰)
