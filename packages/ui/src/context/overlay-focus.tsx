import { onCleanup } from "solid-js"

export type OpenGesture = "pointer" | "keyboard" | "none"

// One set of window listeners serves every mounted overlay. Capture runs before the trigger's own handlers, so while an
// input event dispatches, `gesture` names the input that may open an overlay. It clears once that event's task ends, so
// a later open without input counts as programmatic.
let trackers = 0

let gesture: OpenGesture = "none"

let gestureReset: ReturnType<typeof setTimeout> | undefined

const trackGesture = (event: Event) => {
  if (!event.isTrusted) return
  // Keyboard activation fires a click with no press count.
  gesture =
    event.type === "keydown" || (event instanceof MouseEvent && event.type === "click" && event.detail === 0)
      ? "keyboard"
      : "pointer"

  // A microtask would run between listeners of this same dispatch, before the trigger's handler reads the gesture.
  if (gestureReset !== undefined) return
  gestureReset = setTimeout(() => {
    gestureReset = undefined
    gesture = "none"
  })
}

const GESTURE_EVENTS = ["pointerdown", "click", "keydown"] as const

const GESTURE_LISTENER_OPTIONS = { capture: true, passive: true }

export function retainOpenGesture() {
  trackers += 1

  if (trackers === 1)
    GESTURE_EVENTS.forEach((type) => window.addEventListener(type, trackGesture, GESTURE_LISTENER_OPTIONS))
}

export function releaseOpenGesture() {
  trackers -= 1

  if (trackers > 0) return
  GESTURE_EVENTS.forEach((type) => window.removeEventListener(type, trackGesture, GESTURE_LISTENER_OPTIONS))
  clearTimeout(gestureReset)
  gestureReset = undefined
  gesture = "none"
}

export function openGesture() {
  return gesture
}

/**
 * For overlays that return focus with Kobalte's plain `focus()`. Escape counts as keyboard use, so Chromium would ring
 * a trigger the pointer opened. This restores the ring the open implied instead: none after a pointer open, the ring
 * after a keyboard open however it closed. An open without input keeps Kobalte's restore.
 */
export function createOverlayFocus() {
  let ring: boolean | undefined

  let opener: HTMLElement | undefined

  retainOpenGesture()
  onCleanup(releaseOpenGesture)

  return {
    openChanged: (open: boolean) => {
      if (!open) return
      ring = gesture === "none" ? undefined : gesture === "keyboard"
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    },
    // Without a trigger, focus returns to what had it when the overlay opened, such as the row a context menu opened on.
    restore: (event: Event, trigger?: HTMLElement) => {
      const visible = ring
      const target = trigger ?? opener
      ring = undefined
      opener = undefined

      if (event.defaultPrevented || visible === undefined || !target?.isConnected || target === document.body) return
      const active = document.activeElement

      // An outside press already moved focus where it belongs.
      if (active && active !== document.body && !(event.target instanceof Node && event.target.contains(active))) return
      event.preventDefault()
      target.focus({ preventScroll: true, focusVisible: visible })
    },
  }
}
