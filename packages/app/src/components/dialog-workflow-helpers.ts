import type { WorkflowInfo, WorkflowRun } from "@opencode-ai/sdk/v2"

// Pure dashboard derivations, ported from the TUI's
// `packages/tui/src/component/dialog-workflow-helpers.ts`. Kept dependency-free
// (no `path`, no runtime) so they are unit-testable and browser-safe. The
// save-as-command path helpers (saveTargets) and the command parsers live in
// `prompt-input/workflow-command.ts`; mergeRunEvent is skipped because the web
// dashboard refetches on every workflow.run.* event rather than overlaying.

// The engine persists timestamps as numbers, but the SDK schema widens them to
// include stringified non-finite sentinels ("NaN"/"Infinity"). Normalize any of
// those — plus genuine numeric strings — to a finite number or `undefined`.
export function timestamp(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

// Accepts BOTH the run-level and the agent-node status unions (the dialog feeds
// agent.status through here too). `skipped` (Item 15: a human skipped the step)
// gets a minimal distinct glyph; the full skipped/label rendering is the
// detail-view item of the next wave.
export function statusIcon(status: WorkflowRun["status"] | WorkflowRun["agents"][number]["status"]) {
  if (status === "running") return "●"
  if (status === "completed") return "✔"
  if (status === "failed") return "✖"
  if (status === "cancelled") return "⊗"
  if (status === "interrupted") return "⊘"
  if (status === "paused") return "⏸"
  if (status === "skipped") return "↷"
  return "◌"
}

// The single app-side source of truth for "can this run be resumed?". Mirrors
// the engine's RESUMABLE guard (workflow.ts: paused/interrupted plus — since the
// failed/completed resume landed — failed and completed, both replaying the
// journal into a NEW run). The dashboard's Resume button and the per-agent
// re-run derive from this one list, so an engine change lands in exactly one place.
const RESUMABLE: ReadonlySet<WorkflowRun["status"]> = new Set(["paused", "interrupted", "failed", "completed"])

export function isResumable(status: WorkflowRun["status"]): boolean {
  return RESUMABLE.has(status)
}

// N5: the engine never advances/clears `current_phase` at completion, so a run
// that finished on a non-last declared phase left later phases rendering as
// `pending` forever. A terminal run will NEVER reach those phases, so they read
// `skipped` (a distinct, non-live rendering) rather than the misleading
// `pending`. Purely a derived view — the persisted lifecycle is untouched.
export function phaseStatus(run: WorkflowRun, phases: readonly string[], phase: string) {
  const current = run.current_phase ? phases.indexOf(run.current_phase) : -1
  const index = phases.indexOf(phase)
  if (run.status === "running") {
    if (index < current) return "completed"
    if (index === current) return "running"
    return "pending"
  }
  if (index < current || (run.status === "completed" && (current === -1 || index <= current))) return "completed"
  if (index === current) return run.status
  return "skipped"
}

export function phaseIcon(status: ReturnType<typeof phaseStatus>) {
  if (status === "completed") return "✔"
  if (status === "running") return "●"
  if (status === "failed") return "✖"
  if (status === "cancelled") return statusIcon("cancelled")
  if (status === "interrupted") return "⊘"
  if (status === "paused") return statusIcon("paused")
  return "◌"
}

// `now` is injected so the duration is deterministic in tests and frozen on a
// terminal run. On a live run the caller passes `Date.now()` so it keeps ticking.
export function formatShortElapsed(started_at: unknown, completed_at?: unknown, now: number = Date.now()) {
  const start = timestamp(started_at)
  if (start === undefined) return "--"
  const seconds = Math.max(0, Math.floor(((timestamp(completed_at) ?? now) - start) / 1000))
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m${(seconds % 60).toString().padStart(2, "0")}s`
  return `${Math.floor(seconds / 3600)}h${Math.floor((seconds % 3600) / 60)
    .toString()
    .padStart(2, "0")}m`
}

// The SDK widens `meta.phases` to `Array<string | WorkflowPhase>`. Normalize to
// the bare phase titles `string[]` that phaseStatus/formatPhase expect.
export function normalizePhases(workflow?: WorkflowInfo): string[] {
  const phases = workflow?.meta.phases
  if (!phases) return []
  return phases.map((phase) => (typeof phase === "string" ? phase : phase.title))
}

export function formatPhase(run: WorkflowRun, workflow?: WorkflowInfo) {
  if (run.status !== "running") return "[---] complete"
  const phases = normalizePhases(workflow)
  if (!run.current_phase || phases.length === 0) return run.current_phase ?? "pending"
  const index = phases.indexOf(run.current_phase)
  return `[${index >= 0 ? index + 1 : "?"}/${phases.length}] ${run.current_phase}`
}

// Sums agent cost for runs started within the calendar month of `now`, tolerating
// undefined per-agent cost and non-finite `started_at`. `now` is injected for
// determinism in tests; callers pass `Date.now()`.
export function spentThisMonth(runs: readonly WorkflowRun[], now: number = Date.now()) {
  const start = new Date(now)
  start.setDate(1)
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setMonth(end.getMonth() + 1)
  return runs
    .filter((run) => {
      const started = timestamp(run.started_at)
      return started !== undefined && started >= start.getTime() && started < end.getTime()
    })
    .reduce((total, run) => total + run.agents.reduce((sum, agent) => sum + (agent.cost ?? 0), 0), 0)
}

// The dashboard re-sorts runs on every refetch, so a positional selection would
// silently jump. Re-anchor to the run that still carries the previously-selected
// id; if it is gone, clamp to the last row so the selection never points past
// the end.
export function reanchorSelection(prevId: string | undefined, rows: readonly WorkflowRun[]) {
  if (rows.length === 0) return 0
  if (prevId === undefined) return 0
  const index = rows.findIndex((run) => run.id === prevId)
  if (index >= 0) return index
  return rows.length - 1
}

// Bound the logs section: keep only the last `max` entries and report how many
// older ones were dropped, so the view can show a "… N earlier entries" hint
// instead of growing unbounded. Generic over the element type (slice only).
export function capLogs<T>(entries: readonly T[], max: number) {
  if (entries.length <= max) return { entries: entries.slice(), hidden: 0 }
  return { entries: entries.slice(-max), hidden: entries.length - max }
}

// Dashboard waiting badge: a run that has asked a question and is still running
// or parked (paused) shows the hourglass so the operator can spot it needs an
// answer. Any other state (no pending question, or terminal) shows no badge.
export function questionBadge(run: WorkflowRun): "⏳" | "" {
  if (!run.pending_question) return ""
  if (run.status === "running" || run.status === "paused") return "⏳"
  return ""
}
