# Community Issues Brief: SSE Infrastructure & Multi-Agent Gaps

**Date**: 2026-03-01
**Author**: OpenFixer (Designer role)
**Purpose**: Scrub of upstream issues relevant to Jules integration — synthesized for dev team
**Branch**: `chasing-jules`

---

## Executive Summary

Six open issues in `anomalyco/opencode` directly affect our Jules integration and the broader multi-agent future. They cluster into three themes:

1. **SSE plumbing is broken for multi-session use** (#9650, #14114, #6573)
2. **sessionID is missing from key extension points** (#6142, #9650)
3. **Community wants agent delegation / multi-agent** (#6627, #9649) — Jules is the first real answer

Our Phase 1 (client-driven polling) sidesteps all SSE issues. Phase 2 (SSE watcher) depends on at least #9650 being resolved. This brief maps each issue to our architecture and suggests concrete contributions.

---

## Issue-by-Issue Analysis

### #9650 — `sessionID` Filter for SSE Event Subscription

**Link**: https://github.com/anomalyco/opencode/issues/9650
**Status**: Open (enhancement)
**Severity for Jules**: 🔴 **Phase 2 blocker**

**Problem**: `GET /event` broadcasts ALL bus events to ALL subscribers via `Bus.subscribeAll()` in `server.ts:475`. Clients must filter by `sessionID` themselves. With 100 concurrent sessions and 10 backend nodes, bandwidth scales as O(sessions × nodes).

**Evidence from upstream code** (the author found it — they're right):
- `packages/opencode/src/tool/task.ts:111-112` — `if (evt.properties.part.sessionID !== session.id) return`
- `packages/opencode/src/cli/cmd/github.ts:840-841` — same pattern
- `packages/opencode/src/server/server.ts:475` — `Bus.subscribeAll(async (event) => { await stream.writeSSE(...) })`

**Proposed solution** (Option A — recommended by author):
```
GET /event?sessionID=ses_xxx
GET /event?directory=/path/to/project&sessionID=ses_xxx
```

Server-side filter before writing to SSE stream. Backward compatible — no `sessionID` param = existing broadcast behavior.

**Impact on our architecture**:
- Phase 1: No impact. We use client-driven polling, no SSE.
- Phase 2: Our watcher publishes `jules.*` bus events. Without server-side filtering, every SSE subscriber gets every Jules run's events. With filtering, clients subscribe to `/event?sessionID=ses_xxx` and only receive their run.
- Our event model already includes `openCodeSessionID` in every `jules.*` event (spec 06, section 4.2) — we're ready for this.

**What we can contribute**: The implementation is straightforward. The author provided working code. We could submit the PR as a precursor to Phase 2.

---

### #14114 — Web UI Consumes ~25MB/min via SSE Streaming

**Link**: https://github.com/anomalyco/opencode/issues/14114
**Status**: Open (performance)
**Severity for Jules**: 🟡 **Design constraint**

**Problem**: Every text/reasoning delta is a separate SSE event. With extended thinking (100k+ tokens), a single response generates tens of thousands of events. Full `part` objects are serialized on every update. No gzip compression on SSE stream. Combined: ~250MB in 10 minutes with Claude Opus.

**Root causes identified by author**:
1. `processor.ts` — each `text-delta` triggers `Session.updatePartDelta()` → bus event → SSE
2. `session/index.ts` — `Bus.publish(MessageV2.Event.PartUpdated, { part })` sends full part every time
3. `server.ts` — plain text SSE, no `Content-Encoding: gzip`
4. `Bus.subscribeAll` — no filtering (same as #9650)

**Impact on our architecture**:
- Jules events are **coarse-grained by design** — we emit lifecycle/activity/artifact events, not token deltas. A typical Jules run produces maybe 20-50 events total (status transitions, activities, artifacts), not thousands.
- Our spec already addresses this in section 7 ("Performance & bandwidth guardrails"): no token-level deltas, optional `jules.run.activity.batch`, plan updates treated as coarse-grained.
- **Our Jules integration will NOT worsen this problem.** In fact, it demonstrates the right pattern: event-per-meaningful-change, not event-per-token.

**What we can contribute**: Our event model is a good reference for how to design bandwidth-friendly SSE events. Could be cited in a PR that adds batching support.

---

### #6573 — Sessions Hang Indefinitely When Task Tool Spawns Subagents

**Link**: https://github.com/anomalyco/opencode/issues/6573
**Status**: Open (bug)
**Severity for Jules**: 🟠 **Architectural lesson**

**Problem**: When using `opencode serve` as a backend (e.g., Telegram bot), the Task tool spawns subagent sessions. Events for the subagent come through the **same** SSE subscription as the parent. The ACP agent (`acp/agent.ts:setupEventSubscriptions`) receives subagent events, tries to fetch messages using the parent's `directory` context, gets `NotFoundError`, and both sessions hang forever in "busy" state.

**Root cause** (author's analysis is solid):
1. `setupEventSubscriptions()` subscribes to ALL events via `sdk.event.subscribe({ directory })`
2. Subagent events arrive with `part.sessionID` pointing to the subagent
3. Message fetch fails: wrong `directory` context for the subagent session
4. `.catch()` returns `undefined` but doesn't clean up — session stays "busy" forever
5. Works in TUI because everything runs in-process with direct state access

**Why this matters for Jules**:
- Jules sessions are **external** (Google's infrastructure), not OpenCode subagents. We don't hit this specific bug.
- But the **pattern is the same**: when you mix events from multiple sessions on one SSE pipe and assume all events belong to one context, things break.
- This validates our decision to include `openCodeSessionID` + `julesSessionID` in every `jules.*` event.
- It also validates Phase 1 client-driven polling: we avoid the "mixed events on one pipe" problem entirely.

**What we can contribute**: The fix for #6573 is to filter events by `sessionID` in `setupEventSubscriptions` — same pattern as #9650. If #9650 lands, this bug likely becomes fixable by adding a session filter to the ACP event subscription.

---

### #6142 — Add `sessionID` to `experimental.chat.system.transform` Hook

**Link**: https://github.com/anomalyco/opencode/issues/6142
**Status**: Open (enhancement)
**Severity for Jules**: 🟢 **Informational**

**Problem**: The `experimental.chat.system.transform` plugin hook in `session/llm.ts:~65` passes an empty `{}` input object. Observability plugins (Langfuse, OpenTelemetry) can't correlate system prompts with sessions.

**Proposed fix** (trivial — one line):
```ts
// Before
await Plugin.trigger("experimental.chat.system.transform", {}, { system })
// After
await Plugin.trigger("experimental.chat.system.transform", { sessionID: input.sessionID }, { system })
```

**Impact on our architecture**: Not directly relevant — Jules doesn't use the plugin hook system. But it shows a broader pattern: **sessionID is missing from many places where it should be**. If we contribute to OpenCode, we should audit for this.

---

### #6627 — Delegate to Coding Agent

**Link**: https://github.com/anomalyco/opencode/issues/6627
**Status**: Open (feature request)
**Severity for Jules**: 🟢 **Community signal**

**Problem**: User wants IntelliJ-style "delegate to coding agent" from within OpenCode. Short feature request, but clear demand.

**Impact on our architecture**: **Jules IS the answer to this request.** Our Jules Agentic Run panel is exactly this: delegate a task to Jules (an external coding agent), monitor progress, review artifacts, approve/reject the plan. Phase 1 proxy routes enable this workflow. Phase 2 SSE makes it feel native.

**What we can contribute**: When Phase 1 ships, this issue can be referenced as "addressed by Jules integration."

---

### #9649 — Multi-Agent Coding

**Link**: https://github.com/anomalyco/opencode/issues/9649
**Status**: Open (feature request)
**Severity for Jules**: 🟢 **Community signal**

**Problem**: User describes switching between models constantly for different tasks (planning vs coding vs review). Wants a "Multi-Agent Collaboration mode" where agents talk to each other, handle different portions, and hand off work.

**Impact on our architecture**: Jules integration is a stepping stone toward this. Our architecture establishes:
- A pattern for integrating **external agents** (not just LLM providers) into OpenCode
- A normalized `Run` model that could generalize to other agent types
- SSE event taxonomy that could extend to `agent.*` events generically
- Truth-first UX principles that apply to any multi-agent workflow

**What we can contribute**: Our `Run` model and event taxonomy are designed to be provider-agnostic. A future PR could extract the generic parts into a shared `agent-run` module.

---

## Dependency Map

```
┌─────────────────────────────────────────────────────────┐
│                    Jules Integration                     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Phase 1 (client polling)          Phase 2 (SSE watcher)│
│  ├─ No SSE dependency              ├─ #9650 REQUIRED    │
│  ├─ No #6573 risk                  ├─ #14114 mitigated  │
│  ├─ jules.ts ✅ delivered           │   (coarse events)  │
│  └─ proxy routes (next)            ├─ #6573 avoided     │
│                                    │   (external agent)  │
│                                    └─ watcher routes     │
│                                                         │
│  Community demand                                       │
│  ├─ #6627 → Jules IS this feature                       │
│  └─ #9649 → Jules is step 1 of multi-agent              │
│                                                         │
│  Nice-to-have                                           │
│  ├─ #6142 → sessionID in plugin hooks                   │
│  └─ #2168 → API docs (helps SDK consumers)              │
└─────────────────────────────────────────────────────────┘
```

---

## Recommended Contributions (in priority order)

### 1. PR: `sessionID` filter for `/event` SSE endpoint (#9650)

**Effort**: Small (< 50 lines)
**Impact**: Unblocks Phase 2; fixes bandwidth waste; helps #6573
**Approach**: Option A from the issue — add `?sessionID=ses_xxx` query param to `server.ts` SSE handler. Filter events server-side before writing to stream. Backward compatible.

```ts
// packages/opencode/src/server/server.ts
.get("/event", async (c) => {
  const sessionID = c.req.query("sessionID")
  return streamSSE(c, async (stream) => {
    stream.writeSSE({ data: JSON.stringify({ type: "server.connected", properties: {} }) })
    const unsub = Bus.subscribeAll(async (event) => {
      if (sessionID) {
        const evtSession =
          event.properties?.part?.sessionID ||
          event.properties?.info?.sessionID ||
          event.properties?.sessionID
        if (evtSession && evtSession !== sessionID) return
      }
      await stream.writeSSE({ data: JSON.stringify(event) })
    })
    // ...
  })
})
```

### 2. PR: gzip compression on SSE endpoint (#14114)

**Effort**: Small
**Impact**: 70-80% bandwidth reduction for all SSE consumers
**Approach**: Add `Content-Encoding: gzip` to the SSE response. Hono supports this via middleware.

### 3. PR: sessionID in plugin hook (#6142)

**Effort**: Trivial (one line change + type update)
**Impact**: Enables observability plugins to correlate sessions

### 4. Documentation: API flow documentation (#2168)

**Effort**: Medium
**Impact**: Helps SDK consumers (Python, Node.js) understand session lifecycle

---

## Key Takeaway for Architecture Review

Our Phase 1 design (client-driven polling via stateless proxy) was the right call. It avoids:
- The SSE broadcast problem (#9650)
- The subagent event mixing bug (#6573)
- The bandwidth explosion (#14114)

Phase 2 should **not ship until #9650 is resolved** (either by upstream or by us contributing the fix). The good news: the fix is small and the community wants it.

---

## References

| Issue | Title | Theme | Jules Impact |
|-------|-------|-------|-------------|
| [#9650](https://github.com/anomalyco/opencode/issues/9650) | sessionID filter for SSE | SSE plumbing | Phase 2 blocker |
| [#14114](https://github.com/anomalyco/opencode/issues/14114) | SSE bandwidth ~25MB/min | SSE plumbing | Design constraint |
| [#6573](https://github.com/anomalyco/opencode/issues/6573) | Sessions hang with subagents | SSE plumbing | Architectural lesson |
| [#6142](https://github.com/anomalyco/opencode/issues/6142) | sessionID in plugin hook | sessionID gaps | Informational |
| [#6627](https://github.com/anomalyco/opencode/issues/6627) | Delegate to coding agent | Multi-agent demand | Jules IS this |
| [#9649](https://github.com/anomalyco/opencode/issues/9649) | Multi-agent coding | Multi-agent demand | Jules is step 1 |
| [#2168](https://github.com/anomalyco/opencode/issues/2168) | API documentation | Developer experience | Helps SDK users |
