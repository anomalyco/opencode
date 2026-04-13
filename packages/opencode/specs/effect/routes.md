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

Current instance route files live under `src/server/instance`, not `server/routes`.

The main migration targets are:

- [ ] `server/instance/session.ts` — heaviest; still has many direct facade calls for Session, SessionPrompt, SessionRevert, SessionCompaction, SessionShare, SessionSummary, Agent, Bus
- [ ] `server/instance/global.ts` — still has direct facade calls for Config and instance lifecycle actions
- [ ] `server/instance/provider.ts` — still has direct facade calls for Config and Provider
- [ ] `server/instance/question.ts` — partially converted; still worth tracking here until it consistently uses the composed style
- [ ] `server/instance/pty.ts` — still calls Pty facades directly
- [ ] `server/instance/experimental.ts` — mixed state; some handlers are already composed, others still use facades

Additional route files that still participate in the migration:

- [ ] `server/instance/index.ts` — Vcs, Agent, Skill, LSP, Format
- [ ] `server/instance/file.ts` — Ripgrep, File, LSP
- [ ] `server/instance/mcp.ts` — MCP facade-heavy
- [ ] `server/instance/permission.ts` — Permission
- [ ] `server/instance/workspace.ts` — Workspace
- [ ] `server/instance/tui.ts` — Bus and Session
- [ ] `server/instance/middleware.ts` — Session and Workspace lookups

## Notes

- Some handlers already use `AppRuntime.runPromise(Effect.gen(...))` in isolated places. Keep pushing those files toward one consistent style.
- Route conversion is closely tied to facade removal. As services lose `makeRuntime`-backed async exports, route handlers should switch to yielding the service directly.
