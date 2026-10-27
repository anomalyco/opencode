import { drawProjectIcon, type GeneratedProjectIcon } from "./generated"

// The animation starts once the pointer rests on the avatar's row, so passing over a list does no drawing.
const REST_MS = 150

const HOVER_TARGET = 'a, button, [role="menuitem"], [role="option"], [data-titlebar-tab]'

// Paints a generated avatar into `canvas`. The static frame is drawn once per icon and pixel size and copied into every
// avatar that shows it. Hover is tracked per rendered avatar, on the row or control that contains it, so hovering one
// row animates only that row's icon even when other rows show the same project. Only a hovered avatar runs an
// animation loop, and it stops once the icon has eased back to its static frame.
export function attachGeneratedAvatar(canvas: HTMLCanvasElement, icon: () => GeneratedProjectIcon) {
  let frame = 0
  let time = 0
  let hovering = false
  let last = 0
  let entered = 0

  const paint = (draw: (ctx: CanvasRenderingContext2D, px: number) => void) => {
    const px = Math.max(1, Math.round((canvas.clientWidth || 16) * (window.devicePixelRatio || 1)))

    if (canvas.width !== px) canvas.width = canvas.height = px
    const ctx = canvas.getContext("2d")

    if (ctx) draw(ctx, px)
  }

  const paintStatic = () =>
    paint((ctx, px) => {
      ctx.clearRect(0, 0, px, px)
      const still = staticFrame(icon(), px)

      if (still) ctx.drawImage(still, 0, 0)
    })

  const tick = (now: number) => {
    if (hovering && time === 0 && now - entered < REST_MS) {
      last = now
      frame = requestAnimationFrame(tick)

      return
    }

    const seconds = Math.min((now - last) / 1000, 0.1)
    last = now
    time = hovering ? time + seconds : time * Math.pow(0.002, seconds)

    if (!hovering && time < 0.01) {
      time = 0
      frame = 0
      paintStatic()

      return
    }

    paint((ctx, px) => drawProjectIcon(ctx, px, icon(), time))
    frame = requestAnimationFrame(tick)
  }

  const enter = () => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return
    hovering = true

    if (frame) return
    entered = last = performance.now()
    frame = requestAnimationFrame(tick)
  }

  const leave = () => (hovering = false)

  const target =
    canvas.closest<HTMLElement>(HOVER_TARGET) ?? canvas.closest<HTMLElement>('[data-component="project-avatar-v2"]') ?? canvas

  target.addEventListener("pointerenter", enter)
  target.addEventListener("pointerleave", leave)

  return {
    /** Repaints the static frame unless the avatar is animating, e.g. after the icon changed. */
    refresh: () => !frame && paintStatic(),
    dispose: () => {
      cancelAnimationFrame(frame)
      target.removeEventListener("pointerenter", enter)
      target.removeEventListener("pointerleave", leave)
    },
  }
}

const frames = new Map<string, HTMLCanvasElement | undefined>()

function staticFrame(icon: GeneratedProjectIcon, px: number) {
  const key = `${JSON.stringify(icon)}|${px}`

  if (frames.has(key)) return frames.get(key)

  if (frames.size > 256) frames.clear()
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = px
  const ctx = canvas.getContext("2d")

  if (ctx) drawProjectIcon(ctx, px, icon, 0)
  frames.set(key, ctx ? canvas : undefined)

  return frames.get(key)
}
