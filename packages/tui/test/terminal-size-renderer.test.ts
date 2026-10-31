import { expect, spyOn, test } from "bun:test"
import { createTestRenderer, ManualClock } from "@opentui/core/testing"
import { guardTerminalResize } from "../src/terminal-size"

// Bun reports an inverted console viewport as 2^64 - 29, printed as 2^64.
const INVERTED_WIDTH = 18446744073709552000

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

test("a same-size resize replaces a resize that is still pending", async () => {
  const clock = new ManualClock()
  const setup = await createTestRenderer({ width: 120, height: 30, clock })
  setup.renderer.pause()
  const restore = guardTerminalResize(setup.renderer, undefined)

  setup.renderer.requestResize(300, 30)
  setup.renderer.requestResize(120, 30)
  clock.advance(500)
  await setup.renderOnce()
  restore()

  expect(setup.renderer.width).toBe(120)
  setup.renderer.destroy()
})
