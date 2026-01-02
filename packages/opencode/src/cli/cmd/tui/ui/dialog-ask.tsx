import { createStore } from "solid-js/store"
import { createMemo, For, Show } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useTheme, selectedForeground } from "../context/theme"
import { SplitBorder } from "../component/border"
import type { AskRequest, AskOption } from "@/tool/ask"

export function DialogAsk(props: { request: AskRequest; onSelect: (value: string) => void; onCancel: () => void }) {
  const { theme } = useTheme()
  const [store, setStore] = createStore({
    selected: 0,
  })

  const options = createMemo(() => props.request.options)
  const selectedOption = createMemo(() => options()[store.selected])

  useKeyboard((evt) => {
    if (evt.name === "up" || evt.name === "k") {
      evt.preventDefault()
      setStore("selected", (prev) => (prev - 1 + options().length) % options().length)
    }

    if (evt.name === "down" || evt.name === "j") {
      evt.preventDefault()
      setStore("selected", (prev) => (prev + 1) % options().length)
    }

    const num = parseInt(evt.name, 10)
    if (num >= 1 && num <= 6 && num <= options().length) {
      evt.preventDefault()
      setStore("selected", num - 1)
    }

    if (evt.name === "return") {
      evt.preventDefault()
      const option = selectedOption()
      if (option) {
        props.onSelect(option.value)
      }
    }

    if (evt.name === "escape") {
      evt.preventDefault()
      props.onCancel()
    }
  })

  const fg = selectedForeground(theme)

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.primary}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1}>
        <box flexDirection="row" gap={1} paddingLeft={1}>
          <text fg={theme.primary}>{"?"}</text>
          <text fg={theme.text}>{props.request.question}</text>
        </box>
        <Show when={props.request.context}>
          <box paddingLeft={3}>
            <text fg={theme.textMuted}>{props.request.context}</text>
          </box>
        </Show>
        <box paddingLeft={2} paddingTop={1}>
          <For each={options()}>
            {(option, index) => {
              const isSelected = createMemo(() => index() === store.selected)
              return (
                <box flexDirection="column" paddingBottom={1}>
                  <box flexDirection="row" gap={1}>
                    <text fg={isSelected() ? theme.primary : theme.textMuted} flexShrink={0}>
                      {isSelected() ? "❯" : " "} {index() + 1}.
                    </text>
                    <text fg={isSelected() ? fg : theme.text}>{option.label}</text>
                  </box>
                  <Show when={option.description}>
                    <box paddingLeft={5}>
                      <text fg={theme.textMuted}>{option.description}</text>
                    </box>
                  </Show>
                </box>
              )
            }}
          </For>
        </box>
      </box>
      <box
        flexDirection="row"
        flexShrink={0}
        gap={2}
        paddingTop={1}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        backgroundColor={theme.backgroundElement}
        justifyContent="space-between"
      >
        <box flexDirection="row" gap={2}>
          <text fg={theme.text}>
            {"↑↓"} <span style={{ fg: theme.textMuted }}>navigate</span>
          </text>
          <text fg={theme.text}>
            {"1-" + options().length} <span style={{ fg: theme.textMuted }}>select</span>
          </text>
        </box>
        <box flexDirection="row" gap={2}>
          <text fg={theme.text}>
            enter <span style={{ fg: theme.textMuted }}>confirm</span>
          </text>
          <text fg={theme.text}>
            esc <span style={{ fg: theme.textMuted }}>cancel</span>
          </text>
        </box>
      </box>
    </box>
  )
}
