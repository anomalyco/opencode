# ACP Session Move Rebinding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `opencode acp` survive session/worktree moves by rebinding directory-scoped state, notifying clients, and preserving recovery context.

**Architecture:** `ACPSessions` consumes `session.moved`, serializes rebinds per attached session, updates the stable attachment's `cwd`, restarts only its catalog watcher, re-registers MCP servers, and emits `session_info_update`. Turn context reads the current `cwd`; mismatch errors carry the actual directory.

**Tech Stack:** TypeScript, Effect v4, Bun 1.4.4, `@agentclientprotocol/sdk` 1.6.0, OpenCode generated client.

**Spec:** `docs/superpowers/specs/2026-11-26-acp-session-move-design.md`

## Global Constraints

- Base `dev`; branch `acp-session-move`; conventional commits.
- Bun `1.4.4`; install dependencies before testing.
- No core `SessionMove`, ACP exact-`cwd`, Server `HttpApi`, generated-client, feature-flag, or Changeset changes.
- Preserve `Attached` identity so active/background turn bookkeeping survives.
- Read `.opencode/skills/unit-tests/SKILL.md` and `.opencode/skills/effect/SKILL.md` before editing.
- Run tests from `packages/cli`, never the repo root, with the 30-second package timeout.
- Avoid mocks, `globalThis`, `any`, non-null assertions, and generated-file edits.

## Review Focus

- Immediate client reload after notification must not race the old rebind (Task 2).
- Consecutive moves must serialize and leave the last directory active (Task 2).
- A mid-prompt move must redirect later permission locations (Task 3).
- A move while disconnected must be recoverable from the mismatch error (Task 1).
- Client MCP servers must be registered in the destination directory (Task 2).

---

### Task 0: Toolchain and green baseline

**Files:** No source changes.

**Interfaces:** Produces Bun 1.4.4 via `mise exec`, installed dependencies, and passing baseline tests.

- [ ] **Step 1: Install and verify Bun**

```bash
mise install bun@1.4.4
mise exec bun@1.4.4 -- bun --version
```

Expected: `1.4.4`.

- [ ] **Step 2: Install dependencies**

From the repo root: `mise exec bun@1.4.4 -- bun install`. Expected: success with no tracked-file changes.

- [ ] **Step 3: Run baseline tests**

From `packages/cli`: `mise exec bun@1.4.4 -- bun test test/acp/session.test.ts test/acp/permission.test.ts --timeout 30000 --only-failures`. Expected: PASS.

---

### Task 1: Include the real directory in mismatch errors

**Files:**
- Modify: `packages/cli/src/acp/error.ts:8-11,92-97`
- Modify: `packages/cli/src/acp/service.ts:98-104`
- Test: `packages/cli/test/acp/session.test.ts:53-114`

**Interfaces:**
- Consumes: `Session.Info.location.directory` from `getSession`.
- Produces: `SessionDirectoryMismatchError({ sessionId, cwd, directory })`; ACP error data `{ sessionId, cwd, directory }`.

- [ ] **Step 1: Extend the existing lifecycle test**

For `session/load`, `session/resume`, and `session/fork` with `cwd: "/elsewhere"`, assert code `-32602` and data `{ sessionId, cwd: "/elsewhere", directory: "/workspace" }`. Assert the load message contains `session directory: /workspace`. Remove the now-duplicated fork request.

- [ ] **Step 2: Verify red**

From `packages/cli`: `mise exec bun@1.4.4 -- bun test test/acp/session.test.ts --timeout 30000 --only-failures`. Expected: FAIL on missing `directory`/message text.

- [ ] **Step 3: Thread the actual directory through the error**

Add `directory: Schema.String` to `SessionDirectoryMismatchError`; include it in `toRequestError` data and message; pass `session.location.directory` from `getSession`.

- [ ] **Step 4: Verify green**

Run the same test command. Expected: PASS.

- [ ] **Step 5: Commit**

`git add packages/cli/src/acp/error.ts packages/cli/src/acp/service.ts packages/cli/test/acp/session.test.ts && git commit -m "fix(acp): include moved directory in load errors"`

---

### Task 2: Rebind attached sessions and notify clients

**Files:**
- Modify: `packages/cli/src/acp/sessions.ts:15-191`
- Test: `packages/cli/test/acp/session.test.ts`
- Modify: `services/site/src/docs/content/cli/acp.mdx:118-157`

**Interfaces:**
- Consumes: `session.moved` with `data.location.directory`.
- Produces: mutable `Attached.cwd`; per-entry move queue, MCP list, catalog child scope, and lock; `_meta["opencode/directory"]`.
- Preserves: `Attached` identity and the entry scope owning turn fibers.

- [ ] **Step 1: Add the rebind wire test**

Test name: `rebinds an attached session when it moves and tells the client`. Attach at `/workspace` with one stdio MCP server; update the fake session to `/moved`; emit `session.moved`. Assert a `session_info_update` with exactly `_meta: { "opencode/directory": "/moved" }`, an MCP registration and model request under `/moved`, successful `session/load` with `/moved`, and no ACP logs.

- [ ] **Step 2: Add the consecutive-move wire test**

Test name: `serializes consecutive session moves`. Emit moves to `/moved-1` then `/moved-2`; await each matching directory notification; assert `session/load` with `/moved-2` succeeds.

- [ ] **Step 3: Verify red**

From `packages/cli`: `mise exec bun@1.4.4 -- bun test test/acp/session.test.ts --timeout 30000 --only-failures`. Expected: FAIL because ACP ignores the move.

- [ ] **Step 4: Extend subscription and entry state**

Add `MovedEvent = Extract<OpenCodeEvent, { type: "session.moved" }>` to the subscription filter. Add `moved`, `mcpServers`, `catalogScope: Scope.Closeable`, and `lock: Semaphore.Semaphore` to `Entry`; make `Attached.cwd` mutable. Fork the catalog watcher in a child `catalogScope`; keep the selection queue shared. Route moves to `entry.moved`.

- [ ] **Step 5: Implement the serialized rebind consumer**

Under `entry.lock`: ignore a same-directory move; load the destination catalog; abort if `sessions.get(id) !== entry`; update `attached.cwd`; clear/re-register MCP (log failures without detaching); replace only `catalogScope`; synchronously refresh config/commands; start the new watcher without a duplicate initial update; send the directory notification last. On catalog failure, keep the new `cwd`, notify, log, and let the next read/reload retry.

- [ ] **Step 6: Document the extension**

After the ACP Sessions section, document `session_info_update` with `_meta["opencode/directory"]`, its use for later load/resume/fork calls, and the mismatch error's `directory` data.

- [ ] **Step 7: Verify green and typecheck**

From `packages/cli`: run the session test command above, then `mise exec bun@1.4.4 -- bun typecheck`. Expected: PASS/PASS.

- [ ] **Step 8: Commit**

`git add packages/cli/src/acp/sessions.ts packages/cli/test/acp/session.test.ts services/site/src/docs/content/cli/acp.mdx && git commit -m "fix(acp): rebind sessions when their directory moves"`

---

### Task 3: Use the current directory during a moved turn

**Files:**
- Modify: `packages/cli/src/acp/turn.ts:393-407`
- Test: `packages/cli/test/acp/permission.test.ts`

**Interfaces:**
- Consumes: stable `Attached` with mutable `cwd`.
- Produces: `TurnContext.cwd` getter reading `attached.cwd` at use time.

- [ ] **Step 1: Add the mid-prompt permission test**

Test name: `uses the moved directory for permission locations during an active prompt`. The prompt hook emits `session.moved` to `/moved` and waits for the directory notification; it then emits an edit permission for `src/a.ts`. Assert the permission location is `/moved/src/a.ts`.

- [ ] **Step 2: Verify red**

From `packages/cli`: `mise exec bun@1.4.4 -- bun test test/acp/permission.test.ts --timeout 30000 --only-failures`. Expected: FAIL with `/workspace/src/a.ts`.

- [ ] **Step 3: Make turn context live**

Replace `cwd: attached.cwd` in the `TurnContext` object with `get cwd() { return attached.cwd }`.

- [ ] **Step 4: Verify green and typecheck**

Run the permission and session tests together, then `mise exec bun@1.4.4 -- bun typecheck`. Expected: PASS/PASS.

- [ ] **Step 5: Commit**

`git add packages/cli/src/acp/turn.ts packages/cli/test/acp/permission.test.ts && git commit -m "fix(acp): use current directory during moved turns"`

---

### Task 4: Verify and open the PR

**Files:** Review only.

**Interfaces:** Produces a verified branch pushed to `rh0kzy/opencode` and a PR against `anomalyco/opencode:dev`.

- [ ] **Step 1: Repeat focused tests**

From `packages/cli`: `mise exec bun@1.4.4 -- bun test test/acp/session.test.ts test/acp/permission.test.ts --rerun-each 10 --timeout 30000 --only-failures`. Expected: all PASS.

- [ ] **Step 2: Run the ACP suite**

From `packages/cli`: `mise exec bun@1.4.4 -- bun test test/acp --timeout 30000 --only-failures`. Expected: PASS.

- [ ] **Step 3: Run both CLI typechecks**

From `packages/cli`: `mise exec bun@1.4.4 -- bun typecheck` and `mise exec bun@1.4.4 -- bun run typecheck:tsc`. Expected: PASS/PASS.

- [ ] **Step 4: Run the canonical check**

From the repo root: `mise exec bun@1.4.4 -- bun run check`. Expected: lint/typecheck PASS; report any environment-limited failure precisely.

- [ ] **Step 5: Review the diff**

Run `git diff --check origin/dev...HEAD`, `git diff --stat origin/dev...HEAD`, and `git diff origin/dev...HEAD`. Confirm only ACP code/tests/docs and the two planning documents changed.

- [ ] **Step 6: Push**

`git push -u origin acp-session-move`.

- [ ] **Step 7: Open the PR**

Use `.github/pull_request_template.md`. Title: `fix(acp): rebind sessions when their directory moves`. Include `Closes #66573`, check **Bug fix**, briefly explain the missed event/full rebind, list verification commands, leave screenshots empty, check both checklist items, and state that no feature flag is needed.
