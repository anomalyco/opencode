import { createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { useTheme, selectedForeground } from "../../context/theme"
import { SplitBorder } from "../../component/border"
import type { ReproductionStepsAction, ReproductionStepsRequest } from "@opencode-ai/sdk/v2"
import { useSDK } from "../../context/sdk"
import { useKeybind } from "../../context/keybind"
import { useDialog } from "../../ui/dialog"

type Action = "proceed" | "fixed"

export function ReproductionStepsPrompt(props: { request: ReproductionStepsRequest }) {
  const sdk = useSDK()
  const { theme } = useTheme()
  const keybind = useKeybind()
  const dialog = useDialog()
  const renderer = useRenderer()
  const keys = ["proceed", "fixed"] as const
  const labels = createMemo(() => ({
    proceed: "Proceed",
    fixed: "Mark as Fixed",
  }))
  const [store, setStore] = createStore<{ selected: Action }>({
    selected: "proceed",
  })

  function submit(action: Action) {
    sdk.client.reproductionSteps
      .reply({
        requestID: props.request.id,
        reproductionStepsReply: {
          action,
        },
      })
      .catch(() => {})
  }

  useKeyboard((evt) => {
    if (dialog.stack.length > 0) return
    if (evt.name === "left" || evt.name === "h") {
      evt.preventDefault()
      const idx = keys.indexOf(store.selected)
      const next = keys[(idx - 1 + keys.length) % keys.length]
      setStore("selected", next)
    }
    if (evt.name === "right" || evt.name === "l") {
      evt.preventDefault()
      const idx = keys.indexOf(store.selected)
      const next = keys[(idx + 1) % keys.length]
      setStore("selected", next)
    }
    if (evt.name === "return") {
      evt.preventDefault()
      submit(store.selected)
    }
    if (evt.name === "escape" || keybind.match("app_exit", evt)) {
      evt.preventDefault()
      sdk.client.reproductionSteps
        .reply({
          requestID: props.request.id,
          reproductionStepsReply: {
            action: "skipped" as ReproductionStepsAction,
          },
        })
        .catch(() => {})
    }
  })

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.warning}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1}>
        <box flexDirection="row" gap={1} paddingLeft={1}>
          <text fg={theme.warning}>{"△"}</text>
          <text fg={theme.text}>Reproduction steps</text>
        </box>
        <box paddingLeft={1} gap={0}>
          {props.request.steps.map((step, index) => {
            const formatted = /^\d+\.\s+/.test(step) ? step : `${index + 1}. ${step}`
            return <text fg={theme.text}>{formatted}</text>
          })}
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
          {keys.map((option) => (
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={option === store.selected ? theme.warning : theme.backgroundMenu}
              onMouseUp={() => {
                if (renderer.getSelection()?.getSelectedText()) return
                setStore("selected", option)
                submit(option)
              }}
            >
              <text fg={option === store.selected ? selectedForeground(theme, theme.warning) : theme.textMuted}>
                {labels()[option]}
              </text>
            </box>
          ))}
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
