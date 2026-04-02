# Effect patterns

Practical reference for new and migrated Effect code in `packages/opencode`.

## Choose scope

Use `InstanceState` (from `src/effect/instance-state.ts`) for services that need per-directory state, per-instance cleanup, or project-bound background work. InstanceState uses a `ScopedCache` keyed by directory, so each open project gets its own copy of the state that is automatically cleaned up on disposal.

Use `makeRuntime` (from `src/effect/run-service.ts`) to create a per-service `ManagedRuntime` that lazily initializes and shares layers via a global `memoMap`. Returns `{ runPromise, runFork, runCallback }`.

- Global services (no per-directory state): Account, Auth, AppFileSystem, Installation, Truncate, Worktree
- Instance-scoped (per-directory state via InstanceState): Agent, Bus, Command, Config, File, FileTime, FileWatcher, Format, LSP, MCP, Permission, Plugin, ProviderAuth, Pty, Question, SessionStatus, Skill, Snapshot, ToolRegistry, Vcs

Rule of thumb: if two open directories should not share one copy of the service, it needs `InstanceState`.

## Service shape

Every service follows the same pattern — a single namespace with the service definition, layer, `runPromise`, and async facade functions:

```ts
export namespace Foo {
  export interface Interface {
    readonly get: (id: FooID) => Effect.Effect<FooInfo, FooError>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Foo") {}

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

Fully migrated (single namespace, InstanceState where needed, flattened facade):

- [x] `Account` — `account/index.ts`
- [x] `Agent` — `agent/agent.ts`
- [x] `AppFileSystem` — `filesystem/index.ts`
- [x] `Auth` — `auth/index.ts` (uses `zod()` helper for Schema→Zod interop)
- [x] `Bus` — `bus/index.ts`
- [x] `Command` — `command/index.ts`
- [x] `Config` — `config/config.ts`
- [x] `Discovery` — `skill/discovery.ts` (dependency-only layer, no standalone runtime)
- [x] `File` — `file/index.ts`
- [x] `FileTime` — `file/time.ts`
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
- [x] `Provider` — `provider/provider.ts`
- [x] `Storage` — `storage/storage.ts`

Still open:

- [ ] `SessionTodo` — `session/todo.ts`
- [ ] `ShareNext` — `share/share-next.ts`
- [ ] `SyncEvent` — `sync/index.ts`
- [ ] `Workspace` — `control-plane/workspace.ts`

## Tool interface → Effect

Once individual tools are effectified, change `Tool.Info` (`tool/tool.ts`) so `init` and `execute` return `Effect` instead of `Promise`. This lets tool implementations compose natively with the Effect pipeline rather than being wrapped in `Effect.promise()` at the call site. Requires:

1. Migrate each tool to return Effects
2. Update `Tool.define()` factory to work with Effects
3. Update `SessionPrompt` to `yield*` tool results instead of `await`ing

Individual tools, ordered by value:

- [ ] `apply_patch.ts` — HIGH: multi-step orchestration, error accumulation, Bus events
- [ ] `bash.ts` — HIGH: shell orchestration, quoting, timeout handling, output capture
- [ ] `read.ts` — HIGH: streaming I/O, readline, binary detection → FileSystem + Stream
- [ ] `edit.ts` — HIGH: multi-step diff/format/publish pipeline, FileWatcher lock
- [ ] `grep.ts` — MEDIUM: spawns ripgrep → ChildProcessSpawner, timeout handling
- [ ] `write.ts` — MEDIUM: permission checks, diagnostics polling, Bus events
- [ ] `codesearch.ts` — MEDIUM: HTTP + SSE + manual timeout → HttpClient + Effect.timeout
- [ ] `webfetch.ts` — MEDIUM: fetch with UA retry, size limits → HttpClient
- [ ] `websearch.ts` — MEDIUM: MCP over HTTP → HttpClient
- [ ] `batch.ts` — MEDIUM: parallel execution, per-call error recovery → Effect.all
- [ ] `task.ts` — MEDIUM: task state management
- [ ] `ls.ts` — MEDIUM: bounded directory listing over ripgrep-backed traversal
- [ ] `multiedit.ts` — MEDIUM: sequential edit orchestration over `edit.ts`
- [ ] `glob.ts` — LOW: simple async generator
- [ ] `lsp.ts` — LOW: dispatch switch over LSP operations
- [ ] `question.ts` — LOW: prompt wrapper
- [ ] `skill.ts` — LOW: skill tool adapter
- [ ] `todo.ts` — LOW: todo persistence wrapper
- [ ] `invalid.ts` — LOW: invalid-tool fallback
- [ ] `plan.ts` — LOW: plan file operations

## Effect service adoption in already-migrated code

Some already-effectified areas still use raw `Filesystem.*` or `Process.spawn` in their implementation or helper modules. These are low-hanging fruit — the layers already exist, they just need the dependency swap.

### `Filesystem.*` → `AppFileSystem.Service` (yield in layer)

- [ ] `file/index.ts` — 1 remaining `Filesystem.readText()` call in untracked diff handling
- [ ] `config/config.ts` — 5 remaining `Filesystem.*` calls in `installDependencies()`
- [ ] `provider/provider.ts` — 1 remaining `Filesystem.readJson()` call for recent model state

### `Process.spawn` → `ChildProcessSpawner` (yield in layer)

- [ ] `format/formatter.ts` — 2 remaining `Process.spawn()` checks (`air`, `uv`)
- [ ] `lsp/server.ts` — multiple `Process.spawn()` installs/download helpers

## Filesystem consolidation

`util/filesystem.ts` (raw fs wrapper) is currently imported by **34 files**. The effectified `AppFileSystem` service (`filesystem/index.ts`) is currently imported by **15 files**. As services and tools are effectified, they should switch from `Filesystem.*` to yielding `AppFileSystem.Service` — this happens naturally during each migration, not as a separate effort.

Similarly, **21 files** still import raw `fs` or `fs/promises` directly. These should migrate to `AppFileSystem` or `Filesystem.*` as they're touched.

Current raw fs users that will convert during tool migration:

- `tool/read.ts` — fs.createReadStream, readline
- `tool/apply_patch.ts` — fs/promises
- `file/ripgrep.ts` — fs/promises
- `patch/index.ts` — fs, fs/promises

## Primitives & utilities

- [ ] `util/lock.ts` — reader-writer lock → Effect Semaphore/Permit
- [ ] `util/flock.ts` — file-based distributed lock with heartbeat → Effect.repeat + addFinalizer
- [ ] `util/process.ts` — child process spawn wrapper → return Effect instead of Promise
- [ ] `util/lazy.ts` — replace uses in Effect code with Effect.cached; keep for sync-only code
