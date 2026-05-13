# AI Tool Performance Architecture Research

## Goal

Study the architecture of `pingdotgg/t3code`, with emphasis on performance-sensitive design, then map the useful lessons onto `opencode` and turn them into a concrete execution plan.

## Research Summary

- `t3code` gets the biggest win from server-authoritative orchestration rather than isolated UI micro-optimizations.
- High-frequency provider runtime events are normalized and buffered before they reach the UI.
- Web and desktop share a common server-centered model, which reduces duplicate synchronization work.
- `opencode` already has strong client-side protections in the app and TUI, especially batching, throttling, virtualization, and streaming markdown fallbacks.
- The main opportunity is to move more event coalescing and finalize logic earlier in the pipeline so the clients do less repeated work.

## Findings From t3code

### Architecture

- `apps/server` acts as the orchestration center and read-model producer.
- `apps/web` consumes stable state over WebSocket instead of interpreting raw provider runtime directly.
- `apps/desktop` is mostly a shell around a local server child process.
- `packages/contracts` provides typed boundaries across app, server, and desktop.

### Performance Patterns Worth Reusing

- Queue high-frequency runtime events before turning them into UI state.
- Coalesce or finalize assistant text instead of forwarding every small delta.
- Keep transport stateful: reconnect, replay, and late-subscriber recovery.
- Split state domains to avoid unrelated rerenders.
- Offload heavy rendering paths like diff work to workers.

## Current opencode Assessment

### Existing Strengths

- `packages/app/src/context/global-sdk.tsx` already batches SSE events by frame, coalesces selected event types, drops stale deltas, and reconnects with heartbeat protection.
- `packages/opencode/src/cli/cmd/tui/context/sdk.tsx` batches event delivery for the TUI.
- `packages/ui/src/components/message-part.tsx` throttles streaming text before markdown rerender.
- `packages/ui/src/components/markdown.tsx` uses fast parse during streaming, delayed full highlight upgrade, HTML caching, and incremental DOM patching.
- `packages/app/src/pages/session/message-timeline.tsx` uses staged mounting and virtualization for large timelines.

### Main Gaps

- `packages/app/src/context/global-sync/event-reducer.ts` still applies `message.part.delta` updates one by one at the store layer.
- TUI batching is simpler than app batching and does not yet mirror app-side coalescing behavior.
- Timeline virtualization is disabled while a session is actively working, which may leave the heaviest live sessions on the most expensive rendering path.
- App and TUI still absorb some fine-grained event costs that could be reduced earlier on the server side.

## Working Hypothesis

The next meaningful performance gains in `opencode` will come less from additional markdown or DOM micro-optimizations and more from reducing event granularity before events hit client stores.

## Desktop Startup Gating Addendum

### Relationship To The Main Hypothesis

- This overlaps with the main hypothesis at the principle level: both favor presenting clients with a more stable boundary instead of exposing partially ready state too early.
- This does not materially overlap at the implementation level: the main research is about streaming event ingestion and state synchronization, while this addendum is about desktop startup gating and first-interaction readiness.

### Startup Principle Confirmed

- Desktop startup is intentionally designed around "do not reveal the real app until the first mouse or keyboard input should respond immediately."
- The native loading window covers the pre-webview gap.
- The hidden main window plus HTML startup shell covers the gap between window creation and interactive app readiness.
- `startup-ready` and `startup-interactive` are explicit readiness boundaries, not incidental events.

### Required Waits

- Initial SQLite migration is required before the real app becomes interactive.
- Session-route startup checks that guarantee a real directory or complete child state are required before declaring the page interactive.
- The startup shell itself is required because it decouples window visibility from app interactivity.

### Conditionally Required Waits

- A blocking health gate is reasonable when no earlier layer has already guaranteed backend readiness.
- For remote or non-local connections, a blocking health gate may still be appropriate.

### Non-Required Or Redundant Waits

- In desktop, waiting for sidecar health before showing the main window appears stricter than necessary. The startup shell can absorb that wait while preserving the first-interaction guarantee.
- In desktop, `ConnectionGate` performs a second blocking health gate after native startup already waited for sidecar readiness. This looks redundant for the local sidecar path.
- The fixed minimum duration in the startup health check is a smoothing tactic, not an interaction-correctness requirement.
- Home-page warm prefetch currently delays `startup-interactive`, but prefetch is an optimization and should not block first interaction.
- Locale and similar display-correctness waits should not be treated as interaction-critical gates.

### Current Assessment

- The strongest version of the startup principle is "show the startup shell early, hide it late."
- The current implementation still contains waits that happen before the shell can fully take over, which makes startup more conservative than the stated product goal.
- The next startup-focused work should separate:
  1. waits required for first-input correctness,
  2. waits only required for visual polish,
  3. waits that are duplicate confirmations of readiness.

## Proposed Plan

### Phase 1: Measure

1. Add lightweight instrumentation around event intake and flush behavior.
2. Record event counts, flush sizes, reducer hot paths, and markdown render frequency.
3. Compare app and TUI behavior under the same streaming session.

### Phase 2: Reduce Client-Side Event Cost

1. Add batch application for repeated `message.part.delta` updates in the app reducer path.
2. Bring app-style key-based coalescing to the TUI event intake path.
3. Verify that reducer churn and rerender frequency drop without hurting responsiveness.

### Phase 3: Revisit Timeline Strategy

1. Re-evaluate the rule that disables virtualization while a session is working.
2. Consider keeping the active tail fully live while virtualizing older content.
3. Validate scroll stability and message anchor behavior.

### Phase 4: Move Coalescing Upstream

1. Evaluate adding provider/server ingestion buffering for high-frequency message part updates.
2. Prefer emitting more complete updates over many tiny deltas when possible.
3. Share the same stable semantics across app and TUI clients.

## Initial Implementation Targets

- `packages/app/src/context/global-sdk.tsx`
- `packages/app/src/context/global-sync/event-reducer.ts`
- `packages/opencode/src/cli/cmd/tui/context/sdk.tsx`
- `packages/app/src/pages/session/message-timeline.tsx`
- `packages/app/src/pages/session/message-timeline-utils.ts`
- `packages/opencode/src/server/routes/event.ts`
- provider ingestion path to be identified before implementation

## Non-Goals

- Rewriting the whole sync architecture in one pass
- Prematurely replacing markdown rendering primitives
- Changing product behavior before measuring the hot paths

## Success Criteria

- Lower event churn at the client store boundary during streaming sessions
- Fewer unnecessary rerenders in app and TUI
- No regression in streaming responsiveness
- A clearer boundary between raw provider events and client-facing read-model updates
