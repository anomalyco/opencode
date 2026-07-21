# Amendment 2026-07-19 — `.catch()` Rule Source Alignment

## Context

The project_memory rule "Effect.catch must use catchTag with \_tag
field for precise error handling, allowing defects (Interrupt/Die) to
propagate" was applied during review. User asked to trace this rule
back to `opencode/AGENTS.md` and **use AGENTS.md as the source of
truth**.

## Rule Traceability Audit

| Source                                     | Text                                                                                              | Scope                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `AGENTS.md` (repo root) line 27            | "Avoid `try`/`catch` where possible"                                                              | JS `try/catch` blocks                 |
| `packages/core/src/tool/AGENTS.md` line 28 | "do not use `catchCause`, because interruption and defects must survive"                          | Effect `catchCause`                   |
| `packages/opencode/AGENTS.md` lines 91-96  | Schema rules (`Schema.Class`, `Schema.brand`, `Schema.TaggedErrorClass`) — **no `.catch()` rule** | —                                     |
| `project_memory.md` line 56                | "Effect.catch must use catchTag with \_tag field..."                                              | **Cannot be traced to any AGENTS.md** |

### Codebase Convention

The opencode main codebase uses `Effect.catch(...)` (without
`catchTag`) in 10+ files:

- `src/worktree/index.ts` (5 occurrences)
- `src/format/index.ts` (1)
- `src/effect/promise.ts` (1)
- `src/issue/sync-pull.ts` (7 — in the Todo Sidebar feature)
- `src/issue/sync-push.ts` (3 — in the Todo Sidebar feature)

The `Effect.catch` form is the established codebase convention.

## Decision

**Per user instruction "以 AGENTS.md 为准":**

1. **Retain** root `AGENTS.md` "Avoid `try`/`catch` where possible" —
   this applies to JS `try/catch` blocks. The Todo Sidebar feature
   files were audited: **zero JS `try/catch` blocks** in
   `packages/opencode/src/issue/`, `packages/opencode/src/tool/issue_*.ts`,
   `packages/app/src/pages/layout/sidebar-*.tsx`, or
   `packages/app/src/components/{dialog-edit-todo,linear-sync-history,todo-popover,date-picker}.tsx`.
   (`Effect.tryPromise({ try, catch })` is the Effect API for wrapping
   promises, not a JS `try/catch` block — out of scope.)

2. **Retain** `packages/core/src/tool/AGENTS.md` "do not use
   `catchCause`" — already observed; no `catchCause` usage in feature
   files.

3. **Do NOT enforce** project_memory's "Effect.catch must use catchTag"
   rule — it has no AGENTS.md source and conflicts with the codebase
   convention. `Effect.catch` (without `catchTag`) is acceptable.

4. **Update project_memory.md** — delete the rule "Effect.catch must
   use catchTag with \_tag field for precise error handling, allowing
   defects (Interrupt/Die) to propagate" and replace with:

   > 遵守根 AGENTS.md "Avoid `try`/`catch` where possible"：JS 代码用
   > `.catch(...)` 替代 try/catch；Effect 代码用 `Effect.catch` 或
   > `Effect.catchTag` 均可（与代码库惯例一致）；不用
   > `Effect.catchCause`（per packages/core/src/tool/AGENTS.md）

## Action Required (Manual)

The `project_memory.md` file at
`/Users/tk/.trae-cn/memory/projects/-Users-tk-repositories-OpenCode-Feature/project_memory.md`
is outside the repo workspace and cannot be edited by the agent tools.
User needs to manually apply the rule replacement above.

## Verification

- `grep -rn "^\s*try\s*{" packages/opencode/src/issue/ packages/opencode/src/tool/issue_*.ts` — no matches
- `grep -rn "^\s*try\s*{" packages/app/src/pages/layout/sidebar-*.tsx packages/app/src/components/{dialog-edit-todo,linear-sync-history,todo-popover,date-picker}.tsx` — no matches
- `grep -rn "catchCause" packages/opencode/src/issue/ packages/opencode/src/tool/issue_*.ts` — no matches
