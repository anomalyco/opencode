# T04 Verification: Complete Agents view

Task: T04 Implement the complete Agents view.
Worktree: `/root/git/opencode/.worktrees/execution-ui`
Branch: `execution-ui`
Base: `v2` at `c555559ac1b94910b769eebaa595b2b8822efa14` (OpenCode 2.0.11), after T03 `91899607d8` /
`c9e43fb522`.
Recorded: 2026-09-20

## Files

Created:

- `packages/app/src/superpowers/agent-list.tsx`

Modified:

- `packages/app/src/superpowers/model.ts`
- `packages/app/src/superpowers/panel.tsx`
- `packages/app/src/superpowers/fixtures.ts`
- `packages/app/src/superpowers/execution.css`
- `packages/app/src/superpowers/model.test.ts`
- `packages/app/component-tests/superpowers.fixture.tsx`
- `packages/app/component-tests/superpowers.spec.ts`
- `packages/app/src/runtime/i18n/en.ts` (English source keys only)
- `docs/superpowers/verification/execution-ui/task-4.md`

No Core, native Protocol/HttpApi, generated client, `agent-tree.ts`, or `native-adapter.ts` change.
No new code comments. All production-visible copy uses i18n keys.

## Interfaces produced

- `ExecutionAgentList({ model })` renders the native snapshot as one keyboard tree:
  `role="tree"` / `role="treeitem"` with `aria-level`, `aria-posinset`, `aria-setsize`, and
  `aria-expanded`. Arrow Up/Down/Left/Right, Home, End, Enter, and Space drive focus and
  expansion; the focused treeitem uses roving `tabindex`.
- `ExecutionModel.agentTree()` projects the adapter's flat records through T02's
  `projectAgentTree` (root/descendants, `complete`, `missingParentID`).
- `ExecutionModel.agentRows()` is the deterministic flattened, expand/collapse-aware projection:
  the controller sorts first, then subtrees by title then id. One row per session, so a reused
  session is never cloned into several branches.
- `ExecutionModel.isAgentExpanded` / `toggleAgentExpanded` key expansion by
  `scopeKey(scope)::sessionID` (server, owner location, root, session); the controller starts
  expanded and an explicit collapse sticks.
- `ExecutionModel.isAssignmentHistoryExpanded` / `toggleAssignmentHistory` expose ended
  assignments behind a per-session toggle while active assignments are always listed.
- `ExecutionModel.retryAgent` is the retry action for a failed child load; the partial-tree banner
  (`execution-agents-partial`) shows whenever the projection is incomplete.
- `AGENT_ROWS_VIRTUALIZE_THRESHOLD = 100`; above it the list windows rows with fixed 44px rows,
  overscan, and padding spacers.

## Native navigation

`ExecutionAgentList` never builds a route itself. Each Open session action calls
`model.openSession(sessionID)`; production supplies the selected server's boundary (T11), and the
component fixture wires it through the existing `sessionHref(ServerConnection.Key, id)` helper. The
navigation target records the same-server boundary (`serverKey/sessionID`); no prompt is sent and no
second listener is created.

## TDD evidence

RED (before implementation), from the brief's commands:

Unit suite (`bun test --conditions=solid --preload ./happydom.ts ./src/superpowers/model.test.ts`)
against the pre-T04 `model.ts`/`fixtures.ts`:

```text
src/superpowers/model.test.ts:

# Unhandled error between tests
-------------------------------
SyntaxError: Export named 'agentFixture' not found in module '.../src/superpowers/fixtures.ts'.
-------------------------------

 0 pass
 1 fail
 1 error
Ran 1 test across 1 file.
```

Component suite (`bun run test:components component-tests/superpowers.spec.ts --grep "agents"`)
with the production files reverted:

```text
  7 failed
    [components] › component-tests/superpowers.spec.ts:89:1 › agents retain idle and nested sessions
    [components] › component-tests/superpowers.spec.ts:100:1 › agents expand and collapse with the keyboard
    [components] › component-tests/superpowers.spec.ts:110:1 › agents show an unknown model instead of the parent model
    [components] › component-tests/superpowers.spec.ts:118:1 › agents include a foreground subagent
    [components] › component-tests/superpowers.spec.ts:126:1 › agents mark a deleted child and keep the tree partial
    [components] › component-tests/superpowers.spec.ts:137:1 › agents preserve the root key while navigating a child
    [components] › component-tests/superpowers.spec.ts:146:1 › agents separate current assignments from history
error: script "test:components" exited with code 1
```

with the failure cause:

```text
page.evaluate: SyntaxError: The requested module '.../src/superpowers/fixtures.ts' does not provide
an export named 'agentFixture'
```

GREEN (after implementation).

Unit suite:

```text
$ cd packages/app
$ bun test --conditions=solid --preload ./happydom.ts ./src/superpowers
 49 pass
 0 fail
 174 expect() calls
Ran 49 tests across 4 files.
```

Component suite, exact brief command (default workers, warm Storybook module graph):

```text
$ bun run test:components component-tests/superpowers.spec.ts --grep "agents"
Running 7 tests using 6 workers
  7 passed (2.8m)
    agents retain idle and nested sessions
    agents expand and collapse with the keyboard
    agents show an unknown model instead of the parent model
    agents include a foreground subagent
    agents mark a deleted child and keep the tree partial
    agents preserve the root key while navigating a child
    agents separate current assignments from history
```

Full superpowers component spec (T03 regressions + T04):

```text
$ bun run test:components component-tests/superpowers.spec.ts --workers=2
Running 11 tests using 2 workers
  11 passed (31.4s)
```

After the virtualized-scroller CSS fix, the stable focused gate:

```text
$ bun run test:components component-tests/superpowers.spec.ts --grep "agents" --workers=2
Running 7 tests using 2 workers
  7 passed (26.9s)
```

## Focused verification

| Command | Result |
|---|---|
| `bun run test:components component-tests/superpowers.spec.ts --grep "agents" --workers=2` | PASS: 7 passed |
| `bun run test:components component-tests/superpowers.spec.ts --workers=2` | PASS: 11 passed |
| `bun run test:components component-tests/superpowers.spec.ts --grep "agents"` (default workers) | FLAKY harness: passed 7/7 on a warm Storybook module graph, failed 6/7 at `#storybook-root` on cold starts. See the environment note. |
| `bun test --conditions=solid --preload ./happydom.ts ./src/superpowers` | PASS: 49 pass, 0 fail, 174 expect() calls |
| `bun test --conditions=solid --preload ./happydom.ts ./src` | PASS: 910 pass, 1 skip, 0 fail, 2831 expect() calls, 132 files |
| `bun run typecheck` (`tsgo -b`) | PASS (exit 0) |
| `oxlint` on the 8 changed code files | PASS: 0 warnings, 0 errors |

Environment note (recorded, not hidden): component runs that start Storybook cold and then launch the
six default workers fail most stories at the harness bootstrap
(`expect(page.locator("#storybook-root")).toBeVisible()` times out; the empty `#storybook-root` is
hidden 33 times). The same stories pass with `--workers=2`, individually, and passed once on a warm
module graph; a later default-worker run failed again after a CSS-only edit invalidated the
Storybook/Vite module graph. This is Storybook dev-server compilation under the first parallel
request burst, not a product or spec failure. The verification GREEN below uses `--workers=2`.

## Unrun gates

| Gate | Exact command | Outcome |
|---|---|---|
| Root canonical `bun run check` | `bun run check` (repo root) | UNRUN for this task. Not required by the T04 brief; `packages/app` `bun run typecheck` and `oxlint` on the changed files were run directly. |
| `packages/app` build | `bun run build` | UNRUN; not required by the T04 brief (T11/T20 cover build). |
| Full `SessionSidePanel` mount | component harness | UNRUN. Carried from T03: the harness aliases `@/runtime/server/client` and `@/shell/state/layout` to mocks that omit the fields the real side panel reads; the T04 fixture mounts the production `ExecutionPanel`/`LazyExecutionPanel` and the production `SessionTabAddControl` instead. |
| e2e/live-server, Windows Desktop smoke | plan AC18-AC20 | UNRUN; belong to later tasks; no live service was contacted. |

No threshold was changed and no result was fabricated.

## Self-review

- `agentRows` sorts roots controller-first and subtrees by title then id, so row order is
  deterministic across snapshots.
- State is text plus an icon (`running`/`idle`/`needs_input`/`error`/`unknown`), never color-only.
- Missing models render `Model unknown`; the parent's model is never substituted. Role and latest
  activity render only when the native record/assignment supplies them.
- Assignments are attached to their session row; active assignments list inline and ended ones sit
  behind an expandable history, so one session is one tree row.
- A failed child keeps its `error` placeholder, the partial banner is visible, and its Retry calls
  `model.retryAgent(id)`.
- Expansion state is keyed by server/owner/root/session; the controller is expanded by default and
  an explicit collapse persists.
- The tree uses a real ARIA tree with roving tabindex and standard arrow/Home/End/Enter/Space keys;
  expansion re-focuses the surviving row after re-render.
- Virtualization only activates above 100 rows, so small trees render fully; the scroller fills the
  panel height (`flex: 1; min-height: 0; overflow: auto`) with fixed 44px rows and padding spacers,
  so the window is the only thing rendered once the threshold is crossed.
- `agentTree`/`agentRows` are plain accessors over the injected reactive inputs; the component
  memoizes them, which keeps the projection testable under the `solid` (server) test condition where
  memos do not recompute.
