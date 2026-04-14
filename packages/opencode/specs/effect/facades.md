# Facade removal checklist

Concrete inventory of the remaining `makeRuntime(...)`-backed service facades in `packages/opencode`.

As of 2026-04-13, latest `origin/dev`:

- `src/` still has 15 `makeRuntime(...)` call sites.
- 13 of those are still in scope for facade removal.
- 2 are excluded from this checklist: `bus/index.ts` and `effect/cross-spawn-spawner.ts`.

Recent progress:

- Wave 1 is merged: `Pty`, `Skill`, `Vcs`, `ToolRegistry`, `Auth`.
- Wave 2 is merged: `Config`, `Provider`, `File`, `LSP`, `MCP`.

## Priority hotspots

- `server/instance/session.ts` still depends on `Session`, `SessionPrompt`, `SessionRevert`, `SessionCompaction`, `SessionSummary`, `ShareSession`, `Agent`, and `Permission` facades.
- `src/effect/app-runtime.ts` still references many facade namespaces directly, so it should stay in view during each deletion.

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

## Next batch

Recommended next five, in order:

1. `src/permission/index.ts`
2. `src/agent/agent.ts`
3. `src/session/summary.ts`
4. `src/session/revert.ts`
5. `src/mcp/auth.ts`

Why this batch:

- It keeps pushing the session-adjacent cleanup without jumping straight into `session/index.ts` or `session/prompt.ts`.
- `Permission`, `Agent`, `SessionSummary`, and `SessionRevert` all reduce fanout in `server/instance/session.ts`.
- `McpAuth` is small and closely related to the just-landed `MCP` cleanup.

After that batch, the expected follow-up is the main session cluster:

1. `src/session/index.ts`
2. `src/session/prompt.ts`
3. `src/session/compaction.ts`

## Checklist

- [ ] `src/session/index.ts` (`Session`) - facades: `create`, `fork`, `get`, `setTitle`, `setArchived`, `setPermission`, `setRevert`, `messages`, `children`, `remove`, `updateMessage`, `removeMessage`, `removePart`, `updatePart`; main callers: `server/instance/session.ts`, `cli/cmd/session.ts`, `cli/cmd/export.ts`, `cli/cmd/github.ts`; tests: `test/server/session-actions.test.ts`, `test/server/session-list.test.ts`, `test/server/global-session-list.test.ts`
- [ ] `src/session/prompt.ts` (`SessionPrompt`) - facades: `prompt`, `resolvePromptParts`, `cancel`, `loop`, `shell`, `command`; main callers: `server/instance/session.ts`, `cli/cmd/github.ts`; tests: `test/session/prompt.test.ts`, `test/session/prompt-effect.test.ts`, `test/session/structured-output-integration.test.ts`
- [ ] `src/session/revert.ts` (`SessionRevert`) - facades: `revert`, `unrevert`, `cleanup`; main callers: `server/instance/session.ts`; tests: `test/session/revert-compact.test.ts`
- [ ] `src/session/compaction.ts` (`SessionCompaction`) - facades: `isOverflow`, `prune`, `create`; main callers: `server/instance/session.ts`; tests: `test/session/compaction.test.ts`
- [ ] `src/session/summary.ts` (`SessionSummary`) - facades: `summarize`, `diff`; main callers: `session/prompt.ts`, `session/processor.ts`, `server/instance/session.ts`; tests: `test/session/snapshot-tool-race.test.ts`
- [ ] `src/share/session.ts` (`ShareSession`) - facades: `create`, `share`, `unshare`; main callers: `server/instance/session.ts`, `cli/cmd/github.ts`
- [ ] `src/agent/agent.ts` (`Agent`) - facades: `get`, `list`, `defaultAgent`, `generate`; main callers: `cli/cmd/agent.ts`, `server/instance/session.ts`, `server/instance/experimental.ts`; tests: `test/agent/agent.test.ts`
- [ ] `src/permission/index.ts` (`Permission`) - facades: `ask`, `reply`, `list`; main callers: `server/instance/permission.ts`, `server/instance/session.ts`, `session/llm.ts`; tests: `test/permission/next.test.ts`
- [x] `src/file/index.ts` (`File`) - facades removed and merged.
- [x] `src/lsp/index.ts` (`LSP`) - facades removed and merged.
- [x] `src/mcp/index.ts` (`MCP`) - facades removed and merged.
- [x] `src/config/config.ts` (`Config`) - facades removed and merged.
- [x] `src/provider/provider.ts` (`Provider`) - facades removed and merged.
- [x] `src/pty/index.ts` (`Pty`) - facades removed and merged.
- [x] `src/skill/index.ts` (`Skill`) - facades removed and merged.
- [x] `src/project/vcs.ts` (`Vcs`) - facades removed and merged.
- [x] `src/tool/registry.ts` (`ToolRegistry`) - facades removed and merged.
- [ ] `src/worktree/index.ts` (`Worktree`) - facades: `makeWorktreeInfo`, `createFromInfo`, `create`, `remove`, `reset`; main callers: `control-plane/adaptors/worktree.ts`, `server/instance/experimental.ts`; tests: `test/project/worktree.test.ts`, `test/project/worktree-remove.test.ts`
- [x] `src/auth/index.ts` (`Auth`) - facades removed and merged.
- [ ] `src/mcp/auth.ts` (`McpAuth`) - facades: `get`, `getForUrl`, `all`, `set`, `remove`, `updateTokens`, `updateClientInfo`, `updateCodeVerifier`, `updateOAuthState`; main callers: `mcp/oauth-provider.ts`, `cli/cmd/mcp.ts`; tests: `test/mcp/oauth-auto-connect.test.ts`
- [ ] `src/plugin/index.ts` (`Plugin`) - facades: `trigger`, `list`, `init`; main callers: `agent/agent.ts`, `session/llm.ts`, `project/bootstrap.ts`; tests: `test/plugin/trigger.test.ts`, `test/provider/provider.test.ts`
- [ ] `src/project/project.ts` (`Project`) - facades: `fromDirectory`, `discover`, `initGit`, `update`, `sandboxes`, `addSandbox`, `removeSandbox`; main callers: `project/instance.ts`, `server/instance/project.ts`, `server/instance/experimental.ts`; tests: `test/project/project.test.ts`, `test/project/migrate-global.test.ts`
- [ ] `src/snapshot/index.ts` (`Snapshot`) - facades: `init`, `track`, `patch`, `restore`, `revert`, `diff`, `diffFull`; main callers: `project/bootstrap.ts`, `cli/cmd/debug/snapshot.ts`; tests: `test/snapshot/snapshot.test.ts`, `test/session/revert-compact.test.ts`

## Excluded `makeRuntime(...)` sites

- `src/bus/index.ts` - core bus plumbing, not a normal facade-removal target.
- `src/effect/cross-spawn-spawner.ts` - runtime helper for `ChildProcessSpawner`, not a service namespace facade.
