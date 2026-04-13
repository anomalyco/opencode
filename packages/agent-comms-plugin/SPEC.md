# Agent Communication Plugin — Specification v2

> Plugin cho phép các OpenCode sessions giao tiếp với nhau: spawn sessions mới, gửi/nhận messages, duy trì hội thoại. Sử dụng SQLite làm message store và OpencodeClient SDK.

---

## 1. Tổng quan

### 1.1 Mục tiêu

- Liệt kê **agent types** khả dụng (build, explore, plan, custom...)
- Liệt kê **sessions** đang chạy
- **Spawn session mới** với agent type cụ thể, gửi message ban đầu, duy trì hội thoại
- **Gửi message** đến session đang chạy, duy trì hội thoại
- Đọc messages nhận được từ sessions khác
- Broadcast message đến nhiều sessions (tạo mới hoặc gửi đến sessions đang chạy)

### 1.2 Kiến trúc

```
Agent A (session)  ←──→  Server Plugin  ←──→  Agent B (session)
  [primary]                  │                  [primary]
                         ┌────┴────┐
                         │ SQLite  │  message store + registry
                         └─────────┘
                         ┌─────────┐
                         │ SDK     │  client.session.prompt()
                         │ Client  │  client.session.promptAsync()
                         └─────────┘

  ✗ sub-session (parentID != null) — KHÔNG bao giờ gửi/nhận
```

### 1.3 Nguyên tắc: Chỉ giao tiếp giữa primary sessions

| Loại session    | Đặc điểm                                                  | Plugin tương tác? |
| --------------- | --------------------------------------------------------- | ----------------- |
| **Primary**     | Không có `parentID`, user tạo trực tiếp hoặc plugin spawn | **Có**            |
| **Sub-session** | Có `parentID`, được TaskTool tạo                          | **KHÔNG**         |

Sub-session là tài nguyên riêng của parent session. Plugin **tuyệt đối không** gửi/nhận message từ sub-session.

### 1.4 Ví dụ sử dụng

**Spawn new session + gửi message:**

```
[Agent A] session_send(new_session=true, agent="explore", message="Find all auth-related files")
  → Plugin tạo session mới, gửi prompt
  → New session (explore agent) xử lý, trả về kết quả
[Agent A] nhận kết quả + session_id của session mới

[Agent A] session_send(session_id="new_sess_id", message="Now check if those files have tests")
  → Gửi follow-up message đến cùng session
  → Session tiếp tục context cũ, xử lý
```

**Gửi đến session đang chạy:**

```
[Agent A] session_send(session_id="sess_abc", message="Review file auth.ts", wait=true)
  → Agent B nhận message, xử lý, trả lời
[Agent A] nhận response
```

---

## 2. Cấu hình

### 2.1 opencode.json

```json
{
  "plugin": [
    [
      "./plugins/agent-comms/index.ts",
      {
        "max_depth": 5,
        "max_retry": 2,
        "sync_timeout_ms": 60000,
        "broadcast_max_recipients": 10,
        "broadcast_rate_limit_per_minute": 5,
        "include_thinking": false,
        "message_ttl_ms": 86400000,
        "db_path": ".opencode/agent-comms.db"
      }
    ]
  ]
}
```

### 2.2 Config schema

| Field                             | Type      | Default                      | Mô tả                                           |
| --------------------------------- | --------- | ---------------------------- | ----------------------------------------------- |
| `max_depth`                       | `number`  | `5`                          | Số tầng nesting tối đa cho message-passing      |
| `max_retry`                       | `number`  | `2`                          | Số lần retry khi target session crash/abort     |
| `sync_timeout_ms`                 | `number`  | `60000`                      | Timeout cho sync mode (ms)                      |
| `broadcast_max_recipients`        | `number`  | `10`                         | Số recipients tối đa cho mỗi broadcast          |
| `broadcast_rate_limit_per_minute` | `number`  | `5`                          | Số broadcasts tối đa mỗi phút                   |
| `include_thinking`                | `boolean` | `false`                      | Bao gồm thinking/reasoning parts trong response |
| `message_ttl_ms`                  | `number`  | `86400000`                   | Thời gian sống của message (ms), default 24h    |
| `db_path`                         | `string`  | `".opencode/agent-comms.db"` | Đường dẫn SQLite database                       |

---

## 3. SQLite Schema

### 3.1 Bảng `messages`

```sql
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL,
  from_session TEXT NOT NULL,
  to_session TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  read INTEGER DEFAULT 0,
  reply_to INTEGER,
  depth INTEGER DEFAULT 0,
  type TEXT DEFAULT 'message',       -- 'message' | 'response' | 'system'
  status TEXT DEFAULT 'delivered',   -- 'pending' | 'delivered' | 'failed' | 'orphaned' | 'crashed'
  retry_count INTEGER DEFAULT 0,
  ttl INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_session, read, timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_from ON messages(from_session, timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_messages_ttl ON messages(ttl);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status, timestamp);
```

### 3.2 Bảng `registry`

```sql
CREATE TABLE IF NOT EXISTS registry (
  session_id TEXT PRIMARY KEY,
  status TEXT DEFAULT 'available',   -- 'available' | 'busy' | 'error' | 'crashed'
  last_active INTEGER NOT NULL,
  current_depth INTEGER DEFAULT 0,
  last_agent TEXT,
  is_subsession INTEGER DEFAULT 0
);
```

### 3.3 Bảng `conversations`

```sql
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  participants TEXT NOT NULL,        -- JSON array of session IDs
  status TEXT DEFAULT 'active',      -- 'active' | 'closed'
  parent_conversation_id TEXT        -- for nested conversations
);
```

### 3.4 PRAGMA

```sql
PRAGMA journal_mode=WAL;
PRAGMA read_uncommitted=1;
```

---

## 4. Custom Tools

### 4.1 `agent_list` — Liệt kê agent types

Liệt kê các **agent types** khả dụng trong project (build, explore, plan, custom agents...). Đây là "catalog" để LLM biết có thể spawn agent loại nào.

**Args:** không có

**Logic:**

1. Gọi OpenCode agent config để lấy danh sách agents
2. Filter out hidden agents (compaction, title, summary)
3. Trả về danh sách với permission summary

**Return format:**

```
Available agent types:
- build (primary) — full permissions. Default agent for general tasks.
- plan (primary) — plan mode, no edits. For planning and analysis.
- explore (subagent, read-only) — Fast codebase exploration and search.
- general (subagent, limited tools) — General-purpose for parallel multi-step tasks.
```

**Permission summary mapping:**

| Agent mode             | Label                        | Mô tả                             |
| ---------------------- | ---------------------------- | --------------------------------- |
| `primary` + full perms | "full permissions"           | Có thể read, write, bash, edit... |
| `primary` + restricted | "restricted: {denied tools}" | Liệt kê tools bị deny             |
| `subagent` + read-only | "read-only"                  | Chỉ grep, glob, read, bash...     |
| `subagent` + limited   | "limited tools: {allowed}"   | Liệt kê tools được allow          |
| Custom                 | based on permission ruleset  | Tóm tắt permissions               |

---

### 4.2 `session_list` — Liệt kê sessions đang chạy

Liệt kê các **sessions** hiện có trong project (primary only). Đây là "directory" để LLM biết sessions đang chạy và có thể gửi message đến.

**Args:**

| Name              | Type     | Required | Default     | Mô tả                                      |
| ----------------- | -------- | -------- | ----------- | ------------------------------------------ |
| `status`          | `string` | no       | `undefined` | Filter: `"active"`, `"idle"`, `"archived"` |
| `conversation_id` | `string` | no       | `undefined` | Chỉ sessions trong conversation này        |

**Logic:**

1. Gọi `client.session.list({ directory })`
2. **Filter out sub-sessions:** loại bỏ sessions có `parentID`
3. **Filter out hidden-agent sessions:** loại bỏ sessions mà last agent là hidden agent
4. Lọc theo `status` nếu có
5. Lọc theo `conversation_id` nếu có (lookup từ conversations table)
6. Trả về danh sách

**Return format:**

```
Found 3 sessions:
- sess_abc123 (active, agent: build — full permissions) — "Fix auth bug" [depth: 0]
  Unread: 2 messages
- sess_def456 (idle, agent: explore — read-only) — "Refactor utils" [depth: 1]
- sess_ghi789 (crashed, agent: build) — "Write tests" [depth: 0]
  ⚠ Last session crashed. Use session_send to retry or check status.
```

**Agent đại diện:** last agent từ last UserMessage's `agent` field.

---

### 4.3 `session_send` — Gửi message, tạo session mới, duy trì hội thoại

Đây là tool chính để giao tiếp. Hỗ trợ cả:

- Tạo session mới + gửi message ban đầu
- Gửi message đến session đang chạy
- Duy trì hội thoại qua `conversation_id`

**Args:**

| Name              | Type      | Required | Default | Mô tả                                                                                                                                                                                               |
| ----------------- | --------- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `message`         | `string`  | yes      | —       | Nội dung gửi                                                                                                                                                                                        |
| `session_id`      | `string`  | no       | —       | Target session ID. Bắt buộc nếu `new_session=false`                                                                                                                                                 |
| `new_session`     | `boolean` | no       | `false` | `true` = tạo session mới rồi gửi                                                                                                                                                                    |
| `agent`           | `string`  | no       | —       | Agent type cho session mới. Dùng khi `new_session=true`. Nếu không chỉ định → fallback `build`. Dùng khi gửi đến session đang chạy để override agent — validate exists, fallback `build` nếu không. |
| `wait`            | `boolean` | no       | `true`  | `true` = sync (chờ response), `false` = async                                                                                                                                                       |
| `conversation_id` | `string`  | no       | auto    | Thread/conversation ID. Auto-generate nếu lần đầu. Dùng lại để duy trì thread.                                                                                                                      |

**Pre-flight checks:**

1. **Self-send check:** `session_id === ctx.sessionID` → reject "Cannot send message to yourself"
2. **Sub-session target check (if !new_session):** Nếu target có `parentID` → reject "Cannot send messages to sub-sessions"
3. **Depth check:** Đọc `current_depth` của `from_session` từ registry. Nếu `depth >= max_depth` → reject
4. **Target existence (if !new_session):** Gọi `client.session.get()`. Nếu không tồn tại → reject
5. **Hidden-agent check (if !new_session):** Nếu target's last agent là hidden → reject
6. **Agent validation:** Nếu chỉ định `agent` → validate exists. Nếu không → fallback `build`
7. **Busy check (sync mode only):** Check target status. Nếu busy → reject

**EC-23: `new_session=true` + `session_id` conflict:**

- Ignore `session_id`, tạo session mới
- Log warning: "session_id ignored when new_session=true"

**EC-24: `new_session=true` nhưng không có `agent`:**

- Fallback về `build` (default agent)

**Flow — new session (`new_session=true`):**

1. Pre-flight checks
2. Resolve agent type → fallback `build` nếu không chỉ định
3. Tính new_depth = from_session.current_depth + 1
4. Generate `conversation_id` nếu không cung cấp
5. Gọi `client.session.create()` (implicit qua `prompt()` với sessionID mới)
6. Gọi `client.session.prompt()` hoặc `promptAsync()` tùy `wait`
7. **SAU KHI** SDK call thành công:
   - Ghi message vào SQLite
   - Upsert registry cho session mới (last_agent, current_depth)
   - Upsert conversation record
8. Trả về response + session_id + conversation_id

**Flow — existing session (`new_session=false`):**

1. Pre-flight checks
2. Tính new_depth
3. Resolve conversation_id (generate nếu mới, dùng lại nếu có)
4. Gọi `client.session.prompt()` hoặc `promptAsync()`
5. **SAU KHI** SDK call thành công: ghi SQLite
6. Trả về response

**Return format (sync):**

```
Session: sess_new123 (agent: explore)
Conversation: conv_abc456

{response content}
```

**Return format (async):**

```
Message sent to session sess_new123 (async).
Session: sess_new123 (agent: explore)
Conversation: conv_abc456
Message ID: 42
```

**Error: session crash (EC-27):**

```
Session sess_abc123 crashed while processing your message: {error message}

Retry: 0/{max_retry} used.
This session has crashed. Options:
1. Retry: session_send(session_id="sess_abc123", message="...") — will attempt retry
2. Undo & respawn: Use /undo on sess_abc123 to revert changes, then session_send(new_session=true, agent="build", message="...") to start fresh
```

**Retry logic (EC-27):**

Khi target session crash/abort:

1. Check `retry_count` trong messages table cho conversation này
2. Nếu `retry_count < max_retry`:
   - Increment retry_count
   - Auto-retry cùng message (nếu sync mode, caller vẫn đang chờ)
   - Nếu retry cũng fail → return crash notification
3. Nếu `retry_count >= max_retry`:
   - Return crash notification với options
   - Update registry: `status = 'crashed'`
4. System prompt inject cho caller: "Session sess_abc123 has crashed. Consider /undo + respawn."

**Errors:**

| Error          | Message                                                   |
| -------------- | --------------------------------------------------------- |
| Self-send      | "Cannot send message to yourself"                         |
| Sub-session    | "Cannot send messages to sub-sessions"                    |
| Max depth      | "Maximum nesting depth ({depth}) reached"                 |
| Not found      | "Session {session_id} not found"                          |
| Hidden agent   | "Cannot send messages to internal sessions"               |
| Busy (sync)    | "Session {session_id} is busy. Use wait=false for async." |
| Timeout (sync) | "Request timed out after {timeout_ms}ms"                  |
| Crash          | "Session crashed: {error}. Retry {n}/{max}."              |

---

### 4.4 `session_read` — Đọc messages nhận được

Đọc messages từ sessions khác. **Chỉ gọi khi system prompt báo có unread messages.**

**Args:**

| Name              | Type      | Required | Default     | Mô tả                                         |
| ----------------- | --------- | -------- | ----------- | --------------------------------------------- |
| `from_session`    | `string`  | no       | `undefined` | Đọc từ session cụ thể, hoặc tất cả            |
| `conversation_id` | `string`  | no       | `undefined` | Đọc messages trong conversation cụ thể        |
| `limit`           | `number`  | no       | `10`        | Số messages tối đa                            |
| `unread_only`     | `boolean` | no       | `true`      | Chỉ messages chưa đọc                         |
| `type`            | `string`  | no       | `undefined` | Filter: `"message"`, `"response"`, `"system"` |

**Logic:**

1. Query SQLite với filters
2. Mark as read
3. Trả về

**Return format:**

```
3 unread messages (conversation: conv_abc456):

[1] From: sess_abc123 @build (depth 1) — 2 minutes ago
    "Review file auth.ts có bug gì không?"

[2] From: sess_abc123 @build (depth 1) — 1 minute ago
    "Also check auth.test.ts"

[3] From: sess_def456 @explore (depth 2) — 30 seconds ago
    [response] "Tests look good, but auth.ts has SQL injection at line 45"
```

**No messages:**

```
No unread messages.
```

**EC-28: Polling prevention:**

- Tool description ghi rõ: "Only call this tool when the system prompt indicates you have unread messages"
- System prompt inject (Section 5.2) là notification mechanism
- Không có rate-limit — dựa vào LLM instruction để tránh polling

---

### 4.5 `agent_broadcast` — Gửi/broadcast đến nhiều sessions

Gửi message đến nhiều sessions cùng lúc. Hỗ trợ cả:

- Gửi đến sessions đang chạy
- Tạo sessions mới cho agent types cụ thể
- Cả hai cùng lúc

**Args:**

| Name              | Type       | Required | Default | Mô tả                                                                        |
| ----------------- | ---------- | -------- | ------- | ---------------------------------------------------------------------------- |
| `message`         | `string`   | yes      | —       | Nội dung gửi                                                                 |
| `session_ids`     | `string[]` | no       | `[]`    | Sessions đang chạy để gửi đến                                                |
| `new_agent_types` | `string[]` | no       | `[]`    | Agent types để spawn sessions mới. Fallback `build` cho types không tồn tại. |
| `wait`            | `boolean`  | no       | `false` | Broadcast mặc định async                                                     |
| `conversation_id` | `string`   | no       | auto    | Shared conversation ID cho tất cả recipients                                 |

**Pre-flight checks:**

1. **Rate limit:** Đếm broadcasts trong 60s. >= `broadcast_rate_limit_per_minute` → reject
2. **Recipient count:** `len(session_ids) + len(new_agent_types)` > `broadcast_max_recipients` → reject
3. **Sub-session filter:** Loại bỏ session_ids có `parentID`
4. **Hidden-agent filter:** Loại bỏ session_ids mà last agent là hidden
5. **Agent validation:** Validate mỗi type trong `new_agent_types`, fallback `build` nếu không tồn tại

**Flow:**

1. Pre-flight checks
2. Resolve targets:
   - `session_ids` → validate tồn tại, filter subsessions/hidden
   - `new_agent_types` → validate, fallback `build`, tạo sessions mới
3. Sequential gửi (không parallel):
   - Existing sessions: `client.session.promptAsync()`
   - New sessions: tạo + `promptAsync()`
4. **SAU KHI** tất cả SDK calls hoàn thành: batch insert SQLite
5. Trả về summary

**Return format:**

```
Broadcast sent to 4 sessions (conversation: conv_xyz789):

New sessions:
✓ sess_new1 @explore — spawned and message sent
✓ sess_new2 @general — spawned and message sent

Existing sessions:
✓ sess_abc123 @build — "Fix auth bug"
✗ sess_busy456 @build — busy, skipped

Total: 3 delivered, 1 skipped
```

---

## 5. Hooks

### 5.1 `event` — Session lifecycle tracking

| Event             | Action                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `session.created` | `INSERT OR IGNORE INTO registry`. Set `is_subsession = 1` nếu có `parentID`. Update `last_agent`.                              |
| `session.idle`    | `UPDATE registry SET status = 'available', current_depth = 0`. Update `last_agent`.                                            |
| `session.updated` | Update `last_agent`. Update `is_subsession` nếu `parentID` thay đổi.                                                           |
| `session.error`   | `UPDATE registry SET status = 'error'`. Check pending messages cho conversations liên quan → trigger retry hoặc notify sender. |
| `session.deleted` | `UPDATE messages SET status = 'orphaned' WHERE to_session = :id`. `DELETE FROM registry`.                                      |

**Crash detection & retry (EC-27):**

Khi nhận `session.error` event:

1. Tìm pending messages gửi đến crashed session
2. Check retry_count < max_retry → schedule retry
3. Nếu max retry reached → update message status = 'crashed', update registry status = 'crashed'
4. Sender session sẽ thấy thông báo qua system prompt inject ở lần prompt tiếp theo

### 5.2 `experimental.chat.system.transform` — Inject notifications

**Mục đích:** "Notification bell" — cho agent biết khi có unread messages hoặc session crashes.

**Inject khi:**

1. **Unread messages** — luôn inject nếu count > 0:

```
[Agent Communication]
You have 3 unread message(s) from 2 session(s):
- sess_abc123 (@build): 2 messages — "Fix auth bug"
- sess_def456 (@explore): 1 message — "Refactor utils"
Use session_read to view them. Use session_send to respond.

Active conversations: conv_abc456 (2 sessions), conv_xyz789 (3 sessions)
```

2. **Session crashes** — inject nếu có sessions crashed trong conversations mà caller tham gia:

```
[Agent Communication — Alerts]
⚠ Session sess_abc123 has crashed after 2 retries.
  Last error: {error message}
  Options:
  1. Retry: session_send(session_id="sess_abc123", message="retry last task")
  2. Undo & respawn: /undo sess_abc123, then session_send(new_session=true, agent="build", ...)
```

3. **Chỉ inject cho primary sessions** — skip nếu session có `parentID`

### 5.3 Cleanup job (init time)

1. Purge expired messages: `DELETE FROM messages WHERE ttl < :now`
2. Validate registry vs actual sessions
3. Mark orphaned sessions
4. Sync `is_subsession` flags
5. Sync `last_agent` từ last UserMessage

---

## 6. Response Extraction

### 6.1 Parse response từ sync call

- Extract text parts (nội dung chính)
- Extract thinking parts nếu `include_thinking = true`
- Extract tool results nếu cần (optional, off by default)

**Format (include_thinking = false):**

```
{last text part content}
```

**Format (include_thinking = true):**

```
<thinking>
{thinking content}
</thinking>

{text content}
```

---

## 7. Edge Cases

### 7.1 Circular / Infinite Loop

- `depth` counter trong registry + pre-flight check
- Reject khi `current_depth >= max_depth`
- `session.idle` event reset depth về 0

### 7.2 Deadlock (Sync mode)

- Check target session status trước khi gửi
- Reject nếu target đang busy
- Timeout (`sync_timeout_ms`) → throw error

### 7.3 Session Lifecycle

| Tình huống                  | Xử lý                                     |
| --------------------------- | ----------------------------------------- |
| Target không tồn tại        | Pre-flight reject                         |
| Target abort khi đang xử lý | `session.error` event → retry hoặc notify |
| Target bị delete            | `session.deleted` event → mark orphaned   |
| Self-messaging              | Pre-flight reject                         |

### 7.4 Concurrent Access

- SQLite WAL mode
- Transactions cho batch writes
- `read_uncommitted=1`

### 7.5 Sub-session Isolation (EC-14)

- Plugin KHÔNG bao giờ gửi/nhận từ sub-session (có `parentID`)
- `session_list` filter out, `session_send` reject, `agent_broadcast` skip
- Depth tracking hoàn toàn độc lập với OpenCode's parent-child

### 7.6 Hidden-agent Isolation (EC-17)

- Filter out sessions mà last agent là hidden (compaction, title, summary)
- `session_list`, `session_send`, `agent_broadcast` đều filter

### 7.7 Agent Name Resolution (EC-18, EC-19)

- Agent đại diện = last agent từ last UserMessage
- Khi gửi: validate agent exists → fallback `build` nếu không

### 7.8 Permission Summary (EC-20)

- `agent_list` hiển thị permission summary cho mỗi type
- `session_list` hiển thị permission summary cho mỗi session
- Prompt gửi đi bao gồm permission info

### 7.9 Message Threading via conversation_id (EC-25)

- `conversation_id` group messages trong cùng thread
- Auto-generate nếu không cung cấp
- `session_read` filter được theo conversation_id
- Multiple sessions có thể share cùng conversation_id (group chat)

### 7.10 Queue Messages via conversation_id (EC-26)

- Khi target busy: message vẫn được gửi async (SDK queue)
- SQLite ghi status='pending' cho queued messages
- Khi target idle → messages được deliver
- `conversation_id` đảm bảo ordering trong cùng thread

### 7.11 Crash Recovery (EC-27)

- `max_retry` config (default: 2)
- Auto-retry khi target session crash (trong sync mode)
- Nếu max retry reached → notify caller qua system prompt
- Suggest: /undo crashed session + spawn new session
- `registry.status = 'crashed'` để track

### 7.12 Read Polling Prevention (EC-28)

- System prompt inject là notification mechanism (primary)
- `session_read` chỉ gọi khi system prompt báo có unread messages
- Tool description ghi rõ instruction
- Không rate-limit — dựa vào LLM following instruction

### 7.13 Broadcast = Multi-spawn (EC-29)

- `agent_broadcast` có `new_agent_types` để spawn sessions mới
- Kết hợp với `session_ids` để gửi cả đến sessions đang chạy + sessions mới
- Sequential sending, shared `conversation_id`

### 7.14 SQLite Write Timing

- Chỉ ghi SQLite SAU KHI SDK call thành công
- SDK fail → không ghi, throw error
- SDK success → ghi trong transaction

### 7.15 Orphaned Messages

- `message_ttl_ms` TTL
- Cleanup khi plugin init
- `session.deleted` → mark orphaned
- `session_read` skip orphaned

### 7.16 new_session + session_id Conflict (EC-23)

- Ignore `session_id` khi `new_session=true`
- Log warning

### 7.17 new_session Without Agent (EC-24)

- Fallback về `build` (default agent)

---

## 8. File Structure

```
.opencode/plugins/agent-comms/
├── index.ts          # Plugin entry point, hooks
├── db.ts             # SQLite init, schema, CRUD helpers
└── tools.ts          # Tool definitions
```

### 8.1 `index.ts`

- Export plugin function
- Parse config
- Init SQLite
- Register tools: `agent_list`, `session_list`, `session_send`, `session_read`, `agent_broadcast`
- Register `event` hook
- Register `experimental.chat.system.transform` hook
- Cleanup job on init

### 8.2 `db.ts`

- `initDb(dbPath)` — tạo DB, migrations, PRAGMA
- `insertMessage(msg)` — insert message record
- `insertMessages(msgs[])` — batch insert trong transaction
- `getMessages(filter)` — query với filters
- `markRead(ids[])` — mark as read
- `markOrphaned(sessionId)` — mark orphaned
- `getRegistry(sessionId)` — đọc registry
- `upsertRegistry(sessionId, data)` — insert/update registry
- `deleteRegistry(sessionId)` — xóa registry
- `getUnreadCount(sessionId)` — đếm unread
- `getUnreadSummary(sessionId)` — unread count grouped by sender + conversation
- `purgeExpired()` — xóa expired messages
- `getBroadcastCount(sinceTimestamp)` — đếm broadcasts
- `isSubSession(sessionId)` — check flag
- `updateLastAgent(sessionId, agentName)` — update agent
- `getConversation(id)` — đọc conversation record
- `upsertConversation(id, participants)` — insert/update conversation
- `getPendingMessages(sessionId)` — messages chưa deliver cho crashed session
- `incrementRetryCount(messageId)` — tăng retry count

### 8.3 `tools.ts`

Export tool definitions:

- `agent_list`
- `session_list`
- `session_send`
- `session_read`
- `agent_broadcast`

Mỗi tool dùng `tool({ description, args, execute })` từ `@opencode-ai/plugin`.

---

## 9. Prompt Format

### 9.1 Prompt gửi đến target agent

```
[Agent Communication — Message from session "{from_session_title}"]

From: {from_session_id} (agent: {from_agent})
To: {to_session_id} (agent: {to_agent}, {permission_summary})
Depth: {depth}/{max_depth}
Conversation: {conversation_id}

---

{message}

---

Instructions:
- This message was sent by another OpenCode agent session.
- Process this request and your response will be sent back.
- If you need to continue this conversation, use session_send with conversation_id="{conversation_id}".
- Do NOT exceed the maximum nesting depth of {max_depth}.
- Your permissions: {permission_summary}. Stay within your allowed operations.
```

### 9.2 System prompt inject

**Unread messages:**

```
[Agent Communication]
You have {count} unread message(s) from {sender_count} session(s):
{list of senders with agent name, count, session title}
Use session_read to view them. Use session_send to respond.

Active conversations: {list of conversation_ids with participant count}
```

**Crash alert:**

```
[Agent Communication — Alerts]
⚠ Session {id} has crashed after {max_retry} retries.
  Last error: {error}
  Options:
  1. Retry: session_send(session_id="{id}", message="retry")
  2. Undo & respawn: /undo {id}, then session_send(new_session=true, agent="{agent}", ...)
```

---

## 10. Tool Names vs OpenCode Built-in Tools

| Built-in Tool | Plugin Tool       | Khác biệt                                                                                                                     |
| ------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `task`        | `session_send`    | `task` tạo sub-session (parentID), `session_send` tạo primary session. `task` là delegation, `session_send` là communication. |
| —             | `agent_list`      | Không có built-in equivalent. Liệt kê agent types.                                                                            |
| —             | `session_list`    | Không có built-in equivalent. Liệt kê running sessions.                                                                       |
| —             | `session_read`    | Không có built-in equivalent. Đọc messages.                                                                                   |
| —             | `agent_broadcast` | Không có built-in equivalent. Multi-session messaging.                                                                        |

**Khi nào dùng `task` vs `session_send`:**

- `task` = "I need to delegate a sub-task and get the result back" (subagent pattern)
- `session_send` = "I need to communicate with another independent agent" (peer-to-peer pattern)
