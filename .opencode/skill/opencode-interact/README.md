# OpenCode Interact Skill

用本地 OpenCode HTTP API 和本机 session 数据做程序化交互。

## 现在能做什么

- 新建 OpenCode 会话并提问
- 续接已有 session 继续多轮对话
- 列出最近本地 sessions，按目录筛选
- 查看 / 自动回复 pending `question` tool
- 中止卡住的 session
- 用统一 JSON 输出做脚本集成

## 推荐脚本

### 发起或续接对话

```bash
bun run skills/opencode-interact/scripts/opencode_bridge.ts \
  --PROMPT "今天几号？不要问我后续问题。"

bun run skills/opencode-interact/scripts/opencode_bridge.ts \
  --SESSION_ID "ses_xxx" \
  --PROMPT "继续刚才的话题。不要问我后续问题。"
```

`opencode_bridge.ts` 现在会在 JSON 输出里附带 `question` 字段，告诉调用方本轮是否看到过 pending `question`、是否已自动回复，以及对应 request 详情。

示例：

```json
{
  "success": true,
  "session_id": "ses_xxx",
  "message_id": "msg_xxx",
  "model": "gpt-5.4",
  "response": "已经处理完成。",
  "question": {
    "seen": true,
    "auto_replied": true,
    "pending": [
      {
        "id": "question_xxx",
        "sessionID": "ses_xxx",
        "questions": [
          {
            "header": "下一步",
            "question": "接下来你想让我做哪一步？",
            "multiple": false,
            "options": [
              { "label": "继续提问", "description": "继续当前任务" },
              { "label": "任务完成", "description": "结束对话" }
            ]
          }
        ],
        "tool": { "messageID": "msg_xxx", "callID": "call_xxx" }
      }
    ],
    "replied": [
      {
        "id": "question_xxx",
        "answers": [["继续提问"]]
      }
    ]
  }
}
```

如果你关闭 `--AUTO_REPLY_QUESTION`，则 `question.pending` 仍会返回，方便外部程序再调用 `opencode_questions.ts --REQUEST_ID ... --ANSWERS ...` 精确作答。

### 查看最近 sessions

```bash
bun run skills/opencode-interact/scripts/opencode_sessions.ts --LIMIT 10
bun run skills/opencode-interact/scripts/opencode_sessions.ts \
  --DIRECTORY /Users/lelouch/apps/opencode \
  --LIMIT 5 \
  --INCLUDE_LAST_TEXT
```

### 查看 / 清理 pending question

```bash
bun run skills/opencode-interact/scripts/opencode_questions.ts --SESSION_ID ses_xxx
bun run skills/opencode-interact/scripts/opencode_questions.ts \
  --SESSION_ID ses_xxx \
  --REPLY_FIRST
bun run skills/opencode-interact/scripts/opencode_questions.ts \
  --SESSION_ID ses_xxx \
  --REPLY_FIRST \
  --ANSWER "任务完成"
```

`GET /question` 返回的是当前运行中的 OpenCode 进程内存里的 pending 请求，不是 SQLite 里的持久化数据。

`POST /question/:requestID/reply` 的 body 真实格式是按题目顺序提交答案：

```json
{
  "answers": [["继续提问"], ["任务完成"]]
}
```

这里的 `reply` 是“回答后继续执行”，不是 reject/abort。回复成功后，原来被 `question` 工具阻塞的会话会继续向下运行。

### 中止卡住的会话

```bash
bun run skills/opencode-interact/scripts/opencode_abort.ts --SESSION_ID ses_xxx
```

## 经验结论

- 新旧 session 都能续接，但旧 session 更容易带着 pending question / aborted 状态
- `opencode_bridge.ts` 默认会自动处理 question tool
- `opencode_bridge.ts` 的 `question` 字段可用于判断本轮是否出现过 pending `question`，以及是否已自动回复
- pending `question` 只能从运行中的 OpenCode HTTP API 发现；重启后内存里的 pending 请求会丢失
- 如果你明确不想它反问，prompt 里加：`不要问我后续问题`
- 真遇到脏状态时，先 `questions`，必要时 `abort`，再继续聊

## 响应格式

成功：

```json
{
  "success": true,
  "session_id": "ses_xxx",
  "message_id": "msg_xxx",
  "model": "gpt-5.4",
  "response": "今天是 2026 年 3 月 20 日。"
}
```

失败：

```json
{
  "success": false,
  "session_id": "ses_xxx",
  "error": "Timeout after 180000ms waiting for response"
}
```
