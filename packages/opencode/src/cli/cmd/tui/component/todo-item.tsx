import { useTheme } from "../context/theme"

export interface TodoItemProps {
  id: string
  parentId?: string
  dependsOn?: string[]
  status: string
  content: string
  level?: number
  isBlocked?: boolean
}

export function TodoItem(props: TodoItemProps) {
  const { theme } = useTheme()
  const level = props.level || 0
  const indent = "  ".repeat(level)
  const isBlocked = props.isBlocked || false
  
  let fgColor = theme.textMuted
  let textDecoration: "line-through" | undefined = undefined
  
  if (props.status === "completed") {
    fgColor = theme.success
    textDecoration = "line-through"
  } else if (props.status === "in_progress") {
    fgColor = theme.warning
  } else if (props.status === "skipped") {
    fgColor = theme.textMuted
    textDecoration = "line-through"
  } else if (isBlocked) {
    fgColor = theme.textMuted
  }
  
  const statusIndicator = props.status === "completed" 
    ? "✓" 
    : props.status === "in_progress" 
      ? "•" 
      : props.status === "skipped"
        ? "✗"
        : " "

  return (
    <box flexDirection="row" gap={0}>
      <text flexShrink={0} style={{ fg: fgColor }}>
        {indent}[{statusIndicator}]{" "}
      </text>
      <text
        flexGrow={1}
        wrapMode="word"
        style={{ fg: fgColor }}
      >
        {props.content}
      </text>
    </box>
  )
}
