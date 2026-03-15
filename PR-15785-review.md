# PR 15785 Review

Scope reviewed:
- GitHub integration backend: [`packages/opencode/src/project/pr.ts`](packages/opencode/src/project/pr.ts), [`packages/opencode/src/project/pr-comments.ts`](packages/opencode/src/project/pr-comments.ts), [`packages/opencode/src/project/vcs.ts`](packages/opencode/src/project/vcs.ts), [`packages/opencode/src/server/routes/vcs.ts`](packages/opencode/src/server/routes/vcs.ts)
- Solid app integration: [`packages/app/src/components/pr-button.tsx`](packages/app/src/components/pr-button.tsx), [`packages/app/src/components/dialog-create-pr.tsx`](packages/app/src/components/dialog-create-pr.tsx), [`packages/app/src/components/dialog-address-comments.tsx`](packages/app/src/components/dialog-address-comments.tsx), [`packages/app/src/context/global-sync/event-reducer.ts`](packages/app/src/context/global-sync/event-reducer.ts)
- Adjacent UI changes that shipped in the same PR: [`packages/app/src/pages/session/message-timeline.tsx`](packages/app/src/pages/session/message-timeline.tsx)

Validation:
- `packages/opencode`: `bun run typecheck`
- `packages/app`: `bun run typecheck`
- `packages/ui`: `bun run typecheck`

## Findings

### 1. High: `vcs.updated` cannot clear stale PR/GitHub state on the client
- Files:
  - [`packages/app/src/context/global-sync/event-reducer.ts:261`](packages/app/src/context/global-sync/event-reducer.ts#L261)
  - [`packages/opencode/src/server/server.ts:500`](packages/opencode/src/server/server.ts#L500)
- `vcs.updated` is reduced as a partial merge (`{ ...input.store.vcs, ...props }`), but SSE payloads are serialized with `JSON.stringify(event)`. Any field that becomes `undefined` on the server is dropped from the wire entirely.
- That means transitions like "branch with PR" -> "branch without PR", or "authenticated GitHub repo" -> "repo not detected", never clear `pr`, `github`, `branches`, etc. on the app side. The old values remain cached until a hard refresh/bootstrap replaces the whole snapshot.
- User-visible result: stale PR pills/buttons/badges can remain visible after a branch switch or after the PR disappears.

### 2. High: the commit step in the create-PR dialog does not stage new files
- Files:
  - [`packages/opencode/src/project/vcs.ts:237`](packages/opencode/src/project/vcs.ts#L237)
  - [`packages/app/src/components/dialog-create-pr.tsx:87`](packages/app/src/components/dialog-create-pr.tsx#L87)
- The new PR flow blocks creation while the worktree is dirty, then offers an in-dialog commit action. That action calls `git add -u`, which only stages tracked-file changes.
- If the user created new files, the commit either omits them or fails to clear the dirty state. The dialog then continues to block PR creation because `dirty > 0`, so the happy path breaks on a common workflow.
- This needs `git add -A` or equivalent behavior if the dialog is going to be presented as "commit current changes, then create PR".

### 3. Medium: branch push detection and PR creation break for non-`origin` remotes
- Files:
  - [`packages/opencode/src/project/vcs.ts:174`](packages/opencode/src/project/vcs.ts#L174)
  - [`packages/app/src/components/dialog-create-pr.tsx:27`](packages/app/src/components/dialog-create-pr.tsx#L27)
  - [`packages/opencode/src/project/pr.ts:206`](packages/opencode/src/project/pr.ts#L206)
- `fetchBranches()` lists every remote branch, but only strips the `origin/` prefix. A branch tracked on `alice/feature-x` stays `alice/feature-x`, so `isPushed()` compares `feature-x` against `alice/feature-x` and reports "not pushed" even when it already is.
- `PR.create()` then hardcodes `git push -u origin HEAD` instead of respecting the existing upstream/remote. In multi-remote or fork setups this can fail outright or push to the wrong remote.
- This is especially risky because the same PR adds explicit fork-handling elsewhere (`opencode pr <number>`), so the integration now supports multi-remote workflows in one path and breaks them in another.

### 4. Medium: unresolved comment badges/counts silently undercount large PRs
- File:
  - [`packages/opencode/src/project/pr.ts:58`](packages/opencode/src/project/pr.ts#L58)
- `fetchUnresolvedCommentCount()` only queries `reviewThreads(first: 100)` and never paginates.
- The UI uses this count for attention badges, comment menu labels, and workspace indicators. Once a PR crosses 100 review threads, the product starts reporting an incomplete count while still looking authoritative.
- The dialog fetch path already paginates threads; the lightweight count path should do the same or avoid showing an exact count.

### 5. Medium: timeline staging work was accidentally bypassed
- Files:
  - [`packages/app/src/pages/session/message-timeline.tsx:257`](packages/app/src/pages/session/message-timeline.tsx#L257)
  - [`packages/app/src/pages/session/message-timeline.tsx:684`](packages/app/src/pages/session/message-timeline.tsx#L684)
- `createTimelineStaging()` is still constructed, but the render loop now iterates `rendered()` instead of `staging.messages()`.
- That removes the defer-mount behavior described by the helper and brings back full DOM mounting for older turns.
- It is not directly part of the GitHub feature, but it ships in the same PR and looks like an accidental regression introduced during the active/queued message work.

## Testing Gaps

- I did not run app-level interaction tests or builds.
- There is no targeted automated coverage in this PR for:
  - `vcs.updated` state clearing after merge/branch switch
  - create-PR flow with untracked files
  - fork/multi-remote PR creation
  - unresolved comment counts above 100 threads

## Suggested Fix Order

1. Fix `vcs.updated` so fields can be cleared deterministically.
2. Fix the commit/create flow to handle untracked files.
3. Make push/branch detection upstream-aware instead of assuming `origin`.
4. Paginate or relax the unresolved-comment count badge.
5. Restore `staging.messages()` in the timeline render path.
