import { TextareaRenderable, TextAttributes, type RGBA } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createSignal, onCleanup, onMount } from "solid-js"
import { useTheme } from "../context/theme"
import { useTuiConfig } from "../config"
import { useBindings } from "../keymap"
import { createPromptUndo } from "../prompt/undo"
import { useDialog } from "../ui/dialog"
import { PromptFrame, promptFrameRows } from "./prompt/frame"
import { onClick } from "../ui/click"

export type DialogPasteProps = {
  text: string
  // The prompt's bar color, so the editor's box matches the prompt's.
  color: RGBA
  onChange(text: string): void
  onInline(): void
}

// The text behind a paste placeholder, in the prompt's own editor and box: the same textarea,
// input keybinds, mouse caret placement and grouped undo, without the agent line. Enter saves and
// closes, as Esc does, and the prompt's newline keys add a line. Above the editor, Keep as block
// does the same as Enter and Insert inline replaces the placeholder with the text. Tab and
// shift+tab move between the editor and the two buttons wherever the caret is; Up on the editor's
// first row also reaches them, Enter presses the focused one and Down goes back to the text.
export function DialogPaste(props: DialogPasteProps) {
  const dialog = useDialog()
  const { theme, syntax } = useTheme()
  const tuiConfig = useTuiConfig()
  const dimensions = useTerminalDimensions()
  const [target, setTarget] = createSignal<TextareaRenderable>()
  const [lines, setLines] = createSignal(props.text.split("\n").length)
  const [rows, setRows] = createSignal(props.text.split("\n").length)
  const [focus, setFocus] = createSignal<Focus>("editor")
  const [pressed, setPressed] = createSignal<Exclude<Focus, "editor">>()
  const undo = createPromptUndo({ depth: () => tuiConfig.prompt?.undo_depth ?? 500 })
  let textarea: TextareaRenderable
  let applying = false
  let pressing: ReturnType<typeof setTimeout> | undefined
  onCleanup(() => clearTimeout(pressing))

  // The dialog starts a quarter of the way down the screen (ui/dialog.tsx), and around the editor
  // it has 7 rows: its top padding, the title, two gaps, the button row, the hint row under the
  // box and its bottom padding, plus the prompt box's own rows. The editor is as tall as the text
  // once wrapped at its width, up to what is left above a one-row margin; longer text scrolls
  // inside it.
  const editorHeight = () => {
    const room = dimensions().height - Math.ceil(dimensions().height / 4) - 8 - promptFrameRows(true)
    return Math.max(1, Math.min(room, Math.max(3, rows())))
  }

  function measure() {
    if (!textarea || textarea.isDestroyed) return
    setRows(textarea.editorView.getTotalVirtualLineCount())
  }

  function focusOn(next: Focus) {
    setFocus(next)
    if (!textarea || textarea.isDestroyed) return
    if (next === "editor") return textarea.focus()
    textarea.blur()
  }

  function cycle(offset: number) {
    focusOn(order[(order.indexOf(focus()) + offset + order.length) % order.length])
  }

  // Shown pressed for a moment, so a key press reads as one before the dialog closes.
  function press(button: Exclude<Focus, "editor">) {
    if (pressed()) return
    focusOn(button)
    setPressed(button)
    pressing = setTimeout(() => {
      if (button === "inline") props.onInline()
      dialog.clear()
    }, 120)
  }

  const state = () => ({ input: textarea.plainText, parts: [], mode: "normal" as const, cursor: textarea.cursorOffset })

  function step(direction: "undo" | "redo") {
    undo.observe(state())
    const next = direction === "undo" ? undo.undo(state()) : undo.redo(state())
    if (!next) return
    applying = true
    textarea.setText(next.input)
    textarea.cursorOffset = next.cursor
    applying = false
    undo.sync(state())
    props.onChange(next.input)
  }

  useBindings(() => ({
    target,
    enabled: target() !== undefined,
    priority: 1,
    commands: [
      { name: "input.submit", title: "Save and close", category: "Dialog", run: () => dialog.clear() },
      { name: "input.undo", title: "Undo", category: "Dialog", run: () => step("undo") },
      { name: "input.redo", title: "Redo", category: "Dialog", run: () => step("redo") },
      {
        name: "input.move.up",
        title: "Up, or to the buttons from the first row",
        category: "Dialog",
        run: () => {
          if (textarea.scrollY + textarea.visualCursor.visualRow === 0) return focusOn("keep")
          textarea.moveCursorUp()
        },
      },
    ],
  }))

  // Not tied to the editor, so they work from the buttons too, and before the prompt's own Tab.
  useBindings(() => ({
    priority: 1,
    bindings: [
      { key: "tab", desc: "Next in the paste dialog", group: "Dialog", cmd: () => cycle(1) },
      { key: "shift+tab", desc: "Previous in the paste dialog", group: "Dialog", cmd: () => cycle(-1) },
    ],
  }))

  // While a button has focus the editor does not, so these keys are not tied to it.
  useBindings(() => ({
    enabled: focus() !== "editor",
    priority: 1,
    commands: [
      {
        name: "dialog.paste.press",
        title: "Press the focused button",
        category: "Dialog",
        run: () => {
          const current = focus()
          if (current !== "editor") press(current)
        },
      },
      { name: "dialog.paste.editor", title: "Back to the text", category: "Dialog", run: () => focusOn("editor") },
    ],
    bindings: [
      ...tuiConfig.keybinds.get("input.submit").map((binding) => ({ ...binding, cmd: "dialog.paste.press" })),
      ...tuiConfig.keybinds.get("input.move.down").map((binding) => ({ ...binding, cmd: "dialog.paste.editor" })),
      { key: "left", desc: "Previous button", group: "Dialog", cmd: () => focusOn("keep") },
      { key: "right", desc: "Next button", group: "Dialog", cmd: () => focusOn("inline") },
    ],
  }))

  onMount(() => {
    dialog.setSize("xlarge")
    textarea.gotoBufferHome()
    undo.sync(state())
    setTimeout(() => {
      if (!textarea || textarea.isDestroyed) return
      textarea.focus()
      measure()
    }, 1)
  })

  const button = (name: Exclude<Focus, "editor">, label: string) => (
    <box
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={focus() === name ? theme.primary : theme.backgroundElement}
      {...onClick(() => press(name))}
    >
      <text
        fg={focus() === name ? theme.selectedListItemText : theme.text}
        attributes={pressed() === name ? TextAttributes.BOLD | TextAttributes.INVERSE : 0}
      >
        {label}
      </text>
    </box>
  )

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <text attributes={TextAttributes.BOLD} fg={theme.text}>
        Pasted text <span style={{ fg: theme.textMuted }}>{lines()} lines</span>
      </text>
      <box flexDirection="row" gap={2}>
        {button("keep", "Keep as block")}
        {button("inline", "Insert inline")}
      </box>
      <box>
        <PromptFrame color={props.color} padBottom>
          <textarea
            width="100%"
            height={editorHeight()}
            initialValue={props.text}
            ref={(value: TextareaRenderable) => {
              textarea = value
              setTarget(value)
            }}
            onContentChange={() => {
              const text = textarea.plainText
              setLines(text.split("\n").length)
              measure()
              props.onChange(text)
              if (!applying) undo.observe(state())
            }}
            onCursorChange={() => {
              if (!applying) undo.observe(state())
            }}
            onSizeChange={measure}
            onMouseDown={() => focusOn("editor")}
            textColor={theme.text}
            focusedTextColor={theme.text}
            backgroundColor={theme.backgroundElement}
            focusedBackgroundColor={theme.backgroundElement}
            cursorColor={theme.text}
            cursorStyle={tuiConfig.cursor}
            syntaxStyle={syntax()}
          />
        </PromptFrame>
        {/* Placed like the prompt's own hints under its box, such as ctrl+p commands. */}
        <box flexDirection="row" justifyContent="flex-end" gap={2}>
          <text fg={theme.text} {...onClick(() => cycle(1))}>
            tab <span style={{ fg: theme.textMuted }}>switch</span>
          </text>
          <text fg={theme.text} {...onClick(() => dialog.clear())}>
            {focus() === "inline" ? "esc" : "esc/enter"} <span style={{ fg: theme.textMuted }}>save</span>
          </text>
        </box>
      </box>
    </box>
  )
}

type Focus = "editor" | "keep" | "inline"

const order: Focus[] = ["editor", "keep", "inline"]
