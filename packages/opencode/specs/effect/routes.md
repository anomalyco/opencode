# Route handler effectification

Practical reference for converting server route handlers in `packages/opencode` to a single `AppRuntime.runPromise(Effect.gen(...))` body.

## Goal

Route handlers should wrap their entire body in a single `AppRuntime.runPromise(Effect.gen(...))` call, yielding services from context rather than calling facades one-by-one.

This eliminates multiple `runPromise` round-trips and lets handlers compose naturally.

```ts
// Before - one facade call per service
;async (c) => {
  await SessionRunState.assertNotBusy(id)
  await Session.removeMessage({ sessionID: id, messageID })
  return c.json(true)
}

// After - one Effect.gen, yield services from context
;async (c) => {
  await AppRuntime.runPromise(
    Effect.gen(function* () {
      const state = yield* SessionRunState.Service
      const session = yield* Session.Service
      yield* state.assertNotBusy(id)
      yield* session.removeMessage({ sessionID: id, messageID })
    }),
  )
  return c.json(true)
}
```

## Rules

- Wrap the whole handler body in one `AppRuntime.runPromise(Effect.gen(...))` call when the handler is service-heavy.
- Yield services from context instead of calling async facades repeatedly.
- When independent service calls can run in parallel, use `Effect.all(..., { concurrency: "unbounded" })`.
- Prefer one composed Effect body over multiple separate `runPromise(...)` calls in the same handler.

## Current route files

Current instance route files live under `src/server/routes/instance`.

Files that are already mostly on the intended service-yielding shape:

- [x] `server/routes/instance/question.ts` — handlers yield `Question.Service`
- [x] `server/routes/instance/provider.ts` — handlers yield `Provider.Service`, `ProviderAuth.Service`, and `Config.Service`
- [x] `server/routes/instance/permission.ts` — handlers yield `Permission.Service`
- [x] `server/routes/instance/mcp.ts` — handlers mostly yield `MCP.Service`
- [x] `server/routes/instance/pty.ts` — handlers yield `Pty.Service`

Files still worth tracking here:

- [ ] `server/routes/instance/session.ts` — still the heaviest mixed file; many handlers are composed, but the file still mixes patterns and has direct `Bus.publish(...)` / `Session.list(...)` usage
- [ ] `server/routes/instance/index.ts` — mostly converted, but still has direct `Instance.dispose()` / `Instance.*` reads for `/instance/dispose` and `/path`
- [ ] `server/routes/instance/file.ts` — most handlers yield services, but `/find` still passes `Instance.directory` directly into ripgrep and `/find/symbol` is still stubbed
- [ ] `server/routes/instance/experimental.ts` — mixed state; many handlers are composed, but some still rely on `runRequest(...)` or direct `Instance.project` reads
- [ ] `server/routes/instance/middleware.ts` — still enters the instance via `Instance.provide(...)`
- [ ] `server/routes/global.ts` — still uses `Instance.disposeAll()` and remains partly outside the fully-composed style

## Notes

- Route conversion is now less about facade removal and more about removing the remaining direct `Instance.*` reads, `Instance.provide(...)` boundaries, and small Promise-style bridges inside route files.
- `jsonRequest(...)` / `runRequest(...)` already provide a good intermediate shape for many handlers. The remaining cleanup is mostly consistency work in the heavier files.
