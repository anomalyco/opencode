# Feishu Chat Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a durable local Feishu WebSocket gateway that routes supported chat messages to an embedded DeepSeek-backed OpenCode Session, sends one final reply, and handles recognized inventory/location questions through the trusted MySQL service before model execution.

**Architecture:** The official Feishu Channel callback normalizes and durably admits messages into a Bun SQLite task/event store, then returns without waiting for inference. A keyed worker serializes each deterministic OpenCode Session while allowing bounded cross-Session concurrency; it first offers the task to the trusted inventory route, otherwise invokes one process-scoped `sdk-next` host with the zero-tool `feishu-chat` Agent. Every state transition is appended to the same trace, and reply delivery distinguishes confirmed, explicitly not sent, and uncertain outcomes.

**Tech Stack:** Bun 1.x, TypeScript, Bun SQLite, Effect, `@larksuiteoapi/node-sdk@1.71.1`, `@opencode-ai/sdk-next`, MySQL2 3.14.4, Bun test, tsgo, oxlint, OpenSpec.

## Global Constraints

- Run tests and `bun typecheck` from `packages/feishu`, never from the repository root and never with `tsc`.
- Use the official Feishu WebSocket Channel; do not add a public callback, HTTP listener, CLI child process, or global `opencode` dependency.
- The model reference must resolve to DeepSeek during startup preflight and must not silently fall back.
- `.opencode/agent/feishu-chat.md` exposes zero tools with default-deny permissions before and after inventory integration.
- Recognized inventory/location requests use the trusted fixed MySQL service before OpenCode; they invoke no provider turn and expose no SQL/tool surface to the Agent.
- Accepted messages are committed to SQLite before the Channel callback completes; inference and reply delivery run in the background.
- The same Session is FIFO, different Sessions may overlap up to the configured concurrency limit.
- Duplicate Feishu message IDs reuse the same task, Session ID, and prompt message ID; conflicting reuse is rejected.
- Never persist or print Feishu secrets, provider credentials, database passwords, connection strings, cookies, tokens, hidden reasoning, or password-file contents.
- Send one complete final text only; never send text deltas, reasoning, progress cards, tool output, tables, headings, summaries, or follow-up prompts for inventory answers.
- Gateway event history is append-only. State rows may advance only in the same transaction that appends the corresponding immutable event.
- Preserve the two root T1 historical documents unchanged and do not add any SQL Server/T1 runtime path.
- Do not edit generated client files. If a public Protocol or Server `HttpApi` changes, run `bun run generate` from `packages/client`.

---

## File Map

- `packages/feishu/src/config.ts`: parse non-secret runtime options, hold credentials only at the startup boundary, validate a DeepSeek model reference.
- `.opencode/agent/feishu-chat.md`: hidden zero-tool/default-deny pure-chat Agent.
- `packages/feishu/src/identity.ts`: normalize direct/group routing and derive deterministic hashed task, Session, prompt, trace, turn, message, and sentence IDs.
- `packages/feishu/src/sentence.ts`: deterministic punctuation/newline segmentation without rewriting text.
- `packages/feishu/src/migrations.ts`: additive Bun SQLite schema versions.
- `packages/feishu/src/store.ts`: atomic task admission, legal state transitions, recovery queries, immutable event insertion.
- `packages/feishu/src/sanitize.ts`: recursive secret/key sanitization for every sink.
- `packages/feishu/src/fallback-log.ts`: minimal sanitized JSONL diagnostics when the primary event write fails.
- `packages/feishu/src/event-log.ts`: construct trace/message/sentence/execution/delivery event envelopes.
- `packages/feishu/src/feishu.ts`: official SDK payload normalization, supported-message filtering, Channel startup, and reply adapter.
- `packages/feishu/src/admission.ts`: persist accepted input and enqueue only after commit.
- `packages/feishu/src/opencode.ts`: one scoped embedded host, deterministic Session reconciliation, exact prompt retry, final-text projection, tool blocking.
- `packages/feishu/src/worker.ts`: keyed FIFO scheduler, bounded concurrency, restart recovery, state machine, cautious delivery retry.
- `packages/feishu/src/inventory-route.ts`: confidence-gated inventory/location intent parsing and trusted pre-model service invocation.
- `packages/feishu/src/gateway.ts`: compose admission, worker, OpenCode, inventory route, store, logging, and Feishu ports.
- `packages/feishu/src/index.ts`: process entrypoint and graceful shutdown.
- `packages/feishu/README.md`: local setup, one-command start, Feishu scopes, preflight, SQLite inspection, and acceptance procedure.

### Task 1: Configuration, Agent, and startup documentation

**Files:**
- Modify: `packages/feishu/package.json`
- Modify: `packages/feishu/tsconfig.json`
- Create: `packages/feishu/.env.example`
- Create: `packages/feishu/src/config.ts`
- Create: `.opencode/agent/feishu-chat.md`
- Create: `packages/feishu/README.md`
- Create: `packages/feishu/test/config.test.ts`
- Create: `packages/feishu/test/agent.test.ts`
- Create: `packages/feishu/test/readme.test.ts`
- Modify: `bun.lock`

**Interfaces:**
- Produces:

```ts
export type ModelRef = { providerID: string; modelID: string }
export type GatewayConfig = {
  appID: string
  appSecret: string
  model: ModelRef
  dataDirectory: string
  workspaceDirectory: string
  maxConcurrency: number
  replyAttempts: number
  replyTimeoutMs: number
}
export function parseGatewayConfig(env: Record<string, string | undefined>): GatewayConfig
export function assertDeepSeekModel(model: ModelRef): void
export async function preflightDeepSeek(
  model: ModelRef,
  resolve: (model: ModelRef) => Promise<{ providerID: string; modelID: string; authenticated: boolean }>,
): Promise<void>
```

- [ ] **Step 1: Write failing configuration, Agent, and README tests**

```ts
const valid = {
  FEISHU_APP_ID: "cli_test",
  FEISHU_APP_SECRET: "secret-canary",
  FEISHU_MODEL: "deepseek/deepseek-chat",
  FEISHU_DATA_DIRECTORY: "D:\\data\\feishu",
  FEISHU_WORKSPACE_DIRECTORY: "D:\\opencode",
}

expect(parseGatewayConfig(valid).model).toEqual({ providerID: "deepseek", modelID: "deepseek-chat" })
expect(() => parseGatewayConfig({})).toThrow("FEISHU_APP_ID, FEISHU_APP_SECRET, FEISHU_MODEL")
expect(() => assertDeepSeekModel({ providerID: "openai", modelID: "gpt" })).toThrow("DeepSeek")
expect(await Bun.file("../../.opencode/agent/feishu-chat.md").text()).toContain('"*": false')
```

The README test must assert `im.message.receive_v1`, single-chat receive, group `@` receive, message send, WebSocket/no public callback, `bun run start`, model preflight, data path, and the absence of credential values.

- [ ] **Step 2: Run the tests and verify RED**

Run from `packages/feishu`:

```powershell
bun test test/config.test.ts test/agent.test.ts test/readme.test.ts
```

Expected: FAIL because `src/config.ts`, the Agent, and README do not exist.

- [ ] **Step 3: Implement the package boundary**

Pin `@larksuiteoapi/node-sdk` to `1.71.1`, add `@opencode-ai/sdk-next: workspace:*` and `effect: catalog:` dependencies, add `"start": "bun run src/index.ts"`, and retain the existing MySQL scripts. Parse `FEISHU_MODEL` as exactly one `providerID/modelID` pair, default numeric settings to `4`, `3`, and `15000`, and report missing names without interpolating configured values.

The Agent frontmatter must be:

```yaml
---
mode: primary
hidden: true
tools:
  "*": false
permission:
  "*": deny
---
```

Its body permits plain-text conversation and explicitly says file, terminal, database, Skill, MCP, network-tool, and project-modification capabilities are unavailable.

- [ ] **Step 4: Install and verify GREEN**

Run:

```powershell
Set-Location D:\opencode
bun install
Set-Location packages\feishu
bun test test/config.test.ts test/agent.test.ts test/readme.test.ts
bun typecheck
```

Expected: all focused tests pass and type checking succeeds.

- [ ] **Step 5: Commit**

```powershell
git add packages/feishu/package.json packages/feishu/tsconfig.json packages/feishu/.env.example packages/feishu/src/config.ts packages/feishu/README.md packages/feishu/test/config.test.ts packages/feishu/test/agent.test.ts packages/feishu/test/readme.test.ts .opencode/agent/feishu-chat.md bun.lock
git commit -m "feat(feishu): configure chat gateway"
```

### Task 2: Deterministic routing identity and sentence events

**Files:**
- Create: `packages/feishu/src/identity.ts`
- Create: `packages/feishu/src/sentence.ts`
- Create: `packages/feishu/test/identity.test.ts`
- Create: `packages/feishu/test/sentence.test.ts`

**Interfaces:**
- Produces:

```ts
export type RoutingInput = {
  chatType: "direct" | "group"
  chatID: string
  senderID: string
  messageID: string
  threadID?: string
  rootID?: string
}
export type GatewayIdentity = {
  conversationID: string
  sessionID: string
  promptMessageID: string
  taskID: string
  turnID: string
  traceID: string
}
export async function deriveGatewayIdentity(input: RoutingInput): Promise<GatewayIdentity>
export type SentenceSegment = { id: string; index: number; text: string }
export async function splitMessage(messageID: string, text: string): Promise<readonly SentenceSegment[]>
```

- [ ] **Step 1: Write failing identity and sentence tests**

Cover the canonical keys `feishu:direct:<chat_id>:<sender_id>` and `feishu:thread:<chat_id>:<thread_root>`, thread fallback order `threadID`, `rootID`, `messageID`, fresh-process stability, cross-chat isolation, no raw external ID in returned persistent IDs, Chinese/English terminal punctuation, CRLF/LF boundaries, repeated punctuation, and unsegmentable full-message fallback.

- [ ] **Step 2: Run and verify RED**

```powershell
bun test test/identity.test.ts test/sentence.test.ts
```

Expected: FAIL because both modules are absent.

- [ ] **Step 3: Implement deterministic SHA-256 identities**

Use `crypto.subtle.digest("SHA-256", new TextEncoder().encode(namespace + "\0" + value))`. Use independent versioned namespaces and valid prefixes:

```ts
const namespaces = {
  conversation: "feishu-conversation:v1",
  session: "feishu-session:v1",
  prompt: "feishu-prompt:v1",
  task: "feishu-task:v1",
  turn: "feishu-turn:v1",
  trace: "feishu-trace:v1",
  sentence: "feishu-sentence:v1",
}
```

Return `ses_feishu_<48 hex>` and `msg_feishu_<48 hex>` for OpenCode IDs; other IDs use `conv_`, `task_`, `turn_`, `trace_`, and `sentence_`. Split after `。！？!?；;\n`, preserve exact characters, omit only empty segments caused by adjacent newlines, and return the untouched input at index zero when no reliable boundary exists.

- [ ] **Step 4: Run and verify GREEN**

```powershell
bun test test/identity.test.ts test/sentence.test.ts
```

Expected: all routing, isolation, stability, and exact-text tests pass.

- [ ] **Step 5: Commit**

```powershell
git add packages/feishu/src/identity.ts packages/feishu/src/sentence.ts packages/feishu/test/identity.test.ts packages/feishu/test/sentence.test.ts
git commit -m "feat(feishu): derive gateway identities"
```

### Task 3: SQLite task store, immutable events, and sanitization

**Files:**
- Create: `packages/feishu/src/migrations.ts`
- Create: `packages/feishu/src/store.ts`
- Create: `packages/feishu/src/sanitize.ts`
- Create: `packages/feishu/src/fallback-log.ts`
- Create: `packages/feishu/src/event-log.ts`
- Create: `packages/feishu/test/store.test.ts`
- Create: `packages/feishu/test/sanitize.test.ts`
- Create: `packages/feishu/test/event-log.test.ts`

**Interfaces:**
- Produces:

```ts
export type TaskState =
  | "received"
  | "admitted"
  | "running"
  | "answered"
  | "sending"
  | "delivered"
  | "failed"
  | "uncertain_delivery"
export type GatewayTask = {
  id: string
  externalMessageHash: string
  conversationID: string
  sessionID: string
  promptMessageID: string
  turnID: string
  traceID: string
  promptText: string
  originalText: string
  replyTarget: string
  replyRootID?: string
  state: TaskState
  answer?: string
  receiveSequence: number
  sendAttempts: number
}
export type GatewayEventInput = {
  eventID: string
  eventType: string
  occurredAt: number
  conversationID: string
  turnID: string
  traceID: string
  messageID?: string
  sentenceID?: string
  sentenceIndex?: number
  parentEventID?: string
  relatedEventID?: string
  actor: "user" | "gateway" | "assistant" | "provider" | "operator"
  version: number
  status: string
  durationMs?: number
  content: unknown
}
export function openGatewayStore(path: string): GatewayStore
export function sanitize(value: unknown, secrets: readonly string[]): unknown
export function appendFallbackDiagnostic(path: string, diagnostic: unknown, secrets: readonly string[]): Promise<void>
```

`GatewayStore` exposes `admit`, `getTask`, `transition`, `appendEvent`, `eventsForTrace`, `recoverableTasks`, and `close`. `admit` accepts the task plus receipt/message/sentence events in one transaction and returns `{ kind: "created" | "duplicate"; task }`; incompatible reuse throws `GatewayConflictError`.

- [ ] **Step 1: Write failing store, event, and sanitizer tests**

Use a temporary SQLite file. Assert migration idempotence, WAL/foreign keys, atomic admission, unique external message hash, duplicate coalescing, conflicting reuse, legal/illegal transitions, event sequence monotonicity, no update/delete event API, recoverable state filtering, correction linking, complete and sentence-level reconstruction, known secret canaries, credential-key removal, normal business content preservation, and sanitized fallback JSONL.

- [ ] **Step 2: Run and verify RED**

```powershell
bun test test/store.test.ts test/sanitize.test.ts test/event-log.test.ts
```

Expected: FAIL because the persistence modules do not exist.

- [ ] **Step 3: Implement schema and atomic operations**

Create `gateway_schema_version`, `gateway_task`, and `gateway_event`. Make `gateway_event.sequence INTEGER PRIMARY KEY AUTOINCREMENT`, `event_id TEXT UNIQUE NOT NULL`, and prohibit changes with SQLite triggers that `RAISE(ABORT, 'gateway_event is append-only')` on update/delete. Use `BEGIN IMMEDIATE` transactions for admission and transitions. Store JSON only after recursive sanitization replaces exact configured secrets with `[REDACTED]` and removes case-insensitive keys matching `authorization`, `cookie`, `token`, `secret`, `password`, `api_key`, `private_key`, or `connection_string`.

- [ ] **Step 4: Run and verify GREEN**

```powershell
bun test test/store.test.ts test/sanitize.test.ts test/event-log.test.ts
```

Expected: all transaction, recovery, append-only, reconstruction, and secret tests pass.

- [ ] **Step 5: Commit**

```powershell
git add packages/feishu/src/migrations.ts packages/feishu/src/store.ts packages/feishu/src/sanitize.ts packages/feishu/src/fallback-log.ts packages/feishu/src/event-log.ts packages/feishu/test/store.test.ts packages/feishu/test/sanitize.test.ts packages/feishu/test/event-log.test.ts
git commit -m "feat(feishu): persist gateway events"
```

### Task 4: Feishu payload normalization and durable admission

**Files:**
- Create: `packages/feishu/src/feishu.ts`
- Create: `packages/feishu/src/admission.ts`
- Create: `packages/feishu/test/feishu.test.ts`
- Create: `packages/feishu/test/admission.test.ts`

**Interfaces:**
- Produces:

```ts
export type NormalizedFeishuMessage = {
  chatType: "direct" | "group"
  chatID: string
  senderID: string
  messageID: string
  threadID?: string
  rootID?: string
  originalText: string
  promptText: string
  replyTarget: string
  replyRootID?: string
}
export type NormalizeResult =
  | { kind: "accepted"; message: NormalizedFeishuMessage }
  | { kind: "ignored"; reason: "unmentioned_group" | "unsupported" | "empty" | "bot_message" }
export function normalizeFeishuMessage(payload: unknown, robotOpenID: string): NormalizeResult
export type FeishuReplyResult =
  | { kind: "delivered"; externalReplyID: string }
  | { kind: "not_sent"; retryable: boolean; reason: string }
  | { kind: "uncertain"; reason: string }
export type FeishuPort = {
  start(onMessage: (payload: unknown) => Promise<void>): Promise<void>
  send(task: GatewayTask, text: string): Promise<FeishuReplyResult>
  stop(): Promise<void>
}
export function createAdmission(input: {
  store: GatewayStore
  enqueue: (taskID: string) => void
  fallbackPath: string
  secrets: readonly string[]
}): { receive(message: NormalizedFeishuMessage): Promise<"created" | "duplicate"> }
```

- [ ] **Step 1: Write failing Feishu and admission tests**

Use captured type-compatible payload fixtures for direct text, mentioned group text, unmentioned group text, unsupported post/image, empty text, bot sender, thread/root fallback, and a mention adjacent to useful text. Verify only the routing robot mention is removed from `promptText`, while `originalText` stays intact. In admission tests, delay the worker port indefinitely and prove `receive` returns after the SQLite commit, no enqueue occurs on persistence failure, and duplicate delivery enqueues at most once.

- [ ] **Step 2: Run and verify RED**

```powershell
bun test test/feishu.test.ts test/admission.test.ts
```

Expected: FAIL because the adapter and admission path are absent.

- [ ] **Step 3: Implement narrow official-SDK and domain adapters**

Keep official SDK imports inside `createOfficialFeishuPort(config)`. Use the SDK Channel high-level service and `im.message.receive_v1`. Convert SDK exceptions into the three delivery outcomes without retaining raw headers or credentials. The callback must call `normalizeFeishuMessage`, ignore unsupported results, await `admission.receive`, and never await the worker.

- [ ] **Step 4: Run and verify GREEN**

```powershell
bun test test/feishu.test.ts test/admission.test.ts
```

Expected: all filtering, mention, routing-target, callback-latency, and persistence-before-enqueue tests pass without network access.

- [ ] **Step 5: Commit**

```powershell
git add packages/feishu/src/feishu.ts packages/feishu/src/admission.ts packages/feishu/test/feishu.test.ts packages/feishu/test/admission.test.ts
git commit -m "feat(feishu): admit channel messages"
```

### Task 5: Embedded OpenCode restricted-chat adapter

**Files:**
- Create: `packages/feishu/src/opencode.ts`
- Create: `packages/feishu/test/opencode.test.ts`

**Interfaces:**
- Produces:

```ts
export type ChatCompletion = {
  text: string
  model: { providerID: string; modelID: string }
  tokens?: { input: number; output: number; reasoning: number }
  cost?: number
  durationMs: number
}
export type ChatFailure = {
  kind: "timeout" | "rate_limit" | "authentication" | "provider" | "empty_output" | "policy"
  retryable: boolean
  message: string
}
export type ChatPort = {
  complete(task: GatewayTask): Promise<{ ok: true; value: ChatCompletion } | { ok: false; error: ChatFailure }>
  interrupt(sessionID: string): Promise<boolean>
  close(): Promise<void>
}
export function createEmbeddedChatPort(input: {
  config: GatewayConfig
  onEvent: (task: GatewayTask, event: GatewayEventInput) => Promise<void>
}): Promise<ChatPort>
```

- [ ] **Step 1: Write the failing real embedded-host tests**

Use the real `OpenCode.create()` under `Effect.scoped`, a temporary `Location`, and the existing test-provider pattern. Assert deterministic `Session.ID.make(task.sessionID)`, `SessionMessage.ID.make(task.promptMessageID)`, `Agent.ID.make("feishu-chat")`, `Model.Ref.make(...)`, create-or-get reconciliation, `sessions.prompt`, pre-admission durable event subscription, current-prompt activation, matching assistant completion/failure boundaries, projected assistant message selection for the admitted turn, exact retry, tokens/cost capture, reasoning exclusion, timeout/rate-limit/auth/provider classification, empty text rejection, and interrupt-on-tool event with no tool result. Do not call the currently unavailable `sessions.wait`.

- [ ] **Step 2: Run and verify RED**

```powershell
bun test test/opencode.test.ts
```

Expected: FAIL because `src/opencode.ts` does not exist.

- [ ] **Step 3: Implement the process-scoped sdk-next adapter**

Create one `OpenCode.create()` inside one Effect Scope and reuse it. For each task, `sessions.get` the deterministic Session and create it only on `SessionNotFoundError`; always reconcile Agent and model before prompt admission. Subscribe to durable Session events before admitting the deterministic prompt. Activate the turn only after its matching `session.next.prompted`, then use the matching assistant message's `session.next.step.ended` or `session.next.step.failed` as the terminal boundary and read that projected message directly. Never copy reasoning parts into `ChatCompletion` or gateway events. If any event is a tool request, interrupt and return a policy failure.

- [ ] **Step 4: Run and verify GREEN**

```powershell
bun test test/opencode.test.ts
```

Expected: real embedded routing, continuity, exact retry, final projection, failure classification, and policy blocking pass.

- [ ] **Step 5: Commit**

```powershell
git add packages/feishu/src/opencode.ts packages/feishu/test/opencode.test.ts
git commit -m "feat(feishu): embed restricted chat"
```

### Task 6: Keyed worker, restart recovery, and delivery outcomes

**Files:**
- Create: `packages/feishu/src/worker.ts`
- Create: `packages/feishu/test/worker.test.ts`

**Interfaces:**
- Consumes: `GatewayStore`, `GatewayTask`, `ChatPort`, `FeishuPort`, and an optional pre-model route.
- Produces:

```ts
export type PreModelRouteResult =
  | { handled: false }
  | { handled: true; text: string; route: "inventory"; status: string }
export type PreModelRoute = { handle(task: GatewayTask): Promise<PreModelRouteResult> }
export type GatewayWorker = {
  enqueue(taskID: string): void
  recover(): Promise<void>
  idle(): Promise<void>
  stop(): Promise<void>
}
export function createGatewayWorker(input: {
  store: GatewayStore
  chat: ChatPort
  feishu: FeishuPort
  preModelRoute: PreModelRoute
  maxConcurrency: number
  replyAttempts: number
  replyTimeoutMs: number
  now: () => number
}): GatewayWorker
```

- [ ] **Step 1: Write failing worker tests**

Create controllable ports and prove: same Session never overlaps and preserves `receiveSequence`; two Sessions overlap but never exceed `maxConcurrency`; a task failure releases its key; duplicate enqueue coalesces; restart handles `received`, reconciles `admitted`/`running`, sends persisted `answered`, never reruns `delivered`, and leaves `uncertain_delivery` untouched; inventory handled results skip `chat.complete`; confirmed delivery never resends; explicitly retryable `not_sent` retries at most `replyAttempts`; non-retryable `not_sent` fails; timeout/network ambiguity becomes `uncertain_delivery`.

- [ ] **Step 2: Run and verify RED**

```powershell
bun test test/worker.test.ts
```

Expected: FAIL because `src/worker.ts` does not exist.

- [ ] **Step 3: Implement the scheduler and state machine**

Use a per-Session promise tail plus a small semaphore for global concurrency. Every state advance calls `store.transition` so the event and current row commit together. The execution order is `received → admitted → running → answered → sending → delivered`; failures append a classified event before `failed`. Persist the answer before calling Feishu. Offer every task to `preModelRoute.handle` before `chat.complete`, and store a `route_selected` event containing only the route name/version and sanitized status.

- [ ] **Step 4: Run and verify GREEN**

```powershell
bun test test/worker.test.ts
```

Expected: FIFO, bounded concurrency, duplicate suppression, recovery, provider skipping, and cautious delivery tests pass.

- [ ] **Step 5: Commit**

```powershell
git add packages/feishu/src/worker.ts packages/feishu/test/worker.test.ts
git commit -m "feat(feishu): recover gateway tasks"
```

### Task 7: Trusted inventory/location pre-model route

**Files:**
- Create: `packages/feishu/src/inventory-route.ts`
- Create: `packages/feishu/test/inventory-route.test.ts`
- Modify: `packages/feishu/src/worker.ts`
- Modify: `packages/feishu/test/worker.test.ts`
- Modify: `packages/feishu/src/inventory-trace.ts`
- Modify: `packages/feishu/test/inventory-trace.test.ts`

**Interfaces:**
- Produces:

```ts
export type InventoryIntent =
  | { kind: "chat" }
  | { kind: "clarify" }
  | { kind: "lookup"; productTerm: string }
export function parseInventoryIntent(text: string): InventoryIntent
export function createInventoryRoute(input: {
  inventory: { execute(input: InventoryToolInput, context: TrustedFeishuContext): Promise<InventoryToolResult> }
  createContext: (task: GatewayTask) => TrustedFeishuContext
  record: (task: GatewayTask, events: readonly InventoryTraceEvent[]) => Promise<void>
}): PreModelRoute
```

- [ ] **Step 1: Write failing intent and route tests**

Add cases for `6001ZZ库存多少`, `6001ZZ在哪个货架`, `查一下 6001ZZ 的位置`, `商品“6001ZZ”库存`, inventory/location wording with no product term, ordinary chat mentioning “库存管理理念”, malicious SQL/write text, internal-code-only input, multiple confident product tokens, exact route result, one trusted service call, formatter output passed byte-for-byte, inventory failure text, trace emission, and zero `chat.complete` calls.

- [ ] **Step 2: Run and verify RED**

```powershell
bun test test/inventory-route.test.ts test/worker.test.ts test/inventory-trace.test.ts
```

Expected: FAIL because the route is absent.

- [ ] **Step 3: Implement confidence-gated parsing and trusted execution**

Recognize inventory/location only when a supported keyword is paired with exactly one quoted product term or one compact product token containing a letter/digit product pattern. Supported routing keywords are `库存`, `存货`, `货架`, `位置`, `在哪`, and `哪里`. Remove only surrounding query words and punctuation. Return `clarify` when the request clearly asks inventory/location but has no single safe term; return `chat` for ambiguous prose, SQL/write attempts, or multiple terms. `clarify` returns the fixed text `请告诉我需要查询的商品名称或型号。` without OpenCode or MySQL. `lookup` constructs only `{ productTerm }`, uses trusted context derived from the admitted task, calls the fixed inventory service once, records inventory events through the gateway trace, and returns its formatter text unchanged.

- [ ] **Step 4: Run and verify GREEN**

```powershell
bun test test/inventory-route.test.ts test/worker.test.ts test/inventory-trace.test.ts test/inventory-answer.test.ts
```

Expected: confident inventory/location messages skip OpenCode, ordinary chat still reaches OpenCode, and the approved answer remains exactly one product per line with no internal code or table.

- [ ] **Step 5: Commit**

```powershell
git add packages/feishu/src/inventory-route.ts packages/feishu/test/inventory-route.test.ts packages/feishu/src/worker.ts packages/feishu/test/worker.test.ts packages/feishu/src/inventory-trace.ts packages/feishu/test/inventory-trace.test.ts
git commit -m "feat(feishu): route inventory queries"
```

### Task 8: Gateway composition and executable entrypoint

**Files:**
- Create: `packages/feishu/src/gateway.ts`
- Create: `packages/feishu/src/index.ts`
- Create: `packages/feishu/test/gateway.test.ts`
- Modify: `packages/feishu/src/event-log.ts`
- Modify: `packages/feishu/test/event-log.test.ts`
- Modify: `packages/feishu/README.md`
- Modify: `packages/feishu/test/readme.test.ts`

**Interfaces:**
- Produces:

```ts
export type Gateway = {
  start(): Promise<void>
  idle(): Promise<void>
  stop(): Promise<void>
}
export function createGateway(input: {
  config: GatewayConfig
  feishu: FeishuPort
  chat: ChatPort
  inventoryRoute: PreModelRoute
  store: GatewayStore
  fallbackPath: string
}): Gateway
export async function main(env: Record<string, string | undefined>): Promise<void>
```

- [ ] **Step 1: Write the failing end-to-end package test**

Compose a fake Channel, real temporary SQLite, fake chat port, real inventory route with a fake fixed query adapter, and fake reply client. Cover direct chat, mentioned group thread, unmentioned group silence, same-chat Session continuity, cross-chat isolation, duplicate event suppression, restart recovery, tool-policy failure, provider failure with trace ID, exact inventory output with zero model calls, complete trace reconstruction, secret canaries, and graceful shutdown.

- [ ] **Step 2: Run and verify RED**

```powershell
bun test test/gateway.test.ts
```

Expected: FAIL because composition and entrypoint files do not exist.

- [ ] **Step 3: Implement composition and one-command startup**

`main` loads `.env.local` through Bun, validates configuration and DeepSeek before starting the Channel, opens `gateway.sqlite` and `fallback.jsonl` below the configured data directory, creates the MySQL preflight/pool/inventory service, builds the trusted route, creates one embedded OpenCode host, recovers tasks, and then starts Feishu. Register `SIGINT` and `SIGTERM` handlers that stop intake, drain/stop the worker, close Feishu/OpenCode/MySQL/SQLite, and never print secret-bearing error objects.

- [ ] **Step 4: Run and verify GREEN**

```powershell
bun test test/gateway.test.ts test/event-log.test.ts test/readme.test.ts
```

Expected: all package-level flows pass without real Feishu, DeepSeek, or MySQL network access.

- [ ] **Step 5: Commit**

```powershell
git add packages/feishu/src/gateway.ts packages/feishu/src/index.ts packages/feishu/test/gateway.test.ts packages/feishu/src/event-log.ts packages/feishu/test/event-log.test.ts packages/feishu/README.md packages/feishu/test/readme.test.ts
git commit -m "feat(feishu): compose chat gateway"
```

### Task 9: Verification, OpenSpec evidence, and real acceptance

**Files:**
- Modify: `openspec/changes/feishu-chat-gateway/tasks.md`
- Modify: `openspec/changes/mysql-inventory-query/tasks.md`
- Modify: `docs/superpowers/plans/2026-07-31-mysql-inventory-query.md`
- Modify: `packages/feishu/README.md`

**Interfaces:**
- Consumes all package interfaces.
- Produces verified task checkboxes and operator-facing evidence only; no new runtime behavior.

- [ ] **Step 1: Run the complete isolated package suite**

From `packages/feishu`:

```powershell
bun test
bun typecheck
bun run lint
```

Expected: all non-contract tests pass, the explicit MySQL contract test is skipped unless its opt-in variable is set, type checking succeeds, and lint reports zero errors/warnings.

- [ ] **Step 2: Run the explicit local MySQL contract**

Use the approved local password-file environment without printing values:

```powershell
bun run test:mysql-contract
```

Expected: MySQL 8.4.x, configured schema identity, required fields, `6001ZZ` total `200`, structured shelf reads, and zero writes.

- [ ] **Step 3: Run startup preflight without receiving messages**

Use the README preflight command. Expected: the configured model resolves to DeepSeek, Feishu field names are present, credentials are not printed, and no public listener is opened. Stop before the Channel begins if the command is in preflight-only mode.

- [ ] **Step 4: Run repository and OpenSpec checks**

From `D:\opencode`:

```powershell
openspec-cn validate feishu-chat-gateway --type change --strict --json
openspec-cn validate mysql-inventory-query --type change --strict --json
git diff --check
git status --short
```

Expected: both changes are valid, whitespace checks pass, historical T1 files remain unchanged, and only intentional files appear.

- [ ] **Step 5: Execute the published Feishu acceptance matrix**

Record traces for direct reply, mentioned group-thread reply, unmentioned group silence, same-chat memory, cross-chat isolation, duplicate suppression, restart continuity, forbidden-tool blocking, provider failure, exact inventory reply, and secret absence. The exact inventory acceptance reply is:

```text
6001ZZ（清油）（12×28×8）（货架号：B-11-13）上海涂众轴承库存200，备注：xxx
```

Each case must have one final reply at most and an append-only trace; any failed case keeps its OpenSpec task unchecked.

- [ ] **Step 6: Update task checkboxes and verify against specs**

Mark only demonstrated OpenSpec tasks complete. Then use `superpowers:verification-before-completion` and `openspec-verify-change` for both changes. Expected: no critical gap, inventory read accuracy at least 95%, policy/write/secret cases 100%, and both changes are ready for user-approved archive.

- [ ] **Step 7: Commit verification artifacts**

```powershell
git add openspec/changes/feishu-chat-gateway/tasks.md openspec/changes/mysql-inventory-query/tasks.md docs/superpowers/plans/2026-07-31-mysql-inventory-query.md packages/feishu/README.md
git commit -m "docs(feishu): record gateway verification"
```
