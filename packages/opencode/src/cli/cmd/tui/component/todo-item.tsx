import { useTheme } from "../context/theme"

export interface TodoItemProps {
  status: string
  content: string
}

export function TodoItem(props: TodoItemProps) {
  const { theme } = useTheme()
  const color = props.status === "in_progress" ? theme.warning : theme.textMuted

  return (
    <box flexDirection="row" alignItems="center" gap={1}>
      <text
        flexShrink={0}
        style={{
          fg: color,
        }}
      >
        [{props.status === "completed" ? "✓" : props.status === "in_progress" ? "•" : " "}]
      </text>
      <text
        flexGrow={1}
        wrapMode="word"
        style={{
          fg: color,
        }}
      >
        {props.content}
      </text>
    </box>
  )
}
