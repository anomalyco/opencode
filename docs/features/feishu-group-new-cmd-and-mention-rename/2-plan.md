---
feat-id: feishu-group-new-cmd-and-mention-rename
status: spec
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-group-new-cmd-and-mention-rename — 2-plan(实施计划)

## 规模:Medium- ~60 行代码 + ~30 行测试 + 三文档 / 5 文件触动

## 实施顺序

### Phase 1 — `message-pipeline.ts` `/new` 群里启用条件(~10 行)

`handle()` 内 `/new` 分支(line 309-323)改写:

```ts
if (cleaned === "/new") {
  // p2p 永远允许;group 只在 requireMention=false 时允许(channel-as-workspace 模式)
  // [feat: feishu-group-new-cmd-and-mention-rename] 2026-05-25
  if (event.chatType !== "p2p" && this.opts.account.requireMention) {
    await this.sendFeishuText(
      event.chatId,
      "⚠️ 群里使用 /new 需先开启「允许 AI 免@ 读取群里所有信息」(DeskFox 设置 → 飞书桥接 → 选此账号 → 编辑 → 高级能力)",
    )
    return
  }
  const sessionID = this.chatToSession.get(event.chatId)
  this.opts.chatSessionStore.delete(this.opts.accountId, event.chatId)
  this.chatToSession.delete(event.chatId)
  if (sessionID) this.sessionToChat.delete(sessionID)
  const replyText = event.chatType === "p2p"
    ? "✅ 已开启新对话"
    : "✅ 已开启新对话(群 session 已清,影响所有成员)"
  await this.sendFeishuText(event.chatId, replyText)
  console.log(
    `[pipeline ${this.opts.accountId}] /new cleared session for chat=${event.chatId} (sessionID=${sessionID ?? "none"}, chatType=${event.chatType})`,
  )
  return
}
```

### Phase 2 — GUI checkbox 反转(`feishu-edit-account-dialog.tsx`,~15 行)

**2.1** `createSignal` 注释 + 双向绑定改:

```ts
// [feat: feishu-group-new-cmd-and-mention-rename] 2026-05-25
// GUI 显示"允许免@ 读取所有信息"语义反转,后端字段 requireMention 不变。
// checkbox.checked = !requireMention,save 时 requireMention = !checkbox.checked。
const [requireMention, setRequireMention] = createSignal(
  props.currentRequireMention ?? true,  // 后端默认 true(bot 只回 @)
)
```

**2.2** checkbox 元素:

```tsx
{/* 允许 AI 免@ 读取群里所有信息 [feat: feishu-group-new-cmd-and-mention-rename] 2026-05-25 */}
<div class="flex flex-col gap-1 self-stretch">
  <label class="flex items-center gap-2 cursor-pointer select-none">
    <input
      type="checkbox"
      checked={!requireMention()}
      onChange={(e) => setRequireMention(!e.currentTarget.checked)}
    />
    <span class="text-14-medium">
      {language.t("settings.feishu.edit.allowReadAll.label")}
    </span>
  </label>
  <p class="text-13-regular text-text-weak pl-6">
    {language.t("settings.feishu.edit.allowReadAll.hint")}
  </p>
</div>
```

**2.3** save 调用不变(`requireMention: requireMention()` 仍是后端字段语义)

### Phase 3 — i18n 改名(~6 行 × 3 文件)

**3.1** zh.ts:

```ts
"settings.feishu.edit.allowReadAll.label": "允许 AI 免@ 读取群里所有信息",
"settings.feishu.edit.allowReadAll.hint":
  "默认关闭:bot 群里只回 @ 自己的消息。\n开启后:① bot 响应群里所有消息(适合 1 群 1 项目独占用法);② 群任一成员可发 `/new` 在当前群开新对话(清 session,**影响所有人**)。\n⚠️ 开启前需在飞书后台改:open.feishu.cn → 选 bot → 事件配置 `im.message.receive_v1` 订阅范围改「全部群消息」+ 权限管理申请 `im:message` + 重新发布。否则飞书不推非 @ 消息,本开关无效。",
```

删旧 key:
- `settings.feishu.edit.requireMention.label`
- `settings.feishu.edit.requireMention.hint`

**3.2** zht.ts:

```ts
"settings.feishu.edit.allowReadAll.label": "允許 AI 免@ 讀取群組裡所有訊息",
"settings.feishu.edit.allowReadAll.hint":
  "預設關閉:bot 群組裡只回 @ 自己的訊息。\n開啟後:① bot 回應群組裡所有訊息(適合 1 群 1 專案獨佔用法);② 群組任一成員可發送 `/new` 在當前群組開啟新對話(清空 session,**影響所有人**)。\n⚠️ 開啟前需在飛書後台改:open.feishu.cn → 選 bot → 事件設定 `im.message.receive_v1` 訂閱範圍改「全部群組訊息」+ 權限管理申請 `im:message` + 重新發布。否則飛書不推送非 @ 訊息,本開關無效。",
```

**3.3** en.ts:

```ts
"settings.feishu.edit.allowReadAll.label":
  "Allow AI to read all group messages without @ mention",
"settings.feishu.edit.allowReadAll.hint":
  "Default off: bot only responds to @ mentions in groups.\nWhen on: ① bot responds to all group messages (1 group = 1 project workspace model); ② any group member can send `/new` to start a new conversation in the current group (clears session, **affects everyone**).\n⚠️ Before enabling, configure on Feishu admin: open.feishu.cn → select bot → Events config `im.message.receive_v1` subscription scope to 'All group messages' + permissions `im:message` + re-publish. Otherwise Feishu won't push non-@ messages and this toggle has no effect.",
```

### Phase 4 — 测试(~30 行)

**4.1** `message-pipeline.test.ts` 新加 `/new` describe 块的 case(或在现有 `/new` describe 下补):

- p2p `/new` → 清 session + reply "已开启新对话"(无"群"提示)
- group + `requireMention=true` + `/new` → reply 拒绝引导,**不清 session**
- group + `requireMention=false` + `/new` → 清 session + reply "已开启新对话(群 session 已清,影响所有成员)"

**4.2** 不需要改 reply-actions / account-store 测试(后端字段不动)

### Phase 5 — 收尾

- `bun run typecheck` 16/16
- `bun test packages/adapter-feishu-lark/`(目标:505 + 3 新 = 508 全过)
- 3-changelog + INDEX 状态 spec → done + 改动日志 entry
- (build + 装 .app 让 user 实测)

## commit 链(预期)

| # | commit message |
|---|---|
| 1 | `docs(feishu-group-new-cmd-and-mention-rename): 1-spec + 2-plan + INDEX entry [feat: feishu-group-new-cmd-and-mention-rename]` |
| 2 | `feat(feishu-group-new-cmd-and-mention-rename): /new 群里启用 + GUI checkbox 反转 + i18n 改名 [feat: feishu-group-new-cmd-and-mention-rename]` |
| 3 | `docs(feishu-group-new-cmd-and-mention-rename): 3-changelog + INDEX done + 改动日志 [feat: feishu-group-new-cmd-and-mention-rename]` |

## 风险 / 注意点

| 风险 | 缓解 |
|---|---|
| GUI 反转后老 user 看 GUI 跟之前显示不一样(原来勾的现在不勾)| 实际后端行为完全一致(bot 仍只回 @),GUI 只是描述更准确;无 bug 体验,文案明确"默认关闭"|
| i18n key 改名导致老 bundle stale | bundle 同步打包,无 staleness;若部分 user 升级期间撞到 key 不一致,SolidJS i18n fallback 到 key 字面值不崩 |
| 群里任意成员 `/new` 误触 | 方案 C 取舍:user 主动开 requireMention=false = 主动选择 channel-as-workspace = 信任群成员;reply 含"影响所有成员"提示防误清;backlog 留 admin 门控 / confirm card 后续按需上 |
| /new 群里清完 bot 不立刻发后续消息,user 不知道下条会从空 session 开始 | reply "✅ 已开启新对话(群 session 已清,影响所有成员)" 显式告知 |
| sidecar / plugin 重建陷阱(`need_rebuild` 时间戳范围窄)| 老问题,本 feat 改 adapter-feishu-lark/src 后,build 前手动 `rm packages/desktop/src-tauri/sidecars/* && rm packages/branding/plugin/feishu-bridge/dist/plugin.js` 强制重建 |

## 实施中决策点(开发中 append)

(空 — 开发中遇到再补)
