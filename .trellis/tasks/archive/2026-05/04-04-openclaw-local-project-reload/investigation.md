# OpenClaw Local Reload Investigation

## Current status

Instrumentation is already in the working tree for the full return path:

- `packages/app/src/context/server.tsx`
- `packages/app/src/context/layout.tsx`
- `packages/app/src/context/global-sync.tsx`
- `packages/app/src/pages/layout.tsx`

Unrelated prompt and scroll debug logs were removed from:

- `packages/app/src/context/prompt.tsx`
- `packages/app/src/pages/session.tsx`

## Reconstructed chain

Returning from OpenClaw does **not** directly reopen every local project.

The explicit return path is:

1. `openOpenclaw()` finds the last non-OpenClaw server
2. `server.setActive(localKey)`
3. `const last = server.projects.lastFor(key) ?? globalSync.data.project[0]?.worktree`
4. `layout.projects.open(last)`
5. `navigateToProject(last)`

That only targets one root.

## Where scope expands

The first fan-out point is the page effect in `packages/app/src/pages/layout.tsx`:

```ts
createEffect(
  on(
    () => [visibleSessionDirs(), currentDir(), autoselecting.loading] as const,
    ([dirs, dir, selecting]) => {
      ...
      for (const directory of dirs) {
        const [child] = globalSync.child(directory, { bootstrap: false })
        if (child.sessions === "ready" || child.sessions === "loading") continue
        globalSync.project.loadSessions(directory, { silent: true })
      }
    },
    { defer: true },
  ),
)
```

If `dirs` contains multiple local projects after the switch, they will all reload.

## Why this is plausible

- `server.projects` persists project buckets by server origin.
- Local sidecar and localhost servers intentionally share the `"local"` bucket.
- OpenClaw uses its own `"openclaw"` bucket.
- When switching back from OpenClaw, the local bucket is restored as-is.
- `layout.projects.list()` is derived from that persisted local bucket.
- `currentProject()` and `visibleSessionDirs()` then operate over that restored set.

So the likely bug is not "OpenClaw return opens everything", but "the restored local visibility set is broad enough that the visible-session loader reloads everything that was left cached in the local bucket".

## Likely fix directions

- Guard the first post-OpenClaw local restore so only the active project is session-loaded.
- Or narrow `visibleSessionDirs()` / the load effect during server-switch recovery.
- Or distinguish "persisted open in rail" from "eligible for eager session load".

## Next debug step

Run one concrete repro with the new `[project-load]` logs and confirm:

- which directories are present in `server.switch.reset`
- which root is passed to `layout.projects.open(last)`
- the exact `dirs` value printed by `visibleSessionDirs.effect`
- which directories then hit `visibleSessionDirs.load`
