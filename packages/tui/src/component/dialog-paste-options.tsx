import { ScrollBoxRenderable, TextareaRenderable, TextAttributes, type RGBA } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createSignal, For, onMount } from "solid-js"
import { useTheme } from "../context/theme"
import { useKV } from "../context/kv"
import { useTuiConfig } from "../config"
import { useBindings } from "../keymap"
import { useDialog } from "../ui/dialog"
import { onClick } from "../ui/click"
import { pasteLabel } from "../prompt/paste"
import {
  cleanPaste,
  pasteOptionDisabled,
  PasteOptionList,
  PasteOptionsDefault,
  PasteOptionsKVKey,
  togglePasteOption,
  unwrapPaste,
  wrapPaste,
  type PasteOptionKey,
  type PasteOptions,
} from "../prompt/paste-options"
import { PromptFrame, promptFrameRows } from "./prompt/frame"

// A paste as it came in and what was chosen for it. `body` is the text inside the wraps once it was
// edited by hand; until then it is the source with the cleanups applied, and they can be undone.
export type PasteOrigin = { source: string; options: PasteOptions; body?: string }
export type PasteResult = { text: string; inline: boolean; origin: PasteOrigin }

// The paste dialog of prompt.paste_mode 'dialog': the options on the left, and on the right the
// paste as it will go in, in the prompt's own editor and box, updated as options change and
// editable. Space toggles the selected option, enter pastes, esc cancels. Right or tab moves from the
// options to the editor, where space and arrows work as usual and enter still pastes; tab goes back.
export function DialogPasteOptions(props: { origin: PasteOrigin; color: RGBA; onPaste(result: PasteResult): void }) {
  const dialog = useDialog()
  const { theme, syntax } = useTheme()
  const tuiConfig = useTuiConfig()
  const kv = useKV()
  const dimensions = useTerminalDimensions()
  const [options, setOptions] = createSignal(props.origin.options)
  const [body, setBody] = createSignal(props.origin.body ?? cleanPaste(props.origin.source, props.origin.options))
  const [text, setText] = createSignal(wrapPaste(body(), options()))
  const [focus, setFocus] = createSignal<"options" | "editor">("options")
  const [selected, setSelected] = createSignal(0)
  const [rows, setRows] = createSignal(1)
  const [target, setTarget] = createSignal<TextareaRenderable>()
  let edited = props.origin.body !== undefined
  let textarea: TextareaRenderable
  let list: ScrollBoxRenderable | undefined

  // The dialog starts a quarter of the way down the screen (ui/dialog.tsx). Around the editor it has
  // 6 rows: its top padding, the title, a gap, the hint row under the box, its bottom padding and a
  // one-row margin, plus the prompt box's own rows. The editor is as tall as the paste once wrapped,
  // and at least as tall as the options beside it, up to the room left; longer text scrolls.
  const editorHeight = () => {
    const room = dimensions().height - Math.ceil(dimensions().height / 4) - 6 - promptFrameRows(true)
    const beside = listHeight() - promptFrameRows(true) - 1
    return Math.max(1, Math.min(room, Math.max(beside, rows())))
  }

  // The options get the same rows as the editor's column; on a short screen they scroll, following
  // the selection.
  const listHeight = () =>
    Math.max(1, Math.min(PasteOptionList.length, dimensions().height - Math.ceil(dimensions().height / 4) - 6))

  createEffect(() => {
    const index = selected()
    const height = listHeight()
    if (!list || list.isDestroyed) return
    if (index < list.scrollTop) list.scrollTo(index)
    if (index >= list.scrollTop + height) list.scrollTo(index - height + 1)
  })

  function measure() {
    if (!textarea || textarea.isDestroyed) return
    setRows(textarea.editorView.getTotalVirtualLineCount())
  }

  function show() {
    setText(wrapPaste(body(), options()))
    if (!textarea || textarea.isDestroyed) return
    textarea.setText(text())
    measure()
  }

  // Before an edit, a cleanup turned off brings back the source; after one, only turning a cleanup
  // on can change the text, since what the edit replaced is gone.
  function toggle(key: PasteOptionKey) {
    if (pasteOptionDisabled(key, body(), options())) return
    const next = togglePasteOption(options(), key)
    setOptions(next)
    kv.set(PasteOptionsKVKey, next)
    if (!edited) setBody(cleanPaste(props.origin.source, next))
    if (edited && next[key]) setBody(cleanPaste(body(), { ...PasteOptionsDefault, [key]: true }))
    show()
  }

  // The editor reports a change a microtask after it happened, so the dialog's own setText reaches
  // here too, once the dialog is done; a flag set around setText would already be cleared. A change
  // is a hand edit only when the editor no longer holds the text the dialog last showed.
  function adoptEdit() {
    measure()
    if (textarea.plainText === text()) return
    setText(textarea.plainText)
    const unwrapped = unwrapPaste(textarea.plainText, options())
    setBody(unwrapped.body)
    setOptions(unwrapped.options)
    edited = true
  }

  function focusOn(next: "options" | "editor") {
    setFocus(next)
    if (!textarea || textarea.isDestroyed) return
    if (next === "editor") return textarea.focus()
    textarea.blur()
  }

  function paste() {
    props.onPaste({
      text: text(),
      inline: options().inline,
      origin: { source: props.origin.source, options: options(), body: edited ? body() : undefined },
    })
    dialog.clear()
  }

  const checked = (key: PasteOptionKey) => options()[key] && !pasteOptionDisabled(key, body(), options())

  useBindings(() => ({
    priority: 1,
    bindings: [
      { key: "tab", desc: "Options or editor", group: "Dialog", cmd: () => focusOn(focus() === "editor" ? "options" : "editor") },
      {
        key: "shift+tab",
        desc: "Options or editor",
        group: "Dialog",
        cmd: () => focusOn(focus() === "editor" ? "options" : "editor"),
      },
    ],
  }))

  useBindings(() => ({
    target,
    enabled: target() !== undefined,
    priority: 1,
    commands: [{ name: "input.submit", title: "Paste", category: "Dialog", run: paste }],
  }))

  // While the options have focus the editor does not, so these keys are not tied to it.
  useBindings(() => ({
    enabled: focus() === "options",
    priority: 1,
    commands: [{ name: "dialog.paste.paste", title: "Paste", category: "Dialog", run: paste }],
    bindings: [
      ...tuiConfig.keybinds.get("input.submit").map((binding) => ({ ...binding, cmd: "dialog.paste.paste" })),
      { key: "right", desc: "To the editor", group: "Dialog", cmd: () => focusOn("editor") },
      {
        key: "space",
        desc: "Toggle paste option",
        group: "Dialog",
        cmd: () => toggle(PasteOptionList[selected()].key),
      },
      {
        key: "up",
        desc: "Previous paste option",
        group: "Dialog",
        cmd: () => setSelected((index) => (index + PasteOptionList.length - 1) % PasteOptionList.length),
      },
      {
        key: "down",
        desc: "Next paste option",
        group: "Dialog",
        cmd: () => setSelected((index) => (index + 1) % PasteOptionList.length),
      },
    ],
  }))

  onMount(() => {
    dialog.setSize("xlarge")
    textarea.gotoBufferHome()
    setTimeout(measure, 1)
  })

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between" gap={2}>
        <text attributes={TextAttributes.BOLD} fg={theme.text} flexShrink={0}>
          Paste <span style={{ fg: theme.textMuted }}>{text().split("\n").length} lines</span>
        </text>
        <text fg={theme.textMuted} wrapMode="none">
          {options().inline ? "goes in as text" : `goes in as ${pasteLabel(text(), tuiConfig.prompt?.paste_summary)}`}
        </text>
      </box>
      <box flexDirection="row" gap={2}>
        {/* A scroll box grows to fill the row unless told otherwise; this one is as wide as its rows:
            the widest label, its checkbox and its padding. */}
        <scrollbox
          flexGrow={0}
          flexShrink={0}
          width={Math.max(...PasteOptionList.map((option) => option.label.length)) + 6}
          height={listHeight()}
          scrollbarOptions={{ visible: false }}
          ref={(value: ScrollBoxRenderable) => (list = value)}
        >
          <For each={PasteOptionList}>
            {(option, index) => {
              const current = () => selected() === index()
              const disabled = () => pasteOptionDisabled(option.key, body(), options())
              return (
                <box
                  paddingLeft={1}
                  paddingRight={1}
                  backgroundColor={
                    current() ? (focus() === "options" ? theme.primary : theme.backgroundElement) : undefined
                  }
                  {...onClick(() => {
                    setSelected(index())
                    focusOn("options")
                    toggle(option.key)
                  })}
                >
                  <text
                    fg={
                      current() && focus() === "options"
                        ? theme.selectedListItemText
                        : disabled()
                          ? theme.textMuted
                          : theme.text
                    }
                    wrapMode="none"
                  >
                    {checked(option.key) ? "[x] " : "[ ] "}
                    {option.label}
                  </text>
                </box>
              )
            }}
          </For>
        </scrollbox>
        <box flexGrow={1} flexShrink={1}>
          <PromptFrame color={props.color} padBottom>
            <textarea
              width="100%"
              height={editorHeight()}
              initialValue={text()}
              ref={(value: TextareaRenderable) => {
                textarea = value
                setTarget(value)
              }}
              onContentChange={adoptEdit}
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
            {focus() === "options" ? (
              <text fg={theme.text}>
                space <span style={{ fg: theme.textMuted }}>toggle</span>
              </text>
            ) : undefined}
            <text fg={theme.text} {...onClick(() => focusOn(focus() === "editor" ? "options" : "editor"))}>
              {focus() === "editor" ? "tab" : "→/tab"}{" "}
              <span style={{ fg: theme.textMuted }}>{focus() === "editor" ? "options" : "edit"}</span>
            </text>
            <text fg={theme.text} {...onClick(paste)}>
              enter <span style={{ fg: theme.textMuted }}>paste</span>
            </text>
            <text fg={theme.text} {...onClick(() => dialog.clear())}>
              esc <span style={{ fg: theme.textMuted }}>cancel</span>
            </text>
          </box>
        </box>
      </box>
    </box>
  )
}
