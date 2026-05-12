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

Current instance route files live under `src/server/routes/instance/httpapi`.
Most handlers already yield stable services at route-layer construction and then
close over those services in endpoint implementations.

Files still worth tracking here:

- [ ] `handlers/session.ts` — still the heaviest mixed file; some paths keep compatibility translations and direct event publication
- [ ] `handlers/experimental.ts` — mixed state; some handlers still rely on request-local context reads
- [ ] `middleware/*` — still contains compatibility policy for auth, compression, errors, instance context, and workspace routing
- [ ] `public.ts` — still owns SDK/OpenAPI compatibility translation shims
- [ ] raw route modules — WebSocket and catch-all routes should stay explicit and avoid rebuilding stable layers per request

## Notes

- Route conversion is now less about backend migration and more about removing the remaining direct `Instance.*` reads, request-local service plumbing, and OpenAPI compatibility shims.
- Prefer route-layer service capture over rebuilding or providing stable layers inside individual handlers.
