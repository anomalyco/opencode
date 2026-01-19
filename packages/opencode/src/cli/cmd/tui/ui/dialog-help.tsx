import { ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { useTheme } from "../context/theme"
import { For, createMemo } from "solid-js"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"

export function DialogHelp() {
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()

  const commands = [
    { key: "j/down", description: "Move down" },
    { key: "k/up", description: "Move up" },
    { key: "enter", description: "Select/Confirm" },
    { key: "esc/q", description: "Back/Close" },
    { key: "ctrl+p", description: "Command palette" },
    { key: "/", description: "Search" },
    { key: "tab", description: "Switch focus" },
    { key: "ctrl+l", description: "Clear logs" },
    { key: "ctrl+c", description: "Exit" },
  ]

  let scroll: ScrollBoxRenderable | undefined

  useKeyboard((evt) => {
    if (!scroll) return
    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
      scroll.scrollBy(-1)
      evt.preventDefault()
      evt.stopPropagation()
    }
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      scroll.scrollBy(1)
      evt.preventDefault()
      evt.stopPropagation()
    }
    if (evt.name === "pageup") {
      scroll.scrollBy(-Math.floor(scroll.height / 2))
      evt.preventDefault()
      evt.stopPropagation()
    }
    if (evt.name === "pagedown") {
      scroll.scrollBy(Math.floor(scroll.height / 2))
      evt.preventDefault()
      evt.stopPropagation()
    }
  })

  const maxHeight = createMemo(() => Math.floor(dimensions().height * 0.6))

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between" marginBottom={1}>
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Keyboard Shortcuts
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>
      <scrollbox
        ref={(r: ScrollBoxRenderable) => {
          scroll = r
        }}
        maxHeight={maxHeight()}
        backgroundColor={theme.backgroundPanel}
      >
        <For each={commands}>
          {(cmd) => (
            <box flexDirection="row" gap={2}>
              <text fg={theme.primary} flexShrink={0} style={{ width: 12 }}>
                {cmd.key}
              </text>
              <text fg={theme.text}>{cmd.description}</text>
            </box>
          )}
        </For>
      </scrollbox>
    </box>
  )
}
