import { createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { prefersReducedMotion, Spring } from "@opencode/ui/motion"
import { motionTuning } from "@opencode/ui/motion-tuning"
import "./sidebar-peek.css"

export const sidebarPeekEnabled = motionTuning.toggle("sidebar.peek", {
  label: "Enabled",
  group: "Experiments",
  card: "Sidebar peek",
  order: 10,
  description: "With the sidebar closed, resting on its toggle floats it over the app.",
  target: 'button[aria-controls="vertical-tabs-sidebar"]',
  value: true,
})

/** Whether any session in the vertical sidebar draws its unread dot, published by the sidebar's tab strip. */
export const [sidebarUnread, setSidebarUnread] = createSignal(false)

const toggles = 'button[aria-controls="vertical-tabs-sidebar"]'

const menus = '[data-component="menu-v2-content"], [role="menu"]'

// How long the pointer rests on the toggle before the sidebar peeks, so passing over it doesn't flash it.
const intent = 500

// How far past the sidebar and toggle the pointer may stray, and for how long, before the peek closes.
const margin = 15

const grace = 100

/**
 * Experiment: while the left sidebar is closed, hovering its toggle floats the sidebar over the app without moving the
 * layout. The peek holds while the pointer stays within the box spanning the toggle and the sidebar, plus a margin, so
 * the way from the toggle into the sidebar never closes it. Closing reads the pointer's last known position on every
 * move, scroll and wheel, and on a slow interval, rather than trusting enter and leave events on elements.
 */
export function createSidebarPeek(input: {
  /** Whether a peek may start: the sidebar is fully closed. */
  available: Accessor<boolean>
  open: Accessor<boolean>
  aside: Accessor<HTMLElement | undefined>
  /** The floating box, which doesn't move while the content inside it slides. */
  panel: Accessor<HTMLElement | undefined>
  content: Accessor<HTMLElement | undefined>
}) {
  const [shown, setShown] = createSignal(false)
  let toggle: HTMLElement | undefined
  let animation: Animation | undefined
  let opening: ReturnType<typeof setTimeout> | undefined
  let closing: ReturnType<typeof setTimeout> | undefined
  let watch: ReturnType<typeof setInterval> | undefined
  // The pointer's last position in the window, or undefined once it has left the window.
  let pointer: { x: number; y: number } | undefined
  let pressed = false
  let keyboard = false

  const cancelOpen = () => {
    clearTimeout(opening)
    opening = undefined
  }

  const cancelClose = () => {
    clearTimeout(closing)
    closing = undefined
  }

  const show = () => {
    cancelOpen()
    cancelClose()
    const content = input.content()

    if (!content) return
    setShown(true)
    watch ??= setInterval(check, 150)

    if (animation) {
      if (animation.playbackRate < 0) animation.reverse()
      animation.onfinish = null
      return
    }

    const direction = document.documentElement.dir === "rtl" ? 1 : -1
    // Filled forward, so it also lifts the closed sidebar's dimmed opacity while the peek lasts.
    animation = content.animate(
      [
        { opacity: 0, transform: `translateX(calc(${direction} * (100% + 16px)))` },
        { opacity: 1, transform: "none" },
      ],
      { ...(prefersReducedMotion() ? { duration: 0 } : timing()), fill: "both" },
    )
  }

  const end = () => {
    cancelOpen()
    cancelClose()
    clearInterval(watch)
    watch = undefined
    animation?.cancel()
    animation = undefined
    toggle = undefined
    setShown(false)
  }

  const hide = (focus?: boolean) => {
    cancelClose()

    if (!shown()) return
    clearInterval(watch)
    watch = undefined
    const aside = input.aside()

    if (aside?.contains(document.activeElement)) {
      if (focus && toggle?.isConnected) toggle.focus({ preventScroll: true })
      if (!focus && document.activeElement instanceof HTMLElement) document.activeElement.blur()
    }

    if (!animation || prefersReducedMotion()) return end()
    const current = animation
    current.reverse()
    current.onfinish = () => {
      if (current.playbackRate < 0) end()
    }
  }

  // A visible menu, a drag, or typing in one of the sidebar's fields keeps it open wherever the pointer goes.
  const held = () => {
    const active = document.activeElement
    const typing =
      active instanceof HTMLElement &&
      input.aside()?.contains(active) &&
      (active.matches("input, textarea") || active.isContentEditable) &&
      active.getClientRects().length > 0
    const menu = [...document.querySelectorAll(menus)].some((element) => element.getClientRects().length > 0)

    return pressed || typing || menu || !!document.querySelector('[data-dragging="true"]')
  }

  const inside = (point: { x: number; y: number }) => {
    const panel = input.panel()

    if (!panel) return false
    const sheet = panel.getBoundingClientRect()
    const button = toggle?.isConnected ? toggle.getBoundingClientRect() : sheet

    // The box spanning both is the corridor from the toggle down to the sheet's top.
    return (
      point.x >= Math.min(sheet.left, button.left) - margin &&
      point.x <= Math.max(sheet.right, button.right) + margin &&
      point.y >= Math.min(sheet.top, button.top) - margin &&
      point.y <= Math.max(sheet.bottom, button.bottom) + margin
    )
  }

  function check() {
    if (!shown() || input.open() || !watch) return

    if ((pointer && inside(pointer)) || held()) return cancelClose()
    closing ??= setTimeout(() => {
      closing = undefined

      if (!(pointer && inside(pointer)) && !held()) hide()
    }, grace)
  }

  const track = (event: PointerEvent | WheelEvent) => {
    if (event instanceof PointerEvent && event.pointerType === "touch") return

    if (event instanceof PointerEvent) pressed = event.buttons !== 0
    pointer = { x: event.clientX, y: event.clientY }
    check()
  }

  makeEventListener(
    document,
    "pointerover",
    (event) => {
      if (event.pointerType === "touch" || !(event.target instanceof Element)) return
      const button = event.target.closest<HTMLElement>(toggles)

      if (!button || input.aside()?.contains(button)) return
      toggle = button

      if (shown()) return show()

      if (!sidebarPeekEnabled() || !input.available() || opening) return
      opening = setTimeout(() => {
        opening = undefined

        if (sidebarPeekEnabled() && input.available() && toggle?.matches(":hover")) show()
      }, intent)
    },
    { passive: true },
  )
  makeEventListener(
    document,
    "pointerout",
    (event) => {
      // Leaving the window, or into an iframe or native view, reports no related target.
      if (!event.relatedTarget) {
        pointer = undefined
        check()
      }

      if (!opening || !(event.target instanceof Element)) return
      const button = event.target.closest(toggles)

      if (button && !(event.relatedTarget instanceof Node && button.contains(event.relatedTarget))) cancelOpen()
    },
    { passive: true },
  )
  makeEventListener(document, "pointermove", track, { passive: true, capture: true })
  makeEventListener(document, "wheel", track, { passive: true, capture: true })
  makeEventListener(document, "scroll", () => check(), { passive: true, capture: true })
  makeEventListener(
    document,
    "pointerdown",
    (event) => {
      keyboard = false
      pressed = event.pointerType !== "touch"
    },
    { passive: true, capture: true },
  )
  makeEventListener(window, "pointerup", () => (pressed = false), { passive: true, capture: true })
  makeEventListener(window, "pointercancel", () => (pressed = false), { passive: true, capture: true })
  makeEventListener(document.documentElement, "pointerleave", () => {
    pointer = undefined
    check()
  })
  makeEventListener(document, "keydown", (event) => {
    keyboard = true

    if (event.key !== "Escape" || !shown() || input.open() || event.defaultPrevented || held()) return
    hide(true)
  })
  makeEventListener(window, "blur", () => {
    pressed = false
    hide()
  })

  // Keyboard focus leaving the peek closes it; pointer clicks elsewhere already close it by leaving.
  createEffect(() => {
    const aside = input.aside()

    if (!aside) return
    const leave = (event: FocusEvent) => {
      const next = event.relatedTarget

      if (!keyboard || !shown() || input.open() || !(next instanceof Element)) return

      if (aside.contains(next) || toggle?.contains(next) || next.closest(menus)) return
      hide()
    }
    aside.addEventListener("focusout", leave)
    onCleanup(() => aside.removeEventListener("focusout", leave))
  })

  // Docking hands over to the docked sidebar's own motion.
  createEffect(on(input.open, (open) => open && end(), { defer: true }))

  createEffect(() => {
    if (!sidebarPeekEnabled()) end()
  })

  onCleanup(end)

  return { shown }
}

// The peek's spring, 0.15s without bounce, sampled per 60 Hz frame into a CSS `linear()` easing.
function timing() {
  const motion = Spring.fromDuration(0, { duration: 0.15, bounce: 0 }).set(1)
  const points = [0]

  while (points.length < 240) {
    points.push(Math.round(motion.step(1 / 60) * 1000) / 1000)

    if (Math.abs(1 - motion.value) < 0.005 && Math.abs(motion.velocity) < 0.05) break
  }

  points.push(1)

  return { duration: ((points.length - 1) * 1000) / 60, easing: `linear(${points.join(", ")})` }
}
