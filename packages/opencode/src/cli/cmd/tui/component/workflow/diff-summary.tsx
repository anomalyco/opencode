import { createMemo, Show, type Accessor } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useWorkflow } from "./use-workflow"

export function DiffSummary(props: { sessionID: Accessor<string | undefined> }) {
  const { theme } = useTheme()
  const wf = useWorkflow(props.sessionID)
  const diff = createMemo(() => wf.aggregateDiff())

  return (
    <Show when={diff().files > 0}>
      <box flexDirection="row" gap={1} flexShrink={0}>
        <text fg={theme.diffAdded} wrapMode="none">
          +{diff().added}
        </text>
        <text fg={theme.diffRemoved} wrapMode="none">
          -{diff().removed}
        </text>
        <text fg={theme.textMuted} wrapMode="none">
          {diff().files}f
        </text>
      </box>
    </Show>
  )
}

export * as WorkflowDiffSummary from "./diff-summary"