---
feat-id: feishu-bridge-light
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-bridge-light — 2-plan(实施计划 v2)

> **基于**:[1-spec.md](./1-spec.md) v2
> **分支策略**:`main → feat/feishu-bridge`(merge 拉齐 main,含已 push 的 401-fix + e2e-mock + ship-dev)→ `feat/feishu-bridge-light`
> **总工期**:~4.5 天(v1 估的 3 天偏紧;按 v2 修正后的真实工作量重估)

---

## Phase 0:基线同步(0.2 天)

### 前置事实(2026-05-23 核对)

- `main` HEAD `98e3bb531`,跟 `origin/main` 完全同步 ✅
- 401-fix(`262a353f8` / `49c95852d` / `f1bd32503`)已在 main ✅
- `feat/feishu-bridge` HEAD `3e1996bf9`(本 feat v2 doc 的 commit),**落后 main 13 commit**,需 merge 拉齐

### 操作

```bash
cd /Volumes/ExtSSD/opencode-fork
git checkout feat/feishu-bridge
git merge main          # 拉齐 main 上的 401-fix + e2e-mock W1-W3 + ship-dev + e2e-bug-repro
# 解冲突(预计 docs/features/INDEX 类小冲突)
git checkout -b feat/feishu-bridge-light
```

### 验收

- [ ] `feat/feishu-bridge-light` HEAD 包含 commit `262a353f8`(401-fix)
- [ ] `feat/feishu-bridge-light` HEAD 包含 commit `352f90991`(e2e-mock W3 done)
- [ ] `packages/adapter-feishu-lark/` 下所有现有测试通过(`bun test packages/adapter-feishu-lark`)

### commit

无(只是 merge + checkout,无新代码)

---

## Phase 1:`/new` 指令(0.3 天)

### 改动文件

| 文件 | 改动 |
|------|------|
| `src/feishu/reply-actions.ts`(新) | 新增 `stripMentions(text, mentions)` 纯函数 |
| `src/feishu/__tests__/reply-actions.test.ts`(新) | `stripMentions` 单测(5 case:空 / 单 / 多 / 前缀 / 中缀) |
| `src/feishu/message-pipeline.ts`(改) | `handle()` 在 text 解析后、ack 之前加 `/new` 早退分支 |
| `src/feishu/__tests__/message-pipeline.test.ts`(改) | 加 2 个集成测:私聊 `/new` 清 session + 群聊 `/new` 拒绝 |

### 关键实现片段

`message-pipeline.ts` 中 `handle()` 文本解析后(约 line 192 之后)插入:

```typescript
const cleaned = stripMentions(text, event.mentions)
if (cleaned === "/new") {
  if (event.chatType !== "p2p") {
    await this.sendFeishuText(event.chatId, "⚠️ /new 仅支持私聊(群里清会影响全员)")
    return
  }
  // 清三处:disk + chatToSession + sessionToChat
  const sessionID = this.chatToSession.get(event.chatId)
  this.opts.chatSessionStore.delete(this.opts.accountId, event.chatId)
  this.chatToSession.delete(event.chatId)
  if (sessionID) this.sessionToChat.delete(sessionID)
  await this.sendFeishuText(event.chatId, "✅ 已开启新对话")
  console.log(`[pipeline ${this.opts.accountId}] /new cleared session for chat=${event.chatId}`)
  return
}
```

### 测试样例

```typescript
// reply-actions.test.ts
test("stripMentions: @bot /new → /new", () => {
  const out = stripMentions("@_user_1 /new", [{ key: "_user_1", name: "Bot", openId: "ou_bot" }])
  expect(out).toBe("/new")
})

// message-pipeline.test.ts
test("/new 私聊触发 sessionStore.delete", async () => {
  const pipeline = makePipeline({ chatType: "p2p" })
  await pipeline.testHandle(makeEvent({ text: "/new" }))
  expect(fakes.sessionStore.deletedKeys).toContainEqual(["acc1", "oc_chat_x"])
  expect(fakes.larkClient.sentMessages[0].content).toContain("已开启新对话")
})
```

### commit

```
feat(feishu-bridge-light): /new resets session in p2p chat [feat: feishu-bridge-light]
```

---

## Phase 2:文件 / 截图回传(1.5 天)

### Sub-Phase 2.1:纯函数模块(0.5 天)

| 文件 | 改动 |
|------|------|
| `src/feishu/reply-actions.ts`(扩) | 加 `parseAttachMarkers(text)`、`classifyAttachment(path)` |
| `src/feishu/__tests__/reply-actions.test.ts`(扩) | 加 12 个 case 覆盖 marker 解析 + 类型分流 + 路径白名单 |

**classifyAttachment 关键逻辑**:
```typescript
const WORKSPACE_ROOT = join(homedir(), ".opencode", "feishu-workspace")
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".ico"])
const FILE_TYPE_MAP: Record<string, LarkFileType> = {
  ".pdf": "pdf", ".doc": "doc", ".xls": "xls", ".ppt": "ppt", ".mp4": "mp4", ".opus": "opus",
}

export function classifyAttachment(path: string):
  | { kind: "image" }
  | { kind: "file"; fileType: LarkFileType }
  | { kind: "reject"; reason: string } {
  if (!isAbsolute(path)) return { kind: "reject", reason: "非绝对路径" }
  const norm = resolve(path)
  if (!norm.startsWith(WORKSPACE_ROOT + sep)) return { kind: "reject", reason: "在 workspace 外" }
  const ext = extname(norm).toLowerCase()
  if (IMAGE_EXTS.has(ext)) return { kind: "image" }
  return { kind: "file", fileType: FILE_TYPE_MAP[ext] ?? "stream" }
}
```

### Sub-Phase 2.2:上传 IO 模块(0.5 天)

| 文件 | 改动 |
|------|------|
| `src/feishu/file-uploader.ts`(新) | `uploadImage` / `uploadFile` / `sendImageMessage` / `sendFileMessage` |
| `src/feishu/__tests__/file-uploader.test.ts`(新) | 用 fake larkClient(同 permission-card.test.ts 模式)验调用形态 |

**uploadImage 关键实现**:
```typescript
const MAX_IMAGE_BYTES = 10 * 1024 * 1024  // 10MB
const MAX_FILE_BYTES = 30 * 1024 * 1024   // 30MB

export async function uploadImage(client: Client, path: string): Promise<string> {
  const size = statSync(path).size
  if (size > MAX_IMAGE_BYTES) throw new Error(`image ${path} ${size}B > 10MB`)
  const res = await client.im.v1.image.create({
    data: { image_type: "message", image: createReadStream(path) },
  })
  const key = res?.image_key
  if (!key) throw new Error("image.create returned no image_key")
  return key
}
```

### Sub-Phase 2.3:pipeline 串联(0.5 天)

| 文件 | 改动 |
|------|------|
| `src/feishu/message-pipeline.ts`(改) | reply 拿到后,先 `processAttachments(reply)` 再 `sendFeishuText` 剩余文字 |
| `src/feishu/message-pipeline.ts`(改) | 扩写 `FEISHU_SESSION_SYSTEM_PROMPT` 加 § "ATTACH marker 协议:回复里写 `[ATTACH:绝对路径]` 系统会自动上传到飞书,路径必须在 ~/.opencode/feishu-workspace 内,图片 ≤10MB 文件 ≤30MB" |
| `src/feishu/__tests__/message-pipeline.test.ts`(扩) | 加 4 个集成测:ATTACH 命中 image / ATTACH 命中 file / ATTACH 越界拒绝 / ATTACH size 超限拒绝 |

**processAttachments 流程**(在 `handle()` 拿到 reply 之后插入):
```typescript
const { paths, cleanText } = parseAttachMarkers(reply)
const warnings: string[] = []
for (const p of paths) {
  const cls = classifyAttachment(p)
  if (cls.kind === "reject") {
    warnings.push(`⚠️ 拒绝发送 ${p}:${cls.reason}`)
    continue
  }
  try {
    if (cls.kind === "image") {
      const key = await uploadImage(this.larkClient, p)
      await sendImageMessage(this.larkClient, event.chatId, key)
    } else {
      const key = await uploadFile(this.larkClient, p, cls.fileType)
      await sendFileMessage(this.larkClient, event.chatId, key)
    }
  } catch (e) {
    warnings.push(`⚠️ 发送 ${p} 失败:${(e as Error).message}`)
  }
}
const finalText = [cleanText.trim(), ...warnings].filter(Boolean).join("\n\n")
if (finalText) await this.sendFeishuText(event.chatId, finalText)
```

### commit

```
feat(feishu-bridge-light): [ATTACH:path] marker — upload image/file to feishu [feat: feishu-bridge-light]
```

---

## Phase 3:自动建群(opt-in)(2.0 天)

### Sub-Phase 3.1:config + 默认值(0.2 天)

| 文件 | 改动 |
|------|------|
| `src/core/config-schema.ts` | `FeishuAccountSchema` 加 `enableAutoGroupCreate: z.boolean().default(false)` |
| `src/feishu/account-store.ts` | `normalizeAccount` 加默认值 |
| `src/__tests__/config-schema.test.ts` | 加 case 验默认 false + 显式 true |

### Sub-Phase 3.2:permission-card 扩展(0.5 天)

| 文件 | 改动 |
|------|------|
| `src/feishu/permission-card.ts` | `PermissionCardActionValue` 加 `create_group_confirm` 分支;`parseCardAction` 加对应解析;`PermissionCardController` 加 `startCreateGroupConfirm` + `handleCreateGroupConfirmReply` |
| `src/feishu/__tests__/permission-card.test.ts` | 加 3 case:发卡片 / 点确认 / 点拒绝 |

**confirm 卡片结构**(沿用 buildPermissionCard 模式):
```typescript
function buildCreateGroupConfirmCard(chatName: string, requestID: string): InteractiveCard {
  return {
    config: { update_multi: true, wide_screen_mode: true },
    header: { title: { tag: "plain_text", content: `🆕 创建群【${chatName}】?` }, template: "blue" },
    elements: [
      { tag: "div", text: { tag: "lark_md", content: `AI 想自动创建群 **${chatName}**,你点确认才会建。` } },
      { tag: "action", actions: [
        { tag: "button", text: { tag: "plain_text", content: "✅ 确认" },
          value: { kind: "create_group_confirm", requestID, reply: "yes" }, type: "primary" },
        { tag: "button", text: { tag: "plain_text", content: "❌ 拒绝" },
          value: { kind: "create_group_confirm", requestID, reply: "no" }, type: "danger" },
      ]},
    ],
  }
}
```

### Sub-Phase 3.3:建群 IO + 邀请链接(0.5 天)

| 文件 | 改动 |
|------|------|
| `src/feishu/group-creator.ts`(新) | `createGroup(client, name, userOpenIds)`、`getShareLink(client, chatId)` |
| `src/feishu/__tests__/group-creator.test.ts`(新) | fake larkClient 验调用形态 + 链接失败兜底 |

**createGroup 实现**:
```typescript
export async function createGroup(
  client: Client,
  name: string,
  userOpenIds: string[],
): Promise<{ chatId: string }> {
  const res = await client.im.v1.chat.create({
    data: {
      name,
      chat_type: "public",
      user_id_list: userOpenIds.length > 0 ? userOpenIds : undefined,
    },
    params: { user_id_type: "open_id" },
  })
  const chatId = res?.data?.chat_id
  if (!chatId) throw new Error("chat.create returned no chat_id")
  return { chatId }
}

export async function getShareLink(client: Client, chatId: string): Promise<string | null> {
  try {
    const res = await client.im.v1.chat.link({
      data: { validity_period: "week" },
      path: { chat_id: chatId },
    })
    return res?.data?.share_link ?? null
  } catch (e) {
    console.warn(`[group-creator] chat.link failed for ${chatId}:`, (e as Error).message)
    return null  // 团队群 / 权限不足 → 降级到 chat_id
  }
}
```

### Sub-Phase 3.4:pipeline 串联 + system prompt(0.5 天)

| 文件 | 改动 |
|------|------|
| `src/feishu/message-pipeline.ts` | `reply-actions.ts` 加 `parseCreateGroupMarkers`;`handle()` reply 后处理:opt-in + p2p 才触发 confirm,否则只 strip |
| `src/feishu/message-pipeline.ts` | `FEISHU_SESSION_SYSTEM_PROMPT` **按 account.enableAutoGroupCreate 动态拼**;启用时加 § "CREATE_GROUP marker 协议:回复里写 `[CREATE_GROUP:群名]` 系统会问 user 是否建群,确认后自动建并拉 user 进群" |
| `src/feishu/__tests__/message-pipeline.test.ts` | 加 4 case:opt-in off marker 仅 strip / opt-in on 触发 confirm / 群聊触发被拒 / confirm 后 chat.create 调对 |

**动态 system prompt 拼接**(message-pipeline.ts 改):
```typescript
private getSystemPrompt(): string {
  const base = FEISHU_SESSION_SYSTEM_PROMPT_BASE
  const attach = ATTACH_MARKER_PROMPT  // 始终启用
  const createGroup = this.opts.account.enableAutoGroupCreate ? CREATE_GROUP_MARKER_PROMPT : ""
  return [base, attach, createGroup].filter(Boolean).join("\n\n")
}
// runOpencode 里把 system: FEISHU_SESSION_SYSTEM_PROMPT 改成 system: this.getSystemPrompt()
```

### Sub-Phase 3.5:确认后建群闭环(0.3 天)

`PermissionCardController.handleCreateGroupConfirmReply` 收到 confirm=yes:
- 调 `createGroup(larkClient, chatName, [senderOpenId])`
- 调 `getShareLink(larkClient, chatId)`
- 发飞书消息(成功:含链接;链接失败:含 chat_id)
- delete 原 confirm 卡片(同 permission-card.ts 现有 deleteCard 模式)

**待暂存**:`startCreateGroupConfirm` 时把 `chatName` + `senderOpenId` 存到 pending map(key=requestID),`handleCreateGroupConfirmReply` 读出来用 — 跟 permission-card 现有 pending map 模式一致。

### commit

```
feat(feishu-bridge-light): [CREATE_GROUP:name] marker — opt-in + confirm card + auto invite [feat: feishu-bridge-light]
```

---

## Phase 4:测试 + 文档收尾(0.5 天)

### 4.1 测试清单(全部应通过)

| 测试文件 | 用例数 |
|---|---|
| `reply-actions.test.ts`(新) | ~20 |
| `file-uploader.test.ts`(新) | ~8 |
| `group-creator.test.ts`(新) | ~6 |
| `chat-session-store.test.ts` | 已有(不动) |
| `permission-card.test.ts`(扩) | +3 |
| `message-pipeline.test.ts`(扩) | +10 |
| `config-schema.test.ts`(扩) | +2 |
| `__tests__` 总数 | ~50 净增加 |

### 4.2 文档

| 文件 | 改动 |
|------|------|
| `docs/features/feishu-bridge-light/3-changelog.md`(新) | 实施完毕记 commit hash + 测试统计 |
| `docs/features/feishu-bridge-light/1-spec.md` | status: draft → in-progress → done |
| `docs/features/INDEX.md`(若有) | 加 feishu-bridge-light 索引行 |

### commit

```
docs(feishu-bridge-light): 3-changelog + status done [feat: feishu-bridge-light]
test(feishu-bridge-light): integration smoke test all three markers [feat: feishu-bridge-light]
```

---

## 工期汇总

| Phase | 内容 | 工期 |
|-------|------|------|
| 0 | 基线同步(merge main 进 feat/feishu-bridge) | 0.2 天 |
| 1 | `/new` 私聊清 session | 0.3 天 |
| 2 | `[ATTACH:]` 图片 / 文件上传 | 1.5 天 |
| 3 | `[CREATE_GROUP:]` opt-in + confirm + 建群 + 邀请链接 | 2.0 天 |
| 4 | 测试 + 文档收尾 | 0.5 天 |
| **合计** | | **4.5 天** |

> 对比 v1 估的 3 天 → v2 增加 1.5 天,主要在:
> - Phase 0 新增(基线同步,v1 未提)
> - Phase 2 拆 image/file 两路 + 路径校验,v1 当一回事估
> - Phase 3 增加 opt-in config + confirm card + share_link API + system prompt 动态拼,v1 全没考虑

---

## 风险 / 兜底

| 风险 | 影响 | 兜底 |
|------|------|------|
| Phase 0 merge 大冲突 | Phase 1 延期 | 实际冲突大概率在 INDEX/changelog 行级,先评估再决定回退 |
| 飞书 `chat.link` 团队群拒绝 | G5 链接获取失败 | `getShareLink` catch 后返 null,降级显示 chat_id |
| LLM 不按格式输出 marker | feature 不触发 | system prompt 写清楚 + 测试期 dogfood 调 prompt |
| 大文件 stat 后 streaming 时仍 OOM | uploadImage/uploadFile 抛 | 当前 size 预检挡 10/30MB,留 future enhance 真 streaming |
| LLM 输出 marker 但 user 拒绝 confirm | 浪费 token | 已通过 strip marker 让 user 看到的回复干净;拒绝后不重试 |
| permission-card 现有 pending map 跟 confirm map key 冲突 | 卡片状态错乱 | 用不同 requestID 前缀(`perm-` vs `cg-`)隔离 |

---

## 实施顺序建议

按 Phase 0→1→2→3→4 严格顺序。其中 Phase 1 可独立 merge 进 main(单独 PR),给 user 早期体验 `/new`;Phase 2/3 可放同一 PR(共享 reply-actions / system prompt 改动)。

如果时间紧只做一部分:
- **MVP(0.5 天)**:Phase 0 + 1 → `/new` 上线
- **基本可用(2.0 天)**:Phase 0 + 1 + 2 → `/new` + 文件回传
- **完整版(4.5 天)**:全部
