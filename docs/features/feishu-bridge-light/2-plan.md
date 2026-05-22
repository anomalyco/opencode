---
feat-id: feishu-bridge-light
status: draft
related: ./1-spec.md ./2-plan.md
---

# feishu-bridge-light — 2-plan(实施计划)

> **基于**:[1-spec.md](./1-spec.md)轻量版需求
> **分支**:`feat/feishu-bridge` → `feat/feishu-bridge-light`
> **工期**:约 3 天

---

## 总体策略

1. 先做 `/new` — 最简单,5 行代码,立刻能用
2. 再做 `chatSessionStore.delete` — 为 `/new` 补齐依赖
3. 再做文件上传发送 — 独立模块,不改核心流
4. 最后做自动建群 — 涉及 AI 返回解析,稍复杂

---

## Phase 1:`/new` 指令 + `chatSessionStore.delete`(0.5 天)

### 改动文件

| 文件 | 改动 |
|------|------|
| `src/feishu/chat-session-store.ts` | 新增 `delete(chatId)` 方法 |
| `src/feishu/message-pipeline.ts` | 检测 `text === '/new'` → 调用 `delete()` → 发确认消息 |

### commit

```
feat(feishu-bridge-light): add /new command to reset session [feat: feishu-bridge-light]
```

---

## Phase 2:文件上传发送(1 天)

### 改动文件

| 文件 | 改动 |
|------|------|
| `src/feishu/file-pipeline.ts`(新) | `uploadFile` / `sendFile` / `uploadAndSend` |
| `src/feishu/message-pipeline.ts` | 文件类型响应时调用 `file-pipeline` |

### commit

```
feat(feishu-bridge-light): add file upload and send via feishu [feat: feishu-bridge-light]
```

---

## Phase 3:自动建群(1.5 天)

### 改动文件

| 文件 | 改动 |
|------|------|
| `src/feishu/message-pipeline.ts` | 正则检测 `[CREATE_GROUP:xxx]` → 调用 `larkClient.im.v1.chat.create` |
| `src/feishu/group-manager.ts`(新) | 封装建群逻辑,发送邀请链接 |

### AI 标记格式

```typescript
const CREATE_GROUP_PATTERN = /\[CREATE_GROUP:([^\]]+)\]/;
```

### commit

```
feat(feishu-bridge-light): add auto group creation from AI response [feat: feishu-bridge-light]
```

---

## Phase 4:测试收尾(0.5 天)

### 测试清单

| 测试 | 类型 |
|------|------|
| `/new` 检测逻辑 | 单元测试 |
| `chatSessionStore.delete` | 单元测试 |
| 文件上传发送 mock 验证 | 集成测试 |
| 自动建群正则匹配 | 单元测试 |

### commit

```
test(feishu-bridge-light): add unit and integration tests [feat: feishu-bridge-light]
```

---

## 工期汇总

| Phase | 内容 | 工期 |
|-------|------|------|
| 1 | `/new` + `delete()` | 0.5 天 |
| 2 | 文件上传发送 | 1 天 |
| 3 | 自动建群 | 1.5 天 |
| 4 | 测试收尾 | 0.5 天 |
| **合计** | | **3 天** |

---

## 风险

- AI 返回格式不确定,`[CREATE_GROUP:xxx]` 格式可能随 prompt 变化 → 预留扩展接口
- 飞书文件上传 API 可能有权限限制 → 先用测试账号验证