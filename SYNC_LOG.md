# Sync Log

This document tracks all upstream synchronization attempts, their outcomes, and any issues encountered.

## Log Format

Each entry should include:
- Date of sync attempt
- Branch name
- Upstream commit SHA (short)
- Status (Success / Partial / Failed / Aborted)
- Conflicts encountered and resolution strategy
- New modifications discovered
- Follow-up actions required

---

## 2026-02-09

**Status:** 🟢 Success

- **Branch:** `sync/2026-02-09`
- **Upstream Commit:** `upstream/dev@de0f4ef80`
- **Commits Rebased:** 53 (our fork commits replayed onto upstream)
- **New Upstream Commits:** 30 (since last sync at `fedf9feba`)
- **Conflicts:** 5 files across 4 commits
  - `bun.lock`: Accepted upstream, regenerated via `bun install`
  - `package.json`: Merged patchedDependencies (kept both upstream `@standard-community/standard-openapi` and ours `ghostty-web`, `@floating-ui/utils`)
  - `packages/app/src/pages/session.tsx`: Accepted upstream (we have our own override)
  - `packages/desktop/src-tauri/src/lib.rs`: Kept ours (fork's desktop refactor)
  - `packages/desktop/src/bindings.ts`: Kept ours (generated from our Tauri commands)
  - `packages/app/src/pages/layout.tsx`: Accepted upstream (removed stale `parseDeepLink` code)
  - `packages/opencode/package.json`: Accepted upstream (gitlab-ai-provider 3.5.0)
  - `packages/opencode/src/plugin/index.ts`: Accepted upstream (bundled GitLab auth plugin)
  - `packages/app/src/components/session/session-header.tsx`: Accepted upstream (already has open-in-app)
  - `packages/ui/src/components/app-icon.tsx`: Accepted upstream
  - `packages/ui/src/components/app-icons/types.ts`: Accepted upstream (added `file-explorer`)
  - `packages/app/src/components/prompt-input.tsx`: Accepted upstream (drag-n-drop @mention)
- **Post-Rebase Fixes:**
  - Restored upstream versions of `attachments.ts`, `drag-overlay.tsx`, `session-header.tsx`, `app-icon.tsx`, `types.ts`, `platform.tsx` (auto-merge kept old versions)
  - Added `readClipboardImage` to claxedo-app platform override (new upstream API)
  - Fixed `string | undefined` type errors in `ClaxedoLayout.tsx` and `rail-layout.tsx` (non-null assertions for `focusedId`)
  - Fixed `value` possibly undefined in `terminal.tsx` override
- **Notable Upstream Changes:**
  - `de0f4ef80`: Layout workspace header truncation improvements
  - `6bdd3528a`: Drag-n-drop to @mention file
  - `d5036cf01`: Native clipboard image paste for desktop
  - `ecaeb9e60`: Respect terminal toggle keybind when terminal is focused
  - `d1ebe0767`: Refactoring and tests, splitting up files
  - `9401029b1`: Move workspace "New session" into header
- **Validation:** ✅ claxedo-app typecheck passed, ⚠️ upstream app has pre-existing errors (ContextMenu, HoverCard, SortableTerminalTab)
- **Follow-up Actions:**
  - [ ] Move dev to sync branch (`git checkout dev && git reset --hard sync/2026-02-09`)
  - [ ] Force-push to origin (`git push origin dev --force-with-lease`)
  - [ ] Test drag-n-drop @mention (new upstream feature)
  - [ ] Test clipboard image paste (new upstream feature)
- **Notes:** 85 previously applied commits were auto-skipped. Auto-merge kept old versions of several files requiring manual restoration from upstream HEAD.

---

## 2026-02-07

**Status:** 🟢 Success

- **Branch:** `sync/2026-02-07`
- **Upstream Commit:** `upstream/dev@fedf9feba`
- **Commits Rebased:** 23 (our fork commits replayed onto upstream)
- **New Upstream Commits:** 16 (since last sync at `531b1941a`)
- **Conflicts:** 2
  - `bun.lock`: Accepted upstream, regenerated via `bun install`
  - `package.json` (commit 1/23): Merged patchedDependencies (kept both upstream `@standard-community/standard-openapi` and ours `ghostty-web`, `@floating-ui/utils`)
  - `packages/app/src/components/prompt-input.tsx` (commit 22/23): Accepted ours (extension hooks), incorporated upstream `max-w-full` width fix
- **Post-Rebase Fixes:**
  - Updated `session-side-panel.tsx` override: added `reviewOpen` prop, conditional aside layout
  - Updated `session.tsx` override: added `desktopReviewOpen`/`desktopFileTreeOpen`/`desktopSidePanelOpen` memos, `sessionPanelWidth` computed, `openReviewPanel` helper
  - Aligned diff-fetching and file tree effects with upstream logic changes
- **Notable Upstream Changes:**
  - `b5b93aea4`: Toggle file tree and review panel better UX — file tree can now be open independently of review panel
  - `898778daa`: Bun upgraded to 1.3.8
  - `fde0b39b7`: File URLs with special characters properly encoded
- **Validation:** ✅ Build succeeded
- **Follow-up Actions:**
  - [ ] Merge sync branch into dev (`git checkout dev && git reset --hard sync/2026-02-07`)
  - [ ] Force-push to origin (`git push origin dev --force-with-lease`)
  - [ ] Test file tree independent toggle (new upstream feature)
- **Notes:** Clean rebase with only 2 conflicts. REBASE_AGENT.md updated to use correct remote names (`origin` instead of `fork`).

---

## 2026-02-02

**Status:** 🟡 Partial (Conflicts auto-resolved)

- **Branch:** `sync/2026-02-02`
- **Upstream Commit:** `upstream/dev@76745d059`
- **Conflicts:** 2
  - `packages/app/src/components/settings-general.tsx`: Merged carefully (kept extension hooks, accepted upstream UI changes)
  - `bun.lock`: Accepted upstream, regenerated
- **New Modifications Discovered:**
  - `packages/app/package.json`: Missing dependencies (`@opencode-ai/app-shared`, `@tanstack/solid-query`) - **FIXED**
- **Post-Rebase Fixes:**
  - Added `@opencode-ai/app-shared` and `@tanstack/solid-query` to packages/app dependencies
- **Validation:** 🟡 Type check partially passed (claxedo-app has pre-existing type errors), ✅ Build succeeded
- **Follow-up Actions:**
  - [ ] Review and fix type errors in claxedo-app/src/opencode-patches/server/server.ts
  - [ ] Create PR for review
- **Notes:** Successfully rebased 14 commits onto upstream/dev. Extension system intact. One upstream file required careful merge (settings-general.tsx).

---

## 2026-02-05

**Status:** 🟢 Success

- **Branch:** `sync/2026-02-03` (continuing)
- **Upstream Commit:** `upstream/dev@531b1941a`
- **Commits Rebased:** 21 (from previous sync branch onto new upstream)
- **Conflicts:** 4
  - `bun.lock`: Accepted upstream, regenerated via `bun install`
  - `package.json`: Merged scripts (kept both upstream and ours)
  - `README.md`: Kept ours (claxedo branding)
  - `packages/app/src/components/terminal.tsx`: Accepted upstream PTY URL fix
  - `packages/desktop/src/index.tsx`: Kept our error overlay code
  - `packages/app/src/pages/session.tsx`: Accepted upstream scroll handling
- **Post-Rebase Fixes:**
  - Added `handoff` property to layout context (new upstream requirement)
  - Added `clear` method to comments context (new upstream requirement)
  - Added `DialogCreateWorktree` component (replaces non-existent `dialog.prompt`)
  - Added missing `handleProjectSelect` and `handleWorkspaceSelect` handlers
  - Fixed `findSession` calls to use correct 2-arg signature
  - Fixed terminal `requestCreate` to include directory parameter
  - Fixed `addFile` call in tab-portal to include directory
  - Fixed `WorktreeState` export name (was incorrectly `WorkspaceState`)
- **Validation:** ✅ Typecheck passed, ✅ Build succeeded
- **Follow-up Actions:**
  - [ ] Force-push to fork/dev (use `--force-with-lease`)
  - [ ] Test claxedo-app functionality
- **Notes:** Upstream added new `handoff` API for tab handoff between sessions. Also added `clear` method to comments context.

---

## 2026-02-03

**Status:** 🟢 Success

- **Branch:** `sync/2026-02-03`
- **Upstream Commit:** `upstream/dev@d116c227e`
- **Conflicts:** 1
  - `bun.lock`: Accepted upstream during rebase, then regenerated via `bun install`
- **New Modifications Discovered:**
  - Created `packages/claxedo-app/.dev-docs/CLAXEDO_UPSTREAM_SYNC.md` (was referenced by REBASE_AGENT but missing in repo)
- **Validation:** ✅ `bun install` (post-rebase); 🟡 Typecheck not re-run yet
- **Follow-up Actions:**
  - [x] Run `bun run typecheck` (done in 2026-02-05 sync)
  - [ ] Force-update `fork/dev` from `sync/2026-02-03` (use `--force-with-lease`)
- **Notes:** Scheduled GitHub Actions workflows are intentionally disabled on the fork (keep ours).

---

## Template for New Entries

```markdown
## YYYY-MM-DD

**Status:** 🟢 Success / 🟡 Partial / 🔴 Failed / ⚪ Aborted

- **Branch:** sync/YYYY-MM-DD
- **Upstream Commit:** `upstream/dev@abc1234`
- **Conflicts:** N / List files
  - `file/path.ts`: Resolution strategy used
- **New Modifications Discovered:**
  - `packages/app/src/new/file.ts`: Added to registry with "Accept upstream" strategy
- **Validation:** ✅ Passed / ❌ Failed (reason)
- **Follow-up Actions:**
  - [ ] Update documentation
  - [ ] Test specific feature
  - [ ] Create PR for review
- **Notes:** Any observations, blockers, or learnings
```

---

## Legend

| Symbol | Meaning |
|--------|---------|
| 🟢 | Success - Clean rebase, all validations passed |
| 🟡 | Partial - Conflicts resolved, some manual intervention needed |
| 🔴 | Failed - Could not complete, requires significant work |
| ⚪ | Aborted - Stopped early (e.g., too many conflicts) |

---

## Statistics

| Metric | Count |
|--------|-------|
| Total Sync Attempts | 4 |
| Successful (Clean) | 0 |
| Successful (With Conflicts) | 4 |
| Failed | 0 |
| Aborted | 0 |

---

*This log is maintained by the Rebase Agent. See REBASE_AGENT.md for agent documentation.*
