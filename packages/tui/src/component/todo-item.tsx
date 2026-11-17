import { TextAttributes } from "@opentui/core"
import type { ResolvedTheme } from "@opencode/theme/tui"
import { todoMarker, type Todo } from "../util/todo"

export function TodoItem(props: { theme: ResolvedTheme; todo: Todo }) {
  const fg = () => {
    if (props.todo.status === "in_progress") return props.theme.text.feedback.warning.base
    if (props.todo.status === "cancelled") return props.theme.text.faint
    return props.theme.text.muted
  }

  return (
    <box flexDirection="row" gap={0}>
      <text flexShrink={0} fg={fg()}>
        {todoMarker(props.todo.status)}{" "}
      </text>
      <text
        flexGrow={1}
        wrapMode="word"
        fg={fg()}
        attributes={props.todo.status === "cancelled" ? TextAttributes.STRIKETHROUGH : undefined}
      >
        {props.todo.content}
      </text>
    </box>
  )
}
