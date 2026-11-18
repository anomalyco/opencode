import { afterEach, beforeEach, expect, it, jest } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createSidebarPeek } from "../src/shell/sidebar-peek"

const cleanups: (() => void)[] = []

// The dwell, grace, watch and slide-out fallbacks are timers; fake time keeps them exact on a loaded runner.
beforeEach(() => jest.useFakeTimers())

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  document.body.innerHTML = ""
  jest.useRealTimers()
})

function mount() {
  const row = document.createElement("div")
  const aside = document.createElement("aside")
  const panel = document.createElement("div")
  const content = document.createElement("main")
  aside.append(panel)
  row.append(aside, content)
  document.body.append(row)
  const [open, setOpen] = createSignal(false)
  const [enabled, setEnabled] = createSignal(true)
  const painted: (number | undefined)[] = []
  const docked: (() => void)[] = []

  const peek = createRoot((dispose) => {
    cleanups.push(dispose)

    return createSidebarPeek({
      available: () => !open(),
      open,
      enabled,
      aside: () => aside,
      panel: () => panel,
      paint: (shown) => painted.push(shown),
      whenDocked: (run) => docked.push(run),
    })
  })

  return { peek, content, setOpen, setEnabled, painted, docked }
}

// Rests the pointer on the window's start edge, below the header band.
function restOnEdge(target: Element, clientX = 2, buttons = 0) {
  target.dispatchEvent(
    new PointerEvent("pointermove", { bubbles: true, clientX, clientY: 300, buttons, pointerType: "mouse" }),
  )
}

// Past the edge's 40ms dwell, and short of the 150ms watch that would start closing a peek the pointer isn't in.
const afterDwell = () => jest.advanceTimersByTime(60)

it("peeks once the pointer rests on the window's start edge", () => {
  const view = mount()
  restOnEdge(view.content)
  afterDwell()
  expect(view.peek.shown()).toBe(true)
})

it("peeks from the edge zone 16px past the 8px gutter, and not beyond it", () => {
  const inside = mount()
  restOnEdge(inside.content, 24)
  afterDwell()
  expect(inside.peek.shown()).toBe(true)

  const beyond = mount()
  restOnEdge(beyond.content, 25)
  afterDwell()
  expect(beyond.peek.shown()).toBe(false)
})

it("doesn't peek while a mouse button is held, as when a text selection drags into the edge zone", () => {
  const view = mount()
  restOnEdge(view.content, 12, 1)
  afterDwell()
  expect(view.peek.shown()).toBe(false)
})

it("a press, a drag, a dialog, a resize or a window blur clears the pending peek", () => {
  const interruptions = [
    () => document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" })),
    () => document.dispatchEvent(new Event("dragstart", { bubbles: true })),
    () => window.dispatchEvent(new Event("resize")),
    () => window.dispatchEvent(new Event("blur")),
    () => {
      const dialog = document.createElement("div")
      dialog.setAttribute("role", "dialog")
      document.body.append(dialog)
    },
  ]

  for (const interrupt of interruptions) {
    const view = mount()
    restOnEdge(view.content)
    interrupt()
    afterDwell()
    expect(view.peek.shown()).toBe(false)

    for (const cleanup of cleanups.splice(0)) cleanup()
    document.body.innerHTML = ""
  }
})

it("a press released outside the window no longer holds the peek open", () => {
  const view = mount()
  restOnEdge(view.content)
  afterDwell()
  expect(view.peek.shown()).toBe(true)

  // Pressed, then out of the window, where no pointerup reaches the page.
  document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, buttons: 1, pointerType: "mouse" }))
  document.documentElement.dispatchEvent(new PointerEvent("pointerleave", { pointerType: "mouse" }))
  // The 100ms grace, then the slide out, which settles by its 800ms fallback when no frame lands it first.
  jest.advanceTimersByTime(1_000)
  expect(view.peek.shown()).toBe(false)

  restOnEdge(view.content)
  afterDwell()
  expect(view.peek.shown()).toBe(true)
})

it("a dock from a peek ends the hand-off once the docked sidebar lands", async () => {
  const view = mount()
  restOnEdge(view.content)
  afterDwell()
  view.setOpen(true)
  expect(view.peek.handedOff()).toBe(true)
  expect(view.peek.shown()).toBe(true)

  await Promise.resolve()
  view.docked.forEach((run) => run())
  expect(view.peek.handedOff()).toBe(false)
  expect(view.peek.shown()).toBe(false)
  expect(view.painted.at(-1)).toBeUndefined()
})

it("ends a peek at once when the vertical sidebar goes away", () => {
  const view = mount()
  restOnEdge(view.content)
  afterDwell()
  expect(view.peek.shown()).toBe(true)

  view.setEnabled(false)
  expect(view.peek.shown()).toBe(false)
  expect(view.painted.at(-1)).toBeUndefined()
})
