# UAT: /repo/:id/branches returns 500 after clone/select

## Context

- Endpoint: `GET /repo/:repoID/branches`
- Expected: branch list payload
- Actual: 500 after clone or repo select

## Evidence

- Route handler calls `Repo.get` then `Repo.listBranches`, and only catches `Repo.CloneError`. All other errors bubble to the global error handler (500 for non-`NamedError`).
  - `packages/opencode/src/server/routes/repo.ts`
    - `/:repoID/branches` route uses `Repo.get(...)` then `Repo.listBranches(...)` inside `try`/`catch` that only handles `Repo.CloneError`.
- `Repo.get` reads raw JSON from storage without validating shape; corrupted/partial JSON or unexpected schema throws runtime errors instead of returning a safe error.
  - `packages/opencode/src/repo/repo.ts`
    - `Repo.get` → `Storage.read<Info>(["repo", repoId])` (no schema validation).
- Storage read only converts ENOENT into `Storage.NotFoundError`; JSON parse errors and other IO errors propagate as generic errors (500).
  - `packages/opencode/src/storage/storage.ts`
    - `Storage.read` uses `Bun.file(target).json()` and only maps ENOENT to `NotFoundError`.
- `Repo.listBranches` assumes `repo.path` is defined and valid. If storage entry is malformed or missing `path`, this can throw `TypeError` (e.g., passing `undefined` into filesystem or `cwd`), which is not a `CloneError` and becomes 500.
  - `packages/opencode/src/repo/repo.ts`
    - `Repo.listBranches` → `ensureGitRepo(repo.path)` and `$.cwd(repo.path)` with no guard.

## Likely Root Cause

Unvalidated or corrupted repo storage entries cause non-`CloneError` exceptions in `Repo.get` or `Repo.listBranches` (JSON parse errors or `repo.path` undefined), which bubble to the global error handler as 500s.

## Suggested Fix Direction

- Validate repo records on read:
  - In `Repo.get`, parse with `Repo.Info` (zod) and on failure throw a `Storage.NotFoundError` or a new `RepoError` with a clear message (404/400 instead of 500).
- Harden `Repo.listBranches`:
  - Guard for missing/invalid `repo.path` and convert to `CloneError` or `Storage.NotFoundError` to avoid 500s.
- Optional: If repo storage entry is invalid, delete it or return a structured error to the client so the UI can prompt re-clone/add.
