import type { WorkflowInfo, WorkflowRun } from "@opencode-ai/sdk/v2"
import type { WorkflowRunEvent } from "./dialog-workflow-client"
import path from "path"

// The engine persists timestamps as numbers, but the SDK schema widens them to
// include stringified non-finite sentinels ("NaN"/"Infinity"). Normalize any of
// those — plus genuine numeric strings — to a finite number or `undefined`.
export function timestamp(value: unknown) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

export function statusIcon(status: WorkflowRun["status"]) {
  if (status === "running") return "●"
  if (status === "completed") return "✔"
  if (status === "failed") return "✖"
  // Fund 32: `cancelled` (a user-requested kill) now reads apart from every
  // other terminal state with its own crossed-circle glyph; previously it fell
  // through to the hollow pending marker `◌` and looked unfinished.
  if (status === "cancelled") return "⊗"
  // `interrupted` is a failure-like terminal state (orphaned/zombie run), shown
  // with a distinct broken-circle marker so it reads apart from a clean cancel.
  if (status === "interrupted") return "⊘"
  // `paused` is the only non-terminal state besides running: a user-suspended run
  // that can be resumed. The pause glyph reads apart from every terminal marker.
  if (status === "paused") return "⏸"
  return "◌"
}

// N5: the engine never advances/clears `current_phase` at completion (only
// `setPhase` writes it), so a run that finished on a non-last declared phase
// (common: meta.phases declares more phases than the body walks) left every
// later phase rendering as `pending` forever on a terminal run. A terminal run
// will NEVER reach those phases, so they are reported `skipped` (a distinct,
// non-live rendering) rather than the misleading `pending`. This is purely a
// derived TUI view — the engine row is untouched, so the persisted lifecycle
// stays honest (no synthetic "current_phase = last" lie).
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
  // A phase after the one the terminal run stopped on was never reached.
  return "skipped"
}

export function phaseIcon(status: ReturnType<typeof phaseStatus>) {
  if (status === "completed") return "✔"
  if (status === "running") return "●"
  if (status === "failed") return "✖"
  if (status === "cancelled") return statusIcon("cancelled")
  if (status === "interrupted") return "⊘"
  // The phase a paused run stopped on reads with the pause glyph (it can resume).
  if (status === "paused") return statusIcon("paused")
  // `skipped` (never-reached phase on a terminal run) and `pending` both read as
  // the hollow marker — neither is live; `skipped` simply will never advance.
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

export function formatPhase(run: WorkflowRun, workflow?: WorkflowInfo) {
  if (run.status !== "running") return "[---] complete"
  const phases = workflow?.meta.phases ?? []
  if (!run.current_phase || phases.length === 0) return run.current_phase ?? "pending"
  const index = phases.indexOf(run.current_phase)
  // Item 14: a child-workflow current_phase ('<child>: …') is never in
  // meta.phases, so the dashboard LIST deliberately shows '[?/N]' for it — the
  // list only knows the declared plan. The detail view merges observed phases
  // (mergeObservedPhases) and renders the child phase properly.
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

// Fund 10: the dashboard re-sorts runs on every 1s refetch, so a positional
// selection silently jumps to a different run. Re-anchor to the run that still
// carries the previously-selected id; if it is gone (e.g. deleted), clamp to the
// last row so the selection never points past the end.
export function reanchorSelection(prevId: string | undefined, rows: readonly WorkflowRun[]) {
  if (rows.length === 0) return 0
  if (prevId === undefined) return 0
  const index = rows.findIndex((run) => run.id === prevId)
  if (index >= 0) return index
  return rows.length - 1
}

// Item 19: a row in the detail view's agent panel. ctx.log entries are rendered
// as dimmed narrator rows interleaved chronologically between the agent rows of
// their phase. The old separate, 20-entry-capped Logs box is gone, along with its
// log-capping helper (the App keeps its OWN copy of that helper in
// app/components/dialog-workflow-helpers.ts — deliberately untouched).
export type WorkflowPhaseRow =
  | { type: "agent"; agent: WorkflowRun["agents"][number] }
  | { type: "log"; entry: WorkflowRun["logs"][number] }
  | { type: "result" }

// Item 19: phase membership for agents AND logs. The engine writes both with
// `phase: undefined` before the first setPhase, so phase-less items belong to the
// FIRST phase group. Previously phase-less agents were invisible in every phase
// filter and phase-less logs were duplicated under EVERY phase — both fixed here.
export function belongsToPhase(itemPhase: string | undefined, phase: string, phases: readonly string[]) {
  return itemPhase === phase || (itemPhase == null && phase === phases[0])
}

export function phaseAgents(run: WorkflowRun, phases: readonly string[], phase?: string) {
  if (!phase) return run.agents
  return run.agents.filter((agent) => belongsToPhase(agent.phase, phase, phases))
}

// The phase the run's final result row renders under: the current phase when it
// is part of the list, else the last phase.
export function resultPhase(run: WorkflowRun, phases: readonly string[]) {
  if (run.result === undefined) return
  if (run.current_phase && phases.includes(run.current_phase)) return run.current_phase
  return phases.at(-1)
}

function rowTime(row: WorkflowPhaseRow) {
  // Defensive: an item without a usable time sorts to the phase's end.
  if (row.type === "agent") return timestamp(row.agent.started_at) ?? Number.POSITIVE_INFINITY
  if (row.type === "log") return timestamp(row.entry.time) ?? Number.POSITIVE_INFINITY
  return Number.POSITIVE_INFINITY
}

// Item 19: the rows of one phase group — agent rows and (unless includeLogs is
// false) narrator log rows, stably sorted by time. Agents are listed before logs
// in the pre-sort array, so an ES-stable sort keeps an agent ahead of a log on a
// timestamp tie and preserves the original order within each kind. The result
// row (if this phase carries it) always stays last.
export function phaseRows(
  run: WorkflowRun,
  phases: readonly string[],
  phase: string | undefined,
  options?: { includeLogs?: boolean },
): WorkflowPhaseRow[] {
  const rows: WorkflowPhaseRow[] = phaseAgents(run, phases, phase).map((agent) => ({ type: "agent", agent }))
  if (options?.includeLogs !== false) {
    const logs = phase ? run.logs.filter((entry) => belongsToPhase(entry.phase, phase, phases)) : run.logs
    rows.push(...logs.map((entry): WorkflowPhaseRow => ({ type: "log", entry })))
  }
  rows.sort((a, b) => rowTime(a) - rowTime(b))
  if (phase && phase === resultPhase(run, phases)) rows.push({ type: "result" })
  return rows
}

// Item 19: narrator log rows are not selectable. The initial selection lands on
// the first non-log row; with only logs in the phase it stays at 0 (every action
// guard then no-ops).
export function firstSelectableRow(rows: readonly WorkflowPhaseRow[]): number {
  const index = rows.findIndex((row) => row.type !== "log")
  return index === -1 ? 0 : index
}

// Item 19: cyclic step to the next/previous non-log row; when no selectable row
// exists, the current index is returned unchanged.
export function stepSelectableRow(rows: readonly WorkflowPhaseRow[], current: number, direction: 1 | -1): number {
  if (rows.length === 0) return current
  let index = current
  for (let step = 0; step < rows.length; step++) {
    index = (index + direction + rows.length) % rows.length
    if (rows[index]?.type !== "log") return index
  }
  return current
}

// Event-driven dashboard refresh (Spec §5.2, Delta 10): a workflow.run.* event
// carries a lean wire shape (status/current_phase/error), not the full run with
// its agents. Overlay only those fields onto the matching run so the list updates
// instantly without waiting for the ≤1s poll. An event for a run not in the list
// returns the SAME reference (identity-stable: no re-render churn) — a full
// refetch picks up the genuinely-new run. Agent detail comes from the refetch,
// not the lean event.
export function mergeRunEvent(runs: WorkflowRun[], event: WorkflowRunEvent): WorkflowRun[] {
  const index = runs.findIndex((run) => run.id === event.run.id)
  if (index === -1) return runs
  const next = runs.slice()
  next[index] = {
    ...next[index],
    status: event.run.status,
    ...(event.run.current_phase !== undefined && { current_phase: event.run.current_phase }),
    ...(event.run.error !== undefined && { error: event.run.error }),
  }
  return next
}

// Dashboard waiting badge (Spec §5.2 (4)): a run that has asked a question and is
// still running or parked (paused) shows the hourglass so the operator can spot
// it needs an answer. Any other state (no pending question, or terminal) shows no
// badge. Reads `pending_question` directly off the generated WorkflowRun type.
export function questionBadge(run: WorkflowRun): "⏳" | "" {
  if (!run.pending_question) return ""
  if (run.status === "running" || run.status === "paused") return "⏳"
  return ""
}

// Item 9: pure display derivation for the `workflow` permission prompt. The
// tool's ask metadata carries name (sanitized, also the pattern/`always` key),
// display_name + description (from the statically parsed meta, display only),
// action ("start"/"create"), args, and background. metadata is untrusted
// Record<string, unknown> (possibly from an older server), so every field is
// type-checked defensively — missing/empty metadata degrades to a generic
// title, never a crash.
export function workflowPermissionDisplay(metadata: Record<string, unknown> | undefined): {
  title: string
  description?: string
  commandName?: string
  args: [string, string][]
  background: boolean
} {
  const meta = metadata ?? {}
  const name = typeof meta["name"] === "string" && meta["name"] ? meta["name"] : "workflow"
  const displayName =
    typeof meta["display_name"] === "string" && meta["display_name"] ? meta["display_name"] : undefined
  const action = meta["action"] === "create" ? "Create" : "Start"
  const description = typeof meta["description"] === "string" && meta["description"] ? meta["description"] : undefined
  const args =
    typeof meta["args"] === "object" && meta["args"] !== null && !Array.isArray(meta["args"])
      ? Object.entries(meta["args"] as Record<string, unknown>).map(
          ([key, value]) => [key, String(value)] as [string, string],
        )
      : []
  return {
    title: `${action} workflow: ${displayName ?? name}`,
    description,
    // The command/file name reads as a secondary line only when the display name
    // actually differs from it.
    commandName: displayName && displayName !== name ? name : undefined,
    args,
    background: meta["background"] === true,
  }
}

// Item 9: meta.phases entries are string | {title, …} (structured phases carry
// detail/model). Normalize to the title strings — exactly like runPhases in
// dialog-workflow.tsx, which Item 14 will converge onto this helper. Rendering
// the raw entry produced "[object Object]" for structured phases.
export function phaseTitles(phases: readonly (string | { title: string })[] | undefined): string[] {
  return (phases ?? []).map((phase) => (typeof phase === "string" ? phase : phase.title))
}

// Item 14: a phase entry in the detail view's phase panel — `child: true` marks
// a phase observed from a nested ctx.workflow child (rendered indented with '↳').
export type RunPhaseEntry = { title: string; child: boolean }

// Item 14: the engine attributes ctx.workflow children purely by prefixing their
// current_phase/log/agent phases with '<child-name>: ' (engine logPrefix), so a
// title matching /^.+?: ./ reads as a child phase. HEURISTIC until the engine
// persists a structured child field on LogEntry/AgentNode (the engine half of
// roadmap item 14) — switch to that field once it lands. Known limit: a parent
// setPhase containing ': ' (e.g. 'Deploy: prod') is also rendered as a child;
// that only affects the '↳'+indent optics, never behavior.
export function isChildPhaseTitle(title: string): boolean {
  return /^.+?: ./.test(title)
}

// Item 14 (BUG): the detail view used to build its phase list ONLY from the
// declared meta.phases, but observed phases — child-workflow phases ('<name>: x')
// and undeclared parent setPhase titles — never match a declared title, so their
// agents/logs were completely invisible. Merge them in:
//   - declared phases stay in DECLARED order (the canonical plan, never re-sorted)
//     and are always child:false;
//   - every observed-but-undeclared phase ("extra") is inserted chronologically by
//     its first observation: behind the last declared phase whose own first
//     observation is <= the extra's (and behind earlier extras of that anchor);
//     without such an anchor it is appended at the end;
//   - run.current_phase with no log/agent observation yet sorts last (+Infinity);
//   - declared == [] degrades to all observed phases in chronological order
//     (covers the old no-declaration branch).
export function mergeObservedPhases(declared: readonly string[], run: WorkflowRun): RunPhaseEntry[] {
  // First observation per exact phase string; the minimum over logs and agents wins.
  const firstSeen = new Map<string, number>()
  const observe = (phase: string | undefined, time: number | undefined) => {
    if (!phase) return
    const at = time ?? Number.POSITIVE_INFINITY
    const prev = firstSeen.get(phase)
    if (prev === undefined || at < prev) firstSeen.set(phase, at)
  }
  for (const entry of run.logs) observe(entry.phase, timestamp(entry.time))
  for (const agent of run.agents) observe(agent.phase, timestamp(agent.started_at))
  if (run.current_phase && !firstSeen.has(run.current_phase)) {
    firstSeen.set(run.current_phase, Number.POSITIVE_INFINITY)
  }

  const declaredSet = new Set(declared)
  const extras = [...firstSeen.keys()].filter((phase) => !declaredSet.has(phase))
  // Chronological by first observation; Array.prototype.sort is stable, so ties
  // keep the first-observation (logs, then agents, then current_phase) order.
  extras.sort((a, b) => firstSeen.get(a)! - firstSeen.get(b)!)

  const result: RunPhaseEntry[] = declared.map((title) => ({ title, child: false }))
  for (const title of extras) {
    const at = firstSeen.get(title)!
    // Anchor = LAST declared phase whose own first observation is <= the extra's.
    let anchor = -1
    for (let i = 0; i < declared.length; i++) {
      const seen = firstSeen.get(declared[i])
      if (seen !== undefined && seen <= at) anchor = i
    }
    const entry: RunPhaseEntry = { title, child: isChildPhaseTitle(title) }
    if (anchor === -1) {
      // No anchor: the extra precedes every observed declared phase (or no
      // declared phase was ever observed) — append, never re-sort the plan.
      result.push(entry)
      continue
    }
    // Insert directly behind the anchor and behind earlier-inserted extras of the
    // same anchor (extras are processed in ascending firstSeen order).
    let index = result.findIndex((item) => item.title === declared[anchor]) + 1
    while (index < result.length && !declaredSet.has(result[index].title)) index++
    result.splice(index, 0, entry)
  }
  return result
}

export type WorkflowCommand = { type: "dashboard" } | { type: "start"; name: string; args: string }

// Fund 59: dispatch `/workflows ...` to the dashboard and `/workflow <name> ...`
// to a start. Splitting only on whitespace is not enough because `/workflows`
// has `/workflow` as a prefix, so `/workflows foo` used to be parsed as starting
// a workflow literally named `workflows`. Anchor on the exact first token.
// Fund 60: the start remainder is the RAW substring after the name (multiple
// spaces preserved) so `msg="hello   world"` survives intact to parseWorkflowArgs.
// Save-as-command: a run's persisted `definition.source` can be written to disk
// as a real workflow file under the project or global workflows dir. The file
// base is the workflow name, but a name is untrusted (it is just whatever the
// run carries), so it MUST be sanitized before it becomes a path: a name with a
// slash or `..` could escape the workflows dir. Returns the trimmed name when it
// is a single safe path segment, or `undefined` when it must be rejected (empty,
// contains a path separator, or is a `.`/`..` traversal segment). The caller
// surfaces a warning on `undefined` and never writes.
export function sanitizeWorkflowFilename(name: string): string | undefined {
  const trimmed = name.trim()
  if (!trimmed) return undefined
  if (trimmed === "." || trimmed === "..") return undefined
  if (/[\\/]/.test(trimmed)) return undefined
  return trimmed
}

// Resolves the two save destinations for a workflow file named `name` (already
// sanitized by the caller): `<projectDir>/.opencode/workflows/<name>.ts` and
// `<globalDir>/workflows/<name>.ts`. `globalDir` is the global config dir
// (Global.Path.config), matching where discovery globs global workflows from, so
// a file saved to the global target is discoverable on the next list().
export function saveTargets(projectDir: string, globalDir: string, name: string) {
  return {
    project: path.join(projectDir, ".opencode", "workflows", `${name}.ts`),
    global: path.join(globalDir, "workflows", `${name}.ts`),
  }
}

export function parseWorkflowCommand(input: string): WorkflowCommand | undefined {
  const firstLine = input.split("\n")[0]
  const command = firstLine.trimStart().split(/\s/)[0]
  if (command === "/workflows") return { type: "dashboard" }
  if (command !== "/workflow") return
  const remainder = firstLine.trimStart().slice(command.length).trimStart()
  if (!remainder) return { type: "dashboard" }
  const nameEnd = remainder.search(/\s/)
  if (nameEnd === -1) return { type: "start", name: remainder, args: "" }
  return { type: "start", name: remainder.slice(0, nameEnd), args: remainder.slice(nameEnd + 1) }
}

// Item 30: a typed `/<name> args` submit is a DIRECT workflow start candidate
// (Claude-Code parity with the `/` popover entries, which already insert the
// routed `/workflow <name> ` text on selection). Pure parse only — the caller
// owns precedence (a real command of the same name always wins) and resolution
// against the discovered workflows; an unresolved name falls back to a plain
// prompt exactly as today. Like parseWorkflowCommand, only the FIRST line is
// parsed; the first token must be `/` + a discovery-safe name (the basename
// charset workflow files can actually carry), and the /workflow[s] dispatch
// words are excluded so this can never shadow the dedicated routes above.
// `args` is the RAW remainder after the name (multi-spaces preserved, Fund 60)
// so quoted values survive intact to parseWorkflowArgs.
export function parseDirectWorkflowCommand(input: string): { name: string; args: string } | undefined {
  const firstLine = input.split("\n")[0]
  const trimmed = firstLine.trimStart()
  const name = trimmed.split(/\s/)[0].match(/^\/([A-Za-z0-9_-]+)$/)?.[1]
  if (name === undefined || name === "workflow" || name === "workflows") return
  const nameEnd = trimmed.search(/\s/)
  if (nameEnd === -1) return { name, args: "" }
  return { name, args: trimmed.slice(nameEnd + 1) }
}
