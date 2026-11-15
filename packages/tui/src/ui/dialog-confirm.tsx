import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useNewDesigns } from "../config"
import { DialogButtons, DialogHeader, DialogLayout, useDialog } from "./dialog"
import { createStore } from "solid-js/store"
import { Locale } from "../util/locale"

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

const keys = ["cancel", "confirm"] as const

export function DialogConfirm(props: DialogConfirmProps) {
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

  const toggle = () => setStore("active", store.active === "confirm" ? "cancel" : "confirm")

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      { bind: "return", title: "Confirm dialog selection", group: "Dialog", run: () => choose(store.active) },
      { bind: "left", title: "Previous dialog option", group: "Dialog", run: toggle },
      { bind: "right", title: "Next dialog option", group: "Dialog", run: toggle },
      { bind: "tab", title: "Next dialog option", group: "Dialog", run: toggle },
      { bind: "shift+tab", title: "Previous dialog option", group: "Dialog", run: toggle },
      ...(newDesigns() ? [{ bind: "escape", title: "Cancel", group: "Dialog", run: () => choose("cancel") }] : []),
    ],
  }))
  return (
    <DialogLayout
      header={<DialogHeader title={props.title} />}
      buttons={
        <DialogButtons
          buttons={keys.map((key) => ({ label: Locale.titlecase(props.label?.[key] ?? key), run: () => choose(key) }))}
          active={keys.indexOf(store.active)}
          onActive={(index) => setStore("active", keys[index]!)}
        />
      }
    >
      <text fg={theme.text.muted}>{props.message}</text>
    </DialogLayout>
  )
}
