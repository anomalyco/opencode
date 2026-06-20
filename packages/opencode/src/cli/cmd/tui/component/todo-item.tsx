import { Show } from "solid-js"
import { useTheme } from "../context/theme"

export interface TodoItemProps {
  status: string
  content: string
  title?: string
  priority?: string
  level?: number
  parent_id?: string | null
  isExpanded?: boolean
  hasChildren?: boolean
}

const statusIcon = (status: string) => {
  switch (status) {
    case "pending":
      return "○"
    case "in_progress":
      return "●"
    case "completed":
      return "✓"
    case "cancelled":
      return "✗"
    default:
      return " "
  }
}

const priorityBadge = (priority: string | undefined, theme: ReturnType<typeof useTheme>["theme"]) => {
  switch (priority) {
    case "high":
      return { text: "H", fg: theme.error }
    case "medium":
      return { text: "M", fg: theme.warning }
    case "low":
      return { text: "L", fg: theme.textMuted }
    default:
      return null
  }
}

export function TodoItem(props: TodoItemProps) {
  const { theme } = useTheme()
  const level = props.level ?? 0
  const display = props.title || props.content
  const truncated = display.length > 60 ? display.slice(0, 57) + "..." : display
  const badge = priorityBadge(props.priority, theme)
  const icon = statusIcon(props.status)
  const isActive = props.status === "in_progress"

  return (
    <box flexDirection="row" gap={0} paddingLeft={level * 2}>
      <text
        flexShrink={0}
        style={{
          fg: isActive ? theme.warning : theme.textMuted,
        }}
      >
        {icon}{" "}
      </text>
      <Show when={badge}>
        <text
          flexShrink={0}
          style={{
            fg: badge!.fg,
          }}
        >
          [{badge!.text}]{" "}
        </text>
      </Show>
      <Show when={props.hasChildren}>
        <text fg={theme.textMuted}>{props.isExpanded ? "▼" : "▶"} </text>
      </Show>
      <text
        flexGrow={1}
        wrapMode="word"
        style={{
          fg: isActive ? theme.warning : level === 1 ? theme.textMuted : theme.text,
        }}
      >
        {truncated}
      </text>
    </box>
  )
}
