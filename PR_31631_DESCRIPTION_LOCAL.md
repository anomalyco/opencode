# fix(app): keep distinct manually added folders when global project metadata includes sandbox paths

## Related issue
- #31631

## Problem
After upgrading, users could no longer keep multiple folders with the same name from different parent directories in the project list (for example, `.../a/client` and `.../b/client`).

## Root cause
`packages/app/src/context/layout.tsx` builds a sandbox-to-root map from `serverSync().data.project` and then normalizes open projects to their computed root directory.

The mapping previously included **all** project metadata entries, including the `global` project entry. The global entry can carry many sandbox paths, so distinct user-added directories could be remapped into a single root and collapsed in the UI.

## What changed
1. Added `sandboxRoots(...)` in `packages/app/src/context/layout-helpers.ts`.
2. Updated layout root normalization in `packages/app/src/context/layout.tsx` to use `sandboxRoots(...)`.
3. `sandboxRoots(...)` now skips `global` project metadata so global sandbox entries do not collapse distinct manually added folders.
4. Added regression tests in `packages/app/src/context/layout-helpers.test.ts`:
   - verifies non-global sandbox mapping remains intact
   - verifies global project sandboxes are ignored

## Why this fix
- Preserves intended sandbox-root normalization for non-global projects.
- Prevents unintended deduplication/collapse of user-added directories caused by global project metadata.
- Keeps the change scoped to root mapping behavior with low surface area.

## Validation
Attempted:
- `bun --cwd /home/calelin/dev/opencode/packages/app test src/context/layout-helpers.test.ts src/pages/layout/helpers.test.ts`
- `pnpm --dir /home/calelin/dev/opencode/packages/app typecheck`

Result in current environment:
- `bun` not found
- `tsgo` not found (`node_modules` missing)

Regression test coverage has been added and should pass in a fully provisioned app package environment.

## Risk and compatibility
- Low risk: change is localized to root mapping logic for project normalization.
- Existing non-global sandbox behavior is preserved.
- The fix only changes treatment of `global` project sandboxes to avoid accidental project collapsing.

Co-Authored-By: Oz <oz-agent@warp.dev>
