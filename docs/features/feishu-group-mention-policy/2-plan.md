---
feat-id: feishu-group-mention-policy
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-group-mention-policy — 2-plan(实施计划)

## 规模:Medium-(~180 行代码 + ~80 行测试 + 三文档)

## 实施顺序

### Phase 1 — helper + pipeline 集成(~50 行 + ~50 行单测)

**1.1** `reply-actions.ts`(+ ~15 行)

新加 helper:

```ts
/**
 * 判断 user 消息的 mentions 是否含 bot 本人。
 *
 * 输入:event.mentions[]、bot 的 openId
 * 输出:true = bot 被 @,false = 没被 @ 或 openId 缺失
 *
 * 用法:pipeline 群消息 + requireMention=true 时,验证 bot 是否被 @ 决定是否响应。
 *
 * [feat: feishu-group-mention-policy] 2026-05-24
 */
export function isBotMentioned(
  mentions: ReadonlyArray<MentionRef>,
  botOpenId: string,
): boolean {
  if (!botOpenId) return false
  return mentions.some((m) => m.openId === botOpenId)
}
```

**1.2** `message-pipeline.ts handle()`(+ ~15 行)

在 CREATE_GROUP intent 块之后、ackMessage 之前加新分支:

```ts
// [feat: feishu-group-mention-policy] 2026-05-24
// 群聊 + requireMention=true(默认)+ bot 没被 @ → 不响应(早退)
// p2p / requireMention=false / bot 被 @ 都正常进 LLM
//
// 前置条件:requireMention=false 实际生效需要 user 先在飞书开放平台改订阅模式
// 为"全量群消息"。否则飞书 server 不推非 @ 消息,本检查根本不会执行。
if (
  event.chatType !== "p2p" &&
  this.opts.account.requireMention &&
  !isBotMentioned(event.mentions, this.opts.account.openId)
) {
  console.log(
    `[pipeline ${this.opts.accountId}] group msg without bot @ (chat=${event.chatId.slice(-8)},` +
      ` requireMention=true) — skip LLM`,
  )
  return
}
```

**1.3** 单测(+ ~50 行)

`reply-actions.test.ts` 加 isBotMentioned 5 case:
- bot openId 在 mentions → true
- bot openId 不在 mentions → false
- 多 mention 含 bot → true
- 空 mentions → false
- bot openId 空串 → false(防御性)

`message-pipeline.test.ts` 加 4 集成测:
- group + requireMention=true + bot 没被 @ → 早退(0 promptAsync / 0 ack)
- group + requireMention=true + bot 被 @ → 正常流程(ack 触发)
- group + requireMention=false + bot 没被 @ → 正常流程
- p2p + requireMention=true → 正常流程(p2p 不受影响)

### Phase 2 — chat_type private default(~5 行 + ~5 行测试)

**2.1** `group-creator.ts`(+ 1 行)

```diff
-    chat_type: "public",
+    // FORK: feishu-group-mention-policy 2026-05-24 — 默认私密群(只能链接邀请进,搜不到)
+    chat_type: "private",
```

**2.2** `group-creator.test.ts` 加 1 case 验 payload 含 `chat_type: "private"`(扩既有 createGroup 测试)

### Phase 3 — GUI dialog + i18n + AccountSummary 链路扩字段(~80 行)

**3.1** `feishu-edit-account-dialog.tsx`(+ ~25 行)

- props 加 `currentRequireMention?: boolean`
- state 加 `requireMentionInGroup` signal(默认 props 值 ?? true)
- 高级能力分隔块内,checkbox 加在 enableAutoGroupCreate 下方
- handleSave payload 加 `requireMention` 字段
- canSave 逻辑不变

**3.2** `settings-feishu.tsx handleEdit`(+ 1 行)

```diff
+    currentRequireMention={acc.require_mention ?? true}
```

**3.3** `feishu-config.ts`(+ ~5 行)

- `UpdateAccountSettingsPatch` 加 `requireMention?: boolean`
- `AccountSummary` 加 `require_mention?: boolean`
- `feishuUpdateAccountSettings` payload mapping 加 requireMention 透传

**3.4** Rust 层(`feishu_adapter.rs`)(+ ~10 行)

- `UpdateAccountSettingsRequest` 加 `pub require_mention: Option<bool>`(serde camelCase)
- `UpdateAccountSettingsWire` 加 `require_mention: Option<bool>`(serde rename "requireMention")
- `AccountSummary` 加 `pub require_mention: Option<bool>`
- `ListAccountWireItem` 加 `require_mention` 字段(serde rename "requireMention")
- `feishu_save_account` / `feishu_list_accounts` 映射

**3.5** `server.ts POST /accounts/update-settings`(+ ~10 行)

- 白名单 `allowed` Set 加 "requireMention"
- 类型校验加 `requireMention === boolean` check
- patch 处理:`if (hasReqMention) patch.requireMention = body.requireMention`
- `account-store.updateAccountSettings` patch 类型已支持(只需扩声明)

**3.6** `account-store.ts updateAccountSettings`(+ ~5 行)

- patch type 加 `requireMention?: boolean`
- 处理分支 `if (patch.requireMention !== undefined) account.requireMention = patch.requireMention`
- 单测加 4 case(only-requireMention / 三方组合 / 隔离验证 / partial 不破坏其他字段)

**3.7** `server.ts GET /accounts`(+ 1 行)

- 响应 entry 加 `requireMention: account.requireMention`

**3.8** i18n(en/zh/zht 各 +2 keys = 6 strings)

新 keys:
- `settings.feishu.edit.requireMention.label` — "群里需要 @ 后再响应"
- `settings.feishu.edit.requireMention.hint` — "**默认开启**:大群只回复 @ 自己的消息(避免抢话)。关闭前请先在飞书开放平台改订阅模式为「全量群消息」,否则飞书 server 不会推送非 @ 消息,本开关无效。"

### Phase 4 — 收尾(~30 分钟)

- `bun run typecheck` 16/16
- `bun test packages/adapter-feishu-lark/` 全过(目标:465 + 新 9 = ~474)
- Build dev .app + user 实测
- 写 3-changelog + INDEX + 改动日志

## commit 链(预期)

| # | commit message |
|---|---|
| 1 | `docs(feishu-group-mention-policy): 1-spec + 2-plan [feat: feishu-group-mention-policy]` |
| 2 | `feat(feishu-group-mention-policy): isBotMentioned helper + pipeline requireMention enforcement + 单测 [feat: feishu-group-mention-policy]` |
| 3 | `feat(feishu-group-mention-policy): chat.create 默认 private(secondary deliverable)+ 测试 [feat: feishu-group-mention-policy]` |
| 4 | `feat(feishu-group-mention-policy): updateAccountSettings 接受 requireMention + 5 单测 [feat: feishu-group-mention-policy]` |
| 5 | `feat(feishu-group-mention-policy): Tauri layer + AccountSummary 加 requireMention 字段 [feat: feishu-group-mention-policy]` |
| 6 | `feat(feishu-group-mention-policy): dialog checkbox + i18n + settings-feishu prop 透传 [feat: feishu-group-mention-policy]` |
| 7 | `docs(feishu-group-mention-policy): 3-changelog + INDEX + 改动日志 [feat: feishu-group-mention-policy]` |

## 风险 / 注意点

| 风险 | 缓解 |
|---|---|
| user 改 checkbox 但没改飞书订阅模式 → bot 仍不响应 → user 困惑 | GUI hint 文案含前置条件警示 + 3-changelog 实测脚本明确步骤 |
| `account.openId` 缺失场景 bot 无法检测 @ | `isBotMentioned` 防御性返 false → 保守路径(等同 mention required)|
| chat_type 改 private 影响老群?| 只对新建群生效;老的 DeskFox 创建群保留原 public 状态(无迁移)|
| Bun `os.homedir()` 缓存问题(从 `feishu-create-group-toggle-gui` learned) | 不再尝试 server endpoint 集成测,只测 account-store helper 行为(已 documented in 上一 feat) |

## 实施中决策点(开发中 append)

(空 — 开发中遇到再补)
