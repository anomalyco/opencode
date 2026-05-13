# Effect Test Migration

Move tests that exercise Effect services out of Promise-land and into the
shared `testEffect` pattern.

This file is guidance, not a live inventory. Before claiming a migration,
search current `dev` for the exact anti-pattern and update any PR notes
with what you actually changed.

## Target Pattern

Every Effect service test should have one local runner near the top:

```ts
const it = testEffect(layer)
```

Use the runner method that matches the behavior:

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
    expect(test.directory).toContain("opencode-test-")
  }),
)

it.live("live filesystem or process behavior", () =>
  Effect.gen(function* () {
    const dir = yield* tmpdirScoped()
    // real clock / fs / git / process work
  }),
)
```

## Choosing The Runner

- `it.effect(...)` — pure Effect behavior with `TestClock` and
  `TestConsole`.
- `it.instance(...)` — service behavior that needs one scoped opencode
  instance.
- `it.live(...)` — real time, filesystem mtimes, child processes, git,
  locks, servers, watchers, or OS behavior.

Most integration-style tests use `it.live(...)` or `it.instance(...)`.

## Layer Rules

Compose tests from open service layers when a dependency needs replacing.
Do not use a closed `defaultLayer` and then try to override an inner
dependency after it has already been provided.

Prefer small reusable fake boundary layers in `test/fake/*`:

```ts
AuthTest.empty
AccountTest.empty
NpmTest.noop
SkillTest.empty
ProviderTest.fake().layer
```

Use `Layer.mock` for partial service stubs. Missing methods should fail
loudly if the test accidentally calls them.

Do not add generic test-layer builders until repeated local compositions
prove the need.

## Fixture Rules

Use Effect-aware fixtures from `test/fixture/fixture.ts`:

- `TestInstance` inside `it.instance(...)` for the current temp instance.
- `tmpdirScoped(...)` inside `Effect.gen` for extra temp directories.
- `provideInstance(dir)(effect)` when one test needs to switch instance
  context.
- `provideTmpdirInstance((dir) => effect, options)` when a live test needs
  custom instance setup or multiple instance scopes.
- `disposeAllInstances()` in `afterEach` only for integration tests that
  intentionally touch shared instance registries.

Avoid mutable global setup. If a global mutation is unavoidable during a
migration, scope it with acquire/release and treat it as temporary.

Long term, tests should not toggle `process.env`, `Global.Path`, or
mutable flags when behavior can be modeled with services. Prefer layers
such as `RuntimeFlags.layer(...)` or focused fake services.

## Anti-Patterns To Remove

- `test(..., async () => Effect.runPromise(...))`
- local `run(...)`, `load(...)`, `svc(...)`, or `runtime.runPromise(...)`
  wrappers that only provide a layer
- `tmpdir()` plus legacy instance provision in Promise test bodies
- custom `ManagedRuntime.make(...)` in test files
- Promise `try/catch` around Effect failures
- `Promise.withResolvers`, `Bun.sleep`, or `setTimeout` for synchronization
  when events, `Deferred`, fibers, or deterministic state checks fit
- mutable env/global/flag changes after layers are built

Promise helpers are acceptable at non-Effect boundaries, but yield them from
inside an Effect body with `Effect.promise(...)` rather than making them the
test harness.

## Conversion Recipe

1. Identify the real service under test and whether its open `layer` or
   closed `defaultLayer` is appropriate.
2. Build one top-level `layer` with real dependencies where relevant and
   fake layers at slow or external boundaries.
3. Replace local Promise wrappers with Effect helpers.
4. Convert `test(..., async () => { ... })` to `it.effect`, `it.instance`,
   or `it.live`.
5. Move `await` calls inside `Effect.gen` as `yield*` calls.
6. Replace `await using tmp = await tmpdir(...)` with
   `yield* tmpdirScoped(...)` when the temp directory lives inside the
   Effect test.
7. Replace Promise failure assertions with `Effect.exit`, `Effect.flip`, or
   focused assertion helpers.
8. Preserve concurrency with fibers, `Deferred`, and
   `Effect.all(..., { concurrency: "unbounded" })`; do not accidentally
   serialize formerly parallel behavior.
9. Run the focused test file and `bun typecheck` from `packages/opencode`.

## Good Examples

Use current examples as patterns, but re-check them before copying because
test migrations are active:

- `test/effect/instance-state.test.ts` — scoped directories, instance
  switching, disposal, and concurrency.
- `test/bus/bus-effect.test.ts` — `Deferred`, streams, scoped fibers.
- `test/agent/plugin-agent-regression.test.ts` — real service layers plus
  fake boundary layers.
- `test/account/service.test.ts` — service-level live tests, typed errors,
  fake HTTP clients.

## Migration Queue Policy

Do not maintain a long file checklist here. It goes stale quickly.

When looking for the next target, search for current anti-patterns:

```bash
git grep -n "Effect.runPromise\|ManagedRuntime\|Promise.withResolvers\|Bun.sleep\|WithInstance" -- packages/opencode/test
```

Then choose one file or one small cluster, keep the PR focused, and mention
the focused verification in the PR body.

## Rough Edges To Watch

- Failure assertions against `Exit` / `Cause` can get verbose. Add helpers
  only after the same shape repeats across multiple files.
- Some tests still need `Effect.promise(...)` around Node/Bun APIs. Prefer
  Effect platform services when the surrounding code already uses them, but
  do not block useful migrations on perfect abstraction.
- Layer composition can be noisy when a test needs real service subtrees plus
  fake boundaries. Extract small `test/fake/*` layers before inventing
  larger builders.
- Concurrency tests can get harder to read after replacing Promise
  resolvers. Look for repeated patterns that deserve named helpers.
