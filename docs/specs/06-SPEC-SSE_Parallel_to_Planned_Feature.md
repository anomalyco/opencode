# Spec: Jules Agentic Run via OpenCode SSE

## 0) Context and constraints

### OpenCode’s real-time backbone

* OpenCode’s server exposes an SSE endpoint at **`GET /event`**. It writes an initial `server.connected` event, then streams **every bus event** via `Bus.subscribeAll`, and sends a `server.heartbeat` every 10 seconds. ([GitHub][1])
* There is also a **global-level SSE** stream referenced as **`/global/event`** in docs and user reports. ([OpenCode][2])

### Known pain points (we must not worsen)

* `/event` currently broadcasts all events to all subscribers; filtering is typically done client-side, and there’s an active proposal to add `sessionID` filtering to reduce waste. ([GitHub][3])
* Bandwidth can already be extreme because lots of tiny deltas become lots of SSE events; OpenCode also currently serializes large objects into events. ([GitHub][4])

### “Truth-first” UX requirement

We explicitly avoid the pattern where systems “report success” while nothing happened (false positives). 
We treat “invisible failure” as the core sin. 

---

## 1) Goal

In the OpenCode IDE session view, render a **Jules Run panel** that feels lg pipeline,” but is backed by **truth events** (ps) delivered over OpenCode’s SSE stream.

**User experience:**

* Timeline updates like a stream (truth events).
* Plan becomes a To-Do list.
* Dead air is filled with **UI keepalive** (clearly labeled “Status (UI)”) that never claims unverified actions.

---

## 2) Architecture overview

### Two-loop design (same as you described), but wired to OpenCode SSE

**Truth loop (server-side watcher, emits SSE events)**

* A lightweight “watcher” polls Jules and **publishes OpenCode bus events**.
* Those bus events flow to clients via `/event` and/or `/global/event`. ([GitHub][1])

**Perception loop (client-only keepalive)**

* The IDE rotates safe “thinking” lines locally.
* This loop never creates “truth events.”

This is the clean split: truth = events; vibes = local UI.

---

## 3) Endpoints (OpenCode server)

This assumes you already have **Phase 1** proxy routes (stateless) per DECISION_120 (“Jules holds state; client drives lifecycle”). 
The watcher layer below is a **Phase 2** addition (still no DB; ephemeral only).

### 3.1 Jules proxy (Phase 1 — minimal)

* `POST /jules/sessions` → create Jules session
* `GET /jules/sessions/:id`
* `GET /jules/sessions/:id/activities`
* `POST /jules/sessions/:id/app:contentReference[oaicite:12]{index=12}:id/reject`
* `POST /jules/sessions/:id/cancel`

(These are exactly what your panel stub expects.)

### 3.2 Jules watcher control (Phase 2 — ephemeral server-side state)

* `POST /jules/watch`

  * body: `{ openCodeSessionID, julesSessionID, directory?, workspace? }`
  * returns: `{ watchID }`
* `DELETE /jules/watch/:watchID` (stop polling + stop publishing events)
* `GET /jules/watch/:watchID` (optional: returns watcher status/metrics)

**No persistence:** watchers live in memory only. If server restarts, watchers vanish; UI can re-attach by calling `POST /jules/watch` again. This respects the “no persistent state” red line while still enabling the SSE-native UX. 

---

## 4) Event model (what goes over SSE)

OpenCode’s SSE payloads are JSON objects with at least `{ type, properties }`, as seen in `server.connected` / `server.heartbeat`. ([GitHub][1])

### 4.1 Event naming

All Jules events are prefixed: `jules.*`

s
Every Jules event **must** include:

```json
{
  "type": "jules.run.status",
  "properties": {
    "openCodeSessionID": "ses_...",
    "julesSessionID": "sessions/...",
    "watchID": "watch_...",
    "directory": "/path/..." 
  }
}
```

Why: OpenCode currently streams **all events to all subscribers**, and filtering often happens client-side. ([GitHub][3])
Even if OpenCode adds `sessionID` filtering later, you still want the property for debugging and for any multiplexing.

### 4.3 Event taxonomy

#### Lifecycle / snapshot

* `jules.run.created`

  * `{ openCodeSessionID, julesSessionID, repoUrl, task, requirePlanApproval?, startedAt }`
* `jules.run.status`

  * `{ status, error?, pollCount, at }`
* `jules.run.plan`

  * `{ plan: { summary, steps[] }, revision, at }`
* `jules.run.terminal`

  * `{ status: COMPLETED|FAILED|CANCELLED, endedAt, reason? }`

#### Streaming-ish increments (truth stream)

* `jules.run.activity`

  * `{ activity: { id, type, status, data }, at }`
* `jules.run.artifact`

  * `{ artifact: { id, type, title, url?, patch? }, at }`

#### Hardening / drift signals (don’t hide)

* `jules.run.warning`

  * schema drift, unexpected status, throttling, etc.
* `jules.run.error`

  * watcher failures that prevent reliable updates

This is the “stop lying” layer: if something is weird, it becomes visible. 

---

## 5) Watcher behavior (server)

### 5.1 Poll cadence

Use your established values (and hard caps):

* `initialDelay: 2s`
* `planningInterval: 5s`
* `executionInterval: 10s`
* `maxDuration: 1h`
* `maxPolls: 360` 

### 5.2 Diffing / dedupe rules (critical)

Watcher must maintain per-watch ephemeral state:

* last known `status`
* last plan hash
* a set of emitted `activity.id`
* a set  publishes events **only on changes**.

### 5.3 Failure modes (fail visible)

If Jules polling errors or responses don’t validate:

* emit `jules.run.warning` / `jules.run.error` with raw payload attached (or a safe exccontinue as if OK”

This matches the “only sin is hidden failure” standard. 

---

## 6) Client (IDE) responsibilities

### 6.1 SSE subscription strategy

Today, `/event` streams everything to everyone. ([GitHub][1])
Client should:

* keep **one** SSE connection per OpenCode server
* route events in a local store by `openCodeSessionID`

If OpenCode adds `GET /event?sessionID=...` (proposed), use it to reduce bandwidth. ([GitHub][3])

### 6.2 Store model

Maintain `RunSto:contentReference[oaicite:24]{index=24}sionID]`:

* status
* plan
* activities (deduped)
* artifacts (deduped)
* timestamps for lastTruthAt, pollCount, etc.

### 6.3 UI rendering rules

* Timeline = truth stream only (status/activity/artifact events).
* Keepalive = **explicitly labeled UI-only**.
* Never mark To-Do “done_confirmed” without evidence (artifact/activity). The “perfect metrics but nothing happened” failure is exactly what we avoid. 

---

## 7) Performance & bandwidth guardrails

Because SSE can be extremely chatty already ([GitHub][4]), Jules events must be designed to be cheap:

* **No token-level deltas** from Jules. Only lifecycle/activities/artifacts.
* **Batch activities** per poll: either emit multiple `jules.run.activity` events or emit `jules.run.activity.batch` with an array (preferred if you’re already worried about bandwidth).
* Plan updates are rare → treat them as coarse-grained.

And longer-term:

* Add sessionID filtering to `/event` (open issue). ([GitHub][3])
  de server supports HTTP basic auth via `OPENCODE_SERVER_PASSWORD` (applies to server/web). ([OpenCode][2])
* Jules API key handling options:

  * **Phase 1:** stored client-side only (entered in panel, sent via headers to proxy).
  * Later: use OpenCode’s auth credential endpoints for secure storage (server already has auth routes). ([GitHub][1])

---

## 9) Phasing (so this actually lands)

### Phase 1 (merge-friendly)

* Stateless Jules proxy + types + tests (DECISION_120 “Option D”). 
* IDE panel uses **client polling** (your current Solid skeleton already supports this).

### Phase 2 (spec you’re asking for)

* Add watcher routes + publish `jules.*` bus events → flows over SSE.
* IDE panel flips from “poll Jules” → “listen to SSE and render.”

This aligns with the “KV-backed tracking later” concept without actually needing KV: watchers can be ephemeral and still deliver the SSE-native UX. 

---

## 10) Acceptance criteria

1. Start a Jules run from an OpenCode session → panel shows `Queued/Planning` within one poll cycle.
2. When plan arrives → `jules.run.plan` event → To-Do appears.
3. Approval gate:

   * `AWAITING_PLAN_APPROVAL` renders approve/reject controls.
4. Execution updates:

   * `jules.run.activity` events append to timeline, dedfacts appear and are reviewable.
5. No invented progress:

   * keepalive never claims “wrote files / opened PR” unless an artifact event exists. 


[1]: https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/opencode/src/server/server.ts "raw.githubusercontent.com"
[2]: https://opencode.ai/docs/server/ "Server | OpenCode"
[3]: https://github.com/anomalyco/opencode/issues/9650 "[FEATURE]:Support `sessionID` Filter for SSE Event Subscription · Issue #9650 · anomalyco/opencode · GitHub"
[4]: https://github.com/anomalyco/opencode/issues/14114 "[Performance] Web UI consumes excessive bandwidth via SSE streaming (~25MB/min) · Issue #14114 · anomalyco/opencode · GitHub"
