# Desktop file watcher CPU peg (`$HOME` / `/`)

OpenCode desktop can register the entire user home directory (or `/`) as a workspace. The sidecar then runs inotify over that tree, hits subscribe timeouts on large directories, and retries in a tight loop (~100% CPU on `opencode-cli`).

## Symptoms

```
service=file.watcher dir=/home/you cause=TimeoutError
service=file.watcher dir=/ cause=TimeoutError
```

Workspace state files such as `opencode.workspace.-home-you.*.dat` may reappear after deletion.

## Fix in this PR (code)

- **Skip file watcher** for broad roots (`$HOME`, `/`) in `@opencode-ai/core`
- **Sanitize persisted desktop projects** so home/root are not kept in `server.projects`
- **Refuse to open** home/root as a project from the desktop UI

## Workaround script (Flatpak)

Until you are on a build that includes this fix, use:

```bash
OPENCODE_PROJECT=~/path/to/repo ./scripts/opencode-safe.sh
```

The script:

1. Kills stuck `opencode-cli` processes
2. Deletes bad workspace state files
3. Resets `opencode.global.dat` to a single project
4. Sets `HOME` for this launch via transient `flatpak run --env` (sidecar reloads login-shell env)
5. Unsets `OPENAI_API_KEY` / `OPENAI_BASE_URL` if they override OAuth

## Verify

```bash
tail -f ~/.var/app/ai.opencode.opencode/data/ai.opencode.desktop/logs/opencode-desktop_*.log
```

You should **not** see `dir=$HOME` or `dir=/` after opening a project.

## Related

- Do not set global `OPENAI_BASE_URL` to a local proxy if you use ChatGPT OAuth
- Prefer lean config (`lsp: false`, `snapshot: false`) for large trees
