# Codex Connection Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bounded pre-output retries, Codex-specific 60/360-second timeouts, and one-time OAuth recovery without changing terminal or session semantics.

**Architecture:** Add a focused HTTP transport at the ChatGPT Codex OAuth fetch boundary. It owns per-attempt header timeout, status/network retry, first-SSE-event inspection, raw-byte replay, and inter-chunk timeout. `codex.ts` continues to own OAuth and WebSocket setup; existing parser/session retry remains authoritative after output begins.

**Tech Stack:** TypeScript, Bun, Fetch/Streams APIs, OpenAI Responses SSE, `ws`, Bun test.

---

## Files

- Create `packages/opencode/src/plugin/openai/codex-http.ts` — HTTP timeout/retry and first-event gate.
- Create `packages/opencode/test/plugin/codex-http.test.ts` — isolated transport tests.
- Modify `packages/opencode/src/plugin/openai/codex.ts` — integration, OAuth recovery, WebSocket defaults.
- Modify `packages/opencode/test/plugin/codex.test.ts` — OAuth and integration tests.
- Modify `packages/opencode/test/plugin/openai-ws.test.ts` — 60/360 WebSocket option coverage.
- Create `/home/dunghd/DEVELOPMENT/Research/docs/9router-codex-connection-stability.md` — requested Vietnamese analysis.

## Invariants

1. Never retry after exposing an SSE event.
2. Never rotate accounts or endpoints.
3. Never synthesize terminal events or extra `[DONE]` frames.
4. Preserve non-2xx status, body, and headers.
5. Abort stops reads, backoff, refresh, and later attempts.
6. Accepted bytes and tool calls are emitted exactly once.

---

### Task 1: Codex status/network retry transport

**Files:**
- Create: `packages/opencode/src/plugin/openai/codex-http.ts`
- Create: `packages/opencode/test/plugin/codex-http.test.ts`

- [ ] **Step 1: Write failing retry-policy tests**

Create table tests for 502 (3 retries, 3000 ms), 503 (3, 2000 ms), 504 (2, 3000 ms), and network failure using injected `fetch` and `sleep` functions:

```ts
test.each([
  [502, 3, 3_000],
  [503, 3, 2_000],
  [504, 2, 3_000],
] as const)("retries %d before exposing a response", async (status, retries, delay) => {
  let calls = 0
  const waits: number[] = []
  const response = await fetchCodexHTTP("https://chatgpt.test/responses", {}, {
    fetch: async () => ++calls <= retries ? new Response("retry", { status }) : sse(CREATED),
    sleep: async (ms) => void waits.push(ms),
  })
  expect(calls).toBe(retries + 1)
  expect(waits).toEqual(Array(retries).fill(delay))
  expect(await response.text()).toBe(CREATED)
})
```

- [ ] **Step 2: Run RED test**

From `packages/opencode`:

```bash
bun test test/plugin/codex-http.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement retry policy and injectable options**

Use this public shape:

```ts
export const CODEX_HEADER_TIMEOUT = 60_000
export const CODEX_CHUNK_TIMEOUT = 360_000

const POLICY = {
  502: { attempts: 3, delay: 3_000 },
  503: { attempts: 3, delay: 2_000 },
  504: { attempts: 2, delay: 3_000 },
} as const

export interface CodexHTTPOptions {
  fetch?: typeof globalThis.fetch
  sleep?: (ms: number, signal?: AbortSignal | null) => Promise<void>
  headerTimeout?: number
  chunkTimeout?: number
}

export async function fetchCodexHTTP(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: CodexHTTPOptions = {},
): Promise<Response>
```

Track independent counters for network/connect failures, HTTP 502, HTTP 503, HTTP 504, `server_is_overloaded`, and `service_unavailable_error`. Network/header-timeout failures use the same numeric policy as HTTP 502 but do not consume the HTTP 502 counter. The two SSE codes use the same numeric policy as HTTP 503 but do not consume the HTTP 503 counter or each other's counter. Cancel failed response bodies before retry. `abortableSleep` must reject immediately when `RequestInit.signal` aborts; this signal is the public cancellation contract.

- [ ] **Step 4: Implement per-attempt 60-second header timeout**

`fetchAttempt` must combine caller and timeout signals with `AbortSignal.any`, clear its timer in `finally`, and distinguish caller abort from timeout. Do not use a total timeout covering all retries.

- [ ] **Step 5: Run GREEN test and inspect diff**

```bash
bun test test/plugin/codex-http.test.ts
git diff -- packages/opencode/src/plugin/openai/codex-http.ts packages/opencode/test/plugin/codex-http.test.ts
```

Expected: tests PASS; only the new module and tests appear. Do not commit unless requested.

---

### Task 2: First-SSE-event gate and 360-second chunk timeout

**Files:**
- Modify: `packages/opencode/src/plugin/openai/codex-http.ts`
- Modify: `packages/opencode/test/plugin/codex-http.test.ts`

- [ ] **Step 1: Write failing framing and safety tests**

Add separate cases for:

- LF and CRLF event boundaries.
- Boundary split across chunks.
- UTF-8 code point split across chunks.
- Exact byte replay once.
- Immediate return after accepting the first event.
- Structured first-event codes `server_is_overloaded` and `service_unavailable_error` each use an independent counter with the 503 numeric policy.
- The same text inside `response.output_text.delta` does not retry.
- Retry exhaustion exposes one final upstream error stream.
- Abort while reading or sleeping starts no later attempt.
- First event larger than 64 KiB fails safely.

Core assertion:

```ts
expect(calls).toBe(2)
expect(await response.text()).toBe(successBytes)
expect(exposedOverloadBytes).toBe(0)
```

- [ ] **Step 2: Run RED tests**

```bash
bun test test/plugin/codex-http.test.ts
```

- [ ] **Step 3: Implement byte-safe event detection**

Scan raw bytes for `[10, 10]` and `[13, 10, 13, 10]`; do not search a decoded string. Buffer at most 64 KiB. Parse only `data:` lines from the first complete event and retry only when parsed JSON has `type: "error"` with an approved structured code.

Use unchanged buffered chunks when rebuilding the accepted stream:

```ts
for (const chunk of buffered) controller.enqueue(chunk)
while (true) {
  const part = await readWithTimeout(reader, chunkTimeout, signal)
  if (part.done) break
  controller.enqueue(part.value)
}
controller.close()
```

- [ ] **Step 4: Add raw-chunk timeout**

Wrap every `reader.read()` after headers, including the first event, with a fresh 360-second timer. Each received chunk resets the budget. On timeout, cancel the reader and throw `ProviderError.ResponseStreamError("Codex SSE read timed out")`.

- [ ] **Step 5: Preserve response semantics**

Return non-2xx responses unchanged after status retry is exhausted. Do not inspect 401/403/429 as SSE. For malformed 2xx non-SSE responses, return a status-200 `Response` whose body is a `ReadableStream` that fails with `ProviderError.ResponseStreamError`; include content type and a bounded body preview in the error. This preserves the declared `Promise<Response>` contract while surfacing a typed stream failure.

- [ ] **Step 6: Run focused suite**

```bash
bun test test/plugin/codex-http.test.ts
```

Expected: all retry, framing, timeout, replay, and abort cases PASS.

---

### Task 3: Install Codex-specific 60/360 defaults

**Files:**
- Modify: `packages/opencode/src/plugin/openai/codex.ts:101-105,263-266,320-425`
- Modify: `packages/opencode/test/plugin/codex.test.ts`
- Modify: `packages/opencode/test/plugin/openai-ws.test.ts`

- [ ] **Step 1: Write failing option-plumbing tests**

Extend plugin options with injectable test values and assert the OAuth loader disables the generic OpenAI timeout wrapper:

```ts
expect(loaded.headerTimeout).toBe(false)
expect(loaded.chunkTimeout).toBe(false)
```

Assert production WebSocket defaults are connect `60_000` and idle/send `360_000`.

- [ ] **Step 2: Run RED tests**

```bash
bun test test/plugin/codex.test.ts test/plugin/openai-ws.test.ts
```

- [ ] **Step 3: Extend plugin options**

```ts
interface CodexAuthPluginOptions {
  issuer?: string
  codexApiEndpoint?: string
  experimentalWebSockets?: boolean
  httpHeaderTimeout?: number
  httpChunkTimeout?: number
  websocketConnectTimeout?: number
  websocketIdleTimeout?: number
}
```

- [ ] **Step 4: Configure WebSocket and HTTP paths**

Create the pool with Codex defaults:

```ts
OpenAIWebSocketPool.createWebSocketFetch({
  httpFetch: fetch,
  connectTimeout: options.websocketConnectTimeout ?? CODEX_HEADER_TIMEOUT,
  idleTimeout: options.websocketIdleTimeout ?? CODEX_CHUNK_TIMEOUT,
})
```

Replace the direct HTTP call with `fetchCodexHTTP` using the HTTP option values. Return `headerTimeout: false` and `chunkTimeout: false` from the OAuth loader so the generic 10-second OpenAI header timer cannot terminate the whole retry sequence. API-key OpenAI behavior stays unchanged.

- [ ] **Step 5: Run integration tests and typecheck**

```bash
bun test test/plugin/codex-http.test.ts test/plugin/codex.test.ts test/plugin/openai-ws.test.ts test/provider/header-timeout.test.ts
bun typecheck
```

Expected: PASS; typecheck exits 0.

---

### Task 4: One-time 401 refresh and safe token rotation

**Files:**
- Modify: `packages/opencode/src/plugin/openai/codex.ts:94-99,333-425`
- Modify: `packages/opencode/test/plugin/codex.test.ts:195-290`

- [ ] **Step 1: Write failing OAuth tests**

Add tests proving:

- Missing/empty `refresh_token` preserves `refresh-old`.
- Concurrent 401 responses cause exactly one token refresh.
- Reissued requests use the new access/account ID and byte-identical request bodies.
- A second 401 is returned without a third request.
- Abort after the first 401 prevents refresh/reissue.
- 403 and 429 remain unchanged.

- [ ] **Step 2: Run RED OAuth tests**

```bash
bun test test/plugin/codex.test.ts
```

- [ ] **Step 3: Make refresh rotation optional**

Change `TokenResponse.refresh_token` to optional for refresh responses and persist:

```ts
refresh: tokens.refresh_token?.trim() || currentAuth.refresh
```

Initial authorization must still require a usable refresh token.

- [ ] **Step 4: Refactor one single-flight refresh owner**

The refresh helper accepts the access token that failed. Before starting refresh, reload auth; if another caller already installed a different access token, reuse it. Otherwise share `refreshPromise`. This prevents concurrent 401 callers from refreshing twice.

- [ ] **Step 5: Reissue exactly once**

```ts
const first = await send(currentAccess)
if (first.status !== 401 || init?.signal?.aborted) return first
await first.body?.cancel()
const refreshed = await refresh(currentAccess)
return send(refreshed.access, refreshed.accountId)
```

Do not use recursive calls and do not refresh on 403/429.

- [ ] **Step 6: Run OAuth and transport tests**

```bash
bun test test/plugin/codex.test.ts test/plugin/codex-http.test.ts
```

Expected: all tests PASS; concurrent 401 calls share one refresh.

---

### Task 5: Write Vietnamese 9Router analysis

**Files:**
- Create: `/home/dunghd/DEVELOPMENT/Research/docs/9router-codex-connection-stability.md`

- [ ] **Step 1: Write verified analysis**

Cover request lifecycle, OAuth/client ID, refresh behavior, account fallback, exact timeout comparison, retry budgets, SSE buffering, terminal handling, lack of true resume, adopted mechanisms, rejected gateway-only mechanisms, changed files, and verification evidence.

- [ ] **Step 2: Scan placeholders and secrets**

```bash
rg -n "TBD|TODO|Bearer |sk-|refresh[_-]?token" "/home/dunghd/DEVELOPMENT/Research/docs/9router-codex-connection-stability.md"
```

Expected: no placeholders or real credentials. Field names may be discussed without values.

---

### Task 6: Final verification and review

**Files:**
- Review every file changed by Tasks 1-5.

- [ ] **Step 1: Run focused OpenCode tests**

From `packages/opencode`:

```bash
bun test test/plugin/codex-http.test.ts test/plugin/codex.test.ts test/plugin/openai-ws.test.ts test/provider/header-timeout.test.ts
bun typecheck
```

Expected: all tests PASS and typecheck exits 0.

- [ ] **Step 2: Inspect complete diff**

```bash
git status --short
git diff --check
git diff -- packages/opencode/src/plugin/openai packages/opencode/test/plugin packages/opencode/test/provider docs/superpowers
git diff --no-index /dev/null docs/superpowers/specs/2026-07-17-codex-connection-reliability-design.md
git diff --no-index /dev/null docs/superpowers/plans/2026-07-17-codex-connection-reliability.md
```

Expected: no whitespace errors, secrets, account/endpoint fallback, or terminal-protocol changes. The two `--no-index` commands may exit 1 because they intentionally display new untracked files; inspect their content rather than treating exit 1 as a failure. Inspect `/home/dunghd/DEVELOPMENT/Research/docs/9router-codex-connection-stability.md` separately because it is outside the repository.

- [ ] **Step 3: Smoke-test connection stability**

Use the already-working OpenAI OAuth model selection. Run one normal response and one tool call. Confirm both complete once without connection interruption, duplicated text, or duplicated tool execution. Do not change or retest model lowering/service-tier behavior.

- [ ] **Step 4: Independent review**

Review for retry after exposed output, timer/body leaks, lost HTTP semantics, duplicate tool events, API-key timeout regressions, and terminal behavior changes.

- [ ] **Step 5: Report evidence**

Report changed files, exact tests/typechecks, smoke-test result, and limitations. Do not commit or push unless explicitly requested.
