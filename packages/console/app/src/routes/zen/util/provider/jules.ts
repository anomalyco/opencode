// -----------------------------------------------------------------------------
// Jules Provider — Types, Client Interface, Normalizer, Keepalive
//
// Jules is session-based (polling lifecycle), NOT a token-streaming LLM.
// This module lives in provider/ for colocation but does NOT implement
// ProviderHelper. Jules routes live under routes/jules/ and consume
// this module directly.
// -----------------------------------------------------------------------------

// ---------------------
// Jules API wire types
// ---------------------

export type JulesStatus =
  | "QUEUED"
  | "PLANNING"
  | "AWAITING_PLAN_APPROVAL"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"

export type JulesPlan = {
  summary: string
  steps: string[]
}

export type JulesActivityResponse = {
  id: string
  type: string
  status: string
  data: Record<string, unknown>
}

export type JulesArtifactResponse = {
  id: string
  type: "git_patch" | "pull_request"
  title: string
  url?: string
  patch?: string
}

export type JulesSessionResponse = {
  id: string
  status: JulesStatus
  plan?: JulesPlan
  activities?: JulesActivityResponse[]
  artifacts?: JulesArtifactResponse[]
  error?: string
}

// ---------------------
// IDE Run model (normalized)
// ---------------------

export type RunPhase =
  | "queued"
  | "planning"
  | "awaiting_approval"
  | "executing"
  | "completed"
  | "failed"
  | "cancelled"

export type RunEvent = {
  eventId: string
  at: number
  source: "status" | "activity" | "artifact" | "system"
  level: "info" | "warn" | "error"
  title: string
  detail?: string
  raw?: unknown
}

export type Artifact =
  | { id: string; type: "git_patch"; title: string; patch?: string; url?: string; raw?: unknown }
  | { id: string; type: "pull_request"; title: string; url?: string; raw?: unknown }

export type RunPlanStep = {
  text: string
  state: "pending" | "active" | "done_confirmed" | "done_estimated"
  evidence?: { eventId: string }
}

export type Run = {
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

// ---------------------
// Poll configuration
// ---------------------

export const POLL = {
  initialDelay: 2000,
  planningInterval: 5000,
  executionInterval: 10000,
  maxDuration: 3600000,
  maxPolls: 360,
} as const

// ---------------------
// Client interface
// ---------------------

export type CreateSessionArgs = {
  repoUrl: string
  task: string
  apiKey: string
  branch?: string
}

export interface IJulesClient {
  createSession(args: CreateSessionArgs): Promise<JulesSessionResponse>
  getSession(sessionId: string, apiKey: string): Promise<JulesSessionResponse>
  listActivities(sessionId: string, apiKey: string): Promise<JulesActivityResponse[]>
  approvePlan(sessionId: string, apiKey: string): Promise<JulesSessionResponse>
  rejectPlan(sessionId: string, feedback: string, apiKey: string): Promise<JulesSessionResponse>
  cancelSession(sessionId: string, apiKey: string): Promise<JulesSessionResponse>
}

// ---------------------
// Normalizer pipeline
// ---------------------

export type NormalizeInput = {
  repoUrl: string
  task: string
  session: JulesSessionResponse
  activities?: JulesActivityResponse[]
  receivedAt: number
  nextPollAt: number
}

export type NormalizeOutput = {
  run: Run
  newEvents: RunEvent[]
  changed: boolean
}

export function normalizeJulesToRun(prev: Run | undefined, input: NormalizeInput): NormalizeOutput {
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
    appendEvent(
      base,
      {
        eventId: "st:" + prevStatus + "→" + session.status + "@" + now.toString(),
        at: now,
        source: "status",
        level: statusToLevel(session.status, session.error),
        title: statusTitle(session.status),
        detail: session.error,
        raw: { from: prevStatus, to: session.status, error: session.error },
      },
      newEvents,
    )
    base.phase = nextPhase
    base.lastTruthAt = now
    changed = true
  }

  if (isTerminal(nextPhase) && !base.endedAt) base.endedAt = now

  // 2) Plan → stable to-do list
  if (session.plan) {
    const planChanged = upsertPlan(base, session.plan, now, newEvents)
    if (planChanged) {
      base.lastTruthAt = now
      changed = true
    }
  }

  // 3) Activities → timeline (dedupe by activity.id)
  let sawNewActivity = false
  let lastActivity: JulesActivityResponse | undefined

  for (let i = 0; i < acts.length; i++) {
    lastActivity = acts[i]
    const added = appendEvent(base, normalizeActivityEvent(acts[i], now), newEvents)
    if (added) sawNewActivity = true
  }

  if (sawNewActivity) {
    base.lastTruthAt = now
    changed = true
  }

  // 4) Artifacts → artifacts list + events (dedupe by artifact.id)
  let sawNewArtifact = false

  for (let j = 0; j < arts.length; j++) {
    const added = upsertArtifact(base, arts[j], now, newEvents)
    if (added) sawNewArtifact = true
  }

  if (sawNewArtifact) {
    base.lastTruthAt = now
    changed = true
  }

  // 5) Active step heuristic
  if (base.plan) setActiveStep(base, lastActivity)

  return { run: base, newEvents, changed }
}

// ---------------------
// Evidence matcher
// ---------------------

export function upgradeStepsWithEvidence(run: Run): Run {
  if (!run.plan) return run

  const patchFiles = extractFilesFromPatches(run.artifacts)
  const artifactTexts = run.artifacts.map((a) => a.title + " " + ((a as Record<string, unknown>).url ?? ""))
  const activityTexts = run.timeline
    .filter((e) => e.source === "activity")
    .map((e) => e.title + " " + (e.detail ?? ""))

  for (let i = 0; i < run.plan.steps.length; i++) {
    const step = run.plan.steps[i]
    if (step.state === "done_confirmed") continue

    const scoreA = scoreAgainstArtifacts(step.text, patchFiles, artifactTexts)
    const scoreB = scoreAgainstTexts(step.text, activityTexts, 12)
    const best = scoreA.score >= scoreB.score ? scoreA : scoreB

    if (best.score >= 10 && best.evidenceId) {
      run.plan.steps[i] = { text: step.text, state: "done_confirmed", evidence: { eventId: best.evidenceId } }
    }
  }

  return run
}

// ---------------------
// Keepalive generator
// ---------------------

export type KeepaliveLine = {
  id: string
  text: string
  kind: "keepalive" | "polling" | "status" | "hint"
  confidence: "truth"
}

export type KeepaliveOutput = {
  headline: string
  lines: KeepaliveLine[]
  rotateEveryMs: number
}

export function generateTruthfulKeepalive(run: Run, now: number): KeepaliveOutput {
  const phase = run.phase
  const elapsedSec = Math.max(0, Math.floor((now - run.startedAt) / 1000))
  const sinceTruthSec = Math.max(0, Math.floor((now - run.lastTruthAt) / 1000))
  const nextPollSec = Math.max(0, Math.ceil((run.nextPollAt - now) / 1000))
  const repoName = shortRepo(run.repoUrl)
  const activeStep = getActiveStepText(run)
  const planSummary = run.plan?.summary

  const headline =
    phase === "queued"
      ? "Queued"
      : phase === "planning"
        ? "Planning"
        : phase === "awaiting_approval"
          ? "Plan ready"
          : phase === "executing"
            ? "Working"
            : phase === "completed"
              ? "Completed"
              : phase === "failed"
                ? "Failed"
                : "Cancelled"

  const lines: KeepaliveLine[] = []

  lines.push({
    id: "poll-next",
    kind: "polling",
    confidence: "truth",
    text: nextPollSec > 0 ? "Next check in " + nextPollSec + "s." : "Checking for updates…",
  })

  lines.push({
    id: "truth-age",
    kind: "status",
    confidence: "truth",
    text: "Last confirmed update " + sinceTruthSec + "s ago.",
  })

  lines.push({
    id: "meta",
    kind: "status",
    confidence: "truth",
    text: "Run: " + repoName + " • " + elapsedSec + "s elapsed • " + run.pollCount + " polls",
  })

  if (phase === "queued") {
    lines.push({ id: "queued-1", kind: "keepalive", confidence: "truth", text: "Queued in Jules. Waiting to begin planning." })
    lines.push({ id: "queued-2", kind: "keepalive", confidence: "truth", text: "Task: " + truncate(run.task, 80) })
  }

  if (phase === "planning") {
    lines.push({
      id: "planning-1",
      kind: "keepalive",
      confidence: "truth",
      text: planSummary ? "Drafting a plan: " + truncate(planSummary, 90) : "Building a plan for: " + truncate(run.task, 90),
    })
    lines.push({
      id: "planning-2",
      kind: "hint",
      confidence: "truth",
      text: "Tip: you can keep working; updates will appear here as they arrive.",
    })
  }

  if (phase === "awaiting_approval") {
    lines.push({
      id: "approval-1",
      kind: "keepalive",
      confidence: "truth",
      text: "Review the plan and approve to continue execution.",
    })
    if (planSummary) {
      lines.push({ id: "approval-2", kind: "status", confidence: "truth", text: "Plan summary: " + truncate(planSummary, 100) })
    }
    lines.push({
      id: "approval-3",
      kind: "hint",
      confidence: "truth",
      text: "Rejecting with feedback will send your notes back into planning.",
    })
  }

  if (phase === "executing") {
    if (activeStep) {
      lines.push({
        id: "exec-step",
        kind: "keepalive",
        confidence: "truth",
        text: "Executing (per plan): " + truncate(activeStep, 100),
      })
    } else if (planSummary) {
      lines.push({
        id: "exec-plan",
        kind: "keepalive",
        confidence: "truth",
        text: "Executing the approved plan: " + truncate(planSummary, 100),
      })
    } else {
      lines.push({
        id: "exec-1",
        kind: "keepalive",
        confidence: "truth",
        text: "Execution in progress. Waiting for new activity from Jules…",
      })
    }
    lines.push({
      id: "exec-2",
      kind: "keepalive",
      confidence: "truth",
      text: "If nothing appears for a bit, it's usually just deep work between updates.",
    })
    lines.push({
      id: "exec-3",
      kind: "hint",
      confidence: "truth",
      text: "You can add guidance, but avoid changing scope mid-run unless needed.",
    })
  }

  if (phase === "completed") {
    const artCount = run.artifacts.length
    lines.push({
      id: "done-1",
      kind: "status",
      confidence: "truth",
      text: artCount > 0 ? "Artifacts received (" + artCount + "). Review them before applying." : "Run completed. No artifacts reported.",
    })
    lines.push({ id: "done-2", kind: "hint", confidence: "truth", text: "Next: inspect diff/PR, then decide whether to apply." })
  }

  if (phase === "failed") {
    const err = run.providerState.error
    lines.push({
      id: "fail-1",
      kind: "status",
      confidence: "truth",
      text: err ? "Error: " + truncate(err, 140) : "Run failed. See timeline for details.",
    })
    lines.push({
      id: "fail-2",
      kind: "hint",
      confidence: "truth",
      text: "Common recovery: retry with narrower scope or add clarifying constraints.",
    })
  }

  if (phase === "cancelled") {
    lines.push({ id: "cancel-1", kind: "status", confidence: "truth", text: "Run cancelled." })
  }

  const rotateEveryMs =
    phase === "planning"
      ? 1300
      : phase === "executing"
        ? 1200
        : phase === "awaiting_approval"
          ? 1800
          : 2000

  return { headline, lines: dedupeById(lines), rotateEveryMs }
}

// ---------------------
// Internal helpers
// ---------------------

function initOrClone(prev: Run | undefined, repoUrl: string, task: string, runId: string, now: number): Run {
  if (!prev) {
    return {
      runId,
      provider: "jules",
      repoUrl,
      task,
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
  for (let k = 0; k < run.timeline.length; k++) {
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

  const nextSteps: RunPlanStep[] = []
  for (let i = 0; i < plan.steps.length; i++) {
    const text = plan.steps[i]
    const prevStep = findStep(existing, text)
    nextSteps.push({ text, state: prevStep ? prevStep.state : "pending", evidence: prevStep ? prevStep.evidence : undefined })
  }

  run.plan = { summary: plan.summary, steps: nextSteps }

  appendEvent(
    run,
    {
      eventId: "plan:" + run.runId + "@" + now.toString(),
      at: now,
      source: "system",
      level: "info",
      title: "Plan updated",
      detail: plan.summary,
      raw: plan,
    },
    newEvents,
  )
  return true
}

function findStep(plan: { summary: string; steps: RunPlanStep[] } | undefined, text: string): RunPlanStep | undefined {
  if (!plan) return undefined
  for (let i = 0; i < plan.steps.length; i++) {
    if (plan.steps[i].text === text) return plan.steps[i]
  }
  return undefined
}

function normalizeActivityEvent(a: JulesActivityResponse, now: number): RunEvent {
  const title = readString(a.data, "title") ?? readString(a.data, "message") ?? a.type + " (" + a.status + ")"
  const detail = readString(a.data, "summary") ?? readString(a.data, "detail")
  return {
    eventId: "act:" + a.id,
    at: now,
    source: "activity",
    level: activityLevel(a.status),
    title,
    detail,
    raw: a,
  }
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
  for (let i = 0; i < run.artifacts.length; i++) {
    if (run.artifacts[i].id === ar.id) return false
  }

  const art: Artifact =
    ar.type === "git_patch"
      ? { id: ar.id, type: "git_patch", title: ar.title, patch: ar.patch, url: ar.url, raw: ar }
      : { id: ar.id, type: "pull_request", title: ar.title, url: ar.url, raw: ar }

  run.artifacts.push(art)

  appendEvent(
    run,
    {
      eventId: "art:" + ar.id,
      at: now,
      source: "artifact",
      level: "info",
      title: "Artifact: " + ar.title,
      detail: ar.url,
      raw: ar,
    },
    newEvents,
  )
  return true
}

function setActiveStep(run: Run, lastActivity: JulesActivityResponse | undefined): void {
  const plan = run.plan
  if (!plan) return

  for (let i = 0; i < plan.steps.length; i++) {
    if (plan.steps[i].state === "active") plan.steps[i].state = "pending"
  }

  if (run.phase !== "executing") return

  const idx = activityStepIndex(lastActivity)
  if (idx !== undefined && idx >= 0 && idx < plan.steps.length) {
    if (plan.steps[idx].state === "pending") plan.steps[idx].state = "active"
    return
  }

  for (let j = 0; j < plan.steps.length; j++) {
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
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

// Evidence scoring helpers

function extractFilesFromPatches(arts: Artifact[]): string[] {
  const files: string[] = []
  for (let i = 0; i < arts.length; i++) {
    const a = arts[i]
    if (a.type !== "git_patch") continue
    if (!a.patch) continue
    const patchLines = a.patch.split("\n")
    for (let j = 0; j < patchLines.length; j++) {
      if (!patchLines[j].startsWith("diff --git ")) continue
      const m = patchLines[j].match(/^diff --git a\/(.+?) b\/(.+?)$/)
      if (m && m[2]) files.push(m[2])
    }
  }
  return dedupeStrings(files)
}

function scoreAgainstArtifacts(
  stepText: string,
  patchFiles: string[],
  artifactTexts: string[],
): { score: number; evidenceId?: string } {
  const tokens = tokenize(norm(stepText))

  let bestFile = 0
  for (let i = 0; i < patchFiles.length; i++) {
    const s = scoreFileMatch(tokens, norm(patchFiles[i]))
    if (s > bestFile) bestFile = s
  }

  let bestText = 0
  for (let t = 0; t < artifactTexts.length; t++) {
    const s = overlapScore(tokens, tokenize(norm(artifactTexts[t])))
    if (s > bestText) bestText = s
  }

  const score = Math.max(bestFile, bestText)
  if (score >= 10) return { score, evidenceId: "art:match" }
  return { score }
}

function scoreAgainstTexts(stepText: string, texts: string[], threshold: number): { score: number; evidenceId?: string } {
  const tokens = tokenize(norm(stepText))
  let best = 0
  for (let i = 0; i < texts.length; i++) {
    const s = overlapScore(tokens, tokenize(norm(texts[i])))
    if (s > best) best = s
  }
  if (best >= threshold) return { score: best, evidenceId: "act:match" }
  return { score: best }
}

function scoreFileMatch(stepTokens: string[], file: string): number {
  const parts = file.split("/")
  const name = parts[parts.length - 1] ?? file
  if (containsToken(stepTokens, norm(name))) return 10
  for (let i = 0; i < parts.length - 1; i++) {
    if (containsToken(stepTokens, norm(parts[i]))) return 6
  }
  return 0
}

function overlapScore(a: string[], b: string[]): number {
  const setB = new Set(b)
  let hit = 0
  for (let i = 0; i < a.length; i++) {
    if (setB.has(a[i])) hit = hit + 1
  }
  return hit * 3
}

function tokenize(s: string): string[] {
  return s.split(/[^a-z0-9]+/).filter((x) => x.length >= 3)
}

function norm(s: string): string {
  return s.toLowerCase()
}

function containsToken(tokens: string[], token: string): boolean {
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === token) return true
  }
  return false
}

function dedupeStrings(xs: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (let i = 0; i < xs.length; i++) {
    if (seen.has(xs[i])) continue
    seen.add(xs[i])
    out.push(xs[i])
  }
  return out
}

// Keepalive helpers

function getActiveStepText(run: Run): string | undefined {
  if (!run.plan) return undefined
  for (let i = 0; i < run.plan.steps.length; i++) {
    if (run.plan.steps[i].state === "active") return run.plan.steps[i].text
  }
  return undefined
}

function shortRepo(repoUrl: string): string {
  const m = repoUrl.match(/github\.com\/([^/]+\/[^/#?]+)/)
  if (m && m[1]) return m[1]
  const s = repoUrl.match(/sources\/github\/([^/]+\/[^/]+)/)
  if (s && s[1]) return s[1]
  return truncate(repoUrl.replace(/^https?:\/\//, ""), 28)
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, Math.max(0, n - 1)) + "…"
}

function dedupeById(lines: KeepaliveLine[]): KeepaliveLine[] {
  const seen = new Set<string>()
  const out: KeepaliveLine[] = []
  for (const l of lines) {
    if (seen.has(l.id)) continue
    seen.add(l.id)
    out.push(l)
  }
  return out
}

// ---------------------
// Utility: compute next poll time
// ---------------------

export function computeNextPollAt(status: JulesStatus, now: number): number {
  if (status === "IN_PROGRESS") return now + POLL.executionInterval
  return now + POLL.planningInterval
}

export function isTerminalPhase(phase: RunPhase): boolean {
  return isTerminal(phase)
}
