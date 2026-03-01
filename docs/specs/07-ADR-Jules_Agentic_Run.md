
**“DECISION_121 — Jules Agentic Run via OpenCode SSE”**

It’s aligned with the constraints from DECISION_120 (Phase 1 stateless proxy, Phase 2 layering, “invisible failure is the only sin”). 
It also grounds itself in OpenCode’s real SSE realities: `/event` bus forwarding ([GitHub][1]), the requested session filter ([GitHub][2]), bandwidth concerns ([GitHub][3]), and reconnect gaps ([GitHub][4]).

---

## GitHub issue draft (the “requested feature” pre-flight)

Your Oracle conditions explicitly want “open GitHub issue first” before PR work. 
Here’s a ready-to-post issue body for **anomalyco/opencode** that matches the spec and cross-links the existing SSE filter/perf work:

```md
Title: feat(app,server): Jules Agentic Run panel + jules.* SSE events (ephemeral watcher)
:contentReference[oaicite:8]{index=8}es “Agentic Run” UX in the IDE (plan/to-do + timeline + artifacts) backed by OpenCode’s SSE event stream. Phase 1 is a stateless Jules proxy; Phase 2 adds an in-memory watcher that polls Jules and publishes normalized `jules.*` bus events to `/event`.

## Motivation
Jules is session/polling-based (not token streaming). Polling from each client works, but it doesn’t synchronize across devices/instances and duplicates network load. OpenCode already has a bus→SSE pipeline; reusing it gives a native, streaming-like UX without faking token deltas.

## Proposal (Phased)
### Phase 1 (PR-friendly)
- Add stateless proxy routes:
  - POST /jules/sessions
  - GET /jules/sessions/:id
  - GET /jules/sessions/:id/activities
  - POST /jules/sessions/:id/approve
  - POST /jules/sessions/:id/reject
  - POST /jules/sessions/:id/cancel
- Add types + schema validation + tests
- (Optional) IDE panel behind flag using client polling

### Phase 2 (SSE-native)
- Add in-memory watcher:
  - POST /jules/watch { openCodeSessionID, julesSessionID, directory? } → { watchID }
  - DELETE /jules/watch/:watchID
- Watcher polls Jules on bounded cadence and publishes bus events:
  - jules.run.created/status/plan/terminal
  - jules.run.activity/artifact
  - jules.run.warning/error (schema drift, rate limits, etc.)
- IDE subscribes to /event once and routes by openCodeSessionID

## UX rules (truth-first)
- Timeline is truth stream only (status/activity/artifact).
- Dead-air filler is UI-only keepalive (explicitly labeled) and must not claim actions unless proven by artifact/activity events.
- On SSE reconnect (server.connected), client rehydrates state by fetching current session snapshot (avoid “stuck after reconnect”).

## Related work / dependencies
- /event filtering: #9650 (sessionID query param)
- SSE bandwidth/perf: #14114 (broadcast volume, payload size)
- Reconnect gaps: #13947 and #10721 (no SSE id + resync needs)

## Acceptance criteria
- Start run → status appears within one poll cycle.
- Plan arrives → to-do list populates.
- Awaiting approval → approve/reject UI appears.
- Execution → activities append, deduped.
- Completion → artifacts visible.
- Reconnect → client resyncs on server.connected and continues.
```

[1]: https://github.com/anomalyco/opencode/issues/11616?utm_source=chatgpt.com "Documentation: Web Interface Client Interaction Architecture"
[2]: https://github.com/anomalyco/opencode/issues/9650?utm_source=chatgpt.com "Support `sessionID` Filter for SSE Event Subscription ..."
[3]: https://github.com/anomalyco/opencode/issues/14114?utm_source=chatgpt.com "[Performance] Web UI consumes excessive bandwidth via ..."
[4]: https://github.com/anomalyco/opencode/issues/13947?utm_source=chatgpt.com "Web UI freezes after SSE reconnect — missed events not ..."
