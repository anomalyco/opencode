import { afterEach, beforeEach, expect, it } from "bun:test"
import { batch, createRoot, createSignal } from "solid-js"
import { motionTuning } from "@opencode/ui/motion-tuning"
import { createPanelMotion, guardClosingFocus, holdLandingWidth, panelsMoving } from "../src/shell/panel-motion"

let frames: Map<number, FrameRequestCallback>

let id: number

let time: number

const cleanups: (() => void)[] = []

const originals = { raf: globalThis.requestAnimationFrame, caf: globalThis.cancelAnimationFrame }

beforeEach(() => {
  // The spring tests run with James off; James's own tests turn it on.
  setJames(false)
  frames = new Map()
  id = 0
  time = 0
  globalThis.requestAnimationFrame = (fn: FrameRequestCallback) => {
    frames.set(++id, fn)

    return id
  }

  globalThis.cancelAnimationFrame = (key: number) => {
    frames.delete(key)
  }
})

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  globalThis.requestAnimationFrame = originals.raf
  globalThis.cancelAnimationFrame = originals.caf
  setStyle("spring")
  setJames(false)
})

function setStyle(value: string) {
  const knob = motionTuning.list().find((item) => item.id === "sidebars.style")

  if (knob?.kind === "choice") motionTuning.set(knob, value)
}

// James is a mode, chosen in the preset strip rather than the Motion choice.
function setJames(on: boolean) {
  const knob = motionTuning.list().find((item) => item.id === "sidebars.james")

  if (knob?.kind === "mode") motionTuning.set(knob, on)
}

function frame() {
  time += 1000 / 60
  const next = [...frames.values()]
  frames.clear()

  for (const callback of next) callback(time)
}

function settle() {
  for (let i = 0; i < 120 && frames.size; i++) frame()
}

function setup(initial: boolean) {
  const [open, setOpen] = createSignal(initial)
  const [identity, setIdentity] = createSignal("a")
  const [size, setSize] = createSignal(200)
  const closed: number[] = []
  const painted = { width: 0 }

  const motion = createRoot((dispose) => {
    cleanups.push(dispose)

    return createPanelMotion({
      open,
      paint: (shut) => {
        painted.width = size() * (1 - shut)
      },
      identity,
      onClosed: () => closed.push(time),
    })
  })

  return { painted, setOpen, setIdentity, setSize, closed, present: motion.present, motion }
}

it("sizes the panel a little every frame on the way open and closed, present until the close settles", () => {
  const panel = setup(false)
  panel.setOpen(true)
  expect(panel.present()).toBe(true)
  expect(panel.painted.width).toBe(0)
  const widths: number[] = []

  for (let i = 0; i < 120 && frames.size; i++) {
    frame()
    widths.push(panel.painted.width)
  }

  const steps = widths.map((width, index) => width - (widths[index - 1] ?? 0))
  expect(widths.length).toBeGreaterThan(5)
  expect(steps.every((step) => step >= 0)).toBe(true)
  expect(Math.max(...steps)).toBeLessThan(60)
  // The last moving frame lands within a pixel of rest.
  expect(200 - widths.findLast((width) => width < 200)!).toBeLessThan(1)

  panel.setOpen(false)
  frame()
  expect(panel.present()).toBe(true)
  expect(panel.closed).toEqual([])
  settle()
  expect(panel.painted.width).toBe(0)
  expect(panel.present()).toBe(false)
  expect(panel.closed).toHaveLength(1)
})

it("turns around mid-flight from where it is", () => {
  const panel = setup(false)
  panel.setOpen(true)
  frame()
  frame()
  frame()
  const before = panel.painted.width

  panel.setOpen(false)
  expect(panel.painted.width).toBe(before)
  frame()
  // Still carrying its opening velocity, it does not jump back closed.
  expect(Math.abs(panel.painted.width - before)).toBeLessThan(30)
  settle()
  expect(panel.present()).toBe(false)
  expect(panel.painted.width).toBe(0)
})

it("repaints at rest when the open size changes, like a resize drag", () => {
  const panel = setup(true)
  expect(panel.painted.width).toBe(200)

  panel.setSize(260)
  expect(panel.painted.width).toBe(260)
  expect(frames.size).toBe(0)
})

it("snaps when the Motion workspace sets Instant", () => {
  setStyle("instant")
  const panel = setup(true)

  panel.setOpen(false)
  expect(panel.painted.width).toBe(0)
  expect(panel.present()).toBe(false)
  expect(panel.closed).toHaveLength(1)
  expect(frames.size).toBe(0)
})

it("shows another layout's state without motion or a close", () => {
  const panel = setup(true)

  panel.setOpen(false)
  panel.setIdentity("b")
  expect(panel.present()).toBe(false)
  expect(panel.painted.width).toBe(0)
  expect(panel.closed).toEqual([])
  expect(frames.size).toBe(0)
})

it("shows a state at once when synced, also from inside a batch", () => {
  const panel = setup(true)

  batch(() => {
    panel.setOpen(false)
    panel.motion.sync(false)
  })
  expect(panel.painted.width).toBe(0)
  expect(panel.present()).toBe(false)
  expect(frames.size).toBe(0)

  panel.setOpen(true)
  frame()
  panel.motion.sync(true)
  expect(panel.painted.width).toBe(200)
  expect(frames.size).toBe(0)
})

it("runs settled work once the flight lands, dropping work queued before a turnaround", () => {
  const panel = setup(false)
  const ran: string[] = []
  panel.setOpen(true)
  panel.motion.whenSettled(() => ran.push("opened"))
  frame()
  panel.setOpen(false)
  panel.motion.whenSettled(() => ran.push("closed"))
  frame()
  expect(ran).toEqual([])
  settle()
  expect(ran).toEqual(["closed"])
  panel.motion.whenSettled(() => ran.push("at rest"))
  expect(ran).toEqual(["closed", "at rest"])
})

it("reports a flight from its first frame until it lands, for native views to hide", () => {
  const panel = setup(true)
  expect(panelsMoving()).toBe(false)

  panel.setOpen(false)
  expect(panelsMoving()).toBe(true)
  frame()
  panel.setOpen(true)
  expect(panelsMoving()).toBe(true)
  settle()
  expect(panelsMoving()).toBe(false)

  setStyle("instant")
  panel.setOpen(false)
  expect(panelsMoving()).toBe(false)
})

it("holds content beside the panel at its landing width for the flight, its anchor's edge travelling smoothly", () => {
  const box = document.createElement("div")
  const anchor = document.createElement("div")
  box.append(anchor)
  document.body.append(box)
  cleanups.push(() => box.remove())
  const [open, setOpen] = createSignal(false)
  const painted = { width: 0 }
  // The box beside the panel takes what the panel leaves of 1000px; its centred column starts 60px further in once
  // the box is held at its landing width. happy-dom has no layout.
  box.getBoundingClientRect = () => new DOMRect(0, 0, 1000 - painted.width, 10)
  anchor.getBoundingClientRect = () =>
    new DOMRect(box.style.getPropertyValue("--panel-hold-width") ? 160 : 100, 0, 10, 10)
  createRoot((dispose) => {
    cleanups.push(dispose)
    holdLandingWidth(
      () => box,
      () => anchor,
    )
    createPanelMotion({ open, paint: (shut) => (painted.width = 300 * (1 - shut)) })
  })

  setOpen(true)
  expect(painted.width).toBe(0)
  expect(box.style.getPropertyValue("--panel-hold-width")).toBe("700px")
  // The column's start edge stays where it was, and the shift runs out with the flight.
  expect(box.style.translate).toBe("-60px")
  const shifts: number[] = []

  for (let i = 0; i < 6; i++) {
    frame()
    shifts.push(parseFloat(box.style.translate))
  }

  expect(box.style.getPropertyValue("--panel-hold-width")).toBe("700px")
  expect(shifts.every((shift, index) => shift > (shifts[index - 1] ?? -60) && shift < 0)).toBe(true)

  setOpen(false)
  expect(box.style.getPropertyValue("--panel-hold-width")).toBe("1000px")
  settle()
  expect(box.style.getPropertyValue("--panel-hold-width")).toBe("")
  expect(box.style.translate).toBe("")
})

it("keeps a held box's end-aligned blocks still and its centred column centred while its start edge moves", () => {
  const box = document.createElement("div")
  const tabs = document.createElement("div")
  const label = document.createElement("div")
  const column = document.createElement("div")
  // Like the side region's tab content, the column sits in a `display: contents` wrapper, which has no box.
  const wrapper = document.createElement("div")
  wrapper.style.display = "contents"
  wrapper.append(column)
  tabs.append(label)
  box.append(tabs, wrapper)
  document.body.append(box)
  cleanups.push(() => box.remove())
  const [open, setOpen] = createSignal(false)
  const painted = { width: 0 }
  // The box is what the panel leaves of 1000px: its start edge moves, its end stays at 1000. Its contents lay out from
  // its start at the held width: a tab bar across them with a 50px label at its end, and a 400px column centred in
  // them. happy-dom has no layout.
  const width = () => parseFloat(box.style.getPropertyValue("--panel-hold-width")) || 1000 - painted.width
  const x = (element: HTMLElement, left: number) => left + (parseFloat(element.style.translate) || 0)
  box.getBoundingClientRect = () => new DOMRect(painted.width, 0, 1000 - painted.width, 100)
  tabs.getBoundingClientRect = () => new DOMRect(painted.width, 0, width(), 10)
  label.getBoundingClientRect = () => new DOMRect(painted.width + width() - 50, 0, 50, 10)
  column.getBoundingClientRect = () => new DOMRect(painted.width + width() / 2 - 200, 10, 400, 90)
  // A long document: its rows run far below the box, and reading them all would stall the flight's first frame.
  const reads = { rows: 0 }
  Array.from({ length: 2000 }, (_, index) => {
    const row = document.createElement("div")
    row.getBoundingClientRect = () => (reads.rows++, new DOMRect(0, 100 + index * 20, 400, 20))
    column.append(row)
  })
  createRoot((dispose) => {
    cleanups.push(dispose)
    holdLandingWidth(() => box, "blocks")
    createPanelMotion({ open, paint: (shut) => (painted.width = 300 * (1 - shut)) })
  })

  const fly = () =>
    Array.from({ length: 12 }, () => {
      frame()

      return {
        label: x(label, painted.width + width() - 50),
        // How far the column's centre is from the centre of the box as it is.
        column: x(column, painted.width + width() / 2 - 200) + 200 - (painted.width + 1000) / 2,
      }
    })

  // The box narrows: it keeps its 1000px until it lands at 700px, so it still reaches the end.
  setOpen(true)
  expect(reads.rows).toBeLessThan(500)
  expect(box.style.getPropertyValue("--panel-hold-width")).toBe("1000px")
  const narrowing = fly()
  expect(tabs.style.translate).toBeFalsy()
  settle()
  // The box widens: it lays out at the 1000px it lands at from the start.
  setOpen(false)
  expect(box.style.getPropertyValue("--panel-hold-width")).toBe("1000px")
  const widening = fly()
  settle()

  for (const frame of [...narrowing, ...widening]) {
    expect(Math.abs(frame.label - 950)).toBeLessThan(0.5)
    expect(Math.abs(frame.column)).toBeLessThan(0.5)
  }

  expect(label.style.translate).toBe("")
  expect(column.style.translate).toBe("")
})

it("fades an opening panel in without travel under reduced motion", async () => {
  document.documentElement.dataset.motion = "reduce"
  cleanups.push(() => delete document.documentElement.dataset.motion)
  const played: PropertyIndexedKeyframes[] = []
  const element = document.createElement("div")
  Object.defineProperty(element, "animate", { value: (keyframes: PropertyIndexedKeyframes) => played.push(keyframes) })
  const [open, setOpen] = createSignal(false)
  const painted = { width: 0 }
  createRoot((dispose) => {
    cleanups.push(dispose)
    createPanelMotion({ open, paint: (shut) => (painted.width = 200 * (1 - shut)), element: () => element })
  })

  setOpen(true)
  expect(painted.width).toBe(200)
  expect(frames.size).toBe(0)
  await Promise.resolve()
  expect(played).toEqual([{ opacity: [0, 1] }])
})

it("moves focus out of a closing panel when the close starts and when it re-enters mid-flight", () => {
  const root = document.createElement("div")
  const inner = document.createElement("button")
  const toggle = document.createElement("button")
  root.append(inner)
  document.body.append(root, toggle)
  const [closing, setClosing] = createSignal(false)
  cleanups.push(
    createRoot((dispose) => {
      guardClosingFocus({ root: () => root, closing, target: () => toggle })

      return dispose
    }),
    () => {
      root.remove()
      toggle.remove()
    },
  )

  inner.focus()
  setClosing(true)
  expect(document.activeElement).toBe(toggle)

  inner.focus()
  expect(document.activeElement).toBe(toggle)

  setClosing(false)
  inner.focus()
  expect(document.activeElement).toBe(inner)
})

type Played = {
  keyframes: PropertyIndexedKeyframes
  options: KeyframeAnimationOptions
  cancelled: boolean
  finish: () => void
}

// happy-dom has no Web Animations, so the panel layer records what James asks it to play.
function setupJames(initial: boolean) {
  setJames(true)
  const [open, setOpen] = createSignal(initial)
  const played: Played[] = []
  const closed: number[] = []
  const painted = { width: initial ? 200 : 0 }
  const element = document.createElement("div")
  Object.defineProperty(element, "animate", {
    value: (keyframes: PropertyIndexedKeyframes, options: KeyframeAnimationOptions) => {
      const finished = Promise.withResolvers<void>()
      const animation = { keyframes, options, cancelled: false, finish: () => finished.resolve() }
      played.push(animation)

      return {
        finished: finished.promise,
        cancel: () => {
          animation.cancelled = true
          finished.reject(new Error("cancelled"))
        },
      }
    },
  })

  const motion = createRoot((dispose) => {
    cleanups.push(dispose)

    return createPanelMotion({
      open,
      paint: (shut) => {
        painted.width = 200 * (1 - shut)
      },
      onClosed: () => closed.push(time),
      element: () => element,
      offset: () => -10,
    })
  })

  return { played, setOpen, closed, painted, motion }
}

it("James snaps under reduced motion", () => {
  document.documentElement.dataset.motion = "reduce"
  cleanups.push(() => delete document.documentElement.dataset.motion)
  const panel = setupJames(true)
  panel.setOpen(false)

  expect(panel.played).toEqual([])
  expect(panel.painted.width).toBe(0)
  expect(panel.motion.present()).toBe(false)
})

it("swaps the spring knobs for James's while it's on", () => {
  const shown = () =>
    motionTuning
      .list()
      .filter((knob) => knob.group === "Sidebars" && knob.kind !== "mode" && (knob.when?.() ?? true))
      .map((knob) => knob.label)

  expect(shown()).toEqual(["Slide speed", "Motion", "Contents fade to"])
  setJames(true)
  expect(shown()).toEqual([
    "Shift speed",
    "Fade curve",
    "Fade duration",
    "Shift distance",
    "Layout",
    "Layout open speed",
    "Layout close speed",
  ])
  setJames(false)
  expect(shown()).toEqual(["Slide speed", "Motion", "Contents fade to"])
})

it("ships the spring as the default sidebar motion, with James one choice away", () => {
  const knob = motionTuning.list().find((item) => item.id === "sidebars.james")

  expect(knob?.kind).toBe("mode")
  expect(knob?.initial).toBe(false)
  // The side panel shifts 46px by default; the left sidebar stays at 10px.
  expect(motionTuning.list().find((item) => item.id === "sidebars.james.panelShift")?.initial).toBe(46)
})
