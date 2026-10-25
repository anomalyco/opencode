import { createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js"
import { ease, frameLoop, prefersReducedMotion, Spring, type DurationOptions } from "@opencode/ui/motion"
import { motionTimeScale } from "@opencode/ui/motion-tuning"

// Panels in flight, across the app. Native views, which no DOM box clips, stay hidden while any panel moves.
const [flights, setFlights] = createSignal(0)

export const panelsMoving = () => flights() > 0

// The left sidebar and the side panel share one spring, so they move as one system. Each panel's flight takes its time
// scaled by the square root of how far it travels against a 480px panel, between 0.15s and 0.3s, so a narrow sidebar
// doesn't crawl and a wide panel doesn't snap.
const spring: DurationOptions = { duration: 0.3, bounce: 0 }

const distance = { min: 0.15, max: 0.3, reference: 480 }

/**
 * The shared spring for a panel that travels `width` pixels, stretched by the global speed and slow motion. Without a
 * width it is the shared spring.
 */
export function panelSpring(width?: number): DurationOptions {
  const time = motionTimeScale()

  if (!width || width <= 0) return { ...spring, duration: spring.duration * time }
  const duration = spring.duration * time * Math.sqrt(width / distance.reference)

  return { ...spring, duration: Math.min(distance.max * time, Math.max(distance.min * time, duration)) }
}

/**
 * The opacity of a panel's contents `closed` of the way through a flight: they fade only across the last 15% of travel
 * before closed, so they stay solid for most of a close and arrive almost at once on an open.
 */
export const panelOpacity = (closed: number) => (closed === 0 ? "" : `${Math.min(1, (1 - closed) / 0.15)}`)

/** Where a neighbour's content sits: centred content follows its box's centre, start-pinned content its start edge. */
export type Anchor = "center" | "start"

type Hold = { box: () => HTMLElement | null | undefined; anchor?: (() => HTMLElement | null | undefined) | "blocks" }

// `rest` 1 for a box laid out where it is rather than where it lands, so its shift runs from nothing to the whole.
type Shift = { element: HTMLElement; shift: number; rest: number }

type Landing = {
  /** Paints where the flight lands, then back where it is. */
  land: () => void
  resume: () => void
  /** Starts counting the flight's remaining travel from here, 1 now and 0 where it lands. */
  begin: () => void
  remaining: () => number
}

const holds = new Set<Hold>()

// The spring flights in progress, and the one whose travel carries the held boxes' shift.
const landings = new Set<Landing>()

let driver: Landing | undefined

let held: HTMLElement[] = []

let shifted: Shift[] = []

/**
 * Keeps a content box beside the panels at the width it will have once every spring flight lands, so its text wraps
 * once as a flight starts rather than on every frame while its container's width moves. For the flight, the box gets
 * `--panel-hold-width`, which its layout uses in place of its container's width. A box that lands at no width, like the
 * contents of a closing panel, is left to its own layout.
 *
 * `anchor` is an element inside the box whose start edge must not jump when the box takes its landing width: the box
 * shifts by the difference, with a transform, and the shift runs out over the flight. `"blocks"` holds the box at the
 * wider of its width now and where it lands, so it always covers its container, and moves each block in view that
 * doesn't keep to the box's start, like a centred column or an end-aligned label, from where it was to where it lands
 * with the flight; content at the start moves with the box's start edge.
 */
export function holdLandingWidth(box: Hold["box"], anchor?: Hold["anchor"]) {
  const hold = { box, anchor }
  holds.add(hold)
  onCleanup(() => holds.delete(hold))
}

// Measures every held box with each moving panel painted where it lands. A flight that starts, turns around or lands
// forces a few layouts here; no frame of a flight reads layout.
function rehold(next: Landing | undefined) {
  const flights = [...landings]

  const boxes = flights.length
    ? [...holds].flatMap((hold) => {
        const box = hold.box()

        if (!box?.isConnected) return []

        // The width now, which a "blocks" box keeps if it would land narrower.
        const wide = hold.anchor === "blocks" ? box.getBoundingClientRect().width : 0

        return [{ box, wide, shifts: measureAnchors(box, hold.anchor) }]
      })
    : []

  held.forEach((box) => box.style.removeProperty("--panel-hold-width"))
  shifted.forEach((item) => (item.element.style.translate = ""))
  held = []
  shifted = []
  driver = next
  driver?.begin()

  if (boxes.length === 0) return
  flights.forEach((flight) => flight.land())
  const widths = boxes.map((item) => item.box.getBoundingClientRect().width)
  flights.forEach((flight) => flight.resume())

  const kept = boxes
    .map((item, index) => ({ ...item, width: widths[index]! }))
    .filter((item) => {
      if (item.width === 0) return false
      item.box.style.setProperty("--panel-hold-width", `${item.width}px`)

      return true
    })

  held = kept.map((item) => item.box)
  shifted = kept.flatMap((item) => {
    const shifts = item.shifts()

    if (item.wide <= item.width) return shifts
    item.box.style.setProperty("--panel-hold-width", `${item.wide}px`)

    return shifts.map((shift) => ({ ...shift, rest: 1 }))
  })
  shiftHeld()
}

function shiftHeld() {
  const remaining = driver?.remaining() ?? 0
  shifted.forEach((item) => (item.element.style.translate = `${item.shift * (remaining - item.rest)}px`))
}

// Reads where a hold's anchors start before its box takes its landing width; the returned function reads them again
// after, and gives what moves to keep each where it was.
function measureAnchors(box: HTMLElement, anchor: Hold["anchor"]): () => Shift[] {
  if (anchor === "blocks") return measureBlocks(box)
  const element = anchor?.()

  if (!element) return () => []
  const before = anchorX(element, "start")

  return () => {
    const shift = before - anchorX(element, "start")

    return shift === 0 ? [] : [{ element: box, shift, rest: 0 }]
  }
}

// The box's blocks in view, breadth first. A block that keeps its width but moves when the box changes width, like a
// centred column or an end-aligned label, shifts by the difference, less what its ancestors already shift. A block that
// changes width with the box keeps to the box's start; it doesn't shift, since that would move its other edge. Inline
// boxes rewrap rather than move, and a block that also moves down has wrapped onto another line; both are left to the
// layout, as is a block that already has its own translate. Every element read counts toward the bound, in view or not,
// so a long document or tree costs no more than a short one; a subtree out of view is skipped whole.
function measureBlocks(box: HTMLElement) {
  const bounds = box.getBoundingClientRect()
  const blocks = [{ element: box, parent: -1, left: bounds.left, right: bounds.right, top: bounds.top }]
  let visits = 0

  const visit = (element: Element, parent: number) => {
    for (let child = element.firstElementChild; child && visits < 400; child = child.nextElementSibling) {
      visits++

      if (!(child instanceof HTMLElement)) continue
      const rect = child.getBoundingClientRect()

      // A `display: contents` wrapper has no box of its own; its children lay out in its parent's.
      if (rect.width === 0 && rect.height === 0 && getComputedStyle(child).display === "contents") visit(child, parent)

      if (rect.width === 0 || rect.bottom <= bounds.top || rect.top >= bounds.bottom) continue

      if (getComputedStyle(child).display.startsWith("inline")) continue
      blocks.push({ element: child, parent, left: rect.left, right: rect.right, top: rect.top })
    }
  }

  for (let index = 0; index < blocks.length && visits < 400; index++) visit(blocks[index]!.element, index)

  return () => {
    const moved = blocks.map((block) => {
      const rect = block.element.getBoundingClientRect()

      return { left: block.left - rect.left, right: block.right - rect.right, top: block.top - rect.top }
    })

    // What each block's ancestors shift it by, which its own shift doesn't repeat.
    const carried = blocks.map(() => 0)

    return blocks.flatMap((block, index) => {
      if (block.parent < 0) return []
      const own = moved[index]!
      carried[index] = carried[block.parent]!
      const shift = own.left - carried[index]

      if (
        Math.abs(own.top) >= 0.5 ||
        Math.abs(own.left - own.right) >= 0.5 ||
        Math.abs(shift) < 0.5 ||
        block.element.style.translate
      )
        return []
      carried[index] += shift

      return [{ element: block.element, shift, rest: 0 }]
    })
  }
}

/**
 * Opens and closes an edge panel on the shared sidebar spring. `paint` receives how far closed the panel is, from 0
 * (open) to 1 (closed), every frame of a flight and whenever a signal it reads changes at rest. It sizes the panel's
 * real layout box, so the neighbouring content's edge follows the panel's edge on every frame. `present` stays true
 * until a close settles. `whenSettled` defers work that would force a layout, like moving focus, until the flight
 * lands; `sync` shows a state at once, for changes the user makes by hand.
 */
export function createPanelMotion(input: {
  open: Accessor<boolean>
  paint: (closed: number) => void
  /** A change shows the new state without motion, e.g. switching to another session's layout. */
  identity?: Accessor<unknown>
  onClosed?: () => void
  /** Reads layout in the frame loop's read phase, before each frame of a flight paints. */
  measure?: () => void
  /** The panel layer, which fades in under reduced motion. */
  element?: Accessor<HTMLElement | undefined>
  /** The width the panel travels across, in pixels, read once as each flight starts; it scales the flight's time. */
  distance?: () => number | undefined
}) {
  const [present, setPresent] = createSignal(input.open())
  // Percent closed, so the spring's rest threshold stays well under a pixel.
  const motion = new Spring(input.open() ? 0 : 100)
  let stop: (() => void) | undefined
  let landed: (() => void)[] = []
  // A state `sync` asked to show at once, for when the change hasn't reached this motion yet, e.g. inside a batch.
  let snapTo: boolean | undefined
  let flying = false

  const fly = (next: boolean) => {
    if (flying === next) return
    flying = next
    setFlights((count) => count + (next ? 1 : -1))
  }

  const paint = () => input.paint(Math.min(1, Math.max(0, motion.value / 100)))

  // Where the flight's current leg started, for how much of it remains.
  let from = 0

  const landing: Landing = {
    land: () => input.paint(motion.target / 100),
    resume: paint,
    begin: () => {
      from = motion.value
    },
    remaining: () =>
      from === motion.target ? 0 : Math.min(1, Math.max(0, (motion.value - motion.target) / (from - motion.target))),
  }

  const unhold = () => {
    if (!landings.delete(landing)) return
    // Another flight still moving carries the shift from here.
    rehold(driver === landing ? landings.values().next().value : driver)
  }

  const settle = () => {
    stop?.()
    stop = undefined
    fly(false)
    unhold()
    const queued = landed
    landed = []

    if (!input.open()) setPresent(false)

    if (!input.open()) input.onClosed?.()

    queued.forEach((run) => run())
  }

  const snap = (open: boolean) => {
    motion.snap(open ? 0 : 100)
    paint()
    settle()
  }

  createEffect(
    on(
      () => [input.open(), input.identity?.()] as const,
      ([open, identity], previous) => {
        const target = open ? 0 : 100
        // Work queued for the previous direction no longer applies.
        landed = []
        const now = snapTo === open
        snapTo = undefined

        if (open) setPresent(true)

        if (previous === undefined || previous[1] !== identity) {
          stop?.()
          stop = undefined
          fly(false)
          motion.snap(target)
          paint()
          // After the snap, so a flight still moving measures this layout's landing.
          unhold()

          if (!open) setPresent(false)

          return
        }

        if (prefersReducedMotion() && !now) {
          snap(open)

          return open ? reveal() : undefined
        }

        if (now) return snap(open)

        const tuning = panelSpring(input.distance?.())
        motion.omega = (2 * Math.PI) / tuning.duration
        motion.zeta = 1 - tuning.bounce
        // Retargeting keeps the current position and velocity, so a second toggle mid-flight turns around smoothly.
        motion.set(target)
        fly(true)
        landings.add(landing)
        rehold(landing)

        // Writes only; anything reading layout this frame does so in the loop's read phase, before this runs.
        const step = (dt: number) => {
          motion.step(dt)
          paint()

          if (driver === landing) shiftHeld()

          if (!motion.resting) return true
          stop = undefined
          settle()

          return false
        }

        stop ??= input.measure ? frameLoop.addMeasured(input.measure, step) : frameLoop.add(step)
      },
    ),
  )

  /** Reduced motion: the panel, opened at once, fades in without travel. */
  const reveal = () =>
    // Deferred so a panel that mounts with this open exists; microtasks run before the next paint.
    queueMicrotask(() => {
      if (input.open()) input.element?.()?.animate?.({ opacity: [0, 1] }, { duration: 150, easing: ease.out })
    })

  // Repaints at rest when the open size changes, e.g. a resize drag or a window resize.
  createEffect(paint)

  onCleanup(() => {
    stop?.()
    fly(false)
    unhold()
  })

  return {
    present,
    sync: (open: boolean) => {
      if (flying && input.open() === open) return snap(open)
      snapTo = open
    },
    whenSettled: (run: () => void) => {
      if (flying) return void landed.push(run)
      run()
    },
  }
}

/**
 * Keeps focus out of a closing panel without `inert`, which would restyle every element in it: focus inside moves to
 * `target` when the close starts and whenever it enters during the flight. A settled panel is skipped, so nothing in
 * it can take focus.
 */
export function guardClosingFocus(input: {
  root: Accessor<HTMLElement | undefined>
  closing: Accessor<boolean>
  target: () => HTMLElement | undefined
}) {
  const evict = () => {
    const root = input.root()

    if (!input.closing() || !root?.contains(document.activeElement)) return
    const target = input.target()

    if (target) return target.focus({ preventScroll: true })

    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  }

  createEffect(on(input.closing, evict, { defer: true }))
  createEffect(() => {
    const root = input.root()

    if (!root) return
    root.addEventListener("focusin", evict)
    onCleanup(() => root.removeEventListener("focusin", evict))
  })
}

function anchorX(element: HTMLElement, anchor: Anchor) {
  const box = element.getBoundingClientRect()

  if (anchor === "center") return box.left + box.width / 2

  return element.matches(":dir(rtl)") ? box.right : box.left
}
