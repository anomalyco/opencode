import { BoxRenderable, RGBA, TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import open from "open"
import { createSignal, onCleanup, onMount } from "solid-js"
import { selectedForeground, useTheme } from "@tui/context/theme"
import { useDialog, type DialogContext } from "@tui/ui/dialog"
import { Link } from "@tui/ui/link"
import { GoLogo } from "./logo"
import { BgPulse, type BgPulseMask } from "./bg-pulse"

const GO_URL = "https://opencode.ai/go"
const PAD_X = 3
const PAD_TOP_OUTER = 1

export type DialogGoUpsellProps = {
  onClose?: (dontShowAgain?: boolean) => void
}

function subscribe(props: DialogGoUpsellProps, dialog: ReturnType<typeof useDialog>) {
  open(GO_URL).catch(() => {})
  props.onClose?.()
  dialog.clear()
}

function dismiss(props: DialogGoUpsellProps, dialog: ReturnType<typeof useDialog>) {
  props.onClose?.(true)
  dialog.clear()
}

export function DialogGoUpsell(props: DialogGoUpsellProps) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const fg = selectedForeground(theme)
  const [selected, setSelected] = createSignal<"dismiss" | "subscribe">("subscribe")
  const [center, setCenter] = createSignal<{ x: number; y: number } | undefined>()
  const [masks, setMasks] = createSignal<BgPulseMask[]>([])
  let content: BoxRenderable | undefined
  let logoBox: BoxRenderable | undefined
  let headingBox: BoxRenderable | undefined
  let descBox: BoxRenderable | undefined
  let buttonsBox: BoxRenderable | undefined

  const sync = () => {
    if (!content || !logoBox) return
    setCenter({
      x: logoBox.x - content.x + logoBox.width / 2,
      y: logoBox.y - content.y + logoBox.height / 2 + PAD_TOP_OUTER,
    })
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

  useKeyboard((evt) => {
    if (evt.name === "left" || evt.name === "right" || evt.name === "tab") {
      setSelected((s) => (s === "subscribe" ? "dismiss" : "subscribe"))
      return
    }
    if (evt.name === "return") {
      evt.preventDefault()
      evt.stopPropagation()
      if (selected() === "subscribe") subscribe(props, dialog)
      else dismiss(props, dialog)
    }
  })

  return (
    <box ref={(item: BoxRenderable) => (content = item)}>
      <box position="absolute" top={-PAD_TOP_OUTER} left={0} right={0} bottom={0} zIndex={0}>
        <BgPulse centerX={center()?.x} centerY={center()?.y} masks={masks()} />
      </box>
      <box paddingLeft={PAD_X} paddingRight={PAD_X} paddingBottom={1} gap={1}>
        <box ref={(item: BoxRenderable) => (headingBox = item)} flexDirection="row" justifyContent="space-between">
          <text attributes={TextAttributes.BOLD} fg={theme.text}>
            Free limit reached
          </text>
          <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
            esc
          </text>
        </box>
        <box ref={(item: BoxRenderable) => (descBox = item)} gap={0}>
          <box flexDirection="row">
            <text fg={theme.textMuted}>Subscribe to </text>
            <text attributes={TextAttributes.BOLD} fg={theme.textMuted}>
              OpenCode Go
            </text>
            <text fg={theme.textMuted}> for reliable access to the</text>
          </box>
          <text fg={theme.textMuted}>best open-source models, starting at $5/month.</text>
        </box>
        <box alignItems="center" gap={1} paddingBottom={1}>
          <box ref={(item: BoxRenderable) => (logoBox = item)}>
            <GoLogo />
          </box>
          <Link href={GO_URL} fg={theme.primary} />
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
            backgroundColor={selected() === "subscribe" ? theme.primary : RGBA.fromInts(0, 0, 0, 0)}
            onMouseOver={() => setSelected("subscribe")}
            onMouseUp={() => subscribe(props, dialog)}
          >
            <text
              fg={selected() === "subscribe" ? fg : theme.text}
              attributes={selected() === "subscribe" ? TextAttributes.BOLD : undefined}
            >
              subscribe
            </text>
          </box>
        </box>
      </box>
    </box>
  )
}

DialogGoUpsell.show = (dialog: DialogContext) => {
  return new Promise<boolean>((resolve) => {
    dialog.replace(
      () => <DialogGoUpsell onClose={(dontShow) => resolve(dontShow ?? false)} />,
      () => resolve(false),
    )
  })
}
