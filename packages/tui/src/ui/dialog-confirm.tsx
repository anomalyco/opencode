import { TextAttributes } from "@opentui/core"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "./dialog"
import { createStore } from "solid-js/store"
import { For } from "solid-js"
import { Locale } from "../util/locale"

export type DialogConfirmProps = {
  title: string
  message: string
  onConfirm?: () => void
  onCancel?: () => void
  label?: string
}

export type DialogConfirmResult = boolean | undefined

export function DialogConfirm(props: DialogConfirmProps) {
  const dialog = useDialog()
  const { themeV2 } = useTheme().contextual("elevated")
  const [store, setStore] = createStore({
    active: "confirm" as "confirm" | "cancel",
  })

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      {
        bind: "return",
        title: "Confirm dialog selection",
        group: "Dialog",
        run: () => {
          if (store.active === "confirm") props.onConfirm?.()
          if (store.active === "cancel") props.onCancel?.()
          dialog.clear()
        },
      },
      {
        bind: "left",
        title: "Previous dialog option",
        group: "Dialog",
        run: () => {
          setStore("active", store.active === "confirm" ? "cancel" : "confirm")
        },
      },
      {
        bind: "right",
        title: "Next dialog option",
        group: "Dialog",
        run: () => {
          setStore("active", store.active === "confirm" ? "cancel" : "confirm")
        },
      },
    ],
  }))
  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={themeV2.text()}>
          {props.title}
        </text>
        <text fg={themeV2.text.subdued()} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box paddingBottom={1}>
        <text fg={themeV2.text.subdued()}>{props.message}</text>
      </box>
      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
        <For each={["cancel", "confirm"] as const}>
          {(key) => (
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={key === store.active ? themeV2.background.action("focused") : undefined}
              onMouseUp={() => {
                if (key === "confirm") props.onConfirm?.()
                if (key === "cancel") props.onCancel?.()
                dialog.clear()
              }}
            >
              <text fg={key === store.active ? themeV2.text.action("focused") : themeV2.text.subdued()}>
                {Locale.titlecase(key === "cancel" ? (props.label ?? key) : key)}
              </text>
            </box>
          )}
        </For>
      </box>
    </box>
  )
}

DialogConfirm.show = (dialog: DialogContext, title: string, message: string, label?: string) => {
  return new Promise<DialogConfirmResult>((resolve) => {
    dialog.replace(
      () => (
        <DialogConfirm
          title={title}
          message={message}
          onConfirm={() => resolve(true)}
          onCancel={() => resolve(false)}
          label={label}
        />
      ),
      () => resolve(undefined),
    )
  })
}
