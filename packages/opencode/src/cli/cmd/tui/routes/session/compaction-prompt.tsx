import { createStore } from "solid-js/store"
import { For } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { useKeybind } from "../../context/keybind"
import { selectedForeground, useTheme } from "../../context/theme"
import { SplitBorder } from "../../component/border"
import { useRoute } from "../../context/route"
import { useDialog } from "../../ui/dialog"

export type CompactionPromptProps = {
  summary: string
  onDismiss: () => void
}

export function CompactionPrompt(props: CompactionPromptProps) {
  const { theme } = useTheme()
  const keybind = useKeybind()
  const route = useRoute()
  const dialog = useDialog()

  const options = [
    { key: "continue", label: "Continue" },
    { key: "new", label: "New Session" },
  ]

  const [store, setStore] = createStore({
    selected: "continue" as "continue" | "new",
  })

  useKeyboard((evt) => {
    if (dialog.stack.length > 0) return

    if (evt.name === "return") {
      evt.preventDefault()
      handleSelect(store.selected)
      return
    }

    if (evt.name === "left" || evt.name === "right" || evt.name === "tab") {
      evt.preventDefault()
      setStore("selected", store.selected === "continue" ? "new" : "continue")
    }

    if (evt.name === "escape" || keybind.match("app_exit", evt)) {
      evt.preventDefault()
      props.onDismiss()
    }
  })

  function handleSelect(option: "continue" | "new") {
    if (option === "continue") {
      props.onDismiss()
      return
    }

    if (option === "new") {
      const summaryText = props.summary ?? ""
      props.onDismiss()
      route.navigate({
        type: "home",
        initialPrompt: {
          input: `Continue from previous session:\n\n${summaryText}`,
          parts: [],
        },
      })
    }
  }

  return (
    <box
      backgroundColor={theme.backgroundPanel}
      border={["left"]}
      borderColor={theme.primary}
      customBorderChars={SplitBorder.customBorderChars}
    >
      <box gap={1} paddingLeft={1} paddingRight={3} paddingTop={1} paddingBottom={1}>
        <box flexDirection="row" gap={1}>
          <text fg={theme.primary}>◆</text>
          <text fg={theme.text}>Context summarized</text>
        </box>
      </box>

      <box
        flexDirection="row"
        flexShrink={0}
        gap={1}
        paddingLeft={2}
        paddingRight={3}
        paddingBottom={1}
        backgroundColor={theme.backgroundElement}
        justifyContent="space-between"
        alignItems="center"
      >
        <box flexDirection="row" gap={1}>
          <For each={options}>
            {(opt) => (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={opt.key === store.selected ? theme.primary : undefined}
                onMouseOver={() => setStore("selected", opt.key as "continue" | "new")}
                onMouseUp={() => handleSelect(opt.key as "continue" | "new")}
              >
                <text fg={opt.key === store.selected ? selectedForeground(theme, theme.primary) : theme.textMuted}>
                  {opt.label}
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
          <text fg={theme.text}>
            esc <span style={{ fg: theme.textMuted }}>dismiss</span>
          </text>
        </box>
      </box>
    </box>
  )
}
