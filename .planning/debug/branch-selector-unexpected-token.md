## UAT gap: /repo/:id/branches 500

### Evidence

- `Repo.listBranches` shells out via Bun `$` and passes `--format=%(refname:short)` unquoted.
- The error reported in UAT ("Unexpected token: (") points to Bun's shell parser choking on `%(...)` before `git` runs.
- The route handler only catches `InvalidRecordError` and `CloneError`, so any parse error from `$` bubbles as 500.

```543:547:packages/opencode/src/repo/repo.ts
  export async function listBranches(repo: Info) {
    await ensureGitRepo(repo.path)
    const current = await $`git rev-parse --abbrev-ref HEAD`.quiet().nothrow().cwd(repo.path).text()
    const output = await $`git branch --all --format=%(refname:short)`.quiet().nothrow().cwd(repo.path).text()
    const names = output
```

### Source of shell error

- Bun's `$` tag parses arguments in a shell-like grammar.
- The `%(refname:short)` token appears unquoted, so the shell parser treats `%(` as syntax instead of a literal string, resulting in "Unexpected token: (".
- Because parsing fails, no process is spawned, and the error is not a `CloneError`, so the route returns 500.

### Fix direction

- Quote or escape the `--format` arg so Bun treats it as a literal:
  - `--format="%(refname:short)"` (or single quotes) is simplest.
- Alternatively, bypass the shell parser by switching to `Bun.spawn`/`Bun.spawnSync` with an args array for this command.
- Consider wrapping non-clone `git` errors into a known error type so the route returns a 4xx with useful info instead of a 500.
