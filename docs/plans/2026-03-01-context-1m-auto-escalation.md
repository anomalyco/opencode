# 1M Context Error-Retry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Gracefully handle Anthropic's "long context beta not available" error by retrying without the `context-1m` header, then remembering to skip it for the process lifetime. Zero config needed.

**Architecture:** Keep the `context-1m-2025-08-07` beta header in the static Anthropic loader (already present on this branch). In the fetch wrapper inside `getSDK()`, detect the specific Tier error from the response, retry the request without the header, and set a process-level flag to skip it on future requests.

**Tech Stack:** TypeScript, Vercel AI SDK

**Design doc:** `docs/plans/2026-03-01-context-1m-auto-escalation-design.md`

---

### Task 1: Add Error-Retry Logic to the Fetch Wrapper

**Files:**

- Modify: `packages/opencode/src/provider/provider.ts`

**Context:** The fetch wrapper is at line 1073 inside `getSDK()`. It's a closure that captures `model` from the outer scope. The `anthropic-beta` header including `context-1m-2025-08-07` is set statically in `CUSTOM_LOADERS["anthropic"]` at line 126.

**Step 1: Add process-level disabled flag**

At the top of the `Provider` namespace (after the `log` declaration, around line 49), add:

```typescript
let _context1mDisabled = false
```

**Step 2: Add retry logic in the fetch wrapper**

In the fetch wrapper (`options["fetch"] = async (input, init) => {`, line 1073), replace the final return statement. Currently (line 1106-1110):

```typescript
return fetchFn(input, {
  ...opts,
  // @ts-ignore see here: https://github.com/oven-sh/bun/issues/16682
  timeout: false,
})
```

Replace with:

```typescript
const response = await fetchFn(input, {
  ...opts,
  // @ts-ignore see here: https://github.com/oven-sh/bun/issues/16682
  timeout: false,
})

// Detect Anthropic "long context beta not available" error and retry without the header
if (!_context1mDisabled && model.api.npm === "@ai-sdk/anthropic" && response.status === 400) {
  const cloned = response.clone()
  const body = await cloned.json().catch(() => null)
  if (
    body?.error?.type === "invalid_request_error" &&
    typeof body?.error?.message === "string" &&
    body.error.message.toLowerCase().includes("long context")
  ) {
    log.info("context-1m beta not available, retrying without it")
    _context1mDisabled = true
    const headers = new Headers(opts.headers as HeadersInit)
    const beta = headers.get("anthropic-beta") ?? ""
    headers.set(
      "anthropic-beta",
      beta
        .split(",")
        .filter((h) => !h.includes("context-1m"))
        .join(","),
    )
    return fetchFn(input, {
      ...opts,
      headers,
      // @ts-ignore
      timeout: false,
    })
  }
}

return response
```

**Step 3: Strip `context-1m` from future requests when disabled**

At the top of the fetch wrapper (after `const opts = init ?? {}`, line 1076), add:

```typescript
// Skip context-1m header if previously detected as unavailable
if (_context1mDisabled && model.api.npm === "@ai-sdk/anthropic") {
  const headers = new Headers(opts.headers as HeadersInit)
  const beta = headers.get("anthropic-beta") ?? ""
  if (beta.includes("context-1m")) {
    headers.set(
      "anthropic-beta",
      beta
        .split(",")
        .filter((h) => !h.includes("context-1m"))
        .join(","),
    )
    opts.headers = headers
  }
}
```

**Step 4: Verify no type errors**

Run: `cd packages/opencode && npx tsc --noEmit`
Expected: No new errors

**Step 5: Describe and advance**

```bash
jj describe -m "feat(provider): auto-retry without context-1m header when account lacks access"
jj new
```

---

### Task 2: Tests

**Files:**

- Create: `packages/opencode/test/provider/context1m.test.ts`

**Step 1: Write tests for the retry behavior**

The retry logic is embedded in the fetch wrapper, which is hard to unit test in isolation. Instead, test the header-stripping logic and the flag behavior:

```typescript
import { describe, test, expect } from "bun:test"

describe("context-1m header stripping", () => {
  function strip(beta: string) {
    return beta
      .split(",")
      .filter((h) => !h.includes("context-1m"))
      .join(",")
  }

  test("strips context-1m from beta header", () => {
    const header =
      "claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14,adaptive-thinking-2026-01-28,context-1m-2025-08-07"
    expect(strip(header)).toBe(
      "claude-code-20250219,interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14,adaptive-thinking-2026-01-28",
    )
  })

  test("preserves other headers when context-1m is not present", () => {
    const header = "claude-code-20250219,interleaved-thinking-2025-05-14"
    expect(strip(header)).toBe("claude-code-20250219,interleaved-thinking-2025-05-14")
  })

  test("handles context-1m as only header", () => {
    expect(strip("context-1m-2025-08-07")).toBe("")
  })
})

describe("error detection", () => {
  test("matches the known Anthropic tier error", () => {
    const body = {
      error: {
        type: "invalid_request_error",
        message: "The long context beta is not yet available for this subscription.",
      },
    }
    const matches =
      body.error.type === "invalid_request_error" &&
      typeof body.error.message === "string" &&
      body.error.message.toLowerCase().includes("long context")
    expect(matches).toBe(true)
  })

  test("does not match unrelated errors", () => {
    const body = {
      error: {
        type: "invalid_request_error",
        message: "max_tokens must be less than 8192",
      },
    }
    const matches =
      body.error.type === "invalid_request_error" &&
      typeof body.error.message === "string" &&
      body.error.message.toLowerCase().includes("long context")
    expect(matches).toBe(false)
  })
})
```

**Step 2: Run the tests**

Run: `cd packages/opencode && bun test test/provider/context1m.test.ts`
Expected: All tests pass

**Step 3: Run existing tests for regressions**

Run: `cd packages/opencode && bun test test/session/compaction.test.ts`
Expected: All tests pass

**Step 4: Describe and advance**

```bash
jj describe -m "test(provider): add context-1m retry logic tests"
jj new
```

---

### Task 3: Verify End-to-End

**Step 1: Type check the full package**

Run: `cd packages/opencode && npx tsc --noEmit`
Expected: No errors

**Step 2: Run the full test suite**

Run: `cd packages/opencode && bun test`
Expected: All tests pass

**Step 3: Final describe**

```bash
jj describe -m "feat(provider): graceful context-1m fallback for sub-Tier-4 accounts"
```
