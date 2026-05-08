import { BoxRenderable, RGBA, TextAttributes } from "@opentui/core"
import open from "open"
import { createSignal, onCleanup, onMount } from "solid-js"
import { selectedForeground, useTheme } from "@tui/context/theme"
import { useDialog, type DialogContext } from "@tui/ui/dialog"
import { Link } from "@tui/ui/link"
import { GoLogo } from "./logo"
import { BgPulse, type BgPulseMask } from "./bg-pulse"
import { useBindings } from "../keymap"

const PAD_X = 3
const PAD_TOP_OUTER = 1

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
  const [center, setCenter] = createSignal<{ x: number; y: number } | undefined>()
  const [masks, setMasks] = createSignal<BgPulseMask[]>([])
  const showGoTreatment = () => props.link === "https://opencode.ai/go"
  let content: BoxRenderable | undefined
  let logoBox: BoxRenderable | undefined
  let headingBox: BoxRenderable | undefined
  let descBox: BoxRenderable | undefined
  let buttonsBox: BoxRenderable | undefined

  const sync = () => {
    if (!content) return
    if (logoBox) {
      setCenter({
        x: logoBox.x - content.x + logoBox.width / 2,
        y: logoBox.y - content.y + logoBox.height / 2 + PAD_TOP_OUTER,
      })
    }
    const next: BgPulseMask[] = []
    const baseY = PAD_TOP_OUTER
    for (const b of [headingBox, descBox, buttonsBox]) {
      if (!b) continue
      next.push({
        x: b.x - content.x,
        y: b.y - content.y + baseY,
        width: b.width,
        height: b.height,
        pad: 2,
        strength: 0.78,
      })
    }
    setMasks(next)
  }

  onMount(() => {
    sync()
    for (const b of [content, logoBox, headingBox, descBox, buttonsBox]) b?.on("resize", sync)
  })

  onCleanup(() => {
    for (const b of [content, logoBox, headingBox, descBox, buttonsBox]) b?.off("resize", sync)
  })

  useBindings(() => ({
    bindings: [
      {
        key: "left",
        cmd: () => setSelected((value) => (value === "action" ? "dismiss" : "action")),
      },
      {
        key: "right",
        cmd: () => setSelected((value) => (value === "action" ? "dismiss" : "action")),
      },
      {
        key: "tab",
        cmd: () => setSelected((value) => (value === "action" ? "dismiss" : "action")),
      },
      {
        key: "return",
        cmd: () => {
          if (selected() === "action") runAction(props, dialog)
          else dismiss(props, dialog)
        },
      },
    ],
  }))

  return (
    <box ref={(item: BoxRenderable) => (content = item)}>
      {showGoTreatment() ? (
        <box position="absolute" top={-PAD_TOP_OUTER} left={0} right={0} bottom={0} zIndex={0}>
          <BgPulse centerX={center()?.x} centerY={center()?.y} masks={masks()} />
        </box>
      ) : null}
      <box paddingLeft={PAD_X} paddingRight={PAD_X} paddingBottom={1} gap={1} zIndex={1}>
        <box ref={(item: BoxRenderable) => (headingBox = item)} flexDirection="row" justifyContent="space-between">
          <text attributes={TextAttributes.BOLD} fg={theme.text}>
            {props.title}
          </text>
          <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
            esc
          </text>
        </box>
        <box ref={(item: BoxRenderable) => (descBox = item)} gap={0}>
          <text fg={theme.textMuted}>{props.message}</text>
        </box>
        <box gap={1} paddingBottom={1}>
          {showGoTreatment() ? (
            <box ref={(item: BoxRenderable) => (logoBox = item)} alignItems="center">
              <GoLogo />
            </box>
          ) : null}
          {props.link ? (
            <box width="100%" flexDirection="row" justifyContent="center">
              <Link href={props.link} fg={theme.primary} wrapMode="none" />
            </box>
          ) : null}
        </box>
        <box ref={(item: BoxRenderable) => (buttonsBox = item)} flexDirection="row" justifyContent="space-between">
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
