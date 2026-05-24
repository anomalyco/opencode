---
feat-id: feishu-group-mention-policy
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-group-mention-policy — 3-changelog(实际改动 + 回退)

> **状态**:✅ 代码落地(2026-05-24,等用户实测)
> **commit 链**:4 commits(spec/plan + 主路径 + secondary + GUI 全链路)
> **规模**:Medium-(~220 行净增 fork-only,16 新单测,0 黑名单 override,0 上游侵入)

---

## commit 链(自下而上 = 时间顺序)

| hash | 内容 |
|---|---|
| `4c038e179` | docs: 1-spec + 2-plan |
| `cdcf77cd2` | feat: isBotMentioned helper + pipeline requireMention enforcement + 13 单测(helper 7 + 集成 6)|
| `b106f7286` | feat: chat.create 默认 chat_type "public" → "private"(secondary deliverable)+ 测试 |
| `2c7a63c1c` | feat: 全链路扩 requireMention 字段 + dialog checkbox + i18n + 3 单测 |

## 改动文件

### 新增(0)

无新文件(全部扩既有)。

### 修改(11 个文件)

**后端 adapter**:

| 文件 | 净行数 | 改动 |
|---|---|---|
| `packages/adapter-feishu-lark/src/feishu/reply-actions.ts` | +18 | 新加 `isBotMentioned(mentions, botOpenId)` 纯函数(防御性 botOpenId 空串返 false)|
| `packages/adapter-feishu-lark/src/feishu/message-pipeline.ts` | +15 | import + handle() 加 3 条件早退(!p2p + requireMention=true + 不含 bot @)|
| `packages/adapter-feishu-lark/src/feishu/group-creator.ts` | +5 | chat.create payload `chat_type: "public"` → `"private"` + 注释 |
| `packages/adapter-feishu-lark/src/feishu/account-store.ts` | +5 | updateAccountSettings patch 加 requireMention 处理 + 类型扩 |
| `packages/adapter-feishu-lark/src/server.ts` | +18 | endpoint 白名单加 requireMention + 类型校验 + GET /accounts 响应加字段 |
| `packages/adapter-feishu-lark/src/feishu/__tests__/reply-actions.test.ts` | +50 | 7 新单测 covers isBotMentioned |
| `packages/adapter-feishu-lark/src/feishu/__tests__/message-pipeline.test.ts` | +135 | 6 集成测 covers requireMention 3 条件矩阵 |
| `packages/adapter-feishu-lark/src/feishu/__tests__/account-store.test.ts` | +50 | 3 新单测 covers requireMention partial / 三方组合 / toggle 持久化 |
| `packages/adapter-feishu-lark/src/feishu/__tests__/group-creator.test.ts` | +1 | 既有 createGroup 测试 chat_type 验证从 "public" 改 "private" |

**Tauri 层**:

| 文件 | 净行数 | 改动 |
|---|---|---|
| `packages/desktop/src-tauri/src/feishu_adapter.rs` | +12 | `AccountSummary` + `ListAccountWireItem` + `UpdateAccountSettingsRequest` + `UpdateAccountSettingsWire` 全链路加 `require_mention: Option<bool>`;`feishu_save_account` / `feishu_list_accounts` mapping 同步 |

**前端**:

| 文件 | 净行数 | 改动 |
|---|---|---|
| `packages/app/src/utils/feishu-config.ts` | +6 | `UpdateAccountSettingsPatch` 加 `requireMention?: boolean`;`AccountSummary` 加 `require_mention?: boolean`;`feishuUpdateAccountSettings` payload mapping |
| `packages/app/src/components/feishu-edit-account-dialog.tsx` | +18 | props 加 `currentRequireMention` + state signal + 高级能力分隔块加新 checkbox + 副标 hint |
| `packages/app/src/components/settings-feishu.tsx` | +2 | handleEdit 传 `currentRequireMention={acc.require_mention ?? true}` |
| `packages/app/src/i18n/en.ts` | +4 | `requireMention.label` + `.hint`(英文)|
| `packages/app/src/i18n/zh.ts` | +4 | 同上(中文)|
| `packages/app/src/i18n/zht.ts` | +4 | 同上(繁中)|

## 关键设计点

### 1. 复用 dead 的 `requireMention` 字段(0 新加 schema)
`FeishuAccount.requireMention` 字段从 `feishu-bridge` 2026-05-08 起就在 schema 里,但全 codebase 无 enforcement code(grep 验证过)。本 feat 激活它 — 加 pipeline 判断 + GUI 暴露,跟字段定义"对齐意图"。

### 2. 3 条件 AND 门控,逻辑清晰
```ts
if (
  event.chatType !== "p2p" &&
  this.opts.account.requireMention &&
  !isBotMentioned(event.mentions, this.opts.account.openId)
) { return }
```
- p2p 一律响应(条件不满足)
- 群里 requireMention=false 一律响应(等 user 改飞书订阅后才有非 @ 消息)
- 群里 requireMention=true + bot 被 @ 响应
- 群里 requireMention=true + bot 没被 @ → **早退,跳过 LLM**

### 3. 防御性 botOpenId 检测
`isBotMentioned` 在 `botOpenId` 空串 / undefined 时返 false → pipeline 早退路径触发 → **保守拒响应**。理由:OAuth 数据异常时不该误响应非自己的群消息。

### 4. chat_type "public" → "private" 一行改两点必胜
- 私密群:企业内部成员**搜不到**,只能通过 share_link(`chat.link` 一周邀请链接,既有逻辑)进
- 符合 user 心理预期"我建的群我决定谁加入"
- 1 行改 + 1 测试验证,极小改动覆盖大用户感知改进

### 5. 复用 `updateAccountSettings` 已有架构
本 feat 是个完美 use case:旧 feat 设计了"白名单 partial endpoint",新 feat 加 1 个 schema 字段 → 0 新 endpoint / 0 新命令 / 0 新文件。**架构选 Option A partial settings 是这次决策回报点**。

## 前置条件(用户必读)

**⚠️ 改 checkbox = false 单独不会自动生效**。必须先在飞书开放平台改订阅模式:

1. 飞书开放平台 → 选 bot 应用 → 「**事件订阅**」(或「事件与回调」)
2. 找 `im.message.receive_v1` 群消息事件
3. 改订阅范围:**「仅 @ 触发」→「全量群消息」**
4. 飞书可能要求添加 `im:message` 或 `im:chat:get` 等权限 scope,跟着提示加
5. **此外**:已存在的群 bot 可能要被踢出去重新拉入,新订阅模式才对老群生效(详见飞书文档)
6. 然后 DeskFox 里把 checkbox 取消勾选 → 保存(走 hot reload,无需重启)

## 测试

### 落地的测试(R5 Medium ≥ 1 e2e 或 3 unit,实际 16 unit)

**reply-actions.test.ts** isBotMentioned(7 新):
- 命中 / 不命中 / 多 mention 命中 / 空 mentions / botOpenId 空 / botOpenId 不同 / mention openId 缺失

**message-pipeline.test.ts** requireMention enforcement(6 新):
- group + req=true + 不 @ → 早退
- group + req=true + 被 @ → 正常
- group + req=false + 不 @ → 正常(免 @)
- group + req=false + 被 @ → 正常(不重复)
- p2p + req=true → 不受影响
- group + req=true + openId 缺失 → 早退保守(防御性)

**account-store.test.ts** updateAccountSettings 扩(3 新):
- only-requireMention 改动,其他字段不动
- model + flag + requireMention 三方组合
- toggle 持久化

**group-creator.test.ts** chat_type private 验证(1 既有更新):
- chat.create payload `chat_type === "private"`

### 全套套件
- 481/481 全 adapter 套件全过(原 465 + 新 16)
- 16/16 bun run typecheck monorepo 全过
- cargo build --release OK(7 pre-existing warnings,本笔无新 warning)

### 实测脚本(2026-05-24,user 验收)

**前置**:在飞书开放平台改订阅模式 + 重新拉 bot 入群(详见上方"前置条件")。

build dev .app 后:

1. **GUI 验证**:Settings → 飞书桥接 → 选某账号【编辑】→ 高级能力分隔块 → 应看到新 checkbox "群里需要 @ 后再响应"(默认勾选)
2. **保存生效**:取消勾选 → 保存 → hot reload,无需重启
3. **群里免 @ 响应**:bot 已加入的某个群里直接发消息(不 @ bot)→ bot 应正常响应(走 LLM)
4. **群里 @ 后响应**(re-toggle):勾上 checkbox 保存 → 群里发消息不 @ → bot 不响应;@ bot → bot 响应
5. **p2p 不受影响**:私聊里发任何消息 → bot 永远响应(checkbox 不影响 p2p)
6. **chat_type private 验证**:开 enableAutoGroupCreate=true,飞书私聊里说"建群叫 test-private",点 confirm → 收到群链接 → 进群后右上角 ⓘ 应显示「**私有群**」(不是「公开群」)

## 三铁律走流程

| 步骤 | 状态 |
|---|---|
| 开 feat 分支 `feat/feishu-group-mention-policy` | ✅ |
| 本地 commit 不动 main | ✅ |
| → main merge user 同意 | (待 user 拍)|
| → origin/main push user 同意 | (待 user 拍)|

## 风险 / 已知限制

1. **飞书订阅模式改是 prerequisite**:user 改 checkbox 但没改飞书后台 → bot 仍不响应非 @ 消息 → user 可能困惑。GUI hint 含警示文字,但 user 可能不读 — 建议跑两次实测后才确信
2. **bot 加入老群可能需要重新拉入**:某些飞书版本下订阅模式改完只对新群生效;老群可能需要 bot 退出再加入。这是飞书平台行为,我们 plugin 救不了
3. **chat_type 改 private 只对新建群生效**:老的 DeskFox 创建的公开群保持公开状态。无迁移逻辑
4. **大群里 bot 全量响应可能刷屏**:理论上 requireMention=false + 大群 → bot 每条消息都响应,在 50 人群里可能造成 spam。本 feat 不加"群成员数 ≤ N 才免 @"硬规则(留 backlog `feishu-group-size-threshold-policy`)— user 自己掂量
5. **跨平台 (Win) 未测**:本 feat 仅 Mac 端开发 + 实测;Win 端等下次双端协作再验

## 回退方法

1. **revert 整 merge commit**(本 feat 4 commits 全恢复 main):
   ```bash
   git revert -m 1 <merge-commit-hash>
   ```
2. **手动局部回退**:
   - 只关 requireMention enforcement:`message-pipeline.ts` 删 3 条件早退段(15 行)
   - 只关 GUI checkbox:删 dialog checkbox 段 + i18n keys + props(不影响 enforcement)
   - 只回退 chat_type:`group-creator.ts` 改回 `"public"`(老群不受影响)
3. **数据回退**:`requireMention=false` 写入 `~/.opencode/feishu-config.json` 的 account 字段保留也无害(老代码不读它)

## 关联

- 上游 schema(dead config 激活):`packages/adapter-feishu-lark/src/core/config-schema.ts:93`(`requireMention` 字段定义)
- pipeline 入口:`packages/adapter-feishu-lark/src/feishu/message-pipeline.ts:412+`(`handle()` method 新加段)
- helper:`packages/adapter-feishu-lark/src/feishu/reply-actions.ts:255+`(尾部新加)
- chat_type 改点:`packages/adapter-feishu-lark/src/feishu/group-creator.ts:35`
- 复用 endpoint:`packages/adapter-feishu-lark/src/server.ts:280+`(`POST /accounts/update-settings` partial 已 extended)
- 复用 GUI dialog:`packages/app/src/components/feishu-edit-account-dialog.tsx`(已含高级能力分隔块)
- 上游 spec 模式:`feishu-create-group-toggle-gui/3-changelog.md`(updateAccountSettings partial architecture)
