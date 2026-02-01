# New session branch selector 500

## Summary

The new session repo selector uses the same `GET /repo/:repoID/branches` endpoint as other branch pickers. The UI renders the selector, then shows an error banner when the request fails. A 500 here is consistent with the existing `repo-branches-500` root cause: backend `CloneError` or other non-`NamedError` exceptions bubbling to a 500.

## Evidence (UI)

- New session view renders the repo selector component.
  - `packages/app/src/components/session/session-new-view.tsx` -> `<RepoSelector currentPath={currentRepoPath()} onOpenRepo={openRepo} />`
- Repo selector fetches branches via SDK and stores errors in `branchListState.error`.
  - `packages/app/src/components/repo/repo-selector.tsx` -> `globalSDK.client.repo.branches({ repoID: repoId })`
- Branch error UX: warning banner with retry, but branch `<Select>` still renders while empty.
  - `packages/app/src/components/repo/repo-selector.tsx` -> `Show when={selectedRepo()}` renders the selector, and `Show when={selectedRepo() && branchListState.error}` renders the banner.

## Evidence (server)

- Branch list route calls `Repo.get()` then `Repo.listBranches()`; only `CloneError` is handled.
  - `packages/opencode/src/server/routes/repo.ts` -> `/:repoID/branches`
- `Repo.listBranches()` calls `ensureGitRepo(repo.path)` which throws `CloneError` when the path does not exist or is not a git work tree.
  - `packages/opencode/src/repo/repo.ts` -> `listBranches()` + `ensureGitRepo()`
- `CloneError` is not a `NamedError`, so it is not mapped to a 4xx and becomes a 500 via the global error handler.
  - `packages/opencode/src/repo/repo.ts` -> `class CloneError extends Error`
  - `packages/opencode/src/server/server.ts` -> `onError` only special-cases `NamedError`

## Same root cause?

Yes. This is the same backend failure mode documented in `.planning/debug/repo-branches-500.md`: invalid or unavailable repo paths cause `ensureGitRepo()` to throw `CloneError`, which results in a 500. The new session branch selector just surfaces the error in a different UI context.

## UX notes

- Current UX: branch selector shows (empty) + warning banner with retry. This makes the error visible but does not explain why or how to fix it (e.g., repo path invalid on server).
- If the server returns a non-`error.message` shape (e.g., `NamedError.Unknown`), the UI falls back to a generic "Request failed."

## Suggested fix direction (not implemented)

- Server: map `CloneError` to a structured 4xx response for branches (400/404) to avoid 500s.
- Server: consider validating repo paths in `Repo.list()` or pruning invalid entries when `ensureGitRepo()` fails.
- UI: optionally disable the branch `<Select>` while `branches.loading` or when `branchListState.error` is set, and show a more actionable error string.
