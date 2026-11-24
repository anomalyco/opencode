import { createEffect, createMemo, createSignal, on, onCleanup, untrack, type Accessor } from "solid-js"
import { makeEventListener } from "@solid-primitives/event-listener"
import { frameLoop, prefersReducedMotion, Spring, type DurationOptions } from "@opencode/ui/motion"
import { motionTimeScale } from "@opencode/ui/motion-tuning"
import {
  INITIAL_SIDEBAR_PEEK_STATE,
  PEEK_BLUR_EVENT,
  PEEK_DISABLED_EVENT,
  PEEK_DISPOSED_EVENT,
  PEEK_DOCK_CLOSED_EVENT,
  PEEK_DOCK_OPENED_EVENT,
  PEEK_ESCAPE_EVENT,
  PEEK_FOCUS_LEFT_EVENT,
  PEEK_INTERRUPT_EVENT,
  PEEK_TOGGLE_LEAVE_EVENT,
  samplePointerEvent,
  selectNeedsCorridorSample,
  selectNeedsEdgeSample,
  selectPeekHandedOff,
  selectPeekShown,
  sidebarPeekEffects,
  toggleEnterEvent,
  transitionSidebarPeek,
  type SidebarPeekEffect,
  type SidebarPeekEvent,
  type SidebarPeekTrigger,
} from "./sidebar-peek-machine"
import "./sidebar-peek.css"

// The peek's own spring, quicker than the docked sidebar's.
const spring: DurationOptions = { duration: 0.18, bounce: 0 }

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

// How far past the sidebar and toggle the pointer may stray before the peek starts to close.
const margin = 15

// Reduced motion fades the peek in place, in about the time it would take to slide.
const fade = { duration: 0.15, bounce: 0 }

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
 *
 * The lifecycle lives in `sidebar-peek-machine.ts`; this drives its timers, the spring and the DOM.
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
  /** Whether the vertical sidebar exists at all; turning it off ends any peek at once. */
  enabled?: Accessor<boolean>
}) {
  const [peekState, setPeekState] = createSignal(INITIAL_SIDEBAR_PEEK_STATE)
  const shown = createMemo(() => selectPeekShown(peekState()))
  const handedOff = createMemo(() => selectPeekHandedOff(peekState()))
  const enabled = input.enabled ?? (() => true)
  // Percent shown, so the spring's rest threshold stays well under a pixel.
  const motion = new Spring(0)
  let stop: (() => void) | undefined
  let toggle: HTMLElement | undefined
  let dwellTimer: ReturnType<typeof setTimeout> | undefined
  let graceTimer: ReturnType<typeof setTimeout> | undefined
  let leaveTimer: ReturnType<typeof setTimeout> | undefined
  let handoffTimer: ReturnType<typeof setTimeout> | undefined
  let watchTimer: ReturnType<typeof setInterval> | undefined
  // The pointer's last position in the window, kept as scalars so a move allocates nothing; `hasPointer` turns false
  // once it has left the window.
  let hasPointer = false
  let pointerX = 0
  let pointerY = 0
  let pressed = false
  let keyboard = false
  let viewport = window.innerWidth
  // Where the edge zone starts, and the box spanning the toggle and the sidebar, until the layout next changes.
  let edgeTop: number | undefined
  let corridor: Box | undefined

  const paint = () => input.paint(Math.min(1, Math.max(0, motion.value / 100)))

  const dispatch = (event: SidebarPeekEvent) => {
    const previous = untrack(peekState)
    const next = transitionSidebarPeek(previous, event)

    if (next === previous) return

    // Painted out of view before the peek's box lays out, so its first frame doesn't show the sidebar in place.
    if (!selectPeekShown(previous) && selectPeekShown(next)) paint()
    // Before the effects, so focus they move out of the sidebar finds the peek already leaving.
    setPeekState(next)
    sidebarPeekEffects(previous, next).forEach(run)
  }

  const step = (dt: number) => {
    motion.step(dt)
    paint()

    if (!motion.resting) return true
    stop = undefined
    const current = untrack(peekState)

    if (motion.target === 0 && current.status === "leaving")
      dispatch({ type: "leave.settled", attempt: current.attempt })

    return false
  }

  // Retargeting keeps the current position and velocity, so a peek that turns around mid-flight stays smooth.
  const fly = (target: number) => {
    const tuning = prefersReducedMotion() ? fade : { ...spring, duration: spring.duration * motionTimeScale() }
    motion.omega = (2 * Math.PI) / tuning.duration
    motion.zeta = 1 - tuning.bounce
    motion.set(target)
    stop ??= frameLoop.add(step)
  }

  const run = (effect: SidebarPeekEffect) => {
    switch (effect.type) {
      case "dwell.start":
        clearTimeout(dwellTimer)
        dwellTimer = setTimeout(() => {
          dwellTimer = undefined
          dispatch({ type: "dwell.elapsed", attempt: effect.attempt, ready: ready(effect.from) })
        }, effect.delayMs)

        return
      case "dwell.clear":
        clearTimeout(dwellTimer)
        dwellTimer = undefined

        return
      case "grace.start":
        clearTimeout(graceTimer)
        graceTimer = setTimeout(() => {
          graceTimer = undefined
          dispatch({ type: "grace.elapsed", attempt: effect.attempt, keepOpen: keptOpen() })
        }, effect.delayMs)

        return
      case "grace.clear":
        clearTimeout(graceTimer)
        graceTimer = undefined

        return
      case "watch.start":
        watchTimer ??= setInterval(() => sample(), effect.intervalMs)

        return
      case "watch.stop":
        clearInterval(watchTimer)
        watchTimer = undefined

        return
      case "focus.evict": {
        const active = document.activeElement

        if (!input.aside()?.contains(active)) return

        if (effect.restoreToggle && toggle?.isConnected) return toggle.focus({ preventScroll: true })

        if (!effect.restoreToggle && active instanceof HTMLElement) active.blur()

        return
      }

      case "spring.open":
        return fly(100)
      case "spring.close":
        fly(0)
        clearTimeout(leaveTimer)
        leaveTimer = setTimeout(
          () => {
            leaveTimer = undefined
            dispatch({ type: "leave.settled", attempt: effect.attempt })
          },
          effect.timeoutMs * Math.max(1, motionTimeScale()),
        )

        return
      case "leave.clear":
        clearTimeout(leaveTimer)
        leaveTimer = undefined

        return
      case "handoff.await":
        clearTimeout(handoffTimer)
        handoffTimer = setTimeout(
          () => {
            handoffTimer = undefined
            dispatch({ type: "dock.settled", attempt: effect.attempt })
          },
          effect.timeoutMs * Math.max(1, motionTimeScale()),
        )
        // After the docked sidebar's own effect has started its flight, which effects don't order.
        queueMicrotask(() => input.whenDocked(() => dispatch({ type: "dock.settled", attempt: effect.attempt })))

        return
      case "handoff.clear":
        clearTimeout(handoffTimer)
        handoffTimer = undefined

        return
      case "peek.reset":
        stop?.()
        stop = undefined
        motion.snap(0)
        toggle = undefined
        corridor = undefined
        input.paint(undefined)
    }
  }

  // Whether the pointer still means to peek once its dwell ends.
  const ready = (from: SidebarPeekTrigger) =>
    enabled() &&
    input.available() &&
    !!input.panel() &&
    !interrupted() &&
    (from === "edge" ? hasPointer && !held() && atEdge() : !!toggle?.isConnected && toggle.matches(":hover"))

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

  const keptOpen = () => (hasPointer && inside()) || held()

  const inside = () => {
    const box = (corridor ??= measureCorridor())

    return (
      !!box &&
      pointerX >= box.left - margin &&
      pointerX <= box.right + margin &&
      pointerY >= box.top - margin &&
      pointerY <= box.bottom + margin
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

  const atEdge = () => {
    const rtl = document.documentElement.dir === "rtl"

    const edge = gutter + edgeZone

    if (rtl ? pointerX < viewport - edge : pointerX > edge) return false
    edgeTop ??= (input.aside()?.getBoundingClientRect().top ?? Infinity) + header

    return pointerY >= edgeTop
  }

  // At the window's start edge, within the shell's own layout rather than a dialog or popover portaled over it.
  const nearEdge = (target: EventTarget | null) =>
    !pressed &&
    hasPointer &&
    atEdge() &&
    enabled() &&
    input.available() &&
    !!input.panel() &&
    target instanceof Node &&
    !!input.aside()?.parentElement?.contains(target)

  const relayout = () => {
    viewport = window.innerWidth
    edgeTop = undefined
    corridor = undefined
  }

  // Only a move or a wheel aims at the edge, so a sample without a target, from a scroll, a window exit or the watch,
  // only rereads the corridor.
  function sample(target?: EventTarget | null) {
    const current = untrack(peekState)

    if (selectNeedsEdgeSample(current)) {
      if (target !== undefined) dispatch(samplePointerEvent(nearEdge(target), false))

      return
    }

    if (selectNeedsCorridorSample(current)) dispatch(samplePointerEvent(false, keptOpen()))
  }

  const track = (event: PointerEvent | WheelEvent) => {
    if (event instanceof PointerEvent && event.pointerType === "touch") return
    pressed = event.buttons !== 0
    hasPointer = true
    pointerX = event.clientX
    pointerY = event.clientY
    sample(event.target)
  }

  // Leaving the window, or into an iframe or native view: no pointerup may follow, so the button counts as released.
  const exit = () => {
    hasPointer = false
    pressed = false
    sample()
  }

  const release = () => {
    pressed = false
  }

  makeEventListener(
    document,
    "pointerover",
    (event) => {
      if (event.pointerType === "touch" || !(event.target instanceof Element)) return
      pressed = event.buttons !== 0
      const button = event.target.closest<HTMLElement>(toggles)

      if (!button || input.aside()?.contains(button)) return

      if (toggle !== button) corridor = undefined
      toggle = button
      dispatch(toggleEnterEvent(enabled() && input.available() && !!input.panel() && !pressed))
    },
    { passive: true },
  )
  makeEventListener(
    document,
    "pointerout",
    (event) => {
      // Leaving the window, or into an iframe or native view, reports no related target.
      if (!event.relatedTarget) exit()

      if (!(event.target instanceof Element)) return
      const button = event.target.closest(toggles)

      if (button && !(event.relatedTarget instanceof Node && button.contains(event.relatedTarget)))
        dispatch(PEEK_TOGGLE_LEAVE_EVENT)
    },
    { passive: true },
  )
  makeEventListener(document, "pointermove", track, { passive: true, capture: true })
  makeEventListener(document, "wheel", track, { passive: true, capture: true })
  makeEventListener(document, "scroll", () => sample(), { passive: true, capture: true })
  makeEventListener(
    document,
    "pointerdown",
    (event) => {
      keyboard = false
      pressed = event.pointerType !== "touch"
      dispatch(PEEK_INTERRUPT_EVENT)
    },
    { passive: true, capture: true },
  )
  makeEventListener(window, "pointerup", release, { passive: true, capture: true })
  makeEventListener(window, "pointercancel", release, { passive: true, capture: true })
  makeEventListener(document.documentElement, "pointerleave", exit)
  // Resizing the window from its start edge is no reason to peek.
  makeEventListener(window, "resize", () => {
    relayout()
    dispatch(PEEK_INTERRUPT_EVENT)
  })
  // A native drag or a context menu swallows the pointerup.
  makeEventListener(
    document,
    "dragstart",
    () => {
      release()
      dispatch(PEEK_INTERRUPT_EVENT)
    },
    { passive: true, capture: true },
  )
  makeEventListener(document, "dragend", release, { passive: true, capture: true })
  makeEventListener(document, "contextmenu", release, { passive: true, capture: true })
  makeEventListener(document, "keydown", (event) => {
    keyboard = true

    if (event.key !== "Escape" || event.defaultPrevented || held()) return
    dispatch(PEEK_ESCAPE_EVENT)
  })
  makeEventListener(window, "blur", () => {
    release()
    dispatch(PEEK_BLUR_EVENT)
  })

  createEffect(() => {
    const aside = input.aside()

    if (!aside) return
    // A titlebar or panel that moves the sidebar's row changes where the edge zone starts.
    const observer = new ResizeObserver(relayout)
    observer.observe(aside.parentElement ?? aside)
    onCleanup(() => observer.disconnect())

    // Keyboard focus leaving the peek closes it; pointer clicks elsewhere already close it by leaving.
    const leave = (event: FocusEvent) => {
      const next = event.relatedTarget

      if (!keyboard || !(next instanceof Element)) return

      if (aside.contains(next) || toggle?.contains(next) || next.closest(menus)) return
      dispatch(PEEK_FOCUS_LEFT_EVENT)
    }

    aside.addEventListener("focusout", leave)
    onCleanup(() => aside.removeEventListener("focusout", leave))
  })

  createEffect(
    on(enabled, (value) => {
      if (!value) dispatch(PEEK_DISABLED_EVENT)
    }),
  )

  // Docking keeps the peeked sidebar where it is, sliding the rest of the way in if it hadn't arrived, while the layout
  // makes room; the docked sidebar takes over once it lands. Closing again before then slides the peek back out.
  createEffect(
    on(input.open, (open) => dispatch(open ? PEEK_DOCK_OPENED_EVENT : PEEK_DOCK_CLOSED_EVENT), { defer: true }),
  )

  onCleanup(() => dispatch(PEEK_DISPOSED_EVENT))

  return {
    shown,
    /** Whether the sidebar is docking from a peek, which already shows it. */
    handedOff,
  }
}
