# Cedric Release Readiness

**Date:** June 14, 2026
**Branch:** `codex/cedric-workspace-release`
**Root:** `/Users/julien/Documents/Cedric`

## Status

Cedric is development-ready for review. No known core workspace or package-readiness blockers remain after the workspace surface work, Background Tasks recovery work, local Kimi bridge routing, and internal package-scope rename.

The committed release slice is intentionally broad:

- The branch tip contains 1,219 files.
- Diff against `dev` reports 19,701 insertions and 5,574 deletions.
- Five root-level smoke/helper scripts are kept local-only through `.git/info/exclude`.

Because this slice includes feature work, docs, generated SDK/OpenAPI files, and package-scope rename churn, review the committed diff before opening the PR.

## Proposed PR

Title:

```text
feat: prepare Cedric workspace release
```

Summary:

```markdown
## Summary

- add the Cedric multi-tab workspace surface with Browser, file, code, markdown, Terminal, Side Chat, context handoffs, persisted tabs, and tab ergonomics
- add Background Tasks lifecycle visibility, persisted task snapshots, restart-orphan retry/recovery, live running detail, and workspace action requests
- wire the local Kimi bridge path and complete the internal scoped package rename to `@cedric/*`
- refresh docs, setup handoffs, SDK/OpenAPI output, and package hygiene needed for package-level validation

## Validation

- `bun install`
- `./packages/sdk/js/script/build.ts`
- `cd packages/core && bun test test/background-job.test.ts`
- `cd packages/opencode && bun test test/background/job.test.ts test/server/httpapi-experimental.test.ts test/tool/workspace.test.ts test/tool/registry.test.ts`
- `cd packages/app && bun test --preload ./happydom.ts ./src/components/background-tasks.test.ts ./src/context/global-sync/bootstrap.test.ts ./src/pages/session/workspace-actions.test.ts ./src/context/workspace-tabs.test.ts`
- `cd packages/app && bun run build`
- `cd packages/desktop && bun run build`
- declared package typecheck sweep from package directories
- no old scoped package matches in source/docs under the ignored-artifact filter
- `git diff --check`
```

## Committed Groups

The main release slice has been committed with these groups:

- Workspace UI and handoff surface:
  `packages/app/src/components/tabs/`, `packages/app/src/context/workspace-tabs.ts`, `packages/app/src/pages/session/workspace-actions.ts`, `packages/app/src/components/background-tasks.tsx`, `packages/app/src/components/workspace-tab-bar.tsx`, and related tests/e2e specs.
- Desktop browser and computer-control integration:
  `packages/desktop/src/main/browser*`, `packages/desktop/src/main/computer-use/`, `packages/desktop/src/preload/browser.ts`, `packages/desktop/src/renderer/browser.*`, and desktop browser automation tests.
- Backend task/workspace plumbing:
  `packages/core/src/background-job.ts`, `packages/opencode/src/tool/workspace.ts`, `packages/opencode/src/workspace/action.ts`, relevant HTTP API/server changes, generated SDK/OpenAPI files, and focused tests.
- Kimi/local-provider path:
  `.opencode/presets/kimi.json`, `packages/llm/src/providers/moonshot.ts`, Kimi setup docs, and local provider sample updates.
- Package-scope rename:
  package manifests, lockfiles, import updates, `turbo.json`, and docs that now reference the Cedric package scope.
- Release docs:
  `STATUS.md`, `CEDRIC_ROADMAP_v2.md`, `PHASE0_COMPLETION_REPORT.md`, `CEDRIC_UI_UX_REVIEW.md`, `MERGE_NOTES.md`, setup docs, and this file.

Kept local-only through `.git/info/exclude`:

- `computer-use-test.mjs`
- `real-implementation-test.mjs`
- `test-provider.mjs`
- `start-dev.sh`
- `start-openkimi.sh`

These are local smoke helpers, not release assets. They write to local desktop paths, use old OpenKimi wording, or exercise macOS automation directly, so they are preserved on disk but intentionally excluded from the commit.

## Completion Evidence

- `STATUS.md` records no remaining core workspace or package-readiness development blockers.
- `git diff --cached --check` and `git diff --check` passed before commit.
- The branch worktree is clean after commit; local-only smoke helpers are hidden by `.git/info/exclude`.
- No old scoped package references remain in source/docs with build artifacts and `node_modules` excluded.
- Post-stage app, desktop, and LLM typechecks passed after mechanical trailing-whitespace cleanup.
- The package-level validators listed above passed from package directories, including app, desktop, core, opencode, SDK, server, UI, LLM, console, stats, and sqlite helper packages.

## Remaining Before Publish

1. Inspect the branch tip in review mode.
2. Push branch `codex/cedric-workspace-release`.
3. Open a draft PR with the summary and validation block above.
4. Optional: run one final fresh desktop smoke against the local Kimi bridge if the PR should include live-interaction evidence.
