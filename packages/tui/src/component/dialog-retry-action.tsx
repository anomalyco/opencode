import { RGBA, TextAttributes } from "@opentui/core"
import open from "open"
import { createSignal } from "solid-js"
import { Keymap } from "../context/keymap"
import { useTheme } from "../context/theme"
import { useDialog, type DialogContext } from "../ui/dialog"
import { Link } from "../ui/link"
import { BgPulse } from "./bg-pulse"

const GO_URL = "https://opencode.ai/go"
const PAD_X = 3
const PAD_TOP_OUTER = 1
const FOREGROUND_ALPHA = 186

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

function panelOverlay(color: RGBA) {
  const [r, g, b] = color.toInts()
  return RGBA.fromInts(r, g, b, FOREGROUND_ALPHA)
}

export function DialogRetryAction(props: DialogRetryActionProps) {
  const dialog = useDialog()
  const theme = useTheme("elevated")
  const showGoTreatment = () => props.link === GO_URL
  const textBg = () => (showGoTreatment() ? panelOverlay(theme.background.default) : undefined)
  const [selected, setSelected] = createSignal<"dismiss" | "action">("action")

  Keymap.createLayer(() => ({
    mode: "modal",
    commands: [
      {
        bind: "left",
        title: "Previous retry option",
        group: "Dialog",
        run: () => setSelected((value) => (value === "action" ? "dismiss" : "action")),
      },
      {
        bind: "right",
        title: "Next retry option",
        group: "Dialog",
        run: () => setSelected((value) => (value === "action" ? "dismiss" : "action")),
      },
      {
        bind: "tab",
        title: "Next retry option",
        group: "Dialog",
        run: () => setSelected((value) => (value === "action" ? "dismiss" : "action")),
      },
      {
        bind: "return",
        title: "Confirm retry option",
        group: "Dialog",
        run: () => {
          if (selected() === "action") runAction(props, dialog)
          else dismiss(props, dialog)
        },
      },
    ],
  }))

  return (
    <box>
      {showGoTreatment() ? (
        <box position="absolute" top={-PAD_TOP_OUTER} left={0} right={0} bottom={0} zIndex={0}>
          <BgPulse />
        </box>
      ) : null}
      <box zIndex={1} paddingLeft={PAD_X} paddingRight={PAD_X} paddingBottom={1} gap={1}>
        <box flexDirection="row" justifyContent="space-between">
          <text attributes={TextAttributes.BOLD} fg={theme.text.default} bg={textBg()}>
            {props.title}
          </text>
          <text fg={theme.text.subdued} bg={textBg()} onMouseUp={() => dialog.clear()}>
            esc
          </text>
        </box>
        <box gap={0}>
          <text fg={theme.text.subdued} bg={textBg()}>
            {props.message}
          </text>
        </box>
        {props.link ? (
          showGoTreatment() ? (
            <box alignItems="center" justifyContent="flex-end" height={7} paddingBottom={1}>
              <Link href={props.link} fg={theme.markdown.link} bg={textBg()} wrapMode="none" />
            </box>
          ) : (
            <box width="100%" flexDirection="row" justifyContent="center" paddingBottom={1}>
              <Link href={props.link} fg={theme.markdown.link} wrapMode="none" />
            </box>
          )
        ) : (
          <box paddingBottom={1} />
        )}
        <box flexDirection="row" justifyContent="space-between">
          <box
            paddingLeft={2}
            paddingRight={2}
            backgroundColor={
              selected() === "dismiss" ? theme.background.action.primary.focused : RGBA.fromInts(0, 0, 0, 0)
            }
            onMouseOver={() => setSelected("dismiss")}
            onMouseUp={() => dismiss(props, dialog)}
          >
            <text
              fg={selected() === "dismiss" ? theme.text.action.primary.focused : theme.text.subdued}
              bg={selected() === "dismiss" ? undefined : textBg()}
              attributes={selected() === "dismiss" ? TextAttributes.BOLD : undefined}
            >
              don't show again
            </text>
          </box>
          <box
            paddingLeft={2}
            paddingRight={2}
            backgroundColor={
              selected() === "action" ? theme.background.action.primary.focused : RGBA.fromInts(0, 0, 0, 0)
            }
            onMouseOver={() => setSelected("action")}
            onMouseUp={() => runAction(props, dialog)}
          >
            <text
              fg={selected() === "action" ? theme.text.action.primary.focused : theme.text.default}
              bg={selected() === "action" ? undefined : textBg()}
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
