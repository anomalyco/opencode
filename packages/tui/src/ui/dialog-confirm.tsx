import { useLanguage } from "../context/language"
import { TextAttributes } from "@opentui/core"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useDialog } from "./dialog"
import { createStore } from "solid-js/store"
import { For } from "solid-js"

export type DialogConfirmProps = {
  title: string
  message: string
  onConfirm?: () => void
  onCancel?: () => void
  label?: {
    confirm?: string
    cancel?: string
  }
}

export function DialogConfirm(props: DialogConfirmProps) {
  const language = useLanguage()
  const dialog = useDialog()
  const theme = useTheme("elevated")
  const [store, setStore] = createStore({
    active: "confirm" as "confirm" | "cancel",
  })

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      {
        bind: "return",
        title: language.t("tui.confirmDialogSelection"),
        group: language.t("tui.dialog"),
        run: () => {
          if (store.active === "confirm") props.onConfirm?.()
          if (store.active === "cancel") props.onCancel?.()
          dialog.clear()
        },
      },
      {
        bind: "left",
        title: language.t("tui.previousDialogOption"),
        group: language.t("tui.dialog"),
        run: () => {
          setStore("active", store.active === "confirm" ? "cancel" : "confirm")
        },
      },
      {
        bind: "right",
        title: language.t("tui.nextDialogOption"),
        group: language.t("tui.dialog"),
        run: () => {
          setStore("active", store.active === "confirm" ? "cancel" : "confirm")
        },
      },
    ],
  }))
  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text.default}>
          {props.title}
        </text>
        <text fg={theme.text.subdued} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box paddingBottom={1}>
        <text fg={theme.text.subdued}>{props.message}</text>
      </box>
      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
        <For each={["cancel", "confirm"] as const}>
          {(key) => (
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={key === store.active ? theme.background.action.primary.focused : undefined}
              onMouseUp={() => {
                if (key === "confirm") props.onConfirm?.()
                if (key === "cancel") props.onCancel?.()
                dialog.clear()
              }}
            >
              <text fg={key === store.active ? theme.text.action.primary.focused : theme.text.subdued}>
                {props.label?.[key] ??
                  (key === "confirm" ? language.t("ui.common.confirm") : language.t("common.cancel"))}
              </text>
            </box>
          )}
        </For>
      </box>
    </box>
  )
}
