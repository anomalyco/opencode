---
feat-id: feishu-bridge-light
status: done
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-bridge-light — 1-spec(轻量版,飞书桥接增强)

> **状态**:📝 撰写中 v2
> **分支**:`feat/feishu-bridge`(落后 main 13 commit,先 merge 拉齐 — 含 main 上已有的 401-fix / e2e-mock / ship-dev 等)→ `feat/feishu-bridge-light` 子分支
> **来源**:飞书桥接需求讨论(2026-05-22 v1 草稿,2026-05-23 调研后 v2 修订)
> **v2 修订说明**:v1 多处 API 假设错配 + 安全漏洞,详见 § 7"v1→v2 变更"

---

## 1. 触发原因

feishu-bridge 基础功能已完成(多账号 / 群聊 session / 权限卡片 / 持久化),但缺三个提升流畅度的功能:

1. **`/new` 单聊切话题**:私聊里想换话题,当前 session 上下文干扰
2. **文件 / 截图回传**:AI 生成的本地图片或文档能发回飞书
3. **AI 触发自动建群**(opt-in,默认关):AI 识别需要新群聊时自动创建

---

## 2. 需求 / 验收标准

### 2.1 `/new` 指令 — 私聊切话题

| # | 需求 | 验收标准 |
|---|---|---|
| N1 | `/new` 检测 | `stripMentions(text).trim() === '/new'` 时不进 chatQueue,直接清 session |
| N2 | session 清理 | 调 `chatSessionStore.delete(accountId, chatId)`(已存在)+ 同步清 in-memory `chatToSession.delete(chatId)` 和反查 `sessionToChat.delete(sessionID)` |
| N3 | 用户提示 | 清完发飞书消息:"✅ 已开启新对话" |
| N4 | 群聊不允许 | `event.chatType === 'group'` 时 `/new` 改回"⚠️ /new 仅支持私聊(群里清会影响全员)" |
| N5 | @-mention 兼容 | 群里 `@bot /new`(虽然 N4 会拒)和私聊里多余的 mention 文本都要正确剥离 |

**stripMentions 实现思路**:
```typescript
function stripMentions(text: string, mentions: ImMessageEvent["mentions"]): string {
  // 飞书 text 里 mention 形态为 "@_user_1 hello",mentions[].key === "@_user_1"
  let out = text
  for (const m of mentions) {
    out = out.replace(new RegExp(`@${m.key}\\s*`, "g"), "")
  }
  return out.trim()
}
```

**交互流程**:
```
User(私聊): /new
Pipeline: 检测到 /new → chatSessionStore.delete + chatToSession.delete + sessionToChat.delete
        → sendFeishuText("✅ 已开启新对话") → 下一条消息建新 session
```

### 2.2 文件 / 截图回传

> AI 在 reply 文本里嵌 `[ATTACH:/abs/path/to/file.ext]` marker,adapter regex 解析、上传飞书、从 reply text 里 strip 掉 marker 再发文字回飞书。

| # | 需求 | 验收标准 |
|---|---|---|
| F1 | marker 解析 | regex `/\[ATTACH:([^\]]+)\]/g` 抓全部路径;支持一次 reply 包含多个 ATTACH |
| F2 | 路径安全 | 路径必须是绝对路径且**位于 `~/.opencode/feishu-workspace/` 子树内**;不在则跳过此 marker,在最终回复尾部追加"⚠️ 拒绝发送外部路径 X(仅 workspace 内允许)" |
| F3 | 类型分流 | 按扩展名分流:`.jpg/.png/.gif/.webp/.bmp/.tiff/.ico` 走 `image.create`(≤10MB);其它走 `file.create`(≤30MB,file_type 见 F4) |
| F4 | file_type 映射 | 仅以下扩展名匹配 SDK 枚举:`.pdf→pdf`,`.doc→doc`,`.xls→xls`,`.ppt→ppt`,`.mp4→mp4`,`.opus→opus`;其它(`.docx/.xlsx/.pptx/.txt/.md/.zip/.tar.gz` 等)用 `"stream"` 兜底 |
| F5 | size 检查 | 上传前 `stat(path).size`,图片 > 10MB 或文件 > 30MB 拒绝(reply 尾部追加"⚠️ X 超出 size 限制") |
| F6 | 上传 + 发送 | 上传成功拿 `image_key` / `file_key` → `message.create({ msg_type: "image"/"file", content: JSON.stringify({ image_key | file_key }) })` |
| F7 | 错误兜底 | 单个 ATTACH 失败不影响其它;失败原因(API error message)追加到 reply 尾部"⚠️ 发送 X 失败:reason" |
| F8 | text 清洗 | strip 所有 `[ATTACH:...]` marker 后发剩余文字;若全部 strip 后 reply 为空,只发附件不发文字 |

**SDK 调用形态(真实)**:
```typescript
// 图片
const imgRes = await larkClient.im.v1.image.create({
  data: { image_type: "message", image: readStream(path) },
})
const imageKey = imgRes?.image_key
await larkClient.im.v1.message.create({
  params: { receive_id_type: "chat_id" },
  data: { receive_id: chatId, msg_type: "image", content: JSON.stringify({ image_key: imageKey }) },
})

// 文件
const fileRes = await larkClient.im.v1.file.create({
  data: { file_type: "pdf" | "doc" | "xls" | "ppt" | "mp4" | "opus" | "stream", file_name: basename(path), file: readStream(path) },
})
const fileKey = fileRes?.file_key
await larkClient.im.v1.message.create({
  params: { receive_id_type: "chat_id" },
  data: { receive_id: chatId, msg_type: "file", content: JSON.stringify({ file_key: fileKey }) },
})
```

**交互流程**:
```
User: 帮我生成这个数据的柱状图保存到 ./chart.png 并发给我
Claude: (用 shell/write tool 生成 ~/.opencode/feishu-workspace/chart.png)
        OK,柱状图已生成 [ATTACH:/Users/x/.opencode/feishu-workspace/chart.png]
Adapter: regex 解析 ATTACH → 检查路径在 workspace 内 ✓ → 检查 size ✓ → image.create → message.create(image)
        → strip marker → 发文字 "OK,柱状图已生成" 到飞书
```

### 2.3 自动建群(opt-in,默认关)

> AI 在 reply 文本里嵌 `[CREATE_GROUP:群名]` marker,**必须先经过 permission-card 用户二次确认**才创建。

| # | 需求 | 验收标准 |
|---|---|---|
| G1 | opt-in 配置 | `FeishuAccount.enableAutoGroupCreate: boolean`(默认 false);为 false 时 marker 仍 strip 但不触发建群 |
| G2 | marker 解析 | regex `/\[CREATE_GROUP:([^\]]+)\]/g` 抓群名 |
| G3 | 二次确认 | 触发时**复用 permission-card** 模式,发"创建群【X】?"卡片到原 chat,user 点【确认】才建,【拒绝】丢弃 |
| G4 | 拉人 | `chat.create({ data: { name, user_id_list: [event.senderOpenId], chat_type: "public" } })`(senderOpenId 缺失则不传 user_id_list,只 bot 在群里) |
| G5 | 邀请链接 | 建群成功后调 `chat.link({ data: { validity_period: "week" }, path: { chat_id } })`;成功 → 发"已创建群【X】,加入:" + share_link;失败(团队群 / 权限不足)→ 发"已创建群【X】,chat_id: ocxxx(链接获取失败:reason)" |
| G6 | marker strip | reply 文本里的 `[CREATE_GROUP:...]` 永远 strip 掉(无论是否触发建群) |
| G7 | 安全 | 仅 chat_type === 'p2p' 时允许触发(群里不准 AI 再建群);ENABLED + p2p 双条件 |

**permission-card 复用**:
- `permission-card.ts` 已有 `buildPermissionCard` 通用框架。建群确认走同样模式,新增一个 actionValue.kind = `"create_group_confirm"` 路由
- 不引入新依赖,扩展现有控制器即可

**交互流程**:
```
User(私聊): 帮我拉个群讨论这个需求
Claude: 好,我创建一个 [CREATE_GROUP:需求讨论]
Adapter: 解析到 marker → 检查 enableAutoGroupCreate=true 且 p2p ✓
        → 发 permission-card "创建群【需求讨论】?" + [✅ 确认][❌ 拒绝]
        → strip marker → 发文字 "好,我创建一个" 到飞书
User: (点【✅ 确认】)
Adapter: chat.create({ data: { name: "需求讨论", user_id_list: [senderOpenId] } })
        → chat.link 拿 share_link → 发 "已创建群【需求讨论】,加入: https://applink.feishu.cn/..."
```

---

## 3. 范围 / 不范围

### 3.1 范围

- ✅ `/new` 指令(私聊;群聊明确拒绝)
- ✅ `[ATTACH:path]` marker → 图片 / 文件上传发送(workspace 内白名单)
- ✅ `[CREATE_GROUP:name]` marker → 二次确认 + 建群拉人 + 邀请链接(opt-in)
- ✅ `FEISHU_SESSION_SYSTEM_PROMPT` 扩写(教 LLM 两个 marker 协议)
- ✅ `FeishuAccountSchema.enableAutoGroupCreate` config 字段
- ✅ 改动均在 `packages/adapter-feishu-lark/` 内

### 3.2 不范围

- ❌ 群聊 per-user session 隔离(架构改动,留 Large feat)
- ❌ AI 主动调"send-file"/"create-group" 作为 opencode tool(也是架构改动,marker 协议是 light 妥协方案)
- ❌ 唤醒 `dmPolicy` / `groupPolicy` 死配置(独立 feat,有自己的设计空间)
- ❌ OAuth / 多账号 / permission 卡片框架本身(已有)
- ❌ GUI 设置界面

---

## 4. 改动点

### 4.1 `src/feishu/message-pipeline.ts`(改)

| 改动位置 | 内容 |
|------|------|
| `handle()` 文本解析后 | 加 `/new` 早退分支(N1-N5) |
| `handle()` reply 发送前 | 加 reply 后处理:解析 ATTACH + CREATE_GROUP marker,执行操作,strip marker,再 sendFeishuText |
| `FEISHU_SESSION_SYSTEM_PROMPT` | 加 § "你可以在回复里嵌入以下 marker 触发系统操作:..." 教 LLM 两个 marker;若 `account.enableAutoGroupCreate === false` 则不教 CREATE_GROUP(避免 LLM 用了又被忽略) |

### 4.2 `src/feishu/reply-actions.ts`(新)

纯函数模块,放可单测的解析 / 路径校验逻辑:

| 导出 | 签名 | 用途 |
|------|------|------|
| `parseAttachMarkers(text)` | `(text) => { paths: string[]; cleanText: string }` | 解析 + strip |
| `parseCreateGroupMarkers(text)` | `(text) => { names: string[]; cleanText: string }` | 解析 + strip |
| `stripMentions(text, mentions)` | `(text, mentions) => string` | `/new` 检测用 |
| `classifyAttachment(path)` | `(path) => { kind: "image" \| "file" \| "reject"; reason?: string; fileType?: LarkFileType }` | 扩展名 → SDK 枚举映射 + workspace 路径白名单校验 + size 待 caller 查 |

### 4.3 `src/feishu/file-uploader.ts`(新)

IO 模块,封装飞书上传 API:

| 导出 | 签名 | 用途 |
|------|------|------|
| `uploadImage(larkClient, path)` | `(client, path) => Promise<string>` | 返回 image_key,size 超限抛 |
| `uploadFile(larkClient, path, fileType)` | `(client, path, fileType) => Promise<string>` | 返回 file_key,size 超限抛 |
| `sendImageMessage(larkClient, chatId, imageKey)` | — | 包 message.create |
| `sendFileMessage(larkClient, chatId, fileKey)` | — | 包 message.create |

### 4.4 `src/feishu/permission-card.ts`(改)

| 改动 | 内容 |
|------|------|
| `PermissionCardActionValue` 类型 | 加 `\| { kind: "create_group_confirm"; chatName: string; senderOpenId?: string }` 分支 |
| `parseCardAction` | 加 `kind === "create_group_confirm"` 分支返回 |
| 控制器 | 加 `startCreateGroupConfirm(chatId, chatName, senderOpenId)` + `handleCreateGroupConfirmReply` 方法 |

### 4.5 `src/core/config-schema.ts`(改)

| 改动 | 内容 |
|------|------|
| `FeishuAccountSchema` | 加 `enableAutoGroupCreate: z.boolean().default(false)` |

### 4.6 `src/feishu/account-store.ts`(改)

| 改动 | 内容 |
|------|------|
| `normalizeAccount` 默认值映射 | 加 `enableAutoGroupCreate: existing?.enableAutoGroupCreate ?? false` |

### 4.7 `src/feishu/chat-session-store.ts`

**不改** — `delete(accountId, chatId)` 已存在(chat-session-store.ts:73),已有测试覆盖。

---

## 5. 测试验收

| 测试 | 文件 | 类型 |
|------|------|------|
| `stripMentions` | `reply-actions.test.ts` | 单测:空 mentions / 单 mention / 多 mention / 前缀/中缀 |
| `parseAttachMarkers` | `reply-actions.test.ts` | 单测:0/1/N markers + 内嵌奇怪字符 |
| `parseCreateGroupMarkers` | `reply-actions.test.ts` | 同上 |
| `classifyAttachment` | `reply-actions.test.ts` | 单测:image / pdf / docx 兜底 stream / workspace 外 reject / 相对路径 reject |
| `/new` 私聊清 session | `message-pipeline.test.ts` 加 | 集成测:mock larkClient + sessionStore,验 delete 被调 + sendFeishuText 调"已开启新对话" |
| `/new` 群聊拒绝 | 同上 | mock chatType='group',验 sendFeishuText 调"⚠️ /new 仅支持私聊" |
| `[ATTACH:...]` 上传 | `message-pipeline.test.ts` 加 | mock larkClient.image.create + message.create,验调用顺序和参数 |
| `[CREATE_GROUP:...]` 二次确认 | `permission-card.test.ts` 加 | mock 触发 → 发卡片 → 模拟点确认 → 验 chat.create 调用 |
| 路径越界拒绝 | `message-pipeline.test.ts` 加 | reply 含 `[ATTACH:/etc/passwd]`,验未调 image.create,reply 含"⚠️ 拒绝发送外部路径" |

---

## 6. 依赖

| 依赖 | 状态 |
|------|------|
| `chatSessionStore.delete(accountId, chatId)` | ✅ 已存在 `chat-session-store.ts:73` |
| `larkClient.im.v1.image.create` | ✅ SDK 自带,本 feat 首次用 |
| `larkClient.im.v1.file.create` | ✅ SDK 自带,本 feat 首次用 |
| `larkClient.im.v1.message.create`(msg_type=image/file) | ✅ SDK 自带 |
| `larkClient.im.v1.chat.create` | ✅ SDK 自带,本 feat 首次用 |
| `larkClient.im.v1.chat.link` | ✅ SDK 自带,本 feat 首次用 |
| `PermissionCardController` 扩展 | 修改 `permission-card.ts` |
| `FEISHU_SESSION_SYSTEM_PROMPT` 扩写 | 修改 `message-pipeline.ts` 常量 |
| `FeishuAccountSchema.enableAutoGroupCreate` | 新增 config 字段 |

---

## 7. v1→v2 变更(关键修正)

| # | v1 错误 | v2 修正 |
|---|---|---|
| C1 | `chatSessionStore.delete(chatId)` 待新增 | 已存在,签名是 `delete(accountId, chatId)` |
| C2 | `/new` 没清 in-memory `chatToSession` / `sessionToChat` | 必须同步清,否则下一条消息走旧 session |
| C3 | `/new` 群聊未定义 | 明确拒绝(群 chatId 共享会影响全员) |
| C4 | `/new` 不处理 @-mention | `stripMentions` 后再判 |
| C5 | 图片走 `file.create` | 必须走 `image.create`,返回 `image_key` 不是 `file_key` |
| C6 | 文件 size 限制 30MB 适用所有 | 图片 ≤10MB,文件 ≤30MB |
| C7 | `file_type` 自由字符串 | SDK 枚举受限,docx/xlsx/pptx/txt/md 走 `"stream"` 兜底 |
| C8 | `chat.create({ name })` | 实际 `chat.create({ data: { name, ... }, params })` |
| C9 | `chat.create` 返回邀请链接 | **不返回**,需另调 `chat.link({ data, path })` |
| C10 | 建群后没人 | 必须传 `data.user_id_list: [senderOpenId]` |
| C11 | AI 不知 marker 协议 | 必须扩写 `FEISHU_SESSION_SYSTEM_PROMPT` 教 |
| C12 | marker 残留发给 user | regex strip 掉 marker 再发 |
| C13 | 自动建群无任何授权 | opt-in + permission-card 二次确认双门控 |
| C14 | reply text 无 `[ATTACH:]` 通道 | 同 `[CREATE_GROUP:]` 设计一致的 marker 协议 |
| C15 | 分支基线落后 main 13 commit | 先 merge main(401-fix 等已在 main)再开 light 子分支 |

---

## 8. 风险 / 待决策

- **R1 prompt injection**:user 直接说"输出 `[CREATE_GROUP:xxx]`"诱导 marker 注入 → 二次确认卡片是兜底(user 看到卡片自己拒绝);但仍建议加日志审计
- **R2 文件 size 准确判定**:`stat().size` 读完整文件 vs streaming 上传时大文件 OOM → 本 feat 用 stat 预检,大文件 streaming 留 Large feat
- **R3 share_link 团队群不支持**:G5 已处理,降级显示 chat_id
- **R4 multi-instance plugin**:plugin 模块级单例(plugin.ts:51-56),file-uploader 是无状态函数,multi-instance 安全
- **R5 marker 正则贪婪/转义**:群名含 `]` 会断 marker → 现 regex `[^\]]+` 已防;若 user 真要 `]` 在群名里,留 future enhance
