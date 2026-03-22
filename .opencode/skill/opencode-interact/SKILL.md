---
name: opencode-interact
description: Interact with OpenCode AI programmatically via its local HTTP API. Create sessions, continue existing sessions, inspect recent local sessions, clear pending question-tool prompts, abort stuck runs, and conduct multi-turn conversations. Use for delegating work to another OpenCode instance, testing OpenCode behavior, resuming an existing OpenCode session, or building small automations around local OpenCode state.
---

Use OpenCode through the local server API and local SQLite session store.

## Prerequisites

- Ensure an OpenCode server is already running, usually on port `4098`
- Prefer the local bridge scripts in this skill instead of raw SDK calls
- Session metadata usually lives in `~/.local/share/opencode/opencode.db`

## Main scripts

### 1) Send a prompt / continue a session

```bash
bun run skills/opencode-interact/scripts/opencode_bridge.ts \
  --PROMPT "今天几号？不要问我后续问题。"

bun run skills/opencode-interact/scripts/opencode_bridge.ts \
  --SESSION_ID "ses_xxx" \
  --PROMPT "继续刚才的话题，用一句话总结。不要问我后续问题。"
```

Key flags:

- `--PROMPT <text>`: required prompt
- `--SESSION_ID <id>`: continue an existing session
- `--PORT <n>`: OpenCode server port, default `4098`
- `--TIMEOUT <ms>`: default `180000`
- `--FULL_RESPONSE`: include raw parts/tokens metadata
- `--no-AUTO_REPLY_QUESTION`: disable question auto-reply

Bridge responses also include a `question` field:

- `seen`: whether this run observed pending questions for the session
- `auto_replied`: whether the bridge auto-replied during polling
- `pending`: the pending request objects that were seen
- `replied`: the request IDs and positional answers the bridge submitted

Example:

```json
{
  "success": true,
  "session_id": "ses_xxx",
  "response": "Done.",
  "question": {
    "seen": true,
    "auto_replied": true,
    "pending": [
      {
        "id": "question_xxx",
        "sessionID": "ses_xxx",
        "questions": [
          {
            "header": "Next",
            "question": "What do you want me to do next?",
            "multiple": false,
            "options": [
              { "label": "Continue", "description": "Keep going" },
              { "label": "Task complete", "description": "Stop here" }
            ]
          }
        ],
        "tool": { "messageID": "msg_xxx", "callID": "call_xxx" }
      }
    ],
    "replied": [
      {
        "id": "question_xxx",
        "answers": [["Continue"]]
      }
    ]
  }
}
```

If auto-reply is disabled, `question.pending` still exposes the request so another program can answer it with `opencode_questions.ts`.

## 2) List recent local sessions

```bash
bun run skills/opencode-interact/scripts/opencode_sessions.ts --LIMIT 10
bun run skills/opencode-interact/scripts/opencode_sessions.ts \
  --DIRECTORY /Users/lelouch/apps/opencode \
  --LIMIT 5 \
  --INCLUDE_LAST_TEXT
```

Use this before resuming a session if the user says “pick a recent one” or names a repo directory.

## 3) Inspect or clear pending question prompts

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

Use this when a session is blocked by OpenCode’s `question` tool.

Important details:

- Pending questions are stored in the running OpenCode process, not in SQLite
- Use `GET /question` to discover replyable requests and filter by `sessionID`
- `POST /question/:requestID/reply` expects positional answers, not a map keyed by question text
- Replying unblocks the waiting `question` tool call and allows the session to continue

Reply body example:

```json
{
  "answers": [["Continue"], ["Task complete"]]
}
```

## 4) Abort a stuck run

```bash
bun run skills/opencode-interact/scripts/opencode_abort.ts --SESSION_ID ses_xxx
```

Use this when the latest assistant run is still hanging, or when you want to reset a dirty session state before continuing.

## Practical workflow

### Start a fresh conversation

1. Call `opencode_bridge.ts` with a prompt
2. Capture `session_id`
3. Reuse that `session_id` for later turns

### Resume an existing session safely

1. List recent sessions with `opencode_sessions.ts`
2. Choose the target `session_id`
3. Check pending questions with `opencode_questions.ts --SESSION_ID ...`
4. If needed, clear them with `--REPLY_FIRST`
5. If the old run still looks wedged, abort with `opencode_abort.ts`
6. Continue with `opencode_bridge.ts --SESSION_ID ...`

## Important behavior notes

- OpenCode often appends a `question` tool call after answering; that can block the session
- `opencode_bridge.ts` auto-replies to pending questions by default
- `opencode_bridge.ts` surfaces structured `question` state so callers can inspect or take over question handling
- Pending question discovery depends on a live server; session history alone cannot reconstruct a replyable `requestID`
- For old/dirty sessions, inspect and clear pending questions first for better reliability
- Add “不要问我后续问题” to prompts when you want less chance of an interactive follow-up
- The bridge strips the “skill check / No skills needed” preamble from final text when possible
- Some sessions may still produce aborted or partial messages; if so, read the latest messages and continue from the last valid assistant reply instead of trusting timeout status alone

## Output format

Success:

```json
{
  "success": true,
  "session_id": "ses_xxx",
  "message_id": "msg_xxx",
  "model": "gpt-5.4",
  "response": "今天是 2026 年 3 月 20 日。"
}
```

Failure:

```json
{
  "success": false,
  "session_id": "ses_xxx",
  "error": "Timeout after 180000ms waiting for response"
}
```
