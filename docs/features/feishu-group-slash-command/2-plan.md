---
feat-id: feishu-group-slash-command
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-group-slash-command — 2-plan(实施计划)

## 规模:Medium ~150-200 行代码 + ~150 行测试 + 三文档

## 实施顺序

### Phase 1 — `reply-actions.ts` 改造(~60 行)

**1.1** 删 `CREATE_GROUP_MARKER_RE` + `parseCreateGroupMarkers` + `parseCreateGroupShortForm`(及相关 type / export)

**1.2** 新加 `parseGroupCommand(text: string)`:

```ts
/**
 * 解析 /group 命令,提取群名。
 *
 * 命中:`/group <名字>`(以 "/group " 开头,后接非空名字)
 * 不命中:`/group`(无参数)、`/groupabc`(粘连)、`/Group X`(大小写敏感)
 *
 * 群名:中文 / 英文 / 数字 / `-` / `_` / 空格,长度 1-30
 */
export interface GroupCommandParseResult {
  matched: boolean
  /** 命中且参数有效时返回群名;命中但无参数 → matched=true, groupName=null */
  groupName: string | null
  /** 群名超 30 字符或含非法字符时设 */
  error?: "no_name" | "too_long"
}

export function parseGroupCommand(text: string): GroupCommandParseResult {
  const trimmed = text.trim()
  if (!trimmed.startsWith("/group ") && trimmed !== "/group") {
    return { matched: false, groupName: null }
  }
  if (trimmed === "/group") {
    return { matched: true, groupName: null, error: "no_name" }
  }
  const name = trimmed.slice("/group ".length).trim()
  if (!name) return { matched: true, groupName: null, error: "no_name" }
  if (name.length > 30) return { matched: true, groupName: null, error: "too_long" }
  return { matched: true, groupName: name }
}
```

**1.3** 改写 `isGroupCreationIntent`:

```ts
/** Tier 1 + Tier 2 白名单短语(14 个中文)+ 4 个英文 */
const GROUP_CREATION_PHRASES_ZH = [
  // Tier 1
  "建群", "创建群", "新建群", "拉群",
  // Tier 2(口语变体)
  "建个群", "建一个群", "创建个群", "创建一个群",
  "新建个群", "新建一个群", "拉个群", "拉一个群",
  "开个群", "开一个群",
] as const

const GROUP_CREATION_PHRASES_EN = [
  "create a group", "make a group", "start a group", "new group",
] as const

/** 查询后缀排除 — 命中短语但 user 是在查询/讨论,不是真要建群 */
const QUERY_SUFFIXES_ZH = [
  "怎么", "如何", "方法", "步骤", "流程", "教程", "为什么",
] as const

/** `new group` 专用排除 — 防 "new group rule" / "new group of users" 等误拦 */
const NEW_GROUP_EXCLUDE_TOKENS = [
  " rule", " of ", " policy", " chat", " channel", " members", " settings",
] as const

/** 英文通用排除 */
const QUERY_SUFFIXES_EN = [" how", " how to"] as const

export function isGroupCreationIntent(text: string): boolean {
  // 中文白名单命中
  const zhHit = GROUP_CREATION_PHRASES_ZH.some((p) => text.includes(p))
  // 英文白名单命中(lowercase 比较)
  const lower = text.toLowerCase()
  const enHit = GROUP_CREATION_PHRASES_EN.some((p) => lower.includes(p))
  if (!zhHit && !enHit) return false

  // 命中 → 检查排除后缀
  if (zhHit) {
    if (QUERY_SUFFIXES_ZH.some((s) => text.includes(s))) return false
  }
  if (enHit) {
    if (QUERY_SUFFIXES_EN.some((s) => lower.includes(s))) return false
    // new group 专用排除
    if (lower.includes("new group")) {
      if (NEW_GROUP_EXCLUDE_TOKENS.some((s) => lower.includes("new group" + s))) {
        return false
      }
    }
  }
  return true
}
```

### Phase 2 — `message-pipeline.ts` 改造(~50 行)

**2.1** 删 `CREATE_GROUP_MARKER_PROMPT`(整段)+ 用法

**2.2** `handle()` 加 `/group` 分支(在 `/new` 之后、`isGroupCreationIntent` 引导之前、`runOpencode` 之前):

```ts
// /group <名字> — 显式建群
// [feat: feishu-group-slash-command] 2026-05-24
const groupCmd = parseGroupCommand(cleaned)
if (groupCmd.matched) {
  // 群聊禁用
  if (event.chatType !== "p2p") {
    await this.sendFeishuText(
      event.chatId,
      "⚠️ /group 仅支持私聊(群里建子群 UX 不清晰)",
    )
    return
  }
  // 用法错误
  if (groupCmd.error === "no_name") {
    await this.sendFeishuText(
      event.chatId,
      "⚠️ 用法:`/group <群名>`,例:`/group 项目讨论`",
    )
    return
  }
  if (groupCmd.error === "too_long") {
    await this.sendFeishuText(
      event.chatId,
      "⚠️ 群名超长(最多 30 字符),请缩短后重试",
    )
    return
  }
  // 解析成功 → 弹 confirm-card
  await this.confirmController.sendConfirmCard({
    chatId: event.chatId,
    userId: event.userOpenId,
    groupName: groupCmd.groupName!,
    triggeringMessageId: event.messageId,
  })
  return
}
```

**2.3** 自然语言降级引导(改写既有 hard-block 段):

```ts
// 自然语言关键字命中 → 引导用 /group(不走 LLM 防 imbot wall)
// [feat: feishu-group-slash-command] 2026-05-24
if (
  event.chatType === "p2p"
  && !this.opts.account.enableAutoGroupCreate  // flag 关时才走硬拦截(保留原逻辑)
  && isGroupCreationIntent(cleaned)
) {
  await this.sendFeishuText(
    event.chatId,
    [
      "你想创建群?请使用斜杠命令:",
      "",
      "  /group <群名>",
      "",
      "例:",
      "  /group 项目讨论",
      "  /group 产品需求-2026Q2",
      "",
      "(创建后我会拉你进群,后续讨论在那里继续)",
    ].join("\n"),
  )
  return
}
```

> 注:`enableAutoGroupCreate` flag 的语义微妙变化。**原来**:flag 关 → hard-block GUI 引导。**现在**:flag 关 → hard-block /group 引导。flag 开 → 走 LLM(老的 LLM marker 路径已删,所以走完 LLM 也不会自动建群,只是 LLM 可能回 "用 /group" 文字)。这个语义 OK,无破坏性。

**2.4** 删 `parseCreateGroupMarkers` 调用 + 删 reply 含 marker 时调 confirm-card 那段(reply 现在不会再出现 [CREATE_GROUP:name] marker,因为 LLM marker 路径删了)

**2.5** system prompt(`buildSystemPrompt` 等)加入新段:

```ts
const GROUP_CREATION_GUIDE = [
  "## 建群引导",
  "",
  "如果用户表达建群意图(例:'帮我建群' / '把刚才内容拉个群继续'),",
  "**不要尝试自己建群**,而是回复用户使用斜杠命令:",
  "",
  "  /group <群名>",
  "",
  "例:`/group 项目讨论`。让用户自己决定是否触发建群。",
].join("\n")
```

跟现有 system prompt 段拼接;CREATE_GROUP_MARKER_PROMPT 删后由这段顶替。

### Phase 3 — 测试改造(~150 行)

**3.1** `reply-actions.test.ts`:
- 删 `parseCreateGroupMarkers` / `parseCreateGroupShortForm` 测试
- 新加 `parseGroupCommand`(8 case):
  - `/group 项目讨论` → matched: true, groupName: "项目讨论"
  - `/group` → matched: true, groupName: null, error: "no_name"
  - `/group ` → matched: true, error: "no_name"(trailing space 无群名)
  - `/group project plan 2026` → matched: true, groupName: "project plan 2026"(允许内部空格)
  - 31 字符长群名 → matched: true, error: "too_long"
  - `/groupabc` → matched: false(粘连)
  - `/Group X` → matched: false(大写)
  - `   /group X   ` → matched: true(trim leading/trailing whitespace)
- `isGroupCreationIntent` 改造(14 case):
  - 14 个白名单短语各 1 case 命中
  - "如何建群" / "建群怎么操作" / "建群方法" → 不命中(查询后缀排除)
  - "建立群体精神" / "新群规" → 不命中(短语不在白名单)
  - "new group rule" / "new group of users" → 不命中(NEW_GROUP_EXCLUDE)
  - "create a group called X" → 命中
  - "how to create a group" → 不命中(英文查询后缀)

**3.2** `message-pipeline.test.ts` 集成测改造:
- 删 [CREATE_GROUP:name] marker 解析的测试段
- 新加 `/group` 集成测(4 case):
  - p2p `/group X` → confirm-card 触发,**不调 LLM**(opencodeClient.session.promptAsync 不被调用)
  - 群聊 `/group X` → reply "/group 仅支持私聊",不走 LLM
  - p2p `/group`(无参数) → reply 用法提示
  - p2p `/group <31 字符长名>` → reply 超长拒绝
- 老 hard-block 测改造 ~3 case:
  - "帮我建群" p2p flag=false → reply 含 "/group <群名>" 引导文案
  - "如何建群" → 走 LLM(查询后缀排除)
  - "建立群体精神" → 走 LLM(短语不在白名单)

### Phase 4 — 收尾

- `bun run typecheck` 16/16
- `bun test packages/adapter-feishu-lark/`(目标:518 + 新 ~20 - 删 ~15 = 523 全过)
- 三文档:1-spec(本笔)+ 2-plan(本笔)+ 3-changelog(commit 后填)
- INDEX 加 entry
- 改动日志.md 加 entry

## commit 链(预期)

| # | commit message |
|---|---|
| 1 | `docs(feishu-group-slash-command): 1-spec + 2-plan [feat: feishu-group-slash-command]` |
| 2 | `feat(feishu-group-slash-command): /group 命令 + 自然语言白名单 + 删 LLM marker 路径 [feat: feishu-group-slash-command]` |
| 3 | `docs(feishu-group-slash-command): 3-changelog + INDEX + 改动日志 [feat: feishu-group-slash-command]` |

## 风险 / 注意点

| 风险 | 缓解 |
|---|---|
| 删 LLM marker 路径,支持 system prompt 的 provider 用户体验降级(LLM 不再自动建群) | system prompt 加引导,LLM 看到建群请求回"用 /group <群名>";user 多 1 步,接受 |
| 白名单漏拦真意图("咱建一个项目讨论群吧" 不命中) | 漏拦走 LLM → 看 provider 表现;对跳过 system 的 provider 仍可能撞 imbot wall(罕见,接受) |
| `/group` 命令名跟未来其他 plugin 冲突(假设有) | 当前 plugin 体系无 namespace,只有飞书 plugin;未来真撞冲突再考虑 namespacing |
| 群聊禁用 → user 困惑"为什么群里不能建群" | reply 文案说清"群里建子群 UX 不清晰",并指引去私聊 |
| `enableAutoGroupCreate` flag 语义微变 | 文档说清:flag 关 → hard-block 走引导;flag 开 → LLM 看 system prompt 自己引导(不再自动建群) |

## 实施中决策点(开发中 append)

(空 — 开发中遇到再补)
