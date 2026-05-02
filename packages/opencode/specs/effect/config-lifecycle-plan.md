# Config Lifecycle Plan

## Goal

Remove instance disposal from `Config` so config loading/writing stays a pure config concern and runtime lifecycle invalidation happens at the caller/orchestration boundary.

This specifically removes the need for `Config` to import or lazily import `InstanceRuntime`.

## Current Coupling

`src/config/config.ts` currently does three separate things:

1. Load and cache global config.
2. Load, merge, and write project/global config files.
3. Dispose instances when config changes.

The third responsibility is the problem.

Current disposal paths:

1. `Config.update(config)` writes project `config.json`, then disposes the active instance unless `options.dispose === false`.
2. `Config.updateGlobal(config)` writes global config, then calls `Config.invalidate()` if the file changed.
3. `Config.invalidate(wait)` invalidates the global config cache, disposes all instances, and emits a global disposed event.

## Desired Ownership

`Config` should own:

1. Reading config files.
2. Parsing and merging config.
3. Writing project/global config files.
4. Invalidating only its own global config cache.

Callers should own:

1. Disposing the current instance after a project config update.
2. Disposing all instances after a global config update or explicit reload.
3. Emitting server/global lifecycle events after disposal.

## Concrete API Changes

### `src/config/config.ts`

1. Remove `loadInstanceRuntime()`.
2. Remove `InstanceRuntime`/`InstanceStore`/lifecycle imports from config.
3. Change `Interface.update` from:

```ts
readonly update: (config: Info, options?: { dispose?: boolean }) => Effect.Effect<void>
```

to:

```ts
readonly update: (config: Info) => Effect.Effect<void>
```

4. Change `Config.update` implementation to only write the project `config.json`.
5. Change `Interface.invalidate` to a config-only cache invalidation method, or rename it for clarity.

Preferred final shape:

```ts
readonly invalidate: () => Effect.Effect<void>
```

`invalidate()` should only run `invalidateGlobal`.

6. Change `Config.updateGlobal` to write global config, invalidate only config-global cache when changed, and return whether the file changed.

Preferred final shape:

```ts
readonly updateGlobal: (config: Info) => Effect.Effect<{ info: Info; changed: boolean }>
```

Implementation detail:

```ts
if (changed) yield* invalidate()
return { info: next, changed }
```

Public API routes should still return only `result.info`; `changed` is for lifecycle orchestration only.

## Caller Updates

### Legacy instance config route

File: `src/server/routes/instance/config.ts`

Current:

```ts
const cfg = yield* Config.Service
yield* cfg.update(config)
return config
```

Change to:

```ts
const cfg = yield* Config.Service
yield* cfg.update(config)
const store = yield* InstanceStore.Service
yield* store.dispose(Instance.current)
return config
```

Imports needed:

```ts
import { Instance } from "@/project/instance"
import { InstanceStore } from "@/project/instance-store"
```

Rationale: this route is an instance-scoped orchestration boundary, so it should own the instance disposal after writing project config.

### Effect HttpApi instance config route

File: `src/server/routes/instance/httpapi/handlers/config.ts`

Current:

```ts
yield* configSvc.update(ctx.payload, { dispose: false })
yield* markInstanceForDisposal(yield* InstanceState.context)
return ctx.payload
```

Change to:

```ts
yield* configSvc.update(ctx.payload)
yield* markInstanceForDisposal(yield* InstanceState.context)
return ctx.payload
```

Rationale: this route already has correct ownership. It writes config first, then delegates disposal to HttpApi lifecycle middleware.

### Legacy global config route

File: `src/server/routes/global.ts`

Current:

```ts
const next = await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.updateGlobal(config)))
return c.json(next)
```

Change to run config write, then if the file changed, schedule the same dispose-all/global-disposed side effect that `Config.invalidate(false)` currently schedules.

Important behavior to preserve:

1. Do not dispose instances when the serialized global config did not change.
2. Do not make the HTTP response wait for instance disposal. Current `updateGlobal -> invalidate()` schedules disposal asynchronously when `wait` is omitted.

Preferred implementation shape:

```ts
const result = await AppRuntime.runPromise(
  Effect.gen(function* () {
    const cfg = yield* Config.Service
    return yield* cfg.updateGlobal(config)
  }),
)
if (result.changed) void AppRuntime.runPromise(disposeAllInstancesAndEmitGlobalDisposed).catch(() => undefined)
return c.json(result.info)
```

Imports needed:

```ts
import { Effect } from "effect"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"
```

`src/server/routes/global.ts` already defines `GlobalDisposedEvent`; move that event definition to the shared helper module or re-export it from there so `/dispose`, legacy global config update, and HttpApi global config update use one event source.

### Effect HttpApi global config route

File: `src/server/routes/instance/httpapi/handlers/global.ts`

Current:

```ts
return yield* config.updateGlobal(ctx.payload)
```

Change to preserve the existing changed-only and async-disposal semantics:

```ts
const result = yield* config.updateGlobal(ctx.payload)
if (result.changed) bridge.fork(disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true }))
return result.info
```

Imports needed:

```ts
import { EffectBridge } from "@/effect/bridge"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"
```

Also yield a stable bridge at handler construction:

```ts
const bridge = yield* EffectBridge.make()
```

Do not use `Effect.forkScoped` for this fire-and-forget disposal; the request scope can close before disposal finishes.

`src/server/routes/instance/httpapi/handlers/global.ts` already yields `InstanceStore.Service` for `/dispose`. Keep `/dispose` strict, or use the shared helper with `swallowErrors: false` so explicit disposal failures still surface.

### TUI worker reload

File: `src/cli/cmd/tui/worker.ts`

Current:

```ts
await AppRuntime.runPromise(Config.Service.use((cfg) => cfg.invalidate(true)))
```

Change to:

```ts
await AppRuntime.runPromise(
  Effect.gen(function* () {
    const cfg = yield* Config.Service
    const store = yield* InstanceStore.Service
    yield* cfg.invalidate()
    yield* store.disposeAll()
  }),
)
```

Imports needed:

```ts
import { Effect } from "effect"
import { InstanceStore } from "@/project/instance-store"
```

No global disposed event is required here unless existing TUI behavior depends on it. The current worker path only calls `Config.invalidate(true)` and does not directly interact with server event streams.

## Helper Extraction

If both global routes need identical "dispose all and emit global disposed" behavior, extract a helper outside `Config`.

Preferred location:

`src/server/global-lifecycle.ts`

Suggested helper:

```ts
export const emitGlobalDisposed = Effect.sync(() =>
  GlobalBus.emit("event", {
    directory: "global",
    payload: {
      type: Event.Disposed.type,
      properties: {},
    },
  }),
)

export const disposeAllInstancesAndEmitGlobalDisposed = Effect.fn("Server.disposeAllInstancesAndEmitGlobalDisposed")(function* (options?: {
  swallowErrors?: boolean
}) {
  const store = yield* InstanceStore.Service
  const dispose = store.disposeAll()
  yield* (options?.swallowErrors ? dispose.pipe(Effect.catch(() => Effect.void)) : dispose)
  yield* emitGlobalDisposed
})
```

Use this helper only from server/global route code and explicit reload/dispose orchestration. Do not import it into `Config`.

Use `swallowErrors: true` only for paths that previously swallowed disposal errors, such as config invalidation. Keep explicit `/dispose` strict by omitting `swallowErrors`.

## Tests To Update

### Config tests

File: `test/config/config.test.ts`

1. `save(...)`, `saveGlobal(...)`, and `clear(...)` helpers should still run against `Config.layer` only.
2. They should not need `InstanceRuntime`, `InstanceStore`, or no-op lifecycle mocks.
3. Existing config tests should continue to pass because config no longer disposes instances internally.

### TUI config tests

File: `test/config/tui.test.ts`

1. The `clear` helper currently calls `Config.invalidate` through `AppRuntime`.
2. After `invalidate()` is config-only, this is fine and should not dispose instances.

### Route behavior tests

Add or update focused tests for lifecycle ownership:

1. Legacy instance config route disposes only the active instance after project config update.
2. HttpApi instance config route still marks the active instance for disposal after project config update.
3. Legacy global config route disposes all instances after global config update.
4. HttpApi global config route disposes all instances after global config update.
5. Global config routes do not dispose instances when the config write is a no-op.

Prefer existing route tests if they already cover config update behavior. Do not add broad integration tests unless necessary.

Suggested new focused files if no existing test has the right harness:

1. `test/server/global-config.test.ts` for legacy Hono global config update lifecycle.
2. `test/server/httpapi-global-config.test.ts` for Effect HttpApi global config update lifecycle.

## Verification Commands

Run from `packages/opencode`:

```bash
bun typecheck
bun run test test/config/config.test.ts test/config/tui.test.ts
bun run test test/server/httpapi-config.test.ts test/server/httpapi-instance-context.test.ts test/server/httpapi-bridge.test.ts
bun run test test/server/global-config.test.ts test/server/httpapi-global-config.test.ts
bun run test test/project/instance-bootstrap-regression.test.ts test/agent/plugin-agent-regression.test.ts test/project/instance.test.ts
env -u OPENCODE_EXPERIMENTAL_WORKSPACES bun run test
```

## Non-Goals

1. Do not remove `InstanceRuntime` entirely in this change. It is still needed for legacy Promise/ALS callers.
2. Do not change `InstanceStore` bootstrap ownership.
3. Do not change config parsing/merging semantics.
4. Do not make `Config.layer` depend on `InstanceStore.Service`.

## Expected End State

1. `src/config/config.ts` has no import or dynamic import of `InstanceRuntime`, `InstanceStore`, or server lifecycle helpers.
2. `Config.update` and `Config.updateGlobal` only write config and invalidate config-owned caches.
3. Instance disposal is visible at route/worker orchestration boundaries.
4. Tests that exercise config parsing/writing no longer need special lifecycle stubs.
