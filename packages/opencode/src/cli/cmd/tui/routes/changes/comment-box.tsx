import { createMemo, Show, type JSX } from "solid-js"
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
export type CommentInputState = {
  line: number
  side: CommentSide
  lineType: LineType
  anchor?: string
}

type SlotOptions = {
  view: "split" | "unified"
  input: CommentInputState | null
  comments: Map<string, Comment>
  focused: string | null
  onSubmit: (line: number, side: CommentSide, text: string) => void
  onCancel: () => void
  onEdit: (key: string) => void
  onDelete: (key: string) => void
  onFocus: (key: string) => void
}

type Entry = {
  left?: Comment
  right?: Comment
  unified?: Comment
}

export function makeKey(anchor: string, side: CommentSide): string {
  return `${anchor}-${side}`
}

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
    switch (evt.name) {
      case "escape":
        evt.preventDefault()
        input?.blur()
        props.onCancel()
        return

      case "return": {
        evt.preventDefault()
        const text = input?.plainText?.trim()

        input?.blur()

        if (text) {
          props.onSubmit(props.line, text)
          return
        }

        props.onCancel()
        return
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

function SplitInput(props: {
  input: CommentInputState
  onSubmit: (line: number, side: CommentSide, text: string) => void
  onCancel: () => void
}) {
  return (
    <box flexDirection="row" width="100%">
      {props.input.side === "left" ? (
        <>
          <box width="50%">
            <CommentInput
              line={props.input.line}
              focused={true}
              lineType={props.input.lineType}
              onSubmit={(line, text) => props.onSubmit(line, props.input.side, text)}
              onCancel={props.onCancel}
            />
          </box>
          <box width="50%" />
        </>
      ) : (
        <>
          <box width="50%" />
          <box width="50%">
            <CommentInput
              line={props.input.line}
              focused={true}
              lineType={props.input.lineType}
              onSubmit={(line, text) => props.onSubmit(line, props.input.side, text)}
              onCancel={props.onCancel}
            />
          </box>
        </>
      )}
    </box>
  )
}

function UnifiedInput(props: {
  input: CommentInputState
  onSubmit: (line: number, side: CommentSide, text: string) => void
  onCancel: () => void
}) {
  return (
    <CommentInput
      line={props.input.line}
      focused={true}
      lineType={props.input.lineType}
      onSubmit={(line, text) => props.onSubmit(line, "unified", text)}
      onCancel={props.onCancel}
    />
  )
}

function SplitComments(props: {
  line: number
  entry: Entry
  focused: string | null
  onEdit: (key: string) => void
  onDelete: (key: string) => void
  onFocus: (key: string) => void
}) {
  return (
    <box flexDirection="row" width="100%">
      <box width="50%">
        {props.entry.left
          ? (() => {
              const key = makeKey(props.entry.left.anchor ?? `v:${props.line}`, "left")
              return (
                <CommentDisplay
                  comment={props.entry.left}
                  focused={props.focused === key}
                  onEdit={() => props.onEdit(key)}
                  onDelete={() => props.onDelete(key)}
                  onFocus={() => props.onFocus(key)}
                />
              )
            })()
          : null}
      </box>
      <box width="50%">
        {props.entry.right
          ? (() => {
              const key = makeKey(props.entry.right.anchor ?? `v:${props.line}`, "right")
              return (
                <CommentDisplay
                  comment={props.entry.right}
                  focused={props.focused === key}
                  onEdit={() => props.onEdit(key)}
                  onDelete={() => props.onDelete(key)}
                  onFocus={() => props.onFocus(key)}
                />
              )
            })()
          : null}
      </box>
    </box>
  )
}

export function commentSlots(opts: SlotOptions): Map<number, JSX.Element> {
  const slots = new Map<number, JSX.Element>()

  // input slot
  if (opts.input) {
    const split = opts.view === "split" && opts.input.side !== "unified"

    slots.set(
      opts.input.line,
      split ? (
        <SplitInput input={opts.input} onSubmit={opts.onSubmit} onCancel={opts.onCancel} />
      ) : (
        <UnifiedInput input={opts.input} onSubmit={opts.onSubmit} onCancel={opts.onCancel} />
      ),
    )
  }

  if (opts.comments.size === 0) return slots

  // group comments by line
  const lines = new Map<number, Entry>()

  for (const [key, comment] of opts.comments) {
    const line = comment.lineIndex
    const entry = lines.get(line) ?? (lines.set(line, {}), lines.get(line)!)

    const side = key.slice(key.lastIndexOf("-") + 1) as CommentSide

    switch (side) {
      case "left":
        entry.left = comment
        break
      case "right":
        entry.right = comment
        break
      default:
        entry.unified = comment
    }
  }

  // render comment slots
  if (opts.view === "split") {
    for (const [line, entry] of lines) {
      if (slots.has(line)) continue

      if (entry.unified) {
        const key = makeKey(entry.unified.anchor ?? `v:${line}`, "unified")
        slots.set(
          line,
          <CommentDisplay
            comment={entry.unified}
            focused={opts.focused === key}
            onEdit={() => opts.onEdit(key)}
            onDelete={() => opts.onDelete(key)}
            onFocus={() => opts.onFocus(key)}
          />,
        )
        continue
      }

      slots.set(
        line,
        <SplitComments
          line={line}
          entry={entry}
          focused={opts.focused}
          onEdit={opts.onEdit}
          onDelete={opts.onDelete}
          onFocus={opts.onFocus}
        />,
      )
    }

    return slots
  }

  for (const [line, entry] of lines) {
    if (slots.has(line)) continue

    const comment = entry.unified ?? entry.right ?? entry.left
    if (!comment) continue

    const side = entry.unified ? "unified" : entry.right ? "right" : "left"
    const key = makeKey(comment.anchor ?? `v:${line}`, side)

    slots.set(
      line,
      <CommentDisplay
        comment={comment}
        focused={opts.focused === key}
        onEdit={() => opts.onEdit(key)}
        onDelete={() => opts.onDelete(key)}
        onFocus={() => opts.onFocus(key)}
      />,
    )
  }

  return slots
}
