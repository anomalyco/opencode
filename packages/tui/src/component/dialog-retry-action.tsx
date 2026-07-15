import { RGBA, TextAttributes } from "@opentui/core"
import open from "open"
import { createSignal } from "solid-js"
import { selectedForeground, useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "../ui/dialog"
import { Link } from "../ui/link"
import { useBindings } from "../keymap"

const PAD_X = 3

export type DialogRetryActionProps = {
  title: string
  message: string
  label: string
  link?: string
  onClose?: (dontShowAgain?: boolean) => void
}

function runAction(props: DialogRetryActionProps, dialog: ReturnType<typeof useDialog>) {
  if (props.link) open(props.link).catch(() => {})
  props.onClose?.()
  dialog.clear()
}

function dismiss(props: DialogRetryActionProps, dialog: ReturnType<typeof useDialog>) {
  props.onClose?.(true)
  dialog.clear()
}

export function DialogRetryAction(props: DialogRetryActionProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const fg = selectedForeground(theme)
  const [selected, setSelected] = createSignal<"dismiss" | "action">("action")

  useBindings(() => ({
    bindings: [
      {
        key: "left",
        desc: "Previous retry option",
        group: "Dialog",
        cmd: () => setSelected((value) => (value === "action" ? "dismiss" : "action")),
      },
      {
        key: "right",
        desc: "Next retry option",
        group: "Dialog",
        cmd: () => setSelected((value) => (value === "action" ? "dismiss" : "action")),
      },
      {
        key: "tab",
        desc: "Next retry option",
        group: "Dialog",
        cmd: () => setSelected((value) => (value === "action" ? "dismiss" : "action")),
      },
      {
        key: "return",
        desc: "Confirm retry option",
        group: "Dialog",
        cmd: () => {
          if (selected() === "action") runAction(props, dialog)
          else dismiss(props, dialog)
        },
      },
    ],
  }))

  return (
    <box>
      <box zIndex={1} paddingLeft={PAD_X} paddingRight={PAD_X} paddingBottom={1} gap={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text attributes={TextAttributes.BOLD} fg={theme.text}>
            {props.title}
          </text>
          <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
            esc
          </text>
        </box>
        <box gap={0}>
          <text fg={theme.textMuted}>{props.message}</text>
        </box>
        {props.link ? (
          <box width="100%" flexDirection="row" justifyContent="center" paddingBottom={1}>
            <Link href={props.link} fg={theme.primary} wrapMode="none" />
          </box>
        ) : (
          <box paddingBottom={1} />
        )}
        <box flexDirection="row" justifyContent="space-between">
          <box
            paddingLeft={2}
            paddingRight={2}
            backgroundColor={selected() === "dismiss" ? theme.primary : RGBA.fromInts(0, 0, 0, 0)}
            onMouseOver={() => setSelected("dismiss")}
            onMouseUp={() => dismiss(props, dialog)}
          >
            <text
              fg={selected() === "dismiss" ? fg : theme.textMuted}
              attributes={selected() === "dismiss" ? TextAttributes.BOLD : undefined}
            >
              don't show again
            </text>
          </box>
          <box
            paddingLeft={2}
            paddingRight={2}
            backgroundColor={selected() === "action" ? theme.primary : RGBA.fromInts(0, 0, 0, 0)}
            onMouseOver={() => setSelected("action")}
            onMouseUp={() => runAction(props, dialog)}
          >
            <text
              fg={selected() === "action" ? fg : theme.text}
              attributes={selected() === "action" ? TextAttributes.BOLD : undefined}
            >
              {props.label}
            </text>
          </box>
        </box>
      </box>
    </box>
  )
}

DialogRetryAction.show = (
  dialog: DialogContext,
  props: Pick<DialogRetryActionProps, "title" | "message" | "label" | "link">,
) => {
  return new Promise<boolean>((resolve) => {
    dialog.replace(
      () => <DialogRetryAction {...props} onClose={(dontShow) => resolve(dontShow ?? false)} />,
      () => resolve(false),
    )
  })
}
