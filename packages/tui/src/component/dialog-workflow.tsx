import { TextAttributes, type ScrollBoxRenderable, type TextareaRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import type { WorkflowInfo, WorkflowRun } from "@opencode-ai/sdk/v2"
import { Locale } from "../util/locale"
import { Global } from "@opencode-ai/core/global"
import { useProject } from "../context/project"
import { useRoute } from "../context/route"
import { useSDK } from "../context/sdk"
import { useEvent } from "../context/event"
import { selectedForeground, useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import fs from "fs/promises"
import path from "path"
import { useBindings } from "../keymap"
import { DialogConfirm } from "../ui/dialog-confirm"
import * as Clipboard from "../clipboard"
import { getScrollAcceleration } from "../util/scroll"
import {
  firstSelectableRow,
  formatPhase,
  formatShortElapsed,
  mergeObservedPhases,
  phaseIcon,
  phaseRows,
  phaseStatus,
  phaseTitles,
  questionBadge,
  reanchorSelection,
  resultPhase,
  sanitizeWorkflowFilename,
  saveTargets,
  spentThisMonth,
  statusIcon,
  stepSelectableRow,
  timestamp,
  type WorkflowPhaseRow,
} from "./dialog-workflow-helpers"
import { asWorkflowRunEvent } from "./dialog-workflow-client"
import { DialogWorkflowQuestion } from "./dialog-workflow-question"

// Re-exported so existing pure derivations keep a single import surface.
export { phaseStatus } from "./dialog-workflow-helpers"

function formatShortDuration(run: WorkflowRun) {
  return formatShortElapsed(run.started_at, run.completed_at)
}

function formatStartedShort(value: unknown) {
  const time = timestamp(value)
  if (time === undefined) return "--"
  const date = new Date(time)
  return `${(date.getMonth() + 1).toString().padStart(2, "0")}-${date.getDate().toString().padStart(2, "0")} ${date
    .getHours()
    .toString()
    .padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}`
}

function formatLogTime(value: unknown) {
  const time = timestamp(value)
  if (time === undefined) return "--:--:--"
  const date = new Date(time)
  return `${date.getHours().toString().padStart(2, "0")}:${date.getMinutes().toString().padStart(2, "0")}:${date
    .getSeconds()
    .toString()
    .padStart(2, "0")}`
}

function agentIcon(status: WorkflowRun["agents"][number]["status"]) {
  if (status === "running") return "●"
  if (status === "completed") return "✔"
  return "✖"
}

// Fund 34 (TUI defensive): the engine now closes every agent node at a terminal
// transition (N11) and the orphan sweep normalizes zombies (Fund 15), so a
// terminal run should not carry a `running` agent. Still, render defensively: if
// a terminal run ever shows a lingering `running` agent, treat it as terminal so
// no perpetual live `●` icon appears, and clamp its elapsed time to the run's
// completion instead of `formatShortElapsed`'s `Date.now()` fallback (which made
// the duration grow on every open). Live runs are unchanged.
export function agentEffectiveStatus(run: WorkflowRun, agent: WorkflowRun["agents"][number]) {
  if (run.status !== "running" && agent.status === "running") return "failed"
  return agent.status
}

export function agentEffectiveEnd(run: WorkflowRun, agent: WorkflowRun["agents"][number]) {
  // A real node end always wins. Otherwise, on a terminal run, clamp to the run's
  // completion so the duration is frozen rather than ticking up from Date.now().
  return agent.completed_at ?? (run.status !== "running" ? run.completed_at : undefined)
}

// Item 14: the phase list is the declared plan (meta.phases, normalized to title
// strings via phaseTitles) MERGED with every observed phase — child-workflow
// phases ('<name>: x') and undeclared parent setPhase titles used to never match
// a declared phase, leaving their agents/logs invisible in the detail view. The
// return type stays string[]: every consumer (phaseStatus/indexOf, selectedPhase,
// phaseRows, phaseProgress, initial selection) keeps working on plain titles; the
// child flag is re-derived where needed (childPhases memo). Exported for tests.
export function runPhases(run: WorkflowRun, workflow?: WorkflowInfo) {
  const phases = mergeObservedPhases(phaseTitles(workflow?.meta.phases), run).map((entry) => entry.title)
  return phases.length ? phases : [run.status === "completed" ? "complete" : (run.current_phase ?? "pending")]
}

function runUsage(run: WorkflowRun) {
  const cost = run.agents.reduce((total, agent) => total + (agent.cost ?? 0), 0)
  const tokens = run.agents.reduce(
    (total, agent) => ({
      input: total.input + (agent.tokens?.input ?? 0),
      output: total.output + (agent.tokens?.output ?? 0),
      reasoning: total.reasoning + (agent.tokens?.reasoning ?? 0),
      cache: total.cache + (agent.tokens?.cache.read ?? 0) + (agent.tokens?.cache.write ?? 0),
      total:
        total.total +
        (agent.tokens?.total ?? (agent.tokens ? agent.tokens.input + agent.tokens.output + agent.tokens.reasoning : 0)),
    }),
    { input: 0, output: 0, reasoning: 0, cache: 0, total: 0 },
  )
  return { cost, tokens }
}

function formatTokens(value: number) {
  if (value <= 0) return "--"
  return new Intl.NumberFormat().format(value)
}

function formatShortTokens(value: number) {
  if (value <= 0) return "--"
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 100_000 ? 0 : 1).replace(/\.0$/, "")}k`
  return value.toString()
}

function formatCost(value: number) {
  if (value <= 0) return "--"
  return `$${value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`
}

function agentTokens(agent: WorkflowRun["agents"][number]) {
  return agent.tokens?.total ?? (agent.tokens ? agent.tokens.input + agent.tokens.output + agent.tokens.reasoning : 0)
}

// Item 19: a narrator log row is never selectable, so every row-detail helper
// below only deals with the agent/result variants.
type SelectablePhaseRow = Exclude<WorkflowPhaseRow, { type: "log" }>

// Exported for tests (pattern: agentEffectiveStatus/runPhases).
export function phaseProgress(run: WorkflowRun, phases: readonly string[], phase: string) {
  // Item 19: narrator log rows count in neither numerator nor denominator.
  const counted = phaseRows(run, phases, phase, { includeLogs: false })
  if (counted.length === 0) return ""
  const done = counted.filter(
    (row) => row.type === "result" || (row.type === "agent" && row.agent.status !== "running"),
  )
  return `${done.length}/${counted.length}`
}

function agentProgress(run: WorkflowRun) {
  if (run.agents.length === 0) return "0 agents"
  return `${run.agents.filter((agent) => agent.status !== "running").length}/${run.agents.length} agents`
}

// Item 16: a per-call display name (`ctx.agent({label})`, persisted on the
// node) wins over the subagent type name; a node with neither falls back to its
// id. Label is display-only — selection, session-open, and the journal key all
// keep working off the node itself. Exported for tests (pattern: phaseProgress).
export function agentLabel(agent: WorkflowRun["agents"][number]) {
  return agent.label ?? agent.agent ?? `agent:${agent.id}`
}

function modelLabel(agent: WorkflowRun["agents"][number]) {
  if (!agent.model) return "default"
  const model = agent.model.split("/").at(-1) ?? agent.model
  return model.replace(/^claude-/, "Claude ").replace(/-/g, " ")
}

function agentMetrics(run: WorkflowRun, agent: WorkflowRun["agents"][number]) {
  return [
    agentTokens(agent) > 0 ? `${formatShortTokens(agentTokens(agent))} tok` : undefined,
    agent.cost && agent.cost > 0 ? formatCost(agent.cost) : undefined,
    // Fund 34: clamp the end to the run's completion on a terminal run so a
    // lingering node's duration is frozen instead of ticking up from Date.now().
    formatShortElapsed(agent.started_at, agentEffectiveEnd(run, agent)),
  ]
    .filter((item) => item !== undefined)
    .join(" · ")
}

function phaseRowLabel(row: SelectablePhaseRow) {
  if (row.type === "result") return "workflow:result"
  return agentLabel(row.agent)
}

function phaseRowModel(row: SelectablePhaseRow) {
  if (row.type === "result") return "local workflow"
  return modelLabel(row.agent)
}

function phaseRowMetrics(run: WorkflowRun, row: SelectablePhaseRow) {
  if (row.type === "result") return `0 tok · ${formatShortDuration(run)}`
  return agentMetrics(run, row.agent)
}

function phaseRowIcon(run: WorkflowRun, row: SelectablePhaseRow) {
  if (row.type === "result") return "✔"
  // Fund 34: a lingering `running` agent on a terminal run renders terminal
  // (never the live `●`), so a finished run never shows a perpetually-live agent.
  return agentIcon(agentEffectiveStatus(run, row.agent))
}

function phaseRowTitle(phase: string | undefined, rows: readonly WorkflowPhaseRow[]) {
  const agents = rows.filter((row) => row.type === "agent").length
  const result = rows.some((row) => row.type === "result")
  if (!result) return `${phase ?? "Phase"} · ${agents} agents`
  if (agents === 0) return `${phase ?? "Phase"} · result`
  return `${phase ?? "Phase"} · ${agents} agents + result`
}

function workflowResultText(result: unknown) {
  if (typeof result === "string") return result
  if (result && typeof result === "object" && "summary" in result && typeof result.summary === "string") {
    return result.summary
  }
  return JSON.stringify(result, null, 2) ?? String(result)
}

function wrapResultText(result: unknown, width: number) {
  const limit = Math.max(20, width)
  return workflowResultText(result)
    .split("\n")
    .flatMap((line) => {
      if (line.length === 0) return [""]
      const chunks = [] as string[]
      let rest = line
      while (rest.length > limit) {
        const index = rest.lastIndexOf(" ", limit) > 0 ? rest.lastIndexOf(" ", limit) : limit
        chunks.push(rest.slice(0, index))
        rest = rest.slice(index).trimStart()
      }
      chunks.push(rest)
      return chunks
    })
}

function fitColumns(left: string, right: string, width: number) {
  const size = Math.max(1, width)
  if (!right) return Locale.truncate(left, size)
  const suffix = Locale.truncate(right, size)
  const prefix = Locale.truncate(left, Math.max(1, size - suffix.length - 1))
  return `${prefix.padEnd(Math.max(0, size - suffix.length - 1))} ${suffix}`
}

function fitCell(value: string, width: number, align: "left" | "right" = "left") {
  const text = Locale.truncate(value, Math.max(1, width))
  return align === "right" ? text.padStart(width) : text.padEnd(width)
}

function shortRunID(run: WorkflowRun) {
  return `#${run.id.replace(/^job_/, "").slice(-8)}`
}

function statusLabel(status: WorkflowRun["status"]) {
  if (status === "completed") return "done"
  if (status === "cancelled") return "cancel"
  if (status === "interrupted") return "interrupt"
  return status
}

function dashboardPhase(run: WorkflowRun, workflow?: WorkflowInfo) {
  if (run.status !== "running") return run.status === "completed" ? "complete" : (run.current_phase ?? run.status)
  return formatPhase(run, workflow)
}

// Funds 57, 58: the STATUS cell must fit "⊘ interrupt" (icon + space + the 9-char
// "interrupt" label) without truncation, so the cell is 11 wide and the layout
// budget reserves 12 for it (cell + its separator space). Previously the cell was
// 8 wide and "interrupt" was clipped to "interr…".
const STATUS_WIDTH = 11

function dashboardWidths(width: number) {
  const total = Math.min(width, 150)
  const phase = total < 104 ? 8 : 12
  const fixed = 2 + 10 + (STATUS_WIDTH + 1) + 11 + 7 + phase + 8 + 8
  const available = Math.max(28, total - fixed)
  const workflow = Math.min(26, Math.max(14, Math.floor(available * 0.38)))
  return { workflow, phase, input: Math.max(14, available - workflow), total }
}

function workflowInput(run: WorkflowRun) {
  if (!run.args || Object.keys(run.args).length === 0) return "--"
  return Object.entries(run.args)
    .map(([key, value]) => `${key}=${formatInputValue(value)}`)
    .join(" ")
}

function formatInputValue(value: unknown) {
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (value === null) return "null"
  return JSON.stringify(value) ?? String(value)
}

function dashboardRowText(
  input: {
    marker: string
    id: string
    workflow: string
    input: string
    status: string
    started: string
    duration: string
    phase: string
    tokens: string
  },
  width: number,
) {
  const columns = dashboardWidths(width)
  return Locale.truncate(
    [
      fitCell(input.marker, 2),
      fitCell(input.id, 10),
      fitCell(input.workflow, columns.workflow),
      fitCell(input.status, STATUS_WIDTH),
      fitCell(input.started, 12),
      fitCell(input.duration, 7),
      fitCell(input.phase, columns.phase),
      fitCell(input.tokens, 8),
      fitCell(input.input, columns.input),
    ].join(" "),
    columns.total,
  )
}

function sectionTitle(title: string, width: number) {
  return ` ${title} ${"─".repeat(Math.max(0, width - title.length - 2))}`
}

function scrollIndexIntoView(scroll: ScrollBoxRenderable | undefined, index: number) {
  if (!scroll) return
  if (index < scroll.scrollTop) scroll.scrollBy(index - scroll.scrollTop)
  if (index >= scroll.scrollTop + scroll.height) scroll.scrollBy(index - scroll.scrollTop - scroll.height + 1)
}

export function DialogWorkflow(props?: { openRunID?: string; openPhase?: string; openAgentID?: string }) {
  const dialog = useDialog()
  const route = useRoute()
  const sdk = useSDK()
  const events = useEvent()
  const toast = useToast()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  dialog.setSize("fullscreen")

  // Selection is anchored on a run.id, not an index: the runs list re-sorts on
  // every poll, so a positional selection would silently jump to a different run.
  const [store, setStore] = createStore({ selected: 0, selectedID: "" })
  let scroll: ScrollBoxRenderable | undefined

  // N17: workflow.list() is the static definition discovery and only changes when
  // files change, so it is fetched once on open (and on explicit refresh) rather
  // than re-run every second. Only the runs are polled.
  const [workflowsResource, { refetch: refetchWorkflows }] = createResource(async () => {
    const result = await sdk.client.workflow.list()
    return result.data ?? []
  })
  const [runsResource, { refetch }] = createResource(async () => {
    const result = await sdk.client.workflow.runs()
    return (result.data ?? []).toSorted((a, b) => (timestamp(b.started_at) ?? 0) - (timestamp(a.started_at) ?? 0))
  })
  const runs = createMemo(() => runsResource() ?? [])
  const workflows = createMemo(() => workflowsResource() ?? [])
  const selected = createMemo(() => runs()[store.selected])
  const activeWorkers = createMemo(() => runs().filter((run) => run.status === "running").length)
  const tableWidth = createMemo(() => Math.max(40, dimensions().width - 5))
  const monthlySpend = createMemo(() => spentThisMonth(runs()))

  // Fund 10: re-anchor the selection to the row that still carries the previously
  // selected id after each re-sort, clamping when that run is gone (e.g. deleted).
  createEffect(() => {
    const next = reanchorSelection(store.selectedID || selected()?.id, runs())
    if (next !== store.selected) setStore("selected", next)
    const id = runs()[next]?.id ?? ""
    if (id !== store.selectedID) setStore("selectedID", id)
  })

  let openedInitial = false
  createEffect(() => {
    if (openedInitial) return
    if (!props?.openRunID) return
    // N18: a deep-link must open the run even when no workflow definitions are
    // discovered (the run itself is enough); previously the missing-definitions
    // guard made the deep-link silently fail.
    const run = runs().find((item) => item.id === props.openRunID)
    if (!run) return
    openedInitial = true
    dialog.replace(
      () => (
        <DialogWorkflowRun
          id={run.id}
          initial={run}
          workflows={workflows()}
          initialPhase={props.openPhase}
          initialAgentID={props.openAgentID}
        />
      ),
      undefined,
      {
        notifyClose: false,
      },
    )
  })

  onMount(() => {
    // QW1 (Spec §5.2 (1)): subscribe to workflow.run.updated/finished so the
    // dashboard refreshes instantly on a server that emits them. The 1s poll
    // below STAYS as the degraded-but-correct fallback against an older server
    // that does not (Delta 10) — a double read is harmless (only network).
    const off = events.subscribe((evt) => {
      if (!asWorkflowRunEvent(evt)) return
      void refetch()
    })
    onCleanup(off)
  })

  onMount(() => {
    const interval = setInterval(() => void refetch(), 1000)
    onCleanup(() => clearInterval(interval))
  })

  function workflow(run: WorkflowRun) {
    return workflows().find((item) => item.name === run.workflow)
  }

  function move(direction: number) {
    if (runs().length === 0) return
    const next = Math.max(0, Math.min(runs().length - 1, store.selected + direction))
    setStore("selected", next)
    setStore("selectedID", runs()[next]?.id ?? "")
    if (!scroll) return
    if (next < scroll.scrollTop) scroll.scrollBy(next - scroll.scrollTop)
    if (next >= scroll.scrollTop + scroll.height) scroll.scrollBy(next - scroll.scrollTop - scroll.height + 1)
  }

  function selectIndex(index: number) {
    setStore("selected", index)
    setStore("selectedID", runs()[index]?.id ?? "")
  }

  function openSelected() {
    const run = selected()
    if (!run) return
    dialog.replace(
      () => <DialogWorkflowRun id={run.id} initial={run} workflows={workflows()} />,
      () => {
        dialog.replace(() => <DialogWorkflow />, undefined, { notifyClose: false })
        return false
      },
    )
  }

  function cancelSelected() {
    const run = selected()
    if (!run || run.status !== "running") return
    void sdk.client.workflow
      .cancel({ id: run.id })
      .then(() => {
        toast.show({ message: `Killed workflow ${run.id}`, variant: "info" })
        void refetch()
      })
      .catch(toast.error)
  }

  // Track B: `p` pauses a running run (keeping its journal) and resumes a
  // paused/interrupted one (a fresh run that replays the journal via resume_of).
  // No-op for completed/failed/cancelled runs — nothing to do.
  function pauseOrResumeSelected() {
    const run = selected()
    if (!run) return
    if (run.status === "running") {
      void sdk.client.workflow
        .pause({ id: run.id })
        .then(() => {
          toast.show({ message: `Paused workflow ${run.id}`, variant: "info" })
          void refetch()
        })
        .catch(toast.error)
      return
    }
    if (run.status === "paused" || run.status === "interrupted") {
      void sdk.client.workflow
        .start({ name: run.workflow, workflowStartPayload: { resume_of: run.id } })
        .then((result) => {
          if (!result.data) {
            toast.show({ message: `Failed to resume workflow ${run.id}`, variant: "error" })
            return
          }
          toast.show({ message: `Resumed workflow ${run.workflow}`, variant: "info" })
          void refetch()
        })
        .catch(toast.error)
    }
  }

  // Spec §5.2 (4): answer the selected run's pending question, read straight off
  // the generated `WorkflowRun.pending_question`. Live runs resolve in place; a
  // parked (paused) run spawns a NEW resume run, and we then follow that new id
  // into its detail view. The dialog replaces the dashboard, so we re-open the
  // dashboard whichever way it resolves.
  async function answerSelected() {
    const run = selected()
    if (!run || !run.pending_question) return
    const sessionID = route.data.type === "session" ? route.data.sessionID : undefined
    const resumeRunID = await DialogWorkflowQuestion.show(dialog, { run, sessionID })
    if (resumeRunID) {
      // Follow the freshly-spawned resume run into its detail view. Fetch it once
      // so the detail view has an `initial` to render before its own poll/event
      // refetch arrives; fall back to the dashboard if the run is not retrievable.
      const resumed = await sdk.client.workflow.get({ id: resumeRunID }).then(
        (r) => r.data,
        () => undefined,
      )
      if (resumed) {
        dialog.replace(
          () => <DialogWorkflowRun id={resumeRunID} initial={resumed} workflows={workflows()} />,
          undefined,
          { notifyClose: false },
        )
        return
      }
    }
    dialog.replace(() => <DialogWorkflow />, undefined, { notifyClose: false })
    void refetch()
  }

  // Fund 10 (behavior change): deleting a run from history is irreversible, so it
  // now asks for confirmation first. DialogConfirm.show replaces the dashboard, so
  // the dashboard is re-opened afterwards whichever way the prompt resolves.
  async function deleteSelected() {
    const run = selected()
    if (!run) return
    const reopen = () => dialog.replace(() => <DialogWorkflow />, undefined, { notifyClose: false })
    const confirmed = await DialogConfirm.show(
      dialog,
      "Delete workflow run",
      `Delete run ${shortRunID(run)} (${run.workflow}) from history? This cannot be undone.`,
      "keep",
    )
    if (!confirmed) {
      reopen()
      return
    }
    sdk.client.workflow
      .delete({ id: run.id })
      // The endpoint returns a boolean: `false` means the row was already gone
      // (e.g. a concurrent delete), so the toast must not claim a deletion that
      // did not happen here.
      .then((result) =>
        result.data === false
          ? toast.show({ message: `Workflow ${run.id} already gone`, variant: "info" })
          : toast.show({ message: `Deleted workflow ${run.id}`, variant: "info" }),
      )
      .catch(toast.error)
      .finally(() => {
        reopen()
        void refetch()
      })
  }

  useBindings(() => ({
    bindings: [
      { key: "up,k", desc: "Previous workflow run", group: "Workflow", cmd: () => move(-1) },
      { key: "down,j", desc: "Next workflow run", group: "Workflow", cmd: () => move(1) },
      { key: "return", desc: "View workflow details", group: "Workflow", cmd: openSelected },
      { key: "r", desc: "Refresh workflows", group: "Workflow", cmd: () => void refetchWorkflows() },
      { key: "x", desc: "Kill workflow run", group: "Workflow", cmd: cancelSelected },
      { key: "a", desc: "Answer pending question", group: "Workflow", cmd: () => void answerSelected() },
      { key: "p", desc: "Pause running / resume paused run", group: "Workflow", cmd: pauseOrResumeSelected },
      { key: "d", desc: "Delete workflow run from history", group: "Workflow", cmd: () => void deleteSelected() },
      { key: "b", desc: "Exit workflows dashboard", group: "Workflow", cmd: () => dialog.clear() },
    ],
  }))

  return (
    <box
      width={dimensions().width}
      height={dimensions().height - 1}
      paddingLeft={2}
      paddingRight={2}
      paddingBottom={1}
      gap={1}
    >
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          OpenCode Workflows
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <text fg={theme.textMuted}>Select a run and press [Enter] to inspect phases, agents, and results.</text>
      <text fg={theme.textMuted} wrapMode="none" overflow="hidden">
        {dashboardRowText(
          {
            marker: "",
            id: "RUN",
            workflow: "WORKFLOW",
            input: "INPUT",
            status: "STATUS",
            started: "STARTED",
            duration: "DUR",
            phase: "PHASE",
            tokens: "TOKENS",
          },
          tableWidth(),
        )}
      </text>
      <text fg={theme.textMuted}>{"─".repeat(tableWidth())}</text>

      <scrollbox
        ref={(element: ScrollBoxRenderable) => (scroll = element)}
        flexGrow={1}
        minHeight={0}
        verticalScrollbarOptions={{ visible: true }}
        horizontalScrollbarOptions={{ visible: false }}
        scrollAcceleration={getScrollAcceleration()}
      >
        <For
          each={runs()}
          fallback={
            <box paddingTop={1}>
              <text fg={theme.textMuted}>
                No workflow runs yet. Start one with /workflow workflow_name --arg=value.
              </text>
            </box>
          }
        >
          {(run, index) => {
            const active = createMemo(() => index() === store.selected)
            return (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={active() ? theme.primary : undefined}
                onMouseDown={() => selectIndex(index())}
                onMouseUp={openSelected}
              >
                <text fg={active() ? selectedForeground(theme) : theme.text} wrapMode="none" overflow="hidden">
                  {dashboardRowText(
                    {
                      // Spec §5.2 (4): a run waiting on an answer (running/parked
                      // with a pending question) shows the ⏳ badge; otherwise the
                      // selection arrow when active. The marker cell is 2 wide.
                      marker: questionBadge(run) || (active() ? "›" : ""),
                      id: shortRunID(run),
                      workflow: run.workflow,
                      input: workflowInput(run),
                      status: `${statusIcon(run.status)} ${statusLabel(run.status)}`,
                      started: formatStartedShort(run.started_at),
                      duration: formatShortDuration(run),
                      phase: dashboardPhase(run, workflow(run)),
                      tokens: formatShortTokens(runUsage(run).tokens.total),
                    },
                    tableWidth(),
                  )}
                </text>
              </box>
            )
          }}
        </For>
      </scrollbox>

      <text fg={theme.textMuted}>{"─".repeat(tableWidth())}</text>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>
          Spent this month: {formatCost(monthlySpend())} | Active Background Workers: {activeWorkers()}
        </text>
        <text fg={theme.textMuted}>
          [Enter] View Details | [A] Answer | [R] Refresh | [X] Kill | [D] Delete history | [Esc]/[B] Exit
        </text>
      </box>
    </box>
  )
}

// Save-as-command (dashboard `s` in the run detail): writes a run's persisted
// `definition.source` to disk as a real workflow file so it becomes a
// rediscoverable `/<name>` command. The name is prefilled from the run's
// workflow; Tab toggles the destination between the project `.opencode/workflows`
// dir and the global config workflows dir. A name colliding with an existing file
// at the chosen destination is a hard warning — NEVER an overwrite. A run without
// a captured source (older/temporary runs) cannot be saved.
function DialogWorkflowSave(props: { run: WorkflowRun; onClose: () => void }) {
  const dialog = useDialog()
  const toast = useToast()
  const project = useProject()
  const { theme } = useTheme()
  const [target, setTarget] = createSignal<"project" | "global">("project")
  const [textareaTarget, setTextareaTarget] = createSignal<TextareaRenderable>()
  let textarea: TextareaRenderable

  const source = props.run.definition?.source
  // The project root for `.opencode/workflows` is the worktree when set, else the
  // instance directory (matches the engine's projectConfigDir resolution).
  const projectDir = () => project.instance.path().worktree || project.instance.path().directory
  const globalDir = () => project.instance.path().config || Global.Path.config

  async function save() {
    if (!source) {
      toast.show({ message: "This run has no captured source to save", variant: "error" })
      return
    }
    const name = sanitizeWorkflowFilename(textarea.plainText)
    if (!name) {
      toast.show({ message: "Invalid workflow name (no slashes, '..', or empty)", variant: "error" })
      return
    }
    const targets = saveTargets(projectDir(), globalDir(), name)
    const file = target() === "project" ? targets.project : targets.global
    // Collision is a hard stop: never silently overwrite an existing file.
    if (await Bun.file(file).exists()) {
      toast.show({ message: `A workflow named ${name} already exists at this destination`, variant: "error" })
      return
    }
    await fs.mkdir(path.dirname(file), { recursive: true }).catch(() => {})
    const wrote = await Bun.write(file, source).then(
      () => true,
      () => false,
    )
    if (!wrote) {
      toast.show({ message: `Failed to write ${file}`, variant: "error" })
      return
    }
    toast.show({ message: `Saved workflow ${name} to ${target()}`, variant: "success" })
    // Return to wherever the caller wants (the run detail) instead of clearing
    // the whole stack, so the user lands back where they pressed `s`.
    props.onClose()
  }

  useBindings(() => ({
    target: textareaTarget,
    enabled: textareaTarget() !== undefined,
    priority: 1,
    bindings: [
      { key: "return", desc: "Save workflow command", group: "Dialog", cmd: () => void save() },
      {
        key: "tab",
        desc: "Toggle save destination",
        group: "Dialog",
        cmd: () => setTarget(target() === "project" ? "global" : "project"),
      },
    ],
  }))

  onMount(() => {
    dialog.setSize("medium")
    setTimeout(() => {
      if (!textarea || textarea.isDestroyed) return
      textarea.focus()
      textarea.gotoLineEnd()
    }, 1)
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Save workflow as command
        </text>
        <text fg={theme.textMuted} onMouseUp={() => props.onClose()}>
          esc
        </text>
      </box>
      <Show
        when={source}
        fallback={<text fg={theme.textMuted}>This run has no captured source, so it cannot be saved.</text>}
      >
        <box gap={1}>
          <text fg={theme.textMuted}>Name (becomes /name); written to {target()}.</text>
          <textarea
            height={3}
            ref={(val: TextareaRenderable) => {
              textarea = val
              setTextareaTarget(val)
            }}
            initialValue={props.run.workflow}
            placeholder="workflow-name"
            placeholderColor={theme.textMuted}
            textColor={theme.text}
            focusedTextColor={theme.text}
            cursorColor={theme.text}
          />
          <text fg={theme.textMuted}>
            Destination: [{target() === "project" ? "x" : " "}] project .opencode/workflows [
            {target() === "global" ? "x" : " "}] global — [Tab] toggle, [Enter] save
          </text>
        </box>
      </Show>
    </box>
  )
}

function DialogWorkflowRun(props: {
  id: string
  initial: WorkflowRun
  workflows: WorkflowInfo[]
  initialPhase?: string
  initialAgentID?: string
}) {
  const dialog = useDialog()
  const route = useRoute()
  const sdk = useSDK()
  const events = useEvent()
  const toast = useToast()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()
  const [copyNotice, setCopyNotice] = createSignal(false)
  dialog.setSize("fullscreen")
  let phaseScroll: ScrollBoxRenderable | undefined
  let agentScroll: ScrollBoxRenderable | undefined
  let copyNoticeTimeout: ReturnType<typeof setTimeout> | undefined

  const [run, { refetch }] = createResource(async () => {
    const result = await sdk.client.workflow.get({ id: props.id })
    return result.data ?? props.initial
  })
  const current = createMemo(() => run() ?? props.initial)
  const workflow = createMemo(() => props.workflows.find((item) => item.name === current().workflow))
  const phases = createMemo(() => runPhases(current(), workflow()))
  // Item 14: phase titles observed from a nested ctx.workflow child ('<name>: x')
  // render indented with a '↳' marker so the parent plan stays visually primary.
  const childPhases = createMemo(
    () =>
      new Set(
        mergeObservedPhases(phaseTitles(workflow()?.meta.phases), current())
          .filter((entry) => entry.child)
          .map((entry) => entry.title),
      ),
  )
  const [store, setStore] = createStore({
    runID: "",
    selectedPhase: 0,
    selectedAgent: 0,
    resultOffset: 0,
  })
  const selectedPhase = createMemo(() => phases()[store.selectedPhase] ?? phases()[0])
  // Item 19 (was N7): ctx.log entries are no longer a separate capped Logs box —
  // phaseRows interleaves them chronologically as dimmed narrator rows between
  // the agent rows of their phase, inside the scrolling agent panel.
  const selectedPhaseRows = createMemo(() => phaseRows(current(), phases(), selectedPhase()))
  const selectedRow = createMemo(() => selectedPhaseRows()[store.selectedAgent])
  const selectedResult = createMemo(() => selectedRow()?.type === "result" && current().result !== undefined)
  const phasePanelWidth = createMemo(() => Math.min(44, Math.max(28, Math.floor((dimensions().width - 6) * 0.28))))
  const agentPanelWidth = createMemo(() => Math.max(24, dimensions().width - phasePanelWidth() - 8))
  const resultLines = createMemo(() => wrapResultText(current().result, agentPanelWidth() - 4))
  const resultBodyLines = createMemo(() => Math.max(1, dimensions().height - 14))
  const visibleResultLines = createMemo(() =>
    resultLines().slice(store.resultOffset, store.resultOffset + resultBodyLines()),
  )
  const headerWidth = createMemo(() => Math.max(20, dimensions().width - 4))
  const description = createMemo(() => {
    const summary = workflow()?.meta.description ?? `Run ${current().id.replace(/^job_/, "#")}`
    if (phases().length === 0) return summary
    return `${summary}, across ${phases().length} phases`
  })

  createEffect(() => {
    if (store.runID === current().id) return
    const initialIndex = props.initialPhase ? phases().indexOf(props.initialPhase) : -1
    const initialRows = initialIndex >= 0 ? phaseRows(current(), phases(), props.initialPhase) : []
    const initialAgentIndex = props.initialAgentID
      ? initialRows.findIndex((row) => row.type === "agent" && row.agent.id === props.initialAgentID)
      : -1
    const currentPhase = current().current_phase
    const currentIndex = currentPhase ? phases().indexOf(currentPhase) : -1
    const currentRows = currentPhase ? phaseRows(current(), phases(), currentPhase).length : 0
    const resultIndex = phases().findIndex((phase) => phase === resultPhase(current(), phases()))
    const agentIndex = phases().findIndex((phase) => current().agents.some((agent) => agent.phase === phase))
    const next =
      initialIndex >= 0
        ? initialIndex
        : currentIndex >= 0 && currentRows > 0
          ? currentIndex
          : resultIndex >= 0
            ? resultIndex
            : agentIndex
    setStore("runID", current().id)
    if (next >= 0) {
      setStore("selectedPhase", next)
      // Item 19: land on the first selectable row — a phase may open with
      // leading narrator log rows, which are never selectable.
      setStore(
        "selectedAgent",
        initialAgentIndex >= 0 ? initialAgentIndex : firstSelectableRow(phaseRows(current(), phases(), phases()[next])),
      )
      setStore("resultOffset", 0)
      return
    }
    if (store.selectedPhase >= phases().length) {
      setStore("selectedPhase", 0)
      setStore("selectedAgent", firstSelectableRow(phaseRows(current(), phases(), phases()[0])))
      setStore("resultOffset", 0)
    }
  })

  createEffect(() => {
    if (store.selectedPhase < phases().length) return
    const next = Math.max(0, phases().length - 1)
    setStore("selectedPhase", next)
    setStore("selectedAgent", firstSelectableRow(phaseRows(current(), phases(), phases()[next])))
    setStore("resultOffset", 0)
  })

  createEffect(() => {
    const rows = selectedPhaseRows()
    if (store.selectedAgent < rows.length) return
    const last = Math.max(0, rows.length - 1)
    // Item 19: when the rows shrank below the selection, land on the last
    // SELECTABLE row — a trailing narrator log row is skipped backwards.
    setStore("selectedAgent", rows[last]?.type === "log" ? stepSelectableRow(rows, last, -1) : last)
    setStore("resultOffset", 0)
  })

  createEffect(() => {
    if (!selectedResult()) return
    if (store.resultOffset <= Math.max(0, resultLines().length - resultBodyLines())) return
    setStore("resultOffset", Math.max(0, resultLines().length - resultBodyLines()))
  })

  createEffect(() => {
    const index = store.selectedPhase
    requestAnimationFrame(() => scrollIndexIntoView(phaseScroll, index))
  })

  createEffect(() => {
    const index = store.selectedAgent
    if (selectedResult()) return
    requestAnimationFrame(() => scrollIndexIntoView(agentScroll, index))
  })

  onMount(() => {
    // QW1 (Spec §5.2 (1)): refetch the detail view the moment THIS run emits an
    // updated/finished event. The 1s running-only poll below STAYS as the
    // fallback against a server that does not emit (Delta 10).
    const off = events.subscribe((evt) => {
      const wf = asWorkflowRunEvent(evt)
      if (!wf || wf.run.id !== props.id) return
      void refetch()
    })
    onCleanup(off)
  })

  onMount(() => {
    const interval = setInterval(() => {
      if (current().status === "running") void refetch()
    }, 1000)
    onCleanup(() => clearInterval(interval))
  })

  onCleanup(() => {
    if (copyNoticeTimeout) clearTimeout(copyNoticeTimeout)
  })

  const back = () => dialog.replace(() => <DialogWorkflow />, undefined, { notifyClose: false })
  const cancel = () => {
    if (current().status !== "running") return
    void sdk.client.workflow
      .cancel({ id: current().id })
      .then(() => {
        toast.show({ message: `Killed workflow ${current().id}`, variant: "info" })
        void refetch()
      })
      .catch(toast.error)
  }

  // Track B: `p` pauses a running run (journal kept) and resumes a paused/
  // interrupted one (fresh run replaying the journal via resume_of).
  const pauseOrResume = () => {
    const status = current().status
    if (status === "running") {
      void sdk.client.workflow
        .pause({ id: current().id })
        .then(() => {
          toast.show({ message: `Paused workflow ${current().id}`, variant: "info" })
          void refetch()
        })
        .catch(toast.error)
      return
    }
    if (status === "paused" || status === "interrupted") resume()
  }

  // Starts a fresh run that replays this run's journal. `invalidate` lists
  // source-agent indices (0-based) to force back to live; an empty list resumes
  // every completed agent from the journal.
  const resume = (invalidate?: number[]) => {
    void sdk.client.workflow
      .start({
        name: current().workflow,
        workflowStartPayload: { resume_of: current().id, invalidate_agents: invalidate },
      })
      .then((result) => {
        if (!result.data) {
          toast.show({ message: `Failed to resume workflow ${current().id}`, variant: "error" })
          return
        }
        toast.show({ message: `Resumed workflow ${current().workflow}`, variant: "info" })
        // Follow the new run into its own detail view so the resume is observable.
        dialog.replace(
          () => <DialogWorkflowRun id={result.data!.id} initial={result.data!} workflows={props.workflows} />,
          undefined,
          { notifyClose: false },
        )
      })
      .catch(toast.error)
  }

  // `r` on the selected agent resumes the run while forcing JUST that agent back
  // to a live re-run (its index passed in invalidate_agents); every other
  // completed agent still replays from the journal.
  const resumeInvalidatingSelectedAgent = () => {
    const row = selectedRow()
    // Item 19: only an agent row can be re-run (result and narrator log rows no-op).
    if (row?.type !== "agent") return
    const index = current().agents.findIndex((agent) => agent.id === row.agent.id)
    if (index < 0) return
    resume([index])
  }

  function openAgentSession() {
    const row = selectedRow()
    // Item 19: only an agent row has a session (result and narrator log rows no-op).
    if (row?.type !== "agent") return
    const sessionID = row.agent.session_id
    if (!sessionID) return
    route.navigate({
      type: "session",
      sessionID,
      workflowRunID: current().id,
      workflowPhase: selectedPhase(),
      workflowAgentID: row.agent.id,
      workflowReturnSessionID: route.data.type === "session" ? route.data.sessionID : undefined,
    })
    dialog.clear()
  }

  function movePhase(direction: number) {
    if (phases().length === 0) return
    const next = Math.max(0, Math.min(phases().length - 1, store.selectedPhase + direction))
    setStore("selectedPhase", next)
    setStore("selectedAgent", firstSelectableRow(phaseRows(current(), phases(), phases()[next])))
    setStore("resultOffset", 0)
  }

  function moveAgent(direction: number) {
    if (selectedPhaseRows().length === 0) return
    // Item 19: narrator log rows are skipped — the cyclic step lands on the next
    // agent/result row (or stays put when the phase has only logs).
    setStore("selectedAgent", stepSelectableRow(selectedPhaseRows(), store.selectedAgent, direction < 0 ? -1 : 1))
    setStore("resultOffset", 0)
  }

  function pageResult(direction: number) {
    setStore(
      "resultOffset",
      Math.max(0, Math.min(Math.max(0, resultLines().length - resultBodyLines()), store.resultOffset + direction)),
    )
  }

  function copySelectedResponse() {
    const row = selectedRow()
    // Item 19: a narrator log row copies its message (the narration is copyable
    // even though the row is not selectable via ←/→ — e.g. a logs-only phase).
    const text =
      row?.type === "result"
        ? workflowResultText(current().result)
        : row?.type === "log"
          ? row.entry.message
          : row?.agent.output
    if (!text?.trim()) {
      toast.show({ message: "No response to copy", variant: "info" })
      return
    }
    void Clipboard.write(text)
      .then(() => {
        setCopyNotice(true)
        if (copyNoticeTimeout) clearTimeout(copyNoticeTimeout)
        copyNoticeTimeout = setTimeout(() => setCopyNotice(false), 1800)
        toast.show({ message: "Workflow response copied to clipboard", variant: "success" })
      })
      .catch(() => toast.show({ message: "Failed to copy workflow response", variant: "error" }))
  }

  // Save-as-command: opens the save dialog for THIS run, prefilled with its
  // workflow name. The save dialog replaces the detail view; on resolve (save via
  // onClose, or esc/cancel via the close callback) the detail view is re-opened
  // so the user lands back where they were. Returning `false` from the close
  // callback suppresses the plain stack-pop — the replace already swapped in the
  // detail view (same pattern as openSelected/deleteSelected).
  const saveAsCommand = () => {
    const reopen = () =>
      dialog.replace(() => <DialogWorkflowRun {...props} initial={current()} />, undefined, { notifyClose: false })
    dialog.replace(
      () => <DialogWorkflowSave run={current()} onClose={reopen} />,
      () => {
        reopen()
        return false
      },
    )
  }

  useBindings(() => ({
    bindings: [
      { key: "b", desc: "Back to workflow dashboard", group: "Workflow", cmd: back },
      { key: "escape", desc: "Back to workflow dashboard", group: "Workflow", cmd: back },
      { key: "return,o", desc: "Open selected subagent", group: "Workflow", cmd: openAgentSession },
      { key: "y", desc: "Copy selected response", group: "Workflow", cmd: copySelectedResponse },
      { key: "s", desc: "Save run as command", group: "Workflow", cmd: saveAsCommand },
      { key: "x", desc: "Kill workflow run", group: "Workflow", cmd: cancel },
      { key: "p", desc: "Pause running / resume paused run", group: "Workflow", cmd: pauseOrResume },
      {
        key: "r",
        desc: "Resume, re-running the selected agent",
        group: "Workflow",
        cmd: resumeInvalidatingSelectedAgent,
      },
      { key: "up,k", desc: "Previous phase", group: "Workflow", cmd: () => movePhase(-1) },
      { key: "down,j", desc: "Next phase", group: "Workflow", cmd: () => movePhase(1) },
      { key: "left,h", desc: "Previous phase agent", group: "Workflow", cmd: () => moveAgent(-1) },
      { key: "right,l", desc: "Next phase agent", group: "Workflow", cmd: () => moveAgent(1) },
      {
        key: "pageup,ctrl+b",
        desc: "Page workflow details up",
        group: "Workflow",
        cmd: () =>
          selectedResult() ? pageResult(-resultBodyLines()) : agentScroll?.scrollBy(-(agentScroll?.height ?? 10)),
      },
      {
        key: "pagedown,ctrl+f",
        desc: "Page workflow details down",
        group: "Workflow",
        cmd: () =>
          selectedResult() ? pageResult(resultBodyLines()) : agentScroll?.scrollBy(agentScroll?.height ?? 10),
      },
    ],
  }))

  function PhaseRowItem(props: { row: WorkflowPhaseRow; index: () => number }) {
    // The <For> keys rows by reference, so a row's variant is fixed for the
    // lifetime of this component instance — branching once on the captured const
    // is safe (and lets TypeScript narrow it inside the memos below).
    const row = props.row
    if (row.type === "log") {
      // Item 19: narrator row — dimmed, indented under the agent rows, no
      // metrics columns, no '›' marker, and no mouse selection (click is a
      // no-op: log rows are not selectable). If the 1s refetch ever causes
      // visible flicker here, memoize on entry.time+message.
      return (
        <text fg={theme.textMuted} wrapMode="none" overflow="hidden">
          {`  ${formatLogTime(row.entry.time)} ${row.entry.message}`}
        </text>
      )
    }
    const active = createMemo(() => props.index() === store.selectedAgent)
    const color = createMemo(() => {
      if (active()) return theme.primary
      if (row.type === "result") return theme.text
      if (row.agent.status === "failed") return theme.error
      if (row.agent.status === "completed") return theme.text
      return theme.textMuted
    })
    const labelWidth = createMemo(() => Math.min(30, Math.max(14, Math.floor(agentPanelWidth() * 0.32))))
    const rowText = createMemo(() =>
      fitColumns(
        `${active() ? "›" : phaseRowIcon(current(), row)} ${Locale.truncate(phaseRowLabel(row), labelWidth()).padEnd(labelWidth())} ${phaseRowModel(row)}`,
        phaseRowMetrics(current(), row),
        agentPanelWidth() - 2,
      ),
    )

    return (
      <text
        fg={active() ? theme.primary : color()}
        wrapMode="none"
        overflow="hidden"
        onMouseDown={() => setStore("selectedAgent", props.index())}
      >
        {rowText()}
      </text>
    )
  }

  return (
    <box
      width={dimensions().width}
      height={dimensions().height - 1}
      paddingLeft={2}
      paddingRight={2}
      paddingBottom={1}
      gap={1}
    >
      <box height={2} flexShrink={0}>
        <text fg={theme.primary} attributes={TextAttributes.BOLD} wrapMode="none" overflow="hidden">
          {fitColumns(
            workflow()?.meta.name ?? current().workflow,
            `${agentProgress(current())} · ${formatShortDuration(current())}`,
            headerWidth(),
          )}
        </text>
        <text fg={theme.textMuted} wrapMode="none" overflow="hidden">
          {fitColumns(description(), `${statusIcon(current().status)} ${statusLabel(current().status)}`, headerWidth())}
        </text>
      </box>

      <box
        flexGrow={1}
        minHeight={0}
        flexDirection="row"
        border={["top", "bottom", "left", "right"]}
        borderColor={theme.border}
      >
        <box width={phasePanelWidth()} paddingLeft={1} paddingRight={1} minHeight={0}>
          <text fg={theme.text} wrapMode="none">
            {sectionTitle("Phases", phasePanelWidth() - 2)}
          </text>
          <scrollbox
            ref={(element: ScrollBoxRenderable) => (phaseScroll = element)}
            flexGrow={1}
            minHeight={0}
            verticalScrollbarOptions={{ visible: false }}
            horizontalScrollbarOptions={{ visible: false }}
            scrollAcceleration={getScrollAcceleration()}
          >
            <For each={phases()}>
              {(phase, index) => {
                const status = createMemo(() => phaseStatus(current(), phases(), phase))
                const active = createMemo(() => index() === store.selectedPhase)
                // Item 14: a child-workflow phase reads as a nested step — '↳'
                // instead of the number/status icon when inactive (active keeps
                // the '›' selection arrow) plus a 2-space title indent.
                const child = createMemo(() => childPhases().has(phase))
                const marker = createMemo(() =>
                  active() ? "›" : child() ? "↳" : status() === "pending" ? `${index() + 1}` : phaseIcon(status()),
                )
                const color = createMemo(() => {
                  if (active()) return theme.primary
                  if (status() === "completed") return theme.text
                  if (status() === "failed" || status() === "interrupted") return theme.error
                  return theme.textMuted
                })
                return (
                  <box
                    flexDirection="row"
                    width="100%"
                    onMouseDown={() => {
                      setStore("selectedPhase", index())
                      setStore("selectedAgent", firstSelectableRow(phaseRows(current(), phases(), phase)))
                    }}
                  >
                    <text
                      width={3}
                      fg={
                        active()
                          ? theme.primary
                          : status() === "completed"
                            ? theme.success
                            : status() === "failed" || status() === "interrupted"
                              ? theme.error
                              : theme.textMuted
                      }
                      wrapMode="none"
                    >
                      {marker()}
                    </text>
                    <box flexGrow={1} minWidth={0}>
                      <text fg={color()} wrapMode="none" overflow="hidden">
                        {`${child() ? "  " : ""}${active() ? `${index() + 1} ${phase}` : phase}`}
                      </text>
                    </box>
                    <text fg={active() ? theme.primary : theme.textMuted} flexShrink={0} wrapMode="none">
                      {phaseProgress(current(), phases(), phase)}
                    </text>
                  </box>
                )
              }}
            </For>
          </scrollbox>
        </box>
        <box width={1} border={["left"]} borderColor={theme.border} />
        <box flexGrow={1} minWidth={0} paddingLeft={1} paddingRight={1} minHeight={0}>
          <text fg={theme.text} wrapMode="none" overflow="hidden">
            {sectionTitle(phaseRowTitle(selectedPhase(), selectedPhaseRows()), agentPanelWidth() - 2)}
          </text>
          <Show
            when={!selectedResult()}
            fallback={
              <box flexShrink={0}>
                <Show
                  when={selectedPhaseRows().length}
                  fallback={
                    <box paddingLeft={1}>
                      <text fg={theme.textMuted}>No agent runs or workflow result recorded for this phase.</text>
                    </box>
                  }
                >
                  {/* Item 19: this box does not scroll, so narrator log rows are
                      filtered out — a chatty run must never displace the result
                      pager. Rows keep their ORIGINAL index (reference-identical
                      lookup) so the active marker still matches selectedAgent. */}
                  <For each={selectedPhaseRows().filter((row) => row.type !== "log")}>
                    {(row) => <PhaseRowItem row={row} index={() => selectedPhaseRows().indexOf(row)} />}
                  </For>
                </Show>
              </box>
            }
          >
            <scrollbox
              ref={(element: ScrollBoxRenderable) => (agentScroll = element)}
              flexGrow={1}
              minHeight={0}
              verticalScrollbarOptions={{ visible: false }}
              horizontalScrollbarOptions={{ visible: false }}
              scrollAcceleration={getScrollAcceleration()}
            >
              <Show
                when={selectedPhaseRows().length}
                fallback={
                  <box paddingLeft={1}>
                    <text fg={theme.textMuted}>No agent runs or workflow result recorded for this phase.</text>
                  </box>
                }
              >
                <For each={selectedPhaseRows()}>{(row, index) => <PhaseRowItem row={row} index={index} />}</For>
              </Show>
              <Show when={current().error}>
                <box paddingTop={1} paddingLeft={1}>
                  <text fg={theme.error} wrapMode="word">
                    Error: {current().error}
                  </text>
                </box>
              </Show>
            </scrollbox>
          </Show>
          <Show when={selectedResult()}>
            <box height={1} flexShrink={0} border={["top"]} borderColor={theme.border} />
            <box flexGrow={1} minHeight={0} paddingLeft={1} paddingRight={1}>
              <For each={visibleResultLines()}>
                {(line) => (
                  <text fg={theme.text} wrapMode="none" overflow="hidden">
                    {line}
                  </text>
                )}
              </For>
              <Show when={current().error}>
                <box paddingTop={1} paddingLeft={1}>
                  <text fg={theme.error} wrapMode="word">
                    Error: {current().error}
                  </text>
                </box>
              </Show>
            </box>
          </Show>
        </box>
      </box>

      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>
          [↑/↓] Phase | [←/→] Agent/result | [Y] Copy response | [S] Save as command | [Enter/O] Open agent | [X] Kill
          run | [Esc/B] Back
        </text>
        <Show when={current().status === "running"}>
          <text fg={theme.primary}>live</text>
        </Show>
      </box>
      <Show when={copyNotice()}>
        <box
          position="absolute"
          right={4}
          bottom={3}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          backgroundColor={theme.backgroundPanel}
          border={["left", "right"]}
          borderColor={theme.success}
        >
          <text fg={theme.text}>Response copied to clipboard</text>
        </box>
      </Show>
      <box height={0.5} />
    </box>
  )
}
