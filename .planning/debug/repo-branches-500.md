# Repo branches 500 (local repo selection)

## Evidence

- `GET /repo/:repoID/branches` handler calls `Repo.get()` and `Repo.listBranches()` with no try/catch.
- `Repo.get()` uses `Storage.read(["repo", repoId])`. A missing repo id raises `Storage.NotFoundError`, which the server error handler maps to a 404.
- `Repo.listBranches()` calls `ensureGitRepo(repo.path)` which throws `Repo.CloneError` when the path does not exist or is not a git work tree. `CloneError` is not a `NamedError`, so the server error handler returns a 500.
- `Repo.add()` validates the path with `ensureGitRepo()` and persists the repo via `Storage.write(["repo", repo.id], repo)`, so the repo id mapping is stored globally under `Global.Path.data/storage/repo/<uuid>.json`.

## Suspected root cause

The 500 is coming from `Repo.listBranches()` when `ensureGitRepo(repo.path)` fails. This happens when the stored repo path is not a valid git work tree at request time (missing path, non-git directory, or a path that exists on the client machine but not on the server). Because `CloneError` is not mapped to a 4xx, the API responds with 500.

## Files involved

- `packages/opencode/src/server/routes/repo.ts`
- `packages/opencode/src/repo/repo.ts`
- `packages/opencode/src/storage/storage.ts`
- `packages/opencode/src/server/server.ts`

## Fix direction (not implemented)

- Convert `Repo.CloneError` into a structured 4xx (400/404) response in `RepoRoutes` or via a `NamedError` subclass.
- Optionally prune or mark repos with invalid paths when listing or when branch lookups fail.
- Ensure the local repo picker only returns server-visible paths (or use a server-side file picker for remote servers).
