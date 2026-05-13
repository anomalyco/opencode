# Effect TODO

Short roadmap for Effect cleanup in `packages/opencode`.

Current patterns and examples live in [`guide.md`](./guide.md). Test
migration rules live in
[`test/EFFECT_TEST_MIGRATION.md`](../../test/EFFECT_TEST_MIGRATION.md).
Older deep-dive notes in this directory may still be useful, but treat
this roadmap and the guide as the current entry points.

This is a planning map, not a verified inventory. Before starting a task,
re-run a targeted `git grep` from current `dev` and update this file if
the inventory changed.

## Priorities

```text
P0  ERR + RENDER + HTTP
    Make expected failures typed, render them well, and stop relying on
    generic HTTP error guesswork.

P1  TEST
    Convert touched tests to the ideal Effect test patterns from the guide.

P2  RF
    Move mutable runtime flags into typed runtime/config services.

P3  GLOBAL
    Make global paths explicit and remove import-time side effects.

P4  INST + BRIDGE
    Remove ambient Instance coupling while keeping Promise/callback interop.

P5  PROC + FS
    Replace raw process/filesystem edges with typed Effect services.

P6  OA
    Shrink OpenAPI compatibility shims as source schemas improve.
```

## Work Paths

- `ERR` Typed errors — replace legacy `NamedError.create(...)` and
  `Effect.die(...)` for expected service failures with
  `Schema.TaggedErrorClass` errors on the Effect error channel.
  Shrinks: [`NamedError`](../../../core/src/util/error.ts) usage.
- `RENDER` User-visible error rendering — preserve structured typed-error
  details at CLI, HTTP, and tool boundaries.
  Shrinks: opaque `Error: Name` rendering.
- `HTTP` HTTP route cleanup — make route errors explicit instead of
  relying on generic middleware to guess status/body from error names.
  Shrinks: [`middleware/error.ts`](../../src/server/routes/instance/httpapi/middleware/error.ts)
  and route-level compatibility shims.
- `TEST` Effect test migration — use `testEffect`, `it.live`, and
  `it.instance` with explicit layers.
  Shrinks: Promise-style tests, sleeps, mutable global test flags.
- `RF` RuntimeFlags / Flag deletion — move mutable
  [`Flag`](../../../core/src/flag/flag.ts) reads into typed runtime/config
  services.
  Shrinks: [`flag.ts`](../../../core/src/flag/flag.ts),
  [`test/fixture/flag.ts`](../../test/fixture/flag.ts).
- `GLOBAL` Global paths / import side effects — make global path state
  explicit and testable instead of mutable module state.
  Shrinks: [`global.ts`](../../../core/src/global.ts) import-time side
  effects, mutable `Global.Path` overrides, and its `Flag` dependency.
- `INST` Instance shim — remove ambient `Instance` usage and old ALS
  access patterns.
  Shrinks: [`src/project/instance.ts`](../../src/project/instance.ts).
- `BRIDGE` Promise/callback interop — keep bridge helpers, but reduce
  legacy ALS coupling.
  Shrinks: [`src/effect/bridge.ts`](../../src/effect/bridge.ts)
  dependency on [`project/instance.ts`](../../src/project/instance.ts).
- `PROC` AppProcess migration — prefer `AppProcess.Service` over raw
  process wrappers.
  Shrinks: direct spawn callsites and legacy process helpers.
- `FS` AppFileSystem migration — prefer `AppFileSystem.Service` over raw
  filesystem APIs.
  Shrinks: direct `fs` / `Bun.file` service callsites where inappropriate.
- `RT` Runtime/facade cleanup — remove service-local `makeRuntime`
  facades when not intentional.
  Shrinks: async facade exports around services and
  [`run-service.ts`](../../src/effect/run-service.ts) usage.
- `OA` OpenAPI compatibility — tighten source schemas instead of
  post-processing generated OpenAPI.
  Shrinks: schema workaround blocks in
  [`public.ts`](../../src/server/routes/instance/httpapi/public.ts).

## P0: Errors, Rendering, And HTTP

This should be the next big cleanup theme. The codebase is moving toward
typed Effect failures, but the user-facing boundaries still leak old
shapes and sometimes collapse rich errors into opaque strings.

### Problems

- Some expected service failures still use `NamedError.create(...)`.
- Some expected service failures still become `Effect.die(...)`, which
  makes them defects instead of typed, recoverable failures.
- CLI and HTTP boundaries can render structured errors as generic
  `Error: SomeName` output.
- HTTP error middleware still guesses status codes from error names like
  `Worktree*` or `ProviderAuthValidationFailed`.
- Route handlers and route groups do not consistently declare the public
  error body they intend to expose.
- Repeated route error translations do not yet have a clear home: some
  should stay inline, some deserve tiny shared mapper helpers.
- Unknown 500s should log full detail server-side while returning a safe
  public body.

### Target Shape

- Services define expected failures with `Schema.TaggedErrorClass`.
- Services export an `Error` union and include it in method return types.
- Expected failures stay on the Effect error channel.
- `Effect.die(...)` is reserved for defects: bugs, impossible states,
  violated invariants, or final unknown-boundary fallbacks.
- Inside `Effect.gen` / `Effect.fn`, use `yield* new MyError(...)` for
  direct expected failures.
- Domain services do not import HTTP status codes, `HttpApiError`, or
  route-specific error schemas.
- HTTP route groups make their public error contracts obvious.
- Handlers map service errors to declared HTTP errors at the boundary.
- Shared mapper helpers are only for repeated translations, not a giant
  central registry of every domain error.
- Generic HTTP middleware should shrink; it should not accumulate more
  name-based domain knowledge.

### First PR Candidates

- [ ] `RENDER-1` Fix CLI top-level rendering for typed config errors.
- [ ] `ERR-1` Convert [`storage/storage.ts`](../../src/storage/storage.ts)
      not-found errors.
- [ ] `ERR-2` Convert [`worktree/index.ts`](../../src/worktree/index.ts)
      errors and remove matching HTTP name checks where possible.
- [ ] `ERR-3` Convert [`provider/auth.ts`](../../src/provider/auth.ts)
      validation errors.
- [ ] `HTTP-1` Remove the unknown-500 stack leak from
      [`middleware/error.ts`](../../src/server/routes/instance/httpapi/middleware/error.ts).
- [ ] `HTTP-2` Audit one route group for explicit error contracts and
      decide which mappings stay inline vs. shared helper.

## P1: Tests

When touching tests, migrate them toward the ideal patterns in
[`test/EFFECT_TEST_MIGRATION.md`](../../test/EFFECT_TEST_MIGRATION.md):

- Use `testEffect(...)` with explicit layers.
- Prefer `it.instance(...)` for service tests that need an instance.
- Prefer `it.live(...)` for real timers, filesystem mtimes, child
  processes, git, locks, or other live integration behavior.
- Avoid sleeps; wait on real events or deterministic state transitions.
- Do not mutate `process.env` or mutable globals after layers are built.
- Use explicit layer variants, such as `RuntimeFlags.layer(...)`, for
  behavior changes.

## P2: RuntimeFlags / Flag Deletion

Recently completed:

- [x] Plugin/pure-mode flags moved to RuntimeFlags.
- [x] Tool visibility flags moved to RuntimeFlags.
- [x] Built-in websearch provider selection uses the same runtime flags as
      tool visibility.
- [x] Removed global default-plugin disabling from test preload.

Recommended next PRs:

```text
RF-1 scout consumers ─┐
                      ├─ can run in parallel
RF-2 plan-mode prompt ┘
   └─ RF-3 event-system cluster, stacked only if RF-2 still touches prompt.ts

RF-4 workspaces cluster: later, after mutable Flag tests are cleaned up
```

- [ ] `RF-1` Move scout reads in [`agent.ts`](../../src/agent/agent.ts)
      and [`reference.ts`](../../src/reference/reference.ts).
- [ ] `RF-2` Move plan-mode prompt read in
      [`session/prompt.ts`](../../src/session/prompt.ts).
- [ ] `RF-3` Move event-system reads in session prompt/processor/
      compaction and TUI debug plugin.
- [ ] `RF-4` Move workspaces reads in session/sync/control-plane after
      tests stop relying on mutable `Flag` timing.
- [ ] Delete [`test/fixture/flag.ts`](../../test/fixture/flag.ts) once
      tests no longer mutate `Flag`.
- [ ] Delete [`flag.ts`](../../../core/src/flag/flag.ts) once no packages
      import it.

## P3: Global Paths

[`global.ts`](../../../core/src/global.ts) is real connective tissue, not
just cosmetic ugliness. It currently mixes path calculation, import-time
directory creation, `Flock` setup, mutable exported `Path` state, and a
`Flag` dependency.

Problems to reduce:

- Importing the module creates directories.
- Tests override `Global.Path` by mutating exported module state.
- Most callers use `Global.Path` directly instead of the Effect service.
- `Global.make()` still reads mutable `Flag.OPENCODE_CONFIG_DIR`.

Next PR candidates:

- [ ] Replace mutable `Global.Path` test overrides with explicit test
      layers or scoped helpers.
- [ ] Move directory creation and `Flock` setup behind an explicit init
      boundary where possible.
- [ ] Remove the `Flag` dependency from global path resolution.

## P4: Instance And Bridge

[`project/instance.ts`](../../src/project/instance.ts) is the deletion
target. [`effect/bridge.ts`](../../src/effect/bridge.ts) is not a near-term
deletion target; Promise/callback interop will continue to exist.

Goal:

- Keep a sanctioned bridge for Promise/callback boundaries.
- Reduce bridge dependence on legacy `Instance.restore` / `Instance.current`.
- Move callers toward `InstanceRef`, `WorkspaceRef`, `InstanceState`, or
  explicit context where practical.
- Delete `project/instance.ts` only after ambient Instance coupling is gone.

## Lower Priority Tracks

- `PROC` / `FS` — continue AppProcess and AppFileSystem migrations as
  focused PRs when touching relevant files.
- `RT` — remove service-local runtime facades only when they are not an
  intentional boundary.
- `OA` — shrink [`public.ts`](../../src/server/routes/instance/httpapi/public.ts)
  by tightening source schemas one workaround at a time.
- `fetch` → `HttpClient` — migrate raw fetch callsites when the caller is
  already effectful or being effectified.
- `Tools` — remaining tool cleanup is narrow: `webfetch` HTML extraction
  and `shell` raw stream/promise edges.
