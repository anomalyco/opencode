import { Locale } from "../util/locale"
import { useLanguage } from "../context/language"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useNewDesigns } from "../config"
import { DialogHeader, DialogLayout, useDialog } from "./dialog"
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
  const theme = useTheme().surface("dialog")
  const newDesigns = useNewDesigns()
  const [store, setStore] = createStore({
    active: "confirm" as "confirm" | "cancel",
  })

  const choose = (key: "confirm" | "cancel") => {
    if (key === "confirm") props.onConfirm?.()
    if (key === "cancel") props.onCancel?.()
    dialog.clear()
  }

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: newDesigns()
      ? [
          { bind: "return", title: language.t("ui.common.confirm"), group: "Dialog", run: () => choose("confirm") },
          { bind: "escape", title: language.t("common.cancel"), group: "Dialog", run: () => choose("cancel") },
        ]
      : [
          {
            bind: "return",
            title: language.t("tui.confirmDialogSelection"),
            group: language.t("tui.dialog"),
            run: () => choose(store.active),
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
    <DialogLayout
      header={<DialogHeader title={props.title} />}
      footer={{
        actions: {
          primary: [
            // Footer labels are lowercase; the legacy buttons title-case the same labels.
            { title: (props.label?.cancel ?? "cancel").toLowerCase(), key: "esc", onTrigger: () => choose("cancel") },
            {
              title: (props.label?.confirm ?? "confirm").toLowerCase(),
              key: "enter",
              onTrigger: () => choose("confirm"),
            },
          ],
        },
      }}
      legacyFooter={
        <box flexDirection="row" justifyContent="flex-end">
          <For each={["cancel", "confirm"] as const}>
            {(key) => (
              <box
                paddingLeft={1}
                paddingRight={1}
                backgroundColor={key === store.active ? theme.background.action.primary.focused : undefined}
                onMouseUp={() => choose(key)}
              >
                <text fg={key === store.active ? theme.text.action.primary.focused : theme.text.muted}>
                  {props.label?.[key]
                    ? Locale.titlecase(props.label[key])
                    : key === "confirm"
                      ? language.t("ui.common.confirm")
                      : language.t("common.cancel")}
                </text>
              </box>
            )}
          </For>
        </box>
      }
    >
      <text fg={theme.text.muted}>{props.message}</text>
    </DialogLayout>
  )
}
