# Code Review: feat/github-pr-integration

**Branch:** `feat/github-pr-integration` (based off `dev`)
**Scope:** ~3,300 lines added across 25 files — backend PR operations, SDK generation, and frontend UI.

---

## Issues

### 1. ~~Branch name regex allows path traversal in later segments~~ COMPLETED

**Severity:** High | **Status:** Fixed
**File:** `packages/opencode/src/project/pr.ts:53`

The `DeleteBranchInput` regex `^(?![^/]*\.\.)[a-zA-Z0-9][a-zA-Z0-9._\-/]*$` uses a negative lookahead that only checks the first path segment (before the first `/`). Multi-segment paths containing `..` pass validation:

```
"a/b/../c"            → passes (should fail)
"a/b/../../etc/passwd" → passes (should fail)
```

While Bun's `$` template literal prevents command injection and git treats refnames literally, the stated intent is to block `..` traversal and the regex fails to do so.

**Fix:** Use a regex that rejects `..` anywhere:

```ts
branch: z.string().regex(/^(?!.*\.\.)(?!.*\/\/)(?!\/)(?!.*\/$)[a-zA-Z0-9][a-zA-Z0-9._\-/]*$/, "Invalid branch name")
```

Or use a simpler `.refine()` check: `.refine(s => !s.includes('..'), "Invalid branch name")`.

---

### 2. ~~`ensureGithub()` returns `Required<GithubCapability>` but `repo` can be undefined~~ COMPLETED

**Severity:** Medium | **Status:** Fixed
**File:** `packages/opencode/src/project/pr.ts:195`

`ensureGithub()` casts the return to `Required<Vcs.GithubCapability>`, claiming `repo` and `host` are always present. But `detectGithubCapability()` can return `{ available: true, authenticated: true }` without `repo` when `gh repo view` fails (e.g., detached worktree, network issues, non-GitHub remote).

The `merge()` function safely re-checks `github?.repo` at line 305, but `create()` at line 204 destructures `{ info }` and never checks `info.github.repo` — it doesn't use `repo` directly, so it's safe by accident. Future code relying on the `Required<>` type won't be safe.

**Fix:** Don't cast to `Required<>`. Instead, return the narrowed type:

```ts
return { info, github: github as Vcs.GithubCapability & { available: true; authenticated: true } }
```

Or add a `repo` check to `ensureGithub` and return a properly narrowed type.

---

### 3. ~~`CreateInput` schema lacks `min(1)` on title — empty string passes validation~~ COMPLETED

**Severity:** Medium | **Status:** Fixed
**File:** `packages/opencode/src/project/pr.ts:35`

`title: z.string()` allows empty strings. The frontend guards against this (`!store.title.trim()`), but the API endpoint doesn't. A direct API call with `title: ""` would attempt to create a PR with an empty title.

**Fix:** Add a `min(1)` constraint and reasonable max limits (GitHub's API doesn't document explicit limits, but practical limits exist):

```ts
title: z.string().min(1).max(1024),
body: z.string().optional(),
```

The `min(1)` on `title` is the essential fix. Max limits are a safeguard against accidental abuse.

---

### 4. ~~Race condition in `PR.create()` — TOCTOU on `info.pr`~~ COMPLETED

**Severity:** Medium | **Status:** Fixed
**File:** `packages/opencode/src/project/pr.ts:207-209`

`create()` checks `info.pr` to short-circuit if a PR already exists, but `info` comes from cached VCS state. Two concurrent `create()` calls could both see `info.pr` as `undefined`, push to origin, and both call `gh pr create`. The second call would fail with a `gh` error (GitHub rejects duplicate PRs), which is handled, but the push would have already happened.

The `POST /pr` route is documented as "Idempotent — returns existing PR if one exists" but this is only true at the state cache level, not at the git/GitHub level.

**Fix:** This is low-risk since `gh` is the final arbiter, but if true idempotency is desired, refresh VCS state before the check:

```ts
await Vcs.refresh()
const { info } = await ensureGithub()
```

---

### 5. ~~Event reducer omits `branches` field from `vcs.updated` event type~~ COMPLETED

**Severity:** Medium | **Status:** Fixed
**File:** `packages/app/src/context/global-sync/event-reducer.ts:262-268`

The `vcs.updated` event type cast omits `branches`:

```ts
const props = event.properties as {
  branch?: string
  defaultBranch?: string
  dirty?: number
  pr?: VcsInfo["pr"]
  github?: VcsInfo["github"]
  // missing: branches?: string[]
}
```

The server publishes `branches` in the event (`vcs.ts:293`). At runtime the `...props` spread will include it, but the explicit type annotation is incomplete and misleading for future maintainers.

**Fix:** Add `branches?: string[]` to the type annotation.

---

### 6. ~~Route error handling diverges from project convention~~ COMPLETED

**Severity:** Medium | **Status:** Fixed
**File:** `packages/opencode/src/server/routes/vcs.ts` (all handlers)

Every other route file in the project (session, project, file, config, etc.) lets errors propagate to the global `onError` handler in `server.ts`. The VCS routes use local try/catch blocks instead. This is because `PrError` extends `Error` (not `NamedError`), so the global handler would return 500 for what should be 400.

**Fix:** `NamedError` uses a static `create()` factory (not a constructable base class), so the integration pattern is different from a simple `extends`. Create a named error via the factory and add a status mapping to the global handler:

```ts
// In pr.ts — create a NamedError subclass via the factory
export const PrError = NamedError.create("PrError", z.object({ code: ErrorCode, message: z.string() }))
export type PrError = InstanceType<typeof PrError>
```

Then in `server.ts`, add a clause to the global `onError` handler:

```ts
else if (err instanceof PrError) status = err.data.code === "NO_PR" ? 404 : 400
```

This lets you remove all try/catch blocks from the VCS route handlers, aligning with the project's error handling convention.

**Note:** This changes how `PrError` is constructed — all `throw new PrError(code, msg)` calls would become `throw new PrError({ code, message: msg })`.

---

### 7. ~~`clearInterval` used on `setTimeout` handle~~ COMPLETED

**Severity:** Low | **Status:** Fixed
**File:** `packages/opencode/src/project/vcs.ts:364`

The cleanup function uses `clearInterval(pollTimer)` but `pollTimer` is set via `setTimeout` (line 273). While this works in practice (both clear the same timer queue in Bun/Node), it's semantically incorrect.

**Fix:** Change to `clearTimeout(pollTimer)`.

---

### 8. ~~`address-comments` prompt includes unsanitized comment body text~~ COMPLETED

**Severity:** Low | **Status:** Fixed
**File:** `packages/app/src/components/dialog-address-comments.tsx:100`

Review comment bodies from GitHub are interpolated directly into the agent prompt:

```ts
text += `**@${comment.author}** (comment ID: ${comment.id}): ${comment.body}\n`
```

A malicious review comment could contain text designed to manipulate the agent (prompt injection). This is inherent to the feature design (the whole point is to pass comments to the agent), but worth noting that there's no sanitization or structural separation between the instruction portion and the user-controlled content.

**Fix:** Consider wrapping user-controlled content in a fenced block:

```ts
text += `**@${comment.author}** (comment ID: ${comment.id}):\n\`\`\`\n${comment.body}\n\`\`\`\n`
```

This doesn't prevent prompt injection but provides structural separation.

---

### 9. ~~`PR.create()` returns `info.branch` which may be stale~~ COMPLETED

**Severity:** Low | **Status:** Fixed
**File:** `packages/opencode/src/project/pr.ts:254`

In the fallback return (lines 249-261), `headRefName` is set to `info.branch` — the branch name from the cached VCS state snapshot taken _before_ the push and PR creation. If the branch name somehow changed between the state read and the PR creation, this would be wrong.

This is extremely unlikely in practice, but for consistency with the rest of the function (which refreshes state via `Vcs.refresh()`), the branch should come from the refreshed state.

**Fix:** Use `(await Vcs.info()).branch` or move the fallback before the `Vcs.refresh()` call.

---

### 10. ~~`fetchForBranch` silently returns `undefined` on `gh pr view` stderr errors~~ COMPLETED

**Severity:** Low | **Status:** Fixed
**File:** `packages/opencode/src/project/pr.ts:96-101`

`gh pr view` is called with `.nothrow()`, and if the command writes to stderr (e.g., auth errors, rate limiting), the output goes to `result` only if it's on stdout. The function checks `if (!result.trim()) return undefined` — but on error, `gh` may write nothing to stdout and everything to stderr, causing a silent `undefined` return with no logging for what might be a transient error.

The outer `catch` at line 180-183 does log, but this path (empty stdout, non-zero exit code) hits the early return at line 101-102, not the catch.

**Fix:** Remove `.text()` to get the full result object, then check `exitCode` before parsing:

```ts
const result =
  await $`gh pr view --json number,url,title,state,headRefName,baseRefName,isDraft,mergeable,reviewDecision,statusCheckRollup`
    .quiet()
    .nothrow()
    .cwd(cwd)
if (result.exitCode !== 0) {
  log.warn("gh pr view failed", { stderr: result.stderr.toString() })
  return undefined
}
const text = result.stdout.toString().trim()
if (!text) return undefined
const parsed = JSON.parse(text)
```

---

### 11. Hardcoded GitHub status colors bypass design system tokens

**Severity:** Low
**File:** `packages/app/src/utils/pr-style.ts:4-8`

The PR pill and button styles use hardcoded hex colors (`#8957e5`, `#da3633`, `#238636`, `#768390`) rather than design system tokens. This will clash with custom themes and doesn't respect the existing `text-icon-success-base` / `text-icon-critical-base` token pattern used elsewhere (e.g., `pr-button.tsx:109-111`).

**Fix:** Use the project's semantic tokens:

```ts
if (pr.state === "MERGED") return "border-border-info-base/40 bg-surface-info-weak text-text-info"
if (pr.state === "CLOSED") return "border-border-critical-base/40 bg-surface-critical-weak text-text-danger"
```

---

### 12. ~~`PR.create()` idempotency check doesn't refresh before reading~~ COMPLETED

**Severity:** Low | **Status:** Fixed
**File:** `packages/opencode/src/project/pr.ts:207`

The idempotency check `if (info.pr) return info.pr` reads from cached state without refreshing. If a PR was created outside opencode (e.g., on github.com) since the last poll, the cached state won't know about it, and `create()` will attempt to create a duplicate (which `gh` will reject).

This is the same issue as #4 but from the perspective of external PR creation. Low severity because `gh pr create` would return a clear error.

**Fix:** Call `await Vcs.refresh()` before the idempotency check, or document that the idempotency is best-effort.

---

### 13. ~~Merge doesn't verify PR is mergeable before attempting~~ COMPLETED

**Severity:** Medium | **Status:** Fixed
**File:** `packages/opencode/src/project/pr.ts:295-310`

The `merge()` function doesn't check `currentPr.mergeable` before calling the GitHub merge API. The frontend shows a conflict warning and disables the button, but the backend doesn't enforce it. A direct API call can attempt to merge a PR with conflicts.

```ts
const currentPr = await get()
if (!currentPr) {
  throw new PrError("NO_PR", "...")
}
// No check for mergeable === "CONFLICTING"
const strategy = input.strategy ?? "squash"
```

**Fix:** Add server-side validation:

```ts
if (currentPr.mergeable === "CONFLICTING") {
  throw new PrError("MERGE_FAILED", "PR has merge conflicts that must be resolved first")
}
```

---

### 14. ~~Wrong HTTP status code for `NO_PR` errors~~ COMPLETED

**Severity:** Medium | **Status:** Fixed
**File:** `packages/opencode/src/server/routes/vcs.ts:109-114`

All `PrError` codes return 400, but `NO_PR` is semantically a 404 (resource not found). Also, `GH_NOT_INSTALLED` and `GH_NOT_AUTHENTICATED` are client-side prerequisite failures — 400 is acceptable (the request is malformed given the current environment), though 424 (Failed Dependency) could also fit.

**Fix:** Map error codes to appropriate statuses:

```ts
const status = e.code === "NO_PR" ? 404 : 400
return c.json({ code: e.code, message: e.message }, { status })
```

---

### 15. ~~No timeout on GitHub CLI commands~~ COMPLETED

**Severity:** Medium | **Status:** Fixed
**File:** Multiple (`pr.ts`, `pr-comments.ts`, `vcs.ts`)

All `gh` subprocess calls have no timeout. On slow networks, GitHub Enterprise with rate limiting, or when `gh` hangs waiting for input, these commands block indefinitely.

```ts
const result = await $`gh pr view --json ...`.quiet().nothrow().cwd(cwd).text()
```

**Fix:** Bun's `$` shell does **not** have a `.timeout()` method. Use `Promise.race()` instead:

```ts
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))])
}

const result = await withTimeout($`gh pr view --json ...`.quiet().nothrow().cwd(cwd).text(), 30_000)
```

Alternatively, consider using `Bun.spawn()` which supports a `timeout` option, though that would require a larger refactor.

---

### 16. ~~Error messages may expose sensitive data~~ COMPLETED

**Severity:** Medium | **Status:** Fixed
**File:** `packages/opencode/src/project/pr.ts:214-216, 233-235`

Raw stderr/stdout from `git push` and `gh pr create` is passed directly into `PrError` messages and returned to clients. These may contain file paths, environment variables, or token fragments depending on git configuration and hooks.

```ts
const errorOutput = push.stderr?.toString().trim() || push.stdout?.toString().trim()
throw new PrError("CREATE_FAILED", errorOutput)
```

**Fix:** Truncate and sanitize error output:

```ts
function sanitize(output: string): string {
  return output.replace(/(ghp_|github_pat_)[a-zA-Z0-9_]+/g, "<redacted>").slice(0, 500)
}
```

---

### 17. ~~Branch deletion after merge — silent failure and ordering risk~~ COMPLETED

**Severity:** Medium | **Status:** Fixed
**File:** `packages/opencode/src/project/pr.ts:345-354`

If merge succeeds but branch deletion fails (network timeout, permissions), the error is silently swallowed with only a `log.warn`. The user gets a success response but the branch isn't cleaned up, and there's no UI indication of the partial failure.

```ts
try {
  await deleteBranch({ branch: branchToDelete })
} catch (e) {
  log.warn("post-merge branch deletion failed", { branch: branchToDelete, error: e })
}
```

**Fix:** Return a response that indicates partial success, or surface the branch deletion failure to the client:

```ts
const result: Vcs.PrInfo & { branchDeleteFailed?: boolean } = updated.pr ?? { ...currentPr, state: "MERGED" }
try {
  await deleteBranch({ branch: branchToDelete })
} catch (e) {
  log.warn("post-merge branch deletion failed", { branch: branchToDelete, error: e })
  result.branchDeleteFailed = true
}
```

**Note:** The `branchDeleteFailed` field would also need to be added to the `Vcs.PrInfo` Zod schema (or returned as a separate response type) to be properly typed and serialized through the API.

---

### 18. ~~PrComments pagination has no upper bound~~ COMPLETED

**Severity:** Low | **Status:** Fixed
**File:** `packages/opencode/src/project/pr-comments.ts:93-167`

The `do...while` pagination loop has no page limit. On PRs with hundreds of review threads, this could issue many sequential GraphQL requests with no cap.

**Fix:** Add a maximum page count:

```ts
const MAX_PAGES = 10
let page = 0
do {
  if (++page > MAX_PAGES) {
    log.warn("pr-comments: max pages reached, truncating")
    break
  }
  // ...
} while (cursor)
```

---

### 19. ~~Inconsistent error handling in delete-branch dialog~~ COMPLETED

**Severity:** Low | **Status:** Fixed
**File:** `packages/app/src/components/dialog-delete-branch.tsx:42-47`

The delete-branch dialog catches errors with a generic toast, unlike every other dialog which uses `resolveApiErrorMessage` to extract structured error context.

```ts
} catch {
  showToast({
    variant: "error",
    icon: "circle-x",
    title: language.t("pr.error.delete_branch_failed"),
  })
}
```

**Fix:** Use consistent error handling matching the other dialogs:

```ts
} catch (e: unknown) {
  showToast({
    variant: "error",
    icon: "circle-x",
    title: resolveApiErrorMessage(e, language.t("pr.error.delete_branch_failed"), (k) =>
      language.t(k as Parameters<typeof language.t>[0])
    ),
  })
}
```

---

### 20. ~~`remoteBranchExists` defaults to `true` while data is loading~~ COMPLETED

**Severity:** Low | **Status:** Fixed
**File:** `packages/app/src/components/pr-button.tsx:70-75`

```ts
const remoteBranchExists = createMemo(() => {
  const branchName = pr()?.headRefName
  const branches = vcs()?.branches
  if (!branchName || !branches) return true // defaults to true
  return branches.includes(branchName)
})
```

When branch data hasn't loaded yet, this defaults to `true`, which could briefly show the "Delete branch" menu item for a merged PR even if the branch is already gone.

**Fix:** Default to `undefined` or `false` when data isn't available, and guard the UI accordingly.

---

### 21. Stale PR data in delete branch dialog

**Severity:** Low
**File:** `packages/app/src/components/dialog-delete-branch.tsx:26`

The dialog reads `pr()` from the sync context, which may be stale (e.g., user has multiple tabs, VCS poll hasn't fired). The `headRefName` used for deletion could theoretically reference a branch that no longer matches the current state.

**Fix:** Fetch fresh VCS state on dialog mount, or show the branch name prominently with a confirmation step (the dialog already shows the branch name, so this is partially addressed).

---

### 22. ~~No validation that base branch exists before PR creation~~ COMPLETED

**Severity:** Low | **Status:** Fixed
**File:** `packages/opencode/src/project/pr.ts:221`

```ts
if (input.base) args.push("--base", input.base)
```

If a user specifies a non-existent base branch, they get an opaque error from `gh pr create` rather than a clear validation error.

**Fix:** Validate against known branches:

```ts
if (input.base) {
  const branches = await Vcs.fetchBranches()
  if (!branches.includes(input.base)) {
    throw new PrError("CREATE_FAILED", `Base branch '${input.base}' does not exist`)
  }
  args.push("--base", input.base)
}
```

---

## Summary

The implementation is well-structured and follows most project conventions. 22 issues identified:

| Severity | Count | Key items                                                                                                                                                                                                                             |
| -------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High     | 1     | Branch name regex (#1)                                                                                                                                                                                                                |
| Medium   | 10    | Type safety (#2), input validation (#3), race conditions (#4, #5), conventions (#6), merge validation (#13), HTTP status (#14), timeouts (#15), error exposure (#16), merge+delete ordering (#17)                                     |
| Low      | 11    | Timer mismatch (#7), prompt injection (#8), stale state (#9, #12, #21), silent errors (#10), hardcoded colors (#11), pagination bounds (#18), inconsistent error handling (#19), loading defaults (#20), base branch validation (#22) |

**Must fix before merge:** ~~#1 (regex)~~, ~~#3 (input validation)~~, ~~#13 (merge validation)~~, ~~#14 (HTTP status codes)~~ — all done.
**Should fix:** ~~#2~~, ~~#5~~, ~~#6~~, ~~#15~~, ~~#16~~, ~~#17~~ — all done.
**Can follow up:** ~~#7~~, ~~#8~~, ~~#9~~, ~~#10~~, #11, ~~#12~~, ~~#18~~, ~~#19~~, ~~#20~~, #21, ~~#22~~ — 2 remaining (#11, #21).

---

## Verification Notes

All 22 fix recommendations were verified against the source code. **4 corrections were applied:**

1. **Fix #3** — Removed specific GitHub title/body max limits (256/65536) as they are not documented in the GitHub REST API. Changed to recommend `min(1)` (essential) with reasonable safeguard max.
2. **Fix #6** — Rewrote the `NamedError` integration. `NamedError` is an abstract class with a `static create()` factory pattern, not a direct `extends` target. The fix now shows the correct `NamedError.create()` pattern.
3. **Fix #14** — Removed 503 suggestion for `GH_NOT_INSTALLED`/`GH_NOT_AUTHENTICATED`. These are client-side prerequisite failures, not server unavailability. Changed to 400 (or 424 as alternative).
4. **Fix #15** — Bun's `$` shell does **not** have a `.timeout()` method (confirmed at runtime). Changed to recommend `Promise.race()` pattern or `Bun.spawn()` which does support timeout.
