import { useTheme } from "../context/theme"
import { useAccessibility } from "@tui/util/accessibility"

export interface TodoItemProps {
  status: string
  content: string
}

export function TodoItem(props: TodoItemProps) {
  const { theme } = useTheme()
  const accessibility = useAccessibility()
  const marker = () => {
    if (!accessibility()) {
      return props.status === "completed" ? "✓" : props.status === "in_progress" ? "•" : " "
    }
    if (props.status === "completed") return "x"
    if (props.status === "in_progress") return "~"
    return " "
  }

  return (
    <box flexDirection="row" gap={0}>
      <text
        flexShrink={0}
        style={{
          fg: props.status === "in_progress" ? theme.warning : theme.textMuted,
        }}
      >
        [{marker()}]{" "}
      </text>
      <text
        flexGrow={1}
        wrapMode="word"
        style={{
          fg: props.status === "in_progress" ? theme.warning : theme.textMuted,
        }}
      >
        {props.content}
      </text>
    </box>
  )
}
