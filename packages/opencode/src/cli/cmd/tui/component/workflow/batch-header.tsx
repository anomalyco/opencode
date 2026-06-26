import { createMemo, type Accessor } from "solid-js"
import { useTheme } from "@tui/context/theme"

export function BatchHeader(props: {
  index: Accessor<number>
  count: Accessor<number>
  status: Accessor<"running" | "done" | "failed">
}) {
  const { theme } = useTheme()
  const label = createMemo(() => `Batch ${props.index() + 1} · ${props.count()} ${props.count() === 1 ? "worker" : "workers"}`)
  const color = createMemo(() => (props.status() === "failed" ? theme.error : theme.textMuted))
  return (
    <box flexDirection="row" gap={1} flexShrink={0}>
      <text fg={color()}>{label()}</text>
    </box>
  )
}

export * as WorkflowBatchHeader from "./batch-header"