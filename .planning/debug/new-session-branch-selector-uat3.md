# New session branch selector (UAT3)

## Summary

The new session branch selector is wired through `RepoSelector`, which only loads branches after a repo ID is selected. In the new session view, the preselection logic compares `currentPath` to the stored repo root path; if the current path is a worktree (sandbox or alternate checkout), the match fails and branches never load. This looks like a UI handling issue rather than the same `/repo/:id/branches` 500 root cause. A 500 can still occur, but only for storage corruption or unexpected exceptions, not for typical "path is missing" cases.

## Evidence (UI flow)

- New session view passes worktree path into `RepoSelector`.
  - `packages/app/src/components/session/session-new-view.tsx`
    - `const currentRepoPath = createMemo(() => sync.project?.worktree)`
    - `<RepoSelector currentPath={currentRepoPath()} onOpenRepo={openRepo} />`
- `RepoSelector` preselects by _exact path match_ and only loads branches for a selected repo ID.
  - `packages/app/src/components/repo/repo-selector.tsx`
    - `createEffect` selects repo when `repo.path === currentPath`
    - `createResource` for branches uses `selectedRepo()?.id` as the source
    - When no repo is selected, the branch `<Select>` is not rendered
- If `currentPath` is a worktree path that does not equal the stored repo root path (e.g., git worktree sandbox), preselection fails → `selectedRepoId` stays `undefined` → branch list never fetches.

## Evidence (server flow)

- Branch list handler catches `Repo.InvalidRecordError` and `Repo.CloneError` and returns 400, so the usual "invalid path/not a git repo" case should not be a 500 anymore.
  - `packages/opencode/src/server/routes/repo.ts` (`/:repoID/branches`)
- `Repo.get()` now validates records via `Info.safeParse()` and throws `InvalidRecordError` with a clear code.
  - `packages/opencode/src/repo/repo.ts`

## Same root cause as branches 500?

Not likely. The server now maps common repo-path failures to 400. A 500 would require storage corruption (`Storage.InvalidDataError`) or other unexpected exceptions. The more likely reason the branch selector "breaks" on the new session page is the path mismatch preventing repo selection and branch fetch.

## Suggested fix direction (not implemented)

- UI: make repo preselection tolerant of worktrees.
  - Example: if `currentPath` does not exactly match `repo.path`, consider matching via a derived mapping (server-provided repo ID for the current worktree) or a broader check that maps worktree → repo root.
- UI: surface a "Select a repository to load branches" hint when no repo is selected, to make the failure mode obvious.
- Server (if 500s persist): explicitly handle `Storage.InvalidDataError` in the repo routes and return a structured 400/404 with guidance.
