---
feat-id: feishu-group-mention-policy
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-group-mention-policy — 1-spec(需求 + 验收)

## 背景

2026-05-24 user 提出研发场景需求:同一个 bot 多项目并行,每个项目一个独立群作为 session,**希望群里不用 @ bot 就响应**。

调研发现两个相关的「飞书桥接默认值不太对」问题:

1. **`FeishuAccount.requireMention` 字段是 dead config** — schema 2026-05-08 起就有(`config-schema.ts:93`),但全 codebase **0 enforcement code**(grep 验证)。当前 bot 在群里只响应 @ 消息靠的是飞书 server 端订阅模式默认"仅 @ 触发",不是 plugin 端过滤。

2. **`chat.create` 硬编码 `chat_type: "public"`**(`group-creator.ts:31`)— DeskFox 创建的群默认公开,user 主观预期是"我建的群我决定谁加入"(私密更合理)。

两件事都是「飞书桥接 privacy 默认值」主题,合在同 feat 处理 — 一致性 + 减少 PR 噪音。

## 用户视角(交付物)

### 交付 1 — `requireMention` 激活 + GUI toggle

**user 操作**:
- Settings → 飞书桥接 → 选某账号【编辑】→ 高级能力分隔块 → **新看到 checkbox「群里需要 @ 后再响应」**(默认勾选 = 当前 behavior)
- 勾掉 + 保存 → bot 在该账号加入的所有群里都自动响应(无需 @)
- **前置条件警示**:checkbox 副标含明确说明 — "**关闭前请先在飞书开放平台改订阅模式为「全量群消息」**,否则飞书 server 不会推送非 @ 消息,本开关无效。"

**重启** DeskFox?不需要 — 复用 `feishu-create-group-toggle-gui` 的 `updateAccountSettings` partial endpoint + onAccountsChanged hot reload,checkbox 改完立即生效。

### 交付 2 — 创建群默认 private

**user 操作**:无需改任何设置。
- 之前:user 通过 DeskFox 流程让 bot 建群 → 群是**公开群**(企业内部能搜到)
- 现在:user 通过 DeskFox 流程让 bot 建群 → 群是**私密群**(只能通过 share_link 邀请进)
- share_link 邀请链接逻辑不变(`chat.link({ validity_period: "week" })`),邀请进群体验一致

## 验收标准

### 交付 1 — requireMention enforcement

1. ✅ pipeline `handle()` 加新分支:`event.chatType !== "p2p"` + `account.requireMention === true` + bot 没被 @ → **不响应**(早退,跳过 LLM)
2. ✅ pipeline 仍处理:p2p 私聊一律响应 / 群聊但 bot 被 @ / 群聊且 `requireMention === false`
3. ✅ helper `isBotMentioned(mentions, botOpenId)`:遍历 mentions 数组找 openId === botOpenId 即 true(防御 openId 缺失返 false)
4. ✅ GUI dialog "高级能力" 段加 checkbox(label: "群里需要 @ 后再响应",hint 含前置条件警示)
5. ✅ checkbox 状态从 `account.requireMention` 读取,保存通过 `feishuUpdateAccountSettings`({ requireMention })
6. ✅ `AccountSummary` 全链路加 `require_mention` 字段(server → Tauri → frontend)
7. ✅ `updateAccountSettings` schema partial 接受 `requireMention?: boolean`(扩既有白名单)
8. ✅ hot reload 立即生效

### 交付 2 — chat_type 默认 private

9. ✅ `group-creator.ts` `chat.create` 调用从 `chat_type: "public"` 改 `"private"`
10. ✅ 测试加 1 case 验 payload 含 `chat_type: "private"`
11. ✅ share_link 流程不变(`chat.link` 仍取一周有效邀请链接)
12. ✅ Confirm 卡片文案不需要改(原本就说"创建群【X】并把你拉进群" — 公开私密都适用)

### 不回归

13. ✅ 既有 ATTACH / CREATE_GROUP hard-block / direct-dispatch 路径行为不变
14. ✅ p2p 私聊行为完全不变(requireMention 不适用)
15. ✅ `requireMention=true`(默认)+ 没改飞书订阅模式 → user 行为零变化(bot 仍只对 @ 响应,因为飞书 server 也没推非 @ 消息)
16. ✅ `bun run typecheck` 16/16 全过
17. ✅ R5 Medium ≥ 3 unit + 1 e2e(等效):helper 单测 + pipeline 集成测 + group-creator 测试加 chat_type 验证

## 非目标(Out of scope)

- ❌ Per-group allowlist(路径 B,user 选了 A 简化)
- ❌ 飞书订阅模式自动检测向导(放 backlog,user 选先不做)
- ❌ 群成员数动态判断(≤2 双人群免 @,> 2 必须 @)— 走法 1 Auto rule,user 现阶段不需要
- ❌ 解决 claude-code provider 跟群消息的复杂交互(本 feat 仅纯过滤行为,不动 LLM 链路)
- ❌ Window 端测试(本笔不构建 Win,Mac 端实测覆盖)

## 安全 / 边界

- **前置条件**:`requireMention=false` 单独勾掉**不会自动生效**,除非 user 先在飞书开放平台改订阅模式。这点必须在 GUI hint 文字 + 3-changelog "用户引导" 段明确(避免 user 抱怨"开关不工作")
- **bot openId 检测**:`account.openId` 必须存在(OAuth 流程已写,正常账号都有);如果 openId 缺失(老 schema 数据迁移异常)→ `isBotMentioned` 返 false → 保守路径(等同 requireMention=true 阻拦)
- **chat_type 改 private 影响**:已存在的公开群**不受影响**(只对新建群生效)。User 老的 DeskFox 创建群保留 public 状态。private 群通过 share_link 邀请进的体验跟 public 一致(user 用一周有效链接进群,无需搜索)

## 决策轨迹

- **路径**:user 在 2026-05-24 拍板 **路径 A**(简单 toggle 全部群免 @),pick over 路径 B(allowlist)/ 路径 C(双 toggle)/ 路径 D(三态 enum)
- **理由**:Medium- 工作量(~120 行)vs 路径 B 的 Medium ~200 行,简化优先;允许 user 后续如果撞 "其他群被 bot 抢话" 再开 follow-up feat 加 allowlist
- **chat_type 默认改 private**:user 2026-05-24 拍板加入本 feat(同主题"飞书 privacy 默认值整治",合一起减 PR 噪音)
- **`requireMention` 字段沿用 dead config**:0 新加 schema 字段,跟 `enableAutoGroupCreate` 一致复用模式
- **GUI 位置**:复用 `feishu-edit-account-dialog` 高级能力分隔块(已存在 `enableAutoGroupCreate` checkbox),新 checkbox 加在下方
- **feat-id**:`feishu-group-mention-policy` 贴主题(mention 行为 policy 化),sub-feature `chat_type private default` 作为 secondary deliverable 写进 3-changelog

## 关联

- 上游 schema:`packages/adapter-feishu-lark/src/core/config-schema.ts:93`(`requireMention` 字段定义)
- 上游空 enforcement:全 codebase `grep "requireMention"` 仅出现 schema + account-store default,无 pipeline 引用
- chat_type 硬编码点:`packages/adapter-feishu-lark/src/feishu/group-creator.ts:31`
- 复用 endpoint:`packages/adapter-feishu-lark/src/server.ts:280+`(`POST /accounts/update-settings` partial 已支持任意子集)
- 复用 Tauri 命令:`feishu_update_account_settings`(已存在)
- 复用 GUI dialog:`packages/app/src/components/feishu-edit-account-dialog.tsx`(已含高级能力分隔块)
