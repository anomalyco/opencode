import { afterEach, expect, it } from "bun:test"
import { createRoot } from "solid-js"
import { createSidebarPeek } from "../src/shell/sidebar-peek"

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
  document.body.innerHTML = ""
})

function mount() {
  const row = document.createElement("div")
  const aside = document.createElement("aside")
  const panel = document.createElement("div")
  const content = document.createElement("main")
  aside.append(panel)
  row.append(aside, content)
  document.body.append(row)

  const peek = createRoot((dispose) => {
    cleanups.push(dispose)

    return createSidebarPeek({
      available: () => true,
      open: () => false,
      aside: () => aside,
      panel: () => panel,
      paint: () => {},
      whenDocked: (run) => run(),
    })
  })

  return { peek, content }
}

// Rests the pointer on the window's start edge, below the header band.
function restOnEdge(target: Element, clientX = 2, buttons = 0) {
  target.dispatchEvent(
    new PointerEvent("pointermove", { bubbles: true, clientX, clientY: 300, buttons, pointerType: "mouse" }),
  )
}

const afterDwell = () => Bun.sleep(160)

it("peeks once the pointer rests on the window's start edge", async () => {
  const view = mount()
  restOnEdge(view.content)
  await afterDwell()
  expect(view.peek.shown()).toBe(true)
})

it("peeks from the edge zone 16px past the 8px gutter, and not beyond it", async () => {
  const inside = mount()
  restOnEdge(inside.content, 24)
  await afterDwell()
  expect(inside.peek.shown()).toBe(true)

  const beyond = mount()
  restOnEdge(beyond.content, 25)
  await afterDwell()
  expect(beyond.peek.shown()).toBe(false)
})

it("doesn't peek while a mouse button is held, as when a text selection drags into the edge zone", async () => {
  const view = mount()
  restOnEdge(view.content, 12, 1)
  await afterDwell()
  expect(view.peek.shown()).toBe(false)
})

it("a press, a drag, a dialog or a resize clears the pending peek", async () => {
  const interruptions = [
    () => document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" })),
    () => document.dispatchEvent(new Event("dragstart", { bubbles: true })),
    () => window.dispatchEvent(new Event("resize")),
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
    await afterDwell()
    expect(view.peek.shown()).toBe(false)

    for (const cleanup of cleanups.splice(0)) cleanup()
    document.body.innerHTML = ""
  }
})
