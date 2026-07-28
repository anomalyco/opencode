# Provider-local HTTP 400 Rate-limit Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retry non-standard HTTP 400 rate-limit responses only when the provider's `options.retry400RateLimit` setting is enabled.

**Architecture:** `SessionProcessor` reads the current provider's configuration when a processor is created and passes a boolean through the pure error-conversion path. `MessageV2.fromError` forwards that boolean to `ProviderError.parseAPICallError`, which uses it solely when classifying the specific HTTP 400 response.

**Tech Stack:** TypeScript, Effect, Bun test, Effect Schema configuration.

---

### Task 1: Specify opt-in error-classification behavior

**Files:**
- Modify: `packages/opencode/test/session/retry.test.ts:416-452`
- Modify: `packages/opencode/src/session/message-v2.ts:603-681`
- Modify: `packages/opencode/src/provider/error.ts:165-190`

- [ ] **Step 1: Write failing tests for disabled and enabled classification**

Update the existing HTTP 400 rate-limit test to call:

```ts
const result = MessageV2.fromError(error, { providerID, retry400RateLimit: true })
expect(result.data.isRetryable).toBe(true)
```

Add a second test using the same JSON body but no `retry400RateLimit` context option:

```ts
const result = MessageV2.fromError(error, { providerID })
expect(result.data.isRetryable).toBe(false)
expect(SessionRetry.retryable(result, retryProvider)).toBeUndefined()
```

Keep the generic HTTP 400 test and pass `retry400RateLimit: true` so it proves that the flag does not retry unrelated client errors.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `bun test test/session/retry.test.ts --timeout 30000 --only-failures`

Expected: the enabled test fails because `MessageV2.fromError` does not yet accept the context option and the current parser still retries by default.

- [ ] **Step 3: Thread the flag through error conversion**

Extend the context types and calls:

```ts
// packages/opencode/src/session/message-v2.ts
ctx: { providerID: ProviderV2.ID; aborted?: boolean; retry400RateLimit?: boolean }

const parsed = ProviderError.parseAPICallError({
  providerID: ctx.providerID,
  retry400RateLimit: ctx.retry400RateLimit,
  error: e,
})

// packages/opencode/src/provider/error.ts
input: { providerID: ProviderV2.ID; retry400RateLimit?: boolean; error: APICallError }

const rateLimitExceeded =
  input.retry400RateLimit === true &&
  input.error.statusCode === 400 &&
  typeof body?.detail === "string" &&
  body.detail.toLowerCase().includes("rate limit exceeded")
```

- [ ] **Step 4: Run the focused test to verify GREEN**

Run: `bun test test/session/retry.test.ts --timeout 30000 --only-failures`

Expected: all tests in the file pass.

### Task 2: Read the provider-local configuration at the execution boundary

**Files:**
- Modify: `packages/opencode/src/session/processor.ts:98-121`
- Test: `packages/opencode/test/session/retry.test.ts:416-452`

- [ ] **Step 1: Add a failing integration assertion for configuration-derived context**

Create a processor-level test using the existing session test fixture with a provider config containing:

```ts
provider: {
  test: {
    options: { retry400RateLimit: true },
  },
}
```

Feed it the existing HTTP 400 rate-limit `APICallError` and assert that the resulting assistant API error is retryable. Add the matching `false` configuration case and assert it is not retryable.

- [ ] **Step 2: Run the new processor test to verify RED**

Run: `bun test test/session/retry.test.ts --timeout 30000 --only-failures`

Expected: the enabled configuration case fails because `SessionProcessor` does not yet pass the setting into `MessageV2.fromError`.

- [ ] **Step 3: Read and pass the provider option in `SessionProcessor.create`**

Capture the configuration once per created processor, before defining `parse`:

```ts
const cfg = yield* config.get()
const retry400RateLimit = cfg.provider?.[input.model.providerID]?.options?.retry400RateLimit === true

const parse = (e: unknown) =>
  MessageV2.fromError(e, {
    providerID: input.model.providerID,
    aborted,
    retry400RateLimit,
  })
```

Do not pass this setting to LLM provider construction or request options.

- [ ] **Step 4: Run the focused test to verify GREEN**

Run: `bun test test/session/retry.test.ts --timeout 30000 --only-failures`

Expected: the configured enabled and disabled cases pass.

### Task 3: Verify the complete change

**Files:**
- Verify: `packages/opencode/src/provider/error.ts`
- Verify: `packages/opencode/src/session/message-v2.ts`
- Verify: `packages/opencode/src/session/processor.ts`
- Verify: `packages/opencode/test/session/retry.test.ts`

- [ ] **Step 1: Run focused regression tests**

Run: `bun test test/session/retry.test.ts test/cli/run/footer.view.test.tsx --timeout 30000 --only-failures`

Expected: all selected tests pass; pre-existing keymap token diagnostics may be printed but no test fails.

- [ ] **Step 2: Run type checking**

Run: `bun typecheck`

Expected: `tsgo --noEmit` exits with code 0.

- [ ] **Step 3: Inspect the final diff**

Run: `git diff --check; git status --short`

Expected: no whitespace errors, no unmerged paths, and only the intended source/test files plus this plan.

- [ ] **Step 4: Commit the implementation**

```bash
git add packages/opencode/src/provider/error.ts packages/opencode/src/session/message-v2.ts packages/opencode/src/session/processor.ts packages/opencode/test/session/retry.test.ts
git commit -m "fix(opencode): gate 400 rate limit retries"
```
