# Effect patterns

Practical reference for new and migrated Effect code in `packages/opencode`.

## Choose scope

Use the shared runtime for process-wide services with one lifecycle for the whole app.

Use `src/effect/instances.ts` for services that are created per directory or need `InstanceContext`, per-project state, or per-instance cleanup.

- Shared runtime: config readers, stateless helpers, global clients
- Instance-scoped: watchers, per-project caches, session state, project-bound background work

Rule of thumb: if two open directories should not share one copy of the service, it belongs in `Instances`.

## Service shape

For a fully migrated module, use the public namespace directly:

```ts
export namespace Foo {
  export interface Interface {
    readonly get: (id: FooID) => Effect.Effect<FooInfo, FooError>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Foo") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      return Service.of({
        get: Effect.fn("Foo.get")(function* (id) {
          return yield* ...
        }),
      })
    }),
  )

  export const defaultLayer = layer.pipe(Layer.provide(FooRepo.defaultLayer))
}
```

Rules:

- Keep `Interface`, `Service`, `layer`, and `defaultLayer` on the owning namespace
- Export `defaultLayer` only when wiring dependencies is useful
- Use the direct namespace form once the module is fully migrated

## Temporary mixed-mode pattern

Prefer a single namespace whenever possible.

Use a `*Effect` namespace only when there is a real mixed-mode split, usually because a legacy boundary facade still exists or because merging everything immediately would create awkward cycles.

```ts
export namespace FooEffect {
  export interface Interface {
    readonly get: (id: FooID) => Effect.Effect<Foo, FooError>
  }

  export class Service extends ServiceMap.Service<Service, Interface>()("@opencode/Foo") {}

  export const layer = Layer.effect(...)
}
```

Then keep the old boundary thin:

```ts
export namespace Foo {
  export function get(id: FooID) {
    return runtime.runPromise(FooEffect.Service.use((svc) => svc.get(id)))
  }
}
```

Remove the `Effect` suffix when the boundary split is gone.

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

Done now:

- [x] `AccountEffect` (mixed-mode)
- [x] `AuthEffect` (mixed-mode)
- [x] `TruncateEffect` (mixed-mode)
- [x] `Question`
- [x] `PermissionNext`
- [x] `ProviderAuth`
- [x] `FileWatcher`
- [x] `FileTime`
- [x] `Format`
- [x] `Vcs`
- [x] `Skill`
- [x] `Discovery`
- [x] `File`
- [x] `Snapshot`

Still open and likely worth migrating:

- [ ] `Plugin`
- [ ] `ToolRegistry`
- [ ] `Pty`
- [ ] `Worktree`
- [ ] `Installation`
- [ ] `Bus`
- [ ] `Command`
- [ ] `Config`
- [ ] `Session`
- [ ] `SessionProcessor`
- [ ] `SessionPrompt`
- [ ] `SessionCompaction`
- [ ] `Provider`
- [ ] `Project`
- [ ] `LSP`
- [ ] `MCP`
