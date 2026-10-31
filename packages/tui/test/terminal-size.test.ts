import { expect, test } from "bun:test"
import type { CliRenderer } from "@opentui/core"
import { guardTerminalResize } from "../src/terminal-size"

// Bun reports an inverted console viewport as 2^64 - 29, printed as 2^64.
const INVERTED_WIDTH = 18446744073709552000

function fakeRenderer(width: number, height: number) {
  const calls: Array<[number, number]> = []
  const layouts: Array<[number, number]> = []
  let repaints = 0
  const renderer = {
    _terminalWidth: width,
    _terminalHeight: height,
    width,
    height,
    forceFullRepaintRequested: false,
    root: {
      resize(w: number, h: number) {
        layouts.push([w, h])
      },
    },
    requestResize(w: number, h: number) {
      calls.push([w, h])
    },
    requestRender() {
      repaints++
    },
  }
  return {
    renderer: renderer as unknown as CliRenderer,
    raw: renderer,
    calls,
    layouts,
    repaints: () => repaints,
  }
}

// Reports the viewport as inverted for the first `invalidChecks` checks, then
// valid. `actual` is the window's real size.
function fakeViewport(invalidChecks: number, actual = { width: 120, height: 30 }) {
  let checks = 0
  return {
    repairs: 0,
    valid() {
      checks++
      return checks > invalidChecks
    },
    size() {
      return actual
    },
    repair() {
      this.repairs++
    },
  }
}

test("forwards a resize that changes the size", () => {
  const { renderer, calls, layouts } = fakeRenderer(120, 30)

  const restore = guardTerminalResize(renderer, fakeViewport(0))
  renderer.requestResize(271, 63)
  restore()

  expect(calls).toEqual([[271, 63]])
  expect(layouts).toEqual([])
})

test("rebuilds the layout and repaints when the size is unchanged", () => {
  const { renderer, raw, calls, layouts, repaints } = fakeRenderer(271, 63)

  const restore = guardTerminalResize(renderer, fakeViewport(0, { width: 271, height: 63 }))
  renderer.requestResize(271, 63)
  restore()

  expect(calls).toEqual([[271, 63]])
  expect(layouts).toEqual([[271, 63]])
  expect(repaints()).toBe(1)
  expect(raw.forceFullRepaintRequested).toBe(true)
})

test("repairs an inverted viewport at once, then redraws once it is valid", async () => {
  const { renderer, layouts, repaints } = fakeRenderer(120, 30)
  const viewport = fakeViewport(1)

  const restore = guardTerminalResize(renderer, viewport)
  renderer.requestResize(INVERTED_WIDTH, 30)

  expect(viewport.repairs).toBe(1)
  expect(layouts).toEqual([])

  await Bun.sleep(600)
  restore()

  expect(layouts).toEqual([[120, 30]])
  expect(repaints()).toBe(1)
})

test("repairs the viewport on the timer even when no resize event arrives", async () => {
  const { renderer, layouts } = fakeRenderer(120, 30)
  const viewport = fakeViewport(1)

  // First tick (500ms) repairs; second tick (1000ms) finds it valid and redraws.
  const restore = guardTerminalResize(renderer, viewport)
  await Bun.sleep(1200)
  restore()

  expect(viewport.repairs).toBe(1)
  expect(layouts).toEqual([[120, 30]])
})

test("resizes to the window's real size when it differs from the cached one", async () => {
  const { renderer, calls, layouts } = fakeRenderer(271, 63)
  const viewport = fakeViewport(1, { width: 120, height: 30 })

  const restore = guardTerminalResize(renderer, viewport)
  renderer.requestResize(INVERTED_WIDTH, 63)

  await Bun.sleep(600)
  restore()

  expect(calls).toEqual([[120, 30]])
  expect(layouts).toEqual([])
})

test("a valid resize clears the broken state, so the next valid check does not redraw again", async () => {
  const { renderer, layouts, repaints } = fakeRenderer(120, 30)
  const viewport = fakeViewport(1)

  const restore = guardTerminalResize(renderer, viewport)
  renderer.requestResize(INVERTED_WIDTH, 30)
  renderer.requestResize(120, 30)

  await Bun.sleep(600)
  restore()

  expect(layouts).toEqual([[120, 30]])
  expect(repaints()).toBe(1)
})

test("restoring puts the original requestResize back", () => {
  const original = () => {}
  const renderer = { requestResize: original } as unknown as CliRenderer

  const restore = guardTerminalResize(renderer, undefined)
  expect(renderer.requestResize).not.toBe(original)

  restore()
  expect(renderer.requestResize).toBe(original)
})
