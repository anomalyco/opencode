import { expect, test } from "bun:test"
import { createTestRenderer } from "@opentui/core/testing"
import { destroyRenderer } from "../../src/util/renderer"

test("destroyRenderer is synchronous and safe during and after native closure", async () => {
  const setup = await createTestRenderer({ width: 10, height: 2 })
  try {
    await setup.renderer.setupTerminal()
    destroyRenderer(setup.renderer)
    expect(setup.renderer.isDestroyed).toBe(true)
    expect(() => destroyRenderer(setup.renderer)).not.toThrow()
    await setup.renderer.closed
    expect(() => destroyRenderer(setup.renderer)).not.toThrow()
  } finally {
    setup.renderer.destroy()
    await setup.renderer.closed
  }
})
