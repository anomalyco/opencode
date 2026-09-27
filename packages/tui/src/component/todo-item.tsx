import { TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"

export interface TodoItemProps {
  status: string
  content: string
}

export function todoPresentation(status: string) {
  if (status === "completed") return { marker: "✓", attributes: undefined }
  if (status === "in_progress") return { marker: "•", attributes: undefined }
  if (status === "cancelled") return { marker: "✕", attributes: TextAttributes.STRIKETHROUGH }
  return { marker: " ", attributes: undefined }
}

export function TodoItem(props: TodoItemProps) {
  const { theme } = useTheme()
  const presentation = () => todoPresentation(props.status)

  return (
    <box flexDirection="row" gap={0}>
      <text
        flexShrink={0}
        style={{
          fg: props.status === "in_progress" ? theme.warning : theme.textMuted,
        }}
      >
        [{presentation().marker}]{" "}
      </text>
      <text
        flexGrow={1}
        wrapMode="word"
        attributes={presentation().attributes}
        style={{
          fg: props.status === "in_progress" ? theme.warning : theme.textMuted,
        }}
      >
        {props.content}
      </text>
    </box>
  )
}
