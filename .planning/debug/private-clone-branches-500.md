## UAT Gap: private clone branches 500 + HTML agent/command

### Context

- UAT Phase 16 Test 4 reports: private clone appears to use local credentials; UI logs `/repo/:id/branches` 500 and "Unexpected agent/command list shape" with HTML responses.

### Evidence (code paths)

- Repo branches endpoint calls `Repo.get()` and `Repo.listBranches()` without try/catch, so any `CloneError` from `ensureGitRepo()` or git commands bubbles to the server error handler and returns 500.
  - `packages/opencode/src/server/routes/repo.ts` -> `/:repoID/branches` calls `Repo.get` + `Repo.listBranches`.
  - `packages/opencode/src/repo/repo.ts` -> `listBranches()` runs `ensureGitRepo()` and `git rev-parse`/`git branch` calls.
- `CloneError` is not a `NamedError`, so it is treated as unknown and returns 500.
  - `packages/opencode/src/repo/repo.ts` -> `class CloneError extends Error`.
  - `packages/opencode/src/server/server.ts` -> `onError` only special-cases `NamedError`.
- Repo clone and clone-with-credentials both register the repo by writing to `Storage` after a successful clone.
  - `packages/opencode/src/repo/repo.ts` -> `clone()` and `cloneWithProgress()` both `writeRepo()` after successful clone.
  - No alternate repo ID path for private/credential flow.
- HTML responses for `/agent` and `/command` are consistent with Vite dev server serving index.html when proxy is missing.
  - `packages/app/vite.config.ts` proxies `/repo`, `/session`, etc., but does **not** proxy `/agent` or `/command`.
  - UI uses `server.url` (dev default is `window.location.origin`), so missing proxy yields HTML, then "Unexpected ... list shape".

### Likely root causes

1. **Branches 500**
   - `Repo.listBranches()` throws `CloneError` when the stored repo path is not a valid git repo (missing `.git`, partial clone, or path mismatch). This error is not handled as a `NamedError`, so it becomes a 500 response.
   - This can happen if the repo entry exists but the path is not a valid git repo at branch-list time (e.g., path exists but clone failed or is not a git repo).
2. **HTML responses for agent/command**
   - Dev proxy missing `/agent` and `/command` routes, so Vite returns HTML. The UI expects JSON arrays and logs "Unexpected ... list shape".

### Notes on private clone credentials

- Private clone does not differ in repo registration or branch listing path.
- If a user has valid local SSH creds loaded in the agent, clone can succeed without prompting. That is expected behavior given `GIT_TERMINAL_PROMPT=0` and use of the existing environment.

### Suggested fix direction (not implemented)

- Return structured errors for branch listing when repo is missing or not a git repo (e.g., handle `CloneError`/`NotFoundError` and respond 400/404).
- Optionally validate git repo in `Repo.list()` to avoid listing invalid paths.
- Add `/agent` and `/command` to Vite dev proxy.
