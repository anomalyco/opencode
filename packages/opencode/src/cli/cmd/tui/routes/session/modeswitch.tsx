import { createStore } from "solid-js/store"
import { For } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useKeybind } from "../../context/keybind"
import { useTheme, selectedForeground } from "../../context/theme"
import { useSDK } from "../../context/sdk"
import { SplitBorder } from "../../component/border"
import { useLocal } from "../../context/local"
import type { ModeSwitchRequest } from "@opencode-ai/sdk/v2"

export function ModeSwitchPrompt(props: { request: ModeSwitchRequest }) {
  const sdk = useSDK()
  const local = useLocal()
  const { theme } = useTheme()
  const keybind = useKeybind()

  const [store, setStore] = createStore({
    selected: 0 as 0 | 1,
  })

  const options = ["Approve", "Reject"] as const

  function approve() {
    sdk.client.modeswitch.reply({
      requestID: props.request.id,
      reply: "approve",
    })
    local.agent.set(props.request.targetMode)
  }

  function reject() {
    sdk.client.modeswitch.reply({
      requestID: props.request.id,
      reply: "reject",
    })
  }

  useKeyboard((evt) => {
    if (evt.name === "left" || evt.name === "h") {
      evt.preventDefault()
      setStore("selected", store.selected === 0 ? 1 : 0)
    }

    if (evt.name === "right" || evt.name === "l") {
      evt.preventDefault()
      setStore("selected", store.selected === 0 ? 1 : 0)
    }

    if (evt.name === "return") {
      evt.preventDefault()
      if (store.selected === 0) {
        approve()
      } else {
        reject()
      }
    }

    if (evt.name === "escape" || keybind.match("app_exit", evt)) {
      evt.preventDefault()
      reject()
    }
  })

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.success}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1}>
        <box flexDirection="row" gap={1} paddingLeft={1}>
          <text fg={theme.success}>{"▣"}</text>
          <text fg={theme.text}>Switch to Build Mode?</text>
        </box>
        <box paddingLeft={1}>
          <text fg={theme.textMuted}>The assistant is ready to implement the plan.</text>
        </box>
        <box paddingLeft={1}>
          <text fg={theme.text}>{props.request.reason}</text>
        </box>
      </box>
      <box
        flexDirection="row"
        flexShrink={0}
        gap={1}
        paddingTop={1}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        backgroundColor={theme.backgroundElement}
        justifyContent="space-between"
      >
        <box flexDirection="row" gap={1}>
          <For each={options}>
            {(option, index) => (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={index() === store.selected ? theme.success : theme.backgroundMenu}
              >
                <text fg={index() === store.selected ? selectedForeground(theme, theme.success) : theme.textMuted}>
                  {option}
                </text>
              </box>
            )}
          </For>
        </box>
        <box flexDirection="row" gap={2}>
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
