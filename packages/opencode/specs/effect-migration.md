# Effect patterns

Practical reference for new and migrated Effect code in `packages/opencode`.

## Choose scope

Use `InstanceState` (from `src/effect/instance-state.ts`) for services that need per-directory state, per-instance cleanup, or project-bound background work. InstanceState uses a `ScopedCache` keyed by directory, so each open project gets its own copy of the state that is automatically cleaned up on disposal.

Use `makeRuntime` (from `src/effect/run-service.ts`) to create a per-service `ManagedRuntime` that lazily initializes and shares layers via a global `memoMap`. Returns `{ runPromise, runFork, runCallback }`.

- Global services (no per-directory state): Account, Auth, Installation, Truncate
- Instance-scoped (per-directory state via InstanceState): File, FileTime, FileWatcher, Format, Permission, Question, Skill, Snapshot, Vcs, ProviderAuth

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
- [x] `Auth` — `auth/index.ts` (uses `zod()` helper for Schema→Zod interop)
- [x] `File` — `file/index.ts`
- [x] `FileTime` — `file/time.ts`
- [x] `FileWatcher` — `file/watcher.ts`
- [x] `Format` — `format/index.ts`
- [x] `Installation` — `installation/index.ts`
- [x] `Permission` — `permission/index.ts`
- [x] `ProviderAuth` — `provider/auth.ts`
- [x] `Question` — `question/index.ts`
- [x] `Skill` — `skill/index.ts`
- [x] `Snapshot` — `snapshot/index.ts`
- [x] `Truncate` — `tool/truncate.ts`
- [x] `Vcs` — `project/vcs.ts`
- [x] `Discovery` — `skill/discovery.ts`
- [x] `SessionStatus`

Still open and likely worth migrating:

- [x] `Plugin`
- [x] `ToolRegistry`
- [ ] `Pty`
- [x] `Worktree`
- [x] `Bus`
- [x] `Command`
- [ ] `Config`
- [ ] `Session`
- [ ] `SessionProcessor`
- [ ] `SessionPrompt`
- [ ] `SessionCompaction`
- [ ] `Provider`
- [x] `Project`
- [ ] `LSP`
- [x] `MCP`
