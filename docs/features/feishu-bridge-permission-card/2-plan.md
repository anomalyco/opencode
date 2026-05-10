---
feat-id: feishu-bridge-permission-card
status: in-progress
related: ./1-spec.md ./2-plan.md ./3-changelog.md
---

# feishu-bridge-permission-card — 2-plan

## 实施阶段

### Phase 1 — 数据流设计 + 核心 helper(纯函数,Tiny)

新建 `packages/adapter-feishu-lark/src/feishu/permission-card.ts`:

1. **`buildPermissionCard(request, options)`** 纯函数 — 把 `Permission.Request` 转成 飞书 `InteractiveCard` JSON
   - title 行:权限类型 emoji(🔐 read / ✏️ edit / 🌐 webfetch / 🛠️ shell ...)+ 权限 key
   - body markdown:patterns 列表(file path / URL / 等)+ metadata 关键字段
   - action 行:3 个 button,各自 `value: { kind: "permission_reply", requestID, reply: "once|always|reject" }`
   - 卡片 config:`update_multi: true`(避免多人误触发)、wide_screen: true

2. **`parseCardAction(actionEvent)`** 纯函数 — 把飞书 `InteractiveCardActionEvent` 解码
   - 校验 `action.value.kind === "permission_reply"`
   - 提取 `requestID` + `reply`
   - 返 `null` 不是 permission 卡片

3. **`PermissionCardController`** 类 — 状态管理
   - `start(request, chatId, larkClient)` — 渲染 + send card → 记 cardMessageId
   - `handleReply(requestID, reply, message?)` — 调 client.permission.reply + update 卡片显示状态(可选,本期可跳)
   - `cancelTimeout(requestID)` — 5min 超时 → 自动 reply reject
   - 内部 Map<requestID, { chatId, cardMessageId, timeoutHandle, sessionID }>

### Phase 2 — Plugin 集线(改 plugin.ts)

1. plugin.ts `event` hook 加 `permission.asked` 路由:
   ```ts
   event: async ({ event }) => {
     localDispatcher.dispatch(event)
     if (event.type === "permission.asked") {
       await permissionController.start(event.properties, ...)
     }
   }
   ```

2. 反查 sessionID → chatId,需要扩 chatSessionStore:
   - 现有 `chatToSession.set(chatId, sessionID)`
   - 加反向 index `sessionToChat: Map<sessionID, chatId>` 同步维护
   - 旧 in-memory Map 不持久化(sidecar 重启清空) — 飞书 session 重启就重新建,可接受

### Phase 3 — WSS 接 card action 事件(改 wss-client.ts)

1. EventDispatcher.register 加 `card.action.trigger` handler:
   ```ts
   "card.action.trigger": async (data) => {
     const parsed = parseCardAction(data)
     if (!parsed) return
     await permissionController.handleReply(parsed.requestID, parsed.reply, ...)
   }
   ```

2. **风险点 — 实测验证**:lark-node-sdk 1.50.0 的 EventDispatcher 是否真接收 `card.action.trigger` 走 WSS。如不行,降级:
   - plugin 起一个轻量 `permission.list()` polling(每 5s 一次,有未响应卡片时启动)
   - 没新事件就停 polling

### Phase 4 — wireup 测试

1. 单测 `permission-card.test.ts`:
   - buildPermissionCard 各 permission 类型 + metadata 形态
   - parseCardAction 合法 / 非法 / 不是我们卡片的 action
   - 实例化 PermissionCardController + handleReply timing
2. 实测:Hebing—one 发"调研需要安装什么 skill"任务,LLM 调 read 应弹卡片

### Phase 5 — 文档落盘 + commit + 合 dev + push

3-changelog.md + 索引更新 + merge dev + push origin。

## 决策轨迹

(实施期间补,踩坑/方案推翻在此追加)

### 2026-05-10 立 — 选 WSS 路径(D1=A)
EventDispatcher 模式跟现有 im.message.receive_v1 一致,加 1 个 handler 即可。降级 polling 留 plan B。

### 2026-05-10 立 — 卡片用 3 按钮(D2=A)
对齐 opencode `Reply: "once" | "always" | "reject"`,1:1 映射无歧义。

### 2026-05-10 立 — 5min 超时兜底(D3=A)
超时走 `client.permission.reply({reply: "reject"})` 标准路径,LLM 收到 RejectedError 继续。

## 测试矩阵

| 场景 | 期望 |
|---|---|
| LLM 调 read 工具读 workspace 内文件 | 不弹卡片(workspace 内默认 allow)|
| LLM 调 read 工具读 workspace 外 | 弹卡片 → user 选[允许一次] → tool 完成 |
| user 选[始终允许] | ruleset 加 entry,后续相同 pattern 自动放行 |
| user 选[拒绝] | tool 抛 RejectedError,LLM reply 表示拒绝继续 |
| user 不点,等 5min | 自动 reject,session 解锁 |
| 多 chat 并发,只在某 chat 卡 permission | 别的 chat 不受影响(chatQueue 隔离) |
| 同 chat 多 permission 序列 | 卡片排队呈现 |

## 风险登记

| 风险 | 缓解 |
|---|---|
| `card.action.trigger` 不走 WSS | polling fallback |
| chatToSession 反查失败(罕见 race) | 卡片不发,permission 走默认 deny + log warn |
| 卡片渲染元素超 lark 限制 | metadata 字段截断到 200 字符 |
| user 在群组里所有人都能点 | 暂不做防 — 群组场景留 backlog |

## 跟进事项

完成后 OPENCODE-PLAN `飞书桥接-openclaw能力对齐.md` #5a 状态从 in-progress 改 done,#5b 开始时机:观察 #5a 用一周稳定后看 user 反馈。
