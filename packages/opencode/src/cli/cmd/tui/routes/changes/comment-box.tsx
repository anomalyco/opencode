import { createMemo, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import type { TextareaRenderable } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useTextareaKeybindings } from "@tui/component/textarea-keybindings"
import { SplitBorder } from "@tui/component/border"

export interface Comment {
  id: string
  lineIndex: number
  text: string
  lineType?: LineType
  anchor?: string
}

export type LineType = "add" | "remove" | "context" | "empty"
export type CommentSide = "left" | "right" | "unified"

function getBorderColor(theme: ReturnType<typeof useTheme>["theme"], lineType: LineType | undefined) {
  switch (lineType) {
    case "add":
      return theme.diffHighlightAdded
    case "remove":
      return theme.diffHighlightRemoved
    default:
      return theme.primary
  }
}

interface CommentInputProps {
  line: number
  focused: boolean
  lineType?: LineType
  onSubmit: (line: number, text: string) => void
  onCancel: () => void
}

export function CommentInput(props: CommentInputProps) {
  let input: TextareaRenderable | undefined
  const { theme } = useTheme()
  const textareaKeybindings = useTextareaKeybindings()

  const borderColor = createMemo(() => getBorderColor(theme, props.lineType))

  useKeyboard((evt) => {
    if (!props.focused) return

    if (evt.name === "escape") {
      evt.preventDefault()
      input?.blur()
      props.onCancel()
      return
    }
    if (evt.name === "return") {
      evt.preventDefault()
      const text = input?.plainText ?? ""
      input?.blur()
      if (text.trim()) {
        props.onSubmit(props.line, text)
      } else {
        props.onCancel()
      }
    }
  })

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={borderColor()}
      customBorderChars={SplitBorder.customBorderChars}
      width="100%"
    >
      <box paddingLeft={2} paddingTop={1} paddingBottom={1}>
        <text fg={theme.text}>Comment</text>
      </box>
      <box
        flexShrink={0}
        paddingLeft={2}
        paddingRight={3}
        paddingTop={1}
        paddingBottom={1}
        backgroundColor={theme.backgroundElement}
      >
        <textarea
          ref={(val: TextareaRenderable) => (input = val)}
          focused
          textColor={theme.text}
          focusedTextColor={theme.text}
          cursorColor={theme.primary}
          keyBindings={textareaKeybindings()}
        />
      </box>
    </box>
  )
}

interface CommentDisplayProps {
  comment: Comment
  focused: boolean
  lineType?: LineType
  onEdit: () => void
  onDelete: () => void
  onFocus: () => void
}

export function CommentDisplay(props: CommentDisplayProps) {
  const { theme } = useTheme()

  const borderColor = createMemo(() => getBorderColor(theme, props.lineType ?? props.comment.lineType))

  useKeyboard((evt) => {
    if (!props.focused) return

    if (evt.name === "return" || evt.name === "e") {
      evt.preventDefault()
      props.onEdit()
      return
    }
    if (evt.name === "d") {
      evt.preventDefault()
      props.onDelete()
      return
    }
  })

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={borderColor()}
      customBorderChars={SplitBorder.customBorderChars}
      width="100%"
      onMouseUp={props.onFocus}
    >
      <box paddingLeft={2} paddingTop={1} paddingBottom={1}>
        <text fg={theme.text}>Comment</text>
      </box>
      <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
        <text fg={theme.text} wrapMode="word">
          {props.comment.text}
        </text>
      </box>
      <Show when={props.focused}>
        <box flexDirection="row" gap={2} paddingLeft={2} paddingRight={2} paddingBottom={1}>
          <box backgroundColor={theme.primary} paddingLeft={1} paddingRight={1} onMouseUp={props.onEdit}>
            <text fg={theme.background}>Edit (e)</text>
          </box>
          <box backgroundColor={theme.error} paddingLeft={1} paddingRight={1} onMouseUp={props.onDelete}>
            <text fg={theme.background}>Delete (d)</text>
          </box>
        </box>
      </Show>
    </box>
  )
}
