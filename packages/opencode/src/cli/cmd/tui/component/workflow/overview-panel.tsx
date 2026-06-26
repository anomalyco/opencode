import { createMemo, For, Show, type Accessor } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { SplitBorder } from "@tui/component/border"
import { formatDuration } from "@/util/format"
import { useElapsed } from "./elapsed"
import { useWorkflow, type WorkerInfo } from "./use-workflow"
import { WorkerRow } from "./worker-row"
import { ProgressBar } from "./progress-bar"
import { Sparkline } from "./sparkline"
import { BatchHeader } from "./batch-header"
import { OrchestratorRow } from "./orchestrator-row"
import { toggleFailedFirst } from "./workflow-store"

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

export function WorkflowOverview(props: { sessionID: Accessor<string | undefined> }) {
  const { theme } = useTheme()
  const wf = useWorkflow(props.sessionID)

  const verbosity = createMemo(() => wf.state()?.verbosity ?? "normal")
  const firstStarted = createMemo(() => wf.workers()[0]?.session.time.created)
  const secs = useElapsed(firstStarted)
  const running = createMemo(() => wf.inFlight().length)
  const failed = createMemo(() => wf.failed().length)
  const cost = createMemo(() => {
    const id = props.sessionID()
    if (!id) return 0
    return wf.workers().reduce((acc, w) => acc + (w.cost ?? 0), 0)
  })

  const headerLeft = createMemo(() => {
    const r = wf.ratio()
    const parts = [`Workflow  ${r.done}/${r.total}`]
    if (running() > 0) parts.push(`${running()} running`)
    if (failed() > 0) parts.push(`${failed()} failed`)
    if (verbosity() === "verbose" && cost() > 0) parts.push(money.format(cost()))
    parts.push(formatDuration(secs()))
    return parts.join(" · ")
  })

  const ordered = createMemo<WorkerInfo[]>(() => {
    const list = wf.workers()
    const ff = wf.state()?.failedFirst ?? false
    if (!ff) return list
    return [...list].toSorted((a, b) => {
      const af = a.status === "failed" ? 0 : 1
      const bf = b.status === "failed" ? 0 : 1
      return af - bf
    })
  })

  const onFailedToggle = () => {
    const id = props.sessionID()
    if (!id) return
    if (failed() > 0) toggleFailedFirst(id)
  }

  return (
    <Show when={wf.state()?.overviewOpen && (wf.workers().length > 0 || wf.orchestratorThinking())}>
      <box
        flexShrink={0}
        {...SplitBorder}
        border={["left"]}
        borderColor={theme.border}
        backgroundColor={theme.backgroundPanel}
        paddingLeft={2}
        paddingRight={1}
        paddingTop={1}
        paddingBottom={1}
      >
        <box flexDirection="row" gap={1} justifyContent="space-between" flexShrink={0}>
          <text fg={theme.textMuted} wrapMode="none">
            {headerLeft()}
          </text>
          <box flexDirection="row" gap={1}>
            <Show when={failed() > 0}>
              <text fg={theme.error} onMouseUp={onFailedToggle}>
                ✕ sort
              </text>
            </Show>
            <ProgressBar ratio={wf.progressRatio} failed={() => failed()} width={10} showLabel={false} />
            <text fg={wf.failed().length > 0 ? theme.error : theme.accent}>
              {wf.ratio().done}/{wf.ratio().total}
            </text>
          </box>
        </box>
        <Show when={wf.state()?.activeHistory && wf.state()!.activeHistory.length > 0}>
          <Sparkline history={() => wf.state()?.activeHistory ?? []} />
        </Show>
        <OrchestratorRow sessionID={props.sessionID} />
        <For each={wf.batches()}>
          {(batch) => (
            <>
              <BatchHeader index={() => batch.index} count={() => batch.workerIDs.length} status={() => batch.status} />
              <For each={batch.workerIDs}>
                {(id) => <WorkerRow sessionID={() => id} verbosity={verbosity} />}
              </For>
            </>
          )}
        </For>
      </box>
    </Show>
  )
}

export * as WorkflowOverviewPanel from "./overview-panel"