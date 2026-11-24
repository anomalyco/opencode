import { afterEach, expect, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createPaneDrag } from "@/runtime/plugin/pane-drag"
import type { PaneDropTarget } from "@/runtime/plugin/pane-drag-machine"

const cleanups: (() => void)[] = []

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup())
  document.body.innerHTML = ""
  document.body.removeAttribute("style")
  document.documentElement.removeAttribute("style")
})

// happy-dom lays nothing out and computes no default overflow, so the page states what a browser would.
function mountStrip() {
  for (const element of [document.documentElement, document.body]) {
    element.style.overflowX = "visible"
    element.style.overflowY = "visible"
  }

  const strip = document.createElement("div")
  strip.dataset.paneStrip = "side"
  strip.getBoundingClientRect = () => new DOMRect(0, 0, 200, 30)
  const tab = document.createElement("div")
  tab.dataset.paneTab = "file://b.ts"
  tab.getBoundingClientRect = () => new DOMRect(100, 0, 80, 30)
  strip.append(tab)
  document.body.append(strip)

  return tab
}

function setup() {
  const [identity, setIdentity] = createSignal("session-1")
  const drops: { key: string; target: PaneDropTarget }[] = []

  const screen = createRoot((dispose) => ({
    dispose,
    drag: createPaneDrag({
      identity,
      shown: () => true,
      drop: (key, target) => drops.push({ key, target }),
    }),
  }))

  cleanups.push(screen.dispose)

  return { ...screen, drops, setIdentity }
}

const pointer = (type: string, x: number, pointerId = 1) =>
  new PointerEvent(type, { pointerId, clientX: x, clientY: 10, button: 0 })

function startDrag(fixture: ReturnType<typeof setup>) {
  fixture.drag.start(pointer("pointerdown", 0), "file://a.ts", "a.ts")
  window.dispatchEvent(pointer("pointermove", 20))
}

test("releasing over a strip drops the tab and swallows the release's click for one task", async () => {
  const tab = mountStrip()
  const fixture = setup()
  const clicks: string[] = []
  tab.addEventListener("click", () => clicks.push("click"))

  startDrag(fixture)

  expect(fixture.drag.dragging()).toBe("file://a.ts")
  expect(document.body.style.cursor).toBe("grabbing")

  window.dispatchEvent(pointer("pointerup", 20))
  tab.click()

  expect(fixture.drag.dragging()).toBeUndefined()
  expect(fixture.drops).toEqual([
    { key: "file://a.ts", target: expect.objectContaining({ pane: "side", before: "file://b.ts", strip: true }) },
  ])
  expect(clicks).toEqual([])

  await new Promise((resolve) => setTimeout(resolve))
  tab.click()

  expect(clicks).toEqual(["click"])
})

test("disposing the screen mid-drag unlocks the body, and a later release drops nothing", () => {
  mountStrip()
  const fixture = setup()

  startDrag(fixture)

  expect(document.body.style.userSelect).toBe("none")

  fixture.dispose()

  expect(document.body.style.userSelect).toBe("")
  expect(document.body.style.cursor).toBe("")

  window.dispatchEvent(pointer("pointerup", 20))

  expect(fixture.drops).toEqual([])
})

test("switching session mid-drag cancels it, and the release drops nothing", () => {
  mountStrip()
  const fixture = setup()

  startDrag(fixture)
  fixture.setIdentity("session-2")

  expect(fixture.drag.dragging()).toBeUndefined()
  expect(document.body.style.userSelect).toBe("")

  window.dispatchEvent(pointer("pointerup", 20))

  expect(fixture.drops).toEqual([])
})

test("a second pointer neither moves nor ends the first pointer's drag", () => {
  mountStrip()
  const fixture = setup()

  startDrag(fixture)
  fixture.drag.start(pointer("pointerdown", 150, 2), "file://c.ts", "c.ts")
  window.dispatchEvent(pointer("pointermove", 190, 2))
  window.dispatchEvent(pointer("pointerup", 190, 2))

  expect(fixture.drag.dragging()).toBe("file://a.ts")
  expect(fixture.drops).toEqual([])

  window.dispatchEvent(pointer("pointerup", 20))

  expect(fixture.drops).toEqual([
    { key: "file://a.ts", target: expect.objectContaining({ pane: "side", before: "file://b.ts" }) },
  ])
})
