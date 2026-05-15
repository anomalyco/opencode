# Effect TODO

Short roadmap for Effect cleanup in `packages/opencode`.

Current patterns and examples live in [`guide.md`](./guide.md). Error
boundary migration details live in
[`error-boundaries-plan.md`](./error-boundaries-plan.md). Test migration rules live in
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

- Some expected service failures still use `NamedError.create(...)` or
  collapse to `Effect.die(...)`. The storage/worktree/provider-auth
  conversions are done; an inventory sweep is needed for the rest.
- HTTP error middleware still guesses status codes from error names —
  some entries (e.g. storage `NotFound`, provider auth) can now be
  removed, but the middleware overall has not shrunk.
- Route handlers and route groups do not consistently declare the public
  error body they intend to expose.
- Repeated route error translations do not yet have a clear home: some
  should stay inline, some deserve tiny shared mapper helpers.

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

### Recently completed

- [x] `RENDER-1` CLI tagged config error rendering (#27256, tests #27257).
- [x] `ERR-1` [`storage/storage.ts`](../../src/storage/storage.ts) typed
      `NotFoundError` (#27265) and removal of the server defect fallback
      (#27287).
- [x] `ERR-2` [`worktree/index.ts`](../../src/worktree/index.ts) typed
      errors (#27296).
- [x] `ERR-3` [`provider/auth.ts`](../../src/provider/auth.ts) typed
      validation/oauth errors (#27301).
- [x] `HTTP-1` Unknown-500 details no longer leaked (#27251); follow-up
      to stop exposing named defects (#27471).
- [x] Session message reads typed and made effectful (#27269, #27275,
      #27280, #27291).
- [x] Session HTTP error contracts tightened (#27308); busy-session
      mapping centralized (#27375, #27473).
- [x] Provider init (#27484) and LSP init (#27494) errors typed.

### First PR Candidates

- [ ] `HTTP-2` Audit one route group for explicit error contracts and
      decide which mappings stay inline vs. shared helper.
- [ ] `ERR-4` Sweep remaining `NamedError.create(...)` and
      `Effect.die(...)` callsites for expected failures — re-run `git
grep` to build a current inventory.
- [ ] `RENDER-2` Audit CLI and TUI surfaces for any remaining opaque
      `Error: Name` rendering of typed errors.

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
- [x] `RF-1` Scout reads routed through runtime flags (#27318).
- [x] `RF-2` Plan-mode prompt read routed through runtime flags (#27320).
- [x] `RF-3` Event-system reads routed through runtime flags (#27323).
- [x] `RF-4` Workspaces reads routed through runtime flags for session
      (#27335), sync (#27336), and control-plane (#27337).
- [x] LLM client (#27368) and installation client (#27369) routed
      through runtime flags.
- [x] TUI plugin runtime flags simplified (#27506).
- [x] Background-subagents flag moved to RuntimeFlags, then removed
      (`refactor(task): use runtime flag for background subagents`,
      `refactor(flags): remove background subagents flag`).

Remaining cleanup:

- [ ] Sweep lingering `Flag.*` reads — many CLI/TUI/config/observability
      callsites still import [`flag.ts`](../../../core/src/flag/flag.ts).
      Decide per-callsite whether to route through RuntimeFlags, accept
      as legitimate env/config boundary, or migrate to typed `Config`.
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

Important distinction:

- `InstanceState.context`, `InstanceState.directory`, and
  `InstanceState.workspaceID` are acceptable inside normal Effect service
  code when `InstanceRef` / `WorkspaceRef` are provided by the runtime.
- The deletion blockers are the fallback and callback paths that rely on
  ambient ALS: direct `Instance.*` reads, `InstanceState.bind(...)`,
  `AppRuntime.runPromise(...)` re-entry from plain JS, and bridge restore
  code that installs legacy ALS before invoking callbacks.

Current bottom-up inventory from `dev`:

- Direct `Instance.*` value readers:
  [`tool/repo_overview.ts`](../../src/tool/repo_overview.ts),
  [`control-plane/adapters/worktree.ts`](../../src/control-plane/adapters/worktree.ts),
  [`cli/bootstrap.ts`](../../src/cli/bootstrap.ts).
- `InstanceState.bind(...)` callback boundaries:
  [`file/watcher.ts`](../../src/file/watcher.ts) native watcher callback,
  [`storage/db.ts`](../../src/storage/db.ts) transaction/effect callbacks,
  [`session/llm.ts`](../../src/session/llm.ts) workflow approval callback.
- `AppRuntime.runPromise(...)` / re-entry from plain JS:
  [`project/with-instance.ts`](../../src/project/with-instance.ts),
  [`project/instance-runtime.ts`](../../src/project/instance-runtime.ts),
  [`control-plane/adapters/worktree.ts`](../../src/control-plane/adapters/worktree.ts),
  [`cli/effect-cmd.ts`](../../src/cli/effect-cmd.ts), plus global/non-instance
  callsites such as CLI upgrade and ACP agent defaults.
- Intentional bridge users to classify, not delete blindly:
  workspace adapters in [`control-plane/workspace.ts`](../../src/control-plane/workspace.ts),
  MCP, command execution, plugins, pty lifecycle, bus scope cleanup, task
  cancellation, and HTTP lifecycle reload/dispose paths.
- Core fallback layer to shrink last:
  [`effect/run-service.ts`](../../src/effect/run-service.ts),
  [`effect/bridge.ts`](../../src/effect/bridge.ts), and
  [`effect/instance-state.ts`](../../src/effect/instance-state.ts).

Recommended PR order:

- [ ] `INST-1` Remove direct `Instance.*` value readers. Start with
      `repo_overview`, `worktree` adapter, and `cli/bootstrap`; pass context
      explicitly or obtain it from an Effect boundary.
- [ ] `INST-2` Move type-only `InstanceContext` imports from
      [`project/instance.ts`](../../src/project/instance.ts) to
      [`project/instance-context.ts`](../../src/project/instance-context.ts).
- [ ] `INST-3` Audit each `InstanceState.bind(...)` callback from the inside
      out: list what the callback calls (`Bus.publish`, database effects,
      permission/session services), then replace ambient capture with explicit
      `InstanceRef` / `WorkspaceRef` provision or an `EffectBridge` call.
- [ ] `INST-4` Classify `AppRuntime.runPromise(...)` callsites as global,
      instance-scoped with explicit refs, or bridge-required. Eliminate the
      instance-scoped callsites that rely on `run-service.attach()` falling
      back to `Instance.current`.
- [ ] `INST-5` After consumers are explicit, remove `Instance.current` fallback
      from `InstanceState.context` and `run-service.attach()`.
- [ ] `INST-6` Move any remaining `restore` / `bind` compatibility helpers to
      the boundary that still needs them, then delete
      [`project/instance.ts`](../../src/project/instance.ts).

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
