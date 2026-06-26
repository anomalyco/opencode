import { createMemo, Show, type Accessor } from "solid-js"
import { useSync } from "@tui/context/sync"
import { useTheme } from "@tui/context/theme"
import { useKV } from "@tui/context/kv"
import type { RGBA } from "@opentui/core"
import type { ColorGenerator } from "opentui-spinner"
import { Locale } from "@/util/locale"
import { formatDuration } from "@/util/format"
import { useElapsed } from "./elapsed"
import { useWorkflow, currentToolOf } from "./use-workflow"
import { useWorkflowStatus } from "./state-machine"
import { DiffSummary } from "./diff-summary"
import { ContextBar } from "./context-bar"

export function StatusLine(props: {
  sessionID: Accessor<string | undefined>
  spinnerColor: Accessor<ColorGenerator | RGBA>
  spinnerFrames: Accessor<string[]>
  interrupt: Accessor<number>
}) {
  const sync = useSync()
  const { theme } = useTheme()
  const kv = useKV()
  const wf = useWorkflow(props.sessionID)
  const status = useWorkflowStatus(props.sessionID)
  const elapsed = useElapsed(() => status().startedAt)

  const currentTool = createMemo(() => {
    const id = props.sessionID()
    if (!id) return null
    return currentToolOf(sync, id)
  })

  const toolLabel = createMemo(() => {
    const t = currentTool()
    if (!t) return ""
    return `${Locale.titlecase(t.tool)}${t.title ? " " + t.title : ""}`
  })

  const showSpinner = createMemo(() => {
    const s = status().state
    return s === "running" || s === "parallel" || s === "retry"
  })

  const showRatio = createMemo(() => wf.workers().length > 0)
  const showTool = createMemo(() => {
    const s = status().state
    if (s !== "running" && s !== "parallel") return false
    return Boolean(toolLabel())
  })
  const showElapsed = createMemo(() => {
    const s = status().state
    return s === "running" || s === "parallel" || s === "complete"
  })

  return (
    <box flexDirection="row" gap={1} flexGrow={1} alignItems="center">
      <Show when={showSpinner()}>
        <box marginLeft={1} flexShrink={0}>
          <Show when={kv.get("animations_enabled", true)} fallback={<text fg={theme.textMuted}>[⋯]</text>}>
            <spinner color={props.spinnerColor()} frames={props.spinnerFrames()} interval={40} />
          </Show>
        </box>
      </Show>
      <Show when={showRatio()}>
        <text fg={wf.failed().length > 0 ? theme.error : theme.accent} wrapMode="none">
          {wf.ratio().done}/{wf.ratio().total}
        </text>
      </Show>
      <Show when={showTool()}>
        <text fg={theme.textMuted} wrapMode="none">
          ↳ {Locale.truncateMiddle(toolLabel(), 40)}
        </text>
      </Show>
      <DiffSummary sessionID={props.sessionID} />
      <Show when={showElapsed()}>
        <text fg={theme.textMuted} wrapMode="none">
          {formatDuration(elapsed() * 1000)}
        </text>
      </Show>
      <ContextBar sessionID={props.sessionID} />
      <Show when={showSpinner()}>
        <text fg={props.interrupt() > 0 ? theme.primary : theme.text} wrapMode="none">
          esc{" "}
          <span style={{ fg: props.interrupt() > 0 ? theme.primary : theme.textMuted }}>
            {props.interrupt() > 0 ? "again to interrupt" : "interrupt"}
          </span>
        </text>
      </Show>
    </box>
  )
}

export * as WorkflowStatusLine from "./status-line"