---
feat-id: feishu-create-group-hard-block
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-create-group-hard-block — 1-spec(需求 + 验收)

## 背景

[`feishu-create-group-toggle-gui`](../feishu-create-group-toggle-gui/3-changelog.md) 落地了 GUI toggle + system prompt 软约束(disabled 时拼一段"禁止建群"指令)。

**2026-05-24 user 实测发现软约束有 provider-level 漏洞**:
- ✅ **MiniMax(灵狐 bot)**:soft constraint 生效,回复"此账号未启用..."
- ❌ **claude-code provider(New-name bot)**:**完全不听话** — 仍试图通过翻 fork 源码 / 调飞书 SDK / 让 user 提供凭证等替代路径帮 user 建群

**根因**:grep claude-code plugin 源码(`/Volumes/ExtSSD/deskfox-plugins/claude-code/src/`):
- `claude-code-language-model.ts:213, 566` + `message-builder.ts:58, 148`:**只处理 `role === "user" || "assistant"` 消息,完全跳过 `role === "system"`**
- pipeline 通过 `promptAsync({ system: <prompt> })` 设的 system prompt **在 claude-code 路径下被 plugin 丢弃**
- claude CLI 子进程有自己的 system prompt,听不到 fork 的禁令

**结论**:soft constraint 是 provider-coupled,**任何 plugin-based / spawn-based provider(claude-code / codex / gemini / aider)都会跳过**。需要 provider-agnostic 的硬拦截。

## 用户视角(交付物)

**user 操作**(开关已关 = `enableAutoGroupCreate=false`):
- 飞书私聊里发"帮我建群"/"创建个飞书群"/"create group" 等明确建群请求
- **bot 直接回复**:"此账号未启用自动建群能力。如需启用请在 DeskFox 设置 → 飞书桥接 → 选此账号点【编辑】→ 高级能力 → 勾选「允许 AI 自动创建新群」后重试。"
- **不再走 LLM**(不管 provider 是 claude-code / MiniMax / Claude / OpenAI 都一致)
- **不再撞 imbot read permission 卡**(LLM 没机会翻源码)

预期 user 看到的行为:跟 MiniMax provider 现在的表现一致,**所有 provider 都一样**。

## 验收标准

### 功能
1. ✅ pipeline 在 LLM 调用 **之前** 检测 user message 是否含"建群意图"
2. ✅ 触发条件(三道并集):
   - `enableAutoGroupCreate === false`(flag 开启时跳过硬拦截,让 LLM 走 marker 路径)
   - `chatType === "p2p"`(群里 user 说"建群"不拦截 — 群里通常不是真要 bot 建群,且群里建群本来就被 `processGroupMarkers` 第二道闸禁掉)
   - text(strip mentions 后)匹配关键字
3. ✅ 命中后:
   - 不调用 `promptAsync`(根本不进 LLM)
   - pipeline 直接 `sendFeishuText` 系统消息(跟 soft constraint 文案一致 + 引导 GUI 路径)
   - log `[pipeline ${id}] hard-block CREATE_GROUP intent ...`
4. ✅ 不命中:照常进 LLM(flag=true 时也照常进)

### 关键字列表(白盒文档化)

中文(去空格 + 大小写不敏感):
- 「建群」「创建群」「建一个群」「拉个群」「拉群」「创个群」「新建群」「新群」「开个群」「开群」「建个群」「拉一个群」

英文(case-insensitive):
- `create group` / `new group` / `make group` / `create a group` / `new chat group` / `create chat`

**规则**:**至少含其中一个 substring 即匹配**(简单 substring 检测,不做 NLP)。维护成本可控,误拦交易接受度高。

### 误拦风险评估

| 用例 | 是否拦? | 评价 |
|---|---|---|
| "群是怎么建的?" | ❌ 不拦(含"建"但不含"建群") | 关键字精准 |
| "如何创建一个飞书群?" | ✅ 拦("创建一个群" 匹配) | **真误拦** — user 是问知识不是请求建群 |
| "新群规是什么?" | ❌ 不拦(含"新群" → ✅ 命中) | 真误拦 |
| "我想建立一个团队" | ❌ 不拦(不含关键字) | OK |
| "帮我建一个 X 项目讨论群" | ✅ 拦 | 正确拦 |

**误拦权衡决策**:接受少量误拦。理由:
1. flag=false 是 user 主动选择关闭,**user 应当理解拦截优先**
2. 误拦后回复 GUI 引导 — user 看到能立即明白怎么开启
3. 现实场景里"如何创建群"等纯学术问题极少,真撞了 user 自己开 flag 就行
4. 硬约束比 soft 漏 LLM 找替代路径(撞 read permission 卡 user 体验差)好得多

### 数据 / 不回归
5. ✅ pipeline 不修改 user message(只是拦截判断)
6. ✅ flag=true 时**完全不执行**关键字检测(避免 marker 路径被误拦,节省 CPU)
7. ✅ 群聊场景**完全不执行**关键字检测(不影响群里 user 闲聊)
8. ✅ 非 p2p / flag=true 的所有现有路径行为不变

### 测试 / 治理
9. ✅ R5 Medium ≥ 1 e2e 或 3 unit:helper extract 模式 — `isGroupCreationIntent(text, mentions)` 纯函数独立单测 ≥ 5 case
10. ✅ pipeline 集成测覆盖:disabled p2p 命中拦截 / disabled p2p 不命中正常进 LLM / disabled group 即使命中也不拦 / enabled p2p 即使命中也不拦 / 4 case 即可
11. ✅ `bun run typecheck` 16/16 全过
12. ✅ 三文档全套 + INDEX + 改动日志 entry

## 非目标(Out of scope)

- ❌ NLP / 大模型识别意图(超工程,关键字够用)
- ❌ 拦截"发文件" / "拉人入群" / "改群名"等其他飞书写操作(本 feat 仅建群)
- ❌ 改 claude-code plugin 让它接受 system role(已 discuss 不做)
- ❌ 把 system prompt prepend 到 user message(可能后续作为 enhancement,本 feat 先用关键字)
- ❌ 加 GUI 配置 + dialog 改动(复用现有 `enableAutoGroupCreate` 单 flag,无需新字段)
- ❌ 群成员 ≤ 2 时免 @(独立 feat `feishu-group-mention-policy`)

## 安全 / 边界

- **不动 `processGroupMarkers` 路径**:flag=true 时仍走 confirm 卡片 + 二次确认双门控
- **不动 LLM provider**:只在 pipeline 入口做"截流"判断,不影响 provider 实现
- **可逆**:删 hardBlock 段代码 + helper 即可回退,行为退回当前 soft-only constraint

## 决策轨迹

- **方案**:user 在 2026-05-24 拍板 **Option A**(Pipeline 关键字硬拦截)pick 了相对 prepend system message / 改 claude-code plugin / 双保险 / 全不做 4 方案中最简方案
- **理由**:0 依赖 LLM 听话,provider-agnostic,Tiny 工作量,跟现有 soft constraint 互补(soft 失败时硬拦截兜底)
- **feat-id**:`feishu-create-group-hard-block`,贴交付物语义(硬约束建群)
- **关键字列表** vs **NLP**:选关键字,简单可解释,误拦权衡可接受
- **触发门控 3 道**:`flag=false` + `p2p` + `keyword match` 都必须满足 — 避免误拦群聊学术问题

## 关联

- 上游 spec / 实现:`feishu-create-group-toggle-gui`(flag GUI + soft constraint)
- 上游 marker 协议:`feishu-bridge-light`([CREATE_GROUP:] marker + confirm card)
- pipeline 入口:`packages/adapter-feishu-lark/src/feishu/message-pipeline.ts:298`(`handle()` method)
- helper 位置:`packages/adapter-feishu-lark/src/feishu/reply-actions.ts`(已含 stripMentions / parseCreateGroupMarkers 等同领域 helper,直接扩)
