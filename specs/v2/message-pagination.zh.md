# Session 消息列表：总数与定位

状态：设计  
跟踪：[#44660](https://github.com/anomalyco/opencode/issues/44660)  
相关：[#6548](https://github.com/anomalyco/opencode/issues/6548)、[#35895](https://github.com/anomalyco/opencode/issues/35895)、[#43766](https://github.com/anomalyco/opencode/issues/43766)  
英文稿：[`message-pagination.md`](./message-pagination.md)

## 问题

`GET /api/session/:sessionID/message` 已支持有界顺序分页：`limit`、`order`、不透明 `cursor`。客户端可以从最新或最旧一端打开，再向前/向后翻页。

当前契约**没有**：

1. Session 投影消息的 **总数 `total`**
2. 不遍历全部 cursor，直接打开 **中间某个位置** 的能力

需要做虚拟滚动条、跳转到某一条消息、深链恢复阅读位置的客户端（如 CodeNomad），今天只能全量拉取或 O(n / limit) 轮询。第一方 TUI/App 暂不依赖此能力，但存储层已具备廉价定位条件。

## 现状

公开查询（`packages/protocol/src/groups/message.ts`）：

```text
limit?: 1..200
order?: asc | desc          # 仅首页；不可与 cursor 同时使用
cursor?: opaque             # 编码 { id, order, direction }
```

公开响应：

```text
{ data: Message[], cursor: { previous?, next? } }
```

另有单条读取（不带上下文窗口）：

```text
GET /api/session/:sessionID/message/:messageID
→ { data: Message }
```

该接口能确认消息存在并取内容，但**不能**把会话视图定位到该消息附近的一页时间线。

Core 读取路径（`SessionV2.messages`）：

- 将 cursor 中的投影消息 `id` 解析为 `session_message.seq`
- 按 `ORDER BY seq` 与排他 `seq` 边界翻页
- 不返回 total、稠密排名，也没有 seek 模式

存储已具备：

- `session_message.seq` — 持久投影顺序，`(session_id, seq)` 唯一
- 索引 `session_message_session_seq_idx`

## 目标

- 返回该 Session 投影消息列表的 **total**
- 支持两种一次性定位：
  - 按 **稠密排名 `index`**（滚动条比例跳转）
  - 按 **消息 ID `around`**（按会话消息定位到对话位置）
- 顺序浏览仍以 opaque cursor 为主
- 不在公开协议暴露 durable `seq`
- 无需数据库迁移

## 非目标

- 把经典多页 `offset` 当作主翻页模型
- 在消息列表上公开 durable `seq` / 事件游标（事件回放用 `session.history` / `session.events`）
- 成绩单 revision token（[#43766](https://github.com/anomalyco/opencode/issues/43766)）— 互补能力，本切片不依赖
- 按消息类型过滤 total，或只统计 compaction 后的 active context
- 改动 V1 `MessageV2.page` / 旧版 `/session/:id/message`
- 保证并发追加/revert 期间滚动条绝对精确

---

## 按会话消息定位到对话位置（核心能力）

**可以。** 这是本设计的一等能力，不是附属选项。

### 语义

客户端已知某条 Session 消息 ID（来自事件、搜索结果、通知、深链、`session.message` 单条读取等）时，应能：

1. 打开以该消息为中心的有界时间线窗口
2. 拿到该窗口在整段对话中的稠密位置（`startIndex` + `total`），便于滚动条/虚拟列表对齐
3. 之后用 cursor 继续向上/向下加载，而无需重新 walk 整条时间线

### 请求

```http
GET /api/session/{sessionID}/message?limit=50&order=asc&around=msg_...
```

- `around`：目标消息 ID（`msg_*`）
- `order`：窗口内与后续翻页的时间线方向（默认 `desc`）
- `limit`：窗口大小

**不可**与 `cursor` 或 `index` 同时使用。

### 窗口算法

给定 `around=msg_*`、`limit=L`、`order`：

1. 解析目标消息；若不存在 → `data: []`，仍返回当前 `total`
2. 计算其在请求 `order` 下的稠密排名 `r`（从 0 起）
3. `start = max(0, r - floor((L - 1) / 2))`
4. `ORDER BY seq … LIMIT L OFFSET start`
5. 返回该页 + opaque cursor + `total` + `startIndex`

只要消息仍存在且 `L >= 1`，目标消息一定出现在 `data` 中。靠近两端时窗口贴边夹紧，而不是越界。

### 客户端典型流程

```text
已知 messageID
    │
    ├─（可选）GET .../message/{messageID}     # 取单条详情 / 校验存在
    │
    ▼
GET .../message?around={messageID}&limit=50&order=asc
    │
    ├─ data[] 含目标及邻域消息
    ├─ startIndex / total 用于虚拟列表定位
    └─ 在 UI 中 scrollIntoView(目标 messageID)
    │
    ▼
用户上滑/下滑
    │
    └─ GET .../message?cursor={previous|next}&limit=50
```

### 与「只取单条消息」的分工

| 需求 | 接口 |
|------|------|
| 只要这一条的内容 | `GET /api/session/:id/message/:messageID` |
| 要把会话视图停在这条附近，并继续翻页 | `GET /api/session/:id/message?around=:messageID` |
| 按滚动条比例跳到大概位置（无具体 ID） | `GET .../message?index=N` |

深链、搜索命中、「跳转到此消息」、子代理结果回跳父会话中的某条 user/assistant 消息，都应走 `around`，而不是先顺序 walk cursor。

### 精确性

- **按消息 ID 定位是精确的**：目标仍存在时，窗口必含该 ID。
- **按 `index` 比例跳转是近似的**：并发写入/删除可能使窗口偏移若干条；需要精确身份时改用 `around`。
- revert 删除目标消息后：`around` 返回空页 + 最新 `total`；客户端应回退到最新页或提示消息已不存在。

---

## 设计决策

### 1. 顺序浏览仍用 opaque cursor

任意 seek 之后，继续用 `cursor.previous` / `cursor.next`。Seek 只负责「打开哪一页」。

### 2. 不公开 `seq`

`session_message.seq` 是 durable 聚合序号，允许空洞（非消息事件、revert 后删除）。公开它会把客户端绑到事件管道，并诱使错误的「页码」计算。

对外位置使用 **稠密排名**：在当前投影行集合上、按请求 `order` 的从 0 起下标。

### 3. `index` 只作首页定位，不作主翻页

实现为 `ORDER BY seq … LIMIT limit OFFSET index`，随即返回普通 cursor。文档声明并发变更下为近似定位；精确身份请用 `around`。

### 4. 每次响应都带 `total` 与 `startIndex`

- `total`：该 Session 投影消息 `COUNT(*)`
- `startIndex`：`data[0]` 在请求 `order` 下的稠密排名；`data` 为空时省略

相对消息正文 hydration，`COUNT` 成本可忽略，故不做 `meta=1` 开关（若 maintainer 坚持可再议）。

### 5. 定位模式互斥

一次请求只能使用下列之一：

| 模式 | 查询参数 | 含义 |
|------|----------|------|
| 边缘/默认 | 仅 `order` | 现有首页行为（默认 `desc`） |
| Cursor 翻页 | `cursor` | 现有顺序翻页 |
| 排名定位 | `index`（可加 `order`） | 滚动条式跳转 |
| 消息定位 | `around`（可加 `order`） | **按会话消息定位到对话位置** |

非法组合返回明确 4xx（见下）。

## 公开契约

### Query

```ts
SessionMessagesQuery = {
  limit?: 1..200                 // 默认 50（不变）
  order?: "asc" | "desc"         // 默认 "desc"；仅首页 / seek
  cursor?: string                // opaque；不可与 order/index/around 并存
  index?: NonNegativeInt         // 稠密排名 seek；不可与 cursor/around 并存
  around?: SessionMessage.ID     // 按消息定位；不可与 cursor/index 并存
}
```

### Response

```ts
SessionMessagesResponse = {
  data: SessionMessage.Message[]
  cursor: {
    previous?: string
    next?: string
  }
  total: NonNegativeInt
  startIndex?: NonNegativeInt    // 仅当 data.length > 0
}
```

### 错误

- 畸形 / 与 `order` 冲突的 `cursor` → 沿用 `InvalidCursorError`
- `index`/`around` 与其它定位参数冲突 → 建议 `InvalidRequestError`

### 客户端配方

最新窗口（不变）：

```http
GET /api/session/{id}/message?limit=50
```

最旧窗口（不变）：

```http
GET /api/session/{id}/message?limit=50&order=asc
```

滚动条约 40%（2000 条、升序）：

```http
GET /api/session/{id}/message?limit=50&order=asc&index=800
```

**按消息定位到对话位置：**

```http
GET /api/session/{id}/message?limit=50&order=asc&around=msg_...
```

定位后再翻页：

```http
GET /api/session/{id}/message?limit=50&cursor={cursor.next}
```

## Core API 形状

扩展 `SessionV2.Interface.messages`，HTTP 保持薄适配：

```ts
messages(input: {
  sessionID: SessionSchema.ID
  limit?: number
  order?: "asc" | "desc"
  cursor?: { id: SessionMessage.ID; direction: "previous" | "next" }
  index?: number
  around?: SessionMessage.ID
}): Effect.Effect<
  {
    messages: SessionMessage.Message[]
    total: number
    startIndex?: number
  },
  NotFoundError | MessageDecodeError | InvalidMessagesQueryError
>
```

建议内部 helper（同模块或邻近，非必需导出）：

- `countMessages(db, sessionID)`
- `denseRank(db, sessionID, messageID, order)` — 请求顺序下严格排在目标之前的行数
- 现有 seq 边界翻页 + seek 用的 `OFFSET` 变体

`sessions.context(...)` 不变：context 仍是 compaction 后的 active 模型历史，不是全量列表 total。

## HTTP / SDK / Changelog

1. 改 `packages/protocol/src/groups/message.ts`
2. 改 `packages/core/src/session.ts` 的 `messages`
3. 改 `packages/server/src/handlers/message.ts`（校验互斥并转发）
4. 在 `packages/client` 执行 `bun run generate`（勿手改 `src/generated`）
5. 在 `specs/v2/schema-changelog.md` 记录契约变更

建议 PR 标题：`feat(protocol): session message total and seek`

## 正确性说明

### `total` 统计什么

该 Session 在 `session_message` 中的全部投影行，包含 system、compaction、agent/model switch、shell、user、assistant。与今日列表端点一致（不过滤 type）。

不是：

- compaction 后的 active context（`session.context`）
- durable 事件日志长度（`session.history`）
- 未 promote 的 inbox（`session_input`）

### 稠密排名 vs durable `seq`

```text
按 seq 升序的投影行:  [msg_a seq=10, msg_b seq=40, msg_c seq=41]
升序稠密排名:         [0, 1, 2]
```

revert/删除会缩小 `total`，并重编号删除点之后的稠密排名。客户端在观察到成绩单变更后应刷新 `total` / `startIndex`。未来的 revision token（#43766）可显式表达陈旧；本切片不阻塞于它。

### Cursor 耗尽

今日 handler 在页非空时总会发 `previous`/`next`，即使已到边缘。本设计不强制修复；若同 PR 收紧「无更多行则省略该方向」，须在 changelog 写明。

## 实现计划

1. **Core** — 扩展返回类型；实现 count + `index`/`around` seek；同步更新仓内调用点
2. **Protocol** — 扩展 query/response 与 OpenAPI 说明
3. **Server** — 校验互斥；适配 handler
4. **Generate** — `packages/client` 下 `bun run generate`
5. **Changelog** — 追加条目
6. **测试** — 见下
7. **文档 / Issue** — 回复 #44660：今日无 seek；接受 PR 后以本契约为准

## 测试

### Core

- `total` 等于插入的投影行数
- `order=asc&index=0` / `order=desc&index=0` 行为与边缘首页一致，`startIndex === 0`
- `index` 贴近 `total - 1` 不报错；`index >= total` 返回空 `data`、仍有 `total`、无 `startIndex`
- **`around` 必含目标消息**；两端夹紧
- **`around` 缺失 ID → 空页 + total**
- seek 后 cursor 下一页与稠密顺序连续
- 拒绝非法参数组合

### Server / HttpApi

- 接受 `index` / `around`
- 非法组合映射到声明的 4xx
- JSON 含 `total`、`startIndex`
- 生成 SDK 类型可通过编译

避免固定 sleep；用现有 projector / publish helper 写入确定性投影行。

## 示例

Session 升序稠密顺序为 `m0…m6`。

按排名：

```http
GET /api/session/ses_x/message?limit=3&order=asc&index=3
```

```json
{
  "data": ["m3", "m4", "m5"],
  "cursor": { "previous": "…", "next": "…" },
  "total": 7,
  "startIndex": 3
}
```

**按消息定位到对话位置：**

```http
GET /api/session/ses_x/message?limit=3&order=asc&around=m1
```

```json
{
  "data": ["m0", "m1", "m2"],
  "cursor": { "previous": "…", "next": "…" },
  "total": 7,
  "startIndex": 0
}
```

客户端在 `data` 中找到 `m1`，滚动到该条，即可把视图停在对话中的精确位置。

## 发布

- 实验性 V2 路由；响应字段加性兼容「忽略未知键」的客户端；生成 SDK 消费者必须重新 generate
- 无迁移；不改投影写入路径
- 在 #44660 回复：当前无 supported seek；maintainer 接受后以本 spec 为实现形状

## 待 Maintainer 确认

1. `total` / `startIndex` 是否始终返回？（建议：是）
2. `index`/`around` 冲突用 `InvalidRequestError` 还是复用 `InvalidCursorError`？（建议：前者）
3. 是否同 PR 收紧边缘 cursor？（建议：测试量小则一并做）
