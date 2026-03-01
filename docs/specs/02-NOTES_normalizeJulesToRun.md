**`normalizeJulesToRun()`** that takes the latest `JulesSessionResponse` + optional `JulesActivityResponse[]` (shape per your ADR turn11file1L8-L15) and produces an IDE-friendly `Run` with **deduped timeline events**, a **plan/to-do list**, and **artifacts**, while preserving raw JSON for drift/debug (consistent with the “preserve raw Jules data” stance ).

```ts
type JulesStatus =
  | "QUEUED"
  | "PLANNING"
  | "AWAITING_PLAN_APPROVAL"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED" // :contentReference[oaicite:3]{index=3}

type JulesPlan = { summary: string; steps: string[] } // :contentReference[oaicite:4]{index=4}

type JulesActivityResponse = {
  id: string
  type: string
  status: string
  data: Record<string, unknown>
} // :contentReference[oaicite:5]{index=5}

type JulesArtifactResponse = {
  id: string
  type: "git_patch" | "pull_request"
  title: string
  url?: string
  patch?: string
} // :contentReference[oaicite:6]{index=6}

type JulesSessionResponse = {
  id: string
  status: JulesStatus
  plan?: JulesPlan
  activities?: JulesActivityResponse[]
  artifacts?: JulesArtifactResponse[]
  error?: string
} // :contentReference[oaicite:7]{index=7}

type RunPhase =
  | "queued"
  | "planning"
  | "awaiting_approval"
  | "executing"
  | "completed"
  | "failed"
  | "cancelled"

type RunEvent = {
  eventId: string
  at: number
  source: "status" | "activity" | "artifact" | "system"
  level: "info" | "warn" | "error"
  title: string
  detail?: string
  raw?: unknown
}

type Artifact =
  | { id: string; type: "git_patch"; title: string; patch?: string; url?: string; raw?: unknown }
  | { id: string; type: "pull_request"; title: string; url?: string; raw?: unknown }

type RunPlanStep = {
  text: string
  state: "pending" | "active" | "done_confirmed" | "done_estimated"
  evidence?: { eventId: string }
}

type Run = {
  runId: string
  provider: "jules"
  repoUrl: string
  task: string

  phase: RunPhase
  providerState: { julesStatus: JulesStatus; error?: string }

  startedAt: number
  endedAt?: number

  lastTruthAt: number
  lastPollAt: number
  nextPollAt: number
  pollCount: number

  plan?: { summary: string; steps: RunPlanStep[] }

  timeline: RunEvent[]
  artifacts: Artifact[]
}

type NormalizeInput = {
  repoUrl: string
  task: string
  session: JulesSessionResponse
  activities?: JulesActivityResponse[] // if you fetch separately, pass here
  receivedAt: number                  // poll receipt time
  nextPollAt: number
}

type NormalizeOutput = {
  run: Run
  newEvents: RunEvent[]
  changed: boolean
}

function normalizeJulesToRun(prev: Run | undefined, input: NormalizeInput): NormalizeOutput {
  const now = input.receivedAt
  const session = input.session
  const acts = input.activities ?? session.activities ?? []
  const arts = session.artifacts ?? []

  const base = initOrClone(prev, input.repoUrl, input.task, session.id, now)
  base.lastPollAt = now
  base.nextPollAt = input.nextPollAt
  base.pollCount = base.pollCount + 1

  const newEvents: RunEvent[] = []
  let changed = false

  // 1) Status → phase + transition event
  const nextPhase = statusToPhase(session.status)
  const prevStatus = base.providerState.julesStatus
  base.providerState.julesStatus = session.status
  base.providerState.error = session.error

  if (prevStatus !== session.status) {
    const ev = {
      eventId: "st:" + prevStatus + "→" + session.status + "@" + now.toString(),
      at: now,
      source: "status",
      level: statusToLevel(session.status, session.error),
      title: statusTitle(session.status),
      detail: session.error ? session.error : undefined,
      raw: { from: prevStatus, to: session.status, error: session.error },
    }
    appendEvent(base, ev, newEvents)
    base.phase = nextPhase
    changed = true
    base.lastTruthAt = now
  }

  // End time on terminal phases
  if (isTerminal(nextPhase) && !base.endedAt) {
    base.endedAt = now
  }

  // 2) Plan → stable to-do list
  if (session.plan) {
    const planChanged = upsertPlan(base, session.plan, now, newEvents)
    if (planChanged) {
      changed = true
      base.lastTruthAt = now
    }
  }

  // 3) Activities → timeline (dedupe by activity.id)
  let sawNewActivity = false
  let lastActivity: JulesActivityResponse | undefined = undefined

  let i = 0
  for (i = 0; i < acts.length; i = i + 1) {
    const a = acts[i]
    lastActivity = a
    const ev = normalizeActivityEvent(a, now)
    const added = appendEvent(base, ev, newEvents)
    if (added) {
      sawNewActivity = true
    }
  }

  if (sawNewActivity) {
    changed = true
    base.lastTruthAt = now
  }

  // 4) Artifacts → artifacts list + events (dedupe by artifact.id)
  let sawNewArtifact = false

  let j = 0
  for (j = 0; j < arts.length; j = j + 1) {
    const ar = arts[j]
    const added = upsertArtifact(base, ar, now, newEvents)
    if (added) {
      sawNewArtifact = true
    }
  }

  if (sawNewArtifact) {
    changed = true
    base.lastTruthAt = now
  }

  // 5) Active step heuristic (truthy: only “active”, don’t mark done unless you have strong evidence)
  if (base.plan) {
    setActiveStep(base, lastActivity)
  }

  return { run: base, newEvents: newEvents, changed: changed }
}

function initOrClone(prev: Run | undefined, repoUrl: string, task: string, runId: string, now: number): Run {
  if (!prev) {
    return {
      runId: runId,
      provider: "jules",
      repoUrl: repoUrl,
      task: task,
      phase: "queued",
      providerState: { julesStatus: "QUEUED" },
      startedAt: now,
      lastTruthAt: now,
      lastPollAt: now,
      nextPollAt: now,
      pollCount: 0,
      timeline: [],
      artifacts: [],
    }
  }

  // Shallow clone with new arrays to keep immutability-friendly behavior
  return {
    runId: prev.runId,
    provider: prev.provider,
    repoUrl: prev.repoUrl,
    task: prev.task,
    phase: prev.phase,
    providerState: { julesStatus: prev.providerState.julesStatus, error: prev.providerState.error },
    startedAt: prev.startedAt,
    endedAt: prev.endedAt,
    lastTruthAt: prev.lastTruthAt,
    lastPollAt: prev.lastPollAt,
    nextPollAt: prev.nextPollAt,
    pollCount: prev.pollCount,
    plan: prev.plan
      ? { summary: prev.plan.summary, steps: prev.plan.steps.map((s) => ({ text: s.text, state: s.state, evidence: s.evidence })) }
      : undefined,
    timeline: prev.timeline.slice(0),
    artifacts: prev.artifacts.slice(0),
  }
}

function statusToPhase(s: JulesStatus): RunPhase {
  if (s === "QUEUED") return "queued"
  if (s === "PLANNING") return "planning"
  if (s === "AWAITING_PLAN_APPROVAL") return "awaiting_approval"
  if (s === "IN_PROGRESS") return "executing"
  if (s === "COMPLETED") return "completed"
  if (s === "FAILED") return "failed"
  return "cancelled"
}

function isTerminal(p: RunPhase): boolean {
  return p === "completed" || p === "failed" || p === "cancelled"
}

function statusTitle(s: JulesStatus): string {
  if (s === "QUEUED") return "Queued"
  if (s === "PLANNING") return "Planning"
  if (s === "AWAITING_PLAN_APPROVAL") return "Plan ready (approval required)"
  if (s === "IN_PROGRESS") return "Executing"
  if (s === "COMPLETED") return "Completed"
  if (s === "FAILED") return "Failed"
  return "Cancelled"
}

function statusToLevel(s: JulesStatus, err: string | undefined): "info" | "warn" | "error" {
  if (s === "FAILED") return "error"
  if (err) return "warn"
  return "info"
}

function appendEvent(run: Run, ev: RunEvent, newEvents: RunEvent[]): boolean {
  // Dedupe by eventId
  let k = 0
  for (k = 0; k < run.timeline.length; k = k + 1) {
    if (run.timeline[k].eventId === ev.eventId) return false
  }
  run.timeline.push(ev)
  newEvents.push(ev)
  return true
}

function upsertPlan(run: Run, plan: JulesPlan, now: number, newEvents: RunEvent[]): boolean {
  const existing = run.plan
  const sameSummary = !!existing && existing.summary === plan.summary
  const sameSteps = !!existing && arrayEq(existing.steps.map((s) => s.text), plan.steps)

  if (sameSummary && sameSteps) return false

  // Preserve step states by exact text match where possible
  const nextSteps: RunPlanStep[] = []
  let i = 0
  for (i = 0; i < plan.steps.length; i = i + 1) {
    const text = plan.steps[i]
    const prevStep = findStep(existing, text)
    nextSteps.push({
      text: text,
      state: prevStep ? prevStep.state : "pending",
      evidence: prevStep ? prevStep.evidence : undefined,
    })
  }

  run.plan = { summary: plan.summary, steps: nextSteps }

  const ev: RunEvent = {
    eventId: "plan:" + run.runId + "@" + now.toString(),
    at: now,
    source: "system",
    level: "info",
    title: "Plan updated",
    detail: plan.summary,
    raw: plan,
  }
  appendEvent(run, ev, newEvents)
  return true
}

function findStep(plan: { summary: string; steps: RunPlanStep[] } | undefined, text: string): RunPlanStep | undefined {
  if (!plan) return undefined
  let i = 0
  for (i = 0; i < plan.steps.length; i = i + 1) {
    if (plan.steps[i].text === text) return plan.steps[i]
  }
  return undefined
}

function normalizeActivityEvent(a: JulesActivityResponse, now: number): RunEvent {
  const title = activityTitle(a)
  const detail = activityDetail(a)
  return {
    eventId: "act:" + a.id,
    at: now,
    source: "activity",
    level: activityLevel(a.status),
    title: title,
    detail: detail,
    raw: a, // raw preservation for schema drift :contentReference[oaicite:8]{index=8}
  }
}

function activityTitle(a: JulesActivityResponse): string {
  const d = a.data
  const t = readString(d, "title")
  if (t) return t
  const m = readString(d, "message")
  if (m) return m
  return a.type + " (" + a.status + ")"
}

function activityDetail(a: JulesActivityResponse): string | undefined {
  const d = a.data
  const s = readString(d, "summary")
  if (s) return s
  const msg = readString(d, "detail")
  if (msg) return msg
  return undefined
}

function activityLevel(status: string): "info" | "warn" | "error" {
  const s = status.toUpperCase()
  if (s === "FAILED" || s === "ERROR") return "error"
  if (s === "WARN" || s === "WARNING") return "warn"
  return "info"
}

function readString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key]
  if (typeof v === "string") return v
  return undefined
}

function upsertArtifact(run: Run, ar: JulesArtifactResponse, now: number, newEvents: RunEvent[]): boolean {
  // dedupe artifacts by id
  let i = 0
  for (i = 0; i < run.artifacts.length; i = i + 1) {
    if (run.artifacts[i].id === ar.id) return false
  }

  const art = artifactFromJules(ar)
  run.artifacts.push(art)

  const ev: RunEvent = {
    eventId: "art:" + ar.id,
    at: now,
    source: "artifact",
    level: "info",
    title: "Artifact: " + ar.title,
    detail: ar.url ? ar.url : undefined,
    raw: ar,
  }
  appendEvent(run, ev, newEvents)
  return true
}

function artifactFromJules(ar: JulesArtifactResponse): Artifact {
  if (ar.type === "git_patch") {
    return { id: ar.id, type: "git_patch", title: ar.title, patch: ar.patch, url: ar.url, raw: ar }
  }
  return { id: ar.id, type: "pull_request", title: ar.title, url: ar.url, raw: ar }
}

function setActiveStep(run: Run, lastActivity: JulesActivityResponse | undefined): void {
  const plan = run.plan
  if (!plan) return

  // Clear previous "active" (don’t downgrade done_* states)
  let i = 0
  for (i = 0; i < plan.steps.length; i = i + 1) {
    if (plan.steps[i].state === "active") plan.steps[i].state = "pending"
  }

  if (run.phase !== "executing") return

  // Heuristic: if activity mentions a step index, use it; else first pending
  const idx = activityStepIndex(lastActivity)
  if (idx !== undefined && idx >= 0 && idx < plan.steps.length) {
    if (plan.steps[idx].state === "pending") plan.steps[idx].state = "active"
    return
  }

  let j = 0
  for (j = 0; j < plan.steps.length; j = j + 1) {
    if (plan.steps[j].state === "pending") {
      plan.steps[j].state = "active"
      return
    }
  }
}

function activityStepIndex(a: JulesActivityResponse | undefined): number | undefined {
  if (!a) return undefined
  const v = a.data["stepIndex"]
  if (typeof v === "number" && Number.isFinite(v)) return v
  return undefined
}

function arrayEq(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  let i = 0
  for (i = 0; i < a.length; i = i + 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}
```

### Notes (how this plugs into your IDE UX)

* **“Truth clock”**: each poll call runs `normalizeJulesToRun(prev, …)`; the UI renders `run.timeline` as the stream.
* **“Perception clock”**: your animated “thinking sentences” should be driven by `run.phase`, `run.plan?.summary`, `run.plan?.steps[active]`, and the timers (`nextPollAt`, `lastTruthAt`) — never by made-up claims.
* Poll intervals/config can follow the ADR defaults (`initialDelay 2s`, planning `5s`, execution `10s`, caps) .