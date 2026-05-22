---
feat-id: feishu-bridge-light
status: draft
related: ./1-spec.md ./2-plan.md
---

# feishu-bridge-light — 1-spec(轻量版,飞书桥接增强)

> **状态**:📝 撰写中
> **分支**:`feat/feishu-bridge` → 续写 `feishu-bridge-light` 子分支
> **来源**:飞书桥接需求讨论(2026-05-22)

---

## 1. 触发原因

feishu-bridge 基础功能已完成(多账号/群聊session/权限卡片/持久化),但缺少几个提升使用流畅度的功能:

1. **单聊新话题**:单聊中想切换话题,当前 session 上下文干扰
2. **自动建群**:AI 识别需要新群聊时,自动创建飞书群
3. **文件上传**:本地生成的截图/文件能发回飞书

---

## 2. 需求 / 验收标准

### 2.1 `/new` 指令 — 单聊切换话题

| # | 需求 | 验收标准 |
|---|---|---|
| N1 | `/new` 检测 | 私聊消息内容为 `/new` 时,不进 chatQueue,直接清当前 session |
| N2 | session 清理 | `chatSessionStore.delete(chatId)` 清除当前 session;下次消息触发新 session |
| N3 | 用户提示 | 删除后发一条飞书消息:"已开启新对话" |

**交互流程**:
```
User: /new
Adapter: [检测到 /new] → chatSessionStore.delete(currentChatId) → 发送"已开启新对话" → 下一条消息新建 session
```

### 2.2 自动建群

| # | 需求 | 验收标准 |
|---|---|---|
| A1 | AI 识别意图 | Claude/OpenCode 回复中含 `[CREATE_GROUP:群名]` 时触发 |
| A2 | 建群 API | 调用 `larkClient.im.v1.chat.create()` 创建公开群 |
| A3 | 建群通知 | 创建成功后,在原群发一条消息:"已创建群:群名" + 邀请链接 |
| A4 | 静默忽略 | 不含 `[CREATE_GROUP:xxx]` 时正常回复,不触发建群 |

**交互流程**:
```
User: 帮我拉个群讨论这个需求
Claude: 好,我来创建群
         [CREATE_GROUP:需求讨论]  ← AI 返回中包含此标记
Adapter: 解析到标记 → larkClient.im.v1.chat.create({ name: "需求讨论" }) → 发通知回原群
```

**API 调用**:
```typescript
// 创建群
POST /im/v1/chats
{
  "name": "<group_name>",
  "chat_type": "public"
}

// 发邀请链接通知
POST /im/v1/messages
{
  "receive_id": "<original_chat_id>",
  "msg_type": "text",
  "content": JSON.stringify({ text: "已创建群:需求讨论，邀请链接: https://applink.feishu.cn/client/chat/chatter/xxx" })
}
```

### 2.3 文件上传发送

| # | 需求 | 验收标准 |
|---|---|---|
| F1 | 文件上传 | 调用 `larkClient.im.v1.file.create()` 上传本地文件/图片,拿 file_key |
| F2 | 文件发送 | 调用 `larkClient.im.v1.message.create()` type=file 发送 |
| F3 | 批量支持 | 支持图片(jpg/png/gif/webp)、PDF、Office 文档 |
| F4 | 错误处理 | 上传失败时回一条文字消息说明原因,不卡住流程 |

**文件限制**:
- 最大 30MB
- 支持:pdf/doc/docx/xls/xlsx/ppt/pptx/txt/md/jpg/png/gif/webp/mp4/opus

**交互流程**:
```
User: 生成这个流程图的截图
Claude: [生成 image.png]
Adapter: larkClient.im.v1.file.create({ file: image.png, file_name: "流程图.png" })
        → file_key
        → larkClient.im.v1.message.create({ receive_id, msg_type: "image", file_key })
```

---

## 3. 范围 / 不范围

### 3.1 范围

- ✅ `/new` 指令实现(`message-pipeline.ts`)
- ✅ 自动建群(`message-pipeline.ts` + `larkClient.im.v1.chat.create`)
- ✅ 文件上传发送(`file-pipeline.ts`)
- ✅ 改动均在 `packages/adapter-feishu-lark/` 内

### 3.2 不范围

- ❌ OAuth/扫码登录(已有)
- ❌ 多账号支持(已有)
- ❌ 群聊 session 隔离(已有)
- ❌ permission 卡片(已有)
- ❌ GUI 设置界面

---

## 4. 改动点

### 4.1 `message-pipeline.ts`

| 改动 | 说明 |
|------|------|
| `/new` 检测 | `text === '/new'` → `chatSessionStore.delete()` |
| `[CREATE_GROUP:xxx]` 检测 | 正则匹配 → 调用 `chat.create()` |
| 流式响应中原样保留标记 | AI 返回带标记时先发标记文字再执行操作 |

### 4.2 `file-pipeline.ts`(新文件)

| 功能 | 说明 |
|------|------|
| `uploadFile(path)` | 调用 `file.create` → 返回 file_key |
| `sendFile(receiveId, fileKey, fileName)` | 调用 `message.create` 发文件 |
| `uploadAndSend(path, receiveId)` | 组合上传+发送,错误时回文字 |

### 4.3 `chat-session-store.ts`

| 改动 | 说明 |
|------|------|
| `delete(chatId)` | 新增,删除指定 chatId 的 session |

---

## 5. 测试验收

| 功能 | 测试方式 |
|------|----------|
| `/new` | 单元测试:检测 `/new` → 确认 `chatSessionStore.delete` 被调用 |
| 自动建群 | 集成测试:mock `larkClient`,验证 `[CREATE_GROUP:xxx]` 被解析并调用 `chat.create` |
| 文件上传发送 | 单元测试:mocks `file.create` + `message.create`,验证调用顺序和参数 |

---

## 6. 依赖

- `larkClient.im.v1.chat.create` — 飞书 SDK 已有
- `larkClient.im.v1.file.create` — 飞书 SDK 已有
- `larkClient.im.v1.message.create` — 飞书 SDK 已有
- `chatSessionStore.delete` — 需实现