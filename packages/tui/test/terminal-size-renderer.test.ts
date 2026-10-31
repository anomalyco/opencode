import { expect, spyOn, test } from "bun:test"
import { createTestRenderer, ManualClock } from "@opentui/core/testing"
import { guardTerminalResize } from "../src/terminal-size"

// Bun reports an inverted console viewport as 2^64 - 29, printed as 2^64.
const INVERTED_WIDTH = 18446744073709552000

// Inverted until repair() runs. Its real size matches the renderer.
function fakeViewport() {
  let repaired = false
  return {
    repairs: 0,
    valid: () => repaired,
    size: () => ({ width: 120, height: 30 }),
    repair() {
      repaired = true
      this.repairs++
    },
  }
}

test("a bogus resize reading never reaches the native renderer", async () => {
  const clock = new ManualClock()
  const setup = await createTestRenderer({ width: 120, height: 30, clock })
  setup.renderer.pause()
  const errors = spyOn(console, "error")
  const restore = guardTerminalResize(setup.renderer, undefined)

  setup.renderer.requestResize(INVERTED_WIDTH, 30)
  clock.advance(500)
  await setup.renderOnce()
  restore()

  expect(errors).not.toHaveBeenCalled()
  expect(setup.renderer.width).toBe(120)
  errors.mockRestore()
  setup.renderer.destroy()
})

test("an inverted viewport is repaired on the clock, then the layout is rebuilt", async () => {
  const clock = new ManualClock()
  const setup = await createTestRenderer({ width: 120, height: 30, clock })
  setup.renderer.pause()
  const viewport = fakeViewport()
  const resize = spyOn(setup.renderer.root, "resize")
  const restore = guardTerminalResize(setup.renderer, viewport)

  clock.advance(500)
  expect(viewport.repairs).toBe(1)
  expect(resize).not.toHaveBeenCalled()

  clock.advance(500)
  restore()
  expect(viewport.repairs).toBe(1)
  expect(resize).toHaveBeenCalledTimes(1)
  resize.mockRestore()
  setup.renderer.destroy()
})

test("a same-size resize right after a repair rebuilds the layout once", async () => {
  const clock = new ManualClock()
  const setup = await createTestRenderer({ width: 120, height: 30, clock })
  setup.renderer.pause()
  const resize = spyOn(setup.renderer.root, "resize")
  const restore = guardTerminalResize(setup.renderer, fakeViewport())

  clock.advance(500)
  setup.renderer.requestResize(120, 30)
  expect(resize).toHaveBeenCalledTimes(1)

  clock.advance(500)
  restore()
  expect(resize).toHaveBeenCalledTimes(1)
  resize.mockRestore()
  setup.renderer.destroy()
})
