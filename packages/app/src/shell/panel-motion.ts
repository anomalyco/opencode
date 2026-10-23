import { createEffect, createSignal, on, onCleanup, type Accessor } from "solid-js"
import { ease, frameLoop, prefersReducedMotion, Spring, type DurationOptions } from "@opencode/ui/motion"
import { motionTuning } from "@opencode/ui/motion-tuning"

const group = "Sidebars"

// Panels in flight, across the app. Native views, which no DOM box clips, stay hidden while any panel moves.
const [flights, setFlights] = createSignal(0)

export const panelsMoving = () => flights() > 0

// The "James" option, chosen in the preset strip beside Snappy, Smooth and Calm, swaps the section's knobs for its own: the
// layout moves on its layout spring, like the shared spring's, while the panel opens with a short shift and fade (Web
// Animations on the compositor) and closes at once. The shared spring ships; James stays one choice away.
const james = motionTuning.mode("sidebars.james", { label: "James", group })

const springs = () => !james()

// The left sidebar and the side panel share one spring, so they move as one system.
const spring = motionTuning.spring("sidebars", {
  label: "Slide speed",
  group,
  when: springs,
  shipped: "smooth",
  presets: {
    snappy: { duration: 0.2, bounce: 0 },
    smooth: { duration: 0.3, bounce: 0 },
    calm: { duration: 0.45, bounce: 0 },
  },
})

const style = motionTuning.choice("sidebars.style", {
  label: "Motion",
  group,
  when: springs,
  value: "spring",
  labels: { spring: "Spring", instant: "Instant" },
})

// How far a panel's contents dim at the closed end of a spring flight; they never black out.
const fadeFloor = motionTuning.number("sidebars.fadeFloor", {
  label: "Contents fade to",
  group,
  when: springs,
  value: 0.5,
  min: 0,
  max: 1,
  step: 0.05,
})

/** The opacity of a panel's contents `closed` of the way through a spring flight, from 1 down to the fade floor. */
export const panelOpacity = (closed: number) => (closed === 0 || james() ? "" : `${1 - closed * (1 - fadeFloor())}`)

const jamesShift = motionTuning.spring("sidebars.james.shift", {
  label: "Shift speed",
  group,
  when: james,
  shipped: "smooth",
  presets: {
    snappy: { duration: 0.18, bounce: 0 },
    smooth: { duration: 0.24, bounce: 0 },
    calm: { duration: 0.32, bounce: 0 },
  },
})

const jamesFade = motionTuning.easing("sidebars.james.fade", {
  label: "Fade curve",
  group,
  when: james,
  value: [0.17, 0.85, 0.63, 1.03],
})

const jamesFadeDuration = motionTuning.number("sidebars.james.fadeDuration", {
  label: "Fade duration",
  group,
  when: james,
  value: 0.24,
  min: 0.05,
  max: 0.6,
  step: 0.01,
  unit: "s",
  time: "duration",
})

/** How far the right side panel shifts in from its edge when James opens it, in pixels. */
export const jamesPanelShift = motionTuning.number("sidebars.james.panelShift", {
  label: "Shift distance",
  group,
  when: james,
  value: 46,
  min: 0,
  max: 48,
  step: 1,
  unit: "px",
})

// The layout's width moves on the layout spring, with the timeline held at its landing width as with the shared spring;
// "off" moves it in one frame.
const jamesLayout = motionTuning.choice("sidebars.james.layout", {
  label: "Layout",
  group,
  when: james,
  value: "animate",
  labels: { animate: "Animate", off: "Off" },
})

const layoutSpring = (direction: string, label: string) =>
  motionTuning.spring(`sidebars.james.layout.${direction}`, {
    label,
    group,
    when: () => james() && jamesLayout() !== "off",
    shipped: "smooth",
    presets: {
      snappy: { duration: 0.16, bounce: 0 },
      smooth: { duration: 0.24, bounce: 0 },
      calm: { duration: 0.32, bounce: 0 },
    },
  })

const jamesLayoutOpen = layoutSpring("open", "Layout open speed")

const jamesLayoutClose = layoutSpring("close", "Layout close speed")

// The opacity a panel fades up from under James and down to.
const faded = 0.15

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

/** Adds a button that toggles a panel to the Motion workspace's Sidebars section while the panel is mounted. */
export function replayPanelToggle(input: { id: string; label: string; toggle: () => void }) {
  onCleanup(motionTuning.action({ id: `sidebars.${input.id}`, label: input.label, group, run: input.toggle }))
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
  /**
   * The panel layer, which fades in under reduced motion. James shifts and fades it, `offset` pixels toward its edge
   * (negative for the inline-start edge; mirrored in RTL).
   */
  element?: Accessor<HTMLElement | undefined>
  offset?: () => number
}) {
  const [present, setPresent] = createSignal(input.open())
  // Percent closed, so the spring's rest threshold stays well under a pixel.
  const motion = new Spring(input.open() ? 0 : 100)
  let stop: (() => void) | undefined
  let landed: (() => void)[] = []
  // A state `sync` asked to show at once, for when the change hasn't reached this motion yet, e.g. inside a batch.
  let snapTo: boolean | undefined
  let flying = false
  // James's panel animations, its shift and fade, held at their end until the flight settles; `fading` while they run.
  let fades: Animation[] = []
  let fading = false
  // James's layout flight: the panel stays at its landing box, so its only travel is its own shift.
  const [pinned, setPinned] = createSignal(false)

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
    fades.forEach((animation) => animation.cancel())
    fades = []
    fading = false
    setPinned(false)

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
          fades.forEach((animation) => animation.cancel())
          fades = []
          fading = false
          setPinned(false)
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

        const instantLayout = james() && jamesLayout() === "off"

        if (now || (!james() && style() === "instant")) return snap(open)

        // Without layout motion, the layout opens before the panel fades in and closes after it fades out.
        if (instantLayout) {
          stop?.()
          stop = undefined

          if (open) {
            motion.snap(0)
            paint()
          }

          fly(true)

          return fadePanel(open)
        }

        // James's panel closes at once while its layout lands; it opens with its own fade and shift.
        // James's panel shifts and fades on its own curves, in on open and back out on close.
        if (james()) fadePanel(open)

        setPinned(james())

        const tuning = james() ? (open ? jamesLayoutOpen() : jamesLayoutClose()) : spring()
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

          // A panel still fading settles when its animations finish.
          if (!fading) settle()

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

  /**
   * James: the panel shifts in and fades up on open, and shifts back out and fades down on close, then hides once the
   * flight settles. A reversal turns around from where the panel is. Deferred so a panel that mounts with this open
   * exists first.
   */
  const fadePanel = (open: boolean) =>
    queueMicrotask(() => {
      const element = input.element?.()

      if (input.open() !== open) return

      if (!element?.animate) return stop ? undefined : snap(open)

      const x = (input.offset?.() ?? 0) * (element.matches(":dir(rtl)") ? -1 : 1)
      const away = { transform: `translateX(${x}px)`, opacity: `${faded}` }
      const rest = { transform: "none", opacity: "1" }
      const now = getComputedStyle(element)
      const start = fades.length > 0 ? { transform: now.transform, opacity: now.opacity } : open ? away : rest
      const end = open ? rest : away
      fades.forEach((animation) => animation.cancel())

      const current = [
        element.animate(
          { transform: [start.transform, end.transform] },
          { ...springEasing(jamesShift()), fill: "both" },
        ),
        element.animate(
          { opacity: [start.opacity, end.opacity] },
          {
            duration: jamesFadeDuration() * 1000,
            easing: `cubic-bezier(${(open ? jamesFade() : reverseBezier(jamesFade())).join(", ")})`,
            fill: "both",
          },
        ),
      ]

      fades = current
      fading = true
      void Promise.all(current.map((animation) => animation.finished)).then(
        () => {
          if (current !== fades) return
          fading = false

          // Without a spring still landing the layout, the flight ends here (a close's layout moves now).
          if (!stop) return snap(input.open())

          // A closed panel is gone once it has faded out, while the layout's spring finishes landing.
          if (!input.open()) fades.push(element.animate({ opacity: [0, 0] }, { duration: 0, fill: "forwards" }))
        },
        () => undefined,
      )
    })

  // Repaints at rest when the open size changes, e.g. a resize drag or a window resize.
  createEffect(paint)

  onCleanup(() => {
    stop?.()
    fades.forEach((animation) => animation.cancel())
    fly(false)
    unhold()
  })

  return {
    present,
    pinned,
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

/** A spring sampled per 60 Hz frame into a CSS `linear()` easing. It ends once within 0.5% of rest, a twentieth of a
 * pixel on these shifts. */
function springEasing(tuning: DurationOptions) {
  const spring = Spring.fromDuration(0, tuning).set(1)
  const points = [0]

  while (points.length < 240 && points.at(-1)! < 0.995) points.push(Math.round(spring.step(1 / 60) * 1000) / 1000)
  points[points.length - 1] = 1

  return { duration: ((points.length - 1) * 1000) / 60, easing: `linear(${points.join(", ")})` }
}

/** The curve that plays `curve` backwards in time, so a close looks like its open in reverse. */
function reverseBezier([x1, y1, x2, y2]: readonly number[]) {
  return [1 - x2, 1 - y2, 1 - x1, 1 - y1].map((value) => Math.round(value * 1000) / 1000)
}

function anchorX(element: HTMLElement, anchor: Anchor) {
  const box = element.getBoundingClientRect()

  if (anchor === "center") return box.left + box.width / 2

  return element.matches(":dir(rtl)") ? box.right : box.left
}
