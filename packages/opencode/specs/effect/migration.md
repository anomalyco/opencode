# Effect Migration Patterns

This is the compact reference for moving code toward the current Effect
shape. The high-level roadmap is [`todo.md`](./todo.md); examples and
rules are in [`guide.md`](./guide.md).

## Default Shape

- Service methods return `Effect`.
- Service methods are named with `Effect.fn("Domain.method")`.
- Expected failures are typed errors on the error channel.
- Dependencies are yielded once at layer construction and closed over by
  methods.
- `defaultLayer` wires production dependencies; tests can use open layers
  when replacing dependencies.

## Instance State

Use `InstanceState` for per-directory state, subscriptions, scoped
background work, and per-instance cleanup.

Do not add ad hoc `started` flags on top of `InstanceState`; the scoped
cache handles run-once and concurrent deduplication.

## Runtime Boundaries

Prefer `AppRuntime` for crossing from non-Effect code into the shared app
layer.

`makeRuntime(...)` exists for intentional service-local boundaries and
legacy facades. Do not add new service-local runtimes unless the service is
genuinely outside `AppLayer`.

## Platform Edges

- Use `AppFileSystem.Service` instead of raw filesystem APIs in
  effectified services.
- Use `AppProcess.Service` instead of raw process wrappers.
- Use `HttpClient.HttpClient` instead of raw `fetch` in Effect code.
- Use `Effect.cached` for shared in-flight work.
- Use `Effect.callback` for callback APIs.

## Tests During Migration

When migrating code, migrate touched tests toward
[`test/EFFECT_TEST_MIGRATION.md`](../../test/EFFECT_TEST_MIGRATION.md):

- `testEffect(...)`
- `it.effect`, `it.live`, or `it.instance`
- explicit layers for behavior changes
- deterministic waits instead of sleeps
- no mutable env/global flags after layers are built

## Migration Checklist

- [ ] The code has a single Effect body instead of Promise wrappers around
      service calls.
- [ ] Expected failures are typed errors, not thrown exceptions or defects.
- [ ] Layer requirements are explicit.
- [ ] Tests use Effect-aware fixtures and focused layers.
- [ ] Public behavior and wire shapes are preserved unless intentionally
      changed.
