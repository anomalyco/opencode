import { RGBA, TextAttributes } from "@opentui/core"
import { createMemo, For } from "solid-js"
import { createStore } from "solid-js/store"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { tint } from "../theme/color"
import { useDialog } from "../ui/dialog"
import { Link } from "../ui/link"
import { BgPulse } from "./bg-pulse"

export function DialogGo(props: { onSubscribe: () => void; onDismiss: () => void }) {
  const dialog = useDialog()
  const theme = useTheme("elevated")
  const [store, setStore] = createStore({ selected: "subscribe" as "dismiss" | "subscribe" })
  const textBg = createMemo(() => {
    const color = theme.background.default.toInts()
    return RGBA.fromInts(color[0], color[1], color[2], 186)
  })
  const select = (key: "dismiss" | "subscribe") => {
    if (key === "subscribe") props.onSubscribe()
    if (key === "dismiss") props.onDismiss()
    dialog.clear()
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      {
        bind: "left,right,tab,shift+tab",
        title: "Switch Go signup option",
        group: "Dialog",
        run: () => setStore("selected", store.selected === "subscribe" ? "dismiss" : "subscribe"),
      },
      { bind: "return", title: "Confirm Go signup option", group: "Dialog", run: () => select(store.selected) },
    ],
  }))

  return (
    <box>
      <box position="absolute" top={-1} left={0} right={0} bottom={0} zIndex={0}>
        <BgPulse
          backgroundPanel={theme.background.default}
          primary={theme.background.action.primary.focused}
          logoBase={tint(theme.background.default, theme.text.default, 0.62)}
        />
      </box>
      <box zIndex={1} paddingLeft={3} paddingRight={3} paddingBottom={1} gap={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text attributes={TextAttributes.BOLD} fg={theme.text.default} bg={textBg()}>
            Free limit reached
          </text>
          <text fg={theme.text.subdued} bg={textBg()} onMouseUp={() => dialog.clear()}>
            esc
          </text>
        </box>
        <text fg={theme.text.subdued} bg={textBg()}>
          Subscribe to OpenCode Go for reliable access to the best open-source models, starting at $5/month.
        </text>
        <box alignItems="center" justifyContent="flex-end" height={7} paddingBottom={1}>
          <Link
            href="https://opencode.ai/go"
            fg={theme.background.action.primary.focused}
            bg={textBg()}
            wrapMode="none"
          />
        </box>
        <box flexDirection="row" justifyContent="space-between">
          <For each={["dismiss", "subscribe"] as const}>
            {(key) => (
              <box
                paddingLeft={2}
                paddingRight={2}
                backgroundColor={store.selected === key ? theme.background.action.primary.focused : undefined}
                onMouseOver={() => setStore("selected", key)}
                onMouseUp={() => select(key)}
              >
                <text
                  fg={store.selected === key ? theme.text.action.primary.focused : theme.text.subdued}
                  bg={store.selected === key ? undefined : textBg()}
                  attributes={store.selected === key ? TextAttributes.BOLD : undefined}
                >
                  {key === "subscribe" ? "Subscribe" : "Don't show again"}
                </text>
              </box>
            )}
          </For>
        </box>
      </box>
    </box>
  )
}
