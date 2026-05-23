# Feature: Telegram Bot Integration
> Created: 2026-05-23 | Status: IN PROGRESS | Complexity: Complex

## Design

Build `packages/telegram/` mirroring the existing `packages/slack/` package (145 lines, single-file). Uses the same `createOpencode()` SDK pattern from `@opencode-ai/sdk` to spawn an opencode server and interact via the auto-generated HTTP client. Maps Telegram chat+thread to opencode sessions via an in-memory Map. Uses **grammy** (not telegraf) as the Telegram bot framework with polling mode (no webhook/HTTP endpoint needed).

**Key architecture:**
- `createOpencode({ port: 0 })` spawns opencode CLI as child process on random port
- Session map: `Map<string, { client, server, sessionId, chatId, threadId }>` keyed by `"${chatId}-${threadId}"`
- Message flow: Telegram message → bot handler → `client.session.prompt()` → wait for response → edit/send Telegram message
- Event stream: Subscribe to SSE `/event` → handle `message.part.updated`, `permission.asked`, `question.asked` events
- Telegram-native UX: message editing for streaming (update same message as agent works), inline keyboards for permission approve/deny, message chunking for 4096-char limit, command handlers for /model /mode /abort /sessions
- Polling mode (not webhook) — simpler, matches Slack's Socket Mode pattern

**Reference implementation:** `packages/slack/src/index.ts` (145 lines) — read it and follow ALL patterns: same SDK import, same config, same error handling style, same session mapping, same event loop structure. The Telegram version will be longer (~300-400 lines) due to streaming UX, keyboards, and chunking.

**Code conventions (from project style guide):**
- No over-engineering. Simple functions, single responsibility
- Avoid `try`/`catch` where possible — use inline error checks like Slack does (`result.error`)
- Prefer `const` over `let`, ternaries over reassignment, early returns over `else`
- Use Bun APIs where possible
- Prefer functional array methods (flatMap, filter, map) over for loops
- No unnecessary destructuring — use dot notation to preserve context
- Snake_case for Drizzle schemas (not applicable here)
- No `any` type — use proper types from the SDK
- Reduce total variable count by inlining when a value is only used once

**Key SDK API and event types (from viewer research):**
- `createOpencode({ port: 0 })` → `{ client: OpencodeClient, server: { url, close() } }`
- `client.session.create({ body: { title } })` → `{ data: { id }, error? }`
- `client.session.prompt({ path: { id: sessionId }, body: { parts: [{ type: "text", text }] } })` → blocking response
- `client.session.share({ path: { id: sessionId } })` → share URL
- `client.event.subscribe()` → `{ stream: AsyncIterable<Event> }` — SSE stream
- Event types to handle:
  - `message.part.updated` with `part.type === "tool"` → tool completion status
  - `message.part.delta` with `field === "text"` → streaming text delta
  - `permission.asked` → `{ id, sessionID, permission, patterns, metadata }`
  - `question.asked` → `{ id, sessionID, questions: [{question, header, options}] }`
  - `session.next.text.delta` → `{ sessionID, delta }` — streaming text
  - `session.next.step.started` → agent/model info
  - `session.next.step.ended` → cost/tokens info

**Telegram-specific constraints:**
- Max message length: 4096 chars → chunk long responses
- Message editing: `bot.api.editMessageText(chatId, messageId, newText)` → use for streaming
- Inline keyboards: `InlineKeyboard` from grammy → approve/deny buttons
- HTML parsing: Telegram supports HTML in messages → use for formatting tool names, code blocks
- Rate limits: ~30 messages/sec per chat → throttle edits during streaming (edit every 1-2 sec, not every delta)

## Tasks

### TASK-1: Scaffold packages/telegram/
- Status: completed
- Branch: feat/telegram-integration
- Worktree: .worktrees/telegram-1
- Depends on: none
- Conflicts with: none
- Parallel group: A
- Agent: editor
- Files: packages/telegram/package.json, packages/telegram/tsconfig.json, packages/telegram/.env.example
- Description: |
  Create the package directory structure and config files.
  
  **package.json**: Follow packages/slack/package.json pattern exactly. Name: `@opencode-ai/telegram`. Dependencies: `grammy` (latest), `@opencode-ai/sdk` (workspace:*). Dev deps same as Slack: `@types/node`, `typescript`, `@typescript/native-preview` (all catalog:). Scripts: `"dev": "bun run src/index.ts"`, `"typecheck": "tsc --noEmit"`.
  
  **tsconfig.json**: Copy from packages/slack/tsconfig.json.
  
  **.env.example**: Two lines: `TELEGRAM_BOT_TOKEN=` and `OPENCODE_DIRECTORY=`
- Acceptance:
  - `packages/telegram/package.json` exists with correct name, deps, and scripts
  - `packages/telegram/tsconfig.json` exists and matches Slack's config
  - `packages/telegram/.env.example` exists with both env vars
  - Package is registered in root workspace (check pnpm-workspace.yaml or package.json workspaces)
- Checkpoint: Scaffold merged to dev (ed97c68). 3 files created, bun install successful.

### TASK-2: Implement core bot — session mapping, message handling, prompt sending
- Status: completed
- Branch: feat/telegram-integration
- Worktree: .worktrees/telegram-2
- Depends on: TASK-1
- Conflicts with: TASK-3, TASK-4 (same file: src/index.ts)
- Parallel group: sequential
- Agent: editor
- Files: packages/telegram/src/index.ts
- Description: |
  Create the main bot file. This is the FOUNDATION — other tasks build on it.

  **Must read first:** `packages/slack/src/index.ts` — follow ALL patterns.

  **Structure:**
  1. Import grammy (`Bot`, `InlineKeyboard` from "grammy") and `createOpencode` from `@opencode-ai/sdk`
  2. Create bot: `const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!)`
  3. Create opencode: `const opencode = await createOpencode({ port: 0 })` — use `OPENCODE_DIRECTORY` env var if set
  4. Session map: `const sessions = new Map<string, { client: any; server: any; sessionId: string; chatId: number; messageId?: number }>()`
  5. Session key: `"${chatId}-${threadId}"` where threadId = message.message_thread_id || message.message_id
  6. Event subscription loop: `const events = await opencode.client.event.subscribe()` — fire-and-forget IIFE like Slack

  **bot.on("message:text") handler:**
  1. Compute sessionKey from chatId + threadId
  2. Get or create session (if new: `client.session.create({ body: { title: "Telegram chat" } })`)
  3. Send prompt: `client.session.prompt({ path: { id: sessionId }, body: { parts: [{ type: "text", text: msg.text }] } })`
  4. Check error — if error, reply with error message
  5. Extract text from response: `response.info?.content || response.parts?.filter(p => p.type === "text").map(p => p.text).join("\n") || "No response"`
  6. Chunk if > 4096 chars (split at newline or space, send multiple messages)
  7. Reply with `bot.api.sendMessage(chatId, text, { reply_to_message_id: threadId, parse_mode: "HTML" })`

  **Event stream handler (initial — tool updates only, like Slack):**
  - Listen for `message.part.updated` where `part.type === "tool"` and `part.state.status === "completed"`
  - Match sessionId to stored session
  - Send tool completion message: `🔧 <b>${part.tool}</b> — ${part.state.title}`

  **bot.start()** at the end.
  
  **DO NOT implement streaming or keyboards yet** — those come in TASK-3 and TASK-4. This task is the minimal working bot.
- Acceptance:
  - `packages/telegram/src/index.ts` exists and compiles with `bun typecheck` (from packages/telegram dir)
  - Bot listens for text messages and sends them to opencode
  - Sessions are created and mapped by chat+thread
  - Responses are chunked if > 4096 chars
  - Tool completion events are sent to the right chat
  - Error responses are sent back to user on session/prompt failure
  - No `try`/`catch` blocks — use inline error checks like Slack
- Checkpoint: Core bot implemented and merged to dev. 112 lines, typecheck passes, session key bug fixed (threadId ?? 0).

### TASK-3: Add streaming — message editing for live agent output
- Status: completed
- Branch: feat/telegram-integration
- Worktree: .worktrees/telegram-3
- Depends on: TASK-2
- Conflicts with: TASK-4 (same file: src/index.ts)
- Parallel group: sequential
- Agent: editor
- Files: packages/telegram/src/index.ts
- Description: |
  Add streaming UX to the bot. This is the KEY Telegram advantage over Slack — edit a single message as the agent streams text instead of posting many new messages.

  **Implementation:**
  1. When a prompt is sent, immediately send a placeholder message: `"⏳ Thinking..."` — store the `messageId` in the session map
  2. Subscribe to `session.next.text.delta` events matching the session
  3. Buffer text deltas — use a `let buffer = ""` that accumulates deltas
  4. Every ~1.5 seconds (throttle!), call `bot.api.editMessageText(chatId, messageId, buffer + "▌")` — the ▌ cursor shows it's still generating
  5. On `session.next.text.ended`, send final edit with the complete text (no cursor) and chunk if needed
  6. If text exceeds 4096 chars during editing, split into multiple messages (edit first 4096, send remaining as new messages)
  
  **Throttle implementation:** Use a simple interval or timestamp check — `const lastEdit = { time: 0 }` and only edit if `Date.now() - lastEdit.time > 1500`.
  
  **HTML formatting:** Wrap code blocks in `<pre><code>` tags, inline code in `<code>` tags for nice rendering.
  
  **Remove the blocking `session.prompt()` wait** from TASK-2 — instead, the prompt call triggers the agent and we stream the response via events. Keep `session.prompt()` but handle the response from the event stream, not from the prompt return value. Note: if the SDK's prompt is blocking, keep it but also listen to events for tool updates.
- Acceptance:
  - Agent responses stream into a single message that gets edited in real-time
  - Throttled edits (not every delta)
  - Cursor ▌ shows during generation, removed on completion
  - Long responses (>4096) are split into multiple messages
  - HTML formatting for code blocks
  - Tool updates still work (not broken by streaming)
- Checkpoint: Streaming UX implemented. Placeholder message, throttled edits (1.5s), cursor ▌, chunked long responses, HTML formatting, both message.part.delta and session.next.text.delta handled. Typecheck passes.

### TASK-4: Add interactive UX — inline keyboards, command handlers
- Status: pending
- Branch: feat/telegram-integration
- Worktree: .worktrees/telegram-4
- Depends on: TASK-3
- Conflicts with none
- Parallel group: sequential
- Agent: editor
- Files: packages/telegram/src/index.ts
- Description: |
  Add Telegram-native interactive features.

  **1. Permission handling (most critical for security):**
  When `permission.asked` event fires matching a session:
  - Create inline keyboard: [[Approve ✅], [Deny ❌]] using grammy's `InlineKeyboard`
  - Send message: `"🔐 Permission Request\n\n${permission}\n\nTool: ${toolName}"` with the keyboard
  - Handle `bot.callbackQuery` for approve/deny — call the opencode API to reply: send POST to permission reply endpoint or use SDK
  - After response, edit the message to show the result: `"🔐 Permission: ✅ Approved"` or `"🔐 Permission: ❌ Denied"`

  **2. Command handlers:**
  - `/start` — Welcome message with setup instructions
  - `/sessions` — List active sessions (iterate sessions map, show session IDs and titles)
  - `/abort` — Abort current agent loop for the session: `client.session.abort({ path: { id: sessionId } })` if available, or find the abort API
  - `/model` — Show current model (from session state) and allow switching (could be a simple text reply listing available models)
  - `/mode` — Show current mode similarly
  - `/help` — List all commands

  **3. Question handling:**
  When `question.asked` event fires:
  - Format the question text
  - If options are provided, create inline keyboard with option buttons
  - Handle callback query to reply with selected answer
- Acceptance:
  - Permission events from opencode trigger inline keyboard with approve/deny in Telegram
  - Clicking approve/deny sends the reply back to opencode
  - Permission message updates to show result after action
  - At minimum /start, /help, /sessions, /abort commands work
  - Command responses are sent to the correct chat+thread
  - No unhandled callback queries (grammy warns about this)
- Checkpoint:

### TASK-5: Wire into monorepo — workspace config, README, cleanup
- Status: completed
- Branch: feat/telegram-integration
- Worktree: .worktrees/telegram-5
- Depends on: TASK-1
- Conflicts with none
- Parallel group: A
- Agent: editor
- Files: pnpm-workspace.yaml (or root package.json), packages/telegram/README.md
- Description: |
  Register the package in the monorepo and add documentation.

  **1. Workspace registration:** Check how packages/slack is registered. If `pnpm-workspace.yaml` exists, ensure `packages/telegram` matches the glob. If not, add it explicitly. If the root `package.json` has a workspaces array, add it there.

  **2. README.md:** Follow packages/slack/README.md format. Include:
  - What it does (1-2 sentences)
  - Setup instructions: create bot via @BotFather, get token, set env vars
  - Running: `cd packages/telegram && cp .env.example .env && bun run dev`
  - Commands list
  - Architecture: same as Slack — `createOpencode()` + session map + SSE events

  **3. Install dependencies:** Run `pnpm install` from root to link the new package.

  **4. Typecheck:** Run `cd packages/telegram && bun typecheck` to verify everything compiles.
- Acceptance:
  - Package is registered in workspace config (verifiable with `pnpm ls --filter @opencode-ai/telegram`)
  - README.md exists with setup instructions and command list
  - `pnpm install` succeeds from root
  - `bun typecheck` succeeds from packages/telegram
- Checkpoint: README created, workspace already registered via packages/* glob. Merged to dev.

## Verification

### TASK-2 Verification (Core Bot)
- Status: pending
- Agent: debugger
- Result:

### TASK-3 Verification (Streaming)
- Status: pending
- Agent: debugger
- Result:

### TASK-4 Verification (Interactive UX)
- Status: pending
- Agent: debugger
- Result:

### TASK-5 Verification (Monorepo Wiring)
- Status: pending
- Agent: debugger
- Result:

## Security Audit
- Status: pending
- Agent: security-auditor
- Notes: Bot token handling, no secrets in code, permission flow security

## Documentation
- Status: pending
- Agent: documenter
- Notes: README created in TASK-5, may need ecosystem page update

## Orchestrator Notes
- User wants this as core integration (packages/telegram), not a plugin
- User specifically wants code to be "ours" — no forking external repos, build from scratch referencing Slack package
- grammy chosen over telegraf for Telegram bot framework
- Polling mode (no webhook) for simplicity
- Branch: feat/telegram-integration — all tasks merge into dev
- Key Telegram UX advantages over Slack: message editing for streaming, inline keyboards for permissions
- TASK-1 and TASK-5 can run in parallel (group A) since they don't modify the same files
- TASK-2 → TASK-3 → TASK-4 must be sequential (same file: src/index.ts, each builds on previous)
- The Slack package is only 145 lines. Expect Telegram to be ~300-400 lines due to streaming + keyboards + chunking

## Event Log

### TASK-1 Events
- [2026-05-23T10:15:00Z] SPAWN: editor for TASK-1
- [2026-05-23T10:20:00Z] COMPLETE: editor for TASK-1 (PASS, 3 files created + bun.lock update)
- [2026-05-23T10:22:00Z] SPAWN: debugger for TASK-1
- [2026-05-23T10:24:00Z] COMPLETE: debugger for TASK-1 (PASS, all 5 acceptance criteria met)
- [2026-05-23T10:25:00Z] MERGE: feat/telegram-scaffold into dev (fast-forward)

### TASK-2 Events
- [2026-05-23T10:30:00Z] SPAWN: editor for TASK-2
- [2026-05-23T10:35:00Z] COMPLETE: editor for TASK-2 (PASS, index.ts created)
- [2026-05-23T10:36:00Z] SPAWN: debugger for TASK-2
- [2026-05-23T10:38:00Z] COMPLETE: debugger for TASK-2 (PASS, all 12 criteria met, session key bug found and fixed)

### TASK-3 Events
- [2026-05-23T11:00:00Z] SPAWN: editor for TASK-3
- [2026-05-23T11:05:00Z] COMPLETE: editor for TASK-3 (PASS, streaming added to index.ts)
- [2026-05-23T11:06:00Z] SPAWN: debugger for TASK-3
- [2026-05-23T11:10:00Z] COMPLETE: debugger for TASK-3 (PASS, all 10 criteria met, minor cleanup done)

### TASK-4 Events
- [empty]

### TASK-5 Events
- [2026-05-23T10:30:00Z] SPAWN: editor for TASK-5
- [2026-05-23T10:34:00Z] COMPLETE: editor for TASK-5 (PASS, README.md created)

## Summary
- [empty until all tasks done]
