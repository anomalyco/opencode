# Fork deltas vs mainline opencode

This fork (`neumark/opencode`) is the opencode build used inside [fc-opencode](https://github.com/immediately-run-worker/fc-opencode) Firecracker microVM development environments. It tracks mainline (`anomalyco/opencode`) `dev`: the fork's `dev` branch mirrors upstream, and the `web-ui-title` release branch is kept current by rebasing it onto `dev` (history up to `v1.18.31-neumark.6` used periodic dev merges instead; those release tags pin the pre-rebase commits and are never moved). The fork adds a small set of server, web UI, and shell features.

Everything not listed here is stock mainline. In particular, the **experimental workspaces machinery is upstream code** (control-plane `Workspace` service, adapter runtime, `/experimental/workspace` routes, the `experimental_workspace` plugin API, workspace-aware v2 SDK client) — this fork does not modify it; it builds on it.

## Release lineage

Releases are tagged `v<upstream-version>-neumark.<N>` off `web-ui-title` and published manually with a single `opencode-linux-x64.tar.gz` asset (no CI: upstream `publish.yml` is gated on `github.repository == 'anomalyco/opencode'`). Consumers that need other architectures walk the release list per-arch (fc-opencode's `pick_release_tag` picks the newest release actually shipping `opencode-linux-<arch>.tar.gz`).

| Tag | Contents |
| --- | --- |
| `v1.18.29-neumark.1` | Upstream rebuild (no fork changes) |
| `v1.18.29-neumark.2` | `OPENCODE_WEB_UI_TITLE` (`374b444`) |
| `v1.18.31-neumark.1/.2` | Upstream `dev` merges (v1.18.31 base, experimental workspaces available) |
| `v1.18.31-neumark.3` | `OPENCODE_NEW_SESSION_WORKSPACE` (`60d0229`), nice/ionice agent shell (`1059467`) |
| `v1.18.31-neumark.4` | Home page lists workspace-bound sessions (`2a40543`) |
| `v1.18.31-neumark.5` | Home page fallback project for workspace-bound sessions (`27449d3`) |
| `v1.18.31-neumark.6` | Workspace `extra.origin`: sessions belong to their origin directory (`2c0e29c`) |

## Features

### 1. Web UI title override — `OPENCODE_WEB_UI_TITLE`

**What it does**: sets the `<title>` of the served web UI, so each VM's browser tab shows its hostname instead of "opencode" (fc-opencode sets `OPENCODE_WEB_UI_TITLE=%H` in the guest systemd unit).

**Implementation** (`374b444`):
- `packages/core/src/flag/flag.ts`: new `OPENCODE_WEB_UI_TITLE` flag.
- `packages/opencode/src/server/shared/ui.ts`: `htmlWithTitle()` replaces the `<title>` block of every served HTML document — both the embedded UI (build-time generated asset map) and the `app.opencode.ai` proxy path used when `OPENCODE_DISABLE_EMBEDDED_WEB_UI` is set. Replacement uses a function so `$` sequences in the title are never treated as replacement patterns; the title is HTML-escaped. `cspForHtml()` recomputes the `sha256` hash of the inline theme-preload script so the strict `script-src` CSP still validates after injection.
- Tests: `packages/opencode/test/server/httpapi-ui.test.ts`; docs: `packages/web/src/content/docs/{server,web}.mdx`.

### 2. Per-session default workspace binding — `OPENCODE_NEW_SESSION_WORKSPACE`

**What it does**: binds every **new top-level session** (i.e. every new browser tab) to a **fresh workspace** of the configured adapter type — in fc-opencode, `overlayfs`: a private copy-on-write overlay of the shared repos base, so tabs cannot see each other's file changes. Subagents/children share their parent's workspace. The environment variable holds the adapter type name (e.g. `overlayfs`).

**Implementation** (`60d0229`):
- `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts` — `defaultWorkspace()` runs before every session create (`create` and `createRaw`):
  - payload already carries `workspaceID` → route the session into that workspace's directory (local targets only);
  - else `OPENCODE_NEW_SESSION_WORKSPACE` set, no `parentID` (children keep the parent's workspace), and an adapter of that type is registered → `Workspace.create()` a fresh workspace and rewrite the payload to `{ directory: <workspace dir>, workspaceID }`;
  - otherwise pass through unchanged (trunk session). An unregistered type (plugin missing, fresh boot) degrades to trunk instead of erroring.
- `packages/opencode/src/session/session.ts` — `Session.CreateInput` gains an optional `directory`; an explicit directory (the default-workspace rewrite) wins over the routed instance directory.
- Integration tests: `packages/opencode/test/server/httpapi-session-workspace-default.test.ts` (trunk default, fresh binding, parallel distinctness, parented creates untouched, explicit-ID reuse, missing-adapter fallback, subagent sharing).

**Operational requirement**: upstream gates the workspace machinery behind the `experimentalWorkspaces` runtime flag (`OPENCODE_EXPERIMENTAL_WORKSPACES=true`, or the global `OPENCODE_EXPERIMENTAL`). With the flag off, `Workspace.startSync` returns *before* emitting the `Status` event that `Workspace.create` waits for, so every `POST /session` dies with `Timed out waiting for global event` → HTTP 500 — while adapter registration and overlay mounts still work, which makes the failure easy to misread as a plugin problem. Deployments **must** set `OPENCODE_EXPERIMENTAL_WORKSPACES=true` alongside `OPENCODE_NEW_SESSION_WORKSPACE`.

### 3. Workspace origin tracking and home page integration

**What it does**: workspace-bound sessions are listed, labeled, grouped, and opened under the **origin directory** they were started from (e.g. `~/repos`) — the per-session workspace directory (`~/workspaces/<slug>`) is plumbing and never surfaces as a project. Each session appears in exactly one directory context.

**Why it was needed**: three successive gaps (fixed in `.4`, `.5`, `.6`):
1. The web home page filters its session index to sessions whose `directory` exactly matches an open project card's directory (`buildHomeSessionRecords`) — workspace directories matched none, so workspace-bound sessions never listed.
2. Surviving records must resolve to a project or they are dropped; the home page's project list is a *local store of open cards* (entries carry no `id`), so `projectID: "global"` lookups miss and workspace sessions only resolved while a card for the workspace directory happened to exist (a session tab creates one via `projects.open()`), making them flicker.
3. `session.created`/`session.updated` events are delivered on the event channel of the directory the *request* ran under (the origin), but carry `info.directory` = the workspace directory; the per-directory store reducers inserted them without a directory check, so the same session appeared under both the origin context and the workspace context. (The UI has a `session.moved` reducer that would reconcile this, but no server event feeds it.)

**Implementation**:
- `2a40543` — `packages/app/src/pages/home/home-sessions-controller.tsx`: sessions with a `workspaceID` bypass the exact-directory filter.
- `27449d3` — same file: unresolvable workspace-bound sessions get a fallback project `{ worktree: session.directory, expanded: true }` (label = workspace slug) instead of being dropped.
- `2c0e29c` — origin tracking:
  - Server: `defaultWorkspace()` records `extra: { origin: <InstanceState.directory> }` on the workspace. `extra` is the existing JSON column (`WorkspaceTable.extra`), flowing `CreateInput.extra → adapter.configure(info) → config.extra → Info.extra → DB → GET /experimental/workspace`; adapters that spread their config (the overlayfs plugin does) pass it through untouched. No schema migration.
  - UI (`home-sessions-controller.tsx`): a `workspaceOrigins` signal (`workspaceID → origin | undefined`) loaded via `client.experimental.workspace.list()` reading `item.extra.origin`, with an `originsQueried` set + in-flight guard so a referenced-but-missing workspace (dangling, reclaimed, other project, flag off) cannot spin a refetch loop. Record building resolves `origin` and matches project cards / `projectForSession` against it; the fallback becomes `{ worktree: origin ?? session.directory }`; the open handler opens `project?.worktree ?? origin ?? session.directory`, so opening a workspace session never creates a project card for the workspace directory.
  - UI (`packages/app/src/context/global-sync/event-reducer.ts`): `session.created`/`session.updated` skip *inserting* a not-yet-present session into a directory context when `info.workspaceID && pathKey(info.directory) !== pathKey(input.directory)` (updates to already-present sessions remain unconditional). The workspace's own context still receives its sessions via its scoped session list.
  - Workspaces created before `.6` have `extra: null` and keep the slug-label fallback; backfilling `extra` to `{"origin": "<dir>"}` in the `workspace` table restores origin labeling.

### 4. Low-priority agent shell commands (linux)

**What it does**: agent tool shell commands run under `nice -n 19` + `ionice -c 2 -n 7` (best-effort class, lowest priority), so builds/tests yield CPU and IO to the opencode server and web UI inside small VMs.

**Implementation** (`1059467`): `packages/opencode/src/tool/shell.ts` — on `process.platform === "linux"`, `cmd()` spawns `nice -n 19 ionice -c 2 -n 7 <shell> -c <command>` (detached, stdin ignored); other platforms unchanged.

## Build and release process

```sh
# bun version is pinned by the root package.json packageManager field (bun@1.3.14)
bun install
cd packages/opencode
OPENCODE_VERSION=<x.y.z-neumark.N> bun script/build.ts --single   # linux-x64 only
# → dist/opencode-linux-x64/{bin/opencode, package.json}; smoke test runs --version
cd dist/opencode-linux-x64/bin && tar -czf /tmp/opencode-linux-x64.tar.gz *
gh release create v<x.y.z-neumark.N> /tmp/opencode-linux-x64.tar.gz \
  --repo neumark/opencode --target web-ui-title
```

- The build embeds the web UI: `packages/app` is built with vite and every dist file is compiled into the binary as a generated path→file map (`opencode-web-ui.gen.ts`, served via `fs.readFile` from the bun-compiled asset store). UI-only changes therefore require a full binary rebuild and a new release.
- The pre-push hook runs `bun typecheck` (turbo, whole monorepo) and a bun version check; `bun` must be on `PATH` when pushing.
- Keep mainline current by pulling `origin/dev` and rebasing `web-ui-title` onto it (`git rebase <dev> web-ui-title`, then push with `--force-with-lease`). Release tags pin released binaries and are never moved by rebases.

## Deployment contract (fc-opencode)

The guest systemd unit (`opencode-serve.service`) sets:

```ini
Environment=OPENCODE_WEB_UI_TITLE=%H
Environment=OPENCODE_NEW_SESSION_WORKSPACE=overlayfs
Environment=OPENCODE_EXPERIMENTAL_WORKSPACES=true
```

and ships an `overlayfs` workspace adapter plugin (registered through the upstream `experimental_workspace` plugin API): `configure` sets the workspace directory under `~/workspaces/<slug>` (spreading config, so `extra.origin` survives), `create`/`remove` start/stop `fc-overlay@<slug>.service`, and `target` returns `{ type: "local", directory }`. Each workspace mounts an overlay with the shared read-only repos base as `lowerdir` and a per-workspace delta as `upperdir`; the trunk `~/repos` is a separate overlay with a VM-wide shared delta, and the rest of the guest filesystem is shared by all sessions (isolation there is per-VM only).
