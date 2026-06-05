# Subagent Session Permission Merge Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `SessionPrompt.prompt` from wiping a subagent session's forwarded permission rules (external_directory + parent deny rules), which currently reintroduces the Plan-Mode edit bypass (#26514) and causes repeated permission prompts.

**Architecture:** The session-permission write in `src/session/prompt.ts` (driven by the deprecated `input.tools` field) currently **overwrites** `session.permission` wholesale. Change it to **merge**: keep every existing rule whose permission name is not being overridden by `input.tools`, then append the tool-toggle rules so they still win under `evaluate`'s last-match-wins semantics. Add a regression test that drives the real `SessionPrompt.prompt` path (the existing task-tool test stubs `prompt`, so it never exercised this code).

**Tech Stack:** TypeScript, Effect v4 / effect-smol, Bun test runner, opencode permission system (`packages/opencode`, `packages/core`).

---

## Background (verified facts the implementer must trust)

- **Bug location:** [`src/session/prompt.ts:1231-1238`](../../../packages/opencode/src/session/prompt.ts). `session.permission = permissions` replaces the whole ruleset.
- **Why subagents hit it:** [`src/tool/task.ts:144-159`](../../../packages/opencode/src/tool/task.ts) creates the subagent session with `deriveSubagentSessionPermission(...)` (parent agent edit denies + parent session external_directory/deny rules + todowrite/task denies). Then [`src/tool/task.ts:185-199`](../../../packages/opencode/src/tool/task.ts) calls `ops.prompt({ ..., tools: { todowrite: false?, task: false?, ...primary_tools:false } })`. For typical subagents `input.tools` is non-empty, so the overwrite fires and destroys the derived rules.
- **Where session.permission is consumed:** [`src/session/tools.ts:64-72`](../../../packages/opencode/src/session/tools.ts) builds `ruleset: Permission.merge(input.agent.permission, input.session.permission ?? [])` for every subagent tool call.
- **evaluate is last-match-wins:** [`packages/core/src/permission.ts:21-31`](../../../packages/core/src/permission.ts) — `rulesets.flat().findLast(...)`. So tool-toggle rules appended last keep priority; default is `ask` when nothing matches.
- **`input.tools` is deprecated:** [`src/session/prompt.ts:1687-1690`](../../../packages/opencode/src/session/prompt.ts) — "tools and permissions have been merged, you can set permissions on the session itself now." The overwrite is legacy behavior.
- **Existing test gap:** [`test/tool/task.test.ts:380-429`](../../../packages/opencode/test/tool/task.test.ts) uses `stubOps({ onPrompt })` — it stubs `prompt`, so the real overwrite at `prompt.ts:1236` is never run. [`test/agent/plan-mode-subagent-bypass.test.ts`](../../../packages/opencode/test/agent/plan-mode-subagent-bypass.test.ts) only tests the `deriveSubagentSessionPermission` helper in isolation. Neither catches this bug.
- **Test harness for the real path:** [`test/session/prompt.test.ts:1-57`](../../../packages/opencode/test/session/prompt.test.ts) already defines `const it = testEffect(makeHttp())` providing `Session.Service` and `SessionPrompt.Service`. `prompt.prompt({ ..., noReply: true })` runs the overwrite (line 1231-1238) and returns at line 1240 **without needing an LLM response**.
- **`Permission` is already imported** in `prompt.ts` (used at line 394 and line 1223).

## File Structure

- Modify: `packages/opencode/src/session/prompt.ts` (lines 1231-1238) — change overwrite to merge.
- Modify: `packages/opencode/test/session/prompt.test.ts` — add one `it.instance` regression test using the existing `it`/`makeHttp()` harness (DRY: reuse the harness, do not build a new one).

No new files. No new exports. The change is localized.

---

### Task 1: Add the failing regression test

**Files:**
- Modify: `packages/opencode/test/session/prompt.test.ts` (append a new `it.instance(...)` block; the file already imports `Session`, `SessionPrompt`, `Permission`, `Effect`, `expect`, and defines `const it = testEffect(makeHttp())`)

- [ ] **Step 1: Write the failing test**

Append this block at the end of `packages/opencode/test/session/prompt.test.ts`, immediately before the final closing of the file's top-level test list (i.e., as a new top-level `it.instance(...)` alongside the other tests). Do not wrap it in a new `describe`.

```typescript
it.instance(
  "[regression] prompt merges input.tools into session.permission instead of overwriting it",
  () =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const prompt = yield* SessionPrompt.Service

      // Mirror a subagent session created by task.ts: it carries forwarded
      // parent restrictions that MUST survive the prompt call.
      //  - external_directory allow: a previously-approved external path
      //  - edit deny: the Plan-Mode hard restriction (#26514)
      const session = yield* sessions.create({
        title: "subagent",
        permission: [
          { permission: "external_directory", pattern: "/outside/*", action: "allow" },
          { permission: "edit", pattern: "*", action: "deny" },
          { permission: "task", pattern: "*", action: "deny" },
        ],
      })

      // task.ts re-asserts tool toggles via the deprecated input.tools field.
      // noReply:true exercises the permission write (prompt.ts ~1223) and
      // returns before any LLM turn.
      yield* prompt.prompt({
        sessionID: session.id,
        agent: "build",
        noReply: true,
        tools: { task: false, todowrite: false },
        parts: [{ type: "text", text: "hello" }],
      })

      const updated = yield* sessions.get(session.id)

      // Forwarded rules survive (the bug dropped these).
      expect(updated.permission).toContainEqual({
        permission: "external_directory",
        pattern: "/outside/*",
        action: "allow",
      })
      expect(updated.permission).toContainEqual({ permission: "edit", pattern: "*", action: "deny" })

      // input.tools toggles are applied.
      expect(updated.permission).toContainEqual({ permission: "task", pattern: "*", action: "deny" })
      expect(updated.permission).toContainEqual({
        permission: "todowrite",
        pattern: "*",
        action: "deny",
      })

      // No duplicate "task" rule from a naive concat-merge.
      expect(updated.permission?.filter((rule) => rule.permission === "task")).toHaveLength(1)
    }),
)
```

- [ ] **Step 2: Run the test to verify it FAILS (red)**

Run (from `packages/opencode`):

```bash
bun test test/session/prompt.test.ts -t "merges input.tools"
```

Expected: FAIL. With the current overwrite, `updated.permission` is `[{ permission: "task", pattern: "*", action: "deny" }, { permission: "todowrite", pattern: "*", action: "deny" }]`, so the first `toContainEqual` for `external_directory` fails with a message like `expected [ ... ] to contain { permission: 'external_directory', pattern: '/outside/*', action: 'allow' }`.

- [ ] **Step 3: Commit the failing test**

```bash
git add packages/opencode/test/session/prompt.test.ts
git commit -m "test(session): regression for subagent permission overwrite"
```

---

### Task 2: Fix the overwrite (merge instead of replace)

**Files:**
- Modify: `packages/opencode/src/session/prompt.ts:1231-1238`

- [ ] **Step 1: Replace the overwrite with a merge**

Current code (lines 1231-1238):

```typescript
      const permissions: PermissionV1.Rule[] = []
      for (const [t, enabled] of Object.entries(input.tools ?? {})) {
        permissions.push({ permission: t, action: enabled ? "allow" : "deny", pattern: "*" })
      }
      if (permissions.length > 0) {
        session.permission = permissions
        yield* sessions.setPermission({ sessionID: session.id, permission: permissions })
      }
```

Replace with:

```typescript
      const permissions: PermissionV1.Rule[] = []
      for (const [t, enabled] of Object.entries(input.tools ?? {})) {
        permissions.push({ permission: t, action: enabled ? "allow" : "deny", pattern: "*" })
      }
      if (permissions.length > 0) {
        // input.tools is a deprecated per-message tool toggle. It must layer on
        // top of the session's existing rules (e.g. a subagent's forwarded
        // external_directory + parent deny rules from deriveSubagentSessionPermission),
        // not replace them. evaluate() is last-match-wins, so appending the
        // toggles keeps them authoritative for their own permission names.
        const overridden = new Set(permissions.map((rule) => rule.permission))
        const merged = [
          ...(session.permission ?? []).filter((rule) => !overridden.has(rule.permission)),
          ...permissions,
        ]
        session.permission = merged
        yield* sessions.setPermission({ sessionID: session.id, permission: merged })
      }
```

- [ ] **Step 2: Run typecheck**

Run (from `packages/opencode`):

```bash
bun typecheck
```

Expected: exit code 0, no new errors in `src/session/prompt.ts`.

- [ ] **Step 3: Run the regression test to verify it PASSES (green)**

Run (from `packages/opencode`):

```bash
bun test test/session/prompt.test.ts -t "merges input.tools"
```

Expected: PASS (1 pass). `updated.permission` is now `[{ external_directory, /outside/*, allow }, { edit, *, deny }, { task, *, deny }, { todowrite, *, deny }]` (the pre-existing `task` deny is filtered out before the toggles are appended, so there is exactly one `task` rule).

- [ ] **Step 4: Commit the fix**

```bash
git add packages/opencode/src/session/prompt.ts
git commit -m "fix(session): merge input.tools into session permission instead of overwriting"
```

---

### Task 3: Guard against regressions in the broader permission/prompt suites

**Files:**
- No code changes. Verification only.

- [ ] **Step 1: Run the permission + prompt + task test suites**

Run (from `packages/opencode`):

```bash
bun test test/session/prompt.test.ts test/tool/task.test.ts test/agent/plan-mode-subagent-bypass.test.ts test/permission-task.test.ts
```

Expected: all PASS. In particular, [`test/tool/task.test.ts:380-429`](../../../packages/opencode/test/tool/task.test.ts) still passes because it stubs `prompt` (its assertion is on session-creation permission, which is unchanged), and the merge does not alter the session-creation path.

- [ ] **Step 2: Run the full package test suite once**

Run (from `packages/opencode`):

```bash
bun test
```

Expected: no new failures attributable to this change. If pre-existing unrelated failures exist, note them explicitly; do not fix them here.

- [ ] **Step 3: Final typecheck**

Run (from `packages/opencode`):

```bash
bun typecheck
```

Expected: exit code 0.

---

## Self-Review

**1. Spec coverage**
- "Stop the overwrite from wiping forwarded rules" → Task 2 (merge). ✓
- "Reproduce via the real runtime path, not the stubbed task-tool test" → Task 1 uses `SessionPrompt.prompt` with `noReply: true`. ✓
- "Don't break existing tool-toggle behavior / no duplicate rules" → Task 1 asserts `task`/`todowrite` denies present and de-duplicated; Task 3 runs task/permission suites. ✓
- "Security: #26514 edit-deny survives" → Task 1 asserts `edit: deny` survives. ✓

**2. Placeholder scan** — No TBD/TODO/"handle edge cases"/"similar to". Every code step has full code and exact run commands with expected output. ✓

**3. Type consistency**
- Rule shape `{ permission, pattern, action }` matches [`PermissionV1.Rule`](../../../packages/opencode/src/permission/index.ts) (`permission: string`, `pattern: string`, `action: Action`). ✓
- `permissions: PermissionV1.Rule[]` already declared at line 1231; `Permission` already imported. ✓
- `session.permission` is `Permission.Ruleset | undefined`; `?? []` guard and `setPermission({ sessionID, permission })` signature match [`session.ts:757-762`](../../../packages/opencode/src/session/session.ts). ✓
- `prompt.prompt` `PromptInput.tools` is `Record<string, boolean>` (optional) per [`prompt.ts:1687`](../../../packages/opencode/src/session/prompt.ts). ✓
- `sessions.create({ permission })` and `sessions.get(...).permission` usage matches [`task.test.ts:406-424`](../../../packages/opencode/test/tool/task.test.ts). ✓
