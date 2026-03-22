Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun install` instead of `npm install`
- Use `bun run <script>` instead of `npm run <script>`

## OpenCode Server Architecture (Critical Knowledge)

### Connecting to OpenCode

- **DO NOT** use `createOpencode()` from `@opencode-ai/sdk` — it spawns a new `opencode serve` process and frequently **hangs indefinitely**.
- **DO** use direct HTTP `fetch()` against an **already-running** OpenCode server.
- Default port for `opencode serve` is **4098**. Desktop debug builds may use other ports (e.g., 49529).
- Use `lsof -i -P | grep opencode` to discover which ports OpenCode is listening on.
- Port 4098 = standalone `opencode serve`; other ports may require authentication (return 401).
- Desktop publishes sidecar connection info to an app-local bridge file named `openclaw-bridge.json`; prefer that over guessing random sidecar ports.
- The bridge file includes sidecar URL plus basic-auth credentials, so a tool can attach to the same desktop instance instead of a separate standalone server.

### Sending Prompts

- **Async pattern** (recommended): `POST /session/{id}/prompt_async`
  - Returns **204 No Content** (empty body) — do NOT try to parse JSON from it.
  - Then poll `GET /session/{id}/message` for the new assistant message.
- `opencode_bridge.ts` now auto-detects the desktop sidecar first (via `openclaw-bridge.json`) and falls back to standalone `127.0.0.1:4098`.
- Pass `--PORT` only when you explicitly want to override this auto-detection.
- **Resume pattern** (recommended for existing sessions): before sending a new prompt, first clear pending `question` requests and abort any unfinished run in that session. The bridge now does this automatically by default via `SAFE_RESUME`.
- **Sync pattern**: `POST /session/{id}/message`
  - Blocks until response is complete. **Often times out** because `time.completed` may never be set on the message.

### Listing Sessions

- `opencode_sessions.ts` supports `--SOURCE auto|server|db`
- `auto` first tries the live attached server, then falls back to SQLite
- `server` is best when you want to match what the currently attached desktop sidecar can see
- `db` is best for offline auditing or comparing channel-specific databases

### Detecting Response Completion

- **`time.completed` is unreliable** — it is often never set on assistant messages.
- Instead, detect completion by **text stability**: if `extractText(parts).length` remains unchanged for 3+ consecutive polls (~6 seconds), the response is done.
- Also check that no non-question tools are still `running`: `parts.filter(p => p.type === "tool" && p.tool !== "question" && p.state?.status === "running")`.

### The `question` Tool (Session Blocker)

OpenCode's assistant frequently calls a **`question` tool** at the end of responses to ask the user "what next?". This **blocks the entire session** — no new prompts can be processed until answered.

**API endpoints for handling questions:**

- `GET /question` — List all pending question requests across all sessions
- `POST /question/:requestID/reply` — Reply to a question
  - Body: `{ "answers": [["<selected option label>"]] }`
  - `answers` is positional: one array per question, in the same order as `questions`
  - Successful reply resolves the blocked `question` tool call and lets the session continue running
- `POST /question/:requestID/reject` — Reject a question

**Persistence boundary:** pending questions live in the running OpenCode process, not in SQLite. Use `GET /question` to discover actionable requests. Session history alone is not enough to recover a replyable `requestID` after restart.

**Auto-reply strategy**: Pick the first option (usually "继续提问") to unblock the session.

**Avoidance strategy**: Append to your prompt: "不要问我后续问题" or "Do not ask follow-up questions."

### Aborting Stuck Sessions

- `POST /session/{id}/abort` — Abort current generation. Returns `true` on success.
- Use this to unstick sessions blocked by unanswered `question` tool calls.
- When resuming a live session programmatically, abort first if the latest assistant message still looks unfinished (`finish` missing / `tool-calls` / `unknown`, or non-question tool parts still `pending`/`running`).

### Instance Discovery

- Use `opencode_servers.ts` to list every attachable desktop sidecar / standalone server
- Pass `--SESSION_ID` to see which live instance currently owns a specific session

### Message Structure (Critical)

- OpenCode persists session history as `MessageV2.WithParts[]` (`info` + `parts`) in its own DB/state.
- Before calling the AI SDK, that history must be converted to **`ModelMessage[]`** via `MessageV2.toModelMessages(...)`.
- Do **not** hand-roll history with mixed shapes. In particular, avoid string-form user messages like `{ role: "user", content: "..." }` on OpenCode resume/title-generation paths; use content parts instead: `{ role: "user", content: [{ type: "text", text: "..." }] }`.
- The `AI_InvalidPromptError` about `UIMessage[]` vs `ModelMessage[]` is usually a signal that a caller skipped this conversion boundary or constructed malformed `ModelMessage` content.

### Response Cleaning

OpenCode often prepends a "skill check" preamble to responses:

```
- collaborating-with-codex - NO - ...
- do-calculus - NO - ...
No skills needed
```

The bridge script automatically strips these lines from the response.

## Quick Reference: API Endpoints

| Method | Path                         | Description                     |
| ------ | ---------------------------- | ------------------------------- |
| GET    | `/session`                   | List all sessions               |
| POST   | `/session`                   | Create new session (body: `{}`) |
| GET    | `/session/{id}/message`      | List messages in session        |
| POST   | `/session/{id}/message`      | Sync prompt (blocks until done) |
| POST   | `/session/{id}/prompt_async` | Async prompt (returns 204)      |
| POST   | `/session/{id}/abort`        | Abort current generation        |
| GET    | `/question`                  | List pending questions          |
| POST   | `/question/{id}/reply`       | Reply to question               |
| POST   | `/question/{id}/reject`      | Reject question                 |
