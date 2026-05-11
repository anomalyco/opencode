# Effect Test Migration Plan

This document describes how to move opencode tests out of Promise-land and into the shared `testEffect` pattern.

## Target Pattern

Every test file that exercises Effect services should have one local runner near the top:

```ts
const it = testEffect(layer)
```

Then each test should use one of the runner methods:

```ts
it.effect("pure service behavior", () =>
  Effect.gen(function* () {
    const service = yield* SomeService.Service
    expect(yield* service.run()).toEqual("ok")
  }),
)

it.instance("instance-local behavior", () =>
  Effect.gen(function* () {
    const test = yield* TestInstance
    // test.directory is a scoped temp opencode instance
  }),
)

it.live("live filesystem or process behavior", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    // real clock / fs / git / process work
  }),
)
```

Use `it.effect` for pure Effect code that should run with `TestClock` and `TestConsole`.
Use `it.instance` when the test needs one scoped opencode instance.
Use `it.live` when the test depends on real time, filesystem mtimes, git, child processes, servers, file watchers, or OS behavior.

## Anti-Patterns To Remove

Avoid these in tests that already target Effect services:

- `test(..., async () => Effect.runPromise(...))`
- local `run(...)`, `load(...)`, `svc(...)`, or `runtime.runPromise(...)` wrappers that only provide a layer
- `tmpdir()` plus `WithInstance.provide(...)` in Promise test bodies
- custom `ManagedRuntime.make(...)` in test files
- Promise `try/catch` around Effect failures
- `Promise.withResolvers`, `Bun.sleep`, or `setTimeout` for synchronization when `Deferred`, `Fiber`, or `Effect.sleep` can express the same behavior

Promise helpers are acceptable at the boundary for non-Effect APIs, but they should be yielded from an Effect body with `Effect.promise(...)` rather than becoming the test harness.

## Layer Rules

Compose tests from open service layers, not closed `defaultLayer` graphs when a dependency needs replacing.

Good:

```ts
const layer = Config.layer.pipe(
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(Env.defaultLayer),
  Layer.provide(AuthTest.empty),
  Layer.provide(AccountTest.empty),
  Layer.provide(NpmTest.noop),
)
```

Avoid using a fully closed layer and hoping to override an inner dependency later. Once `Agent.defaultLayer` has already provided `Config.defaultLayer`, tests cannot cleanly swap the `Npm.Service` used by that config layer.

Prefer small reusable fake boundary layers in `test/fake/*`:

```ts
AuthTest.empty
AccountTest.empty
NpmTest.noop
SkillTest.empty
ProviderTest.fake().layer
```

Do not add generic test-layer builders until repeated local compositions prove the need. Shared fake boundary services are the first reusable unit. Pre-composed subtrees such as `AgentTest.withPlugins` should come later, only after the same graph appears in multiple files.

## Fixture Rules

Use Effect-aware fixtures from `test/fixture/fixture.ts`:

- `TestInstance` inside `it.instance(...)` for the current temp instance path
- `tmpdirScoped(...)` inside `Effect.gen` for additional temp directories
- `provideInstance(dir)(effect)` when one test needs to switch instance context
- `provideTmpdirInstance((dir) => effect, options)` when a live test needs custom instance setup or multiple instance scopes
- `disposeAllInstances()` in `afterEach` only for integration tests that intentionally touch shared instance registries

Prefer finalizers for local global mutations:

```ts
yield* Effect.acquireUseRelease(
  Effect.sync(() => {
    const previous = process.env.MY_FLAG
    process.env.MY_FLAG = "1"
    return previous
  }),
  () => testBody,
  (previous) =>
    Effect.sync(() => {
      if (previous === undefined) delete process.env.MY_FLAG
      else process.env.MY_FLAG = previous
    }),
)
```

## Conversion Recipe

1. Identify the real service under test and its open `*.layer`.
2. Build one top-level `layer` with real dependencies where they are relevant and `test/fake/*` layers at slow or external boundaries.
3. Replace local Promise wrappers with Effect helpers:

```ts
const run = Effect.fn("MyTest.run")(function* (input: Input) {
  const service = yield* MyService.Service
  return yield* service.run(input)
})
```

4. Convert `test(..., async () => { ... })` to `it.effect`, `it.instance`, or `it.live`.
5. Move `await` calls inside `Effect.gen` as `yield*` calls.
6. Replace `await using tmp = await tmpdir(...)` with `yield* tmpdirScoped(...)` when the temp directory is inside an Effect test.
7. Replace `WithInstance.provide({ directory, fn })` with `it.instance(...)`, `provideInstance(directory)(effect)`, or `provideTmpdirInstance(...)`.
8. Replace Promise failure assertions with Effect assertions:

```ts
const exit = yield* run(input).pipe(Effect.exit)
expect(Exit.isFailure(exit)).toBe(true)
```

9. Keep concurrency concurrent by using `Effect.forkScoped`, `Fiber.join`, `Deferred`, or `Effect.all(..., { concurrency: "unbounded" })` instead of serializing formerly parallel Promise work.
10. Run the focused test file and `bun typecheck` from `packages/opencode`.

## Good Examples

Use these files as models:

- `test/tool/write.test.ts`: strong `it.instance` tests, top-level `testEffect(...)`, and Effect-native test helpers.
- `test/effect/instance-state.test.ts`: good `it.live` use for scoped directories, instance switching, reload/disposal, and concurrency.
- `test/bus/bus-effect.test.ts`: good `Deferred`, streams, and scoped fibers.
- `test/tool/truncation.test.ts`: good configured runners and concise live service tests.
- `test/tool/repo_clone.test.ts`: good live git integration while staying inside Effect fixtures.
- `test/server/httpapi-instance.test.ts`: good scoped integration layer setup and live HTTP assertions.
- `test/account/service.test.ts`: good service-level live tests, `Effect.flip`, typed errors, and fake HTTP clients.
- `test/agent/plugin-agent-regression.test.ts`: good example of open real service layers plus reusable fake boundary layers.

## Current Promise-Land Hotspots

Start with files that already exercise Effect services but still manually run Promises:

- `test/config/config.test.ts`: many `Effect.runPromise`, `tmpdir()`, and `WithInstance.provide(...)` patterns despite already having `const it = testEffect(layer)`.
- `test/tool/shell.test.ts`: custom `ManagedRuntime`, Promise test helpers, and instance setup around shell execution.
- `test/tool/edit.test.ts`: manual runtime helpers and Promise concurrency patterns that should become fibers/deferreds.
- `test/session/messages-pagination.test.ts`: local Promise service facade over `Session.defaultLayer`.
- `test/snapshot/snapshot.test.ts`: Promise helper with `provideInstance` around snapshot operations.
- `test/file/index.test.ts`: Promise wrappers for `File.Service` plus repeated temp instance setup.
- `test/provider/provider.test.ts`: `AppRuntime.runPromise` helpers and mutable env/config setup.
- `test/project/vcs.test.ts`: Promise event waiting and `AppRuntime.runPromise` around VCS service calls.

## Migration Order

1. Convert one small file with straightforward service calls and no race behavior.
2. Convert `config.test.ts` incrementally by cluster, not in one PR.
3. Extract additional `test/fake/*` boundary layers only when a second test needs the same fake.
4. Convert files with concurrency or watchers after the simple files, preserving timing semantics with `Deferred` and fibers.
5. Leave pure non-Effect utility tests alone unless converting the underlying code to Effect.
