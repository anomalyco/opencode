---
feat-id: feishu-group-new-cmd-and-mention-rename
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-group-new-cmd-and-mention-rename — 3-changelog

> **状态**:✅ 代码 + 测试落地(2026-05-25,等用户实测)
> **commit 链**:3 commits(spec/plan + 主实施 + changelog)
> **规模**:Medium- 净 +71 行(97 + / 26 -)+ 三文档 / 6 文件触动 / 0 上游侵入

## commit 链

| hash | 内容 |
|---|---|
| `80a04487c` | docs: 1-spec + 2-plan + INDEX entry |
| `092fd106b` | feat: /new 群里启用 + GUI checkbox 反转 + i18n 改名(3 文件 i18n + 1 GUI + 1 pipeline + 1 test) |
| (本次填) | docs: 3-changelog + INDEX done + 改动日志 entry |

## 改动文件

| 文件 | 净行数 | 改动 |
|---|---|---|
| `packages/adapter-feishu-lark/src/feishu/message-pipeline.ts` | +15 / -7 | `/new` 分支启用条件改:`p2p 永远 OR (!requireMention && group)`;reply 文案区分 p2p vs group;日志加 chatType |
| `packages/app/src/components/feishu-edit-account-dialog.tsx` | +9 / -5 | checkbox 双向绑定反转(`!requireMention`);label/hint 引用新 i18n key;注释说明 UI 反转 + 后端字段不动 |
| `packages/app/src/i18n/zh.ts` | +3 / -3 | i18n key `requireMention.*` → `allowReadAll.*`;文案改写含 /new 群里说明 |
| `packages/app/src/i18n/zht.ts` | +3 / -3 | 繁体中文同步 |
| `packages/app/src/i18n/en.ts` | +4 / -3 | 英文同步 |
| `packages/adapter-feishu-lark/src/feishu/__tests__/message-pipeline.test.ts` | +63 / -5 | 旧"群聊 /new 拒绝"测试改写为"requireMention=true 拒绝引导";新加"requireMention=false 允许 + 影响所有人"和"@bot strip mention"两个 case;`makeAccount` 默认加 `requireMention: true` 跟 zod schema 对齐 |

## 关键设计点

### 1. `/new` 群里启用条件 — channel-as-workspace 模式才允许

```ts
if (cleaned === "/new") {
  if (event.chatType !== "p2p" && this.opts.account.requireMention) {
    // 群里 + 默认 mention 模式 → 拒绝引导
    return
  }
  // p2p 永远允许;group + requireMention=false 允许(免@ 模式)
  // 清 session + reply 区分文案
}
```

**reply 文案两种**:
- p2p:`✅ 已开启新对话`
- group + 免@:`✅ 已开启新对话(群 session 已清,影响所有成员)`

**拒绝文案**(group + requireMention=true):
```
⚠️ 群里使用 /new 需先开启「允许 AI 免@ 读取群里所有信息」
   (DeskFox 设置 → 飞书桥接 → 选此账号 → 编辑 → 高级能力)
```

### 2. GUI checkbox 语义反转 + 默认改关

UI 层反转 — 后端 `requireMention` 字段 + 默认值 + zod schema 全不动:

```tsx
// checkbox 显示语义是后端的反转
<input type="checkbox"
  checked={!requireMention()}                    // 后端 true → UI 不勾
  onChange={(e) => setRequireMention(!e.currentTarget.checked)}  // UI 勾 → 后端 false
/>
```

- 后端默认 `requireMention: z.boolean().default(true)` → UI 默认不勾 ✓
- 视觉一致:"高级能力" 两项都默认不勾 ✓
- 老用户 0 行为变化(后端语义不变)

### 3. i18n key 改名 `requireMention.*` → `allowReadAll.*`

key 跟 UI 文案语义对齐(不跟后端字段对齐),三语言同步:

| 语言 | 新 label |
|---|---|
| zh | 允许 AI 免@ 读取群里所有信息 |
| zht | 允許 AI 免@ 讀取群組裡所有訊息 |
| en | Allow AI to read all group messages without @ mention |

**hint 改写** 加 /new 群里说明:
- 改"默认开启" → "默认关闭"
- 加 ② 项说明:任一成员可发 `/new` 在群里开新对话(影响所有人)
- 飞书后台前置配置说明保留(`im.message.receive_v1` 订阅范围 / `im:message` 权限 / 重新发布)

### 4. 行业调研支撑 — channel-as-workspace 场景 /new 行业普遍提供

(调研结果详 1-spec)
- **Slack / Teams**:无 `/new`,thread 边界自然切分,不适用我们场景
- **Discord per-channel LLM bot**:`/reset` 标配,部分 OSS 加 admin 门控
- **我们的场景** = `requireMention=false` 时 = channel-as-workspace = 跟 Discord per-channel 1:1 对应
- 选**方案 C**(无门控):user 主动开 `requireMention=false` 隐含信任群成员,"影响所有成员"提示防误清

## 测试

### 改造 + 新增 3 case

**改造的 case**(原"群聊 /new → 拒绝,session 不清"):
- 测试 condition 改为 `requireMention=true(默认)`
- 断言文案改为"允许 AI 免@ 读取群里所有信息" / "高级能力"
- 期望行为不变(拒绝 + session 保留)

**新加 2 case**:
1. **群聊 + requireMention=false + /new → 清 session + 提示"影响所有成员"**:
   - 构造 `account = { requireMention: false }`
   - send `chatType=group + /new`
   - 断言:session 已清(`store.get → undefined`)/ reply 含"已开启新对话"和"影响所有成员"/ ack 未触发(早退)

2. **群聊 + requireMention=false + @bot /new → strip mention 后命中清 session**:
   - 同上但 text 含 `@_user_1 /new` + mentions 含 bot
   - 断言:strip 后等于 `/new` → 走允许分支 → 清 session + reply 含"影响所有成员"

### makeAccount 默认值修正

加 `requireMention: true` 跟 `config-schema.ts` zod schema default 对齐。原来 fixture 没设这个字段,新加的群里 /new 测试会因 `account.requireMention === undefined` 漏判 → 修法是显式 set true。

### 套件状态

- typecheck:16/16
- adapter-feishu-lark 套件:507/507(原 505 + 新 2 - 改 0 = 507)

## 三铁律走流程

| 步骤 | 状态 |
|---|---|
| 开 feat 分支 `feat/feishu-group-new-cmd-and-mention-rename` | ✅ |
| 本地 commit 不动主分支 | ✅ |
| 合并主分支 user 同意 | (待 user 拍)|
| 推送主分支 user 同意 | (待 user 拍)|

## 实测建议

build dev .app 装 `/Applications/DeskFox Dev.app` 后:

### GUI 反转测试

1. 打开 DeskFox → Settings → 飞书桥接 → 选某账号 → 编辑
2. 看到 "高级能力" 段两项 checkbox:
   - 第一项"允许 AI 自动创建新群" — 默认不勾(无变化)
   - **第二项**"允许 AI 免@ 读取群里所有信息" — **默认不勾**(对应 `requireMention=true` 老行为)
3. 老 user 看 GUI 应该感觉"checkbox 反过来了" — 但实际功能不变(因为后端语义未变)

### /new 行为测试

| 场景 | 操作 | 预期 |
|---|---|---|
| p2p /new | 私聊发 `/new` | ✅ 已开启新对话 |
| group + 第二项 checkbox 不勾(默认)+ /new | 群里发 `/new` | ⚠️ 拒绝 + 引导开启第二项 checkbox |
| group + 第二项 checkbox 勾上(免@)+ /new | 群里发 `/new`(注:先在飞书后台改订阅范围,bot 才能收到非@消息) | ✅ 已开启新对话(群 session 已清,影响所有成员)|
| group + 免@ + @bot /new | 群里发 `@bot /new` | 同上 |

## 风险 / 已知限制

1. **老用户视觉变化**:GUI 上 checkbox 反过来,可能短暂困惑;实际后端行为完全一致 0 回归。CLAUDE.md 立项无 user 反馈说反过来更直觉,但 user 拍板视觉一致优先于历史一致
2. **方案 C 无门控**:群里任意成员都能触发 /new;场景信任度高(user 主动开 requireMention=false = 选择 channel-as-workspace = 协作场景)。如果真撞误清,backlog 留 admin 门控 / confirm card
3. **i18n key 改名**:旧 bundle 用旧 key 不会崩(SolidJS i18n fallback 到 key 字面值),只是看到 key string 而非翻译;next bundle 同步换 key + 调用,无 staleness 风险
4. **`/group` 群聊禁用未变**:本 feat 只改 `/new`,`/group` 仍只在 p2p 工作。两者设计意图不同(`/group` 是创建新群所以在私聊更合理;`/new` 是清当前 session 群里也有意义)

## 回退方法

`git revert <主 commit 092fd106b>` 一次性退回 — 代码改动跨 6 文件但都是同 feat 范围,revert 干净。
i18n key 恢复 `requireMention.*` 老命名,GUI 反转回老 checkbox label,/new 群里恢复"仅支持私聊"拒绝。

## 关联

- 上游:
  - `feishu-bridge-light`(2026-05-23):`/new` 引入,p2p only
  - `feishu-group-mention-policy`(2026-05-24):`requireMention` 字段 + GUI + i18n
  - `feishu-group-slash-command`(2026-05-24):`/group` 引入,验证 slash command 模式
- 行业调研依据:Discord per-channel LLM bot OSS 实践 / Slack & Teams thread 隐喻 / [Slack Context Management 官方 docs](https://docs.slack.dev/ai/agent-context-management/) / [MS Copilot Studio in Teams blog](https://microsoft.github.io/mcscatblog/posts/copilot-studio-teams-deployment-ux/)
- 留 backlog:
  - admin / bot owner / allowlist 门控(方案 A,飞书"群主"获取复杂,先不上)
  - confirmation card 二次确认(方案 B,~30 行,真撞误清案例再上)
  - `/list-group` / `/leave-group` 等扩展 slash command(罕见需求,等真需要)
