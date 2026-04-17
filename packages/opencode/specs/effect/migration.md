# Effect patterns

Practical reference for new and migrated Effect code in `packages/opencode`.

## Choose scope

Use `InstanceState` (from `src/effect/instance-state.ts`) for services that need per-directory state, per-instance cleanup, or project-bound background work. InstanceState uses a `ScopedCache` keyed by directory, so each open project gets its own copy of the state that is automatically cleaned up on disposal.

Use `makeRuntime` (from `src/effect/run-service.ts`) to create a per-service `ManagedRuntime` that lazily initializes and shares layers via a global `memoMap`. Returns `{ runPromise, runFork, runCallback }`.

- Global services (no per-directory state): Account, Auth, AppFileSystem, Installation, Truncate, Worktree
- Instance-scoped (per-directory state via InstanceState): Agent, Bus, Command, Config, File, FileWatcher, Format, LSP, MCP, Permission, Plugin, ProviderAuth, Pty, Question, SessionStatus, Skill, Snapshot, ToolRegistry, Vcs

Rule of thumb: if two open directories should not share one copy of the service, it needs `InstanceState`.

## Instance context transition

See `instance-context.md` for the phased plan to remove the legacy ALS / promise-backed `Instance` helper and move request / CLI / tool boundaries onto Effect-provided instance scope.

## Service shape

Every service follows the same pattern — a single namespace with the service definition, layer, `runPromise`, and async facade functions:

```ts
export namespace Foo {
  export interface Interface {
    readonly get: (id: FooID) => Effect.Effect<FooInfo, FooError>
  }

  export class Service extends Context.Service<Service, Interface>()("@opencode/Foo") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      // For instance-scoped services:
      const state = yield* InstanceState.make<State>(
        Effect.fn("Foo.state")(() => Effect.succeed({ ... })),
      )

      const get = Effect.fn("Foo.get")(function* (id: FooID) {
        const s = yield* InstanceState.get(state)
        // ...
      })

      return Service.of({ get })
    }),
  )

  // Optional: wire dependencies
  export const defaultLayer = layer.pipe(Layer.provide(FooDep.layer))

  // Per-service runtime (inside the namespace)
  const { runPromise } = makeRuntime(Service, defaultLayer)

  // Async facade functions
  export async function get(id: FooID) {
    return runPromise((svc) => svc.get(id))
  }
}
```

Rules:

- Keep everything in one namespace, one file — no separate `service.ts` / `index.ts` split
- `runPromise` goes inside the namespace (not exported unless tests need it)
- Facade functions are plain `async function` — no `fn()` wrappers
- Use `Effect.fn("Namespace.method")` for all Effect functions (for tracing)
- No `Layer.fresh` — InstanceState handles per-directory isolation

## Schema → Zod interop

When a service uses Effect Schema internally but needs Zod schemas for the HTTP layer, derive Zod from Schema using the `zod()` helper from `@/util/effect-zod`:

```ts
import { zod } from "@/util/effect-zod"

export const ZodInfo = zod(Info) // derives z.ZodType from Schema.Union
```

See `Auth.ZodInfo` for the canonical example.

## InstanceState init patterns

The `InstanceState.make` init callback receives a `Scope`, so you can use `Effect.acquireRelease`, `Effect.addFinalizer`, and `Effect.forkScoped` inside it. Resources acquired this way are automatically cleaned up when the instance is disposed or invalidated by `ScopedCache`. This makes it the right place for:

- **Subscriptions**: Yield `Bus.Service` at the layer level, then use `Stream` + `forkScoped` inside the init closure. The fiber is automatically interrupted when the instance scope closes:

```ts
const bus = yield * Bus.Service

const cache =
  yield *
  InstanceState.make<State>(
    Effect.fn("Foo.state")(function* (ctx) {
      // ... load state ...

      yield* bus.subscribeAll().pipe(
        Stream.runForEach((event) =>
          Effect.sync(() => {
            /* handle */
          }),
        ),
        Effect.forkScoped,
      )

      return {
        /* state */
      }
    }),
  )
```

- **Resource cleanup**: Use `Effect.acquireRelease` or `Effect.addFinalizer` for resources that need teardown (native watchers, process handles, etc.):

```ts
yield *
  Effect.acquireRelease(
    Effect.sync(() => nativeAddon.watch(dir)),
    (watcher) => Effect.sync(() => watcher.close()),
  )
```

- **Background fibers**: Use `Effect.forkScoped` — the fiber is interrupted on disposal.
- **Side effects at init**: Config notification, event wiring, etc. all belong in the init closure. Callers just do `InstanceState.get(cache)` to trigger everything, and `ScopedCache` deduplicates automatically.

The key insight: don't split init into a separate method with a `started` flag. Put everything in the `InstanceState.make` closure and let `ScopedCache` handle the run-once semantics.

## Effect.cached for deduplication

Use `Effect.cached` when multiple concurrent callers should share a single in-flight computation. It memoizes the result and deduplicates concurrent fibers — second caller joins the first caller's fiber instead of starting a new one.

```ts
// Inside the layer — yield* to initialize the memo
let cached = yield * Effect.cached(loadExpensive())

const get = Effect.fn("Foo.get")(function* () {
  return yield* cached // concurrent callers share the same fiber
})

// To invalidate: swap in a fresh memo
const invalidate = Effect.fn("Foo.invalidate")(function* () {
  cached = yield* Effect.cached(loadExpensive())
})
```

Prefer `Effect.cached` over these patterns:

- Storing a `Fiber.Fiber | undefined` with manual check-and-fork (e.g. `file/index.ts` `ensure`)
- Storing a `Promise<void>` task for deduplication (e.g. `skill/index.ts` `ensure`)
- `let cached: X | undefined` with check-and-load (races when two callers see `undefined` before either resolves)

`Effect.cached` handles the run-once + concurrent-join semantics automatically. For invalidatable caches, reassign with `yield* Effect.cached(...)` — the old memo is discarded.

## Scheduled Tasks

For loops or periodic work, use `Effect.repeat` or `Effect.schedule` with `Effect.forkScoped` in the layer definition.

## Preferred Effect services

In effectified services, prefer yielding existing Effect services over dropping down to ad hoc platform APIs.

Prefer these first:

- `FileSystem.FileSystem` instead of raw `fs/promises` for effectful file I/O
- `ChildProcessSpawner.ChildProcessSpawner` with `ChildProcess.make(...)` instead of custom process wrappers
- `HttpClient.HttpClient` instead of raw `fetch`
- `Path.Path` instead of mixing path helpers into service code when you already need a path service
- `Config` for effect-native configuration reads
- `Clock` / `DateTime` for time reads inside effects

## Child processes

For child process work in services, yield `ChildProcessSpawner.ChildProcessSpawner` in the layer and use `ChildProcess.make(...)`.

Keep shelling-out code inside the service, not in callers.

## Shared leaf models

Shared schema or model files can stay outside the service namespace when lower layers also depend on them.

That is fine for leaf files like `schema.ts`. Keep the service surface in the owning namespace.

## Migration checklist

Service-shape migrated (single namespace, traced methods, `InstanceState` where needed).

This checklist is only about the service shape migration. Many of these services still keep `makeRuntime(...)` plus async facade exports; that facade-removal phase is tracked separately in `facades.md`.

- [x] `Account` — `account/index.ts`
- [x] `Agent` — `agent/agent.ts`
- [x] `AppFileSystem` — `filesystem/index.ts`
- [x] `Auth` — `auth/index.ts` (uses `zod()` helper for Schema→Zod interop)
- [x] `Bus` — `bus/index.ts`
- [x] `Command` — `command/index.ts`
- [x] `Config` — `config/config.ts`
- [x] `Discovery` — `skill/discovery.ts` (dependency-only layer, no standalone runtime)
- [x] `File` — `file/index.ts`
- [x] `FileWatcher` — `file/watcher.ts`
- [x] `Format` — `format/index.ts`
- [x] `Installation` — `installation/index.ts`
- [x] `LSP` — `lsp/index.ts`
- [x] `MCP` — `mcp/index.ts`
- [x] `McpAuth` — `mcp/auth.ts`
- [x] `Permission` — `permission/index.ts`
- [x] `Plugin` — `plugin/index.ts`
- [x] `Project` — `project/project.ts`
- [x] `ProviderAuth` — `provider/auth.ts`
- [x] `Pty` — `pty/index.ts`
- [x] `Question` — `question/index.ts`
- [x] `SessionStatus` — `session/status.ts`
- [x] `Skill` — `skill/index.ts`
- [x] `Snapshot` — `snapshot/index.ts`
- [x] `ToolRegistry` — `tool/registry.ts`
- [x] `Truncate` — `tool/truncate.ts`
- [x] `Vcs` — `project/vcs.ts`
- [x] `Worktree` — `worktree/index.ts`

- [x] `Session` — `session/index.ts`
- [x] `SessionProcessor` — `session/processor.ts`
- [x] `SessionPrompt` — `session/prompt.ts`
- [x] `SessionCompaction` — `session/compaction.ts`
- [x] `SessionSummary` — `session/summary.ts`
- [x] `SessionRevert` — `session/revert.ts`
- [x] `Instruction` — `session/instruction.ts`
- [x] `SystemPrompt` — `session/system.ts`
- [x] `Provider` — `provider/provider.ts`
- [x] `Storage` — `storage/storage.ts`
- [x] `ShareNext` — `share/share-next.ts`
- [x] `SessionTodo` — `session/todo.ts`

Still open at the service-shape level:

- [ ] `SyncEvent` — `sync/index.ts` (deferred pending sync with James)
- [ ] `Workspace` — `control-plane/workspace.ts` (deferred pending sync with James)

## Tool migration

Tool-specific migration guidance and checklist live in `tools.md`.

## Effect service adoption in already-migrated code

Some already-effectified areas still use raw `Filesystem.*` or `Process.spawn` in their implementation or helper modules. These are low-hanging fruit — the layers already exist, they just need the dependency swap.

### `Filesystem.*` → `AppFileSystem.Service` (yield in layer)

- [x] `config/config.ts` — `installDependencies()` now uses `AppFileSystem`
- [x] `provider/provider.ts` — recent model state now reads via `AppFileSystem.Service`

### `Process.spawn` → `ChildProcessSpawner` (yield in layer)

- [x] `format/formatter.ts` — direct `Process.spawn()` checks removed (`air`, `uv`)
- [ ] `lsp/server.ts` — multiple `Process.spawn()` installs/download helpers

## Filesystem consolidation

`util/filesystem.ts` is still used widely across `src/`, and raw `fs` / `fs/promises` imports still exist in multiple tooling and infrastructure files. As services and tools are effectified, they should switch from `Filesystem.*` to yielding `AppFileSystem.Service` where possible — this should happen naturally during each migration, not as a separate sweep.

Tool-specific filesystem cleanup notes live in `tools.md`.

## Primitives & utilities

- [ ] `util/lock.ts` — reader-writer lock → Effect Semaphore/Permit
- [ ] `util/flock.ts` — file-based distributed lock with heartbeat → Effect.repeat + addFinalizer
- [ ] `util/process.ts` — child process spawn wrapper → return Effect instead of Promise
- [ ] `util/lazy.ts` — replace uses in Effect code with Effect.cached; keep for sync-only code

## Destroying the facades

This phase is still broadly open. As of 2026-04-13 there are still 15 `makeRuntime(...)` call sites under `src/`, with 13 still in scope for facade removal. The live checklist now lives in `facades.md`.

These facades exist because cyclic imports used to force each service to build its own independent runtime. Now that the layer DAG is acyclic and `AppRuntime` (`src/effect/app-runtime.ts`) composes everything into one `ManagedRuntime`, we're removing them.

### Process

For each service, the migration is roughly:

1. **Find callers.** `grep -n "Namespace\.(methodA|methodB|...)"` across `src/` and `test/`. Skip the service file itself.
2. **Migrate production callers.** For each effectful caller that does `Effect.tryPromise(() => Namespace.method(...))`:
   - Add the service to the caller's layer R type (`Layer.Layer<Self, never, ... | Namespace.Service>`)
   - Yield it at the top of the layer: `const ns = yield* Namespace.Service`
   - Replace `Effect.tryPromise(() => Namespace.method(...))` with `yield* ns.method(...)` (or `ns.method(...).pipe(Effect.orElseSucceed(...))` for the common fallback case)
   - Add `Layer.provide(Namespace.defaultLayer)` to the caller's own `defaultLayer` chain
3. **Fix tests that used the caller's raw `.layer`.** Any test that composes `Caller.layer` (not `defaultLayer`) needs to also provide the newly-required service tag. The fastest fix is usually switching to `Caller.defaultLayer` since it now pulls in the new dependency.
4. **Migrate test callers of the facade.** Tests calling `Namespace.method(...)` directly get converted to full effectful style using `testEffect(Namespace.defaultLayer)` + `it.live` / `it.effect` + `yield* svc.method(...)`. Don't wrap the test body in `Effect.promise(async () => {...})` — do the whole thing in `Effect.gen` and use `AppFileSystem.Service` / `tmpdirScoped` / `Effect.addFinalizer` for what used to be raw `fs` / `Bun.write` / `try/finally`.
5. **Delete the facades.** Once `grep` shows zero callers, remove the `export async function` block AND the `makeRuntime(...)` line from the service namespace. Also remove the now-unused `import { makeRuntime }`.

### Pitfalls

- **Layer caching inside tests.** `testEffect(layer)` constructs the Storage (or whatever) service once and memoizes it. If a test then tries `inner.pipe(Effect.provide(customStorage))` to swap in a differently-configured Storage, the outer cached one wins and the inner provision is a no-op. Fix: wrap the overriding layer in `Layer.fresh(...)`, which forces a new instance to be built instead of hitting the memoMap cache. This lets a single `testEffect(...)` serve both simple and per-test-customized cases.
- **`Effect.tryPromise` → `yield*` drops the Promise layer.** The old code was `Effect.tryPromise(() => Storage.read(...))` — a `tryPromise` wrapper because the facade returned a Promise. The new code is `yield* storage.read(...)` directly — the service method already returns an Effect, so no wrapper is needed. Don't reach for `Effect.promise` or `Effect.tryPromise` during migration; if you're using them on a service method call, you're doing it wrong.
- **Raw `.layer` test callers break silently in the type checker.** When you add a new R requirement to a service's `.layer`, any test that composes it raw (not `defaultLayer`) becomes under-specified. `tsgo` will flag this — the error looks like `Type 'Storage.Service' is not assignable to type '... | Service | TestConsole'`. Usually the fix is to switch that composition to `defaultLayer`, or add `Layer.provide(NewDep.defaultLayer)` to the custom composition.
- **Tests that do async setup with `fs`, `Bun.write`, `tmpdir`.** Convert these to `AppFileSystem.Service` calls inside `Effect.gen`, and use `tmpdirScoped()` instead of `tmpdir()` so cleanup happens via the scope finalizer. For file operations on the actual filesystem (not via a service), a small helper like `const writeJson = Effect.fnUntraced(function* (file, value) { const fs = yield* AppFileSystem.Service; yield* fs.makeDirectory(path.dirname(file), { recursive: true }); yield* fs.writeFileString(file, JSON.stringify(value, null, 2)) })` keeps the migration tests clean.

### Migration log

- `SessionStatus` — migrated 2026-04-11. Replaced the last route and retry-policy callers with `AppRuntime.runPromise(SessionStatus.Service.use(...))` and removed the `makeRuntime(...)` facade.
- `ShareNext` — migrated 2026-04-11. Swapped remaining async callers to `AppRuntime.runPromise(ShareNext.Service.use(...))`, removed the `makeRuntime(...)` facade, and kept instance bootstrap on the shared app runtime.
- `SessionTodo` — migrated 2026-04-10. Already matched the target service shape in `session/todo.ts`: single namespace, traced Effect methods, and no `makeRuntime(...)` facade remained; checklist updated to reflect the completed migration.
- `Storage` — migrated 2026-04-10. One production caller (`Session.diff`) and all storage.test.ts tests converted to effectful style. Facades and `makeRuntime` removed.
- `SessionRunState` — migrated 2026-04-11. Single caller in `server/instance/session.ts` converted; facade removed.
- `Account` — migrated 2026-04-11. Callers in `server/instance/experimental.ts` and `cli/cmd/account.ts` converted; facade removed.
- `Instruction` — migrated 2026-04-11. Test-only callers converted; facade removed.
- `FileWatcher` — migrated 2026-04-11. Callers in `project/bootstrap.ts` and test converted; facade removed.
- `Question` — migrated 2026-04-11. Callers in `server/instance/question.ts` and test converted; facade removed.
- `Truncate` — migrated 2026-04-11. Caller in `tool/tool.ts` and test converted; facade removed.

## Route handler effectification

Route-handler migration guidance and checklist live in `routes.md`.
