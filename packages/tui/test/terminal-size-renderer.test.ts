import { expect, spyOn, test } from "bun:test"
import { createTestRenderer, ManualClock } from "@opentui/core/testing"
import { guardTerminalResize } from "../src/terminal-size"

// Bun reports an inverted console viewport as 2^64 - 29, printed as 2^64.
const INVERTED_WIDTH = 18446744073709552000

// Inverted until repair() runs. `fixed` decides whether repair() makes it valid.
function fakeViewport(fixed: boolean) {
  let repaired = false
  return {
    repairs: 0,
    valid: () => repaired,
    size: () => ({ width: 120, height: 30 }),
    repair() {
      this.repairs++
      if (fixed) repaired = true
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

test("a viewport the repair cannot fix restarts the renderer on the alternate screen", async () => {
  const clock = new ManualClock()
  const setup = await createTestRenderer({ width: 120, height: 30, clock, screenMode: "alternate-screen" })
  setup.renderer.pause()
  const suspend = spyOn(setup.renderer, "suspend").mockResolvedValue(undefined)
  const resume = spyOn(setup.renderer, "resume").mockResolvedValue(undefined)
  const viewport = fakeViewport(false)
  const restore = guardTerminalResize(setup.renderer, viewport)

  clock.advance(500)
  restore()

  expect(viewport.repairs).toBe(1)
  expect(suspend).toHaveBeenCalledTimes(1)
  suspend.mockRestore()
  resume.mockRestore()
  setup.renderer.destroy()
})

test("a viewport that recovers at the current size restarts the renderer once", async () => {
  const clock = new ManualClock()
  const setup = await createTestRenderer({ width: 120, height: 30, clock })
  setup.renderer.pause()
  const suspend = spyOn(setup.renderer, "suspend").mockResolvedValue(undefined)
  const resume = spyOn(setup.renderer, "resume").mockResolvedValue(undefined)
  const viewport = fakeViewport(true)
  const restore = guardTerminalResize(setup.renderer, viewport)

  clock.advance(500)
  expect(viewport.repairs).toBe(1)
  expect(suspend).not.toHaveBeenCalled()

  clock.advance(500)
  restore()
  expect(suspend).toHaveBeenCalledTimes(1)
  suspend.mockRestore()
  resume.mockRestore()
  setup.renderer.destroy()
})
