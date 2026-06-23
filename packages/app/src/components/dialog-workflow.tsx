import { Component, createMemo, createResource, createSignal, For, onCleanup, Show } from "solid-js"
import { useNavigate } from "@solidjs/router"
import { Dialog } from "@opencode-ai/ui/dialog"
import { Button } from "@opencode-ai/ui/button"
import { TextField } from "@opencode-ai/ui/text-field"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { base64Encode } from "@opencode-ai/core/util/encode"
import type { WorkflowInfo, WorkflowRun } from "@opencode-ai/sdk/v2"
import { useSDK } from "@/context/sdk"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"
import {
  capLogs,
  formatPhase,
  formatShortElapsed,
  isResumable,
  normalizePhases,
  phaseIcon,
  phaseStatus,
  questionBadge,
  reanchorSelection,
  statusIcon,
} from "./dialog-workflow-helpers"
import { saveWorkflowRun, type SaveScope } from "./dialog-workflow-client"
import { sanitizeWorkflowFilename } from "./prompt-input/workflow-command"
import { openWorkflowQuestion } from "./dialog-workflow-question"
import { openWorkflowDashboard } from "./prompt-input/workflow-dashboard"

type WorkflowAgentRun = WorkflowRun["agents"][number]

const LOG_CAP = 100

const STATUS_LABEL_KEY = {
  running: "dialog.workflow.status.running",
  completed: "dialog.workflow.status.completed",
  failed: "dialog.workflow.status.failed",
  cancelled: "dialog.workflow.status.cancelled",
  interrupted: "dialog.workflow.status.interrupted",
  paused: "dialog.workflow.status.paused",
} as const

// Localized label for a derived phase status. The six lifecycle statuses have
// i18n keys; `pending`/`skipped` are view-only derivations with no key, so they
// fall back to the raw token.
function phaseStatusLabel(status: ReturnType<typeof phaseStatus>, language: ReturnType<typeof useLanguage>): string {
  if (status in STATUS_LABEL_KEY) return language.t(STATUS_LABEL_KEY[status as keyof typeof STATUS_LABEL_KEY])
  return status
}

// Live workflow dashboard: a master list of runs (left) + the selected run's
// phases / agents / result / usage / logs (right), with pause/resume/cancel and
// the answer entry point. Mirrors the TUI dialog-workflow.tsx but lean for v1:
// refetch the whole run list on every workflow.run.* event PLUS a 1s poll
// fallback (the lean events carry no agent detail; the refetch fills it in).
export const DialogWorkflow: Component = () => {
  const sdk = useSDK()
  const dialog = useDialog()
  const language = useLanguage()

  const [workflows] = createResource(() =>
    sdk().client.workflow
      .list({ directory: sdk().directory })
      .then((response) => response.data ?? [])
      .catch(() => [] as WorkflowInfo[]),
  )

  const [runs, { refetch }] = createResource(
    () =>
      sdk().client.workflow
        .runs({ directory: sdk().directory })
        .then((response) => response.data ?? [])
        .catch(() => [] as WorkflowRun[]),
    { initialValue: [] as WorkflowRun[] },
  )

  // Instant refresh on lifecycle events + a 1s poll fallback (mirror TUI :425-437).
  const offUpdated = sdk().event.on("workflow.run.updated", () => void refetch())
  const offFinished = sdk().event.on("workflow.run.finished", () => void refetch())
  const poll = setInterval(() => void refetch(), 1000)
  onCleanup(() => {
    offUpdated()
    offFinished()
    clearInterval(poll)
  })

  const rows = createMemo<WorkflowRun[]>(() => runs() ?? [])
  const [selectedId, setSelectedId] = createSignal<string | undefined>(undefined)

  // Keep the selection stable across the re-sorting refetch; default to the first
  // run when nothing is selected yet.
  const selected = createMemo<WorkflowRun | undefined>(() => {
    const list = rows()
    if (list.length === 0) return undefined
    const index = reanchorSelection(selectedId(), list)
    return list[index]
  })

  const workflowFor = (run: WorkflowRun | undefined) =>
    run ? workflows()?.find((workflow) => workflow.name === run.workflow) : undefined

  const phasesFor = (run: WorkflowRun | undefined) => normalizePhases(workflowFor(run))

  const totalCost = (run: WorkflowRun) => run.agents.reduce((sum, agent) => sum + (agent.cost ?? 0), 0)

  const refresh = () => void refetch()

  const pause = async (run: WorkflowRun) => {
    try {
      await sdk().client.workflow.pause({ id: run.id, directory: sdk().directory })
      refresh()
    } catch {
      showToast({ variant: "error", title: language.t("toast.workflow.pause.failed.title") })
    }
  }

  const cancel = async (run: WorkflowRun) => {
    try {
      await sdk().client.workflow.cancel({ id: run.id, directory: sdk().directory })
      refresh()
    } catch {
      showToast({ variant: "error", title: language.t("toast.workflow.cancel.failed.title") })
    }
  }

  // Starts a fresh run that replays this run's journal (a resume always creates
  // a NEW run — see the isResumeAnswer convention in dialog-workflow-client.ts).
  // `invalidate` lists source-agent indices (0-based) to force back to live;
  // omitted, every completed agent replays from the journal. On success the
  // selection follows the new run so the resume is observable.
  const resume = async (run: WorkflowRun, invalidate?: number[]) => {
    try {
      const result = await sdk().client.workflow.start({
        name: run.workflow,
        directory: sdk().directory,
        workflowStartPayload: {
          resume_of: run.id,
          ...(invalidate !== undefined ? { invalidate_agents: invalidate } : {}),
        },
      })
      if (result.data?.id) setSelectedId(result.data.id)
      showToast({
        variant: "success",
        title: language.t("toast.workflow.resumed.title"),
        description: language.t("toast.workflow.resumed.description", { name: run.workflow }),
      })
      refresh()
    } catch {
      showToast({ variant: "error", title: language.t("toast.workflow.resume.failed.title") })
    }
  }

  // Per-agent re-run (TUI parity: resumeInvalidatingSelectedAgent): resume the
  // run while forcing JUST this agent back to a live re-run; every other
  // completed agent still replays from the journal (cached:true).
  const rerunAgent = (run: WorkflowRun, agent: WorkflowAgentRun) => {
    const index = run.agents.findIndex((candidate) => candidate.id === agent.id)
    if (index < 0) return
    void resume(run, [index])
  }

  const answer = (run: WorkflowRun) => {
    setSelectedId(run.id)
    openWorkflowQuestion(dialog, run, refresh)
  }

  return (
    <Dialog
      size="x-large"
      title={language.t("dialog.workflow.title")}
      description={language.t("dialog.workflow.description", { count: rows().length })}
    >
      <Show
        when={rows().length > 0}
        fallback={<div class="px-3 py-6 text-text-weak text-14-regular">{language.t("dialog.workflow.empty")}</div>}
      >
        <div class="flex gap-3 min-h-0 h-[60vh]">
          {/* Run list */}
          <div class="w-72 shrink-0 overflow-auto no-scrollbar flex flex-col gap-0.5 border-r border-border-base pr-2">
            <For each={rows()}>
              {(run) => {
                const isSelected = () => selected()?.id === run.id
                return (
                  <button
                    class="w-full flex items-center gap-2 rounded-md px-2 py-1 text-left"
                    classList={{ "bg-surface-raised-base-hover": isSelected() }}
                    onClick={() => setSelectedId(run.id)}
                  >
                    <span class="shrink-0 text-text-strong">{statusIcon(run.status)}</span>
                    <div class="flex flex-col min-w-0">
                      <span class="text-14-regular text-text-strong truncate">{run.workflow}</span>
                      <span class="text-11-regular text-text-weak truncate">{formatPhase(run, workflowFor(run))}</span>
                    </div>
                    <div class="ml-auto flex items-center gap-1 shrink-0">
                      <Show when={questionBadge(run)}>
                        <span class="text-11-regular">{questionBadge(run)}</span>
                      </Show>
                      <span class="text-11-regular text-text-subtle">
                        {formatShortElapsed(run.started_at, run.completed_at)}
                      </span>
                    </div>
                  </button>
                )
              }}
            </For>
          </div>

          {/* Detail */}
          <div class="flex-1 min-w-0 overflow-auto no-scrollbar">
            <Show
              when={selected()}
              fallback={
                <div class="text-text-weak text-14-regular px-1">{language.t("dialog.workflow.detail.empty")}</div>
              }
            >
              {(run) => (
                <WorkflowDetail
                  run={run()}
                  phases={phasesFor(run())}
                  cost={totalCost(run())}
                  onRerunAgent={(agent) => rerunAgent(run(), agent)}
                />
              )}
            </Show>
          </div>
        </div>

        {/* Actions for the selected run */}
        <Show when={selected()}>
          {(run) => (
            <div class="flex items-center justify-end gap-2 pt-3 mt-3 border-t border-border-base px-1">
              <Show when={run().pending_question}>
                <Button variant="primary" onClick={() => answer(run())}>
                  {language.t("dialog.workflow.action.answer")}
                </Button>
              </Show>
              <Show when={run().status === "running"}>
                <Button variant="secondary" onClick={() => void pause(run())}>
                  {language.t("dialog.workflow.action.pause")}
                </Button>
                <Button variant="secondary" onClick={() => void cancel(run())}>
                  {language.t("dialog.workflow.action.cancel")}
                </Button>
              </Show>
              <Show when={isResumable(run().status)}>
                <Button variant="secondary" onClick={() => void resume(run())}>
                  {language.t("dialog.workflow.action.resume")}
                </Button>
              </Show>
              {/* Delete is always offered (TUI parity: no status guard) — deleting
                  a live run only removes the persisted history row, the server
                  allows it. The irreversible part is gated behind a confirm. */}
              <Button variant="secondary" onClick={() => openWorkflowDeleteConfirm(dialog, run())}>
                {language.t("dialog.workflow.action.delete")}
              </Button>
              {/* Save-as-command: writes the run's captured source as a workflow
                  file via POST /workflow/save. Disabled when the run carries no
                  source (older/temporary runs), matching the TUI's hard guard. */}
              <Button
                variant="secondary"
                disabled={!run().definition?.source}
                title={
                  run().definition?.source
                    ? language.t("dialog.workflow.action.save")
                    : language.t("dialog.workflow.save.noSource")
                }
                onClick={() => openWorkflowSave(dialog, run())}
              >
                {language.t("dialog.workflow.action.save")}
              </Button>
            </div>
          )}
        </Show>
      </Show>
    </Dialog>
  )
}

const WorkflowDetail: Component<{
  run: WorkflowRun
  phases: string[]
  cost: number
  onRerunAgent?: (agent: WorkflowAgentRun) => void
}> = (props) => {
  const sdk = useSDK()
  const dialog = useDialog()
  const navigate = useNavigate()
  const language = useLanguage()
  const logs = createMemo(() => capLogs(props.run.logs ?? [], LOG_CAP))
  const resultText = createMemo(() => {
    const result = props.run.result
    if (result === undefined || result === null) return undefined
    return typeof result === "string" ? result : JSON.stringify(result, null, 2)
  })
  const resumable = createMemo(() => isResumable(props.run.status))

  // Clipboard copy with toast feedback (TUI parity: copySelectedResponse). The
  // buttons are disabled when there is nothing to copy, so the TUI's "No
  // response to copy" info path cannot trigger here.
  const copy = (text: string | undefined) => {
    if (!text) return
    navigator.clipboard
      .writeText(text)
      .then(() => showToast({ variant: "success", title: language.t("toast.workflow.copy.ok.title") }))
      .catch(() => showToast({ variant: "error", title: language.t("toast.workflow.copy.failed.title") }))
  }

  // Navigate into the agent's subagent session (TUI parity: openAgentSession);
  // closing the dialog lands the user on the session view.
  const openAgentSession = (agent: WorkflowAgentRun) => {
    if (!agent.session_id) return
    navigate(`/${base64Encode(sdk().directory)}/session/${agent.session_id}`)
    dialog.close()
  }

  return (
    <div class="flex flex-col gap-4 px-1">
      {/* Phases */}
      <Show when={props.phases.length > 0}>
        <section class="flex flex-col gap-1">
          <h3 class="text-12-medium text-text-weak uppercase tracking-wide">
            {language.t("dialog.workflow.section.phases")}
          </h3>
          <For each={props.phases}>
            {(phase) => {
              const status = () => phaseStatus(props.run, props.phases, phase)
              return (
                <div class="flex items-center gap-2 text-14-regular">
                  <span class="shrink-0 text-text-strong">{phaseIcon(status())}</span>
                  <span class="text-text-strong truncate">{phase}</span>
                  <span class="ml-auto text-11-regular text-text-subtle">{phaseStatusLabel(status(), language)}</span>
                </div>
              )
            }}
          </For>
        </section>
      </Show>

      {/* Agents */}
      <section class="flex flex-col gap-1">
        <h3 class="text-12-medium text-text-weak uppercase tracking-wide">
          {language.t("dialog.workflow.section.agents")}
        </h3>
        <Show
          when={props.run.agents.length > 0}
          fallback={<span class="text-12-regular text-text-weak">{language.t("dialog.workflow.detail.noAgents")}</span>}
        >
          <For each={props.run.agents}>
            {(agent) => (
              // A row with a recorded subagent session navigates into it on
              // click. Rendered as a div (not a button) because the row hosts
              // nested action buttons — nested <button>s are invalid HTML.
              <div
                class="flex items-center gap-2 text-14-regular rounded-md px-1"
                classList={{ "cursor-pointer hover:bg-surface-raised-base-hover": !!agent.session_id }}
                role={agent.session_id ? "button" : undefined}
                title={agent.session_id ? language.t("dialog.workflow.agent.openSession") : undefined}
                onClick={() => openAgentSession(agent)}
              >
                <span class="shrink-0 text-text-strong">{statusIcon(agent.status)}</span>
                {/* Item 16: an authored label wins over the agent name. */}
                <span class="text-text-strong truncate">{agent.label ?? agent.agent ?? agent.id}</span>
                <Show when={agent.model}>
                  <span class="text-11-regular text-text-subtle truncate">{agent.model}</span>
                </Show>
                <div class="ml-auto flex items-center gap-2 shrink-0 text-11-regular text-text-subtle">
                  <Show when={agent.tokens?.total}>
                    <span>{agent.tokens?.total} tok</span>
                  </Show>
                  <Show when={agent.cost !== undefined}>
                    <span>${(agent.cost ?? 0).toFixed(4)}</span>
                  </Show>
                  <Button
                    variant="ghost"
                    disabled={!agent.output}
                    onClick={(event: MouseEvent) => {
                      event.stopPropagation()
                      copy(agent.output)
                    }}
                  >
                    {language.t("dialog.workflow.action.copy")}
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={!resumable()}
                    onClick={(event: MouseEvent) => {
                      event.stopPropagation()
                      props.onRerunAgent?.(agent)
                    }}
                  >
                    {language.t("dialog.workflow.action.rerun")}
                  </Button>
                </div>
              </div>
            )}
          </For>
        </Show>
      </section>

      {/* Result */}
      <section class="flex flex-col gap-1">
        <div class="flex items-center justify-between">
          <h3 class="text-12-medium text-text-weak uppercase tracking-wide">
            {language.t("dialog.workflow.section.result")}
          </h3>
          <Button variant="ghost" disabled={!resultText()} onClick={() => copy(resultText())}>
            {language.t("dialog.workflow.action.copy")}
          </Button>
        </div>
        <Show
          when={resultText()}
          fallback={<span class="text-12-regular text-text-weak">{language.t("dialog.workflow.detail.noResult")}</span>}
        >
          <pre class="text-12-regular text-text-strong whitespace-pre-wrap break-words bg-surface-base rounded p-2">
            {resultText()}
          </pre>
        </Show>
        <Show when={props.run.error}>
          <span class="text-12-regular text-text-danger break-words">{props.run.error}</span>
        </Show>
      </section>

      {/* Usage */}
      <section class="flex flex-col gap-1">
        <h3 class="text-12-medium text-text-weak uppercase tracking-wide">
          {language.t("dialog.workflow.section.usage")}
        </h3>
        <span class="text-14-regular text-text-strong">
          {language.t("dialog.workflow.usage.total", { cost: props.cost.toFixed(4) })}
        </span>
      </section>

      {/* Logs */}
      <Show when={logs().entries.length > 0}>
        <section class="flex flex-col gap-1">
          <h3 class="text-12-medium text-text-weak uppercase tracking-wide">
            {language.t("dialog.workflow.section.logs")}
          </h3>
          <Show when={logs().hidden > 0}>
            <span class="text-11-regular text-text-subtle">
              {language.t("dialog.workflow.logs.earlier", { count: logs().hidden })}
            </span>
          </Show>
          <div class="flex flex-col gap-0.5 bg-surface-base rounded p-2">
            <For each={logs().entries}>
              {(entry) => <span class="text-11-regular text-text-weak break-words">{entry.message}</span>}
            </For>
          </div>
        </section>
      </Show>
    </div>
  )
}

// Save-a-run-as-command dialog (web parity with the TUI DialogWorkflowSave): a
// name field prefilled with the run's workflow name + a project/global
// destination toggle. The name is sanitized to a single safe path segment before
// the POST; the server is the source of truth for collisions (409) and meta
// validity (400), so this never pre-checks the filesystem. A run with no captured
// source can never reach here (the dashboard button is disabled), but the source
// is re-guarded defensively.
const DialogWorkflowSave: Component<{ run: WorkflowRun }> = (props) => {
  const sdk = useSDK()
  const dialog = useDialog()
  const language = useLanguage()

  const [name, setName] = createSignal(props.run.workflow)
  const [scope, setScope] = createSignal<SaveScope>("project")
  const [pending, setPending] = createSignal(false)

  const submit = async () => {
    if (pending()) return
    const source = props.run.definition?.source
    if (!source) {
      showToast({ variant: "error", title: language.t("dialog.workflow.save.noSource") })
      return
    }
    const safe = sanitizeWorkflowFilename(name())
    if (!safe) {
      showToast({ variant: "error", title: language.t("toast.workflow.save.invalidName.title") })
      return
    }
    setPending(true)
    const result = await saveWorkflowRun(sdk(), { name: safe, source, scope: scope() })
    setPending(false)
    if (result.type === "ok") {
      showToast({
        variant: "success",
        title: language.t("toast.workflow.save.ok.title"),
        description: language.t("toast.workflow.save.ok.description", { name: safe }),
      })
      dialog.close()
      return
    }
    if (result.type === "conflict") {
      showToast({
        variant: "error",
        title: language.t("toast.workflow.save.conflict.title"),
        description: language.t("toast.workflow.save.conflict.description", { name: safe }),
      })
      return
    }
    if (result.type === "invalid") {
      showToast({
        variant: "error",
        title: language.t("toast.workflow.save.invalidName.title"),
        description: result.message,
      })
      return
    }
    showToast({ variant: "error", title: language.t("toast.workflow.save.failed.title"), description: result.message })
  }

  return (
    <Dialog
      title={language.t("dialog.workflow.save.title")}
      description={language.t("dialog.workflow.save.description")}
    >
      <div class="flex flex-col gap-3 px-1">
        <TextField
          autofocus
          placeholder={language.t("dialog.workflow.save.placeholder")}
          value={name()}
          onChange={setName}
        />
        <div class="flex items-center gap-2">
          <Button variant={scope() === "project" ? "primary" : "secondary"} onClick={() => setScope("project")}>
            {language.t("dialog.workflow.save.scope.project")}
          </Button>
          <Button variant={scope() === "global" ? "primary" : "secondary"} onClick={() => setScope("global")}>
            {language.t("dialog.workflow.save.scope.global")}
          </Button>
        </div>
        <div class="flex items-center justify-end">
          <Button variant="primary" disabled={pending()} onClick={() => void submit()}>
            {language.t("dialog.workflow.action.save")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}

// Opens the save dialog for a run. Replaces the dashboard on the stack; on a
// successful save the dialog closes itself (dialog.close), landing back on the app.
export function openWorkflowSave(dialog: ReturnType<typeof useDialog>, run: WorkflowRun) {
  dialog.show(() => DialogWorkflowSave({ run }))
}

// Delete-a-run confirm (web parity with the TUI's deleteSelected + DialogConfirm):
// deleting a history row is irreversible, so it asks first. @opencode-ai/ui has no
// generic confirm dialog, hence this mini component (DialogWorkflowSave pattern).
// Whichever way the prompt resolves the dashboard is re-opened (dialog.show
// replaces the stack, mirroring the TUI's reopen). Deleting a still-running run is
// allowed server-side — it only removes the persisted history row.
const DialogWorkflowDeleteConfirm: Component<{ run: WorkflowRun }> = (props) => {
  const sdk = useSDK()
  const dialog = useDialog()
  const language = useLanguage()
  const [pending, setPending] = createSignal(false)

  const reopen = () => void openWorkflowDashboard(dialog)

  const confirm = async () => {
    if (pending()) return
    setPending(true)
    try {
      const result = await sdk().client.workflow.delete({ id: props.run.id, directory: sdk().directory })
      // The endpoint returns a boolean: `false` means the row was already gone
      // (e.g. a concurrent delete), so the toast must not claim a deletion that
      // did not happen here (TUI parity).
      if (result.data === false) {
        showToast({ title: language.t("toast.workflow.delete.alreadyGone.title", { id: props.run.id }) })
      } else {
        showToast({ variant: "success", title: language.t("toast.workflow.delete.ok.title", { id: props.run.id }) })
      }
    } catch {
      showToast({ variant: "error", title: language.t("toast.workflow.delete.failed.title") })
    }
    setPending(false)
    // The deleted run's selectedId simply re-anchors in the fresh dashboard
    // (reanchorSelection clamps a vanished id to the last row).
    reopen()
  }

  return (
    <Dialog
      title={language.t("dialog.workflow.delete.title")}
      description={language.t("dialog.workflow.delete.text", { id: props.run.id, name: props.run.workflow })}
    >
      <div class="flex items-center justify-end gap-2 px-1">
        <Button variant="secondary" onClick={reopen}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="primary" disabled={pending()} onClick={() => void confirm()}>
          {language.t("dialog.workflow.delete.confirm")}
        </Button>
      </div>
    </Dialog>
  )
}

// Opens the delete confirm for a run, replacing the dashboard on the stack;
// the confirm re-opens the dashboard once it resolves (confirm or cancel).
export function openWorkflowDeleteConfirm(dialog: ReturnType<typeof useDialog>, run: WorkflowRun) {
  dialog.show(() => DialogWorkflowDeleteConfirm({ run }))
}
