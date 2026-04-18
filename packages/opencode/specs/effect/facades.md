# Facade removal checklist

Concrete inventory of the remaining `makeRuntime(...)`-backed facades in `packages/opencode`.

Current status on this branch:

- `src/` has 5 `makeRuntime(...)` call sites total.
- 2 are intentionally excluded from this checklist: `src/bus/index.ts` and `src/effect/cross-spawn-spawner.ts`.
- 1 is tracked primarily by the instance-context migration rather than facade removal: `src/project/instance.ts`.
- That leaves 2 live runtime-backed service facades still worth tracking here: `src/npm/index.ts` and `src/cli/cmd/tui/config/tui.ts`.

Recent progress:

- Wave 1 is merged: `Pty`, `Skill`, `Vcs`, `ToolRegistry`, `Auth`.
- Wave 2 is merged: `Config`, `Provider`, `File`, `LSP`, `MCP`.

## Priority hotspots

- `src/cli/cmd/tui/config/tui.ts` still exports `makeRuntime(...)` plus async facade helpers for `get()` and `waitForDependencies()`.
- `src/npm/index.ts` still exports `makeRuntime(...)` plus async facade helpers for `install()`, `add()`, `outdated()`, and `which()`.
- `src/project/instance.ts` still uses a dedicated runtime for project boot, but that file is really part of the broader legacy instance-context transition tracked in `instance-context.md`.

## Completed Batches

Low-risk batch, all merged:

1. `src/pty/index.ts`
2. `src/skill/index.ts`
3. `src/project/vcs.ts`
4. `src/tool/registry.ts`
5. `src/auth/index.ts`

Caller-heavy batch, all merged:

1. `src/config/config.ts`
2. `src/provider/provider.ts`
3. `src/file/index.ts`
4. `src/lsp/index.ts`
5. `src/mcp/index.ts`

Shared pattern:

- one service file still exports `makeRuntime(...)` + async facades
- one or two route or CLI entrypoints call those facades directly
- tests call the facade directly and need to switch to `yield* svc.method(...)`
- once callers are gone, delete `makeRuntime(...)`, remove async facade exports, and drop the `makeRuntime` import

## Done means

For each service in the low-risk batch, the work is complete only when all of these are true:

1. all production callers stop using `Namespace.method(...)` facade calls
2. all direct test callers stop using the facade and instead yield the service from context
3. the service file no longer has `makeRuntime(...)`
4. the service file no longer exports runtime-backed facade helpers
5. `grep` for the migrated facade methods only finds the service implementation itself or unrelated names

## Caller templates

### Route handlers

Use one `AppRuntime.runPromise(Effect.gen(...))` body and yield the service inside it.

```ts
const value = await AppRuntime.runPromise(
  Effect.gen(function* () {
    const pty = yield* Pty.Service
    return yield* pty.list()
  }),
)
```

If two service calls are independent, keep them in the same effect body and use `Effect.all(...)`.

### Plain async CLI or script entrypoints

If the caller is not itself an Effect service yet, still prefer one contiguous `AppRuntime.runPromise(Effect.gen(...))` block for the whole unit of work.

```ts
const skills = await AppRuntime.runPromise(
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const skill = yield* Skill.Service
    yield* auth.set(key, info)
    return yield* skill.all()
  }),
)
```

Only fall back to `AppRuntime.runPromise(Service.use(...))` for truly isolated one-off calls or awkward callback boundaries. Do not stack multiple tiny `runPromise(...)` calls in the same contiguous workflow.

This is the right intermediate state. Do not block facade removal on effectifying the whole CLI file.

### Bootstrap or fire-and-forget startup code

If the old facade call existed only to kick off initialization, call the service through the existing runtime for that file.

```ts
void BootstrapRuntime.runPromise(Vcs.Service.use((svc) => svc.init()))
```

Do not reintroduce a dedicated runtime in the service just for bootstrap.

### Tests

Convert facade tests to full effect style.

```ts
it.effect("does the thing", () =>
  Effect.gen(function* () {
    const svc = yield* Pty.Service
    const info = yield* svc.create({ command: "cat", title: "a" })
    yield* svc.remove(info.id)
  }).pipe(Effect.provide(Pty.defaultLayer)),
)
```

If the repo test already uses `testEffect(...)`, prefer `testEffect(Service.defaultLayer)` and `yield* Service.Service` inside the test body.

Do not route tests through `AppRuntime` unless the test is explicitly exercising the app runtime. For facade removal, tests should usually provide the specific service layer they need.

If the test uses `provideTmpdirInstance(...)`, remember that fixture needs a live `ChildProcessSpawner` layer. For services whose `defaultLayer` does not already provide that infra, prefer the repo-standard cross-spawn layer:

```ts
const infra = CrossSpawnSpawner.defaultLayer

const it = testEffect(Layer.mergeAll(MyService.defaultLayer, infra))
```

Without that extra layer, tests fail at runtime with `Service not found: effect/process/ChildProcessSpawner`.

## Questions already answered

### Do we need to effectify the whole caller first?

No.

- route files: compose the handler with `AppRuntime.runPromise(Effect.gen(...))`
- CLI and scripts: use `AppRuntime.runPromise(Service.use(...))`
- bootstrap: use the existing bootstrap runtime

Facade removal does not require a bigger refactor than that.

### Should tests keep calling the namespace from async test bodies?

No. Convert them now.

The end state is `yield* svc.method(...)`, not `await Namespace.method(...)` inside `async` tests.

### Should we keep `runPromise` exported for convenience?

No. For this batch the goal is to delete the service-local runtime entirely.

### What if a route has websocket callbacks or nested async handlers?

Keep the route shape, but replace each facade call with `AppRuntime.runPromise(Service.use(...))` or wrap the surrounding async section in one `Effect.gen(...)` when practical. Do not keep the service facade just because the route has callback-shaped code.

### Should we use one `runPromise` per service call?

No.

Default to one contiguous `AppRuntime.runPromise(Effect.gen(...))` block per handler, command, or workflow. Yield every service you need inside that block.

Multiple tiny `runPromise(...)` calls are only acceptable when the caller structure forces it, such as websocket lifecycle callbacks, external callback APIs, or genuinely unrelated one-off operations.

### Should we wrap a single service expression in `Effect.gen(...)`?

Usually no.

Prefer the direct form when there is only one expression:

```ts
await AppRuntime.runPromise(File.Service.use((svc) => svc.read(path)))
```

Use `Effect.gen(...)` when the workflow actually needs multiple yielded values or branching.

## Learnings

These were the recurring mistakes and useful corrections from the first two batches:

1. Tests should usually provide the specific service layer, not `AppRuntime`.
2. If a test uses `provideTmpdirInstance(...)` and needs child processes, prefer `CrossSpawnSpawner.defaultLayer`.
3. Instance-scoped services may need both the service layer and the right instance fixture. `File` tests, for example, needed `provideInstance(...)` plus `File.defaultLayer`.
4. Do not wrap a single `Service.use(...)` call in `Effect.gen(...)` just to return it. Use the direct form.
5. For CLI readability, extract file-local preload helpers when the handler starts doing config load + service load + batched effect fanout inline.
6. When rebasing a facade branch after nearby merges, prefer the already-cleaned service/test version over older inline facade-era code.

## Remaining work

Most of the original facade-removal backlog is already done. The practical remaining work is narrower now:

1. remove the `Npm` runtime-backed facade from `src/npm/index.ts`
2. remove the `TuiConfig` runtime-backed facade from `src/cli/cmd/tui/config/tui.ts`
3. keep `src/project/instance.ts` in the separate instance-context migration, not this checklist

## Checklist

- [ ] `src/npm/index.ts` (`Npm`) - still exports runtime-backed async facade helpers on top of `Npm.Service`
- [ ] `src/cli/cmd/tui/config/tui.ts` (`TuiConfig`) - still exports runtime-backed async facade helpers on top of `TuiConfig.Service`
- [x] `src/session/session.ts` / `src/session/prompt.ts` / `src/session/revert.ts` / `src/session/summary.ts` - service-local facades removed
- [x] `src/agent/agent.ts` (`Agent`) - service-local facades removed
- [x] `src/permission/index.ts` (`Permission`) - service-local facades removed
- [x] `src/worktree/index.ts` (`Worktree`) - service-local facades removed
- [x] `src/plugin/index.ts` (`Plugin`) - service-local facades removed
- [x] `src/snapshot/index.ts` (`Snapshot`) - service-local facades removed
- [x] `src/file/index.ts` (`File`) - facades removed and merged
- [x] `src/lsp/index.ts` (`LSP`) - facades removed and merged
- [x] `src/mcp/index.ts` (`MCP`) - facades removed and merged
- [x] `src/config/config.ts` (`Config`) - facades removed and merged
- [x] `src/provider/provider.ts` (`Provider`) - facades removed and merged
- [x] `src/pty/index.ts` (`Pty`) - facades removed and merged
- [x] `src/skill/index.ts` (`Skill`) - facades removed and merged
- [x] `src/project/vcs.ts` (`Vcs`) - facades removed and merged
- [x] `src/tool/registry.ts` (`ToolRegistry`) - facades removed and merged
- [x] `src/auth/index.ts` (`Auth`) - facades removed and merged

## Excluded `makeRuntime(...)` sites

- `src/bus/index.ts` - core bus plumbing, not a normal facade-removal target.
- `src/effect/cross-spawn-spawner.ts` - runtime helper for `ChildProcessSpawner`, not a service namespace facade.
