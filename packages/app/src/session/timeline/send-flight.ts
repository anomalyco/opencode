import { frameLoop, prefersReducedMotion, Spring } from "@opencode/ui/motion"
import { growthSpring } from "./row-growth"

type Rect = { x: number; y: number; w: number; h: number }

type Flight = {
  at: number
  text: HTMLElement
  layer: HTMLElement
  from: Rect
  /** How far the composer had scrolled through a prompt taller than it, from 0 at its start to 1 at its end. */
  reveal: number
  /** The copy's full text: `above` of it sits over the lines that take off. */
  above: number
  textHeight: number
  expire: ReturnType<typeof setTimeout>
  source?: HTMLElement
}

// The sent text rises from behind the composer, clipped to its timeline's visible viewport. The real bubble stays
// hidden until the flight lands on it.
const waiting = new Map<string, Flight>()

// A bubble that mounted before its flight was prepared, as when a queued prompt's row leaves the queue a moment after
// its message reaches the timeline. A flight prepared soon after still lands on it.
const unclaimed = new Map<string, { bubble: HTMLElement; at: number; offset?: () => number }>()

/**
 * Holds a copy of the composer's text, or a queued prompt's row, where it is for the bubble that `id` becomes. A
 * `source` hides as the copy takes off from it.
 */
export function prepareSendFlight(id: string, editor: HTMLElement | undefined, source?: HTMLElement) {
  if (!editor?.isConnected || document.hidden || prefersReducedMotion()) return
  const range = document.createRange()
  range.selectNodeContents(editor)
  const box = range.getBoundingClientRect()

  if (box.width < 1 || box.height < 1) return
  // Only the lines the composer shows take off; a long prompt's scrolled-out lines stay hidden.
  const view = scroller(editor)?.getBoundingClientRect()
  const above = Math.max(0, (view?.top ?? box.top) - box.top)
  const below = Math.max(0, box.bottom - (view?.bottom ?? box.bottom))
  const style = getComputedStyle(editor)
  const text = document.createElement("div")
  text.setAttribute("aria-hidden", "true")
  Object.assign(text.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: `${Math.ceil(box.width) + 1}px`,
    transformOrigin: "0 0",
    transform: `translate3d(${box.left}px, ${box.top}px, 0)`,
    font: style.font,
    letterSpacing: style.letterSpacing,
    color: style.color,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    clipPath: above || below ? `inset(${above}px -8px ${below}px -8px)` : "",
  })
  editor.childNodes.forEach((node) => text.append(node.cloneNode(true)))
  text.querySelectorAll("[contenteditable]").forEach((node) => node.removeAttribute("contenteditable"))

  const layer = document.createElement("div")
  layer.setAttribute("aria-hidden", "true")
  layer.dataset.sendFlight = ""
  Object.assign(layer.style, {
    position: "absolute",
    inset: "0",
    pointerEvents: "none",
    zIndex: "1",
    contain: "strict",
    overflow: "hidden",
    maskImage: "linear-gradient(to bottom, #000 calc(100% - 16px), transparent)",
    // The destination supplies its viewport before the copy may paint.
    visibility: "hidden",
  })
  document.body.append(layer)

  layer.append(text)
  waiting.get(id)?.layer.remove()
  waiting.set(id, {
    at: performance.now(),
    text,
    layer,
    source,
    from: { x: box.left, y: box.top + above, w: box.width, h: Math.max(1, box.height - above - below) },
    reveal: above + below > 0 ? above / (above + below) : 0,
    above,
    textHeight: box.height,
    expire: setTimeout(() => {
      waiting.delete(id)
      text
        .animate([{ opacity: 1 }, { opacity: 0 }], {
          duration: 110,
          easing: "cubic-bezier(.4,0,1,1)",
          fill: "forwards",
        })
        .finished.finally(() => layer.remove())
    }, 700),
  })

  const early = unclaimed.get(id)
  unclaimed.delete(id)
  if (early && performance.now() - early.at < 400 && early.bubble.isConnected)
    landSendFlight(id, early.bubble, early.offset)
}

/** Flies the waiting copy for `id` onto `bubble`. Returns false when nothing was waiting for it. */
export function landSendFlight(id: string, bubble: HTMLElement, offset?: () => number) {
  const flight = waiting.get(id)

  if (!flight) {
    const now = performance.now()
    unclaimed.forEach((entry, key) => now - entry.at >= 400 && unclaimed.delete(key))
    unclaimed.set(id, { bubble, at: now, offset })

    return false
  }
  unclaimed.delete(id)
  waiting.delete(id)
  clearTimeout(flight.expire)

  if (document.hidden || prefersReducedMotion()) {
    flight.layer.remove()

    return false
  }

  const style = getComputedStyle(bubble)
  const viewport = bubble
    .closest('[data-slot="session-timeline-scroll"]')
    ?.parentElement?.querySelector<HTMLElement>('[data-slot="session-timeline-visible"]')

  if (!viewport) {
    flight.layer.remove()

    return false
  }
  viewport.append(flight.layer)
  const left = parseFloat(style.paddingLeft) || 0
  const right = parseFloat(style.paddingRight) || 0
  const top = parseFloat(style.paddingTop) || 0
  const bottom = parseFloat(style.paddingBottom) || 0

  const start = {
    x: flight.from.x - left,
    y: flight.from.y - top,
    w: flight.from.w + left + right,
    h: flight.from.h + top + bottom,
  }

  const host = document.createElement("div")
  host.setAttribute("aria-hidden", "true")
  host.dataset.component = "user-message"
  host.dataset.flight = ""
  Object.assign(host.style, { position: "fixed", left: "0", top: "0", transformOrigin: "0 0", opacity: "0" })
  // SAFETY: a deep clone has the same element type as its source.
  const copy = bubble.cloneNode(true) as HTMLElement
  Object.assign(copy.style, { width: "100%", height: "100%", margin: "0", boxSizing: "border-box" })
  host.append(copy)
  flight.text.before(host)
  bubble.style.opacity = "0"
  flight.source?.style.setProperty("visibility", "hidden")

  const spring = Spring.fromDuration(0, growthSpring()).set(1)
  let fresh = true
  const radius = style.borderRadius
  let rect = bubble.getBoundingClientRect()
  let remaining = offset?.() ?? 0
  // A prompt that wraps differently in its bubble crosses over quickly, so the two wraps barely overlap.
  const rewraps = Math.abs(rect.height - top - bottom - flight.textHeight) > 2
  let clip = viewport.getBoundingClientRect()
  let pending = bubble.closest('[data-component="user-message"]')?.hasAttribute("data-pending") ?? false

  const land = () => {
    document.removeEventListener("visibilitychange", onVisibilityChange)
    bubble.style.removeProperty("opacity")
    flight.layer.remove()
  }

  const stop = frameLoop.addMeasured(
    () => {
      rect = bubble.getBoundingClientRect()
      remaining = offset?.() ?? 0
      clip = viewport.getBoundingClientRect()
      pending = bubble.closest('[data-component="user-message"]')?.hasAttribute("data-pending") ?? false
    },
    (dt) => {
      if (!bubble.isConnected || !viewport.isConnected || rect.width < 1) {
        land()

        return false
      }

      // Sends can share their first paint after a busy frame. Preserve their distinct launch times instead of
      // restarting them together, which makes their copies collide along the same path out of the composer.
      const elapsed = fresh ? Math.max(0, (performance.now() - flight.at) / 1000) : Math.min(dt, 1 / 30)
      fresh = false
      spring.tune(growthSpring())
      // Spring.step bounds one integration to 100 ms; a delayed first paint can span several integrations.
      for (let remaining = elapsed; remaining > 0; remaining -= 0.1) spring.step(Math.min(remaining, 0.1))
      const p = Math.min(1, Math.max(0, spring.value))
      flight.layer.style.visibility = "visible"
      host.toggleAttribute("data-pending", pending)
      const at = {
        x: start.x + (rect.left - start.x) * p,
        y: start.y + (rect.top + remaining - start.y) * p,
        w: start.w + (rect.width - start.w) * p,
        h: start.h + (rect.height - start.h) * p,
      }
      // The copy keeps its proportions, so its text never squishes: it scales with the width and shows as much of its
      // height as the flight has reached, from the part the composer had scrolled to.
      const scale = at.w / rect.width
      const shown = Math.min(rect.height, at.h / scale)
      const from = flight.reveal * (rect.height - shown)
      host.style.width = `${rect.width}px`
      host.style.height = `${rect.height}px`
      host.style.transform = `translate3d(${at.x - clip.left}px, ${at.y - from * scale - clip.top}px, 0) scale(${scale})`
      host.style.clipPath =
        shown < rect.height - 0.5 ? `inset(${from}px 0 ${rect.height - from - shown}px 0 round ${radius})` : ""
      host.style.opacity = `${rewraps ? Math.min(1, Math.max(0, (p - 0.1) / 0.3)) : Math.min(1, p / 0.5)}`

      flight.text.style.transform = `translate3d(${at.x + left - clip.left}px, ${at.y + top - flight.above - clip.top}px, 0)`
      flight.text.style.opacity = `${Math.max(0, 1 - p / (rewraps ? 0.25 : 0.4))}`

      // The flight aims at the resting slot while neighbouring rows close. Reveal the real bubble only when that
      // slot has reached it, so landing cannot be followed by a second move.
      if (!spring.resting || Math.abs(remaining) > 1 / 64) return true
      land()

      return false
    },
  )

  function onVisibilityChange() {
    if (!document.hidden) return
    stop()
    land()
  }
  document.addEventListener("visibilitychange", onVisibilityChange)

  return true
}

// The box that clips the composer's text, when the prompt is taller than it.
function scroller(editor: HTMLElement) {
  for (let node = editor.parentElement; node && node !== document.body; node = node.parentElement)
    if (node.scrollHeight > node.clientHeight + 1 && getComputedStyle(node).overflowY !== "visible") return node
  return undefined
}
