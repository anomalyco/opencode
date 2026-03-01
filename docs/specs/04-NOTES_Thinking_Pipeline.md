
---

## 1) IDE UI layout checklist (Jules session “thinking pipeline”)

### A. Run header (sticky)

* **Status badge** from Jules lifecycle (`QUEUED → PLANNING → AWAITING_PLAN_APPROVAL → IN_PROGRESS → COMPLETED`) 
* **Elapsed time**, **last confirmed update** (from `lastTruthAt`), **poll count** (the “truth clock” visibility)
* **Next poll countdown** (from `nextPollAt - now`) using your poll config cadence 
* “Provider: Jules” + repo identity (short owner/repo)

### B. Main split view (2 columns)

**Left: Plan / To-Do**

* Show `plan.summary` + `plan.steps[]` (canonical to-do from Jules plan) 
* Step states: `pending | active | done_confirmed | done_estimated`
* Highlight approval gate when `AWAITING_PLAN_APPROVAL` (freeze “active” pulse until approval)

**Right: Timeline (event stream)**

* Append-only “events” normalized from:

  * status transitions
  * activities (`id/type/status/data`) 
  * artifacts (`git_patch` / `pull_request`) 
* Dedupe strictly by stable IDs (`act:${id}`, `art:${id}`, `st:${from}→${to}@time`)
* Each event has a collapsible “raw” drawer (raw JSON preservation is explicitly a condition later) 

### C. Action bar (contextual)

* `AWAITING_PLAN_APPROVAL`: **Approve / Reject w feedback**
* `IN_PROGRESS`: **Cancel** (and optionally “Send guidance” only if you’re willing to own the dark corner risk: `sendMessage` during IN_PROGRESS is explicitly called out) 
* `COMPLETED`: **Review artifacts** (diff/PR)

### D. “Keepalive” lane (dead-air filler) — explicitly labeled

* Small section labeled **“Status (UI)”** so users don’t confuse it with real activity.
* Rotating truthy lines driven only by phase + timers + plan text (not by Jules messages).

### E. Debug + observability (opt-in)

* “Metrics in the dark places”: show API version check, response validation errors, poll count, duration, artifact delivery count (mirrors the handoff’s “metrics placed” posture). 

---

## 2) Copy style guide (truthy, agentic, zero theater)

This is basically a UI version of “stop lying to ourselves” + “no invented events.” L1-L4

### A. Copy must fall into one of 4 buckets

1. **Confirmed fact** (status/activity/artifact)
2. **Polling mechanic** (“next check in 7s”)
3. **Plan reference** (“Executing (per plan): step 2…”)
4. **User prompt / guidance** (“Approve to proceed”)

If a sentence doesn’t fit those buckets, it’s probably theater.

### B. Forbidden verbs (unless you have an artifact proving it)

Do **not** say: *applied, updated, fixed, committed, opened PR, ran tests, refactored, merged, deployed*.

Allowed “doing” verbs must be framed as *waiting / working per plan*:

* ✅ “Waiting for Jules to report the next update…”
* ✅ “Executing (per plan): {step}”
* ✅ “Plan drafted — approval needed.”
* ❌ “Updated files to…” (until patch/PR exists)

### C. Required labeling

* Anything generated for dead air must be visually labeled (e.g., “Status (UI)”).
* Timeline entries are “Agent output” only when sourced from activities/status/artifacts.

### D. Fail-closed wording

When something is unknown (schema drift, empty activities, missing artifacts), the UI should be blunt:

* “No new updates received yet.”
* “Jules returned an unrecognized activity shape (saved in raw view).”
  This matches the “system that crashes is safer than the system that lies” philosophy. 

### E. Copy lint (practical)

Add a small unit test that scans your keepalive template library for forbidden verbs. This keeps PM edits from quietly reintroducing “success theater.”

---

## 3) Step evidence matcher (upgrade to `done_confirmed` with proof)

Goal: upgrade steps only when you can point to evidence in:

* an **artifact** (`git_patch`/`pull_request`) 
* or a strongly-typed **activity hint** (e.g., stepIndex, filenames)

### Evidence sources you already have

* `JulesArtifactResponse.patch` may include diffs (file paths in `diff --git …`) 
* `JulesArtifactResponse.title/url` (PR title often contains task keywords)
* `JulesActivityResponse.data` (flexible JSON; treat as optional / best-effort) 

### Matching strategy

Use a **scored matcher** and only confirm above a threshold.

**Signals (examples)**

* Exact filename mentioned in step text: +10
* Directory match (e.g., `src/agents/`): +6
* Keyword match (token overlap after normalization): +3
* Activity explicitly references `stepIndex`: direct confirm for that step (attach evidence)
* Patch contains files whose names overlap with step tokens: +10/+6

**Threshold**

* `>= 10` → `done_confirmed`
* `6–9` → keep `active` / optionally `done_estimated`
* `< 6` → no change

### Reference implementation (TypeScript)

```ts
type Evidence = { eventId: string; kind: "artifact" | "activity"; note: string }

function upgradeStepsWithEvidence(run: Run): Run {
  const plan = run.plan
  if (!plan) return run

  const patchFiles = extractFilesFromPatches(run.artifacts)
  const artifactTexts = run.artifacts.map(function (a) { return (a.title + " " + (a.url ?? "")) })
  const activityTexts = run.timeline
    .filter(function (e) { return e.source === "activity" })
    .map(function (e) { return (e.title + " " + (e.detail ?? "")) })

  const iMax = plan.steps.length
  let i = 0
  for (i = 0; i < iMax; i = i + 1) {
    const step = plan.steps[i]
    if (step.state === "done_confirmed") continue

    const scoreA = scoreStepAgainstArtifacts(step.text, patchFiles, artifactTexts)
    const scoreB = scoreStepAgainstActivities(step.text, activityTexts)

    const score = Math.max(scoreA.score, scoreB.score)
    const ev = scoreA.score >= scoreB.score ? scoreA.evidence : scoreB.evidence

    if (score >= 10 && ev) {
      plan.steps[i] = {
        text: step.text,
        state: "done_confirmed",
        evidence: { eventId: ev.eventId },
      }
    }
  }

  return run
}

function extractFilesFromPatches(arts: Artifact[]): string[] {
  const files: string[] = []
  let i = 0
  for (i = 0; i < arts.length; i = i + 1) {
    const a = arts[i]
    if (a.type !== "git_patch") continue
    if (!a.patch) continue

    const lines = a.patch.split("\n")
    let j = 0
    for (j = 0; j < lines.length; j = j + 1) {
      const line = lines[j]
      // diff --git a/path b/path
      if (line.startsWith("diff --git ")) {
        const m = line.match(/^diff --git a\/(.+?) b\/(.+?)$/)
        if (m && m[2]) files.push(m[2])
      }
    }
  }
  return uniq(files)
}

function scoreStepAgainstArtifacts(stepText: string, patchFiles: string[], artifactTexts: string[])
  : { score: number; evidence?: Evidence } {

  const step = norm(stepText)
  const tokens = tokenize(step)

  // 1) file matches
  let best = 0
  let bestFile = ""
  let i = 0
  for (i = 0; i < patchFiles.length; i = i + 1) {
    const f = norm(patchFiles[i])
    const s = scoreFileMatch(tokens, f)
    if (s > best) { best = s; bestFile = patchFiles[i] }
  }

  // 2) title/url keyword overlap
  let bestText = 0
  let t = 0
  for (t = 0; t < artifactTexts.length; t = t + 1) {
    const s = overlapScore(tokens, tokenize(norm(artifactTexts[t])))
    if (s > bestText) bestText = s
  }

  const score = Math.max(best, bestText)
  if (score >= 10) {
    return { score, evidence: { eventId: "art:match", kind: "artifact", note: bestFile ? "files: " + bestFile : "artifact text" } }
  }
  return { score }
}

function scoreStepAgainstActivities(stepText: string, activityTexts: string[])
  : { score: number; evidence?: Evidence } {

  const tokens = tokenize(norm(stepText))
  let best = 0
  let i = 0
  for (i = 0; i < activityTexts.length; i = i + 1) {
    const s = overlapScore(tokens, tokenize(norm(activityTexts[i])))
    if (s > best) best = s
  }

  // conservative: only confirm from activity if overlap is very strong
  if (best >= 12) {
    return { score: best, evidence: { eventId: "act:match", kind: "activity", note: "strong activity overlap" } }
  }
  return { score: best }
}

function scoreFileMatch(stepTokens: string[], file: string): number {
  // exact filename token present → 10
  const parts = file.split("/")
  const name = parts[parts.length - 1] ?? file
  if (containsToken(stepTokens, norm(name))) return 10
  // directory token present → 6
  let i = 0
  for (i = 0; i < parts.length - 1; i = i + 1) {
    if (containsToken(stepTokens, norm(parts[i]))) return 6
  }
  return 0
}

function overlapScore(a: string[], b: string[]): number {
  const setB = new Set(b)
  let hit = 0
  let i = 0
  for (i = 0; i < a.length; i = i + 1) {
    if (setB.has(a[i])) hit = hit + 1
  }
  return hit * 3 // 1 overlap = 3 points
}

function tokenize(s: string): string[] {
  return s.split(/[^a-z0-9]+/).filter(function (x) { return x.length >= 3 })
}

function norm(s: string): string {
  return s.toLowerCase()
}

function containsToken(tokens: string[], token: string): boolean {
  let i = 0
  for (i = 0; i < tokens.length; i = i + 1) {
    if (tokens[i] === token) return true
  }
  return false
}

function uniq(xs: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  let i = 0
  for (i = 0; i < xs.length; i = i + 1) {
    if (seen.has(xs[i])) continue
    seen.add(xs[i])
    out.push(xs[i])
  }
  return out
}
```

### How to integrate it safely

* Run it **only after** you’ve normalized and deduped artifacts/events (so you’re not double-confirming).
* Only mutate:

  * `pending → active` (heuristic)
  * `pending/active → done_confirmed` (proof threshold reached)
* Never auto-confirm from keepalive text (keepalive is UI-only).

---
Here’s a **single-page “Agentic Run” UI mock** (layout + component tree + state diagram) that wires together:

`normalizeJulesToRun()` → `upgradeStepsWithEvidence()` → `generateTruthfulKeepalive()`,

with the polling cadence from your Jules ADR (`initialDelay: 2000`, `planningInterval: 5000`, `executionInterval: 10000`, caps). 

---

## 1) One-page layout mock (wireframe)

```
┌─────────────────────────────────────────────────────────────────────┐
│ Agentic Run: owner/repo                              [Jules]        │
│ [PLANNING ▣]  elapsed 03:12   last confirmed 18s ago   next poll 7s  │
│ Polls: 14   RunId: sessions/abc123                                     │
│                                                                     │
│ Actions:  [Cancel]  [Open raw]                                      │
├───────────────────────────────┬─────────────────────────────────────┤
│ PLAN / TO-DO                  │ TIMELINE (truth stream)             │
│ Summary: …                    │ 10:21 Planning                       │
│                               │ 10:28 Plan ready (approval required) │
│ 1 ☐ step text… (pending)      │ 10:29 Activity: …                    │
│ 2 ▣ step text… (active)       │ 10:31 Activity: …                    │
│ 3 ☐ step text… (pending)      │ 10:35 Artifact: PR …                 │
│                               │                                     │
│ Step evidence (hover):        │ [event] expand ▸ raw JSON            │
│  - confirmed only with proof  │                                     │
├───────────────────────────────┴─────────────────────────────────────┤
│ Status (UI) / Keepalive (non-truth stream):                          │
│  • Next check in 7s                                                  │
│  • Last confirmed update 18s ago                                     │
│  • Executing (per plan): “…”                                         │
└─────────────────────────────────────────────────────────────────────┘

When COMPLETED: show an “Artifacts” drawer/modal:
- PR link, Patch viewer, “Apply patch” (if you support it), “Open diff”
```

Why this matches Jules well: lifecycle is explicitly multi-step with an approval gate (`QUEUED → PLANNING → AWAITING_PLAN_APPROVAL → IN_PROGRESS → COMPLETED`). 

---

## 2) Component tree (React-ish)

**Top-level**

* `<AgenticRunPage />`

  * `<RunHeader />` (sticky)

    * `<StatusBadge />`
    * `<TimersBar />` (elapsed, lastTruthAt, nextPollAt, pollCount)
    * `<RunMeta />` (repo, provider, runId)
    * `<ActionBar />` (contextual buttons)
  * `<MainSplit />`

    * `<PlanPanel />` (left)

      * `<PlanSummary />`
      * `<StepsList />`

        * `<StepRow />` × N (state + evidence tooltip)
    * `<TimelinePanel />` (right)

      * `<EventList />`

        * `<EventRow />` (expand raw)
  * `<KeepalivePanel />` (bottom, explicitly labeled “Status (UI)”)
  * `<ArtifactsDrawer />` (only when artifacts exist)
  * `<DebugDrawer />` (optional)

**Data hooks**

* `useJulesRunController()` (truth loop + state machine)
* `useKeepaliveTicker()` (perception loop)

---

## 3) Page state diagram (UI + run lifecycle)

This is a UI-state machine that *derives* run phase from Jules status, and *adds* UX-only states (like “creating” and “reconnecting”).

```
[IDLE]
  └─(user clicks Run)→ [CREATING_SESSION]
      └─(sessionId)→ [POLLING: QUEUED/PLANNING]
          ├─(status=AWAITING_PLAN_APPROVAL)→ [AWAITING_APPROVAL]
          │     ├─(Approve)→ [POLLING: IN_PROGRESS]
          │     └─(Reject+feedback)→ [POLLING: PLANNING]
          ├─(status=IN_PROGRESS)→ [POLLING: IN_PROGRESS]
          ├─(status=COMPLETED)→ [TERMINAL: COMPLETED]
          ├─(status=FAILED)→ [TERMINAL: FAILED]
          └─(Cancel)→ [TERMINAL: CANCELLED]
```

Polling is explicitly “agent-driven / client-controlled,” not a long-running server stream. 

---

## 4) Wiring: truth loop + perception loop

### Truth loop (poll engine)

Uses the recommended polling parameters from the ADR: 

* After create: wait `initialDelay`
* While `QUEUED/PLANNING`: poll every `planningInterval`
* While `IN_PROGRESS`: poll every `executionInterval`
* Stop after `maxDuration` or `maxPolls`

Also: the flow includes explicit approval via `approvePlan()` after `AWAITING_PLAN_APPROVAL`. 

### Perception loop (keepalive ticker)

* Runs locally every ~250–600ms
* Calls `generateTruthfulKeepalive(run, now)`
* Rotates the returned lines every ~1.2–2.0s
* Never creates timeline events; it only updates the “Status (UI)” strip

---

## 5) Reference controller pseudo-code (single-page glue)

This is intentionally “page-level” and shows the exact wiring order:

```ts
const POLL = {
  initialDelay: 2000,
  planningInterval: 5000,
  executionInterval: 10000,
  maxDuration: 3600000,
  maxPolls: 360,
} // :contentReference[oaicite:5]{index=5}

function useJulesRunController(args: {
  repoUrl: string
  task: string
  apiKey: string
  client: IJulesClient
}) {
  // state: run + ui state
  // run model comes from normalizeJulesToRun() pipeline

  async function start() {
    const created = await args.client.createSession({
      repoUrl: args.repoUrl,
      task: args.task,
      apiKey: args.apiKey,
    }) // session type is defined in ADR :contentReference[oaicite:6]{index=6}

    // initialize Run from first response
    const now = Date.now()
    const out0 = normalizeJulesToRun(undefined, {
      repoUrl: args.repoUrl,
      task: args.task,
      session: created,
      receivedAt: now,
      nextPollAt: now + POLL.initialDelay,
    })

    const run0 = upgradeStepsWithEvidence(out0.run)
    setRun(run0)

    schedulePoll(created.id, now + POLL.initialDelay)
  }

  async function poll(sessionId: string) {
    const now = Date.now()

    const session = await args.client.getSession(sessionId, args.apiKey)
    const acts = await args.client.listActivities(sessionId, args.apiKey)

    const next = computeNextPollAt(session.status, now)

    const out = normalizeJulesToRun(getRun(), {
      repoUrl: args.repoUrl,
      task: args.task,
      session: session,
      activities: acts,
      receivedAt: now,
      nextPollAt: next,
    })

    const run1 = upgradeStepsWithEvidence(out.run)
    setRun(run1)

    if (run1.phase === "awaiting_approval") {
      // UI shows Approve/Reject controls; polling can slow or pause
      schedulePoll(sessionId, now + POLL.planningInterval)
      return
    }

    if (run1.phase === "completed" || run1.phase === "failed" || run1.phase === "cancelled") {
      return
    }

    schedulePoll(sessionId, next)
  }

  function computeNextPollAt(status: JulesStatus, now: number) {
    if (status === "IN_PROGRESS") return now + POLL.executionInterval
    return now + POLL.planningInterval
  }

  async function approve() {
    const run = getRun()
    const sessionId = run.runId
    const now = Date.now()

    const session = await args.client.approvePlan(sessionId, args.apiKey) // :contentReference[oaicite:7]{index=7}
    const next = now + POLL.executionInterval

    const out = normalizeJulesToRun(run, {
      repoUrl: args.repoUrl,
      task: args.task,
      session: session,
      receivedAt: now,
      nextPollAt: next,
    })

    setRun(upgradeStepsWithEvidence(out.run))
    schedulePoll(sessionId, next)
  }

  async function reject(feedback: string) {
    const run = getRun()
    const sessionId = run.runId
    const now = Date.now()

    const session = await args.client.rejectPlan(sessionId, feedback, args.apiKey) // :contentReference[oaicite:8]{index=8}
    const next = now + POLL.planningInterval

    const out = normalizeJulesToRun(run, {
      repoUrl: args.repoUrl,
      task: args.task,
      session: session,
      receivedAt: now,
      nextPollAt: next,
    })

    setRun(upgradeStepsWithEvidence(out.run))
    schedulePoll(sessionId, next)
  }

  async function cancel() {
    const run = getRun()
    await args.client.cancelSession(run.runId, args.apiKey) // :contentReference[oaicite:9]{index=9}
  }

  return { start, poll, approve, reject, cancel }
}
```

That matches your intended interfaces (`createSession/getSession/approvePlan/rejectPlan/cancelSession/listActivities`). 

---

## 6) UX guardrails baked into the page

* **Timeline = truth stream only** (status transitions, activities, artifacts).
* **Keepalive = UI-only** and explicitly labeled.
* **Approval gate is first-class** (no auto-approve).
* **Evidence matcher** only upgrades steps to `done_confirmed` when artifacts/activities support it (never from keepalive).
