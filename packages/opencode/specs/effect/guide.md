# Effect Guide

How we write Effect code in `packages/opencode`. The companion roadmap is
[`todo.md`](./todo.md).

This guide describes the preferred shape for new work and migrations. If a
legacy file differs, migrate it only when it is already in scope.

## Service Shape

Use one module per service: flat top-level exports, traced Effect methods,
explicit layers, and a self-reexport at the bottom.

```ts
export interface Interface {
  readonly get: (id: FooID) => Effect.Effect<FooInfo, FooError>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Foo") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const state = yield* InstanceState.make<State>(Effect.fn("Foo.state")(() => Effect.succeed({})))

    const get = Effect.fn("Foo.get")(function* (id: FooID) {
      const s = yield* InstanceState.get(state)
      return yield* loadFoo(s, id)
    })

    return Service.of({ get })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(FooDep.defaultLayer))

export * as Foo from "./foo"
```

Rules:

- Do not use `export namespace Foo { ... }`.
- Use `Effect.fn("Foo.method")` for public service methods.
- Use `Effect.fnUntraced` for small internal helpers that do not need a
  span.
- Keep helpers as non-exported top-level declarations in the same file.
- Self-reexport with `export * as Foo from "."` for `index.ts`, otherwise
  `export * as Foo from "./foo"`.
- In `src/config`, keep the existing top-of-file self-export pattern.

## Runtime Boundaries

Most code should run through [`AppRuntime`](../../src/effect/app-runtime.ts).
It hosts `AppLayer`, shares the global `memoMap`, and restores the current
instance/workspace refs when crossing from non-Effect code.

Use `AppRuntime.runPromise(effect)` at app boundaries such as CLI commands,
HTTP handlers, or plain async adapters.

`makeRuntime(...)` still exists for a few intentional service-local
boundaries and migration leftovers. Do not add a new service-local runtime
unless the service truly cannot live in `AppLayer`.

## Runtime Flags

Read opencode runtime flags through
[`RuntimeFlags.Service`](../../src/effect/runtime-flags.ts), not through
mutable `Flag` or late `process.env` reads.

Tests should vary behavior with explicit layer variants:

```ts
const it = testEffect(MyService.defaultLayer.pipe(Layer.provide(RuntimeFlags.layer({ experimentalScout: true }))))
```

Do not mutate `process.env` or `Flag` after services/layers are built.

## Per-Instance State

Use [`InstanceState`](../../src/effect/instance-state.ts) when two open
directories should not share one copy of a service's state. It is backed by
a `ScopedCache`, keyed by directory, and disposed automatically when an
instance is unloaded.

Put subscriptions, finalizers, and scoped background work inside the
`InstanceState.make(...)` initializer:

```ts
const cache =
  yield *
  InstanceState.make<State>(
    Effect.fn("Foo.state")(function* () {
      const bus = yield* Bus.Service

      yield* bus.subscribeAll().pipe(
        Stream.runForEach((event) => handleEvent(event)),
        Effect.forkScoped,
      )

      yield* Effect.acquireRelease(openResource, closeResource)

      return yield* loadInitialState()
    }),
  )
```

Do not add separate `started` flags on top of `InstanceState`. Let
`ScopedCache` handle run-once and deduplication.

To make `init()` non-blocking, fork at the caller/bootstrap boundary. Do
not fork inside `InstanceState.make(...)` just to return early with
partially initialized state.

## Errors

Expected domain failures belong on the Effect error channel. Defects are
for bugs, impossible states, and final unknown-boundary fallbacks.

```ts
export class SessionBusyError extends Schema.TaggedErrorClass<SessionBusyError>()("SessionBusyError", {
  sessionID: SessionID,
  message: Schema.String,
}) {}

export type Error = Storage.Error | SessionBusyError

export interface Interface {
  readonly get: (id: SessionID) => Effect.Effect<Info, Error>
}
```

Rules:

- Use `Schema.TaggedErrorClass` for new expected domain errors.
- Export a domain-level `Error` union from service modules.
- In `Effect.gen` / `Effect.fn`, prefer `yield* new MyError(...)` for
  direct expected failures.
- Use `Schema.Defect` for unknown cause fields.
- Use `Effect.try(...)`, `Effect.tryPromise(...)`, `Effect.mapError`,
  `Effect.catchTag`, and `Effect.catchTags` to translate external
  failures into domain errors.
- Do not use `Effect.die(...)` for user, IO, validation, missing-resource,
  auth, provider, or busy-state failures.

## HTTP Error Boundaries

Service modules stay HTTP-agnostic. They should not import HTTP status
codes, `HttpApiError`, `HttpServerResponse`, or route-specific error
schemas.

HTTP handlers translate service errors into endpoint-declared public error
schemas. Keep mappings inline when they are one-off; extract tiny shared
helpers only when the same translation repeats.

Do not turn generic middleware into a registry of domain errors. Middleware
should handle cross-cutting concerns and the final unknown-defect fallback.

Preserve legacy public wire shapes, such as `{ name, data }`, until a
deliberate breaking API change.

## Schemas

Use Effect Schema as the source of truth.

- Use `Schema.Class` for exported data objects with a clear identity.
- Use `Schema.Struct` for local shapes and simple nested objects.
- Use `Schema.brand` for single-value IDs.
- Reuse named refinements instead of re-spelling constraints.
- Prefer narrow boundary helpers over generic Schema-to-Zod bridges.

Intentional boundaries:

- Public plugin tools still expose Zod through `tool.schema = z`.
- Tool parameter JSON Schema is generated through tool-specific helpers.
- Public config and TUI schemas are generated through the schema script.

## Preferred Services

In effectified code, yield existing services instead of dropping to ad hoc
platform APIs.

- Use `AppFileSystem.Service` instead of raw `fs/promises` for app file IO.
- Use `AppProcess.Service` instead of direct `ChildProcessSpawner.spawn` or
  legacy process helpers.
- Use `HttpClient.HttpClient` instead of raw `fetch` inside Effect code.
- Use `Path.Path`, `Config`, `Clock`, and `DateTime` when already inside
  Effect.
- Use `Effect.callback` for callback-based APIs.
- Use `Effect.void` instead of `Effect.succeed(undefined)`.
- Use `Effect.cached` when concurrent callers should share one in-flight
  computation.

For background loops, use `Effect.repeat` or `Effect.schedule` with
`Effect.forkScoped` in the owning layer/state scope.

## Promise And ALS Bridges

[`EffectBridge`](../../src/effect/bridge.ts) is the sanctioned helper for
Promise/callback interop that needs to preserve instance/workspace context.
Keep it, but reduce its dependency on legacy `Instance.current` /
`Instance.restore` over time.

`Instance.bind` / `Instance.restore` are transitional legacy tools. Use
them only for native callbacks that still require legacy ALS context. Do
not use them for `setTimeout`, `Promise.then`, `EventEmitter.on`, or
Effect fibers.

## Testing

Detailed test migration rules live in
[`test/EFFECT_TEST_MIGRATION.md`](../../test/EFFECT_TEST_MIGRATION.md).

Core pattern:

```ts
const it = testEffect(Layer.mergeAll(MyService.defaultLayer))

describe("my service", () => {
  it.instance("does the thing", () =>
    Effect.gen(function* () {
      const svc = yield* MyService.Service
      expect(yield* svc.run()).toEqual("ok")
    }),
  )
})
```

Rules:

- Use `it.effect(...)` for TestClock/TestConsole tests.
- Use `it.live(...)` for real timers, filesystem mtimes, child processes,
  git, locks, or other live integration behavior.
- Use `it.instance(...)` for service tests that need a scoped instance.
- Prefer Effect-aware fixtures from `test/fixture/fixture.ts`.
- Avoid sleeps; wait for real events or deterministic state transitions.
- Avoid mutable `process.env`, `Flag`, or module-global changes after
  layers are built.
- Use `Layer.mock` for partial service stubs.
- Avoid custom `ManagedRuntime`, `attach(...)`, or ad hoc `run(...)` test
  wrappers.

## Verification

From `packages/opencode`:

```bash
bun run typecheck
bun run test -- path/to/test.ts
```

Do not run tests from the repo root; the repo has a guard for that.
