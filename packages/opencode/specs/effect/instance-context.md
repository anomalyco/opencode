# Instance context migration

Practical plan for retiring the promise-backed / ALS-backed `Instance` helper in `src/project/instance.ts` and moving instance selection fully into Effect-provided scope.

## Goal

End state:

- request, CLI, TUI, and tool entrypoints shift into an instance through Effect, not `Instance.provide(...)`
- Effect code reads the current instance from `InstanceRef` or its eventual replacement, not from ALS-backed sync getters
- per-directory boot, caching, and disposal are scoped Effect resources, not a module-level `Map<string, Promise<InstanceContext>>`
- ALS remains only as a temporary bridge for native callback APIs that fire outside the Effect fiber tree

## Current split

Today `src/project/instance.ts` still owns two separate concerns:

- ambient current-instance context through `LocalContext` / `AsyncLocalStorage`
- per-directory boot and deduplication through `cache: Map<string, Promise<InstanceContext>>`

At the same time, the Effect side already exists:

- `src/effect/instance-ref.ts` provides `InstanceRef` and `WorkspaceRef`
- `src/effect/run-service.ts` already attaches those refs when a runtime starts inside an active instance ALS context
- `src/effect/instance-state.ts` already prefers `InstanceRef` and only falls back to ALS when needed

That means the migration is not "invent instance context in Effect". The migration is "stop relying on the legacy helper as the primary source of truth".

## End state shape

Near-term target shape:

```ts
InstanceScope.with({ directory, workspaceID }, effect)
```

Responsibilities of `InstanceScope.with(...)`:

- resolve `directory`, `project`, and `worktree`
- acquire or reuse the scoped per-directory instance environment
- provide `InstanceRef` and `WorkspaceRef`
- run the caller's Effect inside that environment

Code inside the boundary should then do one of these:

```ts
const ctx = yield * InstanceState.context
const dir = yield * InstanceState.directory
```

Long-term, once `InstanceState` itself is replaced by keyed layers / `LayerMap`, those reads can move to an `InstanceContext` service without changing the outer migration order.

## Migration phases

### Phase 1: stop expanding the legacy surface

Rules for all new code:

- do not add new `Instance.directory`, `Instance.worktree`, `Instance.project`, or `Instance.current` reads inside Effect code
- do not add new `Instance.provide(...)` boundaries unless there is no Effect-native seam yet
- use `InstanceState.context`, `InstanceState.directory`, or an explicit `ctx` parameter inside Effect code

Success condition:

- the file inventory below only shrinks from here

### Phase 2: remove direct sync getter reads from Effect services

Convert Effect services first, before replacing the top-level boundary. These modules already run inside Effect and mostly need `yield* InstanceState.context` or a yielded `ctx` instead of ambient sync access.

Primary batch, highest payoff:

- `src/file/index.ts`
- `src/lsp/server.ts`
- `src/worktree/index.ts`
- `src/file/watcher.ts`
- `src/format/formatter.ts`
- `src/session/index.ts`
- `src/project/vcs.ts`

Mechanical replacement rule:

- `Instance.directory` -> `ctx.directory` or `yield* InstanceState.directory`
- `Instance.worktree` -> `ctx.worktree`
- `Instance.project` -> `ctx.project`

Do not thread strings manually through every public method if the service already has access to Effect context.

### Phase 3: convert entry boundaries to provide instance refs directly

After the service bodies stop assuming ALS, move the top-level boundaries to shift into Effect explicitly.

Main boundaries:

- HTTP server middleware and experimental `HttpApi` entrypoints
- CLI commands
- TUI worker / attach / thread entrypoints
- tool execution entrypoints

These boundaries should become Effect-native wrappers that:

- decode directory / workspace inputs
- resolve the instance context once
- provide `InstanceRef` and `WorkspaceRef`
- run the requested Effect

At that point `Instance.provide(...)` becomes a legacy adapter instead of the normal code path.

### Phase 4: replace promise boot cache with scoped instance runtime

Once boundaries and services both rely on Effect context, replace the module-level promise cache in `src/project/instance.ts`.

Target replacement:

- keyed scoped runtime or keyed layer acquisition for each directory
- reuse via `ScopedCache`, `LayerMap`, or another keyed Effect resource manager
- cleanup performed by scope finalizers instead of `disposeAll()` iterating a Promise map

This phase should absorb the current responsibilities of:

- `cache` in `src/project/instance.ts`
- `boot(...)`
- most of `disposeInstance(...)`
- manual `reload(...)` / `disposeAll()` fan-out logic

### Phase 5: shrink ALS to callback bridges only

Keep ALS only where a library invokes callbacks outside the Effect fiber tree and we still need to call code that reads instance context synchronously.

Known bridge cases today:

- `src/file/watcher.ts`
- `src/session/llm.ts`
- some LSP and plugin callback paths

If those libraries become fully wrapped in Effect services, the remaining `Instance.bind(...)` uses can disappear too.

### Phase 6: delete the legacy sync API

Only after earlier phases land:

- remove broad use of `Instance.current`, `Instance.directory`, `Instance.worktree`, `Instance.project`
- reduce `src/project/instance.ts` to a thin compatibility shim or delete it entirely
- remove the ALS fallback from `InstanceState.context`

## Inventory of direct legacy usage

Direct legacy usage means any source file that still calls one of:

- `Instance.current`
- `Instance.directory`
- `Instance.worktree`
- `Instance.project`
- `Instance.provide(...)`
- `Instance.bind(...)`
- `Instance.restore(...)`
- `Instance.reload(...)`
- `Instance.dispose()` / `Instance.disposeAll()`

Current total: `56` files in `packages/opencode/src`.

### Core bridge and plumbing

These files define or adapt the current bridge. They should change last, after callers have moved.

- `src/project/instance.ts`
- `src/effect/run-service.ts`
- `src/effect/instance-state.ts`
- `src/project/bootstrap.ts`
- `src/config/config.ts`

Migration rule:

- keep these as compatibility glue until the outer boundaries and inner services stop depending on ALS

### HTTP and server boundaries

These are the current request-entry seams that still create or consume instance context through the legacy helper.

- `src/server/routes/instance/middleware.ts`
- `src/server/routes/instance/index.ts`
- `src/server/routes/instance/project.ts`
- `src/server/routes/control/workspace.ts`
- `src/server/routes/instance/file.ts`
- `src/server/routes/instance/experimental.ts`
- `src/server/routes/global.ts`

Migration rule:

- move these to explicit Effect entrypoints that provide `InstanceRef` / `WorkspaceRef`
- do not move these first; first reduce the number of downstream handlers and services that still expect ambient ALS

### CLI and TUI boundaries

These commands still enter an instance through `Instance.provide(...)` or read sync getters directly.

- `src/cli/bootstrap.ts`
- `src/cli/cmd/agent.ts`
- `src/cli/cmd/debug/agent.ts`
- `src/cli/cmd/debug/ripgrep.ts`
- `src/cli/cmd/github.ts`
- `src/cli/cmd/import.ts`
- `src/cli/cmd/mcp.ts`
- `src/cli/cmd/models.ts`
- `src/cli/cmd/plug.ts`
- `src/cli/cmd/pr.ts`
- `src/cli/cmd/providers.ts`
- `src/cli/cmd/stats.ts`
- `src/cli/cmd/tui/attach.ts`
- `src/cli/cmd/tui/plugin/runtime.ts`
- `src/cli/cmd/tui/thread.ts`
- `src/cli/cmd/tui/worker.ts`

Migration rule:

- converge these on one shared `withInstance(...)` Effect entry helper instead of open-coded `Instance.provide(...)`
- after that helper is proven, inline the legacy implementation behind an Effect-native scope provider

### Tool boundary code

These tools mostly use direct getters for path resolution and repo-relative display logic.

- `src/tool/apply_patch.ts`
- `src/tool/bash.ts`
- `src/tool/edit.ts`
- `src/tool/lsp.ts`
- `src/tool/multiedit.ts`
- `src/tool/plan.ts`
- `src/tool/read.ts`
- `src/tool/write.ts`

Migration rule:

- expose the current instance as an explicit Effect dependency for tool execution
- keep path logic local; avoid introducing another global singleton for tool state

### Effect services still reading ambient instance state

These modules are already the best near-term migration targets because they are in Effect code but still read sync getters from the legacy helper.

- `src/agent/agent.ts`
- `src/cli/cmd/tui/config/tui-migrate.ts`
- `src/file/index.ts`
- `src/file/watcher.ts`
- `src/format/formatter.ts`
- `src/lsp/client.ts`
- `src/lsp/index.ts`
- `src/lsp/server.ts`
- `src/mcp/index.ts`
- `src/project/vcs.ts`
- `src/provider/provider.ts`
- `src/pty/index.ts`
- `src/session/session.ts`
- `src/session/instruction.ts`
- `src/session/llm.ts`
- `src/session/system.ts`
- `src/sync/index.ts`
- `src/worktree/index.ts`

Migration rule:

- replace direct getter reads with `yield* InstanceState.context` or a yielded `ctx`
- isolate `Instance.bind(...)` callers and convert only the truly callback-driven edges to bridge mode

### Highest-churn hotspots

Current highest direct-usage counts by file:

- `src/file/index.ts` - `18`
- `src/lsp/server.ts` - `14`
- `src/worktree/index.ts` - `12`
- `src/file/watcher.ts` - `9`
- `src/cli/cmd/mcp.ts` - `8`
- `src/format/formatter.ts` - `8`
- `src/tool/apply_patch.ts` - `8`
- `src/cli/cmd/github.ts` - `7`

These files should drive the first measurable burn-down.

## Recommended implementation order

1. Migrate direct getter reads inside Effect services, starting with `file`, `lsp`, `worktree`, `format`, and `session`.
2. Add one shared Effect-native boundary helper for CLI / tool / HTTP entrypoints so we stop open-coding `Instance.provide(...)`.
3. Move experimental `HttpApi` entrypoints to that helper so the new server stack proves the pattern.
4. Convert remaining CLI and tool boundaries.
5. Replace the promise cache with a keyed scoped runtime or keyed layer map.
6. Delete ALS fallback paths once only callback bridges still depend on them.

## Definition of done

This migration is done when all of the following are true:

- new requests and commands enter an instance by providing Effect context, not ALS
- Effect services no longer read `Instance.directory`, `Instance.worktree`, `Instance.project`, or `Instance.current`
- `Instance.provide(...)` is gone from normal request / CLI / tool execution
- per-directory boot and disposal are handled by scoped Effect resources
- `Instance.bind(...)` is either gone or confined to a tiny set of native callback adapters

## Tracker and worktree

Active tracker items:

- `lh7l73` - overall `HttpApi` migration
- `yobwlk` - remove direct `Instance.*` reads inside Effect services
- `7irl1e` - replace `InstanceState` / legacy instance caching with keyed Effect layers

Dedicated worktree for this transition:

- path: `/Users/kit/code/open-source/opencode-worktrees/instance-effect-shift`
- branch: `kit/instance-effect-shift`
