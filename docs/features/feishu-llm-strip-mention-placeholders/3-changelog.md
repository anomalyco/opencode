---
feat-id: feishu-llm-strip-mention-placeholders
status: done
related: ./3-changelog.md
---

# feishu-llm-strip-mention-placeholders — 3-changelog

> **状态**:✅ 已落地(2026-05-24)
> **commit hash**:`<本笔>`
> **规模**:Tiny(1 行代码改 + 2 单测 + 注释,纯 bug fix)

## 一句话

修自 `feishu-bridge-light` 起的潜在 bug — `message-pipeline.handle()` 把 raw text(含 `@_user_1` 飞书 mention 占位符)传给 `runOpencode`,LLM 看到占位符把它当**另一个联系人**,reply 出现"我不是 @_user_1,我是 opencode 的 AI 助手"等幻觉。改传 stripMentions 后的 `cleaned` text。

## bug-repro(2026-05-24,user 实测)

**case 1**(灵狐🦊-Mac bot,p2p 私聊):
- user 发:"**@灵狐🦊-Mac 说句话**"
- bot 实际收到 LLM input:"**@_user_1 说句话**"(`@bot` 飞书内部表示为 `@_user_N` 占位符)
- bot reply:"**我不是 @_user_1**,我是 opencode 的 AI 助手。有什么我可以帮你的吗?"

**case 2**(DeskFox-Mac bot,test030 群):
- user 发:"**@DeskFox-Mac 可以开始沟通了吗?在群里**"
- bot 实际收到 LLM input:"**@_user_1 可以开始沟通了吗?在群里**"
- bot reply:"...这条消息看起来是发给飞书群里某位联系人 (`@_user_1`) 的,而不是给我的指令。你是想让我帮你通过飞书发送这条消息吗?"

**根因**:`message-pipeline.ts:321` 算了 `cleaned = stripMentions(text, event.mentions)`,但 `handle()` 后续调 `runOpencode(sessionID, text, ...)` 时传的是 **raw `text`** 而非 `cleaned`。stripMentions 的成果只用在 `/new` slash command 检测和 CREATE_GROUP intent 路径,**LLM 输入路径漏了**。

这个 bug **自 `feishu-bridge-light`(2026-05-23 stripMentions 引入)起就存在**,但只有在 user 实际 @ bot 后期才暴露(LLM 之前可能没用 @ 输入触发,或者 LLM 蒙过了)。

## 修法

`message-pipeline.ts:483` 一行改:

```diff
-      reply = await this.runOpencode(sessionID, text, this.opts.account.agent)
+      reply = await this.runOpencode(sessionID, cleaned, this.opts.account.agent)
```

+ 段 FORK 注释解释。

## 改动文件

| 文件 | 净行数 | 改动 |
|---|---|---|
| `packages/adapter-feishu-lark/src/feishu/message-pipeline.ts` | +4 | `text` → `cleaned`(1 行)+ 3 行 FORK 注释 |
| `packages/adapter-feishu-lark/src/feishu/__tests__/message-pipeline.test.ts` | +37 | 2 bug-repro 单测(群 + p2p 场景)+ 验证 capturedText 不含 `@_user_N` 占位符 |

## 测试

- 2 bug-repro 单测先写(failed 复现)→ 修代码 → pass(485/485 全 adapter 套件全过)
- 16/16 bun run typecheck monorepo 全过

### 测试 case 详情

```ts
test("group + bot @ → LLM 收到的 text 已 strip mention 占位符(bug-repro)", async () => {
  const pipeline = makePipeline({ requireMention: true, botName: "DeskFox-Mac" })
  let capturedText: string | undefined
  fakes.opencodeClient.session.promptAsync = async (args: any) => {
    capturedText = args.body?.parts?.[0]?.text
    return { data: {} } as any
  }
  void pipeline.testHandle(
    makeEvent({
      chatType: "group",
      content: JSON.stringify({ text: "@_user_1 说句话" }),
      mentions: [{ key: "_user_1", name: "DeskFox-Mac", openId: "ou_bot" }],
    }),
  )
  await new Promise((r) => setTimeout(r, 100))
  expect(capturedText).toBe("说句话")
  expect(capturedText).not.toContain("@_user_1")
})
```

## 三铁律走流程

| 步骤 | 状态 |
|---|---|
| 开 feat 分支 `feat/feishu-llm-strip-mention-placeholders` | ✅ |
| 本地 commit 不动 main | ✅ |
| → main merge user 同意 | (待 user 拍)|
| → origin/main push user 同意 | (待 user 拍)|

## 回退方法

`message-pipeline.ts:483` 改回 `text`:

```bash
git revert <commit-hash>
```

行为退回到 bug 状态(LLM 收 raw text 含 `@_user_N` 占位符)。

## 关联

- 上游 stripMentions 引入:`feishu-bridge-light`(2026-05-23,`reply-actions.ts:29`)
- /new 路径已用 cleaned:`message-pipeline.ts:322`(`if (cleaned === "/new")`)— 修对了
- CREATE_GROUP intent 路径已用 cleaned:`message-pipeline.ts:348` — 修对了
- **LLM dispatch 路径漏修**:`message-pipeline.ts:483` 是本笔修的
