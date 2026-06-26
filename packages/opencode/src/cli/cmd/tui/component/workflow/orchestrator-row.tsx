import { createMemo, Show, type Accessor } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { Locale } from "@/util/locale"
import { Spinner } from "@tui/component/spinner"
import { useWorkflow } from "./use-workflow"

export function OrchestratorRow(props: { sessionID: Accessor<string | undefined> }) {
  const { theme } = useTheme()
  const wf = useWorkflow(props.sessionID)

  const summary = createMemo(() => {
    const text = wf.orchestratorThinking()
    if (!text) return undefined
    const trimmed = text.trim().replace(/\s+/g, " ")
    if (trimmed.length === 0) return undefined
    return Locale.truncate(trimmed, 60)
  })

  return (
    <Show when={summary()}>
      {(s) => (
        <box flexDirection="row" gap={1} flexShrink={0}>
          <Spinner color={theme.warning}>Orchestrator:</Spinner>
          <text fg={theme.text} wrapMode="none">
            {s()}
          </text>
        </box>
      )}
    </Show>
  )
}

export * as WorkflowOrchestratorRow from "./orchestrator-row"