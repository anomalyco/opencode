import { createMemo, For } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { selectedForeground, useTheme } from "../../context/theme"
import { useSDK } from "../../context/sdk"
import { SplitBorder } from "../../component/border"
import { createStore } from "solid-js/store"
import { useKeybind } from "../../context/keybind"
import { useDialog } from "../../ui/dialog"
import { useTerminalDimensions } from "@opentui/solid"

export function OverflowPrompt(props: { request: { id: string; sessionID: string } }) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const keybind = useKeybind()
  const dimensions = useTerminalDimensions()
  const narrow = createMemo(() => dimensions().width < 80)
  const dialog = useDialog()

  const options = { compact: "Compact conversation", rlm: "Switch to RLM mode" } as const
  const keys = Object.keys(options) as (keyof typeof options)[]
  const [store, setStore] = createStore({ selected: keys[0] as keyof typeof options })

  useKeyboard((evt) => {
    if (dialog.stack.length > 0) return

    if (evt.name === "left" || evt.name === "h") {
      evt.preventDefault()
      const idx = keys.indexOf(store.selected)
      setStore("selected", keys[(idx - 1 + keys.length) % keys.length])
    }
    if (evt.name === "right" || evt.name === "l") {
      evt.preventDefault()
      const idx = keys.indexOf(store.selected)
      setStore("selected", keys[(idx + 1) % keys.length])
    }
    if (evt.name === "return") {
      evt.preventDefault()
      sdk.client.session.rlmOverflowReply({
        sessionID: props.request.sessionID,
        requestID: props.request.id,
        choice: store.selected,
      })
    }
  })

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.accent}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1}>
        <box flexDirection="row" gap={1} paddingLeft={1} flexShrink={0}>
          <text fg={theme.accent}>{"◈"}</text>
          <text fg={theme.text}>Context window overflow</text>
        </box>
        <box paddingLeft={1}>
          <text fg={theme.textMuted}>
            The conversation has exceeded the model's context window. You can compact (summarize) the conversation or
            switch to RLM mode which handles large contexts natively.
          </text>
        </box>
      </box>
      <box
        flexDirection={narrow() ? "column" : "row"}
        flexShrink={0}
        gap={1}
        paddingTop={1}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        backgroundColor={theme.backgroundElement}
        justifyContent={narrow() ? "flex-start" : "space-between"}
        alignItems={narrow() ? "flex-start" : "center"}
      >
        <box flexDirection="row" gap={1} flexShrink={0}>
          <For each={keys}>
            {(option) => (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={option === store.selected ? theme.accent : theme.backgroundMenu}
                onMouseOver={() => setStore("selected", option)}
                onMouseUp={() => {
                  setStore("selected", option)
                  sdk.client.session.rlmOverflowReply({
                    sessionID: props.request.sessionID,
                    requestID: props.request.id,
                    choice: option,
                  })
                }}
              >
                <text fg={option === store.selected ? selectedForeground(theme, theme.accent) : theme.textMuted}>
                  {options[option]}
                </text>
              </box>
            )}
          </For>
        </box>
        <box flexDirection="row" gap={2} flexShrink={0}>
          <text fg={theme.text}>
            {"⇆"} <span style={{ fg: theme.textMuted }}>select</span>
          </text>
          <text fg={theme.text}>
            enter <span style={{ fg: theme.textMuted }}>confirm</span>
          </text>
        </box>
      </box>
    </box>
  )
}
