# Tasks: harden-local-provider-runtime

- [x] 1. Fit fetch timeout (`packages/opencode/src/provider/provider.ts` +
       test): `fetchLocalModelFit` takes an `AbortSignal` param and passes it
       to `client.getFitReport({ signal })` (signal passthrough verified in
       the generated client). In `discoverOpenAICompatibleModels`, move the
       `AbortController` creation above the `fitPromise` creation and share
       it with both fetches. Test in `packages/opencode/test/provider/`
       (pattern: existing discovery tests ~provider.test.ts:1802): fake
       server answers `/v1/models` but never `/api/fit` → discovery resolves
       well under 5s with models and default context.
       Validation: `cd packages/opencode && bun test test/provider -t "fit"`

- [x] 2a. Config write lock helper (new
       `packages/opencode/src/local/config-lock.ts`, ~30 lines + new
       `packages/opencode/test/local/config-lock.test.ts`):
       `withGlobalConfigLock(effect)` over `Semaphore.makeUnsafe(1)` /
       `withPermits(1)` (pattern: `src/snapshot/index.ts:63-69`). Test: two
       read-modify-write mutations run with `Effect.all` concurrency 2; both
       survive.
       Validation: `cd packages/opencode && bun test test/local -t "config lock"`

- [x] 2b. Wire the lock at the three call sites: `syncLocalProviders`
       (`src/local/sync.ts:81-166`), `connect` (`.../handlers/local.ts:229-250`),
       `disconnect` (`.../handlers/local.ts:252-261`) — each wraps its
       getGlobal→mutate→updateGlobal in `withGlobalConfigLock`, re-reading
       inside the lock.
       Validation: `cd packages/opencode && bun run typecheck && bun test test/local`

- [x] 3. Sidebar stale-sample fix
       (`packages/tui/src/feature-plugins/sidebar/context.tsx`): `cancelled`
       flag set in `onCleanup` checked before `setMem`; `AbortController`
       aborted in `onCleanup`, signal passed to `getHardware({ signal })`
       (TUI's gen client also forwards signal).
       Validation: `cd packages/tui && bun run typecheck`

- [x] 4. Repo validation: `bun run typecheck` in `packages/opencode` and
       `packages/tui`; `cd packages/opencode && bun test test/provider test/local`.
