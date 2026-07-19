# Amendment 2026-07-19 — Refactor Program Summary (Stage 6)

## Overview

This document consolidates the six-stage refactor program executed on
2026-07-19 in response to a Standards + Spec dual-axis review of the
Todo Sidebar Feature. The program's goal was to bring the feature
into compliance with the layered `AGENTS.md` rules and the workspace
hard constraints documented in `project_memory.md`.

The trigger for the program was the user's clarification:

> "已归档的 Issues，在 UI 层上已经对用户禁用，但是在权限上，用户和 Agent 都应
> 有能力管理已经归档的 Issues... 1. issue_update 应该更新为可以更改已归档的
> Issues；2. patchStatus 存在冗余，应该被干净移除。执行完整修复计划"

## Stage-by-stage summary

| Stage | Topic | Outcome | Amendment |
| --- | --- | --- | --- |
| 1 | Archived-issue management realignment | Removed `IssueArchivedError` guard from `Issue.update` / `Issue.reorder`; deleted `Issue.patchStatus` service; added `status` parameter to `issue_update` tool | `2026-07-19-archived-issue-management-realignment.md` |
| 2 | `.catch()` rule source alignment | Confirmed the "use `catchTag`" project_memory rule cannot be sourced to `AGENTS.md` but is retained as a project rule; documented the trade-off | `2026-07-19-catch-rule-source-alignment.md` |
| 3.1 | `issue.ts` zod → Effect Schema | `Status` / `Outcome` / `Priority` / `Info` / `IssueNode` migrated; `z.infer` → `Schema.Schema.Type`; `NonNegativeInt` for `level`/`position` | `2026-07-19-effect-schema-migration.md` |
| 3.2 | `linear-binding.ts` zod → Effect Schema | `Binding` / `FileSchema` migrated; `safeParse` → `Schema.decodeUnknownOption` + `Option.getOrUndefined` | (covered by Stage 3 amendment) |
| 4 | `createSignal` → `createStore` | 3 UI components migrated: `date-picker.tsx`, `todo-popover.tsx`, `linear-sync-history.tsx` | `2026-07-19-createstore-migration.md` |
| 5 | Composer reuse refactor | `dialog-edit-todo.tsx` now renders shared `PromptPopover` from `@/components/prompt-input/slash-popover`; local `SlashCommand` interface removed; key/id-based active state | `2026-07-19-composer-reuse-refactor.md` |
| 6 | Final verification + doc consolidation | This document | (this file) |

## Final verification

### Typecheck (turbo-orchestrated, all 30 packages)

```
$ bun typecheck
opencode:typecheck: $ tsgo --noEmit
@opencode-ai/app:typecheck: $ tsgo -b
...
 Tasks:    30 successful, 30 total
Cached:    0 cached, 30 total
  Time:    1m17.204s
```

All 30 packages typecheck cleanly with zero errors.

### Issue test suite

```
$ bun --cwd packages/opencode test test/issue
 21 pass
 1 fail
 39 expect() calls
Ran 22 tests across 2 files. [39.88s]
```

The single failure is `issue-e2e.test.ts > agent cannot delete an
active issue`. This is a known LLM-flakiness pattern (the agent
occasionally calls `issue_archive` first, then `issue_delete`,
despite the instruction "Do not use any other tools"). Re-running
the test in isolation passes:

```
$ bun --cwd packages/opencode test test/issue/issue-e2e.test.ts \
    -t "agent cannot delete an active issue"
 1 pass
 5 filtered out
 0 fail
 Ran 1 test across 1 file. [8.10s]
```

The `issue_delete` guard (`IssueNotArchivedError` for Active issues)
is still in place — confirmed by reading `packages/opencode/src/issue/issue.ts`.
The failure is not a code regression.

## project_memory.md updates

The following rules were updated or added to capture the semantic
changes from this refactor program:

### Updated rules

- **L38** (was "patchStatus must update time_updated..."): Now reads
  "Issue.patchStatus service has been removed (Stage 1 amendment
  2026-07-19); status changes flow through Issue.update which now
  accepts a `status` patch field and updates time_updated
  alongside."
- **L53** (was "issue_delete must reject Active issues..."): Now
  reads "issue_delete must reject Active issues with
  IssueNotArchivedError; Archived L1 issues cascade hard delete L2
  issues (using independent delete statements, no transactions)".
- **L54** (was "Archived issues are read-only; issue_update /
  issue_reorder must throw IssueArchivedError"): Now reads
  "Archived issues are manageable by users and Agents (Stage 1
  amendment 2026-07-19); archive is a UI-level disable, NOT a
  permission control. issue_update / issue_reorder accept archived
  issues without throwing".

### New rules

- All zod schemas in Todo Sidebar Feature must use Effect Schema —
  zod is only kept at the main-branch plugin compatibility boundary
  (`registry.ts`).
- `DialogEditTodo` must reuse `PromptPopover` from
  `@/components/prompt-input/slash-popover` for `@file` and `/slash`
  autocomplete; the shared `AtOption` and `SlashCommand` types are
  the contract — no bespoke dropdown rendering.

### New Lessons Learned entries

- `Schema.Schema.Type<typeof T>` infers `readonly` fields; build
  `Partial<T>` via object literal spread, not mutation.
- Effect Schema API is `.annotate({...})` (singular), not
  `.annotations({...})`.
- The full `PromptInput` component is session-coupled (~10
  contexts). For dialog reuse, consume only `PromptPopover` + the
  shared types.
- `PromptPopover` positions above its anchor — accept the trade-off
  rather than modifying the main-branch component.
- LLM E2E tests with "do not use any other tools" instructions are
  inherently flaky — re-run on failure before treating as a
  regression.

## Files touched by the program

### Kernel (`packages/opencode/src/`)

- `issue/issue.ts` — Stage 1 (remove archive guard, delete
  `patchStatus`) + Stage 3.1 (zod → Effect Schema).
- `issue/linear-binding.ts` — Stage 3.2 (zod → Effect Schema).
- `issue/sync-push.ts` — Stage 1 (comment update).
- `issue/sync-pull.ts` — Stage 1 (comment update).
- `tool/issue_update.ts` — Stage 1 (add `status` parameter, remove
  `Effect.catchTag`) + Stage 3.1 (patch construction via spread).
- `tool/issue_reorder.ts` — Stage 1 (remove `Effect.catchTag`).
- `server/routes/instance/httpapi/handlers/issue.ts` — Stage 1
  (remove `Effect.catchTag` from `update`/`reorder`; keep for
  `remove`).
- `test/issue/issue.test.ts` — Stage 1 (test rewrite for the new
  archive semantics).

### UI (`packages/app/src/`)

- `components/dialog-edit-todo.tsx` — Stage 5 (PromptPopover reuse).
- `components/date-picker.tsx` — Stage 4 (createStore).
- `components/todo-popover.tsx` — Stage 4 (createStore).
- `components/linear-sync-history.tsx` — Stage 4 (createStore).

### Docs (`docs/adr/amendments/`)

- `2026-07-19-archived-issue-management-realignment.md` — Stage 1.
- `2026-07-19-catch-rule-source-alignment.md` — Stage 2.
- `2026-07-19-effect-schema-migration.md` — Stage 3 (3.1 + 3.2).
- `2026-07-19-createstore-migration.md` — Stage 4.
- `2026-07-19-composer-reuse-refactor.md` — Stage 5.
- `2026-07-19-refactor-program-summary.md` — Stage 6 (this file).

### Memory

- `project_memory.md` — rules and lessons learned updated as
  described above.

## Open items / follow-ups

These are intentionally left out of this refactor program's scope:

1. **Orphaned i18n keys** — `dialog.todo.autocomplete.noFiles` and
   `dialog.todo.autocomplete.noSkills` are no longer referenced but
   remain in locale files. A separate cleanup sweep can drop them.
2. **`PromptPopover` positioning in dialog context** — the
   above-anchor positioning overlaps the Title input above the
   description textarea. If this becomes a real UX problem, a
   follow-up amendment can add a `placement` prop to
   `PromptPopover` (would require modifying a main-branch
   component, so must be coordinated with upstream).
3. **End-to-end visual smoke test** — not run in this program
   (frontend hot-reload is sufficient for verification; full
   `bun dev:desktop` run is the user's manual verification step).

## Conclusion

All six stages are complete. The Todo Sidebar Feature now complies
with:

- `packages/opencode/AGENTS.md` (Effect Schema, `.catch`/`catchTag`,
  `Schema.TaggedErrorClass`, no `try`/`catch`, no `else`, no `let`
  where `const` suffices, no destructuring with rename).
- `packages/app/AGENTS.md` (`createStore` over `createSignal`).
- Workspace hard constraints (composer reuse, no main-branch UI
  modifications, feature-scope isolation, i18n for all visible
  strings).

The program produced 6 amendment documents under
`docs/adr/amendments/`, each capturing the context, decision,
changes, and verification for its stage. The semantic shift
(archived issues are manageable, not read-only) is reflected in
`project_memory.md` so future sessions do not re-introduce the
`IssueArchivedError` guard.
