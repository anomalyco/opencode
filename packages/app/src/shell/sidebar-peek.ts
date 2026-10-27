import { createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { frameLoop, prefersReducedMotion, Spring, type DurationOptions } from "@opencode/ui/motion"
import { motionTimeScale } from "@opencode/ui/motion-tuning"
import "./sidebar-peek.css"

// The peek's own spring, quicker than the docked sidebar's.
const spring: DurationOptions = { duration: 0.18, bounce: 0 }

// How long the pointer rests before the sidebar peeks, in ms. The edge stays quick: it's crossed in a frame or two and
// rarely by accident. The toggle waits longer, because the header row is crossed far more often on the way to the
// breadcrumb or the traffic lights, and a peek there should only open when the pointer means to rest on it.
const dwell = { edge: 40, toggle: 500 }

/** Whether any session in the vertical sidebar draws its unread dot, published by the sidebar's tab strip. */
export const [sidebarUnread, setSidebarUnread] = createSignal(false)

const toggles = 'button[aria-controls="vertical-tabs-sidebar"]'

const menus = '[data-component="menu-v2-content"], [role="menu"]'

// A drag in progress, or a dialog over the app, which no peek should open under.
const busy = '[data-dragging="true"], [role="dialog"], [role="alertdialog"]'

// The zone along the window's start edge that peeks the sidebar: the shell's 8px frame gutter, outside the content's
// card, plus a tunable reach into the content. It only reads where the pointer is, so clicks, scrollbars and text
// selection under it work as usual, and a held button never peeks. It starts below the session header's 56px band,
// which holds the traffic lights and the toggle.
const gutter = 8

const edgeZone = 16

const header = 56

// How far past the sidebar and toggle the pointer may stray, and for how long, before the peek closes.
const margin = 15

const grace = 100

// Reduced motion fades the peek in place, in about the time it would take to slide.
const fade = { duration: 0.15, bounce: 0 }

type Point = { x: number; y: number }

type Box = { left: number; right: number; top: number; bottom: number }

/**
 * While the left sidebar is closed, resting the pointer on the window's start edge or on the sidebar's
 * toggle slides the real sidebar in over the app without moving the layout, on a quicker spring than the docked
 * sidebar's and in its own box. Docking from a peek continues from where it is: the sidebar stays, finishing its slide on
 * the peek's spring, and the layout makes room on the docked sidebar's.
 *
 * The peek holds while the pointer stays within the box spanning the toggle and the sidebar, plus a margin, so the way
 * from the toggle into the sidebar never closes it. Closing reads the pointer's last known position on every move,
 * scroll and wheel, and on a slow interval, rather than trusting enter and leave events on elements, against boxes read
 * once per layout change rather than on every move.
 */
export function createSidebarPeek(input: {
  /** Whether a peek may start: the sidebar is fully closed. */
  available: Accessor<boolean>
  open: Accessor<boolean>
  aside: Accessor<HTMLElement | undefined>
  /** The sidebar's box while it peeks, which doesn't move while the content inside it slides. */
  panel: Accessor<HTMLElement | undefined>
  /** Paints how far in the peek has the sidebar, from 0 to 1, on every frame it moves; undefined once it isn't peeking. */
  paint: (shown: number | undefined) => void
  /** Runs `run` once the docked sidebar's flight lands. */
  whenDocked: (run: () => void) => void
}) {
  const [shown, setShown] = createSignal(false)
  // Percent shown, so the spring's rest threshold stays well under a pixel.
  const motion = new Spring(0)
  let stop: (() => void) | undefined
  let toggle: HTMLElement | undefined
  let opening: { from: "edge" | "toggle"; timer: ReturnType<typeof setTimeout> } | undefined
  let closing: ReturnType<typeof setTimeout> | undefined
  let watch: ReturnType<typeof setInterval> | undefined
  // The pointer's last position in the window, or undefined once it has left the window.
  let pointer: Point | undefined
  let pressed = false
  let keyboard = false
  // Whether the sidebar last docked from a peek, which already shows it.
  let handedOff = false
  let viewport = window.innerWidth
  // Where the edge zone starts, and the box spanning the toggle and the sidebar, until the layout next changes.
  let edgeTop: number | undefined
  let corridor: Box | undefined

  const paint = () => input.paint(Math.min(1, Math.max(0, motion.value / 100)))

  const step = (dt: number) => {
    motion.step(dt)
    paint()

    if (!motion.resting) return true
    stop = undefined

    if (motion.target === 0) end()

    return false
  }

  // Retargeting keeps the current position and velocity, so a peek that turns around mid-flight stays smooth.
  const run = (target: number) => {
    const tuning = prefersReducedMotion() ? fade : { ...spring, duration: spring.duration * motionTimeScale() }
    motion.omega = (2 * Math.PI) / tuning.duration
    motion.zeta = 1 - tuning.bounce
    motion.set(target)
    stop ??= frameLoop.add(step)
  }

  const cancelOpen = () => {
    clearTimeout(opening?.timer)
    opening = undefined
  }

  const cancelClose = () => {
    clearTimeout(closing)
    closing = undefined
  }

  const show = () => {
    cancelOpen()
    cancelClose()

    if (!input.panel()) return

    // Painted out of view before the peek's box lays out, so its first frame doesn't show the sidebar in place.
    if (!shown()) {
      paint()
      setShown(true)
    }

    watch ??= setInterval(check, 150)
    run(100)
  }

  const end = () => {
    cancelOpen()
    cancelClose()
    clearInterval(watch)
    watch = undefined
    stop?.()
    stop = undefined
    motion.snap(0)
    toggle = undefined
    corridor = undefined

    if (!shown()) return
    setShown(false)
    input.paint(undefined)
  }

  const hide = (focus?: boolean) => {
    cancelClose()

    if (!shown() || input.open()) return
    clearInterval(watch)
    watch = undefined
    const aside = input.aside()

    if (aside?.contains(document.activeElement)) {
      if (focus && toggle?.isConnected) toggle.focus({ preventScroll: true })

      if (!focus && document.activeElement instanceof HTMLElement) document.activeElement.blur()
    }

    run(0)
  }

  // Both dwells share one path: a press, a drag, a dialog or a resize clears whichever peek is pending.
  const start = (from: "edge" | "toggle", still: () => boolean) => {
    cancelOpen()
    opening = {
      from,
      timer: setTimeout(() => {
        opening = undefined

        if (input.available() && !interrupted() && still()) show()
      }, dwell[from]),
    }
  }

  const interrupted = () => pressed || !!document.querySelector(busy)

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

  const inside = (point: Point) => {
    const box = (corridor ??= measureCorridor())

    return (
      !!box &&
      point.x >= box.left - margin &&
      point.x <= box.right + margin &&
      point.y >= box.top - margin &&
      point.y <= box.bottom + margin
    )
  }

  // The box spanning the toggle and the sheet is the corridor from one into the other. The sheet holds still while the
  // sidebar slides inside it.
  const measureCorridor = () => {
    const panel = input.panel()

    if (!panel) return
    const sheet = panel.getBoundingClientRect()
    const button = toggle?.isConnected ? toggle.getBoundingClientRect() : sheet

    return {
      left: Math.min(sheet.left, button.left),
      right: Math.max(sheet.right, button.right),
      top: Math.min(sheet.top, button.top),
      bottom: Math.max(sheet.bottom, button.bottom),
    }
  }

  const atEdge = (point: Point) => {
    const rtl = document.documentElement.dir === "rtl"

    const edge = gutter + edgeZone

    if (rtl ? point.x < viewport - edge : point.x > edge) return false
    edgeTop ??= (input.aside()?.getBoundingClientRect().top ?? Infinity) + header

    return point.y >= edgeTop
  }

  const relayout = () => {
    viewport = window.innerWidth
    edgeTop = undefined
    corridor = undefined
  }

  function check() {
    if (!shown() || input.open() || !watch) return

    if ((pointer && inside(pointer)) || held()) return cancelClose()
    closing ??= setTimeout(() => {
      closing = undefined

      if (!(pointer && inside(pointer)) && !held()) hide()
    }, grace)
  }

  // Starts the edge's dwell while the pointer rests at the window's start edge, and cancels it once the pointer leaves.
  const approach = (event: PointerEvent | WheelEvent) => {
    if (shown() && motion.target === 100) return
    const target = event.target

    const near =
      !pressed &&
      !!pointer &&
      input.available() &&
      atEdge(pointer) &&
      // Within the shell's own layout, not a dialog or popover portaled over it.
      target instanceof Node &&
      !!input.aside()?.parentElement?.contains(target)

    if (!near) {
      if (opening?.from === "edge") cancelOpen()

      return
    }

    // Back at the edge while it slides out: it turns around at once.
    if (shown()) return show()

    if (opening) return
    start("edge", () => !!pointer && !held() && atEdge(pointer))
  }

  const track = (event: PointerEvent | WheelEvent) => {
    if (event instanceof PointerEvent && event.pointerType === "touch") return

    if (event instanceof PointerEvent) pressed = event.buttons !== 0
    pointer = { x: event.clientX, y: event.clientY }
    approach(event)
    check()
  }

  createEffect(() => {
    makeEventListener(
      document,
      "pointerover",
      (event) => {
        if (event.pointerType === "touch" || !(event.target instanceof Element)) return
        const button = event.target.closest<HTMLElement>(toggles)

        if (!button || input.aside()?.contains(button)) return

        if (toggle !== button) corridor = undefined
        toggle = button

        if (shown()) return show()

        if (!input.available() || opening?.from === "toggle") return
        start("toggle", () => !!toggle?.matches(":hover"))
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

        if (opening?.from !== "toggle" || !(event.target instanceof Element)) return
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
        cancelOpen()
      },
      { passive: true, capture: true },
    )
    makeEventListener(window, "pointerup", () => (pressed = false), { passive: true, capture: true })
    makeEventListener(window, "pointercancel", () => (pressed = false), { passive: true, capture: true })
    makeEventListener(document.documentElement, "pointerleave", () => {
      pointer = undefined
      check()
    })
    // Resizing the window from its start edge is no reason to peek.
    makeEventListener(window, "resize", () => {
      relayout()
      cancelOpen()
    })
    makeEventListener(document, "dragstart", cancelOpen, { passive: true, capture: true })
    makeEventListener(document, "keydown", (event) => {
      keyboard = true

      if (event.key !== "Escape" || !shown() || input.open() || event.defaultPrevented || held()) return
      hide(true)
    })
    makeEventListener(window, "blur", () => {
      pressed = false
      hide()
    })

    const aside = input.aside()

    if (!aside) return
    // A titlebar or panel that moves the sidebar's row changes where the edge zone starts.
    const observer = new ResizeObserver(relayout)
    observer.observe(aside.parentElement ?? aside)
    onCleanup(() => observer.disconnect())

    // Keyboard focus leaving the peek closes it; pointer clicks elsewhere already close it by leaving.
    const leave = (event: FocusEvent) => {
      const next = event.relatedTarget

      if (!keyboard || !shown() || input.open() || !(next instanceof Element)) return

      if (aside.contains(next) || toggle?.contains(next) || next.closest(menus)) return
      hide()
    }

    aside.addEventListener("focusout", leave)
    onCleanup(() => aside.removeEventListener("focusout", leave))
  })

  // Docking keeps the peeked sidebar where it is, sliding the rest of the way in if it hadn't arrived, while the layout
  // makes room; the docked sidebar takes over once it lands. Closing again before then slides the peek back out.
  createEffect(
    on(
      input.open,
      (open) => {
        if (!open) {
          handedOff = false

          return hide()
        }

        handedOff = shown()

        if (!handedOff) return end()
        cancelOpen()
        cancelClose()
        clearInterval(watch)
        watch = undefined
        run(100)
        // After the docked sidebar's own effect has started its flight, which effects don't order.
        queueMicrotask(() => {
          if (!input.open() || !shown()) return
          input.whenDocked(() => {
            if (input.open()) end()
          })
        })
      },
      { defer: true },
    ),
  )

  onCleanup(end)

  return {
    shown,
    /** Whether the sidebar last docked from a peek, which already shows it. */
    handedOff: () => handedOff,
  }
}
