import { createMemo, onMount } from "solid-js"
import { useLocal } from "@tui/context/local"
import { useDialog } from "@tui/ui/dialog"
import { useKeyboard, useTerminalDimensions } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { ScrollBoxRenderable, TextAttributes } from "@opentui/core"
import { DialogAgent } from "./dialog-agent"

export function DialogAgentDetails(props: { agentName: string }) {
  const local = useLocal()
  const dialog = useDialog()
  const { theme } = useTheme()
  const dimensions = useTerminalDimensions()

  const agent = createMemo(() => local.agent.list().find((a) => a.name === props.agentName))
  const maxHeight = Math.floor(dimensions().height / 2) - 4

  let scroll: ScrollBoxRenderable

  onMount(() => {
    dialog.setSize("large")
  })

  useKeyboard((evt) => {
    if (evt.name === "escape" || evt.name === "return") {
      evt.preventDefault()
      dialog.replace(() => <DialogAgent focusedAgent={props.agentName} />)
      return
    }
    if (evt.name === "up" || (evt.ctrl && evt.name === "p")) {
      scroll?.scrollBy(-1)
    }
    if (evt.name === "down" || (evt.ctrl && evt.name === "n")) {
      scroll?.scrollBy(1)
    }
    if (evt.name === "pageup") {
      scroll?.scrollBy(-10)
    }
    if (evt.name === "pagedown") {
      scroll?.scrollBy(10)
    }
  })

  return (
    <box gap={1} paddingBottom={1}>
      <box paddingLeft={4} paddingRight={4}>
        <box flexDirection="row" justifyContent="space-between">
          <text fg={theme.text} attributes={TextAttributes.BOLD}>
            {props.agentName}
          </text>
          <text fg={theme.textMuted}>esc</text>
        </box>
      </box>
      <scrollbox
        ref={(r: ScrollBoxRenderable) => (scroll = r)}
        paddingLeft={4}
        paddingRight={4}
        paddingTop={1}
        maxHeight={maxHeight}
      >
        {agent()?.shortDescription && (
          <text fg={theme.textMuted} wrapMode="word" marginBottom={1}>
            {agent()?.shortDescription}
          </text>
        )}
        {agent()?.description && (
          <box>
            <text fg={theme.text} wrapMode="word">
              {agent()?.description}
            </text>
          </box>
        )}
      </scrollbox>
      <box paddingLeft={4} paddingRight={4} paddingTop={1}>
        <text fg={theme.textMuted}>Press esc or enter to go back</text>
      </box>
    </box>
  )
}
