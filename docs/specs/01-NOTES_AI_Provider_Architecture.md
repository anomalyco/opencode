

IDE mapping spec: (a) feels like a normal “thinking pipeline,” (b) stays honest about what’s real vs. filler, and (c) matches the Jules contract you’ve already sketched (session + plan + activities + artifacts, with explicit approval). L14-L18

---

## 1) Canonical IDE data model

### Run model (provider-agnostic)

```ts
type RunPhase =
  | "queued"
  | "planning"
  | "awaiting_approval"
  | "executing"
  | "completed"
  | "failed"
  | "cancelled"

type Run = {
  runId: string               // Jules session id
  provider: "jules"
  repoUrl: string
  task: string

  phase: RunPhase
  lastTruthAt: number         // ms epoch: last poll that changed anything
  lastPollAt: number
  nextPollAt: number
  pollCount: number
  startedAt: number
  endedAt?: number

  plan?: {
    summary: string
    steps: Array<{
      text: string
      state: "pending" | "active" | "done_confirmed" | "done_estimated"
      evidence?: { eventId: string }
    }>
  }

  timeline: RunEvent[]        // append-only, deduped
  artifacts: Artifact[]       // extracted from final session state or activity-derived
}
```

### Event model (what the IDE “streams”)

```ts
type RunEvent = {
  eventId: string             // stable dedupe key
  at: number                  // ms epoch; if missing from API, use receipt time
  source: "status" | "activity" | "artifact" | "system"
  level: "info" | "warn" | "error"
  title: string
  detail?: string
  raw?: unknown               // raw activity/session blob (debug drawer)
}

type Artifact =
  | { id: string; type: "git_patch"; title: string; patch?: string; url?: string }
  | { id: string; type: "pull_request"; title: string; url?: string }
```

This maps directly to your Jules shapes: `JulesSessionResponse` includes `id`, `status`, optional `plan`, optional `activities`, optional `artifacts`. 1L236-L243

---

## 2) JulesStatus → IDE phase + UI labels

Jules lifecycle you’re targeting is explicit: `QUEUED → PLANNING → AWAITING_PLAN_APPROVAL → IN_PROGRESS → COMPLETED`. 
And your type union includes `FAILED` and `CANCELLED`. 

| JulesStatus              | RunPhase            | Primary UI copy                | Actions                                              |
| ------------------------ | ------------------- | ------------------------------ | ---------------------------------------------------- |
| `QUEUED`                 | `queued`            | “Queued”                       | Cancel                                               |
| `PLANNING`               | `planning`          | “Planning…”                    | Cancel                                               |
| `AWAITING_PLAN_APPROVAL` | `awaiting_approval` | “Plan ready — approval needed” | Approve / Reject w/ feedback                         |
| `IN_PROGRESS`            | `executing`         | “Executing…”                   | Cancel (and optional “Send guidance” *only if safe*) |
| `COMPLETED`              | `completed`         | “Completed”                    | View patch/PR                                        |
| `FAILED`                 | `failed`            | “Failed”                       | Retry (new run)                                      |
| `CANCELLED`              | `cancelled`         | “Cancelled”                    | —                                                    |

**Status-to-event rule:** create a timeline event only on **transition**, not every poll (prevents spam).

---

## 3) Polling algorithm (Truth loop)

Use the poll parameters already recommended in the decision doc. 

### Suggested truth loop schedule

* After `POST /jules/sessions`: wait `initialDelay = 2000ms` 
* While `QUEUED` or `PLANNING`: poll every `planningInterval = 5000ms` 
* While `IN_PROGRESS`: poll every `executionInterval = 10000ms` 
* Enforce `maxDuration = 1h` and `maxPolls = 360`. 

### What to call per poll

1. `GET /jules/sessions/:id` (status + plan + artifacts) — your flow explicitly relies on this. 
2. Optional but recommended: `GET /jules/sessions/:id/activities` and dedupe by `activity.id` (since `JulesActivityResponse` is `id/type/status/data`). 

### Drift-safe + rate-limit-safe

* Respect `Retry-After` and back off (explicit mitigation in your risk table). 
* Keep “truth loop” purely observational: **don’t** call `sendMessage` as a background keepalive. It’s explicitly called out as a dark corner during `IN_PROGRESS`. 

---

## 4) Plan → To-Do list mapping

Jules plan is `summary` + `steps: string[]`. 

### To-Do creation

* When a poll returns a new `plan`, create (or replace) the to-do list:

  * `plan.summary` as header
  * each `plan.steps[i]` as a task line

### To-Do state rules

* Default all steps → `pending`
* Mark one step as `active` when:

  * phase is `executing`, and
  * you can infer “current step” from newest activity payload; otherwise pick the first `pending`.

### “Done” rules (don’t lie)

* `done_confirmed` only when you have evidence (an activity indicates completion, or an artifact that matches a step).
* `done_estimated` is allowed for smoothing, but **must be visually distinct** (e.g., dotted check + tooltip “estimated”).

If you have no activity semantics, keep it conservative: only `active` moves, no `done_confirmed`.

---

## 5) Activities → Timeline event normalization + dedupe

Your generic activity shape is intentionally loose: `{ id, type, status, data }`. 

### Dedupe keys

* `activity.eventId = "act:" + activity.id`
* `status.eventId = "st:" + prevStatus + "→" + nextStatus + "@" + transitionIndex`
* `artifact.eventId = "art:" + artifact.id`

### Event titles (best-effort, truth-first)

For an activity:

* `title = data.title ?? data.message ?? type`
* `detail = data.detail ?? data.summary ?? JSON.stringify(safeSubset(data))`
* If nothing human-readable exists: `title = type + " (" + status + ")"`

Always keep a “raw” drawer for the full `data` blob (super useful when Jules changes its schema mid-alpha).

---

## 6) The “Thinking pipeline” (Perception loop) — without hallucinating

This is where your cycling “thinking sentences” live. The trick is: **separate “UI keepalive” from “agent output.”**

### Perception loop (UI heartbeat)

* Tick every ~250–600ms (purely local)
* Drives:

  * spinner / typing dots
  * progress shimmer on the active step
  * rotating keepalive lines
  * countdown to next poll (`nextPollAt - now`)

### Truthy copy rule set (hard constraints)

1. **Never claim an action happened** unless it came from:

   * a status transition event, or
   * an activity event, or
   * a delivered artifact.
2. Keepalive text may only reference:

   * the user’s task text,
   * repo identity,
   * current phase,
   * the plan summary/step text (if present),
   * polling mechanics (“next check in 7s”, “last update 18s ago”).
3. If you use “I’m doing X” language, it must be phrased as **intention / waiting**, not completion:

   * ✅ “Waiting for Jules to return the next update…”
   * ✅ “Working through the plan step: {step}”
   * ❌ “Updated files”, “Applied patch”, “Opened PR” (until artifact exists).
4. Make keepalive visually labeled (subtle) as “Status” / “Keepalive” so it’s not confused with real activity.

### Where to get the keepalive lines

* **Do not fetch them from Jules by default**, because `sendMessage during IN_PROGRESS` is already flagged as a risk area. 
* If you really want model-authored keepalive, generate them **once** at run start (or at `PLANNING`) using *your own* local/Zen model, and then cache client-side for the run.

---

## 7) Suggested keepalive template sets (drop-in)

These are *template families*; the IDE fills `{repo}`, `{task}`, `{phase}`, `{step}`, `{nextPollSec}`, `{elapsed}`.

**Queued / Planning**

* “Queued in Jules. Next check in {nextPollSec}s.”
* “Building a plan for: {task}.”
* “Repo: {repo}. Waiting for plan…”

**Awaiting approval**

* “Plan ready. Review and approve to continue.”
* “Nothing will run until you approve the plan.”

**Executing**

* “Executing plan step: {step}.”
* “Last update {sinceTruth}s ago. Next check in {nextPollSec}s.”
* “Standing by for new activity from Jules…”

**Completed**

* “Artifacts received. Review patch/PR.”

---

## 8) Minimal integration contract the IDE needs

From your interface signatures, the IDE only needs:

* `createSession(repoUrl, task, branch?, apiKey)` 
* `getSession(sessionId, apiKey)` 
* `listActivities(sessionId, apiKey)` 
* `approvePlan(sessionId, apiKey)` and `rejectPlan(sessionId, feedback, apiKey)` 
* Optional `cancelSession(sessionId, apiKey)` 

Everything else (streaming illusion, to-do rendering, keepalive cycling) is purely IDE-side.
