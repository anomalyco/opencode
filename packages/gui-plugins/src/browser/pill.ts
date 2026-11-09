import { onCleanup } from "solid-js"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createKeyed } from "@opencode/plugin/gui"
import type { PillOverlay } from "./ipc"

type PillTheme = {
  readonly background: string
  readonly border: string
  readonly color: string
  readonly muted: string
  readonly font: string
}

const ICON = [
  new Path2D(
    "M4.45 12.2h6.95a2.7 2.7 0 0 0 .35-5.38 3.85 3.85 0 0 0-7.3-1.02 3 3 0 0 0-.1 6.4Z",
  ),
  new Path2D("m2.3 2.3 11.4 11.4"),
]

function readTheme(): PillTheme {
  const probe = document.createElement("div")
  probe.style.cssText =
    "position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;background:var(--v2-background-bg-base);color:var(--v2-text-text-base);font-family:var(--v2-font-family-sans);border:1px solid var(--v2-border-border-muted)"
  document.body.appendChild(probe)
  const text = getComputedStyle(probe)

  probe.style.color = "var(--v2-text-text-muted)"

  const theme = {
    background: text.backgroundColor,
    border: text.borderTopColor,
    color: text.color,
    muted: getComputedStyle(probe).color,
    font: getComputedStyle(document.body).fontFamily || text.fontFamily,
  }

  probe.remove()

  return theme
}

/**
 * Draws the connection pill into the app renderer's own canvas and sends the bitmap and window bounds to main. The
 * native ImageView overlay is click-through; this keeps the app's resolved theme, font and translation without a
 * second window or a presentation polling loop.
 */
export function createPillOverlay(input: {
  readonly frame: () => HTMLElement | undefined
  readonly visible: () => boolean
  readonly label: () => string
  readonly mode: () => "light" | "dark"
  readonly send: (pill: PillOverlay) => void
}) {
  let scheduled = 0
  let disposed = false
  let hidden = false
  let cached: { key: string; image: string; width: number; height: number } | undefined

  const draw = () => {
    scheduled = 0

    if (disposed) return

    if (!input.visible()) {
      if (!hidden) input.send({ visible: false })
      hidden = true

      return
    }

    const frame = input.frame()

    if (!frame) return
    const rect = frame.getBoundingClientRect()

    if (rect.width <= 0 || rect.height <= 0) {
      if (!hidden) input.send({ visible: false })
      hidden = true

      return
    }

    const theme = readTheme()
    const label = input.label()
    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio))

    const key = [
      label,
      theme.background,
      theme.border,
      theme.color,
      theme.muted,
      theme.font,
      input.mode(),
      dpr,
    ].join("\n")

    if (!cached || cached.key !== key) {
      const bodyWidth = Math.ceil(textWidth(label, theme.font)) + 43
      const width = bodyWidth + 12
      const height = 44
      const canvas = document.createElement("canvas")
      canvas.width = Math.ceil(width * dpr)
      canvas.height = Math.ceil(height * dpr)
      const context = canvas.getContext("2d")

      if (!context) return
      context.scale(dpr, dpr)
      context.beginPath()
      context.roundRect(6, 6, bodyWidth, 32, 8)
      context.save()
      context.shadowColor = input.mode() === "dark" ? "rgba(0, 0, 0, 0.35)" : "rgba(0, 0, 0, 0.12)"
      context.shadowBlur = 4
      context.shadowOffsetY = 1.5
      context.fillStyle = theme.background
      context.fill()
      context.restore()
      context.strokeStyle = theme.border
      context.lineWidth = 0.5
      context.stroke()

      context.save()
      context.translate(16, 14.5)
      context.scale(15 / 16, 15 / 16)
      context.strokeStyle = theme.muted
      context.lineWidth = 1.35
      context.lineCap = "round"
      context.lineJoin = "round"
      ICON.forEach((path) => context.stroke(path))
      context.restore()

      context.fillStyle = theme.color
      context.font = `440 13px ${theme.font}`
      context.textBaseline = "middle"
      context.fillText(label, 39, 22)
      cached = { key, image: canvas.toDataURL("image/png"), width, height }
    }

    hidden = false
    input.send({
      visible: true,
      image: cached.image,
      bounds: {
        x: rect.left + (rect.width - cached.width) / 2,
        y: rect.top + 2,
        width: cached.width,
        height: cached.height,
      },
    })
  }

  const schedule = () => {
    if (scheduled || disposed) return
    scheduled = requestAnimationFrame(draw)
  }

  createKeyed(
    () => ({ visible: input.visible(), label: input.label(), mode: input.mode() }),
    () => schedule(),
    {
      equals: (previous, next) =>
        previous.visible === next.visible && previous.label === next.label && previous.mode === next.mode,
    },
  )
  createResizeObserver(input.frame, schedule)
  const theme = new MutationObserver(schedule)
  theme.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "data-color-scheme", "style"],
  })
  window.addEventListener("resize", schedule)
  void document.fonts.ready.then(schedule)
  onCleanup(() => {
    disposed = true
    cancelAnimationFrame(scheduled)
    theme.disconnect()
    window.removeEventListener("resize", schedule)
    input.send({ visible: false })
  })
}

function textWidth(label: string, font: string) {
  const canvas = document.createElement("canvas")
  const context = canvas.getContext("2d")

  if (!context) return label.length * 7
  context.font = `440 13px ${font}`

  return context.measureText(label).width
}
