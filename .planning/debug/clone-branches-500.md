# Debug Notes: GET /repo/:id/branches 500 after clone

## Scope

- Investigate Phase 16 UAT Test 3: cloning repo then `GET /repo/:id/branches` returns 500.
- Determine if this is the same issue as HTML-shaped `/agent` and `/command` responses.

## Evidence

- Clone flow writes repo metadata to storage after successful clone (same for progress):
  - `Repo.clone` and `Repo.cloneWithProgress` generate a new repo ID and `writeRepo(repo)` before returning.
  - See `Repo.clone` and `Repo.cloneWithProgress` in `packages/opencode/src/repo/repo.ts`.
- Branch list handler:
  - `GET /repo/:repoID/branches` calls `Repo.get(repoID)` then `Repo.listBranches(repo)` with no try/catch.
  - See `packages/opencode/src/server/routes/repo.ts`.
- Branch listing requires a valid git repo:
  - `Repo.listBranches` calls `ensureGitRepo(repo.path)` which throws `CloneError` if the path doesn’t exist or isn’t a git repo.
  - `CloneError` is not a `NamedError`, so it is not mapped to a 4xx and will surface as 500 in the global error handler.
  - See `packages/opencode/src/repo/repo.ts` and `packages/opencode/src/server/server.ts` error handling.
- “Unexpected agent/command list shape HTML responses” likely from missing dev proxy routes:
  - `packages/app/vite.config.ts` proxies `/repo` but does **not** proxy `/agent` or `/command`, so in dev those calls can return `index.html` (HTML) instead of JSON.

## Suspected root cause

1. **`GET /repo/:id/branches` 500**
   - Most likely a backend error path: `Repo.listBranches` throws `CloneError` when `repo.path` is not a valid git worktree (missing dir, missing `.git`, or bad path).
   - This exception is not caught or mapped to a 4xx response, so the server returns 500.
   - If repo storage entries are stale (path exists but no git), this will reproduce consistently.

2. **HTML shapes for `/agent` and `/command`**
   - Separate issue: missing Vite proxy entries for `/agent` and `/command` routes in dev, so requests are answered by the front-end dev server and return HTML instead of JSON.

## Repo storage consistency check

- Clone adds repo to storage correctly (`writeRepo` after `git clone`).
- Repo ID mismatch is unlikely: the UI receives the repo ID from the clone response and storage uses that ID as the key.
- Missing worktree / invalid git directory is the most plausible trigger for the 500.

## Suggested fix direction

- Map `CloneError` to 400/404 in the repo routes (branches/checkout), or validate repo existence + git status and return a structured error response.
- Consider removing invalid repos from storage or filtering out non-git paths in `Repo.list()`.
- Add `/agent` and `/command` proxies in `packages/app/vite.config.ts` to fix HTML shape responses in dev.
