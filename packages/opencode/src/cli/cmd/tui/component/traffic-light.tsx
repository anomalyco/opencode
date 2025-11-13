import { useTheme } from "@tui/context/theme"
import { TextAttributes } from "@opentui/core"
import { createMemo, Show } from "solid-js"

export function TrafficLight(props: {
  priority: "high" | "medium" | "low"
  urgency?: "immediate" | "soon" | "later"
  reasoning?: string
  onMouseUp?: () => void
}) {
  const { theme } = useTheme()

  const lightColor = createMemo(() => {
    switch (props.priority) {
      case "high":
        return props.urgency === "immediate" ? "#FF0000" : "#FF6600" // Red or orange
      case "medium":
        return "#FFFF00" // Yellow
      case "low":
        return "#00FF00" // Green
    }
  })

  const lightSymbol = createMemo(() => {
    switch (props.priority) {
      case "high":
        return props.urgency === "immediate" ? "🔴" : "🟠"
      case "medium":
        return "🟡"
      case "low":
        return "🟢"
    }
  })

  return (
    <box flexDirection="row" gap={1} alignItems="center">
      <text
        fg={lightColor()}
        attributes={TextAttributes.BOLD}
        onMouseUp={() => {
          if (props.onMouseUp) props.onMouseUp()
        }}
      >
        {lightSymbol()}
      </text>
      <Show when={props.reasoning}>
        <text
          fg={theme.textMuted}
          onMouseUp={() => {
            if (props.onMouseUp) props.onMouseUp()
          }}
        >
          {props.priority.toUpperCase()}
          {props.urgency === "immediate" ? " URGENT" : ""}
        </text>
      </Show>
    </box>
  )
}
