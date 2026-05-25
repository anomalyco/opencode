---
feat-id: im-account-agent-workspace-binding
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# im-account-agent-workspace-binding — 1-spec(研究阶段)

## 阶段标记

**本文档是研究输出,不是实施 spec**。原始需求池文档(2026-05-24)还停留在 backlog;在启动实施前需要 user 拍板若干决策点(见 §5)。

## 0. 上游需求引用

完整业务背景 / 概念分层 / mermaid 流程图见:
- 原始需求池文档:`/Volumes/ExtSSD/OPENCODE-PLAN/需求池/im账号-agent-workspace-绑定.md`(2026-05-10 立,2026-05-24 最近更新)
- 关键概念:**Agent**(LLM 行为模板,opencode 原生)+ **Skill**(共享能力包,opencode 原生)+ **Workspace**(opencode session 的 directory 参数)+ **IM Account Binding**(本需求新增,把 agent + workspace 按账号粒度组合)
- 用户痛点(摘要):多账号场景(健康 / 开发 / 教育各一个飞书 bot)无法做工作目录隔离;`account.systemPrompt` schema 留了字段但 pipeline 没读
- 4 个典型 user story 见原文 §五

本文档**不重复**业务论证,只补:① 自 2026-05-24 以来代码漂移情况 ② 决策点 ③ 更新后的实施 outline。

## 1. 代码审计发现(2026-05-25)

自原始需求文档写完后,主线 148 commits(2026.5.12.1 → 2026.5.25.1 prod ship),其中 `adapter-feishu-lark/` 有 5+ feat 改动。审计结论:

### 1.1 硬编码 `FEISHU_WORKSPACE` 位置漂移 ±40 行

原文档列 7 处(plugin.ts:45 + message-pipeline.ts:61,236,452,683,706,774),**实际是 9 处运行时引用 + 2 处注释/日志**,line 号全部漂了。

**当前真实位置**(语义引用,不再写死 line):

| 文件 | 位置语义 | 用途 |
|---|---|---|
| `plugin.ts` | 顶部常量定义 | `const FEISHU_WORKSPACE = ...` |
| `plugin.ts` | 启动 mkdir | 确保目录存在 |
| `plugin.ts` | 启动 warn 日志 | mkdir 失败时打路径 |
| `plugin.ts` | 启动 info 日志 | 报告 plugin 启动时的 workspace |
| `message-pipeline.ts` | 顶部常量定义 | export `FEISHU_WORKSPACE` |
| `message-pipeline.ts` | constructor 内 PermissionCardController 入参 | `workspaceDir: FEISHU_WORKSPACE` |
| `message-pipeline.ts` | `session.create` directory | 新建 session 时绑 cwd |
| `message-pipeline.ts` | `promptAsync` directory | 每轮 prompt 的 cwd |
| `message-pipeline.ts` | 主路径 `session.messages` directory | 拉 assistant reply 的 cwd |
| `message-pipeline.ts` | `debugFetchMessages` directory | debug endpoint 用 |
| `message-pipeline.ts` | `archiveSession` directory | archive 旧 session |

**结论**:9 处运行时引用,**原文档"7 处"漏了 plugin.ts 的 2 处日志 + message-pipeline 的 debug entry**;且把 line 774 误标为 archiveSession(实际是 debug)。Lesson:实施时**用 helper 函数 + grep 全替**,不要按 line 号清单照搬。

### 1.2 schema 字段现状

`FeishuAccountSchema`(`core/config-schema.ts`)当前已有:
- ✅ `agent: string` default `"imbot"`(已存在,本需求不动)
- ✅ `model: { providerID, modelID }` optional(已存在)
- ✅ `systemPrompt: string` optional(已存在但 pipeline 未读 — 本需求接通)
- ✅ `tools: string[]` optional(已存在但 pipeline 未读 — 本需求决策见 §5.3)
- ✅ `requireMention: boolean` default `true`(2026-05-24 起活跃,GUI 已暴露 + update-settings 白名单已加)
- ❌ `workspace` 字段 **不存在** — 本需求要新加的就是它
- ❌ `enableAutoGroupCreate` **已删**(2026-05-25 `feishu-group-new-cmd-and-mention-rename` feat)

**关键变化**:原文档隐含 schema 还有 `enableAutoGroupCreate`,但实际已删 → 本需求实施时不需要担心跟它的耦合。

### 1.3 ChatSessionStore 路径 + 持久化

**原文档说在 `core/chat-session-store.ts`,实际在 `feishu/chat-session-store.ts`**(2026-05-09 后整理过路径)。

当前持久化:`~/.opencode/feishu-chat-sessions.json`(0600 mode),JSON 结构 `{ version: 1, sessions: { [accountId]: { [chatId]: sessionID } } }`,**已落盘**。

API:`get` / `set` / `delete` / `deleteAccount` / `listChats`,**无 schema migration scaffolding**。

→ 本需求要把 value 从 `string` 升级到 `{ sessionId, workspace }` 时,需要**实现 graceful migration**(读时检测 value type,旧 string 自动包成新结构)。原文档已提该 migration 思路,可继续沿用。

### 1.4 update-settings endpoint 现状

`server.ts POST /accounts/update-settings` 当前白名单 `["accountId","model","requireMention"]`,unknown fields → 400 `unknown_fields`(严格)。

本需求要扩 3 个字段:`workspace` / `systemPrompt` / `agent`(参考 [§4.5 实施 outline](#45-accountstore-server))。

### 1.5 `handle()` 流程加了 3 个新早退路径

自原文档以来,`handle()` 在 mention check **之前**新加了:
- `/new` 命令早退(2026-05-23,group 里需 `requireMention=false` 才允许)
- `/group <群名>` 显式建群命令早退(2026-05-24)
- 自然语言建群关键字命中后引导用户用 `/group`(2026-05-24)

**这些早退路径都在 `session.create` / `promptAsync` 调用之前**,所以**本需求(扩 workspace 到这两处)跟它们 0 冲突**,只是文档画的 sequence diagram 应该补这 3 个早退框。

## 2. 概念分层(沿用原需求文档)

**不重复**。要点:
1. **Agent / Skill 是 opencode 原生**,本需求不扩
2. **Workspace 是 session.create 的 directory 参数**,目前飞书 plugin 所有 session 共享 `FEISHU_WORKSPACE`
3. **本需求扩展点是"IM 账号 ↔ workspace 绑定"** — 在 account schema 加 `workspace?` 字段,把 9 处 `FEISHU_WORKSPACE` 引用全换成 `account.workspace ?? FEISHU_WORKSPACE`
4. **同 agent name(如 `"imbot"`)按 workspace 加载不同 `.opencode/agent/imbot.md`** — 这是 opencode 原生行为,**不需要任何路由代码**,user 在不同 workspace 放不同 imbot.md 即可

## 3. 跟既有 memory 规则的 reconciliation

需要在实施前明确以下既有 memory 规则跟本需求的 interaction:

### 3.1 [[feedback_feishu_uses_default_model]] 强约束

memory 立场:"飞书桥接走 DeskFox 常规绑定模型,不走外接 plugin agent;adapter prompt_async 不传 agent → opencode 用全局 default"。

当前代码现实:`promptAsync` **传了 `agent: account.agent`**(默认 `"imbot"`)— 跟 memory 描述不一致。

→ **本需求实施前 user 需澄清**:
- 选项 A:严格按 memory,删 `promptAsync.agent` 参数,只走 opencode 全局 default agent。这种情况下 account.agent 字段废,本需求不暴露"选 agent"GUI
- 选项 B:按当前代码现实,保留 `account.agent`,本需求扩 GUI 暴露选 agent 下拉
- 选项 C(中庸):**默认走 imbot(安全 agent)**,user 想换通过 GUI 改 — 也就是当前行为 + 暴露 GUI;最贴近 user 实际使用模式

→ 推荐选项 C。但需要 user 确认 memory 是否更新。

### 3.2 [[imbot_agent]] reference memory

imbot 是 DeskFox setup hook 自动注入到 user opencode 配置的安全 agent,收紧 bash/edit/write 等权限。这是 plugin layer 的安全防线,跟 workspace 隔离正交。

→ **跨 workspace 多个 `imbot.md` 时的安全行为**:每个 workspace 的 `imbot.md` 可以独立写,但**全局 setup hook 不会管 workspace 层的覆写**。user 在某个 workspace 的 `.opencode/agent/imbot.md` 完全可以打开权限到 `bash: allow`。这是 user 主动选择,工程层不强制。

文档化即可,不阻塞实施。

## 4. 决策点 — 需要 user 拍板

启动实施前需要 user 给出明确答案:

### 4.1 启动时机 — 现在做 vs 推迟

原文档 §七列了 4 个触发条件,目前满足度评估:
- ❌ user 实际遇到多账号要分目录痛点(未明确)
- ❌ 加第二个 IM(telegram/钉钉)— 没在做
- ❌ 行业模板(财务/法务/HR)启动 — 没启动
- 🟡 user 主动提"想给某飞书账号配专属 agent / 专属目录" — 现在 user 让研究,意图待澄清

**问题**:user 此次"研究一下这个需求" 的意图是 — ① 准备启动实施;还是 ② 先评估可行性;还是 ③ 学习现状回头再决定?

### 4.2 范围 — 全 7 件套 vs 渐进式

原文档提的"完整方案" 包含 7 件:
1. schema 加 workspace
2. 替换 9 处硬编码
3. systemPrompt 接通 promptAsync
4. agent 字段语义确认(决策 3.1)
5. tools 字段处理(决策 4.3)
6. ChatSessionStore 结构升级 + migration
7. GUI 3 个新字段(workspace 选择器 + agent 下拉 + systemPrompt 多行框)+ /agents endpoint

**可拆解的子 feat**:
- **核心子 feat(必做)**:#1 + #2 + #6 = workspace 隔离能力(~150 行代码 + 60 行测试 + migration)— **真正解决核心痛点**
- **延伸子 feat 1**:#3 systemPrompt 接通(~30 行)— 独立有价值,跟核心解耦
- **延伸子 feat 2**:#4 agent 字段决策(需 3.1 澄清)+ #7 GUI(~100 行 React + ~20 行 server endpoint)
- **延伸子 feat 3**:#5 tools 字段处理(纯文档活,~30 行 release note 写迁移指引)

→ 是否分批做?推荐分 2-3 个 feat:核心 + systemPrompt + (GUI 后续)。

### 4.3 tools 字段处理 — 路线 A vs B

原文档已论证推荐 **路线 B(deprecated)**:工具约束放进 agent.md 的 permission,account 不重复定义。

→ 还要再走一遍 user 确认吗?或者接受路线 B?

### 4.4 ChatSessionStore migration 失败 fallback 策略

原文档提"迁移失败 graceful fallback(清空重建,损失历史 session 映射但不崩溃)"。

→ 是否接受这个 fallback?或者要更激进(改 workspace 时主动清旧 session)?

### 4.5 systemPrompt 注入方式 — opencode SDK 当前限制

原文档 §九.5 提:opencode SDK 不支持 per-prompt system override,只能拼到 user msg。长期最优是改 upstream SDK。

→ 短期:接受拼 user msg 不完美;长期:是否要开个上游 PR?(纯论证,不阻塞实施)

## 5. 实施 outline(基于审计后的现实)

(等 user 拍板决策点 §4 后再正式写 2-plan;以下为雏形)

### 5.1 schema 改动(`config-schema.ts`)

```ts
FeishuAccountSchema = z.object({
  // ... 已有 ...

  // 新增:per-account workspace,空 = fallback FEISHU_WORKSPACE
  workspace: z.string().optional()
    .describe("Per-account workspace; falls back to default feishu-workspace"),
})
```

### 5.2 替换 9 处硬编码

引入 helper:

```ts
// message-pipeline.ts 内部
private workspaceDir(): string {
  return this.opts.account.workspace || FEISHU_WORKSPACE
}
```

`plugin.ts` 类似 helper(可能要传 account-store 进去拿 workspace per-account)。

替换策略:
- **替换前 grep `FEISHU_WORKSPACE` 全 hit**,9 处全换成 `this.workspaceDir()` 或 helper
- **新加单测**:account.workspace 设了 → cwd 是 account.workspace;未设 → fallback FEISHU_WORKSPACE
- **0 line 号清单**(原文档教训)

### 5.3 systemPrompt 接通(决策 4.2 延伸 1)

`runOpencode` 拼 parts 时前置 system constraint:

```ts
const eff = effectiveGroupConfig(account, chatId)
const parts = [
  ...(eff.systemPrompt
    ? [{ type: "text", text: `<system_constraint>\n${eff.systemPrompt}\n</system_constraint>` }]
    : []),
  { type: "text", text: cleaned },
]
```

### 5.4 ChatSessionStore migration(核心子 feat)

`get(accountId, chatId)` 行为升级:
- 旧 value type = string → 视为 `{ sessionId: value, workspace: FEISHU_WORKSPACE }`,自动 lazy-upgrade
- 写时新结构;读时支持新旧

`set(accountId, chatId, sessionId, workspace)` 加 workspace 参数。

测试:
- 旧 JSON 加载 → 自动 upgrade 在内存,落盘新结构
- 改 workspace 时(`update-settings` 改 workspace 字段)同步删 chatSessionStore 对应账号 entry(避免老 session 挂在新 workspace 上)

### 5.5 account-store / server(延伸子 feat 2 的一部分)

`updateAccountSettings` patch 字段扩 `workspace?` / `systemPrompt?` / `agent?` 任一组合;server `/accounts/update-settings` 白名单同步加,类型校验:

```ts
const allowed = new Set(["accountId", "model", "requireMention", "workspace", "systemPrompt", "agent"])
```

新增 `GET /agents` endpoint:转发 opencode `agent.list()`,GUI 下拉用。

### 5.6 GUI 改动(延伸子 feat 2)

`feishu-edit-account-dialog.tsx` 加 3 字段:
- Agent 下拉(从 `/agents` 拉,filter `mode=primary`)
- Workspace 路径(Tauri `dialog.open({ directory: true })`,默认空 placeholder)
- 补充 systemPrompt 多行文本

## 6. 风险 / 已知约束(原文档 §九 + 新增)

原文档 §九 的 9 条仍然适用。新增:

- **跟近期 feat 的 reconciliation**:`/group` / `/new` / 自然语言引导路径都在 mention check 之前,本需求扩 workspace 不影响这些路径(它们 0 LLM 调用)。但 GUI 加新字段时要避免跟现有 "高级能力" 段冲突,建议在 model 段下方加新段 "工作目录与角色"。

- **prod ship 2026.5.25.1 刚发,稳定性窗口期**:本需求是 Medium-Large 改动,涉及 schema + 持久化迁移,**实施完应该至少一个 Tier 2 dev ship 验证后再合进 prod**。

- **fork 内 vs 上游 PR 路线**:`systemPrompt` 长期最优要改 opencode SDK 上游,但短期内拼 user msg 可接受。需要明确长期是否走上游 PR。

## 7. 工作量估计(基于审计 refine 原文档)

| 模块 | 净代码 | 备注 |
|---|---|---|
| schema 加 workspace + 注释 | ~10 行 | 不动既有字段 |
| message-pipeline 替换 9 处硬编码(原文档算 7,实际 9)| ~70 行 | helper extract |
| ChatSessionStore migration | ~80 行 + migration 测试 | 跟原文档估的 60 略多 |
| systemPrompt 接通(`runOpencode` 拼 parts) | ~30 行 | |
| account-store saveAccount 扩 workspace 参数 | ~20 行 | |
| server `/accounts/update-settings` 白名单扩字段 + `/agents` endpoint | ~60 行 | |
| Tauri AccountSummary / UpdateAccountSettings 链路扩 3 字段 | ~30 行 Rust | |
| 单测(含 migration 路径)| ~150 行 | |
| **fork 内小计** | **~450 行** | Medium-Large(原文档算 345)|
| GUI dialog 3 字段 + folder picker | ~120 行 React | |
| GUI 测试 | ~60 行 | |
| **GUI 小计** | **~180 行** | Medium |
| **总计** | **~630 行** | 6-8 天含调试 + 实测 + 文档 |

## 8. 推荐启动路径

**如果 user 决定启动,推荐分 3 阶段**:

**阶段 1(核心,Medium 3-4 天)**:`workspace` 字段 + 替换 9 处硬编码 + ChatSessionStore migration + 后端 server endpoint 扩字段
- 价值:解决核心多账号目录隔离痛点
- 风险:涉及持久化迁移,需 Tier 2 dev ship 验

**阶段 2(GUI,Medium 2-3 天)**:dialog 加 workspace folder picker + agent 下拉 + systemPrompt 多行框 + Tauri 链路
- 价值:user 友好暴露 1
- 依赖:阶段 1 后端完成

**阶段 3(systemPrompt + 上游讨论,Tiny+ 1 天)**:`systemPrompt` 接通到 `promptAsync` parts + tools 字段 deprecate 文档 + 上游 SDK PR 讨论
- 价值:扩展能力
- 独立度高,可跟阶段 1/2 并行或滞后做

## 关联

- 原始需求池文档:`/Volumes/ExtSSD/OPENCODE-PLAN/需求池/im账号-agent-workspace-绑定.md`
- 相关 feats(已 ship):
  - `feishu-bridge-light`(2026-05-23):`/new` + `[ATTACH:]` + `[CREATE_GROUP:]` marker 协议引入
  - `feishu-group-mention-policy`(2026-05-24):`requireMention` 字段 + GUI 暴露 + update-settings 白名单
  - `feishu-group-slash-command`(2026-05-24):`/group` 命令 + 自然语言白名单引导
  - `feishu-group-new-cmd-and-mention-rename`(2026-05-25):`/new` 群里启用 + checkbox 反转 + 删 `enableAutoGroupCreate` 死开关
- 相关 memory:
  - `feedback_feishu_uses_default_model.md` — 飞书桥接 model/agent 选择约束(需 reconcile,见 §3.1)
  - `reference_imbot_agent.md` — imbot 安全 agent 机制
  - `reference_opencode_plugin_quirks.md` — opencode plugin 反直觉行为速查

## 下一步

- **本研究产物**:本 1-spec.md(commit 后留在 feat 分支)
- **不实施**:等 user 给 §4 决策点答案
- **如果 user 决定不启动**:删 feat 分支,留 1-spec.md 作为审计快照保留(可考虑也 commit 到 main 或归档到需求池);或者 cherry-pick 这个 1-spec.md 进需求池文档 §三补丁
- **如果 user 决定启动**:写 2-plan.md 拆阶段 1/2/3 + 时间线
