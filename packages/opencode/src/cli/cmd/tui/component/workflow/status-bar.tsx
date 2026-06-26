import { createEffect, createMemo, createSignal, For, onCleanup, Show, type Accessor } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { Locale } from "@/util/locale"
import { formatDuration } from "@/util/format"
import { useElapsed } from "./elapsed"
import { useWorkflow, currentToolOf } from "./use-workflow"
import { ProgressBar } from "./progress-bar"

const COMPLETE_HOLD_MS = 5000

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })

function RollupItem(props: { sessionID: string; started: number; showPrompt: Accessor<boolean> }) {
  const sync = useSync()
  const { theme } = useTheme()
  const secs = useElapsed(() => props.started)
  const tool = createMemo(() => currentToolOf(sync, props.sessionID))
  const label = createMemo(() => {
    const t = tool()
    if (!t) return undefined
    return `${Locale.titlecase(t.tool)}${t.title ? " " + t.title : ""}`
  })
  const prompt = createMemo(() => {
    if (!props.showPrompt()) return ""
    const msgs = sync.data.message[props.sessionID] ?? []
    const user = msgs.find((m) => m.role === "user")
    if (!user) return ""
    const parts = sync.data.part[user.id] ?? []
    return parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("")
  })
  return (
    <Show
      when={label()}
      fallback={<text fg={theme.textMuted}>⠂ worker</text>}
    >
      {(l) => (
        <text fg={theme.textMuted} wrapMode="none">
          ⠂ {l()}
          <Show when={props.showPrompt() && prompt()}> "{Locale.truncate(prompt(), 30)}"</Show> {formatDuration(secs())}
        </text>
      )}
    </Show>
  )
}

function CompleteSummary(props: { sessionID: Accessor<string | undefined> }) {
  const sync = useSync()
  const { theme } = useTheme()
  const wf = useWorkflow(props.sessionID)
  const session = createMemo(() => (props.sessionID() ? sync.session.get(props.sessionID()!) : undefined))
  const cost = createMemo(() => session()?.cost ?? 0)
  const elapsedTotal = useElapsed(() => wf.workers()[0]?.session.time.created)
  const failedCount = createMemo(() => wf.failed().length)
  const [visible, setVisible] = createSignal(true)

  createEffect(() => {
    const inFlight = wf.inFlight().length
    const idle = sync.data.session_status[props.sessionID() ?? ""]?.type === "idle"
    if (wf.workers().length === 0 || inFlight > 0 || !idle) return
    setVisible(true)
    const timer = setInterval(() => {
      setVisible(false)
      clearInterval(timer)
    }, COMPLETE_HOLD_MS)
    onCleanup(() => clearInterval(timer))
  })

  return (
    <Show when={visible()}>
      <box marginLeft={1} flexDirection="row" gap={1}>
        <text fg={theme.success}>✓</text>
        <text fg={theme.textMuted}>
          {wf.completed().length}/{wf.workers().length}
        </text>
        <Show when={failedCount() > 0}>
          <text fg={theme.error}>· ✕ {failedCount()} failed</text>
        </Show>
        <text fg={theme.textMuted}>· {formatDuration(elapsedTotal())}</text>
        <Show when={cost() > 0}>
          <text fg={theme.textMuted}>· {money.format(cost())}</text>
        </Show>
      </box>
    </Show>
  )
}

export function WorkflowStatusBar(props: { sessionID: Accessor<string | undefined> }) {
  const sync = useSync()
  const { theme } = useTheme()
  const wf = useWorkflow(props.sessionID)

  const verbosity = createMemo(() => wf.state()?.verbosity ?? "normal")
  const rollupItems = createMemo(() =>
    wf.inFlight().map((w) => ({ id: w.session.id, started: w.session.time.created })),
  )
  const failedWorkers = createMemo(() => wf.failed())
  const session = createMemo(() => (props.sessionID() ? sync.session.get(props.sessionID()!) : undefined))
  const cost = createMemo(() => session()?.cost ?? 0)
  const showPerWorker = createMemo(() => verbosity() !== "minimal")

  const showRollup = createMemo(() => rollupItems().length > 0)
  const showComplete = createMemo(
    () => rollupItems().length === 0 && wf.workers().length > 0 && sync.data.session_status[props.sessionID() ?? ""]?.type === "idle",
  )
  const orchestratorText = createMemo(() => wf.orchestratorThinking())

  return (
    <Show when={wf.active()}>
      <box flexShrink={0} marginLeft={1} flexDirection="row" gap={1}>
        <Show when={wf.workers().length > 0} fallback={
          <Show when={orchestratorText()}>
            <ProgressBar ratio={wf.progressRatio} failed={() => 0} />
            <text fg={theme.textMuted} wrapMode="none">
              ⠏ Orchestrator: {Locale.truncate(orchestratorText() ?? "", 40)}
            </text>
          </Show>
        }>
          <ProgressBar ratio={wf.progressRatio} failed={() => wf.failed().length} />
        </Show>
        <Show when={showRollup()}>
          <For each={rollupItems()}>
            {(item, index) => (
              <>
                <Show when={index() > 0}>
                  <text fg={theme.textMuted}>·</text>
                </Show>
                <RollupItem sessionID={item.id} started={item.started} showPrompt={showPerWorker} />
              </>
            )}
          </For>
          <Show when={!showPerWorker() && rollupItems().length > 0}>
            <text fg={theme.textMuted}>· {rollupItems().length} in flight</text>
          </Show>
          <Show when={failedWorkers().length > 0}>
            <text fg={theme.error} wrapMode="none">
              · ✕ {Locale.truncate(failedWorkers()[0]?.error ?? "failed", 80)}
            </text>
          </Show>
          <Show when={verbosity() === "verbose" && cost() > 0}>
            <text fg={theme.textMuted}>· {money.format(cost())}</text>
          </Show>
          <text fg={wf.failed().length > 0 ? theme.error : theme.accent} wrapMode="none">
            {wf.ratio().done}/{wf.ratio().total}
          </text>
        </Show>
        <Show when={showComplete()}>
          <CompleteSummary sessionID={props.sessionID} />
        </Show>
      </box>
    </Show>
  )
}

export * as WorkflowStatusBarMod from "./status-bar"